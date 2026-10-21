-- POS push notifications have never actually delivered: handlePushEvent()
-- (server/src/push.js) reads push_subs/fcm_tokens with a bare pool.query,
-- never wrapped in withAuth() -- it runs as a background job triggered by
-- a Postgres NOTIFY, with no logged-in caller, so app.uid is never set.
-- Both tables' RLS policies are "user_id = app_uid()" (db/002, db/119),
-- which app_uid() resolving to null makes false for every row, every
-- time -- the query doesn't error, it silently returns zero rows. Same
-- bug shape this file's own CLAUDE.md notes elsewhere (createOrder's RLS
-- read, storage.js's saveSiteUpload, the subscriptions table, /auth/2fa/
-- setup, appicon.js's tenantForIconContext) -- confirmed live by adding
-- temporary logging and watching "[push] sending to 0 subscription(s)"
-- print for a tenant verified to have 5 real push_subs rows.
--
-- Fix: two small SECURITY DEFINER reads + two deletes, trusted-backend-
-- only (deliberately NOT registered in server/src/data/rpc-registry.js's
-- RPC allow-list, same discipline as provision_from_payment /
-- addon_request_pricing_context) -- this job has no user to authenticate
-- as, it is the server itself acting on a signal it already trusts.

create function push_subs_for_tenant(p_tenant_id uuid, p_user_ids uuid[] default null)
returns setof push_subs language sql security definer stable set search_path = public as $$
  select * from push_subs
  where tenant_id = p_tenant_id
    and (p_user_ids is null or user_id = any(p_user_ids))
$$;

create function fcm_tokens_for_tenant(p_tenant_id uuid, p_user_ids uuid[] default null)
returns setof fcm_tokens language sql security definer stable set search_path = public as $$
  select * from fcm_tokens
  where tenant_id = p_tenant_id
    and (p_user_ids is null or user_id = any(p_user_ids))
$$;

create function push_subs_delete_dead(p_id uuid) returns void language sql security definer set search_path = public as $$
  delete from push_subs where id = p_id
$$;

create function fcm_tokens_delete_dead(p_id uuid) returns void language sql security definer set search_path = public as $$
  delete from fcm_tokens where id = p_id
$$;
