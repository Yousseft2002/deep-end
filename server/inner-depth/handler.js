// Shared request handling for the Inner Depth functions: method, origin, preflight, body, auth, limits.
import { loadConfig, readinessProblem } from "./config.js";
import { HttpError, sendJson, sendError, readJsonBody, checkOrigin, corsHeaders, handlePreflight, clientIp } from "./http.js";
import { authenticate } from "./auth.js";
import { storeFor, enforceLimits, countAuthAttempt } from "./ratelimit.js";
import { log } from "./logging.js";

// Wraps a handler body with everything every authenticated POST endpoint needs.
export function protectedPost(run) {
  return async function handler(req, res, deps = {}) {
    const config = deps.config || loadConfig();
    const store = deps.store || storeFor(config);
    if (handlePreflight(req, res, config)) return;
    try {
      if (req.method !== "POST") throw new HttpError(405, "method_not_allowed", "Use POST.");
      const origin = checkOrigin(req, config);
      corsHeaders(res, origin);
      const problem = readinessProblem(config);
      if (problem) throw new HttpError(503, "ai_unavailable", unavailableMessage(problem), { body: { reason: problem } });
      await countAuthAttempt(store, clientIp(req));
      const facilitator = authenticate(req, config);
      await enforceLimits({ store, config, facilitatorId: facilitator.id });
      const body = await readJsonBody(req, config.maxBodyBytes);
      const result = await run({ body, config, store, facilitator, fetchImpl: deps.fetchImpl });
      sendJson(res, 200, result);
    } catch (err) {
      if (!(err instanceof HttpError)) log({ event: "unhandled", code: err && err.code, reason: err && err.name });
      else log({ event: "rejected", status: err.status, code: err.code });
      sendError(res, err);
    }
  };
}

export function unavailableMessage(problem) {
  return {
    disabled: "The AI organizer is switched off on this server. Use the local organizer.",
    mock_refused_in_production: "The server is misconfigured (mock mode in production). The AI organizer is unavailable.",
    missing_api_key: "The server has no OpenRouter key configured. The AI organizer is unavailable.",
    no_facilitator_keys: "No facilitator access codes are configured on the server."
  }[problem] || "The AI organizer is unavailable.";
}
