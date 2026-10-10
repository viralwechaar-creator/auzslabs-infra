-- Request-first onboarding ("client orders"): a visitor fills in their details and requirements and sends a REQUEST (no prices, no payment).
-- The platform admin verifies the business, builds a quote (products, GST, discount, setup fee, custom charges), and sends the client a
-- payment link on WhatsApp. The client reads the terms, ticks the box, pays by UPI and uploads a screenshot; the admin confirms the payment,
-- which switches the products on, gives the bill a gapless number and fixes the renewal dates, and sends the A4 bill on WhatsApp.
-- Status: requested -> verifying -> confirmed -> link_sent -> payment_submitted -> paid   (rejected at any point before paid)
-- The table has RLS on and no policies: it is reached ONLY through the SECURITY DEFINER functions below (client by unguessable token).
create table if not exists client_orders (
  id uuid primary key default gen_random_uuid(),
  token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  user_id uuid references auth_users(id) on delete set null,
  tenant_id uuid references tenants(id) on delete set null,
  kind text not null default 'new' check (kind in ('new', 'addon')),
  status text not null default 'requested' check (status in ('requested', 'verifying', 'confirmed', 'link_sent', 'payment_submitted', 'paid', 'rejected')),
  contact_name text, phone text, email text, gstin text, address text, state_code text,
  business_name text, slug text, niche text, requirement text, notes text,
  products text[] not null default '{}',
  quote jsonb, totals jsonb,
  payment jsonb not null default '{}'::jsonb,
  invoice_no text, invoice_date date, paid_at timestamptz, bill_sent_at timestamptz,
  admin_note text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table client_orders enable row level security;
create index if not exists client_orders_status_idx on client_orders (status, created_at desc);
create index if not exists client_orders_user_idx on client_orders (user_id);
create table if not exists client_order_counters (fy text primary key, n int not null);
alter table client_order_counters enable row level security;

-- the client's request (needs a login: the account becomes the business owner when access is given)
create or replace function submit_client_order(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_uid uuid := app_uid(); v_tid uuid; v_tname text; v_name text := trim(coalesce(p->>'contact_name', '')); v_phone text := trim(coalesce(p->>'phone', ''));
  v_biz text := trim(coalesce(p->>'business_name', '')); v_gst text := nullif(upper(trim(coalesce(p->>'gstin', ''))), ''); v_prods text[]; v_id uuid; v_tok text; v_state text;
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
  insert into client_orders (user_id, tenant_id, kind, contact_name, phone, email, gstin, address, state_code, business_name, slug, niche, requirement, notes, products)
  values (v_uid, v_tid, case when v_tid is null then 'new' else 'addon' end, left(v_name, 120), left(v_phone, 30), left(nullif(trim(coalesce(p->>'email', '')), ''), 160), v_gst,
    left(nullif(trim(coalesce(p->>'address', '')), ''), 400), v_state, coalesce(v_tname, left(v_biz, 160)),
    left(nullif(regexp_replace(lower(coalesce(p->>'slug', '')), '[^a-z0-9]', '', 'g'), ''), 30),
    case when p->>'niche' in ('cafe', 'salon', 'gym', 'retail', 'mobile', 'general') then p->>'niche' else 'general' end,
    left(nullif(trim(coalesce(p->>'requirement', '')), ''), 2000), left(nullif(trim(coalesce(p->>'notes', '')), ''), 2000), v_prods)
  returning id, token into v_id, v_tok;
  insert into notifications (tenant_id, type, title, body) values (null, 'client_order', 'New client request: ' || coalesce(v_tname, v_biz), v_name || ' · ' || v_phone);
  return jsonb_build_object('id', v_id, 'token', v_tok);
end $$;

-- my own requests (so a signed-in client can find the payment page again)
create or replace function my_client_orders() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('token', token, 'status', status, 'business_name', business_name, 'created_at', created_at, 'products', to_jsonb(products), 'invoice_no', invoice_no) order by created_at desc), '[]'::jsonb)
  from client_orders where user_id = app_uid()
$$;

