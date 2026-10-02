/* AUZslab Payroll: Pay. Payroll runs (check -> approve -> finalise -> pay), payslips, one-time amounts, payments and the
   bank file, advances and loans, expense claims, government dues, and income-tax declarations. */
'use strict';
const KIND = { regular: 'Monthly salary', offcycle: 'Extra payment', bonus: 'Statutory bonus', fnf: 'Full and final', legacy: 'Old Payroll' };
page('pay', {
  title: 'Payroll', icon: 'wallet', tabLabel: 'Pay', perm: canPay,
  async render(v) {
    const runs = await api('pay_list_runs', { p: {} });
    v.header({ title: 'Payroll', actions: [can('pay_run') && { label: 'New payroll', icon: 'plus', primary: true, run: () => newRunSheet(runs) }] });
    const open = runs.filter((r) => !['paid', 'locked'].includes(r.status) && r.kind !== 'legacy');
    const done = runs.filter((r) => ['paid', 'locked'].includes(r.status) || r.kind === 'legacy');
    if (!runs.length) {
      v.root.append(empty('wallet', 'No payroll yet', 'Pick a month. Payroll works out everyone’s pay from their salary, days worked, leave, overtime and advances, and you check it before anything is final.',
        can('pay_run') ? h('button', { class: 'btn fill', onclick: () => newRunSheet(runs) }, 'Run a payroll') : null));
      return;
    }
    if (open.length) v.root.append(section('In progress', h('div', { class: 'list' }, open.map((r) => runRow(r)))));
    const byYear = {};
    done.forEach((r) => { (byYear[r.month.slice(0, 4)] = byYear[r.month.slice(0, 4)] || []).push(r); });
    Object.keys(byYear).sort().reverse().forEach((y) => v.root.append(section(y, h('div', { class: 'list' }, byYear[y].map((r) => runRow(r))))));
  },
});
function runRow(r) {
  return liRow({ icon: r.kind === 'fnf' ? 'door' : r.kind === 'bonus' ? 'gift' : r.kind === 'legacy' ? 'book' : 'wallet', tone: ['paid', 'locked'].includes(r.status) ? 'gray' : '',
    title: r.title, sub: r.employees + ' people · ' + (r.kind === 'regular' ? monthName(r.month) : KIND[r.kind]) + (r.warning_count ? ' · ' + r.warning_count + ' to check' : ''),
    value: inr(r.net, 0), badge: r.kind === 'legacy' ? badge('Old Payroll') : runBadge(r.status), onclick: () => go('run/' + r.id) });
}
function newRunSheet(runs) {
  const have = new Set((runs || []).filter((r) => r.kind === 'regular' && r.status !== 'cancelled').map((r) => r.month));
  let m = monthOf(today()); if (have.has(m)) m = monthAdd(m, 1); else if (!have.has(monthAdd(m, -1)) && +today().slice(8) <= 20) m = monthAdd(m, -1);
  let kind = 'regular';
  const box = h('div', { class: 'grid' });
  const f = { month: m, title: '', pct: '8.33', fy_start: '', employee_id: '', employees: [] };
  const paint = async () => {
    clear(box);
    if (kind === 'regular') box.append(field('Month', input({ type: 'month', value: f.month, onchange: (e) => { f.month = e.target.value; } }), have.has(f.month) ? 'Already exists: you will be taken to it' : null));
    if (kind === 'offcycle') {
      const ppl = (await people()).filter((e) => e.status !== 'exited');
      box.append(field('What for', input({ placeholder: 'e.g. Diwali bonus, sales incentive', oninput: (e) => { f.title = e.target.value; } })), field('Month it belongs to', input({ type: 'month', value: f.month, onchange: (e) => { f.month = e.target.value; } })),
        h('p', { class: 'small muted' }, 'Next you add the amounts for each person. Tax is deducted on the extra pay if it is due.'));
    }
    if (kind === 'bonus') {
      const fy = (+today().slice(5, 7) >= (org().fy_start_month || 4) ? +today().slice(0, 4) - 1 : +today().slice(0, 4) - 2);
      f.fy_start = fy + '-' + pad(org().fy_start_month || 4) + '-01';
      box.append(field('Financial year', selectEl([fy, fy - 1, fy + 1].map((y) => [y + '-' + pad(org().fy_start_month || 4) + '-01', y + '-' + String(y + 1).slice(2)]), f.fy_start, { onchange: (e) => { f.fy_start = e.target.value; } })),
        field('Bonus percent', input({ type: 'number', mode: 'decimal', value: f.pct, oninput: (e) => { f.pct = e.target.value; } }), 'Between 8.33% and 20% under the Payment of Bonus Act'),
        field('Pay in', input({ type: 'month', value: f.month, onchange: (e) => { f.month = e.target.value; } })),
        h('p', { class: 'small muted' }, 'Worked out from that year’s finalised payrolls for people earning up to ₹21,000 a month in basic pay.'));
    }
    if (kind === 'fnf') {
      const leaving = (await people()).filter((e) => ['notice', 'exited'].includes(e.status) && !e.fnf_done && e.last_day);
      box.append(leaving.length ? field('Who', selectEl([['', 'Pick'], ...leaving.map((e) => [e.id, e.name + ' (last day ' + fmtD(e.last_day, { noYear: true }) + ')'])], f.employee_id, { onchange: (e) => { f.employee_id = e.target.value; } }))
        : h('p', { class: 'muted' }, 'No one is leaving. Record a resignation on their profile first.'));
    }
  };
  const body = h('div', { class: 'grid' }, optionCards([['regular', 'wallet', 'Monthly salary', 'Everyone’s pay for a month'], ['offcycle', 'gift', 'Extra payment', 'A bonus, incentive or correction outside the monthly salary'],
    ['bonus', 'star', 'Statutory bonus', 'The yearly bonus under the Payment of Bonus Act'], ['fnf', 'door', 'Full and final', 'Final settlement for someone leaving']], kind, (x) => { kind = x; paint(); }), box);
  paint();
  sheet({ title: 'New payroll', body, actions: [{ label: 'Continue', primary: true, onclick: async (close) => {
    if (kind === 'regular' && have.has(f.month)) { close(); go('run/' + runs.find((r) => r.kind === 'regular' && r.month === f.month && r.status !== 'cancelled').id); return; }
    if (kind === 'fnf' && !f.employee_id) { toast('Pick who is leaving', { err: true }); return false; }
    const p = { kind, month: f.month, title: f.title || undefined };
    if (kind === 'bonus') p.params = { pct: N(f.pct), fy_start: f.fy_start };
    if (kind === 'fnf') p.employee_id = f.employee_id;
    const id = await api('pay_run_create', { p });
    if (kind !== 'offcycle') await api('pay_run_calculate', { p_run: id });
    close(); go('run/' + id);
    if (kind === 'offcycle') setTimeout(() => inputSheet({ id, kind }), 300);
  } }] });
}

