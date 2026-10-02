-- =========================================================
-- AUZslab Payroll v2: core engine. Permissions and guard, helpers, the salary formula engine, daily attendance,
-- leave ledger and accrual, and the statutory rules (seeded, versioned, with their sources) plus PF / ESI / PT / TDS
-- calculations. The payroll run itself (items, state machine, payments, accounting) is db/071.
-- =========================================================

-- ---------- permissions ----------
-- Keys: pay_view pay_people pay_time pay_salary pay_run pay_approve pay_pay pay_reports pay_admin pay_audit
-- owner: everything. manager (default role): people, time, non-salary reports; salaries and payroll only when the owner
-- switches on Settings > Access > "Managers handle salaries". A custom role (profiles.role_id -> roles.permissions) is
-- honoured exactly: a missing key means no access. Employees reach their own data through pay_me_* (db/072), not these.
create function pay_perm(k text) returns boolean language plpgsql stable security definer set search_path = public as $$
declare r text; rid uuid; perms jsonb; tid uuid; ms boolean;
begin
  r := me()->>'role'; tid := (me()->>'tenant_id')::uuid;
  if r is null or tid is null then return false; end if;
  if r = 'owner' then return true; end if;
  select role_id into rid from profiles where id = app_uid();
  if rid is not null then
    select permissions into perms from roles where id = rid and tenant_id = tid;
    return coalesce((perms->>k)::boolean, false);
  end if;
  if r = 'manager' then
    if k in ('pay_view', 'pay_people', 'pay_time', 'pay_reports') then return true; end if;
    select coalesce((settings->'access'->>'manager_salary')::boolean, false) into ms from pay_org where tenant_id = tid;
    return coalesce(ms, false) and k in ('pay_salary', 'pay_run', 'pay_approve', 'pay_pay');
  end if;
  return false;
end $$;

create function pay_perms() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_object_agg(k, pay_perm(k)) from unnest(array['pay_view','pay_people','pay_time','pay_salary','pay_run','pay_approve','pay_pay','pay_reports','pay_admin','pay_audit']) k
$$;

-- Entitled to 'payroll', not switched off by the owner, and (when k is given) the role allows k. Returns the tenant id.
create function pay_tenant() returns uuid language plpgsql stable security definer set search_path = public as $$
declare tid uuid; f jsonb; e jsonb;
begin
  if me() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  tid := (me()->>'tenant_id')::uuid;
  if tid is null then raise exception 'not a tenant member'; end if;
  select features, enabled_features into f, e from tenant_settings where tenant_id = tid;
  if coalesce(f->>'payroll', 'false') <> 'true' or coalesce(e->>'payroll', 'true') = 'false' then
    raise exception 'Payroll is not enabled for this business' using errcode = 'PY001';
  end if;
  return tid;
end $$;

create function pay_guard(k text default 'pay_view') returns uuid language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := pay_tenant();
  if k is not null and not pay_perm(k) then raise exception 'Your role does not allow this (%)', k using errcode = '42501'; end if;
  return tid;
end $$;

-- the employee record linked to the signed-in login (self-service), or null
create function pay_my_emp() returns text language sql stable security definer set search_path = public as $$
  select id from pay_employees where tenant_id = (me()->>'tenant_id')::uuid and user_id = app_uid() limit 1
$$;

-- Is the signed-in person the reporting manager of this employee (team approvals)? Line managers see their team's
-- time and leave, never pay.
create function pay_is_manager_of(emp text) returns boolean language plpgsql stable security definer set search_path = public as $$
declare mine text; j pay_jobs;
begin
  mine := pay_my_emp(); if mine is null then return false; end if;
  select * into j from pay_jobs where employee_id = emp and eff_from <= current_date order by eff_from desc limit 1;
  if j.id is null then select * into j from pay_jobs where employee_id = emp order by eff_from limit 1; end if;
  return j.manager_id = mine;
end $$;

