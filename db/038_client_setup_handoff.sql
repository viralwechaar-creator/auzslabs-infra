-- =========================================================
-- Real incident: a client self-signed-up, added products to cart,
-- we approved their signup_request -- but on login they kept
-- landing back on cart.html telling them to add products, never
-- reaching their actual dashboard.
--
-- Root cause: approve_signup_request (007) inserts their `profiles`
-- row (making them a real tenant owner at the database/RLS level --
-- me()/RLS always reads from profiles, never from auth_users.
-- app_metadata) but never touches auth_users.app_metadata. signup.
-- html's post-login redirect, meanwhile, decides where to send
-- someone by checking `user.app_metadata.tenant_id` off the JWT --
-- a stale snapshot from whenever they first signed up, before they
-- had a tenant. So a fully-provisioned owner kept getting bounced
-- to cart.html by a redirect check that was reading the wrong
-- source of truth.
--
-- Fixed two ways, belt and suspenders:
--   1. approve_signup_request now also syncs auth_users.app_metadata
--      (same shape admin-provisioned owners get at createUser time),
--      so future approvals don't create the same drift.
--   2. site/signup.html's redirect (see that file) now checks their
--      actual profiles row instead of the JWT snapshot, so this
--      whole class of bug -- app_metadata drifting out of sync with
--      profiles, from *any* code path, not just this one -- can't
--      strand someone on cart.html again.
-- =========================================================

create or replace function approve_signup_request(p_request_id uuid, p_niche text default 'general')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  req signup_requests%rowtype;
  tid uuid;
begin
  if not is_platform_admin() then
    raise exception 'not authorized';
  end if;

  select * into req from signup_requests where id = p_request_id and status = 'pending';
  if not found then
    raise exception 'request not found or already handled';
  end if;

  insert into tenants (name, slug, niche, status)
  values (req.business_name, req.slug, p_niche, 'active')
  returning id into tid;

  insert into tenant_settings (tenant_id, features) values (tid, req.features);

  insert into records (id, tenant_id, kind, data)
  values ('settings', tid, 'settings', jsonb_build_object('name', req.business_name));

  insert into profiles (id, tenant_id, email, role)
  values (req.user_id, tid, (select email from auth_users where id = req.user_id), 'owner');

  update auth_users set app_metadata = app_metadata || jsonb_build_object('tenant_id', tid, 'role', 'owner')
    where id = req.user_id;

  update signup_requests set status = 'approved' where id = p_request_id;

  return tid;
end;
$$;

-- =========================================================
-- The other half of the same incident: even once login lands them
-- on the right dashboard, a client's *first* login should never be
-- to an empty, unconfigured tenant. This gives the AUZslab team a
-- tracked "still needs concierge setup" queue in admin.html and a
-- way to mark one done once the menu/tables/staff have actually
-- been built out on the client's behalf and a fresh handoff
-- password has been generated -- see admin.html's new Setup section.
-- =========================================================

alter table tenants add column if not exists delivered_at timestamptz;

-- Every tenant that already existed before this migration was already
-- live and in the client's hands one way or another -- only tenants
-- onboarded from here on should show up in the new setup queue.
update tenants set delivered_at = created_at where delivered_at is null;

create or replace function list_clients()
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
      'features', coalesce(ts.features, '{}'::jsonb), 'created_at', t.created_at,
      'delivered_at', t.delivered_at
    ) order by t.created_at desc)
    from tenants t
    left join tenant_settings ts on ts.tenant_id = t.id
  ), '[]'::jsonb);
end;
$$;

create function mark_client_delivered(p_tenant_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then
    raise exception 'not authorized';
  end if;
  update tenants set delivered_at = now() where id = p_tenant_id;
end;
$$;
