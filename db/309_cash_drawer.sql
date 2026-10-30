-- AUZsLedger: Cash drawer. Notes and coins received and given back on cash sales and purchases, bank deposits and withdrawals, loans lent and
-- borrowed, owner cash in and out, and the opening / closing count of the drawer. Everything posts to the books (Cash in hand), so the drawer
-- always matches the ledger. Tables have row security and no policies: reached only through the functions below.
create table if not exists acc_drawer_moves (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null check (kind in ('sale', 'purchase', 'deposit', 'withdraw', 'loan_given', 'loan_taken', 'loan_repaid', 'loan_collected', 'owner_in', 'owner_out')),
  dir smallint not null check (dir in (1, -1)),                -- +1 cash comes into the drawer, -1 cash leaves it
  amount numeric(14,2) not null check (amount > 0),
  notes_in jsonb not null default '{}'::jsonb,                 -- notes and coins that came in, {"500": 2, "100": 3}
  notes_out jsonb not null default '{}'::jsonb,                -- notes and coins that went out (change given back, or cash paid)
  ref_type text, ref_id uuid,                                  -- the invoice or bill for a sale / purchase
  party_id uuid, who text,                                     -- loan: the person (a party, or just a name)
  bank_account_id uuid, memo text,
  journal_id uuid,
  status text not null default 'posted' check (status in ('posted', 'cancelled')),
  client_op text,
  created_by uuid, created_at timestamptz not null default now()
);
create unique index if not exists acc_drawer_moves_op on acc_drawer_moves (tenant_id, client_op) where client_op is not null;
create index if not exists acc_drawer_moves_t on acc_drawer_moves (tenant_id, at);
create table if not exists acc_drawer_counts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  at timestamptz not null default now(),
  kind text not null check (kind in ('open', 'close', 'spot')),
  counted jsonb not null default '{}'::jsonb,
  total numeric(14,2) not null default 0,
  expected numeric(14,2) not null default 0,                   -- what the books said was in the drawer at that moment
  diff numeric(14,2) not null default 0,                       -- counted minus expected (negative = short)
  note text, journal_id uuid,
  created_by uuid, created_at timestamptz not null default now()
);
create index if not exists acc_drawer_counts_t on acc_drawer_counts (tenant_id, at desc);
alter table acc_drawer_moves enable row level security;
alter table acc_drawer_counts enable row level security;

-- value of a notes map; refuses anything that is not a known note or coin, or a negative / fractional count
create or replace function acc_denom_total(n jsonb) returns numeric language plpgsql immutable as $$
declare k text; v numeric; tot numeric := 0;
begin
  if n is null or jsonb_typeof(n) <> 'object' then return 0; end if;
  for k in select jsonb_object_keys(n) loop
    if k not in ('2000', '500', '200', '100', '50', '20', '10', '5', '2', '1') then raise exception 'Unknown note or coin: %', k using errcode = 'AC001'; end if;
    v := coalesce((n ->> k)::numeric, 0);
    if v < 0 or v <> trunc(v) then raise exception 'Note counts must be whole numbers, zero or more' using errcode = 'AC001'; end if;
    tot := tot + v * k::numeric;
  end loop;
  return tot;
end $$;

-- cash in hand according to the books (all cash accounts, not bank)
create or replace function acc_cash_book(tid uuid) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(jl.debit - jl.credit), 0) from acc_journal_lines jl join acc_accounts a on a.id = jl.account_id
   where jl.tenant_id = tid and a.is_cash and not a.is_bank
$$;

