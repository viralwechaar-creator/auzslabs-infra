-- Owner request: separate the customer journey into clear steps -- create an account and save a
-- profile FIRST, then explore and pick products, then review/add notes, then pay, each its own
-- screen, never profile-filling and paying on the same page. The profile (db/103) already covers
-- everything submit_signup_request needs except the desired subdomain -- add that one field so the
-- whole "about you / about your business" form on the cart page can be retired in favour of the
-- profile already saved in step 1 (site/account.html).

alter table user_profiles add column if not exists biz_slug text;

create or replace function save_my_profile(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare uid uuid := app_uid(); n int; s int; prods jsonb; slug text;
begin
  if uid is null then raise exception 'authentication required' using errcode = '28000'; end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Please enter your name.'; end if;
  if coalesce(trim(p->>'phone'), '') !~ '^[+0-9 ()-]{8,16}$' then raise exception 'Please enter a valid phone number.'; end if;
  n := nullif(trim(coalesce(p->>'outlets','')), '')::int; s := nullif(trim(coalesce(p->>'staff_count','')), '')::int;
  if n is not null and (n < 0 or n > 10000) then raise exception 'Outlets must be a sensible number.'; end if;
  if s is not null and (s < 0 or s > 100000) then raise exception 'Staff must be a sensible number.'; end if;
  slug := lower(regexp_replace(trim(coalesce(p->>'biz_slug','')), '[^a-z0-9-]', '', 'gi'));
  if slug <> '' and length(slug) < 3 then raise exception 'Desired subdomain must be at least 3 characters.'; end if;
  prods := case when jsonb_typeof(p->'products') = 'array' then p->'products' else '[]'::jsonb end;
  insert into user_profiles (user_id, name, phone, contact_email, address, city, business_name, business_type, niche, biz_slug, products, outlets, staff_count, current_software, start_when, notes, updated_at)
  values (uid, left(trim(p->>'name'), 120), left(trim(p->>'phone'), 20), left(trim(coalesce(p->>'contact_email','')), 160), left(trim(coalesce(p->>'address','')), 400), left(trim(coalesce(p->>'city','')), 80),
    left(trim(coalesce(p->>'business_name','')), 120), left(trim(coalesce(p->>'business_type','')), 60), left(trim(coalesce(p->>'niche','')), 60), nullif(left(slug, 40), ''), prods, n, s,
    left(trim(coalesce(p->>'current_software','')), 120), left(trim(coalesce(p->>'start_when','')), 40), left(trim(coalesce(p->>'notes','')), 1000), now())
  on conflict (user_id) do update set name = excluded.name, phone = excluded.phone, contact_email = excluded.contact_email, address = excluded.address, city = excluded.city,
    business_name = excluded.business_name, business_type = excluded.business_type, niche = excluded.niche, biz_slug = excluded.biz_slug, products = excluded.products, outlets = excluded.outlets,
    staff_count = excluded.staff_count, current_software = excluded.current_software, start_when = excluded.start_when, notes = excluded.notes, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;
