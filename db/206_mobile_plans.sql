-- Mobile shop and repair plans (owner's pricing file, Oct 2026): four tiers + three add-ons, managed in Admin -> Pricing
-- like the salon and cafe ones (db/198, db/204). A plan can switch on more than one product: `extra_keys` lists the
-- additional product keys a tier includes (Smart Retail adds AUZsScan, Business 360 adds AUZsScan + AUZsLedger); they
-- are added to the request's products and to the quote as zero-price "included" lines.
alter table salon_plan_tiers add column if not exists extra_keys text[] not null default '{}';

insert into salon_plan_tiers (tier_key, niche, product_key, extra_keys, sort_order, name, tagline, monthly_price, yearly_price, features, badge, highlighted) values
  ('mobile_essential', 'mobile', 'mobile', '{}', 1, 'Essential', 'For smaller mobile shops that need essential billing and sales management.', 560, 5600,
    '["Basic sales and billing","Customer and invoice records","Basic product management","Essential sales summary"]'::jsonb, '', false),
  ('mobile_retail_repair', 'mobile', 'mobile', '{}', 2, 'Retail & Repair', 'For shops selling devices and accessories while handling customer repairs.', 820, 8200,
    '["Essential package capabilities","AUZsMob repair management","Repair status and service history","Device purchase and sale tracking","Customer repair records","Retail product management"]'::jsonb, '', false),
  ('mobile_smart_retail', 'mobile', 'mobile', '{scan}', 3, 'Smart Retail', 'For busy shops that want faster scan-based inventory workflows.', 1360, 13600,
    '["Retail & Repair capabilities","AUZsScan GTIN/barcode scanning","Scan-based stock handling","Faster product identification","Improved stock visibility","Relevant stock and sales reports"]'::jsonb, 'Most popular', true),
  ('mobile_business_360', 'mobile', 'mobile', '{scan,accounting}', 4, 'Business 360', 'For businesses seeking connected retail, repairs, stock and accounts.', 2260, 22600,
    '["AUZsMob repair and sales","AUZsScan barcode workflows","Stock, purchase and sales","Complete accounts software","Relevant business reports","Setup configured to your needs"]'::jsonb, '', false)
on conflict (tier_key) do nothing;

insert into niche_addons (addon_key, niche, sort_order, name, blurb, monthly_price, price_label, unit_note, product_key) values
  ('mobile_scan', 'mobile', 1, 'AUZsScan workflows', 'Ask about adding GTIN/barcode scanning to an eligible setup for quicker product lookup and stock entry.', 0, 'Pricing on enquiry', 'Available as an add-on', 'scan'),
  ('mobile_accounts', 'mobile', 2, 'Complete Accounts', 'Connect sales, purchases, expenses and outstanding payment records with a fuller accounts workflow.', 0, 'Pricing on enquiry', 'Available as an add-on', 'accounting'),
  ('mobile_multi', 'mobile', 3, 'Multi-counter or multi-location', 'Discuss the right configuration for shops operating multiple counters or locations.', 0, 'Pricing on enquiry', 'Available as an add-on', null)
on conflict (addon_key) do nothing;

-- the public and admin listings now also return extra_keys
create or replace function public_plan_tiers(p_niche text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'tier_key', tier_key, 'niche', niche, 'product_key', product_key, 'extra_keys', to_jsonb(extra_keys), 'sort_order', sort_order, 'name', name, 'tagline', tagline,
      'monthly_price', monthly_price, 'yearly_price', yearly_price, 'features', features,
      'badge', badge, 'highlighted', highlighted) order by sort_order), '[]'::jsonb)
  from salon_plan_tiers where active and niche = p_niche
$$;

create or replace function admin_list_salon_tiers() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_result jsonb;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'tier_key', tier_key, 'niche', niche, 'product_key', product_key, 'extra_keys', to_jsonb(extra_keys), 'sort_order', sort_order, 'name', name, 'tagline', tagline,
      'monthly_price', monthly_price, 'yearly_price', yearly_price, 'features', features,
      'badge', badge, 'highlighted', highlighted, 'active', active) order by niche, sort_order), '[]'::jsonb)
  into v_result from salon_plan_tiers;
  return v_result;
end $$;

create or replace function submit_client_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := app_uid(); v_tid uuid; v_tname text; v_name text := trim(coalesce(p->>'contact_name', '')); v_phone text := trim(coalesce(p->>'phone', ''));
  v_biz text := trim(coalesce(p->>'business_name', '')); v_gst text := nullif(upper(trim(coalesce(p->>'gstin', ''))), ''); v_prods text[]; v_id uuid; v_tok text; v_state text;
  v_sel jsonb := null; v_tier salon_plan_tiers; v_ad niche_addons; v_ads jsonb := '[]'::jsonb; v_akey text; v_niche text;