-- ---------- small helpers ----------
create function pay_audit_log(tid uuid, act text, ent text, eid text, emp text, b jsonb, a jsonb, why text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into pay_audit (tenant_id, actor, actor_email, actor_role, action, entity, entity_id, employee_id, before, after, reason)
  values (tid, app_uid(), (select email from auth_users where id = app_uid()), me()->>'role', act, ent, eid, emp, b, a, why);
end $$;

create function pay_next_no(tid uuid, k text) returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into pay_series (tenant_id, key, next_no) values (tid, k, 2)
  on conflict (tenant_id, key) do update set next_no = pay_series.next_no + 1 returning next_no - 1 into n;
  return n;
end $$;

create function pay_org_row(tid uuid) returns pay_org language plpgsql security definer set search_path = public as $$
declare o pay_org; t tenants; st text;
begin
  select * into o from pay_org where tenant_id = tid;
  if o.tenant_id is null then
    select * into t from tenants where id = tid;
    begin select state_code into st from acc_org where tenant_id = tid; exception when undefined_table then st := null; end;
    insert into pay_org (tenant_id, legal_name, display_name, state_code, settings)
    values (tid, t.name, t.name, st, jsonb_build_object('pf', jsonb_build_object('enabled', false), 'esi', jsonb_build_object('enabled', false),
      'pt', jsonb_build_object('enabled', st is not null), 'tds', jsonb_build_object('enabled', true)))
    on conflict (tenant_id) do nothing;
    select * into o from pay_org where tenant_id = tid;
  end if;
  return o;
end $$;

-- a setting with its default: pay_cfg(org.settings, 'att', 'late_grace', '15')
create function pay_cfg(s jsonb, grp text, k text, def text) returns text language sql immutable as $$
  select coalesce(s->grp->>k, def)
$$;

create function pay_tz(tid uuid) returns text language sql stable security definer set search_path = public as $$
  select coalesce((select timezone from pay_org where tenant_id = tid), 'Asia/Kolkata')
$$;
create function pay_today(tid uuid) returns date language sql stable security definer set search_path = public as $$
  select (now() at time zone pay_tz(tid))::date
$$;

create function pay_month_from(m text) returns date language sql immutable as $$ select (m || '-01')::date $$;
create function pay_month_to(m text) returns date language sql immutable as $$ select ((m || '-01')::date + interval '1 month' - interval '1 day')::date $$;
create function pay_month_of(d date) returns text language sql immutable as $$ select to_char(d, 'YYYY-MM') $$;
create function pay_month_add(m text, n int) returns text language sql immutable as $$ select to_char((m || '-01')::date + make_interval(months => n), 'YYYY-MM') $$;

-- financial year (April..March by default) containing d
create function pay_fy_start(tid uuid, d date) returns date language sql stable security definer set search_path = public as $$
  select make_date(case when extract(month from d) >= sm then extract(year from d)::int else extract(year from d)::int - 1 end, sm, 1)
  from (select coalesce((select fy_start_month from pay_org where tenant_id = tid), 4) sm) x
$$;
create function pay_fy_label(s date) returns text language sql immutable as $$
  select to_char(s, 'YYYY') || '-' || to_char((s + interval '1 year')::date, 'YY')
$$;

create function pay_mask(s text, keep int default 4) returns text language sql immutable as $$
  select case when s is null or s = '' then null when length(s) <= keep then s else repeat('•', least(length(s) - keep, 6)) || right(s, keep) end
$$;

create function pay_job_at(emp text, d date) returns pay_jobs language sql stable security definer set search_path = public as $$
  select * from (
    (select * from pay_jobs where employee_id = emp and eff_from <= d order by eff_from desc limit 1)
    union all
    (select * from pay_jobs where employee_id = emp order by eff_from limit 1)) x limit 1
$$;

create function pay_salary_at(emp text, d date) returns pay_salaries language sql stable security definer set search_path = public as $$
  select * from pay_salaries where employee_id = emp and eff_from <= d order by eff_from desc limit 1
$$;

create function pay_weekly_off(tid uuid, emp text, d date) returns int[] language sql stable security definer set search_path = public as $$
  select coalesce((pay_job_at(emp, d)).weekly_off, (select weekly_off from pay_org where tenant_id = tid), '{0}')
$$;

create function pay_holiday(tid uuid, emp text, d date) returns text language sql stable security definer set search_path = public as $$
  select name from pay_holidays h where h.tenant_id = tid and h.hdate = d
    and (h.location_id is null or h.location_id = (pay_job_at(emp, d)).location_id) limit 1
$$;

-- the state whose professional tax applies: the work location's, else the organisation's
create function pay_emp_state(tid uuid, emp text, d date) returns text language sql stable security definer set search_path = public as $$
  select coalesce((select l.state_code from pay_locations l where l.id = (pay_job_at(emp, d)).location_id), (select state_code from pay_org where tenant_id = tid))
$$;

-- ---------- statutory rules ----------
-- The rule in force on d: a business's own rule wins over the AUZslab-maintained one for the same scheme and region.
create function pay_rule(tid uuid, p_scheme text, p_region text, d date) returns jsonb language sql stable security definer set search_path = public as $$
  select r.params || jsonb_build_object('_id', r.id, '_source', r.source, '_from', r.eff_from, '_to', r.eff_to, '_verified', r.verified_on, '_own', r.tenant_id is not null)
  from pay_stat_rules r
  where r.scheme = p_scheme and r.region = p_region and r.eff_from <= d and (r.eff_to is null or r.eff_to >= d)
    and (r.tenant_id = tid or r.tenant_id is null)
  order by (r.tenant_id is not null) desc, r.eff_from desc limit 1
$$;

-- Seeded rules. Values were checked against the sources named in `source` on verified_on; anything changes by a new row
-- with a new eff_from (the old row gets an eff_to), never by editing an old one in place.
insert into pay_stat_rules (scheme, region, eff_from, eff_to, params, source, verified_on, note) values
 ('PF', 'IN', '2014-09-01', '2026-09-16',
  '{"ceiling":15000,"ee_pct":12,"er_pct":12,"eps_pct":8.33,"edli_pct":0.5,"admin_pct":0.5,"eps_age_limit":58,"wage_rule":"basic_da"}',
  'EPF & MP Act 1952; EPF Scheme 1952 para 26A (wage ceiling Rs 15,000 from 1 Sep 2014); EPS 1995 (8.33%); EDLI 1976 (0.5%); administrative charges 0.5% from 1 Jun 2018',
  '2026-10-02', 'Contributions are rounded to the nearest rupee.'),
 ('PF', 'IN', '2026-09-17', null,
  '{"ceiling":25000,"ee_pct":12,"er_pct":12,"eps_pct":8.33,"edli_pct":0.5,"admin_pct":0.5,"eps_age_limit":58,"wage_rule":"code_50"}',
  'Code on Social Security 2020; notification S.O. 5109(E) raising the PF/EPS/EDLI wage ceiling to Rs 25,000 from 17 Sep 2026; wages as defined in the Code on Wages 2019 s.2(y) (basic + DA + retaining allowance, with allowances above half of total pay added back)',
  '2026-10-02', 'A month that straddles 17 Sep 2026 uses a day-weighted ceiling. Check the latest EPFO circular before filing.'),
 ('ESI', 'IN', '2019-07-01', null,
  '{"ceiling":21000,"pwd_ceiling":25000,"ee_pct":0.75,"er_pct":3.25,"ee_exempt_daily":176,"round":"up","periods":[4,10]}',
  'ESI Act 1948; ESI (Central) Rules 1950 r.51 (0.75% employee, 3.25% employer from 1 Jul 2019); wage ceiling Rs 21,000 (Rs 25,000 for persons with disability)',
  '2026-10-02', 'Coverage is decided at the start of each contribution period (April-September, October-March) and lasts the whole period.'),
 ('PT', '27', '2023-07-01', null,
  '{"period":"monthly","slabs":[{"upto":7500,"amt":0},{"upto":10000,"amt":175},{"upto":null,"amt":200,"feb":300}],"female":[{"upto":25000,"amt":0},{"upto":null,"amt":200,"feb":300}],"annual_cap":2500}',
  'Maharashtra State Tax on Professions, Trades, Callings and Employments Act 1975, Schedule I entry 1 (women up to Rs 25,000 exempt from 1 Jul 2023)', '2026-10-02', null),
 ('PT', '29', '2025-04-01', null,
  '{"period":"monthly","slabs":[{"upto":24999.99,"amt":0},{"upto":null,"amt":200,"feb":300}],"annual_cap":2500}',
  'Karnataka Tax on Professions, Trades, Callings and Employments Act 1976 as amended in 2025 (nil below Rs 25,000; Rs 300 in February)', '2026-10-02', null),
 ('PT', '19', '2020-04-01', null,
  '{"period":"monthly","slabs":[{"upto":10000,"amt":0},{"upto":15000,"amt":110},{"upto":25000,"amt":130},{"upto":40000,"amt":150},{"upto":null,"amt":200}],"annual_cap":2500}',
  'West Bengal State Tax on Professions, Trades, Callings and Employments Act 1979, Schedule', '2026-10-02', null),
 ('PT', '36', '2020-04-01', null,
  '{"period":"monthly","slabs":[{"upto":15000,"amt":0},{"upto":20000,"amt":150},{"upto":null,"amt":200}],"annual_cap":2500}',
  'Telangana Tax on Professions, Trades, Callings and Employments Act 1987, Schedule', '2026-10-02', null),
 ('PT', '37', '2020-04-01', null,
  '{"period":"monthly","slabs":[{"upto":15000,"amt":0},{"upto":20000,"amt":150},{"upto":null,"amt":200}],"annual_cap":2500}',
  'Andhra Pradesh Tax on Professions, Trades, Callings and Employments Act 1987, Schedule', '2026-10-02', null),
 ('PT', '24', '2020-04-01', null,
  '{"period":"monthly","slabs":[{"upto":11999.99,"amt":0},{"upto":null,"amt":200}],"annual_cap":2500}',
  'Gujarat State Tax on Professions, Traders, Callings and Employments Act 1976, Schedule (nil below Rs 12,000)', '2026-10-02', null),
 ('PT', '33', '2020-04-01', null,
  '{"period":"half_yearly","deduct_months":[9,3],"slabs":[{"upto":21000,"amt":0},{"upto":30000,"amt":180},{"upto":45000,"amt":425},{"upto":60000,"amt":930},{"upto":75000,"amt":1025},{"upto":null,"amt":1250}],"annual_cap":2500}',
  'Tamil Nadu Urban Local Bodies Act 1998 s.198 / Greater Chennai Corporation half-yearly professional tax slabs', '2026-10-02',
  'Rates differ by local body; these are Greater Chennai''s. Deducted in September and March on the half-year''s salary.'),
 ('TDS', 'new', '2025-04-01', null,
  '{"std_deduction":75000,"slabs":[{"upto":400000,"rate":0},{"upto":800000,"rate":5},{"upto":1200000,"rate":10},{"upto":1600000,"rate":15},{"upto":2000000,"rate":20},{"upto":2400000,"rate":25},{"upto":null,"rate":30}],"rebate":{"limit":1200000,"max":60000,"marginal":true},"surcharge":[{"over":5000000,"rate":10},{"over":10000000,"rate":15},{"over":20000000,"rate":25}],"cess_pct":4,"round_income":10}',
  'Finance Act 2025 (new regime slabs, standard deduction Rs 75,000, rebate up to Rs 60,000 for income up to Rs 12 lakh), carried into the Income-tax Act 2025 for tax year 2026-27',
  '2026-10-02', null),
 ('TDS', 'old', '2025-04-01', null,
  '{"std_deduction":50000,"slabs":[{"upto":250000,"rate":0},{"upto":500000,"rate":5},{"upto":1000000,"rate":20},{"upto":null,"rate":30}],"rebate":{"limit":500000,"max":12500,"marginal":false},"surcharge":[{"over":5000000,"rate":10},{"over":10000000,"rate":15},{"over":20000000,"rate":25},{"over":50000000,"rate":37}],"cess_pct":4,"round_income":10,"caps":{"sec80c":150000,"sec80d":100000,"sec80ccd1b":50000,"home_loan_interest":200000},"hra_metro_pct":50,"hra_other_pct":40,"pt_deductible":true}',
  'Income-tax: old regime slabs and deductions (Chapter VI-A 80C Rs 1.5 lakh, 80CCD(1B) Rs 50,000; house property interest Rs 2 lakh; HRA rule 2A), unchanged by Finance Act 2025',
  '2026-10-02', null),
 ('GRATUITY', 'IN', '2018-03-29', null,
  '{"min_years":5,"fixed_term_min_years":1,"days":15,"divisor":26,"cap":2000000,"round_up_months":6,"exempt_cap":2000000}',
  'Payment of Gratuity Act 1972 s.4 (15 days'' wages per completed year, 26-day month); ceiling Rs 20 lakh (S.O. 1420(E)); Code on Social Security 2020 s.53 (fixed-term employees after one year)',
  null, 'Not re-checked in October 2026: confirm the rules with your advisor before paying a large gratuity.'),
 ('BONUS', 'IN', '2016-01-01', null,
  '{"eligibility_wage":21000,"calc_ceiling":7000,"min_pct":8.33,"max_pct":20,"min_days":30}',
  'Payment of Bonus Act 1965 ss.2(13), 8, 10, 11, 12 (eligible up to Rs 21,000 a month; calculated on Rs 7,000 or the minimum wage if higher; 8.33% to 20%)',
  null, 'Not re-checked in October 2026. If your state''s minimum wage is above Rs 7,000, enter it as the calculation ceiling.');

-- ---------- formula engine ----------
create function pay_if(c boolean, a numeric, b numeric) returns numeric language sql immutable as $$ select case when c then a else b end $$;
create function pay_fround(x numeric, n numeric default 0) returns numeric language sql immutable as $$ select round(x, n::int) $$;

-- Turns a formula into SQL over numeric literals only. Only numbers, the names in `vars`, + - * / ( ) and comparisons,
-- and/or/not and the functions if/min/max/round/floor/ceil/abs get through; anything else is refused, so nothing a user
-- types can ever reach SQL as code.
create function pay_formula_sql(f text, vars jsonb) returns text language plpgsql immutable as $$
declare s text := coalesce(f, ''); i int := 1; n int; o text := ''; c text; tok text; m text[]; up text; v jsonb; depth int := 0;
begin
  if btrim(s) = '' then raise exception 'The formula is empty' using errcode = 'PY010'; end if;
  if length(s) > 500 then raise exception 'The formula is too long' using errcode = 'PY010'; end if;
  n := length(s);
  while i <= n loop
    c := substr(s, i, 1);
    if c ~ '\s' then i := i + 1; continue; end if;
    m := regexp_match(substr(s, i), '^(\d+(\.\d+)?|\.\d+)');
    if m is not null then o := o || ' ' || m[1]; i := i + length(m[1]); continue; end if;
    m := regexp_match(substr(s, i), '^([A-Za-z_][A-Za-z0-9_]*)');
    if m is not null then
      tok := m[1]; up := upper(tok); i := i + length(tok);
      if up in ('AND', 'OR', 'NOT') then o := o || ' ' || up;
      elsif up in ('TRUE', 'FALSE') then o := o || ' ' || lower(up);
      elsif up in ('IF', 'MIN', 'MAX', 'ROUND', 'FLOOR', 'CEIL', 'ABS') then
        if substr(ltrim(substr(s, i)), 1, 1) <> '(' then raise exception 'Use % with brackets, like %(...)', lower(up), lower(up) using errcode = 'PY010'; end if;
        o := o || ' ' || case up when 'IF' then 'pay_if' when 'MIN' then 'least' when 'MAX' then 'greatest' when 'ROUND' then 'pay_fround' when 'FLOOR' then 'floor' when 'CEIL' then 'ceil' else 'abs' end;
      else
        v := vars -> up;
        if v is null then raise exception 'Unknown name "%" in the formula', tok using errcode = 'PY010'; end if;
        if jsonb_typeof(v) <> 'number' then raise exception '"%" has no value yet', up using errcode = 'PY010'; end if;
        o := o || ' (' || (v #>> '{}') || ')::numeric';
      end if;
      continue;
    end if;
    m := regexp_match(substr(s, i), '^(<=|>=|<>|!=|==|&&|\|\||[-+*/(),<>=])');
    if m is not null then
      tok := m[1]; i := i + length(tok);
      if tok = '(' then depth := depth + 1; elsif tok = ')' then depth := depth - 1; end if;
      if depth < 0 then raise exception 'A closing bracket has no opening bracket' using errcode = 'PY010'; end if;
      o := o || ' ' || case tok when '==' then '=' when '!=' then '<>' when '&&' then 'and' when '||' then 'or' else tok end;
      continue;
    end if;
    raise exception 'The formula has a character it cannot use: "%"', c using errcode = 'PY010';
  end loop;
  if depth <> 0 then raise exception 'The brackets in the formula do not match' using errcode = 'PY010'; end if;
  return o;
end $$;

-- names (upper case) a formula refers to, other than keywords and functions
create function pay_formula_names(f text) returns text[] language sql immutable as $$
  select coalesce(array_agg(distinct upper(m[1])) filter (where upper(m[1]) not in ('AND','OR','NOT','TRUE','FALSE','IF','MIN','MAX','ROUND','FLOOR','CEIL','ABS')), '{}')
  from regexp_matches(coalesce(f, ''), '([A-Za-z_][A-Za-z0-9_]*)', 'g') m
$$;

create function pay_formula_eval(f text, vars jsonb) returns numeric language plpgsql stable as $$
declare q text; r numeric;
begin
  q := pay_formula_sql(f, vars);
  begin
    execute 'select (' || q || ')::numeric' into r;
  exception
    when division_by_zero then raise exception 'The formula "%" divides by zero', f using errcode = 'PY011';
    when others then raise exception 'The formula "%" could not be worked out (%)', f, sqlerrm using errcode = 'PY011';
  end;
  return coalesce(r, 0);
end $$;

-- Works out a salary structure for one amount, full month. Lines: [{code, calc: fixed|formula|balance, value, formula}].
-- ctx adds variables (PF_CEILING, DAYS, PAID_DAYS, ...). Overrides {CODE: amount} replace a line's rule.
-- Returns {lines: {CODE: amount}, kinds: {CODE: kind}, order: [codes], gross, deductions, employer, ctc, basis, amount}.
create function pay_structure_eval(tid uuid, p_lines jsonb, p_basis text, p_amount numeric, p_overrides jsonb, ctx jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  vars jsonb := coalesce(ctx, '{}'); l jsonb; codes text[] := '{}'; deps jsonb := '{}'; done text[] := '{}'; ord text[] := '{}';
  bal text; k text; comp pay_components; kinds jsonb := '{}'; out jsonb := '{}'; amt numeric; progress boolean; nm text;
  gross numeric := 0; ded numeric := 0; emp numeric := 0; target numeric; others numeric := 0; f text;
begin
  p_overrides := coalesce(p_overrides, '{}');
  if p_basis = 'ctc' then vars := vars || jsonb_build_object('CTC_ANNUAL', p_amount, 'CTC', round(p_amount / 12, 2));
  else vars := vars || jsonb_build_object('GROSS', p_amount); end if;
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]')) loop
    k := upper(l->>'code');
    if k = any(codes) then raise exception 'Component % appears twice in the structure', k; end if;
    select * into comp from pay_components where tenant_id = tid and code = k;
    if comp.id is null then raise exception 'Unknown salary component %', k; end if;
    codes := codes || k;
    kinds := kinds || jsonb_build_object(k, comp.kind);
    if p_overrides ? k then deps := deps || jsonb_build_object(k, '[]'::jsonb);
    elsif l->>'calc' = 'balance' then
      if bal is not null then raise exception 'Only one component can take the balance (% and %)', bal, k; end if;
      if comp.kind not in ('earning', 'reimbursement') then raise exception 'The balancing component must be an earning'; end if;
      bal := k; deps := deps || jsonb_build_object(k, '[]'::jsonb);
    elsif l->>'calc' = 'formula' then deps := deps || jsonb_build_object(k, to_jsonb(pay_formula_names(l->>'formula')));
    else deps := deps || jsonb_build_object(k, '[]'::jsonb); end if;
  end loop;
  -- formulas may refer to other components and to the variables, but not to the balancing component
  foreach k in array codes loop
    for nm in select jsonb_array_elements_text(deps->k) loop
      if nm = bal then raise exception '% uses %, which is the balancing component; it can only be worked out last', k, bal; end if;
      if not (nm = any(codes)) and not (vars ? nm) then
        raise exception 'Unknown name "%" in the formula for %', nm, k using errcode = 'PY010';
      end if;
    end loop;
  end loop;
  -- dependency order (Kahn): a loop is an error that names the components involved
  loop
    progress := false;
    foreach k in array codes loop
      if k = any(done) or k = bal then continue; end if;
      if not exists (select 1 from jsonb_array_elements_text(deps->k) d where d = any(codes) and not (d = any(done))) then
        done := done || k; ord := ord || k; progress := true;
      end if;
    end loop;
    exit when not progress;
  end loop;
  if exists (select 1 from unnest(codes) c where c <> coalesce(bal, '') and not (c = any(done))) then
    raise exception 'These components depend on each other in a loop: %', (select string_agg(c, ', ') from unnest(codes) c where c <> coalesce(bal, '') and not (c = any(done)));
  end if;
  foreach k in array ord loop
    select x into l from jsonb_array_elements(p_lines) x where upper(x->>'code') = k;
    if p_overrides ? k then amt := (p_overrides->>k)::numeric;
    elsif l->>'calc' = 'formula' then f := l->>'formula'; amt := pay_formula_eval(f, vars);
    else amt := coalesce((l->>'value')::numeric, 0); end if;
    amt := greatest(round(amt, 2), 0);
    out := out || jsonb_build_object(k, amt);
    vars := vars || jsonb_build_object(k, amt);
  end loop;
  -- the balancing component takes whatever is left of the total
  if bal is not null then
    target := case when p_basis = 'ctc' then round(p_amount / 12, 2) else p_amount end;
    foreach k in array ord loop
      if (kinds->>k) in ('earning', 'reimbursement') or (p_basis = 'ctc' and (kinds->>k) = 'employer') then others := others + (out->>k)::numeric; end if;
    end loop;
    amt := round(target - others, 2);
    if amt < 0 then raise exception 'The salary is too low for this structure: its fixed parts add up to more than the total (short by %)', -amt using errcode = 'PY012'; end if;
    out := out || jsonb_build_object(bal, amt); ord := ord || bal;
  end if;
  foreach k in array ord loop
    case kinds->>k
      when 'earning' then gross := gross + (out->>k)::numeric;
      when 'reimbursement' then gross := gross + (out->>k)::numeric;
      when 'deduction' then ded := ded + (out->>k)::numeric;
      else emp := emp + (out->>k)::numeric;
    end case;
  end loop;
  return jsonb_build_object('lines', out, 'kinds', kinds, 'order', to_jsonb(ord), 'gross', gross, 'deductions', ded, 'employer', emp,
    'ctc', gross + emp, 'basis', p_basis, 'amount', p_amount);
end $$;

-- full-month variables a structure may use when it is saved (no attendance yet)
create function pay_struct_ctx(tid uuid, d date) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'PF_CEILING', coalesce((pay_rule(tid, 'PF', 'IN', d)->>'ceiling')::numeric, 15000),
    'ESI_CEILING', coalesce((pay_rule(tid, 'ESI', 'IN', d)->>'ceiling')::numeric, 21000),
    'DAYS', extract(day from (date_trunc('month', d) + interval '1 month - 1 day'))::numeric,
    'PAID_DAYS', extract(day from (date_trunc('month', d) + interval '1 month - 1 day'))::numeric,
    'LOP_DAYS', 0, 'OT_HOURS', 0, 'WORK_DAYS', 26, 'YEARS', 0)
$$;

create function pay_salary_breakup(tid uuid, s pay_salaries, ctx jsonb default null) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare st pay_structures;
begin
  select * into st from pay_structures where id = s.structure_id and tenant_id = tid;
  if st.id is null then raise exception 'Salary structure not found'; end if;
  return pay_structure_eval(tid, st.lines, st.basis, s.amount, s.overrides, coalesce(ctx, pay_struct_ctx(tid, s.eff_from)));
end $$;

-- ---------- attendance ----------
create function pay_att_mode(e pay_employees) returns text language sql stable security definer set search_path = public as $$
  select coalesce(e.attendance_mode, (select attendance_mode from pay_org where tenant_id = e.tenant_id), 'manual')
$$;

-- the shift for an employee on a date: roster first, then their job
create function pay_shift_on(emp text, d date) returns pay_shifts language sql stable security definer set search_path = public as $$
  select s.* from pay_shifts s where s.id = coalesce((select r.shift_id from pay_roster r where r.employee_id = emp and r.att_date = d and not r.off), (pay_job_at(emp, d)).shift_id)
$$;

-- minutes in a shift, without the break
create function pay_shift_mins(s pay_shifts) returns int language sql immutable as $$
  select (extract(epoch from (s.end_time - s.start_time)) / 60)::int + case when s.overnight or s.end_time <= s.start_time then 1440 else 0 end - coalesce(s.break_mins, 0)
$$;

-- Works out one employee's day from their punches, marks, leave, shift and calendar, and stores it. A day locked by a
-- finalised payroll is left alone. Returns the status.
create function pay_att_compute(tid uuid, emp text, d date) returns text language plpgsql security definer set search_path = public as $$
declare
  e pay_employees; o pay_org; tz text; td date; mode text; sh pay_shifts; ov pay_att_overrides; lr record; ex pay_attendance;
  ws timestamptz; p record; st text := 'out'; cur_in timestamptz; first_in timestamptz; last_out timestamptz; worked numeric := 0; npunch int := 0;
  stat text; paid numeric := 0; lop numeric := 0; ldays numeric := 0; ltype uuid; lpaid boolean; late int := 0; ot int := 0; flags text[] := '{}';
  src text := 'auto'; offday boolean; hol text; dmins int; half_pct int; grace int; sched timestamptz; missing boolean := false;
  holiday_work text; ot_on boolean; ot_min int; miss text; no_shift_present boolean;
begin
  select * into e from pay_employees where id = emp and tenant_id = tid;
  if e.id is null then return null; end if;
  select * into ex from pay_attendance where employee_id = emp and att_date = d;
  if ex.locked_run is not null then return ex.status; end if;
  if d < e.joined_on or (e.last_day is not null and d > e.last_day) or e.status = 'onboarding' then
    delete from pay_attendance where employee_id = emp and att_date = d;
    return null;
  end if;
  o := pay_org_row(tid); tz := o.timezone; td := (now() at time zone tz)::date;
  mode := pay_att_mode(e);
  sh := pay_shift_on(emp, d);
  grace := coalesce(sh.grace_mins, pay_cfg(o.settings, 'att', 'late_grace', '15')::int);
  half_pct := coalesce(sh.half_pct, pay_cfg(o.settings, 'att', 'half_pct', '55')::int);
  holiday_work := pay_cfg(o.settings, 'att', 'holiday_work', 'ot');
  ot_on := pay_cfg(o.settings, 'att', 'ot', 'true')::boolean;
  ot_min := pay_cfg(o.settings, 'att', 'ot_min', '0')::int;
  miss := pay_cfg(o.settings, 'att', 'missing_out', 'present');
  -- the old Payroll counted any worked day without a shift as a full day; kept unless the owner sets a minimum
  no_shift_present := pay_cfg(o.settings, 'att', 'noshift_full', 'true')::boolean;
  offday := exists (select 1 from pay_roster r where r.employee_id = emp and r.att_date = d and r.off)
         or (not exists (select 1 from pay_roster r where r.employee_id = emp and r.att_date = d and r.shift_id is not null)
             and extract(dow from d)::int = any(pay_weekly_off(tid, emp, d)));
  hol := pay_holiday(tid, emp, d);

  -- approved leave covering the day
  select q.id, q.leave_type_id, q.half, t.paid into lr from pay_leave_requests q join pay_leave_types t on t.id = q.leave_type_id
    where q.employee_id = emp and q.status = 'approved' and d between q.from_date and q.to_date order by q.created_at desc limit 1;
  if lr.id is not null and (lr.half <> 'none' or not ((offday or hol is not null) and not exists (select 1 from pay_leave_types t where t.id = lr.leave_type_id and t.count_offdays))) then
    ltype := lr.leave_type_id; lpaid := lr.paid; ldays := case when lr.half = 'none' then 1 else 0.5 end;
  end if;

  -- latest manual mark or approved correction
  select * into ov from pay_att_overrides where employee_id = emp and att_date = d order by created_at desc, id desc limit 1;
  if ov.id is not null and ov.status = 'auto' then ov := null; end if;

  dmins := case when sh.id is not null then pay_shift_mins(sh) else pay_cfg(o.settings, 'att', 'day_mins', '480')::int end;
  -- punches belong to the day whose window holds them: from 6 hours before the shift starts (04:00 without a shift) for 24 hours
  ws := ((d::timestamp + coalesce(sh.start_time, time '10:00') - interval '6 hours') at time zone tz);
  if ov.id is not null and ov.status is null and ov.in_at is not null then
    first_in := ov.in_at; last_out := ov.out_at; npunch := case when ov.out_at is null then 1 else 2 end;
    if ov.out_at is not null then worked := extract(epoch from (ov.out_at - ov.in_at)) / 60; else missing := true; end if;
    src := ov.source;
  else
    for p in select at, kind from pay_punches where employee_id = emp and voided_at is null and at >= ws and at < ws + interval '1 day' order by at loop
      npunch := npunch + 1;
      if p.kind = 'in' or (p.kind = 'auto' and st = 'out') then
        if st = 'out' then cur_in := p.at; st := 'in'; first_in := coalesce(first_in, p.at); end if;
      else
        if st = 'in' then worked := worked + extract(epoch from (p.at - cur_in)) / 60; st := 'out'; last_out := p.at;
        elsif last_out is not null then worked := worked + extract(epoch from (p.at - last_out)) / 60; last_out := p.at;
        else last_out := p.at; flags := array_append(flags, 'missing_in'); end if;
      end if;
    end loop;
    if st = 'in' then missing := true; end if;
    if npunch > 0 then src := 'punch'; end if;
    if exists (select 1 from pay_punches where employee_id = emp and voided_at is null and at >= ws and at < ws + interval '1 day' and out_of_range) then flags := array_append(flags, 'out_of_range'); end if;
  end if;
  if ov.id is not null and ov.status is not null then
    -- a manual mark decides the day
    stat := ov.status; src := ov.source;
    paid := case ov.status when 'absent' then 0 when 'half' then 0.5 else 1 end;
    lop := 1 - paid;
    if ov.status = 'half' and ltype is not null then stat := 'half_leave'; paid := 0.5 + case when lpaid then 0.5 else 0 end; lop := 1 - paid; end if;
    if ov.status = 'absent' and ltype is not null and ldays = 1 then stat := 'leave'; paid := case when lpaid then 1 else 0 end; lop := 1 - paid; end if;
  elsif (offday or hol is not null) and ltype is null then
    if npunch > 0 and worked > 0 then
      stat := 'present'; paid := 1; flags := array_append(flags, 'worked_off_day');
      if holiday_work = 'ot' and ot_on then ot := worked::int;
      elsif ot_on and sh.id is not null and worked > dmins and (worked - dmins) >= ot_min then ot := (worked - dmins)::int; end if;
    else stat := case when hol is not null then 'holiday' else 'weekly_off' end; paid := 1; src := 'calendar'; end if;
  elsif ltype is not null and ldays = 1 then
    stat := 'leave'; paid := case when lpaid then 1 else 0 end; lop := 1 - paid; src := 'leave';
  elsif npunch = 0 and mode in ('manual', 'none') then
    if ltype is not null then stat := 'half_leave'; paid := 0.5 + case when lpaid then 0.5 else 0 end; lop := 1 - paid;
    else stat := 'present'; paid := 1; flags := array_append(flags, 'assumed'); src := 'assumed'; end if;
  elsif npunch = 0 then
    if d >= td then stat := 'upcoming'; paid := 1; flags := array_append(flags, 'projected');
    elsif ltype is not null then stat := 'half_leave'; paid := case when lpaid then 0.5 else 0 end; lop := 1 - paid;
    else stat := 'absent'; paid := 0; lop := 1; end if;
  else
    if missing then
      if d >= td then stat := 'present'; paid := 1; flags := array_append(flags, 'on_shift');
      else
        flags := array_append(flags, 'missing_out');
        stat := case miss when 'half' then 'half' when 'absent' then 'absent' else 'missing' end;
        paid := case miss when 'half' then 0.5 when 'absent' then 0 else 1 end; lop := 1 - paid;
      end if;
    elsif sh.id is null and no_shift_present then stat := 'present'; paid := 1;
    elsif worked < dmins * half_pct / 100.0 then stat := 'half'; paid := 0.5; lop := 0.5;
    else stat := 'present'; paid := 1; end if;
    if sh.id is not null and first_in is not null then
      sched := ((d::timestamp + sh.start_time) at time zone tz);
      if first_in > sched + make_interval(mins => grace) then
        late := (extract(epoch from (first_in - sched)) / 60)::int;
        if stat = 'present' then stat := 'late'; end if;
      end if;
    end if;
    if ot_on and not missing and worked > dmins and (worked - dmins) >= ot_min and (sh.id is not null or pay_cfg(o.settings, 'att', 'ot_noshift', 'false')::boolean) then
      ot := (worked - dmins)::int;
    end if;
    if ltype is not null and stat in ('half', 'present', 'late', 'missing') then
      -- half a day's leave plus work on the other half
      stat := 'half_leave'; paid := 0.5 + case when lpaid then 0.5 else 0 end; lop := 1 - paid;
    end if;
  end if;
  if ov.source = 'regularization' then flags := array_append(flags, 'regularized'); elsif ov.id is not null then flags := array_append(flags, 'manual'); end if;

  insert into pay_attendance (tenant_id, employee_id, att_date, status, paid, lop, leave_days, leave_type_id, leave_paid, shift_id, first_in, last_out,
    worked_mins, late_mins, ot_mins, flags, source, computed_at)
  values (tid, emp, d, stat, paid, lop, ldays, ltype, lpaid, sh.id, first_in, last_out, greatest(worked, 0)::int, late, ot, flags, src, now())
  on conflict (employee_id, att_date) do update set status = excluded.status, paid = excluded.paid, lop = excluded.lop, leave_days = excluded.leave_days,
    leave_type_id = excluded.leave_type_id, leave_paid = excluded.leave_paid, shift_id = excluded.shift_id, first_in = excluded.first_in, last_out = excluded.last_out,
    worked_mins = excluded.worked_mins, late_mins = excluded.late_mins, ot_mins = excluded.ot_mins, flags = excluded.flags, source = excluded.source, computed_at = now()
    where pay_attendance.locked_run is null;
  return stat;
end $$;

create function pay_att_refresh(tid uuid, emp text, p_from date, p_to date) returns int language plpgsql security definer set search_path = public as $$
declare d date; n int := 0;
begin
  if p_from is null or p_to is null or p_to < p_from then return 0; end if;
  if p_to - p_from > 400 then raise exception 'Attendance can be refreshed for at most 400 days at once'; end if;
  d := p_from;
  while d <= p_to loop perform pay_att_compute(tid, emp, d); n := n + 1; d := d + 1; end loop;
  return n;
end $$;

-- refresh one day (or range) for everyone (after a holiday or shift change)
create function pay_att_refresh_all(tid uuid, p_from date, p_to date) returns int language plpgsql security definer set search_path = public as $$
declare e record; n int := 0;
begin
  for e in select id from pay_employees where tenant_id = tid and (status in ('active', 'notice') or (status = 'exited' and last_day >= p_from)) loop
    n := n + pay_att_refresh(tid, e.id, p_from, least(p_to, pay_today(tid) + 31));
  end loop;
  return n;
end $$;

-- ---------- leave ----------
create function pay_leave_balance(emp text, lt uuid) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(days), 0) from pay_leave_ledger where employee_id = emp and leave_type_id = lt
$$;

