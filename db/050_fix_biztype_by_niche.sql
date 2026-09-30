-- =========================================================
-- Real bug hit provisioning the first live 'salon' tenant (Showoff
-- Salon): visiting their bare subdomain landed on the staff POS login
-- screen, not their booking site. Two separate causes, both fixed here:
--
-- 1. cfg() in index.html hardcodes bizType:'restaurant' as its base
--    default, only overridden if the tenant's own settings record
--    actually has a bizType field -- and none of niche_presets'
--    default_business_rules (db/001) ever set one, for ANY niche.
--    Every tenant provisioned since this whole system existed has
--    been silently running as bizType='restaurant' unless its owner
--    happened to visit Settings -> Business and pick one by hand.
--    Fixed both going forward (niche_presets, for new onboarding) and
--    for tenants that already exist (a backfill UPDATE, matching the
--    documented pattern in db/043 for exactly this "preset fix doesn't
--    reach already-onboarded clients" situation) -- but only where
--    bizType is still unset, so an owner who *did* deliberately pick
--    a different bizType by hand keeps their own choice.
--
-- 2. The Caddyfile's root fallback (try_files {path} /index.html)
--    sent every tenant's bare subdomain root straight to the staff POS
--    app, regardless of niche, with no way for a niche whose real
--    front door is a customer-facing page (a salon's booking.html) to
--    land anywhere else -- fixed separately in the Caddyfile itself
--    (falls back to the new app/public/land.html router instead),
--    which is what actually reads the bizType this migration fixes.
-- =========================================================

update niche_presets set default_business_rules = default_business_rules || '{"bizType": "salon"}'::jsonb where niche in ('salon', 'gym');
update niche_presets set default_business_rules = default_business_rules || '{"bizType": "restaurant"}'::jsonb where niche = 'cafe';
update niche_presets set default_business_rules = default_business_rules || '{"bizType": "retail"}'::jsonb where niche in ('retail', 'general');

update records set data = data || jsonb_build_object('bizType',
    case t.niche when 'salon' then 'salon' when 'gym' then 'salon' when 'cafe' then 'restaurant' else 'retail' end)
  from tenants t
  where records.tenant_id = t.id and records.kind = 'settings' and records.id = 'settings' and records.data->>'bizType' is null;
