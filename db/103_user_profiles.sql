-- Customer profile: what a signed-in person tells us about themselves and their business (name, phone, address,
-- business type, niche, products wanted, size, timing). It is what we use to treat them as a lead.
-- One row per login. RLS on with no policies: only the functions below read or write it.
create table if not exists user_profiles (
  user_id uuid primary key references auth_users(id) on delete cascade,
  name text, phone text, contact_email text, address text, city text,
  business_name text, business_type text, niche text,
  products jsonb not null default '[]'::jsonb,
  outlets int, staff_count int,
  current_software text, start_when text, notes text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table user_profiles enable row level security;

create or replace function my_profile() returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare uid uuid := app_uid(); r user_profiles; e text;
begin
  if uid is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select * into r from user_profiles where user_id = uid;
  select email into e from auth_users where id = uid;
  return jsonb_build_object('login_email', e, 'profile', case when r.user_id is null then null else to_jsonb(r) - 'user_id' end);
end $$;

create or replace function save_my_profile(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := app_uid(); n int; s int; prods jsonb;
  clean text; 
begin
  if uid is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Please enter your name.'; end if;
  if coalesce(trim(p->>'phone'), '') !~ '^[+0-9 ()-]{8,16}$' then raise exception 'Please enter a valid phone number.'; end if;
  n := nullif(trim(coalesce(p->>'outlets','')), '')::int; s := nullif(trim(coalesce(p->>'staff_count','')), '')::int;
  if n is not null and (n < 0 or n > 10000) then raise exception 'Outlets must be a sensible number.'; end if;
  if s is not null and (s < 0 or s > 100000) then raise exception 'Staff must be a sensible number.'; end if;
  prods := case when jsonb_typeof(p->'products') = 'array' then p->'products' else '[]'::jsonb end;
  insert into user_profiles (user_id, name, phone, contact_email, address, city, business_name, business_type, niche, products, outlets, staff_count, current_software, start_when, notes, updated_at)
  values (uid, left(trim(p->>'name'), 120), left(trim(p->>'phone'), 20), left(trim(coalesce(p->>'contact_email','')), 160), left(trim(coalesce(p->>'address','')), 400), left(trim(coalesce(p->>'city','')), 80),
    left(trim(coalesce(p->>'business_name','')), 120), left(trim(coalesce(p->>'business_type','')), 60), left(trim(coalesce(p->>'niche','')), 60), prods, n, s,
    left(trim(coalesce(p->>'current_software','')), 120), left(trim(coalesce(p->>'start_when','')), 40), left(trim(coalesce(p->>'notes','')), 1000), now())
  on conflict (user_id) do update set name = excluded.name, phone = excluded.phone, contact_email = excluded.contact_email, address = excluded.address, city = excluded.city,
    business_name = excluded.business_name, business_type = excluded.business_type, niche = excluded.niche, products = excluded.products, outlets = excluded.outlets,
    staff_count = excluded.staff_count, current_software = excluded.current_software, start_when = excluded.start_when, notes = excluded.notes, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

-- Platform admin: everyone who has filled in a profile, newest first, with their login email and whether they already own a business.
create or replace function admin_list_profiles(p_limit int default 200) returns jsonb
language plpgsql security definer stable set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return coalesce((select jsonb_agg(x) from (
    select to_jsonb(up) - 'user_id' || jsonb_build_object('login_email', au.email, 'is_client', exists (select 1 from profiles pr where pr.id = up.user_id and pr.tenant_id is not null)) as x
    from user_profiles up join auth_users au on au.id = up.user_id
    order by up.updated_at desc limit greatest(1, least(coalesce(p_limit, 200), 1000))
  ) q), '[]'::jsonb);
end $$;
