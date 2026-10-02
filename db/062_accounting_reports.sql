-- =========================================================
-- AUZslab Accounting: financial, sales/purchase, receivable/payable, inventory and GST
-- reports, plus the dashboard and the integrity check. Read-only functions: every figure
-- is derived from the journals / documents / stock moves, never stored separately.
-- Sign convention in outputs: "bal" columns are debit-positive unless a column says otherwise.
-- =========================================================

create function acc_period_start(tid uuid, d date) returns date language plpgsql stable security definer set search_path = public as $$
declare s date; m int;
begin
  select start_date into s from acc_fy where tenant_id = tid and d between start_date and end_date;
  if s is not null then return s; end if;
  select fy_start_month into m from acc_org where tenant_id = tid;
  return acc_fy_start(d, coalesce(m, 4));
end $$;

create function acc_trial_balance(p_from date, p_to date, p_all boolean default false) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; fys date; rows jsonb; ret numeric;
begin
  tid := acc_guard('acc_reports');
  fys := acc_period_start(tid, p_from);
  select coalesce(jsonb_agg(to_jsonb(y) order by y.code), '[]') into rows from (
    select x.*, x.opening + x.debit - x.credit as closing from (
      select a.id, a.code, a.name, a.type, a.grp, a.system_key,
        coalesce(sum(jl.debit - jl.credit) filter (where j.jdate < p_from and (a.type in ('asset', 'liability', 'equity') or j.jdate >= fys)), 0) as opening,
        coalesce(sum(jl.debit) filter (where j.jdate between p_from and p_to), 0) as debit,
        coalesce(sum(jl.credit) filter (where j.jdate between p_from and p_to), 0) as credit
      from acc_accounts a left join acc_journal_lines jl on jl.account_id = a.id left join acc_journals j on j.id = jl.journal_id
      where a.tenant_id = tid group by a.id) x
    where p_all or x.opening <> 0 or x.debit <> 0 or x.credit <> 0) y;
  select coalesce(sum(jl.debit - jl.credit), 0) into ret from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id join acc_accounts a on a.id = jl.account_id
    where jl.tenant_id = tid and a.type in ('income', 'expense') and j.jdate < fys;
  return jsonb_build_object('from', p_from, 'to', p_to, 'rows', rows, 'retained_prior', ret,
    'totals', (select jsonb_build_object('debit', coalesce(sum((r->>'debit')::numeric), 0), 'credit', coalesce(sum((r->>'credit')::numeric), 0)) from jsonb_array_elements(rows) r));
end $$;

-- ledger of one account, or of one customer/supplier on the receivable/payable control accounts
create function acc_ledger(p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; aid uuid := nullif(p->>'account_id', '')::uuid; pid uuid := nullif(p->>'party_id', '')::uuid; fr date := coalesce(nullif(p->>'from', '')::date, date '2000-01-01'); tt date := coalesce(nullif(p->>'to', '')::date, current_date + 1);
  op numeric := 0; fys date; atype text; rows jsonb; lim int := least(coalesce((p->>'limit')::int, 3000), 10000);
begin
  tid := acc_guard('acc_reports');
  if aid is null and pid is null then raise exception 'Choose an account or a party'; end if;
  fys := acc_period_start(tid, fr);
  if aid is not null then select type into atype from acc_accounts where id = aid and tenant_id = tid; if atype is null then raise exception 'Unknown account'; end if; end if;
  select coalesce(sum(jl.debit - jl.credit), 0) into op from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id join acc_accounts a on a.id = jl.account_id
   where jl.tenant_id = tid and j.jdate < fr
     and ((aid is not null and jl.account_id = aid and (atype in ('asset', 'liability', 'equity') or j.jdate >= fys)) or (pid is not null and jl.party_id = pid and a.system_key in ('ar', 'ap')));
  select coalesce(jsonb_agg(to_jsonb(r) order by r.jdate, r.seq), '[]') into rows from (
    select jdate, seq, jv, jid, voucher_type, narration, source_type, source_id, doc_number, doc_type, account, party_id, counter, debit, credit,
           op + sum(debit - credit) over (order by jdate, seq rows between unbounded preceding and current row) as balance
    from (
      select j.jdate, j.created_at::text || lpad(jl.id::text, 12, '0') as seq, j.number as jv, j.id as jid, j.voucher_type, coalesce(jl.narration, j.narration) as narration, j.source_type, j.source_id,
             coalesce(d.number, pm.number) as doc_number, coalesce(d.doc_type, pm.kind) as doc_type, a.name as account, jl.party_id,
             (select string_agg(distinct a2.name, ', ') from acc_journal_lines l2 join acc_accounts a2 on a2.id = l2.account_id where l2.journal_id = j.id and l2.id <> jl.id) as counter,
             jl.debit, jl.credit
      from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id join acc_accounts a on a.id = jl.account_id
      left join acc_documents d on j.source_type = 'document' and d.id = j.source_id
      left join acc_payments pm on j.source_type = 'payment' and pm.id = j.source_id
      where jl.tenant_id = tid and j.jdate between fr and tt
        and ((aid is not null and jl.account_id = aid and (atype in ('asset', 'liability', 'equity') or j.jdate >= fys)) or (pid is not null and jl.party_id = pid and a.system_key in ('ar', 'ap')))
      order by j.jdate, 2 limit lim) q) r;
  return jsonb_build_object('opening', op, 'rows', rows, 'closing', coalesce((select (r->>'balance')::numeric from jsonb_array_elements(rows) r order by (r->>'seq') desc limit 1), op));
end $$;

create function acc_party_statement(p_party uuid, p_from date, p_to date) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; led jsonb;
begin
  tid := acc_guard('acc_view');
  led := acc_ledger(jsonb_build_object('party_id', p_party, 'from', p_from, 'to', p_to));
  return jsonb_build_object('party', (select to_jsonb(x) from acc_parties x where id = p_party and tenant_id = tid), 'org', (select to_jsonb(o) from acc_org o where tenant_id = tid),
    'ledger', led, 'ageing', acc_ageing(jsonb_build_object('kind', (select case when kind = 'supplier' then 'payable' else 'receivable' end from acc_parties where id = p_party), 'party_id', p_party)));
end $$;

-- day book: every voucher in a date range
create function acc_daybook(p_from date, p_to date, p_type text default null) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := acc_guard('acc_reports');
  return jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(r) order by r.jdate desc, r.created_at desc) from (
    select j.id, j.number, j.jdate, j.voucher_type, j.narration, j.source_type, j.source_id, j.created_at, j.reverses_id,
           (select sum(debit) from acc_journal_lines where journal_id = j.id) as amount, coalesce(d.number, pm.number) as doc_number, coalesce(d.doc_type, pm.kind) as doc_type,
           exists (select 1 from acc_journals r where r.reverses_id = j.id) as reversed
    from acc_journals j left join acc_documents d on j.source_type = 'document' and d.id = j.source_id left join acc_payments pm on j.source_type = 'payment' and pm.id = j.source_id
    where j.tenant_id = tid and j.jdate between p_from and p_to and (p_type is null or j.voucher_type = p_type) order by j.jdate desc, j.created_at desc limit 2000) r), '[]'));
end $$;

