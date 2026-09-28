-- =========================================================
-- Customer feedback: a star rating + optional comment collected on
-- the public invoice page (i.html) after a bill is paid. Same trust
-- shape as place_order()/public_invoice() -- the caller is anonymous
-- (no login), so the token alone (already globally unguessable, see
-- public_invoice's own comment in 002_core_engine.sql) determines the
-- tenant; nothing the client sends is trusted for that. The insert
-- happens inside this SECURITY DEFINER function, so it bypasses the
-- records RLS kind allow-list the same way place_order's insert into
-- guest_orders does -- no new kind needs adding to that allow-list for
-- the *staff* side, since staff only ever READ feedback rows (already
-- unrestricted for any authenticated tenant staffer) and never write
-- them directly.
--
-- id is deterministic from the order token ('fb-<tok>'), so a customer
-- who submits twice (e.g. changes their mind about the rating) updates
-- their one feedback row instead of creating duplicates.
-- =========================================================

create function submit_feedback(oid text, rating int, comment text) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid; ono text;
begin
  -- rating is null-unsafe in plpgsql's `if` (NULL is treated as false, not
  -- true) -- this function is auth:false (server/src/index.js), reachable
  -- directly by anyone, not only through i.html's star widget which
  -- always sets a rating first -- so a bare NULL must be caught explicitly.
  if rating is null or rating < 1 or rating > 5 then raise exception 'rating must be between 1 and 5'; end if;
  if length(coalesce(comment, '')) > 1000 then raise exception 'comment too long'; end if;

  -- Identical lookup to public_invoice (002_core_engine.sql): excludes
  -- soft-deleted rows and, on a token collision, prefers the most
  -- recently paid match. Deliberately NOT filtering out status='void'
  -- here either -- voiding an order doesn't set deleted=true, only its
  -- own status field, and public_invoice itself still resolves a voided
  -- order's token the same way. Feedback attachment stays consistent
  -- with whatever the customer's invoice link actually shows, rather
  -- than silently diverging from it.
  select r.tenant_id, r.data->>'no' into tid, ono
    from records r where r.kind = 'order' and not r.deleted and r.data->>'tok' = oid
    order by (r.data->>'paidAt') desc nulls last limit 1;
  if tid is null then raise exception 'order not found'; end if;

  insert into records (id, tenant_id, kind, data)
  values ('fb-' || oid, tid, 'feedback', jsonb_build_object(
    'orderTok', oid, 'orderNo', ono, 'rating', rating, 'comment', left(coalesce(comment, ''), 1000), 'at', now()
  ))
  on conflict (tenant_id, id) do update set data = excluded.data, updated_at = now();
end $$;
-- callable by anyone -- see note above, same as place_order/public_invoice.
