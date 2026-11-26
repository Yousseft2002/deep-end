# Getting Deep End into the App Store and Google Play

Researched September 2026. Store rules change, so check the linked sources before you submit.

## 0. Before anything (10 minutes)

- [x] Replace `[YOUR CONTACT EMAIL]` in `docs/privacy.html` and `docs/support.html`. Both stores show
      a contact address publicly. A separate address such as `deepend.app@…` is worth considering.
- [ ] Confirm the app ID `io.github.yousseft2002.deepend` in `capacitor.config.json` and `codemagic.yaml`.
      It **can never change** after the first store upload. It matches the GitHub username `Yousseft2002`.
- [ ] Web version live on GitHub Pages (see README). The stores need these public URLs:
  - Privacy policy: `https://yousseft2002.github.io/deep-end/privacy.html`
  - Support: `https://yousseft2002.github.io/deep-end/support.html`
- [x] Fonts are built in (`docs/fonts/`, SIL Open Font License, with license files alongside). The app makes
      no network requests while you play.

## 1. Accounts and costs

| | Cost | Notes |
|---|---|---|
| Apple Developer Program | $99 / year | Enrolling as an individual shows your legal name as the seller. Approval can take a day or two. |
| Google Play Console | $25 once | Identity verification required. |
| Codemagic | Free tier | Builds the iPhone app on their Macs, so you don't need one. 500 free build minutes a month. |

## 2. The big Apple risk: guideline 4.2 "Minimum Functionality"

Apple rejects apps that are "not sufficiently different from a mobile web browsing experience".
What's already in place against that:

- **Fully offline.** The store build carries every file inside the app. It is not a web page loaded from a server.
- **Native haptics** on the depth slider, turn changes and saves (`@capacitor/haptics`).
- **Native share sheet** for sharing saved questions and sending feedback (`@capacitor/share`).
- **Android back button** closes sheets and returns to the start screen instead of quitting mid-game (`@capacitor/app`).
- A focused, app-like interface with no browser chrome and no external links in normal play.

Paste this into **App Review Information → Notes**:

> Deep End is an offline conversation game for two people sharing one phone. Choose who you're with,
> then drag the life-ring depth slider to pick how personal the questions get (five depths). The slider
> and turn changes use haptic feedback; saved questions and playtest feedback use the native share sheet.
> No account, no network access needed. All data stays on the device.

If it's rejected anyway, the usual fix is one more native feature. The natural one for Deep End is a
**daily "question of the day" local notification** (`@capacitor/local-notifications`). Ask Claude to add it.

## 3. App Store Connect listing

- [ ] **Name:** "Deep End" may already be taken. Have a backup such as *Deep End: Questions for Two*. Subtitle up to 30 characters, e.g. *Conversations that go deeper*.
- [ ] **Category:** Lifestyle (primary), Games → Card or Family (secondary).
- [ ] **Privacy "nutrition label":** *Data Not Collected*, **only while the in-app feedback button is off** (the widget stays hidden until `docs/index.html` has a real endpoint and key). Once it is on, the app sends optional feedback text and device info to your server: declare it (e.g. "Other User Content" / "Diagnostics", not linked to tracking) and re-read the privacy policy.
- [ ] **Age rating questionnaire:** answer honestly. Some questions cover romance, relationships and past hurts, but nothing sexual, violent or drug-related. Expect a teen-level rating.
- [ ] **Screenshots:** at least one 6.9" iPhone shot (1320 × 2868; 1290 × 2796 is also accepted). Apple scales it for smaller phones. A screenshot taken on an iPhone Pro Max is already the right size. Good ones: home, the slider at Shallows, the slider at The deep end, the pass-the-phone screen.
- [ ] **iPad:** the build is iPhone-only and portrait by default. If Apple asks, choose iPhone only, or you'll owe iPad screenshots.
- [ ] **Export compliance:** handled. The build declares no non-exempt encryption.
- [ ] **Icon:** `assets/icon-only.png`, 1024 × 1024 with no transparency (Apple rejects alpha).

## 4. Google Play specifics

- [ ] **The 12-tester rule:** personal Play accounts created after 13 Nov 2023 must run a **closed test with at
      least 12 testers who stay opted in for 14 days in a row** before the app can go public. Testers must accept
      the invite and install it with their Google account. **Your playtest friends on Android are these testers.**
      Start this early; the clock is the slow part.
- [ ] **Data safety form:** no data collected, no data shared **only while the feedback button is off**. With it on, declare optional user-provided feedback (and device info) as collected, not shared.
- [ ] **Content rating (IARC questionnaire):** answer as for Apple.
- [ ] **Target audience:** 13+ (not directed at children, which matches the privacy policy).
- [ ] **Graphics:** 512 × 512 icon (`docs/icons/icon-512.png`), a 1024 × 500 feature graphic (still to make), and 2–8 phone screenshots.

## 5. Building the store apps (no Mac needed)

1. Push this repo to GitHub, sign up at codemagic.io with GitHub, and add the `deep-end` repo. It finds `codemagic.yaml`.
2. **iOS:** in App Store Connect → Users and Access → Integrations, create an **App Store Connect API key**
   (App Manager role). Add it in Codemagic → Team integrations, named `Deep End API key`. Enable automatic
   code signing for bundle ID `io.github.yousseft2002.deepend`. Create the app record in App Store Connect first.
3. **Android:** in Codemagic → Code signing identities, **generate** an upload keystore with reference
   `deep_end_upload_key`, and **download a backup of it**: losing it means you can't update the app. Create a Google
   Cloud service account with Play Console access and put its JSON in an environment group `google_play` as
   `GCLOUD_SERVICE_ACCOUNT_CREDENTIALS`. The **first** upload to Play must be done by hand: download the `.aab`
   from the Codemagic build and upload it in Play Console.
4. Run **iOS → TestFlight**. Friends on iPhone can then test the real store build through TestFlight
   (up to 10,000 testers, no review for internal testers).

`codemagic.yaml` follows Codemagic's documented Capacitor setup but **has not been run yet**. Expect to read
the first build log and fix small things.

## 6. How updates work once you're in the stores

- **Website:** push to GitHub. Players get it within minutes.
- **Store apps:** each change needs a new build and store review (usually about a day on Apple, hours to days on Google).
  So keep playtesting on the website and batch changes into store releases.

## Sources

- Apple App Review Guidelines (4.2 Minimum Functionality, 5.1.1 Privacy): https://developer.apple.com/app-store/review/guidelines/
- Google Play testing requirement for new personal accounts: https://support.google.com/googleplay/android-developer/answer/14151465
- App Store screenshot sizes (2026): https://adapty.io/blog/app-store-screenshot-sizes-dimensions/
- Web-wrapper rejections under 4.2: https://www.mobiloud.com/blog/app-store-review-guidelines-webview-wrapper/
- Capacitor 8 (Swift Package Manager by default on iOS): https://ionic.io/blog/announcing-capacitor-8
- Codemagic Capacitor builds: https://docs.codemagic.io/yaml-quick-start/building-an-ionic-app/
