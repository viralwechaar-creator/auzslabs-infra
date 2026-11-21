-- AUZslab SalesOS: recruitment. Public apply (name/note/resume) -> admin reviews and assigns
-- a post -> applicant signs in with Google using the same email -> lands in their own SalesOS
-- workspace. New names throughout (sos_*), deliberately NOT reusing team_*/platform_salesmen,
-- which the owner removed in Oct 2026 and confirmed should stay removed.
do $$
declare tid uuid;
begin
  select id into tid from tenants where slug = 'auzslab-internal';
  if tid is null then
    insert into tenants (name, slug, niche, plan, status)
    values ('AUZslab (internal)', 'auzslab-internal', 'general', 'enterprise', 'active')
    returning id into tid;
    insert into tenant_settings (tenant_id, features) values (tid, '{"salesos": true}'::jsonb);
  else
    update tenant_settings set features = features || '{"salesos": true}'::jsonb where tenant_id = tid;
  end if;

  insert into roles (tenant_id, name, permissions)
  values
    (tid, 'Admin', '{"sos_view":true,"sos_admin":true}'::jsonb),
    (tid, 'Sales Manager', '{"sos_view":true,"sos_manage":true}'::jsonb),
    (tid, 'Sales Executive', '{"sos_view":true,"sos_field":true}'::jsonb)
  on conflict (tenant_id, name) do update set permissions = excluded.permissions;
end $$;

create function sos_perm(k text) returns boolean language plpgsql stable security definer set search_path = public as $$
declare r text; rid uuid; perms jsonb; tid uuid;
begin
  r := me()->>'role'; tid := (me()->>'tenant_id')::uuid;
  if r is null or tid is null then return false; end if;
  if r = 'owner' then return true; end if;
  select role_id into rid from profiles where id = app_uid();
  if rid is null then return false; end if;
  select permissions into perms from roles where id = rid and tenant_id = tid;
  return coalesce((perms->>k)::boolean, false);
end $$;

create function sos_tenant() returns uuid language plpgsql stable security definer set search_path = public as $$
declare tid uuid; f jsonb;
begin
  if me() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  tid := (me()->>'tenant_id')::uuid;
  if tid is null then raise exception 'not a tenant member'; end if;
  select features into f from tenant_settings where tenant_id = tid;
  if coalesce((f->>'salesos')::boolean, false) is not true then raise exception 'SalesOS is not enabled for this account'; end if;
  return tid;
end $$;

create function sos_guard(k text default 'sos_view') returns uuid language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sos_tenant();
  if k is not null and not sos_perm(k) then raise exception 'Your role does not allow this (%)', k using errcode = '42501'; end if;
  return tid;
end $$;

create table sos_applications (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text,
  note text,
  resume_file text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  post text,
  staff_id uuid references auth_users(id) on delete set null,
  reviewed_by uuid references auth_users(id),
  reviewed_at timestamptz,
  reject_reason text,
  created_at timestamptz not null default now()
);
create index idx_sos_applications_status on sos_applications (status, created_at desc);
alter table sos_applications enable row level security;

create function submit_job_application(p_name text, p_email text, p_phone text, p_note text, p_hp text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare new_id uuid;
begin
  if coalesce(p_hp, '') <> '' then return '{}'::jsonb; end if;
  if nullif(btrim(p_name), '') is null or nullif(btrim(p_email), '') is null then
    raise exception 'Enter your name and email';
  end if;
  if (select count(*) from sos_applications where lower(email) = lower(btrim(p_email)) and created_at > now() - interval '1 day') >= 3 then
    raise exception 'we already have your application -- we will get back to you';
  end if;
  insert into sos_applications (name, email, phone, note)
  values (btrim(p_name), lower(btrim(p_email)), nullif(btrim(p_phone), ''), nullif(btrim(p_note), ''))
  returning id into new_id;
  return jsonb_build_object('id', new_id);
end $$;

create function submit_job_application_resume(p_id uuid, p_filename text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update sos_applications set resume_file = p_filename where id = p_id and status = 'pending';
  return found;
end $$;

create function admin_list_job_applications(p_status text default 'pending')
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', id, 'name', name, 'email', email, 'phone', phone, 'note', note,
      'hasResume', resume_file is not null, 'status', status, 'post', post,
      'rejectReason', reject_reason, 'createdAt', created_at, 'reviewedAt', reviewed_at
    ) order by created_at desc)
    from sos_applications where p_status = 'all' or status = p_status), '[]'::jsonb);
end $$;

create function admin_job_application_resume(p_id uuid) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return (select resume_file from sos_applications where id = p_id);
end $$;

create function admin_review_job_application(p_id uuid, p_decision text, p_post text default null, p_reject_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  app sos_applications%rowtype;
  tid uuid; rid uuid; new_uid uuid; new_password text;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  if p_decision not in ('approve', 'reject') then raise exception 'p_decision must be approve or reject'; end if;

  select * into app from sos_applications where id = p_id and status = 'pending' for update;
  if not found then raise exception 'application not found or already handled'; end if;

  if p_decision = 'reject' then
    update sos_applications set status = 'rejected', reviewed_by = app_uid(), reviewed_at = now(), reject_reason = p_reject_reason
    where id = p_id;
    return jsonb_build_object('status', 'rejected');
  end if;

  if nullif(btrim(p_post), '') is null then raise exception 'Choose a post to assign'; end if;
  select id into tid from tenants where slug = 'auzslab-internal';
  select id into rid from roles where tenant_id = tid and name = p_post;
  if rid is null then raise exception 'Unknown post: %', p_post; end if;
  if exists (select 1 from auth_users where email = app.email) then
    raise exception 'An account with this email already exists';
  end if;

  new_password := replace(gen_random_uuid()::text, '-', '') || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  insert into auth_users (email, password_hash, app_metadata)
  values (app.email, crypt(new_password, gen_salt('bf', 12)),
    jsonb_build_object('tenant_id', tid, 'role', p_post, 'role_id', rid, 'name', app.name, 'phone', app.phone))
  returning id into new_uid;

  update sos_applications set status = 'approved', post = p_post, staff_id = new_uid, reviewed_by = app_uid(), reviewed_at = now()
  where id = p_id;

  return jsonb_build_object('status', 'approved', 'staffId', new_uid, 'post', p_post);
end $$;

grant select, insert, update on sos_applications to app;
grant execute on function sos_perm(text) to app;
grant execute on function sos_tenant() to app;
grant execute on function sos_guard(text) to app;
grant execute on function submit_job_application(text, text, text, text, text) to app;
grant execute on function submit_job_application_resume(uuid, text) to app;
grant execute on function admin_list_job_applications(text) to app;
grant execute on function admin_job_application_resume(uuid) to app;
grant execute on function admin_review_job_application(uuid, text, text, text) to app;
