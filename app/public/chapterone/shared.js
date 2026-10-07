/* Chapter One — bespoke one-off site. Shared by every page (index.html, item.html): menu
   loading, cart, order/reservation submission, UPI payment, sheet helpers. Loaded before each
   page's own script, plain globals (no build step, no modules) — same convention the rest of
   this codebase uses for a single app's own files sharing state across its own pages.

   TENANT_SLUG is already set to the real intended slug. Until that tenant actually exists,
   every server call fails with Postgres's own "unknown tenant" error (place_order/call_waiter
   both raise it as their first check) -- isUnprovisioned() recognises exactly that one error
   and falls back to local demo behaviour, so this site already works for a pitch today AND
   goes fully live the instant site/admin.html provisions a tenant with this slug. Any OTHER
   server error (self-order switched off, a busy table, etc.) is shown for real, once live. */
const TENANT_SLUG = 'chapterone';
const LIVE = !!TENANT_SLUG && window.supabase && window.CFG;
const sb = LIVE ? supabase.createClient(CFG.url, CFG.key) : null;
const isUnprovisioned = (e) => !e || /unknown tenant/i.test(e.message || '');

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
const qs = (k) => new URLSearchParams(location.search).get(k);

/* table-QR dine-in: a table's own code points here as ?t=<id>. guest_orders.tbl is plain text
   (CLAUDE.md's own note on place_order), so whatever string a table's QR encodes is exactly
   what staff see -- no table-list sync needed between this page and the POS. */
const TABLE_ID = qs('t');

/* ---------------- demo menu: shown until the real catalogue loads from the owner's own POS via
   public_menu -- stays as the fallback if the live fetch ever comes back empty. ---------------- */
const DEMO_CATS = [
  { id: 'coffee', name: 'Coffee' },
  { id: 'tea', name: 'Tea & More' },
  { id: 'chapters', name: 'The Chapters' },
  { id: 'brunch', name: 'All-Day Brunch' },
  { id: 'bakes', name: 'Bakes & Desserts' },
];
const DEMO_ITEMS = [
  { id: 'cb', cat: 'coffee', name: 'Cold Brew', price: 180, desc: 'Slow-steeped for 18 hours, served over ice. Smooth, low-acid, quietly strong.', art: 'cup' },
  { id: 'fw', cat: 'coffee', name: 'Flat White', price: 160, desc: 'Double ristretto, velvet-steamed milk. Our most-ordered cup, for a reason.', art: 'cup' },
  { id: 'sl', cat: 'coffee', name: 'Spanish Latte', price: 190, desc: 'Espresso over condensed milk and whole milk — sweet, cold, unhurried.', art: 'cup', sizes: [{ l: 'Regular', p: 190 }, { l: 'Large', p: 230 }] },
  { id: 'fk', cat: 'coffee', name: 'Filter Kaapi', price: 140, desc: 'South-Indian filter coffee, frothed the old way, served in steel tumblers.', art: 'cup' },
  { id: 'af', cat: 'coffee', name: 'Affogato', price: 210, desc: 'A shot of hot espresso poured over a scoop of vanilla — dessert, disguised as coffee.', art: 'cup' },
  { id: 'mc', cat: 'tea', name: 'Masala Chai', price: 90, desc: 'Hand-ground spice blend, slow-brewed with milk, the way it’s meant to be.', art: 'leaf' },
  { id: 'gt', cat: 'tea', name: 'Jasmine Green Tea', price: 140, desc: 'Loose-leaf jasmine green, steeped fresh to order.', art: 'leaf' },
  { id: 'hc', cat: 'tea', name: 'Hot Chocolate', price: 170, desc: 'Dark chocolate, whole milk, a small cloud of whipped cream.', art: 'leaf' },
  { id: 'c1', cat: 'chapters', name: 'Chapter One Latte', price: 230, desc: 'Our signature — espresso, lavender honey, oat milk. The first thing we ever put on the menu.', art: 'book', signature: true },
  { id: 'fp', cat: 'chapters', name: 'The First Page', price: 240, desc: 'Iced brown-sugar oat latte, a hint of cinnamon. Named for where every story starts.', art: 'book', signature: true },
  { id: 'sh', cat: 'brunch', name: 'Shakshuka', price: 280, desc: 'Baked eggs in a spiced tomato-pepper sauce, served with toasted sourdough.', art: 'plate' },
  { id: 'at', cat: 'brunch', name: 'Avocado Toast', price: 260, desc: 'Sourdough, smashed avocado, chilli flakes, a soft poached egg on top.', art: 'plate' },
  { id: 'eb', cat: 'brunch', name: 'Eggs Benedict', price: 300, desc: 'Poached eggs, hollandaise, English muffin — a weekend-morning classic, any day.', art: 'plate', sizes: [{ l: 'Single', p: 300 }, { l: 'Double eggs', p: 360 }] },
  { id: 'bc', cat: 'bakes', name: 'Burnt Basque Cheesecake', price: 220, desc: 'Caramelised on top, molten in the middle. Baked in-house, every morning.', art: 'cake' },
  { id: 'cr', cat: 'bakes', name: 'Chocolate Hazelnut Croissant', price: 150, desc: 'Buttery, laminated, filled generously, warmed before it reaches you.', art: 'cake' },
  { id: 'cw', cat: 'bakes', name: 'Carrot Walnut Cake', price: 180, desc: 'Spiced carrot cake, toasted walnuts, a thin layer of cream-cheese frosting.', art: 'cake' },
];

