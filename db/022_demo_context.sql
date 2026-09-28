-- =========================================================
-- Demo page (site/demo.html): when the AUZlabs team marks a lead or
-- approves a cart signup_request, they can hand the prospect a link
-- like demo.html?req=<signup_requests.id> (or ?lead=<leads.id>) that
-- walks them through exactly the modules they're getting, tailored to
-- their niche and (for a signup_request) the features they actually
-- picked in the cart.
--
-- That page has no login of its own -- a prospect clicking a link
-- before they even have an account -- so it needs a public,
-- SECURITY DEFINER read, same pattern as public_menu()/public_invoice().
-- Deliberately returns only the safe subset a demo needs (business
-- name, niche, chosen features): never contact/phone/notes/message,
-- since this id is going into a link that might get forwarded around
-- before the prospect is even a real tenant.
-- =========================================================

-- A stale/removed/mistyped id is an expected, routine case for a link
-- that gets forwarded around before the prospect is even a real tenant
-- -- same as public_menu()/public_invoice() above, this returns null
-- rather than raising, so it never surfaces as a logged server error
-- for something demo.html's own showError() already handles cleanly.
create function demo_context(p_kind text, p_id uuid)
returns jsonb language plpgsql security definer stable set search_path = public as $$
begin
  if p_kind = 'req' then
    return (
      select jsonb_build_object('business_name', business_name, 'niche', coalesce(niche, 'general'), 'features', features)
      from signup_requests where id = p_id
    );
  elsif p_kind = 'lead' then
    return (
      select jsonb_build_object('business_name', coalesce(business, name), 'niche', coalesce(niche, 'general'), 'features', '{}'::jsonb)
      from leads where id = p_id
    );
  else
    return null;
  end if;
end;
$$;
