-- =========================================================
-- AUZsStyle engine part 1: permissions, settings, branches, styles + variants, catalog, stock, suppliers,
-- purchases, customers. See 214_style_schema.sql for the architecture. Feature key: 'style'.
-- =========================================================

create or replace function sty_tenant() returns uuid language plpgsql stable security definer set search_path = public as $$
declare tid uuid; f jsonb; e jsonb;
begin
  if me() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  tid := (me()->>'tenant_id')::uuid;
  if tid is null then raise exception 'not a tenant member'; end if;
  select features, enabled_features into f, e from tenant_settings where tenant_id = tid;
  if coalesce(f->>'style', 'false') <> 'true' or coalesce(e->>'style', 'true') = 'false' then
    raise exception 'AUZsStyle is not enabled for this business' using errcode = 'ST001';
  end if;
  return tid;
end $$;

-- keys: sty_view, sty_sell, sty_stock (adjust/transfer), sty_purchase, sty_reports, sty_manage (catalog, prices, settings, void)
create or replace function sty_perm(k text) returns boolean language plpgsql stable security definer set search_path = public as $$
declare r text; rid uuid; perms jsonb; tid uuid;
begin
  r := me()->>'role'; tid := (me()->>'tenant_id')::uuid;
  if r is null or tid is null then return false; end if;
  if r = 'owner' then return true; end if;
  select role_id into rid from profiles where id = app_uid();
  if rid is not null then
    select permissions into perms from roles where id = rid and tenant_id = tid;
    return coalesce((perms->>k)::boolean, false);
  end if;
  if r = 'manager' then return true; end if;
  return k in ('sty_view', 'sty_sell');
end $$;

create or replace function sty_guard(k text default 'sty_view') returns uuid language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_tenant();
  if k is not null and not sty_perm(k) then raise exception 'Your role does not allow this (%)', k using errcode = '42501'; end if;
  return tid;
end $$;

create or replace function sty_perms() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_object_agg(k, sty_perm(k)) from unnest(array['sty_view','sty_sell','sty_stock','sty_purchase','sty_reports','sty_manage']) k
$$;

create or replace function sty_next(tid uuid, key_ text) returns bigint language plpgsql security definer set search_path = public as $$
declare v_n bigint;
begin
  insert into sty_counters as c (tenant_id, k, n) values (tid, key_, 1)
    on conflict on constraint sty_counters_pkey do update set n = c.n + 1 returning c.n into v_n;
  return v_n;
end $$;

create or replace function sty_audit_log(tid uuid, act text, ref text, detail jsonb default null) returns void language sql security definer set search_path = public as $$
  insert into sty_audit (tenant_id, user_id, action, ref, detail) values (tid, app_uid(), act, ref, detail)
$$;

create or replace function sty_stock_of(tid uuid, v uuid, b uuid default null) returns integer language sql stable security definer set search_path = public as $$
  select coalesce(sum(qty), 0)::int from sty_stock_moves where tenant_id = tid and variant_id = v and (b is null or branch_id = b)
$$;

create or replace function sty_main_branch(tid uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare b uuid;
begin
  select id into b from sty_branches where tenant_id = tid and active order by is_main desc, created_at limit 1;
  if b is null then
    insert into sty_branches (tenant_id, name, kind, is_main) values (tid, 'Main shop', 'shop', true) returning id into b;
  end if;
  return b;
end $$;

create or replace function sty_settings_json(s sty_settings) returns jsonb language sql immutable as $$
  select jsonb_build_object('shopName', s.shop_name, 'address', s.address, 'phone', s.phone, 'gstin', s.gstin, 'logoUrl', s.logo_url,
    'billFooter', s.bill_footer, 'billPrefix', s.bill_prefix, 'language', s.language, 'allowNegativeStock', s.allow_negative_stock,
    'maxDiscountPct', s.max_discount_pct, 'returnDays', s.return_days, 'loyaltyEarnPct', s.loyalty_earn_pct,
    'loyaltyPointValue', s.loyalty_point_value, 'roundOff', s.round_off, 'defaultTaxPct', s.default_tax_pct,
    'taxSlabs', s.tax_slabs, 'priceIncludesTax', s.price_includes_tax, 'leadDays', s.lead_days, 'coverDays', s.cover_days,
    'slowDays', s.slow_days, 'requireCustomerPhone', s.require_customer_phone, 'staffSeeCost', s.staff_see_cost,
    'dayCloseDate', s.day_close_date, 'features', s.features)
$$;

-- not STABLE: inserts the default settings row + main branch on a first visit
create or replace function sty_context() returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; s sty_settings; lang text; t_name text; role_ text;
begin
  tid := sty_tenant();
  select * into s from sty_settings where tenant_id = tid;
  if s.tenant_id is null then
    select name into t_name from tenants where id = tid;
    insert into sty_settings (tenant_id, shop_name) values (tid, t_name) on conflict (tenant_id) do nothing;
    select * into s from sty_settings where tenant_id = tid;
  end if;
  perform sty_main_branch(tid);
  role_ := me()->>'role';
  return jsonb_build_object(
    'perms', sty_perms(), 'role', role_, 'userId', app_uid(),
    'canSeeCost', role_ in ('owner', 'manager') or s.staff_see_cost,
    'settings', sty_settings_json(s),
    'branches', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'kind', kind, 'address', address, 'isMain', is_main) order by is_main desc, created_at), '[]'::jsonb)
                 from sty_branches where tenant_id = tid and active));
