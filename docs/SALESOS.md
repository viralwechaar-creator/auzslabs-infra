# AUZslab SalesOS — architecture plan and build log

Internal platform for AUZslab's own sales/field team (not a product sold
to clients). Built from the owner's "Master Build Prompt" (20-module
spec: HR, attendance, GPS field tracking, CRM, surveys, demos/trials,
expenses/incentives, admin dashboard, mobile).

## Course correction (read this first)

While building the recruitment pipeline (public apply → admin review →
assign a post → sign in with Google → land in a staff workspace), a full
pass over `db/*.sql` turned up **an existing, substantial "AUZslab team"
system already built across `db/137` through `db/273`** — never wired to
any page (confirmed: zero `.html`/`.js` references anywhere in the repo),
and its functions were never registered in
`server/src/data/rpc-registry.js`, so every one of them 404'd via the
HTTP API until this session fixed that. This is the same failure
pattern this file's `CLAUDE.md` already documents for
`submit_addon_request` ("Website Builder" section) and `payments.js`'s
RLS bug — a real feature, fully built at the database layer, silently
unreachable because the one remaining wiring step never happened.

**What already exists, found and verified working this session
(migration chain applied to a scratch DB, full flow tested end to
end — submit → admin approve → simulated Google sign-in → lazy
activation into a real team-member row):**
- `platform_salesmen` (`db/137`, extended `db/176`): one row per team
  login, `role` in `salesman | setup | support | manager`, active flag.
- `leads` + `lead_notes` (`db/176`): **this is the CRM pipeline** the
  brief asks for — stage (`new/contacted/demo/quoted/converted/declined`),
  assignment, follow-up date, a note/activity timeline per lead.
  `team_add_lead`, `team_update_lead`, `team_assign_lead`,
  `team_my_leads`, `team_all_leads`, `team_lead_notes`.
- `setup_assignments` (`db/176`): assigning a client's onboarding to a
  team member, with an editable checklist, a time-limited access window,
  and `team_setup_open_context` for a controlled hand-off into that
  client's own account.
- `team_activity` (`db/176`) + `team_tasks`/`team_auto_task` (`db/186`,
  auto-creates a task when a lead sits unassigned, or a payment needs
  setup follow-up) — the audit trail and task manager sections of the
  brief.
- `team_work_summary`/`team_overview`/`team_my_work` (`db/176`): **this
  is the performance leaderboard/analytics** section of the brief —
  open/overdue/converted leads, trials created, setups done, last
  active, per person or for the whole team.
- `team_applications` (`db/177`) + `team_candidate_profiles` (`db/188`):
  the recruitment pipeline itself. Two entry points, both writing the
  same table: a plain anonymous form (`submit_team_application` — name,
  email, phone, city, role wanted, experience, a note; a honeypot and a
  3-per-day-per-email cap, same discipline as `submit_lead`), and an
  authenticated one for someone who wants to save a fuller profile first
  (`save_my_team_candidate_profile` → `submit_my_team_application`).
  Approval (`admin_decide_team_application`) doesn't itself create a
  login — it marks the application approved with a role, and the
  **first real Google sign-in with that same email** is what turns it
  into an actual `platform_salesmen` row (`team_me()`'s own
  lazy-activation branch, read in full and tested this session). This
  is exactly the flow the owner described: apply → admin reviews and
  assigns a post → sign in with Google on the account page → land in
  your own workspace. It already works, now that the functions are
  reachable.
- **Deliberate, documented decision already on record: no resume/CV file
  upload** (`db/188`'s own comment: "Structured fields only — no CV/
  resume file upload (the owner's explicit choice over a file-upload
  version)"). The current request asks for resume upload specifically.
  **Flagged to the owner directly rather than silently either adding it
  back or silently dropping that part of the new request** — see the
  open question below.
- Notifications: `notifications` table gets a `team_application`/
  `team_notice`/task-assignment row already (`db/188`, `db/273`) — an
  admin inbox for these needs wiring to the UI (not built yet) but the
  data side is done.

**What was reverted this session** (built in good faith before this was
found, then removed to avoid a second, parallel system): a new
`sos_applications` table/migration, new `sos_perm`/`sos_guard`
functions, a new resume-upload storage route. None of this reached
`main` — caught and undone in the same session before any PR.

**What's still genuinely missing** (this is the real remaining work, not
a redo of the above):
- **The public careers page** (`site/careers.html`, built this session) —
  calls the real `submit_team_application`.
- **The admin review screen** (`site/admin.html`, "Job applications"
  section, built this session) — calls the real
  `admin_list_team_applications`/`admin_decide_team_application`.