create function acc_journal_detail(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := acc_guard('acc_view');
  return (select jsonb_build_object('journal', to_jsonb(j), 'lines', (select coalesce(jsonb_agg(jsonb_build_object('account', a.name, 'code', a.code, 'party', pa.name, 'debit', jl.debit, 'credit', jl.credit, 'narration', jl.narration) order by jl.line_no), '[]')
          from acc_journal_lines jl join acc_accounts a on a.id = jl.account_id left join acc_parties pa on pa.id = jl.party_id where jl.journal_id = j.id),
          'reversal', (select jsonb_build_object('id', id, 'number', number) from acc_journals where reverses_id = j.id), 'reverses', (select jsonb_build_object('id', id, 'number', number) from acc_journals where id = j.reverses_id))
          from acc_journals j where j.id = p_id and j.tenant_id = tid);
end $$;

-- cash book / bank book: all cash (or bank) accounts, or one account
create function acc_book(p_kind text, p_from date, p_to date, p_account uuid default null) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; accts jsonb;
begin
  tid := acc_guard('acc_reports');
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'ledger', acc_ledger(jsonb_build_object('account_id', a.id, 'from', p_from, 'to', p_to))) order by a.code), '[]') into accts
  from acc_accounts a where a.tenant_id = tid and ((p_kind = 'cash' and a.is_cash) or (p_kind = 'bank' and a.is_bank)) and (p_account is null or a.id = p_account);
  return jsonb_build_object('accounts', accts);
end $$;

create function acc_pnl(p_from date, p_to date) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; groups jsonb; inc numeric; exp numeric; rev numeric; cos numeric;
begin
  tid := acc_guard('acc_reports');
  with base as (
    select a.type, a.grp, a.id, a.code, a.name, case when a.type = 'income' then sum(jl.credit - jl.debit) else sum(jl.debit - jl.credit) end as amount
    from acc_accounts a join acc_journal_lines jl on jl.account_id = a.id join acc_journals j on j.id = jl.journal_id
    where a.tenant_id = tid and a.type in ('income', 'expense') and j.jdate between p_from and p_to group by a.id having sum(jl.debit) + sum(jl.credit) > 0
  ), g as (
    select type, grp, sum(amount) as t, jsonb_agg(jsonb_build_object('id', id, 'code', code, 'name', name, 'amount', amount) order by code) as accs from base group by type, grp
  )
  select (select coalesce(jsonb_agg(jsonb_build_object('type', type, 'grp', grp, 'total', t, 'accounts', accs) order by type desc, grp), '[]') from g),
         coalesce(sum(amount) filter (where type = 'income'), 0), coalesce(sum(amount) filter (where type = 'expense'), 0),
         coalesce(sum(amount) filter (where grp = 'Revenue'), 0), coalesce(sum(amount) filter (where grp = 'Cost of sales'), 0)
    into groups, inc, exp, rev, cos from base;
  return jsonb_build_object('from', p_from, 'to', p_to, 'groups', groups, 'income', inc, 'expense', exp, 'revenue', rev, 'cost_of_sales', cos,
    'gross_profit', rev - cos, 'gross_margin', case when rev <> 0 then round((rev - cos) / rev * 100, 2) else 0 end, 'net_profit', inc - exp,
    'net_margin', case when rev <> 0 then round((inc - exp) / rev * 100, 2) else 0 end);
end $$;

create function acc_balance_sheet(p_asof date) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; fys date; groups jsonb; ret numeric; cur numeric; ta numeric; tl numeric; te numeric;
begin
  tid := acc_guard('acc_reports');
  fys := acc_period_start(tid, p_asof);
  select coalesce(jsonb_agg(jsonb_build_object('type', type, 'grp', grp, 'total', t, 'accounts', accs) order by type, grp), '[]') into groups from (
    select type, grp, sum(amt) t, jsonb_agg(jsonb_build_object('id', id, 'code', code, 'name', name, 'amount', amt) order by code) accs from (
      select a.type, a.grp, a.id, a.code, a.name, case when a.type = 'asset' then sum(jl.debit - jl.credit) else sum(jl.credit - jl.debit) end as amt
      from acc_accounts a join acc_journal_lines jl on jl.account_id = a.id join acc_journals j on j.id = jl.journal_id
      where a.tenant_id = tid and a.type in ('asset', 'liability', 'equity') and j.jdate <= p_asof group by a.id having sum(jl.debit) + sum(jl.credit) > 0) z group by type, grp) g;
  select coalesce(sum(jl.credit - jl.debit), 0) into ret from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id join acc_accounts a on a.id = jl.account_id
    where jl.tenant_id = tid and a.type in ('income', 'expense') and j.jdate < fys;
  select coalesce(sum(jl.credit - jl.debit), 0) into cur from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id join acc_accounts a on a.id = jl.account_id
    where jl.tenant_id = tid and a.type in ('income', 'expense') and j.jdate between fys and p_asof;
  select coalesce(sum((g->>'total')::numeric) filter (where g->>'type' = 'asset'), 0), coalesce(sum((g->>'total')::numeric) filter (where g->>'type' = 'liability'), 0),
         coalesce(sum((g->>'total')::numeric) filter (where g->>'type' = 'equity'), 0) into ta, tl, te from jsonb_array_elements(groups) g;
  return jsonb_build_object('asof', p_asof, 'groups', groups, 'retained_prior', ret, 'current_profit', cur, 'assets', ta, 'liabilities', tl, 'equity', te + ret + cur,
    'balanced', abs(ta - (tl + te + ret + cur)) < 0.005, 'difference', ta - (tl + te + ret + cur));
end $$;

-- cash flow: each journal that touches cash/bank is attributed to the account on the other side
create function acc_cash_flow(p_from date, p_to date) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; rows jsonb; op numeric; cl numeric;
begin
  tid := acc_guard('acc_reports');
  select coalesce(sum(jl.debit - jl.credit), 0) into op from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id join acc_accounts a on a.id = jl.account_id
    where jl.tenant_id = tid and (a.is_cash or a.is_bank) and j.jdate < p_from;
  select coalesce(sum(jl.debit - jl.credit), 0) into cl from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id join acc_accounts a on a.id = jl.account_id
    where jl.tenant_id = tid and (a.is_cash or a.is_bank) and j.jdate <= p_to;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.ord, r.name), '[]') into rows from (
    select case when a.type in ('equity') or a.system_key = 'loans' then 'Financing' when a.system_key in ('fixed_assets', 'accum_dep') then 'Investing' else 'Operating' end as activity,
           case when a.type in ('equity') or a.system_key = 'loans' then 3 when a.system_key in ('fixed_assets', 'accum_dep') then 2 else 1 end as ord,
           case a.system_key when 'ar' then 'Receipts from customers' when 'ap' then 'Payments to suppliers' else a.name end as name, sum(jl.credit - jl.debit) as amount
    from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id join acc_accounts a on a.id = jl.account_id
    where jl.tenant_id = tid and j.jdate between p_from and p_to and not (a.is_cash or a.is_bank)
      and exists (select 1 from acc_journal_lines c join acc_accounts ca on ca.id = c.account_id where c.journal_id = j.id and (ca.is_cash or ca.is_bank))
    group by 1, 2, 3 having sum(jl.credit - jl.debit) <> 0) r;
  return jsonb_build_object('from', p_from, 'to', p_to, 'opening', op, 'closing', cl, 'net', cl - op, 'rows', rows);
end $$;

