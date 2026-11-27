// adaptiveRouter: a local, deterministic look at the task and the notes that picks a reasoning tier,
// then an eligible model within it. Nothing here reads the meaning of the notes or judges the
// participant; the signals are structural (how many answers, how fragmented, how many scripts,
// how much cross-answer overlap, explicit contradiction markers) and task-shaped.
import { contentWords } from "./validate.js";
import { tierCandidates } from "./registry.js";
import { TIERS } from "./config.js";

export const TASKS = ["organize", "synthesis", "rewording", "clarification", "follow_up", "explain_principles"];

const CONTRADICTION = /\b(but|although|though|however|yet|on the other hand|at the same time|at once|part of me|torn|conflicted|mixed|contradict\w*|both|can'?t decide|two minds|aber|pero|mais|однако)\b/i;
const SHORTHAND = /(\?|\b[a-z]{1,3}\/[a-z]{1,3}\b|\+|&|\bw\/|\bb\/c\b|\betc\b|\.\.\.|…|->|=>)/gi;

function scripts(text) {
  const found = new Set();
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80) { if (/[a-z]/i.test(ch)) found.add("latin"); }
    else if (cp >= 0x0400 && cp <= 0x04ff) found.add("cyrillic");
    else if (cp >= 0x0600 && cp <= 0x06ff) found.add("arabic");
    else if (cp >= 0x0590 && cp <= 0x05ff) found.add("hebrew");
    else if (cp >= 0x0900 && cp <= 0x097f) found.add("devanagari");
    else if (cp >= 0x3040 && cp <= 0x30ff) found.add("kana");
    else if (cp >= 0x4e00 && cp <= 0x9fff) found.add("han");
    else if (cp >= 0xac00 && cp <= 0xd7af) found.add("hangul");
    else if (cp >= 0x0e00 && cp <= 0x0e7f) found.add("thai");
    else if (cp >= 0x00c0 && cp <= 0x024f) found.add("latin-ext");
  }
  return found;
}

// Structural signals about the session. Exported so tests and the UI explanation can see them.
export function assessSession(session) {
  const answers = session.answers.filter(a => !a.skipped && a.answer.trim());
  const texts = [...answers.map(a => a.answer), ...session.additional.map(x => x.text)];
  const all = texts.join("\n");
  const words = all.split(/\s+/).filter(Boolean).length;
  const avgWordsPerAnswer = texts.length ? words / texts.length : 0;
  const fragments = texts.filter(t => avgWords(t) < 8 || !/[.!?]/.test(t)).length;
  const shorthand = (all.match(SHORTHAND) || []).length;
  const contradictions = texts.filter(t => CONTRADICTION.test(t)).length;
  const scriptSet = scripts(all);
  const multilingual = scriptSet.size > 1 || session.language && !/^en/i.test(session.language) && session.language !== "unspecified";
  // Cross-answer relationships: how many content words appear in two or more answers.
  const seen = new Map();
  for (const t of texts) for (const w of contentWords(t)) seen.set(w, (seen.get(w) || 0) + 1);
  const sharedTerms = [...seen.values()].filter(n => n >= 2).length;
  const backgroundWords = (session.background.participant_reported + " " + session.background.facilitator_impressions).split(/\s+/).filter(Boolean).length;
  return {
    substantive_answers: answers.length,
    volunteered: session.additional.length,
    total_words: words,
    avg_words_per_answer: Math.round(avgWordsPerAnswer),
    fragmented_answers: fragments,
    shorthand_marks: shorthand,
    contradiction_markers: contradictions,
    shared_terms: sharedTerms,
    scripts: [...scriptSet],
    multilingual,
    uncertainties: session.uncertainties.length,
    background_words: backgroundWords
  };
}

function avgWords(t) { const n = t.split(/\s+/).filter(Boolean).length; return n; }

