# AUZslab Payroll v2

The rebuilt Payroll app (`app/public/payroll.html` + `app/public/payroll/`) and its database (`db/069`-`073`).
It replaces the old single-file Payroll that stored everything as `records` kinds `hr_*`. The old data is imported automatically and the old records are left untouched.

## The flow

The app is organised the way the work flows:

**business → person → attendance → leave → salary → payroll → government dues → payment → accounts → reports → change history**

| Step | Where in the app | Server |
|---|---|---|
| Business rules | Settings (company, pay rules, government deductions, attendance, leave types, locations, access, accounting) | `pay_save_org`, `pay_save_*` |
| People | People → person (overview, pay, time, leave, files, history) | `pay_save_employee`, `pay_save_job`, `pay_save_salary`, `pay_save_bank`, `pay_set_status` |
| Attendance | Time (day board, month grid, shifts), kiosk, phone clock-in, POS clock-ins | `pay_att_compute`, `pay_mark_attendance`, `pay_add_punch`, `pay_kiosk_punch`, `pay_me_punch` |
| Leave | Leave, My leave | append-only `pay_leave_ledger`, `pay_leave_validate/decide/cancel` |
| Payroll | Payroll → run page (Check → Approve → Finalise → Pay) | `pay_run_create/calculate/submit/approve/finalize/lock` |
| Government dues | Government dues, Reports (PF ECR, ESI, PT, TDS, Form 16 working) | `pay_calc_pf/esi/pt`, `pay_calc_tds`, `pay_report` |
| Payment | Run page → Pay (bank file or cash) | `pay_batch_create/mark` |
| Accounts | posted automatically (or by button) to AUZslab Accounting | `pay_acc_post_run`, `acc_post_journal` |
| Change history | Settings → Change history | append-only `pay_audit` |

## Rules that hold everywhere (and the tests that check them)

- Employment and salary are **effective-dated** (`pay_jobs`, `pay_salaries`): a change has a start date. Nothing is overwritten.
- A finalised payroll is **frozen**. Its lines and totals, and the attendance days it covered, cannot change. A later correction becomes an adjustment in a later payroll: arrears (`ARREARS` / `ARREARS_REC`) or a one-time amount.
- **Invariants**, checked by `pay_integrity_check()` (Settings → Books health check) and asserted after every money step in `tests/suites/local/payroll.mjs`:
  - each payslip equals its lines;
  - each payroll equals its payslips;
  - the amount paid equals the approved net pay;
  - payroll journals balance;
  - accounting liability equals payroll liability;
  - loan balances equal the loan ledger;
  - leave balances equal the leave ledger.
- **Government rules are data, not code.** `pay_stat_rules` holds dated, versioned rules for PF, ESI, PT (per state), LWF, TDS (new and old regime), gratuity and bonus. Each rule records the act or notification it comes from and the date it was checked. A business can add its own rule with a later start date. Payrolls already run keep the rule they used.
  - Examples: the PF wage ceiling moves from 15,000 to 25,000 on 2026-09-16, and the payroll weights it by days. The PT slab and the women's exemption are looked up by state.
  - Gratuity and bonus values have not been re-checked since they were first entered. Check them against the current Acts before relying on them.
- **Access** (`pay_perm`):
  - The owner can do everything.
  - A manager can see people, time, leave and reports, but never salaries, bank details or PAN. If Settings → Who can do what → "Managers can see and run payroll" is switched on, a manager can also handle salaries and payroll.
  - Custom roles get exactly the `pay_*` boxes ticked on the account page.
  - Staff with a login see only their own record, through the `pay_me_*` functions.
  - A line manager (`pay_jobs.manager_id`) can decide their own team's leave and attendance corrections.
  - These rules are applied in the database, so they hold no matter what the screen shows.
- Optional approvals:
  - **Review step**: someone must send the payroll for approval before it can be approved.
  - **Two-person rule**: the person who calculated the payroll cannot approve it.
- Bank detail changes requested by staff wait for approval by someone with salary rights.
- Kiosk PINs are hashed. Five wrong PINs in five minutes lock that person's PIN.

## The screens

Built to Apple's Human Interface Guidelines and meant to be easy for someone who has never used HR software:

- plain words throughout;
- one main action per screen;
- a large title on phones;
- touch targets of at least 44 pt;
- bottom sheets for forms;
- segmented controls for switching views;
- a tab bar on phones (Home, People, Time, Pay or Leave, More);
- an icon rail at 900-1199 px and a grouped sidebar from 1200 px;
- dark mode;
- the business's own accent colour (`ds/brand.js`).

