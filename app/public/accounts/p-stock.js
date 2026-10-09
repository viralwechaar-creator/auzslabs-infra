/* Products and services, stock levels, valuation, adjustments, transfers, warehouses and the category/brand/unit lists. */
'use strict';
const UNITS_DEFAULT = ['Nos', 'Kg', 'Gm', 'Ltr', 'Ml', 'Mtr', 'Box', 'Pack', 'Pair', 'Set', 'Hrs', 'Day'];

page('products', {
  title: 'Products', icon: 'box', perm: 'acc_view',
  async render(v) {
    const writable = can('acc_inventory');
    v.header({ title: 'Products and services', actions: [writable ? { label: 'New product', icon: 'plus', primary: true, run: () => productSheet(null, () => v.refresh()) } : null, writable ? { label: 'Categories and units', icon: 'tag', run: () => listsSheet(() => v.refresh()) } : null, can('acc_import') ? { label: 'Import', icon: 'upload', run: () => go('data?entity=products') } : null].filter(Boolean) });
    const rows = (await products(true));
    let q = '', cat = v.q.get('cat') || '', low = v.q.get('low') === '1', type = '';
    const host = h('div'), bulk = h('div', { class: 'row sp hidden banner info' });
    const cats = uniq(rows.map((r) => r.category).filter(Boolean)).sort();
    const draw = () => {
      const list = rows.filter((p) => (p.active || type === 'inactive') && (type !== 'inactive' || !p.active) && (!q || p.name.toLowerCase().includes(q.toLowerCase()) || p.sku.toLowerCase().includes(q.toLowerCase()) || (p.barcode || '') === q || (p.hsn || '') === q) && (!cat || p.category === cat) && (!low || (p.track_stock && !p.is_service && Number(p.reorder_level) > 0 && Number(p.stock) <= Number(p.reorder_level))) && (type === 'goods' ? !p.is_service : type === 'services' ? p.is_service : true));
      clear(host);
      if (!list.length) { host.append(empty('box', rows.length ? 'No matches' : 'No products yet', rows.length ? 'Try another search or filter.' : 'Add the things you sell and buy, goods or services.', writable && !rows.length ? h('button', { class: 'btn fill', onclick: () => productSheet(null, () => v.refresh()) }, 'New product') : null)); return; }
      host.append(dataView([
        { key: 'name', label: 'Item', title: true, render: (p) => h('div', null, h('div', { class: 't' }, p.name), h('div', { class: 's' }, [p.sku, p.category].filter(Boolean).join(' · '))) },
        { key: 'hsn', label: 'HSN/SAC', render: (p) => p.hsn || '' }, { key: 'tax_rate', label: 'GST', r: true, render: (p) => p.tax_rate + '%' },
        { key: 'sale_price', label: 'Sale price', r: true, render: (p) => money(p.sale_price), sortVal: (p) => Number(p.sale_price) }, { key: 'avg_cost', label: 'Avg cost', r: true, render: (p) => (p.is_service ? '' : money(p.avg_cost)), sortVal: (p) => Number(p.avg_cost) },
        { key: 'stock', label: 'In stock', r: true, value: true, sortVal: (p) => Number(p.stock), render: (p) => (p.is_service || !p.track_stock ? h('span', { class: 'muted' }, 'Service') : h('span', null, qty(p.stock) + ' ' + p.unit, Number(p.reorder_level) > 0 && Number(p.stock) <= Number(p.reorder_level) ? h('div', null, badge('Low stock', 'orange')) : null)) },
        { key: 'stock_value', label: 'Value', r: true, hideMobile: true, render: (p) => (p.is_service ? '' : money(p.stock_value)), sortVal: (p) => Number(p.stock_value) },
        { key: 'price', label: '', sub: true, hideDesk: true, render: (p) => inr(p.sale_price) + ' · GST ' + p.tax_rate + '%' },
      ], list, { onRow: (p) => go('product/' + p.id), selectable: writable, onSelect: (s) => { bulk.classList.toggle('hidden', !s.size); bulk.replaceChildren(h('span', null, s.size + ' selected'), h('button', { class: 'btn sm fill', onclick: () => bulkProducts([...s], () => v.refresh()) }, 'Edit selected')); } }));
    };
    const val = rows.reduce((s, p) => s + Number(p.stock_value), 0);
    v.root.append(h('div', { class: 'kpis k3' }, kpi('Items', String(rows.filter((p) => p.active).length), rows.filter((p) => p.is_service).length + ' services'), kpi('Stock value', inr(val, 0), 'At average cost', () => go('stock')), kpi('Low on stock', String(rows.filter((p) => p.track_stock && !p.is_service && Number(p.reorder_level) > 0 && Number(p.stock) <= Number(p.reorder_level)).length), 'At or below reorder level', () => go('products?low=1'))),
      h('div', { class: 'toolbar' }, searchField('Search by name, SKU, barcode or HSN', debounce((x) => { q = x; draw(); }, 200)), h('div', { class: 'row wrap' }, chips([['', 'All'], ['goods', 'Goods'], ['services', 'Services'], ['inactive', 'Inactive']], type, (x) => { type = x; draw(); })),
        cats.length ? chips([['', 'All categories'], ...cats.map((c) => [c, c])], cat, (x) => { cat = x; draw(); }) : null,
        h('div', { class: 'row' }, checkbox('Low stock only', low, (x) => { low = x; draw(); }), can('acc_import') ? h('button', { class: 'btn', onclick: () => go('data?entity=products') }, icon('upload', 18), 'Import from Busy or Tally') : null, h('button', { class: 'btn', onclick: (e) => exportMenu(e.currentTarget, 'products', ['SKU', 'Name', 'Category', 'HSN/SAC', 'GST %', 'Unit', 'Sale price', 'Purchase price', 'MRP', 'In stock', 'Avg cost', 'Stock value'], rows.map((p) => [p.sku, p.name, p.category || '', p.hsn || '', Number(p.tax_rate), p.unit, Number(p.sale_price), Number(p.purchase_price), Number(p.mrp), Number(p.stock), Number(p.avg_cost), Number(p.stock_value)])) }, icon('download', 18), 'Export'))), bulk, host);
    draw();
  },
});

