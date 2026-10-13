-- Browser (Web Push) alerts for the AUZslab admin and team, next to the Android phones of db/182.
-- No RLS, no policies: written only by register_platform_web_push(), read/pruned by server/src/push.js.
create table if not exists platform_web_push (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth_users(id) on delete cascade,
  endpoint   text unique not null,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
grant select, delete on platform_web_push to app;

create or replace function register_platform_web_push(p_endpoint text, p_p256dh text, p_auth text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := app_uid();
begin
  if v is null then raise exception 'authentication required'; end if;
  if not (is_platform_admin() or is_team_member(v)) then raise exception 'not authorized'; end if;
  if coalesce(p_endpoint, '') !~ '^https://' or length(p_endpoint) > 2000 or coalesce(length(p_p256dh), 0) < 20 or coalesce(length(p_auth), 0) < 8 then raise exception 'invalid subscription'; end if;
  insert into platform_web_push (user_id, endpoint, p256dh, auth) values (v, p_endpoint, p_p256dh, p_auth)
    on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
  return jsonb_build_object('ok', true);
end $$;
