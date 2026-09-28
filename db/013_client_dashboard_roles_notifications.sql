-- =========================================================
-- Client self-service dashboard: a tenant owner can now see their
-- own live services, renewal date, change their own password,
-- toggle which subscribed modules are actively switched on, invite
-- staff with a custom role, and define what each role can access.
-- Plus a notification system: admins get notified of new leads/
-- signups, and admins can push messages to a specific client.
--
-- Design choices, and why:
--   - 'owner' stays the one hardcoded superuser role everywhere
--     (every existing RLS policy already checks role = 'owner'
--     specifically -- see 002_core_engine.sql). Nothing about that
--     changes. Custom roles are an ADDITIONAL layer on top, for
--     everyone who isn't the owner, enforced by the client app's
--     own UI (which tabs/buttons to show), not by new RLS -- RLS
--     already protects the underlying data by tenant_id; per-tab
--     visibility is a UI concern.
--   - features (what the client is ENTITLED to, admin-controlled,
--     already existed) is now distinct from enabled_features (which
--     of those entitled modules the client currently has switched
--     ON, self-service). update_my_features clamps to the entitled
--     set server-side -- a client can turn a paid module off/on,
--     never grant themselves one they were never approved for.
-- =========================================================

-- ---------------------------------------------------------
-- roles: custom per-tenant roles with a feature-permission map.
-- Keys match the POS app's own tab keys (pos/orders/kitchen/
-- reports/staff/inventory/crm/menu/settings) plus 'billing' for
-- the void/refund/discount authority the old 'manager' role had.
-- Missing key = no access, same as false.
-- ---------------------------------------------------------
create table roles (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade default (me()->>'tenant_id')::uuid,
  name         text not null,
  permissions  jsonb not null default '{}',
  created_at   timestamptz not null default now(),
  unique (tenant_id, name)
);
alter table roles enable row level security;
-- everyone in the tenant can read the role list (a staffer needs to
-- know their own permissions); only the owner can create/edit/delete.
create policy roles_owner_write on roles for all
  using (tenant_id = (me()->>'tenant_id')::uuid and (me()->>'role') = 'owner')
  with check (tenant_id = (me()->>'tenant_id')::uuid and (me()->>'role') = 'owner');
create policy roles_tenant_read on roles for select
  using (tenant_id = (me()->>'tenant_id')::uuid);

-- ---------------------------------------------------------
-- profiles: drop the fixed 3-value role check (owner/manager/
-- cashier) -- 'owner' is still the only value any policy actually
-- gates on, so any other text is safe. Add the fields the staff
-- directory needs, and role_id linking a staffer to their custom
-- role's permissions.
-- ---------------------------------------------------------
alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_not_empty check (role <> '');
alter table profiles add column if not exists role_id uuid references roles(id) on delete set null;
alter table profiles add column if not exists name text;
alter table profiles add column if not exists phone text;

-- on_signup already handles self-signup (no tenant_id) and
-- admin-provisioned owners (tenant_id + role only) -- extend it to
-- also pick up role_id/name/phone when a caller provides them
-- (invite_staff below does), backward compatible since existing
-- callers just leave those keys out and get NULLs, same as today.
create or replace function on_signup() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.app_metadata ? 'tenant_id' then
    insert into profiles (id, tenant_id, email, role, role_id, name, phone)
    values (
      new.id,
      (new.app_metadata->>'tenant_id')::uuid,
      new.email,
      coalesce(new.app_metadata->>'role', 'cashier'),
      nullif(new.app_metadata->>'role_id', '')::uuid,
      new.app_metadata->>'name',
      new.app_metadata->>'phone'
    );
  end if;
  return new;
end $$;

