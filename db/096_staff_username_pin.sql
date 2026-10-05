-- Staff sign in with a username + PIN (no email needed). The owner adds a staff member, the system makes a username
-- like `ravi.mannat` (name + the company code, so it can never clash with another company) and a random PIN
-- (4 digits; 6 for managers). The username alone tells the app which company and outlet to open. The PIN only has to
-- be unique inside one company (10,000 values cannot be unique worldwide); it is only ever checked WITH the username.
-- Wrong PINs lock the login (see staff_pin_fails, enforced in server/src/auth.js staffLogin).
alter table auth_users add column if not exists username text;
alter table auth_users add column if not exists pin_hash text;
alter table auth_users add column if not exists pin_fp text;
create unique index if not exists auth_users_username_idx on auth_users (lower(username)) where username is not null and deleted_at is null;
create unique index if not exists auth_users_pin_fp_idx on auth_users ((app_metadata->>'tenant_id'), pin_fp) where pin_fp is not null and deleted_at is null;
alter table profiles add column if not exists username text;
alter table profiles add column if not exists outlet_id text;
alter table profiles add column if not exists pin_len int;
alter table profiles add column if not exists login_off boolean not null default false;

create table if not exists staff_pin_fails (
  username     text primary key,
  fails        int not null default 0,
  locked_until timestamptz,
  updated_at   timestamptz not null default now()
);
-- only the API server touches this (raw pool queries at sign-in, before there is any signed-in user)
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'app') then
    grant select, insert, update, delete on staff_pin_fails to app;
  end if;
end $$;

