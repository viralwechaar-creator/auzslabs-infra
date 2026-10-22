-- AUZsFinance: payment modes (UPI/online UTR, card, cheque), who paid / who was paid (GSTIN), "earlier expense" paid before the
-- account or GST registration existed, its own business profile, its own file storage and its own lock date.
-- Same rules as before: tables RLS on with no policies, access only through SECURITY DEFINER fin_* functions that start with fin_guard().

alter table fin_txns add column if not exists cheque_no text;
alter table fin_txns add column if not exists cheque_date date;
alter table fin_txns add column if not exists cheque_bank text;
alter table fin_txns add column if not exists party_name text;
alter table fin_txns add column if not exists party_gstin text;
alter table fin_txns add column if not exists early_reason text;

-- one more kind: early_expense
do $$ declare c text; begin
  for c in select conname from pg_constraint where conrelid = 'fin_txns'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%money_in%' loop
    execute format('alter table fin_txns drop constraint %I', c);
  end loop;
  alter table fin_txns add constraint fin_txns_kind_check check (kind in ('money_in','expense','capital_in','drawing','loan_taken','loan_given','loan_repay','loan_collect','transfer','credit_sale','credit_purchase','dues_in','dues_out','asset_buy','early_expense'));
end $$;

-- ---------- its own files (no longer AUZsLedger's attachments) ----------
create table if not exists fin_files (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  txn_id uuid not null references fin_txns(id) on delete cascade,
  name text not null, url text not null, size_bytes int, created_by uuid, created_at timestamptz not null default now()
);
create index if not exists fin_files_txn_idx on fin_files (tenant_id, txn_id);
alter table fin_files enable row level security;

create or replace function fin_storage_check() returns boolean language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := fin_guard('view');
  return acc_perm('acc_post');
end $$;

create or replace function fin_attach(p_id uuid, p_name text, p_url text, p_size int default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; n int;
begin
  tid := fin_guard('write');
  if not exists (select 1 from fin_txns where id = p_id and tenant_id = tid) then raise exception 'Transaction not found'; end if;
  insert into fin_files (tenant_id, txn_id, name, url, size_bytes, created_by) values (tid, p_id, left(p_name, 200), p_url, p_size, app_uid());
  update fin_txns set evidence = 'have', updated_at = now() where id = p_id;
  select (select count(*) from fin_files where tenant_id = tid and txn_id = p_id) + (select count(*) from acc_attachments where tenant_id = tid and entity = 'fin_txn' and entity_id = p_id) into n;
  return jsonb_build_object('ok', true, 'files', n);
end $$;

create or replace function fin_txn_json(t fin_txns, tid uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(t) || jsonb_build_object(
    'account', (select name from fin_accounts where id = t.account_id), 'to_account', (select name from fin_accounts where id = t.to_account_id),
    'category', (select name from acc_accounts where id = t.category_id), 'person', (select name from fin_people where id = t.person_id),
    'partner', (select name from fin_partners where id = t.partner_id), 'loan', (select counterparty from fin_loans where id = t.loan_id),
    'files', (select coalesce(jsonb_agg(x.f order by x.at), '[]') from (
        select jsonb_build_object('name', name, 'url', url) f, created_at at from fin_files where tenant_id = tid and txn_id = t.id
        union all
        select jsonb_build_object('name', name, 'url', url), created_at from acc_attachments where tenant_id = tid and entity = 'fin_txn' and entity_id = t.id) x),
    'journal_no', (select number from acc_journals where id = t.journal_id))
$$;

-- ---------- earlier expense: paid by an owner/partner from their own pocket before the books, bank account or GST registration existed ----------
create or replace function fin_save_early(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; t fin_txns; amt numeric := round(coalesce((p->>'amount')::numeric,0),2); d date := coalesce((p->>'date')::date, current_date);
  pt fin_partners; cat uuid := nullif(p->>'category_id','')::uuid; opn text := nullif(p->>'op',''); fy uuid; jid uuid; nid uuid := gen_random_uuid(); narr text;
begin
  tid := fin_guard('write');
  if opn is not null then
    select * into t from fin_txns where tenant_id = tid and client_op = opn;
    if t.id is not null then return to_jsonb(t) || jsonb_build_object('duplicate', true); end if;
  end if;
  if amt <= 0 then raise exception 'Enter an amount above zero'; end if;
  if d > current_date then raise exception 'The date is in the future'; end if;
  if nullif(p->>'partner_id','') is null then raise exception 'Choose who paid for it'; end if;
  select * into pt from fin_partners where id = (p->>'partner_id')::uuid and tenant_id = tid;
  if pt.id is null then raise exception 'Choose who paid for it'; end if;
  if cat is not null and not exists (select 1 from acc_accounts where id = cat and tenant_id = tid) then raise exception 'Unknown category'; end if;
  fy := acc_assert_open(tid, d);
  cat := coalesce(cat, fin_acct(tid, 'general_expense'));
  narr := 'Earlier expense paid by ' || pt.name || coalesce(' - ' || nullif(p->>'purpose',''), '');
  jid := acc_post_journal(tid, 'journal', d, fy, null, narr, 'fin_txn', nid, jsonb_build_array(
    jsonb_build_object('account_id', cat, 'debit', amt), jsonb_build_object('account_id', pt.capital_ledger_id, 'credit', amt)));
  insert into fin_txns (id, tenant_id, client_op, kind, txn_date, amount, interest, category_id, partner_id, purpose, method, reference, evidence, review, note,
    party_name, party_gstin, early_reason, journal_id, created_by)
  values (nid, tid, opn, 'early_expense', d, amt, 0, cat, pt.id, nullif(p->>'purpose',''), nullif(p->>'method',''), nullif(p->>'reference',''),
    coalesce(nullif(p->>'evidence',''),'none'), coalesce(nullif(p->>'review',''),'confirmed'), nullif(p->>'note',''),
    nullif(left(p->>'party_name',120),''), nullif(upper(btrim(p->>'party_gstin')),''), coalesce(nullif(p->>'early_reason',''),'other'), jid, app_uid())
  returning * into t;
  perform acc_audit_log(tid, 'create', 'fin_txn', t.id::text, null, to_jsonb(t));
  return to_jsonb(t);
end $$;

-- ---------- the entry wrapper: now also keeps payment details and who paid / was paid ----------
create or replace function fin_save_txn(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; lim numeric; amt numeric := coalesce((p->>'amount')::numeric, 0); r jsonb; rate numeric := nullif(p->>'tax_rate','')::numeric; tds numeric := nullif(p->>'tds_amt','')::numeric;
  mode text := nullif(lower(btrim(p->>'method')),''); gs text := nullif(upper(btrim(p->>'party_gstin')),'');
begin
  tid := fin_guard('write');
  if gs is not null and gs !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then raise exception 'That GST number does not look right (15 letters and numbers)'; end if;
  if mode is not null and mode not in ('cash','upi','card','cheque','online') then raise exception 'Unknown payment mode'; end if;
  if coalesce(p->>'kind','') = 'early_expense' then
    return fin_save_early(p);
  end if;
  select approval_limit into lim from fin_settings where tenant_id = tid;
  if coalesce(lim, 0) > 0 and amt >= lim and coalesce(p->>'kind','') <> 'transfer' and not acc_perm('acc_approve') then
    p := p || jsonb_build_object('review', 'needs_review');
  end if;
  if rate is not null and (rate < 0 or rate > 40) then raise exception 'GST rate must be between 0 and 40'; end if;
  if tds is not null and (tds < 0 or tds > amt) then raise exception 'TDS cannot be more than the amount'; end if;
  r := fin_save_txn_core(p);
  if coalesce((r->>'duplicate')::boolean, false) = false then
    update fin_txns set tax_rate = nullif(rate, 0), tds_amt = nullif(tds, 0), method = coalesce(mode, method), reference = coalesce(nullif(btrim(p->>'reference'),''), reference),
      cheque_no = nullif(btrim(p->>'cheque_no'),''), cheque_date = nullif(p->>'cheque_date','')::date, cheque_bank = nullif(left(btrim(p->>'cheque_bank'),80),''),
      party_name = nullif(left(btrim(p->>'party_name'),120),''), party_gstin = gs
    where id = (r->>'id')::uuid and tenant_id = tid;
  end if;
  return r;
end $$;

-- ---------- its own business profile and lock date (no longer borrowed from AUZsLedger's settings) ----------
create table if not exists fin_profile (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  business_name text, legal_name text, business_type text, gstin text, pan text, phone text, email text,
  address text, city text, state text, pincode text, updated_at timestamptz not null default now(), updated_by uuid
);
alter table fin_profile enable row level security;

create or replace function fin_profile_get() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; r fin_profile;
begin
  tid := fin_guard('view');
  select * into r from fin_profile where tenant_id = tid;
  return coalesce(to_jsonb(r) - 'tenant_id' - 'updated_by', '{}'::jsonb)
    || jsonb_build_object('business_name', coalesce(r.business_name, (select name from tenants where id = tid)),
                          'lock_date', (select lock_date from acc_org where tenant_id = tid), 'can_edit', acc_perm('acc_admin'));
end $$;

create or replace function fin_profile_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; gs text := nullif(upper(btrim(p->>'gstin')),''); pn text := nullif(upper(btrim(p->>'pan')),''); nm text := btrim(coalesce(p->>'business_name',''));
begin
  tid := fin_guard('admin');
  if nm = '' then raise exception 'Give the business a name'; end if;
  if gs is not null and gs !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then raise exception 'That GST number does not look right (15 letters and numbers)'; end if;
  if pn is not null and pn !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' then raise exception 'That PAN does not look right (like ABCDE1234F)'; end if;
  insert into fin_profile (tenant_id, business_name, legal_name, business_type, gstin, pan, phone, email, address, city, state, pincode, updated_by)
  values (tid, left(nm,120), nullif(left(btrim(p->>'legal_name'),160),''), nullif(left(btrim(p->>'business_type'),60),''), gs, pn, nullif(left(btrim(p->>'phone'),20),''),
    nullif(left(btrim(p->>'email'),160),''), nullif(left(btrim(p->>'address'),400),''), nullif(left(btrim(p->>'city'),80),''), nullif(left(btrim(p->>'state'),80),''),
    nullif(left(btrim(p->>'pincode'),10),''), app_uid())
  on conflict (tenant_id) do update set business_name = excluded.business_name, legal_name = excluded.legal_name, business_type = excluded.business_type, gstin = excluded.gstin,
    pan = excluded.pan, phone = excluded.phone, email = excluded.email, address = excluded.address, city = excluded.city, state = excluded.state, pincode = excluded.pincode,
    updated_at = now(), updated_by = app_uid();
  perform acc_audit_log(tid, 'update', 'fin_profile', tid::text, null, jsonb_build_object('business_name', nm, 'gstin', gs));
  return fin_profile_get();
end $$;

create or replace function fin_set_lock_date(p_date date) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := fin_guard('admin');
  if p_date is not null and p_date > current_date then raise exception 'The lock date cannot be in the future'; end if;
  update acc_org set lock_date = p_date where tenant_id = tid;
  perform acc_audit_log(tid, 'update', 'fin_lock', tid::text, null, jsonb_build_object('lock_date', p_date));
  return jsonb_build_object('lock_date', p_date);
end $$;
