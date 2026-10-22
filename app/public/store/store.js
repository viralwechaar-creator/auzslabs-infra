/* AUZsStyle online store (customer-facing, no login). Plain script, no build. Everything is drawn with textContent / createElement
   (never innerHTML). Data comes from public_sty_store; orders go through public_sty_place_order. */
'use strict';
const SLUG = new URLSearchParams(location.search).get('shop') || window.TENANT_SLUG || '';
const sb = window.supabase.createClient(CFG.url, CFG.key);
const $ = (s, r) => (r || document).querySelector(s);
// native append() prints the word "null" for a null child; make it skip empty children like E() does
(function () { const nativeAppend = Element.prototype.append; Element.prototype.append = function (...kids) { return nativeAppend.apply(this, kids.filter((k) => k != null && k !== false)); }; })();
const NS = 'http://www.w3.org/2000/svg';
const E = (tag, props, ...kids) => {
  const el = document.createElement(tag);
  for (const k in props || {}) {
    const v = props[k];
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  add(el, kids); return el;
};
function add(el, kids) { for (const k of kids.flat(9)) { if (k == null || k === false) continue; el.append(k instanceof Node ? k : document.createTextNode(String(k))); } return el; }
const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
const IC = {
  menu: 'M4 8h16M4 16h16', bag: 'M6 8h12l-1 12H7L6 8Zm3 0V6a3 3 0 0 1 6 0v2', mark: 'M7 4h10v17l-5-4-5 4V4Z', pin: 'M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Zm0-8.8a2.7 2.7 0 1 0 0-5.4 2.7 2.7 0 0 0 0 5.4Z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm9 3-4.2-4.2', x: 'M6 6l12 12M18 6 6 18', plus: 'M12 5v14M5 12h14', left: 'M15 6l-6 6 6 6', right: 'M9 6l6 6-6 6',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9a7 7 0 0 1 14 0',
  chat: 'M5 6h14v9H10l-5 4V6Z', home: 'M4 11 12 4l8 7v9h-5v-6H9v6H4v-9Z', compass: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm3-12-2 5-5 2 2-5 5-2Z', filter: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 5v4M6 15v4',
};
// hand-cut solid glyphs (call, support, favourite, shipping, bag, tag, arrow, globe...) drawn in plain black; thin strokes are kept only for plain controls (x, plus, arrows, search)
const FIL = {
  bag: 'M5 9.500h14l-.8 11H5.800L5 9.500ZM8.400 9.500V7.200a3.600 3.600 0 0 1 7.200 0v2.300h-1.900V7.200a1.700 1.700 0 0 0-3.400 0v2.300H8.400Z',
  chat: 'M12 3.500c5 0 9 3.200 9 7.300 0 4-4 7.200-9 7.200-.9 0-1.800-.1-2.600-.3L4 20.500l1.200-3.600C3.800 15.600 3 13.800 3 10.800 3 6.700 7 3.500 12 3.500ZM8 10a1.200 1.200 0 1 0 0 2.400A1.200 1.200 0 0 0 8 10Zm4 0a1.200 1.200 0 1 0 0 2.400A1.200 1.200 0 0 0 12 10Zm4 0a1.200 1.200 0 1 0 0 2.400A1.200 1.200 0 0 0 16 10Z',
  user: 'M12 11.500a4.200 4.200 0 1 0 0-8.400 4.200 4.200 0 0 0 0 8.400ZM3.500 21c0-4.200 3.800-6.700 8.500-6.700s8.500 2.500 8.500 6.700H3.500Z',
  pin: 'M12 22s7.500-6.400 7.500-12a7.500 7.500 0 0 0-15 0c0 5.600 7.500 12 7.500 12Zm0-9a3 3 0 1 1 0-6 3 3 0 0 1 0 6Z',
  home: 'M3 11.500 12 3.500l9 8h-2.500V21h-5v-6h-3v6h-5v-9.500H3Z',
  compass: 'M5 3l14.500 8.500-6 1.500 3.500 7-2.800 1.300L9.200 14 5 18V3Z',
  ship: 'M2.500 7.500c5-1.200 9-.6 12 2.500 1.500-2.500 4-3.800 7-4-.9 3.400-2.200 6.200-5.800 8l-3.200.6L8.500 21l-.3-6.200C5 13.800 3.300 11 2.500 7.500Z',
  tag: 'M3 3h8l10 10-8 8L3 11V3Zm4 2.500a1.500 1.500 0 1 0 0 3 1.500 1.500 0 0 0 0-3Z',
  globe: 'M12 2.500a9.500 9.500 0 1 0 0 19 9.500 9.500 0 0 0 0-19Zm-1 1.800c-2 2-3.200 4.700-3.300 7.700H11V4.300Zm2 0V12h3.300c-.1-3-1.300-5.700-3.300-7.700ZM7.700 14c.1 3 1.300 5.700 3.300 7.700V14H7.700Zm5.300 0v7.700c2-2 3.200-4.700 3.300-7.700H13Z',
  phone: 'M6.600 2.500 9 2c.5 0 .9.300 1 .8l.8 3.200c.1.400 0 .8-.3 1.100L9.200 8.400a12 12 0 0 0 6.400 6.400l1.300-1.300c.3-.3.7-.4 1.100-.3l3.200.8c.5.100.8.500.8 1l-.5 2.400c-.2 1.200-1.300 2-2.500 1.900C10.300 19.200 4.800 13.700 4.700 5c-.1-1.200.7-2.300 1.900-2.500Z',
};
const icon = (n) => { const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); const p = document.createElementNS(NS, 'path'); p.setAttribute('d', FIL[n] || IC[n] || ''); if (FIL[n]) { s.setAttribute('class', 'f'); p.setAttribute('fill-rule', 'evenodd'); } s.append(p); return s; };
const inr = (n) => '₹' + Math.round(+n || 0).toLocaleString('en-IN');
const LS = { get(k, d) { try { const v = localStorage.getItem('st.' + SLUG + '.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }, set(k, v) { try { localStorage.setItem('st.' + SLUG + '.' + k, JSON.stringify(v)); } catch { /* private mode */ } } };
const cap = (s) => (s || '').replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1).toLowerCase());

// ---------- colours ----------
const CMAP = { black: '#141414', white: '#f4f4f2', 'off white': '#ece8df', ivory: '#efe9d8', cream: '#efe6d2', beige: '#d9c7a5', grey: '#8d8d8d', gray: '#8d8d8d', charcoal: '#3a3a3a', silver: '#c2c2c2', navy: '#1f2a44', blue: '#2f5fd0', sky: '#8ec5ee', denim: '#46628f', indigo: '#3b3f8c', teal: '#1f8a8a', green: '#2f7a4a', olive: '#6b6f3a', sage: '#9aae8c', mint: '#a8dcc0', khaki: '#b7a77a', brown: '#6b4a2f', tan: '#b58a5c', camel: '#b9854a', coffee: '#4a3324', chocolate: '#4b2e1f', rust: '#a64b2a', maroon: '#6e1f2b', wine: '#5e1a2b', burgundy: '#5a1a2a', red: '#c0392b', orange: '#e0762b', yellow: '#e8c33a', mustard: '#c9a227', gold: '#c9a24a', pink: '#e88fa8', rose: '#d98a9a', purple: '#7a4fb5', violet: '#7a55c2', lavender: '#b9a4df', lilac: '#c8b3e0' };
function hex(name) { const n = String(name || '').toLowerCase(); let best = ''; for (const k in CMAP) if (n.includes(k) && k.length > best.length) best = k; if (best) return CMAP[best]; let h = 0; for (const c of n) h = (h * 31 + c.charCodeAt(0)) % 360; return 'hsl(' + h + ',32%,62%)'; }
const FAM = [['Blues', /blue|navy|sky|denim|indigo|teal/, ['#2f5fd0', '#1f2a44']], ['Browns', /brown|tan|camel|khaki|beige|coffee|chocolate|rust/, ['#b58a5c', '#4b2e1f']], ['Greens', /green|olive|sage|mint/, ['#9aae8c', '#2f7a4a']],
  ['Neutrals', /black|white|grey|gray|cream|ivory|charcoal|silver|off/, ['#f4f4f2', '#141414']], ['Purples', /purple|violet|lavender|lilac/, ['#b9a4df', '#7a4fb5']], ['Reds', /red|maroon|wine|burgundy|pink|rose/, ['#e88fa8', '#c0392b']], ['Warm', /orange|yellow|mustard|gold/, ['#e8c33a', '#e0762b']]];
const famOf = (c) => { const n = String(c || '').toLowerCase(); const f = FAM.find((x) => x[1].test(n)); return f ? f[0] : null; };

// ---------- state ----------
// the shop's own logo becomes the home-screen icon of this website (a data URI, so iOS never shows a blank icon)
async function shopIcon(d) {
  try {
    const logo = d && d.shop && d.shop.logoUrl; if (!logo) return;
    const r = await fetch('/app-icon/180.png?v=' + encodeURIComponent(String(logo).slice(-14))); if (!r.ok) return;
    const fr = new FileReader(); fr.onload = () => { document.querySelectorAll('link[rel=apple-touch-icon],link[rel=icon]').forEach((l) => l.remove()); ['apple-touch-icon', 'icon'].forEach((rel) => { const l = document.createElement('link'); l.rel = rel; l.href = fr.result; document.head.append(l); }); }; fr.readAsDataURL(await r.blob());
  } catch (e) { /* the default icon stays */ }
}
let D = null;            // public_sty_store result
let STY = [], BYID = {}, VAR = {};
let bag = [], wish = [];
const toast = (m) => { const t = E('div', { class: 'toast', role: 'status' }, m); document.body.append(t); setTimeout(() => t.remove(), 2200); };
async function rpc(fn, args) { const { data, error } = await sb.rpc(fn, args || {}); if (error) { const e = new Error(error.message || 'Something went wrong'); e.status = error.status; throw e; } return data; }
const saveBag = () => { LS.set('bag', bag); paintCounts(); };
const saveWish = () => { LS.set('wish', wish); paintCounts(); };
const recent = () => LS.get('recent', []).filter((id) => BYID[id]);
const seen = (id) => { const r = LS.get('recent', []).filter((x) => x !== id); r.unshift(id); LS.set('recent', r.slice(0, 14)); };
function recentBand(except, title) {
  const list = recent().filter((id) => id !== except).map((id) => BYID[id]).slice(0, 10); if (!list.length) return null;
  return E('section', { class: 'band' }, E('div', { class: 'hd' }, E('h2', null, title || 'Recently viewed'), E('button', { class: 'btn sm out', onclick: () => { LS.set('recent', []); route(); } }, 'Clear')), E('div', { class: 'row' }, list.map((x) => card(x))));
}
const photos = (s) => { const out = []; const push = (u) => { if (u && !out.includes(u)) out.push(u); }; push(s.photoUrl); (s.photos || []).forEach(push); Object.values(s.colourPhotos || {}).forEach((a) => (a || []).forEach(push)); return out; };
const pickPic = (s, role) => { const u = (s.photoUse || {})[role]; return u && photos(s).includes(u) ? u : photos(s)[0]; };
const withFirst = (list, u) => (u && list.includes(u) ? [u, ...list.filter((x) => x !== u)] : list);
const photosFor = (s, colour) => { const cp = (s.colourPhotos || {})[colour] || []; const rest = photos(s).filter((u) => !cp.includes(u)); return [...cp, ...rest]; };
const leftOf = (s) => s.variants.reduce((a, v) => a + v.left, 0);
const isGone = (s) => s.badge === 'soldout' || leftOf(s) === 0;
const colours = (s) => [...new Set(s.variants.map((v) => v.colour).filter(Boolean))];
const sizesOf = (s) => [...new Set(s.variants.map((v) => v.size).filter(Boolean))];
const saleOn = () => ((D && D.config) || {}).showSale === true; // no sale price or % off on the website unless the owner switched it on
const discPct = (s) => (saleOn() && s.mrp > s.price && s.mrp > 0 ? Math.round(((s.mrp - s.price) / s.mrp) * 100) : 0);
const q$ = () => { const m = {}; for (const [k, v] of new URLSearchParams((location.hash.split('?')[1] || ''))) m[k] = v; return m; };
const go = (p) => { location.hash = '#/' + p; };
const link = (p) => '#/' + p;
const cfg = () => D.config || {};
const COURIERS = { 'Delhivery': 'https://www.delhivery.com/track-v2/package/', 'India Post': 'https://www.indiapost.gov.in/_layouts/15/dop.portal.tracking/trackconsignment.aspx?', 'DTDC': 'https://www.dtdc.in/tracking.asp?', 'Blue Dart': 'https://www.bluedart.com/tracking?trackfor=', 'Ecom Express': 'https://ecomexpress.in/tracking/?awb_field=', 'XpressBees': 'https://www.xpressbees.com/shipment/tracking?awb=', 'Shiprocket': 'https://shiprocket.co/tracking/' };
function trackBox(o) {
  if (!o.trackingNo && !o.courier) return null;
  const base = COURIERS[o.courier]; const u = base && o.trackingNo ? base + encodeURIComponent(o.trackingNo) : '';
  return E('div', { class: 'note', style: { marginTop: '10px' } }, E('div', null, 'Shipped with ', E('b', null, o.courier || 'the courier')), o.trackingNo ? E('div', null, 'Tracking number: ', E('b', null, o.trackingNo)) : null, u ? E('a', { class: 'btn sm out', href: u, target: '_blank', rel: 'noopener', style: { marginTop: '8px', display: 'inline-flex' } }, 'Track my parcel') : null);
}
function stars(n) { return '★★★★★'.slice(0, Math.round(n)) + '☆☆☆☆☆'.slice(0, 5 - Math.round(n)); }
function setMeta(title, desc, img, canon) {
  const m = (sel, attr, val) => { let el = document.head.querySelector(sel); if (!el) { el = document.createElement(sel.startsWith('link') ? 'link' : 'meta'); const mm = sel.match(/\[(\w+)="([^"]+)"\]/); if (mm) el.setAttribute(mm[1], mm[2]); document.head.append(el); } el.setAttribute(attr, val); };
  try { if (desc) { m('meta[name="description"]', 'content', desc); m('meta[property="og:description"]', 'content', desc); } m('meta[property="og:title"]', 'content', title); m('meta[property="og:type"]', 'content', 'website'); if (img) m('meta[property="og:image"]', 'content', img); if (canon) m('link[rel="canonical"]', 'href', canon); } catch (e) { /* meta is best effort */ }
}

// ---------- small ui ----------
function sheet(title, body, foot) {
  const w = E('div', { class: 'sheetwrap', role: 'dialog', 'aria-modal': 'true' });
  const close = () => { if (w.classList.contains('pop') && !w.classList.contains('out')) { w.classList.add('out'); setTimeout(() => w.remove(), 190); } else w.remove(); };
  w.append(E('div', { class: 'bd', onclick: close }), E('div', { class: 'sheet' }, E('div', { class: 'grab' }), E('div', { class: 'hd' }, E('h2', null, title), E('button', { class: 'ic', 'aria-label': 'Close', onclick: close }, icon('x'))), body, foot || null));
  document.body.append(w); return { close, el: w };
}
function placeholder(name) { return E('div', { style: { height: '100%', display: 'grid', placeItems: 'center', color: '#c8c5c2', fontSize: '26px', fontWeight: 700, letterSpacing: '.04em' } }, (name || '?').trim().slice(0, 1).toUpperCase()); }

function card(s, opt) {
  opt = opt || {};
  const ims = withFirst(photos(s), pickPic(s, 'card')), gone = isGone(s), on = wish.includes(s.id);
  const sc = E('div', { class: 'sc' });
  const dt = E('div', { class: 'dt' });
  const list = ims.length ? ims.slice(0, 6) : [null];
  list.forEach((u, i) => { sc.append(E('a', { href: link('p/' + s.id) }, u ? E('img', { src: u, alt: s.name, loading: 'lazy', decoding: 'async' }) : placeholder(s.name))); if (list.length > 1) dt.append(E('i', { class: i === 0 ? 'on' : '' })); });
  sc.addEventListener('scroll', () => { const i = Math.round(sc.scrollLeft / Math.max(sc.clientWidth, 1)); [...dt.children].forEach((d, j) => d.classList.toggle('on', i === j)); }, { passive: true });
  const step = (d) => (e) => { e.preventDefault(); sc.scrollBy({ left: d * sc.clientWidth, behavior: 'smooth' }); };
  const bm = E('button', { class: 'bm' + (on ? ' on' : ''), 'aria-label': 'Save', onclick: (e) => { e.preventDefault(); toggleWish(s.id); bm.classList.toggle('on', wish.includes(s.id)); } }, icon('mark'));
  const ph = E('div', { class: 'ph' }, sc, dt, bm,
    gone ? E('div', { class: 'tag' }, 'Sold Out') : s.badge === 'limited' ? E('div', { class: 'tag' }, 'Limited') : discPct(s) >= 10 ? E('div', { class: 'tag' }, discPct(s) + '% off') : null,
    list.length > 1 ? E('button', { class: 'nx p', 'aria-label': 'Previous picture', onclick: step(-1) }, icon('left')) : null, list.length > 1 ? E('button', { class: 'nx n', 'aria-label': 'Next picture', onclick: step(1) }, icon('right')) : null);
  return E('div', { class: 'pc' + (gone ? ' gone' : '') }, ph, E('div', { class: 'in' },
    E('a', { href: link('p/' + s.id), style: { minWidth: 0 } }, E('div', { class: 'nm' }, s.name), E('div', { class: 'pr' }, inr(s.price), saleOn() && s.mrp > s.price ? E('s', null, inr(s.mrp)) : null)),
    gone ? null : E('button', { class: 'add', 'aria-label': 'Quick add', onclick: () => quickAdd(s) }, icon('plus'))));
}
function toggleWish(id) { try { TR.push('wish', null, { id }); } catch {} const i = wish.indexOf(id); if (i >= 0) wish.splice(i, 1); else wish.push(id); saveWish(); }
function quickAdd(s) {
  let colour = colours(s)[0] || '', size = '';
  const body = E('div'); const cb = E('button', { class: 'btn wide' }, 'Add to bag');
  const paint = () => {
    clear(body);
    const vs = s.variants.filter((v) => !colour || v.colour === colour);
    if (colours(s).length > 1) body.append(E('div', { class: 'fgrp' }, E('span', { class: 'lbl' }, 'Colour'), E('div', { class: 'fwrap' }, colours(s).map((c) => E('button', { class: 'chip' + (c === colour ? ' on' : ''), onclick: () => { colour = c; size = ''; paint(); } }, E('i', { class: 'sw', style: { background: hex(c) } }), c)))));
    body.append(E('div', { class: 'fgrp' }, E('span', { class: 'lbl' }, 'Size'), E('div', { class: 'fwrap' }, vs.map((v) => E('button', { class: 'sz' + (v.size === size ? ' on' : '') + (v.left < 1 ? ' off' : ''), onclick: () => { size = v.size; paint(); } }, v.size || 'One size')))));
    cb.disabled = !vs.find((v) => v.size === size && v.left > 0) && !(vs.length === 1 && !vs[0].size && vs[0].left > 0);
  };
  paint();
  const sh = sheet(s.name, body, cb);
  cb.onclick = () => { const v = s.variants.find((x) => (!colour || x.colour === colour) && x.size === size) || (s.variants.length === 1 ? s.variants[0] : null); if (!v) return; addBag(v.id, 1); sh.close(); };
}
function addBag(vid, q) {
  const v = VAR[vid]; if (!v) return;
  const cur = bag.find((b) => b.v === vid); const nq = Math.min((cur ? cur.q : 0) + q, v.left >= 9 ? 20 : v.left);
  if (cur) cur.q = nq; else bag.push({ v: vid, q: Math.max(nq, 1) });
  try { TR.push('bag', null, { id: v.sid, name: (BYID[v.sid] || {}).name }); } catch {}
  saveBag(); toast('Added to your bag');
}
const bagLines = () => bag.map((b) => ({ ...b, vr: VAR[b.v] })).filter((b) => b.vr).map((b) => ({ ...b, s: BYID[b.vr.sid] }));
const bagTotal = () => bagLines().reduce((a, l) => a + l.vr.price * l.q, 0);
const bagCount = () => bagLines().reduce((a, l) => a + l.q, 0);

// ---------- shell ----------
let counts = [];
function paintCounts() { counts.forEach((f) => f()); }
function countBadge(get) { const n = E('span', { class: 'n' }); const f = () => { const v = get(); n.textContent = v; n.style.display = v ? '' : 'none'; }; counts.push(f); f(); return n; }
function shell() {
  counts = [];
  const name = D.shop.name;
  const brandEl = E('a', { class: 'brand', href: link('') }, name);
  const top = E('header', { class: 'top' },
    E('div', { class: 'l' }, E('a', { class: 'deskonly', href: link('shop?new=1') }, 'New in'), E('a', { class: 'deskonly', href: link('collections') }, 'Collections'), E('button', { class: 'menu-pill phoneonly', onclick: openMenu }, E('i'), 'Menu')),
    brandEl,
    E('div', { class: 'r' }, E('a', { class: 'ic deskonly', href: link('stores'), 'aria-label': 'Stores' }, icon('pin')), E('button', { class: 'ic', 'aria-label': 'Search', onclick: openSearch }, icon('search')),
      E('a', { class: 'ic deskonly', href: link('wishlist'), 'aria-label': 'Saved' }, icon('mark'), countBadge(() => wish.length)), E('a', { class: 'ic', href: link('me'), 'aria-label': 'My account' }, icon('user')), E('a', { class: 'ic', href: link('bag'), 'aria-label': 'Bag' }, icon('bag'), countBadge(bagCount)),
      E('button', { class: 'menu-pill deskonly', onclick: openMenu }, E('i'), 'Menu')));
  const c = cfg();
  const phoneNo = String(D.shop.phone || '').replace(/\D/g, '');
  const waUrl = phoneNo ? 'https://wa.me/' + (phoneNo.length === 10 ? '91' + phoneNo : phoneNo) : '';
  const mk = D.shop.logoUrl ? E('img', { src: D.shop.logoUrl, alt: '' }) : String(name || 'S').trim().charAt(0).toUpperCase();
  const toContact = () => { const w = $('#chatwel'); if (w) w.remove(); go('contact'); };
  const dock = E('div', { class: 'dock phoneonly' },
    E('button', { class: 'mark', 'aria-label': name, onclick: () => go('') }, mk),
    E('div', { class: 'pill' }, E('button', { 'aria-label': 'Explore', onclick: openMenu }, icon('compass')), E('button', { 'aria-label': 'Shop', onclick: () => go('shop') }, icon('home')),
      E('button', { 'aria-label': 'Saved', onclick: () => go('wishlist') }, icon('mark'), countBadge(() => wish.length)), E('button', { 'aria-label': 'Stores', onclick: () => go('stores') }, icon('pin'))),
    E('button', { class: 'chat', 'aria-label': 'Contact us', onclick: toContact }, icon('chat')));
  const root = $('#app'); clear(root);
  root.append(c.announce ? E('div', { class: 'announce' }, c.announce) : null, top, E('main', { id: 'view' }), footer(), dock, E('button', { class: 'chatfab', 'aria-label': 'Contact us', onclick: toContact }, icon('chat')),
    E('div', { class: 'menu', id: 'menu' }), E('div', { class: 'srch', id: 'srch' }));

  try { if (!sessionStorage.getItem('st.wel.' + SLUG)) { sessionStorage.setItem('st.wel.' + SLUG, '1');
    setTimeout(() => { const b = E('button', { class: 'chatwel', id: 'chatwel', onclick: toContact }, (D.shop.logoUrl ? E('img', { class: 'wl', src: D.shop.logoUrl, alt: '' }) : E('i', { class: 'wl' }, String(name || 'S').trim().charAt(0).toUpperCase())), E('div', { class: 'wt' }, E('b', null, name), E('span', null, c.welcome || 'Welcome to ' + name + '!')), E('u', { 'aria-label': 'Close', onclick: (ev) => { ev.stopPropagation(); b.remove(); } }, '×')); document.body.append(b); setTimeout(() => b.classList.add('out'), 6500); setTimeout(() => b.remove(), 7100); }, 1200); } } catch (e) { /* no storage */ }}
function groups() {
  const cats = [...new Set(STY.map((s) => s.category).filter(Boolean))];
  const G = [['Top', /shirt|tee|polo|sweat|hood|jacket|top|kurta|blazer|coat|knit|vest/i], ['Bottom', /jean|pant|trouser|short|cargo|skirt|jogger|chino|denim|legging/i], ['Footwear', /shoe|sneaker|sandal|slipper|boot|loafer|footwear|heel/i], ['Accessories', /bag|cap|hat|belt|wallet|sock|scarf|watch|case|glass|jewel|tie/i]];
  const out = G.map(([n, re]) => [n, cats.filter((c) => re.test(c))]); const used = new Set(out.flatMap((x) => x[1]));
  const other = cats.filter((c) => !used.has(c)); if (other.length) out.push([out.some((x) => x[1].length) ? 'More' : 'Shop', other]);
  return out.filter((x) => x[1].length);
}
const slugOf = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const blogsOn = () => (cfg().blogs || []).some((x) => x && x.title);
const mediaOn = () => (cfg().media || []).some((x) => x && (x.title || x.image));
const jobsOn = () => (cfg().jobs || []).some((x) => x && x.title) || !!(cfg().hiring && (cfg().hiring.email || cfg().hiring.text));
function openMenu() {
  const m = $('#menu'); clear(m); m.classList.add('on');
  const close = () => { m.classList.remove('on'); document.body.classList.remove('menuopen'); };
  document.body.classList.add('menuopen');
  const fams = FAM.filter((f) => STY.some((s) => colours(s).some((c) => famOf(c) === f[0])));
  const nav = (p) => (e) => { e.preventDefault(); close(); location.hash = '#/' + p; };
  const a = (txt, p, cls) => E('a', { class: cls || '', href: link(p), onclick: nav(p) }, txt);
  const cols = D.collections.filter((c) => c.styleIds.length).slice(0, 3);
  const more = [blogsOn() ? ['Journal', 'blog'] : null, mediaOn() ? ['Media & gallery', 'media'] : null, jobsOn() ? ['Careers', 'careers'] : null, ['Our stores', 'stores'], ['Our story', 'about'], ['FAQs', 'faq'], ['Contact', 'contact'], ['My account & orders', 'me']].filter(Boolean);
  const panel = E('div', { class: 'mp' },
    E('div', { class: 'mhd' }, E('b', null, D.shop.name), E('button', { class: 'ic mx', 'aria-label': 'Close', onclick: close }, icon('x'))),
    E('nav', { class: 'mbig' }, a('New arrivals', 'shop?new=1', 'b'), a('All products', 'shop', 'b'), ...cols.map((c) => a(c.name, 'shop?col=' + c.id, 'b'))),
    ...groups().map(([n, cs]) => E('div', { class: 'mgrp' }, E('span', { class: 'ml' }, n), E('div', { class: 'mrow' }, cs.map((c) => a(c, 'shop?cat=' + encodeURIComponent(c)))))),
    fams.length ? E('div', { class: 'mgrp' }, E('span', { class: 'ml' }, 'Shop by colour'), E('div', { class: 'mdots' }, fams.map((f) => E('a', { class: 'md', 'aria-label': f[0], title: f[0], href: link('shop?fam=' + f[0]), onclick: nav('shop?fam=' + f[0]), style: { background: 'linear-gradient(135deg,' + f[2][0] + ',' + f[2][1] + ')' } })))) : null,
    E('div', { class: 'mmore' }, more.map(([t, p]) => a(t, p))));
  m.append(panel);
  m.onclick = (e) => { if (e.target === m) close(); };
}
function openSearch() {
  const s = $('#srch'); clear(s); s.classList.add('on');
  const close = () => s.classList.remove('on');
  const body = E('div', { style: { maxWidth: '1100px', margin: '0 auto' } });
  const chip = (txt, fn) => E('button', { class: 'chp', onclick: fn }, txt);
  const cats = [...new Set(STY.map((x) => x.category).filter(Boolean))].slice(0, 8), cols = D.collections.filter((c) => c.styleIds.length).slice(0, 5);
  const jump = (p) => () => { close(); go(p); };
  function suggest(msg) {
    clear(body);
    if (msg) body.append(E('div', { class: 'mut', style: { padding: '8px 4px 14px', textAlign: 'center' } }, msg));
    body.append(E('div', { class: 'sgh' }, 'Popular searches'), E('div', { class: 'chps' }, [...cats.map((c) => chip(c, jump('shop?cat=' + encodeURIComponent(c)))), ...cols.map((c) => chip(c.name, jump('shop?col=' + c.id))), chip('New arrivals', jump('shop?new=1'))]));
    const fams = FAM.filter((f) => STY.some((x) => colours(x).some((k) => famOf(k) === f[0]))); if (fams.length) body.append(E('div', { class: 'sgh' }, 'Shop by colour'), E('div', { class: 'chps' }, fams.map((f) => chip(f[0], jump('shop?fam=' + f[0])))));
    const pick = newest(8); if (pick.length) { body.append(E('div', { class: 'sgh' }, msg ? 'You may like' : 'Trending now')); const g = E('div', { class: 'grid' }, pick.map((x) => { const c = card(x); c.addEventListener('click', (e) => { if (e.target.closest('a')) close(); }); return c; })); body.append(g); }
  }
  const inp = E('input', { placeholder: 'Search products, colours, collections', 'aria-label': 'Search', enterkeyhint: 'search', autocomplete: 'off', oninput: () => {
    const q = inp.value.trim().toLowerCase(); clearTimeout(inp._t); if (q.length >= 3) inp._t = setTimeout(() => TR.push('search', null, { q }), 1200);
    if (q.length < 2) return suggest();
    const hit = STY.filter((x) => [x.name, x.category, x.brand, x.collection, x.fabric, x.code, ...colours(x)].join(' ').toLowerCase().includes(q)).slice(0, 24);
    if (!hit.length) return suggest('Nothing found for "' + inp.value.trim() + '". Try one of these.');
    clear(body); body.append(E('div', { class: 'grid' }, hit.map((x) => { const c = card(x); c.addEventListener('click', (e) => { if (e.target.closest('a')) close(); }); return c; })));
  } });
  s.append(E('div', { class: 'bar' }, inp, E('button', { class: 'ic', 'aria-label': 'Close', onclick: close }, icon('x'))), body); suggest(); inp.focus({ preventScroll: true });
}

// ---------- views ----------
const V = {};

// Home page "refine as a sentence": tap a word to change it, the count updates live, then jump to the matching pieces
function refineLine() {
  const prices = STY.map((x) => x.price).filter((x) => x > 0).sort((a, b) => a - b); if (STY.length < 4) return null;
  const cats = [...new Set(STY.map((x) => x.category).filter(Boolean))], sizes = [...new Set(STY.flatMap(sizesOf))], cols = [...new Set(STY.flatMap(colours))];
  const pts = [...new Set([.25, .5, .75].map((q) => Math.ceil((prices[Math.floor((prices.length - 1) * q)] || 0) / 100) * 100).filter((x) => x > 0))];
  const SL = [['cat', 'anything', 'a ' + 'type', cats], ['size', 'any size', 'size', sizes], ['colour', 'any colour', 'colour', cols], ['max', 'any budget', 'budget', pts]];
  const draft = {}; let open = '';
  const sentence = E('p', { class: 'rl-s' }), chips = E('div', { class: 'rl-c' }), go = E('a', { class: 'rl-go' });
  const word = (k, ph) => E('button', { class: 'mw' + (draft[k] ? ' set' : '') + (open === k ? ' open' : ''), onclick: () => { open = open === k ? '' : k; paint(); } }, k === 'max' && draft[k] ? 'under ' + inr(draft[k]) : draft[k] || ph);
  const paint = () => {
    const n = filterSet(draft).length; clear(sentence);
    sentence.append('I am looking for ', word('cat', 'anything'), ' in ', word('size', 'any size'), ', ', word('colour', 'any colour'), ' ', draft.max ? '' : 'at ', word('max', 'any budget'), '.');
    clear(chips); const slot = SL.find((x) => x[0] === open);
    if (slot) chips.append(...slot[3].map((o) => E('button', { class: 'ch' + (String(draft[slot[0]]) === String(o) ? ' on' : ''), onclick: () => { draft[slot[0]] = String(draft[slot[0]]) === String(o) ? '' : o; open = ''; paint(); } }, slot[0] === 'max' ? 'under ' + inr(o) : o)), E('button', { class: 'ch ghost', onclick: () => { draft[slot[0]] = ''; open = ''; paint(); } }, 'Any'));
    chips.classList.toggle('on', !!slot);
    go.textContent = n ? 'Show ' + n + (n === 1 ? ' piece' : ' pieces') + ' ↗' : 'Nothing matches yet';
    go.classList.toggle('dead', !n);
    const q = { ...draft }; for (const x in q) if (!q[x]) delete q[x];
    go.setAttribute('href', n ? link('shop' + (Object.keys(q).length ? '?' + new URLSearchParams(q).toString() : '')) : '#');
  };
  paint();
  return E('section', { class: 'rl' }, E('div', { class: 'lbl' }, 'Find your piece'), sentence, chips, E('div', { class: 'rl-f' }, go, E('button', { class: 'rl-x', onclick: () => { for (const k in draft) delete draft[k]; open = ''; paint(); } }, 'Reset')));
}
function newest(n) { return [...STY].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, n); }
// slide stack: a deck of product cards that slides by itself; the centre card is full size, its neighbours peek out
function stack(list, label) {
  list = list.filter((s) => photos(s)[0]).slice(0, 14); if (list.length < 3) return null;
  const n = list.length; let cur = 0, hold = false, holdT = 0, moved = false;
  const deck = E('div', { class: 'stk' }, list.map((s, i) => E('a', { class: 'sk', href: link('p/' + s.id) }, E('img', { src: pickPic(s, 'card'), alt: '', loading: i < 3 ? 'eager' : 'lazy', draggable: 'false' }), E('div', { class: 'nm' }, E('span', null, s.name), E('b', null, inr(s.price))))));
  const items = [...deck.children];
  // each card sits behind the centre card, shifted a little to the side, smaller and darker the further it is
  const wide = () => matchMedia('(min-width: 900px)').matches, SC = [1, .87, .76], BR = [1, .62, .4];
  const place = () => { const OFF = wide() ? [0, 58, 104] : [0, 17, 30]; items.forEach((el, i) => {
    let d = i - cur; if (d > n / 2) d -= n; if (d < -n / 2) d += n; const a = Math.abs(d), sg = d < 0 ? -1 : 1;
    if (a > 2) { el.style.opacity = '0'; el.style.pointerEvents = 'none'; el.style.zIndex = '0'; el.style.transform = 'translateX(' + sg * OFF[2] + '%) scale(' + SC[2] * .9 + ')'; return; }
    el.style.opacity = '1'; el.style.pointerEvents = 'auto'; el.style.zIndex = String(10 - a);
    el.style.transform = 'translateX(' + sg * OFF[a] + '%) scale(' + SC[a] + ')'; el.style.filter = a ? 'brightness(' + BR[a] + ')' : 'none';
    el.classList.toggle('on', a === 0);
  }); };
  // desktop side rails: counter + arrows on the left, the front piece's details on the right
  const pcat = E('span', { class: 'pcat' }), pd = E('p', { class: 'pd' }), pbl = E('ul', { class: 'pbl' }), psp = E('div', { class: 'psp' }), pco = E('div', { class: 'pco' }), psz = E('div', { class: 'psz' });
  const num = E('b', null, '01'), bar = E('i'), pn = E('span', { class: 'pn' }), pp = E('span', { class: 'pp' }), pl = E('a', { class: 'pl', href: '#' }, 'View piece ', icon('right'));
  const rails = () => {
    const s = list[cur]; num.textContent = String(cur + 1).padStart(2, '0'); bar.style.width = ((cur + 1) / n * 100) + '%';
    pn.textContent = s.name; pp.textContent = inr(s.price); pl.href = link('p/' + s.id);
    const bl = String(s.details || '').split(/\n+/).map((x) => x.trim()).filter(Boolean).slice(0, 4);
    const spec = [['Brand', s.brand], ['Fabric', s.fabric], ['For', s.gender], ['Season', s.season], ['Collection', s.collection]].filter((r) => r[1]);
    pcat.textContent = [s.category, s.brand].filter(Boolean).join(' · ');
    pd.textContent = s.description || ''; pd.hidden = !s.description;
    clear(pbl); bl.forEach((b) => pbl.append(E('li', null, b))); pbl.hidden = !bl.length;
    clear(psp); spec.forEach((r) => psp.append(E('div', null, E('span', null, r[0]), E('b', null, cap(String(r[1])))))); psp.hidden = !spec.length;
    clear(pco); colours(s).slice(0, 8).forEach((c) => pco.append(E('i', { title: c, style: { background: hex(c) } }))); pco.hidden = !pco.children.length;
    clear(psz); sizesOf(s).slice(0, 10).forEach((z) => psz.append(E('em', null, z))); psz.hidden = !psz.children.length;
  };
  addEventListener('resize', () => place());
  const go = (i) => { cur = ((i % n) + n) % n; place(); rails(); };
  const pause = (ms) => { hold = true; clearTimeout(holdT); holdT = setTimeout(() => { hold = false; }, ms || 5000); };
  let x0 = null;
  deck.addEventListener('pointerdown', (e) => { x0 = e.clientX; moved = false; pause(); });
  deck.addEventListener('pointermove', (e) => { if (x0 != null && Math.abs(e.clientX - x0) > 10) moved = true; });
  const end = (e) => { if (x0 == null) return; const dx = e.clientX - x0; x0 = null; if (Math.abs(dx) > 36) go(cur + (dx < 0 ? 1 : -1)); };
  deck.addEventListener('pointerup', end); deck.addEventListener('pointercancel', () => { x0 = null; });
  items.forEach((el, i) => el.addEventListener('click', (e) => { if (moved) { e.preventDefault(); moved = false; return; } if (i !== cur) { e.preventDefault(); go(i); pause(); } }));
  deck.addEventListener('mouseenter', () => pause(60000)); deck.addEventListener('mouseleave', () => pause(1500));
  place(); rails();
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) { const t = setInterval(() => { if (!document.body.contains(deck)) return clearInterval(t); if (hold || document.hidden) return; go(cur + 1); }, 3200); }
  const prev = E('button', { class: 'ar', type: 'button', 'aria-label': 'Previous', onclick: () => { go(cur - 1); pause(); } }, icon('left')), next = E('button', { class: 'ar nx', type: 'button', 'aria-label': 'Next', onclick: () => { go(cur + 1); pause(); } }, icon('right'));
  const left = E('div', { class: 'srl' }, E('div', { class: 'cnt' }, num, E('span', null, '/ ' + String(n).padStart(2, '0'))), E('div', { class: 'sbar' }, bar), E('div', { class: 'ars' }, prev, next));
  const right = E('div', { class: 'srr' }, E('span', { class: 'tg' }, 'In front'), pcat, pn, pp, pd, pbl, psp, pco, psz, pl);
  return E('section', { class: 'sec' }, E('div', { class: 'hd' }, E('span', { class: 'lbl' }, label)), E('div', { class: 'stkw' }, E('span', { class: 'gh', 'aria-hidden': 'true' }, label), left, deck, right));
}
function gridOf(list, withBlanks) {
  const g = E('div', { class: 'grid' });
  list.forEach((s, i) => { g.append(card(s)); if (withBlanks && (i + 1) % 7 === 0 && i + 1 < list.length) g.append(E('div', { class: 'blank' + (((i + 1) / 7) % 2 ? '' : ' ghost') + ' d', 'aria-hidden': 'true' })); });
  return g;
}
V.home = (v) => {
  const c = cfg(); const hi = (c.heroImages || []).filter(Boolean);
  const fallback = hi.length ? hi : [...STY.filter((s) => (s.photoUse || {}).hero), ...newest(5)].filter((s, i, a) => a.indexOf(s) === i).slice(0, 5).map((s) => pickPic(s, 'hero')).filter(Boolean);
  let hero;
  if (fallback.length) {
    let i = 0; const sls = fallback.map((u, k) => E('div', { class: 'sl' + (k === 0 ? ' on' : '') }, E('img', { src: u, alt: '', loading: k ? 'lazy' : 'eager' })));
    const dots = E('div', { class: 'dots' }, fallback.length > 1 ? fallback.map((_, k) => E('i', { class: k === 0 ? 'on' : '' })) : null);
    hero = E('section', { class: 'hero' }, ...sls, dots, E('div', { class: 'cap' }, E('div', { class: 't' }, c.heroTitle || D.shop.name), E('a', { class: 'btn', href: link('shop') }, c.heroCta || 'Shop now')));
    if (fallback.length > 1) { const t = setInterval(() => { if (!document.body.contains(hero)) return clearInterval(t); sls[i].classList.remove('on'); dots.children[i].classList.remove('on'); i = (i + 1) % sls.length; sls[i].classList.add('on'); dots.children[i].classList.add('on'); }, 5200); }
  } else hero = E('section', { class: 'hero empty' }, E('div', { class: 'big' }, D.shop.name), E('a', { class: 'btn', href: link('shop'), style: { position: 'absolute', bottom: '24px' } }, 'Shop now'));
  v.append(hero);
  const cols = D.collections.filter((x) => x.styleIds.some((id) => BYID[id]));
  const phone = matchMedia('(max-width:700px)').matches;
  // 1. latest products
  v.append(refineLine());
  v.append(E('section', { class: 'sec' }, E('div', { class: 'hd' }, E('span', { class: 'lbl' }, 'Latest drop'), E('a', { class: 'btn sm out', href: link('shop?new=1') }, 'Discover more')), gridOf(newest(8), true)));
  // 2. category by category: a swipe row on desktop, a slide deck on phones
  // size hierarchy: each category band gets its own scale (L big, deck, S compact, M medium); product cards inside one band are always the same size
  const TIER = ['l', 'deck', 's', 'm'];
  [...new Set(STY.map((x) => x.category).filter(Boolean))].slice(0, 4).forEach((cat, i) => {
    const items = STY.filter((x) => x.category === cat).slice(0, 10); if (items.length < 2) return;
    const tier = TIER[i % TIER.length];
    const dk = tier === 'deck' || (phone && tier === 'm') ? stack(items, cat) : null;
    v.append(dk || E('section', { class: 'band t-' + tier }, E('div', { class: 'hd' }, E('h2', null, cat), E('a', { class: 'btn sm', href: link('shop?cat=' + encodeURIComponent(cat)) }, 'Discover more')), E('div', { class: 'row' }, items.map((s) => card(s)))));
  });
  // 3. big collection pictures
  cols.slice(0, 3).forEach((x) => {
    const s0 = x.styleIds.map((id) => BYID[id]).find((s) => s && photos(s)[0]); const pic = x.image || (s0 && pickPic(s0, 'banner')); if (!pic) return;
    v.append(E('a', { class: 'bigcol', href: link('shop?col=' + x.id) }, E('img', { src: pic, alt: '', loading: 'lazy' }), E('div', { class: 'cap' }, E('div', { class: 't' }, x.name), E('span', { class: 'btn' }, 'Shop now'))));
  });
  // 4. products again
  if (STY.length > 4) v.append(E('section', { class: 'sec' }, E('div', { class: 'hd' }, E('span', { class: 'lbl' }, 'All products'), E('a', { class: 'btn sm out', href: link('shop') }, 'Shop all')), gridOf(STY.slice(0, 12), true)));
  // 5. stores
  if ((c.stores || []).length) v.append(E('section', { class: 'sec' }, E('div', { class: 'hd' }, E('span', { class: 'lbl' }, 'Visit us'), E('a', { class: 'btn sm out', href: link('stores') }, 'All stores')), storeCards(c.stores)));
};

function filterSet(q) {
  let list = STY.slice();
  if (q.cat) list = list.filter((s) => s.category === q.cat);
  if (q.col) { const cl = D.collections.find((x) => x.id === q.col); list = cl ? list.filter((s) => cl.styleIds.includes(s.id)) : []; }
  if (q.colour) list = list.filter((s) => colours(s).includes(q.colour));
  if (q.fam) list = list.filter((s) => colours(s).some((c) => famOf(c) === q.fam));
  if (q.size) list = list.filter((s) => s.variants.some((x) => x.size === q.size && x.left > 0));
  if (q.gender) list = list.filter((s) => (s.gender || '').toLowerCase() === q.gender.toLowerCase());
  if (q.min) list = list.filter((s) => s.price >= +q.min);
  if (q.max) list = list.filter((s) => s.price <= +q.max);
  if (q.stock) list = list.filter((s) => !isGone(s));
  if (q.new) { const ids = new Set(newest(Math.max(12, Math.ceil(STY.length / 3))).map((s) => s.id)); list = list.filter((s) => ids.has(s.id)); }
  const so = q.sort || 'new';
  if (so === 'low') list.sort((a, b) => a.price - b.price); else if (so === 'high') list.sort((a, b) => b.price - a.price); else if (so === 'az') list.sort((a, b) => a.name.localeCompare(b.name)); else list.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return list;
}
function setQ(patch) { const q = { ...q$(), ...patch }; for (const k in q) if (q[k] == null || q[k] === '') delete q[k]; const qs = new URLSearchParams(q).toString(); location.hash = '#/shop' + (qs ? '?' + qs : ''); }
function refine(anchor) {
  const base = q$(); const draft = { ...base };
  const prices = STY.map((s) => s.price); const lo = Math.floor(Math.min(...prices, 0)), hi = Math.ceil(Math.max(...prices, 1) / 100) * 100;
  const body = E('div'); const showBtn = E('button', { class: 'btn wide' }, 'View items'); const live = () => { const n = filterSet(draft).length; showBtn.textContent = 'View ' + n + (n === 1 ? ' item' : ' items'); };
  const allSizes = [...new Set(STY.flatMap(sizesOf))]; const allCols = [...new Set(STY.flatMap(colours))]; const cats = [...new Set(STY.map((s) => s.category).filter(Boolean))];
  const paint = () => {
    clear(body);
    const pick = (key, val) => { draft[key] = draft[key] === val ? '' : val; paint(); };
    body.append(
      E('div', { class: 'fgrp' }, E('span', { class: 'lbl' }, 'Sort'), E('div', { class: 'fwrap' }, [['new', 'Newest'], ['low', 'Price low'], ['high', 'Price high'], ['az', 'A to Z']].map(([k, l]) => E('button', { class: 'sz' + ((draft.sort || 'new') === k ? ' on' : ''), onclick: () => { draft.sort = k; paint(); } }, l)))),
      cats.length > 1 ? E('div', { class: 'fgrp' }, E('span', { class: 'lbl' }, 'Type'), E('div', { class: 'fwrap' }, cats.map((c) => E('button', { class: 'sz' + (draft.cat === c ? ' on' : ''), onclick: () => pick('cat', c) }, c)))) : null,
      allSizes.length ? E('div', { class: 'fgrp' }, E('span', { class: 'lbl' }, 'Size'), E('div', { class: 'fwrap' }, allSizes.map((z) => E('button', { class: 'sz' + (draft.size === z ? ' on' : ''), onclick: () => pick('size', z) }, z)))) : null,
      allCols.length ? E('div', { class: 'fgrp' }, E('span', { class: 'lbl' }, 'Colour'), E('div', { class: 'fwrap' }, allCols.map((c) => E('button', { class: 'sz cl' + (draft.colour === c ? ' on' : ''), onclick: () => pick('colour', c) }, E('span', { class: 'c', style: { background: hex(c) } }), c)))) : null,
      E('div', { class: 'fgrp' }, E('span', { class: 'lbl' }, 'Budget'), (() => { const mn = E('input', { type: 'range', min: lo, max: hi, value: draft.min || lo, step: 100 }), mx = E('input', { type: 'range', min: lo, max: hi, value: draft.max || hi, step: 100 }); const rv = E('div', { class: 'rv' }); const up = () => { if (+mn.value > +mx.value) mn.value = mx.value; draft.min = +mn.value > lo ? mn.value : ''; draft.max = +mx.value < hi ? mx.value : ''; rv.textContent = ''; add(rv, [E('span', null, inr(mn.value)), E('span', null, inr(mx.value))]); live(); }; mn.oninput = up; mx.oninput = up; up(); return E('div', { class: 'range' }, rv, mn, mx); })()),
      E('button', { class: 'tgl' + (draft.stock ? ' on' : ''), style: { width: '100%' }, onclick: () => { draft.stock = draft.stock ? '' : '1'; paint(); } }, E('span', null, 'Only what is in stock'), E('i')));
    live();
  };
  paint();
  const foot = E('div', { class: 'rf' }, showBtn, E('button', { class: 'rclr', onclick: () => { sh.close(); location.hash = '#/shop'; } }, 'Clear all'));
  const sh = sheet('Filter', body, foot); sh.el.querySelector('.sheet').classList.add('refine');
  if (anchor && anchor.getBoundingClientRect && matchMedia('(min-width: 900px)').matches) { const r = anchor.getBoundingClientRect(), hd = document.querySelector('header, .nav, .hdr'), hb = hd ? Math.max(0, hd.getBoundingClientRect().bottom) : 56, W = Math.min(740, innerWidth - 32), left = Math.max(16, Math.min(r.right + 24 - W, innerWidth - W - 16)), top = Math.min(r.top - 10, hb + 12), card = sh.el.querySelector('.sheet'); sh.el.classList.add('pop'); card.style.cssText = 'left:' + left + 'px;top:' + Math.max(hb + 6, top) + 'px;width:' + W + 'px;max-height:' + Math.max(300, innerHeight - hb - 24) + 'px;transform-origin:' + (r.left + r.width / 2 - left) + 'px ' + (r.top + r.height / 2 - Math.max(hb + 6, top)) + 'px'; }
  showBtn.onclick = () => { sh.close(); const q = { ...draft }; for (const k in q) if (!q[k]) delete q[k]; location.hash = '#/shop' + (Object.keys(q).length ? '?' + new URLSearchParams(q).toString() : ''); };
}
function pagedGrid(list) {
  let n = 24; const host = E('div');
  const paint = () => { clear(host).append(gridOf(list.slice(0, n), true), n < list.length ? E('div', { style: { textAlign: 'center', padding: '18px' } }, E('button', { class: 'btn out', onclick: () => { n += 24; paint(); } }, 'Show more · ' + (list.length - n) + ' left')) : null); };
  paint(); return host;
}
V.shop = (v) => {
  const q = q$(); const list = filterSet(q); const cols = D.collections;
  const act = []; const lab = { cat: 'Type', colour: 'Colour', fam: 'Colour', size: 'Size', gender: '', stock: 'In stock', new: 'New in' };
  const colName = q.col ? (cols.find((x) => x.id === q.col) || {}).name : '';
  const title = colName || q.cat || (q.new ? 'New arrivals' : 'All products');
  for (const k of ['cat', 'colour', 'fam', 'size', 'gender', 'stock', 'new', 'min', 'max']) if (q[k]) act.push([k, k === 'stock' ? 'In stock' : k === 'new' ? 'New in' : k === 'min' ? 'From ' + inr(q[k]) : k === 'max' ? 'Up to ' + inr(q[k]) : (lab[k] ? lab[k] + ': ' : '') + q[k]]);
  if (q.col) act.push(['col', colName || 'Collection']);
  v.append(E('div', { class: 'crumbs' }, E('a', { href: link('') }, 'Home'), ' / ', title),
    E('div', { class: 'shophd' }, E('div', null, E('h1', null, title), E('div', { class: 'mut tiny' }, list.length + (list.length === 1 ? ' piece' : ' pieces'))), E('button', { class: 'btn soft', onclick: (e) => refine(e.currentTarget) }, icon('filter'), 'Refine')),
    act.length ? E('div', { class: 'chips' }, act.map(([k, l]) => E('button', { class: 'chip on', onclick: () => setQ({ [k]: '' }) }, l, E('span', { class: 'x' }, '×')))) : null,
    !act.length && [...new Set(STY.map((s) => s.category))].length > 1 ? E('div', { class: 'chips' }, [...new Set(STY.map((s) => s.category).filter(Boolean))].map((c) => E('button', { class: 'chip', onclick: () => setQ({ cat: c }) }, c))) : null,
    (q.cat || list.length === STY.length) ? stack(list, q.cat ? q.cat : 'All products') : null,
    list.length ? pagedGrid(list) : E('div', { class: 'empty' }, E('h2', null, 'Nothing matches'), E('div', { class: 'mut' }, 'Try removing a filter.'), E('a', { class: 'btn', href: link('shop') }, 'Clear filters')));
};
V.collections = (v) => {
  const cols = D.collections.filter((x) => x.styleIds.some((id) => BYID[id]));
  v.append(E('div', { class: 'shophd' }, E('h1', null, 'Collections')), cols.length ? E('div', { class: 'deck', style: { flexWrap: 'wrap', overflow: 'visible' } }, cols.map((x) => { const s0 = x.styleIds.map((id) => BYID[id]).find((s) => s && photos(s)[0]); const pic = x.image || (s0 && pickPic(s0, 'banner')); return E('a', { class: 'dk' + (pic ? '' : ' ph'), href: link('shop?col=' + x.id) }, pic ? E('img', { src: pic, alt: '', loading: 'lazy' }) : null, E('div', { class: 'nm' }, x.name)); })) : E('div', { class: 'empty' }, E('div', { class: 'mut' }, 'No collections yet.'), E('a', { class: 'btn', href: link('shop') }, 'Shop all')));
};
V.wishlist = (v) => {
  const list = wish.map((id) => BYID[id]).filter(Boolean);
  v.append(E('div', { class: 'shophd' }, E('h1', null, 'Saved')), E('div', { class: 'note', style: { marginBottom: '10px' } }, 'Your saved pieces stay on this phone. They are kept until you clear your browser data.'),
    list.length ? gridOf(list) : E('div', { class: 'empty' }, E('div', { class: 'mut' }, 'Nothing saved yet. Tap the bookmark on any piece.'), E('a', { class: 'btn', href: link('shop') }, 'Shop now')));
};

V.p = (v, id) => {
  const s = BYID[id];
  if (!s) { v.append(E('div', { class: 'empty' }, E('h2', null, 'Piece not found'), E('a', { class: 'btn', href: link('shop') }, 'Shop all'))); return; }
  let colour = colours(s)[0] || '', size = '', qty = 1; const open = { d: true }; let folded = false, pinned = false; seen(s.id);
  const gal = E('div', { class: 'gal' }), info = E('div', { class: 'info' });
  let cur = 0;
  const paintGal = () => {
    const ims = photosFor(s, colour); clear(gal); gal.classList.toggle('solo', ims.length <= 1);
    if (!ims.length) { gal.append(E('div', { class: 'main' }, placeholder(s.name))); return; }
    const main = E('div', { class: 'main', style: { '--bgi': 'url("' + (ims[cur] || ims[0]) + '")' } }, E('img', { src: ims[cur] || ims[0], alt: s.name }), E('div', { class: 'ct' }, (cur + 1) + ' / ' + ims.length));
    const rail = E('div', { class: 'rail' }, ims.map((u, i) => E('button', { class: 'th' + (i === cur ? ' on' : ''), 'aria-label': 'Picture ' + (i + 1), onclick: () => { cur = i; paintGal(); } }, E('img', { src: u, alt: '', loading: 'lazy' }))));
    if (ims.length > 1) {
      // phones: swipe through the pictures with dots; desktop keeps the thumbnail column
      const ct = main.querySelector('.ct'), dots = E('div', { class: 'dots3' }, ims.map((_, i) => E('i', { class: i === cur ? 'on' : '' })));
      const swp = E('div', { class: 'swp' }, ims.map((u) => E('img', { src: u, alt: s.name, loading: 'lazy' })));
      swp.addEventListener('scroll', () => { const i = Math.max(0, Math.min(ims.length - 1, Math.round(swp.scrollLeft / (swp.clientWidth || 1)))); if (i === cur) return; cur = i; ct.textContent = (i + 1) + ' / ' + ims.length; [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i)); rail.querySelectorAll('.th').forEach((b, k) => b.classList.toggle('on', k === i)); }, { passive: true });
      main.append(swp, dots); gal.append(main, rail);
      requestAnimationFrame(() => { swp.scrollLeft = cur * swp.clientWidth; });
      return;
    }
    // one picture only: the empty sides show other pieces to look at
    const others = STY.filter((x) => x.id !== s.id), same = others.filter((x) => x.category === s.category), pool = same.concat(others.filter((x) => x.category !== s.category)).slice(0, 6);
    gal.append(E('div', { class: 'sugg' }, pool.slice(0, 4).map((x) => card(x))), main);
  };
  const dtl = (k) => {
    if (k === 'w') return E('div', { class: 'dtl' }, s.washcare ? E('div', null, s.washcare) : E('div', { class: 'mut' }, 'Wash cold, dry in shade, do not bleach.'));
    if (k === 's') return E('div', { class: 'dtl' }, E('div', null, (cfg().shipping || {}).note || 'We ship across India. Delivery usually takes 3 to 7 days.'), (cfg().shipping || {}).fee > 0 ? E('div', null, 'Shipping ' + inr(cfg().shipping.fee) + ((cfg().shipping || {}).freeOver > 0 ? ', free above ' + inr(cfg().shipping.freeOver) : '') + '.') : E('div', null, 'Free shipping.'), E('div', null, 'Returns within ' + (D.shop.returnDays || 30) + ' days of delivery, tags intact. ', E('a', { href: link('policy/returns'), style: { textDecoration: 'underline' } }, 'Read more')));
    const bullets = String(s.details || '').split(/\n+/).map((x) => x.trim()).filter(Boolean);
    const rows = [['Brand', s.brand], ['Fabric', s.fabric], ['Season', s.season], ['For', s.gender], ['Collection', s.collection], ['Weight', s.weightG ? s.weightG + ' g' : ''], ['Code', s.code]].filter((r) => r[1]);
    return E('div', { class: 'dtl' }, bullets.length ? E('div', null, E('h3', null, 'Details'), E('ul', null, bullets.map((b) => E('li', null, b)))) : null, s.description ? E('div', null, E('h3', null, 'Description'), E('div', null, s.description)) : null, rows.length ? E('dl', null, rows.flatMap(([k, val]) => [E('dt', null, k), E('dd', null, val)])) : null,
      !bullets.length && !s.description && !rows.length ? E('div', { class: 'mut' }, 'More details coming soon.') : null);
  };
  const paintInfo = () => {
    clear(info);
    const vs = s.variants.filter((x) => !colour || x.colour === colour); const gone = isGone(s);
    const chosen = s.variants.find((x) => (!colour || x.colour === colour) && x.size === size) || (!sizesOf(s).length ? vs[0] : null);
    info.append(
      E('div', null, E('div', { class: 'nm' }, E('span', null, s.name), E('button', { class: 'ic', 'aria-label': 'Save', onclick: () => { toggleWish(s.id); paintInfo(); } }, E('span', { style: { display: 'contents' } }, icon('mark')))),
        E('div', { class: 'pr' }, inr(s.price), discPct(s) > 0 ? [E('s', null, inr(s.mrp)), E('b', null, discPct(s) + '% off')] : null)),
      colours(s).length ? E('div', { class: 'fx' }, E('span', { class: 'lbl' }, 'Colour · ' + colour), E('div', { class: 'dots2', style: { marginTop: '8px' } }, colours(s).map((c) => E('button', { class: c === colour ? 'on' : '', 'aria-label': c, onclick: () => { colour = c; size = ''; cur = 0; paintGal(); paintInfo(); } }, E('span', { class: 'c', style: { background: hex(c) } }))))) : null,
      sizesOf(s).length ? E('div', { class: 'fx' }, E('div', { style: { display: 'flex', justifyContent: 'space-between' } }, E('span', { class: 'lbl' }, 'Size'), E('button', { class: 'tiny', style: { textDecoration: 'underline', color: 'var(--mut)' }, onclick: sizeGuide }, 'Size guide')),
        E('div', { class: 'fwrap', style: { marginTop: '8px' } }, vs.map((x) => E('button', { class: 'sz' + (x.size === size ? ' on' : '') + (x.left < 1 ? ' off' : ''), onclick: () => { size = x.size; paintInfo(); } }, x.size)))) : null,
      chosen && chosen.left > 0 && chosen.left <= 3 ? E('div', { class: 'left fx' }, 'Only ' + chosen.left + ' left in this size') : null,
      gone ? E('div', { class: 'note fx' }, 'This piece is sold out right now.') : E('div', { class: 'fx', style: { display: 'flex', alignItems: 'center', gap: '10px' } }, E('span', { class: 'lbl' }, 'Qty'), E('div', { class: 'qty' }, E('button', { onclick: () => { qty = Math.max(1, qty - 1); paintInfo(); } }, '–'), E('span', null, qty), E('button', { onclick: () => { qty = Math.min(chosen ? (chosen.left >= 9 ? 20 : chosen.left) : 9, qty + 1); paintInfo(); } }, '+'))),
      E('div', { class: 'row2' }, E('button', { class: 'btn out', disabled: gone, onclick: () => need(chosen) && (addBag(chosen.id, qty)) }, 'Add to bag'), E('button', { class: 'btn', disabled: gone, onclick: () => { if (!need(chosen)) return; addBag(chosen.id, qty); go('checkout'); } }, 'Buy now')),
      E('div', { class: 'acc fx' }, [['d', 'Details & Description'], ['w', 'Washcare'], ['s', 'Shipping & returns']].map(([k, l]) => E('div', { class: 'ai' + (open[k] ? ' on' : '') }, E('button', { 'aria-expanded': String(!!open[k]), onclick: () => { open[k] = !open[k]; paintInfo(); } }, E('span', null, l), E('span', { class: 'pl' }, open[k] ? '–' : '+')), open[k] ? E('div', { class: 'ab' }, dtl(k)) : null))),
      E('div', { class: 'row2 fx' }, E('button', { class: 'btn out sm', onclick: share }, 'Share'), gone ? E('button', { class: 'btn out sm', onclick: notify }, 'Notify me') : null),
      E('button', { class: 'unfold', onclick: () => { pinned = true; folded = false; info.classList.remove('fold'); } }, 'Show size, colour and details'));
  };
  const need = (c) => { if (!c) { toast('Please choose a size'); return false; } return true; };
  function sizeGuide() {
    const g = cfg().sizeGuide || {}; const head = (g.head && g.head.length ? g.head : ['Size', 'Chest (in)', 'Waist (in)']); const rows = g.rows && g.rows.length ? g.rows : [['S', '34-36', '28-30'], ['M', '38-40', '32-34'], ['L', '42-44', '36-38'], ['XL', '46-48', '40-42']];
    const fit = String(s.details || '').split(/\n+/).map((x) => x.trim()).find((x) => /^fit\b/i.test(x));
    const tb = E('table', { class: 'sgt' }, E('tr', null, head.map((h) => E('th', null, h))), rows.map((r) => E('tr', { 'data-size': r[0] }, r.map((c) => E('td', null, c)))));
    const inp = E('input', { type: 'number', inputmode: 'decimal', placeholder: 'Your chest in inches', 'aria-label': 'Your chest in inches', style: { height: '38px', borderRadius: '19px', border: '1px solid #dcdad8', padding: '0 14px', fontSize: '11px', width: '100%' } });
    const res = E('div', { class: 'note', style: { display: 'none' } });
    const find = () => { const n = parseFloat(inp.value); tb.querySelectorAll('tr[data-size]').forEach((x) => x.classList.remove('hit')); if (!(n > 0)) { res.style.display = 'none'; return; }
      const hit = rows.find((r) => { const m = String(r[1] || '').match(/(\d+(?:\.\d+)?)\s*[-–to]+\s*(\d+(?:\.\d+)?)/); return m ? n >= +m[1] && n <= +m[2] + 1.99 : parseFloat(r[1]) === n; }) || null;
      res.style.display = ''; res.textContent = hit ? 'Your size is probably ' + hit[0] + '. Between two sizes? Take the larger for a relaxed fit.' : 'Your measurement is outside this chart. Message the store and we will help.'; if (hit) { const tr = tb.querySelector('tr[data-size="' + hit[0] + '"]'); if (tr) tr.classList.add('hit'); } };
    inp.oninput = find;
    sheet('Size guide', E('div', { class: 'dtl' }, E('div', { class: 'lbl' }, 'Which size am I?'), E('label', { class: 'fld' }, inp), res, tb, g.note ? E('div', null, g.note) : E('div', { class: 'mut' }, 'Measure a piece that fits you well and compare it with the chart. Between sizes, take the larger for a relaxed fit.'), fit ? E('div', null, E('b', null, 'About this piece: '), fit.replace(/^fit\s*:?\s*/i, '')) : null));
  }
  function share() {
    // a clean link (the server gives link previews the product picture) plus a line that names the shop and its website
    const u = location.origin + location.pathname + '?p=' + s.id; const host = location.host;
    const text = s.name + ' · ' + inr(s.price) + '\nVisit ' + D.shop.name + ' at ' + host;
    if (navigator.share) navigator.share({ title: s.name + ' · ' + D.shop.name, text, url: u }).catch(() => {});
    else { try { navigator.clipboard.writeText(text + '\n' + u); toast('Link copied'); } catch (e) { toast(u); } }
  }
  function notify() {
    const ph = E('input', { type: 'tel', inputmode: 'tel', placeholder: 'Your phone number', 'aria-label': 'Phone', value: (LS.get('me', {}) || {}).phone || '', style: { height: '38px', borderRadius: '19px', border: '1px solid #dcdad8', padding: '0 14px', fontSize: '11px', width: '100%' } });
    const vsel = E('select', { 'aria-label': 'Size', style: { height: '38px', borderRadius: '19px', border: '1px solid #dcdad8', padding: '0 14px', fontSize: '11px', width: '100%' } }, s.variants.filter((x) => x.left < 1 || s.badge === 'soldout').map((x) => E('option', { value: x.id }, [x.colour, x.size].filter(Boolean).join(' · ') || s.name)));
    const msg = E('div', { class: 'tiny', style: { minHeight: '14px', color: '#c0392b' } });
    if (!vsel.options.length) s.variants.forEach((x) => vsel.append(E('option', { value: x.id }, [x.colour, x.size].filter(Boolean).join(' · ') || s.name)));
    const sh = sheet('Tell me when it is back', E('div', { class: 'frm' }, E('div', { class: 'mut tiny' }, 'We will send one WhatsApp message when this piece is available again.'), E('label', { class: 'fld' }, vsel), E('label', { class: 'fld' }, ph), msg,
      E('button', { class: 'btn wide', onclick: async (e) => { e.target.disabled = true; try { await rpc('public_sty_notify_me', { p_slug: SLUG, p: { variantId: vsel.value, phone: ph.value, name: ((LS.get('me', {}) || {}).first) || '' } }); sh.close(); toast('Done. We will message you.'); } catch (er) { msg.textContent = er.message; e.target.disabled = false; } } }, 'Notify me')));
  }
  paintGal(); paintInfo();
  try { document.querySelectorAll('script[data-ld]').forEach((x) => x.remove()); const ld = document.createElement('script'); ld.type = 'application/ld+json'; ld.dataset.ld = '1'; ld.textContent = JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name: s.name, image: photos(s).slice(0, 4), description: s.description || s.name, brand: s.brand ? { '@type': 'Brand', name: s.brand } : undefined, sku: s.code || undefined, offers: { '@type': 'Offer', priceCurrency: 'INR', price: s.price, availability: isGone(s) ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock' } }); document.head.append(ld); } catch (e) { /* no JSON-LD */ }
  let more = STY.filter((x) => x.id !== s.id && (x.category === s.category || (s.collection && x.collection === s.collection))).slice(0, 8);
  if (more.length < 4) { const have = new Set(more.map((x) => x.id)); more = more.concat(newest(STY.length).filter((x) => x.id !== s.id && !have.has(x.id))).slice(0, Math.max(4, more.length)); } // always suggest at least 4 (2 when the shop has fewer)
  v.append(E('div', { class: 'crumbs' }, E('a', { href: link('') }, 'Home'), ' / ', E('a', { href: link('shop?cat=' + encodeURIComponent(s.category)) }, s.category), ' / ', s.name), E('div', { class: 'pd' }, gal, info),
    more.length ? E('section', { class: 'band' }, E('div', { class: 'hd' }, E('h2', null, 'Products you may like'), E('a', { class: 'btn sm', href: link('shop?cat=' + encodeURIComponent(s.category)) }, 'Discover more')), E('div', { class: 'row' }, more.map((x) => card(x)))) : null, recentBand(s.id));
  rpc('public_sty_reviews', { p_slug: SLUG, p_style: s.id }).then((rv) => { if (!rv || !rv.count || !document.body.contains(v)) return;
    const box = E('section', { class: 'band' }, E('div', { class: 'hd' }, E('h2', null, 'Reviews'), E('span', { class: 'mut tiny' }, stars(rv.avg) + ' ' + rv.avg + ' · ' + rv.count + (rv.count === 1 ? ' review' : ' reviews'))), E('div', { class: 'frm' }, (rv.items || []).slice(0, 8).map((r) => E('div', { class: 'card' }, E('div', null, E('b', null, stars(r.rating)), r.title ? ' ' + r.title : ''), r.body ? E('div', { class: 'mut' }, r.body) : null, E('div', { class: 'tiny mut' }, (r.name || 'Customer') + ' · verified buyer')))));
    const first = v.querySelector('.band'); first ? v.insertBefore(box, first) : v.append(box); }).catch(() => {});
  setMeta(s.name + ' · ' + D.shop.name, (s.description || s.name).slice(0, 150), photos(s)[0], location.origin + location.pathname + '?p=' + s.id);
  // on a wide screen the details card folds up by itself when you scroll down to the other products, so it never covers them
  const bands = [...v.querySelectorAll('.band')];
  if (bands.length && window.matchMedia('(min-width:900px)').matches && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => { const on = es.some((e) => e.isIntersecting); if (on && !pinned) { folded = true; info.classList.add('fold'); } else if (!on) { pinned = false; folded = false; info.classList.remove('fold'); } }, { threshold: 0.12 });
    bands.forEach((b) => io.observe(b));
  }
  // phone: a slim buy bar appears once the real buttons have scrolled out of view
  if (!window.matchMedia('(min-width:900px)').matches && 'IntersectionObserver' in window && !isGone(s)) {
    const bar = E('div', { class: 'buybar hidden' }, E('div', null, E('div', { class: 'nm' }, s.name), E('div', { class: 'mut tiny' }, inr(s.price))), E('button', { class: 'btn', onclick: () => { window.scrollTo({ top: 0, behavior: 'smooth' }); } }, 'Choose size'));
    document.body.append(bar); const row = info.querySelector('.row2');
    const io2 = new IntersectionObserver((es) => { if (!document.body.contains(v)) { bar.remove(); io2.disconnect(); return; } bar.classList.toggle('hidden', es[0].isIntersecting || es[0].boundingClientRect.top > 0); }, { threshold: 0 });
    if (row) io2.observe(row);
    window.addEventListener('hashchange', () => bar.remove(), { once: true });
  }
};

V.bag = (v) => {
  const ls = bagLines();
  if (!ls.length) { const rec = newest(6); v.append(E('div', { class: 'empty' }, E('h1', null, 'Your bag is empty'), E('div', { class: 'mut' }, 'Pieces you add will wait here.'), E('a', { class: 'btn', href: link('shop') }, 'Shop now')), rec.length ? E('section', { class: 'sec' }, E('div', { class: 'hd' }, E('span', { class: 'lbl' }, 'Products you may like')), gridOf(rec)) : null, recentBand(null)); return; }
  const list = E('div', { class: 'card' }, E('h2', { style: { marginBottom: '6px' } }, 'Bag'), ls.map((l) => E('div', { class: 'ln' }, E('a', { class: 'im', href: link('p/' + l.s.id) }, photosFor(l.s, l.vr.colour)[0] ? E('img', { src: photosFor(l.s, l.vr.colour)[0], alt: '' }) : placeholder(l.s.name)),
    E('div', null, E('div', { class: 't' }, l.s.name), E('div', { class: 's' }, [l.vr.colour, l.vr.size].filter(Boolean).join(' · ')), E('div', { class: 'qty', style: { marginTop: '6px' } }, E('button', { onclick: () => { l.q > 1 ? (bag.find((b) => b.v === l.v).q -= 1) : bag.splice(bag.findIndex((b) => b.v === l.v), 1); saveBag(); route(); } }, '–'), E('span', null, l.q), E('button', { onclick: () => { addBag(l.v, 1); route(); } }, '+'))),
    E('div', { style: { textAlign: 'right' } }, E('div', null, inr(l.vr.price * l.q)), E('button', { class: 'tiny mut', style: { textDecoration: 'underline', marginTop: '8px' }, onclick: () => { bag.splice(bag.findIndex((b) => b.v === l.v), 1); saveBag(); route(); } }, 'Remove')))));
  const t = bagTotal();
  v.append(E('div', { class: 'shophd' }, E('h1', null, 'Bag'), E('div', { class: 'stats' }, E('span', { class: 'stat' }, 'In stock'), E('span', { class: 'stat' }, bagCount() + ' items'), E('span', { class: 'stat' }, inr(t)))),
    E('div', { class: 'two' }, list, E('div', { class: 'card stick sum' }, E('div', { class: 't' }, E('span', null, 'Subtotal'), E('span', null, inr(t))), E('div', { class: 'mut tiny' }, shipLine(t)), freeBar(t), E('a', { class: 'btn wide', href: link('checkout') }, 'Process to checkout'))), recentBand(null));
};
function freeBar(sub) { const fo = +((cfg().shipping || {}).freeOver) || 0; if (!(fo > 0)) return null; const left = Math.max(fo - sub, 0); return E('div', null, E('div', { class: 'mut tiny' }, left ? 'Add ' + inr(left) + ' more for free shipping' : 'You have free shipping'), E('div', { class: 'fbar' }, E('i', { style: { width: Math.min(100, Math.round(sub / fo * 100)) + '%' } }))); }
function shipFee(sub) { const sh = cfg().shipping || {}; const fee = +sh.fee || 0, fo = +sh.freeOver || 0; return fo > 0 && sub >= fo ? 0 : fee; }
function shipLine(sub) { const sh = cfg().shipping || {}; const f = shipFee(sub); return f ? 'Shipping ' + inr(f) + ((+sh.freeOver > 0) ? ' · free above ' + inr(sh.freeOver) : '') : 'Free shipping'; }

const STATES = ['Andhra Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Odisha', 'Punjab', 'Rajasthan', 'Tamil Nadu', 'Telangana', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Other'];
V.checkout = (v) => {
  const ls = bagLines();
  if (!ls.length) { go('bag'); return; }
  const saved = LS.get('me', {}) || {};
  const F = {};
  const f = (key, label, o) => { o = o || {}; const el = o.select ? E('select', { 'aria-label': label }, o.select.map((x) => E('option', { value: x, selected: (saved[key] || o.def) === x }, x))) : o.area ? E('textarea', { placeholder: label, 'aria-label': label }) : E('input', { placeholder: label + (o.opt ? ' (optional)' : ''), 'aria-label': label, type: o.type || 'text', autocomplete: o.ac || 'on', inputmode: o.mode, value: saved[key] || '', maxlength: o.max }); F[key] = el; return E('label', { class: 'fld' }, el); };
  const methods = []; if (D.cod) methods.push(['cod', 'Cash on delivery', 'Pay when the order reaches you']); if (D.upi) methods.push(['upi', 'Pay by UPI', 'Scan a QR with any UPI app after you place the order']); if (cfg().payOnline) methods.push(['online', 'Card, UPI or net banking', 'Pay securely now']);
  let pay = methods[0] ? methods[0][0] : '';
  const payBox = E('div', { class: 'frm' }); const payPaint = () => { clear(payBox); if (!methods.length) { payBox.append(E('div', { class: 'note' }, 'This store is not taking online orders right now. Please contact the store.')); return; } methods.forEach(([k, l, d]) => payBox.append(E('div', { class: 'opt' + (pay === k ? ' on' : ''), role: 'radio', 'aria-checked': pay === k, tabindex: 0, onclick: () => { pay = k; payPaint(); } }, E('i', { class: 'r' }), E('div', null, E('div', null, l), E('div', { class: 'mut tiny' }, d))))); };
  payPaint();
  const t = bagTotal(), sh = shipFee(t); const save = E('input', { type: 'checkbox', checked: !!saved.name });
  let coupon = null; // { code, discount, msg }
  const sumBox = E('div');
  const paintSum = () => { clear(sumBox); const d = coupon ? Math.min(coupon.discount, t + sh) : 0; sumBox.append(E('div', { class: 't', style: { paddingTop: '8px', borderTop: '1px solid var(--line)' } }, E('span', null, 'Subtotal'), E('span', null, inr(t))), E('div', { class: 't' }, E('span', null, 'Shipping'), E('span', null, sh ? inr(sh) : 'Free')), d ? E('div', { class: 't', style: { color: '#1a7f3c' } }, E('span', null, 'Coupon ' + coupon.code), E('span', null, '– ' + inr(d))) : null, E('div', { class: 't g' }, E('span', null, 'Total'), E('span', null, inr(t + sh - d)))); };
  paintSum();
  const cin = E('input', { placeholder: 'Coupon code', 'aria-label': 'Coupon code', style: { textTransform: 'uppercase' } }); const cmsg = E('div', { class: 'tiny', style: { minHeight: '14px' } });
  const capply = async () => { cmsg.style.color = '#c0392b'; if (coupon) { coupon = null; cin.disabled = false; cin.value = ''; cmsg.textContent = ''; capplyBtn.textContent = 'Apply'; paintSum(); return; } if (!cin.value.trim()) return; capplyBtn.disabled = true;
    try { const r = await rpc('public_sty_coupon_check', { p_slug: SLUG, p: { code: cin.value, subtotal: t, phone: (F.phone.value || '').trim() } }); if (r && r.ok) { coupon = { code: r.code, discount: +r.discount }; cmsg.style.color = '#1a7f3c'; cin.disabled = true; capplyBtn.textContent = 'Remove'; paintSum(); } cmsg.textContent = (r && r.msg) || ''; } catch (e) { cmsg.textContent = e.message; } capplyBtn.disabled = false; };
  const capplyBtn = E('button', { class: 'btn out sm', type: 'button', onclick: capply }, 'Apply');
  const err = E('div', { class: 'tiny', role: 'alert', style: { color: '#c0392b', minHeight: '14px' } });
  const btn = E('button', { class: 'btn wide' }, 'Place order');
  const done = (r, g) => {
    if (save.checked) LS.set('me', { first: g('first'), last: g('last'), email: g('email'), phone: g('phone'), address: g('address'), address2: g('address2'), city: g('city'), state: g('state'), pin: g('pin'), country: g('country'), name: 1 }); else LS.set('me', {});
    const mine = LS.get('orders', []); mine.unshift({ token: r.token, number: r.number, phone: g('phone') }); LS.set('orders', mine.slice(0, 20));
    TR.push('order', null, { total: r.total }); TR.flush(); bag = []; saveBag(); go('order/' + r.token);
  };
  btn.onclick = async () => {
    const g = (k) => (F[k].value || '').trim(); err.textContent = '';
    const name = [g('first'), g('last')].filter(Boolean).join(' ');
    const miss = !g('phone') ? 'your phone number' : !g('first') ? 'your first name' : !g('pin') ? 'your PIN code' : !g('address') ? 'your address' : !g('city') ? 'your city' : '';
    if (miss) { err.textContent = 'Please enter ' + miss + '.'; return; }
    if (!pay) { err.textContent = 'Choose how you want to pay.'; return; }
    btn.disabled = true; btn.textContent = 'Placing…';
    try {
      const r = await rpc('public_sty_place_order', { p_slug: SLUG, p: { name, email: g('email'), phone: g('phone'), address: g('address'), address2: g('address2'), city: g('city'), state: g('state'), pin: g('pin'), country: g('country'), note: g('note'), payment: pay, coupon: coupon ? coupon.code : '', lines: bagLines().map((l) => ({ variantId: l.v, qty: l.q })) } });
      if (pay === 'online') { await rzpPay(r.token, () => done(r, g), () => { done(r, g); }); return; }
      done(r, g);
    } catch (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = 'Place order'; }
  };
  // fill city and state from the PIN code (free India Post lookup); if it is unreachable the person just types them
  const pinAuto = async () => { const p = (F.pin.value || '').trim(); if (!/^\d{6}$/.test(p)) return; try { const r = await fetch('https://api.postalpincode.in/pincode/' + p); const j = await r.json(); const po = j && j[0] && j[0].PostOffice && j[0].PostOffice[0]; if (po) { if (!F.city.value) F.city.value = po.District || po.Block || ''; const st = STATES.find((x) => x.toLowerCase() === String(po.State || '').toLowerCase()); if (st) F.state.value = st; } } catch (e) { /* offline or blocked: manual entry */ } };
  // remember the bag against the phone so the shop can remind the customer (only if the shop switched this on)
  let lastCart = ''; const saveCart = () => { const ph = (F.phone.value || '').replace(/\D/g, ''); if (!cfg().abandonWa || ph.length < 10 || lastCart === ph) return; lastCart = ph; rpc('public_sty_cart_save', { p_slug: SLUG, p: { phone: ph, name: (F.first.value || '').trim(), lines: bagLines().map((l) => ({ variantId: l.v, qty: l.q })) } }).catch(() => {}); };
  v.append(E('div', { class: 'shophd' }, E('h1', null, 'Checkout')), E('div', { class: 'two' },
    E('div', { class: 'card frm' }, E('h2', null, 'Contact'), f('phone', 'Phone', { type: 'tel', ac: 'tel', mode: 'tel', max: 14 }), f('email', 'Email', { type: 'email', ac: 'email', opt: true }),
      E('h2', null, 'Delivery'), E('div', { class: 'f2' }, f('first', 'First name', { ac: 'given-name' }), f('last', 'Last name', { ac: 'family-name', opt: true })), f('pin', 'PIN code', { mode: 'numeric', ac: 'postal-code', max: 6 }), f('address', 'Address', { ac: 'street-address' }), f('address2', 'Apartment, suite, etc.', { opt: true }),
      E('div', { class: 'f2' }, f('city', 'City'), f('state', 'State', { select: STATES, def: 'Rajasthan' })), f('country', 'Country', { select: ['India'], def: 'India' }), f('note', 'Notes for the store (optional)', { area: true }),
      E('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, save, 'Save this information for next time'),
      E('h2', null, 'Shipping method'), E('div', { class: 'note' }, shipLine(t)), E('h2', null, 'Payment'), E('div', { class: 'mut tiny' }, 'All transactions are secure.'), payBox),
    E('div', { class: 'card stick sum' }, E('h2', { style: { marginBottom: '6px' } }, 'Order summary'), ls.map((l) => E('div', { class: 't' }, E('span', null, l.s.name + ' × ' + l.q + (l.vr.size ? ' · ' + l.vr.size : '')), E('span', null, inr(l.vr.price * l.q)))),
      E('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px' } }, E('label', { class: 'fld', style: { flex: 1 } }, cin), capplyBtn), cmsg, sumBox, err, btn,
      E('div', { class: 'mut tiny' }, 'By placing the order you agree to the ', E('a', { href: link('policy/terms'), style: { textDecoration: 'underline' } }, 'terms'), ' and the ', E('a', { href: link('policy/returns'), style: { textDecoration: 'underline' } }, 'returns policy'), '.'))));
  F.pin.addEventListener('input', pinAuto); F.pin.addEventListener('change', pinAuto); F.phone.addEventListener('blur', saveCart); F.phone.addEventListener('change', saveCart);
};
// card / UPI / net banking with the shop's own Razorpay account; the server checks the signature before anything is marked paid
function loadRzp() { return new Promise((res, rej) => { if (window.Razorpay) return res(); const sc = document.createElement('script'); sc.src = 'https://checkout.razorpay.com/v1/checkout.js'; sc.onload = res; sc.onerror = () => rej(new Error('Could not load the payment window. Check your connection.')); document.head.append(sc); }); }
async function rzpPay(token, ok, later) {
  const base = (window.CFG || {}).url || '';
  const post = async (path, body) => { const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || j.message || 'Payment could not start'); return j; };
  let st; try { st = await post('/payments/sty/start', { token }); await loadRzp(); } catch (e) { toast(e.message); later(); return; }
  const rz = new window.Razorpay({ key: st.key, order_id: st.orderId, amount: st.amount, currency: 'INR', name: D.shop.name, description: 'Order ' + st.number, prefill: { name: st.name, contact: st.phone, email: st.email },
    handler: async (resp) => { try { await post('/payments/sty/verify', { token, razorpay_order_id: resp.razorpay_order_id, razorpay_payment_id: resp.razorpay_payment_id, razorpay_signature: resp.razorpay_signature }); toast('Payment received'); } catch (e) { toast('We could not confirm the payment yet. The store will check it.'); } ok(); },
    modal: { ondismiss: () => { toast('Payment not completed. You can pay from your order page.'); later(); } } });
  rz.open();
}

// delivered orders: rate what you bought, or ask for a return / exchange
function afterSale(o, tok, v) {
  const wrap = E('div', { class: 'card', style: { marginTop: '10px' } });
  const reviewed = new Set((o.reviewed || []).map(String));
  const seenS = new Set(); const rows = [];
  (o.lines || []).forEach((l) => { const sid = l.styleId; if (!sid || seenS.has(sid)) return; seenS.add(sid); rows.push(l); });
  if (rows.length) {
    wrap.append(E('h2', null, 'How was it?'));
    rows.forEach((l) => {
      const box = E('div', { class: 'frm', style: { margin: '8px 0' } });
      if (reviewed.has(String(l.styleId))) { box.append(E('div', { class: 'mut tiny' }, l.name + ': thank you for your review.')); wrap.append(box); return; }
      let rate = 0; const sb2 = E('div', { class: 'stars' }); const paint = () => { clear(sb2); for (let i = 1; i <= 5; i++) sb2.append(E('button', { type: 'button', 'aria-label': i + ' stars', style: { fontSize: '22px', color: i <= rate ? '#111' : '#c8c5c2' }, onclick: () => { rate = i; paint(); } }, '★')); }; paint();
      const body = E('textarea', { placeholder: 'Tell others about the fit and quality (optional)', 'aria-label': 'Review', style: { height: '64px', borderRadius: '16px', border: '1px solid #dcdad8', padding: '10px 14px', fontSize: '11px', width: '100%' } }); const m = E('div', { class: 'tiny', style: { color: '#c0392b' } });
      box.append(E('div', { class: 't' }, l.name), sb2, body, m, E('button', { class: 'btn sm', onclick: async (e) => { if (!rate) { m.textContent = 'Choose 1 to 5 stars'; return; } e.target.disabled = true; try { await rpc('public_sty_review_submit', { p_token: tok, p: { styleId: l.styleId, rating: rate, body: body.value } }); clear(box).append(E('div', { class: 'mut tiny' }, 'Thank you for your review.')); } catch (er) { m.textContent = er.message; e.target.disabled = false; } } }, 'Post review'));
      wrap.append(box);
    });
  }
  if (o.returns && o.returns.length) wrap.append(E('h2', { style: { marginTop: '10px' } }, 'Return / exchange'), o.returns.map((r) => E('div', { class: 'note', style: { marginTop: '6px' } }, cap(r.kind) + ': ' + cap(r.status) + (r.staffNote ? ' · ' + r.staffNote : ''))));
  if (o.canReturn) {
    const kind = { v: 'return' }; const reason = E('input', { placeholder: 'Reason (size, fit, damaged...)', 'aria-label': 'Reason' }); const m = E('div', { class: 'tiny', style: { color: '#c0392b', minHeight: '14px' } });
    const kb = E('div', { class: 'fwrap' }); const kp = () => { clear(kb); ['return', 'exchange'].forEach((k) => kb.append(E('button', { type: 'button', class: 'sz' + (kind.v === k ? ' on' : ''), onclick: () => { kind.v = k; kp(); } }, cap(k)))); }; kp();
    wrap.append(E('h2', { style: { marginTop: '10px' } }, 'Return or exchange'), E('div', { class: 'mut tiny', style: { margin: '2px 0 8px' } }, 'Within ' + o.returnDays + ' days of delivery, tags intact.'), E('div', { class: 'frm' }, kb, E('label', { class: 'fld' }, reason), m,
      E('button', { class: 'btn sm out', onclick: async (e) => { e.target.disabled = true; try { await rpc('public_sty_return_request', { p_token: tok, p: { kind: kind.v, reason: reason.value, items: (o.lines || []).map((l) => ({ name: l.name, size: l.size, colour: l.colour, qty: l.qty })) } }); toast('Request sent'); const y = scrollY; await V.order(v, tok); scrollTo(0, y); } catch (er) { m.textContent = er.message; e.target.disabled = false; } } }, 'Send request')));
  }
  return wrap.children.length ? wrap : null;
}
const LIVE_MSG = { new: 'We have your order', confirmed: 'Confirmed, we are getting it ready', packed: 'Packed and waiting for pickup', shipped: 'On its way to you', delivered: 'Delivered. Enjoy!', cancelled: 'This order was cancelled' };
V.order = async (v, tok) => {
  clearInterval(v._ot);
  v.append(E('div', { class: 'spin' }));
  let o; try { o = await rpc('public_sty_order', { p_token: tok }); } catch (e) { o = null; }
  clear(v);
  if (!o) { v.append(E('div', { class: 'empty' }, E('h2', null, 'Order not found'), E('a', { class: 'btn', href: link('') }, 'Home'))); return; }
  const steps = ['new', 'confirmed', 'packed', 'shipped', 'delivered']; const at = steps.indexOf(o.status);
  const pbox = E('div');
  if (o.upi && o.payment === 'upi' && o.paymentStatus !== 'paid') {
    let img = ''; try { const q = qrcode(0, 'M'); q.addData('upi://pay?pa=' + encodeURIComponent(o.upi.id) + '&pn=' + encodeURIComponent(o.upi.name || '') + '&am=' + (+o.total).toFixed(2) + '&cu=INR&tn=' + encodeURIComponent('Order ' + o.number)); q.make(); img = q.createDataURL(5, 2); } catch (e) { /* no QR library */ }
    const utr = E('input', { placeholder: 'UPI reference number (UTR)', 'aria-label': 'UTR' }), msg = E('div', { class: 'tiny', style: { color: '#c0392b' } });
    pbox.append(E('div', { class: 'card', style: { marginTop: '10px' } }, E('h2', null, 'Pay ' + inr(o.total)), E('div', { class: 'mut tiny', style: { margin: '4px 0 10px' } }, 'Scan with any UPI app, or pay to ' + o.upi.id + '.'),
      E('div', { class: 'qrbox' }, img ? E('img', { src: img, alt: 'UPI QR' }) : null, E('div', { class: 'lbl' }, o.upi.id)),
      o.paymentStatus === 'submitted' ? E('div', { class: 'note', style: { marginTop: '10px' } }, 'Thank you. We have your reference and will confirm the payment shortly.') : E('div', { class: 'frm', style: { marginTop: '10px' } }, E('label', { class: 'fld' }, utr), msg, E('button', { class: 'btn wide', onclick: async (e) => { e.target.disabled = true; try { await rpc('public_sty_order_paid', { p_token: tok, p_utr: utr.value }); route(); } catch (er) { msg.textContent = er.message; e.target.disabled = false; } } }, 'I have paid'))));
  }
  v.append(E('div', { class: 'pg' }, E('div', { class: 'card' }, E('div', { class: 'lbl' }, 'Order ' + o.number), E('h1', { style: { margin: '4px 0' } }, o.status === 'cancelled' ? 'Order cancelled' : 'Thank you, ' + (o.customer.name || '').split(' ')[0]),
    E('div', { class: 'mut' }, o.payment === 'cod' ? 'Pay ' + inr(o.total) + ' in cash when it arrives.' : o.paymentStatus === 'paid' ? 'Payment received.' : 'We will confirm your order once the payment is checked.'),
    o.status === 'cancelled' ? null : E('div', { class: 'steps' }, steps.map((_, i) => E('i', { class: i <= at ? 'on' : '' }))), o.status === 'cancelled' ? null : E('div', { class: 'live' }, o.status === 'cancelled' ? null : E('i'), E('b', null, cap(o.status)), E('span', null, ' · ' + (LIVE_MSG[o.status] || '')), E('div', { class: 'tiny mut' }, 'Updates by itself · checked ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }))),
    E('div', { style: { marginTop: '12px' } }, (o.lines || []).map((l) => E('div', { class: 'ln' }, E('div', { class: 'im' }, l.photo ? E('img', { src: l.photo, alt: '' }) : placeholder(l.name)), E('div', null, E('div', { class: 't' }, l.name), E('div', { class: 's' }, [l.colour, l.size].filter(Boolean).join(' · ') + ' × ' + l.qty)), E('div', null, inr(l.price * l.qty))))),
    E('div', { class: 'sum', style: { marginTop: '10px' } }, E('div', { class: 't' }, E('span', null, 'Shipping'), E('span', null, o.shipping ? inr(o.shipping) : 'Free')), +o.discount ? E('div', { class: 't', style: { color: '#1a7f3c' } }, E('span', null, 'Coupon' + (o.coupon ? ' ' + o.coupon : '')), E('span', null, '– ' + inr(o.discount))) : null, E('div', { class: 't g' }, E('span', null, 'Total'), E('span', null, inr(o.total)))),
    trackBox(o),
    E('div', { class: 'mut tiny', style: { marginTop: '10px' } }, 'Save this page to follow your order. Questions? ', E('a', { href: link('contact'), style: { textDecoration: 'underline' } }, 'Contact us'))), pbox, o.status === 'delivered' ? afterSale(o, tok, v) : null, E('a', { class: 'btn out', href: link('shop'), style: { justifySelf: 'center' } }, 'Keep shopping')));
  if (!['delivered', 'cancelled'].includes(o.status)) { const last = o.status + '|' + o.paymentStatus; v._ot = setInterval(async () => { if (!document.body.contains(v) || !location.hash.includes(tok)) return clearInterval(v._ot); let n = null; try { n = await rpc('public_sty_order', { p_token: tok }); } catch { return; } if (n && n.status + '|' + n.paymentStatus !== last) { clearInterval(v._ot); const y = scrollY; await V.order(v, tok); scrollTo(0, y); toast('Order update: ' + cap(n.status)); } }, 12000); }
};

function mapUrl(st) { return st.mapUrl || 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([st.name, st.address].filter(Boolean).join(' ')); }
function storeList() { const st = (cfg().stores || []).filter((x) => x && (x.name || x.address)); if (st.length) return st; return D.shop.address ? [{ name: D.shop.name, address: D.shop.address, phone: D.shop.phone }] : []; }
function storeCards(list) {
  const row = E('div', { class: 'swc' }, list.map((st) => E('div', { class: 'swcard' },
    E('div', { class: 'im' }, st.photo ? E('img', { src: st.photo, alt: st.name || '', loading: 'lazy' }) : null),
    E('div', { class: 'tx' }, E('h3', null, st.name || 'Store'), E('div', { class: 'ad' }, st.address || '', st.hours ? E('div', { class: 'mut' }, st.hours) : null),
      E('a', { class: 'gd', href: mapUrl(st), target: '_blank', rel: 'noopener' }, 'Get Direction \u2197'),
      st.phone ? E('a', { class: 'ph2', href: 'tel:' + String(st.phone).replace(/[^\d+]/g, '') }, st.phone) : E('span')))));
  return row;
}
V.stores = (v) => { const l = storeList(); v.append(E('div', { class: 'pg wide' }, E('div', { class: 'shophd' }, E('h1', null, 'Our stores')), l.length ? storeCards(l) : E('div', { class: 'card mut' }, 'Store details are coming soon.'))); };
V.about = (v) => {
  const a = cfg().about || {}, fs = (cfg().founders || []).filter((x) => x && x.name);
  v.append(E('div', { class: 'pg' }, E('div', { class: 'shophd' }, E('h1', null, a.title || 'About us')), E('div', { class: 'card' }, a.image ? E('img', { src: a.image, alt: '', style: { borderRadius: '18px', marginBottom: '14px', width: '100%', maxHeight: '420px', objectFit: 'cover' } }) : null, String(a.text || 'We make clothes we love to wear. Visit a store or order online.').split(/\n+/).map((p) => E('p', null, p))),
    fs.length ? [E('h2', { style: { padding: '8px 4px 0' } }, 'Founders'), E('div', { class: 'scards' }, fs.map((f) => E('div', { class: 'scard' }, f.photo ? E('div', { class: 'im', style: { aspectRatio: '4/3' } }, E('img', { src: f.photo, alt: f.name, loading: 'lazy' })) : null, E('div', { class: 'b' }, E('h3', null, f.name), f.role ? E('div', { class: 'lbl' }, f.role) : null, f.bio ? E('div', { class: 'mut' }, f.bio) : null))))] : null));
};
V.faq = (v) => {
  const fq = (cfg().faqs || []).filter((x) => x && x.q); const cats = [...new Set(fq.map((x) => x.cat || 'General'))]; let cat = cats[0];
  const host = E('div'); const bar = E('div', { class: 'faqcats' });
  const paint = () => { clear(bar).append(...cats.map((c) => E('button', { class: 'chip' + (c === cat ? ' on' : ''), onclick: () => { cat = c; paint(); } }, c))); clear(host).append(...fq.filter((x) => (x.cat || 'General') === cat).map((x) => { const d = E('div', { class: 'fq' }); const b = E('button', { 'aria-expanded': 'false', onclick: () => { d.classList.toggle('on'); b.setAttribute('aria-expanded', d.classList.contains('on')); pl.textContent = d.classList.contains('on') ? '–' : '+'; } }, E('span', null, x.q)); const pl = E('span', { class: 'pl' }, '+'); b.append(pl); d.append(b, E('div', { class: 'a' }, x.a)); return d; })); };
  paint();
  v.append(E('div', { class: 'pg' }, E('div', { class: 'shophd' }, E('h1', null, 'Frequently asked')), fq.length ? [bar, host] : E('div', { class: 'card mut' }, 'Questions and answers will appear here. For anything else, ', E('a', { href: link('contact'), style: { textDecoration: 'underline' } }, 'contact us'), '.')));
};
V.contact = (v) => {
  const c = cfg(); const ph = String(D.shop.phone || '').replace(/\D/g, ''); const wa = ph ? 'https://wa.me/' + (ph.length === 10 ? '91' + ph : ph) : '';
  const name = E('input', { placeholder: 'Your name', 'aria-label': 'Name' }), msg = E('textarea', { placeholder: 'How can we help?', 'aria-label': 'Message' });
  v.append(E('div', { class: 'pg' }, E('div', { class: 'shophd' }, E('h1', null, 'Contact')), E('div', { class: 'card frm' }, D.shop.phone ? E('div', null, E('span', { class: 'lbl' }, 'Phone'), E('div', null, E('a', { href: 'tel:' + D.shop.phone }, D.shop.phone))) : null, c.email ? E('div', null, E('span', { class: 'lbl' }, 'Email'), E('div', null, E('a', { href: 'mailto:' + c.email }, c.email))) : null, D.shop.address ? E('div', null, E('span', { class: 'lbl' }, 'Address'), E('div', null, D.shop.address)) : null,
    wa ? [E('label', { class: 'fld' }, name), E('label', { class: 'fld' }, msg), E('button', { class: 'btn wide', onclick: () => window.open(wa + '?text=' + encodeURIComponent((name.value ? 'Hi, I am ' + name.value + '. ' : 'Hi. ') + msg.value), '_blank', 'noopener') }, 'Message on WhatsApp')] : null)));
};
const STAT_MSG = { new: 'We have your order', confirmed: 'Confirmed, getting it ready', packed: 'Packed, waiting for pickup', shipped: 'On its way', delivered: 'Delivered', cancelled: 'Cancelled' };
V.orders = async (v) => {
  clearInterval(v._ot);
  const saved = LS.get('me', {}) || {}; const F = {};
  const fld = (key, label, o) => { o = o || {}; const el = o.area ? E('textarea', { 'aria-label': label, placeholder: label }) : E('input', { 'aria-label': label, placeholder: label, type: o.type || 'text', inputmode: o.mode }); el.value = saved[key] || ''; F[key] = el; return E('div', { class: 'fld' }, el); };
  const msg = E('div', { class: 'tiny', style: { minHeight: '14px', color: '#1a7f3c' } });
  const prof = E('div', { class: 'card' }, E('h2', null, 'My details'), E('div', { class: 'mut tiny', style: { margin: '2px 0 8px' } }, 'Saved on this phone only, so checkout is quicker next time.'),
    E('div', { class: 'frm' }, E('div', { class: 'two' }, fld('first', 'First name'), fld('last', 'Last name')), E('div', { class: 'two' }, fld('phone', 'Phone', { type: 'tel', mode: 'tel' }), fld('email', 'Email', { type: 'email' })), fld('address', 'Address'), fld('address2', 'Apartment, floor (optional)'), E('div', { class: 'two' }, fld('city', 'City'), fld('state', 'State')), fld('pin', 'PIN code', { mode: 'numeric' }),
      E('div', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, E('button', { class: 'btn', onclick: () => { const me = {}; Object.keys(F).forEach((k) => { me[k] = F[k].value.trim(); }); me.country = saved.country || 'India'; me.name = 1; LS.set('me', me); msg.textContent = 'Saved'; setTimeout(() => { msg.textContent = ''; }, 2000); } }, 'Save my details'), E('button', { class: 'btn out', onclick: () => { if (confirm('Remove my saved details from this phone?')) { LS.set('me', {}); Object.values(F).forEach((e) => { e.value = ''; }); msg.textContent = 'Removed'; } } }, 'Clear'), msg)));
  const mine = LS.get('orders', []);
  const box = E('div', { class: 'ords' });
  const fnum = E('input', { placeholder: 'Order number', 'aria-label': 'Order number' }), fph = E('input', { placeholder: 'Phone used on the order', type: 'tel', inputmode: 'tel', 'aria-label': 'Phone', value: saved.phone || '' }), fmsg = E('div', { class: 'tiny', style: { color: '#c0392b', minHeight: '14px' } });
  const find = E('div', { class: 'card' }, E('h2', null, 'Find an order'), E('div', { class: 'mut tiny', style: { margin: '2px 0 8px' } }, 'On another phone or lost the link? Enter the order number and your phone.'), E('div', { class: 'frm' }, E('label', { class: 'fld' }, fnum), E('label', { class: 'fld' }, fph), fmsg,
    E('button', { class: 'btn', onclick: async (e) => { e.target.disabled = true; fmsg.textContent = ''; try { const r = await rpc('public_sty_order_find', { p_slug: SLUG, p: { number: fnum.value, phone: fph.value } }); const l = LS.get('orders', []); if (!l.some((x) => x.token === r.token)) { l.unshift({ token: r.token, number: fnum.value.trim().toUpperCase() }); LS.set('orders', l.slice(0, 20)); } go('order/' + r.token); } catch (er) { fmsg.textContent = er.message; } e.target.disabled = false; } }, 'Find my order')));
  v.append(E('div', { class: 'pg' }, E('div', { class: 'shophd' }, E('h1', null, saved.first ? 'Hi, ' + saved.first : 'My account')), prof, E('h2', { style: { padding: '12px 4px 4px' } }, 'My orders'), box, find));
  if (!mine.length) { box.append(E('div', { class: 'card mut' }, 'Orders you place on this phone show here with live status. ', E('a', { href: link('shop'), style: { textDecoration: 'underline' } }, 'Shop now'))); return; }
  const open = new Set(); let state = {};
  const paint = () => { clear(box); mine.forEach((m) => { const o = state[m.token]; if (!o) return; const live = !['delivered', 'cancelled'].includes(o.status);
    const det = E('div', { class: 'od' }, (o.lines || []).map((l) => E('div', { class: 'ln' }, E('div', { class: 'im' }, l.photo ? E('img', { src: l.photo, alt: '' }) : placeholder(l.name)), E('div', null, E('div', { class: 't' }, l.name), E('div', { class: 's' }, [l.colour, l.size].filter(Boolean).join(' · ') + ' × ' + l.qty)), E('div', null, inr(l.price * l.qty)))),
      E('div', { class: 'sum' }, E('div', { class: 't' }, E('span', null, 'Shipping'), E('span', null, o.shipping ? inr(o.shipping) : 'Free')), E('div', { class: 't g' }, E('span', null, 'Total'), E('span', null, inr(o.total)))),
      E('div', { class: 'tiny mut' }, (o.payment === 'cod' ? 'Cash on delivery' : o.paymentStatus === 'paid' ? 'Paid' : 'Payment: ' + o.paymentStatus) + ' · placed ' + new Date(o.createdAt).toLocaleDateString('en-GB')), trackBox(o), E('a', { class: 'btn sm out', href: link('order/' + m.token), style: { justifySelf: 'start' } }, 'Open order page'));
    const steps = ['new', 'confirmed', 'packed', 'shipped', 'delivered']; const at = steps.indexOf(o.status);
    box.append(E('div', { class: 'card oc' }, E('button', { class: 'oh', onclick: () => { open.has(m.token) ? open.delete(m.token) : open.add(m.token); paint(); } }, E('div', null, E('div', { class: 't' }, o.number), E('div', { class: 'live' }, live ? E('i') : null, E('b', null, cap(o.status)), E('span', null, ' · ' + (STAT_MSG[o.status] || '')))), E('div', { class: 'tr' }, inr(o.total))),
      o.status === 'cancelled' ? null : E('div', { class: 'steps' }, steps.map((_, i) => E('i', { class: i <= at ? 'on' : '' }))), open.has(m.token) ? det : null)); }); };
  async function load(quiet) { const rows = await Promise.all(mine.map((m) => rpc('public_sty_order', { p_token: m.token }).catch(() => null))); const nx = {}; let changed = false; mine.forEach((m, i) => { if (rows[i]) { nx[m.token] = rows[i]; const was = state[m.token]; if (was && was.status !== rows[i].status) { changed = true; if (quiet) toast(rows[i].number + ': ' + cap(rows[i].status)); } } }); state = nx; paint(); return changed; }
  box.append(E('div', { class: 'spin' })); await load(false);
  v._ot = setInterval(() => { if (!document.body.contains(v) || !location.hash.includes('orders')) return clearInterval(v._ot); load(true); }, 12000);
};
V.me = V.orders;

// ---------- Journal (blogs / news), Media & gallery, Careers: all written by the owner in AUZsStyle -> Online store -> Store ----------
const dateTxt = (d) => { try { return d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : ''; } catch (e) { return ''; } };
const para = (t) => String(t || '').split(/\n+/).filter(Boolean).map((x) => E('p', null, x));
V.blog = (v, which) => {
  const list = (cfg().blogs || []).filter((x) => x && x.title);
  if (which) {
    const i = list.findIndex((x, k) => slugOf(x.title) === which || String(k) === which); const b = list[i];
    if (!b) { v.append(E('div', { class: 'empty' }, E('h2', null, 'Article not found'), E('a', { class: 'btn', href: link('blog') }, 'All articles'))); return; }
    setMeta(b.title + ' · ' + D.shop.name, b.excerpt || String(b.body || '').slice(0, 150), b.image, location.origin + location.pathname + '#/blog/' + slugOf(b.title));
    const others = list.filter((x, k) => k !== i).slice(0, 2);
    v.append(E('div', { class: 'pg' }, E('div', { class: 'crumbs' }, E('a', { href: link('') }, 'Home'), ' / ', E('a', { href: link('blog') }, 'Journal')),
      E('article', { class: 'card art' }, b.image ? E('img', { src: b.image, alt: '', class: 'artimg' }) : null, b.date ? E('div', { class: 'lbl' }, dateTxt(b.date)) : null, E('h1', null, b.title), para(b.body || b.excerpt)),
      others.length ? E('section', { class: 'sec' }, E('div', { class: 'hd' }, E('span', { class: 'lbl' }, 'Keep reading')), blogGrid(others)) : null));
    return;
  }
  v.append(E('div', { class: 'pg wide' }, E('div', { class: 'shophd' }, E('h1', null, 'Journal')), list.length ? blogGrid(list) : E('div', { class: 'card mut' }, 'Nothing published yet. Check back soon.')));
};
function blogGrid(list) {
  return E('div', { class: 'bgrid' }, list.map((b) => E('a', { class: 'bcard', href: link('blog/' + slugOf(b.title)) },
    E('div', { class: 'im' }, b.image ? E('img', { src: b.image, alt: '', loading: 'lazy' }) : placeholder(b.title)),
    E('div', { class: 'tx' }, E('h3', null, b.title), E('p', null, b.excerpt || String(b.body || '').slice(0, 130))))));
}
V.media = (v) => {
  const list = (cfg().media || []).filter((x) => x && (x.title || x.image));
  const open = (m) => { const u = m.link || ''; if (!u) return null; return /^https?:|^\/\//.test(u) ? E('a', { class: 'btn soft sm', href: u, target: '_blank', rel: 'noopener' }, m.cta || 'View') : E('a', { class: 'btn soft sm', href: /^#/.test(u) ? u : link(u.replace(/^\/+/, '')) }, m.cta || 'View'); };
  v.append(E('div', { class: 'pg wide' }, E('div', { class: 'shophd' }, E('h1', null, 'Media & gallery')), list.length ? E('div', { class: 'mgal' }, list.map((m) => E('div', { class: 'mcard' },
    E('div', { class: 'im' }, m.image ? E('img', { src: m.image, alt: m.title || '', loading: 'lazy' }) : placeholder(m.title)),
    E('div', { class: 'ft' }, E('div', null, m.title ? E('div', { class: 't' }, m.title) : null, m.date ? E('div', { class: 's' }, dateTxt(m.date)) : null, m.place ? E('div', { class: 's' }, m.place) : null), open(m))))) : E('div', { class: 'card mut' }, 'Nothing here yet. Check back soon.')));
};
V.careers = (v) => {
  const h = cfg().hiring || {}, jobs = (cfg().jobs || []).filter((x) => x && x.title && x.active !== false && x.status !== 'closed');
  const ph = String(D.shop.phone || '').replace(/\D/g, '');
  const apply = (j) => { const subj = 'Application: ' + j.title; if (h.email) return 'mailto:' + h.email + '?subject=' + encodeURIComponent(subj); if (ph) return 'https://wa.me/' + (ph.length === 10 ? '91' + ph : ph) + '?text=' + encodeURIComponent('Hi, I would like to apply for ' + j.title); return link('contact'); };
  v.append(E('div', { class: 'pg wide' }, E('div', { class: 'card hire' }, E('h1', null, 'We are hiring'), E('p', null, h.text || ('If you see yourself growing with ' + D.shop.name + ', we would love to hear from you.' + (h.email ? ' Send your resume to ' + h.email + ' and our team will be in touch.' : '')))),
    jobs.length ? E('div', { class: 'jobs' }, jobs.map((j) => E('div', { class: 'job' },
      E('div', { class: 'jt' }, E('div', null, E('h3', null, j.title), j.exp ? E('div', { class: 's' }, j.exp) : null), E('span', { class: 'act' }, E('i'), 'Active')),
      E('div', { class: 'jtags' }, String(j.tags || '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => E('span', null, x))),
      j.desc ? E('div', { class: 'jd' }, j.desc) : null,
      E('div', { class: 'jf' }, E('div', { class: 'jl' }, j.location || ''), E('a', { class: 'btn', href: apply(j), target: /^https?:/.test(apply(j)) ? '_blank' : null, rel: 'noopener' }, 'Apply now'))))) : E('div', { class: 'card mut', style: { marginTop: '10px' } }, 'No open roles right now. Write to us anyway' + (h.email ? ' at ' + h.email : '') + '.')));
};
const POL = { shipping: ['Shipping', () => (cfg().policies || {}).shipping || 'We ship across India. Orders are packed within 1 to 2 working days and usually arrive in 3 to 7 days. You will get an update on the phone number you gave us.'], returns: ['Returns & exchanges', () => (cfg().policies || {}).returns || 'You can return or exchange a piece within ' + (D.shop.returnDays || 30) + ' days of delivery if it is unworn, unwashed and the tags are intact. Contact the store to arrange it.'], terms: ['Terms', () => (cfg().policies || {}).terms || 'By placing an order you confirm that the details you gave are correct. Prices include taxes. An order is confirmed only after the store accepts it, and the store may cancel an order if an item cannot be supplied.'], privacy: ['Privacy', () => (cfg().policies || {}).privacy || 'We use your name, phone, email and address only to deliver your order and to contact you about it. We do not sell your details.'] };
V.policy = (v, k) => { const p = POL[k] || POL.terms; v.append(E('div', { class: 'pg' }, E('div', { class: 'shophd' }, E('h1', null, p[0])), E('div', { class: 'card' }, String(p[1]()).split(/\n+/).map((x) => E('p', null, x))))); };

function footer() {
  const c = cfg(), so = c.social || {}; const ph = String(D.shop.phone || '').replace(/\D/g, '');
  const ext = (t, u) => (u ? E('a', { href: /^https?:/.test(u) ? u : 'https://' + u, target: '_blank', rel: 'noopener' }, t) : null);
  const cats = [...new Set(STY.map((x) => x.category).filter(Boolean))].slice(0, 8);
  const fams = FAM.filter((f) => STY.some((x) => colours(x).some((k) => famOf(k) === f[0])));
  const tabs = [['Popular searches', cats.slice(0, 8).map((x) => [x, 'shop?cat=' + encodeURIComponent(x)])], ['Shop by category', cats.map((x) => [x, 'shop?cat=' + encodeURIComponent(x)])], ['Shop by style', D.collections.filter((x) => x.styleIds.length).map((x) => [x.name, 'shop?col=' + x.id])], ['Shop by colour', fams.map((f) => [f[0], 'shop?fam=' + f[0]])]].filter((t) => t[1].length);
  const pn = E('div', { class: 'ftpanel' });
  const tabEls = tabs.map((t, i) => E('button', { class: 'ftab', onclick: () => { const on = tabEls[i].classList.contains('on'); tabEls.forEach((b) => b.classList.remove('on')); clear(pn); if (on) return; tabEls[i].classList.add('on'); pn.append(...t[1].map(([n, p]) => E('a', { href: link(p) }, n))); } }, t[0]));
  const ab = cfg().about; const blurb = (ab && typeof ab === 'object' ? (ab.text || ab.body || '') : (ab || '')) || D.shop.tagline || ('Shop ' + D.shop.name + ' online. Fresh styles, easy returns and delivery across India.');
  const more = E('button', { class: 'ftmore', onclick: () => { const t = fold.classList.toggle('open'); more.textContent = t ? 'Read less' : 'Read more...'; } }, 'Read more...');
  const fold = E('div', { class: 'ftfold' }, E('p', null, blurb), more);
  const strip = tabs.length ? E('div', { class: 'ftstrip' }, fold, E('div', { class: 'ftabs' }, tabEls), pn) : null;
  const perk = (ic, t, d) => E('div', { class: 'perk' }, icon(ic), E('div', null, E('b', null, t), E('span', null, d)));
  const fo = +((c.shipping || {}).freeOver) || 0, pays = [D.cod ? 'Cash on delivery' : '', D.upi ? 'UPI' : '', c.payOnline ? 'Cards' : ''].filter(Boolean).join(' · ');
  const perks = E('div', { class: 'perks' }, perk('ship', 'Delivery across India', fo ? 'Free above ' + inr(fo) : 'Packed fresh, tracked to you'), perk('tag', 'Easy returns', (D.shop.returnDays || 30) + ' days from delivery'),
    ph ? perk('chat', 'Talk to the store', 'Message us on WhatsApp') : perk('chat', 'We reply fast', 'See Contact for help'), perk('globe', 'Pay your way', pays || 'Ask the store'));
  const tog = E('button', { class: 'ftt', 'aria-expanded': 'false' }, E('span', { class: 'ftti' }, icon('ship'), icon('tag'), icon('chat'), icon('globe')), E('span', { class: 'ftl' }, 'Delivery, returns and help'), E('i', { class: 'pl' }, '+'));
  const info = E('div', { class: 'ftinfo' }, perks, strip);
  const wrap = E('div', { class: 'ftwrap' }, tog, info, E('footer', null, E('div', { class: 'cols' },
    E('div', { class: 'col' }, E('span', { class: 'lbl' }, 'Connect with us'), ph ? E('a', { href: 'tel:+' + (ph.length === 10 ? '91' + ph : ph) }, 'Call') : null, ph ? E('a', { href: 'https://wa.me/' + (ph.length === 10 ? '91' + ph : ph), target: '_blank', rel: 'noopener' }, 'Text (WhatsApp)') : null, ext('Instagram', so.instagram), ext('Facebook', so.facebook), c.email ? E('a', { href: 'mailto:' + c.email }, 'Email') : null),
    E('div', { class: 'col' }, E('span', { class: 'lbl' }, 'Order support'), E('a', { href: link('me') }, 'My account & orders'), E('a', { href: link('orders') }, 'Track your order'), E('a', { href: link('policy/returns') }, 'Returns & exchanges'), E('a', { href: link('policy/shipping') }, 'Shipping policy'), E('a', { href: link('faq') }, 'FAQs'), E('a', { href: link('policy/terms') }, 'Terms'), E('a', { href: link('policy/privacy') }, 'Privacy')),
    E('div', { class: 'col' }, E('span', { class: 'lbl' }, 'We are ' + D.shop.name), E('a', { href: link('about') }, 'Our story'), E('a', { href: link('stores') }, 'Walk-in stores'), E('a', { href: link('collections') }, 'Collections'), blogsOn() ? E('a', { href: link('blog') }, 'Journal') : null, mediaOn() ? E('a', { href: link('media') }, 'Media & gallery') : null, jobsOn() ? E('a', { href: link('careers') }, 'Careers') : null, E('a', { href: link('contact') }, 'Contact')),
    E('div', { class: 'ftbrand' }, E('div', { class: 'big' }, D.shop.name))),
    E('div', { class: 'fin' }, E('span', null, '© ' + new Date().getFullYear() + ' ' + D.shop.name + '. All rights reserved'), E('a', { href: 'https://auzslab.in', target: '_blank', rel: 'noopener' }, 'Store by AUZslab'))))
  tog.onclick = () => { const on = wrap.classList.toggle('open'); tog.setAttribute('aria-expanded', String(on)); tog.querySelector('.pl').textContent = on ? '\u2013' : '+'; };
  return wrap;
}

// ---------- anonymous visitor analytics (no names, phones or addresses) ----------
const TR = (() => {
  let sid = ''; let ret = false; try { sid = localStorage.getItem('st.sid'); ret = !!localStorage.getItem('st.seen'); if (!sid) { sid = 'v' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36); localStorage.setItem('st.sid', sid); } localStorage.setItem('st.seen', '1'); } catch { sid = sid || 'v' + Math.random().toString(36).slice(2, 14); }
  const dev = innerWidth < 700 ? 'phone' : innerWidth < 1100 ? 'tablet' : 'desktop';
  let ref = ''; try { ref = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, '') : ''; if (ref === location.hostname) ref = ''; } catch {}
  const q = []; let page = '', t0 = 0, maxd = 0;
  const push = (k, p, d) => { q.push({ sid, k, p: p == null ? page : p, d: d || {}, dev, ref, ret }); if (q.length >= 25) flush(); };
  function flush() { if (!q.length) return; const ev = q.splice(0, 40); sb.rpc('public_sty_track', { p_slug: SLUG, p: { events: ev } }).then(() => {}, () => {}); }
  function depth() { const h = document.documentElement.scrollHeight - innerHeight; return h > 0 ? Math.min(100, Math.round(scrollY / h * 100)) : 100; }
  addEventListener('scroll', () => { const d = depth(); if (d > maxd) maxd = d; }, { passive: true });
  function leave() { if (page) { push('scroll', page, { max: maxd, s: Math.round((Date.now() - t0) / 1000) }); push('time', page, { s: Math.round((Date.now() - t0) / 1000) }); } }
  document.addEventListener('visibilitychange', () => { if (document.hidden) { leave(); page = page; t0 = Date.now(); maxd = depth(); flush(); } });
  addEventListener('pagehide', () => { leave(); flush(); });
  setInterval(flush, 12000);
  document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a,button'); if (!a) return; const w = a.classList.contains('gd') ? 'Get direction' : a.classList.contains('chat') || a.classList.contains('chatfab') ? 'WhatsApp chat' : /^tel:/.test(a.getAttribute('href') || '') ? 'Call' : a.classList.contains('hero') || (a.closest && a.closest('.hero')) ? 'Hero button' : ''; if (w) push('click', null, { what: w }); }, true);
  return { enter(p) { leave(); page = p; t0 = Date.now(); maxd = 0; push('view', p); }, push, flush };
})();

// ---------- router ----------
function route() {
  const raw = (location.hash || '').replace(/^#\/?/, '').split('?')[0]; const parts = raw.split('/').filter(Boolean).map(decodeURIComponent);
  const id = parts[0] || 'home'; const view = $('#view'); if (!view) return; clear(view);
  document.body.classList.toggle('homehero', id === 'home'); const fn = V[id] || V.home; try { const r = fn(view, parts[1]); if (r && r.catch) r.catch((e) => view.append(E('div', { class: 'empty' }, 'Something went wrong. ' + e.message))); } catch (e) { view.append(E('div', { class: 'empty' }, 'Something went wrong. ' + e.message)); }
  $('#menu') && $('#menu').classList.remove('on'); $('#srch') && $('#srch').classList.remove('on');
  document.title = (id === 'home' ? '' : cap(id === 'p' ? (BYID[parts[1]] || {}).name || 'Product' : id) + ' · ') + D.shop.name;
  if (id !== 'p') setMeta(document.title, cfg().tagline || ('Shop online at ' + D.shop.name), ((D.styles || [])[0] && photos((D.styles || [])[0])[0]) || '', location.origin + location.pathname);
  window.scrollTo(0, 0); document.body.classList.add('atop');
  TR.enter(id === 'p' ? 'p/' + (parts[1] || '') : id); if (id === 'p' && BYID[parts[1]]) TR.push('product', null, { id: parts[1], name: BYID[parts[1]].name });
  if (id === 'checkout') TR.push('checkout', null, { step: 'start' });
}
window.addEventListener('scroll', () => document.body.classList.toggle('atop', window.scrollY < 40), { passive: true });
function ingest(d) {
  shopIcon(d);
  D = d; STY = (D.styles || []).filter((x) => x.variants && x.variants.length); BYID = {}; VAR = {};
  STY.forEach((x) => { BYID[x.id] = x; x.variants.forEach((y) => { VAR[y.id] = { ...y, sid: x.id }; }); });
  bag = LS.get('bag', []).filter((b) => VAR[b.v]); wish = LS.get('wish', []).filter((id) => BYID[id]);
}
async function boot() {
  const app = $('#app');
  try { const p = new URLSearchParams(location.search).get('p'); if (p && !location.hash) { history.replaceState(null, '', location.pathname); location.hash = '#/p/' + p; } } catch (e) { /* plain link */ }
  if (!SLUG) { app.append(E('div', { class: 'spin' })); clear(app).append(E('div', { class: 'empty' }, E('h2', null, 'Open this store from the shop address'), E('div', { class: 'mut' }, 'For example yourshop.auzslab.in/store.html'))); return; }
  // instant first paint from the last visit; the fresh catalogue is fetched right behind it
  let cached = null; try { cached = JSON.parse(localStorage.getItem('st.cat.' + SLUG) || 'null'); } catch (e) { cached = null; }
  const fresh = rpc('public_sty_store', { p_slug: SLUG });
  const fail = (e) => { clear(app).append(E('div', { class: 'empty' }, E('h2', null, 'Could not open the store'), E('div', { class: 'mut' }, e.message))); };
  const closed = (d) => { clear(app).append(E('div', { class: 'empty' }, E('h1', null, d.name || 'Store'), E('div', { class: 'mut' }, 'Our online store is not open yet. Please check back soon.'))); document.title = d.name || 'Store'; };
  if (cached && cached.styles && !cached.closed) {
    ingest(cached); shell(); window.addEventListener('hashchange', route); route();
    fresh.then((d) => { if (!d || d.closed) return; try { localStorage.setItem('st.cat.' + SLUG, JSON.stringify(d)); } catch (e) { /* storage full */ }
      ingest(d); const h = (location.hash || '').replace(/^#\/?/, '').split('?')[0].split('/')[0]; if (!['checkout', 'order', 'orders', 'me'].includes(h) && !document.querySelector('.sheetwrap')) { const y = scrollY; route(); scrollTo(0, y); } }).catch(() => {});
    return;
  }
  app.append(E('div', { class: 'spin' }));
  let d; try { d = await fresh; } catch (e) { fail(e); return; }
  if (!d) { clear(app).append(E('div', { class: 'empty' }, E('h2', null, 'This store was not found'))); return; }
  if (d.closed) { closed(d); return; }
  try { localStorage.setItem('st.cat.' + SLUG, JSON.stringify(d)); } catch (e) { /* storage full */ }
  ingest(d); shell(); window.addEventListener('hashchange', route); route();
}
boot();
