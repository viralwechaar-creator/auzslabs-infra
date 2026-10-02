/* Orders: live counts, open / advance / credit / delivery / paid / cancelled bills, and a detail sheet with the
   actions each state allows (open, settle, print, WhatsApp, refund, cancel, return, kitchen reprint). */
'use strict';
const STATUS_PILL = { open: ['Open', 'orange'], due: ['Credit', 'red'], paid: ['Paid', 'green'], void: ['Cancelled', ''] };
const KST_LABEL = { new: 'In kitchen', preparing: 'Preparing', ready: 'Ready', served: 'Served', dispatched: 'Out for delivery', done: 'Delivered' };

V.orders = () => {
  const all = L('order').filter((o) => o.t).sort((a, b) => (b.created > a.created ? 1 : -1)), q = (S.oq || '').trim().toLowerCase();
  const open = all.filter((o) => o.status === 'open' && o.lines.length && !o.trial && !o.adv), adv = all.filter((o) => o.status === 'open' && o.lines.length && !o.trial && o.adv).sort((a, b) => (a.adv > b.adv ? 1 : -1));
  const trial = isRetail() ? all.filter((o) => o.trial && o.status === 'open' && o.lines.length) : [], due = all.filter((o) => o.status === 'due');
  const live = all.filter((o) => o.status !== 'void' && o.status !== 'paid' && o.status !== 'due'), deliv = all.filter((o) => o.type === 'Delivery' && o.status !== 'void' && (kstatOf(o) !== 'done' || o.status === 'open') && localDay(o.created) >= addDays(today(), -1));
  const paidToday = all.filter((o) => o.status === 'paid' && localDay(o.paidAt) === today()), voided = all.filter((o) => o.status === 'void' && localDay(o.voidAt || o.created) >= addDays(today(), -7));
  const match = (o) => !q || (o.no || '').toLowerCase().includes(q) || ((o.cust || {}).name || '').toLowerCase().includes(q) || digits((o.cust || {}).phone).includes(digits(q) || '¤') || tn(o.table).toLowerCase() === q;
  const segs = [['open', 'Open'], ['due', 'Credit'], ...(isRestaurant() ? [['deliv', 'Delivery']] : []), ['paid', 'Paid today'], ['void', 'Cancelled'], ['search', 'All bills']];
  const segV = segs.some(([k]) => k === S.ordersSeg) ? S.ordersSeg : 'open';
  const covers = open.reduce((a, o) => a + (o.covers || 0), 0), sales = paidToday.reduce((a, o) => a + netOf(o), 0);
  const kpis = isRetail() ? [['Open', open.length], ['On credit', due.length], ['Paid today', paidToday.length], ['Sales today', inr(sales)]]
    : [['Running orders', open.length], ['Running tables', new Set(open.filter((o) => o.table).map((o) => o.table)).size], ['Guests seated', covers], ['In kitchen', live.filter((o) => o.kstat === 'new' || o.kstat === 'preparing').length], ['Ready', live.filter((o) => o.kstat === 'ready').length], ['Out for delivery', all.filter((o) => o.kstat === 'dispatched' && o.status !== 'void').length], ['Advance', adv.length], ['Sales today', inr(sales)]];
  const listOf = (arr, empt) => (arr.length ? h('div', { class: 'list' }, arr.filter(match).slice(0, 120).map(orderRow)) : h('div', { class: 'card' }, empty('orders', empt)));
  let content;
  if (segV === 'open') content = [
    adv.length ? h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Advance orders (' + adv.length + ')')), h('div', { class: 'list' }, adv.filter(match).map((o) => { const late = new Date(o.adv) < new Date(); return liRow({ ic: 'clock', tone: late ? 'red' : 'teal', title: advLabel(o.adv) + ' · ' + o.type, sub: ((o.cust || {}).name || 'Guest') + ' · ' + o.no, value: inr(o.t.total), right: h('button', { class: 'btn sm ' + (late ? 'fill' : 'tinted'), onclick: (e) => { e.stopPropagation(); S.cur = structuredClone(o); go('sell'); } }, late ? 'Start now' : 'Open') }); }))) : null,
    trial.length ? h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Trial room (' + trial.length + ')')), h('div', { class: 'list' }, trial.map((o) => liRow({ ic: 'person', tone: 'purple', title: (o.cust.name || 'Guest') + ' · ' + plural(itemCount(o), 'item'), value: inr(o.t.total), chev: true, onclick: () => orderSheet(o) })))) : null,
    h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Open orders (' + open.length + ')')), listOf(open, 'No open orders'))];
  else if (segV === 'due') content = [h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'On credit (' + due.length + ')'), h('span', { class: 'sub num' }, inr(due.reduce((a, o) => a + r2(o.t.total - paidSoFar(o)), 0)) + ' due')), listOf(due, 'Nothing on credit'))];
  else if (segV === 'deliv') content = [h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Deliveries')), deliv.length ? h('div', { class: 'list' }, deliv.map((o) => { const k = kstatOf(o), unpaid = k === 'done' && o.status === 'open'; return liRow({ ic: 'truck', tone: unpaid ? 'red' : k === 'dispatched' ? 'blue' : 'orange', title: o.no + (o.src ? ' · ' + o.src : '') + ' · ' + inr(o.t.total), sub: [(o.cust || {}).name, o.addr, o.rider ? 'Rider ' + o.rider.name : 'No rider', o.eta ? 'promised ' + o.eta : ''].filter(Boolean).join(' · '), value: unpaid ? 'Delivered, not paid' : KST_LABEL[k] || (o.status === 'paid' ? 'Paid' : 'Open'), chev: true, onclick: () => orderSheet(o) }); })) : h('div', { class: 'card' }, empty('truck', 'No deliveries right now')))];
  else if (segV === 'paid') content = [h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Paid today (' + paidToday.length + ')'), h('span', { class: 'sub num' }, inr(sales))), listOf(paidToday, 'No bills paid today yet'))];
  else if (segV === 'void') content = [h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Cancelled, last 7 days')), listOf(voided, 'Nothing cancelled'))];
  else content = [h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'All bills')), listOf(all.filter((o) => o.no), 'No bills yet'))];
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('h1', null, 'Orders'), h('div', { class: 'search', style: { width: 'min(320px,100%)' } }, icon('search', 18), h('input', { class: 'input', type: 'search', placeholder: 'Bill, name, phone or table', value: S.oq || '', 'aria-label': 'Search orders', onchange: (e) => { S.oq = e.target.value; if (S.oq) S.ordersSeg = 'search'; render(); } }))),
    h('div', { class: 'kpis' + (kpis.length > 4 ? ' strip' : '') }, kpis.map(([k, v]) => h('div', { class: 'kpi' }, h('b', null, String(v)), h('span', null, k)))),
    h('div', { style: { maxWidth: '760px' } }, seg(segs, segV, (v) => { S.ordersSeg = v; render(); })),
    ...content);
};
function orderRow(o) {
  const sp = STATUS_PILL[o.status] || ['Open', 'orange'], k = kstatOf(o);
  const sub = [(o.cust || {}).name, plural(itemCount(o), 'item'), o.status === 'paid' ? fmtTime(o.paidAt) : minsSince(o.created) + ' min ago', o.status === 'open' && k ? KST_LABEL[k] : null, refundedOf(o) ? 'refunded ' + inr(refundedOf(o)) : null].filter(Boolean).join(' · ');
  return liRow({ title: (o.no || 'Draft') + ' · ' + o.type + (o.table ? ' · ' + tn(o.table) : '') + (o.src ? ' · ' + o.src : ''), sub, value: o.status === 'due' ? inr(r2(o.t.total - paidSoFar(o))) + ' due' : inr(o.t.total), right: pill(sp[0], sp[1]), chev: true, onclick: () => orderSheet(o) });
}
function orderSheet(o0) {
  const o = rec(o0.id) || o0, t = o.t || tot(o), st = o.status, sp = STATUS_PILL[st] || ['Open', 'orange'];
  const acts = [];
  if (st === 'open') acts.push({ label: 'Open order', primary: true, run: () => { S.cur = structuredClone(o); go('sell'); } });
  if (st === 'due') acts.push({ label: 'Settle ' + inr(r2(t.total - paidSoFar(o))), primary: true, run: () => { S.cur = structuredClone(o); go('sell'); setTimeout(() => payFlow(S.cur), 200); } });
  const more = [];
  if (st === 'paid' || st === 'due') more.push(liRow({ ic: 'printer', tone: 'gray', title: 'Print bill', chev: true, onclick: () => { s.close(); reprint(o); } }), liRow({ ic: 'chat', tone: 'green', title: 'Send on WhatsApp', chev: true, onclick: () => { s.close(); wa(o); } }));
  if (st === 'open') more.push(liRow({ ic: 'printer', tone: 'gray', title: 'Print bill for the guest', sub: 'Provisional', chev: true, onclick: () => { s.close(); prnInv(rcpt({ ...o, t }, false, true)); } }));
  if ((o.kotBatches || []).length && st !== 'void') more.push(liRow({ ic: 'kot', tone: 'orange', title: 'Reprint kitchen ticket', chev: true, onclick: () => { s.close(); reprintKot(o); } }));
  if (st === 'paid' && netOf(o) > 0) more.push(liRow({ ic: 'undo', tone: 'orange', title: 'Refund', chev: true, onclick: () => { s.close(); refundSheet(o); } }));
  if (st === 'paid' && isRetail()) more.push(liRow({ ic: 'move', tone: 'purple', title: 'Return or exchange', chev: true, onclick: () => { s.close(); returnSheet(o); } }));
  if (st === 'paid') more.push(liRow({ ic: 'x', tone: 'red', title: 'Cancel bill', chev: true, onclick: () => { s.close(); voidPaid(o); } }));
  if (st === 'open' && o.trial) more.push(liRow({ ic: 'x', tone: 'red', title: 'Release trial', onclick: async () => { s.close(); if (!(await confirmBox('Release this trial?', 'Nothing was sold or charged.', 'Release'))) return; const c = structuredClone(o); c.status = 'void'; c.voidReason = 'Trial release'; c.voidAt = now(); await save('order', c, c.id); render(); } }));
  const s = sheet({ title: (o.no || 'Order') + (o.table ? ' · ' + tn(o.table) : ''), closeLabel: 'Done', body: h('div', { class: 'stack s20' },
    h('div', { class: 'row wrap' }, pill(sp[0], sp[1]), pill(o.type), o.src ? pill(o.src, 'blue') : null, kstatOf(o) && st !== 'void' ? pill(KST_LABEL[kstatOf(o)] || kstatOf(o), 'orange') : null, o.covers ? pill(plural(o.covers, 'guest')) : null),
    h('div', { class: 'list' },
      liRow({ title: 'Created', value: fmtDate(o.created) + ', ' + fmtTime(o.created) }), o.paidAt ? liRow({ title: 'Paid', value: fmtTime(o.paidAt) }) : null,
      (o.cust || {}).name || (o.cust || {}).phone ? liRow({ title: 'Customer', value: [(o.cust || {}).name, (o.cust || {}).phone].filter(Boolean).join(' · ') }) : null,
      o.captain ? liRow({ title: 'Served by', value: o.captain.name }) : null, o.addr ? liRow({ title: 'Deliver to', sub: o.addr, value: o.rider ? o.rider.name : null }) : null,
      st === 'void' ? liRow({ title: 'Reason', value: o.voidReason || '—' }) : null),
    h('div', { class: 'list' }, o.lines.map((l) => liRow({ title: l.qty + ' × ' + l.name + (l.size ? ' (' + l.size + ')' : ''), sub: l.note || null, value: inr(l.price * l.qty) }))),
    h('div', { class: 'list' }, liRow({ title: 'Subtotal', value: inr(t.sub) }), t.d ? liRow({ title: o.complimentary ? 'Complimentary' : o.coupon ? 'Coupon ' + o.coupon : 'Discount', value: '−' + inr(t.d) }) : null,
      t.svc ? liRow({ title: 'Service charge', value: inr(t.svc) }) : null, t.pack ? liRow({ title: 'Packing', value: inr(t.pack) }) : null, t.deliv ? liRow({ title: 'Delivery', value: inr(t.deliv) }) : null,
      liRow({ title: 'GST', value: inr(t.tax) }), t.round ? liRow({ title: 'Round off', value: inr(t.round) }) : null, liRow({ title: h('b', null, 'Total'), value: h('b', null, inr(t.total)) })),
    (o.pays || []).length ? h('div', { class: 'sec' }, h('div', { class: 'lbl' }, 'Payments'), h('div', { class: 'list' }, o.pays.map((p) => liRow({ title: (PAY_LABEL[p.m] || p.m) + (p.code ? ' ' + p.code : ''), sub: p.ref || (p.tendered ? 'Received ' + inr(p.tendered) : null), value: inr(p.amt) })))) : null,
    (o.refunds || []).length ? h('div', { class: 'sec' }, h('div', { class: 'lbl' }, 'Refunds'), h('div', { class: 'list' }, o.refunds.map((r) => liRow({ title: inr(r.amt) + (r.m ? ' · ' + (PAY_LABEL[r.m] || r.m) : ''), sub: [r.reason, r.approvedBy ? 'approved by ' + r.approvedBy.name : null, r.at ? fmtTime(r.at) : null].filter(Boolean).join(' · ') })))) : null,
    more.length ? h('div', { class: 'list' }, more) : null), actions: acts });
}
