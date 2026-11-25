-- AUZsStyle <-> Storefront link. AUZsStyle is the in-store till (point of sale, offline and online) of the same business whose
-- online store is the Storefront. When a business has BOTH products and switches the link on (Storefront -> Channels), the two stay
-- one catalogue: products, sizes/colours (variants), prices, pictures, descriptions, categories, tags, collections and stock are kept
-- equal in both directions, and every online order lands in both places.
--
-- How it works: one idempotent "push" per direction, called from row triggers. A transaction-local setting (auz.sfxsync) marks
-- "this change was made by the link itself", so a change is never echoed back. AUZsStyle's stock ledger is the source of truth
-- for stock; the storefront's counter is kept equal to it, and a stock edit made in the storefront becomes an adjustment in AUZsStyle.
-- Nothing is copied unless sfx_stores.style_linked is true AND the business still has both features.
--
-- Rollback: drop the triggers named *_link (see the end of this file), drop the functions sfx_link_* / sfx_style_link_*,
-- then: alter table sfx_stores drop column style_linked; (the extra link columns are harmless to leave).

alter table sfx_stores add column if not exists style_linked boolean not null default false;
alter table sfx_variants add column if not exists source_variant_id uuid;
create unique index if not exists idx_sfx_variants_style on sfx_variants (tenant_id, source_variant_id) where source_variant_id is not null;
alter table sfx_orders add column if not exists sty_order_id uuid;
alter table sty_web_orders add column if not exists sfx_order_id uuid;
alter table sty_web_orders add column if not exists stock_taken boolean not null default false;
alter table sty_web_orders add column if not exists stock_returned boolean not null default false;
alter table sty_styles add column if not exists tags text[] not null default '{}';

-- ---------- helpers ----------
create or replace function sfx_link_busy() returns boolean language sql stable as $$ select coalesce(current_setting('auz.sfxsync', true), '') = '1' $$;

create or replace function sfx_link_on(tid uuid) returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select s.style_linked from sfx_stores s where s.tenant_id = tid), false)
     and coalesce((select (ts.features->>'style')::boolean and (ts.features->>'storefront')::boolean from tenant_settings ts where ts.tenant_id = tid), false)
$$;

-- stock of a variant = everything the AUZsStyle ledger holds (all branches), never below zero for the shop window
create or replace function sfx_link_stock(vid uuid) returns int language sql stable security definer set search_path = public as $$
  select greatest(coalesce(sum(qty), 0), 0)::int from sty_stock_moves where variant_id = vid
$$;

create or replace function sfx_link_label(colour text, size text) returns text language sql immutable as $$
  select coalesce(nullif(concat_ws(' / ', nullif(trim(colour), ''), nullif(trim(size), '')), ''), 'Default')
$$;

create or replace function sfx_link_images(s sty_styles) returns jsonb language sql stable as $$
  select case
    when jsonb_typeof(s.photos) = 'array' and jsonb_array_length(s.photos) > 0 then s.photos
    when nullif(s.photo_url, '') is not null then jsonb_build_array(s.photo_url)
    else '[]'::jsonb end
$$;

