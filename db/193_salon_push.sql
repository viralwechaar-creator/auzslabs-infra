-- Live browser notifications for the salon owner/staff console (Web Push, VAPID -- the same mechanism
-- the POS's "order alerts" already use, server/src/push.js). Raw-pool-only table, deliberately NO RLS:
-- salon's own session is a custom HMAC cookie (session.js), never the platform JWT, so it never sets
-- app.uid -- the exact RLS-silently-returns-zero-rows trap this codebase has hit repeatedly (see
-- CLAUDE.md's running list: createOrder(), saveSiteUpload, subscriptions, /auth/2fa/setup,
-- appicon.js...). salon_store (db/053) already established the correct pattern for this app: no RLS,
-- reachable only through the salon API process (role 'app'), always scoped to the tenant resolved
-- from the request's subdomain. This table follows that same, already-proven pattern instead of
-- reusing push_subs (which is RLS-gated to app_uid() and would hit the same trap here).

create table salon_push_subs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  endpoint    text not null,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now(),
  unique (tenant_id, endpoint)
);
-- New table -- CLAUDE.md's own "the one gotcha that bit us": app needs an explicit grant or every
-- query from the salon API (which connects as role 'app', never as $POSTGRES_USER) gets
-- "permission denied for table salon_push_subs" even though there's no RLS to misread.
grant select, insert, update, delete on salon_push_subs to app;
