/* AUZsStyle online store (customer-facing, no login). Plain script, no build. Everything is drawn with textContent / createElement
   (never innerHTML). Data comes from public_sty_store; orders go through public_sty_place_order. */
'use strict';
const DEMO = new URLSearchParams(location.search).get('demo');   // theme preview template (auzslab.in): fixed demo catalogue, no orders
const SLUG = new URLSearchParams(location.search).get('shop') || window.TENANT_SLUG || (DEMO ? 'theme-preview' : '');
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
  dense: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z', big: 'M4 5h16v14H4z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Zm9 3-4.2-4.2', x: 'M6 6l12 12M18 6 6 18', plus: 'M12 5v14M5 12h14', left: 'M15 6l-6 6 6 6', right: 'M9 6l6 6-6 6',
  bell: 'M18 8a6 6 0 0 0-12 0c0 6-3 7-3 9h18c0-2-3-3-3-9m-8 12a2 2 0 0 0 4 0',
  arrow: 'M7 17L17 7M9 7h8v8',
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
// a picture that failed to load (flaky network, phone memory) is asked for once more before giving up
// small copy of an uploaded picture for cards (see server storage.js makeThumbs); older pictures without one fall back to the original
const thumb = (u, w) => (u && /\/uploads\/site\//.test(u) ? u.replace(/\.(jpe?g|png|webp)$/i, '.w' + (w || 480) + '.webp') : u);
// thumb() assumes a resized variant always exists at the rewritten path. That holds for product photos (always
// run through the resize pipeline) but not for every uploaded image -- e.g. older collection cover images --
// so any <img> built from a URL that is not guaranteed to have a resized variant should go through thumbImg()
// instead of calling thumb() directly: it points src at the resized URL but also sets data-orig to the real
// original, which the document-level 'error' listener below already falls back to once if the resized request
// 404s (the listener's own im.src !== im.dataset.orig check stops it from looping if the original also fails).
// Returns an HTML attribute string, e.g. `src="..." data-orig="..."`, for inline use in a template literal.
// NOTE for a theme that draws in its own shadow root (any bespoke-chrome theme): an <img> 'error' event is
// NOT composed, so it never reaches this file's document-level listener from inside a shadow tree -- that
// theme must register the same fallback on its OWN root (see kaarigari.js's mount() for the one-line pattern).
const escAttr = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function thumbImg(u, w) {
  const orig = u || '';
  const resized = thumb(orig, w);
  return resized !== orig ? `src="${escAttr(resized)}" data-orig="${escAttr(orig)}"` : `src="${escAttr(orig)}"`;
}
document.addEventListener('error', (e) => { const im = e.target; if (im && im.tagName === 'IMG' && im.dataset.orig && im.src !== im.dataset.orig) { im.src = im.dataset.orig; return; } if (!im || im.tagName !== 'IMG' || im.dataset.retry || !im.src || im.src.startsWith('data:')) return; im.dataset.retry = '1'; const u = im.src; im.removeAttribute('loading'); setTimeout(() => { im.src = u + (u.includes('?') ? '&' : '?') + 'r=1'; }, 600); }, true);
let D = null;            // public_sty_store (or public_sfx_store) result
// Which product's public RPCs this store talks to: 'sty' (AUZsStyle) or 'sfx' (the AUZslab storefront
// platform, db/372). Resolved once at boot() from whichever one actually has this tenant (see boot()'s
// resolveStore()) -- a tenant only ever has one of the two enabled, so this never needs to change mid-session.
let PFX = 'sty';
// THE theme registry (db/468, public_sfx_theme_registry()): every built-in theme, section-based (Minimal,
// Classic, Salon, Kiln, Kiln (Salon)) or bespoke-chrome (fully custom-coded JS/CSS templates such as
// Studs/Kaarigari, bypassing the shared section renderer entirely), keyed by slug, with its kind, its dispatch
// "template" value (what ends up in cfg().template -- a bespoke theme's own slug, or a section-based theme's
// generic base chrome) and its declared capabilities. This is the ONE place this file reads that list from --
// every other spot below reads THEME_REGISTRY / BESPOKE / BESPOKE_CAPS instead of its own hardcoded
// ['studs', 'kaarigari'] (or ['minimal', 'studs', 'kaarigari']) literal, so a new theme of EITHER kind
// (db/468's row +, for a bespoke one, its own /store/<slug>.js chrome file) lights up everywhere in this file
// with zero further edits here. See docs/STOREFRONT_THEME_CONTRACT.md. Seeded with today's known themes so the
// very first paint before the registry fetch below resolves still behaves correctly; loadThemeRegistry()
// replaces it with the authoritative server list as soon as it returns.
let THEME_REGISTRY = new Map([
  ['minimal', { slug: 'minimal', kind: 'section', template: 'minimal', isBespoke: false, capabilities: {} }],
  ['classic', { slug: 'classic', kind: 'section', template: 'classic', isBespoke: false, capabilities: {} }],
  ['salon', { slug: 'salon', kind: 'section', template: 'classic', isBespoke: false, capabilities: {} }],
  ['kiln', { slug: 'kiln', kind: 'section', template: 'minimal', isBespoke: false, capabilities: {} }],
  ['kiln-salon', { slug: 'kiln-salon', kind: 'section', template: 'minimal', isBespoke: false, capabilities: {} }],
  ['studs', { slug: 'studs', kind: 'bespoke', template: 'studs', isBespoke: true, capabilities: { checkoutOwnership: 'header_footer', formsStylesheet: '/store/studs-forms.css?v=1' } }],
  // Kaarigari is the documented, reviewed exception to the header/footer-only baseline (docs/STOREFRONT_THEME_CONTRACT.md):
  // its approved handoff explicitly specified its own checkout layout, so it owns and draws checkout itself.
  ['kaarigari', { slug: 'kaarigari', kind: 'bespoke', template: 'kaarigari', isBespoke: true, capabilities: { checkoutOwnership: 'full' } }],
]);
let BESPOKE = new Set([...THEME_REGISTRY.values()].filter((t) => t.isBespoke).map((t) => t.slug));
let BESPOKE_CAPS = Object.fromEntries([...THEME_REGISTRY.values()].filter((t) => t.isBespoke).map((t) => [t.slug, t.capabilities]));
async function loadThemeRegistry() {
  try {
    const list = await rpc('public_sfx_theme_registry');
    if (Array.isArray(list) && list.length) {
      THEME_REGISTRY = new Map(list.map((t) => [t.slug, { slug: t.slug, kind: t.kind, template: t.template, isBespoke: !!t.isBespoke, capabilities: t.capabilities || {} }]));
      BESPOKE = new Set([...THEME_REGISTRY.values()].filter((t) => t.isBespoke).map((t) => t.slug));
      BESPOKE_CAPS = Object.fromEntries([...THEME_REGISTRY.values()].filter((t) => t.isBespoke).map((t) => [t.slug, t.capabilities]));
    }
  } catch (e) { /* keep the seeded default above -- the storefront must never break because this fetch failed */ }
}
// Looks up any requested theme SLUG (e.g. a marketplace slug like 'salon', not necessarily a dispatch
// template) in the registry and returns the template it actually resolves to, or '' when the slug is not a
// real, known theme at all. Used by demo.js so an unrecognized or stale id is an explicit, documented
// fallback, never a silent substitution of a different real theme's slug.
const templateFor = (slug) => { const t = THEME_REGISTRY.get(slug); return t ? t.template : ''; };
// A bespoke theme's chrome script follows one fixed naming convention: /store/<slug>.js exposing
// window.<Slug>Theme (Studs -> studs.js / window.StudsTheme, Kaarigari -> kaarigari.js / window.KaarigariTheme).
// Adding a new bespoke theme never needs a new branch here: ship the file under that convention and it loads.
// A theme may declare an extra stylesheet for the shared (non-shadow-DOM) checkout/account pages it frames --
// see capabilities.formsStylesheet in the registry -- instead of this file hardcoding which slug needs one.
const themeGlobal = (slug) => slug.charAt(0).toUpperCase() + slug.slice(1) + 'Theme';
function loadBespokeChrome(slug) {
  const g = themeGlobal(slug);
  if (window[g]) return window[g].ready();
  return new Promise((resolve) => {
    const css = (BESPOKE_CAPS[slug] || {}).formsStylesheet;
    if (css) { const lk = document.createElement('link'); lk.rel = 'stylesheet'; lk.href = css; document.head.append(lk); }
    // Bump this version whenever ANY bespoke theme's own .js file changes. A browser that already loaded a
    // bespoke theme once caches this exact URL -- the same stale-cache bug class as theme-previews/*.jpg
    // (see CLAUDE.md) -- so without bumping this, an edit to studs.js/kaarigari.js/outpace.js is invisible to
    // anyone who has already visited that theme, no matter how many times the server file is redeployed.
    const sc = document.createElement('script'); sc.src = '/store/' + slug + '.js?v=3';
    sc.onload = () => resolve(window[g] ? window[g].ready() : null); sc.onerror = () => resolve(null);
    document.head.append(sc);
  });
}
let STY = [], BYID = {}, VAR = {};
let bag = [], wish = [];
const toast = (m) => { const t = E('div', { class: 'toast', role: 'status' }, m); document.body.append(t); setTimeout(() => t.remove(), 2200); };
async function rpc(fn, args) {
  if (DEMO) {
    if (fn === 'public_sty_store') {
      // the preview shows the real AUZsStyle demo account (its products, collections, stores and photos); built-in sample data only if that cannot be read
      // Resolve the requested ?demo= id (any real theme slug, e.g. 'minimal', 'studs' or 'salon') against the
      // single theme registry to the template it actually dispatches to -- never demo.js's own hardcoded list.
      // An id that is not a real, known theme at all falls back to the default template explicitly ('1'),
      // which is never a silent stand-in for a DIFFERENT real theme.
      const tpl = templateFor(DEMO) || '1';
      // Minimal previously read a one-time frozen snapshot of the demo account (db/472) instead of the
      // live account every other theme's demo uses -- the owner's actual, repeatedly-confirmed ask is
      // simpler than that: Minimal should show exactly what Classic already correctly shows (the real,
      // live demo account's hero image, products and collections), not a separately-maintained copy that
      // can drift out of sync with it. Minimal now takes the identical live-data path as every other theme.
      try {
        const r = await sb.rpc('public_sty_store', { p_slug: 'demo' });
        if (r && r.data) {
          // The demo account itself being switched to "closed" (Online store > Open the online store, off) is a real,
          // deliberate state, not a fetch failure -- show that plainly instead of silently swapping in the built-in
          // sample catalogue, which used to make a closed demo account look like a real (if odd) live product.
          if (r.data.closed) return { closed: true, name: r.data.name || 'Live demo' };
          if (r.data.styles && r.data.styles.length) return window.StoreDemo.live(r.data, tpl);
        }
        // public_sty_store returns plain NULL (not {closed:true}) once a tenant has moved onto the newer
        // sfx_* storefront platform (see sfx_storefront_on() in the DB) -- a real, deliberate "ask the other
        // table instead" signal, not a fetch failure, but indistinguishable from one by the catch block
        // below. The demo account moved onto sfx_* while this file still only ever asked the old table, so
        // every non-Minimal demo (Classic/Studs/Kaarigari) silently fell back to the fake sample catalogue
        // even while the real demo account was open and fully stocked. Ask the new table before giving up.
        const sfx = await sb.rpc('public_sfx_store', { p_slug: 'demo' });
        if (sfx && sfx.data && sfx.data.styles && sfx.data.styles.length) return window.StoreDemo.live(sfx.data, tpl);
      } catch (e) { /* genuine fetch failure: fall back to the sample catalogue below so the template can still be previewed */ }
      return window.StoreDemo.build(tpl);
    } if (/_(track|notify_me|cart_save|reviews|coupon_check)$/.test(fn)) return null; throw new Error('This is a preview template. Ordering is switched off.'); }
  const { data, error } = await sb.rpc(fn, args || {}); if (error) { const e = new Error(error.message || 'Something went wrong'); e.status = error.status; throw e; } return data; }
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
// Description formatting made by the owner: **bold**, *italic*, "- " lists, [text](https://link). Built as DOM nodes, never as HTML.
const richNodes = (t) => {
  const inl = (x) => { const out = []; const re = /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)/g; let i = 0, m; while ((m = re.exec(x))) { if (m.index > i) out.push(x.slice(i, m.index)); out.push(m[1] ? E('strong', null, m[1]) : m[2] ? E('em', null, m[2]) : E('a', { href: m[4], target: '_blank', rel: 'noopener noreferrer', style: { textDecoration: 'underline' } }, m[3])); i = re.lastIndex; } if (i < x.length) out.push(x.slice(i)); return out; };
  return String(t || '').trim().split(/\n{2,}/).filter(Boolean).map((b) => { const ls = b.split('\n'); return ls.every((l) => /^\s*[-*] /.test(l)) ? E('ul', null, ls.map((l) => E('li', null, inl(l.replace(/^\s*[-*] /, ''))))) : E('p', null, ls.flatMap((l, i) => i ? [E('br'), ...inl(l)] : inl(l))); });
};
const plain = (t) => String(t || '').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/^\s*[-*] /gm, '').replace(/\s+/g, ' ').trim();
const withFirst = (list, u) => (u && list.includes(u) ? [u, ...list.filter((x) => x !== u)] : list);
const photosFor = (s, colour) => { const cp = (s.colourPhotos || {})[colour] || []; const rest = photos(s).filter((u) => !cp.includes(u)); return [...cp, ...rest]; };
const minimalPhotosFor = (style, colour) => {
  const variantPhotos = (style.colourPhotos?.[colour] || []).filter(Boolean);
  return variantPhotos.length ? variantPhotos : photosFor(style, colour);
};
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
// Every bespoke-chrome theme (per the registry, db/468) reuses the Minimal behaviour for every page it does not
// draw itself (checkout, account, orders, policies) -- that shared, header/footer-only ownership is the
// contract every bespoke theme is held to (docs/STOREFRONT_THEME_CONTRACT.md).
const isMin = () => { const t = cfg().template; return t === 'minimal' || BESPOKE.has(t); };
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
  const cardZoom = isMin() && Number(s.cardZoom);
  const dt = E('div', { class: 'dt' });
  const list = ims.length ? ims.slice(0, 6) : [null];
  list.forEach((u, i) => { sc.append(E('a', { href: link('p/' + s.id) }, u ? E('img', { src: thumb(u, 480), 'data-orig': u, style: cardZoom > 1 && cardZoom <= 1.4 ? { '--card-zoom': cardZoom } : null, alt: s.name, loading: i === 0 ? 'eager' : 'lazy', decoding: 'async' }) : placeholder(s.name))); if (list.length > 1) dt.append(E('i', { class: i === 0 ? 'on' : '' })); });
  sc.addEventListener('scroll', () => { const i = Math.round(sc.scrollLeft / Math.max(sc.clientWidth, 1)); [...dt.children].forEach((d, j) => d.classList.toggle('on', i === j)); }, { passive: true });
  const step = (d) => (e) => { e.preventDefault(); sc.scrollBy({ left: d * sc.clientWidth, behavior: 'smooth' }); };
  const bm = E('button', { class: 'bm' + (on ? ' on' : ''), 'aria-label': 'Save', onclick: (e) => { e.preventDefault(); toggleWish(s.id); bm.classList.toggle('on', wish.includes(s.id)); } }, icon('mark'));
  const ph = E('div', { class: 'ph' }, sc, dt, bm,
    gone ? E('div', { class: 'tag' }, 'Sold Out') : s.badge === 'limited' ? E('div', { class: 'tag' }, 'Limited') : discPct(s) >= 10 ? E('div', { class: 'tag' }, discPct(s) + '% off') : null,
    list.length > 1 ? E('button', { class: 'nx p', 'aria-label': 'Previous picture', onclick: step(-1) }, icon('left')) : null, list.length > 1 ? E('button', { class: 'nx n', 'aria-label': 'Next picture', onclick: step(1) }, icon('right')) : null);
  return E('div', { class: 'pc' + (gone ? ' gone' : '') + (list.length === 1 ? ' one' : '') }, ph, E('div', { class: 'in' },
    E('a', { href: link('p/' + s.id), style: { minWidth: 0 } }, E('div', { class: 'nm' }, s.name), E('div', { class: 'pr' }, inr(s.price), saleOn() && s.mrp > s.price ? E('s', null, inr(s.mrp)) : null)),
    gone ? null : E('button', { class: 'add', 'aria-label': 'Quick add', onclick: () => quickAdd(s) }, icon('plus'))));
}
function toggleWish(id) { try { TR.push('wish', null, { id }); } catch {} const i = wish.indexOf(id); if (i >= 0) wish.splice(i, 1); else wish.push(id); saveWish(); }
function quickAdd(s) {
  const minimal = isMin();
  const modelOptions = minimal && /phone case/i.test(s.category || '');
  const first = s.variants.find((variant) => variant.left > 0);
  let colour = minimal ? first?.colour || colours(s)[0] || '' : colours(s)[0] || '';
  let size = minimal ? first?.size || '' : '';
  const body = E('div'); const cb = E('button', { class: 'btn wide' }, 'Add to bag');
  const buy = minimal ? E('button', { class: 'btn out wide', type: 'button' }, 'Buy it now') : null;
  const selection = () => s.variants.find((variant) => (!colour || variant.colour === colour) && variant.size === size && variant.left > 0);
  const paint = () => {
    clear(body);
    const vs = s.variants.filter((v) => !colour || v.colour === colour);
    const selected = selection();
    if (minimal) {
      const photo = minimalPhotosFor(s, colour)[0];
      body.append(E('div', { class: 'minimal-quick-product' },
        photo ? E('img', { src: photo, alt: s.name }) : placeholder(s.name),
        E('div', null, E('strong', null, inr(selected?.price ?? s.price)),
          E('a', { href: link('p/' + s.id), onclick: () => sh.close() }, 'Product details & size guide ↗'),
          E('button', { type: 'button', 'aria-pressed': String(wish.includes(s.id)), onclick: () => { toggleWish(s.id); paint(); } },
            wish.includes(s.id) ? 'Remove from wishlist' : 'Save to wishlist'))));
    }
    if (colours(s).length > 1) body.append(E('div', { class: 'fgrp' }, E('span', { class: 'lbl' }, 'Colour'), E('div', { class: 'fwrap' }, colours(s).map((c) => E('button', { class: 'chip' + (c === colour ? ' on' : ''), onclick: () => { colour = c; size = ''; paint(); } }, E('i', { class: 'sw', style: { background: hex(c) } }), c)))));
    body.append(E('div', { class: 'fgrp' }, E('span', { class: 'lbl' }, modelOptions ? 'Model' : 'Size'), E('div', { class: 'fwrap' }, vs.map((v) => E('button', { class: 'sz' + (v.size === size ? ' on' : '') + (v.left < 1 ? ' off' : ''), disabled: minimal && v.left < 1, 'aria-pressed': String(v.size === size), onclick: () => { size = v.size; paint(); } }, v.size || 'One size')))));
    cb.disabled = !selected;
    if (buy) buy.disabled = cb.disabled;
  };
  const sh = sheet(s.name, body, buy ? E('div', { class: 'row2' }, cb, buy) : cb);
  if (minimal) sh.el.classList.add('minimal-quick-add');
  const finish = (checkout) => {
    const variant = selection();
    if (!variant || !addBag(variant.id, 1)) return;
    sh.close();
    if (checkout) go('checkout');
    else if (minimal) openMinimalBag();
  };
  cb.onclick = () => finish(false);
  if (buy) buy.onclick = () => finish(true);
  paint();
}
function addBag(vid, q) {
  const v = VAR[vid]; if (!v || !(v.left > 0)) return false;
  const cur = bag.find((b) => b.v === vid); const nq = Math.min((cur ? cur.q : 0) + q, v.left >= 9 ? 20 : v.left);
  if (cur) cur.q = nq; else bag.push({ v: vid, q: Math.max(nq, 1) });
  try { TR.push('bag', null, { id: v.sid, name: (BYID[v.sid] || {}).name }); } catch {}
  saveBag(); toast('Added to your bag');
  return true;
}
const bagLines = () => bag.map((b) => ({ ...b, vr: VAR[b.v] })).filter((b) => b.vr).map((b) => ({ ...b, s: BYID[b.vr.sid] }));
const bagTotal = () => bagLines().reduce((a, l) => a + l.vr.price * l.q, 0);
const bagCount = () => bagLines().reduce((a, l) => a + l.q, 0);
function openMinimalBag() {
  const body = E('div', { class: 'minimal-bag-lines' });
  const foot = E('div', { class: 'minimal-bag-foot' });
  const pop = sheet('Your bag', body, foot);
  const change = (line, qty) => {
    if (qty === 0) bag = bag.filter((item) => item.v !== line.v);
    else bag.find((item) => item.v === line.v).q = qty;
    saveBag();
    if (location.hash === '#/bag') route();
    paint();
  };
  function paint() {
    const items = bagLines();
    clear(body).append(items.length ? E('div', null, items.map((line) => {
      const image = minimalPhotosFor(line.s, line.vr.colour)[0];
      const max = line.vr.left >= 9 ? 20 : line.vr.left;
      return E('div', { class: 'minimal-bag-item' },
        E('a', { href: link('p/' + line.s.id), onclick: () => pop.close() },
          image ? E('img', { src: image, alt: line.s.name }) : placeholder(line.s.name)),
        E('div', null, E('a', { href: link('p/' + line.s.id), onclick: () => pop.close() }, line.s.name),
          E('div', { class: 'mut' }, [line.vr.colour, line.vr.size].filter(Boolean).join(' · ')),
          E('div', { class: 'qty' },
            E('button', { type: 'button', 'aria-label': 'Decrease quantity', disabled: line.q <= 1, onclick: () => change(line, line.q - 1) }, '−'),
            E('span', { 'aria-live': 'polite' }, line.q),
            E('button', { type: 'button', 'aria-label': 'Increase quantity', disabled: line.q >= max, onclick: () => change(line, line.q + 1) }, '+')),
          E('button', { type: 'button', class: 'minimal-remove', onclick: () => change(line, 0) }, 'Remove')),
        E('strong', null, inr(line.vr.price * line.q)));
    })) : E('p', null, 'Your bag is empty.'));
    clear(foot).append(items.length ? E('div', null,
      E('div', { class: 'minimal-heading', 'aria-live': 'polite' }, E('strong', null, 'Estimated total'), E('strong', null, inr(bagTotal()))),
      E('div', { class: 'row2' }, E('a', { class: 'btn out', href: link('bag'), onclick: () => pop.close() }, 'View bag'),
        E('a', { class: 'btn', href: link('checkout'), onclick: () => pop.close() }, 'Checkout')))
      : E('a', { class: 'btn wide', href: link('shop'), onclick: () => pop.close() }, 'Shop now'));
  }
  paint();
  pop.el.classList.add('minimal-bag-drawer');
  pop.el.querySelector('button').focus();
  pop.el.addEventListener('keydown', (event) => { if (event.key === 'Escape') pop.close(); });
}

