-- =========================================================
-- AUZslab Accounting (feature key: 'accounting')
-- A real double-entry engine, NOT the generic `records` table: every
-- business document posts balanced journal lines inside one database
-- transaction, stock moves and receivables/payables are derived from the
-- same posting, and posted rows are immutable (reverse, never edit).
--
-- Access model: every table is tenant-scoped with RLS (read only); ALL writes
-- and reads go through SECURITY DEFINER functions (db/060..062) that call
-- acc_guard(), which re-checks (server side, so it cannot be bypassed by
-- calling an RPC directly) that the tenant is entitled to 'accounting' and has
-- not switched it off, and that the caller's role allows the action.
--
-- Sign conventions: journal lines carry debit/credit (both >= 0, one of them 0).
-- Money is numeric(16,2); quantities numeric(16,3); rates numeric(16,4).
-- Timestamps are timestamptz (UTC), dates are plain dates in the org's timezone.
-- =========================================================

-- ---------- organisation, financial years, branches ----------
create table acc_org (
  tenant_id        uuid primary key references tenants(id) on delete cascade,
  legal_name       text, trade_name text, gstin text, pan text,
  state_code       text,                     -- 2-digit GST state code of the principal place of business
  address          text, city text, pincode text, phone text, email text,
  reg_type         text not null default 'regular' check (reg_type in ('regular','composition','unregistered')),
  fy_start_month   int  not null default 4 check (fy_start_month between 1 and 12),
  lock_date        date,                     -- nothing may be posted/cancelled on or before this date
  round_off_sales  boolean not null default true,
  allow_negative_stock boolean not null default false,
  invoice_terms    text, bank_details text, invoice_footer text,
  settings         jsonb not null default '{}',
  is_demo          boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table acc_fy (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  label       text not null,                 -- '2026-27'
  start_date  date not null, end_date date not null,
  status      text not null default 'open' check (status in ('open','closed')),
  closed_at   timestamptz,
  check (end_date > start_date),
  unique (tenant_id, label)
);

create table acc_branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  code text not null, name text not null, gstin text, state_code text, address text,
  active boolean not null default true,
  unique (tenant_id, code)
);

-- ---------- chart of accounts ----------
create table acc_accounts (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  code       text not null,
  name       text not null,
  type       text not null check (type in ('asset','liability','equity','income','expense')),
  grp        text not null,                   -- account group, e.g. 'Current assets'
  parent_id  uuid references acc_accounts(id),
  system_key text,                            -- stable key the posting engine looks accounts up by
  is_bank    boolean not null default false,
  is_cash    boolean not null default false,
  active     boolean not null default true,
  notes      text,
  created_at timestamptz not null default now(),
  unique (tenant_id, code),
  unique (tenant_id, system_key)
);

-- ---------- customers & suppliers ----------
create table acc_parties (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  kind text not null check (kind in ('customer','supplier','both')),
  code text, name text not null,
  gstin text, pan text,
  reg_type text not null default 'unregistered' check (reg_type in ('regular','composition','unregistered','sez','overseas')),
  state_code text,
  billing_address text, shipping_address text,
  phone text, email text, contact_name text,
  credit_limit numeric(16,2) not null default 0,   -- 0 = no limit
  credit_days int not null default 0,
  tags text, notes text,
  is_walkin boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index acc_parties_t on acc_parties (tenant_id, kind, lower(name));
create unique index acc_parties_walkin on acc_parties (tenant_id) where is_walkin;

-- ---------- categories, brands, units, price lists ----------
create table acc_masters (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  kind text not null check (kind in ('category','brand','unit','price_list')),
  name text not null, data jsonb not null default '{}',
  active boolean not null default true,
  unique (tenant_id, kind, name)
);

create table acc_warehouses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  code text not null, name text not null, branch_id uuid references acc_branches(id),
  is_default boolean not null default false, active boolean not null default true,
  unique (tenant_id, code)
);

-- ---------- products & services ----------
create table acc_products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  sku text not null, barcode text, name text not null,
  category text, brand text, unit text not null default 'Nos',
  hsn text,                                    -- HSN for goods, SAC for services
  tax_rate numeric(7,3) not null default 18 check (tax_rate >= 0 and tax_rate <= 100),
  tax_inclusive boolean not null default false,
  purchase_price numeric(16,4) not null default 0, sale_price numeric(16,4) not null default 0, mrp numeric(16,2) not null default 0,
  price_lists jsonb not null default '{}',     -- {"Wholesale": 90, ...}
  is_service boolean not null default false,
  track_stock boolean not null default true,
  track_batch boolean not null default false, track_serial boolean not null default false,
  reorder_level numeric(16,3) not null default 0, reorder_qty numeric(16,3) not null default 0,
  image text, notes text,
  active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (tenant_id, sku)
);
create index acc_products_t on acc_products (tenant_id, lower(name));

