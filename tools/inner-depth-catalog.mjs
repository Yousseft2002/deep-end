#!/usr/bin/env node
// Refreshes the non-sensitive OpenRouter catalog snapshot for the models in the registry.
// Public endpoints, no API key needed. Writes server/inner-depth/catalog-snapshot.json and prints a
// verification table so a human can see which registry claims still hold (structured outputs,
// reasoning, ZDR endpoints, pricing).
//
//   node tools/inner-depth-catalog.mjs            # refresh snapshot
//   node tools/inner-depth-catalog.mjs --check    # only compare, do not write
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { summarizeCatalog, verifyRegistryAgainstCatalog } from "../server/inner-depth/catalog.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const registryPath = root + "server/inner-depth/models.json";
const snapshotPath = root + "server/inner-depth/catalog-snapshot.json";
const base = process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1";
const check = process.argv.includes("--check");

const registry = JSON.parse(readFileSync(registryPath, "utf8"));
const ids = registry.models.map(m => m.id);

const [models, zdr] = await Promise.all([
  fetch(base + "/models").then(r => { if (!r.ok) throw new Error("models " + r.status); return r.json(); }),
  fetch(base + "/endpoints/zdr").then(r => { if (!r.ok) throw new Error("endpoints/zdr " + r.status); return r.json(); })
]);

const snapshot = summarizeCatalog(models.data, zdr.data, ids);
snapshot.fetched_at = new Date().toISOString();
const report = verifyRegistryAgainstCatalog(registry, snapshot);

console.log("model".padEnd(36), "SO", "RF", "RS", "ZDR providers".padEnd(40), "in $/M", "out $/M", "status");
for (const r of report) {
  const s = snapshot.models[r.id];
  console.log(r.id.padEnd(36), s && s.structured_outputs ? "yes" : "no ", s && s.response_format ? "yes" : "no ", s && s.reasoning ? "yes" : "no ",
    (s ? s.zdr_providers.join(", ") : "(not in catalog)").slice(0, 40).padEnd(40),
    s ? (s.pricing.prompt * 1e6).toFixed(2).padStart(6) : "", s ? (s.pricing.completion * 1e6).toFixed(2).padStart(7) : "", r.problems.length ? "CHECK: " + r.problems.join("; ") : "ok");
}
if (!check) {
  writeFileSync(snapshotPath, JSON.stringify(snapshot, null, 2) + "\n");
  console.log("\nwrote", snapshotPath);
}
process.exitCode = report.some(r => r.problems.length && r.status === "approved") ? 1 : 0;
