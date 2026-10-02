-- =========================================================
-- AUZslab Accounting live demo (same idea as db/023 / db/055):
--   https://demo-accounts.auzslab.in/accounts.html     demo-accounts@auzslab.in / Auzslab@Demo
-- Everything in it is DEMO DATA ("Demo Traders Pvt Ltd" and invented customers/suppliers), generated through the
-- real posting functions, so its books balance exactly like a client's. acc_bootstrap() rebuilds the demo tenant
-- whenever it is more than 12 hours old, so visitors can try anything.
-- =========================================================

create function acc_gstin_complete(base14 text) returns text language plpgsql immutable as $$
declare c text; chars text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'; i int;
begin
  for i in 1..36 loop
    c := substr(chars, i, 1);
    if acc_gstin_valid(base14 || c) then return base14 || c; end if;
  end loop;
  raise exception 'cannot complete GSTIN %', base14;
end $$;

create function acc_seed_demo(tid uuid) returns void language plpgsql security definer set search_path = public as $$
declare
  uid uuid; d0 date := current_date - 112; fy0 date; bank uuid; cash uuid; capital uuid; wh_main uuid; wh_shop uuid;
  cust uuid[] := '{}'; sup uuid[] := '{}'; prod uuid[] := '{}'; skus text[] := array['LAP-01','MOU-01','KEY-01','MON-24','PRN-01','PAP-A4','INK-01','CHA-01','DSK-01','RICE-5','SVC-INS','SVC-AMC'];
  names text[] := array['Laptop 14 inch i5','Wireless mouse','Keyboard','Monitor 24 inch','Laser printer','A4 paper ream','Ink cartridge','Office chair','Desk 4 ft','Basmati rice 5 kg','Installation service','Annual maintenance'];
  hsns text[] := array['8471','8471','8471','8528','8443','4802','3215','9401','9403','1006','998719','998719'];
  trates numeric[] := array[18,18,18,18,18,12,18,18,18,5,18,18];
  sprices numeric[] := array[52000,699,1199,9800,14500,420,950,6200,7800,620,1500,12000];
  bprices numeric[] := array[43000,420,760,7600,11200,310,640,4300,5600,510,0,0];
  i int; j int; k int; n int; pid uuid; r jsonb; lines jsonb; dt date; party uuid; qty numeric; amt numeric; res jsonb; pay jsonb; docid uuid;
  cn text[] := array['Sharma Enterprises','Jodhpur Tech Solutions','Mehta and Sons','Delhi Infotech Pvt Ltd','Mumbai Retail Hub','City Hospital Trust'];
  cs text[] := array['08','08','08','07','27','08']; cp text[] := array['AABCS1234F','AABCJ5678K','','AABCD9012L','AABCM3456P',''];
  sn text[] := array['Rajasthan IT Distributors','Gurgaon Peripherals','Paper World','Furniture Mart'];
  ss text[] := array['08','06','08','07']; sp text[] := array['AAECR1111A','AAECG2222B','AAECP3333C','AAECF4444D'];
  v_tot numeric; seen int := 0; skipped int := 0; inv uuid; first_err text;
