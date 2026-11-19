-- AUZsStyle: a fuller customer/supplier (party) form matching the Accounting app's acc_parties fields --
-- email, PAN, a billing address on suppliers too (customers already had one, db/306), credit limit and
-- payment terms (credit days) on both -- plus a real bug fix: the GST-lookup "Fetch details" button (and the
-- unrelated online-store capability toggle) have been permanently dead code since db/306/db/332, because
-- tenant_settings.caps was never actually returned to the client by sty_context() -- canGstLookup() in
-- lib.js reads S.ctx.caps, which has always been undefined, so the feature could never turn on no matter what
-- a platform admin set. Fixed by returning 'caps' from sty_context().

-- ---------- schema ----------
alter table sty_customers add column if not exists email text, add column if not exists pan text,
  add column if not exists credit_limit numeric(12,2) not null default 0, add column if not exists credit_days integer not null default 0;
alter table sty_suppliers add column if not exists address text, add column if not exists email text, add column if not exists pan text,
  add column if not exists credit_limit numeric(12,2) not null default 0, add column if not exists credit_days integer not null default 0;

-- ---------- sty_context: actually return caps ----------
create or replace function sty_context() returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; s sty_settings; lang text; t_name text; role_ text; caps_ jsonb;
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
  select coalesce(caps, '{}'::jsonb) into caps_ from tenant_settings where tenant_id = tid;
  return jsonb_build_object(
    'perms', sty_perms(), 'role', role_, 'userId', app_uid(),
    'canSeeCost', role_ in ('owner', 'manager') or s.staff_see_cost,
    'settings', sty_settings_json(s), 'caps', coalesce(caps_, '{}'::jsonb),
    'branches', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'kind', kind, 'address', address, 'isMain', is_main) order by is_main desc, created_at), '[]'::jsonb)
                 from sty_branches where tenant_id = tid and active),
    'fys', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'label', label, 'startDate', start_date, 'endDate', end_date, 'status', status) order by start_date desc), '[]'::jsonb)
            from sty_fy where tenant_id = tid));
end $$;

