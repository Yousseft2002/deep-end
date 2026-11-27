// Imminent-harm screen shared by the page (before anything is sent) and the server (before the model runs).
// It is a short list of explicit phrases, not a risk score. A match only means: stop organizing and point
// to a human. Plain script so the browser can load it with a <script> tag; the server evaluates it with a stub `self`.
(function (root) {
  "use strict";
  var PATTERNS = [
    // The participant's own safety.
    /\b(kill|end(ing)?|take|taking)\s+(my|their|his|her)\s+(own\s+)?(self|life)\b/i,
    /\b(suicid(e|al)|end it all|not want(ing)? to be alive|don'?t want to (be here|live|wake up)|better off dead)\b/i,
    /\b(plan|planning|going|want|wants|wanted|intend|intends)\s+(to\s+)?(die|kill (myself|themselves|himself|herself)|overdose|hang (myself|themselves))\b/i,
    /\b(self[- ]?harm|hurt(ing)? (myself|themselves)|cut(ting)? (myself|themselves))\b/i,
    // Harm to someone else.
    /\b(kill|hurt|harm|attack|shoot|stab)\s+(him|her|them|someone|somebody|my (partner|wife|husband|child|kids|mother|father|boss)|the (kids|children))\b/i,
    /\b(going|plan(ning)?|want(s|ed)?)\s+to\s+(kill|hurt|harm|attack|shoot|stab)\b/i,
    // Harm from someone else that is happening now.
    /\b(being|am|is|are)\s+(abused|beaten|hit|threatened|held)\s+(right now|tonight|today|at home)\b/i,
    /\b(not safe|unsafe|in danger)\s+(right now|tonight|at home|here)\b/i
  ];
  var SAFETY = {
    version: "2026-11",
    patterns: PATTERNS,
    // Returns true when any pattern matches. Keep it conservative: a false positive costs a pause;
    // a false negative costs more. Multiline notes are checked line by line.
    screen: function (text) {
      if (!text) return false;
      var s = String(text).replace(/\s+/g, " ");
      for (var i = 0; i < PATTERNS.length; i++) if (PATTERNS[i].test(s)) return true;
      return false;
    },
    // Read-aloud guidance for the facilitator. Plain, practical, no risk assessment.
    guidance: [
      "Something in these notes points to someone's immediate safety. The reflection can wait.",
      "Stay with the person. Ask directly and calmly whether they are safe right now, and whether anyone else is.",
      "If there is any immediate danger, contact local emergency services or go to the nearest emergency department together.",
      "If you are in the UK or Ireland you can also call Samaritans on 116 123 at any time; in the US and Canada, call or text 988. Elsewhere, use your country's crisis line or emergency number.",
      "Do not promise secrecy. Help them reach a trusted adult, a doctor, or a crisis service they are willing to use.",
      "Nothing you wrote here has been sent anywhere. Use End and erase when you are done."
    ]
  };
  if (typeof module !== "undefined" && module.exports) module.exports = SAFETY;
  root.INNER_DEPTH_SAFETY = SAFETY;
})(typeof self !== "undefined" ? self : this);
