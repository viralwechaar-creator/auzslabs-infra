-- Interlinking: the order carries its customer id so the dashboard can open the customer from an order.
-- Rollback: drop function sfx_order_json(sfx_orders, boolean); alter function sfx_order_json_pre430(sfx_orders, boolean) rename to sfx_order_json;
alter function sfx_order_json(sfx_orders, boolean) rename to sfx_order_json_pre430;
create function sfx_order_json(o sfx_orders, detail boolean default false) returns jsonb language sql stable security definer set search_path = public as $$
  select sfx_order_json_pre430(o, detail) || jsonb_build_object('customerId', o.customer_id)
$$;
