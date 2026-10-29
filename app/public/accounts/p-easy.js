/* Beginner-friendly layer for AUZsScan (loaded by scan.html only; AUZsLedger is untouched): a short "simple view" menu, a first-run checklist and tour, a one-screen quick bill, a guided "+" menu,
   plain words and "?" explanations, and plainer error messages. Nothing here removes a feature: the full menu is one switch away, every page
   still opens from search and links, and the existing invoice editor is behind "More options". */
'use strict';

// ---------- simple view (per device, per business). New businesses (under 30 days old) start in it; older ones keep the full menu. ----------
const EASY_NAV = [
  { group: '', items: ['scan', 'quick', 'home'] },
  { group: 'Records', items: ['sales', 'customers', 'receipts', 'products', 'stock', 'labels'] },
  { group: 'Buying and books', items: ['purchases', 'suppliers', 'payments', 'expenses', 'reports', 'gst'] },
  { group: 'Settings', items: ['bulk', 'data', 'invoicelayout', 'alerts'] },
];
const EASY_TABS = ['scan', 'quick', 'sales', 'home'];
// "all ledger tools": the whole AUZsLedger menu plus Quick bill and the invoice layout page
const SCAN_ALL_NAV = NAV_LEDGER.map((g) => (g.group === 'Sales' ? { ...g, items: ['quick', ...g.items] } : g.group === 'Tools' ? { ...g, items: [...g.items, 'invoicelayout'] } : g));
const easyKey = (k) => 'acc.' + k + '.' + ((S.ctx && S.ctx.tenant && S.ctx.tenant.slug) || '');
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } };
function easyMode() {
  if (!SCANAPP || !S.org) return 'full';
  const v = lsGet(easyKey('mode')); return v === 'full' ? 'full' : 'simple';     // AUZsScan starts everyone in the short view
}
function easyOn() { return easyMode() === 'simple'; }
function setEasy(m) { lsSet(easyKey('mode'), m); applyWords(); buildShell(); route_(); }
function easyToggleRow() { return null; }   // no switch: AUZsScan always shows the short menu

// ---------- plain words (simple view only) ----------
const ORIG_WORDS = {};
const EASY_WORDS = { receipts: ['Money received', 'Money received'], payments: ['Money paid', 'Money paid'], sales: ['Invoices', 'Bills'], customers: ['Customers', 'Customers'], home: ['Overview', 'Overview'] };
function applyWords() {
  const on = easyOn();
  Object.entries(EASY_WORDS).forEach(([id, [t, tab]]) => {
    const p = PAGES[id]; if (!p) return;
    if (!ORIG_WORDS[id]) ORIG_WORDS[id] = { title: p.title, tabLabel: p.tabLabel };
    p.title = on ? t : ORIG_WORDS[id].title; p.tabLabel = on ? tab : ORIG_WORDS[id].tabLabel;
  });
}
const wd = (full, easy) => (easyOn() ? easy : full);

// ---------- "?" explanations ----------
const GLOSS = {
  hsn: ['HSN / SAC code', 'A number that says what you sell: HSN for goods, SAC for services. Your accountant or the GST rate chart gives it. It is needed on bills where GST is charged.'],
  pos: ['Place of supply', 'The state where the goods or service goes. Same state as yours: the tax is split into CGST and SGST. Another state: it is IGST.'],
  rcm: ['Reverse charge', 'In a few cases the buyer, not the seller, pays the GST to the government. Tick this only when your accountant says so for that purchase.'],
  itc: ['Input tax credit (ITC)', 'The GST you paid on purchases can be deducted from the GST you collect on sales. Untick if the tax cannot be claimed (for example personal use).'],
  inclusive: ['Price includes GST', 'Tick if the price you type already contains GST. The app then works backwards to find the price before tax.'],
  gstin: ['GSTIN', 'The 15-character GST number of a business. Leave it empty for customers who are not registered (most walk-in buyers).'],
  ageing: ['Who owes how long', 'Shows unpaid bills grouped by how old they are, so you know whom to remind first.'],
};
function lbl(text, key) { const t = tip(key); return t ? h('span', null, text, t) : text; }
function tip(key) {
  const g = GLOSS[key]; if (!g) return null;
  return h('button', { type: 'button', class: 'tip', 'aria-label': 'What is ' + g[0] + '?', title: g[0], onclick: (e) => { e.preventDefault(); e.stopPropagation(); alertBox({ title: g[0], message: g[1], cancel: false, actions: [{ label: 'Got it', value: true, primary: true }] }); } }, '?');
}