-- ---------- receivables / payables ageing ----------
create function acc_ageing(p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; side text := coalesce(p->>'kind', 'receivable'); asof date := coalesce(nullif(p->>'as_of', '')::date, current_date); pid uuid := nullif(p->>'party_id', '')::uuid;
  rows jsonb; docs jsonb; tot jsonb;
begin
  tid := acc_guard('acc_view');
  with docs0 as (
    select d.party_id, d.id as doc_id, d.number, d.doc_type, d.doc_date, d.due_date,
      case when (side = 'receivable' and d.doc_type = 'credit_note') or (side = 'payable' and d.doc_type = 'debit_note') then -(d.total - d.paid) else d.total - d.paid end as amount,
      case when asof - coalesce(d.due_date, d.doc_date) <= 0 then 'current' when asof - coalesce(d.due_date, d.doc_date) <= 30 then 'd30' when asof - coalesce(d.due_date, d.doc_date) <= 60 then 'd60'
           when asof - coalesce(d.due_date, d.doc_date) <= 90 then 'd90' else 'd90p' end as bucket
    from acc_documents d
    where d.tenant_id = tid and d.status = 'posted' and d.total > d.paid and d.doc_date <= asof and (pid is null or d.party_id = pid)
      and ((side = 'receivable' and d.doc_type in ('invoice', 'credit_note')) or (side = 'payable' and d.doc_type in ('bill', 'expense', 'debit_note')))
  ), adv as (
    select pm.party_id, pm.id as doc_id, pm.number, pm.kind as doc_type, pm.pay_date as doc_date, pm.pay_date as due_date, -(pm.amount - pm.allocated) as amount, 'advance'::text as bucket
    from acc_payments pm where pm.tenant_id = tid and pm.status = 'posted' and pm.amount > pm.allocated and pm.pay_date <= asof and (pid is null or pm.party_id = pid)
      and ((side = 'receivable' and pm.kind = 'receipt') or (side = 'payable' and pm.kind = 'payment'))
  ), a as (select * from docs0 union all select * from adv)
  select coalesce((select jsonb_agg(to_jsonb(r) order by r.total desc) from (
           select x.party_id, pa.name, pa.phone, pa.credit_limit,
             sum(amount) filter (where bucket = 'current') as current, sum(amount) filter (where bucket = 'd30') as d30, sum(amount) filter (where bucket = 'd60') as d60,
             sum(amount) filter (where bucket = 'd90') as d90, sum(amount) filter (where bucket = 'd90p') as d90p, sum(amount) filter (where bucket = 'advance') as advance, sum(amount) as total
           from a x join acc_parties pa on pa.id = x.party_id group by x.party_id, pa.name, pa.phone, pa.credit_limit) r), '[]'),
         case when pid is not null then coalesce((select jsonb_agg(to_jsonb(x) order by x.doc_date) from a x), '[]') else '[]'::jsonb end,
         (select jsonb_build_object('current', coalesce(sum(amount) filter (where bucket = 'current'), 0), 'd30', coalesce(sum(amount) filter (where bucket = 'd30'), 0), 'd60', coalesce(sum(amount) filter (where bucket = 'd60'), 0),
               'd90', coalesce(sum(amount) filter (where bucket = 'd90'), 0), 'd90p', coalesce(sum(amount) filter (where bucket = 'd90p'), 0), 'advance', coalesce(sum(amount) filter (where bucket = 'advance'), 0), 'total', coalesce(sum(amount), 0)) from a)
    into rows, docs, tot;
  return jsonb_build_object('kind', side, 'as_of', asof, 'rows', rows, 'docs', docs, 'totals', tot);
end $$;

-- ---------- registers and performance ----------
create function acc_register(p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; kind text := coalesce(p->>'kind', 'sales'); fr date := nullif(p->>'from', '')::date; tt date := nullif(p->>'to', '')::date; grp text := coalesce(p->>'group', 'doc'); rows jsonb; types text[];
begin
  tid := acc_guard('acc_reports');
  types := case when kind = 'sales' then array['invoice', 'credit_note'] else array['bill', 'expense', 'debit_note'] end;
  if grp = 'doc' then
    select coalesce(jsonb_agg(to_jsonb(r) order by r.doc_date desc, r.number desc), '[]') into rows from (
      select d.id, d.doc_type, d.number, d.doc_date, d.party_id, d.party_name, d.party_gstin, d.supplier_ref, d.place_of_supply, d.supply_type, d.reverse_charge, d.itc_eligible,
        case when d.doc_type in ('credit_note', 'debit_note') then -1 else 1 end * d.taxable as taxable, case when d.doc_type in ('credit_note', 'debit_note') then -1 else 1 end * d.cgst as cgst,
        case when d.doc_type in ('credit_note', 'debit_note') then -1 else 1 end * d.sgst as sgst, case when d.doc_type in ('credit_note', 'debit_note') then -1 else 1 end * d.igst as igst,
        case when d.doc_type in ('credit_note', 'debit_note') then -1 else 1 end * d.cess as cess, case when d.doc_type in ('credit_note', 'debit_note') then -1 else 1 end * d.total as total, acc_doc_status(d) as status
      from acc_documents d where d.tenant_id = tid and d.doc_type = any(types) and d.status = 'posted' and not d.is_opening and (fr is null or d.doc_date >= fr) and (tt is null or d.doc_date <= tt)
        and (nullif(p->>'party_id', '') is null or d.party_id = (p->>'party_id')::uuid) and (nullif(p->>'branch_id', '') is null or d.branch_id = (p->>'branch_id')::uuid)) r;
  else
    select coalesce(jsonb_agg(to_jsonb(r) order by r.taxable desc), '[]') into rows from (
      select case grp when 'party' then coalesce(d.party_name, '-') when 'item' then coalesce(l.description, '-') when 'category' then coalesce(pr.category, 'Uncategorised') when 'month' then to_char(d.doc_date, 'YYYY-MM')
                      when 'branch' then coalesce((select name from acc_branches where id = d.branch_id), 'No branch') when 'tax_rate' then l.tax_rate::text || '%' when 'hsn' then coalesce(l.hsn, '-')
                      when 'payment_mode' then 'n/a' else '-' end as label,
        sum(case when d.doc_type in ('credit_note', 'debit_note') then -1 else 1 end * l.qty) as qty, sum(case when d.doc_type in ('credit_note', 'debit_note') then -1 else 1 end * l.taxable) as taxable,
        sum(case when d.doc_type in ('credit_note', 'debit_note') then -1 else 1 end * (l.cgst + l.sgst + l.igst + l.cess)) as tax, sum(case when d.doc_type in ('credit_note', 'debit_note') then -1 else 1 end * l.total) as total,
        count(distinct d.id) as docs
      from acc_documents d join acc_doc_lines l on l.doc_id = d.id left join acc_products pr on pr.id = l.product_id
      where d.tenant_id = tid and d.doc_type = any(types) and d.status = 'posted' and not d.is_opening and (fr is null or d.doc_date >= fr) and (tt is null or d.doc_date <= tt)
        and (nullif(p->>'branch_id', '') is null or d.branch_id = (p->>'branch_id')::uuid)
      group by 1) r;
  end if;
  return jsonb_build_object('kind', kind, 'group', grp, 'rows', rows,
    'totals', (select jsonb_build_object('taxable', coalesce(sum((r->>'taxable')::numeric), 0), 'total', coalesce(sum((r->>'total')::numeric), 0)) from jsonb_array_elements(rows) r));
end $$;

-- sales split by how it was settled (cash, UPI, card ... from the receipts raised with the sale)
create function acc_payment_mode_sales(p_from date, p_to date) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := acc_guard('acc_reports');
  return jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(r) order by r.amount desc) from (
    select coalesce(nullif(pm.mode, ''), 'Unspecified') as mode, count(*) as receipts, sum(pm.amount) as amount from acc_payments pm
    where pm.tenant_id = tid and pm.kind = 'receipt' and pm.status = 'posted' and pm.pay_date between p_from and p_to group by 1) r), '[]'));
end $$;

