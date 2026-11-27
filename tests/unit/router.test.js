import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessSession, complexityScore, chooseTier, chooseModels } from "../../server/inner-depth/router.js";
import { normalizeSession } from "../../server/inner-depth/session.js";
import { describeModels, eligibility, tierCandidates, resetRegistry, loadRegistry } from "../../server/inner-depth/registry.js";
import { loadSnapshot, summarizeCatalog, verifyRegistryAgainstCatalog } from "../../server/inner-depth/catalog.js";
import { loadConfig } from "../../server/inner-depth/config.js";
import { classifyRequest } from "../../server/inner-depth/pipeline.js";

const scenarios = JSON.parse(readFileSync(new URL("../fixtures/scenarios.json", import.meta.url), "utf8")).scenarios;
const by = id => normalizeSession(structuredClone(scenarios.find(s => s.id === id).session));
const config = loadConfig({ INNER_DEPTH_AI_ENABLED: "true", OPENROUTER_API_KEY: "k", INNER_DEPTH_FACILITATOR_KEYS: "f:0123456789abcdef" });
const snapshot = loadSnapshot();
const models = describeModels(snapshot, config);

test("structural signals: multilingual, fragments, contradictions, cross-answer links", () => {
  const multi = assessSession(by("multilingual-fragments"));
  assert.equal(multi.multilingual, true);
  assert.ok(multi.scripts.includes("arabic") && multi.scripts.includes("latin"));
  assert.ok(multi.fragmented_answers >= 3);
  const contra = assessSession(by("contradictory-answers"));
  assert.ok(contra.contradiction_markers >= 1);
  const grief = assessSession(by("parent-grief"));
  assert.equal(grief.substantive_answers, 8);
  assert.ok(grief.shared_terms >= 2);
});

test("tier choice follows task and complexity, never participant content", () => {
  const grief = assessSession(by("parent-grief"));
  const t = chooseTier({ task: "organize", signals: grief, facilitatorMode: "adaptive" });
  assert.ok(["balanced", "advanced"].includes(t.tier));
  const multi = chooseTier({ task: "organize", signals: assessSession(by("multilingual-fragments")), facilitatorMode: "adaptive" });
  assert.ok(["balanced", "advanced"].includes(multi.tier), "multilingual fragments should not go to the fast tier");
  const thin = chooseTier({ task: "organize", signals: assessSession(by("insufficient")), facilitatorMode: "adaptive" });
  assert.equal(thin.tier, "fast");
  assert.equal(chooseTier({ task: "rewording", signals: grief, facilitatorMode: "adaptive" }).tier, "fast");
  assert.equal(chooseTier({ task: "explain_principles", signals: grief, facilitatorMode: "adaptive" }).tier, "balanced");
  assert.equal(chooseTier({ task: "organize", signals: grief, facilitatorMode: "deep" }).tier, "advanced");
  assert.notEqual(chooseTier({ task: "organize", signals: multi.signals || assessSession(by("multilingual-fragments")), facilitatorMode: "economy" }).tier, "advanced");
  assert.equal(chooseTier({ task: "organize", signals: grief, facilitatorMode: "adaptive", escalateFrom: "balanced" }).tier, "advanced");
  assert.equal(chooseTier({ task: "organize", signals: grief, facilitatorMode: "adaptive", escalateFrom: "advanced" }).tier, "advanced");
  assert.equal(chooseTier({ task: "organize", signals: grief, facilitatorMode: "adaptive", requestedTier: "fast" }).tier, "fast");
});

test("complexity score is bounded and explained", () => {
  const s = complexityScore(assessSession(by("parent-grief")));
  assert.ok(s.score >= 0 && s.score <= 10);
  assert.ok(Array.isArray(s.why));
});

test("registry eligibility: approved + ZDR + structured outputs; Fable and Gemini excluded", () => {
  const fable = models.find(m => m.id === "anthropic/claude-fable-5.2");
  assert.equal(fable.eligible, false);
  assert.ok(fable.reasons.some(r => /Zero Data Retention|excluded/.test(r)));
  const gemini = models.find(m => m.id === "google/gemini-3.1-pro-preview");
  assert.equal(gemini.eligible, false);
  const sonnet = models.find(m => m.id === "anthropic/claude-sonnet-5.5");
  assert.equal(sonnet.eligible, true);
  assert.ok(sonnet.zdr_providers.includes("Amazon Bedrock"));
  const candidate = models.find(m => m.id === "deepseek/deepseek-v4-pro");
  assert.equal(candidate.eligible, false, "candidates are not routed until approved");
});

