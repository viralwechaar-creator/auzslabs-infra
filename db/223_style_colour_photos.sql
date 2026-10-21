-- AUZsStyle: a picture set per colour. The till and the e-commerce site switch pictures when a colour is picked.
alter table sty_styles add column if not exists colour_photos jsonb not null default '{}'::jsonb;

create or replace function sty_style_json(tid uuid, sid uuid, b uuid, see_cost boolean) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', s.id, 'name', s.name, 'category', s.category, 'subcategory', s.subcategory, 'brand', s.brand,
    'season', s.season, 'gender', s.gender, 'description', s.description, 'details', s.details, 'fabric', s.fabric, 'washcare', s.washcare, 'weightG', s.weight_g, 'code', s.code, 'photos', coalesce(s.photos, '[]'::jsonb), 'colourPhotos', coalesce(s.colour_photos, '{}'::jsonb), 'collection', s.collection, 'hsn', s.hsn, 'taxPct', s.tax_pct, 'price', s.price, 'mrp', s.mrp,
    'cost', case when see_cost then s.cost end, 'photoUrl', s.photo_url, 'notes', s.notes, 'active', s.active,
    'variants', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'colour', v.colour, 'size', v.size, 'barcode', v.barcode, 'sku', v.sku,
        'price', coalesce(v.price, s.price), 'cost', case when see_cost then v.cost end, 'reorderAt', v.reorder_at, 'active', v.active,
        'stock', coalesce(m.q, 0), 'dmg', coalesce(m.d, 0)) order by v.colour, v.size)
      from sty_variants v
      left join (select variant_id, sum(qty)::int q, sum(dmg)::int d from sty_stock_moves where tenant_id = tid and (b is null or branch_id = b) group by variant_id) m on m.variant_id = v.id
      where v.style_id = s.id), '[]'::jsonb))
  from sty_styles s where s.id = sid and s.tenant_id = tid
$$;

-- p = { "Black": ["url main", "url 2"], "Navy": [...] }  (colours with no pictures are left out)
create or replace function sty_set_colour_photos(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; k text; clean jsonb := '{}'::jsonb;
begin
  tid := sty_guard('sty_manage');
  if jsonb_typeof(coalesce(p, '{}'::jsonb)) <> 'object' then raise exception 'colour pictures must be an object' using errcode = 'ST002'; end if;
  for k in select jsonb_object_keys(coalesce(p, '{}'::jsonb)) loop
    if jsonb_typeof(p->k) = 'array' and jsonb_array_length(p->k) > 0 then clean := clean || jsonb_build_object(left(k, 60), (select jsonb_agg(u) from (select jsonb_array_elements_text(p->k) u limit 8) x)); end if;
  end loop;
  update sty_styles set colour_photos = clean, updated_at = now() where id = p_id and tenant_id = tid;
  if not found then raise exception 'style not found' using errcode = 'ST002'; end if;
  return sty_style_json(tid, p_id, null, true);
end $$;
