-- 1. The public order page read order.customer.name, which the storefront's order answer never had, so the page crashed after "Place order".
--    The answer now carries the customer's name and the payment method under the names the page reads.
-- 2. An order placed on the storefront is copied into AUZsStyle only to move stock; that copy no longer raises an "online order" push in the POS.
-- Rollback: drop function public_sfx_order(text); alter function public_sfx_order_pre448(text) rename to public_sfx_order; restore sty_web_order_push from db/231.
alter function public_sfx_order(text) rename to public_sfx_order_pre448;
create function public_sfx_order(p_token text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb := public_sfx_order_pre448(p_token); o sfx_orders;
begin
  if r is null then return null; end if;
  select * into o from sfx_orders where token = lower(coalesce(p_token, ''));
  return r || jsonb_build_object('payment', o.payment_method, 'customer', jsonb_build_object('name', coalesce(o.customer->>'name', '')));
end $$;
grant execute on function public_sfx_order(text) to app;

create or replace function sty_web_order_push() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.sfx_order_id is not null then return new; end if;   -- a copy of a storefront order: stock only, the storefront owns the order
  perform pg_notify('push_events', jsonb_build_object('tenant_id', new.tenant_id, 'title', 'New online order ' || new.number,
    'body', coalesce(new.customer->>'name', 'A customer') || ' - Rs ' || round(new.total) || ' (' || case new.payment_method when 'cod' then 'cash on delivery' else 'UPI' end || ')', 'url', '/style.html#/store')::text);
  return new;
exception when others then return new;
end $$;
