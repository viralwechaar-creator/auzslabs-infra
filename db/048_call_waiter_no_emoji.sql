-- =========================================================
-- Part of replacing emoji-as-UI with real line icons across the POS
-- (index.html). call_waiter() (db/045) used the literal string
-- '🔔 Waiter called' as both its dedupe marker (matched against
-- guest_orders.note to stop the same table spamming repeat calls
-- within 10 minutes) and the text rendered in the staff-side guest
-- inbox (guestBar() in index.html), so the emoji was baked into
-- stored data, not just a rendering choice -- fixing the display
-- without also fixing this function would leave the emoji in the
-- marker string even though nothing shows it directly anymore.
-- Switches the marker to plain text; guestBar() now recognises this
-- exact string and prefixes it with a bell icon instead of relying on
-- an emoji character living inside the stored note.
-- =========================================================

create or replace function call_waiter(tenant_slug text, t text) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid; cnt int;
begin
  select id into tid from tenants where slug = tenant_slug;
  if tid is null then raise exception 'unknown tenant'; end if;

  select count(*) into cnt from guest_orders
    where tenant_id = tid and tbl = t and note = 'Waiter called' and status = 'new' and created_at > now() - interval '10 minutes';
  if cnt >= 1 then
    raise exception 'A waiter has already been called for this table -- they''re on the way.';
  end if;

  insert into guest_orders (tenant_id, tbl, name, phone, note, items)
  values (tid, t, 'Table ' || t, '', 'Waiter called', '[]'::jsonb);
end;
$$;
