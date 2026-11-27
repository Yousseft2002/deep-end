// The one place that talks to OpenRouter: chat completions with a strict JSON schema, privacy routing
// on every request, a hard timeout, and careful interpretation of the many ways a response can fail.
// Plain fetch; no SDK so the request body is exactly what this file says it is.

export class ProviderError extends Error {
  constructor(code, message, { status = 502, retryable = false, escalatable = false, refusal = false } = {}) {
    super(message); this.code = code; this.status = status; this.retryable = retryable; this.escalatable = escalatable; this.refusal = refusal;
  }
}

// Privacy routing applied to every request, retry, fallback and manual override. Never weakened.
export function providerPreferences(config) {
  // zdr is OR-ed with the account's own settings, so it can only tighten routing. Safety Retention
  // endpoints stay in the pool only if the OpenRouter account allows them; the registry additionally
  // refuses such models unless INNER_DEPTH_ALLOW_SAFETY_RETENTION is set (see registry.js).
  // require_parameters guarantees the endpoint really supports response_format/json_schema and reasoning
  // instead of silently dropping them. The per-request cost cap is enforced locally from catalog pricing.
  return { zdr: true, data_collection: "deny", require_parameters: true, allow_fallbacks: true, ...(config.allowSafetyRetention ? {} : {}) };
}

export function buildRequest({ config, choice, instructions, input, format, maxOutputTokens, effort, sessionId }) {
  const body = {
    messages: [
      { role: "system", content: instructions },
      { role: "user", content: input }
    ],
    response_format: { type: "json_schema", json_schema: { name: format.name, strict: true, schema: format.schema } },
    max_tokens: maxOutputTokens,
    provider: providerPreferences(config),
    // No tools, no plugins (web search etc.), no provider-side transforms of the prompt.
    plugins: [],
    transforms: [],
    user: sessionId ? "session-" + sessionId.slice(0, 16) : undefined
  };
  if (choice.selector === "openrouter-auto") {
    body.model = "openrouter/auto";
    body.plugins = [{ id: "auto-router", allowed_models: choice.auto }];
  } else {
    body.model = choice.primary.id;
    if (choice.fallbacks && choice.fallbacks.length) body.models = [choice.primary.id, ...choice.fallbacks.map(f => f.id)];
  }
  if (effort && effort !== "none") body.reasoning = { effort, exclude: true };
  return body;
}

export function headers(config) {
  const h = { Authorization: "Bearer " + config.apiKey, "Content-Type": "application/json", "X-OpenRouter-Title": config.appTitle, "X-Title": config.appTitle };
  if (config.appUrl) h["HTTP-Referer"] = config.appUrl;
  return h;
}

export async function complete({ config, body, fetchImpl = fetch }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs);
  const started = Date.now();
  let res, data;
  try {
    res = await fetchImpl(config.baseUrl + "/chat/completions", { method: "POST", headers: headers(config), body: JSON.stringify(body), signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    if (err && (err.name === "AbortError" || err.name === "TimeoutError")) throw new ProviderError("timeout", "The model took too long to answer. Try again or use the local organizer.", { status: 504, retryable: true });
    throw new ProviderError("provider_unreachable", "Could not reach the AI provider.", { status: 502, retryable: true });
  }
  clearTimeout(timer);
  try { data = await res.json(); }
  catch { throw new ProviderError("malformed_response", "The AI provider returned an unreadable response.", { status: 502, retryable: true }); }
  if (!res.ok || (data && data.error && !data.choices)) throw mapHttpError(res.status, data && data.error);
  return interpret(data, Date.now() - started);
}

export function mapHttpError(status, error) {
  const message = (error && error.message) || "";
  const meta = (error && error.metadata) || {};
  const code = (error && error.code) || status;
  if (code === 401) return new ProviderError("provider_auth", "The server's OpenRouter key was rejected. Tell the owner.", { status: 503 });
  if (code === 402) return new ProviderError("provider_credits", "The OpenRouter account is out of credits or over its limit. Tell the owner.", { status: 503 });
  if (code === 403) {
    if (meta.error_type === "refusal" || meta.error_type === "content_policy_violation" || meta.reasons) return new ProviderError("refusal", "The provider declined to process these notes.", { status: 422, refusal: true });
    if (meta.limit_usd !== undefined) return new ProviderError("provider_budget", "The OpenRouter key's spending limit has been reached. Tell the owner.", { status: 503 });
    return new ProviderError("provider_forbidden", "The provider refused the request (guardrail or permissions).", { status: 503 });
  }
  if (code === 408) return new ProviderError("timeout", "The model took too long to answer.", { status: 504, retryable: true, escalatable: true });
  if (code === 429) return new ProviderError("provider_rate_limited", "The AI provider is busy. Try again in a moment.", { status: 503, retryable: true, escalatable: true });
  if (code === 503) return new ProviderError("no_private_endpoint", "No provider currently satisfies the privacy and structured-output requirements for this model.", { status: 503, retryable: false, escalatable: true });
  if (code === 502) return new ProviderError("provider_error", "The model's provider is down or returned an invalid response.", { status: 502, retryable: true, escalatable: true });
  if (code === 400) return new ProviderError("provider_rejected", "The AI provider rejected the request: " + message.slice(0, 200), { status: 502, escalatable: /schema|response_format|structured/i.test(message) });
  return new ProviderError("provider_unknown", "The AI request failed.", { status: 502, retryable: true, escalatable: true });
}

export function interpret(data, latencyMs = 0) {
  const choice = data.choices && data.choices[0];
  if (!choice) throw new ProviderError("empty_output", "The model returned nothing usable.", { status: 502, retryable: true, escalatable: true });
  if (choice.error) throw mapHttpError(200, choice.error);
  const finish = choice.finish_reason;
  const message = choice.message || {};
  if (finish === "content_filter" || message.refusal) throw new ProviderError("refusal", "The model declined to organize these notes" + (message.refusal ? ": " + String(message.refusal).slice(0, 300) : "."), { status: 422, refusal: true });
  if (finish === "length") throw new ProviderError("incomplete", "The model ran out of room before finishing. Try again with a higher output limit or shorter notes.", { status: 502, retryable: true, escalatable: true });
  if (finish === "error") throw new ProviderError("provider_error", "The provider interrupted the response.", { status: 502, retryable: true, escalatable: true });
  const text = typeof message.content === "string" ? message.content : Array.isArray(message.content) ? message.content.map(p => p.text || "").join("") : "";
  if (!text.trim()) throw new ProviderError("empty_output", "The model returned nothing usable.", { status: 502, retryable: true, escalatable: true });
  let parsed;
  try { parsed = JSON.parse(stripFences(text)); }
  catch { throw new ProviderError("malformed_json", "The model returned text that was not valid JSON.", { status: 502, retryable: true, escalatable: true }); }
  const usage = data.usage || {};
  return {
    parsed,
    model: data.model || null,
    provider: data.provider || null,
    generation_id: data.id || null,
    latency_ms: latencyMs,
    usage: {
      prompt_tokens: usage.prompt_tokens || 0,
      completion_tokens: usage.completion_tokens || 0,
      reasoning_tokens: (usage.completion_tokens_details && usage.completion_tokens_details.reasoning_tokens) || 0,
      cost_usd: typeof usage.cost === "number" ? usage.cost : null
    }
  };
}

function stripFences(text) {
  const t = text.trim();
  const m = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(t);
  return m ? m[1] : t;
}