// ---------- plainer error messages ----------
const FRIENDLY = [
  [/Books are locked up to ([0-9-]+)/i, (m) => 'That date is locked (up to ' + m[1] + '). Use a later date, or ask the owner to unlock it in Settings.'],
  [/GST return period (.+?) is marked filed/i, (m) => m[1] + ' is already marked as filed, so bills for that month cannot be changed. Use a date in an open month.'],
  [/Credit limit exceeded for (.+?):/i, (m) => m[1] + ' is over the credit limit. Take a payment first, or raise the limit on the customer.'],
  [/Insufficient stock/i, () => 'There is not enough stock of an item. Add stock first, or lower the quantity.'],
  [/GST rate ([0-9.]+) is not configured/i, (m) => 'GST rate ' + m[1] + '% is not in your list. Pick one of the listed rates or add it in Settings.'],
  [/Your role does not allow/i, () => 'Your login cannot do this. Ask the owner to change your role.'],
  [/No financial year covers/i, () => 'There is no financial year for that date. Add it in Settings.'],
  [/Accounting is not set up yet/i, () => 'Set up your business details first (Settings).'],
];
const friendly = (msg) => { const s = String(msg || ''); for (const [re, f] of FRIENDLY) { const m = s.match(re); if (m) return f(m); } return s; };
// ---------- the "+" menu, in six plain choices ----------
const _quickMenu = quickMenu;
quickMenu = function (anchor) {
  if (!easyOn()) return _quickMenu(anchor);
  const it = [];
  if (can('acc_sales')) it.push({ label: 'Bill a customer', icon: 'bolt', run: () => go('quick') }, { label: 'Record money received', icon: 'wallet', run: () => receiptSheet('receipt') }, { label: 'Add a customer', icon: 'user', run: () => partySheet('customer') });
  if (can('acc_purchase')) it.push({ label: 'Record a purchase', icon: 'receipt', run: () => go('new/bill') }, { label: 'Record an expense', icon: 'cash', run: () => go('new/expense') }, { label: 'Pay a supplier', icon: 'wallet', run: () => receiptSheet('payment') });
  menu(anchor, it);
};

