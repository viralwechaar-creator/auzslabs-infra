// AUZslab Payroll v2: every rule is checked through the real API (as the owner, a manager, a staff member, another
// business and nobody), the payroll invariants are checked after every money step (payslip = its lines, payroll = its
// payslips, paid = approved net, accounting liability = payroll liability), and the screens are driven on phone and desktop.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx, layoutIssues } from '../../lib/common.mjs';
import { rpc } from '../../lib/api.mjs';
import { q, PASSWORD, USERS } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('Payroll: people, time, pay, government rules, self-service and screens', 'Runs a real business through setup, attendance, leave, a monthly payroll, payments, arrears, advances, a full and final settlement and the accounting link, checking every invariant and every access rule, then opens every screen on phone and desktop.');
  const login = async (email) => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json()).access_token;
  const [owner, manager, staff, staff2, cafe, retail] = await Promise.all([USERS.payOwner, USERS.payManager, USERS.payStaff, USERS.payStaff2, USERS.cafeOwner, USERS.retailOwner].map(login));
  const call = async (tok, fn, args) => { const r = await rpc(stack, fn, args || {}, tok); return { ok: r.status === 200, status: r.status, data: r.data && r.data.data, error: r.data && r.data.error }; };
  const ok = async (tok, fn, args) => { const r = await call(tok, fn, args); assert(r.ok, `${fn}: ${r.status} ${r.error}`); return r.data; };
  const fails = async (tok, fn, args, re) => { const r = await call(tok, fn, args); assert(!r.ok, `${fn} should have been refused`); if (re) assert(re.test(r.error || ''), `${fn} refused with the wrong reason: ${r.error}`); return r; };
  const tid = (await q("select id from tenants where slug='testpay'"))[0].id;
  const integrity = async () => { const r = await ok(owner, 'pay_integrity_check'); const bad = r.checks.filter((c) => !c.ok); assert(r.ok, 'payroll out of line: ' + bad.map((c) => c.name + ' (' + c.detail + ')').join('; ')); return r; };
  const lines = async (item) => Object.fromEntries((await q('select code, sum(amount)::float8 a from pay_run_lines where item_id=$1 group by code', [item])).map((r) => [r.code, r.a]));
  const sumBy = (rows, k) => Math.round(rows.reduce((a, r) => a + Number(r[k] || 0), 0) * 100) / 100;

  // ---------- access ----------
  await s.check('Logged out: every payroll call is refused', async () => {
    for (const fn of ['pay_bootstrap', 'pay_list_employees', 'pay_me', 'pay_run_create']) { const r = await call(null, fn, { p: {} }); assert(r.status === 401, fn + ' status ' + r.status); }
  }, 'critical');
  await s.check('A business without Payroll in its plan is refused server-side', async () => { await fails(retail, 'pay_bootstrap', {}, /not (part|switched|enabled)|not allowed|payroll/i); await fails(retail, 'pay_list_employees', { p: {} }); }, 'critical');
  let ctx;
  await s.check('Owner opens Payroll: defaults (components, structures, leave types) are created once', async () => {
    ctx = await ok(owner, 'pay_bootstrap'); ctx = await ok(owner, 'pay_bootstrap');
    assert(ctx.hr && ctx.perms.pay_admin, 'owner is not HR');
    const codes = ctx.components.map((c) => c.code);
    for (const c of ['BASIC', 'HRA', 'SPECIAL', 'PF_EE', 'ESI_EE', 'PT', 'TDS', 'LOAN', 'ARREARS']) assert(codes.includes(c), 'missing component ' + c);
    assert(ctx.structures.filter((x) => x.name === 'Standard').length === 1, 'Standard structure created ' + ctx.structures.filter((x) => x.name === 'Standard').length + ' times');
    assert(ctx.leave_types.some((t) => t.code === 'PL'), 'no paid leave type');
  }, 'critical');
  await s.check('Settings: Maharashtra, PF + ESI + professional tax on, Sunday off; bad PAN is refused', async () => {
    await fails(owner, 'pay_save_org', { p: { pan: 'BADPAN' } }, /PAN/);
    const o = await ok(owner, 'pay_save_org', { p: { legal_name: 'Test Payroll Pvt Ltd', state_code: '27', pan: 'AAACP1234C', tan: 'MUMP12345A', attendance_mode: 'manual', weekly_off: [0], setup_done: true,
      settings: { pf: { enabled: true }, esi: { enabled: true }, pt: { enabled: true }, tds: { enabled: true } } } });
    assert(o.state_code === '27' && o.settings.pf.enabled === true && o.setup_done, JSON.stringify(o).slice(0, 200));
    await fails(manager, 'pay_save_org', { p: { legal_name: 'x' } }, /role/i);
  }, 'critical');

  // ---------- people ----------
  let ravi, sita, om, ctcId;
  await s.check('Add three people (monthly salary, a woman joining mid-month, yearly CTC)', async () => {
    ctcId = ctx.structures.find((x) => x.name === 'Annual CTC').id;
    ravi = await ok(owner, 'pay_save_employee', { p: { name: 'Ravi Kumar', gender: 'male', joined_on: '2026-08-01', dob: '1990-05-10', pan: 'ABCDE1234F', uan: '100000000001', designation: 'Cook', department: 'Kitchen',
      salary: { amount: 30000, ot_rate: 150 }, bank: { mode: 'bank', account_no: '123456789012', ifsc: 'HDFC0001234', bank_name: 'HDFC', holder: 'Ravi Kumar' } } });
    sita = await ok(owner, 'pay_save_employee', { p: { name: 'Sita Devi', gender: 'female', joined_on: '2026-09-10', designation: 'Server', department: 'Floor', salary: { amount: 18000 } } });
    om = await ok(owner, 'pay_save_employee', { p: { name: 'Om Prakash', gender: 'male', joined_on: '2026-01-01', pan: 'PQRSX9876L', designation: 'Manager', salary: { amount: 1200000, structure_id: ctcId } } });
    const list = await ok(owner, 'pay_list_employees', { p: {} });
    assert(list.length === 3 && list.every((e) => e.code), 'employees ' + JSON.stringify(list.map((e) => e.code)));
    assert(Number(list.find((e) => e.id === ravi).gross) === 30000, 'Ravi gross ' + list.find((e) => e.id === ravi).gross);
  }, 'critical');
  await s.check('Bad identity numbers are refused (PAN, IFSC)', async () => {
    await fails(owner, 'pay_save_employee', { p: { name: 'Bad Pan', joined_on: '2026-09-01', pan: '1234' } }, /PAN/);
    await fails(owner, 'pay_save_bank', { p_emp: sita, p: { mode: 'bank', account_no: '1234567890', ifsc: 'BAD' } }, /IFSC/);
  }, 'major');
  await s.check('Field security: a manager sees people but no salary, PAN or bank, and cannot change pay', async () => {
    const list = await ok(manager, 'pay_list_employees', { p: {} });
    assert(list.length === 3 && list.every((e) => e.salary == null && e.gross == null), 'manager sees salaries');
    const e = await ok(manager, 'pay_get_employee', { p_id: ravi });
    assert(e.pan === undefined && e.bank === undefined && e.salaries === undefined, 'manager sees pan/bank/salaries: ' + Object.keys(e).join(','));
    await fails(manager, 'pay_save_salary', { p_emp: ravi, p: { eff_from: '2026-10-01', amount: 99999 } }, /role/i);
    await fails(manager, 'pay_run_create', { p: { kind: 'regular', month: '2026-09' } }, /role/i);
    await fails(manager, 'pay_report', { p_kind: 'register', p: { month: '2026-09' } }, /salar/i);
    await ok(manager, 'pay_report', { p_kind: 'attendance', p: { month: '2026-09' } });
  }, 'critical');
  await s.check('Another business cannot see or touch these people', async () => {
    const list = await ok(cafe, 'pay_list_employees', { p: {} });
    assert(!list.some((e) => [ravi, sita, om].includes(e.id)), 'cafe sees testpay employees');
    await fails(cafe, 'pay_get_employee', { p_id: ravi }, /not found/i);
    await fails(cafe, 'pay_mark_attendance', { p_emp: ravi, p_date: '2026-09-15', p: { status: 'absent' } });
    const n = await q('select count(*)::int n from pay_employees where tenant_id <> $1 and id = any($2)', [tid, [ravi, sita, om]]); assert(n[0].n === 0, 'ids leaked');
  }, 'critical');
  await s.check('Staff login: linked to Sita, sees only her own record', async () => {
    await ok(owner, 'pay_link_login', { p_emp: sita, p_email: USERS.payStaff });
    await fails(owner, 'pay_link_login', { p_emp: ravi, p_email: USERS.payStaff }, /already|linked/i);
    const meD = await ok(staff, 'pay_me'); assert(meD.employee.id === sita && meD.employee.name === 'Sita Devi', 'pay_me ' + JSON.stringify(meD.employee));
    await fails(staff, 'pay_list_employees', { p: {} }); await fails(staff, 'pay_get_employee', { p_id: ravi }); await fails(staff, 'pay_run_create', { p: { kind: 'regular', month: '2026-09' } });
    await fails(staff2, 'pay_me', {}, /not linked/i);
  }, 'critical');

  // ---------- time and leave ----------
  await s.check('Attendance: absent and half day for Ravi; Sita’s day before joining cannot be marked', async () => {
    await ok(owner, 'pay_mark_attendance', { p_emp: ravi, p_date: '2026-09-15', p: { status: 'absent', reason: 'No show' } });
    await ok(owner, 'pay_mark_attendance', { p_emp: ravi, p_date: '2026-09-16', p: { status: 'half', reason: 'Left early' } });
    const m = await ok(owner, 'pay_attendance_month', { p_emp: ravi, p_month: '2026-09' });
    const d15 = m.days.find((x) => x.date === '2026-09-15'), d16 = m.days.find((x) => x.date === '2026-09-16'), sun = m.days.find((x) => x.date === '2026-09-13');
    assert(d15.status === 'absent' && Number(d15.lop) === 1 && d16.status === 'half' && Number(d16.lop) === 0.5 && sun.status === 'weekly_off', JSON.stringify([d15, d16, sun]));
    await fails(owner, 'pay_mark_attendance', { p_emp: sita, p_date: '2026-09-01', p: { status: 'absent' } }, /join|employed/i);
  }, 'critical');
  await s.check('Leave: Sita asks herself, the balance is checked, the owner approves, the ledger moves', async () => {
    await ok(owner, 'pay_leave_adjust', { p_emp: sita, p_type: ctx.leave_types.find((t) => t.code === 'PL').id, p_days: 3, p_note: 'Opening balance', p_opening: true });
    const pl = ctx.leave_types.find((t) => t.code === 'PL').id;
    const before = (await ok(staff, 'pay_me')).leave.find((l) => l.id === pl).balance;
    await fails(staff, 'pay_me_leave_apply', { p: { leave_type_id: pl, from: '2026-11-02', to: '2026-11-30' } }, /balance|enough|only/i);
    const req = await ok(staff, 'pay_me_leave_apply', { p: { leave_type_id: pl, from: '2026-11-03', to: '2026-11-03', reason: 'Family' } });
    const pending = await ok(owner, 'pay_list_requests', { p: {} }); assert(pending.some((x) => x.id === req.id), 'owner does not see the request');
    await ok(owner, 'pay_leave_decide', { p_id: req.id, p_approve: true });
    const after = (await ok(staff, 'pay_me')).leave.find((l) => l.id === pl).balance;
    assert(Number(after) === Number(before) - 1, 'balance ' + before + ' -> ' + after);
    const led = await q('select count(*)::int n from pay_leave_ledger where employee_id=$1', [sita]); assert(led[0].n >= 2, 'ledger rows ' + led[0].n);
    await fails(owner, 'pay_leave_decide', { p_id: req.id, p_approve: true }, /already|not waiting|pending/i);
  }, 'critical');
  await s.check('Kiosk: wrong PIN is refused and counted, right PIN clocks in', async () => {
    await ok(owner, 'pay_set_kiosk_pin', { p_emp: ravi, p_pin: '4321' });
    const bad = await ok(owner, 'pay_kiosk_punch', { p_emp: ravi, p_pin: '0000' }); assert(bad.ok === false, 'wrong PIN accepted');
    const good = await ok(owner, 'pay_kiosk_punch', { p_emp: ravi, p_pin: '4321' }); assert(good.ok && good.kind === 'in', JSON.stringify(good));
    const list = await ok(owner, 'pay_kiosk_list'); assert(list.find((e) => e.id === ravi).state.open === true, 'kiosk does not show Ravi as in');
    const pins = await q("select kiosk_pin from pay_employees where id=$1", [ravi]); assert(pins[0].kiosk_pin && pins[0].kiosk_pin !== '4321', 'PIN stored in plain text');
  }, 'critical');
  await s.check('Punches are append-only: they can be voided with a reason, never edited or deleted', async () => {
    const p = (await q('select id from pay_punches where employee_id=$1 limit 1', [ravi]))[0].id;
    let threw = false; try { await q('update pay_punches set at = now() where id=$1', [p]); } catch { threw = true; } assert(threw, 'punch time could be edited');
    threw = false; try { await q('delete from pay_punches where id=$1', [p]); } catch { threw = true; } assert(threw, 'punch could be deleted');
    await ok(owner, 'pay_void_punch', { p_id: p, p_reason: 'Test punch' });
  }, 'major');

  // ---------- September payroll ----------
  let sep, items;
  await s.check('September payroll: calculate, and every payslip equals its lines and the payroll equals its payslips', async () => {
    await ok(owner, 'pay_save_tax', { p_emp: om, p: { regime: 'old', items: {} } });
    sep = await ok(owner, 'pay_run_create', { p: { kind: 'regular', month: '2026-09' } });
    await fails(owner, 'pay_run_create', { p: { kind: 'regular', month: '2026-09' } }, /already/i);
    const r = await ok(owner, 'pay_run_calculate', { p_run: sep });
    const run = await ok(owner, 'pay_get_run', { p_id: sep }); items = run.items;
    assert(items.length === 3, 'items ' + items.length);
    for (const it of items) {
      const l = await q("select kind, sum(amount)::float8 a from pay_run_lines where item_id=$1 group by kind", [it.id]); const k = Object.fromEntries(l.map((x) => [x.kind, x.a]));
      assert(Math.abs((k.earning || 0) + (k.reimbursement || 0) - Number(it.gross)) < 0.01 && Math.abs((k.deduction || 0) - Number(it.deductions)) < 0.01, it.name + ' lines do not add up');
      assert(Math.abs(Number(it.gross) - Number(it.deductions) - Number(it.net)) < 0.01 && Number(it.net) >= 0, it.name + ' net is not gross - deductions');
    }
    assert(Math.abs(sumBy(items, 'net') - Number(run.net)) < 0.01 && Math.abs(sumBy(items, 'gross') - Number(run.gross)) < 0.01, 'payroll totals differ from payslips');
    assert(r && run.status === 'calculated', 'status ' + run.status);
    await integrity();
  }, 'critical');
  await s.check('September amounts follow the rules: unpaid days, PF ceiling, ESI eligibility, state tax, joining mid-month', async () => {
    const R = items.find((i) => i.employee_id === ravi), Si = items.find((i) => i.employee_id === sita), O = items.find((i) => i.employee_id === om);
    assert(Number(R.lop_days) === 1.5 && Number(R.paid_days) === 28.5, 'Ravi paid ' + R.paid_days + ' lop ' + R.lop_days);
    assert(Math.abs(Number(R.gross) - 28500) < 0.01, 'Ravi gross ' + R.gross + ' (30000 x 28.5/30)');
    const rl = await lines(R.id);
    assert(rl.PF_EE > 0 && rl.PF_EE <= Math.round(0.12 * 25000) && !rl.ESI_EE, 'Ravi PF ' + rl.PF_EE + ' ESI ' + rl.ESI_EE + ' (above the ESI ceiling)');
    assert(rl.PT === 200, 'Ravi professional tax ' + rl.PT + ' (Maharashtra, above ₹10,000)');
    assert(Number(Si.paid_days) === 21 && Math.abs(Number(Si.gross) - 12600) < 0.01, 'Sita paid days ' + Si.paid_days + ' gross ' + Si.gross + ' (joined 10 Sep: 21 of 30 days)');
    const sl = await lines(Si.id); assert(sl.ESI_EE > 0 && !sl.PT, 'Sita ESI ' + sl.ESI_EE + ', PT ' + sl.PT + ' (women under ₹25,000 are exempt in Maharashtra)');
    const ol = await lines(O.id); assert(ol.TDS > 0, 'Om TDS ' + ol.TDS + ' (old regime, ₹12 lakh CTC)');
    assert(ol.BASIC === 50000 && ol.HRA === 20000, 'Om CTC split basic ' + ol.BASIC + ' hra ' + ol.HRA);
  }, 'critical');
  await s.check('Approvals: a manager cannot approve; with the two-person rule the calculator cannot approve either', async () => {
    await fails(manager, 'pay_run_approve', { p_run: sep, p_note: null }, /role/i);
    await ok(owner, 'pay_save_org', { p: { settings: { access: { two_person: true } } } });
    await fails(owner, 'pay_run_approve', { p_run: sep, p_note: null }, /different|two|someone else|another/i);
    await ok(owner, 'pay_save_org', { p: { settings: { access: { two_person: false } } } });
    await ok(owner, 'pay_run_approve', { p_run: sep, p_note: 'Checked' });
  }, 'critical');
  await s.check('Accounting set up, then finalising posts a balanced journal and the books tie to payroll', async () => {
    await ok(owner, 'acc_bootstrap');
    const f = await ok(owner, 'pay_run_finalize', { p_run: sep });
    assert(['finalized', 'paid'].includes(f.status || (await ok(owner, 'pay_get_run', { p_id: sep })).status), 'not finalised');
    const j = await q("select acc_status, (select sum(debit)::float8 from pay_journal_lines l where l.journal_id = j.id) d, (select sum(credit)::float8 from pay_journal_lines l where l.journal_id = j.id) c from pay_journals j where source_type='run' and source_id=$1", [sep]);
    assert(j.length >= 1 && j.every((x) => Math.abs(x.d - x.c) < 0.01), 'journal does not balance: ' + JSON.stringify(j));
    assert(j.every((x) => x.acc_status === 'posted'), 'not posted to accounting: ' + JSON.stringify(j.map((x) => x.acc_status)));
    const acc = await ok(owner, 'acc_integrity_check'); assert(acc.ok, 'accounting books out of line: ' + acc.checks.filter((c) => !c.ok).map((c) => c.name).join('; '));
    await integrity();
  }, 'critical');
  await s.check('A finalised payroll is frozen: no recalculation, no attendance change, no edits to its lines', async () => {
    await fails(owner, 'pay_run_calculate', { p_run: sep }, /finalised|finalized|cannot|status/i);
    await fails(owner, 'pay_mark_attendance', { p_emp: ravi, p_date: '2026-09-15', p: { status: 'present' } }, /finalised|finalized|locked/i);
    let threw = false; try { await q("update pay_run_lines set amount = amount + 1 where run_id=$1", [sep]); } catch { threw = true; } assert(threw, 'payslip lines could be edited');
    threw = false; try { await q("update pay_run_items set net = net + 1 where run_id=$1", [sep]); } catch { threw = true; } assert(threw, 'payslip totals could be edited');
  }, 'critical');
  await s.check('Payslips: Sita sees her own, never Ravi’s', async () => {
    const mine = await ok(staff, 'pay_me_payslips'); assert(mine.length === 1 && Math.abs(Number(mine[0].net) - Number(items.find((i) => i.employee_id === sita).net)) < 0.01, 'payslips ' + JSON.stringify(mine));
    const slip = await ok(staff, 'pay_get_item', { p_id: mine[0].id }); assert(slip.lines && slip.lines.length, 'no lines on the payslip');
    await fails(staff, 'pay_get_item', { p_id: items.find((i) => i.employee_id === ravi).id }, /allow/i);
  }, 'critical');
  await s.check('Paying: bank batch for everyone, marked paid once; paid equals approved net; a second batch is refused', async () => {
    const b = await ok(owner, 'pay_batch_create', { p_run: sep, p: { mode: 'bank' } });
    await ok(owner, 'pay_batch_mark', { p_batch: b, p: { all: 'paid', ref: 'NEFT123' } });
    assert((await ok(owner, 'pay_get_run', { p_id: sep })).status !== 'paid', 'marked paid while people without a bank account are unpaid');
    await ok(owner, 'pay_batch_create', { p_run: sep, p: { mode: 'cash', mark_paid: true } });
    const run = await ok(owner, 'pay_get_run', { p_id: sep });
    const paid = (await q("select coalesce(sum(bl.amount),0)::float8 a from pay_batch_lines bl join pay_batches b on b.id = bl.batch_id where b.run_id=$1 and bl.status='paid'", [sep]))[0].a;
    assert(Math.abs(paid - Number(run.net)) < 0.01, 'paid ' + paid + ' vs net ' + run.net);
    assert(run.status === 'paid', 'status ' + run.status);
    const again = await call(owner, 'pay_batch_create', { p_run: sep, p: { mode: 'cash' } }); assert(!again.ok || !again.data, 'a second batch was created for already-paid people');
    await integrity();
  }, 'critical');

  // ---------- October: arrears, advance, claim, inputs ----------
  let oct;
  await s.check('Back-dated raise creates arrears; an advance is recovered; a claim is reimbursed; a one-time bonus is added', async () => {
    const sv = await ok(owner, 'pay_save_salary', { p_emp: ravi, p: { eff_from: '2026-09-01', amount: 33000, ot_rate: 150, reason: 'Increment' } });
    assert(sv.arrears, 'no arrears flag for a change inside a finalised month');
    await ok(owner, 'pay_save_loan', { p: { employee_id: sita, amount: 6000, emi: 2000, start_month: '2026-10', disbursed_via: 'cash' } });
    const cl = await ok(staff, 'pay_me_claim', { p: { amount: 500, category: 'Travel', description: 'Market run', date: '2026-10-01' } });
    await ok(owner, 'pay_claim_decide', { p_id: cl, p_approve: true, p: { amount: 450 } });
    oct = await ok(owner, 'pay_run_create', { p: { kind: 'regular', month: '2026-10' } });
    await ok(owner, 'pay_save_inputs', { p_run: oct, p_rows: [{ employee_id: om, kind: 'earning', code: 'INCENTIVE', amount: 5000, note: 'Festival sales' }] });
    await ok(owner, 'pay_run_calculate', { p_run: oct });
    const run = await ok(owner, 'pay_get_run', { p_id: oct });
    const R = await lines(run.items.find((i) => i.employee_id === ravi).id), Si = await lines(run.items.find((i) => i.employee_id === sita).id), O = await lines(run.items.find((i) => i.employee_id === om).id);
    assert(Math.abs((R.ARREARS || 0) - 3000 * 28.5 / 30) < 0.01, 'Ravi arrears ' + R.ARREARS + ' (3000 x 28.5/30)');
    assert(Si.LOAN === 2000, 'Sita advance recovery ' + Si.LOAN);
    assert(Object.entries(Si).some(([k, v]) => /REIMB|CLAIM/.test(k) && v === 450), 'Sita claim not reimbursed: ' + JSON.stringify(Si));
    assert(O.INCENTIVE === 5000, 'Om incentive ' + O.INCENTIVE);
    await integrity();
  }, 'critical');
  await s.check('Full and final: Ravi leaves on 20 Oct; settled once, and cannot be settled or paid twice', async () => {
    await ok(owner, 'pay_run_cancel', { p_run: oct, p_reason: 'Redo after settlement' });
    await ok(owner, 'pay_set_status', { p_emp: ravi, p: { action: 'notice', notice_on: '2026-10-01', last_day: '2026-10-20', exit_kind: 'resigned', reason: 'Moving city' } });
    const fnf = await ok(owner, 'pay_run_create', { p: { kind: 'fnf', employee_id: ravi } });
    await ok(owner, 'pay_run_calculate', { p_run: fnf });
    await ok(owner, 'pay_run_approve', { p_run: fnf, p_note: null }); await ok(owner, 'pay_run_finalize', { p_run: fnf });
    await fails(owner, 'pay_run_create', { p: { kind: 'fnf', employee_id: ravi } }, /settled|already/i);
    oct = await ok(owner, 'pay_run_create', { p: { kind: 'regular', month: '2026-10' } });
    await ok(owner, 'pay_run_calculate', { p_run: oct });
    const run = await ok(owner, 'pay_get_run', { p_id: oct });
    assert(!run.items.some((i) => i.employee_id === ravi), 'Ravi is paid again in the October payroll after his settlement');
    await integrity();
  }, 'critical');

  // ---------- reports, audit ----------
  await s.check('Every report opens for the owner and returns a table', async () => {
    for (const k of ['register', 'summary', 'pf', 'esi', 'pt', 'tds', 'bank', 'ctc', 'loans', 'liabilities', 'attendance', 'late', 'leave', 'headcount']) {
      const r = await ok(owner, 'pay_report', { p_kind: k, p: { month: '2026-09', from: '2026-09-01', to: '2026-10-31' } });
      assert(Array.isArray(r.head) && Array.isArray(r.rows), k + ' has no table');
    }
    const pf = await ok(owner, 'pay_report', { p_kind: 'pf', p: { month: '2026-09' } }); assert(pf.rows.length >= 2, 'PF ECR rows ' + pf.rows.length);
    const f16 = await ok(owner, 'pay_report', { p_kind: 'form16', p: { employee_id: om } }); assert(f16.rows.length >= 1, 'Form 16 working is empty');
  }, 'major');
  await s.check('Change history: salary and payroll actions are recorded and cannot be altered', async () => {
    const a = await ok(owner, 'pay_list_audit', { p: {} });
    assert(a.some((x) => x.entity === 'salary') && a.some((x) => x.entity === 'run'), 'missing audit entries: ' + [...new Set(a.map((x) => x.entity))].join(','));
    let threw = false; try { await q('delete from pay_audit where tenant_id=$1', [tid]); } catch { threw = true; } assert(threw, 'audit rows could be deleted');
    await fails(manager, 'pay_list_audit', { p: {} }, /role/i);
  }, 'critical');
  await s.check('Console summary works for the owner and hides pay from a manager', async () => {
    const o = await ok(owner, 'pay_console_summary'); assert(o.employees >= 2 && o.last_run, JSON.stringify(o).slice(0, 120));
    const m = await ok(manager, 'pay_console_summary'); assert(m.last_run == null, 'manager sees payroll totals');
  }, 'major');

  // ---------- screens ----------
  const open = async (email, dev) => {
    const c = await newCtx(browser, stack, dev); const page = await c.newPage(); const errs = watch(page);
    await page.goto(stack.url('testpay', '/payroll.html')); await page.waitForSelector('input[type=password]', { timeout: 20000 });
    await page.fill('input[type=email]', email); await page.fill('input[type=password]', PASSWORD);
    await page.locator('button', { hasText: /sign in/i }).last().click(); await page.waitForSelector('.shell', { timeout: 20000 }); await page.waitForTimeout(800);
    return { c, page, errs };
  };
  const pageOk = async (page, errs, hash, label, mobile) => {
    const before = errs.length;
    await page.evaluate((x) => { location.hash = x; }, hash); await page.waitForTimeout(900);
    const body = await page.locator('#main').innerText();
    const out = [];
    if (/Could not load this page/.test(body)) out.push(label + ': ' + body.split('\n').slice(0, 3).join(' '));
    if (/undefined|NaN|\[object/.test(body)) out.push(label + ': shows undefined/NaN');
    if (errs.length > before) out.push(label + ': ' + errs[errs.length - 1].slice(0, 120));
    if (mobile) { const li = await layoutIssues(page); if (li.length) out.push(label + ': ' + li[0]); }
    return out;
  };
  const runId = sep;
  const HR_PAGES = [['#/home', 'Home'], ['#/people', 'People'], ['#/person/' + sita, 'Person'], ['#/person/' + sita + '?tab=pay', 'Person pay'], ['#/person/' + sita + '?tab=time', 'Person time'], ['#/person/' + sita + '?tab=leave', 'Person leave'],
    ['#/person/' + sita + '?tab=files', 'Person files'], ['#/person/' + sita + '?tab=history', 'Person history'], ['#/time', 'Time'], ['#/time?v=month', 'Time month'], ['#/time?v=shifts', 'Shifts'], ['#/leave', 'Leave'], ['#/pay', 'Payroll'],
    ['#/run/' + runId, 'Run'], ['#/payslip/' + items[0].id, 'Payslip'], ['#/loans', 'Loans'], ['#/claims', 'Claims'], ['#/compliance', 'Compliance'], ['#/reports', 'Reports'], ['#/report/register?month=2026-09', 'Register'],
    ['#/report/pf?month=2026-09', 'PF report'], ['#/report/attendance', 'Attendance report'], ['#/report/form16?emp=' + om, 'Form 16'], ['#/settings', 'Settings'],
    ...['company', 'locations', 'lists', 'pay', 'statutory', 'accounting', 'time', 'leave', 'access', 'notices', 'import', 'audit', 'health'].map((k) => ['#/settings/' + k, 'Settings ' + k]), ['#/kiosk', 'Kiosk']];
  for (const dev of [{ name: 'phone', w: 390, h: 844, mobile: true }, { name: 'desktop', w: 1366, h: 860 }]) {
    await s.check(`Owner (${dev.name}): every screen opens with no errors, no blanks and no sideways scroll`, async () => {
      const { c, page, errs } = await open(USERS.payOwner, dev); const bad = [];
      for (const [hash, label] of HR_PAGES) bad.push(...(await pageOk(page, errs, hash, label, dev.mobile)));
      await s.shot(page, 'Payroll owner ' + dev.name);
      assert(!bad.length, bad.slice(0, 5).join(' | '));
      await c.close();
    }, 'major');
    await s.check(`Staff (${dev.name}): self-service screens open; HR screens are not reachable`, async () => {
      const { c, page, errs } = await open(USERS.payStaff, dev); const bad = [];
      for (const [hash, label] of [['#/today', 'Today'], ['#/my-time', 'My time'], ['#/my-leave', 'My leave'], ['#/my-pay', 'My pay'], ['#/my-profile', 'Profile']]) bad.push(...(await pageOk(page, errs, hash, label, dev.mobile)));
      await page.evaluate(() => { location.hash = '#/people'; }); await page.waitForTimeout(800);
      const t = await page.locator('#tb-t').innerText(); if (t === 'People') bad.push('staff reached the People page');
      await s.shot(page, 'Payroll staff ' + dev.name);
      assert(!bad.length, bad.slice(0, 5).join(' | '));
      await c.close();
    }, 'major');
  }
  await s.check('Phone: a new person can be added in one short form, and appears in the list', async () => {
    const { c, page } = await open(USERS.payOwner, { w: 390, h: 844, mobile: true });
    await page.evaluate(() => { location.hash = '#/people'; }); await page.waitForTimeout(800);
    await page.evaluate(() => addPersonSheet()); await page.waitForSelector('.sheet');
    const inputs = page.locator('.sheet input:not([type=date]):not([type=checkbox])');
    await inputs.nth(0).fill('Asha Verma');
    await page.locator('.sheet input[inputmode=decimal], .sheet input[type=number]').first().fill('15000');
    await page.locator('.sheet .sheet-f .btn.fill').last().click(); await page.waitForTimeout(1500);
    const all = await ok(owner, 'pay_list_employees', { p: {} }); assert(all.some((e) => e.name === 'Asha Verma' && Number(e.gross) === 15000), 'not saved: ' + all.map((e) => e.name + ':' + e.gross).join(', '));
    await c.close();
  }, 'major');
  await s.check('Phone: staff clocks in with the big button', async () => {
    await ok(owner, 'pay_save_org', { p: { attendance_mode: 'punch' } });
    const { c, page } = await open(USERS.payStaff, { w: 390, h: 844, mobile: true });
    await page.evaluate(() => { location.hash = '#/today'; }); await page.waitForSelector('.punch', { timeout: 10000 });
    await page.locator('.punch').click(); await page.waitForTimeout(1500);
    const st = await ok(staff, 'pay_me'); assert(st.punch.open === true, 'not clocked in after tapping');
    await c.close();
    await ok(owner, 'pay_save_org', { p: { attendance_mode: 'manual' } });
  }, 'major');
  await s.check('Integrity holds at the end of the run', integrity, 'critical');
  s.done();
}
