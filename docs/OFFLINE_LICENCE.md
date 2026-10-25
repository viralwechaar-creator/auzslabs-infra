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

## Windows installer (desktop-style/, db/268, workflow "AUZsStyle for Windows")
- Two setup files from the same code (workflow matrix):
  - **Modern** `AUZsStyle-Setup-x.y.z.exe` (Electron 33, Node 20, PostgreSQL 16): Windows 10 / 11, 64-bit.
  - **Compatible** `AUZsStyle-Setup-Compatible-x.y.z.exe` (Electron 22, Node 16, PostgreSQL 12, Visual C++ 2019 runtime): **Windows 7 SP1, 8, 8.1, 10, 11, 64-bit**. Same features. The server runs on Node 16 with a few
    packages swapped for older versions (`COMPAT=1` in `tools/stage.mjs`) and `lib/compat-preload.cjs` adds the web functions old Node lacks. Verified here by running the whole desktop suite on real Node 16.20 +
    PostgreSQL 12.20 (7/7); Electron 22 itself, the Windows 7 operating system and the Visual C++ runtime on Windows 7 are NOT verified.
  - Both need a **64-bit** Windows. A 32-bit Windows is not covered (no 32-bit PostgreSQL build is used). Windows 7 needs Service Pack 1 and the Windows updates that bring the Universal C Runtime (KB2999226).
  - Computer size: works from 2 GB RAM (database memory is tuned small automatically); about 1 GB free disk for the program, more for data; an SSD makes the first setup much faster.
  - Not covered at all: 32-bit Windows, Windows Vista/XP, macOS, Linux.
- First start: makes the database cluster in `%APPDATA%\AUZsStyle\pgdata` (own port 54329, small memory settings, passwords made once and kept in `secrets.json`), builds the tables from
  `db/*.sql` (1-3 minutes, progress shown), removes AUZslab's sample businesses, starts the local server on a fixed address (`127.0.0.1:38417`, kept in `settings.json`; the browser part keeps its waiting
  changes under that address) and opens the app. App screens: Activate (licence code) -> Set up your shop (`offline_first_run`, only while the database holds no business) -> sign in.
- After an update the app applies only the new migrations (`schema_migrations`). Quit stops the server and the database cleanly.
- **Shop menu:** Back up to a pen drive or folder (a folder with `db.dump` + `uploads/` + `about.json`), Restore from a backup (replaces everything, asks first), Open the data folder, Licence.
  Camera is allowed for tag scanning; WhatsApp bill links open in the browser.
- `desktop-style/lib/setup.cjs` is plain Node (cluster, migrate, backup, restore) and is tested with real PostgreSQL by `node tests/run-local.mjs desktop` (7 checks incl. the app in a real browser and a backup/restore round trip).
- **Build:** repository variable `LICENCE_PUBLIC_KEY` (public key from `tools/licence-keygen.mjs`), then Actions -> "AUZsStyle for Windows" -> Run workflow; the installer appears on the release page `desktop-style-latest`.
  The installer is not code-signed, so Windows SmartScreen shows "unknown publisher" (More info -> Run anyway) until a code-signing certificate is bought.
- **Not verified:** the Electron window, the NSIS installer and the Windows PostgreSQL binaries have never been run (no Windows here): the first GitHub build and the first install on a real PC are the true tests.

## Not built yet (in order)
1. Windows 7 build (see above).
2. **Cloud storage extra:** a sync between the computer and the cloud when the extra is paid for and the computer is online (two-way; the offline queue already makes changes idempotent).
3. **WhatsApp automation and online store hosting extras:** need the cloud, so they are enabled by the extra flags in the licence and work only while connected.
4. Auto-update of the installed app, code signing, an uninstaller option that also removes the data.
5. Licence weaknesses to accept or fix later: a technical person could edit the installed files to skip the check; codes are not tied to one computer (add a computer id to the code if sharing becomes a problem).
