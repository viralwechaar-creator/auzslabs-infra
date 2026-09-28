-- =========================================================
-- The self-serve signup form only ever asked for a business name
-- and a desired subdomain -- nothing about WHO is asking or WHAT
-- kind of business it is, which is exactly what an admin needs to
-- review a request and reach out. Adds those fields to
-- signup_requests and to submit_signup_request's parameter list.
--
-- Existing 4-arg submit_signup_request is dropped and replaced by an
-- 8-arg version (not just CREATE OR REPLACE) because adding
-- parameters changes the function's identity in Postgres -- without
-- the drop, both overloads would exist side by side.
-- =========================================================

alter table signup_requests add column if not exists contact_name text;
alter table signup_requests add column if not exists phone text;
alter table signup_requests add column if not exists niche text;
alter table signup_requests add column if not exists address text;

drop function if exists submit_signup_request(text, text, jsonb, text);

create function submit_signup_request(
  p_business_name text, p_slug text, p_features jsonb, p_notes text,
  p_contact_name text default null, p_phone text default null,
  p_niche text default null, p_address text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  rid uuid;
begin
  if app_uid() is null then
    raise exception 'authentication required';
  end if;
  insert into signup_requests (user_id, business_name, slug, features, notes, contact_name, phone, niche, address)
  values (
    app_uid(), p_business_name, lower(p_slug), coalesce(p_features, '{}'::jsonb), nullif(p_notes, ''),
    nullif(p_contact_name, ''), nullif(p_phone, ''), nullif(p_niche, ''), nullif(p_address, '')
  )
  returning id into rid;
  return rid;
end;
$$;
