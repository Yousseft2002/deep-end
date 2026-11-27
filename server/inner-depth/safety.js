// Loads the shared safety screen (docs/inner-depth-safety.js) for server use.
// The file is a plain browser script, so it is evaluated once with a stub `self`.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const file = fileURLToPath(new URL("../../docs/inner-depth-safety.js", import.meta.url));
const sandbox = { self: {} };
vm.runInNewContext(readFileSync(file, "utf8"), sandbox, { filename: "inner-depth-safety.js" });

export const SAFETY = sandbox.self.INNER_DEPTH_SAFETY;

// Screens every participant-reported field and the facilitator fields. Returns the ids that matched.
export function screenSession(session) {
  const hits = [];
  for (const a of session.answers) if (SAFETY.screen(a.answer)) hits.push(a.id);
  for (const x of session.additional) if (SAFETY.screen(x.text)) hits.push(x.id);
  for (const u of session.uncertainties) if (SAFETY.screen(u.text)) hits.push(u.id);
  if (SAFETY.screen(session.background.participant_reported)) hits.push("background");
  if (SAFETY.screen(session.background.facilitator_impressions)) hits.push("impressions");
  return hits;
}

export function safetyResponse(session, hits) {
  return {
    status: "safety_support",
    opening: "",
    themes: [],
    ambiguities: [],
    follow_up_questions: [],
    closing: "",
    insufficient_reason: null,
    safety_support: SAFETY.guidance.join(" "),
    safety_flagged_ids: hits,
    session_schema: session.schema
  };
}
