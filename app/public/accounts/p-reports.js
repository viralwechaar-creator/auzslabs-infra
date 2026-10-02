/* Reports hub and report pages. Every report: period filters, search/sort where it helps, export (CSV/Excel/PDF) and drill-down. */
'use strict';
const periodPresets = () => {
  const fy = curFY(), pfy = S.fys.find((f) => f.end_date < fy.start_date) || null, ms = monthStart(), lm = monthStart(addDays(ms, -1));
  return [['month', 'This month', ms, today()], ['lastmonth', 'Last month', lm, addDays(ms, -1)], ['fy', 'This year', fy.start_date, today()], ...(pfy ? [['pfy', 'Last year', pfy.start_date, pfy.end_date]] : [])];
};
function periodBar(v, path, from, to, extra) {
  const fe = dateInput(from, { label: 'From' }), te = dateInput(to, { label: 'To' });
  const nav = (f, t) => go(path + '?from=' + f + '&to=' + t + (extra ? '&' + extra : ''));
  fe.onchange = () => nav(fe.value, te.value); te.onchange = () => nav(fe.value, te.value);
  return h('div', { class: 'grid', style: { gap: '10px' } }, chips(periodPresets().map(([k, l]) => [k, l]), '', (k) => { const p = periodPresets().find((x) => x[0] === k); nav(p[2], p[3]); }), h('div', { class: 'row wrap' }, h('div', { class: 'grow' }, fe), h('div', { class: 'grow' }, te)));
}
const NAT = (r) => (r.type === 'asset' || r.type === 'expense' ? 1 : -1);
const drCr = (n) => (Number(n) > 0 ? { dr: Number(n), cr: 0 } : { dr: 0, cr: -Number(n) });

const REPORTS = {
  tb: { title: 'Trial balance', group: 'Financial', desc: 'Every account with opening, movement and closing.', range: true },
  pnl: { title: 'Profit and loss', group: 'Financial', desc: 'Income, costs and profit for a period, with comparison.', range: true },
  bs: { title: 'Balance sheet', group: 'Financial', desc: 'Assets, liabilities and equity on a date.', asof: true },
  cf: { title: 'Cash flow', group: 'Financial', desc: 'Where cash and bank money came from and went.', range: true },
  cashbook: { title: 'Cash book', group: 'Financial', desc: 'Every cash entry with a running balance.', range: true },
  bankbook: { title: 'Bank book', group: 'Financial', desc: 'Every bank entry with a running balance.', range: true },
  daybook: { title: 'Day book', group: 'Financial', desc: 'All vouchers in date order.', link: 'books?tab=daybook' },
  sales_register: { title: 'Sales register', group: 'Sales', desc: 'Every invoice and credit note.', range: true },
  sales_party: { title: 'Sales by customer', group: 'Sales', desc: 'Who buys the most.', range: true },
  sales_item: { title: 'Sales by item', group: 'Sales', desc: 'Quantity, revenue and tax per item.', range: true },
  sales_category: { title: 'Sales by category', group: 'Sales', desc: 'Revenue by product category.', range: true },
  sales_month: { title: 'Sales by month', group: 'Sales', desc: 'Monthly trend.', range: true },
  sales_branch: { title: 'Sales by branch', group: 'Sales', desc: 'Branch performance.', range: true },
  sales_tax: { title: 'Sales by tax rate', group: 'Sales', desc: 'Taxable value and tax per rate.', range: true },
  sales_mode: { title: 'Collections by payment mode', group: 'Sales', desc: 'Cash, UPI, card and bank receipts.', range: true },
  purchase_register: { title: 'Purchase register', group: 'Purchases', desc: 'Every bill, expense and debit note.', range: true },
  purchase_party: { title: 'Purchases by supplier', group: 'Purchases', desc: 'Who you spend with.', range: true },
  purchase_item: { title: 'Purchases by item', group: 'Purchases', desc: 'Quantity and cost per item.', range: true },
  purchase_category: { title: 'Purchases by category', group: 'Purchases', desc: 'Cost by product category.', range: true },
  purchase_tax: { title: 'Purchases by tax rate', group: 'Purchases', desc: 'Taxable value and input tax.', range: true },
  expenses: { title: 'Expense analysis', group: 'Purchases', desc: 'Operating expenses by account.', range: true },
  ageing_receivable: { title: 'Receivables ageing', group: 'Receivable and payable', desc: 'Who owes you, by how late.', asof: true },
  ageing_payable: { title: 'Payables ageing', group: 'Receivable and payable', desc: 'What you owe, by how late.', asof: true },
  budget: { title: 'Budget vs actual', group: 'Analysis', desc: 'Plan against results by month.' },
  audit: { title: 'Audit log', group: 'Audit', desc: 'Who did what, and when.', perm: 'acc_audit' },
  health: { title: 'Books health check', group: 'Audit', desc: 'Proves the books balance and tie to stock, GST and customers.' },
};
page('reports', {
  title: 'Reports', icon: 'chart', perm: 'acc_reports',
  async render(v) {
    const id = v.args[0];
    if (!id) {
      v.header({ title: 'Reports' });
      const groups = uniq(Object.values(REPORTS).map((r) => r.group));
      groups.forEach((g) => v.root.append(h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, g)), h('div', { class: 'list' }, Object.entries(REPORTS).filter(([, r]) => r.group === g && (!r.perm || can(r.perm))).map(([k, r]) => liRow({ icon: 'chart', tone: 'gray', title: r.title, sub: r.desc, chevron: true, onclick: () => go(r.link || 'reports/' + k) }))))));
      v.root.append(h('div', { class: 'list' }, liRow({ icon: 'percent', tone: 'gray', title: 'GST reports', sub: 'Summary, registers, e-invoice and GSTR-2B match', chevron: true, onclick: () => go('gst') }), liRow({ icon: 'box', tone: 'gray', title: 'Stock reports', sub: 'Valuation, movement, fast and slow, batches', chevron: true, onclick: () => go('stock') }), liRow({ icon: 'building', tone: 'gray', title: 'Asset register', sub: 'Cost, depreciation and carrying value', chevron: true, onclick: () => go('assets') })));
      return;
    }
    const R = REPORTS[id]; if (!R) throw new Error('Unknown report');
    if (R.perm && !can(R.perm)) { v.header({ title: R.title }); v.root.append(empty('lock', 'No access', 'Your role cannot open this report.')); return; }
    const fy = curFY(), from = v.q.get('from') || (id === 'pnl' || id.startsWith('sales') || id.startsWith('purchase') || id === 'tb' || id === 'cf' || id === 'expenses' ? fy.start_date : monthStart()), to = v.q.get('to') || today();
    v.header({ title: R.title, back: 'reports' });
    if (R.range) v.root.append(periodBar(v, 'reports/' + id, from, to));
    const host = h('div', { class: 'grid' }); v.root.append(host);
    const FN = { tb: rTB, pnl: rPNL, bs: rBS, cf: rCF, cashbook: (h_, f, t) => rBook(h_, 'cash', f, t), bankbook: (h_, f, t) => rBook(h_, 'bank', f, t), ageing_receivable: (h_) => rAgeing(h_, 'receivable', v), ageing_payable: (h_) => rAgeing(h_, 'payable', v), budget: rBudget, audit: rAudit, health: rHealth, expenses: rExpenses, sales_mode: rMode };
    if (FN[id]) return FN[id](host, from, to, v);
    const [kind, grp] = id.split('_'); return rRegister(host, kind, grp, from, to);
  },
});