- **The team member's own workspace — this is the actual "SalesOS app"
  the brief keeps asking for, and it does not exist yet in any form.**
  `team_me`, `team_my_leads`, `team_my_setups`, `team_my_work`,
  `team_my_tasks` all already return real data; nothing renders them.
  This is Phase 5 below, and it's still a full build.
- GPS field tracking, business visits, the survey engine, demos/trials
  as their own tracked entities, targets/incentive *rules* (distinct
  from Payroll's salary engine) — none of this exists anywhere yet,
  under any name. Confirmed by the same repo-wide search.

## What's reused, not rebuilt (updated)

- **Recruitment, CRM/leads, tasks, activity log, performance analytics,
  client-setup handoff**: the existing `team_*`/`platform_salesmen`
  system above. Extended, never forked.
- **HR (attendance/leave/documents/expenses)**: still Payroll v2
  (`pay_employees`/`pay_punches`/`pay_documents`/`pay_claims`, `db/073`-
  `077`) — team members who need payroll are a separate concern from
  `platform_salesmen` (a login's selling/field role) and get a
  `pay_employees` row the normal way if the owner wants them paid
  through Payroll. Not merged into one table — they answer different
  questions (who can do what in the sales system, vs. who gets paid
  what) and Payroll already handles its half correctly.
- **Auth**: unchanged — Google/email sign-in already drives activation,
  via `team_me()`'s lazy-activation branch, with zero auth code changes.
- **"Mobile application"**: see the original reasoning below — one
  responsive, installable, offline-capable PWA, not a native codebase.
  This remains true regardless of the correction above.

## Open question for the owner

`db/188` deliberately chose structured fields over resume upload.
The brief's message explicitly asks for resume upload. Before adding
it: confirm whether to (a) add resume upload on top of the existing
anonymous form, (b) leave it structured-fields-only as already decided,
or (c) something else. Not implemented either way yet, pending that
answer — adding it later is a small, additive change to the existing
table/functions, not a rebuild.

## Net-new work still ahead (unchanged from the original plan, minus what's now found to already exist)

- **Phase 5, the actual workspace app** (`app/public/salesos.html` +
  `app/public/salesos/*.js`, same PWA/offline pattern as AUZsMob/
  Payroll): sign in → `team_me()` → role-gated nav → My leads (reusing
  `team_my_leads`/`team_update_lead` wholesale), My setups, My tasks, My
  numbers (`team_my_work`), and (manager/admin view) the team overview,
  lead assignment, setup assignment. This is genuinely new UI work, zero
  of it exists.
- **GPS field tracking + visits + survey engine + demos/trials as
  tracked entities** — new schema, genuinely nothing to reuse here; see
  the original architecture notes below, still accurate for this part.
- Targets/incentive *rules* configuration.
- AI features, SMS/WhatsApp automation channel, legal/privacy review of
  GPS monitoring — all explicitly deferred, unchanged from before (see
  "What's genuinely out of scope for a first working build" below).

## What's genuinely out of scope for a first working build (unchanged)

- A literal separate native mobile codebase — a PWA is the honest,
  architecture-consistent answer.
- AI features (section 11 of the brief) — phased last in the brief
  itself and needs a model/provider decision.
- SMS/WhatsApp/email automation wiring — needs the owner's own provider/
  consent decision, same dormant-until-configured discipline as every
  other integration in this repo.
- A full legal/privacy review of the GPS monitoring policy — the
  owner's call, not something to self-certify in code.

## Phases (build log, updated after each phase)

- **Phase 1.** Architecture report. Done, revised above after the
  course correction.
- **Phase 2, recruitment.** Done this session: registered the existing
  `team_*` RPCs, built `site/careers.html` and the admin review screen,
  added the footer "Careers" link across 14 marketing pages. Tested
  end to end against a scratch database (submit → list → approve →
  simulated sign-in → lazy activation into `platform_salesmen`).
  Resume upload: pending the owner's answer above.
- **Phase 3.** GPS field sessions + businesses + visits + survey engine
  (genuinely new).
- **Phase 4.** Demos/trials + targets/incentive rules + daily reports
  (genuinely new, though `team_work_summary` already covers a good
  share of "performance").
- **Phase 5.** The actual workspace app (`salesos.html`), built on top
  of the *existing* `team_*` functions for leads/setups/tasks/overview,
  plus whatever Phase 3/4 add.
- **Phase 6.** Notifications/automation UI (the `notifications` rows
  already exist for this; no inbox screen reads them yet) + audit log
  viewer (`team_activity_feed` already exists, no screen reads it yet).
- **Phase 7.** Admin analytics (live map, visit verification, market
  intel) — needs Phase 3's data first.
- **Phase 8.** AI features — deferred.
- **Phase 9.** Production hardening + full test suite + docs.
