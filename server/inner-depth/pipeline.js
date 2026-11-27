// Orchestration: safety screen, routing, cost reservation, bounded attempts with escalation,
// validation, and a response that tells the facilitator exactly what happened and what it cost.
import { HttpError } from "./http.js";
import { screenSession, safetyResponse } from "./safety.js";
import { buildInstructions, reflectionInput, regenerateInput, chatInstructions, chatInput, PROMPT_VERSION } from "./prompt.js";
import { REFLECTION_SCHEMA, SINGLE_THEME_SCHEMA, CHAT_SCHEMA } from "./schema.js";
import { validateReflection, validateSingleTheme, validateChat, OutputError } from "./validate.js";
import { getCatalog } from "./catalog.js";
import { describeModels, registryIds } from "./registry.js";
import { assessSession, chooseTier, chooseModels } from "./router.js";
import { estimateRequestCost, reserveBudget, recordSpend, sessionSpend } from "./cost.js";
import { buildRequest, complete, ProviderError } from "./openrouter.js";
import { mockReflection, mockTheme, mockChat } from "./mock.js";
import { ROUTING_MODES, TIERS } from "./config.js";
import { log } from "./logging.js";

// Facilitator-controlled routing options sent with each request. All optional, all bounded.
export function normalizeOptions(raw, config) {
  const o = raw && typeof raw === "object" ? raw : {};
  const mode = ROUTING_MODES.includes(o.routing_mode) ? o.routing_mode : config.routingMode;
  const manual = mode === "manual" && typeof o.model === "string" && /^[a-z0-9.-]+\/[a-z0-9.:-]+$/i.test(o.model) ? o.model : null;
  if (mode === "manual" && !manual) throw new HttpError(400, "model_required", "Manual selection needs a model id.");
  const sessionId = typeof o.session_id === "string" && /^[a-z0-9-]{8,64}$/i.test(o.session_id) ? o.session_id : null;
  if (!sessionId) throw new HttpError(400, "session_id_required", "Missing session id. Reload the page.");
  const budget = Number.isFinite(Number(o.budget_usd)) ? Math.min(config.maxSessionCostUsd, Math.max(0.01, Number(o.budget_usd))) : config.maxSessionCostUsd;
  const requestedTier = TIERS.includes(o.tier) ? o.tier : null;
  return { mode, manual, sessionId, budget, requestedTier, dryRun: o.dry_run === true };
}

async function route({ config, session, task, options, escalateFrom = null }) {
  const { snapshot, source } = await getCatalog(config, registryIds());
  const models = describeModels(snapshot, config);
  const signals = assessSession(session);
  const tierChoice = chooseTier({ task, signals, facilitatorMode: options.mode, escalateFrom, requestedTier: escalateFrom ? null : options.requestedTier });
  const choice = chooseModels({ tier: tierChoice.tier, models, config, manualModelId: escalateFrom ? null : options.manual });
  if (choice.error === "unknown_model") throw new HttpError(400, "unknown_model", "That model is not in the registry.");
  if (choice.error === "model_ineligible") throw new HttpError(422, "model_ineligible", "That model is not eligible: " + choice.reasons.join("; "));
  if (choice.error) throw new HttpError(503, "no_eligible_models", "No approved model currently meets the privacy and capability requirements. Use the local organizer.");
  const effortModel = choice.primary || models.find(m => m.id === choice.auto[0]);
  return { models, signals, tierChoice, choice, catalogSource: source, effort: effortFor(effortModel, tierChoice.tier) };
}

function effortFor(model, tier) {
  const wanted = model && model.reasoning_effort ? model.reasoning_effort : tier === "advanced" ? "high" : tier === "fast" ? "low" : "medium";
  const supported = model && model.supported_efforts;
  if (!supported || supported.includes(wanted)) return wanted;
  // Fall back to the closest supported effort rather than sending one the endpoint rejects.
  const ladder = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
  const i = ladder.indexOf(wanted);
  for (let d = 1; d < ladder.length; d++) {
    if (supported.includes(ladder[i - d])) return ladder[i - d];
    if (supported.includes(ladder[i + d])) return ladder[i + d];
  }
  return undefined;
}

function pricingFor(routing) {
  if (routing.choice.primary) return routing.choice.primary;
  // Auto routing: estimate with the most expensive allowed model so the estimate never undershoots.
  return routing.models.filter(m => routing.choice.auto.includes(m.id)).sort((a, b) => (b.pricing.completion - a.pricing.completion))[0];
}

