// Session payload validation and minimization.
// The page sends the participant-reviewed session; this module checks shape and limits, rejects
// anything but consenting adults, and strips obvious identifiers before the text reaches the model.
import { HttpError } from "./http.js";

export const SESSION_SCHEMA = "inner-depth.session.v1";
export const LIMITS = {
  answers: 12, answerChars: 1600, questionChars: 300,
  additional: 6, additionalChars: 800,
  uncertainties: 8, uncertaintyChars: 400,
  backgroundChars: 1600, impressionsChars: 1200, preferencesChars: 400,
  chatTurns: 12, chatChars: 1200,
  themeChars: 1200
};

const ID = /^[a-z][a-z0-9_-]{0,23}$/;

function str(v, max, field) {
  if (v === undefined || v === null) return "";
  if (typeof v !== "string") throw new HttpError(400, "invalid_session", `${field} must be text.`);
  const s = v.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (s.length > max) throw new HttpError(400, "invalid_session", `${field} is longer than ${max} characters.`);
  return s;
}

function arr(v, max, field) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new HttpError(400, "invalid_session", `${field} must be a list.`);
  if (v.length > max) throw new HttpError(400, "invalid_session", `${field} has more than ${max} items.`);
  return v;
}

function id(v, field) {
  if (typeof v !== "string" || !ID.test(v)) throw new HttpError(400, "invalid_session", `${field} has an invalid id.`);
  return v;
}

// Removes contact details and long numbers. Names cannot be detected reliably, so the page asks the
// facilitator not to write them and the model is told never to repeat one if it slips through.
export function redactIdentifiers(text) {
  if (!text) return text;
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email removed]")
    .replace(/https?:\/\/\S+|www\.\S+/gi, "[link removed]")
    .replace(/(?<![\w@])@[\w.]{2,}/g, "[handle removed]")
    .replace(/\+?\d[\d\s().-]{7,}\d/g, "[number removed]")
    .replace(/\b\d{5,}\b/g, "[number removed]");
}

export function normalizeSession(body) {
  if (!body || typeof body !== "object") throw new HttpError(400, "invalid_session", "Missing session.");
  if (body.schema !== SESSION_SCHEMA) throw new HttpError(400, "invalid_session", "Unsupported session format. Reload the page.");
  const ageBand = body.age_band;
  if (ageBand !== "adult") throw new HttpError(403, "adults_only", "The AI organizer is only available for consenting adult participants. Use the local organizer.");
  const consent = body.consent || {};
  if (consent.external_ai !== true || consent.participant_reviewed !== true) {
    throw new HttpError(403, "consent_required", "Both people must review the notes and agree to external AI processing first.");
  }
  const background = body.background || {};
  const seen = new Set();
  const unique = (v, field) => { const x = id(v, field); if (seen.has(x)) throw new HttpError(400, "invalid_session", `Duplicate id ${x}.`); seen.add(x); return x; };

  const answers = arr(body.answers, LIMITS.answers, "answers").map((a, i) => {
    if (!a || typeof a !== "object") throw new HttpError(400, "invalid_session", "Each answer must be an object.");
    return {
      id: unique(a.id, `answers[${i}]`),
      question_key: str(a.question_key, 40, "question_key"),
      question: str(a.question, LIMITS.questionChars, "question"),
      answer: redactIdentifiers(str(a.answer, LIMITS.answerChars, `answers[${i}].answer`)),
      skipped: a.skipped === true
    };
  });
  const additional = arr(body.additional, LIMITS.additional, "additional").map((x, i) => ({
    id: unique(x && x.id, `additional[${i}]`),
    text: redactIdentifiers(str(x && x.text, LIMITS.additionalChars, `additional[${i}].text`))
  })).filter(x => x.text);
  const uncertainties = arr(body.uncertainties, LIMITS.uncertainties, "uncertainties").map((u, i) => ({
    id: unique(u && u.id, `uncertainties[${i}]`),
    about: u && u.about ? id(u.about, `uncertainties[${i}].about`) : null,
    text: redactIdentifiers(str(u && u.text, LIMITS.uncertaintyChars, `uncertainties[${i}].text`))
  })).filter(u => u.text);
  for (const u of uncertainties) if (u.about && !seen.has(u.about)) throw new HttpError(400, "invalid_session", "An uncertainty points to an unknown answer.");

  const session = {
    schema: SESSION_SCHEMA,
    age_band: "adult",
    language: str(body.language, 16, "language") || "unspecified",
    background: {
      participant_reported: redactIdentifiers(str(background.participant_reported, LIMITS.backgroundChars, "background")),
      facilitator_impressions: redactIdentifiers(str(background.facilitator_impressions, LIMITS.impressionsChars, "impressions"))
    },
    communication_preferences: redactIdentifiers(str(body.communication_preferences, LIMITS.preferencesChars, "communication_preferences")),
    answers,
    additional,
    uncertainties
  };
  session.evidence_ids = evidenceIds(session);
  if (!session.evidence_ids.length) throw new HttpError(422, "insufficient_notes", "No participant answers were recorded. Background alone cannot support a reflection.");
  return session;
}

// Ids the model may cite as evidence: answered questions and volunteered information. Background never counts.
export function evidenceIds(session) {
  return [
    ...session.answers.filter(a => !a.skipped && a.answer.trim()).map(a => a.id),
    ...session.additional.filter(x => x.text.trim()).map(x => x.id)
  ];
}

export function evidenceText(session, ids) {
  const parts = [];
  for (const a of session.answers) if (ids.includes(a.id)) parts.push(a.answer);
  for (const x of session.additional) if (ids.includes(x.id)) parts.push(x.text);
  return parts.join("\n");
}

// Optional: the current draft themes and conversation history for regenerate/chat requests.
export function normalizeThemes(v) {
  return arr(v, 16, "themes").map((t, i) => {
    if (!t || typeof t !== "object") throw new HttpError(400, "invalid_request", "Each theme must be an object.");
    const answerIds = arr(t.answer_ids, LIMITS.answers + LIMITS.additional, "answer_ids").map(x => id(x, "answer_ids"));
    return {
      id: id(t.id, `themes[${i}]`),
      title: str(t.title, 80, "title"),
      read_aloud: str(t.read_aloud, LIMITS.themeChars, "read_aloud"),
      answer_ids: answerIds,
      facilitator_edited: t.facilitator_edited === true
    };
  });
}

export function normalizeHistory(v) {
  return arr(v, LIMITS.chatTurns, "history").map((m, i) => {
    if (!m || typeof m !== "object" || !["facilitator", "assistant"].includes(m.role)) throw new HttpError(400, "invalid_request", "Bad conversation history.");
    return { role: m.role, text: redactIdentifiers(str(m.text, LIMITS.chatChars, `history[${i}]`)) };
  });
}
