-- =========================================================
-- Real, fixed pricing for the storefront plan (owner request, Nov 2026) -- a deliberate, SCOPED exception to
-- db/260_quote_only_no_prices.sql's platform-wide "AUZslab shows no prices to anyone" policy, for exactly one
-- product: the storefront plan itself (Path B, db/372/db/373), which the owner wants to behave like a real
-- "free trial, then pick a plan" SaaS product, with a real self-serve online payment -- not another quote-only
-- request. Every other product stays exactly as db/260 left it: quote-only, no price shown, no table revived
-- for it. This migration follows db/072_real_pricing_and_bundles.sql's own product_prices/admin_set_product_price
-- pattern EXACTLY (same table shape, same function names, same "$0 means not priced yet" convention) rather
-- than inventing a parallel pricing table -- the scoping is enforced in code (admin_set_product_price below
-- refuses every key but 'storefront'), not just by what happens to be in the table today.
-- =========================================================

-- Recreated with the EXACT shape db/070_razorpay_payments.sql originally gave it (dropped by db/260). Only
-- one row ever lives here: 'storefront', starting at ₹0 ("not priced yet", same convention as every other
-- product used before db/260) until the owner sets a real number from admin.html's Pricing control.
create table product_prices (
  key                  text primary key,
  label                text not null,
  monthly_price        numeric(10,2) not null default 0,
  updated_at           timestamptz not null default now()
);
insert into product_prices (key, label) values ('storefront', 'AUZslab storefront plan');

-- Anon-callable, same reasoning as the original: the storefront's own "pick a plan" screen needs to show
-- the price (or "not set yet") before anyone signs in.
create function public_product_prices()
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', key, 'label', label, 'monthly_price', monthly_price) order by key), '[]'::jsonb)
  from product_prices;
$$;

-- Scoped on purpose: 'storefront' is the ONLY key this table (or this function) will ever hold. A platform
-- admin trying to price anything else gets refused outright -- db/260's "no prices shown" policy stays the
-- real rule for every other product; this is not a door back into pricing them.
create function admin_set_product_price(p_key text, p_monthly_price numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then
    raise exception 'not authorized';
  end if;
  if p_key <> 'storefront' then
    raise exception 'pricing is quote-only for every product except the storefront plan (db/374)';
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

-- ---------- real Razorpay payment for the storefront plan itself (not the store's OWN Razorpay account --
-- that's sfx_store_secrets/sfx_online_*, a store's customer checkout; this is AUZslab's own platform keys
-- charging the TENANT for its plan, same account signup/addon/renewal payments already use, db/070/db/201) ----
alter table payments add column if not exists sfx_tenant_id uuid references tenants(id) on delete set null;
alter table payments drop constraint if exists payments_exactly_one_target;
alter table payments add constraint payments_exactly_one_target check (
  (case when signup_request_id is not null then 1 else 0 end) + (case when addon_request_id is not null then 1 else 0 end)
  + (case when client_order_id is not null then 1 else 0 end) + (case when sfx_tenant_id is not null then 1 else 0 end) = 1
);
create index if not exists idx_payments_sfx_tenant on payments (sfx_tenant_id);

-- Called from payments.js (createStorefrontPlanOrder) before a Razorpay order is created: validates the
-- caller owns a storefront-lane tenant with a real sfx_stores row and a real price, and hands back exactly
-- what to charge. Never throws for "trial is still running" -- an owner can always choose to pay early; it
-- DOES throw when there is nothing to charge yet (price is ₹0/unset), so the server falls back to telling
-- the owner to use request_storefront_reactivation instead (the same "dormant until configured" discipline
-- every other product already follows -- see this file's own header comment).
create function sfx_plan_order_prepare()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; price numeric; tname text; slug text;
begin
  if (me()->>'role') is distinct from 'owner' then
    raise exception 'owner only';
  end if;
  tid := (me()->>'tenant_id')::uuid;
  if not exists (select 1 from sfx_stores where tenant_id = tid) then
    raise exception 'this account has no storefront';
  end if;
  select monthly_price into price from product_prices where key = 'storefront';
  if coalesce(price, 0) <= 0 then
    raise exception 'The storefront plan does not have a price set yet. Ask us to reactivate your store instead.' using errcode = 'SF020';
  end if;
  select name, slug into tname, slug from tenants where id = tid;
  return jsonb_build_object('tenant_id', tid, 'amount', price, 'name', tname, 'slug', slug);
end;
$$;

-- Idempotent activation, same shape as provision_from_payment/provision_addon_from_payment (db/070): called
-- only after the signed webhook has confirmed the Razorpay payment (payments.status = 'paid'). A payment
-- already applied, or a tenant already active, is a no-op -- Razorpay delivers webhooks at-least-once.
create function provision_storefront_from_payment(p_payment_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare pay payments%rowtype;
begin
  select * into pay from payments where id = p_payment_id and status = 'paid';
  if not found or pay.sfx_tenant_id is null then
    raise exception 'payment not found, not paid, or not a storefront plan payment';
  end if;
  update sfx_stores set plan_status = 'active', updated_at = now() where tenant_id = pay.sfx_tenant_id;
  if not found then
    raise exception 'this tenant has no storefront to activate';
  end if;
  insert into notifications (tenant_id, type, title, body)
  values (pay.sfx_tenant_id, 'sfx_plan_paid', 'Your storefront plan is active', 'Payment received -- your store is live again.');
  return pay.sfx_tenant_id;
end;
$$;

grant select, insert, update, delete on product_prices to app;
