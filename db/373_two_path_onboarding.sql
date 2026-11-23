-- =========================================================
-- Two-path onboarding gate (owner request, Nov 2026): every BRAND-NEW
-- signup must choose, before reaching any dashboard, between:
--
--   Path A -- "AUZslab apps": one of three bundles (AUZsLedger alone;
--   AUZsStyle + its own built-in website; Salon Console + its own
--   built-in website -- confirmed against db/228_style_store.sql and
--   app/public/salon/: both products' public storefront is already
--   part of the 'style'/'salon' feature, so no extra feature key is
--   needed for "+ website"). Reuses the EXISTING, already-in-production
--   request pipeline (signup_requests / submit_signup_request /
--   approve_signup_request, db/007) end to end -- nothing about that
--   pipeline's shape changes, this only tags which KIND of dashboard the
--   approved tenant should land on.
--
--   Path B -- "Build a complete online store": immediate self-serve
--   provisioning with a 3-day free trial of the Shopify-style storefront
--   platform (db/372_storefront_platform.sql).
--
-- RECONCILIATION NOTE (this file was originally written and numbered
-- db/372_two_path_onboarding.sql, on feature/two-path-onboarding-basic-
-- dashboard, before feature/storefront-platform-phase1 had been pushed --
-- see that branch's PR #1099). It created its own placeholder
-- storefront_stores table with guessed field names. Reconciled here,
-- renumbered to the next free migration number: Path B now provisions a
-- row in sfx_storefront_platform's OWN real sfx_stores table (tenant_id
-- primary key, trial_started_at/trial_ends_at/plan_status columns) instead
-- of a parallel table -- there is exactly ONE trial/plan-status mechanism
-- for the storefront product (sfx_stores + sfx_guard/sfx_tenant, both
-- defined in db/372_storefront_platform.sql), not two. The placeholder
-- storefront_stores table/functions this file used to define are gone;
-- sfx_guard/sfx_tenant/sfx_stores from db/372_storefront_platform.sql
-- must run before this file (alphabetically 372 < 373, so they do).
-- =========================================================

-- ---------- which lane a tenant is on ----------
-- 'full'       -- every existing tenant (admin-onboarded, or a signup from
--                 before this migration): completely unaffected, keeps
--                 today's full account.html experience. This is the default
--                 so nothing already live changes behaviour.
-- 'basic'      -- Path A: approved into the trimmed "basic dashboard".
-- 'storefront' -- Path B: the new storefront platform (trial or paid).
alter table tenants add column if not exists onboarding_path text not null default 'full'
  check (onboarding_path in ('full', 'basic', 'storefront'));
alter table signup_requests add column if not exists onboarding_path text not null default 'full'
  check (onboarding_path in ('full', 'basic'));

