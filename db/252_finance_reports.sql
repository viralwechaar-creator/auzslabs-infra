-- AUZsFinance phase 2: reports for finance-only businesses, ageing, bank/cash matching, assets with depreciation, budgets, UTR/reference.
-- Same rules as phase 1: RLS on and no policies, all access through SECURITY DEFINER fin_* functions that start with fin_guard().

alter table fin_txns add column if not exists reference text;

create or replace function fin_mark_txn(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; o fin_txns; t fin_txns;
begin
  tid := fin_guard('write');
  select * into o from fin_txns where id = p_id and tenant_id = tid;
  if o.id is null then raise exception 'Transaction not found'; end if;
  if p ? 'review' and p->>'review' = 'confirmed' and o.review <> 'confirmed' and not acc_perm('acc_approve') then
    raise exception 'Only a manager can confirm a transaction that needs review';
  end if;
  update fin_txns set evidence = coalesce(nullif(p->>'evidence',''), evidence), review = coalesce(nullif(p->>'review',''), review),
    note = case when p ? 'note' then p->>'note' else note end, purpose = case when p ? 'purpose' then p->>'purpose' else purpose end,
    reference = case when p ? 'reference' then nullif(trim(p->>'reference'),'') else reference end, updated_at = now()
  where id = p_id returning * into t;
  perform acc_audit_log(tid, 'mark', 'fin_txn', t.id::text, to_jsonb(o), to_jsonb(t));
  return to_jsonb(t);
end $$;

-- ---------- double-entry reports (read the ledger, same figures as AUZsLedger) ----------
create or replace function fin_report_pl(p_from date, p_to date) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; inc jsonb; exp jsonb; ti numeric; te numeric;
begin
  tid := fin_guard('view');
  select coalesce(jsonb_agg(jsonb_build_object('name', n, 'amount', a) order by a desc), '[]'), coalesce(sum(a), 0) into inc, ti from (
    select ac.name n, sum(l.credit - l.debit) a from acc_journal_lines l join acc_journals j on j.id = l.journal_id join acc_accounts ac on ac.id = l.account_id
    where l.tenant_id = tid and ac.type = 'income' and j.jdate between p_from and p_to group by ac.name having sum(l.credit - l.debit) <> 0) q;
  select coalesce(jsonb_agg(jsonb_build_object('name', n, 'amount', a) order by a desc), '[]'), coalesce(sum(a), 0) into exp, te from (
    select ac.name n, sum(l.debit - l.credit) a from acc_journal_lines l join acc_journals j on j.id = l.journal_id join acc_accounts ac on ac.id = l.account_id
    where l.tenant_id = tid and ac.type = 'expense' and j.jdate between p_from and p_to group by ac.name having sum(l.debit - l.credit) <> 0) q;
  return jsonb_build_object('from', p_from, 'to', p_to, 'income', inc, 'expenses', exp, 'total_income', ti, 'total_expenses', te, 'profit', ti - te);
end $$;

create or replace function fin_report_bs(p_to date) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; pr numeric; r jsonb;
begin
  tid := fin_guard('view');
  select coalesce(sum(l.credit - l.debit), 0) into pr from acc_journal_lines l join acc_journals j on j.id = l.journal_id join acc_accounts ac on ac.id = l.account_id
    where l.tenant_id = tid and ac.type in ('income','expense') and j.jdate <= p_to;
  with b as (
    select ac.type typ, ac.name nm, case when ac.type = 'asset' then sum(l.debit - l.credit) else sum(l.credit - l.debit) end amt
    from acc_journal_lines l join acc_journals j on j.id = l.journal_id join acc_accounts ac on ac.id = l.account_id
    where l.tenant_id = tid and ac.type in ('asset','liability','equity') and j.jdate <= p_to group by ac.type, ac.name having sum(l.debit - l.credit) <> 0)
  select jsonb_build_object('as_on', p_to, 'profit_to_date', pr,
    'assets', (select coalesce(jsonb_agg(jsonb_build_object('name', nm, 'amount', amt) order by amt desc), '[]') from b where typ = 'asset'),
    'liabilities', (select coalesce(jsonb_agg(jsonb_build_object('name', nm, 'amount', amt) order by amt desc), '[]') from b where typ = 'liability'),
    'equity', (select coalesce(jsonb_agg(jsonb_build_object('name', nm, 'amount', amt) order by amt desc), '[]') from b where typ = 'equity'),
    'total_assets', (select coalesce(sum(amt), 0) from b where typ = 'asset'),
    'total_liabilities', (select coalesce(sum(amt), 0) from b where typ = 'liability'),
    'total_equity', (select coalesce(sum(amt), 0) from b where typ = 'equity') + pr) into r;
  return r || jsonb_build_object('balanced', abs((r->>'total_assets')::numeric - (r->>'total_liabilities')::numeric - (r->>'total_equity')::numeric) < 0.01);
end $$;

create or replace function fin_report_tb(p_to date) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := fin_guard('view');
  return jsonb_build_object('as_on', p_to, 'rows', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'name', name, 'debit', d, 'credit', c) order by code), '[]') from (
    select ac.code, ac.name, greatest(sum(l.debit - l.credit), 0) d, greatest(sum(l.credit - l.debit), 0) c
    from acc_journal_lines l join acc_journals j on j.id = l.journal_id join acc_accounts ac on ac.id = l.account_id
    where l.tenant_id = tid and j.jdate <= p_to group by ac.code, ac.name having sum(l.debit - l.credit) <> 0) q));
