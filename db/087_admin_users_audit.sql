-- =========================================================
-- Admin panel, module 1 of 4 (owner's "Founder's Admin Panel" checklist): a
-- platform-wide Users directory and an admin audit log.
--
-- Until now the admin panel could only manage a whole BUSINESS at a time
-- (Clients: fee, renewal, status, features) -- there was no way to look up
-- one specific PERSON by email across every tenant, see their role, or deal
-- with a lost device without resetting their password and locking them out
-- of everything. admin_list_users/admin_user_detail cover the lookup;
-- admin_set_user_disabled is a real suspend (distinct from self-service
-- deletion, see below); the new /admin/users/:id/revoke-sessions endpoint
-- (server/src/index.js) kills every active session on demand.
--
-- Every other write-heavy part of this product logs its own actions
-- (pos_audit, mob_audit, acc_audit) -- the admin panel itself never did.
-- admin_audit is the same idea at the platform level: append-only, one row
-- per meaningful admin action. admin_log() is an internal helper (same
-- "trusted caller, no guard of its own" convention as mob_audit_log) --
-- never registered as a public RPC. Logging is retrofit into the three
-- existing admin actions with the highest blast radius (editing a client's
-- status/fee, granting/revoking a client's features, deleting a client
-- outright) via create or replace function; everything else they already
-- did is unchanged.
-- =========================================================

create table admin_audit (
  id uuid primary key default gen_random_uuid(),
  admin_id uuid not null references auth_users(id),
  action text not null,
  target_type text not null,
  target_id text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table admin_audit enable row level security;
-- no policies -- same discipline as platform_admins/leads/signup_requests:
-- nothing is readable or writable directly, only through the SECURITY
-- DEFINER functions below, which check is_platform_admin() themselves.
grant select, insert on admin_audit to app;

create function admin_log(p_action text, p_target_type text, p_target_id text, p_detail jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into admin_audit (admin_id, action, target_type, target_id, detail)
  values (app_uid(), p_action, p_target_type, p_target_id, coalesce(p_detail, '{}'::jsonb));
end $$;

create function admin_list_audit(p_limit int default 100) returns jsonb
language plpgsql security definer stable set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return coalesce((select jsonb_agg(x) from (
    select a.id, a.action, a.target_type, a.target_id, a.detail, a.created_at,
      coalesce(nullif(p.name, ''), au.email) as admin_name
    from admin_audit a
    join auth_users au on au.id = a.admin_id
    left join profiles p on p.id = a.admin_id
    order by a.created_at desc
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  ) x), '[]'::jsonb);
end $$;

-- ---------- admin suspend, distinct from self-service deletion ----------
-- auth_users.deleted_at (db/069) is a one-way self-service deletion, logged
-- to account_deletions for a human to follow up the real data purge. An
-- admin-initiated suspension needs to be reversible and must never touch
-- that trail (a suspension is not a deletion request). disabled_at is the
-- separate, admin-only on/off switch; app_uid() and server/src/auth.js's
-- login()/identity lookups treat it exactly like deleted_at -- see that
-- file's own comments for why a JWT issued before the suspension still
-- passes verifyToken() (stateless signature check) but every RLS-gated
-- query after it returns nothing the instant disabled_at is set.
alter table auth_users add column if not exists disabled_at timestamptz;

create or replace function app_uid() returns uuid language sql stable security definer set search_path = public as $$
  select au.id from auth_users au
  where au.id = nullif(current_setting('app.uid', true), '')::uuid
    and au.deleted_at is null and au.disabled_at is null
$$;

create function admin_list_users(p_query text default null, p_limit int default 50) returns jsonb
language plpgsql security definer stable set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return coalesce((select jsonb_agg(x) from (
    select au.id, au.email, coalesce(nullif(p.name, ''), '') as name, p.role, p.tenant_id,
      t.name as tenant_name, t.slug as tenant_slug, au.created_at, au.deleted_at, au.disabled_at,
      exists(select 1 from platform_admins pa where pa.id = au.id) as is_platform_admin
    from auth_users au
    left join profiles p on p.id = au.id
    left join tenants t on t.id = p.tenant_id
    where p_query is null or p_query = ''
      or au.email ilike '%' || p_query || '%'
      or p.name ilike '%' || p_query || '%'
      or t.slug ilike '%' || p_query || '%'
      or t.name ilike '%' || p_query || '%'
    order by au.created_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  ) x), '[]'::jsonb);
end $$;

create function admin_user_detail(p_user_id uuid) returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare u jsonb;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  select jsonb_build_object(
    'id', au.id, 'email', au.email, 'name', coalesce(nullif(p.name, ''), ''), 'role', p.role,
    'tenant_id', p.tenant_id, 'tenant_name', t.name, 'tenant_slug', t.slug,
    'created_at', au.created_at, 'deleted_at', au.deleted_at, 'disabled_at', au.disabled_at,
    'is_platform_admin', exists(select 1 from platform_admins pa where pa.id = au.id)
  ) into u
  from auth_users au
  left join profiles p on p.id = au.id
  left join tenants t on t.id = p.tenant_id
  where au.id = p_user_id;
  if u is null then raise exception 'user not found'; end if;
  return u;
end $$;

create function admin_set_user_disabled(p_user_id uuid, p_disabled boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare target_email text;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  if p_user_id = app_uid() then raise exception 'cannot suspend your own admin login'; end if;
  select email into target_email from auth_users where id = p_user_id;
  if target_email is null then raise exception 'user not found'; end if;
  update auth_users set disabled_at = case when p_disabled then now() else null end where id = p_user_id;
  perform admin_log(case when p_disabled then 'suspend_user' else 'reactivate_user' end, 'user', p_user_id::text, jsonb_build_object('email', target_email));
  return jsonb_build_object('ok', true);
end $$;

-- ---------- retrofit admin_log into the three highest blast-radius existing actions ----------

create or replace function update_client(p_tenant_id uuid, p_monthly_fee numeric, p_renewal_date date, p_notes text, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare slug text;
begin
  if not is_platform_admin() then
    raise exception 'not authorized';
  end if;
  select t.slug into slug from tenants t where t.id = p_tenant_id;
  update tenants set
    monthly_fee = p_monthly_fee,
    renewal_date = p_renewal_date,
    notes = nullif(p_notes, ''),
    status = coalesce(nullif(p_status, ''), status)
  where id = p_tenant_id;
  perform admin_log('update_client', 'tenant', p_tenant_id::text, jsonb_build_object('slug', slug, 'status', p_status, 'monthly_fee', p_monthly_fee));
end;
$$;

create or replace function admin_set_tenant_features(p_tenant_id uuid, p_features jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare slug text;
begin
  if not is_platform_admin() then
    raise exception 'not authorized';
  end if;
  update tenant_settings set features = coalesce(features, '{}'::jsonb) || coalesce(p_features, '{}'::jsonb)
  where tenant_id = p_tenant_id;
  if not found then
    raise exception 'tenant not found';
  end if;
  select t.slug into slug from tenants t where t.id = p_tenant_id;
  perform admin_log('set_tenant_features', 'tenant', p_tenant_id::text, jsonb_build_object('slug', slug, 'features', p_features));
end;
$$;

create or replace function delete_client(p_tenant_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare slug text; cname text;
begin
  if not is_platform_admin() then
    raise exception 'not authorized';
  end if;

  select t.slug, t.name into slug, cname from tenants t where t.id = p_tenant_id;

  delete from auth_users where id in (select id from profiles where tenant_id = p_tenant_id);

  delete from records where tenant_id = p_tenant_id;
  delete from guest_orders where tenant_id = p_tenant_id;
  delete from bookings where tenant_id = p_tenant_id;
  delete from invoice_counters where tenant_id = p_tenant_id;

  delete from tenants where id = p_tenant_id;
  perform admin_log('delete_client', 'tenant', p_tenant_id::text, jsonb_build_object('slug', slug, 'name', cname));
end;
$$;