-- ---------- GST configuration (versioned: lines store the rate they used) ----------
create table acc_taxcodes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  code text not null, name text not null,
  kind text not null default 'taxable' check (kind in ('taxable','exempt','nil','zero')),
  rate numeric(7,3) not null default 0, cess numeric(7,3) not null default 0,
  effective_from date not null default date '2017-07-01',
  active boolean not null default true,
  unique (tenant_id, code)
);

-- ---------- numbering ----------
create table acc_series (
  tenant_id uuid not null references tenants(id) on delete cascade,
  key text not null,                           -- INV, CN, PB, DN, RCT, PAY, JV ...
  fy_id uuid not null references acc_fy(id) on delete cascade,
  prefix text not null, next_no int not null default 1, pad int not null default 5,
  primary key (tenant_id, key, fy_id)
);

-- ---------- documents ----------
create table acc_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  doc_type text not null check (doc_type in ('quotation','sales_order','delivery_challan','invoice','credit_note',
                                              'purchase_request','purchase_order','goods_receipt','bill','debit_note','expense')),
  number text not null,
  doc_date date not null, due_date date,
  fy_id uuid references acc_fy(id), branch_id uuid references acc_branches(id), warehouse_id uuid references acc_warehouses(id),
  party_id uuid references acc_parties(id),
  party_name text, party_gstin text,           -- frozen copies, so a later master edit never rewrites history
  billing_address text, shipping_address text,
  place_of_supply text,                         -- GST state code
  supply_type text not null default 'intra' check (supply_type in ('intra','inter')),
  reverse_charge boolean not null default false,
  itc_eligible boolean not null default true,
  price_includes_tax boolean not null default false,
  supplier_ref text, supplier_ref_date date,    -- the supplier's own invoice number/date (purchases)
  ref_doc_id uuid references acc_documents(id), -- credit/debit note -> original invoice/bill
  source_doc_id uuid references acc_documents(id), -- quotation -> order -> challan -> invoice
  subtotal numeric(16,2) not null default 0, discount numeric(16,2) not null default 0,
  taxable numeric(16,2) not null default 0,
  cgst numeric(16,2) not null default 0, sgst numeric(16,2) not null default 0, igst numeric(16,2) not null default 0, cess numeric(16,2) not null default 0,
  roundoff numeric(16,2) not null default 0,
  total numeric(16,2) not null default 0,
  paid numeric(16,2) not null default 0,        -- receipts/payments + applied credit/debit notes
  status text not null default 'draft' check (status in ('draft','open','posted','converted','closed','cancelled')),
  is_opening boolean not null default false,    -- party opening balance, posted against opening-balance equity
  payment_terms text, notes text, terms text,
  meta jsonb not null default '{}',             -- transport / vehicle / e-way fields etc.
  journal_id uuid,
  created_by uuid, created_at timestamptz not null default now(),
  cancelled_at timestamptz, cancelled_by uuid, cancel_reason text,
  unique (tenant_id, doc_type, number)
);
create index acc_documents_list on acc_documents (tenant_id, doc_type, doc_date desc);
create index acc_documents_party on acc_documents (tenant_id, party_id, doc_type);

create table acc_doc_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  doc_id uuid not null references acc_documents(id) on delete cascade,
  line_no int not null,
  product_id uuid references acc_products(id), account_id uuid references acc_accounts(id),
  description text, hsn text,
  qty numeric(16,3) not null default 1, unit text,
  rate numeric(16,4) not null default 0,
  disc_pct numeric(7,3) not null default 0, disc_amt numeric(16,2) not null default 0,
  taxable numeric(16,2) not null default 0,
  tax_rate numeric(7,3) not null default 0,     -- the rate actually applied, kept on the line for history
  cgst numeric(16,2) not null default 0, sgst numeric(16,2) not null default 0, igst numeric(16,2) not null default 0, cess numeric(16,2) not null default 0,
  total numeric(16,2) not null default 0,
  warehouse_id uuid references acc_warehouses(id),
  batch_no text, serial_nos text, expiry date, mfg_date date,
  unit_cost numeric(16,4) not null default 0    -- stock cost used for COGS / cost basis
);
create index acc_doc_lines_doc on acc_doc_lines (doc_id, line_no);
create index acc_doc_lines_prod on acc_doc_lines (tenant_id, product_id);

