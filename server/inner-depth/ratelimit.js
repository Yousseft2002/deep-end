// Rate limits, spending counters and auth throttling. Fixed windows keyed by facilitator (and by IP
// for auth attempts). The in-memory store is per function instance, so it is best-effort on serverless
// hosts; set UPSTASH_REDIS_REST_URL/TOKEN for a shared store. Also set a hard credit limit on the
// OpenRouter key itself: that is the control that cannot be bypassed by a bug here.
import { HttpError } from "./http.js";

export class MemoryStore {
  constructor() { this.map = new Map(); }
  async incr(key, ttlSeconds, now = Date.now()) { return this.incrBy(key, 1, ttlSeconds, now); }
  async incrBy(key, amount, ttlSeconds, now = Date.now()) {
    const hit = this.map.get(key);
    if (hit && hit.expires > now) { hit.count += amount; return hit.count; }
    this.map.set(key, { count: amount, expires: now + ttlSeconds * 1000 });
    if (this.map.size > 5000) for (const [k, v] of this.map) if (v.expires <= now) this.map.delete(k);
    return amount;
  }
}

export class UpstashStore {
  constructor(url, token) { this.url = url.replace(/\/$/, ""); this.token = token; }
  async incr(key, ttlSeconds) { return this.incrBy(key, 1, ttlSeconds); }
  async incrBy(key, amount, ttlSeconds) {
    const res = await fetch(this.url + "/pipeline", {
      method: "POST",
      headers: { Authorization: "Bearer " + this.token, "Content-Type": "application/json" },
      body: JSON.stringify([["INCRBY", key, amount], ["EXPIRE", key, ttlSeconds, "NX"]])
    });
    if (!res.ok) throw new Error("rate limit store unavailable");
    const data = await res.json();
    return Number(data[0].result);
  }
}

let shared;
export function storeFor(config) {
  if (shared) return shared;
  shared = config.upstashUrl && config.upstashToken ? new UpstashStore(config.upstashUrl, config.upstashToken) : new MemoryStore();
  return shared;
}
export function resetStore() { shared = undefined; }

function windowKey(prefix, id, seconds, now) {
  return `innerdepth:${prefix}:${id}:${Math.floor(now / 1000 / seconds)}`;
}

// Throws 429 when any window is exhausted. Counts the request first so a burst cannot slip past.
export async function enforceLimits({ store, config, facilitatorId, now = Date.now() }) {
  const minute = await store.incr(windowKey("m", facilitatorId, 60, now), 70, now);
  if (minute > config.perMinute) throw new HttpError(429, "rate_limited", "Too many requests in a minute. Wait a moment and try again.", { retryAfter: 60 });
  const day = await store.incr(windowKey("d", facilitatorId, 86400, now), 86400 + 60, now);
  if (day > config.perDay) throw new HttpError(429, "daily_limit", "This facilitator code has reached its daily limit.", { retryAfter: 3600 });
  const global = await store.incr(windowKey("g", "all", 86400, now), 86400 + 60, now);
  if (global > config.dailyCap) throw new HttpError(503, "spending_cap", "The AI organizer has reached today's request cap. Use the local organizer.", { retryAfter: 3600 });
  return { minute, day, global };
}

// Brute-force protection for the access code: at most 40 authentication attempts per IP per 10 minutes,
// counted before the code is compared so guessing is throttled whether or not it succeeds.
export async function countAuthAttempt(store, ip, now = Date.now()) {
  const n = await store.incr(windowKey("auth", ip, 600, now), 660, now);
  if (n > 40) throw new HttpError(429, "too_many_attempts", "Too many access attempts from this connection. Try again later.", { retryAfter: 600 });
  return n;
}