-- ---------- AUZsStyle -> Storefront ----------
create or replace function sfx_link_push_style(p_style uuid) returns void language plpgsql security definer set search_path = public as $$
declare s sty_styles; pid uuid; v record; vid uuid; stock_ int; pos_ int := 0; slug_ text; imgs jsonb;
begin
  select * into s from sty_styles where id = p_style;
  if s.id is null or not sfx_link_on(s.tenant_id) then return; end if;
  perform set_config('auz.sfxsync', '1', true);
  imgs := sfx_link_images(s);
  select id into pid from sfx_products where tenant_id = s.tenant_id and source_style_id = s.id;
  if pid is null then
    slug_ := coalesce(nullif(trim(both '-' from regexp_replace(lower(s.name), '[^a-z0-9]+', '-', 'g')), ''), 'item') || '-' || left(s.id::text, 4);
    insert into sfx_products (tenant_id, name, handle, category, description, images, status, price, compare_at, tags, source_style_id, extra)
      values (s.tenant_id, left(s.name, 200), slug_, s.category, coalesce(s.description, s.notes), imgs, case when s.active then 'active' else 'archived' end,
              s.price, case when s.mrp > s.price then s.mrp end, s.tags, s.id,
              jsonb_strip_nulls(jsonb_build_object('hsn', s.hsn, 'cost', nullif(s.cost, 0), 'brand', s.brand)))
      returning id into pid;
  else
    update sfx_products set name = left(s.name, 200), category = s.category, description = coalesce(s.description, s.notes), images = imgs,
      status = case when s.active then (case when status = 'draft' then 'active' else status end) else 'archived' end,
      price = s.price, compare_at = case when s.mrp > s.price then s.mrp end, tags = s.tags,
      extra = coalesce(extra, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('hsn', s.hsn, 'cost', nullif(s.cost, 0), 'brand', s.brand)),
      updated_at = now()
      where id = pid;
  end if;
  for v in select * from sty_variants where style_id = s.id and active order by colour, size loop
    stock_ := sfx_link_stock(v.id);
    select id into vid from sfx_variants where tenant_id = s.tenant_id and source_variant_id = v.id;
    if vid is null then
      insert into sfx_variants (tenant_id, product_id, label, sku, barcode, price, stock, position, source_variant_id)
        values (s.tenant_id, pid, left(sfx_link_label(v.colour, v.size), 80), v.sku, v.barcode, coalesce(v.price, s.price), stock_, pos_, v.id);
    else
      update sfx_variants set product_id = pid, label = left(sfx_link_label(v.colour, v.size), 80), sku = v.sku, barcode = v.barcode,
        price = coalesce(v.price, s.price), stock = stock_, position = pos_, updated_at = now() where id = vid;
    end if;
    pos_ := pos_ + 1;
  end loop;
  delete from sfx_variants where product_id = pid and source_variant_id is not null
    and source_variant_id not in (select id from sty_variants where style_id = s.id and active);
  perform set_config('auz.sfxsync', '', true);
exception when others then
  perform set_config('auz.sfxsync', '', true); raise;
end $$;

-- ---------- Storefront -> AUZsStyle ----------
create or replace function sfx_link_split(label text, out colour text, out size text) language plpgsql immutable as $$
begin
  if label is null or label = 'Default' then colour := ''; size := ''; return; end if;
  if position(' / ' in label) > 0 then colour := trim(split_part(label, ' / ', 1)); size := trim(substr(label, position(' / ' in label) + 3)); return; end if;
  colour := ''; size := trim(label);
end $$;

create or replace function sfx_link_pull_product(p_product uuid) returns void language plpgsql security definer set search_path = public as $$
declare p sfx_products; sid uuid; v record; svid uuid; sp record; col text; sz text; bc text; n int; main_branch uuid; imgs jsonb; first_img text;
begin
  select * into p from sfx_products where id = p_product;
  if p.id is null or not sfx_link_on(p.tenant_id) then return; end if;
  perform set_config('auz.sfxsync', '1', true);
  imgs := coalesce(p.images, '[]'::jsonb); first_img := nullif(imgs->>0, '');
  sid := p.source_style_id;
  if sid is null or not exists (select 1 from sty_styles where id = sid) then
    insert into sty_styles (tenant_id, name, category, price, mrp, description, notes, photo_url, photos, active, tags, hsn, cost)
      values (p.tenant_id, left(p.name, 200), coalesce(nullif(p.category, ''), 'Clothing'), p.price, coalesce(p.compare_at, p.price), p.description, p.description,
              first_img, imgs, p.status = 'active', coalesce(p.tags, '{}'), nullif(p.extra->>'hsn', ''), coalesce(nullif(p.extra->>'cost', '')::numeric, 0))
      returning id into sid;
    update sfx_products set source_style_id = sid where id = p.id;
  else
    update sty_styles set name = left(p.name, 200), category = coalesce(nullif(p.category, ''), category), price = p.price, mrp = coalesce(p.compare_at, p.price),
      description = p.description, notes = coalesce(p.description, notes), photo_url = first_img, photos = imgs, active = (p.status = 'active'), tags = coalesce(p.tags, '{}'),
      hsn = coalesce(nullif(p.extra->>'hsn', ''), hsn), cost = coalesce(nullif(p.extra->>'cost', '')::numeric, cost), updated_at = now()
      where id = sid;
  end if;
  main_branch := sty_main_branch(p.tenant_id);
  for v in select * from sfx_variants where product_id = p.id order by position, created_at loop
    select * into sp from sfx_link_split(v.label);
    col := sp.colour; sz := sp.size;
    svid := v.source_variant_id;
    if svid is not null and not exists (select 1 from sty_variants where id = svid) then svid := null; end if;
    if svid is null then
      -- the same colour/size may already exist (re-linking): reuse it, otherwise make a new one with a barcode
      select id into svid from sty_variants where style_id = sid and colour = col and size = sz;
      if svid is null then
        bc := nullif(trim(v.barcode), '');
        if bc is not null and exists (select 1 from sty_variants where tenant_id = p.tenant_id and barcode = bc) then bc := null; end if;
        insert into sty_variants (tenant_id, style_id, colour, size, barcode, sku, price, active)
          values (p.tenant_id, sid, col, sz, coalesce(bc, sty_barcode(p.tenant_id)), v.sku, case when v.price <> p.price then v.price end, true)
          returning id into svid;
        if v.stock > 0 then
          insert into sty_stock_moves (tenant_id, branch_id, variant_id, qty, kind, ref_type, note) values (p.tenant_id, main_branch, svid, v.stock, 'opening', 'storefront', 'From the online store');
        end if;
      end if;
      update sfx_variants set source_variant_id = svid where id = v.id;
    else
      update sty_variants set colour = col, size = sz, sku = coalesce(v.sku, sku), price = case when v.price <> p.price then v.price end, active = true where id = svid;
    end if;
  end loop;
  perform set_config('auz.sfxsync', '', true);
