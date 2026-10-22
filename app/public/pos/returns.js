/* Returns & exchanges (retail): a real staged workflow instead of the old one-tap instant refund/exchange.
   Owner request: a return/exchange must go through real stages -- first Approved or Rejected (a one-time
   decision), then Received (the item physically comes back), then Refunded or Exchanged (money/stock
   actually move) -- and once a stage is set it must never be free to change again.

   Each request is its own `kind='returnreq'` record (db/214_return_exchange_stages.sql); the server-side
   `records_returnreq_guard` trigger is the real enforcement (it rejects an invalid stage jump or any change
   to an already-decided request outright) -- this file only ever asks for the next valid stage, it never
   has to re-check the whole graph itself. Raising a request (`requestReturn`, called from pay.js's
   returnLineSheet/exchangePick) needs no manager approval; approving/rejecting and finishing a refund or
   exchange both go through the existing `approve()` PIN gate, same as every other money-moving POS action. */
'use strict';
const RETURN_STAGE_LABEL = { pending: 'Pending', approved: 'Approved', rejected: 'Rejected', received: 'Received', refunded: 'Refunded', exchanged: 'Exchanged' };
const RETURN_STAGE_TONE = { pending: 'orange', approved: 'blue', rejected: 'red', received: 'purple', refunded: 'green', exchanged: 'green' };
const returnReqs = () => L('returnreq').slice().sort((a, b) => (b.requestedAt || '').localeCompare(a.requestedAt || ''));
const openReturnReqs = () => returnReqs().filter((r) => !['rejected', 'refunded', 'exchanged'].includes(r.stage));

// Raised from pay.js's returnLineSheet/exchangePick -- no approval needed to raise a request, only to decide
// or finish one. `give` is the exchange target item/variant chosen in exchangePick, or null for a refund.
async function requestReturn(o, idx, q, mode, give) {
  const reason = await pickReason(mode === 'refund' ? 'Why is it coming back?' : 'Why the exchange?'); if (!reason) return;
  const l = o.lines[idx], amt = r2(l.price * q);
  await save('returnreq', {
    orderId: o.id, orderNo: o.no, lineIdx: idx, itemName: l.name, size: l.size || '', qty: q,
    mode, give: give ? { ...give, qty: q, amt: r2(give.price * q) } : null, amt, reason,
    requestedBy: S.user.email || S.user.id, requestedAt: now(), stage: 'pending',
  }, uid());
  render();
  info('Request sent', mode === 'refund' ? 'Waiting for a manager to approve or reject this return.' : 'Waiting for a manager to approve or reject this exchange.');
}

async function decideReturn(req, decision) {
  const ap = await approve('return', req.id, (decision === 'approved' ? 'Approve ' : 'Reject ') + (req.mode === 'exchange' ? 'exchange of ' : 'return of ') + req.qty + ' × ' + req.itemName); if (!ap) return;
  const c = structuredClone(req); c.stage = decision; c.decidedBy = ap; c.decidedAt = now();
  await save('returnreq', c, req.id); render(); toast(decision === 'approved' ? 'Approved · now waiting for the item to come back' : 'Rejected');
}
async function markReceived(req) {
  const c = structuredClone(req); c.stage = 'received'; c.receivedBy = S.user.email || S.user.id; c.receivedAt = now();
  await save('returnreq', c, req.id); render(); toast('Marked received');
}
// The only step that actually moves money or stock -- same effect the old one-tap doReturn() used to
// apply instantly, now gated behind the item genuinely being back (stage='received') and a manager's
// approval on the ORDER itself (pos_order_guard's own refund-approval check is the real safety net here).
async function completeReturn(req) {
  const o = rec(req.orderId); if (!o) return toast('The original bill was not found', { err: true });
  const idx = req.lineIdx, l = o.lines[idx]; if (!l) return toast('That line is no longer on the bill', { err: true });
  const decision = req.mode === 'exchange' ? 'exchanged' : 'refunded', gAmt = req.give ? req.give.amt : 0;
  const ap = await approve('refund', o.id, (req.mode === 'exchange' ? 'Exchange ' : 'Refund ') + req.qty + ' × ' + req.itemName); if (!ap) return;
  const c = structuredClone(o);
  const it = rec(l.id);
  if (it && it.variants && l.variant) { const v = it.variants.find((x) => x.size === l.variant.size && (x.color || '') === (l.variant.color || '')); if (v) { v.qty = r2((v.qty || 0) + req.qty); await save('item', it, it.id); } }
  if (req.mode === 'exchange' && req.give) { const ni = rec(req.give.itemId); if (ni && ni.variants) { const v = ni.variants.find((x) => x.size === req.give.size && (x.color || '') === (req.give.color || '')); if (v) { v.qty = r2((v.qty || 0) - req.qty); await save('item', ni, ni.id); } } }
  c.exchanges = (c.exchanges || []).concat({ lineIdx: idx, qty: req.qty, type: req.mode, amt: req.amt, give: req.give || null, diff: r2(gAmt - req.amt), reason: req.reason, by: S.user.email || S.user.id, at: now() });
  c.returnApprovedBy = ap;
  await save('order', c, c.id);
  const c2 = structuredClone(req); c2.stage = decision; c2.completedBy = ap; c2.completedAt = now();
  await save('returnreq', c2, req.id);
  render();
  info(req.mode === 'refund' ? 'Refund ' + inr(req.amt) : gAmt > req.amt ? 'Collect ' + inr(r2(gAmt - req.amt)) : gAmt < req.amt ? 'Refund ' + inr(r2(req.amt - gAmt)) : 'Even exchange',
    req.mode === 'refund' ? 'Give the money back and record the refund on the bill if needed.' : gAmt === req.amt ? 'Nothing is owed either way.' : '');
}