-- days a leave would use: weekly offs and holidays inside it are free unless the leave type counts them
create function pay_leave_days(tid uuid, emp text, lt uuid, p_from date, p_to date, p_half text default 'none') returns numeric
language plpgsql stable security definer set search_path = public as $$
declare d date := p_from; n numeric := 0; cnt boolean; offd boolean;
begin
  if p_to < p_from then raise exception 'The leave ends before it starts'; end if;
  if p_to - p_from > 366 then raise exception 'A leave can be at most a year long'; end if;
  select count_offdays into cnt from pay_leave_types where id = lt and tenant_id = tid;
  if coalesce(p_half, 'none') <> 'none' then
    if p_from <> p_to then raise exception 'A half-day leave is for one date'; end if;
    return 0.5;
  end if;
  while d <= p_to loop
    offd := extract(dow from d)::int = any(pay_weekly_off(tid, emp, d)) or pay_holiday(tid, emp, d) is not null;
    if cnt or not offd then n := n + 1; end if;
    d := d + 1;
  end loop;
  return n;
end $$;

-- the leave year (1 January by default) containing d
create function pay_leave_year_start(tid uuid, d date) returns date language sql stable security definer set search_path = public as $$
  select make_date(case when extract(month from d) >= sm then extract(year from d)::int else extract(year from d)::int - 1 end, sm, 1)
  from (select coalesce((select leave_year_start from pay_org where tenant_id = tid), 1) sm) x
