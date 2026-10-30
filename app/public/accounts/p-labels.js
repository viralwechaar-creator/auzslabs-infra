/* Print barcodes: pick products and how many labels each, choose a label design and what it shows, see a preview, print.
   Settings are remembered on this device. Barcode = the product's barcode, else its item code (SKU). Code 128, readable by every scanner. */
'use strict';
const LBL_SIZES = { '50x25': ['50 x 25 mm', 50, 25, 1], '38x25': ['38 x 25 mm', 38, 25, 1], '2up': ['2 across, 50 x 25 mm each (103 mm roll)', 50, 25, 2], '40x30': ['40 x 30 mm', 40, 30, 1], '70x35': ['70 x 35 mm', 70, 35, 1], a4: ['A4 sheet (3 x 8 labels)', 63, 34, 3] };
const LBL_DESIGNS = [['standard', 'Standard: shop, name, barcode, price'], ['compact', 'Compact: name and barcode only'], ['price', 'Price tag: big price, small barcode'], ['code', 'Barcode only'], ['minimal', 'Minimal: name and price balanced on one line, barcode below']];
const lblDefaults = { size: '50x25', design: 'standard', shop: true, name: true, price: true, mrp: false, code: true, fs: 9, gap: 3, left: 0 };
const lblCfg = () => { try { return { ...lblDefaults, ...JSON.parse(localStorage.getItem('acc.labels') || '{}') }; } catch { return { ...lblDefaults }; } };
const lblSave = (c) => { try { localStorage.setItem('acc.labels', JSON.stringify(c)); } catch { /* ignore */ } };
const lblCode = (p) => String(p.barcode || p.sku || '').trim();