-- ---------- inventory reports ----------
create function acc_stock_summary(p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; asof date := coalesce(nullif(p->>'as_of', '')::date, current_date); wid uuid := nullif(p->>'warehouse_id', '')::uuid;
begin
  tid := acc_guard('acc_reports');
  return jsonb_build_object('as_of', asof, 'rows', coalesce((select jsonb_agg(to_jsonb(r) order by lower(r.name)) from (
    select pr.id, pr.sku, pr.name, pr.category, pr.unit, pr.reorder_level, sum(sm.qty) as qty, sum(sm.qty * sm.unit_cost) as value,
           case when sum(sm.qty) > 0 then round(sum(sm.qty * sm.unit_cost) / sum(sm.qty), 4) else pr.purchase_price end as avg_cost,
           case when pr.reorder_level > 0 and sum(sm.qty) <= pr.reorder_level then true else false end as low
    from acc_products pr join acc_stock_moves sm on sm.product_id = pr.id
    where pr.tenant_id = tid and sm.move_date <= asof and (wid is null or sm.warehouse_id = wid) group by pr.id having sum(sm.qty) <> 0) r), '[]'),
    'total_value', (select coalesce(sum(qty * unit_cost), 0) from acc_stock_moves where tenant_id = tid and move_date <= asof and (wid is null or warehouse_id = wid)));
end $$;

create function acc_stock_movement(p_from date, p_to date) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := acc_guard('acc_reports');
  return jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(r) order by lower(r.name)) from (
    select pr.id, pr.sku, pr.name, pr.unit,
      coalesce(sum(sm.qty) filter (where sm.move_date < p_from), 0) as opening,
      coalesce(sum(sm.qty) filter (where sm.move_date between p_from and p_to and sm.qty > 0), 0) as qty_in,
      coalesce(-sum(sm.qty) filter (where sm.move_date between p_from and p_to and sm.qty < 0), 0) as qty_out,
      coalesce(sum(sm.qty) filter (where sm.move_date <= p_to), 0) as closing,
      coalesce(sum(sm.qty * sm.unit_cost) filter (where sm.move_date <= p_to), 0) as closing_value
    from acc_products pr join acc_stock_moves sm on sm.product_id = pr.id where pr.tenant_id = tid group by pr.id) r), '[]'));
end $$;

-- fast / slow / dead stock from units sold over the last N days
create function acc_stock_velocity(p_days int default 90) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := acc_guard('acc_reports');
  return jsonb_build_object('days', p_days, 'rows', coalesce((select jsonb_agg(to_jsonb(r) order by r.sold desc) from (
    select pr.id, pr.sku, pr.name, coalesce(s.q, 0) as stock, coalesce(sold.q, 0) as sold, sold.last_sale,
      case when coalesce(sold.q, 0) = 0 then 'dead' when coalesce(sold.q, 0) >= greatest(coalesce(s.q, 0), 1) * 0.5 then 'fast' else 'slow' end as class
    from acc_products pr
    left join (select product_id, sum(qty) q from acc_stock_moves where tenant_id = tid group by product_id) s on s.product_id = pr.id
    left join (select product_id, -sum(qty) q, max(move_date) last_sale from acc_stock_moves where tenant_id = tid and kind = 'sale' and move_date > current_date - p_days group by product_id) sold on sold.product_id = pr.id
    where pr.tenant_id = tid and pr.track_stock and not pr.is_service and pr.active and coalesce(s.q, 0) > 0) r), '[]'));
end $$;

create function acc_stock_batches(p_before date default null) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := acc_guard('acc_reports');
  return jsonb_build_object('batches', coalesce((select jsonb_agg(to_jsonb(r) order by r.expiry nulls last, r.name) from (
    select pr.id as product_id, pr.name, pr.sku, sm.batch_no, max(sm.expiry) as expiry, sum(sm.qty) as qty from acc_stock_moves sm join acc_products pr on pr.id = sm.product_id
    where sm.tenant_id = tid and sm.batch_no is not null group by pr.id, sm.batch_no having sum(sm.qty) > 0 and (p_before is null or max(sm.expiry) <= p_before)) r), '[]'),
    'serials', coalesce((select jsonb_agg(to_jsonb(r) order by r.name) from (
    select pr.id as product_id, pr.name, pr.sku, sm.serial_no, sum(sm.qty) as qty from acc_stock_moves sm join acc_products pr on pr.id = sm.product_id
    where sm.tenant_id = tid and sm.serial_no is not null group by pr.id, sm.serial_no having sum(sm.qty) > 0) r), '[]'));
end $$;

-- ---------- GST ----------
create function acc_gst_summary(p_from date, p_to date) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; outw jsonb; inw jsonb; o record; i record; rcm record; igst_c numeric; cgst_c numeric; sgst_c numeric; setoff jsonb; pay_i numeric; pay_c numeric; pay_s numeric;
  ci numeric; cc numeric; cs numeric; oi numeric; oc numeric; os numeric;
