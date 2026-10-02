/* AUZslab Payroll: Home (what needs doing today), approvals, and the first-run setup wizard. */
'use strict';
page('home', {
  title: 'Today', icon: 'home', tabLabel: 'Home', perm: 'pay_view',
  async render(v) {
    const d = await api('pay_dashboard');
    S.home = d;
    const pend = d.pending || {}, pendTotal = Object.values(pend).reduce((a, b) => a + (+b || 0), 0);
    const np = $('#navPending'); if (np) { np.textContent = pendTotal; np.classList.toggle('hidden', !pendTotal); }
    v.header({ title: 'Today', sub: parseD(d.today).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' }),
      actions: [can('pay_people') && { label: 'Add person', icon: 'userplus', primary: true, run: () => addPersonSheet() },
        can('pay_time') && { label: 'Clock-in kiosk', icon: 'tablet', run: () => go('kiosk') }] });
    const r = v.root;
    if (!d.setup.done && can('pay_admin')) r.append(setupCard(d));
    if ((org().settings || {})._from_old_payroll && !(org().settings || {})._old_banner_seen) r.append(oldPayrollBanner());
    // who is in
    const a = d.attendance || {};
    r.append(section(h('div', { class: 'row sp' }, h('h3', null, 'Attendance today'), h('a', { href: '#/time', class: 'small' }, 'See all')),
      h('div', { class: 'pill-stats' },
        statPill('In', (+a.present || 0) + (+a.late || 0), 'green', () => go('time')),
        statPill('Late', a.late || 0, 'orange', () => go('time?f=late')),
        statPill('On leave', a.leave || 0, 'blue', () => go('time?f=leave')),
        statPill(d.headcount && (+a.waiting || 0) ? 'Not in yet' : 'Absent', (+a.absent || 0) + (+a.waiting || 0), 'red', () => go('time?f=out')),
        (+a.off || 0) ? statPill('Day off', a.off, '', () => go('time')) : null)));
    // decisions waiting
    if (pendTotal) {
      const rows = [['leave', 'Leave request', 'leave'], ['corrections', 'Attendance correction', 'clock'], ['loans', 'Advance or loan request', 'cash'], ['claims', 'Expense claim', 'receipt'], ['bank', 'Change of bank details', 'bank']]
        .filter(([k]) => +pend[k]).map(([k, t, ic]) => liRow({ icon: ic, tone: 'orange', title: pend[k] + ' ' + t.toLowerCase() + (+pend[k] > 1 ? 's' : ''), chevron: true, onclick: () => approvalsSheet(k) }));
      r.append(section('Needs your decision', h('div', { class: 'list' }, rows)));
    }
    if (d.payroll) r.append(payrollCard(d.payroll));
    if ((d.dues || []).length && canPay()) {
      r.append(section(h('div', { class: 'row sp' }, h('h3', null, 'Government dues'), h('a', { href: '#/compliance', class: 'small' }, 'Record a payment')),
        h('div', { class: 'list' }, d.dues.slice(0, 5).map((x) => liRow({ icon: 'building', tone: parseD(x.due_date) < parseD(d.today) ? 'orange' : 'gray', title: x.scheme + ' for ' + monthName(x.month, { short: true }),
          sub: (parseD(x.due_date) < parseD(d.today) ? 'Was due ' : 'Due ') + fmtD(x.due_date, { noYear: true }), value: inr(x.left), onclick: () => go('compliance') })))));
    }
    const ev = d.events || [];
    if (ev.length) {
      const EVT = { birthday: ['cake', 'Birthday'], anniversary: ['star', 'Work anniversary'], probation: ['shield', 'Probation ends'], last_day: ['door', 'Last day'], holiday: ['calendar', 'Holiday'] };
      r.append(section('Coming up', h('div', { class: 'list' }, ev.slice(0, 6).map((x) => liRow({ icon: (EVT[x.kind] || [])[0] || 'calendar', tone: 'gray', title: x.name,
        sub: ((EVT[x.kind] || [])[1] || '') + (x.years ? ' · ' + x.years + ' year' + (x.years > 1 ? 's' : '') : ''), value: fmtD(x.date, { noYear: true }),
        onclick: x.employee_id ? () => go('person/' + x.employee_id) : null })))));
    }
    if ((d.trend || []).length >= 2) {
      r.append(section('Salary cost, last months', h('div', { class: 'card' }, barChart(d.trend.map((t) => ({ label: monthName(t.month, { short: true, noYear: true }), value: +t.gross + +t.employer })), { label: 'Salary cost by month' }),
        h('div', { class: 'small muted', style: { marginTop: '6px' } }, 'Gross pay plus employer PF and ESI, finalised payrolls only.'))));
    }
    const hc = d.headcount || {};
    r.append(h('div', { class: 'kpis' }, kpi('People', (+hc.active || 0) + (+hc.notice || 0), hc.notice ? hc.notice + ' leaving' : null, () => go('people')),
      kpi('Joined this month', hc.joined_this_month || 0), d.monthly_cost != null ? kpi('Monthly salaries', compact(d.monthly_cost), 'gross, everyone current') : kpi('Left this month', hc.left_this_month || 0),
      kpi('Waiting for you', pendTotal, null, pendTotal ? () => approvalsSheet() : null)));
  },
});

