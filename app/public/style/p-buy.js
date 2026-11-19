/* AUZsStyle: Buy. Purchases (receive stock by size run, weighted-average cost) and suppliers (what you owe). */
'use strict';
const BR = { k: '30', from: null, to: null };
page('buy', {
  title: 'Buy', perm: 'sty_purchase',
  async render(v) {
    const tab = v.q.get('tab') || 'purchases';
    v.header({ title: t('Buy'), actions: [{ label: t('Receive stock'), icon: 'plus', primary: true, run: () => receiveForm({}, () => v.refresh()) }] });
    const root = v.root;
    root.append(seg([['purchases', t('Purchases')], ['suppliers', t('Suppliers')], ['register', t('Purchase register')]], tab, (x) => go('buy?tab=' + x), { full: true }));
    const host = h('div'); root.append(host);
    host.append(h('div', { class: 'spin', style: { color: 'var(--tint)', margin: '24px auto' } }));
    if (tab === 'suppliers') {
      const list = await api('sty_list_suppliers') || [];
      const owe = list.reduce((a, s) => a + Math.max(s.due, 0), 0);
      clear(host).append(h('div', { class: 'grid' }, h('div', { class: 'kpis' }, kpi(t('You owe suppliers'), inr(owe, 0), list.filter((s) => s.due > 0).length + ' ' + t('suppliers'), null, owe > 0 ? 'neg' : ''), kpi(t('Suppliers'), list.length)),
        h('button', { class: 'btn', type: 'button', onclick: () => supplierForm(null, () => v.refresh()) }, icon('plus', 18), t('New supplier')),
        h('div', { class: 'list' }, list.length ? list.map((s) => liRow({ icon: 'truck', title: s.name, sub: [s.phone, s.lastAt ? t('Last') + ' ' + fmtDay(s.lastAt) : ''].filter(Boolean).join(' · '), value: s.due > 0 ? inr(s.due) : t('Settled'), valueSub: s.due > 0 ? t('Due') : '', chevron: true, onclick: () => supplierSheet(s, () => v.refresh()) })) : [empty('truck', t('No suppliers yet'), t('Add the people you buy from to track what you owe.'))])));
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
  let p = p0; try { p = await api('sty_purchase_detail', { p_id: p0.id }) || p0; } catch (e) { /* show the summary we already have */ }
  const gstSplit = (p.cgst > 0 || p.sgst > 0 || p.igst > 0);
  sheet({ title: (p.supplier ? p.supplier.name : t('Purchase')) + (p.invoiceNo ? ' · ' + p.invoiceNo : ''), closeLabel: t('Done'), body: h('div', { class: 'grid' },
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
  const f = { name: input({ value: s ? s.name : '' }), phone: input({ value: s ? s.phone || '' : '', mode: 'tel' }), gstin: input({ value: s ? s.gstin || '' : '' }), contact: input({ value: s ? s.contact || '' : '' }) };
  sheet({ title: s ? t('Edit supplier') : t('New supplier'), body: h('div', { class: 'grid' }, field(t('Name'), f.name), field(t('Phone'), f.phone), field(t('Contact person'), f.contact), field('GSTIN', f.gstin), gstFetchRow(f.gstin, (d) => { if (!f.name.value.trim()) f.name.value = d.trade_name || d.legal_name || ''; })),
    actions: [{ label: t('Save'), primary: true, onclick: async (close) => { if (!f.name.value.trim()) { toast(t('Enter a name'), { err: true }); return false; } const r = await api('sty_save_supplier', { p: { id: s && s.id, newId: s ? undefined : uid(), name: f.name.value, phone: f.phone.value, gstin: f.gstin.value, contact: f.contact.value } }); close(); done && done(r); } }] });
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
  const sup = selectEl([['', t('No supplier')], ...sups.map((s) => [s.id, s.name])], '');
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
  const scanBtn = h('button', { class: 'btn icon', type: 'button', 'aria-label': t('Scan'), onclick: () => scanWith((c) => { const f = findBarcode(c); if (f) { addVar({ ...f.variant, style: f.style }, 1); paintHost(); } else { const sc = findStyleCode(c); if (sc) { sc.variants.filter((x) => x.active !== false).forEach((x) => addVar({ ...x, style: sc })); paintHost(); } else toast(t('No item with that code'), { err: true }); } }) }, icon('camera', 18));
  q.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const f = findBarcode(q.input.value); if (f) { addVar({ ...f.variant, style: f.style }, 1); q.input.value = ''; clear(res); paintHost(); } } });
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
