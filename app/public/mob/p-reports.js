/* AUZsMob: Reports -- owner/manager only. Server-side aggregates (a staff phone only ever has its own
   data locally, so these can't be computed client-side for anyone but mob_reports).
   Two tabs: Dashboard (the existing KPIs/activity feed) and Staff ledger -- the owner's actual ask: one
   row per thing sold, chaining who bought it from whom for how much to who sold it to whom for how much,
   with a profit column and a grand total, so a staffer under/over-reporting either leg shows up at a glance. */
'use strict';
page('reports', { title: 'reports', perm: 'mob_reports', render: renderReports });

async function renderReports(v) {
  const tab = v.args[0] || 'dashboard';
  const range = v.q.get('range') || 'today';
  const staffId = v.q.get('staff') || '';
  v.header({ title: t('reports'), actions: tab === 'dashboard' ? [{ label: t('exportData'), icon: 'download', run: exportData }] : [] });
  const link = (nextTab, nextRange, nextStaff) => {
    const p = new URLSearchParams();
    if (nextRange) p.set('range', nextRange);
    if (nextStaff) p.set('staff', nextStaff);
    const qs = p.toString();
    return 'reports/' + nextTab + (qs ? '?' + qs : '');
  };
  add(v.root, [
    seg([['dashboard', t('dashboard')], ['ledger', t('staffLedger')]], tab, (tb) => go(link(tb, range, staffId)), { full: !isDesk() }),
    seg([['today', t('today')], ['week', t('thisWeek')], ['month', t('thisMonth')]], range, (r) => go(link(tab, r, staffId)), { full: !isDesk() }),
  ]);
  const body = h('div', { style: { marginTop: '14px' } });
  v.root.append(body);
  if (tab === 'ledger') await renderLedger(body, range, staffId, (sId) => go(link('ledger', range, sId)));
  else await renderDashboard(body, range);
}

async function renderDashboard(body, range) {
  const [from, to] = rangeDates(range);
  const [dash, activity, names] = await Promise.all([api('mob_report_dashboard', { p_from: from, p_to: to }), api('mob_report_activity', { p_from: from, p_to: to }), api('mob_staff_list')]);
  const nameOf = (id) => (names.find((n) => n.id === id) || {}).name || id;
  add(body, [
    h('div', { class: 'kpis' },
      kpi(t('revenue'), money(dash.sales_total)),
      kpi(t('profit'), money(dash.profit_total)),
      kpi(t('pendingRepairs'), String(dash.repairs_pending)),
      kpi(t('customerDues'), money(dash.customer_dues)),
    ),
    section(t('byStaff'), dataView(
      [{ key: 'n', title: true, label: '', render: (r) => nameOf(r.staff_id) },
        { key: 's', value: true, r: true, label: '', render: (r) => String(r.sales) },
        { key: 'rev', value: true, r: true, label: '', render: (r) => money(r.revenue) },
        { key: 'p', value: true, r: true, label: '', render: (r) => money(r.profit) }],
      dash.by_staff, { emptyText: t('noneYet') },
    )),
    dash.low_stock.length ? section(t('lowStock'), h('div', { class: 'list' }, dash.low_stock.map((x) => liRow({ icon: 'box', title: x.name, value: qty(x.qty) })))) : null,
    section(t('activityFeed'), dataView(
      [{ key: 'w', title: true, label: '', render: (r) => (r.kind === 'sale' ? t('sell') : r.kind === 'purchase' ? t('purchase') : t('repairJob')) + ' — ' + nameOf(r.staff_id) },
        { key: 's', sub: true, label: '', render: (r) => fmtDT(r.at) },
        { key: 'a', value: true, r: true, label: '', render: (r) => money(r.amount) }],
      activity, { emptyText: t('noneYet') },
    )),
  ]);
}

async function renderLedger(body, range, staffId, setStaff) {
  const [from, to] = rangeDates(range);
  const [data, names] = await Promise.all([api('mob_report_ledger', { p_from: from, p_to: to, p_staff_id: staffId || null }), api('mob_staff_list')]);
  const rows = data.rows || [];
  add(body, [
    h('div', { class: 'field' }, selectEl([['', t('allStaff')], ...names.map((n) => [n.id, n.name])], staffId, { onchange: (e) => setStaff(e.target.value) })),
    h('p', { class: 'hint' }, t('staffLedgerHint')),
    h('div', { class: 'kpis', style: { marginTop: '10px' } },
      kpi(t('totalSales'), money(data.total_sale)),
      kpi(t('totalCost'), money(data.total_cost)),
      kpi(t('totalProfit'), money(data.total_profit), null, null, N(data.total_profit) < 0 ? 'red' : 'green'),
    ),
    dataView(
      [{ key: 'item', title: true, label: '', render: (r) => r.item_name + (r.imei ? ' · ' + r.imei : '') },
        { key: 'when', sub: true, label: '', render: (r) => fmtDT(r.sold_at) },
        { key: 'vendor', label: '', render: (r) => r.vendor_name || t('noVendorLink') },
        { key: 'boughtBy', label: '', render: (r) => r.purchased_by || '—' },
        { key: 'cost', r: true, label: '', render: (r) => money(r.cost_total) },
        { key: 'soldBy', label: '', render: (r) => r.sold_by || '—' },
        { key: 'customer', label: '', render: (r) => r.customer_name },
        { key: 'sale', value: true, r: true, label: '', render: (r) => money(r.sale_total) },
        { key: 'profit', badge: true, r: true, label: '', render: (r) => badge(money(r.profit), N(r.profit) < 0 ? 'red' : 'green') }],
      rows, { onRow: (r) => ledgerDetailSheet(r), emptyText: t('noneYet') },
    ),
  ]);
}

function ledgerDetailSheet(r) {
  sheet({
    title: r.item_name,
    body: h('div', { class: 'list' },
      liRow({ title: t('date'), value: fmtDT(r.sold_at) }),
      r.imei ? liRow({ title: 'IMEI', value: r.imei }) : null,
      liRow({ title: t('boughtFrom'), value: r.vendor_name || t('noVendorLink') }),
      liRow({ title: t('boughtBy'), value: r.purchased_by || '—' }),
      liRow({ title: t('totalCost'), value: money(r.cost_total) }),
      liRow({ title: t('soldBy'), value: r.sold_by || '—' }),
      liRow({ title: t('soldTo'), value: r.customer_name }),
      liRow({ title: t('totalSales'), value: money(r.sale_total) }),
      liRow({ title: t('profit'), value: money(r.profit) }),
    ),
  });
}

function rangeDates(range) {
  const d = new Date(); const today = d.toISOString().slice(0, 10);
  if (range === 'week') { const w = new Date(d); w.setDate(w.getDate() - 6); return [w.toISOString().slice(0, 10), today]; }
  if (range === 'month') { const m = new Date(d); m.setDate(m.getDate() - 29); return [m.toISOString().slice(0, 10), today]; }
  return [today, today];
}
async function exportData() {
  try {
    const data = await api('mob_export_all');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'auzsmob-export-' + new Date().toISOString().slice(0, 10) + '.json' });
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    toast(t('saved'));
  } catch (e) { fail(e); }
}
