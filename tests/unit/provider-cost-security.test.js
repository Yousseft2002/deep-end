import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildRequest, providerPreferences, interpret, mapHttpError, complete, ProviderError } from "../../server/inner-depth/openrouter.js";
import { estimateTokens, estimateRequestCost, reserveBudget, recordSpend } from "../../server/inner-depth/cost.js";
import { MemoryStore, enforceLimits, countAuthAttempt } from "../../server/inner-depth/ratelimit.js";
import { authenticate, sha256 } from "../../server/inner-depth/auth.js";
import { checkOrigin, HttpError } from "../../server/inner-depth/http.js";
import { loadConfig } from "../../server/inner-depth/config.js";
import { REFLECTION_SCHEMA } from "../../server/inner-depth/schema.js";
import { runReflection, normalizeOptions } from "../../server/inner-depth/pipeline.js";
import { normalizeSession } from "../../server/inner-depth/session.js";

const config = loadConfig({ INNER_DEPTH_AI_ENABLED: "true", OPENROUTER_API_KEY: "sk-test", INNER_DEPTH_FACILITATOR_KEYS: "fac:0123456789abcdef,hashed:sha256:" + sha256("another-secret-code") });
const scenarios = JSON.parse(readFileSync(new URL("../fixtures/scenarios.json", import.meta.url), "utf8")).scenarios;

test("every request carries privacy routing, strict schema, no tools, bounded output", () => {
  const body = buildRequest({ config, choice: { selector: "registry", primary: { id: "anthropic/claude-sonnet-5.5" }, fallbacks: [{ id: "openai/gpt-6.2-sol" }] }, instructions: "I", input: "U", format: REFLECTION_SCHEMA, maxOutputTokens: 1234, effort: "medium", sessionId: "abcdefghijklmnop" });
  assert.deepEqual(body.provider, { zdr: true, data_collection: "deny", require_parameters: true, allow_fallbacks: true });
  assert.equal(body.response_format.type, "json_schema");
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.response_format.json_schema.schema.additionalProperties, false);
  assert.equal(body.max_tokens, 1234);
  assert.deepEqual(body.models, ["anthropic/claude-sonnet-5.5", "openai/gpt-6.2-sol"]);
  assert.deepEqual(body.plugins, []); assert.deepEqual(body.transforms, []);
  assert.equal(body.tools, undefined);
  assert.deepEqual(body.reasoning, { effort: "medium", exclude: true });
  assert.equal(body.messages[0].role, "system");
  const auto = buildRequest({ config, choice: { selector: "openrouter-auto", auto: ["a/b", "c/d"] }, instructions: "I", input: "U", format: REFLECTION_SCHEMA, maxOutputTokens: 100 });
  assert.equal(auto.model, "openrouter/auto");
  assert.deepEqual(auto.plugins, [{ id: "auto-router", allowed_models: ["a/b", "c/d"] }]);
  assert.deepEqual(providerPreferences(loadConfig({ INNER_DEPTH_ALLOW_SAFETY_RETENTION: "true" })).zdr, true, "zdr stays on even when safety retention is tolerated");
});

test("interpret handles success, refusal, length, errors and fenced JSON", () => {
  const ok = interpret({ id: "gen-1", model: "anthropic/claude-sonnet-5.5", provider: "Amazon Bedrock", choices: [{ finish_reason: "stop", message: { role: "assistant", content: "```json\n{\"a\":1}\n```" } }], usage: { prompt_tokens: 10, completion_tokens: 5, completion_tokens_details: { reasoning_tokens: 2 }, cost: 0.0012 } }, 321);
  assert.deepEqual(ok.parsed, { a: 1 }); assert.equal(ok.usage.cost_usd, 0.0012); assert.equal(ok.usage.reasoning_tokens, 2); assert.equal(ok.provider, "Amazon Bedrock");
  assert.throws(() => interpret({ choices: [{ finish_reason: "content_filter", message: { refusal: "no" } }] }), err => err instanceof ProviderError && err.refusal === true && err.code === "refusal");
  assert.throws(() => interpret({ choices: [{ finish_reason: "length", message: { content: "" } }] }), err => err.code === "incomplete" && err.escalatable);
  assert.throws(() => interpret({ choices: [{ finish_reason: "stop", message: { content: "not json" } }] }), err => err.code === "malformed_json");
  assert.throws(() => interpret({ choices: [{ error: { code: 502, message: "down" }, finish_reason: "error" }] }), err => err.code === "provider_error");
  assert.throws(() => interpret({ choices: [] }), err => err.code === "empty_output");
});