function bulkProducts(ids, done) {
  const gst = selectEl([['', 'No change'], ...taxRates().map((r) => [String(r), r + '%'])], ''), hsn = input({ placeholder: 'No change' }), cat = input({ placeholder: 'No change' }), sp = input({ type: 'number', placeholder: 'e.g. 5 or -10', mode: 'decimal' }), pp = input({ type: 'number', placeholder: 'e.g. 5', mode: 'decimal' }), st = selectEl([['', 'No change'], ['true', 'Active'], ['false', 'Inactive']], '');
  sheet({ title: 'Edit ' + ids.length + ' items', body: h('div', { class: 'grid' }, field('GST rate', gst), field('HSN/SAC code', hsn), field('Category', cat), field('Change sale prices by %', sp, 'Positive raises, negative lowers.'), field('Change purchase prices by %', pp), field('Status', st)), actions: [{ label: 'Apply', primary: true, onclick: async (c) => {
    const ch = {}; if (gst.value) ch.tax_rate = gst.value; if (hsn.value) ch.hsn = hsn.value; if (cat.value) ch.category = cat.value; if (sp.value) ch.sale_price_pct = sp.value; if (pp.value) ch.purchase_price_pct = pp.value; if (st.value) ch.active = st.value === 'true';
    if (!Object.keys(ch).length) { toast('Nothing to change', { err: true }); return false; }
    if (!(await confirmBox('Apply to ' + ids.length + ' items?', 'Existing documents are not changed; only future ones use the new values.', 'Apply'))) return false;
    const r = await api('acc_bulk_update', { p_entity: 'products', p_ids: ids, p_changes: ch }); c(); toast(r.updated + ' updated'); bust('products'); done(); } }] });
}

