-- Storefront round C: returns with a restock choice, refunds as their own records (partial and manual), cancel with a reason and
-- restock choice, and test orders.
--  * A refund is a record (sfx_refunds). The order keeps refunded_amount; payment_status is left alone so sales reports keep working.
--  * A return can be received with a restock choice per line (back to sellable stock, or not).
--  * Test orders are flagged; they stay visible but are left out of cost coverage.

alter table sfx_orders add column if not exists refunded_amount numeric(12,2) not null default 0 check (refunded_amount >= 0);
alter table sfx_orders add column if not exists is_test boolean not null default false;
alter table sfx_orders add column if not exists cancel_reason text;

create table if not exists sfx_refunds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  order_id uuid not null references sfx_orders(id) on delete cascade,
  return_id uuid references sfx_returns(id) on delete set null,
  amount numeric(12,2) not null check (amount > 0),
  method text not null default 'manual' check (method in ('manual', 'razorpay', 'store_credit')),
  reason text, note text,
  created_by uuid, created_at timestamptz not null default now()
);
create index if not exists idx_sfx_refunds on sfx_refunds (tenant_id, order_id);
alter table sfx_refunds enable row level security;
grant select, insert, update, delete on sfx_refunds to app;

-- Orders now report how much was refunded and each refund.
alter function sfx_order_json(sfx_orders, boolean) rename to sfx_order_json_pre421;
create function sfx_order_json(o sfx_orders, detail boolean default false) returns jsonb language sql stable security definer set search_path = public as $$
  select sfx_order_json_pre421(o, detail) || jsonb_build_object('isTest', o.is_test, 'refundedAmount', o.refunded_amount,
    'refundState', case when o.refunded_amount <= 0 then 'none' when o.refunded_amount >= o.total then 'full' else 'partial' end) ||
    jsonb_build_object('cancelReason', o.cancel_reason, 'refunds', case when o.refunded_amount <= 0 then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'amount', r.amount, 'method', r.method, 'reason', r.reason, 'note', r.note, 'createdAt', r.created_at) order by r.created_at) from sfx_refunds r where r.order_id = o.id), '[]'::jsonb) end)
$$;

-- Money out for an order, recorded by the shop (cash, UPI, bank, card). Not tied to a return.
create function sfx_refund_record(p_order uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); o sfx_orders; a numeric := round(coalesce(nullif(p->>'amount', '')::numeric, 0), 2); m text := coalesce(nullif(p->>'method', ''), 'manual');
begin
  select * into o from sfx_orders where id = p_order and tenant_id = tid for update;
  if not found then raise exception 'Order not found' using errcode = 'SF003'; end if;
  if m not in ('manual', 'store_credit') then raise exception 'Choose how the refund was paid' using errcode = 'SF002'; end if;
  if a <= 0 then raise exception 'Enter an amount above zero' using errcode = 'SF002'; end if;
  if o.payment_status <> 'paid' and o.payment_method <> 'cod' then raise exception 'This order was never paid, so there is nothing to refund' using errcode = 'SF002'; end if;
  if o.refunded_amount + a > o.total then raise exception 'You can refund at most % more on this order', o.total - o.refunded_amount using errcode = 'SF002'; end if;
  insert into sfx_refunds (tenant_id, order_id, amount, method, reason, note, created_by) values (tid, p_order, a, m, left(p->>'reason', 200), left(p->>'note', 500), app_uid());
  update sfx_orders set refunded_amount = refunded_amount + a, timeline = sfx_order_timeline_add(o, 'Refunded ' || a), updated_at = now() where id = p_order returning * into o;
  return sfx_order_json(o, true);
end $$;

-- A return marked refunded also becomes a refund record and counts against the order.
alter function sfx_return_set(uuid, text, numeric) rename to sfx_return_set_pre421;
create function sfx_return_set(p_id uuid, p_status text, p_amount numeric default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); r sfx_returns; o sfx_orders; res jsonb;
begin
  select * into r from sfx_returns where id = p_id and tenant_id = tid;
  if found and p_status = 'refunded' then
    select * into o from sfx_orders where id = r.order_id for update;
    if p_amount is not null and o.refunded_amount + p_amount > o.total then raise exception 'You can refund at most % more on this order', o.total - o.refunded_amount using errcode = 'SF002'; end if;
  end if;
  res := sfx_return_set_pre421(p_id, p_status, p_amount);
  if p_status = 'refunded' and coalesce(p_amount, 0) > 0 then
    insert into sfx_refunds (tenant_id, order_id, return_id, amount, method, reason, created_by) values (tid, r.order_id, p_id, round(p_amount, 2), 'manual', r.reason, app_uid());
    update sfx_orders set refunded_amount = refunded_amount + round(p_amount, 2), timeline = sfx_order_timeline_add(o, 'Refunded ' || round(p_amount, 2)), updated_at = now() where id = r.order_id;
  end if;
  return res;
end $$;

