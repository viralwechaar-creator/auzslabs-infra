-- Product editor extras: typed custom-field values on a product, and collection membership from the product page.
create or replace function sfx_product_extra_save(p_id uuid, p jsonb) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); k text; cur jsonb; keys text[] := array['cost', 'hsn', 'vendor', 'type', 'seoTitle', 'seoDescription', 'weight', 'origin', 'taxable', 'mainIndex'];
  o jsonb; v jsonb; n int := 0; m int;
begin
  if jsonb_typeof(p) <> 'object' then raise exception 'Invalid details' using errcode = 'SF002'; end if;
  select coalesce(extra, '{}'::jsonb) into cur from sfx_products where id = p_id and tenant_id = tid;
  if not found then raise exception 'Product not found' using errcode = 'SF003'; end if;
  for k in select jsonb_object_keys(p) loop
    if k = any(keys) then
      if length(coalesce(p->>k, '')) > 600 then raise exception 'That value is too long' using errcode = 'SF002'; end if;
      cur := cur || jsonb_build_object(k, p->k);
    elsif k = 'options' then
      if jsonb_typeof(p->k) <> 'array' or jsonb_array_length(p->k) > 3 then raise exception 'Use up to 3 options' using errcode = 'SF002'; end if;
      for o in select * from jsonb_array_elements(p->k) loop
        if jsonb_typeof(o) <> 'object' or length(trim(coalesce(o->>'name', ''))) not between 1 and 40 or jsonb_typeof(o->'values') <> 'array' then raise exception 'Each option needs a name and a list of values' using errcode = 'SF002'; end if;
        m := jsonb_array_length(o->'values');
        if m < 1 or m > 20 then raise exception 'Each option needs 1 to 20 values' using errcode = 'SF002'; end if;
        for v in select * from jsonb_array_elements(o->'values') loop
          if jsonb_typeof(v) <> 'string' or length(trim(v #>> '{}')) not between 1 and 40 then raise exception 'Option values must be text up to 40 characters' using errcode = 'SF002'; end if;
        end loop;
      end loop;
      cur := cur || jsonb_build_object('options', p->k);
    elsif k = 'custom' then
      if jsonb_typeof(p->k) <> 'object' then raise exception 'Custom fields must be an object' using errcode = 'SF002'; end if;
      if (select count(*) from jsonb_object_keys(p->k)) > 30 then raise exception 'Up to 30 custom fields per product' using errcode = 'SF002'; end if;
      for v in select value from jsonb_each(p->k) loop
        if jsonb_typeof(v) not in ('string', 'null') or length(coalesce(v #>> '{}', '')) > 600 then raise exception 'Custom field values must be text up to 600 characters' using errcode = 'SF002'; end if;
      end loop;
      cur := cur || jsonb_build_object('custom', p->k);
    end if;
  end loop;
  update sfx_products set extra = cur, updated_at = now() where id = p_id and tenant_id = tid;
end $$;

create or replace function sfx_collection_memberships() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin
  return coalesce((select jsonb_object_agg(pid, cids) from (
    select cp.product_id::text as pid, jsonb_agg(cp.collection_id) as cids
    from sfx_collection_products cp join sfx_collections c on c.id = cp.collection_id
    where c.tenant_id = tid group by cp.product_id) x), '{}'::jsonb);
end $$;

create or replace function sfx_product_set_collections(p_id uuid, p_collections text) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); ids uuid[] := '{}'; x text; cid uuid; pos int;
begin
  if not exists (select 1 from sfx_products where id = p_id and tenant_id = tid) then raise exception 'Product not found' using errcode = 'SF003'; end if;
  for x in select trim(v) from unnest(string_to_array(coalesce(p_collections, ''), ',')) v loop
    if x ~ '^[0-9a-fA-F-]{36}$' then ids := ids || x::uuid; end if;
  end loop;
  if coalesce(array_length(ids, 1), 0) > 50 then raise exception 'Up to 50 collections per product' using errcode = 'SF002'; end if;
  delete from sfx_collection_products cp using sfx_collections c where cp.collection_id = c.id and c.tenant_id = tid and cp.product_id = p_id and not (cp.collection_id = any(ids));
  foreach cid in array ids loop
    if exists (select 1 from sfx_collections where id = cid and tenant_id = tid) then
      select coalesce(max(position), -1) + 1 into pos from sfx_collection_products where collection_id = cid;
      insert into sfx_collection_products (collection_id, product_id, position) values (cid, p_id, pos) on conflict do nothing;
    end if;
  end loop;
end $$;

-- Real data-loss fix: saving a product's details or photos used to replace all its variants with one blank Default row.
create or replace function sfx_product_save(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); row_ sfx_products; name_ text := trim(coalesce(p->>'name', '')); handle_ text;
  vs jsonb; v jsonb; keep uuid[] := '{}'; vid uuid; status_ text := coalesce(p->>'status', 'draft');
begin
  if length(name_) < 1 or length(name_) > 160 then raise exception 'Enter a product title' using errcode = 'SF002'; end if;
  if status_ not in ('draft', 'active', 'archived') then raise exception 'Invalid status' using errcode = 'SF002'; end if;
  handle_ := nullif(regexp_replace(lower(coalesce(p->>'handle', name_)), '[^a-z0-9]+', '-', 'g'), '');
  handle_ := nullif(trim(both '-' from coalesce(handle_, '')), '');
  if p_id is not null then
    select * into row_ from sfx_products where id = p_id and tenant_id = tid;
    if not found then raise exception 'Product not found' using errcode = 'SF003'; end if;
  end if;
  if handle_ is not null and exists(select 1 from sfx_products where tenant_id = tid and handle = handle_ and id is distinct from p_id) then
    handle_ := handle_ || '-' || substr(md5(random()::text), 1, 5);
  end if;
  if p_id is null then
    insert into sfx_products (tenant_id, name, handle, category, description, images, status, price, compare_at)
      values (tid, name_, handle_, nullif(p->>'category', ''), nullif(p->>'description', ''), coalesce(p->'images', '[]'::jsonb), status_,
        coalesce((p->>'price')::numeric, 0), nullif(p->>'compareAt', '')::numeric)
      returning * into row_;
  else
    update sfx_products set name = name_, handle = handle_, category = nullif(p->>'category', ''), description = nullif(p->>'description', ''),
      images = coalesce(p->'images', images), status = status_, price = coalesce((p->>'price')::numeric, price), compare_at = nullif(p->>'compareAt', '')::numeric,
      updated_at = now()
      where id = p_id and tenant_id = tid returning * into row_;
  end if;
  vs := coalesce(p->'variants', '[]'::jsonb);
  -- Saving details or photos without sending variants must never replace the real variants with a blank "Default" row (db/397).
  if (p_id is not null) and not (p ? 'variants') and exists (select 1 from sfx_variants where product_id = row_.id) then
    if p ? 'price' and (select count(*) from sfx_variants where product_id = row_.id) = 1 then
      update sfx_variants set price = coalesce((p->>'price')::numeric, price), updated_at = now() where product_id = row_.id;
    end if;
    vs := '[]'::jsonb;
  else
  if jsonb_typeof(vs) <> 'array' or jsonb_array_length(vs) = 0 then
    vs := jsonb_build_array(jsonb_build_object('label', 'Default', 'sku', p->>'sku', 'price', coalesce(p->>'price', '0'), 'stock', coalesce(p->>'stock', '0')));
  end if;
  if jsonb_array_length(vs) > 100 then raise exception 'Too many variants on one product' using errcode = 'SF002'; end if;
  for v in select * from jsonb_array_elements(vs) loop
    if trim(coalesce(v->>'label', '')) = '' then raise exception 'Each variant needs a label' using errcode = 'SF002'; end if;
    if coalesce((v->>'price')::numeric, 0) < 0 or coalesce((v->>'stock')::int, 0) < 0 then raise exception 'Price and stock cannot be negative' using errcode = 'SF002'; end if;
    vid := nullif(v->>'id', '')::uuid;
    if vid is not null and exists(select 1 from sfx_variants where id = vid and product_id = row_.id) then
      update sfx_variants set label = v->>'label', sku = nullif(v->>'sku', ''), barcode = nullif(v->>'barcode', ''),
        price = coalesce((v->>'price')::numeric, 0), stock = coalesce((v->>'stock')::int, 0), updated_at = now() where id = vid;
      keep := keep || vid;
    else
      insert into sfx_variants (tenant_id, product_id, label, sku, barcode, price, stock, position)
        values (tid, row_.id, v->>'label', nullif(v->>'sku', ''), nullif(v->>'barcode', ''), coalesce((v->>'price')::numeric, 0), coalesce((v->>'stock')::int, 0), coalesce((v->>'position')::int, 0))
        returning id into vid;
      keep := keep || vid;
    end if;
  end loop;
  delete from sfx_variants where product_id = row_.id and not (id = any(keep));
  end if;
  select price into row_.price from sfx_variants where product_id = row_.id order by position limit 1;
  if row_.price is not null then update sfx_products set price = row_.price where id = row_.id; end if;
  select * into row_ from sfx_products where id = row_.id;
  return sfx_product_json(row_);
end $$;
