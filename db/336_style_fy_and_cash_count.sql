-- AUZsStyle: financial-year numbering (ported from the Accounting app's acc_fy) and a denomination counter
-- at the point of a cash sale (the shift-close drawer count already had one -- CLAUDE.md's "Cash payment has
-- one-tap Exact / round-note buttons above the denomination counter" describes the POS; AUZsStyle's Sell page
-- never had this, only the end-of-shift drawer count). Owner request, directly comparing both to the Ledger
-- (Accounting) app and the existing POS.
--
-- Financial year: unlike Accounting's acc_fy, this does not lock postings or gate GST filing periods -- a
-- clothing retailer's FY here is purely a numbering convention (bills restart "PREFIX/2026-27/00001" each
-- year, like the owner's physical bill books always did) plus a closable status so the Settings list matches
-- what the owner is used to seeing in Ledger. A closed FY still refuses new bills dated inside it (same
-- discipline as the existing day-close date), but there is no separate books-lock date, no GST-period lock --
-- that machinery belongs to the double-entry Accounting app, not a retail POS.

-- ---------- schema ----------
alter table sty_settings add column if not exists fy_start_month smallint not null default 4; -- April, the Indian FY default; editable in Settings

create table if not exists sty_fy (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  label       text not null,                 -- '2026-27' (or '2026' when fy_start_month = 1)
  start_date  date not null, end_date date not null,
  status      text not null default 'open' check (status in ('open', 'closed')),
  closed_at   timestamptz,
  created_at  timestamptz not null default now(),
  check (end_date > start_date),
  unique (tenant_id, label)
);
create index if not exists sty_fy_t on sty_fy(tenant_id, start_date);
alter table sty_fy enable row level security;

alter table sty_sales add column if not exists fy_id uuid references sty_fy(id);

-- ---------- financial-year helpers ----------
create or replace function sty_fy_bounds(d date, start_month int) returns jsonb language plpgsql immutable as $$
declare fy_year int; s date; e date;
begin
  if start_month <= 1 then fy_year := extract(year from d)::int;
  else fy_year := case when extract(month from d)::int >= start_month then extract(year from d)::int else extract(year from d)::int - 1 end;
  end if;
  s := make_date(fy_year, greatest(start_month, 1), 1);
  e := (s + interval '1 year' - interval '1 day')::date;
  return jsonb_build_object('start', s, 'end', e,
    'label', case when start_month <= 1 then fy_year::text else fy_year::text || '-' || right((fy_year + 1)::text, 2) end);
end $$;

-- Finds the FY covering date d, auto-creating it the first time a sale actually needs it (same lazy-create
-- discipline as sty_main_branch/sty_context's settings row) -- an owner never has to set this up by hand first.
-- Raises if that FY has been explicitly closed in Settings.
create or replace function sty_assert_fy(tid uuid, d date) returns jsonb language plpgsql security definer set search_path = public as $$
declare sm int; b jsonb; row_ sty_fy;
begin
  select fy_start_month into sm from sty_settings where tenant_id = tid;
  select * into row_ from sty_fy where tenant_id = tid and start_date <= d and end_date >= d;
  if row_.id is null then
    b := sty_fy_bounds(d, coalesce(sm, 4));
    insert into sty_fy (tenant_id, label, start_date, end_date) values (tid, b->>'label', (b->>'start')::date, (b->>'end')::date)
      on conflict (tenant_id, label) do update set label = excluded.label returning * into row_;
  end if;
  if row_.status = 'closed' then raise exception 'The financial year % is closed' , row_.label using errcode = 'ST008'; end if;
  return jsonb_build_object('id', row_.id, 'label', row_.label, 'startDate', row_.start_date, 'endDate', row_.end_date, 'status', row_.status);
end $$;

create or replace function sty_save_fy(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; s date; e date;
begin
  tid := sty_guard('sty_manage');
  s := (p->>'startDate')::date; e := (p->>'endDate')::date;
  if s is null or e is null or e <= s then raise exception 'Enter a valid date range'; end if;
  if exists (select 1 from sty_fy where tenant_id = tid and daterange(start_date, end_date, '[]') && daterange(s, e, '[]')) then
    raise exception 'That overlaps an existing financial year';
  end if;
  insert into sty_fy (tenant_id, label, start_date, end_date) values (tid, coalesce(nullif(p->>'label', ''), to_char(s, 'YYYY') || '-' || to_char(e, 'YY')), s, e);
  return sty_context();
end $$;

create or replace function sty_close_fy(p_fy uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_guard('sty_manage');
  update sty_fy set status = 'closed', closed_at = now() where id = p_fy and tenant_id = tid and status = 'open';
  if not found then raise exception 'Financial year not found or already closed'; end if;
  perform sty_audit_log(tid, 'fy_close', p_fy::text, null);
  return sty_context();
end $$;

-- ---------- settings + context: surface fy_start_month and the FY list ----------
create or replace function sty_settings_json(s sty_settings) returns jsonb language sql immutable as $$
  select jsonb_build_object('shopName', s.shop_name, 'address', s.address, 'phone', s.phone, 'gstin', s.gstin, 'logoUrl', s.logo_url,
    'billFooter', s.bill_footer, 'billPrefix', s.bill_prefix, 'language', s.language, 'allowNegativeStock', s.allow_negative_stock,
    'maxDiscountPct', s.max_discount_pct, 'returnDays', s.return_days, 'loyaltyEarnPct', s.loyalty_earn_pct,
    'loyaltyPointValue', s.loyalty_point_value, 'roundOff', s.round_off, 'defaultTaxPct', s.default_tax_pct,
    'taxSlabs', s.tax_slabs, 'priceIncludesTax', s.price_includes_tax, 'leadDays', s.lead_days, 'coverDays', s.cover_days,
    'slowDays', s.slow_days, 'requireCustomerPhone', s.require_customer_phone, 'staffSeeCost', s.staff_see_cost,
    'dayCloseDate', s.day_close_date, 'features', s.features, 'fyStartMonth', s.fy_start_month)
$$;

create or replace function sty_context() returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; s sty_settings; lang text; t_name text; role_ text;
begin
  tid := sty_tenant();
  select * into s from sty_settings where tenant_id = tid;
  if s.tenant_id is null then
    select name into t_name from tenants where id = tid;
    insert into sty_settings (tenant_id, shop_name) values (tid, t_name) on conflict (tenant_id) do nothing;
    select * into s from sty_settings where tenant_id = tid;
  end if;
  perform sty_main_branch(tid);
  role_ := me()->>'role';
  return jsonb_build_object(
    'perms', sty_perms(), 'role', role_, 'userId', app_uid(),
    'canSeeCost', role_ in ('owner', 'manager') or s.staff_see_cost,
    'settings', sty_settings_json(s),
    'branches', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'kind', kind, 'address', address, 'isMain', is_main) order by is_main desc, created_at), '[]'::jsonb)
                 from sty_branches where tenant_id = tid and active),
    'fys', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'label', label, 'startDate', start_date, 'endDate', end_date, 'status', status) order by start_date desc), '[]'::jsonb)
            from sty_fy where tenant_id = tid));
