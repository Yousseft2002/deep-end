(() => {
"use strict";

const VERSION = self.DEEPEND_VERSION || "dev";
const CHANGES = self.DEEPEND_CHANGES || [];
const { LEVELS, GROUPS, Q, FOLLOW = [], MOMENTS = {} } = self.DEEPEND_BANK;
const WATER = ["#146468","#004C5F","#03324F","#0D1A37","#060919"];
const SKY = "#071A28";   // the sunset behind the home title, so the status bar matches it there
const NOTE_REASONS = ["Great question","Awkward","Confusing","Wrong depth","Too similar to another"];
const $ = id => document.getElementById(id);

// ---------- native shell ----------
// The same files run as a website and inside the App Store / Play Store builds (Capacitor).
// In the store builds we use real haptics and the system share sheet; on the web we fall back.
const Cap = window.Capacitor;
const NATIVE = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
const plugin = name => NATIVE && Cap.Plugins && Cap.Plugins[name];
document.documentElement.classList.toggle("native", NATIVE);
function haptic(kind = "light"){
  const H = plugin("Haptics");
  if(H){ (kind === "select" ? H.selectionChanged() : H.impact({ style: kind === "medium" ? "MEDIUM" : "LIGHT" })).catch(() => {}); return; }
  if(navigator.vibrate) navigator.vibrate(kind === "medium" ? 14 : 8);
}
async function shareText(title, text){
  const S = plugin("Share");
  if(S){ await S.share({ title, text, dialogTitle: title }); return true; }
  if(navigator.share){ await navigator.share({ title, text }); return true; }
  return false;
}

// ---------- storage: every read/write guarded; private mode must not break the game ----------
const store = {
  get(k, fb){ try { const v = localStorage.getItem(k); return v == null ? fb : JSON.parse(v); } catch(e){ return fb; } },
  set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){} }
};
const K = { saved:"deepend-saved", seen:"deepend-seen-v1", notes:"deepend-notes", prefs:"deepend-prefs",
            last:"deepend-last", ver:"deepend-last-version" };

let saved = store.get(K.saved, []);
let seen  = store.get(K.seen, {});
let notes = store.get(K.notes, []);
// Question transitions start off for anyone whose phone asks for reduced motion.
const REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
// Moving water starts off on phones with 2 GB of memory or less (Chrome reports it; others don't, and get it on).
const LOW_MEMORY = (navigator.deviceMemory || 8) <= 2;
let prefs = Object.assign({ passScreen:true, transitions:!REDUCED, moments:true, fish:true, water:!REDUCED && !LOW_MEMORY, talk:false, nameA:"", nameB:"", general:"" }, store.get(K.prefs, {}));
const paintWater = () => document.documentElement.classList.toggle("still", !prefs.water);
paintWater();
const savePrefs = () => store.set(K.prefs, prefs);

const state = { label:"", phrase:"", cat:"friend", level:1, current:null, turn:0 };

// ---------- toast ----------
let toastTimer;
function toast(text, action, onAction){
  clearTimeout(toastTimer);
  $("toastText").textContent = text;
  const b = $("toastBtn");
  b.hidden = !action; b.textContent = action || ""; b.onclick = onAction || null;
  $("toast").hidden = false;
  if(!action) toastTimer = setTimeout(() => { $("toast").hidden = true; }, 3200);
}

// ---------- tester feedback context ----------
// feedback-widget.js attaches this to every report. Screen and settings only: never names,
// notes, saved questions or the relationship text a player typed (state.cat is one of our own ids).
function reportContext(){
  if(!self.Feedback) return;
  const sheet = [...document.querySelectorAll(".sheet-wrap")].find(w => !w.hidden);
  const playing = !$("play").hidden;
  Feedback.setContext({
    screen: !$("passScreen").hidden ? "handoff" : sheet ? sheet.id.replace("Sheet", "") + "-sheet" : playing ? "play" : "home",
    relationship: playing ? state.cat : null,
    depth: playing ? state.level : null,
    offline: navigator.onLine === false
  });
}
window.addEventListener("online", reportContext);
window.addEventListener("offline", reportContext);
window.addEventListener("load", reportContext);

// ---------- sheets ----------
let lastFocus = null;
function openSheet(id){
  lastFocus = document.activeElement;
  $(id).hidden = false;
  const f = $(id).querySelector("[data-close].x"); if(f) f.focus();
  reportContext();
}
function closeSheet(id){ $(id).hidden = true; if(lastFocus && lastFocus.focus) lastFocus.focus(); reportContext(); }
document.querySelectorAll(".sheet-wrap").forEach(w =>
  w.querySelectorAll("[data-close]").forEach(el => el.addEventListener("click", () => closeSheet(w.id))));
document.addEventListener("keydown", e => {
  if(e.key !== "Escape") return;
  const open = [...document.querySelectorAll(".sheet-wrap")].find(w => !w.hidden);
  if(open) closeSheet(open.id);
});

// ---------- home ----------
GROUPS.forEach(g => {
  const wrap = document.createElement("div"); wrap.className = "group";
  const h = document.createElement("p"); h.className = "group-h"; h.textContent = g.name;
  const chips = document.createElement("div"); chips.className = "chips";
  g.rels.forEach(([label, cat, phrase]) => {
    const b = document.createElement("button");
    b.className = "chip"; b.type = "button"; b.textContent = label;
    b.onclick = () => start(label, cat, phrase, 1);
    chips.appendChild(b);
  });
  wrap.append(h, chips); $("groups").appendChild(wrap);
});
// First Date: its own questions, light to closer, and you both answer every one. Every first
// date is someone new, so it starts with all of its questions fresh; Keep going doesn't.
const FIRST_DATE = ["First date", "firstdate", "your date"];
const isFirstDate = () => state.cat === FIRST_DATE[1];
$("firstDate").onclick = () => {
  delete seen[FIRST_DATE[0].toLowerCase()]; store.set(K.seen, seen);
  start(...FIRST_DATE, 1);
};
$("customForm").onsubmit = e => {
  e.preventDefault();
  const v = $("customInput").value.trim();
  if(!v){ $("customInput").focus(); return; }
  start(v, "friend", v, 1);
};
$("nameA").value = prefs.nameA; $("nameB").value = prefs.nameB;
["nameA","nameB"].forEach(id => $(id).addEventListener("input", () => { prefs[id] = $(id).value.trim(); savePrefs(); }));
$("versionLink").textContent = "Version " + VERSION + (NATIVE ? " · what's new, feedback" : " · what's new, feedback, install");
$("versionLink").onclick = openMenu;
$("menuHome").onclick = openMenu;
document.querySelectorAll("[data-tester-fb-open]").forEach(b => b.addEventListener("click", () => {
  const sheet = b.closest(".sheet-wrap"); if(sheet) closeSheet(sheet.id);
  if(self.Feedback) Feedback.open();
}));

function renderResume(){
  const last = store.get(K.last, null);
  $("resume").hidden = !last;
  if(last) $("resumeText").textContent = (last.cat === FIRST_DATE[1] ? "First date" : "With " + last.phrase) + " · " + LEVELS[last.level-1];
}
$("resume").onclick = () => {
  const l = store.get(K.last, null);
  if(l) start(l.label, l.cat, l.phrase, l.level);
};

function showHome(){
  $("play").hidden = true; $("home").hidden = false;
  setLevel(1, false); renderResume();
  // a creature from the deep would swim behind the sunset here, so let it go and plan the next one
  fishClear(); fishPlan();
  reportContext();
}
$("goHome").onclick = showHome;
$("changeWho").onclick = showHome;

