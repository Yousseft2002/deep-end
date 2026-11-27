// Local development server: serves docs/ as static files and mounts the Inner Depth functions at
// /api/inner-depth/* with the same (req, res) signature Vercel uses. Loads .env.local if present.
//
//   npm run dev:inner-depth            # http://localhost:8123
//   PORT=9000 npm run dev:inner-depth
//
// Never run this with INNER_DEPTH_AI_MODE=mock against real people: mock mode is for tests.
import http from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
loadEnv(path.join(root, ".env.local"));

const docs = path.join(root, "docs");
const routes = {
  "/api/inner-depth/status": () => import("../api/inner-depth/status.js"),
  "/api/inner-depth/reflect": () => import("../api/inner-depth/reflect.js"),
  "/api/inner-depth/regenerate": () => import("../api/inner-depth/regenerate.js"),
  "/api/inner-depth/chat": () => import("../api/inner-depth/chat.js")
};
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".txt": "text/plain; charset=utf-8" };

export function createServer() {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
    const route = routes[url.pathname];
    if (route) {
      const mod = await route();
      return mod.default(req, res);
    }
    if (url.pathname.startsWith("/api/")) { res.statusCode = 404; return res.end("not found"); }
    let file = path.normalize(path.join(docs, decodeURIComponent(url.pathname)));
    if (!file.startsWith(docs)) { res.statusCode = 403; return res.end(); }
    if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, "index.html");
    if (!existsSync(file)) { res.statusCode = 404; return res.end("not found"); }
    res.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    res.end(readFileSync(file));
  });
}

export function loadEnv(file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (!m || line.trim().startsWith("#")) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^(["'])(.*)\1$/, "$2");
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.env.PORT) || 8123;
  createServer().listen(port, () => {
    const mode = process.env.INNER_DEPTH_AI_MODE === "mock" ? "MOCK (test only)" : process.env.OPENROUTER_API_KEY ? "live" : "live (no OPENROUTER_API_KEY: AI unavailable)";
    console.log(`Deep End dev server on http://localhost:${port}  Inner Depth AI: ${mode}`);
  });
}