exception when others then
  perform set_config('auz.sfxsync', '', true); raise;
end $$;

-- ---------- collections (matched by name) ----------
create or replace function sfx_link_sync_collections(p_tenant uuid, p_from_style boolean) returns void language plpgsql security definer set search_path = public as $$
declare c record; cid uuid; m record;
begin
  if not sfx_link_on(p_tenant) then return; end if;
  perform set_config('auz.sfxsync', '1', true);
  if p_from_style then
    for c in select * from sty_collections where tenant_id = p_tenant loop
      select id into cid from sfx_collections where tenant_id = p_tenant and lower(name) = lower(c.name);
      if cid is null then insert into sfx_collections (tenant_id, name, handle, description) values (p_tenant, c.name, coalesce(nullif(trim(both '-' from regexp_replace(lower(c.name), '[^a-z0-9]+', '-', 'g')), ''), 'collection'), c.note) returning id into cid; end if;
      delete from sfx_collection_products where collection_id = cid and product_id not in (select p.id from sfx_products p join sty_collection_styles cs on cs.style_id = p.source_style_id where cs.collection_id = c.id);
      insert into sfx_collection_products (collection_id, product_id, position)
        select cid, p.id, 0 from sfx_products p join sty_collection_styles cs on cs.style_id = p.source_style_id where cs.collection_id = c.id on conflict do nothing;
    end loop;
    delete from sfx_collections where tenant_id = p_tenant and lower(name) not in (select lower(name) from sty_collections where tenant_id = p_tenant)
      and exists (select 1 from sfx_collection_products cp join sfx_products p on p.id = cp.product_id where cp.collection_id = sfx_collections.id and p.source_style_id is not null)
      and not exists (select 1 from sfx_collection_products cp join sfx_products p on p.id = cp.product_id where cp.collection_id = sfx_collections.id and p.source_style_id is null);
  else
    for c in select * from sfx_collections where tenant_id = p_tenant loop
      select id into cid from sty_collections where tenant_id = p_tenant and lower(name) = lower(c.name);
      if cid is null then insert into sty_collections (tenant_id, name, note) values (p_tenant, c.name, c.description) returning id into cid; end if;
      delete from sty_collection_styles where collection_id = cid and style_id not in (select p.source_style_id from sfx_products p join sfx_collection_products cp on cp.product_id = p.id where cp.collection_id = c.id and p.source_style_id is not null);
      insert into sty_collection_styles (collection_id, style_id, tenant_id)
        select cid, p.source_style_id, p_tenant from sfx_products p join sfx_collection_products cp on cp.product_id = p.id where cp.collection_id = c.id and p.source_style_id is not null on conflict do nothing;
    end loop;
    delete from sty_collections where tenant_id = p_tenant and lower(name) not in (select lower(name) from sfx_collections where tenant_id = p_tenant);
  end if;
  perform set_config('auz.sfxsync', '', true);