begin
  tid := acc_guard('acc_reports');
  select coalesce(sum(case when d.doc_type = 'credit_note' then -1 else 1 end * d.taxable), 0) as taxable, coalesce(sum(case when d.doc_type = 'credit_note' then -1 else 1 end * d.cgst), 0) as cgst,
         coalesce(sum(case when d.doc_type = 'credit_note' then -1 else 1 end * d.sgst), 0) as sgst, coalesce(sum(case when d.doc_type = 'credit_note' then -1 else 1 end * d.igst), 0) as igst,
         coalesce(sum(case when d.doc_type = 'credit_note' then -1 else 1 end * d.cess), 0) as cess into o
  from acc_documents d where d.tenant_id = tid and d.doc_type in ('invoice', 'credit_note') and d.status = 'posted' and not d.is_opening and d.doc_date between p_from and p_to;
  select coalesce(sum(case when d.doc_type = 'debit_note' then -1 else 1 end * d.taxable) filter (where d.itc_eligible), 0) as taxable,
         coalesce(sum(case when d.doc_type = 'debit_note' then -1 else 1 end * d.cgst) filter (where d.itc_eligible), 0) as cgst, coalesce(sum(case when d.doc_type = 'debit_note' then -1 else 1 end * d.sgst) filter (where d.itc_eligible), 0) as sgst,
         coalesce(sum(case when d.doc_type = 'debit_note' then -1 else 1 end * d.igst) filter (where d.itc_eligible), 0) as igst, coalesce(sum(case when d.doc_type = 'debit_note' then -1 else 1 end * d.cess) filter (where d.itc_eligible), 0) as cess,
         coalesce(sum(d.cgst + d.sgst + d.igst + d.cess) filter (where not d.itc_eligible), 0) as blocked into i
  from acc_documents d where d.tenant_id = tid and d.doc_type in ('bill', 'expense', 'debit_note') and d.status = 'posted' and d.doc_date between p_from and p_to;
  select coalesce(sum(case when d.doc_type = 'debit_note' then -1 else 1 end * d.cgst), 0) as cgst, coalesce(sum(case when d.doc_type = 'debit_note' then -1 else 1 end * d.sgst), 0) as sgst,
         coalesce(sum(case when d.doc_type = 'debit_note' then -1 else 1 end * d.igst), 0) as igst, coalesce(sum(case when d.doc_type = 'debit_note' then -1 else 1 end * d.cess), 0) as cess into rcm
  from acc_documents d where d.tenant_id = tid and d.doc_type in ('bill', 'expense', 'debit_note') and d.status = 'posted' and d.reverse_charge and d.doc_date between p_from and p_to;
  -- indicative set-off order: IGST credit -> IGST, CGST, SGST;  CGST credit -> CGST, IGST;  SGST credit -> SGST, IGST
  oi := o.igst + rcm.igst; oc := o.cgst + rcm.cgst; os := o.sgst + rcm.sgst; ci := i.igst; cc := i.cgst; cs := i.sgst;
  declare use_i_i numeric := least(ci, oi); use_i_c numeric; use_i_s numeric; use_c_c numeric; use_c_i numeric; use_s_s numeric; use_s_i numeric;
  begin
    ci := ci - use_i_i; oi := oi - use_i_i;
    use_i_c := least(ci, oc); ci := ci - use_i_c; oc := oc - use_i_c;
    use_i_s := least(ci, os); ci := ci - use_i_s; os := os - use_i_s;
    use_c_c := least(cc, oc); cc := cc - use_c_c; oc := oc - use_c_c;
    use_c_i := least(cc, oi); cc := cc - use_c_i; oi := oi - use_c_i;
    use_s_s := least(cs, os); cs := cs - use_s_s; os := os - use_s_s;
    use_s_i := least(cs, oi); cs := cs - use_s_i; oi := oi - use_s_i;
  end;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.tax_rate), '[]') into outw from (
    select l.tax_rate, sum(case when d.doc_type = 'credit_note' then -1 else 1 end * l.taxable) as taxable, sum(case when d.doc_type = 'credit_note' then -1 else 1 end * l.cgst) as cgst,
           sum(case when d.doc_type = 'credit_note' then -1 else 1 end * l.sgst) as sgst, sum(case when d.doc_type = 'credit_note' then -1 else 1 end * l.igst) as igst, sum(case when d.doc_type = 'credit_note' then -1 else 1 end * l.cess) as cess
    from acc_documents d join acc_doc_lines l on l.doc_id = d.id where d.tenant_id = tid and d.doc_type in ('invoice', 'credit_note') and d.status = 'posted' and not d.is_opening and d.doc_date between p_from and p_to group by l.tax_rate) r;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.tax_rate), '[]') into inw from (
    select l.tax_rate, sum(case when d.doc_type = 'debit_note' then -1 else 1 end * l.taxable) as taxable, sum(case when d.doc_type = 'debit_note' then -1 else 1 end * l.cgst) as cgst,
           sum(case when d.doc_type = 'debit_note' then -1 else 1 end * l.sgst) as sgst, sum(case when d.doc_type = 'debit_note' then -1 else 1 end * l.igst) as igst, sum(case when d.doc_type = 'debit_note' then -1 else 1 end * l.cess) as cess
    from acc_documents d join acc_doc_lines l on l.doc_id = d.id where d.tenant_id = tid and d.doc_type in ('bill', 'expense', 'debit_note') and d.status = 'posted' and d.itc_eligible and d.doc_date between p_from and p_to group by l.tax_rate) r;
  return jsonb_build_object('from', p_from, 'to', p_to, 'output', to_jsonb(o), 'itc', to_jsonb(i), 'rcm', to_jsonb(rcm), 'output_by_rate', outw, 'itc_by_rate', inw,
    'payable', jsonb_build_object('igst', oi, 'cgst', oc, 'sgst', os, 'cess', greatest(o.cess + rcm.cess - i.cess, 0)),
    'carry_forward_itc', jsonb_build_object('igst', ci, 'cgst', cc, 'sgst', cs),
    'locked', exists (select 1 from acc_gst_periods where tenant_id = tid and period = to_char(p_from, 'YYYY-MM')),
    'note', 'Indicative workings from your books. Confirm with your CA before filing.');
end $$;