test("HTTP errors map to safe codes; moderation is a refusal that never escalates", () => {
  assert.equal(mapHttpError(401, {}).code, "provider_auth");
  assert.equal(mapHttpError(402, {}).code, "provider_credits");
  assert.equal(mapHttpError(403, { metadata: { reasons: ["x"], flagged_input: "..." } }).refusal, true);
  assert.equal(mapHttpError(403, { metadata: { limit_usd: 5 } }).code, "provider_budget");
  assert.equal(mapHttpError(429, {}).escalatable, true);
  assert.equal(mapHttpError(503, {}).code, "no_private_endpoint");
  assert.equal(mapHttpError(400, { message: "response_format not supported" }).escalatable, true);
});

test("complete: timeout and network errors become ProviderErrors without leaking", async () => {
  const slow = () => new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), 5));
  await assert.rejects(complete({ config: { ...config, requestTimeoutMs: 1 }, body: {}, fetchImpl: slow }), err => err.code === "timeout" && err.status === 504);
  await assert.rejects(complete({ config, body: {}, fetchImpl: () => Promise.reject(new Error("ECONNRESET")) }), err => err.code === "provider_unreachable");
  await assert.rejects(complete({ config, body: {}, fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: { code: 401, message: "bad key" } }) }) }), err => err.code === "provider_auth");
});

test("cost estimates are conservative and budgets are enforced", async () => {
  assert.ok(estimateTokens("hello world") >= 3);
  assert.ok(estimateTokens("مرحبا بالعالم") > estimateTokens("hello"));
  const est = estimateRequestCost({ model: { pricing: { prompt: 0.000002, completion: 0.00001 } }, instructions: "x".repeat(3300), input: "y".repeat(3300), maxOutputTokens: 1000 });
  assert.ok(est.max_usd > est.typical_usd);
  assert.ok(Math.abs(est.max_usd - (2050 * 0.000002 + 1000 * 0.00001)) < 1e-6);
  const store = new MemoryStore();
  const c = loadConfig({ INNER_DEPTH_MAX_SESSION_COST_USD: "0.05", INNER_DEPTH_MAX_REQUESTS_PER_SESSION: "2", INNER_DEPTH_MAX_REQUEST_COST_USD: "0.04" });
  const r1 = await reserveBudget({ store, config: c, sessionId: "s1", facilitatorId: "f", estimate: { max_usd: 0.03 }, budgetUsd: 0.05 });
  assert.equal(r1.count, 1);
  await recordSpend({ store, sessionId: "s1", facilitatorId: "f", usd: 0.03 });
  await assert.rejects(reserveBudget({ store, config: c, sessionId: "s1", facilitatorId: "f", estimate: { max_usd: 0.03 }, budgetUsd: 0.05 }), err => err.code === "session_budget" && err.status === 402);
  await assert.rejects(reserveBudget({ store, config: c, sessionId: "s2", facilitatorId: "f", estimate: { max_usd: 0.05 }, budgetUsd: 0.05 }), err => err.code === "request_too_expensive");
  await reserveBudget({ store, config: c, sessionId: "s3", facilitatorId: "f", estimate: { max_usd: 0.001 }, budgetUsd: 0.05 });
  await reserveBudget({ store, config: c, sessionId: "s3", facilitatorId: "f", estimate: { max_usd: 0.001 }, budgetUsd: 0.05 });
  await assert.rejects(reserveBudget({ store, config: c, sessionId: "s3", facilitatorId: "f", estimate: { max_usd: 0.001 }, budgetUsd: 0.05 }), err => err.code === "session_request_limit");
  // Facilitator cannot raise the budget above the server cap.
  const r4 = await reserveBudget({ store, config: c, sessionId: "s4", facilitatorId: "f", estimate: { max_usd: 0.001 }, budgetUsd: 99 });
  assert.equal(r4.budget_usd, 0.05);
});

