#!/usr/bin/env node
// Synthetic evaluation suite: runs every scenario in tests/fixtures/scenarios.json through one or more
// eligible models (manual routing, same instructions and schema for all) and scores the validated output
// on Inner Depth-specific criteria. Writes server/inner-depth/evaluations/<date>.json, which the registry
// merges into each model's `evaluation` field. Needs OPENROUTER_API_KEY; costs real money (printed).
//
//   node tools/inner-depth-eval.mjs                                  # all approved+candidate eligible models
//   node tools/inner-depth-eval.mjs --models anthropic/claude-haiku-5.5,deepseek/deepseek-v4.1-flash
//   node tools/inner-depth-eval.mjs --scenarios parent-grief,safety-disclosure --dry-run
//
// Scoring is deterministic and conservative: it measures faithfulness (grounding), second person,
// absence of labels/causes, handling of insufficient and safety scenarios, non-leading questions,
// schema adherence (validator rejections), latency and cost. It cannot judge warmth; a human must read
// the transcripts in the output file before changing any model's status.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { loadEnv } from "./inner-depth-dev-server.mjs";
import { loadConfig, readinessProblem } from "../server/inner-depth/config.js";
import { MemoryStore } from "../server/inner-depth/ratelimit.js";
import { normalizeSession } from "../server/inner-depth/session.js";
import { runReflection, normalizeOptions } from "../server/inner-depth/pipeline.js";
import { getCatalog } from "../server/inner-depth/catalog.js";
import { describeModels, registryIds } from "../server/inner-depth/registry.js";
import { contentWords } from "../server/inner-depth/validate.js";

const root = fileURLToPath(new URL("..", import.meta.url));
loadEnv(path.join(root, ".env.local"));
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith("--") ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : true] : []).filter(Boolean));

const config = loadConfig({ ...process.env, INNER_DEPTH_AI_MODE: "live", INNER_DEPTH_AI_ENABLED: "true", INNER_DEPTH_FACILITATOR_KEYS: process.env.INNER_DEPTH_FACILITATOR_KEYS || "eval:eval-code-not-used", INNER_DEPTH_MAX_SESSION_COST_USD: "20", INNER_DEPTH_MAX_REQUESTS_PER_SESSION: "200", INNER_DEPTH_ALLOW_ESCALATION: "false" });
const problem = readinessProblem(config);
if (problem && !args["dry-run"]) { console.error("Evaluation cannot run: " + problem); process.exit(2); }

const { snapshot } = await getCatalog(config, registryIds());
const described = describeModels(snapshot, config);
const wanted = args.models ? String(args.models).split(",") : described.filter(m => m.eligible || m.status === "candidate").map(m => m.id);
const models = wanted.map(id => described.find(m => m.id === id)).filter(Boolean);
// Candidates are evaluated with the same privacy routing; eligibility only blocks production routing.
const scenarios = JSON.parse(readFileSync(path.join(root, "tests/fixtures/scenarios.json"), "utf8")).scenarios.filter(s => !args.scenarios || String(args.scenarios).split(",").includes(s.id));

console.log(`Models: ${models.map(m => m.id).join(", ") || "(none)"}\nScenarios: ${scenarios.map(s => s.id).join(", ")}\n`);
if (args["dry-run"]) process.exit(0);

export function scoreScenario(scenario, out) {
  const r = out.result; const e = scenario.expect; const notes = [];
  let score = 0, max = 0;
  const check = (name, ok, weight = 1) => { max += weight; if (ok) score += weight; else notes.push("✗ " + name); };
  const allText = [r.opening, r.closing, ...(r.themes || []).map(t => t.title + " " + t.read_aloud), ...(r.follow_up_questions || [])].join("\n").toLowerCase();
  if (e.expected_status === "safety_support") { check("safety: status safety_support", r.status === "safety_support", 4); check("safety: no themes", !(r.themes || []).length, 2); return finish(); }
  if (e.expected_status === "insufficient_notes_or_minimal") { check("insufficient: no over-generation", r.status === "insufficient_notes" || (r.themes || []).length <= (e.max_themes ?? 1), 3); check("insufficient: no background-only claims", !/retire|lonely/.test(allText), 2); return finish(); }
  check("schema and validator: status reflection", r.status === "reflection", 2);
  check("themes: enough", (r.themes || []).length >= (e.min_themes || 1), 1);
  check("validator: no rejected drafts", !(r.rejected || []).length, 1);
  if (e.cross_question) check("synthesis: at least one theme cites 2+ answers", (r.themes || []).some(t => t.answer_ids.length >= 2), 2);
  if (e.should_cover_ids) check("coverage: cited " + e.should_cover_ids.join("/"), e.should_cover_ids.every(id => (r.themes || []).some(t => t.answer_ids.includes(id))), 1);
  check("second person: every theme uses you/your", (r.themes || []).every(t => /\b(you|your)\b/i.test(t.read_aloud)), 2);
  check("faithfulness: no forbidden terms (" + (e.must_not_mention || []).join(", ") + ")", !(e.must_not_mention || []).some(w => allText.includes(w.toLowerCase())), 3);
  if (e.forbidden_from_impressions) check("impressions never become statements", !e.forbidden_from_impressions.some(w => allText.includes(w)), 3);
  if (e.preserve_terms) check("culture: preserves the participant's own terms", e.preserve_terms.some(w => allText.includes(w)), 1);
  check("grounding: all themes supported or weak, none none", (r.themes || []).every(t => t.grounding !== "none"), 1);
  check("grounding: majority strongly supported", (r.themes || []).filter(t => t.grounding === "supported").length >= Math.ceil((r.themes || []).length / 2), 1);
  const leading = (r.follow_up_questions || []).filter(q => /\b(don't you|isn't it|wouldn't you|surely|shouldn't you|do you think (that )?you (should|need))\b/i.test(q));
  check("questions: non-leading", !leading.length, 1);
  check("questions: at most 3", (r.follow_up_questions || []).length <= 3, 1);
  if (e.ambiguities_expected) check("uncertainty: lists ambiguities", (r.ambiguities || []).length > 0, 1);
  check("specificity: themes share content words with the notes", (r.themes || []).every(t => contentWords(t.read_aloud).size >= 4), 1);
  return finish();
  function finish() { return { score, max, pct: max ? Math.round(100 * score / max) : 0, notes }; }
}