$$;

-- Credits leave up to p_upto (yearly at the start of the leave year, or monthly) and lapses what is over the carry-forward
-- limit when a leave year ends. Idempotent: every automatic entry has a period_key.
create function pay_leave_accrue(tid uuid, p_upto date default null) returns int language plpgsql security definer set search_path = public as $$
declare
  o pay_org; e record; t record; upto date; ys date; ye date; m date; amt numeric; n int := 0; start date; bal numeric; months int; k text;
begin
  o := pay_org_row(tid);
  upto := coalesce(p_upto, pay_today(tid));
  for e in select * from pay_employees where tenant_id = tid and status in ('active', 'notice', 'exited') and joined_on <= upto loop
    -- credits start in the leave year of joining or of moving to this Payroll, whichever is later (no years of back credit)
    start := greatest(e.joined_on, pay_leave_year_start(tid, o.created_at::date));
    for t in select * from pay_leave_types where tenant_id = tid and active and accrual <> 'none' and quota > 0 and (gender is null or gender = e.gender) loop
      ys := pay_leave_year_start(tid, start);
      while ys <= upto loop
        ye := (ys + interval '1 year' - interval '1 day')::date;
        if t.accrual = 'yearly' then
          if (e.last_day is null or e.last_day >= ys) and e.joined_on <= ye then
            months := case when e.joined_on > ys then 12 - ((extract(year from e.joined_on) - extract(year from ys)) * 12 + extract(month from e.joined_on) - extract(month from ys))::int else 12 end;
            amt := round(t.quota * months / 12 * 2) / 2;
            if amt > 0 then
              insert into pay_leave_ledger (tenant_id, employee_id, leave_type_id, on_date, kind, days, period_key, note)
              values (tid, e.id, t.id, greatest(ys, e.joined_on), 'credit', amt, 'Y' || to_char(ys, 'YYYY-MM'), 'Yearly credit')
              on conflict do nothing;
              if found then n := n + 1; end if;
            end if;
          end if;
        else
          m := greatest(ys, date_trunc('month', e.joined_on)::date);
          while m <= least(ye, upto) loop
            if e.joined_on <= m + 14 and (e.last_day is null or e.last_day >= m) then
              insert into pay_leave_ledger (tenant_id, employee_id, leave_type_id, on_date, kind, days, period_key, note)
              values (tid, e.id, t.id, greatest(m, e.joined_on), 'credit', round(t.quota / 12, 2), 'M' || to_char(m, 'YYYY-MM'), 'Monthly credit')
              on conflict do nothing;
              if found then n := n + 1; end if;
            end if;
            m := (m + interval '1 month')::date;
          end loop;
        end if;
        -- a finished leave year: lapse whatever is above the carry-forward limit
        if ye < upto and t.carry_max is not null then
          k := 'L' || to_char(ys, 'YYYY-MM');
          if not exists (select 1 from pay_leave_ledger where employee_id = e.id and leave_type_id = t.id and kind = 'lapse' and period_key = k) then
            select coalesce(sum(days), 0) into bal from pay_leave_ledger where employee_id = e.id and leave_type_id = t.id and on_date <= ye;
            if bal > t.carry_max then
              insert into pay_leave_ledger (tenant_id, employee_id, leave_type_id, on_date, kind, days, period_key, note)
              values (tid, e.id, t.id, ye, 'lapse', -(bal - t.carry_max), k, 'Year end: above the carry-forward limit of ' || t.carry_max)
              on conflict do nothing;
              n := n + 1;
            end if;
          end if;
        end if;
        ys := (ys + interval '1 year')::date;
      end loop;
    end loop;
  end loop;
  return n;
