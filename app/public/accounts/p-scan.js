/* Scan to bill: point the camera at a barcode to sell it (a real GST invoice, stock down, books posted) or to receive stock.
   Used inside AUZsLedger (#/scan) and as the standalone AUZsScan app (scan.html). It adds no server code: it uses the same
   functions as the invoice editor and the stock screens (acc_list_products, acc_save_product, acc_stock_adjust,
   acc_save_document, acc_share_document), and the same GST maths (calcDoc in p-editor.js), so the books cannot disagree.
   A barcode is only an ID. Price, HSN and GST always come from the product. OFFLINE-FIRST: with no connection (or a connection too
   slow to answer) a sale, a new product and received stock are kept on the phone (scan-sync.js: sqEnqueue) and sent later through
   acc_offline_apply, idempotent on the operation id. A sale made offline shows a PROVISIONAL number (OFF-xxx-n); the books give the
   real gapless invoice number when it syncs. Loaded after scan-sync.js, p-docs.js, p-editor.js, p-parties.js and p-stock.js. */
'use strict';
ICONS.scan = '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M7.5 9v6M11 9v6M14.5 9v6M17 9v6"/>';

const SC = { mode: 'sell', cart: [], recv: [], party: null, pay: 'cash', acct: {}, ref: '', got: '', incl: null, phone: '', name: '' };
const SC_METHOD = { cash: 'Cash', upi: 'UPI', bank: 'NEFT/RTGS' };
const SC_KEY = 'scan.cart';

// ---------- keep the cart if the page is refreshed by accident ----------
function scPersist() {
  try { sessionStorage[SC_KEY] = JSON.stringify({ cart: SC.cart.map((l) => ({ id: l.p.id, qty: l.qty, rate: l.rate, disc: l.disc, dtype: l.dtype, gst: l.gst })), recv: SC.recv.map((l) => ({ id: l.p.id, qty: l.qty, cost: l.cost })), incl: SC.incl }); } catch (e) { /* private mode */ }
}
function scRestore() {
  if (SC.cart.length || SC.recv.length) return;
  try {
    const s = JSON.parse(sessionStorage[SC_KEY] || 'null'); if (!s) return;
    const by = (id) => (S.products || []).find((p) => p.id === id);
    SC.cart = (s.cart || []).map((l) => ({ p: by(l.id), qty: l.qty, rate: l.rate, disc: l.disc, dtype: l.dtype || 'pct', gst: l.gst })).filter((l) => l.p);
    SC.recv = (s.recv || []).map((l) => ({ p: by(l.id), qty: l.qty, cost: l.cost })).filter((l) => l.p);
    SC.incl = s.incl == null ? null : s.incl;
  } catch (e) { /* ignore a bad copy */ }
}

// ---------- finding a product from a code ----------
// The barcode, or the SKU, or (12-digit UPC-A / 13-digit EAN with a leading zero) the same product written the other way.
async function scLookup(code) {
  const vs = auzScanner.variants(code), low = String(code).trim().toLowerCase();
  const hit = (p) => p.active && (vs.includes(String(p.barcode || '').trim()) || String(p.sku || '').toLowerCase() === low);
  let m = (await products()).filter(hit);
  if (!m.length && S.productsPartial && !offlineNow()) {            // a very large catalogue is searched on the server
    for (const v of vs) { try { m = (await searchProducts(v)).filter(hit); } catch (e) { m = []; } if (m.length) break; }
  }
  return m;
}
function scChoose(matches, code) {
  return new Promise((resolve) => {
    let done = false;
    const s = sheet({ title: 'Which one?', closeLabel: 'Cancel', onClose: () => { if (!done) resolve(null); },
      body: h('div', { class: 'grid' }, h('p', { class: 'muted' }, 'More than one product has the code ' + code + '. Choose the one you mean. You can fix the duplicate under Products.'),
        h('div', { class: 'list' }, matches.map((p) => liRow({ title: p.name, sub: p.sku + ' · ' + qty(p.stock) + ' ' + p.unit + ' in stock', value: inr(p.sale_price), onclick: () => { done = true; s.close(); resolve(p); } })))) });
  });
}