-- invite_staff: owner-only. Creates the login + profiles row in one
-- go (via on_signup's trigger, same path self-signup/admin-provision
-- already use) and hands back a temp password for the owner to share
-- directly -- same manual handoff every other "new login" path in
-- this project already uses (no transactional email sender exists).
create function invite_staff(p_email text, p_name text, p_phone text, p_role_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  tid uuid; role_name text; new_uid uuid; new_password text;
begin
  if (me()->>'role') is distinct from 'owner' then
    raise exception 'owner only';
  end if;
  tid := (me()->>'tenant_id')::uuid;

  select name into role_name from roles where id = p_role_id and tenant_id = tid;
  if role_name is null then
    raise exception 'unknown role';
  end if;

  new_password := replace(gen_random_uuid()::text, '-', '') || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);

  insert into auth_users (email, password_hash, app_metadata)
  values (
    p_email,
    crypt(new_password, gen_salt('bf', 12)),
    jsonb_build_object('tenant_id', tid, 'role', role_name, 'role_id', p_role_id, 'name', p_name, 'phone', p_phone)
  )
  returning id into new_uid;

  return jsonb_build_object('id', new_uid, 'email', p_email, 'temp_password', new_password);
end $$;

-- remove_staff: owner-only, can't remove yourself or another owner
-- by accident -- deletes the login outright (cascades to profiles).
create function remove_staff(p_staff_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare tid uuid; target_role text; target_tenant uuid;
begin
  if (me()->>'role') is distinct from 'owner' then
    raise exception 'owner only';
  end if;
  tid := (me()->>'tenant_id')::uuid;
  select role, tenant_id into target_role, target_tenant from profiles where id = p_staff_id;
  if target_tenant is distinct from tid then
    raise exception 'not found';
  end if;
  if p_staff_id = app_uid() then
    raise exception 'cannot remove your own login';
  end if;
  if target_role = 'owner' then
    raise exception 'cannot remove an owner login';
  end if;
  delete from auth_users where id = p_staff_id;
end $$;

-- delete_role: owner-only. Any staffer currently on this role falls
-- back to no role_id (the client app then applies the same default
-- permission set a legacy/no-role-yet staffer already gets -- see
-- app/public/index.html's DEFAULT_PERMS), never left broken.
create function delete_role(p_role_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  if (me()->>'role') is distinct from 'owner' then
    raise exception 'owner only';
  end if;
  tid := (me()->>'tenant_id')::uuid;
  update profiles set role_id = null where role_id = p_role_id and tenant_id = tid;
  delete from roles where id = p_role_id and tenant_id = tid;
end $$;

-- ---------------------------------------------------------
-- tenant self-service: read your own tenant/subscription info,
-- change your own password, toggle which entitled modules are on.
-- tenants/tenant_settings had admin-only RLS until now (006) --
-- add an owner-read policy for their own row, without touching the
-- admin_all policy.
-- ---------------------------------------------------------
create policy owner_read_own on tenants for select
  using (id = (me()->>'tenant_id')::uuid);

alter table tenant_settings add column if not exists enabled_features jsonb not null default '{}';
create policy owner_read_own on tenant_settings for select
  using (tenant_id = (me()->>'tenant_id')::uuid);

create function my_dashboard()
returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  if me() is null then raise exception 'authentication required'; end if;
  tid := (me()->>'tenant_id')::uuid;
  if tid is null then raise exception 'not a tenant member'; end if;

  return (
    select jsonb_build_object(
      'tenant', jsonb_build_object(
        'id', t.id, 'name', t.name, 'slug', t.slug, 'niche', t.niche,
        'plan', t.plan, 'status', t.status, 'monthly_fee', t.monthly_fee, 'renewal_date', t.renewal_date
      ),
      'features', coalesce(ts.features, '{}'::jsonb),
      'enabled_features', coalesce(ts.enabled_features, '{}'::jsonb),
      'my_role', (me()->>'role'),
      'my_email', (select email from auth_users where id = app_uid())
    )
    from tenants t
    left join tenant_settings ts on ts.tenant_id = t.id
    where t.id = tid
  );
end $$;

-- clamps to the entitled set: a key can only be toggled if it's
-- true in `features` (what they're actually subscribed to) --
-- absent/false-in-features keys are dropped, never turned on.
create function update_my_features(p_enabled jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; entitled jsonb; clamped jsonb;
begin
  if (me()->>'role') is distinct from 'owner' then
    raise exception 'owner only';
  end if;
  tid := (me()->>'tenant_id')::uuid;

  select features into entitled from tenant_settings where tenant_id = tid;

  select coalesce(jsonb_object_agg(e.key, coalesce((p_enabled->>e.key)::boolean, true)), '{}'::jsonb)
  into clamped
  from jsonb_each_text(coalesce(entitled, '{}'::jsonb)) as e(key, val)
  where e.val = 'true';

  update tenant_settings set enabled_features = clamped, updated_at = now() where tenant_id = tid;
  return clamped;
end $$;

-- password verification done in pure SQL: crypt(plaintext,
-- existing_hash) reuses that hash's own salt/cost, so it returns
-- the SAME hash back only if plaintext is correct -- no Node
-- round-trip needed, same pgcrypto already used for bcrypt
-- elsewhere in this schema (see 009_admin_reset_password.sql).
create function change_my_password(p_old_password text, p_new_password text)
returns void language plpgsql security definer set search_path = public as $$
declare current_hash text;
begin
  if app_uid() is null then raise exception 'authentication required'; end if;
  if length(p_new_password) < 8 then
    raise exception 'new password must be at least 8 characters';
  end if;
  select password_hash into current_hash from auth_users where id = app_uid();
  if current_hash is null or current_hash <> crypt(p_old_password, current_hash) then
    raise exception 'current password is incorrect';
  end if;
  update auth_users set password_hash = crypt(p_new_password, gen_salt('bf', 12)) where id = app_uid();
end $$;

-- ---------------------------------------------------------
-- notifications: tenant_id null = admin-facing (platform-wide);
-- tenant_id set = visible to every staffer of that tenant. Two
-- separate audiences, cleanly split by that one column.
-- ---------------------------------------------------------
create table notifications (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references tenants(id) on delete cascade,
  type        text not null,
  title       text not null,
  body        text,
  link        text,
  read        boolean not null default false,
  created_by  uuid references auth_users(id),
  created_at  timestamptz not null default now()
);
create index idx_notifications_tenant on notifications (tenant_id, created_at desc);
alter table notifications enable row level security;

create policy notif_admin_read on notifications for select
  using (tenant_id is null and is_platform_admin());
create policy notif_admin_update on notifications for update
  using (tenant_id is null and is_platform_admin())
  with check (tenant_id is null and is_platform_admin());
create policy notif_tenant_read on notifications for select
  using (tenant_id = (me()->>'tenant_id')::uuid);
create policy notif_tenant_update on notifications for update
  using (tenant_id = (me()->>'tenant_id')::uuid)
  with check (tenant_id = (me()->>'tenant_id')::uuid);

create function notify_admin_new_lead() returns trigger language plpgsql as $$
begin
  insert into notifications (tenant_id, type, title, body)
  values (null, 'lead', 'New lead: ' || coalesce(new.business, new.name), coalesce(new.message, new.contact));
  return new;
end $$;
create trigger t_notify_lead after insert on leads for each row execute function notify_admin_new_lead();

create function notify_admin_new_signup() returns trigger language plpgsql as $$
begin
  insert into notifications (tenant_id, type, title, body)
  values (null, 'signup_request', 'New signup request: ' || new.business_name, coalesce(new.contact_name, '') || ' · ' || coalesce(new.phone, ''));
  return new;
end $$;
create trigger t_notify_signup after insert on signup_requests for each row execute function notify_admin_new_signup();

-- admin -> one client. Anything else (a system alert -- low stock,
-- order ready) is computed client-side already (see index.html's
-- lowBar/readyBar) and doesn't need a row here.
create function send_client_notification(p_tenant_id uuid, p_title text, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare nid uuid;
begin
  if not is_platform_admin() then
    raise exception 'not authorized';
  end if;
  insert into notifications (tenant_id, type, title, body, created_by)
  values (p_tenant_id, 'admin_message', p_title, nullif(p_body, ''), app_uid())
  returning id into nid;
  return nid;
end $$;

-- realtime: reuse the exact same "live_changes" NOTIFY channel the
-- API server already listens on for records/guest_orders, so a new
-- notification shows up without a page reload on both the admin
-- panel and the client app, same mechanism, no new plumbing.
create function notify_notifications_change() returns trigger language plpgsql as $$
begin
  perform pg_notify('live_changes', jsonb_build_object(
    'table', 'notifications', 'tenant_id', new.tenant_id, 'id', new.id
  )::text);
  return new;
end $$;
create trigger t_notify_notifications after insert on notifications for each row execute function notify_notifications_change();
