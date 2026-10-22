-- AUZsStyle store: a picture for each collection, and choosing which of a style's pictures shows where
-- (product card, home hero, collection banner). Display choices only: nothing about stock, price or billing changes.
alter table sty_collections add column if not exists image text;
alter table sty_styles add column if not exists photo_use jsonb not null default '{}'::jsonb;

create or replace function sty_style_json(tid uuid, sid uuid, b uuid, see_cost boolean) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', s.id, 'name', s.name, 'category', s.category, 'subcategory', s.subcategory, 'brand', s.brand,
    'season', s.season, 'gender', s.gender, 'description', s.description, 'details', s.details, 'fabric', s.fabric, 'washcare', s.washcare, 'weightG', s.weight_g, 'code', s.code, 'photos', coalesce(s.photos, '[]'::jsonb), 'badge', s.badge, 'colourPhotos', coalesce(s.colour_photos, '{}'::jsonb), 'photoUse', coalesce(s.photo_use, '{}'::jsonb), 'collection', s.collection, 'hsn', s.hsn, 'taxPct', s.tax_pct, 'price', s.price, 'mrp', s.mrp,
    'cost', case when see_cost then s.cost end, 'photoUrl', s.photo_url, 'notes', s.notes, 'active', s.active,
    'variants', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'colour', v.colour, 'size', v.size, 'barcode', v.barcode, 'sku', v.sku,
        'price', coalesce(v.price, s.price), 'cost', case when see_cost then v.cost end, 'reorderAt', v.reorder_at, 'active', v.active,
        'stock', coalesce(m.q, 0), 'dmg', coalesce(m.d, 0)) order by v.colour, v.size)
      from sty_variants v
      left join (select variant_id, sum(qty)::int q, sum(dmg)::int d from sty_stock_moves where tenant_id = tid and (b is null or branch_id = b) group by variant_id) m on m.variant_id = v.id
      where v.style_id = s.id), '[]'::jsonb))
  from sty_styles s where s.id = sid and s.tenant_id = tid
$$;

create or replace function sty_collections_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_guard('sty_view');
  return coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'note', c.note, 'image', c.image,
      'styleIds', coalesce((select jsonb_agg(m.style_id) from sty_collection_styles m where m.collection_id = c.id), '[]'::jsonb)) order by lower(c.name))
    from sty_collections c where c.tenant_id = tid), '[]'::jsonb);
end $$;

create or replace function sty_collection_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; cid uuid := nullif(p->>'id', '')::uuid; nm text := nullif(trim(coalesce(p->>'name', '')), '');
begin
  tid := sty_guard('sty_manage');
  if nm is null then raise exception 'Give the collection a name' using errcode = 'ST002'; end if;
  begin
    if cid is null then
      insert into sty_collections (tenant_id, name, note, image) values (tid, nm, nullif(trim(coalesce(p->>'note', '')), ''), nullif(trim(coalesce(p->>'image', '')), '')) returning id into cid;
    else
      update sty_collections set name = nm, note = case when p ? 'note' then nullif(trim(coalesce(p->>'note', '')), '') else note end, image = case when p ? 'image' then nullif(trim(coalesce(p->>'image', '')), '') else image end where id = cid and tenant_id = tid;
      if not found then raise exception 'collection not found' using errcode = 'ST002'; end if;
    end if;
  exception when unique_violation then raise exception 'A collection with that name already exists' using errcode = 'ST002';
  end;
  perform sty_audit_log(tid, 'collection_save', cid::text, jsonb_build_object('name', nm));
  return jsonb_build_object('id', cid, 'name', nm);
end $$;

