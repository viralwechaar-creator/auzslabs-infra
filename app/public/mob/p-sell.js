/* AUZsMob: New sale. Works fully offline: items/units come from the local IndexedDB catalog (kept fresh
   by sync.js), and checkout writes the sale locally first (optimistic, "Saved on phone") before queuing
   it to sync -- never claims it reached the server before it actually has. */
'use strict';
page('sell', { title: 'sell', perm: 'mob_sell', render: renderSell });

let cart = [];

async function renderSell(v) {
  if (v.args[0] === 'history') return renderSaleHistory(v);
  v.header({ title: t('sell'), actions: [{ label: t('saleHistory'), icon: 'wallet', run: () => go('sell/history') }] });
  const [items, units, movements, vendors] = await Promise.all([idbGetAll('items'), idbGetAll('units'), idbGetAll('stockMovements'), idbGetAll('vendors')]);
  // stock is only counted when the shop has Stock switched on, and never for service/repair items
  const tracked = (i) => feat('stock') && i.category !== 'service';
  // A vendor picker that also lets a staffer add a brand-new vendor right here, instead of
  // hiding the whole field whenever the shop has none yet (db/107's "price asked on every line"
  // promise was never kept for a shop with zero vendors -- the field just vanished).
  const ADD_VENDOR = '__add_vendor__';
  function vendorOptions() { return [['', t('vendorOptional')], ...vendors.map((x) => [x.id, x.name]), [ADD_VENDOR, S_LANG === 'hi' ? '+ नया वेंडर…' : '+ Add vendor…']]; }
  function vendorSelect(selected) {
    const s = selectEl(vendorOptions(), selected || '');
    s.onchange = () => {
      if (s.value !== ADD_VENDOR) return;
      const name = input({ value: '', label: t('name'), autofocus: true });
      const phone = input({ value: '', label: t('phone'), mode: 'tel' });
      sheet({
        title: t('add'), body: h('div', { class: 'grid' }, field(t('name'), name), field(t('phone'), phone)),
        actions: [{ label: t('save'), primary: true, onclick: async (close) => {
          if (!name.value.trim()) { fail(new Error(t('errNameRequired'))); return false; }
          const id = uid(), data = { name: name.value.trim(), phone: phone.value.trim() };
          await idbPut('vendors', { id, name: data.name, phone: data.phone, _pending: true });
          await outboxAdd('mob_save_vendor', { p_id: id, p: data, p_base: null });
          vendors.push({ id, name: data.name, phone: data.phone });
          s.innerHTML = ''; vendorOptions().forEach(([v, l]) => s.append(h('option', { value: v }, l))); s.value = id;
          close();
        } }],
        onClose: () => { if (s.value === ADD_VENDOR) s.value = ''; },
      });
    };
    return s;
  }
  const activeItems = items.filter((i) => i.active !== false);
  const available = units.filter((u) => u.status === 'in_stock');

  const results = h('div', { class: 'list', style: { marginTop: '10px' } });
  const cartBox = h('div', { class: 'grid' });
  function paintResults(q) {
    q = (q || '').toLowerCase().trim();
    clear(results);
    if (!q) return;
    const unitMatches = available.filter((u) => (u.imei || '').includes(q) || (u.imei2 || '').includes(q) || itemName(items, u.item_id).toLowerCase().includes(q)).slice(0, 8);
    const prodMatches = activeItems.filter((i) => (!i.serialized || !feat('serials')) && i.name.toLowerCase().includes(q)).slice(0, 8);
    unitMatches.forEach((u) => results.append(liRow({ icon: 'phone', title: itemName(items, u.item_id), sub: u.imei || u.imei2, value: money(u.selling_price || itemOf(items, u.item_id).selling_price), onclick: () => addUnit(u) })));
    prodMatches.forEach((i) => {
      const stock = computeStock(i.id);
      const inCart = cart.find((l) => l.itemId === i.id && !l.unitId);
      const left = stock - (inCart ? inCart.qty : 0);
      const oos = tracked(i) && left <= 0;
      results.append(liRow({ icon: 'box', title: i.name, sub: oos ? t('outOfStock') : tracked(i) ? qty(left) + ' ' + t('inStock').toLowerCase() : null, value: money(i.selling_price), onclick: oos ? null : () => addProduct(i) }));
    });
    // a staffer can log a brand-new item (a one-off accessory, a trade-in, anything never
    // catalogued) and sell it in the same step: quickAddSellSheet creates the item plus an
    // opening stock entry (same mechanism Add purchase's own "New: ..." quick-add uses), then
    // drops it straight into the cart.
    results.append(liRow({ icon: 'plus', title: (S_LANG === 'hi' ? 'नया: ' : 'New: ') + '"' + q + '"', onclick: () => quickAddSellSheet(q) }));
  }
  // movements is fetched once above, not re-pulled live -- a sale added to the cart this session is
  // reflected via the inCart subtraction in paintResults/addProduct, same as the server's own check
  // (mob_push_sale: sum(mob_stock_movements) must cover the qty being sold) so a staffer can never add
  // more of a loose-stock item to the cart than the shop actually has, whether or not it's serialized.
  function computeStock(itemId) { return movements.filter((m) => m.item_id === itemId).reduce((a, m) => a + N(m.qty), 0); }
  function itemOf(list, id) { return list.find((x) => x.id === id) || {}; }
  function itemName(list, id) { return itemOf(list, id).name || id; }

  const searchBox = searchField(t('findItem'), debounce((q) => paintResults(q), 120));

  // Every sale line asks for its price first (pre-filled with the catalogue price). It only changes THIS bill:
  // the catalogue price is untouched, so two staff can bill the same product at different prices. The vendor is
  // an optional note on the line (where this piece came from).
  function askPrice({ title, price, vendorId, cost, onDone }) {
    const pr = input({ value: price || '', label: t('sellPriceNow'), mode: 'decimal', autofocus: true });
    // Purchase price for this bill (the vendor may have raised it): only for people who may see purchase rates.
    const co = cost !== undefined && S.ctx.can_see_rates ? input({ value: cost === null ? '' : cost, label: t('costPriceNow'), mode: 'decimal' }) : null;
    const vend = feat('vendors') ? vendorSelect(vendorId) : null;
    sheet({
      title,
      body: h('div', { class: 'grid' }, field(t('sellPriceNow'), pr), co ? field(t('costPriceNow'), co) : null, h('div', { class: 'small muted' }, t(co ? 'sellCostHint' : 'sellPriceHint')), vend ? field(t('vendorOptional'), vend) : null),
      actions: [{ label: t('addToCart'), primary: true, onclick: async (close) => {
        const val = N(pr.value);
        if (pr.value.trim() === '' || !(val >= 0)) { fail(new Error(t('errPriceRequired'))); return false; }
        const cv = co && co.value.trim() !== '' ? N(co.value) : null;
        if (cv !== null && !(cv >= 0)) { fail(new Error(t('errPriceRequired'))); return false; }
        close(); onDone(val, vend ? vend.value || null : null, cv);
      } }],
    });
  }
  function addUnit(u) {
    if (cart.some((l) => l.unitId === u.id)) { toast(t('errAlreadySold')); return; }
    const name = itemName(items, u.item_id) + ' — ' + (u.imei || u.imei2);
    const listed = N(u.cost_price != null ? u.cost_price : itemOf(items, u.item_id).cost_price);
    askPrice({ title: name, price: N(u.selling_price || itemOf(items, u.item_id).selling_price) || '', cost: listed, onDone: (price, vendorId, cost) => {
      if (cart.some((l) => l.unitId === u.id)) return;
      cart.push({ unitId: u.id, itemId: u.item_id, name, qty: 1, price, vendorId, costListed: listed, cost: cost !== null && cost !== listed ? cost : null });
      paintCart();
    } });
  }
  function addProduct(i, fixed) {
    const put = (price, vendorId, cost) => {
      const inCart = cart.filter((l) => l.itemId === i.id && !l.unitId).reduce((a, l) => a + l.qty, 0);
      if (tracked(i) && inCart + 1 > computeStock(i.id)) { toast(t('errNotEnoughStock'), { err: true }); return; }
      const listed = N(i.cost_price), cv = cost !== undefined && cost !== null && cost !== listed ? cost : null;
      const row = cart.find((l) => l.itemId === i.id && !l.unitId && l.price === price && (l.vendorId || null) === (vendorId || null) && (l.cost ?? null) === cv);
      if (row) row.qty += 1; else cart.push({ itemId: i.id, name: i.name, qty: 1, price, vendorId, costListed: listed, cost: cv });
      paintCart();
    };
    if (fixed) return put(fixed.price, fixed.vendorId || null);
    const last = cart.filter((l) => l.itemId === i.id && !l.unitId).pop();
    askPrice({ title: i.name, price: last ? last.price : N(i.selling_price) || '', vendorId: last && last.vendorId, cost: last && last.cost != null ? last.cost : N(i.cost_price), onDone: put });
  }
  function editLine(l) {
    askPrice({ title: l.name, price: l.price, vendorId: l.vendorId, cost: l.service ? undefined : (l.cost != null ? l.cost : l.costListed), onDone: (price, vendorId, cost) => { l.price = price; l.vendorId = vendorId; l.cost = cost !== null && cost !== l.costListed ? cost : null; paintCart(); } });
  }

  // Creates a never-catalogued item plus an opening purchase/stock entry (qty = what the staffer
  // says is in hand), the same real mob_push_purchase path Add purchase uses -- so it still shows
  // up in Purchases/Reports with a real cost basis, not an untracked stock-less sale -- then adds
  // one straight to the cart. Needs mob_purchase or mob_sell (db/088: any staffer, not just a
  // manager, same trust Add purchase's own quick-add already had).
  function quickAddSellSheet(q) {
    const name = input({ value: q, label: t('itemName'), autofocus: true });
    const sellPrice = input({ value: '', label: t('sellingPrice'), mode: 'decimal' });
    const cost = input({ value: '', label: t('purchaseRate'), mode: 'decimal' });
    const onHand = input({ value: 1, label: t('qty'), mode: 'decimal' });
    const qvend = feat('vendors') ? vendorSelect('') : null;
    sheet({
      title: (S_LANG === 'hi' ? 'नया: ' : 'New: ') + '"' + q + '"',
      body: h('div', { class: 'grid' }, field(t('itemName'), name),
        h('div', { class: 'two' }, field(t('sellingPrice'), sellPrice), field(t('purchaseRate'), cost)),
        field(t('qty'), onHand), qvend ? field(t('vendorOptional'), qvend) : null),
      actions: [{ label: t('save'), primary: true, onclick: async (close) => {
        if (!name.value.trim()) { fail(new Error(t('errNameRequired'))); return false; }
        const itemId = uid();
        const haveQty = Math.max(1, N(onHand.value) || 1);
        const itemData = { name: name.value.trim(), category: 'other', serialized: false, sellingPrice: N(sellPrice.value), costPrice: N(cost.value) };
        const newItem = { id: itemId, name: itemData.name, category: 'other', serialized: false, selling_price: itemData.sellingPrice, cost_price: itemData.costPrice, low_stock_at: 0, active: true };
        await idbPut('items', { ...newItem, _pending: true });
        await outboxAdd('mob_save_item', { p_id: itemId, p: itemData, p_base: null });
        items.push(newItem);
        activeItems.push(newItem);

        const pid = uid();
        const now = new Date().toISOString();
        const vendorId = qvend ? qvend.value || null : null;
        const purchaseArgs = { itemId, vendorId, qty: haveQty, rate: itemData.costPrice, imei: null, sellingPrice: itemData.sellingPrice, unitId: null };
        const movement = { id: uid(), item_id: itemId, unit_id: null, qty: haveQty, type: 'purchase', ref_id: pid, staff_id: S.user.id, created_at: now };
        if (feat('stock')) { await idbPut('stockMovements', movement); movements.push(movement); }
        await localPush('purchases', { id: pid, item_id: itemId, vendor_id: vendorId, qty: haveQty, rate: itemData.costPrice, total: haveQty * itemData.costPrice, staff_id: S.user.id, created_at: now }, 'mob_push_purchase', { p_id: pid, p: purchaseArgs });

        close();
        addProduct(newItem, { price: itemData.sellingPrice, vendorId });
      } }],
    });
  }

  const custName = input({ placeholder: t('customerOptional') });
  const custPhone = input({ placeholder: t('phone'), mode: 'tel' });
  const discount = input({ value: 0, label: t('discount'), mode: 'decimal' });
  const payMethod = selectEl([['cash', t('cash')], ['upi', t('upi')], ['card', t('card')], ...(feat('customers') ? [['credit', t('credit')]] : [])], 'cash');
  const totalsBox = h('div', { class: 'card' });
  const checkoutBtn = h('button', { class: 'btn fill wide', type: 'button', disabled: true }, t('checkout'));
  const checkoutSection = section(t('customer'), feat('customers') ? h('div', { class: 'two' }, field(t('customer'), custName), field(t('phone'), custPhone)) : null,
    h('div', { class: 'two' }, field(t('discount'), discount), field(t('paymentMode'), payMethod)), totalsBox, checkoutBtn);

  function paintCart() {
    clear(cartBox);
    checkoutSection.classList.toggle('hidden', !cart.length);
    if (!cart.length) { cartBox.append(empty('cash', t('cartEmpty'))); checkoutBtn.disabled = true; paintTotals(); return; }
    checkoutBtn.disabled = false;
    cartBox.append(h('div', { class: 'list' }, cart.map((l, i) => liRow({ icon: l.unitId ? 'phone' : 'box', title: l.name, sub: (l.unitId ? '' : t('qty') + ' ' + l.qty + ' × ') + inr(l.price) + (l.cost != null ? ' · ' + t('costShort') + ' ' + inr(l.cost) : '') + (l.vendorId ? ' · ' + ((vendors.find((x) => x.id === l.vendorId) || {}).name || '') : ''), value: money(l.price * l.qty),
      right: h('span', { class: 'row', style: { gap: '2px' } }, h('button', { class: 'btn plain icon sm', type: 'button', 'aria-label': t('sellPriceNow'), onclick: () => editLine(l) }, icon('edit', 16)), h('button', { class: 'btn plain icon sm', type: 'button', 'aria-label': 'x', onclick: () => { cart.splice(i, 1); paintCart(); } }, icon('x', 16))) }))));
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
    const args = { items: cart.map((l) => ({ unitId: l.unitId, itemId: l.itemId, name: l.name, qty: l.qty, price: l.price, ...(l.vendorId && !l.service ? { vendorId: l.vendorId } : {}), ...(l.cost != null && !l.service ? { costOverride: l.cost } : {}), ...(l.service ? { partCost: l.partCost, partName: l.partName, vendorId: l.vendorId || null } : {}) })), customerName: feat('customers') ? custName.value.trim() : '', customerPhone: feat('customers') ? custPhone.value.trim() : '', discount: N(discount.value), paid: Math.max(0, subtotal), paymentMode: payMethod.value };
    const localRow = { id, tenant_id: null, bill_no: null, customer_name: args.customerName, customer_phone: args.customerPhone, items: args.items.map((l) => ({ ...l, costPrice: l.costOverride != null ? l.costOverride : 0 })), subtotal, discount: N(discount.value), total: Math.max(0, subtotal), paid: args.paid, balance: 0, payment_mode: payMethod.value, voided: false, staff_id: S.user.id, created_at: new Date().toISOString() };
    // optimistic local stock move so the next search doesn't offer an already-sold unit before syncing
    for (const l of cart) if (l.unitId) { const u = units.find((x) => x.id === l.unitId); if (u) { u.status = 'sold'; await idbPut('units', u); } }
    await localPush('sales', localRow, 'mob_push_sale', { p_id: id, p: args });
    cart = [];
    await alertBox({ title: t('saleComplete'), message: t('savedOnPhone'), cancel: false });
    v.refresh();
  };

  // Simple repairs: a repair is just a sale line (what you charged) with the cost of the part you bought for it.
  function serviceSheet() {
    const desc = input({ value: '', label: t('repairWhat'), autofocus: true });
    const charge = input({ value: '', label: t('repairCharge'), mode: 'decimal' });
    const part = input({ value: '', label: t('partCost'), mode: 'decimal' });
    const vend = feat('vendors') ? vendorSelect('') : null;
    sheet({
      title: t('repairService'),
      body: h('div', { class: 'grid' }, field(t('repairWhat'), desc), h('div', { class: 'two' }, field(t('repairCharge'), charge), field(t('partCost'), part)), vend ? field(t('partFrom'), vend) : null),
      actions: [{ label: t('addToCart'), primary: true, onclick: async (close) => {
        if (!desc.value.trim() || !(N(charge.value) > 0)) { fail(new Error(t('errNameRequired'))); return false; }
        let svc = items.find((i) => i.category === 'service' && i.active !== false);
        if (!svc) {
          const sid = uid();
          const data = { name: 'Repair / service', category: 'service', serialized: false, sellingPrice: 0, costPrice: 0 };
          svc = { id: sid, name: data.name, category: 'service', serialized: false, selling_price: 0, cost_price: 0, low_stock_at: 0, active: true };
          await idbPut('items', { ...svc, _pending: true });
          await outboxAdd('mob_save_item', { p_id: sid, p: data, p_base: null });
          items.push(svc);
        }
        cart.push({ itemId: svc.id, name: desc.value.trim(), qty: 1, price: N(charge.value), service: true, partCost: N(part.value), partName: desc.value.trim(), vendorId: vend ? vend.value || null : null });
        close(); paintCart();
      } }],
    });
  }
  const serviceBtn = repairsMode() === 'simple' ? h('button', { class: 'btn wide', type: 'button', style: { marginTop: '8px' }, onclick: serviceSheet }, icon('wrench', 18), t('repairService')) : null;

  add(v.root, [
    section(t('findItem'), searchBox, serviceBtn, results),
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

// Opens WhatsApp with the bill text ready to send (the cashier taps Send). Free: no WhatsApp Business account needed.
function waBillText(s) {
  const st = (S.ctx && S.ctx.settings) || {};
  const lines = [(st.shopName || '') + (st.address ? ', ' + st.address : ''), t('bill') + ' ' + (s.bill_no || '')].filter(Boolean);
  (s.items || []).forEach((it) => lines.push(it.name + ' x' + it.qty + '  ' + inr(it.price * it.qty)));
  lines.push(t('total') + ': ' + inr(s.total));
  if (st.billFooter) lines.push(st.billFooter); else lines.push(t('thankYou'));
  return lines.join('\n');
}
function waShareSale(s) {
  let d = String(s.customer_phone || '').replace(/\D/g, ''); if (d.length === 10) d = '91' + d;
  window.open('https://wa.me/' + d + '?text=' + encodeURIComponent(waBillText(s)), '_blank');
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
    actions: [!s.voided ? { label: t('shareWhatsApp'), onclick: async () => { waShareSale(s); return false; } } : null].concat(can('mob_manage') && !s.voided ? [{ label: t('voidSale'), danger: true, onclick: async (close) => {
      const ok = await confirmBox(t('voidSale'), t('confirmVoid'), t('voidSale'), true);
      if (!ok) return false;
      await api('mob_void_sale', { p_sale_id: s.id, p_reason: null });
      s.voided = true; await idbPut('sales', s);
      toast(t('saved')); close(); v.refresh();
    } }] : []),
  });
}
