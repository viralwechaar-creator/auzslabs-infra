// Subscriptions: a customer's recurring plan for a subscription/SaaS product (its own renewal date and
// monthly/yearly cadence), separate from a document's own "Repeat..." schedule (acc_recurring, p-editor.js) --
// renewing here raises a real invoice through the normal acc_save_document engine, it just remembers who is on
// which plan and when it is next due, which a product-level or purely document-level schedule cannot do on its own.

function subscriptionSheet(sub, onSaved) {
  const isNew = !sub; sub = sub || {};
  const subProducts = (S.products || []).filter((p) => p.active && p.is_subscription);
  let party = sub.party_id ? { id: sub.party_id, name: sub.party_name } : null;
  let product = sub.product_id ? subProducts.find((p) => p.id === sub.product_id) || { id: sub.product_id, name: sub.product_name, sale_price: sub.amount } : null;
  const partyBtn = h('button', { class: 'li grow', type: 'button', style: { background: 'var(--fill)', borderRadius: '12px', minHeight: '44px' }, onclick: async () => { const np = await pickParty('customer', party && party.id); if (np) { party = np; draw(); } } },
    h('div', { class: 'grow' }, party ? h('div', { class: 't' }, party.name) : h('div', { class: 't muted' }, 'Choose customer')));
  const prodSel = selectEl(subProducts.map((p) => [p.id, p.name]), (product && product.id) || (subProducts[0] && subProducts[0].id) || '', { label: 'Subscription product', onchange: () => { product = subProducts.find((p) => p.id === prodSel.value); amt.value = product ? product.sale_price : ''; } });
  const plan = selectEl([['monthly', 'Monthly'], ['yearly', 'Yearly']], sub.plan_type || 'monthly', {});
  const amt = input({ value: sub.amount || (product ? product.sale_price : ''), mode: 'decimal', placeholder: '0.00' });
  const start = dateInput(sub.start_date || new Date().toISOString().slice(0, 10));
  const renew = dateInput(sub.renewal_date || '');
  const nt = h('textarea', { class: 'textarea', style: { minHeight: '60px' } }, sub.notes || '');
  const wrap = h('div', { class: 'grid' });
  function draw() {
    clear(wrap).append(h('div', { class: 'row' }, partyBtn),
      subProducts.length ? field('Subscription product', prodSel) : h('div', { class: 'banner info' }, 'No subscription products yet. Turn on "This is a subscription" on a service product first.'),
      h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } }, field('Plan type', plan), field('Amount per cycle', amt)),
      h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } }, field('Start date', start), field('Next renewal', renew)),
      field('Notes', nt));
  }
  draw();
  sheet({ title: isNew ? 'New subscription' : 'Edit subscription', body: wrap,
    actions: [{ label: isNew ? 'Add' : 'Save', primary: true, onclick: async (c) => {
      if (!party) { toast('Choose a customer', { err: true }); return false; }
      if (!product) { toast('Choose a subscription product', { err: true }); return false; }
      await api('acc_save_subscription', { p: { id: sub.id || null, party_id: party.id, product_id: product.id, plan_type: plan.value, amount: amt.value || 0, start_date: start.value, renewal_date: renew.value || null, notes: nt.value } });
      c(); toast(isNew ? 'Subscription added' : 'Saved'); onSaved && onSaved();
    } }] });
}

function subscriptionRows(rows, onChange) {
  if (!rows.length) return empty('repeat', 'No subscriptions', 'Add a customer\'s plan for a subscription product.');
  return dataView([
    { key: 'party_name', label: 'Customer', title: true, render: (x) => x.party_name },
    { key: 'product_name', label: 'Plan', sub: true, render: (x) => [x.product_name, x.plan_type === 'monthly' ? 'Monthly' : 'Yearly'].join(' · ') },
    { key: 'renewal_date', label: 'Renews', badge: true, render: (x) => (x.status !== 'active' ? badge('Cancelled') : x.overdue ? badge('Overdue ' + fmtD(x.renewal_date), 'red') : badge('Due ' + fmtD(x.renewal_date), 'green')) },
    { key: 'amount', label: 'Amount', r: true, value: true, render: (x) => money(x.amount), sortVal: (x) => Number(x.amount) },
  ], rows, { onRow: (x) => sheet({ title: x.party_name, closeLabel: 'Close', body: h('div', { class: 'grid' },
      h('div', { class: 'kpis' }, kpi('Plan', x.plan_type === 'monthly' ? 'Monthly' : 'Yearly', x.product_name), kpi('Amount', inr(x.amount), 'per cycle'), kpi('Next renewal', fmtD(x.renewal_date), x.status !== 'active' ? 'Cancelled' : (x.overdue ? 'Overdue' : 'On track'))),
      x.notes ? h('p', { class: 'muted small' }, x.notes) : null),
    actions: [x.status === 'active' && can('acc_sales') ? { label: 'Renew now', primary: true, onclick: async (c) => {
        const choice = await alertBox({ title: 'Renew ' + x.party_name + '?', message: 'This raises an invoice for ' + inr(x.amount) + ' and moves the renewal date forward.',
          actions: [can('acc_post') ? { label: 'Create and post', value: 'post', role: 'def' } : null, { label: 'Create as draft', value: 'draft' }, { label: 'Cancel', value: false }].filter(Boolean) });
        if (!choice) return;
        const r = await api('acc_renew_subscription', { p_id: x.id, p_post: choice === 'post' }); c(); toast(r.posted ? 'Posted invoice ' + r.number : 'Draft invoice created'); onChange();
      } } : null,
      x.status === 'active' && can('acc_sales') ? { label: 'Edit', onclick: (c) => { c(); subscriptionSheet(x, onChange); } } : null,
      x.status === 'active' && can('acc_sales') ? { label: 'Cancel subscription', role: 'danger', onclick: async (c) => {
        const reason = h('input', { class: 'input', placeholder: 'Reason (optional)' });
        const ok = await alertBox({ title: 'Cancel this subscription?', body: reason, confirm: 'Cancel subscription', actions: [{ label: 'Cancel subscription', value: true, role: 'danger' }, { label: 'Keep it', value: false }] });
        if (!ok) return; await api('acc_cancel_subscription', { p_id: x.id, p_reason: reason.value }); c(); toast('Cancelled'); onChange();
      } } : null].filter(Boolean) }) });
}

page('subscriptions', {
  title: 'Subscriptions', icon: 'repeat', perm: 'acc_view',
  async render(v) {
    v.header({ title: 'Subscriptions', actions: [can('acc_sales') ? { label: 'New subscription', icon: 'plus', primary: true, run: () => subscriptionSheet(null, () => v.refresh()) } : null].filter(Boolean) });
    const filter = v.q.get('f') || 'active';
    v.root.append(seg([['active', 'Active'], ['all', 'All'], ['cancelled', 'Cancelled']], filter, (t) => go('subscriptions?f=' + t)));
    const rows = (await api('acc_list_subscriptions', { p: { status: filter } })).rows;
    const overdue = rows.filter((x) => x.overdue).length;
    v.root.append(h('div', { class: 'kpis k3' }, kpi('Subscriptions', String(rows.length), ''), kpi('Overdue renewals', String(overdue), overdue ? 'Renew these first' : 'None overdue'), kpi('Recurring value', inr(rows.filter((x) => x.status === 'active').reduce((s, x) => s + Number(x.amount || 0), 0), 0), 'per cycle, active plans')),
      subscriptionRows(rows, () => v.refresh()));
  },
});
