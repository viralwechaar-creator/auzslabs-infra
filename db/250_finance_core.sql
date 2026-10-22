-- AUZsFinance phase 1: a money-tracking layer on the AUZsLedger double-entry books.
-- Every transaction posts a balanced journal through acc_post_journal; nothing is deleted (a mistake is reversed).
-- Tables: RLS on, no policies; all access through SECURITY DEFINER fin_* functions that start with fin_guard().

create table if not exists fin_accounts (      -- cash, bank, UPI, card, wallet ("where the money sits")
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null, kind text not null check (kind in ('cash','bank','upi','card','wallet')),
  ledger_id uuid not null references acc_accounts(id),
  opening numeric(16,2) not null default 0, opening_date date,
  active boolean not null default true, created_at timestamptz not null default now()
);
create table if not exists fin_partners (      -- owner, partners, investors
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null, kind text not null default 'partner' check (kind in ('owner','partner','investor')),
  share_pct numeric(6,2), capital_ledger_id uuid not null references acc_accounts(id), drawings_ledger_id uuid not null references acc_accounts(id),
  active boolean not null default true, created_at timestamptz not null default now()
);
create table if not exists fin_people (        -- customers, suppliers, staff, friends: anyone money is owed to or by
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null, phone text, kind text not null default 'other' check (kind in ('customer','supplier','staff','other')),
  notes text, active boolean not null default true, created_at timestamptz not null default now()
);
create table if not exists fin_loans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  direction text not null check (direction in ('taken','given')),
  counterparty text not null, rate_pct numeric(6,2), start_date date not null default current_date, due_date date,
  ledger_id uuid not null references acc_accounts(id), notes text,
  status text not null default 'open' check (status in ('open','closed')), created_at timestamptz not null default now()
);
create table if not exists fin_txns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  client_op text, kind text not null check (kind in ('money_in','expense','capital_in','drawing','loan_taken','loan_given','loan_repay','loan_collect','transfer','credit_sale','credit_purchase','dues_in','dues_out','asset_buy')),
  txn_date date not null, amount numeric(16,2) not null check (amount > 0),
  interest numeric(16,2) not null default 0,
  account_id uuid references fin_accounts(id), to_account_id uuid references fin_accounts(id),
  category_id uuid references acc_accounts(id), person_id uuid references fin_people(id),
  partner_id uuid references fin_partners(id), loan_id uuid references fin_loans(id),
  purpose text, method text, evidence text not null default 'none' check (evidence in ('have','pending','none')),
  review text not null default 'confirmed' check (review in ('confirmed','needs_review')),
  note text, due_date date,
  journal_id uuid references acc_journals(id), status text not null default 'posted' check (status in ('posted','reversed')),
  reversal_of uuid references fin_txns(id), reversed_reason text,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index if not exists fin_txns_op on fin_txns (tenant_id, client_op) where client_op is not null;
create index if not exists fin_txns_date on fin_txns (tenant_id, txn_date desc);
create index if not exists fin_txns_person on fin_txns (tenant_id, person_id) where person_id is not null;
alter table fin_accounts enable row level security; alter table fin_partners enable row level security;
alter table fin_people enable row level security; alter table fin_loans enable row level security; alter table fin_txns enable row level security;

-- ---------- access ----------
create or replace function fin_guard(k text default 'view') returns uuid language plpgsql stable security definer set search_path = public as $$
declare tid uuid; f jsonb; e jsonb; ok boolean;
begin
  if me() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  tid := (me()->>'tenant_id')::uuid;
  if tid is null then raise exception 'not a tenant member'; end if;
  select features, enabled_features into f, e from tenant_settings where tenant_id = tid;
  if not (coalesce(f->>'finance','false') = 'true' and coalesce(e->>'finance','true') <> 'false') then
    raise exception 'AUZsFinance is not enabled for this business';
  end if;
  ok := case k when 'view' then acc_perm('acc_view') when 'write' then acc_perm('acc_post') else acc_perm('acc_admin') end;
  if not ok then raise exception 'Your role does not allow this action (finance %)', k using errcode = '42501'; end if;
  return tid;
end $$;

create or replace function acc_storage_check() returns boolean language plpgsql stable security definer set search_path = public as $$
declare tid uuid; f jsonb;
begin
  select features into f from tenant_settings where tenant_id = (me()->>'tenant_id')::uuid;
  if coalesce(f->>'finance','false') = 'true' then
    tid := fin_guard('view'); return acc_perm('acc_post');
  end if;
  tid := acc_guard('acc_view');
  return acc_perm('acc_sales') or acc_perm('acc_purchase');
