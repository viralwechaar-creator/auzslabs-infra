-- AUZsStyle: a GST return-period tab matching the shape of the Accounting app's own GST screen (Summary /
-- Registers / Checks / Filing lock) -- scoped honestly for what a retail shop's own recorded sales/purchases can
-- actually support. sty_gst_summary and sty_purchase_register (db/335) already are the "Registers"; this adds
-- the period-level Summary (output tax, input tax credit, net payable, by tax head), basic data-quality Checks,
-- and a Filing lock so a month already filed can't have its sales/purchases changed under it later.
--
-- Deliberately NOT built: GSTR-2B match (that needs an actual GSTR-2B export from the GST portal to compare
-- against -- there is no such file to reconcile here, and faking one would be worse than not having the tab).
-- No ITC utilization/carry-forward ledger either -- "net payable" here is this period's own output tax minus
-- this period's own input credit, same working-papers discipline as sty_gst_summary's own comment: a number
-- for the accountant to start from, not a GSTR-3B calculation.

create table if not exists sty_gst_periods (
  tenant_id uuid not null references tenants(id) on delete cascade,
  year int not null, month int not null check (month between 1 and 12),
  status text not null default 'open' check (status in ('open', 'filed')),
  filed_at timestamptz, filed_by uuid,
  primary key (tenant_id, year, month)
);
alter table sty_gst_periods enable row level security;

create or replace function sty_gst_period_status(tid uuid, d date) returns text language sql stable as $$
  select coalesce((select status from sty_gst_periods where tenant_id = tid and year = extract(year from d)::int and month = extract(month from d)::int), 'open')
$$;

