-- Owner request (explicit, twice-confirmed after being told the real GST consequence): a posted invoice/bill/expense
-- should be directly editable at any time -- no cancel-and-reissue ceremony, keeps its same number, no new document
-- created. This replaces the earlier "cancel, then start a corrected copy" flow (acc_amend_document, db/291) for
-- invoice/bill/expense with a true in-place edit: reverse the old journal + stock moves (as plain new append-only
-- rows -- acc_journals/acc_journal_lines/acc_stock_moves stay append-only, nothing here updates or deletes them),
-- rebuild the lines from the new data, and re-post under the SAME document number (acc_next_no is never called
-- again). acc_amend_document / acc_cancel_document are untouched and still work exactly as before for anyone who
-- wants the old, fully-audited flow.
--
-- Deliberately still blocked, not by our own policy but because the data has already left the business to an
-- authority that has its own copy: an e-invoice (IRN) already generated with the government, a GST return period
-- already marked filed, or a credit/debit note already issued against this exact invoice (its settlement amount was
-- computed from the OLD total and would go stale). Editing a credit_note/debit_note itself is also not supported
-- here (its own auto-settlement-against-the-original-invoice step in acc_do_post is not written to be safely
-- re-run) -- those two types still go through acc_amend_document.

-- CREATE OR REPLACE does not recognise this as the same function once a parameter is added (it matches by full
-- argument signature), so without dropping the old 3-arg one first, Postgres silently keeps BOTH as overloads --
-- and a plain 3-arg call then resolves to the stale one.
drop function if exists acc_do_post(uuid, uuid, jsonb);
create function acc_do_post(tid uuid, did uuid, pays jsonb default '[]', p_reuse_number text default null) returns jsonb language plpgsql security definer set search_path = public as $$
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
          diff := line_cost - inv_cost;
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

  numr := coalesce(case when acc_perm('acc_import') then nullif(d.meta->>'import_number', '') end, p_reuse_number, acc_next_no(tid, acc_series_key(d.doc_type), fy));
  jid := acc_post_journal(tid, case d.doc_type when 'invoice' then 'sales' when 'bill' then 'purchase' else d.doc_type end,
                          d.doc_date, fy, d.branch_id, initcap(replace(d.doc_type, '_', ' ')) || ' ' || numr || coalesce(' - ' || d.party_name, ''), 'document', did, lines);
  update acc_documents set number = numr, fy_id = fy, journal_id = jid, status = 'posted', warehouse_id = wid where id = did;

  if d.doc_type in ('credit_note', 'debit_note') and d.ref_doc_id is not null and p_reuse_number is null then
    declare orig acc_documents; amt numeric;
    begin
      select * into orig from acc_documents where id = d.ref_doc_id;
      if orig.status = 'posted' and orig.party_id = d.party_id then
        amt := least(d.total, orig.total - orig.paid);
        if amt > 0 then perform acc_do_allocate(tid, null, did, orig.id, amt, d.doc_date); end if;
      end if;
    end;
  end if;

  if p_reuse_number is null then
    for pj in select * from jsonb_array_elements(coalesce(pays, '[]')) loop
      if coalesce((pj->>'amount')::numeric, 0) <= 0 then continue; end if;
      perform acc_do_payment(tid, case when d.doc_type in ('invoice', 'debit_note') then 'receipt' else 'payment' end, d.doc_date, d.party_id,
        (pj->>'account_id')::uuid, (pj->>'amount')::numeric, pj->>'mode', pj->>'reference', null,
        jsonb_build_array(jsonb_build_object('doc_id', did, 'amount', least((pj->>'amount')::numeric, d.total - (select paid from acc_documents where id = did)))), d.branch_id);
    end loop;
  end if;

  perform acc_audit_log(tid, case when p_reuse_number is not null then 'edit_posted' else 'post' end, d.doc_type, did::text, null, jsonb_build_object('number', numr, 'total', d.total, 'journal', jid));
  return jsonb_build_object('id', did, 'number', numr, 'status', 'posted', 'journal_id', jid, 'total', d.total);
end $$;

