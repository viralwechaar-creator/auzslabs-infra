-- A customer who closes the payment window at the last moment keeps their bag; the unpaid online order they just started is cancelled
-- and its stock goes back, so the shop is not left with a ghost order. Only an unpaid online order that is still new can be abandoned.
-- Rollback: drop function public_sfx_order_abandon(text);
create or replace function public_sfx_order_abandon(p_token text) returns jsonb language plpgsql security definer set search_path = public as $$
declare o sfx_orders; l jsonb; q int;
begin
  select * into o from sfx_orders where token = lower(coalesce(p_token, '')) for update;
  if not found then return jsonb_build_object('ok', false); end if;
  if o.payment_method <> 'online' or o.payment_status = 'paid' or o.rzp_payment_id is not null or o.status <> 'new' or o.fulfilment_status <> 'unfulfilled' or o.created_at < now() - interval '2 hours' then
    return jsonb_build_object('ok', false);
  end if;
  for l in select * from jsonb_array_elements(o.lines) loop
    q := coalesce((l->>'qty')::int, 0);
    if q > 0 and (l->>'variantId') is not null then
      update sfx_variants set stock = stock + q, updated_at = now() where id = (l->>'variantId')::uuid and tenant_id = o.tenant_id;
      if found then insert into sfx_stock_moves (tenant_id, variant_id, delta, reason, note) values (o.tenant_id, (l->>'variantId')::uuid, q, 'cancel_return', 'Order ' || o.number || ' not paid, customer left the payment'); end if;
    end if;
  end loop;
  update sfx_orders set status = 'cancelled', cancel_reason = 'Customer did not complete the payment', timeline = sfx_order_timeline_add(o, 'Payment not completed, order cancelled'), updated_at = now() where id = o.id;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public_sfx_order_abandon(text) to app;
