/* Tables: the floor at a glance (live status, guests, time seated, amount, reservations, cleaning),
   and the table operations: choose, move, merge, split a bill. */
'use strict';
const KRANK = { new: 0, preparing: 1, ready: 2, served: 3 };
// an order split off another keeps following that order's kitchen state until the kitchen is done with it
const kstatOf = (o) => { const src = o.kfrom && rec(o.kfrom); return src && src.status !== 'void' && src.kstat && src.kstat !== 'served' && src.kstat !== 'done' && !o.kstat ? src.kstat : o.kstat; };
const TSTATE = {
  free: ['Available', ''], placed: ['Ordering', 'gray'], kot: ['In kitchen', 'orange'], prep: ['Preparing', 'orange'], ready: ['Ready to serve', 'green'],
  bill: ['Served · bill pending', 'accent'], dirty: ['Needs cleaning', 'gray'], res: ['Reserved', 'blue'],
};
function upcomingRes(tid) {
  const t = Date.now();
  return (S.bookings || []).find((b) => b.resource_id === tid && b.date === today() && ['pending', 'confirmed'].includes(b.status) && b.time
    && (() => { const at = new Date(b.date + 'T' + b.time).getTime(); return at - t < 75 * 60000 && t - at < 30 * 60000; })());
}
function tableState(t) {
  const o = tableOrder(t.id);
  if (o) { const k = kstatOf(o); return { st: !k ? 'placed' : k === 'new' ? 'kot' : k === 'preparing' ? 'prep' : k === 'ready' ? 'ready' : 'bill', o, mins: minsSince(o.created), amt: tot(o).total }; }
  if (t.cleaned === false) return { st: 'dirty' };
  const res = upcomingRes(t.id); if (res) return { st: 'res', res };
  return { st: 'free' };
}
const tables = () => L('table').sort((a, b) => String(a.name).localeCompare(b.name, undefined, { numeric: true }));
const sections = () => [...new Set(tables().map((t) => t.sec || 'Main'))];

