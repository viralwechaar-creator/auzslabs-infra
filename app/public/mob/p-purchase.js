/* AUZsMob: Add purchase/part (section 3a, the core quick entry) and Buy used phone (section 3d). Both
   write locally first via localPush, so they work with no internet (section 2). */
'use strict';
page('purchase', { title: 'purchase', perm: 'mob_purchase', render: renderPurchase });

async function renderPurchase(v) {
  if (v.args[0] === 'used') return renderBuyUsed(v);
  if (v.args[0] === 'history') return renderPurchaseHistory(v);
  v.header({ title: t('addPurchase'), actions: can('mob_manage') ? [{ label: t('purchaseHistory'), icon: 'wallet', run: () => go('purchase/history') }] : [] });
  const [items, vendors] = await Promise.all([idbGetAll('items'), idbGetAll('vendors')]);
  const activeItems = items.filter((i) => i.active !== false);
  // A whole bill can hold several different items now (owner request: purchase used to force one item
  // per bill, save, start over) -- each stays its own mob_purchases row server-side (the schema is
  // already append-only per item, db/080's own design), the UI just lets several be queued up locally
  // and submitted together with one tap, same cart-then-checkout shape Sell already uses.
  const cart = [];

  let pickedItem = null;
  const itemSearch = searchField(t('itemName'), debounce((q) => paintItemResults(q), 100));
  const itemResults = h('div', { class: 'list', style: { marginTop: '8px' } });
  const pickedBox = h('div');
  function paintItemResults(raw) {
    const q = (raw || '').trim(); clear(itemResults);
    if (!q) return;
    const ql = q.toLowerCase();
    const matches = activeItems.filter((i) => i.name.toLowerCase().includes(ql)).slice(0, 6);
    matches.forEach((i) => itemResults.append(liRow({ icon: 'box', title: i.name, sub: i.category, onclick: () => pickItem(i) })));
    itemResults.append(liRow({ icon: 'plus', title: (S_LANG === 'hi' ? 'नया: ' : 'New: ') + '"' + q + '"', onclick: () => pickItem({ id: uid(), name: q, category: 'other', serialized: false, _new: true }) }));
  }
  function pickItem(i) { pickedItem = i; clear(itemResults); itemSearch.input.value = ''; clear(pickedBox).append(liRow({ icon: 'box', title: i.name, right: h('button', { class: 'btn plain sm', type: 'button', onclick: () => { pickedItem = null; clear(pickedBox); addBtn.classList.add('hidden'); } }, t('cancel')) })); paintFields(); addBtn.classList.remove('hidden'); }

  const vendorSel = selectEl([['', t('vendor') + '…'], ...vendors.map((x) => [x.id, x.name])], '');
  const newVendor = input({ placeholder: t('vendor') });
  const rate = input({ value: '', label: t('purchaseRate'), mode: 'decimal' });
  const sellPrice = input({ value: '', label: t('sellingPrice'), mode: 'decimal' });
  const qtyI = input({ value: 1, label: t('qty'), mode: 'decimal' });
  const serialSw = h('input', { type: 'checkbox', role: 'switch' });
  const imeiI = input({ value: '', label: t('serialNo') });
  const fieldsBox = h('div', { class: 'grid' });
  function paintFields() {
    if (!pickedItem) { clear(fieldsBox); return; }
    serialSw.checked = feat('serials') && !!pickedItem.serialized;
    const serialRow = h('div', { class: 'li', style: { cursor: 'pointer' } }, h('div', { class: 'grow' }, h('div', { class: 't' }, t('serialized'))), h('span', { class: 'switch' }, serialSw));
    const imeiField = h('div', { class: serialSw.checked ? '' : 'hidden' }, field(t('serialNo'), imeiI));
    serialSw.onchange = () => { imeiField.classList.toggle('hidden', !serialSw.checked); };
    clear(fieldsBox).append(
      feat('vendors') ? h('div', { class: 'two' }, field(t('vendor'), vendorSel), field(t('vendor'), newVendor, (S_LANG === 'hi' ? 'या नया नाम लिखें' : 'or type a new one'))) : null,
      h('div', { class: 'two' }, field(t('purchaseRate'), rate), field(t('sellingPrice'), sellPrice)),
      field(t('qty'), qtyI),
      feat('serials') ? serialRow : null, feat('serials') ? imeiField : null,
    );
  }

  const cartBox = h('div', { class: 'list' });
  function paintCart() {
    clear(cartBox);
    cart.forEach((l, i) => cartBox.append(liRow({ icon: 'box', title: l.name, sub: t('qty') + ' ' + l.qty + ' × ' + inr(l.rate), value: money(l.qty * l.rate),
      right: h('button', { class: 'btn plain icon sm', type: 'button', 'aria-label': 'x', onclick: () => { cart.splice(i, 1); paintCart(); } }, icon('x', 16)) })));
    saveBtn.classList.toggle('hidden', !cart.length);
  }

  const addBtn = h('button', { class: 'btn wide', type: 'button' }, t('addToPurchase'));
  addBtn.onclick = () => {
    if (!pickedItem) { fail(new Error(t('errNameRequired'))); return; }
    cart.push({ item: pickedItem, vendorId: feat('vendors') ? (vendorSel.value || null) : null, newVendorName: feat('vendors') ? newVendor.value.trim() : '',
      name: pickedItem.name, rate: N(rate.value), sellPrice: sellPrice.value ? N(sellPrice.value) : null, qty: N(qtyI.value) || 1,
      serialized: feat('serials') && serialSw.checked, imei: imeiI.value.trim() || null });
    pickedItem = null; clear(pickedBox); addBtn.classList.add('hidden'); clear(fieldsBox);
    vendorSel.value = ''; newVendor.value = ''; rate.value = ''; sellPrice.value = ''; qtyI.value = 1; serialSw.checked = false; imeiI.value = '';
    paintCart();
  };

  const saveBtn = h('button', { class: 'btn fill wide', type: 'button' }, t('savePurchase'));
  saveBtn.onclick = async () => {
    if (!cart.length) return;
    saveBtn.disabled = true;
    try {
      for (const l of cart) {
        const itemId = l.item.id;
        if (l.item._new) await localSaveItem(itemId, { name: l.item.name, category: 'other', serialized: l.serialized, sellingPrice: l.sellPrice, costPrice: l.rate });
        let vendorId = l.vendorId;
        if (feat('vendors') && !vendorId && l.newVendorName) { vendorId = uid(); await localSaveVendor(vendorId, { name: l.newVendorName }); }
        const pid = uid();
        const unitId = l.serialized ? uid() : null;
        const args = { itemId, vendorId, qty: l.qty, rate: l.rate, imei: unitId ? l.imei : null, sellingPrice: l.sellPrice, unitId };
        // mirror mob_push_purchase locally so a just-bought serialized phone can be sold offline right
        // away, instead of only becoming sellable after a round trip through mob_sync_pull
        const now = new Date().toISOString();
        if (unitId) {
          await idbPut('units', { id: unitId, item_id: itemId, imei: args.imei, imei2: null, source: 'new', condition: null, seller_name: null, seller_phone: null, id_proof_url: null, accessories_included: null, cost_price: args.rate, selling_price: args.sellingPrice, status: 'in_stock', created_at: now, updated_at: now });
          await idbPut('stockMovements', { id: uid(), item_id: itemId, unit_id: unitId, qty: 1, type: 'purchase', ref_id: pid, staff_id: S.user.id, created_at: now });
        } else if (feat('stock')) {
          await idbPut('stockMovements', { id: uid(), item_id: itemId, unit_id: null, qty: args.qty, type: 'purchase', ref_id: pid, staff_id: S.user.id, created_at: now });
        }
        await localPush('purchases', { id: pid, item_id: itemId, vendor_id: vendorId, qty: args.qty, rate: args.rate, total: args.qty * args.rate, staff_id: S.user.id, created_at: now }, 'mob_push_purchase', { p_id: pid, p: args });
      }
      toast(t('purchaseSaved'));
      go('home');
    } catch (e) { fail(e); } finally { saveBtn.disabled = false; }
  };

  addBtn.classList.add('hidden');
  saveBtn.classList.add('hidden');
  v.root.append(
    section(t('itemName'), itemSearch, itemResults, pickedBox),
    fieldsBox,
    addBtn,
    section(t('purchase'), cartBox),
    saveBtn,
  );
}