end $$;

-- ---------- statutory calculations ----------
-- PF for one month. pf_wage = wages for PF (basic + DA, with the Code on Wages 50% test when the rule says so),
-- gross = total remuneration (for the 50% test). The ceiling is day-weighted when the rule changes inside the period.
-- Returns {ee, epf_er, eps, edli, admin, pf_wage, eps_wage, edli_wage, ceiling, base, note}
create function pay_calc_pf(tid uuid, p_from date, p_to date, p_wage numeric, p_gross numeric, p_on_actual boolean, p_er_on_actual boolean,
                            p_eps boolean, p_age int, p_ncp numeric default 0) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare d date := p_from; r jsonb; days int := 0; csum numeric := 0; ceiling numeric; wage numeric; base numeric; erbase numeric; epsw numeric;
  ee numeric; er numeric; eps numeric; edli numeric; adm numeric; rule jsonb; segs jsonb := '[]'; prev text; excl numeric;
begin
  while d <= p_to loop
    r := pay_rule(tid, 'PF', 'IN', d);
    if r is null then raise exception 'No PF rule covers %', d; end if;
    csum := csum + (r->>'ceiling')::numeric; days := days + 1;
    if prev is distinct from (r->>'_id') then segs := segs || jsonb_build_array(jsonb_build_object('from', d, 'ceiling', (r->>'ceiling')::numeric)); prev := r->>'_id'; end if;
    rule := r; d := d + 1;
  end loop;
  ceiling := round(csum / greatest(days, 1), 2);
  wage := greatest(coalesce(p_wage, 0), 0);
  -- Code on Wages: if what is left out of wages is more than half of the total, the excess counts as wages
  if rule->>'wage_rule' = 'code_50' and coalesce(p_gross, 0) > 0 then
    excl := p_gross - wage;
    if excl > p_gross / 2 then wage := round(wage + (excl - p_gross / 2), 2); end if;
  end if;
  base := case when p_on_actual then wage else least(wage, ceiling) end;
  erbase := case when p_er_on_actual then wage else least(wage, ceiling) end;
  epsw := case when p_eps and coalesce(p_age, 0) < coalesce((rule->>'eps_age_limit')::int, 58) then least(wage, ceiling) else 0 end;
  ee := round(base * (rule->>'ee_pct')::numeric / 100);
  er := round(erbase * (rule->>'er_pct')::numeric / 100);
  eps := least(round(epsw * (rule->>'eps_pct')::numeric / 100), er);
  edli := round(least(wage, ceiling) * (rule->>'edli_pct')::numeric / 100);
  adm := round(base * (rule->>'admin_pct')::numeric / 100);
  return jsonb_build_object('ee', ee, 'epf_er', er - eps, 'eps', eps, 'edli', edli, 'admin', adm, 'pf_wage', base, 'eps_wage', epsw, 'edli_wage', least(wage, ceiling),
    'wage', wage, 'ceiling', ceiling, 'segments', segs, 'rule', rule->>'_id', 'source', rule->>'_source');
