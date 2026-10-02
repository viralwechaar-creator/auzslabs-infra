/* AUZslab Payroll: People. The list, adding someone (name, phone and salary is enough), the profile with its tabs, and
   every change to a person: details, job (effective-dated), salary (with a live breakdown), payout details, leaving,
   rehiring, self-service login, kiosk PIN, documents, company items, and bulk import. */
'use strict';
page('people', {
  title: 'People', icon: 'users', perm: 'pay_view',
  async render(v) {
    const sal = can('pay_salary');
    let f = v.q.get('f') || 'current', q = '';
    const all = await people(true);
    const head = ['Code', 'Name', 'Job', 'Department', 'Phone', 'Joined', 'Status', ...(sal ? ['Monthly gross'] : [])];
    const rowsOut = () => all.map((e) => [e.code || '', e.name, e.designation || '', e.department || '', e.phone || '', e.joined_on, EMP[e.status] ? EMP[e.status][0] : e.status, ...(sal ? [+e.gross || 0] : [])]);
    v.header({ title: 'People', sub: all.filter((e) => e.status !== 'exited').length + ' working here',
      actions: [can('pay_people') && { label: 'Add person', icon: 'userplus', primary: true, run: () => addPersonSheet() },
        can('pay_people') && { label: 'Import from a sheet', icon: 'upload', run: () => importSheet() },
        { label: 'Export', icon: 'download', run: (b) => exportMenu(b, 'people', head, rowsOut()) }] });
    const box = h('div');
    const paint = () => {
      const ql = q.toLowerCase();
      const rows = all.filter((e) => (f === 'all' || (f === 'current' ? e.status !== 'exited' : e.status === f)) &&
        (!ql || [e.name, e.code, e.phone, e.designation, e.department].some((x) => String(x || '').toLowerCase().includes(ql))));
      clear(box).append(dataView([
        { key: 'name', label: 'Name', title: true, avatar: (e) => e.name, render: (e) => isDesk() ? h('div', { class: 'row', style: { gap: '10px' } }, avatar(e.name, 30), h('div', null, h('div', { class: 't' }, e.name), h('div', { class: 's' }, e.code || ''))) : e.name },
        { key: 'designation', label: 'Job', sub: true, render: (e) => [e.designation, isDesk() ? null : e.department].filter(Boolean).join(' · ') || (isDesk() ? '' : e.code || '') },
        { key: 'department', label: 'Department', hideDesk: false, render: (e) => e.department || '' },
        { key: 'joined_on', label: 'Joined', render: (e) => fmtD(e.joined_on) },
        { key: 'today', label: 'Today', badge: true, render: (e) => e.status === 'exited' ? empBadge(e.status) : e.status === 'onboarding' ? empBadge('onboarding') : attBadge(e.today) },
        ...(sal ? [{ key: 'gross', label: 'Monthly pay', r: true, value: true, sortVal: (e) => +e.gross || 0, render: (e) => e.gross ? inr(e.gross, 0) : h('span', { class: 'muted' }, 'No salary') }] : []),
      ], rows, { onRow: (e) => go('person/' + e.id), sortKey: 'name', empty: all.length ? empty('search', 'No one found', 'Try another name or filter.') :
        empty('userplus', 'No one here yet', 'Add the people you pay. A name, phone and monthly salary is enough to start.', can('pay_people') ? h('button', { class: 'btn fill', onclick: () => addPersonSheet() }, 'Add person') : null) }));
    };
    v.root.append(h('div', { class: 'toolbar' }, searchField('Search by name, phone or job', (x) => { q = x; paint(); }),
      seg([['current', 'Current'], ['notice', 'Leaving'], ['exited', 'Left'], ['all', 'All']], f, (x) => { f = x; paint(); }, { label: 'Show' })), box);
    paint();
  },
});

