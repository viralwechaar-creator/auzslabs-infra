-- AUZsStyle: coupon codes (db/232) already existed for the online store only. The owner asked to be able to
-- create coupons and run festive/special-occasion offers -- a coupon code the owner creates once already covers
-- that ("DIWALI20", "FIRSTBUY", a flat rupee amount off, with a start/end date and a usage cap), it just needed
-- wiring into in-person billing too. Validation is shared with the online store's sty_coupon_calc, never trusted
-- from the client: the amount shown at the till is only a preview, the server re-checks everything (expiry, min
-- order, usage cap, one-per-customer, first-order-only) at the moment the bill is actually saved.
alter table sty_sales add column if not exists coupon text;

-- Extends the "already used" / "first order only" checks to also look at in-person bills (sty_sales), not just
-- web orders -- a customer could otherwise use the same one-per-customer coupon once online and once at the till.
create or replace function sty_coupon_calc(tid uuid, p_code text, p_sub numeric, p_ship numeric, p_phone text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c sty_coupons; d numeric; ph text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
begin
  select * into c from sty_coupons where tenant_id = tid and code = upper(trim(coalesce(p_code, ''))) and active;
  if not found then return jsonb_build_object('ok', false, 'msg', 'That coupon code is not valid'); end if;
  if c.starts_on is not null and current_date < c.starts_on then return jsonb_build_object('ok', false, 'msg', 'This coupon has not started yet'); end if;
  if c.ends_on is not null and current_date > c.ends_on then return jsonb_build_object('ok', false, 'msg', 'This coupon has expired'); end if;
  if c.max_uses is not null and c.used >= c.max_uses then return jsonb_build_object('ok', false, 'msg', 'This coupon has been fully used'); end if;
  if p_sub < c.min_order then return jsonb_build_object('ok', false, 'msg', 'Add items worth Rs ' || round(c.min_order) || ' or more to use this coupon'); end if;
  if length(ph) >= 8 then
    if exists (select 1 from sty_web_orders where tenant_id = tid and coupon = c.code and right(regexp_replace(customer->>'phone', '\D', '', 'g'), 10) = ph and status <> 'cancelled')
       or exists (select 1 from sty_sales sl join sty_customers cu on cu.id = sl.customer_id where sl.tenant_id = tid and sl.coupon = c.code and right(regexp_replace(coalesce(cu.phone, ''), '\D', '', 'g'), 10) = ph and sl.status <> 'void') then
      return jsonb_build_object('ok', false, 'msg', 'You have already used this coupon'); end if;
    if c.first_order_only and (
         exists (select 1 from sty_web_orders where tenant_id = tid and right(regexp_replace(customer->>'phone', '\D', '', 'g'), 10) = ph and status <> 'cancelled')
         or exists (select 1 from sty_sales sl join sty_customers cu on cu.id = sl.customer_id where sl.tenant_id = tid and right(regexp_replace(coalesce(cu.phone, ''), '\D', '', 'g'), 10) = ph and sl.status <> 'void')) then
      return jsonb_build_object('ok', false, 'msg', 'This coupon is for first orders only'); end if;
  end if;
  d := case c.kind when 'pct' then round(p_sub * least(c.value, 100) / 100, 2) when 'flat' then least(c.value, p_sub) else coalesce(p_ship, 0) end;
  return jsonb_build_object('ok', true, 'code', c.code, 'kind', c.kind, 'discount', d, 'msg', case c.kind when 'ship' then 'Free shipping applied' else 'Coupon applied: you save Rs ' || round(d) end);
end $$;

-- Staff-side preview at the till (p: {code, subtotal, phone?}) -- a read-only check, exactly what sty_sell itself
-- will re-check when the bill is actually saved, so the cashier sees the real answer before paying.
create or replace function sty_coupon_check(p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_guard('sty_sell');
  return sty_coupon_calc(tid, p->>'code', coalesce((p->>'subtotal')::numeric, 0), 0, coalesce(p->>'phone', ''));
end $$;

-- Replaces sty_sale_json (db/216): adds the coupon code (if one was applied) so a receipt/bill view can show it.
create or replace function sty_sale_json(tid uuid, sid uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', s.id, 'number', s.number, 'seq', s.seq, 'at', s.at, 'branchId', s.branch_id, 'status', s.status,
    'subtotal', s.subtotal, 'discount', s.discount, 'tax', s.tax, 'rounding', s.rounding, 'total', s.total, 'paid', s.paid, 'balance', greatest(s.total - s.paid, 0),
    'payments', s.payments, 'pointsEarned', s.points_earned, 'pointsUsed', s.points_used, 'note', s.note, 'voidReason', s.void_reason, 'offline', s.offline, 'coupon', s.coupon,
    'staffId', s.staff_id,
    'staff', (select coalesce(nullif(p.name, ''), p.email) from profiles p where p.id = s.staff_id),
    'customer', (select jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'points', c.points, 'credit', c.credit) from sty_customers c where c.id = s.customer_id),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'variantId', l.variant_id, 'styleId', l.style_id, 'name', l.style_name, 'category', l.category, 'brand', l.brand,
        'colour', l.colour, 'size', l.size, 'barcode', l.barcode, 'qty', l.qty, 'mrp', l.mrp, 'price', l.price, 'disc', l.disc, 'taxPct', l.tax_pct, 'tax', l.tax, 'net', l.net,
        'returned', l.returned) order by l.id) from sty_sale_lines l where l.sale_id = s.id), '[]'::jsonb),
    'returns', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'at', r.at, 'mode', r.mode, 'refund', r.refund, 'reason', r.reason)) from sty_returns r where r.sale_id = s.id), '[]'::jsonb))
  from sty_sales s where s.id = sid and s.tenant_id = tid