test("a model that loses its ZDR endpoint or structured outputs becomes ineligible", () => {
  const entry = loadRegistry().models.find(m => m.id === "anthropic/claude-sonnet-5.5");
  const cat = structuredClone(snapshot.models[entry.id]);
  cat.zdr_providers = []; cat.safety_retention_providers = ["Google"];
  assert.equal(eligibility(entry, cat, config).eligible, false);
  assert.equal(eligibility(entry, cat, loadConfig({ INNER_DEPTH_ALLOW_SAFETY_RETENTION: "true" })).eligible, true);
  const cat2 = structuredClone(snapshot.models[entry.id]); cat2.structured_outputs = false; cat2.response_format = false;
  assert.equal(eligibility(entry, cat2, config).eligible, false);
  assert.equal(eligibility(entry, null, config).eligible, false);
});

test("tier candidates honour env overrides but ignore ineligible ids", () => {
  const c = loadConfig({ INNER_DEPTH_BALANCED_MODELS: "openai/gpt-6.2-sol,anthropic/claude-fable-5.2" });
  const list = tierCandidates(models, "balanced", c);
  assert.equal(list[0].id, "openai/gpt-6.2-sol");
  assert.ok(!list.some(m => m.id === "anthropic/claude-fable-5.2"));
});

test("chooseModels: registry selection, manual checks, auto plugin, no silent upgrade", () => {
  const pick = chooseModels({ tier: "balanced", models, config });
  assert.equal(pick.selector, "registry");
  assert.equal(pick.primary.tier, "balanced");
  assert.ok(pick.fallbacks.length <= 2);
  const manualBad = chooseModels({ tier: "fast", models, config, manualModelId: "anthropic/claude-fable-5.2" });
  assert.equal(manualBad.error, "model_ineligible");
  assert.equal(chooseModels({ tier: "fast", models, config, manualModelId: "nope/none" }).error, "unknown_model");
  const auto = chooseModels({ tier: "fast", models, config: loadConfig({ INNER_DEPTH_TIER_SELECTOR: "openrouter-auto" }) });
  assert.equal(auto.selector, "openrouter-auto");
  assert.ok(auto.auto.every(id => models.find(m => m.id === id).tier === "fast"));
  // When a tier is empty we step down before stepping up.
  const only = models.map(m => ({ ...m, eligible: m.tier === "balanced" && m.eligible }));
  const demoted = chooseModels({ tier: "advanced", models: only, config });
  assert.equal(demoted.tier, "balanced"); assert.equal(demoted.demoted, true);
});

test("catalog summary and registry verification detect drift", () => {
  const fake = summarizeCatalog([{ id: "x/y", name: "Y", pricing: { prompt: "0.000001", completion: "0.000002" }, supported_parameters: ["response_format"], context_length: 1000, top_provider: {} }], [{ model_id: "x/y", provider_name: "P", pricing: { prompt: "0.000001", completion: "0.000002" }, supported_parameters: ["response_format", "structured_outputs"], safety_retention: false }], ["x/y"]);
  assert.deepEqual(fake.models["x/y"].zdr_providers, ["P"]);
  const report = verifyRegistryAgainstCatalog({ models: [{ id: "x/y", status: "approved", capabilities_verified: { structured_outputs: true, reasoning: true }, privacy: { zdr_providers_verified: ["Q"] } }] }, fake);
  assert.ok(report[0].problems.some(p => /reasoning no longer/.test(p)) && report[0].problems.some(p => /ZDR providers gone: Q/.test(p)));
  resetRegistry();
});

test("facilitator requests are classified by shape", () => {
  assert.equal(classifyRequest("Can you make this reflection gentler?"), "rewording");
  assert.equal(classifyRequest("What might be a good non-leading follow-up question?"), "follow_up");
  assert.equal(classifyRequest("Can you expand on the connection between answers two and five?"), "synthesis");
  assert.equal(classifyRequest("How do Rogers' teachings relate to this without labelling the participant?"), "explain_principles");
  assert.equal(classifyRequest("What did they say about the garden?"), "clarification");
});