const ART = {
  cup: '<svg viewBox="0 0 100 100"><path d="M28 36h44l-4 38a8 8 0 0 1-8 7H40a8 8 0 0 1-8-7l-4-38Z" fill="none" stroke-width="2.2"/><path d="M72 42h8a9 9 0 0 1 0 18h-9" fill="none" stroke-width="2.2"/><path d="M38 20c3 5-3 7 0 12M50 20c3 5-3 7 0 12M62 20c3 5-3 7 0 12" fill="none" stroke-width="2" stroke-linecap="round"/></svg>',
  leaf: '<svg viewBox="0 0 100 100"><path d="M24 76C20 44 46 22 78 22c4 30-18 56-50 54Z" fill="none" stroke-width="2.2"/><path d="M26 74C40 58 54 46 70 36" fill="none" stroke-width="2"/></svg>',
  book: '<svg viewBox="0 0 100 100"><path d="M50 28c-8-6-20-8-30-6v48c10-2 22 0 30 6 8-6 20-8 30-6V22c-10-2-22 0-30 6Z" fill="none" stroke-width="2.2"/><path d="M50 28v48" stroke-width="2"/></svg>',
  plate: '<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="30" fill="none" stroke-width="2.2"/><circle cx="50" cy="50" r="18" fill="none" stroke-width="1.6" stroke-dasharray="3 6"/></svg>',
  cake: '<svg viewBox="0 0 100 100"><path d="M22 56h56v22a6 6 0 0 1-6 6H28a6 6 0 0 1-6-6V56Z" fill="none" stroke-width="2.2"/><path d="M22 56c0-10 10-16 28-16s28 6 28 16" fill="none" stroke-width="2.2"/><path d="M50 40V22M50 22c-4 0-6-3-4-6 3 2 5 2 4-4 4 3 7 6 4 10-1 0-3-1-4 0Z" fill="none" stroke-width="2"/></svg>',
};
const art = (k) => '<svg viewBox="0 0 100 100">' + (ART[k] || ART.cup).replace(/<svg[^>]*>|<\/svg>/g, '') + '</svg>';
// a real item's photo (once the owner adds one in the POS) always wins over the line-art fallback
const visual = (i) => i.img ? '<img loading="lazy" alt="" src="' + esc(i.img) + '" style="width:100%;height:100%;object-fit:cover">' : art(i.art || guessArt(i.cat));
const DRINK_CAT = /coffee|tea|beverage|drink|latte|brew/i, BAKE_CAT = /bake|dessert|cake|pastry/i;
const guessArt = (catId) => { const c = CATS.find((x) => x.id === catId); const n = (c && c.name) || ''; return DRINK_CAT.test(n) ? 'cup' : BAKE_CAT.test(n) ? 'cake' : 'plate'; };
const itemPrice = (i, size) => { if (!i.sizes || !i.sizes.length) return i.price; const s = i.sizes.find((x) => x.l === size); return s ? s.p : i.sizes[0].p; };

