-- =========================================================
-- Client dashboard: lets a platform_admin see every tenant,
-- what services (modules) they have on, their subscription
-- fee/renewal date, and free-text notes about them, in one
-- place -- and edit those billing fields.
--
-- tenants/tenant_settings had no RLS at all until now. Nothing
-- currently exposes them over HTTP (the generic /db/:table
-- whitelist in server/ only lists records/profiles/guest_orders/
-- push_subs/leads), so this was latent, not an active hole --
-- but the two admin RPCs below are the first thing that reads
-- across ALL tenants at once, so lock the tables down for real
-- instead of continuing to rely on "nothing routes to it yet".
-- =========================================================

alter table tenants add column monthly_fee numeric;
alter table tenants add column renewal_date date;
alter table tenants add column notes text;

alter table tenants enable row level security;
create policy admin_all on tenants for all using (is_platform_admin()) with check (is_platform_admin());

alter table tenant_settings enable row level security;
create policy admin_all on tenant_settings for all using (is_platform_admin()) with check (is_platform_admin());

-- returns jsonb (an array), not `returns table` -- callRpc's
-- `select fnName(...) as result` / `rows[0]?.result` convention (see
-- every other multi-row RPC in this schema, e.g. public_menu) would
-- otherwise expand a `returns table` function's rows into multiple
-- result rows and silently drop everything but the first tenant.
create function list_clients()
returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then
    raise exception 'not authorized';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', t.id, 'name', t.name, 'slug', t.slug, 'niche', t.niche,
      'plan', t.plan, 'status', t.status,
      'monthly_fee', t.monthly_fee, 'renewal_date', t.renewal_date, 'notes', t.notes,
      'features', coalesce(ts.features, '{}'::jsonb), 'created_at', t.created_at
    ) order by t.created_at desc)
    from tenants t
    left join tenant_settings ts on ts.tenant_id = t.id
  ), '[]'::jsonb);
end;
$$;

create function update_client(p_tenant_id uuid, p_monthly_fee numeric, p_renewal_date date, p_notes text, p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then
    raise exception 'not authorized';
  end if;
  update tenants set
    monthly_fee = p_monthly_fee,
    renewal_date = p_renewal_date,
    notes = nullif(p_notes, ''),
    status = coalesce(nullif(p_status, ''), status)
  where id = p_tenant_id;
end;
$$;