test("rate limits and auth throttling", async () => {
  const store = new MemoryStore();
  const c = loadConfig({ INNER_DEPTH_RATE_LIMIT_PER_MINUTE: "2", INNER_DEPTH_RATE_LIMIT_PER_DAY: "3", INNER_DEPTH_DAILY_REQUEST_CAP: "100" });
  await enforceLimits({ store, config: c, facilitatorId: "a" }); await enforceLimits({ store, config: c, facilitatorId: "a" });
  await assert.rejects(enforceLimits({ store, config: c, facilitatorId: "a" }), err => err.code === "rate_limited" && err.status === 429);
  await enforceLimits({ store, config: c, facilitatorId: "b" });  // other facilitator unaffected
  for (let i = 0; i < 40; i++) await countAuthAttempt(store, "1.2.3.4");
  await assert.rejects(countAuthAttempt(store, "1.2.3.4"), err => err.code === "too_many_attempts");
});

test("authentication: bearer codes, hashed codes, constant-time compare, labels only", () => {
  const ok = authenticate({ headers: { authorization: "Bearer 0123456789abcdef" } }, config);
  assert.equal(ok.label, "fac"); assert.ok(!("secret" in ok));
  assert.equal(authenticate({ headers: { authorization: "Bearer another-secret-code" } }, config).label, "hashed");
  assert.throws(() => authenticate({ headers: {} }, config), err => err.code === "facilitator_code_required");
  assert.throws(() => authenticate({ headers: { authorization: "Bearer wrong-code-here" } }, config), err => err.code === "facilitator_code_invalid");
  assert.throws(() => authenticate({ headers: { authorization: "Bearer short" } }, config), err => err.code === "facilitator_code_invalid");
});

test("origin validation: same-origin, allowlist, Capacitor, rejects others", () => {
  const c = loadConfig({ INNER_DEPTH_ALLOWED_ORIGINS: "https://yousseft2002.github.io,capacitor://localhost", VERCEL_URL: "deep-end-abc.vercel.app" });
  assert.equal(checkOrigin({ headers: { origin: "https://my.app", host: "my.app" } }, c), "https://my.app");
  assert.equal(checkOrigin({ headers: { origin: "https://yousseft2002.github.io", host: "api.example" } }, c), "https://yousseft2002.github.io");
  assert.equal(checkOrigin({ headers: { origin: "capacitor://localhost", host: "api.example" } }, c), "capacitor://localhost");
  assert.equal(checkOrigin({ headers: { origin: "https://deep-end-abc.vercel.app", host: "other" } }, c), "https://deep-end-abc.vercel.app");
  assert.throws(() => checkOrigin({ headers: { origin: "https://evil.example", host: "my.app" } }, c), err => err instanceof HttpError && err.code === "origin_not_allowed");
  assert.throws(() => checkOrigin({ headers: { host: "my.app" } }, c), err => err.code === "origin_required");
  assert.throws(() => checkOrigin({ headers: { origin: "null", host: "my.app" } }, c), err => err.code === "origin_required");
});

// Pipeline behaviour with a fake OpenRouter: escalation on grounding failure, refusal never escalates, cost recorded.
function fakeFetch(responses) {
  const calls = [];
  return { calls, fetchImpl: async (url, init) => { const body = JSON.parse(init.body); calls.push(body); const r = responses.shift(); return { ok: r.status === 200, status: r.status, json: async () => r.body }; } };
}
const okBody = (content, model, cost = 0.002) => ({ status: 200, body: { id: "gen", model, provider: "Amazon Bedrock", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }], usage: { prompt_tokens: 100, completion_tokens: 50, cost } } });
const groundedReflection = { status: "reflection", opening: "Thank you. You can correct any of this.", themes: [{ title: "Holding it together", read_aloud: "You described yourself as the one who holds it together, and said you don't know who you are when nobody needs you. Does that feel accurate?", answer_ids: ["q1"], principle_ids: [], confidence: "clear", facilitator_note: null }], ambiguities: [], follow_up_questions: [], closing: "What feels true is yours to decide. You don't have to make sense of everything today.", insufficient_reason: null, safety_support: null };
const ungroundedReflection = { ...groundedReflection, themes: [{ title: "Profile", read_aloud: "She is clearly an anxious caretaker type.", answer_ids: ["q1"], principle_ids: [], confidence: "clear", facilitator_note: null }] };

