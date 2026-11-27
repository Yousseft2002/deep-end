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
const screens = ["intro","question","review","result"];
let notes = Q.map(() => ""), index=0, active=false, reviewed=false;
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
  $("prompt").textContent = Q[index][1];
  $("listen").textContent = Q[index][2];
  $("notes").value = notes[index];
  $("back").disabled = index === 0;
  $("next").textContent = index === Q.length-1 ? "Review" : "Next";
  show("question", focus ? "prompt" : null);
}
function review() {
  capture();
  const parent = $("review-fields");
  parent.replaceChildren();
  Q.forEach((q,i) => {
    const field = document.createElement("div");
    field.className="review-field";
    const label=document.createElement("label");
    label.htmlFor="review-note-"+i;
    label.textContent=(i+1)+". "+q[1];
    const input=document.createElement("textarea");
    input.id=label.htmlFor; input.maxLength=1600; input.value=notes[i];
    input.placeholder="Not answered";
    input.addEventListener("input",()=>{notes[i]=input.value;});
    field.append(label,input);parent.append(field);
  });
  reviewed=false;show("review","review-title");
}
function organize() {
  const parent=$("reflection");parent.replaceChildren();
  let count=0;
  Q.forEach((q,i)=>{
    const value=notes[i].trim();if(!value)return;count++;
    const item=document.createElement("div");item.className="panel note-card";
    const title=document.createElement("h3");title.textContent=q[0];
    const text=document.createElement("p");text.textContent=value;
    item.append(title,text);parent.append(item);
  });
  if(!count){const p=document.createElement("p");p.textContent="Nothing was recorded. You can end here or return to your notes.";parent.append(p);}
  reviewed=true;show("result","result-title");
}
function erase() {
  notes=Q.map(()=> "");index=0;active=false;reviewed=false;
  $("notes").value="";$("review-fields").replaceChildren();$("reflection").replaceChildren();
  $("consent").checked=false;$("start").disabled=true;
  show("intro","consent");
}
function confirmErase(){ if(!notes.some(n=>n.trim()) && !$("notes").value.trim())return true;return window.confirm("End this reflection and erase all notes?");}
$("consent").addEventListener("change",()=>{$("start").disabled=!$("consent").checked;});
$("start").addEventListener("click",()=>{if(!$("consent").checked)return;active=true;index=0;question();});
$("notes").addEventListener("input",capture);
$("back").addEventListener("click",()=>{capture();if(index>0){index--;question();}});
$("next").addEventListener("click",()=>{capture();if(index<Q.length-1){index++;question();}else review();});
$("skip").addEventListener("click",()=>{capture();if(notes[index].trim()&&!window.confirm("Skip this question and remove its notes?"))return;notes[index]="";$("notes").value="";if(index<Q.length-1){index++;question();}else review();});
$("finish").addEventListener("click",review);
$("resume").addEventListener("click",()=>question());
$("organize").addEventListener("click",organize);
$("edit").addEventListener("click",review);
$("clear").addEventListener("click",()=>{if(confirmErase())erase();});
$("done").addEventListener("click",()=>{if(confirmErase())erase();});
$("home-link").addEventListener("click",e=>{if(active&&!confirmErase()){e.preventDefault();return;}if(active)erase();});
window.addEventListener("pagehide",()=>{if(active)erase();});
})();