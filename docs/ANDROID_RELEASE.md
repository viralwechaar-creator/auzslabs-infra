# Android release: how to get the signed app bundle (owner steps)

You need this only when you are ready to upload to Google Play. The cloud build already makes a test APK without any of this.

## 1. Make your upload key (once, on a computer with Java; keep the file and passwords safe)
```
keytool -genkeypair -v -keystore upload.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
```
Answer the questions and choose a strong password. **Back up `upload.jks` and the passwords** (password manager plus one offline copy).
If you lose it, Google can reset an upload key, but it takes days.
Never send the file or passwords in chat or email.

## 2. Put them in GitHub (Settings > Secrets and variables > Actions > New repository secret), exactly these four names
- `ANDROID_KEYSTORE_B64`: the file turned into text. On Mac/Linux: `base64 -w0 upload.jks`; on Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("upload.jks"))`
- `ANDROID_KEYSTORE_PASSWORD`: the keystore password
- `ANDROID_KEY_ALIAS`: `upload`
- `ANDROID_KEY_PASSWORD`: the key password (the same as the keystore password if you pressed Enter)

## 3. Build
GitHub > Actions > "Android build" > Run workflow > app = `all` (or one app: hub, pos, mob, payroll, accounts).
When it finishes, open the run and download each app's artifact: it holds the test `.apk` and, because the secrets exist, the signed `.aab`.

## 4. Upload to Google Play
Play Console > your app > Release > Testing (closed testing first) > Create release > upload the `.aab`. Choose "Play App Signing" when asked (recommended: Google keeps the real signing key; yours is only the upload key).

Each build gets a higher version number automatically (the run number), which Play requires for every upload.

## 5. Order alerts inside the app (optional, Firebase push)
Without this, the app builds and works fine -- it just never shows a notification for a new order while the app is in the background (Web Push, the way the website does it, does not work inside a packaged app). Full setup steps: `.env.example`'s own `FCM_PROJECT_ID`/`FCM_SERVICE_ACCOUNT_JSON`/`GOOGLE_SERVICES_JSON` section. Short version: one Firebase project, register every app's package name in it, download its one `google-services.json`, base64 it into a `GOOGLE_SERVICES_JSON` repository secret (same place as the four keys above) -- the next build picks it up automatically, no code change needed.
