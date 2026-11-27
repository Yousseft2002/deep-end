// POST /api/inner-depth/chat — session-aware conversation for the facilitator (not the participant).
// Body: { session, options, themes, history, message }. The page resends the reviewed context each
// time; there is no provider-side thread and nothing persists here.
import { protectedPost } from "../../server/inner-depth/handler.js";
import { HttpError } from "../../server/inner-depth/http.js";
import { normalizeSession, normalizeThemes, normalizeHistory, redactIdentifiers, LIMITS } from "../../server/inner-depth/session.js";
import { runChat, normalizeOptions } from "../../server/inner-depth/pipeline.js";

export default protectedPost(async ({ body, config, store, facilitator, fetchImpl }) => {
  const session = normalizeSession(body.session);
  const options = normalizeOptions(body.options, config);
  const themes = normalizeThemes(body.themes);
  const history = normalizeHistory(body.history);
  const message = typeof body.message === "string" ? redactIdentifiers(body.message.trim()) : "";
  if (!message) throw new HttpError(400, "message_required", "Type a question for the assistant.");
  if (message.length > LIMITS.chatChars) throw new HttpError(400, "message_too_long", "Keep the question under " + LIMITS.chatChars + " characters.");
  return runChat({ config, store, session, facilitator, options, themes, history, message, fetchImpl });
});
