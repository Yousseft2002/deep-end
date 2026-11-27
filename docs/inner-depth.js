(() => {
"use strict";
const Q = [
  [
    "Identity",
    "How would you describe yourself right now, in your own words?",
    "Listen for what they value about themselves. Avoid evaluating their answer."
  ],
  [
    "Being seen",
    "When do you feel most like yourself, and when do you feel misunderstood?",
    "Let them choose the people or situations they want to talk about."
  ],
  [
    "Experiences",
    "What experiences, if any, feel important to who you are today?",
    "They do not need to revisit painful events. Accept a broad answer."
  ],
  [
    "Emotions",
    "When life feels difficult, what tends to happen inside you?",
    "Reflect their own words. Don't interpret silence or guess what is hidden."
  ],
  [
    "Inner tensions",
    "Are there different wishes, feelings or sides of yourself that sometimes pull you in different directions?",
    "If not, move on. Let them describe any conflict in their own language."
  ],
  [
    "Needs and support",
    "What helps you feel understood, supported or at peace?",
    "Ask what matters to them, not what you think they should need."
  ],
  [
    "Values",
    "What matters most to you when you make a difficult decision?",
    "Make room for personal, cultural and spiritual values without assuming them."
  ],
  [
    "Looking forward",
    "What would you like to understand or accept about yourself a little more?",
    "Let them decide whether there is anything to take forward."
  ]
];
const $ = id => document.getElementById(id);
const screens = ["intro","context","question","review","result","readout"];
let notes = Q.map(() => ""), index=0, active=false, reviewed=false;
let ageBand="unknown", prior="", observed="", drafts=Q.map(()=>""), selected=Q.map(()=>false);
const ageInputs=[...document.querySelectorAll('input[name="age-band"]')];
function promptFor(i){
  if(ageBand==="adult")return Q[i][1];
  return ({2:"What activities, people or experiences have mattered to you lately?",4:"Are there times when you want two different things at once?",7:"What would you like to understand about yourself or feel more comfortable with?"})[i] || Q[i][1];
}
function updateAge(){
  ageBand=ageInputs.find(el=>el.checked)?.value||"unknown";
  $("begin").disabled=ageBand==="child";$("skip-context").disabled=ageBand==="child";
  $("age-guidance").textContent=ageBand==="child"?"This prototype is not intended for children under 13. End this reflection.":ageBand==="adult"?"Adult reflection; background remains optional.":"Use age-appropriate, low-pressure prompts. Local only; obtain assent and any necessary guardian permission.";
}
function begin(skip){
  updateAge();if(ageBand==="child")return;
  prior=skip?"":$("prior-context").value;observed=skip?"":$("observed-context").value;
  $("prior-context").value=prior;$("observed-context").value=observed;index=0;question();
}
function show(id, focus) {
  for (const screen of screens) $(screen).hidden = screen !== id;
  $("clear").hidden = !active;
  if (focus) $(focus).focus();
  window.scrollTo(0,0);
}
function capture() { if (!$("question").hidden) notes[index] = $("notes").value; }
function question(focus=true) {
  $("step").textContent = "Question " + (index+1) + " of " + Q.length;
  $("progress").value = index+1;
  $("prompt").textContent = promptFor(index);
  $("listen").textContent = ageBand==="adult"?Q[index][2]:"Let them choose what to share. Keep it age-appropriate and allow them to skip or stop.";
  $("notes").value = notes[index];
  $("back").disabled = index === 0;
  $("next").textContent = index === Q.length-1 ? "Review" : "Next";
  show("question", focus ? "prompt" : null);
}
function review() {
  capture();
  const parent = $("review-fields");
  parent.replaceChildren();
  const context=$("review-context");context.replaceChildren();
  const heading=document.createElement("strong");heading.textContent="Background — review or remove together";context.append(heading);
  [["Previously shared",prior,v=>{prior=v;$("prior-context").value=v;}],["Facilitator impressions (not participant statements)",observed,v=>{observed=v;$("observed-context").value=v;}]].forEach(([name,value,save],i)=>{
    const label=document.createElement("label");label.htmlFor="context-review-"+i;label.textContent=name;
    const field=document.createElement("textarea");field.id=label.htmlFor;field.value=value;field.maxLength=i?1200:1600;field.addEventListener("input",()=>save(field.value));context.append(label,field);
  });
  Q.forEach((q,i) => {
    const field = document.createElement("div");
    field.className="review-field";
    const label=document.createElement("label");
    label.htmlFor="review-note-"+i;
    label.textContent=(i+1)+". "+promptFor(i);
    const input=document.createElement("textarea");
    input.id=label.htmlFor; input.maxLength=1600; input.value=notes[i];
    input.placeholder="Not answered";
    input.addEventListener("input",()=>{notes[i]=input.value;drafts[i]="";selected[i]=false;});
    field.append(label,input);parent.append(field);
  });
  reviewed=false;show("review","review-title");
}
function organize() {
  const parent=$("reflection");parent.replaceChildren();
  let count=0;
  if(prior.trim()||observed.trim()){
    const card=document.createElement("div");card.className="panel note-card";
    const title=document.createElement("h3");title.textContent="Background only — not selected for read-aloud";card.append(title);
    for(const [label,value] of [["Previously shared",prior],["Facilitator impressions",observed]]){
      if(!value.trim())continue;const p=document.createElement("p");p.textContent=label+": "+value;card.append(p);
    }
    parent.append(card);
  }
  Q.forEach((q,i)=>{
    const value=notes[i].trim();if(!value)return;count++;
    const item=document.createElement("div");item.className="panel note-card";
    const title=document.createElement("h3");title.textContent=q[0];
    const text=document.createElement("p");text.textContent="Source notes: "+value;
    const label=document.createElement("label");label.htmlFor="draft-"+i;label.textContent="Your read-aloud wording";
    const draft=document.createElement("textarea");draft.id=label.htmlFor;draft.maxLength=1000;draft.value=drafts[i];draft.placeholder="You described… / You mentioned… / Does that sound right?";
    const check=document.createElement("input");check.type="checkbox";check.checked=selected[i]&&!!draft.value.trim();check.disabled=!draft.value.trim();
    const selectLabel=document.createElement("label");selectLabel.append(check,document.createTextNode(" Include this reflection"));
    draft.addEventListener("input",()=>{drafts[i]=draft.value;check.disabled=!draft.value.trim();if(!draft.value.trim()){check.checked=false;selected[i]=false;}});
    check.addEventListener("change",()=>{selected[i]=check.checked;});
    item.append(title,text,label,draft,selectLabel);parent.append(item);
  });
  if(!count){const p=document.createElement("p");p.textContent="No participant answers were recorded. Background alone is not enough to create a reflection.";parent.append(p);}
  reviewed=true;show("result","result-title");
}
function readout(){
  const parent=$("readout-items");parent.replaceChildren();let count=0;
  Q.forEach((q,i)=>{if(!selected[i]||!drafts[i].trim()||!notes[i].trim())return;count++;
    const card=document.createElement("div");card.className="panel note-card";
    const h=document.createElement("h3");h.textContent=q[0];const p=document.createElement("p");p.textContent=drafts[i].trim();card.append(h,p);parent.append(card);
  });
  if(!count){const p=document.createElement("p");p.textContent="No reflections selected. You can simply thank them for sharing, or return to review.";parent.append(p);}
  show("readout","read-title");
}
function erase() {
  notes=Q.map(()=> "");index=0;active=false;reviewed=false;prior="";observed="";drafts=Q.map(()=> "");selected=Q.map(()=>false);
  $("prior-context").value="";$("observed-context").value="";$("review-context").replaceChildren();$("readout-items").replaceChildren();ageInputs.forEach(el=>el.checked=el.value==="unknown");updateAge();
  $("notes").value="";$("review-fields").replaceChildren();$("reflection").replaceChildren();
  $("consent").checked=false;$("start").disabled=true;
  show("intro","consent");
}
function confirmErase(){ if(!notes.some(n=>n.trim()) && !$("notes").value.trim() && !prior.trim() && !observed.trim() && !$("prior-context").value.trim() && !$("observed-context").value.trim() && !drafts.some(n=>n.trim()))return true;return window.confirm("End this reflection and erase all notes?");}
$("consent").addEventListener("change",()=>{$("start").disabled=!$("consent").checked;});
$("start").addEventListener("click",()=>{if(!$("consent").checked)return;active=true;index=0;updateAge();show("context","context-title");});
ageInputs.forEach(el=>el.addEventListener("change",updateAge));
$("begin").addEventListener("click",()=>begin(false));
$("skip-context").addEventListener("click",()=>begin(true));
$("notes").addEventListener("input",()=>{capture();drafts[index]="";selected[index]=false;});
$("back").addEventListener("click",()=>{capture();if(index>0){index--;question();}});
$("next").addEventListener("click",()=>{capture();if(index<Q.length-1){index++;question();}else review();});
$("skip").addEventListener("click",()=>{capture();if(notes[index].trim()&&!window.confirm("Skip this question and remove its notes?"))return;notes[index]="";drafts[index]="";selected[index]=false;$("notes").value="";if(index<Q.length-1){index++;question();}else review();});
$("finish").addEventListener("click",review);
$("resume").addEventListener("click",()=>question());
$("organize").addEventListener("click",organize);
$("edit").addEventListener("click",review);
$("read").addEventListener("click",readout);
$("back-selection").addEventListener("click",organize);
$("clear").addEventListener("click",()=>{if(confirmErase())erase();});
$("done").addEventListener("click",()=>{if(confirmErase())erase();});
$("home-link").addEventListener("click",e=>{if(active&&!confirmErase()){e.preventDefault();return;}if(active)erase();});
window.addEventListener("pagehide",()=>{if(active)erase();});
})();