// Complexity score 0..10 built from the structural signals. Documented weights, no learned model.
export function complexityScore(signals) {
  let score = 0;
  const why = [];
  if (signals.substantive_answers >= 6) { score += 2; why.push("most questions answered"); }
  else if (signals.substantive_answers >= 3) { score += 1; why.push("several questions answered"); }
  if (signals.total_words > 350) { score += 1.5; why.push("long notes"); }
  else if (signals.total_words > 150) { score += 0.5; }
  if (signals.fragmented_answers >= Math.max(2, signals.substantive_answers / 2)) { score += 1.5; why.push("fragmented shorthand"); }
  if (signals.shorthand_marks >= 4) { score += 1; why.push("many uncertainty or shorthand marks"); }
  if (signals.contradiction_markers >= 2) { score += 1.5; why.push("several explicit tensions"); }
  else if (signals.contradiction_markers === 1) { score += 0.5; }
  if (signals.shared_terms >= 6) { score += 1.5; why.push("many cross-answer links"); }
  else if (signals.shared_terms >= 3) { score += 0.5; }
  if (signals.multilingual) { score += 2; why.push("more than one language or script"); }
  if (signals.uncertainties >= 2) { score += 0.5; }
  if (signals.background_words > 120) { score += 0.5; why.push("substantial background to weigh"); }
  return { score: Math.min(10, Math.round(score * 10) / 10), why };
}

// Tier choice per task. Full organization never drops below balanced once there is anything to synthesise.
export function chooseTier({ task, signals, facilitatorMode, escalateFrom = null, requestedTier = null }) {
  const { score, why } = complexityScore(signals);
  let tier, reason;
  if (task === "rewording" || task === "clarification" || task === "follow_up") {
    tier = "fast"; reason = `${task.replace("_", " ")} is a wording task; a fast model is enough`;
    if (task === "follow_up" && score >= 6) { tier = "balanced"; reason = "follow-up question on a complex session"; }
  } else if (task === "explain_principles") {
    tier = "balanced"; reason = "explaining principles without labelling needs careful wording";
  } else if (task === "synthesis") {
    tier = score >= 6 ? "advanced" : "balanced"; reason = score >= 6 ? "cross-answer synthesis on a complex session" : "cross-answer synthesis";
  } else {
    // organize
    if (signals.substantive_answers <= 2 && score < 3) { tier = "fast"; reason = "very few answers to organize"; }
    else if (score >= 6.5) { tier = "advanced"; reason = "complex session: " + why.join(", "); }
    else { tier = "balanced"; reason = "ordinary full-session organization" + (why.length ? " (" + why.join(", ") + ")" : ""); }
  }
  if (facilitatorMode === "economy") {
    if (tier === "advanced") { tier = "balanced"; reason += "; economy mode capped the tier at balanced"; }
    else if (tier === "balanced" && (task === "organize" || task === "synthesis")) { reason += "; economy mode keeps balanced for full organization"; }
    else { tier = "fast"; reason += "; economy mode"; }
  }
  if (facilitatorMode === "deep") {
    if (tier !== "advanced") { tier = task === "rewording" || task === "clarification" ? "balanced" : "advanced"; reason += "; deep reasoning mode raised the tier"; }
  }
  if (requestedTier && TIERS.includes(requestedTier)) { tier = requestedTier; reason = "tier requested explicitly (" + requestedTier + ")"; }
  if (escalateFrom) {
    const next = TIERS[Math.min(TIERS.length - 1, TIERS.indexOf(escalateFrom) + 1)];
    tier = next;
    reason = next !== escalateFrom ? `escalated from ${escalateFrom} after the first attempt failed validation` : "retried at the advanced tier after the first attempt failed validation";
  }
  return { tier, reason, score, why };
}

// Picks the primary model and OpenRouter fallbacks within the tier, or the auto-router plugin when configured.
export function chooseModels({ tier, models, config, manualModelId = null }) {
  if (manualModelId) {
    const m = models.find(x => x.id === manualModelId);
    if (!m) return { error: "unknown_model" };
    if (!m.eligible) return { error: "model_ineligible", reasons: m.reasons };
    return { primary: m, fallbacks: [], tier: m.tier, selector: "manual" };
  }
  // Walk down the tiers if the requested one has no eligible model; never silently up to a pricier one.
  const order = [tier, ...TIERS.slice(0, TIERS.indexOf(tier)).reverse(), ...TIERS.slice(TIERS.indexOf(tier) + 1)];
  for (const t of order) {
    const candidates = tierCandidates(models, t, config);
    if (!candidates.length) continue;
    if (config.tierSelector === "openrouter-auto") return { primary: null, auto: candidates.map(c => c.id), fallbacks: [], tier: t, selector: "openrouter-auto", demoted: t !== tier };
    return { primary: candidates[0], fallbacks: candidates.slice(1, 3), tier: t, selector: "registry", demoted: t !== tier };
  }
  return { error: "no_eligible_models" };
}
