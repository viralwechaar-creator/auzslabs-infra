/* AUZsMob: My report -- every staffer's own sales and profit (today / week / month). Server-side
   (mob_report_mine) returns only the caller's own sales; purchase-price figures only when allowed. */
'use strict';
page('myreport', { title: 'myreport', perm: () => can('mob_sell') && !can('mob_reports'), render: renderMyReport });

async function renderMyReport(v) {
  const range = v.q.get('range') || 'today';
  v.header({ title: t('myreport') });
  add(v.root, [seg([['today', t('today')], ['week', t('thisWeek')], ['month', t('thisMonth')]], range, (r) => go('myreport?range=' + r), { full: !isDesk() })]);
  const body = h('div', { style: { marginTop: '14px' } }, h('div', { class: 'skel', style: { height: '120px' } }));
  v.root.append(body);
  const [from, to] = rangeDates(range);
  let data;
  try { data = await api('mob_report_mine', { p_from: from, p_to: to }); } catch (e) { if (v.root.isConnected) clear(body).append(banner('bad', 'alert', e.message)); return; }
  if (!v.root.isConnected) return;
  const rows = data.rows || [];
  clear(body); add(body, [
    h('div', { class: 'kpis' },
      kpi(t('totalSales'), money(data.total_sale), data.bills + ' ' + t('bills')),
      kpi(t('totalProfit'), money(data.total_profit), null, null, N(data.total_profit) < 0 ? 'red' : 'green')),
    rows.length ? h('div', { class: 'grid', style: { gap: '10px', marginTop: '12px' } }, rows.map((r) => h('div', { class: 'card ledger-card' },
      h('div', { class: 'row sp' }, h('div', { class: 't' }, r.item_name), h('span', { class: 'muted small' }, fmtDT(r.sold_at))),
      h('div', { class: 'ledger-grid' },
        h('div', null, h('div', { class: 'cap' }, t('qty')), h('div', { class: 'v' }, r.qty)),
        data.can_see_cost ? h('div', null, h('div', { class: 'cap' }, t('purchaseRate')), h('div', { class: 'v' }, money(r.cost_total))) : null,
        h('div', null, h('div', { class: 'cap' }, t('sellingPrice')), h('div', { class: 'v' }, money(r.sale_total))),
        h('div', null, h('div', { class: 'cap' }, t('profit')), h('div', { class: 'v ' + (N(r.profit) < 0 ? 'down' : 'up') }, money(r.profit))))))) : empty('box', t('noneYet')),
    data.truncated ? h('p', { class: 'hint' }, t('ledgerShowingNewest').replace('{n}', String(rows.length)).replace('{total}', '…')) : null,
  ]);
}
