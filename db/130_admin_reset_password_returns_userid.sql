-- admin_reset_client_password (db/009) changes a client owner's password hash but never told
-- anything to revoke that owner's existing sessions. This matters because of exactly how
-- admin.html's "Log in as owner (setup)" flow actually works: there's no separate impersonation
-- session -- the platform admin calls this function to get a fresh real password, then literally
-- logs into the owner's real account with it, in their own browser. When setup is done, "Mark set
-- up & hand over" calls this function AGAIN to generate the final handoff password -- the UI even
-- tells the admin "any password you were using to set things up stops working". That's only half
-- true: the OLD PASSWORD stops working, but the admin's own still-open "setup" session (a signed
-- JWT, not tied to the password at all) keeps working for up to 7 days, exactly like every other
-- password-change path in this app already closes (change_my_password, reset_staff_password,
-- staff_reset_pin, staff_set_active(false) -- see server/src/index.js's own comment on this).
-- Fix: return the owner's user_id so the API layer can revoke their sessions the same way.
create or replace function admin_reset_client_password(p_tenant_id uuid)
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

  return jsonb_build_object('email', owner_email, 'temp_password', new_password, 'user_id', owner_id);
end $$;
