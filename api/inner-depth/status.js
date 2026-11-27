// GET /api/inner-depth/status — is the AI organizer available, under what terms, with which models?
// Public (no facilitator code): it reveals no secrets, only the configuration the consent screen must show.
import { loadConfig, readinessProblem } from "../../server/inner-depth/config.js";
import { sendJson, sendError, checkOrigin, corsHeaders, handlePreflight, HttpError } from "../../server/inner-depth/http.js";
import { getCatalog } from "../../server/inner-depth/catalog.js";
import { describeModels, registryIds } from "../../server/inner-depth/registry.js";
import { SAFETY } from "../../server/inner-depth/safety.js";
import { PROMPT_VERSION } from "../../server/inner-depth/prompt.js";

export default async function handler(req, res, deps = {}) {
  const config = deps.config || loadConfig();
  if (handlePreflight(req, res, config)) return;
  try {
    if (req.method !== "GET") throw new HttpError(405, "method_not_allowed", "Use GET.");
    // GET requests from a page carry Origin only cross-origin; same-origin GETs may omit it. Accept both.
    if (req.headers.origin) corsHeaders(res, checkOrigin(req, config));
    const problem = readinessProblem(config);
    const { snapshot, source } = await getCatalog(config, registryIds(), { fetchImpl: deps.fetchImpl });
    const models = describeModels(snapshot, config).map(m => ({
      id: m.id, display_name: m.display_name, tier: m.tier, status: m.status, eligible: m.eligible, reasons: m.reasons,
      pricing_per_million: m.pricing ? { prompt: round(m.pricing.prompt * 1e6), completion: round(m.pricing.completion * 1e6) } : null,
      zdr_providers: m.zdr_providers, evaluation: m.evaluation, notes: m.notes
    }));
    sendJson(res, 200, {
      enabled: problem === null,
      reason: problem,
      mode: config.mode,                                  // "live" or "mock" (never mock in production)
      production: config.production,
      provider: "OpenRouter",
      routing_mode_default: config.routingMode,
      tier_selector: config.tierSelector,
      models,
      catalog_source: source,
      catalog_fetched_at: snapshot.fetched_at || null,
      limits: { max_session_cost_usd: config.maxSessionCostUsd, max_requests_per_session: config.maxRequestsPerSession, max_request_cost_usd: config.maxRequestCostUsd, max_attempts: config.maxAttempts },
      privacy: {
        zdr_required: true,
        data_collection: "deny",
        safety_retention_allowed: config.allowSafetyRetention,
        // Honest statement for the consent screen. ZDR covers routine retention; CSAM screening and legal holds are outside it.
        retention_statement: config.allowSafetyRetention
          ? "Requests are routed through OpenRouter to model providers. Where possible they go to Zero Data Retention endpoints; some endpoints may keep data temporarily to detect abuse (Safety Retention). No provider in the allowed pool trains on this data. OpenRouter itself does not keep prompts or responses after processing except where law requires."
          : "Requests are routed through OpenRouter only to Zero Data Retention endpoints: the model provider does not keep the notes after answering and does not train on them. OpenRouter itself does not keep prompts or responses after processing except where law requires. Nothing is stored by this server."
      },
      safety_version: SAFETY.version,
      prompt_version: PROMPT_VERSION
    });
  } catch (err) {
    sendError(res, err);
  }
}

function round(n) { return Math.round(n * 1000) / 1000; }
