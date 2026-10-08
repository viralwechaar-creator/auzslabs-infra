/* AUZsMob: Dues. Customer credit (udhaar) is derived from each sale's own balance, minus later payments
   against it. Vendor payable is still the running gap between what was purchased from a vendor and what's
   been paid them -- mob_payments (kind='vendor_due') has no column tying it to one purchase, so there is no
   real allocation row, only a vendor-level bucket (see 080's schema header). Tapping a vendor now drills into
   vendorPurchaseDues(), which turns that same bucket into a per-purchase breakdown by assuming the obvious
   thing an owner would: a payment pays off the OLDEST unpaid purchase first (FIFO), computed fresh every time
   from the purchases/payments already on the device -- no new table, no server call, works offline like the
   rest of this app. It's a best-effort traceability view, not a ledger: a purchase that's edited after some
   of its vendor's other purchases already "used up" the FIFO order can shuffle which purchase a given payment
   looks allocated to, even though the vendor-level total due is always exactly right either way. */
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
  const [purchases, vendors, payments, items] = await Promise.all([idbGetAll('purchases'), idbGetAll('vendors'), idbGetAll('payments'), idbGetAll('items')]);
  const byVendor = {};
  for (const p of purchases) { if (!p.vendor_id || p.voided) continue; byVendor[p.vendor_id] = (byVendor[p.vendor_id] || 0) + N(p.total); }
  for (const p of payments) { if (p.kind === 'vendor_due' && p.vendor_id) byVendor[p.vendor_id] = (byVendor[p.vendor_id] || 0) - N(p.amount); }
  const rows = Object.entries(byVendor).map(([id, due]) => ({ id, name: (vendors.find((x) => x.id === id) || {}).name || id, due })).filter((r) => r.due > 0.01);
  body.append(dataView(
    [{ key: 'v', title: true, label: '', render: (r) => r.name }, { key: 'due', value: true, r: true, label: '', render: (r) => money(r.due) }],
    rows, { onRow: (r) => vendorDueDetail(v, r, purchases, payments, items), emptyText: t('noneYet') },
  ));
}

// FIFO: oldest unpaid purchase first. Pure function of data already synced to the device (purchases +
// vendor_due payments for this one vendor) -- voided purchases never carry a due. See the file header
// comment above for why this is a best-effort view, not a real per-purchase allocation ledger.
function vendorPurchaseDues(purchases, payments, vendorId) {
  const vp = purchases.filter((p) => p.vendor_id === vendorId && !p.voided)
    .sort((a, b) => (a.created_at || '').localeCompare(b.created_at || '') || String(a.id).localeCompare(String(b.id)));
  const totalPaid = payments.filter((p) => p.kind === 'vendor_due' && p.vendor_id === vendorId).reduce((a, p) => a + N(p.amount), 0);
  let remaining = totalPaid, totalPurchased = 0;
  const rows = vp.map((p) => {
    totalPurchased += N(p.total);
    const applied = Math.min(N(p.total), Math.max(0, remaining));
    remaining -= applied;
    return { ...p, _due: r2(N(p.total) - applied) };
  });
  return { rows, totalPurchased, totalPaid };
}

function vendorDueDetail(v, row, purchases, payments, items) {
  const nameOf = (id) => (items.find((i) => i.id === id) || {}).name || '';
  const { rows, totalPurchased, totalPaid } = vendorPurchaseDues(purchases, payments, row.id);
  const unpaid = rows.filter((r) => r._due > 0.01);
  sheet({
    title: row.name,
    body: h('div', { class: 'grid' },
      h('div', { class: 'list' },
        liRow({ title: t('totalPurchased'), value: money(totalPurchased) }),
        liRow({ title: t('totalPaidToVendor'), value: money(totalPaid) }),
        liRow({ title: t('due'), value: money(row.due) })),
      section(t('unpaidPurchases'),
        unpaid.length
          ? h('div', { class: 'list' }, unpaid.map((p) => liRow({ icon: 'box', title: nameOf(p.item_id), sub: t('qty') + ' ' + p.qty + ' × ' + inr(p.rate), value: money(p._due) })))
          : empty('box', t('paidInFull'))),
      h('p', { class: 'muted small' }, t('oldestFirstNote'))),
    actions: [{ label: t('settlePayment'), primary: true, onclick: (close) => { close(); settleSheet(v, 'vendor_due', { vendorId: row.id }, row.due); } }],
  });
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