// ---------- turns ----------
function names(){ return [prefs.nameA, prefs.nameB]; }
function turnText(){
  const [a, b] = names();
  if(state.current && state.current.moment) return a && b ? "A moment for " + a + " and " + b : "A moment for you both";
  if(prefs.talk) return "Conversation · no turns, anyone answers";
  if(isFirstDate()){
    const first = state.turn === 0 ? a : b;
    return "Both answer · " + (first || (state.turn === 0 ? "you" : "they")) + " first";
  }
  const both = state.current && state.current.both ? " · you both answer" : "";
  if(a && b) return (state.turn === 0 ? a + " asks " + b : b + " asks " + a) + both;
  return (state.turn === 0 ? "You ask them" : "They ask you") + both;
}
function passTitle(){
  const [a, b] = names();
  const to = state.turn === 0 ? a : b;
  return to ? "Over to you, " + to : "Hand it across";
}

// ---------- question store: no repeats per relationship, kept on the device ----------
function relKey(){ return state.label.trim().toLowerCase(); }
function qid(lvl, i){ return state.cat + "-" + lvl + "-" + i; }
function mid(lvl, i){ return state.cat + "-m" + lvl + "-" + i; }
// An entry is ["Question?", "Follow-up?"], or a bare string that borrows a general follow-up.
// A third item names the question's mode (see MODES below); older entries are sorted by wording.
function entry(e, lvl, i){
  const [q, f, tag] = Array.isArray(e) ? e : [e, ""];
  const general = FOLLOW[lvl-1] || [];
  return { q, f: f || general[i % general.length] || "", mode: modeOf(q, tag, lvl) };
}
function pool(lvl){
  const s = new Set(seen[relKey()] || []);
  return Q[state.cat][lvl-1].map((e,i) => ({ ...entry(e, lvl, i), id: qid(lvl, i) })).filter(x => !s.has(x.id));
}
function momentPool(lvl){
  const s = new Set(seen[relKey()] || []);
  return ((MOMENTS[state.cat] || [])[lvl-1] || []).map((q,i) => ({ q, f:"", id: mid(lvl, i), moment:true }))
    .filter(x => !s.has(x.id));
}

// ---------- modes: the kind of answer a question invites ----------
// Sitting through five "how do you feel" questions in a row is tiring, and five memory
// questions in a row is a quiz. Talk that stays closer to real conversation moves between
// telling a story, looking ahead, appreciating each other, playing with an idea, and
// saying something inward. The picker uses the mode to keep that mix going.
const MODES = ["story", "future", "appreciate", "play", "inner"];
const MODE_HINTS = [
  ["play",       /\b(if you (could|had|were|woke)|if we (could|had|were|opened|won)|would you rather|imagine|superpower|desert island)\b/i],
  ["future",     /\b(future|years|someday|one day|next year|next chapter|hope|plans?|dream)\b/i],
  ["appreciate", /\b(admire|appreciate|grateful|proud|love about|thank|compliment|glad|brag|means? the most)\b/i],
  ["story",      /\b(remember|first time|last time|when did|when have|growing up|as a kid|childhood|story|ever (been|done|had))\b/i]
];
function modeOf(q, tag, lvl){
  if(MODES.includes(tag)) return tag;
  const hit = MODE_HINTS.find(([, re]) => re.test(q));
  return hit ? hit[0] : lvl >= 3 ? "inner" : "other";
}

// ---------- choosing the next card ----------
// Closeness grows from taking turns opening up a little more each time, from following up
// on answers, and from breaking the pattern now and then to do something together. So
// beyond never repeating, the pick steers away from echoes of the last few cards, leans
// toward what this pair saves and follows up on and away from what they skip, and every
// few turns brings up a shared moment. It all resets when you pick who you're with.
//
// It also thinks about the mix. Closeness builds when both people open up in turn, so every
// third question asks you both to answer it (Aron et al. 1997: escalating, reciprocal
// disclosure). A mode that's been used just now is held back, so a sitting alternates
// story, future, appreciation, play and inward questions. After an inward question at the
// deep end, the next one leans warmer or lighter, so the talk doesn't stay at full weight
// (loosely after Gottman's finding that lasting couples keep far more warmth than friction;
// the pacing itself is a design choice, not a tested result).
let session;
const momentGap = () => 5 + Math.floor(Math.random() * 3);
function freshSession(){ session = { recent:[], taste:{}, modes:[], modeTaste:{}, since:0, gap:momentGap(), answered:0, skips:0, asked:0 }; }
freshSession();

const STOP = new Set(("what when where which while with would could should your youre youve youd about that there " +
  "their them they have been ever never always alway every most something someone anything thing some more than into " +
  "from like just really doe feel think make made want tell time other each else even much very only still first last " +
  "right then these those together favorite best people thi").split(" "));
