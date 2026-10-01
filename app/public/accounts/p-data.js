/* Data: import wizard (CSV/Excel, mapping, dry run, commit, error report), exports and backup, message log. */
'use strict';
const ENT = {
  customers: { label: 'Customers', icon: 'user', fields: [['name', 'Name', 1, /name|customer|party/], ['gstin', 'GSTIN', 0, /gstin|gst no/], ['state_code', 'State code', 0, /state/], ['phone', 'Phone', 0, /phone|mobile/], ['email', 'Email', 0, /mail/], ['billing_address', 'Address', 0, /address/], ['credit_days', 'Credit days', 0, /credit days|terms/], ['credit_limit', 'Credit limit', 0, /limit/], ['pan', 'PAN', 0, /pan/], ['contact_name', 'Contact', 0, /contact/], ['tags', 'Tags', 0, /tag/]], sample: ['Sharma Traders', '08AAACR5055K1Z7', '08', '9876543210', 'sharma@example.com', 'Basni, Jodhpur', '30', '100000', '', '', ''] },
  suppliers: { label: 'Suppliers', icon: 'building', fields: [['name', 'Name', 1, /name|supplier|vendor|party/], ['gstin', 'GSTIN', 0, /gstin|gst no/], ['state_code', 'State code', 0, /state/], ['phone', 'Phone', 0, /phone|mobile/], ['email', 'Email', 0, /mail/], ['billing_address', 'Address', 0, /address/], ['credit_days', 'Credit days', 0, /credit days|terms/], ['pan', 'PAN', 0, /pan/], ['contact_name', 'Contact', 0, /contact/]], sample: ['Delhi Wholesale', '07AAECG2222B1Z2', '07', '', '', 'Okhla, Delhi', '30', '', ''] },
  products: { label: 'Products and services', icon: 'box', fields: [['sku', 'SKU', 1, /sku|code|item code/], ['name', 'Name', 1, /name|item|product|desc/], ['hsn', 'HSN/SAC', 0, /hsn|sac/], ['tax_rate', 'GST rate %', 0, /gst|tax|rate %/], ['unit', 'Unit', 0, /unit|uom/], ['sale_price', 'Sale price', 0, /sale|sell|price|mrp/], ['purchase_price', 'Purchase price', 0, /purchase|cost|buy/], ['mrp', 'MRP', 0, /mrp/], ['category', 'Category', 0, /categ/], ['brand', 'Brand', 0, /brand/], ['reorder_level', 'Reorder level', 0, /reorder/], ['barcode', 'Barcode', 0, /barcode|ean/], ['is_service', 'Service (true/false)', 0, /service/]], sample: ['TSH-1', 'Cotton T-shirt', '6109', '12', 'Nos', '499', '300', '599', 'Apparel', '', '10', '', 'false'] },
  accounts: { label: 'Chart of accounts', icon: 'book', fields: [['code', 'Code', 1, /code/], ['name', 'Name', 1, /name/], ['type', 'Type (asset, liability, equity, income, expense)', 1, /type/], ['grp', 'Group', 0, /group|grp/]], sample: ['5120', 'Courier charges', 'expense', 'Operating expenses'] },
  opening_stock: { label: 'Opening stock', icon: 'layers', fields: [['sku', 'SKU', 1, /sku|code/], ['qty', 'Quantity', 1, /qty|quantity/], ['unit_cost', 'Unit cost', 0, /cost|rate|price/], ['warehouse', 'Warehouse code', 0, /warehouse|godown/], ['date', 'As of date', 0, /date/], ['batch_no', 'Batch', 0, /batch/], ['expiry', 'Expiry', 0, /expiry/]], sample: ['TSH-1', '40', '300', 'MAIN', '2026-04-01', '', ''] },
  party_openings: { label: 'Customer and supplier balances', icon: 'users', fields: [['name', 'Party name', 1, /name|party/], ['gstin', 'GSTIN', 0, /gstin/], ['kind', 'customer or supplier', 0, /kind|type/], ['amount', 'Outstanding amount', 1, /amount|balance|outstanding/], ['date', 'As of date', 0, /date/]], sample: ['Sharma Traders', '', 'customer', '25000', '2026-04-01'] },
  account_openings: { label: 'Account opening balances', icon: 'scale', fields: [['code', 'Account code', 1, /code/], ['name', 'Account name', 0, /name/], ['debit', 'Debit', 0, /debit|dr/], ['credit', 'Credit', 0, /credit|cr/]], sample: ['1002', 'Bank account', '250000', ''] },
  sales: { label: 'Sales invoices (history)', icon: 'doc', fields: [['doc_no', 'Invoice number', 1, /invoice|doc|bill no|number/], ['date', 'Date', 1, /date/], ['party', 'Customer', 1, /customer|party|name/], ['gstin', 'Customer GSTIN', 0, /gstin/], ['sku', 'SKU', 0, /sku|code/], ['description', 'Item description', 0, /desc|item|product/], ['hsn', 'HSN/SAC', 0, /hsn|sac/], ['qty', 'Quantity', 1, /qty|quantity/], ['rate', 'Rate', 1, /rate|price/], ['disc_pct', 'Discount %', 0, /disc/], ['tax_rate', 'GST rate %', 0, /gst|tax/], ['due_date', 'Due date', 0, /due/], ['place_of_supply', 'Place of supply (state code)', 0, /supply|pos/]], sample: ['INV-1001', '2026-04-10', 'Sharma Traders', '', 'TSH-1', 'Cotton T-shirt', '6109', '2', '599', '0', '12', '2026-04-25', '08'] },
  purchases: { label: 'Purchase bills (history)', icon: 'receipt', fields: [['doc_no', 'Supplier invoice number', 1, /invoice|doc|bill no|number/], ['date', 'Date', 1, /date/], ['party', 'Supplier', 1, /supplier|vendor|party|name/], ['gstin', 'Supplier GSTIN', 0, /gstin/], ['sku', 'SKU', 0, /sku|code/], ['description', 'Item description', 0, /desc|item|product/], ['hsn', 'HSN/SAC', 0, /hsn|sac/], ['qty', 'Quantity', 1, /qty|quantity/], ['rate', 'Rate', 1, /rate|price/], ['tax_rate', 'GST rate %', 0, /gst|tax/], ['account', 'Expense account code (non-stock lines)', 0, /account/], ['due_date', 'Due date', 0, /due/]], sample: ['DW/2001', '2026-04-05', 'Delhi Wholesale', '', 'TSH-1', 'Cotton T-shirt', '6109', '50', '300', '12', '', '2026-05-05'] },
  receipts: { label: 'Receipts from customers', icon: 'wallet', fields: [['date', 'Date', 1, /date/], ['party', 'Customer', 1, /customer|party|name/], ['amount', 'Amount', 1, /amount/], ['account', 'Cash/bank account (name or code)', 0, /account|bank/], ['mode', 'Method', 0, /mode|method/], ['reference', 'Reference', 0, /ref|utr|cheque/], ['doc_no', 'Invoice it settles', 0, /invoice|doc/]], sample: ['2026-04-20', 'Sharma Traders', '1198', 'Bank account', 'NEFT', 'UTR123', 'INV-1001'] },
  payments: { label: 'Payments to suppliers', icon: 'cash', fields: [['date', 'Date', 1, /date/], ['party', 'Supplier', 1, /supplier|vendor|party|name/], ['amount', 'Amount', 1, /amount/], ['account', 'Cash/bank account (name or code)', 0, /account|bank/], ['mode', 'Method', 0, /mode|method/], ['reference', 'Reference', 0, /ref|utr|cheque/], ['doc_no', 'Bill it settles', 0, /invoice|doc|bill/]], sample: ['2026-04-25', 'Delhi Wholesale', '15000', 'Bank account', 'NEFT', 'UTR555', 'DW/2001'] },
};

