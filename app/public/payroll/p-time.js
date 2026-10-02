/* AUZslab Payroll: Time and Leave. Today's board, the month grid, one person's day (clock-ins, marks, corrections),
   shifts, holidays and the roster; leave requests, balances and the leave calendar. */
'use strict';
page('time', {
  title: 'Time', icon: 'clock', perm: 'pay_view',
  async render(v) {
    let view = v.q.get('v') || 'day', date = v.q.get('d') || today(), f = v.q.get('f') || '';
    v.header({ title: 'Time', actions: [can('pay_time') && { label: 'Clock-in kiosk', icon: 'tablet', run: () => go('kiosk') }, can('pay_time') && { label: 'Shifts and holidays', icon: 'calendar', run: () => { view = 'shifts'; paint(); } }] });
    const box = h('div', { class: 'grid' });
    const tabs = seg([['day', 'Day'], ['month', 'Month'], ['shifts', 'Shifts']], view, (x) => { view = x; paint(); }, { label: 'View' });
    v.root.append(tabs, box);
    async function paint() {
      $$('button', tabs).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.v === view)));
      clear(box).append(h('div', { class: 'skel', style: { height: '240px' } }));
      try { if (view === 'day') await dayBoard(); else if (view === 'month') await monthGrid(); else await shiftsView(box); } catch (e) { clear(box).append(empty('alert', 'Could not load', e.message)); }
    }
    async function dayBoard() {
      const d = await api('pay_attendance_day', { p_date: date });
      const rows = d.rows;
      const cnt = (fn) => rows.filter(fn).length;
      const groups = { in: (r) => ['present', 'late', 'missing'].includes(r.status) || (r.status === 'half' && r.first_in), late: (r) => r.status === 'late', leave: (r) => ['leave', 'half_leave'].includes(r.status), out: (r) => ['absent', 'upcoming'].includes(r.status), off: (r) => ['weekly_off', 'holiday'].includes(r.status) };
      const list = h('div');
      const draw = () => {
        const shown = f && groups[f] ? rows.filter(groups[f]) : rows;
        clear(list).append(dataView([
          { key: 'name', label: 'Name', title: true, avatar: (r) => r.name, render: (r) => isDesk() ? h('div', { class: 'row', style: { gap: '10px' } }, avatar(r.name, 30), h('div', null, h('div', { class: 't' }, r.name), h('div', { class: 's' }, r.designation || ''))) : r.name },
          { key: 'first_in', label: 'In', sub: true, render: (r) => r.first_in ? fmtT(r.first_in) + (r.last_out ? ' to ' + fmtT(r.last_out) : isDesk() ? '' : ' · still in') + (!isDesk() && r.worked_mins ? ' · ' + mins(r.worked_mins) : '') : r.leave ? r.leave : r.shift ? r.shift + ' ' + String(r.shift_start).slice(0, 5) : r.mode === 'manual' ? 'Marked by you' : '' },
          { key: 'last_out', label: 'Out', hideDesk: false, render: (r) => r.last_out ? fmtT(r.last_out) : r.first_in && r.status !== 'missing' ? h('span', { class: 'muted' }, 'still in') : '' },
          { key: 'worked_mins', label: 'Worked', r: true, render: (r) => r.worked_mins ? mins(r.worked_mins) + (r.ot_mins ? ' (+' + mins(r.ot_mins) + ')' : '') : '' },
          { key: 'status', label: 'Status', badge: true, render: (r) => h('span', { class: 'row', style: { gap: '6px', justifyContent: 'flex-end' } }, attBadge(r.status), (r.flags || []).includes('out_of_range') ? badge('Away from work', 'orange') : null, r.late_mins ? h('span', { class: 'small muted' }, r.late_mins + 'm') : null) },
        ], shown, { onRow: (r) => daySheet({ id: r.employee_id, name: r.name }, date, () => dayBoard()), empty: empty('users', rows.length ? 'No one here' : 'No one to show', rows.length ? 'Try another filter.' : 'Add people first.') }));
      };
      const pill = (k, label, n, tone) => h('button', { class: 'pill-stat', type: 'button', 'aria-pressed': String(f === k), onclick: (e) => { f = f === k ? '' : k; $$('.pill-stat', e.currentTarget.parentNode).forEach((b) => b.setAttribute('aria-pressed', String(b === e.currentTarget && !!f))); draw(); } }, h('span', { class: 'dotc ' + tone }), h('b', null, String(n)), label);
      const markAll = can('pay_time') && rows.some((r) => r.status === 'absent' || r.status === 'upcoming') ? h('button', { class: 'btn sm', type: 'button', onclick: async () => {
        const ids = rows.filter((r) => ['absent', 'upcoming'].includes(r.status) && !r.locked).map((r) => ({ employee_id: r.employee_id, status: 'present' }));
        if (!ids.length || !(await confirmBox('Mark ' + ids.length + ' as present?', 'Everyone shown as absent or not in yet on ' + fmtD(date) + ' becomes present.', 'Mark present'))) return;
        try { await api('pay_mark_bulk', { p_date: date, p_rows: ids, p_reason: 'Marked present for everyone' }); toast('Marked'); dayBoard(); } catch (e) { fail(e); }
      } }, icon('check', 18), 'Mark all present') : null;
      clear(box).append(
        h('div', { class: 'row sp wrap' }, h('div', { class: 'row', style: { gap: '4px' } },
          h('button', { class: 'btn plain icon', type: 'button', 'aria-label': 'Previous day', onclick: () => { date = addDays(date, -1); dayBoard(); } }, icon('chevL', 22)),
          h('div', { style: { minWidth: '150px', textAlign: 'center' } }, h('div', { style: { fontWeight: 600 } }, date === today() ? 'Today' : fmtD(date, { weekday: true, noYear: true })), d.holiday ? h('div', { class: 'small muted' }, d.holiday) : null),
          h('button', { class: 'btn plain icon', type: 'button', 'aria-label': 'Next day', disabled: date >= today(), onclick: () => { date = addDays(date, 1); dayBoard(); } }, icon('chevR', 22)),
          date !== today() ? h('button', { class: 'btn sm', type: 'button', onclick: () => { date = today(); dayBoard(); } }, 'Today') : null), markAll),
        h('div', { class: 'pill-stats' }, pill('in', 'In', cnt(groups.in), 'green'), pill('late', 'Late', cnt(groups.late), 'orange'), pill('leave', 'On leave', cnt(groups.leave), 'blue'),
          pill('out', date === today() ? 'Not in' : 'Absent', cnt(groups.out), 'red'), cnt(groups.off) ? pill('off', 'Day off', cnt(groups.off), '') : null), list);
      draw();
    }
    let gm = monthOf(date);
    async function monthGrid() {
      const g = await api('pay_attendance_grid', { p_month: gm });
      const n = g.days, first = parseD(gm + '-01');
      const LBL = { P: 'Present', L: 'Late', H: 'Half day', A: 'Absent', M: 'No clock-out', V: 'Leave', h: 'Half leave', O: 'Day off', F: 'Holiday', U: 'Not yet', '-': 'Not employed' };
      const table = h('table', { class: 'agrid' }, h('thead', null, h('tr', null, h('th', { class: 'nm' }, 'Name'),
        Array.from({ length: n }, (_, i) => { const wd = (first.getDay() + i) % 7; return h('th', { title: WEEKDAYS[wd] }, h('div', null, String(i + 1)), h('div', { style: { fontWeight: 400, fontSize: '11px', color: 'var(--label3)' } }, WEEKDAYS[wd][0])); }),
        h('th', null, 'Present'), h('th', null, 'Unpaid'), h('th', null, 'OT h'))),
        h('tbody', null, g.rows.map((r) => h('tr', null, h('td', { class: 'nm' }, h('a', { href: '#/person/' + r.employee_id + '?tab=time' }, r.name)),
          [...(r.cells || '')].map((c, i) => h('td', { class: 'c' }, c === '-' ? h('span', { class: 'muted' }, '·') : h('button', { type: 'button', class: c, title: (LBL[c] || c) + ', ' + (i + 1) + ' ' + monthName(gm, { short: true }),
            'aria-label': r.name + ', ' + (i + 1) + ': ' + (LBL[c] || c), onclick: () => daySheet({ id: r.employee_id, name: r.name }, gm + '-' + pad(i + 1), () => monthGrid()) }, c === 'U' ? '' : c.toUpperCase()))),
          h('td', { class: 'tot' }, String(r.present)), h('td', { class: 'tot' }, qty(r.lop)), h('td', { class: 'tot' }, qty(r.ot_hours))))));
      clear(box).append(h('div', { class: 'row sp wrap' }, h('div', { class: 'row', style: { gap: '4px' } },
        h('button', { class: 'btn plain icon', type: 'button', 'aria-label': 'Previous month', onclick: () => { gm = monthAdd(gm, -1); monthGrid(); } }, icon('chevL', 22)),
        h('h3', { style: { fontSize: '18px', minWidth: '140px', textAlign: 'center' } }, monthName(gm)),
        h('button', { class: 'btn plain icon', type: 'button', 'aria-label': 'Next month', onclick: () => { gm = monthAdd(gm, 1); monthGrid(); } }, icon('chevR', 22))),
        h('button', { class: 'btn sm', type: 'button', onclick: (e) => exportMenu(e.currentTarget, 'attendance-' + gm, ['Name', ...Array.from({ length: n }, (_, i) => String(i + 1)), 'Present', 'Unpaid days', 'Overtime hours'], g.rows.map((r) => [r.name, ...[...(r.cells || '')], r.present, +r.lop, +r.ot_hours])) }, icon('download', 18), 'Export')),
        g.rows.length ? h('div', { class: 'agrid-wrap' }, table) : empty('users', 'No one this month'),
        h('div', { class: 'legend-row' }, Object.entries(LBL).filter(([k]) => !['-', 'U'].includes(k)).map(([k, l]) => h('span', null, h('b', { class: 'tag' }, k.toUpperCase()), l))));
    }
    paint();
  },
});

