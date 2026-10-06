-- =========================================================
-- Real prices, set from the owner's own pricing sheet (AUZsPOS,
-- AUZsPOS QR, AUZsPay, AUZsLedger, plus discounted bundles) -- the
-- first real numbers db/070's product_prices table has ever held.
--
-- Individual prices alone aren't enough to charge correctly: the
-- pricing sheet's bundles are NOT simple sums of the individual prices
-- (e.g. Starter = AUZsPOS + AUZsPay priced together at Rs 2,398, which
-- uses AUZsPay's Rs 1,399 "already on AUZsPOS" add-on rate, not its
-- Rs 999 standalone rate -- and Complete/Complete QR are further
-- discounted below even that). Without this migration, a customer
-- whose cart happened to contain exactly a bundle's products would be
-- charged the naive sum (payments.js's priceFeatures(), summing
-- product_prices) instead of the real bundle price -- undercutting
-- the business relative to the pricing sheet it was designed from.
-- `bundles` is checked FIRST, by exact feature-key-set match, before
-- falling back to the flat per-product sum for anything else.
-- =========================================================

update product_prices set monthly_price = 999 where key = 'pos';
update product_prices set monthly_price = 300 where key = 'self_order'; -- pos(999) + self_order(300) = AUZsPOS QR's 1,299
update product_prices set monthly_price = 999 where key = 'payroll';
update product_prices set monthly_price = 1599 where key = 'accounting';
-- crm/billing/inventory/website_builder/salon stay at 0 (unpriced) --
-- they aren't part of this pricing sheet (folded into AUZsPOS, or a
-- separate product line entirely) and stay on the manual request flow.

create table bundles (
  key                text primary key,
  label              text not null,
  feature_keys       text[] not null,
  monthly_price      numeric(10,2) not null,
  updated_at         timestamptz not null default now()
);
insert into bundles (key, label, feature_keys, monthly_price) values
  ('starter',     'Starter business (AUZsPOS + AUZsPay)',                       array['pos','payroll'],                        2398),
  ('growing',     'Growing business (AUZsPOS QR + AUZsPay)',                    array['pos','self_order','payroll'],           2698),
  ('complete',    'Complete business (AUZsPOS + AUZsPay + AUZsLedger)',         array['pos','payroll','accounting'],           3499),
  ('complete_qr', 'Complete QR business (AUZsPOS QR + AUZsPay + AUZsLedger)',   array['pos','self_order','payroll','accounting'], 3799);

-- Anon-callable, same reasoning as public_product_prices() -- the cart
-- page needs to price a combination correctly before anyone signs in.
-- jsonb return, not `returns table` (see public_product_prices' own
-- comment, db/070, and list_clients', db/006, for why).
create function public_bundles()
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', key, 'label', label, 'feature_keys', to_jsonb(feature_keys), 'monthly_price', monthly_price) order by key), '[]'::jsonb)
  from bundles;
$$;

create function admin_set_bundle_price(p_key text, p_monthly_price numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then
    raise exception 'not authorized';
  end if;
  if p_monthly_price < 0 then
    raise exception 'price cannot be negative';
  end if;
  update bundles set monthly_price = p_monthly_price, updated_at = now() where key = p_key;
  if not found then
    raise exception 'unknown bundle key: %', p_key;
  end if;
end;
$$;

-- AUZsPay's price depends on who's buying it: Rs 999/month standalone,
-- but Rs 1,399/month as an add-on for a tenant that already has AUZsPOS
-- (the pricing sheet's "AUZSPAY ADD-ON" tier) -- not expressible as a
-- flat product_prices row or a bundle (those are for buying several
-- products together in ONE purchase; this is "the price of buying ONE
-- more product depends on what you already own"). One row per such
-- override, checked only when an addon_request is for exactly `key`
-- alone and the target tenant already has `requires` true.
create table addon_price_overrides (
  key             text not null,
  requires        text not null,
  monthly_price   numeric(10,2) not null,
  primary key (key, requires)
);
insert into addon_price_overrides (key, requires, monthly_price) values ('payroll', 'pos', 1399);

-- Anon-callable (well, really only ever used from the signed-in addon
-- flow, but kept consistent with public_product_prices/public_bundles)
-- so cart.html's own price preview can match what createOrder() will
-- actually charge, instead of only finding out at the Razorpay step.
create function public_addon_price_overrides()
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', key, 'requires', requires, 'monthly_price', monthly_price)), '[]'::jsonb)
  from addon_price_overrides;
$$;

-- Real bug caught testing this migration, fixed before ever shipping:
-- payments.js's createOrder() read addon_requests through a plain
-- pool.query with no app.uid set -- addon_requests' own RLS
-- (own_or_admin_read, db/027) would actually allow the owner through
-- once app.uid IS set (via withAuth), but tenant_settings has NO
-- owner-read policy at all (db/006: admin_all, is_platform_admin()
-- only) -- so a join against it can never see the target tenant's
-- current features for a normal owner, regardless of app.uid. This
-- SECURITY DEFINER function does the ownership check itself (the
-- addon_request must belong to the caller, via app_uid()) and only
-- then reads past tenant_settings' restrictive RLS -- called from
-- payments.js through withAuth(userId, ...) so app_uid() resolves
-- correctly inside it. Not registered in index.js's RPC allow-list --
-- same "trusted-backend-only" discipline as provision_from_payment.
create function addon_request_pricing_context(p_addon_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  select jsonb_build_object('features', ar.features, 'tenant_features', coalesce(ts.features, '{}'::jsonb))
  into result
  from addon_requests ar join tenant_settings ts on ts.tenant_id = ar.tenant_id
  where ar.id = p_addon_request_id and ar.user_id = app_uid() and ar.status = 'pending';
  return result;
end;
$$;

grant select, insert, update, delete on bundles to app;
grant select, insert, update, delete on addon_price_overrides to app;