function lblNode(p, c, w, hgt) {
  const esc = (x) => document.createTextNode(String(x));
  const money_ = (x) => '₹' + Number(x || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const root = h('div', { class: 'lbl lbl-' + c.design, style: { width: w + 'mm', height: hgt + 'mm', fontSize: c.fs + 'px' } });
  const code = lblCode(p);
  const bc = () => { if (!code) return h('div', { class: 'lbl-nc' }, 'no code'); const s = barcodeSvg(code, { width: Math.max(w * 3.6 - 16, 60), height: c.design === 'price' ? 22 : c.design === 'minimal' ? Math.max(hgt * 1.6 - 14, 16) : Math.max(hgt * 1.9 - (c.shop ? 14 : 0) - (c.name ? 14 : 0) - 12, 18) }); s.style.maxWidth = '100%'; return h('div', { class: 'lbl-bc' }, s, c.code ? h('div', { class: 'lbl-ct' }, code) : null); };
  const price = () => h('div', { class: 'lbl-p' }, c.mrp && Number(p.mrp) ? h('span', { class: 'lbl-m' }, 'MRP ' + money_(p.mrp)) : null, c.price ? h('b', null, money_(p.sale_price)) : null);
  if (c.design === 'price') root.append(c.shop && S.org ? h('div', { class: 'lbl-s' }, (S.org.name || '').slice(0, 26)) : null, c.name ? h('div', { class: 'lbl-n' }, (p.name || '').slice(0, 34)) : null, h('div', { class: 'lbl-big' }, money_(p.sale_price)), c.mrp && Number(p.mrp) ? h('div', { class: 'lbl-m' }, 'MRP ' + money_(p.mrp)) : null, bc());
  else if (c.design === 'code') root.append(bc());
  else if (c.design === 'compact') root.append(c.name ? h('div', { class: 'lbl-n' }, (p.name || '').slice(0, 40)) : null, bc(), c.price || c.mrp ? price() : null);
  else if (c.design === 'minimal') root.append(h('div', { class: 'lbl-row' }, c.name ? h('div', { class: 'lbl-n' }, (p.name || '').slice(0, 28)) : h('span'), c.price || c.mrp ? price() : null), bc());
  else root.append(c.shop && S.org ? h('div', { class: 'lbl-s' }, (S.org.name || '').slice(0, 26)) : null, c.name ? h('div', { class: 'lbl-n' }, (p.name || '').slice(0, 40)) : null, bc(), c.price || c.mrp ? price() : null);
  void esc; return root;
}
const LBL_CSS = '.lbl{box-sizing:border-box;padding:1mm 1.5mm;overflow:hidden;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;background:#fff;color:#000;line-height:1.15;font-family:Arial,sans-serif}.lbl-s{font-size:.85em;font-weight:700;letter-spacing:.04em;text-transform:uppercase}.lbl-n{font-weight:600;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.lbl-bc svg{display:block;margin:0 auto}.lbl-ct{font:.8em monospace;letter-spacing:.06em}.lbl-p{display:flex;gap:6px;align-items:baseline;justify-content:center}.lbl-p b{font-size:1.2em}.lbl-m{font-size:.85em;text-decoration:line-through}.lbl-big{font-size:2em;font-weight:800}.lbl-nc{font-size:.8em;color:#b00}' +
  '.lbl-minimal{justify-content:space-between;padding:1.6mm 2.2mm}.lbl-minimal .lbl-row{display:flex;align-items:baseline;justify-content:space-between;width:100%;gap:8px}.lbl-minimal .lbl-n{font-weight:500;color:#222;text-align:left}.lbl-minimal .lbl-p{justify-content:flex-end;flex:none}.lbl-minimal .lbl-p b{font-weight:700}.lbl-minimal .lbl-bc{width:100%;margin-top:2px}.lbl-minimal .lbl-bc svg{width:100%}';
const LBL_PRINT = '@media print{html.auz-lock body,body{position:static!important;height:auto!important;overflow:visible!important}.lblsheet{display:block!important}.lblpage{page-break-after:always;break-after:page;display:flex;align-items:flex-start;margin:0;padding:0}.lblpage:last-child{page-break-after:auto;break-after:auto}.lblgrid{display:grid;page-break-after:always;break-after:page}.lblgrid:last-child{page-break-after:auto}}';

function lblPrint(items, c) {
  const sz = LBL_SIZES[c.size], w = sz[1], hgt = sz[2], per = sz[3];
  const made = []; items.forEach(({ p, n }) => { for (let i = 0; i < n; i++) made.push(lblNode(p, c, w, hgt)); });
  if (!made.length) return toast('Choose at least one product and a number of labels', { err: true });
  const wrap = h('div', { class: 'print-only lblsheet' });
  if (c.size === 'a4') { const perPage = 24; for (let i = 0; i < made.length; i += perPage) { const g = h('div', { class: 'lblgrid', style: { gridTemplateColumns: 'repeat(3,' + w + 'mm)', gridAutoRows: hgt + 'mm', width: '210mm', padding: '8mm 8mm' } }); made.slice(i, i + perPage).forEach((x) => g.append(x)); wrap.append(g); } }
  else if (per === 2) { for (let i = 0; i < made.length; i += 2) { const pg = h('div', { class: 'lblpage', style: { width: (100 + c.gap) + 'mm', height: hgt + 'mm', paddingLeft: c.left + 'mm', gap: c.gap + 'mm' } }, made[i], made[i + 1] || ''); wrap.append(pg); } }
  else made.forEach((x) => wrap.append(h('div', { class: 'lblpage', style: { width: w + 'mm', height: hgt + 'mm' } }, x)));
  const st = document.createElement('style'); st.textContent = LBL_CSS + LBL_PRINT + '@media print{@page{size:' + (c.size === 'a4' ? 'A4;margin:0' : per === 2 ? (100 + c.gap) + 'mm ' + hgt + 'mm;margin:0' : w + 'mm ' + hgt + 'mm;margin:0') + '}}'; document.head.append(st);
  document.body.append(wrap); window.print(); setTimeout(() => { wrap.remove(); st.remove(); }, 1500);
}

page('labels', {
  title: 'Print barcodes', icon: 'scan', perm: 'acc_view',
  async render(v) {
    v.header({ title: 'Print barcodes' });
    const c = lblCfg(), qty = {}; let list = []; await products().catch(() => {}); list = (S.products || []).filter((p) => p.active !== false && !p.is_service);
    const pre = (v.q.get('ids') || '').split(',').filter(Boolean); pre.forEach((id) => { qty[id] = 1; });
    let filter = '';
    const docId = v.q.get('doc'); let fromDoc = '';
    if (docId) { try { const r = await api('acc_get_document', { p_id: docId }); fromDoc = r.doc.number || ''; (r.lines || []).forEach((l) => { if (l.product_id) qty[l.product_id] = (qty[l.product_id] || 0) + Math.max(Math.round(Number(l.qty)) || 0, 0); }); } catch (e) { fail(e); } }
    const prevEl = h('div', { class: 'lblprev' }), listEl = h('div', { class: 'list' }), totEl = h('div', { class: 'muted small' });
    const save = () => { lblSave(c); paintPrev(); };
    const items = () => list.filter((p) => qty[p.id] > 0).map((p) => ({ p, n: qty[p.id] }));
    function paintPrev() {
      const it = items(), sample = it[0] ? it[0].p : (list[0] || { name: 'Sample item', sale_price: 100, mrp: 120, sku: '1234567890' }), sz = LBL_SIZES[c.size];
      clear(prevEl).append(h('style', null, LBL_CSS + '.lblprev{display:flex;gap:10px;align-items:center;padding:14px;border:1px dashed var(--sep);border-radius:12px;background:var(--bg2);overflow:auto}.lblprev .lbl{border:1px solid #ccc;flex:none;transform:scale(1.5);transform-origin:left center;margin-right:40px}'), lblNode(sample, c, sz[1], sz[2]));
      totEl.textContent = it.reduce((a, x) => a + x.n, 0) + ' labels for ' + it.length + ' products';
    }
    function paintList() {
      const q = filter.toLowerCase(), shown = list.filter((p) => !q || [p.name, p.sku, p.barcode].some((x) => String(x || '').toLowerCase().includes(q))).slice(0, 80);
      clear(listEl).append(...shown.map((p) => {
        const inp = input({ mode: 'numeric', value: qty[p.id] || '', placeholder: '0', label: 'Labels for ' + p.name, oninput: (e) => { const n = parseInt(e.target.value, 10); qty[p.id] = n > 0 ? n : 0; paintPrev(); } }); inp.style.width = '70px'; inp.style.textAlign = 'right';
        return h('div', { class: 'li' }, h('div', { class: 'grow' }, h('div', { class: 't' }, p.name), h('div', { class: 's' }, [lblCode(p) || 'No code yet', 'stock ' + qty_(p.stock)].join(' · '))), inp);
      }), shown.length === 0 ? h('div', { class: 'li muted' }, 'No products match.') : null);
    }
    const qty_ = (x) => (x == null ? '0' : String(Number(x)));
    const opt = (label, key) => toggleRow(label, !!c[key], (x) => { c[key] = x; save(); });
    const sizeSel = selectEl(Object.entries(LBL_SIZES).map(([k, x]) => [k, x[0]]), c.size, { label: 'Label size', onchange: () => { c.size = sizeSel.value; save(); paintTwo(); } });
    const designSel = selectEl(LBL_DESIGNS, c.design, { label: 'Design', onchange: () => { c.design = designSel.value; save(); } });
    const fs = input({ mode: 'numeric', value: c.fs, label: 'Text size', onchange: (e) => { c.fs = Math.min(14, Math.max(6, parseInt(e.target.value, 10) || 9)); save(); } });
    const gap = input({ mode: 'decimal', value: c.gap, label: 'Gap between labels', onchange: (e) => { c.gap = Number(e.target.value) || 0; save(); } }), left = input({ mode: 'decimal', value: c.left, label: 'Shift right', onchange: (e) => { c.left = Number(e.target.value) || 0; save(); } });
    const twoEl = h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' } }, field('Gap between the two labels (mm)', gap), field('Shift right (mm)', left));
    const paintTwo = () => { twoEl.hidden = c.size !== '2up'; }; paintTwo();
    const fillStock = h('button', { class: 'btn', type: 'button', onclick: () => { list.forEach((p) => { if (Number(p.stock) > 0) qty[p.id] = Math.min(Math.round(Number(p.stock)), 500); }); paintList(); paintPrev(); } }, 'Use stock quantities'), clearAll = h('button', { class: 'btn', type: 'button', onclick: () => { Object.keys(qty).forEach((k) => { qty[k] = 0; }); paintList(); paintPrev(); } }, 'Clear');
    v.root.append(h('div', { class: 'grid', style: { gap: '14px', maxWidth: '860px', margin: '0 auto', width: '100%' } },
      fromDoc ? h('div', { class: 'banner info' }, 'Labels filled from bill ' + fromDoc + ': one label for every piece bought. Change the numbers below if you need.') : null,
      h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, '1. Design your label')), h('div', { class: 'card grid' },
        h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' } }, field('Label size', sizeSel), field('Design', designSel)), twoEl,
        h('div', { class: 'list' }, opt('Shop name', 'shop'), opt('Product name', 'name'), opt('Selling price', 'price'), opt('MRP', 'mrp'), opt('Barcode number under the bars', 'code')), field('Text size (6 to 14)', fs), prevEl)),
      h('div', { class: 'sec' }, h('div', { class: 'sec-h' }, h('h3', null, '2. How many labels of each product?')), h('div', { class: 'card grid' },
        searchField('Search products', debounce((x) => { filter = x; paintList(); }, 200)), h('div', { class: 'row wrap', style: { gap: '8px' } }, fillStock, clearAll), listEl, totEl)),
      h('button', { class: 'btn fill', type: 'button', onclick: () => lblPrint(items(), c) }, icon('print', 18), 'Print labels'),
      h('p', { class: 'muted small' }, 'Products with no barcode use their item code. Set the printer\'s paper size to the label size above. Your choices are remembered on this computer.')));
    paintList(); paintPrev();
  },
});
