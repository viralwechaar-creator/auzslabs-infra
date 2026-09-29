-- The marketing site's "QR Ordering" product (products.html) was wired
-- to a feature key called 'qr' -- but nothing anywhere (index.html,
-- site.html, server/) ever actually checks featureOn('qr'). The REAL
-- flag that gates self-order everywhere (staff guest-order inbox,
-- site.html's ordering UI, place_order's server-side check) has always
-- been 'self_order' -- see db/018_enforce_self_order_feature.sql. Selling
-- "QR Ordering" under the 'qr' key meant a client's purchase did nothing
-- functionally, and it showed up as two separate rows in their Services
-- list ("QR Ordering" and "Self-order (QR)") for what's really one
-- capability. products.html/cart.html/demo.html now all use 'self_order'
-- directly, matching db/018 -- this migration fixes any tenant that
-- already has the dead 'qr' key sitting in features/enabled_features
-- from before that fix.
--
-- Merge, not overwrite: a tenant with qr:true but self_order already
-- false (explicitly disabled) keeps it disabled -- true wins either way,
-- matching "entitled if either key ever granted it."
update tenant_settings
set features = (features - 'qr') || jsonb_build_object('self_order', coalesce((features->>'self_order')::boolean, false) or coalesce((features->>'qr')::boolean, false))
where features ? 'qr';

update tenant_settings
set enabled_features = (enabled_features - 'qr') || jsonb_build_object('self_order', coalesce((enabled_features->>'self_order')::boolean, true) and coalesce((enabled_features->>'qr')::boolean, true))
where enabled_features ? 'qr';
