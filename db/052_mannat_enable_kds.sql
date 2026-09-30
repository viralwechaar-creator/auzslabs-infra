-- =========================================================
-- The Kitchen and KOT tabs in index.html both require
-- featureOn('kds') (visibleTabs(), around line 598) -- whatever
-- process originally onboarded mannatcafe (before db/049/050 ever
-- touched it) left tenant_settings.features without kds:true, even
-- though the 'cafe' niche preset includes it. This grants the
-- entitlement directly and clears any explicit disable sitting in
-- enabled_features, without touching any other feature flag --
-- scoped to exactly the symptom reported (Kitchen/KOT tabs missing).
-- =========================================================

update tenant_settings
set features = features || '{"kds": true}'::jsonb,
    enabled_features = enabled_features - 'kds'
where tenant_id = (select id from tenants where slug = 'mannatcafe');
