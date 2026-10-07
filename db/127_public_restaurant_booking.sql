-- A customer-facing table reservation (any restaurant/cafe tenant, not just salon) used to be
-- faked through the guest-order inbox: Chapter One's reservation form (app/public/chapterone/app.js)
-- called place_order() with no items and the date/time/guests stuffed into a note. That DOES land
-- in the POS's guest-order inbox (the realtime subscription on guest_orders fires, so staff see the
-- "notification"), but it was never a real bookings row -- so it could never show up in the actual
-- Reservations screen (pos/reserve.js reads sb.from('bookings'), never guest_orders). Accepting that
-- "waiter call" just dismissed it; there was no way to see it again as an upcoming reservation.
--
-- This is the real thing: a generic public RPC, same SECURITY DEFINER / tenant-from-slug pattern as
-- place_order/public_menu/public_create_booking (salon), but for the plain restaurant/cafe bookings
-- shape db/068 already extended (party_size, note, source, outlet) -- no services, no slot picker,
-- just a request the staff confirms and assigns a table to, same as "New reservation" in the POS.
create or replace function public_create_reservation(
  tenant_slug text, p_name text, p_phone text, p_date date, p_time time, p_party_size int, p_note text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; bid uuid;
begin
  select id into tid from tenants where slug = tenant_slug;
  if tid is null then raise exception 'unknown tenant'; end if;
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'name is required'; end if;
  if p_phone is null or length(trim(p_phone)) < 6 then raise exception 'a valid phone number is required'; end if;
  if p_date is null or p_time is null then raise exception 'a date and time are required'; end if;

  insert into bookings (tenant_id, customer_name, customer_phone, date, time, end_time, status, party_size, note, source, items, total)
  values (tid, trim(p_name), trim(p_phone), p_date, p_time, p_time + interval '90 minutes', 'pending',
          greatest(coalesce(p_party_size, 1), 1), nullif(trim(coalesce(p_note, '')), ''), 'Website', '[]', 0)
  returning id into bid;

  -- same CRM-upsert convention public_create_booking (salon) already uses, so a reservation shows
  -- up against this customer's profile immediately, keyed the same way V.crm groups by.
  insert into records (id, tenant_id, kind, data)
  values (regexp_replace(p_phone, '\D', '', 'g'), tid, 'customer', jsonb_build_object('phone', regexp_replace(p_phone, '\D', '', 'g'), 'name', trim(p_name)))
  on conflict (tenant_id, id) do update set data = records.data || jsonb_build_object('name', trim(p_name));

  return jsonb_build_object('id', bid);
end $$;
-- callable by anyone -- a visitor booking a table has no session, same as place_order/call_waiter.
