// Development-only stand-in for the model. It is deliberately dull: it quotes the notes back in
// second person so the review interface, validation and tests can run without credentials.
// It is never used in production (see config.js), and every response is marked mode:"mock".
import { evidenceText } from "./session.js";

function sentences(text) {
  return String(text || "").split(/(?<=[.!?])\s+|\n+/).map(s => s.trim()).filter(Boolean);
}

function clip(s, n) { return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s; }

export function mockReflection(session) {
  const usable = session.answers.filter(a => !a.skipped && a.answer.trim());
  if (!usable.length && !session.additional.length) {
    return { status: "insufficient_notes", opening: "", themes: [], ambiguities: [], follow_up_questions: [], closing: "", insufficient_reason: "No answers were recorded.", safety_support: null };
  }
  const themes = [];
  // One theme per answered question, plus one cross-question theme when two answers share a content word.
  for (const a of usable) {
    const first = (sentences(a.answer)[0] || a.answer).replace(/[.!?]+$/, "");
    themes.push({
      title: clip(a.question_key.replace(/-/g, " ").replace(/^\w/, c => c.toUpperCase()), 60),
      read_aloud: `You mentioned ${clip(first.replace(/^I am\b/i, "you are").replace(/^I'm\b/i, "you're").replace(/^I\s+/, "you "), 160)}. Does that feel accurate to your experience?`,
      answer_ids: [a.id],
      principle_ids: ["rogers-reflection-of-feeling"],
      confidence: "clear",
      facilitator_note: "Mock organizer: direct echo of the note. Not AI-generated."
    });
  }
  const words = new Map();
  for (const a of usable) for (const w of new Set(a.answer.toLowerCase().match(/[a-z]{5,}/g) || [])) words.set(w, [...(words.get(w) || []), a.id]);
  const shared = [...words.entries()].find(([, ids]) => ids.length >= 2);
  if (shared) themes.unshift({
    title: "Across your answers",
    read_aloud: `Across more than one answer you came back to "${shared[0]}". It sounded like that matters to you. Does that feel accurate to your experience?`,
    answer_ids: shared[1].slice(0, 3),
    principle_ids: ["research-socratic-review"],
    confidence: "tentative",
    facilitator_note: "Mock organizer: word repeated across answers " + shared[1].join(", ") + "."
  });
  for (const x of session.additional) themes.push({
    title: "Something you added", read_aloud: `You also mentioned ${clip(x.text, 160)}. Does that feel accurate to your experience?`, answer_ids: [x.id], principle_ids: [], confidence: "clear", facilitator_note: "Mock organizer."
  });
  const ambiguities = [];
  for (const a of usable) if (/\?/.test(a.answer)) ambiguities.push({ answer_id: a.id, note: "The note contains a question mark, which the facilitator uses to mark uncertainty.", clarifying_question: "You said something here that we were not sure we caught. Would you say it again?" });
  for (const a of usable) if (/\b(ignore|instruction|system prompt|assistant)\b/i.test(a.answer)) ambiguities.push({ answer_id: a.id, note: "This note looks like it contains instructions rather than an answer.", clarifying_question: null });
  for (const u of session.uncertainties) ambiguities.push({ answer_id: u.about, note: "Facilitator marked: " + clip(u.text, 200), clarifying_question: null });
  return {
    status: "reflection",
    opening: "Thank you for trusting me with this. I want to check that I heard you correctly, and you can change or reject any of it.",
    themes,
    ambiguities,
    follow_up_questions: usable.length ? [`You spoke about ${clip(sentences(usable[0].answer)[0] || usable[0].answer, 60)}. Is there anything more you would want to say about that?`] : [],
    closing: "What feels true to you here is yours to decide. You don't have to make sense of everything today.",
    insufficient_reason: null,
    safety_support: null
  };
}

export function mockTheme(session, theme, instruction) {
  const source = evidenceText(session, theme.answer_ids);
  if (!source.trim()) return { status: "unsupported", theme: null, reason: "No evidence for that theme.", safety_support: null };
  const gentler = /gentl|soft|tentativ/i.test(instruction || "");
  return {
    status: "theme",
    theme: {
      title: theme.title || "Revised theme",
      read_aloud: `${gentler ? "If I heard you right, you" : "You"} described ${clip(sentences(source)[0] || source, 160)}. Does that feel accurate to your experience?`,
      answer_ids: theme.answer_ids,
      principle_ids: ["rogers-core-conditions"],
      confidence: "tentative",
      facilitator_note: "Mock organizer regeneration. Request: " + clip(instruction || "(none)", 120)
    },
    reason: null,
    safety_support: null
  };
}

export function mockChat(session, themes, history, message) {
  const asksCause = /\bwhy\b|because|cause|motive|diagnos|disorder|type\b/i.test(message);
  const asksGentler = /gentl|soft|kinder|reword|rephrase/i.test(message);
  const target = themes[0];
  return {
    reply: asksCause
      ? "The notes do not say why. I can only organize what the participant reported; a cause would be a guess."
      : target ? `Based on the notes (${target.answer_ids.join(", ")}), the participant said: ${clip(evidenceText(session, target.answer_ids), 200)}` : "There are no themes to discuss yet.",
    grounded_in: target ? target.answer_ids : [],
    proposed_revisions: asksGentler && target ? [{ theme_id: target.id, title: target.title, read_aloud: `If I understood you, you mentioned ${clip(sentences(evidenceText(session, target.answer_ids))[0] || "", 140)}. Does that feel right to you?` }] : [],
    caution: asksCause ? "Causes, motives and diagnoses are outside what these notes can support." : null,
    safety_support: null
  };
}