// ---------- add a person ----------
function addPersonSheet(prefill = {}) {
  const sal = can('pay_salary');
  const st = { name: '', phone: '', designation: '', joined_on: today(), amount: '', basis: 'monthly', more: false, gender: '', dob: '', department: '', location_id: '', manager_id: '', shift_id: '',
    email: '', pan: '', uan: '', mode: '', pay: 'bank', account_no: '', ifsc: '', bank_name: '', ...prefill };
  const name = input({ value: st.name, placeholder: 'Full name', auto: 'name', oninput: (e) => { st.name = e.target.value; }, autofocus: true });
  const phone = input({ type: 'tel', value: st.phone, placeholder: 'Mobile number', mode: 'tel', oninput: (e) => { st.phone = e.target.value; } });
  const [desig, dl1] = datalistInput('dl-desig', masters('designation'), { value: st.designation, placeholder: 'e.g. Cook, Stylist, Cashier', oninput: (e) => { st.designation = e.target.value; } });
  const joined = dateInput(st.joined_on, { onchange: (e) => { st.joined_on = e.target.value; } });
  const amt = input({ type: 'number', mode: 'decimal', value: st.amount, placeholder: '₹ a month', oninput: (e) => { st.amount = e.target.value; preview(); } });
  const prevBox = h('div', { class: 'small muted' });
  const preview = debounce(async () => {
    clear(prevBox); if (!N(st.amount)) return;
    try {
      const b = await api('pay_preview_structure', { p: { amount: N(st.amount), basis: st.basis, structure_id: defaultStructure(st.basis) } });
      prevBox.append(Object.entries(b.lines).filter(([k]) => b.kinds[k] !== 'employer' || st.basis === 'ctc').map(([k, val]) => (b.names[k] || k) + ' ' + inr(val)).join(' · '), st.basis === 'ctc' ? ' · Monthly gross ' + inr(b.gross) : '');
    } catch (e) { prevBox.textContent = e.message; }
  }, 350);
  const more = h('div', { class: 'grid hidden' });
  const moreBtn = h('button', { class: 'btn plain', type: 'button', style: { justifySelf: 'start', paddingLeft: 0 }, onclick: () => { more.classList.toggle('hidden'); moreBtn.querySelector('span:last-child').textContent = more.classList.contains('hidden') ? 'More details' : 'Fewer details'; } }, icon('chevD', 18), h('span', null, 'More details'));
  const ppl = (PEOPLE || []).filter((e) => e.status !== 'exited');
  const [dept, dl2] = datalistInput('dl-dept', masters('department'), { value: st.department, placeholder: 'e.g. Kitchen', oninput: (e) => { st.department = e.target.value; } });
  const bankBox = h('div', { class: 'grid' });
  const paintBank = () => clear(bankBox).append(st.pay === 'bank' ? [
    field('Account number', input({ value: st.account_no, mode: 'numeric', oninput: (e) => { st.account_no = e.target.value; } })),
    h('div', { class: 'two' }, field('IFSC', input({ value: st.ifsc, placeholder: 'HDFC0001234', oninput: (e) => { st.ifsc = e.target.value.toUpperCase(); } })), field('Bank', input({ value: st.bank_name, oninput: (e) => { st.bank_name = e.target.value; } })))] :
    h('p', { class: 'small muted' }, 'Paid in cash. You can add bank details later.'));
  more.append(
    field('Gender', seg([['female', 'Woman'], ['male', 'Man'], ['other', 'Other']], st.gender, (x) => { st.gender = x; }, { full: true, label: 'Gender' }), 'Some states’ professional tax differs for women'),
    h('div', { class: 'two' }, field('Date of birth', dateInput(st.dob, { onchange: (e) => { st.dob = e.target.value; } })), field('Department', dept), dl2),
    (S.ctx.locations || []).length ? field('Works at', selectEl([['', 'Main location'], ...S.ctx.locations.filter((l) => l.active).map((l) => [l.id, l.name])], st.location_id, { onchange: (e) => { st.location_id = e.target.value; } })) : null,
    ppl.length ? field('Reports to', selectEl([['', 'No one'], ...ppl.map((e) => [e.id, e.name])], st.manager_id, { onchange: (e) => { st.manager_id = e.target.value; } }), 'They can approve this person’s leave') : null,
    (S.ctx.shifts || []).length ? field('Shift', selectEl([['', 'No fixed shift'], ...S.ctx.shifts.filter((s) => s.active).map((s) => [s.id, s.name + ' ' + s.start_time.slice(0, 5) + '-' + s.end_time.slice(0, 5)])], st.shift_id, { onchange: (e) => { st.shift_id = e.target.value; } })) : null,
    field('Attendance', selectEl([['', 'Business setting'], ['punch', 'Clocks in'], ['manual', 'I mark absences'], ['none', 'Not tracked']], st.mode, { onchange: (e) => { st.mode = e.target.value; } })),
    field('Email', input({ type: 'email', value: st.email, oninput: (e) => { st.email = e.target.value; } })),
    sal ? h('div', { class: 'two' }, field('PAN', input({ value: st.pan, placeholder: 'ABCDE1234F', oninput: (e) => { st.pan = e.target.value.toUpperCase(); } })), field('UAN (PF)', input({ value: st.uan, mode: 'numeric', oninput: (e) => { st.uan = e.target.value; } }))) : null,
    sal ? field('Salary paid by', seg([['bank', 'Bank transfer'], ['cash', 'Cash']], st.pay, (x) => { st.pay = x; paintBank(); }, { full: true, label: 'Salary paid by' })) : null,
    sal ? bankBox : null);
  paintBank();
  const body = h('div', { class: 'grid' }, field('Name', name), field('Mobile', phone), field('Job', desig), dl1, field('Joined on', joined),
    sal ? field(st.basis === 'ctc' ? 'Cost to company a year' : 'Monthly salary', amt, h('span', null, 'Before deductions. ', h('a', { href: '#', onclick: (e) => { e.preventDefault(); st.basis = st.basis === 'ctc' ? 'monthly' : 'ctc'; e.target.textContent = st.basis === 'ctc' ? 'Enter a monthly salary instead' : 'Enter yearly CTC instead'; amt.placeholder = st.basis === 'ctc' ? '₹ a year' : '₹ a month'; e.target.closest('.field').querySelector('label').textContent = st.basis === 'ctc' ? 'Cost to company a year' : 'Monthly salary'; preview(); } }, 'Enter yearly CTC instead'))) : null,
    sal ? prevBox : null, moreBtn, more);
  sheet({ title: 'Add person', body, actions: [{ label: 'Add', primary: true, onclick: async (close) => {
    if (!st.name.trim()) { name.classList.add('err'); name.focus(); return false; }
    const p = { name: st.name.trim(), phone: st.phone, joined_on: st.joined_on, gender: st.gender || null, dob: st.dob || null, email: st.email, attendance_mode: st.mode || null,
      job: { designation: st.designation, department: st.department, location_id: st.location_id || null, manager_id: st.manager_id || null, shift_id: st.shift_id || null } };
    if (sal) {
      if (st.pan) p.pan = st.pan; if (st.uan) p.uan = st.uan;
      if (N(st.amount) > 0) p.salary = { amount: N(st.amount), structure_id: defaultStructure(st.basis) };
      p.bank = st.pay === 'cash' ? { mode: 'cash' } : (st.account_no ? { mode: 'bank', account_no: st.account_no, ifsc: st.ifsc, bank_name: st.bank_name, holder: st.name } : undefined);
    }
    const id = await api('pay_save_employee', { p });
    bust(); close(); toast(st.name.trim() + ' added'); go('person/' + id);
  } }] });
  preview();
}
const defaultStructure = (basis) => { const ss = (S.ctx.structures || []).filter((s) => s.active); return ((basis === 'ctc' ? ss.find((s) => s.basis === 'ctc') : null) || ss.find((s) => s.is_default && s.basis === basis) || ss.find((s) => s.basis === basis) || ss[0] || {}).id || null; };

// ---------- the profile ----------
page('person', {
  title: 'Person', icon: 'user', navAs: 'people', nav: false, perm: 'pay_view',
  async render(v) {
    const e = await api('pay_get_employee', { p_id: v.args[0] });
    const sal = can('pay_salary');
    let tab = v.q.get('tab') || 'overview';
    const acts = personActions(e);
    v.header({ title: e.name, back: 'people', actions: acts.length ? [{ label: 'Actions', icon: 'more', menu: acts }] : [] });
    const job = (e.jobs || [])[0] || {};
    v.root.append(h('div', { class: 'card', style: { display: 'flex', gap: '16px', alignItems: 'center' } }, avatar(e.name, 64),
      h('div', { class: 'grow' }, h('div', { style: { fontSize: '22px', fontWeight: 700, letterSpacing: '-.02em' } }, e.name),
        h('div', { class: 'muted' }, [e.designation, e.department, e.code].filter(Boolean).join(' · ') || 'No job title yet'),
        h('div', { class: 'row wrap', style: { gap: '6px', marginTop: '8px' } }, empBadge(e.status), e.status !== 'exited' ? attBadge(e.today) : null, e.linked ? badge('Has app login', 'blue') : null,
          e.status === 'notice' ? badge('Last day ' + fmtD(e.last_day, { noYear: true }), 'orange') : null))));
    if (e.status === 'exited' && !e.fnf_done && can('pay_run')) v.root.append(banner('', 'alert', 'Left on ' + fmtD(e.last_day) + '. ', h('a', { href: '#', onclick: (x) => { x.preventDefault(); startFnf(e); } }, 'Settle full and final')));
    if (sal && e.bank_pending) v.root.append(banner('', 'bank', h('b', null, 'New payout details are waiting for approval: '), (e.bank_pending.bank_name || e.bank_pending.mode) + ' ' + (e.bank_pending.account_no ? '••••' + e.bank_pending.account_no.slice(-4) : e.bank_pending.upi || '') + ' ',
      h('a', { href: '#', onclick: async (x) => { x.preventDefault(); try { await api('pay_bank_decide', { p_id: e.bank_pending.id, p_approve: true }); toast('Approved'); route_(); } catch (er) { fail(er); } } }, 'Approve'), ' · ',
      h('a', { href: '#', onclick: async (x) => { x.preventDefault(); try { await api('pay_bank_decide', { p_id: e.bank_pending.id, p_approve: false }); toast('Declined'); route_(); } catch (er) { fail(er); } } }, 'Decline')));
    if (sal && !(e.salaries || []).length && e.status !== 'exited') v.root.append(banner('', 'alert', 'No salary yet: payroll pays this person nothing. ', h('a', { href: '#', onclick: (x) => { x.preventDefault(); salarySheet(e); } }, 'Set salary')));
    const tabs = [['overview', 'Overview'], sal ? ['pay', 'Pay'] : null, ['time', 'Time'], ['leave', 'Leave'], ['files', 'Files'], ['history', 'History']].filter(Boolean);
    const box = h('div', { class: 'grid' });
    const paint = async () => { clear(box); try { await PERSON_TABS[tab](box, e); } catch (er) { box.append(empty('alert', 'Could not load', er.message)); } };
    v.root.append(seg(tabs, tab, (x) => { tab = x; history.replaceState(null, '', '#/person/' + e.id + '?tab=' + x); paint(); }, { label: 'Section' }), box);
    paint();
  },
});
function personActions(e) {
  const a = [];
  if (can('pay_people')) a.push({ label: 'Edit details', icon: 'edit', run: () => editPersonSheet(e) }, { label: 'Change job or team', icon: 'briefcase', run: () => jobSheet(e) });
  if (can('pay_salary')) a.push({ label: 'Change salary', icon: 'rupee', run: () => salarySheet(e) }, { label: 'Payout details', icon: 'bank', run: () => bankSheet(e) });
  if (can('pay_salary') && can('pay_approve') && e.status !== 'exited') a.push({ label: 'Give an advance or loan', icon: 'cash', run: () => loanSheet(e) });
  if (can('pay_time') && e.status !== 'exited') a.push({ label: 'Add leave', icon: 'leave', run: () => addLeaveSheet(e) });
  if (can('pay_people')) a.push('-', { label: 'App login', icon: 'login', run: () => loginSheet(e) });
  if (can('pay_time')) a.push({ label: 'Kiosk PIN', icon: 'key', run: () => pinSheet(e) });
  if (can('pay_people')) {
    a.push('-');
    if (e.status === 'onboarding') a.push({ label: 'Started work', icon: 'check', run: () => statusAction(e, { action: 'activate' }) });
    if (e.status === 'active') a.push({ label: 'Record resignation or exit', icon: 'door', run: () => exitSheet(e) });
    if (e.status === 'notice') a.push({ label: 'Withdraw resignation', icon: 'undo', run: async () => { if (await confirmBox('Withdraw resignation?', e.name + ' stays on as before.', 'Withdraw')) statusAction(e, { action: 'withdraw' }); } }, { label: 'Change last day', icon: 'calendar', run: () => exitSheet(e) });
    if (e.status === 'exited') a.push({ label: 'Rehire', icon: 'userplus', run: () => rehireSheet(e) });
  }
  if (can('pay_run') && ['notice', 'exited'].includes(e.status) && !e.fnf_done) a.push({ label: 'Full and final settlement', icon: 'wallet', run: () => startFnf(e) });
  return a;
}
async function statusAction(e, p) { try { await api('pay_set_status', { p_emp: e.id, p }); bust(); toast('Saved'); route_(); } catch (er) { fail(er); } }
async function startFnf(e) {
  try { const id = await api('pay_run_create', { p: { kind: 'fnf', employee_id: e.id } }); await api('pay_run_calculate', { p_run: id }); go('run/' + id); } catch (er) { fail(er); }
}

