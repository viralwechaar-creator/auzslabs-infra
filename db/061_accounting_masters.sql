-- =========================================================
-- AUZslab Accounting: set-up, masters (accounts, parties, products, warehouses,
-- GST rates, financial years), listings and global search.
-- =========================================================

-- GSTIN: 15 characters, state code, PAN, entity, 'Z', and the mod-36 check character.
create function acc_gstin_valid(g text) returns boolean language plpgsql immutable as $$
declare chars text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'; i int; v int; f int := 1; s int := 0; code int;
begin
  if g is null then return false; end if;
  g := upper(trim(g));
  if g !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then return false; end if;
  for i in 1..14 loop
    v := position(substr(g, i, 1) in chars) - 1;
    code := v * f; s := s + (code / 36) + (code % 36);
    f := case when f = 1 then 2 else 1 end;
  end loop;
  return substr(chars, ((36 - (s % 36)) % 36) + 1, 1) = substr(g, 15, 1);
end $$;

-- ---------- first-use set-up for a tenant ----------
create function acc_seed_tenant(tid uuid) returns void language plpgsql security definer set search_path = public as $$
declare tname text; s date; o acc_org; br uuid; r record;
begin
  select name into tname from tenants where id = tid;
  insert into acc_org (tenant_id, legal_name, trade_name) values (tid, tname, tname) on conflict do nothing;
  select * into o from acc_org where tenant_id = tid;
  s := acc_fy_start(current_date, o.fy_start_month);
  insert into acc_fy (tenant_id, label, start_date, end_date)
    values (tid, acc_fy_label((s - interval '1 year')::date), (s - interval '1 year')::date, s - 1),
           (tid, acc_fy_label(s), s, (s + interval '1 year' - interval '1 day')::date) on conflict do nothing;

  for r in select * from (values
    ('1001','Cash in hand','asset','Cash and bank','cash',false,true),
    ('1002','Bank account','asset','Cash and bank','bank',true,false),
    ('1100','Accounts receivable','asset','Current assets','ar',false,false),
    ('1200','Inventory','asset','Current assets','inventory',false,false),
    ('1300','Input CGST','asset','Duties and taxes','in_cgst',false,false),
    ('1301','Input SGST','asset','Duties and taxes','in_sgst',false,false),
    ('1302','Input IGST','asset','Duties and taxes','in_igst',false,false),
    ('1303','Input cess','asset','Duties and taxes','in_cess',false,false),
    ('1400','Advances and deposits','asset','Current assets','advances',false,false),
    ('1500','Fixed assets','asset','Fixed assets','fixed_assets',false,false),
    ('1590','Accumulated depreciation','asset','Fixed assets','accum_dep',false,false),
    ('2100','Accounts payable','liability','Current liabilities','ap',false,false),
    ('2200','Output CGST','liability','Duties and taxes','out_cgst',false,false),
    ('2201','Output SGST','liability','Duties and taxes','out_sgst',false,false),
    ('2202','Output IGST','liability','Duties and taxes','out_igst',false,false),
    ('2203','Output cess','liability','Duties and taxes','out_cess',false,false),
    ('2210','GST payable on reverse charge','liability','Duties and taxes','rcm_payable',false,false),
    ('2300','Loans','liability','Long-term liabilities','loans',false,false),
    ('2400','Other liabilities','liability','Current liabilities','other_liab',false,false),
    ('3001','Owner capital','equity','Capital','capital',false,false),
    ('3002','Owner drawings','equity','Capital','drawings',false,false),
    ('3900','Opening balance equity','equity','Capital','opening_equity',false,false),
    ('4001','Sales','income','Revenue','sales',false,false),
    ('4002','Sales returns','income','Revenue','sales_return',false,false),
    ('4100','Other income','income','Other income','other_income',false,false),
    ('4200','Round off','income','Other income','round_off',false,false),
    ('4300','Gain or loss on asset disposal','income','Other income','disposal_gl',false,false),
    ('5001','Cost of goods sold','expense','Cost of sales','cogs',false,false),
    ('5002','Purchases','expense','Cost of sales','purchases',false,false),
    ('5003','Purchase returns','expense','Cost of sales','purchase_return',false,false),
    ('5100','Rent','expense','Operating expenses',null,false,false),
    ('5101','Salaries and wages','expense','Operating expenses',null,false,false),
    ('5102','Utilities','expense','Operating expenses',null,false,false),
    ('5103','Marketing','expense','Operating expenses',null,false,false),
    ('5104','Transport','expense','Operating expenses',null,false,false),
    ('5105','Bank charges','expense','Operating expenses','bank_charges',false,false),
    ('5106','Depreciation','expense','Operating expenses','dep_expense',false,false),
    ('5107','General expenses','expense','Operating expenses','general_expense',false,false),
    ('5108','Stock adjustments','expense','Cost of sales','stock_adjust',false,false),
    ('5109','Repairs and maintenance','expense','Operating expenses',null,false,false),
    ('5110','Professional fees','expense','Operating expenses',null,false,false),
    ('5111','Office supplies','expense','Operating expenses',null,false,false),
    ('5112','Insurance','expense','Operating expenses',null,false,false),
    ('5113','Interest paid','expense','Finance costs',null,false,false)
  ) as t(code, name, type, grp, system_key, is_bank, is_cash) loop
    insert into acc_accounts (tenant_id, code, name, type, grp, system_key, is_bank, is_cash) values (tid, r.code, r.name, r.type, r.grp, r.system_key, r.is_bank, r.is_cash) on conflict do nothing;
  end loop;

  insert into acc_taxcodes (tenant_id, code, name, kind, rate) values
    (tid, 'GST0', 'GST 0%', 'taxable', 0), (tid, 'GST025', 'GST 0.25%', 'taxable', 0.25), (tid, 'GST3', 'GST 3%', 'taxable', 3), (tid, 'GST5', 'GST 5%', 'taxable', 5),
    (tid, 'GST12', 'GST 12%', 'taxable', 12), (tid, 'GST18', 'GST 18%', 'taxable', 18), (tid, 'GST28', 'GST 28%', 'taxable', 28),
    (tid, 'EXEMPT', 'Exempt', 'exempt', 0), (tid, 'NIL', 'Nil rated', 'nil', 0) on conflict do nothing;
  insert into acc_masters (tenant_id, kind, name) select tid, 'unit', u from unnest(array['Nos','Kg','Gm','Ltr','Ml','Mtr','Box','Pack','Pair','Set','Hrs','Day']) u on conflict do nothing;
  insert into acc_branches (tenant_id, code, name) values (tid, 'HO', 'Head office') on conflict do nothing;
  select id into br from acc_branches where tenant_id = tid and code = 'HO';
  insert into acc_warehouses (tenant_id, code, name, branch_id, is_default) values (tid, 'MAIN', 'Main warehouse', br, true) on conflict do nothing;
  insert into acc_parties (tenant_id, kind, name, is_walkin) values (tid, 'both', 'Walk-in / cash', true) on conflict do nothing;