// ---------- unknown barcode: ask for the details, create the product ----------
// sell: the stock entered is posted now (it has to exist to be sold). add: the stock entered is the quantity being received.
function scNewProduct(code, o = {}) {
  return new Promise((resolve) => {
    if (!can('acc_inventory')) {
      alertBox({ title: 'Not in your products', message: (code ? 'The code ' + code + ' is not a product yet, and your role cannot add products.' : 'Your role cannot add products.') + ' Ask the owner to add it (Products, then New product).', cancel: false, confirm: 'OK' }).then(() => resolve(null));
      return;
    }
    let done = false, incl = true;
    const name = input({ placeholder: 'Product name', label: 'Name', value: o.name || '' }), bc = code ? null : input({ placeholder: 'Optional', label: 'Barcode', mode: 'numeric' }), sale = input({ mode: 'decimal', placeholder: '0.00', label: 'Selling price' }), buy = input({ mode: 'decimal', placeholder: '0.00', label: 'Purchase price' }), mrp = input({ mode: 'decimal', placeholder: '0.00', label: 'MRP' });
    mrp.addEventListener('blur', () => { if (!sale.value && N(mrp.value) > 0) sale.value = mrp.value; });
    const gst = selectEl(taxRates().map((r) => [String(r), r + '%']), String(defaultTaxRate())), unit = selectEl(uniq([...UNITS_DEFAULT, ...master('unit')]), 'Nos'), hsn = input({ mode: 'numeric', placeholder: 'Optional', label: 'HSN' });
    const stock = input({ mode: 'decimal', value: '1', label: o.add ? 'Quantity received' : 'Number in stock' });
    const s = sheet({ title: 'New product', closeLabel: 'Cancel', onClose: () => { if (!done) resolve(null); },
      body: h('div', { class: 'grid' }, h('div', { class: 'banner info' }, icon('info', 18), code ? 'Barcode ' + code + ' is new. Add the details once; next time the scan fills everything in.' : 'Add the product once. It is saved to your products and added to this bill.'),
        field('Name', name), bc ? field('Barcode (if it has one)', bc) : null, h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } }, field('MRP', mrp), field('Selling price', sale)),
        h('div', { style: { display: 'grid', gridTemplateColumns: '1fr', gap: '12px' } }, field('Purchase price', buy)),
        toggleRow('Selling price includes GST', true, (x) => { incl = x; }, 'Most packed goods are priced at MRP, tax included.'),
        h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } }, field('GST rate', gst), field('Unit', unit)),
        h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } }, field('HSN code', hsn), field(o.add ? 'Quantity received' : 'Number in stock', stock))),
      actions: [{ label: 'Save and continue', primary: true, onclick: async (c) => {
        if (!name.value.trim()) { toast('Enter the product name', { err: true }); return false; }
        if (!(N(sale.value) > 0)) { toast('Enter the selling price', { err: true }); return false; }
        if (N(mrp.value) > 0 && N(sale.value) > N(mrp.value)) { toast('The selling price is above the MRP', { err: true }); return false; }
        if (!o.add && N(stock.value) > 0 && !(N(buy.value) > 0)) { toast('Enter the purchase price so the stock can be valued, or set the number in stock to 0', { err: true }); return false; }
        const body = { id: null, name: name.value.trim(), sku: code || ('NP-' + Date.now().toString(36).toUpperCase()), barcode: code || (bc ? bc.value.trim() : ''), category: '', brand: '', unit: unit.value, hsn: hsn.value.trim(), tax_rate: gst.value, tax_inclusive: incl, sale_price: sale.value, purchase_price: buy.value || 0, mrp: mrp.value || 0,
          is_service: false, track_stock: true, track_batch: false, track_serial: false, reorder_level: 0, reorder_qty: 0, notes: '', active: true, price_lists: {} };
        // no connection: keep the product (and its opening stock) on this phone; it reaches the books when the connection is back
        if (offlineNow()) {
          try {
            const tmp = { ...body, id: sqTempId(), tax_rate: Number(gst.value), avg_cost: Number(buy.value) || 0 }, q0 = N(stock.value);
            await sqEnqueue('product', body, { temp: tmp });
            if (!o.add && q0 > 0) { const wh0 = S.warehouses.find((w) => w.is_default) || S.warehouses[0]; await sqEnqueue('stock', { mode: 'delta', warehouse_id: wh0 && wh0.id, date: today(), reason: 'Stock added while scanning', opening: false, lines: [{ product_id: tmp.id, qty: q0, unit_cost: buy.value || null }] }); }
            sqRefreshLocal(); done = true; c(); toast('Saved on this phone. It reaches your books when you are back online.');
            resolve({ p: (S.products || []).find((x) => x.id === tmp.id) || tmp, qty: q0 });
          } catch (e) { fail(e); return false; }
          return;
        }
        try {
          const r = await api('acc_save_product', { p: body });
          bust('products'); await products(true);
          const p = (S.products || []).find((x) => x.id === (r && r.id)) || (code ? (await scLookup(code))[0] : null);
          if (!p) throw new Error('The product was saved but could not be loaded. Search for it by name.');
          const q = N(stock.value);
          if (!o.add && q > 0) {
            const wh = S.warehouses.find((w) => w.is_default) || S.warehouses[0];
            await api('acc_stock_adjust', { p: { mode: 'delta', warehouse_id: wh && wh.id, date: today(), reason: 'Stock added while scanning', opening: false, lines: [{ product_id: p.id, qty: q, unit_cost: buy.value || null }] } });
            bust('products'); await products(true);
          }
          done = true; c(); resolve({ p: (S.products || []).find((x) => x.id === p.id) || p, qty: q });
        } catch (e) { fail(e); return false; }
      } }] });
    name.focus();
  });
}

// ---------- adding to the cart / the receive list ----------
// GST for one bill line: what the cashier chose for this bill, else the product's own rate
const scRate = (l) => (l.gst != null && l.gst !== '' ? l.gst : l.p.tax_rate);
const scLimited = (p) => !S.org.allow_negative_stock && p.track_stock && !p.is_service;
const scBad = (r) => { if (r && r.bad) auzScanner.beep(false); return r; };
function scSellAdd(p, n = 1) {
  const ex = SC.cart.find((l) => l.p.id === p.id), next = (ex ? ex.qty : 0) + n;
  if (scLimited(p) && next > Number(p.stock)) return { text: Number(p.stock) <= 0 ? p.name + ' is out of stock' : 'Only ' + qty(p.stock) + ' ' + p.unit + ' of ' + p.name + ' in stock', bad: true };
  if (ex) ex.qty = next; else SC.cart.push({ p, qty: n, rate: String(p.sale_price), disc: '', dtype: 'pct' });
  if (p.tax_inclusive && SC.incl == null) SC.incl = true;
  scPersist();
  return { text: p.name + '  ×  ' + qty(next), bad: false };
}
function scRecvAdd(p, n = 1) {
  if (p.is_service || !p.track_stock) return { text: p.name + ' does not hold stock', bad: true };
  const ex = SC.recv.find((l) => l.p.id === p.id), next = (ex ? ex.qty : 0) + n;
  if (ex) ex.qty = next; else SC.recv.push({ p, qty: n, cost: String(Number(p.purchase_price) || Number(p.avg_cost) || '') });
  scPersist();
  return { text: p.name + '  ×  ' + qty(next), bad: false };
}
const scAddRaw = (p, n) => (SC.mode === 'sell' ? scSellAdd(p, n) : scRecvAdd(p, n));
const scAdd = (p, n) => scBad(scAddRaw(p, n));

// ---------- the totals ----------
function scDoc() {
  return { doc_type: 'invoice', party_id: SC.party ? SC.party.id : '', branch_id: S.branches.length === 1 ? S.branches[0].id : '', place_of_supply: '', price_includes_tax: !!SC.incl, reverse_charge: false, roundoff: '',
    lines: SC.cart.map((l) => ({ product_id: l.p.id, description: l.p.name, hsn: l.p.hsn || '', qty: String(l.qty), unit: l.p.unit || '', rate: String(l.rate), disc_pct: l.dtype === 'pct' ? String(l.disc || '') : '', disc_amt: l.dtype === 'amt' ? String(l.disc || '') : '', tax_rate: String(scRate(l)) })) };
}
const scTotals = () => calcDoc(scDoc());
const scCount = () => (SC.mode === 'sell' ? SC.cart : SC.recv).reduce((s, l) => s + l.qty, 0);
function scSummary() {
  if (SC.mode === 'sell') { const n = SC.cart.length; return n ? n + (n === 1 ? ' item' : ' items') + '  ·  ' + inr(scTotals().total) : 'Nothing scanned yet'; }
  const n = SC.recv.length; return n ? n + (n === 1 ? ' item' : ' items') + ' to add to stock' : 'Nothing scanned yet';
}

// ---------- the camera ----------
function scStart(v) {
  if (!window.auzScanner) return toast('The scanner could not load. Reload the page and try again.', { err: true });
  const sum = h('div', { style: { color: '#fff', textAlign: 'center', fontWeight: '600', fontSize: '17px', padding: '2px 0' } }, scSummary());
  auzScanner.open({
    title: SC.mode === 'sell' ? 'Scan to sell' : 'Scan to add stock', doneLabel: 'Done', footer: sum,
    onCode: async (code, ctl) => {
      const m = await scLookup(code);
      if (m.length === 1) { const r = scAddRaw(m[0]); sum.textContent = scSummary(); return r; }   // the camera overlay beeps low itself for a refusal
      ctl.pause(); ctl.close();                                    // the next step is a sheet: leave the camera, come back after
      let p = null, extra = null;
      if (m.length > 1) p = await scChoose(m, code);
      else { const r = await scNewProduct(code, { add: SC.mode === 'add' }); if (r) { p = r.p; extra = r; } }
      if (p) {
        const res = SC.mode === 'add' && extra ? scBad(scRecvAdd(p, extra.qty > 0 ? extra.qty : 1)) : scAdd(p);
        toast(res.text, { err: res.bad }); v.refresh(); if (!res.bad) scStart(v); return;
      }
      v.refresh();
    },
    onClose: () => v.refresh(),
  });
}

