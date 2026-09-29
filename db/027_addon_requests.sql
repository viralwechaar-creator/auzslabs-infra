-- =========================================================
-- Bug report: an existing, already-subscribed client had no way to
-- add a NEW product to their subscription -- account.html's Services
-- tab (db/013's my_dashboard/update_my_features) only ever toggles
-- features they're ALREADY entitled to on/off, and products.html's
-- "Add to cart" -> cart.html flow (db/007's submit_signup_request)
-- assumes the visitor is a brand-new prospect with no tenant yet --
-- it collects a business name/slug/niche and provisions a WHOLE NEW
-- tenant on approval. Pointing an existing owner at that same form
-- would either fail outright (their chosen slug collides with their
-- own tenant) or, worse, spin up a second empty tenant next to their
-- real one. This is the missing "existing client wants add-on X"
-- request/approval path, deliberately separate from signup_requests
-- since approving one never provisions anything -- it only merges new
-- keys into a tenant_settings row that already exists.
-- =========================================================

-- tenant_name/tenant_slug are a denormalized snapshot, same as
-- signup_requests' own business_name/slug -- the hand-rolled API
-- server (server/src/index.js) has no relational-embed support like
-- PostgREST's `select=*,tenants(name)`, only flat per-table selects
-- against its own whitelist, so admin.html can't join this to
-- `tenants` at read time even if it were allowed to read that table
-- directly (it isn't).
create table addon_requests (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  tenant_name   text not null,
  tenant_slug   text not null,
  user_id       uuid not null references auth_users(id) on delete cascade,
  features      jsonb not null default '{}',
  notes         text,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  created_at    timestamptz not null default now()
);
create index idx_addon_requests_tenant on addon_requests (tenant_id, created_at desc);
alter table addon_requests enable row level security;
create policy own_or_admin_read on addon_requests for select
  using (tenant_id = (me()->>'tenant_id')::uuid or is_platform_admin());
create policy owner_insert on addon_requests for insert
  with check (user_id = app_uid() and tenant_id = (me()->>'tenant_id')::uuid and (me()->>'role') = 'owner');
create policy admin_update on addon_requests for update
  using (is_platform_admin()) with check (is_platform_admin());

-- Only the keys the tenant doesn't already have true in features can
-- be requested -- silently dropping the rest (rather than erroring)
-- covers the exact bug this migration fixes: products.html/cart.html
-- can send the visitor's whole cart through unfiltered (a mix of
-- owned and new keys, since the client-side check is best-effort) and
-- this is the real, server-side gate that actually enforces it.
create function submit_addon_request(p_features jsonb, p_notes text)
returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid; entitled jsonb; requested jsonb; rid uuid; tname text; tslug text;
begin
  if (me()->>'role') is distinct from 'owner' then
    raise exception 'owner only';
  end if;
  tid := (me()->>'tenant_id')::uuid;

  select name, slug into tname, tslug from tenants where id = tid;

  select coalesce(features, '{}'::jsonb) into entitled from tenant_settings where tenant_id = tid;

  select coalesce(jsonb_object_agg(k.key, true), '{}'::jsonb) into requested
  from jsonb_object_keys(coalesce(p_features, '{}'::jsonb)) as k(key)
  where coalesce(entitled->>k.key, 'false') is distinct from 'true';

  if requested = '{}'::jsonb then
    raise exception 'you already have everything in this request';
  end if;

  insert into addon_requests (tenant_id, tenant_name, tenant_slug, user_id, features, notes)
  values (tid, tname, tslug, app_uid(), requested, nullif(p_notes, ''))
  returning id into rid;
  return rid;
end;
$$;

create function approve_addon_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare req addon_requests%rowtype;
begin
  if not is_platform_admin() then
    raise exception 'not authorized';
  end if;

  select * into req from addon_requests where id = p_request_id and status = 'pending';
  if not found then
    raise exception 'request not found or already handled';
  end if;

  update tenant_settings set features = coalesce(features, '{}'::jsonb) || req.features where tenant_id = req.tenant_id;
  update addon_requests set status = 'approved' where id = p_request_id;

  insert into notifications (tenant_id, type, title, body)
  values (req.tenant_id, 'addon_approved', 'New service added to your account',
    'Refresh your account page -- ' || (select string_agg(k, ', ') from jsonb_object_keys(req.features) k) || ' is now live on your subscription.');
end;
$$;

create function decline_addon_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then
    raise exception 'not authorized';
  end if;
  update addon_requests set status = 'declined' where id = p_request_id and status = 'pending';
end;
$$;

create function notify_admin_new_addon_request() returns trigger language plpgsql as $$
begin
  insert into notifications (tenant_id, type, title, body)
  values (null, 'addon_request', 'Add-on request: ' || new.tenant_name,
    (select string_agg(k, ', ') from jsonb_object_keys(new.features) k));
  return new;
end $$;
create trigger t_notify_addon_request after insert on addon_requests for each row execute function notify_admin_new_addon_request();

-- New table -- 999_app_grants.sql's blanket grant only covers what
-- existed the moment it last ran against the live database (see
-- CLAUDE.md's migration gotcha), so this needs its own explicit grant
-- or the API server's `app` role gets "permission denied for table
-- addon_requests" even though the RLS policies above look fine.
grant select, insert, update, delete on addon_requests to app;
