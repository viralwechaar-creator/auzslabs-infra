-- =========================================================
-- AUZslab Payroll v2 (feature key: 'payroll'): HR + payroll on real tables.
--
-- Replaces the old browser-side Payroll (records kinds hr_*, db/024-036), whose
-- numbers were computed in the browser and could be edited after payment. Here the
-- server is authoritative: every number on a payslip is calculated by the
-- database (db/074), every payroll run follows a state machine, finalised runs are
-- frozen, and corrections go through a new run (adjustment / arrears), never by
-- editing history. The old hr_* records are imported once by db/075 (ids kept) and
-- left in place untouched as a backup.
--
-- The flow the tables follow: organisation -> employee (identity) -> job (effective
-- dated) -> time (punches -> daily attendance) -> leave (policy, ledger, requests)
-- -> salary (structure + effective-dated assignment) -> payroll run (items, lines)
-- -> statutory (versioned rules) -> payment (batches) -> accounting (subledger
-- journals, optionally posted to AUZslab Accounting) -> reports -> audit.
--
-- Access model: RLS is ON for every table and there are NO policies and NO grants
-- to the app role, so nothing can be read or written directly, by anyone. Every
-- read and write goes through the SECURITY DEFINER pay_* functions (db/074-075),
-- which call pay_guard(): entitlement to 'payroll' (and not switched off by the
-- owner), the caller's role/permission, and field-level security (salary, bank
-- and PAN only with pay_salary). Employees reach their own data only through
-- pay_me_* functions.
--
-- Money is numeric(16,2), days numeric(6,2), never floats. Dates are plain dates
-- in the organisation's timezone (pay_org.timezone); instants are timestamptz.
-- =========================================================

-- ---------- organisation ----------
create table pay_org (
  tenant_id        uuid primary key references tenants(id) on delete cascade,
  legal_name       text, display_name text,
  pan text, tan text, pf_code text, esi_code text, pt_reg text, lwf_reg text,
  address text, city text, state_code text, pincode text, phone text, email text,
  timezone         text not null default 'Asia/Kolkata',
  fy_start_month   int  not null default 4 check (fy_start_month between 1 and 12),
  leave_year_start int  not null default 1 check (leave_year_start between 1 and 12),
  pay_day          int  not null default 1 check (pay_day between 0 and 28),  -- 0 = last day of the pay month, else this day of the next month
  proration        text not null default 'calendar' check (proration in ('calendar','fixed30','fixed26','working')),
  weekly_off       int[] not null default '{0}',                                -- 0 = Sunday ... 6 = Saturday
  attendance_mode  text not null default 'manual' check (attendance_mode in ('punch','manual','none')),
  stat_mode        text not null default 'rules' check (stat_mode in ('rules','flat')), -- 'flat' = the old Payroll's flat percentages, until the owner switches
  settings         jsonb not null default '{}',
  setup_done       boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table pay_locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  state_code text,                        -- 2-digit state code (same codes as GST); decides professional tax and LWF
  address text,
  lat numeric(9,6), lng numeric(9,6), radius_m int,   -- optional clock-in area
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index pay_locations_t on pay_locations (tenant_id);

-- departments, designations, grades, cost centres, document and claim categories
create table pay_masters (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  kind text not null check (kind in ('department','designation','grade','cost_centre','doc_type','claim_type')),
  name text not null,
  active boolean not null default true,
  unique (tenant_id, kind, name)
);

create table pay_shifts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  start_time time not null, end_time time not null,
  overnight boolean not null default false,          -- ends the next day (also true whenever end <= start)
  break_mins int not null default 0 check (break_mins between 0 and 600),
  grace_mins int check (grace_mins between 0 and 240),   -- null = organisation default
  half_pct int check (half_pct between 1 and 100),       -- worked below this % of the shift = half day; null = default
  active boolean not null default true,
  legacy_id text,
  created_at timestamptz not null default now()
);
create index pay_shifts_t on pay_shifts (tenant_id);
create unique index pay_shifts_legacy on pay_shifts (tenant_id, legacy_id) where legacy_id is not null;

