# AUZsPOS wrapper app: launch checklist (what's done, what's unverified, what's only yours to do)

Scope of this pass: harden the existing Capacitor wrapper (`mobile/`) for AUZsPOS specifically, per the owner's
decision to ship the real website inside a native shell rather than finish the separate Flutter rewrite
(`native/auzspos/`), which was **not touched** in this pass. Read the "important context" note at the bottom
first — the repository has since also grown a full, separately-maintained native Flutter AUZsPOS app, which this
checklist does not cover and does not change.

## 1. What was investigated and verified by reading the actual code (not guessed)

- **Firebase push, AUZsPOS wrapper: CONFIRMED real, not a false alarm.** `mobile/apps.json`'s `pos` entry has
  `id: "in.auzslab.pos"`. The project's own CLAUDE.md records the Firebase project (`auzslab-ea7c6`) as having
  exactly **six** Android apps registered: `in.auzslab.app` (the hub wrapper) and `app.auzslab.pos` /
  `app.auzslab.payroll`'s native sibling / `app.auzslab.mob` / `app.auzslab.scan` / `app.auzslab.ledger` (the five
  **native Flutter** apps). **`in.auzslab.pos` — the Capacitor wrapper's own package id — is not among them.**
  `mobile/build.mjs` writes `google-services.json` only when the file contains the building app's own package
  name (confirmed by reading the code: `gs.includes('"package_name": "'+A.id+'"')`), and otherwise logs
  `push skipped: ... is not in the Firebase file` and builds without push, silently, with no build failure. So
  **the AUZsPOS wrapper app builds and runs fine today, it just never shows an order-alert notification while
  backgrounded** — this is the same gap the project's own CLAUDE.md already flags, confirmed here by reading the
  actual `apps.json`/`build.mjs` code rather than taking the doc's word for it. **This needs a seventh Firebase
  Android app registration (package name `in.auzslab.pos`) in the owner's Firebase console — I have no access to
  create it.** Once added, re-download `google-services.json`, re-base64 it into the `GOOGLE_SERVICES_JSON`
  GitHub secret (already documented in `docs/ANDROID_RELEASE.md` step 5), and the very next Android build picks it
  up automatically — no code change needed on the AUZsPOS side.

- **QR scanning: the premise in the original brief was wrong, corrected rather than "fixed."** I checked every
  file in `app/public/pos/` for `getUserMedia`/`BarcodeDetector`/a camera scanner library. **AUZsPOS has no
  staff-side, camera-based QR-scanning feature at all** — `pos/sell.js`'s only "scan" code is for a plain
  USB/Bluetooth *hardware* barcode scanner that types the code and presses Enter (a keyboard-emulating device, no
  camera, no permission needed). The actual "QR" mechanism for AUZsPOS is entirely on the **customer's** side: a
  table's printed QR code opens `site.html?t=<id>` **in the guest's own phone's own camera/QR app**, which is a
  separate, ordinary browser page outside the staff wrapper entirely; that guest's order then shows up to staff as
  a plain banner in `pos/shell.js` (no camera involved on the staff side, ever). This flow is unaffected by the
  wrapper's `allowNavigation` (it never touches the wrapped app's webview at all) and needs no fix. The camera-based
  scanner module that *does* exist in this codebase (`ds/scanner.js`, `getUserMedia`/`BarcodeDetector`/ZXing) is
  used only by AUZsLedger/AUZsScan ("Scan to bill") and is not loaded by `index.html` (AUZsPOS) at all — confirmed
  by grep. **Nothing was broken here and nothing needed to change.**

