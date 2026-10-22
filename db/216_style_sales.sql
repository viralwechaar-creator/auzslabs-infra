-- =========================================================
-- AUZsStyle engine part 2: selling (one transaction: bill, lines, stock, points, credit), returns/exchange, void,
-- transfers between branches, cash shifts, trial-room holds, targets, day close.
-- =========================================================

create or replace function sty_tax_rate(st sty_settings, style_rate numeric, unit numeric) returns numeric language plpgsql immutable as $$
declare e jsonb;
begin
  if style_rate is not null then return style_rate; end if;
  if jsonb_typeof(st.tax_slabs) = 'array' then
    for e in select * from jsonb_array_elements(st.tax_slabs) loop
      if (e->>'upto') is null or unit <= (e->>'upto')::numeric then return coalesce((e->>'rate')::numeric, st.default_tax_pct); end if;
    end loop;
  end if;
  return st.default_tax_pct;
end $$;

create or replace function sty_sale_json(tid uuid, sid uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', s.id, 'number', s.number, 'seq', s.seq, 'at', s.at, 'branchId', s.branch_id, 'status', s.status,
    'subtotal', s.subtotal, 'discount', s.discount, 'tax', s.tax, 'rounding', s.rounding, 'total', s.total, 'paid', s.paid, 'balance', greatest(s.total - s.paid, 0),
    'payments', s.payments, 'pointsEarned', s.points_earned, 'pointsUsed', s.points_used, 'note', s.note, 'voidReason', s.void_reason, 'offline', s.offline,
    'staffId', s.staff_id,
    'staff', (select coalesce(nullif(p.name, ''), p.email) from profiles p where p.id = s.staff_id),
    'customer', (select jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'points', c.points, 'credit', c.credit) from sty_customers c where c.id = s.customer_id),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'variantId', l.variant_id, 'styleId', l.style_id, 'name', l.style_name, 'category', l.category, 'brand', l.brand,
        'colour', l.colour, 'size', l.size, 'barcode', l.barcode, 'qty', l.qty, 'mrp', l.mrp, 'price', l.price, 'disc', l.disc, 'taxPct', l.tax_pct, 'tax', l.tax, 'net', l.net,
        'returned', l.returned) order by l.id) from sty_sale_lines l where l.sale_id = s.id), '[]'::jsonb),
    'returns', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'at', r.at, 'mode', r.mode, 'refund', r.refund, 'reason', r.reason)) from sty_returns r where r.sale_id = s.id), '[]'::jsonb))
  from sty_sales s where s.id = sid and s.tenant_id = tid
$$;