function describeRouting(routing, options, task, attempts, escalated) {
  const last = attempts[attempts.length - 1] || {};
  return {
    routing_mode: options.mode,
    task,
    tier: routing.tierChoice.tier,
    tier_reason: routing.tierChoice.reason,
    complexity_score: routing.tierChoice.score,
    complexity_signals: routing.signals,
    selector: routing.choice.selector,
    model_requested: routing.choice.primary ? routing.choice.primary.id : "openrouter/auto",
    model_display_name: routing.choice.primary ? routing.choice.primary.display_name : "OpenRouter Auto (restricted)",
    model_used: last.model || null,
    provider_used: last.provider || null,
    reasoning_effort: routing.effort || null,
    tier_demoted: !!routing.choice.demoted,
    escalated,
    attempts,
    catalog_source: routing.catalogSource,
    prompt_version: PROMPT_VERSION,
    privacy: { zdr: true, data_collection: "deny", require_parameters: true, safety_retention_allowed: routing && routing.models ? !!routing.models.safety : false }
  };
}

// Generic bounded attempt loop shared by the three tasks.
async function attemptLoop({ config, store, session, facilitator, options, task, build, validate, mockFn, schema, maxOutputTokens, fetchImpl }) {
  const attempts = [];
  let escalated = false;
  let routing = await route({ config, session, task, options });
  let reservation = null;
  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    const { instructions, input } = build();
    const priceModel = pricingFor(routing);
    const estimate = estimateRequestCost({ model: priceModel, instructions, input, maxOutputTokens });
    if (options.dryRun) return { dry_run: true, routing: describeRouting(routing, options, task, [], false), estimate, session_spent_usd: await sessionSpend({ store, sessionId: options.sessionId, facilitatorId: facilitator.id }) };
    reservation = await reserveBudget({ store, config, sessionId: options.sessionId, facilitatorId: facilitator.id, estimate, budgetUsd: options.budget });
    const record = { attempt, tier: routing.tierChoice.tier, model_requested: routing.choice.primary ? routing.choice.primary.id : "openrouter/auto", estimate };
    const started = Date.now();
    try {
      let out;
      if (config.mode === "mock") {
        out = { parsed: mockFn(), model: "mock/inner-depth", provider: "mock", latency_ms: 5, usage: { prompt_tokens: 0, completion_tokens: 0, reasoning_tokens: 0, cost_usd: 0 }, generation_id: null };
      } else {
        const body = buildRequest({ config, choice: routing.choice, instructions, input, format: schema, maxOutputTokens, effort: routing.effort, sessionId: options.sessionId });
        out = await complete({ config, body, fetchImpl });
      }
      record.model = out.model; record.provider = out.provider; record.latency_ms = out.latency_ms; record.usage = out.usage;
      record.actual_cost_usd = out.usage.cost_usd;
      const spent = await recordSpend({ store, sessionId: options.sessionId, facilitatorId: facilitator.id, usd: out.usage.cost_usd || 0 });
      let result;
      try { result = validate(out.parsed); }
      catch (err) {
        if (!(err instanceof OutputError)) throw err;
        record.outcome = "malformed"; record.problems = err.problems.slice(0, 8); attempts.push(record);
        log({ event: "attempt", status: "malformed", task, tier: record.tier, model: out.model, attempt, ms: Date.now() - started });
        if (attempt < config.maxAttempts && config.allowEscalation) { routing = await route({ config, session, task, options, escalateFrom: routing.tierChoice.tier }); escalated = true; continue; }
        throw new HttpError(502, "malformed_output", "The model's answer did not match the required format. Nothing was shown. Try again or use the local organizer.", { body: { attempts } });
      }
      record.outcome = result.status || "ok"; attempts.push(record);
      log({ event: "attempt", status: record.outcome, task, tier: record.tier, model: out.model, provider: out.provider, attempt, ms: Date.now() - started, tokens_in: out.usage.prompt_tokens, tokens_out: out.usage.completion_tokens, tokens_reasoning: out.usage.reasoning_tokens, cost_usd: out.usage.cost_usd, themes: result.themes ? result.themes.length : undefined, rejected: result.rejected ? result.rejected.length : undefined, mode: config.mode });
      // Grounding failure (every theme rejected) is worth one escalation; thin notes are not.
      const groundingFailed = result.status === "insufficient_notes" && result.rejected && result.rejected.length > 0;
      if (groundingFailed && attempt < config.maxAttempts && config.allowEscalation && routing.tierChoice.tier !== "advanced" && !options.manual) {
        routing = await route({ config, session, task, options, escalateFrom: routing.tierChoice.tier }); escalated = true; continue;
      }
      return { result, routing: describeRouting(routing, options, task, attempts, escalated), cost: { estimate, actual_usd: out.usage.cost_usd, session_spent_usd: spent, budget_usd: reservation.budget_usd, requests_used: reservation.count, requests_max: config.maxRequestsPerSession }, mode: config.mode };
    } catch (err) {
      if (!(err instanceof ProviderError)) throw err;
      record.outcome = "error"; record.error = err.code; attempts.push(record);
      log({ event: "attempt", status: "error", code: err.code, task, tier: record.tier, attempt, ms: Date.now() - started });
      // Never escalate past a refusal: a safety decision by one model is not a quality problem to route around.
      if (err.refusal) throw new HttpError(err.status, err.code, err.message, { body: { attempts } });
      if (err.escalatable && attempt < config.maxAttempts && config.allowEscalation && !options.manual) { routing = await route({ config, session, task, options, escalateFrom: routing.tierChoice.tier }); escalated = true; continue; }
      throw new HttpError(err.status, err.code, err.message, { body: { attempts, retryable: err.retryable } });
    }
  }
  throw new HttpError(502, "attempts_exhausted", "The AI organizer could not produce a valid reflection. Use the local organizer.", { body: { attempts } });
}

