-- Editing the price of a product whose variants all share one price (every AUZsStyle import) now changes all of them.
-- Before, a product with more than one variant silently kept the old price while saying 'Product updated'.
-- Rollback: re-run sfx_product_save from db/397.
create or replace function sfx_product_save(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); row_ sfx_products; name_ text := trim(coalesce(p->>'name', '')); handle_ text;
  vs jsonb; v jsonb; same_price boolean := false; keep uuid[] := '{}'; vid uuid; status_ text := coalesce(p->>'status', 'draft');
begin
  if length(name_) < 1 or length(name_) > 160 then raise exception 'Enter a product title' using errcode = 'SF002'; end if;
  if status_ not in ('draft', 'active', 'archived') then raise exception 'Invalid status' using errcode = 'SF002'; end if;
  handle_ := nullif(regexp_replace(lower(coalesce(p->>'handle', name_)), '[^a-z0-9]+', '-', 'g'), '');
  handle_ := nullif(trim(both '-' from coalesce(handle_, '')), '');
  if p_id is not null then
    select * into row_ from sfx_products where id = p_id and tenant_id = tid;
    if not found then raise exception 'Product not found' using errcode = 'SF003'; end if;
  end if;
  if p_id is not null then select count(distinct price) <= 1 into same_price from sfx_variants where product_id = p_id; end if;
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
    if p ? 'price' and same_price then
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