end $$;

create or replace function fin_report_cash(p_from date, p_to date) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; opening numeric; closing numeric;
begin
  tid := fin_guard('view');
  select coalesce(sum(fin_balance(tid, ledger_id, p_from - 1)), 0), coalesce(sum(fin_balance(tid, ledger_id, p_to)), 0) into opening, closing from fin_accounts where tenant_id = tid and active;
  return jsonb_build_object('from', p_from, 'to', p_to, 'opening', opening, 'closing', closing,
    'rows', (select coalesce(jsonb_agg(jsonb_build_object('kind', kind, 'amount', s, 'sign', sg) order by s desc), '[]') from (
      select kind, sum(amount + case when kind in ('loan_repay','loan_collect') then interest else 0 end) s,
        case when kind in ('money_in','dues_in','capital_in','loan_taken','loan_collect') then 1 else -1 end sg
      from fin_txns where tenant_id = tid and status = 'posted' and txn_date between p_from and p_to
        and kind in ('money_in','dues_in','capital_in','loan_taken','loan_collect','expense','drawing','loan_given','loan_repay','dues_out','asset_buy') group by kind) q));
end $$;

-- ---------- who owes how old (FIFO: payments clear the oldest credit entries first) ----------
create or replace function fin_ageing() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; r record; c record; pay numeric; rem numeric; res jsonb := '[]'; b0 numeric; b1 numeric; b2 numeric; b3 numeric; dir text; days int;
begin
  tid := fin_guard('view');
  for r in select p.id, p.name, p.phone from fin_people p where p.tenant_id = tid loop
    for dir in select unnest(array['in','out']) loop
      select coalesce(sum(amount), 0) into pay from fin_txns where tenant_id = tid and person_id = r.id and status = 'posted' and kind = case when dir = 'in' then 'dues_in' else 'dues_out' end;
      b0 := 0; b1 := 0; b2 := 0; b3 := 0;
      for c in select amount, coalesce(due_date, txn_date) dd from fin_txns where tenant_id = tid and person_id = r.id and status = 'posted' and kind = case when dir = 'in' then 'credit_sale' else 'credit_purchase' end order by txn_date, created_at loop
        rem := c.amount - least(pay, c.amount); pay := pay - least(pay, c.amount);
        if rem <= 0 then continue; end if;
        days := greatest(current_date - c.dd, 0);
        if days <= 30 then b0 := b0 + rem; elsif days <= 60 then b1 := b1 + rem; elsif days <= 90 then b2 := b2 + rem; else b3 := b3 + rem; end if;
      end loop;
      if b0 + b1 + b2 + b3 > 0 then
        res := res || jsonb_build_object('id', r.id, 'name', r.name, 'phone', r.phone, 'direction', dir, 'total', b0 + b1 + b2 + b3, 'b0', b0, 'b1', b1, 'b2', b2, 'b3', b3);
      end if;
    end loop;
  end loop;
  return res;