// One person's day: what happened, and what HR can do about it.
async function daySheet(emp, date, onDone) {
  const body = h('div', { class: 'grid' }, h('div', { class: 'skel', style: { height: '160px' } }));
  const s = sheet({ title: emp.name + ', ' + fmtD(date, { noYear: true }), closeLabel: 'Done', body, noFocus: true, onClose: () => changed && onDone && onDone() });
  let changed = false;
  const paint = async () => {
    const m = await api('pay_attendance_month', { p_emp: emp.id, p_month: monthOf(date) });
    const d = m.days.find((x) => x.date === date) || {};
    const ps = m.punches.filter((p) => { const loc = new Date(new Date(p.at).getTime()); return isoDate(new Date(loc)) === date || (d.first_in && p.at >= d.first_in && (!d.last_out || p.at <= d.last_out)); });
    const reqs = (m.requests || []).filter((r) => r.att_date === date);
    const tm = can('pay_time') && !d.locked;
    clear(body).append(
      h('div', { class: 'row sp' }, attBadge(d.status), d.locked ? badge('In a finalised payroll', '') : null),
      d.locked ? h('p', { class: 'small muted' }, 'This day was paid in a finalised payroll, so it cannot change. Add an adjustment in the next payroll instead.') : null,
      kvList([['Clocked in', d.first_in ? fmtT(d.first_in) : null], ['Clocked out', d.last_out ? fmtT(d.last_out) : d.first_in ? 'Not yet' : null], ['Worked', d.worked_mins ? mins(d.worked_mins) : null],
        ['Late by', d.late_mins ? mins(d.late_mins) : null], ['Overtime', d.ot_mins ? mins(d.ot_mins) : null], ['Leave', d.leave], ['Holiday', d.holiday],
        ['Paid', d.paid != null ? (+d.paid === 1 ? 'Full day' : +d.paid === 0.5 ? 'Half day' : +d.paid === 0 ? 'Not paid' : qty(d.paid) + ' day') : null],
        ['Notes', (d.flags || []).map((x) => ({ out_of_range: 'clocked in away from work', missing_out: 'no clock-out', regularized: 'corrected', manual: 'marked by hand', assumed: 'counted present', projected: 'still ahead', worked_off_day: 'worked on a day off', missing_in: 'no clock-in' }[x] || x)).join(', ') || null]]),
      ps.length ? section('Clock-ins', h('div', { class: 'list' }, ps.map((p) => liRow({ icon: p.voided ? 'x' : p.kind === 'out' ? 'logout' : 'login', tone: p.voided ? 'gray' : p.out_of_range ? 'orange' : 'green',
        title: fmtT(p.at) + (p.voided ? ' (voided)' : ''), sub: { mobile: 'Phone', kiosk: 'Kiosk', pos: 'POS', salon: 'Salon console', admin: 'Added by HR', legacy: 'Old Payroll', demo: 'Sample', import: 'Imported' }[p.source] + (p.distance_m ? ' · ' + p.distance_m + ' m away' : '') + (p.void_reason ? ' · ' + p.void_reason : p.note ? ' · ' + p.note : ''),
        right: tm && !p.voided ? h('button', { class: 'btn sm plain', type: 'button', onclick: async () => { const why = await askText('Void this clock-in?', 'It stays visible but stops counting. Say why.', 'Reason'); if (!why) return; try { await api('pay_void_punch', { p_id: p.id, p_reason: why }); changed = true; paint(); } catch (e) { fail(e); } } }, 'Void') : null })))) : null,
      reqs.length ? section('Correction requests', h('div', { class: 'list' }, reqs.map((r) => liRow({ icon: 'clock', tone: 'gray', title: 'In ' + fmtT(r.in_at) + (r.out_at ? ', out ' + fmtT(r.out_at) : ''), sub: r.reason, badge: reqBadge(r.status) })))) : null,
      tm ? section('Mark this day', h('div', { class: 'chips wrap' }, [['present', 'Present'], ['half', 'Half day'], ['absent', 'Absent'], ['weekly_off', 'Day off'], ['auto', 'Undo mark']].map(([k, l]) =>
        h('button', { class: 'chip', type: 'button', onclick: async () => { try { await api('pay_mark_attendance', { p_emp: emp.id, p_date: date, p: { status: k, reason: 'Marked by HR' } }); changed = true; toast('Saved'); paint(); } catch (e) { fail(e); } } }, l))),
        h('button', { class: 'btn sm', type: 'button', style: { justifySelf: 'start' }, onclick: () => timesSheet() }, icon('clock', 18), 'Set in and out times')) : null);
  };
  const timesSheet = () => {
    const i = input({ type: 'time', value: '10:00' }), o = input({ type: 'time', value: '19:00' }), why = input({ placeholder: 'e.g. Forgot to clock out' });
    sheet({ title: 'In and out times', body: h('div', { class: 'grid' }, h('div', { class: 'two' }, field('In', i), field('Out', o)), field('Why', why),
      h('p', { class: 'small muted' }, 'Clock-ins already recorded stay in the history; these times are used for the day instead.')),
    actions: [{ label: 'Save', primary: true, onclick: async (close) => { await api('pay_mark_attendance', { p_emp: emp.id, p_date: date, p: { in: i.value, out: o.value, reason: why.value || 'Times set by HR' } }); close(); changed = true; toast('Saved'); paint(); } }] });
  };
  try { await paint(); } catch (e) { clear(body).append(empty('alert', 'Could not load', e.message)); }
  return s;
}

