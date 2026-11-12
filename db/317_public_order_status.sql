-- Customer order tracking for AUZsPOS (QR / online orders): until now, the link a customer gets the
-- instant they place an order (place_order -> /i.html?o=<tok>, db/245) only ever showed a bill once
-- one existed -- before that, i.html just said "no bill yet, try refreshing in a minute", with no real
-- status to show. public_order_status() reads the guest_orders row by its token while the order is still
-- waiting to be accepted, then the real order record (same tok, carried over by acceptG() in
-- pos/shell.js) once staff have accepted it, so the customer can watch it move: Placed -> In kitchen ->
-- Preparing -> Ready -> Served / Out for delivery -> Delivered/Billed, without ever needing a bill id.
create or replace function public_order_status(tok text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d jsonb; gstatus text;
begin
  select r.data into d from records r
    where r.kind = 'order' and not r.deleted and r.data->>'tok' = public_order_status.tok limit 1;
  if found then
    return jsonb_build_object('found', true, 'stage',
      case when d->>'status' = 'void' then 'void'
           when d->>'status' in ('paid', 'due') and coalesce(d->>'kstat', '') in ('', 'done', 'served') then 'billed'
           else coalesce(nullif(d->>'kstat', ''), 'new') end,
      'no', d->>'no', 'type', d->>'type', 'table', d->>'table', 'billed', d->>'status' in ('paid', 'due'));
  end if;
  select status into gstatus from guest_orders where guest_orders.tok = public_order_status.tok limit 1;
  if found then
    return jsonb_build_object('found', true, 'stage', case when gstatus = 'rejected' then 'rejected' else 'placed' end);
  end if;
  return jsonb_build_object('found', false);
end $$;
-- callable by anyone -- same spirit as place_order/public_invoice (db/245): a customer's own order
-- token is unguessable (random hex) and reveals only coarse status, never prices, items or other
-- customers' data.
