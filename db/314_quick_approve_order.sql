-- Owner request: the request -> quote -> payment-link -> client-pays flow (db/155) is too much friction for how
-- the business actually onboards clients -- they want to review a request and switch the client on immediately,
-- then collect payment themselves (cash, UPI, bank transfer) outside the platform and log it separately through
-- the existing "Client payments & bills" tool (client_payments, db/148) or Direct bills (db/282). Razorpay is not
-- part of this; it already only ever ran if RAZORPAY_KEY_ID was configured, and this path never touches it.
--
-- This adds a lighter path alongside the existing quote/bill flow (which still works for anyone who wants a formal
-- GST bill at signup) rather than replacing it: 'active' is a new resolved status meaning "switched on, no formal
-- bill made yet". A formal bill can still be built for an active client later -- admin_confirm_order_payment below
-- is taught to recognise a client_order that was already quick-approved (tenant_id already set) and update that
-- tenant's features instead of trying to provision a second one.

alter table client_orders drop constraint if exists client_orders_status_check;
alter table client_orders add constraint client_orders_status_check
  check (status in ('requested', 'verifying', 'confirmed', 'link_sent', 'payment_submitted', 'paid', 'rejected', 'billed', 'active'));

create or replace function admin_approve_order(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o client_orders; v_tid uuid; v_req uuid; v_slug text; v_feats jsonb := '{}';
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  select * into o from client_orders where id = p_id for update;
  if o.id is null then raise exception 'not found'; end if;
  if o.status in ('paid', 'rejected', 'active', 'billed') then raise exception 'This request is already resolved.'; end if;
  if coalesce(array_length(o.products, 1), 0) = 0 then raise exception 'This request has no products selected.'; end if;

  select jsonb_object_agg(k, true) into v_feats from unnest(o.products) k;

  if o.tenant_id is null then
    if o.user_id is null then raise exception 'The account that sent this request no longer exists.'; end if;
    v_slug := coalesce(nullif(o.slug, ''), nullif(regexp_replace(lower(coalesce(o.business_name, '')), '[^a-z0-9]', '', 'g'), ''), 'client' || substr(replace(o.id::text, '-', ''), 1, 6));
    v_slug := left(v_slug, 30);
    if exists (select 1 from tenants where slug = v_slug) then v_slug := left(v_slug, 24) || substr(replace(o.id::text, '-', ''), 1, 5); end if;
    insert into signup_requests (user_id, business_name, slug, features, notes, contact_name, phone, niche, address)
      values (o.user_id, o.business_name, v_slug, v_feats, 'From client order ' || o.id::text, o.contact_name, o.phone, o.niche, o.address) returning id into v_req;
    v_tid := approve_signup_request(v_req, coalesce(nullif(o.niche, ''), 'general'));
  else
    v_tid := o.tenant_id;
    perform admin_set_tenant_features(v_tid, v_feats);
  end if;

  update tenants set status = 'active' where id = v_tid;
  update client_orders set status = 'active', tenant_id = v_tid, updated_at = now() where id = p_id;
  perform admin_log('order_approved', 'client_order', p_id::text, jsonb_build_object('business', o.business_name, 'tenant', v_tid));
  return jsonb_build_object('tenant_id', v_tid, 'tenant_slug', (select slug from tenants where id = v_tid));
end $$;

-- a client that was quick-approved already has tenant_id set; build on that tenant instead of provisioning a
-- second one (this was previously keyed off o.kind = 'new', which assumed a quick-approve could never happen first)
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
  if o.tenant_id is null then
    if o.user_id is null then raise exception 'The account that sent this request no longer exists.'; end if;
    v_slug := coalesce(nullif(o.slug, ''), nullif(regexp_replace(lower(coalesce(o.business_name, '')), '[^a-z0-9]', '', 'g'), ''), 'client' || substr(replace(o.id::text, '-', ''), 1, 6));
    v_slug := left(v_slug, 30);
    if exists (select 1 from tenants where slug = v_slug) then v_slug := left(v_slug, 24) || substr(replace(o.id::text, '-', ''), 1, 5); end if;
    insert into signup_requests (user_id, business_name, slug, features, notes, contact_name, phone, niche, address)
      values (o.user_id, o.business_name, v_slug, v_feats, 'From client order ' || o.id::text, o.contact_name, o.phone, o.niche, o.address) returning id into v_req;
    v_tid := approve_signup_request(v_req, coalesce(nullif(o.niche, ''), 'general'));
  else
    v_tid := o.tenant_id;
    perform admin_set_tenant_features(v_tid, v_feats);
  end if;
  update tenants set renewal_date = v_min, monthly_fee = (select coalesce(monthly_fee, 0) from tenants where id = v_tid) * (case when o.kind = 'addon' then 1 else 0 end) + v_month, status = 'active' where id = v_tid;
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

-- "open" (the default admin list) now excludes quick-approved orders too -- they're resolved, not pending
create or replace function admin_list_client_orders(p_status text default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'status', status, 'kind', kind, 'business_name', business_name, 'contact_name', contact_name, 'phone', phone, 'niche', niche,
      'products', to_jsonb(products), 'total', totals->>'total', 'created_at', created_at, 'invoice_no', invoice_no, 'bill_sent_at', bill_sent_at, 'has_proof', (payment->>'proof') is not null) order by created_at desc)
    from client_orders where p_status is null or p_status = '' or (p_status = 'open' and status not in ('paid', 'rejected', 'active', 'billed')) or status = p_status), '[]'::jsonb);
end $$;