end $$;

-- ---------- matching money accounts with the bank statement ----------
create table if not exists fin_cleared (
  txn_id uuid not null references fin_txns(id) on delete cascade,
  account_id uuid not null references fin_accounts(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  cleared_on date not null default current_date, cleared_by uuid,
  primary key (txn_id, account_id)
);
alter table fin_cleared enable row level security;

create or replace function fin_recon_list(p_account uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; a fin_accounts;
begin
  tid := fin_guard('view');
  select * into a from fin_accounts where id = p_account and tenant_id = tid;
  if a.id is null then raise exception 'Account not found'; end if;
  return jsonb_build_object('account', a.name, 'book_balance', fin_balance(tid, a.ledger_id),
    'cleared_balance', (select a.opening + coalesce(sum(case when x.account_id = a.id then
         (case when x.kind in ('money_in','dues_in','capital_in','loan_taken','loan_collect') then x.amount + case when x.kind = 'loan_collect' then x.interest else 0 end
               when x.kind = 'transfer' then -x.amount else -(x.amount + case when x.kind = 'loan_repay' then x.interest else 0 end) end)
         else x.amount end), 0)
       from fin_cleared c join fin_txns x on x.id = c.txn_id where c.account_id = a.id and c.tenant_id = tid and x.status = 'posted'),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'kind', x.kind, 'date', x.txn_date, 'title', coalesce(x.purpose, x.kind), 'reference', x.reference,
        'amount', case when x.account_id = a.id then
            (case when x.kind in ('money_in','dues_in','capital_in','loan_taken','loan_collect') then x.amount + case when x.kind = 'loan_collect' then x.interest else 0 end
                  when x.kind = 'transfer' then -x.amount else -(x.amount + case when x.kind = 'loan_repay' then x.interest else 0 end) end)
          else x.amount end,
        'cleared', c.txn_id is not null) order by x.txn_date desc, x.created_at desc), '[]')
      from fin_txns x left join fin_cleared c on c.txn_id = x.id and c.account_id = a.id
      where x.tenant_id = tid and x.status = 'posted' and (x.account_id = a.id or x.to_account_id = a.id) and x.kind <> 'credit_sale' and x.kind <> 'credit_purchase'));
end $$;

create or replace function fin_recon_set(p_txn uuid, p_account uuid, p_cleared boolean) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := fin_guard('write');
  if not exists (select 1 from fin_txns where id = p_txn and tenant_id = tid) or not exists (select 1 from fin_accounts where id = p_account and tenant_id = tid) then raise exception 'Not found'; end if;
  if p_cleared then insert into fin_cleared (txn_id, account_id, tenant_id, cleared_by) values (p_txn, p_account, tid, app_uid()) on conflict do nothing;
  else delete from fin_cleared where txn_id = p_txn and account_id = p_account and tenant_id = tid; end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- assets and their yearly wear ----------