function statPill(label, n, tone, onclick) {
  return h('button', { class: 'pill-stat', type: 'button', onclick }, h('span', { class: 'dotc ' + (tone || '') }), h('b', null, String(n || 0)), label);
}
function setupCard(d) {
  const s = d.setup || {};
  const step = (done, title, sub, run) => liRow({ icon: done ? 'check' : 'chevR', tone: done ? 'green' : 'gray', title, sub, onclick: run });
  return section('Get started', h('div', { class: 'list' },
    step(s.company, 'Your business and rules', 'State, attendance, weekly off, PF and ESI', () => setupWizard()),
    step(s.people, 'Add your people', 'Name, phone and monthly salary is enough', () => addPersonSheet()),
    step(s.people && s.salaries, 'Check everyone has a salary', 'People without one are paid nothing', () => go('people')),
    step(false, 'Run your first payroll', 'Calculate, check, approve, pay', () => go('pay'))));
}
function oldPayrollBanner() {
  const flat = org().stat_mode === 'flat', noOff = !(org().weekly_off || []).length;
  return banner('info', 'info', h('b', null, 'Moved from the old Payroll. '), 'Your staff, clock-ins, leave, advances and old payslips are all here. ',
    flat || noOff ? 'Pay is still worked out the way the old app did it' + (flat ? ' (PF 12%, ESI 0.75% of gross and ₹200 professional tax for everyone' : ' (') + (noOff ? (flat ? ', and' : '') + ' no weekly day off, so only days with a clock-in are paid' : '') + '). ' : '',
    can('pay_admin') ? h('a', { href: '#/settings/statutory' }, 'Review these settings') : null);
}
function payrollCard(p) {
  const cur = p.current;
  const card = h('div', { class: 'card', style: { display: 'grid', gap: '12px' } });
  if (!cur || cur.month < p.suggest_month && ['paid', 'locked'].includes(cur.status)) {
    card.append(h('div', { class: 'row sp' }, h('div', null, h('div', { class: 'small muted' }, 'Payroll'), h('h3', { style: { fontSize: '20px' } }, monthName(p.suggest_month))), badge('Not started')),
      h('p', { class: 'muted' }, 'Work out everyone’s pay for ' + monthName(p.suggest_month, { noYear: true }) + ' from their salary, days worked, leave and any advances.'),
      can('pay_run') ? h('button', { class: 'btn fill wide', type: 'button', onclick: () => startRun(p.suggest_month) }, 'Run ' + monthName(p.suggest_month, { noYear: true }) + ' payroll') : null);
  } else {
    const next = { draft: 'Calculate', calculated: 'Review and approve', review: 'Approve', approved: 'Finalise', finalized: 'Pay salaries', paid: 'See payslips', locked: 'See payslips' }[cur.status];
    card.append(h('div', { class: 'row sp' }, h('div', null, h('div', { class: 'small muted' }, 'Payroll'), h('h3', { style: { fontSize: '20px' } }, cur.title)), runBadge(cur.status)),
      +cur.employees ? h('div', { class: 'row sp' }, h('div', { class: 'hero' }, h('div', { class: 'k' }, 'Net pay'), h('div', { class: 'n' }, inr(cur.net, 0))), h('div', { class: 'muted', style: { textAlign: 'right' } }, cur.employees + ' people', h('br'), cur.warning_count ? cur.warning_count + ' to check' : 'Nothing flagged')) : null,
      h('button', { class: 'btn fill wide', type: 'button', onclick: () => go('run/' + cur.id) }, next || 'Open'));
  }
  const open = (p.open || []).filter((x) => !cur || x.id !== cur.id);
  if (open.length) card.append(h('div', { class: 'list' }, open.map((x) => liRow({ icon: 'wallet', tone: 'gray', title: x.title, sub: RUN[x.status] ? RUN[x.status][0] : x.status, value: inr(x.net, 0), onclick: () => go('run/' + x.id) }))));
  return section('Payroll', card);
}
async function startRun(month) {
  try { const id = await api('pay_run_create', { p: { kind: 'regular', month } }); await api('pay_run_calculate', { p_run: id }); go('run/' + id); } catch (e) { fail(e); }
}

