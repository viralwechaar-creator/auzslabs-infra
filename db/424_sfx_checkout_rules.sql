-- Storefront round F: checkout rules, payment methods, purchase limits, shipping tiers with a visible reason, GST split.
--  * config.checkoutRules = { fields:{email,address2,note}, payments:{cod,online,order[],codMax}, limits:{minOrder,maxItems} }
--  * sfx_products gains max_per_order, min_per_order, tax_rate (override) and hsn.
--  * Shipping: zone (db/413) first, then price tiers, then the flat fee. The order keeps the reason (shipping_label).
--  * GST: tax is worked out per line (product rate or store rate). With a seller state set, intra-state tax is split into CGST and SGST, else IGST.
-- Everything is enforced by triggers on the new order, so the checkout function itself is unchanged.
alter table sfx_products add column if not exists max_per_order int check (max_per_order is null or max_per_order > 0);
alter table sfx_products add column if not exists min_per_order int check (min_per_order is null or min_per_order > 0);
alter table sfx_products add column if not exists tax_rate numeric(5,2) check (tax_rate is null or (tax_rate >= 0 and tax_rate <= 28));
alter table sfx_products add column if not exists hsn text;
alter table sfx_orders add column if not exists shipping_label text;
alter table sfx_orders add column if not exists tax_split jsonb;

create function sfx_checkout_rules_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); cur jsonb; f jsonb := coalesce(p->'fields', '{}'::jsonb); pay jsonb := coalesce(p->'payments', '{}'::jsonb); lim jsonb := coalesce(p->'limits', '{}'::jsonb);
  em text := coalesce(nullif(f->>'email', ''), 'optional'); a2 text := coalesce(nullif(f->>'address2', ''), 'optional'); nt text := coalesce(nullif(f->>'note', ''), 'optional');
  cod boolean := coalesce((pay->>'cod')::boolean, true); onl boolean := coalesce((pay->>'online')::boolean, true); ord jsonb := '[]'::jsonb; k text;
  cmax numeric := coalesce(nullif(pay->>'codMax', '')::numeric, 0); minv numeric := coalesce(nullif(lim->>'minOrder', '')::numeric, 0); maxi int := coalesce(nullif(lim->>'maxItems', '')::int, 0);
begin
  if em not in ('required', 'optional', 'hidden') or a2 not in ('optional', 'hidden') or nt not in ('optional', 'hidden') then raise exception 'Choose required, optional or hidden for each field' using errcode = 'SF002'; end if;
  if not cod and not onl then raise exception 'Keep at least one payment method turned on' using errcode = 'SF002'; end if;
  if cmax < 0 or minv < 0 or maxi < 0 or maxi > 200 then raise exception 'Limits cannot be negative (items up to 200)' using errcode = 'SF002'; end if;
  if jsonb_typeof(pay->'order') = 'array' then
    for k in select jsonb_array_elements_text(pay->'order') loop if k in ('online', 'cod') and not (ord ? k) then ord := ord || to_jsonb(k); end if; end loop;
  end if;
  foreach k in array array['online', 'cod'] loop if not (ord ? k) then ord := ord || to_jsonb(k); end if; end loop;
  select config into cur from sfx_stores where tenant_id = tid;
  cur := coalesce(cur, '{}'::jsonb) || jsonb_build_object('checkoutRules', jsonb_build_object('fields', jsonb_build_object('email', em, 'address2', a2, 'note', nt),
    'payments', jsonb_build_object('cod', cod, 'online', onl, 'order', ord, 'codMax', cmax), 'limits', jsonb_build_object('minOrder', minv, 'maxItems', maxi)));
  insert into sfx_stores (tenant_id, config) values (tid, cur) on conflict (tenant_id) do update set config = excluded.config, updated_at = now();
  return cur->'checkoutRules';
end $$;

create function sfx_checkout_rules_get() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view'); c jsonb;
begin
  select config->'checkoutRules' into c from sfx_stores where tenant_id = tid;
  return coalesce(c, jsonb_build_object('fields', jsonb_build_object('email', 'optional', 'address2', 'optional', 'note', 'optional'),
    'payments', jsonb_build_object('cod', true, 'online', true, 'order', jsonb_build_array('online', 'cod'), 'codMax', 0), 'limits', jsonb_build_object('minOrder', 0, 'maxItems', 0)));
