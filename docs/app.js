(() => {
"use strict";

const VERSION = self.DEEPEND_VERSION || "dev";
const CHANGES = self.DEEPEND_CHANGES || [];
const { LEVELS, GROUPS, Q, FOLLOW = [], MOMENTS = {} } = self.DEEPEND_BANK;
const WATER = ["#082229","#08192B","#071226","#050B1B","#03050E"];
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
let prefs = Object.assign({ passScreen:true, transitions:!REDUCED, moments:true, fish:true, nameA:"", nameB:"", general:"" }, store.get(K.prefs, {}));
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

// ---------- sheets ----------
let lastFocus = null;
function openSheet(id){
  lastFocus = document.activeElement;
  $(id).hidden = false;
  const f = $(id).querySelector("[data-close].x"); if(f) f.focus();
}
function closeSheet(id){ $(id).hidden = true; if(lastFocus && lastFocus.focus) lastFocus.focus(); }
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

function renderResume(){
  const last = store.get(K.last, null);
  $("resume").hidden = !last;
  if(last) $("resumeText").textContent = "With " + last.phrase + " · " + LEVELS[last.level-1];
}
$("resume").onclick = () => {
  const l = store.get(K.last, null);
  if(l) start(l.label, l.cat, l.phrase, l.level);
};

function showHome(){
  $("play").hidden = true; $("home").hidden = false;
  setLevel(1, false); renderResume();
}
$("goHome").onclick = showHome;
$("changeWho").onclick = showHome;

// ---------- turns ----------
function names(){ return [prefs.nameA, prefs.nameB]; }
function turnText(){
  const [a, b] = names();
  if(state.current && state.current.moment) return a && b ? "A moment for " + a + " and " + b : "A moment for you both";
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
    pick.both = session.asked % 3 === 0;
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
  $("changeWho").textContent = "With " + phrase;
  $("home").hidden = true; $("play").hidden = false;
  setLevel(level || 1, false);
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
  $("dig").hidden = !(pick && pick.f);
  $("dig").setAttribute("aria-expanded", "false");
  $("followQ").hidden = true;
  $("followText").textContent = pick ? pick.f : "";
}
$("dig").onclick = () => {
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
  // People who ask follow-ups are liked more and feel more understood (Huang et al. 2017),
  // and most players never think to; so early in a sitting, say so.
  const c = state.current;
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
  document.querySelector('meta[name="theme-color"]').content = WATER[l-1];
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
  if(state.current && !state.current.moment){ state.turn = 1 - state.turn; session.answered++; }
  session.skips = 0;
  newQuestion();
  if(prefs.passScreen && state.current && !state.current.moment) dive();
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
  setTimeout(() => { surf.hidden = true; surf.classList.remove("out", "holding"); setHold(0); $("next").focus(); }, 500);
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
// starts: flying fish, a small school, a manta, a lanternfish, an anglerfish. Decoration only: never
// more than one, never over a sheet or the hand-off, and none at all when the phone asks for
// reduced motion. Each is a small SVG facing right (flipped when it swims left), built once and cloned.
const motion = matchMedia("(prefers-reduced-motion: reduce)");
const SEA = {
  1: { kind:"flying", vb:[56, 24], w:[48, 58], dur:[8, 11], y:[15, 22], amp:[0, 0], wave:[3, 4], art:
    '<g class="pitch"><path d="M8 13C15 9.5 32 9.5 47 13C32 16.5 15 16.5 8 13Z"/>' +
    '<path class="tail" d="M10 13L1 6L5.5 13L2 21Z"/><path d="M34 13.5L28 17L32 14.5Z"/>' +
    '<g class="wings"><path d="M36 11.5C32 4 22 -1 6 0C17 4 26 8.5 31 12.5Z"/>' +
    '<path class="far" d="M36 13.5C32 20 22 23.5 10 23.5C20 20 27 16.5 31 13.5Z"/></g></g>' },
  2: { kind:"school", vb:[24, 12], w:[16, 22], dur:[9, 13], y:[24, 68], amp:[2, 5], wave:[1.8, 3], art:
    '<path class="tail" d="M7.5 6L1 1.5Q3.4 6 1 10.5Z"/><path d="M6 6C9 1.5 17 1.5 23 6C17 10.5 9 10.5 6 6Z"/>' },
  3: { kind:"manta", vb:[100, 60], w:[84, 108], dur:[14, 18], y:[26, 66], amp:[5, 9], wave:[4.5, 6], art:
    '<g class="wings"><path d="M86 28C78 14 62 5 44 2C49 12 50 22 46 30Z"/>' +
    '<path d="M86 32C78 46 62 55 44 58C49 48 50 38 46 30Z"/></g>' +
    '<path d="M96 30C92 25 82 25 66 27L44 30L66 33C82 35 92 35 96 30Z"/>' +
    '<path d="M94 26.5L99.5 23.5L96 29ZM94 33.5L99.5 36.5L96 31Z"/><path class="tail" d="M48 29.4L2 30L48 30.6Z"/>' },
  4: { kind:"lantern", vb:[40, 18], w:[42, 54], dur:[10, 14], y:[26, 72], amp:[4, 9], wave:[3, 4.5], art:
    '<g class="body"><path class="tail" d="M11 9L1 3Q4.5 9 1 15Z"/><path d="M9 9C13 2.5 27 2.5 39 9C27 15.5 13 15.5 9 9Z"/></g>' +
    '<g class="dots"><circle cx="14" cy="11.6" r="1"/><circle cx="18" cy="12.5" r="1"/><circle cx="22" cy="12.8" r="1"/>' +
    '<circle cx="26" cy="12.6" r="1"/><circle cx="30" cy="11.9" r="1"/><circle cx="34" cy="10.6" r="1"/><circle cx="35.5" cy="7" r=".9"/></g>' },
  5: { kind:"angler", vb:[64, 44], w:[50, 62], dur:[12, 14], y:[30, 72], amp:[3, 6], wave:[3.5, 5], art:
    '<defs><radialGradient id="lure-glow"><stop offset="0" style="stop-color:var(--glow);stop-opacity:.75"/>' +
    '<stop offset="1" style="stop-color:var(--glow);stop-opacity:0"/></radialGradient></defs>' +
    '<g class="body"><path class="tail" d="M15 25L2 15Q6 25 2 35Z"/>' +
    '<path d="M13 25C13 11 31 7 43 13C51 17 53 29 47 35C37 41 15 39 13 25Z"/>' +
    '<path d="M42 27C50 25 58 28 61 34C55 38 46 37 39 34Z"/></g>' +
    '<path class="teeth" d="M46 30.5l1.4-4l1.4 4zM50 31.5l1.4-4l1.4 4zM54 32.5l1.4-4l1.4 4zM47 26l1.4 3.6l1.4-3.6zM51 26.4l1.4 3.6l1.4-3.6z"/>' +
    '<circle class="eye" cx="41" cy="20" r="1.8"/>' +
    '<g class="lure"><path class="stalk" d="M34 9C35 -1 45 -2 52 4"/><circle class="halo" cx="52" cy="4" r="22" fill="url(#lure-glow)"/>' +
    '<circle class="bulb" cx="52" cy="4" r="2.5"/></g>' }
};
const seaArt = {};
function seaSvg(level){
  if(!seaArt[level]){
    const box = document.createElement("div"), [vw, vh] = SEA[level].vb;
    box.innerHTML = '<svg viewBox="0 0 ' + vw + ' ' + vh + '" aria-hidden="true">' + SEA[level].art + '</svg>';
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
  setVar(bob, "--w", Math.round(w) + "px"); setVar(bob, "--h", (w * c.vb[1] / c.vb[0]).toFixed(1) + "px");
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
  const level = state.level, c = SEA[level];
  const ltr = Math.random() < 0.5, dur = rand(...c.dur), y = rand(...c.y), W = innerWidth;
  const x0 = ltr ? -120 : W + 120, x1 = ltr ? W + 120 : -120;
  const holder = document.createElement("div"), el = document.createElement("div");
  holder.className = "sea";
  el.className = "fish k-" + c.kind + (ltr ? "" : " rtl");
  setVar(el, "--y", y.toFixed(1) + "vh"); setVar(el, "--dur", dur.toFixed(1) + "s");
  setVar(el, "--x0", x0 + "px"); setVar(el, "--x1", x1 + "px"); setVar(el, "--span", (x1 - x0) + "px");
  if(c.kind === "school"){
    const n = 3 + Math.floor(Math.random() * 3);
    for(let i = 0; i < n; i++){
      const b = document.createElement("div"), w = rand(...c.w);
      b.className = "buddy";
      b.style.left = Math.round((i - (n - 1) / 2) * 26 + rand(-8, 8)) + "px";
      b.style.top = Math.round(rand(-20, 20)) + "px";
      setVar(b, "--bd", rand(2.4, 4).toFixed(2) + "s"); setVar(b, "--bp", (-rand(0, 4)).toFixed(2) + "s");
      setVar(b, "--tw", rand(.45, .7).toFixed(2) + "s"); setVar(b, "--tp", (-rand(0, .7)).toFixed(2) + "s");
      b.appendChild(seaBody(level, w, rand(...c.amp), rand(...c.wave)));
      el.appendChild(b);
    }
  } else {
    const w = rand(...c.w);
    el.appendChild(seaBody(level, w, rand(...c.amp), rand(...c.wave)));
    if(c.kind === "flying"){
      // It leaves and re-enters the water at about 28% and 76% of the crossing: a ripple at each spot.
      setVar(el, "--leap", Math.round(rand(46, 72)) + "px");
      const wy = innerHeight * y / 100 + w * c.vb[1] / c.vb[0] * .8;
      [.28, .76].forEach(f => {
        const r = document.createElement("div");
        r.className = "ripple";
        r.style.left = Math.round(x0 + (x1 - x0) * f + w / 2) + "px"; r.style.top = Math.round(wy) + "px";
        setVar(r, "--rd", (dur * f).toFixed(2) + "s");
        holder.appendChild(r);
      });
    }
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

const lastVer = store.get(K.ver, null);
if(lastVer && lastVer !== VERSION){
  setTimeout(() => toast("Updated to version " + VERSION + ".", "What's new", () => { $("toast").hidden = true; openMenu(); }), 600);
}
store.set(K.ver, VERSION);

renderResume();
})();