end $$;

create or replace function sty_save_settings(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_guard('sty_manage');
  perform sty_context();
  update sty_settings set
    shop_name = coalesce(p->>'shopName', shop_name), address = coalesce(p->>'address', address), phone = coalesce(p->>'phone', phone),
    gstin = coalesce(p->>'gstin', gstin), logo_url = coalesce(p->>'logoUrl', logo_url), bill_footer = coalesce(p->>'billFooter', bill_footer),
    bill_prefix = coalesce(nullif(p->>'billPrefix', ''), bill_prefix),
    language = case when p->>'language' in ('en', 'hi') then p->>'language' else language end,
    allow_negative_stock = coalesce((p->>'allowNegativeStock')::boolean, allow_negative_stock),
    max_discount_pct = coalesce((p->>'maxDiscountPct')::numeric, max_discount_pct),
    return_days = coalesce((p->>'returnDays')::int, return_days),
    loyalty_earn_pct = coalesce((p->>'loyaltyEarnPct')::numeric, loyalty_earn_pct),
    loyalty_point_value = coalesce((p->>'loyaltyPointValue')::numeric, loyalty_point_value),
    round_off = coalesce((p->>'roundOff')::boolean, round_off),
    default_tax_pct = coalesce((p->>'defaultTaxPct')::numeric, default_tax_pct),
    tax_slabs = coalesce(p->'taxSlabs', tax_slabs),
    price_includes_tax = coalesce((p->>'priceIncludesTax')::boolean, price_includes_tax),
    lead_days = coalesce((p->>'leadDays')::int, lead_days), cover_days = coalesce((p->>'coverDays')::int, cover_days),
    slow_days = coalesce((p->>'slowDays')::int, slow_days),
    require_customer_phone = coalesce((p->>'requireCustomerPhone')::boolean, require_customer_phone),
    staff_see_cost = coalesce((p->>'staffSeeCost')::boolean, staff_see_cost),
    day_close_date = case when p ? 'dayCloseDate' then nullif(p->>'dayCloseDate', '')::date else day_close_date end,
    features = coalesce(p->'features', features), updated_at = now()
  where tenant_id = tid;
  perform sty_audit_log(tid, 'settings', null, p);
  return sty_context();
end $$;

create or replace function sty_save_branch(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; bid uuid;
begin
  tid := sty_guard('sty_manage');
  bid := nullif(p->>'id', '')::uuid;
  if bid is null then
    insert into sty_branches (tenant_id, name, kind, address) values (tid, coalesce(nullif(p->>'name', ''), 'Branch'), coalesce(p->>'kind', 'shop'), p->>'address') returning id into bid;
  else
    update sty_branches set name = coalesce(nullif(p->>'name', ''), name), kind = coalesce(p->>'kind', kind), address = coalesce(p->>'address', address),
      active = coalesce((p->>'active')::boolean, active) where id = bid and tenant_id = tid;
  end if;
  return sty_context();
end $$;

-- ---------- styles + variants ----------
create or replace function sty_barcode(tid uuid) returns text language sql security definer set search_path = public as $$
  select '2' || lpad(sty_next(tid, 'barcode')::text, 9, '0')
$$;

create or replace function sty_style_json(tid uuid, sid uuid, b uuid, see_cost boolean) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', s.id, 'name', s.name, 'category', s.category, 'subcategory', s.subcategory, 'brand', s.brand,
    'season', s.season, 'gender', s.gender, 'hsn', s.hsn, 'taxPct', s.tax_pct, 'price', s.price, 'mrp', s.mrp,
    'cost', case when see_cost then s.cost end, 'photoUrl', s.photo_url, 'notes', s.notes, 'active', s.active,
    'variants', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'colour', v.colour, 'size', v.size, 'barcode', v.barcode, 'sku', v.sku,
        'price', coalesce(v.price, s.price), 'cost', case when see_cost then v.cost end, 'reorderAt', v.reorder_at, 'active', v.active,
        'stock', coalesce(m.q, 0), 'dmg', coalesce(m.d, 0)) order by v.colour, v.size)
      from sty_variants v
      left join (select variant_id, sum(qty)::int q, sum(dmg)::int d from sty_stock_moves where tenant_id = tid and (b is null or branch_id = b) group by variant_id) m on m.variant_id = v.id
      where v.style_id = s.id), '[]'::jsonb))
  from sty_styles s where s.id = sid and s.tenant_id = tid
