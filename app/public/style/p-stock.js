/* AUZsStyle: Stock. Styles list -> a style opens its colour x size grid. Add/edit a style (variants are made from
   colours x sizes with barcodes), adjust or count stock, print barcode tags, move stock between branches. */
'use strict';
const SU = { q: '', cat: 'All', f: 'all' };
page('stock', {
  title: 'Stock', perm: 'sty_view',
  async render(v) {
    v.header({ title: t('Stock'), actions: [can('sty_manage') ? { label: t('New style'), icon: 'plus', primary: true, run: () => styleForm(null, () => v.refresh()) } : null,
      can('sty_stock') ? { label: t('Transfers'), icon: 'swap', run: () => transfersSheet(() => v.refresh()) } : null].filter(Boolean) });
    const root = v.root; root.append(h('div', { class: 'spin', style: { color: 'var(--tint)', margin: '30px auto' } }));
    try { await loadCatalog(true); } catch (e) { return clear(root).append(empty('cloudOff', t('Could not load'), e.message, h('button', { class: 'btn fill', onclick: () => v.refresh() }, t('Try again')))); }
    const vs = allVariants().filter((x) => x.active !== false);
    const units = vs.reduce((a, x) => a + Math.max(x.stock, 0), 0), cost = vs.reduce((a, x) => a + Math.max(x.stock, 0) * (x.cost || 0), 0), retail = vs.reduce((a, x) => a + Math.max(x.stock, 0) * x.price, 0);
    const lowN = vs.filter((x) => x.stock <= (x.reorderAt || 0)).length, outN = vs.filter((x) => x.stock <= 0).length;
    const cats = ['All', ...[...new Set(S.cat.map((s) => s.category))].sort()];
    const list = h('div', { class: 'igrid' }); const chips = h('div', { class: 'chips' });
    const filtHost = h('span'); const paintF = () => clear(filtHost).append(filterButton(() => { paintF(); paint(); }));
    const paintChips = () => clear(chips).append(...cats.map((c) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(SU.cat === c), onclick: () => { SU.cat = c; paintChips(); paint(); } }, c === 'All' ? t('All') : c)));
    const flt = seg([['all', t('All')], ['low', t('Low stock')], ['out', t('Out of stock')]], SU.f, (x) => { SU.f = x; paint(); }, { full: true });
    function paint() {
      const q = SU.q.trim().toLowerCase();
      let rows = S.cat.filter((s) => (SU.cat === 'All' || s.category === SU.cat) && styleMatches(s) && (!q || (s.name + ' ' + (s.brand || '') + ' ' + (s.code || '') + ' ' + (s.fabric || '') + ' ' + (s.collection || '')).toLowerCase().includes(q) || s.variants.some((x) => x.barcode === q || (x.sku || '').toLowerCase() === q)));
      if (SU.f === 'low') rows = rows.filter((s) => s.variants.some((x) => x.active !== false && x.stock > 0 && x.stock <= (x.reorderAt || 0)));
      if (SU.f === 'out') rows = rows.filter((s) => s.variants.some((x) => x.active !== false && x.stock <= 0));
      clear(list).append(...(rows.length ? rows.map((s) => {
        const st = styleStock(s), sizes = [...new Set(s.variants.map((x) => x.size))].length, cols = [...new Set(s.variants.map((x) => x.colour))].length;
        const mx = Math.max(1, ...S.cat.map(styleStock)), lowS = s.variants.some((x) => x.active !== false && x.stock > 0 && x.stock <= (x.reorderAt || 0));
        const tone = st <= 0 ? 'z' : lowS || st <= 3 ? 'lo' : 'ok';
        return h('button', { class: 'icard' + (s.active === false ? ' off' : ''), type: 'button', onclick: () => styleSheet(s.id, () => v.refresh()) },
          h('div', { class: 'ic-p' }, s.photoUrl ? h('img', { src: s.photoUrl, alt: '', loading: 'lazy' }) : icon('shirt', 24)),
          h('div', { class: 'ic-b' },
            h('div', { class: 'ic-t' }, h('span', { class: 'ic-n' }, s.name), h('span', { class: 'ic-pr num' }, inr(s.price))),
            h('div', { class: 'ic-s' }, [s.category, s.fabric, cols + ' ' + t('colours'), sizes + ' ' + t('sizes')].filter(Boolean).join(' · ')),
            h('div', { class: 'ic-f' }, h('span', { class: 'ic-chip ' + tone }, st <= 0 ? t('Out of stock') : st + ' ' + t('in stock')), s.active === false ? h('span', { class: 'ic-chip' }, t('Hidden')) : null,
              h('span', { class: 'ic-bar' }, h('i', { class: tone, style: { width: Math.max(4, Math.min(100, st / mx * 100)) + '%' } })))));
      }) : [empty('shirt', S.cat.length ? t('No match') : t('No styles yet'), S.cat.length ? '' : t('Add a style to start. You can also load a small sample to look around.'),
        can('sty_manage') && !S.cat.length ? h('div', { class: 'row', style: { gap: '8px', justifyContent: 'center' } }, h('button', { class: 'btn fill', onclick: () => styleForm(null, () => v.refresh()) }, t('New style')), h('button', { class: 'btn', onclick: async () => { await api('sty_load_sample'); toast(t('Sample added')); v.refresh(); } }, t('Load sample'))) : null)]));
    }
    clear(root); if (!isDesk()) root.append(h('h1', { class: 'large-title' }, t('Stock')));
    root.append(h('div', { class: 'kpis' }, kpi(t('Units'), nf0.format(units), `${S.cat.length} ${t('styles')}`), kpi(t('Stock value'), inr(cost, 0), t('at cost')), kpi(t('Retail value'), inr(retail, 0)), kpi(t('Low stock'), lowN, outN + ' ' + t('Out of stock'), null, lowN ? 'neg' : '')),
      h('div', { class: 'toolbar' }, h('div', { class: 'row', style: { gap: '8px' } }, h('div', { class: 'grow' }, searchField(t('Search styles, scan a barcode'), (x) => { SU.q = x; paint(); }, SU.q)), filtHost, h('button', { class: 'btn icon', type: 'button', 'aria-label': t('Scan'), onclick: () => scanWith((c) => { const f = findBarcode(c), sc = findStyleCode(c); const st = f ? f.style : sc; if (st) { styleSheet(st.id, () => v.refresh()); } else toast(t('No item with that code'), { err: true }); }) }, icon('camera', 18)), h('button', { class: 'btn icon', type: 'button', 'aria-label': t('Print tags'), onclick: () => tagsSheet(S.cat.filter((x) => x.active !== false && styleMatches(x))) }, icon('barcode', 18))), chips, flt), list);
    paintChips(); paintF(); paint();
  },
});

