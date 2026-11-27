// Loads the curated reference library (library/psychology/*.json) and formats it for the model.
// The whole library is small enough to send as context; retrieval can come later if it grows.
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = fileURLToPath(new URL("../../library/psychology/", import.meta.url));
let cache;

export function loadLibrary() {
  if (cache) return cache;
  const entries = [];
  for (const file of readdirSync(dir).filter(f => f.endsWith(".json")).sort()) {
    const data = JSON.parse(readFileSync(path.join(dir, file), "utf8"));
    if (!Array.isArray(data)) throw new Error(`${file}: expected an array of entries`);
    for (const entry of data) entries.push({ ...entry, file });
  }
  const ids = new Set();
  for (const e of entries) {
    if (ids.has(e.id)) throw new Error(`duplicate library id ${e.id}`);
    ids.add(e.id);
  }
  cache = { entries, ids };
  return cache;
}

export function principleIds() { return loadLibrary().ids; }

export function principleById(id) { return loadLibrary().entries.find(e => e.id === id) || null; }

// Facilitator-facing view of a principle: enough to judge the wording, with the source visible.
export function principleSummary(id) {
  const e = principleById(id);
  if (!e) return null;
  return { id: e.id, thinker: e.thinker, concept: e.concept, summary: e.summary, source: e.source.citation, evidence_limitations: e.evidence_limitations };
}

// Compact text block for the model's instructions. Full entries are longer than the model needs.
export function libraryForPrompt() {
  return loadLibrary().entries.map(e =>
    `- id: ${e.id}\n  thinker: ${e.thinker}\n  concept: ${e.concept}\n  summary: ${e.summary}\n  use: ${e.appropriate_application}\n  never: ${e.inappropriate_application}\n  evidence: ${e.evidence_limitations}`
  ).join("\n");
}
