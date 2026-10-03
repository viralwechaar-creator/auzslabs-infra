-- =========================================================
-- Consolidate the three separate demo tenants (demo-cafe, demo-retail,
-- demo-accounts) into ONE demo account that shows off POS, Payroll and
-- Accounting from a single login. demo-salon is a different product
-- entirely (its own front-end app, app/public/salon/) and is left alone.
--
-- Reuses the demo-cafe tenant row (richest POS catalog: tables, KOT-ready
-- categories) rather than creating a new tenant from scratch -- renamed
-- to slug 'demo', with self_order/payroll/accounting merged into its
-- features and a couple of demo-retail's variant-stock items added so
-- retail-flavoured marketing pages still have something relevant to
-- point at. demo-retail and demo-accounts are then deleted outright,
-- cascade and all.
--
-- New login: demo@auzslab.in / Auzslab@Demo (same shared demo password
-- hash as every other demo tenant, db/025_demo_password_reset.sql).
-- =========================================================

do $$
declare
  cafe_tid uuid;
  retail_tid uuid;
  accounts_tid uuid;
  owner_uid uuid;
  demo_hash text := '$2b$12$xOTBlE6KbXc6ssgD7TAFGueYsQpjPvYk0TRAPdSuWPj9ymGucsRlK';
begin
  select id into cafe_tid from tenants where slug = 'demo-cafe';
  if cafe_tid is null then
    raise notice 'demo-cafe tenant not found, nothing to consolidate';
    return;
  end if;

  -- ---- rename demo-cafe into the single consolidated demo tenant ----
  update tenants set slug = 'demo', name = 'AUZslab Demo' where id = cafe_tid;

  update tenant_settings
    set features = features || '{"self_order":true,"payroll":true,"accounting":true}'::jsonb
    where tenant_id = cafe_tid;

  -- ---- one login for everything: demo@auzslab.in ----
  if not exists (select 1 from auth_users where email = 'demo@auzslab.in') then
    insert into auth_users (email, password_hash, app_metadata)
      values ('demo@auzslab.in', demo_hash, jsonb_build_object('tenant_id', cafe_tid, 'role', 'owner'));
  end if;
  -- retire the old per-niche login now that one login covers the tenant
  delete from auth_users where email = 'demo-cafe@auzslab.in';

  select id into owner_uid from auth_users where email = 'demo@auzslab.in';

  -- ---- enrich the catalog with demo-retail's variant-stock items, so ----
  -- ---- business-retail.html / business-clothing.html still have      ----
  -- ---- something relevant to point at                                ----
  insert into records (id, tenant_id, kind, data) values
    ('demo-cat-apparel', cafe_tid, 'cat', jsonb_build_object('id', 'demo-cat-apparel', 'name', 'Apparel', 'n', 3)),
    ('demo-item-tee', cafe_tid, 'item', jsonb_build_object(
      'id', 'demo-item-tee', 'name', 'Classic Tee', 'cat', 'demo-cat-apparel', 'price', 499, 'low', 2, 'sizes', '[]'::jsonb, 'mods', '[]'::jsonb,
      'variants', jsonb_build_array(
        jsonb_build_object('size', 'S', 'color', 'Black', 'barcode', null, 'qty', 10),
        jsonb_build_object('size', 'M', 'color', 'Black', 'barcode', null, 'qty', 12),
        jsonb_build_object('size', 'L', 'color', 'Black', 'barcode', null, 'qty', 8),
        jsonb_build_object('size', 'S', 'color', 'White', 'barcode', null, 'qty', 10),
        jsonb_build_object('size', 'M', 'color', 'White', 'barcode', null, 'qty', 12),
        jsonb_build_object('size', 'L', 'color', 'White', 'barcode', null, 'qty', 8)
      )
    )),
    ('demo-item-jeans', cafe_tid, 'item', jsonb_build_object(
      'id', 'demo-item-jeans', 'name', 'Slim Jeans', 'cat', 'demo-cat-apparel', 'price', 1299, 'low', 2, 'sizes', '[]'::jsonb, 'mods', '[]'::jsonb,
      'variants', jsonb_build_array(
        jsonb_build_object('size', '30', 'color', 'Blue', 'barcode', null, 'qty', 6),
        jsonb_build_object('size', '32', 'color', 'Blue', 'barcode', null, 'qty', 8),
        jsonb_build_object('size', '34', 'color', 'Blue', 'barcode', null, 'qty', 6)
      )
    ))
  on conflict (tenant_id, id) do nothing;

  -- ---- seed Payroll into the consolidated tenant (Accounting is seeded ----
  -- ---- below, after acc_seed_demo is generalised). demo-cafe already  ----
  -- ---- has a couple of 'legacy' employees migrated from its old hr_*  ----
  -- ---- records by pay_import_legacy (ran automatically when db/073-077----
  -- ---- first applied) -- check for pay_demo_seed's own marker row, not ----
  -- ---- "any employee at all", or this would wrongly skip seeding.      ----
  if owner_uid is not null and not exists (select 1 from pay_employees where tenant_id = cafe_tid and id = 'demo-pay-1') then
    perform set_config('app.uid', owner_uid::text, true);
    perform pay_demo_seed(cafe_tid);
  end if;

  -- ---- find the other two tenants to delete ----
  select id into retail_tid from tenants where slug = 'demo-retail';
  select id into accounts_tid from tenants where slug = 'demo-accounts';