// ---- one style: its grid ----
async function styleSheet(id, changed) {
  await loadCatalog(true).catch(() => {});
  const s = S.cat.find((x) => x.id === id); if (!s) return;
  const cols = [...new Set(s.variants.map((x) => x.colour))], sizes = [...new Set(s.variants.map((x) => x.size))].sort((a, b) => sizeRank(a) - sizeRank(b));
  const cell = (c, z) => s.variants.find((x) => x.colour === c && x.size === z);
  const grid = h('div', { class: 'mxw' }, h('table', { class: 'mx' },
    h('thead', null, h('tr', null, h('th', null, ''), sizes.map((z) => h('th', null, z || '—')), h('th', null, t('Total')))),
    h('tbody', null, cols.map((c) => h('tr', null, h('th', { class: 'rl' }, colourDot(c, 12), ' ', c || '—'),
      sizes.map((z) => { const x = cell(c, z); return h('td', null, x ? h('button', { class: 'mxc' + (x.stock <= 0 ? ' z' : x.stock <= (x.reorderAt || 2) ? ' lo' : ''), type: 'button', disabled: !can('sty_stock'), onclick: () => adjustSheet(x, s, () => { sh.close(); styleSheet(id, changed); changed && changed(); }) }, x.stock) : '·'); }),
      h('td', { class: 'num tt' }, s.variants.filter((x) => x.colour === c).reduce((a, x) => a + x.stock, 0)))))));
  const sh = sheet({ title: s.name, closeLabel: t('Done'), full: true, wide: true, body: h('div', { class: 'grid' },
    (s.photos || []).length || s.photoUrl ? h('div', { class: 'gal' }, [s.photoUrl, ...(s.photos || [])].filter(Boolean).map((u) => h('img', { src: u, alt: '', loading: 'lazy' }))) : null,
    h('div', { class: 'vp-h' }, h('div', { class: 'ph' }, s.photoUrl ? h('img', { src: s.photoUrl, alt: '' }) : icon('shirt', 30)), h('div', null, s.code ? h('div', { class: 'mono small' }, s.code) : null,
      h('div', { class: 'muted small' }, [s.category, s.subcategory, s.brand, s.gender, s.season].filter(Boolean).join(' · ')),
      h('div', { class: 'num' }, h('b', null, inr(s.price)), s.mrp > s.price ? h('s', { class: 'muted small', style: { marginLeft: '6px' } }, inr(s.mrp)) : null, ' ', h('span', { class: 'muted small' }, t('Tax') + ' ' + (s.taxPct != null ? s.taxPct + '%' : t('auto')))),
      S.ctx.canSeeCost && s.cost != null ? h('div', { class: 'muted small' }, t('Cost') + ' ' + inr(s.cost)) : null)),
    (s.description || s.details || s.fabric || s.washcare || s.weightG || s.collection) ? h('div', { class: 'card kvs' }, s.description ? h('p', null, s.description) : null, s.details ? h('p', { class: 'muted small' }, s.details) : null,
      [[t('Fabric'), s.fabric], [t('Wash care'), s.washcare], [t('Weight'), s.weightG ? s.weightG + ' g' : ''], [t('Collection'), s.collection], [t('Type'), s.subcategory]].filter((x) => x[1]).map(([a, b]) => h('div', { class: 'kv' }, h('span', { class: 'muted' }, a), h('b', null, b)))) : null,
    h('div', { class: 'cap' }, t('Stock by colour and size') + (can('sty_stock') ? ' · ' + t('tap a number to adjust') : '')), grid,
    h('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
      can('sty_manage') ? h('button', { class: 'btn', type: 'button', onclick: () => { sh.close(); styleForm(s, changed); } }, icon('edit', 18), t('Edit style')) : null,
      h('button', { class: 'btn', type: 'button', onclick: () => tagsSheet([s]) }, icon('barcode', 18), t('Print tags')),
      can('sty_purchase') ? h('button', { class: 'btn', type: 'button', onclick: () => { sh.close(); receiveForm({ style: s }, changed); } }, icon('truck', 18), t('Receive stock')) : null)) });
}

