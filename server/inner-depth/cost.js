// Cost estimates and session budgets. Estimates use catalog pricing, a conservative token estimate
// for the prompt, and the full output cap (reasoning tokens bill as output), so the real cost is
// almost always lower. Actual cost comes back from OpenRouter in usage.cost and is what the budget charges.
import { HttpError } from "./http.js";

// ~3.3 characters per token is conservative for English prose with JSON punctuation; non-Latin text is denser.
export function estimateTokens(text) {
  const s = String(text || "");
  let nonLatin = 0;
  for (const ch of s) if (ch.codePointAt(0) > 0x24f) nonLatin++;
  return Math.ceil((s.length - nonLatin) / 3.3 + nonLatin / 1.2);
}

export function estimateRequestCost({ model, instructions, input, maxOutputTokens }) {
  if (!model || !model.pricing) return null;
  const inputTokens = estimateTokens(instructions) + estimateTokens(input) + 50;
  const maxCost = inputTokens * model.pricing.prompt + maxOutputTokens * model.pricing.completion;
  // Typical cost assumes a third of the output cap is actually used; shown as "estimate", never as actual.
  const typicalCost = inputTokens * model.pricing.prompt + Math.round(maxOutputTokens / 3) * model.pricing.completion;
  return { input_tokens: inputTokens, max_output_tokens: maxOutputTokens, typical_usd: round(typicalCost), max_usd: round(maxCost) };
}

export function round(usd) { return Math.round(usd * 1e6) / 1e6; }

// Budget bookkeeping lives in the rate-limit store keyed by the client's random session id.
// Amounts are stored in micro-dollars because the store only does integer increments.
const MICRO = 1e6;
const SESSION_TTL = 12 * 3600;

export async function reserveBudget({ store, config, sessionId, facilitatorId, estimate, budgetUsd, now = Date.now() }) {
  const cap = Math.min(budgetUsd || config.maxSessionCostUsd, config.maxSessionCostUsd);
  if (estimate && estimate.max_usd > config.maxRequestCostUsd) {
    throw new HttpError(422, "request_too_expensive", `This request could cost up to $${estimate.max_usd.toFixed(3)}, above the per-request limit of $${config.maxRequestCostUsd.toFixed(2)}. Choose a cheaper model or shorten the notes.`);
  }
  const count = await store.incr(`innerdepth:sess:n:${facilitatorId}:${sessionId}`, SESSION_TTL, now);
  if (count > config.maxRequestsPerSession) throw new HttpError(429, "session_request_limit", `This session has used its ${config.maxRequestsPerSession} AI requests. Finish with what you have or start a new session.`);
  const spent = (await store.incrBy(`innerdepth:sess:usd:${facilitatorId}:${sessionId}`, 0, SESSION_TTL, now)) / MICRO;
  const projected = spent + (estimate ? estimate.max_usd : 0);
  if (projected > cap) {
    throw new HttpError(402, "session_budget", `This request could bring the session to $${projected.toFixed(3)}, above the session budget of $${cap.toFixed(2)}. Raise the budget (up to $${config.maxSessionCostUsd.toFixed(2)}) or use the local organizer.`, { body: { spent_usd: round(spent), budget_usd: cap } });
  }
  const dayMicro = await store.incrBy(`innerdepth:usd:day:${Math.floor(now / 86400000)}`, 0, 86400 + 60, now);
  if (dayMicro / MICRO + (estimate ? estimate.max_usd : 0) > config.dailyCostCapUsd) {
    throw new HttpError(503, "daily_cost_cap", "The AI organizer has reached today's spending cap. Use the local organizer.", { retryAfter: 3600 });
  }
  return { count, spent_usd: round(spent), budget_usd: cap };
}

export async function recordSpend({ store, sessionId, facilitatorId, usd, now = Date.now() }) {
  const micro = Math.round((usd || 0) * MICRO);
  const total = await store.incrBy(`innerdepth:sess:usd:${facilitatorId}:${sessionId}`, micro, SESSION_TTL, now);
  await store.incrBy(`innerdepth:usd:day:${Math.floor(now / 86400000)}`, micro, 86400 + 60, now);
  return round(total / MICRO);
}

export async function sessionSpend({ store, sessionId, facilitatorId, now = Date.now() }) {
  const micro = await store.incrBy(`innerdepth:sess:usd:${facilitatorId}:${sessionId}`, 0, SESSION_TTL, now);
  return round(micro / MICRO);
}
