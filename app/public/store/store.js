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
  chat: 'M5 6h14v9H10l-5 4V6Z', home: 'M4 11 12 4l8 7v9h-5v-6H9v6H4v-9Z', compass: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm3-12-2 5-5 2 2-5 5-2Z', filter: 'M4 7h10M18 7h2M4 17h2M10 17h10M14 5v4M6 15v4',
};
const icon = (n) => { const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); const p = document.createElementNS(NS, 'path'); p.setAttribute('d', IC[n] || ''); s.append(p); return s; };
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

// ---------- small ui ----------
function sheet(title, body, foot) {
  const w = E('div', { class: 'sheetwrap', role: 'dialog', 'aria-modal': 'true' });
  const close = () => w.remove();
  w.append(E('div', { class: 'bd', onclick: close }), E('div', { class: 'sheet' }, E('div', { class: 'grab' }), E('div', { class: 'hd' }, E('h2', null, title), E('button', { class: 'ic', 'aria-label': 'Close', onclick: close }, icon('x'))), body, foot || null));
  document.body.append(w); return { close };
}
function placeholder(name) { return E('div', { style: { height: '100%', display: 'grid', placeItems: 'center', color: '#c8c5c2', fontSize: '26px', fontWeight: 700, letterSpacing: '.04em' } }, (name || '?').trim().slice(0, 1).toUpperCase()); }