end $$;

-- =========================================================
-- Generalise acc_seed_demo: it used to resolve its acting identity by
-- looking up the hardcoded demo-accounts@auzslab.in login, which is
-- being deleted below. Resolve the tenant's own owner instead, same as
-- any other acc_* caller would be -- this is the only change from
-- db/064_accounting_demo.sql's original definition.
-- =========================================================
create or replace function acc_seed_demo(tid uuid) returns void language plpgsql security definer set search_path = public as $$
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
  select id into uid from profiles where tenant_id = tid and role = 'owner' limit 1;
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

-- ---- seed Accounting into the consolidated tenant, now that acc_seed_demo is generalised ----
do $$
declare cafe_tid uuid;
begin
  select id into cafe_tid from tenants where slug = 'demo';
  if cafe_tid is not null and not exists (select 1 from acc_org where tenant_id = cafe_tid) then
    perform acc_seed_demo(cafe_tid);
  end if;
end $$;

-- =========================================================
-- Delete demo-retail and demo-accounts entirely. records/guest_orders/
-- invoice_counters/push_subs have no ON DELETE CASCADE from
-- tenants (see CLAUDE.md's records-table note) so they're deleted by
-- hand; everything else (tenant_settings, roles, notifications,
-- bookings, every acc_*/pos table, addon_requests) cascades from the
-- tenants row itself. auth_users is deleted first so its profiles row
-- (ON DELETE CASCADE) is gone before the tenants row goes.
--
-- pay_* and acc_* each need an explicit pass first: several of their
-- tables (pay_emp_events/pay_audit/..., acc_journals/acc_documents/...)
-- are append-only or frozen once posted, and their guard triggers only
-- lift that block while pay.reset/acc.reset is set AND the row's own
-- tenant is still_demo -- checked by re-querying `tenants` from inside
-- the trigger. That check cannot see the tenant as is_demo during a
-- CASCADE from `delete from tenants`: Postgres fires the FK's cascade
-- delete as an AFTER DELETE trigger on `tenants`, so by the time it
-- reaches acc_documents/pay_emp_games the parent row is already gone
-- and the guard's own lookup finds nothing -- it fails closed. So these
-- two modules' data has to be gone via a DIRECT delete (while the
-- tenant row still exists) before the tenants row itself is deleted;
-- cascade is only safe for every other table below.
--
-- pay_reset_demo(tid) is exactly that direct delete and is a no-op for
-- a tenant that never had payroll data. acc_reset_demo(tid) does the
-- same for acc_* but also reseeds fresh demo data at its end (meant for
-- keeping a *live* demo fresh, not for deleting one) -- inlined here
-- without that reseed call instead of reusing it as-is.
-- =========================================================
do $$
declare tid uuid;
begin
  for tid in select id from tenants where slug in ('demo-retail', 'demo-accounts') loop
    perform pay_reset_demo(tid);
    if exists (select 1 from acc_org where tenant_id = tid) then
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
      perform set_config('acc.reset', '0', true);
    end if;
    delete from auth_users where id in (select id from profiles where tenant_id = tid);
    delete from records where tenant_id = tid;
    delete from guest_orders where tenant_id = tid;
    delete from invoice_counters where tenant_id = tid;
    delete from push_subs where tenant_id = tid;
    delete from tenants where id = tid;
  end loop;
end $$;
