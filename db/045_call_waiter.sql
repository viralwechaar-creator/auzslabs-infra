-- =========================================================
-- Part of the QR-ordering customization ask: customers should be able
-- to flag a waiter down from the table QR page without placing an
-- order. Deliberately reuses guest_orders (the exact channel staff
-- already watch via getG()/guestBar() in index.html for QR self-orders)
-- with an empty items array and a fixed marker note, instead of a new
-- table + a new staff-side view -- getG()/guestBar() already render an
-- empty items array as just "table + name + note", so the POS needs
-- ZERO changes to show this. Deliberately independent of the
-- self_order feature flag (a table can flag staff down even when
-- online ordering itself is turned off / counter-only mode).
-- =========================================================

create function call_waiter(tenant_slug text, t text) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid; cnt int;
begin
  select id into tid from tenants where slug = tenant_slug;
  if tid is null then raise exception 'unknown tenant'; end if;

  select count(*) into cnt from guest_orders
    where tenant_id = tid and tbl = t and note = '🔔 Waiter called' and status = 'new' and created_at > now() - interval '10 minutes';
  if cnt >= 1 then
    raise exception 'A waiter has already been called for this table -- they''re on the way.';
  end if;

  insert into guest_orders (tenant_id, tbl, name, phone, note, items)
  values (tid, t, 'Table ' || t, '', '🔔 Waiter called', '[]'::jsonb);
end;
$$;
