# AUZsHub Home-page WebView pilot (approved scope only)

This is the **first and only** approved step of a possible larger web/native consolidation for
`native/auzshub/`. Scope, per the owner's explicit approval: **the Home tab only**. Products,
Pricing, Menu, Account, Admin, Team, Cart and every other screen are untouched and still use
their existing native implementation. Nothing is published, and nothing is on by default.

## What this is

`native/auzshub/lib/ui/webmarketing.dart` adds a new widget, `WebMarketingHome`, that loads the
real, live `https://auzslab.in/index.html` inside a `webview_flutter` `WebView` instead of the
app's own native renderer (`SitePage(s, 'index')` in `lib/ui/site.dart`). A developer-only,
per-phone switch (`lib/core/webflag.dart`'s `WebPilot.homeEnabled`, persisted with
`shared_preferences`) decides which one the Home tab shows. **It defaults to `false`.**

## Why this is safe

- The Home page is **public marketing content** — no sign-in, no session, no customer data. The
  WebView is never given a session token, a cookie, or the `#auz_gt` hand-off fragment every
  other app-to-website hop in this codebase uses. There is nothing to leak.
- The website already has a mature "running inside an app" mode (`app/public/ds/appshell.js`,
  loaded site-wide via `site/theme.js`) that activates automatically the moment the WebView's
  user agent contains the string `AUZslabApp` — which `WebMarketingHome` sets. **No website file
  was changed for this pilot.**
- Navigation inside the WebView is restricted to `auzslab.in` / `*.auzslab.in` (mirroring the
  existing Capacitor wrapper's `allowNavigation` in `mobile/build.mjs`); any other address opens
  the system browser instead of loading inside the app.
- A load failure (no connection, a slow network, or — as actually observed in the automated
  test, since there is no real platform WebView inside `flutter test` — the WebView engine not
  being available at all) shows a plain retry screen with a **"Use the app's Home page instead"**
  button that flips the switch back off immediately. There is no blank or stuck screen.

## How to turn it on (test device only)

1. Open the AUZslab app, sign in or continue as a guest, go to **Home → Settings**.
2. Long-press the small "AUZslab · build N" line near the bottom of the Settings sheet. A
   **"Developer options (this phone only)"** section appears — this is deliberately hidden from
   anyone who hasn't been told to do this; there is no visible toggle for an ordinary person.
3. Switch on **"Use the live website for Home (test)"**.
4. Go back to the Home tab (tap another tab, then Home again, or just re-open the app) to see it
   take effect.

This is a per-device preference (`shared_preferences`), never a remote/server flag — nothing
anywhere can turn this on for anyone else.

## How to roll back

- **Immediately, without reinstalling**: open Settings, long-press the build line again, switch
  "Use the live website for Home (test)" back off. The native Home page returns at once.
- **Automatically**: if the WebView ever fails to load, its own fallback screen's "Use the app's
  Home page instead" button does the same thing.
- **Code-level rollback**: revert the commit. The native renderer (`lib/ui/site.dart`,
  `lib/ui/nodes.dart`, `assets/site/pages.json`) was not edited or deleted — it is exactly what
  renders whenever the flag is off, which is the shipped, default state.

## Does a live website change reach the app without a rebuild?

**Yes, for the Home tab, only while the pilot switch is on.** The WebView loads
`https://auzslab.in/index.html` fresh over the network, so any website edit (`git pull` on the
server) appears the next time that tab reloads — no app rebuild needed. This is true only for
whichever screen the pilot flag covers; every other tab still needs the extractor
(`native/auzshub/tool/extract_site.mjs`) re-run and a new build, exactly as before.

## What was actually tested, and what was not

- `flutter analyze --no-fatal-infos` and `flutter test` (`native/auzshub`) — all 45 tests pass
  (42 pre-existing + 3 new in `test/webpilot_test.dart`), zero new analyzer issues (18
  pre-existing, unrelated issues remain, same count as before this change).
- The new tests cover: the flag defaulting to off and persisting per-device; the Home tab
  rendering the native page when off (with every other tab unaffected); the Home tab rendering
  `WebMarketingHome` when on; and the fallback screen appearing and switching the flag back off
  when the WebView cannot load — which is exactly what happens in this sandbox, since
  `flutter test` has no real platform WebView.
- **Visual parity, real network loading, fonts, images, external links, backgrounding/resuming,
  and behavior on real Android screen sizes have NOT been verified** — there is no Android SDK,
  emulator, or physical device in this sandbox. The GitHub Actions build (`native-hub.yml`) and
  the owner's own test device are the first real checks, exactly as every other native-app change
  in this repository's history discloses plainly rather than implying otherwise.

## Boundaries honored

No change to: the website, the backend, the database, authentication, any other Android/iOS/
desktop app, pricing, permissions, or any screen other than the Home tab. Nothing was published
to Google Play or any app store; no released APK/AAB was touched. The flag ships off.
