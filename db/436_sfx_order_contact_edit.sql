-- Order page: correct the customer's contact details or shipping address on one order (from the Shopify reference).
--  * Contact (name, phone, email) can change on any open order; the address only while nothing has shipped.
--  * "Update the customer profile too" is a separate choice, so a fix to one order is not a permanent change by accident.
--  * Removing the customer unlinks the order from the customer record. The customer is not deleted and the order keeps its contact snapshot.
--  * Tax and shipping are NOT recalculated when the address changes (said on screen).
-- Rollback: drop function sfx_order_contact_set(uuid, jsonb); drop function sfx_order_unlink_customer(uuid).
create function sfx_order_contact_set(p_order uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_require('sfx_orders'); o sfx_orders; c jsonb; ph text; em text; nm text; addr boolean := (p ? 'address' or p ? 'city' or p ? 'state' or p ? 'pin'); v_note text := '';
begin
  select * into o from sfx_orders where id = p_order and tenant_id = tid for update;
  if not found then raise exception 'Order not found' using errcode = 'SF003'; end if;
  if o.status = 'cancelled' then raise exception 'A cancelled order cannot be edited' using errcode = 'SF002'; end if;
  if addr and o.fulfilment_status <> 'unfulfilled' then raise exception 'The address cannot change once items have shipped' using errcode = 'SF002'; end if;
  c := coalesce(o.customer, '{}'::jsonb);
  if p ? 'name' then nm := left(trim(coalesce(p->>'name', '')), 120); if nm = '' then raise exception 'Enter a name' using errcode = 'SF002'; end if; c := c || jsonb_build_object('name', nm); v_note := v_note || ' name'; end if;
  if p ? 'phone' then ph := regexp_replace(coalesce(p->>'phone', ''), '[^0-9+]', '', 'g'); if ph <> '' and length(regexp_replace(ph, '\D', '', 'g')) not between 8 and 15 then raise exception 'Enter a valid phone number' using errcode = 'SF002'; end if; c := c || jsonb_build_object('phone', ph); v_note := v_note || ' phone'; end if;
  if p ? 'email' then em := lower(trim(coalesce(p->>'email', ''))); if em <> '' and em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address' using errcode = 'SF002'; end if; c := c || jsonb_build_object('email', em); v_note := v_note || ' email'; end if;
  if p ? 'address' then c := c || jsonb_build_object('address', left(trim(coalesce(p->>'address', '')), 300)); v_note := v_note || ' address'; end if;
  if p ? 'city' then c := c || jsonb_build_object('city', left(trim(coalesce(p->>'city', '')), 80)); end if;
  if p ? 'state' then c := c || jsonb_build_object('state', left(trim(coalesce(p->>'state', '')), 80)); end if;
  if p ? 'pin' then c := c || jsonb_build_object('pin', left(trim(coalesce(p->>'pin', '')), 12)); end if;
  update sfx_orders set customer = c, timeline = sfx_order_timeline_add(o, 'Customer details changed:' || coalesce(nullif(v_note, ''), ' details')), updated_at = now() where id = p_order returning * into o;
  if coalesce((p->>'updateProfile')::boolean, false) and o.customer_id is not null then
    update sfx_customers set name = coalesce(nullif(c->>'name', ''), name), phone = coalesce(nullif(c->>'phone', ''), phone), email = coalesce(nullif(c->>'email', ''), email), updated_at = now()
      where id = o.customer_id and tenant_id = tid;
  end if;
  return sfx_order_json(o, true);
end $$;
create function sfx_order_unlink_customer(p_order uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_require('sfx_orders'); o sfx_orders;
begin
  select * into o from sfx_orders where id = p_order and tenant_id = tid for update;
  if not found then raise exception 'Order not found' using errcode = 'SF003'; end if;
  update sfx_orders set customer_id = null, timeline = sfx_order_timeline_add(o, 'Customer removed from the order'), updated_at = now() where id = p_order returning * into o;
  return sfx_order_json(o, true);
end $$;
grant execute on function sfx_order_contact_set(uuid, jsonb), sfx_order_unlink_customer(uuid) to app;