function adjustSheet(x, s, done) {
  let mode = 'add';
  const q = input({ type: 'number', mode: 'numeric', placeholder: '0' }), nt = input({ placeholder: t('Note (optional)') });
  const bc = can('sty_manage') ? input({ value: x.barcode }) : null;
  const modes = seg([['add', t('Add')], ['remove', t('Remove')], ['damage', t('Damaged')], ['lost', t('Lost')], ['count', t('Count')]], mode, (m) => { mode = m; hint.textContent = m === 'count' ? t('Type what you counted on the shelf. Stock becomes this number.') : ''; });
  const hint = h('div', { class: 'muted small' }, '');
  sheet({ title: `${s.name} · ${x.colour} ${x.size}`, body: h('div', { class: 'grid' }, h('div', { class: 'kv' }, h('span', null, t('In stock')), h('b', { class: 'num' }, x.stock)), modes, hint, field(t('Qty'), q), field(t('Note'), nt),
    can('sty_manage') ? h('div', { class: 'grid', style: { gap: '6px' } }, h('div', { class: 'cap' }, t('Barcode (any type: your own, supplier, EAN, QR text)')), h('div', { class: 'row', style: { gap: '6px' } }, h('div', { class: 'grow' }, bc), h('button', { class: 'btn icon', type: 'button', 'aria-label': t('Scan'), onclick: () => scanWith((c) => { bc.value = c; }) }, icon('camera', 18)), h('button', { class: 'btn icon', type: 'button', 'aria-label': t('Print'), onclick: () => tagsSheet([s], x.id) }, icon('print', 18)))) : h('div', { class: 'muted small' }, 'Barcode ' + x.barcode)),
    actions: [{ label: t('Save'), primary: true, onclick: async (close) => {
      if (bc && bc.value.trim() && bc.value.trim() !== x.barcode) { await api('sty_set_variant', { p_id: x.id, p: { barcode: bc.value.trim() } }); S.catAt = 0; }
      if (q.value === '') { close(); toast(t('Saved')); done(); return; }
      await api('sty_adjust', { p: { branchId: S.branch, variantId: x.id, qty: Math.round(N(q.value)), mode, note: nt.value } });
      close(); S.catAt = 0; toast(t('Stock updated')); done();
    } }] });
}