end $$;

-- ESI. Covered when this month's wages (without overtime) are within the ceiling, or when the employee was covered
-- earlier in the same contribution period (April-September, October-March) - coverage lasts the period.
create function pay_calc_esi(tid uuid, emp text, p_month text, p_wage numeric, p_elig_wage numeric, p_paid_days numeric, p_disabled boolean) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; ceiling numeric; covered boolean; ps text; m int; y int; ee numeric := 0; er numeric := 0; daily numeric; earlier boolean;
begin
  r := pay_rule(tid, 'ESI', 'IN', pay_month_to(p_month));
  if r is null then return jsonb_build_object('covered', false, 'ee', 0, 'er', 0, 'note', 'No ESI rule'); end if;
  ceiling := case when p_disabled then coalesce((r->>'pwd_ceiling')::numeric, (r->>'ceiling')::numeric) else (r->>'ceiling')::numeric end;
  m := split_part(p_month, '-', 2)::int; y := split_part(p_month, '-', 1)::int;
  ps := case when m >= 10 then y || '-10' when m >= 4 then y || '-04' else (y - 1) || '-10' end;
  select exists (select 1 from pay_run_items i join pay_runs ru on ru.id = i.run_id
    where i.employee_id = emp and i.esi_covered and ru.status in ('finalized', 'paid', 'locked') and ru.month >= ps and ru.month < p_month) into earlier;
  covered := earlier or coalesce(p_elig_wage, 0) <= ceiling;
  if covered and coalesce(p_wage, 0) > 0 then
    daily := p_wage / greatest(coalesce(p_paid_days, 0), 1);
    if daily > coalesce((r->>'ee_exempt_daily')::numeric, 0) then ee := ceil(p_wage * (r->>'ee_pct')::numeric / 100); end if;
    er := ceil(p_wage * (r->>'er_pct')::numeric / 100);
  end if;
  return jsonb_build_object('covered', covered, 'ee', ee, 'er', er, 'wage', case when covered then p_wage else 0 end, 'ceiling', ceiling,
    'kept_from_period', earlier and coalesce(p_elig_wage, 0) > ceiling, 'rule', r->>'_id', 'source', r->>'_source');