// ---------- editing one line ----------
// The first block changes this bill only. "Product prices" changes the saved product itself (selling price, purchase price, MRP), for
// every future scan too, even for a product saved long ago. It needs the same permission as editing the product under Products.
async function scSaveProductPrices(p, sale, buy, mrp) {
  const r = await api('acc_save_product', { p: { id: p.id, name: p.name, sku: p.sku, barcode: p.barcode || '', category: p.category || '', brand: p.brand || '', unit: p.unit, hsn: p.hsn || '', tax_rate: p.tax_rate, tax_inclusive: p.tax_inclusive,
    sale_price: sale, purchase_price: buy, mrp, is_service: p.is_service, track_stock: p.track_stock, track_batch: p.track_batch, track_serial: p.track_serial, reorder_level: p.reorder_level || 0, reorder_qty: p.reorder_qty || 0, notes: p.notes || '', active: p.active !== false, price_lists: p.price_lists || {} } });
  bust('products'); await products(true);
  return (S.products || []).find((x) => x.id === p.id) || p;
}
function scLineSheet(l, done) {
  const sell = SC.mode === 'sell', q = input({ mode: 'decimal', value: l.qty, label: 'Quantity' }), r = input({ mode: 'decimal', value: sell ? l.rate : l.cost, label: sell ? 'Price' : 'Cost' }), d = input({ mode: 'decimal', value: l.disc || '', placeholder: '0', label: 'Discount' });
  let dt = l.dtype;
  const gstSel = selectEl(uniq([...taxRates(), Number(scRate(l))]).sort((a, b) => a - b).map((r2) => [String(r2), r2 + '%']), String(Number(scRate(l))));
  const list = sell ? SC.cart : SC.recv, p = l.p, canEdit = can('acc_inventory');
  const mrpNote = h('div', { class: 'small', style: { fontWeight: 600, minHeight: '18px' } });
  const showMrp = () => { const m = Number(p.mrp) || 0, x = N(r.value); mrpNote.textContent = m > 0 ? 'MRP ' + inr(m) + (sell && x > m ? '  ·  above MRP' : '') : ''; mrpNote.style.color = m > 0 && sell && x > m ? 'var(--red, #c0392b)' : ''; };
  r.addEventListener('input', showMrp); showMrp();
  const ps = input({ mode: 'decimal', value: Number(p.sale_price) || '', placeholder: '0.00', label: 'Selling price' }), pb = input({ mode: 'decimal', value: Number(p.purchase_price) || '', placeholder: '0.00', label: 'Purchase price' }), pm = input({ mode: 'decimal', value: Number(p.mrp) || '', placeholder: '0.00', label: 'MRP' });
  const body = h('div', { class: 'grid' }, h('div', { class: 'muted small' }, p.sku + (p.hsn ? ' · HSN ' + p.hsn : '') + ' · GST ' + p.tax_rate + '%' + (p.is_service ? '' : ' · ' + qty(p.stock) + ' ' + p.unit + ' in stock')),
    h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } }, field('Quantity', q), field(sell ? 'Price each (this bill)' : 'Cost each', r)), mrpNote,
    sell ? field('GST on this item (this bill only)', gstSel, 'Choose 0% for an item that carries no GST. The saved product is not changed.') : null,
    sell ? h('div', { class: 'grid' }, field('Discount on this item', d), seg([['pct', 'Percent'], ['amt', 'Rupees']], dt, (x) => { dt = x; }, { full: true })) : null,
    canEdit ? h('div', { class: 'grid', style: { gap: '10px', borderTop: '1px solid var(--sep, #ddd)', paddingTop: '12px' } }, h('h3', null, 'Product prices'),
      h('p', { class: 'small muted' }, 'Change the saved prices of this product for every future bill. This is not limited to this bill.'),
      h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' } }, field('Selling', ps), field('Purchase', pb), field('MRP', pm)),
      h('button', { class: 'btn', type: 'button', onclick: async (e) => {
        if (!(N(ps.value) >= 0) || !(N(pb.value) >= 0) || !(N(pm.value) >= 0)) return toast('Enter valid prices', { err: true });
        if (N(pm.value) > 0 && N(ps.value) > N(pm.value)) return toast('The selling price is above the MRP', { err: true });
        const btn = e.currentTarget; btn.disabled = true;
        try {
          const old = Number(p.sale_price), np = await scSaveProductPrices(p, ps.value || 0, pb.value || 0, pm.value || 0);
          l.p = np; SC.cart.concat(SC.recv).forEach((x) => { if (x.p.id === np.id) x.p = np; });
          if (sell && N(l.rate) === old) { l.rate = String(np.sale_price); r.value = l.rate; }
          if (!sell && Number(np.purchase_price) > 0) { l.cost = String(np.purchase_price); r.value = l.cost; }
          scPersist(); showMrp(); toast('Product prices saved');
        } catch (er) { fail(er); } finally { btn.disabled = false; }
      } }, 'Save product prices')) : null);
  sheet({ title: l.p.name, closeLabel: 'Cancel', body, actions: [
    { label: 'Save', primary: true, onclick: (c) => {
      const nq = N(q.value); if (!(nq > 0)) { toast('Quantity must be more than zero', { err: true }); return false; }
      if (sell && scLimited(l.p) && nq > Number(l.p.stock)) { toast('Only ' + qty(l.p.stock) + ' ' + l.p.unit + ' in stock', { err: true }); return false; }
      if (sell) { if (N(r.value) < 0) { toast('Price cannot be negative', { err: true }); return false; } l.rate = r.value; l.disc = d.value; l.dtype = dt; l.gst = gstSel.value; } else l.cost = r.value;
      l.qty = nq; scPersist(); c(); done();
    } },
    { label: 'Remove', danger: true, onclick: (c) => { list.splice(list.indexOf(l), 1); scPersist(); c(); done(); } }] });
}