// ---------- quick bill: customer, items, money received, issue ----------
page('quick', {
  title: 'Quick bill', tabLabel: 'Bill', icon: 'bolt', perm: 'acc_sales',
  async render(v) {
    v.header({ title: 'Quick bill', sub: 'Pick a customer, add what you sold, press Issue.', actions: [{ label: 'More options', icon: 'edit', run: () => go('new/invoice') }] });
    const [plist, prods] = await Promise.all([parties(), products()]);
    const reg = S.org.reg_type === 'regular';
    const rates = (S.taxcodes || []).filter((t) => t.active && t.kind === 'taxable').map((t) => Number(t.rate)).sort((a, b) => a - b);
    const rateOpts = [0, ...rates.filter((x) => x > 0)].map((x) => [String(x), x + '%']);
    const D = { doc_type: 'invoice', party_id: '', lines: [], charges: [], price_includes_tax: false, roundoff: '' };
    let rows = [{ name: '', qty: '1', rate: '', rateTouched: false, gst: reg ? '18' : '0' }];
    let recvAcct = (payAccounts().find((a) => a.is_cash) || payAccounts()[0] || {}).id || '', recv = '', recvTouched = false;
    const custSel = selectEl([], '');
    const fillCust = (sel) => {
      custSel.replaceChildren(...[['', 'Walk-in customer (no name)']].concat((S.parties || []).filter((p) => p.active && !p.is_walkin && p.kind !== 'supplier').map((p) => [p.id, p.name]), [['__new', '+ New customer']]).map(([val, l]) => h('option', { value: val }, l)));
      custSel.value = sel || '';
    };
    fillCust('');
    custSel.onchange = () => {
      if (custSel.value === '__new') { custSel.value = D.party_id; partySheet('customer', null, (p) => { fillCust(p && p.id); D.party_id = (p && p.id) || ''; refresh(); }); return; }
      D.party_id = custSel.value; refresh();
    };
    const dl = h('datalist', { id: 'quick-items' }, (prods || []).filter((p) => p.active !== false).slice(0, 3000).map((p) => h('option', { value: p.name })));
    const prodOf = (name) => (prods || []).find((p) => p.name.toLowerCase() === String(name).trim().toLowerCase());
    const rowsEl = h('div', { class: 'grid', style: { gap: '10px' } });
    const sumEl = h('div', { class: 'card grid', style: { gap: '6px' } });
    const checkEl = h('div', { class: 'grid', style: { gap: '6px' } });
    const recvEl = h('div', { class: 'card grid', style: { gap: '10px' } });
    const issueBtn = h('button', { class: 'btn fill wide', type: 'button' }, 'Issue bill'), draftBtn = h('button', { class: 'btn wide', type: 'button' }, 'Save as draft');
    const incl = checkbox('The price I type already includes GST', false, (x) => { D.price_includes_tax = x; refresh(); });
    const lines = () => rows.filter((r) => r.name.trim() || N(r.rate)).map((r) => { const p = prodOf(r.name); return { product_id: p ? p.id : '', description: r.name.trim() || 'Item', qty: N(r.qty) || 0, rate: N(r.rate), tax_rate: p ? Number(p.tax_rate || 0) : N(r.gst), hsn: p ? p.hsn : '', _p: p }; });
    function calc() { D.lines = lines(); D.party_id = custSel.value === '__new' ? '' : custSel.value; return calcDoc(D); }
    function paintRows() {
      rowsEl.replaceChildren(...rows.map((r, i) => {
        const nm = input({ value: r.name, placeholder: 'Type or pick an item', label: 'Item' }); nm.setAttribute('list', 'quick-items');
        const qt = input({ value: r.qty, mode: 'decimal', label: 'Quantity' }), rt = input({ value: r.rate, mode: 'decimal', placeholder: '0', label: 'Price' });
        const gs = selectEl(rateOpts, r.gst, { label: 'GST', onchange: () => { r.gst = gs.value; refresh(); } });
        const gw = h('div', { style: { display: r.name && !prodOf(r.name) ? '' : 'none' } }, field('GST', gs));
        nm.oninput = () => { r.name = nm.value; const p = prodOf(r.name); if (p && !r.rateTouched) { r.rate = String(Number(p.sale_price || 0) || ''); rt.value = r.rate; } gw.style.display = r.name && !p ? '' : 'none'; refresh(); };
        qt.oninput = () => { r.qty = qt.value; refresh(); }; rt.oninput = () => { r.rate = rt.value; r.rateTouched = true; refresh(); };
        const del = rows.length > 1 ? h('button', { class: 'btn plain icon', type: 'button', 'aria-label': 'Remove item', onclick: () => { rows.splice(i, 1); paintRows(); refresh(); } }, icon('x', 18)) : null;
        return h('div', { class: 'card grid', style: { gap: '8px' } }, field('Item', nm), h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' } }, field('Quantity', qt), field('Price', rt)), gw, del ? h('div', { class: 'row', style: { justifyContent: 'flex-end' } }, del) : null);
      }));
    }
    function refresh(skipRecv) {
      const c = calc(), ls = D.lines, total = c.total;
      const gst = r2(c.cgst + c.sgst + c.igst + c.cess);
      sumEl.replaceChildren(...[h('div', { class: 'row sp' }, h('span', { class: 'muted' }, 'Amount before GST'), money(c.taxable)),
        h('div', { class: 'row sp' }, h('span', { class: 'muted' }, c.zero ? 'GST (not charged by your business type)' : 'GST ' + (c.supply === 'inter' ? '(IGST, other state)' : '(CGST + SGST)')), money(gst)),
        c.roundoff ? h('div', { class: 'row sp' }, h('span', { class: 'muted' }, 'Round off'), money(c.roundoff, { signed: true })) : null,
        h('div', { class: 'row sp', style: { fontWeight: 700, fontSize: '18px' } }, h('span', null, 'Total'), money(total))].filter(Boolean));
      if (!recvTouched) recv = total ? String(total) : '';
      const due = Math.max(r2(total - N(recv)), 0);
      if (!skipRecv) recvEl.replaceChildren(h('h3', null, 'Money received now'),
        h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' } },
          field('Amount', Object.assign(input({ value: recv, mode: 'decimal', label: 'Amount received' }), { oninput: (e) => { recv = e.target.value; recvTouched = true; refresh2(); } })),
          field('Received in', selectEl(payAccounts().map((a) => [a.id, a.name]), recvAcct, { label: 'Received in', onchange: (e) => { recvAcct = e.target.value; } }))),
        h('div', { class: 'muted small' }, due > 0 ? 'Balance to collect later: ' + inr(due) + (D.party_id ? '' : '. Choose a customer to keep a balance.') : 'Paid in full.'));
      const bad = [], warn = [], good = [];
      if (!S.org.state_code) bad.push('Add your state in Settings so GST is split correctly.');
      if (!ls.length || !total) bad.push('Add at least one item with a price.');
      if (ls.some((l) => !(l.qty > 0))) bad.push('Every item needs a quantity.');
      if (due > 0 && !D.party_id) bad.push('A balance can only be kept for a named customer. Choose one or take the full amount.');
      if (reg && !S.org.gstin) warn.push('Your GSTIN is not set (Settings). Bills will not show it.');
      const cu = (S.parties || []).find((p) => p.id === D.party_id);
      if (cu && cu.reg_type === 'regular' && !cu.gstin) warn.push(cu.name + ' is registered for GST but has no GSTIN saved.');
      if (!c.zero && ls.some((l) => l.tax_rate > 0 && !l.hsn && !l._p)) warn.push('Items you typed by hand have no HSN/SAC. Use More options to add it, or save the item under Products.');
      if (!bad.length && ls.length) good.push('Looks good: GST, totals and customer checked.');
      checkEl.replaceChildren(...bad.map((x) => h('div', { class: 'banner', style: { color: 'var(--red)' } }, icon('alert', 18), h('div', null, x))), ...warn.map((x) => h('div', { class: 'banner info' }, icon('info', 18), h('div', null, x))), ...good.map((x) => h('div', { class: 'banner' }, icon('check', 18), h('div', null, x))));
      issueBtn.disabled = draftBtn.disabled = bad.length > 0; draftBtn.disabled = !ls.length || !total;
      refresh.c = c;
    }
    function refresh2() { const c = refresh.c || calc(); const due = Math.max(r2(c.total - N(recv)), 0); const m = recvEl.querySelector('.muted.small'); if (m) m.textContent = due > 0 ? 'Balance to collect later: ' + inr(due) + (D.party_id ? '' : '. Choose a customer to keep a balance.') : 'Paid in full.'; refresh(true); }
    const payload = (post) => {
      const c = calc(); const pay = Math.min(N(recv), c.total);
      const acc = payAccounts().find((a) => a.id === recvAcct);
      return { doc_type: 'invoice', party_id: D.party_id || '', doc_date: today(), price_includes_tax: D.price_includes_tax, post,
        lines: D.lines.map((l) => ({ product_id: l.product_id || '', description: l.description, qty: l.qty, rate: l.rate, tax_rate: l.tax_rate })),
        payments: post && pay > 0 && acc ? [{ account_id: acc.id, amount: pay, mode: acc.is_cash ? 'Cash' : 'Bank' }] : [] };
    };
    const go_ = async (post) => {
      if (!navigator.onLine) return toast('Quick bill needs internet. Use Scan to bill for offline sales.', { err: true });
      const c = calc();
      if (post && !(await confirmBox('Issue this bill for ' + inr(c.total) + '?', 'After this the bill cannot be changed. If something is wrong, you can cancel it and make a new one.', 'Issue bill'))) return;
      issueBtn.disabled = draftBtn.disabled = true;
      try {
        const r = await api('acc_save_document', { p: payload(post) });
        bust('products', 'parties');
        if (!post) { toast('Saved as draft'); go('sales?status=draft'); return; }
        const s = sheet({ title: 'Bill issued', closeLabel: 'Close', body: h('div', { class: 'grid', style: { textAlign: 'center', gap: '10px' } }, h('div', { style: { fontSize: '30px' } }, icon('check', 40)), h('h3', null, r.number), h('div', { class: 'muted' }, inr(c.total) + (N(recv) >= c.total ? ' · paid' : ' · balance ' + inr(c.total - N(recv)))),
          h('div', { class: 'row', style: { justifyContent: 'center', gap: '8px' } }, h('button', { class: 'btn fill', type: 'button', onclick: () => { s.close(); go('doc/' + r.id); } }, 'View and share'), h('button', { class: 'btn', type: 'button', onclick: () => { s.close(); v.refresh(); } }, 'New bill'))) });
      } catch (e) { fail(e); refresh(); }
    };
    issueBtn.onclick = () => go_(true); draftBtn.onclick = () => go_(false);
    paintRows(); refresh();
    v.root.append(h('div', { class: 'grid', style: { gap: '14px', maxWidth: '720px' } }, dl,
      h('div', { class: 'card grid', style: { gap: '10px' } }, field('Customer', custSel)),
      h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'What did you sell?')), rowsEl,
        h('button', { class: 'btn', type: 'button', style: { marginTop: '8px' }, onclick: () => { rows.push({ name: '', qty: '1', rate: '', rateTouched: false, gst: reg ? '18' : '0' }); paintRows(); refresh(); } }, icon('plus', 18), 'Add another item')),
      h('div', { class: 'row', style: { gap: '6px', alignItems: 'center' } }, incl, tip('inclusive')), sumEl, recvEl, checkEl,
      h('div', { class: 'grid', style: { gap: '8px' } }, issueBtn, draftBtn, h('button', { class: 'btn plain wide', type: 'button', onclick: () => go('new/invoice') }, 'More options (discount, shipping address, due date...)'))));
  },
});

