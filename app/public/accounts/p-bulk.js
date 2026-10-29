/* Bulk import: choose what to bring in, choose the columns, download a sheet in exactly that format, fill it, upload it.
   A bill (purchase or sales) is imported as ONE bill; products not in your list yet are created with the details in the sheet. */
'use strict';
const BK = {
  purchase: { label: 'A purchase bill', sub: 'One supplier bill with all its items. New products are created.', icon: 'receipt', bill: 'bill', party: 'supplier' },
  sale: { label: 'A sales invoice', sub: 'One customer invoice with all its items. New products are created.', icon: 'doc', bill: 'invoice', party: 'customer' },
  products: { label: 'Products', sub: 'Your item list with prices, HSN, GST and stock.', icon: 'box', entity: 'products' },
  customers: { label: 'Customers', sub: 'Names, GST numbers, phones, addresses.', icon: 'user', entity: 'customers' },
  suppliers: { label: 'Suppliers', sub: 'Names, GST numbers, phones, addresses.', icon: 'building', entity: 'suppliers' },
};
// [key, heading in the sheet, required, sample, note]
const BILL_COLS = [
  ['name', 'Item name', 1, 'Blue pen', ''], ['qty', 'Qty', 1, '10', ''], ['rate', 'Rate', 1, '12', 'Price per piece on this bill'],
  ['sale_price', 'Selling price', 0, '15', 'For new products'], ['mrp', 'MRP', 0, '20', ''], ['purchase_price', 'Purchase price', 0, '12', 'For new products'],
  ['hsn', 'HSN code', 0, '9608', ''], ['gst', 'GST %', 0, '18', ''], ['disc', 'Discount %', 0, '0', ''], ['unit', 'Unit', 0, 'Nos', ''],
  ['barcode', 'Barcode', 0, '8901234567890', ''], ['sku', 'Item code', 0, 'PEN-BLUE', 'Made from the name if left out'], ['category', 'Category', 0, 'Stationery', ''], ['brand', 'Brand', 0, 'Reynolds', ''],
];
const bulkNum = (v) => { const m = String(v ?? '').replace(/[₹,\s%]/g, ''); return m !== '' && !isNaN(Number(m)) ? m : ''; };
const bulkKey = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

