/* AUZsStyle: Stock. Styles list -> a style opens its colour x size grid. Add/edit a style (variants are made from
   colours x sizes with barcodes), adjust or count stock, print barcode tags, move stock between branches. */
'use strict';
const SU = { q: '', cat: 'All', f: 'all' };
const SEL = { on: false, ids: new Set() };
page('stock', {
  title: 'Stock', perm: 'sty_view',
  async render(v) {
    v.header({ title: t('Stock'), actions: [can('sty_manage') ? { label: t('New style'), icon: 'plus', primary: true, run: () => styleForm(null, () => v.refresh()) } : null,
      can('sty_manage') ? { label: SEL.on ? t('Done selecting') : t('Select'), icon: 'check', run: () => { SEL.on = !SEL.on; SEL.ids.clear(); v.refresh(); } } : null,
      { label: t('Collections'), icon: 'tag', run: () => collectionsSheet(() => v.refresh()) },
      can('sty_stock') ? { label: t('Transfers'), icon: 'swap', run: () => transfersSheet(() => v.refresh()) } : null,
      can('sty_manage') ? { label: t('Export Excel'), icon: 'download', run: () => exportInventoryExcel() } : null,
      can('sty_stock') ? { label: t('Import Excel'), icon: 'upload', run: () => importInventorySheet(() => v.refresh()) } : null].filter(Boolean) });
    const root = v.root; root.append(h('div', { class: 'spin', style: { color: 'var(--tint)', margin: '30px auto' } }));
    try { await loadCatalog(true); } catch (e) { return clear(root).append(empty('cloudOff', t('Could not load'), e.message, h('button', { class: 'btn fill', onclick: () => v.refresh() }, t('Try again')))); }
    await loadCollections();
    const vs = allVariants().filter((x) => x.active !== false);
    const units = vs.reduce((a, x) => a + Math.max(x.stock, 0), 0), cost = vs.reduce((a, x) => a + Math.max(x.stock, 0) * (x.cost || 0), 0), retail = vs.reduce((a, x) => a + Math.max(x.stock, 0) * x.price, 0);
    const lowN = vs.filter((x) => x.stock <= (x.reorderAt || 0)).length, outN = vs.filter((x) => x.stock <= 0).length;
    const cats = ['All', ...[...new Set(S.cat.map((s) => s.category))].sort()];
    const list = h('div', { class: 'igrid' }); const chips = h('div', { class: 'chips' });
    const filtHost = h('span'); const paintF = () => clear(filtHost).append(filterButton(() => { paintF(); paint(); }));
    const paintChips = () => clear(chips).append(...cats.map((c) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(SU.cat === c), onclick: () => { SU.cat = c; paintChips(); paint(); } }, c === 'All' ? t('All') : c)));
    const flt = seg([['all', t('All')], ['low', t('Low stock')], ['out', t('Out of stock')]], SU.f, (x) => { SU.f = x; paint(); }, { full: true });
    let CUR = []; const selH = h('div');
    function paintSel() {
      clear(selH); if (!SEL.on) return;
      selH.append(h('div', { class: 'selbar' }, h('b', null, SEL.ids.size + ' ' + t('selected')),
        h('button', { class: 'btn sm', type: 'button', onclick: () => { CUR.forEach((x) => SEL.ids.add(x.id)); paint(); } }, t('Select all') + ' (' + CUR.length + ')'),
        h('button', { class: 'btn sm', type: 'button', onclick: () => { SEL.ids.clear(); paint(); } }, t('Clear')),
        h('button', { class: 'btn sm', type: 'button', disabled: !SEL.ids.size, onclick: () => tagsSheet(S.cat.filter((x) => SEL.ids.has(x.id))) }, icon('barcode', 16), t('Print tags')),
        h('button', { class: 'btn sm fill', type: 'button', disabled: !SEL.ids.size, onclick: () => bulkEditSheet([...SEL.ids], () => { SEL.ids.clear(); v.refresh(); }) }, t('Edit selected')),
        h('button', { class: 'btn sm danger', type: 'button', disabled: !SEL.ids.size, onclick: () => bulkDelete([...SEL.ids], () => { SEL.ids.clear(); v.refresh(); }) }, t('Delete selected'))));
    }
    function paint() {
      const q = SU.q.trim().toLowerCase();
      let rows = S.cat.filter((s) => (SU.cat === 'All' || s.category === SU.cat) && styleMatches(s) && (!q || (s.name + ' ' + (s.brand || '') + ' ' + (s.code || '') + ' ' + (s.fabric || '') + ' ' + (s.collection || '')).toLowerCase().includes(q) || s.variants.some((x) => x.barcode === q || (x.sku || '').toLowerCase() === q)));
      if (SU.f === 'low') rows = rows.filter((s) => s.variants.some((x) => x.active !== false && x.stock > 0 && x.stock <= (x.reorderAt || 0)));
      if (SU.f === 'out') rows = rows.filter((s) => s.variants.some((x) => x.active !== false && x.stock <= 0));
      CUR = rows; paintSel();
      clear(list).append(...(rows.length ? rows.map((s) => {
        const st = styleStock(s), sizes = [...new Set(s.variants.map((x) => x.size))].length, cols = [...new Set(s.variants.map((x) => x.colour))].length;
        const mx = Math.max(1, ...S.cat.map(styleStock)), lowS = s.variants.some((x) => x.active !== false && x.stock > 0 && x.stock <= (x.reorderAt || 0));
        const tone = st <= 0 ? 'z' : lowS || st <= 3 ? 'lo' : 'ok';
        return h('button', { class: 'icard' + (s.active === false ? ' off' : '') + (SEL.on && SEL.ids.has(s.id) ? ' sel' : ''), type: 'button', onclick: () => { if (SEL.on) { SEL.ids.has(s.id) ? SEL.ids.delete(s.id) : SEL.ids.add(s.id); paint(); } else styleSheet(s.id, () => v.refresh()); } },
          SEL.on ? h('span', { class: 'ic-tick' + (SEL.ids.has(s.id) ? ' on' : '') }, SEL.ids.has(s.id) ? icon('check', 14) : null) : null,
          h('div', { class: 'ic-p' }, s.photoUrl ? h('img', { src: thumbOf(s.photoUrl), alt: '', loading: 'lazy', onerror: (e) => { const i = e.target; if (i.src !== s.photoUrl) i.src = s.photoUrl; } }) : icon('shirt', 24)),
          h('div', { class: 'ic-b' },
            h('div', { class: 'ic-t' }, h('span', { class: 'ic-n' }, s.name), h('span', { class: 'ic-pr num' }, inr(s.price))),
            h('div', { class: 'ic-s' }, [s.category, s.fabric, cols + ' ' + t('colours'), sizes + ' ' + t('sizes')].filter(Boolean).join(' · ')),
            h('div', { class: 'ic-f' }, h('span', { class: 'ic-chip ' + (s.badge === 'soldout' ? 'z' : tone) }, st <= 0 || s.badge === 'soldout' ? t('Out of stock') : st + ' ' + t('in stock')), s.badge === 'limited' ? h('span', { class: 'ic-chip' }, t('Limited stock')) : null, s.active === false ? h('span', { class: 'ic-chip' }, t('Hidden')) : null,
              h('span', { class: 'ic-bar' }, h('i', { class: tone, style: { width: Math.max(4, Math.min(100, st / mx * 100)) + '%' } })))));
      }) : [empty('shirt', S.cat.length ? t('No match') : t('No styles yet'), S.cat.length ? '' : t('Add a style to start. You can also load a small sample to look around.'),
        can('sty_manage') && !S.cat.length ? h('div', { class: 'row', style: { gap: '8px', justifyContent: 'center' } }, h('button', { class: 'btn fill', onclick: () => styleForm(null, () => v.refresh()) }, t('New style')), h('button', { class: 'btn', onclick: async () => { await api('sty_load_sample'); toast(t('Sample added')); v.refresh(); } }, t('Load sample'))) : null)]));
    }
    clear(root); if (!isDesk()) root.append(h('h1', { class: 'large-title' }, t('Stock')));
    root.append(h('div', { class: 'kpis' }, kpi(t('Units'), nf0.format(units), `${S.cat.length} ${t('styles')}`), kpi(t('Stock value'), inr(cost, 0), t('at cost')), kpi(t('Retail value'), inr(retail, 0)), kpi(t('Low stock'), lowN, outN + ' ' + t('Out of stock'), null, lowN ? 'neg' : '')),
      h('div', { class: 'toolbar' }, h('div', { class: 'row', style: { gap: '8px' } }, h('div', { class: 'grow' }, searchField(t('Search styles, scan a barcode'), (x) => { SU.q = x; paint(); }, SU.q)), filtHost, h('button', { class: 'btn icon', type: 'button', 'aria-label': t('Scan'), onclick: () => scanWith((c) => { const f = findBarcode(c), sc = findStyleCode(c); const st = f ? f.style : sc; if (st) { styleSheet(st.id, () => v.refresh()); } else toast(t('No item with that code'), { err: true }); }) }, icon('camera', 18)), h('button', { class: 'btn icon', type: 'button', 'aria-label': t('Print tags'), onclick: () => tagsSheet(S.cat.filter((x) => x.active !== false && styleMatches(x))) }, icon('barcode', 18))), chips, flt), selH, list);
    list.before ? 0 : 0;
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
  const sh = sheet({ title: s.name, closeLabel: t('Done'), full: true, wide: true, body: h('div', { class: 'grid stk' },
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
      ...(can('sty_manage') ? [['limited', t('Limited stock')], ['soldout', t('Sold out')]].map(([k, l]) => h('button', { class: 'btn' + (s.badge === k ? ' fill' : ''), type: 'button', 'aria-pressed': String(s.badge === k), onclick: async () => { try { await api('sty_set_badge', { p_id: s.id, p_badge: s.badge === k ? null : k }); S.catAt = 0; sh.close(); toast(t('Saved')); changed && changed(); } catch (e) { toast(e.message || t('Failed'), { err: true }); } } }, l)) : []),
      can('sty_manage') ? h('button', { class: 'btn', type: 'button', onclick: () => { sh.close(); styleCollectionsSheet(s, () => { changed && changed(); styleSheet(id, changed); }); } }, icon('tag', 18), t('Add to collection')) : null,
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
    actions: [{ label: t('Save'), primary: true, onclick: async (close) => { await saveAdj(); close(); S.catAt = 0; toast(q.value === '' ? t('Saved') : t('Stock updated')); done(); } },
      { label: t('Save & print tags'), onclick: async (close) => { const n = await saveAdj(); close(); S.catAt = 0; toast(t('Stock updated')); done(); await loadCatalog(true).catch(() => {}); const s2 = S.cat.find((z) => z.id === s.id) || s; tagsSheet([s2], x.id, n > 0 ? { [x.id]: n } : null); } }] });
  async function saveAdj() {
    if (bc && bc.value.trim() && bc.value.trim() !== x.barcode) { await api('sty_set_variant', { p_id: x.id, p: { barcode: bc.value.trim() } }); S.catAt = 0; }
    if (q.value === '') return 0;
    const n = Math.round(N(q.value));
    await api('sty_adjust', { p: { branchId: S.branch, variantId: x.id, qty: n, mode, note: nt.value } });
    return mode === 'add' ? n : 0;
  }
}

// ---- style editor ----
function chipEditor(initial, suggestions, label, cap) {
  const items = new Set(initial); const host = h('div', { class: 'chips wrap' }); let node = null;
  const inp = input({ placeholder: t('Type and press Enter') });
  const paint = () => {
    clear(host).append(...[...items].map((x) => h('button', { class: 'chip', type: 'button', 'aria-pressed': 'true', onclick: () => { items.delete(x); paint(); } }, x, icon('x', 12))),
      ...suggestions.filter((x) => !items.has(x)).map((x) => h('button', { class: 'chip', type: 'button', onclick: () => { items.add(x); paint(); } }, '+ ' + x)));
    if (node && node.onChange) node.onChange();
  };
  const addTyped = () => { inp.value.split(',').map((x) => x.trim()).filter(Boolean).forEach((x) => items.add(x)); inp.value = ''; paint(); };
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTyped(); } });
  inp.addEventListener('blur', addTyped);
  paint();
  node = h('div', { class: 'field' }, h('label', null, label), host, inp, cap ? h('div', { class: 'hint' }, cap) : null);
  node.peek = () => [...items]; node.get = () => { addTyped(); return [...items]; }; node.setSuggestions = (s) => { suggestions = s; paint(); };
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
  const cat = input({ value: s ? s.category : '', placeholder: t('Pick one below or type a new category') });
  const mine = [...new Set(S.cat.map((x) => x.category).filter(Boolean))];
  const catList = h('div', { class: 'chips' }, [...mine, ...COMMON_CATS.filter((c) => !mine.some((m) => m.toLowerCase() === c.toLowerCase()))].map((c) => h('button', { class: 'chip', type: 'button', onclick: () => { cat.value = c; setSizes(); } }, c)));
  const cols = chipEditor(s ? [...new Set(s.variants.map((x) => x.colour).filter(Boolean))] : [], ['Black', 'White', 'Blue', 'Navy', 'Red', 'Grey', 'Green', 'Beige'], t('Colours'), isNew ? '' : t('Add new colours here. Existing ones keep their stock.'));
  const presetFor = (c) => /jean|trouser|pant/i.test(c) ? SIZE_SETS.Jeans : /foot|shoe|sandal|sneaker|slipper/i.test(c) ? SIZE_SETS.Footwear : /kid/i.test(c) ? SIZE_SETS.Kids : SIZE_SETS.Clothing;
  const szs = chipEditor(s ? [...new Set(s.variants.map((x) => x.size).filter(Boolean))] : [], presetFor(s ? s.category : ''), t('Sizes'), '');
  function setSizes() { szs.setSuggestions(presetFor(cat.value)); }
  cat.addEventListener('input', setSizes);
  const one = capOff('multi_pictures'); // plan allows one picture per style
  const pics = photoEditor(s ? s.photoUrl : '', s ? s.photos : [], one);
  // pictures per colour: the till switches to these when a colour is picked
  const colPics = {}; const colHost = h('div', { class: 'grid' }); const colInit = (s && s.colourPhotos) || {};
  const paintColPics = () => {
    const cs = cols.peek(); cs.forEach((c) => { if (!colPics[c]) colPics[c] = photoEditor((colInit[c] || [])[0] || '', (colInit[c] || []).slice(1)); colPics[c].onChange = () => { typeof paintUse === 'function' && paintUse(); }; });
    clear(colHost).append(...cs.map((c) => h('div', { class: 'card grid' }, h('div', { class: 'cap' }, c), colPics[c])));
    colWrap.style.display = cs.length && !one ? '' : 'none';
  };
  const colWrap = h('div', { class: 'field' }, h('label', null, t('Pictures per colour')), h('div', { class: 'hint' }, t('Optional. When a colour is picked on the till, its pictures show instead.')), colHost);
  cols.onChange = paintColPics; paintColPics();
  // where each picture shows on the online store: product card, home hero, collection banner
  const use = Object.assign({}, (s && s.photoUse) || {}); const useHost = h('div', { class: 'grid' });
  const allPics = () => { const out = []; const add = (u) => { if (u && !out.includes(u)) out.push(u); }; const g = pics.get(); add(g.main); g.extra.forEach(add); cols.peek().forEach((c) => { const x = colPics[c] && colPics[c].get(); if (x) { add(x.main); x.extra.forEach(add); } }); return out; };
  const paintUse = () => {
    const all = allPics(); const roles = [['card', t('Product card'), t('Shop grids and the card stack')], ['hero', t('Home hero'), t('The big picture at the top of the shop')], ['banner', t('Collection banner'), t('Wide collection pictures')]];
    Object.keys(use).forEach((k) => { if (!all.includes(use[k])) delete use[k]; });
    clear(useHost).append(...roles.map(([k, label, hint]) => h('div', null, h('div', { class: 'cap' }, label + ' · ' + hint),
      h('div', { class: 'pe-grid' }, all.length ? all.map((u, i) => h('button', { class: 'pe-t' + ((use[k] || all[0]) === u ? ' on' : ''), type: 'button', style: { outline: (use[k] || all[0]) === u ? '2px solid var(--accent, #800020)' : '' }, title: i === 0 && !use[k] ? t('Default') : '', onclick: () => { if (i === 0) delete use[k]; else use[k] = u; paintUse(); } }, h('img', { src: u, alt: '' }))) : h('div', { class: 'hint' }, t('Add pictures first')) ))));
  };
  const useWrap = h('div', { class: 'field' }, h('label', null, t('Where each picture shows')), h('div', { class: 'hint' }, t('Optional. By default the main picture is used everywhere. Tap a picture to use it for that place.')), useHost);
  pics.onChange = paintUse; paintUse();
  // show on the till as: normal / limited stock (exclusivity, display only) / sold out (cannot be added to a bill)
  let badge = (s && s.badge) || '';
  const badgeHost = h('div', { class: 'chips' });
  const paintBadge = () => clear(badgeHost).append(...[['', t('Normal')], ['limited', t('Limited stock')], ['soldout', t('Sold out')]].map(([k, l]) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(badge === k), onclick: () => { badge = k; paintBadge(); } }, l)));
  paintBadge();
  const badgeField = h('div', { class: 'field' }, h('label', null, t('Show on the till as')), badgeHost, h('div', { class: 'hint' }, t('Limited stock is only a label for exclusivity. Sold out also stops this style from being added to a bill.')));
  const seeCost = S.ctx.canSeeCost;
  const spanOf = (n) => { n.classList.add('span'); return n; };
  const body = h('div', { class: 'grid edgrid' }, spanOf(pics), field(t('Name'), f.name), field(t('Product code'), f.code, t('Used to find the style and as the start of each size barcode label. Leave empty to skip.')), field(t('Category'), cat, t('Type any name to add your own category. It appears everywhere once the style is saved.')), spanOf(catList), h('div', { class: 'two' }, field(t('Brand'), f.brand), field(t('Gender'), f.gender)),
    h('div', { class: 'two' }, field(t('Selling price'), f.price), field(t('MRP'), f.mrp)), seeCost ? h('div', { class: 'two' }, field(t('Cost'), f.cost), field(t('Tax %'), f.tax)) : field(t('Tax %'), f.tax),
    h('div', { class: 'two' }, field(t('Type'), f.type), field(t('Fabric'), f.fabric)), h('div', { class: 'two' }, field(t('Collection'), f.collection), field(t('Weight') + ' (g)', f.weight)),
    spanOf(cols), spanOf(colWrap), spanOf(useWrap), spanOf(szs), spanOf(badgeField), spanOf(field(t('Description'), f.desc)), spanOf(field(t('Details'), f.det)), spanOf(field(t('Wash care'), f.wash)),
    isNew ? h('div', { class: 'two' }, field(t('Opening stock per size'), f.qty), h('div')) : null,
    spanOf(h('details', { class: 'more' }, h('summary', null, t('More details')), h('div', { class: 'grid', style: { marginTop: '10px' } }, h('div', { class: 'two' }, field(t('Season'), f.season), field(t('HSN code'), f.hsn))))));
  // simple entry (new styles only): name, optional variant, selling price, stock. Everything else keeps its default.
  let simple = false; try { simple = isNew && localStorage.getItem('sty.simpleNew') === '1'; } catch (e) {}
  const sf = { name: input({ placeholder: 'Blue slim shirt' }), variant: input({ placeholder: t('e.g. M, 32 or Blue (leave empty if none)') }), price: input({ type: 'number', mode: 'decimal' }), qty: input({ type: 'number', mode: 'numeric' }) };
  const simpleBody = h('div', { class: 'grid' }, field(t('Item name'), sf.name), field(t('Variant (optional)'), sf.variant), h('div', { class: 'two' }, field(t('Selling price'), sf.price), field(t('Stock quantity'), sf.qty)),
    h('div', { class: 'hint' }, t('Each variant gets its own barcode. You can add pictures, sizes and more later by editing the style.')));
  const modeBtns = h('div', { class: 'seg', role: 'tablist' });
  const paintMode = () => { simpleBody.style.display = simple ? '' : 'none'; body.style.display = simple ? 'none' : ''; clear(modeBtns).append(...[[false, t('Full entry')], [true, t('Simple entry')]].map(([k, l]) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(simple === k), class: simple === k ? 'on' : '', onclick: () => { simple = k; try { localStorage.setItem('sty.simpleNew', k ? '1' : '0'); } catch (e) {} paintMode(); } }, l))); };
  paintMode();
  const wrapBody = isNew ? h('div', { class: 'grid' }, modeBtns, simpleBody, body) : body;
  sheet({ title: isNew ? t('New style') : t('Edit style'), full: true, wide: true, body: wrapBody, actions: [
    s ? { label: t('Delete style'), danger: true, onclick: async (close) => { if (!await confirmBox(t('Delete this style?'), t('It is removed completely, with its sizes, colours and stock records. Old bills keep their details. This cannot be undone.'), t('Delete'), true)) return false; try { await api('sty_delete_styles', { p: { ids: [s.id] } }); } catch (e) { fail(e); return false; } close(); S.catAt = 0; toast(t('Style deleted')); try { await loadCatalog(true); } catch (e) { /* offline */ } done && done(); } } : null,
    s && s.active !== false ? { label: t('Hide style'), danger: true, onclick: async (close) => { if (!await confirmBox(t('Hide style'), t('It will not show on the till. Stock and old bills stay.'), t('Hide'), true)) return false; await api('sty_save_style', { p: { id: s.id, name: s.name, active: false } }); close(); S.catAt = 0; done && done(); } } : (s ? { label: t('Show style'), onclick: async (close) => { await api('sty_save_style', { p: { id: s.id, name: s.name, active: true } }); close(); S.catAt = 0; done && done(); } } : null),
    { label: t('Save'), primary: true, onclick: async (close) => {
      if (isNew && simple) { f.name.value = sf.name.value; f.price.value = sf.price.value; f.qty.value = sf.qty.value; f.mrp.value = ''; }
      if (!f.name.value.trim()) { toast(t('Give the style a name'), { err: true }); return false; }
      if (!N(f.price.value)) { toast(t('Enter the selling price'), { err: true }); return false; }
      const colours = simple && isNew ? [] : cols.get(), sizes = simple && isNew ? [sf.variant.value.trim()] : szs.get();
      if (isNew && !simple && (!colours.length && !sizes.length)) { toast(t('Add at least one size or colour'), { err: true }); return false; }
      const p = { id: s && s.id, name: f.name.value, category: cat.value || 'Clothing', brand: f.brand.value, gender: f.gender.value, code: f.code.value, photoUrl: pics.get().main || null, photos: pics.get().extra, subcategory: f.type.value, fabric: f.fabric.value, collection: f.collection.value, weightG: f.weight.value === '' ? null : N(f.weight.value), washcare: f.wash.value, description: f.desc.value, details: f.det.value, season: f.season.value, hsn: f.hsn.value, 
        price: N(f.price.value), mrp: N(f.mrp.value) || N(f.price.value), taxPct: f.tax.value === '' ? null : N(f.tax.value), colours, sizes };
      if (seeCost && f.cost.value !== '') p.cost = N(f.cost.value);
      if (isNew && N(f.qty.value) > 0) p.opening = { qty: Math.round(N(f.qty.value)), unitCost: N(f.cost.value), branchId: S.branch };
      if (isNew) {
        p.newId = uid();
        let c2 = colours.map((x) => String(x).trim()), z2 = sizes.map((x) => String(x).trim());
        if (!c2.length && z2.length) c2 = ['']; if (!z2.length && c2.length) z2 = [''];
        const keys = []; c2.forEach((c) => z2.forEach((z) => keys.push(c + '|' + z)));
        p.variantIds = {}; keys.forEach((k) => { p.variantIds[k] = uid(); });
        const codes = takeBarcodes(keys.length);   // reserved while online, so tags can be printed even with no connection
        if (codes) { p.barcodes = {}; keys.forEach((k, i) => { p.barcodes[k] = codes[i]; }); }
      }
      const r = await api('sty_save_style', { p });
      const cp = {}; cols.peek().forEach((c) => { const g = colPics[c] && colPics[c].get(); if (g && g.main) cp[c] = [g.main, ...g.extra]; });
      if (Object.keys(cp).length || Object.keys(colInit).length) await api('sty_set_colour_photos', { p_id: r.id, p: cp });
      { const want = JSON.stringify(Object.keys(use).sort().map((k) => [k, use[k]])), had = JSON.stringify(Object.keys((s && s.photoUse) || {}).sort().map((k) => [k, s.photoUse[k]])); if (want !== had) await api('sty_set_photo_use', { p_id: r.id, p: { card: use.card || '', hero: use.hero || '', banner: use.banner || '' } }); }
      if (badge !== ((s && s.badge) || '')) await api('sty_set_badge', { p_id: r.id, p_badge: badge || null });
      close(); S.catAt = 0; toast(t('Saved'));
      done && done();
      if (isNew && r && r.variants && r.variants.length) { const st = await promptAfterCreate(r); }
    } }].filter(Boolean) });
}
async function promptAfterCreate(style) {
  const go_ = await alertBox({ title: t('Style added'), message: style.variants.length + ' ' + t('items created with barcodes. Print tags now?'), actions: [{ label: t('Print tags'), value: true, role: 'def' }, { label: t('Later'), value: false }] });
  if (go_) { await loadCatalog(true); tagsSheet([S.cat.find((x) => x.id === style.id) || style]); }
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

// ---- bulk edit / bulk delete of the chosen styles ----
function bulkEditSheet(ids, done) {
  const mine = (f) => [...new Set(S.cat.map((x) => x[f]).filter(Boolean))];
  const opts = (arr, keep) => [['', keep || t('Keep as is')], ...arr.map((x) => [x, x])];
  const cat = input({ placeholder: t('Keep as is') }); cat.setAttribute('list', 'bk-cats');
  const dl = h('datalist', { id: 'bk-cats' }, mine('category').map((c) => h('option', { value: c })));
  const brand = input({ placeholder: t('Keep as is') }), season = input({ placeholder: t('Keep as is') }), coll = input({ placeholder: t('Keep as is') }), hsn = input({ placeholder: t('Keep as is') });
  const tax = input({ type: 'number', mode: 'decimal', placeholder: t('Keep as is') });
  const gender = selectEl(opts(['Men', 'Women', 'Unisex', 'Kids']), '');
  const badge = selectEl([['', t('Keep as is')], ['normal', t('Normal')], ['limited', t('Limited stock')], ['soldout', t('Sold out')]], '');
  const vis = selectEl([['', t('Keep as is')], ['true', t('Show on the till')], ['false', t('Hide')]], '');
  const mode = selectEl([['', t('No price change')], ['pct', t('Change by percent (+ or -)')], ['amt', t('Change by rupees (+ or -)')]], '');
  const val = input({ type: 'number', mode: 'decimal', placeholder: '10  or  -5' });
  const body = h('div', { class: 'grid' }, h('p', { class: 'muted small' }, ids.length + ' ' + t('styles will change. Only the boxes you fill in are changed.')), dl,
    field(t('Category'), cat), h('div', { class: 'edgrid' }, field(t('Brand'), brand), field(t('For'), gender), field(t('Season'), season), field(t('Collection'), coll), field(t('HSN'), hsn), field(t('GST %'), tax)),
    h('div', { class: 'edgrid' }, field(t('Price'), mode), field(t('By how much'), val)),
    h('div', { class: 'edgrid' }, field(t('Label on the till'), badge), field(t('Visibility'), vis)));
  sheet({ title: t('Edit selected styles'), body, actions: [{ label: t('Apply to') + ' ' + ids.length, primary: true, onclick: async (close) => {
    const set = {}; [['category', cat], ['brand', brand], ['season', season], ['collection', coll], ['hsn', hsn], ['taxPct', tax], ['gender', gender], ['badge', badge], ['active', vis]].forEach(([k, el]) => { if (el.value !== '') set[k] = el.value; });
    const adj = mode.value && val.value !== '' ? { mode: mode.value, value: N(val.value) } : null;
    if (!Object.keys(set).length && !adj) { toast(t('Fill in at least one box'), { err: true }); return false; }
    if (adj && !(await confirmBox(t('Change prices'), t('This changes the selling price (and MRP) of') + ' ' + ids.length + ' ' + t('styles.'), t('Change prices')))) return false;
    try { const r = await api('sty_bulk_edit', { p: { ids, set, priceAdjust: adj } }); toast(r.changed + ' ' + t('styles updated')); close(); await loadCatalog(true).catch(() => {}); done(); } catch (e) { toast(e.message || t('Failed'), { err: true }); return false; }
  } }] });
}
async function bulkDelete(ids, done) {
  if (!(await confirmBox(t('Delete') + ' ' + ids.length + ' ' + t('styles?'), t('They are removed completely, with their sizes, colours and stock records. Old bills keep their details. This cannot be undone.'), t('Delete'), true))) return;
  try { const r = await api('sty_delete_styles', { p: { ids } }); toast(r.deleted + ' ' + t('deleted') + (r.hidden ? ' · ' + r.hidden + ' ' + t('hidden (they have history)') : '')); await loadCatalog(true).catch(() => {}); done(); } catch (e) { toast(e.message || t('Failed'), { err: true }); }
}

// ---- inventory in/out as a real Excel file (not a code file) ----
// Columns: a shop owner can edit Price and Stock in Excel and bring it back in; every other column is for reference
// (Style/Colour/Size identify the row, Barcode is the real matching key when present).
const INV_HEAD = [t('Style'), t('Category'), t('Brand'), t('Colour'), t('Size'), t('Barcode'), t('SKU'), t('Price'), t('MRP'), t('Stock')];
function exportInventoryExcel() {
  const rows = allVariants().map((x) => [x.style.name, x.style.category || '', x.style.brand || '', x.colour || '', x.size || '', x.barcode || '', x.sku || '', x.price, x.style.mrp ?? '', x.stock]);
  exportXLSX('auzsstyle-inventory-' + new Date().toISOString().slice(0, 10), INV_HEAD, rows);
}
function importInventorySheet(done) {
  const file = h('input', { type: 'file', accept: '.xlsx,.csv', class: 'hidden' });
  file.onchange = async () => {
    const f = file.files[0]; if (!f) return;
    let rows; try { rows = await readTable(f); } catch (e) { toast(e.message || t('Could not read that file'), { err: true }); return; }
    if (rows.length < 2) { toast(t('That sheet has no rows to import'), { err: true }); return; }
    const head = rows[0].map((x) => String(x).trim().toLowerCase());
    const col = (name) => head.indexOf(name.toLowerCase());
    const iBar = col('Barcode'), iStyle = col('Style'), iCol = col('Colour'), iSize = col('Size'), iPrice = col('Price'), iStock = col('Stock');
    if (iBar < 0 && (iStyle < 0 || iCol < 0 || iSize < 0)) { toast(t('This sheet needs a Barcode column, or Style + Colour + Size columns, to match each row to a product'), { err: true }); return; }
    const vs = allVariants();
    let updated = 0, priceChanges = 0, stockChanges = 0; const notFound = [];
    if (!(await confirmBox(t('Import this sheet?'), t('Rows are matched by barcode (or by style, colour and size). Price and Stock in the sheet will overwrite what is in AUZsStyle for every matching row.'), t('Import')))) return;
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r]; if (!row.some((c) => String(c).trim() !== '')) continue;
      const barcode = iBar >= 0 ? String(row[iBar] || '').trim() : '';
      let x = barcode ? vs.find((v) => v.barcode === barcode) : null;
      if (!x && iStyle >= 0) x = vs.find((v) => v.style.name.trim().toLowerCase() === String(row[iStyle] || '').trim().toLowerCase() && (iCol < 0 || (v.colour || '').trim().toLowerCase() === String(row[iCol] || '').trim().toLowerCase()) && (iSize < 0 || (v.size || '').trim().toLowerCase() === String(row[iSize] || '').trim().toLowerCase()));
      if (!x) { notFound.push(barcode || (row[iStyle] || '') + ' ' + (row[iCol] || '') + ' ' + (row[iSize] || '')); continue; }
      let touched = false;
      if (iPrice >= 0 && row[iPrice] !== '' && row[iPrice] != null) { const np = N(row[iPrice]); if (isFinite(np) && np >= 0 && Math.abs(np - x.price) > .005) { try { await api('sty_set_variant', { p_id: x.id, p: { price: np } }); priceChanges++; touched = true; } catch (e) {} } }
      if (iStock >= 0 && row[iStock] !== '' && row[iStock] != null) { const ns = Math.round(N(row[iStock])); if (isFinite(ns) && ns >= 0 && ns !== x.stock) { try { await api('sty_adjust', { p: { variantId: x.id, qty: ns, mode: 'count', note: t('Excel import') } }); stockChanges++; touched = true; } catch (e) {} } }
      if (touched) updated++;
    }
    await loadCatalog(true).catch(() => {});
    toast(updated + ' ' + t('rows updated') + ' (' + priceChanges + ' ' + t('price') + ', ' + stockChanges + ' ' + t('stock') + ')' + (notFound.length ? ' · ' + notFound.length + ' ' + t('rows did not match any product') : ''));
    done && done();
  };
  document.body.append(file); file.click(); setTimeout(() => file.remove(), 3000);
}
