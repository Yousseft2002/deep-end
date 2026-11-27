// POST /api/inner-depth/reflect — organize a reviewed adult session into a draft reflection.
// Body: { session, options }. Nothing is stored. Returns themes with evidence ids, routing and cost.
import { protectedPost } from "../../server/inner-depth/handler.js";
import { normalizeSession } from "../../server/inner-depth/session.js";
import { runReflection, normalizeOptions } from "../../server/inner-depth/pipeline.js";

export default protectedPost(async ({ body, config, store, facilitator, fetchImpl }) => {
  const session = normalizeSession(body.session);
  const options = normalizeOptions(body.options, config);
  return runReflection({ config, store, session, facilitator, options, fetchImpl });
});
