// Where the Inner Depth page finds its AI organizer. Same-origin by default: when docs/ and api/ are
// deployed together (Vercel, or the local dev server) nothing needs to change. For GitHub Pages pointing
// at a separate API host, set base to that origin (e.g. "https://deep-end.vercel.app/api/inner-depth"),
// add the origin to connect-src in inner-depth.html, and list the Pages origin in INNER_DEPTH_ALLOWED_ORIGINS.
// This file holds no secrets. The facilitator access code is typed in each session and kept in memory only.
self.INNER_DEPTH_API = { base: "/api/inner-depth", timeoutMs: 95000 };
