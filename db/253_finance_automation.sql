-- AUZsFinance phase 3: approvals above a limit, recurring entries, bank statement import, payment reminders, anomalies, cash forecast.
-- Same rules as phase 1: tables RLS on with no policies, access only through SECURITY DEFINER fin_* functions that start with fin_guard().

create table if not exists fin_settings (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  approval_limit numeric(16,2) not null default 0,     -- 0 = every entry is accepted as it is; above it, a non-manager's entry waits for a manager
  reminder_days int not null default 7,                -- ask for money that has been owed this many days
  updated_at timestamptz not null default now()
);
alter table fin_settings enable row level security;

create or replace function fin_settings_get() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; s fin_settings;
begin
  tid := fin_guard('view');
  select * into s from fin_settings where tenant_id = tid;
  return jsonb_build_object('approval_limit', coalesce(s.approval_limit, 0), 'reminder_days', coalesce(s.reminder_days, 7));
end $$;

create or replace function fin_settings_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; lim numeric := greatest(coalesce((p->>'approval_limit')::numeric, 0), 0); rd int := least(greatest(coalesce((p->>'reminder_days')::int, 7), 1), 365);
begin
  tid := fin_guard('admin');
  insert into fin_settings (tenant_id, approval_limit, reminder_days) values (tid, lim, rd)
  on conflict (tenant_id) do update set approval_limit = excluded.approval_limit, reminder_days = excluded.reminder_days, updated_at = now();
  perform acc_audit_log(tid, 'update', 'fin_settings', tid::text, null, jsonb_build_object('approval_limit', lim, 'reminder_days', rd));
  return fin_settings_get();
end $$;

-- ---------- approvals: a big entry from someone who cannot approve is saved as "needs review" ----------
do $$ begin
  if not exists (select 1 from pg_proc where proname = 'fin_save_txn_core') then
    alter function fin_save_txn(jsonb) rename to fin_save_txn_core;
  end if;
end $$;

create or replace function fin_save_txn(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; lim numeric; amt numeric := coalesce((p->>'amount')::numeric, 0);
begin
  tid := fin_guard('write');
  select approval_limit into lim from fin_settings where tenant_id = tid;
  if coalesce(lim, 0) > 0 and amt >= lim and coalesce(p->>'kind','') <> 'transfer' and not acc_perm('acc_approve') then
    p := p || jsonb_build_object('review', 'needs_review');
  end if;
  return fin_save_txn_core(p);
end $$;

-- ---------- recurring entries (rent, salary, EMI, subscriptions) ----------
create table if not exists fin_recurring (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  kind text not null, amount numeric(16,2) not null check (amount > 0),
  freq text not null check (freq in ('weekly','monthly','yearly')),
  start_date date not null, next_date date not null, end_date date,
  auto boolean not null default true,            -- true: posts as confirmed; false: posts as "needs review"
  active boolean not null default true,
  payload jsonb not null default '{}'::jsonb,    -- account_id, to_account_id, category_id, person_id, partner_id, loan_id, purpose, interest
  last_run date, last_error text, created_by uuid, created_at timestamptz not null default now()
);
create index if not exists fin_recurring_due on fin_recurring (tenant_id, next_date) where active;
alter table fin_recurring enable row level security;

create or replace function fin_rec_next(d date, f text) returns date language sql immutable as $$
  select case f when 'weekly' then d + 7 when 'yearly' then (d + interval '1 year')::date else (d + interval '1 month')::date end
$$;

create or replace function fin_recurring_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; r fin_recurring; id_ uuid := nullif(p->>'id','')::uuid; amt numeric := round(coalesce((p->>'amount')::numeric, 0), 2);
  d date := coalesce(nullif(p->>'start_date','')::date, current_date); pay jsonb;
begin
  tid := fin_guard('write');
  if amt <= 0 then raise exception 'Enter an amount above zero'; end if;
  if coalesce(p->>'freq','') not in ('weekly','monthly','yearly') then raise exception 'Choose how often'; end if;
  if coalesce(p->>'kind','') not in ('expense','money_in','transfer','drawing','capital_in','dues_out','dues_in','loan_repay','loan_collect','credit_sale','credit_purchase') then raise exception 'This kind of entry cannot repeat'; end if;
  pay := coalesce(p->'payload', '{}'::jsonb);
  if id_ is null then
    insert into fin_recurring (tenant_id, kind, amount, freq, start_date, next_date, end_date, auto, payload, created_by)
    values (tid, p->>'kind', amt, p->>'freq', d, d, nullif(p->>'end_date','')::date, coalesce((p->>'auto')::boolean, true), pay, app_uid()) returning * into r;
  else
    update fin_recurring set kind = p->>'kind', amount = amt, freq = p->>'freq', end_date = nullif(p->>'end_date','')::date,
      auto = coalesce((p->>'auto')::boolean, auto), payload = pay, active = coalesce((p->>'active')::boolean, active)
    where id = id_ and tenant_id = tid returning * into r;
    if r.id is null then raise exception 'Repeating entry not found'; end if;
  end if;
  perform acc_audit_log(tid, 'save', 'fin_recurring', r.id::text, null, to_jsonb(r));
  return to_jsonb(r);
end $$;

create or replace function fin_recurring_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := fin_guard('view');
  return (select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object(
      'account', (select name from fin_accounts where id = nullif(r.payload->>'account_id','')::uuid),
      'person', (select name from fin_people where id = nullif(r.payload->>'person_id','')::uuid),
      'due', r.active and r.next_date <= current_date and (r.end_date is null or r.next_date <= r.end_date)) order by r.active desc, r.next_date), '[]')
    from fin_recurring r where r.tenant_id = tid);
