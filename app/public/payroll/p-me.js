/* AUZslab Payroll: self-service. What every employee sees for themselves (their day, time, leave, pay and profile),
   what a line manager sees for their team, and the shared clock-in kiosk. Built for someone who has never used HR
   software: one big button, plain words, nothing they cannot act on. All of it goes through pay_me_* functions, which only
   ever touch the signed-in person's own record. */
'use strict';
let ME = null;
async function me(force) {
  if (!ME || force) {
    try { ME = await api('pay_me'); S.me = ME; try { localStorage['pay.me'] = JSON.stringify(ME); } catch {} }
    catch (e) {
      // no connection (a failure with no HTTP status): show the last saved day so a clock-in can still be taken
      let c = null; if (!e.status) { try { c = JSON.parse(localStorage['pay.me'] || 'null'); } catch {} }
      if (!c) throw e;
      ME = c; ME._offline = true; S.me = ME;
    }
  }
  if (ME && ME._offline) { const q = punchQueue(); if (q.length && ME.punch) ME.punch = { ...ME.punch, open: (q.length % 2 === 1) ? !ME.punch.open : ME.punch.open, last: q[q.length - 1].at, ...((q.length % 2 === 1 && !ME.punch.open) ? { in: q[q.length - 1].at } : {}) }; }
  return ME;
}
// ---- offline clock-ins: kept on this phone with the real time, sent when the connection is back (db/120) ----
const punchQueue = () => { try { return JSON.parse(localStorage['pay.punchq'] || '[]'); } catch { return []; } };
const savePunchQueue = (q) => { try { localStorage['pay.punchq'] = JSON.stringify(q); } catch {} };
let flushing = false;
async function flushPunchQueue() {
  if (flushing || !navigator.onLine) return;
  flushing = true;
  try {
    for (const it of punchQueue()) {
      try {
        await api('pay_me_punch_offline', { p: it });
        savePunchQueue(punchQueue().filter((x) => x.op !== it.op));
      } catch (e) {
        if (!e.status || e.status >= 500 || e.status === 401 || e.status === 408 || e.status === 429) break;   // still offline / server busy / signed out: keep the rest
        savePunchQueue(punchQueue().filter((x) => x.op !== it.op));                                          // refused for a real reason: tell the person once
        toast('A clock-in saved offline was not accepted: ' + e.message, { err: true });
      }
    }
    if (!punchQueue().length && ME) { ME._offline = false; if (typeof renderCurrent === 'function') { /* page refreshes itself on its next visit */ } }
  } finally { flushing = false; }
}
addEventListener('online', flushPunchQueue);
setInterval(flushPunchQueue, 60000);
setTimeout(flushPunchQueue, 3000);
const LEAVE_HALF = [['none', 'Full days'], ['first', 'Morning off'], ['second', 'Afternoon off']];