-- ---------- people ----------
create table pay_employees (
  id text primary key,                    -- the old hr_employee record id is kept, so salon logins and links keep working
  tenant_id uuid not null references tenants(id) on delete cascade,
  code text,                              -- employee number people see (E001)
  name text not null,
  phone text, email text,
  gender text check (gender in ('male','female','other')),
  dob date, father_name text,
  address text, emergency_name text, emergency_phone text,
  pan text, aadhaar_last4 text check (aadhaar_last4 ~ '^\d{4}$'), uan text, esi_no text,
  status text not null default 'active' check (status in ('onboarding','active','notice','exited')),
  joined_on date not null,
  confirm_on date,                        -- end of probation
  notice_on date, last_day date,          -- resignation given on / last working day
  exit_kind text check (exit_kind in ('resigned','terminated','retired','contract_end','absconded','death','other')),
  exit_reason text,
  fnf_run_id uuid,                        -- the full and final settlement run, once finalised
  user_id uuid references auth_users(id) on delete set null,     -- self-service login
  attendance_mode text check (attendance_mode in ('punch','manual','none')),   -- null = organisation default
  pf_applicable boolean not null default true,
  eps_applicable boolean not null default true,
  pf_on_actual boolean,                   -- null = organisation default (contribute on wages above the ceiling)
  esi_applicable boolean not null default true,
  pt_applicable boolean not null default true,
  lwf_applicable boolean not null default true,
  disabled_person boolean not null default false,   -- higher ESI wage ceiling
  tax_regime text not null default 'new' check (tax_regime in ('new','old')),
  kiosk_pin text,                         -- bcrypt hash; shared-device clock in
  photo text, notes text,
  source text,                            -- legacy / salon / import / demo
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (last_day is null or last_day >= joined_on - 1)
);
create index pay_employees_t on pay_employees (tenant_id, status);
create unique index pay_employees_code on pay_employees (tenant_id, lower(code)) where code is not null and code <> '';
create unique index pay_employees_user on pay_employees (tenant_id, user_id) where user_id is not null;

-- Employment details are effective-dated: a transfer or promotion adds a row, it never overwrites one.
create table pay_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  employee_id text not null references pay_employees(id) on delete cascade,
  eff_from date not null,
  location_id uuid references pay_locations(id),
  department text, designation text, grade text, cost_centre text,
  emp_type text not null default 'full_time' check (emp_type in ('full_time','part_time','contract','fixed_term','intern')),
  manager_id text references pay_employees(id) on delete set null,
  shift_id uuid references pay_shifts(id) on delete set null,
  weekly_off int[],                       -- null = organisation default
  reason text,
  created_by uuid, created_at timestamptz not null default now(),
  unique (employee_id, eff_from)
);
create index pay_jobs_t on pay_jobs (tenant_id, employee_id, eff_from desc);

-- the employee's timeline (joined, confirmed, transfer, salary change, notice, exit, rehire, full and final)
create table pay_emp_events (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  employee_id text not null references pay_employees(id) on delete cascade,
  on_date date not null,
  kind text not null,
  title text not null,
  data jsonb,
  created_by uuid, created_at timestamptz not null default now()
);
create index pay_emp_events_e on pay_emp_events (employee_id, on_date desc);

-- Payout details are versioned: a change adds a row; the old one becomes 'replaced'. A change asked for by the
-- employee waits as 'pending' until someone with pay_salary approves it.
create table pay_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  employee_id text not null references pay_employees(id) on delete cascade,
  mode text not null default 'bank' check (mode in ('bank','upi','cash','cheque')),
  holder text, bank_name text, account_no text, ifsc text, upi text,
  status text not null default 'active' check (status in ('active','pending','rejected','replaced')),
  requested_by uuid, decided_by uuid, decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index pay_bank_e on pay_bank_accounts (employee_id, created_at desc);
create unique index pay_bank_one_active on pay_bank_accounts (employee_id) where status = 'active';

-- ---------- salary ----------
create table pay_components (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  code text not null check (code ~ '^[A-Z][A-Z0-9_]{0,23}$'),
  name text not null,
  kind text not null check (kind in ('earning','deduction','employer','reimbursement')),
  taxable boolean not null default true,
  pf_wage boolean not null default false,   -- part of "wages" for PF (basic + DA + retaining allowance)
  esi_wage boolean not null default true,
  pt_wage boolean not null default true,
  prorate boolean not null default true,    -- reduced for unpaid days
  is_basic boolean not null default false,  -- basic/DA: gratuity, bonus, leave encashment and the 50% wage test use it
  system text,                              -- set for components the engine fills in itself (pf_ee, esi_ee, pt, tds, ot, ...)
  gl_key text,                              -- payroll subledger account; null = the default for its kind
  on_payslip boolean not null default true,
  sort int not null default 100,
  active boolean not null default true,
  unique (tenant_id, code)
);

-- A structure splits a total into components. lines: [{code, calc: 'fixed'|'formula'|'balance', value, formula, prorate}]
-- basis 'monthly' = the amount entered is the monthly gross; 'ctc' = the amount entered is annual cost to company.
create table pay_structures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  description text,
  basis text not null default 'monthly' check (basis in ('monthly','ctc')),
  lines jsonb not null default '[]',
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);

