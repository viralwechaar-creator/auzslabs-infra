-- =========================================================
-- Let a platform admin edit a client's subdomain (owner request: "add
-- edit subdomain option too for client in admin panel") -- e.g. to fix
-- a slug picked during onboarding (mannatcafe77623 instead of
-- mannatcafe) once the client is confirmed real, or to correct a typo.
-- Same format/reserved-word rules as provision_tenant's own slug
-- check; `slug unique not null` + the tenants_slug_not_reserved check
-- constraint (db/111) still apply and are the final word either way.
-- =========================================================

create or replace function admin_set_tenant_slug(p_tenant_id uuid, p_slug text) returns void
language plpgsql security definer set search_path = public as $$
declare v_slug text := lower(trim(coalesce(p_slug, ''))); v_old text;
begin
  if not is_platform_admin() then
    raise exception 'not authorized';
  end if;
  if v_slug !~ '^[a-z0-9-]{3,30}$' then
    raise exception 'The address must be 3-30 characters: lowercase letters, numbers and hyphens only.';
  end if;
  select slug into v_old from tenants where id = p_tenant_id;
  if v_old is null then
    raise exception 'Client not found.';
  end if;
  if v_slug = v_old then
    return; -- no change
  end if;
  if exists (select 1 from tenants where slug = v_slug and id <> p_tenant_id) then
    raise exception 'That address is already taken by another client.';
  end if;
  update tenants set slug = v_slug, updated_at = now() where id = p_tenant_id;
  perform admin_log('update_client', 'tenant', p_tenant_id::text, jsonb_build_object('old_slug', v_old, 'new_slug', v_slug, 'field', 'subdomain'));
end;
$$;