const kvList = (pairs) => !pairs.some((x) => x && x[1] != null && x[1] !== '') ? h('p', { class: 'small muted', style: { padding: '0 4px' } }, 'Nothing added yet.') : h('div', { class: 'list' }, pairs.filter((x) => x && x[1] != null && x[1] !== '').map(([k, val, o = {}]) => h(o.href ? 'a' : 'div', { class: 'li', href: o.href },
  h('div', { class: 'grow' }, h('div', { class: 's', style: { marginTop: 0 } }, k), h('div', { class: 't', style: { whiteSpace: 'normal' } }, val)), o.href ? h('span', { class: 'chev' }, icon('chevR', 18)) : null)));
const MODE = { punch: 'Clocks in', manual: 'Marked by you (present unless marked away)', none: 'Not tracked' };
const PERSON_TABS = {
  async overview(box, e) {
    const job = (e.jobs || [])[0] || {};
    const off = job.weekly_off || org().weekly_off || [];
    box.append(h('div', { class: 'two' },
      section('Contact', kvList([['Mobile', e.phone, { href: e.phone ? 'tel:' + e.phone : null }], ['Email', e.email, { href: e.email ? 'mailto:' + e.email : null }], ['Address', e.address],
        ['In an emergency', [e.emergency_name, e.emergency_phone].filter(Boolean).join(', ')], ['Date of birth', e.dob ? fmtD(e.dob) : null]])),
      section('Work', kvList([['Joined', fmtD(e.joined_on) + tenure(e.joined_on, e.last_day)], ['Job', job.designation], ['Department', job.department], ['Works at', job.location],
        ['Reports to', job.manager], ['Shift', job.shift], ['Type', cap1(job.emp_type)], ['Weekly day off', off.length ? off.map((d) => WEEKDAYS[d]).join(', ') : 'None'], ['Attendance', MODE[e.attendance_mode]],
        ['Probation ends', e.confirm_on ? fmtD(e.confirm_on) : null], ['Last day', e.last_day ? fmtD(e.last_day) : null], ['Why leaving', e.exit_reason]]))));
    if (can('pay_salary')) box.append(section('Tax and statutory', kvList([['PAN', e.pan || 'Not given'], ['UAN (PF)', e.uan || 'Not given'], ['ESI number', e.esi_no || 'Not given'],
      ['Aadhaar', e.aadhaar_last4 ? '•••• ' + e.aadhaar_last4 : null], ['Income-tax regime', e.tax_regime === 'old' ? 'Old regime' : 'New regime'],
      ['Contributions', [e.pf_applicable ? 'PF' : null, e.esi_applicable ? 'ESI' : null, e.pt_applicable ? 'Professional tax' : null].filter(Boolean).join(', ') || 'None']])));
    const m = e.month || {};
    box.append(section('This month', h('div', { class: 'pill-stats' }, statPill('Present', m.present, 'green'), statPill('Late', m.late, 'orange'), statPill('Absent', m.absent, 'red'), statPill('Leave', m.leave, 'blue'), statPill('Half days', m.half, 'orange'))));
  },
  async pay(box, e) {
    const cur = (e.salaries || []).find((s) => s.eff_from <= today()) || (e.salaries || [])[0];
    if (cur) {
      const b = cur.breakup || {}, names = Object.fromEntries((S.ctx.components || []).map((c) => [c.code, c.name]));
      const lines = Object.entries(b.lines || {}).filter(([, a]) => +a);
      box.append(section(h('div', { class: 'row sp' }, h('h3', null, 'Salary'), h('button', { class: 'btn sm', type: 'button', onclick: () => salarySheet(e) }, 'Change')),
        h('div', { class: 'card', style: { display: 'grid', gap: '10px' } },
          h('div', { class: 'row sp' }, h('div', { class: 'hero' }, h('div', { class: 'k' }, cur.basis === 'ctc' ? 'Cost to company a year' : 'Monthly salary'), h('div', { class: 'n' }, inr(cur.amount, 0))),
            h('div', { class: 'muted', style: { textAlign: 'right' } }, cur.structure, h('br'), 'since ' + fmtD(cur.eff_from))),
          h('table', { class: 'lines-t' }, h('tbody', null, lines.map(([k, a]) => h('tr', null, h('td', null, names[k] || k, (b.kinds || {})[k] === 'employer' ? h('span', { class: 'calc' }, 'Paid by you, part of CTC') : null), h('td', { class: 'r' }, inr(a)))),
            h('tr', { class: 'tot' }, h('td', null, 'Monthly gross'), h('td', { class: 'r' }, inr(b.gross))))),
          +cur.ot_rate ? h('div', { class: 'small muted' }, 'Overtime ' + inr(cur.ot_rate) + ' an hour') : null)));
    }
    const bk = e.bank;
    box.append(section(h('div', { class: 'row sp' }, h('h3', null, 'Salary is paid to'), h('button', { class: 'btn sm', type: 'button', onclick: () => bankSheet(e) }, bk ? 'Change' : 'Add')),
      bk ? kvList([['Method', { bank: 'Bank transfer', upi: 'UPI', cash: 'Cash', cheque: 'Cheque' }[bk.mode]], ['Bank', bk.bank_name], ['Account', bk.account_no ? maskReveal(bk.account_no) : null], ['IFSC', bk.ifsc], ['UPI', bk.upi], ['Name on account', bk.holder]])
        : h('div', { class: 'card muted' }, 'Not set: salary will be paid in cash.')));
    if ((e.loans || []).length) box.append(section('Advances and loans', h('div', { class: 'list' }, e.loans.map((l) => liRow({ icon: 'cash', tone: l.status === 'active' ? 'orange' : 'gray', title: (l.kind === 'advance' ? 'Advance ' : 'Loan ') + inr(l.amount, 0),
      sub: l.status === 'active' ? inr(l.emi) + ' a month · ' + inr(l.outstanding) + ' left' : REQ[l.status] ? REQ[l.status][0] : l.status, badge: reqBadge(l.status), onclick: () => go('loans?id=' + l.id) })))));
    box.append(section(h('div', { class: 'row sp' }, h('h3', null, 'Payslips'), (e.payslips || []).length ? h('span', { class: 'small muted' }, e.payslips.length) : null),
      (e.payslips || []).length ? h('div', { class: 'list' }, e.payslips.slice(0, 24).map((p) => liRow({ icon: 'doc', tone: 'gray', title: p.title || monthName(p.month), sub: p.payslip_no || (p.kind === 'legacy' ? 'From the old Payroll' : ''), value: inr(p.net), onclick: () => go('payslip/' + p.id) })))
        : h('div', { class: 'card muted' }, 'No payslips yet.')));
    box.append(section(h('div', { class: 'row sp' }, h('h3', null, 'Income tax'), h('button', { class: 'btn sm', type: 'button', onclick: () => taxSheet(e) }, 'Open')),
      h('div', { class: 'card muted' }, (e.tax_regime === 'old' ? 'Old regime' : 'New regime') + (e.tax ? ' · declarations for ' + e.tax.fy + ' saved' : ' · no declarations'))));
    if ((e.salaries || []).length > 1) box.append(section('Salary history', h('div', { class: 'list' }, e.salaries.map((s) => liRow({ icon: 'rupee', tone: 'gray', title: inr(s.amount, 0) + (s.basis === 'ctc' ? ' a year' : ' a month'),
      sub: 'From ' + fmtD(s.eff_from) + ' · ' + cap1(s.reason || '') + (s.used ? ' · paid' : ''), right: !s.used && can('pay_salary') ? h('button', { class: 'btn sm plain', type: 'button', 'aria-label': 'Delete', onclick: async () => { if (await confirmBox('Delete this salary?', 'It has not been used by a finalised payroll yet.', 'Delete', true)) { try { await api('pay_delete_salary', { p_id: s.id }); route_(); } catch (er) { fail(er); } } } }, icon('trash', 18)) : null })))));
  },
  async time(box, e) {
    let m = monthOf(today());
    const holder = h('div', { class: 'grid' });
    const paintMonth = async () => {
      clear(holder).append(h('div', { class: 'skel', style: { height: '300px' } }));
      const d = await api('pay_attendance_month', { p_emp: e.id, p_month: m });
      clear(holder).append(h('div', { class: 'row sp' }, h('button', { class: 'btn plain icon', type: 'button', 'aria-label': 'Previous month', onclick: () => { m = monthAdd(m, -1); paintMonth(); } }, icon('chevL', 22)),
        h('h3', { style: { fontSize: '20px' } }, monthName(m)), h('button', { class: 'btn plain icon', type: 'button', 'aria-label': 'Next month', onclick: () => { m = monthAdd(m, 1); paintMonth(); } }, icon('chevR', 22))),
        monthCalendar(m, d.days, (day) => daySheet(e, day.date, () => paintMonth())), calLegend(),
        h('div', { class: 'small muted' }, 'Mode: ' + MODE[d.employee.mode] + '. Tap a day to see clock-ins or mark it.'));
    };
    box.append(holder); paintMonth();
  },
  async leave(box, e) {
    box.append(h('div', { class: 'kpis' }, (e.leave || []).filter((l) => l.paid).map((l) => kpi(l.name, qty(l.balance) + ' days', 'used ' + qty(l.used) + (+l.pending ? ' · ' + qty(l.pending) + ' waiting' : ''),
      can('pay_time') ? () => leaveLedgerSheet(e, l) : null))));
    if (can('pay_time') && e.status !== 'exited') box.append(h('div', { class: 'row wrap' }, h('button', { class: 'btn', type: 'button', onclick: () => addLeaveSheet(e) }, icon('plus', 18), 'Add leave')));
    const reqs = (await api('pay_list_requests', { p: { status: 'all', employee_id: e.id } })).filter((x) => x.type === 'leave');
    box.append(section('Leave taken and asked for', reqs.length ? h('div', { class: 'list' }, reqs.map((x) => liRow({ icon: 'leave', tone: 'gray', title: x.title,
      sub: fmtD(x.from, { noYear: true }) + (x.to !== x.from ? ' to ' + fmtD(x.to, { noYear: true }) : '') + (x.reason ? ' · ' + x.reason : ''), badge: reqBadge(x.status),
      onclick: ['pending', 'approved'].includes(x.status) && can('pay_time') ? async () => {
        const ch = await alertBox({ title: x.title, message: fmtD(x.from) + (x.to !== x.from ? ' to ' + fmtD(x.to) : ''), actions: [x.status === 'pending' ? { label: 'Approve', value: 'ok', role: 'def' } : null, { label: 'Cancel this leave', value: 'cancel', role: 'danger' }, { label: 'Close', value: false }].filter(Boolean) });
        try { if (ch === 'ok') await api('pay_leave_decide', { p_id: x.id, p_approve: true, p_note: null }); else if (ch === 'cancel') await api('pay_leave_cancel', { p_id: x.id, p_reason: 'Cancelled by HR' }); else return; toast('Done'); route_(); } catch (er) { fail(er); }
      } : null }))) : h('div', { class: 'card muted' }, 'No leave yet.')));
  },
  async files(box, e) {
    box.append(section(h('div', { class: 'row sp' }, h('h3', null, 'Documents'), can('pay_people') ? h('button', { class: 'btn sm', type: 'button', onclick: () => docSheet(e) }, icon('upload', 18), 'Add') : null),
      (e.documents || []).length ? h('div', { class: 'list' }, e.documents.map((d) => liRow({ icon: 'file', tone: 'gray', title: d.name || d.doc_type, sub: d.doc_type + ' · ' + fmtD(d.created_at.slice(0, 10)) + (d.employee_can_see ? '' : ' · only HR can see'),
        onclick: () => openDoc(d.path).catch(fail), right: can('pay_people') ? h('button', { class: 'btn sm plain', type: 'button', 'aria-label': 'Delete', onclick: async (ev) => { ev.stopPropagation(); if (await confirmBox('Delete this document?', d.name || d.doc_type, 'Delete', true)) { try { await api('pay_delete_document', { p_id: d.id }); route_(); } catch (er) { fail(er); } } } }, icon('trash', 18)) : null })))
        : h('div', { class: 'card muted' }, 'No documents. Add their ID proof, offer letter or bank proof.')));
    box.append(section(h('div', { class: 'row sp' }, h('h3', null, 'Company items with them'), can('pay_people') ? h('button', { class: 'btn sm', type: 'button', onclick: () => assetSheet(e) }, icon('plus', 18), 'Add') : null),
      (e.assets || []).length ? h('div', { class: 'list' }, e.assets.map((a) => liRow({ icon: 'bag', tone: a.returned_on ? 'gray' : 'blue', title: a.name, sub: (a.serial ? a.serial + ' · ' : '') + 'Given ' + fmtD(a.issued_on) + (a.returned_on ? ' · returned ' + fmtD(a.returned_on) : ''),
        badge: a.returned_on ? badge('Returned', 'green') : badge('With them', 'blue'), onclick: can('pay_people') ? () => assetSheet(e, a) : null })))
        : h('div', { class: 'card muted' }, 'Nothing recorded. Uniforms, keys, phones: anything to get back when they leave.')));
  },
  async history(box, e) {
    box.append(section('Timeline', h('div', { class: 'card' }, h('div', { class: 'timeline' }, (e.events || []).map((x) => h('div', { class: 'ev' }, h('i'), h('div', null, h('div', { class: 't' }, x.title), h('div', { class: 's' }, fmtD(x.on_date)))))))));
    if ((e.jobs || []).length > 1) box.append(section('Job history', h('div', { class: 'list' }, e.jobs.map((j) => liRow({ icon: 'briefcase', tone: 'gray', title: [j.designation, j.department].filter(Boolean).join(' · ') || 'Job', sub: 'From ' + fmtD(j.eff_from) + (j.reason ? ' · ' + j.reason : '') })))));
    if (can('pay_audit')) {
      const au = await api('pay_list_audit', { p: { employee_id: e.id, limit: 50 } });
      if (au.length) box.append(section('Changes made', h('div', { class: 'list' }, au.map((x) => liRow({ icon: 'shield', tone: 'gray', title: cap1(x.action) + ' ' + x.entity.replace(/_/g, ' '), sub: (x.actor || 'System') + ' · ' + fmtDT(x.at) + (x.reason ? ' · ' + x.reason : '') })))));
    }
  },
};
function tenure(from, to) {
  const a = parseD(from), b = to ? parseD(to) : parseD(today());
  let mo = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth(); if (b.getDate() < a.getDate()) mo--;
  if (mo < 1) return ''; const y = Math.floor(mo / 12), m = mo % 12;
  return ' (' + [y ? y + (y > 1 ? ' years' : ' year') : '', m ? m + (m > 1 ? ' months' : ' month') : ''].filter(Boolean).join(' ') + ')';
}
function maskReveal(s) { const sp = h('button', { type: 'button', class: 'btn sm plain', style: { padding: 0, minHeight: 0, fontWeight: 400, color: 'inherit' }, title: 'Show', onclick: () => { sp.textContent = s; } }, '•••• ' + s.slice(-4)); return sp; }

