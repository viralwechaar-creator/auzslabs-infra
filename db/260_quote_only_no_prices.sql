-- Quote-only: AUZslab shows no prices to anyone. The price list, bundles, yearly prices, add-on prices, salon/cafe/mobile
-- plan tiers and niche add-ons are removed. Every client gets a quote built by the admin (client_orders.quote).
-- The client_orders request carries only the products they ticked and their business details.

-- 1. submit_client_order without the chosen-plan block (prices came from the tables being dropped)
create or replace function submit_client_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := app_uid(); v_tid uuid; v_tname text; v_name text := trim(coalesce(p->>'contact_name', '')); v_phone text := trim(coalesce(p->>'phone', ''));
  v_biz text := trim(coalesce(p->>'business_name', '')); v_gst text := nullif(upper(trim(coalesce(p->>'gstin', ''))), ''); v_prods text[]; v_id uuid; v_tok text; v_state text;
  v_niche text;
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

  v_state := coalesce(nullif(substr(v_gst, 1, 2), ''), nullif(p->>'state_code', ''));
  insert into client_orders (user_id, tenant_id, kind, contact_name, phone, email, gstin, address, state_code, business_name, slug, niche, requirement, notes, products, selection)
  values (v_uid, v_tid, case when v_tid is null then 'new' else 'addon' end, left(v_name, 120), left(v_phone, 30), left(nullif(trim(coalesce(p->>'email', '')), ''), 160), v_gst,
    left(nullif(trim(coalesce(p->>'address', '')), ''), 400), v_state, coalesce(v_tname, left(v_biz, 160)),
    left(nullif(regexp_replace(lower(coalesce(p->>'slug', '')), '[^a-z0-9]', '', 'g'), ''), 30),
    case when p->>'niche' in ('cafe', 'salon', 'gym', 'retail', 'mobile', 'general') then p->>'niche'
         when v_niche in ('cafe', 'salon', 'mobile') then v_niche else 'general' end,
    left(nullif(trim(coalesce(p->>'requirement', '')), ''), 2000), left(nullif(trim(coalesce(p->>'notes', '')), ''), 2000), v_prods, null)
  returning id, token into v_id, v_tok;
  insert into notifications (tenant_id, type, title, body) values (null, 'client_order', 'New client request: ' || coalesce(v_tname, v_biz), v_name || ' · ' || v_phone);
  return jsonb_build_object('id', v_id, 'token', v_tok);
end $$;

