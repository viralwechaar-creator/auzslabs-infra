/* Home: the financial state of the business at a glance. Every figure comes from acc_dashboard (derived from the books). */
'use strict';
page('home', {
  title: 'Home', tabLabel: 'Home', icon: 'home',
  async render(v) {
    let branch = v.q.get('branch') || '';
    const hostEl = h('div', { class: 'grid', style: { gap: '22px' } });
    v.header({ title: 'Home', sub: (S.org.trade_name || S.org.legal_name || '') + ' · ' + fmtD(today()), actions: [{ label: 'New', icon: 'plus', primary: true, run: (b) => quickMenu(b) }, isDesk() ? null : { label: 'Search', icon: 'search', run: openPalette }] });
    v.root.append(hostEl);
    const draw = async () => {
      let d;
      try { d = await api('acc_dashboard', { p: branch ? { branch_id: branch } : {} }); } catch (e) { clear(hostEl).append(empty('alert', 'Could not load the dashboard', e.message)); return; }
      clear(hostEl);
      const setup = [];
      if (!S.org.gstin && S.org.reg_type === 'regular') setup.push('Add your GSTIN');
      if (!S.org.state_code) setup.push('choose your state');
      if (setup.length && can('acc_admin')) hostEl.append(h('div', { class: 'banner info' }, icon('info', 20), h('div', { class: 'grow' }, h('b', null, 'Finish setting up. '), setup.join(' and ') + ' so GST is calculated on every document.'), h('button', { class: 'btn sm', onclick: () => go('settings/organisation') }, 'Open settings')));
      if (S.ctx.tenant.is_demo) hostEl.append(h('div', { class: 'banner' }, icon('info', 20), h('div', null, h('b', null, 'This is demo data. '), 'Try anything: it is rebuilt every 12 hours.')));
      if (S.branches.length > 1) hostEl.append(chips([['', 'All branches'], ...S.branches.map((b) => [b.id, b.name])], branch, (x) => { branch = x; draw(); }));
      const m = d.month, delta = (a, b) => b ? Math.round((a - b) / Math.abs(b) * 100) : null;
      const sd = delta(m.sales, m.prev_sales);
      hostEl.append(h('div', { class: 'kpis' },
        kpi('Sales today', inr(d.sales_today, 0), 'This month ' + compact(m.sales) + (sd != null ? ` (${sd >= 0 ? '+' : ''}${sd}% vs last)` : ''), () => go('sales')),
        kpi('Collected today', inr(d.collections_today, 0), 'Money received', () => go('receipts')),
        kpi('Purchases today', inr(d.purchases_today, 0), 'Bills raised', () => go('purchases')),
        kpi('Expenses today', inr(d.expenses_today, 0), 'Operating costs', () => go('expenses'))));
      hostEl.append(h('div', { class: 'kpis' },
        kpi('Customers owe you', inr(d.receivables, 0), d.overdue_receivables > 0 ? inr(d.overdue_receivables, 0) + ' overdue' : 'Nothing overdue', () => go('reports/ageing_receivable')),
        kpi('You owe suppliers', inr(d.payables, 0), d.overdue_payables > 0 ? inr(d.overdue_payables, 0) + ' overdue' : 'Nothing overdue', () => go('reports/ageing_payable')),
        kpi('Stock value', inr(d.stock_value, 0), 'At cost', () => go('stock')),
        kpi('Profit this month', inr(m.profit, 0), m.gross_margin + '% gross margin', () => go('reports/pnl'), m.profit < 0 ? 'down' : 'up')));
      // things needing attention
      const a = d.alerts, att = [];
      if (a.overdue_invoices) att.push({ icon: 'clock', tone: 'orange', title: a.overdue_invoices + ' overdue invoice' + (a.overdue_invoices > 1 ? 's' : ''), sub: inr(d.overdue_receivables, 0) + ' to collect', run: () => go('sales?status=overdue') });
      if (a.bills_due_week) att.push({ icon: 'receipt', tone: 'blue', title: a.bills_due_week + ' bill' + (a.bills_due_week > 1 ? 's' : '') + ' due this week', sub: 'Pay suppliers on time', run: () => go('purchases?status=unpaid') });
      if (a.pending_approval && can('acc_approve')) att.push({ icon: 'shield', tone: 'orange', title: a.pending_approval + ' waiting for approval', sub: 'Review and post', run: () => go('purchases?status=pending approval') });
      if (a.drafts) att.push({ icon: 'edit', tone: 'gray', title: a.drafts + ' draft' + (a.drafts > 1 ? 's' : ''), sub: 'Not posted yet', run: () => go('sales?status=draft') });
      if (a.low_stock) att.push({ icon: 'box', tone: 'orange', title: a.low_stock + ' item' + (a.low_stock > 1 ? 's' : '') + ' low on stock', sub: 'At or below reorder level', run: () => go('products?low=1') });
      if (a.unmatched_bank) att.push({ icon: 'bank', tone: 'blue', title: a.unmatched_bank + ' bank row' + (a.unmatched_bank > 1 ? 's' : '') + ' to match', sub: 'Reconcile your statement', run: () => go('banking') });
      hostEl.append(h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Needs attention')),
        att.length ? h('div', { class: 'list' }, att.map((x) => liRow({ icon: x.icon, tone: x.tone, title: x.title, sub: x.sub, chevron: true, onclick: x.run }))) : h('div', { class: 'card' }, h('div', { class: 'row' }, icon('check', 22), h('span', null, 'All clear. Nothing needs your attention right now.')))));

      const trend = h('div', { class: 'card' }, h('div', { class: 'row sp' }, h('h3', null, 'Sales, last 30 days'), h('span', { class: 'muted small' }, inr(d.sales_trend.reduce((s, x) => s + Number(x.sales), 0), 0))),
        lineChart(d.sales_trend.map((x) => ({ label: fmtD(x.d).replace(/ \d{4}$/, ''), value: Number(x.sales) })), { label: 'Sales per day for the last 30 days' }));
      const exp = h('div', { class: 'card' }, h('h3', null, 'Expenses by month'), barChart(d.expense_trend.map((x) => ({ label: new Date(x.m + '-01T12:00').toLocaleDateString('en-GB', { month: 'short' }), value: Number(x.expense) })), { label: 'Operating expenses by month' }));
      hostEl.append(h('div', { class: 'two' }, trend, exp));

      const cb = h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Cash and bank')), h('div', { class: 'list' }, d.cash_bank.map((c) => liRow({ icon: 'wallet', tone: 'green', title: c.name, value: money(c.balance, { signed: true }), chevron: true, onclick: () => go('ledger?account=' + c.id) }))));
      const fyD = delta(d.fy.sales, d.fy.prev_sales);
      const cmp = h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Comparisons')), h('div', { class: 'list' },
        liRow({ title: 'This month vs last month', sub: 'Sales (before tax)', value: inr(m.sales, 0), valueSub: sd == null ? 'no earlier sales' : (sd >= 0 ? '▲ ' : '▼ ') + Math.abs(sd) + '% vs ' + compact(m.prev_sales) }),
        liRow({ title: 'Profit this month vs last', value: inr(m.profit, 0), valueSub: 'last month ' + compact(m.prev_profit) }),
        liRow({ title: 'This financial year vs last', sub: 'Sales (before tax)', value: inr(d.fy.sales, 0), valueSub: fyD == null ? 'no earlier year' : (fyD >= 0 ? '▲ ' : '▼ ') + Math.abs(fyD) + '% vs ' + compact(d.fy.prev_sales) })));
      hostEl.append(h('div', { class: 'two' }, cb, cmp));

      const lists = [];
      if (d.top_products.length) lists.push(h('div', { class: 'card' }, h('h3', null, 'Top products, 30 days'), h('div', { style: { height: '10px' } }), hbars(d.top_products.map((p) => ({ label: p.name, value: Number(p.revenue) })))));
      if (d.top_customers.length) lists.push(h('div', { class: 'card' }, h('h3', null, 'Top customers this year'), h('div', { style: { height: '10px' } }), hbars(d.top_customers.map((p) => ({ label: p.name || 'Walk-in', value: Number(p.revenue) })))));
      if (lists.length) hostEl.append(h('div', { class: 'two' }, lists));
      const more = [];
      if (d.low_products.length) more.push(h('div', { class: 'card' }, h('h3', null, 'Slowest sellers, 30 days'), h('div', { style: { height: '10px' } }), hbars(d.low_products.map((p) => ({ label: p.name, value: Number(p.revenue) })))));
      if (d.branches.length > 1) more.push(h('div', { class: 'card' }, h('h3', null, 'Branches this month'), h('div', { style: { height: '10px' } }), hbars(d.branches.map((p) => ({ label: p.name, value: Number(p.sales) })))));
      if (d.budget.length) more.push(h('div', { class: 'card' }, h('h3', null, 'Budget vs actual, this month'), h('div', { style: { height: '10px' } }), h('div', { class: 'col' }, d.budget.map((b) => { const pc = Math.round(Number(b.actual) / Number(b.budget) * 100); return h('div', null, h('div', { class: 'row sp small' }, h('span', null, b.name), h('span', { class: 'num' }, inr(b.actual, 0) + ' of ' + inr(b.budget, 0) + ' (' + pc + '%)')), h('div', { class: 'hbar' }, h('div', { class: 'r', style: { gridTemplateColumns: '1fr' } }, h('div', { class: 'tr' }, h('i', { style: { width: Math.min(pc, 100) + '%', background: pc > 100 && b.name !== 'Sales' ? 'var(--red)' : '' } }))))); }))));
      if (more.length) hostEl.append(h('div', { class: 'two' }, more));
    };
    await draw();
  },
});