-- Salary assignments are effective-dated. A row used by a finalised payroll can never change: a later revision is a new
-- row (and a revision dated in the past produces arrears in the next payroll).
create table pay_salaries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  employee_id text not null references pay_employees(id) on delete cascade,
  eff_from date not null,
  structure_id uuid not null references pay_structures(id),
  amount numeric(16,2) not null check (amount >= 0),   -- monthly gross (basis monthly) or annual CTC (basis ctc)
  overrides jsonb not null default '{}',                 -- {CODE: fixed monthly amount} instead of the structure's rule
  ot_rate numeric(12,2) not null default 0 check (ot_rate >= 0),  -- per overtime hour
  breakup jsonb,                                          -- full-month result when saved: {lines:{CODE:amt}, gross, employer, ctc}
  reason text, note text,
  created_by uuid, created_at timestamptz not null default now(),
  unique (employee_id, eff_from)
);
create index pay_salaries_t on pay_salaries (tenant_id, employee_id, eff_from desc);

-- ---------- statutory rules: configuration, never code ----------
-- tenant_id null = maintained by AUZslab for everyone (seeded with a source and the date it was checked); a tenant row
-- for the same scheme/region/date overrides it for that business. region: 'IN' national, a 2-digit state code for PT/LWF,
-- 'new'/'old' for the income-tax regimes.
create table pay_stat_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references tenants(id) on delete cascade,
  scheme text not null check (scheme in ('PF','ESI','PT','LWF','TDS','GRATUITY','BONUS')),
  region text not null default 'IN',
  eff_from date not null,
  eff_to date,
  params jsonb not null,
  source text not null,
  verified_on date,
  note text,
  created_by uuid, created_at timestamptz not null default now(),
  check (eff_to is null or eff_to >= eff_from)
);
create index pay_stat_rules_k on pay_stat_rules (scheme, region, eff_from);

-- ---------- time ----------
create table pay_holidays (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  hdate date not null,
  name text not null,
  location_id uuid references pay_locations(id) on delete cascade,   -- null = every location
  legacy_id text
);
create unique index pay_holidays_u on pay_holidays (tenant_id, hdate, coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- a different shift (or a day off) on one date
create table pay_roster (
  tenant_id uuid not null references tenants(id) on delete cascade,
  employee_id text not null references pay_employees(id) on delete cascade,
  att_date date not null,
  shift_id uuid references pay_shifts(id) on delete cascade,
  off boolean not null default false,
  primary key (employee_id, att_date)
);

-- Raw clock-ins: never edited or deleted. A wrong punch is voided (with a reason), which keeps the original visible.
create table pay_punches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  employee_id text not null references pay_employees(id) on delete cascade,
  at timestamptz not null,
  kind text not null default 'auto' check (kind in ('in','out','auto')),
  source text not null default 'mobile' check (source in ('mobile','kiosk','pos','salon','admin','import','legacy','demo')),
  lat numeric(9,6), lng numeric(9,6), accuracy_m int, distance_m int,
  out_of_range boolean not null default false,
  note text,
  created_by uuid, created_at timestamptz not null default now(),
  voided_at timestamptz, voided_by uuid, void_reason text
);
create index pay_punches_e on pay_punches (employee_id, at);

-- Manual marks and approved corrections. Append-only: the latest row for a day wins; status 'auto' removes a mark.
create table pay_att_overrides (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  employee_id text not null references pay_employees(id) on delete cascade,
  att_date date not null,
  status text check (status in ('present','half','absent','weekly_off','holiday','auto')),   -- null = work it out from in/out below
  in_at timestamptz, out_at timestamptz,
  source text not null default 'manual' check (source in ('manual','regularization','import')),
  reason text, request_id uuid,
  created_by uuid, created_at timestamptz not null default now()
);
create index pay_att_overrides_e on pay_att_overrides (employee_id, att_date, created_at desc);

create table pay_regularizations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  employee_id text not null references pay_employees(id) on delete cascade,
  att_date date not null,
  in_at timestamptz, out_at timestamptz,
  reason text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by uuid, decided_at timestamptz, decision_note text,
  created_by uuid, created_at timestamptz not null default now(),
  legacy_id text
);
create index pay_reg_t on pay_regularizations (tenant_id, status);

-- Daily attendance, derived from punches + overrides + leave + calendar. Recomputed whenever an input changes, until a
-- finalised payroll locks the day (locked_run).
create table pay_attendance (
  tenant_id uuid not null references tenants(id) on delete cascade,
  employee_id text not null references pay_employees(id) on delete cascade,
  att_date date not null,
  status text not null check (status in ('present','late','half','absent','missing','leave','half_leave','holiday','weekly_off','upcoming')),
  paid numeric(4,2) not null default 0,     -- part of the day that is paid
  lop numeric(4,2) not null default 0,      -- part of the day that is unpaid (loss of pay)
  leave_days numeric(4,2) not null default 0,
  leave_type_id uuid, leave_paid boolean,
  shift_id uuid,
  first_in timestamptz, last_out timestamptz,
  worked_mins int not null default 0, late_mins int not null default 0, ot_mins int not null default 0,
  flags text[] not null default '{}',
  source text not null default 'auto',
  locked_run uuid,
  computed_at timestamptz not null default now(),
  primary key (employee_id, att_date)
);
create index pay_attendance_t on pay_attendance (tenant_id, att_date);

