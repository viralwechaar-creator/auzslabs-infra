-- =========================================================
-- Hub-app alerts for the AUZslab team and the platform admin (no business involved).
--  * platform_fcm_tokens: phones of admins and team members (fcm_tokens is per business, these people have none).
--    No RLS and no policies: written only by register_platform_push(), read/pruned by server/src/push.js.
--  * Admin gets: every platform notification (new client request, payment submitted, renewals ...) and team work
--    (lead added, lead stage changed, trial created, setup finished).
--  * Team member gets: leads/setups assigned to them and notices posted by the admin or a manager.
--  * team_notices: admin/manager notices to the team (all, or one role), with a push.
-- All triggers swallow their own errors: an alert must never block a request.
-- =========================================================

create table if not exists platform_fcm_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth_users(id) on delete cascade,
  token      text unique not null,
  platform   text not null default 'android',
  created_at timestamptz not null default now()
);
grant select, delete on platform_fcm_tokens to app;

create or replace function register_platform_push(p_token text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := app_uid();
begin
  if v is null then raise exception 'authentication required'; end if;
  if not (is_platform_admin() or is_team_member(v)) then raise exception 'not authorized'; end if;
  if coalesce(length(p_token), 0) < 20 or length(p_token) > 4096 then raise exception 'invalid token'; end if;
  insert into platform_fcm_tokens (user_id, token) values (v, p_token)
    on conflict (token) do update set user_id = excluded.user_id;
  return jsonb_build_object('ok', true);
end $$;

create or replace function notify_platform_push(p_user_ids uuid[], p_title text, p_body text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if p_user_ids is null or array_length(p_user_ids, 1) is null then return; end if;
  perform pg_notify('push_events', jsonb_build_object('platform', true, 'user_ids', to_jsonb(p_user_ids), 'title', left(p_title, 120), 'body', left(coalesce(p_body, ''), 300))::text);
end $$;

-- admins + active managers (the people who supervise)
create or replace function platform_supervisor_ids(p_except uuid default null) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct u), '{}') from (
    select id as u from platform_admins
    union
    select id from platform_salesmen where active and role = 'manager'
  ) x where u is distinct from p_except
$$;

-- 1) platform notifications (tenant_id null) -> admins and managers
create or replace function platform_notification_push() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.tenant_id is null then
    perform notify_platform_push(platform_supervisor_ids(), new.title, new.body);
  end if;
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists notifications_platform_push on notifications;
create trigger notifications_platform_push after insert on notifications for each row execute function platform_notification_push();

-- 2) team work -> supervisors; assignments -> the assigned person
create or replace function team_activity_push() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if new.kind = 'lead_assigned' then
    perform notify_platform_push(array[new.uid], 'A lead was assigned to you', new.label);
  elsif new.kind = 'setup_assigned' then
    perform notify_platform_push(array[new.uid], 'A client setup was assigned to you', new.label);
  elsif new.kind in ('lead_added', 'lead_stage', 'trial_created', 'setup_done') then
    select coalesce(nullif(name, ''), 'A team member') into who from platform_salesmen where id = new.uid;
    perform notify_platform_push(platform_supervisor_ids(new.uid),
      case new.kind when 'lead_added' then 'New lead' when 'lead_stage' then 'Lead updated' when 'trial_created' then 'New trial created' else 'Client setup finished' end,
      coalesce(who, 'A team member') || ' · ' || coalesce(new.label, ''));
  end if;
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists team_activity_push_trg on team_activity;
create trigger team_activity_push_trg after insert on team_activity for each row execute function team_activity_push();

-- 3) notices from the admin / a manager to the team
create table if not exists team_notices (
  id         bigserial primary key,
  title      text not null,
  body       text not null default '',
  audience   text not null default 'all' check (audience in ('all', 'salesman', 'setup', 'support', 'manager')),
  created_by uuid references auth_users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table team_notices enable row level security;

create or replace function admin_post_team_notice(p_title text, p_body text default '', p_audience text default 'all') returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_ids uuid[]; v_aud text := coalesce(nullif(p_audience, ''), 'all');
begin
  if not team_can_manage() then raise exception 'not authorized'; end if;
  if coalesce(btrim(p_title), '') = '' then raise exception 'Please write a title.'; end if;
  if v_aud not in ('all', 'salesman', 'setup', 'support', 'manager') then raise exception 'unknown audience'; end if;
  insert into team_notices (title, body, audience, created_by) values (left(btrim(p_title), 120), left(coalesce(p_body, ''), 1000), v_aud, app_uid());
  select coalesce(array_agg(id), '{}') into v_ids from platform_salesmen
    where active and id is distinct from app_uid() and (v_aud = 'all' or role = v_aud);
  perform notify_platform_push(v_ids, 'Notice: ' || left(btrim(p_title), 100), left(coalesce(p_body, ''), 200));
  return jsonb_build_object('ok', true, 'sent_to', coalesce(array_length(v_ids, 1), 0));
end $$;

create or replace function team_list_notices(p_limit int default 20) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_role text := team_role();
begin
  if not (is_platform_admin() or v_role is not null) then raise exception 'not authorized'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', n.id, 'title', n.title, 'body', n.body, 'audience', n.audience, 'created_at', n.created_at) order by n.created_at desc)
    from (select * from team_notices where is_platform_admin() or audience = 'all' or audience = v_role order by created_at desc limit least(greatest(coalesce(p_limit, 20), 1), 100)) n), '[]'::jsonb);
end $$;
