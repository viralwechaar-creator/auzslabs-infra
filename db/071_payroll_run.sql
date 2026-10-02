-- =========================================================
-- AUZslab Payroll v2: the payroll run. Default components, structures and leave types; the per-employee calculation
-- (salary by days, overtime, arrears, claims, PF / ESI / PT / LWF / TDS, loans, bonus, full and final); the run state
-- machine (draft -> calculated -> review -> approved -> finalized -> paid -> locked, or cancelled before finalizing);
-- payment batches; the payroll subledger and its posting to AUZslab Accounting; and pay_integrity_check(), which proves
-- the invariants (item = its lines, run = its items, payments = approved net, liability = what is still unpaid).
-- =========================================================

-- ---------- formatting for the "how it was worked out" text ----------
create function pay_num(x numeric) returns text language sql immutable as $$
  select case when x is null then '' when x = trunc(x) then to_char(x, 'FM99,99,99,99,990') else to_char(x, 'FM99,99,99,99,990.00') end
$$;
create function pay_qty(x numeric) returns text language sql immutable as $$
  select case when x is null then '' else rtrim(rtrim(round(x, 2)::text, '0'), '.') end
$$;

-- ---------- defaults for a business ----------
create function pay_setup_defaults(tid uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  perform pay_org_row(tid);
  insert into pay_components (tenant_id, code, name, kind, taxable, pf_wage, esi_wage, pt_wage, prorate, is_basic, system, gl_key, sort) values
    (tid, 'BASIC', 'Basic', 'earning', true, true, true, true, true, true, null, null, 10),
    (tid, 'DA', 'Dearness allowance', 'earning', true, true, true, true, true, true, null, null, 12),
    (tid, 'HRA', 'House rent allowance', 'earning', true, false, true, true, true, false, null, null, 20),
    (tid, 'CONV', 'Conveyance allowance', 'earning', true, false, true, true, true, false, null, null, 30),
    (tid, 'SPECIAL', 'Special allowance', 'earning', true, false, true, true, true, false, null, null, 40),
    (tid, 'ALLOW', 'Other allowances', 'earning', true, false, true, true, true, false, null, null, 45),
    (tid, 'OT', 'Overtime', 'earning', true, false, true, true, false, false, 'ot', null, 50),
    (tid, 'INCENTIVE', 'Incentive', 'earning', true, false, true, true, false, false, null, null, 60),
    (tid, 'BONUS', 'Bonus', 'earning', true, false, false, false, false, false, 'bonus', null, 70),
    (tid, 'ARREARS', 'Arrears', 'earning', true, false, true, true, false, false, 'arrears', null, 80),
    (tid, 'LEAVE_ENC', 'Leave encashment', 'earning', true, false, false, false, false, false, 'leave_enc', null, 85),
    (tid, 'GRATUITY', 'Gratuity', 'earning', false, false, false, false, false, false, 'gratuity', 'gratuity_expense', 86),
    (tid, 'REIMB', 'Reimbursement', 'reimbursement', false, false, false, false, false, false, 'reimb', 'reimb_expense', 90),
    (tid, 'PF_EE', 'Provident fund', 'deduction', false, false, false, false, false, false, 'pf_ee', 'pf_payable', 110),
    (tid, 'ESI_EE', 'ESI', 'deduction', false, false, false, false, false, false, 'esi_ee', 'esi_payable', 120),
    (tid, 'PT', 'Professional tax', 'deduction', false, false, false, false, false, false, 'pt', 'pt_payable', 130),
    (tid, 'TDS', 'Income tax (TDS)', 'deduction', false, false, false, false, false, false, 'tds', 'tds_payable', 140),
    (tid, 'LWF_EE', 'Labour welfare fund', 'deduction', false, false, false, false, false, false, 'lwf_ee', 'lwf_payable', 150),
    (tid, 'LOAN', 'Loan and advance recovery', 'deduction', false, false, false, false, false, false, 'loan', 'staff_advances', 160),
    (tid, 'ARREARS_REC', 'Arrears recovery', 'deduction', false, false, false, false, false, false, 'arrears_rec', 'salary_expense', 165),
    (tid, 'OTHER_DED', 'Other deduction', 'deduction', false, false, false, false, false, false, null, 'other_deductions', 170),
    (tid, 'PF_ER', 'Employer PF', 'employer', false, false, false, false, false, false, 'pf_er', 'pf_payable', 210),
    (tid, 'EPS_ER', 'Employer pension (EPS)', 'employer', false, false, false, false, false, false, 'eps', 'pf_payable', 211),
    (tid, 'EDLI', 'EDLI insurance', 'employer', false, false, false, false, false, false, 'edli', 'pf_payable', 212),
    (tid, 'PF_ADMIN', 'PF admin charges', 'employer', false, false, false, false, false, false, 'pf_admin', 'pf_payable', 213),
    (tid, 'ESI_ER', 'Employer ESI', 'employer', false, false, false, false, false, false, 'esi_er', 'esi_payable', 220),
    (tid, 'LWF_ER', 'Employer LWF', 'employer', false, false, false, false, false, false, 'lwf_er', 'lwf_payable', 230)
  on conflict (tenant_id, code) do nothing;
  if not exists (select 1 from pay_structures where tenant_id = tid) then
    insert into pay_structures (tenant_id, name, description, basis, lines, is_default) values
     (tid, 'Standard', 'Basic is half the salary, house rent 40% of basic, the rest special allowance', 'monthly',
      '[{"code":"BASIC","calc":"formula","formula":"GROSS * 0.5"},{"code":"HRA","calc":"formula","formula":"BASIC * 0.4"},{"code":"SPECIAL","calc":"balance"}]', true),
     (tid, 'Fixed salary', 'One amount, all of it basic', 'monthly', '[{"code":"BASIC","calc":"balance"}]', false),
     (tid, 'Annual CTC', 'Cost to company per year: basic half of CTC, house rent 40% of basic, employer PF, the rest special allowance', 'ctc',
      '[{"code":"BASIC","calc":"formula","formula":"CTC * 0.5"},{"code":"HRA","calc":"formula","formula":"BASIC * 0.4"},{"code":"PF_ER","calc":"formula","formula":"min(BASIC, PF_CEILING) * 0.12"},{"code":"SPECIAL","calc":"balance"}]', false);
  end if;
  if not exists (select 1 from pay_leave_types where tenant_id = tid) then
    insert into pay_leave_types (tenant_id, code, name, paid, quota, accrual, carry_max, encashable, sort) values
     (tid, 'PL', 'Paid leave', true, 12, 'monthly', 24, true, 10),
     (tid, 'SL', 'Sick leave', true, 6, 'yearly', 0, false, 20),
     (tid, 'LOP', 'Unpaid leave', false, 0, 'none', null, false, 90);
  end if;
end $$;

-- one payslip line as jsonb, carrying its component's flags (an unknown code is an ad-hoc line of the given kind)
create function pay_line(tid uuid, p_code text, p_kind text, p_amount numeric, p_full numeric, p_source text, p_calc text,
                         p_ref text default null, p_qty numeric default null, p_name text default null, p_taxable boolean default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare c pay_components; k text;
begin
  select * into c from pay_components where tenant_id = tid and code = upper(p_code);
  k := coalesce(c.kind, p_kind);
  return jsonb_build_object('code', upper(p_code), 'name', coalesce(p_name, c.name, initcap(replace(lower(p_code), '_', ' '))),
    'kind', k, 'amount', round(greatest(coalesce(p_amount, 0), 0), 2), 'full', p_full, 'source', p_source, 'calc', p_calc, 'ref', p_ref, 'qty', p_qty,
    'taxable', coalesce(p_taxable, c.taxable, k = 'earning'),
    'pf', coalesce(c.pf_wage, false), 'esi', coalesce(c.esi_wage, k = 'earning'), 'pt', coalesce(c.pt_wage, k = 'earning'),
    'basic', coalesce(c.is_basic, false), 'gl', c.gl_key,
    'sort', coalesce(c.sort, case k when 'earning' then 65 when 'reimbursement' then 95 when 'deduction' then 175 else 240 end));
end $$;

-- sum of a full-month breakup's lines: 'basic' (basic + DA), 'gross' (earnings)
create function pay_breakup_sum(tid uuid, b jsonb, what text) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum((b->'lines'->>c.code)::numeric), 0) from pay_components c
  where c.tenant_id = tid and b->'lines' ? c.code and ((what = 'basic' and c.is_basic) or (what = 'gross' and c.kind in ('earning', 'reimbursement')))
$$;

-- prorate setting of a structure line (a line may override its component)
create function pay_line_prorates(st_lines jsonb, k text, def boolean) returns boolean language sql immutable as $$
  select coalesce((select (x->>'prorate')::boolean from jsonb_array_elements(coalesce(st_lines, '[]')) x where upper(x->>'code') = k and x ? 'prorate' limit 1), def)
$$;

-- Arrears: months already paid by a finalised regular payroll (last 12 months) whose salary has since been revised with an
-- earlier effective date. Each month and revision is paid once (pay_arrears_settled). Same days as were paid then.
create function pay_arrears(tid uuid, emp text, p_month text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare it record; s_now pay_salaries; s_was uuid; s_was_row pay_salaries; b1 jsonb; b2 jsonb; ratio numeric; pd numeric; k text; comp pay_components; diff numeric;
  st pay_structures; tot numeric := 0; pfp numeric := 0; det jsonb := '[]'; m numeric; ctx jsonb;
begin
  for it in select i.*, r.month, r.finalized_at from pay_run_items i join pay_runs r on r.id = i.run_id
            where i.employee_id = emp and r.kind = 'regular' and r.status in ('finalized', 'paid', 'locked')
              and r.month < p_month and r.month >= pay_month_add(p_month, -12) order by r.month loop
    s_now := pay_salary_at(emp, pay_month_to(it.month));
    if s_now.id is null then continue; end if;
    select salary_id into s_was from pay_arrears_settled where employee_id = emp and month = it.month order by created_at desc limit 1;
    if s_was is null then s_was := it.salary_id; end if;
    if s_was is null or s_now.id = s_was or s_now.created_at <= it.finalized_at then continue; end if;
    select * into s_was_row from pay_salaries where id = s_was;
    select * into st from pay_structures where id = s_now.structure_id;
    ratio := coalesce((it.att->>'ratio')::numeric, 1); pd := coalesce((it.att->>'paid_days')::numeric, 0);
    ctx := pay_struct_ctx(tid, pay_month_to(it.month)) || jsonb_build_object('PAID_DAYS', pd, 'LOP_DAYS', coalesce((it.att->>'lop_days')::numeric, 0));
    b1 := pay_salary_breakup(tid, s_now, ctx);
    b2 := case when s_was_row.id is not null then pay_salary_breakup(tid, s_was_row, ctx) else '{"lines":{}}'::jsonb end;
    m := 0;
    for k in select x from jsonb_object_keys(b1->'lines') x union select x from jsonb_object_keys(b2->'lines') x loop
      select * into comp from pay_components where tenant_id = tid and code = k;
      if comp.kind not in ('earning', 'reimbursement') then continue; end if;
      diff := coalesce((b1->'lines'->>k)::numeric, 0) - coalesce((b2->'lines'->>k)::numeric, 0);
      diff := case when pay_line_prorates(st.lines, k, comp.prorate) then round(diff * ratio, 2) when pd > 0 then diff else 0 end;
      m := m + diff;
      if comp.pf_wage then pfp := pfp + diff; end if;
    end loop;
    det := det || jsonb_build_array(jsonb_build_object('month', it.month, 'salary_id', s_now.id, 'amount', m));
    tot := tot + m;
  end loop;
  return jsonb_build_object('amount', tot, 'pf', pfp, 'detail', det);
end $$;

-- Monthly TDS: projects the year's taxable pay (this financial year's finalised payrolls + this one + the regular monthly
-- pay for the months still to come + income declared from an earlier employer), takes the regime's deductions, works out
-- the year's tax and spreads what is still due over the months left. An off-cycle payment instead takes the extra tax it
-- causes, all at once. cur: {taxable, regular, basic, basic_full, hra, hra_full, pf, pt, incremental}
create function pay_calc_tds(tid uuid, e pay_employees, ru pay_runs, cur jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare fys date; fye date; fyl text; decl pay_tax_decl; regime text; rule jsonb; it jsonb; lastm text; rem int;
  y_tx numeric; y_tds numeric; y_pf numeric; y_pt numeric; y_basic numeric; y_hra numeric;
  inc numeric; ded numeric := 0; std numeric; hra_ex numeric := 0; rent numeric; basic_a numeric; hra_a numeric; pt_a numeric := 0; pf_a numeric;
  c80 numeric := 0; d80 numeric := 0; ccd numeric := 0; hl numeric := 0; oth numeric := 0; caps jsonb; t jsonb; t0 jsonb; due numeric; amt numeric;
  prev_inc numeric; prev_tds numeric; mon_emp int; ms date; me_ date;
begin
  fys := pay_fy_start(tid, ru.period_from); fye := (fys + interval '1 year' - interval '1 day')::date; fyl := pay_fy_label(fys);
  select * into decl from pay_tax_decl d where d.employee_id = e.id and d.fy = fyl;
  regime := coalesce(decl.regime, e.tax_regime, 'new');
  rule := pay_rule(tid, 'TDS', regime, pay_month_to(ru.month));
  if rule is null then return jsonb_build_object('amt', 0, 'regime', regime, 'fy', fyl, 'note', 'No income-tax rule for ' || fyl); end if;
  it := coalesce(decl.items, '{}');
  select coalesce(sum(l.amount) filter (where l.kind in ('earning', 'reimbursement') and l.taxable), 0),
         coalesce(sum(l.amount) filter (where l.code = 'TDS'), 0), coalesce(sum(l.amount) filter (where l.code = 'PF_EE'), 0),
         coalesce(sum(l.amount) filter (where l.code = 'PT'), 0), coalesce(sum(l.amount) filter (where l.is_basic and l.kind = 'earning'), 0),
         coalesce(sum(l.amount) filter (where l.code = 'HRA'), 0)
    into y_tx, y_tds, y_pf, y_pt, y_basic, y_hra
    from pay_run_lines l join pay_runs r on r.id = l.run_id
   where l.employee_id = e.id and r.id <> ru.id and r.status in ('finalized', 'paid', 'locked') and r.month between to_char(fys, 'YYYY-MM') and to_char(fye, 'YYYY-MM');
  lastm := to_char(fye, 'YYYY-MM');
  if e.last_day is not null and e.last_day between fys and fye then lastm := least(lastm, to_char(e.last_day, 'YYYY-MM')); end if;
  rem := greatest(0, (split_part(lastm, '-', 1)::int * 12 + split_part(lastm, '-', 2)::int) - (split_part(ru.month, '-', 1)::int * 12 + split_part(ru.month, '-', 2)::int));
  if ru.kind = 'fnf' then rem := 0; end if;
  -- an off-cycle payment: this month's regular salary is still to come unless its payroll is already finalised
  if coalesce((cur->>'incremental')::boolean, false) and (e.last_day is null or e.last_day >= ru.period_from) and not exists (select 1 from pay_run_items i join pay_runs r on r.id = i.run_id
      where i.employee_id = e.id and r.kind = 'regular' and r.month = ru.month and r.status in ('finalized', 'paid', 'locked')) then
    rem := rem + 1;
  end if;
  prev_inc := coalesce((it->>'prev_income')::numeric, 0); prev_tds := coalesce((it->>'prev_tds')::numeric, 0);
  inc := y_tx + coalesce((cur->>'taxable')::numeric, 0) + coalesce((cur->>'regular')::numeric, 0) * rem + prev_inc;
  std := least(coalesce((rule->>'std_deduction')::numeric, 0), inc); ded := std;
  if regime = 'old' then
    caps := coalesce(rule->'caps', '{}');
    basic_a := y_basic + coalesce((cur->>'basic')::numeric, 0) + coalesce((cur->>'basic_full')::numeric, 0) * rem;
    hra_a := y_hra + coalesce((cur->>'hra')::numeric, 0) + coalesce((cur->>'hra_full')::numeric, 0) * rem;
    rent := coalesce((it->>'rent_monthly')::numeric, 0);
    if rent > 0 and hra_a > 0 then
      ms := greatest(fys, e.joined_on); me_ := least(fye, coalesce(e.last_day, fye));
      mon_emp := greatest(1, (extract(year from me_)::int * 12 + extract(month from me_)::int) - (extract(year from ms)::int * 12 + extract(month from ms)::int) + 1);
      hra_ex := greatest(0, least(hra_a, rent * mon_emp - 0.1 * basic_a,
        (case when coalesce((it->>'metro')::boolean, false) then coalesce((rule->>'hra_metro_pct')::numeric, 50) else coalesce((rule->>'hra_other_pct')::numeric, 40) end) / 100 * basic_a));
    end if;
    if coalesce((rule->>'pt_deductible')::boolean, true) then pt_a := y_pt + coalesce((cur->>'pt')::numeric, 0) * (rem + 1); end if;
    pf_a := y_pf + coalesce((cur->>'pf')::numeric, 0) * (rem + 1);
    c80 := least(coalesce((caps->>'sec80c')::numeric, 150000), coalesce((it->>'sec80c')::numeric, 0) + pf_a);
    d80 := least(coalesce((caps->>'sec80d')::numeric, 100000), coalesce((it->>'sec80d')::numeric, 0));
    ccd := least(coalesce((caps->>'sec80ccd1b')::numeric, 50000), coalesce((it->>'sec80ccd1b')::numeric, 0));
    hl := least(coalesce((caps->>'home_loan_interest')::numeric, 200000), coalesce((it->>'home_loan_interest')::numeric, 0));
    oth := greatest(0, coalesce((it->>'other_deductions')::numeric, 0));
    ded := std + hra_ex + pt_a + c80 + d80 + ccd + hl + oth;
  end if;
  t := pay_income_tax(rule, inc - ded);
  due := (t->>'total')::numeric - y_tds - prev_tds;
  if coalesce((cur->>'incremental')::boolean, false) then
    t0 := pay_income_tax(rule, inc - coalesce((cur->>'taxable')::numeric, 0) - ded);
    amt := greatest(0, round((t->>'total')::numeric - (t0->>'total')::numeric));
  else
    amt := greatest(0, round(due / (rem + 1)));
  end if;
  return jsonb_build_object('amt', amt, 'regime', regime, 'fy', fyl, 'annual_income', inc, 'ytd_income', y_tx, 'projected_months', rem,
    'deductions', ded, 'std_deduction', std, 'hra_exempt', round(hra_ex, 2), 'sec80c', c80, 'sec80d', d80, 'sec80ccd1b', ccd, 'home_loan', hl, 'other', oth, 'pt', pt_a,
    'taxable_income', (t->>'taxable')::numeric, 'annual_tax', (t->>'total')::numeric, 'rebate', (t->>'rebate')::numeric, 'cess', (t->>'cess')::numeric,
    'surcharge', (t->>'surcharge')::numeric, 'ytd_tds', y_tds, 'prev_tds', prev_tds, 'prev_income', prev_inc, 'due', due, 'source', rule->>'_source');
end $$;

-- Statutory bonus for a financial year from the finalised payrolls of that year (basic + DA each month, capped at the
-- calculation ceiling; months above the eligibility limit do not count).
create function pay_bonus_for(tid uuid, emp text, ru pay_runs, pct numeric) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb; fys date; fye date; base numeric := 0; days numeric := 0; m record; cap numeric; elig numeric; months int := 0; amt numeric;
begin
  r := pay_rule(tid, 'BONUS', 'IN', ru.period_to);
  if r is null then return jsonb_build_object('amount', 0, 'note', 'No bonus rule'); end if;
  if pct < (r->>'min_pct')::numeric or pct > (r->>'max_pct')::numeric then
    raise exception 'Statutory bonus is between % and % percent', r->>'min_pct', r->>'max_pct';
  end if;
  fys := coalesce((ru.params->>'fy_start')::date, pay_fy_start(tid, ru.period_from) - interval '1 year')::date;
  fye := (fys + interval '1 year' - interval '1 day')::date;
  cap := coalesce((ru.params->>'calc_ceiling')::numeric, (r->>'calc_ceiling')::numeric);
  elig := (r->>'eligibility_wage')::numeric;
  for m in select r2.month, coalesce(sum(l.amount) filter (where l.is_basic and l.kind = 'earning'), 0) basic, max(coalesce((i.att->>'paid_days')::numeric, 0)) pd
             from pay_run_items i join pay_runs r2 on r2.id = i.run_id left join pay_run_lines l on l.item_id = i.id
            where i.employee_id = emp and r2.kind in ('regular', 'legacy', 'fnf') and r2.status in ('finalized', 'paid', 'locked')
              and r2.month between to_char(fys, 'YYYY-MM') and to_char(fye, 'YYYY-MM') group by r2.month loop
    if m.basic > elig then continue; end if;
    base := base + least(m.basic, cap); days := days + m.pd; months := months + 1;
  end loop;
  if days < coalesce((r->>'min_days')::numeric, 30) then
    return jsonb_build_object('amount', 0, 'note', 'Not eligible for bonus for ' || pay_fy_label(fys) || ': ' || pay_qty(days) || ' days worked');
  end if;
  amt := round(base * pct / 100);
  return jsonb_build_object('amount', amt, 'calc', pay_qty(pct) || '% of ' || pay_num(base) || ' (' || months || ' months of ' || pay_fy_label(fys) || ', basic capped at ' || pay_num(cap) || ')');
end $$;

-- Gratuity on leaving: 15 days' basic + DA (on a 26-day month) per year of service, from 5 years (1 for fixed-term).
create function pay_gratuity_for(tid uuid, e pay_employees, p_basic numeric) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb; lastd date; months int; yrs int; remm int; ok boolean; amt numeric; yr int; ftype text;
begin
  lastd := coalesce(e.last_day, pay_today(tid));
  r := pay_rule(tid, 'GRATUITY', 'IN', lastd);
  if r is null then return jsonb_build_object('amount', 0, 'note', 'No gratuity rule'); end if;
  months := (extract(year from lastd)::int - extract(year from e.joined_on)::int) * 12 + extract(month from lastd)::int - extract(month from e.joined_on)::int
            - case when extract(day from lastd) < extract(day from e.joined_on) then 1 else 0 end;
  yrs := months / 12; remm := months % 12;
  ftype := (pay_job_at(e.id, lastd)).emp_type;
  ok := yrs >= (r->>'min_years')::int or e.exit_kind = 'death' or (ftype = 'fixed_term' and yrs >= coalesce((r->>'fixed_term_min_years')::int, 1));
  if not ok then return jsonb_build_object('amount', 0, 'note', 'Not eligible for gratuity: ' || yrs || ' years ' || remm || ' months of service (needs ' || (r->>'min_years') || ' years)'); end if;
  yr := yrs + case when remm >= coalesce((r->>'round_up_months')::int, 6) then 1 else 0 end;
  amt := least((r->>'cap')::numeric, round(coalesce(p_basic, 0) * (r->>'days')::numeric / (r->>'divisor')::numeric * yr));
  return jsonb_build_object('amount', amt, 'years', yr, 'calc', pay_num(p_basic) || ' x ' || (r->>'days') || '/' || (r->>'divisor') || ' x ' || yr || ' years');
end $$;

-- ---------- one employee's pay in one run ----------
-- Builds the payslip lines and the item. Returns the item id, or null when the employee is not part of this run.
create function pay_calc_item(p_run uuid, p_emp text) returns uuid language plpgsql security definer set search_path = public as $$
declare
  ru pay_runs; e pay_employees; o pay_org; tid uuid; j pay_jobs; loc pay_locations; bank pay_bank_accounts; st pay_structures; comp pay_components;
  ws date; we date; cal int; employed int := 0; a record; late_lop numeric := 0; in_lop numeric := 0; in_ot numeric := 0; lopd numeric := 0;
  paid_days numeric := 0; divisor numeric := 0; ratio numeric := 0; wd_period int := 0; wd_emp int := 0; d date; offd boolean;
  s_end pay_salaries; s_start pay_salaries; b_new jsonb; b_old jsonb; w_new numeric := 1; ctx jsonb; k text; fullamt numeric; amt numeric; pr boolean;
  ls jsonb := '[]'; ls_out jsonb := '[]'; l jsonb; warn jsonb := '[]'; ot_h numeric := 0; ar jsonb; inp record; cl record; ln record; lt record;
  gross numeric := 0; taxable numeric := 0; pfw numeric := 0; esiw numeric := 0; ptw numeric := 0; basic_now numeric := 0; hra_now numeric := 0;
  struct_gross numeric := 0; rate_gross numeric := 0; basic_full numeric := 0; hra_full numeric := 0; reg_tax_full numeric := 0;
  pfr jsonb; esr jsonb; ptr jsonb; lwr jsonb; tdr jsonb; age int; years numeric; salary_part boolean; flat jsonb;
  ded numeric := 0; avail numeric; employer numeric := 0; item_id uuid; snap jsonb; att jsonb; state text; tds_in numeric; outst numeric;
  bonus jsonb; pct numeric; grat jsonb; b_fnf jsonb; enc_days numeric; enc_rate numeric; esi_cov boolean := false; pf_ee numeric := 0; pt_amt numeric := 0;
  pf_info jsonb; arr_detail jsonb;
begin
  select * into ru from pay_runs where id = p_run;
  tid := ru.tenant_id;
  select * into e from pay_employees where id = p_emp and tenant_id = tid;
  if e.id is null then raise exception 'Employee % not found', p_emp; end if;
  o := pay_org_row(tid);
  ws := greatest(ru.period_from, e.joined_on);
  we := least(ru.period_to, coalesce(e.last_day, ru.period_to));
  salary_part := ru.kind in ('regular', 'fnf');
  if ru.kind = 'fnf' and exists (select 1 from pay_run_items i join pay_runs r on r.id = i.run_id
      where i.employee_id = e.id and r.kind = 'regular' and r.month = ru.month and r.status in ('finalized', 'paid', 'locked')) then
    salary_part := false;   -- the last month was already paid by the regular payroll
  end if;
  if ws > we then
    if ru.kind = 'regular' then return null; end if;
    salary_part := false;
  end if;
  j := pay_job_at(e.id, least(coalesce(e.last_day, ru.period_to), ru.period_to));
  select * into loc from pay_locations where id = j.location_id;
  state := coalesce(loc.state_code, o.state_code);
  cal := ru.period_to - ru.period_from + 1;
  employed := greatest(we - ws + 1, 0);
  select * into bank from pay_bank_accounts where employee_id = e.id and status = 'active';

  -- ---- days and salary ----
  if salary_part then
    select count(*) filter (where status in ('present', 'late', 'missing')) as present,
           count(*) filter (where status = 'late' or late_mins > 0) as late,
           count(*) filter (where status = 'half') as half,
           count(*) filter (where status = 'absent') as absent,
           count(*) filter (where 'missing_out' = any(flags)) as missing,
           coalesce(sum(leave_days) filter (where leave_paid), 0) as leave_paid,
           coalesce(sum(leave_days) filter (where leave_paid = false), 0) as leave_unpaid,
           count(*) filter (where status = 'holiday') as holidays,
           count(*) filter (where status = 'weekly_off') as offs,
           count(*) filter (where status = 'upcoming') as upcoming,
           coalesce(sum(round(ot_mins / 60.0, 2)), 0) as ot_hours, coalesce(sum(lop), 0) as lop
      into a from pay_attendance where employee_id = e.id and att_date between ws and we;
    if pay_cfg(o.settings, 'att', 'late_lop_every', '0')::int > 0 then
      late_lop := floor(a.late / pay_cfg(o.settings, 'att', 'late_lop_every', '0')::numeric) * pay_cfg(o.settings, 'att', 'late_lop_days', '0.5')::numeric;
    end if;
    select coalesce(sum(amount) filter (where kind = 'lop_days'), 0), coalesce(sum(amount) filter (where kind = 'ot_hours'), 0)
      into in_lop, in_ot from pay_run_inputs where run_id = ru.id and employee_id = e.id;
    lopd := greatest(0, a.lop + late_lop + in_lop);
    d := ru.period_from;
    while d <= ru.period_to loop
      offd := extract(dow from d)::int = any(pay_weekly_off(tid, e.id, d)) or pay_holiday(tid, e.id, d) is not null;
      if not offd then wd_period := wd_period + 1; if d between ws and we then wd_emp := wd_emp + 1; end if; end if;
      d := d + 1;
    end loop;
    case o.proration
      when 'fixed30' then divisor := 30; paid_days := greatest(0, least(30, round(30.0 * employed / cal, 2) - lopd));
      when 'fixed26' then divisor := 26; paid_days := greatest(0, least(26, round(26.0 * employed / cal, 2) - lopd));
      when 'working' then divisor := wd_period; paid_days := greatest(0, wd_emp - lopd);
      else divisor := cal; paid_days := greatest(0, employed - lopd);
    end case;
    ratio := case when divisor > 0 then least(1, round(paid_days / divisor, 6)) else 0 end;
    ot_h := a.ot_hours + in_ot;   -- each day's overtime rounded to the hundredth of an hour, then added

    s_end := pay_salary_at(e.id, we);
    if s_end.id is null then
      warn := warn || jsonb_build_array(jsonb_build_object('code', 'no_salary', 'text', 'No salary set'));
    else
      years := round((we - e.joined_on) / 365.25, 2);
      ctx := pay_struct_ctx(tid, we) || jsonb_build_object('DAYS', cal, 'PAID_DAYS', paid_days, 'LOP_DAYS', lopd, 'WORK_DAYS', wd_period, 'OT_HOURS', ot_h, 'YEARS', years);
      b_new := pay_salary_breakup(tid, s_end, ctx);
      s_start := pay_salary_at(e.id, ws);
      if s_start.id is not null and s_start.id <> s_end.id and s_end.eff_from > ws then
        -- salary changed inside the month: each rate for its own days
        b_old := pay_salary_breakup(tid, s_start, ctx);
        w_new := round((we - s_end.eff_from + 1)::numeric / greatest(employed, 1), 6);
        warn := warn || jsonb_build_array(jsonb_build_object('code', 'salary_changed', 'text', 'Salary changed on ' || to_char(s_end.eff_from, 'DD Mon') || '; each rate is used for its own days'));
      end if;
      select * into st from pay_structures where id = s_end.structure_id;
      for k in select x from jsonb_array_elements_text(b_new->'order') x union select x from jsonb_array_elements_text(coalesce(b_old->'order', '[]')) x loop
        select * into comp from pay_components where tenant_id = tid and code = k;
        fullamt := round(coalesce((b_new->'lines'->>k)::numeric, 0) * w_new + coalesce((b_old->'lines'->>k)::numeric, 0) * (1 - w_new), 2);
        if comp.kind = 'employer' or fullamt = 0 then continue; end if;
        pr := pay_line_prorates(st.lines, k, comp.prorate);
        if comp.kind in ('earning', 'reimbursement') then
          amt := case when pr then round(fullamt * ratio, 2) when paid_days > 0 then fullamt else 0 end;
          rate_gross := rate_gross + fullamt;
          if comp.is_basic then basic_full := basic_full + fullamt; end if;
          if k = 'HRA' then hra_full := hra_full + fullamt; end if;
          if comp.taxable then reg_tax_full := reg_tax_full + fullamt; end if;
          ls := ls || jsonb_build_array(pay_line(tid, k, comp.kind, amt, fullamt, 'structure',
                 case when pr and ratio < 1 then pay_num(fullamt) || ' x ' || pay_qty(paid_days) || '/' || pay_qty(divisor) || ' days' end,
                 null, case when pr then paid_days end));
        else
          ls := ls || jsonb_build_array(pay_line(tid, k, 'deduction', case when paid_days > 0 then fullamt else 0 end, fullamt, 'structure', null));
        end if;
      end loop;
    end if;
    if ot_h > 0 then
      if coalesce(s_end.ot_rate, 0) > 0 then
        ls := ls || jsonb_build_array(pay_line(tid, 'OT', 'earning', round(ot_h * s_end.ot_rate, 2), null, 'ot', pay_qty(ot_h) || ' h x ' || pay_num(s_end.ot_rate), null, ot_h));
      else
        warn := warn || jsonb_build_array(jsonb_build_object('code', 'ot_no_rate', 'text', pay_qty(ot_h) || ' overtime hours but no overtime rate'));
      end if;
    end if;
    if a.missing > 0 then warn := warn || jsonb_build_array(jsonb_build_object('code', 'missing_out', 'text', a.missing || ' day(s) with a clock-in but no clock-out')); end if;
    -- days still ahead in a running month are said once for the whole payroll (the app shows a banner), not per person
  end if;

  -- off-cycle and bonus payments: the regular monthly pay still matters for the year's tax
  if not salary_part and ru.kind in ('offcycle', 'bonus') then
    s_end := pay_salary_at(e.id, least(ru.period_to, coalesce(e.last_day, ru.period_to)));
    if s_end.id is not null then
      b_new := pay_salary_breakup(tid, s_end, null);
      for k in select x from jsonb_object_keys(b_new->'lines') x loop
        select * into comp from pay_components where tenant_id = tid and code = k;
        if comp.kind = 'earning' and comp.taxable then reg_tax_full := reg_tax_full + (b_new->'lines'->>k)::numeric; end if;
        if comp.is_basic then basic_full := basic_full + (b_new->'lines'->>k)::numeric; end if;
        if k = 'HRA' then hra_full := hra_full + (b_new->'lines'->>k)::numeric; end if;
      end loop;
    end if;
  end if;

  -- ---- arrears from salary revisions dated in the past ----
  if ru.kind = 'regular' and salary_part then
    ar := pay_arrears(tid, e.id, ru.month);
    arr_detail := ar->'detail';
    if (ar->>'amount')::numeric > 0 then
      if (ar->>'pf')::numeric > 0 then
        ls := ls || jsonb_build_array(pay_line(tid, 'ARREARS', 'earning', least((ar->>'pf')::numeric, (ar->>'amount')::numeric), null, 'arrears',
              'Basic arrears: ' || (select string_agg(x->>'month', ', ') from jsonb_array_elements(ar->'detail') x where (x->>'amount')::numeric <> 0), null, null, 'Arrears (basic)') || jsonb_build_object('pf', true, 'basic', true));
      end if;
      if (ar->>'amount')::numeric - greatest((ar->>'pf')::numeric, 0) > 0 then
        ls := ls || jsonb_build_array(pay_line(tid, 'ARREARS', 'earning', (ar->>'amount')::numeric - greatest((ar->>'pf')::numeric, 0), null, 'arrears',
              'Salary revision for ' || (select string_agg(x->>'month', ', ') from jsonb_array_elements(ar->'detail') x where (x->>'amount')::numeric <> 0)));
      end if;
    elsif (ar->>'amount')::numeric < 0 then
      ls := ls || jsonb_build_array(pay_line(tid, 'ARREARS_REC', 'deduction', -(ar->>'amount')::numeric, null, 'arrears', 'Salary lowered for an earlier month'));
    end if;
  end if;

  -- ---- one-time amounts entered for this run ----
  for inp in select * from pay_run_inputs where run_id = ru.id and employee_id = e.id and kind in ('earning', 'deduction') order by created_at loop
    ls := ls || jsonb_build_array(pay_line(tid, coalesce(nullif(inp.code, ''), case inp.kind when 'earning' then 'INCENTIVE' else 'OTHER_DED' end), inp.kind,
          inp.amount, null, 'input', inp.note, inp.id::text, null, nullif(trim(inp.name), ''), case when inp.kind = 'earning' then inp.taxable end));
  end loop;

  -- ---- approved expense claims ----
  if ru.kind in ('regular', 'fnf') or coalesce((ru.params->>'include_claims')::boolean, false) then
    for cl in select * from pay_claims where employee_id = e.id and status = 'approved' and claim_date <= ru.period_to and (run_id is null or run_id = ru.id) order by claim_date loop
      ls := ls || jsonb_build_array(pay_line(tid, 'REIMB', 'reimbursement', coalesce(cl.approved_amount, cl.amount), null, 'claim',
            cl.category || coalesce(': ' || nullif(cl.description, ''), ''), cl.id::text, null, 'Reimbursement: ' || cl.category));
      update pay_claims set run_id = ru.id where id = cl.id;
    end loop;
  end if;

  -- ---- statutory bonus ----
  if ru.kind = 'bonus' then
    pct := coalesce((ru.params->>'pct')::numeric, 8.33);
    bonus := pay_bonus_for(tid, e.id, ru, pct);
    if (bonus->>'amount')::numeric > 0 then ls := ls || jsonb_build_array(pay_line(tid, 'BONUS', 'earning', (bonus->>'amount')::numeric, null, 'bonus', bonus->>'calc'));
    elsif bonus->>'note' is not null then warn := warn || jsonb_build_array(jsonb_build_object('code', 'bonus', 'text', bonus->>'note')); end if;
  end if;

  -- ---- full and final extras ----
  if ru.kind = 'fnf' then
    b_fnf := case when pay_salary_at(e.id, coalesce(e.last_day, ru.period_to)) is null then null
                  else pay_salary_breakup(tid, pay_salary_at(e.id, coalesce(e.last_day, ru.period_to)), null) end;
    if b_fnf is not null then
      enc_rate := round((case when pay_cfg(o.settings, 'fnf', 'encash_basis', 'basic') = 'gross' then pay_breakup_sum(tid, b_fnf, 'gross') else pay_breakup_sum(tid, b_fnf, 'basic') end)
                  / pay_cfg(o.settings, 'fnf', 'encash_divisor', '26')::numeric, 2);
      for lt in select * from pay_leave_types where tenant_id = tid and encashable and paid order by sort loop
        enc_days := pay_leave_balance(e.id, lt.id);
        if enc_days > 0 then
          ls := ls || jsonb_build_array(pay_line(tid, 'LEAVE_ENC', 'earning', round(enc_days * enc_rate, 2), null, 'leave',
                pay_qty(enc_days) || ' days x ' || pay_num(enc_rate), lt.id::text, enc_days, 'Leave encashment: ' || lt.name));
        end if;
      end loop;
      grat := pay_gratuity_for(tid, e, pay_breakup_sum(tid, b_fnf, 'basic'));
      if (grat->>'amount')::numeric > 0 then
        ls := ls || jsonb_build_array(pay_line(tid, 'GRATUITY', 'earning', (grat->>'amount')::numeric, null, 'fnf', grat->>'calc', null, (grat->>'years')::numeric));
      elsif grat->>'note' is not null then warn := warn || jsonb_build_array(jsonb_build_object('code', 'gratuity', 'text', grat->>'note')); end if;
    end if;
    if exists (select 1 from pay_assets where employee_id = e.id and returned_on is null) then
      warn := warn || jsonb_build_array(jsonb_build_object('code', 'assets', 'text', 'Company items not returned yet: ' || (select string_agg(name, ', ') from pay_assets where employee_id = e.id and returned_on is null)));
    end if;
  end if;

  -- ---- totals so far ----
  for l in select * from jsonb_array_elements(ls) loop
    if l->>'kind' in ('earning', 'reimbursement') then
      amt := (l->>'amount')::numeric;
      gross := gross + amt;
      if (l->>'taxable')::boolean then taxable := taxable + amt; end if;
      if (l->>'pf')::boolean then pfw := pfw + amt; end if;
      if (l->>'esi')::boolean then esiw := esiw + amt; end if;
      if (l->>'pt')::boolean then ptw := ptw + amt; end if;
      if (l->>'basic')::boolean then basic_now := basic_now + amt; end if;
      if l->>'code' = 'HRA' then hra_now := hra_now + amt; end if;
      if l->>'source' = 'structure' then struct_gross := struct_gross + amt; end if;
    end if;
  end loop;

  -- ---- statutory deductions and employer contributions ----
  if o.stat_mode = 'flat' then
    -- the old Payroll's simple percentages of gross, kept until the owner switches to the statutory rules
    if salary_part and gross > 0 then
      flat := coalesce(o.settings->'flat', '{}');
      if coalesce((flat->>'pf')::numeric, 0) > 0 then ls := ls || jsonb_build_array(pay_line(tid, 'PF_EE', 'deduction', round(gross * (flat->>'pf')::numeric / 100, 2), null, 'flat', pay_qty((flat->>'pf')::numeric) || '% of gross (simple rate)')); end if;
      if coalesce((flat->>'esi')::numeric, 0) > 0 then ls := ls || jsonb_build_array(pay_line(tid, 'ESI_EE', 'deduction', round(gross * (flat->>'esi')::numeric / 100, 2), null, 'flat', pay_qty((flat->>'esi')::numeric) || '% of gross (simple rate)')); end if;
      if coalesce((flat->>'pt')::numeric, 0) > 0 then ls := ls || jsonb_build_array(pay_line(tid, 'PT', 'deduction', (flat->>'pt')::numeric, null, 'flat', 'Fixed amount (simple rate)')); end if;
      if coalesce((flat->>'tds')::numeric, 0) > 0 then ls := ls || jsonb_build_array(pay_line(tid, 'TDS', 'deduction', round(gross * (flat->>'tds')::numeric / 100, 2), null, 'flat', pay_qty((flat->>'tds')::numeric) || '% of gross (simple rate)')); end if;
    end if;
  else
    if salary_part then
      if pay_cfg(o.settings, 'pf', 'enabled', 'false')::boolean and e.pf_applicable and pfw > 0 then
        age := case when e.dob is null then 0 else extract(year from age(we, e.dob))::int end;
        pfr := pay_calc_pf(tid, ru.period_from, ru.period_to, pfw, struct_gross, coalesce(e.pf_on_actual, pay_cfg(o.settings, 'pf', 'on_actual', 'false')::boolean),
                           pay_cfg(o.settings, 'pf', 'er_on_actual', 'false')::boolean, e.eps_applicable, age);
        pf_ee := (pfr->>'ee')::numeric;
        ls := ls || jsonb_build_array(pay_line(tid, 'PF_EE', 'deduction', pf_ee, null, 'statutory', '12% of PF wages ' || pay_num((pfr->>'pf_wage')::numeric) ||
              case when (pfr->>'wage')::numeric > (pfr->>'pf_wage')::numeric then ' (capped at ' || pay_num((pfr->>'ceiling')::numeric) || ')' else '' end));
        ls := ls || jsonb_build_array(pay_line(tid, 'PF_ER', 'employer', (pfr->>'epf_er')::numeric, null, 'statutory', 'Employer share to provident fund'));
        ls := ls || jsonb_build_array(pay_line(tid, 'EPS_ER', 'employer', (pfr->>'eps')::numeric, null, 'statutory', '8.33% of ' || pay_num((pfr->>'eps_wage')::numeric)));
        if pay_cfg(o.settings, 'pf', 'edli', 'true')::boolean then ls := ls || jsonb_build_array(pay_line(tid, 'EDLI', 'employer', (pfr->>'edli')::numeric, null, 'statutory', null)); end if;
        if pay_cfg(o.settings, 'pf', 'admin', 'true')::boolean then ls := ls || jsonb_build_array(pay_line(tid, 'PF_ADMIN', 'employer', (pfr->>'admin')::numeric, null, 'statutory', null)); end if;
        if coalesce(e.uan, '') = '' then warn := warn || jsonb_build_array(jsonb_build_object('code', 'no_uan', 'text', 'No UAN for provident fund')); end if;
        pf_info := pfr;
      end if;
      if pay_cfg(o.settings, 'esi', 'enabled', 'false')::boolean and e.esi_applicable and esiw > 0 then
        esr := pay_calc_esi(tid, e.id, ru.month, esiw, greatest(rate_gross, struct_gross), paid_days, e.disabled_person);
        esi_cov := coalesce((esr->>'covered')::boolean, false);
        if esi_cov then
          if (esr->>'ee')::numeric > 0 then ls := ls || jsonb_build_array(pay_line(tid, 'ESI_EE', 'deduction', (esr->>'ee')::numeric, null, 'statutory', '0.75% of ' || pay_num(esiw))); end if;
          ls := ls || jsonb_build_array(pay_line(tid, 'ESI_ER', 'employer', (esr->>'er')::numeric, null, 'statutory', '3.25% of ' || pay_num(esiw)));
        end if;
      end if;
      if pay_cfg(o.settings, 'pt', 'enabled', 'false')::boolean and e.pt_applicable then
        ptr := pay_calc_pt(tid, e.id, state, ru.month, ptw, e.gender);
        pt_amt := coalesce((ptr->>'amt')::numeric, 0);
        if pt_amt > 0 then ls := ls || jsonb_build_array(pay_line(tid, 'PT', 'deduction', pt_amt, null, 'statutory', 'Slab for ' || pay_num(ptw))); end if;
      end if;
      if pay_cfg(o.settings, 'lwf', 'enabled', 'false')::boolean and e.lwf_applicable and state is not null then
        lwr := pay_rule(tid, 'LWF', state, pay_month_to(ru.month));
        if lwr is not null and split_part(ru.month, '-', 2)::int in (select x::int from jsonb_array_elements_text(coalesce(lwr->'months', '[]')) x) then
          if coalesce((lwr->>'ee')::numeric, 0) > 0 then ls := ls || jsonb_build_array(pay_line(tid, 'LWF_EE', 'deduction', (lwr->>'ee')::numeric, null, 'statutory', null)); end if;
          if coalesce((lwr->>'er')::numeric, 0) > 0 then ls := ls || jsonb_build_array(pay_line(tid, 'LWF_ER', 'employer', (lwr->>'er')::numeric, null, 'statutory', null)); end if;
        end if;
      end if;
    end if;
    if pay_cfg(o.settings, 'tds', 'enabled', 'true')::boolean and (taxable > 0 or exists (select 1 from pay_run_inputs where run_id = ru.id and employee_id = e.id and kind = 'tds')) then
      select sum(amount) into tds_in from pay_run_inputs where run_id = ru.id and employee_id = e.id and kind = 'tds';
      if tds_in is not null then
        if tds_in > 0 then ls := ls || jsonb_build_array(pay_line(tid, 'TDS', 'deduction', tds_in, null, 'input', 'Entered for this payroll')); end if;
      else
        tdr := pay_calc_tds(tid, e, ru, jsonb_build_object('taxable', taxable, 'regular', reg_tax_full, 'basic', basic_now, 'basic_full', basic_full, 'hra', hra_now,
               'hra_full', hra_full, 'pf', pf_ee, 'pt', pt_amt, 'incremental', ru.kind in ('offcycle', 'bonus')));
        if (tdr->>'amt')::numeric > 0 then
          ls := ls || jsonb_build_array(pay_line(tid, 'TDS', 'deduction', (tdr->>'amt')::numeric, null, 'statutory',
                case when ru.kind in ('offcycle', 'bonus') then 'Extra tax this payment causes' else 'Year''s tax ' || pay_num((tdr->>'annual_tax')::numeric) || ', ' || pay_num((tdr->>'due')::numeric) || ' still due over ' || ((tdr->>'projected_months')::int + 1) || ' month(s)' end));
          if coalesce(e.pan, '') = '' then warn := warn || jsonb_build_array(jsonb_build_object('code', 'no_pan', 'text', 'Tax is deducted but there is no PAN')); end if;
        end if;
      end if;
    end if;
  end if;

  -- ---- loans and advances ----
  if ru.kind in ('regular', 'fnf') then
    for ln in select * from pay_loans where employee_id = e.id and status = 'active' and (ru.kind = 'fnf' or (start_month <= ru.month and not (ru.month = any(skip_months)))) order by created_at loop
      select coalesce(sum(amount), 0) into outst from pay_loan_ledger where loan_id = ln.id;
      if outst > 0 then
        ls := ls || jsonb_build_array(pay_line(tid, 'LOAN', 'deduction', case when ru.kind = 'fnf' then outst else least(ln.emi, outst) end, null, 'loan',
              pay_num(outst) || ' outstanding before this', ln.id::text, null, case when ln.kind = 'advance' then 'Advance recovery' else 'Loan EMI' end));
      end if;
    end loop;
  end if;

  -- ---- net pay can never go below zero: deductions are taken in priority order ----
  avail := gross;
  for l in select x from jsonb_array_elements(ls) x where x->>'kind' <> 'deduction' loop
    if (l->>'amount')::numeric > 0 then ls_out := ls_out || jsonb_build_array(l); end if;
    if l->>'kind' = 'employer' then employer := employer + (l->>'amount')::numeric; end if;
  end loop;
  for l in select x from jsonb_array_elements(ls) with ordinality t(x, n) where x->>'kind' = 'deduction'
           order by case x->>'code' when 'PF_EE' then 1 when 'ESI_EE' then 2 when 'PT' then 3 when 'LWF_EE' then 4 when 'TDS' then 5 when 'LOAN' then 8 else 6 end, n loop
    amt := (l->>'amount')::numeric;
    if amt > avail then
      warn := warn || jsonb_build_array(jsonb_build_object('code', 'short', 'text', (l->>'name') || ': only ' || pay_num(avail) || ' of ' || pay_num(amt) || ' could be deducted'));
      l := jsonb_set(l, '{amount}', to_jsonb(avail)); amt := avail;
    end if;
    avail := avail - amt; ded := ded + amt;
    if amt > 0 then ls_out := ls_out || jsonb_build_array(l); end if;
  end loop;

  if ru.kind in ('offcycle', 'bonus') and jsonb_array_length(ls_out) = 0 then return null; end if;
  if gross - ded > 0 and (bank.id is null or (bank.mode = 'bank' and (coalesce(bank.account_no, '') = '' or coalesce(bank.ifsc, '') = ''))) then
    warn := warn || jsonb_build_array(jsonb_build_object('code', 'no_bank', 'text', 'No bank details: pay in cash or add them'));
  end if;

  snap := jsonb_build_object('name', e.name, 'code', e.code, 'department', j.department, 'designation', j.designation, 'location', loc.name, 'state', state,
    'joined_on', e.joined_on, 'last_day', e.last_day, 'gender', e.gender, 'pan', pay_mask(e.pan), 'uan', e.uan, 'esi_no', e.esi_no,
    'payout', case when bank.id is null then null else jsonb_build_object('mode', bank.mode, 'bank', bank.bank_name, 'account', pay_mask(bank.account_no), 'ifsc', bank.ifsc, 'upi', pay_mask(bank.upi, 6)) end,
    'structure', st.name, 'salary', s_end.amount, 'basis', st.basis, 'rate_gross', rate_gross, 'ctc_month', b_new->'ctc', 'ot_rate', s_end.ot_rate,
    'arrears', case when jsonb_array_length(coalesce(arr_detail, '[]')) > 0 then arr_detail end, 'pf', pf_info, 'esi', esr, 'pt', ptr);
  att := '{}';
  if salary_part then
    att := jsonb_build_object('days', cal, 'divisor', divisor, 'employed', employed, 'paid_days', paid_days, 'lop_days', lopd, 'ratio', ratio,
      'present', a.present, 'late', a.late, 'half', a.half, 'absent', a.absent, 'leave_paid', a.leave_paid, 'leave_unpaid', a.leave_unpaid,
      'holidays', a.holidays, 'weekly_offs', a.offs, 'ot_hours', ot_h, 'late_lop', late_lop, 'input_lop', in_lop, 'upcoming', a.upcoming, 'method', o.proration, 'from', ws, 'to', we);
  end if;

  insert into pay_run_items (tenant_id, run_id, employee_id, status, salary_id, snap, att, gross, deductions, net, employer, taxable,
    pf_wage, eps_wage, edli_wage, ncp_days, esi_wage, esi_covered, pt_wage, pt_state, tax, warnings)
  values (tid, ru.id, e.id, 'ok', s_end.id, snap, att, gross, ded, gross - ded, employer, taxable,
    coalesce((pfr->>'pf_wage')::numeric, 0), coalesce((pfr->>'eps_wage')::numeric, 0), coalesce((pfr->>'edli_wage')::numeric, 0), case when pfr is null then 0 else lopd end,
    case when esi_cov then esiw else 0 end, esi_cov, ptw, state, tdr, warn)
  returning id into item_id;
  insert into pay_run_lines (tenant_id, run_id, item_id, employee_id, code, name, kind, amount, full_amount, qty, source, ref_id, calc, taxable, pf, esi, pt, is_basic, gl_key, sort)
  select tid, ru.id, item_id, e.id, x->>'code', x->>'name', x->>'kind', (x->>'amount')::numeric, (x->>'full')::numeric, (x->>'qty')::numeric, x->>'source', x->>'ref', x->>'calc',
         coalesce((x->>'taxable')::boolean, false), coalesce((x->>'pf')::boolean, false), coalesce((x->>'esi')::boolean, false), coalesce((x->>'pt')::boolean, false),
         coalesce((x->>'basic')::boolean, false), x->>'gl', coalesce((x->>'sort')::int, 100)
  from jsonb_array_elements(ls_out) x;
  return item_id;
end $$;

-- ---------- the run ----------
create function pay_run_totals(p_run uuid) returns void language sql security definer set search_path = public as $$
  update pay_runs r set employees = x.n, gross = x.g, deductions = x.d, net = x.nt, employer = x.em,
    totals = coalesce((select jsonb_object_agg(code, amt) from (select code, sum(amount) amt from pay_run_lines where run_id = r.id group by code) z), '{}'),
    warnings = coalesce((select jsonb_agg(jsonb_build_object('employee_id', employee_id, 'name', snap->>'name', 'warnings', warnings) order by snap->>'name')
                         from pay_run_items where run_id = r.id and jsonb_array_length(warnings) > 0), '[]')
  from (select count(*) n, coalesce(sum(gross), 0) g, coalesce(sum(deductions), 0) d, coalesce(sum(net), 0) nt, coalesce(sum(employer), 0) em
        from pay_run_items where run_id = p_run) x
  where r.id = p_run
$$;

create function pay_run_summary(p_run uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(r) - 'params' || jsonb_build_object('params', r.params,
    'held', (select count(*) from pay_run_items where run_id = r.id and status = 'hold'),
    'warning_count', (select count(*) from pay_run_items where run_id = r.id and jsonb_array_length(warnings) > 0),
    'payable', (select coalesce(sum(net), 0) from pay_run_items where run_id = r.id and status = 'ok'),
    'pending_payment', (select coalesce(sum(bl.amount), 0) from pay_batch_lines bl join pay_batches b on b.id = bl.batch_id where b.run_id = r.id and bl.status = 'pending'))
  from pay_runs r where r.id = p_run
$$;

create function pay_run_create(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid; o pay_org; k text; m text; pf date; pt date; pd date; e pay_employees; n int; fys date; rid uuid; ttl text; emps jsonb;
begin
  tid := pay_guard('pay_run');
  o := pay_org_row(tid);
  perform pay_setup_defaults(tid);
  k := coalesce(p->>'kind', 'regular');
  if k not in ('regular', 'offcycle', 'bonus', 'fnf') then raise exception 'Unknown payroll type %', k; end if;
  if k = 'fnf' then
    select * into e from pay_employees where tenant_id = tid and id = p->>'employee_id';
    if e.id is null then raise exception 'Pick the employee to settle'; end if;
    if e.last_day is null then raise exception '% has no last working day yet: record their exit first', e.name; end if;
    if e.fnf_run_id is not null then raise exception '% is already settled', e.name; end if;
    if exists (select 1 from pay_runs where tenant_id = tid and kind = 'fnf' and status <> 'cancelled' and params->>'employee_id' = e.id) then
      raise exception 'A full and final settlement for % is already open', e.name;
    end if;
    m := pay_month_of(e.last_day); emps := jsonb_build_array(e.id); ttl := 'Full and final: ' || e.name;
  else
    m := p->>'month';
    if m is null or m !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Pick the month to pay'; end if;
    if pay_month_from(m) > pay_today(tid) + 62 then raise exception 'That month is too far ahead'; end if;
    emps := coalesce(p->'employees', '[]');
    ttl := coalesce(nullif(trim(p->>'title'), ''), case k when 'regular' then 'Salary ' || to_char(pay_month_from(m), 'Mon YYYY') when 'bonus' then 'Bonus' else 'Extra payment' end);
  end if;
  if k = 'regular' and exists (select 1 from pay_runs where tenant_id = tid and kind = 'regular' and month = m and status <> 'cancelled') then
    raise exception 'The payroll for % already exists', to_char(pay_month_from(m), 'FMMonth YYYY');
  end if;
  pf := pay_month_from(m); pt := pay_month_to(m);
  pd := coalesce(nullif(p->>'pay_date', '')::date, case when o.pay_day = 0 then pt else pt + o.pay_day end);
  fys := pay_fy_start(tid, pf);
  n := pay_next_no(tid, 'RUN/' || pay_fy_label(fys));
  insert into pay_runs (tenant_id, number, kind, title, month, period_from, period_to, pay_date, params, created_by)
  values (tid, 'PAY/' || pay_fy_label(fys) || '/' || lpad(n::text, 3, '0'), k, ttl, m, pf, pt, pd,
          coalesce(p->'params', '{}') || jsonb_build_object('employees', emps) || case when k = 'fnf' then jsonb_build_object('employee_id', e.id) else '{}'::jsonb end, app_uid())
  returning id into rid;
  perform pay_audit_log(tid, 'create', 'run', rid::text, case when k = 'fnf' then e.id end, null, jsonb_build_object('kind', k, 'month', m), null);
  return rid;
end $$;

create function pay_run_calculate(p_run uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; ru pay_runs; holds jsonb; ids text[]; x text; emp pay_employees; n int := 0; ws date; we date;
begin
  tid := pay_guard('pay_run');
  select * into ru from pay_runs where id = p_run and tenant_id = tid for update;
  if ru.id is null then raise exception 'Payroll not found'; end if;
  if ru.status not in ('draft', 'calculated') then raise exception 'This payroll is %: send it back before calculating again', ru.status; end if;
  perform pay_setup_defaults(tid);
  -- the old Payroll may still be open on someone's phone: pull in anything it wrote first
  perform pay_import_legacy(tid);
  perform pay_leave_accrue(tid);
  select coalesce(jsonb_object_agg(employee_id, coalesce(hold_reason, '')), '{}') into holds from pay_run_items where run_id = ru.id and status = 'hold';
  delete from pay_run_items where run_id = ru.id;
  update pay_claims set run_id = null where run_id = ru.id and status = 'approved';
  if ru.kind = 'regular' then
    select array_agg(x.id order by x.name) into ids from pay_employees x
     where x.tenant_id = tid and x.status <> 'onboarding' and x.joined_on <= ru.period_to and (x.last_day is null or x.last_day >= ru.period_from)
       and not exists (select 1 from pay_runs f where f.tenant_id = tid and f.kind = 'fnf' and f.status in ('finalized', 'paid', 'locked') and f.params->>'employee_id' = x.id and f.month <= ru.month);
  else
    select array_agg(v) into ids from jsonb_array_elements_text(ru.params->'employees') v;
    if coalesce(array_length(ids, 1), 0) = 0 then
      if ru.kind = 'offcycle' then select array_agg(distinct employee_id) into ids from pay_run_inputs where run_id = ru.id;
      elsif ru.kind = 'bonus' then select array_agg(id order by name) into ids from pay_employees where tenant_id = tid and status in ('active', 'notice', 'exited') and fnf_run_id is null; end if;
    end if;
  end if;
  foreach x in array coalesce(ids, '{}') loop
    select * into emp from pay_employees where id = x and tenant_id = tid;
    if emp.id is null then continue; end if;
    if ru.kind in ('regular', 'fnf') then
      ws := greatest(ru.period_from, emp.joined_on); we := least(ru.period_to, coalesce(emp.last_day, ru.period_to));
      if ws <= we then perform pay_att_refresh(tid, x, ws, we); end if;
    end if;
    if pay_calc_item(ru.id, x) is not null then n := n + 1; end if;
  end loop;
  update pay_run_items set status = 'hold', hold_reason = nullif(holds->>employee_id, '') where run_id = ru.id and holds ? employee_id;
  perform pay_run_totals(ru.id);
  update pay_runs set status = 'calculated', calculated_at = now(), calculated_by = app_uid(), calc_no = calc_no + 1 where id = ru.id;
  perform pay_audit_log(tid, 'calculate', 'run', ru.id::text, null, null, jsonb_build_object('employees', n), null);
  return pay_run_summary(ru.id);
end $$;

-- maker-checker: when switched on, the person approving cannot be the one who calculated or submitted
create function pay_check_approver(ru pay_runs, o pay_org) returns void language plpgsql stable security definer set search_path = public as $$
begin
  if pay_cfg(o.settings, 'access', 'two_person', 'false')::boolean and app_uid() in (ru.calculated_by, ru.submitted_by) then
    raise exception 'Someone else must approve this payroll (two-person approval is on)';
  end if;
end $$;

create function pay_run_submit(p_run uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; ru pay_runs;
begin
  tid := pay_guard('pay_run');
  select * into ru from pay_runs where id = p_run and tenant_id = tid for update;
  if ru.status <> 'calculated' then raise exception 'Only a calculated payroll can be sent for approval'; end if;
  update pay_runs set status = 'review', submitted_at = now(), submitted_by = app_uid() where id = ru.id;
  perform pay_audit_log(tid, 'submit', 'run', ru.id::text, null, null, null, null);
  return pay_run_summary(ru.id);
end $$;

create function pay_run_approve(p_run uuid, p_note text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; ru pay_runs; o pay_org;
begin
  tid := pay_guard('pay_approve');
  select * into ru from pay_runs where id = p_run and tenant_id = tid for update;
  o := pay_org_row(tid);
  if ru.status = 'calculated' and pay_cfg(o.settings, 'access', 'require_review', 'false')::boolean then raise exception 'Send this payroll for approval first'; end if;
  if ru.status not in ('review', 'calculated') then raise exception 'This payroll is % and cannot be approved', ru.status; end if;
  perform pay_check_approver(ru, o);
  update pay_runs set status = 'approved', approved_at = now(), approved_by = app_uid(), note = coalesce(p_note, note) where id = ru.id;
  perform pay_audit_log(tid, 'approve', 'run', ru.id::text, null, null, null, p_note);
  return pay_run_summary(ru.id);
end $$;

create function pay_run_send_back(p_run uuid, p_reason text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; ru pay_runs;
begin
  tid := pay_guard(null);
  if not (pay_perm('pay_run') or pay_perm('pay_approve')) then raise exception 'Your role does not allow this (pay_run)' using errcode = '42501'; end if;
  select * into ru from pay_runs where id = p_run and tenant_id = tid for update;
  if ru.status not in ('review', 'approved') then raise exception 'Only a payroll waiting for approval or approved can be sent back'; end if;
  update pay_runs set status = 'calculated', approved_at = null, approved_by = null, submitted_at = null, submitted_by = null where id = ru.id;
  perform pay_audit_log(tid, 'send_back', 'run', ru.id::text, null, null, null, coalesce(p_reason, ''));
  return pay_run_summary(ru.id);
end $$;

create function pay_run_cancel(p_run uuid, p_reason text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; ru pay_runs;
begin
  tid := pay_guard('pay_run');
  select * into ru from pay_runs where id = p_run and tenant_id = tid for update;
  if ru.status not in ('draft', 'calculated', 'review', 'approved') then raise exception 'A finalised payroll cannot be cancelled; make an adjustment in a new run'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Say why this payroll is being cancelled'; end if;
  update pay_claims set run_id = null where run_id = ru.id and status = 'approved';
  update pay_runs set status = 'cancelled', cancelled_at = now(), cancelled_by = app_uid(), cancel_reason = p_reason where id = ru.id;
  perform pay_audit_log(tid, 'cancel', 'run', ru.id::text, null, null, null, p_reason);
  return pay_run_summary(ru.id);
end $$;

create function pay_item_hold(p_item uuid, p_hold boolean, p_reason text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; it pay_run_items; ru pay_runs;
begin
  tid := pay_guard(null);
  select * into it from pay_run_items where id = p_item and tenant_id = tid;
  if it.id is null then raise exception 'Not found'; end if;
  select * into ru from pay_runs where id = it.run_id;
  if not pay_perm(case when ru.status in ('finalized', 'paid') then 'pay_pay' else 'pay_run' end) then raise exception 'Your role does not allow this' using errcode = '42501'; end if;
  if ru.status in ('locked', 'cancelled') then raise exception 'This payroll is %', ru.status; end if;
  if p_hold and exists (select 1 from pay_batch_lines where item_id = it.id and status in ('pending', 'paid')) then raise exception 'This salary is already in a payment'; end if;
  if p_hold and coalesce(trim(p_reason), '') = '' then raise exception 'Say why this salary is on hold'; end if;
  update pay_run_items set status = case when p_hold then 'hold' else 'ok' end, hold_reason = case when p_hold then p_reason end where id = it.id;
  perform pay_audit_log(tid, case when p_hold then 'hold' else 'release' end, 'run_item', it.id::text, it.employee_id, null, null, p_reason);
  return jsonb_build_object('ok', true);
end $$;

-- ---------- payroll subledger and AUZslab Accounting ----------
-- account keys: salary_expense employer_expense reimb_expense gratuity_expense salary_payable pf_payable esi_payable
-- pt_payable tds_payable lwf_payable other_deductions staff_advances, and bank / cash / acct:<accounting account id>
create function pay_journal_add(tid uuid, p_kind text, p_date date, p_src_type text, p_src uuid, p_narr text, p_lines jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare jid uuid; l record;
begin
  insert into pay_journals (tenant_id, jdate, kind, source_type, source_id, narration, created_by) values (tid, p_date, p_kind, p_src_type, p_src, p_narr, app_uid()) returning id into jid;
  for l in select x->>'key' k, sum(coalesce((x->>'dr')::numeric, 0) - coalesce((x->>'cr')::numeric, 0)) amt from jsonb_array_elements(p_lines) x group by 1 loop
    if l.amt <> 0 then
      insert into pay_journal_lines (tenant_id, journal_id, account_key, debit, credit) values (tid, jid, l.k, greatest(l.amt, 0), greatest(-l.amt, 0));
    end if;
  end loop;
  return jid;
end $$;

create function pay_accrual_journal(tid uuid, ru pay_runs) returns uuid language plpgsql security definer set search_path = public as $$
declare ls jsonb;
begin
  select coalesce(jsonb_agg(x), '[]') into ls from (
    select jsonb_build_object('key', coalesce(gl_key, case kind when 'reimbursement' then 'reimb_expense' else 'salary_expense' end), 'dr', amount) x from pay_run_lines where run_id = ru.id and kind in ('earning', 'reimbursement')
    union all select jsonb_build_object('key', 'employer_expense', 'dr', amount) from pay_run_lines where run_id = ru.id and kind = 'employer'
    union all select jsonb_build_object('key', coalesce(gl_key, 'other_deductions'), 'cr', amount) from pay_run_lines where run_id = ru.id and kind in ('deduction', 'employer')
    union all select jsonb_build_object('key', 'salary_payable', 'cr', net) from pay_run_items where run_id = ru.id) y;
  return pay_journal_add(tid, 'accrual', ru.period_to, 'run', ru.id, 'Payroll ' || ru.number || ': ' || coalesce(ru.title, ''), ls);
end $$;

create function pay_acc_account(tid uuid, k text) returns uuid language plpgsql security definer set search_path = public as $$
declare a uuid; v_code text; v_name text; v_type text; v_grp text; sk text;
begin
  if k like 'acct:%' then
    select id into a from acc_accounts where tenant_id = tid and id = substr(k, 6)::uuid and (is_bank or is_cash);
    if a is null then raise exception 'The payment account is not a bank or cash account in Accounting'; end if;
    return a;
  end if;
  if k = 'bank' then return acc_sys(tid, 'bank'); end if;
  if k = 'cash' then return acc_sys(tid, 'cash'); end if;
  sk := 'pay_' || k;
  select id into a from acc_accounts where tenant_id = tid and system_key = sk;
  if a is not null then return a; end if;
  if k = 'salary_expense' then
    -- the standard chart already has "Salaries and wages": use it
    select id into a from acc_accounts where tenant_id = tid and code = '5101' and system_key is null and type = 'expense';
    if a is not null then update acc_accounts set system_key = sk where id = a; return a; end if;
  end if;
  select v.c, v.n, v.t, v.g into v_code, v_name, v_type, v_grp from (values
    ('salary_expense', '5101', 'Salaries and wages', 'expense', 'Operating expenses'),
    ('employer_expense', '5120', 'Employer PF and ESI', 'expense', 'Operating expenses'),
    ('reimb_expense', '5121', 'Staff reimbursements', 'expense', 'Operating expenses'),
    ('gratuity_expense', '5122', 'Gratuity', 'expense', 'Operating expenses'),
    ('salary_payable', '2410', 'Salaries payable', 'liability', 'Current liabilities'),
    ('pf_payable', '2411', 'PF payable', 'liability', 'Duties and taxes'),
    ('esi_payable', '2412', 'ESI payable', 'liability', 'Duties and taxes'),
    ('pt_payable', '2413', 'Professional tax payable', 'liability', 'Duties and taxes'),
    ('tds_payable', '2414', 'TDS on salaries payable', 'liability', 'Duties and taxes'),
    ('lwf_payable', '2415', 'Labour welfare fund payable', 'liability', 'Duties and taxes'),
    ('other_deductions', '2416', 'Other payroll deductions', 'liability', 'Current liabilities'),
    ('staff_advances', '1410', 'Staff loans and advances', 'asset', 'Current assets')) v(kk, c, n, t, g) where v.kk = k;
  if v_code is null then raise exception 'No accounting account for %', k; end if;
  while exists (select 1 from acc_accounts where tenant_id = tid and code = v_code) loop v_code := (v_code::int + 1)::text; end loop;
  insert into acc_accounts (tenant_id, code, name, type, grp, system_key) values (tid, v_code, v_name, v_type, v_grp, sk) returning id into a;
  return a;
end $$;

-- Posts one payroll journal to AUZslab Accounting when it is on (Settings > Accounting: automatic, or by hand with p_force).
-- A failure (books locked, year closed) is recorded on the journal for the screen to show and retry; it never undoes payroll.
create function pay_acc_post_journal(jid uuid, p_force boolean default false) returns text language plpgsql security definer set search_path = public as $$
declare j pay_journals; tid uuid; mode text; ls jsonb := '[]'; l record; fy uuid; aj uuid; f jsonb; en jsonb; has_org boolean;
begin
  select * into j from pay_journals where id = jid;
  if j.id is null then return 'none'; end if;
  tid := j.tenant_id;
  if j.acc_status = 'posted' then return 'posted'; end if;
  mode := pay_cfg((select settings from pay_org where tenant_id = tid), 'accounting', 'post', 'auto');
  select features, enabled_features into f, en from tenant_settings where tenant_id = tid;
  begin has_org := exists (select 1 from acc_org where tenant_id = tid); exception when undefined_table then has_org := false; end;
  if mode = 'off' or coalesce(f->>'accounting', 'false') <> 'true' or coalesce(en->>'accounting', 'true') = 'false' or not has_org then
    if j.acc_status <> 'off' then update pay_journals set acc_status = 'off' where id = jid; end if;
    return 'off';
  end if;
  if mode = 'manual' and not p_force then return j.acc_status; end if;
  begin
    for l in select account_key, sum(debit) - sum(credit) amt from pay_journal_lines where journal_id = jid group by account_key loop
      ls := acc_jl(ls, pay_acc_account(tid, l.account_key), null, l.amt, null);
    end loop;
    fy := acc_assert_open(tid, j.jdate);
    aj := acc_post_journal(tid, case when j.kind in ('accrual', 'reversal') then 'journal' else 'payment' end, j.jdate, fy, null, j.narration, 'payroll', j.source_id, ls);
    update pay_journals set acc_status = 'posted', acc_journal_id = aj, acc_error = null where id = jid;
    return 'posted';
  exception when others then
    update pay_journals set acc_status = 'failed', acc_error = sqlerrm where id = jid;
    return 'failed';
  end;
end $$;

-- mirror a run's accounting state from its journals
create function pay_run_acc_sync(p_run uuid) returns void language sql security definer set search_path = public as $$
  update pay_runs r set acc_status = coalesce(x.st, 'none'), acc_journal_id = x.aj, acc_error = x.er
  from (select case when bool_or(j.acc_status = 'failed') then 'failed' when bool_and(j.acc_status = 'posted') then 'posted' when bool_and(j.acc_status = 'off') then 'off' else 'none' end st,
               (array_agg(j.acc_journal_id order by j.created_at) filter (where j.kind = 'accrual'))[1] aj,
               string_agg(j.acc_error, '; ') er
        from pay_journals j where j.source_type in ('run', 'batch') and (j.source_id = p_run or j.source_id in (select id from pay_batches where run_id = p_run))) x
  where r.id = p_run
$$;

-- post (or retry) everything of one run to Accounting
create function pay_acc_post_run(p_run uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; j record; res text; n int := 0; bad int := 0;
begin
  tid := pay_guard('pay_approve');
  if not exists (select 1 from pay_runs where id = p_run and tenant_id = tid) then raise exception 'Payroll not found'; end if;
  for j in select id from pay_journals where tenant_id = tid and acc_status in ('none', 'failed') and source_type in ('run', 'batch')
           and (source_id = p_run or source_id in (select id from pay_batches where run_id = p_run)) order by created_at loop
    res := pay_acc_post_journal(j.id, true);
    if res = 'posted' then n := n + 1; elsif res = 'failed' then bad := bad + 1; end if;
  end loop;
  perform pay_run_acc_sync(p_run);
  return jsonb_build_object('posted', n, 'failed', bad, 'error', (select acc_error from pay_runs where id = p_run));
end $$;

create function pay_run_finalize(p_run uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; ru pay_runs; o pay_org; l record; outst numeric; it record; fys date; jid uuid; tot numeric;
begin
  tid := pay_guard('pay_approve');
  select * into ru from pay_runs where id = p_run and tenant_id = tid for update;
  if ru.id is null then raise exception 'Payroll not found'; end if;
  o := pay_org_row(tid);
  if ru.status = 'calculated' and pay_cfg(o.settings, 'access', 'require_review', 'false')::boolean then raise exception 'Send this payroll for approval first'; end if;
  if ru.status not in ('approved', 'calculated') then raise exception 'Only an approved payroll can be finalised (this one is %)', ru.status; end if;
  if ru.status = 'calculated' then perform pay_check_approver(ru, o); end if;
  if not exists (select 1 from pay_run_items where run_id = ru.id) then raise exception 'There is nobody to pay in this payroll'; end if;
  -- a month's salary is paid once: by the regular payroll or by the full and final settlement, never both
  if ru.kind = 'regular' and exists (select 1 from pay_run_items i join pay_runs f on f.tenant_id = tid and f.kind = 'fnf' and f.status in ('finalized', 'paid', 'locked')
       and f.params->>'employee_id' = i.employee_id and f.month <= ru.month where i.run_id = ru.id) then
    raise exception 'Someone in this payroll has been settled in full and final since it was calculated. Calculate again.';
  end if;
  if ru.kind = 'fnf' and exists (select 1 from pay_run_lines xl where xl.run_id = ru.id and xl.source = 'structure')
     and exists (select 1 from pay_run_items i join pay_runs r on r.id = i.run_id where i.employee_id = ru.params->>'employee_id' and r.kind = 'regular' and r.month = ru.month
                 and r.status in ('finalized', 'paid', 'locked')) then
    raise exception 'The regular payroll for this month already paid this person''s salary. Calculate the settlement again.';
  end if;
  -- loans: recovered now; refused if another payroll already took the same money
  for l in select * from pay_run_lines where run_id = ru.id and code = 'LOAN' and ref_id is not null loop
    select coalesce(sum(amount), 0) into outst from pay_loan_ledger where loan_id = l.ref_id::uuid;
    if outst < l.amount then raise exception 'A loan recovery in this payroll is more than what is still owed (another payroll already recovered it). Calculate again.'; end if;
    insert into pay_loan_ledger (tenant_id, loan_id, on_date, kind, amount, run_id, item_id, note, created_by)
    values (tid, l.ref_id::uuid, ru.pay_date, 'recover', -l.amount, ru.id, l.item_id, ru.number, app_uid());
    if outst - l.amount = 0 then update pay_loans set status = 'closed' where id = l.ref_id::uuid; end if;
  end loop;
  update pay_claims set status = 'paid', paid_on = ru.pay_date where run_id = ru.id and status = 'approved';
  for l in select * from pay_run_lines where run_id = ru.id and code = 'LEAVE_ENC' and ref_id is not null loop
    insert into pay_leave_ledger (tenant_id, employee_id, leave_type_id, on_date, kind, days, run_id, note, created_by)
    values (tid, l.employee_id, l.ref_id::uuid, coalesce((select last_day from pay_employees where id = l.employee_id), ru.period_to), 'encash', -coalesce(l.qty, 0), ru.id, 'Encashed in ' || ru.number, app_uid());
  end loop;
  for it in select employee_id, snap from pay_run_items where run_id = ru.id and jsonb_typeof(snap->'arrears') = 'array' loop
    insert into pay_arrears_settled (tenant_id, employee_id, month, salary_id, run_id, amount)
    select tid, it.employee_id, x->>'month', (x->>'salary_id')::uuid, ru.id, (x->>'amount')::numeric from jsonb_array_elements(it.snap->'arrears') x
    on conflict do nothing;
  end loop;
  if ru.kind in ('regular', 'fnf') then
    update pay_attendance a set locked_run = ru.id from pay_run_items i
     where i.run_id = ru.id and a.employee_id = i.employee_id and a.att_date between ru.period_from and ru.period_to and a.locked_run is null;
  end if;
  fys := pay_fy_start(tid, ru.period_from);
  for it in select id from pay_run_items where run_id = ru.id order by snap->>'code' nulls last, snap->>'name' loop
    update pay_run_items set payslip_no = 'PS/' || pay_fy_label(fys) || '/' || lpad(pay_next_no(tid, 'PS/' || pay_fy_label(fys))::text, 5, '0') where id = it.id;
  end loop;
  jid := pay_accrual_journal(tid, ru);
  if ru.kind = 'fnf' then
    update pay_employees set fnf_run_id = ru.id, status = case when last_day < pay_today(tid) then 'exited' else status end, updated_at = now() where id = ru.params->>'employee_id' and tenant_id = tid;
    insert into pay_emp_events (tenant_id, employee_id, on_date, kind, title, data, created_by)
    values (tid, ru.params->>'employee_id', ru.pay_date, 'fnf', 'Full and final settled', jsonb_build_object('run', ru.number, 'net', ru.net), app_uid());
  end if;
  select coalesce(sum(net), 0) into tot from pay_run_items where run_id = ru.id;
  update pay_runs set status = case when tot = 0 then 'paid' else 'finalized' end, finalized_at = now(), finalized_by = app_uid(), journal_id = jid,
         approved_at = coalesce(approved_at, now()), approved_by = coalesce(approved_by, app_uid()) where id = ru.id;
  perform pay_acc_post_journal(jid);
  perform pay_run_acc_sync(ru.id);
  perform pay_audit_log(tid, 'finalize', 'run', ru.id::text, null, null, jsonb_build_object('net', tot), null);
  return pay_run_summary(ru.id);
end $$;

create function pay_run_lock(p_run uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; ru pay_runs;
begin
  tid := pay_guard('pay_approve');
  select * into ru from pay_runs where id = p_run and tenant_id = tid for update;
  if ru.status <> 'paid' then raise exception 'Only a fully paid payroll can be locked'; end if;
  update pay_runs set status = 'locked' where id = ru.id;
  perform pay_audit_log(tid, 'lock', 'run', ru.id::text, null, null, null, null);
  return pay_run_summary(ru.id);
end $$;

-- ---------- paying salaries ----------
create function pay_batch_refresh(p_batch uuid) returns void language plpgsql security definer set search_path = public as $$
declare b pay_batches; tot numeric; pd numeric; fl numeric; pend int; runpaid numeric; runnet numeric;
begin
  select * into b from pay_batches where id = p_batch;
  select coalesce(sum(amount) filter (where status <> 'cancelled'), 0), coalesce(sum(amount) filter (where status = 'paid'), 0),
         coalesce(sum(amount) filter (where status = 'failed'), 0), count(*) filter (where status = 'pending')
    into tot, pd, fl, pend from pay_batch_lines where batch_id = p_batch;
  update pay_batches set total = tot, paid = pd, failed = fl,
    status = case when b.status = 'cancelled' then 'cancelled' when pend = 0 and fl = 0 and pd > 0 then 'paid' when pend = 0 and pd = 0 and fl = 0 then 'cancelled' when pd > 0 or fl > 0 then 'partial' else 'open' end,
    closed_at = case when pend = 0 then coalesce(closed_at, now()) end
  where id = p_batch;
  select coalesce(sum(bl.amount), 0) into runpaid from pay_batch_lines bl join pay_batches bb on bb.id = bl.batch_id where bb.run_id = b.run_id and bl.status = 'paid';
  select coalesce(sum(net), 0) into runnet from pay_run_items where run_id = b.run_id;
  update pay_runs set paid = runpaid, status = case when status = 'finalized' and runpaid >= runnet then 'paid' else status end where id = b.run_id;
end $$;

-- p: {mode: bank|cash|upi|cheque, items: [item ids] (default: everyone not yet paid), pay_account, note, mark_paid, paid_on, ref, skip_missing}
create function pay_batch_create(p_run uuid, p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid; ru pay_runs; bid uuid; n int; it record; b pay_bank_accounts; v_mode text; cnt int := 0; skipped int := 0; acct uuid;
begin
  tid := pay_guard('pay_pay');
  select * into ru from pay_runs where id = p_run and tenant_id = tid for update;
  if ru.id is null then raise exception 'Payroll not found'; end if;
  if ru.status not in ('finalized', 'paid') then raise exception 'Finalise the payroll before paying it'; end if;
  v_mode := coalesce(nullif(p->>'mode', ''), 'bank');
  if v_mode not in ('bank', 'cash', 'upi', 'cheque') then raise exception 'Unknown payment method %', v_mode; end if;
  acct := nullif(p->>'pay_account', '')::uuid;
  n := pay_next_no(tid, 'BATCH');
  insert into pay_batches (tenant_id, run_id, number, mode, pay_account, note, created_by)
  values (tid, ru.id, 'PB-' || lpad(n::text, 4, '0'), v_mode, acct, nullif(p->>'note', ''), app_uid()) returning id into bid;
  for it in select i.* from pay_run_items i where i.run_id = ru.id and i.status = 'ok' and i.net > 0
              and (p->'items' is null or jsonb_typeof(p->'items') <> 'array' or i.id::text in (select jsonb_array_elements_text(p->'items')))
              and not exists (select 1 from pay_batch_lines bl where bl.item_id = i.id and bl.status in ('pending', 'paid'))
            order by i.snap->>'name' loop
    b := null;
    select * into b from pay_bank_accounts where employee_id = it.employee_id and status = 'active';
    if (v_mode = 'bank' and (b.id is null or coalesce(b.account_no, '') = '' or coalesce(b.ifsc, '') = '')) or (v_mode = 'upi' and coalesce(b.upi, '') = '') then
      if coalesce((p->>'skip_missing')::boolean, true) then skipped := skipped + 1; continue; end if;
      raise exception '% has no % details', it.snap->>'name', case when v_mode = 'upi' then 'UPI' else 'bank' end;
    end if;
    insert into pay_batch_lines (tenant_id, batch_id, item_id, employee_id, amount, mode, holder, bank_name, account_no, ifsc, upi)
    values (tid, bid, it.id, it.employee_id, it.net, v_mode, coalesce(nullif(b.holder, ''), it.snap->>'name'),
            case when v_mode = 'bank' then b.bank_name end, case when v_mode = 'bank' then b.account_no end, case when v_mode = 'bank' then b.ifsc end, case when v_mode = 'upi' then b.upi end);
    cnt := cnt + 1;
  end loop;
  if cnt = 0 then
    raise exception 'Nobody left to pay this way%', case when skipped > 0 then ' (' || skipped || ' without ' || case when v_mode = 'upi' then 'UPI' else 'bank' end || ' details)' else '' end;
  end if;
  perform pay_batch_refresh(bid);
  perform pay_audit_log(tid, 'create', 'batch', bid::text, null, null, jsonb_build_object('run', ru.number, 'lines', cnt, 'mode', v_mode), null);
  if coalesce((p->>'mark_paid')::boolean, false) then
    perform pay_batch_mark(bid, jsonb_build_object('all', 'paid', 'paid_on', coalesce(nullif(p->>'paid_on', ''), pay_today(tid)::text), 'ref', p->>'ref'));
  end if;
  return bid;
end $$;

-- p: {lines: [{id, status: paid|failed, ref, reason}], all: paid|failed, paid_on, ref}
create function pay_batch_mark(p_batch uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; b pay_batches; l record; st text; d date; paid_now numeric := 0; jid uuid; lines_paid uuid[] := '{}'; ru pay_runs; credit_key text;
begin
  tid := pay_guard('pay_pay');
  select * into b from pay_batches where id = p_batch and tenant_id = tid for update;
  if b.id is null then raise exception 'Payment batch not found'; end if;
  if b.status = 'cancelled' then raise exception 'This batch was cancelled'; end if;
  d := coalesce(nullif(p->>'paid_on', '')::date, pay_today(tid));
  if d > pay_today(tid) then raise exception 'The payment date cannot be in the future'; end if;
  for l in select bl.*, x.st, x.ref xref, x.reason from pay_batch_lines bl
           left join lateral (select y->>'status' st, y->>'ref' ref, y->>'reason' reason from jsonb_array_elements(coalesce(p->'lines', '[]')) y where (y->>'id')::uuid = bl.id limit 1) x on true
           where bl.batch_id = b.id and bl.status = 'pending' loop
    st := coalesce(l.st, p->>'all');
    if st is null then continue; end if;
    if st not in ('paid', 'failed') then raise exception 'Unknown payment status %', st; end if;
    update pay_batch_lines set status = st, paid_on = case when st = 'paid' then d end, ref = coalesce(nullif(l.xref, ''), nullif(p->>'ref', ''), ref),
           fail_reason = case when st = 'failed' then coalesce(nullif(l.reason, ''), 'Failed') end, updated_by = app_uid(), updated_at = now()
     where id = l.id;
    if st = 'paid' then paid_now := paid_now + l.amount; lines_paid := lines_paid || l.id; end if;
  end loop;
  if paid_now > 0 then
    select * into ru from pay_runs where id = b.run_id;
    credit_key := case when b.pay_account is not null then 'acct:' || b.pay_account when b.mode = 'cash' then 'cash' else 'bank' end;
    jid := pay_journal_add(tid, 'payment', d, 'batch', b.id, 'Salaries paid: ' || ru.number || ' ' || b.number,
           jsonb_build_array(jsonb_build_object('key', 'salary_payable', 'dr', paid_now), jsonb_build_object('key', credit_key, 'cr', paid_now)));
    update pay_batch_lines set journal_id = jid where id = any(lines_paid);
    perform pay_acc_post_journal(jid);
  end if;
  perform pay_batch_refresh(b.id);
  perform pay_run_acc_sync(b.run_id);
  perform pay_audit_log(tid, 'mark', 'batch', b.id::text, null, null, jsonb_build_object('paid', paid_now), null);
  return (select to_jsonb(x) from pay_batches x where id = b.id);
end $$;

create function pay_batch_cancel(p_batch uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; b pay_batches;
begin
  tid := pay_guard('pay_pay');
  select * into b from pay_batches where id = p_batch and tenant_id = tid for update;
  if b.id is null then raise exception 'Payment batch not found'; end if;
  update pay_batch_lines set status = 'cancelled', updated_by = app_uid(), updated_at = now() where batch_id = b.id and status = 'pending';
  if not exists (select 1 from pay_batch_lines where batch_id = b.id and status in ('paid', 'failed')) then update pay_batches set status = 'cancelled' where id = b.id; end if;
  perform pay_batch_refresh(b.id);
  perform pay_audit_log(tid, 'cancel', 'batch', b.id::text, null, null, null, null);
  return (select to_jsonb(x) from pay_batches x where id = b.id);
end $$;

-- ---------- PF / ESI / PT / TDS / LWF paid to the government ----------
create function pay_stat_pay(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid; sid uuid; jid uuid; sc text; acct uuid; d date;
begin
  tid := pay_guard('pay_pay');
  sc := upper(p->>'scheme');
  if sc not in ('PF', 'ESI', 'PT', 'TDS', 'LWF') then raise exception 'Pick what was paid (PF, ESI, PT, TDS or LWF)'; end if;
  if coalesce((p->>'amount')::numeric, 0) <= 0 then raise exception 'Enter the amount paid'; end if;
  if coalesce(p->>'month', '') !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Pick the month this payment is for'; end if;
  d := coalesce(nullif(p->>'paid_on', '')::date, pay_today(tid));
  acct := nullif(p->>'pay_account', '')::uuid;
  insert into pay_stat_payments (tenant_id, scheme, month, amount, paid_on, ref, note, pay_account, created_by)
  values (tid, sc, p->>'month', (p->>'amount')::numeric, d, nullif(p->>'ref', ''), nullif(p->>'note', ''), acct, app_uid()) returning id into sid;
  jid := pay_journal_add(tid, 'statutory', d, 'statutory', sid, sc || ' paid for ' || (p->>'month'),
         jsonb_build_array(jsonb_build_object('key', lower(sc) || '_payable', 'dr', (p->>'amount')::numeric),
                           jsonb_build_object('key', case when acct is not null then 'acct:' || acct else 'bank' end, 'cr', (p->>'amount')::numeric)));
  update pay_stat_payments set journal_id = jid where id = sid;
  perform pay_acc_post_journal(jid);
  perform pay_audit_log(tid, 'create', 'stat_payment', sid::text, null, null, p, null);
  return sid;
end $$;

-- ---------- invariants ----------
create function pay_integrity_check() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; checks jsonb := '[]'; n int; v numeric; w numeric;
begin
  tid := pay_guard('pay_reports');
  select count(*) into n from pay_run_items i where i.tenant_id = tid and (
      i.gross <> coalesce((select sum(amount) from pay_run_lines where item_id = i.id and kind in ('earning', 'reimbursement')), 0)
   or i.deductions <> coalesce((select sum(amount) from pay_run_lines where item_id = i.id and kind = 'deduction'), 0)
   or i.employer <> coalesce((select sum(amount) from pay_run_lines where item_id = i.id and kind = 'employer'), 0)
   or i.net <> i.gross - i.deductions or i.net < 0);
  checks := checks || jsonb_build_array(jsonb_build_object('name', 'Every payslip adds up to its lines', 'ok', n = 0, 'detail', n || ' differ'));
  select count(*) into n from pay_runs r cross join lateral (select coalesce(sum(gross), 0) g, coalesce(sum(deductions), 0) d, coalesce(sum(net), 0) nt, coalesce(sum(employer), 0) em, count(*)::int c
    from pay_run_items where run_id = r.id) x
   where r.tenant_id = tid and r.status not in ('draft', 'cancelled') and (r.gross, r.deductions, r.net, r.employer, r.employees) is distinct from (x.g, x.d, x.nt, x.em, x.c);
  checks := checks || jsonb_build_array(jsonb_build_object('name', 'Every payroll total equals its payslips', 'ok', n = 0, 'detail', n || ' differ'));
  select count(*) into n from (select journal_id from pay_journal_lines where tenant_id = tid group by journal_id having sum(debit) <> sum(credit)) x;
  checks := checks || jsonb_build_array(jsonb_build_object('name', 'Every payroll journal balances', 'ok', n = 0, 'detail', n || ' unbalanced'));
  select count(*) into n from pay_runs r where r.tenant_id = tid and r.kind <> 'legacy' and r.status in ('finalized', 'paid', 'locked') and (r.journal_id is null or r.net <>
    coalesce((select sum(credit) - sum(debit) from pay_journal_lines where journal_id = r.journal_id and account_key = 'salary_payable'), 0));
  checks := checks || jsonb_build_array(jsonb_build_object('name', 'Salary payable booked equals net pay', 'ok', n = 0, 'detail', n || ' differ'));
  select count(*) into n from pay_runs r where r.tenant_id = tid and r.status in ('finalized', 'paid', 'locked') and r.paid <>
    coalesce((select sum(bl.amount) from pay_batch_lines bl join pay_batches b on b.id = bl.batch_id where b.run_id = r.id and bl.status = 'paid'), 0);
  checks := checks || jsonb_build_array(jsonb_build_object('name', 'Payments recorded match paid salaries', 'ok', n = 0, 'detail', n || ' differ'));
  select count(*) into n from pay_run_items i where i.tenant_id = tid and i.net < coalesce((select sum(bl.amount) from pay_batch_lines bl where bl.item_id = i.id and bl.status in ('pending', 'paid')), 0);
  checks := checks || jsonb_build_array(jsonb_build_object('name', 'Nobody is paid more than their net pay', 'ok', n = 0, 'detail', n || ' overpaid'));
  select count(*) into n from pay_batches b cross join lateral (select coalesce(sum(amount) filter (where status <> 'cancelled'), 0) t, coalesce(sum(amount) filter (where status = 'paid'), 0) p
    from pay_batch_lines where batch_id = b.id) x where b.tenant_id = tid and (b.total, b.paid) is distinct from (x.t, x.p);
  checks := checks || jsonb_build_array(jsonb_build_object('name', 'Payment batch totals equal their lines', 'ok', n = 0, 'detail', n || ' differ'));
  select coalesce(sum(credit) - sum(debit), 0) into v from pay_journal_lines where tenant_id = tid and account_key = 'salary_payable';
  select coalesce(sum(r.net - r.paid), 0) into w from pay_runs r where r.tenant_id = tid and r.kind <> 'legacy' and r.status in ('finalized', 'paid', 'locked');
  checks := checks || jsonb_build_array(jsonb_build_object('name', 'Unpaid salaries equal the salary payable balance', 'ok', v = w, 'detail', pay_num(v) || ' vs ' || pay_num(w)));
  select count(*) into n from pay_loans l where l.tenant_id = tid and coalesce((select sum(amount) from pay_loan_ledger where loan_id = l.id), 0) < 0;
  checks := checks || jsonb_build_array(jsonb_build_object('name', 'No loan is recovered beyond what was lent', 'ok', n = 0, 'detail', n || ' over-recovered'));
  select count(*) into n from pay_run_lines rl join pay_runs r on r.id = rl.run_id where r.tenant_id = tid and r.kind <> 'legacy' and r.status in ('finalized', 'paid', 'locked') and rl.code = 'LOAN'
    and rl.ref_id is not null and not exists (select 1 from pay_loan_ledger g where g.run_id = r.id and g.loan_id = rl.ref_id::uuid and g.amount = -rl.amount);
  checks := checks || jsonb_build_array(jsonb_build_object('name', 'Every loan deduction is in the loan ledger', 'ok', n = 0, 'detail', n || ' missing'));
  select count(*) into n from (select l.employee_id, l.leave_type_id from pay_leave_ledger l join pay_leave_types t on t.id = l.leave_type_id
    where l.tenant_id = tid and t.paid and not t.allow_negative group by 1, 2 having sum(l.days) < 0) x;
  checks := checks || jsonb_build_array(jsonb_build_object('name', 'No leave balance below zero', 'ok', n = 0, 'detail', n || ' negative'));
  select count(*) into n from pay_run_items i join pay_runs r on r.id = i.run_id where r.tenant_id = tid and r.kind <> 'legacy' and r.status in ('finalized', 'paid', 'locked') and i.payslip_no is null;
  checks := checks || jsonb_build_array(jsonb_build_object('name', 'Every finalised payslip has a number', 'ok', n = 0, 'detail', n || ' without'));
  select count(*) into n from pay_journals j where j.tenant_id = tid and j.acc_status = 'posted' and (select coalesce(sum(debit), 0) from pay_journal_lines where journal_id = j.id)
    <> coalesce((select sum(debit) from acc_journal_lines where journal_id = j.acc_journal_id), -1);
  checks := checks || jsonb_build_array(jsonb_build_object('name', 'Accounting entries equal the payroll journals', 'ok', n = 0, 'detail', n || ' differ'));
  select count(*) into n from pay_journals j where j.tenant_id = tid and j.acc_status = 'failed';
  checks := checks || jsonb_build_array(jsonb_build_object('name', 'Nothing is waiting to be posted to Accounting', 'ok', n = 0, 'detail', n || ' failed'));
  return jsonb_build_object('ok', not exists (select 1 from jsonb_array_elements(checks) c where not (c->>'ok')::boolean), 'checks', checks, 'at', now());
end $$;
