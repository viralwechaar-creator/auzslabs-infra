-- AUZsStyle: two real bugs found in an earlier audit, fixed now with the owner's go-ahead.
--
-- Bug 1 (money-reporting, sty_sell): an overpayment on a bill is correctly capped at the real total for the
-- bill's own paid/balance fields -- but the fix-up loop that reduces the STORED payment-mode breakdown only ever
-- looked for a 'cash' line to take the extra back out of. A customer who overpays by any non-cash mode (UPI, card)
-- -- a mistaken amount, a rounding slip on their own banking app -- had that overpayment left sitting in the
-- stored `payments` array, which Analytics' "by payment mode" report (db/217) sums directly: that mode's revenue
-- showed inflated by the leftover "change" that was never actually real money for that mode. Fix: the same
-- reduction now walks every payment line in order, not only ones with mode='cash' -- there is no real reason to
-- single out cash here, "give the change back" is really just "cap the stored breakdown at the real total."
--
-- Bug 2 (stock, public_sty_place_order_core -- the online store's real place-order function, renamed from
-- public_sty_place_order by db/257's plan-cap wrapper): each line in the cart was checked against live stock
-- independently, by that one line's own quantity -- never against how much of the SAME variant other lines in the
-- same order already asked for. Two lines for the same variantId (a cart that merged a re-added item instead of
-- bumping the existing line's qty, or a crafted request) could each individually pass a "only 5 in stock, you
-- asked for 3" check while the order as a whole asked for 6. sty_sell already tracks this correctly for in-person
-- bills (qty_in_cart); this gives the online store the exact same per-variant running total before checking stock.

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
    chg := paid - tot;   -- any overpayment, any mode, is capped back out of the stored breakdown here -- not just cash
    for i in 0..jsonb_array_length(pay) - 1 loop
      if chg > 0 then
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

create or replace function public_sty_place_order_core(p_slug text, p jsonb)
 returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; cfg jsonb; st sty_settings; l jsonb; v record; q int; have int; lines jsonb := '[]'::jsonb; sub numeric := 0; ship numeric := 0;
  pay text; num text; tok text; oid uuid; cust jsonb; ph text; feat jsonb; recent int; tn text; free_over numeric; fee numeric; disc numeric := 0; cres jsonb;
  qty_in_cart jsonb := '{}'::jsonb; cur_q int;
begin
  tid := sty_public_tenant(p_slug);
  if tid is null then raise exception 'This store is not available' using errcode = 'ST001'; end if;
  select config into cfg from sty_store where tenant_id = tid;
  cfg := coalesce(cfg, '{}'::jsonb);
  if coalesce((cfg->>'on')::boolean, false) is not true then raise exception 'This store is closed right now' using errcode = 'ST001'; end if;
  select * into st from sty_settings where tenant_id = tid;
  feat := coalesce(st.features, '{}'::jsonb);
  if jsonb_typeof(p->'lines') <> 'array' or jsonb_array_length(p->'lines') = 0 then raise exception 'Your bag is empty' using errcode = 'ST002'; end if;
  if jsonb_array_length(p->'lines') > 40 then raise exception 'Too many items in one order' using errcode = 'ST002'; end if;
  if length(trim(coalesce(p->>'name', ''))) < 2 then raise exception 'Please enter your name' using errcode = 'ST002'; end if;
  ph := regexp_replace(coalesce(p->>'phone', ''), '[^0-9+]', '', 'g');
  if length(ph) < 8 or length(ph) > 16 then raise exception 'Please enter a valid phone number' using errcode = 'ST002'; end if;
  if length(trim(coalesce(p->>'address', ''))) < 4 or length(trim(coalesce(p->>'city', ''))) < 2 or length(trim(coalesce(p->>'pin', ''))) < 4 then
    raise exception 'Please fill your full delivery address, city and PIN code' using errcode = 'ST002'; end if;
  if coalesce(p->>'email', '') <> '' and (p->>'email') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That email does not look right' using errcode = 'ST002'; end if;
  pay := coalesce(p->>'payment', 'cod');
  if pay = 'cod' then if not coalesce((cfg->'pay'->>'cod')::boolean, true) then raise exception 'Cash on delivery is not offered by this store' using errcode = 'ST002'; end if;
  elsif pay = 'upi' then if not coalesce((cfg->'pay'->>'upi')::boolean, true) or coalesce(feat->>'upiId', '') = '' then raise exception 'UPI payment is not set up for this store' using errcode = 'ST002'; end if;
  elsif pay = 'online' then if not coalesce((cfg->>'payOnline')::boolean, false) then raise exception 'Card payment is not set up for this store' using errcode = 'ST002'; end if;
  else raise exception 'Choose a payment method' using errcode = 'ST002'; end if;
  select count(*) into recent from sty_web_orders where tenant_id = tid and customer->>'phone' = ph and created_at > now() - interval '1 hour';
  if recent >= 4 then raise exception 'Too many orders from this number. Please wait a little.' using errcode = 'ST002'; end if;

  for l in select * from jsonb_array_elements(p->'lines') loop
    q := greatest(coalesce((l->>'qty')::int, 0), 0);
    if q < 1 or q > 20 then raise exception 'Quantity must be between 1 and 20' using errcode = 'ST002'; end if;
    select v2.id vid, v2.colour, v2.size, coalesce(v2.price, s.price) price, s.mrp, s.id sid, s.name, s.badge, s.photo_url, s.photos, s.colour_photos
      into v from sty_variants v2 join sty_styles s on s.id = v2.style_id
      where v2.id = nullif(l->>'variantId', '')::uuid and v2.tenant_id = tid and v2.active and s.active;
    if not found then raise exception 'One item in your bag is no longer available' using errcode = 'ST002'; end if;
    if v.badge = 'soldout' then raise exception '% is sold out', v.name using errcode = 'ST002'; end if;
    -- cumulative across every line in THIS order that asks for the same variant, not just this one line --
    -- otherwise two lines for the same item (a cart that re-added instead of bumping the existing line's qty, or
    -- a crafted request) could each pass a "only 5 in stock, you asked for 3" check while together asking for 6.
    cur_q := coalesce((qty_in_cart->>(v.vid::text))::int, 0) + q;
    qty_in_cart := qty_in_cart || jsonb_build_object(v.vid::text, cur_q);
    select coalesce(sum(qty), 0)::int into have from sty_stock_moves where tenant_id = tid and variant_id = v.vid;
    if have < cur_q then raise exception 'Only % left of % (% %)', greatest(have, 0), v.name, v.colour, v.size using errcode = 'ST002'; end if;
    sub := sub + v.price * q;
    lines := lines || jsonb_build_object('styleId', v.sid, 'variantId', v.vid, 'name', v.name, 'colour', v.colour, 'size', v.size, 'price', v.price, 'mrp', v.mrp, 'qty', q,
      'photo', coalesce((v.colour_photos->v.colour->>0), (v.photos->>0), v.photo_url));
  end loop;

  fee := coalesce(nullif(cfg->'shipping'->>'fee', '')::numeric, 0); free_over := nullif(cfg->'shipping'->>'freeOver', '')::numeric;
  ship := case when free_over is not null and free_over > 0 and sub >= free_over then 0 else fee end;
  if coalesce(trim(p->>'coupon'), '') <> '' then
    cres := sty_coupon_calc(tid, p->>'coupon', sub, ship, ph);
    if not coalesce((cres->>'ok')::boolean, false) then raise exception '%', cres->>'msg' using errcode = 'ST002'; end if;
    disc := (cres->>'discount')::numeric;
  end if;
  num := 'W' || lpad(sty_next(tid, 'web_order')::text, 5, '0');
  tok := substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
  cust := jsonb_build_object('name', left(trim(p->>'name'), 80), 'email', left(coalesce(p->>'email', ''), 120), 'phone', ph,
    'address', left(trim(p->>'address'), 200), 'address2', left(coalesce(p->>'address2', ''), 120), 'city', left(trim(p->>'city'), 80),
    'state', left(coalesce(p->>'state', ''), 60), 'pin', left(trim(p->>'pin'), 12), 'country', left(coalesce(nullif(p->>'country', ''), 'India'), 60));
  insert into sty_web_orders (tenant_id, number, token, payment_method, payment_status, customer, lines, subtotal, shipping, total, note, discount, coupon)
    values (tid, num, tok, pay, case when pay = 'cod' then 'cod' else 'pending' end, cust, lines, sub, ship, sub + ship - disc, left(coalesce(p->>'note', ''), 400), disc, case when disc > 0 then upper(trim(p->>'coupon')) end)
    returning id into oid;
  select name into tn from tenants where id = tid;
  if disc > 0 then update sty_coupons set used = used + 1 where tenant_id = tid and code = upper(trim(p->>'coupon')); end if;
  update sty_web_carts set ordered_at = now() where tenant_id = tid and phone = right(ph, 10);
  begin
    insert into notifications (tenant_id, type, title, body) values (tid, 'store_order', 'New online order ' || num, (cust->>'name') || ' ordered ' || jsonb_array_length(lines) || ' item(s), Rs ' || (sub + ship - disc));
  exception when others then null;
  end;
  return jsonb_build_object('number', num, 'token', tok, 'total', sub + ship - disc, 'discount', disc, 'payment', pay,
    'upi', case when pay = 'upi' then jsonb_build_object('id', feat->>'upiId', 'name', coalesce(nullif(feat->>'upiName', ''), coalesce(nullif(st.shop_name, ''), tn))) end);
end $$;