-- p: {id (client uuid), branchId?, customerId?, at?, offline?, note,
--     lines:[{variantId, qty, price? (manager only), discPct?, discAmt?}],
--     billDiscPct?, billDiscAmt?, redeemPoints?,
--     payments:[{mode: cash|upi|card|credit|exchange|due, amount}]}
create or replace function sty_sell(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  tid uuid; sid uuid; st sty_settings; b uuid; cust sty_customers; L jsonb := '[]'::jsonb; e jsonb; i int; v record;
  q int; unit numeric; gross numeric; ld numeric; after_ numeric; sub numeric := 0; ldisc numeric := 0; bdisc numeric := 0; share numeric;
  tot_after numeric := 0; rate numeric; net numeric; tx numeric; tot numeric := 0; taxsum numeric := 0; rnd numeric := 0; stock int;
  pts int := 0; ptsval numeric := 0; pay jsonb := '[]'::jsonb; paid numeric := 0; chg numeric; credit_used numeric := 0; pm text; amt numeric;
  seq_ bigint; num text; earn int := 0; at_ timestamptz; disc_pct numeric; stat text; qty_in_cart jsonb := '{}'::jsonb; cur_q int;
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
  bdisc := round(least(greatest(bdisc, 0), tot_after), 2);
  disc_pct := case when sub > 0 then (ldisc + bdisc) / sub * 100 else 0 end;
  if disc_pct > st.max_discount_pct + 0.001 and not sty_perm('sty_manage') then
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

  -- payments
  if cust.id is not null and coalesce((p->>'redeemPoints')::int, 0) > 0 then
    pts := least((p->>'redeemPoints')::int, cust.points);
    ptsval := least(round(pts * st.loyalty_point_value, 2), tot);
    pts := ceil(ptsval / nullif(st.loyalty_point_value, 0))::int;
    if ptsval > 0 then pay := pay || jsonb_build_object('mode', 'points', 'amount', ptsval); paid := paid + ptsval; end if;
  end if;
  for e in select * from jsonb_array_elements(coalesce(p->'payments', '[]'::jsonb)) loop
    pm := e->>'mode'; amt := coalesce((e->>'amount')::numeric, 0);
    continue when amt <= 0 or pm = 'due';
    if pm = 'credit' then
      if cust.id is null then raise exception 'Pick the customer to use store credit'; end if;
      amt := least(amt, cust.credit); credit_used := credit_used + amt;
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
    points_earned, points_used, note, offline)
  values (sid, tid, seq_, num, b, cust.id, app_uid(), at_, sub, ldisc + bdisc, taxsum, rnd, tot, paid, stat, pay, earn, pts, p->>'note', coalesce((p->>'offline')::boolean, false));
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
  if p ? 'holdId' and nullif(p->>'holdId', '') is not null then update sty_holds set status = 'closed' where id = (p->>'holdId')::uuid and tenant_id = tid; end if;
  return sty_sale_json(tid, sid);
end $$;

