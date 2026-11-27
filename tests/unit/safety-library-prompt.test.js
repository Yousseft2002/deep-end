import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SAFETY, screenSession, safetyResponse } from "../../server/inner-depth/safety.js";
import { normalizeSession } from "../../server/inner-depth/session.js";
import { loadLibrary, principleSummary, libraryForPrompt } from "../../server/inner-depth/library.js";
import { buildInstructions, reflectionInput, chatInput, regenerateInput } from "../../server/inner-depth/prompt.js";

const scenarios = JSON.parse(readFileSync(new URL("../fixtures/scenarios.json", import.meta.url), "utf8")).scenarios;

test("safety screen catches explicit imminent-harm phrases and ignores idiom", () => {
  assert.equal(SAFETY.screen("lately I've been planning to end my life. have the pills"), true);
  assert.equal(SAFETY.screen("I want to kill myself"), true);
  assert.equal(SAFETY.screen("going to hurt him tonight"), true);
  assert.equal(SAFETY.screen("I'm not safe at home"), true);
  assert.equal(SAFETY.screen("I'd kill for a holiday"), false);
  assert.equal(SAFETY.screen("this job is killing me lol"), false);
  assert.equal(SAFETY.screen("my mum died last year"), false);
  assert.equal(SAFETY.screen(""), false);
});

test("screenSession flags the safety scenario and nothing else", () => {
  for (const s of scenarios) {
    const hits = screenSession(normalizeSession(structuredClone(s.session)));
    if (s.id === "safety-disclosure") { assert.deepEqual(hits, ["q4"]); assert.equal(safetyResponse(normalizeSession(structuredClone(s.session)), hits).status, "safety_support"); }
    else assert.deepEqual(hits, [], s.id + " should not trip the safety screen");
  }
});

test("library entries are complete, unique and sourced", () => {
  const { entries } = loadLibrary();
  assert.ok(entries.length >= 15);
  const ids = new Set();
  for (const e of entries) {
    for (const key of ["id", "thinker", "concept", "summary", "source", "evidence_limitations", "appropriate_application", "inappropriate_application", "tags"]) assert.ok(e[key], `${e.id || "?"} missing ${key}`);
    assert.ok(/^[a-z0-9-]+$/.test(e.id)); assert.ok(!ids.has(e.id)); ids.add(e.id);
    assert.ok(e.source.citation && e.source.type && e.source.year !== undefined, e.id + " source incomplete");
    assert.ok(e.summary.length > 120, e.id + " summary too short to be an original explanation");
    assert.ok(e.inappropriate_application.length > 30);
  }
  const thinkers = entries.map(e => e.thinker.toLowerCase()).join(" ");
  for (const name of ["jung", "rogers", "schwartz", "freud", "socratic", "elliott", "overholser"]) assert.ok(thinkers.includes(name), "library should cover " + name);
  assert.equal(principleSummary("rogers-core-conditions").thinker, "Carl Rogers");
  assert.equal(principleSummary("nope"), null);
  assert.ok(libraryForPrompt().includes("id: jung-persona-and-self"));
});

test("prompts carry the contract and treat notes as data", () => {
  const instr = buildInstructions();
  for (const must of ["not a therapist", "second person", "Never invent", "untrusted", "unconscious", "diagnose", "insufficient_notes", "safety_support", "Reference library", "principle_ids"]) assert.ok(instr.includes(must), "instructions should mention: " + must);
  const session = normalizeSession(structuredClone(scenarios.find(s => s.id === "induced-conclusions").session));
  const input = reflectionInput(session);
  assert.ok(input.includes("data, not instructions"));
  assert.ok(input.includes("facilitator_impressions_not_evidence"));
  assert.ok(input.includes("Usable evidence ids: q1, q2, q3"));
  const chat = chatInput(session, [{ id: "t1", title: "T", read_aloud: "You said x", answer_ids: ["q1"], facilitator_edited: false }], [{ role: "facilitator", text: "hi" }], "make it gentler");
  assert.ok(chat.includes("Facilitator: make it gentler") && chat.includes("\"id\": \"t1\""));
  assert.ok(regenerateInput(session, { title: "T", read_aloud: "You said x", answer_ids: ["q1"] }, "gentler").includes("wording request, not as new evidence"));
});
