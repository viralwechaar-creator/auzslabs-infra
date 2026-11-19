-- AUZsStyle: GST tax invoices, a GST filing summary, formal GST purchase bills, a purchase/ITC register, and
-- customer bill due dates -- the gap between AUZsStyle's existing retail tax handling (a flat per-item GST%,
-- HSN codes already on styles since db/306, a shop GSTIN in Settings) and a real tax invoice. Owner request,
-- scoped specifically to a clothing retailer, not full double-entry books (that's the separate Accounting app).
--
-- CGST/SGST vs IGST: compared against sty_settings.gstin's state code (first 2 digits). A sale with no customer
-- GSTIN (the overwhelming majority of a retail clothing shop's bills -- walk-in, no business buyer) is always
-- treated as intra-state (CGST+SGST split) -- the correct, standard assumption for B2C retail. A purchase with
-- no supplier GSTIN is treated the same way. Only a customer/supplier whose own GSTIN state code differs from
-- the shop's triggers IGST instead.

-- ---------- schema ----------
alter table sty_sales add column if not exists cgst numeric(14,2) not null default 0,
  add column if not exists sgst numeric(14,2) not null default 0,
  add column if not exists igst numeric(14,2) not null default 0,
  add column if not exists place_of_supply text,
  add column if not exists due_date date;
alter table sty_sale_lines add column if not exists hsn text,
  add column if not exists cgst numeric(12,2) not null default 0,
  add column if not exists sgst numeric(12,2) not null default 0,
  add column if not exists igst numeric(12,2) not null default 0;

alter table sty_purchases add column if not exists taxable_value numeric(14,2) not null default 0,
  add column if not exists cgst numeric(14,2) not null default 0,
  add column if not exists sgst numeric(14,2) not null default 0,
  add column if not exists igst numeric(14,2) not null default 0,
  add column if not exists place_of_supply text;
alter table sty_purchase_lines add column if not exists hsn text,
  add column if not exists tax_pct numeric(5,2) not null default 0,
  add column if not exists tax numeric(12,2) not null default 0;

-- ---------- sales: GST split + HSN snapshot + an optional due date on a credit sale ----------
-- Replaces sty_sell (db/275): same body, plus (a) s.hsn carried through to each line and snapshotted on
-- sty_sale_lines (an HSN can change later on the style; the bill must keep showing what was true at sale time,
-- same reasoning as style_name/category/brand already being snapshotted here), (b) each line's tax split into
-- cgst/sgst or igst by comparing the shop's own GSTIN state code to the billed customer's GSTIN state code (not
-- present on nearly every retail sale, intra-state assumed), summed onto sty_sales, and (c) an optional
-- p.dueDate, stored only when the sale actually goes to 'due' status (a paid-in-full sale has no due date).
create or replace function sty_sell(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  tid uuid; sid uuid; st sty_settings; b uuid; cust sty_customers; L jsonb := '[]'::jsonb; e jsonb; i int; v record;
  q int; unit numeric; gross numeric; ld numeric; after_ numeric; sub numeric := 0; ldisc numeric := 0; bdisc numeric := 0; share numeric;
  tot_after numeric := 0; rate numeric; net numeric; tx numeric; tot numeric := 0; taxsum numeric := 0; rnd numeric := 0; stock int;
  pts int := 0; ptsval numeric := 0; pay jsonb := '[]'::jsonb; paid numeric := 0; chg numeric; credit_used numeric := 0; pm text; amt numeric;
  seq_ bigint; num text; earn int := 0; at_ timestamptz; disc_pct numeric; stat text; qty_in_cart jsonb := '{}'::jsonb; cur_q int;
  coupon_code text; cres jsonb; coupon_disc numeric := 0;
  shop_state text; cust_state text; interstate boolean; cg numeric; sg numeric; ig numeric; cgsum numeric := 0; sgsum numeric := 0; igsum numeric := 0;
  due_dt date;
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

  shop_state := left(st.gstin, 2);
  cust_state := left(cust.gstin, 2);
  interstate := shop_state is not null and cust_state is not null and cust_state <> shop_state;

  -- pass 1: price every line, check stock
  for e in select * from jsonb_array_elements(p->'lines') loop
    q := (e->>'qty')::int;
    if q is null or q <= 0 then raise exception 'Quantity must be above zero'; end if;
    select v2.id as vid, v2.style_id, v2.colour, v2.size, v2.barcode, v2.cost, coalesce(v2.price, s.price) as price, s.mrp, s.name, s.category, s.brand, s.tax_pct, s.hsn, v2.active
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
      'barcode', v.barcode, 'qty', q, 'mrp', v.mrp, 'unit', unit, 'ld', ld, 'after', after_, 'cost', v.cost, 'taxpct', v.tax_pct, 'hsn', v.hsn);
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

  -- pass 2: tax + net per line, split CGST+SGST (same state / no buyer GSTIN) or IGST (different-state buyer)
  for i in 0..jsonb_array_length(L) - 1 loop
    e := L->i;
    share := case when tot_after > 0 then round(bdisc * (e->>'after')::numeric / tot_after, 2) else 0 end;
    net := (e->>'after')::numeric - share;
    rate := sty_tax_rate(st, nullif(e->>'taxpct', '')::numeric, net / (e->>'qty')::numeric);
    if st.price_includes_tax then tx := round(net - net / (1 + rate / 100), 2);
    else tx := round(net * rate / 100, 2); net := net + tx; end if;
    if interstate then ig := tx; cg := 0; sg := 0; else cg := round(tx / 2, 2); sg := tx - cg; ig := 0; end if;
    cgsum := cgsum + cg; sgsum := sgsum + sg; igsum := igsum + ig;
    tot := tot + net; taxsum := taxsum + tx;
    L := jsonb_set(L, array[i::text], e || jsonb_build_object('disc', (e->>'ld')::numeric + share, 'rate', rate, 'tax', tx, 'net', net, 'cgst', cg, 'sgst', sg, 'igst', ig));
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
  if stat = 'due' then due_dt := nullif(p->>'dueDate', '')::date; end if;
  if cust.id is not null then earn := floor(greatest(tot - ptsval, 0) * st.loyalty_earn_pct / 100)::int; end if;

  seq_ := sty_next(tid, 'sale');
  num := st.bill_prefix || '-' || lpad(seq_::text, 5, '0');
  insert into sty_sales (id, tenant_id, seq, number, branch_id, customer_id, staff_id, at, subtotal, discount, tax, cgst, sgst, igst, place_of_supply, due_date, rounding, total, paid, status, payments,
    points_earned, points_used, note, offline, credit_used, coupon)
  values (sid, tid, seq_, num, b, cust.id, app_uid(), at_, sub, ldisc + bdisc, taxsum, cgsum, sgsum, igsum, coalesce(cust_state, shop_state), due_dt, rnd, tot, paid, stat, pay, earn, pts, p->>'note', coalesce((p->>'offline')::boolean, false), credit_used,
    case when coupon_disc > 0 then coupon_code end);
  for i in 0..jsonb_array_length(L) - 1 loop
    e := L->i;
    insert into sty_sale_lines (tenant_id, sale_id, variant_id, style_id, style_name, category, brand, colour, size, barcode, qty, mrp, price, disc, tax_pct, tax, net, cost, hsn, cgst, sgst, igst)
    values (tid, sid, (e->>'vid')::uuid, (e->>'sid')::uuid, e->>'name', e->>'cat', e->>'brand', e->>'colour', e->>'size', e->>'barcode', (e->>'qty')::int,
      coalesce((e->>'mrp')::numeric, 0), (e->>'unit')::numeric, (e->>'disc')::numeric, (e->>'rate')::numeric, (e->>'tax')::numeric, (e->>'net')::numeric, (e->>'cost')::numeric, e->>'hsn',
      (e->>'cgst')::numeric, (e->>'sgst')::numeric, (e->>'igst')::numeric);
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

-- Replaces sty_sale_json (db/273): adds cgst/sgst/igst/placeOfSupply/dueDate on the sale and hsn per line, and
-- the shop's own GSTIN + the billed customer's GSTIN/address (needed to print a compliant tax invoice -- the
-- seller and buyer GSTIN, not just the amounts).
create or replace function sty_sale_json(tid uuid, sid uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', s.id, 'number', s.number, 'seq', s.seq, 'at', s.at, 'branchId', s.branch_id, 'status', s.status,
    'subtotal', s.subtotal, 'discount', s.discount, 'tax', s.tax, 'cgst', s.cgst, 'sgst', s.sgst, 'igst', s.igst, 'placeOfSupply', s.place_of_supply, 'dueDate', s.due_date,
    'rounding', s.rounding, 'total', s.total, 'paid', s.paid, 'balance', greatest(s.total - s.paid, 0),
    'payments', s.payments, 'pointsEarned', s.points_earned, 'pointsUsed', s.points_used, 'note', s.note, 'voidReason', s.void_reason, 'offline', s.offline, 'coupon', s.coupon,
    'staffId', s.staff_id, 'sellerGstin', (select st2.gstin from sty_settings st2 where st2.tenant_id = tid),
    'staff', (select coalesce(nullif(p.name, ''), p.email) from profiles p where p.id = s.staff_id),
    'customer', (select jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'points', c.points, 'credit', c.credit, 'gstin', c.gstin, 'address', c.address) from sty_customers c where c.id = s.customer_id),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'variantId', l.variant_id, 'styleId', l.style_id, 'name', l.style_name, 'category', l.category, 'brand', l.brand,
        'colour', l.colour, 'size', l.size, 'barcode', l.barcode, 'qty', l.qty, 'mrp', l.mrp, 'price', l.price, 'disc', l.disc, 'taxPct', l.tax_pct, 'tax', l.tax, 'net', l.net, 'hsn', l.hsn,
        'cgst', l.cgst, 'sgst', l.sgst, 'igst', l.igst, 'returned', l.returned) order by l.id) from sty_sale_lines l where l.sale_id = s.id), '[]'::jsonb),
    'returns', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'at', r.at, 'mode', r.mode, 'refund', r.refund, 'reason', r.reason)) from sty_returns r where r.sale_id = s.id), '[]'::jsonb))
  from sty_sales s where s.id = sid and s.tenant_id = tid