// ---------- Today ----------
page('today', {
  title: 'Today', tabLabel: 'Today', icon: 'home', ess: true,
  async render(v) {
    const d = await me(true), e = d.employee, p = d.punch || {}, t = d.today || {};
    v.header({ title: 'Hi, ' + e.name.split(' ')[0], sub: fmtD(d.date, { weekday: true }) + (e.designation ? ' · ' + e.designation : '') });
    if (d._offline) v.root.append(banner('orange', 'alert', 'You are offline. Showing your last saved day. Clock-ins are kept on this phone with the right time and sent when you are back online.'));
    if (e.status === 'exited') { v.root.append(banner('info', 'info', 'Your last day was ' + fmtD(e.last_day) + '. Your payslips stay here.')); }
    if (e.mode === 'punch' && ['active', 'notice'].includes(e.status)) v.root.append(punchCard(d, v));
    else if (['active', 'notice'].includes(e.status)) v.root.append(h('div', { class: 'card row', style: { gap: '12px' } }, h('span', { class: 'tile ' + ((ATT[t.status] || [])[1] || 'gray') }, icon('calendar', 20)),
      h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, t.status ? (ATT[t.status] || [cap1(t.status)])[0] : 'A normal day'), h('div', { class: 'small muted' }, e.mode === 'none' ? 'Your attendance is not tracked' : 'Your manager marks absences and leave'))));
    const waiting = (d.requests || []).filter((r) => ['pending', 'submitted', 'requested'].includes(r.status));
    if (d.is_manager && d.team_pending) v.root.append(banner('orange', 'alert', h('b', null, d.team_pending + ' request' + (d.team_pending === 1 ? '' : 's') + ' from your team. '), h('a', { href: '#/team' }, 'Review')));
    // three things people do most
    v.root.append(h('div', { class: 'kpis k3' },
      kpi('Leave left', qty((d.leave || []).filter((l) => l.paid).reduce((s, l) => s + N(l.balance), 0)) + ' days', 'Ask for leave', () => go('my-leave?apply=1')),
      d.payslip ? kpi('Last pay', inr(d.payslip.net), monthName(d.payslip.month, { short: true }), () => go('payslip/' + d.payslip.id)) : kpi('Last pay', '—', 'No payslip yet', () => go('my-pay')),
      kpi('Waiting', String(waiting.length), waiting.length ? 'Your requests' : 'Nothing waiting', () => go('my-leave'))));
    if (d.announcements && d.announcements.length) v.root.append(section('Notices', h('div', { class: 'list' }, d.announcements.map((a) => h('div', { class: 'li' }, h('span', { class: 'tile blue' }, icon('chat', 18)),
      h('div', { class: 'grow' }, h('div', { class: 't', style: { whiteSpace: 'normal' } }, a.title), a.body ? h('div', { class: 's', style: { whiteSpace: 'pre-wrap' } }, a.body) : null, h('div', { class: 's' }, fmtD(String(a.at).slice(0, 10)))))))));
    if (waiting.length) v.root.append(section('Your requests', h('div', { class: 'list' }, waiting.slice(0, 4).map((r) => myReqRow(r, () => v.refresh())))));
    if (d.holidays && d.holidays.length) v.root.append(section('Coming holidays', h('div', { class: 'list' }, d.holidays.slice(0, 4).map((x) => liRow({ icon: 'calendar', tone: 'gray', title: x.name, value: fmtD(x.date, { weekday: true, noYear: true }) })))));
  },
});
function punchCard(d, v) {
  const p = d.punch || {}, open = !!p.open, t = d.today || {};
  const clock = h('div', { class: 'big' }, '');
  const tick = () => { if (!clock.isConnected) return clearInterval(timer); clock.textContent = open && p.in ? mins((Date.now() - new Date(p.in)) / 60000) : new Date().toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }); };
  const timer = setInterval(tick, 15000); v.onLeave(() => clearInterval(timer)); tick();
  const btn = h('button', { class: 'punch' + (open ? ' out' : ''), type: 'button', 'aria-label': open ? 'Clock out' : 'Clock in', onclick: () => doPunch(d, btn, v) }, icon(open ? 'logout' : 'hand', 34), open ? 'Clock out' : 'Clock in');
  const shiftLine = p.shift ? p.shift + ' · ' + String(p.shift_start).slice(0, 5) + ' to ' + String(p.shift_end).slice(0, 5) : null;
  return h('div', { class: 'card punch-wrap' },
    h('div', { class: 'when' }, open ? 'Working since ' + fmtT(p.in) : (d.punches || []).length ? 'Clocked out at ' + fmtT(p.last) : 'Not clocked in yet'), clock, btn,
    h('div', { class: 'small muted' }, [shiftLine, t.late_mins > 0 ? 'Late by ' + mins(t.late_mins) : null, t.worked_mins > 0 && !open ? 'Worked ' + mins(t.worked_mins) : null].filter(Boolean).join(' · ')),
    (d.punches || []).length > 1 ? h('details', null, h('summary', { class: 'small muted', style: { cursor: 'pointer' } }, 'Today’s clock-ins'), h('div', { class: 'timeline', style: { marginTop: '8px', textAlign: 'left' } },
      d.punches.map((x) => h('div', { class: 'ev' }, h('i'), h('div', null, h('div', { class: 't' }, (x.kind === 'out' ? 'Out ' : x.kind === 'in' ? 'In ' : '') + fmtT(x.at)), h('div', { class: 's' }, cap1(x.source))))))) : null);
}
async function doPunch(d, btn, v) {
  btn.disabled = true;
  const geo = d.org && d.org.has_site && d.org.geofence !== 'off' && navigator.geolocation;
  const go_ = async (pos) => {
    const place = pos ? { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) } : {};
    const keepOffline = () => {
      const q = punchQueue(); q.push({ op: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2)), at: new Date().toISOString(), ...place }); savePunchQueue(q);
      toast('Saved on this phone at ' + fmtT(new Date()) + '. It will be sent when you are back online.'); if (navigator.vibrate) navigator.vibrate(30); ME = null; v.refresh();
    };
    if (!navigator.onLine) return keepOffline();
    try {
      const r = await api('pay_me_punch', { p: place });
      if (r.duplicate) toast('Already done a moment ago');
      else toast((r.open ? 'Clocked in at ' : 'Clocked out at ') + fmtT(new Date()) + (r.out_of_range ? '. You seem to be away from work, so your manager will see a note.' : ''));
      if (navigator.vibrate) navigator.vibrate(30);
      v.refresh();
    } catch (e) { if (!e.status) return keepOffline(); btn.disabled = false; fail(e); }   // no answer at all: keep it on the phone
  };
  if (!geo) return go_(null);
  navigator.geolocation.getCurrentPosition((pos) => go_(pos), () => go_(null), { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
}
function myReqRow(r, done) {
  const sub = r.type === 'leave' ? fmtD(r.from, { noYear: true }) + (r.to && r.to !== r.from ? ' to ' + fmtD(r.to, { noYear: true }) : '') + ' · ' + qty(r.days) + ' day' + (+r.days === 1 ? '' : 's')
    : r.type === 'correction' ? fmtD(r.from, { noYear: true }) + ' · in ' + fmtT(r.in) + (r.out ? ', out ' + fmtT(r.out) : '')
      : r.type === 'loan' ? inr(r.amount) + (r.status === 'active' ? ' · ' + inr(r.outstanding) + ' still to repay' : '')
        : inr(r.amount) + (r.from ? ' · ' + fmtD(r.from, { noYear: true }) : '');
  const waiting = ['pending', 'submitted', 'requested'].includes(r.status);
  return liRow({ icon: { leave: 'leave', correction: 'clock', loan: 'cash', claim: 'receipt' }[r.type], tone: waiting ? 'orange' : 'gray', title: r.title, sub: sub + (r.note ? ' · “' + r.note + '”' : ''), badge: reqBadge(r.status),
    onclick: waiting ? async () => {
      if (!(await confirmBox('Cancel this request?', r.title + ': ' + sub, 'Cancel request', true))) return;
      try { await api('pay_me_cancel', { p_type: r.type, p_id: r.id }); toast('Cancelled'); done && done(); } catch (e) { fail(e); }
    } : null });
}

// ---------- My time ----------
page('my-time', {
  title: 'My time', tabLabel: 'Time', icon: 'clock', ess: true,
  async render(v) {
    const m = v.q.get('m') || monthOf(today());
    const d = await api('pay_me_attendance', { p_month: m });
    v.header({ title: 'My time', actions: [{ label: 'Fix a day', icon: 'edit', primary: true, run: () => fixDaySheet(null, v) }] });
    const days = d.days || [];
    const c = (f) => days.filter(f).length;
    v.root.append(
      h('div', { class: 'row sp' }, h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Previous month', onclick: () => go('my-time?m=' + monthAdd(m, -1)) }, icon('chevL', 20)),
        h('h3', null, monthName(m)), h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Next month', disabled: m >= monthOf(today()), onclick: () => go('my-time?m=' + monthAdd(m, 1)) }, icon('chevR', 20))),
      h('div', { class: 'pill-stats' }, statPill('Present', c((x) => ['present', 'late', 'missing'].includes(x.status)), 'green'), statPill('Late', c((x) => x.status === 'late'), 'orange'),
        statPill('Absent', c((x) => x.status === 'absent'), 'red'), statPill('Leave', c((x) => ['leave', 'half_leave'].includes(x.status)), 'blue')),
      h('div', { class: 'card' }, monthCalendar(m, days, (x) => myDaySheet(x, d, v)), calLegend()),
      h('p', { class: 'small muted' }, 'Tap a day to see your times. If something is wrong, ask for a correction: your manager approves it.'));
  },
});
function myDaySheet(x, d, v) {
  const ps = (d.punches || []).filter((p) => !p.voided && String(new Date(p.at).toLocaleDateString('en-CA')) === x.date);
  const req = (d.requests || []).find((r) => r.att_date === x.date && r.status === 'pending');
  sheet({ title: fmtD(x.date, { weekday: true }), closeLabel: 'Done', body: h('div', { class: 'grid' },
    h('div', { class: 'row', style: { gap: '8px' } }, attBadge(x.status), x.holiday ? badge(x.holiday) : null, x.leave ? badge(x.leave, 'blue') : null),
    h('div', { class: 'list' }, [['First in', x.first_in ? fmtT(x.first_in) : null], ['Last out', x.last_out ? fmtT(x.last_out) : null], ['Worked', x.worked_mins ? mins(x.worked_mins) : null],
      ['Late by', x.late_mins ? mins(x.late_mins) : null], ['Overtime', x.ot_mins ? mins(x.ot_mins) : null], ['Unpaid', +x.lop ? qty(x.lop) + ' day' : null]].filter((r) => r[1]).map(([a, b]) => liRow({ title: a, value: b }))),
    ps.length ? section('Clock-ins', h('div', { class: 'timeline' }, ps.map((p) => h('div', { class: 'ev' }, h('i'), h('div', null, h('div', { class: 't' }, cap1(p.kind) + ' ' + fmtT(p.at)), h('div', { class: 's' }, cap1(p.source) + (p.out_of_range ? ' · away from work' : ''))))))) : null,
    req ? banner('orange', 'clock', 'You asked for a correction for this day. Waiting for your manager.') : null,
    x.locked ? h('p', { class: 'small muted' }, 'This day is in a finalised payroll and cannot change.') : null),
  actions: !x.locked && !req && x.date <= today() && x.status !== 'upcoming' ? [{ label: 'Ask for a correction', primary: true, onclick: (close) => { close(); fixDaySheet(x, v); } }] : [] });
}
function fixDaySheet(x, v) {
  const f = { date: x ? x.date : addDays(today(), -1), in: x && x.first_in ? new Date(x.first_in).toTimeString().slice(0, 5) : '', out: x && x.last_out ? new Date(x.last_out).toTimeString().slice(0, 5) : '', reason: '' };
  sheet({ title: 'Ask for a correction', body: h('div', { class: 'grid' },
    h('p', { class: 'muted' }, 'Forgot to clock in or out? Tell your manager the right times.'),
    field('Day', dateInput(f.date, { max: today(), min: addDays(today(), -60), onchange: (e) => { f.date = e.target.value; } })),
    h('div', { class: 'grid two' }, field('Started at', input({ type: 'time', value: f.in, oninput: (e) => { f.in = e.target.value; } })), field('Finished at', input({ type: 'time', value: f.out, oninput: (e) => { f.out = e.target.value; } }))),
    field('What happened', input({ placeholder: 'For example: phone battery died', oninput: (e) => { f.reason = e.target.value; } }))),
  actions: [{ label: 'Send', primary: true, onclick: async (close) => { await api('pay_me_regularize', { p: f }); close(); toast('Sent to your manager'); v.refresh(); } }] });
}

// ---------- My leave ----------
page('my-leave', {
  title: 'My leave', tabLabel: 'Leave', icon: 'leave', ess: true,
  async render(v) {
    const d = await me(true);
    v.header({ title: 'My leave', actions: ['active', 'notice'].includes(d.employee.status) ? [{ label: 'Ask for leave', icon: 'plus', primary: true, run: () => applyLeaveSheet(d, v) }] : [] });
    const paid = (d.leave || []).filter((l) => l.paid);
    v.root.append(paid.length ? h('div', { class: 'kpis' }, paid.map((l) => kpi(l.name, qty(l.balance), 'days left' + (+l.used ? ' · ' + qty(l.used) + ' used' : '')))) : h('p', { class: 'muted' }, 'You have no paid leave set up. You can still ask for unpaid leave.'));
    const reqs = (d.requests || []).filter((r) => r.type === 'leave' || r.type === 'correction');
    v.root.append(section('Requests', reqs.length ? h('div', { class: 'list' }, reqs.map((r) => myReqRow(r, () => v.refresh()))) : empty('leave', 'No requests', 'Ask for leave and your manager gets it straight away.',
      ['active', 'notice'].includes(d.employee.status) ? h('button', { class: 'btn fill', onclick: () => applyLeaveSheet(d, v) }, 'Ask for leave') : null)));
    if (v.q.get('apply') && ['active', 'notice'].includes(d.employee.status)) { history.replaceState(null, '', '#/my-leave'); applyLeaveSheet(d, v); }
  },
});
function applyLeaveSheet(d, v) {
  const types = d.leave_types || [];
  if (!types.length) return toast('No leave types are set up yet. Ask your manager.', { err: true });
  const bal = Object.fromEntries((d.leave || []).map((l) => [l.id, l.balance]));
  const f = { leave_type_id: (types.find((t) => t.paid && N(bal[t.id]) > 0) || types[0]).id, from: addDays(today(), 1), to: '', half: 'none', reason: '' };
  const info = h('div', { class: 'small muted' });
  const showBal = () => { const t = types.find((x) => x.id === f.leave_type_id); info.textContent = t && t.paid ? qty(bal[t.id] || 0) + ' days left' : 'Unpaid: your salary is reduced for these days'; };
  showBal();
  const toWrap = h('div');
  const paintTo = () => { clear(toWrap); if (f.half === 'none') toWrap.append(field('Last day', dateInput(f.to || f.from, { min: f.from, onchange: (e) => { f.to = e.target.value; } }))); };
  paintTo();
  sheet({ title: 'Ask for leave', body: h('div', { class: 'grid' },
    field('Type', chips(types.map((t) => [t.id, t.name]), f.leave_type_id, (x) => { f.leave_type_id = x; showBal(); }, { wrap: true, label: 'Type' })), info,
    field('First day', dateInput(f.from, { min: addDays(today(), -30), onchange: (e) => { f.from = e.target.value; if (f.to && f.to < f.from) f.to = f.from; paintTo(); } })),
    seg(LEAVE_HALF, f.half, (x) => { f.half = x; paintTo(); }, { full: true, label: 'Length' }), toWrap,
    field('Reason (optional)', input({ placeholder: 'For example: family wedding', oninput: (e) => { f.reason = e.target.value; } }))),
  actions: [{ label: 'Send', primary: true, onclick: async (close) => {
    const r = await api('pay_me_leave_apply', { p: { ...f, to: f.half === 'none' ? (f.to || f.from) : f.from } });
    close(); toast('Sent: ' + qty(r.days) + ' day' + (+r.days === 1 ? '' : 's') + ' asked'); v.refresh();
  } }] });
}

// ---------- My pay ----------
page('my-pay', {
  title: 'My pay', tabLabel: 'Pay', icon: 'wallet', ess: true,
  async render(v) {
    const [list, d] = await Promise.all([api('pay_me_payslips'), me()]);
    const active = d.employee.status === 'active';
    v.header({ title: 'My pay', actions: [active && { label: 'Ask for an advance', icon: 'cash', run: () => advanceSheet(v) }, { label: 'Claim an expense', icon: 'receipt', run: () => myClaimSheet(v) }, { label: 'Income tax', icon: 'doc', run: () => taxSheet({}, true).catch(fail) }] });
    if (list.length) {
      const last = list[0];
      v.root.append(h('button', { class: 'card hero', type: 'button', style: { textAlign: 'left' }, onclick: () => go('payslip/' + last.id) },
        h('div', { class: 'k' }, last.title), h('div', { class: 'n num' }, inr(last.net)), h('div', { class: 'small muted' }, (last.paid ? 'Paid' : 'Being paid') + (last.pay_date ? ' · ' + fmtD(last.pay_date) : '') + ' · tap to see the payslip')));
      if (list.length > 2) v.root.append(section('Last months', h('div', { class: 'card' }, barChart(list.slice(0, 6).reverse().map((x) => ({ label: monthName(x.month, { short: true, noYear: true }), value: N(x.net) })), { label: 'Take-home pay by month' }))));
      v.root.append(section('Payslips', h('div', { class: 'list' }, list.map((x) => liRow({ icon: 'doc', title: x.title, sub: 'Earned ' + inr(x.gross) + ' · deducted ' + inr(x.deductions), value: inr(x.net), badge: x.paid ? null : badge('Being paid', 'orange'), onclick: () => go('payslip/' + x.id) })))));
    } else v.root.append(empty('wallet', 'No payslips yet', 'Your payslip shows here as soon as your employer finalises the payroll.'));
    const money = (d.requests || []).filter((r) => r.type === 'loan' || r.type === 'claim');
    v.root.append(section('Advances and claims', money.length ? h('div', { class: 'list' }, money.map((r) => myReqRow(r, () => v.refresh()))) : h('div', { class: 'list' },
      active ? liRow({ icon: 'cash', title: 'Ask for a salary advance', sub: 'Repaid from your next salaries', onclick: () => advanceSheet(v) }) : null,
      liRow({ icon: 'receipt', title: 'Claim an expense', sub: 'Travel, food or anything you paid for work', onclick: () => myClaimSheet(v) }))));
  },
});
function advanceSheet(v) {
  const f = { amount: '', emi: '', reason: '' };
  sheet({ title: 'Ask for an advance', body: h('div', { class: 'grid' },
    field('Amount', input({ type: 'number', mode: 'decimal', placeholder: '₹', oninput: (e) => { f.amount = e.target.value; } })),
    field('Repay each month (optional)', input({ type: 'number', mode: 'decimal', placeholder: 'All from the next salary', oninput: (e) => { f.emi = e.target.value; } })),
    field('Reason (optional)', input({ oninput: (e) => { f.reason = e.target.value; } }))),
  actions: [{ label: 'Send', primary: true, onclick: async (close) => { await api('pay_me_loan_request', { p: f }); close(); toast('Sent for approval'); ME = null; v.refresh(); } }] });
}
function myClaimSheet(v) {
  const f = { amount: '', date: today(), category: (masters('claim_type')[0] || 'Travel'), description: '', attachment: null };
  const cats = masters('claim_type').length ? masters('claim_type') : ['Travel', 'Food', 'Phone', 'Supplies', 'Other'];
  const fileLbl = h('span', null, 'Add a photo of the receipt');
  const fi = h('input', { type: 'file', accept: 'image/*,application/pdf', class: 'hidden', onchange: async () => {
    const file = fi.files[0]; if (!file) return;
    fileLbl.textContent = 'Uploading…';
    try { const r = await uploadDoc(ME.employee.id, file); f.attachment = r.path; fileLbl.textContent = file.name; } catch (e) { fileLbl.textContent = 'Add a photo of the receipt'; fail(e); }
  } });
  sheet({ title: 'Claim an expense', body: h('div', { class: 'grid' },
    field('What for', chips(cats.map((c) => [c, c]), f.category, (x) => { f.category = x; }, { wrap: true, label: 'Category' })),
    h('div', { class: 'grid two' }, field('Amount', input({ type: 'number', mode: 'decimal', placeholder: '₹', oninput: (e) => { f.amount = e.target.value; } })), field('Date', dateInput(f.date, { max: today(), onchange: (e) => { f.date = e.target.value; } }))),
    field('Details (optional)', input({ oninput: (e) => { f.description = e.target.value; } })),
    h('label', { class: 'btn', style: { cursor: 'pointer' } }, icon('upload', 18), fileLbl, fi)),
  actions: [{ label: 'Send', primary: true, onclick: async (close) => { await api('pay_me_claim', { p: f }); close(); toast('Claim sent'); ME = null; v.refresh(); } }] });
}

// ---------- My profile ----------
page('my-profile', {
  title: 'Profile', icon: 'user', ess: true,
  async render(v) {
    const [d, docs] = await Promise.all([me(true), api('pay_me_documents').catch(() => [])]);
    const e = d.employee;
    v.header({ title: 'Profile', actions: [{ label: 'Edit', icon: 'edit', run: () => myEditSheet(e, v) }] });
    v.root.append(h('div', { class: 'card row', style: { gap: '14px' } }, avatar(e.name, 56), h('div', { class: 'grow' }, h('h2', { style: { fontSize: '22px' } }, e.name), h('div', { class: 'muted' }, [e.designation, e.department].filter(Boolean).join(' · ') || 'Team member'), h('div', { class: 'small muted' }, (e.code ? e.code + ' · ' : '') + 'Joined ' + fmtD(e.joined_on)))),
      section('Work', kvList([['Manager', e.manager], ['Location', e.location], ['Attendance', { punch: 'Clock in and out', manual: 'Marked by your manager', none: 'Not tracked' }[e.mode]]])),
      section(h('div', { class: 'row sp' }, h('h3', null, 'Contact'), h('button', { class: 'btn sm plain', type: 'button', onclick: () => myEditSheet(e, v) }, 'Edit')), kvList([['Phone', e.phone], ['Email', e.email], ['Address', e.address], ['Emergency contact', e.emergency_name ? e.emergency_name + (e.emergency_phone ? ', ' + e.emergency_phone : '') : null]])),
      section('Salary account', h('div', { class: 'list' }, liRow({ icon: 'bank', title: 'Change my bank account', sub: 'Checked and approved before your next salary', onclick: () => myBankSheet(v) }))),
      docs.length ? section('Documents', h('div', { class: 'list' }, docs.map((x) => liRow({ icon: 'file', title: x.title || x.doc_type || 'Document', sub: fmtD(String(x.created_at).slice(0, 10)), onclick: () => openDoc(x.path).catch(fail) })))) : null,
      h('div', { class: 'list' }, liRow({ icon: 'logout', tone: 'gray', title: 'Sign out', onclick: signOut }), liRow({ icon: 'trash', tone: 'red', title: 'Delete my account', onclick: deleteAccountFlow })));
  },
});
function myEditSheet(e, v) {
  const f = { phone: e.phone || '', address: e.address || '', emergency_name: e.emergency_name || '', emergency_phone: e.emergency_phone || '' };
  const t = (k, label, o = {}) => field(label, input({ value: f[k], mode: o.mode, oninput: (ev) => { f[k] = ev.target.value; } }));
  sheet({ title: 'My details', body: h('div', { class: 'grid' }, t('phone', 'Phone', { mode: 'tel' }), t('address', 'Address'), t('emergency_name', 'Emergency contact name'), t('emergency_phone', 'Emergency contact phone', { mode: 'tel' })),
    actions: [{ label: 'Save', primary: true, onclick: async (close) => { await api('pay_me_profile', { p: f }); close(); toast('Saved'); v.refresh(); } }] });
}
function myBankSheet(v) {
  const f = { holder: ME.employee.name, bank_name: '', account_no: '', ifsc: '' };
  const t = (k, label, o = {}) => field(label, input({ value: f[k], mode: o.mode, max: o.max, oninput: (ev) => { f[k] = o.up ? ev.target.value.toUpperCase() : ev.target.value; } }), o.hint);
  sheet({ title: 'New salary account', body: h('div', { class: 'grid' }, banner('info', 'shield', 'For your safety, a change is checked by your employer before any salary goes to it.'),
    t('holder', 'Name on the account'), t('bank_name', 'Bank'), t('account_no', 'Account number', { mode: 'numeric', max: 20 }), t('ifsc', 'IFSC', { max: 11, up: true, hint: 'Printed on your cheque book, like SBIN0001234' })),
  actions: [{ label: 'Send for approval', primary: true, onclick: async (close) => { await api('pay_me_bank_request', { p: f }); close(); toast('Sent for approval'); v.refresh(); } }] });
}

// ---------- My team (line managers) ----------
page('team', {
  title: 'My team', icon: 'users', ess: true, manager: true,
  async render(v) {
    const [d, reqs] = await Promise.all([me(true), api('pay_list_requests', { p: {} }).catch(() => [])]);
    v.header({ title: 'My team', sub: (d.team || []).length + ' people report to you' });
    const team = d.team || [];
    const c = (f) => team.filter(f).length;
    v.root.append(h('div', { class: 'pill-stats' }, statPill('In', c((x) => ['present', 'late', 'missing'].includes(x.status)), 'green'), statPill('Late', c((x) => x.status === 'late'), 'orange'),
      statPill('Away', c((x) => ['absent', 'leave', 'half_leave'].includes(x.status)), 'red')));
    const mine = reqs.filter((r) => ['leave', 'correction'].includes(r.type));
    v.root.append(section('Waiting for you', mine.length ? h('div', { class: 'list' }, mine.map((r) => requestRow(r, () => v.refresh()))) : h('p', { class: 'muted' }, 'Nothing to approve.')));
    v.root.append(section('Today', team.length ? h('div', { class: 'list' }, team.map((x) => liRow({ avatar: x.name, title: x.name, sub: x.in ? 'In at ' + fmtT(x.in) : null, badge: attBadge(x.status) }))) : empty('users', 'Nobody reports to you')));
  },
});

// ---------- shared clock-in kiosk ----------
page('kiosk', {
  title: 'Clock-in kiosk', icon: 'tablet', nav: false, perm: 'pay_time', navAs: 'time',
  async render(v) {
    v.header({ title: 'Clock-in kiosk', back: 'time' });
    v.root.append(h('div', { class: 'card grid' }, h('p', null, 'Turns this screen into a shared clock-in point. Staff tap their name and enter their PIN. Set PINs on each person’s profile.'),
      h('p', { class: 'small muted' }, 'To leave the kiosk, tap Exit and sign in with your password.'),
      h('button', { class: 'btn fill wide', type: 'button', onclick: () => openKiosk() }, icon('tablet', 20), 'Start kiosk')));
  },
});
function openKiosk() {
  const ov = h('div', { class: 'kiosk', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Clock-in kiosk', style: { position: 'fixed', inset: 0, zIndex: 90, background: 'var(--bg)', overflowY: 'auto' } });
  const clk = h('div', { class: 'clock' }), dt = h('div', { class: 'muted' });
  const grid = h('div', { class: 'kgrid' }), q = searchField('Find your name', () => paint());
  let list = [];
  const tick = () => { const n = new Date(); clk.textContent = n.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true }); dt.textContent = n.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }); };
  const timer = setInterval(tick, 1000); tick();
  const load = async () => { try { list = await api('pay_kiosk_list'); paint(); } catch (e) { fail(e); } };
  const refresher = setInterval(load, 60000);
  const paint = () => {
    const s = q.input.value.trim().toLowerCase();
    clear(grid).append(...list.filter((e) => !s || e.name.toLowerCase().includes(s) || (e.code || '').toLowerCase().startsWith(s)).map((e) => h('button', { class: 'kperson', type: 'button', onclick: () => pinPad(e) },
      avatar(e.name, 56), h('b', null, e.name), h('span', { class: 's' }, e.state && e.state.open ? 'In since ' + fmtT(e.state.in) : 'Not in'))));
    if (!grid.childNodes.length) grid.append(h('p', { class: 'muted' }, 'Nobody found.'));
  };
  // The kiosk overlay is a plain full-screen DOM overlay, not a route -- the hash never changes
  // while it's open. A phone's swipe-back gesture still changes location.hash underneath it
  // though, silently re-rendering the page behind the (still visible, still opaque) overlay,
  // which looked like "pressing back does nothing, I'm stuck on the same screen." Since leaving
  // the kiosk is deliberately password-gated (a shared device shouldn't let anyone just swipe
  // their way back into the real app), a back gesture snaps the hash back to the kiosk instead
  // of silently going nowhere, with a toast explaining why.
  const kioskHash = location.hash;
  const guardBack = () => { if (location.hash !== kioskHash) { location.hash = kioskHash; toast('Tap Exit to leave the kiosk'); } };
  window.addEventListener('hashchange', guardBack);
  const exit = async () => {
    const pw = await askText('Exit kiosk', 'Enter the password of ' + S.user.email + ' to leave the kiosk.', 'Password', '', { confirm: 'Exit' });
    if (pw === null) return;
    const { error } = await sb.auth.signInWithPassword({ email: S.user.email, password: pw });
    if (error) return toast('Wrong password', { err: true });
    clearInterval(timer); clearInterval(refresher); window.removeEventListener('hashchange', guardBack); ov.remove(); document.removeEventListener('keydown', esc, true); go('time');
  };
  const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); } };
  document.addEventListener('keydown', esc, true);
  function pinPad(e) {
    let pin = '';
    const dots = h('div', { class: 'pin-dots', 'aria-live': 'polite' });
    const msg = h('div', { class: 'small', style: { minHeight: '20px', color: 'var(--red)', textAlign: 'center' } });
    const paintDots = () => { clear(dots).append(...Array.from({ length: Math.max(4, pin.length) }, (_, i) => h('i', { class: i < pin.length ? 'on' : '' }))); };
    const submit = async () => {
      try {
        const r = await api('pay_kiosk_punch', { p_emp: e.id, p_pin: pin || null });
        if (!r.ok) { msg.textContent = r.error || 'Try again'; pin = ''; paintDots(); return; }
        s.close();
        const kind = r.duplicate ? 'Already done' : r.kind === 'out' ? 'Goodbye, ' + e.name.split(' ')[0] : 'Welcome, ' + e.name.split(' ')[0];
        const done = h('div', { style: { position: 'fixed', inset: 0, zIndex: 95, display: 'grid', placeItems: 'center', background: 'var(--bg)' } },
          h('div', { style: { textAlign: 'center', display: 'grid', gap: '10px', justifyItems: 'center' } }, h('span', { class: 'tile ' + (r.kind === 'out' ? 'gray' : 'green'), style: { width: '72px', height: '72px', borderRadius: '50%' } }, icon('check', 40)),
            h('h2', { style: { fontSize: '30px' } }, kind), h('div', { class: 'muted' }, (r.kind === 'out' ? 'Clocked out at ' : 'Clocked in at ') + fmtT(r.at || new Date()))));
        ov.append(done); setTimeout(() => { done.remove(); q.input.value = ''; load(); }, 2200);
      } catch (er) { msg.textContent = er.message; pin = ''; paintDots(); }
    };
    const key = (k) => { msg.textContent = ''; if (k === 'del') pin = pin.slice(0, -1); else if (pin.length < 8) pin += k; paintDots(); };
    paintDots();
    const s = sheet({ title: e.name, noFocus: true, body: h('div', { class: 'grid', style: { justifyItems: 'center', gap: '18px' } },
      e.pin ? [h('p', { class: 'muted' }, 'Enter your PIN'), dots, msg, h('div', { class: 'keypad' }, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((k) => k === '' ? h('span') : h('button', { type: 'button', 'aria-label': k === 'del' ? 'Delete' : k, onclick: () => key(k) }, k === 'del' ? icon('chevL', 26) : k)))]
        : [h('p', { class: 'muted' }, e.state && e.state.open ? 'Clock out now?' : 'Clock in now?'), msg]),
    actions: [{ label: e.state && e.state.open ? 'Clock out' : 'Clock in', primary: true, onclick: async () => { await submit(); return false; } }] });
    s.el.style.zIndex = 96; s.el.previousSibling && (s.el.previousSibling.style.zIndex = 95);
  }
  ov.append(h('div', { class: 'row sp' }, h('div', null, clk, dt), h('button', { class: 'btn', type: 'button', onclick: exit }, 'Exit')), h('h2', null, org().display_name || S.ctx.tenant.name), q, grid);
  document.body.append(ov);
  load();
}