// ---------- charging ----------
function scPayAccounts(kind) {
  const all = payAccounts();
  const m = kind === 'cash' ? all.filter((a) => a.is_cash) : all.filter((a) => a.is_bank);
  return m.length ? m : all;
}
function scPayload(post, C) {
  const lines = SC.cart.map((l) => ({ product_id: l.p.id, description: l.p.name, hsn: l.p.hsn || '', qty: String(l.qty), unit: l.p.unit || '', rate: String(l.rate), disc_pct: l.dtype === 'pct' && l.disc ? String(l.disc) : null, disc_amt: l.dtype === 'amt' && l.disc ? String(l.disc) : null,
    tax_rate: String(scRate(l)), account_id: null, batch_no: '', expiry: null, warehouse_id: null }));
  const acct = SC.acct[SC.pay] || (scPayAccounts(SC.pay)[0] || {}).id;
  const payments = post && SC.pay !== 'credit' && acct ? [{ account_id: acct, amount: C.total, mode: SC_METHOD[SC.pay], reference: SC.ref }] : [];
  return { id: null, doc_type: 'invoice', doc_date: today(), due_date: null, party_id: SC.party ? SC.party.id : null, branch_id: S.branches.length === 1 ? S.branches[0].id : null, warehouse_id: null, place_of_supply: null, reverse_charge: false, itc_eligible: true,
    price_includes_tax: !!SC.incl, supplier_ref: null, supplier_ref_date: null, ref_doc_id: null, source_doc_id: null, notes: '', terms: '', roundoff: null, lines, payments, post };
}
function scReset() { SC.cart = []; SC.recv = []; SC.ref = ''; SC.got = ''; SC.incl = null; SC.phone = ''; SC.name = ''; SC.pay = 'cash'; scPersist(); }
// A walk-in whose name was typed becomes a real customer (found by phone number if we already know it), so the bill carries the name,
// a credit sale has someone to owe it, and the same person is found next time.
async function scEnsureParty() {
  const nm = SC.name.trim(); if (!nm || (SC.party && !SC.party.is_walkin)) return;
  const ph = SC.phone.replace(/\D/g, '').slice(-10);
  let c = ph.length >= 8 ? (S.parties || []).find((x) => x.kind !== 'supplier' && String(x.phone || '').replace(/\D/g, '').slice(-10) === ph && x.active !== false) : null;
  if (!c) { const r = await api('acc_save_party', { p: { id: null, kind: 'customer', name: nm, phone: SC.phone.trim(), reg_type: 'unregistered' } }); bust('parties'); const list = await parties(true); c = list.find((x) => x.id === r.id); }
  if (c) SC.party = c;
}
async function scCharge(v, post) {
  if (!SC.cart.length) return toast('Scan or add an item first', { err: true });
  const C = scTotals();
  if (post && C.total <= 0) return toast('The total must be more than zero', { err: true });
  if (post && SC.pay === 'credit' && (!SC.party || SC.party.is_walkin) && !SC.name.trim()) return toast('Enter the customer’s name for a sale on credit', { err: true });
  if (post && SC.pay !== 'credit' && !(SC.acct[SC.pay] || scPayAccounts(SC.pay)[0])) return toast('No cash or bank account is set up. Add one in Accounting, Settings.', { err: true });
  if (!offlineNow()) { try { await scEnsureParty(); } catch (e) { if (!sqTransient(e)) return fail(e); } }   // no answer: the name travels with the sale and the books make the customer
  const payload = scPayload(post, C);
  if (post) return scSell(v, payload, C);
  if (offlineNow()) {
    try { await queueDraft(payload, C.total); scReset(); toast('Saved on this device. It will be sent to your books as a draft when you are back online.'); v.refresh(); } catch (e) { fail(e); }
    return;
  }
  const how = SC.pay === 'credit' ? 'the amount as owed by ' + ((SC.party && SC.party.name) || 'the customer') : 'the ' + ({ cash: 'cash', upi: 'UPI', bank: 'bank' }[SC.pay]) + ' payment';
  dockBusy(true);
  try {
    const r = await api('acc_save_document', { p: payload });
    bust('products', 'parties'); products(true).catch(() => {});
    if (r.pending_approval) { toast('Saved. It needs a manager’s approval before it can be posted.'); scReset(); v.refresh(); return; }
    scReset(); toast('Draft saved'); v.refresh();
  } catch (e) {
    if (!e.status) { try { await queueDraft(payload, C.total); scReset(); toast('Saved on this device as a draft.'); v.refresh(); return; } catch (e2) { /* fall through */ } }
    fail(e);
  } finally { dockBusy(false); }
}

// A real sale. Online it is posted at once (through acc_offline_apply, so a lost reply can never make a second bill); with no
// connection, or no answer within 10 s, the same operation is kept on the phone with a provisional number and sent later.
async function scSell(v, payload, C) {
  const off = offlineNow(), party = SC.party && !SC.party.is_walkin ? SC.party : null;
  const pname = party ? party.name : SC.name.trim(), pphone = party ? party.phone || '' : SC.phone.trim(), mode = SC.pay;
  const how = mode === 'credit' ? 'the amount as owed by ' + (pname || 'the customer') : 'the ' + ({ cash: 'cash', upi: 'UPI', bank: 'bank' }[mode]) + ' payment';
  const ok = off
    ? await confirmBox('Charge ' + inr(C.total) + '?', 'You are offline. The sale is kept on this phone and goes to your books, with its final GST invoice number, when the connection is back. Stock and ' + how + ' are counted then.', 'Charge')
    : await confirmBox('Charge ' + inr(C.total) + '?', 'This posts a GST invoice, reduces stock and records ' + how + '. You can cancel it later with a reversal but not edit it.', 'Charge');
  if (!ok) return;
  const receipt = { items: SC.cart.map((l) => ({ name: l.p.name, qty: l.qty, amt: Math.max(N(l.rate) * l.qty - (l.dtype === 'pct' ? N(l.rate) * l.qty * N(l.disc) / 100 : N(l.disc)), 0) })), total: C.total, mode, name: pname, phone: pphone };
  const sale = { ...payload, party_name: party ? '' : pname, party_phone: party ? '' : pphone }, op = sqNewOp();
  const queueIt = async () => {
    const ref = sqNextRef();
    await sqEnqueue('sale', { ...sale, offline: true, offline_ref: ref }, { ref, name: pname, total: C.total, phone: pphone }, op);
    sqRefreshLocal(); scReset(); v.refresh(); scDoneOffline(ref, receipt);
  };
  dockBusy(true);
  try {
    if (off) return await queueIt();
    let r;
    try { r = await sqWithin(api('acc_offline_apply', { p: { op, kind: 'sale', payload: sale } }), 10000); }
    catch (e) { if (sqTransient(e) || e.timeout) return await queueIt(); throw e; }
    bust('products', 'parties'); products(true).catch(() => {});
    if (r.pending_approval) { toast('Saved. It needs a manager’s approval before it can be posted.'); scReset(); v.refresh(); return; }
    let full = null;
    try { full = await api('acc_get_document', { p_id: r.id }); } catch (e) { /* the sale is posted; only the receipt could not be loaded */ }
    scReset(); v.refresh();
    if (full) scDone(full, C.total, mode, party ? party.phone || '' : SC.phone || pphone);
    else toast('Sale posted as ' + (r.number || 'an invoice') + '. Open Sales to see it.');
  } catch (e) { fail(e); } finally { dockBusy(false); }
}