$$;

-- GST filing summary: taxable value + CGST/SGST/IGST collected, grouped by tax rate, over a date range --
-- what an owner hands their accountant, or uses to fill GSTR-1, without this app doing any real filing itself
-- (same "working papers, not a filing system" discipline the Accounting app's own GST reports already follow).
create or replace function sty_gst_summary(p jsonb) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'byRate', coalesce((select jsonb_agg(jsonb_build_object('rate', rate, 'taxable', taxable, 'cgst', cgst, 'sgst', sgst, 'igst', igst, 'tax', cgst + sgst + igst) order by rate) from (
      select l.tax_pct rate, round(sum(l.net - l.tax), 2) taxable, round(sum(l.cgst), 2) cgst, round(sum(l.sgst), 2) sgst, round(sum(l.igst), 2) igst
      from sty_sale_lines l join sty_sales s on s.id = l.sale_id
      where s.tenant_id = sty_guard('sty_view') and s.status <> 'void'
        and s.at >= coalesce(nullif(p->>'from', '')::date, current_date - 30) and s.at < coalesce(nullif(p->>'to', '')::date, current_date + 1) + 1
      group by l.tax_pct) r), '[]'::jsonb),
    'totals', (select jsonb_build_object('taxable', round(coalesce(sum(s.total - s.tax - s.rounding), 0), 2), 'cgst', round(coalesce(sum(s.cgst), 0), 2),
        'sgst', round(coalesce(sum(s.sgst), 0), 2), 'igst', round(coalesce(sum(s.igst), 0), 2), 'tax', round(coalesce(sum(s.tax), 0), 2), 'bills', count(*))
      from sty_sales s where s.tenant_id = sty_guard('sty_view') and s.status <> 'void'
        and s.at >= coalesce(nullif(p->>'from', '')::date, current_date - 30) and s.at < coalesce(nullif(p->>'to', '')::date, current_date + 1) + 1))