create table if not exists fin_assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null, cost numeric(16,2) not null check (cost > 0), buy_date date not null,
  life_years numeric(5,1) not null default 5 check (life_years > 0), salvage numeric(16,2) not null default 0,
  txn_id uuid references fin_txns(id), accumulated numeric(16,2) not null default 0,
  status text not null default 'active' check (status in ('active','sold')), note text,
  created_by uuid, created_at timestamptz not null default now()
);
alter table fin_assets enable row level security;
create table if not exists fin_dep_runs (
  asset_id uuid not null references fin_assets(id) on delete cascade, period_end date not null, amount numeric(16,2) not null,
  journal_id uuid, tenant_id uuid not null references tenants(id) on delete cascade, primary key (asset_id, period_end)
);
alter table fin_dep_runs enable row level security;

create or replace function fin_asset_json(a fin_assets) returns jsonb language sql stable as $$
  select to_jsonb(a) || jsonb_build_object('book_value', a.cost - a.accumulated, 'monthly', round((a.cost - a.salvage) / (a.life_years * 12), 2))
$$;

create or replace function fin_asset_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; a fin_assets; id uuid := nullif(p->>'id','')::uuid;
begin
  tid := fin_guard('write');
  if nullif(trim(p->>'name'),'') is null then raise exception 'Give the asset a name'; end if;
  if id is null then
    insert into fin_assets (tenant_id, name, cost, buy_date, life_years, salvage, txn_id, note, created_by)
    values (tid, trim(p->>'name'), (p->>'cost')::numeric, coalesce((p->>'buy_date')::date, current_date), coalesce((p->>'life_years')::numeric, 5), coalesce((p->>'salvage')::numeric, 0),
      nullif(p->>'txn_id','')::uuid, nullif(p->>'note',''), app_uid()) returning * into a;
    perform acc_audit_log(tid, 'create', 'fin_asset', a.id::text, null, to_jsonb(a));
  else
    update fin_assets set name = coalesce(nullif(trim(p->>'name'),''), name), life_years = coalesce((p->>'life_years')::numeric, life_years), salvage = coalesce((p->>'salvage')::numeric, salvage),
      status = coalesce(nullif(p->>'status',''), status), note = case when p ? 'note' then p->>'note' else note end
    where fin_assets.id = id and tenant_id = tid returning * into a;
    if a.id is null then raise exception 'Asset not found'; end if;
  end if;
  return fin_asset_json(a);
end $$;

create or replace function fin_asset_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := fin_guard('view');
  return (select coalesce(jsonb_agg(fin_asset_json(a) order by a.buy_date desc), '[]') from fin_assets a where a.tenant_id = tid);
end $$;

-- posts one month of wear for every active asset up to the given month end; running it twice does nothing new
create or replace function fin_run_depreciation(p_to date) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; a fin_assets; me date; amt numeric; total numeric; lines jsonb; jid uuid; n int := 0; sum_all numeric := 0; fy uuid; exp uuid; acc uuid;
begin
  tid := fin_guard('write');
  exp := fin_acct(tid, 'dep_expense'); acc := fin_acct(tid, 'accum_dep');
  if exp is null or acc is null then raise exception 'The depreciation accounts are missing - open AUZsLedger once to set up the books'; end if;
  me := (date_trunc('month', p_to) + interval '1 month - 1 day')::date;
  if me > (date_trunc('month', current_date) + interval '1 month - 1 day')::date then raise exception 'You cannot post wear for a month that has not started'; end if;
  fy := acc_assert_open(tid, me);
  total := 0; lines := '[]';
  for a in select * from fin_assets where tenant_id = tid and status = 'active' and buy_date <= me and not exists (select 1 from fin_dep_runs r where r.asset_id = fin_assets.id and r.period_end = me) for update loop
    amt := least(round((a.cost - a.salvage) / (a.life_years * 12), 2), a.cost - a.salvage - a.accumulated);
    if amt > 0 then total := total + amt; n := n + 1; end if;
  end loop;
  if n = 0 then return jsonb_build_object('assets', 0, 'amount', 0, 'month_end', me); end if;
  jid := acc_post_journal(tid, 'depreciation', me, fy, null, 'Wear on assets for ' || to_char(me, 'Mon YYYY'), 'fin_dep', null,
    jsonb_build_array(jsonb_build_object('account_id', exp, 'debit', total), jsonb_build_object('account_id', acc, 'credit', total)));
  for a in select * from fin_assets where tenant_id = tid and status = 'active' and buy_date <= me and not exists (select 1 from fin_dep_runs r where r.asset_id = fin_assets.id and r.period_end = me) loop
    amt := least(round((a.cost - a.salvage) / (a.life_years * 12), 2), a.cost - a.salvage - a.accumulated);
    if amt <= 0 then continue; end if;
    insert into fin_dep_runs (asset_id, period_end, amount, journal_id, tenant_id) values (a.id, me, amt, jid, tid);
    update fin_assets set accumulated = accumulated + amt where id = a.id;
  end loop;
  perform acc_audit_log(tid, 'depreciation', 'fin_asset', null, null, jsonb_build_object('month_end', me, 'amount', total));
  return jsonb_build_object('assets', n, 'amount', total, 'month_end', me);
