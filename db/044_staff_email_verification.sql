-- =========================================================
-- Bug report: invite_staff (013/023) accepts any string as an email
-- with zero verification that it's real or reachable -- an owner can
-- (accidentally or not) create a working staff login on a typo'd or
-- entirely fake address. Separately, login itself (server/src/auth.js)
-- is global and never checks which tenant subdomain it's being used
-- from (see app/public/index.html's boot() for the other half of that
-- fix) -- together these made it easy to end up with staff logins
-- nobody could actually be reached at.
--
-- Adds a real verification step: a freshly-invited staff member's
-- login is created as before (so the owner still gets a temp
-- password to share immediately, same handoff as every other
-- "new login" path here), but can't sign in until they click a
-- one-time link emailed to the address the owner typed in. Existing
-- accounts (owners, already-invited staff, demo logins) are
-- unaffected -- email_verified defaults to true for everyone already
-- in the system, this only gates brand-new invites going forward.
-- =========================================================

alter table profiles add column if not exists email_verified boolean not null default true;

-- on_signup (013) already reads several optional app_metadata keys
-- (role_id/name/phone) for invite_staff's benefit -- extend it the
-- same way rather than adding a second insert path. Self-signup and
-- admin-provisioned owners never set this key, so they keep the
-- column's own default (true).
create or replace function on_signup() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.app_metadata ? 'tenant_id' then
    insert into profiles (id, tenant_id, email, role, role_id, name, phone, email_verified)
    values (
      new.id,
      (new.app_metadata->>'tenant_id')::uuid,
      new.email,
      coalesce(new.app_metadata->>'role', 'cashier'),
      nullif(new.app_metadata->>'role_id', '')::uuid,
      new.app_metadata->>'name',
      new.app_metadata->>'phone',
      coalesce((new.app_metadata->>'email_verified')::boolean, true)
    );
  end if;
  return new;
end $$;

-- One-time verification links. Only ever touched by the two
-- SECURITY DEFINER functions below -- RLS enabled with no policies
-- at all, so nothing can read/write it directly even with a valid
-- session (unlike signup_requests etc., no legitimate caller ever
-- needs a direct row here, only through confirm_staff_email's token
-- lookup or invite_staff's insert).
create table staff_invites (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references profiles(id) on delete cascade,
  token       text unique not null default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  expires_at  timestamptz not null default now() + interval '7 days',
  created_at  timestamptz not null default now()
);
alter table staff_invites enable row level security;

create or replace function invite_staff(p_email text, p_name text, p_phone text, p_role_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  tid uuid; role_name text; new_uid uuid; new_password text; demo boolean; invite_token text;
begin
  if (me()->>'role') is distinct from 'owner' then
    raise exception 'owner only';
  end if;
  tid := (me()->>'tenant_id')::uuid;

  select is_demo into demo from tenants where id = tid;
  if demo then
    raise exception 'not available on a demo account';
  end if;

  select name into role_name from roles where id = p_role_id and tenant_id = tid;
  if role_name is null then
    raise exception 'unknown role';
  end if;

  new_password := replace(gen_random_uuid()::text, '-', '') || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);

  insert into auth_users (email, password_hash, app_metadata)
  values (
    p_email,
    crypt(new_password, gen_salt('bf', 12)),
    jsonb_build_object('tenant_id', tid, 'role', role_name, 'role_id', p_role_id, 'name', p_name, 'phone', p_phone, 'email_verified', false)
  )
  returning id into new_uid;

  insert into staff_invites (profile_id) values (new_uid) returning token into invite_token;

  return jsonb_build_object('id', new_uid, 'email', p_email, 'temp_password', new_password, 'verify_token', invite_token);
end $$;

-- Public (no auth) -- the whole point is a staff member who hasn't
-- signed in yet clicking a link from their inbox. A token is a
-- 64-char random secret, same trust model as a password-reset link
-- everywhere else uses -- no rate limit needed the way /auth/login
-- has one, since guessing a valid token is infeasible.
create function confirm_staff_email(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare inv staff_invites%rowtype;
begin
  select * into inv from staff_invites where token = p_token;
  if not found then
    raise exception 'This verification link is invalid or has already been used.';
  end if;
  if inv.expires_at < now() then
    delete from staff_invites where id = inv.id;
    raise exception 'This verification link has expired -- ask your manager to resend it.';
  end if;

  update profiles set email_verified = true where id = inv.profile_id;
  delete from staff_invites where id = inv.id;
  return jsonb_build_object('ok', true);
end $$;
