-- AUZsFinance <-> AUZsLedger link, stage 1: one list of people, and one activity feed.
-- Both apps already post to the same double-entry books (money accounts are shared). This adds:
--  * fin_people.party_id: a person in Finance IS the same contact as a customer/supplier in Ledger (kept in step both ways)
--  * fin_ledger_feed(): Ledger bills, invoices, expenses and receipts/payments, shown inside Finance Activity

alter table fin_people add column if not exists party_id uuid references acc_parties(id) on delete set null;
create unique index if not exists fin_people_party on fin_people (tenant_id, party_id) where party_id is not null;

create or replace function fin_has_finance(tid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select features->>'finance' from tenant_settings where tenant_id = tid), 'false') = 'true' $$;

-- make both lists match: link by name + phone, then copy whatever is missing on either side
create or replace function fin_sync_people_core(tid uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  update fin_people f set party_id = (select p.id from acc_parties p where p.tenant_id = tid and not p.is_walkin
      and lower(p.name) = lower(f.name) and coalesce(p.phone,'') = coalesce(f.phone,'') and not exists (select 1 from fin_people z where z.party_id = p.id) order by p.created_at limit 1)
  where f.tenant_id = tid and f.party_id is null;
  insert into fin_people (tenant_id, name, phone, kind, party_id, active)
    select tid, p.name, p.phone, case when p.kind = 'supplier' then 'supplier' when p.kind = 'customer' then 'customer'
      when p.party_type = 'employee' then 'staff' when p.party_type in ('partner','other') then 'other' else 'customer' end, p.id, p.active
    from acc_parties p where p.tenant_id = tid and not p.is_walkin and not exists (select 1 from fin_people f where f.party_id = p.id);
  insert into acc_parties (tenant_id, kind, party_type, name, phone, active)
    select tid, case when f.kind = 'supplier' then 'supplier' when f.kind = 'customer' then 'customer' else 'both' end,
      case f.kind when 'staff' then 'employee' when 'other' then 'other' else f.kind end, f.name, f.phone, f.active
    from fin_people f where f.tenant_id = tid and f.party_id is null;
  update fin_people f set party_id = (select p.id from acc_parties p where p.tenant_id = tid and not p.is_walkin and lower(p.name) = lower(f.name)
      and coalesce(p.phone,'') = coalesce(f.phone,'') and not exists (select 1 from fin_people z where z.party_id = p.id) order by p.created_at desc limit 1)
  where f.tenant_id = tid and f.party_id is null;
end $$;

create or replace function fin_sync_people() returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; n int;
begin
  tid := fin_guard('write');
  select count(*) into n from fin_people where tenant_id = tid;
  perform fin_sync_people_core(tid);
  return jsonb_build_object('people', (select count(*) from fin_people where tenant_id = tid), 'was', n);
end $$;

-- keep names, phones and active flag the same when either side is edited
create or replace function fin_party_changed() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 or new.is_walkin or not fin_has_finance(new.tenant_id) then return new; end if;
  begin
    if exists (select 1 from fin_people where party_id = new.id) then
      update fin_people set name = new.name, phone = new.phone, active = new.active
        where party_id = new.id and (name, coalesce(phone,''), active) is distinct from (new.name, coalesce(new.phone,''), new.active);
    else perform fin_sync_people_core(new.tenant_id); end if;
  exception when others then null; end;
  return new;
end $$;
drop trigger if exists acc_parties_to_fin on acc_parties;
create trigger acc_parties_to_fin after insert or update of name, phone, active on acc_parties for each row execute function fin_party_changed();

create or replace function fin_person_changed() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return new; end if;
  begin
    if new.party_id is not null then
      update acc_parties set name = new.name, phone = new.phone, active = new.active
        where id = new.party_id and (name, coalesce(phone,''), active) is distinct from (new.name, coalesce(new.phone,''), new.active);
    else perform fin_sync_people_core(new.tenant_id); end if;
  exception when others then null; end;
  return new;
end $$;
drop trigger if exists fin_people_to_acc on fin_people;
create trigger fin_people_to_acc after insert or update of name, phone, active on fin_people for each row execute function fin_person_changed();

-- backfill for businesses that already use Finance
do $$ declare t record; begin
  for t in select tenant_id from tenant_settings where features->>'finance' = 'true' loop
    begin perform fin_sync_people_core(t.tenant_id); exception when others then null; end;
  end loop;
end $$;

-- Ledger entries shown inside Finance Activity (read-only there; opened in Ledger for editing)
create or replace function fin_ledger_feed(p jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; lim int := least(coalesce((p->>'limit')::int, 100), 300); q text := nullif(p->>'q', '');
begin
  tid := fin_guard('view');
  return (select coalesce(jsonb_agg(to_jsonb(r) order by r.txn_date desc, r.created_at desc), '[]') from (
    select * from (
      select 'doc'::text as ref_type, d.id, d.doc_type as kind, d.number, d.doc_date as txn_date, d.total as amount, pa.name as party,
             null::text as account, null::text as mode, null::text as reference, d.status, d.paid, d.created_at
        from acc_documents d left join acc_parties pa on pa.id = d.party_id
       where d.tenant_id = tid and d.doc_type in ('invoice','bill','expense','credit_note','debit_note') and d.status <> 'draft'
      union all
      select 'payment', y.id, y.kind, y.number, y.pay_date, y.amount, pa.name, ac.name, y.mode, y.reference, y.status, y.allocated, y.created_at
        from acc_payments y left join acc_parties pa on pa.id = y.party_id left join acc_accounts ac on ac.id = y.account_id
       where y.tenant_id = tid
    ) x
    where (nullif(p->>'from','') is null or x.txn_date >= (p->>'from')::date) and (nullif(p->>'to','') is null or x.txn_date <= (p->>'to')::date)
      and (q is null or coalesce(x.party,'') ilike '%' || q || '%' or x.number ilike '%' || q || '%' or coalesce(x.reference,'') ilike '%' || q || '%')
    order by x.txn_date desc, x.created_at desc limit lim) r);
end $$;