-- ---------- leave: policy, ledger and requests are separate ----------
create table pay_leave_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  code text not null check (code ~ '^[A-Z][A-Z0-9_]{0,11}$'),
  name text not null,
  paid boolean not null default true,
  quota numeric(6,2) not null default 0 check (quota >= 0),       -- days per leave year
  accrual text not null default 'yearly' check (accrual in ('yearly','monthly','none')),
  carry_max numeric(6,2) check (carry_max >= 0),                   -- null = carry everything forward; 0 = lapses at year end
  encashable boolean not null default false,
  half_day boolean not null default true,
  allow_negative boolean not null default false,
  count_offdays boolean not null default false,                    -- weekly offs and holidays inside the leave count too
  gender text check (gender in ('female','male')),
  sort int not null default 100,
  active boolean not null default true,
  unique (tenant_id, code)
);

-- The balance is the sum of this ledger. Automatic credits and lapses carry a period_key so they happen once.
create table pay_leave_ledger (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  employee_id text not null references pay_employees(id) on delete cascade,
  leave_type_id uuid not null references pay_leave_types(id),
  on_date date not null,
  kind text not null check (kind in ('opening','credit','debit','reverse','lapse','encash','adjust')),
  days numeric(6,2) not null,               -- + adds to the balance, - uses it
  period_key text,
  request_id uuid, run_id uuid,
  note text,
  created_by uuid, created_at timestamptz not null default now()
);
create index pay_leave_ledger_e on pay_leave_ledger (employee_id, leave_type_id);
create unique index pay_leave_ledger_auto on pay_leave_ledger (employee_id, leave_type_id, kind, period_key) where period_key is not null;

create table pay_leave_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  employee_id text not null references pay_employees(id) on delete cascade,
  leave_type_id uuid not null references pay_leave_types(id),
  from_date date not null, to_date date not null,
  half text not null default 'none' check (half in ('none','first','second')),
  days numeric(6,2) not null check (days > 0),
  reason text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled')),
  decided_by uuid, decided_at timestamptz, decision_note text,
  created_by uuid, created_at timestamptz not null default now(),
  legacy_id text,
  check (to_date >= from_date),
  check (half = 'none' or from_date = to_date)
);
create index pay_leave_req_t on pay_leave_requests (tenant_id, status, from_date);

-- ---------- loans, advances, claims, tax declarations ----------
create table pay_loans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  employee_id text not null references pay_employees(id) on delete cascade,
  kind text not null default 'advance' check (kind in ('advance','loan')),
  amount numeric(16,2) not null check (amount > 0),
  emi numeric(16,2) not null check (emi > 0),
  start_month text not null check (start_month ~ '^\d{4}-\d{2}$'),   -- first month it is recovered
  status text not null default 'requested' check (status in ('requested','active','closed','rejected','cancelled')),
  skip_months text[] not null default '{}',
  reason text, note text,
  requested_by uuid, created_at timestamptz not null default now(),
  decided_by uuid, decided_at timestamptz, decision_note text,
  disbursed_on date, disbursed_via text,
  legacy_id text
);
create index pay_loans_t on pay_loans (tenant_id, status);

-- outstanding = sum(amount): disburse +, recover -, waive -, adjust +/-
create table pay_loan_ledger (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  loan_id uuid not null references pay_loans(id) on delete cascade,
  on_date date not null,
  kind text not null check (kind in ('disburse','recover','waive','adjust')),
  amount numeric(16,2) not null,
  run_id uuid, item_id uuid,
  note text,
  created_by uuid, created_at timestamptz not null default now()
);
create index pay_loan_ledger_l on pay_loan_ledger (loan_id);

create table pay_claims (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  employee_id text not null references pay_employees(id) on delete cascade,
  claim_date date not null,
  category text not null default 'Other',
  amount numeric(16,2) not null check (amount > 0),
  approved_amount numeric(16,2) check (approved_amount >= 0),
  description text, attachment text,
  status text not null default 'submitted' check (status in ('submitted','approved','rejected','paid','cancelled')),
  decided_by uuid, decided_at timestamptz, decision_note text,
  run_id uuid, paid_on date,
  created_by uuid, created_at timestamptz not null default now()
);
create index pay_claims_t on pay_claims (tenant_id, status);

