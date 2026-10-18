# iOS release: how to get a signed build onto a real iPhone and into the App Store (owner steps)

This is the Apple equivalent of `docs/ANDROID_RELEASE.md`. Read that one first if you haven't: the shape is the
same (a cloud build makes an unsigned check for free; a signed, store-ready build needs secrets only you can
create). **Apple's process is genuinely longer and needs real money and a Mac at least once** — this file says so
plainly rather than making it sound as quick as Android's.

Today this only builds **one app: the AUZslab hub** (`in.auzslab.app`, `app.auzslab.in/start.html` in a native
shell). The hub opens AUZsPOS (and every other app) inside itself, so AUZsPOS is already reachable on iPhone
through the hub without any of this — the "Building a second app" section at the bottom covers what it would
take to ship AUZsPOS as its *own*, separate iPhone listing later, if you ever want that.

## What you need, roughly in order
1. **An Apple Developer Program account** — apple.com/developer, your own Apple ID, **$99/year**, paid by you. This
   is a real account check (identity/company verification), it can take a day or more, and nobody else can do this
   step for you — it is tied to your own identity or your registered company.
2. **A Mac with Xcode**, at least once, to generate the distribution certificate below (Apple does not let you
   create one without a Mac; a borrowed Mac or a friend's machine is fine, you only need it once — after that, the
   certificate file itself works forever from anywhere, including this project's GitHub Actions runner).
3. **Four GitHub repository secrets** for signing, plus optionally three more for an automatic TestFlight upload.

## 1. Make the distribution certificate and provisioning profile (on the Mac, once)
- Open **Xcode → Settings → Accounts**, sign in with your Apple ID, select your team.
- **Xcode → Settings → Accounts → Manage Certificates → + → Apple Distribution.** This creates your distribution
  certificate (the thing that proves "this build really is from you"). Right-click it in Keychain Access, **Export**
  as a `.p12` file, and set a password when asked — remember that password, it is `IOS_CERT_PASSWORD` below.
- On **developer.apple.com → Certificates, Identifiers & Profiles**:
  - **Identifiers → App IDs → +**: register `in.auzslab.app` (Explicit, no extra capabilities needed for the hub).
  - **Profiles → +**: "App Store Connect" distribution profile, pick the `in.auzslab.app` identifier and your
    distribution certificate, name it something you'll recognise (e.g. `AUZslab Hub Distribution`) — that exact
    name is `IOS_PROFILE_NAME` below. Download the `.mobileprovision` file.
- You now have two files: the `.p12` certificate and the `.mobileprovision` profile. Keep both somewhere safe
  (password manager / offline backup) the same way `docs/ANDROID_RELEASE.md` says to keep the Android keystore —
  if you ever lose the certificate you have to redo this step and every device needs the app reinstalled.

## 2. Turn the two files into GitHub secrets
GitHub → this repo → Settings → Secrets and variables → Actions → New repository secret, exactly these names:
- `IOS_CERT_P12_B64`: the `.p12` file turned into text. Mac/Linux: `base64 -i cert.p12 | pbcopy` (or `-w0` on
  Linux); paste the result.
- `IOS_CERT_PASSWORD`: the password you set when exporting the `.p12`.
- `IOS_PROFILE_B64`: the `.mobileprovision` file turned into text the same way (`base64 -i profile.mobileprovision`).
- `IOS_TEAM_ID`: your 10-character Apple Developer Team ID (developer.apple.com → Membership details).
- `IOS_PROFILE_NAME`: the exact name you gave the provisioning profile in step 1 (not the filename — the name you
  typed when creating it).

With just these five, **GitHub → Actions → "iOS build (iPhone + iPad)" → Run workflow** produces a real,
signed `AUZslab.ipa` you can download from the run's artifacts and install on a registered test device (Xcode →
Window → Devices and Simulators, or a tool like Apple Configurator) — still short of the App Store, but a real
device can finally run it.

