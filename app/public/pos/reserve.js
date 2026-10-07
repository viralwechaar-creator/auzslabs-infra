/* Reservations (the bookings table: the database refuses two overlapping reservations on one table) and the
   walk-in waitlist (records of kind 'waitlist', works offline), with seating straight into a dine-in order. */
'use strict';
const RES_SOURCES = ['Phone', 'Walk-in', 'Website', 'Zomato', 'Other'];
const RES_STATUS = { pending: ['Requested', 'orange'], confirmed: ['Confirmed', 'blue'], seated: ['Seated', 'green'], completed: ['Done', ''], cancelled: ['Cancelled', ''], no_show: ['No-show', 'red'] };
S.resByDay = {};

async function loadBookings(day) {
  if (!navigator.onLine || !S.user) return S.resByDay[day] || [];
  const { data, error } = await sb.from('bookings').select('*').eq('date', day);
  if (error) return S.resByDay[day] || [];
  const o = outletId(), rows = (data || []).map((b) => ({ ...b, date: String(b.date).slice(0, 10), time: b.time ? String(b.time).slice(0, 5) : b.time })).filter((b) => o === 'all' || !b.outlet || b.outlet === o).sort((a, b) => String(a.time || '').localeCompare(String(b.time || '')));
  S.resByDay[day] = rows; if (day === today()) S.bookings = rows;
  return rows;
}
const addMinutes = (t, m) => { const [hh, mm] = t.split(':').map(Number), x = Math.min(hh * 60 + mm + m, 23 * 60 + 59); return String(Math.floor(x / 60)).padStart(2, '0') + ':' + String(x % 60).padStart(2, '0'); };
const resErr = (e) => (e && e.status === 409 ? 'That table is already reserved for an overlapping time. Choose another table or time.' : (e && e.message) || 'Could not save');

// A new reservation request (public_create_reservation, db/127 -- e.g. a customer booking a table
// from the business's own public website) used to only ever show up as a "notification" in the
// guest-order inbox and never in the real Reservations list at all. Now it's a real bookings row,
// so the realtime "something changed" ping on that table (subscribed in shell.js) just needs to
// refetch and, for a genuinely new customer-made request, say so -- same spirit as getG()'s alert
// for a new guest order, just for the Reservations screen instead.
async function onBookingsChanged() {
  if (!navigator.onLine || !S.user) return;
  const days = new Set([today(), S.resDay || today()]);
  for (const day of days) {
    const before = S.resByDay[day] || [];
    const beforeIds = new Set(before.map((b) => b.id));
    const after = await loadBookings(day);
    const fresh = after.filter((b) => !beforeIds.has(b.id) && b.status === 'pending');
    fresh.forEach((b) => toast('New reservation request · ' + b.customer_name + (b.time ? ' · ' + b.time.slice(0, 5) : '')));
  }
  if (['tables', 'reserve'].includes(S.tab) && !isTyping()) render();
}

