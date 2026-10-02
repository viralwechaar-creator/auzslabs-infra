/* Document editor: invoices, bills, quotations, orders, challans, credit/debit notes, expenses.
   Totals and the "what this will post" preview are computed here with the same rules as the server (which stays authoritative). */
'use strict';
const defaultTaxRate = () => { const v = S.org && S.org.settings && S.org.settings.default_tax_rate; return v == null || v === '' ? 18 : Number(v); };
const blankLine = (type) => ({ product_id: '', description: '', hsn: '', qty: '1', unit: '', rate: '', disc_pct: '', tax_rate: String(defaultTaxRate()), account_id: '', batch_no: '', expiry: '', warehouse_id: '' });

function calcDoc(D) {
  const org = S.org, party = (S.parties || []).find((p) => p.id === D.party_id) || null, sales = SALES_TYPES.includes(D.doc_type);
  let supply = 'intra', zero = false;
  if (sales) {
    const br = S.branches.find((b) => b.id === D.branch_id), origin = (br && br.state_code) || org.state_code, pos = D.place_of_supply || (party && party.state_code) || origin;
    supply = origin && pos && origin !== pos ? 'inter' : 'intra';
    if (party && party.reg_type === 'overseas') { supply = 'inter'; zero = true; }
    if (org.reg_type !== 'regular') zero = true;
  } else {
    supply = party && party.state_code && org.state_code && party.state_code !== org.state_code ? 'inter' : 'intra';
    if (party && party.reg_type === 'overseas') supply = 'inter';
    if (party && party.reg_type === 'composition') zero = true;
  }
  const out = { supply, zero, lines: [], subtotal: 0, discount: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, cess: 0, roundoff: 0, total: 0, byRate: {} };
  for (const l of D.lines) {
    const q = N(l.qty) || 0, rate = N(l.rate), gross = r2(q * rate);
    let damt = N(l.disc_amt), dp = N(l.disc_pct);
    if (dp > 0 && !damt) damt = r2(gross * dp / 100);
    const net = Math.max(gross - damt, 0), tr = zero ? 0 : N(l.tax_rate);
    let txb, tx;
    if (D.price_includes_tax && tr > 0) { txb = r2(net * 100 / (100 + tr)); tx = r2(net - txb); } else { txb = net; tx = r2(txb * tr / 100); }
    let cg = 0, sg = 0, ig = 0;
    if (supply === 'inter') ig = tx; else { cg = r2(tx / 2); sg = r2(tx - cg); }
    const cs = r2(txb * N(l.cess_pct) / 100);
    out.lines.push({ gross, damt, taxable: txb, tax: tx + cs, cgst: cg, sgst: sg, igst: ig, cess: cs, total: r2(txb + tx + cs), qty: q });
    out.subtotal += gross; out.discount += damt; out.taxable += txb; out.cgst += cg; out.sgst += sg; out.igst += ig; out.cess += cs;
    (out.byRate[tr] = out.byRate[tr] || { taxable: 0, tax: 0 }); out.byRate[tr].taxable += txb; out.byRate[tr].tax += tx;
  }
  ['subtotal', 'discount', 'taxable', 'cgst', 'sgst', 'igst', 'cess'].forEach((k) => (out[k] = r2(out[k])));
  let total = out.taxable + out.cgst + out.sgst + out.igst + out.cess;
  if (D.reverse_charge && !sales) total = out.taxable;
  if (D.roundoff !== '' && D.roundoff != null && !isNaN(N(D.roundoff)) && String(D.roundoff).trim() !== '') out.roundoff = r2(N(D.roundoff));
  else if (sales && S.org.round_off_sales) out.roundoff = r2(Math.round(total) - total);
  out.total = r2(total + out.roundoff);
  return out;
}
function effectRows(D, c, payNow) {
  const t = D.doc_type, rows = [], stock = [], flip = t === 'credit_note' || t === 'debit_note', party = (S.parties || []).find((p) => p.id === D.party_id);
  const sales = SALES_TYPES.includes(t), who = party && !party.is_walkin ? party.name : 'Walk-in';
  const push = (name, amt, sideDebit) => { amt = r2(amt); if (!amt) return; rows.push({ name, dr: sideDebit ? amt : 0, cr: sideDebit ? 0 : amt }); };
  const tax = (pre, debit) => { if (c.cgst) push(pre + ' CGST', c.cgst, debit); if (c.sgst) push(pre + ' SGST', c.sgst, debit); if (c.igst) push(pre + ' IGST', c.igst, debit); if (c.cess) push(pre + ' cess', c.cess, debit); };
  const prodOf = (l) => (S.products || []).find((p) => p.id === l.product_id);
  if (sales) {
    push('Receivable from ' + who, c.total, !flip); push(flip ? 'Sales returns' : 'Sales', c.taxable, flip); tax('Output', flip);
    if (c.roundoff) push('Round off', Math.abs(c.roundoff), flip ? c.roundoff > 0 : c.roundoff < 0);
    let cogs = 0;
    D.lines.forEach((l, i) => { const p = prodOf(l); if (p && p.track_stock && !p.is_service) { const q = c.lines[i].qty; cogs += q * Number(p.avg_cost || 0); stock.push((flip ? '+' : '−') + qty(q) + ' ' + p.name); } });
    if (cogs) { push('Cost of goods sold', cogs, !flip); push('Inventory', cogs, flip); }
  } else {
    D.lines.forEach((l, i) => { const p = prodOf(l); const cost = c.lines[i].taxable + (D.itc_eligible === false ? c.lines[i].tax : 0);
      if (p && p.track_stock && !p.is_service) { push('Inventory', cost, !flip); stock.push((flip ? '−' : '+') + qty(c.lines[i].qty) + ' ' + p.name); }
      else push(t === 'expense' ? (acctName(l.account_id) || 'Expense') : (acctName(l.account_id) || 'Purchases'), cost, !flip); });
    if (D.itc_eligible !== false) tax('Input', !flip);
    if (D.reverse_charge) push('GST payable on reverse charge', c.cgst + c.sgst + c.igst + c.cess, flip);
    if (c.roundoff) push('Round off', Math.abs(c.roundoff), flip ? c.roundoff < 0 : c.roundoff > 0);
    push('Payable to ' + who, c.total, flip);
  }
  (payNow || []).forEach((p) => { const a = r2(N(p.amount)); if (a > 0) { const nm = acctName(p.account_id) || 'Cash/bank'; if (sales && !flip) { push(nm, a, true); push('Receivable from ' + who, a, false); } else if (!sales && !flip) { push('Payable to ' + who, a, true); push(nm, a, false); } } });
  return { rows, stock };
}

