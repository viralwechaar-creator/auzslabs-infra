/* AUZsMob: Reports -- owner/manager only. Server-side aggregates (a staff phone only ever has its own
   data locally, so these can't be computed client-side for anyone but mob_reports). */
'use strict';
page('reports', { title: 'reports', perm: 'mob_reports', render: renderReports });

async function renderReports(v) {
  v.header({ title: t('reports'), actions: [{ label: t('exportData'), icon: 'download', run: exportData }] });
  const range = v.q.get('range') || 'today';
  const [from, to] = rangeDates(range);
  const [dash, activity, names] = await Promise.all([api('mob_report_dashboard', { p_from: from, p_to: to }), api('mob_report_activity', { p_from: from, p_to: to }), api('mob_staff_list')]);
  const nameOf = (id) => (names.find((n) => n.id === id) || {}).name || id;

  add(v.root, [
    seg([['today', t('today')], ['week', t('thisWeek')], ['month', t('thisMonth')]], range, (r) => go('reports?range=' + r), { full: !isDesk() }),
    h('div', { class: 'kpis', style: { marginTop: '14px' } },
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