## 3. Optional: let the workflow upload straight to TestFlight
Without this, you upload the `.ipa` to App Store Connect by hand (Transporter app, or Xcode's own Organizer). With
it, a successful signed build goes to TestFlight automatically.
- developer.apple.com (or appstoreconnect.apple.com) → **Users and Access → Integrations → App Store Connect API**
  → **+** → give it the **App Manager** role → download the `.p8` key file **once** (Apple only lets you download
  it the first time — if you lose it you must generate a new one).
- Secrets:
  - `ASC_KEY_P8_B64`: the `.p8` file as base64 (same `base64 -i` trick as above).
  - `ASC_KEY_ID`: the Key ID shown next to the key you just made.
  - `ASC_ISSUER_ID`: the Issuer ID shown at the top of that same Integrations page (one value, shared by every key).

## 4. Submit for App Store review (manual, every time — not automated here)
- App Store Connect → **My Apps → +** → create the AUZslab app listing (bundle id `in.auzslab.app`), fill in the
  screenshots/description (see `docs/STORE_LISTING.md` for the wording already written for the combined app),
  attach the TestFlight build, answer App Privacy, and submit.
- **Give the reviewer a working login**: `demo@auzslab.in` / `Auzslab@Demo` (see `docs/STORE_LISTING.md`).
- **Guideline 4.2 ("minimum functionality" / wrapped website) is the real risk for a webview-wrapped app.** Before
  submitting: send the build to TestFlight first and actually use it on a real iPhone; the project's own native
  touches (push registration, camera for scanning, Face ID unlock, Bluetooth printing) are what answer this
  guideline — the more of them are actually turned on and used, the stronger the submission. `docs/HUB_APP_RELEASE.md`
  has the exact rules this project already follows for this (no buying inside the iOS app — Apple 3.1.1 — and
  "Sign in with Apple" being required once Google sign-in is offered — Apple 4.8, not yet built).
- **Account deletion**: Apple requires a working one. It already exists (`auzslab.in/account.html` → Delete
  account) — point the reviewer at it if asked.

## Building a second app (e.g. AUZsPOS on its own)
`mobile/build-ios.mjs` already reads from `mobile/apps.json` generically (`node build-ios.mjs pos` builds a real
Xcode project for AUZsPOS right now, with its own bundle id `in.auzslab.pos`) and `.github/workflows/ios.yml`'s
`app: all` already runs an **unsigned simulator build** for both `hub` and `pos` — so you can already confirm the
AUZsPOS iOS project compiles with zero extra setup.

What it does **not** have yet is a **second signing identity**: Apple ties every provisioning profile to one App
ID, so `in.auzslab.pos` needs its own App ID and its own "App Store Connect" distribution profile (repeat step 1's
bullet points above for `in.auzslab.pos`, naming the profile something different, e.g. `AUZsPOS Distribution`) — a
single `.p12` certificate can sign both apps, but the profile cannot be shared across two bundle ids for an App
Store build. Once you have that second profile, the workflow needs two small, mechanical additions (not done here
because they cannot be tested without that profile existing): a second set of secrets (or reuse the existing
`IOS_CERT_*` ones and add `IOS_PROFILE_B64_POS`/`IOS_PROFILE_NAME_POS`), and the `exportOptions.plist` in
`ios.yml`'s "Archive and export" step needs a `provisioningProfiles` entry keyed `in.auzslab.pos` alongside the
existing `in.auzslab.app` one, selected per matrix app. Ask for this once you actually have the second profile —
it's a short, low-risk change once there's something real to point it at.

## What is genuinely unverified here
Nothing in this file has been run against a real Apple Developer account, a real Mac, or a real iPhone from this
build sandbox — there is no macOS machine, no Xcode and no Apple account access available here. The **first real
GitHub Actions run of this workflow (even the free, unsigned simulator build)** is the first actual confirmation
that `mobile/build-ios.mjs`'s generated Xcode project is correct. Everything above describing Apple's own console
screens is written from Apple's current, published developer documentation, not from having clicked through it
during this session.
