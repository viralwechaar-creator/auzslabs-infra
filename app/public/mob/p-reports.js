/* AUZsMob: Reports -- owner/manager only. Server-side aggregates (a staff phone only ever has its own
   data locally, so these can't be computed client-side for anyone but mob_reports).
   Three tabs: Dashboard (KPIs + a by-staff summary), Staff ledger (the owner's core ask: one row per
   thing sold, chaining who bought it from whom for how much to who sold it to whom for how much, with a
   profit column and a grand total, so a staffer under/over-reporting either leg shows up at a glance),
   and Staff updates -- its own dedicated space for the chronological feed of every sale/purchase/repair,
   filterable to one staffer at a time, moved out of Dashboard so it isn't buried under the KPIs. */
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
    seg([['dashboard', t('dashboard')], ['ledger', t('staffLedger')], ['updates', t('staffUpdates')]], tab, (tb) => go(link(tb, range, staffId)), { full: !isDesk() }),
    seg([['today', t('today')], ['week', t('thisWeek')], ['month', t('thisMonth')]], range, (r) => go(link(tab, r, staffId)), { full: !isDesk() }),
  ]);
  const body = h('div', { style: { marginTop: '14px' } });
  v.root.append(body);
  if (tab === 'ledger') await renderLedger(body, range, staffId, (sId) => go(link('ledger', range, sId)));
  else if (tab === 'updates') await renderUpdates(body, range, staffId, (sId) => go(link('updates', range, sId)));
  else await renderDashboard(body, range);
}

async function renderDashboard(body, range) {
  const [from, to] = rangeDates(range);
  const [dash, names] = await Promise.all([api('mob_report_dashboard', { p_from: from, p_to: to }), api('mob_staff_list')]);
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
  ]);
}

async function renderUpdates(body, range, staffId, setStaff) {
  const [from, to] = rangeDates(range);
  const [activity, names] = await Promise.all([api('mob_report_activity', { p_from: from, p_to: to }), api('mob_staff_list')]);
  const nameOf = (id) => (names.find((n) => n.id === id) || {}).name || id;
  const rows = staffId ? activity.filter((r) => r.staff_id === staffId) : activity;
  add(body, [
    h('div', { class: 'field' }, selectEl([['', t('allStaff')], ...names.map((n) => [n.id, n.name])], staffId, { onchange: (e) => setStaff(e.target.value) })),
    h('p', { class: 'hint' }, t('staffUpdatesHint')),
    dataView(
      [{ key: 'w', title: true, label: '', render: (r) => (r.kind === 'sale' ? t('sell') : r.kind === 'purchase' ? t('purchase') : t('repairJob')) + ' — ' + nameOf(r.staff_id) },
        { key: 's', sub: true, label: '', render: (r) => fmtDT(r.at) },
        { key: 'a', value: true, r: true, label: '', render: (r) => money(r.amount) }],
      rows, { emptyText: t('noneYet') },
    ),
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
    ledgerCards(rows),
  ]);
}

// One card per sold item, item name/qty/purchase price/selling price/profit all visible at once --
// previously these were spread across table columns that mobile's generic dataView only shows one or two
// of at a time (title/sub/value/badge), pushing qty and purchase price behind a tap into the detail sheet.
// Vendor/customer/who-bought/who-sold chain still lives in ledgerDetailSheet() on tap, unchanged.
function ledgerCards(rows) {
  if (!rows.length) return empty('box', t('noneYet'));
  return h('div', { class: 'grid', style: { gap: '10px' } }, rows.map((r) => h('button', { type: 'button', class: 'card ledger-card', onclick: () => ledgerDetailSheet(r) },
    h('div', { class: 'row sp' }, h('div', { class: 't' }, r.item_name + (r.imei ? ' · ' + r.imei : '')), h('span', { class: 'muted small' }, fmtDT(r.sold_at))),
    h('div', { class: 'ledger-grid' },
      h('div', null, h('div', { class: 'cap' }, t('qty')), h('div', { class: 'v' }, r.qty)),
      h('div', null, h('div', { class: 'cap' }, t('purchaseRate')), h('div', { class: 'v' }, money(r.cost_total))),
      h('div', null, h('div', { class: 'cap' }, t('sellingPrice')), h('div', { class: 'v' }, money(r.sale_total))),
      h('div', null, h('div', { class: 'cap' }, t('profit')), h('div', { class: 'v ' + (N(r.profit) < 0 ? 'down' : 'up') }, money(r.profit))),
    ),
  )));
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
// Owner's "export data" was a raw JSON dump of every table (UUIDs, snake_case columns, nested item arrays) --
// a technical backup, not something a shop owner could open and read. This builds the same report the Staff
// ledger tab already shows (names resolved, totals computed server-side by mob_report_ledger), across all
// time, as a CSV that Excel/Sheets opens directly as a normal spreadsheet with plain column headers.
function csvEscape(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
async function exportData() {
  try {
    const data = await api('mob_report_ledger', { p_from: '2000-01-01', p_to: new Date().toISOString().slice(0, 10) });
    const rows = data.rows || [];
    const head = ['Date', 'Item', 'IMEI / Serial', 'Qty', 'Purchased From', 'Purchased By', 'Purchase Price', 'Sold To', 'Sold By', 'Selling Price', 'Profit'];
    const body = rows.map((r) => [fmtDT(r.sold_at), r.item_name, r.imei || '', r.qty, r.vendor_name || '', r.purchased_by || '', r.cost_total, r.customer_name || '', r.sold_by || '', r.sale_total, r.profit]);
    const totals = ['', '', '', '', '', 'Total', data.total_cost, '', '', data.total_sale, data.total_profit];
    const csv = '﻿' + [head, ...body, [], totals].map((row) => row.map(csvEscape).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'auzsmob-report-' + new Date().toISOString().slice(0, 10) + '.csv' });
    document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
    toast(t('saved'));
  } catch (e) { fail(e); }
}
