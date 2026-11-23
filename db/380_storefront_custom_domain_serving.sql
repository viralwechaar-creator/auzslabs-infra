-- Storefront phase 4: serving a store on its own verified domain. These functions are for the SERVER only (Caddy asks
-- the API "may I get a certificate for this host?" and "which store is this host?") -- deliberately not in the RPC
-- allow-list, same discipline as provision_from_payment. A host counts only while ALL of these hold: the domain is verified,
-- the storefront is switched on for the business, and the store is published.
create function sfx_domain_site(p_host text) returns text language sql stable security definer set search_path = public as $$
  select t.slug from sfx_domains d
    join tenants t on t.id = d.tenant_id
    join sfx_stores s on s.tenant_id = d.tenant_id and s.published
    join tenant_settings ts on ts.tenant_id = d.tenant_id
  where d.hostname = lower(coalesce(p_host, '')) and d.status = 'verified'
    and coalesce(ts.features->>'storefront', 'false') = 'true' and coalesce(ts.enabled_features->>'storefront', 'true') <> 'false'
  limit 1
$$;

create function sfx_domain_hosts() returns text[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(d.hostname), '{}') from sfx_domains d where d.status = 'verified'
$$;

-- the owner can disconnect a domain (verified or not)
create function sfx_domain_remove(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage');
begin delete from sfx_domains where id = p_id and tenant_id = tid; end $$;

-- Rollback: drop function sfx_domain_site, sfx_domain_hosts, sfx_domain_remove.
