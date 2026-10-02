/* Payment: tenders (cash with change, UPI, card, gift card, other), equal shares, tips, credit bills,
   completion and the bill; after payment: refunds, voids, reprints, returns and exchanges. */
'use strict';
const TENDERS = [['cash', 'Cash', 'cash'], ['upi', 'UPI', 'qr'], ['card', 'Card', 'card'], ['giftcard', 'Gift card', 'gift'], ['other', 'Other', 'wallet']];
const CASH_DENOMS = [500, 200, 100, 50, 20, 10, 5, 2, 1];

async function payFlow(o = S.cur) {
  if (!o || !o.lines.length) return;
  freshCur();
  const c = cfg();
  if (c.requirePhone !== false && digits((o.cust || {}).phone).length < 10) {
    await info('Customer phone needed', 'Add the customer\'s 10-digit phone number before payment. You can turn this off in the admin console under Order preferences.');
    const ph = $$('input[aria-label="Phone"]').find((x) => x.offsetParent); if (ph) ph.focus();
    return;
  }
  if (o.type === 'Dine-in' && (o.kstat === 'new' || o.kstat === 'preparing') && !(await confirmBox('Still in the kitchen', 'The kitchen has not marked this order ready yet. Take payment anyway?', 'Take payment'))) return;
  o.t = tot(o);
  closeTicketSheet();
  paySheet(o);
}

