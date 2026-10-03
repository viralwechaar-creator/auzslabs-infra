/* AUZsMob: Stock. Catalog + IMEI/serial units + vendors, all read from the local IndexedDB copy. Staff
   see quantities and selling prices always; purchase rates only when the owner's switch allows it. */
'use strict';
page('stock', { title: 'stock', perm: 'mob_view', render: renderStock });

async function renderStock(v) {
  const tab = v.args[0] || 'catalog';
  v.header({ title: t('stock'), actions: can('mob_manage') ? [tab === 'units' ? null : tab === 'vendors' ? { label: t('add'), icon: 'plus', primary: true, run: () => vendorSheet(v) } : { label: t('addItem'), icon: 'plus', primary: true, run: () => itemSheet(v) }] : [] });
  v.root.append(seg([['catalog', t('catalog')], ['units', t('units')], ['vendors', t('vendors')]], tab, (tb) => go('stock/' + tb), { full: !isDesk() }));
  const body = h('div', { style: { marginTop: '16px' } });
  v.root.append(body);
  if (tab === 'units') await renderUnits(body, v);
  else if (tab === 'vendors') await renderVendors(body, v);
  else await renderCatalog(body, v);
}

async function renderCatalog(body, v) {
  const [items, movements] = await Promise.all([idbGetAll('items'), idbGetAll('stockMovements')]);
  const stockOf = (id) => movements.filter((m) => m.item_id === id).reduce((a, m) => a + N(m.qty), 0);
  const canSeeRate = S.ctx.can_see_rates;
  add(body, [dataView(
    [{ key: 'name', title: true, label: '', render: (r) => r.name },
      { key: 'cat', sub: true, label: '', render: (r) => t('cat' + catKey(r.category)) },
      { key: 'stock', value: true, r: true, label: '', render: (r) => r.serialized ? badge(t('units')) : (stockOf(r.id) <= N(r.low_stock_at) ? badge(qty(stockOf(r.id)), 'red') : qty(stockOf(r.id))) },
      { key: 'price', value: true, r: true, label: '', render: (r) => canSeeRate ? h('span', null, money(r.selling_price), ' / ', money(r.cost_price)) : money(r.selling_price) }],
    items.filter((i) => i.active !== false), { onRow: can('mob_manage') ? (r) => itemSheet(v, r) : null, emptyText: t('noneYet') },
  )]);
}
function catKey(c) { return { phone_new: 'PhoneNew', phone_used: 'PhoneUsed', accessory: 'Accessory', watch: 'Watch', earbuds: 'Earbuds', headphone: 'Headphone', cable: 'Cable', charger: 'Charger', other: 'Other' }[c] || 'Other'; }

async function renderUnits(body, v) {
  const [units, items] = await Promise.all([idbGetAll('units'), idbGetAll('items')]);
  const nameOf = (id) => (items.find((i) => i.id === id) || {}).name || id;
  const sorted = [...units].sort((a, b) => (a.status === 'in_stock' ? 0 : 1) - (b.status === 'in_stock' ? 0 : 1));
  body.append(dataView(
    [{ key: 'imei', title: true, label: '', render: (r) => r.imei || r.imei2 || '—' },
      { key: 'prod', sub: true, label: '', render: (r) => nameOf(r.item_id) },
      { key: 'st', badge: true, label: '', render: (r) => badge(t(r.status === 'in_stock' ? 'inStock' : r.status === 'sold' ? 'sold' : 'returned'), r.status === 'in_stock' ? 'green' : '') }],
    sorted, { emptyText: t('noneYet') },
  ));
}

async function renderVendors(body, v) {
  const vendors = await idbGetAll('vendors');
  body.append(dataView([{ key: 'name', title: true, label: '', render: (r) => r.name }, { key: 'phone', sub: true, label: '', render: (r) => r.phone || '' }], vendors, { onRow: can('mob_manage') ? (r) => vendorSheet(v, r) : null, emptyText: t('noneYet') }));
}

function itemSheet(v, rec) {
  const d = rec || { serialized: false, selling_price: 0, cost_price: 0, low_stock_at: 0 };
  const name = input({ value: d.name, label: t('itemName'), autofocus: true });
  const category = selectEl([['phone_new', t('catPhoneNew')], ['phone_used', t('catPhoneUsed')], ['accessory', t('catAccessory')], ['watch', t('catWatch')], ['earbuds', t('catEarbuds')], ['headphone', t('catHeadphone')], ['cable', t('catCable')], ['charger', t('catCharger')], ['other', t('catOther')]], d.category || 'other');
  const serialSw = h('input', { type: 'checkbox', role: 'switch', checked: !!d.serialized });
  const price = input({ value: d.selling_price, label: t('sellingPrice'), mode: 'decimal' });
  const cost = input({ value: d.cost_price, label: t('purchaseRate'), mode: 'decimal' });
  const lowAt = input({ value: d.low_stock_at, label: t('lowStockAlertAt'), mode: 'decimal' });
  const s = sheet({
    title: rec ? t('edit') : t('addItem'),
    body: h('div', { class: 'grid' }, field(t('itemName'), name), field(t('category'), category),
      h('label', { class: 'li', style: { cursor: 'pointer' } }, h('div', { class: 'grow' }, h('div', { class: 't' }, t('serialized'))), h('span', { class: 'switch' }, serialSw)),
      h('div', { class: 'two' }, field(t('sellingPrice'), price), field(t('purchaseRate'), cost)),
      field(t('lowStockAlertAt'), lowAt)),
    actions: [{ label: t('save'), primary: true, onclick: async (close) => {
      if (!name.value.trim()) { fail(new Error(t('errNameRequired'))); return false; }
      const id = rec ? rec.id : uid();
      const data = { name: name.value.trim(), category: category.value, serialized: serialSw.checked, sellingPrice: N(price.value), costPrice: N(cost.value), lowStockAt: N(lowAt.value) };
      await idbPut('items', { id, name: data.name, category: data.category, serialized: data.serialized, selling_price: data.sellingPrice, cost_price: data.costPrice, low_stock_at: data.lowStockAt, active: true, _pending: true });
      await outboxAdd('mob_save_item', { p_id: id, p: data, p_base: rec ? rec.updated_at : null });
      close(); toast(t('saved')); v.refresh();
    } }],
  });
}
function vendorSheet(v, rec) {
  const name = input({ value: rec ? rec.name : '', label: t('name'), autofocus: true });
  const phone = input({ value: rec ? rec.phone : '', label: t('phone'), mode: 'tel' });
  sheet({
    title: rec ? t('edit') : t('add'), body: h('div', { class: 'grid' }, field(t('name'), name), field(t('phone'), phone)),
    actions: [{ label: t('save'), primary: true, onclick: async (close) => {
      if (!name.value.trim()) { fail(new Error(t('errNameRequired'))); return false; }
      const id = rec ? rec.id : uid();
      const data = { name: name.value.trim(), phone: phone.value.trim() };
      await idbPut('vendors', { id, name: data.name, phone: data.phone, _pending: true });
      await outboxAdd('mob_save_vendor', { p_id: id, p: data, p_base: rec ? rec.updated_at : null });
      close(); toast(t('saved')); v.refresh();
    } }],
  });
}