- **Admin console navigation: already correct, confirmed by reading the code.** `pos/staff.js`'s "Admin console"
  row is `onclick: () => (location.href = '/dashboard.html')` — a same-window, same-origin navigation, not an
  `<a target="_blank">` and not `window.open`. It cannot hit the iOS stuck-blank-tab bug CLAUDE.md documents
  elsewhere (that bug is specifically about `target="_blank"` inside an iOS **standalone home-screen web app**,
  Apple's own WebKit limitation — this is a plain in-place navigation, a different mechanism entirely, and inside
  the real Capacitor native wrapper the whole question of standalone-PWA tab behaviour doesn't even apply). Same
  origin also means `capacitor.config.json`'s `allowNavigation: ['auzslab.in','*.auzslab.in']` is not even the
  thing making this work — a Capacitor webview navigates freely within the origin it already started on; the
  allow-list only matters for navigating to a *different* host than the one the app launched with. **No code
  change needed.** The one `target="_blank"` link left in the POS (`pos/staff.js`'s "Powered by AUZslab" footer
  credit, opens the public marketing site) is low-risk and out of scope — it's not the admin-console link the
  brief asked about, and leaving an external credit link to open outside the app is reasonable behaviour, not a
  bug.

- **Bluetooth receipt printing: Web Bluetooth does NOT work inside the Capacitor wrapper — confirmed, not assumed,
  and `ds/escpos.js`'s own pre-existing code comment already said as much before I touched it.** Android's system
  WebView (what every Capacitor app renders with, including this one) has never implemented `navigator.bluetooth`,
  `navigator.usb` or `navigator.serial`, even though it is Chromium-based and the standalone Chrome browser on the
  same phone does support them — this is a long-standing, documented WebView limitation, not a Capacitor
  shortcoming and not something `allowNavigation` or any webview setting can work around. Apple's WebKit has never
  implemented Web Bluetooth on any platform at all, app or browser. So a real plugin was genuinely needed, and I
  added one (minimal, additive, falls back to the existing Web Bluetooth path unchanged everywhere else):
  - `@capacitor-community/bluetooth-le` added to `mobile/package.json`.
  - `app/public/ds/escpos.js`: a new native BLE transport (`nativeBleTransport`/`pairNativeBle`), detected through
    `window.Capacitor.Plugins.BluetoothLe` — the same bridging pattern `ds/nativepush.js` already uses for push, no
    bundler, no build step. `auzPrinter.supported().bluetooth` now also reports `true` inside the packaged app;
    `pair('bluetooth')` branches to the native plugin when running inside the app, to Web Bluetooth otherwise. The
    print/reconnect/forget code paths needed no change — they already operate generically on whatever transport
    object `pair()` returns.
  - `mobile/build.mjs`: declares the two legacy `BLUETOOTH`/`BLUETOOTH_ADMIN` manifest permissions for API ≤ 30
    (the plugin's own `cap add android` step already merges `BLUETOOTH_SCAN`/`BLUETOOTH_CONNECT` for API 31+, and
    `ACCESS_FINE_LOCATION`, needed for BLE scanning on older Android, was already declared for every app).
  - `mobile/build-ios.mjs`: added `NSBluetoothAlwaysUsageDescription` (iOS refuses to let an app ask for Bluetooth
    permission at all without this string).
  - `app/public/pos/print.js`: corrected one now-stale user-facing sentence that said Bluetooth "does not work" in
    the packaged Android app.
  - Bumped `ds/escpos.js` to `?v=3` in `index.html` and `sw.js`'s precache list + service-worker version
    (`pos-v110`), per this project's own "bump `?v=` and `sw.js`'s `V`" rule.

- **`docs/STORE_LISTING.md`**: read in full. It already covers AUZsPOS adequately (single-app name, description,
  reviewer login, data-safety answers) under the documented "launch the combined hub app first" plan. Nothing was
  missing specific to AUZsPOS, so nothing was changed here — rewriting something that already works would just be
  churn.

## 2. What was completed but could NOT be verified (no SDK, emulator, device or Apple account in this sandbox)

- The Bluetooth printing plugin bridge above: there is no Android SDK, emulator or real Bluetooth printer in this
  sandbox, so this was written against the plugin's own documented API (`BleClient.initialize/requestDevice/
  connect/getServices/write`), not run. The real first test is a real Android build (the "Android build" GitHub
  Action) installed on a real phone, paired with a real thermal printer. If the plugin's actual method names or
  argument shapes differ from what I wrote (plugin versions do change these occasionally), the fix is confined to
  `nativeBleTransport`/`findWriteChar`/`pairNativeBle` in `ds/escpos.js` — nothing else depends on its internals.
- The `ios.yml` change (adding an unsigned `pos` simulator-build matrix entry alongside the existing `hub` one):
  YAML-validated and reasoned through, but there is no macOS runner available here — the first real GitHub Actions
  run is the first actual proof the generated Xcode project for `pos` compiles.
- `mobile/build.mjs`'s new Bluetooth manifest-permission block: written by pattern-matching the existing,
  already-working `CAMERA`/`ACCESS_FINE_LOCATION` blocks in the same file, not run (no Android SDK here either).

## 3. What is only the owner's to do, in order

(a) **Decide on a Google Play Developer account** — personal (needs 12+ testers for 14 days before production) or
    organisation (needs a D-U-N-S number; CLAUDE.md's "Play Store launch notes" section has the exact current
    guidance and the owner's open decision on this). I cannot create or choose this account.
(b) **Enrol in the Apple Developer Program** ($99/year, the owner's own Apple ID or company) — see
    `docs/IOS_RELEASE.md` step 1. I have no Apple account access and cannot do this.
(c) **Generate the Android signing key** (`docs/ANDROID_RELEASE.md` step 1) and add the four
    `ANDROID_KEYSTORE_B64`/`ANDROID_KEYSTORE_PASSWORD`/`ANDROID_KEY_ALIAS`/`ANDROID_KEY_PASSWORD` secrets.
(d) **Generate the iOS distribution certificate and provisioning profile** (needs a Mac with Xcode, once —
    `docs/IOS_RELEASE.md` step 1) and add the `IOS_CERT_P12_B64`/`IOS_CERT_PASSWORD`/`IOS_PROFILE_B64`/
    `IOS_TEAM_ID`/`IOS_PROFILE_NAME` secrets (and optionally the three `ASC_*` ones for automatic TestFlight
    upload).
(e) **Add all the GitHub secrets above** (Settings → Secrets and variables → Actions) — none of them exist in this
    sandbox and none can be created without the owner's own accounts.
(f) **Register `in.auzslab.pos` as a seventh Android app in the Firebase console** (project `auzslab-ea7c6`), then
    re-download `google-services.json` and update the `GOOGLE_SERVICES_JSON` secret — this is the one concrete,
    confirmed fix from section 1 above that only the owner can make, since I have no Firebase console access.
(g) **Run both CI workflows** ("Android build" with `app=pos` or `all`; "iOS build (iPhone + iPad)" with
    `app=pos` or `all`) from the Actions tab and download the resulting `.apk`/`.aab`/`.ipa` artifacts.
(h) **Install the resulting build on a real Android phone and a real iPhone and confirm it genuinely works** —
    specifically: QR guest ordering (place a real order from a second phone and confirm the banner appears),
    opening the Admin console from Staff & settings, and — once (f) is done — a real push notification arriving
    while the app is backgrounded; and the new Bluetooth printer pairing with a real ESC/POS thermal printer. None
    of this has been confirmed on a real device from this sandbox, the same honesty bar every other native-app
    note in this project already holds itself to.
(i) **Complete the actual Play Store / App Store listing submission** — `docs/STORE_LISTING.md` has the Play
    text ready to paste; `docs/IOS_RELEASE.md` step 4 has the App Store steps. I cannot submit either listing
    myself (no account access).

## Important context the owner should know about before acting on this

This repository's `CLAUDE.md` (the project's own living brief) shows that, **after** the decision to build the
Capacitor wrapper instead of finishing the Flutter rewrite, a large amount of work was **also** done building a
full, separate, native Flutter AUZsPOS app (`native/auzspos/`) — plus four more native Flutter apps (AUZsMob,
AUZsPay, AUZsLedger, AUZsScan) and a native Flutter hub app now in progress (`native/auzshub/`), each with its own
GitHub Actions release pipeline and, per the native POS app's own round 10 notes, its **own, working Bluetooth
thermal-printing plugin already wired in**. This directly contradicts the "the owner chose the wrapper, not the
native rewrite" framing this task was given — both paths have in fact been invested in, apparently across
different sessions that did not have each other's full context. I did not touch `native/` in this pass (explicitly
out of scope for this mission) and have not tried to reconcile the two strategies — that is a real decision only
the owner can make: continue hardening the one-codebase wrapper (what this document covers), ship the native
apps that already exist, or some mix (e.g. the wrapper as the "hub," native apps as the per-product store
listings). Whoever picks this up next should read CLAUDE.md's "Play Store launch notes" and "Native apps:
gaps closed" sections before doing more work in either direction, so effort isn't spent twice on the same goal.