-- Reopens an already-posted invoice/bill/expense for editing: reverses its journal and stock moves (new append-only
-- rows, never touching the old ones), flips it back to 'draft' with no journal, keeping its number, paid amount and
-- every payment allocation exactly as they are. Only acc_save_document calls this, right before it rebuilds the
-- lines -- never exposed as its own RPC.
-- acc_doc_guard (db/059) locks number/totals/journal_id on a posted document -- correctly, for a normal edit attempt.
-- Reopening on purpose needs its own narrow escape hatch, the same pattern acc_reset_demo already uses (acc.reset):
-- a transaction-local flag only acc_reopen_posted ever sets, checked nowhere else.
create or replace function acc_doc_guard() returns trigger language plpgsql as $$
begin
  if current_setting('acc.reset', true) = '1' and exists (select 1 from tenants where id = coalesce(new.tenant_id, old.tenant_id) and is_demo) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if current_setting('acc.reopen', true) = '1' then return new; end if;
  if tg_op = 'DELETE' then
    if old.status not in ('draft','open') then
      raise exception 'A % that is % cannot be deleted; cancel it instead', old.doc_type, old.status;
    end if;
    return old;
  end if;
  if old.status in ('posted','cancelled','converted','closed') then
    if (new.doc_type, new.number, new.doc_date, new.party_id, new.subtotal, new.discount, new.taxable, new.cgst, new.sgst, new.igst, new.cess, new.roundoff, new.total, new.supply_type, new.journal_id)
       is distinct from
       (old.doc_type, old.number, old.doc_date, old.party_id, old.subtotal, old.discount, old.taxable, old.cgst, old.sgst, old.igst, old.cess, old.roundoff, old.total, old.supply_type, old.journal_id)
       and not (old.journal_id is null and new.journal_id is not null) then
      raise exception 'Posted document % is locked; cancel it and create a new one', old.number;
    end if;
    if old.status = 'cancelled' and new.status <> 'cancelled' then raise exception 'A cancelled document cannot be reopened'; end if;
  end if;
  return new;
end $$;

create function acc_reopen_posted(tid uuid, did uuid) returns text language plpgsql security definer set search_path = public as $$
declare d acc_documents;
begin
  select * into d from acc_documents where id = did and tenant_id = tid for update;
  if d.doc_type not in ('invoice', 'bill', 'expense') then raise exception 'A % still needs cancel-and-reissue to edit (its settlement against another document is not safe to redo)', d.doc_type; end if;
  if exists (select 1 from acc_einvoice where doc_id = d.id and status = 'generated') then raise exception 'An e-invoice (IRN) was already filed for % with the government -- cancel the e-invoice first', d.number; end if;
  if exists (select 1 from acc_documents where ref_doc_id = d.id and status = 'posted') then raise exception '% has a credit/debit note against it -- cancel that first, then edit', d.number; end if;
  perform acc_assert_gst_open(tid, d.doc_date);   -- a filed GST return period stays locked, same as any other post
  perform set_config('acc.reopen', '1', true);     -- transaction-local; lets this reopen, and the re-save/re-post right after it in the same call, through the guard
  perform acc_reverse_journal(tid, d.journal_id, d.doc_date, 'edited');
  insert into acc_stock_moves (tenant_id, product_id, warehouse_id, move_date, qty, unit_cost, kind, source_type, source_id, note, created_by)
    select tid, product_id, warehouse_id, d.doc_date, -qty, unit_cost, 'reversal', 'document', d.id, 'Edited ' || d.number, app_uid()
    from acc_stock_moves where tenant_id = tid and source_type = 'document' and source_id = d.id and kind <> 'reversal';
  update acc_documents set status = 'draft', journal_id = null where id = d.id;
  return d.number;
end $$;

