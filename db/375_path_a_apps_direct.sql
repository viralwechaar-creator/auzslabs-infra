-- =========================================================
-- Owner correction (Nov 2026) on Path A, after db/373: SCRAP the trimmed "basic dashboard" idea inside
-- account.html entirely. There is no separate dashboard for a Path-A tenant at all -- every one of
-- AUZsLedger/AUZsStyle/AUZslab Salon already has its own settings/account screens, and that is where a
-- Path-A owner's business details, renewal/plan info and staff management live. account.html's own job
-- for a Path-A tenant shrinks to ONE thing: redirect straight into that single app, the exact same way
-- it already redirects a SalesOS staffer straight to salesos.html (see account.html's boot(), unchanged).
--
-- The corrected Path A flow:
--   1. live-demo.html's "Get this app" button (AUZsLedger/AUZsStyle/AUZslab Salon only -- never the four
--      retired products) sends the person to cart.html with that product preselected (cart.html already
--      supports ?add=<key>, db/155/site/cart.html -- no new mechanism there).
--   2. They fill in business details and send the request through the SAME request-first flow every
--      other client_orders request already uses (submit_client_order, db/155) -- no second request
--      pipeline. The "+ website" add-on for AUZsStyle/Salon is cart.html's existing addon_website
--      checkbox (already a separately selectable, separately priced line on the admin's quote screen,
--      db/072's order_product_label 'Website' -- nothing new needed for that either).
--   3. AUZslab reviews it and sends a quote + payment link (cash or Razorpay) through the EXISTING
--      admin.html "Client requests" quote/payment-link screen (admin_save_order_quote, admin_set_order_
--      status, pay.html) -- the one quote/payment-link mechanism this codebase has; this migration does
--      not add a second one.
--   4. Paying (cash, confirmed by the admin, OR Razorpay, confirmed by the signed webhook -- both already
--      go through admin_confirm_order_payment, db/070/db/200) provisions the tenant exactly as it always
--      has. The only change here: the new tenant is tagged onboarding_path = 'basic' when (and only when)
--      the originating request itself was tagged that way -- i.e. it came through this new "Get this
--      app" entry point, not a plain cart.html visit or an admin-built custom order. Every existing/
--      other client_orders request keeps defaulting to 'full' and is completely unaffected.
-- =========================================================

alter table client_orders add column if not exists onboarding_path text not null default 'full'
  check (onboarding_path in ('full', 'basic'));

-- Same body as db/260's version, plus: the chosen app travels in p->>'onboarding_path' (set by cart.html
-- only when it was reached via live-demo.html's "Get this app" button, ?lane=basic) instead of always
-- defaulting to 'full'. Anything that isn't exactly 'basic' is treated as 'full' -- never raises, since
-- this argument is optional and every pre-existing caller never sends it.
create or replace function submit_client_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := app_uid(); v_tid uuid; v_tname text; v_name text := trim(coalesce(p->>'contact_name', '')); v_phone text := trim(coalesce(p->>'phone', ''));
  v_biz text := trim(coalesce(p->>'business_name', '')); v_gst text := nullif(upper(trim(coalesce(p->>'gstin', ''))), ''); v_prods text[]; v_id uuid; v_tok text; v_state text;
  v_niche text; v_lane text := case when p->>'onboarding_path' = 'basic' then 'basic' else 'full' end;
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
  insert into client_orders (user_id, tenant_id, kind, contact_name, phone, email, gstin, address, state_code, business_name, slug, niche, requirement, notes, products, selection, onboarding_path)
  values (v_uid, v_tid, case when v_tid is null then 'new' else 'addon' end, left(v_name, 120), left(v_phone, 30), left(nullif(trim(coalesce(p->>'email', '')), ''), 160), v_gst,
    left(nullif(trim(coalesce(p->>'address', '')), ''), 400), v_state, coalesce(v_tname, left(v_biz, 160)),
    left(nullif(regexp_replace(lower(coalesce(p->>'slug', '')), '[^a-z0-9]', '', 'g'), ''), 30),
    case when p->>'niche' in ('cafe', 'salon', 'gym', 'retail', 'mobile', 'general') then p->>'niche'
         when v_niche in ('cafe', 'salon', 'mobile') then v_niche else 'general' end,
    left(nullif(trim(coalesce(p->>'requirement', '')), ''), 2000), left(nullif(trim(coalesce(p->>'notes', '')), ''), 2000), v_prods, null, v_lane)
  returning id, token into v_id, v_tok;
  insert into notifications (tenant_id, type, title, body) values (null, 'client_order', 'New client request: ' || coalesce(v_tname, v_biz), v_name || ' · ' || v_phone);
  return jsonb_build_object('id', v_id, 'token', v_tok);
end $$;

-- Same body as db/260's version, plus: the new signup_requests row (and therefore the tenant
-- approve_signup_request creates from it) now carries o.onboarding_path instead of always defaulting to
-- 'full'. The 'addon' branch (an existing tenant adding a product) is untouched -- onboarding_path only
-- ever matters for a brand-new tenant.
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
    insert into signup_requests (user_id, business_name, slug, features, notes, contact_name, phone, niche, address, onboarding_path)
      values (o.user_id, o.business_name, v_slug, v_feats, 'From client order ' || o.id::text, o.contact_name, o.phone, o.niche, o.address, coalesce(o.onboarding_path, 'full')) returning id into v_req;
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