end $$;

create function sfx_product_rules_save(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); mx int := nullif(p->>'maxPerOrder', '')::int; mn int := nullif(p->>'minPerOrder', '')::int; tr numeric := nullif(p->>'taxRate', '')::numeric; r sfx_products;
begin
  if mx is not null and mx < 1 or mn is not null and mn < 1 then raise exception 'A limit must be at least 1' using errcode = 'SF002'; end if;
  if mx is not null and mn is not null and mn > mx then raise exception 'The minimum cannot be above the maximum' using errcode = 'SF002'; end if;
  if tr is not null and (tr < 0 or tr > 28) then raise exception 'Enter a tax rate between 0 and 28' using errcode = 'SF002'; end if;
  update sfx_products set max_per_order = mx, min_per_order = mn, tax_rate = tr, hsn = nullif(left(trim(coalesce(p->>'hsn', '')), 12), ''), updated_at = now() where id = p_id and tenant_id = tid returning * into r;
  if not found then raise exception 'Product not found' using errcode = 'SF003'; end if;
  return jsonb_build_object('id', r.id, 'maxPerOrder', r.max_per_order, 'minPerOrder', r.min_per_order, 'taxRate', r.tax_rate, 'hsn', r.hsn);
end $$;
create function sfx_product_rules_get(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view'); r sfx_products;
begin
  select * into r from sfx_products where id = p_id and tenant_id = tid;
  if not found then raise exception 'Product not found' using errcode = 'SF003'; end if;
  return jsonb_build_object('id', r.id, 'maxPerOrder', r.max_per_order, 'minPerOrder', r.min_per_order, 'taxRate', r.tax_rate, 'hsn', r.hsn);
end $$;

-- Rules checked on the new order. Runs before discounts, shipping and tax.
create function sfx_orders_checkout_rules() returns trigger language plpgsql security definer set search_path = public as $$
declare c jsonb; f jsonb; pay jsonb; lim jsonb; l jsonb; items int := 0; p sfx_products; q int; qty_by jsonb := '{}'::jsonb; k text; cmax numeric; maxi int; minv numeric;
begin
  select config->'checkoutRules' into c from sfx_stores where tenant_id = new.tenant_id;
  if c is not null then
    f := c->'fields'; pay := c->'payments'; lim := c->'limits';
    if f->>'email' = 'required' and position('@' in coalesce(new.customer->>'email', '')) = 0 then raise exception 'Please enter your email address' using errcode = 'SF002'; end if;
    if new.payment_method = 'cod' and coalesce((pay->>'cod')::boolean, true) is false then raise exception 'Cash on delivery is not available. Please pay online.' using errcode = 'SF002'; end if;
    if new.payment_method = 'online' and coalesce((pay->>'online')::boolean, true) is false then raise exception 'Online payment is not available. Please choose cash on delivery.' using errcode = 'SF002'; end if;
    cmax := coalesce(nullif(pay->>'codMax', '')::numeric, 0);
    if new.payment_method = 'cod' and cmax > 0 and new.subtotal > cmax then raise exception 'Cash on delivery is available up to Rs %. Please pay online for a bigger order.', cmax using errcode = 'SF002'; end if;
    minv := coalesce(nullif(lim->>'minOrder', '')::numeric, 0); maxi := coalesce(nullif(lim->>'maxItems', '')::int, 0);
    if minv > 0 and new.subtotal < minv then raise exception 'The minimum order is Rs %', minv using errcode = 'SF002'; end if;
  end if;
  for l in select * from jsonb_array_elements(new.lines) loop
    items := items + coalesce((l->>'qty')::int, 1);
    k := l->>'productId';
    if k is not null then qty_by := jsonb_set(qty_by, array[k], to_jsonb(coalesce((qty_by->>k)::int, 0) + coalesce((l->>'qty')::int, 1))); end if;
  end loop;
  if c is not null and coalesce(nullif(c->'limits'->>'maxItems', '')::int, 0) > 0 and items > (c->'limits'->>'maxItems')::int then raise exception 'You can order up to % items at a time', c->'limits'->>'maxItems' using errcode = 'SF002'; end if;
  for k in select jsonb_object_keys(qty_by) loop
    select * into p from sfx_products where id = k::uuid;
    if found then
      q := (qty_by->>k)::int;
      if p.max_per_order is not null and q > p.max_per_order then raise exception '% can be ordered up to % at a time', p.name, p.max_per_order using errcode = 'SF002'; end if;
      if p.min_per_order is not null and q < p.min_per_order then raise exception '% needs at least % in an order', p.name, p.min_per_order using errcode = 'SF002'; end if;
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists sfx_orders_checkout_rules on sfx_orders;
create trigger sfx_orders_checkout_rules before insert on sfx_orders for each row execute function sfx_orders_checkout_rules();

-- ---------- shipping: zone, then price tiers, then flat fee; always with the reason ----------
create function sfx_shipping_tiers_save(p_tiers jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); cur jsonb; t jsonb; out jsonb := '[]'::jsonb; up numeric; fee numeric; lb text;
begin
  if jsonb_typeof(p_tiers) <> 'array' or jsonb_array_length(p_tiers) > 10 then raise exception 'Up to 10 shipping tiers' using errcode = 'SF002'; end if;
  for t in select * from jsonb_array_elements(p_tiers) order by coalesce(nullif(value->>'upTo', '')::numeric, 1e12) loop
    up := nullif(t->>'upTo', '')::numeric; fee := coalesce(nullif(t->>'fee', '')::numeric, -1);
    if fee < 0 or fee > 100000 or (up is not null and up <= 0) then raise exception 'Check the amount and fee of each tier' using errcode = 'SF002'; end if;
    lb := left(trim(coalesce(t->>'label', '')), 60);
    out := out || jsonb_build_array(jsonb_build_object('upTo', up, 'fee', fee, 'label', coalesce(nullif(lb, ''), case when up is null then 'Standard shipping' else 'Orders up to Rs ' || up end)));
  end loop;
  select config into cur from sfx_stores where tenant_id = tid;
  cur := coalesce(cur, '{}'::jsonb) || jsonb_build_object('shipping', coalesce(cur->'shipping', '{}'::jsonb) || jsonb_build_object('tiers', out));
  insert into sfx_stores (tenant_id, config) values (tid, cur) on conflict (tenant_id) do update set config = excluded.config, updated_at = now();
  return out;
end $$;

-- fee and reason for an order of this size to this state
create function sfx_shipping_calc(p_tenant uuid, p_state text, p_amount numeric) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c jsonb; fee_ numeric; free_ numeric; z jsonb; t jsonb; st text := lower(trim(coalesce(p_state, ''))); lb text := 'Standard shipping'; tiers jsonb;
begin
  select config->'shipping' into c from sfx_stores where tenant_id = p_tenant;
  fee_ := coalesce(nullif(c->>'fee', '')::numeric, 0); free_ := coalesce(nullif(c->>'freeOver', '')::numeric, 0); tiers := c->'tiers';
  if st <> '' and jsonb_typeof(c->'zones') = 'array' then
    select e into z from jsonb_array_elements(c->'zones') e where exists (select 1 from jsonb_array_elements_text(e->'states') s where lower(trim(s)) = st) limit 1;
  end if;
  if z is not null then fee_ := coalesce(nullif(z->>'fee', '')::numeric, 0); free_ := coalesce(nullif(z->>'freeOver', '')::numeric, 0); lb := coalesce(z->>'name', 'Zone') || ' delivery';
  elsif jsonb_typeof(tiers) = 'array' and jsonb_array_length(tiers) > 0 then
    select e into t from jsonb_array_elements(tiers) e where nullif(e->>'upTo', 'null') is null or p_amount <= (e->>'upTo')::numeric order by coalesce(nullif(e->>'upTo', 'null')::numeric, 1e12) limit 1;
    if t is not null then fee_ := (t->>'fee')::numeric; lb := t->>'label'; free_ := 0; end if;
  end if;
  if fee_ > 0 and free_ > 0 and p_amount >= free_ then return jsonb_build_object('fee', 0, 'label', 'Free shipping over Rs ' || free_); end if;
  return jsonb_build_object('fee', fee_, 'label', lb);
end $$;

create or replace function sfx_orders_apply_shipping() returns trigger language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  if new.shipping is distinct from 0 then return new; end if;
  r := sfx_shipping_calc(new.tenant_id, new.customer->>'state', new.subtotal - coalesce(new.discount_amount, 0));
  new.shipping_label := r->>'label';
  if (r->>'fee')::numeric > 0 then new.shipping := (r->>'fee')::numeric; new.total := new.total + new.shipping; end if;
  return new;
end $$;

create function public_sfx_shipping_quote(p_slug text, p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_public_tenant(p_slug);
begin
  if tid is null then return null; end if;
  return sfx_shipping_calc(tid, p->>'state', greatest(0, coalesce(nullif(p->>'amount', '')::numeric, 0)));
end $$;

-- ---------- GST: per line, and split into CGST/SGST or IGST ----------
create or replace function sfx_orders_apply_tax() returns trigger language plpgsql security definer set search_path = public as $$
declare c jsonb; sr numeric; incl boolean; l jsonb; r numeric; base numeric; share numeric; tot numeric := 0; pr numeric;
begin
  if new.tax is distinct from 0 then return new; end if;
  select config->'tax' into c from sfx_stores where tenant_id = new.tenant_id;
  sr := coalesce(nullif(c->>'rate', '')::numeric, 0); incl := coalesce((c->>'inclusive')::boolean, true);
  share := case when new.subtotal > 0 then greatest(new.subtotal - coalesce(new.discount_amount, 0), 0) / new.subtotal else 0 end;
  for l in select * from jsonb_array_elements(new.lines) loop
    select tax_rate into pr from sfx_products where id = (l->>'productId')::uuid;
    r := coalesce(pr, sr);
    if r <= 0 then continue; end if;
    base := (l->>'price')::numeric * coalesce((l->>'qty')::int, 1) * share;
    tot := tot + case when incl then base * r / (100 + r) else base * r / 100 end;
  end loop;
  tot := round(tot, 2);
  if tot <= 0 then return new; end if;
  new.tax := tot;
  if not incl then new.total := new.total + tot; end if;
  return new;
end $$;

create function sfx_orders_tax_split() returns trigger language plpgsql security definer set search_path = public as $$
declare c jsonb; ss text; cs text; half numeric;
begin
  if new.tax <= 0 then return new; end if;
  select config->'tax' into c from sfx_stores where tenant_id = new.tenant_id;
  ss := lower(trim(coalesce(c->>'sellerState', ''))); cs := lower(trim(coalesce(new.customer->>'state', '')));
  if ss = '' or cs = '' then return new; end if;
  if ss = cs then half := round(new.tax / 2, 2); new.tax_split := jsonb_build_object('cgst', half, 'sgst', new.tax - half);
  else new.tax_split := jsonb_build_object('igst', new.tax); end if;
  return new;
end $$;
drop trigger if exists sfx_orders_tax_split on sfx_orders;
create trigger sfx_orders_tax_split before insert on sfx_orders for each row execute function sfx_orders_tax_split();

-- seller state lives with the tax settings
create function sfx_tax_seller_state_save(p_state text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); cur jsonb; s text := left(trim(coalesce(p_state, '')), 60);
begin
  select config into cur from sfx_stores where tenant_id = tid;
  cur := coalesce(cur, '{}'::jsonb) || jsonb_build_object('tax', coalesce(cur->'tax', jsonb_build_object('rate', 0, 'inclusive', true, 'gstin', '', 'label', 'GST')) || jsonb_build_object('sellerState', s));
  insert into sfx_stores (tenant_id, config) values (tid, cur) on conflict (tenant_id) do update set config = excluded.config, updated_at = now();
  return jsonb_build_object('sellerState', s);
end $$;
-- the tax save from db/415 replaces the whole tax object, so it keeps the seller state
alter function sfx_tax_settings_save(jsonb) rename to sfx_tax_settings_save_pre424;
create function sfx_tax_settings_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); keep text; res jsonb;
begin
  select config->'tax'->>'sellerState' into keep from sfx_stores where tenant_id = tid;
  res := sfx_tax_settings_save_pre424(p);
  if coalesce(keep, '') <> '' or p ? 'sellerState' then perform sfx_tax_seller_state_save(case when p ? 'sellerState' then p->>'sellerState' else keep end); res := sfx_checkout_settings_get(); end if;
  return res;
end $$;

-- the shipping save from db/413 rewrites the whole shipping object, so it keeps the price tiers
alter function sfx_checkout_settings_save(jsonb) rename to sfx_checkout_settings_save_pre424;
create function sfx_checkout_settings_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); keep jsonb; res jsonb; cur jsonb;
begin
  select config->'shipping'->'tiers' into keep from sfx_stores where tenant_id = tid;
  res := sfx_checkout_settings_save_pre424(p);
  if keep is not null and jsonb_typeof(keep) = 'array' and jsonb_array_length(keep) > 0 and not (coalesce(p->'shipping', '{}'::jsonb) ? 'tiers') then
    select config into cur from sfx_stores where tenant_id = tid;
    update sfx_stores set config = jsonb_set(cur, '{shipping,tiers}', keep) where tenant_id = tid;
    res := sfx_checkout_settings_get();
  end if;
  return res;