create or replace function staff_new_pin(tid uuid, plen int) returns text language plpgsql volatile security definer set search_path = public as $$
declare pin text; fp text; i int := 0;
begin
  loop
    pin := lpad((abs(('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint) % (10 ^ plen)::bigint)::text, plen, '0');
    fp := encode(digest(tid::text || ':' || pin, 'sha256'), 'hex');
    exit when not exists (select 1 from auth_users where app_metadata->>'tenant_id' = tid::text and pin_fp = fp and deleted_at is null);
    i := i + 1;
    if i > 200 then raise exception 'No free PIN left, remove an old staff login first'; end if;
  end loop;
  return pin;
end $$;

create or replace function staff_create(p_name text, p_phone text default null, p_role_id uuid default null, p_builtin text default null, p_outlet text default null, p_username text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  tid uuid; slug_ text; demo boolean; role_name text; perms jsonb; base text; uname text; n int := 0; plen int := 4; pin text; new_uid uuid;
begin
  if (me()->>'role') is distinct from 'owner' then raise exception 'owner only'; end if;
  tid := (me()->>'tenant_id')::uuid;
  select slug, is_demo into slug_, demo from tenants where id = tid;
  if demo then raise exception 'not available on a demo account'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'Enter the staff member''s name'; end if;

  if p_role_id is not null then
    select name, permissions into role_name, perms from roles where id = p_role_id and tenant_id = tid;
    if role_name is null then raise exception 'unknown role'; end if;
    if coalesce((perms->>'settings')::boolean, false) or coalesce((perms->>'mob_manage')::boolean, false) then plen := 6; end if;
  else
    role_name := case when p_builtin = 'manager' then 'manager' else 'cashier' end;
    if role_name = 'manager' then plen := 6; end if;
  end if;

  base := left(lower(regexp_replace(coalesce(nullif(btrim(p_username), ''), split_part(btrim(p_name), ' ', 1)), '[^a-zA-Z0-9]', '', 'g')), 20);
  if base = '' then raise exception 'Use letters or numbers in the username'; end if;
  uname := base || '.' || slug_;
  while exists (select 1 from auth_users where lower(username) = uname and deleted_at is null) loop
    n := n + 1; uname := base || n || '.' || slug_;
  end loop;

  pin := staff_new_pin(tid, plen);
  insert into auth_users (email, password_hash, username, pin_hash, pin_fp, app_metadata)
  values (
    uname || '@staff.auzslab.in', null, uname, crypt(pin, gen_salt('bf', 10)), encode(digest(tid::text || ':' || pin, 'sha256'), 'hex'),
    jsonb_build_object('tenant_id', tid, 'role', role_name, 'role_id', p_role_id, 'name', btrim(p_name), 'phone', p_phone, 'email_verified', true, 'outlet', nullif(p_outlet, ''))
  ) returning id into new_uid;
  update profiles set username = uname, outlet_id = nullif(p_outlet, ''), pin_len = plen where id = new_uid;
  return jsonb_build_object('id', new_uid, 'username', uname, 'pin', pin, 'pin_len', plen);
end $$;

-- the owner sets (or generates) a new PIN; also clears any lockout
create or replace function staff_reset_pin(p_staff_id uuid, p_pin text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; prof profiles%rowtype; au auth_users%rowtype; plen int; pin text;
begin
  if (me()->>'role') is distinct from 'owner' then raise exception 'owner only'; end if;
  tid := (me()->>'tenant_id')::uuid;
  select * into prof from profiles where id = p_staff_id and tenant_id = tid;
  if prof.id is null then raise exception 'staff member not found'; end if;
  if prof.role = 'owner' then raise exception 'the owner signs in with email'; end if;
  select * into au from auth_users where id = p_staff_id and username is not null and deleted_at is null;
  if au.id is null then raise exception 'this staff member signs in with email, not a PIN'; end if;
  plen := coalesce(prof.pin_len, 4);
  if p_pin is null or btrim(p_pin) = '' then
    pin := staff_new_pin(tid, plen);
  else
    pin := btrim(p_pin);
    if pin !~ '^\d+$' or length(pin) <> plen then raise exception 'The PIN must be exactly % digits', plen; end if;
    if exists (select 1 from auth_users where app_metadata->>'tenant_id' = tid::text and pin_fp = encode(digest(tid::text || ':' || pin, 'sha256'), 'hex') and deleted_at is null and id <> p_staff_id) then
      raise exception 'Another staff member already uses that PIN, pick a different one';
    end if;
  end if;
  update auth_users set pin_hash = crypt(pin, gen_salt('bf', 10)), pin_fp = encode(digest(tid::text || ':' || pin, 'sha256'), 'hex') where id = p_staff_id;
  delete from staff_pin_fails where username = lower(au.username);
  return jsonb_build_object('username', au.username, 'pin', pin, 'pin_len', plen);
end $$;

-- turn a staff login off / on without deleting their history
create or replace function staff_set_active(p_staff_id uuid, p_active boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; prof profiles%rowtype;
begin
  if (me()->>'role') is distinct from 'owner' then raise exception 'owner only'; end if;
  tid := (me()->>'tenant_id')::uuid;
  select * into prof from profiles where id = p_staff_id and tenant_id = tid;
  if prof.id is null then raise exception 'staff member not found'; end if;
  if prof.role = 'owner' then raise exception 'cannot turn off the owner'; end if;
  update auth_users set disabled_at = case when p_active then null else now() end where id = p_staff_id;
  update profiles set login_off = not p_active where id = p_staff_id;
  return jsonb_build_object('ok', true, 'active', p_active);
end $$;

create or replace function staff_set_outlet(p_staff_id uuid, p_outlet text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  if (me()->>'role') is distinct from 'owner' then raise exception 'owner only'; end if;
  tid := (me()->>'tenant_id')::uuid;
  update profiles set outlet_id = nullif(p_outlet, '') where id = p_staff_id and tenant_id = tid and role <> 'owner';
  update auth_users set app_metadata = jsonb_set(app_metadata, '{outlet}', coalesce(to_jsonb(nullif(p_outlet, '')), 'null'::jsonb)) where id = p_staff_id and app_metadata->>'tenant_id' = tid::text;
  return jsonb_build_object('ok', true);
end $$;
