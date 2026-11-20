/* AUZsStyle: Buy. Purchases (receive stock by size run, weighted-average cost) and suppliers (what you owe). */
'use strict';
const BR = { k: '30', from: null, to: null };
page('buy', {
  title: 'Buy', perm: () => can('sty_purchase') || allowed(PAGES.parties),
  async render(v) {
    const buying = can('sty_purchase');
    const parties = allowed(PAGES.parties);
    const tabs = [
      ...(buying ? [['purchases', t('Purchases')], ['suppliers', t('Suppliers')], ['register', t('Purchase register')]] : []),
      ...(parties ? [['parties', t('Parties')]] : []),
    ];
    const requested = v.q.get('tab');
    const tab = tabs.some(([id]) => id === requested) ? requested : tabs[0][0];
    const root = v.root;
    root.append(seg(tabs, tab, (id) => go('buy?tab=' + id), { full: true }));
    root.classList.add('style-buy');
    v.header({ title: t('Buy'), actions: buying ? [
      { label: t('Receive stock'), icon: 'plus', primary: true, run: () => receiveForm({}, () => v.refresh()) },
      { label: t('Add supplier'), icon: 'truck', run: () => supplierForm(null, () => tab === 'suppliers' ? v.refresh() : go('buy?tab=suppliers')) },
    ] : [] });
    if (tab === 'parties') return PAGES.parties.render(v, { embedded: true });
    const host = h('div'); root.append(host);
    host.append(h('div', { class: 'spin', style: { color: 'var(--tint)', margin: '24px auto' } }));
    if (tab === 'suppliers') {
      const list = await api('sty_list_suppliers') || [];
      const owe = list.reduce((a, s) => a + Math.max(s.due, 0), 0);
      clear(host).append(h('div', { class: 'grid' }, h('div', { class: 'kpis' }, kpi(t('You owe suppliers'), inr(owe, 0), list.filter((s) => s.due > 0).length + ' ' + t('suppliers'), null, owe > 0 ? 'neg' : ''), kpi(t('Suppliers'), list.length)),
        h('div', { class: 'list' }, list.length ? list.map((s) => liRow({ icon: 'truck', title: s.name, sub: [s.phone, s.lastAt ? t('Last') + ' ' + fmtDay(s.lastAt) : ''].filter(Boolean).join(' · '), value: s.due > 0 ? inr(s.due) : t('Settled'), valueSub: s.due > 0 ? t('Due') : '', chevron: true, onclick: () => go('supplier/' + encodeURIComponent(s.id)) })) : [empty('truck', t('No suppliers yet'), t('Add the people you buy from to track what you owe.'))])));
    } else if (tab === 'register') {
      if (!BR.from) Object.assign(BR, rangeFor('30'));
      const reg = await api('sty_purchase_register', { p: { from: BR.from, to: BR.to } }) || { bills: [], totals: {} };
      const paintReg = () => clear(host).append(h('div', { class: 'grid' },
        h('div', { class: 'kpis' }, kpi(t('Taxable value'), inr(reg.totals.taxable || 0, 0)), kpi('CGST', inr(reg.totals.cgst || 0, 0)), kpi('SGST', inr(reg.totals.sgst || 0, 0)), kpi('IGST', inr(reg.totals.igst || 0, 0)), kpi(t('Input tax credit'), inr(reg.totals.itc || 0, 0), (reg.totals.bills || 0) + ' ' + t('purchases'))),
        h('button', { class: 'btn', type: 'button', onclick: () => csvDownload('purchase-register-' + BR.from + '-' + BR.to + '.csv', [['Date', 'Invoice', 'Supplier', 'Taxable', 'CGST', 'SGST', 'IGST', 'Total', 'Status']].concat((reg.bills || []).map((x) => [fmtDT(x.at), x.invoiceNo || '', x.supplier || '', x.taxableValue, x.cgst, x.sgst, x.igst, x.total, x.status]))) }, icon('download', 18), t('Export CSV')),
        h('div', { class: 'list' }, (reg.bills || []).length ? reg.bills.map((p) => liRow({ icon: 'box', title: (p.supplier || t('No supplier')) + (p.invoiceNo ? ' · ' + p.invoiceNo : ''), sub: fmtDT(p.at) + ' · ' + t('Taxable') + ' ' + inr(p.taxableValue, 0) + ' · ' + t('ITC') + ' ' + inr(p.cgst + p.sgst + p.igst, 0), value: inr(p.total), valueSub: p.status === 'paid' ? t('Paid') : p.status === 'part' ? t('Part paid') : t('Unpaid'), chevron: true, onclick: () => purchaseSheet({ id: p.id }) })) : [empty('box', t('No purchases in this period'))])));
      root.insertBefore(rangePicker(BR, async () => { Object.assign(reg, await api('sty_purchase_register', { p: { from: BR.from, to: BR.to } }) || { bills: [], totals: {} }); paintReg(); }, ['week', 'month', '30', '90', 'custom']), host);
      paintReg();
    } else {
      const list = await api('sty_list_purchases', { p_limit: 60 }) || [];
      const total = list.reduce((a, p) => a + p.total, 0), unpaid = list.reduce((a, p) => a + (p.total - p.paid), 0);
      clear(host).append(h('div', { class: 'grid' }, h('div', { class: 'kpis' }, kpi(t('Bought'), inr(total, 0), list.length + ' ' + t('purchases')), kpi(t('Unpaid'), inr(unpaid, 0), '', null, unpaid > 0 ? 'neg' : '')),
        h('div', { class: 'list' }, list.length ? list.map((p) => liRow({ icon: 'box', title: (p.supplier || t('No supplier')) + (p.invoiceNo ? ' · ' + p.invoiceNo : ''), sub: fmtDT(p.at) + ' · ' + p.units + ' ' + t('Units'), value: inr(p.total), valueSub: p.status === 'paid' ? t('Paid') : p.status === 'part' ? t('Part paid') : t('Unpaid'), chevron: true, onclick: () => purchaseSheet(p) })) : [empty('box', t('No purchases yet'), t('Receive stock to see it here.'))])));
    }
  },
});
// A formal GST purchase bill: fetched fresh from sty_purchase_detail so the HSN/tax breakup is always
// correct, even from a list row (sty_list_purchases/sty_purchase_register) that only carries a summary.
async function purchaseSheet(p0) {
  let p;
  try {
    p = await api('sty_purchase_detail', { p_id: p0.id });
    if (!p) throw new Error(t('Purchase not found'));
  } catch (e) { return fail(e); }
  const gstSplit = (p.cgst > 0 || p.sgst > 0 || p.igst > 0);
  sheet({ title: (p.supplier?.name || t('Purchase')) + (p.invoiceNo ? ' · ' + p.invoiceNo : ''), closeLabel: t('Done'), body: h('div', { class: 'grid' },
    h('div', { class: 'muted small' }, [fmtDT(p.at), t(p.status === 'paid' ? 'Paid' : p.status === 'part' ? 'Part paid' : 'Unpaid')].join(' · ')),
    p.note ? h('p', { class: 'muted small' }, p.note) : null,
    p.supplier && p.supplier.gstin ? h('div', { class: 'muted small' }, t('Supplier GSTIN') + ' ' + p.supplier.gstin) : null,
    p.buyerGstin ? h('div', { class: 'muted small' }, t('Your GSTIN') + ' ' + p.buyerGstin) : null,
    p.placeOfSupply ? h('div', { class: 'muted small' }, t('Place of supply') + ' ' + p.placeOfSupply) : null,
    h('div', { class: 'list' }, (p.lines || []).map((l) => liRow({ title: l.styleName, sub: [l.colour, l.size, l.hsn ? 'HSN ' + l.hsn : '', l.taxPct ? l.taxPct + '% GST' : ''].filter(Boolean).join(' · '), value: l.qty + ' × ' + inr(l.unitCost), valueSub: l.tax > 0 ? t('Tax') + ' ' + inr(l.tax) : '' }))),
    p.taxableValue > 0 ? h('div', { class: 'kv' }, h('span', null, t('Taxable value')), h('b', { class: 'num' }, inr(p.taxableValue))) : null,
    gstSplit && p.igst <= 0 ? h('div', { class: 'kv' }, h('span', null, 'CGST'), h('b', { class: 'num' }, inr(p.cgst))) : null,
    gstSplit && p.igst <= 0 ? h('div', { class: 'kv' }, h('span', null, 'SGST'), h('b', { class: 'num' }, inr(p.sgst))) : null,
    gstSplit && p.igst > 0 ? h('div', { class: 'kv' }, h('span', null, 'IGST'), h('b', { class: 'num' }, inr(p.igst))) : null,
    h('div', { class: 'kv' }, h('span', null, t('Total')), h('b', { class: 'num' }, inr(p.total))), h('div', { class: 'kv' }, h('span', null, t('Paid')), h('b', { class: 'num' }, inr(p.paid)))) });
}
function supplierForm(s, done) {
  const f = { name: input({ value: s ? s.name : '' }), phone: input({ value: s ? s.phone || '' : '', mode: 'tel' }), gstin: input({ value: s ? s.gstin || '' : '' }), contact: input({ value: s ? s.contact || '' : '' }),
    address: input({ value: s ? s.address || '' : '', placeholder: t('Optional') }), email: input({ type: 'email', value: s ? s.email || '' : '', placeholder: t('Optional') }), pan: input({ value: s ? s.pan || '' : '', placeholder: t('Optional') }),
    creditLimit: input({ type: 'number', mode: 'decimal', value: s && s.creditLimit ? s.creditLimit : '', placeholder: '0 = ' + t('no limit') }), creditDays: input({ type: 'number', mode: 'numeric', value: s && s.creditDays ? s.creditDays : '', placeholder: '0' }) };
  sheet({ title: s ? t('Edit supplier') : t('New supplier'), body: h('div', { class: 'grid' }, field(t('Name'), f.name), field(t('Phone'), f.phone), field(t('Email'), f.email), field(t('Contact person'), f.contact), field('GSTIN', f.gstin), gstFetchRow(f.gstin, (d) => { if (!f.name.value.trim()) f.name.value = d.trade_name || d.legal_name || ''; if (d.address) f.address.value = d.address; }),
    field(t('Address'), f.address), field('PAN', f.pan), h('div', { class: 'two' }, field(t('Credit limit') + ' ₹', f.creditLimit), field(t('Payment due in (days)'), f.creditDays))),
    actions: [{ label: t('Save'), primary: true, onclick: async (close) => { if (!f.name.value.trim()) { toast(t('Enter a name'), { err: true }); return false; }
      const r = await api('sty_save_supplier', { p: { id: s && s.id, newId: s ? undefined : uid(), name: f.name.value, phone: f.phone.value, gstin: f.gstin.value, contact: f.contact.value, address: f.address.value, email: f.email.value, pan: f.pan.value.trim().toUpperCase(), creditLimit: N(f.creditLimit.value), creditDays: Math.round(N(f.creditDays.value)) } });
      close(); done && done(r); } }] });
}
function supplierSheet(s, done) {
  const amt = input({ type: 'number', mode: 'decimal', value: s.due > 0 ? s.due : '', placeholder: '0' }), mode = selectEl([['cash', t('Cash')], ['upi', 'UPI'], ['bank', t('Bank')]], 'cash');
  sheet({ title: s.name, closeLabel: t('Done'), body: h('div', { class: 'grid' }, h('div', { class: 'kpis' }, kpi(t('Bought'), inr(s.bought, 0)), kpi(t('Paid'), inr(s.paid, 0)), kpi(t('Due'), inr(Math.max(s.due, 0), 0), '', null, s.due > 0 ? 'neg' : '')),
    s.due > 0 ? h('div', { class: 'grid' }, h('div', { class: 'two' }, field(t('Pay'), amt), field(t('Mode'), mode))) : null,
    h('button', { class: 'btn', type: 'button', onclick: () => supplierForm(s, done) }, icon('edit', 18), t('Edit supplier'))),
    actions: s.due > 0 ? [{ label: t('Record payment'), primary: true, onclick: async (close) => { if (!N(amt.value)) { toast(t('Enter an amount'), { err: true }); return false; } await api('sty_pay_supplier', { p: { supplierId: s.id, amount: N(amt.value), mode: mode.value } }); close(); toast(t('Payment saved')); done && done(); } }] : [] });
}