function card(s, opt) {
  opt = opt || {};
  const ims = photos(s), gone = isGone(s), on = wish.includes(s.id);
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
function toggleWish(id) { const i = wish.indexOf(id); if (i >= 0) wish.splice(i, 1); else wish.push(id); saveWish(); }
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
      E('a', { class: 'ic', href: link('wishlist'), 'aria-label': 'Saved' }, icon('mark'), countBadge(() => wish.length)), E('a', { class: 'ic', href: link('bag'), 'aria-label': 'Bag' }, icon('bag'), countBadge(bagCount)),
      E('button', { class: 'menu-pill deskonly', onclick: openMenu }, E('i'), 'Menu')));
  const c = cfg();
  const phoneNo = String(D.shop.phone || '').replace(/\D/g, '');
  const waUrl = phoneNo ? 'https://wa.me/' + (phoneNo.length === 10 ? '91' + phoneNo : phoneNo) : '';
  const dock = E('div', { class: 'dock phoneonly' },
    E('a', { class: 'mark', href: link(''), 'aria-label': 'Home' }, name.slice(0, 1).toUpperCase()),
    E('div', { class: 'pill' }, E('button', { 'aria-label': 'Explore', onclick: openMenu }, icon('compass')), E('button', { 'aria-label': 'Shop', onclick: () => go('shop') }, icon('home')),
      E('button', { 'aria-label': 'Saved', onclick: () => go('wishlist') }, icon('mark'), countBadge(() => wish.length)), E('button', { 'aria-label': 'Stores', onclick: () => go('stores') }, icon('pin')), E('button', { 'aria-label': 'Search', onclick: openSearch }, icon('search'))),
    waUrl ? E('a', { class: 'chat', href: waUrl, target: '_blank', rel: 'noopener', 'aria-label': 'Chat on WhatsApp' }, icon('chat')) : E('button', { class: 'chat', 'aria-label': 'Contact', onclick: () => go('contact') }, icon('chat')));
  const root = $('#app'); clear(root);
  root.append(c.announce ? E('div', { class: 'announce' }, c.announce) : null, top, E('main', { id: 'view' }), footer(), dock, waUrl ? E('a', { class: 'chatfab', href: waUrl, target: '_blank', rel: 'noopener', 'aria-label': 'Chat on WhatsApp' }, icon('chat')) : null,
    E('div', { class: 'menu', id: 'menu' }), E('div', { class: 'srch', id: 'srch' }));
}
function groups() {
  const cats = [...new Set(STY.map((s) => s.category).filter(Boolean))];
  const G = [['Top', /shirt|tee|polo|sweat|hood|jacket|top|kurta|blazer|coat|knit|vest/i], ['Bottom', /jean|pant|trouser|short|cargo|skirt|jogger|chino|denim|legging/i], ['Footwear', /shoe|sneaker|sandal|slipper|boot|loafer|footwear|heel/i], ['Accessories', /bag|cap|hat|belt|wallet|sock|scarf|watch|case|glass|jewel|tie/i]];
  const out = G.map(([n, re]) => [n, cats.filter((c) => re.test(c))]); const used = new Set(out.flatMap((x) => x[1]));
  const other = cats.filter((c) => !used.has(c)); if (other.length) out.push([out.some((x) => x[1].length) ? 'More' : 'Shop', other]);
  return out.filter((x) => x[1].length);
}
function openMenu() {
  const m = $('#menu'); clear(m); m.classList.add('on');
  const close = () => m.classList.remove('on');
  const fams = FAM.filter((f) => STY.some((s) => colours(s).some((c) => famOf(c) === f[0])));
  const nav = (p) => (e) => { e.preventDefault(); close(); location.hash = '#/' + p; };
  const a = (txt, p) => E('a', { href: link(p), onclick: nav(p) }, txt);
  const panel = E('div', { class: 'mp' }, E('button', { class: 'ic mx', 'aria-label': 'Close', onclick: close }, icon('x')),
    E('div', { class: 'cols' },
      E('div', { class: 'col nv' }, a('New arrivals', 'shop?new=1'), a('All products', 'shop'), ...D.collections.filter((c) => c.styleIds.length).slice(0, 4).map((c) => a(c.name, 'shop?col=' + c.id))),
      ...groups().map(([n, cs]) => E('div', { class: 'col' }, E('span', { class: 'lbl' }, n), E('div', { class: 'wrapc' }, cs.map((c) => a(c, 'shop?cat=' + encodeURIComponent(c)))))),
      fams.length ? E('div', { class: 'col' }, E('span', { class: 'lbl' }, 'Shop by colour'), E('div', { class: 'wrapc' }, fams.map((f) => E('a', { class: 'fam', href: link('shop?fam=' + f[0]), onclick: nav('shop?fam=' + f[0]) }, f[0], E('span', { class: 'bar', style: { background: 'linear-gradient(90deg,' + f[2][0] + ',' + f[2][1] + ')' } }))))) : null));
  m.append(panel);
  m.onclick = (e) => { if (e.target === m) close(); };
}
function openSearch() {
  const s = $('#srch'); clear(s); s.classList.add('on');
  const close = () => s.classList.remove('on');
  const res = E('div', { class: 'grid', style: { maxWidth: '1100px', margin: '0 auto' } });
  const inp = E('input', { placeholder: 'Search products, colours, collections', 'aria-label': 'Search', oninput: () => { const q = inp.value.trim().toLowerCase(); clear(res); if (q.length < 2) return; const hit = STY.filter((x) => [x.name, x.category, x.brand, x.collection, x.fabric, x.code, ...colours(x)].join(' ').toLowerCase().includes(q)).slice(0, 24); res.append(...(hit.length ? hit.map((x) => { const c = card(x); c.addEventListener('click', (e) => { if (e.target.closest('a')) close(); }); return c; }) : [E('div', { class: 'mut', style: { gridColumn: '1/-1', padding: '30px', textAlign: 'center' } }, 'Nothing found')])); } });
  s.append(E('div', { class: 'bar' }, inp, E('button', { class: 'ic', 'aria-label': 'Close', onclick: close }, icon('x'))), res); inp.focus();
}

