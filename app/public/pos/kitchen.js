/* Kitchen display (KDS): live tickets by station and order type, timers against the target time, cancellations,
   start / ready, recall. Also the KOT report and the pickup token board. */
'use strict';
const KOT_TYPE_COLOR = { 'Dine-in': '#ff9500', Takeaway: '#30b0c7', Delivery: '#34c759', Sale: '#5b7fd6' };
const stations = () => [...new Set(['Kitchen', ...L('item').map((i) => i.st).filter(Boolean)])];
const kdsTarget = () => +cfg().kdsTargetMin || 15;
function kdsOrders() {
  const ty = S.kTy;
  return L('order').filter((o) => o.status !== 'void' && (o.kstat === 'new' || o.kstat === 'preparing') && (ty === 'All' || o.type === ty)).sort((a, b) => (a.ktime > b.ktime ? 1 : -1));
}
const clockText = (iso) => { const t = Math.max(0, Math.round((Date.now() - new Date(iso)) / 1000)); return String(Math.floor(t / 60)).padStart(2, '0') + ':' + String(t % 60).padStart(2, '0'); };

V.kitchen = () => {
  const st = S.kSt, os = kdsOrders(), recent = L('order').filter((o) => o.status !== 'void' && o.readyAt && ['ready', 'served', 'dispatched'].includes(o.kstat) && Date.now() - new Date(o.readyAt) < 30 * 60000).sort((a, b) => (a.readyAt < b.readyAt ? 1 : -1)).slice(0, 8);
  const cards = os.map((o) => kdsCard(o, st)).filter(Boolean);
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Kitchen'), h('div', { class: 'sub' }, plural(cards.length, 'ticket') + ' waiting · target ' + kdsTarget() + ' min')),
      h('div', { class: 'row wrap' }, h('div', { style: { minWidth: '260px' } }, seg([['All', 'All'], ...stations().map((s) => [s, s])], st, (v) => { S.kSt = v; render(); })),
        h('div', { style: { minWidth: '300px' } }, seg([['All', 'All'], ['Dine-in', 'Dine-in'], ['Takeaway', 'Takeaway'], ['Delivery', 'Delivery']], S.kTy, (v) => { S.kTy = v; render(); })))),
    cards.length ? h('div', { class: 'kds' }, cards) : h('div', { class: 'card' }, empty('kitchen', 'No orders waiting', 'New kitchen tickets appear here the moment they are sent.')),
    recent.length ? h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Recently ready')), h('div', { class: 'list' }, recent.map((o) => liRow({ ic: 'check', tone: 'green', title: o.no + ' · ' + o.type + (o.table ? ' · ' + tn(o.table) : ''), sub: 'Ready ' + minsSince(o.readyAt) + ' min ago',
      right: h('button', { class: 'btn sm tinted', onclick: () => recallOrder(o) }, icon('undo', 16), 'Recall') })))) : null);
};
function kdsCard(o, st) {
  const batches = (o.kotBatches && o.kotBatches.length ? o.kotBatches : [{ time: o.ktime, items: o.knew || [] }])
    .map((b) => ({ ...b, items: b.items.filter((x) => st === 'All' || (x.s || 'Kitchen') === st) })).filter((b) => b.items.length);
  if (!batches.length) return null;
  const late = minsSince(o.ktime) >= kdsTarget(), who = (o.captain && o.captain.name) || staffName(o.by);
  return h('div', { class: 'kc' + (late ? ' late' : '') + (o.kstat === 'preparing' ? ' prep' : ''), style: { borderTop: '4px solid ' + (KOT_TYPE_COLOR[o.type] || '#8e8e93') } },
    h('div', { class: 'kc-h' }, h('div', { class: 'grow' }, h('b', null, o.no + (o.table ? ' · ' + tn(o.table) : '')), h('div', { class: 'small sub' }, o.type + (o.covers ? ' · ' + plural(o.covers, 'guest') : '') + (o.token ? ' · Token #' + o.token : '') + (who ? ' · ' + who : ''))),
      h('span', { class: 'clock', 'data-kt': o.ktime }, clockText(o.ktime))),
    h('div', { class: 'kc-b' },
      o.comment ? h('div', { class: 'note' }, o.comment) : null,
      ...batches.flatMap((b, i) => [h('div', { class: 'bt' }, b.cancel ? 'Cancelled · ' + fmtTime(b.time) : 'KOT ' + (b.no ? '#' + b.no : i + 1) + ' · ' + fmtTime(b.time) + (b.from ? ' · from ' + b.from : '')),
        ...b.items.map((x) => h('div', { class: 'it' + (b.cancel || x.q < 0 ? ' cx' : '') }, h('div', null, h('span', null, Math.abs(x.q) + '× ' + x.n), x.note ? h('small', null, x.note) : null)))])),
    h('div', { class: 'kc-f' }, o.kstat === 'new'
      ? h('button', { class: 'btn fill wide', onclick: () => kitchenSet(o, 'preparing') }, 'Start preparing')
      : h('button', { class: 'btn green fill wide', onclick: () => kitchenSet(o, 'ready') }, icon('check', 18), 'Food is ready')));
}
async function kitchenSet(o, k) {
  const c = structuredClone(rec(o.id) || o); c.kstat = k;
  if (k === 'preparing') c.preparingAt = now();
  if (k === 'ready') { c.readyAt = now(); await markKotBatchesReady(o.id); }
  await save('order', c, c.id); render();
}
async function recallOrder(o) { const c = structuredClone(rec(o.id) || o); c.kstat = 'preparing'; c.recalledAt = now(); delete c.readyAt; await save('order', c, c.id); toast(o.no + ' is back in the kitchen'); render(); }
// stamps the KOT log with the time the kitchen finished, for average preparation times
async function markKotBatchesReady(orderId) { for (const k of L('kotlog').filter((x) => x.orderId === orderId && !x.readyAt)) await save('kotlog', { ...k, readyAt: now() }, k.id); }
function avgPrepMinutes(name) { const rows = L('kotlog').filter((k) => k.readyAt && k.items.some((x) => x.n === name || x.n.startsWith(name + ' ('))); if (!rows.length) return null; return Math.round(rows.reduce((a, k) => a + (new Date(k.readyAt) - new Date(k.createdAt)), 0) / rows.length / 60000); }

