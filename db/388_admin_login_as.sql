-- Platform admin can open any business's apps as that business's owner (a limited 8-hour session, logged).
-- The server route /admin/login-as calls this to find the owner and write the audit entry.
create or replace function admin_login_as_context(p_tenant uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t tenants; u record;
begin
  if not is_platform_admin() then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into t from tenants where id = p_tenant;
  if t.id is null then raise exception 'That business was not found.'; end if;
  select a.id, a.email, a.app_metadata into u from profiles p join auth_users a on a.id = p.id
    where p.tenant_id = p_tenant and p.role = 'owner' and a.deleted_at is null order by a.created_at limit 1;
  if u.id is null then raise exception 'This business has no owner login yet.'; end if;
  perform admin_log('login_as', 'tenant', p_tenant::text, jsonb_build_object('slug', t.slug, 'owner', u.email));
  return jsonb_build_object('user', jsonb_build_object('id', u.id, 'email', u.email, 'app_metadata', u.app_metadata),
    'slug', t.slug, 'name', t.name,
    'features', coalesce((select features from tenant_settings where tenant_id = p_tenant), '{}'::jsonb));
end $$;
