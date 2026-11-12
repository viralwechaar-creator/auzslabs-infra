-- Due-payment follow-up queue: the console's "Due Payment" page (daily/due in app/public/console/p-dashboard.js)
-- already lists unpaid bills with the exact amount due (total minus whatever's been paid so far), but it's a
-- raw list with no memory -- no way to tell "we already called about this one" from "nobody's touched it yet",
-- so every re-check (human or AI) starts from zero. This is a small, real tracking table on top of that exact
-- same due calculation, not a new concept: flag once, work it (contacted/settled/dismissed), never re-flag an
-- order that already has an open entry.
create table if not exists pos_due_followups (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  order_id           text not null,
  customer_name      text,
  customer_phone     text,
  amount_due         numeric(14,2) not null,
  flagged_at         timestamptz not null default now(),
  status             text not null default 'pending' check (status in ('pending', 'contacted', 'settled', 'dismissed')),
  last_contacted_at  timestamptz,
  note               text,
  resolved_at        timestamptz,
  resolved_by        uuid
);
create index if not exists pos_due_followups_tenant_status on pos_due_followups (tenant_id, status, flagged_at desc);
-- one open (pending/contacted) entry per order -- re-scanning never duplicates a flag that's already being worked
create unique index if not exists pos_due_followups_open_uq on pos_due_followups (tenant_id, order_id) where status in ('pending', 'contacted');
alter table pos_due_followups enable row level security;
drop policy if exists pos_due_followups_read on pos_due_followups;
create policy pos_due_followups_read on pos_due_followups for select
  using (me() is not null and tenant_id = (me()->>'tenant_id')::uuid and (me()->>'role') in ('owner', 'manager'));
grant select on pos_due_followups to app;
-- no insert/update policy: every write goes through the SECURITY DEFINER functions below, same discipline as
-- mcp_audit/pos_audit -- a bare write as `app`, even with a grant, would be refused by RLS.

-- Any signed-in staff member may run the scan (same visibility as the existing "Due payments" alert everyone
-- already sees) -- it only ever flags a real due order that doesn't already have an open entry, never resolves
-- or dismisses one, so there's nothing sensitive to gate behind owner/manager here.
create or replace function pos_duefollowup_scan() returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; r record; flagged jsonb := '[]'::jsonb; due numeric; v_inserted jsonb;
begin
  tid := (me()->>'tenant_id')::uuid;
  if tid is null then raise exception 'not authorized'; end if;

  for r in
    select id, data from records
    where tenant_id = tid and kind = 'order' and deleted = false and data->>'status' = 'due'
      and not exists (select 1 from pos_due_followups f where f.tenant_id = tid and f.order_id = records.id and f.status in ('pending', 'contacted'))
  loop
    due := coalesce((r.data->'t'->>'total')::numeric, (r.data->>'total')::numeric, 0)
         - coalesce((select sum((p->>'amt')::numeric) from jsonb_array_elements(coalesce(r.data->'pays', '[]'::jsonb)) p), 0);
    if due > 0.5 then
      v_inserted := null;
      insert into pos_due_followups (tenant_id, order_id, customer_name, customer_phone, amount_due)
        values (tid, r.id, r.data->'cust'->>'name', r.data->'cust'->>'phone', round(due, 2))
        on conflict do nothing
        returning jsonb_build_object('id', id, 'order_id', order_id, 'customer_name', customer_name, 'customer_phone', customer_phone, 'amount_due', amount_due) into v_inserted;
      if v_inserted is not null then flagged := flagged || jsonb_build_array(v_inserted); end if;
    end if;
  end loop;
  return flagged;
end $$;

create or replace function pos_duefollowup_list(p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_role text; v_tenant uuid;
begin
  select role, tenant_id into v_role, v_tenant from profiles where id = app_uid();
  if v_role not in ('owner', 'manager') then raise exception 'owner or manager access required' using errcode = 'P0001'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id, 'order_id', order_id, 'customer_name', customer_name, 'customer_phone', customer_phone,
      'amount_due', amount_due, 'flagged_at', flagged_at, 'status', status, 'last_contacted_at', last_contacted_at,
      'note', note, 'resolved_at', resolved_at
    ) order by flagged_at desc)
    from pos_due_followups where tenant_id = v_tenant and (p_status is null or status = p_status)
  ), '[]'::jsonb);
end $$;

create or replace function pos_duefollowup_mark(p_id uuid, p_status text, p_note text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_role text; v_tenant uuid; v_row pos_due_followups;
begin
  select role, tenant_id into v_role, v_tenant from profiles where id = app_uid();
  if v_role not in ('owner', 'manager') then raise exception 'owner or manager access required' using errcode = 'P0001'; end if;
  if p_status not in ('contacted', 'settled', 'dismissed') then raise exception 'status must be contacted, settled or dismissed' using errcode = 'P0001'; end if;

  update pos_due_followups set
    status = p_status,
    note = coalesce(p_note, note),
    last_contacted_at = case when p_status = 'contacted' then now() else last_contacted_at end,
    resolved_at = case when p_status in ('settled', 'dismissed') then now() else resolved_at end,
    resolved_by = case when p_status in ('settled', 'dismissed') then app_uid() else resolved_by end
  where id = p_id and tenant_id = v_tenant
  returning * into v_row;
  if v_row.id is null then raise exception 'follow-up not found' using errcode = 'P0001'; end if;
  return jsonb_build_object('id', v_row.id, 'status', v_row.status);
end $$;
