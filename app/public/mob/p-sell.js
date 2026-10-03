/* AUZsMob: New sale. Works fully offline: items/units come from the local IndexedDB catalog (kept fresh
   by sync.js), and checkout writes the sale locally first (optimistic, "Saved on phone") before queuing
   it to sync -- never claims it reached the server before it actually has. */
'use strict';
page('sell', { title: 'sell', perm: 'mob_sell', render: renderSell });

let cart = [];

async function renderSell(v) {
  if (v.args[0] === 'history') return renderSaleHistory(v);
  v.header({ title: t('sell'), actions: [{ label: t('saleHistory'), icon: 'wallet', run: () => go('sell/history') }] });
  const [items, units] = await Promise.all([idbGetAll('items'), idbGetAll('units')]);
  const activeItems = items.filter((i) => i.active !== false);
  const available = units.filter((u) => u.status === 'in_stock');

  const results = h('div', { class: 'list', style: { marginTop: '10px' } });
  const cartBox = h('div', { class: 'grid' });
  function paintResults(q) {
    q = (q || '').toLowerCase().trim();
    clear(results);
    if (!q) return;
    const unitMatches = available.filter((u) => (u.imei || '').includes(q) || (u.imei2 || '').includes(q) || itemName(items, u.item_id).toLowerCase().includes(q)).slice(0, 8);
    const prodMatches = activeItems.filter((i) => !i.serialized && i.name.toLowerCase().includes(q)).slice(0, 8);
    if (!unitMatches.length && !prodMatches.length) { results.append(h('div', { class: 'li' }, h('div', { class: 's grow' }, t('noneYet')))); return; }
    unitMatches.forEach((u) => results.append(liRow({ icon: 'phone', title: itemName(items, u.item_id), sub: u.imei || u.imei2, value: money(u.selling_price || itemOf(items, u.item_id).selling_price), onclick: () => addUnit(u) })));
    prodMatches.forEach((i) => results.append(liRow({ icon: 'box', title: i.name, sub: qty(computeStock(i.id)) + ' ' + t('inStock').toLowerCase(), value: money(i.selling_price), onclick: () => addProduct(i) })));
  }
  function computeStock(itemId) { return movements.filter((m) => m.item_id === itemId).reduce((a, m) => a + N(m.qty), 0); }
  function itemOf(list, id) { return list.find((x) => x.id === id) || {}; }
  function itemName(list, id) { return itemOf(list, id).name || id; }

  const searchBox = searchField(t('findItem'), debounce((q) => paintResults(q), 120));

  function addUnit(u) {
    if (cart.some((l) => l.unitId === u.id)) { toast(t('errAlreadySold')); return; }
    cart.push({ unitId: u.id, itemId: u.item_id, name: itemName(items, u.item_id) + ' — ' + (u.imei || u.imei2), qty: 1, price: N(u.selling_price || itemOf(items, u.item_id).selling_price) });
    paintCart();
  }
  function addProduct(i) {
    const row = cart.find((l) => l.itemId === i.id && !l.unitId);
    if (row) row.qty += 1; else cart.push({ itemId: i.id, name: i.name, qty: 1, price: N(i.selling_price) });
    paintCart();
  }

  const custName = input({ placeholder: t('customerOptional') });
  const custPhone = input({ placeholder: t('phone'), mode: 'tel' });
  const discount = input({ value: 0, label: t('discount'), mode: 'decimal' });
  const payMethod = selectEl([['cash', t('cash')], ['upi', t('upi')], ['card', t('card')], ['credit', t('credit')]], 'cash');
  const totalsBox = h('div', { class: 'card' });
  const checkoutBtn = h('button', { class: 'btn fill wide', type: 'button', disabled: true }, t('checkout'));
  const checkoutSection = section(t('customer'), h('div', { class: 'two' }, field(t('customer'), custName), field(t('phone'), custPhone)),
    h('div', { class: 'two' }, field(t('discount'), discount), field(t('paymentMode'), payMethod)), totalsBox, checkoutBtn);

  function paintCart() {
    clear(cartBox);
    checkoutSection.classList.toggle('hidden', !cart.length);
    if (!cart.length) { cartBox.append(empty('cash', t('cartEmpty'))); checkoutBtn.disabled = true; paintTotals(); return; }
    checkoutBtn.disabled = false;
    cartBox.append(h('div', { class: 'list' }, cart.map((l, i) => liRow({ icon: l.unitId ? 'phone' : 'box', title: l.name, sub: l.unitId ? null : t('qty') + ' ' + l.qty, value: money(l.price * l.qty),
      right: h('button', { class: 'btn plain icon sm', type: 'button', 'aria-label': 'x', onclick: () => { cart.splice(i, 1); paintCart(); } }, icon('x', 16)) }))));
    paintTotals();
  }
  function paintTotals() {
    const subtotal = cart.reduce((a, l) => a + l.price * l.qty, 0) - N(discount.value);
    clear(totalsBox).append(h('div', { class: 'row sp' }, h('b', null, t('total')), h('b', null, money(Math.max(0, subtotal)))));
  }
  discount.oninput = paintTotals;

  checkoutBtn.onclick = async () => {
    if (!cart.length) return;
    checkoutBtn.disabled = true;
    const id = uid();
    const subtotal = cart.reduce((a, l) => a + l.price * l.qty, 0) - N(discount.value);
    const args = { items: cart.map((l) => ({ unitId: l.unitId, itemId: l.itemId, name: l.name, qty: l.qty, price: l.price })), customerName: custName.value.trim(), customerPhone: custPhone.value.trim(), discount: N(discount.value), paid: Math.max(0, subtotal), paymentMode: payMethod.value };
    const localRow = { id, tenant_id: null, bill_no: null, customer_name: args.customerName, customer_phone: args.customerPhone, items: args.items.map((l) => ({ ...l, costPrice: 0 })), subtotal, discount: N(discount.value), total: Math.max(0, subtotal), paid: args.paid, balance: 0, payment_mode: payMethod.value, voided: false, staff_id: S.user.id, created_at: new Date().toISOString() };
    // optimistic local stock move so the next search doesn't offer an already-sold unit before syncing
    for (const l of cart) if (l.unitId) { const u = units.find((x) => x.id === l.unitId); if (u) { u.status = 'sold'; await idbPut('units', u); } }
    await localPush('sales', localRow, 'mob_push_sale', { p_id: id, p: args });
    cart = [];
    await alertBox({ title: t('saleComplete'), message: t('savedOnPhone'), cancel: false });
    v.refresh();
  };

  add(v.root, [
    section(t('findItem'), searchBox, results),
    section(t('cart'), cartBox),
    checkoutSection,
  ]);
  paintCart();
}