V.reserve = () => {
  const day = S.resDay || today(), seg0 = S.resSeg || 'res';
  const rows = S.resByDay[day];
  if (!rows && navigator.onLine) loadBookings(day).then(() => { if (S.tab === 'reserve' && !isTyping()) render(); });
  const wl = L('waitlist').filter((w) => w.d === today() && w.status === 'waiting').sort((a, b) => a.no - b.no);
  const dayChips = [today(), addDays(today(), 1), addDays(today(), 2)];
  const head = h('div', { class: 'page-head' }, h('div', null, h('h1', null, 'Reservations'), h('div', { class: 'sub' }, seg0 === 'res' ? fmtDay(day) + ' · ' + plural((rows || []).filter((b) => !['cancelled', 'no_show'].includes(b.status)).length, 'booking') : plural(wl.length, 'party', 'parties') + ' waiting')),
    h('button', { class: 'btn fill', onclick: () => (seg0 === 'res' ? resSheet({ date: day }) : waitSheet()) }, icon('plus', 18), seg0 === 'res' ? 'New reservation' : 'Add to waitlist'));
  const tabs = h('div', { style: { maxWidth: '420px' } }, seg([['res', 'Reservations'], ['wait', 'Waitlist' + (wl.length ? ' (' + wl.length + ')' : '')]], seg0, (v) => { S.resSeg = v; render(); }));
  if (seg0 === 'wait') return h('div', { class: 'page' }, head, tabs, wl.length ? h('div', { class: 'list' }, wl.map(waitRow)) : h('div', { class: 'card' }, empty('people', 'Nobody waiting', 'Add walk-in guests when every table is taken. They get a queue number and a quoted wait.')));
  return h('div', { class: 'page' }, head, tabs,
    h('div', { class: 'row wrap' }, h('div', { class: 'chips' }, dayChips.map((d, i) => h('button', { class: 'chip' + (d === day ? ' on' : ''), onclick: () => { S.resDay = d; render(); } }, i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : fmtDay(d)))),
      h('input', { class: 'input', type: 'date', value: day, style: { width: '170px' }, 'aria-label': 'Day', onchange: (e) => { S.resDay = e.target.value || today(); render(); } })),
    !navigator.onLine ? h('div', { class: 'banner warn' }, icon('alert', 20), 'Reservations need an internet connection.') : null,
    rows === undefined ? h('div', { class: 'card' }, empty('reserve', 'Loading…')) : rows.length ? h('div', { class: 'list' }, rows.map(resRow)) : h('div', { class: 'card' }, empty('reserve', 'No reservations', 'Tap New reservation to book a table.')));
};
function resRow(b) {
  const sp = RES_STATUS[b.status] || ['', ''], late = b.date === today() && ['pending', 'confirmed'].includes(b.status) && b.time && new Date(b.date + 'T' + b.time) < new Date(Date.now() - 15 * 60000);
  return liRow({ ic: 'reserve', tone: b.status === 'seated' ? 'green' : late ? 'red' : 'blue', title: (b.time ? b.time.slice(0, 5) + ' · ' : '') + b.customer_name + (b.party_size ? ' · ' + plural(b.party_size, 'guest') : ''),
    sub: [b.resource_id ? tn(b.resource_id) || 'Table' : 'No table yet', b.customer_phone, b.source, b.note, late ? 'running late' : null].filter(Boolean).join(' · '), right: pill(sp[0], sp[1]), chev: true, onclick: () => resActions(b) });
}
function resActions(b) {
  const active = ['pending', 'confirmed'].includes(b.status);
  const setStatus = async (st, extra) => { const { error } = await sb.from('bookings').update({ status: st, ...(extra || {}) }).eq('id', b.id); if (error) return toast(resErr(error), { err: true }); await loadBookings(b.date); toast(RES_STATUS[st][0]); render(); };
  const s = sheet({ title: b.customer_name, narrow: true, body: h('div', { class: 'stack' },
    h('div', { class: 'list' }, liRow({ title: 'When', value: fmtDay(b.date) + (b.time ? ', ' + b.time.slice(0, 5) : '') }), liRow({ title: 'Guests', value: String(b.party_size || '—') }), liRow({ title: 'Table', value: b.resource_id ? tn(b.resource_id) : 'Not assigned' }), b.note ? liRow({ title: 'Note', sub: b.note }) : null),
    h('div', { class: 'list' },
      active && b.date === today() ? liRow({ ic: 'door', tone: 'green', title: 'Seat now', chev: true, onclick: () => { s.close(); seatBooking(b); } }) : null,
      active ? liRow({ ic: 'edit', tone: 'gray', title: 'Change', chev: true, onclick: () => { s.close(); resSheet(b); } }) : null,
      b.status === 'pending' ? liRow({ ic: 'check', tone: 'blue', title: 'Confirm', onclick: () => { s.close(); setStatus('confirmed'); } }) : null,
      b.customer_phone ? liRow({ ic: 'chat', tone: 'green', title: 'Send confirmation on WhatsApp', chev: true, onclick: () => { open(waLink(b.customer_phone, `Hi ${b.customer_name}, your table${b.party_size ? ' for ' + b.party_size : ''} at ${cfg().name} is confirmed for ${fmtDay(b.date)}${b.time ? ' at ' + fmtTime(b.date + 'T' + b.time) : ''}. See you soon!`), '_blank'); } }) : null,
      active ? liRow({ ic: 'x', tone: 'orange', title: 'No-show', onclick: () => { s.close(); setStatus('no_show'); } }) : null,
      active ? liRow({ ic: 'trash', tone: 'red', title: 'Cancel reservation', onclick: async () => { s.close(); if (await confirmBox('Cancel this reservation?', b.customer_name + (b.time ? ' at ' + b.time.slice(0, 5) : ''), 'Cancel reservation', true)) setStatus('cancelled'); } }) : null)) });
}
function resSheet(b = {}) {
  const editing = !!b.id, c = cfg();
  const f = { name: input({ value: b.customer_name || '', placeholder: 'Guest name', focus: true }), phone: input({ value: b.customer_phone || '', placeholder: '10-digit mobile', type: 'tel', mode: 'tel' }), date: input({ type: 'date', value: b.date || today() }),
    time: input({ type: 'time', value: (b.time || '20:00').slice(0, 5) }), note: input({ value: b.note || '', placeholder: 'Birthday, window seat, high chair…' }) };
  let party = b.party_size || 2, table = b.resource_id || '', src = b.source || 'Phone';
  const tableSel = h('div');
  const drawTables = () => tableSel.replaceChildren(selectEl([['', 'Decide on arrival'], ...tables().filter((t) => !t.seats || +t.seats >= party).map((t) => [t.id, t.name + (t.seats ? ' · ' + t.seats + ' seats' : '') + (t.sec && t.sec !== 'Main' ? ' · ' + t.sec : '')])], table, (e) => (table = e.target.value)));
  drawTables();
  sheet({ title: editing ? 'Change reservation' : 'New reservation', closeLabel: 'Cancel', body: h('div', { class: 'stack s20' },
    h('div', { class: 'grid2 stack-phone' }, field('Name', f.name), field('Phone', f.phone)),
    h('div', { class: 'grid2' }, field('Date', f.date), field('Time', f.time)),
    h('div', { class: 'row sp' }, h('span', { class: 'lbl' }, 'Guests'), stepper(party, (v) => { party = v; drawTables(); }, 1, 60)),
    field('Table', tableSel, 'Only tables with enough seats are listed. The same table cannot be booked twice for overlapping times.'),
    field('Booked through', seg(RES_SOURCES.map((x) => [x, x]), src, (v) => (src = v))), field('Note', f.note)),
    actions: [{ label: editing ? 'Save' : 'Reserve', primary: true, run: async () => {
      if (!f.name.value.trim() || digits(f.phone.value).length < 10) { toast('A name and a 10-digit phone are needed', { err: true }); return false; }
      if (!navigator.onLine) { toast('Reservations need an internet connection', { err: true }); return false; }
      const row = { customer_name: f.name.value.trim(), customer_phone: f.phone.value.trim(), date: f.date.value, time: f.time.value, end_time: addMinutes(f.time.value, +c.resMinutes || 90), party_size: party, resource_id: table || null, note: f.note.value.trim() || null, source: src, outlet: outletKey() };
      const { error } = editing ? await sb.from('bookings').update(row).eq('id', b.id) : await sb.from('bookings').insert({ ...row, status: 'confirmed', items: [], total: 0 });
      if (error) { toast(resErr(error), { err: true }); return false; }
      await loadBookings(row.date); S.resDay = row.date; S.resSeg = 'res'; toast(editing ? 'Reservation updated' : 'Reserved for ' + row.customer_name); render();
    } }] });
}
async function seatBooking(b, tableId) {
  let t = tableId || b.resource_id;
  if (t && busyTable(t)) { await info(tn(t) + ' is still occupied', 'Choose another table for this reservation.'); t = null; }
  if (!t) t = await pickTableFor({ id: '_res', table: null, lines: [] }, 'Seat ' + b.customer_name + ' at', 'pick');
  if (!t) return;
  if (busyTable(t)) return info(tn(t) + ' has an open order', 'Choose a free table.');
  const { error } = await sb.from('bookings').update({ status: 'seated', resource_id: t }).eq('id', b.id);
  if (error) return toast(resErr(error), { err: true });
  const tb = rec(t); if (tb && tb.cleaned === false) await save('table', { ...tb, cleaned: true, cleanedAt: now(), cleanedBy: S.user.id }, t);
  S.cur = newOrder({ type: 'Dine-in', table: t, cust: { name: b.customer_name, phone: b.customer_phone }, covers: b.party_size || undefined, resId: b.id, comment: b.note || undefined });
  loadBookings(b.date); toast(b.customer_name + ' seated at ' + tn(t)); go('sell');
}

