-- =========================================================
-- Answers "what if a client forgets their password?" -- there's no
-- self-serve forgot-password flow (that needs email sending, which
-- this project deliberately doesn't have yet). Until then, a
-- platform_admin can reset any tenant's OWNER login here and relay
-- the new password directly (same handoff pattern as onboarding's
-- temp_password already uses).
--
-- Done in pure SQL, not a new server endpoint: pgcrypto's crypt()
-- with gen_salt('bf') produces a standard bcrypt hash, which
-- bcryptjs (server/src/auth.js) verifies identically -- confirmed
-- these are the same hash format, just generated on different sides.
-- =========================================================

create function admin_reset_client_password(p_tenant_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  owner_id uuid;
  owner_email text;
  new_password text;
begin
  if not is_platform_admin() then
    raise exception 'not authorized';
  end if;

  select p.id, p.email into owner_id, owner_email
  from profiles p where p.tenant_id = p_tenant_id and p.role = 'owner'
  order by p.id limit 1;

  if owner_id is null then
    raise exception 'no owner login found for this tenant';
  end if;

  new_password := replace(gen_random_uuid()::text, '-', '') || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  update auth_users set password_hash = crypt(new_password, gen_salt('bf', 12)) where id = owner_id;

  return jsonb_build_object('email', owner_email, 'temp_password', new_password);
end $$;
