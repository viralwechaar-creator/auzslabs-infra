-- AUZsStyle Cloud Sync, Stage 5: more than one remote login, and a way to turn one off. db/277 gave the cloud
-- tenant exactly one login (the owner) with no way back out. Now:
--   * sty_cloud_sync_add_login adds further logins (manager/cashier) to the SAME paired cloud tenant -- for
--     letting a second person (staff, family) check the shop remotely too, without sharing the owner's own
--     password.
--   * sty_cloud_sync_list_logins lists who currently has remote access, for Settings to show and offer to remove.
--   * sty_cloud_sync_remove_login turns a login off: it only removes that PROFILE from this cloud tenant (never
--     the underlying auth_users row, which may be a real AUZslab login used elsewhere -- see sty_cloud_sync_set_owner's
--     own "link an existing login" branch). Removing every login this way is how "remote access" is turned off
--     altogether -- there is deliberately no separate on/off switch, just whether anyone still has a login.

create or replace function sty_cloud_sync_add_login(p_lineage text, p_shop text, p_email text, p_password_hash text, p_role text default 'cashier', p_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; uid_ uuid; email_ text := lower(btrim(coalesce(p_email, ''))); role_ text := coalesce(p_role, 'cashier');
begin
  if email_ = '' or email_ !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address' using errcode = 'ST002'; end if;
  if coalesce(p_password_hash, '') = '' then raise exception 'A password is required' using errcode = 'ST002'; end if;
  if role_ not in ('manager', 'cashier') then raise exception 'Choose manager or cashier for an extra login' using errcode = 'ST002'; end if;
  tid := sty_cloud_sync_ensure_tenant(p_lineage, p_shop);
  if exists (select 1 from profiles where tenant_id = tid and email = email_) then
    return jsonb_build_object('tenantId', tid, 'created', false, 'already', true);
  end if;
  select id into uid_ from auth_users where email = email_;
  if uid_ is not null then
    if exists (select 1 from profiles where id = uid_) then
      raise exception 'This email already has an AUZslab account for a different business. Use a different email for remote access.' using errcode = 'ST002';
    end if;
    update auth_users set app_metadata = app_metadata || jsonb_build_object('tenant_id', tid, 'role', role_) where id = uid_;
    insert into profiles (id, tenant_id, email, role) values (uid_, tid, email_, role_);
  else
    insert into auth_users (email, password_hash, app_metadata, user_metadata, email_verified_at)
    values (email_, p_password_hash, jsonb_build_object('tenant_id', tid, 'role', role_), jsonb_build_object('name', coalesce(nullif(btrim(p_name), ''), 'Staff')), now());
  end if;
  return jsonb_build_object('tenantId', tid, 'created', true, 'already', false);
end $$;

create or replace function sty_cloud_sync_list_logins(p_lineage text) returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('email', p.email, 'role', p.role, 'name', u.user_metadata->>'name') order by p.role, p.email), '[]'::jsonb)
  from sty_sync_tenants st join profiles p on p.tenant_id = st.tenant_id join auth_users u on u.id = p.id
  where st.lineage = p_lineage
$$;

-- Removes one login's access to this cloud tenant (never the underlying auth_users row -- see header). Not
-- finding the lineage's tenant, or not finding that email among its logins, is reported, not an error: the
-- caller (the broker route) has already checked the licence, so this is just "nothing to remove".
create or replace function sty_cloud_sync_remove_login(p_lineage text, p_email text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; email_ text := lower(btrim(coalesce(p_email, ''))); removed_role text;
begin
  select tenant_id into tid from sty_sync_tenants where lineage = p_lineage;
  if tid is null then return jsonb_build_object('removed', false); end if;
  delete from profiles p using auth_users u where p.id = u.id and p.tenant_id = tid and u.email = email_ returning p.role into removed_role;
  return jsonb_build_object('removed', removed_role is not null, 'role', removed_role);
end $$;

-- Rollback: drop function sty_cloud_sync_remove_login(text,text); drop function sty_cloud_sync_list_logins(text);
-- drop function sty_cloud_sync_add_login(text,text,text,text,text,text);