// ---------- shell ----------
let counts = [];
function paintCounts() { counts.forEach((f) => f()); }
function countBadge(get) { const n = E('span', { class: 'n' }); const f = () => { const v = get(); n.textContent = v; n.style.display = v ? '' : 'none'; }; counts.push(f); f(); return n; }
function denseOn() { try { return localStorage.getItem('st.dens') === '1'; } catch (x) { return false; } }
function paintDense() { document.querySelectorAll('.dview').forEach((b) => b.replaceChildren(icon(denseOn() ? 'big' : 'dense'))); }
function toggleDense() {
  const on = !denseOn(); try { localStorage.setItem('st.dens', on ? '1' : '0'); } catch (x) {}
  document.querySelectorAll('.gw').forEach((gw) => { gw.classList.toggle('dense', on); gw.classList.add('flip'); setTimeout(() => gw.classList.remove('flip'), 320); });
  paintDense();
}
function shell() {
  counts = [];
  const name = D.shop.name;
  const minimal = isMin();
  const brandEl = E('a', { class: 'brand', href: link(''), 'aria-label': name }, E('span', null, name));
  const saved = E('a', { class: 'ic deskonly', href: link('wishlist'), 'aria-label': 'Saved' }, icon('mark'), countBadge(() => wish.length));
  const top = E('header', { class: 'top' },
    E('div', { class: 'l' },
      E('a', { class: 'deskonly', href: link('shop?new=1') }, 'New in'), E('a', { class: 'deskonly', href: link('collections') }, 'Collections'), ...((themeHeader() || {}).links || []).map((l) => headerLink(l, 'deskonly')), E('button', { class: 'menu-pill phoneonly', onclick: openMenu }, E('i'), 'Menu')),
    brandEl,
    E('div', { class: 'r' }, E('button', { class: 'ic dview', id: 'dview', 'aria-label': 'Picture view', title: 'Picture view', onclick: toggleDense }, icon('dense')),
      E('a', { class: 'ic deskonly', href: link('stores'), 'aria-label': 'Stores' }, icon('pin')), E('button', { class: 'ic', 'aria-label': 'Search', onclick: openSearch }, icon('search')),
      minimal ? E('button', { class: 'ic', type: 'button', 'aria-label': 'Notifications', onclick: openMinimalNotifications }, icon('bell'), countBadge(() => minimalNotifications().filter((item) => !LS.get('notice.' + item.id, false)).length)) : null,
      !minimal ? saved : null, E('a', { class: 'ic', href: link('me'), 'aria-label': 'My account' }, icon('user')), minimal ? saved : null,
      minimal ? E('button', { class: 'ic', type: 'button', 'aria-label': 'Bag', onclick: openMinimalBag }, icon('bag'), countBadge(bagCount))
        : E('a', { class: 'ic', href: link('bag'), 'aria-label': 'Bag' }, icon('bag'), countBadge(bagCount)),
      minimal ? E('button', { class: 'ic minimal-menu', type: 'button', 'aria-label': 'Menu', onclick: openMenu }, icon('menu'))
        : E('button', { class: 'menu-pill deskonly', onclick: openMenu }, E('i'), 'Menu')));
  const c = cfg();
  const phoneNo = String(D.shop.phone || '').replace(/\D/g, '');
  const waUrl = phoneNo ? 'https://wa.me/' + (phoneNo.length === 10 ? '91' + phoneNo : phoneNo) : '';
  const mk = minimal ? name : D.shop.logoUrl ? E('img', { src: D.shop.logoUrl, alt: '' }) : String(name || 'S').trim().charAt(0).toUpperCase();
  const toContact = () => { const w = $('#chatwel'); if (w) w.remove(); if (minimal && waUrl) window.open(waUrl, '_blank', 'noopener'); else go('contact'); };
  const dock = E('div', { class: 'dock phoneonly' },
    E('button', { class: 'mark', 'aria-label': name, onclick: () => go('') }, mk),
    E('div', { class: 'pill' }, E('button', { 'aria-label': 'Explore', onclick: openMenu }, icon('compass')), E('button', { 'aria-label': 'Shop', onclick: () => go('shop') }, icon('home')),
      E('button', { 'aria-label': 'Saved', onclick: () => go('wishlist') }, icon('mark'), countBadge(() => wish.length)), E('button', { 'aria-label': 'Stores', onclick: () => go('stores') }, icon('pin'))),
    E('div', { class: 'chatwrap' }, E('button', { class: 'zfab dview', 'aria-label': 'Picture view', title: 'Picture view', onclick: toggleDense }, icon('dense')), E('button', { class: 'chat', 'aria-label': 'Contact us', onclick: toContact }, icon('chat'))));
  const root = $('#app'); clear(root);
  const th = themeHeader() || {}; const annText = th.announceText || c.announce;
  root.append(annText ? E('div', { class: 'announce' }, th.announceText && th.announceHref ? E('a', { href: themeHref(th.announceHref), style: { color: 'inherit' } }, annText) : annText) : null, top, E('main', { id: 'view' }), footer(), dock, E('button', { class: 'zfab zdesk dview', 'aria-label': 'Picture view', title: 'Picture view', onclick: toggleDense }, icon('dense')), E('button', { class: 'chatfab', 'aria-label': 'Contact us', onclick: toContact }, icon('chat')),
    E('div', { class: 'menu', id: 'menu' }), E('div', { class: 'srch', id: 'srch' }));

  if (!minimal) scheduleWelcome(toContact);
}
let welcomeTimer;
function scheduleWelcome(toContact) {
  clearTimeout(welcomeTimer);
  const key = 'st.wel.' + SLUG;
  try { if (sessionStorage.getItem(key)) return; } catch {}
  welcomeTimer = setTimeout(() => {
    const minimal = isMin();
    if (minimal && !document.body.classList.contains('homehero')) return;
    try { sessionStorage.setItem(key, '1'); } catch {}
    const name = D.shop.name;
    const badge = !minimal && D.shop.logoUrl ? E('img', { class: 'wl', src: D.shop.logoUrl, alt: '' })
      : E('i', { class: 'wl', 'aria-hidden': 'true' }, name.trim().charAt(0).toUpperCase());
    const close = E('button', { type: 'button', class: 'welcome-close', 'aria-label': 'Dismiss welcome message', onclick: () => message.remove() }, '×');
    const text = E('button', { type: 'button', class: 'wt', onclick: toContact }, E('b', null, name), E('span', null, cfg().welcome || 'Welcome to ' + name + '!'));
    const message = E('div', { class: 'chatwel', id: 'chatwel' }, badge, text, close);
    document.body.append(message);
    setTimeout(() => message.classList.add('out'), 6500);
    setTimeout(() => message.remove(), 7100);
  }, 1200);
}
function groups() {
  const cats = [...new Set(STY.map((s) => s.category).filter(Boolean))];
  const G = [['Top', /shirt|tee|polo|sweat|hood|jacket|top|kurta|blazer|coat|knit|vest/i], ['Bottom', /jean|pant|trouser|short|cargo|skirt|jogger|chino|denim|legging/i], ['Footwear', /shoe|sneaker|sandal|slipper|boot|loafer|footwear|heel/i], ['Accessories', /bag|cap|hat|belt|wallet|sock|scarf|watch|case|glass|jewel|tie/i]];
  const out = G.map(([n, re]) => [n, cats.filter((c) => re.test(c))]); const used = new Set(out.flatMap((x) => x[1]));
  const other = cats.filter((c) => !used.has(c)); if (other.length) out.push([out.some((x) => x[1].length) ? 'More' : 'Shop', other]);
  return out.filter((x) => x[1].length);
}
const slugOf = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const publicStoreView = /^(?:shop|collections|about|stores|faq|contact|sitemap|careers|(?:blog|media)(?:\/[a-z0-9-]+)?|page\/[a-z0-9-]+|policy\/(?:shipping|returns|privacy|terms))$/;
function minimalDestination(value) {
  const target = String(value || '').trim();
  if (/^https?:\/\//i.test(target) || /^#\/[a-z0-9][^\s]*$/i.test(target)) return target;
  const route = target.replace(/^\//, '');
  return publicStoreView.test(route) ? link(route) : '';
}
// Theme editor header / footer blocks and extra pages (db/399). In the editor preview the unsaved draft is used instead.
let PREVIEW_CHROME = null;
const themeHeader = () => (PREVIEW_CHROME ? PREVIEW_CHROME.header : cfg().themeHeader) || null;
const themeFooter = () => (PREVIEW_CHROME ? PREVIEW_CHROME.footer : cfg().themeFooter) || null;
const themePages = () => (PREVIEW_CHROME ? PREVIEW_CHROME.pages : cfg().themePages) || [];
function themeHref(h) {
  h = String(h || ''); if (h.startsWith('ref:')) return safeHref(h) || link(''); if (/^https:\/\//i.test(h) || h.startsWith('#/')) return h;
  return h === '/' || !h.startsWith('/') ? link('') : link(h.slice(1));
}
const headerLink = (l, cls) => (l.children || []).length ? E('span', { class: 'hdd ' + (cls || '') }, themeLink(l), E('span', { class: 'hddm' }, l.children.map((c) => themeLink(c)))) : themeLink(l, cls);
const themeLink = (l, cls) => E('a', { class: cls || '', href: themeHref(l.href), target: /^https:/i.test(l.href) ? '_blank' : null, rel: /^https:/i.test(l.href) ? 'noopener' : null }, l.label);
function minimalPages() {
  const seen = new Set();
  return [...(cfg().minimalPages || []), ...themePages().filter((p) => p && p.title)].flatMap((entry) => {
    const slug = slugOf(entry?.slug || entry?.title);
    if (!entry?.title || !slug || seen.has(slug)) return [];
    seen.add(slug);
    return [{ ...entry, slug }];
  });
}
function storeViewUrl(view, filters = {}) {
  return location.origin + location.pathname + '?' + new URLSearchParams({ view, ...filters });
}
const blogsOn = () => (cfg().blogs || []).some((x) => x && x.title);
const mediaOn = () => (cfg().media || []).some((x) => x && (x.title || x.image));
const jobsOn = () => (cfg().jobs || []).some((x) => x && x.title) || !!(cfg().hiring && (cfg().hiring.email || cfg().hiring.text));
function openMenu() {
  if (isMin()) return openMinimalMenu();
  const m = $('#menu'); clear(m); m.classList.add('on');
  const close = () => { m.classList.remove('on'); document.body.classList.remove('menuopen'); };
  document.body.classList.add('menuopen');
  const fams = FAM.filter((f) => STY.some((s) => colours(s).some((c) => famOf(c) === f[0])));
  const nav = (p) => (e) => { e.preventDefault(); close(); location.hash = '#/' + p; };
  const a = (txt, p, cls) => E('a', { class: cls || '', href: link(p), onclick: nav(p) }, txt);
  const cols = D.collections.filter((c) => c.styleIds.length).slice(0, 3);
  const more = [blogsOn() ? ['Journal', 'blog'] : null, mediaOn() ? ['Media & gallery', 'media'] : null, jobsOn() ? ['Careers', 'careers'] : null, ['Our stores', 'stores'], ['Our story', 'about'], ['FAQs', 'faq'], ['Contact', 'contact'], ...minimalPages().map((p) => [p.title, 'page/' + p.slug]), ['My account & orders', 'me']].filter(Boolean);
  const panel = E('div', { class: 'mp' },
    E('div', { class: 'mhd' }, E('b', null, D.shop.name), E('button', { class: 'ic mx', 'aria-label': 'Close', onclick: close }, icon('x'))),
    E('nav', { class: 'mbig' }, a('New arrivals', 'shop?new=1', 'b'), a('All products', 'shop', 'b'), ...cols.map((c) => a(c.name, 'shop?col=' + c.id, 'b'))),
    ...groups().map(([n, cs]) => E('div', { class: 'mgrp' }, E('span', { class: 'ml' }, n), E('div', { class: 'mrow' }, cs.map((c) => a(c, 'shop?cat=' + encodeURIComponent(c)))))),
    fams.length ? E('div', { class: 'mgrp' }, E('span', { class: 'ml' }, 'Shop by colour'), E('div', { class: 'mdots' }, fams.map((f) => E('a', { class: 'md', 'aria-label': f[0], title: f[0], href: link('shop?fam=' + f[0]), onclick: nav('shop?fam=' + f[0]), style: { background: 'linear-gradient(135deg,' + f[2][0] + ',' + f[2][1] + ')' } })))) : null,
    E('div', { class: 'mmore' }, more.map(([t, p]) => a(t, p))));
  m.append(panel);
  m.onclick = (e) => { if (e.target === m) close(); };
}
function openMinimalMenu() {
  const trigger = document.activeElement;
  const dialog = E('dialog', { class: 'minimal-mega-menu', 'aria-label': 'Store menu' });
  const item = (label, path, extra) => E('a', { href: link(path), onclick: () => dialog.close() }, label, extra);
  const action = (label, glyph, run) => E('button', { class: 'ic', type: 'button', 'aria-label': label,
    onclick: () => { dialog.close(); run(); } }, icon(glyph));
  const close = action('Close menu', 'x', () => {});
  const collections = D.collections.filter((collection) => collection.styleIds.some((id) => BYID[id])).slice(0, 5);
  const items = [
    ['Featured', [['New arrivals', 'shop?new=1'], ...collections.map((c) => [c.name, 'shop?col=' + encodeURIComponent(c.id)]), ['All products', 'shop']]],
    ...groups().map(([title, categories]) => [title, categories.map((category) => [category, 'shop?cat=' + encodeURIComponent(category)])]),
    ['Shop by colour', FAM.filter(([name]) => STY.some((style) => colours(style).some((colour) => famOf(colour) === name)))
      .map(([name, , palette]) => [name, 'shop?fam=' + encodeURIComponent(name),
        E('span', { class: 'minimal-mega-swatches', 'aria-hidden': 'true' }, palette.map((colour) => E('i', { style: { backgroundColor: colour } })) )])],
  ];
  dialog.append(E('div', { class: 'minimal-mega-top' },
    E('nav', { 'aria-label': 'Featured links' }, item('New in', 'shop?new=1'), item('Collections', 'collections'), ((themeHeader() || {}).links || []).map((l) => [themeLink(l), ...(l.children || []).map((c) => themeLink(c, 'sublink'))])),
    E('div', { class: 'minimal-mega-brand' }, item(D.shop.name, '')),
    E('div', { class: 'minimal-mega-actions' }, action('Search', 'search', openMinimalSearch),
      action('Notifications', 'bell', openMinimalNotifications), item('My account', 'me'), action('Bag', 'bag', openMinimalBag), close)),
    E('div', { class: 'minimal-mega-grid' }, items.filter(([, links]) => links.length).map(([title, links]) =>
      E('nav', { class: title === 'Featured' ? 'minimal-mega-featured' : '', 'aria-label': title },
        title === 'Featured' ? null : E('h3', null, title), E('div', null, links.map(([label, path, extra]) => item(label, path, extra)))))),
    E('nav', { class: 'minimal-mega-secondary', 'aria-label': 'More from the store' },
      item('Our story', 'about'), item('Journal', 'blog'), item('Collaborations', 'media'), item('Walk-in stores', 'stores'),
      item('Wishlist', 'wishlist'), item('Track your order', 'orders'), item('FAQs', 'faq'), item('Contact', 'contact'), item('Sitemap', 'sitemap'),
      minimalPages().map((page) => item(page.title, 'page/' + page.slug))));
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog && event.clientY > dialog.getBoundingClientRect().bottom) dialog.close();
  });
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (trigger?.isConnected && !document.querySelector('.sheetwrap')) trigger.focus();
  }, { once: true });
  document.body.append(dialog);
  dialog.showModal();
  close.focus();
}
function openSearch() {
  if (isMin()) return openMinimalSearch();
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

function openMinimalSearch() {
  const results = E('div', { class: 'minimal-search-results', 'aria-live': 'polite' });
  const field = E('input', { type: 'search', 'aria-label': 'Search products', placeholder: 'Search products or collections', autocomplete: 'off', oninput: paint });
  const panel = sheet('Search', E('div', { class: 'minimal-search-content' }, field, results));
  panel.el.classList.add('minimal-bag-drawer');
  panel.el.addEventListener('keydown', (event) => { if (event.key === 'Escape') panel.close(); });
  function paint() {
    const query = field.value.trim().toLowerCase();
    const collections = D.collections.filter((c) => c.styleIds.length && c.name.toLowerCase().includes(query)).slice(0, 6);
    const matches = query ? STY.filter((s) => [s.name, s.category, s.code, ...colours(s)].join(' ').toLowerCase().includes(query)).slice(0, 10) : newest(4);
    clear(results).append(
      collections.length ? E('section', null, E('h3', null, 'Collections'), collections.map((c) =>
        E('a', { class: 'minimal-search-link', href: link('shop?col=' + encodeURIComponent(c.id)), onclick: () => panel.close() }, c.name))) : null,
      E('section', null, E('h3', null, query ? 'Products' : 'New arrivals'), matches.length ? matches.map((s) => {
        const photo = pickPic(s, 'card');
        return E('a', { class: 'minimal-search-link', href: link('p/' + s.id), onclick: () => panel.close() },
          photo ? E('img', { src: photo, alt: '', loading: 'lazy' }) : null,
          E('span', null, s.name), E('strong', null, inr(s.price)));
      }) : E('p', null, 'No products found.')));
  }
  paint();
  field.focus();
}

function minimalNotifications() {
  const announcement = cfg().announce;
  const newestItem = newest(1)[0];
  const article = (cfg().blogs || []).find((item) => item?.title);
  const today = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const notices = (cfg().minimalNotices || []).filter((item) => item?.title && (!item.date || item.date <= today));
  return [
    ...notices.map((item) => ({ id: JSON.stringify([item.title, item.body, item.date, item.link]), text: item.title,
      body: item.body, href: minimalDestination(item.link) })),
    announcement ? { id: 'announcement:' + announcement, text: announcement } : null,
    newestItem ? { id: 'product:' + newestItem.id, text: 'Latest drop: ' + newestItem.name, href: link('shop?new=1') } : null,
    article ? { id: 'article:' + slugOf(article.title), text: 'From the journal: ' + article.title, href: link('blog/' + slugOf(article.title)) } : null,
  ].filter(Boolean);
}
function openMinimalNotifications() {
  const items = minimalNotifications();
  const panel = sheet('Notifications', E('div', { class: 'minimal-search-results' }, items.length ? items.map((item) =>
    E(item.href ? 'a' : 'div', { class: 'minimal-search-link', href: item.href || null, onclick: item.href ? () => panel.close() : null },
      E('div', null, E('strong', null, item.text), item.body ? E('p', null, item.body) : null)))
    : E('p', null, 'No notifications yet.')));
  panel.el.classList.add('minimal-bag-drawer');
  items.forEach((item) => LS.set('notice.' + item.id, true));
  paintCounts();
  panel.el.querySelector('button').focus();
  panel.el.addEventListener('keydown', (event) => { if (event.key === 'Escape') panel.close(); });
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
    clear(pd); if (s.description) pd.append(...richNodes(s.description)); pd.hidden = !s.description;
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
const minimalCategoryGroups = {
  bags: { label: 'Bags', pattern: /\bbags?\b|backpack|tote/i },
  accessories: { label: 'Accessories', pattern: /accessor|\bcap(s)?\b|\bhat(s)?\b|phone case|wallet|belt|jewel/i },
};
function minimalGroupProducts(group, products = STY) {
  const { pattern } = minimalCategoryGroups[group];
  return products.filter((product) => pattern.test(product.category || ''));
}
const demoCollectionBanners = new Map([
  ['1792645668510-of3a2.jpg', 'ecrivoire-wide.jpg'],
  ['gx-denim-cover.jpg', 'denim-wide.jpg'],
  ['gx-field-cover.jpg', 'field-wide.jpg'],
  ['gx-street-cover.jpg', 'street-wide.jpg'],
  ['gx-small-essentials-mono.jpg', 'essentials-wide.jpg'],
  ['gx-urban-black.jpg', 'urban-wide.jpg'],
]);
function collectionBanner(col) {
  if (col.bannerImage) return col.bannerImage;
  if (location.hostname !== 'demo.auzslab.in' || SLUG !== 'demo') return '';
  const prefix = 'https://api.auzslab.in/uploads/site/demo/style/';
  const cover = String(col.image || '').split(/[?#]/, 1)[0];
  const asset = cover.startsWith(prefix) && demoCollectionBanners.get(cover.slice(prefix.length));
  return asset ? '/store/demo-banners/' + asset : '';
}
function minimalCollectionTiles() {
  const collections = D.collections.filter((col) => col.styleIds.some((id) => BYID[id]));
  return collections.map((col) => {
    const members = col.styleIds.map((id) => BYID[id]).filter(Boolean);
    const firstPhoto = members.map((s) => pickPic(s, 'banner')).find(Boolean);
    return {
      name: col.name, href: link('shop?col=' + encodeURIComponent(col.id)), widePhoto: collectionBanner(col),
      photo: col.image || firstPhoto,
    };
  });
}
function minimalStories(tiles = minimalCollectionTiles()) {
  const configuredStories = (cfg().minimalStories || []).filter((story) => story?.title && story.image).map((story) => ({
    name: story.title, photo: story.image, href: minimalDestination(story.link), cta: story.cta,
  }));
  return (configuredStories.length ? configuredStories : tiles.filter((tile) => tile.photo)).slice(0, 12);
}
function minimalHome(v) {
  const c = cfg();
  const featured = newest(12);
  const configuredImages = (c.heroImages || []).filter(Boolean);
  const heroImages = configuredImages.length ? configuredImages : featured.map((s) => pickPic(s, 'hero')).filter(Boolean);
  const tiles = minimalCollectionTiles();
  const heroImage = heroImages.length ? E('img', { src: heroImages[0], alt: '', fetchpriority: 'high' }) : null;
  let slide = 0;
  const dots = heroImages.map((_, index) => E('button', { type: 'button', 'aria-label': 'Show banner ' + (index + 1),
    'aria-pressed': String(index === 0), onclick: () => showBanner(index) }));
  function showBanner(index) {
    slide = index;
    heroImage.src = heroImages[slide];
    dots.forEach((dot, i) => dot.setAttribute('aria-pressed', String(i === slide)));
  }
  v.append(E('section', { class: 'minimal-hero' + (heroImage ? ' has-image' : '') }, heroImage,
    E('div', { class: 'minimal-hero-copy' }, E('h1', null, c.heroTitle || D.shop.name),
      E('a', { href: link('shop') }, c.heroCta || 'Shop now')),
    heroImages.length > 1 ? E('div', { class: 'minimal-hero-nav', 'aria-label': 'Hero images' }, dots) : null));
  if (featured.length) v.append(minimalProductRail('Latest drop', featured, link('shop?new=1'), 'minimal-latest'));
  const bags = minimalGroupProducts('bags');
  if (bags.length) v.append(minimalProductRail('Bags', bags, link('shop?group=bags'), 'minimal-bags'));
  const banners = tiles.filter((tile) => tile.photo).slice(0, 8);
  if (banners.length) {
    v.append(E('div', { class: 'minimal-collection-desktop' }, minimalCollectionCarousel(banners)));
    const deck = minimalCollectionStack(banners);
    v.append(E('div', { class: 'minimal-collection-phone' }, deck || minimalCollectionCarousel(banners)));
  }
  // The section and its grid stay -- only the "Featured products" heading text was removed (owner request);
  // "Shop all" still links through to the full catalogue.
  if (STY.length) v.append(E('section', { class: 'minimal-section minimal-home-products' },
    E('div', { class: 'minimal-heading' }, E('span'), E('a', { href: link('shop') }, 'Shop all', ' ↗')), gridOf(STY.slice(0, 8))));
  const accessories = minimalGroupProducts('accessories');
  if (accessories.length) {
    const category = accessories[0].category;
    const singleCategory = accessories.every((product) => product.category === category);
    v.append(minimalProductRail(singleCategory ? category : 'Accessories', accessories,
      singleCategory ? link('shop?cat=' + encodeURIComponent(category)) : link('shop?group=accessories'), 'minimal-accessories'));
  }
  const locations = storeList();
  if (locations.length) v.append(minimalHomeStores(locations));
}
function minimalCollectionArt(banner) {
  return E('picture', {}, banner.photo && banner.widePhoto ? E('source', { media: '(max-width:700px)', srcset: banner.photo }) : null,
    E('img', { class: 'minimal-collection-art', src: banner.widePhoto || banner.photo, alt: '', loading: 'lazy' }));
}
function minimalCollectionCarousel(banners) {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const track = E('div', { class: 'minimal-collection-track' + (banners.length > 1 ? ' has-multiple' : ''), tabindex: '0', 'aria-label': 'Collection banners' },
    banners.map((banner) => E('a', { class: 'minimal-collection-slide', href: banner.href, 'aria-label': banner.name },
      minimalCollectionArt(banner),
      E('span', { class: 'minimal-collection-name', 'aria-hidden': 'true' }, banner.name))));
  const step = (direction) => {
    const first = track.children[0].offsetLeft;
    const stride = track.children[1].offsetLeft - first;
    if (stride <= 0) return;
    const current = Math.round(track.scrollLeft / stride);
    const next = (current + direction + banners.length) % banners.length;
    track.scrollTo({ left: track.children[next].offsetLeft - first, behavior: reducedMotion.matches ? 'auto' : 'smooth' });
  };
  const section = E('section', { class: 'minimal-collection-carousel', 'aria-label': 'Discover collections' }, track,
    banners.length > 1 ? E('div', { class: 'minimal-collection-controls' },
      E('button', { type: 'button', 'aria-label': 'Previous collection', onclick: () => step(-1) }, icon('left')),
      E('button', { type: 'button', 'aria-label': 'Next collection', onclick: () => step(1) }, icon('right'))) : null);
  if (banners.length > 1) {
    const timer = setInterval(() => {
      if (!section.isConnected) return clearInterval(timer);
      const bounds = section.getBoundingClientRect();
      if (!reducedMotion.matches && !document.hidden && !section.matches(':hover,:focus-within') && bounds.top < innerHeight && bounds.bottom > 0) step(1);
    }, 5000);
  }
  return section;
}
// Same overlapping-card deck as the Classic shop page's `stack()` (reuses its .stk/.sk CSS):
// one big bright centre card, its neighbours peeking out smaller and darker, drag or auto-advance.
function minimalCollectionStack(banners) {
  banners = banners.filter((b) => b.widePhoto || b.photo);
  const n = banners.length;
  if (n < 2) return null;
  let cur = 0, hold = false, holdT = 0, moved = false;
  const deck = E('div', { class: 'stk' }, banners.map((b) => E('a', { class: 'sk', href: b.href },
    E('img', { src: b.widePhoto || b.photo, alt: '', loading: 'lazy', draggable: 'false' }),
    E('div', { class: 'nm' }, E('span', null, b.name)))));
  const items = [...deck.children];
  const SC = [1, .87, .76], BR = [1, .62, .4], OFF = [0, 17, 30];
  const place = () => { items.forEach((el, i) => {
    let d = i - cur; if (d > n / 2) d -= n; if (d < -n / 2) d += n; const a = Math.abs(d), sg = d < 0 ? -1 : 1;
    if (a > 2) { el.style.opacity = '0'; el.style.pointerEvents = 'none'; el.style.zIndex = '0'; el.style.transform = 'translateX(' + sg * OFF[2] + '%) scale(' + SC[2] * .9 + ')'; return; }
    el.style.opacity = '1'; el.style.pointerEvents = 'auto'; el.style.zIndex = String(10 - a);
    el.style.transform = 'translateX(' + sg * OFF[a] + '%) scale(' + SC[a] + ')'; el.style.filter = a ? 'brightness(' + BR[a] + ')' : 'none';
    el.classList.toggle('on', a === 0);
  }); };
  const go = (i) => { cur = ((i % n) + n) % n; place(); };
  const pause = (ms) => { hold = true; clearTimeout(holdT); holdT = setTimeout(() => { hold = false; }, ms || 5000); };
  let x0 = null;
  deck.addEventListener('pointerdown', (e) => { x0 = e.clientX; moved = false; pause(); });
  deck.addEventListener('pointermove', (e) => { if (x0 != null && Math.abs(e.clientX - x0) > 10) moved = true; });
  const end = (e) => { if (x0 == null) return; const dx = e.clientX - x0; x0 = null; if (Math.abs(dx) > 36) go(cur + (dx < 0 ? 1 : -1)); };
  deck.addEventListener('pointerup', end); deck.addEventListener('pointercancel', () => { x0 = null; });
  items.forEach((el, i) => el.addEventListener('click', (e) => { if (moved) { e.preventDefault(); moved = false; return; } if (i !== cur) { e.preventDefault(); go(i); pause(); } }));
  place();
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const timer = setInterval(() => {
      if (!document.body.contains(deck)) return clearInterval(timer);
      if (hold || document.hidden) return;
      go(cur + 1);
    }, 3200);
  }
  return deck;
}
function openMinimalStory(stories, index, trigger) {
  const dialog = E('dialog', { class: 'minimal-story-viewer', 'aria-label': 'Shop the stories' });
  const frame = E('div', { class: 'minimal-story-frame' });
  const dismiss = E('button', { class: 'ic', type: 'button', 'aria-label': 'Close story', onclick: () => dialog.close() }, icon('x'));
  dialog.append(dismiss, frame);
  const step = (direction) => { index = (index + direction + stories.length) % stories.length; paint(); };
  function paint() {
    const story = stories[index];
    clear(frame).append(E('img', { src: story.photo, alt: '' }),
      E('div', { class: 'minimal-story-caption' }, E('div', { 'aria-live': 'polite' }, (index + 1) + ' / ' + stories.length),
        E('h2', null, story.name), story.href ? E('a', { class: 'btn', href: story.href, onclick: () => dialog.close() }, story.cta || 'Shop now') : null),
      stories.length > 1 ? E('div', { class: 'minimal-story-controls' },
        E('button', { class: 'ic', type: 'button', 'aria-label': 'Previous story', onclick: () => step(-1) }, 'Previous'),
        E('button', { class: 'ic', type: 'button', 'aria-label': 'Next story', onclick: () => step(1) }, 'Next')) : null);
  }
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); step(event.key === 'ArrowLeft' ? -1 : 1); }
  });
  dialog.addEventListener('close', () => { dialog.remove(); if (trigger.isConnected) trigger.focus(); }, { once: true });
  document.body.append(dialog);
  paint();
  dialog.showModal();
  dismiss.focus();
}
function minimalRail(content, label) {
  const track = E('div', { class: 'minimal-rail', tabindex: '0', role: 'region', 'aria-label': label }, content);
  const move = (direction) => () => track.scrollBy({ left: direction * track.clientWidth * .8, behavior: 'smooth' });
  return {
    track,
    controls: E('div', { class: 'minimal-rail-controls' },
      E('button', { type: 'button', 'aria-label': 'Scroll ' + label + ' left', onclick: move(-1) }, icon('left')),
      E('button', { type: 'button', 'aria-label': 'Scroll ' + label + ' right', onclick: move(1) }, icon('right'))),
  };
}
function minimalProductRail(title, products, destination, style = '') {
  const { track, controls } = minimalRail(products.map((product) => card(product)), title);
  return E('section', { class: 'minimal-section minimal-product-section ' + style },
    E('div', { class: 'minimal-heading' }, E('h2', null, title), E('div', { class: 'minimal-section-actions' },
      controls, E('a', { class: 'minimal-discover', href: destination }, 'Discover more'))), track);
}
function minimalHomeStores(stores) {
  const cards = storeCards(stores, true);
  const { track, controls } = minimalRail(cards, 'Store locations');
  return E('section', { class: 'minimal-section minimal-home-stores', 'aria-labelledby': 'minimal-stores-heading' },
    E('div', { class: 'minimal-store-stage' },
      E('div', { class: 'minimal-heading' },
        E('h2', { id: 'minimal-stores-heading' }, 'Stores across India'),
        E('div', { class: 'minimal-section-actions' }, controls, E('a', { class: 'minimal-discover', href: link('stores') }, 'All stores')))),
    track);
}
// Storefront theme marketplace (phase 2, db/375): additive, data-driven content sections from the
// store's own active theme install (sfx_public_active_sections, folded into public_sfx_store's config
// as customSections) -- appended after the existing hero/catalog content, for BOTH the Minimal and
// Classic chrome (which stay their existing hand-built CSS/markup; see that migration's own comment on
// why a full per-theme chrome swap is out of scope for this slice). Empty array (every store that never
// touched the marketplace) renders nothing, so this is a zero-behaviour-change addition by default.
function customSection(s) {
  const p = s.props || {};
  if (s.type === 'hero' && (p.heading || p.sub)) return E('section', { class: 'custom-section custom-hero' },
    p.heading ? E('h2', null, p.heading) : null, p.sub ? E('p', null, p.sub) : null,
    p.cta && safeHref(p.href) ? E('a', { class: 'btn', href: safeHref(p.href) }, p.cta) : null);
  if (s.type === 'text' && (p.heading || p.body)) return E('section', { class: 'custom-section custom-text' },
    p.heading ? E('h2', null, p.heading) : null, p.body ? E('p', null, p.body) : null);
  if (s.type === 'image' && p.url) return E('section', { class: 'custom-section custom-image' },
    E('img', { src: p.url, alt: p.caption || '' }), p.caption ? E('div', { class: 'cap' }, p.caption) : null);
  if (s.type === 'button' && p.text && safeHref(p.href)) return E('section', { class: 'custom-section custom-button' }, E('a', { class: 'btn', href: safeHref(p.href) }, p.text));
  if (s.type === 'announcement' && p.text) return E('div', { class: 'custom-section custom-announcement' }, p.text);
  if (s.type === 'booking') return bookingSection(p);
  if (CUSTOM_RENDERERS[s.type]) return CUSTOM_RENDERERS[s.type](s, p);
  return null;
}
// Sections added with the section registry (db/452): each draws its own settings and, where it has them, its blocks (items).
// A link can be a typed address or a reference (db/458) to a page, collection, product or category: turned into the right address here, so
// it keeps working after a rename. A reference to something that no longer exists goes to the shop instead of a dead page.
const REF_PAGES = { home: '#/', shop: '#/shop', collections: '#/collections', about: '#/about', contact: '#/contact', faq: '#/faq', stores: '#/stores', cart: '#/bag' };
function resolveRef(h) {
  const m = /^ref:([a-z]+)(?::(.+))?$/.exec(h); if (!m) return '';
  if (!m[2]) return REF_PAGES[m[1]] || '';
  if (m[1] === 'page') return '#/page/' + encodeURIComponent(m[2]);
  if (m[1] === 'collection') return (D.collections || []).some((c) => c.id === m[2]) ? '#/shop?col=' + encodeURIComponent(m[2]) : '#/shop';
  if (m[1] === 'product') return BYID[m[2]] ? '#/p/' + encodeURIComponent(m[2]) : '#/shop';
  if (m[1] === 'category') return '#/shop?cat=' + encodeURIComponent(m[2]);
  return '';
}
const safeHref = (h) => { const x = String(h || ''); return x.startsWith('ref:') ? resolveRef(x) : (/^(https:\/\/|\/|#)/i.test(x) ? x : ''); };
const blocksOf = (s) => (Array.isArray(s.blocks) ? s.blocks.filter((b) => b && b.props) : []);
// Content section (db/457): every element carries its own checked style. Values are set one property at a time (never as text), and
// colours, numbers and choices are validated here again, so a saved value can never inject CSS.
const colorOf = (v) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v : '');
const pxOf = (v, lo, hi) => { const n = Number(v); return v !== '' && v != null && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) + 'px' : ''; };
const setStyle = (el, m) => Object.entries(m).forEach(([k, v]) => { if (v) el.style.setProperty(k, v); });
const FONT_STACKS = { serif: 'Georgia,"Times New Roman",serif', humanist: '"Trebuchet MS","Segoe UI",Verdana,sans-serif', mono: 'ui-monospace,"SF Mono",Menlo,Consolas,monospace' };
const WEIGHTS = { bold: '700', medium: '500', normal: '400' }, LINES = { tight: '1.3', normal: '1.6', loose: '1.9' };
const textBox = (p) => ({ 'font-size': pxOf(p.size, 10, 120), 'text-align': ['left', 'center', 'right'].includes(p.align) ? p.align : '', color: colorOf(p.color), 'font-family': FONT_STACKS[p.font] || '',
  'background-color': colorOf(p.bg), 'border-radius': pxOf(p.radius, 0, 60), padding: pxOf(p.pad, 0, 80) });
const ANIMS = ['fade', 'rise', 'left', 'right', 'zoom'];
function withAnim(el, p) { if (el && ANIMS.includes(p && p.anim)) { el.classList.add('anim', 'anim-' + p.anim); animObserve(el); } return el; }
let ANIM_IO = null;
function animObserve(el) {
  if (!('IntersectionObserver' in window) || PREVIEW) { el.classList.add('anim-in'); return; }
  if (!ANIM_IO) ANIM_IO = new IntersectionObserver((es) => es.forEach((x) => { if (x.isIntersecting) { x.target.classList.add('anim-in'); ANIM_IO.unobserve(x.target); } }), { threshold: .12 });
  ANIM_IO.observe(el);
}
const contentBlock = (b, sec) => withAnim(contentBlockBase(b, sec), (b && b.props) || {});
function contentBlockBase(b, sec) {
  const p = b.props || {};
  if (b.type === 'heading' && p.text) { const el = E('h2', { class: 'cb-heading' }, p.text);
    setStyle(el, { ...textBox(p), 'font-weight': WEIGHTS[p.weight] || '', 'letter-spacing': p.spacing === 'wide' ? '.08em' : '', 'text-transform': p.case === 'upper' ? 'uppercase' : '' }); return el; }
  if (b.type === 'text' && p.text) { const el = E('p', { class: 'cb-text' }, p.text); setStyle(el, { ...textBox(p), 'line-height': LINES[p.lineHeight] || '' }); return el; }
  if (b.type === 'button' && p.label) { const href = safeHref(p.href);
    const el = E('a', { class: 'btn cb-button' + (p.look === 'outline' ? ' out' : ''), href: href || '#' }, p.label);
    if (p.newTab === 'yes' && href) { el.target = '_blank'; el.rel = 'noopener'; }
    setStyle(el, { 'background-color': p.look === 'outline' ? '' : colorOf(p.bg), color: colorOf(p.color), 'border-radius': { sharp: '0', soft: '8px', pill: '999px' }[p.corners] || '',
      height: { small: '28px', large: '46px' }[p.size] || '', padding: { small: '0 14px', large: '0 30px' }[p.size] || '', 'font-size': p.size === 'large' ? '12px' : '', 'align-self': p.width === 'full' ? 'stretch' : '' });
    if (p.look === 'outline' && colorOf(p.bg)) el.style.setProperty('box-shadow', 'inset 0 0 0 1px ' + colorOf(p.bg)); return el; }
  if (b.type === 'image' && /^(https:\/\/|\/)/.test(p.src || '')) { const href = safeHref(p.href);
    const img = E('img', { src: p.src, alt: p.alt || '', loading: 'lazy' });
    setStyle(img, { 'border-radius': pxOf(p.radius, 0, 60), 'aspect-ratio': { square: '1 / 1', wide: '16 / 9', portrait: '4 / 5' }[p.aspect] || '', 'object-fit': p.aspect && p.aspect !== 'auto' ? 'cover' : '' });
    const wrap = E('div', { class: 'cb-image' }, href ? E('a', { href }, img) : img);
    setStyle(wrap, { width: { full: '100%', large: '80%', medium: '60%', small: '40%' }[p.width] || '100%' }); return wrap; }
  if (b.type === 'row') { const el = E('div', { class: 'cb-row cb-' + (p.direction === 'column' ? 'col' : 'rowdir') });
    setStyle(el, { 'background-color': colorOf(p.bg), padding: pxOf(p.pad, 0, 80), 'border-radius': pxOf(p.radius, 0, 60), gap: pxOf(p.gap, 0, 80),
      'align-items': { center: 'center', end: 'flex-end' }[p.align] || '' });
    (Array.isArray(b.blocks) ? b.blocks : []).slice(0, 8).forEach((c, k) => { if (!c || c.type === 'row' || !c.props) return; const ce = contentBlock(c, sec); if (ce) { ce.setAttribute('data-cblk', String(k)); el.append(ce); } });
    return el; }
  if (b.type === 'spacer') { const el = E('div', { class: 'cb-spacer', 'aria-hidden': 'true' }); setStyle(el, { height: pxOf(p.height, 4, 200) || '24px' }); return el; }
  return null;
}
const CUSTOM_RENDERERS = {
  featured_collection(s, p) {
    const col = D.collections.find((c) => c.id === p.collection || c.handle === p.collection);
    const count = Math.min(12, Math.max(1, parseInt(p.count, 10) || 4));
    const list = (col ? col.styleIds.map((id) => BYID[id]).filter(Boolean) : newest(count)).slice(0, count);
    if (!list.length) return null;
    const cols = [2, 3, 4].includes(parseInt(p.columns, 10)) ? parseInt(p.columns, 10) : 4;
    const root = E('section', { class: 'custom-section custom-fcol cols-' + cols },
      p.heading || (col && col.name) ? E('h2', null, p.heading || col.name) : null, gridOf(list, false),
      p.button ? E('a', { class: 'btn', href: col ? link('shop?col=' + encodeURIComponent(col.id)) : link('shop') }, p.button) : null);
    return root;
  },
  image_text(s, p) {
    if (!p.image && !p.heading && !p.body) return null;
    const href = safeHref(p.href);
    return E('section', { class: 'custom-section custom-imgtext ' + (p.layout === 'right' ? 'pic-right' : 'pic-left') },
      p.image ? E('div', { class: 'it-pic' }, E('img', { src: p.image, alt: p.heading || '', loading: 'lazy' })) : null,
      E('div', { class: 'it-text' }, p.heading ? E('h2', null, p.heading) : null, p.body ? E('p', null, p.body) : null,
        p.button && href ? E('a', { class: 'btn', href }, p.button) : null));
  },
  faq(s, p) {
    const items = blocksOf(s).filter((b) => b.props.question);
    if (!items.length) return null;
    return E('section', { class: 'custom-section custom-faq' }, p.heading ? E('h2', null, p.heading) : null,
      items.map((b) => E('details', null, E('summary', null, b.props.question), b.props.answer ? E('p', null, b.props.answer) : null)));
  },
  columns(s, p) {
    const items = blocksOf(s).filter((b) => b.props.title || b.props.text);
    if (!items.length) return null;
    return E('section', { class: 'custom-section custom-cols' }, p.heading ? E('h2', null, p.heading) : null,
      E('div', { class: 'cc-grid n' + items.length }, items.map((b) => { const href = safeHref(b.props.href);
        return E('div', { class: 'cc-col' }, b.props.title ? E('h3', null, b.props.title) : null, b.props.text ? E('p', null, b.props.text) : null,
          b.props.link_text && href ? E('a', { href }, b.props.link_text + ' →') : null); })));
  },
  content(s, p) {
    const blocks = blocksOf(s); if (!blocks.length && !PREVIEW) return null;
    const width = ['full', 'wide', 'narrow'].includes(p.width) ? p.width : 'wide', al = ['left', 'right'].includes(p.alignment) ? p.alignment : 'center';
    const root = E('section', { class: 'custom-section custom-content cc-w-' + width + ' cc-a-' + al });
    setStyle(root, { 'background-color': colorOf(p.bg), 'padding-top': pxOf(p.padY, 0, 200), 'padding-bottom': pxOf(p.padY, 0, 200), 'border-radius': pxOf(p.radius, 0, 60), gap: pxOf(p.gap, 0, 80) });
    if (/^(https:\/\/|\/)[-a-zA-Z0-9_.\/:%?=&@~+]+$/.test(p.bgImage || '')) { setStyle(root, { 'background-image': 'url("' + p.bgImage + '")', 'background-size': 'cover', 'background-position': 'center' }); root.classList.add('cc-bgimg'); }
    withAnim(root, p);
    blocks.forEach((b, i) => { const el = contentBlock(b, p); if (el) { el.setAttribute('data-blk', String(i)); root.append(el); } });
    return root;
  },
  newsletter(s, p) {
    const input = E('input', { type: 'email', placeholder: 'Your email', 'aria-label': 'Email address', autocomplete: 'email' });
    const msg = E('p', { class: 'nl-msg', role: 'status' });
    const btn = E('button', { class: 'btn', type: 'submit' }, p.button || 'Sign up');
    const form = E('form', { class: 'nl-form', novalidate: '', onsubmit: async (ev) => {
      ev.preventDefault(); if (PREVIEW) { msg.textContent = 'Preview only. Nothing is saved here.'; return; }
      btn.disabled = true; msg.textContent = '';
      try {
        const r = await rpc('public_sfx_newsletter_subscribe', { p_slug: SLUG, p_email: input.value });
        if (r && r.ok) { form.replaceChildren(E('p', { class: 'nl-thanks' }, p.thanks || 'Thank you. You are on the list.')); }
        else { msg.textContent = (r && r.error) || 'Could not sign you up. Please try again.'; btn.disabled = false; }
      } catch (e) { msg.textContent = 'Could not sign you up. Please try again.'; btn.disabled = false; }
    } }, input, btn);
    return E('section', { class: 'custom-section custom-news' }, p.heading ? E('h2', null, p.heading) : null, p.text ? E('p', { class: 'nl-text' }, p.text) : null, form, msg);
  },
  product_info(s, p) {
    const m = /^#\/p\/([^?\/]+)/.exec(location.hash || ''); const pr = m ? BYID[decodeURIComponent(m[1])] : null;
    const kind = ['description', 'details', 'specs', 'washcare', 'shipping'].includes(p.kind) ? p.kind : 'description';
    const names = { description: 'Description', details: 'Details', specs: 'Specs', washcare: 'Washcare', shipping: 'Shipping and returns' };
    if (!pr) return PREVIEW ? E('section', { class: 'custom-section custom-pi' }, E('span', { class: 'mut' }, 'Shows on the product page: ' + names[kind])) : null;
    const head = p.heading || names[kind]; let body = null;
    if (kind === 'description') body = pr.description ? E('div', null, richNodes(pr.description)) : null;
    else if (kind === 'details') { const b = String(pr.details || '').split(/\n+/).map((x) => x.trim()).filter(Boolean); body = b.length ? E('ul', null, b.map((x) => E('li', null, x))) : null; }
    else if (kind === 'specs') { const rows = [['Brand', pr.brand], ['Fabric', pr.fabric], ['Season', pr.season], ['For', pr.gender], ['Collection', pr.collection], ['Weight', pr.weightG ? pr.weightG + ' g' : ''], ['Code', pr.code]].filter((r) => r[1]); body = rows.length ? E('div', { class: 'pi-rows' }, rows.map((r) => E('div', { class: 'pi-r' }, E('span', { class: 'mut' }, r[0]), E('span', null, String(r[1]))))) : null; }
    else if (kind === 'washcare') body = E('div', null, pr.washcare || 'Wash cold, dry in shade, do not bleach.');
    else body = E('div', null, (cfg().shipping || {}).note || 'We ship across India. Delivery usually takes 3 to 7 days.', ' Returns within ' + (D.shop.returnDays || 30) + ' days of delivery, tags intact.');
    if (!body) return PREVIEW ? E('section', { class: 'custom-section custom-pi' }, E('span', { class: 'mut' }, 'This product has no ' + names[kind].toLowerCase() + '.')) : null;
    return E('section', { class: 'custom-section custom-pi' }, E('h2', null, head), body);
  },
  data_field(s, p) {
    const key = String(p.key || '').trim(); if (!/^[a-z0-9_]{1,40}$/.test(key)) return PREVIEW ? E('section', { class: 'custom-section custom-df' }, E('span', { class: 'mut' }, 'Pick a field key in the settings.')) : null;
    const m = /^#\/p\/([^?\/]+)/.exec(location.hash || ''), c = /[?&]col=([^&]+)/.exec(location.hash || '');
    const owner = m ? ['product', decodeURIComponent(m[1])] : /^#\/shop/.test(location.hash || '') && c ? ['collection', decodeURIComponent(c[1])] : null;
    if (!owner) return PREVIEW ? E('section', { class: 'custom-section custom-df' }, E('span', { class: 'mut' }, 'Shows on product and collection pages: ' + key)) : null;
    const root = E('section', { class: 'custom-section custom-df df-' + (p.layout === 'stacked' ? 'stacked' : 'inline') });
    const show = (label, value, type) => {
      let v = value; if (type === 'boolean' || value === 'true' || value === 'false') v = value === 'true' ? 'Yes' : value === 'false' ? 'No' : value;
      const href = /^https:\/\//.test(value) ? value : '';
      root.append(p.showLabel === 'no' ? null : E('span', { class: 'df-l' }, label), href ? E('a', { class: 'df-v', href, rel: 'noopener' }, value) : E('span', { class: 'df-v' }, v));
    };
    rpc('public_sfx_metafields', { p_slug: SLUG, p_type: owner[0], p_owner: owner[1] }).then((r) => {
      const f = r && r[key];
      if (f && f.value !== '' && f.value != null) show(f.label || key, String(f.value));
      else if (p.fallback) show(p.showLabel === 'no' ? '' : key, p.fallback);
      else if (PREVIEW) show(key, 'No value on this item');
      else root.remove();
    }).catch(() => { if (!PREVIEW) root.remove(); });
    return root;
  },
  links(s, p) {
    const items = blocksOf(s).filter((b) => b.props.label && safeHref(b.props.href));
    if (!items.length) return null;
    return E('section', { class: 'custom-section custom-links' }, p.heading ? E('h3', null, p.heading) : null,
      E('div', { class: 'cl-row' }, items.map((b) => E('a', { href: safeHref(b.props.href) }, b.props.label))));
  },
  gallery(s, p) {
    const items = blocksOf(s).filter((b) => b.props.image);
    if (!items.length) return null;
    return E('section', { class: 'custom-section custom-gallery' }, p.heading ? E('h2', null, p.heading) : null,
      E('div', { class: 'cg-grid' }, items.map((b) => { const href = safeHref(b.props.href);
        const img = E('img', { src: b.props.image, alt: b.props.caption || '', loading: 'lazy' });
        return E('figure', null, href ? E('a', { href }, img) : img, b.props.caption ? E('figcaption', null, b.props.caption) : null); })));
  },
};
// A real appointment-booking widget -- the SAME booking mechanism the Salon Console design
// (app/public/salon/) already uses (public_salon_page/public_salon_slots/public_create_booking, db/132),
// not a second booking system invented for the marketplace. Any tenant with services configured as
// kind='item' records (the same convention Salon Console's own menu management writes) can use a
// 'booking' section on ANY theme, built-in or third-party; a tenant with none configured yet shows a
// plain, honest "no services configured" message instead of a broken or fake-looking form.
function bookingSection(p) {
  const picked = new Set();
  const root = E('section', { class: 'custom-section custom-booking' },
    p.heading ? E('h2', null, p.heading) : E('h2', null, 'Book an appointment'),
    p.note ? E('p', null, p.note) : null);
  const body = E('div', { class: 'booking-body' }, E('p', { class: 'hint' }, 'Loading services…'));
  root.append(body);
  sb.rpc('public_salon_page', { tenant_slug: SLUG }).then(({ data }) => {
    const services = (data?.services || []).filter((s) => s && s.id && s.name);
    if (!services.length) { clear(body).append(E('p', { class: 'hint' }, 'Booking is not set up for this store yet.')); return; }
    const list = E('div', { class: 'booking-services' }, services.map((svc) => E('label', { class: 'booking-service' },
      E('input', { type: 'checkbox', value: svc.id, onchange: (e) => { e.target.checked ? picked.add(svc.id) : picked.delete(svc.id); } }),
      E('span', null, svc.name), svc.price != null ? E('span', { class: 'price' }, inr(svc.price)) : null)));
    const dateInput = E('input', { type: 'date', min: new Date().toISOString().slice(0, 10) });
    const timeSelect = E('select', { disabled: true }, E('option', { value: '' }, 'Pick a date first'));
    const nameInput = E('input', { type: 'text', placeholder: 'Your name', required: true });
    const phoneInput = E('input', { type: 'tel', placeholder: 'Phone number', required: true });
    const status = E('p', { class: 'hint' });
    const submit = E('button', { class: 'btn', type: 'button' }, 'Book');
    dateInput.onchange = async () => {
      timeSelect.disabled = true; clear(timeSelect).append(E('option', { value: '' }, 'Checking times…'));
      if (!dateInput.value) return;
      try {
        const { data: slots, error } = await sb.rpc('public_salon_slots', { tenant_slug: SLUG, p_date: dateInput.value });
        if (error) throw error;
        clear(timeSelect);
        if (!slots || !slots.length) { timeSelect.append(E('option', { value: '' }, 'No times left that day')); return; }
        timeSelect.disabled = false;
        timeSelect.append(E('option', { value: '' }, 'Choose a time'), ...slots.map((s) => E('option', { value: s.time }, s.time + ' · ' + s.left + ' left')));
      } catch (e) { clear(timeSelect).append(E('option', { value: '' }, 'Could not load times')); }
    };
    submit.onclick = async () => {
      status.textContent = '';
      if (!picked.size) { status.textContent = 'Choose at least one service.'; return; }
      if (!dateInput.value || !timeSelect.value) { status.textContent = 'Choose a date and time.'; return; }
      if (!nameInput.value.trim() || !phoneInput.value.trim()) { status.textContent = 'Enter your name and phone number.'; return; }
      submit.disabled = true;
      try {
        await sb.rpc('public_create_booking', { tenant_slug: SLUG, p_name: nameInput.value.trim(), p_phone: phoneInput.value.trim(), p_email: '', p_date: dateInput.value, p_time: timeSelect.value, p_service_ids: [...picked] });
        clear(body).append(E('p', { class: 'hint' }, 'Booked! We’ll confirm your appointment shortly.'));
      } catch (e) { status.textContent = e.message || 'Could not book that slot. Please try again.'; submit.disabled = false; }
    };
    clear(body).append(list, E('div', { class: 'booking-form' }, dateInput, timeSelect, nameInput, phoneInput, submit, status));
  }).catch(() => { clear(body).append(E('p', { class: 'hint' }, 'Booking is not set up for this store yet.')); });
  return root;
}
// Theme editor preview (storefront dashboard): the owner's editor iframes /store.html?preview=draft and sends the
// unsaved draft sections by postMessage, so the canvas updates as they type. Same-origin only; ignored otherwise.
const PREVIEW = new URLSearchParams(location.search).get('preview') === 'draft';
let PREVIEW_SECTIONS = null;
let PREVIEW_LAST = '';
function customEl(s, i, group) {
  if (s && s.props && s.props.hidden === 'yes') return null;
  let el = customSection(s);
  if (el && s.props) { if (s.props.space === 'compact' || s.props.space === 'roomy') el.classList.add('sp-' + s.props.space); if (s.props.align === 'left') el.classList.add('al-left'); }
  if (!el && PREVIEW) el = E('section', { class: 'custom-section custom-empty' }, E('div', { class: 'mut' }, 'Empty section. Fill in its settings.'));
  if (!el) return null;
  if (PREVIEW) {
    el.setAttribute('data-sec', group ? group + ':' + i : String(i)); el.style.cursor = 'pointer';
    // click a heading, text or button that is already selected to type directly on the page
    el.addEventListener('click', (ev) => {
      const bl = ev.target.closest('[data-blk]'); if (!bl) { PREVIEW_LAST = ''; return; }
      const key = (group || '') + ':' + i + ':' + bl.dataset.blk, again = key === PREVIEW_LAST; PREVIEW_LAST = key;
      const b = (s.blocks || [])[Number(bl.dataset.blk)]; const field = b && { heading: 'text', text: 'text', button: 'label' }[b.type];
      if (!again || !field || el.dataset.editing || bl.isContentEditable) return;
      ev.preventDefault(); ev.stopImmediatePropagation(); el.dataset.editing = '1';
      const before = bl.textContent; bl.contentEditable = 'plaintext-only'; bl.style.outline = '2px solid #3b82f6'; bl.focus();
      const done = (save) => { bl.removeEventListener('blur', onBlur); bl.removeEventListener('keydown', onKey); bl.contentEditable = 'false'; bl.style.outline = ''; delete el.dataset.editing; PREVIEW_LAST = '';
        const val = bl.textContent.replace(/\s+$/, ''); if (!save || val === before) { bl.textContent = before; return; }
        parent.postMessage({ type: 'auz-edit', index: i, group: group || '', block: Number(bl.dataset.blk), field, value: val }, location.origin); };
      const onBlur = () => done(true); const onKey = (k) => { if (k.key === 'Escape') { k.preventDefault(); done(false); } else if (k.key === 'Enter' && b.type !== 'text') { k.preventDefault(); bl.blur(); } };
      bl.addEventListener('blur', onBlur); bl.addEventListener('keydown', onKey);
    }, true);
    el.addEventListener('click', (ev) => { if (ev.target.closest('a,button,input,select')) ev.preventDefault(); ev.stopPropagation(); const bl = ev.target.closest('[data-blk]'); const cb = ev.target.closest('[data-cblk]'); const tg = cb && bl && bl.contains(cb) ? cb : bl, rc = tg ? tg.getBoundingClientRect() : null; parent.postMessage({ type: 'auz-select', index: i, group: group || '', rect: rc ? { x: rc.left, y: rc.top, w: rc.width, h: rc.height } : null, block: bl ? Number(bl.dataset.blk) : -1, child: cb && bl && bl.contains(cb) ? Number(cb.dataset.cblk) : -1 }, location.origin); }, true);
  }
  return el;
}
function customSections(v, list) {
  const sections = list || (PREVIEW && PREVIEW_SECTIONS ? PREVIEW_SECTIONS : (cfg().customSections || []));
  sections.forEach((s, i) => { const el = customEl(s, i); if (el) v.append(el); });
}
// Page templates (db/453): the Collection, Product and Cart pages can have sections above and below their own content.
// The list holds one "main" entry (the page's own content); without one the sections go after it.
// Global design settings (db/455): colours, corner shape, button style, font and spacing for the whole store, as CSS variables and body classes.
let PREVIEW_DESIGN = null;
const DESIGN_RADII = { sharp: [0, 0, 0], soft: [14, 10, 6], round: [32, 24, 16] };
const DESIGN_SPACE = { compact: '10px', normal: '14px', roomy: '20px' };
const hexLum = (h) => { const m = /^#([0-9a-f]{6})$/i.exec(h || ''); if (!m) return 0; const c = [0, 2, 4].map((i) => { const v = parseInt(m[1].slice(i, i + 2), 16) / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
function applyDesign(d) {
  d = d && typeof d === 'object' ? d : {};
  const st = document.documentElement.style;
  ['--bg', '--card', '--ink', '--accent', '--on-ink', '--on-accent', '--r1', '--r2', '--r3', '--pad', '--mut', '--sale', '--badge', '--on-badge'].forEach((k) => st.removeProperty(k));
  [...document.body.classList].filter((c) => /^d-/.test(c)).forEach((c) => document.body.classList.remove(c));
  // Studs draws every page (including the shared checkout it frames) in its own fixed palette and never
  // reads these document-level design tokens; Kaarigari's shadow-scoped styles are self-contained but the
  // shared checkout/account pages it frames DO use these tokens, same as Minimal, so only Studs opts out here.
  if (cfg().template === 'studs') return;
  const hex = (k) => (/^#[0-9a-f]{6}$/i.test(d[k] || '') ? d[k] : '');
  if (hex('bg')) st.setProperty('--bg', d.bg);
  if (hex('card')) st.setProperty('--card', d.card);
  if (hex('ink')) { st.setProperty('--ink', d.ink); st.setProperty('--on-ink', hexLum(d.ink) > 0.5 ? '#0c0c0c' : '#ffffff'); }
  if (hex('accent')) { st.setProperty('--accent', d.accent); st.setProperty('--on-accent', hexLum(d.accent) > 0.5 ? '#0c0c0c' : '#ffffff'); }
  if (DESIGN_RADII[d.radius]) DESIGN_RADII[d.radius].forEach((r, i) => st.setProperty('--r' + (i + 1), r + 'px'));
  if (DESIGN_SPACE[d.spacing] && d.spacing !== 'normal') st.setProperty('--pad', DESIGN_SPACE[d.spacing]);
  if (d.buttons === 'accent' || d.buttons === 'outline') document.body.classList.add('d-btn-' + d.buttons);
  if (['pill', 'soft', 'square'].includes(d.buttonShape)) document.body.classList.add('d-bs-' + d.buttonShape);
  if (['serif', 'humanist', 'mono'].includes(d.font)) document.body.classList.add('d-font-' + d.font);
  if (hex('muted')) st.setProperty('--mut', d.muted);
  if (hex('sale')) st.setProperty('--sale', d.sale);
  if (hex('badgeColor')) { st.setProperty('--badge', d.badgeColor); st.setProperty('--on-badge', hexLum(d.badgeColor) > 0.5 ? '#0c0c0c' : '#ffffff'); }
  ['headingCase', 'headingWeight', 'buttonCase', 'buttonSize', 'cardRatio', 'cardAlign', 'cardAdd', 'cardFit', 'badgeShape', 'priceWeight', 'priceSize', 'inputStyle', 'iconWeight', 'swatchShape', 'sizeShape', 'cardHover', 'pageFade'].forEach((k) => { if (/^[a-z]+$/.test(d[k] || '') && d[k] !== 'default') document.body.classList.add('d-' + k + '-' + d[k]); });
}
// Shared header and footer groups (db/456): sections shown on every page, the header group at the top and the footer group at the bottom.
let PREVIEW_GROUPS = null;
function groupSections(kind) {
  const g = PREVIEW && PREVIEW_GROUPS ? PREVIEW_GROUPS[kind] : (cfg().themeGroups || {})[kind];
  return g && Array.isArray(g.sections) ? g.sections : [];
}
function applyGroups(id, view) {
  if (id === 'checkout') return;
  const top = groupSections('header'), bottom = groupSections('footer'); if (!top.length && !bottom.length) return;
  const first = view.firstChild;
  top.forEach((x, i) => { const el = customEl(x, i, 'header'); if (el) view.insertBefore(el, first); });
  bottom.forEach((x, i) => { const el = customEl(x, i, 'footer'); if (el) view.append(el); });
}
let PREVIEW_TPL = null;
const TEMPLATE_OF = { shop: 'collection', p: 'product', bag: 'cart' };
function templateSections(kind) {
  const t = PREVIEW && PREVIEW_TPL ? PREVIEW_TPL[kind] : (cfg().themeTemplates || {})[kind];
  return t && Array.isArray(t.sections) ? t.sections : null;
}
function applyTemplate(id, view) {
  const kind = TEMPLATE_OF[id]; const list = kind ? templateSections(kind) : null; if (!list || !list.length) return;
  const ownContent = [...view.childNodes]; const mainAt = list.findIndex((x) => x.type === 'main');
  const before = [], after = [];
  list.forEach((x, i) => { if (x.type === 'main') return; const el = customEl(x, i); if (el) (mainAt >= 0 && i < mainAt ? before : after).push(el); });
  const first = ownContent[0] || null;
  before.forEach((el) => view.insertBefore(el, first));
  after.forEach((el) => view.append(el));
}
if (PREVIEW) {
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || !e.data || e.data.type !== 'auz-draft' || !Array.isArray(e.data.sections)) return;
    PREVIEW_SECTIONS = e.data.sections.slice(0, 60);
    if (e.data.templates && typeof e.data.templates === 'object') PREVIEW_TPL = e.data.templates;
    if (e.data.groups && typeof e.data.groups === 'object') PREVIEW_GROUPS = e.data.groups;
    if (e.data.design && typeof e.data.design === 'object') { PREVIEW_DESIGN = e.data.design; applyDesign(PREVIEW_DESIGN); }
    const chrome = JSON.stringify({ h: e.data.header, f: e.data.footer, p: e.data.pages, t: e.data.templates, g: e.data.groups });
    const chromeChanged = chrome !== (PREVIEW_CHROME && PREVIEW_CHROME.__j);
    if (e.data.header !== undefined || e.data.footer !== undefined || e.data.pages !== undefined) PREVIEW_CHROME = { header: e.data.header || null, footer: e.data.footer || null, pages: Array.isArray(e.data.pages) ? e.data.pages : [], __j: chrome };
    const want = '#/' + (e.data.view || '');
    if (e.data.view !== undefined && (location.hash || '#/') !== want && !(want === '#/' && (location.hash === '' || location.hash === '#'))) { location.hash = want; return; }
    if (typeof route === 'function' && typeof shell === 'function' && chromeChanged && D) { const y = scrollY; shell(); route(); scrollTo(0, y); return; }
    if (typeof route === 'function' && (!location.hash || /^#\/?$/.test(location.hash))) { const y = scrollY; route(); scrollTo(0, y); }
  });
  window.addEventListener('message', (e) => { if (e.origin === location.origin && e.data && e.data.type === 'auz-highlight') { document.querySelectorAll('.custom-section.sel,.blk-sel').forEach((n) => n.classList.remove('sel', 'blk-sel')); const n = document.querySelector('[data-sec="' + (e.data.group === 'header' || e.data.group === 'footer' ? e.data.group + ':' : '') + Number(e.data.index) + '"]'); if (n) { n.classList.add('sel'); const bn = Number.isInteger(e.data.block) && e.data.block >= 0 ? n.querySelector('[data-blk="' + e.data.block + '"]') : null; if (bn) { bn.classList.add('blk-sel'); } if (e.data.scroll) (bn || n).scrollIntoView({ block: 'center', behavior: 'smooth' }); } } });
  setTimeout(() => { try { parent.postMessage({ type: 'auz-ready' }, location.origin); } catch (err) { /* not in a frame */ } }, 0);
  window.addEventListener('load', () => { try { parent.postMessage({ type: 'auz-ready' }, location.origin); } catch (err) { /* not in a frame */ } });
}
V.home = (v) => {
  if (isMin()) {
    minimalHome(v);
    return customSections(v);
  }
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
    v.append(E('a', { class: 'bigcol', href: link('shop?col=' + x.id) }, E('img', { src: pic, alt: '', loading: 'eager' }), E('div', { class: 'cap' }, E('div', { class: 't' }, x.name), E('span', { class: 'btn' }, 'Shop now'))));
  });
  // 4. products again
  if (STY.length > 4) v.append(E('section', { class: 'sec' }, E('div', { class: 'hd' }, E('span', { class: 'lbl' }, 'All products'), E('a', { class: 'btn sm out', href: link('shop') }, 'Shop all')), gridOf(STY.slice(0, 12), true)));
  // 5. stores
  if ((c.stores || []).length) v.append(E('section', { class: 'sec' }, E('div', { class: 'hd' }, E('span', { class: 'lbl' }, 'Visit us'), E('a', { class: 'btn sm out', href: link('stores') }, 'All stores')), storeCards(c.stores)));
  customSections(v);
};

