-- =========================================================
-- OG Book Cafe (and any future tenant onboarded by direct SQL
-- import rather than the normal signup/provision flow) had
-- auth_users.app_metadata left as '{}' instead of {tenant_id, role}
-- -- profiles.tenant_id/role (what RLS's me() actually reads for
-- every authorization check) was set correctly, so login and every
-- RLS-gated action already worked fine. But a few narrower checks
-- read app_metadata straight off the JWT instead of going through
-- profiles/me():
--   - the realtime /ws upgrade (server/src/realtime.js) requires
--     app_metadata.tenant_id or destroys the socket -- their POS
--     app was silently falling back to polling only, no live push.
--   - the site-branding photo upload endpoint (server/src/index.js's
--     /storage/site/:prefix) requires app_metadata.tenant_id +
--     role === 'owner' -- the owner could not upload the hero/
--     about/gallery photos Settings > Website offers.
--   - the marketing site's "already a client -> go straight to your
--     account page" redirect (site/signup.html) reads the same field.
--
-- This backfills app_metadata from profiles for any login where
-- they've drifted apart -- general fix, not scoped to one tenant by
-- id, so it also covers this same mistake if it ever happens again.
-- =========================================================

update auth_users u
set app_metadata = jsonb_build_object('tenant_id', p.tenant_id, 'role', p.role)
from profiles p
where p.id = u.id
  and p.tenant_id is not null
  and not (coalesce(u.app_metadata, '{}'::jsonb) ? 'tenant_id');
