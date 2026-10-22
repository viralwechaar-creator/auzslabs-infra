/* AUZsFinance: Reports (profit and loss, balance sheet, cash flow, trial balance, who owes how old). Plain lists: name and amount; the rest is one tap away. */
'use strict';
const REP_TABS = [['pl', 'Profit'], ['bs', 'Balance'], ['cash', 'Cash'], ['tb', 'Accounts'], ['age', 'Dues age']];
const repRows = (rows, tone) => rows.length ? h('div', { class: 'list' }, rows.map((r) => liRow({ title: r.name, value: h('span', { class: 'money num ' + (tone || '') }, inr(r.amount)) }))) : empty('box', 'Nothing here', 'No entries in this period.');
const repTotal = (label, v, tone) => h('div', { class: 'hero-n small' }, h('div', { class: 'k' }, label), h('div', { class: 'n num ' + (tone || '') }, inr(v)));
page('reports', { title: 'Reports', async render(v) {
  const tab = v.q.get('t') || 'pl', per = LS.get('per', 'month');
  v.header({ title: 'Reports', actions: [{ label: 'Download', icon: 'download', run: () => window.print() }] });
  v.root.append(seg(REP_TABS, tab, (x) => go('reports?t=' + x), { full: true }));
  if (tab !== 'bs' && tab !== 'tb' && tab !== 'age') v.root.append(seg(PERIODS, per, (x) => { LS.set('per', x); v.refresh(); }, { full: true }));
  const host = h('div', { class: 'grid' }); v.root.append(host);
  const [f, to] = periodDates(per);
  if (tab === 'pl') {
    const r = await api('fin_report_pl', { p_from: f, p_to: to });
    host.append(repTotal(r.profit >= 0 ? 'Profit' : 'Loss', Math.abs(r.profit), r.profit >= 0 ? 'up' : 'down'),
      h('div', { class: 'duo' }, kpi('Earned', inr(r.total_income)), kpi('Spent', inr(r.total_expenses))),
      section('Earned', repRows(r.income, 'up')), section('Spent', repRows(r.expenses, 'down')));
  } else if (tab === 'bs') {
    const r = await api('fin_report_bs', { p_to: todayISO() });
    host.append(h('div', { class: 'hero-n small' }, h('div', { class: 'k' }, 'Worth today'), h('div', { class: 'n num' }, inr(r.total_assets - r.total_liabilities))),
      section('You have', repRows(r.assets)), section('You owe', repRows(r.liabilities)),
      section('Owner side', repRows([...r.equity, { name: 'Profit so far', amount: r.profit_to_date }])),
      h('div', { class: 'list' }, liRow({ icon: r.balanced ? 'check' : 'alert', tone: r.balanced ? 'green' : 'orange', title: r.balanced ? 'Both sides match' : 'Both sides differ', value: inr(r.total_assets) })));
  } else if (tab === 'cash') {
    const r = await api('fin_report_cash', { p_from: f, p_to: to });
    host.append(repTotal('Money now', r.closing), h('div', { class: 'duo' }, kpi('At the start', inr(r.opening)), kpi('Change', inr(Number(r.closing) - Number(r.opening)))),
      section('Where it moved', h('div', { class: 'list' }, r.rows.map((x) => liRow({ icon: (KINDS[x.kind] || {}).ic || 'cash', tone: x.sign > 0 ? 'green' : '', title: kindName(x.kind), value: h('span', { class: 'money num ' + (x.sign > 0 ? 'up' : 'down') }, (x.sign > 0 ? '+' : '-') + inr(x.amount)) })))));
  } else if (tab === 'tb') {
    const r = await api('fin_report_tb', { p_to: todayISO() });
    const d = r.rows.reduce((a, x) => a + Number(x.debit), 0), c = r.rows.reduce((a, x) => a + Number(x.credit), 0);
    host.append(h('div', { class: 'list' }, r.rows.map((x) => liRow({ title: x.name, value: inr(Number(x.debit) || Number(x.credit)), onclick: () => sheet({ title: x.name, closeLabel: 'Done', body: h('div', { class: 'list' }, liRow({ title: 'Code', value: x.code }), liRow({ title: 'Debit', value: inr(x.debit) }), liRow({ title: 'Credit', value: inr(x.credit) })) }) }))),
      h('div', { class: 'list' }, liRow({ icon: Math.abs(d - c) < 0.01 ? 'check' : 'alert', tone: Math.abs(d - c) < 0.01 ? 'green' : 'orange', title: Math.abs(d - c) < 0.01 ? 'Debits equal credits' : 'Debits and credits differ', value: inr(d) })));
  } else {
    const rows = await api('fin_ageing');
    const grp = (dir, title) => { const a = rows.filter((x) => x.direction === dir); return section(title, a.length ? h('div', { class: 'list' }, a.map((x) => liRow({ icon: 'user', tone: 'gray', title: x.name, value: inr(x.total), onclick: () => ageSheet(x) }))) : empty('check', 'No one', 'Nothing pending.')); };
    host.append(grp('in', 'Owes you'), grp('out', 'You owe'));
  }
} });
function ageSheet(x) {
  const b = [['Up to 30 days', x.b0], ['31 to 60 days', x.b1], ['61 to 90 days', x.b2], ['Over 90 days', x.b3]].filter((r) => Number(r[1]) > 0);
  const wa = x.phone ? 'https://wa.me/' + (String(x.phone).replace(/\D/g, '').length === 10 ? '91' : '') + String(x.phone).replace(/\D/g, '') + '?text=' + encodeURIComponent('Hello ' + x.name + ', a reminder that ' + inr(x.total) + ' is pending. Thank you.') : null;
  sheet({ title: x.name, closeLabel: 'Done', body: h('div', { class: 'grid' }, repTotal(x.direction === 'in' ? 'Owes you' : 'You owe', x.total),
    h('div', { class: 'list' }, b.map((r) => liRow({ title: r[0], value: inr(r[1]) }))), x.direction === 'in' && wa ? h('a', { class: 'btn fill', href: wa, target: '_blank', rel: 'noopener' }, 'Remind on WhatsApp') : null) });
}
