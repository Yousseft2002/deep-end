# Inner Depth AI organizer: setup, security and testing guide

Inner Depth's AI organizer lives in two places: the page in `docs/inner-depth.html` (static, no secrets)
and four serverless functions in `api/inner-depth/` (Node, run on Vercel or the local dev server) that
talk to OpenRouter. The page never holds a provider key. The functions never store a session.

```
docs/inner-depth.html + .js      browser: notes, consent, review, read-aloud (memory only)
docs/inner-depth-config.js       where the page finds the API (same-origin by default)
docs/inner-depth-safety.js       imminent-harm screen, shared by page and server
api/inner-depth/status.js        GET  availability, eligible models, retention statement
api/inner-depth/reflect.js       POST organize a reviewed adult session (also dry-run estimates)
api/inner-depth/regenerate.js    POST reword one theme
api/inner-depth/chat.js          POST facilitator-only assistant on the same temporary context
server/inner-depth/              config, auth, limits, session minimization, router, registry,
                                 catalog, cost, OpenRouter client, prompt, validation, mock, pipeline
server/inner-depth/models.json   model registry (approval is a human decision)
server/inner-depth/catalog-snapshot.json  non-sensitive OpenRouter catalog cache (committed)
server/inner-depth/evaluations/  results written by tools/inner-depth-eval.mjs (none yet)
library/psychology/*.json        reference library (original summaries, verified sources)
tools/inner-depth-dev-server.mjs local server: docs/ + /api/inner-depth/*
tools/inner-depth-smoke.mjs      real API smoke test with synthetic notes
tools/inner-depth-eval.mjs       synthetic evaluation suite across models
tools/inner-depth-catalog.mjs    refresh and verify the catalog snapshot
tests/unit, tests/integration, tests/browser, tests/fixtures/scenarios.json
```

## 1. Create the OpenRouter key safely

1. At <https://openrouter.ai/settings/keys> create a key **for this app only** and set a **credit limit**
   on the key (this is the one control that no bug in this code can bypass).
2. In <https://openrouter.ai/settings/privacy>, review the data-policy settings. The app sends
   `provider: { zdr: true, data_collection: "deny", require_parameters: true }` on every request, which
   can only tighten what the account allows. If you want strict ZDR only, turn off Safety Retention
   there as well; the app's default registry already refuses Safety-Retention-only models.
3. Put the key in the server environment only (next section). Never in `docs/`, never in a commit,
   never in the Capacitor build.

If you already have an OpenRouter key on this machine, set it as `OPENROUTER_API_KEY` in `.env.local`
(see `.env.example`). The repo ignores `.env.local`. Nothing in this project reads any other file for keys.

## 2. Configure the environment

Copy `.env.example` to `.env.local` (local) or add the same variables in Vercel → Project → Settings →
Environment Variables (production and preview separately).

Required:

| variable | purpose |
|---|---|
| `OPENROUTER_API_KEY` | server-side only |
| `INNER_DEPTH_AI_ENABLED` | `true` to offer the AI organizer at all |
| `INNER_DEPTH_FACILITATOR_KEYS` | `label:secret` (12+ chars) or `label:sha256:<hex>`, comma separated |

Routing: `INNER_DEPTH_ROUTING_MODE` (adaptive, economy, deep, manual), `INNER_DEPTH_TIER_SELECTOR`
(registry or openrouter-auto), `INNER_DEPTH_FAST_MODELS` / `INNER_DEPTH_BALANCED_MODELS` /
`INNER_DEPTH_ADVANCED_MODELS` (optional ordered overrides, approved ids only), `INNER_DEPTH_MAX_ATTEMPTS`,
`INNER_DEPTH_ALLOW_ESCALATION`.

Cost: `INNER_DEPTH_MAX_SESSION_COST_USD`, `INNER_DEPTH_MAX_REQUESTS_PER_SESSION`,
`INNER_DEPTH_MAX_REQUEST_COST_USD`, `INNER_DEPTH_DAILY_COST_CAP_USD`, `INNER_DEPTH_MAX_OUTPUT_TOKENS`,
`INNER_DEPTH_REQUEST_TIMEOUT_MS`.

Privacy: `INNER_DEPTH_ALLOW_SAFETY_RETENTION` (default false).

Abuse: `INNER_DEPTH_RATE_LIMIT_PER_MINUTE`, `INNER_DEPTH_RATE_LIMIT_PER_DAY`, `INNER_DEPTH_DAILY_REQUEST_CAP`,
`INNER_DEPTH_MAX_BODY_BYTES`, `INNER_DEPTH_ALLOWED_ORIGINS`, optional `UPSTASH_REDIS_REST_URL` /
`UPSTASH_REDIS_REST_TOKEN` so limits and budgets hold across serverless instances.

Generate a facilitator code and its hash:

```bash
node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"
node -e "console.log('sha256:'+require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" <the-code>
```

Give each facilitator their own labelled code; limits and spend are tracked per label (never the code).

## 3. Run locally

```bash
npm install
npm run dev:inner-depth          # http://localhost:8123, reads .env.local
```

Open <http://localhost:8123/inner-depth.html> in a phone-sized window. The game at `/index.html` is
unchanged and still works offline. Without `OPENROUTER_API_KEY` the AI button stays hidden and the page
says why; the local organizer always works.

