/* AUZsStyle: helpers shared by the pages (colours, bill maths preview, receipt, pickers). The server (sty_sell) does the
   real maths; calcBill() below is the same formula so the screen and the saved bill agree. */
'use strict';
const COLOURS = { black: '#1c1c1e', white: '#ffffff', red: '#d92d20', blue: '#2563eb', navy: '#1e2a52', green: '#2f9e5b', yellow: '#f5c518', pink: '#ec6f9c', grey: '#8e8e93', gray: '#8e8e93', brown: '#7a4b2a',
  maroon: '#7a1f3d', orange: '#f08a24', purple: '#7b4bb7', beige: '#d9c3a0', cream: '#f2e9d8', tan: '#b98a5b', olive: '#6b7a2e', teal: '#1f8a8a', indigo: '#33407a', khaki: '#b5a36a', mustard: '#d4a017', peach: '#f4b69a', sky: '#7cc4f0', lavender: '#b9a6e3', wine: '#800020', silver: '#c0c0c5', gold: '#d4af37' };
function colourDot(name, size = 14) {
  const k = String(name || '').toLowerCase().trim(); let c = COLOURS[k];
  if (!c) for (const w of k.split(/[\s-]+/)) if (COLOURS[w]) { c = COLOURS[w]; break; }
  return h('span', { class: 'cdot', title: name, style: { width: size + 'px', height: size + 'px', background: c || 'transparent', borderColor: c ? 'var(--sep2, rgba(0,0,0,.2))' : 'var(--label3)' } });
}
const SIZE_SETS = { Clothing: ['XS', 'S', 'M', 'L', 'XL', 'XXL'], Jeans: ['28', '30', '32', '34', '36', '38'], Footwear: ['6', '7', '8', '9', '10', '11'], Kids: ['2-3Y', '4-5Y', '6-7Y', '8-9Y', '10-11Y'] };
const COMMON_CATS = ['Shirts', 'T-shirts', 'Jeans', 'Trousers', 'Dresses', 'Kurtas', 'Ethnic', 'Jackets', 'Innerwear', 'Kids', 'Footwear', 'Accessories'];
const sizeRank = (s) => { const o = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL']; const i = o.indexOf(String(s).toUpperCase()); return i >= 0 ? i : (parseFloat(s) || 99) + 20; };
const byRank = (a, b) => sizeRank(a.size) - sizeRank(b.size);

// ---- bill maths (mirror of sty_sell) ----
// lines: [{unit, qty, discPct, discAmt, taxPct}]  opts: {billDiscPct, billDiscAmt, redeemPoints, customer}
function taxRate(st, styleRate, unit) {
  if (styleRate != null && styleRate !== '') return Number(styleRate);
  for (const e of (Array.isArray(st.taxSlabs) ? st.taxSlabs : [])) if (e.upto == null || unit <= Number(e.upto)) return Number(e.rate);
  return Number(st.defaultTaxPct || 0);
}
function calcBill(lines, o = {}) {
  const st = (S.ctx && S.ctx.settings) || {};
  let sub = 0, ld = 0, after = 0;
  const L = lines.map((l) => {
    const gross = r2(l.unit * l.qty);
    let d = l.discPct ? gross * l.discPct / 100 : (l.discAmt || 0);
    d = r2(Math.min(Math.max(d, 0), gross));
    sub += gross; ld += d; after += gross - d;
    return { ...l, gross, ld: d, after: gross - d };
  });
  let bd = o.billDiscPct ? after * o.billDiscPct / 100 : (o.billDiscAmt || 0);
  bd = r2(Math.min(Math.max(bd, 0), after));
  let tot = 0, tax = 0;
  for (const l of L) {
    const share = after > 0 ? r2(bd * l.after / after) : 0;
    let net = l.after - share;
    const rate = taxRate(st, l.taxPct, net / l.qty);
    let tx;
    if (st.priceIncludesTax !== false) tx = r2(net - net / (1 + rate / 100)); else { tx = r2(net * rate / 100); net += tx; }
    l.net = net; l.tax = tx; l.rate = rate; l.disc = l.ld + share;
    tot += net; tax += tx;
  }
  const rnd = st.roundOff !== false ? Math.round(tot) - tot : 0;
  const discTotal = ld + bd;
  return { lines: L, subtotal: r2(sub), discount: r2(discTotal), discPct: sub > 0 ? discTotal / sub * 100 : 0, tax: r2(tax), rounding: r2(rnd), total: r2(tot + rnd) };
}

// ---- receipt ----
function shopHeader() { const s = S.ctx.settings; return { name: s.shopName || (S.dash.tenant && S.dash.tenant.name) || 'Shop', address: s.address, phone: s.phone, gstin: s.gstin, footer: s.billFooter }; }
function receiptNode(sale) {
  const sh = shopHeader(), d = new Date(sale.at || Date.now());
  const row = (a, b, cls) => h('div', { class: 'rc-r' + (cls ? ' ' + cls : '') }, h('span', null, a), h('span', { class: 'num' }, b));
  return h('div', { class: 'receipt' },
    h('div', { class: 'rc-h' }, (S.ctx.settings && S.ctx.settings.logoUrl) ? h('img', { class: 'rc-logo', src: S.ctx.settings.logoUrl, alt: '' }) : null, h('b', null, sh.name), sh.address ? h('div', null, sh.address) : null, sh.phone ? h('div', null, sh.phone) : null, sh.gstin ? h('div', null, 'GSTIN ' + sh.gstin) : null),
    h('div', { class: 'rc-sep' }),
    row(sale.number || '—', d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })),
    sale.customer ? row(sale.customer.name, sale.customer.phone || '') : null,
    h('div', { class: 'rc-sep' }),
    sale.lines.map((l) => h('div', { class: 'rc-l' }, h('div', null, l.name + (l.colour ? ' · ' + l.colour : '') + (l.size ? ' · ' + l.size : '')), row(l.qty + ' × ' + inr(l.price), inr(l.net)))),
    h('div', { class: 'rc-sep' }),
    row(t('Subtotal'), inr(sale.subtotal)),
    sale.discount > 0 ? row(t('Discount'), '-' + inr(sale.discount)) : null,
    row(t('Tax') + ' (incl.)', inr(sale.tax)),
    sale.rounding ? row(t('Round off'), inr(sale.rounding)) : null,
    row(t('Total'), inr(sale.total), 'big'),
    (sale.payments || []).map((p) => row(String(p.mode).toUpperCase(), inr(p.amount))),
    sale.balance > 0 ? row(t('Due'), inr(sale.balance), 'big') : null,
    sale.pointsEarned ? h('div', { class: 'rc-f' }, '+' + sale.pointsEarned + ' ' + t('Points')) : null,
    h('div', { class: 'rc-f' }, sh.footer || 'Thank you, visit again'));
}
function printReceipt(sale) {
  const wrap = h('div', { class: 'print-only' }, receiptNode(sale));
  document.body.append(wrap); window.print(); setTimeout(() => wrap.remove(), 800);
}
function waText(sale) {
  const sh = shopHeader();
  const lines = sale.lines.map((l) => `${l.qty} × ${l.name}${l.colour ? ' ' + l.colour : ''}${l.size ? ' ' + l.size : ''} — ${inr(l.net)}`).join('\n');
  return `*${sh.name}*\nBill ${sale.number}\n${lines}\n\nTotal: ${inr(sale.total)}${sale.balance > 0 ? '\nDue: ' + inr(sale.balance) : ''}\n${sh.footer || 'Thank you, visit again'}`;
}
function shareWa(sale, phone) {
  const p = String(phone || (sale.customer && sale.customer.phone) || '').replace(/\D/g, '');
  const url = 'https://wa.me/' + (p ? (p.length === 10 ? '91' + p : p) : '') + '?text=' + encodeURIComponent(waText(sale));
  window.open(url, '_blank', 'noopener');
}