async function localSaveItem(id, data) {
  await idbPut('items', { id, name: data.name, category: data.category, serialized: !!data.serialized, selling_price: N(data.sellingPrice), cost_price: N(data.costPrice), low_stock_at: N(data.lowStockAt || 0), active: true, _pending: true });
  await outboxAdd('mob_save_item', { p_id: id, p: data, p_base: null });
}
async function localSaveVendor(id, data) {
  await idbPut('vendors', { id, name: data.name, phone: data.phone || null, _pending: true });
  await outboxAdd('mob_save_vendor', { p_id: id, p: data, p_base: null });
}

async function renderBuyUsed(v) {
  v.header({ title: t('buyUsed'), back: 'home' });
  const items = (await idbGetAll('items')).filter((i) => i.category === 'phone_used' || i.category === 'phone_new');
  let modelId = items[0] ? items[0].id : null;
  const modelSearch = selectEl(items.length ? items.map((i) => [i.id, i.name]) : [['', (S_LANG === 'hi' ? 'पहले एक फ़ोन मॉडल बनाएं' : 'Create a phone model first')]], modelId, { onchange: (e) => { modelId = e.target.value; } });
  const sellerName = input({ label: t('sellerName'), autofocus: true });
  const sellerPhone = input({ label: t('sellerPhone'), mode: 'tel' });
  const imei = input({ label: t('serialNo') });
  const condition = selectEl([['new', t('conditionNew')], ['good', t('conditionGood')], ['fair', t('conditionFair')], ['poor', t('conditionPoor')]], 'good');
  const price = input({ value: '', label: t('pricePaid'), mode: 'decimal' });
  const accessories = input({ label: t('accessoriesIncluded') });

  const saveBtn = h('button', { class: 'btn fill wide', type: 'button' }, t('save'));
  saveBtn.onclick = async () => {
    if (!modelId || !imei.value.trim()) { fail(new Error(t('errNameRequired'))); return; }
    saveBtn.disabled = true;
    try {
      const pid = uid();
      const unitId = uid();
      const args = { itemId: modelId, qty: 1, rate: N(price.value), source: 'secondhand', imei: imei.value.trim(), condition: condition.value, sellerName: sellerName.value.trim(), sellerPhone: sellerPhone.value.trim(), accessoriesIncluded: accessories.value.trim(), unitId };
      const now = new Date().toISOString();
      await idbPut('units', { id: unitId, item_id: modelId, imei: args.imei, imei2: null, source: 'secondhand', condition: args.condition, seller_name: args.sellerName, seller_phone: args.sellerPhone, id_proof_url: null, accessories_included: args.accessoriesIncluded, cost_price: args.rate, selling_price: null, status: 'in_stock', created_at: now, updated_at: now });
      await idbPut('stockMovements', { id: uid(), item_id: modelId, unit_id: unitId, qty: 1, type: 'secondhand_intake', ref_id: pid, staff_id: S.user.id, created_at: now });
      await localPush('purchases', { id: pid, item_id: modelId, qty: 1, rate: N(price.value), total: N(price.value), staff_id: S.user.id, created_at: now }, 'mob_push_purchase', { p_id: pid, p: args });
      toast(t('purchaseSaved'));
      go('home');
    } catch (e) { fail(e); } finally { saveBtn.disabled = false; }
  };

  v.root.append(
    section(t('device'), field(t('deviceModel'), modelSearch)),
    section(t('buyUsed'),
      h('div', { class: 'two' }, field(t('sellerName'), sellerName), field(t('sellerPhone'), sellerPhone)),
      field(t('serialNo'), imei),
      h('div', { class: 'two' }, field(t('condition'), condition), field(t('pricePaid'), price)),
      field(t('accessoriesIncluded'), accessories),
      banner('info', 'info', t('duplicateImei')),
    ),
    saveBtn,
  );
}