// ---- style editor ----
function chipEditor(initial, suggestions, label, cap) {
  const items = new Set(initial); const host = h('div', { class: 'chips wrap' });
  const inp = input({ placeholder: t('Type and press Enter') });
  const paint = () => {
    clear(host).append(...[...items].map((x) => h('button', { class: 'chip', type: 'button', 'aria-pressed': 'true', onclick: () => { items.delete(x); paint(); } }, x, icon('x', 12))),
      ...suggestions.filter((x) => !items.has(x)).map((x) => h('button', { class: 'chip', type: 'button', onclick: () => { items.add(x); paint(); } }, '+ ' + x)));
  };
  const addTyped = () => { inp.value.split(',').map((x) => x.trim()).filter(Boolean).forEach((x) => items.add(x)); inp.value = ''; paint(); };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTyped(); } });
  inp.addEventListener('blur', addTyped);
  paint();
  const node = h('div', { class: 'field' }, h('label', null, label), host, inp, cap ? h('div', { class: 'hint' }, cap) : null);
  node.get = () => { addTyped(); return [...items]; }; node.setSuggestions = (s) => { suggestions = s; paint(); };
  return node;
}
function styleForm(s, done) {
  const isNew = !s;
  const f = {
    name: input({ value: s ? s.name : '', placeholder: 'Blue slim shirt' }), brand: input({ value: s ? s.brand || '' : '' }), gender: selectEl(['', 'Men', 'Women', 'Kids', 'Unisex'], s ? s.gender || '' : ''),
    season: input({ value: s ? s.season || '' : '', placeholder: 'Summer 2026' }), hsn: input({ value: s ? s.hsn || '' : '', placeholder: '6105' }),
    price: input({ type: 'number', mode: 'decimal', value: s ? s.price : '' }), mrp: input({ type: 'number', mode: 'decimal', value: s ? s.mrp : '' }), cost: input({ type: 'number', mode: 'decimal', value: s && s.cost != null ? s.cost : '' }),
    tax: input({ type: 'number', mode: 'decimal', value: s && s.taxPct != null ? s.taxPct : '', placeholder: t('auto') }),
    code: input({ value: s ? s.code || '' : '', placeholder: t('Your own code, e.g. TS-101') }),
    type: input({ value: s ? s.subcategory || '' : '', placeholder: 'Slim fit, A-line, Sneakers' }), fabric: input({ value: s ? s.fabric || '' : '', placeholder: 'Cotton, Denim, Linen' }), collection: input({ value: s ? s.collection || '' : '', placeholder: 'Summer 2026' }),
    weight: input({ type: 'number', mode: 'decimal', value: s && s.weightG ? s.weightG : '', placeholder: 'g' }), wash: input({ value: s ? s.washcare || '' : '', placeholder: 'Machine wash cold, do not bleach' }),
    desc: h('textarea', { class: 'textarea', rows: 2, placeholder: t('Short description for the customer') }, s ? s.description || '' : ''), det: h('textarea', { class: 'textarea', rows: 3, placeholder: t('Fit, pockets, stitching, model size…') }, s ? s.details || '' : ''), qty: input({ type: 'number', mode: 'numeric', value: '', placeholder: '0' }), photo: input({ value: s ? s.photoUrl || '' : '', placeholder: 'https://…' }),
  };
  const cat = input({ value: s ? s.category : '', placeholder: 'Shirts' });
  const catList = h('div', { class: 'chips' }, COMMON_CATS.map((c) => h('button', { class: 'chip', type: 'button', onclick: () => { cat.value = c; setSizes(); } }, c)));
  const cols = chipEditor(s ? [...new Set(s.variants.map((x) => x.colour).filter(Boolean))] : [], ['Black', 'White', 'Blue', 'Navy', 'Red', 'Grey', 'Green', 'Beige'], t('Colours'), isNew ? '' : t('Add new colours here. Existing ones keep their stock.'));
  const presetFor = (c) => /jean|trouser|pant/i.test(c) ? SIZE_SETS.Jeans : /foot|shoe|sandal|sneaker|slipper/i.test(c) ? SIZE_SETS.Footwear : /kid/i.test(c) ? SIZE_SETS.Kids : SIZE_SETS.Clothing;
  const szs = chipEditor(s ? [...new Set(s.variants.map((x) => x.size).filter(Boolean))] : [], presetFor(s ? s.category : ''), t('Sizes'), '');
  function setSizes() { szs.setSuggestions(presetFor(cat.value)); }
  cat.addEventListener('input', setSizes);
  const pics = photoEditor(s ? s.photoUrl : '', s ? s.photos : []);
  const seeCost = S.ctx.canSeeCost;
  const body = h('div', { class: 'grid' }, pics, field(t('Name'), f.name), field(t('Product code'), f.code, t('Used to find the style and as the start of each size barcode label. Leave empty to skip.')), field(t('Category'), cat), catList, h('div', { class: 'two' }, field(t('Brand'), f.brand), field(t('Gender'), f.gender)),
    h('div', { class: 'two' }, field(t('Selling price'), f.price), field(t('MRP'), f.mrp)), seeCost ? h('div', { class: 'two' }, field(t('Cost'), f.cost), field(t('Tax %'), f.tax)) : field(t('Tax %'), f.tax),
    h('div', { class: 'two' }, field(t('Type'), f.type), field(t('Fabric'), f.fabric)), h('div', { class: 'two' }, field(t('Collection'), f.collection), field(t('Weight') + ' (g)', f.weight)),
    cols, szs, field(t('Description'), f.desc), field(t('Details'), f.det), field(t('Wash care'), f.wash),
    isNew ? h('div', { class: 'two' }, field(t('Opening stock per size'), f.qty), h('div')) : null,
    h('details', { class: 'more' }, h('summary', null, t('More details')), h('div', { class: 'grid', style: { marginTop: '10px' } }, h('div', { class: 'two' }, field(t('Season'), f.season), field(t('HSN code'), f.hsn)))));
  sheet({ title: isNew ? t('New style') : t('Edit style'), full: true, wide: true, body, actions: [
    s && s.active !== false ? { label: t('Hide style'), danger: true, onclick: async (close) => { if (!await confirmBox(t('Hide style'), t('It will not show on the till. Stock and old bills stay.'), t('Hide'), true)) return false; await api('sty_save_style', { p: { id: s.id, name: s.name, active: false } }); close(); S.catAt = 0; done && done(); } } : (s ? { label: t('Show style'), onclick: async (close) => { await api('sty_save_style', { p: { id: s.id, name: s.name, active: true } }); close(); S.catAt = 0; done && done(); } } : null),
    { label: t('Save'), primary: true, onclick: async (close) => {
      if (!f.name.value.trim()) { toast(t('Give the style a name'), { err: true }); return false; }
      if (!N(f.price.value)) { toast(t('Enter the selling price'), { err: true }); return false; }
      const colours = cols.get(), sizes = szs.get();
      if (isNew && (!colours.length && !sizes.length)) { toast(t('Add at least one size or colour'), { err: true }); return false; }
      const p = { id: s && s.id, name: f.name.value, category: cat.value || 'Clothing', brand: f.brand.value, gender: f.gender.value, code: f.code.value, photoUrl: pics.get().main || null, photos: pics.get().extra, subcategory: f.type.value, fabric: f.fabric.value, collection: f.collection.value, weightG: f.weight.value === '' ? null : N(f.weight.value), washcare: f.wash.value, description: f.desc.value, details: f.det.value, season: f.season.value, hsn: f.hsn.value, 
        price: N(f.price.value), mrp: N(f.mrp.value) || N(f.price.value), taxPct: f.tax.value === '' ? null : N(f.tax.value), colours, sizes };
      if (seeCost && f.cost.value !== '') p.cost = N(f.cost.value);
      if (isNew && N(f.qty.value) > 0) p.opening = { qty: Math.round(N(f.qty.value)), unitCost: N(f.cost.value), branchId: S.branch };
      const r = await api('sty_save_style', { p }); close(); S.catAt = 0; toast(t('Saved'));
      done && done();
      if (isNew && r && r.variants && r.variants.length) { const st = await promptAfterCreate(r); }
    } }].filter(Boolean) });
}
async function promptAfterCreate(style) {
  const go_ = await alertBox({ title: t('Style added'), message: style.variants.length + ' ' + t('items created with barcodes. Print tags now?'), actions: [{ label: t('Print tags'), value: true, role: 'def' }, { label: t('Later'), value: false }] });
  if (go_) { await loadCatalog(true); tagsSheet([S.cat.find((x) => x.id === style.id) || style]); }
}