// one month as a calendar: days: [{date, status, ...}]
function monthCalendar(m, days, onDay) {
  const by = Object.fromEntries((days || []).map((d) => [d.date, d]));
  const first = new Date(+m.slice(0, 4), +m.slice(5, 7) - 1, 1).getDay(), n = daysIn(m), t = today();
  return h('div', { class: 'cal', role: 'grid', 'aria-label': monthName(m) },
    WEEKDAYS.map((d) => h('div', { class: 'hd' }, d.slice(0, 1))),
    Array.from({ length: first }, () => h('div', { class: 'blank' })),
    Array.from({ length: n }, (_, i) => {
      const ds = m + '-' + pad(i + 1), d = by[ds];
      return h('button', { type: 'button', class: [d ? d.status : '', ds === t ? 'today' : '', ds > t ? 'future' : ''].join(' '), 'aria-label': fmtD(ds) + (d ? ': ' + (ATT[d.status] || [d.status])[0] : ''),
        onclick: () => onDay({ date: ds, ...(d || {}) }) }, String(i + 1), h('span', { class: 'm' }));
    }));
}
function calLegend() {
  return h('div', { class: 'legend-row' }, [['green', 'Present'], ['orange', 'Late or half day'], ['red', 'Absent'], ['blue', 'Leave'], ['', 'Day off or holiday']].map(([t, l]) => h('span', null, h('i', { class: 'dotc ' + t }), l)));
}