-- items: {rent_monthly, metro, sec80c, sec80d, sec80ccd1b, home_loan_interest, other_deductions, prev_income, prev_tds}
create table pay_tax_decl (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  employee_id text not null references pay_employees(id) on delete cascade,
  fy text not null check (fy ~ '^\d{4}-\d{2}$'),
  regime text not null default 'new' check (regime in ('new','old')),
  items jsonb not null default '{}',
  status text not null default 'submitted' check (status in ('submitted','approved')),
  updated_by uuid, updated_at timestamptz not null default now(),
  unique (employee_id, fy)
);

-- ---------- payroll runs ----------
create table pay_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  number text not null,
  kind text not null default 'regular' check (kind in ('regular','offcycle','bonus','fnf','legacy')),
  title text,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  period_from date not null, period_to date not null,
  pay_date date not null,
  status text not null default 'draft' check (status in ('draft','calculated','review','approved','finalized','paid','locked','cancelled')),
  params jsonb not null default '{}',
  employees int not null default 0,
  gross numeric(16,2) not null default 0, deductions numeric(16,2) not null default 0,
  net numeric(16,2) not null default 0, employer numeric(16,2) not null default 0,
  paid numeric(16,2) not null default 0,
  totals jsonb not null default '{}',
  warnings jsonb not null default '[]',
  calc_no int not null default 0,
  created_by uuid, created_at timestamptz not null default now(),
  calculated_by uuid, calculated_at timestamptz,
  submitted_by uuid, submitted_at timestamptz,
  approved_by uuid, approved_at timestamptz,
  finalized_by uuid, finalized_at timestamptz,
  cancelled_by uuid, cancelled_at timestamptz, cancel_reason text,
  journal_id uuid,
  acc_status text not null default 'none' check (acc_status in ('none','posted','failed','off')),
  acc_journal_id uuid, acc_error text,
  note text,
  check (period_to >= period_from),
  unique (tenant_id, number)
);
create unique index pay_runs_one_regular on pay_runs (tenant_id, month) where kind = 'regular' and status <> 'cancelled';
create index pay_runs_t on pay_runs (tenant_id, month desc);

-- one-time amounts and corrections entered for a run (bonus, incentive, fine, extra days off, overtime hours, TDS override)
create table pay_run_inputs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  run_id uuid not null references pay_runs(id) on delete cascade,
  employee_id text not null references pay_employees(id) on delete cascade,
  kind text not null check (kind in ('earning','deduction','lop_days','ot_hours','tds')),
  code text, name text,
  amount numeric(16,2) not null default 0,
  taxable boolean not null default true,
  note text,
  created_by uuid, created_at timestamptz not null default now()
);
create index pay_run_inputs_r on pay_run_inputs (run_id, employee_id);

create table pay_run_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  run_id uuid not null references pay_runs(id) on delete cascade,
  employee_id text not null references pay_employees(id),
  status text not null default 'ok' check (status in ('ok','hold')),
  hold_reason text,
  salary_id uuid,
  snap jsonb not null default '{}',      -- who and where at the time: name, code, department, designation, location, state, payout (masked), PAN (masked), UAN, regime
  att jsonb not null default '{}',       -- days in period, divisor, employed, paid, unpaid, present, half, absent, leave, holidays, weekly offs, overtime
  gross numeric(16,2) not null default 0,
  deductions numeric(16,2) not null default 0,
  net numeric(16,2) not null default 0,
  employer numeric(16,2) not null default 0,
  taxable numeric(16,2) not null default 0,
  pf_wage numeric(16,2) not null default 0, eps_wage numeric(16,2) not null default 0, edli_wage numeric(16,2) not null default 0,
  ncp_days numeric(6,2) not null default 0,
  esi_wage numeric(16,2) not null default 0, esi_covered boolean not null default false,
  pt_wage numeric(16,2) not null default 0, pt_state text,
  tax jsonb,
  warnings jsonb not null default '[]',
  payslip_no text,
  published boolean not null default true,
  unique (run_id, employee_id),
  check (net = gross - deductions),
  check (net >= 0)
);
create index pay_run_items_e on pay_run_items (employee_id);

create table pay_run_lines (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  run_id uuid not null references pay_runs(id) on delete cascade,
  item_id uuid not null references pay_run_items(id) on delete cascade,
  employee_id text not null,
  code text not null, name text not null,
  kind text not null check (kind in ('earning','deduction','employer','reimbursement')),
  amount numeric(16,2) not null check (amount >= 0),
  full_amount numeric(16,2),               -- before proration
  qty numeric(10,2),                       -- hours, days or months behind the amount, when there are any
  source text not null default 'structure' check (source in ('structure','input','statutory','loan','claim','arrears','ot','leave','fnf','bonus','legacy','flat')),
  ref_id text,
  calc text,                                -- how it was worked out, in words
  taxable boolean not null default true,
  pf boolean not null default false, esi boolean not null default false, pt boolean not null default false,
  is_basic boolean not null default false,
  gl_key text,
  sort int not null default 100
);
create index pay_run_lines_i on pay_run_lines (item_id);
create index pay_run_lines_r on pay_run_lines (run_id, code);

