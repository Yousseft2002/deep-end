// Tester feedback. REPLACE_ the endpoint and key with the real feedback-service values.
// While they contain REPLACE_ the widget stays off and its menu and note-sheet buttons stay hidden.
window.addEventListener("DOMContentLoaded", function () {
  var cfg = {
    endpoint: "https://REPLACE_feedback.example.com",
    appKey: "REPLACE_WITH_DEEP_END_APP_KEY",
    appVersion: self.DEEPEND_VERSION || "dev",
    hideLauncher: true,   // opened from the menu, so it never sits over the depth slider
    theme: {
      surface: "var(--sheet)", field: "var(--water)", text: "var(--ink)", muted: "var(--muted)",
      line: "var(--line)", accent: "var(--buoy)", onAccent: "var(--buoy-ink)", error: "var(--ring)"
    }
  };
  if (/REPLACE_/.test(cfg.endpoint + cfg.appKey) || !self.Feedback) return;
  Feedback.init(cfg);
  document.querySelectorAll("[data-tester-fb]").forEach(function (el) { el.hidden = false; });
});