async function pickParty(kind, current) {
  const list = (await parties()).filter((p) => p.active && (p.kind === 'both' || p.kind === kind || kind === 'any'));
  return new Promise((resolve) => {
    let pickedSomething = false;
    const host = h('div', { class: 'list' });
    const draw = (q) => { clear(host); const m = list.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase()) || (p.gstin || '').toLowerCase().includes(q.toLowerCase()) || (p.phone || '').includes(q)).slice(0, 60);
      m.forEach((p) => host.append(liRow({ icon: kind === 'supplier' ? 'building' : 'user', tone: p.is_walkin ? 'gray' : '', title: p.name, sub: [p.gstin, p.phone].filter(Boolean).join(' · ') || (p.is_walkin ? 'Cash customer' : ''), value: Number(p.balance) ? money(Math.abs(p.balance), { compact: true }) : null, valueSub: Number(p.balance) ? (p.balance > 0 ? 'owes you' : 'you owe') : null, sel: current === p.id, onclick: () => { pickedSomething = true; s.close(); resolve(p); } })));
      if (!m.length) host.append(h('div', { class: 'li muted' }, q ? 'No match.' : 'Nothing yet.')); };
    const sf = searchField('Search by name, GSTIN or phone', draw);
    const s = sheet({ title: kind === 'supplier' ? 'Choose supplier' : 'Choose customer', body: h('div', { class: 'grid' }, sf, host), headerAction: can(kind === 'supplier' ? 'acc_purchase' : 'acc_sales') ? { label: 'New', onclick: () => { s.close(); partySheet(kind === 'any' ? 'customer' : kind, null, (np) => resolve(np)); } } : null, onClose: () => { if (!pickedSomething) resolve(null); } });
    draw('');
  });
}

function productInput(line, sales, onPick, onType) {
  const inp = h('input', { class: 'input', placeholder: 'Item or service', value: line.description || '', 'aria-label': 'Item', autocomplete: 'off' });
  const pop = h('div', { class: 'pop hidden', role: 'listbox' });
  let idx = 0, list = [];
  const show = () => {
    const q = inp.value.trim().toLowerCase();
    list = (S.products || []).filter((p) => p.active && (!q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || (p.barcode || '') === inp.value.trim() || (p.hsn || '') === q)).slice(0, 8);
    clear(pop);
    if (!list.length) { pop.classList.add('hidden'); return; }
    list.forEach((p, i) => pop.append(h('button', { type: 'button', role: 'option', class: i === idx ? 'on' : '', onmousedown: (e) => { e.preventDefault(); pick(p); } }, h('div', null, h('div', null, p.name), h('div', { class: 's' }, p.sku + (p.hsn ? ' · HSN ' + p.hsn : ''))), h('div', { style: { textAlign: 'right' } }, h('div', { class: 'num' }, inr(sales ? p.sale_price : p.purchase_price)), h('div', { class: 's' }, p.is_service || !p.track_stock ? 'Service' : qty(p.stock) + ' in stock')))));
    pop.classList.remove('hidden');
  };
  const pick = (p) => { pop.classList.add('hidden'); inp.value = p.name; onPick(p); };
  inp.addEventListener('input', () => { idx = 0; onType(inp.value); show(); });
  inp.addEventListener('focus', () => { if (!line.product_id) show(); });
  inp.addEventListener('blur', () => setTimeout(() => pop.classList.add('hidden'), 120));
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && !pop.classList.contains('hidden')) { e.preventDefault(); idx = Math.min(idx + 1, list.length - 1); show(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(idx - 1, 0); show(); }
    else if (e.key === 'Enter' && !pop.classList.contains('hidden') && list[idx]) { e.preventDefault(); pick(list[idx]); }
    else if (e.key === 'Escape') pop.classList.add('hidden');
  });
  return h('div', { class: 'picker' }, inp, pop);
}