-- Receive a return with a choice per line: put it back on sale, or not (damaged, opened). p_lines: [{variantId, restock}]. Missing = restock.
create function sfx_return_receive(p_id uuid, p_lines jsonb default '[]'::jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); r sfx_returns; l jsonb; keep boolean; out jsonb := '[]'::jsonb;
begin
  select * into r from sfx_returns where id = p_id and tenant_id = tid for update;
  if not found then raise exception 'Return not found' using errcode = 'SF003'; end if;
  if r.status <> 'approved' then raise exception 'Only an approved return can be received' using errcode = 'SF002'; end if;
  for l in select * from jsonb_array_elements(r.lines) loop
    keep := coalesce((select (x->>'restock')::boolean from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x where x->>'variantId' = l->>'variantId' limit 1), true);
    if keep then
      update sfx_variants set stock = stock + (l->>'qty')::int, updated_at = now() where id = (l->>'variantId')::uuid and tenant_id = tid;
      insert into sfx_stock_moves (tenant_id, variant_id, delta, reason, note) values (tid, (l->>'variantId')::uuid, (l->>'qty')::int, 'restock', 'Return received');
    else
      insert into sfx_stock_moves (tenant_id, variant_id, delta, reason, note) values (tid, (l->>'variantId')::uuid, 0, 'return_not_restocked', 'Return received, not put back on sale');
    end if;
    out := out || jsonb_build_array(l || jsonb_build_object('restocked', keep));
  end loop;
  update sfx_returns set lines = out, status = 'received', updated_at = now() where id = p_id returning * into r;
  return sfx_return_json(r);
end $$;

-- Cancel with a reason and a restock choice. Untouched orders only (shipped goods go through a return).
create function sfx_order_cancel(p_order uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); o sfx_orders; rs text := left(trim(coalesce(p->>'reason', '')), 200); keep boolean := coalesce((p->>'restock')::boolean, true); l jsonb; res jsonb;
begin
  if rs = '' then raise exception 'Choose or write a reason for cancelling' using errcode = 'SF002'; end if;
  res := sfx_order_set_status(p_order, 'cancelled');
  select * into o from sfx_orders where id = p_order and tenant_id = tid;
  if not keep then
    for l in select * from jsonb_array_elements(o.lines) loop
      update sfx_variants set stock = greatest(stock - (l->>'qty')::int, 0), updated_at = now() where id = (l->>'variantId')::uuid and tenant_id = tid;
      insert into sfx_stock_moves (tenant_id, variant_id, delta, reason, note) values (tid, (l->>'variantId')::uuid, -(l->>'qty')::int, 'cancel_no_restock', 'Order ' || o.number || ' cancelled, not restocked');
    end loop;
  end if;
  update sfx_orders set cancel_reason = rs, timeline = sfx_order_timeline_add(o, 'Cancel reason: ' || rs), updated_at = now() where id = p_order returning * into o;
  return sfx_order_json(o, true);
end $$;

create function sfx_order_mark_test(p_order uuid, p_test boolean) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); o sfx_orders;
begin
  update sfx_orders set is_test = coalesce(p_test, true), updated_at = now() where id = p_order and tenant_id = tid returning * into o;
  if not found then raise exception 'Order not found' using errcode = 'SF003'; end if;
  return sfx_order_json(o, true);
end $$;

-- Cost coverage ignores test orders.
create or replace function sfx_cost_coverage(p_days int default 30) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view'); r jsonb;
begin
  select jsonb_build_object('sales', coalesce(sum(rev), 0), 'salesWithCost', coalesce(sum(rev) filter (where has_cost), 0),
    'cost', coalesce(sum(cst) filter (where has_cost), 0), 'lines', count(*), 'linesWithCost', count(*) filter (where has_cost),
    'coverage', case when coalesce(sum(rev), 0) = 0 then null else round(100 * coalesce(sum(rev) filter (where has_cost), 0) / sum(rev), 1) end)
  into r from (
    select (l->>'price')::numeric * coalesce((l->>'qty')::int, 1) rev, (l->>'cost') is not null and l->>'cost' <> 'null' has_cost,
      coalesce(nullif(l->>'cost', 'null')::numeric, 0) * coalesce((l->>'qty')::int, 1) cst
    from sfx_orders o, jsonb_array_elements(o.lines) l
    where o.tenant_id = tid and o.status not in ('cancelled') and not o.is_test and o.created_at >= now() - make_interval(days => greatest(coalesce(p_days, 30), 1))) x;
  return r;
end $$;
grant execute on function sfx_refund_record(uuid, jsonb), sfx_return_receive(uuid, jsonb), sfx_order_cancel(uuid, jsonb), sfx_order_mark_test(uuid, boolean) to app;

-- Rollback: drop functions sfx_refund_record, sfx_return_receive, sfx_order_cancel, sfx_order_mark_test; drop function sfx_return_set(uuid,text,numeric)
-- and rename sfx_return_set_pre421 back; drop function sfx_order_json(sfx_orders,boolean) and rename sfx_order_json_pre421 back;
-- drop table sfx_refunds; drop columns sfx_orders.refunded_amount, is_test, cancel_reason.