// ---- pickers ----
function customerPicker(onPick) {
  let list = [], q = '';
  const box = h('div', { class: 'list' });
  const paint = () => {
    clear(box).append(...(list.length ? list : []).map((c) => liRow({ icon: 'user', title: c.name, sub: [c.phone, c.points ? c.points + ' ' + t('Points') : '', c.credit > 0 ? t('Store credit') + ' ' + inr(c.credit) : ''].filter(Boolean).join(' · '), onclick: () => { s.close(); onPick(c); } })));
    if (!list.length) box.append(h('div', { class: 'muted small', style: { padding: '14px' } }, q ? t('No match') : ''));
  };
  const load = debounce(async () => { try { list = await api('sty_list_customers', { p_q: q, p_limit: 30 }) || []; } catch { list = []; } paint(); }, 200);
  const s = sheet({ title: t('Customer'), closeLabel: t('Cancel'), body: h('div', { class: 'grid' },
    searchField(t('Name or phone'), (v) => { q = v; load(); }),
    h('button', { class: 'btn', type: 'button', onclick: () => { s.close(); customerForm(null, onPick); } }, icon('plus', 18), t('New customer')), box) });
  load();
}
function customerForm(c, onSaved) {
  const name = input({ value: c ? c.name : '', placeholder: t('Name') }), ph = input({ value: c ? c.phone || '' : '', mode: 'tel', placeholder: t('Phone') });
  const size = input({ value: c ? c.usualSize || '' : '', placeholder: 'M / 32 / 8' }), bday = input({ type: 'date', value: c && c.birthday ? String(c.birthday).slice(0, 10) : '' });
  const notes = h('textarea', { class: 'textarea', rows: 2 }, c ? c.notes || '' : '');
  sheet({ title: c ? t('Edit customer') : t('New customer'), body: h('div', { class: 'grid' }, field(t('Name'), name), field(t('Phone'), ph), field(t('Usual size'), size), field(t('Birthday'), bday), field(t('Notes'), notes)),
    actions: [{ label: t('Save'), primary: true, onclick: async (close) => {
      if (!name.value.trim()) { toast(t('Enter a name'), { err: true }); return false; }
      const r = await api('sty_save_customer', { p: { id: c && c.id, name: name.value, phone: ph.value, usualSize: size.value, birthday: bday.value || null, notes: notes.value } });
      close(); onSaved && onSaved(r);
    } }] });
}
// period picker used by Overview / Analytics / Bills
function ymd(d) { const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return x.toISOString().slice(0, 10); }
function rangeFor(k, custom) {
  const t0 = new Date(); const d = (n) => { const x = new Date(t0); x.setDate(x.getDate() - n); return ymd(x); };
  if (k === 'today') return { from: d(0), to: d(0) };
  if (k === 'yesterday') return { from: d(1), to: d(1) };
  if (k === 'week') return { from: d(6), to: d(0) };
  if (k === 'month') return { from: ymd(new Date(t0.getFullYear(), t0.getMonth(), 1)), to: d(0) };
  if (k === '30') return { from: d(29), to: d(0) };
  return custom || { from: d(29), to: d(0) };
}
function rangePicker(state, onChange, keys = ['today', 'yesterday', 'week', 'month', '30', 'custom']) {
  const LBL = { today: 'Today', yesterday: 'Yesterday', week: 'This week', month: 'This month', 30: 'Last 30 days', custom: 'Pick dates' };
  const wrap = h('div', { class: 'grid', style: { gap: '8px' } });
  const paint = () => {
    clear(wrap).append(h('div', { class: 'chips' }, keys.map((k) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(state.k === k), onclick: () => { state.k = k; if (k !== 'custom') { Object.assign(state, rangeFor(k)); onChange(); paint(); } else paint(); } }, t(LBL[k])))));
    if (state.k === 'custom') {
      const a = input({ type: 'date', value: state.from }), b = input({ type: 'date', value: state.to });
      wrap.append(h('div', { class: 'row', style: { gap: '8px' } }, a, b, h('button', { class: 'btn fill', type: 'button', onclick: () => { if (a.value && b.value) { state.from = a.value; state.to = b.value; onChange(); } } }, t('Go'))));
    }
  };
  paint(); return wrap;
}
const fmtDay = (s) => s ? new Date(String(s).slice(0, 10) + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : '';
const pct = (a, b) => b > 0 ? Math.round((a - b) / b * 100) : (a > 0 ? 100 : 0);
function csvDownload(name, rows) {
  const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const blob = new Blob(['﻿' + rows.map((r) => r.map(q).join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove();
}

// ---- pictures: shrink in the browser, upload to the shop's own storage ----
async function shrinkImage(file, max = 1280, q = .78) {
  // every picture is resized (longest side 1280 px) and re-encoded as WebP (JPEG where WebP is unsupported); the smaller of original and result is kept
  const bmp = await createImageBitmap(file); const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  const cx = cv.getContext('2d'); cx.drawImage(bmp, 0, 0, cv.width, cv.height);
  const enc = (type) => new Promise((res) => cv.toBlob(res, type, q));
  let out = await enc('image/webp'); if (!out || out.type !== 'image/webp') { cx.globalCompositeOperation = 'destination-over'; cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height); out = await enc('image/jpeg'); }
  const okType = /^image\/(jpeg|png|webp)$/.test(file.type);
  return okType && k === 1 && file.size <= out.size ? file : out;
}
async function uploadPhoto(file) {
  const blob = await shrinkImage(file);
  const ext = blob.type === 'image/webp' ? 'webp' : blob.type === 'image/png' ? 'png' : 'jpg';
  const name = 'style/' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) + '.' + ext;
  const { error } = await sb.storage.from('site').upload(name, blob, { contentType: blob.type });
  if (error) throw new Error(error.message || t('Upload failed'));
  return sb.storage.from('site').getPublicUrl(name).data.publicUrl;
}
// main picture + extra pictures editor: value {main, extra[]}; returns a node with .get()
function photoEditor(main, extra) {
  const st = { main: main || '', extra: [...(extra || [])] }; const host = h('div', { class: 'grid' });
  const pick = (cb) => { const i = h('input', { type: 'file', accept: 'image/*', multiple: true, class: 'hidden' }); document.body.append(i); i.onchange = async () => { const fs = [...i.files]; i.remove(); for (const f of fs) { try { await cb(await uploadPhoto(f)); } catch (e) { fail(e); } } paint(); }; i.click(); };
  const paint = () => {
    clear(host).append(
      h('div', null, h('div', { class: 'cap' }, t('Main picture')), h('div', { class: 'pe-row' },
        h('div', { class: 'pe-main' }, st.main ? h('img', { src: st.main, alt: '' }) : icon('camera', 28)),
        h('div', { class: 'grid', style: { gap: '6px', alignContent: 'start' } }, h('button', { class: 'btn sm', type: 'button', onclick: () => pick((u) => { st.main = u; }) }, icon('camera', 16), st.main ? t('Change') : t('Add picture')),
          st.main ? h('button', { class: 'btn sm danger', type: 'button', onclick: () => { st.main = ''; paint(); } }, t('Remove')) : null))),
      h('div', null, h('div', { class: 'cap' }, t('More pictures') + ' (' + st.extra.length + ')'), h('div', { class: 'pe-grid' },
        st.extra.map((u, i) => h('div', { class: 'pe-t' }, h('img', { src: u, alt: '' }), h('div', { class: 'pe-a' }, h('button', { type: 'button', title: t('Make main'), onclick: () => { const old = st.main; st.main = u; st.extra.splice(i, 1); if (old) st.extra.unshift(old); paint(); } }, icon('check', 14)), h('button', { type: 'button', title: t('Remove'), onclick: () => { st.extra.splice(i, 1); paint(); } }, icon('x', 14))))),
        h('button', { class: 'pe-add', type: 'button', onclick: () => pick((u) => { if (!st.main) st.main = u; else st.extra.push(u); }) }, icon('plus', 22)))));
  };
  paint(); host.get = () => st; return host;
}

// ---- colour families (Blues, Reds ...) ----
const FAMILIES = { Blues: ['blue', 'navy', 'sky', 'indigo', 'teal', 'denim', 'cyan'], Browns: ['brown', 'tan', 'beige', 'khaki', 'camel', 'coffee', 'cream', 'chocolate'], Greens: ['green', 'olive', 'mint', 'sage', 'lime', 'emerald'],
  Neutrals: ['black', 'white', 'grey', 'gray', 'silver', 'charcoal', 'off white', 'ivory'], Purples: ['purple', 'lavender', 'violet', 'lilac', 'mauve', 'plum'], Reds: ['red', 'maroon', 'wine', 'pink', 'orange', 'rust', 'coral', 'peach', 'yellow', 'mustard', 'gold'] };
function colourFamily(name) { const k = String(name || '').toLowerCase(); for (const f in FAMILIES) if (FAMILIES[f].some((w) => k.includes(w))) return f; return ''; }

// ---- browse / filter: collections, category > type, fabric, colour families ----
const FILT = { colour: '', family: '', category: '', type: '', fabric: '', collection: '' };
const filtActive = () => Object.values(FILT).filter(Boolean).length;
const distinctOf = (get) => [...new Set(S.cat.filter((s) => s.active !== false).flatMap((s) => [].concat(get(s))).filter(Boolean))].sort((a, b) => a.localeCompare(b));
function styleMatches(s) {
  if (FILT.colour && !s.variants.some((v) => v.colour === FILT.colour && v.active !== false)) return false;
  if (FILT.family && !s.variants.some((v) => colourFamily(v.colour) === FILT.family && v.active !== false)) return false;
  if (FILT.category && s.category !== FILT.category) return false;
  if (FILT.type && (s.subcategory || '') !== FILT.type) return false;
  if (FILT.fabric && (s.fabric || '') !== FILT.fabric) return false;
  if (FILT.collection && (s.collection || '') !== FILT.collection) return false;
  return true;
}
function filterSheet(onApply) {
  const body = h('div', { class: 'grid browse' });
  const chip = (k, v, label, extra) => h('button', { class: 'chip', type: 'button', 'aria-pressed': String(FILT[k] === v), onclick: () => { FILT[k] = FILT[k] === v ? '' : v; if (k === 'category') FILT.type = ''; if (k === 'type') { const st = S.cat.find((s) => s.subcategory === v); if (st) FILT.category = FILT[k] ? st.category : ''; } paint(); } }, extra || null, label || v);
  const paint = () => {
    const cols = distinctOf((s) => s.collection), cats = distinctOf((s) => s.category), fabs = distinctOf((s) => s.fabric);
    const colours = distinctOf((s) => s.variants.filter((v) => v.active !== false).map((v) => v.colour));
    const fams = Object.keys(FAMILIES).filter((f) => colours.some((c) => colourFamily(c) === f));
    clear(body).append(
      cols.length ? h('div', null, h('div', { class: 'cap' }, t('Collections')), h('div', { class: 'chips wrap' }, cols.map((c) => chip('collection', c)))) : null,
      cats.length ? h('div', null, h('div', { class: 'cap' }, t('Categories and types')), h('div', { class: 'cat-cols' }, cats.map((c) => {
        const types = [...new Set(S.cat.filter((s) => s.active !== false && s.category === c && s.subcategory).map((s) => s.subcategory))].sort();
        return h('div', { class: 'cat-b' }, h('button', { class: 'cat-h' + (FILT.category === c && !FILT.type ? ' on' : ''), type: 'button', onclick: () => { FILT.category = FILT.category === c ? '' : c; FILT.type = ''; paint(); } }, c), h('div', { class: 'chips wrap' }, types.map((x) => chip('type', x))));
      }))) : null,
      fabs.length ? h('div', null, h('div', { class: 'cap' }, t('Fabric')), h('div', { class: 'chips wrap' }, fabs.map((c) => chip('fabric', c)))) : null,
      fams.length ? h('div', null, h('div', { class: 'cap' }, t('Shop by colour')), h('div', { class: 'chips wrap' }, fams.map((f) => chip('family', f, f, h('span', { class: 'fam-dots' }, colours.filter((c) => colourFamily(c) === f).slice(0, 3).map((c) => colourDot(c, 12))))))) : null,
      colours.length ? h('div', null, h('div', { class: 'cap' }, t('Colour')), h('div', { class: 'chips wrap' }, colours.map((c) => chip('colour', c, c, colourDot(c, 12))))) : null,
      !cats.length ? empty('tag', t('Nothing to filter yet'), t('Add category, type, fabric and collection when you create a style.')) : null);
  };
  paint();
  sheet({ title: t('Browse'), full: true, wide: true, body, actions: [{ label: t('Clear'), onclick: (close) => { Object.keys(FILT).forEach((k) => FILT[k] = ''); close(); onApply(); } }, { label: t('Show'), primary: true, onclick: (close) => { close(); onApply(); } }] });
}
function filterButton(onApply) {
  const n = filtActive();
  return h('button', { class: 'btn icon' + (n ? ' fill' : ''), type: 'button', 'aria-label': t('Browse'), onclick: () => filterSheet(onApply) }, icon('tag', 20), n ? h('span', { class: 'fcount' }, n) : null);
}
// camera scan helper: any barcode format (the scanner reads whatever the phone camera can)
function scanWith(onCode) { if (!window.auzScanner) return toast(t('Scanner not available on this device'), { err: true }); auzScanner.open({ title: t('Scan a tag'), onCode, footer: '' }); }