end $$;

create or replace function fin_recurring_stop(p_id uuid, p_active boolean) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; r fin_recurring;
begin
  tid := fin_guard('write');
  update fin_recurring set active = p_active where id = p_id and tenant_id = tid returning * into r;
  if r.id is null then raise exception 'Repeating entry not found'; end if;
  return to_jsonb(r);
end $$;

-- posts every entry that has come due (each date once: the entry id carries the date); a failure is kept on the row, never lost
create or replace function fin_recurring_run(p_to date default current_date) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; r fin_recurring; n int := 0; bad int := 0; guard int; to_ date := least(coalesce(p_to, current_date), current_date);
begin
  tid := fin_guard('write');
  for r in select * from fin_recurring where tenant_id = tid and active and next_date <= to_ and (end_date is null or next_date <= end_date) order by next_date for update loop
    guard := 0;
    while r.next_date <= to_ and (r.end_date is null or r.next_date <= r.end_date) and guard < 24 loop
      guard := guard + 1;
      begin
        perform fin_save_txn_core(coalesce(r.payload, '{}'::jsonb) || jsonb_build_object('op', 'rec:' || r.id || ':' || r.next_date, 'kind', r.kind, 'amount', r.amount, 'date', r.next_date,
          'review', case when r.auto then 'confirmed' else 'needs_review' end, 'evidence', 'none'));
        n := n + 1;
        update fin_recurring set last_run = r.next_date, last_error = null, next_date = fin_rec_next(r.next_date, r.freq) where id = r.id returning * into r;
      exception when others then
        bad := bad + 1; update fin_recurring set last_error = sqlerrm where id = r.id; exit;
      end;
    end loop;
    if r.end_date is not null and r.next_date > r.end_date then update fin_recurring set active = false where id = r.id; end if;
  end loop;
  return jsonb_build_object('posted', n, 'failed', bad);
end $$;

-- ---------- bank statement import ----------
create or replace function fin_signed(x fin_txns, acc uuid) returns numeric language sql immutable as $$
  select case when x.account_id = acc then
      (case when x.kind in ('money_in','dues_in','capital_in','loan_taken','loan_collect') then x.amount + case when x.kind = 'loan_collect' then x.interest else 0 end
            when x.kind = 'transfer' then -x.amount else -(x.amount + case when x.kind = 'loan_repay' then x.interest else 0 end) end)
    else x.amount end
$$;

create or replace function fin_import_key(acc uuid, d date, amt numeric, ref text, descr text, occ int) returns text language sql immutable as $$
  select 'imp:' || md5(acc::text || '|' || d::text || '|' || amt::text || '|' || coalesce(ref,'') || '|' || coalesce(descr,'')) || ':' || occ
$$;