// ---------- views ----------
const V = {};
function newest(n) { return [...STY].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, n); }
// slide stack: a deck of product cards that slides by itself; the centre card is full size, its neighbours peek out
function stack(list, label) {
  list = list.filter((s) => photos(s)[0]).slice(0, 14); if (list.length < 3) return null;
  const deck = E('div', { class: 'stk' }, list.map((s) => E('a', { class: 'sk', href: link('p/' + s.id) }, E('img', { src: photos(s)[0], alt: '', loading: 'lazy' }), E('div', { class: 'nm' }, E('span', null, s.name), E('b', null, inr(s.price))))));
  const items = [...deck.children]; let hold = false, holdT = 0;
  const near = () => { const mid = deck.scrollLeft + deck.clientWidth / 2; let bi = 0, bd = 1e9; items.forEach((el, i) => { const d = Math.abs(el.offsetLeft + el.offsetWidth / 2 - mid); if (d < bd) { bd = d; bi = i; } }); return bi; };
  const mark = () => { const n = near(); items.forEach((el, i) => el.classList.toggle('on', i === n)); };
  const go = (i) => { const el = items[i]; if (el) deck.scrollTo({ left: el.offsetLeft - (deck.clientWidth - el.offsetWidth) / 2, behavior: 'smooth' }); };
  deck.addEventListener('scroll', () => requestAnimationFrame(mark), { passive: true });
  const pause = () => { hold = true; clearTimeout(holdT); holdT = setTimeout(() => { hold = false; }, 5000); };
  ['pointerdown', 'touchstart', 'wheel', 'mouseenter'].forEach((ev) => deck.addEventListener(ev, pause, { passive: true }));
  deck.addEventListener('mouseleave', () => { clearTimeout(holdT); holdT = setTimeout(() => { hold = false; }, 1500); });
  setTimeout(mark, 60);
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) { const t = setInterval(() => { if (!document.body.contains(deck)) return clearInterval(t); if (hold || document.hidden) return; go((near() + 1) % items.length); }, 3200); }
  return E('section', { class: 'sec' }, E('div', { class: 'hd' }, E('span', { class: 'lbl' }, label)), deck);
}
function gridOf(list, withBlanks) {
  const g = E('div', { class: 'grid' });
  list.forEach((s, i) => { g.append(card(s)); if (withBlanks && (i + 1) % 7 === 0 && i + 1 < list.length) g.append(E('div', { class: 'blank' + (((i + 1) / 7) % 2 ? '' : ' ghost') + ' d', 'aria-hidden': 'true' })); });
  return g;
}
V.home = (v) => {
  const c = cfg(); const hi = (c.heroImages || []).filter(Boolean);
  const fallback = hi.length ? hi : newest(5).map((s) => photos(s)[0]).filter(Boolean);
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
  v.append(E('section', { class: 'sec' }, E('div', { class: 'hd' }, E('span', { class: 'lbl' }, 'Latest drop'), E('a', { class: 'btn sm out', href: link('shop?new=1') }, 'Discover more')), gridOf(newest(8), true)));
  // 2. category by category: a swipe row on desktop, a slide deck on phones
  [...new Set(STY.map((x) => x.category).filter(Boolean))].slice(0, 4).forEach((cat) => {
    const items = STY.filter((x) => x.category === cat).slice(0, 10); if (items.length < 2) return;
    const dk = phone ? stack(items, cat) : null;
    v.append(dk || E('section', { class: 'band' }, E('div', { class: 'hd' }, E('h2', null, cat), E('a', { class: 'btn sm', href: link('shop?cat=' + encodeURIComponent(cat)) }, 'Discover more')), E('div', { class: 'row' }, items.map((s) => card(s)))));
  });
  // 3. big collection pictures
  cols.slice(0, 3).forEach((x) => {
    const s0 = x.styleIds.map((id) => BYID[id]).find((s) => s && photos(s)[0]); if (!s0) return;
    v.append(E('a', { class: 'bigcol', href: link('shop?col=' + x.id) }, E('img', { src: photos(s0)[0], alt: '', loading: 'lazy' }), E('div', { class: 'cap' }, E('div', { class: 't' }, x.name), E('span', { class: 'btn' }, 'Shop now'))));
  });
  // 4. products again
  if (STY.length > 4) v.append(E('section', { class: 'sec' }, E('div', { class: 'hd' }, E('span', { class: 'lbl' }, 'All products'), E('a', { class: 'btn sm out', href: link('shop') }, 'Shop all')), gridOf(STY.slice(0, 12), true)));
  // 5. stores
  if ((c.stores || []).length) v.append(E('section', { class: 'sec' }, E('div', { class: 'hd' }, E('span', { class: 'lbl' }, 'Visit us'), E('a', { class: 'btn sm out', href: link('stores') }, 'All stores')), storeCards(c.stores.slice(0, 2))));
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
function refine() {
  const base = q$(); const draft = { ...base };
  const prices = STY.map((s) => s.price); const lo = Math.floor(Math.min(...prices, 0)), hi = Math.ceil(Math.max(...prices, 1));
  const body = E('div'); const showBtn = E('button', { class: 'btn wide' }, 'Show'); const live = () => { const n = filterSet(draft).length; showBtn.textContent = 'Show ' + n + (n === 1 ? ' piece' : ' pieces'); };
  const allSizes = [...new Set(STY.flatMap(sizesOf))]; const allCols = [...new Set(STY.flatMap(colours))]; const cats = [...new Set(STY.map((s) => s.category).filter(Boolean))];
  const paint = () => {
    clear(body);
    const pick = (key, val) => { draft[key] = draft[key] === val ? '' : val; paint(); };
    body.append(
      E('div', { class: 'fgrp' }, E('span', { class: 'lbl' }, 'Sort'), E('div', { class: 'fwrap' }, [['new', 'Newest'], ['low', 'Price low'], ['high', 'Price high'], ['az', 'A to Z']].map(([k, l]) => E('button', { class: 'sz' + ((draft.sort || 'new') === k ? ' on' : ''), onclick: () => { draft.sort = k; paint(); } }, l)))),
      cats.length > 1 ? E('div', { class: 'fgrp' }, E('span', { class: 'lbl' }, 'Type'), E('div', { class: 'fwrap' }, cats.map((c) => E('button', { class: 'sz' + (draft.cat === c ? ' on' : ''), onclick: () => pick('cat', c) }, c)))) : null,
      allSizes.length ? E('div', { class: 'fgrp' }, E('span', { class: 'lbl' }, 'Size'), E('div', { class: 'fwrap' }, allSizes.map((z) => E('button', { class: 'sz' + (draft.size === z ? ' on' : ''), onclick: () => pick('size', z) }, z)))) : null,
      allCols.length ? E('div', { class: 'fgrp' }, E('span', { class: 'lbl' }, 'Colour'), E('div', { class: 'dots2' }, allCols.map((c) => E('button', { class: draft.colour === c ? 'on' : '', onclick: () => pick('colour', c) }, E('span', { class: 'c', style: { background: hex(c) } }), c)))) : null,
      E('div', { class: 'fgrp' }, E('span', { class: 'lbl' }, 'Budget'), (() => { const mn = E('input', { type: 'range', min: lo, max: hi, value: draft.min || lo, step: 100 }), mx = E('input', { type: 'range', min: lo, max: hi, value: draft.max || hi, step: 100 }); const rv = E('div', { class: 'rv' }); const up = () => { if (+mn.value > +mx.value) mn.value = mx.value; draft.min = +mn.value > lo ? mn.value : ''; draft.max = +mx.value < hi ? mx.value : ''; rv.textContent = ''; add(rv, [E('span', null, inr(mn.value)), E('span', null, inr(mx.value))]); live(); }; mn.oninput = up; mx.oninput = up; up(); return E('div', { class: 'range' }, rv, mn, mx); })()),
      E('button', { class: 'tgl' + (draft.stock ? ' on' : ''), style: { width: '100%' }, onclick: () => { draft.stock = draft.stock ? '' : '1'; paint(); } }, E('span', null, 'Only what is in stock'), E('i')));
    live();
  };
  paint();
  const foot = E('div', { class: 'row2', style: { marginTop: '8px' } }, E('button', { class: 'btn out', onclick: () => { sh.close(); location.hash = '#/shop'; } }, 'Clear all'), showBtn);
  const sh = sheet('Refine', body, foot);
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
    E('div', { class: 'shophd' }, E('div', null, E('h1', null, title), E('div', { class: 'mut tiny' }, list.length + (list.length === 1 ? ' piece' : ' pieces'))), E('button', { class: 'btn soft', onclick: refine }, icon('filter'), 'Refine')),
    act.length ? E('div', { class: 'chips' }, act.map(([k, l]) => E('button', { class: 'chip on', onclick: () => setQ({ [k]: '' }) }, l, E('span', { class: 'x' }, '×')))) : null,
    !act.length && [...new Set(STY.map((s) => s.category))].length > 1 ? E('div', { class: 'chips' }, [...new Set(STY.map((s) => s.category).filter(Boolean))].map((c) => E('button', { class: 'chip', onclick: () => setQ({ cat: c }) }, c))) : null,
    (q.cat || list.length === STY.length) ? stack(list, q.cat ? q.cat : 'All products') : null,
    list.length ? pagedGrid(list) : E('div', { class: 'empty' }, E('h2', null, 'Nothing matches'), E('div', { class: 'mut' }, 'Try removing a filter.'), E('a', { class: 'btn', href: link('shop') }, 'Clear filters')));
};
V.collections = (v) => {
  const cols = D.collections.filter((x) => x.styleIds.some((id) => BYID[id]));
  v.append(E('div', { class: 'shophd' }, E('h1', null, 'Collections')), cols.length ? E('div', { class: 'deck', style: { flexWrap: 'wrap', overflow: 'visible' } }, cols.map((x) => { const s0 = x.styleIds.map((id) => BYID[id]).find((s) => s && photos(s)[0]); return E('a', { class: 'dk' + (s0 ? '' : ' ph'), href: link('shop?col=' + x.id) }, s0 ? E('img', { src: photos(s0)[0], alt: '', loading: 'lazy' }) : null, E('div', { class: 'nm' }, x.name)); })) : E('div', { class: 'empty' }, E('div', { class: 'mut' }, 'No collections yet.'), E('a', { class: 'btn', href: link('shop') }, 'Shop all')));
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
    const main = E('div', { class: 'main' }, E('img', { src: ims[cur] || ims[0], alt: s.name }), E('div', { class: 'ct' }, (cur + 1) + ' / ' + ims.length));
    const rail = E('div', { class: 'rail' }, ims.map((u, i) => E('button', { class: 'th' + (i === cur ? ' on' : ''), 'aria-label': 'Picture ' + (i + 1), onclick: () => { cur = i; paintGal(); } }, E('img', { src: u, alt: '', loading: 'lazy' }))));
    gal.append(main, ims.length > 1 ? rail : null);
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
  function sizeGuide() { sheet('Size guide', E('div', { class: 'dtl' }, E('div', null, 'Measure a piece that fits you well and compare it with the chest or waist size of the garment. If you are between sizes, choose the larger one for a relaxed fit.'), E('div', { class: 'mut' }, 'Need help choosing? Message the store and we will help.'))); }
  function share() { const u = location.href; if (navigator.share) navigator.share({ title: s.name, url: u }).catch(() => {}); else { try { navigator.clipboard.writeText(u); toast('Link copied'); } catch (e) { toast(u); } } }
  function notify() { const ph = String(D.shop.phone || '').replace(/\D/g, ''); if (!ph) { go('contact'); return; } window.open('https://wa.me/' + (ph.length === 10 ? '91' + ph : ph) + '?text=' + encodeURIComponent('Hi, please tell me when ' + s.name + ' is back in stock. ' + location.href), '_blank', 'noopener'); }
  paintGal(); paintInfo();
  try { document.querySelectorAll('script[data-ld]').forEach((x) => x.remove()); const ld = document.createElement('script'); ld.type = 'application/ld+json'; ld.dataset.ld = '1'; ld.textContent = JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name: s.name, image: photos(s).slice(0, 4), description: s.description || s.name, brand: s.brand ? { '@type': 'Brand', name: s.brand } : undefined, sku: s.code || undefined, offers: { '@type': 'Offer', priceCurrency: 'INR', price: s.price, availability: isGone(s) ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock' } }); document.head.append(ld); } catch (e) { /* no JSON-LD */ }
  let more = STY.filter((x) => x.id !== s.id && (x.category === s.category || (s.collection && x.collection === s.collection))).slice(0, 8);
  if (more.length < 4) { const have = new Set(more.map((x) => x.id)); more = more.concat(newest(STY.length).filter((x) => x.id !== s.id && !have.has(x.id))).slice(0, Math.max(4, more.length)); } // always suggest at least 4 (2 when the shop has fewer)
  v.append(E('div', { class: 'crumbs' }, E('a', { href: link('') }, 'Home'), ' / ', E('a', { href: link('shop?cat=' + encodeURIComponent(s.category)) }, s.category), ' / ', s.name), E('div', { class: 'pd' }, gal, info),
    more.length ? E('section', { class: 'band' }, E('div', { class: 'hd' }, E('h2', null, 'Products you may like'), E('a', { class: 'btn sm', href: link('shop?cat=' + encodeURIComponent(s.category)) }, 'Discover more')), E('div', { class: 'row' }, more.map((x) => card(x)))) : null, recentBand(s.id));
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
  const f = (key, label, o) => { o = o || {}; const el = o.select ? E('select', { 'aria-label': label }, o.select.map((x) => E('option', { value: x, selected: (saved[key] || o.def) === x }, x))) : o.area ? E('textarea', { placeholder: label, 'aria-label': label }) : E('input', { placeholder: label + (o.opt ? ' (optional)' : ''), 'aria-label': label, type: o.type || 'text', autocomplete: o.ac || 'on', inputmode: o.mode, value: saved[key] || '' }); F[key] = el; return E('label', { class: 'fld' }, el); };
  const methods = []; if (D.upi) methods.push(['upi', 'Pay by UPI', 'Scan a QR with any UPI app after you place the order']); if (D.cod) methods.push(['cod', 'Cash on delivery', 'Pay when the order reaches you']);
  let pay = methods[0] ? methods[0][0] : '';
  const payBox = E('div', { class: 'frm' }); const payPaint = () => { clear(payBox); if (!methods.length) { payBox.append(E('div', { class: 'note' }, 'This store is not taking online orders right now. Please contact the store.')); return; } methods.forEach(([k, l, d]) => payBox.append(E('div', { class: 'opt' + (pay === k ? ' on' : ''), role: 'radio', 'aria-checked': pay === k, tabindex: 0, onclick: () => { pay = k; payPaint(); } }, E('i', { class: 'r' }), E('div', null, E('div', null, l), E('div', { class: 'mut tiny' }, d))))); };
  payPaint();
  const t = bagTotal(), sh = shipFee(t); const save = E('input', { type: 'checkbox', checked: !!saved.name });
  const err = E('div', { class: 'tiny', role: 'alert', style: { color: '#c0392b', minHeight: '14px' } });
  const btn = E('button', { class: 'btn wide' }, 'Place order');
  btn.onclick = async () => {
    const g = (k) => (F[k].value || '').trim(); err.textContent = '';
    const name = [g('first'), g('last')].filter(Boolean).join(' ');
    const miss = !g('first') ? 'your first name' : !g('phone') ? 'your phone number' : !g('address') ? 'your address' : !g('city') ? 'your city' : !g('pin') ? 'your PIN code' : '';
    if (miss) { err.textContent = 'Please enter ' + miss + '.'; return; }
    if (!pay) { err.textContent = 'Choose how you want to pay.'; return; }
    btn.disabled = true; btn.textContent = 'Placing…';
    try {
      const r = await rpc('public_sty_place_order', { p_slug: SLUG, p: { name, email: g('email'), phone: g('phone'), address: g('address'), address2: g('address2'), city: g('city'), state: g('state'), pin: g('pin'), country: g('country'), note: g('note'), payment: pay, lines: bagLines().map((l) => ({ variantId: l.v, qty: l.q })) } });
      if (save.checked) LS.set('me', { first: g('first'), last: g('last'), email: g('email'), phone: g('phone'), address: g('address'), address2: g('address2'), city: g('city'), state: g('state'), pin: g('pin'), country: g('country'), name: 1 }); else LS.set('me', {});
      const mine = LS.get('orders', []); mine.unshift({ token: r.token, number: r.number }); LS.set('orders', mine.slice(0, 20));
      bag = []; saveBag(); go('order/' + r.token);
    } catch (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = 'Place order'; }
  };
  v.append(E('div', { class: 'shophd' }, E('h1', null, 'Checkout')), E('div', { class: 'two' },
    E('div', { class: 'card frm' }, E('h2', null, 'Contact'), f('email', 'Email', { type: 'email', ac: 'email', opt: true }), f('phone', 'Phone', { type: 'tel', ac: 'tel', mode: 'tel' }),
      E('h2', null, 'Delivery'), f('country', 'Country', { select: ['India'], def: 'India' }), E('div', { class: 'f2' }, f('first', 'First name', { ac: 'given-name' }), f('last', 'Last name', { ac: 'family-name', opt: true })), f('address', 'Address', { ac: 'street-address' }), f('address2', 'Apartment, suite, etc.', { opt: true }),
      E('div', { class: 'f2' }, f('city', 'City'), f('state', 'State', { select: STATES, def: 'Rajasthan' })), f('pin', 'PIN code', { mode: 'numeric', ac: 'postal-code' }), f('note', 'Notes for the store (optional)', { area: true }),
      E('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, save, 'Save this information for next time'),
      E('h2', null, 'Shipping method'), E('div', { class: 'note' }, shipLine(t)), E('h2', null, 'Payment'), E('div', { class: 'mut tiny' }, 'All transactions are secure.'), payBox),
    E('div', { class: 'card stick sum' }, E('h2', { style: { marginBottom: '6px' } }, 'Order summary'), ls.map((l) => E('div', { class: 't' }, E('span', null, l.s.name + ' × ' + l.q + (l.vr.size ? ' · ' + l.vr.size : '')), E('span', null, inr(l.vr.price * l.q)))),
      E('div', { class: 't', style: { paddingTop: '8px', borderTop: '1px solid var(--line)' } }, E('span', null, 'Subtotal'), E('span', null, inr(t))), E('div', { class: 't' }, E('span', null, 'Shipping'), E('span', null, sh ? inr(sh) : 'Free')), E('div', { class: 't g' }, E('span', null, 'Total'), E('span', null, inr(t + sh))), err, btn,
      E('div', { class: 'mut tiny' }, 'By placing the order you agree to the ', E('a', { href: link('policy/terms'), style: { textDecoration: 'underline' } }, 'terms'), ' and the ', E('a', { href: link('policy/returns'), style: { textDecoration: 'underline' } }, 'returns policy'), '.'))));
};

V.order = async (v, tok) => {
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
    o.status === 'cancelled' ? null : E('div', { class: 'steps' }, steps.map((_, i) => E('i', { class: i <= at ? 'on' : '' }))), o.status === 'cancelled' ? null : E('div', { class: 'lbl' }, cap(o.status)),
    E('div', { style: { marginTop: '12px' } }, (o.lines || []).map((l) => E('div', { class: 'ln' }, E('div', { class: 'im' }, l.photo ? E('img', { src: l.photo, alt: '' }) : placeholder(l.name)), E('div', null, E('div', { class: 't' }, l.name), E('div', { class: 's' }, [l.colour, l.size].filter(Boolean).join(' · ') + ' × ' + l.qty)), E('div', null, inr(l.price * l.qty))))),
    E('div', { class: 'sum', style: { marginTop: '10px' } }, E('div', { class: 't' }, E('span', null, 'Shipping'), E('span', null, o.shipping ? inr(o.shipping) : 'Free')), E('div', { class: 't g' }, E('span', null, 'Total'), E('span', null, inr(o.total)))),
    E('div', { class: 'mut tiny', style: { marginTop: '10px' } }, 'Save this page to follow your order. Questions? ', E('a', { href: link('contact'), style: { textDecoration: 'underline' } }, 'Contact us'))), pbox, E('a', { class: 'btn out', href: link('shop'), style: { justifySelf: 'center' } }, 'Keep shopping')));
};

