/* AUZsStyle: Bills. Find a bill, reprint, share, take a return or exchange back, or cancel it (manager). */
'use strict';
const BU = { k: 'today', from: null, to: null, q: '', status: '', src: 'shop' };
page('bills', {
  title: 'Bills', perm: 'sty_view',
  async render(v) {
    v.header({ title: t('Bills') });
    Object.assign(BU, rangeFor(BU.k, BU.from ? { from: BU.from, to: BU.to } : null));
    const custId = v.q.get('customer') || '';
    const list = h('div', { class: 'list' }), kp = h('div', { class: 'kpis' });
    async function load() {
      clear(list).append(h('div', { class: 'spin', style: { color: 'var(--tint)', margin: '20px auto' } }));
      if (BU.src === 'web') return loadWeb();
      let rows = []; try { rows = await api('sty_list_sales', { p: { from: custId ? '' : BU.from, to: custId ? '' : BU.to, q: BU.q, status: BU.status, customerId: custId, limit: 200 } }) || []; } catch (e) { return clear(list).append(empty('cloudOff', t('Could not load'), e.message)); }
      const live = rows.filter((r) => r.status !== 'void'), tot = live.reduce((a, r) => a + r.total, 0);
      clear(kp).append(kpi(t('Sales'), inr(tot, 0), live.length + ' ' + t('Bills')), kpi(t('Due'), inr(live.reduce((a, r) => a + Math.max(r.total - r.paid, 0), 0), 0), '', null, ''));
      clear(list).append(...(rows.length ? rows.map((r) => liRow({ icon: r.status === 'void' ? 'x' : 'tag', title: r.number + (r.customer ? ' · ' + r.customer : ''), sub: fmtDT(r.at) + ' · ' + r.units + ' ' + t('Units') + (r.staff ? ' · ' + r.staff : ''), value: inr(r.total), valueSub: r.status === 'void' ? t('Cancelled') : r.status === 'due' ? t('Due') + ' ' + inr(r.total - r.paid) : '', chevron: !r.waiting, onclick: () => (r.waiting ? toast(t('This bill is saved on this device and will be sent when the connection is back.')) : billSheet(r.id, load)) })) : [empty('tag', t('No bills'), t('Bills show here as you sell.'))]));
    }
    const WST = { new: 'New', confirmed: 'Confirmed', packed: 'Packed', shipped: 'Shipped', delivered: 'Delivered', cancelled: 'Cancelled' };
    async function loadWeb() {
      let rows = []; try { rows = await api('sty_web_orders_list', { p: {} }) || []; } catch (e) { return clear(list).append(empty('cloudOff', t('Could not load'), e.message)); }
      const q = BU.q.trim().toLowerCase();
      if (q) rows = rows.filter((r) => (r.number + ' ' + (r.customer.name || '') + ' ' + (r.customer.phone || '')).toLowerCase().includes(q));
      const live = rows.filter((r) => r.status !== 'cancelled');
      clear(kp).append(kpi(t('Website orders'), inr(live.reduce((a, r) => a + r.total, 0), 0), live.length + ' ' + t('Orders')), kpi(t('New'), String(rows.filter((r) => r.status === 'new').length), '', null, ''));
      clear(list).append(...(rows.length ? rows.map((r) => liRow({ icon: 'globe', title: r.number + ' · ' + r.customer.name, sub: fmtDT(r.createdAt) + ' · ' + r.lines.reduce((a, l) => a + l.qty, 0) + ' ' + t('Units') + (r.saleNo ? ' · ' + t('Bill') + ' ' + r.saleNo : ''), value: inr(r.total), valueSub: t(WST[r.status] || r.status) + (r.paymentStatus === 'paid' ? ' · ' + t('Paid') : ''), chevron: true, onclick: () => orderSheet(r, load) })) : [empty('globe', t('No website orders'), t('Orders from your online store show here.'))]));
    }
    const srcSeg = seg([['shop', t('Shop bills')], ['web', t('Website orders')]], BU.src, (x) => { BU.src = x; v.refresh(); }, { full: true });
    v.root.append(h('div', { class: 'grid' }, srcSeg, custId ? banner('', 'user', t('Bills of one customer'), ' ', h('button', { class: 'btn plain sm', onclick: () => go('bills') }, t('Show all'))) : (BU.src === 'web' ? null : rangePicker(BU, load)),
      searchField(t('Bill number, customer, phone'), debounce((x) => { BU.q = x; load(); }, 250), BU.q), kp, list));
    load();
  },
});
async function billSheet(id, changed) {
  let sale; try { sale = await api('sty_get_sale', { p_id: id }); } catch (e) { return fail(e); }
  if (!sale) return;
  const open = sale.status !== 'void';
  const s = sheet({ title: sale.number, closeLabel: t('Done'), body: h('div', { class: 'grid' }, sale.status === 'void' ? banner('warn', 'alert', t('Cancelled') + (sale.voidReason ? ': ' + sale.voidReason : '')) : null,
    receiptNode(sale),
    sale.returns && sale.returns.length ? section(t('Returns'), h('div', { class: 'list' }, sale.returns.map((r) => liRow({ icon: 'swap', title: inr(r.refund), sub: fmtDT(r.at) + ' · ' + r.mode + (r.reason ? ' · ' + r.reason : '') })))) : null,
    h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
      h('button', { class: 'btn', type: 'button', onclick: () => printReceipt(sale) }, icon('print', 18), t('Print')),
      h('button', { class: 'btn', type: 'button', onclick: () => shareWa(sale) }, icon('share', 18), t('WhatsApp')),
      open && sale.lines.some((l) => l.qty > l.returned) ? h('button', { class: 'btn', type: 'button', onclick: () => { s.close(); returnSheet(sale, changed); } }, icon('swap', 18), t('Return or exchange')) : null,
      open && sale.status === 'due' && sale.customer ? h('button', { class: 'btn', type: 'button', onclick: () => { s.close(); collectDue(sale, changed); } }, icon('cash', 18), t('Collect due')) : null,
      open && can('sty_manage') ? h('button', { class: 'btn', type: 'button', onclick: () => { s.close(); editBill(sale, changed); } }, icon('edit', 18), t('Edit details')) : null,
      open && can('sty_manage') && (sale.payments || []).length ? h('button', { class: 'btn', type: 'button', onclick: () => { s.close(); correctPaymentSheet(sale, changed); } }, icon('cash', 18), t('Correct payment mode')) : null,
      open && can('sty_manage') && !(sale.returns || []).length ? h('button', { class: 'btn danger', type: 'button', onclick: async () => { const r = await cancelSheet(); if (!r) return; await api('sty_void_sale', { p_id: sale.id, p_reason: r.reason, p_restock: r.restock }); s.close(); S.catAt = 0; toast(r.restock ? t('Bill cancelled, items put back in stock') : t('Bill cancelled')); changed && changed(); } }, icon('trash', 18), t('Cancel bill')) : null,
      !open && can('sty_manage') ? h('button', { class: 'btn danger', type: 'button', onclick: async () => { if (!await confirmBox(t('Delete this bill?'), t('It is removed for good, with its stock entries. This cannot be undone.'), t('Delete'), true)) return; try { await api('sty_delete_sale', { p_id: sale.id }); } catch (e) { return fail(e); } s.close(); S.catAt = 0; toast(t('Bill deleted')); changed && changed(); } }, icon('trash', 18), t('Delete bill')) : null)) });
}
// cancel: a reason, and whether the items go back into stock (leave it unticked for goods that are damaged or lost)
function cancelSheet() {
  return new Promise((res) => {
    const i = input({ placeholder: t('Reason') }); const back = h('input', { type: 'checkbox', checked: true });
    sheet({ title: t('Cancel this bill?'), onClose: (v) => { if (v === undefined) res(null); }, body: h('div', { class: 'grid' }, field(t('Reason'), i),
      h('label', { class: 'swrow' }, h('div', { class: 'grow' }, h('div', null, t('Put the items back in stock')), h('div', { class: 'muted small' }, t('Untick if the goods are damaged or lost'))), back)),
      actions: [{ label: t('Confirm'), danger: true, onclick: (close) => { res({ reason: i.value.trim(), restock: back.checked }); close('ok'); } }] });
  });
}
// change who the bill was for and its note (amounts and items stay as billed)
function editBill(sale, changed) {
  const nm = input({ value: sale.customer ? sale.customer.name || '' : '', placeholder: t('Customer name') }), ph = input({ value: sale.customer ? sale.customer.phone || '' : '', mode: 'tel', placeholder: t('Phone') });
  const note = h('textarea', { class: 'textarea', rows: 2 }, sale.note || '');
  sheet({ title: t('Edit') + ' ' + sale.number, body: h('div', { class: 'grid' }, field(t('Customer name'), nm), field(t('Phone'), ph), field(t('Note'), note), h('div', { class: 'hint' }, t('Items and amounts stay as billed. To change those, cancel the bill and make a new one.'))),
    actions: [{ label: t('Save'), primary: true, onclick: async (close) => {
      try { await api('sty_edit_sale', { p_id: sale.id, p: { customerName: nm.value, customerPhone: ph.value, note: note.value } }); } catch (e) { fail(e); return false; }
      close(); S.catAt = 0; toast(t('Saved')); changed && changed();
    } }] });
}
// Fix which payment method(s) a bill is attributed to -- e.g. a cashier picked UPI but it got saved as Cash.
// Deliberately narrow: the corrected amounts must add up to exactly the same total as before, so this can
// never change what the bill was actually billed for, only which method(s) it's recorded under.
function correctPaymentSheet(sale, done) {
  const ALL = [['cash', t('Cash')], ['upi', t('UPI')], ['card', t('Card')], ['exchange', t('Exchange credit')], ['credit', t('Store credit')]];
  const present = new Set((sale.payments || []).map((p) => p.mode));
  const MODES = ALL.filter(([m]) => m === 'cash' || m === 'upi' || m === 'card' || present.has(m));
  const start = {}; MODES.forEach(([m]) => start[m] = 0);
  (sale.payments || []).forEach((p) => { start[p.mode] = r2((start[p.mode] || 0) + N(p.amount)); });
  const origTotal = r2((sale.payments || []).reduce((a, p) => a + N(p.amount), 0));
  const pay = { ...start };
  const rows = h('div', { class: 'grid' }), sum = h('div', { class: 'tot2' }); const inputs = {};
  const sumNow = () => MODES.reduce((a, [m]) => a + (pay[m] || 0), 0);
  const upd = () => {
    const s2 = r2(sumNow()), diff = r2(s2 - origTotal);
    clear(sum).append(h('span', null, diff === 0 ? t('Matches the original total') : t('Must match the original total')), h('b', { class: 'num' + (diff === 0 ? '' : ' neg') }, inr(s2) + (diff === 0 ? '' : ' / ' + inr(origTotal))));
    ok.disabled = diff !== 0;
  };
  MODES.forEach(([m, l]) => {
    const i = input({ type: 'number', value: pay[m] || '', mode: 'decimal', placeholder: '0', oninput: () => { pay[m] = N(i.value); upd(); } }); inputs[m] = i;
    rows.append(field(l, i));
  });
  const ok = h('button', { class: 'btn fill', type: 'button', onclick: async () => {
    const payments = MODES.map(([m]) => ({ mode: m, amount: pay[m] })).filter((p) => p.amount > 0);
    try { await api('sty_correct_payment_mode', { p_id: sale.id, p_payments: payments }); } catch (e) { return fail(e); }
    sh.close(); toast(t('Payment method corrected')); done && done();
  } }, t('Save correction'));
  const sh = sheet({ title: t('Correct payment mode') + ' · ' + sale.number, body: h('div', { class: 'grid' },
    h('div', { class: 'muted small' }, t('Fix which method(s) this bill is attributed to -- the corrected amounts must add up to the original total; the bill itself, its items and stock are unchanged.')),
    rows, sum), actions: [] });
  sh.el.querySelector('.sheet-f') || sh.el.append(h('div', { class: 'sheet-f' }));
  sh.el.querySelector('.sheet-f').append(ok);
  upd();
}
function promptReason(title) {
  return new Promise((res) => { const i = input({ placeholder: t('Reason') }); sheet({ title, onClose: (v) => { if (v === undefined) res(null); }, body: h('div', { class: 'grid' }, field(t('Reason'), i)), actions: [{ label: t('Confirm'), danger: true, onclick: (close) => { res(i.value.trim()); close('ok'); } }] }); });
}
function collectDue(sale, done) {
  const amt = input({ type: 'number', mode: 'decimal', value: sale.balance }), mode = selectEl([['cash', t('Cash')], ['upi', 'UPI'], ['card', t('Card')]], 'cash');
  sheet({ title: t('Collect due'), body: h('div', { class: 'grid' }, h('div', { class: 'kv' }, h('span', null, t('Due')), h('b', { class: 'num' }, inr(sale.balance))), field(t('Amount'), amt), field(t('Mode'), mode)),
    actions: [{ label: t('Save'), primary: true, onclick: async (close) => { if (!N(amt.value)) { toast(t('Enter an amount'), { err: true }); return false; } await api('sty_collect_due', { p_id: sale.id, p_amount: N(amt.value), p_mode: mode.value }); close(); toast(t('Payment saved')); done && done(); } }] });
}
function returnSheet(sale, done) {
  const picks = {}; sale.lines.forEach((l) => picks[l.id] = { qty: 0, dmg: false });
  const st = S.ctx.settings;
  const mode = selectEl([['cash', t('Cash refund')], ['upi', t('UPI refund')], ['card', t('Card refund')], ['credit_note', t('Store credit')], ['exchange', t('Exchange for other items')]], sale.customer ? 'credit_note' : 'cash');
  const reason = input({ placeholder: t('Reason (size, defect, changed mind)') });
  const tot = h('div', { class: 'paytot' }); const rows = h('div', { class: 'list' });
  const paintTot = () => { const amt = sale.lines.reduce((a, l) => a + (picks[l.id].qty ? l.net / l.qty * picks[l.id].qty : 0), 0); clear(tot).append(h('span', null, t('Refund value')), h('b', { class: 'num' }, inr(r2(amt)))); };
  sale.lines.forEach((l) => {
    const max = l.qty - l.returned; if (max <= 0) return;
    const q = h('b', { class: 'num' }, '0'); const dm = h('input', { type: 'checkbox', 'aria-label': t('Damaged'), onchange: () => { picks[l.id].dmg = dm.checked; } });
    rows.append(h('div', { class: 'li' }, h('div', { class: 'grow' }, h('div', { class: 't' }, l.name), h('div', { class: 's' }, [l.colour, l.size].filter(Boolean).join(' · ') + ' · ' + t('bought') + ' ' + l.qty + (l.returned ? ' · ' + t('returned') + ' ' + l.returned : ''))),
      h('label', { class: 'small muted', style: { display: 'flex', gap: '4px', alignItems: 'center' } }, dm, t('Damaged')),
      h('div', { class: 'stp' }, h('button', { type: 'button', onclick: () => { picks[l.id].qty = Math.max(0, picks[l.id].qty - 1); q.textContent = picks[l.id].qty; paintTot(); } }, icon('minus', 16)), q, h('button', { type: 'button', onclick: () => { picks[l.id].qty = Math.min(max, picks[l.id].qty + 1); q.textContent = picks[l.id].qty; paintTot(); } }, icon('plus', 16)))));
  });
  paintTot();
  const old = (Date.now() - new Date(sale.at).getTime()) / 86400000 > st.returnDays;
  sheet({ title: t('Return or exchange'), full: true, body: h('div', { class: 'grid' }, old && !can('sty_manage') ? banner('warn', 'alert', t('This bill is older than') + ' ' + st.returnDays + ' ' + t('days. A manager must take it back.')) : null, rows, tot, field(t('How to settle'), mode), field(t('Reason'), reason)),
    actions: [{ label: t('Take back'), primary: true, onclick: async (close) => {
      const lines = sale.lines.filter((l) => picks[l.id].qty > 0).map((l) => ({ saleLineId: l.id, qty: picks[l.id].qty, damaged: picks[l.id].dmg }));
      if (!lines.length) { toast(t('Pick what is coming back'), { err: true }); return false; }
      const value = r2(sale.lines.reduce((a, l) => a + (picks[l.id].qty ? l.net / l.qty * picks[l.id].qty : 0), 0));
      const r = await sendOrQueue('sty_return', { p: { id: uid(), saleId: sale.id, mode: mode.value, reason: reason.value, lines } });
      close(); S.catAt = 0; toast(r.done ? t('Return saved') : t('Saved on this device'));
      if (mode.value === 'exchange') { BILL.customer = sale.customer || null; BILL.exchange = value; go('sell'); } else done && done();
    } }] });
}
