// Server-side configuration for the Inner Depth AI organizer (OpenRouter edition).
// Everything secret lives in environment variables on the function host, never in docs/,
// the repo, or the Capacitor bundle. See INNER-DEPTH-SETUP.md and .env.example.

function flag(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

function int(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function num(value, fallback, { min = 0, max = Number.MAX_VALUE } = {}) {
  const n = Number.parseFloat(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function list(value) {
  return String(value || "").split(",").map(s => s.trim()).filter(Boolean);
}

export const ROUTING_MODES = ["adaptive", "economy", "deep", "manual"];
export const TIERS = ["fast", "balanced", "advanced"];

// Production is any deployment a participant could actually reach. Mock generation is
// refused there: a facilitator must never read canned text believing a model wrote it.
export function isProduction(env = process.env) {
  if (env.VERCEL_ENV) return env.VERCEL_ENV === "production";
  return env.NODE_ENV === "production";
}

export function loadConfig(env = process.env) {
  const production = isProduction(env);
  const requestedMode = (env.INNER_DEPTH_AI_MODE || "live").trim().toLowerCase();
  const mode = requestedMode === "mock" && !production ? "mock" : "live";
  const routing = (env.INNER_DEPTH_ROUTING_MODE || "adaptive").trim().toLowerCase();
  // Facilitator keys: "label:secret" or "label:sha256:<hex of secret>", comma separated.
  const facilitatorKeys = list(env.INNER_DEPTH_FACILITATOR_KEYS).map(entry => {
    const i = entry.indexOf(":");
    if (i < 1) return null;
    const label = entry.slice(0, i).trim();
    let secret = entry.slice(i + 1).trim();
    let hashed = false;
    if (secret.startsWith("sha256:")) { hashed = true; secret = secret.slice(7).toLowerCase(); }
    if (!label || !secret) return null;
    if (!hashed && secret.length < 12) return null;  // refuse weak plaintext codes
    return { label, secret, hashed };
  }).filter(Boolean);
  return {
    production,
    enabled: flag(env.INNER_DEPTH_AI_ENABLED, false),
    mode,                                        // "live" | "mock" (mock only outside production)
    mockRefused: requestedMode === "mock" && production,

    // OpenRouter
    apiKey: env.OPENROUTER_API_KEY || "",
    baseUrl: (env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, ""),
    appUrl: env.INNER_DEPTH_APP_URL || "",      // sent as HTTP-Referer so the app shows up on the OpenRouter dashboard
    appTitle: "Deep End Inner Depth",

    // Routing
    routingMode: ROUTING_MODES.includes(routing) ? routing : "adaptive",
    tierSelector: (env.INNER_DEPTH_TIER_SELECTOR || "registry").trim().toLowerCase() === "openrouter-auto" ? "openrouter-auto" : "registry",
    tierModels: {
      fast: list(env.INNER_DEPTH_FAST_MODELS),
      balanced: list(env.INNER_DEPTH_BALANCED_MODELS),
      advanced: list(env.INNER_DEPTH_ADVANCED_MODELS)
    },
    allowManualModels: list(env.INNER_DEPTH_MANUAL_MODELS),
    maxAttempts: int(env.INNER_DEPTH_MAX_ATTEMPTS, 2, { min: 1, max: 3 }),   // first try + bounded retry/escalation
    allowEscalation: flag(env.INNER_DEPTH_ALLOW_ESCALATION, true),

    // Privacy routing. ZDR is always required; Safety Retention endpoints (e.g. Google Vertex) only when explicitly allowed.
    allowSafetyRetention: flag(env.INNER_DEPTH_ALLOW_SAFETY_RETENTION, false),
    catalogTtlMs: int(env.INNER_DEPTH_CATALOG_TTL_MS, 6 * 60 * 60 * 1000, { min: 60000, max: 7 * 86400000 }),

    // Cost and size controls
    maxOutputTokens: int(env.INNER_DEPTH_MAX_OUTPUT_TOKENS, 8000, { min: 800, max: 64000 }),
    maxSessionCostUsd: num(env.INNER_DEPTH_MAX_SESSION_COST_USD, 1.0, { min: 0.01, max: 100 }),
    maxRequestsPerSession: int(env.INNER_DEPTH_MAX_REQUESTS_PER_SESSION, 20, { min: 1, max: 200 }),
    maxRequestCostUsd: num(env.INNER_DEPTH_MAX_REQUEST_COST_USD, 0.5, { min: 0.005, max: 20 }),
    requestTimeoutMs: int(env.INNER_DEPTH_REQUEST_TIMEOUT_MS, 75000, { min: 5000, max: 290000 }),
    maxBodyBytes: int(env.INNER_DEPTH_MAX_BODY_BYTES, 96 * 1024, { min: 4096, max: 512 * 1024 }),

    // Access control and abuse limits
    facilitatorKeys,
    allowedOrigins: list(env.INNER_DEPTH_ALLOWED_ORIGINS),
    perMinute: int(env.INNER_DEPTH_RATE_LIMIT_PER_MINUTE, 8, { min: 1, max: 600 }),
    perDay: int(env.INNER_DEPTH_RATE_LIMIT_PER_DAY, 120, { min: 1, max: 100000 }),
    dailyCap: int(env.INNER_DEPTH_DAILY_REQUEST_CAP, 400, { min: 1, max: 1000000 }),
    dailyCostCapUsd: num(env.INNER_DEPTH_DAILY_COST_CAP_USD, 25, { min: 0.1, max: 10000 }),

    upstashUrl: env.UPSTASH_REDIS_REST_URL || "",
    upstashToken: env.UPSTASH_REDIS_REST_TOKEN || "",
    vercelUrl: env.VERCEL_URL || "",
    vercelProductionUrl: env.VERCEL_PROJECT_PRODUCTION_URL || ""
  };
}

// Why generation is unavailable, as a short machine-readable reason, or null when ready.
export function readinessProblem(config) {
  if (!config.enabled) return "disabled";
  if (config.mockRefused) return "mock_refused_in_production";
  if (config.mode === "live" && !config.apiKey) return "missing_api_key";
  if (!config.facilitatorKeys.length) return "no_facilitator_keys";
  return null;
}