// ---- receive stock ----
async function receiveForm(o, done) {
  try { await loadCatalog(); } catch (e) { return fail(e); }
  let sups = []; try { sups = await api('sty_list_suppliers') || []; } catch { /* offline */ }
  const sup = selectEl([['', t('No supplier')], ...sups.map((s) => [s.id, s.name])], o.supplierId || '');
  const inv = input({ placeholder: t('Supplier invoice no.') }), paid = input({ type: 'number', mode: 'decimal', placeholder: '0' });
  sup.addEventListener('change', () => { sup.blur(); setTimeout(() => inv.focus(), 0); });
  const lines = []; const host = h('div', { class: 'list' }), totEl = h('div', { class: 'paytot' });
  const addVar = (x, qty = 0) => { if (lines.find((l) => l.variantId === x.id)) return; lines.push({ variantId: x.id, name: x.style.name, sub: [x.colour, x.size].filter(Boolean).join(' · '), qty, cost: S.ctx.canSeeCost ? (x.cost || x.style.cost || 0) : (x.style.cost || 0), stock: x.stock, hsn: x.style.hsn || '', taxPct: x.style.taxPct != null ? x.style.taxPct : (S.ctx.settings.defaultTaxPct || 0) }); };
  if (o.style) o.style.variants.filter((x) => x.active !== false).sort((a, b) => a.colour.localeCompare(b.colour) || byRank(a, b)).forEach((x) => addVar({ ...x, style: o.style }));
  const paintTot = () => {
    const taxable = lines.reduce((a, l) => a + l.qty * l.cost, 0);
    const tax = lines.reduce((a, l) => a + r2(l.qty * l.cost * (l.taxPct || 0) / 100), 0);
    clear(totEl).append(h('span', null, lines.reduce((a, l) => a + l.qty, 0) + ' ' + t('Units') + (tax > 0 ? ' · ' + t('GST') + ' ' + inr(tax, 0) : '')), h('b', { class: 'num' }, inr(taxable + tax)));
    return taxable + tax;
  };
  const paintHost = () => {
    clear(host).append(...(lines.length ? lines.map((l, i) => {
      const q = input({ type: 'number', mode: 'numeric', value: l.qty || '', placeholder: '0', oninput: () => { l.qty = Math.max(0, Math.round(N(q.value))); paintTot(); } }), c = input({ type: 'number', mode: 'decimal', value: l.cost || '', placeholder: t('Cost'), oninput: () => { l.cost = N(c.value); paintTot(); } });
      const hs = input({ value: l.hsn || '', placeholder: 'HSN' }), tp = input({ type: 'number', mode: 'decimal', value: l.taxPct || '', placeholder: t('GST') + ' %', oninput: () => { l.taxPct = N(tp.value); paintTot(); } });
      hs.oninput = () => { l.hsn = hs.value; };
      q.style.width = '70px'; c.style.width = '92px'; hs.style.width = '72px'; tp.style.width = '62px';
      return h('div', { class: 'li' }, h('div', { class: 'grow' }, h('div', { class: 't' }, l.name), h('div', { class: 's' }, l.sub + ' · ' + t('have') + ' ' + l.stock)), q, c, hs, tp, h('button', { class: 'btn plain icon', type: 'button', onclick: () => { lines.splice(i, 1); paintHost(); } }, icon('x', 16)));
    }) : [h('div', { class: 'muted small', style: { padding: '14px' } }, t('Search an item below to add it, or scan its tag.'))]));
    paintTot();
  };
  const res = h('div', { class: 'list' });
  const q = searchField(t('Add item: name or barcode'), () => paintRes());
  const scanVariant = (code) => {
    const match = findBarcode(code);
    if (!match || match.style.active === false || match.variant.active === false) return null;
    const existing = lines.find((line) => line.variantId === match.variant.id);
    if (existing) existing.qty += 1;
    else addVar({ ...match.variant, style: match.style }, 1);
    paintHost();
    const line = lines.find((entry) => entry.variantId === match.variant.id);
    return { text: match.style.name + ' · ' + t('Qty') + ': ' + line.qty };
  };
  const scanBtn = h('button', { class: 'btn icon', type: 'button', 'aria-label': t('Scan'), onclick: () => scanWith((code) => {
    const result = scanVariant(code);
    if (result) return result;
    const style = findStyleCode(code);
    if (!style || style.active === false) return { text: t('No item with that code'), bad: true };
    style.variants.filter((variant) => variant.active !== false).forEach((variant) => addVar({ ...variant, style }));
    paintHost();
    return { text: style.name };
  }) }, icon('camera', 18));
  q.input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' || !scanVariant(q.input.value)) return;
    event.preventDefault();
    q.input.value = '';
    clear(res);
  });
  const addAllOf = (st) => { st.variants.filter((x) => x.active !== false).sort((a, b) => a.colour.localeCompare(b.colour) || byRank(a, b)).forEach((x) => addVar({ ...x, style: st })); q.input.value = ''; paintRes(); paintHost(); };
  const newItem = () => { const before = new Set(S.cat.map((x) => x.id)); styleForm(null, async () => { try { await loadCatalog(true); } catch { /* offline */ } const fresh = S.cat.filter((x) => !before.has(x.id)); fresh.forEach(addAllOf); if (fresh.length) toast(t('Added to this stock entry. Enter the quantities.')); }); };
  const newBtn = can('sty_manage') || can('sty_stock') ? h('button', { class: 'btn', type: 'button', onclick: newItem }, icon('plus', 18), t('New item')) : null;
  function paintRes() {
    const k = q.input.value.trim().toLowerCase(); clear(res);
    if (k.length < 2) return;
    const seen = new Set();
    S.cat.filter((s) => (s.name + ' ' + (s.brand || '')).toLowerCase().includes(k)).slice(0, 6).forEach((s) => res.append(liRow({ icon: 'shirt', title: s.name, sub: t('Add all sizes') + ' · ' + s.variants.length, onclick: () => addAllOf(s) })));
    if (!res.children.length && newBtn) res.append(liRow({ icon: 'plus', title: t('New item') + ': ' + q.input.value.trim(), sub: t('Not in your list yet. Create it now.'), onclick: newItem }));
    allVariants().filter((x) => x.barcode === k).forEach((x) => res.append(liRow({ title: x.style.name, sub: [x.colour, x.size].join(' · '), onclick: () => { addVar(x, 1); q.input.value = ''; clear(res); paintHost(); } })));
  }
  paintHost();
  sheet({ title: t('Receive stock'), full: true, wide: true, body: h('div', { class: 'grid rcv' }, h('div', { class: 'two' }, field(t('Supplier'), sup), field(t('Invoice'), inv)), h('div', { class: 'row', style: { gap: '8px' } }, h('div', { class: 'grow' }, q), scanBtn, newBtn), res, host, totEl, field(t('Paid now'), paid)),
    actions: [{ label: t('Receive'), primary: true, onclick: async (close) => {
      const ls = lines.filter((l) => l.qty > 0); if (!ls.length) { toast(t('Enter a quantity for at least one item'), { err: true }); return false; }
      const total = ls.reduce((a, l) => a + l.qty * l.cost + r2(l.qty * l.cost * (l.taxPct || 0) / 100), 0);
      const r = await sendOrQueue('sty_receive', { p: { id: uid(), supplierId: sup.value || null, branchId: S.branch, invoiceNo: inv.value, paid: Math.min(N(paid.value), total), lines: ls.map((l) => ({ variantId: l.variantId, qty: l.qty, unitCost: l.cost, hsn: l.hsn || undefined, taxPct: l.taxPct || undefined })) } });
      close(); S.catAt = 0; toast(r.done ? t('Stock received') : t('Saved on this device')); done && done();
      if (r.done) { await loadCatalog(true).catch(() => {}); }
    } },
    { label: t('Receive & print tags'), onclick: async (close) => {
      const ls = lines.filter((l) => l.qty > 0); if (!ls.length) { toast(t('Enter a quantity for at least one item'), { err: true }); return false; }
      const total = ls.reduce((a, l) => a + l.qty * l.cost + r2(l.qty * l.cost * (l.taxPct || 0) / 100), 0);
      const r = await sendOrQueue('sty_receive', { p: { id: uid(), supplierId: sup.value || null, branchId: S.branch, invoiceNo: inv.value, paid: Math.min(N(paid.value), total), lines: ls.map((l) => ({ variantId: l.variantId, qty: l.qty, unitCost: l.cost, hsn: l.hsn || undefined, taxPct: l.taxPct || undefined })) } });
      close(); S.catAt = 0; toast(r.done ? t('Stock received') : t('Saved on this device')); done && done();
      await loadCatalog(true).catch(() => {});
      const preset = {}; ls.forEach((l) => { preset[l.variantId] = l.qty; });
      const sts = S.cat.filter((z) => z.variants.some((vv) => preset[vv.id])); if (sts.length) tagsSheet(sts, Object.keys(preset), preset);
    } }] });
}