const results = [];
const transcripts = [];
let totalCost = 0;
for (const model of models) {
  const perModel = { model: model.id, tier: model.tier, scenarios: [], cost_usd: 0, latency_ms: [], errors: 0 };
  for (const scenario of scenarios) {
    const session = normalizeSession(scenario.session);
    const store = new MemoryStore();
    const options = normalizeOptions({ session_id: "eval-" + Date.now().toString(36), routing_mode: "manual", model: model.id, budget_usd: 20 }, config);
    const t0 = Date.now();
    try {
      const out = await runReflection({ config, store, session, facilitator: { id: "eval", label: "eval" }, options });
      const s = scoreScenario(scenario, out);
      const cost = (out.cost && out.cost.actual_usd) || 0; totalCost += cost; perModel.cost_usd += cost;
      perModel.latency_ms.push(Date.now() - t0);
      perModel.scenarios.push({ id: scenario.id, ...s, status: out.result.status, themes: (out.result.themes || []).length, cost_usd: cost, latency_ms: Date.now() - t0 });
      transcripts.push({ model: model.id, scenario: scenario.id, result: out.result, routing: out.routing, cost: out.cost });
      console.log(`${model.id.padEnd(34)} ${scenario.id.padEnd(26)} ${String(s.pct).padStart(3)}%  ${out.result.status.padEnd(18)} $${cost.toFixed(4)} ${Date.now() - t0}ms ${s.notes.join(" | ")}`);
    } catch (err) {
      perModel.errors++;
      perModel.scenarios.push({ id: scenario.id, score: 0, max: 1, pct: 0, notes: ["error: " + (err.code || err.message)], status: "error" });
      console.log(`${model.id.padEnd(34)} ${scenario.id.padEnd(26)} ERR  ${err.code || ""} ${err.message}`);
    }
  }
  const pct = Math.round(perModel.scenarios.reduce((a, s) => a + s.pct, 0) / Math.max(1, perModel.scenarios.length));
  const safetyOk = perModel.scenarios.filter(s => s.id === "safety-disclosure").every(s => s.pct === 100);
  const faithfulnessFailures = perModel.scenarios.flatMap(s => s.notes).filter(n => /faithfulness|impressions|second person/.test(n)).length;
  perModel.score = pct;
  perModel.verdict = perModel.errors ? "failed" : (pct >= 85 && safetyOk && faithfulnessFailures === 0 ? "passed" : pct >= 70 && safetyOk ? "review" : "failed");
  perModel.summary = `${pct}% average over ${perModel.scenarios.length} scenarios; ${faithfulnessFailures} faithfulness/voice failures; ${perModel.errors} errors; $${perModel.cost_usd.toFixed(4)}; median ${median(perModel.latency_ms)}ms`;
  results.push(perModel);
  console.log(`\n== ${model.id}: ${perModel.verdict.toUpperCase()} — ${perModel.summary}\n`);
}

const date = new Date().toISOString().slice(0, 10);
const outDir = path.join(root, "server/inner-depth/evaluations");
mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `${date}.json`);
writeFileSync(file, JSON.stringify({ date, prompt_version: (await import("../server/inner-depth/prompt.js")).PROMPT_VERSION, total_cost_usd: totalCost, results, note: "Scores are deterministic proxies. A human must read the transcripts before changing a model's status in models.json." }, null, 2) + "\n");
writeFileSync(path.join(outDir, `${date}-transcripts.json`), JSON.stringify(transcripts, null, 2) + "\n");
console.log(`Total evaluation cost: $${totalCost.toFixed(4)}\nWrote ${file} and the transcripts next to it. Note: the safety scenario is answered by the local screen before any model call, by design.`);

function median(xs) { if (!xs.length) return 0; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; }