$$;

create or replace function sty_catalog(p_branch uuid default null) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; see boolean;
begin
  tid := sty_guard('sty_view');
  see := (me()->>'role') in ('owner', 'manager') or coalesce((select staff_see_cost from sty_settings where tenant_id = tid), false);
  return coalesce((select jsonb_agg(sty_style_json(tid, id, p_branch, see) order by name) from sty_styles where tenant_id = tid), '[]'::jsonb);
end $$;

-- p: {id?, name, category, subcategory, brand, season, gender, hsn, taxPct, cost, price, mrp, photoUrl, notes, active,
--     colours: [..], sizes: [..], reorderAt, opening: {branchId?, qty (per variant), unitCost?}}
create or replace function sty_save_style(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; sid uuid; c text; z text; vid uuid; b uuid; oq int; uc numeric; cols jsonb; szs jsonb; v_exists uuid;
begin
  tid := sty_guard('sty_manage');
  sid := nullif(p->>'id', '')::uuid;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Give the style a name' using errcode = 'ST002'; end if;
  if sid is null then
    insert into sty_styles (tenant_id, name, category, subcategory, brand, season, gender, hsn, tax_pct, cost, price, mrp, notes, photo_url, active, created_by)
    values (tid, trim(p->>'name'), coalesce(nullif(p->>'category', ''), 'Clothing'), p->>'subcategory', p->>'brand', p->>'season', p->>'gender', p->>'hsn',
      nullif(p->>'taxPct', '')::numeric, coalesce(nullif(p->>'cost', '')::numeric, 0), coalesce(nullif(p->>'price', '')::numeric, 0),
      coalesce(nullif(p->>'mrp', '')::numeric, nullif(p->>'price', '')::numeric, 0), p->>'notes', p->>'photoUrl', coalesce((p->>'active')::boolean, true), app_uid())
    returning id into sid;
  else
    update sty_styles set name = coalesce(nullif(trim(p->>'name'), ''), name), category = coalesce(nullif(p->>'category', ''), category),
      subcategory = case when p ? 'subcategory' then p->>'subcategory' else subcategory end, brand = case when p ? 'brand' then p->>'brand' else brand end,
      season = case when p ? 'season' then p->>'season' else season end, gender = case when p ? 'gender' then p->>'gender' else gender end,
      hsn = case when p ? 'hsn' then p->>'hsn' else hsn end, tax_pct = case when p ? 'taxPct' then nullif(p->>'taxPct', '')::numeric else tax_pct end,
      cost = coalesce(nullif(p->>'cost', '')::numeric, cost), price = coalesce(nullif(p->>'price', '')::numeric, price), mrp = coalesce(nullif(p->>'mrp', '')::numeric, mrp),
      notes = case when p ? 'notes' then p->>'notes' else notes end, photo_url = case when p ? 'photoUrl' then p->>'photoUrl' else photo_url end,
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

create or replace function sty_set_variant(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; sid uuid;
begin
  tid := sty_guard('sty_manage');
  update sty_variants set
    price = case when p ? 'price' then nullif(p->>'price', '')::numeric else price end,
    reorder_at = coalesce((p->>'reorderAt')::int, reorder_at), active = coalesce((p->>'active')::boolean, active),
    sku = case when p ? 'sku' then p->>'sku' else sku end,
    barcode = coalesce(nullif(p->>'barcode', ''), barcode)
  where id = p_id and tenant_id = tid returning style_id into sid;
  if sid is null then raise exception 'variant not found'; end if;
  return sty_style_json(tid, sid, null, true);
end $$;

-- ---------- stock ----------
-- p: {branchId?, variantId, qty (change), mode: 'add'|'remove'|'damage'|'lost'|'count', note}
-- 'count' sets saleable stock to qty (a physical count); the move is the difference.
create or replace function sty_adjust(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; b uuid; v uuid; q int; cur int; mode text; kind_ text; d int := 0; dq int;
begin
  tid := sty_guard('sty_stock');
  b := coalesce(nullif(p->>'branchId', '')::uuid, sty_main_branch(tid));
  v := (p->>'variantId')::uuid; q := coalesce((p->>'qty')::int, 0); mode := coalesce(p->>'mode', 'add');
  if not exists (select 1 from sty_variants where id = v and tenant_id = tid) then raise exception 'variant not found'; end if;
  cur := sty_stock_of(tid, v, b);
  if mode = 'count' then dq := q - cur; kind_ := 'count';
  elsif mode = 'add' then dq := abs(q); kind_ := 'adjust';
  elsif mode = 'remove' then dq := -abs(q); kind_ := 'adjust';
  elsif mode = 'damage' then dq := -abs(q); d := abs(q); kind_ := 'damage';
  elsif mode = 'lost' then dq := -abs(q); kind_ := 'lost';
  else raise exception 'unknown mode'; end if;
  if dq = 0 and d = 0 then return jsonb_build_object('ok', true, 'stock', cur); end if;
  if cur + dq < 0 and not (select allow_negative_stock from sty_settings where tenant_id = tid) then
    raise exception 'Only % in stock', cur using errcode = 'ST003';
  end if;
  insert into sty_stock_moves (tenant_id, branch_id, variant_id, qty, dmg, kind, ref_type, note, staff_id)
  values (tid, b, v, dq, d, kind_, 'adjust', p->>'note', app_uid());
  perform sty_audit_log(tid, 'stock_' || kind_, v::text, p);
  return jsonb_build_object('ok', true, 'stock', cur + dq);
end $$;

-- ---------- suppliers + purchases ----------
create or replace function sty_save_supplier(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; sid uuid;
begin
  tid := sty_guard('sty_purchase');
  sid := nullif(p->>'id', '')::uuid;
  if sid is null then
    insert into sty_suppliers (tenant_id, name, contact, phone, gstin, category) values (tid, coalesce(nullif(trim(p->>'name'), ''), 'Supplier'), p->>'contact', p->>'phone', p->>'gstin', p->>'category') returning id into sid;
  else
    update sty_suppliers set name = coalesce(nullif(trim(p->>'name'), ''), name), contact = coalesce(p->>'contact', contact), phone = coalesce(p->>'phone', phone),
      gstin = coalesce(p->>'gstin', gstin), category = coalesce(p->>'category', category), active = coalesce((p->>'active')::boolean, active)
    where id = sid and tenant_id = tid;
  end if;
  return sty_list_suppliers();
end $$;

create or replace function sty_list_suppliers() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_guard('sty_view');
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'contact', s.contact, 'phone', s.phone, 'gstin', s.gstin, 'category', s.category, 'active', s.active,
      'bought', coalesce((select sum(total) from sty_purchases where supplier_id = s.id), 0),
      'paid', coalesce((select sum(amount) from sty_supplier_payments where supplier_id = s.id), 0),
      'due', coalesce((select sum(total) from sty_purchases where supplier_id = s.id), 0) - coalesce((select sum(amount) from sty_supplier_payments where supplier_id = s.id), 0),
      'lastAt', (select max(at) from sty_purchases where supplier_id = s.id)) order by s.name)
    from sty_suppliers s where s.tenant_id = tid and s.active), '[]'::jsonb);
