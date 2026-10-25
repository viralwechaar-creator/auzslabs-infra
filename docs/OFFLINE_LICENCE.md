# AUZsStyle offline install: licence, extras and what is built

Plan (owner, Oct 2026): AUZsStyle as a Windows install that works with no internet and keeps its data on the computer. It only opens with a licence
code from AUZslab and stops when the plan ends. Cloud storage, WhatsApp automation and online store hosting are paid extras.

## Built (db/267, server/src/licence.js, routes/licence.js)
- **Licence code** (`AUZ-XXXXX-...`, about 170 characters, no ambiguous letters): product, shop name, plan end date, extras (cloud, whatsapp, store),
  signed with Ed25519. The server holds the private key (`LICENCE_PRIVATE_KEY`); the install holds only the public key (`LICENCE_PUBLIC_KEY`), so it checks
  a code with no internet and nobody can make one.
- **Make a code:** Admin -> More -> Licences (offline app). Pick shop, end date, extras, note (payment/UTR); copy the code or send it as a WhatsApp text.
  Renewal = a new code with a later end date (an older code cannot replace a longer plan). `app_licences` keeps the record.
- **Lock:** the installed server (`AUZ_OFFLINE=1`, data folder `AUZ_DATA_DIR`) answers only `/licence/*` and `/health` until a valid code is activated; after
  the end date there are 3 days of grace, then it locks (data stays on the computer). The app shows an Activate screen and a warning 14 days before the end.
  The latest date the computer has seen is remembered, so setting the clock back does not extend a plan.
- The cloud server (no `AUZ_OFFLINE`) never locks anything.
- First-time setup on the server: `node tools/licence-keygen.mjs`, add `LICENCE_PRIVATE_KEY` to `.env`, `docker compose up -d --build api`; keep the public key for the installer.
- Test: `node tests/run-local.mjs licence` (6 checks).

## Not built yet (in order)
1. **Windows installer** (Electron shell + PostgreSQL + local server in one setup file, plan in docs/OFFLINE_WINDOWS7.md). Needs a GitHub Actions build (PostgreSQL
   Windows files cannot be downloaded from this sandbox); first real test on a Windows PC. Windows 7 needs Electron 22 and PostgreSQL 12, newer Windows can use current versions.
2. **Backup and restore to a pen drive** from inside the app.
3. **Cloud storage extra:** a sync between the computer and the cloud when the extra is paid for and the computer is online (two-way, the offline queue already makes changes idempotent).
4. **WhatsApp automation and online store hosting extras:** need the cloud, so they are enabled by the extra flags in the licence and work only while connected.
5. Licence weaknesses to accept or fix later: a technical person could edit the installed files to skip the check; codes are not tied to one computer (add a computer id to the code if sharing becomes a problem).
