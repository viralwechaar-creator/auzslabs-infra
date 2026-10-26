-- AUZsStyle Cloud Sync, Stage 3: remote writes come back down too, with the owner's chosen rule -- "the shop PC
-- always wins". Until now sync was one-way (PC -> cloud, db/276) and the owner could sign into the paired cloud
-- tenant (db/277) only to look -- an edit made there would just sit until the next PC push silently overwrote it.
-- Now:
--   * the cloud's OWN sty_change_log (the same trigger from db/276, which already fires for every tenant --
--     cloud tenants included) finally gets read: whatever someone changes while signed into the cloud tenant
--     directly is a real, genuine remote edit, and GET /cloud/sync (server/src/routes/cloud.js) hands those
--     changes to whichever PC asks, in order, since the cursor it already sent.
--   * applying a change, in EITHER direction, is now suppressed from re-logging itself (session flag
--     sty.suppress_log), so a PC's push is never mistaken on the cloud for "a new remote edit", and a pulled-
--     down remote edit is never mistaken on the PC for "a new local edit" that would just get pushed straight
--     back up. Without this a push and a pull would bounce the exact same row back and forth forever.
--   * "the PC always wins": sty_local_apply_pulled_change refuses to apply an incoming remote change for a row
--     the PC itself has changed more recently than its own last successful push (sty_sync_cursor.last_pushed) --
--     that row is going up to the cloud on the very next push anyway, so applying the remote edit here first
--     would only have the PC immediately undo it again. A remote edit to a row the PC has not touched since
--     applies normally. This is deliberately unconditional (no timestamp comparison): the PC's own pending
--     change always wins, not merely whichever edit happens to be newer.

create or replace function sty_log_change() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('sty.suppress_log', true), '') = 'on' then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    insert into sty_change_log (tenant_id, tbl, row_id, op) values (OLD.tenant_id, tg_table_name, OLD.id, 'delete');
    return OLD;
  else
    insert into sty_change_log (tenant_id, tbl, row_id, op, row) values (NEW.tenant_id, tg_table_name, NEW.id, 'upsert', to_jsonb(NEW));
    return NEW;
  end if;
end $$;

alter table sty_sync_cursor add column if not exists last_pulled bigint not null default 0;

-- applying a PUSH on the cloud must not log itself as a fresh "remote" change (see header) -- otherwise the very
-- next pull would hand the PC back the change it just sent, forever.
create or replace function sty_cloud_apply_change(p_tenant uuid, p_tbl text, p_row_id uuid, p_op text, p_row jsonb) returns void language plpgsql security definer set search_path = public as $$
declare cols text;
begin
  if p_tbl not in ('sty_branches', 'sty_styles', 'sty_variants', 'sty_stock_moves', 'sty_suppliers', 'sty_purchases',
      'sty_purchase_lines', 'sty_supplier_payments', 'sty_customers', 'sty_sales', 'sty_sale_lines', 'sty_returns', 'sty_return_lines',
      'sty_transfers', 'sty_transfer_lines') then
    raise exception 'unknown sync table %', p_tbl;
  end if;
  perform set_config('sty.suppress_log', 'on', true);
  if p_op = 'delete' then
    execute format('delete from %I where tenant_id = $1 and id = $2', p_tbl) using p_tenant, p_row_id;
    return;
  end if;
  select string_agg(format('%I = excluded.%I', column_name, column_name), ', ')
    into cols from information_schema.columns where table_schema = 'public' and table_name = p_tbl and column_name <> 'id';
  execute format('insert into %I select * from jsonb_populate_record(null::%I, $1) on conflict (id) do update set %s', p_tbl, p_tbl, cols)
    using (p_row || jsonb_build_object('id', p_row_id, 'tenant_id', p_tenant));
end $$;

-- The cloud's own export: whatever changed in sty_change_log for this tenant since p_since. Because applying a
-- push is now suppressed (above), this can never include the PC's own pushes reflected back -- only changes made
-- by someone who actually edited data while signed into the cloud tenant.
create or replace function sty_cloud_sync_pull(p_tenant uuid, p_since bigint, p_limit int default 200) returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'tbl', tbl, 'rowId', row_id, 'op', op, 'row', row) order by id), '[]'::jsonb)
  from (select id, tbl, row_id, op, row from sty_change_log where tenant_id = p_tenant and id > p_since order by id limit p_limit) x
$$;

-- Applies one PULLED remote change into the PC's own local tables. "The PC always wins": skipped outright (not
-- an error) if the PC's own change log already has an entry for this exact row that it has not pushed up yet --
-- see the header. Returns whether it applied (true) or was skipped for that reason (false).
create or replace function sty_local_apply_pulled_change(p_tenant uuid, p_tbl text, p_row_id uuid, p_op text, p_row jsonb) returns boolean language plpgsql security definer set search_path = public as $$
declare cols text; cur bigint; pending boolean;
begin
  if p_tbl not in ('sty_branches', 'sty_styles', 'sty_variants', 'sty_stock_moves', 'sty_suppliers', 'sty_purchases',
      'sty_purchase_lines', 'sty_supplier_payments', 'sty_customers', 'sty_sales', 'sty_sale_lines', 'sty_returns', 'sty_return_lines',
      'sty_transfers', 'sty_transfer_lines') then
    raise exception 'unknown sync table %', p_tbl;
  end if;
  select coalesce(last_pushed, 0) into cur from sty_sync_cursor where tenant_id = p_tenant;
  select exists(select 1 from sty_change_log where tenant_id = p_tenant and tbl = p_tbl and row_id = p_row_id and id > coalesce(cur, 0)) into pending;
  if pending then return false; end if;
  perform set_config('sty.suppress_log', 'on', true);
  if p_op = 'delete' then
    execute format('delete from %I where tenant_id = $1 and id = $2', p_tbl) using p_tenant, p_row_id;
    return true;
  end if;
  select string_agg(format('%I = excluded.%I', column_name, column_name), ', ')
    into cols from information_schema.columns where table_schema = 'public' and table_name = p_tbl and column_name <> 'id';
  execute format('insert into %I select * from jsonb_populate_record(null::%I, $1) on conflict (id) do update set %s', p_tbl, p_tbl, cols)
    using (p_row || jsonb_build_object('id', p_row_id, 'tenant_id', p_tenant));
  return true;
end $$;

-- The PC's entry point: apply a whole pulled batch in one call, same discipline as sty_cloud_sync_push (one bad
-- or out-of-order row is logged and skipped, never aborts the rest of the batch).
create or replace function sty_local_apply_pulled_batch(p_tenant uuid, p_changes jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare c jsonb; applied int := 0; skipped int := 0; failed jsonb := '[]'::jsonb; ok boolean;
begin
  for c in select * from jsonb_array_elements(coalesce(p_changes, '[]'::jsonb)) loop
    begin
      ok := sty_local_apply_pulled_change(p_tenant, c->>'tbl', (c->>'rowId')::uuid, c->>'op', c->'row');
      if ok then applied := applied + 1; else skipped := skipped + 1; end if;
    exception when others then
      failed := failed || jsonb_build_object('tbl', c->>'tbl', 'rowId', c->>'rowId', 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('applied', applied, 'skipped', skipped, 'failed', failed);
end $$;

-- Rollback: drop function sty_local_apply_pulled_batch(uuid,jsonb); drop function sty_local_apply_pulled_change(uuid,text,uuid,text,jsonb);
-- drop function sty_cloud_sync_pull(uuid,bigint,int); alter table sty_sync_cursor drop column if exists last_pulled;
-- (sty_log_change and sty_cloud_apply_change would need restoring to their db/276 bodies by hand)