$$;

-- ---------- purchases: a formal GST bill, not just a cost receipt ----------
-- Replaces sty_receive (db/215): same body, plus an optional per-line taxPct (if omitted, 0 -- the behaviour is
-- then byte-for-byte what it always was: unitCost is the whole amount, no tax tracked, total unchanged). When a
-- rate IS given, tax is computed ON TOP of unitCost*qty (a supplier invoice's taxable value), split CGST+SGST
-- or IGST the same way sales are, and folded into the purchase's total -- what you actually owe the supplier.
create or replace function sty_receive(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; pid uuid; b uuid; ln jsonb; total numeric := 0; taxable numeric := 0; held int; oldc numeric; q int; uc numeric; paidv numeric; st text;
  tp numeric; line_taxable numeric; line_tax numeric; shop_state text; sup_state text; interstate boolean; cg numeric; sg numeric; ig numeric;
  cgsum numeric := 0; sgsum numeric := 0; igsum numeric := 0; st_gstin text;
begin
  tid := sty_guard('sty_purchase');
  pid := (p->>'id')::uuid;
  if exists (select 1 from sty_purchases where id = pid and tenant_id = tid) then return jsonb_build_object('ok', true, 'duplicate', true, 'id', pid); end if;
  if jsonb_array_length(coalesce(p->'lines', '[]'::jsonb)) = 0 then raise exception 'Add at least one item' using errcode = 'ST004'; end if;
  b := coalesce(nullif(p->>'branchId', '')::uuid, sty_main_branch(tid));
  select gstin into st_gstin from sty_settings where tenant_id = tid;
  shop_state := left(st_gstin, 2);
  select left(gstin, 2) into sup_state from sty_suppliers where id = nullif(p->>'supplierId', '')::uuid and tenant_id = tid;
  interstate := shop_state is not null and sup_state is not null and sup_state <> shop_state;
  for ln in select * from jsonb_array_elements(p->'lines') loop
    line_taxable := (ln->>'qty')::int * coalesce((ln->>'unitCost')::numeric, 0);
    tp := coalesce((ln->>'taxPct')::numeric, 0);
    line_tax := round(line_taxable * tp / 100, 2);
    taxable := taxable + line_taxable;
    if interstate then ig := line_tax; cg := 0; sg := 0; else cg := round(line_tax / 2, 2); sg := line_tax - cg; ig := 0; end if;
    cgsum := cgsum + cg; sgsum := sgsum + sg; igsum := igsum + ig;
    total := total + line_taxable + line_tax;
  end loop;
  paidv := least(coalesce(nullif(p->>'paid', '')::numeric, 0), total);
  st := case when paidv >= total then 'paid' when paidv > 0 then 'part' else 'unpaid' end;
  insert into sty_purchases (id, tenant_id, supplier_id, branch_id, invoice_no, at, taxable_value, cgst, sgst, igst, place_of_supply, total, paid, status, note, staff_id)
  values (pid, tid, nullif(p->>'supplierId', '')::uuid, b, p->>'invoiceNo', coalesce(nullif(p->>'at', '')::timestamptz, now()), taxable, cgsum, sgsum, igsum, coalesce(sup_state, shop_state), total, paidv, st, p->>'note', app_uid());
  for ln in select * from jsonb_array_elements(p->'lines') loop
    q := (ln->>'qty')::int; uc := coalesce((ln->>'unitCost')::numeric, 0); tp := coalesce((ln->>'taxPct')::numeric, 0);
    if q <= 0 then raise exception 'Quantity must be above zero'; end if;
    line_taxable := q * uc; line_tax := round(line_taxable * tp / 100, 2);
    select coalesce(sum(qty), 0)::int into held from sty_stock_moves where tenant_id = tid and variant_id = (ln->>'variantId')::uuid;
    select cost into oldc from sty_variants where id = (ln->>'variantId')::uuid and tenant_id = tid;
    if oldc is null then raise exception 'variant not found'; end if;
    insert into sty_purchase_lines (tenant_id, purchase_id, variant_id, qty, unit_cost, hsn, tax_pct, tax)
    values (tid, pid, (ln->>'variantId')::uuid, q, uc, ln->>'hsn', tp, line_tax);
    insert into sty_stock_moves (tenant_id, branch_id, variant_id, qty, kind, ref_type, ref_id, unit_cost, staff_id)
    values (tid, b, (ln->>'variantId')::uuid, q, 'purchase', 'purchase', pid, uc, app_uid());
    update sty_variants set cost = round((greatest(held, 0) * oldc + q * uc) / (greatest(held, 0) + q), 2) where id = (ln->>'variantId')::uuid;
  end loop;
  if paidv > 0 and nullif(p->>'supplierId', '') is not null then
    insert into sty_supplier_payments (tenant_id, supplier_id, purchase_id, amount, mode, staff_id, note)
    values (tid, (p->>'supplierId')::uuid, pid, paidv, coalesce(p->>'payMode', 'cash'), app_uid(), 'Paid on receiving');
  end if;
  perform sty_audit_log(tid, 'purchase', pid::text, jsonb_build_object('total', total));
  return jsonb_build_object('ok', true, 'id', pid, 'total', total);
end $$;

-- A single purchase bill with its GST breakup and lines -- the printable "GST purchase invoice" record.
create or replace function sty_purchase_detail(p_id uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', pu.id, 'invoiceNo', pu.invoice_no, 'at', pu.at, 'taxableValue', pu.taxable_value, 'cgst', pu.cgst, 'sgst', pu.sgst, 'igst', pu.igst,
    'placeOfSupply', pu.place_of_supply, 'total', pu.total, 'paid', pu.paid, 'status', pu.status, 'note', pu.note,
    'buyerGstin', (select st.gstin from sty_settings st where st.tenant_id = sty_guard('sty_purchase')),
    'supplier', (select jsonb_build_object('id', su.id, 'name', su.name, 'gstin', su.gstin, 'phone', su.phone) from sty_suppliers su where su.id = pu.supplier_id),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('variantId', l.variant_id, 'qty', l.qty, 'unitCost', l.unit_cost, 'hsn', l.hsn, 'taxPct', l.tax_pct, 'tax', l.tax,
        'styleName', (select s.name from sty_variants v join sty_styles s on s.id = v.style_id where v.id = l.variant_id), 'colour', (select v.colour from sty_variants v where v.id = l.variant_id),
        'size', (select v.size from sty_variants v where v.id = l.variant_id)) order by l.id) from sty_purchase_lines l where l.purchase_id = pu.id), '[]'::jsonb))
  from sty_purchases pu where pu.id = p_id and pu.tenant_id = sty_guard('sty_purchase')