-- ---------- shift close: the client's denomination grid gained the ₹2000 note (to match the Accounting app's
-- own list) but this server-side validator's allow-list was never updated to match -- counting a ₹2000 note at
-- shift close would have been rejected outright ("2000 is not a real note or coin value"). Fixed. ----------
-- sty_sell (db/336): the cash-count sheet now produces a changeDenoms breakdown alongside denoms/tendered --
-- carry that through onto the stored payment entry too (same "cashier reference only, never trusted for the
-- amount" discipline as denoms/tendered already have).
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
    extra := case when pm = 'cash' and e ? 'denoms' then jsonb_build_object('denoms', e->'denoms', 'tendered', e->'tendered', 'changeDenoms', e->'changeDenoms') else '{}'::jsonb end;
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

create or replace function sty_shift_close(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; cur jsonb; sid uuid; denoms jsonb; counted numeric; valid_denoms int[] := array[2000,500,200,100,50,20,10,5,2,1]; row_ record;
begin
  tid := sty_guard('sty_sell');
  cur := sty_shift_current();
  if cur is null then raise exception 'No shift is open'; end if;
  sid := (cur->>'id')::uuid;
  denoms := p->'denominations';
  if denoms is not null and jsonb_typeof(denoms) = 'object' then
    counted := 0;
    for row_ in select * from jsonb_each_text(denoms) loop
      if not (row_.key::int = any(valid_denoms)) then raise exception '% is not a real note or coin value', row_.key using errcode = 'ST013'; end if;
      if nullif(row_.value, '')::int < 0 then raise exception 'A count cannot be negative' using errcode = 'ST014'; end if;
      counted := counted + row_.key::int * coalesce(nullif(row_.value, '')::int, 0);
    end loop;
  else
    denoms := null; counted := nullif(p->>'countedCash', '')::numeric;
  end if;
  update sty_shifts set ended_at = now(), expected_cash = (cur->>'expectedCash')::numeric, counted_cash = counted, denominations = denoms, note = p->>'note' where id = sid;
  return jsonb_build_object('ok', true, 'expectedCash', cur->'expectedCash', 'countedCash', counted,
    'difference', coalesce(counted, 0) - (cur->>'expectedCash')::numeric);
end $$;

-- ---------- customers: email, PAN, credit limit, payment terms ----------
create or replace function sty_save_customer(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; cid uuid; ph text;
begin
  tid := sty_guard('sty_sell');
  cid := nullif(p->>'id', '')::uuid; ph := nullif(regexp_replace(coalesce(p->>'phone', ''), '\D', '', 'g'), '');
  if ph is not null and length(ph) > 10 then ph := right(ph, 10); end if;
  if cid is null and ph is not null then select id into cid from sty_customers where tenant_id = tid and phone = ph; end if;
  if cid is null then
    insert into sty_customers (id, tenant_id, name, phone, usual_size, birthday, anniversary, notes, gender, city, wa_optin, gstin, address, email, pan, credit_limit, credit_days)
    values (coalesce(nullif(p->>'newId', '')::uuid, gen_random_uuid()), tid, coalesce(nullif(trim(p->>'name'), ''), 'Customer'), ph, p->>'usualSize', nullif(p->>'birthday', '')::date, nullif(p->>'anniversary', '')::date, p->>'notes',
            nullif(p->>'gender', ''), nullif(trim(coalesce(p->>'city', '')), ''), coalesce((p->>'waOptin')::boolean, true), nullif(upper(trim(coalesce(p->>'gstin', ''))), ''), nullif(trim(coalesce(p->>'address', '')), ''),
            nullif(trim(coalesce(p->>'email', '')), ''), nullif(upper(trim(coalesce(p->>'pan', ''))), ''), coalesce((p->>'creditLimit')::numeric, 0), coalesce((p->>'creditDays')::int, 0)) returning id into cid;
  else
    update sty_customers set name = coalesce(nullif(trim(p->>'name'), ''), name), phone = coalesce(ph, phone), usual_size = case when p ? 'usualSize' then p->>'usualSize' else usual_size end,
      birthday = case when p ? 'birthday' then nullif(p->>'birthday', '')::date else birthday end,
      anniversary = case when p ? 'anniversary' then nullif(p->>'anniversary', '')::date else anniversary end,
      notes = case when p ? 'notes' then p->>'notes' else notes end,
      gender = case when p ? 'gender' then nullif(p->>'gender', '') else gender end,
      city = case when p ? 'city' then nullif(trim(coalesce(p->>'city', '')), '') else city end,
      wa_optin = case when p ? 'waOptin' then coalesce((p->>'waOptin')::boolean, true) else wa_optin end,
      gstin = case when p ? 'gstin' then nullif(upper(trim(coalesce(p->>'gstin', ''))), '') else gstin end,
      address = case when p ? 'address' then nullif(trim(coalesce(p->>'address', '')), '') else address end,
      email = case when p ? 'email' then nullif(trim(coalesce(p->>'email', '')), '') else email end,
      pan = case when p ? 'pan' then nullif(upper(trim(coalesce(p->>'pan', ''))), '') else pan end,
      credit_limit = case when p ? 'creditLimit' then coalesce((p->>'creditLimit')::numeric, 0) else credit_limit end,
      credit_days = case when p ? 'creditDays' then coalesce((p->>'creditDays')::int, 0) else credit_days end
    where id = cid and tenant_id = tid;
  end if;
  return (select jsonb_build_object('id', id, 'name', name, 'phone', phone, 'usualSize', usual_size, 'points', points, 'credit', credit, 'birthday', birthday) from sty_customers where id = cid);
end $$;

create or replace function sty_crm_list(p jsonb default '{}'::jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; q text := nullif(trim(coalesce(p->>'q', '')), ''); seg text := nullif(p->>'segment', ''); lim int := least(coalesce((p->>'limit')::int, 300), 1000);
begin
  tid := sty_guard('sty_view');
  return coalesce((select jsonb_agg(x) from (
    select jsonb_build_object('id', r.id, 'name', r.name, 'phone', r.phone, 'usualSize', r.usual_size,
      'gstin', (select c.gstin from sty_customers c where c.id = r.id), 'address', (select c.address from sty_customers c where c.id = r.id),
      'email', (select c.email from sty_customers c where c.id = r.id), 'pan', (select c.pan from sty_customers c where c.id = r.id),
      'creditLimit', (select c.credit_limit from sty_customers c where c.id = r.id), 'creditDays', (select c.credit_days from sty_customers c where c.id = r.id),
      'birthday', r.birthday, 'anniversary', r.anniversary, 'notes', r.notes,
      'gender', r.gender, 'city', r.city, 'waOptin', r.wa_optin, 'points', r.points, 'credit', r.credit, 'visits', r.visits, 'spent', r.spent, 'lastAt', r.last_at,
      'tier', r.tier, 'status', r.status) x
    from sty_crm_rows(tid) r
    where (q is null or r.name ilike '%' || q || '%' or r.phone like '%' || q || '%')
      and (seg is null or seg = 'all' or r.status = seg or r.tier = initcap(seg) or (seg = 'credit' and r.credit > 0) or (seg = 'points' and r.points > 0))
    order by r.spent desc, r.created_at desc limit lim) q), '[]'::jsonb);
end $$;

create or replace function sty_customer_detail(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; row_ record; c_ sty_customers;
begin
  tid := sty_guard('sty_view');
  select * into row_ from sty_crm_rows(tid) r where r.id = p_id;
  if not found then raise exception 'customer not found' using errcode = 'ST002'; end if;
  select * into c_ from sty_customers where id = p_id and tenant_id = tid;
  return jsonb_build_object(
    'id', row_.id, 'name', row_.name, 'phone', row_.phone, 'usualSize', row_.usual_size, 'gstin', c_.gstin, 'address', c_.address,
    'email', c_.email, 'pan', c_.pan, 'creditLimit', c_.credit_limit, 'creditDays', c_.credit_days,
    'birthday', row_.birthday, 'anniversary', row_.anniversary, 'notes', row_.notes,
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

-- ---------- suppliers: address (new), email, PAN, credit limit, payment terms ----------
create or replace function sty_save_supplier(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; sid uuid;
begin
  tid := sty_guard('sty_purchase');
  sid := nullif(p->>'id', '')::uuid;
  if sid is null then
    insert into sty_suppliers (id, tenant_id, name, contact, phone, gstin, category, address, email, pan, credit_limit, credit_days)
    values (coalesce(nullif(p->>'newId', '')::uuid, gen_random_uuid()), tid, coalesce(nullif(trim(p->>'name'), ''), 'Supplier'), p->>'contact', p->>'phone', p->>'gstin', p->>'category',
      nullif(trim(coalesce(p->>'address', '')), ''), nullif(trim(coalesce(p->>'email', '')), ''), nullif(upper(trim(coalesce(p->>'pan', ''))), ''), coalesce((p->>'creditLimit')::numeric, 0), coalesce((p->>'creditDays')::int, 0))
    returning id into sid;
  else
    update sty_suppliers set name = coalesce(nullif(trim(p->>'name'), ''), name), contact = coalesce(p->>'contact', contact), phone = coalesce(p->>'phone', phone),
      gstin = coalesce(p->>'gstin', gstin), category = coalesce(p->>'category', category), active = coalesce((p->>'active')::boolean, active),
      address = case when p ? 'address' then nullif(trim(coalesce(p->>'address', '')), '') else address end,
      email = case when p ? 'email' then nullif(trim(coalesce(p->>'email', '')), '') else email end,
      pan = case when p ? 'pan' then nullif(upper(trim(coalesce(p->>'pan', ''))), '') else pan end,
      credit_limit = case when p ? 'creditLimit' then coalesce((p->>'creditLimit')::numeric, 0) else credit_limit end,
      credit_days = case when p ? 'creditDays' then coalesce((p->>'creditDays')::int, 0) else credit_days end
    where id = sid and tenant_id = tid;
  end if;
  return sty_list_suppliers();
end $$;

create or replace function sty_list_suppliers() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_guard('sty_view');
  return coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'contact', s.contact, 'phone', s.phone, 'gstin', s.gstin, 'category', s.category, 'active', s.active,
      'address', s.address, 'email', s.email, 'pan', s.pan, 'creditLimit', s.credit_limit, 'creditDays', s.credit_days,
      'bought', coalesce((select sum(total) from sty_purchases where supplier_id = s.id), 0),
      'paid', coalesce((select sum(amount) from sty_supplier_payments where supplier_id = s.id), 0),
      'due', coalesce((select sum(total) from sty_purchases where supplier_id = s.id), 0) - coalesce((select sum(amount) from sty_supplier_payments where supplier_id = s.id), 0),
      'lastAt', (select max(at) from sty_purchases where supplier_id = s.id)) order by s.name)
    from sty_suppliers s where s.tenant_id = tid and s.active), '[]'::jsonb);
end $$;