function mapUrl(st) { return st.mapUrl || 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([st.name, st.address].filter(Boolean).join(' ')); }
function storeList() { const st = (cfg().stores || []).filter((x) => x && (x.name || x.address)); if (st.length) return st; return D.shop.address ? [{ name: D.shop.name, address: D.shop.address, phone: D.shop.phone }] : []; }
function storeCards(list) {
  return E('div', { class: 'scards' }, list.map((st) => E('div', { class: 'scard' }, st.photo ? E('div', { class: 'im' }, E('img', { src: st.photo, alt: st.name || '', loading: 'lazy' })) : null,
    E('div', { class: 'b' }, E('div', { class: 'inf' }, E('h3', null, st.name || 'Store'), E('div', { class: 'mut' }, st.address), st.hours ? E('div', { class: 'mut' }, st.hours) : null), E('div', { class: 'acts' }, E('a', { class: 'btn sm', href: mapUrl(st), target: '_blank', rel: 'noopener' }, 'Get direction'), st.phone ? E('a', { class: 'btn sm out', href: 'tel:' + String(st.phone).replace(/[^\d+]/g, '') }, st.phone) : null)))));
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
V.orders = async (v) => {
  const mine = LS.get('orders', []); v.append(E('div', { class: 'pg' }, E('div', { class: 'shophd' }, E('h1', null, 'My orders'))));
  const box = E('div', { class: 'pg' }); v.append(box);
  if (!mine.length) { box.append(E('div', { class: 'card mut' }, 'Orders you place on this phone show here. ', E('a', { href: link('shop'), style: { textDecoration: 'underline' } }, 'Shop now'))); return; }
  box.append(E('div', { class: 'spin' }));
  const rows = await Promise.all(mine.map((m) => rpc('public_sty_order', { p_token: m.token }).catch(() => null)));
  clear(box); rows.forEach((o, i) => { if (o) box.append(E('a', { class: 'card', href: link('order/' + mine[i].token), style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } }, E('div', null, E('div', null, o.number), E('div', { class: 'mut tiny' }, cap(o.status) + ' · ' + new Date(o.createdAt).toLocaleDateString('en-GB'))), E('div', null, inr(o.total)))); });
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
  return E('div', { class: 'ftwrap' }, strip, E('footer', null, E('div', { class: 'cols' },
    E('div', { class: 'col' }, E('span', { class: 'lbl' }, 'Connect with us'), ph ? E('a', { href: 'tel:+' + (ph.length === 10 ? '91' + ph : ph) }, 'Call') : null, ph ? E('a', { href: 'https://wa.me/' + (ph.length === 10 ? '91' + ph : ph), target: '_blank', rel: 'noopener' }, 'Text (WhatsApp)') : null, ext('Instagram', so.instagram), ext('Facebook', so.facebook), c.email ? E('a', { href: 'mailto:' + c.email }, 'Email') : null),
    E('div', { class: 'col' }, E('span', { class: 'lbl' }, 'Order support'), E('a', { href: link('orders') }, 'Track your order'), E('a', { href: link('policy/returns') }, 'Returns & exchanges'), E('a', { href: link('policy/shipping') }, 'Shipping policy'), E('a', { href: link('faq') }, 'FAQs'), E('a', { href: link('policy/terms') }, 'Terms'), E('a', { href: link('policy/privacy') }, 'Privacy')),
    E('div', { class: 'col' }, E('span', { class: 'lbl' }, 'We are ' + D.shop.name), E('a', { href: link('about') }, 'Our story'), E('a', { href: link('stores') }, 'Walk-in stores'), E('a', { href: link('collections') }, 'Collections'), E('a', { href: link('contact') }, 'Contact')),
    E('div', { class: 'ftbrand' }, E('div', { class: 'big' }, D.shop.name))),
    E('div', { class: 'fin' }, E('span', null, '© ' + new Date().getFullYear() + ' ' + D.shop.name + '. All rights reserved'), E('a', { href: 'https://auzslab.in', target: '_blank', rel: 'noopener' }, 'Store by AUZslab'))));
}