// ---------- shifts, holidays ----------
async function shiftsView(box) {
  await loadCtx();
  const sh = S.ctx.shifts || [], hol = (S.ctx.holidays || []).filter((x) => x.date >= today().slice(0, 4) + '-01-01');
  clear(box).append(
    section(h('div', { class: 'row sp' }, h('h3', null, 'Shifts'), can('pay_time') ? h('button', { class: 'btn sm', type: 'button', onclick: () => shiftSheet() }, icon('plus', 18), 'Add') : null),
      sh.length ? h('div', { class: 'list' }, sh.map((s) => liRow({ icon: 'clock', tone: s.active ? '' : 'gray', title: s.name, sub: s.start_time.slice(0, 5) + ' to ' + s.end_time.slice(0, 5) + (s.overnight ? ' (next day)' : '') + ' · ' + mins(s.mins) + ' of work' + (s.break_mins ? ', ' + s.break_mins + 'm break' : ''),
        onclick: can('pay_time') ? () => shiftSheet(s) : null })))
        : h('div', { class: 'card muted' }, 'No shifts. A shift lets the app spot late arrivals, half days and overtime. Without one, any day with a clock-in counts as a full day.')),
    section(h('div', { class: 'row sp' }, h('h3', null, 'Holidays'), can('pay_time') ? h('button', { class: 'btn sm', type: 'button', onclick: () => holidaySheet() }, icon('plus', 18), 'Add') : null),
      hol.length ? h('div', { class: 'list' }, hol.map((x) => liRow({ icon: 'calendar', tone: x.date < today() ? 'gray' : '', title: x.name, sub: fmtD(x.date, { weekday: true }) + (x.location_id ? ' · ' + locName(x.location_id) : ''), onclick: can('pay_time') ? () => holidaySheet(x) : null })))
        : h('div', { class: 'card muted' }, 'No holidays this year. Paid holidays are never counted as absent.')),
    section('Weekly day off', h('div', { class: 'card' }, (org().weekly_off || []).length ? (org().weekly_off || []).map((d) => WEEKDAYS[d]).join(', ') : 'None (only days worked are paid)',
      can('pay_admin') ? h('div', { style: { marginTop: '8px' } }, h('a', { href: '#/settings/time' }, 'Change')) : null)));
}
function shiftSheet(s = {}) {
  const f = { id: s.id, name: s.name || '', start_time: (s.start_time || '10:00').slice(0, 5), end_time: (s.end_time || '19:00').slice(0, 5), break_mins: s.break_mins ?? 60, grace_mins: s.grace_mins ?? '', half_pct: s.half_pct ?? '', active: s.active !== false };
  sheet({ title: s.id ? 'Edit shift' : 'New shift', body: h('div', { class: 'grid' },
    field('Name', input({ value: f.name, placeholder: 'e.g. Morning', oninput: (e) => { f.name = e.target.value; } })),
    h('div', { class: 'two' }, field('Starts', input({ type: 'time', value: f.start_time, oninput: (e) => { f.start_time = e.target.value; } })), field('Ends', input({ type: 'time', value: f.end_time, oninput: (e) => { f.end_time = e.target.value; } }), 'Earlier than the start means the next day')),
    h('div', { class: 'two' }, field('Break (minutes)', input({ type: 'number', mode: 'numeric', value: f.break_mins, oninput: (e) => { f.break_mins = e.target.value; } })), field('Late after (minutes)', input({ type: 'number', mode: 'numeric', value: f.grace_mins, placeholder: String(oset('att', 'late_grace', 15)), oninput: (e) => { f.grace_mins = e.target.value; } }))),
    field('Half day below (% of the shift)', input({ type: 'number', mode: 'numeric', value: f.half_pct, placeholder: String(oset('att', 'half_pct', 55)), oninput: (e) => { f.half_pct = e.target.value; } })),
    s.id ? h('div', { class: 'list' }, toggleRow('In use', f.active, (x) => { f.active = x; })) : null),
  actions: [{ label: 'Save', primary: true, onclick: async (close) => { await api('pay_save_shift', { p: { ...f, break_mins: N(f.break_mins), grace_mins: f.grace_mins === '' ? null : N(f.grace_mins), half_pct: f.half_pct === '' ? null : N(f.half_pct) } }); await loadCtx(); close(); toast('Saved'); route_(); } }] });
}
function holidaySheet(x = {}) {
  const f = { id: x.id, date: x.date || today(), name: x.name || '', location_id: x.location_id || '' };
  sheet({ title: x.id ? 'Holiday' : 'Add a holiday', body: h('div', { class: 'grid' },
    field('Date', dateInput(f.date, { onchange: (e) => { f.date = e.target.value; } })), field('Name', input({ value: f.name, placeholder: 'e.g. Diwali', oninput: (e) => { f.name = e.target.value; } })),
    (S.ctx.locations || []).length > 1 ? field('Where', selectEl([['', 'Everywhere'], ...S.ctx.locations.map((l) => [l.id, l.name])], f.location_id, { onchange: (e) => { f.location_id = e.target.value; } })) : null),
  actions: [x.id ? { label: 'Delete', danger: true, onclick: async (close) => { await api('pay_delete_holiday', { p_id: x.id }); await loadCtx(); close(); route_(); } } : null,
    { label: 'Save', primary: true, onclick: async (close) => { await api('pay_save_holiday', { p: f }); await loadCtx(); close(); toast('Saved'); route_(); } }] });
}