test("pipeline escalates once when every theme fails validation, then returns the grounded result with real cost", async () => {
  const { calls, fetchImpl } = fakeFetch([okBody(ungroundedReflection, "anthropic/claude-sonnet-5.5"), okBody(groundedReflection, "anthropic/claude-opus-5.5", 0.01)]);
  const session = normalizeSession(structuredClone(scenarios[0].session));
  const out = await runReflection({ config, store: new MemoryStore(), session, facilitator: { id: "f1" }, options: normalizeOptions({ session_id: "abcdefgh-1" }, config), fetchImpl });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].model, "anthropic/claude-opus-5.5");
  assert.ok(calls.every(c => c.provider.zdr === true && c.provider.data_collection === "deny"));
  assert.equal(out.result.status, "reflection");
  assert.equal(out.routing.escalated, true);
  assert.equal(out.routing.tier, "advanced");
  assert.equal(out.cost.actual_usd, 0.01);
  assert.ok(Math.abs(out.cost.session_spent_usd - 0.012) < 1e-9, "both attempts are charged to the session");
});

test("pipeline never escalates past a refusal and never past a manual choice", async () => {
  const refusal = { status: 200, body: { model: "m", choices: [{ finish_reason: "content_filter", message: { refusal: "I can't" } }], usage: {} } };
  const { calls, fetchImpl } = fakeFetch([refusal, okBody(groundedReflection, "x")]);
  const session = normalizeSession(structuredClone(scenarios[0].session));
  await assert.rejects(runReflection({ config, store: new MemoryStore(), session, facilitator: { id: "f1" }, options: normalizeOptions({ session_id: "abcdefgh-2" }, config), fetchImpl }), err => err.code === "refusal" && err.status === 422);
  assert.equal(calls.length, 1);
  const manual = fakeFetch([okBody(ungroundedReflection, "deepseek/deepseek-v4.1-flash"), okBody(groundedReflection, "x")]);
  const out = await runReflection({ config, store: new MemoryStore(), session, facilitator: { id: "f1" }, options: normalizeOptions({ session_id: "abcdefgh-3", routing_mode: "manual", model: "deepseek/deepseek-v4.1-flash" }, config), fetchImpl: manual.fetchImpl });
  assert.equal(manual.calls.length, 1);
  assert.equal(out.result.status, "insufficient_notes");
  assert.equal(out.result.rejected.length, 1);
});

test("pipeline: insufficient notes does not trigger escalation; safety screen skips the model entirely", async () => {
  const thin = { ...groundedReflection, status: "insufficient_notes", themes: [], insufficient_reason: "Only one short answer." };
  const { calls, fetchImpl } = fakeFetch([okBody(thin, "a"), okBody(groundedReflection, "b")]);
  const session = normalizeSession(structuredClone(scenarios.find(s => s.id === "insufficient").session));
  const out = await runReflection({ config, store: new MemoryStore(), session, facilitator: { id: "f1" }, options: normalizeOptions({ session_id: "abcdefgh-4" }, config), fetchImpl });
  assert.equal(calls.length, 1); assert.equal(out.result.status, "insufficient_notes");
  const safe = fakeFetch([okBody(groundedReflection, "a")]);
  const s2 = normalizeSession(structuredClone(scenarios.find(s => s.id === "safety-disclosure").session));
  const out2 = await runReflection({ config, store: new MemoryStore(), session: s2, facilitator: { id: "f1" }, options: normalizeOptions({ session_id: "abcdefgh-5" }, config), fetchImpl: safe.fetchImpl });
  assert.equal(safe.calls.length, 0); assert.equal(out2.result.status, "safety_support"); assert.equal(out2.cost.actual_usd, 0);
});

test("dry run estimates without calling the provider or reserving budget", async () => {
  const { calls, fetchImpl } = fakeFetch([]);
  const session = normalizeSession(structuredClone(scenarios[0].session));
  const out = await runReflection({ config, store: new MemoryStore(), session, facilitator: { id: "f1" }, options: normalizeOptions({ session_id: "abcdefgh-6", dry_run: true }, config), fetchImpl });
  assert.equal(calls.length, 0); assert.equal(out.dry_run, true); assert.ok(out.estimate.max_usd > 0); assert.ok(out.routing.tier);
});
