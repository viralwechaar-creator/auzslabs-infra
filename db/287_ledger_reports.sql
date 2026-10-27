-- AUZsLedger Reports & Analytics: read-only aggregate functions.
-- Every figure comes from the posted journals (acc_journal_lines) or posted documents/payments; nothing here writes.
-- All functions start with acc_guard('acc_reports'), are tenant-scoped through it, and take one jsonb argument p.
-- Common keys: from, to (dates), branch_id, limit, offset.
-- Cash movement = lines on cash/bank accounts, leaving out journals that only move between cash/bank accounts
-- (transfers are neither income nor expense nor an inflow/outflow).

-- ---------- collections: billed, collected, efficiency, write-offs ----------
create or replace function acc_rep_collection(p jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; tt date; fr date; br uuid := nullif(p->>'branch_id', '')::uuid;
  opening_ar numeric; billed numeric; collected numeric; eff numeric; daily jsonb; modes jsonb; wo jsonb; wo_total numeric; rcpt_n int;
begin
  tid := acc_guard('acc_reports');
  tt := coalesce(nullif(p->>'to', '')::date, current_date);
  fr := coalesce(nullif(p->>'from', '')::date, acc_period_start(tid, tt));
  select coalesce(sum(jl.debit - jl.credit), 0) into opening_ar from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id join acc_accounts a on a.id = jl.account_id
    where jl.tenant_id = tid and a.system_key = 'ar' and j.jdate < fr and (br is null or j.branch_id = br);
  select coalesce(sum(case when doc_type = 'credit_note' then -total else total end), 0) into billed from acc_documents
    where tenant_id = tid and status = 'posted' and doc_type in ('invoice', 'credit_note') and doc_date between fr and tt and (br is null or branch_id = br);
  select coalesce(sum(pm.amount), 0), count(*) into collected, rcpt_n from acc_payments pm join acc_accounts a on a.id = pm.account_id
    where pm.tenant_id = tid and pm.kind = 'receipt' and pm.status = 'posted' and pm.pay_date between fr and tt and (a.is_cash or a.is_bank) and (br is null or pm.branch_id = br);
  eff := case when opening_ar + billed > 0 then round(collected / (opening_ar + billed) * 100, 1) end;
  select coalesce(jsonb_agg(jsonb_build_object('d', d::date, 'billed', coalesce(b.v, 0), 'collected', coalesce(c.v, 0)) order by d), '[]') into daily
  from generate_series(fr, tt, interval '1 day') d
  left join (select doc_date, sum(case when doc_type = 'credit_note' then -total else total end) v from acc_documents where tenant_id = tid and status = 'posted' and doc_type in ('invoice', 'credit_note') and doc_date between fr and tt and (br is null or branch_id = br) group by 1) b on b.doc_date = d::date
  left join (select pm.pay_date, sum(pm.amount) v from acc_payments pm join acc_accounts a on a.id = pm.account_id where pm.tenant_id = tid and pm.kind = 'receipt' and pm.status = 'posted' and pm.pay_date between fr and tt and (a.is_cash or a.is_bank) and (br is null or pm.branch_id = br) group by 1) c on c.pay_date = d::date
  where tt - fr <= 400;
  select coalesce(jsonb_agg(jsonb_build_object('mode', mode, 'amount', amt, 'count', n) order by amt desc), '[]') into modes from (
    select coalesce(nullif(pm.mode, ''), 'Not stated') as mode, sum(pm.amount) amt, count(*) n from acc_payments pm join acc_accounts a on a.id = pm.account_id
    where pm.tenant_id = tid and pm.kind = 'receipt' and pm.status = 'posted' and pm.pay_date between fr and tt and (a.is_cash or a.is_bank) and (br is null or pm.branch_id = br) group by 1) m;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.pay_date desc), '[]'), coalesce(sum(r.amount), 0) into wo, wo_total from (
    select pm.id, pm.number, pm.pay_date, pm.amount, pm.mode, pm.notes, pa.name as party_name, a.name as account from acc_payments pm join acc_accounts a on a.id = pm.account_id left join acc_parties pa on pa.id = pm.party_id
    where pm.tenant_id = tid and pm.status = 'posted' and pm.pay_date between fr and tt and not (a.is_cash or a.is_bank) and a.system_key in ('bad_debt', 'disc_allowed', 'disc_received') and (br is null or pm.branch_id = br)
    order by pm.pay_date desc limit 500) r;
  return jsonb_build_object('from', fr, 'to', tt, 'opening_receivable', opening_ar, 'billed', billed, 'collected', collected, 'receipts', rcpt_n, 'efficiency', eff,
    'daily', daily, 'modes', modes, 'writeoffs', wo, 'writeoff_total', wo_total);
end $$;

