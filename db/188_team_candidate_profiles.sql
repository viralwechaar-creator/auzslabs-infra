-- Team candidate profile: a real account-based "join the team" flow, mirroring the CLIENT profile
-- system's own discipline exactly (db/103, user_profiles / my_profile() / save_my_profile()): one row
-- per login, RLS on with NO policies, only the SECURITY DEFINER functions below ever read or write it.
-- Structured fields only -- no CV/resume file upload (the owner's explicit choice over a file-upload version).
create table if not exists team_candidate_profiles (
  user_id uuid primary key references auth_users(id) on delete cascade,
  name text, phone text, contact_email text,
  role_wanted text,        -- 'salesman' | 'setup' | 'support' | 'manager' | 'other' | 'not_sure' (see platform_salesmen.role)
  years_experience text, city text, skills text, links text, availability text, notes text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table team_candidate_profiles enable row level security;
grant select, insert, update, delete on team_candidate_profiles to app;

create or replace function my_team_candidate_profile() returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare uid uuid := app_uid(); r team_candidate_profiles%rowtype; e text;
begin
  if uid is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select * into r from team_candidate_profiles where user_id = uid;
  select email into e from auth_users where id = uid;
  return jsonb_build_object('login_email', e, 'profile', case when r.user_id is null then null else to_jsonb(r) - 'user_id' end);
end $$;

create or replace function save_my_team_candidate_profile(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := app_uid(); v_role text;
begin
  if uid is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Please enter your name.'; end if;
  if coalesce(trim(p->>'phone'), '') !~ '^[+0-9 ()-]{8,16}$' then raise exception 'Please enter a valid phone number.'; end if;
  v_role := coalesce(nullif(p->>'role_wanted', ''), 'not_sure');
  if v_role not in ('salesman', 'setup', 'support', 'manager', 'other', 'not_sure') then v_role := 'not_sure'; end if;
  insert into team_candidate_profiles (user_id, name, phone, contact_email, role_wanted, years_experience, city, skills, links, availability, notes, updated_at)
  values (uid, left(trim(p->>'name'), 120), left(trim(p->>'phone'), 20), left(trim(coalesce(p->>'contact_email', '')), 160), v_role,
    left(trim(coalesce(p->>'years_experience', '')), 40), left(trim(coalesce(p->>'city', '')), 80), left(trim(coalesce(p->>'skills', '')), 800),
    left(trim(coalesce(p->>'links', '')), 400), left(trim(coalesce(p->>'availability', '')), 120), left(trim(coalesce(p->>'notes', '')), 1000), now())
  on conflict (user_id) do update set name = excluded.name, phone = excluded.phone, contact_email = excluded.contact_email, role_wanted = excluded.role_wanted,
    years_experience = excluded.years_experience, city = excluded.city, skills = excluded.skills, links = excluded.links,
    availability = excluded.availability, notes = excluded.notes, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- Extend team_applications (db/177 -- the CURRENT admin-review table, reused, not forked) with an account
-- tie and the structured fields a real hiring decision needs. Existing anonymous rows (user_id null) are untouched.
alter table team_applications add column if not exists user_id uuid references auth_users(id) on delete cascade;
alter table team_applications add column if not exists years_experience text;
alter table team_applications add column if not exists skills text;
alter table team_applications add column if not exists links text;
alter table team_applications add column if not exists availability text;
create unique index if not exists team_applications_user_uq on team_applications (user_id) where user_id is not null;

-- Submit (or, while still undecided/rejected, resubmit) a real application built from the candidate's own
-- saved profile -- never a second, parallel review system; this writes the SAME team_applications table
-- admin_list_team_applications / admin_decide_team_application / the Team -> Applications UI already use.
create or replace function submit_my_team_application() returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := app_uid(); cp team_candidate_profiles%rowtype; em text; existing team_applications%rowtype; v_id uuid;
begin
  if uid is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select * into cp from team_candidate_profiles where user_id = uid;
  if cp.user_id is null or coalesce(trim(cp.name), '') = '' or coalesce(trim(cp.phone), '') = '' then
    raise exception 'Please save your profile first (your name and phone number are needed).';
  end if;
  select email into em from auth_users where id = uid;
  select * into existing from team_applications where user_id = uid;
  if existing.id is not null and existing.status = 'approved' then
    raise exception 'You are already approved -- please sign in at app.auzslab.in with Google using this email.';
  end if;
  insert into team_applications (user_id, name, email, phone, city, role_wanted, years_experience, skills, links, availability, about, status)
  values (uid, cp.name, coalesce(nullif(trim(cp.contact_email), ''), em), cp.phone, cp.city,
    case when cp.role_wanted in ('salesman', 'setup', 'support', 'manager') then cp.role_wanted else 'other' end,
    cp.years_experience, cp.skills, cp.links, cp.availability, cp.notes, 'new')
  on conflict (user_id) where user_id is not null do update set
    name = excluded.name, email = excluded.email, phone = excluded.phone, city = excluded.city, role_wanted = excluded.role_wanted,
    years_experience = excluded.years_experience, skills = excluded.skills, links = excluded.links, availability = excluded.availability, about = excluded.about,
    status = 'new', decided_role = null, decided_at = null, decided_by = null, activated_at = null
  returning id into v_id;
  insert into notifications (tenant_id, type, title, body) values (null, 'team_application', 'New team application: ' || cp.name, cp.name || ' · ' || cp.phone);
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

-- the applicant's own application + status, mirroring my_client_orders' own pattern (db/155)
create or replace function my_team_applications() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'status', status, 'role_wanted', role_wanted, 'decided_role', decided_role,
    'created_at', created_at, 'decided_at', decided_at) order by created_at desc), '[]'::jsonb)
  from team_applications where user_id = app_uid()
$$;
