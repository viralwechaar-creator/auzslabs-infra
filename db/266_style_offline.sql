-- Offline-first AUZsStyle (db/266): every change made with no connection is queued on the device and sent later in one
-- batch through POST /sync. This migration adds the server half:
--  1. sty_ops: one row per change already applied, so a change sent twice (lost reply, retry) is applied once.
--  2. sty_reserve_barcodes(n): a device reserves a block of tag codes while online so it can create styles and print
--     tags later with no connection; the codes come from the same counter as sty_barcode(), so they never clash.
--  3. sty_save_style accepts newId / variantIds / barcodes so a style made offline keeps the same ids and codes when it
--     reaches the server (follow-up changes made offline, like receiving stock, already point at those ids).
create table if not exists sty_ops (
  op_id text primary key,
  tenant_id uuid not null,
  user_id uuid,
  fn text not null,
  result jsonb,
  at timestamptz not null default now()
);
alter table sty_ops enable row level security;
create index if not exists sty_ops_at_idx on sty_ops (at);

create or replace function sty_op_get(p_op text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; r jsonb; found_ boolean;
begin
  tid := sty_guard('sty_view');
  select true, result into found_, r from sty_ops where op_id = left(p_op, 80) and tenant_id = tid;
  if found_ then return jsonb_build_object('seen', true, 'result', r); end if;
  return jsonb_build_object('seen', false);
end $$;

create or replace function sty_op_put(p_op text, p_fn text, p_result jsonb) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_guard('sty_view');
  insert into sty_ops (op_id, tenant_id, user_id, fn, result) values (left(p_op, 80), tid, app_uid(), p_fn, p_result) on conflict (op_id) do nothing;
end $$;

create or replace function sty_reserve_barcodes(p_n int default 200) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; out_ jsonb := '[]'::jsonb; i int;
begin
  tid := sty_guard('sty_manage');
  if p_n is null or p_n < 1 or p_n > 1000 then raise exception 'Ask for 1 to 1000 codes' using errcode = 'ST002'; end if;
  for i in 1..p_n loop out_ := out_ || to_jsonb(sty_barcode(tid)); end loop;
  return out_;
end $$;

create or replace function sty_save_style(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; sid uuid; nid uuid; vkey text; c text; z text; vid uuid; b uuid; oq int; uc numeric; cols jsonb; szs jsonb; v_exists uuid;
begin
  tid := sty_guard('sty_manage');
  sid := nullif(p->>'id', '')::uuid;
  nid := nullif(p->>'newId', '')::uuid;
  -- a style made on a phone with no connection brings its own id; sending it twice just updates it
  if sid is null and nid is not null and exists (select 1 from sty_styles where id = nid and tenant_id = tid) then sid := nid; end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Give the style a name' using errcode = 'ST002'; end if;
  if sid is null then
    insert into sty_styles (id, tenant_id, name, category, subcategory, brand, season, gender, hsn, tax_pct, cost, price, mrp, notes, photo_url, active, created_by, description, details, fabric, washcare, weight_g, collection, code, photos)
    values (coalesce(nid, gen_random_uuid()), tid, trim(p->>'name'), coalesce(nullif(p->>'category', ''), 'Clothing'), p->>'subcategory', p->>'brand', p->>'season', p->>'gender', p->>'hsn',
      nullif(p->>'taxPct', '')::numeric, coalesce(nullif(p->>'cost', '')::numeric, 0), coalesce(nullif(p->>'price', '')::numeric, 0),
      coalesce(nullif(p->>'mrp', '')::numeric, nullif(p->>'price', '')::numeric, 0), p->>'notes', p->>'photoUrl', coalesce((p->>'active')::boolean, true), app_uid(), p->>'description', p->>'details', p->>'fabric', p->>'washcare', nullif(p->>'weightG','')::numeric, p->>'collection', nullif(trim(coalesce(p->>'code','')), ''), coalesce(p->'photos', '[]'::jsonb))
    returning id into sid;
  else
    update sty_styles set name = coalesce(nullif(trim(p->>'name'), ''), name), category = coalesce(nullif(p->>'category', ''), category),
      subcategory = case when p ? 'subcategory' then p->>'subcategory' else subcategory end, brand = case when p ? 'brand' then p->>'brand' else brand end,
      season = case when p ? 'season' then p->>'season' else season end, gender = case when p ? 'gender' then p->>'gender' else gender end,
      hsn = case when p ? 'hsn' then p->>'hsn' else hsn end, tax_pct = case when p ? 'taxPct' then nullif(p->>'taxPct', '')::numeric else tax_pct end,
      cost = coalesce(nullif(p->>'cost', '')::numeric, cost), price = coalesce(nullif(p->>'price', '')::numeric, price), mrp = coalesce(nullif(p->>'mrp', '')::numeric, mrp),
      notes = case when p ? 'notes' then p->>'notes' else notes end, photo_url = case when p ? 'photoUrl' then p->>'photoUrl' else photo_url end,
      description = case when p ? 'description' then p->>'description' else description end, details = case when p ? 'details' then p->>'details' else details end,
      fabric = case when p ? 'fabric' then p->>'fabric' else fabric end, washcare = case when p ? 'washcare' then p->>'washcare' else washcare end,
      weight_g = case when p ? 'weightG' then nullif(p->>'weightG','')::numeric else weight_g end, collection = case when p ? 'collection' then p->>'collection' else collection end,
      code = case when p ? 'code' then nullif(trim(coalesce(p->>'code','')), '') else code end, photos = case when p ? 'photos' then coalesce(p->'photos', '[]'::jsonb) else photos end,
      active = coalesce((p->>'active')::boolean, active), updated_at = now()
    where id = sid and tenant_id = tid;
    if not found then raise exception 'style not found'; end if;
  end if;
  cols := coalesce(p->'colours', '[]'::jsonb); szs := coalesce(p->'sizes', '[]'::jsonb);
  if jsonb_array_length(cols) = 0 and jsonb_array_length(szs) > 0 then cols := '[""]'::jsonb; end if;
  if jsonb_array_length(szs) = 0 and jsonb_array_length(cols) > 0 then szs := '[""]'::jsonb; end if;
  b := coalesce(nullif(p#>>'{opening,branchId}', '')::uuid, sty_main_branch(tid));
  oq := coalesce(nullif(p#>>'{opening,qty}', '')::int, 0);
  uc := coalesce(nullif(p#>>'{opening,unitCost}', '')::numeric, nullif(p->>'cost', '')::numeric, 0);
  for c in select jsonb_array_elements_text(cols) loop
    for z in select jsonb_array_elements_text(szs) loop
      vkey := trim(c) || '|' || trim(z);
      select id into v_exists from sty_variants where tenant_id = tid and style_id = sid and colour = trim(c) and size = trim(z);
      if v_exists is null then
        insert into sty_variants (id, tenant_id, style_id, colour, size, barcode, sku, cost, reorder_at)
        values (coalesce(nullif(p#>>array['variantIds', vkey], '')::uuid, gen_random_uuid()), tid, sid, trim(c), trim(z), coalesce(nullif(p#>>array['barcodes', vkey], ''), sty_barcode(tid)), (select code || nullif('-' || regexp_replace(trim(c) || '-' || trim(z), '^-|-$', '', 'g'), '-') from sty_styles where id = sid and code is not null), uc, coalesce(nullif(p->>'reorderAt', '')::int, 2)) returning id into vid;
        if oq > 0 then
          insert into sty_stock_moves (tenant_id, branch_id, variant_id, qty, kind, unit_cost, ref_type, staff_id, note)
          values (tid, b, vid, oq, 'opening', uc, 'style', app_uid(), 'Opening stock');
        end if;
      end if;
    end loop;
  end loop;
  if p ? 'reorderAt' then update sty_variants set reorder_at = (p->>'reorderAt')::int where style_id = sid and tenant_id = tid; end if;
  perform sty_audit_log(tid, 'style_save', sid::text, jsonb_build_object('name', p->>'name'));
  return sty_style_json(tid, sid, null, true);
end $$;

-- create functions: a record made offline brings its own id (newId); a customer found by phone keeps the existing id and the device remaps
create or replace function sty_save_supplier(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; sid uuid;
begin
  tid := sty_guard('sty_purchase');
  sid := nullif(p->>'id', '')::uuid;
  if sid is null then
    insert into sty_suppliers (id, tenant_id, name, contact, phone, gstin, category) values (coalesce(nullif(p->>'newId', '')::uuid, gen_random_uuid()), tid, coalesce(nullif(trim(p->>'name'), ''), 'Supplier'), p->>'contact', p->>'phone', p->>'gstin', p->>'category') returning id into sid;
  else
    update sty_suppliers set name = coalesce(nullif(trim(p->>'name'), ''), name), contact = coalesce(p->>'contact', contact), phone = coalesce(p->>'phone', phone),
      gstin = coalesce(p->>'gstin', gstin), category = coalesce(p->>'category', category), active = coalesce((p->>'active')::boolean, active)
    where id = sid and tenant_id = tid;
  end if;
  return sty_list_suppliers();
end $$;

create or replace function sty_save_customer(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; cid uuid; ph text;
begin
  tid := sty_guard('sty_sell');
  cid := nullif(p->>'id', '')::uuid; ph := nullif(regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g'), '');
  if ph is not null and length(ph) > 10 then ph := right(ph, 10); end if;
  if cid is null and ph is not null then select id into cid from sty_customers where tenant_id = tid and phone = ph; end if;
  if cid is null then
    insert into sty_customers (id, tenant_id, name, phone, usual_size, birthday, anniversary, notes, gender, city, wa_optin)
    values (coalesce(nullif(p->>'newId', '')::uuid, gen_random_uuid()), tid, coalesce(nullif(trim(p->>'name'), ''), 'Customer'), ph, p->>'usualSize', nullif(p->>'birthday', '')::date, nullif(p->>'anniversary', '')::date, p->>'notes',
            nullif(p->>'gender', ''), nullif(trim(coalesce(p->>'city', '')), ''), coalesce((p->>'waOptin')::boolean, true)) returning id into cid;
  else
    update sty_customers set name = coalesce(nullif(trim(p->>'name'), ''), name), phone = coalesce(ph, phone), usual_size = case when p ? 'usualSize' then p->>'usualSize' else usual_size end,
      birthday = case when p ? 'birthday' then nullif(p->>'birthday', '')::date else birthday end,
      anniversary = case when p ? 'anniversary' then nullif(p->>'anniversary', '')::date else anniversary end,
      notes = case when p ? 'notes' then p->>'notes' else notes end,
      gender = case when p ? 'gender' then nullif(p->>'gender', '') else gender end,
      city = case when p ? 'city' then nullif(trim(coalesce(p->>'city', '')), '') else city end,
      wa_optin = case when p ? 'waOptin' then coalesce((p->>'waOptin')::boolean, true) else wa_optin end
    where id = cid and tenant_id = tid;
  end if;
  return (select jsonb_build_object('id', id, 'name', name, 'phone', phone, 'usualSize', usual_size, 'points', points, 'credit', credit, 'birthday', birthday) from sty_customers where id = cid);
end $$;

create or replace function sty_collection_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; cid uuid := nullif(p->>'id', '')::uuid; nm text := nullif(trim(coalesce(p->>'name', '')), '');
begin
  tid := sty_guard('sty_manage');
  if nm is null then raise exception 'Give the collection a name' using errcode = 'ST002'; end if;
  begin
    if cid is null then
      insert into sty_collections (id, tenant_id, name, note, image) values (coalesce(nullif(p->>'newId', '')::uuid, gen_random_uuid()), tid, nm, nullif(trim(coalesce(p->>'note', '')), ''), nullif(trim(coalesce(p->>'image', '')), '')) returning id into cid;
    else
      update sty_collections set name = nm, note = case when p ? 'note' then nullif(trim(coalesce(p->>'note', '')), '') else note end, image = case when p ? 'image' then nullif(trim(coalesce(p->>'image', '')), '') else image end where id = cid and tenant_id = tid;
      if not found then raise exception 'collection not found' using errcode = 'ST002'; end if;
    end if;
  exception when unique_violation then raise exception 'A collection with that name already exists' using errcode = 'ST002';
  end;
  perform sty_audit_log(tid, 'collection_save', cid::text, jsonb_build_object('name', nm));
  return jsonb_build_object('id', cid, 'name', nm);
end $$;

create or replace function sty_coupon_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; cid uuid := nullif(p->>'id', '')::uuid; cd text := upper(regexp_replace(coalesce(p->>'code', ''), '[^A-Za-z0-9_-]', '', 'g'));
begin
  tid := sty_guard('sty_manage');
  if length(cd) < 3 or length(cd) > 24 then raise exception 'The code must be 3 to 24 letters or numbers' using errcode = 'ST002'; end if;
  if p->>'kind' not in ('pct', 'flat', 'ship') then raise exception 'Choose a coupon type' using errcode = 'ST002'; end if;
  if p->>'kind' = 'pct' and (coalesce((p->>'value')::numeric, 0) <= 0 or (p->>'value')::numeric > 100) then raise exception 'Percent must be between 1 and 100' using errcode = 'ST002'; end if;
  if p->>'kind' = 'flat' and coalesce((p->>'value')::numeric, 0) <= 0 then raise exception 'Enter the rupee amount' using errcode = 'ST002'; end if;
  if cid is null then
    insert into sty_coupons (id, tenant_id, code, kind, value, min_order, max_uses, first_order_only, starts_on, ends_on, active, note)
    values (coalesce(nullif(p->>'newId', '')::uuid, gen_random_uuid()), tid, cd, p->>'kind', coalesce((p->>'value')::numeric, 0), coalesce((p->>'minOrder')::numeric, 0), nullif(p->>'maxUses', '')::int, coalesce((p->>'firstOnly')::boolean, false),
      nullif(p->>'startsOn', '')::date, nullif(p->>'endsOn', '')::date, coalesce((p->>'active')::boolean, true), nullif(p->>'note', '')) returning id into cid;
  else
    update sty_coupons set code = cd, kind = p->>'kind', value = coalesce((p->>'value')::numeric, 0), min_order = coalesce((p->>'minOrder')::numeric, 0), max_uses = nullif(p->>'maxUses', '')::int,
      first_order_only = coalesce((p->>'firstOnly')::boolean, false), starts_on = nullif(p->>'startsOn', '')::date, ends_on = nullif(p->>'endsOn', '')::date,
      active = coalesce((p->>'active')::boolean, true), note = nullif(p->>'note', '') where id = cid and tenant_id = tid;
  end if;
  perform sty_audit_log(tid, 'coupon.save', cd, null);
  return jsonb_build_object('id', cid);
exception when unique_violation then raise exception 'That code already exists' using errcode = 'ST002';
end $$;

create or replace function sty_save_branch(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; bid uuid;
begin
  tid := sty_guard('sty_manage');
  bid := nullif(p->>'id', '')::uuid;
  if bid is null then
    insert into sty_branches (id, tenant_id, name, kind, address) values (coalesce(nullif(p->>'newId', '')::uuid, gen_random_uuid()), tid, coalesce(nullif(p->>'name', ''), 'Branch'), coalesce(p->>'kind', 'shop'), p->>'address') returning id into bid;
  else
    update sty_branches set name = coalesce(nullif(p->>'name', ''), name), kind = coalesce(p->>'kind', kind), address = coalesce(p->>'address', address),
      active = coalesce((p->>'active')::boolean, active) where id = bid and tenant_id = tid;
  end if;
  return sty_context();
end $$;