-- GSTR-style datasets (b2b, b2c, cdn, hsn, exempt) and the purchase side (purchases, itc, rcm)
create function acc_gst_register(p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; t text := coalesce(p->>'type', 'b2b'); fr date := (p->>'from')::date; tt date := (p->>'to')::date; rows jsonb;
begin
  tid := acc_guard('acc_reports');
  if t = 'b2b' then
    select coalesce(jsonb_agg(to_jsonb(r) order by r.doc_date, r.number), '[]') into rows from (
      select d.party_gstin as gstin, d.party_name, d.number, d.doc_date, d.total, d.place_of_supply, d.reverse_charge, l.tax_rate as rate, sum(l.taxable) as taxable, sum(l.igst) as igst, sum(l.cgst) as cgst, sum(l.sgst) as sgst, sum(l.cess) as cess
      from acc_documents d join acc_doc_lines l on l.doc_id = d.id where d.tenant_id = tid and d.doc_type = 'invoice' and d.status = 'posted' and not d.is_opening and d.party_gstin is not null and d.doc_date between fr and tt
      group by d.id, l.tax_rate) r;
  elsif t = 'b2c' then
    select coalesce(jsonb_agg(to_jsonb(r) order by r.place_of_supply, r.rate), '[]') into rows from (
      select d.place_of_supply, d.supply_type, l.tax_rate as rate, sum(case when d.doc_type = 'credit_note' then -1 else 1 end * l.taxable) as taxable, sum(case when d.doc_type = 'credit_note' then -1 else 1 end * l.igst) as igst,
             sum(case when d.doc_type = 'credit_note' then -1 else 1 end * l.cgst) as cgst, sum(case when d.doc_type = 'credit_note' then -1 else 1 end * l.sgst) as sgst, sum(case when d.doc_type = 'credit_note' then -1 else 1 end * l.cess) as cess
      from acc_documents d join acc_doc_lines l on l.doc_id = d.id where d.tenant_id = tid and d.doc_type in ('invoice', 'credit_note') and d.status = 'posted' and not d.is_opening and d.party_gstin is null and d.doc_date between fr and tt
      group by d.place_of_supply, d.supply_type, l.tax_rate) r;
  elsif t = 'cdn' then
    select coalesce(jsonb_agg(to_jsonb(r) order by r.doc_date, r.number), '[]') into rows from (
      select d.doc_type, d.number, d.doc_date, d.party_gstin as gstin, d.party_name, (select number from acc_documents where id = d.ref_doc_id) as against, d.taxable, d.igst, d.cgst, d.sgst, d.cess, d.total
      from acc_documents d where d.tenant_id = tid and d.doc_type in ('credit_note', 'debit_note') and d.status = 'posted' and d.doc_date between fr and tt) r;
  elsif t = 'hsn' then
    select coalesce(jsonb_agg(to_jsonb(r) order by r.hsn), '[]') into rows from (
      select coalesce(l.hsn, '-') as hsn, max(l.unit) as unit, sum(case when d.doc_type = 'credit_note' then -1 else 1 end * l.qty) as qty, sum(case when d.doc_type = 'credit_note' then -1 else 1 end * l.total) as value,
             sum(case when d.doc_type = 'credit_note' then -1 else 1 end * l.taxable) as taxable, sum(case when d.doc_type = 'credit_note' then -1 else 1 end * l.igst) as igst, sum(case when d.doc_type = 'credit_note' then -1 else 1 end * l.cgst) as cgst,
             sum(case when d.doc_type = 'credit_note' then -1 else 1 end * l.sgst) as sgst, sum(case when d.doc_type = 'credit_note' then -1 else 1 end * l.cess) as cess
      from acc_documents d join acc_doc_lines l on l.doc_id = d.id where d.tenant_id = tid and d.doc_type in ('invoice', 'credit_note') and d.status = 'posted' and not d.is_opening and d.doc_date between fr and tt group by l.hsn) r;
  elsif t = 'exempt' then
    select coalesce(jsonb_agg(to_jsonb(r)), '[]') into rows from (
      select case when d.supply_type = 'inter' then 'Inter-state' else 'Intra-state' end as supply, case when d.party_gstin is null then 'Unregistered' else 'Registered' end as buyer, sum(l.taxable) as taxable
      from acc_documents d join acc_doc_lines l on l.doc_id = d.id where d.tenant_id = tid and d.doc_type = 'invoice' and d.status = 'posted' and not d.is_opening and l.tax_rate = 0 and d.doc_date between fr and tt group by 1, 2) r;
  elsif t in ('purchases', 'itc', 'rcm') then
    select coalesce(jsonb_agg(to_jsonb(r) order by r.doc_date, r.number), '[]') into rows from (
      select d.doc_type, d.number, d.doc_date, d.supplier_ref, d.supplier_ref_date, d.party_name, (select gstin from acc_parties where id = d.party_id) as gstin, d.reverse_charge, d.itc_eligible,
             case when d.doc_type = 'debit_note' then -1 else 1 end * d.taxable as taxable, case when d.doc_type = 'debit_note' then -1 else 1 end * d.igst as igst, case when d.doc_type = 'debit_note' then -1 else 1 end * d.cgst as cgst,
             case when d.doc_type = 'debit_note' then -1 else 1 end * d.sgst as sgst, case when d.doc_type = 'debit_note' then -1 else 1 end * d.cess as cess, case when d.doc_type = 'debit_note' then -1 else 1 end * d.total as total
      from acc_documents d where d.tenant_id = tid and d.doc_type in ('bill', 'expense', 'debit_note') and d.status = 'posted' and d.doc_date between fr and tt
        and (t = 'purchases' or (t = 'itc' and d.itc_eligible and d.cgst + d.sgst + d.igst + d.cess > 0) or (t = 'rcm' and d.reverse_charge))) r;
  else raise exception 'Unknown GST register %', t; end if;
  return jsonb_build_object('type', t, 'from', fr, 'to', tt, 'rows', rows);
end $$;

-- things a reviewer should look at before filing
create function acc_gst_exceptions(p_from date, p_to date) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; o acc_org;
begin
  tid := acc_guard('acc_reports');
  select * into o from acc_org where tenant_id = tid;
  return jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(r) order by r.kind, r.number) from (
    select 'Missing GSTIN' as kind, d.id as doc_id, d.number, d.doc_type, 'Customer is registered but the invoice has no GSTIN' as message from acc_documents d join acc_parties pa on pa.id = d.party_id
      where d.tenant_id = tid and d.doc_type = 'invoice' and d.status = 'posted' and pa.reg_type in ('regular', 'composition') and d.party_gstin is null and d.doc_date between p_from and p_to
    union all
    select 'Missing HSN/SAC', d.id, d.number, d.doc_type, 'A line has no HSN/SAC code' from acc_documents d
      where d.tenant_id = tid and d.status = 'posted' and d.doc_type in ('invoice', 'credit_note', 'bill', 'debit_note') and d.cgst + d.sgst + d.igst > 0 and d.doc_date between p_from and p_to
        and exists (select 1 from acc_doc_lines l where l.doc_id = d.id and coalesce(l.hsn, '') = '')
    union all
    select 'Supplier GSTIN missing', d.id, d.number, d.doc_type, 'Input tax claimed but the supplier has no GSTIN' from acc_documents d join acc_parties pa on pa.id = d.party_id
      where d.tenant_id = tid and d.doc_type in ('bill', 'expense') and d.status = 'posted' and d.itc_eligible and d.cgst + d.sgst + d.igst > 0 and pa.gstin is null and d.doc_date between p_from and p_to
    union all
    select 'Tax type mismatch', d.id, d.number, d.doc_type, 'Place of supply and the tax charged (IGST vs CGST/SGST) do not agree' from acc_documents d
      where d.tenant_id = tid and d.status = 'posted' and ((d.supply_type = 'inter' and d.cgst + d.sgst > 0) or (d.supply_type = 'intra' and d.igst > 0)) and d.doc_date between p_from and p_to
    union all
    select 'Rate differs from master', d.id, d.number, d.doc_type, l.description || ': ' || l.tax_rate || '% used, master says ' || pr.tax_rate || '%' from acc_documents d join acc_doc_lines l on l.doc_id = d.id join acc_products pr on pr.id = l.product_id
      where d.tenant_id = tid and d.status = 'posted' and l.tax_rate <> pr.tax_rate and d.cgst + d.sgst + d.igst > 0 and d.doc_date between p_from and p_to
    union all
    select 'E-invoice pending', d.id, d.number, d.doc_type, 'B2B invoice has no IRN recorded' from acc_documents d left join acc_einvoice e on e.doc_id = d.id
      where d.tenant_id = tid and d.doc_type = 'invoice' and d.status = 'posted' and d.party_gstin is not null and o.gstin is not null and coalesce(e.status, 'not_generated') <> 'generated'
        and coalesce((o.settings->>'einvoice_enabled')::boolean, false) and d.doc_date between p_from and p_to
    union all
    select 'Draft in period', d.id, d.number, d.doc_type, 'Draft document is not yet posted' from acc_documents d where d.tenant_id = tid and d.status = 'draft' and d.doc_date between p_from and p_to) r), '[]'));
end $$;