// ---- barcode tags ----
function tagsSheet(styles, onlyVariant) {
  const vs = styles.flatMap((s) => s.variants.filter((x) => x.active !== false && (!onlyVariant || x.id === onlyVariant)).map((x) => ({ ...x, style: s })));
  const copies = {}; vs.forEach((x) => copies[x.id] = Math.max(1, x.stock > 0 ? x.stock : 1));
  const rows = h('div', { class: 'list' }, vs.map((x) => { const i = input({ type: 'number', mode: 'numeric', value: copies[x.id], oninput: () => { copies[x.id] = Math.max(0, Math.round(N(i.value))); } }); i.style.width = '72px'; return h('div', { class: 'li' }, h('div', { class: 'grow' }, h('div', { class: 't' }, x.style.name), h('div', { class: 's' }, [x.colour, x.size].filter(Boolean).join(' · ') + ' · ' + x.barcode)), i); }));
  const size = selectEl([['50x25', '50 × 25 mm'], ['38x25', '38 × 25 mm'], ['a4', 'A4 sheet (4 × 10)']], '50x25');
  sheet({ title: t('Print tags'), full: true, body: h('div', { class: 'grid' }, h('div', { class: 'muted small' }, t('Copies per item (set to the quantity received). Stick one tag on each piece.')), field(t('Label size'), size), rows),
    actions: [{ label: t('Print'), primary: true, onclick: () => { printTags(vs, copies, size.value); return false; } }] });
}
function printTags(vs, copies, size) {
  const wrap = h('div', { class: 'print-only tags tags-' + size });
  const shop = (S.ctx.settings.shopName || '').slice(0, 24);
  vs.forEach((x) => { for (let i = 0; i < (copies[x.id] || 0); i++) wrap.append(h('div', { class: 'tag-l' }, h('div', { class: 'tg-s' }, shop), h('div', { class: 'tg-n' }, x.style.name.slice(0, 26)), h('div', { class: 'tg-v' }, [x.colour, x.size].filter(Boolean).join(' · ')), barcodeSvg(x.barcode, { height: 34, width: 150 }), h('div', { class: 'tg-c' }, x.barcode), h('div', { class: 'tg-p' }, h('s', null, x.style.mrp > x.price ? inr(x.style.mrp) : ''), ' ', h('b', null, inr(x.price))))); });
  if (!wrap.childNodes.length) return toast(t('Nothing to print'), { err: true });
  const st = document.createElement('style'); st.textContent = '@media print{@page{size:' + (size === 'a4' ? 'A4;margin:8mm' : size.replace('x', 'mm ') + 'mm;margin:0') + '}}'; document.head.append(st);
  document.body.append(wrap); window.print(); setTimeout(() => { wrap.remove(); st.remove(); }, 1000);
}