-- ---------- customers / suppliers: opening, billed, settled, closing ----------
create or replace function acc_rep_party_summary(p jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; tt date; fr date; pkind text := case when p->>'kind' = 'supplier' then 'supplier' else 'customer' end; f text := coalesce(nullif(p->>'filter', ''), 'all');
  q text := nullif(trim(coalesce(p->>'search', '')), ''); idle int := coalesce(nullif(p->>'inactive_days', '')::int, 90); lim int := least(coalesce(nullif(p->>'limit', '')::int, 100), 1000); off int := greatest(coalesce(nullif(p->>'offset', '')::int, 0), 0);
  rows jsonb; tot int; sums jsonb;
begin
  tid := acc_guard('acc_reports');
  tt := coalesce(nullif(p->>'to', '')::date, current_date);
  fr := coalesce(nullif(p->>'from', '')::date, acc_period_start(tid, tt));
  with base as (
    select pa.id as party_id, pa.name, pa.phone, pa.gstin, pa.credit_limit, pa.created_at,
      coalesce(m.opening, 0) as opening, coalesce(m.billed, 0) as billed, coalesce(m.settled, 0) as settled,
      coalesce(m.opening, 0) + coalesce(m.billed, 0) - coalesce(m.settled, 0) as closing, m.last_txn
    from acc_parties pa left join (
      select jl.party_id,
        sum(case when j.jdate < fr then (case when pkind = 'customer' then jl.debit - jl.credit else jl.credit - jl.debit end) else 0 end) as opening,
        sum(case when j.jdate between fr and tt then (case when pkind = 'customer' then jl.debit else jl.credit end) else 0 end) as billed,
        sum(case when j.jdate between fr and tt then (case when pkind = 'customer' then jl.credit else jl.debit end) else 0 end) as settled,
        max(j.jdate) as last_txn
      from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id join acc_accounts a on a.id = jl.account_id
      where jl.tenant_id = tid and a.system_key = (case when pkind = 'customer' then 'ar' else 'ap' end) and j.jdate <= tt and jl.party_id is not null group by jl.party_id) m on m.party_id = pa.id
    where pa.tenant_id = tid and not pa.is_walkin and pa.kind in (pkind, 'both') and (pa.party_type is null or pa.party_type = pkind)
      and (q is null or pa.name ilike '%' || q || '%' or pa.phone ilike '%' || q || '%' or pa.gstin ilike '%' || q || '%')
  ), flt as (
    select * from base where case f
      when 'outstanding' then closing > 0.005
      when 'zero' then abs(closing) <= 0.005
      when 'advance' then closing < -0.005
      when 'new' then created_at::date between fr and tt
      when 'inactive' then closing > 0.005 and (last_txn is null or tt - last_txn > idle)
      when 'moved' then billed <> 0 or settled <> 0
      else true end
  )
  select (select count(*) from flt),
    (select jsonb_build_object('opening', coalesce(sum(opening), 0), 'billed', coalesce(sum(billed), 0), 'settled', coalesce(sum(settled), 0), 'closing', coalesce(sum(closing), 0),
      'owed', coalesce(sum(closing) filter (where closing > 0), 0), 'advance', coalesce(-sum(closing) filter (where closing < 0), 0)) from flt),
    (select coalesce(jsonb_agg(to_jsonb(r)), '[]') from (select * from flt order by case when p->>'sort' = 'name' then 0 else abs(closing) end desc, name limit lim offset off) r)
  into tot, sums, rows;
  return jsonb_build_object('kind', pkind, 'from', fr, 'to', tt, 'filter', f, 'total', tot, 'sums', sums, 'rows', rows);
end $$;

-- ---------- invoices/bills that fall due: today, coming up, overdue ----------
create or replace function acc_rep_due(p jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; side text := case when p->>'kind' = 'payable' then 'payable' else 'receivable' end; b text := coalesce(nullif(p->>'bucket', ''), 'overdue'); days int := coalesce(nullif(p->>'days', '')::int, 7);
  asof date := coalesce(nullif(p->>'as_of', '')::date, current_date); lim int := least(coalesce(nullif(p->>'limit', '')::int, 200), 1000); rows jsonb; sums jsonb;
begin
  tid := acc_guard('acc_reports');
  with base as (
    select d.id, d.number, d.doc_type, d.doc_date, coalesce(d.due_date, d.doc_date) as due_date, d.party_id, coalesce(pa.name, d.party_name) as party_name, pa.phone,
      d.total, d.paid, d.total - d.paid as balance, asof - coalesce(d.due_date, d.doc_date) as days_over
    from acc_documents d left join acc_parties pa on pa.id = d.party_id
    where d.tenant_id = tid and d.status = 'posted' and d.total > d.paid and d.doc_date <= asof
      and ((side = 'receivable' and d.doc_type = 'invoice') or (side = 'payable' and d.doc_type in ('bill', 'expense')))
  ), flt as (
    select * from base where case b when 'today' then days_over = 0 when 'upcoming' then days_over < 0 and days_over >= -days when 'overdue' then days_over > 0 else true end
  )
  select (select jsonb_build_object('count', count(*), 'balance', coalesce(sum(balance), 0)) from flt),
    (select coalesce(jsonb_agg(to_jsonb(r)), '[]') from (select * from flt order by case when b = 'upcoming' then due_date end asc, days_over desc, balance desc limit lim) r)
  into sums, rows;
  return jsonb_build_object('kind', side, 'as_of', asof, 'bucket', b, 'sums', sums, 'rows', rows);
end $$;

-- ---------- payments and receipts not yet matched to a document (advances) ----------
create or replace function acc_rep_unallocated(p jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; asof date := coalesce(nullif(p->>'as_of', '')::date, current_date); rows jsonb; sums jsonb;
begin
  tid := acc_guard('acc_reports');
  select coalesce(jsonb_agg(to_jsonb(r) order by r.pay_date), '[]'), jsonb_build_object('receipts', coalesce(sum(r.open) filter (where r.kind = 'receipt'), 0), 'payments', coalesce(sum(r.open) filter (where r.kind = 'payment'), 0), 'count', count(*)) into rows, sums from (
    select pm.id, pm.kind, pm.number, pm.pay_date, pm.amount, pm.allocated, pm.amount - pm.allocated as open, pm.mode, pm.reference, pa.name as party_name, pa.id as party_id, a.name as account
    from acc_payments pm join acc_accounts a on a.id = pm.account_id left join acc_parties pa on pa.id = pm.party_id
    where pm.tenant_id = tid and pm.status = 'posted' and pm.pay_date <= asof and pm.amount > pm.allocated and (a.is_cash or a.is_bank)) r;
  return jsonb_build_object('as_of', asof, 'sums', sums, 'rows', rows);
end $$;

-- ---------- invoice / bill / note registers with status (includes cancelled) ----------
create or replace function acc_rep_docs(p jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; tt date; fr date; side text := case when p->>'kind' = 'purchase' then 'purchase' else 'sales' end; st text := coalesce(nullif(p->>'status', ''), 'all');
  pid uuid := nullif(p->>'party_id', '')::uuid; br uuid := nullif(p->>'branch_id', '')::uuid; q text := nullif(trim(coalesce(p->>'search', '')), '');
  lim int := least(coalesce(nullif(p->>'limit', '')::int, 100), 1000); off int := greatest(coalesce(nullif(p->>'offset', '')::int, 0), 0);
  types text[]; rows jsonb; counts jsonb; sums jsonb; tot int;
begin
  tid := acc_guard('acc_reports');
  tt := coalesce(nullif(p->>'to', '')::date, current_date);
  fr := coalesce(nullif(p->>'from', '')::date, acc_period_start(tid, tt));
  types := case when nullif(p->>'doc_type', '') is not null then array[p->>'doc_type'] when side = 'sales' then array['invoice', 'credit_note'] else array['bill', 'expense', 'debit_note'] end;
  with base as (
    select d.id, d.doc_type, d.number, d.doc_date, d.due_date, d.party_id, coalesce(pa.name, d.party_name) as party_name, d.total, d.paid, d.total - d.paid as balance, d.taxable,
      d.cgst + d.sgst + d.igst + d.cess as tax,
      case when d.status = 'cancelled' then 'cancelled' when d.status = 'draft' then 'draft' when d.status <> 'posted' then d.status when d.total <= d.paid then 'paid' when d.paid > 0 then 'partial'
           when d.due_date is not null and d.due_date < current_date then 'overdue' else 'unpaid' end as state,
      d.cancelled_at, d.cancel_reason, d.created_by, d.created_at, r.number as ref_number
    from acc_documents d left join acc_parties pa on pa.id = d.party_id left join acc_documents r on r.id = d.ref_doc_id
    where d.tenant_id = tid and d.doc_type = any(types) and d.doc_date between fr and tt and (pid is null or d.party_id = pid) and (br is null or d.branch_id = br)
      and (q is null or d.number ilike '%' || q || '%' or coalesce(pa.name, d.party_name) ilike '%' || q || '%' or d.supplier_ref ilike '%' || q || '%')
  ), flt as (
    select * from base where st = 'all' or state = st or (st = 'unpaid' and state = 'overdue')
  )
  select (select coalesce(jsonb_object_agg(state, n), '{}') from (select state, count(*) n from base group by state) c),
    (select count(*) from flt),
    (select jsonb_build_object('total', coalesce(sum(case when doc_type in ('credit_note', 'debit_note') then -total else total end) filter (where state not in ('cancelled', 'draft')), 0),
      'taxable', coalesce(sum(case when doc_type in ('credit_note', 'debit_note') then -taxable else taxable end) filter (where state not in ('cancelled', 'draft')), 0),
      'tax', coalesce(sum(case when doc_type in ('credit_note', 'debit_note') then -tax else tax end) filter (where state not in ('cancelled', 'draft')), 0),
      'balance', coalesce(sum(balance) filter (where state not in ('cancelled', 'draft') and doc_type not in ('credit_note', 'debit_note')), 0)) from flt),
    (select coalesce(jsonb_agg(to_jsonb(r)), '[]') from (select * from flt order by doc_date desc, number desc limit lim offset off) r)
  into counts, tot, sums, rows;
  return jsonb_build_object('kind', side, 'from', fr, 'to', tt, 'status', st, 'counts', counts, 'total', tot, 'sums', sums, 'rows', rows);
end $$;

-- ---------- journals with review flags: reversed, reversal, backdated, adjustment, transfer ----------
create or replace function acc_rep_journals(p jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; tt date; fr date; mode text := coalesce(nullif(p->>'mode', ''), 'all'); vt text := nullif(p->>'voucher_type', ''); lag int := coalesce(nullif(p->>'backdate_days', '')::int, 7);
  uid uuid := nullif(p->>'created_by', '')::uuid; lim int := least(coalesce(nullif(p->>'limit', '')::int, 100), 1000); off int := greatest(coalesce(nullif(p->>'offset', '')::int, 0), 0); rows jsonb; tot int; sums jsonb;
begin
  tid := acc_guard('acc_reports');
  tt := coalesce(nullif(p->>'to', '')::date, current_date);
  fr := coalesce(nullif(p->>'from', '')::date, acc_period_start(tid, tt));
  with base as (
    select j.id, j.number, j.jdate, j.voucher_type, j.narration, (select coalesce(sum(debit), 0) from acc_journal_lines where journal_id = j.id) as amount, j.created_by, j.created_at,
      exists (select 1 from acc_journals r where r.reverses_id = j.id) as reversed, j.reverses_id is not null as is_reversal,
      (j.created_at at time zone 'Asia/Kolkata')::date - j.jdate > lag as backdated,
      not exists (select 1 from acc_journal_lines l join acc_accounts a on a.id = l.account_id where l.journal_id = j.id and not (a.is_cash or a.is_bank)) as transfer,
      coalesce(d.number, pm.number) as doc_number
    from acc_journals j left join acc_documents d on j.source_type = 'document' and d.id = j.source_id left join acc_payments pm on j.source_type = 'payment' and pm.id = j.source_id
    where j.tenant_id = tid and j.jdate between fr and tt and (vt is null or j.voucher_type = vt) and (uid is null or j.created_by = uid)
  ), flt as (
    select * from base where case mode when 'reversed' then reversed or is_reversal when 'backdated' then backdated when 'adjustment' then voucher_type = 'journal'
      when 'transfer' then transfer and voucher_type in ('contra', 'journal') else true end
  )
  select (select count(*) from flt),
    (select jsonb_build_object('amount', coalesce(sum(amount), 0), 'reversed', count(*) filter (where reversed or is_reversal), 'backdated', count(*) filter (where backdated)) from flt),
    (select coalesce(jsonb_agg(to_jsonb(r)), '[]') from (select * from flt order by jdate desc, created_at desc limit lim offset off) r)
  into tot, sums, rows;
  return jsonb_build_object('from', fr, 'to', tt, 'mode', mode, 'total', tot, 'sums', sums, 'rows', rows);
end $$;

-- ---------- possible duplicates: same party + amount on documents, same party + amount + date on payments ----------
create or replace function acc_rep_duplicates(p jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; tt date; fr date; docs jsonb; pays jsonb;
begin
  tid := acc_guard('acc_reports');
  tt := coalesce(nullif(p->>'to', '')::date, current_date);
  fr := coalesce(nullif(p->>'from', '')::date, acc_period_start(tid, tt));
  select coalesce(jsonb_agg(to_jsonb(g) order by g.total desc), '[]') into docs from (
    select d.doc_type, coalesce(pa.name, d.party_name) as party_name, d.party_id, d.total, count(*) as n, array_agg(d.number order by d.doc_date) as numbers, array_agg(d.id order by d.doc_date) as ids, min(d.doc_date) as first_date, max(d.doc_date) as last_date
    from acc_documents d left join acc_parties pa on pa.id = d.party_id
    where d.tenant_id = tid and d.status = 'posted' and not d.is_opening and d.doc_type in ('invoice', 'bill', 'expense') and d.doc_date between fr and tt and d.total > 0 and d.party_id is not null
    group by d.doc_type, d.party_id, coalesce(pa.name, d.party_name), d.total, case when d.doc_type = 'invoice' then null else coalesce(d.supplier_ref, '') end
    having count(*) > 1 and max(d.doc_date) - min(d.doc_date) <= 7) g;
  select coalesce(jsonb_agg(to_jsonb(g) order by g.amount desc), '[]') into pays from (
    select pm.kind, pa.name as party_name, pm.party_id, pm.amount, pm.pay_date, count(*) as n, array_agg(pm.number order by pm.created_at) as numbers, array_agg(pm.id order by pm.created_at) as ids
    from acc_payments pm left join acc_parties pa on pa.id = pm.party_id
    where pm.tenant_id = tid and pm.status = 'posted' and pm.pay_date between fr and tt
    group by pm.kind, pm.party_id, pa.name, pm.amount, pm.pay_date having count(*) > 1) g;
  return jsonb_build_object('from', fr, 'to', tt, 'documents', docs, 'payments', pays);
end $$;

-- ---------- income / expense by account, month, day or vendor ----------
create or replace function acc_rep_category(p jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; tt date; fr date; k text := case when p->>'kind' = 'income' then 'income' else 'expense' end; gby text := coalesce(nullif(p->>'by', ''), 'account'); br uuid := nullif(p->>'branch_id', '')::uuid;
  rows jsonb; total numeric;
begin
  tid := acc_guard('acc_reports');
  tt := coalesce(nullif(p->>'to', '')::date, current_date);
  fr := coalesce(nullif(p->>'from', '')::date, acc_period_start(tid, tt));
  if gby = 'vendor' then
    select coalesce(jsonb_agg(to_jsonb(r) order by r.amount desc), '[]'), coalesce(sum(r.amount), 0) into rows, total from (
      select d.party_id, coalesce(pa.name, d.party_name, 'No supplier') as name, sum(case when d.doc_type = 'debit_note' then -d.taxable else d.taxable end) as amount, count(*) as n
      from acc_documents d left join acc_parties pa on pa.id = d.party_id
      where d.tenant_id = tid and d.status = 'posted' and d.doc_type in ('bill', 'expense', 'debit_note') and not d.is_opening and d.doc_date between fr and tt and (br is null or d.branch_id = br)
      group by d.party_id, coalesce(pa.name, d.party_name, 'No supplier')) r;
  else
    select coalesce(jsonb_agg(to_jsonb(r) order by r.sort_key, r.amount desc), '[]'), coalesce(sum(r.amount), 0) into rows, total from (
      select case gby when 'month' then to_char(j.jdate, 'YYYY-MM') when 'day' then to_char(j.jdate, 'YYYY-MM-DD') else a.id::text end as key,
             case gby when 'month' then to_char(j.jdate, 'Mon YYYY') when 'day' then to_char(j.jdate, 'DD Mon YYYY') else a.name end as name,
             case gby when 'month' then to_char(j.jdate, 'YYYY-MM') when 'day' then to_char(j.jdate, 'YYYY-MM-DD') else '' end as sort_key,
             max(a.grp) as grp, sum(case when k = 'income' then jl.credit - jl.debit else jl.debit - jl.credit end) as amount, count(distinct j.id) as n
      from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id join acc_accounts a on a.id = jl.account_id
      where jl.tenant_id = tid and a.type = k and j.jdate between fr and tt and (br is null or j.branch_id = br)
      group by 1, 2, 3 having abs(sum(case when k = 'income' then jl.credit - jl.debit else jl.debit - jl.credit end)) > 0.004) r;
  end if;
  return jsonb_build_object('kind', k, 'by', gby, 'from', fr, 'to', tt, 'total', total, 'rows', rows);
end $$;

-- ---------- by branch ----------
create or replace function acc_rep_branch(p jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; tt date; fr date; rows jsonb;
begin
  tid := acc_guard('acc_reports');
  tt := coalesce(nullif(p->>'to', '')::date, current_date);
  fr := coalesce(nullif(p->>'from', '')::date, acc_period_start(tid, tt));
  select coalesce(jsonb_agg(to_jsonb(r) order by r.income desc), '[]') into rows from (
    select b.id as branch_id, coalesce(b.name, 'Head office / no branch') as name,
      coalesce(sum(jl.credit - jl.debit) filter (where a.type = 'income'), 0) as income, coalesce(sum(jl.debit - jl.credit) filter (where a.type = 'expense'), 0) as expense,
      coalesce(sum(jl.credit - jl.debit) filter (where a.type = 'income'), 0) - coalesce(sum(jl.debit - jl.credit) filter (where a.type = 'expense'), 0) as profit
    from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id join acc_accounts a on a.id = jl.account_id left join acc_branches b on b.id = j.branch_id
    where jl.tenant_id = tid and a.type in ('income', 'expense') and j.jdate between fr and tt group by b.id, b.name) r;
  return jsonb_build_object('from', fr, 'to', tt, 'rows', rows);
end $$;

-- ---------- receipts and payments by payment mode ----------
create or replace function acc_rep_paymode(p jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; tt date; fr date; rows jsonb;
begin
  tid := acc_guard('acc_reports');
  tt := coalesce(nullif(p->>'to', '')::date, current_date);
  fr := coalesce(nullif(p->>'from', '')::date, acc_period_start(tid, tt));
  select coalesce(jsonb_agg(to_jsonb(r) order by r.received + r.paid desc), '[]') into rows from (
    select coalesce(nullif(pm.mode, ''), 'Not stated') as mode, coalesce(sum(pm.amount) filter (where pm.kind = 'receipt'), 0) as received, coalesce(sum(pm.amount) filter (where pm.kind = 'payment'), 0) as paid, count(*) as n
    from acc_payments pm join acc_accounts a on a.id = pm.account_id
    where pm.tenant_id = tid and pm.status = 'posted' and pm.pay_date between fr and tt and (a.is_cash or a.is_bank) group by 1) r;
  return jsonb_build_object('from', fr, 'to', tt, 'rows', rows);
end $$;

-- ---------- customer profitability (sales less the stock cost on the lines) ----------
create or replace function acc_rep_customer_profit(p jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; tt date; fr date; rows jsonb;
begin
  tid := acc_guard('acc_reports');
  tt := coalesce(nullif(p->>'to', '')::date, current_date);
  fr := coalesce(nullif(p->>'from', '')::date, acc_period_start(tid, tt));
  select coalesce(jsonb_agg(to_jsonb(r) order by r.sales desc), '[]') into rows from (
    select d.party_id, coalesce(pa.name, d.party_name, 'Walk-in') as name,
      sum(case when d.doc_type = 'credit_note' then -d.taxable else d.taxable end) as sales,
      coalesce(sum((case when d.doc_type = 'credit_note' then -1 else 1 end) * l.qty * l.unit_cost), 0) as cost,
      count(distinct d.id) as bills
    from acc_documents d left join acc_parties pa on pa.id = d.party_id left join acc_doc_lines l on l.doc_id = d.id and l.product_id is not null
    where d.tenant_id = tid and d.status = 'posted' and d.doc_type in ('invoice', 'credit_note') and not d.is_opening and d.doc_date between fr and tt
    group by d.party_id, coalesce(pa.name, d.party_name, 'Walk-in')) r;
  return jsonb_build_object('from', fr, 'to', tt, 'rows', rows);
end $$;

-- ---------- financial ratios and working capital trend ----------
create or replace function acc_rep_ratios(p jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; tt date; fr date; cur_a numeric; cur_l numeric; liq numeric; inv numeric; cash numeric; ar numeric; ap numeric; rev numeric; cos numeric; inc numeric; exp numeric; days int; tr jsonb; loans numeric; eq numeric; tot_l numeric; tot_a numeric;
begin
  tid := acc_guard('acc_reports');
  tt := coalesce(nullif(p->>'to', '')::date, current_date);
  fr := coalesce(nullif(p->>'from', '')::date, acc_period_start(tid, tt));
  days := greatest(tt - fr + 1, 1);
  select coalesce(sum(jl.debit - jl.credit) filter (where a.type = 'asset' and (a.grp in ('Current assets', 'Cash and bank'))), 0),
         coalesce(sum(jl.credit - jl.debit) filter (where a.type = 'liability' and a.grp in ('Current liabilities', 'Duties and taxes')), 0),
         coalesce(sum(jl.debit - jl.credit) filter (where a.system_key = 'inventory'), 0),
         coalesce(sum(jl.debit - jl.credit) filter (where a.is_cash or a.is_bank), 0),
         coalesce(sum(jl.debit - jl.credit) filter (where a.system_key = 'ar'), 0),
         coalesce(sum(jl.credit - jl.debit) filter (where a.system_key = 'ap'), 0),
         coalesce(sum(jl.credit - jl.debit) filter (where a.type = 'liability' and a.grp = 'Long-term liabilities'), 0),
         coalesce(sum(jl.debit - jl.credit) filter (where a.type = 'asset'), 0),
         coalesce(sum(jl.credit - jl.debit) filter (where a.type = 'liability'), 0)
    into cur_a, cur_l, inv, cash, ar, ap, loans, tot_a, tot_l
    from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id join acc_accounts a on a.id = jl.account_id where jl.tenant_id = tid and j.jdate <= tt;
  eq := tot_a - tot_l;
  select coalesce(sum(jl.credit - jl.debit) filter (where a.grp = 'Revenue'), 0), coalesce(sum(jl.debit - jl.credit) filter (where a.grp = 'Cost of sales'), 0),
         coalesce(sum(jl.credit - jl.debit) filter (where a.type = 'income'), 0), coalesce(sum(jl.debit - jl.credit) filter (where a.type = 'expense'), 0)
    into rev, cos, inc, exp
    from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id join acc_accounts a on a.id = jl.account_id where jl.tenant_id = tid and a.type in ('income', 'expense') and j.jdate between fr and tt;
  select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m, 'YYYY-MM'), 'label', to_char(m, 'Mon YY'), 'working_capital', wc) order by m), '[]') into tr from (
    select m, (select coalesce(sum(case when a.type = 'asset' then jl.debit - jl.credit else jl.debit - jl.credit end) filter (where a.type = 'asset' and a.grp in ('Current assets', 'Cash and bank')), 0)
                     - coalesce(sum(jl.credit - jl.debit) filter (where a.type = 'liability' and a.grp in ('Current liabilities', 'Duties and taxes')), 0)
               from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id join acc_accounts a on a.id = jl.account_id
               where jl.tenant_id = tid and j.jdate <= least((m + interval '1 month' - interval '1 day')::date, tt)) as wc
    from generate_series(date_trunc('month', fr)::date, date_trunc('month', tt)::date, interval '1 month') m where tt - fr <= 800) x;
  return jsonb_build_object('from', fr, 'to', tt, 'as_of', tt,
    'working_capital', cur_a - cur_l, 'current_assets', cur_a, 'current_liabilities', cur_l,
    'current_ratio', case when cur_l > 0 then round(cur_a / cur_l, 2) end, 'quick_ratio', case when cur_l > 0 then round((cur_a - inv) / cur_l, 2) end,
    'cash', cash, 'receivable', ar, 'payable', ap, 'inventory', inv, 'loans', loans, 'equity', eq, 'total_assets', tot_a, 'total_liabilities', tot_l,
    'debt_to_equity', case when eq > 0 then round(tot_l / eq, 2) end,
    'revenue', rev, 'cost_of_sales', cos, 'income', inc, 'expense', exp, 'net_profit', inc - exp,
    'gross_margin_pct', case when rev > 0 then round((rev - cos) / rev * 100, 1) end, 'net_margin_pct', case when inc > 0 then round((inc - exp) / inc * 100, 1) end,
    'expense_ratio_pct', case when inc > 0 then round(exp / inc * 100, 1) end,
    'debtor_days', case when rev > 0 then round(ar / rev * days, 0) end, 'creditor_days', case when cos + exp > 0 then round(ap / (cos + exp) * days, 0) end,
    'trend', tr);
end $$;

-- ---------- this financial year against the one before, month by month ----------
create or replace function acc_rep_fy_compare(p jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; fys date; pfys date; rows jsonb; t date := current_date;
begin
  tid := acc_guard('acc_reports');
  fys := coalesce(nullif(p->>'fy_start', '')::date, acc_period_start(tid, t)); pfys := (fys - interval '1 year')::date;
  select coalesce(jsonb_agg(to_jsonb(r) order by r.n), '[]') into rows from (
    select n, to_char((fys + (n || ' month')::interval), 'Mon') as label,
      coalesce((select sum(jl.credit - jl.debit) from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id join acc_accounts a on a.id = jl.account_id
        where jl.tenant_id = tid and a.type = 'income' and j.jdate >= (fys + (n || ' month')::interval)::date and j.jdate < (fys + ((n + 1) || ' month')::interval)::date), 0) as income,
      coalesce((select sum(jl.debit - jl.credit) from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id join acc_accounts a on a.id = jl.account_id
        where jl.tenant_id = tid and a.type = 'expense' and j.jdate >= (fys + (n || ' month')::interval)::date and j.jdate < (fys + ((n + 1) || ' month')::interval)::date), 0) as expense,
      coalesce((select sum(jl.credit - jl.debit) from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id join acc_accounts a on a.id = jl.account_id
        where jl.tenant_id = tid and a.type = 'income' and j.jdate >= (pfys + (n || ' month')::interval)::date and j.jdate < (pfys + ((n + 1) || ' month')::interval)::date), 0) as prev_income,
      coalesce((select sum(jl.debit - jl.credit) from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id join acc_accounts a on a.id = jl.account_id
        where jl.tenant_id = tid and a.type = 'expense' and j.jdate >= (pfys + (n || ' month')::interval)::date and j.jdate < (pfys + ((n + 1) || ' month')::interval)::date), 0) as prev_expense
    from generate_series(0, 11) n) r;
  return jsonb_build_object('fy_start', fys, 'prev_start', pfys, 'rows', rows);
end $$;

-- ---------- the reports dashboard: every figure is the same calculation the detail reports use ----------
create or replace function acc_rep_dashboard(p jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; tt date; fr date; br uuid := nullif(p->>'branch_id', '')::uuid;
  arj jsonb; apj jsonb; col jsonb; ar_over numeric; ap_over numeric; cash numeric; bank numeric; inc numeric; exp numeric; cin numeric; cout numeric;
  months jsonb; cats jsonb; icats jsonb; recent jsonb; accts jsonb; inv_status jsonb; pend_n int; pend_amt numeric; paid_out numeric;
begin
  tid := acc_guard('acc_reports');
  tt := coalesce(nullif(p->>'to', '')::date, current_date);
  fr := coalesce(nullif(p->>'from', '')::date, acc_period_start(tid, tt));
  arj := acc_ageing(jsonb_build_object('kind', 'receivable', 'as_of', tt));
  apj := acc_ageing(jsonb_build_object('kind', 'payable', 'as_of', tt));
  col := acc_rep_collection(jsonb_build_object('from', fr, 'to', tt, 'branch_id', br));
  ar_over := coalesce((arj->'totals'->>'d30')::numeric, 0) + coalesce((arj->'totals'->>'d60')::numeric, 0) + coalesce((arj->'totals'->>'d90')::numeric, 0) + coalesce((arj->'totals'->>'d90p')::numeric, 0);
  ap_over := coalesce((apj->'totals'->>'d30')::numeric, 0) + coalesce((apj->'totals'->>'d60')::numeric, 0) + coalesce((apj->'totals'->>'d90')::numeric, 0) + coalesce((apj->'totals'->>'d90p')::numeric, 0);
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'bank', a.is_bank, 'balance', b) order by a.code), '[]'),
         coalesce(sum(b) filter (where a.is_cash), 0), coalesce(sum(b) filter (where a.is_bank), 0) into accts, cash, bank
    from acc_accounts a cross join lateral (select coalesce(sum(jl.debit - jl.credit), 0) b from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id where jl.account_id = a.id and j.jdate <= tt and (br is null or j.branch_id = br)) x
    where a.tenant_id = tid and (a.is_cash or a.is_bank) and a.active;
  select coalesce(sum(jl.credit - jl.debit) filter (where a.type = 'income'), 0), coalesce(sum(jl.debit - jl.credit) filter (where a.type = 'expense'), 0) into inc, exp
    from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id join acc_accounts a on a.id = jl.account_id
    where jl.tenant_id = tid and a.type in ('income', 'expense') and j.jdate between fr and tt and (br is null or j.branch_id = br);
  with xfer as (select jl.journal_id from acc_journal_lines jl join acc_accounts a on a.id = jl.account_id join acc_journals j on j.id = jl.journal_id
                where jl.tenant_id = tid and j.jdate between fr and tt group by jl.journal_id having bool_and(a.is_cash or a.is_bank))
  select coalesce(sum(jl.debit), 0), coalesce(sum(jl.credit), 0) into cin, cout from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id join acc_accounts a on a.id = jl.account_id
    where jl.tenant_id = tid and (a.is_cash or a.is_bank) and j.jdate between fr and tt and (br is null or j.branch_id = br) and j.id not in (select journal_id from xfer);
  select coalesce(sum(pm.amount), 0) into paid_out from acc_payments pm join acc_accounts a on a.id = pm.account_id
    where pm.tenant_id = tid and pm.kind = 'payment' and pm.status = 'posted' and pm.pay_date between fr and tt and (a.is_cash or a.is_bank) and (br is null or pm.branch_id = br);
  with m as (select date_trunc('month', d)::date as mth from generate_series(date_trunc('month', fr), date_trunc('month', tt), interval '1 month') d where tt - fr <= 800),
  pl as (select date_trunc('month', j.jdate)::date as mth, sum(case when a.type = 'income' then jl.credit - jl.debit else 0 end) as inc, sum(case when a.type = 'expense' then jl.debit - jl.credit else 0 end) as exp
         from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id join acc_accounts a on a.id = jl.account_id
         where jl.tenant_id = tid and a.type in ('income', 'expense') and j.jdate between fr and tt and (br is null or j.branch_id = br) group by 1),
  xf as (select jl.journal_id from acc_journal_lines jl join acc_accounts a on a.id = jl.account_id join acc_journals j on j.id = jl.journal_id
         where jl.tenant_id = tid and j.jdate between fr and tt group by jl.journal_id having bool_and(a.is_cash or a.is_bank)),
  cf as (select date_trunc('month', j.jdate)::date as mth, sum(jl.debit) as cin, sum(jl.credit) as cout
         from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id join acc_accounts a on a.id = jl.account_id
         where jl.tenant_id = tid and (a.is_cash or a.is_bank) and j.jdate between fr and tt and (br is null or j.branch_id = br) and j.id not in (select journal_id from xf) group by 1)
  select coalesce(jsonb_agg(jsonb_build_object('month', to_char(m.mth, 'YYYY-MM'), 'label', to_char(m.mth, 'Mon YY'), 'income', coalesce(pl.inc, 0), 'expense', coalesce(pl.exp, 0),
         'profit', coalesce(pl.inc, 0) - coalesce(pl.exp, 0), 'inflow', coalesce(cf.cin, 0), 'outflow', coalesce(cf.cout, 0)) order by m.mth), '[]') into months
    from m left join pl on pl.mth = m.mth left join cf on cf.mth = m.mth;
  select coalesce(jsonb_agg(to_jsonb(r)), '[]') into cats from (
    select a.name, sum(jl.debit - jl.credit) as amount from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id join acc_accounts a on a.id = jl.account_id
    where jl.tenant_id = tid and a.type = 'expense' and j.jdate between fr and tt and (br is null or j.branch_id = br) group by a.id, a.name having sum(jl.debit - jl.credit) > 0 order by 2 desc limit 8) r;
  select coalesce(jsonb_agg(to_jsonb(r)), '[]') into icats from (
    select a.name, sum(jl.credit - jl.debit) as amount from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id join acc_accounts a on a.id = jl.account_id
    where jl.tenant_id = tid and a.type = 'income' and j.jdate between fr and tt and (br is null or j.branch_id = br) group by a.id, a.name having sum(jl.credit - jl.debit) > 0 order by 2 desc limit 8) r;
  select coalesce(jsonb_agg(to_jsonb(r)), '[]') into recent from (
    select j.id, j.number, j.jdate, j.voucher_type, j.narration, (select sum(debit) from acc_journal_lines where journal_id = j.id) as amount from acc_journals j
    where j.tenant_id = tid and j.jdate between fr and tt and (br is null or j.branch_id = br) order by j.jdate desc, j.created_at desc limit 8) r;
  select coalesce(jsonb_object_agg(s, n), '{}') into inv_status from (
    select case when d.status = 'cancelled' then 'cancelled' when d.status <> 'posted' then d.status when d.total <= d.paid then 'paid' when d.paid > 0 then 'partial' when d.due_date < current_date then 'overdue' else 'unpaid' end as s, count(*) as n
    from acc_documents d where d.tenant_id = tid and d.doc_type = 'invoice' and d.doc_date between fr and tt and (br is null or d.branch_id = br) group by 1) x;
  select count(*), coalesce(sum(total - paid), 0) into pend_n, pend_amt from acc_documents where tenant_id = tid and status = 'posted' and doc_type in ('bill', 'expense') and total > paid and doc_date <= tt;
  return jsonb_build_object('from', fr, 'to', tt, 'branch_id', br,
    'receivable', coalesce((arj->'totals'->>'total')::numeric, 0), 'payable', coalesce((apj->'totals'->>'total')::numeric, 0), 'receivable_overdue', ar_over, 'payable_overdue', ap_over,
    'cash', cash, 'bank', bank, 'income', inc, 'expense', exp, 'net_profit', inc - exp, 'cash_in', cin, 'cash_out', cout, 'paid_out', paid_out,
    'collected', col->'collected', 'billed', col->'billed', 'collection_efficiency', col->'efficiency', 'pending_bills', pend_n, 'pending_bill_amount', pend_amt,
    'ageing_receivable', arj->'totals', 'ageing_payable', apj->'totals',
    'top_customers', (select coalesce(jsonb_agg(e), '[]') from (select e from jsonb_array_elements(arj->'rows') e where (e->>'total')::numeric > 0 limit 5) s),
    'top_suppliers', (select coalesce(jsonb_agg(e), '[]') from (select e from jsonb_array_elements(apj->'rows') e where (e->>'total')::numeric > 0 limit 5) s),
    'accounts', accts, 'months', months, 'expense_categories', cats, 'income_categories', icats, 'payment_modes', col->'modes', 'collection_daily', col->'daily', 'invoice_status', inv_status, 'recent', recent);
end $$;

-- helpful indexes for the date filters used above
create index if not exists acc_journals_t_branch on acc_journals (tenant_id, branch_id, jdate);
create index if not exists acc_payments_t_date on acc_payments (tenant_id, pay_date);
create index if not exists acc_documents_t_date on acc_documents (tenant_id, doc_type, doc_date);