$$;

-- Replaces sty_sell (db/271): adds an optional p.coupon. If present, it is re-validated here (never trusted from
-- the client) and its discount is folded into the bill discount the same way a manual discount already is.
create or replace function sty_sell(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  tid uuid; sid uuid; st sty_settings; b uuid; cust sty_customers; L jsonb := '[]'::jsonb; e jsonb; i int; v record;
  q int; unit numeric; gross numeric; ld numeric; after_ numeric; sub numeric := 0; ldisc numeric := 0; bdisc numeric := 0; share numeric;
  tot_after numeric := 0; rate numeric; net numeric; tx numeric; tot numeric := 0; taxsum numeric := 0; rnd numeric := 0; stock int;
  pts int := 0; ptsval numeric := 0; pay jsonb := '[]'::jsonb; paid numeric := 0; chg numeric; credit_used numeric := 0; pm text; amt numeric;
  seq_ bigint; num text; earn int := 0; at_ timestamptz; disc_pct numeric; stat text; qty_in_cart jsonb := '{}'::jsonb; cur_q int;
  coupon_code text; cres jsonb; coupon_disc numeric := 0;
begin
  tid := sty_guard('sty_sell');
  sid := (p->>'id')::uuid;
  if exists (select 1 from sty_sales where id = sid and tenant_id = tid) then
    return sty_sale_json(tid, sid) || jsonb_build_object('duplicate', true);
  end if;
  select * into st from sty_settings where tenant_id = tid;
  if st.tenant_id is null then perform sty_context(); select * into st from sty_settings where tenant_id = tid; end if;
  if jsonb_array_length(coalesce(p->'lines', '[]'::jsonb)) = 0 then raise exception 'The bill is empty' using errcode = 'ST004'; end if;
  b := coalesce(nullif(p->>'branchId', '')::uuid, sty_main_branch(tid));
  at_ := coalesce(nullif(p->>'at', '')::timestamptz, now());
  if st.day_close_date is not null and at_::date <= st.day_close_date then raise exception 'That day is closed' using errcode = 'ST006'; end if;
  if nullif(p->>'customerId', '') is not null then
    select * into cust from sty_customers where id = (p->>'customerId')::uuid and tenant_id = tid;
    if cust.id is null then raise exception 'customer not found'; end if;
  end if;
  if st.require_customer_phone and (cust.id is null or coalesce(cust.phone, '') = '') then raise exception 'Add the customer phone number' using errcode = 'ST007'; end if;

  -- pass 1: price every line, check stock
  for e in select * from jsonb_array_elements(p->'lines') loop
    q := (e->>'qty')::int;
    if q is null or q <= 0 then raise exception 'Quantity must be above zero'; end if;
    select v2.id as vid, v2.style_id, v2.colour, v2.size, v2.barcode, v2.cost, coalesce(v2.price, s.price) as price, s.mrp, s.name, s.category, s.brand, s.tax_pct, v2.active
      into v from sty_variants v2 join sty_styles s on s.id = v2.style_id where v2.id = (e->>'variantId')::uuid and v2.tenant_id = tid;
    if v.vid is null then raise exception 'item not found'; end if;
    cur_q := coalesce((qty_in_cart->>(v.vid::text))::int, 0) + q;
    qty_in_cart := qty_in_cart || jsonb_build_object(v.vid::text, cur_q);
    stock := sty_stock_of(tid, v.vid, b);
    if cur_q > stock and not st.allow_negative_stock and not coalesce((p->>'offline')::boolean, false) then
      raise exception '% % % : only % in stock', v.name, v.colour, v.size, stock using errcode = 'ST003';
    end if;
    unit := v.price;
    if (e->>'price') is not null and (e->>'price')::numeric <> v.price then
      if not sty_perm('sty_manage') then raise exception 'Changing a price needs a manager' using errcode = 'ST005'; end if;
      unit := (e->>'price')::numeric;
    end if;
    gross := round(unit * q, 2);
    ld := case when (e->>'discPct') is not null then gross * (e->>'discPct')::numeric / 100 else coalesce((e->>'discAmt')::numeric, 0) end;
    ld := round(least(greatest(ld, 0), gross), 2);
    after_ := gross - ld;
    sub := sub + gross; ldisc := ldisc + ld; tot_after := tot_after + after_;
    L := L || jsonb_build_object('vid', v.vid, 'sid', v.style_id, 'name', v.name, 'cat', v.category, 'brand', v.brand, 'colour', v.colour, 'size', v.size,
      'barcode', v.barcode, 'qty', q, 'mrp', v.mrp, 'unit', unit, 'ld', ld, 'after', after_, 'cost', v.cost, 'taxpct', v.tax_pct);
  end loop;

  -- bill discount, spread over the lines in proportion to what each still costs
  if (p->>'billDiscPct') is not null then bdisc := tot_after * (p->>'billDiscPct')::numeric / 100;
  else bdisc := coalesce((p->>'billDiscAmt')::numeric, 0); end if;

  -- a coupon code is re-validated here, never trusted from the client -- a stale/expired/already-used code is a
  -- hard refusal, not a silently-ignored discount, so a cashier is never surprised by a different total at pay time.
  coupon_code := upper(trim(coalesce(p->>'coupon', '')));
  if coupon_code <> '' then
    cres := sty_coupon_calc(tid, coupon_code, sub, 0, coalesce(cust.phone, ''));
    if not coalesce((cres->>'ok')::boolean, false) then raise exception '%', cres->>'msg' using errcode = 'ST015'; end if;
    if cres->>'kind' <> 'ship' then coupon_disc := coalesce((cres->>'discount')::numeric, 0); bdisc := bdisc + coupon_disc; end if;
  end if;

  bdisc := round(least(greatest(bdisc, 0), tot_after), 2);
  disc_pct := case when sub > 0 then (ldisc + bdisc) / sub * 100 else 0 end;
  if disc_pct > st.max_discount_pct + 0.001 and coupon_disc = 0 and not sty_perm('sty_manage') then
    raise exception 'A discount above % % needs a manager', st.max_discount_pct, '%' using errcode = 'ST005';
  end if;

  -- pass 2: tax + net per line
  for i in 0..jsonb_array_length(L) - 1 loop
    e := L->i;
    share := case when tot_after > 0 then round(bdisc * (e->>'after')::numeric / tot_after, 2) else 0 end;
    net := (e->>'after')::numeric - share;
    rate := sty_tax_rate(st, nullif(e->>'taxpct', '')::numeric, net / (e->>'qty')::numeric);
    if st.price_includes_tax then tx := round(net - net / (1 + rate / 100), 2);
    else tx := round(net * rate / 100, 2); net := net + tx; end if;
    tot := tot + net; taxsum := taxsum + tx;
    L := jsonb_set(L, array[i::text], e || jsonb_build_object('disc', (e->>'ld')::numeric + share, 'rate', rate, 'tax', tx, 'net', net));
  end loop;
  if st.round_off then rnd := round(tot) - tot; end if;
  tot := tot + rnd;

  -- payments. 'credit' and 'exchange' are the SAME tracked balance (sty_customers.credit) -- exchange credit is
  -- granted by sty_return exactly like store credit now, so both are capped against the real remaining balance,
  -- not trusted at face value, and multiple such lines in one bill correctly share one running cap.
  if cust.id is not null and coalesce((p->>'redeemPoints')::int, 0) > 0 then
    pts := least((p->>'redeemPoints')::int, cust.points);
    ptsval := least(round(pts * st.loyalty_point_value, 2), tot);
    pts := ceil(ptsval / nullif(st.loyalty_point_value, 0))::int;
    if ptsval > 0 then pay := pay || jsonb_build_object('mode', 'points', 'amount', ptsval); paid := paid + ptsval; end if;
  end if;
  for e in select * from jsonb_array_elements(coalesce(p->'payments', '[]'::jsonb)) loop
    pm := e->>'mode'; amt := coalesce((e->>'amount')::numeric, 0);
    continue when amt <= 0 or pm = 'due';
    if pm = 'credit' or pm = 'exchange' then
      if cust.id is null then raise exception 'Pick the customer to use store credit'; end if;
      amt := least(amt, cust.credit - credit_used); credit_used := credit_used + amt;
      continue when amt <= 0;
    end if;
    pay := pay || jsonb_build_object('mode', pm, 'amount', amt); paid := paid + amt;
  end loop;
  if paid > tot + 0.005 then
    chg := paid - tot;                                       -- change handed back comes out of the cash taken
    for i in 0..jsonb_array_length(pay) - 1 loop
      if pay->i->>'mode' = 'cash' and chg > 0 then
        amt := (pay->i->>'amount')::numeric;
        pay := jsonb_set(pay, array[i::text, 'amount'], to_jsonb(greatest(amt - chg, 0)));
        chg := chg - least(amt, chg);
      end if;
    end loop;
    paid := tot;
  end if;
  stat := case when paid >= tot - 0.005 then 'paid' else 'due' end;
  if stat = 'due' and cust.id is null then raise exception 'Pick a customer to leave a balance due' using errcode = 'ST007'; end if;
  if cust.id is not null then earn := floor(greatest(tot - ptsval, 0) * st.loyalty_earn_pct / 100)::int; end if;

  seq_ := sty_next(tid, 'sale');
  num := st.bill_prefix || '-' || lpad(seq_::text, 5, '0');
  insert into sty_sales (id, tenant_id, seq, number, branch_id, customer_id, staff_id, at, subtotal, discount, tax, rounding, total, paid, status, payments,
    points_earned, points_used, note, offline, credit_used, coupon)
  values (sid, tid, seq_, num, b, cust.id, app_uid(), at_, sub, ldisc + bdisc, taxsum, rnd, tot, paid, stat, pay, earn, pts, p->>'note', coalesce((p->>'offline')::boolean, false), credit_used,
    case when coupon_disc > 0 then coupon_code end);
  for i in 0..jsonb_array_length(L) - 1 loop
    e := L->i;
    insert into sty_sale_lines (tenant_id, sale_id, variant_id, style_id, style_name, category, brand, colour, size, barcode, qty, mrp, price, disc, tax_pct, tax, net, cost)
    values (tid, sid, (e->>'vid')::uuid, (e->>'sid')::uuid, e->>'name', e->>'cat', e->>'brand', e->>'colour', e->>'size', e->>'barcode', (e->>'qty')::int,
      coalesce((e->>'mrp')::numeric, 0), (e->>'unit')::numeric, (e->>'disc')::numeric, (e->>'rate')::numeric, (e->>'tax')::numeric, (e->>'net')::numeric, (e->>'cost')::numeric);
    insert into sty_stock_moves (tenant_id, branch_id, variant_id, qty, kind, ref_type, ref_id, unit_cost, staff_id, at)
    values (tid, b, (e->>'vid')::uuid, -(e->>'qty')::int, 'sale', 'sale', sid, (e->>'cost')::numeric, app_uid(), at_);
  end loop;
  if cust.id is not null then
    update sty_customers set points = greatest(points - pts + earn, 0), credit = greatest(credit - credit_used, 0) where id = cust.id;
  end if;
  if coupon_disc > 0 then update sty_coupons set used = used + 1 where tenant_id = tid and code = coupon_code; end if;
  if p ? 'holdId' and nullif(p->>'holdId', '') is not null then update sty_holds set status = 'closed' where id = (p->>'holdId')::uuid and tenant_id = tid; end if;
  return sty_sale_json(tid, sid);
end $$;