end $$;

create function acc_context() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; perms jsonb := '{}'; k text;
begin
  tid := acc_guard('acc_view');
  foreach k in array array['acc_view', 'acc_sales', 'acc_purchase', 'acc_inventory', 'acc_banking', 'acc_post', 'acc_approve', 'acc_cancel', 'acc_reports', 'acc_import', 'acc_admin', 'acc_audit'] loop
    perms := perms || jsonb_build_object(k, acc_perm(k));
  end loop;
  return jsonb_build_object(
    'tenant', (select jsonb_build_object('id', id, 'name', name, 'slug', slug, 'is_demo', is_demo) from tenants where id = tid),
    'org', (select to_jsonb(o) from acc_org o where tenant_id = tid),
    'fys', (select coalesce(jsonb_agg(to_jsonb(f) order by start_date desc), '[]') from acc_fy f where tenant_id = tid),
    'perms', perms, 'role', me()->>'role', 'email', (select email from auth_users where id = app_uid()),
    'branches', (select coalesce(jsonb_agg(to_jsonb(b) order by code), '[]') from acc_branches b where tenant_id = tid),
    'warehouses', (select coalesce(jsonb_agg(to_jsonb(w) order by is_default desc, code), '[]') from acc_warehouses w where tenant_id = tid),
    'accounts', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'code', code, 'name', name, 'type', type, 'grp', grp, 'system_key', system_key, 'is_bank', is_bank, 'is_cash', is_cash, 'active', active, 'parent_id', parent_id) order by code), '[]') from acc_accounts where tenant_id = tid),
    'taxcodes', (select coalesce(jsonb_agg(to_jsonb(t) order by rate), '[]') from acc_taxcodes t where tenant_id = tid),
    'masters', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'name', name, 'data', data, 'active', active) order by kind, name), '[]') from acc_masters where tenant_id = tid),
    'today', current_date);
end $$;

create function acc_bootstrap() returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := acc_guard('acc_view');
  if not exists (select 1 from acc_org where tenant_id = tid) then
    if not acc_perm('acc_admin') then raise exception 'Accounting has not been set up yet - ask the owner to open it once'; end if;
    perform acc_seed_tenant(tid);
    perform acc_audit_log(tid, 'setup', 'org', tid::text, null, jsonb_build_object('note', 'Accounting set up'));
  end if;
  return acc_context();
end $$;