// ready to serve / out for delivery: shown above every screen so nothing waits at the pass
function readyBanner() {
  const r = L('order').filter((o) => o.kstat === 'ready' && o.status !== 'void');
  if (!r.length) return null;
  return h('div', { class: 'banner ok', 'data-banner': 'ready' }, icon('bell', 22), h('div', { class: 'grow' }, h('b', null, 'Ready to serve'), h('span', { class: 'small' }, plural(r.length, 'order'))),
    h('div', { class: 'chips' }, r.map((o) => { const dine = o.type === 'Dine-in'; return h('button', { class: 'chip', style: { background: 'var(--card)' }, onclick: async () => { const c = structuredClone(rec(o.id) || o); c.kstat = dine ? 'served' : 'dispatched'; if (dine) c.servedAt = now(); else c.dispatchAt = now(); await save('order', c, c.id); render(); } },
      dine ? icon('check', 16) : icon('truck', 16), (dine ? tn(o.table) || o.no : o.type + ' ' + o.no) + (dine ? ' · served' : ' · send')); })));
}
function dispatchedBanner() {
  const r = L('order').filter((o) => o.kstat === 'dispatched' && o.status !== 'void');
  if (!r.length) return null;
  return h('div', { class: 'banner info', 'data-banner': 'dispatched' }, icon('truck', 22), h('div', { class: 'grow' }, h('b', null, 'Out for delivery'), h('span', { class: 'small' }, plural(r.length, 'order'))),
    h('div', { class: 'chips' }, r.map((o) => h('button', { class: 'chip', style: { background: 'var(--card)' }, onclick: async () => { const c = structuredClone(rec(o.id) || o); c.kstat = 'done'; c.deliveredAt = now(); await save('order', c, c.id); render(); } },
      icon('check', 16), o.no + (o.rider ? ' · ' + o.rider.name : '') + ' · ' + minsSince(o.dispatchAt || o.ktime) + ' min'))));
}

