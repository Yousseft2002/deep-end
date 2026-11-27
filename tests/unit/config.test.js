import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig, readinessProblem, isProduction } from "../../server/inner-depth/config.js";

test("mock mode is refused in production", () => {
  const c = loadConfig({ VERCEL_ENV: "production", INNER_DEPTH_AI_MODE: "mock", INNER_DEPTH_AI_ENABLED: "true", OPENROUTER_API_KEY: "x", INNER_DEPTH_FACILITATOR_KEYS: "a:0123456789abcdef" });
  assert.equal(c.mode, "live");
  assert.equal(c.mockRefused, true);
  assert.equal(readinessProblem(c), "mock_refused_in_production");
});

test("mock mode allowed in preview and development", () => {
  assert.equal(loadConfig({ VERCEL_ENV: "preview", INNER_DEPTH_AI_MODE: "mock" }).mode, "mock");
  assert.equal(loadConfig({ NODE_ENV: "development", INNER_DEPTH_AI_MODE: "mock" }).mode, "mock");
  assert.equal(isProduction({ NODE_ENV: "production" }), true);
  assert.equal(isProduction({ VERCEL_ENV: "preview", NODE_ENV: "production" }), false);
});

test("readiness problems are reported in order", () => {
  assert.equal(readinessProblem(loadConfig({})), "disabled");
  assert.equal(readinessProblem(loadConfig({ INNER_DEPTH_AI_ENABLED: "true" })), "missing_api_key");
  assert.equal(readinessProblem(loadConfig({ INNER_DEPTH_AI_ENABLED: "true", OPENROUTER_API_KEY: "k" })), "no_facilitator_keys");
  assert.equal(readinessProblem(loadConfig({ INNER_DEPTH_AI_ENABLED: "true", OPENROUTER_API_KEY: "k", INNER_DEPTH_FACILITATOR_KEYS: "f:0123456789abcdef" })), null);
});

test("facilitator keys parse plain and hashed forms and reject weak codes", () => {
  const c = loadConfig({ INNER_DEPTH_FACILITATOR_KEYS: "alice:0123456789abcdef, bob:sha256:ABCDEF, weak:short, bad" });
  assert.deepEqual(c.facilitatorKeys.map(k => k.label), ["alice", "bob"]);
  assert.equal(c.facilitatorKeys[1].hashed, true);
  assert.equal(c.facilitatorKeys[1].secret, "abcdef");
});

test("numbers are clamped and lists split", () => {
  const c = loadConfig({ INNER_DEPTH_MAX_ATTEMPTS: "9", INNER_DEPTH_MAX_SESSION_COST_USD: "500", INNER_DEPTH_FAST_MODELS: "a/b, c/d", INNER_DEPTH_ROUTING_MODE: "bogus" });
  assert.equal(c.maxAttempts, 3);
  assert.equal(c.maxSessionCostUsd, 100);
  assert.deepEqual(c.tierModels.fast, ["a/b", "c/d"]);
  assert.equal(c.routingMode, "adaptive");
});

test("safety retention is off unless explicitly enabled", () => {
  assert.equal(loadConfig({}).allowSafetyRetention, false);
  assert.equal(loadConfig({ INNER_DEPTH_ALLOW_SAFETY_RETENTION: "true" }).allowSafetyRetention, true);
});
