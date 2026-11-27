#!/usr/bin/env node
// Real API smoke test: one synthetic session through the live pipeline, with full validation.
// Proves the OpenRouter integration works end to end; a mock pass never counts as proof.
//
//   OPENROUTER_API_KEY=... node tools/inner-depth-smoke.mjs                # adaptive routing
//   node tools/inner-depth-smoke.mjs --model anthropic/claude-haiku-5.5    # manual model
//   node tools/inner-depth-smoke.mjs --scenario faith-and-culture --mode economy
//
// Reads .env.local if present. Prints routing, cost and a summary of the validated themes.
// Never prints the API key. Exit code 0 only when a live model produced a validated result.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadEnv } from "./inner-depth-dev-server.mjs";
import { loadConfig, readinessProblem } from "../server/inner-depth/config.js";
import { MemoryStore } from "../server/inner-depth/ratelimit.js";
import { normalizeSession } from "../server/inner-depth/session.js";
import { runReflection, runChat, normalizeOptions } from "../server/inner-depth/pipeline.js";

const root = fileURLToPath(new URL("..", import.meta.url));
loadEnv(path.join(root, ".env.local"));

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith("--") ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : true] : []).filter(Boolean));
const config = loadConfig({ ...process.env, INNER_DEPTH_AI_MODE: "live", INNER_DEPTH_AI_ENABLED: "true", INNER_DEPTH_FACILITATOR_KEYS: process.env.INNER_DEPTH_FACILITATOR_KEYS || "smoke:smoke-test-code-not-used" });
const problem = readinessProblem(config);
if (problem) {
  console.error("Smoke test cannot run: " + problem + (problem === "missing_api_key" ? ". Set OPENROUTER_API_KEY in the environment or .env.local." : ""));
  process.exit(2);
}

const scenarios = JSON.parse(readFileSync(path.join(root, "tests/fixtures/scenarios.json"), "utf8")).scenarios;
const scenario = scenarios.find(s => s.id === (args.scenario || "parent-grief")) || scenarios[0];
const session = normalizeSession(scenario.session);
const store = new MemoryStore();
const facilitator = { id: "smoke", label: "smoke" };
const options = normalizeOptions({ session_id: "smoke-" + Date.now().toString(36), routing_mode: args.model ? "manual" : (args.mode || "adaptive"), model: args.model, budget_usd: Number(args.budget) || 0.5 }, config);

console.log(`Scenario: ${scenario.title}\nRouting mode: ${options.mode}${options.manual ? " (" + options.manual + ")" : ""}\nPrivacy: zdr=true data_collection=deny require_parameters=true\n`);
const t0 = Date.now();
let out;
try {
  out = await runReflection({ config, store, session, facilitator, options });
} catch (err) {
  console.error("FAILED:", err.code || err.name, err.message, err.extra && err.extra.body ? JSON.stringify(err.extra.body, null, 1) : "");
  process.exit(1);
}
const r = out.result, rt = out.routing, c = out.cost;
console.log(`Status: ${r.status}   Mode: ${out.mode}   Time: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (rt) {
  console.log(`Tier: ${rt.tier} (${rt.tier_reason}; complexity ${rt.complexity_score})`);
  console.log(`Model requested: ${rt.model_requested}   used: ${rt.model_used} via ${rt.provider_used}   effort: ${rt.reasoning_effort}   escalated: ${rt.escalated}`);
  for (const a of rt.attempts) console.log(`  attempt ${a.attempt}: ${a.tier} ${a.model || a.model_requested} -> ${a.outcome}${a.error ? " (" + a.error + ")" : ""} ${a.usage ? `tokens in ${a.usage.prompt_tokens} out ${a.usage.completion_tokens} reasoning ${a.usage.reasoning_tokens}` : ""} ${a.latency_ms ? a.latency_ms + "ms" : ""}`);
}
console.log(`Cost: actual ${c.actual_usd === null || c.actual_usd === undefined ? "not reported" : "$" + c.actual_usd.toFixed(5)}   estimated typical $${c.estimate ? c.estimate.typical_usd.toFixed(5) : "?"} max $${c.estimate ? c.estimate.max_usd.toFixed(5) : "?"}   session total $${(c.session_spent_usd || 0).toFixed(5)}\n`);
if (r.status === "reflection") {
  console.log("Opening:", r.opening);
  r.themes.forEach(t => console.log(`\n[${t.id}] ${t.title}  (${t.confidence}, grounding ${t.grounding}, evidence ${t.answer_ids.join(",")}, principles ${t.principle_ids.join(",") || "none"})\n  ${t.read_aloud}${t.facilitator_note ? "\n  note: " + t.facilitator_note : ""}`));
  if (r.rejected.length) console.log("\nRejected by validator:", JSON.stringify(r.rejected, null, 1));
  if (r.ambiguities.length) console.log("\nAmbiguities:", r.ambiguities.map(a => (a.answer_id || "-") + ": " + a.note).join("\n  "));
  if (r.follow_up_questions.length) console.log("\nFollow-ups:", r.follow_up_questions.join("\n  "));
  console.log("\nClosing:", r.closing);
} else {
  console.log(r.insufficient_reason || r.safety_support);
}

if (args.chat && r.status === "reflection") {
  const chat = await runChat({ config, store, session, facilitator, options, themes: r.themes, history: [], message: String(args.chat === true ? "Can you make the first theme gentler?" : args.chat) });
  console.log("\nChat reply:", chat.result.reply, chat.result.proposed_revisions.length ? "\nProposed: " + JSON.stringify(chat.result.proposed_revisions, null, 1) : "", "\nvia", chat.routing.model_used, chat.routing.tier, "$" + (chat.cost.actual_usd ?? "?"));
}
process.exit(out.mode === "live" && (r.status === "reflection" || r.status === "insufficient_notes") ? 0 : 1);
