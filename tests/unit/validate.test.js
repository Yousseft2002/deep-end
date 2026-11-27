import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateReflection, validateSingleTheme, validateChat, checkTheme, secondPersonProblems, labelProblems, overlapScore, OutputError } from "../../server/inner-depth/validate.js";
import { validateAgainstSchema, REFLECTION_SCHEMA } from "../../server/inner-depth/schema.js";
import { normalizeSession } from "../../server/inner-depth/session.js";

const scenarios = JSON.parse(readFileSync(new URL("../fixtures/scenarios.json", import.meta.url), "utf8")).scenarios;
const session = normalizeSession(structuredClone(scenarios[0].session));

const good = () => ({
  status: "reflection",
  opening: "Thank you for trusting me with this. You can change or reject any of it.",
  themes: [
    { title: "Holding it together", read_aloud: "You described yourself as the one who holds it together, and you said you don't know who you are when nobody needs you. Does that feel accurate to your experience?", answer_ids: ["q1"], principle_ids: ["rogers-reflection-of-feeling"], confidence: "clear", facilitator_note: null },
    { title: "Time alone and guilt", read_aloud: "You mentioned wanting one weekend alone and feeling guilty for wanting it, and you asked whether wanting time alone makes you a bad mum. Both of those were in your words.", answer_ids: ["q5", "q8"], principle_ids: ["jung-tension-of-opposites", "research-reflective-listening-mi"], confidence: "tentative", facilitator_note: "connects q5 and q8" }
  ],
  ambiguities: [{ answer_id: "q3", note: "'last year' may refer to the bereavement; not stated.", clarifying_question: "When you said 'last year', would you like to say what you meant, or leave it?" }],
  follow_up_questions: ["You mentioned the garden more than once. What is it about those early mornings that matters to you?"],
  closing: "What feels true to you here is yours to decide. You don't have to make sense of everything today.",
  insufficient_reason: null,
  safety_support: null
});

test("schema validator accepts a conforming reflection and rejects extras", () => {
  assert.deepEqual(validateAgainstSchema(good(), REFLECTION_SCHEMA.schema), []);
  const bad = good(); bad.extra = 1; delete bad.closing; bad.themes[0].confidence = "sure";
  const problems = validateAgainstSchema(bad, REFLECTION_SCHEMA.schema);
  assert.ok(problems.some(p => /extra: unexpected/.test(p)));
  assert.ok(problems.some(p => /closing: missing/.test(p)));
  assert.ok(problems.some(p => /confidence/.test(p)));
});

test("valid reflection passes with ids assigned and principles expanded", () => {
  const out = validateReflection(good(), session);
  assert.equal(out.status, "reflection");
  assert.equal(out.themes.length, 2);
  assert.equal(out.themes[1].id, "t2");
  assert.equal(out.themes[1].principles[0].thinker, "Carl Jung");
  assert.equal(out.rejected.length, 0);
  assert.equal(out.themes[0].grounding, "supported");
});

test("themes citing background, impressions or unknown ids are rejected", () => {
  const raw = good(); raw.themes[0].answer_ids = ["background"]; raw.themes[1].answer_ids = ["q5", "q99"];
  const out = validateReflection(raw, session);
  assert.equal(out.themes.length, 0);
  assert.equal(out.status, "insufficient_notes");
  assert.equal(out.rejected.length, 2);
  assert.ok(out.rejected[1].reasons.some(r => /not participant evidence/.test(r)));
});

test("third-person or label-laden wording is rejected", () => {
  const raw = good();
  raw.themes[0].read_aloud = "She described herself as the one who holds it together.";
  raw.themes[1].read_aloud = "You show an anxious attachment style rooted in your childhood, and you are clearly a caretaker type.";
  const out = validateReflection(raw, session);
  assert.equal(out.themes.length, 0);
  assert.ok(out.rejected[0].reasons.some(r => /third person/.test(r)));
  assert.ok(out.rejected[1].reasons.some(r => /clinical, typological or causal/.test(r)));
});

