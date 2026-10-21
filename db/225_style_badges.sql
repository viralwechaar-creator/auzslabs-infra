-- AUZsStyle: show a style as "Limited stock" (exclusivity, display only) or "Sold out" (cannot be added to a bill).
alter table sty_styles add column if not exists badge text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'sty_styles_badge_chk') then
    alter table sty_styles add constraint sty_styles_badge_chk check (badge is null or badge in ('limited', 'soldout'));
  end if;
end $$;

create or replace function sty_style_json(tid uuid, sid uuid, b uuid, see_cost boolean) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', s.id, 'name', s.name, 'category', s.category, 'subcategory', s.subcategory, 'brand', s.brand,
    'season', s.season, 'gender', s.gender, 'description', s.description, 'details', s.details, 'fabric', s.fabric, 'washcare', s.washcare, 'weightG', s.weight_g, 'code', s.code, 'photos', coalesce(s.photos, '[]'::jsonb), 'badge', s.badge, 'colourPhotos', coalesce(s.colour_photos, '{}'::jsonb), 'collection', s.collection, 'hsn', s.hsn, 'taxPct', s.tax_pct, 'price', s.price, 'mrp', s.mrp,
    'cost', case when see_cost then s.cost end, 'photoUrl', s.photo_url, 'notes', s.notes, 'active', s.active,
    'variants', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'colour', v.colour, 'size', v.size, 'barcode', v.barcode, 'sku', v.sku,
        'price', coalesce(v.price, s.price), 'cost', case when see_cost then v.cost end, 'reorderAt', v.reorder_at, 'active', v.active,
        'stock', coalesce(m.q, 0), 'dmg', coalesce(m.d, 0)) order by v.colour, v.size)
      from sty_variants v
      left join (select variant_id, sum(qty)::int q, sum(dmg)::int d from sty_stock_moves where tenant_id = tid and (b is null or branch_id = b) group by variant_id) m on m.variant_id = v.id
      where v.style_id = s.id), '[]'::jsonb))
  from sty_styles s where s.id = sid and s.tenant_id = tid
$$;

create or replace function sty_set_badge(p_id uuid, p_badge text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; b text := nullif(trim(coalesce(p_badge, '')), '');
begin
  tid := sty_guard('sty_manage');
  if b is not null and b not in ('limited', 'soldout') then raise exception 'badge must be limited or soldout' using errcode = 'ST002'; end if;
  update sty_styles set badge = b, updated_at = now() where id = p_id and tenant_id = tid;
  if not found then raise exception 'style not found' using errcode = 'ST002'; end if;
  perform sty_audit_log(tid, 'style_badge', p_id::text, jsonb_build_object('badge', b));
  return sty_style_json(tid, p_id, null, true);
end $$;