end $$;

-- professional tax from slabs: [{upto, amt, feb}], upto null = no limit
create function pay_pt_slab(slabs jsonb, wage numeric, feb boolean) returns numeric language sql immutable as $$
  select coalesce((select case when feb and s ? 'feb' then (s->>'feb')::numeric else (s->>'amt')::numeric end
    from jsonb_array_elements(slabs) with ordinality x(s, n)
    where s->>'upto' is null or wage <= (s->>'upto')::numeric order by n limit 1), 0)
$$;

create function pay_calc_pt(tid uuid, emp text, p_state text, p_month text, p_wage numeric, p_gender text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare r jsonb; slabs jsonb; amt numeric := 0; m int; base numeric; hs text; he text; fys date; ytd numeric; cap numeric;
begin
  if p_state is null then return jsonb_build_object('amt', 0, 'note', 'No state set'); end if;
  r := pay_rule(tid, 'PT', p_state, pay_month_to(p_month));
  if r is null then return jsonb_build_object('amt', 0, 'note', 'No professional tax in this state'); end if;
  slabs := case when p_gender = 'female' and r ? 'female' then r->'female' else r->'slabs' end;
  m := split_part(p_month, '-', 2)::int;
  if coalesce(r->>'period', 'monthly') = 'half_yearly' then
    if not (m = any(array(select jsonb_array_elements_text(coalesce(r->'deduct_months', '[9,3]'))::int))) then
      return jsonb_build_object('amt', 0, 'note', 'Deducted in the last month of the half year', 'rule', r->>'_id');
    end if;
    hs := case when m between 4 and 9 then split_part(p_month, '-', 1) || '-04' else (case when m <= 3 then (split_part(p_month, '-', 1)::int - 1)::text else split_part(p_month, '-', 1) end) || '-10' end;
    he := p_month;
    select coalesce(sum(i.pt_wage), 0) into base from pay_run_items i join pay_runs ru on ru.id = i.run_id
      where i.employee_id = emp and ru.status in ('finalized', 'paid', 'locked') and ru.month >= hs and ru.month < he;
    base := base + coalesce(p_wage, 0);
    amt := pay_pt_slab(slabs, base, false);
  else
    amt := pay_pt_slab(slabs, coalesce(p_wage, 0), m = 2);
  end if;
  -- never more than the yearly cap (Constitution art. 276: Rs 2,500)
  cap := (r->>'annual_cap')::numeric;
  if cap is not null and amt > 0 then
    fys := pay_fy_start(tid, pay_month_from(p_month));
    select coalesce(sum(l.amount), 0) into ytd from pay_run_lines l join pay_runs ru on ru.id = l.run_id
      where l.employee_id = emp and l.code = 'PT' and ru.status in ('finalized', 'paid', 'locked') and ru.month >= to_char(fys, 'YYYY-MM') and ru.month < p_month;
    amt := greatest(0, least(amt, cap - ytd));
  end if;
  return jsonb_build_object('amt', amt, 'state', p_state, 'wage', p_wage, 'rule', r->>'_id', 'source', r->>'_source');
end $$;

create function pay_slab_tax(slabs jsonb, income numeric) returns numeric language plpgsql immutable as $$
declare s jsonb; lo numeric := 0; hi numeric; t numeric := 0;
begin
  for s in select * from jsonb_array_elements(slabs) loop
    hi := (s->>'upto')::numeric;
    if income > lo then t := t + (least(income, coalesce(hi, income)) - lo) * (s->>'rate')::numeric / 100; end if;
    exit when hi is null or income <= hi;
    lo := hi;
  end loop;
  return t;
end $$;

-- Annual income tax on a taxable income under one regime's rule, with rebate, surcharge (with marginal relief) and cess.
create function pay_income_tax(rule jsonb, income numeric) returns jsonb language plpgsql immutable as $$
declare ti numeric; tax numeric; rb numeric := 0; sur numeric := 0; s jsonb; rate numeric := 0; thr numeric; cess numeric; t0 numeric; lim numeric;
begin
  ti := greatest(0, income);
  if coalesce((rule->>'round_income')::numeric, 0) > 0 then ti := round(ti / (rule->>'round_income')::numeric) * (rule->>'round_income')::numeric; end if;
  tax := pay_slab_tax(rule->'slabs', ti);
  lim := (rule->'rebate'->>'limit')::numeric;
  if lim is not null then
    if ti <= lim then rb := least(tax, (rule->'rebate'->>'max')::numeric);
    elsif coalesce((rule->'rebate'->>'marginal')::boolean, false) and tax > ti - lim then rb := tax - (ti - lim);
    end if;
  end if;
  tax := tax - rb;
  for s in select * from jsonb_array_elements(coalesce(rule->'surcharge', '[]')) loop
    if ti > (s->>'over')::numeric then rate := (s->>'rate')::numeric; thr := (s->>'over')::numeric; end if;
  end loop;
  if rate > 0 then
    sur := tax * rate / 100;
    -- marginal relief: tax + surcharge may not exceed the tax at the threshold plus the income above it
    t0 := pay_slab_tax(rule->'slabs', thr);
    t0 := t0 + t0 * coalesce((select (s->>'rate')::numeric from jsonb_array_elements(rule->'surcharge') s where (s->>'over')::numeric < thr order by (s->>'over')::numeric desc limit 1), 0) / 100;
    if tax + sur > t0 + (ti - thr) then sur := greatest(0, t0 + (ti - thr) - tax); end if;
  end if;
  cess := (tax + sur) * coalesce((rule->>'cess_pct')::numeric, 4) / 100;
  return jsonb_build_object('taxable', ti, 'slab_tax', round(tax + rb, 2), 'rebate', round(rb, 2), 'surcharge', round(sur, 2), 'cess', round(cess, 2), 'total', round(tax + sur + cess));
end $$;