function facetValues(value) {
  try {
    const values = JSON.parse(value || '[]');
    return Array.isArray(values) ? values.filter((item) => typeof item === 'string') : [];
  } catch { return []; }
}
function filterSet(q) {
  let list = STY.slice();
  if (isMin() && Object.hasOwn(minimalCategoryGroups, q.group)) list = minimalGroupProducts(q.group, list);
  if (q.cat) list = list.filter((s) => s.category === q.cat);
  if (q.tag) list = list.filter((s) => (s.tags || []).includes(q.tag));
  if (q.col) { const cl = D.collections.find((x) => x.id === q.col); list = cl ? list.filter((s) => cl.styleIds.includes(s.id)) : []; }
  if (q.colour) list = list.filter((s) => colours(s).includes(q.colour));
  if (q.fam) list = list.filter((s) => colours(s).some((c) => famOf(c) === q.fam));
  if (q.size) list = list.filter((s) => s.variants.some((x) => x.size === q.size &&
    (!q.colour || !isMin() || x.colour === q.colour) &&
    (q.stock === 'sold-out' || x.left > 0)));
  if (isMin()) {
    const sizes = facetValues(q.sizes), selectedColours = facetValues(q.colours);
    if (sizes.length || selectedColours.length) list = list.filter((style) => style.variants.some((variant) =>
      (!sizes.length || sizes.includes(variant.size)) && (!selectedColours.length || selectedColours.includes(variant.colour)) &&
      (q.stock !== '1' || variant.left > 0)));
  }
  if (q.gender) list = list.filter((s) => (s.gender || '').toLowerCase() === q.gender.toLowerCase());
  if (q.min) list = list.filter((s) => s.price >= +q.min);
  if (q.max) list = list.filter((s) => s.price <= +q.max);
  if (q.stock === 'sold-out') list = list.filter(isGone);
  else if (q.stock) list = list.filter((s) => !isGone(s));
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
  const allSizes = [...new Set(STY.flatMap(sizesOf))]; const allCols = [...new Set(STY.flatMap(colours))]; const cats = [...new Set(STY.map((s) => s.category).filter(Boolean))]; const allTags = [...new Set(STY.flatMap((s) => s.tags || []))].sort();
  const paint = () => {
    clear(body);
    const pick = (key, val) => { draft[key] = draft[key] === val ? '' : val; if (key === 'size') delete draft.sizes; if (key === 'colour') { delete draft.colours; delete draft.fam; } paint(); };
    body.append(
      E('div', { class: 'fgrp' }, E('span', { class: 'lbl' }, 'Sort'), E('div', { class: 'fwrap' }, [['new', 'Newest'], ['low', 'Price low'], ['high', 'Price high'], ['az', 'A to Z']].map(([k, l]) => E('button', { class: 'sz' + ((draft.sort || 'new') === k ? ' on' : ''), onclick: () => { draft.sort = k; paint(); } }, l)))),
      cats.length > 1 ? E('div', { class: 'fgrp' }, E('span', { class: 'lbl' }, 'Type'), E('div', { class: 'fwrap' }, cats.map((c) => E('button', { class: 'sz' + (draft.cat === c ? ' on' : ''), onclick: () => pick('cat', c) }, c)))) : null,
      allTags.length ? E('div', { class: 'fgrp' }, E('span', { class: 'lbl' }, 'Tag'), E('div', { class: 'fwrap' }, allTags.map((t) => E('button', { class: 'sz' + (draft.tag === t ? ' on' : ''), onclick: () => pick('tag', t) }, t)))) : null,
      allSizes.length ? E('div', { class: 'fgrp' }, E('span', { class: 'lbl' }, 'Size'), E('div', { class: 'fwrap' }, allSizes.map((z) => E('button', { class: 'sz' + (draft.size === z ? ' on' : ''), onclick: () => pick('size', z) }, z)))) : null,
      allCols.length ? E('div', { class: 'fgrp' }, E('span', { class: 'lbl' }, 'Colour'), E('div', { class: 'fwrap' }, allCols.map((c) => E('button', { class: 'sz cl' + (draft.colour === c ? ' on' : ''), onclick: () => pick('colour', c) }, E('span', { class: 'c', style: { background: hex(c) } }), c)))) : null,
      E('div', { class: 'fgrp' }, E('span', { class: 'lbl' }, 'Budget'), (() => { const mn = E('input', { type: 'range', min: lo, max: hi, value: draft.min || lo, step: 100 }), mx = E('input', { type: 'range', min: lo, max: hi, value: draft.max || hi, step: 100 }); const rv = E('div', { class: 'rv' }); const up = () => { if (+mn.value > +mx.value) mn.value = mx.value; draft.min = +mn.value > lo ? mn.value : ''; draft.max = +mx.value < hi ? mx.value : ''; rv.textContent = ''; add(rv, [E('span', null, inr(mn.value)), E('span', null, inr(mx.value))]); live(); }; mn.oninput = up; mx.oninput = up; up(); return E('div', { class: 'range' }, rv, mn, mx); })()),
      E('button', { class: 'tgl' + (draft.stock === '1' ? ' on' : ''), style: { width: '100%' }, onclick: () => { draft.stock = draft.stock === '1' ? '' : '1'; paint(); } }, E('span', null, 'Only what is in stock'), E('i')));
    live();
  };
  paint();
  const foot = E('div', { class: 'rf' }, showBtn, E('button', { class: 'rclr', onclick: () => { sh.close(); if (isMin()) setQ({ tag: '', cat: '', size: '', sizes: '', colour: '', colours: '', fam: '', min: '', max: '', sort: '', stock: '', gender: '' }); else location.hash = '#/shop'; } }, 'Clear all'));
  const sh = sheet('Filter', body, foot); sh.el.querySelector('.sheet').classList.add('refine');
  sh.el.setAttribute('aria-label', 'Filter products');
  sh.el.addEventListener('keydown', (event) => { if (event.key === 'Escape') { sh.close(); anchor?.focus(); } });
  if (anchor && anchor.getBoundingClientRect && matchMedia('(min-width: 900px)').matches) { const r = anchor.getBoundingClientRect(), hd = document.querySelector('header, .nav, .hdr'), hb = hd ? Math.max(0, hd.getBoundingClientRect().bottom) : 56, W = Math.min(740, innerWidth - 32), left = Math.max(16, Math.min(r.right + 24 - W, innerWidth - W - 16)), top = Math.min(r.top - 10, hb + 12), card = sh.el.querySelector('.sheet'); sh.el.classList.add('pop'); card.style.cssText = 'left:' + left + 'px;top:' + Math.max(hb + 6, top) + 'px;width:' + W + 'px;max-height:' + Math.max(300, innerHeight - hb - 24) + 'px;transform-origin:' + (r.left + r.width / 2 - left) + 'px ' + (r.top + r.height / 2 - Math.max(hb + 6, top)) + 'px'; }
  showBtn.onclick = () => { sh.close(); const q = { ...draft }; for (const k in q) if (!q[k]) delete q[k]; location.hash = '#/shop' + (Object.keys(q).length ? '?' + new URLSearchParams(q).toString() : ''); };
}
function pagedGrid(list, withBlanks = true, categoryTile = null) {
  let n = 24; const host = E('div');
  const paint = () => { const grid = gridOf(list.slice(0, n), withBlanks);
    if (categoryTile) grid.insertBefore(categoryTile, grid.children[3] || null);
    clear(host).append(grid, n < list.length ? E('div', { style: { textAlign: 'center', padding: '18px' } }, E('button', { class: 'btn out', onclick: () => { n += 24; paint(); } }, 'Show more · ' + (list.length - n) + ' left')) : null); };
  paint(); return host;
}
V.shop = (v) => {
  const q = q$(); const list = filterSet(q); const cols = D.collections;
  const act = []; const lab = { tag: 'Tag', cat: 'Type', colour: 'Colour', fam: 'Colour', size: 'Size', gender: '', stock: 'In stock', new: 'New in' };
  let dens = false; try { dens = localStorage.getItem('st.dens') === '1'; } catch (x) {}
  const gw = E('div', { class: 'gw' + (dens ? ' dense' : '') });
  const colName = q.col ? (cols.find((x) => x.id === q.col) || {}).name : '';
  const groupName = isMin() && Object.hasOwn(minimalCategoryGroups, q.group) ? minimalCategoryGroups[q.group].label : '';
  const title = colName || q.cat || groupName || (q.new ? 'New arrivals' : 'All products');
  for (const k of ['tag', 'cat', 'colour', 'fam', 'size', 'gender', 'stock', 'new', 'min', 'max']) if (q[k]) act.push([k, k === 'stock' ? (q[k] === 'sold-out' ? 'Out of stock' : 'In stock') : k === 'new' ? 'New in' : k === 'min' ? 'From ' + inr(q[k]) : k === 'max' ? 'Up to ' + inr(q[k]) : (lab[k] ? lab[k] + ': ' : '') + q[k]]);
  if (q.col) act.push(['col', colName || 'Collection']);
  if (groupName) act.push(['group', groupName]);
  if (isMin()) {
    const selectedSizes = facetValues(q.sizes), selectedColours = facetValues(q.colours);
    if (selectedSizes.length) act.push(['sizes', 'Size: ' + selectedSizes.join(', ')]);
    if (selectedColours.length) act.push(['colours', 'Colour: ' + selectedColours.join(', ')]);
    const categories = [...new Set(STY.map((style) => style.category).filter(Boolean))];
    const catalog = E('section', { class: 'minimal-catalog' });
    const compact = E('button', { class: 'minimal-view-toggle', type: 'button', 'aria-label': 'Compact product grid',
      title: 'Compact product grid', onclick: () => applyDensity(!catalog.classList.contains('minimal-compact')) });
    function applyDensity(on) {
      catalog.classList.toggle('minimal-compact', on);
      compact.setAttribute('aria-pressed', String(on));
      compact.replaceChildren(icon(on ? 'big' : 'dense'));
      LS.set('compact-products', on);
    }
    applyDensity(LS.get('compact-products', false) === true);
    catalog.append(
      E('div', { class: 'minimal-heading' }, E('div', null, E('h1', null, title), E('span', { class: 'mut' }, list.length + (list.length === 1 ? ' product' : ' products'))),
        E('div', { class: 'minimal-section-actions' }, compact,
          E('button', { class: 'minimal-filter-button', type: 'button', onclick: (event) => refine(event.currentTarget) }, 'Advanced filters'))),
      E('nav', { class: 'minimal-category-nav', 'aria-label': 'Product categories' },
        E('a', { href: link('shop'), 'aria-current': !q.cat && !q.col && !q.new && !groupName ? 'page' : null }, 'View all'),
        categories.map((category) => E('a', { href: link('shop?cat=' + encodeURIComponent(category)),
          'aria-current': q.cat === category ? 'page' : null }, category))),
      act.length ? E('div', { class: 'chips' }, act.map(([key, label]) => E('button', {
        class: 'chip on', type: 'button', onclick: () => setQ({ [key]: '' }),
      }, label, ' ×'))) : null,
      list.length ? pagedGrid(list, false, list.length > 3 && categories.length ? E('div', { class: 'minimal-category-tile' },
        [...new Set(list.map((item) => item.category).filter(Boolean))].slice(0, 2).map((category) =>
          E('a', { href: link('shop?cat=' + encodeURIComponent(category)) }, category))) : null) : E('div', { class: 'empty' }, E('h2', null, 'No products match'), E('a', { class: 'btn', href: link('shop') }, 'Clear filters')));
    v.append(catalog);
    return;
  }
  v.append(E('div', { class: 'crumbs' }, E('a', { href: link('') }, 'Home'), ' / ', title),
    E('div', { class: 'shophd' }, E('div', null, E('h1', null, title), E('div', { class: 'mut tiny' }, list.length + (list.length === 1 ? ' piece' : ' pieces'))), E('div', { class: 'shact' }, E('button', { class: 'btn soft icb', 'aria-label': 'Picture view', title: 'Picture view', onclick: (e) => { const on = !gw.classList.contains('dense'); gw.classList.toggle('dense', on); gw.classList.add('flip'); setTimeout(() => gw.classList.remove('flip'), 320); try { localStorage.setItem('st.dens', on ? '1' : '0'); } catch (x) {} e.currentTarget.replaceChildren(icon(on ? 'big' : 'dense')); } }, icon(dens ? 'big' : 'dense')), E('button', { class: 'btn soft', onclick: (e) => refine(e.currentTarget) }, icon('filter'), 'Refine'))),
    act.length ? E('div', { class: 'chips' }, act.map(([k, l]) => E('button', { class: 'chip on', onclick: () => setQ({ [k]: '' }) }, l, E('span', { class: 'x' }, '×')))) : null,
    !act.length && [...new Set(STY.map((s) => s.category))].length > 1 ? E('div', { class: 'chips' }, [...new Set(STY.map((s) => s.category).filter(Boolean))].map((c) => E('button', { class: 'chip', onclick: () => setQ({ cat: c }) }, c))) : null,
    (q.cat || list.length === STY.length) ? stack(list, q.cat ? q.cat : 'All products') : null,
    list.length ? (gw.append(pagedGrid(list)), gw) : E('div', { class: 'empty' }, E('h2', null, 'Nothing matches'), E('div', { class: 'mut' }, 'Try removing a filter.'), E('a', { class: 'btn', href: link('shop') }, 'Clear filters')));
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
  let s = BYID[id];
  // storefront stores: an address with a product handle works, and an old handle follows the owner's redirect to the new one
  if (!s && PFX === 'sfx') {
    const byHandle = STY.find((x) => x.handle && String(x.handle).toLowerCase() === String(id).toLowerCase());
    if (byHandle) { location.replace(link('p/' + byHandle.id)); return; }
    rpc('public_sfx_redirect', { p_slug: SLUG, p_path: '/products/' + id }).then((r) => {
      if (!r || !r.to) return;
      const m = String(r.to).match(/^\/products\/([^/?#]+)/); const t = m && STY.find((x) => x.handle === m[1] || x.id === m[1]);
      if (t) location.replace(link('p/' + t.id)); else if (/^https:\/\//.test(r.to)) location.href = r.to;
    }).catch(() => {});
  }
  if (!s) { v.append(E('div', { class: 'empty' }, E('h2', null, 'Piece not found'), E('a', { class: 'btn', href: link('shop') }, 'Shop all'))); return; }
  const minimal = isMin();
  const modelOptions = minimal && /phone case/i.test(s.category || '');
  const hasSizeGuide = !minimal || sizesOf(s).some((size) => /^(?:X{0,3}[SL]|M|[2-5]XL)$/i.test(size));
  let colour = colours(s)[0] || '', size = '', qty = 1; let tab = 'd'; let folded = false, pinned = false; seen(s.id);
  if (PFX === 'sfx' && s.handle) rpc('public_sfx_seo', { p_slug: SLUG, p_kind: 'product', p_handle: s.handle }).then((r) => { if (r && r.title && location.hash.includes(s.id)) setMeta(r.title + ' · ' + (r.siteName || D.shop.name), r.description || '', photos(s)[0] || '', location.origin + location.pathname + '#/p/' + s.id); }).catch(() => {});
  const gal = E('div', { class: 'gal' }), info = E('div', { class: 'info' });
  const pinnedPhoto = minimal ? E('div', { class: 'minimal-pinned-photo' }) : null;
  let cur = 0;
  const paintGal = () => {
    const ims = minimal ? minimalPhotosFor(s, colour) : photosFor(s, colour);
    clear(gal); gal.classList.toggle('solo', ims.length <= 1); gal.classList.remove('multi');
    if (minimal) {
      const primary = ims[0];
      clear(pinnedPhoto).append(ims.length > 1 ? E('img', { src: primary, alt: s.name + ' — main image', loading: 'eager' }) : null);
      pinnedPhoto.hidden = ims.length < 2;
      gal.parentElement?.classList.toggle('minimal-single-photo', ims.length < 2);
      gal.append(E('div', { class: 'minimal-product-gallery', tabindex: ims.length > 1 ? '0' : null, 'aria-label': 'Product images' }, ims.length ? ims.map((url, index) =>
        E('img', { class: !index && ims.length > 1 ? 'minimal-mobile-primary' : null,
          src: url, alt: s.name + ' — image ' + (index + 1), loading: index > 1 ? 'lazy' : 'eager' })) : placeholder(s.name)));
      return;
    }
    if (!ims.length) { gal.append(E('div', { class: 'main' }, placeholder(s.name))); return; }
    const main = E('div', { class: 'main', style: { '--bgi': 'url("' + (ims[cur] || ims[0]) + '")' } }, E('img', { src: ims[cur] || ims[0], alt: s.name }), E('div', { class: 'ct' }, (cur + 1) + ' / ' + ims.length));
    const rail = E('div', { class: 'rail' }, ims.map((u, i) => E('button', { class: 'th' + (i === cur ? ' on' : ''), 'aria-label': 'Picture ' + (i + 1), onclick: () => { cur = i; paintGal(); } }, E('img', { src: u, alt: '', loading: 'lazy' }))));
    if (ims.length > 1) {
      // phones: swipe through the pictures with dots; desktop keeps the thumbnail column
      const ct = main.querySelector('.ct'), dots = E('div', { class: 'dots3' }, ims.map((_, i) => E('i', { class: i === cur ? 'on' : '' })));
      const swp = E('div', { class: 'swp' }, ims.map((u, k) => E('img', { src: u, alt: s.name, loading: k < 2 ? 'eager' : 'lazy' })));
      swp.addEventListener('scroll', () => { const i = Math.max(0, Math.min(ims.length - 1, Math.round(swp.scrollLeft / (swp.clientWidth || 1)))); if (i === cur) return; cur = i; ct.textContent = (i + 1) + ' / ' + ims.length; [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i)); rail.querySelectorAll('.th').forEach((b, k) => b.classList.toggle('on', k === i)); }, { passive: true });
      main.append(swp, dots);
      const pgrid = E('div', { class: 'pgrid' + (ims.length % 2 ? ' odd' : '') }, ims.map((u) => E('div', { class: 'gi' }, E('img', { src: u, alt: s.name, loading: 'lazy' }))));
      gal.classList.add('multi'); gal.append(main, rail, pgrid);
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
    return E('div', { class: 'dtl' }, bullets.length ? E('div', null, E('h3', null, 'Details'), E('ul', null, bullets.map((b) => E('li', null, b)))) : null, s.description ? E('div', null, E('h3', null, 'Description'), E('div', null, richNodes(s.description))) : null, rows.length ? E('dl', null, rows.flatMap(([k, val]) => [E('dt', null, k), E('dd', null, val)])) : null,
      !bullets.length && !s.description && !rows.length ? E('div', { class: 'mut' }, 'More details coming soon.') : null);
  };
  const details = minimal ? E('section', { class: 'minimal-product-details', 'aria-label': 'Product information' }) : null;
  if (details) {
    const body = E('div', { class: 'minimal-detail-body', 'aria-live': 'polite' }, dtl('d'));
    const tabs = [['d', 'Details & Description'], ['w', 'Washcare'], ['s', 'Shipping']].map(([key, label]) =>
      E('button', { type: 'button', 'aria-pressed': String(key === 'd'), onclick: (event) => {
        tabs.forEach((button) => button.setAttribute('aria-pressed', String(button === event.currentTarget)));
        clear(body).append(dtl(key));
      } }, label));
    details.append(E('div', { class: 'minimal-detail-tabs', role: 'group', 'aria-label': 'Product detail sections' }, tabs), body);
  }
  const paintInfo = () => {
    clear(info);
    const vs = s.variants.filter((x) => !colour || x.colour === colour); const gone = isGone(s);
    const chosen = s.variants.find((x) => (!colour || x.colour === colour) && x.size === size) || (!sizesOf(s).length ? vs[0] : null);
    const displayedPrice = minimal ? chosen?.price ?? vs[0]?.price ?? s.price : s.price;
    const discount = discPct({ ...s, price: displayedPrice });
    info.append(
      E('div', null, E('div', { class: 'nm' }, E('span', null, s.name), E('button', { class: 'ic', 'aria-label': 'Save', onclick: () => { toggleWish(s.id); paintInfo(); } }, E('span', { style: { display: 'contents' } }, icon('mark')))),
        E('div', { class: 'pr' }, inr(displayedPrice), discount > 0 ? [E('s', null, inr(s.mrp)), E('b', null, discount + '% off')] : null)),
      colours(s).length ? E('div', { class: 'fx' }, E('span', { class: 'lbl' }, 'Colour · ' + colour), E('div', { class: 'dots2', style: { marginTop: '8px' } }, colours(s).map((c) => E('button', { class: c === colour ? 'on' : '', 'aria-label': c, onclick: () => { colour = c; size = ''; cur = 0; paintGal(); paintInfo(); } }, E('span', { class: 'c', style: { background: hex(c) } }))))) : null,
      sizesOf(s).length ? E('div', { class: 'fx' }, E('div', { style: { display: 'flex', justifyContent: 'space-between' } }, E('span', { class: 'lbl' }, modelOptions ? 'Model' : 'Size'), hasSizeGuide ? E('button', { class: 'tiny', style: { textDecoration: 'underline', color: 'var(--mut)' }, onclick: sizeGuide }, 'Size guide') : null),
        E('div', { class: 'fwrap', style: { marginTop: '8px' } }, vs.map((x) => E('button', { class: 'sz' + (x.size === size ? ' on' : '') + (x.left < 1 ? ' off' : ''), onclick: () => { size = x.size; if (x.image) { const gi = (minimal ? minimalPhotosFor(s, colour) : photosFor(s, colour)).indexOf(x.image); if (gi >= 0) { cur = gi; paintGal(); } } paintInfo(); } }, x.size)))) : null,
      chosen && chosen.left > 0 && chosen.left <= 3 ? E('div', { class: 'left fx' }, 'Only ' + chosen.left + ' left in this size') : null,
      gone ? E('div', { class: 'note fx' }, 'This piece is sold out right now.') : E('div', { class: 'fx', style: { display: 'flex', alignItems: 'center', gap: '10px' } }, E('span', { class: 'lbl' }, 'Qty'), E('div', { class: 'qty' }, E('button', { onclick: () => { qty = Math.max(1, qty - 1); paintInfo(); } }, '–'), E('span', null, qty), E('button', { onclick: () => { qty = Math.min(chosen ? (chosen.left >= 9 ? 20 : chosen.left) : 9, qty + 1); paintInfo(); } }, '+'))),
      E('div', { class: 'row2' }, E('button', { class: 'btn out', disabled: gone || (chosen && chosen.left < 1), onclick: () => {
        if (need(chosen) && addBag(chosen.id, qty) && isMin()) openMinimalBag();
      } }, 'Add to bag'), E('button', { class: 'btn', disabled: gone || (chosen && chosen.left < 1), onclick: () => {
        if (need(chosen) && addBag(chosen.id, qty)) go('checkout');
      } }, 'Buy now')),
      minimal || (templateSections('product') || []).some((x) => x.type === 'product_info' && (x.props || {}).hidden !== 'yes') ? null : E('div', { class: 'tabs2 fx' }, E('div', { class: 'tr' }, [['d', 'Details & Description'], ['w', 'Washcare'], ['s', 'Shipping']].map(([k, l]) => E('button', { class: k === tab ? 'on' : '', onclick: () => { tab = k; paintInfo(); } }, l))), E('div', { class: 'tb' }, dtl(tab))),
      E('div', { class: 'row2 fx' }, E('button', { class: 'btn out sm', onclick: share }, 'Share'), gone ? E('button', { class: 'btn out sm', onclick: notify }, 'Notify me') : null),
      E('button', { class: 'unfold', onclick: () => { pinned = true; folded = false; info.classList.remove('fold'); } }, 'Show size, colour and details'));
  };
  const need = (c) => { if (!c) { toast(modelOptions ? 'Please choose a phone model' : 'Please choose a size'); return false; } return true; };
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
      E('button', { class: 'btn wide', onclick: async (e) => { e.target.disabled = true; try { await rpc(`public_${PFX}_notify_me`, { p_slug: SLUG, p: { variantId: vsel.value, phone: ph.value, name: ((LS.get('me', {}) || {}).first) || '' } }); sh.close(); toast('Done. We will message you.'); } catch (er) { msg.textContent = er.message; e.target.disabled = false; } } }, 'Notify me')));
  }
  paintGal(); paintInfo();
  try { document.querySelectorAll('script[data-ld]').forEach((x) => x.remove()); const ld = document.createElement('script'); ld.type = 'application/ld+json'; ld.dataset.ld = '1'; ld.textContent = JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name: s.name, image: photos(s).slice(0, 4), description: plain(s.description) || s.name, brand: s.brand ? { '@type': 'Brand', name: s.brand } : undefined, sku: s.code || undefined, offers: { '@type': 'Offer', priceCurrency: 'INR', price: s.price, availability: isGone(s) ? 'https://schema.org/OutOfStock' : 'https://schema.org/InStock' } }); document.head.append(ld); } catch (e) { /* no JSON-LD */ }
  let more = minimal ? minimalRelatedProducts(s)
    : STY.filter((x) => x.id !== s.id && (x.category === s.category || (s.collection && x.collection === s.collection))).slice(0, 8);
  if (!minimal && more.length < 4) { const have = new Set(more.map((x) => x.id)); more = more.concat(newest(STY.length).filter((x) => x.id !== s.id && !have.has(x.id))).slice(0, Math.max(4, more.length)); }
  const destination = link('shop?cat=' + encodeURIComponent(s.category));
  const related = more.length ? minimal
    ? minimalRecommendations('You may also like', more, destination)
    : E('section', { class: 'band' }, E('div', { class: 'hd' }, E('h2', null, 'Products you may like'), E('a', { class: 'btn sm', href: destination }, 'Discover more')), E('div', { class: 'row' }, more.map((x) => card(x))))
    : null;
  const viewed = minimal ? recent().filter((id) => id !== s.id).map((id) => BYID[id]).filter(Boolean) : [];
  const product = E('div', { class: minimal ? 'pd minimal-pd' + (pinnedPhoto.hidden ? ' minimal-single-photo' : '') : 'pd' },
    pinnedPhoto, gal, minimal ? E('aside', { class: 'minimal-purchase-panel', 'aria-label': 'Product details and purchase' }, info, details) : info);
  v.append(minimal ? null : E('div', { class: 'crumbs' }, E('a', { href: link('') }, 'Home'), ' / ', E('a', { href: destination }, s.category), ' / ', s.name),
    product, related,
    minimal ? (viewed.length ? minimalRecommendations('Recently viewed', viewed) : null) : recentBand(s.id));
  rpc(`public_${PFX}_reviews`, { p_slug: SLUG, p_style: s.id }).then((rv) => { if (!rv || !rv.count || !document.body.contains(v)) return;
    const box = E('section', { class: 'band' }, E('div', { class: 'hd' }, E('h2', null, 'Reviews'), E('span', { class: 'mut tiny' }, stars(rv.avg) + ' ' + rv.avg + ' · ' + rv.count + (rv.count === 1 ? ' review' : ' reviews'))), E('div', { class: 'frm' }, (rv.items || []).slice(0, 8).map((r) => E('div', { class: 'card' }, E('div', null, E('b', null, stars(r.rating)), r.title ? ' ' + r.title : ''), r.body ? E('div', { class: 'mut' }, r.body) : null, E('div', { class: 'tiny mut' }, (r.name || 'Customer') + ' · verified buyer')))));
    if (related?.isConnected) v.insertBefore(box, related); else if (info.isConnected) v.append(box); }).catch(() => {});
  setMeta(s.name + ' · ' + D.shop.name, (plain(s.description) || s.name).slice(0, 150), photos(s)[0], location.origin + location.pathname + '?p=' + s.id);
  // on a wide screen the details card folds up by itself when you scroll down to the other products, so it never covers them
  const bands = [...v.querySelectorAll('.band')];
  if (!isMin() && bands.length && window.matchMedia('(min-width:900px)').matches && 'IntersectionObserver' in window) {
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
function minimalRelatedProducts(product) {
  const normalize = (category) => String(category || '').trim().toLowerCase().replace(/s$/, '');
  const category = normalize(product.category);
  const candidates = newest(STY.length).filter((candidate) => candidate.id !== product.id);
  const sameCategory = candidates.filter((candidate) => normalize(candidate.category) === category);
  const otherCategories = candidates.filter((candidate) => normalize(candidate.category) !== category);
  const complement = otherCategories.find((candidate) => !isGone(candidate) && product.collection && candidate.collection === product.collection)
    || otherCategories.find((candidate) => !isGone(candidate)) || otherCategories[0];
  if (!complement) return sameCategory.slice(0, 4);
  return [...sameCategory.slice(0, 3), complement];
}
function minimalRecommendations(title, products, destination) {
  return E('section', { class: 'minimal-recommendations' },
    E('div', { class: 'minimal-heading' }, E('h2', null, title),
      destination ? E('a', { class: 'minimal-discover', href: destination }, 'Discover more') : null),
    gridOf(products.slice(0, 4)));
}

V.bag = (v) => {
  const ls = bagLines();
  if (!ls.length) { const rec = newest(6); v.append(E('div', { class: 'empty' }, E('h1', null, 'Your bag is empty'), E('div', { class: 'mut' }, 'Pieces you add will wait here.'), E('a', { class: 'btn', href: link('shop') }, 'Shop now')), rec.length ? E('section', { class: 'sec' }, E('div', { class: 'hd' }, E('span', { class: 'lbl' }, 'Products you may like')), gridOf(rec)) : null, recentBand(null)); return; }
  const list = E('div', { class: 'card' }, E('h2', { style: { marginBottom: '6px' } }, 'Bag'), ls.map((l) => E('div', { class: 'ln' }, E('a', { class: 'im', href: link('p/' + l.s.id) }, (l.vr.image || photosFor(l.s, l.vr.colour)[0]) ? E('img', { src: (l.vr.image || photosFor(l.s, l.vr.colour)[0]), alt: '' }) : placeholder(l.s.name)),
    E('div', null, E('div', { class: 't' }, l.s.name), E('div', { class: 's' }, [l.vr.colour, l.vr.size].filter(Boolean).join(' · ')), E('div', { class: 'qty', style: { marginTop: '6px' } }, E('button', { onclick: () => { l.q > 1 ? (bag.find((b) => b.v === l.v).q -= 1) : bag.splice(bag.findIndex((b) => b.v === l.v), 1); saveBag(); route(); } }, '–'), E('span', null, l.q), E('button', { onclick: () => { addBag(l.v, 1); route(); } }, '+'))),
    E('div', { style: { textAlign: 'right' } }, E('div', null, inr(l.vr.price * l.q)), E('button', { class: 'tiny mut', style: { textDecoration: 'underline', marginTop: '8px' }, onclick: () => { bag.splice(bag.findIndex((b) => b.v === l.v), 1); saveBag(); route(); } }, 'Remove')))));
  const t = bagTotal();
  v.append(E('div', { class: 'shophd' }, E('h1', null, 'Bag'), E('div', { class: 'stats' }, E('span', { class: 'stat' }, 'In stock'), E('span', { class: 'stat' }, bagCount() + ' items'), E('span', { class: 'stat' }, inr(t)))),
    E('div', { class: 'two' }, list, E('div', { class: 'card stick sum' }, E('div', { class: 't' }, E('span', null, 'Subtotal'), E('span', null, inr(t))), E('div', { class: 'mut tiny' }, shipLine(t)), freeBar(t), E('a', { class: 'btn wide', href: link('checkout') }, 'Process to checkout'))), recentBand(null));
};
function freeBar(sub) { const fo = +((cfg().shipping || {}).freeOver) || 0; if (!(fo > 0)) return null; const left = Math.max(fo - sub, 0); return E('div', null, E('div', { class: 'mut tiny' }, left ? 'Add ' + inr(left) + ' more for free shipping' : 'You have free shipping'), E('div', { class: 'fbar' }, E('i', { style: { width: Math.min(100, Math.round(sub / fo * 100)) + '%' } }))); }
const taxCfg = () => { const t = cfg().tax || {}; return +t.rate > 0 ? { rate: +t.rate, inclusive: t.inclusive !== false, label: t.label || 'GST' } : null; };
function taxOn(base) { const t = taxCfg(); if (!t || !(base > 0)) return 0; return Math.round((t.inclusive ? base * t.rate / (100 + t.rate) : base * t.rate / 100) * 100) / 100; }
const taxRow = (amount) => { const t = taxCfg(); return t && amount > 0 ? E('div', { class: 't' }, E('span', null, t.label + (t.inclusive ? ' (included)' : '')), E('span', null, inr(amount))) : null; };
function shipZone(state) { const st = String(state || '').trim().toLowerCase(); return st ? ((cfg().shipping || {}).zones || []).find((z) => (z.states || []).some((x) => String(x).trim().toLowerCase() === st)) : null; }
function shipFee(sub, state) { const sh = shipZone(state) || cfg().shipping || {}; const fee = +sh.fee || 0, fo = +sh.freeOver || 0; return fo > 0 && sub >= fo ? 0 : fee; }
function shipLine(sub, state) { const sh = shipZone(state) || cfg().shipping || {}; const f = shipFee(sub, state); return f ? 'Shipping ' + inr(f) + ((+sh.freeOver > 0) ? ' · free above ' + inr(sh.freeOver) : '') : 'Free shipping'; }

const STATES = ['Andhra Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Odisha', 'Punjab', 'Rajasthan', 'Tamil Nadu', 'Telangana', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Other'];
V.checkout = (v) => {
  const ls = bagLines();
  if (!ls.length) { go('bag'); return; }
  const saved = LS.get('me', {}) || {};
  const F = {};
  const f = (key, label, o) => { o = o || {}; const el = o.select ? E('select', { 'aria-label': label }, o.select.map((x) => E('option', { value: x, selected: (saved[key] || o.def) === x }, x))) : o.area ? E('textarea', { placeholder: label, 'aria-label': label }) : E('input', { placeholder: label + (o.opt ? ' (optional)' : ''), 'aria-label': label, type: o.type || 'text', autocomplete: o.ac || 'on', inputmode: o.mode, value: saved[key] || '', maxlength: o.max }); F[key] = el; return E('label', { class: 'fld' }, el); };
  const methods = []; if (D.cod) methods.push(['cod', 'Cash on delivery', 'Pay when the order reaches you']); if (D.upi) methods.push(['upi', 'Pay by UPI', 'Scan a QR with any UPI app after you place the order']); if (cfg().payOnline) methods.push(['online', 'Card, UPI or net banking', 'Pay securely now']);
  let pay = methods[0] ? methods[0][0] : '';
  const payBox = E('div', { class: 'frm checkout-payment', role: 'radiogroup', 'aria-label': 'Payment method' }); const payPaint = () => { clear(payBox); if (!methods.length) { payBox.append(E('div', { class: 'note' }, 'This store is not taking online orders right now. Please contact the store.')); return; } methods.forEach(([k, l, d]) => payBox.append(E('div', { class: 'opt' + (pay === k ? ' on' : ''), role: 'radio', 'aria-checked': pay === k, tabindex: 0, onclick: () => { pay = k; payPaint(); }, onkeydown: (e) => { if (e.key !== ' ' && e.key !== 'Enter') return; e.preventDefault(); pay = k; payPaint(); payBox.querySelector('.on')?.focus(); } }, E('i', { class: 'r' }), E('div', null, E('div', null, l), E('div', { class: 'mut tiny' }, d))))); };
  payPaint();
  const t = bagTotal(); let sh = shipFee(t, (LS.get('me', {}) || {}).state || 'Rajasthan'); const shipNote = E('div', { class: 'note' }, shipLine(t, (LS.get('me', {}) || {}).state || 'Rajasthan')); const save = E('input', { type: 'checkbox', checked: !!saved.name });
  let coupon = null; // { code, discount, msg }
  const sumBox = E('div');
  const paintSum = () => { clear(sumBox); const d = coupon ? Math.min(coupon.discount, t + sh) : 0; const tx = taxOn(Math.max(t - d, 0)); const addTax = taxCfg() && !taxCfg().inclusive ? tx : 0; sumBox.append(E('div', { class: 't', style: { paddingTop: '8px', borderTop: '1px solid var(--line)' } }, E('span', null, 'Subtotal'), E('span', null, inr(t))), E('div', { class: 't' }, E('span', null, 'Shipping'), E('span', null, sh ? inr(sh) : 'Free')), d ? E('div', { class: 't', style: { color: '#1a7f3c' } }, E('span', null, 'Coupon ' + coupon.code), E('span', null, '– ' + inr(d))) : null, taxRow(tx), E('div', { class: 't g' }, E('span', null, 'Total'), E('span', null, inr(t + sh - d + addTax)))); };
  paintSum();
  const cin = E('input', { placeholder: 'Coupon code', 'aria-label': 'Coupon code', style: { textTransform: 'uppercase' } }); const cmsg = E('div', { class: 'tiny', style: { minHeight: '14px' } });
  const capply = async () => { cmsg.style.color = '#c0392b'; if (coupon) { coupon = null; cin.disabled = false; cin.value = ''; cmsg.textContent = ''; capplyBtn.textContent = 'Apply'; paintSum(); return; } if (!cin.value.trim()) return; capplyBtn.disabled = true;
    try { const r = await rpc(`public_${PFX}_coupon_check`, { p_slug: SLUG, p: { code: cin.value, subtotal: t, phone: (F.phone.value || '').trim() } }); if (r && r.ok) { coupon = { code: r.code, discount: +r.discount }; cmsg.style.color = '#1a7f3c'; cin.disabled = true; capplyBtn.textContent = 'Remove'; paintSum(); } cmsg.textContent = (r && r.msg) || ''; } catch (e) { cmsg.textContent = e.message; } capplyBtn.disabled = false; };
  const capplyBtn = E('button', { class: 'btn out sm', type: 'button', onclick: capply }, 'Apply');
  // Store credit: only for a signed-in customer on a storefront (sfx) store. The server checks the sign-in again and caps it at their balance.
  let useCredit = false; const credBox = E('div', { class: 'tiny', style: { marginTop: '6px' } });
  const acctTok = () => { try { return localStorage.getItem('acct.' + SLUG) || ''; } catch (e) { return ''; } };
  if (PFX === 'sfx' && acctTok()) rpc('public_sfx_customer_account', { p_token: acctTok() }).then((a) => {
    if (!a || !(+a.creditBalance > 0) || !document.body.contains(credBox)) return;
    const cb = E('input', { type: 'checkbox', onchange: () => { useCredit = cb.checked; } });
    credBox.append(E('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, cb, 'Use my store credit (' + inr(a.creditBalance) + ' available)'));
  }).catch(() => {});
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
      const r = await rpc(`public_${PFX}_place_order`, { p_slug: SLUG, p: { name, email: g('email'), phone: g('phone'), address: g('address'), address2: g('address2'), city: g('city'), state: g('state'), pin: g('pin'), country: g('country'), note: g('note'), payment: pay, coupon: coupon ? coupon.code : '', customerToken: useCredit ? acctTok() : undefined, useCredit: useCredit || undefined, lines: bagLines().map((l) => ({ variantId: l.v, qty: l.q })) } });
      if (pay === 'online') {
        await rzpPay(r.token, () => done(r, g), async () => {
          // payment window closed or could not open: keep the bag, cancel the unpaid order (storefront), let the customer try again
          if (PFX === 'sfx') { try { await rpc('public_sfx_order_abandon', { p_token: r.token }); } catch (e) { /* the order page still offers Pay now */ } err.textContent = 'The payment was not completed. Your items are still in your bag, you can try again.'; btn.disabled = false; btn.textContent = 'Place order'; return; }
          done(r, g);
        });
        return;
      }
      done(r, g);
    } catch (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = 'Place order'; }
  };
  // fill city and state from the PIN code (free India Post lookup); if it is unreachable the person just types them
  const pinAuto = async () => { const p = (F.pin.value || '').trim(); if (!/^\d{6}$/.test(p)) return; try { const r = await fetch('https://api.postalpincode.in/pincode/' + p); const j = await r.json(); const po = j && j[0] && j[0].PostOffice && j[0].PostOffice[0]; if (po) { if (!F.city.value) F.city.value = po.District || po.Block || ''; const st = STATES.find((x) => x.toLowerCase() === String(po.State || '').toLowerCase()); if (st) F.state.value = st; if (typeof reship === "function") reship(); } } catch (e) { /* offline or blocked: manual entry */ } };
  // remember the bag against the phone so the shop can remind the customer (only if the shop switched this on)
  let lastCart = ''; const saveCart = () => { const ph = (F.phone.value || '').replace(/\D/g, ''); if (!cfg().abandonWa || ph.length < 10 || lastCart === ph) return; lastCart = ph; rpc(`public_${PFX}_cart_save`, { p_slug: SLUG, p: { phone: ph, name: (F.first.value || '').trim(), lines: bagLines().map((l) => ({ variantId: l.v, qty: l.q })) } }).catch(() => {}); };
  v.append(E('div', { class: 'shophd' }, E('h1', null, 'Checkout')), E('div', { class: 'two' },
    E('div', { class: 'card frm' }, E('h2', null, 'Contact'), f('phone', 'Phone', { type: 'tel', ac: 'tel', mode: 'tel', max: 14 }), f('email', 'Email', { type: 'email', ac: 'email', opt: true }),
      E('h2', null, 'Delivery'), E('div', { class: 'f2' }, f('first', 'First name', { ac: 'given-name' }), f('last', 'Last name', { ac: 'family-name', opt: true })), f('pin', 'PIN code', { mode: 'numeric', ac: 'postal-code', max: 6 }), f('address', 'Address', { ac: 'street-address' }), f('address2', 'Apartment, suite, etc.', { opt: true }),
      E('div', { class: 'f2' }, f('city', 'City'), f('state', 'State', { select: STATES, def: 'Rajasthan' })), f('country', 'Country', { select: ['India'], def: 'India' }), f('note', 'Notes for the store (optional)', { area: true }),
      E('label', { style: { display: 'flex', gap: '8px', alignItems: 'center' } }, save, 'Save this information for next time'),
      E('h2', null, 'Shipping method'), shipNote, E('h2', null, 'Payment'), E('div', { class: 'mut tiny' }, 'All transactions are secure.'), payBox),
    E('div', { class: 'card stick sum' }, E('h2', { style: { marginBottom: '6px' } }, 'Order summary'), ls.map((l) => E('div', { class: 't checkout-line' }, isMin() ? E('div', { class: 'checkout-line-thumb' }, pickPic(l.s) ? E('img', { src: pickPic(l.s), alt: '' }) : placeholder(l.s.name)) : null, E('span', null, l.s.name + ' × ' + l.q + (l.vr.size ? ' · ' + l.vr.size : '')), E('span', null, inr(l.vr.price * l.q)))),
      E('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px' } }, E('label', { class: 'fld', style: { flex: 1 } }, cin), capplyBtn), cmsg, credBox, sumBox, err, btn,
      E('div', { class: 'mut tiny' }, 'By placing the order you agree to the ', E('a', { href: link('policy/terms'), style: { textDecoration: 'underline' } }, 'terms'), ' and the ', E('a', { href: link('policy/returns'), style: { textDecoration: 'underline' } }, 'returns policy'), '.'))));
  const reship = () => { const stv = F.state && F.state.value; sh = shipFee(t, stv); shipNote.textContent = shipLine(t, stv); paintSum(); }; if (F.state) F.state.addEventListener('change', reship); reship();
  F.pin.addEventListener('input', pinAuto); F.pin.addEventListener('change', pinAuto); F.phone.addEventListener('blur', saveCart); F.phone.addEventListener('change', saveCart);
};
// card / UPI / net banking with the shop's own Razorpay account; the server checks the signature before anything is marked paid
function loadRzp() { return new Promise((res, rej) => { if (window.Razorpay) return res(); const sc = document.createElement('script'); sc.src = 'https://checkout.razorpay.com/v1/checkout.js'; sc.onload = res; sc.onerror = () => rej(new Error('Could not load the payment window. Check your connection.')); document.head.append(sc); }); }
async function rzpPay(token, ok, later) {
  const base = (window.CFG || {}).url || '';
  const post = async (path, body) => { const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || j.message || 'Payment could not start'); return j; };
  let st; try { st = await post('/payments/' + PFX + '/start', { token }); await loadRzp(); } catch (e) { toast(e.message); later(); return; }
  const rz = new window.Razorpay({ key: st.key, order_id: st.orderId, amount: st.amount, currency: 'INR', name: D.shop.name, description: 'Order ' + st.number, prefill: { name: st.name, contact: st.phone, email: st.email },
    handler: async (resp) => { try { await post('/payments/' + PFX + '/verify', { token, razorpay_order_id: resp.razorpay_order_id, razorpay_payment_id: resp.razorpay_payment_id, razorpay_signature: resp.razorpay_signature }); toast('Payment received'); } catch (e) { toast('We could not confirm the payment yet. The store will check it.'); } ok(); },
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
      box.append(E('div', { class: 't' }, l.name), sb2, body, m, E('button', { class: 'btn sm', onclick: async (e) => { if (!rate) { m.textContent = 'Choose 1 to 5 stars'; return; } e.target.disabled = true; try { await rpc(`public_${PFX}_review_submit`, { p_token: tok, p: { styleId: l.styleId, rating: rate, body: body.value } }); clear(box).append(E('div', { class: 'mut tiny' }, 'Thank you for your review.')); } catch (er) { m.textContent = er.message; e.target.disabled = false; } } }, 'Post review'));
      wrap.append(box);
    });
  }
  if (o.returns && o.returns.length) {
    const addr = o.shop && o.shop.address ? o.shop.address : '';
    const RMSG = { requested: 'We have your request and will reply here soon.', approved: 'Approved. Please send the item back' + (addr ? ' to ' + addr : '') + ', with the tags intact and your order number ' + o.number + ' on the parcel.', rejected: 'We could not approve this request.', received: 'We received your parcel and are checking it.', refunded: 'All done: your refund or exchange is complete.' };
    wrap.append(E('h2', { style: { marginTop: '10px' } }, 'Return / exchange'), ...o.returns.map((r) => E('div', { class: 'note', style: { marginTop: '6px' } }, E('b', null, cap(r.kind) + ': ' + cap(r.status)), E('div', null, RMSG[r.status] || ''), r.staffNote ? E('div', { class: 'mut' }, r.staffNote) : null)));
  }
  if (o.canReturn) {
    const kind = { v: 'return' }; const reason = E('input', { placeholder: 'Reason (size, fit, damaged...)', 'aria-label': 'Reason' }); const m = E('div', { class: 'tiny', style: { color: '#c0392b', minHeight: '14px' } });
    const kb = E('div', { class: 'fwrap' }); const kp = () => { clear(kb); ['return', 'exchange'].forEach((k) => kb.append(E('button', { type: 'button', class: 'sz' + (kind.v === k ? ' on' : ''), onclick: () => { kind.v = k; kp(); } }, cap(k)))); }; kp();
    wrap.append(E('h2', { style: { marginTop: '10px' } }, 'Return or exchange'), E('div', { class: 'mut tiny', style: { margin: '2px 0 8px' } }, 'Within ' + o.returnDays + ' days of delivery, tags intact.'), E('div', { class: 'frm' }, kb, E('label', { class: 'fld' }, reason), m,
      E('button', { class: 'btn sm out', onclick: async (e) => { e.target.disabled = true; try { await rpc(`public_${PFX}_return_request`, { p_token: tok, p: { kind: kind.v, reason: reason.value, items: (o.lines || []).map((l) => ({ name: l.name, size: l.size, colour: l.colour, qty: l.qty })) } }); toast('Request sent'); const y = scrollY; await V.order(v, tok); scrollTo(0, y); } catch (er) { m.textContent = er.message; e.target.disabled = false; } } }, 'Send request')));
  }
  return wrap.children.length ? wrap : null;
}
const LIVE_MSG = { new: 'We have your order', confirmed: 'Confirmed, we are getting it ready', packed: 'Packed and waiting for pickup', shipped: 'On its way to you', delivered: 'Delivered. Enjoy!', cancelled: 'This order was cancelled' };
V.order = async (v, tok) => {
  clearInterval(v._ot);
  v.append(E('div', { class: 'spin' }));
  let o; try { o = await rpc(`public_${PFX}_order`, { p_token: tok }); } catch (e) { o = null; }
  clear(v);
  if (!o) { v.append(E('div', { class: 'empty' }, E('h2', null, 'Order not found'), E('a', { class: 'btn', href: link('') }, 'Home'))); return; }
  const steps = ['new', 'confirmed', 'packed', 'shipped', 'delivered']; const at = steps.indexOf(o.status);
  const pbox = E('div');
  if (o.upi && o.payment === 'upi' && o.paymentStatus !== 'paid') {
    let img = ''; try { const q = qrcode(0, 'M'); q.addData('upi://pay?pa=' + encodeURIComponent(o.upi.id) + '&pn=' + encodeURIComponent(o.upi.name || '') + '&am=' + (+o.total).toFixed(2) + '&cu=INR&tn=' + encodeURIComponent('Order ' + o.number)); q.make(); img = q.createDataURL(5, 2); } catch (e) { /* no QR library */ }
    const utr = E('input', { placeholder: 'UPI reference number (UTR)', 'aria-label': 'UTR' }), msg = E('div', { class: 'tiny', style: { color: '#c0392b' } });
    pbox.append(E('div', { class: 'card', style: { marginTop: '10px' } }, E('h2', null, 'Pay ' + inr(o.total)), E('div', { class: 'mut tiny', style: { margin: '4px 0 10px' } }, 'Scan with any UPI app, or pay to ' + o.upi.id + '.'),
      E('div', { class: 'qrbox' }, img ? E('img', { src: img, alt: 'UPI QR' }) : null, E('div', { class: 'lbl' }, o.upi.id)),
      o.paymentStatus === 'submitted' ? E('div', { class: 'note', style: { marginTop: '10px' } }, 'Thank you. We have your reference and will confirm the payment shortly.') : E('div', { class: 'frm', style: { marginTop: '10px' } }, E('label', { class: 'fld' }, utr), msg, E('button', { class: 'btn wide', onclick: async (e) => { e.target.disabled = true; try { await rpc(`public_${PFX}_order_paid`, { p_token: tok, p_utr: utr.value }); route(); } catch (er) { msg.textContent = er.message; e.target.disabled = false; } } }, 'I have paid'))));
  }
  // an online order that is placed but not paid (the payment window was closed or could not open): let the customer pay now
  if (o.payment === 'online' && o.paymentStatus !== 'paid' && o.status !== 'cancelled') {
    pbox.append(E('div', { class: 'card', style: { marginTop: '10px' } }, E('h2', null, 'Pay ' + inr(o.amountDue != null ? o.amountDue : o.total)), E('div', { class: 'mut tiny', style: { margin: '4px 0 10px' } }, 'Your order is placed but not paid yet. Pay with a card, UPI or net banking.'),
      E('button', { class: 'btn wide', onclick: (e) => { e.target.disabled = true; rzpPay(tok, () => route(), () => { e.target.disabled = false; }); } }, 'Pay now')));
  }
  v.append(E('div', { class: 'pg' }, E('div', { class: 'card' }, E('div', { class: 'lbl' }, 'Order ' + o.number), E('h1', { style: { margin: '4px 0' } }, o.status === 'cancelled' ? 'Order cancelled' : 'Thank you, ' + ((o.customer && o.customer.name) || '').split(' ')[0]),
    o.creditApplied > 0 ? E('div', { class: 'mut' }, 'Store credit used: ' + inr(o.creditApplied)) : null,
    E('div', { class: 'mut' }, o.payment === 'cod' ? (o.amountDue > 0 ? 'Pay ' + inr(o.amountDue) + ' in cash when it arrives.' : 'Paid with your store credit.') : o.paymentStatus === 'paid' ? 'Payment received.' : 'We will confirm your order once the payment is checked.'),
    o.status === 'cancelled' ? null : E('div', { class: 'steps' }, steps.map((_, i) => E('i', { class: i <= at ? 'on' : '' }))), o.status === 'cancelled' ? null : E('div', { class: 'live' }, o.status === 'cancelled' ? null : E('i'), E('b', null, cap(o.status)), E('span', null, ' · ' + (LIVE_MSG[o.status] || '')), E('div', { class: 'tiny mut' }, 'Updates by itself · checked ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }))),
    E('div', { style: { marginTop: '12px' } }, (o.lines || []).map((l) => E('div', { class: 'ln' }, E('div', { class: 'im' }, l.photo ? E('img', { src: l.photo, alt: '' }) : placeholder(l.name)), E('div', null, E('div', { class: 't' }, l.name), E('div', { class: 's' }, [l.colour, l.size].filter(Boolean).join(' · ') + ' × ' + l.qty)), E('div', null, inr(l.price * l.qty))))),
    E('div', { class: 'sum', style: { marginTop: '10px' } }, E('div', { class: 't' }, E('span', null, 'Shipping'), E('span', null, o.shipping ? inr(o.shipping) : 'Free')), taxRow(+o.tax), +o.discount ? E('div', { class: 't', style: { color: '#1a7f3c' } }, E('span', null, 'Coupon' + (o.coupon ? ' ' + o.coupon : '')), E('span', null, '– ' + inr(o.discount))) : null, E('div', { class: 't g' }, E('span', null, 'Total'), E('span', null, inr(o.total)))),
    trackBox(o),
    E('div', { class: 'mut tiny', style: { marginTop: '10px' } }, 'Save this page to follow your order. Questions? ', E('a', { href: link('contact'), style: { textDecoration: 'underline' } }, 'Contact us'))), pbox, o.billUrl ? E('div', { class: 'note', style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' } }, E('div', null, E('b', null, 'Invoice'), E('div', { class: 'mut tiny' }, o.billNo ? 'Bill ' + o.billNo : 'Ready')), E('a', { class: 'btn sm', href: o.billUrl, target: '_blank', rel: 'noopener' }, 'View invoice')) : null, o.status === 'delivered' ? afterSale(o, tok, v) : null, E('a', { class: 'btn out', href: link('shop'), style: { justifySelf: 'center' } }, 'Keep shopping')));
  if (!['delivered', 'cancelled'].includes(o.status)) { const last = o.status + '|' + o.paymentStatus; v._ot = setInterval(async () => { if (!document.body.contains(v) || !location.hash.includes(tok)) return clearInterval(v._ot); let n = null; try { n = await rpc(`public_${PFX}_order`, { p_token: tok }); } catch { return; } if (n && n.status + '|' + n.paymentStatus !== last) { clearInterval(v._ot); const y = scrollY; await V.order(v, tok); scrollTo(0, y); toast('Order update: ' + cap(n.status)); } }, 12000); }
};

function mapUrl(st) { return st.mapUrl || 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent([st.name, st.address].filter(Boolean).join(' ')); }
function storeList() { const st = (cfg().stores || []).filter((x) => x && (x.name || x.address)); if (st.length) return st; return D.shop.address ? [{ name: D.shop.name, address: D.shop.address, phone: D.shop.phone }] : []; }
function storeCards(list, asCards = false) {
  const cards = list.map((st) => E('div', { class: 'swcard' },
    E('div', { class: 'im' }, st.photo ? E('img', { src: st.photo, alt: st.name || '', loading: 'lazy' }) : null),
    E('div', { class: 'tx' }, E('h3', null, st.name || 'Store'), E('div', { class: 'ad' }, st.address || '', st.hours ? E('div', { class: 'mut' }, st.hours) : null),
      E('a', { class: 'gd', href: mapUrl(st), target: '_blank', rel: 'noopener' }, 'Get Direction \u2197'),
      st.phone ? E('a', { class: 'ph2', href: 'tel:' + String(st.phone).replace(/[^\d+]/g, '') }, st.phone) : E('span'))));
  return asCards ? cards : E('div', { class: 'swc' }, cards);
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
    E('button', { class: 'btn', onclick: async (e) => { e.target.disabled = true; fmsg.textContent = ''; try { const r = await rpc(`public_${PFX}_order_find`, { p_slug: SLUG, p: { number: fnum.value, phone: fph.value } }); const l = LS.get('orders', []); if (!l.some((x) => x.token === r.token)) { l.unshift({ token: r.token, number: fnum.value.trim().toUpperCase() }); LS.set('orders', l.slice(0, 20)); } go('order/' + r.token); } catch (er) { fmsg.textContent = er.message; } e.target.disabled = false; } }, 'Find my order')));
  v.append(E('div', { class: 'pg' }, E('div', { class: 'shophd' }, E('h1', null, saved.first ? 'Hi, ' + saved.first : 'My account')), prof, E('h2', { style: { padding: '12px 4px 4px' } }, 'My orders'), box, find));
  if (!mine.length) { box.append(E('div', { class: 'card mut' }, 'Orders you place on this phone show here with live status. ', E('a', { href: link('shop'), style: { textDecoration: 'underline' } }, 'Shop now'))); return; }
  const open = new Set(); let state = {};
  const paint = () => { clear(box); mine.forEach((m) => { const o = state[m.token]; if (!o) return; const live = !['delivered', 'cancelled'].includes(o.status);
    const det = E('div', { class: 'od' }, (o.lines || []).map((l) => E('div', { class: 'ln' }, E('div', { class: 'im' }, l.photo ? E('img', { src: l.photo, alt: '' }) : placeholder(l.name)), E('div', null, E('div', { class: 't' }, l.name), E('div', { class: 's' }, [l.colour, l.size].filter(Boolean).join(' · ') + ' × ' + l.qty)), E('div', null, inr(l.price * l.qty)))),
      E('div', { class: 'sum' }, E('div', { class: 't' }, E('span', null, 'Shipping'), E('span', null, o.shipping ? inr(o.shipping) : 'Free')), taxRow(+o.tax), E('div', { class: 't g' }, E('span', null, 'Total'), E('span', null, inr(o.total)))),
      E('div', { class: 'tiny mut' }, (o.payment === 'cod' ? 'Cash on delivery' : o.paymentStatus === 'paid' ? 'Paid' : 'Payment: ' + o.paymentStatus) + ' · placed ' + new Date(o.createdAt).toLocaleDateString('en-GB')), trackBox(o), E('a', { class: 'btn sm out', href: link('order/' + m.token), style: { justifySelf: 'start' } }, 'Open order page'));
    const steps = ['new', 'confirmed', 'packed', 'shipped', 'delivered']; const at = steps.indexOf(o.status);
    box.append(E('div', { class: 'card oc' }, E('button', { class: 'oh', onclick: () => { open.has(m.token) ? open.delete(m.token) : open.add(m.token); paint(); } }, E('div', null, E('div', { class: 't' }, o.number), E('div', { class: 'live' }, live ? E('i') : null, E('b', null, cap(o.status)), E('span', null, ' · ' + (STAT_MSG[o.status] || '')))), E('div', { class: 'tr' }, inr(o.total))),
      o.status === 'cancelled' ? null : E('div', { class: 'steps' }, steps.map((_, i) => E('i', { class: i <= at ? 'on' : '' }))), open.has(m.token) ? det : null)); }); };
  async function load(quiet) { const rows = await Promise.all(mine.map((m) => rpc(`public_${PFX}_order`, { p_token: m.token }).catch(() => null))); const nx = {}; let changed = false; mine.forEach((m, i) => { if (rows[i]) { nx[m.token] = rows[i]; const was = state[m.token]; if (was && was.status !== rows[i].status) { changed = true; if (quiet) toast(rows[i].number + ': ' + cap(rows[i].status)); } } }); state = nx; paint(); return changed; }
  box.append(E('div', { class: 'spin' })); await load(false);
  v._ot = setInterval(() => { if (!document.body.contains(v) || !location.hash.includes('orders')) return clearInterval(v._ot); load(true); }, 12000);
};
V.me = V.orders;
// Customer account (sfx stores): sign in with a code sent by email or WhatsApp, then see orders, addresses, credit and marketing choice.
V.account = async (v) => {
  if (PFX !== 'sfx') return V.orders(v);
  const KEY = 'acct.' + SLUG; const tok = () => { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } };
  const setTok = (t) => { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch (e) { /* storage blocked */ } };
  const head = E('div', { class: 'shophd' }, E('h1', null, 'My account'));
  const wrap = E('div', { class: 'pg' }, head); v.append(wrap);
  async function signedIn() {
    let a = null; try { a = await rpc('public_sfx_customer_account', { p_token: tok() }); } catch (e) { a = null; }
    if (!a) { setTok(''); return signIn(); }
    clear(wrap); wrap.append(head);
    const msg = E('div', { class: 'tiny', style: { minHeight: '14px', color: '#1a7f3c' } });
    const mk = E('input', { type: 'checkbox' }); mk.checked = !!a.acceptsMarketing;
    const nm = E('input', { value: a.name || '', 'aria-label': 'Name' });
    wrap.append(
      E('div', { class: 'card' }, E('h2', null, 'Hi, ' + (a.name || 'there')), E('div', { class: 'mut tiny' }, [a.phone, a.email].filter(Boolean).join(' · ')),
        a.creditBalance > 0 ? E('div', { class: 'note', style: { marginTop: '8px' } }, 'Store credit: ' + inr(a.creditBalance)) : null,
        E('div', { class: 'frm', style: { marginTop: '10px' } }, E('label', { class: 'fld' }, nm),
          E('label', { class: 'tiny', style: { display: 'flex', gap: '8px', alignItems: 'center' } }, mk, 'Send me offers and updates'), msg,
          E('div', { style: { display: 'flex', gap: '8px' } },
            E('button', { class: 'btn', onclick: async (e) => { e.target.disabled = true; try { await rpc('public_sfx_customer_update', { p_token: tok(), p: { name: nm.value, acceptsMarketing: mk.checked } }); msg.textContent = 'Saved'; } catch (er) { msg.style.color = '#b3261e'; msg.textContent = er.message; } e.target.disabled = false; } }, 'Save'),
            E('button', { class: 'btn out', onclick: async () => { try { await rpc('public_sfx_customer_signout', { p_token: tok() }); } catch (e) { /* already gone */ } setTok(''); signIn(); } }, 'Sign out')))),
      E('h2', { style: { padding: '12px 4px 4px' } }, 'My orders'),
      ...((a.orders || []).length ? (a.orders || []).map((o) => E('a', { class: 'card', href: link('order/' + o.token), style: { display: 'flex', justifyContent: 'space-between', textDecoration: 'none', color: 'inherit', marginBottom: '8px' } },
        E('div', null, E('b', null, '#' + o.number), E('div', { class: 'mut tiny' }, cap(o.status) + ' · ' + new Date(o.createdAt).toLocaleDateString('en-GB'))), E('b', null, inr(o.total)))) : [E('div', { class: 'card mut' }, 'No orders yet.')]),
      (a.addresses || []).length ? E('h2', { style: { padding: '12px 4px 4px' } }, 'Saved addresses') : null,
      ...(a.addresses || []).map((d) => E('div', { class: 'card tiny', style: { marginBottom: '8px' } }, [d.address, d.city, d.state, d.pin].filter(Boolean).join(', '), d.isDefault ? E('span', { class: 'mut' }, '  (default)') : null)));
  }
  function signIn() {
    clear(wrap); wrap.append(head);
    const msg = E('div', { class: 'tiny', style: { minHeight: '14px', color: '#b3261e' } });
    const contact = E('input', { placeholder: 'Phone number or email', 'aria-label': 'Phone number or email', autocomplete: 'username' });
    const code = E('input', { placeholder: '6-digit code', inputmode: 'numeric', 'aria-label': 'Code', autocomplete: 'one-time-code' });
    const step2 = E('div', { class: 'frm', hidden: true }, E('label', { class: 'fld' }, code),
      E('button', { class: 'btn wide', onclick: async (e) => { e.target.disabled = true; msg.textContent = ''; try { const r = await rpc('public_sfx_customer_verify', { p_slug: SLUG, p_contact: contact.value, p_code: code.value }); if (r && r.ok) { setTok(r.token); return signedIn(); } msg.textContent = (r && r.error) || 'That code did not work'; } catch (er) { msg.textContent = er.message; } e.target.disabled = false; } }, 'Sign in'));
    const send = E('button', { class: 'btn wide', onclick: async (e) => { e.target.disabled = true; msg.textContent = ''; try { const res = await fetch('https://api.auzslab.in/storefront/customer/code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug: SLUG, contact: contact.value }) }); if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not send the code'); msg.style.color = '#1a7f3c'; msg.textContent = 'If we know you, a code is on its way.'; step2.hidden = false; } catch (er) { msg.style.color = '#b3261e'; msg.textContent = er.message; } e.target.disabled = false; } }, 'Send me a code');
    wrap.append(E('div', { class: 'card' }, E('h2', null, 'Sign in'), E('div', { class: 'mut tiny', style: { margin: '2px 0 8px' } }, 'Use the phone number or email from your earlier order. We will send a one-time code.'),
      E('div', { class: 'frm' }, E('label', { class: 'fld' }, contact), send, msg, step2)),
      E('div', { class: 'tiny mut', style: { padding: '10px 4px' } }, 'No account needed to order. ', E('a', { href: link('orders'), style: { textDecoration: 'underline' } }, 'Track an order without signing in')));
  }
  return tok() ? signedIn() : signIn();
};

// ---------- Journal (blogs / news), Media & gallery, Careers: all written by the owner in AUZsStyle -> Online store -> Store ----------
const dateTxt = (d) => { try { return d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : ''; } catch (e) { return ''; } };
const para = (t) => String(t || '').split(/\n+/).filter(Boolean).map((x) => E('p', null, x));
V.blog = (v, which) => {
  const list = (cfg().blogs || []).filter((x) => x && x.title);
  if (which) {
    const i = list.findIndex((x, k) => slugOf(x.title) === which || String(k) === which); const b = list[i];
    if (!b) { v.append(E('div', { class: 'empty' }, E('h2', null, 'Article not found'), E('a', { class: 'btn', href: link('blog') }, 'All articles'))); return; }
    const articleView = 'blog/' + slugOf(b.title);
    setMeta(b.title + ' · ' + D.shop.name, b.excerpt || String(b.body || '').slice(0, 150), b.image,
      isMin() ? storeViewUrl(articleView) : location.origin + location.pathname + '#/' + articleView);
    const others = list.filter((x, k) => k !== i).slice(0, 2);
    v.append(E('div', { class: 'pg' }, E('div', { class: 'crumbs' }, E('a', { href: link('') }, 'Home'), ' / ', E('a', { href: link('blog') }, 'Journal')),
      E('article', { class: 'card art' }, b.image ? E('img', { src: b.image, alt: '', class: 'artimg' }) : null, b.date ? E('div', { class: 'lbl' }, dateTxt(b.date)) : null, E('h1', null, b.title), para(b.body || b.excerpt)),
      others.length ? E('section', { class: 'sec' }, E('div', { class: 'hd' }, E('span', { class: 'lbl' }, 'Keep reading')), blogGrid(others)) : null));
    return;
  }
  v.append(E('div', { class: 'pg wide' }, E('div', { class: 'shophd' }, E('h1', null, 'Journal')), list.length ? blogGrid(list) : E('div', { class: 'card mut' }, 'Nothing published yet. Check back soon.')));
};
// Storefront stores keep their posts in the dashboard's Blog (db/425). Show those; fall back to the old built-in journal when there are none.
const baseBlog = V.blog;
V.blog = async (v, which) => {
  if (PFX !== 'sfx') return baseBlog(v, which);
  D.config = D.config || {};
  let rows = []; try { rows = (await rpc('public_sfx_blog_list', { p_slug: SLUG })) || []; } catch (e) { rows = []; }
  if (!rows.length) return baseBlog(v, which);
  const shape = (b) => ({ title: b.title, excerpt: b.excerpt, image: b.image, date: b.publishedAt, body: b.body || '', handle: b.handle });
  if (!which) { cfg().blogs = rows.map(shape); return baseBlog(v, which); }
  const pick = rows.find((r) => r.handle === which || slugOf(r.title) === which);
  let post = null; if (pick) { try { post = await rpc('public_sfx_blog_post', { p_slug: SLUG, p_handle: pick.handle }); } catch (e) { post = null; } }
  if (!post) {
    try { const r = await rpc('public_sfx_redirect', { p_slug: SLUG, p_path: '/blogs/' + which }); const m = r && String(r.to).match(/^\/blogs\/([^/?#]+)/); if (m) { location.replace(link('blog/' + m[1])); return; } } catch (e) { /* none */ }
    cfg().blogs = []; return baseBlog(v, which);
  }
  cfg().blogs = [shape(post)].concat(rows.filter((r) => r.handle !== post.handle).slice(0, 2).map(shape));
  baseBlog(v, slugOf(post.title));
  if (post.seoTitle) setMeta(post.seoTitle + ' · ' + D.shop.name, post.seoDescription || post.excerpt || '', post.image, location.origin + location.pathname + '#/blog/' + post.handle);
};
function blogGrid(list) {
  return E('div', { class: 'bgrid' }, list.map((b) => E('a', { class: 'bcard', href: link('blog/' + (b.handle || slugOf(b.title))) },
    E('div', { class: 'im' }, b.image ? E('img', { src: b.image, alt: '', loading: 'lazy' }) : placeholder(b.title)),
    E('div', { class: 'tx' }, E('h3', null, b.title), E('p', null, b.excerpt || String(b.body || '').slice(0, 130))))));
}
V.media = (v, which) => {
  const list = (cfg().media || []).filter((item) => item && (item.title || item.image));
  if (isMin() && which) {
    const item = list.find((entry) => slugOf(entry.title) === which);
    if (!item) return v.append(E('div', { class: 'empty' }, E('h1', null, 'Feature not found'), E('a', { class: 'btn', href: link('media') }, 'All features')));
    const target = item.link || '';
    const external = /^https?:\/\//i.test(target);
    const internal = /^#\/[^\s]+$/.test(target) ? target : publicStoreView.test(target.replace(/^\//, '')) ? link(target.replace(/^\//, '')) : '';
    return v.append(E('article', { class: 'minimal-feature' }, E('a', { href: link('media') }, '← All features'),
      E('h1', null, item.title || 'Feature'), item.date ? E('time', null, dateTxt(item.date)) : null,
      item.image ? E('img', { src: item.image, alt: item.title || '' }) : null, item.place ? E('p', null, item.place) : null,
      external || internal ? E('a', { class: 'btn', href: external ? target : internal, rel: external ? 'noopener' : null, target: external ? '_blank' : null }, item.cta || 'Explore') : null));
  }
  if (isMin()) {
    return v.append(E('section', { class: 'pg wide' }, E('div', { class: 'shophd' }, E('h1', null, 'Collaborations & media')),
      list.length ? E('div', { class: 'bgrid' }, list.map((item) => E('a', { class: 'bcard', href: link('media/' + slugOf(item.title)) },
        E('div', { class: 'im' }, item.image ? E('img', { src: item.image, alt: '', loading: 'lazy' }) : placeholder(item.title)),
        E('div', { class: 'tx' }, E('h3', null, item.title || 'Feature'), item.date ? E('time', null, dateTxt(item.date)) : null))))
        : E('p', null, 'No features have been published yet.')));
  }
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
V.policy = (v, k) => { const p = POL[k] || POL.terms; const extra = k === 'privacy' && cfg().privacyContact ? '\nFor questions about your data, write to ' + cfg().privacyContact + '.' : ''; v.append(E('div', { class: 'pg' }, E('div', { class: 'shophd' }, E('h1', null, p[0])), E('div', { class: 'card' }, (String(p[1]()) + extra).split(/\n+/).map((x) => E('p', null, x))))); };
V.page = (v, slug) => {
  const page = minimalPages().find((item) => item.slug === slug);
  if (!page) return v.append(E('div', { class: 'empty' }, E('h1', null, 'Page not found'), E('a', { class: 'btn', href: link('sitemap') }, 'Browse the sitemap')));
  const href = minimalDestination(page.link);
  v.append(E('article', { class: 'minimal-feature' },
    page.sections ? null : E('a', { href: link('sitemap') }, '← Sitemap'), E('h1', null, page.title),
    page.image ? E('img', { src: page.image, alt: '' }) : null,
    page.sections ? null : E('div', { class: 'art' }, richNodes(page.body)),
    href ? E('a', { class: 'btn', href }, page.cta || 'Explore') : null));
  if (page.sections) customSections(v, page.sections);
};
V.sitemap = (v) => {
  const sections = [
    ['Shop', [['All products', 'shop'], ['New in', 'shop?new=1'], ['Collections', 'collections'],
      ...D.collections.filter((c) => c.styleIds.some((id) => BYID[id])).map((c) => [c.name, 'shop?col=' + encodeURIComponent(c.id)])]],
    ['About the store', [['Our story', 'about'], ['Walk-in stores', 'stores'],
      ...(blogsOn() ? [['Journal', 'blog']] : []), ...(mediaOn() ? [['Media & gallery', 'media']] : []),
      ...(jobsOn() ? [['Careers', 'careers']] : []), ...minimalPages().map((page) => [page.title, 'page/' + page.slug])]],
    ['Help', [['Contact', 'contact'], ['Track your order', 'orders'], ['FAQs', 'faq'],
      ['Shipping policy', 'policy/shipping'], ['Returns & exchanges', 'policy/returns'], ['Privacy', 'policy/privacy'], ['Terms', 'policy/terms']]],
  ];
  v.append(E('section', { class: 'pg wide' }, E('div', { class: 'shophd' }, E('h1', null, 'Sitemap')),
    E('div', { class: 'minimal-site-map' }, sections.map(([title, entries]) => E('nav', { 'aria-label': title },
      E('h2', null, title), entries.map(([name, route]) => E('a', { href: link(route) }, name)))))));
};

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
    ...((themeFooter() || {}).columns || []).map((col) => E('div', { class: 'col' }, E('span', { class: 'lbl' }, col.title), ...(col.links || []).map((l) => themeLink(l)))),
    themeFooter() && (themeFooter().about || (themeFooter().links || []).length) ? E('div', { class: 'col' }, E('span', { class: 'lbl' }, 'More'), themeFooter().about ? E('p', { class: 'ftabout' }, themeFooter().about) : null, ...(themeFooter().links || []).map((l) => themeLink(l))) : null,
    E('div', { class: 'ftbrand' }, E('div', { class: 'big' }, D.shop.name))),
    E('div', { class: 'fin' }, E('span', null, '© ' + new Date().getFullYear() + ' ' + D.shop.name + '. All rights reserved'), themeFooter() && themeFooter().note ? E('span', { class: 'ftnote' }, themeFooter().note) : null, isMin() ? E('a', { href: link('sitemap') }, 'Sitemap') : null, E('a', { href: 'https://auzslab.in', target: '_blank', rel: 'noopener' }, 'Store by AUZslab'))))
  tog.onclick = () => { const on = wrap.classList.toggle('open'); tog.setAttribute('aria-expanded', String(on)); tog.querySelector('.pl').textContent = on ? '\u2013' : '+'; };
  return wrap;
}
// ---------- anonymous visitor analytics (no names, phones or addresses) ----------
const TR = (() => {
  let sid = ''; let ret = false; try { sid = localStorage.getItem('st.sid'); ret = !!localStorage.getItem('st.seen'); if (!sid) { sid = 'v' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36); localStorage.setItem('st.sid', sid); } localStorage.setItem('st.seen', '1'); } catch { sid = sid || 'v' + Math.random().toString(36).slice(2, 14); }
  const dev = innerWidth < 700 ? 'phone' : innerWidth < 1100 ? 'tablet' : 'desktop';
  let ref = ''; try { ref = document.referrer ? new URL(document.referrer).hostname.replace(/^www\./, '') : ''; if (ref === location.hostname) ref = ''; } catch {}
  const q = []; let page = '', t0 = 0, maxd = 0;
  let tz = ''; try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch {}
  const push = (k, p, d) => { const ev = { sid, k, p: p == null ? page : p, d: d || {}, dev, ref, ret, tz }; if (k === 'loc') { ev.lat = d.lat; ev.lng = d.lng; } q.push(ev); if (q.length >= 25) flush(); };
  function flush() { if (!q.length) return; const ev = q.splice(0, 40); sb.rpc(`public_${PFX}_track`, { p_slug: SLUG, p: { events: ev } }).then(() => {}, () => {}); }
  function depth() { const h = document.documentElement.scrollHeight - innerHeight; return h > 0 ? Math.min(100, Math.round(scrollY / h * 100)) : 100; }
  addEventListener('scroll', () => { const d = depth(); if (d > maxd) maxd = d; }, { passive: true });
  function leave() { if (page) { push('scroll', page, { max: maxd, s: Math.round((Date.now() - t0) / 1000) }); push('time', page, { s: Math.round((Date.now() - t0) / 1000) }); } }
  document.addEventListener('visibilitychange', () => { if (document.hidden) { leave(); page = page; t0 = Date.now(); maxd = depth(); flush(); } });
  addEventListener('pagehide', () => { leave(); flush(); });
  setInterval(flush, 12000);
  document.addEventListener('click', (e) => { const a = e.target.closest && e.target.closest('a,button'); if (!a) return; const w = a.classList.contains('gd') ? 'Get direction' : a.classList.contains('chat') || a.classList.contains('chatfab') ? 'WhatsApp chat' : /^tel:/.test(a.getAttribute('href') || '') ? 'Call' : a.classList.contains('hero') || (a.closest && a.closest('.hero')) ? 'Hero button' : ''; if (w) push('click', null, { what: w }); }, true);
  // Location is asked once, in plain words, and only a rounded position (about 10 km) is kept. Saying no is remembered for 30 days.
  function sendLoc() { try { navigator.geolocation.getCurrentPosition((pos) => { push('loc', null, { lat: Math.round(pos.coords.latitude * 10) / 10, lng: Math.round(pos.coords.longitude * 10) / 10 }); flush(); }, () => {}, { timeout: 8000, maximumAge: 3600000 }); } catch {} }
  function askLocation() {
    if (DEMO || window.parent !== window || !navigator.geolocation) return;
    let st = ''; try { st = localStorage.getItem('st.geo') || ''; } catch {}
    if (st === '1') { sendLoc(); return; }
    if (st.startsWith('0:') && Date.now() - Number(st.slice(2)) < 30 * 86400000) return;
    setTimeout(() => {
      if (document.querySelector('.geoask')) return;
      const box = E('div', { class: 'geoask', role: 'dialog', 'aria-label': 'Share your location' }, E('p', null, 'Share your location? It helps ' + ((D && D.shop && D.shop.name) || 'this store') + ' show delivery options and see where visitors come from. Only a rough area (about 10 km) is kept, never your exact position.'),
        E('div', { class: 'geoask-btns' }, E('button', { type: 'button', class: 'geo-yes' }, 'Allow'), E('button', { type: 'button', class: 'geo-no' }, 'Not now')));
      box.querySelector('.geo-yes').onclick = () => { try { localStorage.setItem('st.geo', '1'); } catch {} box.remove(); sendLoc(); };
      box.querySelector('.geo-no').onclick = () => { try { localStorage.setItem('st.geo', '0:' + Date.now()); } catch {} box.remove(); };
      document.body.appendChild(box);
    }, 9000);
  }
  return { enter(p) { leave(); page = p; t0 = Date.now(); maxd = 0; push('view', p); }, push, flush, askLocation };
})();
setTimeout(() => { try { TR.askLocation(); } catch (e) { /* never blocks the store */ } }, 0);

// ---------- router ----------
function route() {
  const raw = (location.hash || '').replace(/^#\/?/, '').split('?')[0]; const parts = raw.split('/').filter(Boolean).map(decodeURIComponent);
  const id = parts[0] || 'home'; const view = $('#view'); if (!view) return;
  if (BESPOKE.has(cfg().template) && window[themeGlobal(cfg().template)]) {
    const theme = window[themeGlobal(cfg().template)];
    if (theme.owns(id)) {
      document.title = (id === 'home' ? '' : cap(id === 'p' ? (BYID[parts[1]] || {}).name || 'Product' : id) + ' · ') + D.shop.name;
      theme.show(parts);
      TR.enter(id === 'p' ? 'p/' + (parts[1] || '') : id); if (id === 'p' && BYID[parts[1]]) TR.push('product', null, { id: parts[1], name: BYID[parts[1]].name });
      return;
    }
    theme.frame();
  }
  view._disconnectProduct?.();
  view._disconnectProduct = null;
  clear(view);
  const minimal = isMin();
  document.body.classList.toggle('minimal-store', minimal);
  view.dataset.page = id;
  view.classList.toggle('minimal-home', id === 'home' && minimal);
  document.body.classList.toggle('homehero', id === 'home'); document.body.classList.toggle('onlist', id === 'shop'); view.classList.toggle('gw', id === 'home'); view.classList.toggle('dense', id === 'home' && denseOn()); paintDense(); const fn = Object.hasOwn(V, id) ? V[id] : V.home; try { const r = fn(view, parts[1]); if (r && r.then) r.then(() => { applyTemplate(id, view); applyGroups(id, view); }, (e) => view.append(E('div', { class: 'empty' }, 'Something went wrong. ' + e.message))); else { applyTemplate(id, view); applyGroups(id, view); } } catch (e) { view.append(E('div', { class: 'empty' }, 'Something went wrong. ' + e.message)); }
  if (minimal && id === 'home') scheduleWelcome(() => $('#app .chatfab').click());
  else if (minimal) $('#chatwel')?.remove();
  $('#menu') && $('#menu').classList.remove('on'); $('#srch') && $('#srch').classList.remove('on');
  const article = id === 'blog' && parts[1] ? (cfg().blogs || []).find((item) => item && slugOf(item.title) === parts[1]) : null;
  const page = id === 'page' ? minimalPages().find((item) => item.slug === parts[1]) : null;
  document.title = (id === 'home' ? '' : (article?.title || page?.title || cap(id === 'p' ? (BYID[parts[1]] || {}).name || 'Product' : id)) + ' · ') + D.shop.name;
  const viewPath = parts.join('/');
  const filters = id === 'shop' && q$().col ? { col: q$().col } : {};
  const canonical = minimal && publicStoreView.test(viewPath) ? storeViewUrl(viewPath, filters) : location.origin + location.pathname;
  if (id !== 'p' && !(id === 'blog' && parts[1])) setMeta(document.title,
    (page?.body || '').slice(0, 150) || cfg().tagline || ('Shop online at ' + D.shop.name),
    page?.image || ((D.styles || [])[0] && photos((D.styles || [])[0])[0]) || '', canonical);
  window.scrollTo(0, 0); navState();
  TR.enter(id === 'p' ? 'p/' + (parts[1] || '') : id); if (id === 'p' && BYID[parts[1]]) TR.push('product', null, { id: parts[1], name: BYID[parts[1]].name });
  if (id === 'checkout') TR.push('checkout', null, { step: 'start' });
}
const heroEnd = () => {
  const minimalHero = document.querySelector('.minimal-hero');
  if (minimalHero) return minimalHero.offsetHeight;
  const hero = document.querySelector('.hero');
  return hero ? hero.offsetHeight - 70 : window.innerHeight * 0.9;
};
const navState = () => { document.body.classList.toggle('atop', window.scrollY < 40); document.body.classList.toggle('pasthero', window.scrollY > heroEnd()); const dp = Math.max(0, Math.min(1, (window.scrollY - (heroEnd() - 260)) / 220)); document.documentElement.style.setProperty('--dp', dp.toFixed(3)); document.body.classList.toggle('dockon', dp > 0.6); };
window.addEventListener('scroll', navState, { passive: true }); window.addEventListener('hashchange', () => setTimeout(navState, 50));
function ingest(d) {
  shopIcon(d);
  D = d; try { if (d.config && d.config.languages && d.config.languages.hindi && window.stHindi) window.stHindi.enable(); } catch {} STY = (D.styles || []).filter((x) => x.variants && x.variants.length); BYID = {}; VAR = {};
  STY.forEach((x) => { BYID[x.id] = x; x.variants.forEach((y) => { VAR[y.id] = { ...y, sid: x.id }; }); });
  bag = LS.get('bag', []).filter((b) => VAR[b.v]); wish = LS.get('wish', []).filter((id) => BYID[id]);
  applyDesign(PREVIEW && PREVIEW_DESIGN ? PREVIEW_DESIGN : (d.config || {}).themeDesign);
}
const PREVIEW_STUDS = new URLSearchParams(location.search).get('preview') === 'studs' && window.parent !== window;
// ?preview=classic|minimal|<any bespoke-chrome slug> on the store's own address shows that design with the store's
// real products; the live design is not changed. The generic slugs are the two generic chromes; the bespoke ones
// come from BESPOKE (seeded synchronously above, refined once loadThemeRegistry() resolves) -- never its own
// separate hardcoded list.
let PREVIEW_T = computePreviewT();
function computePreviewT() { const v = new URLSearchParams(location.search).get('preview'); return (v === 'classic' || v === 'minimal' || BESPOKE.has(v)) && !PREVIEW_STUDS ? v : ''; }
function waitStudsPreview() {
  return new Promise((resolve) => {
    let done = false; const finish = (v) => { if (!done) { done = true; resolve(v); } };
    window.addEventListener('message', (e) => {
      if (e.origin !== location.origin || !e.data || e.data.type !== 'studs-settings' || typeof e.data.settings !== 'object') return;
      if (!done) { finish(e.data.settings); return; }
      if (D && D.config) { D.config.studs = e.data.settings; if (window.StudsTheme) window.StudsTheme.refresh(); }
    });
    try { parent.postMessage({ type: 'studs-ready' }, location.origin); } catch (err) { finish(null); }
    setTimeout(() => finish(null), 3500);
  });
}
// What the Studs theme (studs.js) may use from this file: read the catalogue, use the shared bag. Nothing else.
window.StoreHost = {
  get D() { return D; }, STY: () => STY, get bag() { return bag; }, cfg, photos, thumb, thumbImg, isGone, leftOf, sizesOf, colours,
  saveBag, addBag, bagLines, bagTotal, bagCount,
  // Added for Kaarigari's full checkout ownership (docs/STOREFRONT_THEME_CONTRACT.md's reviewed exception):
  // the real shipping/tax/payment-method logic and the real place-order RPC, so a bespoke theme that owns its
  // own checkout page can wire real data instead of re-deriving (or worse, faking) any of it.
  rpc, get PFX() { return PFX; }, SLUG, STATES, shipFee, shipLine, taxCfg, taxOn,
};
// Loading each bespoke theme's own chrome file is now one generic call (loadBespokeChrome, declared near
// THEME_REGISTRY above): the file naming convention and any extra stylesheet come from the registry, not a
// per-theme function here.
async function boot() {
  const app = $('#app');
  if (!location.hash) {
    const params = new URLSearchParams(location.search);
    const p = params.get('p'), view = params.get('view'), collection = params.get('col');
    if (p) history.replaceState(null, '', location.pathname + location.search + '#/p/' + encodeURIComponent(p));
    else if (view && publicStoreView.test(view)) history.replaceState(null, '', location.pathname + location.search + '#/' + view +
      (view === 'shop' && collection ? '?' + new URLSearchParams({ col: collection }) : ''));
  }
  if (!SLUG) { app.append(E('div', { class: 'spin' })); clear(app).append(E('div', { class: 'empty' }, E('h2', null, 'Open this store from the shop address'), E('div', { class: 'mut' }, 'For example yourshop.auzslab.in/store.html'))); return; }
  // instant first paint from the last visit; the fresh catalogue is fetched right behind it
  let cached = null; try { cached = JSON.parse(localStorage.getItem('st.cat.' + SLUG) || 'null'); } catch (e) { cached = null; }
  // Template 2 was retired (db/342): a browser that cached a config from before that -- store2.html no longer
  // exists -- must not try to use it; drop the stale cache and fall through to a fresh fetch, which can only
  // ever return '1' or 'minimal' now.
  if (cached && cached.config && cached.config.template === '2') cached = null;
  // Every bespoke-chrome theme draws its own page chrome from the live data, so none of them ever use the
  // instant first paint from the last visit (BESPOKE, from the single theme registry -- never its own list).
  if (cached && cached.config && BESPOKE.has(cached.config.template)) cached = null;
  if (PREVIEW_STUDS || PREVIEW_T || DEMO) cached = null;
  // Refresh the theme registry before resolving the store or a demo preview: both read it below (BESPOKE,
  // templateFor). The seeded default above keeps everything working even if this fetch is slow or fails.
  const registryReady = loadThemeRegistry();
  if (DEMO) await registryReady;   // demo.js resolves the requested preview id against the registry; a real store can proceed on the seeded default while this finishes
  // Restore which product's RPCs the cached copy was fetched with, so an interaction fired before the fresh
  // fetch below resolves (see the cached-first-paint branch) still hits the right public_<prefix>_* functions.
  if (cached) PFX = cached.__pfx === 'sfx' ? 'sfx' : 'sty';
  // Tries the AUZsStyle storefront RPC first (unchanged behaviour for every existing AUZsStyle shop), and only
  // when that tenant doesn't have one (a null result, not a thrown error) falls back to the AUZslab storefront
  // platform's own public RPC (db/372) -- a tenant only ever has one of the two products enabled, so exactly one
  // of these ever returns real data. This is this renderer's one generalization point: everything else below
  // (rendering, cart, checkout) is shared, niche-agnostic code already.
  const resolveStore = async () => {
    const sty = await rpc('public_sty_store', { p_slug: SLUG });
    if (sty) { PFX = 'sty'; return sty; }
    PFX = 'sfx';
    return rpc('public_sfx_store', { p_slug: SLUG });
  };
  const fresh = resolveStore();
  const fail = (e) => { clear(app).append(E('div', { class: 'empty' }, E('h2', null, 'Could not open the store'), E('div', { class: 'mut' }, e.message))); };
  const closed = (d) => { clear(app).append(E('div', { class: 'empty' }, E('h1', null, d.name || 'Store'), E('div', { class: 'mut' }, DEMO ? 'This live demo is temporarily closed while its sample account is being updated. Check back soon.' : 'Our online store is not open yet. Please check back soon.'))); document.title = d.name || 'Store'; };
  const remember = (d) => { if (DEMO) return; try { localStorage.setItem('st.cat.' + SLUG, JSON.stringify({ ...d, __pfx: PFX })); } catch (e) { /* storage full */ } };
  if (cached && cached.styles && !cached.closed) {
    ingest(cached); shell(); window.addEventListener('hashchange', route); route();
    fresh.then((d) => { if (!d || d.closed) return; remember(d);
      if (d.config && BESPOKE.has(d.config.template)) { location.reload(); return; }
      ingest(d); const h = (location.hash || '').replace(/^#\/?/, '').split('?')[0].split('/')[0]; if (!['checkout', 'order', 'orders', 'me'].includes(h) && !document.querySelector('.sheetwrap')) { const y = scrollY; route(); scrollTo(0, y); } }).catch(() => {});
    return;
  }
  app.append(E('div', { class: 'spin' }));
  let d; try { d = await fresh; } catch (e) { fail(e); return; }
  if (!d) { clear(app).append(E('div', { class: 'empty' }, E('h2', null, 'This store was not found'))); return; }
  if (d.closed) { closed(d); return; }
  remember(d);
  // Owner dashboard preview of an UNPUBLISHED Studs draft: only when the page is framed by the dashboard on the same address and
  // it sends the draft settings. Anyone opening ?preview=studs directly gets the normal store, so a store never shows Studs to the
  // public until the merchant publishes it.
  if (PREVIEW_STUDS && d.config) { const settings = await waitStudsPreview(); if (settings) d.config = { ...d.config, template: 'studs', studs: settings }; }
  if (PREVIEW_T && d.config) d.config = { ...d.config, template: PREVIEW_T };
  ingest(d);
  await registryReady;   // make sure BESPOKE reflects the real registry before deciding whether to load a chrome file
  if (BESPOKE.has(cfg().template)) await loadBespokeChrome(cfg().template);
  shell(); window.addEventListener('hashchange', route); route();
  if (PREVIEW_T) { const u = new URL(location.href); u.searchParams.delete('preview'); document.body.append(E('div', { class: 'prevbar' }, E('span', null, 'Preview of the ' + PREVIEW_T[0].toUpperCase() + PREVIEW_T.slice(1) + ' design with your own products. Your live store is unchanged.'), E('a', { href: u.toString() }, 'Exit preview'))); }
}
boot();