// ---------- router ----------
function route() {
  const raw = (location.hash || '').replace(/^#\/?/, '').split('?')[0]; const parts = raw.split('/').filter(Boolean).map(decodeURIComponent);
  const id = parts[0] || 'home'; const view = $('#view'); if (!view) return; clear(view);
  document.body.classList.toggle('homehero', id === 'home'); const fn = V[id] || V.home; try { const r = fn(view, parts[1]); if (r && r.catch) r.catch((e) => view.append(E('div', { class: 'empty' }, 'Something went wrong. ' + e.message))); } catch (e) { view.append(E('div', { class: 'empty' }, 'Something went wrong. ' + e.message)); }
  $('#menu') && $('#menu').classList.remove('on'); $('#srch') && $('#srch').classList.remove('on');
  document.title = (id === 'home' ? '' : cap(id === 'p' ? (BYID[parts[1]] || {}).name || 'Product' : id) + ' · ') + D.shop.name;
  window.scrollTo(0, 0); document.body.classList.add('atop');
}
window.addEventListener('scroll', () => document.body.classList.toggle('atop', window.scrollY < 40), { passive: true });
async function boot() {
  const app = $('#app'); app.append(E('div', { class: 'spin' }));
  if (!SLUG) { clear(app).append(E('div', { class: 'empty' }, E('h2', null, 'Open this store from the shop address'), E('div', { class: 'mut' }, 'For example yourshop.auzslab.in/store.html'))); return; }
  try { D = await rpc('public_sty_store', { p_slug: SLUG }); } catch (e) { clear(app).append(E('div', { class: 'empty' }, E('h2', null, 'Could not open the store'), E('div', { class: 'mut' }, e.message))); return; }
  if (!D) { clear(app).append(E('div', { class: 'empty' }, E('h2', null, 'This store was not found'))); return; }
  if (D.closed) { clear(app).append(E('div', { class: 'empty' }, E('h1', null, D.name || 'Store'), E('div', { class: 'mut' }, 'Our online store is not open yet. Please check back soon.'))); document.title = D.name || 'Store'; return; }
  STY = (D.styles || []).filter((s) => s.variants && s.variants.length); BYID = {}; VAR = {};
  STY.forEach((s) => { BYID[s.id] = s; s.variants.forEach((x) => { VAR[x.id] = { ...x, sid: s.id }; }); });
  bag = LS.get('bag', []).filter((b) => VAR[b.v]); wish = LS.get('wish', []).filter((id) => BYID[id]);
  shell(); window.addEventListener('hashchange', route); route();
}
boot();
