(() => {
"use strict";
// Inner Depth: eight questions, local notes, an optional AI organizer for consenting adults, and a
// facilitator review where nothing is approved automatically. Everything lives in this closure's
// memory by default; adults can separately opt into a short-lived local recovery draft.
const Q = [
  ["identity", "Identity", "How would you describe yourself right now, in your own words?", "Listen for what they value about themselves. Avoid evaluating their answer."],
  ["being-seen", "Being seen", "When do you feel most like yourself, and when do you feel misunderstood?", "Let them choose the people or situations they want to talk about."],
  ["experiences", "Experiences", "What experiences, if any, feel important to who you are today?", "They do not need to revisit painful events. Accept a broad answer."],
  ["emotions", "Emotions", "When life feels difficult, what tends to happen inside you?", "Reflect their own words. Don't interpret silence or guess what is hidden."],
  ["inner-tensions", "Inner tensions", "Are there different wishes, feelings or sides of yourself that sometimes pull you in different directions?", "If not, move on. Let them describe any conflict in their own language."],
  ["needs-support", "Needs and support", "What helps you feel understood, supported or at peace?", "Ask what matters to them, not what you think they should need."],
  ["values", "Values", "What matters most to you when you make a difficult decision?", "Make room for personal, cultural and spiritual values without assuming them."],
  ["looking-forward", "Looking forward", "What would you like to understand or accept about yourself a little more?", "Let them decide whether there is anything to take forward."]
];
const TEEN_PROMPTS = { 2: "What activities, people or experiences have mattered to you lately?", 4: "Are there times when you want two different things at once?", 7: "What would you like to understand about yourself or feel more comfortable with?" };
const $ = id => document.getElementById(id);
const screens = ["intro", "context", "question", "review", "ai-consent", "result", "ai-result", "readout"];
const API = self.INNER_DEPTH_API || { base: "/api/inner-depth", timeoutMs: 95000 };
const SAFETY = self.INNER_DEPTH_SAFETY;

// ---- Session state (memory by default) -------------------------------------------------------------
let notes = Q.map(() => ""), index = 0, active = false;
let ageBand = "unknown", prior = "", observed = "", preferences = "", extra = "", unsure = "";
let drafts = Q.map(() => ""), selected = Q.map(() => false);        // local organizer
let status = null;                                                     // GET /status payload
let accessCode = "";                                                   // typed each session, memory only
let sessionId = "";                                                    // random, for budget bookkeeping only
let dossier = null;                                                    // validated AI result + facilitator edits
let chat = [];                                                         // [{role, text}] temporary
let readoutSource = "local";
let busy = false;
const ageInputs = [...document.querySelectorAll('input[name="age-band"]')];

function newSessionId() {
  const bytes = new Uint8Array(12); crypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2, "0")).join("");
}