-- ---------- totals ----------
create or replace function order_product_label(k text) returns text language sql immutable as $$
  select case k when 'pos' then 'AUZsPOS' when 'self_order' then 'AUZsPOS QR' when 'payroll' then 'AUZsPay' when 'accounting' then 'AUZsLedger' when 'mobile' then 'AUZsMob' when 'scan' then 'AUZsScan'
    when 'salon' then 'AUZslab Salon' when 'website_builder' then 'Website Builder' when 'crm' then 'CRM' when 'billing' then 'Billing & Invoicing' when 'inventory' then 'Inventory' else k end
$$;
-- quote = {items:[{key,label,plan:'month'|'year',rate,discount,gst}], setup:{on,amount,gst}, custom:[{label,amount,gst}], note}
-- All amounts are excluding GST. GST is CGST+SGST when the client is in Rajasthan (code 08, or no state given), else IGST.
create or replace function client_order_totals(p_quote jsonb, p_state text) returns jsonb
language plpgsql immutable as $$
declare l jsonb; lines jsonb := '[]'; net numeric; g numeric; gamt numeric; sub numeric := 0; dis numeric := 0; tax numeric := 0; gsum numeric := 0; intra boolean := coalesce(nullif(p_state, ''), '08') = '08';
  rate numeric; disc numeric; src text; lbl text;
