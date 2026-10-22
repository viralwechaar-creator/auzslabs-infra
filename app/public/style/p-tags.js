/* AUZsStyle barcode tags: pick a design, choose how many tags per item (stock quantity, one each, or your own number), print.
   Designs live in TAG_DESIGNS; the choice is remembered on this device. Shops named "GenX" start on the GenX premium design. */
'use strict';
const TAG_DESIGNS = [
  { id: 'genx', name: 'GenX premium', build: (x, shop) => h('div', { class: 'tag-g' },
      h('div', { class: 'tg-b' }, (shop || '').toUpperCase().slice(0, 18)),
      h('div', { class: 'tg-sz' }, x.size || ''),
      h('div', { class: 'tg-nm' }, x.style.name.slice(0, 40)),
      h('div', { class: 'tg-cl' }, x.colour || ''),
      h('div', { class: 'tg-bc' }, barcodeSvg(x.barcode, { height: 30, width: 150 })),
      h('div', { class: 'tg-ft' }, h('span', null, x.barcode), h('span', { class: 'tg-pr' }, x.style.mrp > x.price ? h('s', null, inr(x.style.mrp)) : null, h('b', null, inr(x.price))))) },
  { id: 'classic', name: 'Classic', build: (x, shop) => h('div', { class: 'tag-l' }, h('div', { class: 'tg-s' }, shop), h('div', { class: 'tg-n' }, x.style.name.slice(0, 26)), h('div', { class: 'tg-v' }, [x.colour, x.size].filter(Boolean).join(' · ')), barcodeSvg(x.barcode, { height: 34, width: 150 }), h('div', { class: 'tg-c' }, x.barcode), h('div', { class: 'tg-p' }, h('s', null, x.style.mrp > x.price ? inr(x.style.mrp) : ''), ' ', h('b', null, inr(x.price)))) },
];
function tagDesignId() {
  try { const k = localStorage.getItem('sty.tagDesign'); if (TAG_DESIGNS.some((d) => d.id === k)) return k; } catch (e) {}
  return /genx/i.test((S.ctx.settings || {}).shopName || '') ? 'genx' : 'classic';
}
function tagsSheet(styles, onlyVariant, preset) {
  const vs = styles.flatMap((s) => s.variants.filter((x) => x.active !== false && (!onlyVariant || [].concat(onlyVariant).includes(x.id))).map((x) => ({ ...x, style: s })));
  const shop = (S.ctx.settings.shopName || '').slice(0, 24);
  const copies = {}; const setStock = () => vs.forEach((x) => { copies[x.id] = Math.max(1, x.stock > 0 ? x.stock : 1); }); setStock();
  if (preset) vs.forEach((x) => { if (preset[x.id] > 0) copies[x.id] = preset[x.id]; });
  const inputs = {}; const total = h('b'); const prev = h('div', { class: 'tagprev' });
  let design = tagDesignId(); const size = selectEl([['50x25', '50 × 25 mm'], ['38x25', '38 × 25 mm'], ['a4', 'A4 sheet (4 × 10)']], '50x25');
  const dsel = selectEl(TAG_DESIGNS.map((d) => [d.id, d.name]), design);
  const sum = () => { total.textContent = Object.values(copies).reduce((a, b) => a + b, 0); };
  const paintPrev = () => { clear(prev); const d = TAG_DESIGNS.find((q) => q.id === dsel.value) || TAG_DESIGNS[0]; if (vs[0]) prev.append(h('div', { class: 'tags tags-' + size.value + ' tagbox' }, d.build(vs[0], shop))); };
  const setAll = (fn) => { vs.forEach((x) => { copies[x.id] = fn(x); inputs[x.id].value = copies[x.id]; }); sum(); };
  const row = (x) => {
    const i = input({ type: 'number', mode: 'numeric', value: copies[x.id], oninput: () => { copies[x.id] = Math.max(0, Math.round(N(i.value))); sum(); } }); i.style.width = '64px'; i.style.textAlign = 'center'; inputs[x.id] = i;
    const bump = (d) => () => { copies[x.id] = Math.max(0, (copies[x.id] || 0) + d); i.value = copies[x.id]; sum(); };
    return h('div', { class: 'li' }, h('div', { class: 'grow' }, h('div', { class: 't' }, x.style.name), h('div', { class: 's' }, [x.colour, x.size].filter(Boolean).join(' · ') + ' · ' + t('in stock') + ' ' + (x.stock || 0))),
      h('div', { class: 'row', style: { gap: '4px', alignItems: 'center' } }, h('button', { class: 'btn sm', type: 'button', 'aria-label': '-1', onclick: bump(-1) }, '−'), i, h('button', { class: 'btn sm', type: 'button', 'aria-label': '+1', onclick: bump(1) }, '+')));
  };
  const rows = h('div', { class: 'list' }, vs.map(row));
  const quick = h('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } },
    h('button', { class: 'btn sm', type: 'button', onclick: () => setAll((x) => Math.max(1, x.stock > 0 ? x.stock : 1)) }, t('Stock quantity')),
    h('button', { class: 'btn sm', type: 'button', onclick: () => setAll(() => 1) }, t('1 each')),
    h('button', { class: 'btn sm', type: 'button', onclick: () => setAll((x) => (copies[x.id] || 0) + 1) }, '+1 ' + t('all')),
    h('button', { class: 'btn sm', type: 'button', onclick: () => setAll(() => 0) }, t('Clear')));
  dsel.onchange = () => { try { localStorage.setItem('sty.tagDesign', dsel.value); } catch (e) {} paintPrev(); };
  size.onchange = paintPrev; paintPrev(); sum();
  sheet({ title: t('Print tags'), full: true, body: h('div', { class: 'grid' },
      prev, h('div', { class: 'row', style: { gap: '8px' } }, h('div', { class: 'grow' }, field(t('Tag design'), dsel)), h('div', { class: 'grow' }, field(t('Label size'), size))),
      h('div', { class: 'muted small' }, t('Set how many tags to print for each item. One tag goes on each piece.')), h('div', { class: 'row', style: { justifyContent: 'space-between' } }, h('span', { class: 'muted small' }, t('Total tags')), total), quick, rows),
    actions: [{ label: t('Print'), primary: true, onclick: () => { printTags(vs, copies, size.value, dsel.value); return false; } }] });
}
function printTags(vs, copies, size, designId) {
  const d = TAG_DESIGNS.find((q) => q.id === (designId || tagDesignId())) || TAG_DESIGNS[0];
  const wrap = h('div', { class: 'print-only tags tags-' + size });
  const shop = (S.ctx.settings.shopName || '').slice(0, 24);
  vs.forEach((x) => { for (let i = 0; i < (copies[x.id] || 0); i++) wrap.append(d.build(x, shop)); });
  if (!wrap.childNodes.length) return toast(t('Nothing to print'), { err: true });
  const st = document.createElement('style'); st.textContent = '@media print{@page{size:' + (size === 'a4' ? 'A4;margin:8mm' : size.replace('x', 'mm ') + 'mm;margin:0') + '}}'; document.head.append(st);
  document.body.append(wrap); window.print(); setTimeout(() => { wrap.remove(); st.remove(); }, 1000);
}
