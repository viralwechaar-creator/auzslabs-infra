-- AUZsStyle: refunding a return/exchange that was paid online actually calls the SHOP'S OWN Razorpay
-- account (db/232's "bring your own Razorpay keys" model -- the money never touches AUZslab) instead of
-- only flipping a status label. A manual-payment order (COD or a UPI payment the shop confirmed by hand)
-- still just gets the plain status update -- there is no card/UPI gateway transaction to reverse there.
--
-- Same discipline as every other Razorpay piece in this codebase: the actual HTTP call to Razorpay happens
-- in server/src/routes/payments.js (SQL cannot make an outbound HTTP request), and the two new SQL helpers
-- that touch the shop's own secret are deliberately NOT registered in server/src/data/rpc-registry.js --
-- trusted-backend-only, same as sty_online_start (db/232) and provision_from_payment (db/070).

alter table sty_web_returns add column if not exists refund_amount numeric(12,2);
alter table sty_web_returns add column if not exists rzp_refund_id text;

-- sty_web_return_set (db/247) redefined once more: same stage graph and permission gate as before, now
-- also able to stamp a Razorpay refund id/amount alongside the 'refunded' transition when the caller
-- supplies them (server/src/routes/payments.js's /payments/sty/refund/finish route does, after a real
-- Razorpay refund succeeds; the plain "Finish refund" button in p-store.js does not, for a COD/manual order).
create or replace function sty_web_return_set(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; cur text; nxt text;
begin
  tid := sty_guard('sty_sell');
  select status into cur from sty_web_returns where id = p_id and tenant_id = tid;
  if cur is null then raise exception 'That return or exchange request was not found' using errcode = 'ST002'; end if;

  if p ? 'status' then
    nxt := p->>'status';
    if nxt not in ('requested', 'approved', 'rejected', 'received', 'refunded') then raise exception 'bad status' using errcode = 'ST002'; end if;
    if nxt <> cur then
      if cur in ('rejected', 'refunded') then
        raise exception 'This request is already % and cannot be changed', cur using errcode = 'ST002';
      elsif cur = 'requested' and nxt in ('approved', 'rejected') then
        if not sty_perm('sty_manage') then raise exception 'Only a manager can approve or reject a return or exchange' using errcode = '42501'; end if;
      elsif cur = 'approved' and nxt = 'received' then
        null; -- any staffer may mark the item physically received back
      elsif cur = 'received' and nxt = 'refunded' then
        if not sty_perm('sty_manage') then raise exception 'Only a manager can finish a refund or exchange' using errcode = '42501'; end if;
      else
        raise exception 'A return/exchange request must go requested -> approved/rejected -> received -> refunded, one step at a time' using errcode = 'ST002';
      end if;
    end if;
  end if;

  update sty_web_returns set
    status = coalesce(p->>'status', status),
    staff_note = case when p ? 'staffNote' then left(p->>'staffNote', 400) else staff_note end,
    refund_amount = case when p ? 'refundAmount' then (p->>'refundAmount')::numeric else refund_amount end,
    rzp_refund_id = case when p ? 'rzpRefundId' then left(p->>'rzpRefundId', 60) else rzp_refund_id end,
    updated_at = now()
  where id = p_id and tenant_id = tid;
  perform sty_audit_log(tid, 'web_return.update', p_id::text, p);
  return jsonb_build_object('ok', true);
end $$;

-- the owner/manager's own return list now also says whether the underlying order was actually paid online
-- through Razorpay (so the UI knows whether an automatic refund is even possible) -- never the shop's own
-- Razorpay secret, only a yes/no and the amount that was charged.
create or replace function sty_web_returns_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_guard('sty_sell');
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'orderId', o.id, 'number', o.number, 'customer', o.customer, 'kind', r.kind, 'reason', r.reason, 'items', r.items, 'note', r.note,
      'status', r.status, 'staffNote', r.staff_note, 'createdAt', r.created_at, 'total', o.total, 'lines', o.lines,
      'refundAmount', r.refund_amount, 'rzpRefundId', r.rzp_refund_id,
      'paymentMethod', o.payment_method, 'rzpPaid', (o.payment_method = 'online' and o.payment_status = 'paid' and o.rzp_payment_id is not null)) order by r.created_at desc)
    from (select * from sty_web_returns where tenant_id = tid order by created_at desc limit 200) r join sty_web_orders o on o.id = r.order_id), '[]'::jsonb);
end $$;

-- ---------- server-only: prepare a Razorpay refund (the shop's own keys, never the browser's) ----------
-- Called by POST /payments/sty/refund/start (owner/manager only, via withAuth so sty_guard sees the real
-- caller). Validates everything BEFORE the server ever calls Razorpay: the request is genuinely at
-- 'received' (the same stage sty_web_return_set itself requires before 'refunded'), the underlying order
-- was actually paid online, the amount asked for is real and does not exceed what was charged, and the
-- shop has Razorpay keys on file. Returns the shop's own key/secret and the original payment id -- nothing
-- about the order is changed here; only a real, confirmed Razorpay refund (sty_web_return_set, called
-- after this) ever moves the request to 'refunded'.
create or replace function sty_refund_prepare(p_return_id uuid, p_amount numeric) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; r sty_web_returns; o sty_web_orders; k sty_store_secrets;
begin
  tid := sty_guard('sty_manage');
  select * into r from sty_web_returns where id = p_return_id and tenant_id = tid;
  if r is null then raise exception 'That return or exchange request was not found' using errcode = 'ST002'; end if;
  if r.status <> 'received' then raise exception 'Mark the item received before refunding it' using errcode = 'ST002'; end if;
  select * into o from sty_web_orders where id = r.order_id;
  if o is null or o.payment_method <> 'online' or o.payment_status <> 'paid' or o.rzp_payment_id is null then
    raise exception 'This order was not paid online, so there is nothing for Razorpay to refund -- use "Finish refund" instead' using errcode = 'ST002';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > o.total then raise exception 'Enter an amount up to %', o.total using errcode = 'ST002'; end if;
  select * into k from sty_store_secrets where tenant_id = tid;
  if k.tenant_id is null then raise exception 'Card payment is not set up for this store' using errcode = 'ST002'; end if;
  return jsonb_build_object('key', k.rzp_key_id, 'secret', k.rzp_secret, 'paymentId', o.rzp_payment_id, 'amount', p_amount, 'number', o.number);
end $$;