function productSheet(p, onSaved, prefillName) {
  const isNew = !p; p = p || {}; if (isNew && prefillName) p.name = prefillName;
  const st = { is_service: !!p.is_service, track_stock: p.track_stock !== false, tax_inclusive: !!p.tax_inclusive, track_batch: !!p.track_batch, track_serial: !!p.track_serial, active: p.active !== false };
  const name = input({ value: p.name || '', placeholder: 'Name', label: 'Name' }), sku = input({ value: p.sku || '', placeholder: 'Unique code', label: 'SKU' }), bc = input({ value: p.barcode || '', placeholder: 'Barcode (optional)' });
  const catList = h('datalist', { id: 'catlist' }, master('category').map((c) => h('option', { value: c }))), brList = h('datalist', { id: 'brlist' }, master('brand').map((c) => h('option', { value: c })));
  const cat = h('input', { class: 'input', list: 'catlist', value: p.category || '', placeholder: 'Category' }), brand = h('input', { class: 'input', list: 'brlist', value: p.brand || '', placeholder: 'Brand' });
  const unit = selectEl(uniq([...UNITS_DEFAULT, ...master('unit'), p.unit].filter(Boolean)), p.unit || 'Nos'), hsn = input({ value: p.hsn || '', placeholder: 'HSN (goods) or SAC (services)', mode: 'numeric' });
  const gst = selectEl(taxRates().map((r) => [String(r), r + '%']), String(p.tax_rate ?? defaultTaxRate())), sale = input({ value: p.sale_price || '', mode: 'decimal', placeholder: '0.00' }), buy = input({ value: p.purchase_price || '', mode: 'decimal', placeholder: '0.00' }), mrp = input({ value: Number(p.mrp) || '', mode: 'decimal', placeholder: '0.00' });
  const rl = input({ value: Number(p.reorder_level) || '', mode: 'decimal', placeholder: '0' }), rq = input({ value: Number(p.reorder_qty) || '', mode: 'decimal', placeholder: '0' }), nt = h('textarea', { class: 'textarea', style: { minHeight: '70px' } }, p.notes || '');
  const pls = master('price_list'), plIn = {}; const plVals = p.price_lists || {};
  const stockBox = h('div', { class: 'grid' }, toggleRow('Track stock', st.track_stock, (x) => { st.track_stock = x; }, 'Quantities, cost and low-stock alerts'), toggleRow('Batches and expiry', st.track_batch, (x) => { st.track_batch = x; }), toggleRow('Serial numbers', st.track_serial, (x) => { st.track_serial = x; }),
    h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } }, field('Reorder level', rl), field('Reorder quantity', rq)));
  const svcRow = toggleRow('This is a service', st.is_service, (x) => { st.is_service = x; stockBox.classList.toggle('hidden', x); }, 'No stock is held. Use a SAC code.');
  if (st.is_service) stockBox.classList.add('hidden');
  const s = sheet({ title: isNew ? 'New product' : 'Edit product', body: h('div', { class: 'grid' }, catList, brList, field('Name', name), h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } }, field('SKU', sku), field('Barcode', bc)), svcRow,
    h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } }, field('Category', cat), field('Brand', brand)), h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } }, field('Unit', unit), field('HSN/SAC', hsn)),
    h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } }, field('GST rate', gst), field('Sale price', sale)), toggleRow('Sale price includes tax', st.tax_inclusive, (x) => { st.tax_inclusive = x; }),
    h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } }, field('Purchase price', buy), field('MRP', mrp)),
    pls.length ? h('div', { class: 'grid' }, h('div', { class: 'lbl' }, 'Price lists'), pls.map((n) => field(n, plIn[n] = input({ value: plVals[n] || '', mode: 'decimal', placeholder: 'Same as sale price' })))) : null,
    stockBox, field('Notes', nt), !isNew ? toggleRow('Active', st.active, (x) => { st.active = x; }) : null),
    actions: [{ label: isNew ? 'Add' : 'Save', primary: true, onclick: async (c) => {
      if (!name.value.trim() || !sku.value.trim()) { toast('Name and SKU are required', { err: true }); return false; }
      const price_lists = {}; pls.forEach((n) => { if (plIn[n].value) price_lists[n] = N(plIn[n].value); });
      const r = await api('acc_save_product', { p: { id: p.id || null, name: name.value, sku: sku.value, barcode: bc.value, category: cat.value, brand: brand.value, unit: unit.value, hsn: hsn.value, tax_rate: gst.value, tax_inclusive: st.tax_inclusive, sale_price: sale.value || 0, purchase_price: buy.value || 0, mrp: mrp.value || 0,
        is_service: st.is_service, track_stock: st.track_stock, track_batch: st.track_batch, track_serial: st.track_serial, reorder_level: rl.value || 0, reorder_qty: rq.value || 0, notes: nt.value, active: st.active, price_lists } });
      bust('products'); await loadCtx(); c(); toast(isNew ? 'Product added' : 'Saved'); onSaved && onSaved(r, sku.value);
    } }] });
  name.focus();
}