For UI work without spending money, `INNER_DEPTH_AI_MODE=mock` returns deterministic stand-in text.
The page labels it **TEST MODE** everywhere, and the server refuses mock mode when `VERCEL_ENV` or
`NODE_ENV` is `production`. Never show mock output to a real participant.

## 4. Tests

```bash
npm run test:unit          # 52 tests: config, session minimization, validator, router, registry,
                           #           cost/budget, auth, origin, OpenRouter client, pipeline escalation
npm run test:integration   # 10 tests: real handlers over HTTP in mock mode (auth, consent, adults only,
                           #           injection, safety short-circuit, regenerate/chat, limits, CORS, SW shell)
npm run test:browser       # Playwright (chromium): home still works, full phone-size AI flow with
                           #           select/edit/regenerate/chat/readout/erase, teen exclusion, safety pause,
                           #           API error handling, HTML injection, wrong code
npm test                   # all three
```

Browser tests need `npx playwright install chromium` once.

### Real API smoke test (required before enabling for anyone)

```bash
OPENROUTER_API_KEY=... npm run smoke:inner-depth                       # adaptive routing
node tools/inner-depth-smoke.mjs --model anthropic/claude-haiku-5.5   # one model
node tools/inner-depth-smoke.mjs --scenario faith-and-culture --chat  # plus a chat turn
```

It prints the tier, the model and provider that actually answered, tokens, **actual cost**, validator
rejections and the themes. Exit code 0 only for a live, validated result. A mock pass is not proof.

### Model evaluation

```bash
node tools/inner-depth-eval.mjs --dry-run                # lists what would run
node tools/inner-depth-eval.mjs                          # all eligible + candidate models, 10 scenarios
node tools/inner-depth-eval.mjs --models deepseek/deepseek-v4.1-flash,anthropic/claude-haiku-5.5
```

Writes `server/inner-depth/evaluations/<date>.json` (scores) and `<date>-transcripts.json` (full
output). The registry merges the scores into each model's `evaluation` field, which the facilitator sees
in AI settings. Scores are deterministic proxies for faithfulness, voice, labels, uncertainty, safety and
schema adherence; **read the transcripts** before changing a model's status in `models.json`.

### Catalog refresh

```bash
node tools/inner-depth-catalog.mjs          # refresh server/inner-depth/catalog-snapshot.json
node tools/inner-depth-catalog.mjs --check  # verify registry claims (exit 1 if an approved model drifted)
```

At runtime the server fetches the live catalog (public endpoints, cached 6 h) and falls back to the
snapshot. A model that loses its ZDR endpoint or structured-output support becomes ineligible automatically.

## 5. Deploy (preview only until approved)

The repo has a `vercel.json` that serves `docs/` as the static site and `api/` as functions, so the API
is same-origin and the page's CSP (`connect-src 'self'`) needs no change.

1. Import the GitHub repo into Vercel; set the environment variables for **Preview** first.
2. Every push to `feature/inner-depth` creates a preview URL. Run the smoke test against it by setting
   `OPENROUTER_BASE_URL` unchanged and opening the preview page with a facilitator code.
3. Do not promote to production or point GitHub Pages at the API until the owner approves.

To keep GitHub Pages as the public site and only host the API on Vercel: set `base` in
`docs/inner-depth-config.js` to the Vercel origin, add that origin to `connect-src` in
`docs/inner-depth.html`, and list `https://<user>.github.io` (and `capacitor://localhost`,
`https://localhost` for store builds) in `INNER_DEPTH_ALLOWED_ORIGINS`.

## 6. What the server enforces on every request

- Facilitator bearer code (constant-time compare, 40 attempts per IP per 10 min).
- Origin check: same-origin or allowlist; CORS headers only for allowed origins.
- Adults only, both consents present, size limits, id format, duplicate ids, schema version.
- Identifier redaction (emails, phones, links, handles, long numbers) before the model sees the text.
- Local imminent-harm screen before any model call; a match returns support guidance and costs nothing.
- Per-facilitator minute/day limits, global daily request and cost caps, per-session request count,
  per-session budget (facilitator may lower it, never raise it above the server cap), per-request cost cap.
- OpenRouter request: strict `json_schema`, `provider.zdr: true`, `data_collection: "deny"`,
  `require_parameters: true`, no tools or plugins, bounded `max_tokens`, hard timeout, `reasoning.exclude`.
- Output validation: shape, evidence ids exist and are participant evidence, second person, no clinical
  or typological or causal claims (unless the participant used the word), lexical grounding against the
  cited notes, fabricated reference ids stripped, follow-up questions filtered, safety status honoured.
- Bounded attempts (default 2). Escalation to the next tier only on technical failure or when every theme
  failed grounding; never after a refusal; never past a manual choice; never for thin notes.
- Logs contain event names, codes, model ids, token counts and cost. Never content.

## 7. Known limits and open items

- **No real-API smoke test has been run yet** in this environment: no OpenRouter key was available.
  Run section 4's smoke test before telling anyone the integration works.
- **No model evaluation has been run.** Registry entries marked `approved` are provisional pilot
  approvals based on verified capabilities and ZDR endpoints, not on evaluation results.
- The in-memory rate-limit store is per serverless instance; use Upstash for shared counters.
- Lexical grounding catches invented content and wholesale paraphrase drift, not subtle misreadings.
  The facilitator review is the real control.
- Names are not detected automatically; the consent screen asks the facilitator to check.
