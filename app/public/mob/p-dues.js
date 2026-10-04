/* AUZsMob: Dues. Customer credit (udhaar) is derived from each sale's own balance, minus later payments
   against it; vendor payable is the running gap between what was purchased from a vendor and what's been
   paid them (mob_payments kind='vendor_due', not tied to one purchase -- see 080's schema header). */
'use strict';
page('dues', { title: 'dues', perm: 'mob_sell', render: renderDues });

async function renderDues(v) {
  const tab = v.args[0] || (feat('customers') ? 'customer' : 'vendor');
  v.header({ title: t('dues') });
  v.root.append(seg([...(feat('customers') ? [['customer', t('customerDue')]] : []), ...(feat('vendors') ? [['vendor', t('vendorDue')]] : [])], tab, (tb) => go('dues/' + tb), { full: !isDesk() }));
  const body = h('div', { style: { marginTop: '16px' } });
  v.root.append(body);
  if (tab === 'vendor') await renderVendorDues(body, v); else await renderCustomerDues(body, v);
}

async function renderCustomerDues(body, v) {
  const [sales, payments] = await Promise.all([idbGetAll('sales'), idbGetAll('payments')]);
  const visible = sales.filter((s) => (can('mob_reports') || s.staff_id === S.user.id) && !s.voided && N(s.balance) > 0);
  const paidAgainst = (saleId) => payments.filter((p) => p.kind === 'customer_due' && p.sale_id === saleId).reduce((a, p) => a + N(p.amount), 0);
  const rows = visible.map((s) => ({ ...s, _due: Math.max(0, N(s.balance) - paidAgainst(s.id)) })).filter((s) => s._due > 0);
  body.append(dataView(
    [{ key: 'c', title: true, label: '', render: (r) => r.customer_name || 'Walk-in' },
      { key: 'b', sub: true, label: '', render: (r) => r.bill_no || '' },
      { key: 'due', value: true, r: true, label: '', render: (r) => money(r._due) }],
    rows, { onRow: (r) => settleSheet(v, 'customer_due', { saleId: r.id }, r._due), emptyText: t('noneYet') },
  ));
}

async function renderVendorDues(body, v) {
  if (!can('mob_reports')) { body.append(empty('lock', t('errNoAccess'))); return; }
  const [purchases, vendors, payments] = await Promise.all([idbGetAll('purchases'), idbGetAll('vendors'), idbGetAll('payments')]);
  const byVendor = {};
  for (const p of purchases) { if (!p.vendor_id) continue; byVendor[p.vendor_id] = (byVendor[p.vendor_id] || 0) + N(p.total); }
  for (const p of payments) { if (p.kind === 'vendor_due' && p.vendor_id) byVendor[p.vendor_id] = (byVendor[p.vendor_id] || 0) - N(p.amount); }
  const rows = Object.entries(byVendor).map(([id, due]) => ({ id, name: (vendors.find((x) => x.id === id) || {}).name || id, due })).filter((r) => r.due > 0.01);
  body.append(dataView(
    [{ key: 'v', title: true, label: '', render: (r) => r.name }, { key: 'due', value: true, r: true, label: '', render: (r) => money(r.due) }],
    rows, { onRow: (r) => settleSheet(v, 'vendor_due', { vendorId: r.id }, r.due), emptyText: t('noneYet') },
  ));
}

function settleSheet(v, kind, ref, maxDue) {
  const amount = input({ value: r2(maxDue), label: t('amount'), mode: 'decimal', autofocus: true });
  const method = selectEl([['cash', t('cash')], ['upi', t('upi')], ['card', t('card')]], 'cash');
  sheet({
    title: t('settlePayment'), body: h('div', { class: 'grid' }, field(t('amount'), amount), field(t('paymentMode'), method)),
    actions: [{ label: t('save'), primary: true, onclick: async (close) => {
      if (!N(amount.value)) { fail(new Error(t('errNameRequired'))); return false; }
      const id = uid();
      const p = { kind, saleId: ref.saleId || null, vendorId: ref.vendorId || null, amount: N(amount.value), method: method.value };
      await localPush('payments', { id, kind, sale_id: p.saleId, vendor_id: p.vendorId, amount: p.amount, method: p.method, staff_id: S.user.id, created_at: new Date().toISOString() }, 'mob_push_payment', { p_id: id, p });
      close(); toast(t('saved')); v.refresh();
    } }],
  });
}
