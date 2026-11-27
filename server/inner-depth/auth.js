// Facilitator authentication: a bearer access code the owner hands to each facilitator.
// Codes are compared in constant time; hashed entries (sha256:<hex>) keep the plaintext out of the env.
import { createHash, timingSafeEqual } from "node:crypto";
import { HttpError } from "./http.js";

export function sha256(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function equal(a, b) {
  const ba = Buffer.from(a, "utf8"), bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) { timingSafeEqual(ba, ba); return false; }
  return timingSafeEqual(ba, bb);
}

export function authenticate(req, config) {
  const header = String(req.headers.authorization || "");
  const m = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!m) throw new HttpError(401, "facilitator_code_required", "Enter the facilitator access code to use the AI organizer.");
  const presented = m[1];
  if (presented.length < 12 || presented.length > 256) throw new HttpError(401, "facilitator_code_invalid", "That access code is not valid.");
  const digest = sha256(presented);
  for (const key of config.facilitatorKeys) {
    const ok = key.hashed ? equal(digest, key.secret) : equal(presented, key.secret);
    if (ok) return { label: key.label, id: sha256("inner-depth:" + key.label).slice(0, 16) };
  }
  throw new HttpError(401, "facilitator_code_invalid", "That access code is not valid.");
}
