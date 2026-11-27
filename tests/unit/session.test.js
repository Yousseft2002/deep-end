import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSession, redactIdentifiers, evidenceIds, normalizeThemes, normalizeHistory, LIMITS } from "../../server/inner-depth/session.js";
import { HttpError } from "../../server/inner-depth/http.js";
import { readFileSync } from "node:fs";

const scenarios = JSON.parse(readFileSync(new URL("../fixtures/scenarios.json", import.meta.url), "utf8")).scenarios;
const base = () => structuredClone(scenarios[0].session);

test("accepts a reviewed adult session and assigns evidence ids", () => {
  const s = normalizeSession(base());
  assert.equal(s.age_band, "adult");
  assert.deepEqual(s.evidence_ids, ["q1", "q2", "q3", "q4", "q5", "q6", "q7", "q8"]);
  assert.equal(s.uncertainties[0].about, "q3");
});

test("rejects teen and unknown ages", () => {
  for (const band of ["teen", "unknown", "child", undefined]) {
    const b = base(); b.age_band = band;
    assert.throws(() => normalizeSession(b), err => err instanceof HttpError && err.code === "adults_only" && err.status === 403);
  }
});

test("requires both consents", () => {
  const b = base(); b.consent.external_ai = false;
  assert.throws(() => normalizeSession(b), err => err.code === "consent_required");
  const c = base(); c.consent.participant_reviewed = false;
  assert.throws(() => normalizeSession(c), err => err.code === "consent_required");
});

test("skipped and empty answers are not evidence; background alone is insufficient", () => {
  const b = base(); b.answers.forEach(a => { a.answer = ""; });
  assert.throws(() => normalizeSession(b), err => err.code === "insufficient_notes" && err.status === 422);
  const c = base(); c.answers[0].skipped = true;
  assert.ok(!evidenceIds(normalizeSession(c)).includes("q1"));
});

test("redacts emails, phones, links, handles and long numbers but keeps words", () => {
  const out = redactIdentifiers("mail me at jo.smith+x@example.co.uk or +44 7700 900123, see https://example.org/x, @jo_s, ref 123456, age 42");
  assert.ok(!/example\.co\.uk|7700|https|@jo_s|123456/.test(out));
  assert.ok(/age 42/.test(out));
  assert.ok(/\[email removed\]/.test(out) && /\[number removed\]/.test(out) && /\[link removed\]/.test(out) && /\[handle removed\]/.test(out));
});

test("enforces size limits and id format", () => {
  const b = base(); b.answers[0].answer = "x".repeat(LIMITS.answerChars + 1);
  assert.throws(() => normalizeSession(b), err => err.code === "invalid_session");
  const c = base(); c.answers[0].id = "Q1; DROP";
  assert.throws(() => normalizeSession(c), err => err.code === "invalid_session");
  const d = base(); d.answers[1].id = "q1";
  assert.throws(() => normalizeSession(d), err => /Duplicate/.test(err.message));
  const e = base(); e.uncertainties[0].about = "q99";
  assert.throws(() => normalizeSession(e), err => /unknown answer/.test(err.message));
});

test("strips control characters and normalizes newlines", () => {
  const b = base(); b.answers[0].answer = "line1\r\nline2\u0000\u0007 ok";
  assert.equal(normalizeSession(b).answers[0].answer, "line1\nline2 ok");
});

test("wrong schema is rejected", () => {
  const b = base(); b.schema = "other";
  assert.throws(() => normalizeSession(b), err => err.code === "invalid_session");
});

test("themes and history normalize with bounds", () => {
  const t = normalizeThemes([{ id: "t1", title: "T", read_aloud: "You said x.", answer_ids: ["q1"], facilitator_edited: true }]);
  assert.equal(t[0].facilitator_edited, true);
  assert.throws(() => normalizeHistory([{ role: "system", text: "x" }]), err => err.code === "invalid_request");
  assert.equal(normalizeHistory([{ role: "facilitator", text: "call 07700 900123" }])[0].text.includes("07700"), false);
});