// ---------- approvals ----------
async function approvalsSheet(only) {
  const body = h('div', { class: 'grid' });
  const s = sheet({ title: 'Waiting for a decision', closeLabel: 'Done', body, wide: true, noFocus: true, onClose: () => route_() });
  const TYPES = { leave: 'Leave', correction: 'Attendance corrections', loan: 'Advances and loans', claim: 'Expense claims', bank: 'Bank detail changes' };
  const KEY = { leave: 'leave', corrections: 'correction', loans: 'loan', claims: 'claim', bank: 'bank' };
  async function paint() {
    const rows = (await api('pay_list_requests', { p: { status: 'pending' } })).filter((x) => !only || x.type === KEY[only]);
    clear(body);
    if (!rows.length) { body.append(empty('check', 'All done', 'Nothing is waiting for a decision.')); return; }
    Object.keys(TYPES).forEach((t) => {
      const list = rows.filter((x) => x.type === t); if (!list.length) return;
      body.append(section(TYPES[t], h('div', { class: 'list' }, list.map((x) => requestRow(x, paint)))));
    });
  }
  await paint();
}
function requestRow(x, done) {
  const meta = [];
  if (x.type === 'leave') meta.push(fmtD(x.from, { noYear: true }) + (x.to && x.to !== x.from ? ' to ' + fmtD(x.to, { noYear: true }) : '') + (x.half && x.half !== 'none' ? ' (' + x.half + ' half)' : ''), 'Balance ' + qty(x.balance));
  if (x.type === 'correction') meta.push('In ' + fmtT(x.in) + (x.out ? ', out ' + fmtT(x.out) : ''));
  if (x.type === 'loan') meta.push('Asked ' + inr(x.amount) + (x.emi && +x.emi !== +x.amount ? ', ' + inr(x.emi) + ' a month' : ''));
  if (x.type === 'claim') meta.push(fmtD(x.from, { noYear: true }));
  if (x.type === 'bank') meta.push('IFSC ' + (x.ifsc || ''));
  const decide = async (ok) => {
    try {
      if (x.type === 'leave') await api('pay_leave_decide', { p_id: x.id, p_approve: ok, p_note: ok ? null : await askText('Decline leave', 'Optional: say why.', 'Reason') });
      else if (x.type === 'correction') await api('pay_reg_decide', { p_id: x.id, p_approve: ok, p_note: null });
      else if (x.type === 'loan') { if (ok) { if (!(await approveLoanSheet(x))) return; } else await api('pay_loan_decide', { p_id: x.id, p_approve: false, p: { note: await askText('Decline request', 'Optional: say why.', 'Reason') } }); }
      else if (x.type === 'claim') { let amt = null; if (ok) { amt = await askText('Approve claim', 'Approved amount (you can approve less than asked).', 'Amount', String(x.amount), { mode: 'decimal', confirm: 'Approve' }); if (amt === null) return; } await api('pay_claim_decide', { p_id: x.id, p_approve: ok, p: { amount: amt } }); }
      else if (x.type === 'bank') await api('pay_bank_decide', { p_id: x.id, p_approve: ok });
      toast(ok ? 'Approved' : 'Declined'); done && done();
    } catch (e) { fail(e); }
  };
  return h('div', { class: 'req' },
    h('div', { class: 'top' }, avatar(x.name, 36), h('div', { class: 'grow' }, h('div', { style: { fontWeight: 600 } }, x.name), h('div', { class: 'small muted' }, x.title))),
    meta.length ? h('div', { class: 'small muted' }, meta.join(' · ')) : null,
    x.reason ? h('div', { class: 'why' }, '“' + x.reason + '”') : null,
    x.attachment ? h('button', { class: 'btn sm', type: 'button', onclick: () => openDoc(x.attachment).catch(fail) }, icon('file', 18), 'See receipt') : null,
    h('div', { class: 'inline-actions' }, h('button', { class: 'btn sm fill', type: 'button', onclick: () => decide(true) }, 'Approve'), h('button', { class: 'btn sm', type: 'button', onclick: () => decide(false) }, 'Decline')));
}
function approveLoanSheet(x) {
  return new Promise((resolve) => {
    const amt = input({ type: 'number', mode: 'decimal', value: x.amount }), emi = input({ type: 'number', mode: 'decimal', value: x.emi || x.amount });
    const start = input({ type: 'month', value: monthOf(today()) });
    let via = 'cash';
    sheet({ title: 'Approve ' + (x.title || 'advance'), body: h('div', { class: 'grid' }, h('p', { class: 'muted' }, x.name + (x.reason ? ': “' + x.reason + '”' : '')),
      field('Amount', amt), field('Recover each month', emi, 'Taken from salary until it is paid back'), field('First month to recover', start),
      field('Given how', chips([['cash', 'Cash'], ['bank', 'Bank transfer'], ['none', 'Already given']], via, (v) => { via = v; }))),
    actions: [{ label: 'Approve', primary: true, onclick: async (close) => { await api('pay_loan_decide', { p_id: x.id, p_approve: true, p: { amount: N(amt.value), emi: N(emi.value), start_month: start.value, disbursed_via: via } }); close(); resolve(true); } }],
    onClose: () => resolve(false) });
  });
}

