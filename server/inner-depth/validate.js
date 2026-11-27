// Post-generation validation. Structured outputs guarantee shape, not truth, so every theme is checked
// against the session: cited ids must exist and hold participant evidence, read-aloud text must be
// second person and free of clinical labels, and the wording must overlap with what the notes say.
// Themes that fail are dropped and reported; the facilitator sees why.
import { validateAgainstSchema, REFLECTION_SCHEMA, SINGLE_THEME_SCHEMA, CHAT_SCHEMA } from "./schema.js";
import { principleIds, principleSummary } from "./library.js";
import { evidenceText } from "./session.js";

export class OutputError extends Error {
  constructor(code, message, problems = []) { super(message); this.code = code; this.problems = problems; }
}

// Third-person references to the participant inside read-aloud text.
// Third-person references to the participant inside read-aloud text. Other people may be referred to in the
// third person ("your sister… her calling"), so only sentence-initial pronouns and participant nouns count.
const THIRD_PERSON = /(?:^|[.!?]\s+)["'“]?(he|she|they)\b|\b(the participant|the speaker|this person|himself|herself)\b/i;
const SECOND_PERSON = /\b(you|your|yours|yourself)\b/i;

// Clinical, typological and causal claims that never belong in a read-aloud reflection, however phrased.
const LABELS = [
  /\b(diagnos\w*|disorder|syndrome|pathological|clinical(ly)?|symptom\w*)\b/i,
  /\b(narcissis\w*|borderline|bipolar|ocd|adhd|autis\w*|ptsd|psychotic|schizo\w*|sociopath\w*|psychopath\w*)\b/i,
  /\b(depress\w*|anxiety disorder|trauma\w*|codependen\w*|dissociat\w*)\b/i,
  /\b(attachment (style|pattern)|anxious(ly)?[- ]attached|avoidant(ly)?|securely attached)\b/i,
  /\b(introvert\w*|extr[ao]vert\w*|personality (type|trait|profile)|enneagram|mbti|type [a-d]\b|highly sensitive person)\b/i,
  /\b(unconscious(ly)?|subconscious(ly)?|repress\w*|project(ing|ion) onto|defen[cs]e mechanism|in denial|shadow self|inner child|archetyp\w*|your (manager|exile|firefighter) part)\b/i,
  /\b(you are (clearly|obviously|definitely|fundamentally|basically|essentially) (a|an)\b)/i,
  /\b(this (stems|comes|results|arises) from|is caused by|because of your (childhood|upbringing|past|mother|father|parents)|rooted in your)\b/i,
  /\byou (probably|likely|must|really|secretly|actually|deep down) (want|need|feel|fear|are|believe)\b/i
];

const STOP = new Set("the a an and or but of to in on at for with from by as is are was were be been being you your yours yourself that this these those it its into about what which who whom when where why how does do did done have has had having not no yes also than then there here one some any all more most very really just like feel feels felt feeling seem seems seemed sound sounds sounded described describe mentioned mention said say says told talk talked thing things time times way ways part parts something someone can could would should may might will shall accurate experience right fit true matter matters important".split(" "));

export function contentWords(text) {
  return new Set(String(text || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}\s'-]/gu, " ").split(/\s+/)
    .map(w => w.replace(/^['-]+|['-]+$/g, "")).filter(w => w.length >= 3 && !STOP.has(w)).map(stem));
}

// Crude stemmer so "value/values/valued" and "famili/family/families" line up across typos and inflections.
function stem(w) {
  return w.replace(/(ing|ed|es|s|ly|ness|ment|tion|ies|ied|er|est)$/u, "").slice(0, 6);
}

export function overlapScore(themeText, sourceText) {
  const a = contentWords(themeText), b = contentWords(sourceText);
  if (!a.size) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return { shared, total: a.size, ratio: shared / a.size };
}

export function secondPersonProblems(text) {
  const problems = [];
  if (!SECOND_PERSON.test(text)) problems.push("does not address the participant as you/your");
  const third = THIRD_PERSON.exec(text);
  if (third) problems.push(`refers to the participant in the third person ("${third[0]}")`);
  return problems;
}

// A term the participant used themselves (present in the cited notes) is their word, not a label we add.
export function labelProblems(text, sourceText = "") {
  const problems = [];
  const source = String(sourceText).toLowerCase();
  for (const re of LABELS) {
    const m = re.exec(text);
    if (!m) continue;
    const term = m[0].toLowerCase();
    const core = term.replace(/^(you (are|have) (clearly|obviously|definitely|fundamentally|basically|essentially) (a|an)|this (stems|comes|results|arises) from|is caused by|because of your|rooted in your|you (probably|likely|must|really|secretly|actually|deep down))s*/, "");
    if (source && core.length >= 4 && source.includes(core.slice(0, Math.min(core.length, 7)))) continue;
    problems.push(`contains a clinical, typological or causal claim ("${m[0]}")`);
  }
  return problems;
}

export function checkTheme(theme, session, { minSharedWords = 1 } = {}) {
  const problems = [];
  const text = String(theme.read_aloud || "").trim();
  if (text.length < 20) problems.push("read-aloud text is too short");
  if (text.length > 1200) problems.push("read-aloud text is too long");
  if (!String(theme.title || "").trim() || theme.title.length > 80) problems.push("title missing or too long");
  const ids = Array.isArray(theme.answer_ids) ? [...new Set(theme.answer_ids)] : [];
  const valid = ids.filter(id => session.evidence_ids.includes(id));
  const source = valid.length ? evidenceText(session, valid) : "";
  problems.push(...labelProblems(theme.title || "", source));
  if (!ids.length) problems.push("cites no participant answers");
  else if (valid.length !== ids.length) problems.push(`cites ids that are not participant evidence (${ids.filter(id => !valid.includes(id)).join(", ")})`);
  if (!valid.length) problems.push("no valid evidence ids; background or impressions alone cannot support a theme");
  problems.push(...secondPersonProblems(text), ...labelProblems(text, source));
  let grounding = "none";
  if (valid.length) {
    const score = overlapScore(text, source);
    grounding = score.shared >= Math.max(minSharedWords, 2) ? "supported" : score.shared >= minSharedWords ? "weak" : "none";
    if (grounding === "none") problems.push("wording shares no content words with the cited answers");
  }
  const known = principleIds();
  const principles = (Array.isArray(theme.principle_ids) ? theme.principle_ids : []).filter(id => known.has(id));
  if (Array.isArray(theme.principle_ids) && principles.length !== theme.principle_ids.length) {
    // Unknown principle ids are a model fabrication: strip them but keep the theme, and tell the facilitator.
    problems.push(`WARN cited unknown reference ids (${theme.principle_ids.filter(id => !known.has(id)).join(", ")}); removed`);
  }
  return { problems: problems.filter(p => !p.startsWith("WARN")), warnings: problems.filter(p => p.startsWith("WARN")).map(p => p.slice(5)), valid, principles, grounding };
}

export function finalizeTheme(theme, check, index) {
  return {
    id: `t${index + 1}`,
    title: String(theme.title).trim(),
    read_aloud: String(theme.read_aloud).trim(),
    answer_ids: check.valid,
    principle_ids: check.principles,
    principles: check.principles.map(principleSummary),
    confidence: theme.confidence === "clear" ? "clear" : "tentative",
    grounding: check.grounding,
    facilitator_note: theme.facilitator_note ? String(theme.facilitator_note).trim() : null,
    warnings: check.warnings
  };
}

export function validateReflection(raw, session) {
  const shape = validateAgainstSchema(raw, REFLECTION_SCHEMA.schema);
  if (shape.length) throw new OutputError("malformed_output", "The model returned an unexpected shape.", shape);
  if (raw.status === "safety_support") {
    return { status: "safety_support", opening: "", themes: [], rejected: [], ambiguities: [], follow_up_questions: [], closing: "", insufficient_reason: null,
      safety_support: String(raw.safety_support || "").trim() || "Someone's immediate safety may be at risk. Stay with the person and seek immediate human support, such as local emergency services or a crisis line." };
  }
  if (raw.status === "insufficient_notes") {
    return { status: "insufficient_notes", opening: "", themes: [], rejected: [], ambiguities: cleanAmbiguities(raw.ambiguities, session), follow_up_questions: [], closing: "",
      insufficient_reason: String(raw.insufficient_reason || "").trim() || "The notes did not hold enough participant-reported content to organize.", safety_support: null };
  }
  const themes = [], rejected = [];
  (raw.themes || []).slice(0, 12).forEach((theme, i) => {
    const check = checkTheme(theme, session);
    if (check.problems.length) rejected.push({ title: String(theme.title || "").slice(0, 80), reasons: check.problems });
    else themes.push(finalizeTheme(theme, check, themes.length));
  });
  const opening = String(raw.opening || "").trim(), closing = String(raw.closing || "").trim();
  const allEvidence = evidenceText(session, session.evidence_ids);
  const openingProblems = [...secondPersonProblems(opening), ...labelProblems(opening, allEvidence)];
  const closingProblems = [...secondPersonProblems(closing), ...labelProblems(closing, allEvidence)];
  const questions = (raw.follow_up_questions || []).map(q => String(q).trim()).filter(q => q.length >= 8 && q.length <= 300 && SECOND_PERSON.test(q) && !THIRD_PERSON.test(q) && !labelProblems(q, allEvidence).length).slice(0, 3);
  if (!themes.length) {
    return { status: "insufficient_notes", opening: "", themes: [], rejected, ambiguities: cleanAmbiguities(raw.ambiguities, session), follow_up_questions: [], closing: "",
      insufficient_reason: rejected.length ? "Every generated theme failed validation against the notes. Review the rejected drafts, or use the local organizer." : "The model produced no grounded themes.", safety_support: null };
  }
  return {
    status: "reflection",
    opening: openingProblems.length ? "Thank you for trusting me with this. I want to check that I heard you correctly. You can change or reject any of it." : opening,
    themes, rejected,
    ambiguities: cleanAmbiguities(raw.ambiguities, session),
    follow_up_questions: questions,
    closing: closingProblems.length ? "What feels true to you here is yours to decide. You don't have to make sense of everything today." : closing,
    insufficient_reason: null,
    safety_support: null
  };
}

function cleanAmbiguities(list, session) {
  const known = new Set([...session.answers.map(a => a.id), ...session.additional.map(x => x.id), ...session.uncertainties.map(u => u.id)]);
  return (list || []).slice(0, 10).map(a => ({
    answer_id: a.answer_id && known.has(a.answer_id) ? a.answer_id : null,
    note: String(a.note || "").trim().slice(0, 400),
    clarifying_question: a.clarifying_question && SECOND_PERSON.test(a.clarifying_question) && !THIRD_PERSON.test(a.clarifying_question) ? String(a.clarifying_question).trim().slice(0, 300) : null
  })).filter(a => a.note);
}

export function validateSingleTheme(raw, session, themeId) {
  const shape = validateAgainstSchema(raw, SINGLE_THEME_SCHEMA.schema);
  if (shape.length) throw new OutputError("malformed_output", "The model returned an unexpected shape.", shape);
  if (raw.status === "safety_support") return { status: "safety_support", theme: null, reason: null, safety_support: String(raw.safety_support || "").trim() || "Seek immediate human support." };
  if (raw.status !== "theme" || !raw.theme) return { status: "unsupported", theme: null, reason: String(raw.reason || "").trim() || "The notes cannot support that wording.", safety_support: null };
  const check = checkTheme(raw.theme, session);
  if (check.problems.length) return { status: "unsupported", theme: null, reason: "The regenerated wording failed validation: " + check.problems.join("; "), safety_support: null };
  const theme = finalizeTheme(raw.theme, check, 0);
  theme.id = themeId;
  return { status: "theme", theme, reason: null, safety_support: null };
}

export function validateChat(raw, session, themes) {
  const shape = validateAgainstSchema(raw, CHAT_SCHEMA.schema);
  if (shape.length) throw new OutputError("malformed_output", "The model returned an unexpected shape.", shape);
  const themeIds = new Set(themes.map(t => t.id));
  const revisions = [];
  const dropped = [];
  for (const r of raw.proposed_revisions || []) {
    if (!themeIds.has(r.theme_id)) { dropped.push({ theme_id: r.theme_id, reasons: ["unknown theme id"] }); continue; }
    const base = themes.find(t => t.id === r.theme_id);
    const candidate = { title: r.title, read_aloud: r.read_aloud, answer_ids: base.answer_ids, principle_ids: [], confidence: "tentative", facilitator_note: null };
    const check = checkTheme(candidate, session);
    if (check.problems.length) dropped.push({ theme_id: r.theme_id, reasons: check.problems });
    else revisions.push({ theme_id: r.theme_id, title: String(r.title).trim(), read_aloud: String(r.read_aloud).trim(), grounding: check.grounding });
  }
  return {
    reply: String(raw.reply || "").trim().slice(0, 2000),
    grounded_in: (raw.grounded_in || []).filter(id => session.evidence_ids.includes(id)),
    proposed_revisions: revisions,
    rejected_revisions: dropped,
    caution: raw.caution ? String(raw.caution).trim().slice(0, 600) : null,
    safety_support: raw.safety_support ? String(raw.safety_support).trim().slice(0, 600) : null
  };
}
