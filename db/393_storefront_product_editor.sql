-- Product editor extras (cost, tax code, vendor, type, SEO ...) live in one jsonb column; bulk edit for the products list.
alter table sfx_products add column if not exists extra jsonb not null default '{}'::jsonb;

create or replace function sfx_product_json(p sfx_products) returns jsonb language sql stable as $$
  select jsonb_build_object('id', p.id, 'name', p.name, 'handle', p.handle, 'category', p.category, 'description', p.description,
    'images', coalesce(p.images, '[]'::jsonb), 'status', p.status, 'price', p.price, 'compareAt', p.compare_at,
    'variants', coalesce((select jsonb_agg(sfx_variant_json(v) order by v.position, v.created_at) from sfx_variants v where v.product_id = p.id), '[]'::jsonb),
    'stock', coalesce((select sum(v.stock) from sfx_variants v where v.product_id = p.id), 0),
    'extra', coalesce(p.extra, '{}'::jsonb),
    'createdAt', p.created_at, 'updatedAt', p.updated_at)
$$;

create or replace function sfx_product_extra_save(p_id uuid, p jsonb) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); k text; cur jsonb; keys text[] := array['cost', 'hsn', 'vendor', 'type', 'seoTitle', 'seoDescription', 'weight', 'origin', 'taxable', 'mainIndex'];
begin
  if jsonb_typeof(p) <> 'object' then raise exception 'Invalid details' using errcode = 'SF002'; end if;
  select coalesce(extra, '{}'::jsonb) into cur from sfx_products where id = p_id and tenant_id = tid;
  if not found then raise exception 'Product not found' using errcode = 'SF003'; end if;
  for k in select jsonb_object_keys(p) loop
    if k = any(keys) then
      if length(coalesce(p->>k, '')) > 600 then raise exception 'That value is too long' using errcode = 'SF002'; end if;
      cur := cur || jsonb_build_object(k, p->k);
    end if;
  end loop;
  update sfx_products set extra = cur, updated_at = now() where id = p_id and tenant_id = tid;
end $$;

-- p = { status?, category?, pricePct? (e.g. -10 or 5), archive? }. Applies to up to 200 products.
create or replace function sfx_product_bulk(p_ids uuid[], p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); n int := 0; pct numeric := nullif(p->>'pricePct', '')::numeric; st text := nullif(p->>'status', ''); cat text := nullif(trim(coalesce(p->>'category', '')), '');
begin
  if p_ids is null or cardinality(p_ids) = 0 then raise exception 'Select at least one product' using errcode = 'SF002'; end if;
  if cardinality(p_ids) > 200 then raise exception 'Select up to 200 products at a time' using errcode = 'SF002'; end if;
  if st is not null and st not in ('draft', 'active', 'archived') then raise exception 'Invalid status' using errcode = 'SF002'; end if;
  if pct is not null and (pct < -90 or pct > 500) then raise exception 'Price change must be between -90%% and +500%%' using errcode = 'SF002'; end if;
  if st is null and cat is null and pct is null then raise exception 'Choose something to change' using errcode = 'SF002'; end if;
  update sfx_products set status = coalesce(st, status), category = coalesce(cat, category),
    price = case when pct is null then price else round(price * (1 + pct / 100), 2) end,
    compare_at = case when pct is null or compare_at is null then compare_at else round(compare_at * (1 + pct / 100), 2) end, updated_at = now()
    where tenant_id = tid and id = any(p_ids);
  get diagnostics n = row_count;
  if pct is not null then
    update sfx_variants set price = round(price * (1 + pct / 100), 2), updated_at = now() where tenant_id = tid and product_id = any(p_ids);
  end if;
  return jsonb_build_object('updated', n);
end $$;
