-- Spend store credit at checkout. Only a signed-in customer (valid sign-in session) can use their OWN credit.
-- The order total stays the same (reports keep working); credit_applied is a payment against it.
--   Fully covered: order is marked paid. Part covered: the online charge / cash on delivery is the rest.
--   Cancelling the order gives the credit back, once.
-- Rollback: drop trigger sfx_orders_credit_back on sfx_orders; drop function sfx_orders_credit_back(); drop function sfx_online_start(text);
--   alter function sfx_online_start_pre431(text) rename to sfx_online_start; drop function public_sfx_place_order(text, jsonb);
--   alter function public_sfx_place_order_pre431(text, jsonb) rename to public_sfx_place_order; drop function sfx_order_json(sfx_orders, boolean);
--   alter function sfx_order_json_pre431(sfx_orders, boolean) rename to sfx_order_json; drop function public_sfx_order(text);
--   alter function public_sfx_order_pre431(text) rename to public_sfx_order; alter table sfx_orders drop column credit_applied, drop column credit_restored.
alter table sfx_orders add column if not exists credit_applied numeric(12,2) not null default 0;
alter table sfx_orders add column if not exists credit_restored boolean not null default false;

alter function public_sfx_place_order(text, jsonb) rename to public_sfx_place_order_pre431;
create function public_sfx_place_order(p_slug text, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb := public_sfx_place_order_pre431(p_slug, p); o sfx_orders; cid uuid; tid uuid; bal numeric; amt numeric;
begin
  if not coalesce((p->>'useCredit')::boolean, false) then return r; end if;
  cid := sfx_customer_session(p->>'customerToken');
  if cid is null then return r; end if;
  select * into o from sfx_orders where token = r->>'token' for update;
  if not found then return r; end if;
  tid := o.tenant_id;
  select credit_balance into bal from sfx_customers where id = cid and tenant_id = tid;
  if bal is null or bal <= 0 then return r; end if;
  amt := least(bal, o.total);
  if amt <= 0 then return r; end if;
  perform sfx_credit_apply_internal(tid, cid, -amt, 'order', o.id, 'Used on order ' || o.number, null);
  update sfx_orders set credit_applied = amt,
    payment_status = case when amt >= total then 'paid' else payment_status end,
    timeline = sfx_order_timeline_add(o, 'Store credit used: ' || amt::text),
    updated_at = now() where id = o.id returning * into o;
  return r || jsonb_build_object('creditApplied', o.credit_applied, 'amountDue', greatest(o.total - o.credit_applied, 0), 'paymentStatus', o.payment_status);
end $$;
grant execute on function public_sfx_place_order(text, jsonb) to app;

-- the online charge is what is left after credit
alter function sfx_online_start(text) rename to sfx_online_start_pre431;
create function sfx_online_start(p_token text) returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb := sfx_online_start_pre431(p_token); o sfx_orders;
begin
  select * into o from sfx_orders where token = lower(coalesce(p_token, ''));
  return r || jsonb_build_object('total', greatest(o.total - o.credit_applied, 0));
end $$;

-- cancelling gives the credit back, once
create function sfx_orders_credit_back() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' and new.credit_applied > 0 and not new.credit_restored and new.customer_id is not null then
    -- the credit belongs to whoever spent it: the move that took it
    perform sfx_credit_apply_internal(new.tenant_id, (select customer_id from sfx_credit_moves where order_id = new.id and reason = 'order' order by created_at desc limit 1),
      new.credit_applied, 'order_cancelled', new.id, 'Order ' || new.number || ' cancelled', null);
    new.credit_restored := true;
  end if;
  return new;
exception when others then return new;
end $$;
create trigger sfx_orders_credit_back before update on sfx_orders for each row execute function sfx_orders_credit_back();

alter function sfx_order_json(sfx_orders, boolean) rename to sfx_order_json_pre431;
create function sfx_order_json(o sfx_orders, detail boolean default false) returns jsonb language sql stable security definer set search_path = public as $$
  select sfx_order_json_pre431(o, detail) || jsonb_build_object('creditApplied', o.credit_applied)
$$;
alter function public_sfx_order(text) rename to public_sfx_order_pre431;
create function public_sfx_order(p_token text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb := public_sfx_order_pre431(p_token); o sfx_orders;
begin
  if r is null then return null; end if;
  select * into o from sfx_orders where token = lower(coalesce(p_token, ''));
  return r || jsonb_build_object('creditApplied', o.credit_applied, 'amountDue', greatest(o.total - o.credit_applied, 0));
end $$;
grant execute on function public_sfx_order(text) to app;
