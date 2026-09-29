# Deep End — instructions for coding agents

Deep End is a conversation game for two people sharing one phone. Pick who you're with, drag the
life-ring slider to choose how deep the questions go (Shallows → The deep end), and take turns asking.
It ships three ways from the same files: a website and installable PWA (GitHub Pages serves `docs/`),
and App Store / Google Play apps (Capacitor bundles `docs/`, Codemagic builds them in the cloud).

The owner is play-testing it with friends and will submit it to the stores. Keep the game playable at every commit.

## Layout

| Path | Role |
|---|---|
| `docs/questions.js` | **The content.** Relationship groups; per category, five depth lists of `[question, follow-up]` pairs, plus `MOMENTS` (short things to do together) and general `FOLLOW`-ups. |
| `docs/index.html` | All markup: home, play screen, underwater hand-off overlay, sheets (saved, note, menu), toast. |
| `docs/styles.css` | All styles. Color tokens on `:root`; `body[data-level]` sets `--water` and `--glow` per depth. |
| `docs/app.js` | All behaviour, one IIFE, vanilla JS. |
| `docs/version.js` | `DEEPEND_VERSION` + `DEEPEND_CHANGES`. Read by the page AND the service worker. |
| `docs/sw.js` | Offline cache per release + update flow. |
| `docs/privacy.html`, `docs/support.html` | Required by both stores. Linked from the in-app menu. |
| `docs/fonts/` | Self-hosted Bricolage Grotesque + Young Serif (OFL; keep the license files). |
| `tools/release.py` | Bumps the version and adds a "What's new" entry. |
| `tools/make_icons.py` | Draws all icons (`--store` also draws `assets/` for store builds). |
| `capacitor.config.json`, `package.json`, `codemagic.yaml` | Store builds. `ios/` and `android/` are generated, never committed. |
| `STORE-CHECKLIST.md` | Store submission steps and requirements. |

## Rules that matter

1. **The depth slider is the app's identity.** Do not restyle, resize or re-behave it: the 42px red/white
   life-ring knob, the gradient track, the 30px rail insets, the spring on release, tap-to-snap and
   drag-to-glide. The water colour deepening with the level is part of it.
2. **No build step, no frameworks, no npm packages in the web app.** Plain HTML/CSS/JS in `docs/` that runs
   by opening it from a static server. npm is only for the Capacitor store builds.
3. **Everything works offline and makes no network requests while playing.** No CDNs, no analytics, no
   remote fonts. The privacy policy promises this; if that ever changes, update `docs/privacy.html` in the same change.
4. **Every new file the app needs goes into the `SHELL` list in `docs/sw.js`**, or installed copies break offline.
5. **Shipping a change = `python tools/release.py X.Y.Z "note players will read"`**, then commit and push.
   Without a version bump, installed phones never see the update. Notes are shown to players verbatim: plain words.
6. **Questions are append-only within a list.** A question's id is `category-level-index` (moments:
   `category-mlevel-index`), and "already seen" history stores those ids. Add at the end; don't insert,
   reorder or delete in the middle. Rewording in place is fine if the question keeps its meaning.
7. **Guard all storage.** Use the `store.get/set` helpers (try/catch). Private browsing must not break the game.
8. **Store builds:** `NATIVE` in `app.js` is true inside Capacitor. There, use `haptic()` and `shareText()`
   (native Haptics/Share plugins with web fallbacks), and never register the service worker.
   Apple rejects "websites in a wrapper" (guideline 4.2), so native touches matter; don't remove them.
9. **Accessibility:** real `<button>`s, 44px minimum touch targets, visible focus, `aria-*` on custom controls.
   Anything hold- or drag-only needs a keyboard/screen-reader path (see the hand-off's `e.detail === 0` click).
   Respect `prefers-reduced-motion`.
10. **Settings live in `prefs`** (saved to localStorage) with a toggle in the menu's Settings block.
    Current ones: `transitions` (question transitions), `passScreen` (underwater hand-off),
    `moments` (shared moments every few turns), `fish` (a small fish swims by now and then), `nameA`/`nameB`.

## Style

- Match the surrounding code: small functions, `$()` for `getElementById`, 2-space indent, comments that say *why*.
- Visual language: a night swim. Always-dark water that darkens with depth, lit by `--glow`, which warms from
  aqua (Shallows) to ember rose (The deep end) and colours accents, kickers and icons. Frosted-glass controls
  (`--glass`, `--line`), yellow `--buoy` for primary actions, Bricolage Grotesque for UI, Young Serif for the
  questions and headings. Water, depth and surfacing are the metaphors.
- Picking the next card (`draw()` in `app.js`): never repeats per relationship; scores what's left to avoid
  echoing the last few cards and to lean toward what the pair saves or follows up on and away from what they
  skip; a moment every 5 to 7 cards; a "go deeper" nudge after 4 answers at one depth. All per sitting.
- Copy is warm, short and plain. No emoji.

## Run and check

```bash
python -m http.server 8123 -d docs
```

Open http://localhost:8123 in a phone-sized browser window (DevTools device mode, 375×812).
On localhost the service worker fetches from the network first, so edits show on refresh.

Before calling a change done:
- Play a round: pick a relationship, drag the slider to each depth, Next (with the hand-off), Skip, Save, Note.
- Open the menu and check every toggle still works.
- The DevTools console has no errors.
- If you added a file, it's in `SHELL` in `docs/sw.js`.
- If it should reach players, run `tools/release.py`.

## Don't

- Commit `ios/`, `android/`, `node_modules/`, or any signing keys (`*.keystore`, `*.p8`, `*.p12`).
- Change `appId` in `capacitor.config.json`: it's permanent once uploaded to a store.
- Push, publish, or create store builds unless the owner asks.