begin
  select id into uid from auth_users where email = 'demo-accounts@auzslab.in';
  if uid is null then return; end if;
  perform set_config('app.uid', uid::text, true);
  perform acc_seed_tenant(tid);
  fy0 := acc_period_start(tid, d0);
  select id into bank from acc_accounts where tenant_id = tid and system_key = 'bank';
  select id into cash from acc_accounts where tenant_id = tid and system_key = 'cash';
  select id into capital from acc_accounts where tenant_id = tid and system_key = 'capital';
  select id into wh_main from acc_warehouses where tenant_id = tid and code = 'MAIN';
  perform acc_save_warehouse(jsonb_build_object('code', 'SHOP', 'name', 'Retail shop'));
  select id into wh_shop from acc_warehouses where tenant_id = tid and code = 'SHOP';

  update acc_org set legal_name = 'Demo Traders Pvt Ltd (DEMO DATA)', trade_name = 'Demo Traders', gstin = acc_gstin_complete('08AABCD1234E1Z'), pan = 'AABCD1234E', state_code = '08',
    address = '12 Industrial Area, Basni', city = 'Jodhpur', pincode = '342005', phone = '0291 0000000', email = 'accounts@demo-traders.example',
    invoice_terms = 'Goods once sold will not be taken back. Payment within the due date. Subject to Jodhpur jurisdiction.', bank_details = 'DEMO BANK, A/c 000000000000, IFSC DEMO0000000',
    settings = jsonb_build_object('demo_seeded_at', extract(epoch from now()), 'einvoice_enabled', false)
  where tenant_id = tid;

  -- opening balances at the start of the data window
  perform acc_post_opening(d0, jsonb_build_array(jsonb_build_object('account_id', bank, 'debit', 2500000), jsonb_build_object('account_id', cash, 'debit', 25000), jsonb_build_object('account_id', capital, 'credit', 2525000)));

  for i in 1..6 loop
    r := acc_save_party(jsonb_build_object('kind', 'customer', 'name', cn[i], 'state_code', cs[i], 'credit_days', case when i % 2 = 0 then 15 else 30 end, 'credit_limit', case when i = 3 then 150000 else 0 end,
        'gstin', case when cp[i] = '' then null else acc_gstin_complete(cs[i] || cp[i] || '1Z') end, 'phone', '98' || lpad((1000000 + i * 7919)::text, 8, '0'), 'email', lower(replace(cn[i], ' ', '.')) || '@example.com',
        'billing_address', 'Demo address ' || i || ', ' || case cs[i] when '08' then 'Jodhpur' when '07' then 'New Delhi' else 'Mumbai' end));
    cust := cust || (r->>'id')::uuid;
  end loop;
  for i in 1..4 loop
    r := acc_save_party(jsonb_build_object('kind', 'supplier', 'name', sn[i], 'state_code', ss[i], 'reg_type', 'regular', 'credit_days', 30, 'gstin', acc_gstin_complete(ss[i] || sp[i] || '1Z'), 'billing_address', 'Supplier address ' || i));
    sup := sup || (r->>'id')::uuid;
  end loop;
  for i in 1..12 loop
    r := acc_save_product(jsonb_build_object('sku', skus[i], 'name', names[i], 'hsn', hsns[i], 'tax_rate', trates[i], 'sale_price', sprices[i], 'purchase_price', bprices[i], 'unit', case when skus[i] = 'PAP-A4' or skus[i] = 'RICE-5' then 'Pack' else 'Nos' end,
        'is_service', skus[i] like 'SVC-%', 'category', case when skus[i] like 'SVC-%' then 'Services' when i <= 5 then 'Electronics' when i = 10 then 'Grocery' else 'Office' end, 'reorder_level', case when skus[i] like 'SVC-%' then 0 else 8 end));
    prod := prod || (r->>'id')::uuid;
  end loop;

  -- opening stock
  lines := '[]';
  for i in 1..10 loop lines := lines || jsonb_build_array(jsonb_build_object('product_id', prod[i], 'qty', case when i in (1, 4, 5) then 12 when i in (8, 9) then 20 else 80 end, 'unit_cost', bprices[i])); end loop;
  perform acc_stock_adjust(jsonb_build_object('date', d0, 'warehouse_id', wh_main, 'opening', true, 'reason', 'Opening stock', 'lines', lines));

  -- purchases: one every ~12 days, part-paid by bank
  for i in 1..8 loop
    dt := d0 + 6 + i * 12;
    exit when dt > current_date;
    begin
      lines := '[]';
      for j in 0..2 loop
        k := ((i + j * 3) % 10) + 1;
        lines := lines || jsonb_build_array(jsonb_build_object('product_id', prod[k], 'qty', case when k in (1, 4, 5) then 4 + j else 25 + j * 10 end, 'rate', bprices[k], 'batch_no', 'B' || to_char(dt, 'YYMM')));
      end loop;
      res := acc_save_document(jsonb_build_object('doc_type', 'bill', 'doc_date', dt, 'party_id', sup[((i - 1) % 4) + 1], 'supplier_ref', 'SUP/' || (1000 + i), 'supplier_ref_date', dt, 'post', true, 'lines', lines));
      v_tot := (res->>'total')::numeric;
      if i % 3 <> 0 then
        perform acc_save_payment(jsonb_build_object('kind', 'payment', 'party_id', sup[((i - 1) % 4) + 1], 'account_id', bank, 'amount', case when i % 2 = 0 then v_tot else round(v_tot / 2, 0) end, 'date', dt + 10, 'mode', 'NEFT', 'reference', 'UTR' || (700000 + i),
          'allocations', jsonb_build_array(jsonb_build_object('doc_id', res->>'id', 'amount', case when i % 2 = 0 then v_tot else round(v_tot / 2, 0) end))));
      end if;
    exception when others then skipped := skipped + 1; first_err := coalesce(first_err, sqlerrm);
    end;
  end loop;

  -- sales: about one every 2.5 days across customers and the walk-in
  for i in 1..44 loop
    dt := d0 + 8 + floor(i * 103.0 / 44)::int;
    exit when dt > current_date;
    begin
      lines := '[]'; n := 1 + (i % 3);
      for j in 0..(n - 1) loop
        k := ((i * 5 + j * 7) % 12) + 1;
        qty := case when k in (1, 4, 5, 8, 9) then 1 + ((i + j) % 2) when k in (11, 12) then 1 else 2 + ((i * 3 + j) % 6) end;
        lines := lines || jsonb_build_array(jsonb_build_object('product_id', prod[k], 'qty', qty, 'disc_pct', case when i % 7 = 0 then 5 else 0 end));
      end loop;
      party := case when i % 9 = 0 then null else cust[((i - 1) % 6) + 1] end;
      pay := case when party is null then jsonb_build_array(jsonb_build_object('account_id', cash, 'amount', 999999, 'mode', 'Cash'))
                  when i % 3 = 0 then jsonb_build_array(jsonb_build_object('account_id', bank, 'amount', 999999, 'mode', 'UPI', 'reference', 'UPI' || (500000 + i)))
                  when i % 3 = 1 then jsonb_build_array(jsonb_build_object('account_id', bank, 'amount', 5000, 'mode', 'NEFT', 'reference', 'NEFT' || (300000 + i)))
                  else '[]'::jsonb end;
      -- walk-in / UPI sales are settled in full: use the exact total (a first dry pass would double-post, so size it after saving)
      res := acc_save_document(jsonb_build_object('doc_type', 'invoice', 'doc_date', dt, 'party_id', party, 'post', false, 'lines', lines));
      docid := (res->>'id')::uuid;
      v_tot := (res->>'total')::numeric;
      if jsonb_array_length(pay) > 0 and (pay->0->>'amount')::numeric = 999999 then pay := jsonb_build_array(jsonb_set(pay->0, '{amount}', to_jsonb(v_tot))); end if;
      if jsonb_array_length(pay) > 0 and (pay->0->>'amount')::numeric > v_tot then pay := jsonb_build_array(jsonb_set(pay->0, '{amount}', to_jsonb(v_tot))); end if;
      perform acc_post_document(docid, pay);
      seen := seen + 1;
    exception when others then skipped := skipped + 1; first_err := coalesce(first_err, sqlerrm);
    end;
  end loop;

  -- collections on older credit invoices (oldest-first), leaving the recent ones outstanding and a few overdue
  for i in 1..6 loop
    begin
      select coalesce(sum(total - paid), 0) into amt from acc_documents where tenant_id = tid and party_id = cust[i] and doc_type = 'invoice' and status = 'posted' and doc_date < current_date - 40;
      if amt > 0 then
        perform acc_save_payment(jsonb_build_object('kind', 'receipt', 'party_id', cust[i], 'account_id', bank, 'amount', round(amt * case when i % 2 = 0 then 1 else 0.6 end, 0), 'date', current_date - 12 - i, 'mode', 'NEFT', 'reference', 'COLL' || (900000 + i), 'auto_allocate', true));
      end if;
    exception when others then skipped := skipped + 1; first_err := coalesce(first_err, sqlerrm);
    end;
  end loop;

  -- expenses (no vendor -> walk-in), settled from the bank
  for i in 0..3 loop
    dt := (date_trunc('month', current_date) - (i || ' months')::interval)::date + 4;
    continue when dt > current_date or dt < d0;
    begin
      perform acc_save_document(jsonb_build_object('doc_type', 'expense', 'doc_date', dt, 'post', true, 'notes', 'Shop rent', 'lines', jsonb_build_array(jsonb_build_object('description', 'Shop rent', 'account_id', (select id from acc_accounts where tenant_id = tid and code = '5100'), 'qty', 1, 'rate', 18000, 'tax_rate', 0)),
        'payments', jsonb_build_array(jsonb_build_object('account_id', bank, 'amount', 18000, 'mode', 'NEFT'))));
      perform acc_save_document(jsonb_build_object('doc_type', 'expense', 'doc_date', dt + 3, 'post', true, 'notes', 'Electricity bill', 'lines', jsonb_build_array(jsonb_build_object('description', 'Electricity', 'account_id', (select id from acc_accounts where tenant_id = tid and code = '5102'), 'qty', 1, 'rate', 6400 + i * 350, 'tax_rate', 18)),
        'payments', jsonb_build_array(jsonb_build_object('account_id', bank, 'amount', round((6400 + i * 350) * 1.18, 0), 'mode', 'UPI'))));
      perform acc_save_document(jsonb_build_object('doc_type', 'expense', 'doc_date', dt + 8, 'post', true, 'notes', 'Salaries', 'lines', jsonb_build_array(jsonb_build_object('description', 'Staff salaries', 'account_id', (select id from acc_accounts where tenant_id = tid and code = '5101'), 'qty', 1, 'rate', 32000, 'tax_rate', 0)),
        'payments', jsonb_build_array(jsonb_build_object('account_id', bank, 'amount', 32000, 'mode', 'NEFT'))));
      perform acc_save_document(jsonb_build_object('doc_type', 'expense', 'doc_date', dt + 12, 'post', true, 'notes', 'Local delivery', 'lines', jsonb_build_array(jsonb_build_object('description', 'Transport', 'account_id', (select id from acc_accounts where tenant_id = tid and code = '5104'), 'qty', 1, 'rate', 2200, 'tax_rate', 5)),
        'payments', jsonb_build_array(jsonb_build_object('account_id', cash, 'amount', 2310, 'mode', 'Cash'))));
    exception when others then skipped := skipped + 1; first_err := coalesce(first_err, sqlerrm);
    end;
  end loop;

  -- a credit note, a debit note, a cancelled invoice, a draft, a quotation and a sales order
  begin
    select id into inv from acc_documents where tenant_id = tid and doc_type = 'invoice' and status = 'posted' and party_id = cust[1] order by doc_date limit 1;
    if inv is not null then
      perform acc_save_document(jsonb_build_object('doc_type', 'credit_note', 'doc_date', current_date - 20, 'party_id', cust[1], 'ref_doc_id', inv, 'post', true,
        'lines', (select jsonb_agg(jsonb_build_object('product_id', product_id, 'qty', 1, 'rate', rate)) from (select product_id, rate from acc_doc_lines where doc_id = inv and product_id is not null limit 1) x)));
    end if;
  exception when others then skipped := skipped + 1; first_err := coalesce(first_err, sqlerrm);
  end;
  begin
    select id into inv from acc_documents where tenant_id = tid and doc_type = 'bill' and status = 'posted' order by doc_date desc limit 1;
    perform acc_save_document(jsonb_build_object('doc_type', 'debit_note', 'doc_date', current_date - 5, 'party_id', (select party_id from acc_documents where id = inv), 'ref_doc_id', inv, 'post', true,
      'lines', (select jsonb_agg(jsonb_build_object('product_id', product_id, 'qty', 1, 'rate', rate)) from (select product_id, rate from acc_doc_lines where doc_id = inv and product_id is not null limit 1) x)));
  exception when others then skipped := skipped + 1; first_err := coalesce(first_err, sqlerrm);
  end;
  begin
    res := acc_save_document(jsonb_build_object('doc_type', 'invoice', 'doc_date', current_date - 9, 'party_id', cust[5], 'post', true, 'lines', jsonb_build_array(jsonb_build_object('product_id', prod[3], 'qty', 2))));
    perform acc_cancel_document((res->>'id')::uuid, 'Customer changed the order (demo)');
  exception when others then skipped := skipped + 1; first_err := coalesce(first_err, sqlerrm);
  end;
  begin
    perform acc_save_document(jsonb_build_object('doc_type', 'invoice', 'doc_date', current_date, 'party_id', cust[2], 'post', false, 'lines', jsonb_build_array(jsonb_build_object('product_id', prod[12], 'qty', 1))));
    perform acc_save_document(jsonb_build_object('doc_type', 'quotation', 'doc_date', current_date - 2, 'party_id', cust[4], 'notes', 'Valid for 15 days', 'lines', jsonb_build_array(jsonb_build_object('product_id', prod[1], 'qty', 3), jsonb_build_object('product_id', prod[11], 'qty', 3))));
    res := acc_save_document(jsonb_build_object('doc_type', 'sales_order', 'doc_date', current_date - 1, 'party_id', cust[3], 'lines', jsonb_build_array(jsonb_build_object('product_id', prod[4], 'qty', 4))));
    perform acc_save_document(jsonb_build_object('doc_type', 'purchase_order', 'doc_date', current_date - 1, 'party_id', sup[1], 'lines', jsonb_build_array(jsonb_build_object('product_id', prod[1], 'qty', 6, 'rate', 43000))));
  exception when others then skipped := skipped + 1; first_err := coalesce(first_err, sqlerrm);
  end;

  -- fixed asset and depreciation
  begin
    perform acc_save_asset(jsonb_build_object('name', 'Delivery scooter', 'class', 'Vehicles', 'cost', 96000, 'acquisition_date', d0 + 20, 'life_years', 8, 'pay_account_id', bank, 'location', 'Shop', 'custodian', 'Store manager'));
    for i in 0..3 loop
      perform acc_run_depreciation((date_trunc('month', current_date) - ((3 - i) || ' months')::interval)::date);
    end loop;
  exception when others then skipped := skipped + 1; first_err := coalesce(first_err, sqlerrm);
  end;

  -- bank statement for the last 60 days: most lines present, one cheque not yet cleared, a bank charge and an unknown credit
  begin
    insert into acc_bank_txns (tenant_id, account_id, txn_date, description, reference, debit, credit, import_batch, dedupe_hash)
    select tid, bank, j.jdate, left(coalesce(pm.mode || ' ' || pa.name, j.narration), 120), pm.reference, jl.credit, jl.debit, 'demo', md5(jl.id::text)
    from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id left join acc_payments pm on j.source_type = 'payment' and pm.id = j.source_id left join acc_parties pa on pa.id = pm.party_id
    where jl.tenant_id = tid and jl.account_id = bank and j.jdate >= current_date - 60 and j.voucher_type <> 'opening' and j.jdate < current_date - 3 and (jl.id % 11) <> 0;
    insert into acc_bank_txns (tenant_id, account_id, txn_date, description, debit, credit, import_batch, dedupe_hash) values
      (tid, bank, current_date - 30, 'SMS and service charges', 118, 0, 'demo', md5('demo-charge')), (tid, bank, current_date - 18, 'NEFT credit - unidentified', 0, 12500, 'demo', md5('demo-unknown'));
    perform acc_bank_automatch(tid, bank);
  exception when others then skipped := skipped + 1; first_err := coalesce(first_err, sqlerrm);
  end;

  -- budget for this financial year: sales and the main expenses
  begin
    for i in 1..12 loop
      perform acc_save_budget((select id from acc_fy where tenant_id = tid and current_date between start_date and end_date), jsonb_build_array(
        jsonb_build_object('account_id', (select id from acc_accounts where tenant_id = tid and system_key = 'sales'), 'month', i, 'amount', 300000),
        jsonb_build_object('account_id', (select id from acc_accounts where tenant_id = tid and code = '5100'), 'month', i, 'amount', 18000),
        jsonb_build_object('account_id', (select id from acc_accounts where tenant_id = tid and code = '5101'), 'month', i, 'amount', 32000)));
    end loop;
  exception when others then skipped := skipped + 1; first_err := coalesce(first_err, sqlerrm);
  end;

  update acc_org set settings = settings || jsonb_build_object('seed_skipped', skipped, 'seed_sales', seen, 'seed_error', first_err) where tenant_id = tid;