end $$;

-- ---------- ledger helpers ----------
create or replace function fin_acct(tid uuid, skey text) returns uuid language sql stable security definer set search_path = public as
$$ select id from acc_accounts where tenant_id = tid and system_key = skey $$;

create or replace function fin_new_ledger(tid uuid, nm text, typ text, grp text, bank boolean default false, cash boolean default false) returns uuid
language plpgsql security definer set search_path = public as $$
declare n int; id uuid;
begin
  select coalesce(max(substring(code from 3)::int), 0) + 1 into n from acc_accounts where tenant_id = tid and code ~ '^FN[0-9]+$';
  insert into acc_accounts (tenant_id, code, name, type, grp, is_bank, is_cash) values (tid, 'FN' || lpad(n::text, 4, '0'), nm, typ, grp, bank, cash) returning acc_accounts.id into id;
  return id;
end $$;

-- the finance extras: dues ledgers
create or replace function fin_setup(tid uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from acc_org where tenant_id = tid) then perform acc_seed_tenant(tid); end if;
  insert into acc_accounts (tenant_id, code, name, type, grp, system_key) values
    (tid, '1450', 'Dues to receive (people)', 'asset', 'Current assets', 'fin_dues_in'),
    (tid, '2450', 'Dues to pay (people)', 'liability', 'Current liabilities', 'fin_dues_out'),
    (tid, '3950', 'Money to be sorted (suspense)', 'equity', 'Capital', 'fin_suspense')
  on conflict do nothing;
  if not exists (select 1 from fin_accounts where tenant_id = tid) then
    insert into fin_accounts (tenant_id, name, kind, ledger_id)
      select tid, 'Cash in hand', 'cash', id from acc_accounts where tenant_id = tid and system_key = 'cash';
    insert into fin_accounts (tenant_id, name, kind, ledger_id)
      select tid, 'Bank account', 'bank', id from acc_accounts where tenant_id = tid and system_key = 'bank';
  end if;
end $$;

create or replace function fin_balance(tid uuid, lid uuid, upto date default null) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(l.debit - l.credit), 0) from acc_journal_lines l join acc_journals j on j.id = l.journal_id
  where l.tenant_id = tid and l.account_id = lid and (upto is null or j.jdate <= upto)
$$;

-- ---------- bootstrap ----------
create or replace function fin_bootstrap() returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; fy uuid;
begin
  tid := fin_guard('view');
  if not exists (select 1 from acc_org where tenant_id = tid) or fin_acct(tid, 'fin_dues_in') is null then
    if not acc_perm('acc_admin') then raise exception 'AUZsFinance has not been set up yet - ask the owner to open it once'; end if;
    perform fin_setup(tid);
    perform acc_audit_log(tid, 'setup', 'finance', tid::text, null, jsonb_build_object('note', 'AUZsFinance set up'));
  end if;
  return jsonb_build_object(
    'tenant', (select jsonb_build_object('id', id, 'name', name, 'slug', slug, 'is_demo', is_demo) from tenants where id = tid),
    'role', me()->>'role', 'email', (select email from auth_users where id = app_uid()),
    'perms', jsonb_build_object('view', acc_perm('acc_view'), 'write', acc_perm('acc_post'), 'admin', acc_perm('acc_admin')),
    'lock_date', (select lock_date from acc_org where tenant_id = tid), 'today', current_date,
    'accounts', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'kind', a.kind, 'ledger_id', a.ledger_id, 'active', a.active, 'balance', fin_balance(tid, a.ledger_id)) order by a.created_at), '[]') from fin_accounts a where a.tenant_id = tid),
    'categories', jsonb_build_object(
      'expense', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'key', system_key) order by code), '[]') from acc_accounts where tenant_id = tid and type = 'expense' and active and coalesce(system_key,'') not in ('cogs','purchases','purchase_return','stock_adjust','dep_expense') and code <> '5113'),
      'income', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'key', system_key) order by code), '[]') from acc_accounts where tenant_id = tid and type = 'income' and active and coalesce(system_key,'') not in ('sales_return','round_off','disposal_gl'))),
    'partners', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'kind', kind, 'share_pct', share_pct, 'active', active) order by created_at), '[]') from fin_partners where tenant_id = tid),
    'people', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'phone', phone, 'kind', kind) order by name), '[]') from fin_people where tenant_id = tid and active),
    'loans', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'direction', direction, 'counterparty', counterparty, 'status', status) order by created_at), '[]') from fin_loans where tenant_id = tid));
