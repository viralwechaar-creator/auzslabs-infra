---
name: global-fix
description: Use when the owner invokes /global-fix, or asks for a change to be applied "everywhere" / "across the whole system" / consistently across AUZslab's web site, web staff apps, native Flutter apps, Android wrapper, admin panel, team workspace, backend and database — rather than in just the one file or screen mentioned. Performs global search, identifies every affected implementation, plans, implements consistently, tests what can be tested here, and reports with explicit PASS/FAIL/NOT TESTED/BLOCKED/APPROVAL REQUIRED statuses per affected surface.
---

# /global-fix

This is the repo-specific version of the owner's standing "Global Change Engine" master prompt
(condensed in CLAUDE.md under "Global Change Engine: search everywhere, preserve everything else,
report honestly"). Read that section first if you haven't this session. This skill is the
step-by-step process for executing one concrete request against it.

Read `docs/APP_INVENTORY.md` and `docs/DESIGN_SYSTEM.md` before starting — they list every
surface this repo actually has and the design tokens each one uses, so step 2 below has a
concrete list to search rather than guessing.

## 1. Understand the request in plain terms

The owner is non-technical. Translate "fix the button on the orders page" into a concrete
target: which record `kind`/RPC/table, which screen(s), which role(s). If a decision can't be
inferred safely, ask ONE question in the owner's language (per the Clarification-first
protocol in CLAUDE.md) before writing code — don't make them specify every file.

## 2. Search every implementation, not just the one mentioned

This codebase deliberately does **not** share most UI code across apps ("no shared JS modules",
and the native apps are each separate Flutter projects) — so a feature that exists on the
website almost always has an independent copy everywhere else it also exists. Check each of
these in turn, skipping any that plainly don't apply to this request:

- **Marketing site** — `site/` (+ the deliberately-separate `site/kept/` and `site/tool/` copies,
  see `docs/SITE_MAP.md` — never merge these three).
- **Web staff apps** — `app/public/index.html`+`pos/*.js` (POS), `payroll.html`+`payroll/*.js`,
  `accounts.html`/`scan.html`+`accounts/*.js` (AUZsLedger/AUZsScan share one set of books but
  have separate nav/shells), `mob.html`+`mob/*.js`, `salon/` (Showoff-style, its own design),
  `salesman.html` (team workspace), `dashboard.html`+`console/*.js` (admin console),
  `builder.html`/`w.html` (Website Builder), `start.html`+`start.js` (the hub).
- **Admin panel** — `site/admin.html` (platform-admin only; separate from the admin console
  above, which is a tenant's own back-office).
- **Native apps** — `native/auzspos/`, `native/auzsmob/`, `native/auzsscan/`, `native/auzspay/`,
  `native/auzsledger/`, `native/auzshub/` (the hub, which also natively renders the *entire*
  marketing site from `native/auzshub/assets/site/pages.json` — a change to marketing copy/CSS
  needs the extractor re-run, see that app's CLAUDE.md entries). Each app keeps its own copy of
  `core/api.dart`, `ui/theme.dart`, `ui/i18n.dart`, login, launch — check whether this request
  touches a foundation file duplicated in all six, or a screen unique to one.
- **Android/desktop wrapper** — `mobile/` (Capacitor, WebView — reuses the live website, so most
  fixes there are just "the web fix is enough"), `desktop/` (Electron, same).
- **Backend** — `server/src/routes/` (`system.js`, `auth.js`, `payments.js`, `data.js`,
  `storage.js`, `admin.js`, `whatsapp.js`), `server/src/auth/*.js`, `server/src/salon/*.js` (see
  `docs/BACKEND_MAP.md` for the current split). A new public function must be added to
  `server/src/data/rpc-registry.js`'s `RPC` list or every call 404s — this has bitten the
  project repeatedly, check it every time.
- **Database** — `db/*.sql` migrations (grep the record `kind`, table name, or RPC name across
  all of them — a kind-allow-list, an RLS policy, or a trigger guard is often where "the same
  bug" actually lives, not the UI that surfaces it).
- **Tests** — `tests/suites/local/*.mjs` and `native/*/test/*.dart`.

Use `grep -rn` for the feature name, the record `kind` string, and the RPC name across `site/`,
`app/public/`, `native/*/lib`, `server/src/`, `db/`. Don't stop at the first match.

## 3. Identify what must NOT change

List, out loud in your working notes (not necessarily to the owner unless it's a judgment
call), anything load-bearing near the edit that the request did not ask to touch: permissions,
pricing math, an RLS policy, an append-only guard trigger, a different tenant's data. CLAUDE.md's
own session logs are full of real bugs that happened exactly because a narrow fix accidentally
widened scope (or a narrow fix silently left a parallel copy broken) — read the relevant section
of CLAUDE.md for this feature before editing if one exists.

## 4. Plan, then implement consistently

Write the change once per affected surface identified in step 2, in that surface's own idiom
(don't invent a shared abstraction across apps that were deliberately built as separate copies).
If the same fix is needed in N places, make the same fix N times rather than a partial fix in
one place and "see also" comments in the others.

## 5. Verify what can actually be verified here

- Web: `node --check` every touched `.js`/extracted-script file (see CLAUDE.md "Testing an
  `app/public/*.html` change before committing"); run the matching suite from
  `node tests/run-local.mjs <suite>` (full list in that file's `suites` array — run suites one
  at a time, they share a test database).
- SQL migrations: apply the full chain to a scratch database first (CLAUDE.md "Verify locally
  before shipping a migration") — list every `db/*.sql` with `ls db/*.sql | sort -V`, never a
  `db/0*.sql` glob (it silently skips every 3-digit migration from db/100 onward — this exact
  mistake has shipped a broken migration to production once already).
- Native: `cd native/<app> && flutter analyze --no-fatal-infos && flutter test`. There is no
  Android SDK and no real device in this sandbox — a native change is code-reviewed and unit/
  widget-tested here at best. Say so plainly; don't imply more was verified.
- Cross-surface parity (web vs. native, web vs. the hub's extracted marketing pages): compare
  the two implementations directly (read both files side by side) since there's no automated
  diff for this yet.

## 6. Report with explicit statuses

End every `/global-fix` run with:

- **What changed**, in plain language.
- **Every surface touched** (web app, native app, backend route, migration, test).
- **Every surface that was checked and found NOT to need a change**, briefly — this is what
  proves the search in step 2 was real, not skipped.
- **Per surface: PASS / FAIL / NOT TESTED / BLOCKED / APPROVAL REQUIRED**, matching the
  definitions in CLAUDE.md's Global Change Engine section. Never say "done" or "fixed
  everywhere" without this breakdown backing it up.
- **Anything left undone and why** (a native app with no `builder` for this screen yet, a
  platform limitation, a missing credential, a decision only the owner can make).

Follow the repo's existing commit/PR workflow (CLAUDE.md "Working style": build, ship
commit → PR → merge, one summary at the end) unless the owner is mid-conversation and wants the
report before anything is pushed.