-- 2. cash in hand: the client chooses to pay AUZslab in cash; the admin confirms when the cash is received
create or replace function public_order_choose_cash(p_token text, p_terms boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o client_orders;
begin
  select * into o from client_orders where token = p_token for update;
  if o.id is null then raise exception 'This link is not valid.'; end if;
  if o.status not in ('link_sent', 'payment_submitted') then raise exception 'This request is not waiting for a payment.'; end if;
  if not coalesce(p_terms, false) then raise exception 'Please tick the box to accept the Terms, Privacy Policy and Refund Policy.'; end if;
  if o.totals is null or coalesce((o.totals->>'total')::numeric, 0) <= 0 then raise exception 'This request has no amount to pay yet.'; end if;
  update client_orders set status = 'payment_submitted', updated_at = now(),
    payment = payment || jsonb_build_object('mode', 'cash', 'method', 'cash', 'terms_accepted_at', now(),
      'terms_version', coalesce((select value from platform_flags where key = 'privacy_version'), '2026-10'), 'submitted_at', now())
    where id = o.id;
  insert into notifications (tenant_id, type, title, body) values (null, 'client_order_paid', 'Cash in hand chosen: ' || coalesce(o.business_name, ''), 'The client will pay ' || (o.totals->>'total') || ' in cash. Confirm the payment when you receive it.');
  return jsonb_build_object('ok', true);
end $$;

-- the client page also needs to know how they chose to pay
create or replace function public_client_order(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare o client_orders;
begin
  select * into o from client_orders where token = p_token;
  if o.id is null then return null; end if;
  return jsonb_build_object('status', o.status, 'kind', o.kind, 'business_name', o.business_name, 'contact_name', o.contact_name, 'phone', o.phone, 'email', o.email, 'gstin', o.gstin, 'address', o.address, 'state_code', o.state_code,
    'products', to_jsonb(o.products), 'requirement', o.requirement,
    'quote', case when o.status in ('link_sent', 'payment_submitted', 'paid') then o.quote else null end,
    'totals', case when o.status in ('link_sent', 'payment_submitted', 'paid') then o.totals else null end,
    'payment', jsonb_build_object('utr', o.payment->>'utr', 'method', o.payment->>'method', 'submitted_at', o.payment->>'submitted_at', 'terms_accepted_at', o.payment->>'terms_accepted_at', 'proof', coalesce((o.payment->>'proof') is not null, false)),
    'invoice_no', o.invoice_no, 'invoice_date', o.invoice_date, 'paid_at', o.paid_at, 'created_at', o.created_at, 'tenant_slug', (select slug from tenants where id = o.tenant_id));
end $$;

-- 3. confirming a cash payment records it as cash
create or replace function admin_confirm_order_payment(p_id uuid, p_paid_on date default null, p_utr text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o client_orders; v_paid date; v_fy text; v_n int; v_no text; v_items jsonb := '[]'; l jsonb; v_feats jsonb := '{}'; v_tid uuid; v_req uuid; v_slug text; v_min date := null; v_ren date; v_month numeric := 0; q jsonb; t jsonb; v_utr text; m record;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  select * into o from client_orders where id = p_id for update;
  if o.id is null then raise exception 'not found'; end if;
  if o.status = 'paid' then raise exception 'This order is already paid.'; end if;
  if o.quote is null or o.totals is null then raise exception 'Save the quote first.'; end if;
  v_paid := coalesce(p_paid_on, current_date);
  for l in select * from jsonb_array_elements(o.quote->'items') loop
    v_ren := (v_paid + case when coalesce(l->>'plan', 'month') = 'year' then interval '1 year' else interval '1 month' end)::date;
    v_items := v_items || jsonb_build_array(l || jsonb_build_object('renewal', v_ren));
    v_feats := v_feats || jsonb_build_object(l->>'key', true);
    v_min := least(coalesce(v_min, v_ren), v_ren);
    v_month := v_month + round((coalesce((l->>'rate')::numeric, 0) - coalesce((l->>'discount')::numeric, 0)) / case when coalesce(l->>'plan', 'month') = 'year' then 12 else 1 end, 2);
  end loop;
  q := o.quote || jsonb_build_object('items', v_items);
  t := client_order_totals(q, o.state_code);
  -- access: a new business is created (the account that sent the request becomes its owner); an existing business gets the products added
  if o.kind = 'new' then
    if o.user_id is null then raise exception 'The account that sent this request no longer exists.'; end if;
    v_slug := coalesce(nullif(o.slug, ''), nullif(regexp_replace(lower(coalesce(o.business_name, '')), '[^a-z0-9]', '', 'g'), ''), 'client' || substr(replace(o.id::text, '-', ''), 1, 6));
    v_slug := left(v_slug, 30);
    if exists (select 1 from tenants where slug = v_slug) then v_slug := left(v_slug, 24) || substr(replace(o.id::text, '-', ''), 1, 5); end if;
    insert into signup_requests (user_id, business_name, slug, features, notes, contact_name, phone, niche, address)
      values (o.user_id, o.business_name, v_slug, v_feats, 'From client order ' || o.id::text, o.contact_name, o.phone, o.niche, o.address) returning id into v_req;
    v_tid := approve_signup_request(v_req, coalesce(nullif(o.niche, ''), 'general'));
  else
    v_tid := o.tenant_id;
    if v_tid is null then raise exception 'This request has no business attached.'; end if;
    perform admin_set_tenant_features(v_tid, v_feats);
  end if;
  update tenants set renewal_date = v_min, monthly_fee = (select coalesce(monthly_fee, 0) from tenants where id = v_tid) * (case when o.kind = 'addon' then 1 else 0 end) + v_month, status = 'active' where id = v_tid;
  -- gapless bill number per financial year (April to March)
  v_fy := case when extract(month from v_paid) >= 4 then extract(year from v_paid)::int || '-' || lpad(((extract(year from v_paid)::int + 1) % 100)::text, 2, '0')
               else (extract(year from v_paid)::int - 1) || '-' || lpad((extract(year from v_paid)::int % 100)::text, 2, '0') end;
  insert into client_order_counters (fy, n) values (v_fy, 1) on conflict (fy) do update set n = client_order_counters.n + 1 returning n into v_n;
  v_no := 'AUZ/' || v_fy || '/' || lpad(v_n::text, 4, '0');
  v_utr := nullif(trim(coalesce(p_utr, o.payment->>'utr', '')), '');
  update client_orders set status = 'paid', tenant_id = v_tid, quote = q, totals = t, invoice_no = v_no, invoice_date = v_paid, paid_at = v_paid::timestamptz, updated_at = now(),
    payment = payment || jsonb_build_object('confirmed_at', now(), 'utr', v_utr) where id = p_id;
  perform admin_add_client_payment(v_tid, (t->>'total')::numeric, v_paid, case when o.payment->>'mode' = 'cash' then 'cash' when v_utr is null then 'other' else 'upi' end, v_utr, 'Order ' || v_no, 'Client request payment');
  perform admin_log('order_paid', 'client_order', p_id::text, jsonb_build_object('business', o.business_name, 'invoice', v_no, 'total', t->'total'));
  -- automation rule (c): a welcome task for every active support team member -- never blocks the payment itself
  begin
    for m in select id from platform_salesmen where active and role = 'support' loop
      perform team_auto_task(m.id, 'Send a welcome message to ' || coalesce(o.business_name, 'the new client'), 'auto:payment_welcome',
        jsonb_build_object('tenant_id', v_tid));
    end loop;
  exception when others then null;
  end;
  return jsonb_build_object('invoice_no', v_no, 'tenant_id', v_tid);
end $$;

-- 4. remove the price list, bundles, tiers and add-on prices
drop function if exists admin_delete_bundle(text);
drop function if exists admin_list_bundles();
drop function if exists admin_list_niche_addons();
drop function if exists admin_list_salon_tiers();
drop function if exists admin_save_bundle(text, text, text[], numeric, numeric, numeric, text, text, boolean, boolean, numeric);
drop function if exists admin_save_niche_addon(jsonb);
drop function if exists admin_save_salon_tier(jsonb);
drop function if exists admin_set_addon_price(text, text, numeric);
drop function if exists admin_set_bundle_price(text, numeric);
drop function if exists admin_set_product_price(text, numeric);
drop function if exists admin_set_product_yearly(text, numeric, numeric);
drop function if exists bundle_effective(bundles);
drop function if exists public_addon_price_overrides();
drop function if exists public_bundles();
drop function if exists public_niche_addons(text);
drop function if exists public_plan_tiers(text);
drop function if exists public_product_prices();
drop function if exists public_salon_tiers();
drop table if exists niche_addons;
drop table if exists salon_plan_tiers;
drop table if exists addon_price_overrides;
drop table if exists bundles;
drop table if exists product_prices;

-- 5. names for the services and add-ons that can be asked for on the request page
create or replace function order_product_label(k text) returns text language sql immutable as $$
  select case k when 'pos' then 'AUZsPOS' when 'self_order' then 'AUZsPOS QR' when 'payroll' then 'AUZsPay' when 'accounting' then 'AUZsLedger' when 'mobile' then 'AUZsMob' when 'scan' then 'AUZsScan'
    when 'style' then 'AUZsStyle' when 'finance' then 'AUZsFinance'
    when 'salon' then 'AUZslab Salon' when 'website_builder' then 'Website Builder' when 'crm' then 'CRM' when 'billing' then 'Billing & Invoicing' when 'inventory' then 'Inventory'
    when 'addon_hardware' then 'Hardware integration' when 'addon_website' then 'Website' when 'addon_whatsapp' then 'WhatsApp automation' else k end
$$;
