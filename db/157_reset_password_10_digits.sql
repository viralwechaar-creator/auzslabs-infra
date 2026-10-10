-- Temporary client password after "Reset password" is now 10 digits instead of a 40-character string.
create or replace function admin_reset_client_password(p_tenant_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  owner_id uuid;
  owner_email text;
  new_password text := '';
  i int;
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

  -- 10 digits (easy to read out or type); it is temporary and the login is rate limited
  for i in 1..10 loop
    new_password := new_password || (get_byte(gen_random_bytes(1), 0) % 10)::text;
  end loop;
  update auth_users set password_hash = crypt(new_password, gen_salt('bf', 12)) where id = owner_id;

  return jsonb_build_object('email', owner_email, 'temp_password', new_password, 'user_id', owner_id);
end $$;