end $$;

-- ---------- budgets: a monthly limit per kind of expense ----------
create table if not exists fin_budgets (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references tenants(id) on delete cascade,
  category_id uuid not null references acc_accounts(id), monthly numeric(16,2) not null check (monthly >= 0),
  unique (tenant_id, category_id)
);
alter table fin_budgets enable row level security;

create or replace function fin_budget_save(p_category uuid, p_monthly numeric) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := fin_guard('admin');
  if not exists (select 1 from acc_accounts where id = p_category and tenant_id = tid and type = 'expense') then raise exception 'Choose a kind of expense'; end if;
  if coalesce(p_monthly, 0) <= 0 then delete from fin_budgets where tenant_id = tid and category_id = p_category;
  else insert into fin_budgets (tenant_id, category_id, monthly) values (tid, p_category, p_monthly) on conflict (tenant_id, category_id) do update set monthly = excluded.monthly; end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function fin_budget_status(p_month date default null) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; f date := date_trunc('month', coalesce(p_month, current_date))::date; t date; total_days int; gone int;
begin
  tid := fin_guard('view');
  t := (f + interval '1 month - 1 day')::date; total_days := extract(day from t)::int; gone := least(greatest(current_date - f + 1, 1), total_days);
  return jsonb_build_object('month', f, 'days', total_days, 'gone', gone, 'rows', (select coalesce(jsonb_agg(jsonb_build_object('category_id', ac.id, 'name', ac.name, 'budget', b.monthly,
      'spent', coalesce(s.amt, 0), 'forecast', round(coalesce(s.amt, 0) * total_days / gone, 2)) order by coalesce(s.amt, 0) / nullif(b.monthly, 0) desc nulls last), '[]')
    from fin_budgets b join acc_accounts ac on ac.id = b.category_id
    left join (select x.category_id cid, sum(x.amount) amt from fin_txns x where x.tenant_id = tid and x.status = 'posted' and x.txn_date between f and t and x.kind in ('expense','credit_purchase') group by x.category_id) s on s.cid = b.category_id
    where b.tenant_id = tid),
    'categories', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name), '[]') from acc_accounts where tenant_id = tid and type = 'expense' and active));
end $$;

-- ---------- entries that still need a person to look ----------
create or replace function fin_review_queue() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := fin_guard('view');
  return jsonb_build_object('needs_review', (select count(*) from fin_txns where tenant_id = tid and status = 'posted' and review = 'needs_review'),
    'no_proof', (select count(*) from fin_txns where tenant_id = tid and status = 'posted' and evidence = 'none' and kind in ('expense','drawing','asset_buy','money_in')),
    'bill_to_come', (select count(*) from fin_txns where tenant_id = tid and status = 'posted' and evidence = 'pending'),
    'old_pending', (select count(*) from fin_txns where tenant_id = tid and status = 'posted' and evidence = 'pending' and txn_date < current_date - 14));
end $$;