-- "Loans given" (money you lent out and are owed back) is created the first time it is needed
create or replace function acc_ensure_drawer_accounts(tid uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into acc_accounts (tenant_id, code, name, type, grp, system_key)
  select tid, '1410', 'Loans given', 'asset', 'Current assets', 'loans_given'
  where not exists (select 1 from acc_accounts where tenant_id = tid and system_key = 'loans_given') on conflict do nothing;
  insert into acc_accounts (tenant_id, code, name, type, grp, system_key)
  select tid, '5199', 'Cash short and excess', 'expense', 'Operating expenses', 'cash_over_short'
  where not exists (select 1 from acc_accounts where tenant_id = tid and system_key = 'cash_over_short') on conflict do nothing;
end $$;

-- p: {doc_id, notes_in, notes_out, op}. Called after a cash sale / purchase has been posted: saves the notes received and given back.
create or replace function acc_drawer_record(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; d acc_documents; cash numeric; nin numeric; nout numeric; k text; sid uuid; op text := nullif(p->>'op', '');
begin
  select * into d from acc_documents where id = (p->>'doc_id')::uuid;
  if d.id is null then raise exception 'Document not found'; end if;
  k := case when d.doc_type in ('invoice', 'debit_note') then 'sale' when d.doc_type in ('bill', 'expense', 'credit_note') then 'purchase' else null end;
  if k is null then raise exception 'Cash can be counted on invoices, bills and expenses only'; end if;
  tid := acc_guard(case when k = 'sale' then 'acc_sales' else 'acc_purchase' end);
  if d.tenant_id <> tid then raise exception 'Document not found'; end if;
  if op is not null then select id into sid from acc_drawer_moves where tenant_id = tid and client_op = op; if sid is not null then return jsonb_build_object('id', sid, 'duplicate', true); end if; end if;
  nin := acc_denom_total(p->'notes_in'); nout := acc_denom_total(p->'notes_out');
  select coalesce(sum(al.amount), 0) into cash from acc_allocations al join acc_payments pm on pm.id = al.payment_id join acc_accounts a on a.id = pm.account_id
   where al.doc_id = d.id and al.reversed_at is null and pm.status = 'posted' and a.is_cash and not a.is_bank;
  if cash <= 0 then raise exception 'This document has no cash payment to count'; end if;
  if k = 'sale' and nin - nout <> cash then raise exception 'Notes received (%) minus change (%) must equal the cash paid (%)', nin, nout, cash using errcode = 'AC001'; end if;
  if k = 'purchase' and nout - nin <> cash then raise exception 'Notes paid out (%) minus change received (%) must equal the cash paid (%)', nout, nin, cash using errcode = 'AC001'; end if;
  insert into acc_drawer_moves (tenant_id, kind, dir, amount, notes_in, notes_out, ref_type, ref_id, party_id, client_op, created_by)
  values (tid, k, case when k = 'sale' then 1 else -1 end, cash, coalesce(p->'notes_in', '{}'), coalesce(p->'notes_out', '{}'), 'document', d.id, d.party_id, op, app_uid()) returning id into sid;
  return jsonb_build_object('id', sid);
end $$;

-- p: {kind, amount, date, bank_account_id, party_id, who, memo, notes_in, notes_out, op}
create or replace function acc_drawer_move(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; k text := p->>'kind'; amt numeric := (p->>'amount')::numeric; d date := coalesce(nullif(p->>'date', '')::date, current_date); fy uuid; dir smallint;
  cash uuid; other uuid; bank acc_accounts; lines jsonb := '[]'; jid uuid; sid uuid; op text := nullif(p->>'op', ''); nin numeric; nout numeric; lbl text; bal numeric; pty uuid := nullif(p->>'party_id', '')::uuid;
begin
  if k not in ('deposit', 'withdraw', 'loan_given', 'loan_taken', 'loan_repaid', 'loan_collected', 'owner_in', 'owner_out') then raise exception 'Choose what the cash is for'; end if;
  tid := acc_guard('acc_post');
  if amt is null or amt <= 0 then raise exception 'Enter an amount above zero'; end if;
  if op is not null then select id into sid from acc_drawer_moves where tenant_id = tid and client_op = op; if sid is not null then return jsonb_build_object('id', sid, 'duplicate', true); end if; end if;
  fy := acc_assert_open(tid, d);
  perform acc_ensure_drawer_accounts(tid);
  dir := case when k in ('withdraw', 'loan_taken', 'loan_collected', 'owner_in') then 1 else -1 end;
  nin := acc_denom_total(p->'notes_in'); nout := acc_denom_total(p->'notes_out');
  if (nin > 0 or nout > 0) and (nin - nout) <> dir * amt then raise exception 'The notes you counted (in % minus out %) do not match the amount %', nin, nout, amt using errcode = 'AC001'; end if;
  bal := acc_cash_book(tid);
  if dir = -1 and amt > bal then raise exception 'There is only % in the drawer; you cannot take out %', bal, amt using errcode = 'AC001'; end if;
  cash := acc_sys(tid, 'cash');
  lbl := case k when 'deposit' then 'Cash deposited in bank' when 'withdraw' then 'Cash withdrawn from bank' when 'loan_given' then 'Loan given' when 'loan_taken' then 'Loan taken'
    when 'loan_repaid' then 'Loan repaid' when 'loan_collected' then 'Loan received back' when 'owner_in' then 'Owner put in cash' else 'Owner took out cash' end;
  if k in ('deposit', 'withdraw') then
    select * into bank from acc_accounts where id = nullif(p->>'bank_account_id', '')::uuid and tenant_id = tid;
    if bank.id is null or not bank.is_bank then raise exception 'Choose the bank account'; end if;
    other := bank.id;
  else other := acc_sys(tid, case k when 'loan_given' then 'loans_given' when 'loan_collected' then 'loans_given' when 'loan_taken' then 'loans' when 'loan_repaid' then 'loans' when 'owner_in' then 'capital' else 'drawings' end);
  end if;
  if dir = 1 then lines := acc_jl(acc_jl(lines, cash, null, amt, lbl), other, pty, -amt, lbl);
  else lines := acc_jl(acc_jl(lines, other, pty, amt, lbl), cash, null, -amt, lbl); end if;
  jid := acc_post_journal(tid, 'contra', d, fy, null, lbl || coalesce(' - ' || nullif(p->>'who', ''), '') || coalesce(': ' || nullif(p->>'memo', ''), ''), 'drawer', null, lines);
  insert into acc_drawer_moves (tenant_id, at, kind, dir, amount, notes_in, notes_out, party_id, who, bank_account_id, memo, journal_id, client_op, created_by)
  values (tid, (d::timestamp + (now()::time)), k, dir, amt, coalesce(p->'notes_in', '{}'), coalesce(p->'notes_out', '{}'), pty, nullif(p->>'who', ''), bank.id, nullif(p->>'memo', ''), jid, op, app_uid()) returning id into sid;
  perform acc_audit_log(tid, 'create', 'drawer', sid::text, null, jsonb_build_object('kind', k, 'amount', amt));
  return jsonb_build_object('id', sid, 'balance', acc_cash_book(tid));
end $$;

create or replace function acc_drawer_void(p_id uuid, p_reason text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; m acc_drawer_moves;
begin
  tid := acc_guard('acc_post');
  select * into m from acc_drawer_moves where id = p_id and tenant_id = tid for update;
  if m.id is null then raise exception 'Entry not found'; end if;
  if m.journal_id is null then raise exception 'A cash sale or purchase is cancelled by cancelling its invoice or bill'; end if;
  if m.status = 'cancelled' then return jsonb_build_object('id', m.id, 'status', 'cancelled'); end if;
  perform acc_reverse_journal(tid, m.journal_id, current_date, p_reason);
  update acc_drawer_moves set status = 'cancelled' where id = m.id;
  perform acc_audit_log(tid, 'cancel', 'drawer', m.id::text, null, jsonb_build_object('kind', m.kind, 'amount', m.amount), p_reason);
  return jsonb_build_object('id', m.id, 'status', 'cancelled', 'balance', acc_cash_book(tid));
end $$;

-- p: {kind: open|close|spot, counted: {"500": 3, ...}, note, adjust: bool}. Counts the drawer, compares with the books, and (adjust) posts a shortage or excess.
create or replace function acc_drawer_count(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; k text := coalesce(nullif(p->>'kind', ''), 'spot'); tot numeric; exp numeric; df numeric; cid uuid := gen_random_uuid(); jid uuid; fy uuid; lines jsonb := '[]'; cash uuid; os uuid;
begin
  if k not in ('open', 'close', 'spot') then raise exception 'Choose open, close or spot count'; end if;
  tid := acc_guard('acc_post');
  tot := acc_denom_total(p->'counted');
  exp := acc_cash_book(tid); df := tot - exp;
  if coalesce((p->>'adjust')::boolean, false) and df <> 0 then
    fy := acc_assert_open(tid, current_date);
    perform acc_ensure_drawer_accounts(tid);
    cash := acc_sys(tid, 'cash'); os := acc_sys(tid, 'cash_over_short');
    if df > 0 then lines := acc_jl(acc_jl(lines, cash, null, df, 'Cash excess'), os, null, -df, 'Cash excess');
    else lines := acc_jl(acc_jl(lines, os, null, -df, 'Cash short'), cash, null, df, 'Cash short'); end if;
    jid := acc_post_journal(tid, 'journal', current_date, fy, null, case when df > 0 then 'Cash excess found at drawer count' else 'Cash shortage found at drawer count' end, 'drawer', cid, lines);
  end if;
  insert into acc_drawer_counts (id, tenant_id, kind, counted, total, expected, diff, note, journal_id, created_by)
  values (cid, tid, k, coalesce(p->'counted', '{}'), tot, exp, df, nullif(p->>'note', ''), jid, app_uid());
  perform acc_audit_log(tid, 'create', 'drawer_count', cid::text, null, jsonb_build_object('kind', k, 'total', tot, 'expected', exp));
  return jsonb_build_object('id', cid, 'total', tot, 'expected', exp, 'diff', df, 'adjusted', jid is not null);
end $$;

-- p: {from, to, kind, limit}. Balance, notes in the drawer, last count and the list of everything that moved cash.
create or replace function acc_drawer_status(p jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; bal numeric; lc acc_drawer_counts; notes jsonb := '{}'::jsonb; k text; v numeric; since timestamptz := '-infinity'; lim int := least(coalesce((p->>'limit')::int, 200), 1000);
  d1 date := nullif(p->>'from', '')::date; d2 date := nullif(p->>'to', '')::date; act jsonb; ntot numeric := 0; kd text := nullif(p->>'kind', '');
begin
  tid := acc_guard('acc_view');
  bal := acc_cash_book(tid);
  select * into lc from acc_drawer_counts where tenant_id = tid order by at desc limit 1;
  if lc.id is not null then notes := lc.counted; since := lc.at; end if;
  for k in select unnest(array['2000', '500', '200', '100', '50', '20', '10', '5', '2', '1']) loop
    v := coalesce((notes ->> k)::numeric, 0)
      + coalesce((select sum(coalesce((m.notes_in ->> k)::numeric, 0) - coalesce((m.notes_out ->> k)::numeric, 0)) from acc_drawer_moves m
                   where m.tenant_id = tid and m.status = 'posted' and m.at > since
                     and not exists (select 1 from acc_documents dd where dd.id = m.ref_id and dd.status = 'cancelled')), 0);
    notes := notes || jsonb_build_object(k, v); ntot := ntot + v * k::numeric;
  end loop;
  select coalesce(jsonb_agg(x order by (x->>'at') desc), '[]'::jsonb) into act from (
    select x from (
      select jsonb_build_object('id', m.id, 'at', m.at, 'kind', m.kind, 'dir', m.dir, 'amount', m.amount, 'who', coalesce(m.who, (select name from acc_parties where id = m.party_id)),
        'memo', m.memo, 'bank', (select name from acc_accounts where id = m.bank_account_id), 'status', m.status, 'counted', true, 'manual', m.journal_id is not null,
        'doc', (select number from acc_documents where id = m.ref_id)) as x, m.at as ts
        from acc_drawer_moves m where m.tenant_id = tid and (m.journal_id is not null or true)
         and (d1 is null or m.at::date >= d1) and (d2 is null or m.at::date <= d2) and (kd is null or m.kind = kd)
      union all
      select jsonb_build_object('id', pm.id, 'at', pm.pay_date::timestamp, 'kind', case when pm.kind = 'receipt' then 'sale' else 'purchase' end, 'dir', case when pm.kind = 'receipt' then 1 else -1 end,
        'amount', pm.amount, 'who', (select name from acc_parties where id = pm.party_id), 'memo', pm.notes, 'status', pm.status, 'counted', false, 'manual', false, 'doc', pm.number), pm.pay_date::timestamp
        from acc_payments pm join acc_accounts a on a.id = pm.account_id
       where pm.tenant_id = tid and a.is_cash and not a.is_bank and pm.status = 'posted'
         and not exists (select 1 from acc_drawer_moves m2 join acc_allocations al on al.doc_id = m2.ref_id where al.payment_id = pm.id and m2.status = 'posted')
         and (d1 is null or pm.pay_date >= d1) and (d2 is null or pm.pay_date <= d2) and (kd is null or kd = case when pm.kind = 'receipt' then 'sale' else 'purchase' end)
    ) u order by ts desc limit lim) z;
  return jsonb_build_object('balance', bal, 'notes', notes, 'counted_total', ntot, 'uncounted', bal - ntot,
    'last_count', case when lc.id is null then null else jsonb_build_object('at', lc.at, 'kind', lc.kind, 'total', lc.total, 'expected', lc.expected, 'diff', lc.diff, 'note', lc.note) end,
    'activity', act,
    'banks', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name), '[]') from acc_accounts where tenant_id = tid and is_bank and active));
end $$;
-- Rollback: drop the six drawer functions, acc_denom_total, acc_cash_book and the two tables; the "Loans given" / "Cash short and excess" accounts can stay.