// KOT report
V.kotrep = () => {
  const from = S.kotFrom || today(), to = S.kotTo || today(), q = (S.kotQ || '').toLowerCase();
  const rows = L('kotlog').filter((k) => { const d = (k.createdAt || '').slice(0, 10); return d >= from && d <= to && (!q || (k.orderNo || '').toLowerCase().includes(q) || ((k.cust || {}).name || '').toLowerCase().includes(q) || ((k.cust || {}).phone || '').includes(q)); }).sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
  const exportCsv = () => csv([['KOT', 'Order No', 'Type', 'Table', 'Customer', 'Phone', 'Items', 'Item count', 'Created', 'Ready'], ...rows.map((k) => [k.kotNo || '', k.orderNo, k.type, tn(k.table), (k.cust || {}).name, (k.cust || {}).phone, k.items.map((x) => x.q + 'x ' + x.n).join('; '), k.items.reduce((a, x) => a + x.q, 0), k.createdAt, k.readyAt || ''])], 'kot-' + from + '_' + to + '.csv');
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'KOT report'), h('div', { class: 'sub' }, plural(rows.length, 'ticket'))), h('button', { class: 'btn', onclick: exportCsv }, icon('share', 18), 'Export CSV')),
    h('div', { class: 'row wrap' }, h('input', { class: 'input', type: 'date', value: from, style: { width: '170px' }, 'aria-label': 'From', onchange: (e) => { S.kotFrom = e.target.value; render(); } }), h('span', { class: 'sub' }, 'to'),
      h('input', { class: 'input', type: 'date', value: to, style: { width: '170px' }, 'aria-label': 'To', onchange: (e) => { S.kotTo = e.target.value; render(); } }),
      h('div', { class: 'search grow', style: { minWidth: '200px' } }, icon('search', 18), h('input', { class: 'input', placeholder: 'Order, customer or phone', value: S.kotQ || '', 'aria-label': 'Search', onchange: (e) => { S.kotQ = e.target.value; render(); } }))),
    rows.length ? h('div', { class: 'list' }, rows.map((k) => liRow({ ic: 'kot', tone: 'orange', title: (k.kotNo ? 'KOT #' + k.kotNo + ' · ' : '') + k.orderNo + ' · ' + k.type + (k.table ? ' · ' + tn(k.table) : ''), sub: k.items.map((x) => x.q + '× ' + x.n).join(', '), value: fmtTime(k.createdAt) + (k.readyAt ? ' · ' + Math.round((new Date(k.readyAt) - new Date(k.createdAt)) / 60000) + ' min' : '') }))) : h('div', { class: 'card' }, empty('kot', 'No KOTs in this range')));
};
function csv(rows, name) { const s = rows.map((r) => r.map((v) => '"' + String(v ?? '').replace(/"/g, '""') + '"').join(',')).join('\n'), a = h('a', { href: URL.createObjectURL(new Blob([s], { type: 'text/csv' })), download: name }); document.body.append(a); a.click(); a.remove(); }

// pickup token board (Settings -> Hardware -> Token display)
V.token = () => {
  const ready = L('order').filter((o) => o.status !== 'void' && o.kstat === 'ready' && o.type !== 'Dine-in' && o.token && o.tokenDay === today()).sort((a, b) => a.token - b.token);
  return h('div', { class: 'page' }, h('div', { class: 'page-head' }, h('h1', null, 'Ready for pickup')),
    ready.length ? h('div', { class: 'token-grid' }, ready.map((o) => h('button', { class: 'token', onclick: async () => { const c = structuredClone(rec(o.id) || o); c.kstat = 'dispatched'; c.dispatchAt = now(); await save('order', c, c.id); render(); } }, '#' + o.token))) : h('div', { class: 'card' }, empty('token', 'No orders ready right now')));
};
