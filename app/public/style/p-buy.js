/* AUZsStyle: Buy. Purchases (receive stock by size run, weighted-average cost) and suppliers (what you owe). */
'use strict';
page('buy', {
  title: 'Buy', perm: 'sty_purchase',
  async render(v) {
    const tab = v.q.get('tab') || 'purchases';
    v.header({ title: t('Buy'), actions: [{ label: t('Receive stock'), icon: 'plus', primary: true, run: () => receiveForm({}, () => v.refresh()) }] });
    const root = v.root;
    root.append(seg([['purchases', t('Purchases')], ['suppliers', t('Suppliers')]], tab, (x) => go('buy?tab=' + x), { full: true }));
    const host = h('div'); root.append(host);
    host.append(h('div', { class: 'spin', style: { color: 'var(--tint)', margin: '24px auto' } }));
    if (tab === 'suppliers') {
      const list = await api('sty_list_suppliers') || [];
      const owe = list.reduce((a, s) => a + Math.max(s.due, 0), 0);
      clear(host).append(h('div', { class: 'grid' }, h('div', { class: 'kpis' }, kpi(t('You owe suppliers'), inr(owe, 0), list.filter((s) => s.due > 0).length + ' ' + t('suppliers'), null, owe > 0 ? 'neg' : ''), kpi(t('Suppliers'), list.length)),
        h('button', { class: 'btn', type: 'button', onclick: () => supplierForm(null, () => v.refresh()) }, icon('plus', 18), t('New supplier')),
        h('div', { class: 'list' }, list.length ? list.map((s) => liRow({ icon: 'truck', title: s.name, sub: [s.phone, s.lastAt ? t('Last') + ' ' + fmtDay(s.lastAt) : ''].filter(Boolean).join(' · '), value: s.due > 0 ? inr(s.due) : t('Settled'), valueSub: s.due > 0 ? t('Due') : '', chevron: true, onclick: () => supplierSheet(s, () => v.refresh()) })) : [empty('truck', t('No suppliers yet'), t('Add the people you buy from to track what you owe.'))])));
    } else {
      const list = await api('sty_list_purchases', { p_limit: 60 }) || [];
      const total = list.reduce((a, p) => a + p.total, 0), unpaid = list.reduce((a, p) => a + (p.total - p.paid), 0);
      clear(host).append(h('div', { class: 'grid' }, h('div', { class: 'kpis' }, kpi(t('Bought'), inr(total, 0), list.length + ' ' + t('purchases')), kpi(t('Unpaid'), inr(unpaid, 0), '', null, unpaid > 0 ? 'neg' : '')),
        h('div', { class: 'list' }, list.length ? list.map((p) => liRow({ icon: 'box', title: (p.supplier || t('No supplier')) + (p.invoiceNo ? ' · ' + p.invoiceNo : ''), sub: fmtDT(p.at) + ' · ' + p.units + ' ' + t('Units'), value: inr(p.total), valueSub: p.status === 'paid' ? t('Paid') : p.status === 'part' ? t('Part paid') : t('Unpaid'), chevron: true, onclick: () => purchaseSheet(p) })) : [empty('box', t('No purchases yet'), t('Receive stock to see it here.'))])));
    }
  },
});
function purchaseSheet(p) {
  sheet({ title: (p.supplier || t('Purchase')) + (p.invoiceNo ? ' · ' + p.invoiceNo : ''), closeLabel: t('Done'), body: h('div', { class: 'grid' }, h('div', { class: 'kv' }, h('span', null, t('Total')), h('b', { class: 'num' }, inr(p.total))), h('div', { class: 'kv' }, h('span', null, t('Paid')), h('b', { class: 'num' }, inr(p.paid))),
    h('div', { class: 'list' }, p.lines.map((l) => liRow({ title: l.style, sub: [l.colour, l.size].filter(Boolean).join(' · '), value: l.qty + ' × ' + inr(l.unitCost) })))) });
}
function supplierForm(s, done) {
  const f = { name: input({ value: s ? s.name : '' }), phone: input({ value: s ? s.phone || '' : '', mode: 'tel' }), gstin: input({ value: s ? s.gstin || '' : '' }), contact: input({ value: s ? s.contact || '' : '' }) };
  sheet({ title: s ? t('Edit supplier') : t('New supplier'), body: h('div', { class: 'grid' }, field(t('Name'), f.name), field(t('Phone'), f.phone), field(t('Contact person'), f.contact), field('GSTIN', f.gstin)),
    actions: [{ label: t('Save'), primary: true, onclick: async (close) => { if (!f.name.value.trim()) { toast(t('Enter a name'), { err: true }); return false; } const r = await api('sty_save_supplier', { p: { id: s && s.id, name: f.name.value, phone: f.phone.value, gstin: f.gstin.value, contact: f.contact.value } }); close(); done && done(r); } }] });
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
  const lines = []; const host = h('div', { class: 'list' }), totEl = h('div', { class: 'paytot' });
  const addVar = (x, qty = 0) => { if (lines.find((l) => l.variantId === x.id)) return; lines.push({ variantId: x.id, name: x.style.name, sub: [x.colour, x.size].filter(Boolean).join(' · '), qty, cost: S.ctx.canSeeCost ? (x.cost || x.style.cost || 0) : (x.style.cost || 0), stock: x.stock }); };
  if (o.style) o.style.variants.filter((x) => x.active !== false).sort((a, b) => a.colour.localeCompare(b.colour) || byRank(a, b)).forEach((x) => addVar({ ...x, style: o.style }));
  const paintTot = () => { const tot = lines.reduce((a, l) => a + l.qty * l.cost, 0); clear(totEl).append(h('span', null, lines.reduce((a, l) => a + l.qty, 0) + ' ' + t('Units')), h('b', { class: 'num' }, inr(tot))); return tot; };
  const paintHost = () => {
    clear(host).append(...(lines.length ? lines.map((l, i) => {
      const q = input({ type: 'number', mode: 'numeric', value: l.qty || '', placeholder: '0', oninput: () => { l.qty = Math.max(0, Math.round(N(q.value))); paintTot(); } }), c = input({ type: 'number', mode: 'decimal', value: l.cost || '', placeholder: t('Cost'), oninput: () => { l.cost = N(c.value); paintTot(); } });
      q.style.width = '70px'; c.style.width = '92px';
      return h('div', { class: 'li' }, h('div', { class: 'grow' }, h('div', { class: 't' }, l.name), h('div', { class: 's' }, l.sub + ' · ' + t('have') + ' ' + l.stock)), q, c, h('button', { class: 'btn plain icon', type: 'button', onclick: () => { lines.splice(i, 1); paintHost(); } }, icon('x', 16)));
    }) : [h('div', { class: 'muted small', style: { padding: '14px' } }, t('Search an item below to add it, or scan its tag.'))]));
    paintTot();
  };
  const res = h('div', { class: 'list' });
  const q = searchField(t('Add item: name or barcode'), () => paintRes());
  q.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const f = findBarcode(q.input.value); if (f) { addVar({ ...f.variant, style: f.style }, 1); q.input.value = ''; clear(res); paintHost(); } } });
  function paintRes() {
    const k = q.input.value.trim().toLowerCase(); clear(res); if (k.length < 2) return;
    const seen = new Set();
    S.cat.filter((s) => (s.name + ' ' + (s.brand || '')).toLowerCase().includes(k)).slice(0, 6).forEach((s) => res.append(liRow({ icon: 'shirt', title: s.name, sub: t('Add all sizes') + ' · ' + s.variants.length, onclick: () => { s.variants.filter((x) => x.active !== false).sort((a, b) => a.colour.localeCompare(b.colour) || byRank(a, b)).forEach((x) => addVar({ ...x, style: s })); q.input.value = ''; clear(res); paintHost(); } })));
    allVariants().filter((x) => x.barcode === k).forEach((x) => res.append(liRow({ title: x.style.name, sub: [x.colour, x.size].join(' · '), onclick: () => { addVar(x, 1); q.input.value = ''; clear(res); paintHost(); } })));
  }
  paintHost();
  sheet({ title: t('Receive stock'), full: true, wide: true, body: h('div', { class: 'grid' }, h('div', { class: 'two' }, field(t('Supplier'), sup), field(t('Invoice'), inv)), q, res, host, totEl, field(t('Paid now'), paid)),
    actions: [{ label: t('Receive'), primary: true, onclick: async (close) => {
      const ls = lines.filter((l) => l.qty > 0); if (!ls.length) { toast(t('Enter a quantity for at least one item'), { err: true }); return false; }
      const total = ls.reduce((a, l) => a + l.qty * l.cost, 0);
      const r = await sendOrQueue('sty_receive', { p: { id: uid(), supplierId: sup.value || null, branchId: S.branch, invoiceNo: inv.value, paid: Math.min(N(paid.value), total), lines: ls.map((l) => ({ variantId: l.variantId, qty: l.qty, unitCost: l.cost })) } });
      close(); S.catAt = 0; toast(r.done ? t('Stock received') : t('Saved on this device')); done && done();
      if (r.done) { await loadCatalog(true).catch(() => {}); }
    } }] });
}
