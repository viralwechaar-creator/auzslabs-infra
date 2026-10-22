/* AUZsStyle: Bills. Find a bill, reprint, share, take a return or exchange back, or cancel it (manager). */
'use strict';
const BU = { k: 'today', from: null, to: null, q: '', status: '' };
page('bills', {
  title: 'Bills', perm: 'sty_view',
  async render(v) {
    v.header({ title: t('Bills') });
    Object.assign(BU, rangeFor(BU.k, BU.from ? { from: BU.from, to: BU.to } : null));
    const custId = v.q.get('customer') || '';
    const list = h('div', { class: 'list' }), kp = h('div', { class: 'kpis' });
    async function load() {
      clear(list).append(h('div', { class: 'spin', style: { color: 'var(--tint)', margin: '20px auto' } }));
      let rows = []; try { rows = await api('sty_list_sales', { p: { from: custId ? '' : BU.from, to: custId ? '' : BU.to, q: BU.q, status: BU.status, customerId: custId, limit: 200 } }) || []; } catch (e) { return clear(list).append(empty('cloudOff', t('Could not load'), e.message)); }
      const live = rows.filter((r) => r.status !== 'void'), tot = live.reduce((a, r) => a + r.total, 0);
      clear(kp).append(kpi(t('Sales'), inr(tot, 0), live.length + ' ' + t('Bills')), kpi(t('Due'), inr(live.reduce((a, r) => a + Math.max(r.total - r.paid, 0), 0), 0), '', null, ''));
      clear(list).append(...(rows.length ? rows.map((r) => liRow({ icon: r.status === 'void' ? 'x' : 'tag', title: r.number + (r.customer ? ' · ' + r.customer : ''), sub: fmtDT(r.at) + ' · ' + r.units + ' ' + t('Units') + (r.staff ? ' · ' + r.staff : ''), value: inr(r.total), valueSub: r.status === 'void' ? t('Cancelled') : r.status === 'due' ? t('Due') + ' ' + inr(r.total - r.paid) : '', chevron: true, onclick: () => billSheet(r.id, load) })) : [empty('tag', t('No bills'), t('Bills show here as you sell.'))]));
    }
    v.root.append(h('div', { class: 'grid' }, custId ? banner('', 'user', t('Bills of one customer'), ' ', h('button', { class: 'btn plain sm', onclick: () => go('bills') }, t('Show all'))) : rangePicker(BU, load),
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
      open && can('sty_manage') && !(sale.returns || []).length ? h('button', { class: 'btn danger', type: 'button', onclick: async () => { const r = await promptReason(t('Cancel this bill?')); if (r === null) return; await api('sty_void_sale', { p_id: sale.id, p_reason: r }); s.close(); S.catAt = 0; toast(t('Bill cancelled')); changed && changed(); } }, icon('trash', 18), t('Cancel bill')) : null)) });
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