let CATS = DEMO_CATS, ITEMS = DEMO_ITEMS, usingLiveMenu = false, SITE_CFG = {};

/* ---------------- live menu + content: loads the owner's real catalogue AND the same
   "Website & Booking" fields the admin console's mgmt/website page already edits
   (siteKicker/siteTag/siteSub/siteAbout/siteHours/siteInsta/addr/phone/logo), so that page
   becomes meaningfully in control of this bespoke site instead of pointing at a page this
   site never reads. applyBranding(), defined by whichever page needs it, is called once this
   resolves. ---------------- */
async function loadLiveMenu() {
  if (!LIVE) return;
  try {
    const { data, error } = await sb.rpc('public_menu', { tenant_slug: TENANT_SLUG });
    if (error || !data) return;
    SITE_CFG = data.cfg || {};
    if (typeof applyBranding === 'function') applyBranding(SITE_CFG);
    if (!data.items || !data.items.length) return;
    const cats = (data.cats || []).slice().sort((a, b) => (a.n || 0) - (b.n || 0));
    const items = data.items.filter((i) => !i.off).map((i) => ({
      id: i.id, cat: i.cat, name: i.name, desc: i.desc || '',
      price: i.sizes && i.sizes.length ? i.sizes[0].p : i.price, sizes: i.sizes && i.sizes.length ? i.sizes : null,
      img: i.img || null, signature: !!i.combo,
    }));
    if (!cats.length || !items.length) return;
    CATS = cats; ITEMS = items; usingLiveMenu = true;
    if (typeof onMenuLoaded === 'function') onMenuLoaded();
    const banner = $('demoBanner'); if (banner) banner.remove();
  } catch (e) { /* stays on the demo catalogue */ }
}

/* ---------------- toast ---------------- */
let toastT;
function toast(msg) {
  const t = $('toast');
  if (!t) { console.log(msg); return; }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 3200);
}

/* ---------------- cart: persisted to localStorage so it survives navigating between pages
   (index.html <-> item.html), keyed by "itemId|size" so the same item in two different sizes
   is two separate lines, same convention site.html's own QR ordering already uses. ---------------- */
const CART_KEY = 'chapterone_cart';
let cart = {};
try { cart = JSON.parse(localStorage.getItem(CART_KEY) || '{}'); } catch (e) { cart = {}; }
function saveCart() { try { localStorage.setItem(CART_KEY, JSON.stringify(cart)); } catch (e) {} }
const cartKey = (id, size) => id + '|' + (size || '');
const cartCount = () => Object.values(cart).reduce((a, c) => a + c.qty, 0);
const cartTotal = () => Object.values(cart).reduce((t, c) => { const i = ITEMS.find((x) => x.id === c.id); return i ? t + itemPrice(i, c.size) * c.qty : t; }, 0);
function addToCart(id, size, qty) {
  const key = cartKey(id, size), existing = cart[key];
  const q = (existing ? existing.qty : 0) + qty;
  if (q > 0) cart[key] = { id, size: size || null, qty: q }; else delete cart[key];
  saveCart();
  if (typeof onCartChanged === 'function') onCartChanged();
}
function setCartQty(key, qty) {
  qty = Math.max(0, qty);
  if (qty > 0) cart[key].qty = qty; else delete cart[key];
  saveCart();
  if (typeof onCartChanged === 'function') onCartChanged();
}
function clearCart() { cart = {}; saveCart(); if (typeof onCartChanged === 'function') onCartChanged(); }
function drawCartBadge() {
  const n = cartCount(), b = $('cartCount');
  if (b) { b.textContent = n; b.classList.toggle('show', n > 0); }
  const twc = $('twCount'), twt = $('twTotal');
  if (twc) twc.textContent = n;
  if (twt) twt.textContent = inr(cartTotal());
}