page('product', {
  title: 'Product', icon: 'box', nav: false, navAs: 'products',
  async render(v) {
    const id = v.args[0];
    const p = (await products(true)).find((x) => x.id === id); if (!p) throw new Error('Product not found');
    const st = await api('acc_product_stock', { p_product: id });
    v.header({ title: p.name, back: 'products', actions: [can('acc_inventory') ? { label: 'Edit', icon: 'edit', primary: true, run: () => productSheet(p, () => v.refresh()) } : null, can('acc_inventory') && !p.is_service ? { label: 'Adjust stock', icon: 'layers', run: () => stockAdjustSheet(p, () => v.refresh()) } : null, can('acc_inventory') && !p.is_service && S.warehouses.length > 1 ? { label: 'Transfer', icon: 'swap', run: () => stockTransferSheet(p, () => v.refresh()) } : null].filter(Boolean) });
    const margin = Number(p.sale_price) && Number(p.avg_cost) ? Math.round((Number(p.sale_price) - Number(p.avg_cost)) / Number(p.sale_price) * 100) : null;
    v.root.append(h('div', { class: 'card grid', style: { gap: '6px' } }, h('div', { class: 'row sp wrap' }, h('div', null, h('div', { class: 'mono' }, p.sku), h('div', { class: 'small muted' }, [p.category, p.brand, p.hsn ? 'HSN/SAC ' + p.hsn : '', 'GST ' + p.tax_rate + '%'].filter(Boolean).join(' · '))), p.active ? null : badge('Inactive'))),
      h('div', { class: 'kpis' }, kpi('In stock', p.is_service || !p.track_stock ? 'Service' : qty(p.stock) + ' ' + p.unit, Number(p.reorder_level) > 0 ? 'Reorder at ' + qty(p.reorder_level) : ''), kpi('Average cost', p.is_service ? '–' : inr(p.avg_cost), p.is_service ? '' : 'Stock value ' + inr(p.stock_value, 0)), kpi('Sale price', inr(p.sale_price), margin != null ? margin + '% margin' : ''), kpi('Purchase price', inr(p.purchase_price), p.mrp && Number(p.mrp) ? 'MRP ' + inr(p.mrp) : '')));
    if (!p.is_service && p.track_stock) {
      v.root.append(h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'By warehouse')), h('div', { class: 'list' }, st.by_warehouse.map((w) => liRow({ icon: 'building', tone: 'gray', title: w.warehouse, value: qty(w.qty) + ' ' + p.unit, valueSub: inr(w.value, 0) })))),
        h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Stock ledger'), h('button', { class: 'btn plain sm', onclick: (e) => exportMenu(e.currentTarget, 'stock-' + p.sku, ['Date', 'Kind', 'Document', 'Warehouse', 'Qty', 'Unit cost', 'Running'], st.moves.map((m) => [m.move_date, m.kind, m.doc_number || m.note || '', m.warehouse, Number(m.qty), Number(m.unit_cost), Number(m.running)])) }, 'Export')),
          dataView([{ key: 'move_date', label: 'Date', title: true, render: (m) => fmtD(m.move_date) }, { key: 'kind', label: 'Movement', sub: true, render: (m) => cap1(m.kind) + (m.doc_number ? ' · ' + m.doc_number : '') + ' · ' + m.warehouse }, { key: 'doc_number', label: 'Document', render: (m) => m.doc_number ? h('a', { href: '#/doc/' + m.source_id }, m.doc_number) : (m.note || '') }, { key: 'warehouse', label: 'Warehouse' },
            { key: 'qty', label: 'Qty', r: true, value: true, render: (m) => h('span', { class: Number(m.qty) < 0 ? 'neg' : '' }, (Number(m.qty) > 0 ? '+' : '') + qty(m.qty)) }, { key: 'unit_cost', label: 'Unit cost', r: true, render: (m) => money(m.unit_cost) }, { key: 'running', label: 'Running', r: true, render: (m) => qty(m.running) }], st.moves, { sortKey: null, empty: empty('layers', 'No movements yet', 'Receive stock with a bill or an opening-stock entry.') })));
    }
  },
});

