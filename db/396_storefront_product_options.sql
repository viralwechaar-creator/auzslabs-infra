-- Product options (for example Material: Silver, Gold and Finish: Matte, Gloss) are kept with the product's extra details.
-- The variants themselves stay in sfx_variants (label, SKU, barcode, price, stock); options remember how they were generated.
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
    end if;
  end loop;
  update sfx_products set extra = cur, updated_at = now() where id = p_id and tenant_id = tid;
end $$;