async function renderPurchaseHistory(v) {
  const [purchases, items, vendors] = await Promise.all([idbGetAll('purchases'), idbGetAll('items'), idbGetAll('vendors')]);
  const sorted = purchases.filter((p) => can('mob_reports') || p.staff_id === S.user.id).sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
  const nameOf = (id) => (items.find((i) => i.id === id) || {}).name || '';
  const vendorOf = (id) => (vendors.find((x) => x.id === id) || {}).name || '';
  function detail(p) {
    sheet({
      title: nameOf(p.item_id) || t('addPurchase'),
      body: h('div', { class: 'grid' },
        p.voided ? banner('bad', 'alert', t('voided')) : null,
        h('div', { class: 'list' },
          liRow({ icon: 'box', title: nameOf(p.item_id), sub: t('qty') + ' ' + p.qty + ' × ' + inr(p.rate), value: money(p.total) }),
          p.vendor_id ? liRow({ title: t('vendorOptional'), value: vendorOf(p.vendor_id) }) : null,
          p.note ? liRow({ title: t('note'), value: p.note }) : null),
      ),
      actions: can('mob_manage') && !p.voided ? [{ label: t('voidPurchase'), danger: true, onclick: async (close) => {
        const ok = await confirmBox(t('voidPurchase'), t('confirmVoid'), t('voidPurchase'), true);
        if (!ok) return false;
        await api('mob_void_purchase', { p_purchase_id: p.id, p_reason: null });
        p.voided = true; await idbPut('purchases', p);
        toast(t('saved')); close(); v.refresh();
      } }] : [],
    });
  }
  voidableHistory(v, {
    title: t('purchaseHistory'), back: 'purchase', canVoid: can('mob_manage'),
    rows: () => sorted, idOf: (r) => r.id, isVoided: (r) => r.voided,
    lineFor: (r) => ({ title: nameOf(r.item_id) + (r.voided ? ' (' + t('voided') + ')' : ''), sub: vendorOf(r.vendor_id) || (t('qty') + ' ' + r.qty), value: money(r.total) }),
    onOpen: detail,
    rpcBulk: 'mob_void_purchases_bulk', idsParam: 'p_purchase_ids', confirmKey: 'confirmBulkVoidPurchase',
    applyVoided: async (id) => { const r = sorted.find((p) => p.id === id); if (r) { r.voided = true; await idbPut('purchases', r); } },
  });
}