-- months whose arrears a salary revision has already been paid for, so arrears are paid once
create table pay_arrears_settled (
  tenant_id uuid not null references tenants(id) on delete cascade,
  employee_id text not null references pay_employees(id) on delete cascade,
  month text not null,
  salary_id uuid not null,
  run_id uuid not null,
  amount numeric(16,2) not null default 0,
  created_at timestamptz not null default now(),
  primary key (employee_id, month, salary_id)
);

-- ---------- payment ----------
create table pay_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  run_id uuid not null references pay_runs(id),
  number text not null,
  mode text not null default 'bank' check (mode in ('bank','cash','upi','cheque')),
  status text not null default 'open' check (status in ('open','partial','paid','cancelled')),
  total numeric(16,2) not null default 0, paid numeric(16,2) not null default 0, failed numeric(16,2) not null default 0,
  pay_account uuid,                         -- AUZslab Accounting bank/cash account, when Accounting is on
  note text,
  created_by uuid, created_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (tenant_id, number)
);
create index pay_batches_r on pay_batches (run_id);

create table pay_batch_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  batch_id uuid not null references pay_batches(id) on delete cascade,
  item_id uuid not null references pay_run_items(id),
  employee_id text not null,
  amount numeric(16,2) not null check (amount > 0),
  mode text not null, holder text, bank_name text, account_no text, ifsc text, upi text,
  status text not null default 'pending' check (status in ('pending','paid','failed','cancelled')),
  paid_on date, ref text, fail_reason text,
  journal_id uuid,
  updated_by uuid, updated_at timestamptz not null default now()
);
create index pay_batch_lines_b on pay_batch_lines (batch_id);
-- one item can be in at most one live payment line: no double payment
create unique index pay_batch_lines_live on pay_batch_lines (item_id) where status in ('pending','paid');

-- PF / ESI / PT / TDS / LWF paid to the government (challans)
create table pay_stat_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  scheme text not null check (scheme in ('PF','ESI','PT','TDS','LWF')),
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  amount numeric(16,2) not null check (amount > 0),
  paid_on date not null,
  ref text, note text,
  pay_account uuid,
  journal_id uuid,
  created_by uuid, created_at timestamptz not null default now()
);
create index pay_stat_payments_t on pay_stat_payments (tenant_id, scheme, month);

-- ---------- payroll subledger (always written; posted to AUZslab Accounting when it is on) ----------
create table pay_journals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  jdate date not null,
  kind text not null check (kind in ('accrual','payment','statutory','reversal')),
  source_type text not null, source_id uuid not null,
  narration text,
  acc_status text not null default 'none' check (acc_status in ('none','posted','failed','off')),
  acc_journal_id uuid, acc_error text,
  created_by uuid, created_at timestamptz not null default now()
);
create index pay_journals_s on pay_journals (tenant_id, source_type, source_id);

create table pay_journal_lines (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  journal_id uuid not null references pay_journals(id) on delete cascade,
  account_key text not null,
  debit numeric(16,2) not null default 0 check (debit >= 0),
  credit numeric(16,2) not null default 0 check (credit >= 0),
  employee_id text,
  narration text,
  check (debit = 0 or credit = 0)
);
create index pay_journal_lines_j on pay_journal_lines (journal_id);

-- ---------- documents, notices, company assets, audit, numbering ----------
create table pay_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  employee_id text not null references pay_employees(id) on delete cascade,
  doc_type text not null,
  name text,
  path text not null,
  content_type text, size int,
  employee_can_see boolean not null default true,
  uploaded_by uuid, created_at timestamptz not null default now(),
  legacy_id text
);
create index pay_documents_e on pay_documents (employee_id);

create table pay_announcements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  title text not null, body text,
  active boolean not null default true,
  created_by uuid, created_at timestamptz not null default now(),
  legacy_id text
);

create table pay_assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  employee_id text not null references pay_employees(id) on delete cascade,
  name text not null, serial text,
  value numeric(16,2),
  issued_on date, returned_on date,
  note text,
  created_at timestamptz not null default now()
);

create table pay_audit (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  at timestamptz not null default now(),
  actor uuid, actor_email text, actor_role text,
  action text not null, entity text not null, entity_id text,
  employee_id text,
  before jsonb, after jsonb,
  reason text
);
create index pay_audit_t on pay_audit (tenant_id, at desc);

create table pay_series (
  tenant_id uuid not null references tenants(id) on delete cascade,
  key text not null,
  next_no int not null default 1,
  primary key (tenant_id, key)
);

