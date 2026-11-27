// OpenRouter catalog: fetch, summarize and cache the non-sensitive model metadata the router needs
// (capabilities, pricing, ZDR endpoints). A committed snapshot (catalog-snapshot.json) is the fallback
// when the live catalog cannot be fetched, so routing never depends on the catalog being reachable.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const snapshotFile = fileURLToPath(new URL("./catalog-snapshot.json", import.meta.url));

export function summarizeCatalog(models, zdrEndpoints, ids) {
  const wanted = new Set(ids);
  const out = { models: {} };
  for (const m of models) {
    if (!wanted.has(m.id)) continue;
    const sp = m.supported_parameters || [];
    out.models[m.id] = {
      id: m.id,
      name: m.name,
      canonical_slug: m.canonical_slug || null,
      context_length: m.context_length || null,
      max_completion_tokens: (m.top_provider && m.top_provider.max_completion_tokens) || null,
      pricing: { prompt: Number(m.pricing && m.pricing.prompt) || 0, completion: Number(m.pricing && m.pricing.completion) || 0 },
      structured_outputs: sp.includes("structured_outputs"),
      response_format: sp.includes("response_format"),
      reasoning: sp.includes("reasoning"),
      supported_efforts: (m.reasoning && m.reasoning.supported_efforts) || null,
      zdr_providers: [],
      safety_retention_providers: [],
      zdr_endpoint_pricing: []
    };
  }
  for (const e of zdrEndpoints || []) {
    const s = out.models[e.model_id];
    if (!s) continue;
    const sp = e.supported_parameters || [];
    const structured = sp.includes("structured_outputs") || sp.includes("response_format");
    const bucket = e.safety_retention ? s.safety_retention_providers : s.zdr_providers;
    if (!bucket.includes(e.provider_name)) bucket.push(e.provider_name);
    s.zdr_endpoint_pricing.push({ provider: e.provider_name, safety_retention: !!e.safety_retention, structured, reasoning: sp.includes("reasoning"), prompt: Number(e.pricing && e.pricing.prompt) || 0, completion: Number(e.pricing && e.pricing.completion) || 0 });
  }
  return out;
}

// Compares what the registry claims with what the catalog says now.
export function verifyRegistryAgainstCatalog(registry, snapshot) {
  return registry.models.map(entry => {
    const s = snapshot.models[entry.id];
    const problems = [];
    if (!s) return { id: entry.id, status: entry.status, problems: ["not in catalog"] };
    if (entry.capabilities_verified.structured_outputs && !s.structured_outputs) problems.push("structured_outputs no longer listed");
    if (entry.capabilities_verified.reasoning && !s.reasoning) problems.push("reasoning no longer listed");
    const claimed = entry.privacy.zdr_providers_verified || [];
    const missing = claimed.filter(p => !s.zdr_providers.includes(p));
    if (missing.length) problems.push("ZDR providers gone: " + missing.join(", "));
    if (entry.status === "approved" && !s.zdr_providers.length && !entry.privacy.safety_retention_only) problems.push("no ZDR endpoint");
    if (entry.status === "excluded" && s.zdr_providers.length && !claimed.length) problems.push("now has ZDR endpoints: " + s.zdr_providers.join(", ") + " (consider re-evaluating)");
    return { id: entry.id, status: entry.status, problems };
  });
}

let cache = { at: 0, snapshot: null, source: null };

export function loadSnapshot() {
  return JSON.parse(readFileSync(snapshotFile, "utf8"));
}

// Live catalog with in-memory TTL, falling back to the committed snapshot. Never throws.
export async function getCatalog(config, ids, { fetchImpl = fetch, now = Date.now() } = {}) {
  if (cache.snapshot && now - cache.at < config.catalogTtlMs) return cache;
  try {
    const [models, zdr] = await Promise.all([
      fetchImpl(config.baseUrl + "/models", { signal: AbortSignal.timeout(8000) }).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); }),
      fetchImpl(config.baseUrl + "/endpoints/zdr", { signal: AbortSignal.timeout(8000) }).then(r => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
    ]);
    const snapshot = summarizeCatalog(models.data, zdr.data, ids);
    snapshot.fetched_at = new Date(now).toISOString();
    cache = { at: now, snapshot, source: "live" };
  } catch {
    if (!cache.snapshot) cache = { at: now, snapshot: loadSnapshot(), source: "snapshot" };
    else cache.at = now;  // keep the stale live copy a little longer rather than hammering the catalog
  }
  return cache;
}

export function resetCatalogCache() { cache = { at: 0, snapshot: null, source: null }; }
