-- =========================================================
-- AUZsMob: let any staffer add a brand-new catalog item inline while purchasing or selling,
-- the same trust already extended to adding a new vendor on the fly (081's mob_save_vendor,
-- mob_guard('mob_purchase')). mob_save_item used to require mob_manage unconditionally, which
-- blocked a plain staffer's "New: ..." quick-add in Add purchase from ever actually reaching the
-- server (it queued locally, looked saved, then silently failed to sync -- or after the sync.js
-- rollback fix, rolled back with a "Not saved" toast). Owner request: "Allow staff and everyone
-- to purchase new item custom new item with complete new entry and also allow them to sell new
-- item which are not in entry."
--
-- The permission split stays real: creating a genuinely new item (cur.id is null) only needs
-- mob_purchase/mob_sell -- the same two keys every staffer already has by default. Editing an
-- item that already exists (someone else's catalog entry, prices other staff/the owner rely on)
-- still requires mob_manage, unchanged from before.
create or replace function mob_save_item(p_id uuid, p jsonb, p_base timestamptz default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; cur mob_items; newv timestamptz;
begin
  tid := mob_tenant();
  select * into cur from mob_items where id = p_id and tenant_id = tid;
  if cur.id is null then
    if not (mob_perm('mob_purchase') or mob_perm('mob_sell')) then
      raise exception 'Your role does not allow this (mob_purchase)' using errcode = '42501';
    end if;
  else
    if not mob_perm('mob_manage') then
      raise exception 'Your role does not allow this (mob_manage)' using errcode = '42501';
    end if;
  end if;
  if cur.id is not null and p_base is not null and cur.updated_at <> p_base then
    return jsonb_build_object('ok', false, 'conflict', true, 'server_updated_at', cur.updated_at);
  end if;
  insert into mob_items (id, tenant_id, name, category, serialized, selling_price, cost_price, low_stock_at, active, created_by)
    values (p_id, tid, p->>'name', coalesce(p->>'category', 'other'), coalesce((p->>'serialized')::boolean, false),
            coalesce((p->>'sellingPrice')::numeric, 0), coalesce((p->>'costPrice')::numeric, 0),
            coalesce((p->>'lowStockAt')::numeric, 0), coalesce((p->>'active')::boolean, true), app_uid())
  on conflict (id) do update set
    name = excluded.name, category = excluded.category, serialized = excluded.serialized,
    selling_price = excluded.selling_price, cost_price = excluded.cost_price, low_stock_at = excluded.low_stock_at,
    active = excluded.active, updated_at = now()
  returning updated_at into newv;
  if cur.id is not null then
    perform mob_audit_log(tid, 'mob_items', p_id, 'edit', to_jsonb(cur), p);
  end if;
  return jsonb_build_object('ok', true, 'conflict', false, 'server_updated_at', newv, 'id', p_id);
end $$;
