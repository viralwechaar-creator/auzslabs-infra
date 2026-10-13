-- Join the team, finished: the decision returns who it was about (so the server can email them), and the admin
-- Team menu can show how many applications are waiting.
create or replace function admin_decide_team_application(p_id uuid, p_decision text, p_role text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a team_applications%rowtype; uid uuid; v_role text;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  if p_decision not in ('approve', 'reject') then raise exception 'unknown decision'; end if;
  select * into a from team_applications where id = p_id for update;
  if not found then raise exception 'application not found'; end if;
  if a.status <> 'new' then raise exception 'this application was already decided'; end if;
  if p_decision = 'reject' then
    update team_applications set status = 'rejected', decided_at = now(), decided_by = app_uid() where id = p_id;
    perform admin_log('team_application_reject', 'team', p_id::text, '{}'::jsonb);
    return jsonb_build_object('status', 'rejected', 'email', a.email, 'name', a.name);
  end if;
  v_role := coalesce(nullif(p_role, ''), case when a.role_wanted in ('salesman', 'setup', 'support') then a.role_wanted else 'support' end);
  if v_role not in ('salesman', 'setup', 'support', 'manager') then raise exception 'unknown role: %', v_role; end if;
  update team_applications set status = 'approved', decided_role = v_role, decided_at = now(), decided_by = app_uid() where id = p_id;
  select id into uid from auth_users where lower(email) = lower(a.email) and email_verified_at is not null;
  if uid is not null and not exists (select 1 from platform_admins where id = uid) then
    insert into platform_salesmen (id, name, role, phone) values (uid, a.name, v_role, a.phone)
      on conflict (id) do update set role = excluded.role, active = true;
    update team_applications set activated_at = now() where id = p_id;
  end if;
  perform admin_log('team_application_approve', 'team', p_id::text, jsonb_build_object('role', v_role));
  return jsonb_build_object('status', 'approved', 'active', uid is not null, 'email', a.email, 'name', a.name, 'role', v_role);
end $$;

create or replace function admin_open_team_application_count() returns int
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return (select count(*)::int from team_applications where status = 'new');
end $$;

-- one call for both admin menu badges (the admin sign-in is kept to a small number of requests)
create or replace function admin_open_counts() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return jsonb_build_object(
    'privacy', (select count(*)::int from data_requests where status in ('open', 'in_progress')),
    'team', (select count(*)::int from team_applications where status = 'new'));
end $$;