// The receipt for a sale kept on the phone: a plain WhatsApp message with the items and a provisional number.
function scDoneOffline(ref, r) {
  const org = S.org.trade_name || S.org.legal_name || S.ctx.tenant.name;
  const ph = input({ type: 'tel', mode: 'tel', value: r.phone || '', placeholder: 'Customer’s WhatsApp number', label: 'WhatsApp number' });
  const text = () => `Hello${r.name ? ' ' + r.name : ''}, thank you for shopping with ${org}.\nBill ${ref} (the GST invoice number follows)\n` + r.items.map((i) => `${i.name} x ${qty(i.qty)}  ${inr(i.amt)}`).join('\n') + `\nTotal ${inr(r.total)} (${r.mode === 'credit' ? 'on credit' : 'paid by ' + ({ cash: 'cash', upi: 'UPI', bank: 'bank transfer' }[r.mode])})`;
  sheet({ title: 'Saved on this phone', closeLabel: 'New sale', body: h('div', { class: 'grid', style: { textAlign: 'center', justifyItems: 'center', gap: '10px' } },
    h('span', { class: 'tile green', style: { width: '56px', height: '56px', borderRadius: '28px' } }, icon('check', 30)),
    h('div', null, h('div', { class: 'mono' }, ref), h('div', { style: { fontSize: '30px', fontWeight: 700, letterSpacing: '-.5px' } }, inr(r.total)), h('div', { class: 'muted' }, r.mode === 'credit' ? 'On credit' : 'Received by ' + ({ cash: 'cash', upi: 'UPI', bank: 'bank transfer' }[r.mode]))),
    h('div', { class: 'banner info', style: { textAlign: 'left' } }, icon('info', 18), 'You are offline. This sale is safe on the phone and goes to your books automatically when the connection is back. The final GST invoice number is given then.'),
    h('div', { style: { width: '100%', textAlign: 'left' } }, field('WhatsApp number', ph, 'Leave empty to choose the contact inside WhatsApp.')),
    h('div', { class: 'grid', style: { width: '100%' } },
      h('button', { class: 'btn fill', type: 'button', onclick: () => window.open(waLink(ph.value, text()), '_blank') }, icon('chat', 18), 'Send on WhatsApp'),
      h('button', { class: 'btn', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(text()); toast('Receipt copied'); } catch (e) { fail(e); } } }, icon('link', 18), 'Copy receipt text'))) });
}

// What is waiting on this phone (sales, new products, stock received) and what the books refused.
function scPendingCard(v) {
  const items = sqItems(); if (!items.length) return null;
  const label = (it) => it.kind === 'sale' ? { t: (it.meta && it.meta.ref) || 'Sale', s: 'Sale' + (it.meta && it.meta.name ? ' to ' + it.meta.name : ''), v: it.meta && it.meta.total != null ? inr(it.meta.total) : '' }
    : it.kind === 'product' ? { t: 'New product: ' + ((it.meta && it.meta.temp && it.meta.temp.name) || ''), s: 'Product', v: '' } : { t: 'Stock received', s: (it.payload.lines || []).length + ' item(s)', v: '' };
  const waiting = items.filter((x) => x.state !== 'refused').length;
  return h('div', { class: 'card grid', style: { gap: '8px' } },
    h('div', { class: 'row sp' }, h('h3', null, 'On this phone, not yet in your books (' + items.length + ')'), waiting && !offlineNow() ? h('button', { class: 'btn sm', type: 'button', onclick: async () => {
      const r = await sqFlush();
      if (!r.sent && !r.refused && !sessionExpiredShown) toast(navigator.onLine === false ? 'You are offline -- it will send automatically once you are back online.' : 'Still could not reach your books. Check your connection and try again.');
      v.refresh();
    } }, 'Send now') : null),
    h('details', { open: items.some((x) => x.state === 'refused') }, h('summary', { class: 'small muted' }, 'Show what is waiting'), h('div', { class: 'list' }, items.map((it) => { const l = label(it); return liRow({ icon: it.state === 'refused' ? 'alert' : 'doc', tone: it.state === 'refused' ? 'red' : '', title: l.t, sub: (it.state === 'refused' ? 'Refused: ' + it.error : l.s + ' · saved ' + fmtDT(it.at) + ', waiting'), value: l.v,
      badge: it.state === 'refused' ? h('span', { class: 'row', style: { gap: '6px' } }, h('button', { class: 'btn sm', type: 'button', onclick: async (e) => { e.stopPropagation(); await sqRetry(it.op); v.refresh(); } }, 'Retry'),
        h('button', { class: 'btn sm danger', type: 'button', onclick: async (e) => { e.stopPropagation(); if (await confirmBox('Discard this?', 'It has not reached your books and cannot be brought back.', 'Discard', true)) { await sqDiscard(it.op); v.refresh(); } } }, 'Discard')) : null }); }))));
}
const dockBusy = (b) => document.querySelectorAll('.scan-dock .btn').forEach((x) => { x.disabled = b; });

// Offline sales that have now reached the books and have a real invoice link worth sending -- the customer only ever got
// the plain-text provisional receipt while this phone was offline (scDoneOffline), so this is the one place that WhatsApp
// link with the real, designed invoice actually goes out, once it exists.
async function scSyncedCard(onchange) {
  const all = await sqRecent(), items = all.filter((x) => x.id && x.phone && !x.sent);
  if (!items.length) return null;
  const org = S.org.trade_name || S.org.legal_name || S.ctx.tenant.name;
  return h('div', { class: 'card grid', style: { gap: '8px' } },
    h('h3', null, 'Ready to send: the real invoice link (' + items.length + ')'),
    h('p', { class: 'small muted' }, 'These sales were made offline and have now reached your books with a real GST invoice number -- the customer still only has the plain text receipt.'),
    h('div', { class: 'list' }, items.map((it) => liRow({ icon: 'chat', title: it.number || it.ref, sub: (it.name ? 'Sale to ' + it.name : 'Sale') + ' · ' + inr(it.total || 0),
      badge: h('button', { class: 'btn sm fill', type: 'button', onclick: async (e) => {
        e.stopPropagation();
        const w = window.open('', '_blank');   // opened inside the tap, pointed at WhatsApp once the link exists -- iPhone blocks a window opened after a wait
        try {
          const link = await shareLink({ id: it.id });
          const msg = `Hello${it.name ? ' ' + it.name : ''}, thank you for shopping with ${org}. Your invoice ${it.number} for ${inr(it.total || 0)} is here:\n${link}`;
          const url = waLink(it.phone, msg);
          if (w && !w.closed) w.location.href = url; else window.open(url, '_blank');
          await sqMarkSent(it.ref); onchange && onchange();
        } catch (e2) { try { if (w) w.close(); } catch (e3) { /* already closed */ } fail(e2); }
      } }, 'Send real invoice') }))));
}