-- ---------- journals (the books) ----------
create table acc_journals (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  number text not null,
  voucher_type text not null check (voucher_type in ('sales','purchase','receipt','payment','contra','journal','credit_note','debit_note','expense','depreciation','opening','stock','reversal')),
  jdate date not null,
  fy_id uuid references acc_fy(id), branch_id uuid references acc_branches(id),
  narration text,
  source_type text, source_id uuid,             -- traceable back to the business document
  reverses_id uuid references acc_journals(id),
  cost_centre text,
  created_by uuid, created_at timestamptz not null default now(),
  unique (tenant_id, number)
);
create index acc_journals_d on acc_journals (tenant_id, jdate);
create index acc_journals_src on acc_journals (tenant_id, source_type, source_id);
alter table acc_documents add constraint acc_documents_journal_fk foreign key (journal_id) references acc_journals(id);

create table acc_journal_lines (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  journal_id uuid not null references acc_journals(id) on delete cascade,
  line_no int not null,
  account_id uuid not null references acc_accounts(id),
  party_id uuid references acc_parties(id),
  debit numeric(16,2) not null default 0, credit numeric(16,2) not null default 0,
  narration text,
  check (debit >= 0 and credit >= 0 and (debit = 0 or credit = 0) and (debit + credit) > 0)
);
create index acc_jl_acct on acc_journal_lines (tenant_id, account_id);
create index acc_jl_party on acc_journal_lines (tenant_id, party_id);
create index acc_jl_j on acc_journal_lines (journal_id);

-- ---------- receipts / payments and their allocation ----------
create table acc_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  kind text not null check (kind in ('receipt','payment')),
  number text not null, pay_date date not null,
  fy_id uuid references acc_fy(id), branch_id uuid references acc_branches(id),
  party_id uuid references acc_parties(id),
  account_id uuid not null references acc_accounts(id),   -- the cash or bank account
  amount numeric(16,2) not null check (amount > 0),
  allocated numeric(16,2) not null default 0,
  mode text, reference text, notes text,
  status text not null default 'posted' check (status in ('posted','cancelled')),
  journal_id uuid references acc_journals(id),
  created_by uuid, created_at timestamptz not null default now(),
  cancelled_at timestamptz, cancel_reason text,
  unique (tenant_id, kind, number)
);
create index acc_payments_party on acc_payments (tenant_id, party_id);

create table acc_allocations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  payment_id uuid references acc_payments(id),
  credit_doc_id uuid references acc_documents(id),   -- a credit/debit note applied against an invoice/bill
  doc_id uuid not null references acc_documents(id),
  amount numeric(16,2) not null check (amount > 0),
  alloc_date date not null default current_date,
  reversed_at timestamptz,
  created_by uuid, created_at timestamptz not null default now(),
  check ((payment_id is null) <> (credit_doc_id is null))
);
create index acc_alloc_doc on acc_allocations (doc_id);
create index acc_alloc_pay on acc_allocations (payment_id);

-- ---------- stock ----------
create table acc_stock_moves (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  product_id uuid not null references acc_products(id),
  warehouse_id uuid not null references acc_warehouses(id),
  move_date date not null,
  qty numeric(16,3) not null check (qty <> 0),       -- signed: + in, - out
  unit_cost numeric(16,4) not null default 0,
  kind text not null check (kind in ('opening','purchase','sale','sale_return','purchase_return','stock_in','stock_out','transfer_out','transfer_in','adjustment','reversal')),
  source_type text, source_id uuid,
  batch_no text, serial_no text, expiry date, note text,
  created_by uuid, created_at timestamptz not null default now()
);
create index acc_sm_p on acc_stock_moves (tenant_id, product_id, warehouse_id);
create index acc_sm_src on acc_stock_moves (tenant_id, source_type, source_id);

-- ---------- banking ----------
create table acc_bank_txns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  account_id uuid not null references acc_accounts(id),
  txn_date date not null, description text, reference text,
  debit numeric(16,2) not null default 0,       -- money out of the bank
  credit numeric(16,2) not null default 0,      -- money into the bank
  balance numeric(16,2),
  status text not null default 'unmatched' check (status in ('unmatched','matched','ignored')),
  matched_line_id bigint unique references acc_journal_lines(id),
  recon_id uuid,
  import_batch text, dedupe_hash text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, account_id, dedupe_hash)
);
create index acc_bt_a on acc_bank_txns (tenant_id, account_id, txn_date);