function returnReqSub(req) {
  const parts = [req.qty + ' × ' + req.itemName + (req.size ? ' (' + req.size + ')' : ''), inr(req.amt), req.mode === 'exchange' ? 'for ' + ((req.give || {}).itemName || 'another item') : null, 'Bill ' + (req.orderNo || '')];
  return parts.filter(Boolean).join(' · ');
}
function returnReqSheet(req) {
  const rows = [
    ['Requested by', req.requestedBy, req.requestedAt],
    req.decidedBy ? [(req.stage === 'rejected' ? 'Rejected' : 'Approved') + ' by ' + (req.decidedBy.name || req.decidedBy.email || 'a manager'), null, req.decidedAt] : null,
    req.receivedBy ? ['Marked received by', req.receivedBy, req.receivedAt] : null,
    req.completedBy ? [(req.mode === 'exchange' ? 'Exchange completed' : 'Refund completed') + ' by ' + (req.completedBy.name || req.completedBy.email || 'a manager'), null, req.completedAt] : null,
  ].filter(Boolean);
  const body = h('div', { class: 'stack s16' },
    h('div', { class: 'row sp' }, h('b', null, req.itemName + (req.size ? ' (' + req.size + ')' : '')), pill(RETURN_STAGE_TONE[req.stage], RETURN_STAGE_LABEL[req.stage])),
    h('div', { class: 'sub' }, returnReqSub(req)),
    h('div', { class: 'hint' }, 'Reason: ' + (req.reason || '—')),
    h('div', { class: 'list' }, rows.map(([t, sub, at]) => t ? liRow({ title: t, sub: [sub, at ? fmtTime(at) : null].filter(Boolean).join(' · ') }) : null).filter(Boolean)));
  const actions = [];
  if (req.stage === 'pending') { actions.push({ label: 'Reject', danger: true, run: () => decideReturn(req, 'rejected') }); actions.push({ label: 'Approve', primary: true, run: () => decideReturn(req, 'approved') }); }
  else if (req.stage === 'approved') actions.push({ label: 'Mark received', primary: true, run: () => markReceived(req) });
  else if (req.stage === 'received') actions.push({ label: req.mode === 'exchange' ? 'Complete exchange' : 'Complete refund', primary: true, run: () => completeReturn(req) });
  sheet({ title: 'Return / exchange', narrow: true, body, closeLabel: actions.length ? 'Close' : 'Done', actions });
}

V.returns = () => {
  const f = S.retF || 'open', all_ = returnReqs();
  const list = f === 'open' ? all_.filter((r) => !['rejected', 'refunded', 'exchanged'].includes(r.stage)) : f === 'all' ? all_ : all_.filter((r) => r.stage === f);
  const openN = openReturnReqs().length;
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Returns & exchanges'), h('div', { class: 'sub' }, plural(openN, 'open request')))),
    h('div', { style: { maxWidth: '620px', overflowX: 'auto' } }, seg([['open', 'Open'], ['pending', 'Pending'], ['approved', 'Approved'], ['received', 'Received'], ['all', 'All']], f, (v) => { S.retF = v; render(); })),
    list.length
      ? h('div', { class: 'list' }, list.map((r) => liRow({ ic: 'move', tone: RETURN_STAGE_TONE[r.stage], title: r.itemName + (r.size ? ' (' + r.size + ')' : ''), sub: returnReqSub(r), right: pill(RETURN_STAGE_TONE[r.stage], RETURN_STAGE_LABEL[r.stage]), chev: true, onclick: () => returnReqSheet(r) })))
      : empty('move', 'Nothing here', f === 'open' ? 'No return or exchange request is waiting right now.' : 'No requests match this filter.'));
};
