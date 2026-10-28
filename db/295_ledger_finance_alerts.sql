-- =========================================================
-- Notifications for AUZsLedger / AUZsScan / AUZsFinance (one engine on the shared inbox from db/273).
--  * notifications gets a severity (critical / warning / info / success), a category, an action label and a dedupe ref.
--  * alert_emit() is the ONE place that decides who gets a notice (owner, managers, or everyone, never the person who
--    did the thing), whether it is switched off, the flood guard and quiet hours for the phone alert.
--  * Triggers raise notices the moment something happens (payments, bills, approvals, staff, logins ...).
--  * alerts_run() is called every hour by the server (maintenance.js): due dates, overdue, cash and bank, budgets,
--    repeating entries, bank matching, GST dates, daily / weekly / monthly summaries and a few rule-based "smart" notes.
--  * alerts_settings_get / alerts_settings_save: what each business wants (owner and managers only).
-- Everything swallows its own errors: a notice must never block the real action.
-- =========================================================

alter table notifications add column if not exists severity text check (severity in ('critical','warning','info','success'));
alter table notifications add column if not exists app text;
alter table notifications add column if not exists cat text;
alter table notifications add column if not exists action text;
alter table notifications add column if not exists ref text;
alter table notifications add column if not exists push boolean not null default true;
create unique index if not exists notifications_user_ref on notifications (user_id, ref) where ref is not null and user_id is not null;

create table if not exists alert_settings (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  settings jsonb not null default '{}',
  updated_at timestamptz not null default now()
);
alter table alert_settings enable row level security;

-- ---------- the inbox now also returns severity, category, action ----------
create or replace function inbox_list(p_limit int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v uuid := app_uid(); v_tid uuid; v_sup boolean; v_items jsonb; v_unread int;
begin
  if v is null then raise exception 'authentication required'; end if;
  begin v_tid := (me()->>'tenant_id')::uuid; exception when others then v_tid := null; end;
  v_sup := is_platform_admin() or v = any(platform_supervisor_ids());
  with mine as (
    select n.* from notifications n
    where (n.user_id = v)
       or (n.user_id is null and n.tenant_id is null and v_sup)
       or (n.user_id is null and n.tenant_id is not null and n.tenant_id = v_tid)
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'type', x.type, 'title', x.title, 'body', x.body, 'link', x.link,
           'read', x.read, 'created_at', x.created_at, 'severity', x.severity, 'cat', x.cat, 'action', x.action, 'app', x.app)
           order by x.created_at desc), '[]'::jsonb)
    into v_items
  from (select * from mine order by created_at desc limit least(greatest(coalesce(p_limit, 30), 1), 200)) x;
  select count(*) into v_unread from notifications n
    where not n.read and ((n.user_id = v) or (n.user_id is null and n.tenant_id is null and v_sup)
       or (n.user_id is null and n.tenant_id is not null and n.tenant_id = v_tid));
  return jsonb_build_object('items', v_items, 'unread', v_unread);
end $$;

-- a phone / browser alert is sent only when the notice says so (quiet hours and info notes do not buzz)
create or replace function notification_user_push() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is not null and new.type not like 'team\_%' and coalesce(new.push, true) then
    perform notify_platform_push(array[new.user_id], new.title, new.body);
  end if;
  return new;
exception when others then
  return new;
end $$;

-- ---------- small helpers ----------
create or replace function alert_inr(n numeric) returns text language plpgsql immutable as $$
declare s text := round(abs(coalesce(n, 0)))::bigint::text; head text; tail text;
begin
  if length(s) > 3 then
    tail := right(s, 3); head := left(s, length(s) - 3);
    head := regexp_replace(head, '(\d)(?=(\d\d)+$)', '\1,', 'g');
    s := head || ',' || tail;
  end if;
  return case when n < 0 then '-' else '' end || '₹' || s;
end $$;

create or replace function alert_defaults() returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'off', '[]'::jsonb, 'recipients', 'managers', 'push', true,
    'low_cash', 0, 'low_bank', 0, 'large_in', 0, 'large_out', 0,
    'remind_days', '[3,1]'::jsonb, 'overdue_repeat', 7, 'inactive_days', 90, 'budget_warn', 80,
    'summary_hour', 20, 'quiet_from', 22, 'quiet_to', 7, 'weekly', true, 'monthly', true);
$$;

create or replace function alert_cfg(tid uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select alert_defaults() || coalesce((select settings from alert_settings where tenant_id = tid), '{}'::jsonb);
$$;

create or replace function alert_applies(tid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (features->>'accounting') = 'true' or (features->>'finance') = 'true' or (features->>'scan') = 'true'
                   from tenant_settings where tenant_id = tid), false);
$$;

create or replace function alert_cashbank(tid uuid, which text) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(jl.debit - jl.credit), 0) from acc_journal_lines jl join acc_accounts a on a.id = jl.account_id
   where jl.tenant_id = tid and case when which = 'cash' then a.is_cash else a.is_bank end;
$$;

create or replace function alert_party_due(tid uuid, pid uuid, cust boolean) returns numeric language sql stable security definer set search_path = public as $$
  select greatest(coalesce(sum(total - paid), 0), 0) from acc_documents
   where tenant_id = tid and party_id = pid and status = 'posted' and doc_type = case when cust then 'invoice' else 'bill' end;
$$;

