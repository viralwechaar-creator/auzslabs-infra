-- Plan tiers + add-ons for the Salon AND Cafe/Restaurant pages are managed in
-- Admin -> Pricing (single source of truth), read live by the pages, carried
-- through the cart into the request, and pre-fill the admin quote (adjustable).
-- Builds on db/198 (salon_plan_tiers): the same table now holds every niche.
alter table salon_plan_tiers add column if not exists niche text not null default 'salon';
alter table salon_plan_tiers add column if not exists product_key text not null default 'salon';
update salon_plan_tiers set niche = 'salon', product_key = 'salon' where niche = 'salon';

insert into salon_plan_tiers (tier_key, niche, product_key, sort_order, name, tagline, monthly_price, yearly_price, features, badge, highlighted) values
  ('cafe_starter', 'cafe', 'pos', 1, 'Starter', 'For small cafes, food trucks and new businesses.', 820, 8200,
    '["Basic POS billing","Basic receipts","Simple menu and product management","Essential sales summary"]'::jsonb, '', false),
  ('cafe_growth', 'cafe', 'pos', 2, 'Growth', 'For established cafes, restaurants and cloud kitchens.', 1360, 13600,
    '["Complete POS functionality","Advanced inventory management","Advanced analytics dashboard","Core order and kitchen workflows","QR ordering as an add-on","Zomato / Swiggy as an add-on","WhatsApp automation as an add-on"]'::jsonb, '', false),
  ('cafe_professional', 'cafe', 'pos', 3, 'Professional', 'For busy restaurants ready for connected ordering.', 2260, 22600,
    '["Everything in Growth","Preset QR ordering website included","Zomato and Swiggy integration included","Multiple invoice template options","Advanced inventory and analytics","WhatsApp automation as a paid add-on"]'::jsonb, 'Best for growing restaurants', true),
  ('cafe_enterprise', 'cafe', 'pos', 4, 'Enterprise', 'For restaurant groups and multi-outlet businesses.', 3610, 36100,
    '["Professional plan capabilities","Multi-outlet requirements discussed with you","Outlet and team setup scoped to your business","Dedicated account manager","Custom integrations quoted separately","WhatsApp automation as a paid add-on"]'::jsonb, '', false)
on conflict (tier_key) do nothing;

create table if not exists niche_addons (
  addon_key     text primary key,
  niche         text not null,
  sort_order    int not null default 0,
  name          text not null,
  blurb         text not null default '',
  monthly_price numeric(10,2) not null default 0,   -- 0 = no fixed price (shows price_label, quoted later)
  price_label   text not null default '',
  unit_note     text not null default 'per month + GST',
  product_key   text,                               -- real product switched on with it (e.g. payroll), or null
  active        boolean not null default true,
  updated_at    timestamptz not null default now()
);
grant select, insert, update, delete on niche_addons to app;

insert into niche_addons (addon_key, niche, sort_order, name, blurb, monthly_price, price_label, unit_note, product_key) values
  ('salon_payroll', 'salon', 1, 'AUZsPay', 'Staff attendance, leave and payroll. Works with any plan.',
     coalesce((select monthly_price from product_prices where key = 'payroll'), 0), 'Quoted', 'per month + GST', 'payroll'),
  ('salon_whatsapp', 'salon', 2, 'WhatsApp automation', 'Booking reminders and bill links sent from our number. You pay only for the messages that go out.', 0, 'Per message', 'Charged by messages sent', null),
  ('salon_analytics', 'salon', 3, 'Deeper analytics', 'Trend lines and stylist performance beyond the basics.', 0, 'Quoted', 'Price on request', null),
  ('salon_branch', 'salon', 4, 'Extra branch', 'Bring another address under the same brand.', 0, 'Quoted', 'Price on request', null),
  ('cafe_qr', 'cafe', 1, 'QR Ordering + Invoice Templates', 'Preset QR ordering website and multiple invoice template options. Included in Professional. Custom website development is quoted separately.', 460, 'Quoted', 'per month + GST', 'self_order'),
  ('cafe_delivery', 'cafe', 2, 'Zomato & Swiggy Integration', 'Available as an add-on for Growth. Included in Professional, subject to integration availability and agreed scope.', 0, 'Ask for pricing', 'No add-on rate published yet', null),
  ('cafe_whatsapp', 'cafe', 3, 'WhatsApp Automation', 'Monthly usage-based billing, with different rates by message category and provider charges.', 0, 'Pay per message', 'Rates depend on message type', null),
  ('cafe_payroll', 'cafe', 4, 'Payroll Module', 'Add payroll to your setup without changing your core subscription. Billed separately from your plan.', 640, 'Quoted', 'per month + GST', 'payroll')
on conflict (addon_key) do nothing;

