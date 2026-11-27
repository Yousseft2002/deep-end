// Small HTTP helpers shared by the Vercel functions and the local dev server.
// Node-style (req, res) handlers so one code path runs in both.

export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export function securityHeaders(res) {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Robots-Tag", "noindex");
  res.setHeader("Vary", "Origin");
}

export function sendJson(res, status, body) {
  securityHeaders(res);
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

export function sendError(res, err) {
  if (err instanceof HttpError) {
    if (err.extra && err.extra.retryAfter) res.setHeader("Retry-After", String(err.extra.retryAfter));
    return sendJson(res, err.status, { error: err.code, message: err.message, ...(err.extra.body || {}) });
  }
  return sendJson(res, 500, { error: "internal_error", message: "Something went wrong on the server. Nothing was saved." });
}

// Vercel may have parsed req.body already; the dev server has not. Enforce the size limit either way.
export async function readJsonBody(req, maxBytes) {
  const declared = Number.parseInt(req.headers["content-length"] || "0", 10);
  if (declared > maxBytes) throw new HttpError(413, "payload_too_large", "The session is too large to send. Shorten the notes.");
  const type = String(req.headers["content-type"] || "");
  if (!type.toLowerCase().startsWith("application/json")) throw new HttpError(415, "unsupported_media_type", "Send JSON.");
  if (req.body !== undefined) {
    if (typeof req.body === "string") {
      if (Buffer.byteLength(req.body) > maxBytes) throw new HttpError(413, "payload_too_large", "The session is too large to send.");
      return parse(req.body);
    }
    if (Buffer.byteLength(JSON.stringify(req.body)) > maxBytes) throw new HttpError(413, "payload_too_large", "The session is too large to send.");
    return req.body;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, "payload_too_large", "The session is too large to send. Shorten the notes.");
    chunks.push(chunk);
  }
  return parse(Buffer.concat(chunks).toString("utf8"));
}

function parse(text) {
  try { return JSON.parse(text); }
  catch { throw new HttpError(400, "invalid_json", "The request body was not valid JSON."); }
}

function hostOf(req) {
  const fwd = req.headers["x-forwarded-host"];
  return String(fwd || req.headers.host || "").split(",")[0].trim().toLowerCase();
}

// Browsers send Origin on every POST. Same-origin requests pass; others need an explicit allowlist.
// Capacitor apps use capacitor://localhost (iOS) and https://localhost (Android): list them to allow store builds.
export function checkOrigin(req, config) {
  const origin = String(req.headers.origin || "").trim().toLowerCase();
  if (!origin || origin === "null") throw new HttpError(403, "origin_required", "Requests must come from the Inner Depth page.");
  let host;
  try { host = new URL(origin).host.toLowerCase(); } catch { throw new HttpError(403, "origin_invalid", "Origin not recognised."); }
  const allowed = new Set(config.allowedOrigins.map(o => o.toLowerCase().replace(/\/$/, "")));
  if (config.vercelUrl) allowed.add("https://" + config.vercelUrl.toLowerCase());
  if (config.vercelProductionUrl) allowed.add("https://" + config.vercelProductionUrl.toLowerCase());
  const sameOrigin = host && host === hostOf(req);
  if (!sameOrigin && !allowed.has(origin)) throw new HttpError(403, "origin_not_allowed", "This origin is not allowed to use the AI organizer.");
  return origin;
}

export function corsHeaders(res, origin) {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "600");
}

export function handlePreflight(req, res, config) {
  if (req.method !== "OPTIONS") return false;
  try {
    const origin = checkOrigin(req, config);
    corsHeaders(res, origin);
    securityHeaders(res);
    res.statusCode = 204;
    res.end();
  } catch (err) {
    sendError(res, err);
  }
  return true;
}

export function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return String(fwd).split(",")[0].trim();
  return (req.socket && req.socket.remoteAddress) || "unknown";
}
