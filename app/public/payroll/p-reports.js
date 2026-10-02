/* AUZslab Payroll: reports. One list of reports grouped by what people ask ("what did we pay", "what do we owe the
   government", "who came in"), and one report page: pick the month, read the table, export or print it. Every figure comes
   from pay_report() on the server, which applies the same field rules (no salaries for roles without salary rights). */
'use strict';
const REPORTS = [
  { group: 'Pay', items: [
    ['register', 'Salary register', 'Every person and every pay line for a month', 'list', true, 'run'],
    ['summary', 'Cost by department', 'Gross, deductions, net and employer cost', 'chart', true, 'range'],
    ['bank', 'Bank transfer list', 'Who gets paid how much, and to which account', 'bank', true, 'run'],
    ['ctc', 'Salaries now', 'Current monthly and annual cost of each person', 'wallet', true, 'none'],
    ['loans', 'Loans and advances', 'Given, recovered and still owed', 'cash', true, 'none'],
  ] },
  { group: 'Government', items: [
    ['pf', 'Provident fund (ECR)', 'Monthly PF file for the EPFO portal', 'shield', true, 'run'],
    ['esi', 'ESI contributions', 'Monthly ESI upload for the ESIC portal', 'shield', true, 'run'],
    ['pt', 'Professional tax', 'Tax deducted by state and month', 'building', true, 'range'],
    ['tds', 'Income tax deducted (TDS)', 'Working figures for the quarterly 24Q return', 'receipt', true, 'range'],
    ['form16', 'Annual tax statement', 'Form 16 Part B working for one person', 'doc', true, 'person'],
    ['liabilities', 'Statutory dues', 'What is owed, paid and still due', 'alert', true, 'none'],
  ] },
  { group: 'Time and people', items: [
    ['attendance', 'Attendance summary', 'Present, absent, leave and overtime per person', 'calendar', false, 'range'],
    ['late', 'Late arrivals', 'Every late clock-in with the minutes', 'clock', false, 'range'],
    ['leave', 'Leave balances', 'Days left of each paid leave type', 'leave', false, 'none'],
    ['headcount', 'Joiners and leavers', 'Who joined and who left in the period', 'users', false, 'range'],
  ] },
];
const reportDef = (k) => REPORTS.flatMap((g) => g.items).find((x) => x[0] === k);
const reportOk = (x) => x[4] ? canPay() : (can('pay_reports') || canPay());

page('reports', {
  title: 'Reports', icon: 'chart', perm: () => can('pay_reports') || canPay(),
  async render(v) {
    v.header({ title: 'Reports', sub: 'Pick a report, choose the month, then download or print it.' });
    v.root.append(...REPORTS.map((g) => {
      const items = g.items.filter(reportOk);
      return items.length ? section(g.group, h('div', { class: 'list' }, items.map(([k, t, sub, ic]) => liRow({ icon: ic, title: t, sub, onclick: () => go('report/' + k) })))) : null;
    }).filter(Boolean));
    if (can('pay_reports')) v.root.append(section('Checks', h('div', { class: 'list' }, liRow({ icon: 'shield', tone: 'green', title: 'Books health check', sub: 'Proves the payroll figures, payments and accounts agree', onclick: () => go('settings/health') }))));
  },
});

