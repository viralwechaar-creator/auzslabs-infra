-- AUZsPOS QR ("self_order") is an add-on to AUZsPOS ("pos"), never a standalone product --
-- the owner's own pricing (db/072: "AUZsPOS QR's 1,299 = pos 999 + self_order 300") already says
-- so, and every niche preset only ever turns self_order on together with pos. The storefront
-- (site/site.js's AUZcart.add, this same session) now keeps the two paired in the cart -- this
-- migration closes the same gap one layer deeper: submit_signup_request/submit_addon_request
-- themselves refuse a request that asks for self_order without pos (already owned, for an addon
-- request; included in the same request, for a brand-new signup), so a request can never reach
-- an admin -- or the automatic Razorpay-pay-and-activate path -- in that broken shape, no matter
-- what submitted the request.

create or replace function submit_signup_request(
  p_business_name text, p_slug text, p_features jsonb, p_notes text,
  p_contact_name text default null, p_phone text default null,
  p_niche text default null, p_address text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  rid uuid;
  feats jsonb := coalesce(p_features, '{}'::jsonb);
begin
  if app_uid() is null then
    raise exception 'authentication required';
  end if;
  if coalesce((feats->>'self_order')::boolean, false) and not coalesce((feats->>'pos')::boolean, false) then
    raise exception 'AUZsPOS QR is an add-on to AUZsPOS -- add AUZsPOS to this request too.';
  end if;
  insert into signup_requests (user_id, business_name, slug, features, notes, contact_name, phone, niche, address)
  values (
    app_uid(), p_business_name, lower(p_slug), feats, nullif(p_notes, ''),
    nullif(p_contact_name, ''), nullif(p_phone, ''), nullif(p_niche, ''), nullif(p_address, '')
  )
  returning id into rid;
  return rid;
end;
$$;

create or replace function submit_addon_request(p_features jsonb, p_notes text)
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

  if coalesce((requested->>'self_order')::boolean, false)
     and not coalesce((entitled->>'pos')::boolean, false)
     and not coalesce((requested->>'pos')::boolean, false) then
    raise exception 'AUZsPOS QR is an add-on to AUZsPOS -- add AUZsPOS to this request too.';
  end if;

  insert into addon_requests (tenant_id, tenant_name, tenant_slug, user_id, features, notes)
  values (tid, tname, tslug, app_uid(), requested, nullif(p_notes, ''))
  returning id into rid;
  return rid;
end;
$$;
