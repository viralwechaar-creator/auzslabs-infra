/* AUZsMob: Add purchase/part (section 3a, the core quick entry) and Buy used phone (section 3d). Both
   write locally first via localPush, so they work with no internet (section 2). */
'use strict';
page('purchase', { title: 'purchase', perm: 'mob_purchase', render: renderPurchase });

async function renderPurchase(v) {
  if (v.args[0] === 'used') return renderBuyUsed(v);
  v.header({ title: t('addPurchase') });
  const [items, vendors] = await Promise.all([idbGetAll('items'), idbGetAll('vendors')]);
  const activeItems = items.filter((i) => i.active !== false);

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
  function pickItem(i) { pickedItem = i; clear(itemResults); itemSearch.input.value = ''; clear(pickedBox).append(liRow({ icon: 'box', title: i.name, right: h('button', { class: 'btn plain sm', type: 'button', onclick: () => { pickedItem = null; clear(pickedBox); saveBtn.classList.add('hidden'); } }, t('cancel')) })); paintFields(); saveBtn.classList.remove('hidden'); }

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

  const saveBtn = h('button', { class: 'btn fill wide', type: 'button' }, t('save'));
  saveBtn.onclick = async () => {
    if (!pickedItem) { fail(new Error(t('errNameRequired'))); return; }
    saveBtn.disabled = true;
    try {
      const itemId = pickedItem.id;
      if (pickedItem._new) {
        await localSaveItem(itemId, { name: pickedItem.name, category: 'other', serialized: serialSw.checked, sellingPrice: N(sellPrice.value), costPrice: N(rate.value) });
      }
      let vendorId = feat('vendors') ? (vendorSel.value || null) : null;
      if (feat('vendors') && !vendorId && newVendor.value.trim()) { vendorId = uid(); await localSaveVendor(vendorId, { name: newVendor.value.trim() }); }
      const pid = uid();
      const unitId = feat('serials') && serialSw.checked ? uid() : null;
      const args = { itemId, vendorId, qty: N(qtyI.value) || 1, rate: N(rate.value), imei: unitId ? imeiI.value.trim() || null : null, sellingPrice: sellPrice.value ? N(sellPrice.value) : null, unitId };
      // mirror mob_push_purchase locally so a just-bought serialized phone can be sold offline right away,
      // instead of only becoming sellable after a round trip through mob_sync_pull
      const now = new Date().toISOString();
      if (unitId) {
        await idbPut('units', { id: unitId, item_id: itemId, imei: args.imei, imei2: null, source: 'new', condition: null, seller_name: null, seller_phone: null, id_proof_url: null, accessories_included: null, cost_price: args.rate, selling_price: args.sellingPrice, status: 'in_stock', created_at: now, updated_at: now });
        await idbPut('stockMovements', { id: uid(), item_id: itemId, unit_id: unitId, qty: 1, type: 'purchase', ref_id: pid, staff_id: S.user.id, created_at: now });
      } else if (feat('stock')) {
        await idbPut('stockMovements', { id: uid(), item_id: itemId, unit_id: null, qty: args.qty, type: 'purchase', ref_id: pid, staff_id: S.user.id, created_at: now });
      }
      await localPush('purchases', { id: pid, item_id: itemId, vendor_id: vendorId, qty: args.qty, rate: args.rate, total: args.qty * args.rate, staff_id: S.user.id, created_at: now }, 'mob_push_purchase', { p_id: pid, p: args });
      toast(t('purchaseSaved'));
      go('home');
    } catch (e) { fail(e); } finally { saveBtn.disabled = false; }
  };

  saveBtn.classList.add('hidden');
  v.root.append(
    section(t('itemName'), itemSearch, itemResults, pickedBox),
    fieldsBox,
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
