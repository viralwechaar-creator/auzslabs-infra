# AUZsStyle offline for Windows 7 (one PC, pen-drive zip) - plan

Client: 12-year-old PC, Windows 7 Ultimate, ethernet only, cannot install from the web. One computer only (owner decision).

## Why this is not just "zip the website"
AUZsStyle keeps all its rules in Postgres (`sty_*` functions, db/214-259) and the Node API. Offline needs the same engine on the PC.

## Architecture (chosen)
One folder from the pen drive, no installer needed (a Setup.exe wrapper can come later):
- **Electron 22.3.x (32-bit and 64-bit builds)** - last Electron that runs on Windows 7. Window shows `style.html`; it also runs the API in-process (Electron 22 ships Node 16, so the current server code runs unchanged).
- **PostgreSQL 12 portable** (last version supporting Windows 7), started/stopped by the app, data folder `Data\` next to the program. Migrations 000-259 must be proven on PG 12 first (792 uses of `gen_random_uuid()` need `pgcrypto` on PG 12; only 5 other special cases found).
- Switched-off online-only parts: sign-in by Google, WhatsApp, Razorpay, push, mail, online store. Login = owner email + password stored locally (first-run screen creates the shop and owner).
- Backup button: copies the database dump to the pen drive; Restore reads it back. Update = new zip, data folder untouched.

## Phases
1. Prove db/000-259 + `sty_*` on PG 12 (scratch DB). Fix any incompatibility with new idempotent migrations.
2. "Offline mode" switch in the server (no outside calls, local first-run, local licence flag `style` on).
3. Electron shell + launcher + PG start/stop + backup/restore to pen drive.
4. GitHub Actions workflow that assembles the zip (downloads Electron 22, PG 12 Windows binaries, Node deps for win32 ia32/x64, `sharp` replaced by a pure-JS fallback because sharp 0.34 does not support Win7). Build cannot run in the sandbox (PG download blocked here), so CI makes the zip.
5. Test on a real Windows 7 PC (or VM) - nothing here can be tested on Windows 7 from this sandbox.

## Phase 1 result (done)
All 260 migrations (db/000-259, minus the 4 Mannat one-offs) now apply cleanly on a real **PostgreSQL 12.20** (pgcrypto present). 12 files failed only because PG 12 requires `AS` before output-column aliases such as `ref`, `cost`, `mode`, `name`, `at`, `views`; `as` was added (alias-only, same meaning on PG 16). Rule for new migrations: always write `as` before a column alias. Test PG 12 binaries came from Maven (`io.zonky.test.postgres:embedded-postgres-binaries-linux-amd64:12.20.0`); the same project publishes Windows binaries to try on the client PC. Not yet run: the API and the style suite against PG 12, and PG 12 on a real Windows 7 machine.

## Client PC (from the owner)
Windows 7 Ultimate 64-bit, Intel Pentium E5700 (2 cores), 2 GB RAM, USB 2.0 only, ethernet only. Build 64-bit only. 2 GB is tight for Electron + PostgreSQL: ask the client to upgrade to 4 GB (and an SSD).

## Open risks (say plainly to the client)
- 32- vs 64-bit Windows 7 must be checked (Control Panel > System); we ship both.
- Windows 7 needs Service Pack 1 and the Visual C++ 2015-2019 runtime (include the redistributable on the drive).
- Thermal/tag printers: Windows driver printing only.
- Old PC with little RAM: PG 12 + Electron needs about 2 GB free.
