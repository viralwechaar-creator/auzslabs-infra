-- =========================================================
-- Self-serve signup: a visitor creates their own auth_users
-- login (POST /auth/signup, no tenant yet -- on_signup's
-- `if new.app_metadata ? 'tenant_id'` guard already skips the
-- profiles row for them, same as platform_admins), picks
-- products in a cart on the marketing site, and submits a
-- request. A platform_admin reviews it and approves/declines --
-- approving provisions the tenant and makes THIS SAME login its
-- owner (they already set their own password at signup, so
-- there's no temp-password handoff step like admin-onboarded
-- clients get).
-- =========================================================

create table signup_requests (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth_users(id) on delete cascade,
  business_name text not null,
  slug          text not null,
  features      jsonb not null default '{}',
  notes         text,
  status        text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  created_at    timestamptz not null default now()
);
alter table signup_requests enable row level security;
create policy own_or_admin_read on signup_requests for select using (user_id = app_uid() or is_platform_admin());
create policy own_insert on signup_requests for insert with check (user_id = app_uid());
create policy admin_update on signup_requests for update using (is_platform_admin()) with check (is_platform_admin());

create function submit_signup_request(p_business_name text, p_slug text, p_features jsonb, p_notes text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  rid uuid;
begin
  if app_uid() is null then
    raise exception 'authentication required';
  end if;
  insert into signup_requests (user_id, business_name, slug, features, notes)
  values (app_uid(), p_business_name, lower(p_slug), coalesce(p_features, '{}'::jsonb), nullif(p_notes, ''))
  returning id into rid;
  return rid;
end;
$$;

-- Provisions the tenant exactly like provision_tenant, but from a
-- signup_request's own chosen features (not a niche preset) and
-- makes the REQUESTING user's existing login the owner, instead of
-- creating a brand-new owner login the way admin/onboard.html does.
create function approve_signup_request(p_request_id uuid, p_niche text default 'general')
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

  update signup_requests set status = 'approved' where id = p_request_id;

  return tid;
end;
$$;

create function decline_signup_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then
    raise exception 'not authorized';
  end if;
  update signup_requests set status = 'declined' where id = p_request_id and status = 'pending';
end;
$$;