-- submit_signup_request gains a 9th parameter (onboarding_path changes the
-- function's identity in Postgres, same reasoning db/012's own comment gives
-- for why that migration dropped-and-recreated rather than CREATE OR REPLACE).
-- Every existing caller that inserts into signup_requests directly (db/155,
-- db/186, db/260's provisioning paths) is untouched -- they never call this
-- function and the new column defaults to 'full' for them.
drop function if exists submit_signup_request(text, text, jsonb, text, text, text, text, text);

create function submit_signup_request(
  p_business_name text, p_slug text, p_features jsonb, p_notes text,
  p_contact_name text default null, p_phone text default null,
  p_niche text default null, p_address text default null,
  p_onboarding_path text default 'full'
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  rid uuid;
  feats jsonb := coalesce(p_features, '{}'::jsonb);
  lane text := coalesce(p_onboarding_path, 'full');
begin
  if app_uid() is null then
    raise exception 'authentication required';
  end if;
  if lane not in ('full', 'basic') then
    raise exception 'unknown onboarding path: %', lane;
  end if;
  if coalesce((feats->>'self_order')::boolean, false) and not coalesce((feats->>'pos')::boolean, false) then
    raise exception 'AUZsPOS QR is an add-on to AUZsPOS -- add AUZsPOS to this request too.';
  end if;
  insert into signup_requests (user_id, business_name, slug, features, notes, contact_name, phone, niche, address, onboarding_path)
  values (
    app_uid(), p_business_name, lower(p_slug), feats, nullif(p_notes, ''),
    nullif(p_contact_name, ''), nullif(p_phone, ''), nullif(p_niche, ''), nullif(p_address, ''), lane
  )
  returning id into rid;
  return rid;
end;
$$;

-- approve_signup_request: same signature as db/056's version (no new
-- parameter needed -- the lane travels on the request row itself), just
-- carries req.onboarding_path onto the new tenant.
create or replace function approve_signup_request(p_request_id uuid, p_niche text default 'general')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  req signup_requests%rowtype;
  tid uuid;
  feats jsonb;
begin
  if not is_platform_admin() then
    raise exception 'not authorized';
  end if;

  select * into req from signup_requests where id = p_request_id and status = 'pending';
  if not found then
    raise exception 'request not found or already handled';
  end if;

  feats := coalesce(req.features, '{}'::jsonb);
  if p_niche = 'salon' then
    feats := feats || '{"salon": true, "booking": true, "crm": true, "billing": true}'::jsonb;
  end if;

  insert into tenants (name, slug, niche, status, onboarding_path)
  values (req.business_name, req.slug, p_niche, 'active', coalesce(req.onboarding_path, 'full'))
  returning id into tid;

  insert into tenant_settings (tenant_id, features) values (tid, feats);

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

-- Same lane propagation for the Razorpay instant-pay-and-activate path
-- (db/070) -- a Path-A tenant who pays online instead of waiting for manual
-- approval still lands on the basic dashboard, not the full one.
create or replace function provision_from_payment(p_payment_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare pay payments%rowtype; req signup_requests%rowtype; tid uuid;
begin
  select * into pay from payments where id = p_payment_id and status = 'paid';
  if not found or pay.signup_request_id is null then
    raise exception 'payment not found, not paid, or not a signup payment';
  end if;

  select * into req from signup_requests where id = pay.signup_request_id and status = 'pending';
  if not found then
    select id into tid from tenants where slug = (select slug from signup_requests where id = pay.signup_request_id);
    return tid;
  end if;

  insert into tenants (name, slug, niche, status, monthly_fee, onboarding_path)
  values (req.business_name, req.slug, coalesce(req.niche, 'general'), 'active', pay.amount, coalesce(req.onboarding_path, 'full'))
  returning id into tid;

  insert into tenant_settings (tenant_id, features) values (tid, req.features);

  insert into records (id, tenant_id, kind, data)
  values ('settings', tid, 'settings', jsonb_build_object('name', req.business_name));

  insert into profiles (id, tenant_id, email, role)
  values (req.user_id, tid, (select email from auth_users where id = req.user_id), 'owner');

  update signup_requests set status = 'approved' where id = pay.signup_request_id;

  return tid;
end;
$$;

-- my_dashboard (db/121) gains onboarding_path so account.html/ac5.js can
-- gate the trimmed basic dashboard server-side, not on a client-side guess.
create or replace function my_dashboard()
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
        'plan', t.plan, 'status', t.status, 'monthly_fee', t.monthly_fee, 'renewal_date', t.renewal_date,
        'onboarding_path', t.onboarding_path
      ),
      'features', coalesce(ts.features, '{}'::jsonb),
      'enabled_features', coalesce(ts.enabled_features, '{}'::jsonb),
      'my_role', (me()->>'role'),
      'my_email', (select email from auth_users where id = app_uid()),
      'my_recovery_email', (select recovery_email from auth_users where id = app_uid()),
      'my_recovery_email_verified', (select recovery_email_verified_at is not null from auth_users where id = app_uid())
    )
    from tenants t
    left join tenant_settings ts on ts.tenant_id = t.id
    where t.id = tid
  );
end $$;