exception when others then
  perform set_config('auz.sfxsync', '', true); raise;
end $$;

-- ---------- triggers: AUZsStyle side ----------
create or replace function sfx_link_t_style() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if sfx_link_busy() then return null; end if;
  begin perform sfx_link_push_style(new.id); exception when others then null; end;
  return null;
end $$;
create or replace function sfx_link_t_variant() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if sfx_link_busy() then return null; end if;
  begin perform sfx_link_push_style(coalesce(new.style_id, old.style_id)); exception when others then null; end;
  return null;
end $$;
create or replace function sfx_link_t_stock() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if sfx_link_busy() then return null; end if;
  if sfx_link_on(new.tenant_id) then
    perform set_config('auz.sfxsync', '1', true);
    update sfx_variants set stock = sfx_link_stock(new.variant_id), updated_at = now() where tenant_id = new.tenant_id and source_variant_id = new.variant_id;
    perform set_config('auz.sfxsync', '', true);
  end if;
  return null;
exception when others then perform set_config('auz.sfxsync', '', true); return null;
end $$;
create or replace function sfx_link_t_coll_style() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if sfx_link_busy() then return null; end if;
  begin perform sfx_link_sync_collections(coalesce(new.tenant_id, old.tenant_id), true); exception when others then null; end;
  return null;
end $$;

drop trigger if exists sfx_link_style on sty_styles;
create trigger sfx_link_style after insert or update on sty_styles for each row execute function sfx_link_t_style();
drop trigger if exists sfx_link_variant on sty_variants;
create trigger sfx_link_variant after insert or update on sty_variants for each row execute function sfx_link_t_variant();
drop trigger if exists sfx_link_stock on sty_stock_moves;
create trigger sfx_link_stock after insert on sty_stock_moves for each row execute function sfx_link_t_stock();
drop trigger if exists sfx_link_coll on sty_collections;
create trigger sfx_link_coll after insert or update or delete on sty_collections for each row execute function sfx_link_t_coll_style();
drop trigger if exists sfx_link_collstyle on sty_collection_styles;
create trigger sfx_link_collstyle after insert or delete on sty_collection_styles for each row execute function sfx_link_t_coll_style();

-- ---------- triggers: Storefront side ----------
create or replace function sfx_link_t_product() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if sfx_link_busy() then return null; end if;
  if tg_op = 'DELETE' then
    if old.source_style_id is not null and sfx_link_on(old.tenant_id) then
      perform set_config('auz.sfxsync', '1', true); update sty_styles set active = false, updated_at = now() where id = old.source_style_id; perform set_config('auz.sfxsync', '', true);
    end if;
    return null;
  end if;
  begin perform sfx_link_pull_product(new.id); exception when others then null; end;
  return null;
end $$;
create or replace function sfx_link_t_sfxvariant() returns trigger language plpgsql security definer set search_path = public as $$
declare diff int; sv uuid; tid uuid; mb uuid;
begin
  if sfx_link_busy() then return null; end if;
  if tg_op = 'DELETE' then
    if old.source_variant_id is not null and sfx_link_on(old.tenant_id) then
      perform set_config('auz.sfxsync', '1', true); update sty_variants set active = false where id = old.source_variant_id; perform set_config('auz.sfxsync', '', true);
    end if;
    return null;
  end if;
  if tg_op = 'UPDATE' and new.source_variant_id is not null and new.stock is distinct from old.stock and sfx_link_on(new.tenant_id) then
    -- a stock change made in the storefront (inventory edit, online order, cancel) becomes an adjustment in the AUZsStyle ledger
    diff := new.stock - old.stock;
    mb := sty_main_branch(new.tenant_id);
    perform set_config('auz.sfxsync', '1', true);
    insert into sty_stock_moves (tenant_id, branch_id, variant_id, qty, kind, ref_type, note) values (new.tenant_id, mb, new.source_variant_id, diff, 'adjust', 'storefront', 'Online store stock change');
    perform set_config('auz.sfxsync', '', true);
    if tg_op = 'UPDATE' and (new.label is not distinct from old.label) and (new.price is not distinct from old.price) and (new.sku is not distinct from old.sku) then return null; end if;
  end if;
  begin perform sfx_link_pull_product(new.product_id); exception when others then null; end;
  return null;