page('supplier', {
  title: 'Supplier account', perm: 'sty_purchase',
  async render(v) {
    let active = true;
    v.onLeave(() => { active = false; });
    const suppliers = await api('sty_list_suppliers') || [];
    if (!active) return;
    const supplier = suppliers.find((entry) => entry.id === v.args[0]);
    if (!supplier) throw new Error(t('Supplier not found'));
    const back = 'buy?tab=' + (v.q.get('from') === 'parties' ? 'parties' : 'suppliers');
    v.header({ title: supplier.name, back, actions: [
      { label: t('Receive stock'), icon: 'plus', primary: true, run: () => receiveForm({ supplierId: supplier.id }, v.refresh) },
      { label: t('Pay supplier'), icon: 'cash', run: () => supplierSheet(supplier, v.refresh) },
      { label: t('Edit supplier'), icon: 'edit', run: () => supplierForm(supplier, v.refresh) },
    ] });
    const fields = [supplier.contact, supplier.phone, supplier.email, supplier.gstin, supplier.address].filter(Boolean);
    v.root.append(h('div', { class: 'card grid' },
      h('strong', null, t('Supplier account')),
      fields.length ? h('div', { class: 'muted small' }, fields.join(' · ')) : null,
      h('div', { class: 'muted small' }, t('Payment terms') + ' · ' + (supplier.creditDays || 0) + ' ' + t('days') +
        (supplier.creditLimit > 0 ? ' · ' + t('Credit limit') + ' ' + inr(supplier.creditLimit) : ''))));
    const host = h('div', { class: 'grid style-party-detail' });
    v.root.append(host);
    await renderSupplierAccount(host, supplier, () => active);
  },
});
async function renderSupplierAccount(host, supplier, active) {
  clear(host).append(h('div', { class: 'spin' }));
  const sample = location.origin === 'http://127.0.0.1:4204' &&
    new URLSearchParams(location.search).get('supplierPreview') === '1';
  let account;
  try {
    account = sample ? (await import('./supplier-account-preview.js')).supplierAccountSample
      : await api('sty_supplier_account', { p_id: supplier.id });
  }
  catch (error) {
    if (active()) clear(host).append(empty('cloudOff', t('Could not load supplier account'), error.message,
      h('button', { class: 'btn', type: 'button', onclick: () => renderSupplierAccount(host, supplier, active) }, t('Try again'))));
    return;
  }
  if (!active()) return;
  const records = h('div', { class: 'list' });
  const invoices = account.invoices;
  const invoiceRow = (invoice) => {
    const balance = Math.max(0, invoice.total - invoice.paid);
    return liRow({ icon: 'tag', title: invoice.reference || t('Stock receipt'),
      sub: fmtDT(invoice.at) + ' · ' + invoice.units + ' ' + t('Units'), value: inr(invoice.total),
      valueSub: balance ? t('Due') + ' ' + inr(balance) : t('Paid'), chevron: true,
      onclick: () => sample ? openRecord(t('Sample purchase'), [['Invoice', invoice.reference], ['Item', invoice.item],
        ['Units', invoice.units], ['Total', inr(invoice.total)], ['Paid', inr(invoice.paid)]]) : purchaseSheet(invoice) });
  };
  const openRecord = (title, fields, purchaseId) => sheet({ title, closeLabel: t('Done'),
    body: h('div', { class: 'grid' }, h('dl', { class: 'style-party-fields' }, fields
      .filter(([, value]) => value != null && value !== '')
      .map(([label, value]) => h('div', null, h('dt', null, t(label)), h('dd', null, String(value)))))),
    actions: purchaseId && !sample ? [{ label: t('Open purchase'), onclick: (close) => { close(); purchaseSheet({ id: purchaseId }); } }] : [] });
  const tabs = [
    ['invoices', t('Invoices and receipts')], ['due', t('Due invoices')], ['payments', t('Payments')],
    ['quotation', t('Quotations')], ['credit', t('Credit notes')], ['debit', t('Debit notes')],
    ['statement', t('Statement')], ['ageing', t('Ageing')],
  ];
  function show(tab) {
    let rows;
    if (tab === 'invoices' || tab === 'due') {
      rows = invoices.filter((invoice) => tab === 'invoices' || invoice.total > invoice.paid).map(invoiceRow);
    } else if (tab === 'ageing') {
      const today = rangeFor('today').to;
      const groups = [0, 0, 0, 0, 0];
      for (const invoice of invoices) {
        if (invoice.total <= invoice.paid) continue;
        const days = Math.floor((Date.parse(today) - Date.parse(invoice.at.slice(0, 10))) / 86400000) - (supplier.creditDays || 0);
        groups[days <= 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : 4] += invoice.total - invoice.paid;
      }
      rows = [h('p', { class: 'muted small' }, t('Ageing uses invoice dates and the supplier’s current payment terms.')),
        ...['Not yet due', '1–30 days overdue', '31–60 days overdue', '61–90 days overdue', 'Over 90 days overdue']
          .map((label, index) => liRow({ title: t(label), value: inr(groups[index]) }))];
    } else if (tab === 'statement') {
      const entries = [
        ...invoices.map((invoice) => ({ at: invoice.at, amount: invoice.total, invoice })),
        ...account.payments.map((payment) => ({ at: payment.at, amount: -payment.amount })),
      ].sort((a, b) => a.at.localeCompare(b.at) || b.amount - a.amount);
      let running = 0;
      rows = entries.map((entry) => {
        running = r2(running + entry.amount);
        return liRow({ title: entry.invoice?.reference || t(entry.invoice ? 'Stock receipt' : 'Supplier payment'),
          sub: fmtDT(entry.at) + ' · ' + inr(entry.amount), value: inr(running), valueSub: t('Running balance'),
          chevron: !!entry.invoice && !sample, onclick: entry.invoice && !sample ? () => purchaseSheet(entry.invoice) : null });
      }).reverse();
    } else if (tab === 'payments') {
      rows = account.payments.map((payment) => liRow({ icon: 'cash', title: payment.reference || t('Supplier payment'),
        sub: fmtDT(payment.at) + ' · ' + t(payment.mode), value: inr(payment.amount), chevron: true,
        onclick: () => openRecord(t('Supplier payment'), [['Date', fmtDT(payment.at)], ['Amount', inr(payment.amount)],
          ['Mode', t(payment.mode)], ['Invoice', payment.reference], ['Notes', payment.note]], payment.purchase_id) }));
    } else {
      rows = account.notes.filter((note) => note.kind === tab).map((note) => liRow({ icon: 'tag', title: note.reference,
        sub: note.issued_on + (note.invoice_reference ? ' · ' + note.invoice_reference : ''), value: inr(note.amount), chevron: true,
        onclick: () => openRecord(t(supplierDocumentLabel(note.kind)), [
          ['Reference', note.reference], ['Date', note.issued_on], ['Amount', inr(note.amount)],
          ['Invoice', note.invoice_reference], ['Reason', note.reason]], note.purchase_id) }));
    }
    clear(records).append(...(rows.length ? rows : [empty('book', t('No records yet'))]));
  }
  const balance = r2(account.bought - account.paid);
  clear(host).append(h('div', { class: 'kpis' },
    kpi(t('Bought'), inr(account.bought)), kpi(t('Paid'), inr(account.paid)),
    kpi(t(balance < 0 ? 'Supplier advance' : 'Outstanding'), inr(Math.abs(balance))),
    kpi(t('Credit notes'), inr(account.creditNotes)), kpi(t('Debit notes'), inr(account.debitNotes))),
    sample ? h('p', { class: 'muted small' }, t('Sample supplier account · read-only')) : null,
    h('div', { class: 'row wrap', style: { gap: '8px' } }, ['quotation', 'credit', 'debit'].map((kind) =>
      h('button', { class: 'btn', type: 'button', disabled: sample, onclick: () => supplierNoteForm(supplier, invoices, kind,
        () => { if (active()) renderSupplierAccount(host, supplier, active); }) },
      icon('plus', 18), t('Record ' + supplierDocumentLabel(kind).toLowerCase())))),
    h('p', { class: 'muted small' }, t('Recorded notes are for reference. They do not change invoice balances, GST totals, or stock.')),
    seg(tabs, 'invoices', show, { full: true }), records);
  show('invoices');
}
function supplierDocumentLabel(kind) {
  return { quotation: 'Quotation', credit: 'Credit note', debit: 'Debit note' }[kind];
}
function supplierNoteForm(supplier, invoices, kind, done) {
  const id = uid();
  const reference = input({ max: 120 });
  const issuedOn = input({ type: 'date', value: rangeFor('today').to });
  const purchase = selectEl([['', t('No linked purchase')], ...invoices.map((invoice) =>
    [invoice.id, (invoice.reference || t('Stock receipt')) + ' · ' + fmtDT(invoice.at)])], '');
  const amount = input({ type: 'number', mode: 'decimal' });
  const reason = h('textarea', { class: 'textarea', maxlength: 2000 });
  sheet({ title: t('Record ' + supplierDocumentLabel(kind).toLowerCase()),
    body: h('div', { class: 'grid' }, field(t('Reference'), reference), field(t('Date'), issuedOn),
      field(t('Purchase'), purchase), field(t('Amount'), amount), field(t('Reason'), reason)),
    actions: [{ label: t('Save'), primary: true, onclick: async (close) => {
      if (!reference.value.trim() || !issuedOn.value || r2(N(amount.value)) <= 0 || !reason.value.trim()) {
        toast(t('Enter a reference, date, positive amount and reason'), { err: true });
        return false;
      }
      await api('sty_save_supplier_note', { p: { id, supplierId: supplier.id, purchaseId: purchase.value,
        kind, reference: reference.value.trim(), amount: r2(N(amount.value)), reason: reason.value.trim(), issuedOn: issuedOn.value } });
      close(); done();
    } }] });
}