-- ---------- Path B: storefront platform trial, provisioned against the REAL sfx_stores table ----------
-- Self-serve provisioning: no admin approval, access starts immediately. Guard mirrors
-- submit_signup_request's own shape (one login, one business at a time) -- a person who already owns a
-- tenant cannot start a second one. sfx_stores (db/372_storefront_platform.sql) already defaults
-- trial_started_at = now(), trial_ends_at = now() + interval '3 days', plan_status = 'trial' -- a plain
-- insert of just the tenant_id is the whole trial-provisioning step; nothing here duplicates those columns.
create function start_storefront_trial(p_business_name text, p_slug text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; st sfx_stores%rowtype;
begin
  if app_uid() is null then
    raise exception 'authentication required';
  end if;
  if exists (select 1 from profiles where id = app_uid()) then
    raise exception 'you already have a business on your account';
  end if;
  if p_business_name is null or length(trim(p_business_name)) = 0 then
    raise exception 'a business name is required';
  end if;
  if p_slug is null or length(trim(p_slug)) = 0 then
    raise exception 'a subdomain is required';
  end if;

  insert into tenants (name, slug, niche, status, onboarding_path)
  values (p_business_name, lower(p_slug), 'general', 'active', 'storefront')
  returning id into tid;

  insert into tenant_settings (tenant_id, features) values (tid, '{"storefront": true}'::jsonb);

  insert into records (id, tenant_id, kind, data)
  values ('settings', tid, 'settings', jsonb_build_object('name', p_business_name));

  insert into profiles (id, tenant_id, email, role)
  values (app_uid(), tid, (select email from auth_users where id = app_uid()), 'owner');

  update auth_users set app_metadata = app_metadata || jsonb_build_object('tenant_id', tid, 'role', 'owner')
    where id = app_uid();

  -- The real sfx_stores row -- ready to use immediately: add a product, publish, take orders.
  insert into sfx_stores (tenant_id) values (tid) returning * into st;

  return jsonb_build_object('tenant_id', tid, 'slug', lower(p_slug), 'trial_ends_at', st.trial_ends_at, 'plan_status', st.plan_status);
end;
$$;

-- Persisting lazy expiry on top of sfx_guard's own in-memory check: the SAME "flips state when someone
-- next opens the app" convention this codebase already uses for Payroll/Accounting demo resets (see
-- acc_reset_demo/pay_reset_demo and CLAUDE.md's own description of that pattern) -- there is no new
-- background job system here. db/372_storefront_platform.sql's sfx_guard already REFUSES a write once a
-- trial has lapsed (checked live against trial_ends_at); this adds persisting that fact to the row itself
-- the first time it's noticed, so "paused the moment the trial ends" is also true in the stored data, not
-- only in the live check -- callers that read sfx_stores directly (sfx_status below, admin tooling, the
-- Playwright/psql tests) see 'paused' too, not just a sfx_guard exception.
create or replace function sfx_guard(k text default 'sfx_view') returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid; plan_status_ text; trial_ends_ timestamptz;
begin
  tid := sfx_tenant();
  select plan_status, trial_ends_at into plan_status_, trial_ends_ from sfx_stores where tenant_id = tid;
  if coalesce(plan_status_, 'trial') = 'trial' and trial_ends_ is not null and trial_ends_ < now() then
    update sfx_stores set plan_status = 'paused', updated_at = now() where tenant_id = tid and plan_status = 'trial';
    plan_status_ := 'paused';
  end if;
  if plan_status_ in ('paused', 'cancelled') then
    if k = 'sfx_manage' then
      raise exception 'Your storefront trial has ended. Add a payment method to keep editing and selling.' using errcode = 'SF010';
    end if;
  end if;
  if k is not null and not sfx_perm(k) then raise exception 'Your role does not allow this (%)', k using errcode = '42501'; end if;
  return tid;
end $$;

-- Read-only trial/plan status for the owner hub (a plain reachable status call -- sfx_context already
-- returns store/perm/counts info but not the raw trial dates; kept separate so a page can poll just this
-- without re-reading the whole context). Uses sfx_guard(null) -- a read, never refused, same as sfx_context.
create function sfx_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard(null); st sfx_stores%rowtype;
begin
  select * into st from sfx_stores where tenant_id = tid;
  return jsonb_build_object(
    'plan_status', st.plan_status, 'trial_started_at', st.trial_started_at, 'trial_ends_at', st.trial_ends_at,
    'blocked', st.plan_status in ('paused', 'cancelled')
  );
end;
$$;

-- ---------- Path A -> Path B upgrade, AND the manual fallback way a paused/trial storefront is
-- reactivated when the storefront plan has no real price set yet (see db/374_storefront_plan_pricing.sql
-- for the priced, Razorpay-backed path -- this one stays as the "dormant until configured" secondary
-- path, exactly like every other product in this codebase before its first real price is set): reusing
-- the existing addon_requests request/admin-approval pattern (db/027). A basic-lane owner submits
-- submit_addon_request({"storefront": true}, ...) exactly like any other add-on; approving it here also
-- flips their tenant onto the storefront lane and gives them a real sfx_stores row.
create function request_storefront_reactivation(p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid; tname text; tslug text; rid uuid;
begin
  if (me()->>'role') is distinct from 'owner' then
    raise exception 'owner only';
  end if;
  tid := (me()->>'tenant_id')::uuid;
  if not exists (select 1 from sfx_stores where tenant_id = tid) then
    raise exception 'this account has no storefront';
  end if;
  select name, slug into tname, tslug from tenants where id = tid;
  insert into addon_requests (tenant_id, tenant_name, tenant_slug, user_id, features, notes)
  values (tid, tname, tslug, app_uid(), '{"storefront": true}'::jsonb, nullif(p_notes, ''))
  returning id into rid;
  return rid;
end;
$$;

create or replace function approve_addon_request(p_request_id uuid)
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

  if coalesce((req.features->>'storefront')::boolean, false) then
    update tenants set onboarding_path = 'storefront' where id = req.tenant_id;
    insert into sfx_stores (tenant_id, plan_status) values (req.tenant_id, 'active')
    on conflict (tenant_id) do update set plan_status = 'active', updated_at = now();
  end if;

  insert into notifications (tenant_id, type, title, body)
  values (req.tenant_id, 'addon_approved', 'New service added to your account',
    'Refresh your account page -- ' || (select string_agg(k, ', ') from jsonb_object_keys(req.features) k) || ' is now live on your subscription.');
end;
$$;