end $$;

-- p: {id (client uuid), supplierId?, branchId?, invoiceNo, paid, note, at?, lines:[{variantId, qty, unitCost}]}
-- Weighted-average cost: new avg = (units already held x old cost + qty x unit cost) / (units held + qty).
create or replace function sty_receive(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; pid uuid; b uuid; ln jsonb; total numeric := 0; held int; oldc numeric; q int; uc numeric; paidv numeric; st text;
begin
  tid := sty_guard('sty_purchase');
  pid := (p->>'id')::uuid;
  if exists (select 1 from sty_purchases where id = pid and tenant_id = tid) then return jsonb_build_object('ok', true, 'duplicate', true, 'id', pid); end if;
  if jsonb_array_length(coalesce(p->'lines', '[]'::jsonb)) = 0 then raise exception 'Add at least one item' using errcode = 'ST004'; end if;
  b := coalesce(nullif(p->>'branchId', '')::uuid, sty_main_branch(tid));
  for ln in select * from jsonb_array_elements(p->'lines') loop
    total := total + (ln->>'qty')::int * coalesce((ln->>'unitCost')::numeric, 0);
  end loop;
  paidv := least(coalesce(nullif(p->>'paid', '')::numeric, 0), total);
  st := case when paidv >= total then 'paid' when paidv > 0 then 'part' else 'unpaid' end;
  insert into sty_purchases (id, tenant_id, supplier_id, branch_id, invoice_no, at, total, paid, status, note, staff_id)
  values (pid, tid, nullif(p->>'supplierId', '')::uuid, b, p->>'invoiceNo', coalesce(nullif(p->>'at', '')::timestamptz, now()), total, paidv, st, p->>'note', app_uid());
  for ln in select * from jsonb_array_elements(p->'lines') loop
    q := (ln->>'qty')::int; uc := coalesce((ln->>'unitCost')::numeric, 0);
    if q <= 0 then raise exception 'Quantity must be above zero'; end if;
    select coalesce(sum(qty), 0)::int into held from sty_stock_moves where tenant_id = tid and variant_id = (ln->>'variantId')::uuid;
    select cost into oldc from sty_variants where id = (ln->>'variantId')::uuid and tenant_id = tid;
    if oldc is null then raise exception 'variant not found'; end if;
    insert into sty_purchase_lines (tenant_id, purchase_id, variant_id, qty, unit_cost) values (tid, pid, (ln->>'variantId')::uuid, q, uc);
    insert into sty_stock_moves (tenant_id, branch_id, variant_id, qty, kind, ref_type, ref_id, unit_cost, staff_id)
    values (tid, b, (ln->>'variantId')::uuid, q, 'purchase', 'purchase', pid, uc, app_uid());
    update sty_variants set cost = round((greatest(held, 0) * oldc + q * uc) / (greatest(held, 0) + q), 2) where id = (ln->>'variantId')::uuid;
  end loop;
  if paidv > 0 and nullif(p->>'supplierId', '') is not null then
    insert into sty_supplier_payments (tenant_id, supplier_id, purchase_id, amount, mode, staff_id, note)
    values (tid, (p->>'supplierId')::uuid, pid, paidv, coalesce(p->>'payMode', 'cash'), app_uid(), 'Paid on receiving');
  end if;
  perform sty_audit_log(tid, 'purchase', pid::text, jsonb_build_object('total', total));
  return jsonb_build_object('ok', true, 'id', pid, 'total', total);
end $$;

create or replace function sty_pay_supplier(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; amt numeric; sid uuid; rem numeric; pr record;
begin
  tid := sty_guard('sty_purchase');
  sid := (p->>'supplierId')::uuid; amt := (p->>'amount')::numeric;
  if amt is null or amt <= 0 then raise exception 'Enter an amount'; end if;
  if not exists (select 1 from sty_suppliers where id = sid and tenant_id = tid) then raise exception 'supplier not found'; end if;
  insert into sty_supplier_payments (tenant_id, supplier_id, amount, mode, note, staff_id) values (tid, sid, amt, coalesce(p->>'mode', 'cash'), p->>'note', app_uid());
  rem := amt;
  for pr in select id, total, paid from sty_purchases where tenant_id = tid and supplier_id = sid and paid < total order by at loop
    exit when rem <= 0;
    update sty_purchases set paid = paid + least(rem, pr.total - pr.paid),
      status = case when paid + least(rem, pr.total - pr.paid) >= total then 'paid' else 'part' end where id = pr.id;
    rem := rem - least(rem, pr.total - pr.paid);
  end loop;
  return sty_list_suppliers();
end $$;

create or replace function sty_list_purchases(p_limit int default 60) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_guard('sty_purchase');
  return coalesce((select jsonb_agg(x order by (x->>'at') desc) from (
    select jsonb_build_object('id', pu.id, 'at', pu.at, 'invoiceNo', pu.invoice_no, 'supplier', su.name, 'supplierId', pu.supplier_id, 'total', pu.total, 'paid', pu.paid,
      'status', pu.status, 'branchId', pu.branch_id,
      'units', (select coalesce(sum(qty), 0) from sty_purchase_lines where purchase_id = pu.id),
      'lines', (select coalesce(jsonb_agg(jsonb_build_object('variantId', l.variant_id, 'style', s.name, 'colour', v.colour, 'size', v.size, 'qty', l.qty, 'unitCost', l.unit_cost)), '[]'::jsonb)
                from sty_purchase_lines l join sty_variants v on v.id = l.variant_id join sty_styles s on s.id = v.style_id where l.purchase_id = pu.id)) x
    from sty_purchases pu left join sty_suppliers su on su.id = pu.supplier_id where pu.tenant_id = tid order by pu.at desc limit p_limit) q), '[]'::jsonb);
end $$;

-- ---------- customers ----------
create or replace function sty_save_customer(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; cid uuid; ph text;
begin
  tid := sty_guard('sty_sell');
  cid := nullif(p->>'id', '')::uuid; ph := nullif(regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g'), '');
  if ph is not null and length(ph) > 10 then ph := right(ph, 10); end if;
  if cid is null and ph is not null then select id into cid from sty_customers where tenant_id = tid and phone = ph; end if;
  if cid is null then
    insert into sty_customers (tenant_id, name, phone, usual_size, birthday, anniversary, notes)
    values (tid, coalesce(nullif(trim(p->>'name'), ''), 'Customer'), ph, p->>'usualSize', nullif(p->>'birthday', '')::date, nullif(p->>'anniversary', '')::date, p->>'notes') returning id into cid;
  else
    update sty_customers set name = coalesce(nullif(trim(p->>'name'), ''), name), phone = coalesce(ph, phone), usual_size = case when p ? 'usualSize' then p->>'usualSize' else usual_size end,
      birthday = case when p ? 'birthday' then nullif(p->>'birthday', '')::date else birthday end,
      anniversary = case when p ? 'anniversary' then nullif(p->>'anniversary', '')::date else anniversary end,
      notes = case when p ? 'notes' then p->>'notes' else notes end where id = cid and tenant_id = tid;
  end if;
  return (select jsonb_build_object('id', id, 'name', name, 'phone', phone, 'usualSize', usual_size, 'points', points, 'credit', credit, 'birthday', birthday) from sty_customers where id = cid);
end $$;

create or replace function sty_list_customers(p_q text default null, p_limit int default 200) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_guard('sty_view');
  return coalesce((select jsonb_agg(x) from (
    select jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'usualSize', c.usual_size, 'points', c.points, 'credit', c.credit,
      'birthday', c.birthday, 'notes', c.notes,
      'visits', (select count(*) from sty_sales s where s.customer_id = c.id and s.status <> 'void'),
      'spent', coalesce((select sum(total) from sty_sales s where s.customer_id = c.id and s.status <> 'void'), 0),
      'lastAt', (select max(at) from sty_sales s where s.customer_id = c.id and s.status <> 'void')) x
    from sty_customers c where c.tenant_id = tid and (p_q is null or p_q = '' or c.name ilike '%' || p_q || '%' or c.phone like '%' || p_q || '%')
    order by c.created_at desc limit p_limit) q), '[]'::jsonb);
end $$;

-- who works here (for staff reports); profiles' own RLS is owner-only
create or replace function sty_staff_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_guard('sty_view');
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(nullif(p.name, ''), p.email), 'role', p.role)) from profiles p where p.tenant_id = tid), '[]'::jsonb);
end $$;