end $$;
grant execute on function sfx_checkout_settings_save(jsonb) to app;

-- orders report the split and the shipping reason
alter function sfx_order_json(sfx_orders, boolean) rename to sfx_order_json_pre424;
create function sfx_order_json(o sfx_orders, detail boolean default false) returns jsonb language sql stable security definer set search_path = public as $$
  select sfx_order_json_pre424(o, detail) || jsonb_build_object('taxSplit', o.tax_split, 'shippingLabel', o.shipping_label)
$$;
alter function public_sfx_order(text) rename to public_sfx_order_pre424;
create function public_sfx_order(p_token text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb := public_sfx_order_pre424(p_token); o sfx_orders;
begin
  if r is null then return null; end if;
  select * into o from sfx_orders where token = lower(coalesce(p_token, ''));
  return r || jsonb_build_object('taxSplit', o.tax_split, 'shippingLabel', o.shipping_label);
end $$;

-- the public store tells the checkout page which fields and payment methods to show
alter function public_sfx_store(text) rename to public_sfx_store_pre424;
create function public_sfx_store(p_slug text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb := public_sfx_store_pre424(p_slug); tid uuid; c jsonb;
begin
  if r is null or r->'config' is null then return r; end if;
  tid := sfx_public_tenant(p_slug);
  select config->'checkoutRules' into c from sfx_stores where tenant_id = tid;
  if c is null then return r; end if;
  return jsonb_set(r, '{config}', (r->'config') || jsonb_build_object('checkoutRules', c));
end $$;
-- the settings screen reads everything in one call
alter function sfx_checkout_settings_get() rename to sfx_checkout_settings_get_pre424;
create function sfx_checkout_settings_get() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  return sfx_checkout_settings_get_pre424() || jsonb_build_object('rules', sfx_checkout_rules_get());
end $$;
grant execute on function sfx_checkout_settings_get() to app;

grant execute on function sfx_checkout_rules_save(jsonb), sfx_checkout_rules_get(), sfx_product_rules_save(uuid, jsonb), sfx_product_rules_get(uuid), sfx_shipping_tiers_save(jsonb),
  public_sfx_shipping_quote(text, jsonb), sfx_tax_seller_state_save(text), sfx_tax_settings_save(jsonb), public_sfx_order(text), public_sfx_store(text) to app;

-- Rollback (settings get): drop function sfx_checkout_settings_get(); rename sfx_checkout_settings_get_pre424 back.
-- Rollback (settings save): drop function sfx_checkout_settings_save(jsonb); rename sfx_checkout_settings_save_pre424 back.
-- Rollback: drop triggers sfx_orders_checkout_rules and sfx_orders_tax_split and their functions; drop sfx_checkout_rules_save/get, sfx_product_rules_save/get,
-- sfx_shipping_tiers_save, sfx_shipping_calc, public_sfx_shipping_quote, sfx_tax_seller_state_save; for the renamed functions (sfx_tax_settings_save, sfx_order_json,
-- public_sfx_order, public_sfx_store) drop the new one and rename the _pre424 copy back; restore sfx_orders_apply_shipping from db/413 and sfx_orders_apply_tax from db/415;
-- drop the added columns on sfx_products and sfx_orders.