`h()` never uses `innerHTML`. There is no emoji in the UI.

Staff self-service:
- Today: a big Clock in / Clock out button, leave left, last pay, notices.
- My time: calendar, and asking for a correction.
- My leave: balances, asking for leave, cancelling a request.
- My pay: payslips, advance request, expense claim with a receipt, income-tax declaration.
- Profile: details and a bank change request.
- My team: for line managers.

The first time the owner opens Payroll, a five-question setup guide runs.

## Files

- `db/069_payroll_schema.sql`: 41 `pay_*` tables. RLS is on with no policies, so they are only reachable through SECURITY DEFINER functions. Append-only and guard triggers protect the history.
- `db/070_payroll_engine.sql`:
  - permissions;
  - helpers;
  - the formula engine (whitelisted, dependency-ordered);
  - attendance computation;
  - leave;
  - PF / ESI / PT / income-tax calculators;
  - the first set of government rules.
- `db/071_payroll_run.sql`:
  - setup defaults;
  - the per-person calculation (`pay_calc_item`);
  - the payroll state machine;
  - full and final settlement;
  - payment batches;
  - the accounting subledger and posting;
  - the integrity check.
- `db/072_payroll_api.sql`: the API used by the screens: settings, people, import, time, leave, loans, claims, tax, runs, payslips, dashboard, search.
- `db/073_payroll_ess.sql`:
  - staff self-service and the kiosk;
  - reports;
  - the import from the old Payroll;
  - the salon console hooks (same signatures as db/054);
  - POS clock-ins copied into attendance;
  - the demo data.
- `server/src/index.js`: every public `pay_*` function is in the `RPC` list. Internal helpers deliberately are not. SQLSTATE `PYxxx` maps to HTTP 400.
- `app/public/payroll/`:
  - `core.js`: UI kit and API;
  - `shell.js`: sign-in, navigation by role, router, search;
  - `p-home.js`: dashboard and setup guide;
  - `p-people.js`;
  - `p-time.js`: time and leave;
  - `p-pay.js`: payroll, payslips, payments, loans, claims, government dues, tax;
  - `p-reports.js`;
  - `p-settings.js`;
  - `p-me.js`: self-service, team and kiosk.

## Old Payroll import

`pay_import_legacy(tenant)` copies `hr_employee`, `hr_attendance`, `hr_shift`, `hr_holiday`, `hr_leave`, `hr_regularization`, `hr_advance`, `hr_payslip`, `hr_document`, `hr_announcement` and `hr_settings` into the new tables. It keeps the old ids.

- It is idempotent and incremental: it only looks at records changed since `settings._legacy_at`.
- It runs from the migration for every business, when Payroll is opened, and before every calculation.
- Old payslips become closed "legacy" payrolls.
- An imported business keeps calculating pay the way the old app did until the owner changes it in Settings: flat 12% PF, 0.75% ESI, ₹200 PT, no weekly off. A banner on Home explains this. Pay worked out this way was checked to match the old app to the paisa.

## Deploy

```bash
cd auzslabs-infra && git pull origin main
set -a; source .env; set +a
for f in db/069_payroll_schema.sql db/070_payroll_engine.sql db/071_payroll_run.sql db/072_payroll_api.sql db/073_payroll_ess.sql; do
  docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 < "$f" || break
done
docker compose up -d --build api
```

Then remove Payroll from the iPhone home screen and add it again, so the new app replaces the cached copy.

## Tests

`node tests/run-local.mjs payroll` runs 32 checks:
- access for logged-out users, other businesses, managers and staff;
- field security;
- tenant isolation;
- attendance;
- leave and its ledger;
- the kiosk;
- append-only punches;
- the September payroll amounts: unpaid days, PF ceiling, ESI eligibility, Maharashtra PT and the women's exemption, joining mid-month, CTC split, old-regime TDS;
- approvals and the two-person rule;
- finalising, accounting posting and balancing;
- the frozen payroll;
- staff payslip access;
- paying;
- arrears, advance recovery, claims and one-time amounts;
- full and final settlement and the double-payment guard;
- all reports;
- the audit log;
- the console summary;
- every screen on phone and desktop for the owner and for staff;
- adding a person and clocking in on a phone.

## Known limits

- No direct filing with EPFO, ESIC, TRACES or the GST portal. Reports produce the files (PF ECR text, ESI CSV) and the working figures for upload by hand.
- No real background jobs. Leave accrual, the exit of people on notice and the demo reset run the next time someone opens the app.
- Biometric devices are not connected. Clock-ins come from phones, the kiosk and the POS.
- LWF has no state rule seeded. A business adds its own rule with its source.
