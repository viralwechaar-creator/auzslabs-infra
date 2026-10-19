-- =========================================================
-- AUZslab Salon's "four tier" pricing page (business-salons.html,
-- #salon-plans) was built as a one-off static page: four hardcoded cards
-- in the HTML, editable only by changing the file. The owner asked for
-- these to be admin-editable, same as every other real price in this
-- project -- but they aren't four separate purchasable products (the
-- platform only has ONE real "salon" feature key/price, see product_prices
-- and db/070's own comment), so they can't be admin_set_product_price
-- rows, and they can't be `bundles` rows either: db/113's bundle system
-- is strictly "one bundle per exact product-key set", so four bundles that
-- all contain nothing but {salon} would collide on uniqueness. This is a
-- genuinely different shape -- four named, priced, orderable rows that are
-- all marketing framings of the SAME one product -- so it gets its own
-- small table, following product_prices' own precedent exactly (no RLS,
-- reachable only through the SECURITY DEFINER functions below, explicit
-- grant to `app` since this table is brand new and db/999's blanket grant
-- only ever covered what existed when it last ran).
create table salon_plan_tiers (
  tier_key       text primary key,
  sort_order     int not null,
  name           text not null,
  tagline        text not null default '',
  monthly_price  numeric(10,2) not null default 0,
  yearly_price   numeric(10,2) not null default 0,
  features       jsonb not null default '[]',
  badge          text not null default '',
  highlighted    boolean not null default false,
  active         boolean not null default true,
  updated_at     timestamptz not null default now()
);

insert into salon_plan_tiers (tier_key, sort_order, name, tagline, monthly_price, yearly_price, features, badge, highlighted) values
  ('studio', 1, 'The Studio', 'One chair, every tool. For a solo stylist or a salon just opening its doors.', 1080, 10800,
    '["1 staff login","Branded website & booking","WhatsApp bills & clients","Expense tracking","Self check-in QR","Email support"]'::jsonb, '', false),
  ('salon', 2, 'The Salon', 'For a small team sharing chairs, with payroll and memberships switched on.', 1360, 13600,
    '["Up to 5 staff logins","Everything in The Studio","Packages & memberships","Cash register","Payroll clock-ins","Priority WhatsApp support"]'::jsonb, 'House favourite', true),
  ('atelier', 3, 'The Atelier', 'For a busy house that runs on numbers -- full analytics and automation.', 2720, 27200,
    '["Unlimited staff logins","Everything in The Salon","Full analytics & trends","Automatic WhatsApp alerts","Priority support","A dedicated setup call"]'::jsonb, '', false),
  ('maison', 4, 'The Maison', 'For a brand with more than one address, built around how you already work.', 5440, 54400,
    '["Multiple branches, one brand","Everything in The Atelier","Bespoke design, by AUZslab Studio","A named AUZslab contact","Custom integrations","Tailored onboarding"]'::jsonb, '', false);

grant select, insert, update, delete on salon_plan_tiers to app;

-- Anon-callable -- the public salon page reads this before anyone signs in,
-- same reasoning as public_product_prices()/public_bundles(). jsonb, not
-- `returns table` (see db/070's own comment on why, repeated every time
-- this shape is used in this codebase).
create function public_salon_tiers()
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'tier_key', tier_key, 'sort_order', sort_order, 'name', name, 'tagline', tagline,
      'monthly_price', monthly_price, 'yearly_price', yearly_price, 'features', features,
      'badge', badge, 'highlighted', highlighted) order by sort_order), '[]'::jsonb)
  from salon_plan_tiers where active;
$$;

-- Platform admin only. Updates ONE existing tier by tier_key -- the four
-- rows are fixed on purpose (this is a marketing comparison page for one
-- real product, not a product catalogue to add/remove items from); an
-- unknown tier_key is refused rather than silently creating a fifth.
create function admin_save_salon_tier(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_key text := p->>'tier_key'; v_row salon_plan_tiers;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  if v_key is null or v_key = '' then raise exception 'tier_key is required'; end if;
  if coalesce((p->>'monthly_price')::numeric, 0) < 0 or coalesce((p->>'yearly_price')::numeric, 0) < 0 then
    raise exception 'prices cannot be negative';
  end if;
  update salon_plan_tiers set
    name = coalesce(nullif(p->>'name', ''), name),
    tagline = coalesce(p->>'tagline', tagline),
    monthly_price = coalesce((p->>'monthly_price')::numeric, monthly_price),
    yearly_price = coalesce((p->>'yearly_price')::numeric, yearly_price),
    features = coalesce(p->'features', features),
    badge = coalesce(p->>'badge', badge),
    highlighted = coalesce((p->>'highlighted')::boolean, highlighted),
    active = coalesce((p->>'active')::boolean, active),
    updated_at = now()
  where tier_key = v_key
  returning * into v_row;
  if not found then raise exception 'unknown tier_key: %', v_key; end if;
  return jsonb_build_object('tier_key', v_row.tier_key, 'name', v_row.name);
end;
$$;

-- Admin also reads via public_salon_tiers() (same pattern loadPricing()
-- already uses for product_prices: no separate admin_list_* function,
-- the public one has nothing sensitive in it). admin_save_salon_tier must
-- see inactive tiers too when re-saving one the admin just toggled off, so
-- give the admin panel its own listing that doesn't filter on `active`.
create function admin_list_salon_tiers()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_result jsonb;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
      'tier_key', tier_key, 'sort_order', sort_order, 'name', name, 'tagline', tagline,
      'monthly_price', monthly_price, 'yearly_price', yearly_price, 'features', features,
      'badge', badge, 'highlighted', highlighted, 'active', active) order by sort_order), '[]'::jsonb)
  into v_result from salon_plan_tiers;
  return v_result;
end;
$$;