// ---- transfers between branches ----
async function transfersSheet(done) {
  let list = [];
  try { list = await api('sty_list_transfers') || []; } catch (e) { return fail(e); }
  const brs = S.ctx.branches || []; const nm = (id) => (brs.find((b) => b.id === id) || {}).name || '—';
  const body = h('div', { class: 'grid' },
    brs.length > 1 ? h('button', { class: 'btn fill', type: 'button', onclick: () => { sh.close(); transferForm(done); } }, icon('plus', 18), t('New transfer')) : h('div', { class: 'muted' }, t('Add a second branch or warehouse in Settings to move stock between them.')),
    h('div', { class: 'list' }, list.length ? list.map((x) => h('div', { class: 'li' }, h('div', { class: 'grow' }, h('div', { class: 't' }, x.number + ' · ' + nm(x.fromBranch) + ' → ' + nm(x.toBranch)), h('div', { class: 's' }, x.units + ' ' + t('Units') + ' · ' + fmtDT(x.at))),
      x.status === 'in_transit' ? h('div', { class: 'row', style: { gap: '6px' } }, h('button', { class: 'btn sm fill', type: 'button', onclick: async () => { await api('sty_receive_transfer', { p_id: x.id }); toast(t('Received')); sh.close(); transfersSheet(done); S.catAt = 0; done && done(); } }, t('Receive')), h('button', { class: 'btn sm', type: 'button', onclick: async () => { await api('sty_cancel_transfer', { p_id: x.id }); sh.close(); transfersSheet(done); S.catAt = 0; done && done(); } }, t('Cancel'))) : badge(x.status === 'received' ? t('Received') : t('Cancelled'), x.status === 'received' ? 'green' : ''))) : [empty('swap', t('No transfers yet'))]));
  const sh = sheet({ title: t('Transfers'), closeLabel: t('Done'), body });
}
function transferForm(done) {
  const brs = S.ctx.branches; const from = selectEl(brs.map((b) => [b.id, b.name]), S.branch), to = selectEl(brs.map((b) => [b.id, b.name]), (brs.find((b) => b.id !== S.branch) || {}).id);
  const lines = []; const host = h('div', { class: 'list' });
  const q = searchField(t('Add item: name or barcode'), () => paintRes()); const res = h('div', { class: 'list' });
  const paintHost = () => clear(host).append(...lines.map((l, i) => h('div', { class: 'li' }, h('div', { class: 'grow' }, h('div', { class: 't' }, l.name), h('div', { class: 's' }, l.sub)), h('div', { class: 'stp' }, h('button', { type: 'button', onclick: () => { l.qty = Math.max(1, l.qty - 1); paintHost(); } }, icon('minus', 16)), h('b', null, l.qty), h('button', { type: 'button', onclick: () => { l.qty++; paintHost(); } }, icon('plus', 16))), h('button', { class: 'btn plain icon', type: 'button', onclick: () => { lines.splice(i, 1); paintHost(); } }, icon('x', 16)))));
  const paintRes = () => {
    const k = q.input.value.trim().toLowerCase(); clear(res); if (k.length < 2) return;
    allVariants().filter((x) => x.barcode === k || (x.style.name + ' ' + x.colour + ' ' + x.size).toLowerCase().includes(k)).slice(0, 8).forEach((x) => res.append(liRow({ title: x.style.name, sub: [x.colour, x.size].filter(Boolean).join(' · ') + ' · ' + x.stock + ' ' + t('in stock'), icon: 'plus', onclick: () => { const e = lines.find((l) => l.variantId === x.id); if (e) e.qty++; else lines.push({ variantId: x.id, qty: 1, name: x.style.name, sub: [x.colour, x.size].filter(Boolean).join(' · ') }); paintHost(); q.input.value = ''; clear(res); } })));
  };
  loadCatalog().then(() => {});
  sheet({ title: t('New transfer'), full: true, body: h('div', { class: 'grid' }, h('div', { class: 'two' }, field(t('From'), from), field(t('To'), to)), q, res, host),
    actions: [{ label: t('Send stock'), primary: true, onclick: async (close) => { if (!lines.length) { toast(t('Add at least one item'), { err: true }); return false; } await api('sty_transfer', { p: { id: uid(), fromBranch: from.value, toBranch: to.value, lines: lines.map((l) => ({ variantId: l.variantId, qty: l.qty })) } }); close(); S.catAt = 0; toast(t('Transfer sent')); done && done(); } }] });
}
