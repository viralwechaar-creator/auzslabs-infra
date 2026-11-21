-- Add resume upload to the existing team_applications flow (db/177/188), per the owner's explicit
-- request this time, reversing db/188's earlier "structured fields only" choice for just this one field.
-- Same two-step shape as the order-proof upload (server/src/routes/storage.js's own /storage/order-proof
-- route): the application row must exist first, then an anonymous upload attaches a file to it by id --
-- there is no separate secret token here because the application's own id is only known to whoever just
-- submitted the form (never listed anywhere, not sequential), the same trust level order-proof's token has.
alter table team_applications add column if not exists resume_file text;

drop function if exists submit_team_application(text,text,text,text,text,text,text,text);
-- submit_team_application used to return void; every caller (site/careers.html, built this session) and
-- the RPC registry entry already expect a result, so this is safe to widen rather than add a second function.
create or replace function submit_team_application(
  p_name text, p_email text, p_phone text, p_city text, p_role text, p_experience text, p_about text, p_hp text default '')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_email text := lower(btrim(coalesce(p_email, ''))); v_id uuid;
begin
  if coalesce(p_hp, '') <> '' then return '{}'::jsonb; end if;  -- honeypot: pretend success
  if btrim(coalesce(p_name, '')) = '' then raise exception 'please tell us your name'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'please enter a valid email address'; end if;
  if (select count(*) from team_applications where lower(email) = v_email and created_at > now() - interval '1 day') >= 3 then
    raise exception 'we already have your application -- we will get back to you';
  end if;
  insert into team_applications (name, email, phone, city, role_wanted, experience, about)
  values (left(btrim(p_name), 120), left(v_email, 160), nullif(left(btrim(coalesce(p_phone, '')), 30), ''),
          nullif(left(btrim(coalesce(p_city, '')), 80), ''),
          case when p_role in ('salesman', 'setup', 'support', 'other') then p_role else 'other' end,
          nullif(left(btrim(coalesce(p_experience, '')), 600), ''), nullif(left(btrim(coalesce(p_about, '')), 1500), ''))
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;

-- Anonymous: attaches an uploaded resume to a just-submitted, still-undecided application.
-- p_filename is never trusted as a path -- it's the exact basename saveDocUpload() generated
-- server-side a moment earlier (see the storage route), the same discipline order_proof_record uses.
create function submit_team_application_resume(p_id uuid, p_filename text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  update team_applications set resume_file = p_filename where id = p_id and status = 'new';
  return found;
end $$;

-- The resume filename an admin is allowed to open, or null. Same shape as admin_order_proof.
create function admin_team_application_resume(p_id uuid) returns text
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return (select resume_file from team_applications where id = p_id);
end $$;

grant execute on function submit_team_application_resume(uuid, text) to app;
grant execute on function admin_team_application_resume(uuid) to app;
