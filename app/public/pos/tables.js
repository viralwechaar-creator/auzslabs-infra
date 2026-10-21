/* Tables: the floor at a glance (live status, guests, time seated, amount, reservations, cleaning),
   and the table operations: choose, move, merge, split a bill. */
'use strict';
const KRANK = { new: 0, preparing: 1, ready: 2, served: 3 };
// an order split off another keeps following that order's kitchen state until the kitchen is done with it
const kstatOf = (o) => { const src = o.kfrom && rec(o.kfrom); return src && src.status !== 'void' && src.kstat && src.kstat !== 'served' && src.kstat !== 'done' && !o.kstat ? src.kstat : o.kstat; };
const TSTATE = {
  free: ['Available', ''], placed: ['Ordering', 'gray'], kot: ['In kitchen', 'orange'], prep: ['Preparing', 'orange'], ready: ['Ready to serve', 'green'],
  bill: ['Bill pending', 'accent'], dirty: ['Needs cleaning', 'gray'], res: ['Reserved', 'blue'],
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
const tblWide = () => window.matchMedia && matchMedia('(min-width:1100px)').matches;
const tables = () => L('table').sort((a, b) => String(a.name).localeCompare(b.name, undefined, { numeric: true }));
const sections = () => [...new Set(tables().map((t) => t.sec || 'Main'))];

V.tables = () => {
  const secs = sections(), ts = tables(), sec = secs.includes(S.tblSec) ? S.tblSec : 'all';
  const states = ts.map((t) => [t, tableState(t)]), busyN = states.filter(([, s]) => s.o).length, covers = states.reduce((a, [, s]) => a + ((s.o && s.o.covers) || 0), 0);
  const shown = states.filter(([t]) => sec === 'all' || (t.sec || 'Main') === sec), f = S.tblFilter || 'all', filtered = shown.filter(([, st]) => tblMatch(f, st));
  if (!ts.some((t) => t.id === S.tblSel)) S.tblSel = (states.find(([, st]) => st.o) || states[0] || [{}])[0].id;
  const selPair = states.find(([t]) => t.id === S.tblSel), canAdd = S.role === 'owner' || S.role === 'manager';
  return h('div', { class: 'page' },
    h('div', { class: 'page-head' }, h('div', null, h('div', { class: 'eyebrow' }, 'Floor management'), h('h1', null, 'Tables'), h('div', { class: 'sub' }, 'Find open seats fast, spot occupied tables, and manage each bill.')),
      h('div', { class: 'row' }, h('button', { class: 'btn tinted', onclick: () => { S.cur = newOrder({ type: 'Takeaway' }); go('sell'); } }, icon('sell', 18), 'Takeaway'), isRestaurant() ? h('button', { class: 'btn', onclick: () => go('reserve') }, icon('reserve', 18), 'Reservations') : null,
        canAdd ? h('button', { class: 'btn fill', onclick: () => { location.href = '/dashboard.html#menu/tables'; } }, icon('plus', 18), 'Add table') : null)),
    h('div', { class: 'tbl-bar' }, h('div', { class: 'legend' }, [['#34c759', 'Available'], ['var(--accent)', 'Occupied'], ['#8e8e93', 'Needs cleaning'], ['#007aff', 'Reserved']].map(([c, l]) => h('span', null, h('i', { style: { background: c } }), l))), tblFilters(states)),
    secs.length > 1 ? h('div', { style: { maxWidth: '640px' } }, seg([['all', 'All'], ...secs.map((s) => [s, s])], sec, (v) => { S.tblSec = v; render(); })) : null,
    ts.length ? h('div', { class: 'tbl-wrap' },
      h('div', { class: 'tbl-main card' }, h('div', { class: 'row sp' }, h('div', null, h('h2', { class: 'tbl-h' }, sec === 'all' ? 'Dining floor' : sec), h('div', { class: 'sub' }, (secs.length > 1 && sec === 'all' ? secs.join(', ') + ' · ' : '') + plural(shown.length, 'table'))),
        canAdd ? h('button', { class: 'btn plain', onclick: () => { location.href = '/dashboard.html#menu/tables'; } }, 'Edit layout ↗') : null),
        filtered.length ? h('div', { class: 'tables' }, filtered.map(([t, s]) => tableTile(t, s))) : h('div', { class: 'empty' }, h('b', null, 'No tables in this view'), h('div', null, 'Choose another status above.'))),
      tblSide(states, covers, selPair))
      : empty('tables', 'No tables yet', 'Add tables in the admin console under Menu → Tables & Areas.'));
};

// ---- the floor summary: filter chips with counts, and a side panel of what needs doing next ----
const tblMatch = (f, st) => f === 'all' || (f === 'free' && st.st === 'free') || (f === 'seated' && !!st.o) || (f === 'ready' && st.st === 'ready') || (f === 'dirty' && st.st === 'dirty') || (f === 'res' && st.st === 'res');
function tblFilters(states) {
  const defs = [['all', 'All tables'], ['free', 'Available'], ['seated', 'Occupied'], ['ready', 'Ready'], ['dirty', 'Cleaning'], ['res', 'Reserved']], f = S.tblFilter || 'all';
  return h('div', { class: 'chips tbl-chips', role: 'toolbar', 'aria-label': 'Filter tables' }, defs.map(([k, l]) => { const n = states.filter(([, st]) => tblMatch(k, st)).length; return (k === 'all' || n || f === k) ? h('button', { class: 'chipf' + (f === k ? ' on' : ''), 'data-tf': k, onclick: () => { S.tblFilter = k; render(); } }, l, h('b', null, String(n))) : null; }));
}

// the selected table: what is on it and the next action (wide screens; on a phone a tap goes straight to the order)
function tblDetail(t, s) {
  const lab = TSTATE[s.st][0], guests = s.o && s.o.covers;
  const line = (k, v) => h('div', { class: 'dline' }, h('span', null, k), h('b', null, v));
  const body = s.o ? [line('Bill', s.o.no || '—'), line('Items', plural(itemCount(s.o), 'item')), line('Running time', s.mins + ' min'), line('Bill total', inr(s.amt))]
    : [h('div', { class: 'dempty' }, h('b', null, s.st === 'free' ? 'Table available' : s.st === 'res' ? 'Reservation scheduled' : s.st === 'dirty' ? 'Cleaning in progress' : lab), s.st === 'free' ? 'Start a new order for this table.' : s.st === 'res' ? s.res.customer_name + ' · ' + s.res.time.slice(0, 5) + (s.res.party_size ? ' · ' + plural(s.res.party_size, 'guest') : '') : 'Mark it clean when it is ready for the next guests.')];
  const primary = s.o ? 'Open table bill →' : s.st === 'dirty' ? 'Mark cleaned' : s.st === 'res' ? 'Seat this reservation' : 'Start order →';
  return h('div', { class: 'card tbl-detail' },
    h('div', { class: 'dban' }, h('small', null, 'SELECTED TABLE'), h('h2', null, t.name + (t.sec ? ' · ' + t.sec : '')), h('p', null, lab + (guests ? ' · ' + plural(guests, 'guest') : '') + (s.o ? ' · ' + s.mins + ' min' : '') + (t.seats ? ' · ' + t.seats + ' seats' : ''))),
    h('div', { class: 'dbody' }, h('h3', null, s.o ? 'Current bill' : 'Table'), ...body,
      h('div', { class: 'dact' }, h('button', { class: 'btn fill wide', 'data-act': 'open', onclick: () => (s.st === 'dirty' ? markClean(t) : s.st === 'res' ? seatBooking(s.res, t.id) : tableTap(t, s)) }, primary),
        h('button', { class: 'btn wide', 'data-act': 'status', onclick: () => tableStatusSheet(t, s) }, 'Change table status'))));
}
async function markClean(t) { await save('table', { ...t, cleaned: true, cleanedAt: now(), cleanedBy: S.user.id }, t.id); toast(t.name + ' is ready'); render(); }
function tableStatusSheet(t, s) {
  const opt = (ic, title, sub, run) => liRow({ ic, tone: 'gray', title, sub, chev: true, onclick: async () => { sh.close(); await run(); } });
  const rows = [];
  if (s.o) {
    rows.push(opt('move', 'Move to another table', 'The bill follows the guests', () => tableSheet(s.o)));
    rows.push(opt('merge', 'Merge into another table', 'Join this bill with an open one', () => mergeIntoSheet(s.o)));
    rows.push(opt('move', 'Split the bill', 'Move some items to a new bill', () => splitSheet(s.o)));
  } else {
    if (s.st === 'dirty') rows.push(opt('broom', 'Mark as cleaned', 'Ready for the next guests', () => markClean(t)));
    else rows.push(opt('broom', 'Mark as needs cleaning', 'Show it as not ready', async () => { await save('table', { ...t, cleaned: false }, t.id); toast(t.name + ' needs cleaning'); render(); }));
    if (s.st === 'res') rows.push(opt('people', 'Seat this reservation', s.res.customer_name, () => seatBooking(s.res, t.id)));
    if (isRestaurant()) rows.push(opt('reserve', 'Reserve this table', 'Open Reservations', () => go('reserve')));
  }
  const sh = sheet({ title: t.name + ' · change status', narrow: true, closeLabel: 'Close', body: h('div', { class: 'list' }, rows) });
}
function tblSide(states, covers, selPair) {
  const seated = states.filter(([, st]) => st.o), running = seated.reduce((a, [, st]) => a + (st.amt || 0), 0);
  const stat = (v, l) => h('div', { class: 'tstat' }, h('b', null, v), h('span', null, l));
  const ready = states.filter(([, st]) => st.st === 'ready'), dirty = states.filter(([, st]) => st.st === 'dirty'), slow = seated.filter(([, st]) => st.st !== 'ready' && st.mins >= 60);
  const attn = [
    ...ready.map(([t, st]) => liRow({ ic: 'bell', tone: 'green', title: t.name + ' is ready to serve', sub: st.o.no + ' · ' + inr(st.amt), chev: true, onclick: () => tableTap(t, st) })),
    ...slow.map(([t, st]) => liRow({ ic: 'clock', tone: 'orange', title: t.name + ' seated ' + st.mins + ' min', sub: st.o.no + ' · ' + inr(st.amt), chev: true, onclick: () => tableTap(t, st) })),
    ...dirty.map(([t]) => liRow({ ic: 'broom', tone: 'gray', title: t.name + ' needs cleaning', right: h('button', { class: 'btn tinted sm', onclick: async (e) => { e.stopPropagation(); await save('table', { ...t, cleaned: true, cleanedAt: now(), cleanedBy: S.user.id }, t.id); toast(t.name + ' is ready'); render(); } }, 'Mark clean') })),
  ];
  const nowT = Date.now(), res = (S.bookings || []).filter((b) => b.date === today() && ['pending', 'confirmed'].includes(b.status) && b.time && new Date(b.date + 'T' + b.time).getTime() > nowT - 30 * 60000).sort((a, b) => String(a.time).localeCompare(String(b.time))).slice(0, 4);
  return h('aside', { class: 'tbl-side' }, selPair ? tblDetail(selPair[0], selPair[1]) : null,
    h('div', { class: 'card tblsum' }, h('div', { class: 'tstats' }, stat(String(states.filter(([, st]) => st.st === 'free').length), 'Available'), stat(String(seated.length), 'Seated'), stat(String(covers), 'Guests'), stat(inr(running), 'Running bills'))),
    h('div', { class: 'card' }, h('div', { class: 'lbl' }, 'Needs attention'), attn.length ? h('div', { class: 'list' }, attn) : h('div', { class: 'sub', style: { padding: '6px 0' } }, 'Nothing waiting. Tables are on track.')),
    isRestaurant() ? h('div', { class: 'card' }, h('div', { class: 'row sp' }, h('div', { class: 'lbl' }, 'Coming up today'), h('button', { class: 'btn plain sm', onclick: () => go('reserve') }, 'All reservations')),
      res.length ? h('div', { class: 'list' }, res.map((b) => liRow({ ic: 'people', tone: 'blue', title: b.time.slice(0, 5) + ' · ' + b.customer_name, sub: (b.party_size ? plural(b.party_size, 'guest') + ' · ' : '') + (tn(b.resource_id) || 'No table yet'), chev: true, onclick: () => go('reserve') }))) : h('div', { class: 'sub', style: { padding: '6px 0' } }, 'No more bookings today.')) : null);
}
function tableTile(t, s) {
  const lab = TSTATE[s.st][0];
  const meta = s.o ? [h('span', { class: 'tc' }, icon('clock', 13), h('span', { 'data-since': s.o.created }, s.mins + ' min'), s.o.covers ? ' · ' + s.o.covers + ' guests' : null), h('b', { class: 'ta' }, inr(s.amt))]
    : s.st === 'res' ? [h('span', { class: 'tc' }, s.res.time.slice(0, 5) + ' · ' + s.res.customer_name)] : [h('span', { class: 'tc' }, t.sec || 'Main')];
  return h('button', { class: 'tbl-tile st-' + s.st + ((S.cur && S.cur.table === t.id) || S.tblSel === t.id ? ' sel' : ''), 'data-table': t.id, onclick: () => { if (tblWide()) { S.tblSel = t.id; render(); } else tableTap(t, s); } },
    h('div', { class: 'ttop' }, h('div', { class: 'tn' }, t.name), t.seats ? h('span', { class: 'seats' }, t.seats + ' seats') : null),
    h('span', { class: 'tchip' }, lab), h('div', { class: 'tmeta' }, meta));
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
