-- =========================================================
-- AUZslab Accounting: guards, numbering, journal posting, stock, documents,
-- receipts/payments/allocation, vouchers, cancellation.
-- Every function here runs in ONE transaction: a failed posting rolls everything
-- back (journal, stock, allocation, number). Nothing swallows an accounting error.
-- =========================================================

-- ---------- permissions ----------
-- Keys: acc_view acc_sales acc_purchase acc_inventory acc_banking acc_post acc_approve
--       acc_cancel acc_reports acc_import acc_admin acc_audit
-- owner: everything. manager: everything except acc_admin. cashier (default role): view + sales.
-- A custom role (profiles.role_id -> roles.permissions) is honoured exactly: missing key = no access.
create function acc_perm(k text) returns boolean language plpgsql stable security definer set search_path = public as $$
declare r text; rid uuid; perms jsonb;
begin
  r := me()->>'role';
  if r = 'owner' then return true; end if;
  select role_id into rid from profiles where id = app_uid();
  if rid is not null then
    select permissions into perms from roles where id = rid;
    return coalesce((perms->>k)::boolean, false);
  end if;
  if r = 'manager' then return k <> 'acc_admin'; end if;
  return k in ('acc_view', 'acc_sales');
end $$;

-- Every public accounting function starts here: authenticated, tenant member, entitled to
-- 'accounting' and not switched off by the owner, and the role allows `k`.
create function acc_guard(k text default 'acc_view') returns uuid language plpgsql stable security definer set search_path = public as $$
declare tid uuid; f jsonb; e jsonb;
begin
  if me() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  tid := (me()->>'tenant_id')::uuid;
  if tid is null then raise exception 'not a tenant member'; end if;
  select features, enabled_features into f, e from tenant_settings where tenant_id = tid;
  if coalesce(f->>'accounting', 'false') <> 'true' or coalesce(e->>'accounting', 'true') = 'false' then
    raise exception 'Accounting is not enabled for this business';
  end if;
  if not acc_perm(k) then raise exception 'Your role does not allow this action (%)', k using errcode = '42501'; end if;
  return tid;
end $$;

create function acc_audit_log(tid uuid, act text, ent text, eid text, oldv jsonb, newv jsonb, why text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into acc_audit (tenant_id, actor, actor_email, action, entity, entity_id, old_value, new_value, reason)
  values (tid, app_uid(), (select email from auth_users where id = app_uid()), act, ent, eid, oldv, newv, why);
end $$;

-- ---------- periods, locks, numbering ----------
create function acc_fy_start(d date, start_month int) returns date language sql immutable as $$
  select make_date(case when extract(month from d) >= start_month then extract(year from d)::int else extract(year from d)::int - 1 end, start_month, 1)
$$;
create function acc_fy_label(s date) returns text language sql immutable as $$
  select case when extract(month from s) = 1 then to_char(s, 'YYYY') else to_char(s, 'YYYY') || '-' || to_char((s + interval '1 year')::date, 'YY') end
$$;

-- Returns the open financial year that covers d (creating the next one if d falls right after the
-- latest); raises if the date is locked, in a closed year, or outside any year.
create function acc_assert_open(tid uuid, d date) returns uuid language plpgsql security definer set search_path = public as $$
declare o acc_org; fy acc_fy; mx date; s date;
begin
  select * into o from acc_org where tenant_id = tid;
  if o.tenant_id is null then raise exception 'Accounting is not set up yet'; end if;
  if o.lock_date is not null and d <= o.lock_date then
    raise exception 'Books are locked up to % - nothing can be posted or changed on %', o.lock_date, d using errcode = 'AC002';
  end if;
  select * into fy from acc_fy where tenant_id = tid and d between start_date and end_date;
  if fy.id is null then
    select max(end_date) into mx from acc_fy where tenant_id = tid;
    if mx is not null and d > mx and d <= mx + 366 then
      s := acc_fy_start(d, o.fy_start_month);
      insert into acc_fy (tenant_id, label, start_date, end_date) values (tid, acc_fy_label(s), s, (s + interval '1 year' - interval '1 day')::date)
      on conflict (tenant_id, label) do nothing;
      select * into fy from acc_fy where tenant_id = tid and d between start_date and end_date;
    end if;
  end if;
  if fy.id is null then raise exception 'No financial year covers % - add it under Settings > Financial years', d; end if;
  if fy.status = 'closed' then raise exception 'Financial year % is closed', fy.label; end if;
  return fy.id;
end $$;

-- GST return periods that have been marked filed are locked for GST documents.
create function acc_assert_gst_open(tid uuid, d date) returns void language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from acc_gst_periods where tenant_id = tid and period = to_char(d, 'YYYY-MM')) then
    raise exception 'GST return period % is marked filed and locked', to_char(d, 'Mon YYYY');
  end if;
end $$;

create function acc_next_no(tid uuid, k text, fy uuid) returns text language plpgsql security definer set search_path = public as $$
declare lbl text; custom text; n int; pfx text; w int;
begin
  select label into lbl from acc_fy where id = fy;
  select settings->'series'->>k into custom from acc_org where tenant_id = tid;
  insert into acc_series (tenant_id, key, fy_id, prefix, next_no) values (tid, k, fy, coalesce(custom, k) || '/' || lbl || '/', 2)
  on conflict (tenant_id, key, fy_id) do update set next_no = acc_series.next_no + 1
  returning next_no - 1, prefix, pad into n, pfx, w;
  return pfx || lpad(n::text, w, '0');
end $$;

create function acc_sys(tid uuid, k text) returns uuid language plpgsql stable security definer set search_path = public as $$
declare a uuid;
begin
  select id into a from acc_accounts where tenant_id = tid and system_key = k;
  if a is null then raise exception 'System account % is missing from the chart of accounts', k; end if;
  return a;
end $$;

-- append one journal line (signed: > 0 debit, < 0 credit); zero is skipped
create function acc_jl(lines jsonb, acct uuid, party uuid, amt numeric, narr text default null) returns jsonb language sql immutable as $$
  select case when coalesce(amt, 0) = 0 then lines
    else lines || jsonb_build_array(jsonb_build_object('account_id', acct, 'party_id', party,
      'debit', greatest(amt, 0), 'credit', greatest(-amt, 0), 'narration', narr)) end
$$;