// ---------- edit sheets ----------
function editPersonSheet(e) {
  const sal = can('pay_salary');
  const f = { name: e.name, code: e.code || '', phone: e.phone || '', email: e.email || '', gender: e.gender || '', dob: e.dob || '', joined_on: e.joined_on, confirm_on: e.confirm_on || '', address: e.address || '',
    emergency_name: e.emergency_name || '', emergency_phone: e.emergency_phone || '', attendance_mode: e.attendance_mode && e.attendance_mode !== org().attendance_mode ? e.attendance_mode : '',
    pan: e.pan || '', uan: e.uan || '', esi_no: e.esi_no || '', aadhaar_last4: e.aadhaar_last4 || '', tax_regime: e.tax_regime || 'new', pf_applicable: e.pf_applicable, eps_applicable: e.eps_applicable,
    esi_applicable: e.esi_applicable, pt_applicable: e.pt_applicable, disabled_person: e.disabled_person };
  const t = (k, o = {}) => input({ value: f[k], type: o.type, mode: o.mode, placeholder: o.ph, oninput: (ev) => { f[k] = o.upper ? ev.target.value.toUpperCase() : ev.target.value; } });
  const body = h('div', { class: 'grid' },
    h('div', { class: 'two' }, field('Name', t('name')), field('Employee number', t('code'))),
    h('div', { class: 'two' }, field('Mobile', t('phone', { type: 'tel', mode: 'tel' })), field('Email', t('email', { type: 'email' }))),
    field('Gender', seg([['female', 'Woman'], ['male', 'Man'], ['other', 'Other']], f.gender, (x) => { f.gender = x; }, { full: true, label: 'Gender' })),
    h('div', { class: 'two' }, field('Date of birth', dateInput(f.dob, { onchange: (ev) => { f.dob = ev.target.value; } })), field('Joined on', dateInput(f.joined_on, { onchange: (ev) => { f.joined_on = ev.target.value; } }))),
    field('Probation ends on', dateInput(f.confirm_on, { onchange: (ev) => { f.confirm_on = ev.target.value; } })),
    field('Address', h('textarea', { class: 'textarea', oninput: (ev) => { f.address = ev.target.value; } }, f.address)),
    h('div', { class: 'two' }, field('Emergency contact', t('emergency_name')), field('Their phone', t('emergency_phone', { type: 'tel' }))),
    field('Attendance', selectEl([['', 'Business setting (' + MODE[org().attendance_mode].split(' (')[0].toLowerCase() + ')'], ['punch', 'Clocks in'], ['manual', 'Marked by you'], ['none', 'Not tracked']], f.attendance_mode, { onchange: (ev) => { f.attendance_mode = ev.target.value; } })),
    sal ? section('Tax and statutory',
      h('div', { class: 'two' }, field('PAN', t('pan', { upper: true, ph: 'ABCDE1234F' })), field('UAN (PF)', t('uan', { mode: 'numeric' }))),
      h('div', { class: 'two' }, field('ESI number', t('esi_no', { mode: 'numeric' })), field('Aadhaar, last 4 digits', t('aadhaar_last4', { mode: 'numeric' }))),
      field('Income-tax regime', seg([['new', 'New regime'], ['old', 'Old regime']], f.tax_regime, (x) => { f.tax_regime = x; }, { full: true, label: 'Tax regime' })),
      h('div', { class: 'list' }, toggleRow('Provident fund', f.pf_applicable, (x) => { f.pf_applicable = x; }), toggleRow('Pension (EPS)', f.eps_applicable, (x) => { f.eps_applicable = x; }, 'Off for members who joined PF after 2014 earning above the ceiling, or are 58 or older'),
        toggleRow('ESI', f.esi_applicable, (x) => { f.esi_applicable = x; }), toggleRow('Professional tax', f.pt_applicable, (x) => { f.pt_applicable = x; }), toggleRow('Person with a disability', f.disabled_person, (x) => { f.disabled_person = x; }, 'Higher ESI wage limit'))) : null);
  sheet({ title: 'Edit details', body, actions: [{ label: 'Save', primary: true, onclick: async (close) => {
    const p = { ...f, id: e.id }; if (!sal) ['pan', 'uan', 'esi_no', 'aadhaar_last4', 'tax_regime', 'pf_applicable', 'eps_applicable', 'esi_applicable', 'pt_applicable', 'disabled_person'].forEach((k) => delete p[k]);
    await api('pay_save_employee', { p }); bust(); close(); toast('Saved'); route_();
  } }] });
}
function jobSheet(e) {
  const j = (e.jobs || [])[0] || {};
  const f = { eff_from: today(), designation: j.designation || '', department: j.department || '', location_id: j.location_id || '', manager_id: j.manager_id || '', shift_id: j.shift_id || '', emp_type: j.emp_type || 'full_time',
    weekly_off: j.weekly_off ? [...j.weekly_off] : null, reason: 'change' };
  const ppl = (PEOPLE || []).filter((x) => x.status !== 'exited' && x.id !== e.id);
  const offBox = h('div');
  const paintOff = () => clear(offBox).append(f.weekly_off ? chips(WEEKDAYS.map((d, i) => [i, d]), f.weekly_off, (x, on) => { f.weekly_off = on ? [...new Set([...f.weekly_off, x])] : f.weekly_off.filter((y) => y !== x); }, { wrap: true, label: 'Weekly off' }) : null);
  const [desig, dl1] = datalistInput('dl-desig2', masters('designation'), { value: f.designation, oninput: (ev) => { f.designation = ev.target.value; } });
  const [dept, dl2] = datalistInput('dl-dept2', masters('department'), { value: f.department, oninput: (ev) => { f.department = ev.target.value; } });
  const body = h('div', { class: 'grid' },
    field('What changed', seg([['promotion', 'Promotion'], ['transfer', 'Transfer'], ['change', 'Other']], f.reason, (x) => { f.reason = x; }, { full: true, label: 'Reason' })),
    field('From', dateInput(f.eff_from, { onchange: (ev) => { f.eff_from = ev.target.value; } }), 'Earlier dates are kept as history'),
    h('div', { class: 'two' }, field('Job', desig), field('Department', dept)), dl1, dl2,
    field('Works at', selectEl([['', 'Main location'], ...(S.ctx.locations || []).map((l) => [l.id, l.name])], f.location_id, { onchange: (ev) => { f.location_id = ev.target.value; } })),
    field('Reports to', selectEl([['', 'No one'], ...ppl.map((x) => [x.id, x.name])], f.manager_id, { onchange: (ev) => { f.manager_id = ev.target.value; } })),
    field('Shift', selectEl([['', 'No fixed shift'], ...(S.ctx.shifts || []).map((s) => [s.id, s.name + ' ' + s.start_time.slice(0, 5) + '-' + s.end_time.slice(0, 5)])], f.shift_id, { onchange: (ev) => { f.shift_id = ev.target.value; } })),
    field('Type', selectEl([['full_time', 'Full time'], ['part_time', 'Part time'], ['contract', 'Contract'], ['fixed_term', 'Fixed term'], ['intern', 'Intern']], f.emp_type, { onchange: (ev) => { f.emp_type = ev.target.value; } })),
    h('div', { class: 'list' }, toggleRow('Own weekly day off', !!f.weekly_off, (on) => { f.weekly_off = on ? [...(org().weekly_off || [0])] : null; paintOff(); }, 'Otherwise the business setting applies')), offBox);
  paintOff();
  sheet({ title: 'Change job or team', body, actions: [{ label: 'Save', primary: true, onclick: async (close) => {
    const p = { ...f, title: { promotion: 'Promoted', transfer: 'Transferred', change: 'Job details changed' }[f.reason] + (f.designation ? ': ' + f.designation : '') };
    if (!f.weekly_off) p.weekly_off = null;
    await api('pay_save_job', { p_emp: e.id, p }); bust(); close(); toast('Saved'); route_();
  } }] });
}
function salarySheet(e) {
  const cur = (e.salaries || [])[0];
  const ss = (S.ctx.structures || []).filter((s) => s.active);
  const f = { eff_from: cur ? (today().slice(0, 8) + '01') : e.joined_on, structure_id: cur ? cur.structure_id : defaultStructure('monthly'), amount: cur ? cur.amount : '', ot_rate: cur ? cur.ot_rate : 0, overrides: { ...(cur ? cur.overrides : {}) }, reason: cur ? 'increment' : 'joining' };
  const st = () => ss.find((s) => s.id === f.structure_id) || {};
  const prev = h('div', { class: 'card', style: { display: 'grid', gap: '8px' } });
  const amtLbl = h('label');
  const amt = input({ type: 'number', mode: 'decimal', value: f.amount, oninput: (ev) => { f.amount = ev.target.value; paint(); } });
  const ot = input({ type: 'number', mode: 'decimal', value: f.ot_rate, oninput: (ev) => { f.ot_rate = ev.target.value; } });
  const ovBox = h('div', { class: 'grid hidden' });
  const paint = debounce(async () => {
    amtLbl.textContent = st().basis === 'ctc' ? 'Cost to company a year' : 'Monthly salary';
    clear(prev);
    if (!N(f.amount)) { prev.append(h('span', { class: 'muted' }, 'Enter an amount to see how it splits.')); return; }
    try {
      const b = await api('pay_preview_structure', { p: { structure_id: f.structure_id, amount: N(f.amount), overrides: f.overrides, date: f.eff_from } });
      prev.append(h('table', { class: 'lines-t' }, h('tbody', null, b.order.filter((k) => +b.lines[k]).map((k) => h('tr', null, h('td', null, b.names[k] || k, b.kinds[k] === 'employer' ? h('span', { class: 'calc' }, 'Paid by you') : b.kinds[k] === 'deduction' ? h('span', { class: 'calc' }, 'Deducted every month') : null), h('td', { class: 'r' }, inr(b.lines[k])))),
        h('tr', { class: 'tot' }, h('td', null, 'Monthly gross'), h('td', { class: 'r' }, inr(b.gross))))),
        st().basis === 'ctc' ? h('div', { class: 'small muted' }, 'CTC ' + inr(b.ctc * 12, 0) + ' a year = gross ' + inr(b.gross) + ' + employer cost ' + inr(b.employer) + ' a month') : null);
      clear(ovBox).append(h('p', { class: 'small muted' }, 'Fix any part to an exact monthly amount. Leave blank to use the rule.'),
        b.order.filter((k) => b.kinds[k] !== 'employer').map((k) => field(b.names[k] || k, input({ type: 'number', mode: 'decimal', placeholder: inr(b.lines[k]), value: f.overrides[k] ?? '', onchange: (ev) => { if (ev.target.value === '') delete f.overrides[k]; else f.overrides[k] = N(ev.target.value); paint(); } }))));
    } catch (er) { prev.append(h('span', { style: { color: 'var(--red)' } }, er.message)); }
  }, 300);
  const body = h('div', { class: 'grid' },
    cur ? field('Why', seg([['increment', 'Increment'], ['promotion', 'Promotion'], ['correction', 'Correction']], f.reason, (x) => { f.reason = x; }, { full: true, label: 'Why' })) : null,
    field('Starts from', dateInput(f.eff_from, { min: e.joined_on, onchange: (ev) => { f.eff_from = ev.target.value; paint(); } }), cur ? 'A date in a month already paid adds arrears to the next payroll' : null),
    field('How it splits', selectEl(ss.map((s) => [s.id, s.name + (s.basis === 'ctc' ? ' (yearly CTC)' : '')]), f.structure_id, { onchange: (ev) => { f.structure_id = ev.target.value; paint(); } }), st().description),
    h('div', { class: 'field' }, amtLbl, amt), prev,
    field('Overtime pay an hour', ot, h('span', null, 'Used when overtime is clocked. ', h('a', { href: '#', onclick: async (ev) => { ev.preventDefault(); try { const b = await api('pay_preview_structure', { p: { structure_id: f.structure_id, amount: N(f.amount) } }); f.ot_rate = Math.round(b.gross / 26 / 8 * 2); ot.value = f.ot_rate; } catch (er) { fail(er); } } }, 'Use twice the hourly pay'))),
    h('button', { class: 'btn plain', type: 'button', style: { justifySelf: 'start', paddingLeft: 0 }, onclick: () => ovBox.classList.toggle('hidden') }, icon('edit', 18), 'Set exact amounts for some parts'), ovBox);
  sheet({ title: cur ? 'Change salary' : 'Set salary', body, actions: [{ label: 'Save', primary: true, onclick: async (close) => {
    if (!N(f.amount)) { amt.classList.add('err'); return false; }
    const r = await api('pay_save_salary', { p_emp: e.id, p: { eff_from: f.eff_from, structure_id: f.structure_id, amount: N(f.amount), ot_rate: N(f.ot_rate), overrides: f.overrides, reason: f.reason } });
    bust(); close(); toast(r.arrears ? 'Saved. The difference for months already paid will come as arrears in the next payroll.' : 'Salary saved'); route_();
  } }] });
  paint();
}
function bankSheet(e) {
  const b = e.bank || {};
  const f = { mode: b.mode || 'bank', holder: b.holder || e.name, bank_name: b.bank_name || '', account_no: b.account_no || '', confirm: b.account_no || '', ifsc: b.ifsc || '', upi: b.upi || '' };
  const box = h('div', { class: 'grid' });
  const paint = () => clear(box).append(
    f.mode === 'bank' ? [field('Name on the account', input({ value: f.holder, oninput: (ev) => { f.holder = ev.target.value; } })),
      field('Account number', input({ value: f.account_no, mode: 'numeric', oninput: (ev) => { f.account_no = ev.target.value; } })),
      field('Account number again', input({ value: f.confirm, mode: 'numeric', oninput: (ev) => { f.confirm = ev.target.value; } }), 'To catch typing mistakes'),
      h('div', { class: 'two' }, field('IFSC', input({ value: f.ifsc, placeholder: 'HDFC0001234', oninput: (ev) => { f.ifsc = ev.target.value.toUpperCase(); } })), field('Bank', input({ value: f.bank_name, oninput: (ev) => { f.bank_name = ev.target.value; } })))]
      : f.mode === 'upi' ? field('UPI ID', input({ value: f.upi, placeholder: 'name@bank', oninput: (ev) => { f.upi = ev.target.value.trim(); } }))
        : h('p', { class: 'muted' }, f.mode === 'cash' ? 'Salary is handed over in cash.' : 'Salary is paid by cheque.'));
  const body = h('div', { class: 'grid' }, field('Paid by', seg([['bank', 'Bank'], ['upi', 'UPI'], ['cash', 'Cash'], ['cheque', 'Cheque']], f.mode, (x) => { f.mode = x; paint(); }, { full: true, label: 'Paid by' })), box,
    h('p', { class: 'small muted' }, 'Every change is recorded. The old details stay in the history.'));
  paint();
  sheet({ title: 'Payout details', body, actions: [{ label: 'Save', primary: true, onclick: async (close) => {
    if (f.mode === 'bank' && f.account_no.replace(/\s/g, '') !== f.confirm.replace(/\s/g, '')) { toast('The two account numbers do not match', { err: true }); return false; }
    await api('pay_save_bank', { p_emp: e.id, p: { mode: f.mode, holder: f.holder, bank_name: f.bank_name, account_no: f.account_no.replace(/\s/g, ''), ifsc: f.ifsc, upi: f.upi } });
    close(); toast('Saved'); route_();
  } }] });
}
function exitSheet(e) {
  const f = { exit_kind: e.exit_kind || 'resigned', notice_on: e.notice_on || today(), last_day: e.last_day || addDays(today(), 30), reason: e.exit_reason || '' };
  const body = h('div', { class: 'grid' },
    field('Why are they leaving', selectEl([['resigned', 'Resigned'], ['terminated', 'Let go'], ['retired', 'Retired'], ['contract_end', 'Contract ended'], ['absconded', 'Stopped coming'], ['death', 'Passed away'], ['other', 'Other']], f.exit_kind, { onchange: (ev) => { f.exit_kind = ev.target.value; } })),
    h('div', { class: 'two' }, field('Told you on', dateInput(f.notice_on, { onchange: (ev) => { f.notice_on = ev.target.value; } })), field('Last working day', dateInput(f.last_day, { onchange: (ev) => { f.last_day = ev.target.value; } }))),
    field('Note', h('textarea', { class: 'textarea', placeholder: 'Optional', oninput: (ev) => { f.reason = ev.target.value; } }, f.reason)),
    h('p', { class: 'small muted' }, 'They stay on payroll until the last day. After that, settle their full and final pay: salary to the last day, leave encashment, gratuity if due, and anything they owe.'));
  sheet({ title: 'Leaving', body, actions: [{ label: 'Save', primary: true, onclick: async (close) => {
    await api('pay_set_status', { p_emp: e.id, p: { action: 'notice', ...f } }); bust(); close(); toast('Saved'); route_();
  } }] });
}
function rehireSheet(e) {
  const f = { joined_on: today() };
  sheet({ title: 'Rehire ' + e.name, body: h('div', { class: 'grid' }, field('Joins again on', dateInput(f.joined_on, { onchange: (ev) => { f.joined_on = ev.target.value; } })),
    h('p', { class: 'small muted' }, 'Their old payslips and history stay. Service for gratuity counts from the new date. Set their salary after.')),
  actions: [{ label: 'Rehire', primary: true, onclick: async (close) => { await api('pay_set_status', { p_emp: e.id, p: { action: 'rehire', joined_on: f.joined_on } }); bust(); close(); toast('Welcome back'); route_(); } }] });
}
function loginSheet(e) {
  const em = input({ type: 'email', value: (e.login && e.login.email) || e.email || '', placeholder: 'Their login email' });
  sheet({ title: 'App login', body: h('div', { class: 'grid' },
    e.login ? banner('ok', 'check', 'Linked to ', h('b', null, e.login.email), '. They can clock in, ask for leave and see payslips.') : h('p', { class: 'muted' }, 'With a login, ' + e.name + ' can clock in from their phone, ask for leave and see their own payslips. Nothing else.'),
    field('Login email', em, h('span', null, 'Create the login first on your account’s ', h('a', { href: 'https://auzslab.in/account.html#staff', target: '_blank', rel: 'noopener' }, 'Staff page'), ', then link it here.'))),
  actions: [e.login ? { label: 'Unlink', danger: true, onclick: async (close) => { await api('pay_link_login', { p_emp: e.id, p_email: null }); close(); toast('Unlinked'); route_(); } } : null,
    { label: 'Link', primary: true, onclick: async (close) => { await api('pay_link_login', { p_emp: e.id, p_email: em.value.trim() }); bust(); close(); toast('Linked'); route_(); } }] });
}
function pinSheet(e) {
  const a = input({ type: 'password', mode: 'numeric', max: 6, placeholder: '4 to 6 digits', auto: 'new-password' }), b = input({ type: 'password', mode: 'numeric', max: 6, placeholder: 'Same again', auto: 'new-password' });
  sheet({ title: 'Kiosk PIN', body: h('div', { class: 'grid' }, h('p', { class: 'muted' }, 'Used to clock in on a shared phone or tablet at work (More > Clock-in kiosk). ' + (e.kiosk_pin_set ? 'A PIN is set.' : 'No PIN yet.')),
    field('New PIN', a), field('Confirm', b)),
  actions: [e.kiosk_pin_set ? { label: 'Remove PIN', danger: true, onclick: async (close) => { await api('pay_set_kiosk_pin', { p_emp: e.id, p_pin: null }); close(); toast('PIN removed'); route_(); } } : null,
    { label: 'Save', primary: true, onclick: async (close) => { if (a.value !== b.value) { toast('The PINs do not match', { err: true }); return false; } await api('pay_set_kiosk_pin', { p_emp: e.id, p_pin: a.value }); close(); toast('PIN set'); route_(); } }] });
}
function docSheet(e) {
  const f = { doc_type: 'ID proof', name: '', see: true };
  const file = h('input', { type: 'file', class: 'input', accept: 'image/*,application/pdf', 'aria-label': 'File' });
  sheet({ title: 'Add a document', body: h('div', { class: 'grid' },
    field('Type', selectEl(['ID proof', 'Address proof', 'PAN card', 'Bank proof', 'Offer letter', 'Appointment letter', 'Resume', 'Certificate', 'Other'], f.doc_type, { onchange: (ev) => { f.doc_type = ev.target.value; } })),
    field('Name', input({ placeholder: 'Optional', oninput: (ev) => { f.name = ev.target.value; } })), field('File', file, 'Photo or PDF, up to 10 MB'),
    h('div', { class: 'list' }, toggleRow('They can see it in their app', f.see, (x) => { f.see = x; }))),
  actions: [{ label: 'Upload', primary: true, onclick: async (close) => {
    const fl = file.files[0]; if (!fl) { toast('Pick a file', { err: true }); return false; }
    const up = await uploadDoc(e.id, fl);
    await api('pay_add_document', { p: { employee_id: e.id, doc_type: f.doc_type, name: f.name || fl.name, path: up.path, content_type: up.contentType || fl.type, size: fl.size, employee_can_see: f.see } });
    close(); toast('Uploaded'); route_();
  } }] });
}
function assetSheet(e, a = {}) {
  const f = { id: a.id, employee_id: e.id, name: a.name || '', serial: a.serial || '', value: a.value || '', issued_on: a.issued_on || today(), returned_on: a.returned_on || '', note: a.note || '' };
  sheet({ title: a.id ? 'Company item' : 'Add a company item', body: h('div', { class: 'grid' },
    field('What', input({ value: f.name, placeholder: 'e.g. Uniform, keys, phone', oninput: (ev) => { f.name = ev.target.value; } })),
    h('div', { class: 'two' }, field('Serial or tag', input({ value: f.serial, oninput: (ev) => { f.serial = ev.target.value; } })), field('Value', input({ type: 'number', mode: 'decimal', value: f.value, oninput: (ev) => { f.value = ev.target.value; } }))),
    h('div', { class: 'two' }, field('Given on', dateInput(f.issued_on, { onchange: (ev) => { f.issued_on = ev.target.value; } })), field('Returned on', dateInput(f.returned_on, { onchange: (ev) => { f.returned_on = ev.target.value; } })))),
  actions: [{ label: 'Save', primary: true, onclick: async (close) => { await api('pay_save_asset', { p: f }); close(); toast('Saved'); route_(); } }] });
}