-- ---------- organisation settings, financial years, locks ----------
create function acc_save_org(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; old acc_org; g text;
begin
  tid := acc_guard('acc_admin');
  select * into old from acc_org where tenant_id = tid;
  g := nullif(upper(trim(p->>'gstin')), '');
  if g is not null and not acc_gstin_valid(g) then raise exception 'GSTIN % is not valid (check the characters and check-digit)', g; end if;
  update acc_org set
    legal_name = coalesce(nullif(p->>'legal_name', ''), legal_name), trade_name = coalesce(p->>'trade_name', trade_name),
    gstin = case when p ? 'gstin' then g else gstin end,
    pan = case when p ? 'pan' then nullif(upper(trim(p->>'pan')), '') else pan end,
    state_code = case when p ? 'state_code' then nullif(p->>'state_code', '') else state_code end,
    address = coalesce(p->>'address', address), city = coalesce(p->>'city', city), pincode = coalesce(p->>'pincode', pincode), phone = coalesce(p->>'phone', phone), email = coalesce(p->>'email', email),
    reg_type = coalesce(nullif(p->>'reg_type', ''), reg_type),
    round_off_sales = coalesce((p->>'round_off_sales')::boolean, round_off_sales),
    allow_negative_stock = coalesce((p->>'allow_negative_stock')::boolean, allow_negative_stock),
    invoice_terms = coalesce(p->>'invoice_terms', invoice_terms), bank_details = coalesce(p->>'bank_details', bank_details), invoice_footer = coalesce(p->>'invoice_footer', invoice_footer),
    settings = settings || coalesce(p->'settings', '{}'::jsonb), updated_at = now()
  where tenant_id = tid;
  if g is not null and old.state_code is null and nullif(p->>'state_code', '') is null then
    update acc_org set state_code = substr(g, 1, 2) where tenant_id = tid;
  end if;
  perform acc_audit_log(tid, 'update', 'org', tid::text, to_jsonb(old), p);
  return (select to_jsonb(o) from acc_org o where tenant_id = tid);
end $$;

create function acc_save_fy(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; s date := (p->>'start_date')::date; e date := (p->>'end_date')::date; lbl text;
begin
  tid := acc_guard('acc_admin');
  if s is null or e is null or e <= s then raise exception 'Enter valid start and end dates'; end if;
  if exists (select 1 from acc_fy where tenant_id = tid and daterange(start_date, end_date, '[]') && daterange(s, e, '[]')) then raise exception 'These dates overlap an existing financial year'; end if;
  lbl := coalesce(nullif(p->>'label', ''), acc_fy_label(s));
  insert into acc_fy (tenant_id, label, start_date, end_date) values (tid, lbl, s, e);
  perform acc_audit_log(tid, 'create', 'fy', lbl, null, p);
  return jsonb_build_object('label', lbl);
end $$;

create function acc_set_lock(p_date date) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; old date;
begin
  tid := acc_guard('acc_admin');
  select lock_date into old from acc_org where tenant_id = tid;
  update acc_org set lock_date = p_date, updated_at = now() where tenant_id = tid;
  perform acc_audit_log(tid, 'lock', 'org', tid::text, jsonb_build_object('lock_date', old), jsonb_build_object('lock_date', p_date));
  return jsonb_build_object('lock_date', p_date);
end $$;

create function acc_mark_gst_filed(p_period text, p_filed boolean, p_ref text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := acc_guard('acc_admin');
  if p_period !~ '^\d{4}-\d{2}$' then raise exception 'Period must look like 2026-04'; end if;
  if p_filed then
    insert into acc_gst_periods (tenant_id, period, filed_on, reference, locked_by) values (tid, p_period, current_date, p_ref, app_uid()) on conflict do nothing;
  else delete from acc_gst_periods where tenant_id = tid and period = p_period; end if;
  perform acc_audit_log(tid, case when p_filed then 'gst_lock' else 'gst_unlock' end, 'gst_period', p_period, null, jsonb_build_object('ref', p_ref));
  return jsonb_build_object('period', p_period, 'filed', p_filed);
end $$;

-- Year-end: validates the books, then closes the year and locks it. Balances carry forward by construction
-- (balance-sheet accounts accumulate across years; profit moves to retained earnings in the reports).
create function acc_close_fy(p_fy uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; f acc_fy; drafts int; unbalanced int; nxt acc_fy; o acc_org; s date;
begin
  tid := acc_guard('acc_admin');
  select * into f from acc_fy where id = p_fy and tenant_id = tid for update;
  if f.id is null then raise exception 'Financial year not found'; end if;
  if f.status = 'closed' then raise exception '% is already closed', f.label; end if;
  select count(*) into drafts from acc_documents where tenant_id = tid and status = 'draft' and doc_date between f.start_date and f.end_date;
  if drafts > 0 then raise exception '% draft document(s) are still open in %. Post or delete them first', drafts, f.label; end if;
  select count(*) into unbalanced from (select journal_id from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id
    where jl.tenant_id = tid and j.jdate between f.start_date and f.end_date group by journal_id having sum(debit) <> sum(credit)) x;
  if unbalanced > 0 then raise exception '% journal(s) do not balance', unbalanced; end if;
  select * into o from acc_org where tenant_id = tid;
  if not exists (select 1 from acc_fy where tenant_id = tid and start_date = f.end_date + 1) then
    s := f.end_date + 1;
    insert into acc_fy (tenant_id, label, start_date, end_date) values (tid, acc_fy_label(s), s, (s + interval '1 year' - interval '1 day')::date);
  end if;
  update acc_fy set status = 'closed', closed_at = now() where id = f.id;
  update acc_org set lock_date = greatest(coalesce(lock_date, f.end_date), f.end_date), updated_at = now() where tenant_id = tid;
  perform acc_audit_log(tid, 'close_fy', 'fy', f.label, null, jsonb_build_object('locked_to', f.end_date));
  return jsonb_build_object('closed', f.label, 'locked_to', f.end_date);
end $$;

-- ---------- chart of accounts ----------
create function acc_save_account(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; a acc_accounts; aid uuid := nullif(p->>'id', '')::uuid;
begin
  tid := acc_guard('acc_admin');
  if aid is null then
    if coalesce(trim(p->>'name'), '') = '' or coalesce(trim(p->>'code'), '') = '' then raise exception 'Code and name are required'; end if;
    if p->>'type' not in ('asset', 'liability', 'equity', 'income', 'expense') then raise exception 'Choose a valid account type'; end if;
    insert into acc_accounts (tenant_id, code, name, type, grp, parent_id, is_bank, is_cash, notes)
    values (tid, trim(p->>'code'), trim(p->>'name'), p->>'type', coalesce(nullif(p->>'grp', ''), initcap(p->>'type')), nullif(p->>'parent_id', '')::uuid,
            coalesce((p->>'is_bank')::boolean, false), coalesce((p->>'is_cash')::boolean, false), p->>'notes') returning id into aid;
    perform acc_audit_log(tid, 'create', 'account', aid::text, null, p);
  else
    select * into a from acc_accounts where id = aid and tenant_id = tid;
    if a.id is null then raise exception 'Account not found'; end if;
    if a.system_key is not null and (coalesce(p->>'type', a.type) <> a.type or (p ? 'active' and not (p->>'active')::boolean)) then
      raise exception '% is used by the posting engine - it can be renamed but not retyped or deactivated', a.name;
    end if;
    if exists (select 1 from acc_journal_lines where account_id = aid) and coalesce(p->>'type', a.type) <> a.type then
      raise exception '% already has postings - its type cannot change', a.name;
    end if;
    update acc_accounts set code = coalesce(nullif(trim(p->>'code'), ''), code), name = coalesce(nullif(trim(p->>'name'), ''), name), type = coalesce(p->>'type', type),
      grp = coalesce(nullif(p->>'grp', ''), grp), parent_id = case when p ? 'parent_id' then nullif(p->>'parent_id', '')::uuid else parent_id end,
      is_bank = coalesce((p->>'is_bank')::boolean, is_bank), is_cash = coalesce((p->>'is_cash')::boolean, is_cash),
      active = coalesce((p->>'active')::boolean, active), notes = coalesce(p->>'notes', notes) where id = aid;
    perform acc_audit_log(tid, 'update', 'account', aid::text, to_jsonb(a), p);
  end if;
  return (select to_jsonb(x) from acc_accounts x where id = aid);
end $$;

-- ---------- customers & suppliers ----------
create function acc_save_party(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; pid uuid := nullif(p->>'id', '')::uuid; g text := nullif(upper(trim(p->>'gstin')), ''); old acc_parties; st text; dup text; k text := p->>'kind'; perm text;
begin
  perm := case when k = 'supplier' then 'acc_purchase' else 'acc_sales' end;
  tid := acc_guard(perm);
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Name is required'; end if;
  if g is not null and not acc_gstin_valid(g) then raise exception 'GSTIN % is not valid (check the characters and check-digit)', g; end if;
  st := coalesce(nullif(p->>'state_code', ''), substr(g, 1, 2));
  if g is not null and st is not null and substr(g, 1, 2) <> st then raise exception 'State code % does not match the GSTIN (which starts with %)', st, substr(g, 1, 2); end if;
  if p->>'email' is not null and p->>'email' <> '' and p->>'email' !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address'; end if;
  if g is not null then select name into dup from acc_parties where tenant_id = tid and gstin = g and id is distinct from pid limit 1; end if;
  if pid is null then
    if k not in ('customer', 'supplier', 'both') then raise exception 'Choose customer or supplier'; end if;
    insert into acc_parties (tenant_id, kind, code, name, gstin, pan, reg_type, state_code, billing_address, shipping_address, phone, email, contact_name, credit_limit, credit_days, tags, notes)
    values (tid, k, nullif(p->>'code', ''), trim(p->>'name'), g, nullif(upper(trim(p->>'pan')), ''), coalesce(nullif(p->>'reg_type', ''), case when g is null then 'unregistered' else 'regular' end), st,
            p->>'billing_address', p->>'shipping_address', p->>'phone', p->>'email', p->>'contact_name', coalesce((p->>'credit_limit')::numeric, 0), coalesce((p->>'credit_days')::int, 0), p->>'tags', p->>'notes')
    returning id into pid;
    perform acc_audit_log(tid, 'create', 'party', pid::text, null, p);
  else
    select * into old from acc_parties where id = pid and tenant_id = tid;
    if old.id is null then raise exception 'Party not found'; end if;
    if old.is_walkin and p ? 'name' and trim(p->>'name') <> old.name then raise exception 'The walk-in party cannot be renamed'; end if;
    update acc_parties set kind = coalesce(nullif(k, ''), kind), code = coalesce(nullif(p->>'code', ''), code), name = coalesce(nullif(trim(p->>'name'), ''), name), gstin = case when p ? 'gstin' then g else gstin end,
      pan = case when p ? 'pan' then nullif(upper(trim(p->>'pan')), '') else pan end, reg_type = coalesce(nullif(p->>'reg_type', ''), reg_type), state_code = case when p ? 'gstin' or p ? 'state_code' then st else state_code end,
      billing_address = coalesce(p->>'billing_address', billing_address), shipping_address = coalesce(p->>'shipping_address', shipping_address),
      phone = coalesce(p->>'phone', phone), email = coalesce(p->>'email', email), contact_name = coalesce(p->>'contact_name', contact_name),
      credit_limit = coalesce((p->>'credit_limit')::numeric, credit_limit), credit_days = coalesce((p->>'credit_days')::int, credit_days),
      tags = coalesce(p->>'tags', tags), notes = coalesce(p->>'notes', notes), active = coalesce((p->>'active')::boolean, active), updated_at = now()
    where id = pid;
    perform acc_audit_log(tid, 'update', 'party', pid::text, to_jsonb(old), p);
  end if;
  return jsonb_build_object('id', pid, 'duplicate_gstin_of', dup);
end $$;

-- ---------- products & services ----------
create function acc_save_product(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; pid uuid := nullif(p->>'id', '')::uuid; old acc_products; tr numeric; svc boolean;
begin
  tid := acc_guard('acc_inventory');
  if coalesce(trim(p->>'name'), '') = '' or coalesce(trim(p->>'sku'), '') = '' then raise exception 'SKU and name are required'; end if;
  tr := coalesce(nullif(p->>'tax_rate', '')::numeric, 18);
  if tr <> 0 and not exists (select 1 from acc_taxcodes where tenant_id = tid and active and rate = tr) then raise exception 'GST rate % is not configured', tr; end if;
  svc := coalesce((p->>'is_service')::boolean, false);
  if pid is null then
    insert into acc_products (tenant_id, sku, barcode, name, category, brand, unit, hsn, tax_rate, tax_inclusive, purchase_price, sale_price, mrp, price_lists, is_service, track_stock, track_batch, track_serial, reorder_level, reorder_qty, notes)
    values (tid, trim(p->>'sku'), nullif(p->>'barcode', ''), trim(p->>'name'), nullif(p->>'category', ''), nullif(p->>'brand', ''), coalesce(nullif(p->>'unit', ''), 'Nos'), nullif(p->>'hsn', ''), tr,
            coalesce((p->>'tax_inclusive')::boolean, false), coalesce(nullif(p->>'purchase_price', '')::numeric, 0), coalesce(nullif(p->>'sale_price', '')::numeric, 0), coalesce(nullif(p->>'mrp', '')::numeric, 0),
            coalesce(p->'price_lists', '{}'::jsonb), svc, not svc and coalesce((p->>'track_stock')::boolean, true), coalesce((p->>'track_batch')::boolean, false), coalesce((p->>'track_serial')::boolean, false),
            coalesce(nullif(p->>'reorder_level', '')::numeric, 0), coalesce(nullif(p->>'reorder_qty', '')::numeric, 0), p->>'notes') returning id into pid;
    perform acc_audit_log(tid, 'create', 'product', pid::text, null, p);
  else
    select * into old from acc_products where id = pid and tenant_id = tid;
    if old.id is null then raise exception 'Product not found'; end if;
    if exists (select 1 from acc_stock_moves where product_id = pid) and svc <> old.is_service then raise exception 'A product with stock movements cannot become a service'; end if;
    update acc_products set sku = trim(p->>'sku'), barcode = nullif(p->>'barcode', ''), name = trim(p->>'name'), category = nullif(p->>'category', ''), brand = nullif(p->>'brand', ''),
      unit = coalesce(nullif(p->>'unit', ''), unit), hsn = nullif(p->>'hsn', ''), tax_rate = tr, tax_inclusive = coalesce((p->>'tax_inclusive')::boolean, tax_inclusive),
      purchase_price = coalesce(nullif(p->>'purchase_price', '')::numeric, purchase_price), sale_price = coalesce(nullif(p->>'sale_price', '')::numeric, sale_price), mrp = coalesce(nullif(p->>'mrp', '')::numeric, mrp),
      price_lists = coalesce(p->'price_lists', price_lists), is_service = svc, track_stock = not svc and coalesce((p->>'track_stock')::boolean, track_stock),
      track_batch = coalesce((p->>'track_batch')::boolean, track_batch), track_serial = coalesce((p->>'track_serial')::boolean, track_serial),
      reorder_level = coalesce(nullif(p->>'reorder_level', '')::numeric, reorder_level), reorder_qty = coalesce(nullif(p->>'reorder_qty', '')::numeric, reorder_qty),
      notes = coalesce(p->>'notes', notes), active = coalesce((p->>'active')::boolean, active), updated_at = now() where id = pid;
    perform acc_audit_log(tid, 'update', 'product', pid::text, to_jsonb(old), p);
  end if;
  if nullif(p->>'category', '') is not null then insert into acc_masters (tenant_id, kind, name) values (tid, 'category', p->>'category') on conflict do nothing; end if;
  if nullif(p->>'brand', '') is not null then insert into acc_masters (tenant_id, kind, name) values (tid, 'brand', p->>'brand') on conflict do nothing; end if;
  return jsonb_build_object('id', pid);
end $$;

create function acc_save_master(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; mid uuid := nullif(p->>'id', '')::uuid; k text := p->>'kind';
begin
  tid := acc_guard('acc_inventory');
  if k not in ('category', 'brand', 'unit', 'price_list') then raise exception 'Unknown list'; end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Name is required'; end if;
  if mid is null then insert into acc_masters (tenant_id, kind, name, data) values (tid, k, trim(p->>'name'), coalesce(p->'data', '{}'::jsonb)) on conflict (tenant_id, kind, name) do update set active = true returning id into mid;
  else update acc_masters set name = trim(p->>'name'), data = coalesce(p->'data', data), active = coalesce((p->>'active')::boolean, active) where id = mid and tenant_id = tid; end if;
  return jsonb_build_object('id', mid);
end $$;

create function acc_save_warehouse(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; wid uuid := nullif(p->>'id', '')::uuid;
begin
  tid := acc_guard('acc_inventory');
  if coalesce(trim(p->>'name'), '') = '' or coalesce(trim(p->>'code'), '') = '' then raise exception 'Code and name are required'; end if;
  if coalesce((p->>'is_default')::boolean, false) then update acc_warehouses set is_default = false where tenant_id = tid; end if;
  if wid is null then insert into acc_warehouses (tenant_id, code, name, branch_id, is_default) values (tid, upper(trim(p->>'code')), trim(p->>'name'), nullif(p->>'branch_id', '')::uuid, coalesce((p->>'is_default')::boolean, false)) returning id into wid;
  else update acc_warehouses set code = upper(trim(p->>'code')), name = trim(p->>'name'), branch_id = nullif(p->>'branch_id', '')::uuid, is_default = coalesce((p->>'is_default')::boolean, is_default), active = coalesce((p->>'active')::boolean, active) where id = wid and tenant_id = tid; end if;
  return jsonb_build_object('id', wid);
end $$;

create function acc_save_branch(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; bid uuid := nullif(p->>'id', '')::uuid; g text := nullif(upper(trim(p->>'gstin')), '');
begin
  tid := acc_guard('acc_admin');
  if coalesce(trim(p->>'name'), '') = '' or coalesce(trim(p->>'code'), '') = '' then raise exception 'Code and name are required'; end if;
  if g is not null and not acc_gstin_valid(g) then raise exception 'GSTIN % is not valid', g; end if;
  if bid is null then insert into acc_branches (tenant_id, code, name, gstin, state_code, address) values (tid, upper(trim(p->>'code')), trim(p->>'name'), g, coalesce(nullif(p->>'state_code', ''), substr(g, 1, 2)), p->>'address') returning id into bid;
  else update acc_branches set code = upper(trim(p->>'code')), name = trim(p->>'name'), gstin = g, state_code = coalesce(nullif(p->>'state_code', ''), substr(g, 1, 2)), address = p->>'address', active = coalesce((p->>'active')::boolean, active) where id = bid and tenant_id = tid; end if;
  return jsonb_build_object('id', bid);
end $$;

create function acc_save_taxcode(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; tcid uuid := nullif(p->>'id', '')::uuid;
begin
  tid := acc_guard('acc_admin');
  if coalesce(trim(p->>'code'), '') = '' or coalesce(trim(p->>'name'), '') = '' then raise exception 'Code and name are required'; end if;
  if (p->>'rate')::numeric < 0 or (p->>'rate')::numeric > 100 then raise exception 'Rate must be between 0 and 100'; end if;
  if tcid is null then insert into acc_taxcodes (tenant_id, code, name, kind, rate, cess, effective_from) values (tid, upper(trim(p->>'code')), trim(p->>'name'), coalesce(p->>'kind', 'taxable'), (p->>'rate')::numeric, coalesce((p->>'cess')::numeric, 0), coalesce(nullif(p->>'effective_from', '')::date, current_date)) returning id into tcid;
  else update acc_taxcodes set name = trim(p->>'name'), active = coalesce((p->>'active')::boolean, active) where id = tcid and tenant_id = tid; end if;
  perform acc_audit_log(tid, 'save', 'taxcode', tcid::text, null, p);
  return jsonb_build_object('id', tcid);
end $$;

-- ---------- listings ----------
create function acc_doc_status(d acc_documents) returns text language sql stable as $$
  select case
    when d.status = 'cancelled' then 'cancelled'
    when d.status = 'draft' then case when coalesce((d.meta->>'pending_approval')::boolean, false) then 'pending approval' else 'draft' end
    when d.status <> 'posted' then d.status
    when d.total > 0 and d.paid >= d.total then 'paid'
    when d.paid > 0 and d.due_date is not null and d.due_date < current_date then 'overdue'
    when d.paid > 0 then 'partially paid'
    when d.due_date is not null and d.due_date < current_date then 'overdue'
    else 'due' end
$$;

create function acc_list_documents(p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; types text[]; q text := nullif(trim(coalesce(p->>'search', '')), ''); lim int := least(coalesce((p->>'limit')::int, 50), 500); off int := coalesce((p->>'offset')::int, 0);
  st text := nullif(p->>'status', ''); fr date := nullif(p->>'from', '')::date; tt date := nullif(p->>'to', '')::date; res jsonb; tot int; sums jsonb;
begin
  tid := acc_guard('acc_view');
  types := array(select jsonb_array_elements_text(coalesce(p->'types', '[]')));
  with f as (
    select d.*, acc_doc_status(d) as pay_status from acc_documents d
    where d.tenant_id = tid and (cardinality(types) = 0 or d.doc_type = any(types))
      and (q is null or d.number ilike '%' || q || '%' or d.party_name ilike '%' || q || '%' or d.supplier_ref ilike '%' || q || '%')
      and (nullif(p->>'party_id', '') is null or d.party_id = (p->>'party_id')::uuid)
      and (fr is null or d.doc_date >= fr) and (tt is null or d.doc_date <= tt)
      and (nullif(p->>'branch_id', '') is null or d.branch_id = (p->>'branch_id')::uuid)
      and not (d.is_opening and coalesce((p->>'hide_opening')::boolean, false))
  ), g as (select * from f where st is null or pay_status = st or (st = 'unpaid' and pay_status in ('due', 'overdue', 'partially paid')))
  select coalesce(jsonb_agg(to_jsonb(x) order by x.doc_date desc, x.created_at desc), '[]'), (select count(*) from g),
         (select jsonb_build_object('total', coalesce(sum(total) filter (where status <> 'cancelled'), 0), 'outstanding', coalesce(sum(total - paid) filter (where status = 'posted'), 0)) from g)
    into res, tot, sums
  from (select id, doc_type, number, doc_date, due_date, party_id, party_name, total, paid, total - paid as outstanding, status, pay_status, supply_type, reverse_charge, taxable,
               cgst + sgst + igst + cess as tax, supplier_ref, created_at, is_opening from g order by doc_date desc, created_at desc limit lim offset off) x;
  return jsonb_build_object('rows', res, 'count', tot, 'sums', sums);
end $$;

create function acc_get_document(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; d acc_documents;
begin
  tid := acc_guard('acc_view');
  select * into d from acc_documents where id = p_id and tenant_id = tid;
  if d.id is null then raise exception 'Document not found'; end if;
  return jsonb_build_object(
    'doc', to_jsonb(d) || jsonb_build_object('pay_status', acc_doc_status(d), 'outstanding', d.total - d.paid),
    'party', (select to_jsonb(x) from acc_parties x where id = d.party_id),
    'lines', (select coalesce(jsonb_agg(to_jsonb(l) || jsonb_build_object('sku', p.sku) order by l.line_no), '[]') from acc_doc_lines l left join acc_products p on p.id = l.product_id where l.doc_id = d.id),
    'journal', (select to_jsonb(j) from acc_journals j where id = d.journal_id),
    'journal_lines', (select coalesce(jsonb_agg(jsonb_build_object('account', a.name, 'code', a.code, 'party_id', jl.party_id, 'debit', jl.debit, 'credit', jl.credit) order by jl.line_no), '[]')
                      from acc_journal_lines jl join acc_accounts a on a.id = jl.account_id where jl.journal_id = d.journal_id),
    'reversal', (select jsonb_build_object('id', id, 'number', number) from acc_journals where reverses_id = d.journal_id),
    'allocations', (select coalesce(jsonb_agg(jsonb_build_object('id', al.id, 'amount', al.amount, 'date', al.alloc_date, 'reversed', al.reversed_at is not null,
                      'payment_id', al.payment_id, 'payment_number', pm.number, 'note_id', al.credit_doc_id, 'note_number', cn.number, 'doc_id', al.doc_id, 'doc_number', dd.number) order by al.created_at), '[]')
                    from acc_allocations al left join acc_payments pm on pm.id = al.payment_id left join acc_documents cn on cn.id = al.credit_doc_id left join acc_documents dd on dd.id = al.doc_id
                    where al.tenant_id = tid and (al.doc_id = d.id or al.credit_doc_id = d.id)),
    'children', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'doc_type', doc_type, 'number', number, 'status', status, 'total', total)), '[]') from acc_documents where tenant_id = tid and (ref_doc_id = d.id or source_doc_id = d.id)),
    'parent', (select jsonb_build_object('id', id, 'doc_type', doc_type, 'number', number) from acc_documents where id = coalesce(d.ref_doc_id, d.source_doc_id)),
    'einvoice', (select to_jsonb(e) - 'payload' from acc_einvoice e where doc_id = d.id),
    'eway', (select to_jsonb(e) - 'payload' from acc_eway e where doc_id = d.id),
    'attachments', (select coalesce(jsonb_agg(to_jsonb(a)), '[]') from acc_attachments a where entity = 'document' and entity_id = d.id),
    'audit', (select coalesce(jsonb_agg(jsonb_build_object('at', at, 'actor', actor_email, 'action', action, 'reason', reason) order by at desc), '[]') from (select * from acc_audit where tenant_id = tid and entity_id = d.id::text order by at desc limit 30) a));
end $$;

create function acc_list_payments(p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; k text := nullif(p->>'kind', ''); q text := nullif(trim(coalesce(p->>'search', '')), '');
begin
  tid := acc_guard('acc_view');
  return jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(x) order by x.pay_date desc, x.created_at desc) from (
    select pm.id, pm.kind, pm.number, pm.pay_date, pm.party_id, pa.name as party_name, pm.amount, pm.allocated, pm.amount - pm.allocated as unallocated, pm.mode, pm.reference, pm.status, a.name as account, pm.created_at
    from acc_payments pm left join acc_parties pa on pa.id = pm.party_id join acc_accounts a on a.id = pm.account_id
    where pm.tenant_id = tid and (k is null or pm.kind = k) and (nullif(p->>'party_id', '') is null or pm.party_id = (p->>'party_id')::uuid)
      and (q is null or pm.number ilike '%' || q || '%' or pa.name ilike '%' || q || '%' or pm.reference ilike '%' || q || '%')
      and (nullif(p->>'from', '') is null or pm.pay_date >= (p->>'from')::date) and (nullif(p->>'to', '') is null or pm.pay_date <= (p->>'to')::date)
    order by pm.pay_date desc, pm.created_at desc limit least(coalesce((p->>'limit')::int, 100), 500)) x), '[]'));
end $$;

create function acc_get_payment(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; pm acc_payments;
begin
  tid := acc_guard('acc_view');
  select * into pm from acc_payments where id = p_id and tenant_id = tid;
  if pm.id is null then raise exception 'Payment not found'; end if;
  return jsonb_build_object('payment', to_jsonb(pm), 'party', (select to_jsonb(x) from acc_parties x where id = pm.party_id), 'account', (select name from acc_accounts where id = pm.account_id),
    'allocations', (select coalesce(jsonb_agg(jsonb_build_object('id', al.id, 'amount', al.amount, 'doc_id', d.id, 'doc_number', d.number, 'doc_type', d.doc_type, 'reversed', al.reversed_at is not null)), '[]')
                    from acc_allocations al join acc_documents d on d.id = al.doc_id where al.payment_id = pm.id),
    'journal_lines', (select coalesce(jsonb_agg(jsonb_build_object('account', a.name, 'debit', jl.debit, 'credit', jl.credit) order by jl.line_no), '[]') from acc_journal_lines jl join acc_accounts a on a.id = jl.account_id where jl.journal_id = pm.journal_id),
    'journal', (select jsonb_build_object('id', id, 'number', number) from acc_journals where id = pm.journal_id),
    'attachments', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from acc_attachments x where x.tenant_id = tid and x.entity = 'payment' and x.entity_id = pm.id));
end $$;

create function acc_list_parties(p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; k text := nullif(p->>'kind', ''); q text := nullif(trim(coalesce(p->>'search', '')), '');
begin
  tid := acc_guard('acc_view');
  return jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(x) order by lower(x.name)) from (
    select pa.id, pa.kind, pa.code, pa.name, pa.gstin, pa.state_code, pa.phone, pa.email, pa.credit_limit, pa.credit_days, pa.reg_type, pa.is_walkin, pa.active, pa.billing_address, pa.shipping_address, pa.contact_name, pa.pan, pa.tags, pa.notes,
      coalesce(b.bal, 0) as balance,
      coalesce((select sum(d.total - d.paid) from acc_documents d where d.party_id = pa.id and d.status = 'posted' and d.doc_type in ('invoice', 'bill', 'expense') and d.total > d.paid and d.due_date < current_date), 0) as overdue
    from acc_parties pa
    left join (select jl.party_id, sum(jl.debit - jl.credit) bal from acc_journal_lines jl join acc_accounts a on a.id = jl.account_id
               where jl.tenant_id = tid and a.system_key in ('ar', 'ap') group by jl.party_id) b on b.party_id = pa.id
    where pa.tenant_id = tid and (k is null or pa.kind = k or (k <> 'both' and pa.kind = 'both'))
      and (q is null or pa.name ilike '%' || q || '%' or pa.gstin ilike '%' || q || '%' or pa.phone ilike '%' || q || '%' or pa.code ilike '%' || q || '%')
      and (coalesce((p->>'include_inactive')::boolean, false) or pa.active)
    order by lower(pa.name) limit least(coalesce((p->>'limit')::int, 1000), 5000)) x), '[]'));
end $$;

create function acc_list_products(p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; sq text := nullif(trim(coalesce(p->>'search', '')), ''); cat text := nullif(p->>'category', ''); low boolean := coalesce((p->>'low_stock')::boolean, false);
begin
  tid := acc_guard('acc_view');
  return jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(x) order by lower(x.name)) from (
    select pr.*, coalesce(s.q, 0) as stock, coalesce(s.v, 0) as stock_value,
      case when coalesce(s.q, 0) > 0 then round(s.v / s.q, 4) else pr.purchase_price end as avg_cost
    from acc_products pr
    left join (select product_id, sum(qty) q, sum(qty * unit_cost) v from acc_stock_moves where tenant_id = tid group by product_id) s on s.product_id = pr.id
    where pr.tenant_id = tid and (sq is null or pr.name ilike '%' || sq || '%' or pr.sku ilike '%' || sq || '%' or pr.barcode = sq or pr.hsn = sq)
      and (cat is null or pr.category = cat) and (coalesce((p->>'include_inactive')::boolean, false) or pr.active)
      and (not low or (pr.track_stock and not pr.is_service and coalesce(s.q, 0) <= pr.reorder_level and pr.reorder_level > 0))
    order by lower(pr.name) limit least(coalesce((p->>'limit')::int, 2000), 10000)) x), '[]'));