create table acc_recons (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  account_id uuid not null references acc_accounts(id),
  statement_date date not null, statement_balance numeric(16,2) not null,
  book_balance numeric(16,2) not null, uncleared numeric(16,2) not null default 0, difference numeric(16,2) not null default 0,
  items int not null default 0,
  created_by uuid, created_at timestamptz not null default now()
);
alter table acc_bank_txns add constraint acc_bt_recon_fk foreign key (recon_id) references acc_recons(id);

-- ---------- fixed assets ----------
create table acc_fixed_assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  code text not null, name text not null, class text,
  acquisition_date date not null, cost numeric(16,2) not null check (cost > 0), salvage numeric(16,2) not null default 0,
  life_years numeric(6,2) not null default 5 check (life_years > 0),
  method text not null default 'slm' check (method in ('slm','wdv')),
  rate_pct numeric(7,3),                          -- for wdv
  location text, custodian text,
  pay_account_id uuid references acc_accounts(id),
  purchase_journal_id uuid references acc_journals(id),
  accumulated numeric(16,2) not null default 0,
  status text not null default 'active' check (status in ('active','disposed')),
  disposal_date date, disposal_amount numeric(16,2), disposal_journal_id uuid references acc_journals(id),
  created_by uuid, created_at timestamptz not null default now(),
  unique (tenant_id, code)
);
create table acc_depreciation (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  asset_id uuid not null references acc_fixed_assets(id),
  period_end date not null, amount numeric(16,2) not null check (amount > 0),
  journal_id uuid references acc_journals(id),
  unique (asset_id, period_end)
);

-- ---------- GST integration layer (provider details never touch core posting) ----------
create table acc_einvoice (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  doc_id uuid not null unique references acc_documents(id),
  provider text not null default 'manual',
  status text not null default 'not_generated' check (status in ('not_generated','payload_ready','generated','cancelled','failed')),
  irn text, ack_no text, ack_date timestamptz, signed_qr text,
  payload jsonb, error text, idem_key text,
  updated_at timestamptz not null default now()
);
create table acc_eway (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  doc_id uuid not null unique references acc_documents(id),
  provider text not null default 'manual',
  status text not null default 'not_generated' check (status in ('not_generated','payload_ready','generated','cancelled','failed')),
  ewb_no text, valid_upto timestamptz, vehicle_no text, transport_mode text, distance_km int,
  payload jsonb, error text, updated_at timestamptz not null default now()
);
create table acc_gst_periods (
  tenant_id uuid not null references tenants(id) on delete cascade,
  period text not null,                          -- 'YYYY-MM'
  status text not null default 'filed' check (status in ('filed')),
  filed_on date, reference text, locked_by uuid,
  primary key (tenant_id, period)
);
create table acc_gst_recon (                     -- imported GSTR-2B (portal) rows matched against purchase bills
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  period text not null, supplier_gstin text, supplier_name text, inv_no text, inv_date date,
  taxable numeric(16,2) not null default 0, tax numeric(16,2) not null default 0,
  match_doc_id uuid references acc_documents(id),
  status text not null default 'unmatched' check (status in ('matched','mismatch','missing_in_books','missing_in_portal','unmatched')),
  note text, created_at timestamptz not null default now()
);

-- ---------- communication log, import jobs, attachments, saved views, budgets ----------
create table acc_comms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  channel text not null check (channel in ('email','whatsapp','sms')),
  kind text not null,                            -- invoice, quote, statement, reminder, payment_reminder
  party_id uuid references acc_parties(id), doc_id uuid references acc_documents(id),
  recipient text, subject text, body text,
  status text not null default 'logged' check (status in ('queued','sent','logged','failed')),
  error text, retries int not null default 0,
  created_by uuid, created_at timestamptz not null default now()
);
create table acc_import_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  entity text not null, status text not null default 'previewed' check (status in ('previewed','committed','failed')),
  total int not null default 0, ok int not null default 0, failed int not null default 0, duplicates int not null default 0,
  errors jsonb not null default '[]', mapping jsonb not null default '{}',
  created_by uuid, created_at timestamptz not null default now()
);
create table acc_attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  entity text not null, entity_id uuid not null,
  name text not null, url text not null, size_bytes int,
  created_by uuid, created_at timestamptz not null default now()
);
create table acc_budgets (
  tenant_id uuid not null references tenants(id) on delete cascade,
  fy_id uuid not null references acc_fy(id) on delete cascade,
  account_id uuid not null references acc_accounts(id),
  month int not null check (month between 1 and 12),
  amount numeric(16,2) not null default 0,
  primary key (tenant_id, fy_id, account_id, month)
);
create table acc_saved_views (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid, scope text not null, name text not null, filters jsonb not null default '{}'
);