end $$;
create or replace function sfx_link_t_coll_sfx() returns trigger language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  if sfx_link_busy() then return null; end if;
  if tg_table_name = 'sfx_collection_products' then
    select tenant_id into tid from sfx_collections where id = coalesce(new.collection_id, old.collection_id);
  else tid := coalesce(new.tenant_id, old.tenant_id); end if;
  if tid is not null then begin perform sfx_link_sync_collections(tid, false); exception when others then null; end; end if;
  return null;
end $$;

drop trigger if exists sfx_link_product on sfx_products;
create trigger sfx_link_product after insert or update or delete on sfx_products for each row execute function sfx_link_t_product();
drop trigger if exists sfx_link_sfxvariant on sfx_variants;
create trigger sfx_link_sfxvariant after insert or update or delete on sfx_variants for each row execute function sfx_link_t_sfxvariant();
drop trigger if exists sfx_link_collsfx on sfx_collections;
create trigger sfx_link_collsfx after insert or update or delete on sfx_collections for each row execute function sfx_link_t_coll_sfx();
drop trigger if exists sfx_link_collprod on sfx_collection_products;
create trigger sfx_link_collprod after insert or delete on sfx_collection_products for each row execute function sfx_link_t_coll_sfx();

-- ---------- orders: every online order lands in both ----------
create or replace function sfx_link_t_order_new() returns trigger language plpgsql security definer set search_path = public as $$
declare sid uuid; lines jsonb := '[]'::jsonb; l jsonb; sv record; col text; sz text; st text; ps text; sp text;
begin
  if sfx_link_busy() or new.sty_order_id is not null or not sfx_link_on(new.tenant_id) then return null; end if;
  for l in select * from jsonb_array_elements(new.lines) loop
    select v.source_variant_id, p.source_style_id, v.label, p.images->>0 as img into sv from sfx_variants v join sfx_products p on p.id = v.product_id where v.id = nullif(l->>'variantId', '')::uuid;
    select * into col, sz from sfx_link_split(coalesce(sv.label, l->>'label'));
    lines := lines || jsonb_build_array(jsonb_build_object('styleId', sv.source_style_id, 'variantId', sv.source_variant_id, 'name', l->>'name', 'colour', col, 'size', sz,
      'price', (l->>'price')::numeric, 'mrp', (l->>'price')::numeric, 'qty', (l->>'qty')::int, 'photo', coalesce(l->>'image', sv.img)));
  end loop;
  perform set_config('auz.sfxsync', '1', true);
  insert into sty_web_orders (tenant_id, number, token, status, payment_method, payment_status, customer, lines, subtotal, shipping, total, note, sfx_order_id, stock_taken)
    values (new.tenant_id, new.number, 'l' || new.token, case new.status when 'fulfilled' then 'delivered' else new.status end,
            case new.payment_method when 'online' then 'online' else 'cod' end, case new.payment_status when 'paid' then 'paid' when 'pending' then (case when new.payment_method = 'cod' then 'cod' else 'pending' end) else 'pending' end,
            new.customer, lines, new.subtotal, new.shipping, new.total, new.note, new.id, true)
    returning id into sid;
  update sfx_orders set sty_order_id = sid where id = new.id;
  perform set_config('auz.sfxsync', '', true);
  return null;
exception when others then perform set_config('auz.sfxsync', '', true); return null;
end $$;

create or replace function sfx_link_t_order_sty_new() returns trigger language plpgsql security definer set search_path = public as $$
declare oid uuid; lines jsonb := '[]'::jsonb; l jsonb; pid uuid; vid uuid;
begin
  if sfx_link_busy() or new.sfx_order_id is not null or not sfx_link_on(new.tenant_id) then return null; end if;
  for l in select * from jsonb_array_elements(new.lines) loop
    select v.id, v.product_id into vid, pid from sfx_variants v where v.tenant_id = new.tenant_id and v.source_variant_id = nullif(l->>'variantId', '')::uuid;
    lines := lines || jsonb_build_array(jsonb_build_object('productId', pid, 'variantId', vid, 'name', l->>'name', 'label', sfx_link_label(l->>'colour', l->>'size'),
      'price', (l->>'price')::numeric, 'qty', (l->>'qty')::int, 'image', l->>'photo'));
  end loop;
  perform set_config('auz.sfxsync', '1', true);
  insert into sfx_orders (tenant_id, number, token, status, payment_method, payment_status, customer, lines, subtotal, shipping, total, note, timeline, sty_order_id)
    values (new.tenant_id, new.number, 'l' || new.token, case new.status when 'delivered' then 'fulfilled' when 'packed' then 'confirmed' when 'shipped' then 'confirmed' else new.status end,
            case new.payment_method when 'online' then 'online' else 'cod' end, case new.payment_status when 'paid' then 'paid' else 'pending' end,
            new.customer, lines, new.subtotal, new.shipping, new.total, new.note, jsonb_build_array(jsonb_build_object('label', 'Order placed in AUZsStyle store', 'at', now())), new.id)
    returning id into oid;
  update sty_web_orders set sfx_order_id = oid where id = new.id;
  perform set_config('auz.sfxsync', '', true);
  return null;
