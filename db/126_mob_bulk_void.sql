-- AUZsMob: bulk void for sales and purchases (owner/manager only, same as voiding one at a time).
-- Owner request: select several old sales/purchases/bills and clear them in one go, instead of one by one.
-- Still never a hard delete -- sales already only ever voided (db/081/093's mob_void_sale: stock restored,
-- row kept for reports/audit); purchases never had a void at all until now. A true delete would erase the
-- stock-movement trail and staff ledger entries a sale/purchase is tied to, so both bulk actions below are
-- bulk VOID, not bulk delete -- confirmed with the owner before building this (bulk delete + staff access
-- were both explicitly declined).

alter table mob_purchases add column if not exists voided boolean not null default false;
alter table mob_purchases add column if not exists void_reason text;

-- mob_void_purchase: owner/manager only, mirrors mob_void_sale's shape. Refuses to void a purchase whose
-- stock has already moved on (a serialized unit that's been sold, or a non-serialized item whose current
-- stock is less than what this purchase brought in) -- voiding it would then be reversing stock that isn't
-- there any more, exactly the "not enough stock" class of bug CLAUDE.md already flags for this module.
create or replace function mob_void_purchase(p_purchase_id uuid, p_reason text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; pu mob_purchases; unit mob_item_units; have numeric;
begin
  tid := mob_guard('mob_manage');
  select * into pu from mob_purchases where id = p_purchase_id and tenant_id = tid for update;
  if pu.id is null then raise exception 'purchase not found' using errcode = 'MB004'; end if;
  if pu.voided then raise exception 'already voided' using errcode = 'MB008'; end if;

  if pu.unit_id is not null then
    select * into unit from mob_item_units where id = pu.unit_id and tenant_id = tid for update;
    if unit.id is not null then
      if unit.status <> 'in_stock' then
        raise exception 'This phone has already been sold or returned; void the sale first' using errcode = 'MB011';
      end if;
      -- 'returned' is the existing status for "this unit is gone from the shop" (db/080's own comment: it
      -- frees the IMEI to be rebought later) -- exactly what voiding a purchase means for a serialized unit.
      update mob_item_units set status = 'returned', updated_at = now() where id = unit.id;
      insert into mob_stock_movements (id, tenant_id, item_id, unit_id, qty, type, ref_id, staff_id)
        values (gen_random_uuid(), tid, pu.item_id, pu.unit_id, -1, 'adjustment', p_purchase_id, app_uid());
    end if;
  elsif pu.item_id is not null then
    select coalesce(sum(qty), 0) into have from mob_stock_movements where tenant_id = tid and item_id = pu.item_id;
    if have < pu.qty then
      raise exception 'Not enough of this item left in stock to undo this purchase -- some may already be sold' using errcode = 'MB011';
    end if;
    insert into mob_stock_movements (id, tenant_id, item_id, qty, type, ref_id, staff_id)
      values (gen_random_uuid(), tid, pu.item_id, -pu.qty, 'adjustment', p_purchase_id, app_uid());
  end if;

  update mob_purchases set voided = true, void_reason = p_reason where id = p_purchase_id;
  perform mob_audit_log(tid, 'mob_purchases', p_purchase_id, 'void', to_jsonb(pu), jsonb_build_object('reason', p_reason));
  return jsonb_build_object('ok', true);
end $$;

-- Bulk wrappers: call the real, already-tested single-void function per id inside its own sub-block, so one
-- bad/already-voided id in the batch never stops the rest -- the caller gets back exactly which ones worked.
create or replace function mob_void_sales_bulk(p_sale_ids uuid[], p_reason text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; sid uuid; done uuid[] := '{}'; failed jsonb := '[]'::jsonb;
begin
  tid := mob_guard('mob_manage');
  if p_sale_ids is null or array_length(p_sale_ids, 1) is null then raise exception 'nothing selected' using errcode = 'MB005'; end if;
  foreach sid in array p_sale_ids loop
    begin
      perform mob_void_sale(sid, p_reason);
      done := array_append(done, sid);
    exception when others then
      failed := failed || jsonb_build_object('id', sid, 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('ok', true, 'voided', coalesce(array_length(done, 1), 0), 'failed', failed);
end $$;

create or replace function mob_void_purchases_bulk(p_purchase_ids uuid[], p_reason text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; pid uuid; done uuid[] := '{}'; failed jsonb := '[]'::jsonb;
begin
  tid := mob_guard('mob_manage');
  if p_purchase_ids is null or array_length(p_purchase_ids, 1) is null then raise exception 'nothing selected' using errcode = 'MB005'; end if;
  foreach pid in array p_purchase_ids loop
    begin
      perform mob_void_purchase(pid, p_reason);
      done := array_append(done, pid);
    exception when others then
      failed := failed || jsonb_build_object('id', pid, 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('ok', true, 'voided', coalesce(array_length(done, 1), 0), 'failed', failed);
end $$;