// ---------- first-run checklist and tour (shown on Home) ----------
async function easyChecklist(d, redraw) {
  if (lsGet(easyKey('check.hide')) === '1' || !can('acc_sales')) return null;
  let cust = false, prod = false;
  try { cust = (await parties()).some((p) => !p.is_walkin && p.kind !== 'supplier'); prod = ((await products()) || []).length > 0; } catch (e) { /* offline: skip */ }
  const billed = Number(d.fy && d.fy.sales) > 0 || Number(d.sales_today) > 0;
  const steps = [
    { done: !!(S.org.legal_name && S.org.state_code), t: 'Add your business details', s: 'Name, state and GSTIN', run: () => go('settings') },
    { done: cust, t: 'Add your first customer', s: 'Or skip: you can bill walk-in customers', run: () => partySheet('customer', null, () => { bust('parties'); redraw(); }) },
    { done: prod, t: 'Add something you sell', s: 'Optional: you can also type items while billing', run: () => productSheet(null, () => { bust('products'); redraw(); }) },
    { done: billed, t: 'Make your first bill', s: 'Takes about a minute', run: () => go('quick') },
  ];
  const n = steps.filter((x) => x.done).length;
  if (n === steps.length) { lsSet(easyKey('check.hide'), '1'); return null; }
  return h('div', { class: 'card grid', style: { gap: '10px', gridColumn: '1 / -1' } },
    h('div', { class: 'row sp' }, h('h3', null, 'Get started: ' + n + ' of ' + steps.length), h('button', { class: 'btn plain small', type: 'button', onclick: () => { lsSet(easyKey('check.hide'), '1'); redraw(); } }, 'Hide')),
    h('div', { style: { height: '6px', borderRadius: '3px', background: 'var(--fill)', overflow: 'hidden' } }, h('div', { style: { width: (n / steps.length * 100) + '%', height: '100%', background: 'var(--tint)' } })),
    h('div', { class: 'list' }, steps.map((x) => liRow({ icon: x.done ? 'check' : 'plus', tone: x.done ? 'green' : 'gray', title: x.t, sub: x.s, chevron: !x.done, onclick: x.done ? null : x.run }))),
    h('a', { href: 'https://demo.auzslab.in/accounts.html', target: '_blank', rel: 'noopener', class: 'small' }, 'Want to practise first? Open the demo (demo@auzslab.in / Auzslab@Demo)'));
}
function easyTour() {
  if (lsGet(easyKey('tour')) === '1') return; lsSet(easyKey('tour'), '1');
  const cards = [
    ['Welcome', 'This app keeps your sales, purchases and money in one place. This short tour shows where things are.', 'home'],
    ['Make a bill', 'Scan items with the camera, or press Quick bill and add them by name. Pick the customer, add items, press Issue.', 'bolt'],
    ['Get paid', 'Money received lists payments. Open a customer to see what they owe and send a reminder.', 'wallet'],
    ['Record what you buy', 'Buy: record a purchase, an expense, or a payment to a supplier.', 'receipt'],
    ['Need more?', 'The Buying and books group has purchases, suppliers, reports and GST. Help is in the More menu.', 'more'],
  ];
  let i = 0; const body = h('div', { class: 'grid', style: { textAlign: 'center', gap: '10px', minHeight: '180px', alignContent: 'center' } });
  const next = h('button', { class: 'btn fill', type: 'button' }), back = h('button', { class: 'btn', type: 'button' }, 'Back');
  const paint = () => { const c = cards[i]; body.replaceChildren(h('div', null, icon(c[2], 40)), h('h3', null, c[0]), h('p', { class: 'muted' }, c[1]), h('div', { class: 'muted small' }, (i + 1) + ' of ' + cards.length)); next.textContent = i === cards.length - 1 ? 'Start' : 'Next'; back.style.visibility = i ? 'visible' : 'hidden'; };
  const s = sheet({ title: 'Quick tour', closeLabel: 'Skip', body: h('div', { class: 'grid' }, body, h('div', { class: 'row', style: { justifyContent: 'space-between' } }, back, next)) });
  next.onclick = () => { if (i === cards.length - 1) s.close(); else { i++; paint(); } }; back.onclick = () => { if (i) { i--; paint(); } }; paint();
}