async function renderSaleHistory(v) {
  v.header({ title: t('saleHistory'), back: 'sell' });
  const sales = (await idbGetAll('sales')).filter((s) => can('mob_reports') || s.staff_id === S.user.id).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  v.root.append(dataView(
    [{ key: 'inv', title: true, label: '', render: (r) => (r.bill_no || '…') + (r.voided ? ' (' + t('voided') + ')' : '') },
      { key: 'cust', sub: true, label: '', render: (r) => r.customer_name || 'Walk-in' },
      { key: 'total', value: true, r: true, label: '', render: (r) => money(r.total) }],
    sales, { onRow: (r) => saleDetailSheet(v, r), emptyText: t('noneYet') },
  ));
}

function saleDetailSheet(v, s) {
  sheet({
    title: s.bill_no || t('sell'),
    body: h('div', { class: 'grid' },
      s.voided ? banner('bad', 'alert', t('voided')) : null,
      h('div', { class: 'list' }, (s.items || []).map((it) => liRow({ icon: it.unitId ? 'phone' : 'box', title: it.name, sub: t('qty') + ' ' + it.qty, value: money(it.price * it.qty) }))),
      h('div', { class: 'card' }, h('div', { class: 'row sp' }, h('b', null, t('total')), h('b', null, money(s.total)))),
      s.customer_name ? h('div', { class: 'small muted' }, s.customer_name + (s.customer_phone ? ' · ' + s.customer_phone : '')) : null,
    ),
    actions: can('mob_manage') && !s.voided ? [{ label: t('voidSale'), danger: true, onclick: async (close) => {
      const ok = await confirmBox(t('voidSale'), t('confirmVoid'), t('voidSale'), true);
      if (!ok) return false;
      await api('mob_void_sale', { p_sale_id: s.id, p_reason: null });
      s.voided = true; await idbPut('sales', s);
      toast(t('saved')); close(); v.refresh();
    } }] : [],
  });
}