exception when others then perform set_config('auz.sfxsync', '', true); return null;
end $$;

create or replace function sfx_link_t_order_status() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if sfx_link_busy() or new.sty_order_id is null then return null; end if;
  if new.status is distinct from old.status or new.payment_status is distinct from old.payment_status or new.tracking is distinct from old.tracking then
    perform set_config('auz.sfxsync', '1', true);
    update sty_web_orders set status = case new.status when 'fulfilled' then 'delivered' when 'returned' then 'delivered' else new.status end,
      payment_status = case when new.payment_status = 'paid' then 'paid' else payment_status end, tracking_no = coalesce(new.tracking, tracking_no), updated_at = now()
      where id = new.sty_order_id;
    perform set_config('auz.sfxsync', '', true);
  end if;
  return null;
exception when others then perform set_config('auz.sfxsync', '', true); return null;
end $$;

create or replace function sfx_link_t_order_sty_status() returns trigger language plpgsql security definer set search_path = public as $$
declare l jsonb; q int; mb uuid;
begin
  if sfx_link_busy() or not sfx_link_on(new.tenant_id) then return null; end if;
  -- billed at the till: the stock was already taken when the order came in online, so give back what the sale took
  if new.sale_id is not null and old.sale_id is null and new.stock_taken then
    mb := sty_main_branch(new.tenant_id);
    perform set_config('auz.sfxsync', '1', true);
    for l in select * from jsonb_array_elements(new.lines) loop
      q := coalesce((l->>'qty')::int, 0);
      if q > 0 and nullif(l->>'variantId', '') is not null then
        insert into sty_stock_moves (tenant_id, branch_id, variant_id, qty, kind, ref_type, ref_id, note) values (new.tenant_id, mb, (l->>'variantId')::uuid, q, 'adjust', 'storefront', new.id, 'Online order billed: stock was already taken');
        update sfx_variants set stock = sfx_link_stock((l->>'variantId')::uuid), updated_at = now() where tenant_id = new.tenant_id and source_variant_id = (l->>'variantId')::uuid;
      end if;
    end loop;
    perform set_config('auz.sfxsync', '', true);
  end if;
  -- cancelled in AUZsStyle: put the stock back (once)
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' and new.stock_taken and not new.stock_returned and new.sale_id is null then
    mb := sty_main_branch(new.tenant_id);
    perform set_config('auz.sfxsync', '1', true);
    for l in select * from jsonb_array_elements(new.lines) loop
      q := coalesce((l->>'qty')::int, 0);
      if q > 0 and nullif(l->>'variantId', '') is not null then
        insert into sty_stock_moves (tenant_id, branch_id, variant_id, qty, kind, ref_type, ref_id, note) values (new.tenant_id, mb, (l->>'variantId')::uuid, q, 'adjust', 'storefront', new.id, 'Online order cancelled');
        update sfx_variants set stock = sfx_link_stock((l->>'variantId')::uuid), updated_at = now() where tenant_id = new.tenant_id and source_variant_id = (l->>'variantId')::uuid;
      end if;
    end loop;
    update sty_web_orders set stock_returned = true where id = new.id;
    perform set_config('auz.sfxsync', '', true);
  end if;
  if new.sfx_order_id is not null and (new.status is distinct from old.status or new.payment_status is distinct from old.payment_status or new.tracking_no is distinct from old.tracking_no) then
    perform set_config('auz.sfxsync', '1', true);
    update sfx_orders set status = case new.status when 'delivered' then 'fulfilled' when 'packed' then 'confirmed' when 'shipped' then 'confirmed' else new.status end,
      payment_status = case when new.payment_status = 'paid' then 'paid' else payment_status end, tracking = coalesce(new.tracking_no, tracking),
      timeline = timeline || jsonb_build_array(jsonb_build_object('label', 'Updated in AUZsStyle: ' || new.status, 'at', now())), updated_at = now()
      where id = new.sfx_order_id;
    perform set_config('auz.sfxsync', '', true);
  end if;
  return null;