page('new', { title: 'New document', navAs: 'sales', icon: 'doc', nav: false, async render(v) { return docEditor(v, v.args[0], null); } });
page('edit', { title: 'Edit document', navAs: 'sales', icon: 'doc', nav: false, async render(v) { const r = await api('acc_get_document', { p_id: v.args[0] }); return docEditor(v, r.doc.doc_type, r); } });

async function docEditor(v, type, existing) {
  if (!DOC_LABEL[type]) throw new Error('Unknown document type');
  const sales = SALES_TYPES.includes(type), perm = docPerm(type), posting = POSTING.includes(type), isExpense = type === 'expense';
  if (!can(perm)) { v.header({ title: DOC_LABEL[type] }); v.root.append(empty('lock', 'No access', 'Your role cannot create this document.')); return; }
  await Promise.all([products(), parties()]);
  const q = v.q, recurring = q.get('recurring') === '1';
  let D = {
    id: existing ? existing.doc.id : '', doc_type: type, doc_date: today(), due_date: '', party_id: '', branch_id: S.branches.length === 1 ? S.branches[0].id : '', warehouse_id: '', place_of_supply: '', reverse_charge: false, itc_eligible: true,
    price_includes_tax: false, supplier_ref: '', supplier_ref_date: '', ref_doc_id: '', notes: '', terms: '', payment_terms: '', billing_address: '', shipping_address: '', roundoff: '', lines: [blankLine(type)], pay: 'later', payments: [],
  };
  const fromDoc = async (r, copy) => {
    const d = r.doc;
    Object.assign(D, { doc_date: copy ? today() : d.doc_date, due_date: copy ? '' : (d.due_date || ''), party_id: d.party_id || '', branch_id: d.branch_id || D.branch_id, warehouse_id: d.warehouse_id || '', place_of_supply: d.place_of_supply || '', reverse_charge: !!d.reverse_charge, itc_eligible: d.itc_eligible !== false,
      price_includes_tax: !!d.price_includes_tax, supplier_ref: copy ? '' : (d.supplier_ref || ''), supplier_ref_date: copy ? '' : (d.supplier_ref_date || ''), notes: d.notes || '', terms: d.terms || '', payment_terms: d.payment_terms || '', billing_address: d.billing_address || '', shipping_address: d.shipping_address || '',
      roundoff: '', source_doc_id: copy ? '' : (d.source_doc_id || '') });
    D.lines = r.lines.map((l) => ({ product_id: l.product_id || '', description: l.description || '', hsn: l.hsn || '', qty: String(l.qty), unit: l.unit || '', rate: String(l.rate), disc_pct: Number(l.disc_pct) ? String(l.disc_pct) : '', disc_amt: Number(l.disc_amt) && !Number(l.disc_pct) ? String(l.disc_amt) : '', tax_rate: String(l.tax_rate), account_id: l.account_id || '', batch_no: l.batch_no || '', expiry: l.expiry || '', warehouse_id: l.warehouse_id || '' }));
    if (!D.lines.length) D.lines = [blankLine(type)];
  };
  if (existing) await fromDoc(existing, false);
  else if (q.get('copy')) await fromDoc(await api('acc_get_document', { p_id: q.get('copy') }), true);
  else if (q.get('ref')) { const r = await api('acc_get_document', { p_id: q.get('ref') }); await fromDoc(r, true); D.ref_doc_id = r.doc.id; D.notes = (type === 'credit_note' ? 'Return against ' : 'Debit against ') + r.doc.number; D.lines.forEach((l) => { l.qty = l.qty; }); }
  if (q.get('party') && !D.party_id) D.party_id = q.get('party');
  if (!D.id && !D.lines[0].rate && !q.get('copy') && !q.get('ref')) D.lines = [blankLine(type)];
  if (!existing && !D.terms && sales && S.org.invoice_terms && type === 'invoice') D.terms = S.org.invoice_terms;
  const party = () => (S.parties || []).find((p) => p.id === D.party_id);
  const title = (existing ? 'Edit ' : 'New ') + DOC_LABEL[type].toLowerCase();
  v.header({ title: recurring ? 'New schedule' : title, back: () => (existing ? go('doc/' + existing.doc.id) : back(isExpense ? 'expenses' : sales ? 'sales' : 'purchases')) });

  const root = v.root, totalsEl = h('div', { class: 'card totals' }), effectEl = h('div', { class: 'effect' }), warnEl = h('div', { class: 'grid', style: { gap: '8px' } }), linesEl = h('div', { class: 'lines' });
  let C = calcDoc(D);
  const amountCells = [];

  // ----- details form -----
  const partyBtn = h('button', { class: 'li', type: 'button', style: { borderRadius: '16px', background: 'var(--card)', boxShadow: '0 0 0 .5px var(--sep)' }, onclick: async () => { const p = await pickParty(sales ? 'customer' : 'supplier', D.party_id); if (p) { D.party_id = p.id; D.place_of_supply = ''; if (!D.due_date && p.credit_days) D.due_date = addDays(D.doc_date, p.credit_days); drawParty(); recalc(); } } });
  const drawParty = () => {
    const p = party(); clear(partyBtn);
    partyBtn.append(h('span', { class: 'tile gray' }, icon(sales ? 'user' : 'building', 18)), h('div', { class: 'grow' }, h('div', { class: 'cap' }, sales ? 'Customer' : 'Supplier'), h('div', { class: 't' }, p ? p.name : (isExpense ? 'No vendor (paid at once)' : sales ? 'Walk-in / choose customer' : 'Choose supplier')), p ? h('div', { class: 's' }, [p.gstin || 'No GSTIN', p.state_code ? stateName(p.state_code) : ''].filter(Boolean).join(' · ')) : null), h('span', { class: 'chev' }, icon('chevR', 18)));
  };
  drawParty();
  const dateEl = dateInput(D.doc_date, { onchange: () => { D.doc_date = dateEl.value; const p = party(); if (!D.due_date || posting) { if (p && p.credit_days && !existing) D.due_date = addDays(D.doc_date, p.credit_days); } dueEl.value = D.due_date; } });
  const dueEl = dateInput(D.due_date, { onchange: () => { D.due_date = dueEl.value; } });
  const posEl = selectEl([['', 'Same as customer'], ...Object.keys(STATES).map((c) => [c, stateName(c)])], D.place_of_supply, { onchange: () => { D.place_of_supply = posEl.value; recalc(); } });
  const brEl = S.branches.length > 1 ? selectEl([['', 'No branch'], ...S.branches.filter((b) => b.active).map((b) => [b.id, b.name])], D.branch_id, { onchange: () => { D.branch_id = brEl.value; recalc(); } }) : null;
  const whEl = S.warehouses.filter((w) => w.active).length > 1 && posting ? selectEl([['', 'Default warehouse'], ...S.warehouses.filter((w) => w.active).map((w) => [w.id, w.name])], D.warehouse_id, { onchange: () => { D.warehouse_id = whEl.value; } }) : null;
  const refEl = input({ value: D.supplier_ref, placeholder: 'Supplier’s invoice number', onchange: (e) => { D.supplier_ref = e.target.value; } }), refDate = dateInput(D.supplier_ref_date, { onchange: () => { D.supplier_ref_date = refDate.value; } });
  const details = h('div', { class: 'grid' }, isExpense ? null : partyBtn,
    isExpense ? partyBtn : null,
    h('div', { class: 'card grid', style: { gap: '14px' } },
      h('div', { class: 'row g2', style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } }, field('Date', dateEl), posting && type !== 'credit_note' && type !== 'debit_note' && !isExpense ? field('Due date', dueEl) : h('div')),
      sales && posting ? field('Place of supply', posEl, 'Decides CGST + SGST (same state) or IGST (other state).') : null,
      type === 'bill' || type === 'debit_note' || isExpense ? h('div', { class: 'row g2', style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } }, field(isExpense ? 'Receipt / bill no.' : 'Supplier invoice no.', refEl), field('Supplier invoice date', refDate)) : null,
      brEl ? field('Branch', brEl) : null, whEl ? field('Warehouse', whEl) : null,
      !sales && posting ? h('div', null, checkbox('Reverse charge (tax paid by you)', D.reverse_charge, (x) => { D.reverse_charge = x; recalc(); }), checkbox('Input tax credit can be claimed', D.itc_eligible, (x) => { D.itc_eligible = x; recalc(); })) : null,
      checkbox('Prices include tax', D.price_includes_tax, (x) => { D.price_includes_tax = x; recalc(); })));
  if (type === 'credit_note' || type === 'debit_note') {
    const refBtn = h('button', { class: 'li', type: 'button', style: { borderRadius: '16px', background: 'var(--card)', boxShadow: '0 0 0 .5px var(--sep)' }, onclick: async () => {
      if (!D.party_id) return toast('Choose the ' + (sales ? 'customer' : 'supplier') + ' first', { err: true });
      const r = await api('acc_list_documents', { p: { types: [sales ? 'invoice' : 'bill'], party_id: D.party_id, status: '', limit: 100 } });
      const rows = r.rows.filter((x) => x.status === 'posted');
      const s = sheet({ title: sales ? 'Against which invoice?' : 'Against which bill?', body: h('div', { class: 'list' }, rows.length ? rows.map((x) => liRow({ title: x.number, sub: fmtD(x.doc_date), value: money(x.total), chevron: true, onclick: async () => { s.close(); D.ref_doc_id = x.id; const o = await api('acc_get_document', { p_id: x.id }); D.lines = o.lines.map((l) => ({ product_id: l.product_id || '', description: l.description, hsn: l.hsn || '', qty: String(l.qty), unit: l.unit || '', rate: String(l.rate), disc_pct: Number(l.disc_pct) ? String(l.disc_pct) : '', tax_rate: String(l.tax_rate), account_id: l.account_id || '' })); drawRef(x.number); drawLines(); recalc(); } })) : [h('div', { class: 'li muted' }, 'No posted documents for this party.')]), closeLabel: 'Close' });
    } });
    var drawRef = (n) => { clear(refBtn); refBtn.append(h('span', { class: 'tile gray' }, icon('link', 18)), h('div', { class: 'grow' }, h('div', { class: 'cap' }, 'Against'), h('div', { class: 't' }, n || 'Not linked to a document')), h('span', { class: 'chev' }, icon('chevR', 18))); };
    drawRef(existing && existing.parent ? existing.parent.number : (D.ref_doc_id ? (q.get('ref') ? 'Linked document' : 'Linked document') : ''));
    details.append(refBtn);
  }
  root.append(details);

  // ----- lines -----
  const lineHead = h('div', { class: 'lines-head desk-only', 'aria-hidden': 'true' }, ['Item', 'HSN/SAC', 'Qty', 'Unit', 'Rate', 'Disc %', 'GST %', 'Amount', ''].map((x, i) => h('span', { class: i >= 2 && i !== 3 ? 'r' : '' }, x)));
  if (!isExpense) root.append(h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Items')), lineHead, linesEl, h('button', { class: 'btn', type: 'button', onclick: () => { D.lines.push(blankLine(type)); drawLines(true); } }, icon('plus', 18), 'Add line')));
  function lineNode(l, i) {
    const lf = (label, ctl, cls) => h('div', { class: 'lf ' + (cls || '') }, h('label', { class: 'lf-l' }, label), ctl);
    const amt = h('div', { class: 'lf r amt' }, h('label', { class: 'lf-l' }, 'Amount'), h('div', { class: 'money num', style: { fontWeight: 600, padding: '8px 0' } }, inr(0)));
    amountCells[i] = $('.money', amt);
    const num = (key, ph, step) => h('input', { class: 'input', type: 'text', inputmode: 'decimal', value: l[key], placeholder: ph || '', 'aria-label': key, oninput: (e) => { l[key] = e.target.value; recalc(); }, onkeydown: (e) => { if (e.key === 'Enter' && key === 'tax_rate' && i === D.lines.length - 1) { e.preventDefault(); D.lines.push(blankLine(type)); drawLines(true); } } });
    const prod = productInput(l, sales, (p) => {
      l.product_id = p.id; l.description = p.name; l.hsn = p.hsn || ''; l.unit = p.unit || ''; l.rate = String(sales ? p.sale_price : p.purchase_price); l.tax_rate = String(p.tax_rate); if (p.tax_inclusive) D.price_includes_tax = true;
      drawLines(); recalc(); setTimeout(() => { const qi = $$('.line')[i] && $('[aria-label=qty]', $$('.line')[i]); qi && qi.select(); }, 30);
    }, (txt) => { l.description = txt; if (!txt) l.product_id = ''; });
    const rates = taxRates().map(String); if (!rates.includes(String(l.tax_rate))) rates.push(String(l.tax_rate));
    const taxSel = selectEl(rates.map((r) => [r, r + '%']), String(l.tax_rate), { label: 'GST rate', onchange: () => { l.tax_rate = taxSel.value; recalc(); } });
    const stock = (S.products.find((p) => p.id === l.product_id) || {});
    const accSel = !l.product_id && !sales ? selectEl([['', isExpense ? 'Choose category' : 'Purchases'], ...S.accounts.filter((a) => a.type === 'expense' && a.active).map((a) => [a.id, a.name])], l.account_id, { label: 'Expense account', onchange: () => { l.account_id = accSel.value; recalc(); } }) : null;
    const node = h('div', { class: 'line' },
      h('div', { class: 'lf item' }, h('label', { class: 'lf-l' }, 'Item'), prod, stock.id && stock.track_stock && !stock.is_service ? h('div', { class: 'cap stk' }, qty(stock.stock) + ' ' + (stock.unit || '') + ' in stock') : null, accSel ? h('div', { style: { marginTop: '6px' } }, accSel) : null),
      lf('HSN/SAC', h('input', { class: 'input', value: l.hsn, 'aria-label': 'HSN or SAC', inputmode: 'numeric', oninput: (e) => { l.hsn = e.target.value; } }), 'hsn'),
      lf('Qty', num('qty', '1'), 'q r'), lf('Unit', h('input', { class: 'input', value: l.unit, 'aria-label': 'Unit', oninput: (e) => { l.unit = e.target.value; } }), 'u'), lf('Rate', num('rate', '0.00'), 'rt r'), lf('Disc %', num('disc_pct', '0'), 'd r'), lf('GST', taxSel, 'tx'), amt,
      h('button', { class: 'btn plain icon del', type: 'button', 'aria-label': 'Remove line ' + (i + 1), disabled: D.lines.length === 1, onclick: () => { D.lines.splice(i, 1); drawLines(); recalc(); } }, icon('trash', 18)));
    return node;
  }
  function drawLines(focusLast) {
    clear(linesEl); amountCells.length = 0;
    D.lines.forEach((l, i) => linesEl.append(lineNode(l, i)));
    if (focusLast) { const last = $$('.line input.input', linesEl).filter((x) => x.getAttribute('aria-label') === 'Item').pop(); last && last.focus(); }
    recalc();
  }

  // ----- expense quick form -----
  if (isExpense) {
    const l = D.lines[0]; if (!l.account_id) l.account_id = (S.accounts.find((a) => a.code === '5107') || {}).id || '';
    l.tax_rate = existing ? l.tax_rate : '0';
    const cat = selectEl(S.accounts.filter((a) => a.type === 'expense' && a.active && a.grp !== 'Cost of sales').map((a) => [a.id, a.name]), l.account_id, { onchange: () => { l.account_id = cat.value; recalc(); } });
    const desc = input({ value: l.description, placeholder: 'What was it for?', onchange: (e) => { l.description = e.target.value; } });
    const amt = h('input', { class: 'input', inputmode: 'decimal', placeholder: '0.00', value: l.rate, 'aria-label': 'Amount', oninput: (e) => { l.rate = e.target.value; l.qty = '1'; recalc(); } });
    const gst = selectEl(taxRates().map((r) => [String(r), r + '%']), l.tax_rate, { onchange: () => { l.tax_rate = gst.value; recalc(); } });
    root.append(h('div', { class: 'card grid' }, field('Category', cat), field('Description', desc), h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } }, field(D.price_includes_tax ? 'Amount (incl. tax)' : 'Amount (before tax)', amt), field('GST rate', gst))));
  }

  // ----- payment -----
  const payHost = h('div', { class: 'card grid' });
  const payable = (sales && type === 'invoice') || type === 'bill' || isExpense;
  function drawPay() {
    clear(payHost); if (!payable) return;
    const mode = D.pay;
    payHost.append(h('h3', null, sales ? 'Payment received now' : 'Paid now'), seg([['later', isExpense && !party() ? 'Choose paid from' : sales ? 'On credit' : 'Pay later'], ['full', 'Paid in full'], ['part', 'Part payment']].filter((o) => !(isExpense && !party() && o[0] === 'later')), mode, (m) => { D.pay = m; if (m !== 'later' && !D.payments.length) D.payments = [{ account_id: (payAccounts().find((a) => a.is_cash) || payAccounts()[0] || {}).id, amount: '', mode: '', reference: '' }]; drawPay(); recalc(); }, { full: true }));
    if (mode !== 'later') D.payments.forEach((p, i) => {
      const acc = selectEl(payAccounts().map((a) => [a.id, a.name]), p.account_id, { onchange: () => { p.account_id = acc.value; recalc(); } });
      const am = h('input', { class: 'input', inputmode: 'decimal', placeholder: mode === 'full' ? 'Total' : '0.00', value: mode === 'full' ? '' : p.amount, disabled: mode === 'full', 'aria-label': 'Amount paid', oninput: (e) => { p.amount = e.target.value; recalc(); } });
      const md = selectEl([['', 'Method'], 'Cash', 'UPI', 'Card', 'NEFT/RTGS', 'Cheque'], p.mode, { onchange: () => { p.mode = md.value; } });
      const rf = input({ value: p.reference, placeholder: 'Reference (UTR, cheque no.)', onchange: (e) => { p.reference = e.target.value; } });
      payHost.append(h('div', { class: 'grid', style: { gap: '10px' } }, h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' } }, field('Account', acc), field('Amount', am)), h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' } }, field('Method', md), field('Reference', rf))));
    });
  }
  if (payable) root.append(payHost);
  drawPay();

  // ----- notes -----
  const notes = h('textarea', { class: 'textarea', placeholder: 'Notes (shown on the document)', 'aria-label': 'Notes', oninput: (e) => { D.notes = e.target.value; } }, D.notes);
  const terms = h('textarea', { class: 'textarea', placeholder: 'Terms and conditions', 'aria-label': 'Terms', oninput: (e) => { D.terms = e.target.value; } }, D.terms);
  root.append(h('div', { class: 'card grid' }, field('Notes', notes), sales && type !== 'credit_note' ? field('Terms', terms) : null));
  root.append(warnEl, h('div', { class: 'two wide-left' }, h('details', { class: 'card' }, h('summary', { style: { cursor: 'pointer', fontWeight: 600, minHeight: '32px' } }, 'What this will post'), effectEl), totalsEl));

  const effectOpen = isDesk(); $('details', root).open = effectOpen;
  function recalc() {
    C = calcDoc(D);
    C.lines.forEach((cl, i) => { if (amountCells[i]) amountCells[i].textContent = inr(cl.total); });
    // totals
    clear(totalsEl).append(
      ...[['Subtotal', C.subtotal], C.discount ? ['Discount', -C.discount] : null, ['Taxable value', C.taxable], C.cgst ? ['CGST', C.cgst] : null, C.sgst ? ['SGST', C.sgst] : null, C.igst ? ['IGST', C.igst] : null, C.cess ? ['Cess', C.cess] : null].filter(Boolean).map(([a, b]) => h('div', { class: 't' }, h('span', { class: 'muted' }, a), money(b))),
      h('div', { class: 't' }, h('label', { class: 'muted', for: 'ro' }, 'Round off'), h('input', { id: 'ro', class: 'input', style: { width: '96px', minHeight: '32px', textAlign: 'right', padding: '2px 8px' }, inputmode: 'decimal', value: D.roundoff === '' ? '' : D.roundoff, placeholder: nf2.format(C.roundoff), 'aria-label': 'Round off', oninput: (e) => { D.roundoff = e.target.value; const c2 = calcDoc(D); setTotalOnly(c2.total); } })),
      h('div', { class: 't big' }, h('span', null, D.reverse_charge && !sales ? 'Payable to supplier' : 'Total'), h('span', { class: 'money num', id: 'grand' }, inr(C.total))),
      C.supply === 'inter' ? h('div', { class: 'cap' }, 'Inter-state supply: IGST applies') : C.zero ? h('div', { class: 'cap' }, sales ? 'No GST charged (' + (S.org.reg_type !== 'regular' ? 'your registration type' : 'export / overseas') + ')' : 'No GST (composition supplier)') : null);
    const payNow = payable && D.pay !== 'later' ? D.payments.map((p) => ({ ...p, amount: D.pay === 'full' ? C.total : N(p.amount) })) : [];
    const ef = effectRows(D, C, payNow);
    clear(effectEl).append(ef.rows.length ? h('table', null, h('thead', null, h('tr', null, h('th', { style: { textAlign: 'left' } }, 'Account'), h('th', { class: 'r' }, 'Debit'), h('th', { class: 'r' }, 'Credit'))), h('tbody', null, ef.rows.map((r) => h('tr', null, h('td', null, (r.cr && !r.dr ? '   ' : '') + r.name), h('td', { class: 'r money num' }, r.dr ? nf2.format(r.dr) : ''), h('td', { class: 'r money num' }, r.cr ? nf2.format(r.cr) : ''))))) : h('p', { class: 'muted small' }, 'Nothing yet. Add items to see the entries.'),
      ef.stock.length ? h('p', { class: 'small', style: { marginTop: '8px' } }, h('b', null, 'Stock: '), ef.stock.join(', ')) : null, !posting ? h('p', { class: 'small muted' }, 'This document does not post to the books. Stock and money move when it becomes an invoice or bill.') : null);
    // warnings
    clear(warnEl);
    const p = party();
    if (sales && type === 'invoice' && p && Number(p.credit_limit) > 0) { const paid = payNow.reduce((s, x) => s + N(x.amount), 0), after = Number(p.balance) + C.total - paid; if (after > Number(p.credit_limit)) warnEl.append(h('div', { class: 'banner bad' }, icon('alert', 18), 'Over the credit limit: ' + p.name + ' would owe ' + inr(after, 0) + ' against a limit of ' + inr(p.credit_limit, 0) + '. Posting will be refused unless you take payment or raise the limit.')); }
    if (posting && !S.org.allow_negative_stock && (sales ? type === 'invoice' : type === 'debit_note')) { const need = {}; D.lines.forEach((l, i) => { if (l.product_id) need[l.product_id] = (need[l.product_id] || 0) + C.lines[i].qty; }); Object.entries(need).forEach(([id, n]) => { const pr = S.products.find((x) => x.id === id); if (pr && pr.track_stock && !pr.is_service && n > Number(pr.stock)) warnEl.append(h('div', { class: 'banner bad' }, icon('alert', 18), 'Not enough stock for ' + pr.name + ': ' + qty(pr.stock) + ' in stock, ' + qty(n) + ' on this document.')); }); }
    if (sales && S.org.reg_type !== 'regular') warnEl.append(h('div', { class: 'banner info' }, icon('info', 18), 'Your registration type is ' + S.org.reg_type + ', so no GST is charged. Change it in Settings if that is wrong.'));
    if (sales && !S.org.state_code) warnEl.append(h('div', { class: 'banner' }, icon('alert', 18), 'Set your state in Settings so CGST/SGST vs IGST is chosen correctly.'));
    D._total = C.total;
  }
  function setTotalOnly(t) { const g = $('#grand'); if (g) g.textContent = inr(t); }
  drawLines();

  // ----- actions -----
  const build = (post) => {
    const lines = D.lines.map((l) => ({ product_id: l.product_id || null, description: l.description, hsn: l.hsn, qty: l.qty, unit: l.unit, rate: l.rate, disc_pct: l.disc_pct, disc_amt: l.disc_amt, tax_rate: l.tax_rate, account_id: l.account_id || null, batch_no: l.batch_no, expiry: l.expiry || null, warehouse_id: l.warehouse_id || null }));
    const payments = payable && D.pay !== 'later' ? D.payments.map((p) => ({ account_id: p.account_id, amount: D.pay === 'full' ? C.total : N(p.amount), mode: p.mode, reference: p.reference })).filter((p) => p.amount > 0) : [];
    return { id: D.id || null, doc_type: type, doc_date: D.doc_date, due_date: D.due_date || null, party_id: D.party_id || null, branch_id: D.branch_id || null, warehouse_id: D.warehouse_id || null, place_of_supply: D.place_of_supply || null, reverse_charge: D.reverse_charge, itc_eligible: D.itc_eligible,
      price_includes_tax: D.price_includes_tax, supplier_ref: D.supplier_ref || null, supplier_ref_date: D.supplier_ref_date || null, ref_doc_id: D.ref_doc_id || null, source_doc_id: D.source_doc_id || null, notes: D.notes, terms: D.terms, roundoff: D.roundoff === '' ? null : D.roundoff, lines, payments, post };
  };
  const validate = () => {
    if (!sales && !D.party_id && !isExpense) return 'Choose a supplier';
    if (D.lines.every((l) => !l.description && !l.product_id && !N(l.rate))) return 'Add at least one item';
    for (let i = 0; i < D.lines.length; i++) { const l = D.lines[i]; if (!l.description && !l.product_id) return 'Line ' + (i + 1) + ' needs an item or description'; if (N(l.qty) <= 0) return 'Line ' + (i + 1) + ': quantity must be more than zero'; if (isExpense && !l.account_id) return 'Choose a category'; }
    if (C.total <= 0 && posting) return 'The total must be more than zero';
    if (payable && D.pay === 'part') { const sum = D.payments.reduce((s, p) => s + N(p.amount), 0); if (sum <= 0) return 'Enter the amount paid'; if (sum > C.total + 0.005) return 'The payment is more than the total'; }
    if (isExpense && !party() && D.pay === 'later') return 'Choose where the money was paid from';
    return '';
  };
  const save = async (post) => {
    const err = validate(); if (err) return toast(err, { err: true });
    if (post && !(await confirmBox('Post ' + DOC_LABEL[type].toLowerCase() + ' for ' + inr(C.total) + '?', 'This creates ledger' + (posting ? ', stock and GST' : '') + ' entries and gives it its final number. You can cancel it later with a reversal but not edit it.', 'Post'))) return;
    btns.forEach((b) => (b.disabled = true));
    try {
      const r = await api('acc_save_document', { p: build(post) });
      dirty = false; bust('products', 'parties');
      if (r.pending_approval) { toast('Saved. It needs a manager’s approval before it can be posted.'); go('doc/' + r.id); return; }
      toast(r.posted ? 'Posted ' + r.number : 'Draft saved'); go('doc/' + r.id);
    } catch (e) { fail(e); btns.forEach((b) => (b.disabled = false)); }
  };
  const saveSchedule = () => {
    const err = validate(); if (err) return toast(err, { err: true });
    const nm = input({ value: (party() ? party().name + ' · ' : '') + DOC_LABEL[type].toLowerCase() }), fr = selectEl([['monthly', 'Monthly'], ['weekly', 'Weekly'], ['quarterly', 'Quarterly'], ['yearly', 'Yearly']], 'monthly'), nd = dateInput(addDays(today(), 30)), ed = dateInput(''), ap = checkbox('Post automatically (otherwise create a draft to review)', false);
    sheet({ title: 'Repeat this ' + DOC_LABEL[type].toLowerCase(), body: h('div', { class: 'grid' }, field('Name', nm), field('Repeats', fr), field('First date', nd), field('Stop after (optional)', ed), ap), actions: [{ label: 'Save schedule', primary: true, onclick: async (c) => { const b = build(false); await api('acc_save_recurring', { p: { kind: type, name: nm.value, frequency: fr.value, next_date: nd.value, end_date: ed.value, auto_post: $('input', ap).checked, payload: b } }); c(); dirty = false; toast('Schedule saved'); go((isExpense ? 'expenses' : sales ? 'sales' : 'purchases') + '?tab=recurring'); } }] });
  };
  let dirty = false; root.addEventListener('input', () => { dirty = true; }, { once: true });
  const draftBtn = h('button', { class: 'btn', type: 'button', onclick: () => save(false) }, posting ? 'Save draft' : 'Save');
  const postBtn = posting ? h('button', { class: 'btn fill', type: 'button', onclick: () => save(true) }, 'Post ' + DOC_LABEL[type].toLowerCase()) : null;
  const repBtn = posting && (type === 'invoice' || type === 'bill' || isExpense) ? h('button', { class: 'btn', type: 'button', onclick: saveSchedule, 'aria-label': 'Repeat on a schedule' }, icon('repeat', 18), h('span', { class: 'desk-only' }, 'Repeat…')) : null;
  const btns = [draftBtn, postBtn, repBtn].filter(Boolean);
  root.append(h('div', { class: 'dock' }, recurring ? h('button', { class: 'btn fill', type: 'button', onclick: saveSchedule }, 'Save schedule…') : [repBtn, draftBtn, postBtn]));
  const keys = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(false); } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && posting) { e.preventDefault(); save(true); } };
  document.addEventListener('keydown', keys); v.onLeave(() => document.removeEventListener('keydown', keys));
  const bu = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } }; window.addEventListener('beforeunload', bu); v.onLeave(() => window.removeEventListener('beforeunload', bu));
  recalc();
}