-- ---------- dashboard ----------
create function acc_dashboard(p jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; o acc_org; t date := current_date; ms date := date_trunc('month', current_date)::date; pms date := (date_trunc('month', current_date) - interval '1 month')::date;
  fys date; pfys date; pfye date; branch uuid := nullif(p->>'branch_id', '')::uuid; res jsonb;
  sales_today numeric; purch_today numeric; coll_today numeric; exp_today numeric; ar numeric; ap numeric; ar_over numeric; ap_over numeric; stockv numeric; cashbank jsonb;
  sales_m numeric; sales_pm numeric; inc_m numeric; exp_m numeric; inc_pm numeric; exp_pm numeric; rev_m numeric; cos_m numeric; sales_fy numeric; sales_pfy numeric; trend jsonb; etrend jsonb; topp jsonb; lowp jsonb; topc jsonb; branches jsonb; budget jsonb;
begin
  tid := acc_guard('acc_view');
  select * into o from acc_org where tenant_id = tid;
  fys := acc_period_start(tid, t); pfys := (fys - interval '1 year')::date; pfye := fys - 1;
  select coalesce(sum(case when doc_type = 'credit_note' then -total else total end), 0) into sales_today from acc_documents where tenant_id = tid and status = 'posted' and doc_type in ('invoice', 'credit_note') and doc_date = t and not is_opening and (branch is null or branch_id = branch);
  select coalesce(sum(case when doc_type = 'debit_note' then -total else total end), 0) into purch_today from acc_documents where tenant_id = tid and status = 'posted' and doc_type in ('bill', 'debit_note') and doc_date = t and not is_opening and (branch is null or branch_id = branch);
  select coalesce(sum(amount), 0) into coll_today from acc_payments where tenant_id = tid and kind = 'receipt' and status = 'posted' and pay_date = t and (branch is null or branch_id = branch);
  select coalesce(sum(jl.debit - jl.credit), 0) into exp_today from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id join acc_accounts a on a.id = jl.account_id
    where jl.tenant_id = tid and a.type = 'expense' and a.grp not in ('Cost of sales') and j.jdate = t;
  select coalesce(sum(jl.debit - jl.credit), 0) into ar from acc_journal_lines jl join acc_accounts a on a.id = jl.account_id where jl.tenant_id = tid and a.system_key = 'ar';
  select coalesce(sum(jl.credit - jl.debit), 0) into ap from acc_journal_lines jl join acc_accounts a on a.id = jl.account_id where jl.tenant_id = tid and a.system_key = 'ap';
  select coalesce(sum(total - paid), 0) into ar_over from acc_documents where tenant_id = tid and status = 'posted' and doc_type = 'invoice' and total > paid and due_date < t;
  select coalesce(sum(total - paid), 0) into ap_over from acc_documents where tenant_id = tid and status = 'posted' and doc_type in ('bill', 'expense') and total > paid and due_date < t;
  select coalesce(sum(jl.debit - jl.credit), 0) into stockv from acc_journal_lines jl join acc_accounts a on a.id = jl.account_id where jl.tenant_id = tid and a.system_key = 'inventory';
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'balance', b) order by a.code), '[]') into cashbank from acc_accounts a
    cross join lateral (select coalesce(sum(jl.debit - jl.credit), 0) b from acc_journal_lines jl where jl.account_id = a.id) x where a.tenant_id = tid and (a.is_cash or a.is_bank) and a.active;
  select coalesce(sum(case when doc_type = 'credit_note' then -taxable else taxable end) filter (where doc_date >= ms), 0), coalesce(sum(case when doc_type = 'credit_note' then -taxable else taxable end) filter (where doc_date >= pms and doc_date < ms), 0),
         coalesce(sum(case when doc_type = 'credit_note' then -taxable else taxable end) filter (where doc_date >= fys), 0), coalesce(sum(case when doc_type = 'credit_note' then -taxable else taxable end) filter (where doc_date between pfys and pfye), 0)
    into sales_m, sales_pm, sales_fy, sales_pfy from acc_documents where tenant_id = tid and status = 'posted' and doc_type in ('invoice', 'credit_note') and not is_opening and doc_date >= pfys;
  select coalesce(sum(jl.credit - jl.debit) filter (where a.type = 'income' and j.jdate >= ms), 0), coalesce(sum(jl.debit - jl.credit) filter (where a.type = 'expense' and j.jdate >= ms), 0),
         coalesce(sum(jl.credit - jl.debit) filter (where a.type = 'income' and j.jdate >= pms and j.jdate < ms), 0), coalesce(sum(jl.debit - jl.credit) filter (where a.type = 'expense' and j.jdate >= pms and j.jdate < ms), 0),
         coalesce(sum(jl.credit - jl.debit) filter (where a.grp = 'Revenue' and j.jdate >= ms), 0), coalesce(sum(jl.debit - jl.credit) filter (where a.grp = 'Cost of sales' and j.jdate >= ms), 0)
    into inc_m, exp_m, inc_pm, exp_pm, rev_m, cos_m
    from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id join acc_accounts a on a.id = jl.account_id where jl.tenant_id = tid and a.type in ('income', 'expense') and j.jdate >= pms;
  select coalesce(jsonb_agg(jsonb_build_object('d', d::date, 'sales', coalesce(s.v, 0)) order by d), '[]') into trend from generate_series(t - 29, t, interval '1 day') d
    left join (select doc_date, sum(case when doc_type = 'credit_note' then -taxable else taxable end) v from acc_documents where tenant_id = tid and status = 'posted' and doc_type in ('invoice', 'credit_note') and not is_opening and doc_date > t - 30 group by doc_date) s on s.doc_date = d::date;
  select coalesce(jsonb_agg(jsonb_build_object('m', to_char(m, 'YYYY-MM'), 'expense', coalesce(e.v, 0)) order by m), '[]') into etrend from generate_series(date_trunc('month', t) - interval '5 months', date_trunc('month', t), interval '1 month') m
    left join (select date_trunc('month', j.jdate) mm, sum(jl.debit - jl.credit) v from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id join acc_accounts a on a.id = jl.account_id
               where jl.tenant_id = tid and a.type = 'expense' and a.grp <> 'Cost of sales' and j.jdate >= date_trunc('month', t) - interval '5 months' group by 1) e on e.mm = m;
  select coalesce(jsonb_agg(to_jsonb(r)), '[]') into topp from (select l.description as name, sum(case when d.doc_type = 'credit_note' then -1 else 1 end * l.qty) as qty, sum(case when d.doc_type = 'credit_note' then -1 else 1 end * l.taxable) as revenue,
      sum(case when d.doc_type = 'credit_note' then -1 else 1 end * (l.taxable - l.qty * l.unit_cost)) as profit
    from acc_documents d join acc_doc_lines l on l.doc_id = d.id where d.tenant_id = tid and d.status = 'posted' and d.doc_type in ('invoice', 'credit_note') and d.doc_date > t - 30 group by l.description order by revenue desc limit 5) r;
  select coalesce(jsonb_agg(to_jsonb(r)), '[]') into lowp from (select l.description as name, sum(l.qty) as qty, sum(l.taxable) as revenue from acc_documents d join acc_doc_lines l on l.doc_id = d.id
    where d.tenant_id = tid and d.status = 'posted' and d.doc_type = 'invoice' and d.doc_date > t - 30 group by l.description order by revenue asc limit 5) r;
  select coalesce(jsonb_agg(to_jsonb(r)), '[]') into topc from (select party_name as name, sum(case when doc_type = 'credit_note' then -taxable else taxable end) as revenue, count(*) filter (where doc_type = 'invoice') as invoices
    from acc_documents where tenant_id = tid and status = 'posted' and doc_type in ('invoice', 'credit_note') and doc_date >= fys and not is_opening group by party_name order by revenue desc limit 5) r;
  select coalesce(jsonb_agg(to_jsonb(r)), '[]') into branches from (select coalesce(b.name, 'No branch') as name, sum(case when d.doc_type = 'credit_note' then -d.taxable else d.taxable end) as sales
    from acc_documents d left join acc_branches b on b.id = d.branch_id where d.tenant_id = tid and d.status = 'posted' and d.doc_type in ('invoice', 'credit_note') and d.doc_date >= ms and not d.is_opening group by 1 order by 2 desc) r;
  select coalesce(jsonb_agg(to_jsonb(r)), '[]') into budget from (
    select a.name, b.amount as budget, coalesce(act.v, 0) as actual from acc_budgets b join acc_accounts a on a.id = b.account_id join acc_fy f on f.id = b.fy_id and f.tenant_id = tid
    left join lateral (select sum(case when a.type = 'income' then jl.credit - jl.debit else jl.debit - jl.credit end) v from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id
      where jl.account_id = a.id and j.jdate >= ms and j.jdate < (ms + interval '1 month')) act on true
    where b.tenant_id = tid and b.month = extract(month from t)::int and t between f.start_date and f.end_date and b.amount <> 0) r;
  return jsonb_build_object('today', t, 'sales_today', sales_today, 'purchases_today', purch_today, 'collections_today', coll_today, 'expenses_today', exp_today,
    'receivables', ar, 'payables', ap, 'overdue_receivables', ar_over, 'overdue_payables', ap_over, 'stock_value', stockv, 'cash_bank', cashbank,
    'month', jsonb_build_object('sales', sales_m, 'prev_sales', sales_pm, 'income', inc_m, 'expense', exp_m, 'profit', inc_m - exp_m, 'prev_profit', inc_pm - exp_pm,
        'gross_margin', case when rev_m <> 0 then round((rev_m - cos_m) / rev_m * 100, 1) else 0 end),
    'fy', jsonb_build_object('sales', sales_fy, 'prev_sales', sales_pfy), 'sales_trend', trend, 'expense_trend', etrend, 'top_products', topp, 'low_products', lowp, 'top_customers', topc, 'branches', branches, 'budget', budget,
    'alerts', jsonb_build_object(
      'low_stock', (select count(*) from acc_products pr where pr.tenant_id = tid and pr.reorder_level > 0 and pr.track_stock and not pr.is_service and pr.active and acc_stock_qty(tid, pr.id) <= pr.reorder_level),
      'overdue_invoices', (select count(*) from acc_documents where tenant_id = tid and status = 'posted' and doc_type = 'invoice' and total > paid and due_date < t),
      'drafts', (select count(*) from acc_documents where tenant_id = tid and status = 'draft' and not coalesce((meta->>'pending_approval')::boolean, false)),
      'pending_approval', (select count(*) from acc_documents where tenant_id = tid and status = 'draft' and coalesce((meta->>'pending_approval')::boolean, false)),
      'unmatched_bank', (select count(*) from acc_bank_txns where tenant_id = tid and status = 'unmatched'),
      'bills_due_week', (select count(*) from acc_documents where tenant_id = tid and status = 'posted' and doc_type in ('bill', 'expense') and total > paid and due_date between t and t + 7)));
