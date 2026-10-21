-- AUZsStyle: richer product details (description, details, fabric, wash care, weight, collection) and grouping by
-- colour / type / fabric / collection in analytics.
alter table sty_styles add column if not exists description text, add column if not exists details text, add column if not exists fabric text,
  add column if not exists washcare text, add column if not exists weight_g numeric(8,1), add column if not exists collection text;
create index if not exists sty_styles_fab on sty_styles(tenant_id, fabric);
create index if not exists sty_styles_col on sty_styles(tenant_id, collection);

create or replace function sty_style_json(tid uuid, sid uuid, b uuid, see_cost boolean) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', s.id, 'name', s.name, 'category', s.category, 'subcategory', s.subcategory, 'brand', s.brand,
    'season', s.season, 'gender', s.gender, 'description', s.description, 'details', s.details, 'fabric', s.fabric, 'washcare', s.washcare, 'weightG', s.weight_g, 'collection', s.collection, 'hsn', s.hsn, 'taxPct', s.tax_pct, 'price', s.price, 'mrp', s.mrp,
    'cost', case when see_cost then s.cost end, 'photoUrl', s.photo_url, 'notes', s.notes, 'active', s.active,
    'variants', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'colour', v.colour, 'size', v.size, 'barcode', v.barcode, 'sku', v.sku,
        'price', coalesce(v.price, s.price), 'cost', case when see_cost then v.cost end, 'reorderAt', v.reorder_at, 'active', v.active,
        'stock', coalesce(m.q, 0), 'dmg', coalesce(m.d, 0)) order by v.colour, v.size)
      from sty_variants v
      left join (select variant_id, sum(qty)::int q, sum(dmg)::int d from sty_stock_moves where tenant_id = tid and (b is null or branch_id = b) group by variant_id) m on m.variant_id = v.id
      where v.style_id = s.id), '[]'::jsonb))
  from sty_styles s where s.id = sid and s.tenant_id = tid
$$;

create or replace function sty_save_style(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; sid uuid; c text; z text; vid uuid; b uuid; oq int; uc numeric; cols jsonb; szs jsonb; v_exists uuid;
begin
  tid := sty_guard('sty_manage');
  sid := nullif(p->>'id', '')::uuid;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Give the style a name' using errcode = 'ST002'; end if;
  if sid is null then
    insert into sty_styles (tenant_id, name, category, subcategory, brand, season, gender, hsn, tax_pct, cost, price, mrp, notes, photo_url, active, created_by, description, details, fabric, washcare, weight_g, collection)
    values (tid, trim(p->>'name'), coalesce(nullif(p->>'category', ''), 'Clothing'), p->>'subcategory', p->>'brand', p->>'season', p->>'gender', p->>'hsn',
      nullif(p->>'taxPct', '')::numeric, coalesce(nullif(p->>'cost', '')::numeric, 0), coalesce(nullif(p->>'price', '')::numeric, 0),
      coalesce(nullif(p->>'mrp', '')::numeric, nullif(p->>'price', '')::numeric, 0), p->>'notes', p->>'photoUrl', coalesce((p->>'active')::boolean, true), app_uid(), p->>'description', p->>'details', p->>'fabric', p->>'washcare', nullif(p->>'weightG','')::numeric, p->>'collection')
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
      select id into v_exists from sty_variants where tenant_id = tid and style_id = sid and colour = trim(c) and size = trim(z);
      if v_exists is null then
        insert into sty_variants (tenant_id, style_id, colour, size, barcode, cost, reorder_at)
        values (tid, sid, trim(c), trim(z), sty_barcode(tid), uc, coalesce(nullif(p->>'reorderAt', '')::int, 2)) returning id into vid;
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

-- sales grouped by product attributes (type = subcategory). p: {from, to, branchId}
create or replace function sty_analytics_groups(p jsonb default '{}'::jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; d1 date; d2 date; b uuid; r jsonb := '{}'::jsonb; k text; j jsonb;
begin
  tid := sty_guard('sty_reports');
  d1 := coalesce(nullif(p->>'from', '')::date, sty_today() - 29); d2 := coalesce(nullif(p->>'to', '')::date, sty_today()); b := nullif(p->>'branchId', '')::uuid;
  foreach k in array array['subcategory', 'fabric', 'collection', 'brand', 'gender'] loop
    execute format($f$select coalesce(jsonb_agg(row_to_json(x) order by x.units desc), '[]'::jsonb) from (
        select g.name, g.units, g.revenue, g.profit, g.styles,
               coalesce((select sum(m.qty) from sty_stock_moves m join sty_variants v on v.id = m.variant_id join sty_styles s2 on s2.id = v.style_id
                         where m.tenant_id = $1 and coalesce(nullif(s2.%1$I, ''), 'Not set') = g.name and ($4 is null or m.branch_id = $4)), 0)::int stock
        from (select coalesce(nullif(st.%1$I, ''), 'Not set') as name, sum(l.kept)::int units, sum(l.revenue) revenue, sum(l.profit) profit, count(distinct l.style_id)::int styles
              from sty_sold_lines($1, $2, $3, $4) l join sty_styles st on st.id = l.style_id group by 1) g) x$f$, k) into j using tid, d1, d2, b;
    r := r || jsonb_build_object(case k when 'subcategory' then 'type' else k end, j);
  end loop;
  return r;
end $$;