// ---------- stock page ----------
page('stock', {
  title: 'Stock', icon: 'layers', perm: 'acc_view',
  async render(v) {
    const tab = v.q.get('tab') || 'summary', writable = can('acc_inventory');
    v.header({ title: 'Stock', actions: [writable ? { label: 'Adjust stock', icon: 'layers', primary: true, run: () => stockAdjustSheet(null, () => v.refresh()) } : null, writable && S.warehouses.length > 1 ? { label: 'Transfer', icon: 'swap', run: () => stockTransferSheet(null, () => v.refresh()) } : null, writable ? { label: 'Warehouses', icon: 'building', run: () => warehousesSheet(() => v.refresh()) } : null].filter(Boolean) });
    v.root.append(seg([['summary', 'Valuation'], ['movement', 'Movement'], ['velocity', 'Fast and slow'], ['batches', 'Batches and expiry']], tab, (t) => go('stock?tab=' + t)));
    const host = h('div', { class: 'grid' }); v.root.append(host);
    if (tab === 'summary') {
      const wh = v.q.get('wh') || '', asof = v.q.get('asof') || today();
      const r = await api('acc_stock_summary', { p: { as_of: asof, warehouse_id: wh || null } });
      const ws = selectEl([['', 'All warehouses'], ...S.warehouses.map((w) => [w.id, w.name])], wh, { label: 'Warehouse', onchange: () => go('stock?wh=' + ws.value + '&asof=' + ad.value) }), ad = dateInput(asof, { label: 'As of', onchange: () => go('stock?wh=' + ws.value + '&asof=' + ad.value) });
      host.append(h('div', { class: 'row wrap' }, h('div', { class: 'grow' }, ws), h('div', { class: 'grow' }, ad)), h('div', { class: 'kpis k3' }, kpi('Total value', inr(r.total_value, 0), 'At average cost on ' + fmtD(asof)), kpi('Items in stock', String(r.rows.length), ''), kpi('Below reorder level', String(r.rows.filter((x) => x.low).length), '')),
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: (e) => exportMenu(e.currentTarget, 'stock-valuation-' + asof, ['SKU', 'Item', 'Category', 'Unit', 'Quantity', 'Avg cost', 'Value'], r.rows.map((x) => [x.sku, x.name, x.category || '', x.unit, Number(x.qty), Number(x.avg_cost), Number(x.value)])) }, icon('download', 18), 'Export')),
        dataView([{ key: 'name', label: 'Item', title: true, render: (x) => h('div', null, h('div', { class: 't' }, x.name), h('div', { class: 's' }, x.sku)) }, { key: 'category', label: 'Category', render: (x) => x.category || '' }, { key: 'qty', label: 'Quantity', r: true, sub: true, render: (x) => qty(x.qty) + ' ' + x.unit }, { key: 'avg_cost', label: 'Avg cost', r: true, render: (x) => money(x.avg_cost) },
          { key: 'value', label: 'Value', r: true, value: true, render: (x) => money(x.value), sortVal: (x) => Number(x.value) }, { key: 'low', label: '', badge: true, render: (x) => (x.low ? badge('Low stock', 'orange') : '') }], r.rows, { onRow: (x) => go('product/' + x.id), footer: { value: money(r.total_value) }, empty: empty('layers', 'No stock on hand') }));
    } else if (tab === 'movement') {
      const from = v.q.get('from') || monthStart(), to = v.q.get('to') || today();
      const r = await api('acc_stock_movement', { p_from: from, p_to: to });
      const fe = dateInput(from, { onchange: () => go('stock?tab=movement&from=' + fe.value + '&to=' + te.value) }), te = dateInput(to, { onchange: () => go('stock?tab=movement&from=' + fe.value + '&to=' + te.value) });
      host.append(h('div', { class: 'row wrap' }, h('div', { class: 'grow' }, field('From', fe)), h('div', { class: 'grow' }, field('To', te))),
        h('div', { class: 'row' }, h('button', { class: 'btn', onclick: (e) => exportMenu(e.currentTarget, 'stock-movement', ['SKU', 'Item', 'Opening', 'In', 'Out', 'Closing', 'Closing value'], r.rows.map((x) => [x.sku, x.name, Number(x.opening), Number(x.qty_in), Number(x.qty_out), Number(x.closing), Number(x.closing_value)])) }, icon('download', 18), 'Export')),
        dataView([{ key: 'name', label: 'Item', title: true, render: (x) => h('div', null, h('div', { class: 't' }, x.name), h('div', { class: 's' }, x.sku)) }, { key: 'opening', label: 'Opening', r: true, render: (x) => qty(x.opening) }, { key: 'qty_in', label: 'In', r: true, render: (x) => qty(x.qty_in) }, { key: 'qty_out', label: 'Out', r: true, render: (x) => qty(x.qty_out) },
          { key: 'closing', label: 'Closing', r: true, sub: true, render: (x) => 'In ' + qty(x.qty_in) + ' · Out ' + qty(x.qty_out) + ' · Closing ' + qty(x.closing) }, { key: 'closing_value', label: 'Value', r: true, value: true, render: (x) => money(x.closing_value) }], r.rows, { onRow: (x) => go('product/' + x.id) }));
    } else if (tab === 'velocity') {
      const days = Number(v.q.get('days') || 90), r = await api('acc_stock_velocity', { p_days: days });
      host.append(seg([['30', '30 days'], ['90', '90 days'], ['180', '180 days']], String(days), (d) => go('stock?tab=velocity&days=' + d)), h('p', { class: 'muted small' }, 'Fast = sold at least half of the stock on hand in this period. Dead = nothing sold.'),
        dataView([{ key: 'name', label: 'Item', title: true }, { key: 'stock', label: 'On hand', r: true, render: (x) => qty(x.stock) }, { key: 'sold', label: 'Sold', r: true, sub: true, render: (x) => 'Sold ' + qty(x.sold) + ' · On hand ' + qty(x.stock) }, { key: 'last_sale', label: 'Last sale', render: (x) => (x.last_sale ? fmtD(x.last_sale) : 'Never') },
          { key: 'class', label: 'Movement', badge: true, render: (x) => badge(cap1(x.class), x.class === 'fast' ? 'green' : x.class === 'dead' ? 'red' : 'orange') }], r.rows, { onRow: (x) => go('product/' + x.id), sortKey: 'sold', sortDir: -1, empty: empty('layers', 'Nothing to analyse yet') }));
    } else {
      const before = v.q.get('before') || '', r = await api('acc_stock_batches', { p_before: before || null });
      const be = dateInput(before, { label: 'Expiring before', onchange: () => go('stock?tab=batches&before=' + be.value) });
      host.append(field('Expiring on or before', be, 'Leave empty to list every batch with stock.'),
        h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Batches')), dataView([{ key: 'name', label: 'Item', title: true }, { key: 'batch_no', label: 'Batch', sub: true }, { key: 'expiry', label: 'Expiry', render: (x) => (x.expiry ? fmtD(x.expiry) : '—') }, { key: 'qty', label: 'Quantity', r: true, value: true, render: (x) => qty(x.qty) }], r.batches, { empty: empty('layers', 'No batches', 'Turn on “Batches and expiry” for a product and enter batch numbers on bills.') })),
        r.serials.length ? h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, 'Serial numbers in stock')), dataView([{ key: 'name', label: 'Item', title: true }, { key: 'serial_no', label: 'Serial', sub: true, render: (x) => x.serial_no }, { key: 'qty', label: 'Qty', r: true, value: true, render: (x) => qty(x.qty) }], r.serials)) : null);
    }
  },
});