begin
  for l in select * from jsonb_array_elements(coalesce(p_quote->'items', '[]'::jsonb)) loop
    rate := greatest(coalesce((l->>'rate')::numeric, 0), 0); disc := least(greatest(coalesce((l->>'discount')::numeric, 0), 0), rate);
    net := round(rate - disc, 2); g := greatest(coalesce((l->>'gst')::numeric, 0), 0); gamt := round(net * g / 100, 2);
    lines := lines || jsonb_build_array(jsonb_build_object('type', 'product', 'key', l->>'key', 'label', coalesce(nullif(l->>'label', ''), order_product_label(l->>'key')), 'plan', coalesce(nullif(l->>'plan', ''), 'month'), 'rate', rate, 'discount', disc, 'net', net, 'gst', g, 'gst_amt', gamt, 'total', net + gamt, 'renewal', l->>'renewal'));
    sub := sub + rate; dis := dis + disc; tax := tax + net; gsum := gsum + gamt;
  end loop;
  if coalesce((p_quote#>>'{setup,on}')::boolean, false) then
    rate := greatest(coalesce((p_quote#>>'{setup,amount}')::numeric, 0), 0); disc := least(greatest(coalesce((p_quote#>>'{setup,discount}')::numeric, 0), 0), rate);
    net := round(rate - disc, 2); g := greatest(coalesce((p_quote#>>'{setup,gst}')::numeric, 0), 0); gamt := round(net * g / 100, 2);
    lines := lines || jsonb_build_array(jsonb_build_object('type', 'setup', 'label', 'One-time setup and onboarding', 'rate', rate, 'discount', disc, 'net', net, 'gst', g, 'gst_amt', gamt, 'total', net + gamt));
    sub := sub + rate; dis := dis + disc; tax := tax + net; gsum := gsum + gamt;
  end if;
  for l in select * from jsonb_array_elements(coalesce(p_quote->'custom', '[]'::jsonb)) loop
    lbl := trim(coalesce(l->>'label', '')); if lbl = '' then continue; end if;
    rate := coalesce((l->>'amount')::numeric, 0); g := greatest(coalesce((l->>'gst')::numeric, 0), 0);
    net := round(rate, 2); gamt := round(net * g / 100, 2);   -- a custom line may be negative (an adjustment)
    lines := lines || jsonb_build_array(jsonb_build_object('type', 'custom', 'label', left(lbl, 120), 'rate', rate, 'discount', 0, 'net', net, 'gst', g, 'gst_amt', gamt, 'total', net + gamt));
    sub := sub + rate; tax := tax + net; gsum := gsum + gamt;
  end loop;
  return jsonb_build_object('lines', lines, 'subtotal', round(sub, 2), 'discount', round(dis, 2), 'taxable', round(tax, 2), 'intra', intra,
    'cgst', case when intra then round(gsum / 2, 2) else 0 end, 'sgst', case when intra then round(gsum, 2) - round(gsum / 2, 2) else 0 end, 'igst', case when intra then 0 else round(gsum, 2) end,
    'gst', round(gsum, 2), 'total', round(tax + gsum, 2));
end $$;

-- ---------- what the client sees (token = the secret) ----------
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
    'payment', jsonb_build_object('utr', o.payment->>'utr', 'submitted_at', o.payment->>'submitted_at', 'terms_accepted_at', o.payment->>'terms_accepted_at', 'proof', coalesce((o.payment->>'proof') is not null, false)),
    'invoice_no', o.invoice_no, 'invoice_date', o.invoice_date, 'paid_at', o.paid_at, 'created_at', o.created_at, 'tenant_slug', (select slug from tenants where id = o.tenant_id));
end $$;

-- the client reports their payment: terms ticked, UTR typed (the screenshot is uploaded separately through the API)
create or replace function public_order_submit_payment(p_token text, p_utr text, p_terms boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o client_orders;
begin
  select * into o from client_orders where token = p_token for update;
  if o.id is null then raise exception 'This link is not valid.'; end if;
  if o.status not in ('link_sent', 'payment_submitted') then raise exception 'This request is not waiting for a payment.'; end if;
  if not coalesce(p_terms, false) then raise exception 'Please tick the box to accept the Terms, Privacy Policy and Refund Policy.'; end if;
  if (o.payment->>'proof') is null and coalesce(trim(p_utr), '') = '' then raise exception 'Please upload the payment screenshot (and type the UTR if you have it).'; end if;
  update client_orders set status = 'payment_submitted', updated_at = now(),
    payment = payment || jsonb_build_object('utr', nullif(left(trim(coalesce(p_utr, '')), 40), ''), 'terms_accepted_at', now(), 'terms_version', coalesce((select value from platform_flags where key = 'privacy_version'), '2026-10'), 'submitted_at', now())
    where id = o.id;
  insert into notifications (tenant_id, type, title, body) values (null, 'client_order_paid', 'Payment submitted: ' || coalesce(o.business_name, ''), 'Check the screenshot and confirm the payment.');
  return jsonb_build_object('ok', true);
end $$;

-- called by the upload route (server code, not registered as an RPC): is this token waiting for a payment, and remember the file
create or replace function order_proof_target(p_token text) returns uuid
language sql stable security definer set search_path = public as $$
  select id from client_orders where token = p_token and status in ('link_sent', 'payment_submitted')
$$;
create or replace function order_proof_record(p_id uuid, p_file text) returns void
language sql security definer set search_path = public as $$
  update client_orders set payment = payment || jsonb_build_object('proof', p_file, 'proof_at', now()), updated_at = now() where id = p_id
$$;

-- ---------- admin ----------
create or replace function admin_list_client_orders(p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'status', status, 'kind', kind, 'business_name', business_name, 'contact_name', contact_name, 'phone', phone, 'niche', niche,
      'products', to_jsonb(products), 'total', totals->>'total', 'created_at', created_at, 'invoice_no', invoice_no, 'bill_sent_at', bill_sent_at, 'has_proof', (payment->>'proof') is not null) order by created_at desc)
    from client_orders where p_status is null or p_status = '' or (p_status = 'open' and status not in ('paid', 'rejected')) or status = p_status), '[]'::jsonb);
end $$;

create or replace function admin_get_client_order(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare o client_orders; t jsonb;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  select * into o from client_orders where id = p_id;
  if o.id is null then raise exception 'not found'; end if;
  t := to_jsonb(o) - 'user_id';
  return t || jsonb_build_object('user_email', (select email from auth_users where id = o.user_id), 'tenant_slug', (select slug from tenants where id = o.tenant_id),
    'default_gst', coalesce((select value from platform_flags where key = 'gst_rate_pct'), '0'));
end $$;

create or replace function admin_set_order_status(p_id uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare o client_orders;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  select * into o from client_orders where id = p_id for update;
  if o.id is null then raise exception 'not found'; end if;
  if p_status not in ('requested', 'verifying', 'confirmed', 'link_sent', 'rejected') then raise exception 'Use Confirm payment to mark an order paid.'; end if;
  if o.status = 'paid' then raise exception 'This order is already paid.'; end if;
  if p_status = 'link_sent' and (o.quote is null or o.totals is null) then raise exception 'Save the quote first, then send the payment link.'; end if;
  if p_status = 'link_sent' and o.status = 'payment_submitted' then return; end if;
  update client_orders set status = p_status, admin_note = coalesce(nullif(p_note, ''), admin_note), updated_at = now() where id = p_id;
  perform admin_log('order_status', 'client_order', p_id::text, jsonb_build_object('status', p_status, 'business', o.business_name));
end $$;

create or replace function admin_update_client_order(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare o client_orders;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  select * into o from client_orders where id = p_id for update;
  if o.id is null then raise exception 'not found'; end if;
  if o.status = 'paid' then raise exception 'A paid order cannot be edited.'; end if;
  update client_orders set
    contact_name = coalesce(nullif(trim(p->>'contact_name'), ''), contact_name), phone = coalesce(nullif(trim(p->>'phone'), ''), phone), email = case when p ? 'email' then nullif(trim(p->>'email'), '') else email end,
    gstin = case when p ? 'gstin' then nullif(upper(trim(p->>'gstin')), '') else gstin end, address = case when p ? 'address' then nullif(trim(p->>'address'), '') else address end,
    state_code = case when p ? 'state_code' then nullif(trim(p->>'state_code'), '') else state_code end,
    business_name = coalesce(nullif(trim(p->>'business_name'), ''), business_name),
    slug = case when p ? 'slug' then nullif(regexp_replace(lower(coalesce(p->>'slug', '')), '[^a-z0-9]', '', 'g'), '') else slug end,
    niche = case when p->>'niche' in ('cafe', 'salon', 'gym', 'retail', 'mobile', 'general') then p->>'niche' else niche end,
    admin_note = case when p ? 'admin_note' then nullif(trim(p->>'admin_note'), '') else admin_note end, updated_at = now()
  where id = p_id;
  perform admin_log('order_edit', 'client_order', p_id::text, jsonb_build_object('business', o.business_name));
end $$;

create or replace function admin_save_order_quote(p_id uuid, p_quote jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o client_orders; t jsonb;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  select * into o from client_orders where id = p_id for update;
  if o.id is null then raise exception 'not found'; end if;
  if o.status in ('paid', 'rejected') then raise exception 'This order can no longer be changed.'; end if;
  if jsonb_array_length(coalesce(p_quote->'items', '[]'::jsonb)) = 0 then raise exception 'Add at least one product to the quote.'; end if;
  t := client_order_totals(p_quote, o.state_code);
  if (t->>'total')::numeric <= 0 then raise exception 'The total must be more than zero.'; end if;
  update client_orders set quote = p_quote, totals = t, updated_at = now(),
    status = case when status in ('requested', 'verifying') then 'confirmed' else status end where id = p_id;
  perform admin_log('order_quote', 'client_order', p_id::text, jsonb_build_object('business', o.business_name, 'total', t->'total'));
  return t;
end $$;

-- payment confirmed: give the access, number the bill, fix the renewal dates, record the money
create or replace function admin_confirm_order_payment(p_id uuid, p_paid_on date default null, p_utr text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o client_orders; v_paid date; v_fy text; v_n int; v_no text; v_items jsonb := '[]'; l jsonb; v_feats jsonb := '{}'; v_tid uuid; v_req uuid; v_slug text; v_min date := null; v_ren date; v_month numeric := 0; q jsonb; t jsonb; v_utr text;
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
  perform admin_add_client_payment(v_tid, (t->>'total')::numeric, v_paid, case when v_utr is null then 'other' else 'upi' end, v_utr, 'Order ' || v_no, 'Client request payment');
  perform admin_log('order_paid', 'client_order', p_id::text, jsonb_build_object('business', o.business_name, 'invoice', v_no, 'total', t->'total'));
  return jsonb_build_object('invoice_no', v_no, 'tenant_id', v_tid);
end $$;

create or replace function admin_mark_order_bill_sent(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  update client_orders set bill_sent_at = now(), updated_at = now() where id = p_id and status = 'paid';
end $$;

create or replace function admin_open_client_orders_count() returns int
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then return 0; end if;
  return (select count(*)::int from client_orders where status in ('requested', 'payment_submitted'));
end $$;

-- the platform admin's screenshot lookup (used by the authenticated GET /storage/order-proof/:id route; not an RPC)
create or replace function admin_order_proof(p_id uuid) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return (select payment->>'proof' from client_orders where id = p_id);
end $$;
