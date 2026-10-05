-- Clients could not add staff: the Add staff form required a custom role, but a new business has no roles at all
-- (nothing creates any), so the button was disabled and "Create a role first" was the only option. Make the role
-- optional: no role = the standard staff access every app already defines for a plain staffer (role 'cashier'),
-- p_builtin = 'manager' gives the built-in manager access. A custom role still works exactly as before.
-- Also: a duplicate email now says so instead of a raw database error.
drop function if exists invite_staff(text, text, text, uuid);
create or replace function invite_staff(p_email text, p_name text, p_phone text, p_role_id uuid default null, p_builtin text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  tid uuid; role_name text; new_uid uuid; new_password text; demo boolean; invite_token text; em text;
begin
  if (me()->>'role') is distinct from 'owner' then
    raise exception 'owner only';
  end if;
  tid := (me()->>'tenant_id')::uuid;

  select is_demo into demo from tenants where id = tid;
  if demo then
    raise exception 'not available on a demo account';
  end if;

  em := lower(btrim(coalesce(p_email, '')));
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address'; end if;
  if exists (select 1 from auth_users where lower(email) = em) then
    raise exception 'That email already has an AUZslab login. Use a different email, or ask them to sign in.';
  end if;

  if p_role_id is not null then
    select name into role_name from roles where id = p_role_id and tenant_id = tid;
    if role_name is null then raise exception 'unknown role'; end if;
  else
    role_name := case when p_builtin = 'manager' then 'manager' else 'cashier' end;
  end if;

  new_password := replace(gen_random_uuid()::text, '-', '') || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);

  insert into auth_users (email, password_hash, app_metadata)
  values (
    em,
    crypt(new_password, gen_salt('bf', 12)),
    jsonb_build_object('tenant_id', tid, 'role', role_name, 'role_id', p_role_id, 'name', p_name, 'phone', p_phone, 'email_verified', false)
  )
  returning id into new_uid;

  insert into staff_invites (profile_id) values (new_uid) returning token into invite_token;

  return jsonb_build_object('id', new_uid, 'email', em, 'temp_password', new_password, 'verify_token', invite_token);
end $$;
