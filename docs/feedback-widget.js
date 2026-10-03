/*
 * feedback-widget.js - drop-in tester feedback widget. MIT licensed.
 *
 *   <script src="feedback-widget.js" defer></script>
 *   <script>
 *     window.addEventListener("DOMContentLoaded", function () {
 *       Feedback.init({ endpoint: "https://feedback.example.com", appKey: "...", appVersion: "1.0.0" });
 *     });
 *   </script>
 *
 * Public API: window.Feedback = { init(opts), setContext(obj), open(), close() }
 * The source is ASCII only on purpose (the multiplication sign is written as \u00d7).
 */
(function () {
  "use strict";

  if (window.Feedback) return;

  var QUEUE_KEY = "fb:queue";
  var NAME_KEY = "fb:name";
  var MAX_QUEUE = 20;
  var MAX_ERRORS = 5;
  var SEND_TIMEOUT_MS = 15000;
  var PATH = "/v1/feedback";

  var TAGS = [
    ["broken", "Something broke"],
    ["confusing", "Confusing"],
    ["idea", "Idea"],
    ["love", "Love this"]
  ];

  var DEFAULT_THEME = {
    surface: "#1d1b20",
    field: "#2a272e",
    text: "#f4f0f6",
    muted: "#a9a1b0",
    line: "#3d3843",
    accent: "#ff9b6a",
    onAccent: "#1a1014",
    error: "#ff7b7b"
  };

  /* ---------- error capture (from script load onward) ---------- */

  var recentErrors = [];

  function pushError(text) {
    try {
      recentErrors.push(String(text).slice(0, 500));
      if (recentErrors.length > MAX_ERRORS) recentErrors.shift();
    } catch (e) { /* never let error capture throw */ }
  }

  function basename(url) {
    return String(url || "").split("?")[0].split("#")[0].split("/").pop();
  }

  window.addEventListener("error", function (ev) {
    var where = ev && ev.filename ? " (" + basename(ev.filename) + ":" + (ev.lineno || 0) + ")" : "";
    pushError(((ev && ev.message) || "Script error") + where);
  });

  window.addEventListener("unhandledrejection", function (ev) {
    var r = ev && ev.reason;
    pushError("Unhandled rejection: " + ((r && r.message) || String(r)));
  });

  /* ---------- storage (every access guarded) ---------- */

  function storeGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }

  function storeSet(key, value) {
    try { window.localStorage.setItem(key, value); return true; } catch (e) { return false; }
  }

  function readQueue() {
    try {
      var parsed = JSON.parse(storeGet(QUEUE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function writeQueue(list) {
    return storeSet(QUEUE_KEY, JSON.stringify(list.slice(-MAX_QUEUE)));
  }

  /* ---------- state ---------- */

  var cfg = null;
  var ctx = {};
  var ui = null;
  var isOpen = false;
  var sending = false;
  var flushing = false;
  var closeTimer = 0;
  var lastFocus = null;
  var selTag = null;
  var selRating = null;

  /* ---------- helpers ---------- */

  function newId() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === "function") return window.crypto.randomUUID();
    } catch (e) { /* fall through */ }
    var out = "fb-" + Date.now().toString(36);
    try {
      var bytes = new Uint8Array(12);
      window.crypto.getRandomValues(bytes);
      for (var i = 0; i < bytes.length; i++) out += ("0" + bytes[i].toString(16)).slice(-2);
    } catch (e) {
      for (var j = 0; j < 12; j++) out += Math.floor(Math.random() * 16).toString(16);
    }
    return out;
  }

  function sanitizeState(obj) {
    var out = {};
    var count = 0;
    for (var key in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
      if (key === "screen" || key.length > 60) continue;
      var v = obj[key];
      var t = typeof v;
      if (t === "string") v = v.slice(0, 300);
      else if (t === "number") { if (!isFinite(v)) continue; }
      else if (t !== "boolean") continue;
      if (count >= 20) break;
      out[key] = v;
      count++;
    }
    return out;
  }

  function buildContext() {
    var screen = typeof ctx.screen === "string" && ctx.screen ? ctx.screen : (location.hash || location.pathname);
    var c = {
      screen: String(screen).slice(0, 120),
      url: (location.origin + location.pathname).slice(0, 500),
      userAgent: String(navigator.userAgent || "").slice(0, 400),
      viewport: window.innerWidth + "x" + window.innerHeight,
      language: String(navigator.language || "").slice(0, 20),
      online: navigator.onLine !== false,
      submittedAt: new Date().toISOString(),
      app: sanitizeState(ctx)
    };
    if (cfg.appVersion) c.appVersion = String(cfg.appVersion).slice(0, 40);
    if (recentErrors.length) c.recentErrors = recentErrors.slice();
    return c;
  }

  function endpointUrl() {
    var base = String(cfg.endpoint).replace(/\/+$/, "");
    return base.slice(-PATH.length) === PATH ? base : base + PATH;
  }

  /* ---------- network: returns "sent" | "retry" | "reject" ---------- */

  function post(payload) {
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, SEND_TIMEOUT_MS) : 0;
    var init = {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-App-Key": cfg.appKey },
      body: JSON.stringify(payload),
      keepalive: true
    };
    if (controller) init.signal = controller.signal;
    return fetch(endpointUrl(), init).then(
      function (res) {
        clearTimeout(timer);
        if (res.ok) return "sent";
        if (res.status === 429 || res.status >= 500) return "retry";
        return "reject";
      },
      function () {
        clearTimeout(timer);
        return "retry";
      }
    );
  }

  function enqueue(payload) {
    var list = readQueue();
    list.push(payload);
    return writeQueue(list);
  }

  function flushQueue() {
    if (flushing || !cfg) return Promise.resolve();
    flushing = true;
    function next() {
      var list = readQueue();
      if (!list.length) return Promise.resolve();
      return post(list[0]).then(function (result) {
        if (result === "retry") return undefined;
        writeQueue(readQueue().slice(1));
        return next();
      });
    }
    return next().then(
      function () { flushing = false; },
      function () { flushing = false; }
    );
  }

  /* ---------- DOM ---------- */

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, k)) el.setAttribute(k, attrs[k]);
      }
    }
    if (kids) {
      for (var i = 0; i < kids.length; i++) {
        el.appendChild(typeof kids[i] === "string" ? document.createTextNode(kids[i]) : kids[i]);
      }
    }
    return el;
  }

  var CSS = [
    ":host{all:initial;font-family:inherit;font-size:16px;line-height:1.4;color:var(--fb-text);}",
    "*,*::before,*::after{box-sizing:border-box;font-family:inherit;}",
    "[hidden]{display:none !important;}",
    "button{font:inherit;color:inherit;cursor:pointer;}",
    ".launcher{position:fixed;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:2147483000;",
    "  border:1px solid var(--fb-line);border-radius:999px;padding:10px 18px;min-height:44px;",
    "  background:var(--fb-surface);color:var(--fb-text);font-weight:600;box-shadow:0 4px 18px rgba(0,0,0,.35);}",
    ".right .launcher{right:16px;} .left .launcher{left:16px;}",
    ".panel{position:fixed;bottom:calc(72px + env(safe-area-inset-bottom,0px));z-index:2147483001;width:360px;",
    "  max-width:calc(100vw - 32px);max-height:calc(100vh - 100px);overflow:auto;padding:18px;",
    "  background:var(--fb-surface);color:var(--fb-text);border:1px solid var(--fb-line);border-radius:16px;",
    "  box-shadow:0 12px 40px rgba(0,0,0,.45);}",
    ".right .panel{right:16px;} .left .panel{left:16px;}",
    ".head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;}",
    "h2{margin:0;font-size:1.15em;font-weight:700;}",
    ".sub{margin:6px 0 14px;color:var(--fb-muted);font-size:.9em;}",
    ".x{flex:none;width:44px;height:44px;margin:-8px -8px 0 0;border:0;background:transparent;",
    "  color:var(--fb-muted);font-size:1.6em;line-height:1;border-radius:10px;}",
    "label{display:block;margin:12px 0 6px;font-size:.85em;color:var(--fb-muted);}",
    "textarea,input[type=text]{width:100%;padding:10px 12px;background:var(--fb-field);color:var(--fb-text);",
    "  border:1px solid var(--fb-line);border-radius:10px;font-size:16px;}",
    "textarea{min-height:110px;resize:vertical;}",
    "textarea[aria-invalid=true]{border-color:var(--fb-error);}",
    ".row{display:flex;flex-wrap:wrap;gap:8px;}",
    ".chip,.star{border:1px solid var(--fb-line);background:var(--fb-field);border-radius:999px;",
    "  padding:8px 12px;min-height:44px;font-size:.9em;}",
    ".star{min-width:44px;padding:8px 0;}",
    ".chip[aria-pressed=true],.star[aria-pressed=true]{background:var(--fb-accent);color:var(--fb-on-accent);",
    "  border-color:var(--fb-accent);font-weight:600;}",
    ".send{width:100%;margin-top:16px;min-height:46px;border:0;border-radius:12px;background:var(--fb-accent);",
    "  color:var(--fb-on-accent);font-weight:700;}",
    ".send[disabled]{opacity:.6;cursor:default;}",
    ".status{min-height:1.4em;margin:10px 0 0;font-size:.9em;color:var(--fb-muted);}",
    ".status.err{color:var(--fb-error);}",
    ".hp{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden;}",
    "button:focus-visible,textarea:focus-visible,input:focus-visible{outline:2px solid var(--fb-accent);outline-offset:2px;}",
    "@media (max-width:520px){",
    "  .panel{left:0 !important;right:0 !important;bottom:0;width:100%;max-width:none;max-height:90vh;",
    "    border-radius:18px 18px 0 0;padding-bottom:calc(18px + env(safe-area-inset-bottom,0px));}",
    "}",
    "@media (prefers-reduced-motion:no-preference){",
    "  .panel{animation:fb-in .18s ease-out;}",
    "  .launcher,.chip,.star,.send{transition:background-color .15s,transform .15s;}",
    "  @keyframes fb-in{from{opacity:0;transform:translateY(12px);}to{opacity:1;transform:none;}}",
    "}"
  ].join("\n");

  function applyStyles(shadow) {
    try {
      if (typeof CSSStyleSheet === "function" && "adoptedStyleSheets" in shadow) {
        var sheet = new CSSStyleSheet();
        sheet.replaceSync(CSS);
        shadow.adoptedStyleSheets = [sheet];
        return;
      }
    } catch (e) { /* fall back to a style element */ }
    var style = document.createElement("style");
    style.textContent = CSS;
    shadow.appendChild(style);
  }

  function toggleGroup(container, selector, onChange) {
    container.addEventListener("click", function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest(selector) : null;
      if (!btn || !container.contains(btn)) return;
      var wasOn = btn.getAttribute("aria-pressed") === "true";
      var all = container.querySelectorAll(selector);
      for (var i = 0; i < all.length; i++) all[i].setAttribute("aria-pressed", "false");
      if (!wasOn) btn.setAttribute("aria-pressed", "true");
      onChange(wasOn ? null : btn.getAttribute("data-value"));
    });
  }

  function buildUi() {
    var host = h("div", { "data-feedback-widget": "" });
    var shadow = host.attachShadow({ mode: "open" });
    applyStyles(shadow);

    var theme = {};
    var src = cfg.theme || {};
    for (var key in DEFAULT_THEME) {
      theme[key] = typeof src[key] === "string" && src[key] ? src[key] : DEFAULT_THEME[key];
    }
    host.style.setProperty("--fb-surface", theme.surface);
    host.style.setProperty("--fb-field", theme.field);
    host.style.setProperty("--fb-text", theme.text);
    host.style.setProperty("--fb-muted", theme.muted);
    host.style.setProperty("--fb-line", theme.line);
    host.style.setProperty("--fb-accent", theme.accent);
    host.style.setProperty("--fb-on-accent", theme.onAccent);
    host.style.setProperty("--fb-error", theme.error);

    var wrap = h("div", { "class": cfg.position === "bottom-left" ? "left" : "right" });

    var launcher = h("button", { type: "button", "class": "launcher", "aria-haspopup": "dialog", "aria-expanded": "false" }, [cfg.launcherLabel]);
    if (cfg.hideLauncher) launcher.hidden = true;

    var closeBtn = h("button", { type: "button", "class": "x", "aria-label": "Close feedback" }, ["\u00d7"]);
    var title = h("h2", { id: "fb-title" }, [cfg.title]);
    var sub = h("p", { "class": "sub", id: "fb-sub" }, [cfg.subtitle]);

    var message = h("textarea", { id: "fb-msg", maxlength: "4000", rows: "4", placeholder: "What happened, or what would make this better?", "aria-describedby": "fb-sub" });
    var msgLabel = h("label", { "for": "fb-msg" }, ["Your feedback"]);

    var chips = h("div", { "class": "row", role: "group", "aria-label": "Type of feedback" });
    for (var i = 0; i < TAGS.length; i++) {
      chips.appendChild(h("button", { type: "button", "class": "chip", "data-value": TAGS[i][0], "aria-pressed": "false" }, [TAGS[i][1]]));
    }

    var stars = h("div", { "class": "row", role: "group", "aria-label": "Rating from 1 to 5" });
    for (var n = 1; n <= 5; n++) {
      stars.appendChild(h("button", { type: "button", "class": "star", "data-value": String(n), "aria-pressed": "false", "aria-label": n + " out of 5" }, [String(n)]));
    }

    var nameLabel = h("label", { "for": "fb-name" }, ["Your name (optional)"]);
    var nameInput = h("input", { type: "text", id: "fb-name", maxlength: "60", autocomplete: "given-name" });
    var nameWrap = h("div", null, [nameLabel, nameInput]);

    var honey = h("input", { type: "text", name: "website", tabindex: "-1", autocomplete: "off" });
    var hp = h("div", { "class": "hp", "aria-hidden": "true" }, [honey]);

    var send = h("button", { type: "button", "class": "send" }, ["Send feedback"]);
    var status = h("p", { "class": "status", role: "status", "aria-live": "polite" });

    var panel = h("div", { "class": "panel", role: "dialog", "aria-labelledby": "fb-title", "aria-modal": "false" }, [
      h("div", { "class": "head" }, [h("div", null, [title, sub]), closeBtn]),
      msgLabel, message,
      h("label", null, ["What kind of feedback?"]), chips,
      h("label", null, ["How is it going?"]), stars,
      nameWrap, hp, send, status
    ]);
    panel.hidden = true;

    wrap.appendChild(launcher);
    wrap.appendChild(panel);
    shadow.appendChild(wrap);

    toggleGroup(chips, ".chip", function (v) { selTag = v; });
    toggleGroup(stars, ".star", function (v) { selRating = v === null ? null : parseInt(v, 10); });

    launcher.addEventListener("click", function () { if (isOpen) close(); else open(); });
    closeBtn.addEventListener("click", close);
    send.addEventListener("click", submit);
    panel.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); submit(); }
    });

    document.body.appendChild(host);

    return {
      host: host, shadow: shadow, launcher: launcher, panel: panel, message: message, nameWrap: nameWrap,
      nameInput: nameInput, honey: honey, send: send, status: status, chips: chips, stars: stars
    };
  }

  function setStatus(text, isError) {
    ui.status.textContent = text;
    ui.status.className = isError ? "status err" : "status";
  }

  function resetForm() {
    ui.message.value = "";
    ui.message.removeAttribute("aria-invalid");
    selTag = null;
    selRating = null;
    var pressed = ui.shadow.querySelectorAll("[aria-pressed=true]");
    for (var i = 0; i < pressed.length; i++) pressed[i].setAttribute("aria-pressed", "false");
  }

  function savedName() {
    return (storeGet(NAME_KEY) || "").trim();
  }

  /* ---------- actions ---------- */

  function onKeydown(ev) {
    if (ev.key === "Escape" && isOpen) {
      ev.stopPropagation();
      close();
    }
  }

  function open() {
    if (!ui || isOpen) return;
    clearTimeout(closeTimer);
    isOpen = true;
    lastFocus = document.activeElement;
    var known = savedName();
    ui.nameWrap.hidden = !cfg.askName || !!known;
    setStatus("", false);
    ui.panel.hidden = false;
    ui.launcher.setAttribute("aria-expanded", "true");
    document.addEventListener("keydown", onKeydown, true);
    ui.message.focus();
  }

  function close() {
    if (!ui || !isOpen) return;
    clearTimeout(closeTimer);
    isOpen = false;
    ui.panel.hidden = true;
    ui.launcher.setAttribute("aria-expanded", "false");
    document.removeEventListener("keydown", onKeydown, true);
    var target = !ui.launcher.hidden ? ui.launcher : lastFocus;
    if (target && typeof target.focus === "function") target.focus();
  }

  function submit() {
    if (sending) return;
    var text = ui.message.value.trim();
    if (text.length < 3) {
      ui.message.setAttribute("aria-invalid", "true");
      setStatus("Please write a few words first.", true);
      ui.message.focus();
      return;
    }
    ui.message.removeAttribute("aria-invalid");

    var name = savedName() || (cfg.askName ? ui.nameInput.value.trim() : "");
    var payload = {
      clientId: newId(),
      message: text,
      rating: selRating,
      tag: selTag,
      testerName: name || null,
      website: ui.honey.value,
      context: buildContext()
    };

    sending = true;
    ui.send.disabled = true;
    setStatus("Sending...", false);

    post(payload).then(function (result) {
      sending = false;
      ui.send.disabled = false;
      if (result === "reject") {
        setStatus("Sorry, that could not be sent. Please try again later.", true);
        return;
      }
      if (name) storeSet(NAME_KEY, name);
      if (result === "retry") {
        if (!enqueue(payload)) {
          setStatus("Could not send, and this browser will not let me save it. Please try again.", true);
          return;
        }
        setStatus("Saved. It will send when you're back online.", false);
      } else {
        setStatus("Thank you! Your feedback was sent.", false);
        flushQueue();
      }
      resetForm();
      closeTimer = setTimeout(close, 2200);
    });
  }

  /* ---------- public API ---------- */

  function init(opts) {
    if (cfg) return;
    opts = opts || {};
    if (!opts.endpoint || !opts.appKey) {
      if (window.console) console.warn("[Feedback] init needs endpoint and appKey.");
      return;
    }
    if (String(opts.endpoint).indexOf("REPLACE_") !== -1 || String(opts.appKey).indexOf("REPLACE_") !== -1) {
      if (window.console) console.info("[Feedback] placeholder endpoint/appKey; widget not shown.");
      return;
    }
    cfg = {
      endpoint: String(opts.endpoint),
      appKey: String(opts.appKey),
      appVersion: opts.appVersion || "",
      theme: opts.theme || {},
      position: opts.position === "bottom-left" ? "bottom-left" : "bottom-right",
      hideLauncher: !!opts.hideLauncher,
      launcherLabel: opts.launcherLabel || "Feedback",
      title: opts.title || "Tell me what you think",
      subtitle: opts.subtitle || "Anything goes: bugs, confusing bits, ideas. Screen and device details are attached automatically.",
      askName: opts.askName !== false
    };

    function mount() {
      if (ui) return;
      ui = buildUi();
      flushQueue();
    }
    if (document.body) mount();
    else document.addEventListener("DOMContentLoaded", mount);

    window.addEventListener("online", function () { flushQueue(); });
  }

  function setContext(obj) {
    if (!obj || typeof obj !== "object") return;
    for (var key in obj) {
      if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
      if (obj[key] === null || obj[key] === undefined) delete ctx[key];
      else ctx[key] = obj[key];
    }
  }

  window.Feedback = { init: init, setContext: setContext, open: open, close: close };
})();