page('data', {
  title: 'Import and export', icon: 'upload', perm: 'acc_view',
  async render(v) {
    v.header({ title: 'Import and export' });
    const tab = v.q.get('tab') || 'import';
    v.root.append(seg([['import', 'Import'], ['export', 'Export and backup']], tab, (t) => go('data?tab=' + t)));
    const host = h('div', { class: 'grid' }); v.root.append(host);
    if (tab === 'export') return exportTab(host);
    if (!can('acc_import')) { host.append(empty('lock', 'No access', 'Importing needs the import permission.')); return; }
    const ent = v.q.get('entity');
    if (ent && ENT[ent]) return importWizard(host, ent, v);
    host.append(h('p', { class: 'muted' }, 'Bring in your existing data from a spreadsheet. You choose the columns, we check every row first (a dry run that changes nothing), and you only import once it looks right.'),
      h('div', { class: 'list' }, Object.entries(ENT).map(([k, e]) => liRow({ icon: e.icon, title: e.label, sub: 'CSV or Excel · ' + e.fields.filter((f) => f[2]).map((f) => f[1]).join(', ') + ' required', chevron: true, onclick: () => go('data?entity=' + k) }))));
    try { const jobs = (await api('acc_list_imports')).rows; if (jobs.length) host.append(h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Recent imports')), h('div', { class: 'list' }, jobs.slice(0, 10).map((j) => liRow({ icon: 'file', tone: 'gray', title: (ENT[j.entity] || { label: j.entity }).label, sub: fmtDT(j.created_at) + ' · ' + j.ok + ' ok, ' + j.failed + ' failed' + (j.duplicates ? ', ' + j.duplicates + ' duplicates' : ''), badge: badge(cap1(j.status), j.status === 'committed' ? 'green' : j.status === 'failed' ? 'red' : '') }))))); } catch { /* ignore */ }
  },
});

async function importWizard(host, entity, v) {
  const E = ENT[entity]; v.header({ title: 'Import ' + E.label.toLowerCase(), back: 'data' });
  let table = null, hdr = [], map = {}, result = null;
  const opts = { on_duplicate: 'skip', create_missing: true, strict: true, date: curFY().start_date };
  const fileIn = h('input', { type: 'file', accept: '.csv,.xlsx,.txt', class: 'input', 'aria-label': 'File to import' });
  const mapEl = h('div', { class: 'grid' }), resEl = h('div', { class: 'grid' }), optEl = h('div', { class: 'grid' });
  const sigKey = () => 'acc_imp_' + entity + '_' + hdr.join('|').slice(0, 200);
  const guess = () => { const g = {}; E.fields.forEach(([k, , , re]) => { g[k] = hdr.findIndex((n) => re.test(String(n).toLowerCase()) || String(n).toLowerCase().replace(/[^a-z0-9]/g, '') === k.replace(/_/g, '')); }); return g; };
  const drawMap = () => {
    clear(mapEl); if (!table) return;
    mapEl.append(h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, '2. Match your columns'), h('span', { class: 'muted small' }, (table.length - 1) + ' rows')),
      h('div', { class: 'card grid' }, E.fields.map(([k, l, req]) => { const s = selectEl([['-1', req ? 'Choose column' : 'Not in my file'], ...hdr.map((n, i) => [String(i), String(n || 'Column ' + (i + 1))])], String(map[k] ?? -1), { label: l, cls: req && map[k] < 0 ? 'err' : '', onchange: () => { map[k] = Number(s.value); s.classList.toggle('err', req && map[k] < 0); result = null; drawRes(); try { localStorage.setItem(sigKey(), JSON.stringify(map)); } catch { /* ignore */ } } }); return field(l + (req ? ' *' : ''), s); }))));
    optEl.replaceChildren(h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, '3. Rules')), h('div', { class: 'card grid' },
      ['customers', 'suppliers', 'products', 'accounts'].includes(entity) ? field('If it already exists', selectEl([['skip', 'Skip it'], ['update', 'Update it']], opts.on_duplicate, { onchange: (e) => { opts.on_duplicate = e.target.value; result = null; drawRes(); } })) : null,
      ['sales', 'purchases'].includes(entity) ? toggleRow('Create missing ' + (entity === 'sales' ? 'customers' : 'suppliers'), opts.create_missing, (x) => { opts.create_missing = x; result = null; drawRes(); }) : null,
      ['party_openings', 'account_openings'].includes(entity) ? field('Opening date', dateInput(opts.date, { onchange: (e) => { opts.date = e.target.value; } })) : null,
      toggleRow('Stop if any row has an error', opts.strict, (x) => { opts.strict = x; }, 'On: nothing is imported unless every row is valid. Off: valid rows are imported and the rest are reported.'))));
  };
  const rowsFor = () => table.slice(1).map((r, i) => { const o = { _row: i + 2 }; E.fields.forEach(([k]) => { const ix = map[k]; if (ix >= 0) o[k] = String(r[ix] ?? '').trim(); }); return o; }).filter((o) => Object.entries(o).some(([k, x]) => k !== '_row' && x !== ''));
  const run = async (commit) => {
    const missing = E.fields.filter((f) => f[2] && !(map[f[0]] >= 0)); if (missing.length) { toast('Choose a column for ' + missing.map((m) => m[1]).join(', '), { err: true }); return; }
    const rows = rowsFor(); if (!rows.length) { toast('No data rows found', { err: true }); return; }
    const size = ['sales', 'purchases', 'opening_stock', 'account_openings'].includes(entity) ? rows.length : 1500, agg = { total: 0, ok: 0, created: 0, updated: 0, duplicates: 0, failed: 0, errors: [], preview: [] };
    if (JSON.stringify(rows).length > 4.5e6) { toast('This file is too large for one import. Split it into smaller files.', { err: true }); return; }
    try {
      for (let i = 0; i < rows.length; i += size) { const r = await api('acc_import', { p_entity: entity, p_rows: rows.slice(i, i + size), p_commit: commit, p_strict: opts.strict, p_options: { on_duplicate: opts.on_duplicate, create_missing: opts.create_missing, date: opts.date } }); ['total', 'ok', 'created', 'updated', 'duplicates', 'failed'].forEach((k) => (agg[k] += r[k])); agg.errors.push(...r.errors); if (agg.preview.length < 20) agg.preview.push(...r.preview); if (commit && r.failed && opts.strict) break; }
      agg.committed = commit && agg.ok > 0 && (agg.failed === 0 || !opts.strict); agg.dry = !commit; result = agg; drawRes();
      if (commit && agg.committed) { toast('Imported ' + agg.created + ' new, ' + agg.updated + ' updated'); bust(); await loadCtx().catch(() => {}); }
    } catch (e) { fail(e); }
  };
  const drawRes = () => {
    clear(resEl); if (!table) return;
    const r = result;
    resEl.append(h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, '4. Check, then import')),
      h('div', { class: 'row wrap' }, h('button', { class: 'btn', onclick: () => run(false) }, icon('check', 18), 'Check the file (no changes)'), h('button', { class: 'btn fill', disabled: !r || !r.dry || r.ok === 0 || (opts.strict && r.failed > 0), onclick: async () => { if (await confirmBox('Import ' + r.ok + ' ' + E.label.toLowerCase() + '?', opts.strict ? 'Everything is checked and will be imported together.' : 'Valid rows are imported; rows with errors are skipped and reported.', 'Import')) run(true); } }, icon('upload', 18), 'Import')),
      r ? h('div', { class: 'card grid' }, h('div', { class: 'kpis' }, kpi(r.dry ? 'Would import' : 'Imported', String(r.ok), r.created + ' new · ' + r.updated + ' updated'), kpi('Duplicates', String(r.duplicates), 'Skipped'), kpi('Errors', String(r.failed), r.failed ? 'Fix and check again' : 'None', null, r.failed ? 'down' : 'up')),
        r.dry ? h('div', { class: 'banner ' + (r.failed ? (opts.strict ? 'bad' : '') : 'ok') }, icon(r.failed ? 'alert' : 'check', 18), r.failed ? (opts.strict ? 'Fix these rows first, or turn off “Stop if any row has an error”.' : 'These rows will be skipped.') : 'Looks good. Nothing has been changed yet.') : h('div', { class: 'banner ' + (r.committed ? 'ok' : 'bad') }, icon(r.committed ? 'check' : 'alert', 18), r.committed ? 'Imported.' : 'Nothing was imported.'),
        r.errors.length ? h('div', { class: 'grid' }, h('div', { class: 'row sp' }, h('b', null, 'Row errors'), h('button', { class: 'btn sm', onclick: () => exportCSV('import-errors-' + entity, ['Row', 'Key', 'Message'], r.errors.map((x) => [x.row, x.key || '', x.message])) }, 'Download error report')), h('div', { class: 'list' }, r.errors.slice(0, 40).map((x) => liRow({ icon: 'alert', tone: 'orange', title: 'Row ' + x.row + (x.key ? ' · ' + x.key : ''), sub: x.message })))) : null) : null));
  };
  const tplBtn = h('button', { class: 'btn sm', onclick: () => exportCSV(entity + '-template', E.fields.map((f) => f[1]), [E.sample]) }, icon('download', 16), 'Download template');
  fileIn.onchange = async () => {
    try { table = await readTable(fileIn.files[0]); if (table.length < 2) throw new Error('The file has no data rows'); hdr = table[0].map((x) => String(x ?? '')); map = guess(); try { const saved = JSON.parse(localStorage.getItem(sigKey()) || 'null'); if (saved) map = { ...map, ...saved }; } catch { /* ignore */ } result = null; drawMap(); drawRes(); } catch (e) { fail(e); table = null; clear(mapEl); clear(resEl); }
  };
  host.append(h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, '1. Choose your file'), tplBtn), h('div', { class: 'card grid' }, h('p', { class: 'muted small' }, 'CSV or Excel (.xlsx). The first row must be column names. Dates like 2026-04-10 or 10/04/2026 both work.'), fileIn)), mapEl, optEl, resEl,
    ['sales', 'purchases'].includes(entity) ? h('p', { class: 'cap' }, 'History is posted through the normal engine, so stock and GST are affected. Import opening stock first, and make sure the financial year for each date exists. Original invoice numbers are kept on sales.') : null);
}