create or replace function sty_gst_period_summary(p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; yr int; mo int; d0 date; d1 date;
begin
  tid := sty_guard('sty_view');
  yr := coalesce((p->>'year')::int, extract(year from current_date)::int);
  mo := coalesce((p->>'month')::int, extract(month from current_date)::int);
  d0 := make_date(yr, mo, 1); d1 := (d0 + interval '1 month')::date;
  return jsonb_build_object(
    'year', yr, 'month', mo, 'status', sty_gst_period_status(tid, d0),
    'output', (select jsonb_build_object('taxable', round(coalesce(sum(total - tax - rounding), 0), 2), 'igst', round(coalesce(sum(igst), 0), 2),
        'cgst', round(coalesce(sum(cgst), 0), 2), 'sgst', round(coalesce(sum(sgst), 0), 2), 'tax', round(coalesce(sum(tax), 0), 2), 'bills', count(*))
      from sty_sales where tenant_id = tid and status <> 'void' and at >= d0 and at < d1),
    'input', (select jsonb_build_object('taxable', round(coalesce(sum(taxable_value), 0), 2), 'igst', round(coalesce(sum(igst), 0), 2),
        'cgst', round(coalesce(sum(cgst), 0), 2), 'sgst', round(coalesce(sum(sgst), 0), 2), 'tax', round(coalesce(sum(cgst + sgst + igst), 0), 2), 'bills', count(*))
      from sty_purchases where tenant_id = tid and at >= d0 and at < d1),
    'byRate', coalesce((select jsonb_agg(jsonb_build_object('rate', rate, 'taxable', taxable, 'cgst', cgst, 'sgst', sgst, 'igst', igst, 'tax', cgst + sgst + igst) order by rate) from (
        select l.tax_pct rate, round(sum(l.net - l.tax), 2) taxable, round(sum(l.cgst), 2) cgst, round(sum(l.sgst), 2) sgst, round(sum(l.igst), 2) igst
        from sty_sale_lines l join sty_sales s on s.id = l.sale_id
        where s.tenant_id = tid and s.status <> 'void' and s.at >= d0 and s.at < d1 group by l.tax_pct) r), '[]'::jsonb));
end $$;

create or replace function sty_gst_period_checks(p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; yr int; mo int; d0 date; d1 date;
begin
  tid := sty_guard('sty_view');
  yr := coalesce((p->>'year')::int, extract(year from current_date)::int);
  mo := coalesce((p->>'month')::int, extract(month from current_date)::int);
  d0 := make_date(yr, mo, 1); d1 := (d0 + interval '1 month')::date;
  return jsonb_build_object(
    'salesMissingHsn', (select count(*) from sty_sale_lines l join sty_sales s on s.id = l.sale_id where s.tenant_id = tid and s.status <> 'void' and s.at >= d0 and s.at < d1 and l.tax_pct > 0 and (l.hsn is null or l.hsn = '')),
    'purchasesMissingHsn', (select count(*) from sty_purchase_lines l join sty_purchases pu on pu.id = l.purchase_id where pu.tenant_id = tid and pu.at >= d0 and pu.at < d1 and l.tax_pct > 0 and (l.hsn is null or l.hsn = '')),
    'salesNoGstinInterstate', (select count(*) from sty_sales s where s.tenant_id = tid and s.status <> 'void' and s.at >= d0 and s.at < d1 and s.igst > 0 and
        not exists (select 1 from sty_customers c where c.id = s.customer_id and c.gstin is not null and c.gstin <> '')),
    'noShopGstin', (select (gstin is null or gstin = '') from sty_settings where tenant_id = tid));
end $$;

create or replace function sty_gst_period_file(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; yr int; mo int;
begin
  tid := sty_guard('sty_manage');
  yr := (p->>'year')::int; mo := (p->>'month')::int;
  if yr is null or mo is null then raise exception 'Pick a year and month'; end if;
  insert into sty_gst_periods (tenant_id, year, month, status, filed_at, filed_by) values (tid, yr, mo, 'filed', now(), app_uid())
    on conflict (tenant_id, year, month) do update set status = 'filed', filed_at = now(), filed_by = app_uid();
  perform sty_audit_log(tid, 'gst_period_file', yr || '-' || mo, null);
  return jsonb_build_object('ok', true);
end $$;

create or replace function sty_gst_period_reopen(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; yr int; mo int;
begin
  tid := sty_guard('sty_manage');
  yr := (p->>'year')::int; mo := (p->>'month')::int;
  update sty_gst_periods set status = 'open', filed_at = null, filed_by = null where tenant_id = tid and year = yr and month = mo;
  perform sty_audit_log(tid, 'gst_period_reopen', yr || '-' || mo, null);
  return jsonb_build_object('ok', true);
end $$;

-- Block new/changed sales and purchases dated inside a filed GST period -- same discipline as the existing
-- day-close and financial-year-close checks already in sty_sell/sty_receive.
create or replace function sty_sell(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  tid uuid; sid uuid; st sty_settings; b uuid; cust sty_customers; L jsonb := '[]'::jsonb; e jsonb; i int; v record;
  q int; unit numeric; gross numeric; ld numeric; after_ numeric; sub numeric := 0; ldisc numeric := 0; bdisc numeric := 0; share numeric;
  tot_after numeric := 0; rate numeric; net numeric; tx numeric; tot numeric := 0; taxsum numeric := 0; rnd numeric := 0; stock int;
  pts int := 0; ptsval numeric := 0; pay jsonb := '[]'::jsonb; paid numeric := 0; chg numeric; credit_used numeric := 0; pm text; amt numeric;
  seq_ bigint; num text; earn int := 0; at_ timestamptz; disc_pct numeric; stat text; qty_in_cart jsonb := '{}'::jsonb; cur_q int;
  coupon_code text; cres jsonb; coupon_disc numeric := 0;
  shop_state text; cust_state text; interstate boolean; cg numeric; sg numeric; ig numeric; cgsum numeric := 0; sgsum numeric := 0; igsum numeric := 0;
  due_dt date; fy jsonb; fy_label text; fy_id uuid; extra jsonb; fy_seq bigint;
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
  if sty_gst_period_status(tid, at_::date) = 'filed' then raise exception 'That month''s GST return is already filed; reopen it in Settings to change bills in it' using errcode = 'ST016'; end if;
  fy := sty_assert_fy(tid, at_::date); fy_label := fy->>'label'; fy_id := (fy->>'id')::uuid;
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
    extra := case when pm = 'cash' and e ? 'denoms' then jsonb_build_object('denoms', e->'denoms', 'tendered', e->'tendered', 'changeDenoms', e->'changeDenoms') else '{}'::jsonb end;
    pay := pay || (jsonb_build_object('mode', pm, 'amount', amt) || extra); paid := paid + amt;
  end loop;
  if paid > tot + 0.005 then
    chg := paid - tot;
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
  fy_seq := sty_next(tid, 'sale:' || fy_label);
  num := st.bill_prefix || '/' || fy_label || '/' || lpad(fy_seq::text, 5, '0');
  insert into sty_sales (id, tenant_id, seq, number, branch_id, customer_id, staff_id, at, subtotal, discount, tax, cgst, sgst, igst, place_of_supply, due_date, rounding, total, paid, status, payments,
    points_earned, points_used, note, offline, credit_used, coupon, fy_id)
  values (sid, tid, seq_, num, b, cust.id, app_uid(), at_, sub, ldisc + bdisc, taxsum, cgsum, sgsum, igsum, coalesce(cust_state, shop_state), due_dt, rnd, tot, paid, stat, pay, earn, pts, p->>'note', coalesce((p->>'offline')::boolean, false), credit_used,
    case when coupon_disc > 0 then coupon_code end, fy_id);
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

-- sty_receive (db/335): same filed-period refusal on the purchase side -- one added check, body otherwise
-- unchanged from db/335.
create or replace function sty_receive(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; pid uuid; b uuid; ln jsonb; total numeric := 0; taxable numeric := 0; held int; oldc numeric; q int; uc numeric; paidv numeric; st text;
  tp numeric; line_taxable numeric; line_tax numeric; shop_state text; sup_state text; interstate boolean; cg numeric; sg numeric; ig numeric;
  cgsum numeric := 0; sgsum numeric := 0; igsum numeric := 0; st_gstin text;
begin
  tid := sty_guard('sty_purchase');
  pid := (p->>'id')::uuid;
  if exists (select 1 from sty_purchases where id = pid and tenant_id = tid) then return jsonb_build_object('ok', true, 'duplicate', true, 'id', pid); end if;
  if jsonb_array_length(coalesce(p->'lines', '[]'::jsonb)) = 0 then raise exception 'Add at least one item' using errcode = 'ST004'; end if;
  if sty_gst_period_status(tid, coalesce(nullif(p->>'at', '')::timestamptz, now())::date) = 'filed' then raise exception 'That month''s GST return is already filed; reopen it in Settings to change purchases in it' using errcode = 'ST016'; end if;
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