end $$;

create function acc_product_stock(p_product uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := acc_guard('acc_view');
  return jsonb_build_object(
    'by_warehouse', (select coalesce(jsonb_agg(jsonb_build_object('warehouse_id', w.id, 'warehouse', w.name, 'qty', coalesce(s.q, 0), 'value', coalesce(s.v, 0))), '[]')
                     from acc_warehouses w left join (select warehouse_id, sum(qty) q, sum(qty * unit_cost) v from acc_stock_moves where tenant_id = tid and product_id = p_product group by warehouse_id) s on s.warehouse_id = w.id where w.tenant_id = tid),
    'moves', (select coalesce(jsonb_agg(to_jsonb(m) order by m.move_date desc, m.id desc), '[]') from (
        select sm.id, sm.move_date, sm.qty, sm.unit_cost, sm.kind, sm.source_type, sm.source_id, sm.batch_no, sm.serial_no, sm.expiry, sm.note, w.name as warehouse,
               (select number from acc_documents where id = sm.source_id) as doc_number, sum(sm.qty) over (order by sm.move_date, sm.id) as running
        from acc_stock_moves sm join acc_warehouses w on w.id = sm.warehouse_id where sm.tenant_id = tid and sm.product_id = p_product order by sm.move_date desc, sm.id desc limit 200) m));
end $$;

create function acc_list_audit(p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; q text := nullif(trim(coalesce(p->>'search', '')), '');
begin
  tid := acc_guard('acc_audit');
  return jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(a) order by a.at desc) from (
    select id, at, actor_email, action, entity, entity_id, old_value, new_value, reason from acc_audit
    where tenant_id = tid and (q is null or action ilike '%' || q || '%' or entity ilike '%' || q || '%' or actor_email ilike '%' || q || '%' or entity_id = q)
      and (nullif(p->>'entity', '') is null or entity = p->>'entity') and (nullif(p->>'from', '') is null or at >= (p->>'from')::date)
    order by at desc limit least(coalesce((p->>'limit')::int, 200), 1000)) a), '[]'));