// ---------- bulk import ----------
const IMPORT_COLS = [['name', ['name', 'full name', 'employee name']], ['code', ['code', 'employee id', 'emp id', 'employee number']], ['phone', ['phone', 'mobile', 'mobile number']], ['email', ['email']],
  ['gender', ['gender', 'sex']], ['dob', ['dob', 'date of birth', 'birth date']], ['joined_on', ['joined', 'joining date', 'date of joining', 'doj', 'joined on']], ['department', ['department', 'dept']],
  ['designation', ['designation', 'job', 'job title', 'role']], ['location', ['location', 'branch', 'site']], ['salary', ['salary', 'monthly salary', 'gross', 'monthly gross']], ['structure', ['structure', 'salary structure']],
  ['pan', ['pan']], ['uan', ['uan']], ['esi_no', ['esi', 'esi number', 'esic']], ['bank_name', ['bank', 'bank name']], ['account_no', ['account', 'account number', 'account no']], ['ifsc', ['ifsc', 'ifsc code']], ['holder', ['account holder', 'name on account']]];
function importSheet() {
  const file = h('input', { type: 'file', class: 'input', accept: '.csv,.xlsx', 'aria-label': 'File' });
  const out = h('div', { class: 'grid' });
  let rows = null;
  const toDate = (v) => { v = String(v || '').trim(); if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v; const m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); if (m) return m[3] + '-' + pad(m[2]) + '-' + pad(m[1]); if (/^\d{5}$/.test(v)) { const d = new Date(Date.UTC(1899, 11, 30) + (+v) * 864e5); return d.toISOString().slice(0, 10); } return v; };
  file.onchange = async () => {
    clear(out); rows = null;
    try {
      const t = await readTable(file.files[0]); if (t.length < 2) throw new Error('The sheet has no rows under the header');
      const head = t[0].map((x) => String(x).trim().toLowerCase());
      const map = Object.fromEntries(IMPORT_COLS.map(([k, names]) => [k, head.findIndex((x) => names.includes(x))]));
      if (map.name < 0) throw new Error('No "Name" column found');
      rows = t.slice(1).map((r) => Object.fromEntries(Object.entries(map).filter(([, i]) => i >= 0).map(([k, i]) => [k, ['dob', 'joined_on'].includes(k) ? toDate(r[i]) : String(r[i] ?? '').trim()])));
      const res = await api('pay_import_check', { p_rows: rows, p_commit: false });
      out.append(res.errors.length ? banner('bad', 'alert', h('b', null, res.errors.length + ' row(s) need fixing. '), 'Nothing was imported.',
        h('ul', { style: { margin: '6px 0 0', paddingLeft: '18px' } }, res.errors.slice(0, 12).map((x) => h('li', null, 'Row ' + (x.row + 1) + (x.name ? ' (' + x.name + ')' : '') + ': ' + x.error))))
        : banner('ok', 'check', h('b', null, res.ok + ' people ready to import. '), 'Press Import to add them.'));
    } catch (er) { out.append(banner('bad', 'alert', er.message)); }
  };
  sheet({ title: 'Import people', wide: true, body: h('div', { class: 'grid' },
    h('p', { class: 'muted' }, 'Upload a CSV or Excel sheet with one person per row. Columns we understand: Name (needed), Code, Phone, Email, Gender, Date of birth, Joined, Department, Job, Location, Salary (monthly), PAN, UAN, Bank, Account number, IFSC.'),
    h('button', { class: 'btn sm', type: 'button', style: { justifySelf: 'start' }, onclick: () => exportCSV('people-template', ['Name', 'Code', 'Phone', 'Email', 'Gender', 'Date of birth', 'Joined', 'Department', 'Job', 'Location', 'Salary', 'PAN', 'UAN', 'Bank', 'Account number', 'IFSC'], [['Asha Verma', 'E101', '9800000000', '', 'female', '1995-04-12', today(), 'Kitchen', 'Cook', '', '18000', '', '', '', '', '']]) }, icon('download', 18), 'Download a template'),
    field('File', file), out),
  actions: [{ label: 'Import', primary: true, onclick: async (close) => {
    if (!rows) { toast('Pick a file first', { err: true }); return false; }
    const res = await api('pay_import_check', { p_rows: rows, p_commit: true });
    if (!res.committed) { toast('Fix the rows shown first', { err: true }); return false; }
    bust(); close(); toast(res.ok + ' people imported'); go('people');
  } }] });
}
