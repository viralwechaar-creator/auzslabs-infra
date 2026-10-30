/* AUZsStyle barcode tags: pick a design, choose how many tags per item (stock quantity, one each, or your own number), print.
   Designs live in TAG_DESIGNS; the choice is remembered on this device. Shops named "GenX" start on the GenX premium design. */
'use strict';
const TAG_DESIGNS = [
  { id: 'genx', name: 'GenX premium', build: (x, shop) => h('div', { class: 'tag-g' },
      h('div', { class: 'tg-b' }, (shop || '').toUpperCase().slice(0, 18)),
      h('div', { class: 'tg-sz' }, x.size || ''),
      h('div', { class: 'tg-nm' }, x.style.name.slice(0, 40)),
      h('div', { class: 'tg-cl' }, x.colour || ''),
      h('div', { class: 'tg-bc' }, barcodeSvg(x.barcode, { height: 27, width: 160 })),
      h('div', { class: 'tg-ft' }, h('span', null, x.barcode), h('span', { class: 'tg-pr' }, x.style.mrp > x.price ? h('s', null, inr(x.style.mrp)) : null, h('b', null, inr(x.price))))) },
  { id: 'classic', name: 'Classic', build: (x, shop) => h('div', { class: 'tag-l' }, h('div', { class: 'tg-s' }, shop), h('div', { class: 'tg-n' }, x.style.name.slice(0, 26)), h('div', { class: 'tg-v' }, [x.colour, x.size].filter(Boolean).join(' · ')), barcodeSvg(x.barcode, { height: 30, width: 155 }), h('div', { class: 'tg-c' }, x.barcode), h('div', { class: 'tg-p' }, h('s', null, x.style.mrp > x.price ? inr(x.style.mrp) : ''), ' ', h('b', null, inr(x.price)))) },
  { id: 'minimal', name: 'Minimal (price only)', build: (x, shop) => h('div', { class: 'tag-m' },
      h('div', { class: 'tg-mn' }, x.style.name.slice(0, 30)),
      h('div', { class: 'tg-bc' }, barcodeSvg(x.barcode, { height: 24, width: 150 })),
      h('div', { class: 'tg-mf' }, h('span', null, x.barcode), h('b', null, inr(x.price)))) },
  { id: 'detailed', name: 'Detailed (shop + size + colour + MRP)', build: (x, shop) => h('div', { class: 'tag-d' },
      h('div', { class: 'tg-dh' }, h('span', null, (shop || '').slice(0, 22)), h('span', null, x.size || '')),
      h('div', { class: 'tg-dn' }, x.style.name.slice(0, 34)),
      h('div', { class: 'tg-dc' }, x.colour || ''),
      h('div', { class: 'tg-bc' }, barcodeSvg(x.barcode, { height: 26, width: 152 })),
      h('div', { class: 'tg-c' }, x.barcode),
      h('div', { class: 'tg-dp' }, x.style.mrp > x.price ? h('s', null, inr(x.style.mrp)) : null, h('b', null, inr(x.price)))) },
  { id: 'compact', name: 'Compact (small, fits any label)', build: (x, shop) => h('div', { class: 'tag-c' },
      h('div', { class: 'tg-cn' }, [x.style.name.slice(0, 26), x.size].filter(Boolean).join(' · ')),
      h('div', { class: 'tg-cb' }, barcodeSvg(x.barcode, { height: 30, width: 160 })),
      h('div', { class: 'tg-cf' }, h('span', null, x.barcode), h('b', null, inr(x.price)))) },
];
function tagDesignId() {
  try { const k = localStorage.getItem('sty.tagDesign'); if (TAG_DESIGNS.some((d) => d.id === k)) return k; } catch (e) {}
  return /genx/i.test((S.ctx.settings || {}).shopName || '') ? 'genx' : 'classic';
}
function tagSizePref() { try { const k = localStorage.getItem('sty.tagSize'); if (['50x25', '2up', '38x25', 'a4'].includes(k)) return k; } catch (e) {} return '50x25'; }
function tagGeo() { let g = { gap: 3, left: 0, top: 0, pitch: 25 }; try { g = { ...g, ...JSON.parse(localStorage.getItem('sty.tagGeo') || '{}') }; } catch (e) {} g.gap = Math.max(0, Math.min(20, +g.gap || 0)); g.left = Math.max(-10, Math.min(20, +g.left || 0)); g.top = Math.max(-10, Math.min(10, +g.top || 0)); g.pitch = Math.max(20, Math.min(32, +g.pitch || 25)); return g; }
function tagsSheet(styles, onlyVariant, preset) {
  const vs = styles.flatMap((s) => s.variants.filter((x) => x.active !== false && (!onlyVariant || [].concat(onlyVariant).includes(x.id))).map((x) => ({ ...x, style: s })));
  const shop = (S.ctx.settings.shopName || '').slice(0, 24);
  const copies = {}; const setStock = () => vs.forEach((x) => { copies[x.id] = Math.max(1, x.stock > 0 ? x.stock : 1); }); setStock();
  if (preset) vs.forEach((x) => { if (preset[x.id] > 0) copies[x.id] = preset[x.id]; });
  const inputs = {}; const total = h('b'); const prev = h('div', { class: 'tagprev' });
  let design = tagDesignId(); const size = selectEl([['50x25', '50 × 25 mm'], ['2up', '2 across (50 × 25 mm each)'], ['38x25', '38 × 25 mm'], ['a4', 'A4 sheet (4 × 10)']], tagSizePref());
  const dsel = selectEl(TAG_DESIGNS.map((d) => [d.id, d.name]), design);
  const note = h('div', { class: 'muted small' });
  let paintAll = null;
  const sum = () => { if (paintAll) paintAll(); const n = Object.values(copies).reduce((a, b) => a + b, 0); total.textContent = n; note.textContent = size.value === '2up' ? t('Prints') + ' ' + n + ' ' + t('labels, two across, so') + ' ' + Math.ceil(n / 2) + ' ' + t('rows (pages)') + '.' : size.value === 'a4' ? t('Prints on') + ' ' + Math.ceil(n / 40) + ' ' + t('A4 sheets, 40 tags each') : t('Prints') + ' ' + n + ' ' + t('labels, one label per page. The print window shows page 1 of') + ' ' + n + '.'; };
  const paintPrev = () => { if (paintAll) paintAll(); clear(prev); const d = TAG_DESIGNS.find((q) => q.id === dsel.value) || TAG_DESIGNS[0]; if (vs[0]) prev.append(h('div', { class: 'tags tags-' + size.value + ' tagbox' }, d.build(vs[0], shop))); };
  const setAll = (fn) => { vs.forEach((x) => { copies[x.id] = fn(x); inputs[x.id].value = copies[x.id]; }); sum(); };
  const row = (x) => {
    const i = input({ type: 'number', mode: 'numeric', value: copies[x.id], oninput: () => { copies[x.id] = Math.max(0, Math.round(N(i.value))); sum(); } }); i.style.width = '64px'; i.style.textAlign = 'center'; inputs[x.id] = i;
    const bump = (d) => () => { copies[x.id] = Math.max(0, (copies[x.id] || 0) + d); i.value = copies[x.id]; sum(); };
    return h('div', { class: 'li' }, h('div', { class: 'grow' }, h('div', { class: 't' }, x.style.name), h('div', { class: 's' }, [x.colour, x.size].filter(Boolean).join(' · ') + ' · ' + t('in stock') + ' ' + (x.stock || 0))),
      h('div', { class: 'row', style: { gap: '4px', alignItems: 'center' } }, h('button', { class: 'btn sm', type: 'button', 'aria-label': '-1', onclick: bump(-1) }, '−'), i, h('button', { class: 'btn sm', type: 'button', 'aria-label': '+1', onclick: bump(1) }, '+')));
  };
  const rows = h('div', { class: 'list' }, vs.map(row));
  const all = h('div', { class: 'tagall' }); let showAll = false;
  paintAll = () => { clear(all); if (!showAll) return; const d = TAG_DESIGNS.find((q) => q.id === dsel.value) || TAG_DESIGNS[0]; const list = vs.filter((x) => (copies[x.id] || 0) > 0); all.append(...list.map((x) => h('div', { class: 'tagone' }, h('div', { class: 'tags tags-' + size.value + ' tagbox' }, d.build(x, shop)), h('div', { class: 'q' }, '× ' + copies[x.id])))); if (!list.length) all.append(h('div', { class: 'muted small' }, t('Nothing to print'))); };
  const seeAll = h('button', { class: 'btn sm', type: 'button', onclick: () => { showAll = !showAll; seeAll.textContent = showAll ? t('Hide all tags') : t('Preview all tags'); paintAll(); } }, t('Preview all tags'));
  const quick = h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } },
    h('button', { class: 'btn sm', type: 'button', onclick: () => setAll((x) => Math.max(1, x.stock > 0 ? x.stock : 1)) }, t('Stock quantity')),
    h('button', { class: 'btn sm', type: 'button', onclick: () => setAll(() => 1) }, t('1 each')),
    h('button', { class: 'btn sm', type: 'button', onclick: () => setAll((x) => (copies[x.id] || 0) + 1) }, '+1 ' + t('all')),
    h('button', { class: 'btn sm', type: 'button', onclick: () => setAll(() => 0) }, t('Clear')), seeAll);
  dsel.onchange = () => { try { localStorage.setItem('sty.tagDesign', dsel.value); } catch (e) {} paintPrev(); };
  const geo = tagGeo(); const gapI = input({ type: 'number', mode: 'decimal', value: geo.gap }); const leftI = input({ type: 'number', mode: 'decimal', value: geo.left }); const topI = input({ type: 'number', mode: 'decimal', value: geo.top }); const pitchI = input({ type: 'number', mode: 'decimal', value: geo.pitch });
  const geoBox = h('div', { class: 'row', style: { gap: '8px' } }, h('div', { class: 'grow' }, field(t('Gap between the two labels (mm)'), gapI)), h('div', { class: 'grow' }, field(t('Shift right (mm, negative = left)'), leftI)), h('div', { class: 'grow' }, field(t('Shift down (mm, negative = up)'), topI)), h('div', { class: 'grow' }, field(t('Row step (mm, label height + gap)'), pitchI)));
  const saveGeo = () => { try { localStorage.setItem('sty.tagGeo', JSON.stringify({ gap: N(gapI.value), left: N(leftI.value), top: N(topI.value), pitch: N(pitchI.value) })); } catch (e) {} }; gapI.oninput = saveGeo; leftI.oninput = saveGeo; topI.oninput = saveGeo; pitchI.oninput = saveGeo;
  const showGeo = () => { geoBox.style.display = size.value === '2up' ? '' : 'none'; };
  size.onchange = () => { try { localStorage.setItem('sty.tagSize', size.value); } catch (e) {} showGeo(); paintPrev(); sum(); }; showGeo(); paintPrev(); sum();
  sheet({ title: t('Print tags'), full: true, body: h('div', { class: 'grid' },
      prev, h('div', { class: 'row', style: { gap: '8px' } }, h('div', { class: 'grow' }, field(t('Tag design'), dsel)), h('div', { class: 'grow' }, field(t('Label size'), size))), geoBox,
      h('div', { class: 'muted small' }, t('Set how many tags to print for each item. Every item has its own barcode. Tags print item by item, in this list order.')), h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('span', { class: 'muted small' }, t('Total tags')), total), note, quick, all, rows),
    actions: [{ label: t('Print'), primary: true, onclick: () => { printTags(vs, copies, size.value, dsel.value); return false; } }] });
}
function printTags(vs, copies, size, designId) {
  const d = TAG_DESIGNS.find((q) => q.id === (designId || tagDesignId())) || TAG_DESIGNS[0];
  const wrap = h('div', { class: 'print-only tags tags-' + size });
  const shop = (S.ctx.settings.shopName || '').slice(0, 24);
  const made = []; vs.forEach((x) => { for (let i = 0; i < (copies[x.id] || 0); i++) made.push(d.build(x, shop)); });
  if (size === '2up') { for (let i = 0; i < made.length; i += 2) { const pg = h('div', { class: 'tagpage' }); pg.append(made[i]); if (made[i + 1]) pg.append(made[i + 1]); wrap.append(pg); } } else made.forEach((n) => wrap.append(n));
  if (!wrap.childNodes.length) return toast(t('Nothing to print'), { err: true });
  const g = tagGeo(); wrap.style.setProperty('--top', g.top + 'mm'); wrap.style.setProperty('--pitch', g.pitch + 'mm'); if (size === '2up') { wrap.style.setProperty('--gap', g.gap + 'mm'); wrap.style.setProperty('--left', g.left + 'mm'); }
  const st = document.createElement('style'); st.textContent = '@media print{@page{size:' + (size === 'a4' ? 'A4;margin:8mm' : size === '2up' ? (100 + g.gap) + 'mm ' + g.pitch + 'mm;margin:0' : size.replace('x', 'mm ') + 'mm;margin:0') + '}}'; document.head.append(st);
  document.body.append(wrap); window.print(); setTimeout(() => { wrap.remove(); st.remove(); }, 1000);
}