end $$;

-- ---------- integrity: the invariants the spec calls non-negotiable ----------
create function acc_integrity_check() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; checks jsonb := '[]'; v numeric; w numeric; n int;
begin
  tid := acc_guard('acc_view');
  select count(*) into n from (select journal_id from acc_journal_lines where tenant_id = tid group by journal_id having sum(debit) <> sum(credit)) x;
  checks := checks || jsonb_build_array(jsonb_build_object('name', 'Every journal balances', 'ok', n = 0, 'detail', n || ' unbalanced'));
  select coalesce(sum(debit), 0), coalesce(sum(credit), 0) into v, w from acc_journal_lines where tenant_id = tid;
  checks := checks || jsonb_build_array(jsonb_build_object('name', 'Trial balance debits equal credits', 'ok', v = w, 'detail', v || ' / ' || w));
  select count(*) into n from acc_documents where tenant_id = tid and status in ('posted', 'cancelled') and doc_type in ('invoice', 'credit_note', 'bill', 'debit_note', 'expense') and journal_id is null;
  checks := checks || jsonb_build_array(jsonb_build_object('name', 'Every posted document has a journal', 'ok', n = 0, 'detail', n || ' without'));
  select count(*) into n from acc_documents d where d.tenant_id = tid and d.status = 'posted' and d.paid <> coalesce((select sum(amount) from acc_allocations where reversed_at is null and (doc_id = d.id or credit_doc_id = d.id)), 0);
  checks := checks || jsonb_build_array(jsonb_build_object('name', 'Document paid amounts match their allocations', 'ok', n = 0, 'detail', n || ' differ'));
  select count(*) into n from acc_payments pm where pm.tenant_id = tid and pm.status = 'posted' and pm.allocated <> coalesce((select sum(amount) from acc_allocations where reversed_at is null and payment_id = pm.id), 0);
  checks := checks || jsonb_build_array(jsonb_build_object('name', 'Receipt/payment allocations add up', 'ok', n = 0, 'detail', n || ' differ'));
  -- receivable control account equals what customers owe, net of advances and credit notes
  select coalesce(sum(jl.debit - jl.credit), 0) into v from acc_journal_lines jl join acc_accounts a on a.id = jl.account_id where jl.tenant_id = tid and a.system_key = 'ar';
  select coalesce((select sum(total - paid) from acc_documents where tenant_id = tid and status = 'posted' and doc_type = 'invoice'), 0)
       - coalesce((select sum(total - paid) from acc_documents where tenant_id = tid and status = 'posted' and doc_type = 'credit_note'), 0)
       - coalesce((select sum(pm.amount - pm.allocated) from acc_payments pm where pm.tenant_id = tid and pm.status = 'posted' and pm.kind = 'receipt' and exists (select 1 from acc_journal_lines l join acc_accounts a on a.id = l.account_id where l.journal_id = pm.journal_id and a.system_key = 'ar')), 0)
       + coalesce((select sum(pm.amount - pm.allocated) from acc_payments pm where pm.tenant_id = tid and pm.status = 'posted' and pm.kind = 'payment' and exists (select 1 from acc_journal_lines l join acc_accounts a on a.id = l.account_id where l.journal_id = pm.journal_id and a.system_key = 'ar')), 0) into w;
  checks := checks || jsonb_build_array(jsonb_build_object('name', 'Receivables ledger equals customer outstanding', 'ok', v = w, 'detail', v || ' vs ' || w));
  select coalesce(sum(jl.credit - jl.debit), 0) into v from acc_journal_lines jl join acc_accounts a on a.id = jl.account_id where jl.tenant_id = tid and a.system_key = 'ap';
  select coalesce((select sum(total - paid) from acc_documents where tenant_id = tid and status = 'posted' and doc_type in ('bill', 'expense')), 0)
       - coalesce((select sum(total - paid) from acc_documents where tenant_id = tid and status = 'posted' and doc_type = 'debit_note'), 0)
       - coalesce((select sum(pm.amount - pm.allocated) from acc_payments pm where pm.tenant_id = tid and pm.status = 'posted' and pm.kind = 'payment' and exists (select 1 from acc_journal_lines l join acc_accounts a on a.id = l.account_id where l.journal_id = pm.journal_id and a.system_key = 'ap')), 0)
       + coalesce((select sum(pm.amount - pm.allocated) from acc_payments pm where pm.tenant_id = tid and pm.status = 'posted' and pm.kind = 'receipt' and exists (select 1 from acc_journal_lines l join acc_accounts a on a.id = l.account_id where l.journal_id = pm.journal_id and a.system_key = 'ap')), 0) into w;
  checks := checks || jsonb_build_array(jsonb_build_object('name', 'Payables ledger equals supplier outstanding', 'ok', v = w, 'detail', v || ' vs ' || w));
  select coalesce(sum(jl.debit - jl.credit), 0) into v from acc_journal_lines jl join acc_accounts a on a.id = jl.account_id where jl.tenant_id = tid and a.system_key = 'inventory';
  select coalesce(sum(round(qty * unit_cost, 2)), 0) into w from acc_stock_moves where tenant_id = tid;
  checks := checks || jsonb_build_array(jsonb_build_object('name', 'Inventory ledger equals stock valuation', 'ok', abs(v - w) <= greatest(0.05 * (select count(*) from acc_stock_moves where tenant_id = tid), 0.05), 'detail', v || ' vs ' || w));
  select coalesce(sum(jl.credit - jl.debit), 0) into v from acc_journal_lines jl join acc_accounts a on a.id = jl.account_id where jl.tenant_id = tid and a.system_key in ('out_cgst', 'out_sgst', 'out_igst', 'out_cess');
  select coalesce(sum(case when doc_type = 'credit_note' then -1 else 1 end * (cgst + sgst + igst + cess)), 0) into w from acc_documents where tenant_id = tid and status = 'posted' and doc_type in ('invoice', 'credit_note');
  checks := checks || jsonb_build_array(jsonb_build_object('name', 'Output GST ledger reproduces from documents', 'ok', v = w, 'detail', v || ' vs ' || w));
  select count(*) into n from acc_stock_moves sm where sm.tenant_id = tid and sm.source_type = 'document' and not exists (select 1 from acc_documents d where d.id = sm.source_id);
  checks := checks || jsonb_build_array(jsonb_build_object('name', 'Stock movements trace to a source document', 'ok', n = 0, 'detail', n || ' orphaned'));
  return jsonb_build_object('ok', not exists (select 1 from jsonb_array_elements(checks) c where not (c->>'ok')::boolean), 'checks', checks, 'at', now());
end $$;