function paySheet(o) {
  const c = cfg(), t = o.t, P = (o.pays || []).slice();
  let tip = o.tip && o.tip.amt ? { ...o.tip } : null, shares = 0, shareNo = 0;
  const due = () => r2(t.total - P.reduce((a, x) => a + x.amt, 0));
  const amt = h('input', { class: 'input', type: 'number', inputmode: 'decimal', min: 0, step: '0.01', 'aria-label': 'Amount', style: { fontSize: '22px', fontWeight: '600', textAlign: 'center' } });
  const big = h('div', { class: 'big-amt' }), list = h('div', { class: 'list' }), shareEl = h('div', { class: 'hint', style: { textAlign: 'center' } }), tipRow = h('div');
  const complete = { label: c.printOnPay === false ? 'Complete' : 'Complete and print', primary: true, run: () => completePay(o, P, tip, s) };
  const credit = { label: 'Save as credit', run: () => saveCredit(o, P, s) };
  const add = (p) => { P.push(p); if (shares) shareNo++; up(); };
  const tender = async (m) => {
    const target = Math.min(+amt.value || due(), due()); if (!(target > 0)) return toast('Nothing left to pay');
    if (m === 'cash') return cashSheet(target, (tendered, denoms) => { const applied = Math.min(tendered, target); add({ m, amt: applied, tendered, denoms, change: r2(tendered - applied), at: now() }); });
    if (m === 'giftcard') return giftSheet(o, target, (p) => { add(p); o.pays = P.slice(); persist(o); });
    add({ m, amt: target, at: now() });
  };
  function up() {
    const d = due();
    big.replaceChildren(d > 0 ? inr(d) : d < 0 ? inr(-d) : inr(t.total), h('small', null, d > 0 ? (P.length ? 'Left to pay of ' + inr(t.total) : 'To pay') : d < 0 ? 'Change to return' : 'Paid in full'));
    amt.value = shares && d > 0 ? Math.min(d, Math.ceil(t.total / shares)) : Math.max(d, 0);
    shareEl.textContent = shares && d > 0 ? 'Share ' + Math.min(shareNo + 1, shares) + ' of ' + shares : '';
    list.replaceChildren(...P.map((p, i) => liRow({ ic: (TENDERS.find((x) => x[0] === p.m) || [, , 'wallet'])[2], tone: 'gray', title: (PAY_LABEL[p.m] || p.m) + (p.code ? ' ' + p.code : ''), sub: p.tendered ? 'Received ' + inr(p.tendered) + (p.change ? ', change ' + inr(p.change) : '') : p.ref || null, value: inr(p.amt),
      right: p.m === 'giftcard' || (o.pays || []).includes(p) ? null : h('button', { class: 'iconbtn', 'aria-label': 'Remove payment', onclick: () => { P.splice(i, 1); if (shares) shareNo = Math.max(0, shareNo - 1); up(); } }, icon('x', 18)) })));
    list.classList.toggle('hidden', !P.length);
    tipRow.replaceChildren(c.tipPrompt ? liRow({ ic: 'star', tone: 'orange', title: tip ? 'Tip ' + inr(tip.amt) + ' · ' + (PAY_LABEL[tip.m] || tip.m) : 'Add a tip', sub: 'Not part of the bill', chev: true, onclick: () => tipSheet(tip, (v) => { tip = v; up(); }) }) : '');
    if (complete.el) complete.el.disabled = d > 0;
    if (credit.el) credit.el.disabled = d <= 0;
  }
  const s = sheet({ title: 'Pay ' + inr(t.total), closeLabel: 'Cancel', body: h('div', { class: 'stack s20' },
    big, shareEl,
    h('div', { class: 'grid2' }, h('button', { class: 'btn', onclick: async () => { const n = await promptBox('Split equally', { msg: 'How many people are paying?', value: '2', type: 'number', mode: 'numeric', ok: 'Split' }); if (n == null) return; const k = Math.round(+n); if (k > 1 && k <= 50) { shares = k; shareNo = P.length; up(); } } }, icon('people', 18), 'Split equally'),
      h('button', { class: 'btn', onclick: () => { s.close(); splitSheet(o); } }, icon('split', 18), 'Split by items')),
    field('Amount', amt),
    h('div', { class: 'grid2', style: { gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))' } }, TENDERS.filter(([m]) => m !== 'giftcard' || L('giftcard').length).map(([m, label, ic]) => h('button', { class: 'btn lg', onclick: () => tender(m) }, icon(ic, 20), label))),
    list, h('div', { class: 'list' }, tipRow)),
    actions: [credit, complete] });
  up();
}

function cashSheet(target, cb) {
  const counts = {}, totalEl = h('b', { class: 'num' }, '₹0'), changeEl = h('div', { class: 'hint', style: { fontSize: '15px' } });
  const tendered = () => CASH_DENOMS.reduce((a, d) => a + d * (counts[d] || 0), 0);
  const recalc = () => {
    const tv = tendered(), ch = r2(tv - target); totalEl.textContent = inr(tv);
    if (!tv) changeEl.textContent = ''; else if (ch < 0) changeEl.textContent = 'Short by ' + inr(-ch);
    else { let rem = ch; const parts = []; for (const d of CASH_DENOMS) { const n = Math.floor(rem / d); if (n > 0) { parts.push(n + ' × ₹' + d); rem = r2(rem - n * d); } } changeEl.textContent = 'Change to return: ' + inr(ch) + (parts.length ? ' (' + parts.join(', ') + ')' : ''); }
  };
  const greedy = (a) => { const c = {}; let r = a; for (const d of CASH_DENOMS) { const n = Math.floor(r / d); if (n > 0) { c[d] = n; r -= n * d; } } return c; };
  const quick = [...new Set([target, ...[10, 50, 100, 500].map((n) => Math.ceil(target / n) * n)])].filter((v) => v >= target).slice(0, 5);
  const rows = CASH_DENOMS.map((d) => liRow({ title: '₹' + d, right: stepper(0, (v) => { counts[d] = v; recalc(); }, 0, 999) }));
  const s = sheet({ title: 'Cash · ' + inr(target), narrow: true, closeLabel: 'Cancel', body: h('div', { class: 'stack s20' },
    h('div', { class: 'chips', style: { flexWrap: 'wrap' } }, quick.map((v, i) => h('button', { class: 'btn' + (i === 0 ? ' fill' : ''), onclick: () => { s.close(); cb(v, greedy(v)); } }, i === 0 ? 'Exact ' + inr(v) : inr(v)))),
    h('div', { class: 'lbl' }, 'Or count the notes and coins'), h('div', { class: 'list' }, rows), h('div', { class: 'row sp' }, h('span', null, 'Received'), totalEl), changeEl),
    actions: [{ label: 'Confirm', primary: true, run: () => { const tv = tendered(); if (tv <= 0) { toast('Count at least one note or coin', { err: true }); return false; } cb(tv, { ...counts }); } }] });
}

function giftSheet(o, target, cb) {
  const code = h('input', { class: 'input', placeholder: 'Gift card code', autocapitalize: 'characters', 'aria-label': 'Gift card code', autofocus: true });
  const msg = h('div', { class: 'hint' }), amt = h('input', { class: 'input', type: 'number', inputmode: 'decimal', value: target, 'aria-label': 'Amount' });
  const look = () => { const g = L('giftcard').find((x) => (x.code || '').toUpperCase() === code.value.trim().toUpperCase()); msg.className = 'hint'; msg.textContent = g ? 'Balance ' + inr(g.bal) + (g.exp ? ' · valid until ' + fmtDate(g.exp) : '') : code.value.trim().length > 2 ? 'No card with that code on this till yet' : ''; if (g) amt.value = Math.min(target, +g.bal || 0); };
  code.oninput = look;
  sheet({ title: 'Gift card', narrow: true, closeLabel: 'Cancel', body: h('div', { class: 'stack' }, code, msg, field('Amount to use', amt)), actions: [{ label: 'Use card', primary: true, run: async () => {
    const a = r2(+amt.value); if (!(a > 0)) { toast('Enter an amount', { err: true }); return false; }
    if (a > target) { toast('More than the amount left to pay', { err: true }); return false; }
    if (!navigator.onLine) { msg.className = 'hint err'; msg.textContent = 'Gift cards need an internet connection.'; return false; }
    const { data, error } = await sb.rpc('redeem_giftcard', { p_code: code.value, p_amount: a, p_order: o.id });
    if (error) { msg.className = 'hint err'; msg.textContent = error.message; return false; }
    cb({ m: 'giftcard', amt: a, code: data.code, at: now() }); toast('Gift card used · ' + inr(data.balance) + ' left'); sync();
  } }] });
}

function tipSheet(cur, cb) {
  let m = (cur && cur.m) || 'cash';
  const a = h('input', { class: 'input', type: 'number', inputmode: 'decimal', value: cur ? cur.amt : '', placeholder: '0', 'aria-label': 'Tip', autofocus: true });
  sheet({ title: 'Tip', narrow: true, closeLabel: 'Cancel', body: h('div', { class: 'stack s20' }, a, seg([['cash', 'Cash'], ['upi', 'UPI'], ['card', 'Card']], m, (v) => (m = v)), h('div', { class: 'hint' }, 'Tips are recorded on the bill but are not part of sales or GST.')),
    actions: [cur ? { label: 'Remove', danger: true, run: () => cb(null) } : null, { label: 'Save', primary: true, run: () => { const v = r2(+a.value); cb(v > 0 ? { amt: v, m } : null); } }] });
}

async function completePay(o, P, tip, s) {
  if (r2(o.t.total - P.reduce((a, x) => a + x.amt, 0)) > 0) return false;
  const c = cfg();
  freshCur();
  o.pays = P; o.tip = tip || undefined;
  if (o.loyaltyRedeemed) o.loyaltyRedeemed = o.t.d;
  o.change = r2(P.reduce((a, x) => a + (x.change || 0), 0));
  o.status = 'paid'; o.paidAt = now(); o.paidBy = S.user.id;
  if (o.type === 'Dine-in' && o.kstat === 'ready') { o.kstat = 'served'; o.servedAt = now(); }
  o.tok = o.tok || tok();
  if (!o.no || o.no.endsWith('~')) o.no = await nextNo();
  await dedu(o); await deduVariant(o);
  if (!isRetail() && unsent(o)) { // pay-first counters: whatever was not sent goes to the kitchen now
    const kno = await nextKot(), n = mk(o, kno);
    if (n.length) { await save('kotlog', { orderId: o.id, orderNo: o.no, kotNo: kno, type: o.type, table: o.table, cust: o.cust, items: n, createdAt: now() }, uid()); if (c.autoKot !== false) prn(kotHtml(o, n, { no: kno })); }
  }
  if (c.printOnPay !== false) o.printCount = (o.printCount || 0) + 1;
  o.t = tot(o);
  await persist(o); await markTableDirty(o);
  if (c.printOnPay !== false) prnInv(rcpt(o, false));
  S.cur = null; render();
  doneSheet(o);
}
async function saveCredit(o, P, s) {
  const left = r2(o.t.total - P.reduce((a, x) => a + x.amt, 0)); if (left <= 0) return false;
  if (digits((o.cust || {}).phone).length < 10) { toast('A credit bill needs the customer\'s phone', { err: true }); return false; }
  const ap = await approve('credit', o.id, inr(left) + ' on credit for ' + ((o.cust || {}).name || 'this customer')); if (!ap) return false;
  freshCur();
  o.pays = P; o.status = 'due'; o.dueAt = now(); o.creditApprovedBy = ap; o.tok = o.tok || tok();
  if (!o.no || o.no.endsWith('~')) o.no = await nextNo();
  if (!isRetail() && unsent(o)) mk(o, await nextKot());
  await persist(o); await markTableDirty(o);
  S.cur = null; render(); toast('Saved on credit · ' + inr(left) + ' due');
}
function doneSheet(o) {
  const cashChange = o.change || 0;
  sheet({ title: 'Payment complete', narrow: true, body: h('div', { class: 'stack s20', style: { textAlign: 'center', padding: '10px 0' } },
    h('div', { style: { color: 'var(--green)', display: 'flex', justifyContent: 'center' } }, icon('check', 52, 2)),
    h('div', { class: 'big-amt' }, inr(o.t.total), h('small', null, o.no + (o.table ? ' · ' + tn(o.table) : ''))),
    cashChange ? h('div', { class: 'banner warn', style: { justifyContent: 'center' } }, h('b', null, 'Give back ' + inr(cashChange))) : null,
    h('div', { class: 'grid2' }, h('button', { class: 'btn lg', onclick: () => wa(o) }, icon('chat', 20), 'Send bill'), h('button', { class: 'btn lg', onclick: () => reprint(o) }, icon('printer', 20), 'Print'))) });
}
async function markTableDirty(o) { if (!o.table) return; const tb = L('table').find((x) => x.id === o.table); if (tb && tb.cleaned !== false) await save('table', { ...tb, cleaned: false }, tb.id); }

// ---------- after payment ----------
async function reprint(o) { const c = structuredClone(rec(o.id) || o), dup = (c.printCount || 0) > 0; c.printCount = (c.printCount || 0) + 1; await save('order', c, c.id); prnInv(rcpt(c, dup)); }
function refundSheet(o) {
  const max = r2(o.t.total - refundedOf(o)); if (max <= 0) return info('Nothing left to refund', 'This bill has already been refunded in full.');
  if (dayLocked(localDay(o.paidAt)) && !can('o')) return info('This day is closed', 'Ask the owner to reopen ' + fmtDay(localDay(o.paidAt)) + ' first.');
  let m = (o.pays && o.pays[0] && o.pays[0].m !== 'giftcard' && o.pays[0].m) || 'cash';
  const a = h('input', { class: 'input', type: 'number', inputmode: 'decimal', value: max, max, 'aria-label': 'Refund amount' });
  sheet({ title: 'Refund · ' + o.no, narrow: true, closeLabel: 'Cancel', body: h('div', { class: 'stack s20' }, field('Amount (up to ' + inr(max) + ')', a), field('Paid back by', seg([['cash', 'Cash'], ['upi', 'UPI'], ['card', 'Card'], ['other', 'Other']], m, (v) => (m = v))),
    h('div', { class: 'hint' }, 'Refunds are added to the bill; the original payment is never changed.')),
    actions: [{ label: 'Refund', primary: true, danger: true, run: async () => {
      const v = r2(+a.value); if (!(v > 0) || v > max) { toast('Enter an amount up to ' + inr(max), { err: true }); return false; }
      const reason = await pickReason('Why refund?'); if (!reason) return false;
      const ap = await approve('refund', o.id, 'Refund ' + inr(v) + ' on ' + o.no); if (!ap) return false;
      const c = structuredClone(rec(o.id) || o); c.refunds = (c.refunds || []).concat({ amt: v, m, reason, by: S.user.email || S.user.id, at: now(), approvedBy: ap, register: currentRegisterId() || undefined });
      await save('order', c, c.id); toast('Refunded ' + inr(v)); render();
    } }] });
}
async function voidPaid(o) {
  if (dayLocked(localDay(o.paidAt)) && !can('o')) return info('This day is closed', 'Ask the owner to reopen ' + fmtDay(localDay(o.paidAt)) + ' first.');
  if (!(await confirmBox('Cancel bill ' + o.no + '?', 'The bill stays on record, marked cancelled. Refund any money separately.', 'Cancel bill', true))) return;
  const reason = await pickReason('Why cancel this bill?'); if (!reason) return;
  const ap = await approve('void', o.id, 'Cancel paid bill ' + o.no + ' (' + inr(o.t.total) + ')'); if (!ap) return;
  const c = structuredClone(rec(o.id) || o); c.status = 'void'; c.voidReason = reason; c.voidApprovedBy = ap; c.voidAt = now();
  await save('order', c, c.id); await save('voidlog', { order: c.id, no: c.no, reason, by: S.user.email || S.user.id, approvedBy: ap.name, at: now() });
  toast('Bill cancelled'); render();
}
// retail: return or exchange a sold item
function returnableQty(o, idx) { const l = o.lines[idx], back = (o.exchanges || []).filter((e) => e.lineIdx === idx).reduce((a, e) => a + e.qty, 0); return l.qty - back; }
function returnSheet(o) {
  if (dayLocked(localDay(o.paidAt)) && !can('o')) return info('This day is closed', 'Ask the owner to reopen it first.');
  const rows = o.lines.map((l, idx) => ({ l, idx, avail: returnableQty(o, idx) })).filter((r) => r.avail > 0);
  if (!rows.length) return info('Nothing left to return', 'Every item on this bill has already come back.');
  const s = sheet({ title: 'Return or exchange · ' + o.no, narrow: true, body: h('div', { class: 'list' }, rows.map(({ l, idx, avail }) => liRow({ title: l.name + (l.size ? ' (' + l.size + ')' : ''), sub: avail + ' can come back', chev: true, onclick: () => { s.close(); returnLineSheet(o, idx, avail); } }))) });
}
function returnLineSheet(o, idx, avail) {
  const l = o.lines[idx]; let q = 1;
  sheet({ title: l.name, narrow: true, closeLabel: 'Cancel', body: h('div', { class: 'row sp' }, h('span', { class: 'lbl' }, 'Quantity'), stepper(1, (v) => (q = v), 1, avail)),
    actions: [{ label: 'Refund', run: () => { doReturn(o, idx, q, 'refund'); } }, { label: 'Exchange', primary: true, run: () => { exchangePick(o, idx, q); } }] });
}
function exchangePick(o, idx, q) {
  const its = L('item').filter((i) => i.variants && i.variants.length);
  const s = sheet({ title: 'Exchange for', narrow: true, body: its.length ? h('div', { class: 'list' }, its.map((ni) => liRow({ title: ni.name, value: inr(ni.price), chev: true, onclick: () => {
    s.close();
    const s2 = sheet({ title: ni.name, narrow: true, body: h('div', { class: 'list' }, ni.variants.map((v) => liRow({ title: v.size + (v.color ? ' / ' + v.color : ''), sub: v.qty > 0 ? v.qty + ' in stock' : 'Out of stock', onclick: async () => {
      if (v.qty < q && !(await confirmBox('Not enough stock', 'Only ' + v.qty + ' in stock. Exchange anyway?', 'Exchange'))) return;
      s2.close(); doReturn(o, idx, q, 'exchange', { itemId: ni.id, itemName: ni.name, price: ni.price, size: v.size, color: v.color });
    } }))) });
  } }))) : empty('box', 'Nothing to exchange with', 'Only items with size or colour stock can be exchanged.') });
}
async function doReturn(o, idx, q, type, give) {
  const reason = await pickReason(type === 'refund' ? 'Why is it coming back?' : 'Why the exchange?'); if (!reason) return;
  const ap = await approve('return', o.id, (type === 'refund' ? 'Return ' : 'Exchange ') + q + ' × ' + o.lines[idx].name); if (!ap) return;
  const c = structuredClone(rec(o.id) || o), l = c.lines[idx], amt = r2(l.price * q), gAmt = type === 'exchange' && give ? r2(give.price * q) : 0;
  const it = rec(l.id);
  if (it && it.variants && l.variant) { const v = it.variants.find((x) => x.size === l.variant.size && (x.color || '') === (l.variant.color || '')); if (v) { v.qty = r2((v.qty || 0) + q); await save('item', it, it.id); } }
  if (type === 'exchange' && give) { const ni = rec(give.itemId); if (ni && ni.variants) { const v = ni.variants.find((x) => x.size === give.size && (x.color || '') === (give.color || '')); if (v) { v.qty = r2((v.qty || 0) - q); await save('item', ni, ni.id); } } }
  c.exchanges = (c.exchanges || []).concat({ lineIdx: idx, qty: q, type, amt, give: give ? { ...give, qty: q, amt: gAmt } : null, diff: r2(gAmt - amt), reason, by: S.user.email || S.user.id, at: now() });
  c.returnApprovedBy = ap;
  await save('order', c, c.id); render();
  info(type === 'refund' ? 'Refund ' + inr(amt) : gAmt > amt ? 'Collect ' + inr(r2(gAmt - amt)) : gAmt < amt ? 'Refund ' + inr(r2(amt - gAmt)) : 'Even exchange', type === 'refund' ? 'Give the money back and record the refund on the bill if needed.' : gAmt === amt ? 'Nothing is owed either way.' : '');
}