// ---------- after the sale: WhatsApp, print, copy ----------
function scDone(full, total, mode, phone) {
  const d = full.doc, org = S.org.trade_name || S.org.legal_name || S.ctx.tenant.name;
  const ph = input({ type: 'tel', mode: 'tel', value: phone, placeholder: 'Customer’s WhatsApp number', label: 'WhatsApp number' });
  const msg = (link) => `Hello${d.party_name && !(full.party && full.party.is_walkin) ? ' ' + d.party_name : ''}, thank you for shopping with ${org}. Your invoice ${d.number} for ${inr(d.total)} is here:\n${link}`;
  const log = (channel, link, recipient) => api('acc_log_comm', { p: { channel, kind: 'invoice', party_id: d.party_id, doc_id: d.id, recipient, subject: 'Invoice ' + d.number, body: msg(link), status: 'logged' } }).catch(() => {});
  // The public link is made only when someone shares (never for every sale). The blank window is opened inside the tap, then pointed at
  // WhatsApp once the link exists: iPhone blocks a window opened after a wait.
  const openLater = async (make) => {
    const w = window.open('', '_blank');
    try { const url = await make(); if (w && !w.closed) w.location.href = url; else window.open(url, '_blank'); } catch (e) { try { if (w) w.close(); } catch (e2) { /* already closed */ } fail(e); }
  };
  const s = sheet({ title: 'Paid', closeLabel: 'New sale', body: h('div', { class: 'grid', style: { textAlign: 'center', justifyItems: 'center', gap: '10px' } },
    h('span', { class: 'tile green', style: { width: '56px', height: '56px', borderRadius: '28px' } }, icon('check', 30)),
    h('div', null, h('div', { class: 'mono' }, d.number), h('div', { style: { fontSize: '30px', fontWeight: 700, letterSpacing: '-.5px' } }, inr(total)), h('div', { class: 'muted' }, mode === 'credit' ? 'On credit' : 'Received by ' + (mode === 'upi' ? 'UPI' : mode === 'bank' ? 'bank transfer' : 'cash'))),
    h('div', { style: { width: '100%', textAlign: 'left' } }, field('WhatsApp number', ph, 'Leave empty to choose the contact inside WhatsApp.')),
    h('div', { class: 'grid', style: { width: '100%' } },
      h('button', { class: 'btn fill', type: 'button', onclick: () => openLater(async () => { const l = await shareLink(d); log('whatsapp', l, ph.value); return waLink(ph.value, msg(l)); }) }, icon('chat', 18), 'Send on WhatsApp'),
      h('div', { class: 'row', style: { gap: '10px' } },
        h('button', { class: 'btn grow', type: 'button', onclick: () => printDoc(full) }, icon('print', 18), 'Print or save PDF'),
        h('button', { class: 'btn grow', type: 'button', onclick: async () => { try { const l = await shareLink(d); await navigator.clipboard.writeText(l); toast('Link copied'); } catch (e) { fail(e); } } }, icon('link', 18), 'Copy link'))),
    h('a', { href: '#/doc/' + d.id, class: 'small', onclick: () => s.close() }, 'Open the invoice')) });
}

// ---------- receiving stock ----------
async function scReceive(v) {
  if (!SC.recv.length) return toast('Scan an item first', { err: true });
  const bad = SC.recv.find((l) => !(l.qty > 0)); if (bad) return toast(bad.p.name + ': quantity must be more than zero', { err: true });
  const off = offlineNow();
  if (!(await confirmBox('Add ' + SC.recv.length + (SC.recv.length === 1 ? ' item' : ' items') + ' to stock?', off ? 'You are offline. The stock is kept on this phone and goes to your books when the connection is back.' : 'This changes stock and the inventory ledger. It cannot be edited afterwards.', 'Add to stock'))) return;
  dockBusy(true);
  const wh = S.warehouses.find((w) => w.is_default) || S.warehouses[0], op = sqNewOp();
  const payload = { mode: 'delta', warehouse_id: wh && wh.id, date: today(), reason: 'Stock received (scanned)', opening: false, lines: SC.recv.map((l) => ({ product_id: l.p.id, qty: l.qty, unit_cost: l.cost || null })) };
  const queueIt = async () => { await sqEnqueue('stock', payload, {}, op); sqRefreshLocal(); scReset(); toast('Saved on this phone. The stock goes to your books when you are back online.'); v.refresh(); };
  try {
    if (off) return await queueIt();
    let r;
    try { r = await sqWithin(api('acc_offline_apply', { p: { op, kind: 'stock', payload } }), 10000); }
    catch (e) { if (sqTransient(e) || e.timeout) return await queueIt(); throw e; }
    bust('products'); products(true).catch(() => {});
    scReset(); toast('Added ' + r.lines + ' item(s) to stock, value ' + inr(r.value)); v.refresh();
  } catch (e) { fail(e); } finally { dockBusy(false); }
}

