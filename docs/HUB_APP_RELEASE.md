# AUZslab hub app: Android, iOS, Windows, Mac

One web codebase (`app.auzslab.in/start.html` plus the marketing site on `auzslab.in`), wrapped three ways. Nothing here was run on a real device by the builder: the owner must test each build.

## Rules that protect store approval
- iOS hub has NO in-app buying (Apple 3.1.1). `appshell.js` hides every add-to-cart button and shows "Finish on our website". Buying happens in the browser.
- Google sign-in never runs inside the app web view (Google blocks it). The button opens the system browser, which returns to `auzslab://signin#auz_gt=...`.
- Sign in with Apple is REQUIRED on iOS while Google sign-in is offered (4.8). Not built yet: needs Apple credentials.
- Guideline 4.2 (wrapped website): send TestFlight first, add native features (push, biometrics, camera) before App Store review. Give the reviewer `demo@auzslab.in` / `Auzslab@Demo`. Account deletion is at Account page (exists).

## Android
Workflow `android.yml` (app = hub). Intent filter for `auzslab://signin` is added by `mobile/build.mjs` for the hub only. See `docs/ANDROID_RELEASE.md` for signing secrets.

## iOS
Workflow `ios.yml` (macOS runner) runs `mobile/build-ios.mjs`. Secrets for a signed build: Apple Developer account, `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` (App Store Connect API key) and signing certificate/profile. Without them it builds an unsigned simulator check only. Untested.

## Windows and Mac
Workflow `desktop.yml` builds with electron-builder (`desktop/`). Unsigned unless certificate secrets exist (Windows `WIN_CSC_LINK`/`WIN_CSC_KEY_PASSWORD`; Mac `MAC_CSC_LINK`/`MAC_CSC_KEY_PASSWORD` plus Apple notarisation ids). Unsigned builds show a security warning.

## Owner list
Apple Developer account, Google Play account, signing certificates, Firebase file for push, Sign in with Apple credentials, a real 1024px icon.