// ---- Optional local recovery -------------------------------------------------------------------
const RECOVERY_KEY = "deepend-inner-depth-recovery-v1";
const RECOVERY_TTL = 2 * 60 * 60 * 1000;
let recoveryId = "", recoveryExpiry = 0, recoveryTimer = null;
function recoveryStatus(message) { $("recovery-status").textContent = message; }
function readRecovery() {
  try {
    const raw = localStorage.getItem(RECOVERY_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || d.version !== 1 || typeof d.id !== "string" || !Number.isFinite(d.expires) ||
        d.expires <= Date.now() || d.expires > Date.now() + RECOVERY_TTL ||
        !Number.isInteger(d.index) || d.index < 0 || d.index >= Q.length ||
        !["question", "review"].includes(d.screen) || !Array.isArray(d.notes) ||
        d.notes.length !== Q.length || !d.notes.every(n => typeof n === "string" && n.length <= 1600) ||
        ![["prior",1600],["observed",1200],["preferences",400],["extra",800],["unsure",400]].every(([k,m]) => typeof d[k] === "string" && d[k].length <= m)) {
      localStorage.removeItem(RECOVERY_KEY); return null;
    }
    return d;
  } catch (_) {
    try { localStorage.removeItem(RECOVERY_KEY); } catch (_) {}
    return null;
  }
}
function disableRecovery(message, remove = true) {
  clearTimeout(recoveryTimer); recoveryTimer = null;
  if (remove && recoveryId) {
    try {
      const d = readRecovery();
      if (d && d.id === recoveryId) localStorage.removeItem(RECOVERY_KEY);
    } catch (_) { message = "Could not remove recovery copy. Clear this site's data if needed."; }
  }
  recoveryId = ""; recoveryExpiry = 0;
  $("recovery-off").hidden = true;
  recoveryStatus(message);
}
function scheduleExpiry() {
  clearTimeout(recoveryTimer);
  recoveryTimer = setTimeout(() => {
    if (active && recoveryId) disableRecovery("Recovery expired; your open session remains in memory.");
    else refreshRecoveryOffer();
  }, Math.max(0, recoveryExpiry - Date.now()) + 20);
}
function saveRecovery(screen) {
  if (!active || !recoveryId || ageBand !== "adult") return;
  if (Date.now() >= recoveryExpiry) { disableRecovery("Recovery expired; your open session remains in memory."); return; }
  try {
    const d = readRecovery();
    if (d && d.id !== recoveryId) { disableRecovery("Another recovery draft exists. This session is now memory-only.", false); return; }
    const target = screen || (!$("question").hidden ? "question" : "review");
    localStorage.setItem(RECOVERY_KEY, JSON.stringify({version:1,id:recoveryId,expires:recoveryExpiry,index,screen:target,notes,prior,observed,preferences,extra,unsure}));
    $("recovery-off").hidden = false;
    recoveryStatus("Local recovery on · expires at " + new Date(recoveryExpiry).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"}));
  } catch (_) { disableRecovery("Recovery could not save. Your open session is memory-only."); }
}
function refreshRecoveryOffer() {
  if (active) return;
  const d = readRecovery();
  $("recovery-offer").hidden = !d;
  $("restore-draft").disabled = !$("consent").checked || !d;
  $("start").disabled = !$("consent").checked || !!d;
  clearTimeout(recoveryTimer);
  if (d) { recoveryExpiry = d.expires; scheduleExpiry(); }
}
function restoreRecovery() {
  const d = readRecovery();
  if (!$("consent").checked || !d || active) { refreshRecoveryOffer(); return; }
  active = true; ageBand = "adult"; ageInputs.forEach(el => el.checked = el.value === "adult");
  index = d.index; notes = d.notes.slice(); prior = d.prior; observed = d.observed; preferences = d.preferences; extra = d.extra; unsure = d.unsure;
  $("prior-context").value = prior; $("observed-context").value = observed; $("preferences").value = preferences;
  recoveryId = d.id; recoveryExpiry = d.expires; scheduleExpiry();
  $("recovery-offer").hidden = true;
  if (d.screen === "review") review(); else question();
}

// ---- Optional, adult-only microphone dictation ------------------------------------------------
// Browser speech recognition may use a third-party service. Never start silently or store audio.
// A constructor's presence does not guarantee a working native speech service.
const appleMobile = /iPad|iPhone|iPod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const installed = navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
const nativeShell = !!(window.Capacitor?.isNativePlatform?.());
const Recognition = appleMobile || installed || nativeShell ? null : (window.SpeechRecognition || window.webkitSpeechRecognition);
const DICTATION_FALLBACK = "Use your keyboard microphone if available, or type.";
let speechTimer = null, consentPending = false, speechPhase = "idle";
function speechDiagnostic(code) { console.info("[Inner Depth speech]", code); }
function clearSpeechTimer() { clearTimeout(speechTimer); speechTimer = null; }
function speechTimeout(current, ms, code) {
  clearSpeechTimer();
  speechTimer = setTimeout(() => {
    if (recognition !== current) return;
    cancelDictation("Dictation timed out. " + DICTATION_FALLBACK, code);
  }, ms);
}
let recognition = null;
function dictationUI(listening, message) {
  $("dictate").setAttribute("aria-pressed", String(listening));
  $("dictate-label").textContent = listening ? "Stop dictation" : "Dictate notes";
  $("dictation-status").textContent = message;
}
function cancelDictation(message, code) {
  const current = recognition; recognition = null;
  clearSpeechTimer(); speechPhase = "idle"; consentPending = false;
  $("dictation-consent").hidden = true;
  if (current) {
    current.onstart = current.onresult = current.onerror = current.onend = null;
    try { current.abort(); } catch (_) { speechDiagnostic("abort-failed"); }
  }
  if (code) speechDiagnostic(code);
  dictationUI(false, message || (Recognition ? "Optional. Ask permission before speaking." : DICTATION_FALLBACK));
}
function toggleDictation() {
  if (recognition) {
    const current = recognition;
    if (speechPhase === "stopping") { cancelDictation(); return; }
    if (speechPhase === "starting") { cancelDictation(); return; }
    try { speechPhase = "stopping"; dictationUI(true, "Finishing dictation…"); speechTimeout(current, 3000, "stop-timeout"); current.stop(); }
    catch (_) { cancelDictation("Dictation stopped. " + DICTATION_FALLBACK, "stop-failed"); }
    return;
  }
  if (!Recognition || ageBand !== "adult" || !active || $("question").hidden) return;
  consentPending = !consentPending;
  $("dictation-consent").hidden = !consentPending;
}
function startDictation() {
  if (!consentPending || recognition || !Recognition || ageBand !== "adult" || !active || $("question").hidden) return;
  consentPending = false; $("dictation-consent").hidden = true;
  capture(); saveRecovery("question");
  const field = $("notes"), questionIndex = index;
  let current;
  try { current = new Recognition(); } catch (_) { dictationUI(false, "Dictation unavailable. You can still type."); return; }
  recognition = current; speechPhase = "starting";
  try {
    current.lang = navigator.language || "en-US";
    current.continuous = false;
    current.interimResults = false;
    current.maxAlternatives = 1;
  } catch (_) { cancelDictation("Dictation unavailable. " + DICTATION_FALLBACK, "configure-failed"); return; }
  let message = "Dictation stopped. Review or edit your notes.";
  const isCurrent = () => recognition === current && active && index === questionIndex && !$("question").hidden;
  const handled = new Set();
  current.onstart = () => {
    if (!isCurrent() || speechPhase !== "starting") return;
    speechPhase = "listening"; dictationUI(true, "Listening… Tap to stop.");
    speechTimeout(current, 60000, "listen-timeout");
  };
  current.onresult = e => {
    if (!isCurrent()) return;
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (!e.results[i].isFinal || handled.has(i)) continue;
      handled.add(i);
      const spoken = String(e.results[i][0].transcript || "").trim();
      if (!spoken) continue;
      const spacer = field.value && !/\s$/.test(field.value) ? " " : "";
      const remaining = field.maxLength - field.value.length;
      if (remaining > spacer.length) {
        let addition = (spacer + spoken).slice(0, remaining);
        // Do not split a surrogate pair at the field limit.
        if (/[\uD800-\uDBFF]$/.test(addition)) addition = addition.slice(0, -1);
        field.value += addition;
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (field.value.length >= field.maxLength || spoken.length + spacer.length > remaining) {
        cancelDictation(); dictationUI(false, "Note limit reached. Edit or continue to the next question."); return;
      }
    }
  };
  current.onerror = e => {
    if (!isCurrent()) return;
    message = e.error === "not-allowed" || e.error === "service-not-allowed" ? "Microphone access was not granted. You can still type."
      : e.error === "no-speech" ? "No speech detected. Try again or type."
      : "Dictation unavailable. Check your microphone or connection, or type.";
    cancelDictation(message, ["not-allowed","service-not-allowed","no-speech","network","audio-capture","aborted"].includes(e.error) ? e.error : "other-error");
  };
  current.onend = () => {
    if (recognition !== current) return;
    recognition = null; clearSpeechTimer(); speechPhase = "idle"; dictationUI(false, message);
  };
  try { dictationUI(true, "Starting microphone…"); speechTimeout(current, 8000, "start-timeout"); current.start(); }
  catch (_) { cancelDictation("Dictation unavailable. " + DICTATION_FALLBACK, "start-failed"); }
}

// ---- Screens -----------------------------------------------------------------------------------
function promptFor(i) { return ageBand === "adult" ? Q[i][2] : TEEN_PROMPTS[i] || Q[i][2]; }
function show(id, focus) {
  if (id !== "question") cancelDictation();
  for (const screen of screens) $(screen).hidden = screen !== id;
  $("clear").hidden = !active;
  if (id === "question" || id === "review") saveRecovery(id);
  if (focus) $(focus).focus();
  window.scrollTo(0, 0);
}
function updateAge() {
  ageBand = ageInputs.find(el => el.checked)?.value || "unknown";
  $("recovery-option").hidden = ageBand !== "adult";
  if (ageBand !== "adult") $("recovery-opt-in").checked = false;
  $("begin").disabled = ageBand === "child"; $("skip-context").disabled = ageBand === "child";
  $("age-guidance").textContent = ageBand === "child" ? "This prototype is not intended for children under 13. End this reflection."
    : ageBand === "adult" ? "Adult reflection; background remains optional. The optional AI organizer is available for adults only."
    : "Use age-appropriate, low-pressure prompts. Local only; obtain assent and any necessary guardian permission.";
}
function begin(skip) {
  updateAge(); if (ageBand === "child") return;
  prior = skip ? "" : $("prior-context").value; observed = skip ? "" : $("observed-context").value; preferences = skip ? "" : $("preferences").value;
  $("prior-context").value = prior; $("observed-context").value = observed; $("preferences").value = preferences;
  if (ageBand === "adult" && $("recovery-opt-in").checked) {
    if (readRecovery()) recoveryStatus("Another recovery draft exists; this session is memory-only.");
    else { recoveryId = newSessionId(); recoveryExpiry = Date.now() + RECOVERY_TTL; scheduleExpiry(); }
  }
  index = 0; question();
}
function capture() { if (!$("question").hidden) notes[index] = $("notes").value; }
function invalidateDrafts(i) { if (i !== undefined) { drafts[i] = ""; selected[i] = false; } dossier = null; chat = []; }
function question(focus = true) {
  cancelDictation();
  $("dictation-row").hidden = ageBand !== "adult";
  $("dictate").hidden = !Recognition;
  $("step").textContent = "Question " + (index + 1) + " of " + Q.length;
  $("progress").value = index + 1;
  $("prompt").textContent = promptFor(index);
  $("listen").textContent = ageBand === "adult" ? Q[index][3] : "Let them choose what to share. Keep it age-appropriate and allow them to skip or stop.";
  $("notes").value = notes[index];
  $("back").disabled = index === 0;
  $("next").textContent = index === Q.length - 1 ? "Review" : "Next";
  show("question", focus ? "prompt" : null);
}

function review() {
  cancelDictation(); capture();
  const parent = $("review-fields"); parent.replaceChildren();
  const context = $("review-context"); context.replaceChildren();
  const heading = document.createElement("strong"); heading.textContent = "Background — review or remove together"; context.append(heading);
  [["Previously shared", prior, v => { prior = v; $("prior-context").value = v; }], ["Facilitator impressions (not participant statements)", observed, v => { observed = v; $("observed-context").value = v; }]].forEach(([name, value, save], i) => {
    const label = document.createElement("label"); label.htmlFor = "context-review-" + i; label.textContent = name;
    const field = document.createElement("textarea"); field.id = label.htmlFor; field.value = value; field.maxLength = i ? 1200 : 1600;
    field.addEventListener("input", () => { save(field.value); invalidateDrafts(); saveRecovery("review"); }); context.append(label, field);
  });
  Q.forEach((q, i) => {
    const field = document.createElement("div"); field.className = "review-field";
    const label = document.createElement("label"); label.htmlFor = "review-note-" + i; label.textContent = (i + 1) + ". " + promptFor(i);
    const input = document.createElement("textarea"); input.id = label.htmlFor; input.maxLength = 1600; input.value = notes[i]; input.placeholder = "Not answered";
    input.addEventListener("input", () => { notes[i] = input.value; invalidateDrafts(i); saveRecovery("review"); });
    field.append(label, input); parent.append(field);
  });
  $("extra-notes").value = extra; $("unsure-notes").value = unsure;
  $("organize-ai").hidden = true;
  $("ai-availability").textContent = ageBand === "adult" ? "Checking whether the AI organizer is available…" : "The AI organizer is only offered for adult participants. Teen and unspecified-age sessions use the local organizer.";
  show("review", "review-title");
  if (ageBand === "adult") checkStatus();
}

// ---- Local organizer (unchanged behaviour) ------------------------------------------------------
function organize() {
  const parent = $("reflection"); parent.replaceChildren();
  let count = 0;
  if (prior.trim() || observed.trim()) {
    const card = document.createElement("div"); card.className = "panel note-card";
    const title = document.createElement("h3"); title.textContent = "Background only — not selected for read-aloud"; card.append(title);
    for (const [label, value] of [["Previously shared", prior], ["Facilitator impressions", observed]]) {
      if (!value.trim()) continue; const p = document.createElement("p"); p.textContent = label + ": " + value; card.append(p);
    }
    parent.append(card);
  }
  Q.forEach((q, i) => {
    const value = notes[i].trim(); if (!value) return; count++;
    const item = document.createElement("div"); item.className = "panel note-card";
    const title = document.createElement("h3"); title.textContent = q[1];
    const text = document.createElement("p"); text.textContent = "Source notes: " + value;
    const label = document.createElement("label"); label.htmlFor = "draft-" + i; label.textContent = "Your read-aloud wording";
    const draft = document.createElement("textarea"); draft.id = label.htmlFor; draft.maxLength = 1000; draft.value = drafts[i]; draft.placeholder = "You described… / You mentioned… / Does that sound right?";
    const check = document.createElement("input"); check.type = "checkbox"; check.checked = selected[i] && !!draft.value.trim(); check.disabled = !draft.value.trim();
    const selectLabel = document.createElement("label"); selectLabel.className = "inline"; selectLabel.append(check, document.createTextNode(" Include this reflection"));
    draft.addEventListener("input", () => { drafts[i] = draft.value; check.disabled = !draft.value.trim(); if (!draft.value.trim()) { check.checked = false; selected[i] = false; } });
    check.addEventListener("change", () => { selected[i] = check.checked; });
    item.append(title, text, label, draft, selectLabel); parent.append(item);
  });
  if (!count) { const p = document.createElement("p"); p.textContent = "No participant answers were recorded. Background alone is not enough to create a reflection."; parent.append(p); }
  readoutSource = "local"; show("result", "result-title");
}

// ---- Status / availability -------------------------------------------------------------------
async function api(path, { method = "GET", body, auth = true } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API.timeoutMs || 95000);
  const headers = { Accept: "application/json" };
  if (body) headers["Content-Type"] = "application/json";
  if (auth && accessCode) headers.Authorization = "Bearer " + accessCode;
  let res;
  try {
    res = await fetch(API.base + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: controller.signal, credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer" });
  } catch (err) {
    clearTimeout(timer);
    throw Object.assign(new Error(err.name === "AbortError" ? "The request took too long. Check the connection and try again, or use the local organizer." : navigator.onLine === false ? "You appear to be offline. The local organizer works without a connection." : "Could not reach the AI organizer."), { code: err.name === "AbortError" ? "timeout" : "network" });
  }
  clearTimeout(timer);
  let data = null;
  try { data = await res.json(); } catch { /* fall through */ }
  if (!res.ok) throw Object.assign(new Error((data && data.message) || ("Request failed (" + res.status + ")")), { code: (data && data.error) || "http_" + res.status, status: res.status, data });
  return data;
}

async function checkStatus() {
  try {
    status = await api("/status", { auth: false });
  } catch (err) {
    status = null;
    $("ai-availability").textContent = "The AI organizer could not be reached (" + err.message + "). The local organizer is always available.";
    return;
  }
  if (!status.enabled) {
    $("ai-availability").textContent = "The AI organizer is not available on this server (" + (status.reason || "disabled") + "). Use the local organizer.";
    return;
  }
  const eligible = status.models.filter(m => m.eligible);
  if (!eligible.length) { $("ai-availability").textContent = "No approved model currently meets the privacy requirements. Use the local organizer."; return; }
  $("ai-availability").textContent = (status.mode === "mock" ? "TEST MODE: the AI organizer returns stand-in text, not a model's. " : "") + "The optional AI organizer is available for adult participants, with separate consent.";
  $("organize-ai").hidden = false;
}

// ---- Session payload ------------------------------------------------------------------------
function buildSession() {
  const uncertainties = [];
  if (unsure.trim()) unsure.split(/\n+/).map(s => s.trim()).filter(Boolean).slice(0, 8).forEach((text, i) => uncertainties.push({ id: "u" + (i + 1), text }));
  const additional = extra.trim() ? extra.split(/\n{2,}/).map(s => s.trim()).filter(Boolean).slice(0, 6).map((text, i) => ({ id: "x" + (i + 1), text })) : [];
  return {
    schema: "inner-depth.session.v1",
    age_band: ageBand,
    consent: { external_ai: $("ai-consent-participant").checked, participant_reviewed: $("ai-consent-facilitator").checked, version: "2026-11" },
    language: navigator.language ? navigator.language.slice(0, 16) : "unspecified",
    background: { participant_reported: prior.trim(), facilitator_impressions: observed.trim() },
    communication_preferences: preferences.trim(),
    answers: Q.map((q, i) => ({ id: "q" + (i + 1), question_key: q[0], question: promptFor(i), answer: notes[i].trim(), skipped: !notes[i].trim() })),
    additional,
    uncertainties
  };
}
function routingOptions(extraOpts = {}) {
  const mode = document.querySelector('input[name="routing"]:checked')?.value || "adaptive";
  const o = { session_id: sessionId, routing_mode: mode, budget_usd: Number($("budget").value) || undefined, ...extraOpts };
  if (mode === "manual") o.model = $("manual-model").value;
  return o;
}
function allText() { return [...notes, prior, observed, extra, unsure].join("\n"); }

// ---- AI consent screen ----------------------------------------------------------------------
function openAiConsent() {
  extra = $("extra-notes").value; unsure = $("unsure-notes").value;
  if (!sessionId) sessionId = newSessionId();
  $("retention-text").textContent = status && status.privacy ? status.privacy.retention_statement + " Provider: " + status.provider + "." : "Unavailable.";
  const limits = status && status.limits;
  if (limits) {
    $("budget").max = limits.max_session_cost_usd; $("budget").value = Math.min(Number($("budget").value) || limits.max_session_cost_usd, limits.max_session_cost_usd).toFixed(2);
    $("budget-hint").textContent = "Up to $" + limits.max_session_cost_usd.toFixed(2) + " per session and " + limits.max_requests_per_session + " AI requests, set by the server. Reasoning tokens count as output.";
  }
  const select = $("manual-model"); select.replaceChildren();
  const table = $("model-table"); table.replaceChildren();
  for (const m of status.models) {
    if (m.eligible) { const opt = document.createElement("option"); opt.value = m.id; opt.textContent = m.display_name + " (" + m.tier + ", $" + m.pricing_per_million.prompt + " in / $" + m.pricing_per_million.completion + " out per M tokens)"; select.append(opt); }
    const row = document.createElement("p"); row.className = "small";
    const evalText = m.evaluation && m.evaluation.status && m.evaluation.status !== "pending" && m.evaluation.status !== "not-run" ? " · evaluation: " + m.evaluation.status + (m.evaluation.score !== undefined ? " (" + m.evaluation.score + ")" : "") : " · evaluation pending";
    row.textContent = (m.eligible ? "✓ " : "✗ ") + m.display_name + " — " + m.tier + " tier · " + m.status + (m.eligible ? " · ZDR via " + (m.zdr_providers || []).join(", ") : " · " + m.reasons.join("; ")) + evalText;
    table.append(row);
  }
  $("manual-model").disabled = document.querySelector('input[name="routing"]:checked').value !== "manual";
  $("estimate-kv").replaceChildren(); setStatus("ai-status", "");
  updateGenerateButton();
  show("ai-consent", "ai-consent-title");
}
function updateGenerateButton() {
  $("ai-generate").disabled = !($("ai-consent-participant").checked && $("ai-consent-facilitator").checked && $("access-code").value.trim().length >= 12) || busy;
}
function setStatus(id, text, kind) { const el = $(id); el.textContent = text; el.className = (id === "chat-status" ? "status small" : "status") + (kind ? " " + kind : ""); }
function kv(parent, pairs) {
  parent.replaceChildren();
  for (const [k, v] of pairs) { if (v === undefined || v === null || v === "") continue; const dt = document.createElement("dt"); dt.textContent = k; const dd = document.createElement("dd"); dd.textContent = v; parent.append(dt, dd); }
}
function usd(n) { return n === null || n === undefined ? "—" : "$" + Number(n).toFixed(4); }

async function estimate() {
  accessCode = $("access-code").value.trim();
  if (!accessCode) { setStatus("ai-status", "Enter the facilitator access code first.", "bad"); return; }
  setBusy(true, "ai-status", "Estimating…");
  try {
    const out = await api("/reflect", { method: "POST", body: { session: { ...buildSession(), consent: { external_ai: true, participant_reviewed: true, version: "2026-11" } }, options: routingOptions({ dry_run: true }) } });
    kv($("estimate-kv"), [["Tier", out.routing.tier + " — " + out.routing.tier_reason], ["Model", out.routing.model_display_name], ["Estimated cost", usd(out.estimate.typical_usd) + " typical, up to " + usd(out.estimate.max_usd) + " (estimate, not actual)"], ["Session spent so far", usd(out.session_spent_usd)]]);
    setStatus("ai-status", "Estimate ready. Nothing was sent to a model.", "ok");
  } catch (err) { setStatus("ai-status", err.message, "bad"); }
  finally { setBusy(false); }
}
function setBusy(on, statusId, text) {
  busy = on;
  ["ai-generate", "ai-estimate", "ai-refine", "chat-send"].forEach(id => { if ($(id)) $(id).disabled = on || (id === "ai-generate" && !($("ai-consent-participant").checked && $("ai-consent-facilitator").checked && $("access-code").value.trim().length >= 12)); });
  if (statusId) { const el = $(statusId); el.replaceChildren(); if (on) { const s = document.createElement("span"); s.className = "spinner"; s.setAttribute("aria-hidden", "true"); el.append(s); } el.append(document.createTextNode(text || "")); el.className = statusId === "chat-status" ? "status small" : "status"; }
}

async function generate(extraOpts = {}) {
  accessCode = $("access-code").value.trim();
  if (!$("ai-consent-participant").checked || !$("ai-consent-facilitator").checked) return;
  if (SAFETY && SAFETY.screen(allText())) { showSafety(SAFETY.guidance, "local"); return; }
  setBusy(true, "ai-status", "Organizing with AI… this can take up to a minute.");
  try {
    const out = await api("/reflect", { method: "POST", body: { session: buildSession(), options: routingOptions(extraOpts) } });
    dossier = prepareDossier(out);
    chat = [];
    renderDossier();
  } catch (err) {
    setStatus("ai-status", err.message + (err.code === "facilitator_code_invalid" || err.code === "facilitator_code_required" ? "" : " You can retry, or use the local organizer."), "bad");
    if (err.status === 401) { accessCode = ""; }
  } finally { setBusy(false); }
}

// Shapes the server response into editable facilitator state.
function prepareDossier(out) {
  const r = out.result;
  return {
    status: r.status,
    opening: r.opening || "",
    closing: r.closing || "",
    themes: (r.themes || []).map(t => ({ ...t, include: false, edited: false, clarification: "", original_read_aloud: t.read_aloud })),
    questions: (r.follow_up_questions || []).map(q => ({ text: q, include: false })),
    ambiguities: r.ambiguities || [],
    rejected: r.rejected || [],
    insufficient_reason: r.insufficient_reason || null,
    safety_support: r.safety_support || null,
    routing: out.routing,
    cost: out.cost || {},
    mode: out.mode,
    history: [{ at: Date.now(), routing: out.routing, cost: out.cost }]
  };
}

function showSafety(lines, source) {
  const box = $("ai-safety"); box.replaceChildren();
  const h = document.createElement("h3"); h.textContent = "Pause the reflection";
  const list = document.createElement("ul");
  for (const line of Array.isArray(lines) ? lines : String(lines).split(/(?<=\.)\s+/)) { const li = document.createElement("li"); li.textContent = line; list.append(li); }
  const note = document.createElement("p"); note.className = "small"; note.textContent = source === "local" ? "This came from a check on this device before anything was sent. No notes left this device." : "The model stopped ordinary organizing and returned only this guidance.";
  box.append(h, list, note); box.hidden = false;
  $("ai-body").hidden = true; $("chat-panel").hidden = true; $("ai-refine").hidden = true; $("ai-read").hidden = true;
  $("routing-panel").replaceChildren(); $("ai-insufficient").hidden = true;
  readoutSource = "ai"; show("ai-result", "ai-result-title");
}

// ---- AI result screen --------------------------------------------------------------------------
function renderRouting() {
  const r = dossier.routing, c = dossier.cost || {};
  const panel = $("routing-panel"); panel.replaceChildren();
  const title = document.createElement("strong"); title.textContent = dossier.mode === "mock" ? "TEST MODE — stand-in output, not a model's" : "How this draft was made"; panel.append(title);
  const dl = document.createElement("dl"); dl.className = "kv";
  const totalSpent = c.session_spent_usd;
  kv(dl, r ? [
    ["Model used", (r.model_used || r.model_requested) + (r.provider_used ? " via " + r.provider_used : "")],
    ["Tier", r.tier + (r.tier_demoted ? " (requested tier had no eligible model)" : "")],
    ["Why", r.tier_reason + " · complexity " + r.complexity_score + "/10 · " + r.routing_mode + " mode"],
    ["Escalation", r.escalated ? "Yes: " + r.attempts.map(a => a.tier + "→" + (a.outcome || "")).join(", ") : "No"],
    ["This request", (c.actual_usd === null || c.actual_usd === undefined ? "actual cost not reported; estimate up to " + usd(c.estimate && c.estimate.max_usd) : "actual " + usd(c.actual_usd)) + (c.estimate ? " (estimated " + usd(c.estimate.typical_usd) + ")" : "")],
    ["Session total", (totalSpent !== undefined ? usd(totalSpent) + " actual" : "—") + (c.budget_usd ? " of $" + Number(c.budget_usd).toFixed(2) + " budget" : "") + (c.requests_used ? " · " + c.requests_used + "/" + c.requests_max + " requests" : "")],
    ["Privacy", "Zero Data Retention endpoints only · data collection denied · no tools or plugins"]
  ] : [["Model", "none: the safety check ran before any request"]]);
  panel.append(dl);
}

function renderDossier() {
  $("ai-safety").hidden = true; $("ai-insufficient").hidden = true; $("ai-body").hidden = false; $("chat-panel").hidden = false; $("ai-refine").hidden = false; $("ai-read").hidden = false;
  renderRouting();
  if (dossier.status === "safety_support") { showSafety(dossier.safety_support, "model"); return; }
  if (dossier.status === "insufficient_notes") {
    const box = $("ai-insufficient"); box.replaceChildren();
    const h = document.createElement("h3"); h.textContent = "Not enough to organize yet";
    const p = document.createElement("p"); p.textContent = dossier.insufficient_reason || "The notes did not hold enough participant-reported content.";
    const hint = document.createElement("p"); hint.className = "small"; hint.textContent = "Nothing is wrong with the conversation. You can add what was said under the questions or volunteered, ask a clarifying question, or use the local organizer.";
    box.append(h, p, hint); box.hidden = false; $("ai-body").hidden = true; $("chat-panel").hidden = true;
    renderAmbiguities(); $("ai-ambiguities-wrap").hidden = !dossier.ambiguities.length; if (dossier.ambiguities.length) { box.append($("ai-ambiguities-wrap")); $("ai-ambiguities-wrap").hidden = false; }
    renderRejected(); if (dossier.rejected.length) { box.append($("ai-rejected-wrap")); $("ai-rejected-wrap").hidden = false; }
    readoutSource = "ai"; show("ai-result", "ai-result-title"); return;
  }
  $("ai-opening").value = dossier.opening; $("ai-closing").value = dossier.closing;
  renderThemes(); renderQuestions(); renderAmbiguities(); renderRejected(); renderChat();
  readoutSource = "ai"; show("ai-result", "ai-result-title");
}

function badge(text, kind) { const b = document.createElement("span"); b.className = "badge" + (kind ? " " + kind : ""); b.textContent = text; return b; }
function evidenceFor(ids) {
  const items = [];
  for (const id of ids) {
    const qi = /^q(\d+)$/.exec(id); if (qi) { const i = Number(qi[1]) - 1; if (Q[i]) items.push([Q[i][1] + " (" + id + ")", notes[i].trim()]); continue; }
    const xi = /^x(\d+)$/.exec(id); if (xi) { const parts = extra.split(/\n{2,}/).map(s => s.trim()).filter(Boolean); items.push(["Volunteered (" + id + ")", parts[Number(xi[1]) - 1] || ""]); }
  }
  return items;
}

function renderThemes() {
  const parent = $("ai-themes"); parent.replaceChildren();
  if (!dossier.themes.length) { const p = document.createElement("p"); p.textContent = "No themes survived validation."; parent.append(p); return; }
  dossier.themes.forEach((t, i) => {
    const card = document.createElement("div"); card.className = "panel note-card"; card.id = "theme-" + t.id;
    const head = document.createElement("div");
    const h = document.createElement("h3"); h.textContent = t.title; head.append(h);
    head.append(badge(t.confidence === "clear" ? "said in these terms" : "connects several notes", t.confidence === "clear" ? "ok" : undefined));
    head.append(badge("grounding: " + t.grounding, t.grounding === "supported" ? "ok" : "warn"));
    if (t.edited) head.append(badge("edited by you", "warn"));
    card.append(head);
    const label = document.createElement("label"); label.htmlFor = "theme-text-" + t.id; label.className = "small"; label.textContent = "Read-aloud wording (second person, editable)";
    const text = document.createElement("textarea"); text.id = label.htmlFor; text.value = t.read_aloud; text.maxLength = 1200; text.style.minHeight = "96px";
    text.addEventListener("input", () => { t.read_aloud = text.value; t.edited = text.value.trim() !== t.original_read_aloud.trim(); if (!text.value.trim()) { t.include = false; include.checked = false; } });
    card.append(label, text);
    const include = document.createElement("input"); include.type = "checkbox"; include.checked = t.include;
    const incLabel = document.createElement("label"); incLabel.className = "inline"; incLabel.append(include, document.createTextNode(" Include in the read-aloud"));
    include.addEventListener("change", () => { t.include = include.checked && !!text.value.trim(); include.checked = t.include; });
    card.append(incLabel);
    const details = document.createElement("details");
    const summary = document.createElement("summary"); summary.textContent = "Supporting answers (" + t.answer_ids.join(", ") + "), principles and notes"; details.append(summary);
    for (const [name, value] of evidenceFor(t.answer_ids)) { const ev = document.createElement("div"); ev.className = "evidence"; ev.textContent = name + ": " + (value || "(empty)"); details.append(ev); }
    if (t.facilitator_note) { const n = document.createElement("p"); n.className = "small"; n.textContent = "Facilitator note from the model: " + t.facilitator_note; details.append(n); }
    for (const w of t.warnings || []) { const n = document.createElement("p"); n.className = "small"; n.textContent = "Validator: " + w; details.append(n); }
    if (t.principles && t.principles.length) {
      const ph = document.createElement("p"); ph.className = "small"; ph.textContent = "Principles that shaped the wording (facilitator only, never a label for the participant):"; details.append(ph);
      for (const p of t.principles) { const pr = document.createElement("div"); pr.className = "evidence"; pr.textContent = p.thinker + " — " + p.concept + ". " + p.summary + " Source: " + p.source + " Limits: " + p.evidence_limitations; details.append(pr); }
    } else { const ph = document.createElement("p"); ph.className = "small"; ph.textContent = "No library principle was cited for this wording."; details.append(ph); }
    card.append(details);
    const clarLabel = document.createElement("label"); clarLabel.htmlFor = "clar-" + t.id; clarLabel.className = "small"; clarLabel.textContent = "Your clarification (read aloud after this theme, optional)";
    const clar = document.createElement("textarea"); clar.id = clarLabel.htmlFor; clar.value = t.clarification; clar.maxLength = 400; clar.style.minHeight = "56px"; clar.placeholder = "e.g. When you said this, I think you were talking about work rather than home. Is that right?";
    clar.addEventListener("input", () => { t.clarification = clar.value; });
    card.append(clarLabel, clar);
    const actions = document.createElement("div"); actions.className = "card-actions";
    const instr = document.createElement("input"); instr.type = "text"; instr.maxLength = 200; instr.placeholder = "Regenerate how? e.g. gentler, shorter, closer to their words"; instr.setAttribute("aria-label", "Regeneration request for " + t.title);
    const regen = document.createElement("button"); regen.className = "small"; regen.textContent = "Regenerate";
    regen.addEventListener("click", () => regenerate(t, instr.value.trim(), regen));
    const reject = document.createElement("button"); reject.className = "small danger"; reject.textContent = "Reject";
    reject.addEventListener("click", () => { dossier.themes.splice(dossier.themes.indexOf(t), 1); dossier.rejected.push({ title: t.title, reasons: ["rejected by facilitator"] }); renderThemes(); renderRejected(); });
    const restore = document.createElement("button"); restore.className = "small"; restore.textContent = "Restore original"; restore.hidden = !t.edited;
    restore.addEventListener("click", () => { t.read_aloud = t.original_read_aloud; t.edited = false; renderThemes(); });
    actions.append(instr, regen, restore, reject);
    const st = document.createElement("p"); st.className = "status small"; st.id = "theme-status-" + t.id;
    card.append(actions, st);
    parent.append(card);
  });
}

function renderQuestions() {
  const parent = $("ai-questions"); parent.replaceChildren();
  $("ai-questions-panel").hidden = !dossier.questions.length;
  dossier.questions.forEach((q, i) => {
    const label = document.createElement("label"); label.className = "inline";
    const box = document.createElement("input"); box.type = "checkbox"; box.checked = q.include; box.addEventListener("change", () => { q.include = box.checked; });
    label.append(box, document.createTextNode(" " + q.text)); parent.append(label);
  });
}
function renderAmbiguities() {
  const parent = $("ai-ambiguities"); parent.replaceChildren();
  $("ai-ambiguities-wrap").hidden = !dossier.ambiguities.length;
  for (const a of dossier.ambiguities) {
    const p = document.createElement("p"); p.className = "small"; p.textContent = (a.answer_id ? a.answer_id + ": " : "") + a.note + (a.clarifying_question ? " — You could ask: “" + a.clarifying_question + "”" : ""); parent.append(p);
  }
}
function renderRejected() {
  const parent = $("ai-rejected"); parent.replaceChildren();
  $("ai-rejected-wrap").hidden = !dossier.rejected.length;
  for (const r of dossier.rejected) { const p = document.createElement("p"); p.className = "small"; p.textContent = (r.title || "(untitled)") + ": " + r.reasons.join("; "); parent.append(p); }
}

async function regenerate(theme, instruction, button) {
  const statusEl = $("theme-status-" + theme.id);
  button.disabled = true; statusEl.textContent = "Regenerating…";
  try {
    const out = await api("/regenerate", { method: "POST", body: { session: buildSession(), options: routingOptions(), theme: { id: theme.id, title: theme.title, read_aloud: theme.read_aloud, answer_ids: theme.answer_ids, facilitator_edited: theme.edited }, instruction } });
    recordCost(out);
    const r = out.result;
    if (r.status === "safety_support") { showSafety(r.safety_support, "model"); return; }
    if (r.status !== "theme") { statusEl.textContent = "Not regenerated: " + (r.reason || "the notes cannot support that wording."); return; }
    Object.assign(theme, { title: r.theme.title, read_aloud: r.theme.read_aloud, original_read_aloud: r.theme.read_aloud, principle_ids: r.theme.principle_ids, principles: r.theme.principles, confidence: r.theme.confidence, grounding: r.theme.grounding, facilitator_note: r.theme.facilitator_note, warnings: r.theme.warnings, edited: false, include: false });
    renderThemes(); renderRouting();
    $("theme-status-" + theme.id).textContent = "Regenerated with " + (out.routing.model_used || out.routing.model_requested) + " (" + out.routing.tier + "). Review it again before including.";
  } catch (err) { statusEl.textContent = err.message; }
  finally { button.disabled = false; }
}
function recordCost(out) {
  if (!dossier) return;
  dossier.cost = { ...dossier.cost, ...out.cost, estimate: out.cost && out.cost.estimate };
  dossier.routing = out.routing || dossier.routing;
  dossier.history.push({ at: Date.now(), routing: out.routing, cost: out.cost });
}

async function refine() {
  if (!dossier || busy) return;
  if (!window.confirm("Regenerate the whole draft with the advanced tier? This uses more of the session budget and replaces the current cards (your edits will be lost).")) return;
  setBusy(true, "ai-status", "");
  const keepAccess = accessCode;
  try {
    const out = await api("/reflect", { method: "POST", body: { session: buildSession(), options: routingOptions({ tier: "advanced" }) } });
    const prev = dossier;
    dossier = prepareDossier(out); dossier.history = [...prev.history, ...dossier.history];
    renderDossier();
  } catch (err) { window.alert(err.message); accessCode = keepAccess; }
  finally { setBusy(false); }
}

// ---- Conversation assistant (facilitator-facing) ------------------------------------------------
function renderChat() {
  const log = $("chat-log"); log.replaceChildren();
  for (const m of chat) {
    const div = document.createElement("div"); div.className = "msg " + (m.role === "facilitator" ? "me" : "ai"); div.textContent = m.text;
    if (m.meta) { const s = document.createElement("span"); s.className = "small"; s.textContent = m.meta; div.append(s); }
    if (m.revisions && m.revisions.length) {
      for (const r of m.revisions) {
        const box = document.createElement("div"); box.className = "evidence"; box.textContent = "Proposed for " + r.theme_id + " (" + r.title + "): " + r.read_aloud;
        const apply = document.createElement("button"); apply.className = "small"; apply.textContent = "Apply to card " + r.theme_id; apply.style.marginTop = "6px";
        apply.addEventListener("click", () => { const t = dossier.themes.find(x => x.id === r.theme_id); if (!t) return; t.read_aloud = r.read_aloud; t.title = r.title; t.edited = true; t.include = false; renderThemes(); $("theme-" + t.id).scrollIntoView({ behavior: "smooth", block: "center" }); });
        box.append(document.createElement("br"), apply); div.append(box);
      }
    }
    log.append(div);
  }
  log.scrollTop = log.scrollHeight;
}
async function sendChat() {
  const input = $("chat-input"); const message = input.value.trim();
  if (!message || !dossier || busy) return;
  if (SAFETY && SAFETY.screen(message)) { showSafety(SAFETY.guidance, "local"); return; }
  chat.push({ role: "facilitator", text: message }); renderChat(); input.value = "";
  setBusy(true, "chat-status", "Thinking…");
  try {
    const history = chat.slice(0, -1).slice(-12).map(m => ({ role: m.role, text: m.text }));
    const out = await api("/chat", { method: "POST", body: { session: buildSession(), options: routingOptions(), themes: dossier.themes.map(t => ({ id: t.id, title: t.title, read_aloud: t.read_aloud, answer_ids: t.answer_ids, facilitator_edited: t.edited })), history, message } });
    recordCost(out); renderRouting();
    const r = out.result;
    if (r.safety_support) { showSafety(r.safety_support, "model"); return; }
    const meta = (out.routing ? out.routing.model_used || out.routing.model_requested : "") + " · " + (out.routing ? out.routing.tier + " tier, " + out.routing.task.replace("_", " ") : "") + " · " + (out.cost && out.cost.actual_usd !== null && out.cost.actual_usd !== undefined ? usd(out.cost.actual_usd) + " actual" : "cost pending") + (r.grounded_in && r.grounded_in.length ? " · grounded in " + r.grounded_in.join(", ") : "");
    chat.push({ role: "assistant", text: r.reply + (r.caution ? "\n\nCaution: " + r.caution : "") + (r.rejected_revisions && r.rejected_revisions.length ? "\n\n(" + r.rejected_revisions.length + " proposed rewording(s) failed validation and were not shown.)" : ""), meta, revisions: r.proposed_revisions || [] });
    renderChat(); setStatus("chat-status", "", "");
  } catch (err) { setStatus("chat-status", err.message, "bad"); }
  finally { setBusy(false); }
}

// ---- Readout -------------------------------------------------------------------------------------
function readout() {
  const parent = $("readout-items"); parent.replaceChildren(); let count = 0;
  const openingEl = $("readout-opening"), closingEl = $("readout-closing");
  if (readoutSource === "ai" && dossier) {
    dossier.opening = $("ai-opening").value; dossier.closing = $("ai-closing").value;
    openingEl.replaceChildren(para(dossier.opening.trim() || "Thank you for trusting me with this. You can disagree with anything I say."));
    for (const t of dossier.themes) {
      if (!t.include || !t.read_aloud.trim()) continue; count++;
      const card = document.createElement("div"); card.className = "panel note-card";
      const h = document.createElement("h3"); h.textContent = t.title; card.append(h, para(t.read_aloud.trim()));
      if (t.clarification.trim()) card.append(para(t.clarification.trim()));
      parent.append(card);
    }
    const qs = dossier.questions.filter(q => q.include);
    if (qs.length) { const card = document.createElement("div"); card.className = "panel note-card"; const h = document.createElement("h3"); h.textContent = "If you would like to say more"; card.append(h); for (const q of qs) card.append(para(q.text)); parent.append(card); }
    closingEl.replaceChildren(para(dossier.closing.trim() || "What feels true to you here is yours to decide. You don't have to make sense of everything today."));
  } else {
    openingEl.replaceChildren(para("Thank you for trusting me with this. I want to check that I've understood you. You can disagree with anything I say, and you don't have to make sense of everything today."));
    Q.forEach((q, i) => {
      if (!selected[i] || !drafts[i].trim() || !notes[i].trim()) return; count++;
      const card = document.createElement("div"); card.className = "panel note-card";
      const h = document.createElement("h3"); h.textContent = q[1]; card.append(h, para(drafts[i].trim())); parent.append(card);
    });
    const strong = document.createElement("strong"); strong.textContent = "An invitation, not a conclusion";
    closingEl.replaceChildren(strong, para("What feels true to you here? Is there anything you would change? What, if anything, would you like to carry forward?"));
  }
  if (!count) parent.append(para("No reflections selected. You can simply thank them for sharing, or return to review."));
  show("readout", "read-title");
}
function para(text) { const p = document.createElement("p"); p.textContent = text; return p; }

// ---- Erase ---------------------------------------------------------------------------------------
function erase() {
  cancelDictation(); disableRecovery(""); $("recovery-opt-in").checked = false;
  notes = Q.map(() => ""); index = 0; active = false; prior = ""; observed = ""; preferences = ""; extra = ""; unsure = "";
  drafts = Q.map(() => ""); selected = Q.map(() => false);
  status = null; accessCode = ""; sessionId = ""; dossier = null; chat = []; readoutSource = "local"; busy = false;
  ["prior-context", "observed-context", "preferences", "notes", "extra-notes", "unsure-notes", "access-code", "ai-opening", "ai-closing", "chat-input"].forEach(id => { $(id).value = ""; });
  ["review-context", "review-fields", "reflection", "readout-items", "ai-themes", "ai-questions", "ai-ambiguities", "ai-rejected", "routing-panel", "ai-safety", "ai-insufficient", "chat-log", "estimate-kv", "model-table", "manual-model"].forEach(id => $(id).replaceChildren());
  ["ai-consent-participant", "ai-consent-facilitator", "consent"].forEach(id => { $(id).checked = false; });
  document.querySelector('input[name="routing"][value="adaptive"]').checked = true;
  ageInputs.forEach(el => el.checked = el.value === "unknown"); updateAge();
  $("start").disabled = true; setStatus("ai-status", ""); setStatus("chat-status", "");
  show("intro", "consent"); refreshRecoveryOffer();
}
function hasContent() {
  return notes.some(n => n.trim()) || $("notes").value.trim() || prior.trim() || observed.trim() || $("prior-context").value.trim() || $("observed-context").value.trim() || drafts.some(n => n.trim()) || !!dossier || extra.trim() || unsure.trim();
}
function confirmErase() { return !hasContent() || window.confirm("End this reflection and erase all notes, drafts and AI output?"); }

// ---- Wiring --------------------------------------------------------------------------------------
$("consent").addEventListener("change", refreshRecoveryOffer);
$("restore-draft").addEventListener("click", restoreRecovery);
$("discard-draft").addEventListener("click", () => {
  try { localStorage.removeItem(RECOVERY_KEY); recoveryStatus(""); }
  catch (_) { recoveryStatus("Could not delete the recovery copy. Clear this site's data if needed."); }
  refreshRecoveryOffer();
});
$("recovery-off").addEventListener("click", () => disableRecovery("Recovery off. Open session remains in memory."));
window.addEventListener("storage", e => {
  if (e.key !== RECOVERY_KEY && e.key !== null) return;
  if (!active) refreshRecoveryOffer();
  else if (recoveryId && readRecovery()?.id !== recoveryId) disableRecovery("Recovery was changed in another tab. Open session is memory-only.", false);
});
$("start").addEventListener("click", () => { if (!$("consent").checked || readRecovery()) { refreshRecoveryOffer(); return; } active = true; index = 0; updateAge(); show("context", "context-title"); });
ageInputs.forEach(el => el.addEventListener("change", updateAge));
$("begin").addEventListener("click", () => begin(false));
$("skip-context").addEventListener("click", () => begin(true));
$("notes").addEventListener("input", () => { capture(); invalidateDrafts(index); saveRecovery("question"); });
$("dictate").addEventListener("click", toggleDictation);
$("dictation-agree").addEventListener("click", startDictation);
$("dictation-decline").addEventListener("click", () => cancelDictation());
document.addEventListener("visibilitychange", () => {
  if (document.hidden) cancelDictation();
  else if (!active) refreshRecoveryOffer();
  else if (recoveryId && Date.now() >= recoveryExpiry) disableRecovery("Recovery expired; your open session remains in memory.");
});
$("back").addEventListener("click", () => { cancelDictation(); capture(); if (index > 0) { index--; question(); } });
$("next").addEventListener("click", () => { cancelDictation(); capture(); if (index < Q.length - 1) { index++; question(); } else review(); });
$("skip").addEventListener("click", () => { cancelDictation(); capture(); if (notes[index].trim() && !window.confirm("Skip this question and remove its notes?")) return; notes[index] = ""; invalidateDrafts(index); $("notes").value = ""; if (index < Q.length - 1) { index++; question(); } else review(); });
$("finish").addEventListener("click", review);
$("resume").addEventListener("click", () => { extra = $("extra-notes").value; unsure = $("unsure-notes").value; question(); });
$("extra-notes").addEventListener("input", () => { extra = $("extra-notes").value; invalidateDrafts(); saveRecovery("review"); });
$("unsure-notes").addEventListener("input", () => { unsure = $("unsure-notes").value; invalidateDrafts(); saveRecovery("review"); });
$("organize").addEventListener("click", () => { extra = $("extra-notes").value; unsure = $("unsure-notes").value; organize(); });
$("organize-ai").addEventListener("click", () => { if (ageBand !== "adult" || !status || !status.enabled) return; if (dossier) { renderDossier(); return; } openAiConsent(); });
$("edit").addEventListener("click", review);
$("read").addEventListener("click", () => { readoutSource = "local"; readout(); });
$("back-selection").addEventListener("click", () => { if (readoutSource === "ai" && dossier) renderDossier(); else organize(); });
["ai-consent-participant", "ai-consent-facilitator"].forEach(id => $(id).addEventListener("change", updateGenerateButton));
$("access-code").addEventListener("input", updateGenerateButton);
document.querySelectorAll('input[name="routing"]').forEach(r => r.addEventListener("change", () => { $("manual-model").disabled = document.querySelector('input[name="routing"]:checked').value !== "manual"; }));
$("ai-back").addEventListener("click", review);
$("ai-estimate").addEventListener("click", estimate);
$("ai-generate").addEventListener("click", () => generate());
$("ai-refine").addEventListener("click", refine);
$("ai-edit-notes").addEventListener("click", review);
$("ai-local").addEventListener("click", organize);
$("ai-read").addEventListener("click", () => { readoutSource = "ai"; readout(); });
$("chat-send").addEventListener("click", sendChat);
$("chat-input").addEventListener("keydown", e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) sendChat(); });
$("chat-clear").addEventListener("click", () => { chat = []; renderChat(); });
$("clear").addEventListener("click", () => { cancelDictation(); if (confirmErase()) erase(); });
$("done").addEventListener("click", () => { if (confirmErase()) erase(); });
$("home-link").addEventListener("click", e => { cancelDictation(); if (active && !confirmErase()) { e.preventDefault(); return; } if (active) erase(); });
window.addEventListener("pagehide", () => {
  if (!active) return;
  if (recoveryId) { capture(); saveRecovery(); cancelDictation(); }
  else erase();
});
refreshRecoveryOffer();
})();