export async function runReflection({ config, store, session, facilitator, options, fetchImpl }) {
  const hits = screenSession(session);
  if (hits.length) {
    log({ event: "safety_screen", status: "flagged", mode: config.mode });
    return { result: safetyResponse(session, hits), routing: null, cost: { actual_usd: 0, session_spent_usd: await sessionSpend({ store, sessionId: options.sessionId, facilitatorId: facilitator.id }) }, mode: config.mode, safety_screen: "local" };
  }
  const instructions = buildInstructions();
  return attemptLoop({
    config, store, session, facilitator, options, task: "organize", fetchImpl,
    build: () => ({ instructions, input: reflectionInput(session) }),
    validate: raw => validateReflection(raw, session),
    mockFn: () => mockReflection(session),
    schema: REFLECTION_SCHEMA, maxOutputTokens: config.maxOutputTokens
  });
}

export function classifyRequest(text) {
  const t = String(text || "").toLowerCase();
  if (/\b(gentl\w*|soft\w*|kinder|warmer|reword\w*|rephras\w*|shorter|simpler|plainer|tone|wording|less (direct|certain|strong))\b/.test(t)) return "rewording";
  if (/\b(follow[- ]?up|question (i|we) (could|can|might|should) ask|what (could|can|should) i ask|non[- ]leading)\b/.test(t)) return "follow_up";
  if (/\b(jung\w*|rogers\w*|freud\w*|schwartz\w*|socrat\w*|principle\w*|teaching\w*|theor\w*|person[- ]cent\w*|internal family|ifs)\b/.test(t)) return "explain_principles";
  if (/\b(connect\w*|between|relat\w*|link\w*|expand|synthes\w*|reorgani\w*|difference|compare|together|across|tension\w*|both)\b/.test(t) || /\b(answers?|questions?)\s+(\w+\s+)?(and|&)\s+\w+/.test(t) || /\bq\d\b.*\bq\d\b/.test(t)) return "synthesis";
  return "clarification";
}

export async function runRegenerate({ config, store, session, facilitator, options, theme, instruction, fetchImpl }) {
  const hits = screenSession(session);
  if (hits.length) return { result: { status: "safety_support", theme: null, reason: null, safety_support: safetyResponse(session, hits).safety_support }, routing: null, cost: { actual_usd: 0 }, mode: config.mode };
  const task = classifyRequest(instruction) === "synthesis" ? "synthesis" : "rewording";
  const instructions = buildInstructions();
  return attemptLoop({
    config, store, session, facilitator, options, task, fetchImpl,
    build: () => ({ instructions, input: regenerateInput(session, theme, instruction) }),
    validate: raw => validateSingleTheme(raw, session, theme.id),
    mockFn: () => mockTheme(session, theme, instruction),
    schema: SINGLE_THEME_SCHEMA, maxOutputTokens: Math.min(config.maxOutputTokens, 3000)
  });
}

export async function runChat({ config, store, session, facilitator, options, themes, history, message, fetchImpl }) {
  const hits = screenSession(session);
  const safety = (await import("./safety.js")).SAFETY;
  if (hits.length || safety.screen(message)) {
    return { result: { reply: "", grounded_in: [], proposed_revisions: [], rejected_revisions: [], caution: null, safety_support: safety.guidance.join(" ") }, routing: null, cost: { actual_usd: 0 }, mode: config.mode };
  }
  const task = classifyRequest(message);
  const instructions = chatInstructions();
  return attemptLoop({
    config, store, session, facilitator, options, task, fetchImpl,
    build: () => ({ instructions, input: chatInput(session, themes, history, message) }),
    validate: raw => validateChat(raw, session, themes),
    mockFn: () => mockChat(session, themes, history, message),
    schema: CHAT_SCHEMA, maxOutputTokens: Math.min(config.maxOutputTokens, 4000)
  });
}
