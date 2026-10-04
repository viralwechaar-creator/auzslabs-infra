/* AUZsMob: Home. Staff: four big thumb-friendly actions + their own work today. Owner/manager: the same
   actions plus the shop's live numbers (today's sales, pending repairs, dues, low stock, who did what). */
'use strict';
page('home', { title: 'home', perm: 'mob_view', render: renderHome });

function bigAction(labelKey, ic, go_) {
  return h('button', { class: 'big-action', type: 'button', onclick: go_ }, h('span', { class: 'ba-ic' }, icon(ic, 26)), h('span', null, t(labelKey)));
}

async function renderHome(v) {
  v.header({ title: t('home'), noLarge: true });
  const actions = h('div', { class: 'big-actions' },
    (can('mob_sell') && feat('sell')) ? bigAction('newSale', 'cash', () => go('sell')) : null,
    (can('mob_purchase') && feat('purchase')) ? bigAction('addPurchase', 'box', () => go('purchase')) : null,
    (can('mob_repair') && repairsMode() === 'full') ? bigAction('newRepair', 'wrench', () => repairSheet()) : null,
    (can('mob_purchase') && feat('purchase') && feat('serials')) ? bigAction('buyUsedPhone', 'phone', () => go('purchase/used')) : null,
  );

  const [sales, purchases, repairs] = await Promise.all([idbGetAll('sales'), idbGetAll('purchases'), idbGetAll('repairs')]);
  const myId = S.user.id;
  const todayStr = new Date().toISOString().slice(0, 10);
  const mine = (r) => !myId || r.staff_id === myId; // myId resolved async below once profile id is known
  const myToday = {
    sales: sales.filter((s) => mine(s) && (s.created_at || '').slice(0, 10) === todayStr && !s.voided),
    purchases: purchases.filter((p) => mine(p) && (p.created_at || '').slice(0, 10) === todayStr),
    repairs: repairs.filter((r) => mine(r) && (r.created_at || '').slice(0, 10) === todayStr),
  };

  const root = v.root;
  add(root, [
    actions,
    section(t('myWorkToday'), h('div', { class: 'kpis' },
      kpi(t('todaysSales'), String(myToday.sales.length), money(myToday.sales.reduce((a, s) => a + N(s.total), 0))),
      kpi(t('addPurchase'), String(myToday.purchases.length)),
      kpi(t('repairs'), String(myToday.repairs.length)),
    )),
    can('mob_reports') ? h('div', { id: 'owner-dash' }, h('div', { class: 'skel', style: { height: '140px' } })) : null,
  ]);

  if (can('mob_reports')) {
    try {
      const [dash, activity] = await Promise.all([api('mob_report_dashboard'), api('mob_report_activity')]);
      const names = await api('mob_staff_list').catch(() => []);
      const nameOf = (id) => (names.find((n) => n.id === id) || {}).name || id;
      if (!root.isConnected) return; // navigated away while this was loading
      add(clear($('#owner-dash')), [
        section(t('todaysSales'), h('div', { class: 'kpis' },
          kpi(t('revenue'), money(dash.sales_total, {}), dash.sales_count + ' ' + (S_LANG === 'hi' ? 'बिल' : 'bills')),
          kpi(t('profit'), money(dash.profit_total)),
          repairsMode() === 'full' ? kpi(t('pendingRepairs'), String(dash.repairs_pending), null, () => go('repairs')) : null,
          feat('customers') ? kpi(t('customerDues'), money(dash.customer_dues), null, () => go('dues')) : null,
        )),
        (feat('stock') && dash.low_stock.length) ? banner('bad', 'alert', h('b', null, dash.low_stock.length + ' ' + t('lowStock')), h('div', { class: 'small' }, dash.low_stock.slice(0, 5).map((x) => x.name).join(', '))) : null,
        section(t('whoDidWhat'), activity.length ? dataView(
          [{ key: 'w', title: true, label: '', render: (r) => (r.kind === 'sale' ? t('sell') : r.kind === 'purchase' ? t('purchase') : t('repairJob')) + ' — ' + nameOf(r.staff_id) },
            { key: 's', sub: true, label: '', render: (r) => fmtDT(r.at) },
            { key: 'a', value: true, r: true, label: '', render: (r) => money(r.amount) }],
          activity.slice(0, 10), {},
        ) : empty('chart', t('noneYet'))),
      ]);
    } catch (e) { if (root.isConnected) clear($('#owner-dash')).append(banner('bad', 'alert', e.message)); }
  }
}
