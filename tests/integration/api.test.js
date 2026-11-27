// Integration: the real HTTP handlers through the dev server in mock mode. No network beyond localhost.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

process.env.INNER_DEPTH_AI_ENABLED = "true";
process.env.INNER_DEPTH_AI_MODE = "mock";
process.env.INNER_DEPTH_FACILITATOR_KEYS = "tester:integration-test-code-123";
process.env.INNER_DEPTH_RATE_LIMIT_PER_MINUTE = "100";
process.env.INNER_DEPTH_LOG = "silent";
process.env.INNER_DEPTH_CATALOG_TTL_MS = "60000";
delete process.env.VERCEL_ENV; delete process.env.NODE_ENV;

const { createServer } = await import("../../tools/inner-depth-dev-server.mjs");
const scenarios = JSON.parse(readFileSync(new URL("../fixtures/scenarios.json", import.meta.url), "utf8")).scenarios;
let server, base, origin;
before(async () => { server = createServer(); await new Promise(r => server.listen(0, "127.0.0.1", r)); base = `http://127.0.0.1:${server.address().port}`; origin = base; });
after(() => server.close());

const post = (path, body, { code = "integration-test-code-123", headers = {} } = {}) => fetch(base + "/api/inner-depth" + path, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin, ...(code ? { Authorization: "Bearer " + code } : {}), ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
const session = id => structuredClone(scenarios.find(s => s.id === id).session);
const options = (extra = {}) => ({ session_id: "integration-session-1", ...extra });

test("status is public, reveals no secrets, lists eligibility and the retention statement", async () => {
  const res = await fetch(base + "/api/inner-depth/status");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store, no-cache, must-revalidate, private");
  const body = await res.json();
  assert.equal(body.enabled, true); assert.equal(body.mode, "mock"); assert.equal(body.provider, "OpenRouter");
  assert.ok(body.models.some(m => m.eligible)); assert.ok(body.privacy.retention_statement.includes("Zero Data Retention"));
  assert.ok(!JSON.stringify(body).includes("integration-test-code"));
});

test("reflect requires origin, access code, adult, consent", async () => {
  const s = session("parent-grief");
  assert.equal((await fetch(base + "/api/inner-depth/reflect", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer integration-test-code-123" }, body: JSON.stringify({ session: s, options: options() }) })).status, 403);
  assert.equal((await post("/reflect", { session: s, options: options() }, { code: null })).status, 401);
  assert.equal((await post("/reflect", { session: s, options: options() }, { code: "wrong-code-wrong-code" })).status, 401);
  const teen = session("parent-grief"); teen.age_band = "teen";
  const r = await post("/reflect", { session: teen, options: options() }); assert.equal(r.status, 403); assert.equal((await r.json()).error, "adults_only");
  const noConsent = session("parent-grief"); noConsent.consent.external_ai = false;
  assert.equal((await post("/reflect", { session: noConsent, options: options() })).status, 403);
  assert.equal((await post("/reflect", "{not json", {})).status, 400);
  assert.equal((await post("/reflect", { session: s }, {})).status, 400, "session_id is required");
  assert.equal((await fetch(base + "/api/inner-depth/reflect", { method: "GET", headers: { Origin: origin } })).status, 405);
});

test("reflect in mock mode returns a validated, clearly marked dossier with routing and cost", async () => {
  const res = await post("/reflect", { session: session("parent-grief"), options: options() });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.mode, "mock");
  assert.equal(body.result.status, "reflection");
  assert.ok(body.result.themes.length >= 3);
  assert.ok(body.result.themes.every(t => /\byou\b/i.test(t.read_aloud) && t.answer_ids.length));
  assert.equal(body.routing.model_used, "mock/inner-depth");
  assert.ok(["fast", "balanced", "advanced"].includes(body.routing.tier));
  assert.equal(body.cost.actual_usd, 0);
  assert.equal(body.cost.requests_used, 1);
});

test("prompt injection inside notes is treated as data and flagged", async () => {
  const res = await post("/reflect", { session: session("induced-conclusions"), options: options({ session_id: "integration-session-2" }) });
  const body = await res.json();
  assert.equal(res.status, 200);
  const text = JSON.stringify(body.result.themes.map(t => t.read_aloud + t.title)).toLowerCase();
  assert.ok(!/narciss|adhd|attachment/.test(text));
  assert.ok(body.result.ambiguities.some(a => a.answer_id === "q2" && /instruction/i.test(a.note)));
});

test("safety disclosure short-circuits before any model call", async () => {
  const res = await post("/reflect", { session: session("safety-disclosure"), options: options({ session_id: "integration-session-3" }) });
  const body = await res.json();
  assert.equal(body.result.status, "safety_support");
  assert.equal(body.result.themes.length, 0);
  assert.equal(body.safety_screen, "local");
  assert.ok(body.result.safety_support.includes("emergency"));
});

test("regenerate and chat work on the same temporary context; chat refuses causes", async () => {
  const s = session("young-adult-conflict");
  const first = await (await post("/reflect", { session: s, options: options({ session_id: "integration-session-4" }) })).json();
  const theme = first.result.themes[0];
  const regen = await post("/regenerate", { session: s, options: options({ session_id: "integration-session-4" }), theme: { id: theme.id, title: theme.title, read_aloud: theme.read_aloud, answer_ids: theme.answer_ids }, instruction: "gentler please" });
  assert.equal(regen.status, 200);
  const rb = await regen.json();
  assert.equal(rb.result.status, "theme"); assert.equal(rb.result.theme.id, theme.id); assert.equal(rb.routing.task, "rewording"); assert.equal(rb.routing.tier, "fast");
  const chat = await post("/chat", { session: s, options: options({ session_id: "integration-session-4" }), themes: first.result.themes.map(t => ({ id: t.id, title: t.title, read_aloud: t.read_aloud, answer_ids: t.answer_ids })), history: [], message: "Why does he really stay? Is it because of the divorce?" });
  const cb = await chat.json();
  assert.equal(chat.status, 200);
  assert.ok(cb.result.caution, "asking for causes should produce a caution");
  assert.equal(cb.routing.task, "clarification");
  const bad = await post("/regenerate", { session: s, options: options({ session_id: "integration-session-4" }), theme: { id: "t1", title: "x", read_aloud: "You said", answer_ids: ["q3"] }, instruction: "" });
  assert.equal(bad.status, 400, "a theme citing a skipped answer is rejected");
});

test("payload too large and unsupported media type are rejected", async () => {
  const s = session("parent-grief"); s.answers[0].answer = "x".repeat(1600);
  const big = { session: s, options: options(), pad: "p".repeat(200000) };
  assert.equal((await post("/reflect", big)).status, 413);
  assert.equal((await post("/reflect", "{}", { headers: { "Content-Type": "text/plain" } })).status, 415);
});

test("session request limit is enforced per session id", async () => {
  process.env.INNER_DEPTH_MAX_REQUESTS_PER_SESSION = "2";
  const s = session("faith-and-culture");
  const o = options({ session_id: "integration-session-limit" });
  assert.equal((await post("/reflect", { session: s, options: o })).status, 200);
  assert.equal((await post("/reflect", { session: s, options: o })).status, 200);
  const third = await post("/reflect", { session: s, options: o });
  assert.equal(third.status, 429); assert.equal((await third.json()).error, "session_request_limit");
  delete process.env.INNER_DEPTH_MAX_REQUESTS_PER_SESSION;
});

test("CORS preflight only for allowed origins", async () => {
  const ok = await fetch(base + "/api/inner-depth/reflect", { method: "OPTIONS", headers: { Origin: origin, Host: new URL(base).host } });
  assert.equal(ok.status, 204);
  const bad = await fetch(base + "/api/inner-depth/reflect", { method: "OPTIONS", headers: { Origin: "https://evil.example" } });
  assert.equal(bad.status, 403);
});

test("static docs are served and the service worker shell lists the Inner Depth files", async () => {
  assert.equal((await fetch(base + "/inner-depth.html")).status, 200);
  const sw = await (await fetch(base + "/sw.js")).text();
  for (const f of ["inner-depth.html", "inner-depth.js", "inner-depth-config.js", "inner-depth-safety.js"]) assert.ok(sw.includes(`"${f}"`), f + " in SHELL");
  assert.ok(sw.includes('/api/'));
});
