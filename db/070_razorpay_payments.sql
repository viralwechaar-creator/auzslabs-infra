-- =========================================================
-- Real payment: a client picks products in the cart, pays with
-- Razorpay (cards/UPI/netbanking), and is auto-activated the moment
-- the payment is confirmed -- no platform admin has to review and
-- click Approve first. Same dormant-until-configured discipline as
-- every other optional integration in this project (mail.js,
-- sms.js, Google/Apple sign-in): with no RAZORPAY_KEY_ID/SECRET set,
-- nothing here is reachable and the existing manual
-- request-then-we-approve flow (db/007/db/027) is completely
-- unchanged -- this never replaces it, only sits alongside it.
--
-- One thing this migration deliberately does NOT invent: actual
-- prices. The marketing site has never shown a real number anywhere
-- (every product page just says "contact us") -- product_prices
-- starts every key at 0, which the cart/checkout code below treats
-- as "not priced yet" and keeps that item on the existing manual
-- flow. A platform admin sets real prices from admin.html's new
-- Pricing panel; a product only ever gets an instant "Pay & activate"
-- button once it actually has a price.
-- =========================================================

create table product_prices (
  key                  text primary key,
  label                text not null,
  monthly_price        numeric(10,2) not null default 0,
  updated_at           timestamptz not null default now()
);
insert into product_prices (key, label) values
  ('salon', 'AUZslab Salon'), ('pos', 'POS'), ('crm', 'CRM'), ('billing', 'Billing & Invoicing'),
  ('inventory', 'Inventory'), ('self_order', 'QR Ordering'), ('payroll', 'Payroll'),
  ('website_builder', 'Website Builder'), ('accounting', 'Accounting');

