// POST /api/inner-depth/regenerate — reword one theme on request ("gentler", "shorter", "fresh wording").
// Body: { session, options, theme: { id, title, read_aloud, answer_ids }, instruction }.
import { protectedPost } from "../../server/inner-depth/handler.js";
import { HttpError } from "../../server/inner-depth/http.js";
import { normalizeSession, normalizeThemes, LIMITS } from "../../server/inner-depth/session.js";
import { runRegenerate, normalizeOptions } from "../../server/inner-depth/pipeline.js";

export default protectedPost(async ({ body, config, store, facilitator, fetchImpl }) => {
  const session = normalizeSession(body.session);
  const options = normalizeOptions(body.options, config);
  const [theme] = normalizeThemes([body.theme]);
  if (!theme) throw new HttpError(400, "theme_required", "Which theme should be regenerated?");
  const instruction = typeof body.instruction === "string" ? body.instruction.trim().slice(0, 400) : "";
  if (!theme.answer_ids.every(id => session.evidence_ids.includes(id))) throw new HttpError(400, "theme_evidence_invalid", "The theme cites answers that are no longer in the session. Regenerate the whole reflection.");
  if (theme.read_aloud.length > LIMITS.themeChars) throw new HttpError(400, "theme_too_long", "Theme text too long.");
  return runRegenerate({ config, store, session, facilitator, options, theme, instruction, fetchImpl });
});