$$;

-- Purchase register / ITC report: every purchase bill in a date range with its GST breakup -- what you'd claim
-- back as input tax credit when filing, the mirror of sty_gst_summary on the sales side.
create or replace function sty_purchase_register(p jsonb) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'bills', coalesce((select jsonb_agg(jsonb_build_object('id', pu.id, 'invoiceNo', pu.invoice_no, 'at', pu.at, 'supplier', su.name, 'taxableValue', pu.taxable_value,
        'cgst', pu.cgst, 'sgst', pu.sgst, 'igst', pu.igst, 'total', pu.total, 'status', pu.status) order by pu.at desc)
      from sty_purchases pu left join sty_suppliers su on su.id = pu.supplier_id
      where pu.tenant_id = sty_guard('sty_purchase')
        and pu.at >= coalesce(nullif(p->>'from', '')::date, current_date - 30) and pu.at < coalesce(nullif(p->>'to', '')::date, current_date + 1) + 1), '[]'::jsonb),
    'totals', (select jsonb_build_object('taxable', round(coalesce(sum(pu.taxable_value), 0), 2), 'cgst', round(coalesce(sum(pu.cgst), 0), 2),
        'sgst', round(coalesce(sum(pu.sgst), 0), 2), 'igst', round(coalesce(sum(pu.igst), 0), 2),
        'itc', round(coalesce(sum(pu.cgst + pu.sgst + pu.igst), 0), 2), 'bills', count(*))
      from sty_purchases pu where pu.tenant_id = sty_guard('sty_purchase')
        and pu.at >= coalesce(nullif(p->>'from', '')::date, current_date - 30) and pu.at < coalesce(nullif(p->>'to', '')::date, current_date + 1) + 1))