create or replace function sty_get_sale(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin tid := sty_guard('sty_view'); return sty_sale_json(tid, p_id); end $$;

-- find a bill by its number (for returns at the counter)
create or replace function sty_find_sale(p_number text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; sid uuid;
begin
  tid := sty_guard('sty_view');
  select id into sid from sty_sales where tenant_id = tid and (upper(number) = upper(trim(p_number)) or upper(number) like '%' || upper(trim(p_number))) order by at desc limit 1;
  if sid is null then return null; end if;
  return sty_sale_json(tid, sid);
end $$;

-- p: {from?, to?, q?, customerId?, status?, limit?}
create or replace function sty_list_sales(p jsonb default '{}'::jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; mine boolean;
begin
  tid := sty_guard('sty_view');
  mine := not sty_perm('sty_reports');                      -- plain staff see only their own bills
  return coalesce((select jsonb_agg(x) from (
    select jsonb_build_object('id', s.id, 'number', s.number, 'at', s.at, 'total', s.total, 'paid', s.paid, 'status', s.status, 'discount', s.discount,
      'customer', c.name, 'customerId', s.customer_id, 'branchId', s.branch_id, 'units', (select coalesce(sum(qty), 0) from sty_sale_lines where sale_id = s.id),
      'staff', (select coalesce(nullif(pr.name, ''), pr.email) from profiles pr where pr.id = s.staff_id), 'payments', s.payments) x
    from sty_sales s left join sty_customers c on c.id = s.customer_id
    where s.tenant_id = tid and (not mine or s.staff_id = app_uid())
      and (nullif(p->>'from', '') is null or s.at >= (p->>'from')::date)
      and (nullif(p->>'to', '') is null or s.at < (p->>'to')::date + 1)
      and (nullif(p->>'customerId', '') is null or s.customer_id = (p->>'customerId')::uuid)
      and (nullif(p->>'status', '') is null or s.status = p->>'status')
      and (nullif(p->>'q', '') is null or s.number ilike '%' || (p->>'q') || '%' or c.name ilike '%' || (p->>'q') || '%' or c.phone like '%' || (p->>'q') || '%')
    order by s.at desc limit coalesce(nullif(p->>'limit', '')::int, 100)) q), '[]'::jsonb);
end $$;

create or replace function sty_void_sale(p_id uuid, p_reason text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; s sty_sales; l record; credit_back numeric := 0;
begin
  tid := sty_guard('sty_manage');
  select * into s from sty_sales where id = p_id and tenant_id = tid for update;
  if s.id is null then raise exception 'bill not found'; end if;
  if s.status = 'void' then return sty_sale_json(tid, p_id); end if;
  if exists (select 1 from sty_returns where sale_id = p_id) then raise exception 'This bill has returns; it cannot be cancelled' using errcode = 'ST008'; end if;
  for l in select * from sty_sale_lines where sale_id = p_id loop
    insert into sty_stock_moves (tenant_id, branch_id, variant_id, qty, kind, ref_type, ref_id, unit_cost, staff_id, note)
    values (tid, s.branch_id, l.variant_id, l.qty, 'void', 'sale', p_id, l.cost, app_uid(), 'Bill cancelled');
  end loop;
  if s.customer_id is not null then
    update sty_customers set points = greatest(points + s.points_used - s.points_earned, 0) where id = s.customer_id;
  end if;
  update sty_sales set status = 'void', void_reason = p_reason, voided_at = now(), voided_by = app_uid() where id = p_id;
  perform sty_audit_log(tid, 'void_sale', p_id::text, jsonb_build_object('number', s.number, 'reason', p_reason, 'total', s.total));
  return sty_sale_json(tid, p_id);
end $$;

-- p: {id (client uuid), saleId, mode: cash|upi|card|credit_note|exchange, reason, exchangeSaleId?, lines:[{saleLineId, qty, damaged?}]}
create or replace function sty_return(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; rid uuid; s sty_sales; st sty_settings; e jsonb; sl sty_sale_lines; q int; amt numeric; refund numeric := 0; mode_ text; dmg boolean; clawback int;
begin
  tid := sty_guard('sty_sell');
  rid := (p->>'id')::uuid;
  if exists (select 1 from sty_returns where id = rid and tenant_id = tid) then return sty_sale_json(tid, (select sale_id from sty_returns where id = rid)) || jsonb_build_object('duplicate', true); end if;
  select * into s from sty_sales where id = (p->>'saleId')::uuid and tenant_id = tid for update;
  if s.id is null then raise exception 'bill not found'; end if;
  if s.status = 'void' then raise exception 'That bill was cancelled'; end if;
  select * into st from sty_settings where tenant_id = tid;
  if now() - s.at > make_interval(days => st.return_days) and not sty_perm('sty_manage') then
    raise exception 'Returns after % days need a manager', st.return_days using errcode = 'ST005';
  end if;
  mode_ := coalesce(p->>'mode', 'cash');
  if mode_ = 'credit_note' and s.customer_id is null then raise exception 'Pick the customer first to give store credit' using errcode = 'ST007'; end if;
  if jsonb_array_length(coalesce(p->'lines', '[]'::jsonb)) = 0 then raise exception 'Pick what is coming back' using errcode = 'ST004'; end if;
  insert into sty_returns (id, tenant_id, sale_id, branch_id, customer_id, staff_id, mode, reason, refund, exchange_sale_id)
  values (rid, tid, s.id, s.branch_id, s.customer_id, app_uid(), mode_, p->>'reason', 0, nullif(p->>'exchangeSaleId', '')::uuid);
  for e in select * from jsonb_array_elements(p->'lines') loop
    select * into sl from sty_sale_lines where id = (e->>'saleLineId')::uuid and sale_id = s.id for update;
    if sl.id is null then raise exception 'line not on this bill'; end if;
    q := (e->>'qty')::int; dmg := coalesce((e->>'damaged')::boolean, false);
    if q is null or q <= 0 or q > sl.qty - sl.returned then raise exception '% : only % can come back', sl.style_name, sl.qty - sl.returned using errcode = 'ST009'; end if;
    amt := round(sl.net / sl.qty * q, 2); refund := refund + amt;
    update sty_sale_lines set returned = returned + q where id = sl.id;
    insert into sty_return_lines (tenant_id, return_id, sale_line_id, variant_id, qty, amount, damaged) values (tid, rid, sl.id, sl.variant_id, q, amt, dmg);
    insert into sty_stock_moves (tenant_id, branch_id, variant_id, qty, dmg, kind, ref_type, ref_id, unit_cost, staff_id, note)
    values (tid, s.branch_id, sl.variant_id, case when dmg then 0 else q end, case when dmg then q else 0 end, case when mode_ = 'exchange' then 'exchange_in' else 'return' end,
      'return', rid, sl.cost, app_uid(), p->>'reason');
  end loop;
  update sty_returns r set refund = (select coalesce(sum(amount), 0) from sty_return_lines where return_id = rid) where r.id = rid;
  if s.customer_id is not null then
    clawback := floor(s.points_earned * refund / nullif(s.total, 0))::int;
    update sty_customers set points = greatest(points - coalesce(clawback, 0), 0),
      credit = credit + case when mode_ = 'credit_note' then refund else 0 end where id = s.customer_id;
  end if;
  perform sty_audit_log(tid, 'return', rid::text, jsonb_build_object('sale', s.number, 'refund', refund, 'mode', mode_));
  return sty_sale_json(tid, s.id);
end $$;

-- ---------- transfers ----------
create or replace function sty_transfer(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; tr uuid; e jsonb; seq_ bigint; st sty_settings; stock int;
begin
  tid := sty_guard('sty_stock');
  tr := (p->>'id')::uuid;
  if exists (select 1 from sty_transfers where id = tr and tenant_id = tid) then return sty_list_transfers(); end if;
  if (p->>'fromBranch') = (p->>'toBranch') then raise exception 'Pick two different branches'; end if;
  select * into st from sty_settings where tenant_id = tid;
  seq_ := sty_next(tid, 'transfer');
  insert into sty_transfers (id, tenant_id, number, from_branch, to_branch, note, created_by)
  values (tr, tid, 'TR-' || lpad(seq_::text, 4, '0'), (p->>'fromBranch')::uuid, (p->>'toBranch')::uuid, p->>'note', app_uid());
  for e in select * from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) loop
    stock := sty_stock_of(tid, (e->>'variantId')::uuid, (p->>'fromBranch')::uuid);
    if (e->>'qty')::int > stock and not st.allow_negative_stock then raise exception 'Only % in stock at the sending branch', stock using errcode = 'ST003'; end if;
    insert into sty_transfer_lines (tenant_id, transfer_id, variant_id, qty) values (tid, tr, (e->>'variantId')::uuid, (e->>'qty')::int);
    insert into sty_stock_moves (tenant_id, branch_id, variant_id, qty, kind, ref_type, ref_id, staff_id)
    values (tid, (p->>'fromBranch')::uuid, (e->>'variantId')::uuid, -(e->>'qty')::int, 'transfer_out', 'transfer', tr, app_uid());
  end loop;
  if not exists (select 1 from sty_transfer_lines where transfer_id = tr) then raise exception 'Add at least one item' using errcode = 'ST004'; end if;
  return sty_list_transfers();
end $$;

create or replace function sty_receive_transfer(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; t sty_transfers; l record;
begin
  tid := sty_guard('sty_stock');
  select * into t from sty_transfers where id = p_id and tenant_id = tid for update;
  if t.id is null or t.status <> 'in_transit' then raise exception 'That transfer is not waiting to be received'; end if;
  for l in select * from sty_transfer_lines where transfer_id = p_id loop
    insert into sty_stock_moves (tenant_id, branch_id, variant_id, qty, kind, ref_type, ref_id, staff_id) values (tid, t.to_branch, l.variant_id, l.qty, 'transfer_in', 'transfer', p_id, app_uid());
  end loop;
  update sty_transfers set status = 'received', received_by = app_uid(), received_at = now() where id = p_id;
  return sty_list_transfers();
end $$;

create or replace function sty_cancel_transfer(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; t sty_transfers; l record;
begin
  tid := sty_guard('sty_stock');
  select * into t from sty_transfers where id = p_id and tenant_id = tid for update;
  if t.id is null or t.status <> 'in_transit' then raise exception 'That transfer cannot be cancelled'; end if;
  for l in select * from sty_transfer_lines where transfer_id = p_id loop
    insert into sty_stock_moves (tenant_id, branch_id, variant_id, qty, kind, ref_type, ref_id, staff_id, note) values (tid, t.from_branch, l.variant_id, l.qty, 'transfer_in', 'transfer', p_id, app_uid(), 'Transfer cancelled');
  end loop;
  update sty_transfers set status = 'cancelled' where id = p_id;
  return sty_list_transfers();
end $$;

create or replace function sty_list_transfers() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_guard('sty_view');
  return coalesce((select jsonb_agg(x order by (x->>'at') desc) from (
    select jsonb_build_object('id', t.id, 'number', t.number, 'status', t.status, 'at', t.at, 'fromBranch', t.from_branch, 'toBranch', t.to_branch, 'note', t.note,
      'units', (select coalesce(sum(qty), 0) from sty_transfer_lines where transfer_id = t.id),
      'lines', (select coalesce(jsonb_agg(jsonb_build_object('variantId', l.variant_id, 'style', s.name, 'colour', v.colour, 'size', v.size, 'qty', l.qty)), '[]'::jsonb)
                from sty_transfer_lines l join sty_variants v on v.id = l.variant_id join sty_styles s on s.id = v.style_id where l.transfer_id = t.id)) x
    from sty_transfers t where t.tenant_id = tid order by t.at desc limit 60) q), '[]'::jsonb);
end $$;

-- ---------- cash shifts ----------
create or replace function sty_shift_current(p_branch uuid default null) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; sh sty_shifts; cash numeric;
begin
  tid := sty_guard('sty_view');
  select * into sh from sty_shifts where tenant_id = tid and user_id = app_uid() and ended_at is null order by started_at desc limit 1;
  if sh.id is null then return null; end if;
  select coalesce(sum((e->>'amount')::numeric), 0) into cash from sty_sales s, jsonb_array_elements(s.payments) e
    where s.tenant_id = tid and s.branch_id = sh.branch_id and s.at >= sh.started_at and s.status <> 'void' and e->>'mode' = 'cash';
  return jsonb_build_object('id', sh.id, 'branchId', sh.branch_id, 'startedAt', sh.started_at, 'openingCash', sh.opening_cash, 'cashSales', cash, 'expectedCash', sh.opening_cash + cash);
end $$;

create or replace function sty_shift_open(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; b uuid;
begin
  tid := sty_guard('sty_sell');
  b := coalesce(nullif(p->>'branchId', '')::uuid, sty_main_branch(tid));
  if exists (select 1 from sty_shifts where tenant_id = tid and user_id = app_uid() and ended_at is null) then return sty_shift_current(b); end if;
  insert into sty_shifts (tenant_id, branch_id, user_id, opening_cash) values (tid, b, app_uid(), coalesce(nullif(p->>'openingCash', '')::numeric, 0));
  return sty_shift_current(b);
end $$;

create or replace function sty_shift_close(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; cur jsonb; sid uuid;
begin
  tid := sty_guard('sty_sell');
  cur := sty_shift_current();
  if cur is null then raise exception 'No shift is open'; end if;
  sid := (cur->>'id')::uuid;
  update sty_shifts set ended_at = now(), expected_cash = (cur->>'expectedCash')::numeric, counted_cash = nullif(p->>'countedCash', '')::numeric, note = p->>'note' where id = sid;
  return jsonb_build_object('ok', true, 'expectedCash', cur->'expectedCash', 'countedCash', nullif(p->>'countedCash', '')::numeric,
    'difference', coalesce(nullif(p->>'countedCash', '')::numeric, 0) - (cur->>'expectedCash')::numeric);
end $$;

create or replace function sty_list_shifts(p_limit int default 40) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_guard('sty_reports');
  return coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'branchId', h.branch_id, 'staff', (select coalesce(nullif(p.name, ''), p.email) from profiles p where p.id = h.user_id),
      'startedAt', h.started_at, 'endedAt', h.ended_at, 'opening', h.opening_cash, 'expected', h.expected_cash, 'counted', h.counted_cash,
      'difference', case when h.counted_cash is not null then h.counted_cash - h.expected_cash end) order by h.started_at desc)
    from (select * from sty_shifts where tenant_id = tid order by started_at desc limit p_limit) h), '[]'::jsonb);
end $$;

-- ---------- trial-room holds ----------
create or replace function sty_hold_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_guard('sty_sell');
  insert into sty_holds (id, tenant_id, branch_id, label, staff_id, lines) values ((p->>'id')::uuid, tid, coalesce(nullif(p->>'branchId', '')::uuid, sty_main_branch(tid)), p->>'label', app_uid(), coalesce(p->'lines', '[]'::jsonb))
  on conflict (id) do update set label = excluded.label, lines = excluded.lines, status = 'open';
  return sty_hold_list();
end $$;

create or replace function sty_hold_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_guard('sty_sell');
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'label', label, 'lines', lines, 'at', at, 'branchId', branch_id) order by at desc) from sty_holds where tenant_id = tid and status = 'open'), '[]'::jsonb);
end $$;

create or replace function sty_hold_close(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_guard('sty_sell');
  update sty_holds set status = 'closed' where id = p_id and tenant_id = tid;
  return sty_hold_list();
end $$;

-- ---------- targets, day close ----------
create or replace function sty_set_target(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_guard('sty_manage');
  insert into sty_targets (tenant_id, user_id, month, target, commission_pct)
  values (tid, (p->>'userId')::uuid, date_trunc('month', coalesce(nullif(p->>'month', '')::date, current_date))::date, coalesce((p->>'target')::numeric, 0), coalesce((p->>'commissionPct')::numeric, 0))
  on conflict (tenant_id, user_id, month) do update set target = excluded.target, commission_pct = excluded.commission_pct;
  return jsonb_build_object('ok', true);
end $$;

create or replace function sty_day_close(p_date date) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_guard('sty_manage');
  update sty_settings set day_close_date = p_date, updated_at = now() where tenant_id = tid;
  perform sty_audit_log(tid, 'day_close', p_date::text);
  return sty_context();
end $$;

-- collect (part of) a balance left due on a bill
create or replace function sty_collect_due(p_id uuid, p_amount numeric, p_mode text default 'cash') returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; s sty_sales; amt numeric;
begin
  tid := sty_guard('sty_sell');
  select * into s from sty_sales where id = p_id and tenant_id = tid for update;
  if s.id is null or s.status = 'void' then raise exception 'bill not found'; end if;
  if p_mode not in ('cash', 'upi', 'card') then raise exception 'pick cash, UPI or card'; end if;
  amt := least(coalesce(p_amount, 0), s.total - s.paid);
  if amt <= 0 then raise exception 'nothing is due on this bill'; end if;
  update sty_sales set paid = paid + amt, payments = payments || jsonb_build_array(jsonb_build_object('mode', p_mode, 'amount', amt, 'later', true, 'at', now())),
    status = case when paid + amt >= total - 0.005 then 'paid' else 'due' end where id = p_id;
  perform sty_audit_log(tid, 'collect_due', p_id::text, jsonb_build_object('amount', amt, 'mode', p_mode));
  return sty_sale_json(tid, p_id);
end $$;