// walk-in waitlist
function waitRow(w) {
  const waited = minsSince(w.at), over = w.quoted && waited > w.quoted;
  return liRow({ ic: 'people', tone: over ? 'red' : 'teal', title: '#' + w.no + ' · ' + w.name + ' · ' + plural(w.party, 'guest'), sub: 'Waiting ' + waited + ' min' + (w.quoted ? ' · quoted ' + w.quoted + ' min' : '') + (w.notifiedAt ? ' · told ' + fmtTime(w.notifiedAt) : ''), chev: true, onclick: () => waitActions(w) });
}
function waitActions(w) {
  const upd = async (patch, msg) => { await save('waitlist', { ...w, ...patch }, w.id); if (msg) toast(msg); render(); };
  const s = sheet({ title: '#' + w.no + ' · ' + w.name, narrow: true, body: h('div', { class: 'list' },
    liRow({ ic: 'door', tone: 'green', title: 'Seat now', chev: true, onclick: async () => {
      s.close(); const t = await pickTableFor({ id: '_wait', table: null, lines: [] }, 'Seat ' + w.name + ' at', 'pick'); if (!t) return;
      if (busyTable(t)) return info(tn(t) + ' has an open order', 'Choose a free table.');
      await upd({ status: 'seated', table: t, seatedAt: now() });
      S.cur = newOrder({ type: 'Dine-in', table: t, cust: { name: w.name, phone: w.phone || '' }, covers: w.party }); go('sell');
    } }),
    w.phone ? liRow({ ic: 'chat', tone: 'green', title: 'Tell them the table is ready', chev: true, onclick: () => { s.close(); open(waLink(w.phone, `Hi ${w.name}, your table at ${cfg().name} is ready. Please come to the host stand.`), '_blank'); upd({ notifiedAt: now() }); } }) : null,
    liRow({ ic: 'x', tone: 'red', title: 'Left without a table', onclick: () => { s.close(); upd({ status: 'left', leftAt: now() }, w.name + ' removed'); } })) });
}
function waitSheet() {
  const f = { name: input({ placeholder: 'Guest name', focus: true }), phone: input({ placeholder: 'Phone (for the ready message)', type: 'tel', mode: 'tel' }) };
  let party = 2, quoted = 15;
  sheet({ title: 'Add to waitlist', narrow: true, closeLabel: 'Cancel', body: h('div', { class: 'stack s20' }, field('Name', f.name), field('Phone', f.phone),
    h('div', { class: 'row sp' }, h('span', { class: 'lbl' }, 'Guests'), stepper(party, (v) => (party = v), 1, 60)),
    field('Quoted wait', seg([[10, '10 min'], [15, '15'], [20, '20'], [30, '30'], [45, '45']], quoted, (v) => (quoted = v)))),
    actions: [{ label: 'Add', primary: true, run: async () => {
      if (!f.name.value.trim()) { toast('Add a name', { err: true }); return false; }
      const no = L('waitlist').filter((x) => x.d === today()).reduce((a, x) => Math.max(a, x.no || 0), 0) + 1;
      await save('waitlist', { name: f.name.value.trim(), phone: f.phone.value.trim(), party, quoted, at: now(), d: today(), status: 'waiting', no });
      S.resSeg = 'wait'; toast('#' + no + ' ' + f.name.value.trim() + ' added'); render();
    } }] });
}