create or replace function public_plan_tiers(p_niche text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'tier_key', tier_key, 'niche', niche, 'product_key', product_key, 'sort_order', sort_order, 'name', name, 'tagline', tagline,
      'monthly_price', monthly_price, 'yearly_price', yearly_price, 'features', features,
      'badge', badge, 'highlighted', highlighted) order by sort_order), '[]'::jsonb)
  from salon_plan_tiers where active and niche = p_niche
$$;
-- the salon page keeps asking for its own four tiers
create or replace function public_salon_tiers() returns jsonb
language sql stable security definer set search_path = public as $$
  select public_plan_tiers('salon')
$$;
create or replace function public_niche_addons(p_niche text) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'addon_key', addon_key, 'niche', niche, 'sort_order', sort_order, 'name', name, 'blurb', blurb,
      'monthly_price', monthly_price, 'price_label', price_label, 'unit_note', unit_note, 'product_key', product_key) order by sort_order), '[]'::jsonb)
  from niche_addons where active and niche = p_niche
$$;

create or replace function admin_list_salon_tiers() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_result jsonb;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'tier_key', tier_key, 'niche', niche, 'product_key', product_key, 'sort_order', sort_order, 'name', name, 'tagline', tagline,
      'monthly_price', monthly_price, 'yearly_price', yearly_price, 'features', features,
      'badge', badge, 'highlighted', highlighted, 'active', active) order by niche desc, sort_order), '[]'::jsonb)
  into v_result from salon_plan_tiers;
  return v_result;
end $$;

create or replace function admin_list_niche_addons() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_result jsonb;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'addon_key', addon_key, 'niche', niche, 'sort_order', sort_order, 'name', name, 'blurb', blurb,
      'monthly_price', monthly_price, 'price_label', price_label, 'unit_note', unit_note, 'product_key', product_key, 'active', active)
      order by niche desc, sort_order), '[]'::jsonb)
  into v_result from niche_addons;
  return v_result;
end $$;

create or replace function admin_save_niche_addon(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_key text := p->>'addon_key'; v_row niche_addons;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  if coalesce((p->>'monthly_price')::numeric, 0) < 0 then raise exception 'price cannot be negative'; end if;
  update niche_addons set
    name = coalesce(nullif(p->>'name', ''), name),
    blurb = coalesce(p->>'blurb', blurb),
    monthly_price = coalesce((p->>'monthly_price')::numeric, monthly_price),
    price_label = coalesce(p->>'price_label', price_label),
    unit_note = coalesce(p->>'unit_note', unit_note),
    active = coalesce((p->>'active')::boolean, active),
    updated_at = now()
  where addon_key = v_key returning * into v_row;
  if not found then raise exception 'unknown add-on: %', v_key; end if;
  return jsonb_build_object('addon_key', v_row.addon_key, 'name', v_row.name);
end $$;

-- ---------- the request carries the chosen plan + add-ons ----------
alter table client_orders add column if not exists selection jsonb;

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
        'tier', case when v_tier.tier_key is null then null else jsonb_build_object('key', v_tier.tier_key, 'name', v_tier.name, 'product_key', v_tier.product_key, 'monthly', v_tier.monthly_price, 'yearly', v_tier.yearly_price) end,
        'addons', v_ads);
      if v_tier.tier_key is not null and not (v_tier.product_key = any (v_prods)) then v_prods := v_prods || v_tier.product_key; end if;
    end if;
  end if;

  v_state := coalesce(nullif(substr(v_gst, 1, 2), ''), nullif(p->>'state_code', ''));
  insert into client_orders (user_id, tenant_id, kind, contact_name, phone, email, gstin, address, state_code, business_name, slug, niche, requirement, notes, products, selection)
  values (v_uid, v_tid, case when v_tid is null then 'new' else 'addon' end, left(v_name, 120), left(v_phone, 30), left(nullif(trim(coalesce(p->>'email', '')), ''), 160), v_gst,
    left(nullif(trim(coalesce(p->>'address', '')), ''), 400), v_state, coalesce(v_tname, left(v_biz, 160)),
    left(nullif(regexp_replace(lower(coalesce(p->>'slug', '')), '[^a-z0-9]', '', 'g'), ''), 30),
    case when p->>'niche' in ('cafe', 'salon', 'gym', 'retail', 'mobile', 'general') then p->>'niche'
         when v_niche in ('cafe', 'salon') then v_niche else 'general' end,
    left(nullif(trim(coalesce(p->>'requirement', '')), ''), 2000), left(nullif(trim(coalesce(p->>'notes', '')), ''), 2000), v_prods, v_sel)
  returning id, token into v_id, v_tok;
  insert into notifications (tenant_id, type, title, body) values (null, 'client_order', 'New client request: ' || coalesce(v_tname, v_biz), v_name || ' · ' || v_phone);
  return jsonb_build_object('id', v_id, 'token', v_tok);
end $$;