-- p = { card?, hero?, banner? }: each is one of the style's own pictures; an empty value goes back to the default
create or replace function sty_set_photo_use(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; s sty_styles; use jsonb; k text; v text;
begin
  tid := sty_guard('sty_manage');
  select * into s from sty_styles where id = p_id and tenant_id = tid;
  if not found then raise exception 'style not found' using errcode = 'ST002'; end if;
  use := coalesce(s.photo_use, '{}'::jsonb);
  foreach k in array array['card', 'hero', 'banner'] loop
    if p ? k then
      v := nullif(trim(coalesce(p->>k, '')), '');
      if v is null then use := use - k;
      elsif s.photo_url = v or coalesce(s.photos, '[]'::jsonb) ? v
        or exists (select 1 from jsonb_each(coalesce(s.colour_photos, '{}'::jsonb)) e, jsonb_array_elements_text(e.value) x where x = v) then
        use := use || jsonb_build_object(k, v);
      end if;
    end if;
  end loop;
  update sty_styles set photo_use = use, updated_at = now() where id = p_id;
  perform sty_audit_log(tid, 'style_photo_use', p_id::text, use);
  return sty_style_json(tid, p_id, null, true);
end $$;

create or replace function public_sty_store(p_slug text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; st sty_settings; cfg jsonb; tn text; feat jsonb;
begin
  tid := sty_public_tenant(p_slug);
  if tid is null then return null; end if;
  select * into st from sty_settings where tenant_id = tid;
  select config into cfg from sty_store where tenant_id = tid;
  cfg := coalesce(cfg, '{}'::jsonb) - 'payReqAt';
  if coalesce((cfg->>'on')::boolean, false) is not true then return jsonb_build_object('closed', true, 'name', coalesce(nullif(st.shop_name, ''), (select name from tenants where id = tid))); end if;
  select name into tn from tenants where id = tid;
  feat := coalesce(st.features, '{}'::jsonb);
  return jsonb_build_object(
    'shop', jsonb_build_object('name', coalesce(nullif(cfg->>'brandName', ''), nullif(st.shop_name, ''), tn, 'Shop'), 'address', st.address, 'phone', coalesce(nullif(cfg->>'phone', ''), st.phone),
      'logoUrl', st.logo_url, 'returnDays', st.return_days),
    'config', cfg - 'payReq',
    'upi', case when coalesce((cfg->'pay'->>'upi')::boolean, true) and coalesce(feat->>'upiId', '') <> '' then jsonb_build_object('id', feat->>'upiId', 'name', coalesce(nullif(feat->>'upiName', ''), coalesce(nullif(st.shop_name, ''), tn))) end,
    'cod', coalesce((cfg->'pay'->>'cod')::boolean, true),
    'styles', coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'category', s.category, 'subcategory', s.subcategory, 'brand', s.brand,
        'season', s.season, 'gender', s.gender, 'description', s.description, 'details', s.details, 'fabric', s.fabric, 'washcare', s.washcare, 'weightG', s.weight_g,
        'code', s.code, 'photos', coalesce(s.photos, '[]'::jsonb), 'colourPhotos', coalesce(s.colour_photos, '{}'::jsonb), 'photoUse', coalesce(s.photo_use, '{}'::jsonb), 'photoUrl', s.photo_url,
        'collection', s.collection, 'price', s.price, 'mrp', s.mrp, 'badge', s.badge, 'createdAt', s.created_at,
        'variants', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'colour', v.colour, 'size', v.size, 'price', coalesce(v.price, s.price),
            'left', least(greatest(coalesce((select sum(m.qty) from sty_stock_moves m where m.variant_id = v.id and m.tenant_id = tid), 0), 0), 9)::int) order by v.colour, v.size)
          from sty_variants v where v.style_id = s.id and v.active), '[]'::jsonb)) order by s.created_at desc)
      from sty_styles s where s.tenant_id = tid and s.active), '[]'::jsonb),
    'collections', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'note', c.note, 'image', c.image,
        'styleIds', coalesce((select jsonb_agg(m.style_id) from sty_collection_styles m where m.collection_id = c.id), '[]'::jsonb)) order by lower(c.name))
      from sty_collections c where c.tenant_id = tid), '[]'::jsonb));
end $$;