async function exportTab(host) {
  host.append(h('div', { class: 'list' }, [
    ['Customers', 'customers', 'users'], ['Suppliers', 'suppliers', 'building'], ['Products', 'products', 'box'], ['Chart of accounts', 'accounts', 'book'], ['Fixed assets', 'assets', 'building'], ['Audit log', 'reports/audit', 'shield'],
  ].map(([l, p, i]) => liRow({ icon: i, tone: 'gray', title: l, sub: 'Open it and use Export for CSV, Excel or PDF', chevron: true, onclick: () => go(p) }))),
    h('div', { class: 'card grid' }, h('h3', null, 'Download a data backup'), h('p', { class: 'muted small' }, 'A JSON file with your organisation settings, chart of accounts, customers, suppliers, products, GST rates, and every document and payment header. Keep it somewhere safe. Your server also takes its own full database backups; ask your administrator to test a restore.'),
      h('button', { class: 'btn fill', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { await downloadBackup(); } catch (x) { fail(x); } b.disabled = false; } }, icon('download', 18), 'Download backup (JSON)')));
}
async function downloadBackup() {
  const docs = []; for (const types of [['invoice', 'credit_note', 'quotation', 'sales_order', 'delivery_challan'], ['bill', 'debit_note', 'expense', 'purchase_order', 'purchase_request', 'goods_receipt']]) { for (let off = 0; off < 20000; off += 500) { const r = await api('acc_list_documents', { p: { types, limit: 500, offset: off } }); docs.push(...r.rows); if (r.rows.length < 500) break; } }
  const pays = (await api('acc_list_payments', { p: { limit: 500 } })).rows;
  const data = { exported_at: new Date().toISOString(), org: S.org, financial_years: S.fys, accounts: S.accounts, gst_rates: S.taxcodes, branches: S.branches, warehouses: S.warehouses, parties: (await parties(true)), products: (await products(true)), documents: docs, payments: pays, note: 'Document headers and payment headers only. Lines and journals can be exported from each document and the Day book.' };
  download('auzslab-accounting-backup-' + today() + '.json', new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
  toast('Backup downloaded');
}

page('messages', {
  title: 'Messages', icon: 'chat', perm: 'acc_view',
  async render(v) {
    v.header({ title: 'Messages' });
    const r = (await api('acc_list_comms')).rows;
    v.root.append(h('div', { class: 'banner info' }, icon('info', 18), 'AUZslab opens WhatsApp or your email app with the message ready and keeps a record here. It does not send email by itself, so a message marked “Logged” was handed to your app, not confirmed delivered.'),
      dataView([{ key: 'subject', label: 'Message', title: true, render: (x) => x.subject || cap1(x.kind) }, { key: 'party', label: 'To', sub: true, render: (x) => [x.party, x.recipient].filter(Boolean).join(' · ') + ' · ' + fmtDT(x.created_at) }, { key: 'channel', label: 'Channel', render: (x) => cap1(x.channel) }, { key: 'doc_number', label: 'Document', render: (x) => x.doc_number || '' }, { key: 'created_at', label: 'When', render: (x) => fmtDT(x.created_at) },
        { key: 'status', label: 'Status', badge: true, render: (x) => badge(cap1(x.status), x.status === 'sent' ? 'green' : x.status === 'failed' ? 'red' : '') }], r, { onRow: (x) => commSheet(x, () => v.refresh()), empty: empty('chat', 'No messages yet', 'Share an invoice or send a reminder and it appears here.') }));
  },
});
function commSheet(x, done) {
  sheet({ title: x.subject || 'Message', closeLabel: 'Close', body: h('div', { class: 'grid' }, h('div', { class: 'small muted' }, cap1(x.channel) + ' · ' + fmtDT(x.created_at) + (x.recipient ? ' · ' + x.recipient : '')), h('div', { class: 'card', style: { whiteSpace: 'pre-wrap' } }, x.body || ''), x.error ? h('div', { class: 'banner bad' }, x.error) : null),
    actions: [{ label: 'Mark as sent', onclick: async (c) => { await api('acc_retry_comm', { p_id: x.id, p_status: 'sent' }); c(); done(); } }, { label: 'Mark as failed', danger: true, onclick: async (c) => { await api('acc_retry_comm', { p_id: x.id, p_status: 'failed' }); c(); done(); } }] });
}