-- ---------- audit (append-only) ----------
create table acc_audit (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  at timestamptz not null default now(),
  actor uuid, actor_email text,
  action text not null, entity text not null, entity_id text,
  old_value jsonb, new_value jsonb, reason text
);
create index acc_audit_t on acc_audit (tenant_id, at desc);

-- =========================================================
-- Immutability: posted accounting rows can be reversed, never edited or deleted.
-- =========================================================
create function acc_block_change() returns trigger language plpgsql as $$
begin
  -- the one exception: acc_reset_demo() may purge a *demo* tenant's books (it sets acc.reset for its own transaction)
  if tg_op = 'DELETE' and current_setting('acc.reset', true) = '1' and exists (select 1 from tenants where id = old.tenant_id and is_demo) then return old; end if;
  raise exception '% rows are append-only (use a reversal or cancellation)', tg_table_name using errcode = 'P0001';
end $$;
create trigger acc_journals_immutable before update or delete on acc_journals for each row execute function acc_block_change();
create trigger acc_jl_immutable before update or delete on acc_journal_lines for each row execute function acc_block_change();
create trigger acc_stock_immutable before update or delete on acc_stock_moves for each row execute function acc_block_change();
create trigger acc_audit_immutable before update or delete on acc_audit for each row execute function acc_block_change();
create trigger acc_depr_immutable before update or delete on acc_depreciation for each row execute function acc_block_change();

-- Documents: a draft/open document may be edited or deleted; once posted only status,
-- payment progress, e-invoice/transport meta, notes and the cancellation columns may change.
create function acc_doc_guard() returns trigger language plpgsql as $$
begin
  if current_setting('acc.reset', true) = '1' and exists (select 1 from tenants where id = coalesce(new.tenant_id, old.tenant_id) and is_demo) then
    return case when tg_op = 'DELETE' then old else new end;                      -- demo tenant being rebuilt by acc_reset_demo()
  end if;
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
create trigger acc_documents_guard before update or delete on acc_documents for each row execute function acc_doc_guard();

create function acc_line_guard() returns trigger language plpgsql as $$
declare st text; did uuid;
begin
  did := case when tg_op = 'INSERT' then new.doc_id else old.doc_id end;
  select status into st from acc_documents where id = did;
  if current_setting('acc.reset', true) = '1' and tg_op = 'DELETE' then return old; end if;
  if st is not null and st not in ('draft','open') then
    raise exception 'Lines of a posted document cannot change';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end $$;
create trigger acc_doc_lines_guard before insert or update or delete on acc_doc_lines for each row execute function acc_line_guard();

-- A journal must balance by the time its transaction commits.
create function acc_check_balanced() returns trigger language plpgsql as $$
declare d numeric; c numeric;
begin
  select coalesce(sum(debit),0), coalesce(sum(credit),0) into d, c from acc_journal_lines where journal_id = new.journal_id;
  if d <> c then raise exception 'Journal does not balance: debit % vs credit %', d, c; end if;
  return null;
end $$;
create constraint trigger acc_jl_balanced after insert on acc_journal_lines
  deferrable initially deferred for each row execute function acc_check_balanced();

-- ---------- row level security: tenant members may read; nobody writes directly ----------
do $$
declare t text;
begin
  foreach t in array array['acc_org','acc_fy','acc_branches','acc_accounts','acc_parties','acc_masters','acc_warehouses','acc_products','acc_taxcodes','acc_series',
    'acc_documents','acc_doc_lines','acc_journals','acc_journal_lines','acc_payments','acc_allocations','acc_stock_moves','acc_bank_txns','acc_recons',
    'acc_fixed_assets','acc_depreciation','acc_einvoice','acc_eway','acc_gst_periods','acc_gst_recon','acc_comms','acc_import_jobs','acc_attachments','acc_budgets','acc_saved_views','acc_audit']
  loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select using (me() is not null and tenant_id = (me()->>''tenant_id'')::uuid)', t || '_read', t);
    execute format('grant select, insert, update, delete on %I to app', t);
  end loop;
end $$;
grant usage, select on all sequences in schema public to app;
