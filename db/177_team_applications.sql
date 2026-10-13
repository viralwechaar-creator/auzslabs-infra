-- Join the AUZslab team: a public application form, admin approval, then the person lands on their
-- own team workspace (db/176). Applications are rows nobody can read directly (RLS on, no policies);
-- everything goes through SECURITY DEFINER functions.
create table if not exists team_applications (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text,
  city text,
  role_wanted text not null default 'salesman',
  experience text,
  about text,
  status text not null default 'new' check (status in ('new', 'approved', 'rejected')),
  decided_role text,
  decided_at timestamptz,
  decided_by uuid,
  activated_at timestamptz,
  created_at timestamptz not null default now()
);
alter table team_applications enable row level security;
create index if not exists team_applications_email_idx on team_applications (lower(email));

create or replace function submit_team_application(
  p_name text, p_email text, p_phone text, p_city text, p_role text, p_experience text, p_about text, p_hp text default '')
returns void language plpgsql security definer set search_path = public as $$
declare v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if coalesce(p_hp, '') <> '' then return; end if;  -- honeypot: pretend success
  if btrim(coalesce(p_name, '')) = '' then raise exception 'please tell us your name'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'please enter a valid email address'; end if;
  if (select count(*) from team_applications where lower(email) = v_email and created_at > now() - interval '1 day') >= 3 then
    raise exception 'we already have your application -- we will get back to you';
  end if;
  insert into team_applications (name, email, phone, city, role_wanted, experience, about)
  values (left(btrim(p_name), 120), left(v_email, 160), nullif(left(btrim(coalesce(p_phone, '')), 30), ''),
          nullif(left(btrim(coalesce(p_city, '')), 80), ''),
          case when p_role in ('salesman', 'setup', 'support', 'other') then p_role else 'other' end,
          nullif(left(btrim(coalesce(p_experience, '')), 600), ''), nullif(left(btrim(coalesce(p_about, '')), 1500), ''));
end $$;

create or replace function admin_list_team_applications(p_status text default 'new') returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc)
                   from team_applications a where p_status = 'all' or a.status = p_status), '[]'::jsonb);
end $$;

-- approve (with a role) or reject. If the person already has an AUZslab login they are on the team now;
-- otherwise they are activated automatically the first time they sign in with Google using that email.
create or replace function admin_decide_team_application(p_id uuid, p_decision text, p_role text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a team_applications%rowtype; uid uuid; v_role text;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  if p_decision not in ('approve', 'reject') then raise exception 'unknown decision'; end if;
  select * into a from team_applications where id = p_id for update;
  if not found then raise exception 'application not found'; end if;
  if p_decision = 'reject' then
    update team_applications set status = 'rejected', decided_at = now(), decided_by = app_uid() where id = p_id;
    perform admin_log('team_application_reject', 'team', p_id::text, '{}'::jsonb);
    return jsonb_build_object('status', 'rejected');
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
  return jsonb_build_object('status', 'approved', 'active', uid is not null);
end $$;

-- team_me: first sign-in of an approved applicant turns the approval into a team seat
create or replace function team_me() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r platform_salesmen%rowtype; em text; ap team_applications%rowtype;
begin
  select * into r from platform_salesmen where id = app_uid() and active;
  if not found then
    select email into em from auth_users where id = app_uid() and email_verified_at is not null;
    if em is not null then
      select * into ap from team_applications
        where lower(email) = lower(em) and status = 'approved' and activated_at is null order by decided_at desc limit 1;
      if found and not exists (select 1 from platform_admins where id = app_uid()) then
        insert into platform_salesmen (id, name, role, phone) values (app_uid(), ap.name, ap.decided_role, ap.phone)
          on conflict (id) do update set role = excluded.role, active = true;
        update team_applications set activated_at = now() where id = ap.id;
        select * into r from platform_salesmen where id = app_uid() and active;
      end if;
    end if;
  end if;
  if r.id is null then raise exception 'not a team member'; end if;
  select email into em from auth_users where id = r.id;
  return jsonb_build_object('id', r.id, 'name', coalesce(r.name, em), 'email', em, 'role', r.role, 'phone', r.phone);
end $$;