-- Anon-callable -- the cart page needs to show prices before anyone signs
-- in. returns jsonb (not `returns table`) -- callRpc's `select
-- fnName(...) as result` / `rows[0]?.result` convention would otherwise
-- expand a `returns table` function's rows into multiple result rows and
-- silently drop everything but the first one (see list_clients' own
-- comment, db/006, for the full explanation -- every multi-row RPC in
-- this schema follows this same jsonb convention for that reason).
create function public_product_prices()
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', key, 'label', label, 'monthly_price', monthly_price) order by key), '[]'::jsonb)
  from product_prices;
$$;

create function admin_set_product_price(p_key text, p_monthly_price numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then
    raise exception 'not authorized';
  end if;
  if p_monthly_price < 0 then
    raise exception 'price cannot be negative';
  end if;
  update product_prices set monthly_price = p_monthly_price, updated_at = now() where key = p_key;
  if not found then
    raise exception 'unknown product key: %', p_key;
  end if;
end;
$$;

-- One row per Razorpay order. Whether it becomes a brand-new tenant
-- (signup_request_id) or an add-on for an existing one
-- (addon_request_id) -- exactly one of the two is set. No RLS: like
-- auth_users/phone_otps/password_resets, this table is never exposed
-- through the generic /db/:table whitelist (server/src/index.js) --
-- the only code that ever touches it is server/src/payments.js
-- (webhook-driven, often with no logged-in caller at all) and the two
-- SECURITY DEFINER RPCs below, which check ownership themselves.
create table payments (
  id                   uuid primary key default gen_random_uuid(),
  razorpay_order_id    text not null unique,
  razorpay_payment_id  text,
  user_id              uuid not null references auth_users(id) on delete cascade,
  signup_request_id    uuid references signup_requests(id) on delete set null,
  addon_request_id     uuid references addon_requests(id) on delete set null,
  amount               numeric(10,2) not null,
  status               text not null default 'created' check (status in ('created', 'paid', 'failed')),
  created_at           timestamptz not null default now(),
  paid_at              timestamptz,
  constraint payments_exactly_one_target check (
    (signup_request_id is not null and addon_request_id is null) or
    (signup_request_id is null and addon_request_id is not null)
  )
);
create index idx_payments_user on payments (user_id, created_at desc);

-- Lets the cart page poll "has my payment gone through yet" after the
-- Razorpay checkout modal's own client-side handler fires (which this
-- project never trusts on its own -- see payments.js's own comment on
-- why only the webhook, signature-verified, can ever mark a payment paid).
create function payment_status(p_order_id text)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p payments%rowtype; slug text;
begin
  select * into p from payments where razorpay_order_id = p_order_id and user_id = app_uid();
  if not found then
    raise exception 'payment not found';
  end if;
  if p.status = 'paid' then
    if p.signup_request_id is not null then
      select sr.slug into slug from signup_requests sr where sr.id = p.signup_request_id;
    else
      select ar.tenant_slug into slug from addon_requests ar where ar.id = p.addon_request_id;
    end if;
  end if;
  return jsonb_build_object('status', p.status, 'tenant_slug', slug);
end;
$$;

-- Platform-admin visibility into what's actually been collected,
-- without needing to open the Razorpay dashboard separately.
create function admin_list_payments()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then
    raise exception 'not authorized';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id, 'razorpay_order_id', p.razorpay_order_id, 'user_email', au.email,
      'kind', case when p.signup_request_id is not null then 'signup' else 'addon' end,
      'target_name', coalesce(sr.business_name, ar.tenant_name),
      'amount', p.amount, 'status', p.status, 'created_at', p.created_at, 'paid_at', p.paid_at
    ) order by p.created_at desc)
    from payments p
    join auth_users au on au.id = p.user_id
    left join signup_requests sr on sr.id = p.signup_request_id
    left join addon_requests ar on ar.id = p.addon_request_id
  ), '[]'::jsonb);
end;
$$;

-- ---- Trusted-backend-only provisioning, called from payments.js
-- after the Razorpay webhook signature has already been verified --
-- deliberately NOT registered in index.js's RPC allow-list, so
-- there is no HTTP path to it at all (same discipline as
-- acc_do_post/acc_post_journal -- see CLAUDE.md's Accounting
-- section). Each one re-does the exact same work
-- approve_signup_request/approve_addon_request already do, just
-- without the is_platform_admin() check those require -- trusting
-- instead that the only caller is the webhook handler, which already
-- confirmed real money was captured before ever calling this. ----

create function provision_from_payment(p_payment_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare pay payments%rowtype; req signup_requests%rowtype; tid uuid;
begin
  select * into pay from payments where id = p_payment_id and status = 'paid';
  if not found or pay.signup_request_id is null then
    raise exception 'payment not found, not paid, or not a signup payment';
  end if;

  select * into req from signup_requests where id = pay.signup_request_id and status = 'pending';
  if not found then
    -- Already provisioned (webhook retried/duplicated) -- return the existing tenant id instead of erroring.
    select id into tid from tenants where slug = (select slug from signup_requests where id = pay.signup_request_id);
    return tid;
  end if;

  insert into tenants (name, slug, niche, status, monthly_fee)
  values (req.business_name, req.slug, coalesce(req.niche, 'general'), 'active', pay.amount)
  returning id into tid;

  insert into tenant_settings (tenant_id, features) values (tid, req.features);

  insert into records (id, tenant_id, kind, data)
  values ('settings', tid, 'settings', jsonb_build_object('name', req.business_name));

  insert into profiles (id, tenant_id, email, role)
  values (req.user_id, tid, (select email from auth_users where id = req.user_id), 'owner');

  update signup_requests set status = 'approved' where id = pay.signup_request_id;

  return tid;
end;
$$;

create function provision_addon_from_payment(p_payment_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare pay payments%rowtype; req addon_requests%rowtype;
begin
  select * into pay from payments where id = p_payment_id and status = 'paid';
  if not found or pay.addon_request_id is null then
    raise exception 'payment not found, not paid, or not an add-on payment';
  end if;

  select * into req from addon_requests where id = pay.addon_request_id and status = 'pending';
  if not found then
    return; -- already applied (webhook retried/duplicated) -- nothing left to do
  end if;

  update tenant_settings set features = coalesce(features, '{}'::jsonb) || req.features where tenant_id = req.tenant_id;
  update addon_requests set status = 'approved' where id = pay.addon_request_id;

  insert into notifications (tenant_id, type, title, body)
  values (req.tenant_id, 'addon_approved', 'New service added to your account',
    'Refresh your account page -- ' || (select string_agg(k, ', ') from jsonb_object_keys(req.features) k) || ' is now live on your subscription.');
end;
$$;

-- New tables -- 999_app_grants.sql's blanket grant only covers what
-- existed the moment it last ran (see CLAUDE.md's migration gotcha).
grant select, insert, update, delete on product_prices to app;
grant select, insert, update, delete on payments to app;