page('bulk', {
  title: 'Bulk import', icon: 'upload', perm: 'acc_import',
  async render(v) {
    v.header({ title: 'Bulk import' });
    const st = { kind: v.q.get('kind') || '', cols: new Set(['purchase_price', 'sale_price', 'mrp', 'hsn', 'gst']) };
    const host = h('div', { class: 'grid', style: { gap: '14px', maxWidth: '760px' } }); v.root.append(host);
    await products().catch(() => {}); if (!S.parties || !S.parties.length) await parties().catch(() => {});
    const draw = () => {
      clear(host);
      host.append(h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, '1. What do you want to import?')),
        h('div', { class: 'list' }, Object.entries(BK).map(([k, b]) => liRow({ icon: b.icon, title: b.label, sub: b.sub, badge: st.kind === k ? 'Selected' : '', chevron: st.kind !== k, onclick: () => { st.kind = k; draw(); } })))));
      if (!st.kind) return;
      const B = BK[st.kind];
      if (B.entity) return host.append(entityStep(B));
      host.append(billStep(B));
    };
    function entityStep(B) {
      const E = ENT[B.entity];
      return h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, '2. Get the sheet, fill it, upload it')),
        h('div', { class: 'card grid' }, h('p', { class: 'muted small' }, 'Download the sheet, fill one row for each ' + B.label.toLowerCase().replace(/s$/, '') + ', then upload it. Every row is checked first; nothing is saved until you confirm.'),
          h('div', { class: 'row wrap', style: { gap: '8px' } },
            h('button', { class: 'btn', type: 'button', onclick: () => exportXLSX(B.entity + '-sheet', E.fields.map((f) => f[1]), [E.sample]) }, icon('download', 18), 'Download Excel sheet'),
            h('button', { class: 'btn', type: 'button', onclick: () => exportCSV(B.entity + '-sheet', E.fields.map((f) => f[1]), [E.sample]) }, icon('download', 18), 'CSV'),
            h('button', { class: 'btn fill', type: 'button', onclick: () => go('data?entity=' + B.entity) }, icon('upload', 18), 'Upload filled sheet'))));
    }
    function cols() { return BILL_COLS.filter((c) => c[2] || st.cols.has(c[0])); }
    function billStep(B) {
      const sales = B.bill === 'invoice';
      const optional = BILL_COLS.filter((c) => !c[2]);
      const D = { party_id: '', party_new: '', date: today(), ref: '', incl: false, post: false };
      const colBox = h('div', { class: 'row wrap', style: { gap: '8px' } }, optional.map((c) => { const b = h('button', { class: 'chip' + (st.cols.has(c[0]) ? ' on' : ''), type: 'button', 'aria-pressed': st.cols.has(c[0]), onclick: () => { st.cols.has(c[0]) ? st.cols.delete(c[0]) : st.cols.add(c[0]); b.classList.toggle('on'); b.setAttribute('aria-pressed', st.cols.has(c[0])); paintHead(); } }, c[1]); return b; }));
      const headEl = h('div', { class: 'muted small' });
      const paintHead = () => { headEl.textContent = 'Your sheet will have these columns, in this order: ' + cols().map((c) => c[1]).join(' · '); };
      paintHead();
      const ps = (S.parties || []).filter((p) => p.active !== false && (sales ? p.kind !== 'supplier' : p.kind !== 'customer'));
      const partySel = selectEl([['', sales ? 'Walk-in customer' : 'Choose supplier'], ...ps.map((p) => [p.id, p.name]), ['__new', '+ New ' + B.party]], '', { label: B.party, onchange: () => { D.party_id = partySel.value === '__new' ? '' : partySel.value; newName.hidden = partySel.value !== '__new'; } });
      const newName = input({ placeholder: B.party === 'supplier' ? 'Supplier name' : 'Customer name', label: 'New name', oninput: (e) => { D.party_new = e.target.value; } }); newName.hidden = true;
      const dt = input({ type: 'date', value: D.date, label: 'Date', onchange: (e) => { D.date = e.target.value; } });
      const ref = input({ placeholder: 'Supplier\'s bill number', label: 'Bill number', oninput: (e) => { D.ref = e.target.value; } });
      const prevEl = h('div', { class: 'grid' }); let rows = null;
      const file = h('input', { type: 'file', accept: '.csv,.xlsx,.xls,.tsv,.txt', 'aria-label': 'Filled sheet', onchange: async () => {
        const f = file.files[0]; if (!f) return; clear(prevEl);
        try { const t = await readTable(f); rows = parseBill(t); paintPrev(); } catch (e) { rows = null; fail(e); }
      } });
      function parseBill(t) {
        if (t.length < 2) throw new Error('The sheet has no rows');
        const hdr = t[0].map((x) => bulkKey(x)), idx = {};
        BILL_COLS.forEach((c) => { let i = hdr.indexOf(bulkKey(c[1])); if (i < 0) i = hdr.findIndex((x) => x && (x === c[0] || (c[0] === 'name' && /^(item|product|description|particulars)/.test(x)) || (c[0] === 'qty' && /^(qty|quantity)/.test(x)) || (c[0] === 'gst' && /^(gst|tax)/.test(x)) || (c[0] === 'hsn' && /^(hsn|sac)/.test(x)))); if (i >= 0) idx[c[0]] = i; });
        if (idx.name == null || idx.qty == null || idx.rate == null) throw new Error('This sheet needs the columns "Item name", "Qty" and "Rate". Download the sheet above and use its headings.');
        const g = (r, k) => (idx[k] == null ? '' : String(r[idx[k]] ?? '').trim());
        return t.slice(1).map((r, n) => ({ n: n + 2, name: g(r, 'name'), qty: bulkNum(g(r, 'qty')), rate: bulkNum(g(r, 'rate')), sale_price: bulkNum(g(r, 'sale_price')), mrp: bulkNum(g(r, 'mrp')), purchase_price: bulkNum(g(r, 'purchase_price')), hsn: g(r, 'hsn'), gst: bulkNum(g(r, 'gst')), disc: bulkNum(g(r, 'disc')), unit: g(r, 'unit'), barcode: g(r, 'barcode'), sku: g(r, 'sku'), category: g(r, 'category'), brand: g(r, 'brand') })).filter((r) => r.name || r.qty || r.rate);
      }
      const find = (r) => { const k = r.name.toLowerCase(); return (S.products || []).find((p) => p.active !== false && ((r.barcode && p.barcode === r.barcode) || (r.sku && (p.sku || '').toLowerCase() === r.sku.toLowerCase()) || (p.name || '').toLowerCase() === k)); };
      const problems = (r) => { const m = []; if (!r.name) m.push('no item name'); if (!(Number(r.qty) > 0)) m.push('quantity missing'); if (!(Number(r.rate) >= 0) || r.rate === '') m.push('rate missing'); return m; };
      function paintPrev() {
        clear(prevEl); if (!rows || !rows.length) return;
        const info = rows.map((r) => ({ r, p: find(r), bad: problems(r) })), bad = info.filter((x) => x.bad.length), fresh = info.filter((x) => !x.p && !x.bad.length);
        const total = info.reduce((a, x) => a + (Number(x.r.qty) || 0) * (Number(x.r.rate) || 0), 0);
        prevEl.append(h('div', { class: 'row wrap', style: { gap: '8px' } }, h('span', { class: 'badge' }, info.length + ' lines'), h('span', { class: 'badge' }, (info.length - fresh.length - bad.length) + ' existing products'), h('span', { class: 'badge' }, fresh.length + ' new products'), bad.length ? h('span', { class: 'badge', style: { color: 'var(--red)' } }, bad.length + ' need fixing') : null, h('span', { class: 'badge' }, 'About ' + inr(total) + ' before GST')),
          h('div', { class: 'list' }, info.slice(0, 60).map((x) => liRow({ title: x.r.name || '(no name)', sub: (x.r.qty || '?') + ' × ' + (x.r.rate || '?'), badge: x.bad.length ? 'Row ' + x.r.n + ': ' + x.bad.join(', ') : x.p ? 'In your products' : 'New product' }))),
          info.length > 60 ? h('p', { class: 'muted small' }, 'Showing the first 60 lines.') : null,
          toggleRow('Prices in the sheet already include GST', false, (x) => { D.incl = x; }),
          toggleRow('Issue the bill now (cannot be changed after)', false, (x) => { D.post = x; }, 'Off = saved as a draft you can check first.'),
          h('button', { class: 'btn fill', type: 'button', disabled: !!bad.length, onclick: (e) => make(e.currentTarget, info) }, bad.length ? 'Fix the sheet, then upload again' : 'Create the bill'));
      }
      async function make(btn, info) {
        if (!navigator.onLine) return toast('Bulk import needs internet.', { err: true });
        if (!sales && !D.party_id && !D.party_new.trim()) return toast('Choose the supplier first', { err: true });
        btn.disabled = true;
        try {
          let party = D.party_id;
          if (!party && D.party_new.trim()) { const r = await api('acc_save_party', { p: { id: null, kind: B.party, name: D.party_new.trim(), gstin: '', pan: '', state_code: '', reg_type: 'unregistered', phone: '', email: '', billing_address: '', shipping_address: '', credit_days: 0, credit_limit: 0, tags: '', notes: '', active: true } }); party = r.id; bust('parties'); }
          const lines = []; let made = 0;
          for (const { r, p } of info) {
            let prod = p;
            if (!prod) {
              const sale = r.sale_price || (sales ? r.rate : r.mrp || r.rate), buy = r.purchase_price || (sales ? '' : r.rate) || 0;
              const res = await api('acc_save_product', { p: { id: null, name: r.name, sku: r.sku || skuOf(r.name) || ('NP-' + Date.now().toString(36).toUpperCase()), barcode: r.barcode, category: r.category, brand: r.brand, unit: r.unit || 'Nos', hsn: r.hsn, tax_rate: r.gst || defaultTaxRate(), tax_inclusive: D.incl, sale_price: sale || 0, purchase_price: buy || 0, mrp: r.mrp || 0, is_service: false, track_stock: true, track_batch: false, track_serial: false, reorder_level: 0, reorder_qty: 0, notes: '', active: true, price_lists: {} } });
              prod = { id: res.id, tax_rate: r.gst || defaultTaxRate() }; made++;
            }
            lines.push({ product_id: prod.id, description: r.name, hsn: r.hsn || '', qty: r.qty, rate: r.rate, disc_pct: r.disc || '', tax_rate: r.gst || String(prod.tax_rate != null ? prod.tax_rate : defaultTaxRate()), unit: r.unit || '' });
          }
          bust('products'); await products(true);
          const doc = await api('acc_save_document', { p: { doc_type: B.bill, doc_date: D.date, party_id: party || null, price_includes_tax: D.incl, supplier_ref: !sales ? (D.ref || null) : null, reverse_charge: false, itc_eligible: true, post: D.post, lines, payments: [] } });
          bust('products', 'parties'); toast((D.post ? 'Bill issued' : 'Draft saved') + (made ? ' · ' + made + ' new products created' : ''));
          go('doc/' + doc.id);
        } catch (e) { btn.disabled = false; fail(e); }
      }
      return h('div', { class: 'grid', style: { gap: '14px' } },
        h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, '2. Which columns does your sheet need?')), h('div', { class: 'card grid' }, h('p', { class: 'muted small' }, 'Item name, Qty and Rate are always there. Tap to add the details you want to bring in for new products.'), colBox, headEl,
          h('div', { class: 'row wrap', style: { gap: '8px' } },
            h('button', { class: 'btn', type: 'button', onclick: () => exportXLSX(B.bill + '-bill-sheet', cols().map((c) => c[1]), [cols().map((c) => c[3])]) }, icon('download', 18), 'Download Excel sheet'),
            h('button', { class: 'btn', type: 'button', onclick: () => exportCSV(B.bill + '-bill-sheet', cols().map((c) => c[1]), [cols().map((c) => c[3])]) }, icon('download', 18), 'CSV')))),
        h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, '3. Bill details')), h('div', { class: 'card grid' }, field(sales ? 'Customer' : 'Supplier', partySel), newName, h('div', { style: { display: 'grid', gridTemplateColumns: sales ? '1fr' : '1fr 1fr', gap: '12px' } }, field('Date', dt), sales ? null : field('Supplier bill number', ref)))),
        h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, '4. Upload your filled sheet')), h('div', { class: 'card grid' }, file, prevEl)));
    }
    draw();
  },
});
