-- =========================================================
-- Shifting an existing client (Showoff Salon, previously its own
-- one-off Vercel + Blob-storage site) onto AUZslab as the first real
-- 'salon' niche tenant. niche_presets already had a 'salon' row
-- (db/001) with booking:true, and `bookings` (db/003) already has
-- exactly the shape a salon appointment needs -- but nothing
-- customer-facing has ever called it. This adds the public RPCs a
-- salon's own booking page (app/public/booking.html) needs, same
-- SECURITY DEFINER pattern as public_menu/place_order/public_invoice
-- (db/002): callable by anyone, since a visitor booking an
-- appointment has no session, with the tenant resolved from the
-- slug in the URL rather than trusted client input.
--
-- Deliberately no new "resource" (stylist) assignment yet -- v1 slot
-- capacity is one flat "how many bookings can share the same time
-- slot" number per tenant (kind='settings' -> bookingSlotCapacity,
-- default 1), not per-stylist. Real per-stylist scheduling is a
-- kind='resource' record (already reserved for this in db/003's own
-- column comment) for a later pass once there's a real multi-stylist
-- client to build it against.
-- =========================================================

-- Services and the salon's own gallery/booking settings ride the
-- exact same 'item'/'cat'/'settings' records public_menu already
-- reads -- no new columns needed, just a settings-record convention:
--   bookingOpen / bookingClose  (e.g. '10:00' / '19:00')
--   bookingSlotMinutes          (e.g. 30)
--   bookingSlotCapacity         (e.g. 1)
--   gallery                     (jsonb array of image URLs)
--   brand                       (jsonb: {plum,cream,gold,goldD,taupe,tint,line,muted,font,fontUrl,logoLight,logoDark,hero,doodle})
create function public_salon_page(tenant_slug text) returns jsonb language sql security definer stable set search_path = public as $$
  select jsonb_build_object(
    'services', coalesce((select jsonb_agg(r.data) from records r join tenants t on t.id = r.tenant_id where t.slug = tenant_slug and r.kind = 'item' and not r.deleted), '[]'::jsonb),
    'cats',     coalesce((select jsonb_agg(r.data) from records r join tenants t on t.id = r.tenant_id where t.slug = tenant_slug and r.kind = 'cat'  and not r.deleted), '[]'::jsonb),
    'cfg',      coalesce((select r.data from records r join tenants t on t.id = r.tenant_id where t.slug = tenant_slug and r.kind = 'settings' and r.id = 'settings'), '{}'::jsonb)
  )
$$;
-- callable by anyone; anon vs authenticated is enforced by the API server's own routing, matching public_menu.

create function public_salon_slots(tenant_slug text, p_date date) returns jsonb language plpgsql security definer stable set search_path = public as $$
declare tid uuid; cfg jsonb; open_t time; close_t time; step int; cap int; slot time; slots jsonb := '[]'::jsonb; taken int;
begin
  select id into tid from tenants where slug = tenant_slug;
  if tid is null then raise exception 'unknown tenant'; end if;

  select data into cfg from records where tenant_id = tid and kind = 'settings' and id = 'settings';
  open_t  := coalesce((cfg->>'bookingOpen')::time, '10:00'::time);
  close_t := coalesce((cfg->>'bookingClose')::time, '19:00'::time);
  step    := coalesce((cfg->>'bookingSlotMinutes')::int, 30);
  cap     := coalesce((cfg->>'bookingSlotCapacity')::int, 1);

  slot := open_t;
  while slot < close_t loop
    select count(*) into taken from bookings where tenant_id = tid and date = p_date and time = slot and status <> 'cancelled';
    if taken < cap then
      slots := slots || jsonb_build_object('time', to_char(slot, 'HH24:MI'), 'left', cap - taken);
    end if;
    slot := slot + (step || ' minutes')::interval;
  end loop;

  return slots;
end $$;
-- callable by anyone -- see note above. Re-checked server-side at booking
-- time too (below), so this is a display convenience, not the real gate.

create function public_create_booking(tenant_slug text, p_name text, p_phone text, p_email text, p_date date, p_time time, p_service_ids text[]) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; cfg jsonb; cap int; taken int; svc_items jsonb := '[]'::jsonb; svc record; total numeric := 0; bid uuid;
begin
  select id into tid from tenants where slug = tenant_slug;
  if tid is null then raise exception 'unknown tenant'; end if;
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'name is required'; end if;
  if p_phone is null or length(trim(p_phone)) < 6 then raise exception 'a valid phone number is required'; end if;
  if p_service_ids is null or array_length(p_service_ids, 1) is null then raise exception 'pick at least one service'; end if;

  select data into cfg from records where tenant_id = tid and kind = 'settings' and id = 'settings';
  cap := coalesce((cfg->>'bookingSlotCapacity')::int, 1);

  -- re-check capacity server-side (the earlier public_salon_slots call is
  -- just what the page showed -- someone else may have booked the same
  -- slot in the meantime).
  select count(*) into taken from bookings where tenant_id = tid and date = p_date and time = p_time and status <> 'cancelled';
  if taken >= cap then raise exception 'that time just got booked -- please pick another slot'; end if;

  for svc in select r.id, r.data from records r where r.tenant_id = tid and r.kind = 'item' and not r.deleted and r.id = any(p_service_ids) loop
    svc_items := svc_items || jsonb_build_object('id', svc.id, 'name', svc.data->>'name', 'price', (svc.data->>'price')::numeric);
    total := total + coalesce((svc.data->>'price')::numeric, 0);
  end loop;
  if jsonb_array_length(svc_items) = 0 then raise exception 'unknown service selection'; end if;

  insert into bookings (tenant_id, customer_name, customer_phone, date, time, status, items, total)
  values (tid, trim(p_name), trim(p_phone), p_date, p_time, 'pending', svc_items, total)
  returning id into bid;

  -- Same generic-engine convention public_menu's customer profiles use --
  -- upsert a 'customer' record so this person's booking history shows up
  -- in CRM immediately, keyed by the same digits-only phone V.crm groups by.
  insert into records (id, tenant_id, kind, data)
  values (regexp_replace(p_phone, '\D', '', 'g'), tid, 'customer', jsonb_build_object('phone', regexp_replace(p_phone, '\D', '', 'g'), 'name', trim(p_name), 'email', coalesce(p_email, '')))
  on conflict (tenant_id, id) do update set data = records.data || jsonb_build_object('name', trim(p_name));

  return jsonb_build_object('id', bid, 'total', total);
end $$;
-- callable by anyone -- see note above.