// ---------- the page ----------
page('scan', {
  title: 'Scan to bill', tabLabel: 'Scan', icon: 'scan', perm: 'acc_view',
  async render(v) {
    v.header({ title: 'Scan to bill' });
    const canSell = can('acc_sales'), canAdd = can('acc_inventory');
    if (!canSell && !canAdd) { v.root.append(empty('lock', 'No access', 'Your role cannot sell or add stock. Ask the owner to change your role.')); return; }
    if (!SQ.loaded) await sqLoad();
    await Promise.all([products(), parties()]);
    if (SC.mode === 'sell' && !canSell) SC.mode = 'add';
    if (SC.mode === 'add' && !canAdd) SC.mode = 'sell';
    scRestore();
    if (!SC.party || !(S.parties || []).some((p) => p.id === SC.party.id)) SC.party = (S.parties || []).find((p) => p.is_walkin) || null;
    const sell = SC.mode === 'sell';

    const hits = h('div', { class: 'list' }), box = searchField('Type a name or barcode', (q) => find(q));
    const newFromBill = async (nm) => { const r = await scNewProduct('', { add: !sell, name: nm || '' }); if (r) { const res = !sell ? scBad(scRecvAdd(r.p, r.qty > 0 ? r.qty : 1)) : scAdd(r.p); toast(res.text, { err: res.bad }); box.input.value = ''; clear(hits); v.refresh(); } };
    const searchRow = h('div', { class: 'grid', style: { gap: '8px' } }, box, hits, can('acc_inventory') ? h('button', { class: 'btn', type: 'button', onclick: () => newFromBill(box.input.value.trim()) }, icon('plus', 18), 'New product') : null);
    const addFromText = async (q) => {
      q = q.trim(); if (!q) return;
      auzScanner.beep(true);                                  // a typed or Bluetooth-scanned code beeps the moment it arrives
      const m = await scLookup(q);
      if (m.length === 1) { const r = scAdd(m[0]); toast(r.text, { err: r.bad }); box.input.value = ''; find(''); v.refresh(); return; }
      if (m.length > 1) { const p = await scChoose(m, q); if (p) { const r = scAdd(p); toast(r.text, { err: r.bad }); box.input.value = ''; v.refresh(); } return; }
      const list = textMatches(q);
      if (list.length === 1) { const r = scAdd(list[0]); toast(r.text, { err: r.bad }); box.input.value = ''; find(''); v.refresh(); return; }
      if (/^[A-Za-z0-9\-_.\/]{5,}$/.test(q) && !list.length) { const r = await scNewProduct(q, { add: !sell }); if (r) { const res = !sell ? scBad(scRecvAdd(r.p, r.qty > 0 ? r.qty : 1)) : scAdd(r.p); toast(res.text, { err: res.bad }); box.input.value = ''; v.refresh(); } return; }
      if (!list.length) { auzScanner.beep(false); toast('No product matches “' + q + '”', { err: true }); }
    };
    const textMatches = (q) => { const t = q.toLowerCase(); return (S.products || []).filter((p) => p.active && (p.name.toLowerCase().includes(t) || p.sku.toLowerCase().includes(t) || String(p.barcode || '') === q)).slice(0, 8); };
    const find = (q) => {
      clear(hits); q = (q || '').trim(); if (q.length < 2) return;
      if (can('acc_inventory')) hits.append(liRow({ title: 'New product: ' + q, sub: 'Not in your list? Create it and add it to this bill', icon: 'plus', onclick: () => newFromBill(q) }));
      textMatches(q).forEach((p) => hits.append(liRow({ title: p.name, sub: [p.sku, p.is_service || !p.track_stock ? 'Service' : qty(p.stock) + ' ' + p.unit + ' in stock'].join(' · '), value: inr(sell ? p.sale_price : p.purchase_price), onclick: () => { const r = scAdd(p); toast(r.text, { err: r.bad }); box.input.value = ''; clear(hits); v.refresh(); } })));
    };
    box.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addFromText(box.input.value); } });     // a Bluetooth/USB scanner types the code and presses Enter

    const modes = canSell && canAdd ? seg([['sell', 'Sell'], ['add', 'Add stock']], SC.mode, (m) => { SC.mode = m; v.refresh(); }, { full: true, label: 'What are you scanning for' }) : null;
    const hero = h('button', { class: 'btn fill scan-hero', type: 'button', onclick: () => scStart(v) }, icon('scan', 28), h('span', null, sell ? 'Scan to sell' : 'Scan to add stock'));

    // ----- the lines -----
    const lines = h('div', { class: 'list' });
    const rows = sell ? SC.cart : SC.recv;
    rows.forEach((l) => {
      const stepper = h('div', { class: 'scan-step' },
        h('button', { class: 'btn icon', type: 'button', 'aria-label': 'One less of ' + l.p.name, onclick: () => { if (l.qty <= 1) { rows.splice(rows.indexOf(l), 1); } else l.qty -= 1; scPersist(); v.refresh(); } }, icon('minus', 18)),
        h('button', { class: 'scan-q', type: 'button', 'aria-label': 'Edit ' + l.p.name, onclick: () => scLineSheet(l, () => v.refresh()) }, qty(l.qty)),
        h('button', { class: 'btn icon', type: 'button', 'aria-label': 'One more of ' + l.p.name, onclick: () => { const r = scAdd(l.p); if (r.bad) toast(r.text, { err: true }); v.refresh(); } }, icon('plus', 18)));
      const line = sell ? Math.max(N(l.rate) * l.qty - (l.dtype === 'pct' ? N(l.rate) * l.qty * N(l.disc) / 100 : N(l.disc)), 0) : N(l.cost) * l.qty;
      lines.append(h('div', { class: 'li scan-line' }, h('div', { class: 'grow', onclick: () => scLineSheet(l, () => v.refresh()), style: { cursor: 'pointer' } }, h('div', { class: 't' }, l.p.name),
        h('div', { class: 's' }, sell ? inr(l.rate) + ' each' + (Number(l.p.mrp) > 0 ? ' · MRP ' + inr(l.p.mrp) : '') + ' · GST ' + scRate(l) + '%' + (N(l.disc) > 0 ? ' · ' + (l.dtype === 'pct' ? l.disc + '% off' : inr(l.disc) + ' off') : '') : (N(l.cost) > 0 ? 'Cost ' + inr(l.cost) + ' each' : 'Cost not entered'))),
        stepper, h('div', { class: 'v scan-amt' }, h('div', { class: 't' }, inr(line)))));
    });
    const listCard = rows.length ? lines : empty('scan', 'Nothing scanned yet', 'Tap the button above and point the camera at a barcode. You can also type a name or code, or use a Bluetooth scanner.');

    // ----- totals, customer, payment (sell) -----
    let side;
    if (sell) {
      const C = scTotals();
      const trow = (a, b, bold) => h('div', { class: 'row sp', style: bold ? { fontSize: '19px', fontWeight: 700 } : null }, h('span', { class: bold ? '' : 'muted' }, a), h('span', { class: 'num' }, b));
      const tax = C.supply === 'inter' ? [trow('IGST', inr(C.igst))] : [trow('CGST', inr(C.cgst)), trow('SGST', inr(C.sgst))];
      const totals = h('div', { class: 'card grid', style: { gap: '8px' } }, trow('Items', inr(C.subtotal)), C.discount ? trow('Discount', '−' + inr(C.discount)) : null, trow('Taxable value', inr(C.taxable)), C.cess ? trow('Cess', inr(C.cess)) : null, C.taxable && !C.zero ? tax : null, C.roundoff ? trow('Round off', (C.roundoff > 0 ? '+' : '−') + inr(Math.abs(C.roundoff))) : null,
        h('div', { style: { borderTop: '1px solid var(--sep, #ddd)' } }), trow('Total', inr(C.total), true), toggleRow('Prices include GST', !!SC.incl, (x) => { SC.incl = x; scPersist(); v.refresh(); }, S.org.reg_type === 'regular' ? 'Turn on when the price you scan already has the tax in it.' : 'Your registration type charges no GST.'),
        Object.keys(C.byRate).length && !C.zero ? h('details', null, h('summary', { class: 'small muted' }, 'GST by rate'), h('table', { class: 'small', style: { width: '100%', marginTop: '6px' } }, h('tbody', null, Object.entries(C.byRate).map(([r, x]) => h('tr', null, h('td', null, r + '%'), h('td', { class: 'r num' }, inr(x.taxable)), h('td', { class: 'r num' }, inr(x.tax))))))) : null);
      const cust = h('button', { class: 'li card', type: 'button', style: { textAlign: 'left' }, onclick: async () => { const p = await pickParty('customer', SC.party && SC.party.id); if (p) { SC.party = p; if (SC.pay === 'credit' && p.is_walkin) SC.pay = 'cash'; v.refresh(); } } },
        h('span', { class: 'tile gray' }, icon('user', 18)), h('div', { class: 'grow' }, h('div', { class: 't' }, SC.party && !SC.party.is_walkin ? SC.party.name : 'Walk-in customer'), h('div', { class: 's' }, SC.party && !SC.party.is_walkin ? [SC.party.phone, SC.party.gstin].filter(Boolean).join(' · ') || 'Tap to change' : 'Tap to choose an existing customer')), h('span', { class: 'chev' }, icon('chevR', 18)));
      const accts = SC.pay === 'credit' ? [] : scPayAccounts(SC.pay);
      if (accts.length && !SC.acct[SC.pay]) SC.acct[SC.pay] = accts[0].id;
      const got = input({ mode: 'decimal', value: SC.got, placeholder: 'Amount handed over', label: 'Cash received', oninput: (e) => { SC.got = e.target.value; const g = N(SC.got); chg.textContent = g > 0 ? (g >= C.total ? 'Change to give: ' + inr(r2(g - C.total)) : 'Short by ' + inr(r2(C.total - g))) : ''; } });
      const chg = h('div', { class: 'small', style: { fontWeight: 600, minHeight: '18px' } }, N(SC.got) > 0 ? (N(SC.got) >= C.total ? 'Change to give: ' + inr(r2(N(SC.got) - C.total)) : 'Short by ' + inr(r2(C.total - N(SC.got)))) : '');
      const pay = h('div', { class: 'card grid', style: { gap: '10px' } }, h('h3', null, 'Payment'),
        seg([['cash', 'Cash'], ['upi', 'UPI'], ['bank', 'Bank'], ['credit', 'Credit']], SC.pay, (m) => { SC.pay = m; v.refresh(); }, { full: true, label: 'Payment method' }),
        SC.pay === 'cash' ? h('div', { class: 'grid', style: { gap: '6px' } }, field('Cash received (optional)', got), chg) : null,
        SC.pay === 'upi' || SC.pay === 'bank' ? input({ value: SC.ref, placeholder: 'Reference or UTR (optional)', label: 'Reference', oninput: (e) => { SC.ref = e.target.value; } }) : null,
        accts.length > 1 ? field('Received in', selectEl(accts.map((a) => [a.id, a.name]), SC.acct[SC.pay], { onchange: (e) => { SC.acct[SC.pay] = e.target.value; } })) : null,
        SC.pay === 'credit' ? h('p', { class: 'small muted' }, SC.party && !SC.party.is_walkin ? inr(C.total) + ' will be added to what ' + SC.party.name + ' owes you.' : 'Enter the customer’s name below, or choose a customer above. A sale on credit needs a name.') : null,
        !SC.party || SC.party.is_walkin ? h('div', { class: 'grid', style: { gap: '10px' } }, field('Customer name', input({ value: SC.name, placeholder: 'Customer’s name', label: 'Customer name', oninput: (e) => { SC.name = e.target.value; } }), 'Optional for cash sales. Saved as a customer so you find them next time.'), field('WhatsApp number', input({ type: 'tel', mode: 'tel', value: SC.phone, placeholder: 'Customer’s WhatsApp number (optional)', label: 'WhatsApp number', oninput: (e) => { SC.phone = e.target.value; } }))) : null);
      side = [cust, totals, pay];
    } else {
      const val = SC.recv.reduce((s, l) => s + N(l.cost) * l.qty, 0);
      side = [h('div', { class: 'card grid', style: { gap: '8px' } }, h('div', { class: 'row sp' }, h('span', { class: 'muted' }, 'Items'), h('span', { class: 'num' }, String(SC.recv.length))), h('div', { class: 'row sp' }, h('span', { class: 'muted' }, 'Units'), h('span', { class: 'num' }, qty(scCount()))), h('div', { style: { borderTop: '1px solid var(--sep, #ddd)' } }),
        h('div', { class: 'row sp', style: { fontSize: '19px', fontWeight: 700 } }, h('span', null, 'Stock value'), h('span', { class: 'num' }, inr(val))), h('p', { class: 'small muted' }, 'Costs you leave empty use each product’s average cost. Stock goes into your main warehouse.'))];
    }

    const C2 = sell ? scTotals() : null;
    const dock = h('div', { class: 'dock scan-dock' }, sell
      ? [h('button', { class: 'btn', type: 'button', disabled: !SC.cart.length, onclick: () => scCharge(v, false) }, offlineNow() ? 'Save on this device' : 'Save draft'), h('button', { class: 'btn fill', type: 'button', disabled: !SC.cart.length, onclick: () => scCharge(v, true) }, SC.cart.length ? 'Charge ' + inr(C2.total) : 'Charge')]
      : [h('button', { class: 'btn fill', type: 'button', disabled: !SC.recv.length, onclick: () => scReceive(v) }, SC.recv.length ? 'Add ' + SC.recv.length + (SC.recv.length === 1 ? ' item' : ' items') + ' to stock' : 'Add to stock')]);
    const clearBtn = rows.length ? h('button', { class: 'btn plain sm', type: 'button', onclick: async () => { if (await confirmBox('Clear everything?', 'The scanned items will be removed. Nothing has been posted.', 'Clear', true)) { scReset(); v.refresh(); } } }, 'Clear all') : null;

    const pend = h('div', { id: 'scpend' }, scPendingCard(v) || '');
    window._scPend = () => { const el = document.getElementById('scpend'); if (el && route && route.id === 'scan') { clear(el); const c = scPendingCard(v); if (c) el.append(c); } };
    const synced = h('div', { id: 'scsynced' });
    window._scSynced = () => { const el = document.getElementById('scsynced'); if (el && route && route.id === 'scan') scSyncedCard(window._scSynced).then((c) => { if (document.getElementById('scsynced')) { clear(el); if (c) el.append(c); } }); };
    window._scSynced();
    if (!window._scQ) { window._scQ = true; window.addEventListener('scan:queue', () => { window._scPend && window._scPend(); window._scSynced && window._scSynced(); }); }
    v.root.append(pend, synced, modes || '', h('div', { class: 'scan-cols' }, h('div', { class: 'grid' }, hero, searchRow, h('div', { class: 'row sp' }, h('h3', null, sell ? 'Bill' : 'To add'), clearBtn), listCard), h('div', { class: 'grid scan-side' }, side)), dock);
    if (isDesk() && !('ontouchstart' in window)) box.input.focus();
  },
});