-- ---------- the one place a notice is made ----------
-- who = one person; otherwise the business's owner / managers / everyone (setting), never the person acting now.
create or replace function alert_emit(tid uuid, p_app text, p_type text, p_sev text, p_cat text, p_title text, p_body text,
                                      p_link text default null, p_action text default null, p_ref text default null, p_who uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare cfg jsonb; actor uuid := app_uid(); n int := 0; got int; u record; hr int; qf int; qt int; quiet boolean := false; dopush boolean;
begin
  if tid is null or not alert_applies(tid) then return 0; end if;
  cfg := alert_cfg(tid);
  if (cfg->'off') ? p_type then return 0; end if;
  -- a business that has only AUZsFinance has no ledger pages to open
  if p_link like '/accounts.html%' and not exists (select 1 from tenant_settings where tenant_id = tid and ((features->>'accounting') = 'true' or (features->>'scan') = 'true')) then
    p_link := '/finance.html#/home';
  end if;
  if (select count(*) from notifications where tenant_id = tid and type = p_type and created_at > now() - interval '10 minutes') >= 12 then return 0; end if;
  hr := extract(hour from (now() at time zone 'Asia/Kolkata'))::int;
  qf := coalesce((cfg->>'quiet_from')::int, 22); qt := coalesce((cfg->>'quiet_to')::int, 7);
  if qf <> qt then quiet := case when qf < qt then hr >= qf and hr < qt else hr >= qf or hr < qt end; end if;
  dopush := coalesce((cfg->>'push')::boolean, true) and p_sev in ('critical', 'warning') and (p_sev = 'critical' or not quiet);
  for u in select p.id from profiles p where p.tenant_id = tid and (
        (p_who is not null and p.id = p_who)
        or (p_who is null and (actor is null or p.id <> actor) and (
              (cfg->>'recipients') = 'all'
              or ((cfg->>'recipients') = 'owner' and p.role = 'owner')
              or ((cfg->>'recipients') not in ('all', 'owner') and p.role in ('owner', 'manager')))))
  loop
    insert into notifications (tenant_id, user_id, type, title, body, link, severity, app, cat, action, ref, push)
    values (tid, u.id, p_type, left(p_title, 160), left(coalesce(p_body, ''), 400), p_link, p_sev, p_app, p_cat, p_action, p_ref, dopush)
    on conflict (user_id, ref) where ref is not null and user_id is not null do nothing;
    get diagnostics got = row_count; n := n + got;
  end loop;
  return n;
exception when others then
  return 0;
end $$;

-- =========================================================
-- Real-time notices
-- =========================================================

-- payments and receipts (deferred to commit so the allocation to bills is already done)
create or replace function alert_payment_trg() returns trigger language plpgsql security definer set search_path = public as $$
declare pa acc_parties; rem numeric; cust boolean := (new.kind = 'receipt'); nm text; cfg jsonb; big numeric; k int; av numeric; l text;
begin
  if new.status <> 'posted' then return null; end if;
  select * into pa from acc_parties where id = new.party_id;
  nm := coalesce(pa.name, 'a customer');
  l := case when new.party_id is not null then '/accounts.html#/party/' || new.party_id else '/accounts.html#/home' end;
  if new.party_id is not null then rem := alert_party_due(new.tenant_id, new.party_id, cust); end if;
  if cust then
    perform alert_emit(new.tenant_id, 'ledger', case when coalesce(rem, 0) > 0 then 'pay_in_part' else 'pay_in' end, 'info', 'payment',
      case when coalesce(rem, 0) > 0 then 'Part payment received' else 'Payment received' end,
      alert_inr(new.amount) || ' received from ' || nm || '.' || case when rem is not null then case when rem > 0 then ' Remaining balance: ' || alert_inr(rem) else ' Nothing is pending now.' end else '' end,
      l, 'View customer', 'pay-' || new.id);
    if pa.id is not null and rem = 0 then
      perform alert_emit(new.tenant_id, 'ledger', 'cust_cleared', 'success', 'receivable', nm || ' has cleared all dues', 'No invoice of ' || nm || ' is pending now.', l, 'View customer', 'clr-' || new.id);
    end if;
  else
    perform alert_emit(new.tenant_id, 'ledger', case when coalesce(rem, 0) > 0 then 'pay_out_part' else 'pay_out' end, 'info', 'payment',
      case when coalesce(rem, 0) > 0 then 'Part payment made' else 'Payment sent' end,
      alert_inr(new.amount) || ' paid to ' || nm || '.' || case when rem is not null then case when rem > 0 then ' Still to pay: ' || alert_inr(rem) else ' Nothing is pending now.' end else '' end,
      l, 'View supplier', 'pay-' || new.id);
    if pa.id is not null and rem = 0 then
      perform alert_emit(new.tenant_id, 'ledger', 'sup_cleared', 'success', 'payable', nm || ' is fully paid', 'No bill of ' || nm || ' is pending now.', l, 'View supplier', 'clr-' || new.id);
    end if;
  end if;
  cfg := alert_cfg(new.tenant_id);
  big := coalesce((cfg->>(case when cust then 'large_in' else 'large_out' end))::numeric, 0);
  if big > 0 and new.amount >= big then
    perform alert_emit(new.tenant_id, 'ledger', case when cust then 'large_in' else 'large_out' end, 'warning', 'cash',
      case when cust then 'Large payment received' else 'Large payment made' end, alert_inr(new.amount) || case when cust then ' from ' else ' to ' end || nm || '.', l, 'Open', 'big-' || new.id);
  end if;
  select count(*), avg(amount) into k, av from acc_payments
   where tenant_id = new.tenant_id and kind = new.kind and status = 'posted' and id <> new.id and pay_date > current_date - 180;
  if k >= 8 and new.amount >= 5000 and new.amount > av * 5 then
    perform alert_emit(new.tenant_id, 'ledger', 'unusual', 'warning', 'cash', 'Unusual transaction',
      alert_inr(new.amount) || ' with ' || nm || ' is much more than your usual ' || alert_inr(av) || '.', l, 'Check it', 'unu-' || new.id);
  end if;
  if exists (select 1 from acc_payments where tenant_id = new.tenant_id and kind = new.kind and party_id is not distinct from new.party_id
              and amount = new.amount and pay_date = new.pay_date and status = 'posted' and id <> new.id) then
    perform alert_emit(new.tenant_id, 'ledger', 'dup', 'warning', 'recon', 'Possible duplicate payment',
      alert_inr(new.amount) || ' with ' || nm || ' on the same day was entered twice.', l, 'Check it', 'dup-' || new.id);
  end if;
  return null;
exception when others then
  return null;
end $$;
drop trigger if exists alert_payment on acc_payments;
create constraint trigger alert_payment after insert on acc_payments deferrable initially deferred for each row execute function alert_payment_trg();

create or replace function alert_payment_change_trg() returns trigger language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  select name into nm from acc_parties where id = new.party_id;
  if new.status = 'cancelled' and old.status = 'posted' then
    perform alert_emit(new.tenant_id, 'ledger', 'txn_deleted', 'warning', 'activity', 'Payment cancelled',
      alert_inr(new.amount) || ' ' || case when new.kind = 'receipt' then 'receipt' else 'payment' end || ' ' || new.number || ' (' || coalesce(nm, 'no party') || ') was cancelled.',
      '/accounts.html#/receipts', 'Open', 'pcx-' || new.id);
  elsif new.status = 'posted' and (new.mode is distinct from old.mode or new.reference is distinct from old.reference or new.notes is distinct from old.notes) then
    perform alert_emit(new.tenant_id, 'ledger', 'txn_edited', 'info', 'activity', 'Payment details changed',
      new.number || ' (' || coalesce(nm, 'no party') || ', ' || alert_inr(new.amount) || '): method, UTR or note was edited.', '/accounts.html#/receipts', 'Open',
      'ped-' || new.id || '-' || to_char(now(), 'YYYYMMDDHH24MISS'));
  end if;
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists alert_payment_change on acc_payments;
create trigger alert_payment_change after update of status, mode, reference, notes on acc_payments for each row execute function alert_payment_change_trg();

-- bills, invoices, expenses, notes (deferred: payments applied at the same time are counted)
create or replace function alert_document_trg() returns trigger language plpgsql security definer set search_path = public as $$
declare pa acc_parties; rem numeric; cust boolean; lbl text; l text; pct numeric; lvl text;
begin
  if new.is_opening or new.doc_type not in ('invoice','bill','expense','credit_note','debit_note') then return null; end if;
  select * into pa from acc_parties where id = new.party_id;
  lbl := case new.doc_type when 'invoice' then 'Invoice' when 'bill' then 'Purchase bill' when 'expense' then 'Expense' when 'credit_note' then 'Credit note' else 'Debit note' end;
  l := '/accounts.html#/' || case new.doc_type when 'invoice' then 'sales' when 'bill' then 'purchases' else 'sales' end;
  if new.status = 'cancelled' then
    if tg_op = 'UPDATE' and old.status = 'posted' then
      perform alert_emit(new.tenant_id, 'ledger', 'txn_deleted', 'warning', 'activity', lbl || ' cancelled',
        lbl || ' ' || new.number || ' (' || alert_inr(new.total) || coalesce(', ' || pa.name, '') || ') was cancelled.', l, 'Open', 'dcx-' || new.id);
    end if;
    return null;
  end if;
  if new.status <> 'posted' or (tg_op = 'UPDATE' and old.status = 'posted') then return null; end if;
  cust := new.doc_type in ('invoice', 'debit_note');
  if pa.id is not null and new.doc_type in ('invoice', 'bill') then rem := alert_party_due(new.tenant_id, pa.id, new.doc_type = 'invoice'); end if;
  perform alert_emit(new.tenant_id, 'ledger', 'txn_new', 'info', 'activity', lbl || ' recorded',
    lbl || ' ' || new.number || ' for ' || alert_inr(new.total) || coalesce(' with ' || pa.name, '') || '.' ||
      case when rem is not null then (case when new.doc_type = 'invoice' then ' Customer balance: ' else ' Supplier balance: ' end) || alert_inr(rem) else '' end,
    l, 'Open', 'doc-' || new.id);
  if pa.id is not null and pa.credit_limit > 0 and rem is not null then
    pct := rem * 100 / pa.credit_limit;
    if pct >= 100 then lvl := 'exceeded'; elsif pct >= 80 then lvl := 'reached'; end if;
    if lvl is not null then
      perform alert_emit(new.tenant_id, 'ledger', case when new.doc_type = 'invoice' then 'cust_credit' else 'sup_credit' end,
        case when lvl = 'exceeded' then 'critical' else 'warning' end, case when new.doc_type = 'invoice' then 'receivable' else 'payable' end,
        pa.name || case when lvl = 'exceeded' then ' is over the credit limit' else ' is close to the credit limit' end,
        'Outstanding ' || alert_inr(rem) || ' against a limit of ' || alert_inr(pa.credit_limit) || '.',
        '/accounts.html#/party/' || pa.id, 'View ' || case when new.doc_type = 'invoice' then 'customer' else 'supplier' end,
        'lim-' || pa.id || '-' || lvl || '-' || to_char(current_date, 'YYYYMMDD'));
    end if;
  end if;
  return null;
exception when others then
  return null;
end $$;
drop trigger if exists alert_document on acc_documents;
create constraint trigger alert_document after insert or update of status on acc_documents deferrable initially deferred for each row execute function alert_document_trg();

-- new customers / suppliers / money accounts
create or replace function alert_party_new_trg() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_walkin then return new; end if;
  perform alert_emit(new.tenant_id, 'ledger', 'party_new', 'info', 'activity',
    'New ' || case when new.kind = 'supplier' then 'supplier' else 'customer' end || ' added', new.name, '/accounts.html#/party/' || new.id, 'Open', 'party-' || new.id);
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists alert_party_new on acc_parties;
create trigger alert_party_new after insert on acc_parties for each row execute function alert_party_new_trg();

create or replace function alert_account_new_trg() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_cash or new.is_bank then
    perform alert_emit(new.tenant_id, 'ledger', 'acct_new', 'info', 'activity', 'New ' || case when new.is_bank then 'bank' else 'cash' end || ' account', new.name, null, null, 'acct-' || new.id);
  end if;
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists alert_account_new on acc_accounts;
create trigger alert_account_new after insert on acc_accounts for each row execute function alert_account_new_trg();

-- expense approval (AUZsLedger)
create or replace function alert_expreq_trg() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform alert_emit(new.tenant_id, 'ledger', 'approval_needed', 'warning', 'activity', 'Expense approval needed',
      alert_inr(new.amount) || ' requested: ' || new.description, '/accounts.html#/expreq', 'Review', 'er-' || new.id);
  elsif new.status is distinct from old.status then
    if new.status = 'approved' then
      perform alert_emit(new.tenant_id, 'ledger', 'approved', 'success', 'activity', 'Your expense request was approved', alert_inr(new.amount) || ': ' || new.description, '/accounts.html#/expreq', 'Open', 'era-' || new.id, new.requested_by);
    elsif new.status = 'rejected' then
      perform alert_emit(new.tenant_id, 'ledger', 'rejected', 'info', 'activity', 'Your expense request was rejected', alert_inr(new.amount) || ': ' || new.description || coalesce('. ' || new.decision_note, ''), '/accounts.html#/expreq', 'Open', 'err-' || new.id, new.requested_by);
    elsif new.status = 'paid' then
      perform alert_emit(new.tenant_id, 'ledger', 'approved', 'success', 'activity', 'Your expense was paid', alert_inr(new.amount) || ': ' || new.description, '/accounts.html#/expreq', 'Open', 'erp-' || new.id, new.requested_by);
    end if;
  end if;
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists alert_expreq on acc_expense_requests;
create trigger alert_expreq after insert or update of status on acc_expense_requests for each row execute function alert_expreq_trg();

create or replace function alert_recon_trg() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.difference = 0 then
    perform alert_emit(new.tenant_id, 'ledger', 'recon_done', 'success', 'recon', 'Bank reconciliation completed',
      'Statement of ' || to_char(new.statement_date, 'DD Mon YYYY') || ' matches your books.', '/accounts.html#/banking', 'Open', 'rc-' || new.id);
  end if;
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists alert_recon on acc_recons;
create trigger alert_recon after insert on acc_recons for each row execute function alert_recon_trg();

create or replace function alert_gstperiod_trg() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform alert_emit(new.tenant_id, 'ledger', 'gst_filed', 'success', 'gst', 'GST period marked as filed', 'Return period ' || new.period || ' is locked.', '/accounts.html#/gst', 'Open', 'gf-' || new.tenant_id || new.period);
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists alert_gstperiod on acc_gst_periods;
create trigger alert_gstperiod after insert on acc_gst_periods for each row execute function alert_gstperiod_trg();

-- staff and security (only for businesses that use the books apps)
create or replace function alert_profile_trg() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.tenant_id is null then return new; end if;
  if tg_op = 'INSERT' and new.role <> 'owner' then
    perform alert_emit(new.tenant_id, 'ledger', 'staff_added', 'info', 'security', 'New staff member added', coalesce(new.email, 'A staff login') || ' (' || new.role || ')', null, null, 'sa-' || new.id);
  elsif tg_op = 'UPDATE' and new.role is distinct from old.role then
    perform alert_emit(new.tenant_id, 'ledger', 'perm_changed', 'warning', 'security', 'Staff role changed', coalesce(new.email, 'A staff login') || ' is now ' || new.role || '.', null, null, 'sr-' || new.id || '-' || new.role || to_char(now(), 'YYYYMMDDHH24MISS'));
  end if;
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists alert_profile on profiles;
create trigger alert_profile after insert or update of role on profiles for each row execute function alert_profile_trg();

create or replace function alert_login_trg() returns trigger language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  if new.device_label is null then return new; end if;
  select tenant_id into tid from profiles where id = new.user_id;
  if tid is null then return new; end if;
  if exists (select 1 from auth_sessions where user_id = new.user_id and jti <> new.jti)
     and not exists (select 1 from auth_sessions where user_id = new.user_id and jti <> new.jti and device_label = new.device_label) then
    perform alert_emit(tid, 'ledger', 'new_login', 'warning', 'security', 'New sign-in on your account', 'Signed in from ' || new.device_label || '. If this was not you, change your password.', null, null, 'nl-' || new.jti, new.user_id);
  end if;
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists alert_login on auth_sessions;
create trigger alert_login after insert on auth_sessions for each row execute function alert_login_trg();

create or replace function alert_password_trg() returns trigger language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  if new.password_hash is distinct from old.password_hash and old.password_hash is not null then
    select tenant_id into tid from profiles where id = new.id;
    if tid is not null then
      perform alert_emit(tid, 'ledger', 'password_changed', 'critical', 'security', 'Your password was changed', 'If you did not do this, contact AUZslab at once.', null, null, 'pw-' || new.id || '-' || to_char(now(), 'YYYYMMDDHH24MISS'), new.id);
    end if;
  end if;
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists alert_password on auth_users;
create trigger alert_password after update of password_hash on auth_users for each row execute function alert_password_trg();

-- AUZsFinance entries
create or replace function alert_fintxn_trg() returns trigger language plpgsql security definer set search_path = public as $$
declare lbl text; incoming boolean; cfg jsonb; big numeric;
begin
  if tg_op = 'INSERT' then
    if new.reversal_of is not null then return new; end if;
    lbl := case new.kind when 'money_in' then 'Money in' when 'expense' then 'Money out' when 'capital_in' then 'Capital added' when 'drawing' then 'Owner withdrawal'
      when 'loan_taken' then 'Loan taken' when 'loan_given' then 'Loan given' when 'loan_repay' then 'Loan repayment' when 'loan_collect' then 'Loan collected'
      when 'transfer' then 'Transfer between accounts' when 'credit_sale' then 'Credit sale' when 'credit_purchase' then 'Credit purchase' when 'dues_in' then 'Money received (dues)'
      when 'dues_out' then 'Money paid (dues)' when 'asset_buy' then 'Asset bought' else 'Entry' end;
    perform alert_emit(new.tenant_id, 'finance', 'fin_entry', 'info', 'activity', lbl || ': ' || alert_inr(new.amount),
      coalesce(new.purpose, new.note, lbl) || ' on ' || to_char(new.txn_date, 'DD Mon'), '/finance.html#/activity?open=' || new.id, 'Open', 'ft-' || new.id);
    incoming := new.kind in ('money_in', 'capital_in', 'loan_taken', 'loan_collect', 'dues_in');
    cfg := alert_cfg(new.tenant_id);
    big := coalesce((cfg->>(case when incoming then 'large_in' else 'large_out' end))::numeric, 0);
    if big > 0 and new.amount >= big and new.kind not in ('transfer', 'credit_sale', 'credit_purchase') then
      perform alert_emit(new.tenant_id, 'finance', case when incoming then 'large_in' else 'large_out' end, 'warning', 'cash',
        case when incoming then 'Large payment received' else 'Large payment made' end, lbl || ': ' || alert_inr(new.amount), '/finance.html#/activity?open=' || new.id, 'Open', 'fbig-' || new.id);
    end if;
    if new.review = 'needs_review' then
      perform alert_emit(new.tenant_id, 'finance', 'approval_needed', 'warning', 'activity', 'Entry needs your approval', lbl || ' of ' || alert_inr(new.amount) || coalesce(' - ' || new.purpose, ''), '/finance.html#/approvals', 'Review', 'fa-' || new.id);
    end if;
  else
    if old.review = 'needs_review' and new.review = 'confirmed' and new.created_by is not null then
      perform alert_emit(new.tenant_id, 'finance', 'approved', 'success', 'activity', 'Your entry was approved', alert_inr(new.amount) || coalesce(' - ' || new.purpose, ''), '/finance.html#/activity?open=' || new.id, 'Open', 'fap-' || new.id, new.created_by);
    elsif old.status = 'posted' and new.status = 'reversed' then
      if old.review = 'needs_review' and new.created_by is not null then
        perform alert_emit(new.tenant_id, 'finance', 'rejected', 'info', 'activity', 'Your entry was rejected', alert_inr(new.amount) || coalesce(' - ' || new.purpose, ''), '/finance.html#/activity?open=' || new.id, 'Open', 'frj-' || new.id, new.created_by);
      else
        perform alert_emit(new.tenant_id, 'finance', 'txn_deleted', 'warning', 'activity', 'An entry was reversed', alert_inr(new.amount) || coalesce(' - ' || new.purpose, '') || coalesce('. ' || new.reversed_reason, ''), '/finance.html#/activity?open=' || new.id, 'Open', 'frv-' || new.id);
      end if;
    end if;
  end if;
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists alert_fintxn on fin_txns;
create trigger alert_fintxn after insert or update of review, status on fin_txns for each row execute function alert_fintxn_trg();

-- =========================================================
-- Scheduled notices (called by the server every hour; every step is safe to run again, notices carry a ref)
-- =========================================================
create or replace function alerts_run_tenant(tid uuid, p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  cfg jsonb := alert_cfg(tid); now_ist timestamp := p_now at time zone 'Asia/Kolkata'; today date := now_ist::date; hr int := extract(hour from now_ist)::int;
  errs jsonb := '[]'::jsonb; r record; n numeric; m numeric; soon date[]; rep int := greatest(coalesce((cfg->>'overdue_repeat')::int, 7), 1);
  wk text := to_char(today, 'IYYY-IW'); mon text := to_char(today, 'YYYY-MM'); org acc_org; low numeric;
  d1 date; d2 date; per text; dd date; fy acc_fy; sh int := coalesce((cfg->>'summary_hour')::int, 20); a numeric; b numeric; c numeric; e numeric;
begin
  select * into org from acc_org where tenant_id = tid;
  select array_agg(today + (x)::int) into soon from jsonb_array_elements_text(cfg->'remind_days') x;
  soon := coalesce(soon, array[]::date[]);

  -- 1) money to collect and money to pay: due soon, due today, overdue
  begin
    for r in
      select d.party_id, pa.name, d.doc_type,
             sum(d.total - d.paid) filter (where d.due_date < today) od_amt, count(*) filter (where d.due_date < today) od_n, min(d.due_date) filter (where d.due_date < today) od_first,
             sum(d.total - d.paid) filter (where d.due_date = today) td_amt, count(*) filter (where d.due_date = today) td_n,
             sum(d.total - d.paid) filter (where d.due_date = any(soon)) sn_amt, min(d.due_date) filter (where d.due_date = any(soon)) sn_date
        from acc_documents d join acc_parties pa on pa.id = d.party_id
       where d.tenant_id = tid and d.status = 'posted' and d.doc_type in ('invoice', 'bill') and d.total - d.paid > 0.5 and d.due_date is not null and d.due_date <= today + 30
       group by d.party_id, pa.name, d.doc_type order by sum(d.total - d.paid) desc limit 120
    loop
      if r.od_amt is not null then
        perform alert_emit(tid, 'ledger', case when r.doc_type = 'invoice' then 'cust_overdue' else 'sup_overdue' end, 'critical', case when r.doc_type = 'invoice' then 'receivable' else 'payable' end,
          case when r.doc_type = 'invoice' then 'Payment overdue' else 'Supplier payment overdue' end,
          r.name || case when r.doc_type = 'invoice' then ' has an outstanding balance of ' else ': you owe ' end || alert_inr(r.od_amt) || ' (' || r.od_n || case when r.od_n = 1 then ' bill' else ' bills' end || ', oldest due ' || to_char(r.od_first, 'DD Mon YYYY') || ').',
          '/accounts.html#/party/' || r.party_id, case when r.doc_type = 'invoice' then 'Collect payment' else 'Record payment' end,
          'od-' || r.party_id || '-' || r.doc_type || '-' || floor((today - date '2020-01-01') / rep));
      end if;
      if r.td_amt is not null then
        perform alert_emit(tid, 'ledger', case when r.doc_type = 'invoice' then 'cust_due_today' else 'sup_due_today' end, 'warning', case when r.doc_type = 'invoice' then 'receivable' else 'payable' end,
          'Payment due today', r.name || ': ' || alert_inr(r.td_amt) || case when r.doc_type = 'invoice' then ' is due from the customer today.' else ' is due to the supplier today.' end,
          '/accounts.html#/party/' || r.party_id, case when r.doc_type = 'invoice' then 'Collect payment' else 'Record payment' end,
          'dt-' || r.party_id || '-' || r.doc_type || '-' || today);
      end if;
      if r.sn_amt is not null and r.sn_date > today then
        perform alert_emit(tid, 'ledger', case when r.doc_type = 'invoice' then 'cust_due_soon' else 'sup_due_soon' end, 'info', case when r.doc_type = 'invoice' then 'receivable' else 'payable' end,
          case when r.doc_type = 'invoice' then 'Payment reminder' else 'Supplier payment due soon' end,
          r.name || ': ' || alert_inr(r.sn_amt) || ' is due on ' || to_char(r.sn_date, 'DD Mon') || ' (in ' || (r.sn_date - today) || case when r.sn_date - today = 1 then ' day).' else ' days).' end,
          '/accounts.html#/party/' || r.party_id, case when r.doc_type = 'invoice' then 'Send reminder' else 'Plan payment' end,
          'ds-' || r.party_id || '-' || r.doc_type || '-' || r.sn_date);
      end if;
    end loop;
  exception when others then errs := errs || to_jsonb('dues: ' || sqlerrm); end;

  -- 2) promised payment dates (follow-ups)
  begin
    for r in select f.id, f.note, f.due_on, f.assigned_to, f.party_id, pa.name from acc_followups f join acc_parties pa on pa.id = f.party_id
              where f.tenant_id = tid and f.status = 'open' and f.due_on is not null and f.due_on <= today + 1 limit 100
    loop
      if r.due_on >= today then
        perform alert_emit(tid, 'ledger', 'commit_due', 'warning', 'receivable', case when r.due_on = today then 'Follow-up due today' else 'Follow-up due tomorrow' end, r.name || ': ' || r.note,
          '/accounts.html#/followups', 'Open', 'fu-' || r.id || '-' || r.due_on, r.assigned_to);
      else
        perform alert_emit(tid, 'ledger', 'commit_missed', 'critical', 'receivable', 'Promised date missed', r.name || ': ' || r.note || ' (was due ' || to_char(r.due_on, 'DD Mon') || ').',
          '/accounts.html#/party/' || r.party_id, 'Follow up', 'fum-' || r.id || '-' || floor((today - date '2020-01-01') / rep), r.assigned_to);
      end if;
    end loop;
  exception when others then errs := errs || to_jsonb('followups: ' || sqlerrm); end;

  -- 3) customers who stopped buying (once a week)
  begin
    select count(*), string_agg(name, ', ' order by name) into a, per from (
      select pa.name from acc_parties pa where pa.tenant_id = tid and pa.active and not pa.is_walkin and pa.kind <> 'supplier'
         and exists (select 1 from acc_documents d where d.party_id = pa.id and d.doc_type = 'invoice' and d.status = 'posted')
         and not exists (select 1 from acc_documents d where d.party_id = pa.id and d.doc_type = 'invoice' and d.status = 'posted' and d.doc_date > today - coalesce((cfg->>'inactive_days')::int, 90))
       order by pa.name limit 3) x;
    select count(*) into b from acc_parties pa where pa.tenant_id = tid and pa.active and not pa.is_walkin and pa.kind <> 'supplier'
         and exists (select 1 from acc_documents d where d.party_id = pa.id and d.doc_type = 'invoice' and d.status = 'posted')
         and not exists (select 1 from acc_documents d where d.party_id = pa.id and d.doc_type = 'invoice' and d.status = 'posted' and d.doc_date > today - coalesce((cfg->>'inactive_days')::int, 90));
    if b > 0 and extract(isodow from today) = 1 then
      perform alert_emit(tid, 'ledger', 'cust_inactive', 'info', 'receivable', b || ' customers have not bought for ' || coalesce((cfg->>'inactive_days')::int, 90) || ' days', per || case when b > 3 then ' and others.' else '.' end,
        '/accounts.html#/analytics/all', 'See customers', 'ina-' || wk);
    end if;
  exception when others then errs := errs || to_jsonb('inactive: ' || sqlerrm); end;

  -- 4) cash and bank balances, cash flow
  begin
    low := coalesce((cfg->>'low_cash')::numeric, 0);
    if low > 0 then
      n := alert_cashbank(tid, 'cash');
      if n < low then
        perform alert_emit(tid, 'ledger', 'low_cash', 'warning', 'cash', 'Low cash balance', 'Your cash balance has fallen below ' || alert_inr(low) || '. Current balance: ' || alert_inr(n), '/accounts.html#/home', 'View cash', 'lc-' || today);
      end if;
    end if;
    low := coalesce((cfg->>'low_bank')::numeric, 0);
    if low > 0 then
      for r in select a2.id, a2.name, coalesce(sum(jl.debit - jl.credit), 0) bal from acc_accounts a2 left join acc_journal_lines jl on jl.account_id = a2.id
                where a2.tenant_id = tid and a2.is_bank and a2.active group by a2.id, a2.name having coalesce(sum(jl.debit - jl.credit), 0) < low
      loop
        perform alert_emit(tid, 'ledger', 'low_bank', 'warning', 'cash', 'Low bank balance', r.name || ' is below ' || alert_inr(low) || '. Current balance: ' || alert_inr(r.bal), '/accounts.html#/banking', 'View bank', 'lb-' || r.id || '-' || today);
      end loop;
    end if;
    select coalesce(sum(jl.debit), 0), coalesce(sum(jl.credit), 0) into a, b from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id join acc_accounts ac on ac.id = jl.account_id
     where jl.tenant_id = tid and (ac.is_cash or ac.is_bank) and j.jdate > today - 7 and j.jdate <= today and j.voucher_type not in ('opening', 'contra')
       and not exists (select 1 from acc_journal_lines x join acc_accounts xa on xa.id = x.account_id where x.journal_id = j.id and x.id <> jl.id and (xa.is_cash or xa.is_bank));
    if b >= 1000 and b > a and extract(isodow from today) in (1, 4) then
      perform alert_emit(tid, 'ledger', 'neg_cf', 'warning', 'cash', 'More money went out than came in', 'In the last 7 days ' || alert_inr(b) || ' went out and ' || alert_inr(a) || ' came in.', '/accounts.html#/analytics', 'See cash flow', 'ncf-' || wk || '-' || extract(isodow from today));
    end if;
  exception when others then errs := errs || to_jsonb('cash: ' || sqlerrm); end;

  -- 5) budgets (this month, by expense account)
  begin
    select * into fy from acc_fy where tenant_id = tid and today between start_date and end_date limit 1;
    if fy.id is not null then
      for r in select ac.id, ac.name, b2.amount bud,
                      coalesce((select sum(jl.debit - jl.credit) from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id
                                 where jl.account_id = ac.id and j.jdate >= date_trunc('month', today)::date and j.jdate <= today), 0) spent
                 from acc_budgets b2 join acc_accounts ac on ac.id = b2.account_id
                where b2.tenant_id = tid and b2.fy_id = fy.id and b2.month = extract(month from today)::int and ac.type = 'expense' and b2.amount > 0
      loop
        if r.spent >= r.bud then
          perform alert_emit(tid, 'ledger', 'budget_over', 'critical', 'expense', 'Expense budget exceeded', r.name || ': ' || alert_inr(r.spent) || ' spent against a budget of ' || alert_inr(r.bud) || ' this month.', '/accounts.html#/reports', 'View expenses', 'bo-' || r.id || '-' || mon);
        elsif r.spent * 100 >= r.bud * coalesce((cfg->>'budget_warn')::numeric, 80) then
          perform alert_emit(tid, 'ledger', 'budget_warn', 'warning', 'expense', 'Expense budget warning', r.name || ': ' || round(r.spent * 100 / r.bud) || '% of the ' || alert_inr(r.bud) || ' budget is used.', '/accounts.html#/reports', 'View expenses', 'bw-' || r.id || '-' || mon);
        end if;
      end loop;
    end if;
    for r in select ac.id, ac.name, fb.monthly bud,
                    coalesce((select sum(jl.debit - jl.credit) from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id
                               where jl.account_id = ac.id and j.jdate >= date_trunc('month', today)::date and j.jdate <= today), 0) spent
               from fin_budgets fb join acc_accounts ac on ac.id = fb.category_id where fb.tenant_id = tid and fb.monthly > 0
    loop
      if r.spent >= r.bud then
        perform alert_emit(tid, 'finance', 'budget_over', 'critical', 'expense', 'Expense budget exceeded', r.name || ': ' || alert_inr(r.spent) || ' spent against ' || alert_inr(r.bud) || ' this month.', '/finance.html#/budget', 'View budget', 'fbo-' || r.id || '-' || mon);
      elsif r.spent * 100 >= r.bud * coalesce((cfg->>'budget_warn')::numeric, 80) then
        perform alert_emit(tid, 'finance', 'budget_warn', 'warning', 'expense', 'Expense budget warning', r.name || ': ' || round(r.spent * 100 / r.bud) || '% of ' || alert_inr(r.bud) || ' is used.', '/finance.html#/budget', 'View budget', 'fbw-' || r.id || '-' || mon);
      end if;
    end loop;
  exception when others then errs := errs || to_jsonb('budget: ' || sqlerrm); end;

  -- 6) repeating entries (upcoming / not made)
  begin
    for r in select id, name, next_date, kind from acc_recurring where tenant_id = tid and active and (end_date is null or end_date >= today) and next_date <= today + 3 limit 50 loop
      if r.next_date >= today then
        perform alert_emit(tid, 'ledger', 'rec_upcoming', 'info', 'expense', 'Repeating ' || r.kind || ' coming up', r.name || ' is due on ' || to_char(r.next_date, 'DD Mon') || '.', '/accounts.html#/home', 'Open', 'ru-' || r.id || '-' || r.next_date);
      else
        perform alert_emit(tid, 'ledger', 'rec_missed', 'warning', 'expense', 'Repeating ' || r.kind || ' not recorded', r.name || ' was due on ' || to_char(r.next_date, 'DD Mon') || ' and has not been created.', '/accounts.html#/home', 'Open', 'rm-' || r.id || '-' || r.next_date);
      end if;
    end loop;
    for r in select id, kind, amount, next_date, payload from fin_recurring where tenant_id = tid and active and (end_date is null or end_date >= today) and next_date <= today + 3 limit 50 loop
      if r.next_date >= today then
        perform alert_emit(tid, 'finance', 'rec_upcoming', 'info', 'expense', 'Repeating entry coming up', coalesce(r.payload->>'purpose', r.kind) || ' of ' || alert_inr(r.amount) || ' on ' || to_char(r.next_date, 'DD Mon') || '.', '/finance.html#/repeat', 'Open', 'fru-' || r.id || '-' || r.next_date);
      else
        perform alert_emit(tid, 'finance', 'rec_missed', 'warning', 'expense', 'Repeating entry not recorded', coalesce(r.payload->>'purpose', r.kind) || ' of ' || alert_inr(r.amount) || ' was due on ' || to_char(r.next_date, 'DD Mon') || '.', '/finance.html#/repeat', 'Open', 'frm-' || r.id || '-' || r.next_date);
      end if;
    end loop;
  exception when others then errs := errs || to_jsonb('recurring: ' || sqlerrm); end;

  -- 7) bank lines nobody matched, entries still waiting for a bill (weekly)
  begin
    select count(*) into a from acc_bank_txns where tenant_id = tid and status = 'unmatched' and txn_date < today - 7;
    if a > 0 and extract(isodow from today) = 2 then
      perform alert_emit(tid, 'ledger', 'recon_due', 'warning', 'recon', a::int || ' bank lines are not matched', 'Imported bank lines older than a week have no matching entry in your books.', '/accounts.html#/banking', 'Reconcile now', 'ru-' || wk);
    end if;
    select count(*) into b from fin_txns where tenant_id = tid and status = 'posted' and evidence = 'none' and kind in ('expense', 'asset_buy', 'drawing') and amount >= 5000 and txn_date < today - 3 and txn_date > today - 90;
    if b > 0 and extract(isodow from today) = 3 then
      perform alert_emit(tid, 'finance', 'missing_proof', 'warning', 'recon', b::int || ' large payments have no bill or proof', 'Add the bill to keep your records clean.', '/finance.html#/insights', 'Review', 'mp-' || wk);
    end if;
  exception when others then errs := errs || to_jsonb('recon: ' || sqlerrm); end;

  -- 8) Finance: loans and money owed to you for a long time
  begin
    for r in select id, counterparty, direction, due_date from fin_loans where tenant_id = tid and status = 'open' and due_date is not null and due_date <= today + 7 limit 50 loop
      perform alert_emit(tid, 'finance', case when r.due_date < today then 'loan_overdue' else 'loan_due' end, case when r.due_date < today then 'critical' else 'warning' end, 'payable',
        case when r.due_date < today then 'Loan past its date' else 'Loan due soon' end, r.counterparty || ' (' || case when r.direction = 'taken' then 'you owe' else 'owed to you' end || ') is due ' || to_char(r.due_date, 'DD Mon YYYY') || '.',
        '/finance.html#/owner', 'Open loans', 'ln-' || r.id || '-' || case when r.due_date < today then floor((today - date '2020-01-01') / rep)::text else r.due_date::text end);
    end loop;
  exception when others then errs := errs || to_jsonb('loans: ' || sqlerrm); end;

  -- 9) GST dates (only for businesses registered for GST)
  begin
    if org.tenant_id is not null and org.reg_type = 'regular' and coalesce(org.gstin, '') <> '' then
      per := to_char(today - interval '1 month', 'YYYY-MM');
      if not exists (select 1 from acc_gst_periods where tenant_id = tid and period = per) then
        d1 := date_trunc('month', today)::date + 10;   -- GSTR-1: 11th
        d2 := date_trunc('month', today)::date + 19;   -- GSTR-3B: 20th
        for r in select 'GSTR-1' ret, d1 due union all select 'GSTR-3B', d2 loop
          if today > r.due then
            perform alert_emit(tid, 'ledger', 'gst_overdue', 'critical', 'gst', r.ret || ' for ' || to_char(today - interval '1 month', 'Mon YYYY') || ' is overdue', 'The last date was ' || to_char(r.due, 'DD Mon') || '. File it now or mark the period as filed.', '/accounts.html#/gst', 'Open GST', 'go-' || r.ret || per || '-' || wk);
          elsif r.due - today <= 3 then
            perform alert_emit(tid, 'ledger', case when r.ret = 'GSTR-3B' then 'gst_pay_due' else 'gst_due' end, 'warning', 'gst', r.ret || ' due ' || case when r.due = today then 'today' else 'in ' || (r.due - today) || ' days' end,
              'Return for ' || to_char(today - interval '1 month', 'Mon YYYY') || ' is due on ' || to_char(r.due, 'DD Mon') || '.' || case when r.ret = 'GSTR-3B' then ' Any tax to pay is due the same day.' else '' end, '/accounts.html#/gst', 'Open GST', 'gd-' || r.ret || per || '-' || today);
          end if;
        end loop;
      end if;
      if extract(day from today) between 1 and 2 then
        perform alert_emit(tid, 'ledger', 'tax_summary', 'info', 'gst', 'GST summary for ' || to_char(today - interval '1 month', 'Mon YYYY') || ' is ready', 'See your sales tax, input credit and what is payable.', '/accounts.html#/analytics/gstr3b', 'View summary', 'ts-' || mon);
      end if;
      if today >= (date_trunc('month', today) + interval '1 month - 3 days')::date then
        perform alert_emit(tid, 'ledger', 'tax_closing', 'info', 'gst', 'This GST month is closing', 'Record all sales and purchase bills before month end so the return is complete.', '/accounts.html#/gst', 'Open GST', 'tc-' || mon);
      end if;
    elsif org.tenant_id is not null and org.reg_type = 'composition' and extract(month from today) in (1, 4, 7, 10) and extract(day from today) between 15 and 18 then
      perform alert_emit(tid, 'ledger', 'gst_due', 'warning', 'gst', 'CMP-08 payment due on 18th', 'Quarterly tax payment for composition dealers is due on the 18th.', '/accounts.html#/gst', 'Open GST', 'cmp-' || mon || '-' || today);
    end if;
  exception when others then errs := errs || to_jsonb('gst: ' || sqlerrm); end;

  -- 10) summaries (after the chosen hour, once a day / week / month)
  begin
    if hr >= sh then
      select coalesce(sum(jl.debit), 0), coalesce(sum(jl.credit), 0) into a, b from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id join acc_accounts ac on ac.id = jl.account_id
       where jl.tenant_id = tid and (ac.is_cash or ac.is_bank) and j.jdate = today and j.voucher_type not in ('opening', 'contra')
         and not exists (select 1 from acc_journal_lines x join acc_accounts xa on xa.id = x.account_id where x.journal_id = j.id and x.id <> jl.id and (xa.is_cash or xa.is_bank));
      c := alert_cashbank(tid, 'cash') + alert_cashbank(tid, 'bank');
      select coalesce(sum(total), 0), count(*) into e, n from acc_documents where tenant_id = tid and doc_type = 'invoice' and status = 'posted' and doc_date = today;
      if a > 0 or b > 0 or n > 0 then
        perform alert_emit(tid, 'ledger', 'daily_summary', 'info', 'activity', 'Today at a glance',
          'Sales ' || alert_inr(e) || ' (' || n::int || ' invoices). Money in ' || alert_inr(a) || ', money out ' || alert_inr(b) || '. Cash and bank now ' || alert_inr(c) || '.', '/accounts.html#/analytics', 'Open reports', 'day-' || today);
      end if;
      if extract(isodow from today) = 1 and coalesce((cfg->>'weekly')::boolean, true) then
        select coalesce(sum(jl.credit - jl.debit), 0) into a from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id join acc_accounts ac on ac.id = jl.account_id where jl.tenant_id = tid and ac.type = 'income' and j.jdate > today - 7 and j.jdate <= today;
        select coalesce(sum(jl.debit - jl.credit), 0) into b from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id join acc_accounts ac on ac.id = jl.account_id where jl.tenant_id = tid and ac.type = 'expense' and j.jdate > today - 7 and j.jdate <= today;
        select coalesce(sum(amount), 0) into c from acc_payments where tenant_id = tid and kind = 'receipt' and status = 'posted' and pay_date > today - 7;
        select coalesce(sum(total - paid), 0) into e from acc_documents where tenant_id = tid and doc_type = 'invoice' and status = 'posted' and total - paid > 0;
        if a > 0 or b > 0 or c > 0 then
          perform alert_emit(tid, 'ledger', 'weekly_summary', 'info', 'activity', 'Your week in numbers', 'Income ' || alert_inr(a) || ', expenses ' || alert_inr(b) || ', collected ' || alert_inr(c) || '. Customers still owe ' || alert_inr(e) || '.', '/accounts.html#/analytics', 'Open reports', 'wk-' || wk);
        end if;
      end if;
      if extract(day from today) = 1 and coalesce((cfg->>'monthly')::boolean, true) then
        d1 := (date_trunc('month', today) - interval '1 month')::date; d2 := (date_trunc('month', today) - interval '1 day')::date;
        select coalesce(sum(jl.credit - jl.debit), 0) into a from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id join acc_accounts ac on ac.id = jl.account_id where jl.tenant_id = tid and ac.type = 'income' and j.jdate between d1 and d2;
        select coalesce(sum(jl.debit - jl.credit), 0) into b from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id join acc_accounts ac on ac.id = jl.account_id where jl.tenant_id = tid and ac.type = 'expense' and j.jdate between d1 and d2;
        if a > 0 or b > 0 then
          perform alert_emit(tid, 'ledger', 'monthly_summary', 'info', 'activity', to_char(d1, 'FMMonth YYYY') || ' summary', 'Income ' || alert_inr(a) || ', expenses ' || alert_inr(b) || ', profit ' || alert_inr(a - b) || '.', '/accounts.html#/analytics', 'Open reports', 'mo-' || to_char(d1, 'YYYY-MM'));
        end if;
      end if;
    end if;
  exception when others then errs := errs || to_jsonb('summary: ' || sqlerrm); end;

  -- 11) smart notes (plain rules on your own numbers, no outside service)
  begin
    -- customers who keep paying late
    for r in select pa.id, pa.name, round(avg(greatest(al.alloc_date - d.due_date, 0))) late_days, count(*) n
               from acc_parties pa join acc_documents d on d.party_id = pa.id and d.doc_type = 'invoice' and d.status = 'posted' and d.due_date is not null
               join acc_allocations al on al.doc_id = d.id and al.reversed_at is null and al.alloc_date > today - 365
              where pa.tenant_id = tid and alert_party_due(tid, pa.id, true) > 0 group by pa.id, pa.name having count(*) >= 3 and avg(greatest(al.alloc_date - d.due_date, 0)) > 7 limit 5
    loop
      if extract(isodow from today) = 5 then
        perform alert_emit(tid, 'ledger', 'cust_risk', 'warning', 'smart', 'Customer risk: ' || r.name, r.name || ' has paid about ' || r.late_days || ' days late on average, and still owes money.', '/accounts.html#/party/' || r.id, 'View customer', 'risk-' || r.id || '-' || wk);
      end if;
    end loop;
    -- cash may run short
    select coalesce(sum(jl.debit - jl.credit), 0) into a from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id join acc_accounts ac on ac.id = jl.account_id
     where jl.tenant_id = tid and (ac.is_cash or ac.is_bank) and j.jdate > today - 30 and j.jdate <= today and j.voucher_type not in ('opening', 'contra')
       and not exists (select 1 from acc_journal_lines x join acc_accounts xa on xa.id = x.account_id where x.journal_id = j.id and x.id <> jl.id and (xa.is_cash or xa.is_bank));
    c := alert_cashbank(tid, 'cash') + alert_cashbank(tid, 'bank');
    if a < 0 and c > 0 and c + a / 30 * 7 < greatest(coalesce((cfg->>'low_cash')::numeric, 0), 0) and extract(isodow from today) = 1 then
      perform alert_emit(tid, 'ledger', 'cash_predict', 'warning', 'smart', 'Cash may run short next week', 'At the last 30 days pace your cash and bank (' || alert_inr(c) || ') may fall to about ' || alert_inr(c + a / 30 * 7) || ' by next week.', '/accounts.html#/analytics', 'See cash flow', 'cp-' || wk);
    end if;
    -- an expense far above its usual
    for r in select ac.id, ac.name, cur.v cur_amt, prv.v / 3 avg_amt from acc_accounts ac
               cross join lateral (select coalesce(sum(jl.debit - jl.credit), 0) v from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id where jl.account_id = ac.id and j.jdate >= date_trunc('month', today)::date and j.jdate <= today) cur
               cross join lateral (select coalesce(sum(jl.debit - jl.credit), 0) v from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id where jl.account_id = ac.id and j.jdate >= (date_trunc('month', today) - interval '3 months')::date and j.jdate < date_trunc('month', today)::date) prv
              where ac.tenant_id = tid and ac.type = 'expense' and prv.v / 3 >= 1000 and cur.v > prv.v / 3 * 1.4 and extract(day from today) >= 10 limit 5
    loop
      perform alert_emit(tid, 'ledger', 'exp_anom', 'warning', 'smart', r.name || ' is higher than usual', 'This month ' || alert_inr(r.cur_amt) || ' so far, against about ' || alert_inr(r.avg_amt) || ' in a normal month (' || round((r.cur_amt / r.avg_amt - 1) * 100) || '% more).', '/accounts.html#/reports', 'View expenses', 'ea-' || r.id || '-' || mon);
    end loop;
    -- money expected / to pay soon
    if extract(isodow from today) = 1 then
      select coalesce(sum(total - paid), 0) into a from acc_documents where tenant_id = tid and doc_type = 'invoice' and status = 'posted' and total - paid > 0 and due_date between today and today + 6;
      if a > 0 then perform alert_emit(tid, 'ledger', 'collect_reco', 'info', 'smart', alert_inr(a) || ' is due from customers this week', 'Send reminders early to collect on time.', '/accounts.html#/receipts', 'Send reminders', 'cr-' || wk); end if;
    end if;
    select coalesce(sum(total - paid), 0) into b from acc_documents where tenant_id = tid and doc_type = 'bill' and status = 'posted' and total - paid > 0 and due_date = today + 1;
    if b > 0 then perform alert_emit(tid, 'ledger', 'pay_reco', 'info', 'smart', alert_inr(b) || ' supplier payments are due tomorrow', 'Keep enough money ready in cash or bank.', '/accounts.html#/purchases', 'See bills', 'pr-' || (today + 1)); end if;
    -- month on month and health
    if extract(day from today) between 2 and 4 then
      d1 := (date_trunc('month', today) - interval '1 month')::date; d2 := (date_trunc('month', today) - interval '1 day')::date;
      select coalesce(sum(jl.debit - jl.credit), 0) into a from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id join acc_accounts ac on ac.id = jl.account_id where jl.tenant_id = tid and ac.type = 'expense' and j.jdate between d1 and d2;
      select coalesce(sum(jl.debit - jl.credit), 0) into b from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id join acc_accounts ac on ac.id = jl.account_id where jl.tenant_id = tid and ac.type = 'expense' and j.jdate between (d1 - interval '1 month')::date and d1 - 1;
      if b >= 5000 and a > b * 1.18 then
        perform alert_emit(tid, 'ledger', 'trend', 'info', 'smart', 'Expenses went up ' || round((a / b - 1) * 100) || '% last month', alert_inr(a) || ' against ' || alert_inr(b) || ' the month before.', '/accounts.html#/analytics', 'See expenses', 'tr-' || mon);
      end if;
    end if;
    if extract(isodow from today) = 5 then
      select coalesce(sum(total), 0) into a from acc_documents where tenant_id = tid and doc_type = 'invoice' and status = 'posted' and doc_date > today - 30;
      select coalesce(sum(amount), 0) into b from acc_payments where tenant_id = tid and kind = 'receipt' and status = 'posted' and pay_date > today - 30;
      if a > 20000 and a > b * 1.3 then
        perform alert_emit(tid, 'ledger', 'health', 'warning', 'smart', 'Dues are growing faster than collections', 'Last 30 days: ' || alert_inr(a) || ' billed, only ' || alert_inr(b) || ' collected.', '/accounts.html#/analytics', 'See dues', 'hl-' || wk);
      end if;
    end if;
  exception when others then errs := errs || to_jsonb('smart: ' || sqlerrm); end;

  return errs;