async function rTB(host, from, to) {
  const r = await api('acc_trial_balance', { p_from: from, p_to: to });
  const rows = r.rows.map((x) => ({ ...x, od: drCr(x.opening), cd: drCr(x.closing) }));
  const ret = Number(r.retained_prior);
  if (ret) rows.push({ id: 'ret', code: '', name: 'Retained earnings (earlier years)', type: 'equity', opening: ret, debit: 0, credit: 0, closing: ret, od: drCr(ret), cd: drCr(ret) });
  const tot = rows.reduce((s, x) => ({ od: s.od + x.od.dr, oc: s.oc + x.od.cr, d: s.d + Number(x.debit), c: s.c + Number(x.credit), cd: s.cd + x.cd.dr, cc: s.cc + x.cd.cr }), { od: 0, oc: 0, d: 0, c: 0, cd: 0, cc: 0 });
  host.append(h('div', { class: 'banner ' + (Math.abs(tot.cd - tot.cc) < 0.01 ? 'ok' : 'bad') }, icon(Math.abs(tot.cd - tot.cc) < 0.01 ? 'check' : 'alert', 18), Math.abs(tot.cd - tot.cc) < 0.01 ? 'Debits equal credits: ' + inr(tot.cd) : 'Out of balance by ' + inr(tot.cd - tot.cc)),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: (e) => exportMenu(e.currentTarget, 'trial-balance', ['Code', 'Account', 'Type', 'Opening Dr', 'Opening Cr', 'Debit', 'Credit', 'Closing Dr', 'Closing Cr'], rows.map((x) => [x.code, x.name, x.type, x.od.dr, x.od.cr, Number(x.debit), Number(x.credit), x.cd.dr, x.cd.cr])) }, icon('download', 18), 'Export')),
    dataView([{ key: 'name', label: 'Account', title: true, render: (x) => h('div', null, h('div', { class: 't' }, x.name), h('div', { class: 's' }, x.code + ' · ' + cap1(x.type))) }, { key: 'od', label: 'Opening Dr', r: true, hideMobile: true, render: (x) => (x.od.dr ? money(x.od.dr) : ''), sortVal: (x) => x.od.dr }, { key: 'oc', label: 'Opening Cr', r: true, hideMobile: true, render: (x) => (x.od.cr ? money(x.od.cr) : ''), sortVal: (x) => x.od.cr },
      { key: 'debit', label: 'Debit', r: true, render: (x) => (Number(x.debit) ? money(x.debit) : ''), sortVal: (x) => Number(x.debit) }, { key: 'credit', label: 'Credit', r: true, render: (x) => (Number(x.credit) ? money(x.credit) : ''), sortVal: (x) => Number(x.credit) },
      { key: 'cd', label: 'Closing Dr', r: true, value: true, render: (x) => (x.cd.dr ? money(x.cd.dr) : x.cd.cr ? h('span', { class: 'muted' }, money(x.cd.cr) + ' Cr') : ''), sortVal: (x) => x.cd.dr }, { key: 'cc', label: 'Closing Cr', r: true, hideMobile: true, render: (x) => (x.cd.cr ? money(x.cd.cr) : ''), sortVal: (x) => x.cd.cr }],
      rows, { sortKey: 'name', onRow: (x) => x.id !== 'ret' && go('ledger?account=' + x.id + '&from=' + from + '&to=' + to), footer: { od: money(tot.od), oc: money(tot.oc), debit: money(tot.d), credit: money(tot.c), cd: money(tot.cd), cc: money(tot.cc) } }));
}
async function rPNL(host, from, to, v) {
  const cmp = v.q.get('cmp') === '1';
  const days = daysBetween(from, to) + 1, pf = addDays(from, -days), pt = addDays(from, -1);
  const [a, b] = await Promise.all([api('acc_pnl', { p_from: from, p_to: to }), cmp ? api('acc_pnl', { p_from: pf, p_to: pt }) : null]);
  const bmap = {}; if (b) b.groups.forEach((g) => g.accounts.forEach((x) => (bmap[x.id] = Number(x.amount))));
  host.append(h('div', { class: 'row sp wrap' }, h('div', { class: 'muted small' }, 'Natural signs: income and expense shown as positive amounts.'), checkbox('Compare with the previous period (' + fmtD(pf) + ' to ' + fmtD(pt) + ')', cmp, (x) => go('reports/pnl?from=' + from + '&to=' + to + (x ? '&cmp=1' : '')))),
    h('div', { class: 'kpis' }, kpi('Revenue', inr(a.revenue, 0), b ? 'Before ' + compact(b.revenue) : ''), kpi('Gross profit', inr(a.gross_profit, 0), a.gross_margin + '% margin'), kpi('Total expenses', inr(a.expense, 0), ''), kpi('Net profit', inr(a.net_profit, 0), a.net_margin + '% margin', null, a.net_profit < 0 ? 'down' : 'up')));
  const rows = []; const ord = ['Revenue', 'Cost of sales', 'Operating expenses', 'Finance costs', 'Other income'];
  const groups = [...a.groups].sort((x, y) => ord.indexOf(x.grp) - ord.indexOf(y.grp));
  const gp = (name, val, bold) => rows.push({ id: name, name, amount: val, bold, head: true, prev: b ? (name === 'Gross profit' ? b.gross_profit : name === 'Net profit' ? b.net_profit : null) : null });
  groups.forEach((g) => { rows.push({ id: 'g' + g.grp, name: g.grp, amount: Number(g.total), head: true, prev: b ? (b.groups.find((x) => x.grp === g.grp) || { total: 0 }).total : null }); g.accounts.forEach((x) => rows.push({ id: x.id, name: x.name, code: x.code, amount: Number(x.amount), indent: true, prev: b ? (bmap[x.id] || 0) : null })); if (g.grp === 'Cost of sales') gp('Gross profit', a.gross_profit, true); });
  gp('Net profit', a.net_profit, true);
  host.append(h('div', { class: 'row' }, h('button', { class: 'btn', onclick: (e) => exportMenu(e.currentTarget, 'profit-and-loss', ['Line', 'Amount'].concat(b ? ['Previous'] : []), rows.map((x) => [x.name, x.amount].concat(b ? [Number(x.prev || 0)] : []))) }, icon('download', 18), 'Export')),
    h('div', { class: 'card flush' }, h('div', { class: 'tbl-wrap' }, h('table', { class: 'tbl' }, h('thead', null, h('tr', null, h('th', null, 'Line'), h('th', { class: 'r' }, fmtD(from) + ' – ' + fmtD(to)), b ? h('th', { class: 'r' }, 'Previous') : null, b ? h('th', { class: 'r' }, 'Change') : null)),
      h('tbody', null, rows.map((x) => h('tr', { class: x.indent ? 'click' : '', onclick: x.indent ? () => go('ledger?account=' + x.id + '&from=' + from + '&to=' + to) : null, style: x.head ? { background: x.bold ? 'var(--tint-soft)' : 'var(--card2)', fontWeight: 600 } : null },
        h('td', { style: { paddingLeft: x.indent ? '30px' : '' } }, x.name), h('td', { class: 'r' }, money(x.amount, { signed: true })), b ? h('td', { class: 'r' }, money(x.prev || 0)) : null, b ? h('td', { class: 'r ' + (x.amount - (x.prev || 0) >= 0 ? 'up' : 'down') }, (x.amount - (x.prev || 0) >= 0 ? '+' : '−') + inr(Math.abs(x.amount - (x.prev || 0)), 0)) : null)))))));
}
async function rBS(host, from, to) {
  const asof = to; const r = await api('acc_balance_sheet', { p_asof: asof });
  const asofI = dateInput(asof, { label: 'As of', onchange: () => go('reports/bs?to=' + asofI.value) });
  const sec = (type, title, extra) => { const gs = r.groups.filter((g) => g.type === type); return h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, title)), h('div', { class: 'list' }, gs.map((g) => [h('div', { class: 'li', style: { minHeight: '34px', background: 'var(--card2)' } }, h('div', { class: 'grow cap', style: { fontWeight: 600 } }, g.grp), h('b', null, money(g.total))), ...g.accounts.map((a) => liRow({ title: a.name, sub: a.code, value: money(a.amount, { signed: true }), chevron: true, onclick: () => go('ledger?account=' + a.id + '&to=' + asof) }))]), extra || [])); };
  host.append(field('As of', asofI), h('div', { class: 'banner ' + (r.balanced ? 'ok' : 'bad') }, icon(r.balanced ? 'check' : 'alert', 18), r.balanced ? 'Balanced: assets ' + inr(r.assets) + ' = liabilities and equity ' + inr(Number(r.liabilities) + Number(r.equity)) : 'Does not balance: difference ' + inr(r.difference)),
    h('div', { class: 'two' }, sec('asset', 'Assets'), h('div', { class: 'grid' }, sec('liability', 'Liabilities'), sec('equity', 'Equity', [liRow({ title: 'Retained earnings (earlier years)', value: money(r.retained_prior, { signed: true }) }), liRow({ title: 'Profit this year to date', value: money(r.current_profit, { signed: true }), chevron: true, onclick: () => go('reports/pnl') }), h('div', { class: 'li' }, h('div', { class: 'grow', style: { fontWeight: 600 } }, 'Total equity'), h('b', null, money(r.equity)))]))),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: (e) => exportMenu(e.currentTarget, 'balance-sheet-' + asof, ['Type', 'Group', 'Account', 'Amount'], r.groups.flatMap((g) => g.accounts.map((a) => [g.type, g.grp, a.name, Number(a.amount)])).concat([['equity', 'Equity', 'Retained earnings (earlier years)', Number(r.retained_prior)], ['equity', 'Equity', 'Profit this year to date', Number(r.current_profit)]])) }, icon('download', 18), 'Export')));
}
async function rCF(host, from, to) {
  const r = await api('acc_cash_flow', { p_from: from, p_to: to });
  const acts = ['Operating', 'Investing', 'Financing'];
  host.append(h('div', { class: 'kpis k3' }, kpi('Opening cash and bank', inr(r.opening, 0), fmtD(from)), kpi('Net change', inr(r.net, 0), '', null, r.net < 0 ? 'down' : 'up'), kpi('Closing cash and bank', inr(r.closing, 0), fmtD(to))),
    acts.map((a) => { const rows = r.rows.filter((x) => x.activity === a); const t = rows.reduce((s, x) => s + Number(x.amount), 0); return rows.length ? h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, a + ' activities'), h('b', { class: 'num' }, inr(t))), h('div', { class: 'list' }, rows.map((x) => liRow({ title: x.name, value: money(x.amount, { signed: true }) })))) : null; }),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: (e) => exportMenu(e.currentTarget, 'cash-flow', ['Activity', 'Line', 'Amount'], r.rows.map((x) => [x.activity, x.name, Number(x.amount)])) }, icon('download', 18), 'Export')),
    h('p', { class: 'cap' }, 'Built from every entry that touched cash or bank accounts, grouped by the account on the other side.'));
}
async function rBook(host, kind, from, to) {
  const r = await api('acc_book', { p_kind: kind, p_from: from, p_to: to });
  if (!r.accounts.length) { host.append(empty('book', 'No ' + kind + ' accounts')); return; }
  r.accounts.forEach((a) => { const L = a.ledger; host.append(h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, a.name), h('span', { class: 'muted small' }, 'Opening ' + inr(L.opening) + ' · Closing ' + inr(L.closing))),
    dataView([{ key: 'jdate', label: 'Date', title: true, render: (x) => h('div', null, h('div', { class: 't' }, x.doc_number || x.jv), h('div', { class: 's' }, fmtD(x.jdate) + ' · ' + (x.counter || ''))) }, { key: 'counter', label: 'Particulars', render: (x) => (x.doc_number || x.jv) + ' · ' + (x.counter || '') }, { key: 'debit', label: 'Receipts', r: true, render: (x) => (Number(x.debit) ? money(x.debit) : '') }, { key: 'credit', label: 'Payments', r: true, render: (x) => (Number(x.credit) ? money(x.credit) : '') }, { key: 'balance', label: 'Balance', r: true, value: true, render: (x) => money(x.balance, { signed: true }) }],
      L.rows, { sortKey: null, onRow: (x) => (x.source_type === 'document' ? go('doc/' + x.source_id) : x.source_type === 'payment' ? go('payment/' + x.source_id) : go('journal/' + x.jid)), empty: empty('book', 'No entries') }), h('div', { class: 'row' }, h('button', { class: 'btn sm', onclick: (e) => exportMenu(e.currentTarget, kind + '-book-' + a.name, ['Date', 'Voucher', 'Document', 'Particulars', 'Receipts', 'Payments', 'Balance'], [['', '', '', 'Opening balance', '', '', Number(L.opening)], ...L.rows.map((x) => [x.jdate, x.jv, x.doc_number || '', x.counter || '', Number(x.debit), Number(x.credit), Number(x.balance)])]) }, 'Export')))); });
}
async function rAgeing(host, side, v) {
  const asof = v.q.get('to') || today(); const r = await api('acc_ageing', { p: { kind: side, as_of: asof } }), t = r.totals;
  const asofI = dateInput(asof, { label: 'As of', onchange: () => go('reports/ageing_' + side + '?to=' + asofI.value) });
  host.append(field('As of', asofI), h('div', { class: 'kpis' }, [['Current', t.current], ['1–30 days', t.d30], ['31–60 days', t.d60], ['61–90 days', t.d90], ['Over 90 days', t.d90p], ['Advances', t.advance], ['Total', t.total]].map(([l, x]) => kpi(l, inr(x, 0), ''))),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: (e) => exportMenu(e.currentTarget, 'ageing-' + side, ['Party', 'Current', '1-30', '31-60', '61-90', '90+', 'Advance', 'Total'], r.rows.map((x) => [x.name, Number(x.current || 0), Number(x.d30 || 0), Number(x.d60 || 0), Number(x.d90 || 0), Number(x.d90p || 0), Number(x.advance || 0), Number(x.total)])) }, icon('download', 18), 'Export'), side === 'receivable' ? h('button', { class: 'btn', onclick: () => remindersSheet('receivable') }, icon('chat', 18), 'Send reminders') : null),
    dataView([{ key: 'name', label: 'Party', title: true }, { key: 'current', label: 'Current', r: true, render: (x) => money(x.current || 0) }, { key: 'd30', label: '1–30', r: true, render: (x) => money(x.d30 || 0) }, { key: 'd60', label: '31–60', r: true, render: (x) => money(x.d60 || 0) }, { key: 'd90', label: '61–90', r: true, render: (x) => money(x.d90 || 0) }, { key: 'd90p', label: 'Over 90', r: true, render: (x) => money(x.d90p || 0) },
      { key: 'advance', label: 'Advance', r: true, render: (x) => (Number(x.advance) ? money(x.advance) : '') }, { key: 'over', label: '', sub: true, hideDesk: true, render: (x) => 'Overdue ' + inr(Number(x.d30 || 0) + Number(x.d60 || 0) + Number(x.d90 || 0) + Number(x.d90p || 0), 0) }, { key: 'total', label: 'Total', r: true, value: true, render: (x) => money(x.total), sortVal: (x) => Number(x.total) }],
      r.rows.map((x) => ({ ...x, id: x.party_id })), { sortKey: 'total', sortDir: -1, onRow: (x) => go('party/' + x.party_id + '?tab=ageing'), footer: { current: money(t.current), d30: money(t.d30), d60: money(t.d60), d90: money(t.d90), d90p: money(t.d90p), advance: money(t.advance), total: money(t.total) }, empty: empty('check', 'Nothing outstanding') }));
}
async function rRegister(host, kind, grp, from, to) {
  const K = kind === 'sales' ? 'sales' : 'purchase';
  const group = { register: 'doc', party: 'party', item: 'item', category: 'category', month: 'month', branch: 'branch', tax: 'tax_rate' }[grp] || 'doc';
  const r = await api('acc_register', { p: { kind: K, from, to, group } });
  host.append(h('div', { class: 'kpis k3' }, kpi('Taxable value', inr(r.totals.taxable, 0), ''), kpi('Total with tax', inr(r.totals.total, 0), ''), kpi(group === 'doc' ? 'Documents' : 'Groups', String(r.rows.length), '')));
  if (group === 'doc') {
    host.append(h('div', { class: 'row' }, h('button', { class: 'btn', onclick: (e) => exportMenu(e.currentTarget, K + '-register', ['Date', 'Number', 'Type', 'Party', 'GSTIN', 'Place of supply', 'Taxable', 'IGST', 'CGST', 'SGST', 'Cess', 'Total', 'Status'], r.rows.map((x) => [x.doc_date, x.number, x.doc_type, x.party_name || '', x.party_gstin || '', x.place_of_supply || '', Number(x.taxable), Number(x.igst), Number(x.cgst), Number(x.sgst), Number(x.cess), Number(x.total), x.status])) }, icon('download', 18), 'Export')),
      dataView([{ key: 'number', label: 'Document', title: true }, { key: 'party_name', label: 'Party', sub: true, render: (x) => (x.party_name || 'Walk-in') + ' · ' + fmtD(x.doc_date) }, { key: 'doc_date', label: 'Date', render: (x) => fmtD(x.doc_date) }, { key: 'doc_type', label: 'Type', render: (x) => DOC_LABEL[x.doc_type] }, { key: 'party_gstin', label: 'GSTIN', render: (x) => x.party_gstin || '' },
        { key: 'taxable', label: 'Taxable', r: true, render: (x) => money(x.taxable, { signed: true }) }, { key: 'tax', label: 'Tax', r: true, render: (x) => money(Number(x.igst) + Number(x.cgst) + Number(x.sgst) + Number(x.cess), { signed: true }), sortVal: (x) => Number(x.igst) + Number(x.cgst) + Number(x.sgst) }, { key: 'total', label: 'Total', r: true, value: true, render: (x) => money(x.total, { signed: true }), sortVal: (x) => Number(x.total) }],
        r.rows, { onRow: (x) => go('doc/' + x.id), sortKey: 'doc_date', sortDir: -1, footer: { taxable: money(r.totals.taxable), total: money(r.totals.total) }, empty: empty('doc', 'No documents in this period') }));
  } else {
    const label = { party: 'Party', item: 'Item', category: 'Category', month: 'Month', branch: 'Branch', tax_rate: 'Tax rate' }[group];
    host.append(h('div', { class: 'row' }, h('button', { class: 'btn', onclick: (e) => exportMenu(e.currentTarget, K + '-by-' + group, [label, 'Quantity', 'Taxable', 'Tax', 'Total', 'Documents'], r.rows.map((x) => [x.label, Number(x.qty), Number(x.taxable), Number(x.tax), Number(x.total), Number(x.docs)])) }, icon('download', 18), 'Export')),
      r.rows.length > 1 && r.rows.length <= 14 && group !== 'tax_rate' ? h('div', { class: 'card' }, group === 'month' ? barChart(r.rows.slice().sort((a, b) => a.label.localeCompare(b.label)).map((x) => ({ label: x.label.slice(2), value: Number(x.taxable) }))) : hbars(r.rows.slice(0, 10).map((x) => ({ label: x.label, value: Number(x.taxable) })))) : null,
      dataView([{ key: 'label', label, title: true }, { key: 'qty', label: 'Quantity', r: true, render: (x) => qty(x.qty) }, { key: 'docs', label: 'Docs', r: true, render: (x) => x.docs }, { key: 'taxable', label: 'Taxable', r: true, sub: true, render: (x) => inr(x.taxable, 0) + ' taxable · ' + x.docs + ' docs' }, { key: 'tax', label: 'Tax', r: true, render: (x) => money(x.tax) }, { key: 'total', label: 'Total', r: true, value: true, render: (x) => money(x.total), sortVal: (x) => Number(x.total) }],
        r.rows.map((x, i) => ({ ...x, id: i })), { sortKey: 'total', sortDir: -1, footer: { taxable: money(r.totals.taxable), total: money(r.totals.total) }, empty: empty('chart', 'No data in this period') }));
  }
}
async function rExpenses(host, from, to) {
  const r = await api('acc_pnl', { p_from: from, p_to: to });
  const accs = r.groups.filter((g) => g.type === 'expense' && g.grp !== 'Cost of sales').flatMap((g) => g.accounts.map((a) => ({ ...a, grp: g.grp }))).sort((a, b) => b.amount - a.amount);
  const total = accs.reduce((s, a) => s + Number(a.amount), 0);
  host.append(h('div', { class: 'kpis k3' }, kpi('Operating expenses', inr(total, 0), fmtD(from) + ' to ' + fmtD(to)), kpi('Largest', accs[0] ? accs[0].name : '–', accs[0] ? inr(accs[0].amount, 0) : ''), kpi('As % of revenue', Number(r.revenue) ? Math.round(total / Number(r.revenue) * 100) + '%' : '–', '')),
    accs.length ? h('div', { class: 'card' }, hbars(accs.slice(0, 12).map((a) => ({ label: a.name, value: Number(a.amount) })))) : null,
    dataView([{ key: 'name', label: 'Account', title: true }, { key: 'grp', label: 'Group', sub: true }, { key: 'amount', label: 'Amount', r: true, value: true, render: (a) => money(a.amount), sortVal: (a) => Number(a.amount) }, { key: 'pct', label: 'Share', r: true, render: (a) => (total ? Math.round(Number(a.amount) / total * 100) + '%' : '') }], accs, { onRow: (a) => go('ledger?account=' + a.id + '&from=' + from + '&to=' + to), sortKey: 'amount', sortDir: -1, empty: empty('cash', 'No operating expenses in this period') }));
}
async function rMode(host, from, to) {
  const r = (await api('acc_payment_mode_sales', { p_from: from, p_to: to })).rows;
  host.append(r.length ? [h('div', { class: 'card' }, hbars(r.map((x) => ({ label: x.mode, value: Number(x.amount) })))), dataView([{ key: 'mode', label: 'Method', title: true }, { key: 'receipts', label: 'Receipts', r: true, sub: true, render: (x) => x.receipts + ' receipts' }, { key: 'amount', label: 'Amount', r: true, value: true, render: (x) => money(x.amount) }], r.map((x, i) => ({ ...x, id: i })), { sortKey: null })] : empty('wallet', 'No receipts in this period'));
}
async function rBudget(host, from, to, v) {
  const fyId = v.q.get('fy') || curFY().id, fy = S.fys.find((f) => f.id === fyId) || curFY();
  const r = await api('acc_budget_report', { p_fy: fy.id });
  const fs = selectEl(S.fys.map((f) => [f.id, f.label]), fy.id, { label: 'Financial year', onchange: () => go('reports/budget?fy=' + fs.value) });
  const months = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3], mn = (m) => new Date(2000, m - 1, 1).toLocaleDateString('en-GB', { month: 'short' });
  const curM = new Date().getMonth() + 1;
  const rows = r.rows.map((x) => { const b = months.reduce((s, m) => s + Number(x.budget[m] || 0), 0), a = months.reduce((s, m) => s + Number(x.actual[m] || 0), 0); return { ...x, tb: b, ta: a, var: a - b }; });
  host.append(h('div', { class: 'row wrap' }, h('div', { class: 'grow' }, field('Financial year', fs)), can('acc_admin') ? h('button', { class: 'btn fill', onclick: () => budgetSheet(fy, () => v.refresh()) }, icon('edit', 18), 'Set budgets') : null),
    dataView([{ key: 'name', label: 'Account', title: true }, { key: 'tb', label: 'Budget (year)', r: true, render: (x) => money(x.tb) }, { key: 'ta', label: 'Actual (year)', r: true, render: (x) => money(x.ta) }, { key: 'sub', label: '', sub: true, hideDesk: true, render: (x) => 'Budget ' + inr(x.tb, 0) + ' · Actual ' + inr(x.ta, 0) },
      { key: 'var', label: 'Variance', r: true, value: true, render: (x) => { const good = x.type === 'income' ? x.var >= 0 : x.var <= 0; return h('span', { class: x.tb ? (good ? 'up' : 'down') : '' }, (x.var >= 0 ? '+' : '−') + inr(Math.abs(x.var), 0)); }, sortVal: (x) => x.var }], rows.map((x) => ({ ...x })), { sortKey: null, onRow: (x) => go('ledger?account=' + x.id), empty: empty('chart', 'No budget or activity', 'Set budgets for income and expense accounts to compare plan with actual.') }),
    rows.some((x) => x.tb) ? h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'This month, budget vs actual')), h('div', { class: 'list' }, rows.filter((x) => x.budget[curM]).map((x) => liRow({ title: x.name, sub: 'Budget ' + inr(x.budget[curM], 0), value: money(x.actual[curM] || 0), valueSub: Math.round((x.actual[curM] || 0) / x.budget[curM] * 100) + '% of budget' })))) : null);
}
function budgetSheet(fy, done) {
  const accs = S.accounts.filter((a) => a.active && ['income', 'expense'].includes(a.type) && !['round_off', 'disposal_gl', 'sales_return', 'purchase_return', 'stock_adjust'].includes(a.system_key));
  const months = [4, 5, 6, 7, 8, 9, 10, 11, 12, 1, 2, 3]; const vals = {};
  const mk = (a) => { const inp = h('input', { class: 'input', inputmode: 'decimal', placeholder: 'Per month', 'aria-label': 'Monthly budget for ' + a.name, oninput: () => { vals[a.id] = inp.value; } }); return h('div', { class: 'li' }, h('div', { class: 'grow' }, h('div', { class: 't' }, a.name), h('div', { class: 's' }, cap1(a.type))), h('div', { style: { width: '130px' } }, inp)); };
  sheet({ title: 'Budgets for ' + fy.label, full: true, body: h('div', { class: 'grid' }, h('p', { class: 'muted' }, 'Enter one monthly amount per account; it is applied to all 12 months of ' + fy.label + '. Leave blank to keep what is already set.'), h('div', { class: 'list' }, accs.map(mk))),
    actions: [{ label: 'Save budgets', primary: true, onclick: async (c) => { const rows = []; Object.entries(vals).forEach(([id, x]) => { if (x !== '' && !isNaN(N(x))) months.forEach((m) => rows.push({ account_id: id, month: m, amount: N(x) })); }); if (!rows.length) { toast('Enter at least one amount', { err: true }); return false; } await api('acc_save_budget', { p_fy: fy.id, p_rows: rows }); c(); toast('Budgets saved'); done(); } }] });
}
async function rAudit(host, from, to, v) {
  const q = v.q.get('q') || '', ent = v.q.get('entity') || '';
  const r = (await api('acc_list_audit', { p: { search: q, entity: ent, from: from, limit: 300 } })).rows;
  const si = searchField('Search action, user or entity', debounce((x) => go('reports/audit?from=' + from + '&q=' + encodeURIComponent(x) + '&entity=' + ent), 400), q);
  host.append(si, h('div', { class: 'row' }, h('button', { class: 'btn', onclick: (e) => exportMenu(e.currentTarget, 'audit-log', ['When', 'User', 'Action', 'Entity', 'Id', 'Reason'], r.map((x) => [x.at, x.actor_email || '', x.action, x.entity, x.entity_id || '', x.reason || ''])) }, icon('download', 18), 'Export')),
    dataView([{ key: 'action', label: 'Action', title: true, render: (x) => cap1(x.action) + ' · ' + cap1(x.entity) }, { key: 'actor_email', label: 'User', sub: true, render: (x) => (x.actor_email || 'system') + (x.reason ? ' · ' + x.reason : '') }, { key: 'entity', label: 'Entity', render: (x) => cap1(x.entity) }, { key: 'entity_id', label: 'Reference', render: (x) => h('span', { class: 'mono' }, (x.entity_id || '').slice(0, 24)) }, { key: 'reason', label: 'Reason', render: (x) => x.reason || '' }, { key: 'at', label: 'When', value: true, render: (x) => fmtDT(x.at), sortVal: (x) => x.at }],
      r.map((x) => ({ ...x, id: x.id })), { sortKey: 'at', sortDir: -1, onRow: (x) => { sheet({ title: cap1(x.action) + ' · ' + cap1(x.entity), closeLabel: 'Close', body: h('div', { class: 'grid' }, h('div', { class: 'small muted' }, fmtDT(x.at) + ' · ' + (x.actor_email || 'system')), x.reason ? h('div', null, 'Reason: ' + x.reason) : null, x.old_value ? h('div', null, h('div', { class: 'cap' }, 'Before'), h('pre', { class: 'mono', style: { whiteSpace: 'pre-wrap', margin: 0 } }, JSON.stringify(x.old_value, null, 2))) : null, x.new_value ? h('div', null, h('div', { class: 'cap' }, 'After / details'), h('pre', { class: 'mono', style: { whiteSpace: 'pre-wrap', margin: 0 } }, JSON.stringify(x.new_value, null, 2))) : null) }); }, empty: empty('shield', 'No audit entries') }));
}
async function rHealth(host) {
  const r = await api('acc_integrity_check');
  host.append(h('div', { class: 'banner ' + (r.ok ? 'ok' : 'bad') }, icon(r.ok ? 'check' : 'alert', 20), h('div', null, h('b', null, r.ok ? 'All checks passed. ' : 'Something does not agree. '), 'Checked ' + fmtDT(r.at))),
    h('div', { class: 'list' }, r.checks.map((c) => liRow({ icon: c.ok ? 'check' : 'alert', tone: c.ok ? 'green' : 'orange', title: c.name, sub: c.detail }))),
    h('p', { class: 'cap' }, 'These are the invariants of a financial system of record: every journal balances, ledgers tie to documents, and stock and GST reproduce from source transactions.'),
    h('div', { class: 'row' }, h('button', { class: 'btn', onclick: () => route_() }, icon('refresh', 18), 'Run again')));
}
