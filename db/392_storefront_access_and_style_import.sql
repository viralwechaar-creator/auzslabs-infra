-- 1) Turning the storefront on for a business (Admin -> Clients -> Edit) makes its store row active at once, so the 3-day trial gate never pauses it.
create or replace function sfx_on_features_change() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(new.features->>'storefront', 'false') = 'true' and coalesce(old.features->>'storefront', 'false') <> 'true' then
    insert into sfx_stores (tenant_id, plan_status) values (new.tenant_id, 'active')
      on conflict (tenant_id) do update set plan_status = 'active', updated_at = now() where sfx_stores.plan_status in ('trial', 'paused');
  end if;
  return new;
end $$;
drop trigger if exists tenant_settings_sfx_access on tenant_settings;
create trigger tenant_settings_sfx_access after update of features on tenant_settings for each row execute function sfx_on_features_change();

-- 2) Build the online store from the business's AUZsStyle catalogue.
alter table sfx_products add column if not exists source_style_id uuid;
create unique index if not exists idx_sfx_products_style on sfx_products (tenant_id, source_style_id) where source_style_id is not null;

create or replace function sfx_import_from_style() returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); s record; v record; pid uuid; made int := 0; upd int := 0; vars int := 0; slug_ text; vid uuid; stock_ int; pos_ int; had boolean;
begin
  if not exists (select 1 from sty_styles where tenant_id = tid and active) then raise exception 'No AUZsStyle products were found for this business.' using errcode = 'SF002'; end if;
  for s in select * from sty_styles where tenant_id = tid and active order by created_at loop
    slug_ := coalesce(nullif(trim(both '-' from regexp_replace(lower(s.name), '[^a-z0-9]+', '-', 'g')), ''), 'item') || '-' || left(s.id::text, 4);
    select id into pid from sfx_products where tenant_id = tid and source_style_id = s.id; had := pid is not null;
    if had then
      update sfx_products set name = left(s.name, 200), category = s.category, description = s.notes, images = case when nullif(s.photo_url, '') is null then images else jsonb_build_array(s.photo_url) end,
        price = s.price, compare_at = case when s.mrp > s.price then s.mrp end, updated_at = now() where id = pid;
      upd := upd + 1;
    else
      insert into sfx_products (tenant_id, name, handle, category, description, images, status, price, compare_at, source_style_id)
        values (tid, left(s.name, 200), slug_, s.category, s.notes, case when nullif(s.photo_url, '') is null then '[]'::jsonb else jsonb_build_array(s.photo_url) end, 'active', s.price, case when s.mrp > s.price then s.mrp end, s.id)
        returning id into pid;
      made := made + 1;
    end if;
    pos_ := 0;
    for v in select * from sty_variants where tenant_id = tid and style_id = s.id and active order by colour, size loop
      stock_ := greatest(coalesce((select sum(qty) from sty_stock_moves where tenant_id = tid and variant_id = v.id), 0), 0)::int;
      select id into vid from sfx_variants where product_id = pid and barcode = v.barcode;
      if vid is null then
        insert into sfx_variants (tenant_id, product_id, label, sku, barcode, price, stock, position)
          values (tid, pid, coalesce(left(nullif(concat_ws(' / ', nullif(v.colour, ''), nullif(v.size, '')), ''), 80), 'Default'), v.sku, v.barcode, coalesce(v.price, s.price), stock_, pos_);
      else
        update sfx_variants set price = coalesce(v.price, s.price), stock = stock_, sku = v.sku, updated_at = now() where id = vid;
      end if;
      vars := vars + 1; pos_ := pos_ + 1;
    end loop;
  end loop;
  return jsonb_build_object('created', made, 'updated', upd, 'variants', vars);
end $$;