create or replace function fin_import_preview(p_account uuid, p_rows jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; a fin_accounts; r jsonb; i int := 0; d date; amt numeric; ref text; descr text; m fin_txns; used uuid[] := '{}'; out jsonb := '[]'::jsonb; seen jsonb := '{}'::jsonb; kk text; occ int; st text;
begin
  tid := fin_guard('view');
  select * into a from fin_accounts where id = p_account and tenant_id = tid;
  if a.id is null then raise exception 'Account not found'; end if;
  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 2000 then raise exception 'Import at most 2000 rows at a time'; end if;
  for r in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    i := i + 1; m := null; st := 'new';
    begin d := (r->>'date')::date; exception when others then d := null; end;
    amt := round(coalesce((r->>'credit')::numeric, 0) - coalesce((r->>'debit')::numeric, 0), 2);
    ref := nullif(trim(r->>'ref'), ''); descr := left(coalesce(r->>'desc', ''), 200);
    if d is null or amt = 0 then st := 'skip';
    else
      kk := md5(d::text || amt::text || coalesce(ref,'') || descr); occ := coalesce((seen->>kk)::int, 0) + 1; seen := seen || jsonb_build_object(kk, occ);
      if exists (select 1 from fin_txns where tenant_id = tid and client_op = fin_import_key(a.id, d, amt, ref, descr, occ))
         or (ref is not null and exists (select 1 from fin_txns where tenant_id = tid and account_id = a.id and reference = ref and status = 'posted')) then st := 'duplicate';
      else
        select * into m from fin_txns x where x.tenant_id = tid and x.status = 'posted' and (x.account_id = a.id or x.to_account_id = a.id)
          and x.kind not in ('credit_sale','credit_purchase') and fin_signed(x, a.id) = amt and abs(x.txn_date - d) <= 4 and x.id <> all(used)
          and not exists (select 1 from fin_cleared c where c.txn_id = x.id and c.account_id = a.id)
          order by abs(x.txn_date - d), x.created_at limit 1;
        if m.id is not null then st := 'matched'; used := used || m.id; end if;
      end if;
    end if;
    out := out || jsonb_build_array(jsonb_build_object('i', i, 'status', st, 'date', d, 'amount', amt, 'desc', descr, 'ref', ref,
      'txn_id', m.id, 'txn_title', case when m.id is not null then coalesce(m.purpose, m.kind) end));
  end loop;
  return jsonb_build_object('account', a.name, 'rows', out);
end $$;

create or replace function fin_import_commit(p_account uuid, p_rows jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; a fin_accounts; r jsonb; d date; amt numeric; ref text; descr text; act text; saved jsonb; matched int := 0; created int := 0; skipped int := 0; dups int := 0; seen jsonb := '{}'::jsonb; kk text; occ int; k text; tx uuid;
begin
  tid := fin_guard('write');
  select * into a from fin_accounts where id = p_account and tenant_id = tid;
  if a.id is null then raise exception 'Account not found'; end if;
  if jsonb_array_length(coalesce(p_rows, '[]'::jsonb)) > 2000 then raise exception 'Import at most 2000 rows at a time'; end if;
  for r in select value from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    begin d := (r->>'date')::date; exception when others then d := null; end;
    amt := round(coalesce((r->>'credit')::numeric, 0) - coalesce((r->>'debit')::numeric, 0), 2);
    ref := nullif(trim(r->>'ref'), ''); descr := left(coalesce(r->>'desc', ''), 200); act := coalesce(r->>'action', 'new');
    if d is null or amt = 0 or act = 'skip' then skipped := skipped + 1; continue; end if;
    kk := md5(d::text || amt::text || coalesce(ref,'') || descr); occ := coalesce((seen->>kk)::int, 0) + 1; seen := seen || jsonb_build_object(kk, occ);
    if act = 'match' then
      tx := nullif(r->>'txn_id','')::uuid;
      if tx is null or not exists (select 1 from fin_txns where id = tx and tenant_id = tid) then skipped := skipped + 1; continue; end if;
      insert into fin_cleared (txn_id, account_id, tenant_id, cleared_by) values (tx, a.id, tid, app_uid()) on conflict do nothing;
      update fin_txns set reference = coalesce(reference, ref) where id = tx;
      matched := matched + 1;
    else
      if exists (select 1 from fin_txns where tenant_id = tid and client_op = fin_import_key(a.id, d, amt, ref, descr, occ)) then dups := dups + 1; continue; end if;
      k := coalesce(nullif(r->>'kind',''), case when amt > 0 then 'money_in' else 'expense' end);
      if k not in ('money_in','expense') then k := case when amt > 0 then 'money_in' else 'expense' end; end if;
      saved := fin_save_txn_core(jsonb_build_object('op', fin_import_key(a.id, d, amt, ref, descr, occ), 'kind', k, 'amount', abs(amt), 'date', d, 'account_id', a.id,
        'category_id', nullif(r->>'category_id',''), 'purpose', nullif(descr, ''), 'method', 'bank', 'evidence', 'have', 'review', 'needs_review', 'note', 'From the bank statement'));
      tx := (saved->>'id')::uuid;
      update fin_txns set reference = ref where id = tx;
      insert into fin_cleared (txn_id, account_id, tenant_id, cleared_by) values (tx, a.id, tid, app_uid()) on conflict do nothing;
      created := created + 1;
    end if;
  end loop;
  perform acc_audit_log(tid, 'import', 'fin_bank', a.id::text, null, jsonb_build_object('matched', matched, 'created', created, 'skipped', skipped, 'duplicates', dups));
  return jsonb_build_object('matched', matched, 'created', created, 'skipped', skipped, 'duplicates', dups);
end $$;

-- ---------- reminders for money people owe you ----------
create or replace function fin_reminders() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; days int;
begin
  tid := fin_guard('view');
  select coalesce(reminder_days, 7) into days from (select 1) x left join fin_settings s on s.tenant_id = tid;
  days := coalesce(days, 7);
  return (select coalesce(jsonb_agg(jsonb_build_object('id', (b->>'id')::uuid, 'name', b->>'name', 'phone', b->>'phone', 'amount', (b->>'balance')::numeric,
      'oldest', b->>'oldest', 'age_days', current_date - (b->>'oldest')::date) order by (b->>'balance')::numeric desc), '[]')
    from jsonb_array_elements(fin_people_balances()) b
    where (b->>'balance')::numeric > 0 and (b->>'oldest') is not null and current_date - (b->>'oldest')::date >= days);
end $$;

create or replace function fin_send_reminder(p_person uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; pe fin_people; bal numeric; r jsonb;
begin
  tid := fin_guard('write');
  select * into pe from fin_people where id = p_person and tenant_id = tid;
  if pe.id is null then raise exception 'Person not found'; end if;
  select coalesce((b->>'balance')::numeric, 0) into bal from jsonb_array_elements(fin_people_balances()) b where (b->>'id')::uuid = pe.id;
  if coalesce(bal, 0) <= 0 then raise exception 'This person owes nothing'; end if;
  r := wa_due_send(tid, pe.phone, pe.name, bal, 'finrem-' || pe.id || '-' || current_date);
  return r || jsonb_build_object('amount', bal);
end $$;

-- ---------- things that look wrong ----------
create or replace function fin_anomalies() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; out jsonb := '[]'::jsonb; r record;
begin
  tid := fin_guard('view');
  -- the same amount, kind and account twice within a day
  for r in select a.id a_id, b.id b_id, a.kind, a.amount, a.txn_date, coalesce(a.purpose, a.kind) title from fin_txns a join fin_txns b on b.tenant_id = a.tenant_id and b.id > a.id
      and b.kind = a.kind and b.amount = a.amount and coalesce(b.account_id, b.person_id) is not distinct from coalesce(a.account_id, a.person_id) and abs(b.txn_date - a.txn_date) <= 1
      and b.status = 'posted' where a.tenant_id = tid and a.status = 'posted' and a.txn_date > current_date - 90 and a.kind in ('expense','money_in','drawing','dues_out','dues_in') order by a.txn_date desc limit 20 loop
    out := out || jsonb_build_array(jsonb_build_object('type', 'duplicate', 'tone', 'orange', 'title', 'Looks entered twice: ' || r.title, 'amount', r.amount, 'date', r.txn_date, 'txn_ids', jsonb_build_array(r.a_id, r.b_id)));
  end loop;
  -- an expense far above that category's usual size
  for r in select x.id, x.amount, x.txn_date, coalesce(x.purpose, c.name) title, q.avg_amt from fin_txns x join acc_accounts c on c.id = x.category_id
      join lateral (select avg(y.amount) avg_amt, count(*) n from fin_txns y where y.tenant_id = x.tenant_id and y.category_id = x.category_id and y.status = 'posted' and y.kind = 'expense' and y.id <> x.id and y.txn_date > current_date - 180) q on q.n >= 3
      where x.tenant_id = tid and x.status = 'posted' and x.kind = 'expense' and x.txn_date > current_date - 45 and x.amount >= 5000 and x.amount > q.avg_amt * 4 order by x.amount desc limit 10 loop
    out := out || jsonb_build_array(jsonb_build_object('type', 'big', 'tone', 'orange', 'title', 'Much bigger than usual: ' || r.title, 'amount', r.amount, 'date', r.txn_date, 'txn_ids', jsonb_build_array(r.id), 'detail', 'Usually about ' || round(r.avg_amt)::text));
  end loop;
  -- a big payment with no bill
  for r in select id, amount, txn_date, coalesce(purpose, kind) title from fin_txns where tenant_id = tid and status = 'posted' and kind in ('expense','asset_buy','drawing') and evidence = 'none' and amount >= 10000 and txn_date > current_date - 60 order by amount desc limit 10 loop
    out := out || jsonb_build_array(jsonb_build_object('type', 'noproof', 'tone', 'red', 'title', 'Large payment without a bill: ' || r.title, 'amount', r.amount, 'date', r.txn_date, 'txn_ids', jsonb_build_array(r.id)));
  end loop;
  -- an account below zero
  for r in select name, fin_balance(tid, ledger_id) bal from fin_accounts where tenant_id = tid and active and fin_balance(tid, ledger_id) < 0 loop
    out := out || jsonb_build_array(jsonb_build_object('type', 'negative', 'tone', 'red', 'title', r.name || ' is below zero', 'amount', r.bal));
  end loop;
  -- loans past their date
  for r in select counterparty, direction, due_date from fin_loans where tenant_id = tid and status = 'open' and due_date < current_date loop
    out := out || jsonb_build_array(jsonb_build_object('type', 'loan', 'tone', 'red', 'title', 'Loan past its date: ' || r.counterparty, 'date', r.due_date));
  end loop;
  -- money owed for a long time
  for r in select b->>'name' name, (b->>'balance')::numeric bal, current_date - (b->>'oldest')::date age from jsonb_array_elements(fin_people_balances()) b
      where (b->>'balance')::numeric > 0 and (b->>'oldest') is not null and current_date - (b->>'oldest')::date > 60 order by (b->>'balance')::numeric desc limit 10 loop
    out := out || jsonb_build_array(jsonb_build_object('type', 'olddue', 'tone', 'orange', 'title', r.name || ' has owed you for ' || r.age || ' days', 'amount', r.bal));
  end loop;
  return out;
end $$;

-- ---------- what the cash is likely to do ----------
create or replace function fin_forecast() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; cash numeric; din numeric := 0; dout numeric := 0; inn numeric; outt numeric; days int := 60; net_day numeric; rec_in numeric := 0; rec_out numeric := 0; r fin_recurring; d date;
begin
  tid := fin_guard('view');
  select coalesce(sum(fin_balance(tid, ledger_id)), 0) into cash from fin_accounts where tenant_id = tid and active;
  select coalesce(sum(amount + case when kind = 'loan_collect' then interest else 0 end), 0) into inn from fin_txns where tenant_id = tid and status = 'posted' and txn_date > current_date - days and kind in ('money_in','dues_in','capital_in','loan_taken','loan_collect');
  select coalesce(sum(amount + case when kind = 'loan_repay' then interest else 0 end), 0) into outt from fin_txns where tenant_id = tid and status = 'posted' and txn_date > current_date - days and kind in ('expense','drawing','loan_given','loan_repay','dues_out','asset_buy');
  select coalesce(sum(debit - credit), 0) into din from acc_journal_lines where tenant_id = tid and account_id = fin_acct(tid,'fin_dues_in');
  select coalesce(sum(credit - debit), 0) into dout from acc_journal_lines where tenant_id = tid and account_id = fin_acct(tid,'fin_dues_out');
  net_day := (inn - outt) / days;
  for r in select * from fin_recurring where tenant_id = tid and active loop
    d := r.next_date;
    while d <= current_date + 30 and (r.end_date is null or d <= r.end_date) loop
      if r.kind in ('money_in','capital_in','dues_in','loan_collect') then rec_in := rec_in + r.amount; elsif r.kind in ('expense','drawing','dues_out','loan_repay') then rec_out := rec_out + r.amount; end if;
      d := fin_rec_next(d, r.freq);
    end loop;
  end loop;
  return jsonb_build_object('cash_now', cash, 'avg_in_per_day', round(inn / days, 2), 'avg_out_per_day', round(outt / days, 2), 'net_per_day', round(net_day, 2),
    'cash_in_30', round(cash + net_day * 30, 2), 'to_receive', din, 'to_pay', dout, 'recurring_in_30', rec_in, 'recurring_out_30', rec_out,
    'runway_days', case when net_day < 0 and cash > 0 then floor(cash / -net_day) end, 'based_on_days', days);
end $$;
