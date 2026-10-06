-- =========================================================
-- Native push notifications for the Android app (Firebase Cloud
-- Messaging), closing a real gap the store-launch review found: the
-- POS's existing "order alerts" push (push_subs/push.js, Web Push via
-- VAPID) does not work inside a bare Capacitor WebView -- the browser
-- never registers a push service there, so tapping "enable push"
-- inside the packaged app either fails silently or throws. FCM is the
-- actual mechanism a wrapped Android app needs.
--
-- fcm_tokens mirrors push_subs exactly (same RLS shape, same
-- tenant_id-from-me() default, same ownership policies) -- a device
-- registers its FCM token the same way a browser registers its Web
-- Push subscription, and server/src/push.js's handlePushEvent fans out
-- to both tables for the same tenant.
-- =========================================================

create table fcm_tokens (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) default ((me()->>'tenant_id')::uuid),
  user_id     uuid references auth_users(id) on delete cascade,
  token       text unique not null,
  platform    text not null default 'android',
  created_at  timestamptz not null default now()
);
alter table fcm_tokens enable row level security;
create policy fcm_ins on fcm_tokens for insert with check (me() is not null and user_id = app_uid());
create policy fcm_read on fcm_tokens for select using (me() is not null and user_id = app_uid());
create policy fcm_upd on fcm_tokens for update using (me() is not null and user_id = app_uid()) with check (me() is not null and user_id = app_uid());
create policy fcm_del on fcm_tokens for delete using (me() is not null and user_id = app_uid());
-- new table -- CLAUDE.md's own "the one gotcha that bit us"
grant select, insert, update, delete on fcm_tokens to app;
