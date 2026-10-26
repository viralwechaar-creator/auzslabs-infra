-- Online ordering can now offer add-ons (toppings, extras) and "without" choices.
-- public_menu() therefore also returns the add-on groups (kind 'addongrp'); everything else is unchanged
-- (db/028 version). The shop's packaging kit (how many boxes and sachets each order type uses) is
-- internal, so it is removed from the public copy of the settings record.
create or replace function public_menu(tenant_slug text) returns jsonb language sql security definer stable set search_path = public as $$
  select jsonb_build_object(
    'items',  coalesce((select jsonb_agg(r.data) from records r join tenants t on t.id = r.tenant_id where t.slug = tenant_slug and r.kind = 'item'  and not r.deleted), '[]'::jsonb),
    'cats',   coalesce((select jsonb_agg(r.data) from records r join tenants t on t.id = r.tenant_id where t.slug = tenant_slug and r.kind = 'cat'   and not r.deleted), '[]'::jsonb),
    'groups', coalesce((select jsonb_agg(r.data) from records r join tenants t on t.id = r.tenant_id where t.slug = tenant_slug and r.kind = 'addongrp' and not r.deleted), '[]'::jsonb),
    'tables', coalesce((select jsonb_agg(r.data) from records r join tenants t on t.id = r.tenant_id where t.slug = tenant_slug and r.kind = 'table' and not r.deleted), '[]'::jsonb),
    'ings',   coalesce((select jsonb_agg(jsonb_build_object('name', r.data->>'name', 'qty', r.data->'qty')) from records r join tenants t on t.id = r.tenant_id where t.slug = tenant_slug and r.kind = 'ing' and not r.deleted), '[]'::jsonb),
    'cfg',    coalesce((
                select (r.data - 'packKit') || jsonb_build_object(
                  '_features', coalesce(ts.features, '{}'::jsonb),
                  '_enabled_features', coalesce(ts.enabled_features, '{}'::jsonb)
                )
                from records r
                join tenants t on t.id = r.tenant_id
                left join tenant_settings ts on ts.tenant_id = t.id
                where t.slug = tenant_slug and r.kind = 'settings' and r.id = 'settings'
              ), '{}'::jsonb)
  )
$$;