end $$;

-- wipes the demo tenant's books and rebuilds them (only ever for a tenant flagged is_demo)
create function acc_reset_demo(tid uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from tenants where id = tid and is_demo) then raise exception 'Not a demo tenant'; end if;
  perform set_config('acc.reset', '1', true);
  update acc_bank_txns set recon_id = null where tenant_id = tid;
  delete from acc_saved_views where tenant_id = tid; delete from acc_attachments where tenant_id = tid; delete from acc_comms where tenant_id = tid; delete from acc_gst_recon where tenant_id = tid;
  delete from acc_gst_periods where tenant_id = tid; delete from acc_eway where tenant_id = tid; delete from acc_einvoice where tenant_id = tid; delete from acc_depreciation where tenant_id = tid;
  delete from acc_fixed_assets where tenant_id = tid; delete from acc_budgets where tenant_id = tid; delete from acc_bank_txns where tenant_id = tid; delete from acc_recons where tenant_id = tid;
  delete from acc_allocations where tenant_id = tid; delete from acc_payments where tenant_id = tid; delete from acc_stock_moves where tenant_id = tid; delete from acc_import_jobs where tenant_id = tid;
  update acc_documents set journal_id = null where tenant_id = tid; update acc_documents set ref_doc_id = null, source_doc_id = null where tenant_id = tid;
  delete from acc_doc_lines where tenant_id = tid; delete from acc_documents where tenant_id = tid;
  delete from acc_journal_lines where tenant_id = tid; delete from acc_journals where tenant_id = tid;
  delete from acc_series where tenant_id = tid; delete from acc_audit where tenant_id = tid;
  delete from acc_products where tenant_id = tid; delete from acc_parties where tenant_id = tid; delete from acc_masters where tenant_id = tid; delete from acc_warehouses where tenant_id = tid;
  delete from acc_branches where tenant_id = tid; delete from acc_taxcodes where tenant_id = tid; delete from acc_accounts where tenant_id = tid; delete from acc_fy where tenant_id = tid; delete from acc_org where tenant_id = tid;
  perform acc_seed_demo(tid);