-- failed kiosk PIN attempts (throttle)
create table pay_pin_fails (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  employee_id text,
  at timestamptz not null default now()
);

-- ---------- history is append-only ----------
-- The demo tenants are rebuilt by pay_reset_demo(), which sets pay.reset = '1'; nothing else may bypass these.
create function pay_resetting(tid uuid) returns boolean language sql stable as $$
  select current_setting('pay.reset', true) = '1' and exists (select 1 from tenants where id = tid and is_demo)
$$;

create function pay_block_change() returns trigger language plpgsql as $$
begin
  if pay_resetting(coalesce(old.tenant_id, new.tenant_id)) then return case when tg_op = 'DELETE' then old else new end; end if;
  raise exception '% rows are permanent history and cannot be changed or deleted', tg_table_name;
end $$;
do $$
declare t text;
begin
  foreach t in array array['pay_leave_ledger','pay_loan_ledger','pay_audit','pay_emp_events','pay_att_overrides','pay_journal_lines','pay_arrears_settled'] loop
    execute format('create trigger %I before update or delete on %I for each row execute function pay_block_change()', t || '_append_only', t);
  end loop;
end $$;

-- punches: only voiding (once) is allowed
create function pay_punch_guard() returns trigger language plpgsql as $$
begin
  if pay_resetting(old.tenant_id) then return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_op = 'DELETE' then raise exception 'Clock-ins are never deleted; void it with a reason instead'; end if;
  if old.voided_at is not null then raise exception 'This clock-in is already voided'; end if;
  if (new.employee_id, new.at, new.kind, new.source, new.lat, new.lng, new.created_at) is distinct from
     (old.employee_id, old.at, old.kind, old.source, old.lat, old.lng, old.created_at) then
    raise exception 'A clock-in cannot be edited; void it and add a correction instead';
  end if;
  if new.voided_at is null or coalesce(trim(new.void_reason), '') = '' then raise exception 'Voiding a clock-in needs a reason'; end if;
  return new;
end $$;
create trigger pay_punches_guard before update or delete on pay_punches for each row execute function pay_punch_guard();

-- journals: only the accounting-posting status may change
create function pay_journal_guard() returns trigger language plpgsql as $$
begin
  if pay_resetting(old.tenant_id) then return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_op = 'DELETE' or (new.jdate, new.kind, new.source_type, new.source_id, new.tenant_id) is distinct from (old.jdate, old.kind, old.source_type, old.source_id, old.tenant_id) then
    raise exception 'Payroll journals are permanent; post a reversal instead';
  end if;
  return new;
end $$;
create trigger pay_journals_guard before update or delete on pay_journals for each row execute function pay_journal_guard();

-- every payroll journal balances by the time its transaction commits
create function pay_check_balanced() returns trigger language plpgsql as $$
declare d numeric; c numeric;
begin
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0) into d, c from pay_journal_lines where journal_id = new.journal_id;
  if d <> c then raise exception 'Payroll journal does not balance: debit % vs credit %', d, c; end if;
  return null;
end $$;
create constraint trigger pay_jl_balanced after insert on pay_journal_lines deferrable initially deferred for each row execute function pay_check_balanced();

-- Finalised runs are frozen: their items and lines cannot be added, removed or changed (an item may only be put on or
-- taken off hold, or hidden from the employee). Runs themselves are never deleted, only cancelled before finalising.
create function pay_run_guard() returns trigger language plpgsql as $$
begin
  if pay_resetting(coalesce(old.tenant_id, new.tenant_id)) then return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_op = 'DELETE' then raise exception 'Payroll runs are never deleted; cancel it instead'; end if;
  if old.status in ('finalized','paid','locked') then
    if (new.kind, new.month, new.period_from, new.period_to, new.gross, new.deductions, new.net, new.employer, new.employees, new.number, new.journal_id)
       is distinct from (old.kind, old.month, old.period_from, old.period_to, old.gross, old.deductions, old.net, old.employer, old.employees, old.number, old.journal_id) then
      raise exception 'Payroll % is finalised and cannot change; make an adjustment in a new run', old.number;
    end if;
    if new.status not in ('finalized','paid','locked') then raise exception 'A finalised payroll cannot go back to %', new.status; end if;
  end if;
  if old.status = 'cancelled' and new.status <> 'cancelled' then raise exception 'A cancelled payroll cannot be reopened'; end if;
  return new;
end $$;
create trigger pay_runs_guard before update or delete on pay_runs for each row execute function pay_run_guard();