function productLinePicker(rows, onChange, o = {}) {
  // a small repeatable "item + quantity" editor used by adjustments and transfers
  const host = h('div', { class: 'grid' });
  const draw = () => {
    clear(host);
    rows.forEach((r, i) => {
      const prod = (S.products || []).find((p) => p.id === r.product_id);
      host.append(h('div', { class: 'card pad-s grid', style: { gap: '8px' } }, h('div', { class: 'row' }, h('button', { class: 'li grow', type: 'button', style: { background: 'var(--fill)', borderRadius: '12px', minHeight: '44px' }, onclick: () => { const sh = sheet({ title: 'Choose item', closeLabel: 'Cancel', body: h('div', { class: 'grid' }, (() => { const list = h('div', { class: 'list' }); const dr = (q) => { clear(list); (S.products || []).filter((p) => p.active && !p.is_service && p.track_stock && (!q || p.name.toLowerCase().includes(q.toLowerCase()) || p.sku.toLowerCase().includes(q.toLowerCase()))).slice(0, 40).forEach((p) => list.append(liRow({ title: p.name, sub: p.sku + ' · ' + qty(p.stock) + ' ' + p.unit + ' in stock', onclick: () => { r.product_id = p.id; if (o.cost && !r.unit_cost) r.unit_cost = String(p.avg_cost || p.purchase_price || ''); sh.close(); draw(); onChange && onChange(); } }))); }; dr(''); return h('div', { class: 'grid' }, searchField('Search items', dr), list); })()) }); } }, h('div', { class: 'grow' }, prod ? h('div', { class: 't' }, prod.name) : h('div', { class: 't muted' }, 'Choose item'), prod ? h('div', { class: 's' }, qty(prod.stock) + ' ' + prod.unit + ' in stock') : null)),
        rows.length > 1 ? h('button', { class: 'btn plain icon', 'aria-label': 'Remove line', onclick: () => { rows.splice(i, 1); draw(); onChange && onChange(); } }, icon('trash', 18)) : null),
        h('div', { style: { display: 'grid', gridTemplateColumns: o.cost ? '1fr 1fr' : '1fr', gap: '10px' } }, field(o.qtyLabel || 'Quantity', h('input', { class: 'input', inputmode: 'decimal', value: r.qty || '', placeholder: '0', oninput: (e) => { r.qty = e.target.value; onChange && onChange(); } })), o.cost ? field('Unit cost', h('input', { class: 'input', inputmode: 'decimal', value: r.unit_cost || '', placeholder: 'Average cost', oninput: (e) => { r.unit_cost = e.target.value; } })) : null)));
    });
    host.append(h('button', { class: 'btn', type: 'button', onclick: () => { rows.push({ product_id: '', qty: '', unit_cost: '' }); draw(); } }, icon('plus', 18), 'Add item'));
  };
  draw(); return host;
}
async function stockAdjustSheet(p, done) {
  await products();
  const rows = [{ product_id: p ? p.id : '', qty: '', unit_cost: '' }];
  let mode = 'delta', opening = false;
  const wh = selectEl(S.warehouses.filter((w) => w.active).map((w) => [w.id, w.name]), (S.warehouses.find((w) => w.is_default) || S.warehouses[0]).id), dt = dateInput(today()), why = input({ value: 'Stock adjustment', placeholder: 'Reason' });
  const picker = h('div'); const draw = () => picker.replaceChildren(productLinePicker(rows, null, { cost: mode === 'delta', qtyLabel: mode === 'count' ? 'Counted quantity' : 'Quantity (use − to remove)' }));
  draw();
  const modeSeg = seg([['delta', 'Add or remove'], ['count', 'Physical count']], mode, (m) => { mode = m; draw(); }, { full: true });
  const openRow = can('acc_admin') ? toggleRow('This is opening stock', false, (x) => { opening = x; if (x) why.value = 'Opening stock'; }, 'Brought in against “Opening balance equity”, not a gain.') : null;
  sheet({ title: 'Stock adjustment', body: h('div', { class: 'grid' }, modeSeg, h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } }, field('Warehouse', wh), field('Date', dt)), field('Reason', why), openRow, picker, h('p', { class: 'cap' }, mode === 'count' ? 'Enter what you actually counted. The difference is posted as a stock gain or loss.' : 'Positive quantities add stock at the cost you enter; negative quantities remove it at average cost.')),
    actions: [{ label: 'Post adjustment', primary: true, onclick: async (c) => {
      const lines = rows.filter((r) => r.product_id && String(r.qty).trim() !== '').map((r) => ({ product_id: r.product_id, qty: N(r.qty), unit_cost: r.unit_cost || null }));
      if (!lines.length) { toast('Add at least one item with a quantity', { err: true }); return false; }
      if (!(await confirmBox('Post this adjustment?', 'It changes stock and the inventory ledger. It cannot be edited afterwards.', 'Post'))) return false;
      const r = await api('acc_stock_adjust', { p: { mode, warehouse_id: wh.value, date: dt.value, reason: why.value, opening, lines } }); bust('products'); c(); toast('Adjusted ' + r.lines + ' item(s), value ' + inr(r.value)); done ? done() : route_();
    } }] });
}
async function stockTransferSheet(p, done) {
  await products();
  const rows = [{ product_id: p ? p.id : '', qty: '' }], ws = S.warehouses.filter((w) => w.active);
  const from = selectEl(ws.map((w) => [w.id, w.name]), ws[0].id), to = selectEl(ws.map((w) => [w.id, w.name]), (ws[1] || ws[0]).id), dt = dateInput(today()), nt = input({ placeholder: 'Note (optional)' });
  sheet({ title: 'Transfer stock', body: h('div', { class: 'grid' }, h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } }, field('From', from), field('To', to)), field('Date', dt), field('Note', nt), productLinePicker(rows, null, {})),
    actions: [{ label: 'Transfer', primary: true, onclick: async (c) => {
      const lines = rows.filter((r) => r.product_id && N(r.qty) > 0).map((r) => ({ product_id: r.product_id, qty: N(r.qty) }));
      if (!lines.length) { toast('Add at least one item', { err: true }); return false; }
      await api('acc_stock_transfer', { p: { from_warehouse: from.value, to_warehouse: to.value, date: dt.value, note: nt.value, lines } }); bust('products'); c(); toast('Transferred'); done ? done() : route_();
    } }] });
}
function warehousesSheet(done) {
  const body = h('div', { class: 'grid' }), draw = () => { clear(body).append(h('div', { class: 'list' }, S.warehouses.map((w) => liRow({ icon: 'building', tone: w.active ? '' : 'gray', title: w.name, sub: w.code + (w.is_default ? ' · default' : '') + (w.active ? '' : ' · inactive'), chevron: true, onclick: () => edit(w) }))), h('button', { class: 'btn', onclick: () => edit(null) }, icon('plus', 18), 'New warehouse')); };
  const edit = (w) => { const code = input({ value: w ? w.code : '', placeholder: 'e.g. SHOP' }), nm = input({ value: w ? w.name : '', placeholder: 'Name' }); let def = !!(w && w.is_default), act = w ? w.active : true;
    sheet({ title: w ? 'Edit warehouse' : 'New warehouse', body: h('div', { class: 'grid' }, field('Code', code), field('Name', nm), toggleRow('Default warehouse', def, (x) => { def = x; }), w ? toggleRow('Active', act, (x) => { act = x; }) : null), actions: [{ label: 'Save', primary: true, onclick: async (c) => { await api('acc_save_warehouse', { p: { id: w ? w.id : null, code: code.value, name: nm.value, is_default: def, active: act } }); await loadCtx(); c(); draw(); done && done(); } }] }); };
  draw(); sheet({ title: 'Warehouses', closeLabel: 'Done', body });
}
function listsSheet(done) {
  const kinds = [['category', 'Categories'], ['brand', 'Brands'], ['unit', 'Units'], ['price_list', 'Price lists']];
  let cur = 'category'; const host = h('div', { class: 'grid' });
  const draw = () => {
    clear(host).append(seg(kinds, cur, (k) => { cur = k; draw(); }, { full: true }));
    const items = S.masters.filter((m) => m.kind === cur);
    host.append(h('div', { class: 'list' }, items.length ? items.map((m) => liRow({ title: m.name, sub: m.active ? '' : 'Hidden', value: null, chevron: true, onclick: async () => { const n = await askText('Rename', m.name, 'Name', m.name); if (n) { await api('acc_save_master', { p: { id: m.id, kind: cur, name: n, active: m.active } }); await loadCtx(); draw(); } } })) : [h('div', { class: 'li muted' }, 'Nothing yet.')]),
      h('button', { class: 'btn', onclick: async () => { const n = await askText('Add ' + kinds.find((k) => k[0] === cur)[1].toLowerCase().replace(/s$/, ''), '', 'Name'); if (n) { await api('acc_save_master', { p: { kind: cur, name: n } }); await loadCtx(); draw(); done && done(); } } }, icon('plus', 18), 'Add'),
      cur === 'price_list' ? h('p', { class: 'cap' }, 'A price list adds a price field to every product (for example Wholesale).') : null);
  };
  draw(); sheet({ title: 'Categories, brands and units', closeLabel: 'Done', body: host });
}