end $$;

create function acc_search(p_q text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; q text := trim(coalesce(p_q, ''));
begin
  tid := acc_guard('acc_view');
  if length(q) < 2 then return '[]'; end if;
  return coalesce((select jsonb_agg(to_jsonb(r)) from (
    (select 'party' as type, id::text as id, name as title, coalesce(gstin, phone, '') as sub from acc_parties where tenant_id = tid and (name ilike '%' || q || '%' or gstin ilike '%' || q || '%' or phone ilike '%' || q || '%') order by name limit 6)
    union all
    (select 'product', id::text, name, sku from acc_products where tenant_id = tid and (name ilike '%' || q || '%' or sku ilike '%' || q || '%' or barcode = q) order by name limit 6)
    union all
    (select 'document', id::text, number || ' - ' || coalesce(party_name, ''), doc_type || ' / ' || total::text from acc_documents where tenant_id = tid and (number ilike '%' || q || '%' or party_name ilike '%' || q || '%' or supplier_ref ilike '%' || q || '%') order by doc_date desc limit 8)
    union all
    (select 'payment', id::text, number, kind || ' / ' || amount::text from acc_payments where tenant_id = tid and (number ilike '%' || q || '%' or reference ilike '%' || q || '%') order by pay_date desc limit 4)
    union all
    (select 'account', id::text, code || ' ' || name, type from acc_accounts where tenant_id = tid and (name ilike '%' || q || '%' or code ilike '%' || q || '%') order by code limit 5)
    union all
    (select 'journal', id::text, number, coalesce(narration, '') from acc_journals where tenant_id = tid and number ilike '%' || q || '%' order by jdate desc limit 3)) r), '[]');
end $$;