// ---------- Home in simple view: four questions, checklist, what needs attention ----------
let easyMore = false;
async function easyHome(hostEl, d, redraw) {
  easyTour();
  const chk = await easyChecklist(d, redraw); if (chk) hostEl.append(chk);
  const m = d.month, cash = d.cash_bank.reduce((s, c) => s + Number(c.balance), 0);
  const card = (title, value, sub, btn, run, tone) => h('div', { class: 'card grid', style: { gap: '4px' } }, h('div', { class: 'muted small' }, title), h('div', { class: 'num', style: { fontSize: '26px', fontWeight: 700, color: tone || '' } }, value), h('div', { class: 'muted small' }, sub), h('div', null, h('button', { class: 'btn sm', type: 'button', onclick: run }, btn)));
  hostEl.append(h('div', { class: 'kpis', 'data-kg': '1', style: { gridColumn: '1 / -1', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' } },
    card('Money to collect', inr(d.receivables, 0), d.overdue_receivables > 0 ? inr(d.overdue_receivables, 0) + ' is overdue' : 'Nothing overdue', 'Collect', () => go('sales?status=unpaid')),
    card('Money to pay', inr(d.payables, 0), d.overdue_payables > 0 ? inr(d.overdue_payables, 0) + ' is overdue' : 'Nothing overdue', 'Pay', () => go('purchases?status=unpaid')),
    card('Cash and bank', inr(cash, 0), d.cash_bank.length + ' account' + (d.cash_bank.length === 1 ? '' : 's'), 'View', () => go('banking')),
    card('Profit this month', inr(m.profit, 0), 'Sales ' + inr(m.sales, 0), 'Details', () => go('reports/pnl'), m.profit < 0 ? 'var(--red)' : '')));
  if (can('acc_sales')) hostEl.append(h('button', { class: 'btn fill wide', type: 'button', style: { minHeight: '52px', fontSize: '17px', gridColumn: '1 / -1' }, onclick: () => go('quick') }, icon('plus', 22), 'Bill a customer'));
  const a = d.alerts, att = [];
  if (a.overdue_invoices) att.push({ icon: 'clock', tone: 'orange', title: a.overdue_invoices + ' unpaid bill' + (a.overdue_invoices > 1 ? 's are' : ' is') + ' overdue', sub: inr(d.overdue_receivables, 0) + ' to collect', run: () => go('sales?status=overdue') });
  if (a.bills_due_week) att.push({ icon: 'receipt', tone: 'blue', title: a.bills_due_week + ' supplier bill' + (a.bills_due_week > 1 ? 's' : '') + ' due this week', sub: 'Pay on time', run: () => go('purchases?status=unpaid') });
  if (a.drafts) att.push({ icon: 'edit', tone: 'gray', title: a.drafts + ' draft' + (a.drafts > 1 ? 's' : ''), sub: 'Saved but not issued yet', run: () => go('sales?status=draft') });
  if (a.low_stock) att.push({ icon: 'box', tone: 'orange', title: a.low_stock + ' item' + (a.low_stock > 1 ? 's' : '') + ' low on stock', sub: 'Time to reorder', run: () => go('products?low=1') });
  hostEl.append(h('div', { class: 'sec', style: { gridColumn: '1 / -1' } }, h('div', { class: 'sec-h' }, h('h3', null, 'Needs attention')), att.length ? h('div', { class: 'list' }, att.map((x) => liRow({ icon: x.icon, tone: x.tone, title: x.title, sub: x.sub, chevron: true, onclick: x.run }))) : h('div', { class: 'card' }, h('div', { class: 'row' }, icon('check', 22), h('span', null, 'All clear. Nothing needs your attention right now.')))));
  if (!easyMore) { hostEl.append(h('button', { class: 'btn wide', type: 'button', style: { gridColumn: '1 / -1' }, onclick: () => { easyMore = true; redraw(); } }, 'Show charts and comparisons')); return true; }
  return false;
}

applyWords();
// the tour opens once, on the first screen a beginner sees (AUZsScan lands on the scan page, not Overview)
const _buildShell = buildShell;
buildShell = function () { _buildShell(); if (easyOn()) setTimeout(easyTour, 700); };