begin
  if v_uid is null then raise exception 'Please sign in first, then send your request.'; end if;
  select tenant_id into v_tid from profiles where id = v_uid limit 1;
  if v_tid is not null then select name into v_tname from tenants where id = v_tid; end if;
  if v_name = '' then raise exception 'Please enter your name.'; end if;
  if length(regexp_replace(v_phone, '\D', '', 'g')) < 10 then raise exception 'Please enter a valid mobile number.'; end if;
  if v_tid is null and v_biz = '' then raise exception 'Please enter your business name.'; end if;
  if v_gst is not null and v_gst !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$' then raise exception 'That GSTIN does not look right (15 characters, e.g. 08ABCDE1234F1Z5). Leave it empty if you have none.'; end if;
  if (select count(*) from client_orders where user_id = v_uid and status in ('requested', 'verifying', 'confirmed', 'link_sent', 'payment_submitted')) >= 5 then
    raise exception 'You already have several open requests. We will get back to you on them first.'; end if;
  select coalesce(array_agg(distinct x), '{}') into v_prods from jsonb_array_elements_text(coalesce(p->'products', '[]'::jsonb)) x where x ~ '^[a-z_]{2,30}$';

  -- chosen plan / add-ons: prices always come from the admin-managed tables, never from the browser
  if jsonb_typeof(p->'plan') = 'object' then
    v_niche := p->'plan'->>'niche';
    select * into v_tier from salon_plan_tiers where tier_key = p->'plan'->>'tier_key' and active;
    if v_tier.tier_key is not null then v_niche := v_tier.niche; end if;
    if jsonb_typeof(p->'plan'->'addons') = 'array' then
      for v_akey in select distinct x from jsonb_array_elements_text(p->'plan'->'addons') x loop
        select * into v_ad from niche_addons where addon_key = v_akey and active;
        if v_ad.addon_key is not null then
          v_ads := v_ads || jsonb_build_array(jsonb_build_object('key', v_ad.addon_key, 'name', v_ad.name, 'price', v_ad.monthly_price, 'price_label', v_ad.price_label, 'product_key', v_ad.product_key));
          if v_ad.product_key is not null and not (v_ad.product_key = any (v_prods)) then v_prods := v_prods || v_ad.product_key; end if;
        end if;
      end loop;
    end if;
    if v_tier.tier_key is not null or jsonb_array_length(v_ads) > 0 then
      v_sel := jsonb_build_object('niche', v_niche, 'period', case when p->'plan'->>'period' = 'year' then 'year' else 'month' end,
        'tier', case when v_tier.tier_key is null then null else jsonb_build_object('key', v_tier.tier_key, 'name', v_tier.name, 'product_key', v_tier.product_key, 'monthly', v_tier.monthly_price, 'yearly', v_tier.yearly_price, 'extra_keys', to_jsonb(v_tier.extra_keys)) end,
        'addons', v_ads);
      if v_tier.tier_key is not null and not (v_tier.product_key = any (v_prods)) then v_prods := v_prods || v_tier.product_key; end if;
      if v_tier.tier_key is not null then
        for v_akey in select unnest(v_tier.extra_keys) loop
          if not (v_akey = any (v_prods)) then v_prods := v_prods || v_akey; end if;
        end loop;
      end if;
    end if;
  end if;

  v_state := coalesce(nullif(substr(v_gst, 1, 2), ''), nullif(p->>'state_code', ''));
  insert into client_orders (user_id, tenant_id, kind, contact_name, phone, email, gstin, address, state_code, business_name, slug, niche, requirement, notes, products, selection)
  values (v_uid, v_tid, case when v_tid is null then 'new' else 'addon' end, left(v_name, 120), left(v_phone, 30), left(nullif(trim(coalesce(p->>'email', '')), ''), 160), v_gst,
    left(nullif(trim(coalesce(p->>'address', '')), ''), 400), v_state, coalesce(v_tname, left(v_biz, 160)),
    left(nullif(regexp_replace(lower(coalesce(p->>'slug', '')), '[^a-z0-9]', '', 'g'), ''), 30),
    case when p->>'niche' in ('cafe', 'salon', 'gym', 'retail', 'mobile', 'general') then p->>'niche'
         when v_niche in ('cafe', 'salon', 'mobile') then v_niche else 'general' end,
    left(nullif(trim(coalesce(p->>'requirement', '')), ''), 2000), left(nullif(trim(coalesce(p->>'notes', '')), ''), 2000), v_prods, v_sel)
  returning id, token into v_id, v_tok;
  insert into notifications (tenant_id, type, title, body) values (null, 'client_order', 'New client request: ' || coalesce(v_tname, v_biz), v_name || ' · ' || v_phone);
  return jsonb_build_object('id', v_id, 'token', v_tok);
end $$;