create or replace function acc_save_document(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; dt text := p->>'doc_type'; perm text; o acc_org; existing acc_documents; did uuid; party acc_parties; l jsonb; i int := 0;
  dd date; due date; pos text; supply text; origin text; inc boolean; v_qty numeric; v_rate numeric; gross numeric; dpct numeric; damt numeric; net numeric;
  trate numeric; cpct numeric; txb numeric; tx numeric; cg numeric; sg numeric; ig numeric; cs numeric; prod acc_products; k_sales boolean; rev boolean;
  s_sub numeric := 0; s_disc numeric := 0; s_tax numeric := 0; s_cg numeric := 0; s_sg numeric := 0; s_ig numeric := 0; s_cs numeric := 0; v_total numeric; ro numeric;
  fy uuid; num text; zero_tax boolean := false; nstatus text; thr numeric; res jsonb; allow_post boolean; reuse_no text := null; was_posted boolean := false; prior_paid numeric := 0;
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

  -- existing document? a draft/open one is edited in place as before; a posted invoice/bill/expense is reopened
  -- first (db/311) -- same number, journal and stock reversed and rebuilt, payments and their allocations untouched
  if nullif(p->>'id', '') is not null then
    select * into existing from acc_documents where id = (p->>'id')::uuid and tenant_id = tid for update;
    if existing.id is null then raise exception 'Document not found'; end if;
    if existing.doc_type <> dt then raise exception 'Document type cannot change'; end if;
    if existing.status = 'posted' then
      was_posted := true; prior_paid := existing.paid; reuse_no := existing.number;
      perform acc_reopen_posted(tid, existing.id);
      select * into existing from acc_documents where id = existing.id;
    elsif existing.status not in ('draft', 'open') then
      raise exception '% is % and can no longer be edited', existing.number, existing.status;
    end if;
    delete from acc_doc_lines where doc_id = existing.id;
  end if;

  -- GST: intra vs inter
  if k_sales then
    origin := coalesce((select state_code from acc_branches where id = nullif(p->>'branch_id', '')::uuid), o.state_code);
    pos := coalesce(nullif(p->>'place_of_supply', ''), party.state_code, origin);
    supply := case when origin is not null and pos is not null and origin <> pos then 'inter' else 'intra' end;
    if party.reg_type = 'overseas' then supply := 'inter'; zero_tax := true; end if;
    if o.reg_type <> 'regular' then zero_tax := true; end if;
  else
    pos := coalesce(nullif(p->>'place_of_supply', ''), o.state_code);
    supply := case when party.state_code is not null and o.state_code is not null and party.state_code <> o.state_code then 'inter' else 'intra' end;
    if party.reg_type = 'overseas' then supply := 'inter'; end if;
    if party.reg_type = 'composition' then zero_tax := true; end if;
  end if;
  rev := coalesce((p->>'reverse_charge')::boolean, false);
  inc := coalesce((p->>'price_includes_tax')::boolean, false);
  due := coalesce(nullif(p->>'due_date', '')::date, dd + coalesce(party.credit_days, 0));

  -- header row (number: drafts of posting documents get a placeholder; the real, gapless number is taken at posting
  -- -- unless this is a reopened posted document, which keeps the number it already had)
  if existing.id is not null then
    did := existing.id; num := existing.number;
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
  if rev and not k_sales then v_total := s_tax; end if;
  if p ? 'roundoff' and nullif(p->>'roundoff', '') is not null then ro := round((p->>'roundoff')::numeric, 2);
  elsif k_sales and o.round_off_sales then ro := round(v_total, 0) - v_total;
  else ro := 0; end if;
  v_total := v_total + ro;

  if was_posted and v_total < prior_paid then
    raise exception 'Already received % against %; that is more than the new total % -- adjust or unlink the payment first', prior_paid, reuse_no, v_total;
  end if;

  -- approvals: a user without acc_approve can save but not post above the org's threshold
  thr := coalesce(nullif(o.settings->>'approval_threshold', '')::numeric, 0);
  allow_post := was_posted or coalesce((p->>'post')::boolean, false);   -- a reopened posted document always goes straight back to posted
  nstatus := null;
  if allow_post and not was_posted and thr > 0 and v_total > thr and not acc_perm('acc_approve') then
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
    res := acc_do_post(tid, did, p->'payments', reuse_no);
    return res || jsonb_build_object('posted', true);
  end if;
  return jsonb_build_object('id', did, 'number', (select number from acc_documents where id = did), 'status', (select status from acc_documents where id = did), 'total', v_total,
    'posted', false, 'pending_approval', nstatus is not null);
end $$;