// ---------- one payroll ----------
page('run', {
  title: 'Payroll', icon: 'wallet', navAs: 'pay', nav: false, perm: canPay,
  async render(v) {
    const r = await api('pay_get_run', { p_id: v.args[0] });
    // "month not over" is said once for the whole payroll (banner), not as a warning on every person
    (r.items || []).forEach((i) => { i.warnings = (i.warnings || []).filter((w) => w.code !== 'projected'); });
    const st = r.status, legacy = r.kind === 'legacy';
    const stepIdx = { draft: 0, calculated: 0, review: 1, approved: 2, finalized: 3, paid: 4, locked: 4, cancelled: 0 }[st];
    const reqReview = !!oset('access', 'require_review', false);
    const regHead = () => api('pay_report', { p_kind: 'register', p: { run_id: r.id } });
    v.header({ title: r.title, back: 'pay', actions: [
      ['finalized', 'paid', 'locked'].includes(st) && { label: 'Payslips', icon: 'doc', run: () => allSlipsSheet(r) },
      { label: 'Salary register', icon: 'download', run: async (b) => { try { const g = await regHead(); exportMenu(b, (r.number || 'payroll').replace(/\//g, '-'), g.head, g.rows); } catch (e) { fail(e); } } },
      ['draft', 'calculated', 'review', 'approved'].includes(st) && can('pay_run') && { label: 'Cancel this payroll', icon: 'x', danger: true, run: async () => { const why = await askText('Cancel ' + r.title + '?', 'Nothing is paid. Say why.', 'Reason'); if (!why) return; try { await api('pay_run_cancel', { p_run: r.id, p_reason: why }); toast('Cancelled'); go('pay'); } catch (e) { fail(e); } } },
      st === 'paid' && can('pay_approve') && { label: 'Close (lock)', icon: 'lock', run: async () => { if (await confirmBox('Close this payroll?', 'Nothing more can be paid from it.', 'Close')) { try { await api('pay_run_lock', { p_run: r.id }); route_(); } catch (e) { fail(e); } } } },
    ] });
    const root = v.root;
    if (st === 'cancelled') root.append(banner('bad', 'x', 'Cancelled: ' + (r.cancel_reason || '')));
    if (legacy) root.append(banner('info', 'book', 'Moved from the old Payroll. Kept as history: it counts towards the year’s tax and bonus.'));
    if (!legacy && st !== 'cancelled') root.append(h('div', { class: 'card' }, stepper(['Check', 'Approve', 'Finalise', 'Pay'], stepIdx)));
    root.append(h('div', { class: 'row wrap', style: { gap: '8px' } }, runBadge(st), h('span', { class: 'muted small' }, KIND[r.kind] + ' · ' + fmtD(r.period_from, { noYear: true }) + ' to ' + fmtD(r.period_to) + ' · paid on ' + fmtD(r.pay_date) + ' · ' + r.number)));
    const prev = r.prev;
    root.append(h('div', { class: 'kpis k5' }, kpi('People', r.employees, r.held ? r.held + ' on hold' : null), kpi('Gross pay', inr(r.gross, 0)), kpi('Deductions', inr(r.deductions, 0)),
      kpi('Net pay', inr(r.net, 0), prev && r.kind === 'regular' && +prev.net ? (r.net >= prev.net ? '+' : '') + inr(r.net - prev.net, 0) + ' on ' + monthName(prev.month, { short: true, noYear: true }) : null),
      kpi('Employer cost', inr(r.employer, 0), 'PF, ESI on top')));
    if (st !== 'cancelled' && !legacy) {
      if (['draft', 'calculated'].includes(st) && r.period_to > today()) root.append(banner('info', 'info', 'The month is not over: days still to come are counted as worked. Changes after you finalise go into next month’s payroll.'));
      const warn = (r.items || []).filter((i) => (i.warnings || []).length);
      if (warn.length && ['draft', 'calculated', 'review', 'approved'].includes(st)) root.append(warningsCard(warn, r));
    }
    if (r.acc_status === 'failed') root.append(banner('bad', 'alert', 'Not posted to Accounting: ' + (r.acc_error || ''), can('pay_approve') ? [' ', h('a', { href: '#', onclick: async (e) => { e.preventDefault(); try { const x = await api('pay_acc_post_run', { p_run: r.id }); toast(x.failed ? 'Still failing: ' + (x.error || '') : 'Posted to Accounting', { err: !!x.failed }); route_(); } catch (er) { fail(er); } } }, 'Try again')] : null));
    else if (r.acc_status === 'posted') root.append(h('div', { class: 'small muted row', style: { gap: '6px' } }, icon('check', 16), 'Posted to Accounting'));
    // people
    const items = r.items || [];
    root.append(section(h('div', { class: 'row sp' }, h('h3', null, 'People'), ['draft', 'calculated'].includes(st) && can('pay_run') ? h('button', { class: 'btn sm', type: 'button', onclick: () => inputSheet(r) }, icon('plus', 18), 'Add one-time amount') : null),
      items.length ? dataView([
        { key: 'name', label: 'Name', title: true, avatar: (i) => i.name, render: (i) => isDesk() ? h('div', { class: 'row', style: { gap: '10px' } }, avatar(i.name, 30), h('div', null, h('div', { class: 't' }, i.name), h('div', { class: 's' }, i.designation || i.code || ''))) : i.name },
        { key: 'paid_days', label: 'Days paid', sub: true, sortVal: (i) => +i.paid_days, render: (i) => i.paid_days != null ? qty(i.paid_days) + (i.divisor ? ' of ' + qty(i.divisor) : '') + (isDesk() ? '' : ' days') + (!isDesk() && i.status === 'hold' ? ' · on hold' : '') + (!isDesk() && (i.warnings || []).length ? ' · check' : '') : KIND[r.kind] },
        { key: 'gross', label: 'Gross', r: true, sortVal: (i) => +i.gross, render: (i) => inr(i.gross) },
        { key: 'deductions', label: 'Deductions', r: true, sortVal: (i) => +i.deductions, render: (i) => inr(i.deductions) },
        { key: 'net', label: 'Net pay', r: true, value: true, sortVal: (i) => +i.net, render: (i) => h('span', null, inr(i.net), isDesk() && i.prev_net != null && r.kind === 'regular' && Math.abs(i.net - i.prev_net) >= 1 ? h('span', { class: 'small ' + (i.net > i.prev_net ? 'up' : 'down'), style: { marginLeft: '6px' } }, (i.net > i.prev_net ? '+' : '') + compact(i.net - i.prev_net)) : null) },
        { key: 'status', label: '', badge: true, sort: false, render: (i) => i.status === 'hold' ? badge('On hold', 'orange') : +i.paid >= +i.net && +i.net > 0 ? badge('Paid', 'green') : +i.pending ? badge('Being paid', 'blue') : (i.warnings || []).length && isDesk() ? badge('Check', 'orange') : null },
      ], items, { onRow: (i) => itemSheet(i.id, r), sortKey: 'name', footer: { name: 'Total', gross: inr(r.gross), deductions: inr(r.deductions), net: inr(r.net) } }) : empty('users', 'No one in this payroll', r.kind === 'offcycle' ? 'Add the amounts to pay.' : 'No one was employed in this period.')));
    if ((r.inputs || []).length) root.append(section('One-time amounts', h('div', { class: 'list' }, r.inputs.map((x) => liRow({ icon: x.kind === 'deduction' ? 'minus' : x.kind === 'earning' ? 'plus' : 'clock', tone: 'gray',
      title: x.name_emp + ': ' + (x.name || { earning: 'Extra pay', deduction: 'Deduction', lop_days: 'Unpaid days', ot_hours: 'Overtime hours', tds: 'Income tax set to' }[x.kind] || x.kind),
      sub: x.note || x.code || '', value: ['lop_days', 'ot_hours'].includes(x.kind) ? qty(x.amount) + (x.kind === 'lop_days' ? ' days' : ' h') : inr(x.amount),
      right: ['draft', 'calculated'].includes(st) && can('pay_run') ? h('button', { class: 'btn sm plain', type: 'button', 'aria-label': 'Remove', onclick: async () => { try { await api('pay_save_inputs', { p_run: r.id, p_rows: [{ id: x.id, delete: true }] }); await api('pay_run_calculate', { p_run: r.id }); route_(); } catch (e) { fail(e); } } }, icon('trash', 18)) : null })))));
    if ((r.batches || []).length) root.append(section('Payments', h('div', { class: 'list' }, r.batches.map((b) => liRow({ icon: b.mode === 'bank' ? 'bank' : 'cash', tone: b.status === 'paid' ? 'green' : b.status === 'cancelled' ? 'gray' : 'orange',
      title: b.number + ' · ' + { bank: 'Bank transfer', cash: 'Cash', upi: 'UPI', cheque: 'Cheque' }[b.mode], sub: b.lines + ' people' + (+b.failed ? ' · ' + inr(b.failed) + ' failed' : ''), value: inr(b.total), badge: badge(cap1(b.status === 'open' ? 'waiting' : b.status), b.status === 'paid' ? 'green' : b.status === 'cancelled' ? '' : 'orange'),
      onclick: () => batchSheet(b.id, r) })))));
    if ((r.audit || []).length) root.append(section('Who did what', h('div', { class: 'card' }, h('div', { class: 'timeline' }, r.audit.map((x) => h('div', { class: 'ev' }, h('i'), h('div', null, h('div', { class: 't' }, cap1(x.action.replace('_', ' ')) + (x.reason ? ': ' + x.reason : '')), h('div', { class: 's' }, (x.by || 'System') + ' · ' + fmtDT(x.at)))))))));
    // the next step
    const dock = h('div', { class: 'dock' });
    const act = (label, fn, o = {}) => h('button', { class: 'btn ' + (o.primary ? 'fill' : ''), type: 'button', onclick: async (e) => { const b = e.currentTarget; b.disabled = true; try { await fn(); } catch (er) { fail(er); } b.disabled = false; } }, o.spin ? null : null, label);
    const recalc = () => act('Calculate again', async () => { await api('pay_run_calculate', { p_run: r.id }); toast('Calculated'); route_(); });
    if (st === 'draft' && can('pay_run')) dock.append(act('Calculate', async () => { await api('pay_run_calculate', { p_run: r.id }); route_(); }, { primary: true }));
    if (st === 'calculated') {
      if (can('pay_run')) dock.append(recalc());
      if (reqReview || !can('pay_approve')) { if (can('pay_run')) dock.append(act('Send for approval', async () => { await api('pay_run_submit', { p_run: r.id }); toast('Sent for approval'); route_(); }, { primary: true })); }
      else dock.append(act('Approve and finalise', () => finaliseFlow(r, true), { primary: true }));
    }
    if (st === 'review') {
      if (can('pay_run') || can('pay_approve')) dock.append(act('Send back', async () => { const why = await askText('Send back', 'Say what needs changing.', 'Reason'); if (why === null) return; await api('pay_run_send_back', { p_run: r.id, p_reason: why }); route_(); }));
      if (can('pay_approve')) dock.append(act('Approve', async () => { await api('pay_run_approve', { p_run: r.id, p_note: null }); toast('Approved'); route_(); }, { primary: true }));
    }
    if (st === 'approved') {
      if (can('pay_run') || can('pay_approve')) dock.append(act('Send back', async () => { const why = await askText('Send back', 'Say what needs changing.', 'Reason'); if (why === null) return; await api('pay_run_send_back', { p_run: r.id, p_reason: why }); route_(); }));
      if (can('pay_approve')) dock.append(act('Finalise', () => finaliseFlow(r, false), { primary: true }));
    }
    if (st === 'finalized' && can('pay_pay')) dock.append(act(+r.paid ? 'Pay the rest' : 'Pay salaries', () => paySheet(r), { primary: true }));
    if (['paid', 'locked'].includes(st) && !legacy) dock.append(act('Payslips', () => allSlipsSheet(r), { primary: true }));
    if (dock.childNodes.length) root.append(dock);
  },
});
function warningsCard(warn, r) {
  const fixes = { no_salary: ['Set salary', (i) => go('person/' + i.employee_id + '?tab=pay')], no_bank: ['Add bank details', (i) => go('person/' + i.employee_id + '?tab=pay')], missing_out: ['See days', (i) => go('person/' + i.employee_id + '?tab=time')],
    no_uan: ['Add UAN', (i) => go('person/' + i.employee_id)], no_pan: ['Add PAN', (i) => go('person/' + i.employee_id)], ot_no_rate: ['Set overtime rate', (i) => go('person/' + i.employee_id + '?tab=pay')] };
  const list = h('div', { class: 'list hidden' }, warn.map((i) => h('div', { class: 'req' }, h('div', { class: 'top' }, avatar(i.name, 30), h('b', { class: 'grow' }, i.name)),
    (i.warnings || []).map((w) => h('div', { class: 'row sp' }, h('span', { class: 'small' }, w.text), fixes[w.code] && r.status !== 'finalized' ? h('button', { class: 'btn sm', type: 'button', onclick: () => fixes[w.code][1](i) }, fixes[w.code][0]) : null)))));
  const tg = h('button', { class: 'btn sm plain', type: 'button', onclick: () => { list.classList.toggle('hidden'); tg.textContent = list.classList.contains('hidden') ? 'Show' : 'Hide'; } }, 'Show');
  return h('div', { class: 'grid', style: { gap: '8px' } }, banner('', 'alert', h('div', { class: 'row sp' }, h('span', null, h('b', null, warn.length + (warn.length > 1 ? ' people' : ' person') + ' to check. '), 'You can still go ahead.'), tg)), list);
}
async function finaliseFlow(r, approveToo) {
  const early = r.period_to > today();
  const ok = await alertBox({ title: (approveToo ? 'Approve and finalise ' : 'Finalise ') + r.title + '?', message: 'Net pay ' + inr(r.net) + ' for ' + r.employees + ' people. After this the pay is frozen: payslips are issued, advances are recovered and mistakes are corrected in the next payroll.' + (early ? ' The month is not over yet, so the days ahead are counted as worked.' : ''),
    actions: [{ label: 'Finalise', value: true, role: 'def' }, { label: 'Cancel', value: false }] });
  if (!ok) return;
  if (approveToo) await api('pay_run_approve', { p_run: r.id, p_note: null });
  const res = await api('pay_run_finalize', { p_run: r.id });
  toast(res.status === 'paid' ? 'Finalised' : 'Finalised. Now pay the salaries.');
  route_();
}

// one person's payslip in a run: lines, explanations, and what can still be changed
async function itemSheet(itemId, r) {
  const d = await api('pay_get_item', { p_id: itemId });
  const it = d.item, editable = ['draft', 'calculated'].includes(r.status) && can('pay_run');
  const body = h('div', { class: 'grid' }, slipView(d, { compact: true }),
    editable || (r.status === 'finalized' && can('pay_pay')) ? h('div', { class: 'inline-actions' },
      editable ? h('button', { class: 'btn sm', type: 'button', onclick: () => { s.close(); inputSheet(r, it.employee_id); } }, icon('plus', 18), 'Add one-time amount') : null,
      h('button', { class: 'btn sm', type: 'button', onclick: async () => {
        try {
          if (it.status === 'hold') await api('pay_item_hold', { p_item: it.id, p_hold: false, p_reason: null });
          else { const why = await askText('Hold this salary?', 'It stays in the payroll but is not paid until you release it.', 'Reason'); if (!why) return; await api('pay_item_hold', { p_item: it.id, p_hold: true, p_reason: why }); }
          s.close(); route_();
        } catch (e) { fail(e); }
      } }, icon(it.status === 'hold' ? 'undo' : 'lock', 18), it.status === 'hold' ? 'Release' : 'Hold salary'),
      h('button', { class: 'btn sm', type: 'button', onclick: () => { s.close(); go('person/' + it.employee_id); } }, icon('user', 18), 'Profile')) : null);
  const s = sheet({ title: it.snap.name, closeLabel: 'Done', body, wide: true, noFocus: true,
    headerAction: ['finalized', 'paid', 'locked'].includes(r.status) ? { label: 'Print', onclick: () => printSlips([d]) } : null });
}
// a payslip, on screen: d = {item, run, lines, org, ytd, leave}
function slipView(d, o = {}) {
  const it = d.item, run = d.run, att = it.att || {};
  const lines = d.lines || [];
  const earn = lines.filter((l) => l.kind === 'earning' || l.kind === 'reimbursement'), ded = lines.filter((l) => l.kind === 'deduction'), emp = lines.filter((l) => l.kind === 'employer');
  const tbl = (rows, total, label) => h('table', { class: 'lines-t' }, h('tbody', null, rows.map((l) => h('tr', null, h('td', null, l.name, l.calc ? h('span', { class: 'calc' }, l.calc) : null), h('td', { class: 'r' }, inr(l.amount)))),
    h('tr', { class: 'tot' }, h('td', null, label), h('td', { class: 'r' }, inr(total)))));
  return h('div', { class: 'slip' },
    !o.compact ? h('div', { class: 'row sp' }, h('div', null, h('div', { style: { fontWeight: 700, fontSize: '18px' } }, (d.org || {}).name || ''), h('div', { class: 'small muted' }, run.title + (it.payslip_no ? ' · ' + it.payslip_no : ''))), avatar(it.snap.name, 44)) : null,
    h('div', { class: 'net' }, h('div', null, h('div', { class: 'small muted' }, 'Net pay'), h('div', { class: 'words' }, inWords(it.net))), h('div', { class: 'n' }, inr(it.net))),
    att.paid_days != null ? h('div', { class: 'pill-stats' }, statPill('days paid', qty(att.paid_days) + (att.divisor ? '/' + qty(att.divisor) : ''), 'green'), +att.lop_days ? statPill('unpaid days', qty(att.lop_days), 'red') : null,
      +att.leave_paid ? statPill('paid leave', qty(att.leave_paid), 'blue') : null, +att.ot_hours ? statPill('overtime hours', qty(att.ot_hours), 'orange') : null) : null,
    h('div', { class: 'two' }, section('Earnings', h('div', { class: 'card' }, tbl(earn, it.gross, 'Gross pay'))), section('Deductions', h('div', { class: 'card' }, ded.length ? tbl(ded, it.deductions, 'Total deductions') : h('p', { class: 'muted' }, 'None')))),
    emp.length && (o.compact || (d.org || {}).show_employer) ? section('Paid by the employer, on top', h('div', { class: 'card' }, tbl(emp, it.employer, 'Employer cost'))) : null,
    it.tax && +it.tax.annual_tax ? section('Income tax this year', h('div', { class: 'card' }, h('dl', { class: 'kv' },
      h('dt', null, 'Expected yearly income'), h('dd', null, inr(it.tax.annual_income, 0)), h('dt', null, 'Deductions (' + (it.tax.regime === 'old' ? 'old' : 'new') + ' regime)'), h('dd', null, inr(it.tax.deductions, 0)),
      h('dt', null, 'Tax for the year'), h('dd', null, inr(it.tax.annual_tax, 0)), h('dt', null, 'Already deducted'), h('dd', null, inr(+it.tax.ytd_tds + +it.tax.prev_tds, 0))))) : null,
    !o.compact && d.ytd ? h('div', { class: 'small muted' }, 'This financial year so far: gross ' + inr(d.ytd.gross, 0) + ', net ' + inr(d.ytd.net, 0) + ', tax ' + inr(d.ytd.tds, 0)) : null,
    it.status === 'hold' ? banner('', 'lock', 'On hold: ' + (it.hold_reason || '')) : null);
}
// printable payslips (one per page)
function printSlips(list) {
  const one = (d) => {
    const it = d.item, run = d.run, att = it.att || {}, o = d.org || {}, s = it.snap || {};
    const lines = d.lines || [], earn = lines.filter((l) => l.kind === 'earning' || l.kind === 'reimbursement'), ded = lines.filter((l) => l.kind === 'deduction');
    const t = (rows, total, label) => h('table', null, h('tbody', null, rows.map((l) => h('tr', null, h('td', null, l.name), h('td', { class: 'r' }, nf2.format(l.amount)))), h('tr', null, h('td', null, h('b', null, label)), h('td', { class: 'r' }, h('b', null, nf2.format(total))))));
    return h('div', { class: 'slip-p pb' },
      h('div', { class: 'co' }, h('div', null, h('h1', null, o.name || ''), h('div', null, [o.address, o.city].filter(Boolean).join(', ')), o.pf_code ? h('div', null, 'PF ' + o.pf_code) : null), h('div', { style: { textAlign: 'right' } }, h('b', null, 'Payslip'), h('div', null, run.title), h('div', null, it.payslip_no || ''))),
      h('div', { class: 'rule' }),
      h('table', null, h('tbody', null,
        h('tr', null, h('td', null, 'Name'), h('td', null, h('b', null, s.name)), h('td', null, 'Employee no.'), h('td', null, s.code || '')),
        h('tr', null, h('td', null, 'Job'), h('td', null, [s.designation, s.department].filter(Boolean).join(', ')), h('td', null, 'Joined'), h('td', null, fmtD(s.joined_on))),
        h('tr', null, h('td', null, 'PAN'), h('td', null, s.pan || ''), h('td', null, 'UAN'), h('td', null, s.uan || '')),
        h('tr', null, h('td', null, 'Days paid'), h('td', null, att.paid_days != null ? qty(att.paid_days) + ' of ' + qty(att.divisor) : ''), h('td', null, 'Paid to'), h('td', null, s.payout ? [s.payout.bank, s.payout.account].filter(Boolean).join(' ') || s.payout.mode : 'Cash')))),
      h('div', { class: 'two', style: { marginTop: '10px' } }, h('div', null, h('b', null, 'Earnings'), t(earn, it.gross, 'Gross pay')), h('div', null, h('b', null, 'Deductions'), t(ded, it.deductions, 'Total deductions'))),
      h('div', { class: 'net' }, h('span', null, 'Net pay'), h('span', null, '₹' + nf2.format(it.net))), h('div', null, inWords(it.net)),
      o.note ? h('p', null, o.note) : null, h('p', { style: { color: '#555' } }, 'Generated by AUZslab Payroll. This payslip does not need a signature.'));
  };
  printNode(h('div', null, list.map(one)));
}
async function allSlipsSheet(r) {
  const body = h('div', { class: 'grid' });
  const s = sheet({ title: 'Payslips', closeLabel: 'Done', body, noFocus: true, headerAction: { label: 'Print all', onclick: async () => { try { const all = []; for (const i of r.items || []) all.push(await api('pay_get_item', { p_id: i.id })); printSlips(all); } catch (e) { fail(e); } } } });
  body.append(h('p', { class: 'muted' }, 'Each person sees their own payslip in their app. Print or save any of them as PDF.'),
    h('div', { class: 'list' }, (r.items || []).map((i) => liRow({ avatar: i.name, title: i.name, sub: i.payslip_no || '', value: inr(i.net), onclick: () => { s.close(); go('payslip/' + i.id); } }))));
}
page('payslip', {
  title: 'Payslip', icon: 'doc', nav: false, any: true, navAs: 'pay',
  async render(v) {
    const d = await api('pay_get_item', { p_id: v.args[0] });
    v.header({ title: d.run.title, back: () => back(isHR() ? 'pay' : 'my-pay'), actions: [{ label: 'Print or save as PDF', icon: 'print', primary: true, run: () => printSlips([d]) }] });
    v.root.append(slipView(d));
  },
});

// one-time amounts for a run (bonus, incentive, deduction, unpaid days, overtime hours, tax override)
async function inputSheet(r, empId) {
  const ppl = (await people()).filter((e) => e.status !== 'exited' || e.id === empId);
  const comps = (S.ctx.components || []).filter((c) => c.active && !c.system && c.kind === 'earning' || ['BONUS', 'INCENTIVE'].includes(c.code));
  const dcomps = (S.ctx.components || []).filter((c) => c.active && c.kind === 'deduction' && !c.system);
  const f = { employee_id: empId || '', kind: r.kind === 'offcycle' ? 'earning' : 'earning', code: r.kind === 'offcycle' ? 'BONUS' : 'INCENTIVE', amount: '', note: '', taxable: true };
  const box = h('div', { class: 'grid' });
  const paint = () => {
    clear(box).append(
      ['earning', 'deduction'].includes(f.kind) ? field(f.kind === 'earning' ? 'Pay as' : 'Deduct as', selectEl((f.kind === 'earning' ? comps : dcomps).map((c) => [c.code, c.name]), f.code, { onchange: (e) => { f.code = e.target.value; } })) : null,
      field({ earning: 'Amount', deduction: 'Amount', lop_days: 'Unpaid days (use minus to give days back)', ot_hours: 'Extra overtime hours', tds: 'Income tax for this payroll' }[f.kind], input({ type: 'number', mode: 'decimal', value: f.amount, oninput: (e) => { f.amount = e.target.value; } })),
      field('Note', input({ value: f.note, placeholder: 'Shows on the payslip', oninput: (e) => { f.note = e.target.value; } })));
  };
  const body = h('div', { class: 'grid' }, field('Who', selectEl([['', 'Pick'], ...ppl.map((e) => [e.id, e.name])], f.employee_id, { onchange: (e) => { f.employee_id = e.target.value; } })),
    field('What', selectEl([['earning', 'Extra pay (bonus, incentive)'], ['deduction', 'A deduction (fine, recovery)'], ['lop_days', 'Unpaid days'], ['ot_hours', 'Overtime hours'], ['tds', 'Set income tax by hand']], f.kind, { onchange: (e) => { f.kind = e.target.value; f.code = f.kind === 'deduction' ? ((dcomps[0] || {}).code || 'OTHER_DED') : 'INCENTIVE'; paint(); } })), box);
  paint();
  sheet({ title: 'One-time amount', body, actions: [{ label: 'Add', primary: true, onclick: async (close) => {
    if (!f.employee_id) { toast('Pick who', { err: true }); return false; }
    if (!N(f.amount) && f.kind !== 'tds') { toast('Enter the amount', { err: true }); return false; }
    await api('pay_save_inputs', { p_run: r.id, p_rows: [{ employee_id: f.employee_id, kind: f.kind, code: ['earning', 'deduction'].includes(f.kind) ? f.code : null, amount: N(f.amount), note: f.note, taxable: f.taxable }] });
    await api('pay_run_calculate', { p_run: r.id });
    close(); toast('Added and recalculated'); route_();
  } }] });
}

// ---------- paying ----------
function paySheet(r) {
  const left = (r.items || []).filter((i) => i.status === 'ok' && +i.net > 0 && +i.paid + +i.pending < +i.net);
  const withBank = left.filter((i) => i.payout && i.payout.mode === 'bank' && i.payout.account);
  const accts = S.ctx.pay_accounts || [];
  let mode = withBank.length ? 'bank' : 'cash', acct = '';
  const body = h('div', { class: 'grid' },
    h('div', { class: 'hero' }, h('div', { class: 'k' }, left.length + ' people still to pay'), h('div', { class: 'n' }, inr(left.reduce((s, i) => s + +i.net - +i.paid - +i.pending, 0)))),
    optionCards([['bank', 'bank', 'Bank transfer', withBank.length + ' people with bank details. Download a file for your bank, then mark it paid.'],
      ['cash', 'cash', 'Cash', 'Mark everyone left as paid in cash today.'], ['upi', 'wallet', 'UPI', 'For people with a UPI ID saved.']], mode, (x) => { mode = x; }),
    accts.length ? field('Paid from (Accounting)', selectEl([['', mode === 'cash' ? 'Cash' : 'Bank account'], ...accts.map((a) => [a.id, a.name])], acct, { onchange: (e) => { acct = e.target.value; } })) : null);
  sheet({ title: 'Pay salaries', body, actions: [{ label: 'Continue', primary: true, onclick: async (close) => {
    const id = await api('pay_batch_create', { p_run: r.id, p: { mode, pay_account: acct || null, mark_paid: mode === 'cash' } });
    close();
    if (mode === 'cash') { toast('Marked as paid in cash'); route_(); } else batchSheet(id, r);
  } }] });
}
async function batchSheet(id, r) {
  const b = await api('pay_get_batch', { p_id: id });
  const lines = b.lines || [];
  const pending = lines.filter((l) => l.status === 'pending');
  const fileRows = () => lines.filter((l) => l.status === 'pending').map((l) => [l.holder || l.name, l.account_no || l.upi || '', l.ifsc || '', +l.amount, 'Salary ' + monthName(b.run.month, { short: true })]);
  const body = h('div', { class: 'grid' },
    h('div', { class: 'row sp' }, h('div', { class: 'hero' }, h('div', { class: 'k' }, { bank: 'Bank transfer', upi: 'UPI', cash: 'Cash', cheque: 'Cheque' }[b.mode] + ' · ' + b.number), h('div', { class: 'n' }, inr(b.total))), badge(cap1(b.status === 'open' ? 'waiting' : b.status), b.status === 'paid' ? 'green' : 'orange')),
    pending.length && b.mode !== 'cash' ? h('div', { class: 'inline-actions' }, h('button', { class: 'btn', type: 'button', onclick: (e) => exportMenu(e.currentTarget, 'salary-transfer-' + b.number, ['Beneficiary name', b.mode === 'upi' ? 'UPI ID' : 'Account number', 'IFSC', 'Amount', 'Narration'], fileRows()) }, icon('download', 18), 'Download for your bank')) : null,
    pending.length ? h('p', { class: 'small muted' }, 'Upload the file in your bank’s bulk payment page (or pay each person), then mark the batch paid. If one fails, tap it to mark it failed and pay it again later.') : null,
    h('div', { class: 'list' }, lines.map((l) => liRow({ avatar: l.name, title: l.name, sub: l.mode === 'bank' ? (l.bank_name || '') + ' ••••' + String(l.account_no || '').slice(-4) + ' · ' + (l.ifsc || '') : l.upi || cap1(l.mode),
      value: inr(l.amount), badge: badge(cap1(l.status === 'pending' ? 'waiting' : l.status), l.status === 'paid' ? 'green' : l.status === 'failed' ? 'red' : l.status === 'cancelled' ? '' : 'orange'),
      onclick: l.status === 'pending' && can('pay_pay') ? async () => {
        const ch = await alertBox({ title: l.name, message: inr(l.amount), actions: [{ label: 'Mark paid', value: 'paid', role: 'def' }, { label: 'Mark failed', value: 'failed', role: 'danger' }, { label: 'Close', value: false }] });
        if (!ch) return;
        try { const why = ch === 'failed' ? await askText('Why did it fail?', '', 'e.g. Wrong account number') : null; await api('pay_batch_mark', { p_batch: b.id, p: { lines: [{ id: l.id, status: ch, reason: why }] } }); s.close(); batchSheet(id, r); } catch (e) { fail(e); }
      } : null }))));
  const ref = input({ placeholder: 'Bank reference (optional)' }), dt = dateInput(today(), { max: today() });
  if (pending.length && can('pay_pay')) body.append(section('Mark everyone waiting as paid', h('div', { class: 'two' }, field('Paid on', dt), field('Reference', ref))));
  const s = sheet({ title: 'Payment', closeLabel: 'Done', body, wide: true, noFocus: true, onClose: () => route_(),
    actions: pending.length && can('pay_pay') ? [b.status !== 'paid' && !lines.some((l) => l.status === 'paid') ? { label: 'Cancel batch', danger: true, onclick: async (close) => { await api('pay_batch_cancel', { p_batch: b.id }); close(); } } : null,
      { label: 'Mark paid', primary: true, onclick: async (close) => { await api('pay_batch_mark', { p_batch: b.id, p: { all: 'paid', paid_on: dt.value, ref: ref.value } }); toast('Marked as paid'); close(); } }] : [] });
}

// ---------- advances and loans ----------
page('loans', {
  title: 'Advances', icon: 'cash', perm: () => can('pay_salary'), navTitle: 'Advances and loans',
  async render(v) {
    const rows = await api('pay_list_loans', { p: {} });
    v.header({ title: 'Advances and loans', actions: [can('pay_approve') && { label: 'Give an advance', icon: 'plus', primary: true, run: async () => pickPerson((await people()).filter((e) => e.status !== 'exited'), (e) => loanSheet(e)) }] });
    const act = rows.filter((l) => l.status === 'active'), rest = rows.filter((l) => l.status !== 'active');
    v.root.append(h('div', { class: 'kpis k3' }, kpi('Outstanding', inr(act.reduce((s, l) => s + +l.outstanding, 0), 0), act.length + ' active'), kpi('Recovered so far', inr(rows.reduce((s, l) => s + +l.recovered, 0), 0)),
      kpi('Waiting for a decision', rows.filter((l) => l.status === 'requested').length, null, rows.some((l) => l.status === 'requested') ? () => approvalsSheet('loans') : null)));
    const row = (l) => liRow({ avatar: l.name, title: l.name, sub: (l.kind === 'advance' ? 'Advance ' : 'Loan ') + inr(l.amount, 0) + (l.status === 'active' ? ' · ' + inr(l.emi) + ' a month' : ''), value: l.status === 'active' ? inr(l.outstanding) : null, valueSub: l.status === 'active' ? 'left' : null, badge: reqBadge(l.status), onclick: () => loanDetail(l) });
    v.root.append(section('Active', act.length ? h('div', { class: 'list' }, act.map(row)) : h('div', { class: 'card muted' }, 'No advances being recovered.')));
    if (rest.length) v.root.append(section('Earlier', h('div', { class: 'list' }, rest.map(row))));
    const id = v.q.get('id'); if (id) { const l = rows.find((x) => x.id === id); if (l) loanDetail(l); }
  },
});
function loanSheet(e) {
  const f = { employee_id: e.id, kind: 'advance', amount: '', emi: '', start_month: monthOf(today()), disbursed_via: 'cash', reason: '' };
  sheet({ title: 'Advance for ' + e.name, body: h('div', { class: 'grid' },
    field('Type', seg([['advance', 'Salary advance'], ['loan', 'Loan']], f.kind, (x) => { f.kind = x; }, { full: true, label: 'Type' })),
    h('div', { class: 'two' }, field('Amount', input({ type: 'number', mode: 'decimal', oninput: (ev) => { f.amount = ev.target.value; } })), field('Recover each month', input({ type: 'number', mode: 'decimal', placeholder: 'All at once', oninput: (ev) => { f.emi = ev.target.value; } }))),
    field('First month to recover', input({ type: 'month', value: f.start_month, onchange: (ev) => { f.start_month = ev.target.value; } })),
    field('Given how', chips([['cash', 'Cash'], ['bank', 'Bank transfer'], ['none', 'Already given']], f.disbursed_via, (x) => { f.disbursed_via = x; })),
    field('Reason', input({ placeholder: 'Optional', oninput: (ev) => { f.reason = ev.target.value; } }))),
  actions: [{ label: 'Give', primary: true, onclick: async (close) => { if (!N(f.amount)) { toast('Enter the amount', { err: true }); return false; } await api('pay_save_loan', { p: { ...f, amount: N(f.amount), emi: N(f.emi) || N(f.amount) } }); close(); toast('Saved. It is recovered from salary automatically.'); route_(); } }] });
}
function loanDetail(l) {
  const KIND = { disburse: 'Given', recover: 'Recovered', waive: 'Written off', adjust: 'Adjusted' };
  const body = h('div', { class: 'grid' }, h('div', { class: 'kpis' }, kpi('Given', inr(l.amount, 0)), kpi('Left', inr(l.outstanding, 0))),
    h('div', { class: 'list' }, (l.ledger || []).map((x) => liRow({ icon: +x.amount > 0 ? 'plus' : 'minus', tone: 'gray', title: KIND[x.kind] || x.kind, sub: fmtD(x.on_date) + (x.note ? ' · ' + x.note : ''), value: inr(Math.abs(x.amount)) }))),
    (l.skip_months || []).length ? h('p', { class: 'small muted' }, 'Not recovered in: ' + l.skip_months.map((m) => monthName(m, { short: true })).join(', ')) : null);
  const s = sheet({ title: l.name, closeLabel: 'Done', body, noFocus: true,
    actions: l.status === 'active' && can('pay_approve') ? [
      { label: 'Change', onclick: async () => {
        const ch = await alertBox({ title: 'Change recovery', actions: [{ label: 'Change monthly amount', value: 'emi', role: 'def' }, { label: 'Skip next month', value: 'skip' }, { label: 'Write off what is left', value: 'waive', role: 'danger' }, { label: 'Cancel', value: false }] });
        try {
          if (ch === 'emi') { const x = await askText('Monthly recovery', '', 'Amount', String(l.emi), { mode: 'decimal' }); if (x === null) return false; await api('pay_loan_update', { p_id: l.id, p: { emi: N(x) } }); }
          else if (ch === 'skip') await api('pay_loan_update', { p_id: l.id, p: { skip_month: monthAdd(monthOf(today()), +today().slice(8) > 20 ? 1 : 0) } });
          else if (ch === 'waive') { const why = await askText('Write off ' + inr(l.outstanding) + '?', 'It will not be recovered. Say why.', 'Reason'); if (!why) return false; await api('pay_loan_update', { p_id: l.id, p: { waive: true, note: why } }); }
          else return false;
          s.close(); toast('Saved'); route_();
        } catch (e) { fail(e); return false; }
      } }] : [] });
}

// ---------- expense claims ----------
page('claims', {
  title: 'Claims', icon: 'receipt', perm: () => can('pay_salary') || can('pay_approve'), navTitle: 'Expense claims',
  async render(v) {
    let f = v.q.get('f') || 'submitted';
    v.header({ title: 'Expense claims', actions: [can('pay_approve') && { label: 'Add a claim', icon: 'plus', primary: true, run: async () => pickPerson((await people()).filter((e) => e.status !== 'exited'), (e) => claimSheet(e)) }] });
    const box = h('div');
    const paint = async () => {
      const rows = await api('pay_list_claims', { p: { status: f } });
      clear(box).append(rows.length ? h('div', { class: 'list' }, rows.map((c) => liRow({ avatar: c.name, title: c.name, sub: c.category + ' · ' + fmtD(c.claim_date, { noYear: true }) + (c.description ? ' · ' + c.description : '') + (c.run ? ' · in ' + c.run : ''),
        value: inr(c.approved_amount ?? c.amount), badge: reqBadge(c.status), onclick: () => claimDetail(c, paint) })))
        : empty('receipt', 'No claims here', f === 'submitted' ? 'Staff add claims from their app with a photo of the receipt. Approved claims are paid with the next salary.' : ''));
    };
    v.root.append(seg([['submitted', 'Waiting'], ['approved', 'To pay'], ['paid', 'Paid'], ['rejected', 'Declined']], f, (x) => { f = x; paint(); }, { label: 'Show' }), box);
    paint();
  },
});
function claimSheet(e) {
  const f = { date: today(), category: 'Travel', amount: '', description: '' };
  sheet({ title: 'Claim for ' + e.name, body: h('div', { class: 'grid' }, field('Date', dateInput(f.date, { max: today(), onchange: (ev) => { f.date = ev.target.value; } })),
    field('Type', selectEl(['Travel', 'Food', 'Supplies', 'Phone', 'Fuel', 'Other'], f.category, { onchange: (ev) => { f.category = ev.target.value; } })),
    field('Amount', input({ type: 'number', mode: 'decimal', oninput: (ev) => { f.amount = ev.target.value; } })), field('What for', input({ oninput: (ev) => { f.description = ev.target.value; } }))),
  actions: [{ label: 'Add as approved', primary: true, onclick: async (close) => { await api('pay_save_claim', { p_emp: e.id, p: { ...f, amount: N(f.amount) } }); close(); toast('Added. It is paid with the next salary.'); route_(); } }] });
}
async function claimDetail(c, done) {
  const body = h('div', { class: 'grid' }, kvList([['Amount asked', inr(c.amount)], ['Approved', c.approved_amount != null ? inr(c.approved_amount) : null], ['Date', fmtD(c.claim_date)], ['Type', c.category], ['What for', c.description], ['Note', c.decision_note]]),
    c.attachment ? h('button', { class: 'btn', type: 'button', onclick: () => openDoc(c.attachment).catch(fail) }, icon('file', 18), 'See the receipt') : null);
  const acts = [];
  if (c.status === 'submitted' && can('pay_approve')) acts.push({ label: 'Decline', onclick: async (close) => { await api('pay_claim_decide', { p_id: c.id, p_approve: false, p: { note: await askText('Decline', 'Optional: say why.', 'Reason') } }); close(); done(); } },
    { label: 'Approve', primary: true, onclick: async (close) => { const x = await askText('Approve', 'Approved amount', 'Amount', String(c.amount), { mode: 'decimal', confirm: 'Approve' }); if (x === null) return false; await api('pay_claim_decide', { p_id: c.id, p_approve: true, p: { amount: N(x) } }); close(); toast('Approved: paid with the next salary'); done(); } });
  if (c.status === 'approved' && !c.run && can('pay_pay')) acts.push({ label: 'Paid now, outside payroll', onclick: async (close) => { await api('pay_claim_pay', { p_id: c.id, p: { via: 'cash' } }); close(); toast('Marked paid'); done(); } });
  sheet({ title: c.name, closeLabel: 'Done', body, actions: acts, noFocus: true });
}

// ---------- government dues ----------
page('compliance', {
  title: 'Dues', icon: 'building', perm: canPay, navTitle: 'Government dues',
  async render(v) {
    const d = await api('pay_list_stat_payments', { p: {} });
    v.header({ title: 'Government dues', sub: 'PF, ESI, professional tax and TDS from finalised payrolls', actions: [can('pay_pay') && { label: 'Record a payment', icon: 'plus', primary: true, run: () => statPaySheet() }] });
    const SCH = { PF: 'Provident fund (EPFO)', ESI: 'ESI (ESIC)', PT: 'Professional tax', TDS: 'Income tax (TDS)', LWF: 'Labour welfare fund' };
    v.root.append(section('Still to pay', d.dues.length ? h('div', { class: 'list' }, d.dues.map((x) => liRow({ icon: 'building', tone: x.due_date < today() ? 'orange' : 'gray', title: SCH[x.scheme] + ' · ' + monthName(x.month),
      sub: (x.due_date < today() ? 'Was due ' : 'Usually due ') + fmtD(x.due_date) + (+x.paid ? ' · ' + inr(x.paid) + ' paid' : ''), value: inr(x.left), onclick: can('pay_pay') ? () => statPaySheet(x) : null })))
      : h('div', { class: 'card muted' }, 'Nothing outstanding.')));
    v.root.append(section('Files for the portals', h('div', { class: 'list' },
      liRow({ icon: 'download', tone: 'gray', title: 'PF return (ECR text file)', sub: 'Upload on the EPFO employer portal', onclick: () => portalFile('pf') }),
      liRow({ icon: 'download', tone: 'gray', title: 'ESI contributions (sheet)', sub: 'For the ESIC monthly contribution upload', onclick: () => portalFile('esi') }),
      liRow({ icon: 'chart', tone: 'gray', title: 'TDS working (24Q)', sub: 'Income tax deducted, by person and month', onclick: () => go('report/tds') }))));
    if (d.payments.length) v.root.append(section('Paid', h('div', { class: 'list' }, d.payments.map((x) => liRow({ icon: 'check', tone: 'green', title: SCH[x.scheme] + ' · ' + monthName(x.month), sub: fmtD(x.paid_on) + (x.ref ? ' · ' + x.ref : ''), value: inr(x.amount) })))));
    v.root.append(h('p', { class: 'small muted' }, 'Due dates shown are the usual ones (PF and ESI by the 15th, TDS by the 7th, March TDS by 30 April; professional tax varies by state). Check the portal for your exact dates.'));
  },
});
function statPaySheet(x = {}) {
  const f = { scheme: x.scheme || 'PF', month: x.month || monthAdd(monthOf(today()), -1), amount: x.left || '', paid_on: today(), ref: '' };
  sheet({ title: 'Record a payment', body: h('div', { class: 'grid' }, field('For', selectEl([['PF', 'Provident fund'], ['ESI', 'ESI'], ['PT', 'Professional tax'], ['TDS', 'Income tax (TDS)'], ['LWF', 'Labour welfare fund']], f.scheme, { onchange: (e) => { f.scheme = e.target.value; } })),
    field('Month', input({ type: 'month', value: f.month, onchange: (e) => { f.month = e.target.value; } })), h('div', { class: 'two' }, field('Amount', input({ type: 'number', mode: 'decimal', value: f.amount, oninput: (e) => { f.amount = e.target.value; } })), field('Paid on', dateInput(f.paid_on, { max: today(), onchange: (e) => { f.paid_on = e.target.value; } }))),
    field('Challan or reference', input({ oninput: (e) => { f.ref = e.target.value; } }))),
  actions: [{ label: 'Save', primary: true, onclick: async (close) => { await api('pay_stat_pay', { p: { ...f, amount: N(f.amount) } }); close(); toast('Saved'); route_(); } }] });
}
async function portalFile(kind) {
  const m = await askText(kind === 'pf' ? 'PF return' : 'ESI contributions', 'Which month?', 'YYYY-MM', monthAdd(monthOf(today()), -1));
  if (!m) return;
  try {
    const r = await api('pay_report', { p_kind: kind, p: { month: m } });
    if (!r.rows.length) { toast('No ' + (kind === 'pf' ? 'PF' : 'ESI') + ' in a finalised payroll for ' + monthName(m), { err: true }); return; }
    if (kind === 'pf') download('ECR-' + m + '.txt', new Blob([r.rows.map((x) => [x[0], x[1].toUpperCase(), ...x.slice(2).map((n) => Math.round(+n))].join('#~#')).join('\n')], { type: 'text/plain' }));
    else exportCSV('ESI-' + m, r.head, r.rows);
  } catch (e) { fail(e); }
}

// ---------- income tax for one person ----------
async function taxSheet(e, me) {
  const d = me ? await api('pay_me_tax') : await api('pay_get_tax', { p_emp: e.id });
  const dec = d.declaration || {}, it = { ...(dec.items || {}) }, pj = d.projection || {};
  let regime = dec.regime || e.tax_regime || d.regime_default || 'new';
  const num = (k, label, hint) => field(label, input({ type: 'number', mode: 'decimal', value: it[k] ?? '', oninput: (ev) => { it[k] = ev.target.value; } }), hint);
  const oldBox = h('div', { class: 'grid' }, num('rent_monthly', 'Rent paid a month', 'For the house rent exemption'), h('div', { class: 'list' }, toggleRow('Lives in Delhi, Mumbai, Kolkata or Chennai', !!it.metro, (x) => { it.metro = x; })),
    num('sec80c', 'Investments under 80C', 'PPF, ELSS, life insurance, children’s fees; PF is added automatically'), num('sec80d', 'Health insurance (80D)'), num('sec80ccd1b', 'NPS (80CCD 1B)'), num('home_loan_interest', 'Home loan interest'), num('other_deductions', 'Other deductions'));
  const paintOld = () => oldBox.classList.toggle('hidden', regime !== 'old');
  sheet({ title: 'Income tax ' + d.fy, wide: true, body: h('div', { class: 'grid' },
    pj.annual_tax != null ? h('div', { class: 'kpis' }, kpi('Expected yearly income', inr(pj.annual_income, 0)), kpi('Tax for the year', inr(pj.annual_tax, 0), (pj.regime === 'old' ? 'Old' : 'New') + ' regime'), kpi('Each month from now', inr(pj.amt, 0))) : h('p', { class: 'muted' }, pj.note || ''),
    field('Regime', seg([['new', 'New regime'], ['old', 'Old regime']], regime, (x) => { regime = x; paintOld(); }, { full: true, label: 'Regime' }), 'The new regime has lower rates and no deductions except the standard one'),
    oldBox, num('prev_income', 'Taxable pay earlier this year', 'From a previous employer, or before you moved to AUZslab'), num('prev_tds', 'Tax already deducted on it')),
  actions: [{ label: 'Save', primary: true, onclick: async (close) => { if (me) await api('pay_me_tax_save', { p: { regime, items: it } }); else await api('pay_save_tax', { p_emp: e.id, p: { regime, items: it } }); close(); toast('Saved: used from the next payroll'); route_(); } }] });
  paintOld();
}