function words(text){
  return new Set((text.toLowerCase().replace(/['’]/g, "").match(/[a-z]+/g) || [])
    .map(w => w.replace(/s$/, "")).filter(w => w.length > 3 && !STOP.has(w)));
}
// card is anything with a question and a mode: a pool entry or state.current
function lean(card, by){
  words(card.q).forEach(w => { session.taste[w] = (session.taste[w] || 0) + by; });
  if(card.mode && card.mode !== "other") session.modeTaste[card.mode] = (session.modeTaste[card.mode] || 0) + by;
}
function score(x){
  const w = words(x.q);
  let echo = 0, taste = 0, mix = 0;
  session.recent.forEach((r, age) => w.forEach(k => { if(r.has(k)) echo += 1 / (age + 1); }));
  w.forEach(k => { taste += session.taste[k] || 0; });
  if(x.mode !== "other"){
    session.modes.forEach((m, age) => { if(m === x.mode) mix += 1 / (age + 1); });
    if(!session.modes.includes(x.mode)) mix -= 0.5;
    if(state.level >= 4 && session.modes[0] === "inner" && x.mode !== "inner") mix -= 0.6;
  }
  const modeTaste = x.mode === "other" ? 0 : Math.max(-2, Math.min(2, session.modeTaste[x.mode] || 0));
  return Math.random() - 0.45 * echo + 0.12 * Math.max(-4, Math.min(4, taste)) - 0.5 * mix + 0.15 * modeTaste;
}
function draw(){
  const qs = pool(state.level);
  if(!qs.length) return null;
  const ms = prefs.moments && session.answered >= 2 && session.since >= session.gap ? momentPool(state.level) : [];
  let pick;
  if(ms.length){
    pick = ms[Math.floor(Math.random() * ms.length)];
    session.since = 0; session.gap = momentGap();
  } else {
    let top = -Infinity;
    qs.forEach(x => { const s = score(x); if(s > top){ top = s; pick = x; } });
    session.since++;
    session.asked++;
    pick.both = isFirstDate() || session.asked % 3 === 0;
    session.modes = [pick.mode, ...session.modes].slice(0, 3);
  }
  session.recent = [words(pick.q), ...session.recent].slice(0, 3);
  (seen[relKey()] = seen[relKey()] || []).push(pick.id);
  store.set(K.seen, seen);
  return pick;
}
$("reset").onclick = () => {
  const prefixes = [state.cat + "-" + state.level + "-", state.cat + "-m" + state.level + "-"];
  seen[relKey()] = (seen[relKey()] || []).filter(id => !prefixes.some(p => id.startsWith(p)));
  store.set(K.seen, seen);
  newQuestion();
};

function start(label, cat, phrase, level){
  Object.assign(state, { label, cat, phrase, turn:0 });
  freshSession();
  $("changeWho").textContent = cat === FIRST_DATE[1] ? "First date" : "With " + phrase;
  $("home").hidden = true; $("play").hidden = false;
  setLevel(level || 1, false);
  reportContext();
  newQuestion();
  updateSavedCount();
}
function remember(){ store.set(K.last, { label:state.label, cat:state.cat, phrase:state.phrase, level:state.level }); }

// With transitions on, the old question drifts up and away and the new one rises from below
// (the same upward pull as the bubbles). Off, it just swaps. Game state always updates at once
// so a quick Save or Skip during the animation acts on the new question.
let swapTimer = 0;
function newQuestion(){
  const pick = draw();
  state.current = pick ? { q: pick.q, f: pick.f, mode: pick.mode, both: !!pick.both, moment: !!pick.moment, id: pick.id, level: state.level, who: state.phrase, cat: state.cat } : null;
  syncSave(); remember();
  const card = document.querySelector(".card");
  clearTimeout(swapTimer);
  if(!prefs.transitions || !$("question").textContent){
    card.classList.remove("leaving");
    paintQuestion(pick, false);
    return;
  }
  card.classList.add("leaving");
  swapTimer = setTimeout(() => { card.classList.remove("leaving"); paintQuestion(pick, true); }, 190);
}
function replayEnter(){
  const el = $("question");
  el.classList.remove("enter"); void el.offsetWidth;
  if(prefs.transitions) el.classList.add("enter");
}
function paintQuestion(pick, animate){
  const el = $("question");
  el.classList.remove("enter");
  $("levelName").textContent = LEVELS[state.level-1];
  $("levelN").textContent = state.level + " of 5";
  const exhausted = !pick;
  ["next","pass","save","noteBtn"].forEach(id => $(id).disabled = exhausted);
  $("reset").hidden = !exhausted;
  document.querySelector(".card").classList.toggle("moment", !!(pick && pick.moment));
  paintFollow(pick);
  $("deeper").classList.toggle("nudge", !exhausted && readyForDeeper());
  if(exhausted){
    el.textContent = "You've asked every question at this depth with " + state.phrase + ".";
    $("turn").textContent = "Nothing new here";
    $("left").textContent = "Slide to another depth, or start this one over.";
  } else {
    el.textContent = pick.q;
    $("turn").textContent = turnText();
    $("left").textContent = hint();
  }
  if(animate){ void el.offsetWidth; el.classList.add("enter"); }
}
// Follow-ups keep an answer going; asking one is what makes the other person feel heard.
function paintFollow(pick){
  talkQueue = pick && !pick.moment ? talkPrompts(pick) : [];
  talkAt = 0;
  $("dig").hidden = !(pick && (pick.f || (prefs.talk && talkQueue.length)));
  $("dig").setAttribute("aria-expanded", "false");
  $("digLabel").textContent = prefs.talk ? "Keep it going" : "Follow-up";
  $("followK").textContent = "Then ask";
  $("followQ").hidden = true;
  $("followText").textContent = pick ? pick.f : "";
}

// ---------- conversation mode ----------
// No turns and no hand-off: one question stays up as a topic and the talk wanders from it.
// When it slows, Keep it going offers the next nudge (the question's own follow-up first,
// then this depth's general ones, then open prompts), so the pair asks for a new topic
// only when they're done with this one.
const TALK_ON = [
  "Has that changed for you over the years?",
  "What would the other one of you say about that?",
  "What's the part of that you don't usually tell people?",
  "Where does that show up in your life right now?",
  "Is there a story that goes with that?",
  "What would you add to what was just said?"
];
let talkQueue = [], talkAt = 0;
function talkPrompts(pick){
  const general = FOLLOW[state.level-1] || [];
  const open = TALK_ON.slice().sort(() => Math.random() - 0.5).slice(0, 3);
  return [...new Set([pick.f, ...general, ...open].filter(Boolean))];
}
function talkNext(){
  if(!talkQueue.length) return;
  const i = talkAt % talkQueue.length;
  talkAt++;
  $("followK").textContent = "Keep going · " + (i + 1) + " of " + talkQueue.length;
  $("followText").textContent = talkQueue[i];
  $("followQ").hidden = false;
  const f = $("followQ"); f.style.animation = "none"; void f.offsetWidth; f.style.animation = "";
}
function paintTalk(){
  $("talkMode").setAttribute("aria-pressed", prefs.talk);
  $("optTalk").checked = prefs.talk;
  $("next").textContent = prefs.talk ? "New topic" : "Next question";
  if($("play").hidden || !state.current) return;
  $("turn").textContent = turnText();
  paintFollow(state.current);
  $("left").textContent = hint();
}
function setTalk(on){
  prefs.talk = on; savePrefs(); paintTalk();
  haptic("select");
}
$("talkMode").onclick = () => setTalk(!prefs.talk);

$("dig").onclick = () => {
  if(prefs.talk){
    if(!state.current) return;
    $("dig").setAttribute("aria-expanded", "true");
    talkNext();
    haptic("select");
    $("followQ").scrollIntoView({ block:"nearest", behavior: REDUCED ? "auto" : "smooth" });
    if(!state.current.dug){ state.current.dug = true; lean(state.current, 0.5); $("left").textContent = hint(); }
    return;
  }
  const open = $("dig").getAttribute("aria-expanded") !== "true";
  $("dig").setAttribute("aria-expanded", open);
  $("followQ").hidden = !open;
  if(!open || !state.current) return;
  haptic("select");
  // on short phones the follow-up can land below the fold of the card
  $("followQ").scrollIntoView({ block:"nearest", behavior: REDUCED ? "auto" : "smooth" });
  if(!state.current.dug){ state.current.dug = true; lean(state.current, 0.5); $("left").textContent = hint(); }
};
// After a few answers at one depth, invite the pair a little deeper; if they keep skipping,
// suggest another depth instead.
function readyForDeeper(){ return state.level < 5 && session.answered >= 4; }
function hint(){
  if(session.skips >= 3) return "Not quite landing? Try another depth.";
  if(readyForDeeper()) return "Warmed up? Try going a little deeper.";
  // On a first date, the deeper waters are a choice, never a step you have to take.
  if(isFirstDate() && session.answered === 0 && !session.skips){
    if(state.level >= 4) return "More personal from here, and all optional. Skip anything, anytime.";
    if(state.level === 1) return "Easy ones first. Skip anything that doesn't land.";
  }
  // People who ask follow-ups are liked more and feel more understood (Huang et al. 2017),
  // and most players never think to; so early in a sitting, say so.
  const c = state.current;
  if(prefs.talk && c && !c.moment && !c.dug) return "No turns. Let it wander, and tap Keep it going when it slows.";
  if(c && c.f && !c.dug && !c.moment && session.answered < 3) return "Tap Follow-up to keep the answer going.";
  const n = pool(state.level).length;
  return n === 0 ? "Last new one at this depth" : n + " new left at this depth";
}

// ---------- depth ----------
function setLevel(lvl, fetch = true){
  lvl = Math.max(1, Math.min(5, lvl));
  const changed = lvl !== state.level;
  state.level = lvl;
  if(changed){ session.answered = 0; session.skips = 0; }
  reportContext();
  paintDepth(lvl);
  $("knob").style.top = ((lvl-1)/4*100) + "%";
  const g = $("gauge");
  g.setAttribute("aria-valuenow", lvl);
  g.setAttribute("aria-valuetext", LEVELS[lvl-1]);
  $("deeper").disabled = lvl === 5;
  $("deeper").querySelector("span").textContent = lvl === 5 ? "Deepest" : "Deeper";
  if(fetch && changed){ newQuestion(); fishEnter(); }
}
function paintDepth(l){
  document.body.dataset.level = l;
  document.querySelector('meta[name="theme-color"]').content = $("home").hidden ? WATER[l-1] : SKY;
}

const rail = $("rail"), gauge = $("gauge");
function tFromY(y){ const r = rail.getBoundingClientRect(); return Math.max(0, Math.min(1, (y - r.top) / r.height)); }
let dragging = false, dragLevel = 1;
gauge.addEventListener("pointerdown", e => {
  dragging = true; gauge.classList.add("dragging");
  gauge.setPointerCapture(e.pointerId);
  // A tap snaps straight to the nearest depth; only a drag glides (as in the original).
  dragLevel = Math.round(tFromY(e.clientY)*4) + 1;
  paintDepth(dragLevel); $("knob").style.top = ((dragLevel-1)/4*100) + "%";
});
gauge.addEventListener("pointermove", e => { if(dragging) moveTo(e.clientY); });
function moveTo(y){
  const t = tFromY(y);
  $("knob").style.top = (t*100) + "%";
  const l = dragLevel = Math.round(t*4) + 1;
  paintDepth(l); $("levelName").textContent = LEVELS[l-1]; $("levelN").textContent = l + " of 5";
}
function endDrag(){
  if(!dragging) return;
  dragging = false; gauge.classList.remove("dragging");
  if(dragLevel !== state.level) haptic("select");
  setLevel(dragLevel);
  $("levelName").textContent = LEVELS[state.level-1];
}
gauge.addEventListener("pointerup", endDrag);
gauge.addEventListener("pointercancel", endDrag);
gauge.addEventListener("keydown", e => {
  const map = { ArrowDown:1, ArrowRight:1, ArrowUp:-1, ArrowLeft:-1 };
  if(e.key in map){ e.preventDefault(); setLevel(state.level + map[e.key]); }
  else if(e.key === "Home"){ e.preventDefault(); setLevel(1); }
  else if(e.key === "End"){ e.preventDefault(); setLevel(5); }
});

// ---------- actions ----------
// A moment is shared, so it doesn't use up anyone's turn, and there's nothing to hide
// from the other person, so it skips the hand-off.
$("next").onclick = () => {
  haptic();
  if(state.current && !state.current.moment){ if(!prefs.talk) state.turn = 1 - state.turn; session.answered++; }
  session.skips = 0;
  newQuestion();
  // In conversation mode nobody holds the phone alone, so there's nothing to hide.
  if(prefs.passScreen && !prefs.talk && state.current && !state.current.moment) dive();
};

// ---------- hand-off: hold the ring to bring the question up ----------
const HOLD_MS = 750, SINK_MS = 300;
const surf = $("passScreen"), holdBtn = $("passReveal");
let holdP = 0, holding = false, holdRaf = 0, holdLast = 0, surfacing = false;

function dive(){
  $("passKicker").textContent = "Next up · " + LEVELS[state.level-1];
  $("passTitle").textContent = passTitle();
  surfacing = false; setHold(0);
  surf.classList.remove("out", "holding");
  surf.hidden = false;
  reportContext();
  holdBtn.focus();
}
function setHold(p){
  holdP = p;
  surf.style.setProperty("--p", p.toFixed(3));
  $("holdFill").style.strokeDashoffset = String(100 - p * 100);
}
function holdFrame(now){
  const dt = now - holdLast; holdLast = now;
  const before = holdP;
  const p = holding ? Math.min(1, holdP + dt / HOLD_MS) : Math.max(0, holdP - dt / SINK_MS);
  setHold(p);
  // two small ticks on the way up, like notches on a reel
  if(holding && ((before < 1/3 && p >= 1/3) || (before < 2/3 && p >= 2/3))) haptic("select");
  if(p >= 1){ rise(); return; }
  if(holding || p > 0) holdRaf = requestAnimationFrame(holdFrame);
  else holdRaf = 0;
}
function press(e){
  if(surfacing) return;
  if(e){ e.preventDefault(); try { holdBtn.setPointerCapture(e.pointerId); } catch(_){} }
  holding = true; surf.classList.add("holding"); holdBtn.classList.add("holding");
  if(!holdRaf){ holdLast = performance.now(); holdRaf = requestAnimationFrame(holdFrame); }
}
function letGo(){
  if(!holding) return;
  holding = false; surf.classList.remove("holding"); holdBtn.classList.remove("holding");
  if(!holdRaf && holdP > 0){ holdLast = performance.now(); holdRaf = requestAnimationFrame(holdFrame); }
}
function rise(){
  surfacing = true; holding = false; holdRaf = 0;
  holdBtn.classList.remove("holding");
  haptic("medium");
  // restart the question's entrance so it comes up as the water lifts away
  clearTimeout(swapTimer); document.querySelector(".card").classList.remove("leaving");
  paintQuestion(state.current, false); replayEnter();
  surf.classList.add("out");
  setTimeout(() => { surf.hidden = true; surf.classList.remove("out", "holding"); setHold(0); reportContext(); $("next").focus(); }, 500);
}
holdBtn.addEventListener("pointerdown", press);
holdBtn.addEventListener("pointerup", letGo);
holdBtn.addEventListener("pointercancel", letGo);
holdBtn.addEventListener("lostpointercapture", letGo);
holdBtn.addEventListener("contextmenu", e => e.preventDefault());   // long-press menus on Android
// Keyboards and screen readers can't "hold": a click that didn't come from a pointer surfaces at once.
holdBtn.addEventListener("click", e => { if(e.detail === 0 && !surfacing) rise(); });
$("pass").onclick = () => {
  if(state.current && !state.current.moment){ lean(state.current, -1); session.skips++; }
  newQuestion();
};
$("deeper").onclick = () => { haptic("medium"); setLevel(state.level + 1); };

function isSaved(){ return state.current && saved.some(s => s.q === state.current.q); }
function syncSave(){
  const on = !!isSaved();
  $("save").setAttribute("aria-pressed", on);
  $("save").querySelector("span").textContent = on ? "Saved" : "Save";
}
function updateSavedCount(){ $("openSaved").textContent = "Saved " + saved.length; }
$("save").onclick = () => {
  if(!state.current) return;
  const c = state.current;
  if(isSaved()){ saved = saved.filter(s => s.q !== c.q); lean(c, -1); }
  else {
    saved.unshift(Object.assign({ q:c.q, level:c.level, who:c.who }, c.moment && { moment:true }));
    lean(c, 1); haptic();
  }
  store.set(K.saved, saved); syncSave(); updateSavedCount();
};

function renderSaved(){
  const ul = $("savedList"); ul.innerHTML = "";
  if(!saved.length){
    const li = document.createElement("li");
    const p = document.createElement("p"); p.className = "empty";
    p.textContent = "Tap Save on a question you want to come back to. It will show up here.";
    li.appendChild(p); ul.appendChild(li); return;
  }
  saved.forEach((s, i) => {
    const li = document.createElement("li");
    const p = document.createElement("p"); p.textContent = s.q;
    const sm = document.createElement("small"); sm.textContent = (s.moment ? "A moment · " : "") + LEVELS[s.level-1] + ", with " + s.who;
    sm.dataset.level = s.level;
    p.appendChild(sm);
    const sh = document.createElement("button");
    sh.className = "x"; sh.textContent = "Share"; sh.setAttribute("aria-label", "Share: " + s.q);
    sh.onclick = async () => {
      try { if(!(await shareText("A question from Deep End", s.q + "\n\n(Deep End: questions for two)"))) throw 0; }
      catch(e){ if(e && e.name === "AbortError") return; try { await navigator.clipboard.writeText(s.q); toast("Question copied"); } catch(_){} }
    };
    const x = document.createElement("button");
    x.className = "x"; x.textContent = "Remove"; x.setAttribute("aria-label", "Remove: " + s.q);
    x.onclick = () => { saved.splice(i, 1); store.set(K.saved, saved); renderSaved(); updateSavedCount(); syncSave(); };
    const btns = document.createElement("div"); btns.className = "li-btns"; btns.append(sh, x);
    li.append(p, btns); ul.appendChild(li);
  });
}
$("openSaved").onclick = () => { renderSaved(); openSheet("savedSheet"); };

// ---------- playtest notes ----------
NOTE_REASONS.forEach(r => {
  const b = document.createElement("button");
  b.type = "button"; b.className = "chip"; b.textContent = r; b.setAttribute("aria-pressed", "false");
  b.onclick = () => b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") !== "true");
  $("noteReasons").appendChild(b);
});
$("noteBtn").onclick = () => {
  if(!state.current) return;
  $("noteQ").textContent = state.current.q;
  $("noteText").value = "";
  $("noteReasons").querySelectorAll(".chip").forEach(c => c.setAttribute("aria-pressed", "false"));
  openSheet("noteSheet");
};
$("noteSubmit").onclick = () => {
  const reasons = [...$("noteReasons").querySelectorAll('.chip[aria-pressed="true"]')].map(c => c.textContent);
  const text = $("noteText").value.trim();
  if(!reasons.length && !text){ toast("Pick a reason or write something first"); return; }
  const c = state.current;
  notes.push({ q:c.q, id:c.id, level:c.level, cat:c.cat, who:c.who, reasons, text, v:VERSION, at:new Date().toISOString() });
  store.set(K.notes, notes);
  closeSheet("noteSheet");
  toast("Note saved. Send your notes from the menu.");
};

function feedbackText(){
  const lines = ["Deep End playtest feedback", "Version " + VERSION + " · " + new Date().toLocaleDateString(), ""];
  if(prefs.general) lines.push("General thoughts:", prefs.general, "");
  if(notes.length){
    lines.push("Notes on questions (" + notes.length + "):");
    notes.forEach((n, i) => {
      lines.push("", (i+1) + ". [" + LEVELS[n.level-1] + " · with " + n.who + "] " + n.q);
      if(n.reasons.length) lines.push("   " + n.reasons.join(", "));
      if(n.text) lines.push("   \"" + n.text + "\"");
    });
  }
  return lines.join("\n");
}
function renderFeedback(){
  $("fbCount").textContent = notes.length
    ? notes.length + (notes.length === 1 ? " note" : " notes") + " on questions so far."
    : "Tap Note on any question while you play. Send everything here when you're done.";
  $("fbGeneral").value = prefs.general;
}
$("fbGeneral").addEventListener("input", () => { prefs.general = $("fbGeneral").value; savePrefs(); });
$("fbSend").onclick = async () => {
  if(!notes.length && !prefs.general.trim()){ toast("Nothing to send yet"); return; }
  const text = feedbackText();
  try { if(await shareText("Deep End feedback", text)) return; }
  catch(e){ if(e && (e.name === "AbortError" || /cancel/i.test(e.message || ""))) return; }
  try { await navigator.clipboard.writeText(text); toast("Copied. Paste it in a message to the maker."); }
  catch(e){ toast("Couldn't share from this browser"); }
};
$("fbClear").onclick = () => {
  if(!notes.length && !prefs.general) return;
  if(!confirm("Clear all your notes? Do this after you've sent them.")) return;
  notes = []; store.set(K.notes, notes); prefs.general = ""; savePrefs(); renderFeedback();
};

// ---------- sea life ----------
// Now and then one creature swims through the background, chosen by the depth you're at when it
// starts: a flying fish, a sea turtle, a manta ray, a jellyfish, an anglerfish. Decoration only: never
// more than one, never over a sheet or the hand-off, and none at all when the phone asks for reduced
// motion. Each is a small SVG facing right (flipped when it swims left), built once and cloned.
// vb is the drawing's viewBox [x, y, width, height]; the parts that move have classes styles.css animates.
const motion = matchMedia("(prefers-reduced-motion: reduce)");
const SEA = {
  1: { kind:"flying", vb:[-100, -70, 176, 126], w:[58, 70], dur:[8, 11], y:[15, 22], amp:[0, 0], wave:[3, 4], wl:.62, art:
    '<g class="pitch"><rect x="-100" y="-70" width="176" height="126" fill="none"/><g class="wings far">' +
    '<path d="M38 6C24 30 2 46 -36 54C-22 40 -4 24 8 8Z" fill="#D9F5F3" opacity=".35"/>' +
    '<path d="M-22 7C-30 20 -40 26 -52 28C-46 20 -36 12 -28 7Z" fill="#D9F5F3" opacity=".35"/></g>' +
    '<path class="tail" d="M-56 -3L-88 -18L-74 2L-98 22L-56 5Z" fill="#19517B"/>' +
    '<path d="M74 1C62 -11 22 -15 -20 -10C-38 -8 -50 -5 -58 -3L-58 5C-50 7 -38 9 -20 10C22 12 62 10 74 1Z" fill="#19517B"/>' +
    '<path d="M73 2.5C58 3.5 28 3 -20 2C-38 2 -50 3 -58 3.5L-58 5C-50 7 -38 9 -20 10C22 12 62 10 73 2.5Z" fill="#C0E6EB"/>' +
    '<path d="M60 -1C30 -3 0 -3 -50 -1" fill="none" stroke="#C0E6EB" stroke-width="1.4" opacity=".45"/>' +
    '<g class="wings"><path d="M40 -3C20 -40 -10 -62 -50 -68C-32 -50 -10 -28 6 -5Z" fill="#D9F5F3" opacity=".62"/>' +
    '<path d="M36 -5C17 -34 -8 -54 -44 -64M34 -5C15 -28 -6 -42 -34 -52M31 -5C15 -21 -1 -31 -21 -38M28 -5C17 -14 7 -20 -7 -23" fill="none" stroke="#fff" stroke-width="1.1" opacity=".5"/>' +
    '<path d="M-20 -8C-28 -24 -40 -32 -54 -34C-46 -24 -36 -14 -28 -8Z" fill="#D9F5F3" opacity=".5"/></g>' +
    '<circle cx="58" cy="-1" r="5" fill="#0A1A2A"/><circle cx="59.6" cy="-2.6" r="1.6" fill="#fff"/></g>' },
  2: { kind:"turtle", vb:[-92, -118, 184, 236], w:[62, 78], dur:[15, 19], y:[30, 62], amp:[3, 6], wave:[4, 5.5], art:
    '<path d="M-46 -26C-62 -40 -78 -46 -90 -42C-80 -32 -64 -22 -52 -16ZM-46 26C-62 40 -78 46 -90 42C-80 32 -64 22 -52 16ZM-58 -5L-77 0L-58 5Z" fill="#6DAF92"/>' +
    '<g class="fin-l"><path d="M34 -34C50 -62 40 -94 -8 -116C4 -88 10 -62 8 -40Z" fill="#6DAF92"/>' +
    '<g fill="#A0D1BA" opacity=".7"><circle cx="30" cy="-62" r="3.2"/><circle cx="22" cy="-80" r="2.6"/>' +
    '<circle cx="12" cy="-96" r="2.2"/><circle cx="36" cy="-48" r="2.4"/></g></g><g class="fin-r">' +
    '<path d="M34 34C50 62 40 94 -8 116C4 88 10 62 8 40Z" fill="#6DAF92"/><g fill="#A0D1BA" opacity=".7">' +
    '<circle cx="30" cy="62" r="3.2"/><circle cx="22" cy="80" r="2.6"/><circle cx="12" cy="96" r="2.2"/>' +
    '<circle cx="36" cy="48" r="2.4"/></g></g><ellipse cx="72" cy="0" rx="17" ry="12.5" fill="#6DAF92"/>' +
    '<path d="M78 -5L85 -2L85 2L78 5L72 0Z" fill="#A0D1BA" opacity=".55"/>' +
    '<circle cx="80" cy="-7.5" r="2.2" fill="#0A1A2A"/><circle cx="80" cy="7.5" r="2.2" fill="#0A1A2A"/>' +
    '<ellipse cx="0" cy="0" rx="62" ry="48" fill="#327860"/>' +
    '<path d="M54 0L62 0M52.16 10.61L59.89 12.42M46.77 20.5L53.69 24M38.18 28.99L43.84 33.94M27 35.51L31 41.57M13.98 39.6L16.05 46.36M0 41L0 48M-13.98 39.6L-16.05 46.36M-27 35.51L-31 41.57M-38.18 28.99L-43.84 33.94M-46.77 20.5L-53.69 24M-52.16 10.61L-59.89 12.42M-54 0L-62 0M-52.16 -10.61L-59.89 -12.42M-46.77 -20.5L-53.69 -24M-38.18 -28.99L-43.84 -33.94M-27 -35.51L-31 -41.57M-13.98 -39.6L-16.05 -46.36M0 -41L0 -48M13.98 -39.6L16.05 -46.36M27 -35.51L31 -41.57M38.18 -28.99L43.84 -33.94M46.77 -20.5L53.69 -24M52.16 -10.61L59.89 -12.42" fill="none" stroke="#215243" stroke-width="1.6"/>' +
    '<ellipse cx="0" cy="0" rx="54" ry="41" fill="#215243"/><g fill="#327860">' +
    '<polygon points="-26,-12.04 -14.82,-6.02 -14.82,6.02 -26,12.04 -37.18,6.02 -37.18,-6.02"/>' +
    '<polygon points="0,-12.04 11.18,-6.02 11.18,6.02 0,12.04 -11.18,6.02 -11.18,-6.02"/>' +
    '<polygon points="26,-12.04 37.18,-6.02 37.18,6.02 26,12.04 14.82,6.02 14.82,-6.02"/>' +
    '<polygon points="-13,8.96 -1.82,14.98 -1.82,27.02 -13,33.04 -24.18,27.02 -24.18,14.98"/>' +
    '<polygon points="13,8.96 24.18,14.98 24.18,27.02 13,33.04 1.82,27.02 1.82,14.98"/>' +
    '<polygon points="-13,-33.04 -1.82,-27.02 -1.82,-14.98 -13,-8.96 -24.18,-14.98 -24.18,-27.02"/>' +
    '<polygon points="13,-33.04 24.18,-27.02 24.18,-14.98 13,-8.96 1.82,-14.98 1.82,-27.02"/></g>' },
  3: { kind:"manta", vb:[-136, -140, 202, 280], w:[70, 88], dur:[16, 20], y:[26, 60], amp:[5, 9], wave:[4.5, 6], art:
    '<path d="M-54 -2.2 L-134 0 L-54 2.2 Z" fill="#021829"/><g class="flap">' +
    '<path d="M40 -16 L40 16 C42 42 30 90 -12 138 C-12 104 -18 72 -34 48 C-46 32 -56 16 -58 0 C-56 -16 -46 -32 -34 -48 C-18 -72 -12 -104 -12 -138 C30 -90 42 -42 40 -16 Z" fill="#021829"/>' +
    '<path d="M38 -17 C46 -24 57 -25 63 -19 C58 -13 49 -10 39 -9 ZM38 17 C46 24 57 25 63 19 C58 13 49 10 39 9 Z" fill="#021829"/>' +
    '<ellipse cx="-6" cy="0" rx="44" ry="20" fill="#0A2A44"/>' +
    '<path d="M26 -14 C24 -36 12 -60 -8 -80 C2 -56 8 -32 10 -12 ZM26 14 C24 36 12 60 -8 80 C2 56 8 32 10 12 Z" fill="#5E8CAC" opacity=".55"/>' +
    '<path d="M40 -16 C42 -42 30 -90 -12 -138 M40 16 C42 42 30 90 -12 138" fill="none" stroke="#7FB2D1" stroke-width="2" opacity=".55" stroke-linecap="round"/>' +
    '</g>' },
  4: { kind:"jelly", vb:[-98, -98, 196, 240], w:[84, 104], dur:[20, 26], y:[28, 62], amp:[6, 10], wave:[3.5, 5], art:
    '<g class="halo"><ellipse cx="0" cy="-12" rx="96" ry="84" fill="#AE97FF" opacity=".05"/>' +
    '<ellipse cx="0" cy="-16" rx="72" ry="62" fill="#AE97FF" opacity=".07"/></g><g class="tents">' +
    '<path d="M-44 14C-50 35 -38 58.8 -48 84C-40 103.6 -46 119 -46 137.2M-28 14C-32 35 -20 58.8 -30 84C-22 103.6 -26 119 -26 137.2M28 14C34 35 22 58.8 30 84C24 103.6 28 119 26 137.2M44 14C50 35 40 58.8 48 84C42 103.6 46 119 46 137.2M-12 14C-18 35 -6 58.8 -14 84C-10 103.6 -8 119 -14 137.2M14 14C10 35 18 58.8 12 84C16 103.6 20 119 16 137.2" fill="none" stroke="#CBC0FF" stroke-width="1.4" opacity=".5" stroke-linecap="round"/>' +
    '<path d="M-9 14C-18 28 -2 43.4 -12 64.4C-18 78.4 -8 89.6 -14 103.6M9 14C17 30.8 2 47.6 12 68.6C18 82.6 8 92.4 14 106.4" fill="none" stroke="#AE97FF" stroke-width="6" opacity=".55" stroke-linecap="round"/>' +
    '</g><g class="bell">' +
    '<path d="M-50 10C-50 -30 -28 -52 0 -52C28 -52 50 -30 50 10Q41.67 19 33.33 10Q25 19 16.67 10Q8.33 19 0 10Q-8.33 19 -16.67 10Q-25 19 -33.33 10Q-41.67 19 -50 10Z" fill="#AE97FF" opacity=".6"/>' +
    '<path d="M-34 6C-34 -22 -18 -38 0 -38C18 -38 34 -22 34 6Z" fill="#CBC0FF" opacity=".4"/>' +
    '<path d="M0 -50C-14 -36 -22 -14 -25 10M0 -50C14 -36 22 -14 25 10M0 -50L0 10" fill="none" stroke="#E4F9F7" stroke-width="1.2" opacity=".3"/>' +
    '<g class="lights" fill="#54F5D7"><circle cx="-50" cy="10" r="6" opacity=".22"/>' +
    '<circle cx="-50" cy="10" r="2.3"/><circle cx="-33.33" cy="10" r="6" opacity=".22"/>' +
    '<circle cx="-33.33" cy="10" r="2.3"/><circle cx="-16.67" cy="10" r="6" opacity=".22"/>' +
    '<circle cx="-16.67" cy="10" r="2.3"/><circle cx="0" cy="10" r="6" opacity=".22"/>' +
    '<circle cx="0" cy="10" r="2.3"/><circle cx="16.67" cy="10" r="6" opacity=".22"/>' +
    '<circle cx="16.67" cy="10" r="2.3"/><circle cx="33.33" cy="10" r="6" opacity=".22"/>' +
    '<circle cx="33.33" cy="10" r="2.3"/><circle cx="50" cy="10" r="6" opacity=".22"/>' +
    '<circle cx="50" cy="10" r="2.3"/></g></g>' },
  5: { kind:"angler", vb:[-122, -152, 286, 216], w:[118, 140], dur:[13, 16], y:[34, 66], amp:[3, 6], wave:[3.5, 5], art:
    '<path class="tail" d="M-66 -6 C-84 -30 -104 -42 -120 -38 C-113 -14 -113 14 -120 38 C-104 42 -84 30 -66 6 Z" fill="#1C2A49"/>' +
    '<path d="M-104 -32 L-88 -4 M-106 0 L-86 0 M-104 32 L-88 4" fill="none" stroke="#263454" stroke-width="1.5"/>' +
    '<path d="M-24 -60 C-36 -72 -52 -70 -62 -54 C-50 -52 -38 -50 -28 -48 Z" fill="#1C2A49"/>' +
    '<path d="M60 -12 C56 -48 22 -66 -14 -64 C-52 -62 -76 -32 -76 0 C-76 34 -50 60 -12 62 C26 64 56 50 70 30 C68 16 64 2 60 -12 Z" fill="#151F3E"/>' +
    '<path d="M60 -12 C56 -48 22 -66 -14 -64 C10 -54 34 -38 46 -9 Z" fill="#FFD447" opacity=".07"/>' +
    '<path d="M60 -12 C56 -48 22 -66 -14 -64" fill="none" stroke="#FFD447" stroke-width="3" opacity=".25" stroke-linecap="round"/>' +
    '<path d="M62 -8 C44 -4 22 -1 6 1 C22 10 46 22 69 27 C67 14 65 3 62 -8 Z" fill="#02040C"/>' +
    '<path d="M60 -7.68 L57 1.8 L54 -6.71 ZM51 -6.23 L48 5.25 L45 -5.27 ZM42 -4.79 L39 4.7 L36 -3.82 ZM33 -3.34 L30 5.14 L27 -2.38 ZM24 -1.89 L21 4.59 L18 -0.93 ZM65 25.35 L62 14.11 L59 22.87 ZM56 21.63 L53 8.4 L50 19.16 ZM47 17.92 L44 7.68 L41 15.44 ZM38 14.21 L35 4.97 L32 11.73 ZM29 10.49 L26 3.25 L23 8.02 Z" fill="#E4F9F7"/>' +
    '<path d="M-18 14 C-34 14 -50 26 -48 44 C-36 42 -22 32 -18 14 Z" fill="#1C2A49"/><g fill="#263454">' +
    '<circle cx="-30" cy="-30" r="3"/><circle cx="-44" cy="-14" r="2.4"/><circle cx="-20" cy="-44" r="2.2"/>' +
    '<circle cx="-52" cy="10" r="2.6"/><circle cx="-36" cy="34" r="2.2"/><circle cx="0" cy="40" r="2.4"/>' +
    '<circle cx="14" cy="-48" r="2"/></g><circle cx="24" cy="-30" r="8" fill="#263454"/>' +
    '<circle cx="25" cy="-31" r="5.4" fill="#DDF1F2"/><circle cx="27.4" cy="-32.6" r="2.8" fill="#05091C"/>' +
    '<circle cx="24" cy="-33.4" r="1.1" fill="#fff"/><g class="lure"><g class="halo" fill="#FFD447">' +
    '<circle cx="96" cy="-84" r="66" opacity="0.05"/><circle cx="96" cy="-84" r="42" opacity="0.09"/>' +
    '<circle cx="96" cy="-84" r="24" opacity="0.16"/><circle cx="96" cy="-84" r="13" opacity="0.3"/></g>' +
    '<path d="M12 -63 C20 -112 70 -124 94 -92" fill="none" stroke="#263454" stroke-width="3" stroke-linecap="round"/>' +
    '<path d="M98 -78 L101 -70 M94 -78 L93 -71" fill="none" stroke="#FFD447" stroke-width="1.4" opacity=".7" stroke-linecap="round"/>' +
    '<circle class="bulb" cx="96" cy="-84" r="7.5" fill="#FFD447"/>' +
    '<circle cx="97.8" cy="-86" r="2.8" fill="#FFF8D6"/></g>' }
};
const seaArt = {};
function seaSvg(level){
  if(!seaArt[level]){
    const box = document.createElement("div");
    box.innerHTML = '<svg viewBox="' + SEA[level].vb.join(" ") + '" aria-hidden="true">' + SEA[level].art + '</svg>';
    seaArt[level] = box.firstChild;
  }
  return seaArt[level].cloneNode(true);
}

let fishTimer = 0, fishEl = null, fishSeen = false;
const rand = (a, b) => a + Math.random() * (b - a);
const setVar = (el, k, v) => el.style.setProperty(k, v);
const fishOk = () => prefs.fish && !motion.matches && document.visibilityState === "visible";

function fishPlan(){
  clearTimeout(fishTimer); fishTimer = 0;
  if(!fishOk() || fishEl) return;
  // First one after 1 to 2 minutes, then one every 2 to 4. The deep end is emptier: twice as long.
  const secs = (fishSeen ? rand(120, 240) : rand(60, 120)) * (state.level === 5 ? 2 : 1);
  fishTimer = setTimeout(fishSwim, secs * 1000);
}
function fishClear(){
  clearTimeout(fishTimer); fishTimer = 0;
  if(fishEl){ fishEl.remove(); fishEl = null; }
}
// A creature's body: a wave layer holding its SVG, sized from the width so the drawing keeps its shape.
function seaBody(level, w, amp, wave){
  const c = SEA[level], bob = document.createElement("div");
  bob.className = "fish-bob";
  setVar(bob, "--w", Math.round(w) + "px"); setVar(bob, "--h", (w * c.vb[3] / c.vb[2]).toFixed(1) + "px");
  setVar(bob, "--amp", amp.toFixed(1) + "px"); setVar(bob, "--wave", wave.toFixed(2) + "s");
  setVar(bob, "--phase", (-rand(0, wave)).toFixed(2) + "s");
  bob.appendChild(seaSvg(level));
  return bob;
}
// Moving to a new depth brings that depth's creature straight away, replacing any still swimming.
function fishEnter(){
  if(!fishOk()) return;
  fishClear(); fishSwim(true);
}
function fishSwim(now){
  clearTimeout(fishTimer); fishTimer = 0;
  if(!fishOk() || fishEl) return;
  if(document.querySelector(".sheet-wrap:not([hidden])") || !$("passScreen").hidden){
    if(now) fishPlan(); else fishTimer = setTimeout(fishSwim, 15000);   // try again shortly
    return;
  }
  fishSeen = true;
  // The depth when it starts decides the creature; changing depth mid-swim lets it finish.
  // On the home screen it keeps below the sunset, which would otherwise hide it.
  const level = state.level, c = SEA[level];
  const ltr = Math.random() < 0.5, dur = rand(...c.dur), W = innerWidth;
  const y = $("home").hidden ? rand(...c.y) : rand(48, 78);
  const w = rand(...c.w), pad = Math.round(w) + 24;   // start and finish fully off screen
  const x0 = ltr ? -pad : W + 24, x1 = ltr ? W + 24 : -pad;
  const holder = document.createElement("div"), el = document.createElement("div");
  holder.className = "sea";
  el.className = "fish k-" + c.kind + (ltr ? "" : " rtl");
  setVar(el, "--y", y.toFixed(1) + "vh"); setVar(el, "--dur", dur.toFixed(1) + "s");
  setVar(el, "--x0", x0 + "px"); setVar(el, "--x1", x1 + "px"); setVar(el, "--span", (x1 - x0) + "px");
  el.appendChild(seaBody(level, w, rand(...c.amp), rand(...c.wave)));
  if(c.kind === "flying"){
    // It leaves and re-enters the water at about 28% and 76% of the crossing: a ripple at each spot,
    // level with its belly (wl, a fraction of the drawing's height).
    setVar(el, "--leap", Math.round(rand(46, 72)) + "px");
    const wy = innerHeight * y / 100 + w * c.vb[3] / c.vb[2] * c.wl;
    [.28, .76].forEach(f => {
      const r = document.createElement("div");
      r.className = "ripple";
      r.style.left = Math.round(x0 + (x1 - x0) * f + w / 2) + "px"; r.style.top = Math.round(wy) + "px";
      setVar(r, "--rd", (dur * f).toFixed(2) + "s");
      holder.appendChild(r);
    });
  }
  holder.appendChild(el);
  const done = () => { if(fishEl === holder){ holder.remove(); fishEl = null; fishPlan(); } };
  el.addEventListener("animationend", e => { if(e.target === el) done(); });
  setTimeout(done, dur * 1000 + 800);   // in case animationend never comes
  fishEl = holder;
  document.querySelector(".motes").appendChild(holder);
}
// Nothing to pause a timer for while the app is hidden: drop the creature and pick a fresh delay on return.
document.addEventListener("visibilitychange", () => { fishClear(); fishPlan(); });
fishPlan();

// ---------- menu ----------
$("optPass").checked = prefs.passScreen;
$("optPass").onchange = () => { prefs.passScreen = $("optPass").checked; savePrefs(); };
$("optTransitions").checked = prefs.transitions;
$("optTransitions").onchange = () => { prefs.transitions = $("optTransitions").checked; savePrefs(); };
$("optMoments").checked = prefs.moments;
$("optMoments").onchange = () => { prefs.moments = $("optMoments").checked; savePrefs(); };
$("optFish").checked = prefs.fish;
$("optFish").onchange = () => { prefs.fish = $("optFish").checked; savePrefs(); prefs.fish ? fishPlan() : fishClear(); };
$("optTalk").onchange = () => setTalk($("optTalk").checked);
paintTalk();
$("optWater").checked = prefs.water;
$("optWater").onchange = () => { prefs.water = $("optWater").checked; savePrefs(); paintWater(); };
$("resetSeen").onclick = () => {
  if(!confirm("Every question becomes new again, for everyone you've played with.")) return;
  seen = {}; store.set(K.seen, seen); toast("Question history cleared");
};
function renderChanges(){
  const box = $("changes"); box.innerHTML = "";
  CHANGES.slice(0, 5).forEach(c => {
    const d = document.createElement("div"); d.className = "change";
    const b = document.createElement("b"); b.textContent = "Version " + c.v + (c.date ? " · " + c.date : "");
    const ul = document.createElement("ul");
    c.notes.forEach(n => { const li = document.createElement("li"); li.textContent = n; ul.appendChild(li); });
    d.append(b, ul); box.appendChild(d);
  });
}
function openMenu(){ renderInstall(); renderFeedback(); renderChanges(); openSheet("menuSheet"); }

// ---------- install ----------
let installPrompt = null;
const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); installPrompt = e; renderInstall(); });
window.addEventListener("appinstalled", () => { installPrompt = null; renderInstall(); toast("Installed. Find Deep End on your home screen."); });
function renderInstall(){
  const t = $("installText"), b = $("installBtn");
  b.hidden = true;
  if(standalone()) t.textContent = "You're using the installed app. New versions arrive on their own; you'll see a prompt to update.";
  else if(installPrompt){ t.textContent = "Add Deep End to your home screen. It opens full screen and works without signal."; b.hidden = false; }
  else if(isIOS) t.textContent = "In Safari, tap the Share button, then Add to Home Screen. It opens full screen and works without signal.";
  else t.textContent = "Open your browser menu and choose Install app or Add to Home screen.";
}
$("installBtn").onclick = async () => {
  if(!installPrompt) return;
  installPrompt.prompt();
  try { await installPrompt.userChoice; } catch(e){}
  installPrompt = null; renderInstall();
};

