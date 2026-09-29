-- =========================================================
-- Answers "how does an owner set/reset a staff or employee login's
-- password" -- until now there was genuinely no way, anywhere in the
-- product: invite_staff (db/013) hands back a random temp_password
-- exactly once at creation time, never shown again, and there was no
-- "forgot it" or "type a specific one" path afterward. The only
-- existing reset RPC (admin_reset_client_password, db/009) is
-- platform-admin-only and only ever targets a tenant's OWNER login --
-- useless to a business owner needing to reset one of their own
-- staff's passwords.
--
-- Same bcrypt-via-pgcrypto approach as db/009. p_new_password is
-- optional: leave it null for a random temp password (the existing
-- handoff pattern everywhere else), or pass a specific one the owner
-- typed themselves -- both go through the same length check
-- change_my_password already enforces client-side, enforced here too
-- since this is a different, unauthenticated-by-the-target RPC.
-- =========================================================

create function reset_staff_password(p_staff_id uuid, p_new_password text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  tid uuid; target_tenant uuid; target_email text; new_password text;
begin
  if (me()->>'role') is distinct from 'owner' then
    raise exception 'owner only';
  end if;
  tid := (me()->>'tenant_id')::uuid;

  select tenant_id, email into target_tenant, target_email from profiles where id = p_staff_id;
  if target_tenant is distinct from tid then
    raise exception 'not found';
  end if;

  if p_new_password is not null and length(p_new_password) < 8 then
    raise exception 'password must be at least 8 characters';
  end if;

  new_password := coalesce(p_new_password, replace(gen_random_uuid()::text, '-', '') || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  update auth_users set password_hash = crypt(new_password, gen_salt('bf', 12)) where id = p_staff_id;

  return jsonb_build_object('email', target_email, 'temp_password', new_password);
end $$;
