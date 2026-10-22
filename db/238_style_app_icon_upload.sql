-- AUZsStyle: a separate home-screen icon (settings -> App icon) is passed to the icon drawer as settings.appIcon,
-- which uses it edge to edge. It wins over the logo.
create or replace function public_app_icon_context(p_slug text) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', t.id, 'name', t.name,
    'settings', rec.d
      || case when coalesce(st.logo_url, '') <> '' then jsonb_build_object('logo', st.logo_url) else '{}'::jsonb end
      || case when coalesce(st.features->>'appIcon', '') <> '' then jsonb_build_object('appIcon', st.features->>'appIcon') else '{}'::jsonb end
      || case when coalesce(st.shop_name, '') <> '' then jsonb_build_object('name', st.shop_name) else '{}'::jsonb end)
  from tenants t
  left join sty_settings st on st.tenant_id = t.id
  cross join lateral (select coalesce((select r.data from records r where r.tenant_id = t.id and r.kind = 'settings' and r.id = 'settings'), '{}'::jsonb) as d) rec
  where t.slug = p_slug
$$;
