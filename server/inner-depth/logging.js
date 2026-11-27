// Logging that can never leak a note. Only event names, codes, counts, durations and model ids.
// Set INNER_DEPTH_LOG=silent to turn it off entirely.
const SAFE_KEYS = new Set(["event", "status", "code", "ms", "model", "provider", "tier", "task", "attempt", "facilitator", "tokens_in", "tokens_out", "tokens_reasoning", "cost_usd", "themes", "rejected", "mode", "escalated", "reason", "selector", "catalog"]);

export function log(fields) {
  if (process.env.INNER_DEPTH_LOG === "silent") return;
  const out = {};
  for (const [k, v] of Object.entries(fields)) {
    if (!SAFE_KEYS.has(k)) continue;
    if (typeof v === "string" && v.length > 120) continue;   // nothing long enough to be content
    out[k] = v;
  }
  out.t = new Date().toISOString();
  process.stdout.write(JSON.stringify(out) + "\n");
}