page('report', {
  title: 'Report', icon: 'chart', nav: false, navAs: 'reports', perm: () => can('pay_reports') || canPay(),
  async render(v) {
    const k = v.args[0], def = reportDef(k);
    if (!def || !reportOk(def)) { v.header({ title: 'Report', back: 'reports' }); v.root.append(empty('lock', 'Not available', 'This report is not part of your role.')); return; }
    const [, title, sub, , , mode] = def;
    const q = v.q, mth = q.get('month') || monthAdd(monthOf(today()), mode === 'run' ? -1 : 0);
    const st = { month: mth, from: q.get('from') || mth + '-01', to: q.get('to') || mth + '-' + pad(daysIn(mth)), employee_id: q.get('emp') || '', run_id: q.get('run') || '' };
    const reload = () => { const u = new URLSearchParams(); if (mode === 'run' || mode === 'range') u.set('month', st.month); if (mode === 'range' && (st.from !== st.month + '-01' || st.to !== st.month + '-' + pad(daysIn(st.month)))) { u.set('from', st.from); u.set('to', st.to); } if (st.employee_id) u.set('emp', st.employee_id); if (st.run_id) u.set('run', st.run_id); go('report/' + k + (u.toString() ? '?' + u : '')); };
    const filters = h('div', { class: 'row wrap', style: { gap: '8px', alignItems: 'flex-end' } });
    const monthPick = () => h('div', { class: 'row', style: { gap: '4px' } },
      h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Previous month', onclick: () => { st.month = monthAdd(st.month, -1); st.from = st.month + '-01'; st.to = st.month + '-' + pad(daysIn(st.month)); st.run_id = ''; reload(); } }, icon('chevL', 20)),
      h('div', { style: { minWidth: '150px', textAlign: 'center', fontWeight: 600 } }, monthName(st.month)),
      h('button', { class: 'btn icon', type: 'button', 'aria-label': 'Next month', onclick: () => { st.month = monthAdd(st.month, 1); st.from = st.month + '-01'; st.to = st.month + '-' + pad(daysIn(st.month)); st.run_id = ''; reload(); } }, icon('chevR', 20)));
    if (mode === 'run') filters.append(monthPick());
    if (mode === 'range') filters.append(monthPick(), h('details', { class: 'more-dates' }, h('summary', { class: 'small muted', style: { cursor: 'pointer', padding: '10px 4px' } }, 'Other dates'),
      h('div', { class: 'row wrap', style: { gap: '8px', marginTop: '6px' } }, field('From', dateInput(st.from, { onchange: (e) => { st.from = e.target.value; } })), field('To', dateInput(st.to, { onchange: (e) => { st.to = e.target.value; } })),
        h('button', { class: 'btn', type: 'button', style: { alignSelf: 'flex-end' }, onclick: reload }, 'Show'))));
    if (mode === 'person') {
      const ppl = await people();
      filters.append(field('Person', selectEl([['', 'Pick a person'], ...ppl.map((e) => [e.id, e.name + (e.code ? ' (' + e.code + ')' : '')])], st.employee_id, { onchange: (e) => { st.employee_id = e.target.value; reload(); } })));
    }
    let d = null;
    if (mode !== 'person' || st.employee_id) {
      const p = { month: st.month };
      if (mode === 'range') { p.from = st.from; p.to = st.to; }
      if (st.employee_id) p.employee_id = st.employee_id;
      if (st.run_id) p.run_id = st.run_id;
      d = await api('pay_report', { p_kind: k, p });
    }
    const head = d ? d.head : [], rows = d ? d.rows : [];
    const nf = d && d.numeric_from != null ? d.numeric_from : 99;
    const name = title.replace(/[^\w]+/g, '-') + (mode === 'run' || mode === 'range' ? '-' + st.month : '');
    v.header({ title, back: 'reports', actions: d && rows.length ? [
      k === 'pf' ? { label: 'ECR file', icon: 'download', primary: true, run: () => download('ECR-' + st.month + '.txt', new Blob([rows.map((x) => [x[0], String(x[1]).toUpperCase(), ...x.slice(2).map((n) => Math.round(+n))].join('#~#')).join('\n')], { type: 'text/plain' })) } : null,
      { label: 'Download', icon: 'download', primary: k !== 'pf', run: (b) => exportMenu(b, name, head, rows) },
      { label: 'Print', icon: 'print', run: () => printTable(title + (mode === 'run' || mode === 'range' ? ' · ' + monthName(st.month) : ''), head, rows) }] : [] });
    v.root.append(h('p', { class: 'muted' }, sub), filters);
    if (!d) { v.root.append(empty('user', 'Pick a person', 'The statement covers the current financial year.')); return; }
    if (d.note) v.root.append(banner('info', 'info', d.note));
    if (d.run && mode === 'run') v.root.append(h('div', { class: 'small muted' }, 'From ', h('a', { href: '#/run/' + d.run.id }, d.run.title), ' · ', runBadge(d.run.status)));
    if (d.employee) v.root.append(h('div', { class: 'card' }, h('div', { style: { fontWeight: 600 } }, d.employee.name), h('div', { class: 'small muted' }, [d.employee.code, d.employee.pan ? 'PAN ' + d.employee.pan : 'No PAN on file', 'FY ' + d.fy].filter(Boolean).join(' · '))));
    if (!rows.length) {
      v.root.append(empty('chart', 'Nothing for this period', mode === 'run' ? 'There is no payroll for ' + monthName(st.month) + ' yet, or it has nobody in this report.' : 'Try another month.'));
      return;
    }
    // numbers are right-aligned and money-formatted; totals for money columns
    const isMoney = (i) => i >= nf && !/days|people|hours|minutes|code|reason|status|last working/i.test(head[i]);
    const isNum = (i) => i >= nf && rows.some((r) => typeof r[i] === 'number' || (r[i] !== '' && r[i] != null && !isNaN(Number(r[i])) && !/^\d{4}-\d{2}/.test(String(r[i]))));
    const fmt = (val, i) => {
      if (val == null || val === '') return '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(String(val))) return fmtD(val);
      if (/^\d{4}-\d{2}$/.test(String(val)) && /month/i.test(head[i])) return monthName(val, { short: true });
      if (isNum(i)) return isMoney(i) ? inr(N(val)) : qty(N(val));
      return String(val);
    };
    const cols = head.map((label, i) => ({ key: 'c' + i, label, r: isNum(i), render: (r) => fmt(r['c' + i], i), sortVal: (r) => (isNum(i) ? N(r['c' + i]) : r['c' + i]),
      title: i === (head.findIndex((x) => /^name$/i.test(x)) >= 0 ? head.findIndex((x) => /^name$/i.test(x)) : 0), sub: false }));
    const nameIdx = head.findIndex((x) => /^name$/i.test(x));
    const lastMoney = [...head.keys()].reverse().find((i) => isMoney(i) && isNum(i));
    if (cols.length > 1) {
      const subIdx = head.findIndex((x, i) => i !== (nameIdx >= 0 ? nameIdx : 0) && /department|code|month|date|state|type|scheme/i.test(x));
      if (subIdx >= 0) cols[subIdx].sub = true;
      if (lastMoney != null) cols[lastMoney].value = true;
    }
    const objs = rows.map((r) => Object.fromEntries(r.map((x, i) => ['c' + i, x])));
    const footer = {};
    head.forEach((x, i) => { if (isMoney(i) && isNum(i)) footer['c' + i] = inr(r2(rows.reduce((s, r) => s + N(r[i]), 0))); });
    const n = rows.length;
    v.root.append(h('div', { class: 'small muted' }, n + (n === 1 ? ' row' : ' rows')), dataView(cols, objs, { footer: Object.keys(footer).length ? footer : null }));
    if (d.totals && k === 'pf') v.root.append(section('Challan', h('div', { class: 'list' }, [['PF_EE', 'Employee share (A/c 1)'], ['PF_ER', 'Employer EPF (A/c 1)'], ['EPS_ER', 'Pension (A/c 10)'], ['EDLI', 'Insurance (A/c 21)'], ['PF_ADMIN', 'Admin charges (A/c 2)']]
      .filter(([c]) => d.totals[c] != null).map(([c, l]) => liRow({ title: l, value: inr(d.totals[c]) })))));
    if (d.tax && k === 'form16') {
      const t = d.tax;
      v.root.append(section('Tax worked out', h('div', { class: 'list' }, [['Regime', t.regime === 'old' ? 'Old' : 'New'], ['Yearly income', t.annual_income != null ? inr(t.annual_income) : null], ['Standard deduction', t.std_deduction != null ? inr(t.std_deduction) : null], ['House rent exemption', t.hra_exempt ? inr(t.hra_exempt) : null],
        ['Deductions', t.deductions != null ? inr(t.deductions) : null], ['Taxable income', t.taxable_income != null ? inr(t.taxable_income) : null], ['Tax for the year', t.annual_tax != null ? inr(t.annual_tax) : null], ['Deducted so far', t.ytd_tds != null ? inr(t.ytd_tds) : null]]
        .filter((x) => x[1] != null).map(([a, b]) => liRow({ title: a, value: b })))));
    }
  },
});
