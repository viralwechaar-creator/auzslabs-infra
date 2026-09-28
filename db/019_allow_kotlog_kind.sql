-- =========================================================
-- Phase 1 POS features add a new records kind, 'kotlog' (one row per
-- KOT send, for the KOT report screen -- index.html's kot()). Every
-- non-owner write to `records` is gated by an explicit kind allow-list
-- (r_ins/r_upd policies below, and push_record()'s own check) rather
-- than a blanket "any authenticated tenant staffer can write any
-- kind" -- that's deliberate (a cashier can't silently rewrite the
-- menu or settings by crafting a request), but it means every NEW kind
-- a cashier/manager needs to write from the floor has to be added here
-- explicitly, or it silently fails to sync for anyone but the owner
-- (push_record raises 'not authorized', the item never leaves the
-- client's outbox, and it retries forever -- see doSync in index.html).
-- 'kotlog' needs this: kot() runs for any cashier taking orders, not
-- just owners.
-- =========================================================

drop policy if exists r_ins on records;
create policy r_ins on records for insert
  with check (
    me() is not null and tenant_id = (me()->>'tenant_id')::uuid
    and (kind in ('order','exp','shift','ing','waste','voidlog','kotlog') or (me()->>'role') = 'owner')
  );

drop policy if exists r_upd on records;
create policy r_upd on records for update
  using (
    me() is not null and tenant_id = (me()->>'tenant_id')::uuid
    and (kind in ('order','exp','shift','ing','waste','voidlog','kotlog') or (me()->>'role') = 'owner')
  )
  with check (
    me() is not null and tenant_id = (me()->>'tenant_id')::uuid
    and (kind in ('order','exp','shift','ing','waste','voidlog','kotlog') or (me()->>'role') = 'owner')
  );

create or replace function push_record(rid text, rkind text, rdata jsonb, rdeleted boolean, base timestamptz, force boolean default false) returns jsonb language plpgsql security definer set search_path = public as $$
declare cur timestamptz; conflict boolean := false; newv timestamptz; tid uuid;
begin
  tid := (me()->>'tenant_id')::uuid;
  if tid is null or not (rkind in ('order','exp','shift','ing','waste','voidlog','kotlog') or (me()->>'role') = 'owner') then
    raise exception 'not authorized';
  end if;

  select updated_at into cur from records where tenant_id = tid and id = rid;

  if cur is null then
    insert into records (id, tenant_id, kind, data, deleted) values (rid, tid, rkind, rdata, rdeleted) returning updated_at into newv;
  elsif force or base is null or cur = base then
    update records set kind = rkind, data = rdata, deleted = rdeleted where tenant_id = tid and id = rid returning updated_at into newv;
  else
    conflict := true; newv := cur;
  end if;

  return jsonb_build_object('ok', not conflict, 'conflict', conflict, 'server_updated_at', newv);
end $$;