create function pay_item_guard() returns trigger language plpgsql as $$
declare st text; rid uuid;
begin
  rid := case when tg_op = 'INSERT' then new.run_id else old.run_id end;
  if pay_resetting(case when tg_op = 'INSERT' then new.tenant_id else old.tenant_id end) then return case when tg_op = 'DELETE' then old else new end; end if;
  select status into st from pay_runs where id = rid;
  if st in ('finalized','paid','locked') then
    if tg_op <> 'UPDATE' then raise exception 'Payroll is finalised: employees cannot be added or removed'; end if;
    if (new.gross, new.deductions, new.net, new.employer, new.taxable, new.employee_id, new.salary_id, new.pf_wage, new.esi_wage, new.pt_wage, new.att, new.snap)
       is distinct from (old.gross, old.deductions, old.net, old.employer, old.taxable, old.employee_id, old.salary_id, old.pf_wage, old.esi_wage, old.pt_wage, old.att, old.snap)
       or (old.payslip_no is not null and new.payslip_no is distinct from old.payslip_no) then
      raise exception 'Payroll is finalised: pay cannot change; make an adjustment in a new run';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger pay_run_items_guard before insert or update or delete on pay_run_items for each row execute function pay_item_guard();

create function pay_line_guard() returns trigger language plpgsql as $$
declare st text; rid uuid;
begin
  rid := case when tg_op = 'INSERT' then new.run_id else old.run_id end;
  if pay_resetting(case when tg_op = 'INSERT' then new.tenant_id else old.tenant_id end) then return case when tg_op = 'DELETE' then old else new end; end if;
  select status into st from pay_runs where id = rid;
  if st in ('finalized','paid','locked') then raise exception 'Payroll is finalised: payslip lines cannot change'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger pay_run_lines_guard before insert or update or delete on pay_run_lines for each row execute function pay_line_guard();

-- inputs freeze once a run is approved
create function pay_input_guard() returns trigger language plpgsql as $$
declare st text; rid uuid;
begin
  rid := case when tg_op = 'INSERT' then new.run_id else old.run_id end;
  if pay_resetting(case when tg_op = 'INSERT' then new.tenant_id else old.tenant_id end) then return case when tg_op = 'DELETE' then old else new end; end if;
  select status into st from pay_runs where id = rid;
  if st not in ('draft','calculated') then raise exception 'This payroll is % - changes to it need it to be sent back first', st; end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger pay_run_inputs_guard before insert or update or delete on pay_run_inputs for each row execute function pay_input_guard();

-- a salary row that a finalised payroll used is history
create function pay_salary_guard() returns trigger language plpgsql as $$
begin
  if pay_resetting(old.tenant_id) then return case when tg_op = 'DELETE' then old else new end; end if;
  if exists (select 1 from pay_run_items i join pay_runs r on r.id = i.run_id where i.salary_id = old.id and r.status in ('finalized','paid','locked')) then
    raise exception 'This salary was used in a finalised payroll; add a revision with a new date instead';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger pay_salaries_guard before update or delete on pay_salaries for each row execute function pay_salary_guard();

-- a paid payment line is final (a failed or cancelled line can be paid again in a new batch)
create function pay_batch_line_guard() returns trigger language plpgsql as $$
begin
  if pay_resetting(old.tenant_id) then return case when tg_op = 'DELETE' then old else new end; end if;
  if tg_op = 'DELETE' then raise exception 'Payment lines are kept; cancel the batch instead'; end if;
  if old.status = 'paid' and (new.status <> 'paid' or new.amount <> old.amount) then raise exception 'A paid salary payment cannot be changed'; end if;
  if old.status in ('failed','cancelled') and new.status <> old.status then raise exception 'Pay this again in a new batch'; end if;
  return new;
end $$;
create trigger pay_batch_lines_guard before update or delete on pay_batch_lines for each row execute function pay_batch_line_guard();

-- ---------- row level security: on, with no policies and no grants -----------
-- Nothing is readable or writable directly; the pay_* SECURITY DEFINER functions are the only door.
do $$
declare t text;
begin
  foreach t in array array['pay_org','pay_locations','pay_masters','pay_shifts','pay_employees','pay_jobs','pay_emp_events','pay_bank_accounts',
    'pay_components','pay_structures','pay_salaries','pay_stat_rules','pay_holidays','pay_roster','pay_punches','pay_att_overrides','pay_regularizations',
    'pay_attendance','pay_leave_types','pay_leave_ledger','pay_leave_requests','pay_loans','pay_loan_ledger','pay_claims','pay_tax_decl','pay_runs',
    'pay_run_inputs','pay_run_items','pay_run_lines','pay_arrears_settled','pay_batches','pay_batch_lines','pay_stat_payments','pay_journals',
    'pay_journal_lines','pay_documents','pay_announcements','pay_assets','pay_audit','pay_series','pay_pin_fails']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('revoke all on %I from public', t);
    if exists (select 1 from pg_roles where rolname = 'app') then execute format('revoke all on %I from app', t); end if;
  end loop;
end $$;
