// Model registry: which models may receive participant notes, at which tier, under what privacy
// conditions. Approval is a human decision recorded in models.json; eligibility is re-checked at
// runtime against the catalog so a model that loses its ZDR endpoint or structured-output support
// silently drops out instead of silently weakening privacy.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { TIERS } from "./config.js";

const registryFile = fileURLToPath(new URL("./models.json", import.meta.url));
const evalDir = fileURLToPath(new URL("./evaluations/", import.meta.url));

let registryCache;
export function loadRegistry() {
  if (registryCache) return registryCache;
  const registry = JSON.parse(readFileSync(registryFile, "utf8"));
  // Merge evaluation results (written by tools/inner-depth-eval.mjs) so the facilitator UI can show them.
  const evaluations = {};
  if (existsSync(evalDir)) {
    for (const f of readdirSync(evalDir).filter(f => f.endsWith(".json")).sort()) {
      try {
        const data = JSON.parse(readFileSync(path.join(evalDir, f), "utf8"));
        for (const r of data.results || []) evaluations[r.model] = { status: r.verdict, date: data.date, score: r.score, summary: r.summary, file: f };
      } catch { /* a bad eval file must not break routing */ }
    }
  }
  for (const m of registry.models) if (evaluations[m.id]) m.evaluation = { ...m.evaluation, ...evaluations[m.id] };
  registryCache = registry;
  return registry;
}
export function resetRegistry() { registryCache = undefined; }

export function registryIds() { return loadRegistry().models.map(m => m.id); }

// Eligibility of one registry entry given the current catalog and privacy policy.
export function eligibility(entry, catalogModel, config) {
  const reasons = [];
  if (entry.status !== "approved") reasons.push(entry.status === "excluded" ? "excluded: " + (entry.notes || "") : "not yet approved (status: " + entry.status + ")");
  if (!catalogModel) reasons.push("not in the current OpenRouter catalog");
  else {
    if (!catalogModel.structured_outputs && !catalogModel.response_format) reasons.push("no structured output support listed");
    const zdr = catalogModel.zdr_providers.length > 0;
    const sr = catalogModel.safety_retention_providers.length > 0;
    if (!zdr && !(sr && config.allowSafetyRetention)) reasons.push(zdr || sr ? "only Safety Retention endpoints and INNER_DEPTH_ALLOW_SAFETY_RETENTION is off" : "no Zero Data Retention endpoint");
    const structuredPrivate = catalogModel.zdr_endpoint_pricing.some(e => e.structured && (!e.safety_retention || config.allowSafetyRetention));
    if ((zdr || sr) && !structuredPrivate) reasons.push("no privacy-eligible endpoint supports structured outputs");
  }
  return { eligible: reasons.length === 0, reasons };
}

// All registry entries with live eligibility, for routing and for the facilitator's model list.
export function describeModels(catalog, config) {
  const registry = loadRegistry();
  return registry.models.map(entry => {
    const cat = catalog.models[entry.id] || null;
    const e = eligibility(entry, cat, config);
    const pricing = cat ? privatePricing(cat, config) : null;
    return {
      id: entry.id,
      display_name: entry.display_name,
      tier: TIERS.includes(entry.tier) ? entry.tier : "balanced",
      status: entry.status,
      eligible: e.eligible,
      reasons: e.reasons,
      pricing,                                   // $ per token on privacy-eligible endpoints (max seen), for estimates
      context_length: cat ? cat.context_length : null,
      max_completion_tokens: cat ? cat.max_completion_tokens : null,
      supported_efforts: cat ? cat.supported_efforts : null,
      reasoning_effort: entry.reasoning_effort || null,
      zdr_providers: cat ? cat.zdr_providers : [],
      safety_retention_providers: cat ? cat.safety_retention_providers : [],
      evaluation: entry.evaluation || { status: "pending" },
      notes: entry.notes || null
    };
  });
}

// Worst-case price among the endpoints the request may be routed to, so estimates do not undershoot.
function privatePricing(cat, config) {
  const eligible = cat.zdr_endpoint_pricing.filter(e => e.structured && (!e.safety_retention || config.allowSafetyRetention));
  const pool = eligible.length ? eligible : [{ prompt: cat.pricing.prompt, completion: cat.pricing.completion }];
  return { prompt: Math.max(...pool.map(e => e.prompt)), completion: Math.max(...pool.map(e => e.completion)) };
}

// Ordered candidate list for a tier: env override first (only eligible ids), then registry order.
export function tierCandidates(models, tier, config) {
  const eligible = models.filter(m => m.eligible);
  const override = (config.tierModels[tier] || []).map(id => eligible.find(m => m.id === id)).filter(Boolean);
  const defaults = eligible.filter(m => m.tier === tier && !override.includes(m));
  return [...override, ...defaults];
}