end $$;

create or replace function alerts_run(p_tid uuid default null, p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t record; res jsonb := '[]'::jsonb; e jsonb; n int := 0;
begin
  for t in select s.tenant_id from tenant_settings s where ((s.features->>'accounting') = 'true' or (s.features->>'finance') = 'true' or (s.features->>'scan') = 'true')
              and (p_tid is null or s.tenant_id = p_tid) and not exists (select 1 from tenants x where x.id = s.tenant_id and x.is_demo)
  loop
    begin
      e := alerts_run_tenant(t.tenant_id, p_now); n := n + 1;
      if jsonb_array_length(e) > 0 then res := res || jsonb_build_array(jsonb_build_object('tenant', t.tenant_id, 'errors', e)); end if;
    exception when others then res := res || jsonb_build_array(jsonb_build_object('tenant', t.tenant_id, 'errors', to_jsonb(sqlerrm)));
    end;
  end loop;
  return jsonb_build_object('tenants', n, 'problems', res);
end $$;

-- =========================================================
-- Settings and a test notice (owner and managers)
-- =========================================================
create or replace function alerts_settings_get() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := (me()->>'tenant_id')::uuid;
begin
  if me() is null or tid is null then raise exception 'authentication required' using errcode = '28000'; end if;
  return alert_cfg(tid) || jsonb_build_object('can_edit', (me()->>'role') in ('owner', 'manager'), 'defaults', alert_defaults());
end $$;

create or replace function alerts_settings_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := (me()->>'tenant_id')::uuid; cur jsonb; k text; v jsonb; out jsonb := '{}'::jsonb; arr jsonb;
begin
  if me() is null or tid is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if (me()->>'role') not in ('owner', 'manager') then raise exception 'Only the owner or a manager can change notification settings' using errcode = '42501'; end if;
  select coalesce(settings, '{}') into cur from alert_settings where tenant_id = tid;
  cur := coalesce(cur, '{}'::jsonb);
  for k, v in select * from jsonb_each(coalesce(p, '{}'::jsonb)) loop
    if k in ('low_cash', 'low_bank', 'large_in', 'large_out') then
      if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric < 0 or (v #>> '{}')::numeric > 1000000000 then raise exception '% must be a number from 0', k; end if;
      out := out || jsonb_build_object(k, v);
    elsif k in ('overdue_repeat', 'inactive_days', 'budget_warn', 'summary_hour', 'quiet_from', 'quiet_to') then
      if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric <> floor((v #>> '{}')::numeric) then raise exception '% must be a whole number', k; end if;
      if k in ('summary_hour', 'quiet_from', 'quiet_to') and ((v #>> '{}')::int < 0 or (v #>> '{}')::int > 23) then raise exception '% must be an hour from 0 to 23', k; end if;
      if k = 'overdue_repeat' and ((v #>> '{}')::int < 1 or (v #>> '{}')::int > 60) then raise exception 'Repeat days must be 1 to 60'; end if;
      if k = 'inactive_days' and ((v #>> '{}')::int < 7 or (v #>> '{}')::int > 730) then raise exception 'Inactive days must be 7 to 730'; end if;
      if k = 'budget_warn' and ((v #>> '{}')::int < 10 or (v #>> '{}')::int > 100) then raise exception 'Budget warning must be 10 to 100 percent'; end if;
      out := out || jsonb_build_object(k, v);
    elsif k in ('push', 'weekly', 'monthly') then
      if jsonb_typeof(v) <> 'boolean' then raise exception '% must be on or off', k; end if;
      out := out || jsonb_build_object(k, v);
    elsif k = 'recipients' then
      if v #>> '{}' not in ('owner', 'managers', 'all') then raise exception 'Recipients must be owner, managers or all'; end if;
      out := out || jsonb_build_object(k, v);
    elsif k = 'remind_days' then
      if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 4 or exists (select 1 from jsonb_array_elements(v) x where jsonb_typeof(x) <> 'number' or (x #>> '{}')::numeric < 1 or (x #>> '{}')::numeric > 30) then raise exception 'Reminder days must be up to 4 numbers from 1 to 30'; end if;
      out := out || jsonb_build_object(k, v);
    elsif k = 'off' then
      if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > 100 or exists (select 1 from jsonb_array_elements(v) x where jsonb_typeof(x) <> 'string' or length(x #>> '{}') > 40) then raise exception 'Invalid list of switched-off notices'; end if;
      out := out || jsonb_build_object(k, v);
    end if;
  end loop;
  insert into alert_settings (tenant_id, settings) values (tid, cur || out)
    on conflict (tenant_id) do update set settings = excluded.settings, updated_at = now();
  return alert_cfg(tid);
end $$;

create or replace function alerts_send_test() returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := (me()->>'tenant_id')::uuid; n int;
begin
  if me() is null or tid is null then raise exception 'authentication required' using errcode = '28000'; end if;
  n := alert_emit(tid, 'ledger', 'test', 'warning', 'activity', 'Test notification', 'If you can read this on your phone or computer, alerts are working.', null, null, 'test-' || to_char(now(), 'YYYYMMDDHH24MISS'), app_uid());
  return jsonb_build_object('sent', n);
end $$;