// ---------- updates ----------
// The service worker holds a full offline copy per version. When a new version is
// published it downloads in the background and waits; we ask before swapping so a
// question never vanishes mid-conversation.
// Store builds carry their files inside the app and update through the store instead.
if(!NATIVE && "serviceWorker" in navigator && location.protocol !== "file:"){
  let reloading = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if(reloading) return; reloading = true; location.reload();
  });
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("sw.js", { updateViaCache:"none" });
      const offer = w => toast("A new version of Deep End is ready.", "Update", () => {
        $("toast").hidden = true; w.postMessage({ type:"SKIP_WAITING" });
      });
      if(reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const w = reg.installing;
        w && w.addEventListener("statechange", () => {
          if(w.state === "installed" && navigator.serviceWorker.controller) offer(w);
        });
      });
      // Phones keep installed apps alive for days; check again whenever it's reopened.
      document.addEventListener("visibilitychange", () => {
        if(document.visibilityState === "visible") reg.update().catch(() => {});
      });
    } catch(e){}
  });
}

// ---------- Android back button ----------
// Back should step out one layer (a sheet, then the play screen) like any Android app,
// not drop the pair out of the game mid-question. Only at home does it leave.
const AppPlugin = plugin("App");
if(AppPlugin) AppPlugin.addListener("backButton", () => {
  const open = [...document.querySelectorAll(".sheet-wrap")].find(w => !w.hidden);
  if(open) closeSheet(open.id);
  else if(!$("passScreen").hidden) return;   // the next question is hidden on purpose; hold the ring
  else if(!$("play").hidden) showHome();
  else AppPlugin.exitApp();
});

const lastVer = store.get(K.ver, null);
if(lastVer && lastVer !== VERSION){
  setTimeout(() => toast("Updated to version " + VERSION + ".", "What's new", () => { $("toast").hidden = true; openMenu(); }), 600);
}
store.set(K.ver, VERSION);

renderResume();
})();