/* ---------------- demo UPI QR (same "pay by UPI while the real gateway is off" pattern
   already used in site/cart.html -- a placeholder id until the owner supplies the real one) */
const UPI_ID = '', UPI_NAME = 'Chapter One';
function renderPayQr(amount) {
  const box = $('payQrBox');
  if (!UPI_ID) { box.innerHTML = '<p class="pay-note">Payment link will appear here once the owner’s UPI/payment details are set up.</p>'; return; }
  const url = 'upi://pay?pa=' + encodeURIComponent(UPI_ID) + '&pn=' + encodeURIComponent(UPI_NAME) + '&am=' + amount + '&cu=INR';
  box.innerHTML = '';
  try { const qr = qrcode(0, 'M'); qr.addData(url); qr.make(); box.innerHTML = qr.createImgTag(5, 6); } catch (e) { box.innerHTML = '<p class="pay-note">' + esc(url) + '</p>'; }
}

/* ---------------- order / reservation submission -- real the moment the tenant exists.
   "unknown tenant" is the ONLY error treated as "not provisioned yet, fall back to a demo
   confirmation" -- any other server refusal is shown for real, never silently swallowed. ---------------- */
async function sendOrder(t, note, name, phone) {
  const its = Object.values(cart).map((c) => ({ id: c.id, size: c.size, qty: c.qty }));
  if (!LIVE) { await new Promise((r) => setTimeout(r, 650)); return { ok: true, demo: true }; }
  try {
    const { error } = await sb.rpc('place_order', { tenant_slug: TENANT_SLUG, t, n: name || '', p: phone || '', nt: note, its });
    if (error) return isUnprovisioned(error) ? { ok: true, demo: true } : { ok: false, error };
    return { ok: true };
  } catch (e) { return isUnprovisioned(e) ? { ok: true, demo: true } : { ok: false, error: e }; }
}
async function callWaiter() {
  if (!LIVE) { toast('Preview only — once live, this calls a real staff member to the table.'); return; }
  try {
    const { error } = await sb.rpc('call_waiter', { tenant_slug: TENANT_SLUG, t: TABLE_ID });
    if (error && !isUnprovisioned(error)) { toast('Could not reach staff — please try again.'); return; }
    toast('Staff have been called to Table ' + TABLE_ID);
  } catch (e) { toast('Could not reach staff — please try again.'); }
}

/* ---------------- generic bottom sheet helper ---------------- */
function mkSheet(html) {
  const ov = document.createElement('div');
  ov.className = 'sheet-ov';
  ov.innerHTML = '<div class="sht">' + html + '</div>';
  ov.onclick = (e) => { if (e.target === ov) closeSheet(ov); };
  document.body.append(ov);
  requestAnimationFrame(() => ov.classList.add('open'));
  return ov;
}
function closeSheet(ov) { ov.classList.remove('open'); setTimeout(() => ov.remove(), 350); }
function showOk(title, msg, receiptHref) {
  const ov = mkSheet('<div class="ok-card"><div class="okmark"><svg viewBox="0 0 24 24" fill="none" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></div><h3>' + esc(title) + '</h3><p class="muted">' + esc(msg) + '</p>' +
    (receiptHref ? '<a class="btn line wfull" href="' + esc(receiptHref) + '" target="_blank" style="margin-top:20px">View receipt</a>' : '') +
    '<button class="btn wfull" id="okClose" style="margin-top:' + (receiptHref ? '10px' : '20px') + '">Continue browsing</button></div>');
  ov.querySelector('#okClose').onclick = () => closeSheet(ov);
}

loadLiveMenu();