V.tables = () => {
  const secs = sections(), ts = tables(), sec = secs.includes(S.tblSec) ? S.tblSec : 'all';
  const states = ts.map((t) => [t, tableState(t)]), busyN = states.filter(([, s]) => s.o).length, covers = states.reduce((a, [, s]) => a + ((s.o && s.o.covers) || 0), 0);
  const shown = states.filter(([t]) => sec === 'all' || (t.sec || 'Main') === sec);
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Tables'), h('div', { class: 'sub' }, plural(ts.length - busyN, 'table') + ' free · ' + busyN + ' seated' + (covers ? ' · ' + plural(covers, 'guest') : ''))),
      h('div', { class: 'row' }, h('button', { class: 'btn tinted', onclick: () => { S.cur = newOrder({ type: 'Takeaway' }); go('sell'); } }, icon('sell', 18), 'Takeaway'), isRestaurant() ? h('button', { class: 'btn', onclick: () => go('reserve') }, icon('reserve', 18), 'Reservations') : null)),
    secs.length > 1 ? h('div', { style: { maxWidth: '640px' } }, seg([['all', 'All'], ...secs.map((s) => [s, s])], sec, (v) => { S.tblSec = v; render(); })) : null,
    ts.length ? h('div', { class: 'tables' }, shown.map(([t, s]) => tableTile(t, s))) : empty('tables', 'No tables yet', 'Add tables in the admin console under Menu → Tables & Areas.'),
    ts.length ? h('div', { class: 'legend' }, [['#8e8e93', 'Ordering'], ['#ff9500', 'In kitchen'], ['#34c759', 'Ready'], [getComputedStyle(document.documentElement).getPropertyValue('--accent'), 'Bill pending'], ['#007aff', 'Reserved']].map(([c, l]) => h('span', null, h('i', { style: { background: c } }), l))) : null);
};
function tableTile(t, s) {
  const lab = TSTATE[s.st];
  const sub = s.o ? [h('div', { class: 'ts' }, icon('clock', 14), h('span', { 'data-since': s.o.created }, s.mins + ' min'), s.o.covers ? [' · ', icon('people', 14), String(s.o.covers)] : null), h('div', { class: 'ta' }, inr(s.amt)), h('div', { class: 'ts' }, lab[0])]
    : s.st === 'res' ? [h('div', { class: 'ts' }, 'Reserved ' + s.res.time.slice(0, 5)), h('div', { class: 'ts' }, s.res.customer_name + (s.res.party_size ? ' · ' + s.res.party_size : ''))]
      : [h('div', { class: 'ts' }, s.st === 'dirty' ? [icon('broom', 14), 'Needs cleaning'] : 'Available')];
  return h('button', { class: 'tbl-tile st-' + s.st + (S.cur && S.cur.table === t.id ? ' sel' : ''), 'data-table': t.id, onclick: () => tableTap(t, s) },
    h('div', { class: 'tn' }, t.name), t.seats ? h('span', { class: 'seats' }, icon('people', 13), String(t.seats)) : null, h('div', null, sub));
}
async function tableTap(t, s) {
  if (s.o) { if (S.cur && S.cur.lines.length && !rec(S.cur.id) && S.cur.id !== s.o.id && !(await confirmBox('Discard the unsaved order?', 'You have items in an order that was never saved.', 'Discard', true))) return; S.cur = structuredClone(s.o); return go('sell'); }
  if (s.st === 'dirty') {
    const a = await alertBox({ title: t.name + ' needs cleaning', msg: 'Mark it clean when it is ready for the next guests.', buttons: [{ label: 'Mark cleaned', value: 'clean', def: true }, { label: 'Seat guests anyway', value: 'seat' }, { label: 'Cancel', value: null }] });
    if (a === 'clean') { await save('table', { ...t, cleaned: true, cleanedAt: now(), cleanedBy: S.user.id }, t.id); toast(t.name + ' is ready'); return render(); }
    if (a !== 'seat') return;
    await save('table', { ...t, cleaned: true, cleanedAt: now(), cleanedBy: S.user.id }, t.id);
  }
  if (s.st === 'res') {
    const a = await alertBox({ title: 'Reserved for ' + s.res.customer_name, msg: (s.res.party_size ? s.res.party_size + ' guests · ' : '') + 'at ' + s.res.time.slice(0, 5), buttons: [{ label: 'Seat this reservation', value: 'res', def: true }, { label: 'Seat walk-in guests', value: 'walk' }, { label: 'Cancel', value: null }] });
    if (!a) return;
    if (a === 'res') return seatBooking(s.res, t.id);
  }
  if (S.cur && S.cur.lines.length && !rec(S.cur.id)) { // an unsaved order without a table: put it here
    if (!S.cur.table && S.cur.type === 'Dine-in') { S.cur.table = t.id; return go('sell'); }
    if (!(await confirmBox('Discard the unsaved order?', 'You have items in an order that was never saved.', 'Discard', true))) return;
  }
  S.cur = newOrder({ type: 'Dine-in', table: t.id });
  go('sell');
}
// mode 'assign' (put this order on a table), 'move' (move a saved order), 'pick' (just choose one).
// Resolves to the chosen table id, null for "no table", undefined when cancelled.
function pickTableFor(o, title, mode = 'assign') {
  const move = mode === 'move';
  return new Promise((res) => {
    let done = false;
    const finish = (v) => { done = true; s.close(); res(v); };
    const body = h('div', { class: 'stack s20' }, ...sections().map((sec) => h('div', { class: 'sec' }, h('div', { class: 'lbl' }, sec), h('div', { class: 'tables' }, tables().filter((t) => (t.sec || 'Main') === sec).map((t) => {
      const st = tableState(t), mine = t.id === o.table;
      return h('button', { class: 'tbl-tile st-' + st.st + (mine ? ' sel' : ''), 'data-table': t.id, disabled: mine && mode !== 'pick', onclick: async () => {
        if (mode === 'pick') return finish(t.id);
        if (st.o && st.o.id !== o.id) {
          const a = await alertBox({ title: t.name + ' has an open order', msg: st.o.no + ' · ' + inr(st.amt), buttons: [{ label: 'Merge this order into it', value: 'merge', def: true }, { label: 'Open that order instead', value: 'open' }, { label: 'Cancel', value: null }] });
          if (a === 'merge') { finish(t.id); await mergeOrders(st.o, o); return; }
          if (a === 'open') { finish(t.id); S.cur = structuredClone(st.o); go('sell'); }
          return;
        }
        if (move && rec(o.id)) { finish(t.id); await moveOrder(o, t); return; }
        o.table = t.id; if (t.cleaned === false) await save('table', { ...t, cleaned: true, cleanedAt: now(), cleanedBy: S.user.id }, t.id);
        finish(t.id); render();
      } }, h('div', { class: 'tn' }, t.name), t.seats ? h('span', { class: 'seats' }, icon('people', 13), String(t.seats)) : null, h('div', { class: 'ts' }, TSTATE[st.st][0]));
    })))), mode === 'assign' ? h('button', { class: 'btn wide', onclick: () => { o.table = null; finish(null); render(); } }, 'No table') : null);
    const s = sheet({ title, wide: true, closeLabel: 'Cancel', body, onClose: () => { if (!done) res(undefined); } });
  });
}
const tableSheet = (o) => pickTableFor(o, o.table && rec(o.id) ? 'Move ' + tn(o.table) + ' to' : 'Choose a table', o.table && rec(o.id) ? 'move' : 'assign');
async function moveOrder(o, t) {
  freshCur();
  const from = o.table, c = rec(o.id) ? structuredClone(rec(o.id)) : o;
  if (S.cur && S.cur.id === o.id) Object.assign(c, { lines: S.cur.lines, cust: S.cur.cust, covers: S.cur.covers, disc: S.cur.disc, comment: S.cur.comment });
  c.table = t.id; c.movedFrom = (c.movedFrom || []).concat({ table: from, at: now() });
  await persist(c);
  if (t.cleaned === false) await save('table', { ...t, cleaned: true, cleanedAt: now(), cleanedBy: S.user.id }, t.id);
  if (S.cur && S.cur.id === o.id) S.cur = structuredClone(c);
  toast('Moved ' + (tn(from) || 'order') + ' to ' + t.name); render();
}
// everything from src goes into dest; src is closed as "merged" (kept for the record, not a sale)
async function mergeOrders(dest, src) {
  freshCur();
  const d = structuredClone(rec(dest.id) || dest), s = S.cur && S.cur.id === src.id ? structuredClone(S.cur) : structuredClone(rec(src.id) || src);
  for (const l of s.lines) { const same = d.lines.find((x) => lineKey(x) === lineKey(l) && x.price === l.price); if (same) { same.qty += l.qty; same.sent = (same.sent || 0) + (l.sent || 0); } else d.lines.push({ ...l }); }
  d.covers = (d.covers || 0) + (s.covers || 0) || undefined;
  if (!digits((d.cust || {}).phone) && digits((s.cust || {}).phone)) d.cust = s.cust;
  if (s.kotBatches && s.kotBatches.length) d.kotBatches = (d.kotBatches || []).concat(s.kotBatches.map((b) => ({ ...b, from: s.no })));
  const ks = [d.kstat, s.kstat].filter((k) => k in KRANK).sort((a, b) => KRANK[a] - KRANK[b]);
  if (ks.length) { d.kstat = ks[0]; d.ktime = [d.ktime, s.ktime].filter(Boolean).sort()[0]; }
  d.merged = (d.merged || []).concat({ from: s.no || s.id, table: s.table || null, at: now() });
  await persist(d);
  if (rec(s.id)) { s.status = 'void'; s.voidReason = 'Merged into ' + d.no; s.mergedInto = d.no; s.voidAt = now(); await save('order', s, s.id); }
  if (s.table && s.table !== d.table) { const tb = rec(s.table); if (tb) await save('table', { ...tb, cleaned: false }, tb.id); }
  S.cur = structuredClone(d); toast('Merged into ' + (tn(d.table) || d.no)); go('sell');
}
function mergeIntoSheet(o) {
  const others = openOrders().filter((x) => x.id !== o.id && x.table);
  if (!others.length) return info('No other open tables', 'There is nothing to merge into this order.');
  const s = sheet({ title: 'Merge into ' + (tn(o.table) || 'this order'), narrow: true, body: h('div', { class: 'list' }, others.map((x) => liRow({ ic: 'tables', tone: 'gray', title: tn(x.table), sub: x.no + ' · ' + plural(itemCount(x), 'item'), value: inr(tot(x).total), onclick: async () => {
    s.close(); if (!(await confirmBox('Merge ' + tn(x.table) + ' into ' + tn(o.table) + '?', 'Its items move to this bill and ' + tn(x.table) + ' becomes free.', 'Merge'))) return;
    if (!rec(o.id)) await persist(o);
    await mergeOrders(rec(o.id) || o, x);
  } }))) });
}
// split: move chosen quantities to a new bill (same table, another table, or takeaway), then pay it
async function splitSheet(o) {
  if (!o.lines.length) return;
  if (!rec(o.id)) await persist(o);
  const src = S.cur && S.cur.id === o.id ? S.cur : structuredClone(rec(o.id));
  const pick = new Map(); let dest = 'new';
  const total = h('b', { class: 'num' }, inr(0));
  const recalc = () => { let sum = 0; src.lines.forEach((l, i) => (sum += (pick.get(i) || 0) * l.price)); total.textContent = inr(sum); };
  const rows = src.lines.map((l, i) => liRow({ title: l.name + (l.size ? ' (' + l.size + ')' : ''), sub: inr(l.price) + ' each · ' + l.qty + ' on the bill', right: stepper(0, (v) => { pick.set(i, v); recalc(); }, 0, l.qty) }));
  const opts = [['new', 'New bill'], ...(isRestaurant() && tables().length ? [['table', 'Another table']] : []), ['take', 'Takeaway']];
  sheet({ title: 'Split bill', closeLabel: 'Cancel', body: h('div', { class: 'stack s20' }, h('p', { class: 'sub' }, 'Choose what goes on the new bill.'), h('div', { class: 'list' }, rows),
    field('New bill is for', seg(opts, dest, (v) => (dest = v))), h('div', { class: 'row sp' }, h('span', { class: 'lbl' }, 'New bill subtotal'), total)),
    actions: [{ label: 'Split', primary: true, run: async () => {
      const moving = src.lines.map((l, i) => [l, pick.get(i) || 0]).filter(([, q]) => q > 0);
      if (!moving.length) { toast('Choose at least one item', { err: true }); return false; }
      if (moving.every(([l, q]) => q >= l.qty) && moving.length === src.lines.length) { toast('Leave something on this bill, or move the whole table instead', { err: true }); return false; }
      let table = src.table;
      if (dest === 'table') { table = await pickTableFor({ ...src, id: '_split', table: null }, 'Which table?', 'pick'); if (!table) return false; }
      const target = dest === 'table' ? tableOrder(table) : null;
      const n = target ? structuredClone(target) : newOrder({ type: dest === 'take' ? 'Takeaway' : src.type, table: dest === 'take' ? null : table, cust: dest === 'new' ? { ...(src.cust || {}) } : {}, kfrom: src.id, splitFrom: src.no });
      if (!n.no) n.no = await nextNo();
      const moved = [];
      for (const [l, q] of moving) {
        const sentMove = Math.min(q, l.sent || 0);
        moved.push({ k: lineKey(l), q: sentMove, name: l.name, qty: q });
        const same = n.lines.find((x) => lineKey(x) === lineKey(l) && x.price === l.price);
        if (same) { same.qty += q; same.sent = (same.sent || 0) + sentMove; } else n.lines.push({ ...l, qty: q, sent: sentMove });
        l.qty -= q; l.sent = (l.sent || 0) - sentMove;
      }
      src.lines = src.lines.filter((l) => l.qty > 0);
      src.moves = (src.moves || []).concat({ at: now(), to: n.id, toNo: n.no, items: moved });
      await persist(n); await persist(src);
      S.cur = structuredClone(n);
      toast('Split to ' + n.no); render();
      setTimeout(() => payFlow(S.cur), 250);
    } }] });
}