end $$;

-- acc_bootstrap again: a demo tenant that is missing or older than 12 hours is rebuilt first
create or replace function acc_bootstrap() returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; demo boolean; seeded numeric; owner_uid text;
begin
  tid := (me()->>'tenant_id')::uuid;
  if tid is not null then
    select is_demo into demo from tenants where id = tid;
    if demo and coalesce((select features->>'accounting' from tenant_settings where tenant_id = tid), 'false') = 'true' then
      select (settings->>'demo_seeded_at')::numeric into seeded from acc_org where tenant_id = tid;
      if (seeded is null or extract(epoch from now()) - seeded > 12 * 3600) and pg_try_advisory_xact_lock(hashtext('acc_demo_reset')) then
        owner_uid := current_setting('app.uid', true);
        if exists (select 1 from acc_org where tenant_id = tid) then perform acc_reset_demo(tid); else perform acc_seed_demo(tid); end if;
        perform set_config('app.uid', owner_uid, true);
      end if;
    end if;
  end if;
  tid := acc_guard('acc_view');
  if not exists (select 1 from acc_org where tenant_id = tid) then
    if not acc_perm('acc_admin') then raise exception 'Accounting has not been set up yet - ask the owner to open it once'; end if;
    perform acc_seed_tenant(tid);
    perform acc_audit_log(tid, 'setup', 'org', tid::text, null, jsonb_build_object('note', 'Accounting set up'));
  end if;
  return acc_context();
