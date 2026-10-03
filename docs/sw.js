// Offline copy of the app, one cache per release.
// Browsers re-check this file (and version.js) on each launch; a changed byte means a
// new release, which installs in the background and waits for the player to tap Update.
importScripts("version.js");

const CACHE = "deepend-" + self.DEEPEND_VERSION;
const DEV = ["localhost", "127.0.0.1"].includes(location.hostname);
const SHELL = [
  "./", "index.html", "styles.css", "app.js", "questions.js", "version.js",
  "feedback-widget.js", "manifest.webmanifest", "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png",
  "icons/apple-touch-icon.png", "privacy.html", "support.html",
  "fonts/bricolage-latin.woff2", "fonts/bricolage-latin-ext.woff2",
  "fonts/young-serif-latin.woff2", "fonts/young-serif-latin-ext.woff2"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache:"reload" })))));
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith("deepend-") && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", e => {
  if(e.data && e.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if(req.method !== "GET") return;
  const url = new URL(req.url);

  if(url.origin !== location.origin) return;

  // Everything of ours comes from this release's cache, so a release is all-or-nothing.
  // Except on your own computer, where edits should show on refresh without a release.
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    // Pages (privacy, help) are served as themselves; any unknown page falls back to the game.
    const cached = async () => (await c.match(req, { ignoreSearch:true }))
      || (req.mode === "navigate" ? await c.match("index.html") : undefined);
    if(DEV){
      try { return await fetch(req); }
      catch(err){ return (await cached()) || Response.error(); }
    }
    return (await cached()) || fetch(req);
  })());
});