end $$;

-- ---------- masters ----------
create or replace function fin_save_account(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; a fin_accounts; lid uuid; op numeric; nm text := btrim(coalesce(p->>'name',''));
begin
  tid := fin_guard('admin');
  if nm = '' then raise exception 'Give the account a name'; end if;
  if nullif(p->>'id','') is not null then
    update fin_accounts set name = nm, active = coalesce((p->>'active')::boolean, active) where id = (p->>'id')::uuid and tenant_id = tid returning * into a;
    update acc_accounts set name = nm where id = a.ledger_id;
    return to_jsonb(a);
  end if;
  lid := fin_new_ledger(tid, nm, 'asset', 'Current assets', (p->>'kind') in ('bank','card'), (p->>'kind') = 'cash');
  insert into fin_accounts (tenant_id, name, kind, ledger_id, opening, opening_date)
  values (tid, nm, coalesce(p->>'kind','bank'), lid, coalesce((p->>'opening')::numeric,0), coalesce((p->>'opening_date')::date, current_date)) returning * into a;
  op := a.opening;
  if op <> 0 then
    perform acc_post_journal(tid, 'opening', a.opening_date, acc_assert_open(tid, a.opening_date), null, 'Opening balance - ' || nm, 'fin_account', a.id,
      jsonb_build_array(
        jsonb_build_object('account_id', lid, 'debit', greatest(op,0), 'credit', greatest(-op,0)),
        jsonb_build_object('account_id', fin_acct(tid,'opening_equity'), 'debit', greatest(-op,0), 'credit', greatest(op,0))));
  end if;
  perform acc_audit_log(tid, 'create', 'fin_account', a.id::text, null, to_jsonb(a));
  return to_jsonb(a);
end $$;

create or replace function fin_save_person(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; r fin_people; nm text := btrim(coalesce(p->>'name',''));
begin
  tid := fin_guard('write');
  if nm = '' then raise exception 'Give the person or business a name'; end if;
  if nullif(p->>'id','') is not null then
    update fin_people set name = nm, phone = nullif(p->>'phone',''), kind = coalesce(p->>'kind', kind), notes = p->>'notes', active = coalesce((p->>'active')::boolean, active)
    where id = (p->>'id')::uuid and tenant_id = tid returning * into r;
  else
    select * into r from fin_people where tenant_id = tid and lower(name) = lower(nm) and coalesce(phone,'') = coalesce(nullif(p->>'phone',''),'');
    if r.id is null then
      insert into fin_people (tenant_id, name, phone, kind, notes) values (tid, nm, nullif(p->>'phone',''), coalesce(p->>'kind','other'), p->>'notes') returning * into r;
    end if;
  end if;
  return to_jsonb(r);
end $$;

create or replace function fin_save_partner(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; r fin_partners; nm text := btrim(coalesce(p->>'name',''));
begin
  tid := fin_guard('admin');
  if nm = '' then raise exception 'Give the partner a name'; end if;
  if nullif(p->>'id','') is not null then
    update fin_partners set name = nm, kind = coalesce(p->>'kind', kind), share_pct = nullif(p->>'share_pct','')::numeric, active = coalesce((p->>'active')::boolean, active)
    where id = (p->>'id')::uuid and tenant_id = tid returning * into r;
    update acc_accounts set name = 'Capital - ' || nm where id = r.capital_ledger_id;
    update acc_accounts set name = 'Drawings - ' || nm where id = r.drawings_ledger_id;
  else
    insert into fin_partners (tenant_id, name, kind, share_pct, capital_ledger_id, drawings_ledger_id)
    values (tid, nm, coalesce(p->>'kind','partner'), nullif(p->>'share_pct','')::numeric,
            fin_new_ledger(tid, 'Capital - ' || nm, 'equity', 'Capital'), fin_new_ledger(tid, 'Drawings - ' || nm, 'equity', 'Capital')) returning * into r;
  end if;
  perform acc_audit_log(tid, 'save', 'fin_partner', r.id::text, null, to_jsonb(r));
  return to_jsonb(r);
end $$;

create or replace function fin_save_loan(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; r fin_loans; nm text := btrim(coalesce(p->>'counterparty',''));
begin
  tid := fin_guard('write');
  if nm = '' then raise exception 'Who is the loan with?'; end if;
  if nullif(p->>'id','') is not null then
    update fin_loans set counterparty = nm, rate_pct = nullif(p->>'rate_pct','')::numeric, due_date = nullif(p->>'due_date','')::date, notes = p->>'notes',
      status = coalesce(p->>'status', status) where id = (p->>'id')::uuid and tenant_id = tid returning * into r;
  else
    insert into fin_loans (tenant_id, direction, counterparty, rate_pct, start_date, due_date, notes, ledger_id)
    values (tid, p->>'direction', nm, nullif(p->>'rate_pct','')::numeric, coalesce((p->>'start_date')::date, current_date), nullif(p->>'due_date','')::date, p->>'notes',
            fin_new_ledger(tid, case when p->>'direction' = 'taken' then 'Loan from ' else 'Loan to ' end || nm,
                           case when p->>'direction' = 'taken' then 'liability' else 'asset' end,
                           case when p->>'direction' = 'taken' then 'Long-term liabilities' else 'Current assets' end)) returning * into r;
  end if;
  perform acc_audit_log(tid, 'save', 'fin_loan', r.id::text, null, to_jsonb(r));
  return to_jsonb(r);
end $$;

-- ---------- the universal entry ----------
create or replace function fin_save_txn(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; t fin_txns; k text := p->>'kind'; amt numeric := round(coalesce((p->>'amount')::numeric,0),2); intr numeric := round(coalesce((p->>'interest')::numeric,0),2);
  d date := coalesce((p->>'date')::date, current_date); acc fin_accounts; acc2 fin_accounts; pt fin_partners; ln fin_loans; ps fin_people;
  lines jsonb; fy uuid; narr text; cat uuid; opn text := nullif(p->>'op',''); jid uuid; pid uuid; nid uuid := gen_random_uuid();
begin
  tid := fin_guard('write');
  if opn is not null then
    select * into t from fin_txns where tenant_id = tid and client_op = opn;
    if t.id is not null then return to_jsonb(t) || jsonb_build_object('duplicate', true); end if;
  end if;
  if amt <= 0 then raise exception 'Enter an amount above zero'; end if;
  if d > current_date + 1 then raise exception 'The date is in the future'; end if;
  fy := acc_assert_open(tid, d);
  if nullif(p->>'account_id','') is not null then
    select * into acc from fin_accounts where id = (p->>'account_id')::uuid and tenant_id = tid;
    if acc.id is null then raise exception 'Choose where the money is'; end if;
  end if;
  if nullif(p->>'to_account_id','') is not null then
    select * into acc2 from fin_accounts where id = (p->>'to_account_id')::uuid and tenant_id = tid;
  end if;
  if nullif(p->>'partner_id','') is not null then select * into pt from fin_partners where id = (p->>'partner_id')::uuid and tenant_id = tid; end if;
  if nullif(p->>'loan_id','') is not null then select * into ln from fin_loans where id = (p->>'loan_id')::uuid and tenant_id = tid; end if;
  if nullif(p->>'person_id','') is not null then select * into ps from fin_people where id = (p->>'person_id')::uuid and tenant_id = tid; pid := ps.id; end if;
  cat := nullif(p->>'category_id','')::uuid;
  if cat is not null and not exists (select 1 from acc_accounts where id = cat and tenant_id = tid) then raise exception 'Unknown category'; end if;

  if k = 'money_in' then
    if acc.id is null then raise exception 'Choose where the money came in'; end if;
    cat := coalesce(cat, fin_acct(tid, 'other_income'));
    lines := jsonb_build_array(jsonb_build_object('account_id', acc.ledger_id, 'debit', amt), jsonb_build_object('account_id', cat, 'credit', amt));
    narr := 'Money received' || coalesce(' - ' || (p->>'purpose'), '');
  elsif k = 'expense' then
    if acc.id is null then raise exception 'Choose how it was paid'; end if;
    cat := coalesce(cat, fin_acct(tid, 'general_expense'));
    lines := jsonb_build_array(jsonb_build_object('account_id', cat, 'debit', amt), jsonb_build_object('account_id', acc.ledger_id, 'credit', amt));
    narr := 'Expense' || coalesce(' - ' || (p->>'purpose'), '');
  elsif k = 'capital_in' then
    if acc.id is null or pt.id is null then raise exception 'Choose the account and who put the money in'; end if;
    lines := jsonb_build_array(jsonb_build_object('account_id', acc.ledger_id, 'debit', amt), jsonb_build_object('account_id', pt.capital_ledger_id, 'credit', amt));
    narr := 'Capital added by ' || pt.name;
  elsif k = 'drawing' then
    if acc.id is null or pt.id is null then raise exception 'Choose the account and who took the money'; end if;
    lines := jsonb_build_array(jsonb_build_object('account_id', pt.drawings_ledger_id, 'debit', amt), jsonb_build_object('account_id', acc.ledger_id, 'credit', amt));
    narr := 'Withdrawn by ' || pt.name;
  elsif k = 'loan_taken' then
    if acc.id is null or ln.id is null or ln.direction <> 'taken' then raise exception 'Choose the account and the loan'; end if;
    lines := jsonb_build_array(jsonb_build_object('account_id', acc.ledger_id, 'debit', amt), jsonb_build_object('account_id', ln.ledger_id, 'credit', amt));
    narr := 'Loan received from ' || ln.counterparty;
  elsif k = 'loan_given' then
    if acc.id is null or ln.id is null or ln.direction <> 'given' then raise exception 'Choose the account and the loan'; end if;
    lines := jsonb_build_array(jsonb_build_object('account_id', ln.ledger_id, 'debit', amt), jsonb_build_object('account_id', acc.ledger_id, 'credit', amt));
    narr := 'Loan given to ' || ln.counterparty;
  elsif k = 'loan_repay' then            -- amount = principal, interest = extra we paid
    if acc.id is null or ln.id is null or ln.direction <> 'taken' then raise exception 'Choose the account and the loan'; end if;
    lines := jsonb_build_array(jsonb_build_object('account_id', ln.ledger_id, 'debit', amt),
      jsonb_build_object('account_id', (select id from acc_accounts where tenant_id = tid and code = '5113'), 'debit', intr),
      jsonb_build_object('account_id', acc.ledger_id, 'credit', amt + intr));
    narr := 'Loan repayment to ' || ln.counterparty;
  elsif k = 'loan_collect' then          -- money back from a loan we gave
    if acc.id is null or ln.id is null or ln.direction <> 'given' then raise exception 'Choose the account and the loan'; end if;
    lines := jsonb_build_array(jsonb_build_object('account_id', acc.ledger_id, 'debit', amt + intr),
      jsonb_build_object('account_id', ln.ledger_id, 'credit', amt),
      jsonb_build_object('account_id', fin_acct(tid,'other_income'), 'credit', intr));
    narr := 'Loan money back from ' || ln.counterparty;
  elsif k = 'transfer' then
    if acc.id is null or acc2.id is null or acc.id = acc2.id then raise exception 'Choose two different accounts'; end if;
    lines := jsonb_build_array(jsonb_build_object('account_id', acc2.ledger_id, 'debit', amt), jsonb_build_object('account_id', acc.ledger_id, 'credit', amt));
    narr := 'Moved from ' || acc.name || ' to ' || acc2.name;
  elsif k = 'credit_sale' then            -- someone owes us
    if pid is null then raise exception 'Choose who owes you'; end if;
    cat := coalesce(cat, fin_acct(tid, 'sales'));
    lines := jsonb_build_array(jsonb_build_object('account_id', fin_acct(tid,'fin_dues_in'), 'debit', amt), jsonb_build_object('account_id', cat, 'credit', amt));
    narr := 'On credit to ' || ps.name;
  elsif k = 'credit_purchase' then        -- we owe someone
    if pid is null then raise exception 'Choose who you owe'; end if;
    cat := coalesce(cat, fin_acct(tid, 'general_expense'));
    lines := jsonb_build_array(jsonb_build_object('account_id', cat, 'debit', amt), jsonb_build_object('account_id', fin_acct(tid,'fin_dues_out'), 'credit', amt));
    narr := 'On credit from ' || ps.name;
  elsif k = 'dues_in' then
    if acc.id is null or pid is null then raise exception 'Choose the account and who paid'; end if;
    lines := jsonb_build_array(jsonb_build_object('account_id', acc.ledger_id, 'debit', amt), jsonb_build_object('account_id', fin_acct(tid,'fin_dues_in'), 'credit', amt));
    narr := 'Received from ' || ps.name;
  elsif k = 'dues_out' then
    if acc.id is null or pid is null then raise exception 'Choose the account and who you paid'; end if;
    lines := jsonb_build_array(jsonb_build_object('account_id', fin_acct(tid,'fin_dues_out'), 'debit', amt), jsonb_build_object('account_id', acc.ledger_id, 'credit', amt));
    narr := 'Paid to ' || ps.name;
  elsif k = 'asset_buy' then
    if acc.id is null then raise exception 'Choose how it was paid'; end if;
    cat := coalesce(cat, fin_acct(tid, 'fixed_assets'));
    lines := jsonb_build_array(jsonb_build_object('account_id', cat, 'debit', amt), jsonb_build_object('account_id', acc.ledger_id, 'credit', amt));
    narr := 'Asset bought' || coalesce(' - ' || (p->>'purpose'), '');
  else
    raise exception 'Unknown kind of transaction';
  end if;

  jid := acc_post_journal(tid, case when k = 'transfer' then 'contra' else 'journal' end, d, fy, null, narr, 'fin_txn', nid, lines);
  insert into fin_txns (id, tenant_id, client_op, kind, txn_date, amount, interest, account_id, to_account_id, category_id, person_id, partner_id, loan_id,
    purpose, method, evidence, review, note, due_date, journal_id, created_by)
  values (nid, tid, opn, k, d, amt, intr, acc.id, acc2.id, cat, pid, pt.id, ln.id, nullif(p->>'purpose',''), nullif(p->>'method',''),
    coalesce(nullif(p->>'evidence',''),'none'), coalesce(nullif(p->>'review',''),'confirmed'), nullif(p->>'note',''), nullif(p->>'due_date','')::date, jid, app_uid())
  returning * into t;
  perform acc_audit_log(tid, 'create', 'fin_txn', t.id::text, null, to_jsonb(t));
  return to_jsonb(t);
end $$;

-- fix evidence / review without touching the money
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
    note = case when p ? 'note' then p->>'note' else note end, purpose = case when p ? 'purpose' then p->>'purpose' else purpose end, updated_at = now()
  where id = p_id returning * into t;
  perform acc_audit_log(tid, 'mark', 'fin_txn', t.id::text, to_jsonb(o), to_jsonb(t));
  return to_jsonb(t);
end $$;

create or replace function fin_reverse_txn(p_id uuid, p_reason text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; o fin_txns; rj uuid;
begin
  tid := fin_guard('write');
  select * into o from fin_txns where id = p_id and tenant_id = tid for update;
  if o.id is null then raise exception 'Transaction not found'; end if;
  if o.status = 'reversed' then raise exception 'This transaction is already cancelled'; end if;
  if coalesce(btrim(p_reason),'') = '' then raise exception 'Say why it is being cancelled'; end if;
  rj := acc_reverse_journal(tid, o.journal_id, current_date, p_reason);
  update fin_txns set status = 'reversed', reversed_reason = p_reason, updated_at = now() where id = p_id returning * into o;
  perform acc_audit_log(tid, 'reverse', 'fin_txn', o.id::text, null, jsonb_build_object('reason', p_reason, 'journal', rj));
  return to_jsonb(o);
end $$;

create or replace function fin_attach(p_id uuid, p_name text, p_url text, p_size int default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; n int;
begin
  tid := fin_guard('write');
  if not exists (select 1 from fin_txns where id = p_id and tenant_id = tid) then raise exception 'Transaction not found'; end if;
  insert into acc_attachments (tenant_id, entity, entity_id, name, url, size_bytes, created_by) values (tid, 'fin_txn', p_id, left(p_name, 200), p_url, p_size, app_uid());
  update fin_txns set evidence = 'have', updated_at = now() where id = p_id;
  select count(*) into n from acc_attachments where tenant_id = tid and entity = 'fin_txn' and entity_id = p_id;
  return jsonb_build_object('ok', true, 'files', n);
end $$;

-- ---------- reads ----------
create or replace function fin_txn_json(t fin_txns, tid uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(t) || jsonb_build_object(
    'account', (select name from fin_accounts where id = t.account_id), 'to_account', (select name from fin_accounts where id = t.to_account_id),
    'category', (select name from acc_accounts where id = t.category_id), 'person', (select name from fin_people where id = t.person_id),
    'partner', (select name from fin_partners where id = t.partner_id), 'loan', (select counterparty from fin_loans where id = t.loan_id),
    'files', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'url', url) order by created_at), '[]') from acc_attachments where tenant_id = tid and entity = 'fin_txn' and entity_id = t.id),
    'journal_no', (select number from acc_journals where id = t.journal_id))
$$;

create or replace function fin_txn_list(p jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; lim int := least(coalesce((p->>'limit')::int, 100), 500);
begin
  tid := fin_guard('view');
  return (select coalesce(jsonb_agg(fin_txn_json(t, tid) order by t.txn_date desc, t.created_at desc), '[]') from (
    select * from fin_txns x where x.tenant_id = tid
      and (nullif(p->>'from','') is null or x.txn_date >= (p->>'from')::date) and (nullif(p->>'to','') is null or x.txn_date <= (p->>'to')::date)
      and (nullif(p->>'kind','') is null or x.kind = p->>'kind')
      and (nullif(p->>'account_id','') is null or x.account_id = (p->>'account_id')::uuid or x.to_account_id = (p->>'account_id')::uuid)
      and (nullif(p->>'person_id','') is null or x.person_id = (p->>'person_id')::uuid)
      and (nullif(p->>'partner_id','') is null or x.partner_id = (p->>'partner_id')::uuid)
      and (nullif(p->>'loan_id','') is null or x.loan_id = (p->>'loan_id')::uuid)
      and (nullif(p->>'evidence','') is null or x.evidence = p->>'evidence')
      and (nullif(p->>'review','') is null or x.review = p->>'review')
      and (coalesce((p->>'with_reversed')::boolean, true) or x.status = 'posted')
      and (nullif(p->>'q','') is null or coalesce(x.purpose,'') ilike '%' || (p->>'q') || '%' or coalesce(x.note,'') ilike '%' || (p->>'q') || '%')
    order by x.txn_date desc, x.created_at desc limit lim) t);
end $$;

create or replace function fin_dashboard(p_from date default null, p_to date default null) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; f date := coalesce(p_from, date_trunc('month', current_date)::date); t date := coalesce(p_to, current_date);
  cash_total numeric; din numeric; dout numeric; cap numeric; drw numeric; ltaken numeric; lgiven numeric;
begin
  tid := fin_guard('view');
  select coalesce(sum(fin_balance(tid, ledger_id)), 0) into cash_total from fin_accounts where tenant_id = tid and active;
  select coalesce(sum(debit - credit), 0) into din from acc_journal_lines where tenant_id = tid and account_id = fin_acct(tid,'fin_dues_in');
  select coalesce(sum(credit - debit), 0) into dout from acc_journal_lines where tenant_id = tid and account_id = fin_acct(tid,'fin_dues_out');
  select coalesce(sum(fin_balance(tid, capital_ledger_id) * -1), 0), coalesce(sum(fin_balance(tid, drawings_ledger_id)), 0) into cap, drw from fin_partners where tenant_id = tid;
  select coalesce(sum(-fin_balance(tid, ledger_id)), 0) into ltaken from fin_loans where tenant_id = tid and direction = 'taken';
  select coalesce(sum(fin_balance(tid, ledger_id)), 0) into lgiven from fin_loans where tenant_id = tid and direction = 'given';
  return jsonb_build_object('from', f, 'to', t,
    'cash_total', cash_total, 'dues_in', din, 'dues_out', dout, 'capital', cap, 'drawings', drw, 'loans_taken', ltaken, 'loans_given', lgiven,
    'money_in', (select coalesce(sum(amount + case when kind = 'loan_collect' then interest else 0 end), 0) from fin_txns where tenant_id = tid and status = 'posted' and txn_date between f and t and kind in ('money_in','dues_in','capital_in','loan_taken','loan_collect')),
    'money_out', (select coalesce(sum(amount + case when kind = 'loan_repay' then interest else 0 end), 0) from fin_txns where tenant_id = tid and status = 'posted' and txn_date between f and t and kind in ('expense','drawing','loan_given','loan_repay','dues_out','asset_buy')),
    'income', (select coalesce(sum(amount), 0) from fin_txns where tenant_id = tid and status = 'posted' and txn_date between f and t and kind in ('money_in','credit_sale')),
    'expenses', (select coalesce(sum(case when kind = 'loan_repay' then interest else amount end), 0) from fin_txns where tenant_id = tid and status = 'posted' and txn_date between f and t and kind in ('expense','credit_purchase','loan_repay')),
    'needs_review', (select count(*) from fin_txns where tenant_id = tid and status = 'posted' and review = 'needs_review'),
    'no_evidence', (select count(*) from fin_txns where tenant_id = tid and status = 'posted' and evidence <> 'have' and kind in ('expense','drawing','asset_buy','money_in')),
    'by_category', (select coalesce(jsonb_agg(jsonb_build_object('name', n, 'amount', s) order by s desc), '[]') from (
        select a.name n, sum(x.amount) s from fin_txns x join acc_accounts a on a.id = x.category_id
        where x.tenant_id = tid and x.status = 'posted' and x.txn_date between f and t and x.kind in ('expense','credit_purchase') group by a.name) q),
    'by_month', (select coalesce(jsonb_agg(jsonb_build_object('month', m, 'in', i, 'out', o) order by m), '[]') from (
        select to_char(txn_date, 'YYYY-MM') m,
          sum(case when kind in ('money_in','dues_in','capital_in','loan_taken','loan_collect') then amount else 0 end) i,
          sum(case when kind in ('expense','drawing','loan_given','loan_repay','dues_out','asset_buy') then amount else 0 end) o
        from fin_txns where tenant_id = tid and status = 'posted' and txn_date >= (date_trunc('month', current_date) - interval '5 months')::date group by 1) q),
    'accounts', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'kind', kind, 'balance', fin_balance(tid, ledger_id)) order by created_at), '[]') from fin_accounts where tenant_id = tid and active),
    'recent', (select coalesce(jsonb_agg(fin_txn_json(x, tid)), '[]') from (select * from fin_txns where tenant_id = tid order by txn_date desc, created_at desc limit 8) x));
end $$;

create or replace function fin_people_balances() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := fin_guard('view');
  return (select coalesce(jsonb_agg(r order by abs(r.balance) desc), '[]') from (
    select p.id, p.name, p.phone, p.kind,
      coalesce(sum(case when x.kind = 'credit_sale' then x.amount when x.kind = 'dues_in' then -x.amount else 0 end), 0) as owed_to_us,
      coalesce(sum(case when x.kind = 'credit_purchase' then x.amount when x.kind = 'dues_out' then -x.amount else 0 end), 0) as owed_by_us,
      coalesce(sum(case when x.kind = 'credit_sale' then x.amount when x.kind = 'dues_in' then -x.amount
                        when x.kind = 'credit_purchase' then -x.amount when x.kind = 'dues_out' then x.amount else 0 end), 0) as balance,
      min(case when x.kind in ('credit_sale','credit_purchase') then x.txn_date end) as oldest
    from fin_people p left join fin_txns x on x.person_id = p.id and x.status = 'posted'
    where p.tenant_id = tid and p.active group by p.id) r where r.balance <> 0 or r.owed_to_us <> 0 or r.owed_by_us <> 0);
end $$;

create or replace function fin_loan_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := fin_guard('view');
  return (select coalesce(jsonb_agg(to_jsonb(l) || jsonb_build_object(
      'outstanding', case when l.direction = 'taken' then -fin_balance(tid, l.ledger_id) else fin_balance(tid, l.ledger_id) end,
      'interest', (select coalesce(sum(interest), 0) from fin_txns where loan_id = l.id and status = 'posted' and kind in ('loan_repay','loan_collect')),
      'principal_total', (select coalesce(sum(amount), 0) from fin_txns where loan_id = l.id and status = 'posted' and kind in ('loan_taken','loan_given'))
    ) order by l.created_at desc), '[]') from fin_loans l where l.tenant_id = tid);
end $$;

create or replace function fin_partner_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := fin_guard('view');
  return (select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object(
      'capital', -fin_balance(tid, r.capital_ledger_id), 'drawings', fin_balance(tid, r.drawings_ledger_id),
      'net', -fin_balance(tid, r.capital_ledger_id) - fin_balance(tid, r.drawings_ledger_id)) order by r.created_at), '[]')
    from fin_partners r where r.tenant_id = tid);
end $$;

create or replace function fin_integrity_check() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; bad int; ledger_cash numeric; tot_dr numeric; tot_cr numeric;
begin
  tid := fin_guard('view');
  select coalesce(sum(debit),0), coalesce(sum(credit),0) into tot_dr, tot_cr from acc_journal_lines where tenant_id = tid;
  select count(*) into bad from fin_txns t where t.tenant_id = tid and t.journal_id is null;
  return jsonb_build_object('books_balance', tot_dr = tot_cr, 'debit', tot_dr, 'credit', tot_cr, 'txns_without_journal', bad,
    'txns', (select count(*) from fin_txns where tenant_id = tid), 'ok', tot_dr = tot_cr and bad = 0);
end $$;