exception when others then perform set_config('auz.sfxsync', '', true); return null;
end $$;

drop trigger if exists sfx_link_order_new on sfx_orders;
create trigger sfx_link_order_new after insert on sfx_orders for each row execute function sfx_link_t_order_new();
drop trigger if exists sfx_link_order_status on sfx_orders;
create trigger sfx_link_order_status after update on sfx_orders for each row execute function sfx_link_t_order_status();
drop trigger if exists sfx_link_order_sty_new on sty_web_orders;
create trigger sfx_link_order_sty_new after insert on sty_web_orders for each row execute function sfx_link_t_order_sty_new();
drop trigger if exists sfx_link_order_sty_status on sty_web_orders;
create trigger sfx_link_order_sty_status after update on sty_web_orders for each row execute function sfx_link_t_order_sty_status();

-- ---------- turning the link on / off ----------
create or replace function sfx_style_link_status() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view'); f jsonb; st boolean;
begin
  select features into f from tenant_settings where tenant_id = tid;
  select style_linked into st from sfx_stores where tenant_id = tid;
  return jsonb_build_object('available', coalesce((f->>'style')::boolean, false) and coalesce((f->>'storefront')::boolean, false), 'linked', coalesce(st, false),
    'styles', (select count(*) from sty_styles where tenant_id = tid and active), 'products', (select count(*) from sfx_products where tenant_id = tid and source_style_id is not null));
end $$;

create or replace function sfx_style_link_set(p_on boolean) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); f jsonb; s record; p record; n int := 0;
begin
  select features into f from tenant_settings where tenant_id = tid;
  if p_on and not (coalesce((f->>'style')::boolean, false) and coalesce((f->>'storefront')::boolean, false)) then
    raise exception 'Both AUZsStyle and the Storefront must be on for this business to link them.' using errcode = 'SF002';
  end if;
  insert into sfx_stores (tenant_id) values (tid) on conflict (tenant_id) do nothing;
  update sfx_stores set style_linked = p_on where tenant_id = tid;
  if p_on then
    -- AUZsStyle is the source of truth for what already exists: copy every style across, then bring over products that only exist online
    for s in select id from sty_styles where tenant_id = tid order by created_at loop perform sfx_link_push_style(s.id); n := n + 1; end loop;
    for p in select id from sfx_products where tenant_id = tid and source_style_id is null loop perform sfx_link_pull_product(p.id); end loop;
    perform sfx_link_sync_collections(tid, true);
    perform sfx_link_sync_collections(tid, false);
  end if;
  return jsonb_build_object('linked', p_on, 'styles', n);
end $$;

-- ---------- tags in AUZsStyle ----------
alter function sty_style_json(uuid, uuid, uuid, boolean) rename to sty_style_json_pre403;
create function sty_style_json(tid uuid, sid uuid, b uuid, see_cost boolean) returns jsonb language sql stable security definer set search_path = public as $$
  select sty_style_json_pre403(tid, sid, b, see_cost) || jsonb_build_object('tags', to_jsonb(coalesce((select tags from sty_styles where id = sid and tenant_id = tid), '{}')))
$$;

create or replace function sty_set_tags(p_id uuid, p_tags text[]) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; t text[];
begin
  tid := sty_guard('sty_manage');
  select coalesce(array_agg(x), '{}') into t from (select distinct left(trim(x), 40) as x from unnest(coalesce(p_tags, '{}')) x where trim(x) <> '' limit 30) q;
  update sty_styles set tags = t, updated_at = now() where id = p_id and tenant_id = tid;
  if not found then raise exception 'style not found' using errcode = 'ST002'; end if;
  return sty_style_json(tid, p_id, null, true);
end $$;

grant execute on function sfx_style_link_status() to app;
grant execute on function sfx_style_link_set(boolean) to app;
grant execute on function sty_set_tags(uuid, text[]) to app;
