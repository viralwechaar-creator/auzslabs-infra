-- Online orders: one billing, not two. When an online order is paid (UPI confirmed, or cash taken on delivery) the server
-- makes the real bill itself (stock moves, bill number, WhatsApp link) -- staff never re-enter it on the till.
-- Also: a push alert to the shop's devices when an online order arrives.

create or replace function sty_web_order_bill(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; o sty_web_orders; cid jsonb; l jsonb; lines jsonb := '[]'::jsonb; r jsonb; pay jsonb := '[]'::jsonb; cur numeric; mgr boolean := sty_perm('sty_manage'); one jsonb;
begin
  tid := sty_guard('sty_sell');
  select * into o from sty_web_orders where id = p_id and tenant_id = tid for update;
  if not found then raise exception 'order not found' using errcode = 'ST002'; end if;
  if o.sale_id is not null then return jsonb_build_object('saleId', o.sale_id, 'duplicate', true); end if;
  if o.status = 'cancelled' then raise exception 'This order is cancelled' using errcode = 'ST002'; end if;
  cid := sty_save_customer(jsonb_build_object('name', o.customer->>'name', 'phone', o.customer->>'phone', 'email', nullif(o.customer->>'email', '')));
  for l in select * from jsonb_array_elements(o.lines) loop
    select coalesce(v.price, s.price) into cur from sty_variants v join sty_styles s on s.id = v.style_id where v.id = (l->>'variantId')::uuid and v.tenant_id = tid;
    one := jsonb_build_object('variantId', l->>'variantId', 'qty', (l->>'qty')::int);
    if cur is not null and abs(cur - (l->>'price')::numeric) > 0.005 and mgr then one := one || jsonb_build_object('price', (l->>'price')::numeric); end if;
    lines := lines || one;
  end loop;
  if o.payment_status in ('paid') then
    pay := jsonb_build_array(jsonb_build_object('mode', case when o.payment_method = 'cod' then 'cash' when o.payment_method = 'online' then 'card' else 'upi' end, 'amount', round(o.subtotal)));
  end if;
  r := sty_sell(jsonb_build_object('id', gen_random_uuid(), 'customerId', cid->>'id', 'note', 'Online order ' || o.number || case when o.shipping > 0 then ' (shipping Rs ' || o.shipping || ' collected separately)' else '' end, 'payments', pay, 'lines', lines));
  update sty_web_orders set sale_id = (r->>'id')::uuid, updated_at = now() where id = o.id;
  perform sty_audit_log(tid, 'web_order.bill', o.number, jsonb_build_object('sale', r->>'number'));
  return jsonb_build_object('saleId', r->>'id', 'number', r->>'number');
end $$;

create or replace function sty_web_order_update(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; o sty_web_orders; billed jsonb; berr text; o2 sty_web_orders;
begin
  tid := sty_guard('sty_sell');
  select * into o from sty_web_orders where id = p_id and tenant_id = tid;
  if not found then raise exception 'order not found' using errcode = 'ST002'; end if;
  if p ? 'status' and (p->>'status') not in ('new', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled') then raise exception 'bad status' using errcode = 'ST002'; end if;
  if p ? 'paymentStatus' and (p->>'paymentStatus') not in ('pending', 'submitted', 'paid', 'cod') then raise exception 'bad payment status' using errcode = 'ST002'; end if;
  update sty_web_orders set status = coalesce(p->>'status', status), payment_status = coalesce(p->>'paymentStatus', payment_status),
    staff_note = case when p ? 'staffNote' then left(p->>'staffNote', 400) else staff_note end,
    sale_id = coalesce(nullif(p->>'saleId', '')::uuid, sale_id), updated_at = now()
    where id = p_id;
  perform sty_audit_log(tid, 'web_order.update', o.number, p);
  select * into o2 from sty_web_orders where id = p_id;
  if o2.sale_id is null and o2.payment_status = 'paid' and o2.status <> 'cancelled' then
    begin billed := sty_web_order_bill(p_id);
    exception when others then berr := sqlerrm; end;
  end if;
  return (select jsonb_build_object('id', id, 'number', number, 'status', status, 'paymentStatus', payment_status, 'saleId', sale_id, 'billed', billed->>'number', 'billError', berr) from sty_web_orders where id = p_id);
end $$;

create or replace function sty_web_orders_list(p jsonb default '{}'::jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; stt text := nullif(p->>'status', '');
begin
  tid := sty_guard('sty_sell');
  return coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'number', o.number, 'token', o.token, 'status', o.status, 'payment', o.payment_method, 'paymentStatus', o.payment_status,
      'utr', o.utr, 'customer', o.customer, 'lines', o.lines, 'subtotal', o.subtotal, 'shipping', o.shipping, 'total', o.total, 'note', o.note, 'staffNote', o.staff_note,
      'saleId', o.sale_id, 'saleNo', (select number from sty_sales where id = o.sale_id), 'createdAt', o.created_at) order by o.created_at desc)
    from (select * from sty_web_orders where tenant_id = tid and (stt is null or status = stt) order by created_at desc limit 200) o), '[]'::jsonb);
end $$;

-- push alert to every device of the shop when an online order is placed
create or replace function sty_web_order_push() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform pg_notify('push_events', jsonb_build_object('tenant_id', new.tenant_id, 'title', 'New online order ' || new.number,
    'body', coalesce(new.customer->>'name', 'A customer') || ' - Rs ' || round(new.total) || ' (' || case new.payment_method when 'cod' then 'cash on delivery' else 'UPI' end || ')', 'url', '/style.html#/store')::text);
  return new;
exception when others then return new;
end $$;
drop trigger if exists sty_web_orders_push on sty_web_orders;
create trigger sty_web_orders_push after insert on sty_web_orders for each row execute function sty_web_order_push();