$$;

-- ---------- customer ledger: dues now carry a due date, and a party statement shows every bill, not just 8 ----------
-- Replaces sty_customer_detail (db/306): same body, 'bills' now includes status/balance/dueDate per bill and is
-- no longer capped at 8 -- a real statement, not a recent-activity preview, is the point of a party ledger.
create or replace function sty_customer_detail(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; row_ record;
begin
  tid := sty_guard('sty_view');
  select * into row_ from sty_crm_rows(tid) r where r.id = p_id;
  if not found then raise exception 'customer not found' using errcode = 'ST002'; end if;
  return jsonb_build_object(
    'id', row_.id, 'name', row_.name, 'phone', row_.phone, 'usualSize', row_.usual_size, 'gstin', (select c.gstin from sty_customers c where c.id = row_.id), 'address', (select c.address from sty_customers c where c.id = row_.id), 'birthday', row_.birthday, 'anniversary', row_.anniversary, 'notes', row_.notes,
    'gender', row_.gender, 'city', row_.city, 'waOptin', row_.wa_optin, 'points', row_.points, 'credit', row_.credit, 'visits', row_.visits, 'spent', row_.spent,
    'lastAt', row_.last_at, 'tier', row_.tier, 'status', row_.status,
    'avgBill', case when row_.visits > 0 then round(row_.spent / row_.visits, 2) else 0 end,
    'due', coalesce((select sum(total - paid) from sty_sales where customer_id = p_id and tenant_id = tid and status = 'due'), 0),
    'bills', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'number', number, 'at', at, 'total', total, 'paid', paid, 'balance', greatest(total - paid, 0), 'dueDate', due_date, 'status', status) order by at desc)
        from (select * from sty_sales where customer_id = p_id and tenant_id = tid order by at desc limit 60) b), '[]'::jsonb),
    'likes', coalesce((select jsonb_agg(jsonb_build_object('name', n, 'qty', q) order by q desc) from (
        select l.style_name n, sum(l.qty) q from sty_sale_lines l join sty_sales s on s.id = l.sale_id where s.customer_id = p_id and s.tenant_id = tid and s.status <> 'void' group by l.style_name order by 2 desc limit 4) z), '[]'::jsonb),
    'sizes', coalesce((select jsonb_agg(jsonb_build_object('name', n, 'qty', q) order by q desc) from (
        select l.size n, sum(l.qty) q from sty_sale_lines l join sty_sales s on s.id = l.sale_id where s.customer_id = p_id and s.tenant_id = tid and s.status <> 'void' and l.size is not null group by l.size order by 2 desc limit 3) z), '[]'::jsonb),
    'colours', coalesce((select jsonb_agg(jsonb_build_object('name', n, 'qty', q) order by q desc) from (
        select l.colour n, sum(l.qty) q from sty_sale_lines l join sty_sales s on s.id = l.sale_id where s.customer_id = p_id and s.tenant_id = tid and s.status <> 'void' and l.colour is not null group by l.colour order by 2 desc limit 3) z), '[]'::jsonb),
    'messages', coalesce((select jsonb_agg(jsonb_build_object('template', template, 'status', status, 'at', created_at) order by created_at desc) from (
        select o.template, o.status, o.created_at from wa_outbox o where o.tenant_id = tid and o.to_phone = wa_norm_phone(row_.phone) order by o.created_at desc limit 6) m), '[]'::jsonb));
end $$;

-- Dues across every customer, with due dates -- the "who owes me what, and since when" list an owner actually
-- works from, instead of opening each customer one at a time. Mirrors the Accounting app's ageing report, scoped
-- to what a clothing retailer's credit sales actually need (no invoice-vs-payment matching, just the balance).
create or replace function sty_dues_list(p jsonb) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('customerId', c.id, 'name', c.name, 'phone', c.phone, 'billId', s.id, 'number', s.number, 'at', s.at,
      'total', s.total, 'paid', s.paid, 'balance', s.total - s.paid, 'dueDate', s.due_date,
      'overdue', s.due_date is not null and s.due_date < current_date) order by coalesce(s.due_date, s.at::date)), '[]'::jsonb)
  from sty_sales s join sty_customers c on c.id = s.customer_id
  where s.tenant_id = sty_guard('sty_view') and s.status = 'due'
$$;