end $$;

create or replace function sty_save_settings(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_guard('sty_manage');
  perform sty_context();
  update sty_settings set
    shop_name = coalesce(p->>'shopName', shop_name), address = coalesce(p->>'address', address), phone = coalesce(p->>'phone', phone),
    gstin = coalesce(p->>'gstin', gstin), logo_url = coalesce(p->>'logoUrl', logo_url), bill_footer = coalesce(p->>'billFooter', bill_footer),
    bill_prefix = coalesce(nullif(p->>'billPrefix', ''), bill_prefix),
    language = case when p->>'language' in ('en', 'hi') then p->>'language' else language end,
    allow_negative_stock = coalesce((p->>'allowNegativeStock')::boolean, allow_negative_stock),
    max_discount_pct = coalesce((p->>'maxDiscountPct')::numeric, max_discount_pct),
    return_days = coalesce((p->>'returnDays')::int, return_days),
    loyalty_earn_pct = coalesce((p->>'loyaltyEarnPct')::numeric, loyalty_earn_pct),
    loyalty_point_value = coalesce((p->>'loyaltyPointValue')::numeric, loyalty_point_value),
    round_off = coalesce((p->>'roundOff')::boolean, round_off),
    default_tax_pct = coalesce((p->>'defaultTaxPct')::numeric, default_tax_pct),
    tax_slabs = coalesce(p->'taxSlabs', tax_slabs),
    price_includes_tax = coalesce((p->>'priceIncludesTax')::boolean, price_includes_tax),
    lead_days = coalesce((p->>'leadDays')::int, lead_days), cover_days = coalesce((p->>'coverDays')::int, cover_days),
    slow_days = coalesce((p->>'slowDays')::int, slow_days),
    require_customer_phone = coalesce((p->>'requireCustomerPhone')::boolean, require_customer_phone),
    staff_see_cost = coalesce((p->>'staffSeeCost')::boolean, staff_see_cost),
    day_close_date = case when p ? 'dayCloseDate' then nullif(p->>'dayCloseDate', '')::date else day_close_date end,
    fy_start_month = coalesce((p->>'fyStartMonth')::smallint, fy_start_month),
    features = coalesce(p->'features', features), updated_at = now()
  where tenant_id = tid;
  perform sty_audit_log(tid, 'settings', null, p);
  return sty_context();
end $$;

-- ---------- sty_sell: FY-scoped numbering ("PREFIX/2026-27/00001", resets each financial year) + a cash
-- denomination breakdown carried through onto the stored payment entry, exactly as the client counted it ----------
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
    -- a cash payment the cashier counted note-by-note carries its breakdown through onto the stored entry,
    -- purely for the cashier's own reference (the printed tax invoice is unaffected) -- never trusted for the
    -- amount itself, which is still the plain 'amount' field capped like every other payment mode below.
    extra := case when pm = 'cash' and e ? 'denoms' then jsonb_build_object('denoms', e->'denoms', 'tendered', e->'tendered') else '{}'::jsonb end;
    pay := pay || (jsonb_build_object('mode', pm, 'amount', amt) || extra); paid := paid + amt;
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

  -- 'seq' stays the tenant-wide, never-reused sequence sty_sales.seq's unique constraint expects (and that
  -- sty_next(tid,'sale') already produced before this migration) -- a SEPARATE counter, keyed by FY label, drives
  -- only the printed bill number below, so a new financial year's "00001" never collides with an older sale's seq.
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