// ---------- first-run setup ----------
function setupWizard() {
  const o = org();
  const st = { legal_name: o.legal_name || S.ctx.tenant.name, state_code: o.state_code || '', city: o.city || '', attendance_mode: o.attendance_mode || 'manual', weekly_off: [...(o.weekly_off || [0])],
    pf: !!oset('pf', 'enabled', false), esi: !!oset('esi', 'enabled', false), pt: oset('pt', 'enabled', !!o.state_code), pay_day: o.pay_day ?? 1 };
  let step = 0;
  const body = h('div', { class: 'wizard' });
  const bar = h('div', { class: 'progress' }, h('i', { style: { width: '20%' } }));
  const steps = [
    () => [h('h2', null, 'Your business'), h('p', { class: 'lead' }, 'Used on payslips and to know which state’s rules apply.'),
      field('Business name on payslips', input({ value: st.legal_name, oninput: (e) => { st.legal_name = e.target.value; } })),
      field('State', selectEl(stateOptions(), st.state_code, { onchange: (e) => { st.state_code = e.target.value; st.pt = PT_STATES.includes(e.target.value); } }), 'Decides professional tax'),
      field('City', input({ value: st.city, oninput: (e) => { st.city = e.target.value; } }))],
    () => [h('h2', null, 'How do you track attendance?'), h('p', { class: 'lead' }, 'You can change this later, or for one person.'),
      optionCards([['punch', 'clock', 'Staff clock in', 'On their phone, at a shared kiosk, or from the POS. No clock-in on a work day means absent.'],
        ['manual', 'edit', 'I mark who was away', 'Everyone counts as present unless you mark an absence or leave.'],
        ['none', 'cash', 'No attendance', 'A fixed salary every month. Only unpaid leave reduces it.']], st.attendance_mode, (v) => { st.attendance_mode = v; })],
    () => [h('h2', null, 'Weekly day off'), h('p', { class: 'lead' }, 'Days off are paid and never count as absent.'),
      chips(WEEKDAYS.map((d, i) => [i, d]), st.weekly_off, (v, on) => { st.weekly_off = on ? [...new Set([...st.weekly_off, v])] : st.weekly_off.filter((x) => x !== v); }, { wrap: true, label: 'Weekly day off' }),
      h('p', { class: 'small muted' }, 'Pick none if your staff take turns. You can give someone their own day off on their profile.')],
    () => [h('h2', null, 'Government registrations'), h('p', { class: 'lead' }, 'Switch on only what your business is registered for. Not sure? Leave them off; you can switch them on any time.'),
      h('div', { class: 'list' },
        toggleRow('Provident fund (EPFO)', st.pf, (on) => { st.pf = on; }, '12% from the employee and 12% from you, on basic pay up to the PF ceiling'),
        toggleRow('ESI (ESIC)', st.esi, (on) => { st.esi = on; }, 'For people earning up to ₹21,000 a month: 0.75% from them, 3.25% from you'),
        toggleRow('Professional tax', st.pt, (on) => { st.pt = on; }, st.state_code ? (PT_STATES.includes(st.state_code) ? 'Applies in ' + STATES[st.state_code] + ': deducted by monthly slab' : 'No professional tax in ' + STATES[st.state_code]) : 'Depends on the state'),
        toggleRow('Income tax (TDS)', oset('tds', 'enabled', true), (on) => { st.tds = on; }, 'Deducted only when someone’s yearly pay is above the tax-free limit'))],
    () => [h('h2', null, 'When do you pay salaries?'), h('p', { class: 'lead' }, 'The date printed on payslips. Pay is for the whole month either way.'),
      selectEl([[0, 'Last day of the month'], ...[1, 2, 3, 4, 5, 7, 10].map((d) => [d, d + (d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th') + ' of the next month'])], st.pay_day, { onchange: (e) => { st.pay_day = +e.target.value; } })],
  ];
  const nextBtn = h('button', { class: 'btn fill', type: 'button' }, 'Continue');
  const backBtn = h('button', { class: 'btn', type: 'button' }, 'Back');
  const paint = () => { clear(body).append(bar, ...steps[step]()); bar.firstChild.style.width = ((step + 1) / steps.length * 100) + '%'; backBtn.classList.toggle('hidden', step === 0); nextBtn.textContent = step === steps.length - 1 ? 'Finish' : 'Continue'; };
  backBtn.onclick = () => { step = Math.max(0, step - 1); paint(); };
  nextBtn.onclick = async () => {
    if (step < steps.length - 1) { step++; paint(); return; }
    nextBtn.disabled = true;
    try {
      await api('pay_save_org', { p: { legal_name: st.legal_name, display_name: st.legal_name, state_code: st.state_code || null, city: st.city, attendance_mode: st.attendance_mode,
        weekly_off: st.weekly_off.map(Number).sort(), pay_day: st.pay_day, setup_done: true,
        settings: { pf: { enabled: st.pf }, esi: { enabled: st.esi }, pt: { enabled: !!st.pt }, tds: { enabled: st.tds !== false } } } });
      await loadCtx(); sh.close(); toast('All set'); buildShell(); route_();
      if (!(await people()).length) addPersonSheet();
    } catch (e) { nextBtn.disabled = false; fail(e); }
  };
  const sh = sheet({ title: 'Set up Payroll', body, closeLabel: 'Later', noFocus: true });
  sh.el.append(h('div', { class: 'sheet-f' }, backBtn, nextBtn));
  paint();
}
function optionCards(opts, value, onChange) {
  const el = h('div', { class: 'options', role: 'radiogroup' });
  opts.forEach(([v, ic, t, s]) => el.append(h('button', { type: 'button', class: 'option', role: 'radio', 'aria-checked': String(v === value), 'data-v': v, onclick: (e) => {
    $$('.option', el).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.v === v))); onChange(v);
  } }, h('span', { class: 'tile' }, icon(ic, 18)), h('span', { class: 'grow' }, h('b', null, t), h('span', { class: 's' }, s)))));
  return el;
}