// ---------- leave ----------
page('leave', {
  title: 'Leave', icon: 'leave', perm: 'pay_view',
  async render(v) {
    let f = v.q.get('f') || 'pending';
    v.header({ title: 'Leave', actions: [can('pay_time') && { label: 'Add leave', icon: 'plus', primary: true, run: async () => { const ppl = (await people()).filter((e) => e.status !== 'exited'); pickPerson(ppl, (e) => addLeaveSheet(e)); } },
      { label: 'Balances', icon: 'list', run: () => go('report/leave') }] });
    const box = h('div');
    const paint = async () => {
      clear(box).append(h('div', { class: 'skel', style: { height: '200px' } }));
      const all = (await api('pay_list_requests', { p: { status: f === 'pending' ? 'pending' : 'all' } })).filter((x) => x.type === 'leave' || x.type === 'correction');
      const rows = f === 'upcoming' ? all.filter((x) => x.type === 'leave' && x.status === 'approved' && x.to >= today()).sort((a, b) => a.from > b.from ? 1 : -1) : f === 'pending' ? all : all.filter((x) => x.type === 'leave');
      clear(box).append(rows.length ? (f === 'pending' ? h('div', { class: 'list' }, rows.map((x) => requestRow(x, paint))) :
        h('div', { class: 'list' }, rows.map((x) => liRow({ avatar: x.name, title: x.name, sub: x.title + ' · ' + fmtD(x.from, { noYear: true }) + (x.to && x.to !== x.from ? ' to ' + fmtD(x.to, { noYear: true }) : ''), badge: reqBadge(x.status), onclick: () => go('person/' + x.employee_id + '?tab=leave') }))))
        : empty('leave', f === 'pending' ? 'Nothing waiting' : 'No leave', f === 'pending' ? 'Leave and correction requests from your team show up here.' : ''));
    };
    v.root.append(seg([['pending', 'Waiting'], ['upcoming', 'Coming up'], ['all', 'All']], f, (x) => { f = x; paint(); }, { label: 'Show' }), box);
    paint();
  },
});
function pickPerson(list, onPick) {
  const s = sheet({ title: 'Who', closeLabel: 'Cancel', body: h('div', { class: 'list' }, list.map((e) => liRow({ avatar: e.name, title: e.name, sub: e.designation || '', onclick: () => { s.close(); onPick(e); } }))), noFocus: true });
}
function leaveTypeOpts(gender) { return (S.ctx.leave_types || []).filter((t) => t.active && (!t.gender || t.gender === gender)).map((t) => [t.id, t.name + (t.paid ? '' : ' (unpaid)')]); }
async function addLeaveSheet(e) {
  const opts = leaveTypeOpts(e.gender);
  const f = { leave_type_id: (opts[0] || [])[0], from: today(), to: today(), half: 'none', reason: '', pending: false };
  const toF = h('div');
  const paintTo = () => clear(toF).append(f.half === 'none' ? field('To', dateInput(f.to, { min: f.from, onchange: (ev) => { f.to = ev.target.value; } })) : null);
  sheet({ title: 'Leave for ' + e.name, body: h('div', { class: 'grid' },
    field('Type', selectEl(opts, f.leave_type_id, { onchange: (ev) => { f.leave_type_id = ev.target.value; } })),
    field('From', dateInput(f.from, { onchange: (ev) => { f.from = ev.target.value; if (f.to < f.from) f.to = f.from; paintTo(); } })),
    field('Length', seg([['none', 'Full days'], ['first', 'First half'], ['second', 'Second half']], f.half, (x) => { f.half = x; if (x !== 'none') f.to = f.from; paintTo(); }, { full: true, label: 'Length' })), toF,
    field('Reason', input({ placeholder: 'Optional', oninput: (ev) => { f.reason = ev.target.value; } }))),
  actions: [{ label: 'Add as approved', primary: true, onclick: async (close) => { await api('pay_leave_add', { p_emp: e.id, p: { ...f, to: f.half === 'none' ? f.to : f.from } }); close(); toast('Leave added'); route_(); } }] });
  paintTo();
}
async function leaveLedgerSheet(e, l) {
  const rows = await api('pay_leave_ledger_list', { p_emp: e.id, p_type: l.id });
  const days = input({ type: 'number', mode: 'decimal', placeholder: 'e.g. 2 or -1' }), why = input({ placeholder: 'e.g. Balance from before' });
  const KIND = { opening: 'Opening balance', credit: 'Credited', debit: 'Taken', reverse: 'Given back', lapse: 'Lapsed at year end', encash: 'Paid out', adjust: 'Adjusted' };
  sheet({ title: l.name + ': ' + qty(l.balance) + ' days', body: h('div', { class: 'grid' },
    h('div', { class: 'list' }, rows.length ? rows.map((x) => liRow({ icon: +x.days >= 0 ? 'plus' : 'minus', tone: +x.days >= 0 ? 'green' : 'gray', title: KIND[x.kind] || x.kind, sub: fmtD(x.on_date) + (x.note ? ' · ' + x.note : ''), value: (+x.days > 0 ? '+' : '') + qty(x.days) })) : liRow({ title: 'Nothing yet' })),
    can('pay_time') ? section('Adjust the balance', h('div', { class: 'two' }, field('Days (+ or -)', days), field('Why', why))) : null),
  actions: can('pay_time') ? [{ label: 'Adjust', primary: true, onclick: async (close) => { if (!N(days.value)) { days.classList.add('err'); return false; } await api('pay_leave_adjust', { p_emp: e.id, p_type: l.id, p_days: N(days.value), p_note: why.value, p_opening: false }); close(); toast('Balance changed'); route_(); } }] : [] });
}
