# Deep End

Questions for two. Pick who you're with, then slide to choose how deep you go.

One set of files, three ways to play:

| | How | Updates |
|---|---|---|
| **Website / installable app** | GitHub Pages serves `docs/` | Push to GitHub. Phones get an "Update" prompt within a minute or two |
| **iPhone (App Store)** | Capacitor wraps `docs/`, built in the cloud by Codemagic | New build → TestFlight → review |
| **Android (Google Play)** | Same, via Codemagic | New build → Play Console |

Play-test with the website. Go to the stores once it feels right. See **[STORE-CHECKLIST.md](STORE-CHECKLIST.md)**.

## What's where

| Path | What it is |
|---|---|
| `docs/questions.js` | **The game.** Every question and relationship type. Add new questions at the END of a list. |
| `docs/version.js` | Version number + "What's new" notes players see. Change it with `tools/release.py`. |
| `docs/index.html`, `styles.css`, `app.js` | The app. |
| `docs/sw.js` | Offline copy and update handling for the website. |
| `docs/privacy.html`, `support.html` | Privacy policy and help pages. Both stores require them. |
| `tools/release.py` | Cut a release. |
| `docs/inner-depth.html`, `api/inner-depth/`, `server/inner-depth/` | Inner Depth guided reflection and its optional AI organizer (OpenRouter, adults only, separate consent). Setup in [INNER-DEPTH-SETUP.md](INNER-DEPTH-SETUP.md). |
| `tools/make_icons.py` | Redraw icons (`--store` also redraws the 1024 icon and splash in `assets/`). |
| `capacitor.config.json`, `package.json`, `codemagic.yaml` | Store builds. |

## First upload to GitHub

1. On github.com, click **New repository**. Name it `deep-end`, make it **Public**, and **don't** add a README (this folder already has one).
2. In this folder, run:
   ```bash
   git remote add origin https://github.com/<your-username>/deep-end.git
   git push -u origin main
   ```
   A browser window asks you to sign in to GitHub the first time.
3. On the repo, open **Settings → Pages**. Under **Build and deployment** pick *Deploy from a branch*, then branch **main** and folder **/docs**. Save.
4. After about a minute: `https://<your-username>.github.io/deep-end/`. Send that link to friends.

## Friends: install it

- **iPhone:** open the link in **Safari** → Share → **Add to Home Screen**.
- **Android:** open in Chrome → **Install** (or ⋮ → *Install app*).

## Change something and ship it

```bash
python -m http.server 8123 -d docs      # try it at http://localhost:8123
python tools/release.py 2.0.1 "What changed, in plain words"
git add -A
git commit -m "2.0.1: what changed"
git push
```

Always run `release.py`: installed copies only notice an update when the version changes.

## Playtest feedback

While playing, friends tap **Note** on a question. **Menu → Send feedback** opens their share sheet with
everything written up, so they can text or email it to you. Nothing leaves a phone any other way.