create function acc_post_journal(tid uuid, vtype text, d date, fy uuid, branch uuid, narr text, src_type text, src_id uuid, lines jsonb,
                                 reverses uuid default null, cc text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare jid uuid := gen_random_uuid(); l jsonb; n int := 0; dr numeric; cr numeric; td numeric := 0; tc numeric := 0; acct acc_accounts;
begin
  insert into acc_journals (id, tenant_id, number, voucher_type, jdate, fy_id, branch_id, narration, source_type, source_id, reverses_id, cost_centre, created_by)
  values (jid, tid, acc_next_no(tid, 'JV', fy), vtype, d, fy, branch, narr, src_type, src_id, reverses, cc, app_uid());
  for l in select * from jsonb_array_elements(lines) loop
    dr := round(coalesce((l->>'debit')::numeric, 0), 2); cr := round(coalesce((l->>'credit')::numeric, 0), 2);
    if dr = 0 and cr = 0 then continue; end if;
    select * into acct from acc_accounts where id = (l->>'account_id')::uuid and tenant_id = tid;
    if acct.id is null then raise exception 'Unknown account in journal line'; end if;
    if not acct.active then raise exception 'Account % is inactive', acct.name; end if;
    n := n + 1; td := td + dr; tc := tc + cr;
    insert into acc_journal_lines (tenant_id, journal_id, line_no, account_id, party_id, debit, credit, narration)
    values (tid, jid, n, acct.id, nullif(l->>'party_id', '')::uuid, dr, cr, l->>'narration');
  end loop;
  if n < 2 then raise exception 'A journal needs at least two lines'; end if;
  if td <> tc then raise exception 'Journal does not balance: debit % vs credit %', td, tc; end if;
  return jid;
end $$;

create function acc_reverse_journal(tid uuid, jid uuid, d date, why text) returns uuid language plpgsql security definer set search_path = public as $$
declare j acc_journals; lines jsonb; fy uuid;
begin
  select * into j from acc_journals where id = jid and tenant_id = tid;
  if j.id is null then raise exception 'Journal not found'; end if;
  if exists (select 1 from acc_journals where reverses_id = jid) then raise exception 'Journal % is already reversed', j.number; end if;
  select coalesce(jsonb_agg(jsonb_build_object('account_id', account_id, 'party_id', party_id, 'debit', credit, 'credit', debit, 'narration', narration) order by line_no), '[]')
    into lines from acc_journal_lines where journal_id = jid;
  fy := acc_assert_open(tid, d);
  return acc_post_journal(tid, 'reversal', d, fy, j.branch_id, 'Reversal of ' || j.number || coalesce(' - ' || why, ''), j.source_type, j.source_id, lines, jid);
end $$;

-- ---------- stock ----------
create function acc_stock_qty(tid uuid, pid uuid, wid uuid default null) returns numeric language sql stable security definer set search_path = public as $$
  select coalesce(sum(qty), 0) from acc_stock_moves where tenant_id = tid and product_id = pid and (wid is null or warehouse_id = wid)
$$;

-- moving weighted-average cost across all warehouses (every outflow is booked at the then-average, so
-- value/qty is exact); falls back to the last inbound cost, then the product's purchase price
create function acc_avg_cost(tid uuid, pid uuid) returns numeric language plpgsql stable security definer set search_path = public as $$
declare q numeric; v numeric; lastc numeric; pp numeric;
begin
  select coalesce(sum(qty), 0), coalesce(sum(qty * unit_cost), 0) into q, v from acc_stock_moves where tenant_id = tid and product_id = pid;
  if q > 0 then return round(v / q, 4); end if;
  select unit_cost into lastc from acc_stock_moves where tenant_id = tid and product_id = pid and qty > 0 order by id desc limit 1;
  if lastc is not null then return lastc; end if;
  select purchase_price into pp from acc_products where id = pid;
  return coalesce(pp, 0);
end $$;

create function acc_stock_move(tid uuid, pid uuid, wid uuid, d date, q numeric, cost numeric, k text, st text, sid uuid,
                               batch text default null, serial text default null, exp date default null, note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare p acc_products; o acc_org; have numeric;
begin
  if q = 0 then return; end if;
  select * into p from acc_products where id = pid and tenant_id = tid;
  if p.id is null then raise exception 'Unknown product'; end if;
  if q < 0 then
    select * into o from acc_org where tenant_id = tid;
    have := acc_stock_qty(tid, pid, wid);
    if have + q < 0 and not o.allow_negative_stock then
      raise exception 'Insufficient stock for % (on hand %, needed %)', p.name, have, -q using errcode = 'AC003';
    end if;
  end if;
  insert into acc_stock_moves (tenant_id, product_id, warehouse_id, move_date, qty, unit_cost, kind, source_type, source_id, batch_no, serial_no, expiry, note, created_by)
  values (tid, pid, wid, d, q, cost, k, st, sid, batch, serial, exp, note, app_uid());
end $$;

create function acc_default_wh(tid uuid, wid uuid default null) returns uuid language plpgsql stable security definer set search_path = public as $$
declare w uuid;
begin
  if wid is not null then return wid; end if;
  select id into w from acc_warehouses where tenant_id = tid and active order by is_default desc, code limit 1;
  if w is null then raise exception 'No warehouse is set up'; end if;
  return w;
end $$;

-- ---------- party balances ----------
create function acc_party_balance(tid uuid, pid uuid) returns numeric language sql stable security definer set search_path = public as $$
  -- + = they owe us (receivable), - = we owe them / advance received (payable)
  select coalesce(sum(jl.debit - jl.credit), 0) from acc_journal_lines jl join acc_accounts a on a.id = jl.account_id
  where jl.tenant_id = tid and jl.party_id = pid and a.system_key in ('ar', 'ap')
$$;

-- ---------- allocation ----------
create function acc_do_allocate(tid uuid, pay uuid, cn uuid, docid uuid, amt numeric, d date) returns void language plpgsql security definer set search_path = public as $$
declare dc acc_documents; p acc_payments; c acc_documents; outstanding numeric; avail numeric;
begin
  if amt is null or amt <= 0 then raise exception 'Allocation amount must be positive'; end if;
  select * into dc from acc_documents where id = docid and tenant_id = tid for update;
  if dc.id is null or dc.status <> 'posted' then raise exception 'Only posted documents can be settled'; end if;
  outstanding := dc.total - dc.paid;
  if amt > outstanding then raise exception '% has only % outstanding (tried to settle %)', dc.number, outstanding, amt; end if;
  if pay is not null then
    select * into p from acc_payments where id = pay and tenant_id = tid for update;
    if p.status <> 'posted' then raise exception 'Payment is cancelled'; end if;
    if p.party_id is distinct from dc.party_id then raise exception 'Payment and % belong to different parties', dc.number; end if;
    if not ((p.kind = 'receipt' and dc.doc_type in ('invoice', 'debit_note')) or (p.kind = 'payment' and dc.doc_type in ('bill', 'expense', 'credit_note'))) then
      raise exception 'A % cannot settle a %', p.kind, dc.doc_type;
    end if;
    avail := p.amount - p.allocated;
    if amt > avail then raise exception 'Only % of this % is unallocated', avail, p.kind; end if;
    update acc_payments set allocated = allocated + amt where id = pay;
  else
    select * into c from acc_documents where id = cn and tenant_id = tid for update;
    if c.status <> 'posted' then raise exception 'Credit/debit note is not posted'; end if;
    if c.party_id is distinct from dc.party_id then raise exception 'Note and % belong to different parties', dc.number; end if;
    if not ((c.doc_type = 'credit_note' and dc.doc_type = 'invoice') or (c.doc_type = 'debit_note' and dc.doc_type in ('bill', 'expense'))) then
      raise exception 'A % cannot be applied to a %', c.doc_type, dc.doc_type;
    end if;
    if amt > c.total - c.paid then raise exception '% has only % left to apply', c.number, c.total - c.paid; end if;
    update acc_documents set paid = paid + amt where id = cn;
  end if;
  update acc_documents set paid = paid + amt where id = docid;
  insert into acc_allocations (tenant_id, payment_id, credit_doc_id, doc_id, amount, alloc_date, created_by) values (tid, pay, cn, docid, amt, d, app_uid());
end $$;

-- ---------- receipts and payments ----------
create function acc_do_payment(tid uuid, k text, d date, party uuid, acct uuid, amt numeric, mode text, ref text, notes text, allocs jsonb, branch uuid default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare a acc_accounts; fy uuid; pid uuid := gen_random_uuid(); jid uuid; lines jsonb := '[]'; ctl uuid; al jsonb; dtp text; pk text;
begin
  if amt is null or amt <= 0 then raise exception 'Amount must be greater than zero'; end if;
  if party is null then raise exception 'Choose a customer or supplier'; end if;
  if not exists (select 1 from acc_parties where id = party and tenant_id = tid) then raise exception 'Unknown party'; end if;
  select * into a from acc_accounts where id = acct and tenant_id = tid;
  if a.id is null or not (a.is_bank or a.is_cash) then raise exception 'Choose a cash or bank account'; end if;
  fy := acc_assert_open(tid, d);
  -- which control account: the side of the documents being settled, else the party's own side
  select d.doc_type into dtp from acc_documents d where d.id = (select (x->>'doc_id')::uuid from jsonb_array_elements(coalesce(allocs, '[]')) x limit 1);
  if dtp is not null then ctl := acc_sys(tid, case when dtp in ('invoice', 'credit_note') then 'ar' else 'ap' end);
  else
    select kind into pk from acc_parties where id = party;
    ctl := acc_sys(tid, case when pk = 'customer' then 'ar' when pk = 'supplier' then 'ap' when k = 'receipt' then 'ar' else 'ap' end);
  end if;
  if k = 'receipt' then
    lines := acc_jl(acc_jl(lines, acct, null, amt), ctl, party, -amt);
  else
    lines := acc_jl(acc_jl(lines, ctl, party, amt), acct, null, -amt);
  end if;
  jid := acc_post_journal(tid, k, d, fy, branch, initcap(k) || coalesce(' ' || nullif(ref, ''), ''), 'payment', pid, lines);
  insert into acc_payments (id, tenant_id, kind, number, pay_date, fy_id, branch_id, party_id, account_id, amount, mode, reference, notes, journal_id, created_by)
  values (pid, tid, k, acc_next_no(tid, case when k = 'receipt' then 'RCT' else 'PAY' end, fy), d, fy, branch, party, acct, amt, mode, ref, notes, jid, app_uid());
  for al in select * from jsonb_array_elements(coalesce(allocs, '[]')) loop
    perform acc_do_allocate(tid, pid, null, (al->>'doc_id')::uuid, (al->>'amount')::numeric, d);
  end loop;
  return pid;
end $$;

-- ---------- document posting ----------
create function acc_series_key(t text) returns text language sql immutable as $$
  select case t when 'invoice' then 'INV' when 'credit_note' then 'CN' when 'bill' then 'PB' when 'debit_note' then 'DN' when 'expense' then 'EXP'
    when 'quotation' then 'QT' when 'sales_order' then 'SO' when 'delivery_challan' then 'DC' when 'purchase_request' then 'PRQ'
    when 'purchase_order' then 'PO' when 'goods_receipt' then 'GRN' end
$$;

create function acc_do_post(tid uuid, did uuid, pays jsonb default '[]') returns jsonb language plpgsql security definer set search_path = public as $$
declare d acc_documents; o acc_org; fy uuid; lines jsonb := '[]'; s int; sales_side boolean; ln record; cost numeric; cogs numeric := 0;
  ar uuid; ap uuid; acct uuid; party acc_parties; bal numeric; wid uuid; stockable boolean; tc numeric; numr text; jid uuid; pj jsonb; pay_total numeric := 0;
  inv_cost numeric; diff numeric; tax_in_cost numeric; line_cost numeric; first_party boolean;
begin
  select * into d from acc_documents where id = did and tenant_id = tid for update;
  if d.id is null then raise exception 'Document not found'; end if;
  if d.status <> 'draft' then raise exception '% is already %', d.number, d.status; end if;
  if d.doc_type not in ('invoice', 'credit_note', 'bill', 'debit_note', 'expense') then raise exception '% documents do not post to the books', d.doc_type; end if;
  if d.total < 0 or (d.total = 0 and d.taxable = 0) then raise exception 'Nothing to post: total is zero'; end if;
  if not exists (select 1 from acc_doc_lines where doc_id = did) then raise exception 'Add at least one line'; end if;
  select * into o from acc_org where tenant_id = tid;
  fy := acc_assert_open(tid, d.doc_date);
  perform acc_assert_gst_open(tid, d.doc_date);
  select * into party from acc_parties where id = d.party_id;
  ar := acc_sys(tid, 'ar'); ap := acc_sys(tid, 'ap');
  wid := acc_default_wh(tid, d.warehouse_id);
  sales_side := d.doc_type in ('invoice', 'credit_note');
  s := case when d.doc_type in ('credit_note', 'debit_note') then -1 else 1 end;

  if d.doc_type = 'invoice' and party.credit_limit > 0 then
    bal := acc_party_balance(tid, d.party_id);
    select coalesce(sum((x->>'amount')::numeric), 0) into pay_total from jsonb_array_elements(coalesce(pays, '[]')) x;
    if bal + d.total - pay_total > party.credit_limit then
      raise exception 'Credit limit exceeded for %: limit %, outstanding %, this invoice % (reduce, take payment, or raise the limit)', party.name, party.credit_limit, bal, d.total
        using errcode = 'AC004';
    end if;
  end if;

  if sales_side then
    -- ===== sales / sales return =====
    lines := acc_jl(lines, ar, d.party_id, s * d.total);
    lines := acc_jl(lines, acc_sys(tid, case when s = 1 then 'sales' else 'sales_return' end), null, -s * d.taxable);
    lines := acc_jl(lines, acc_sys(tid, 'out_cgst'), null, -s * d.cgst);
    lines := acc_jl(lines, acc_sys(tid, 'out_sgst'), null, -s * d.sgst);
    lines := acc_jl(lines, acc_sys(tid, 'out_igst'), null, -s * d.igst);
    lines := acc_jl(lines, acc_sys(tid, 'out_cess'), null, -s * d.cess);
    lines := acc_jl(lines, acc_sys(tid, 'round_off'), null, -s * d.roundoff);
    for ln in select l.*, p.track_stock, p.is_service, p.name pname from acc_doc_lines l left join acc_products p on p.id = l.product_id where l.doc_id = did order by l.line_no loop
      if ln.product_id is not null and ln.track_stock and not ln.is_service then
        if s = 1 then
          cost := acc_avg_cost(tid, ln.product_id);
          perform acc_stock_move(tid, ln.product_id, coalesce(ln.warehouse_id, wid), d.doc_date, -ln.qty, cost, 'sale', 'document', did, ln.batch_no, ln.serial_nos, null);
        else
          cost := null;
          if d.ref_doc_id is not null then
            select unit_cost into cost from acc_doc_lines where doc_id = d.ref_doc_id and product_id = ln.product_id and unit_cost > 0 limit 1;
          end if;
          cost := coalesce(cost, acc_avg_cost(tid, ln.product_id));
          perform acc_stock_move(tid, ln.product_id, coalesce(ln.warehouse_id, wid), d.doc_date, ln.qty, cost, 'sale_return', 'document', did, ln.batch_no, ln.serial_nos, null);
        end if;
        update acc_doc_lines set unit_cost = cost where id = ln.id;
        cogs := cogs + round(ln.qty * cost, 2);
      end if;
    end loop;
    lines := acc_jl(lines, acc_sys(tid, 'cogs'), null, s * cogs);
    lines := acc_jl(lines, acc_sys(tid, 'inventory'), null, -s * cogs);
  else
    -- ===== purchase / expense / purchase return =====
    lines := acc_jl(lines, ap, d.party_id, -s * d.total);
    tc := d.cgst + d.sgst + d.igst + d.cess;
    for ln in select l.*, p.track_stock, p.is_service from acc_doc_lines l left join acc_products p on p.id = l.product_id where l.doc_id = did order by l.line_no loop
      tax_in_cost := case when d.itc_eligible then 0 else ln.cgst + ln.sgst + ln.igst + ln.cess end;
      line_cost := ln.taxable + tax_in_cost;
      if ln.product_id is not null and ln.track_stock and not ln.is_service then
        if s = 1 then
          cost := round(line_cost / ln.qty, 4);
          perform acc_stock_move(tid, ln.product_id, coalesce(ln.warehouse_id, wid), d.doc_date, ln.qty, cost, 'purchase', 'document', did, ln.batch_no, ln.serial_nos, ln.expiry);
          lines := acc_jl(lines, acc_sys(tid, 'inventory'), null, line_cost);
        else
          cost := null;
          if d.ref_doc_id is not null then
            select unit_cost into cost from acc_doc_lines where doc_id = d.ref_doc_id and product_id = ln.product_id and unit_cost > 0 limit 1;
          end if;
          cost := coalesce(cost, acc_avg_cost(tid, ln.product_id));
          perform acc_stock_move(tid, ln.product_id, coalesce(ln.warehouse_id, wid), d.doc_date, -ln.qty, cost, 'purchase_return', 'document', did, ln.batch_no, ln.serial_nos, null);
          inv_cost := round(ln.qty * cost, 2);
          lines := acc_jl(lines, acc_sys(tid, 'inventory'), null, -inv_cost);
          diff := line_cost - inv_cost;               -- price difference vs. the cost the stock carried
          lines := acc_jl(lines, acc_sys(tid, 'purchase_return'), null, -diff);
        end if;
        update acc_doc_lines set unit_cost = cost where id = ln.id;
      else
        acct := coalesce(ln.account_id, acc_sys(tid, case when d.doc_type = 'expense' then 'general_expense' else 'purchases' end));
        lines := acc_jl(lines, acct, null, s * line_cost);
      end if;
    end loop;
    if d.itc_eligible then
      lines := acc_jl(lines, acc_sys(tid, 'in_cgst'), null, s * d.cgst);
      lines := acc_jl(lines, acc_sys(tid, 'in_sgst'), null, s * d.sgst);
      lines := acc_jl(lines, acc_sys(tid, 'in_igst'), null, s * d.igst);
      lines := acc_jl(lines, acc_sys(tid, 'in_cess'), null, s * d.cess);
    end if;
    if d.reverse_charge and tc > 0 then lines := acc_jl(lines, acc_sys(tid, 'rcm_payable'), null, -s * tc); end if;
    lines := acc_jl(lines, acc_sys(tid, 'round_off'), null, s * d.roundoff);
  end if;

  numr := coalesce(case when acc_perm('acc_import') then nullif(d.meta->>'import_number', '') end, acc_next_no(tid, acc_series_key(d.doc_type), fy));
  jid := acc_post_journal(tid, case d.doc_type when 'invoice' then 'sales' when 'bill' then 'purchase' else d.doc_type end,
                          d.doc_date, fy, d.branch_id, initcap(replace(d.doc_type, '_', ' ')) || ' ' || numr || coalesce(' - ' || d.party_name, ''), 'document', did, lines);
  update acc_documents set number = numr, fy_id = fy, journal_id = jid, status = 'posted', warehouse_id = wid where id = did;

  -- credit / debit note against its original document: settle what is outstanding there
  if d.doc_type in ('credit_note', 'debit_note') and d.ref_doc_id is not null then
    declare orig acc_documents; amt numeric;
    begin
      select * into orig from acc_documents where id = d.ref_doc_id;
      if orig.status = 'posted' and orig.party_id = d.party_id then
        amt := least(d.total, orig.total - orig.paid);
        if amt > 0 then perform acc_do_allocate(tid, null, did, orig.id, amt, d.doc_date); end if;
      end if;
    end;
  end if;

  -- settle at the counter: payments recorded together with the document
  for pj in select * from jsonb_array_elements(coalesce(pays, '[]')) loop
    if coalesce((pj->>'amount')::numeric, 0) <= 0 then continue; end if;
    perform acc_do_payment(tid, case when d.doc_type in ('invoice', 'debit_note') then 'receipt' else 'payment' end, d.doc_date, d.party_id,
      (pj->>'account_id')::uuid, (pj->>'amount')::numeric, pj->>'mode', pj->>'reference', null,
      jsonb_build_array(jsonb_build_object('doc_id', did, 'amount', least((pj->>'amount')::numeric, d.total - (select paid from acc_documents where id = did)))), d.branch_id);
  end loop;

  perform acc_audit_log(tid, 'post', d.doc_type, did::text, null, jsonb_build_object('number', numr, 'total', d.total, 'journal', jid));
  return jsonb_build_object('id', did, 'number', numr, 'status', 'posted', 'journal_id', jid, 'total', d.total);
end $$;

-- ---------- save a document (all types) ----------
create function acc_save_document(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; dt text := p->>'doc_type'; perm text; o acc_org; existing acc_documents; did uuid; party acc_parties; l jsonb; i int := 0;
  dd date; due date; pos text; supply text; origin text; inc boolean; v_qty numeric; v_rate numeric; gross numeric; dpct numeric; damt numeric; net numeric;
  trate numeric; cpct numeric; txb numeric; tx numeric; cg numeric; sg numeric; ig numeric; cs numeric; prod acc_products; k_sales boolean; rev boolean;
  s_sub numeric := 0; s_disc numeric := 0; s_tax numeric := 0; s_cg numeric := 0; s_sg numeric := 0; s_ig numeric := 0; s_cs numeric := 0; v_total numeric; ro numeric;
  fy uuid; num text; zero_tax boolean := false; nstatus text; thr numeric; res jsonb; allow_post boolean;
begin
  if dt is null or acc_series_key(dt) is null then raise exception 'Unknown document type'; end if;
  perm := case when dt in ('invoice', 'credit_note', 'quotation', 'sales_order', 'delivery_challan') then 'acc_sales' else 'acc_purchase' end;
  tid := acc_guard(perm);
  k_sales := perm = 'acc_sales';
  select * into o from acc_org where tenant_id = tid;
  if o.tenant_id is null then raise exception 'Accounting is not set up yet'; end if;
  dd := coalesce(nullif(p->>'doc_date', '')::date, current_date);
  if jsonb_array_length(coalesce(p->'lines', '[]')) = 0 then raise exception 'Add at least one line'; end if;
  if jsonb_array_length(p->'lines') > 500 then raise exception 'Too many lines (max 500)'; end if;

  -- party
  if nullif(p->>'party_id', '') is not null then
    select * into party from acc_parties where id = (p->>'party_id')::uuid and tenant_id = tid;
    if party.id is null then raise exception 'Unknown customer/supplier'; end if;
    if not party.active then raise exception '% is inactive', party.name; end if;
    if k_sales and party.kind = 'supplier' then raise exception '% is a supplier, not a customer', party.name; end if;
    if not k_sales and party.kind = 'customer' then raise exception '% is a customer, not a supplier', party.name; end if;
  else
    if dt in ('bill', 'debit_note', 'purchase_order', 'purchase_request', 'goods_receipt') then raise exception 'Choose a supplier'; end if;
    select * into party from acc_parties where tenant_id = tid and is_walkin;
  end if;

  -- existing draft?
  if nullif(p->>'id', '') is not null then
    select * into existing from acc_documents where id = (p->>'id')::uuid and tenant_id = tid for update;
    if existing.id is null then raise exception 'Document not found'; end if;
    if existing.status not in ('draft', 'open') then raise exception '% is % and can no longer be edited', existing.number, existing.status; end if;
    if existing.doc_type <> dt then raise exception 'Document type cannot change'; end if;
  end if;

  -- GST: intra vs inter
  if k_sales then
    origin := coalesce((select state_code from acc_branches where id = nullif(p->>'branch_id', '')::uuid), o.state_code);
    pos := coalesce(nullif(p->>'place_of_supply', ''), party.state_code, origin);
    supply := case when origin is not null and pos is not null and origin <> pos then 'inter' else 'intra' end;
    if party.reg_type = 'overseas' then supply := 'inter'; zero_tax := true; end if;
    if o.reg_type <> 'regular' then zero_tax := true; end if;            -- composition / unregistered suppliers charge no GST
  else
    pos := coalesce(nullif(p->>'place_of_supply', ''), o.state_code);
    supply := case when party.state_code is not null and o.state_code is not null and party.state_code <> o.state_code then 'inter' else 'intra' end;
    if party.reg_type = 'overseas' then supply := 'inter'; end if;
    if party.reg_type = 'composition' then zero_tax := true; end if;      -- composition suppliers cannot charge GST
  end if;
  rev := coalesce((p->>'reverse_charge')::boolean, false);
  inc := coalesce((p->>'price_includes_tax')::boolean, false);
  due := coalesce(nullif(p->>'due_date', '')::date, dd + coalesce(party.credit_days, 0));

  -- header row (number: drafts of posting documents get a placeholder; the real, gapless number is taken at posting)
  if existing.id is not null then
    did := existing.id; num := existing.number;
    delete from acc_doc_lines where doc_id = did;
  else
    did := gen_random_uuid();
    if dt in ('invoice', 'credit_note', 'bill', 'debit_note', 'expense') then num := 'DRAFT-' || substr(did::text, 1, 8);
    else fy := acc_assert_open(tid, dd); num := acc_next_no(tid, acc_series_key(dt), fy); end if;
    insert into acc_documents (id, tenant_id, doc_type, number, doc_date, party_id, created_by, status)
    values (did, tid, dt, num, dd, party.id, app_uid(), case when dt in ('invoice', 'credit_note', 'bill', 'debit_note', 'expense') then 'draft' else 'open' end);
  end if;

  for l in select * from jsonb_array_elements(p->'lines') loop
    i := i + 1;
    prod := null;
    if nullif(l->>'product_id', '') is not null then
      select * into prod from acc_products where id = (l->>'product_id')::uuid and tenant_id = tid;
      if prod.id is null then raise exception 'Line %: unknown product', i; end if;
    end if;
    v_qty := coalesce(nullif(l->>'qty', '')::numeric, 1);
    if v_qty <= 0 then raise exception 'Line %: quantity must be greater than zero', i; end if;
    v_rate := coalesce(nullif(l->>'rate', '')::numeric, case when prod.id is null then 0 when k_sales then prod.sale_price else prod.purchase_price end);
    if v_rate < 0 then raise exception 'Line %: rate cannot be negative', i; end if;
    gross := round(v_qty * v_rate, 2);
    dpct := coalesce(nullif(l->>'disc_pct', '')::numeric, 0); damt := coalesce(nullif(l->>'disc_amt', '')::numeric, 0);
    if dpct < 0 or dpct > 100 or damt < 0 then raise exception 'Line %: invalid discount', i; end if;
    if dpct > 0 and damt = 0 then damt := round(gross * dpct / 100, 2); end if;
    net := gross - damt;
    if net < 0 then raise exception 'Line %: discount is more than the amount', i; end if;
    trate := case when zero_tax then 0 else coalesce(nullif(l->>'tax_rate', '')::numeric, prod.tax_rate, 0) end;
    if trate > 0 and not exists (select 1 from acc_taxcodes where tenant_id = tid and active and kind = 'taxable' and rate = trate) then
      raise exception 'Line %: GST rate % is not configured (Settings > GST rates)', i, trate;
    end if;
    cpct := coalesce(nullif(l->>'cess_pct', '')::numeric, 0);
    if inc and trate > 0 then txb := round(net * 100 / (100 + trate), 2); tx := net - txb; else txb := net; tx := round(txb * trate / 100, 2); end if;
    cg := 0; sg := 0; ig := 0;
    if supply = 'inter' then ig := tx; else cg := round(tx / 2, 2); sg := tx - cg; end if;
    cs := round(txb * cpct / 100, 2);
    insert into acc_doc_lines (tenant_id, doc_id, line_no, product_id, account_id, description, hsn, qty, unit, rate, disc_pct, disc_amt, taxable, tax_rate, cgst, sgst, igst, cess, total,
                               warehouse_id, batch_no, serial_nos, expiry, mfg_date)
    values (tid, did, i, prod.id, nullif(l->>'account_id', '')::uuid, coalesce(nullif(l->>'description', ''), prod.name), coalesce(nullif(l->>'hsn', ''), prod.hsn),
            v_qty, coalesce(nullif(l->>'unit', ''), prod.unit), v_rate, dpct, damt, txb, trate, cg, sg, ig, cs, txb + tx + cs,
            nullif(l->>'warehouse_id', '')::uuid, nullif(l->>'batch_no', ''), nullif(l->>'serial_nos', ''), nullif(l->>'expiry', '')::date, nullif(l->>'mfg_date', '')::date);
    s_sub := s_sub + gross; s_disc := s_disc + damt; s_tax := s_tax + txb; s_cg := s_cg + cg; s_sg := s_sg + sg; s_ig := s_ig + ig; s_cs := s_cs + cs;
  end loop;

  v_total := s_tax + s_cg + s_sg + s_ig + s_cs;
  if rev and not k_sales then v_total := s_tax; end if;               -- reverse charge: the supplier is not paid the tax
  if p ? 'roundoff' and nullif(p->>'roundoff', '') is not null then ro := round((p->>'roundoff')::numeric, 2);
  elsif k_sales and o.round_off_sales then ro := round(v_total, 0) - v_total;
  else ro := 0; end if;
  v_total := v_total + ro;

  -- approvals: a user without acc_approve can save but not post above the org's threshold
  thr := coalesce(nullif(o.settings->>'approval_threshold', '')::numeric, 0);
  allow_post := coalesce((p->>'post')::boolean, false);
  nstatus := null;
  if allow_post and thr > 0 and v_total > thr and not acc_perm('acc_approve') then
    allow_post := false;
    nstatus := 'pending_approval';
  end if;

  update acc_documents set doc_date = dd, due_date = due, branch_id = nullif(p->>'branch_id', '')::uuid, warehouse_id = nullif(p->>'warehouse_id', '')::uuid,
    party_id = party.id, party_name = party.name, party_gstin = party.gstin,
    billing_address = coalesce(nullif(p->>'billing_address', ''), party.billing_address), shipping_address = coalesce(nullif(p->>'shipping_address', ''), party.shipping_address, party.billing_address),
    place_of_supply = pos, supply_type = supply, reverse_charge = rev, itc_eligible = coalesce((p->>'itc_eligible')::boolean, true), price_includes_tax = inc,
    supplier_ref = nullif(p->>'supplier_ref', ''), supplier_ref_date = nullif(p->>'supplier_ref_date', '')::date,
    ref_doc_id = nullif(p->>'ref_doc_id', '')::uuid, source_doc_id = nullif(p->>'source_doc_id', '')::uuid,
    subtotal = s_sub, discount = s_disc, taxable = s_tax, cgst = s_cg, sgst = s_sg, igst = s_ig, cess = s_cs, roundoff = ro, total = v_total,
    payment_terms = nullif(p->>'payment_terms', ''), notes = nullif(p->>'notes', ''), terms = coalesce(nullif(p->>'terms', ''), o.invoice_terms),
    meta = coalesce(p->'meta', '{}'::jsonb) || case when nstatus is not null then jsonb_build_object('pending_approval', true) else '{}'::jsonb end
  where id = did;

  if existing.id is null then perform acc_audit_log(tid, 'create', dt, did::text, null, jsonb_build_object('number', num, 'total', v_total)); end if;

  if allow_post and dt in ('invoice', 'credit_note', 'bill', 'debit_note', 'expense') then
    res := acc_do_post(tid, did, p->'payments');
    return res || jsonb_build_object('posted', true);
  end if;
  return jsonb_build_object('id', did, 'number', (select number from acc_documents where id = did), 'status', (select status from acc_documents where id = did), 'total', v_total,
    'posted', false, 'pending_approval', nstatus is not null);
end $$;

create function acc_post_document(p_doc_id uuid, p_payments jsonb default '[]') returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; t text;
begin
  select doc_type into t from acc_documents where id = p_doc_id and tenant_id = (me()->>'tenant_id')::uuid;
  if t is null then raise exception 'Document not found'; end if;
  tid := acc_guard(case when t in ('invoice', 'credit_note') then 'acc_sales' else 'acc_purchase' end);
  -- approving a draft that was held for approval needs the approval right
  if (select coalesce((meta->>'pending_approval')::boolean, false) from acc_documents where id = p_doc_id) and not acc_perm('acc_approve') then
    raise exception 'This document is waiting for approval by a manager';
  end if;
  update acc_documents set meta = meta - 'pending_approval' where id = p_doc_id;
  return acc_do_post(tid, p_doc_id, p_payments) || jsonb_build_object('posted', true);
end $$;

create function acc_delete_document(p_doc_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; d acc_documents;
begin
  select * into d from acc_documents where id = p_doc_id and tenant_id = (me()->>'tenant_id')::uuid;
  if d.id is null then raise exception 'Document not found'; end if;
  tid := acc_guard(case when d.doc_type in ('invoice', 'credit_note', 'quotation', 'sales_order', 'delivery_challan') then 'acc_sales' else 'acc_purchase' end);
  if d.status not in ('draft', 'open') then raise exception '% is % - cancel it instead of deleting', d.number, d.status; end if;
  if exists (select 1 from acc_documents where source_doc_id = d.id or ref_doc_id = d.id) then raise exception 'Other documents were created from % - cancel it instead', d.number; end if;
  perform acc_audit_log(tid, 'delete', d.doc_type, d.id::text, jsonb_build_object('number', d.number, 'total', d.total), null);
  delete from acc_doc_lines where doc_id = p_doc_id;
  delete from acc_documents where id = p_doc_id;
  return jsonb_build_object('deleted', true);
end $$;

-- ---------- cancellation (reversal, never deletion) ----------
create function acc_cancel_document(p_doc_id uuid, p_reason text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; d acc_documents; rj uuid; e acc_einvoice;
begin
  tid := acc_guard('acc_cancel');
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required to cancel a document'; end if;
  select * into d from acc_documents where id = p_doc_id and tenant_id = tid for update;
  if d.id is null then raise exception 'Document not found'; end if;
  if d.status = 'cancelled' then raise exception '% is already cancelled', d.number; end if;
  if d.status = 'draft' then raise exception 'Delete the draft instead'; end if;
  if d.doc_type in ('quotation', 'sales_order', 'delivery_challan', 'purchase_request', 'purchase_order', 'goods_receipt') then
    update acc_documents set status = 'cancelled', cancelled_at = now(), cancelled_by = app_uid(), cancel_reason = p_reason where id = d.id;
    perform acc_audit_log(tid, 'cancel', d.doc_type, d.id::text, jsonb_build_object('status', d.status), jsonb_build_object('status', 'cancelled'), p_reason);
    return jsonb_build_object('id', d.id, 'status', 'cancelled');
  end if;
  if exists (select 1 from acc_allocations where (doc_id = d.id or credit_doc_id = d.id) and reversed_at is null) then
    raise exception '% has payments or credit notes applied - cancel or unlink them first', d.number;
  end if;
  if exists (select 1 from acc_documents where ref_doc_id = d.id and status = 'posted') then
    raise exception '% has credit/debit notes against it - cancel those first', d.number;
  end if;
  select * into e from acc_einvoice where doc_id = d.id;
  if e.status = 'generated' then raise exception 'Cancel the e-invoice (IRN) first'; end if;
  perform acc_assert_gst_open(tid, d.doc_date);
  rj := acc_reverse_journal(tid, d.journal_id, d.doc_date, p_reason);
  insert into acc_stock_moves (tenant_id, product_id, warehouse_id, move_date, qty, unit_cost, kind, source_type, source_id, note, created_by)
    select tid, product_id, warehouse_id, d.doc_date, -qty, unit_cost, 'reversal', 'document', d.id, 'Cancelled ' || d.number, app_uid()
    from acc_stock_moves where tenant_id = tid and source_type = 'document' and source_id = d.id and kind <> 'reversal';
  update acc_documents set status = 'cancelled', cancelled_at = now(), cancelled_by = app_uid(), cancel_reason = p_reason where id = d.id;
  perform acc_audit_log(tid, 'cancel', d.doc_type, d.id::text, jsonb_build_object('number', d.number, 'total', d.total), jsonb_build_object('reversal_journal', rj), p_reason);
  return jsonb_build_object('id', d.id, 'status', 'cancelled', 'reversal_journal_id', rj);
end $$;

-- ---------- conversions: quotation -> order -> challan -> invoice, request -> PO -> receipt -> bill ----------
create function acc_convert_document(p_src uuid, p_to text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; s acc_documents; ok boolean; lines jsonb; res jsonb;
begin
  select * into s from acc_documents where id = p_src and tenant_id = (me()->>'tenant_id')::uuid;
  if s.id is null then raise exception 'Document not found'; end if;
  ok := (s.doc_type, p_to) in (('quotation', 'sales_order'), ('quotation', 'invoice'), ('sales_order', 'delivery_challan'), ('sales_order', 'invoice'), ('delivery_challan', 'invoice'),
                               ('purchase_request', 'purchase_order'), ('purchase_order', 'goods_receipt'), ('purchase_order', 'bill'), ('goods_receipt', 'bill'));
  if not ok then raise exception 'A % cannot be converted to a %', s.doc_type, p_to; end if;
  tid := acc_guard(case when p_to in ('sales_order', 'delivery_challan', 'invoice') then 'acc_sales' else 'acc_purchase' end);
  if s.status not in ('open', 'converted') then raise exception '% is %', s.number, s.status; end if;
  select jsonb_agg(jsonb_build_object('product_id', product_id, 'account_id', account_id, 'description', description, 'hsn', hsn, 'qty', qty, 'unit', unit, 'rate', rate,
                                       'disc_pct', disc_pct, 'disc_amt', disc_amt, 'tax_rate', tax_rate, 'warehouse_id', warehouse_id) order by line_no)
    into lines from acc_doc_lines where doc_id = s.id;
  res := acc_save_document(jsonb_build_object('doc_type', p_to, 'doc_date', current_date, 'party_id', s.party_id, 'branch_id', s.branch_id, 'warehouse_id', s.warehouse_id,
    'place_of_supply', s.place_of_supply, 'reverse_charge', s.reverse_charge, 'itc_eligible', s.itc_eligible, 'price_includes_tax', s.price_includes_tax,
    'source_doc_id', s.id, 'notes', s.notes, 'terms', s.terms, 'payment_terms', s.payment_terms, 'billing_address', s.billing_address, 'shipping_address', s.shipping_address,
    'supplier_ref', s.supplier_ref, 'lines', lines));
  update acc_documents set status = 'converted' where id = s.id;
  perform acc_audit_log(tid, 'convert', s.doc_type, s.id::text, null, jsonb_build_object('to', p_to, 'new', res->>'number'));
  return res;
end $$;

-- ---------- receipts / payments (RPC) ----------
create function acc_save_payment(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; k text := p->>'kind'; pid uuid; allocs jsonb := coalesce(p->'allocations', '[]'); amt numeric := (p->>'amount')::numeric; d date := coalesce(nullif(p->>'date', '')::date, current_date);
  rem numeric; r record; take numeric; res jsonb := '[]';
begin
  if k not in ('receipt', 'payment') then raise exception 'Kind must be receipt or payment'; end if;
  tid := acc_guard(case when k = 'receipt' then 'acc_sales' else 'acc_purchase' end);
  -- auto: settle oldest dues first
  if coalesce((p->>'auto_allocate')::boolean, false) and jsonb_array_length(allocs) = 0 then
    rem := amt;
    for r in select id, total - paid as due from acc_documents
             where tenant_id = tid and party_id = (p->>'party_id')::uuid and status = 'posted' and total - paid > 0
               and ((k = 'receipt' and doc_type in ('invoice', 'debit_note')) or (k = 'payment' and doc_type in ('bill', 'expense', 'credit_note')))
             order by coalesce(due_date, doc_date), doc_date, created_at loop
      exit when rem <= 0;
      take := least(rem, r.due);
      res := res || jsonb_build_array(jsonb_build_object('doc_id', r.id, 'amount', take));
      rem := rem - take;
    end loop;
    allocs := res;
  end if;
  pid := acc_do_payment(tid, k, d, (p->>'party_id')::uuid, (p->>'account_id')::uuid, amt, p->>'mode', p->>'reference', p->>'notes', allocs, nullif(p->>'branch_id', '')::uuid);
  perform acc_audit_log(tid, 'create', k, pid::text, null, jsonb_build_object('amount', amt, 'party', p->>'party_id'));
  return (select jsonb_build_object('id', id, 'number', number, 'amount', amount, 'allocated', allocated, 'unallocated', amount - allocated) from acc_payments where id = pid);
end $$;

create function acc_allocate(p_payment uuid, p_doc uuid, p_amount numeric) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; k text;
begin
  select kind into k from acc_payments where id = p_payment and tenant_id = (me()->>'tenant_id')::uuid;
  if k is null then raise exception 'Payment not found'; end if;
  tid := acc_guard(case when k = 'receipt' then 'acc_sales' else 'acc_purchase' end);
  perform acc_do_allocate(tid, p_payment, null, p_doc, p_amount, current_date);
  perform acc_audit_log(tid, 'allocate', 'payment', p_payment::text, null, jsonb_build_object('doc', p_doc, 'amount', p_amount));
  return jsonb_build_object('ok', true);
end $$;

create function acc_apply_credit(p_note uuid, p_doc uuid, p_amount numeric) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; t text;
begin
  select doc_type into t from acc_documents where id = p_note and tenant_id = (me()->>'tenant_id')::uuid;
  if t is null then raise exception 'Note not found'; end if;
  tid := acc_guard(case when t = 'credit_note' then 'acc_sales' else 'acc_purchase' end);
  perform acc_do_allocate(tid, null, p_note, p_doc, p_amount, current_date);
  perform acc_audit_log(tid, 'apply', t, p_note::text, null, jsonb_build_object('doc', p_doc, 'amount', p_amount));
  return jsonb_build_object('ok', true);
end $$;

create function acc_unallocate(p_allocation uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; a acc_allocations;
begin
  tid := acc_guard('acc_post');
  select * into a from acc_allocations where id = p_allocation and tenant_id = tid and reversed_at is null for update;
  if a.id is null then raise exception 'Allocation not found'; end if;
  update acc_documents set paid = paid - a.amount where id = a.doc_id;
  if a.payment_id is not null then update acc_payments set allocated = allocated - a.amount where id = a.payment_id;
  else update acc_documents set paid = paid - a.amount where id = a.credit_doc_id; end if;
  update acc_allocations set reversed_at = now() where id = a.id;
  perform acc_audit_log(tid, 'unallocate', 'allocation', a.id::text, jsonb_build_object('amount', a.amount), null);
  return jsonb_build_object('ok', true);
end $$;

create function acc_cancel_payment(p_payment uuid, p_reason text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; p acc_payments; a record;
begin
  tid := acc_guard('acc_cancel');
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  select * into p from acc_payments where id = p_payment and tenant_id = tid for update;
  if p.id is null then raise exception 'Payment not found'; end if;
  if p.status = 'cancelled' then raise exception '% is already cancelled', p.number; end if;
  for a in select * from acc_allocations where payment_id = p.id and reversed_at is null loop
    update acc_documents set paid = paid - a.amount where id = a.doc_id;
    update acc_allocations set reversed_at = now() where id = a.id;
  end loop;
  perform acc_reverse_journal(tid, p.journal_id, p.pay_date, p_reason);
  -- a bank line that was already matched to a statement row must be un-matched
  update acc_bank_txns set status = 'unmatched', matched_line_id = null where tenant_id = tid and recon_id is null and matched_line_id in
    (select id from acc_journal_lines where journal_id = p.journal_id);
  update acc_payments set status = 'cancelled', allocated = 0, cancelled_at = now(), cancel_reason = p_reason where id = p.id;
  perform acc_audit_log(tid, 'cancel', p.kind, p.id::text, jsonb_build_object('number', p.number, 'amount', p.amount), null, p_reason);
  return jsonb_build_object('id', p.id, 'status', 'cancelled');
end $$;

-- ---------- vouchers: journal and contra, opening balances, expenses ----------
create function acc_save_voucher(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; t text := p->>'type'; d date := coalesce(nullif(p->>'date', '')::date, current_date); fy uuid; lines jsonb := '[]'; l jsonb; a acc_accounts; amt numeric; jid uuid; f acc_accounts; tt acc_accounts;
begin
  tid := acc_guard('acc_post');
  fy := acc_assert_open(tid, d);
  if t = 'contra' then
    amt := (p->>'amount')::numeric;
    if amt is null or amt <= 0 then raise exception 'Amount must be greater than zero'; end if;
    select * into f from acc_accounts where id = (p->>'from_account')::uuid and tenant_id = tid;
    select * into tt from acc_accounts where id = (p->>'to_account')::uuid and tenant_id = tid;
    if f.id is null or tt.id is null or not (f.is_bank or f.is_cash) or not (tt.is_bank or tt.is_cash) then raise exception 'Contra moves money between cash and bank accounts only'; end if;
    if f.id = tt.id then raise exception 'Choose two different accounts'; end if;
    lines := acc_jl(acc_jl(lines, tt.id, null, amt), f.id, null, -amt);
  elsif t = 'journal' then
    for l in select * from jsonb_array_elements(coalesce(p->'lines', '[]')) loop
      select * into a from acc_accounts where id = (l->>'account_id')::uuid and tenant_id = tid;
      if a.id is null then raise exception 'Unknown account in journal'; end if;
      if a.system_key = 'inventory' then raise exception 'The inventory account moves only with stock - use Stock adjustment'; end if;
      if a.system_key in ('ar', 'ap') and nullif(l->>'party_id', '') is null then raise exception 'Choose the customer/supplier for % lines', a.name; end if;
      lines := lines || jsonb_build_array(l);
    end loop;
  else raise exception 'Voucher type must be journal or contra';
  end if;
  jid := acc_post_journal(tid, t, d, fy, nullif(p->>'branch_id', '')::uuid, coalesce(nullif(p->>'narration', ''), initcap(t) || ' voucher'), 'voucher', null, lines, null, p->>'cost_centre');
  perform acc_audit_log(tid, 'create', t, jid::text, null, jsonb_build_object('narration', p->>'narration'));
  return (select jsonb_build_object('id', id, 'number', number) from acc_journals where id = jid);
end $$;

-- Opening balances for ledger accounts (bank, cash, capital, loans, fixed assets...). The difference goes to
-- "Opening balance equity" so the books always balance; set party and stock openings through their own functions.
create function acc_post_opening(p_date date, p_lines jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; fy uuid; lines jsonb := '[]'; l jsonb; a acc_accounts; net numeric := 0; amt numeric; jid uuid;
begin
  tid := acc_guard('acc_admin');
  fy := acc_assert_open(tid, p_date);
  for l in select * from jsonb_array_elements(p_lines) loop
    select * into a from acc_accounts where id = (l->>'account_id')::uuid and tenant_id = tid;
    if a.id is null then raise exception 'Unknown account'; end if;
    if a.type in ('income', 'expense') then raise exception 'Opening balances are for balance-sheet accounts, not %', a.name; end if;
    if a.system_key in ('ar', 'ap', 'inventory') then raise exception '% opens through customers/suppliers/stock, not here', a.name; end if;
    amt := coalesce((l->>'debit')::numeric, 0) - coalesce((l->>'credit')::numeric, 0);
    lines := acc_jl(lines, a.id, null, amt); net := net + amt;
  end loop;
  lines := acc_jl(lines, acc_sys(tid, 'opening_equity'), null, -net);
  jid := acc_post_journal(tid, 'opening', p_date, fy, null, 'Opening balances', 'opening', null, lines);
  perform acc_audit_log(tid, 'create', 'opening', jid::text, null, jsonb_build_object('date', p_date, 'balancing', -net));
  return jsonb_build_object('journal_id', jid);
end $$;

-- A customer's / supplier's opening outstanding becomes a real (tax-free) opening invoice/bill so it can be
-- settled, aged and statemented like any other document.
create function acc_set_party_opening(p_party uuid, p_amount numeric, p_date date) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; pa acc_parties; did uuid := gen_random_uuid(); fy uuid; jid uuid; lines jsonb := '[]'; t text; num text;
begin
  tid := acc_guard('acc_admin');
  select * into pa from acc_parties where id = p_party and tenant_id = tid;
  if pa.id is null then raise exception 'Unknown party'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Opening balance must be greater than zero'; end if;
  fy := acc_assert_open(tid, p_date);
  t := case when pa.kind = 'supplier' then 'bill' else 'invoice' end;
  num := acc_next_no(tid, case when t = 'bill' then 'OBB' else 'OBI' end, fy);
  if t = 'invoice' then lines := acc_jl(acc_jl(lines, acc_sys(tid, 'ar'), pa.id, p_amount), acc_sys(tid, 'opening_equity'), null, -p_amount);
  else lines := acc_jl(acc_jl(lines, acc_sys(tid, 'opening_equity'), null, p_amount), acc_sys(tid, 'ap'), pa.id, -p_amount); end if;
  jid := acc_post_journal(tid, 'opening', p_date, fy, null, 'Opening balance - ' || pa.name, 'document', did, lines);
  insert into acc_documents (id, tenant_id, doc_type, number, doc_date, due_date, fy_id, party_id, party_name, taxable, subtotal, total, status, is_opening, journal_id, created_by, notes)
  values (did, tid, t, num, p_date, p_date, fy, pa.id, pa.name, p_amount, p_amount, p_amount, 'posted', true, jid, app_uid(), 'Opening balance');
  perform acc_audit_log(tid, 'create', 'opening_balance', did::text, null, jsonb_build_object('party', pa.name, 'amount', p_amount));
  return jsonb_build_object('id', did, 'number', num);
end $$;

-- ---------- stock operations ----------
create function acc_stock_adjust(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; d date := coalesce(nullif(p->>'date', '')::date, current_date); fy uuid; wid uuid; l jsonb; pr acc_products; q numeric; cur numeric; cost numeric; mode text := coalesce(p->>'mode', 'delta');
  lines jsonb := '[]'; net numeric := 0; kind text; sid uuid := gen_random_uuid(); jid uuid; n int := 0; reason text := coalesce(nullif(p->>'reason', ''), 'Stock adjustment'); opening boolean := coalesce((p->>'opening')::boolean, false);
begin
  tid := acc_guard('acc_inventory');
  fy := acc_assert_open(tid, d);
  wid := acc_default_wh(tid, nullif(p->>'warehouse_id', '')::uuid);
  for l in select * from jsonb_array_elements(coalesce(p->'lines', '[]')) loop
    select * into pr from acc_products where id = (l->>'product_id')::uuid and tenant_id = tid;
    if pr.id is null then raise exception 'Unknown product'; end if;
    if pr.is_service or not pr.track_stock then raise exception '% does not track stock', pr.name; end if;
    q := (l->>'qty')::numeric;
    if mode = 'count' then cur := acc_stock_qty(tid, pr.id, wid); q := q - cur; end if;     -- counted quantity -> difference
    if q = 0 then continue; end if;
    cost := case when q > 0 then coalesce(nullif(l->>'unit_cost', '')::numeric, case when opening then pr.purchase_price else acc_avg_cost(tid, pr.id) end) else acc_avg_cost(tid, pr.id) end;
    kind := case when opening then 'opening' when q > 0 then 'stock_in' else 'stock_out' end;
    perform acc_stock_move(tid, pr.id, wid, d, q, cost, case when mode = 'count' then 'adjustment' else kind end, 'adjust', sid, nullif(l->>'batch_no', ''), nullif(l->>'serial_nos', ''), nullif(l->>'expiry', '')::date, reason);
    net := net + round(q * cost, 2); n := n + 1;
  end loop;
  if n = 0 then raise exception 'Nothing to adjust'; end if;
  lines := acc_jl(lines, acc_sys(tid, 'inventory'), null, net);
  lines := acc_jl(lines, acc_sys(tid, case when opening then 'opening_equity' else 'stock_adjust' end), null, -net);
  jid := acc_post_journal(tid, 'stock', d, fy, null, reason, 'adjust', sid, lines);
  perform acc_audit_log(tid, 'create', 'stock_adjust', sid::text, null, jsonb_build_object('lines', n, 'value', net, 'reason', reason));
  return jsonb_build_object('journal_id', jid, 'lines', n, 'value', net);
end $$;

create function acc_stock_transfer(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; d date := coalesce(nullif(p->>'date', '')::date, current_date); src uuid; dst uuid; l jsonb; pr acc_products; q numeric; cost numeric; sid uuid := gen_random_uuid(); n int := 0;
begin
  tid := acc_guard('acc_inventory');
  perform acc_assert_open(tid, d);
  src := (p->>'from_warehouse')::uuid; dst := (p->>'to_warehouse')::uuid;
  if src is null or dst is null or src = dst then raise exception 'Choose two different warehouses'; end if;
  if (select count(*) from acc_warehouses where tenant_id = tid and id in (src, dst)) <> 2 then raise exception 'Unknown warehouse'; end if;
  for l in select * from jsonb_array_elements(coalesce(p->'lines', '[]')) loop
    select * into pr from acc_products where id = (l->>'product_id')::uuid and tenant_id = tid;
    q := (l->>'qty')::numeric;
    if pr.id is null or q is null or q <= 0 then raise exception 'Invalid transfer line'; end if;
    cost := acc_avg_cost(tid, pr.id);
    perform acc_stock_move(tid, pr.id, src, d, -q, cost, 'transfer_out', 'transfer', sid, null, null, null, p->>'note');
    perform acc_stock_move(tid, pr.id, dst, d, q, cost, 'transfer_in', 'transfer', sid, null, null, null, p->>'note');
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'Nothing to transfer'; end if;
  perform acc_audit_log(tid, 'create', 'stock_transfer', sid::text, null, jsonb_build_object('lines', n));
  return jsonb_build_object('id', sid, 'lines', n);
end $$;

-- ---------- grants: only the SQL-callable surface ----------
revoke all on function acc_do_post(uuid, uuid, jsonb), acc_do_payment(uuid, text, date, uuid, uuid, numeric, text, text, text, jsonb, uuid), acc_do_allocate(uuid, uuid, uuid, uuid, numeric, date),
  acc_post_journal(uuid, text, date, uuid, uuid, text, text, uuid, jsonb, uuid, text), acc_reverse_journal(uuid, uuid, date, text), acc_stock_move(uuid, uuid, uuid, date, numeric, numeric, text, text, uuid, text, text, date, text),
  acc_audit_log(uuid, text, text, text, jsonb, jsonb, text), acc_next_no(uuid, text, uuid), acc_assert_open(uuid, date), acc_assert_gst_open(uuid, date) from public, app;