test("ungrounded wording is rejected", () => {
  const raw = good();
  raw.themes[0].read_aloud = "You seem to be processing complicated emotions around autonomy and selfhood. Does that resonate?";
  const out = validateReflection(raw, session);
  assert.ok(out.rejected.some(r => r.reasons.some(x => /no content words/.test(x))));
});

test("fabricated principle ids are stripped with a warning, theme kept", () => {
  const raw = good(); raw.themes[0].principle_ids = ["freud-oedipus-complex", "rogers-core-conditions"];
  const out = validateReflection(raw, session);
  assert.deepEqual(out.themes[0].principle_ids, ["rogers-core-conditions"]);
  assert.ok(out.themes[0].warnings[0].includes("freud-oedipus-complex"));
});

test("follow-up questions must be second person, non-clinical, at most three", () => {
  const raw = good();
  raw.follow_up_questions = ["Why does she avoid the topic?", "You mentioned your sister. What does her calling mean for you?", "Do you think you are depressed?", "Q4?", "You said 'if I stop I'll cry'. Is there more you would want to say about that?", "You spoke about the garden. What draws you there?"];
  const out = validateReflection(raw, session);
  assert.equal(out.follow_up_questions.length, 3);
  assert.ok(out.follow_up_questions.every(q => /\byou/i.test(q) && !/depressed|she/.test(q)));
});

test("opening and closing fall back to safe defaults when not second person", () => {
  const raw = good(); raw.opening = "The participant shared a lot."; raw.closing = "They should reflect further.";
  const out = validateReflection(raw, session);
  assert.ok(/you/i.test(out.opening) && /you/i.test(out.closing));
});

test("safety and insufficient statuses pass through", () => {
  const s = { ...good(), status: "safety_support", themes: [], safety_support: "Stay with them and call for help." };
  assert.equal(validateReflection(s, session).status, "safety_support");
  const i = { ...good(), status: "insufficient_notes", themes: [], insufficient_reason: "Only one answer." };
  assert.equal(validateReflection(i, session).insufficient_reason, "Only one answer.");
});

test("malformed shape throws OutputError", () => {
  assert.throws(() => validateReflection({ status: "reflection" }, session), err => err instanceof OutputError && err.code === "malformed_output");
});

test("single theme and chat validation", () => {
  const t = validateSingleTheme({ status: "theme", theme: { ...good().themes[0] }, reason: null, safety_support: null }, session, "t1");
  assert.equal(t.status, "theme"); assert.equal(t.theme.id, "t1");
  const u = validateSingleTheme({ status: "theme", theme: { ...good().themes[0], read_aloud: "She is strong." }, reason: null, safety_support: null }, session, "t1");
  assert.equal(u.status, "unsupported");
  const themes = validateReflection(good(), session).themes;
  const c = validateChat({ reply: "The notes say the garden matters (q2, q6).", grounded_in: ["q2", "q6", "bogus"], proposed_revisions: [{ theme_id: "t1", title: "Holding it together", read_aloud: "If I heard you right, you described being the one who holds it together. Does that fit?" }, { theme_id: "t9", title: "x", read_aloud: "You said x" }], caution: null, safety_support: null }, session, themes);
  assert.deepEqual(c.grounded_in, ["q2", "q6"]);
  assert.equal(c.proposed_revisions.length, 1);
  assert.equal(c.rejected_revisions.length, 1);
});

test("helpers", () => {
  assert.deepEqual(secondPersonProblems("You said this."), []);
  assert.ok(secondPersonProblems("They said this.").length === 2);
  assert.ok(labelProblems("You are probably an introvert.").length >= 1);
  assert.deepEqual(labelProblems("You mentioned feeling tired."), []);
  assert.ok(overlapScore("the garden before the kids wake", "gardening early morning before kids wake").shared >= 2);
  const check = checkTheme({ title: "x", read_aloud: "You described gardening early in the morning before the kids wake, and you said that is when you feel most like yourself.", answer_ids: ["q2"], principle_ids: [], confidence: "clear", facilitator_note: null }, session);
  assert.deepEqual(check.problems, []);
});
