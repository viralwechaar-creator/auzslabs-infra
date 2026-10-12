# AUZsPOS (native Android, Flutter)

Real Android app for the AUZsPOS till. It talks to the same server and the same records as the website POS, so both can be used together.

- Offline first: every change is saved on the phone first and sent when there is a connection (`lib/core/repo.dart`, same rules as the web `save()`/`doSync()`).
- Bill maths (`lib/core/billing.dart`) is checked against the website's own `tot()`: `node tool/make_vectors.mjs` regenerates `test/billing_vectors.json` from `app/public/pos/core.js`.
- One database file per login, so one business's data never shows in another's.
- Screens: sign in (owner/manager or staff PIN, 2-step), Sell, Orders, QR guest orders.
- Not built yet: tables map, kitchen screen, offers, manager PIN approvals, printing, push alerts, reports.

Build: GitHub Actions -> "Native AUZsPOS (Android)" -> run -> download artifact `AUZsPOS-apk`. Locally: `flutter test`.
