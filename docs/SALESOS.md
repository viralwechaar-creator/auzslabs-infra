# AUZslab SalesOS — architecture + build log (current)

Internal platform for AUZslab's own sales/field team (not a product sold to
clients). Built from the owner's "Master Build Prompt" (20-module spec: HR,
attendance, GPS field tracking, CRM, surveys, demos/trials, expenses/
incentives, admin dashboard, mobile). Everything below is real and merged.

## History note (read once, then ignore)

An early draft of this build reused the project's old `team_*`/
`platform_salesmen` system, which turned out to have been **deliberately
deleted by the owner in Oct 2026** (see CLAUDE.md's "REMOVED" section).
Owner's answer when asked: revert, stay removed. Everything here is built
fresh under the `sos_*` naming instead — never reintroduce `team_*`,
`platform_salesmen`, `salesman.html`, or `site/join-team.html`.

## Architecture

- **A dedicated internal tenant**, `auzslab-internal` (niche `general`,
  `tenant_settings.features.salesos = true`), separate from every client
  tenant. Roles seeded at creation: `Admin`, `Sales Manager`, `Sales
  Executive`, each with a `roles.permissions` jsonb map of `sos_*` keys.
- **`sos_guard(k default 'sos_view')`** / **`sos_perm(k)`** / **`sos_tenant()`**
  (db/351): the exact SECURITY DEFINER pattern this project already uses
  for `pay_guard`/`acc_guard`. Every `sos_*` table has RLS enabled with
  zero policies — all access goes through these guarded functions only.
- **The app**: `app/public/salesos.html`, a single-file PWA (same pattern
  as `payroll.html`/`mob.html`), gated client-side on `my_dashboard`'s
  `features.salesos` flag. Google sign-in via `/ds/gsignin.js`.

## What's built (by migration)

- **db/351 — recruitment.** Public "Apply to join AUZslab" (`site/careers.html`
  → `submit_job_application` + a resume upload) → admin review
  (`site/admin.html`'s Job applications section) → on approval, a real
  `auth_users` row is created with an assigned post (Sales Executive /
  Sales Manager / Admin), picked up by the existing `t_signup` trigger.
  The staffer signs in with that email (password or, once linked, Google)
  and lands in `salesos.html`.
- **db/352 — field sessions + GPS.** `sos_field_sessions` (one open session
  per staffer, enforced by a partial unique index), `sos_location_samples`
  batched from `navigator.geolocation.watchPosition`, `sos_live_field()`
  (manager-only last-known-point feed, rendered as Google Maps links in
  the Team card).
- **db/353 — businesses + visits.** `sos_businesses` (a lightweight CRM
  record: name/category/contact/address), `sos_visits` (check-in with
  lat/lng, check-out with outcome/interest/products/follow-up).
- **db/354 — leads.** `sos_leads`, a 10-stage pipeline
  (`new_prospect → ... → won/lost`) with a partial unique index enforcing
  one active opportunity per business+product. `sos_lead_notes` for a
  running history (create/stage-change/assign all logged).
- **db/355 — demos + trials.** `sos_demos`, `sos_trials`. Critically,
  **`sos_trial_verify_conversion`** requires a real, active row in the
  production `tenants` table matching a given slug before marking a
  trial converted / lead won — a salesperson cannot self-report a sale.
- **db/356 — targets + performance.** `sos_targets` (manager-set monthly
  visit/lead/demo targets per staffer), `sos_my_performance`,
  `sos_daily_report` (fully computed, never free text), `sos_team_performance`
  (leaderboard).
- **db/357 — survey engine.** Admin-editable `sos_survey_templates` /
  `sos_survey_questions` (7 question kinds), server-side required-field
  validation in `sos_survey_submit`, `sos_market_intel()` — explicitly
  labelled as employee-reported, unverified data, per the brief.
- **db/358 — expenses.** `sos_expenses` (fuel/travel/food/etc, optional
  receipt photo via a private authenticated upload route distinct from
  the public resume upload), manager approve/reject/mark-reimbursed.
- **db/359 — tasks.** `sos_tasks`, general-purpose (self-created, or a
  manager assigning to anyone on the team); `sos_my_tasks` merges open
  tasks with due lead follow-ups (`sos_leads.follow_up_date`) into one
  list rather than inventing a second follow-up system.
- **db/360 — audit log + notifications.** `sos_audit`, append-only
  (trigger-blocked UPDATE/DELETE, same discipline as `pos_audit`/
  `acc_audit`/`pay_audit`). `sos_notifications`, a pull-based inbox.
  Lead assignment, task assignment and expense review each write an
  audit row and notify the affected person. `sos_log`/`sos_notify` are
  deliberately **not** registered in the RPC allow-list — only internal
  callers should write into the audit trail or someone else's inbox.
- **db/361 — incentives + visit integrity.** `sos_incentive_rules` (a flat
  ₹-per-deal-won rate, manager-set); `sos_my_incentive()` computes this
  month's earned incentive live. `sos_flagged_visits()` surfaces any
  visit checked out under 2 minutes after check-in for manager review
  (`sos_visit_mark_reviewed`) — a real anti-fraud signal, computed on
  read so the threshold can change with no backfill.

## Deliberately out of scope for now

- **AI features** (brief section 11) — phased last in the brief itself;
  needs a model/provider decision from the owner.
- **A separate native mobile codebase** — `salesos.html` is a responsive,
  installable PWA, consistent with how AUZsMob/Payroll/Accounting were
  all built in this repo; no native app exists or is planned.
- **SMS/WhatsApp/email notification delivery** — the in-app inbox
  (db/360) exists; wiring an outbound channel needs the owner's own
  provider/consent decision, same dormant-until-configured discipline as
  every other integration in this repo (`mail.js`, `sms.js`, ...).
- **A full legal/privacy review of GPS field tracking** — the owner's
  call, not something to self-certify in code.
- **A dedicated automated test suite** (`tests/suites/local/*.mjs`) —
  every migration above was instead hand-tested end to end against a
  disposable scratch database (permission boundaries, validation
  failures, and the real success path for every function) before
  merging; a real suite following the project's existing pattern
  (`node tests/run-local.mjs <suite>`) would still be worth adding.

## Deploy

Each migration above is applied by hand, in order, the same way as every
other migration in this repo:

```bash
cd auzslabs-infra && git pull origin main
set -a; source .env; set +a
for f in db/351_salesos_recruitment.sql db/352_salesos_field_sessions.sql \
         db/353_salesos_businesses_visits.sql db/354_salesos_leads.sql \
         db/355_salesos_demos_trials.sql db/356_salesos_targets_performance.sql \
         db/357_salesos_surveys.sql db/358_salesos_expenses.sql \
         db/359_salesos_tasks.sql db/360_salesos_audit.sql \
         db/361_salesos_incentives_integrity.sql; do
  docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 < "$f" || break
done
docker compose up -d --build api
```

Then a platform admin opens `site/admin.html` → Job applications once to
hire the first staffer (or insert a first Admin-post row by hand).