end $$;

-- the demo tenant itself
do $$
declare tid uuid; uid uuid; demo_hash text := '$2b$12$xOTBlE6KbXc6ssgD7TAFGueYsQpjPvYk0TRAPdSuWPj9ymGucsRlK';
begin
  insert into tenants (slug, name, niche, plan, status, is_demo) values ('demo-accounts', 'AUZslab Accounting Demo', 'general', 'pro', 'active', true) on conflict (slug) do nothing returning id into tid;
  if tid is null then select id into tid from tenants where slug = 'demo-accounts'; end if;
  update tenants set is_demo = true where id = tid;
  insert into tenant_settings (tenant_id, features, labels, business_rules)
    select tid, '{"accounting": true}'::jsonb, p.default_labels, p.default_business_rules from niche_presets p where p.niche = 'general'
    on conflict (tenant_id) do update set features = tenant_settings.features || '{"accounting": true}'::jsonb;
  select id into uid from auth_users where email = 'demo-accounts@auzslab.in';
  if uid is null then
    insert into auth_users (email, password_hash, app_metadata) values ('demo-accounts@auzslab.in', demo_hash, jsonb_build_object('tenant_id', tid, 'role', 'owner'));
  end if;
  perform acc_seed_demo(tid);
end $$;

grant execute on function acc_reset_demo(uuid), acc_seed_demo(uuid) to postgres;
revoke all on function acc_reset_demo(uuid), acc_seed_demo(uuid), acc_gstin_complete(text) from public, app;
