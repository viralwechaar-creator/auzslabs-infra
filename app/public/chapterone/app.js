/* Chapter One — bespoke one-off site. This is the real, handover-ready build: TENANT_SLUG is
   already set to the intended live slug. Until that tenant actually exists, every server call
   below fails with Postgres's own "unknown tenant" error (place_order/call_waiter both raise
   it as their first check) -- isUnprovisioned() recognises exactly that one error and falls
   back to local demo behaviour, so this single page already works for a pitch today AND goes
   fully live the instant site/admin.html provisions a tenant with this slug (niche "cafe",
   AUZsPOS + AUZsPOS QR ticked) -- no further code or redeploy needed, "only a few changes":
   provision the tenant, load the real menu through the owner's own POS (push_record/the
   console), and optionally swap the placeholder logo/UPI id below for the real ones.
   Any OTHER server error (self-order switched off, busy table, etc.) is shown for real, once
   live -- only "unknown tenant" is treated as "not provisioned yet". */
const TENANT_SLUG = 'chapterone';
const LIVE = !!TENANT_SLUG && window.supabase && window.CFG;
const sb = LIVE ? supabase.createClient(CFG.url, CFG.key) : null;
const isUnprovisioned = (e) => !e || /unknown tenant/i.test(e.message || '');

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inr = (n) => '₹' + Math.round(n).toLocaleString('en-IN');

/* ---------------- table-QR dine-in: a table's own code points here as ?t=<id>. Unlike
   site.html, a table id here is never looked up against a real `tables` record -- guest_orders'
   own `tbl` column is plain text (CLAUDE.md: "place_order() ... insert into guest_orders (...)
   tbl ..."), so whatever string the table's QR encodes is exactly what staff see, with zero
   table-list sync needed between this page and the POS. ---------------- */
const TABLE_ID = new URLSearchParams(location.search).get('t');

/* ---------------- demo menu (shown until the real catalogue loads from the owner's own POS
   via public_menu -- same shape coming back, so nothing here needs to change when that
   happens; this stays as the fallback if the live fetch ever comes back empty) ---------------- */
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
  { id: 'sl', cat: 'coffee', name: 'Spanish Latte', price: 190, desc: 'Espresso over condensed milk and whole milk — sweet, cold, unhurried.', art: 'cup' },
  { id: 'fk', cat: 'coffee', name: 'Filter Kaapi', price: 140, desc: 'South-Indian filter coffee, frothed the old way, served in steel tumblers.', art: 'cup' },
  { id: 'af', cat: 'coffee', name: 'Affogato', price: 210, desc: 'A shot of hot espresso poured over a scoop of vanilla — dessert, disguised as coffee.', art: 'cup' },
  { id: 'mc', cat: 'tea', name: 'Masala Chai', price: 90, desc: 'Hand-ground spice blend, slow-brewed with milk, the way it’s meant to be.', art: 'leaf' },
  { id: 'gt', cat: 'tea', name: 'Jasmine Green Tea', price: 140, desc: 'Loose-leaf jasmine green, steeped fresh to order.', art: 'leaf' },
  { id: 'hc', cat: 'tea', name: 'Hot Chocolate', price: 170, desc: 'Dark chocolate, whole milk, a small cloud of whipped cream.', art: 'leaf' },
  { id: 'c1', cat: 'chapters', name: 'Chapter One Latte', price: 230, desc: 'Our signature — espresso, lavender honey, oat milk. The first thing we ever put on the menu.', art: 'book', signature: true },
  { id: 'fp', cat: 'chapters', name: 'The First Page', price: 240, desc: 'Iced brown-sugar oat latte, a hint of cinnamon. Named for where every story starts.', art: 'book', signature: true },
  { id: 'sh', cat: 'brunch', name: 'Shakshuka', price: 280, desc: 'Baked eggs in a spiced tomato-pepper sauce, served with toasted sourdough.', art: 'plate' },
  { id: 'at', cat: 'brunch', name: 'Avocado Toast', price: 260, desc: 'Sourdough, smashed avocado, chilli flakes, a soft poached egg on top.', art: 'plate' },
  { id: 'eb', cat: 'brunch', name: 'Eggs Benedict', price: 300, desc: 'Poached eggs, hollandaise, English muffin — a weekend-morning classic, any day.', art: 'plate' },
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

let CATS = DEMO_CATS, ITEMS = DEMO_ITEMS, usingLiveMenu = false;

/* ---------------- live menu: loads the owner's real catalogue from the same public_menu RPC
   site.html's QR flow already uses, so once this tenant exists the owner edits their menu
   from the POS exactly as they would for any other QR ordering page -- nothing here needs
   touching again. Falls back to the demo catalogue above if the tenant isn't live yet, or
   genuinely has no menu entered. ---------------- */
async function loadLiveMenu() {
  if (!LIVE) return;
  try {
    const { data, error } = await sb.rpc('public_menu', { tenant_slug: TENANT_SLUG });
    if (error || !data || !data.items || !data.items.length) return;
    const cats = (data.cats || []).slice().sort((a, b) => (a.n || 0) - (b.n || 0));
    const items = data.items.filter((i) => !i.off).map((i) => ({
      id: i.id, cat: i.cat, name: i.name, desc: i.desc || '',
      price: i.sizes && i.sizes.length ? i.sizes[0].p : i.price, img: i.img || null, signature: !!i.combo,
    }));
    if (!cats.length || !items.length) return;
    CATS = cats; ITEMS = items; usingLiveMenu = true;
    activeCat = CATS[0].id;
    drawTabs(); drawMenu();
    if ($('demoBanner')) $('demoBanner').remove();
  } catch (e) { /* stays on the demo catalogue */ }
}

/* ---------------- header / nav overlay / scroll progress ---------------- */
const ov = $('ov');
const setOv = (o) => { ov.classList.toggle('open', o); ov.setAttribute('aria-hidden', !o); document.documentElement.classList.toggle('lock', o); };
$('menuOpen').onclick = () => setOv(true);
$('ovClose').onclick = () => setOv(false);
ov.querySelectorAll('[data-close]').forEach((a) => a.addEventListener('click', () => setOv(false)));
addEventListener('keydown', (e) => { if (e.key === 'Escape') { setOv(false); closeItem(); closeCart(); } });

let tick = false;
function onScroll() {
  if (tick) return;
  tick = true;
  requestAnimationFrame(() => {
    const y = scrollY, h = document.documentElement.scrollHeight - innerHeight;
    $('hdr').classList.toggle('stuck', y > 24);
    $('prog').style.width = (h > 0 ? (y / h) * 100 : 0) + '%';
    tick = false;
  });
}
addEventListener('scroll', onScroll, { passive: true });
onScroll();

const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('show'); io.unobserve(e.target); } }), { threshold: 0.12 });
document.querySelectorAll('.rv').forEach((el) => io.observe(el));

/* ---------------- toast ---------------- */
let toastT;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => t.classList.remove('show'), 3200);
}

/* ---------------- cart ---------------- */
const cart = {}; // id -> qty
const cartCount = () => Object.values(cart).reduce((a, b) => a + b, 0);
const cartTotal = () => Object.entries(cart).reduce((t, [id, q]) => t + ITEMS.find((i) => i.id === id).price * q, 0);
function setQty(id, q) {
  q = Math.max(0, q);
  if (q) cart[id] = q; else delete cart[id];
  drawCartBadge();
  drawMenu(true);
  if (!$('cartOv').classList.contains('open')) {} else drawCartItems();
}
function drawCartBadge() {
  const n = cartCount(), b = $('cartCount');
  b.textContent = n;
  b.classList.toggle('show', n > 0);
  $('twCount').textContent = n;
  $('twTotal').textContent = inr(cartTotal());
}
$('twGo').onclick = () => openTakeaway();

/* ---------------- menu grid ---------------- */
let activeCat = CATS[0].id;
function drawTabs() {
  $('menuTabs').innerHTML = CATS.map((c) => '<button class="mtab' + (c.id === activeCat ? ' on' : '') + '" data-c="' + c.id + '">' + esc(c.name) + '</button>').join('');
  $('menuTabs').querySelectorAll('.mtab').forEach((b) => (b.onclick = () => { activeCat = b.dataset.c; drawTabs(); drawMenu(); }));
}
function drawMenu(keep) {
  const grid = $('menuGrid'), items = ITEMS.filter((i) => i.cat === activeCat);
  grid.innerHTML = '';
  items.forEach((i, n) => {
    const q = cart[i.id] || 0;
    const c = document.createElement('div');
    c.className = 'mcard';
    c.style.setProperty('--i', keep ? 0 : n);
    if (keep) c.style.animation = 'none';
    c.innerHTML =
      '<div class="mpanel">' + visual(i) + (i.signature ? '<span class="tag">Signature</span>' : '') + '</div>' +
      '<div class="mbody"><div class="mname">' + esc(i.name) + '</div><p class="mdesc">' + esc(i.desc) + '</p>' +
      '<div class="mrow"><span class="mprice">' + inr(i.price) + '</span>' +
      (q ? '<span class="stepper"><button data-id="' + i.id + '" data-d="-1">−</button><b>' + q + '</b><button data-id="' + i.id + '" data-d="1">+</button></span>'
        : '<button class="addbtn" data-id="' + i.id + '" data-d="1">Add</button>') +
      '</div></div>';
    c.querySelector('.mpanel').onclick = () => openItem(i.id);
    c.querySelector('.mname').onclick = () => openItem(i.id);
    c.querySelectorAll('[data-id]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); setQty(i.id, (cart[i.id] || 0) + +b.dataset.d); }));
    grid.append(c);
  });
}
drawTabs();
drawMenu();
drawCartBadge();

/* ---------------- item detail panel ---------------- */
const itemOv = $('itemOv');
function openItem(id) {
  const i = ITEMS.find((x) => x.id === id);
  const related = ITEMS.filter((x) => x.cat === i.cat && x.id !== id).slice(0, 2);
  $('itemBody').innerHTML =
    '<div class="item-img">' + visual(i) + '</div>' +
    '<h3>' + esc(i.name) + '</h3><div class="price">' + inr(i.price) + '</div>' +
    '<p class="desc">' + esc(i.desc) + '</p>' +
    '<div class="qrow"><span>Quantity</span><span class="stepper" id="itQty"><button data-d="-1">−</button><b>1</b><button data-d="1">+</button></span></div>' +
    '<button class="btn wfull" id="itAdd">Add to cart · ' + inr(i.price) + '</button>' +
    (related.length
      ? '<p class="eyebrow" style="display:block;margin-top:26px;margin-bottom:8px">You may also like</p><div class="related">' +
        related.map((r) => '<div class="rc" data-id="' + r.id + '"><div class="ic">' + visual(r) + '</div><b>' + esc(r.name) + '</b><span>' + inr(r.price) + '</span></div>').join('') + '</div>'
      : '');
  let n = 1;
  const qb = $('itQty');
  qb.querySelectorAll('button').forEach((b) => (b.onclick = () => { n = Math.max(1, n + +b.dataset.d); qb.querySelector('b').textContent = n; $('itAdd').innerHTML = 'Add to cart · ' + inr(i.price * n); }));
  $('itAdd').onclick = () => { setQty(i.id, (cart[i.id] || 0) + n); toast(esc(i.name) + ' added to your cart'); closeItem(); };
  $('itemBody').querySelectorAll('.rc').forEach((r) => (r.onclick = () => openItem(r.dataset.id)));
  itemOv.classList.add('open');
  document.documentElement.classList.add('lock');
}
function closeItem() { itemOv.classList.remove('open'); if (!$('cartOv').classList.contains('open')) document.documentElement.classList.remove('lock'); }
itemOv.onclick = (e) => { if (e.target === itemOv) closeItem(); };
$('itemClose').onclick = closeItem;

/* ---------------- cart drawer ---------------- */
const cartOv = $('cartOv');
function openCart() { drawCartItems(); cartOv.classList.add('open'); document.documentElement.classList.add('lock'); }
function closeCart() { cartOv.classList.remove('open'); document.documentElement.classList.remove('lock'); }
cartOv.onclick = (e) => { if (e.target === cartOv) closeCart(); };
$('cartClose').onclick = closeCart;
$('cartOpen').onclick = openCart;
function drawCartItems() {
  const wrap = $('cartItems');
  const ids = Object.keys(cart);
  if (!ids.length) { wrap.innerHTML = '<div class="cart-empty">Your cart is empty.<br>Add something from the menu to begin.</div>'; $('cartFoot').style.display = 'none'; return; }
  $('cartFoot').style.display = 'block';
  wrap.innerHTML = ids.map((id) => {
    const i = ITEMS.find((x) => x.id === id), q = cart[id];
    return '<div class="cline"><div class="ic">' + visual(i) + '</div><div class="meta"><b>' + esc(i.name) + '</b><span>' + inr(i.price) + ' × ' + q + '</span></div><span class="stepper"><button data-id="' + id + '" data-d="-1">−</button><b>' + q + '</b><button data-id="' + id + '" data-d="1">+</button></span></div>';
  }).join('');
  wrap.querySelectorAll('[data-id]').forEach((b) => (b.onclick = () => setQty(b.dataset.id, cart[b.dataset.id] + +b.dataset.d)));
  $('cartTotal').textContent = inr(cartTotal());
}
$('cartCheckout').onclick = () => { closeCart(); TABLE_ID ? openDineIn() : openTakeaway(); };

/* ---------------- table-QR dine-in: already seated, no prepayment, straight to the kitchen
   (the same table-ordering flow site.html's QR pages already use) ---------------- */
function openDineIn() {
  if (!cartCount()) { toast('Add something to your cart first'); return; }
  const total = cartTotal();
  const ov = mkSheet(
    '<h3>Your order · Table ' + esc(TABLE_ID) + '</h3>' +
    '<div class="field"><label>Your name (optional)</label><input id="diName" placeholder="Your name"></div>' +
    '<div class="sline"><span>Items (' + cartCount() + ')</span><span>' + inr(total) + '</span></div>' +
    '<div class="sline tot"><b>Estimated total</b><b>' + inr(total) + '</b></div>' +
    '<p class="pay-note" style="margin:14px 0 0;text-align:left">No need to pay now — settle the bill with staff whenever you’re ready.</p>' +
    '<button class="btn wfull" id="diGo" style="margin-top:18px">Send to kitchen</button>'
  );
  ov.querySelector('#diGo').onclick = async () => {
    const btn = ov.querySelector('#diGo'), name = ov.querySelector('#diName').value.trim();
    btn.disabled = true; btn.textContent = 'Sending…';
    const r = await sendOrder(TABLE_ID, 'Dine-in order' + (name ? ' · ' + name : ''), name, '');
    closeSheet(ov);
    if (r.ok) {
      for (const k in cart) delete cart[k];
      drawCartBadge(); drawMenu();
      showOk('Sent to the kitchen', r.demo ? 'Preview only for now — once live, this lands straight on the kitchen screen for Table ' + TABLE_ID + '.' : 'Thank you! Your order is on its way.');
    } else { btn.disabled = false; btn.textContent = 'Send to kitchen'; toast(/busy/i.test((r.error && r.error.message) || '') ? 'Too many pending orders for this table — please call a staff member.' : 'Could not send the order. Please try again or call a staff member.'); }
  };
}
if (TABLE_ID) {
  const b = $('tableBanner');
  if (b) {
    b.style.display = 'flex';
    b.innerHTML = '<span>Table ' + esc(TABLE_ID) + ' — tap items below to add to your order</span><button class="btn sm line" id="callWaiterBtn">Call waiter</button>';
    $('callWaiterBtn').onclick = callWaiter;
  }
}

/* ---------------- demo UPI QR (same "pay by UPI while the real gateway is off" pattern
   already used in site/cart.html -- a placeholder id until the owner supplies the real one) */
const UPI_ID = '', UPI_NAME = 'Chapter One';
function renderPayQr(amount, holder) {
  const box = $('payQrBox');
  if (!UPI_ID) { box.innerHTML = '<p class="pay-note">Payment link will appear here once the owner’s UPI/payment details are set up.</p>'; return; }
  const url = 'upi://pay?pa=' + encodeURIComponent(UPI_ID) + '&pn=' + encodeURIComponent(UPI_NAME) + '&am=' + amount + '&cu=INR';
  box.innerHTML = '';
  try { const qr = qrcode(0, 'M'); qr.addData(url); qr.make(); box.innerHTML = qr.createImgTag(5, 6); } catch (e) { box.innerHTML = '<p class="pay-note">' + esc(url) + '</p>'; }
}

/* ---------------- order / reservation submission -- real the moment the tenant exists.
   "unknown tenant" (the one error place_order raises before anything else) is the ONLY error
   treated as "not provisioned yet, fall back to a demo confirmation" -- any other server
   refusal (self-order switched off, a busy table, a validation error) is shown for real, so a
   genuine problem on a live tenant is never silently swallowed as "demo mode". ---------------- */
async function sendOrder(t, note, name, phone) {
  const its = Object.entries(cart).map(([id, qty]) => ({ id, qty }));
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

/* ---------------- takeaway + required prepayment ---------------- */
function openTakeaway() {
  if (!cartCount()) { toast('Add something to your cart first'); return; }
  const total = cartTotal();
  const ov = mkSheet(
    '<h3>Takeaway order</h3>' +
    '<div class="field"><label>Your name</label><input id="coName" placeholder="Your name"></div>' +
    '<div class="field"><label>Mobile number</label><input id="coPhone" type="tel" placeholder="For pickup updates"></div>' +
    '<div class="field"><label>Pickup time</label><div class="pickup-opts"><button class="on" data-m="15">In 15 min</button><button data-m="30">In 30 min</button><button data-m="45">In 45 min</button></div></div>' +
    '<div class="sline"><span>Items (' + cartCount() + ')</span><span>' + inr(total) + '</span></div>' +
    '<div class="sline tot"><b>Total due</b><b>' + inr(total) + '</b></div>' +
    '<p class="pay-note" style="margin:14px 0 0;text-align:left">Takeaway orders are confirmed once paid — this keeps kitchen prep and no-shows under control.</p>' +
    '<button class="btn wfull" id="toPay" style="margin-top:18px">Continue to payment · ' + inr(total) + '</button>'
  );
  let mins = 15;
  ov.querySelectorAll('.pickup-opts button').forEach((b) => (b.onclick = () => { mins = +b.dataset.m; ov.querySelectorAll('.pickup-opts button').forEach((x) => x.classList.toggle('on', x === b)); }));
  ov.querySelector('#toPay').onclick = () => {
    const name = ov.querySelector('#coName').value.trim(), phone = ov.querySelector('#coPhone').value.trim();
    if (!name) { toast('Please enter your name'); return; }
    closeSheet(ov);
    openPayment(total, 'Takeaway · pickup in ' + mins + ' min · ' + name, 'Takeaway', name, phone);
  };
}
function openPayment(amount, note, tbl, name, phone) {
  const ov = mkSheet(
    '<h3>Pay to confirm</h3><p class="pay-note" style="text-align:left;margin-bottom:0">Scan with any UPI app. Your order is sent to the kitchen the moment payment is confirmed.</p>' +
    '<div class="pay-qr" id="payQrBox"></div>' +
    '<div class="sline tot"><b>Amount</b><b>' + inr(amount) + '</b></div>' +
    '<button class="btn wfull" id="payDone" style="margin-top:14px">I’ve paid · confirm order</button>' +
    '<button class="btn line wfull" id="payBack" style="margin-top:10px">Back</button>'
  );
  renderPayQr(amount);
  ov.querySelector('#payBack').onclick = () => closeSheet(ov);
  ov.querySelector('#payDone').onclick = async () => {
    const btn = ov.querySelector('#payDone');
    btn.disabled = true; btn.textContent = 'Confirming…';
    const r = await sendOrder(tbl, note + (LIVE ? '' : ' · PAID (demo)'), name, phone);
    closeSheet(ov);
    if (r.ok) {
      try {
        localStorage.setItem('chapterone_last_order', JSON.stringify({
          name: name || 'Guest', type: tbl,
          items: Object.entries(cart).map(([id, qty]) => { const i = ITEMS.find((x) => x.id === id); return { name: i.name, qty, price: i.price }; }),
          no: 'C1-' + Date.now().toString().slice(-6), date: new Date().toISOString().slice(0, 10),
        }));
      } catch (e) {}
      for (const k in cart) delete cart[k];
      drawCartBadge(); drawMenu();
      showOk('Order confirmed', r.demo ? 'This is a pitch preview — once Chapter One is live, this exact order lands straight in the kitchen screen at AUZsPOS.' : 'Thank you! Our kitchen has your order.', '/chapterone/invoice.html');
    } else { toast('Could not place the order. Please try again.'); }
  };
}

/* ---------------- reservations (reuses the guest-order inbox -- same trick call_waiter()
   already uses for a note-only entry, so no new backend is needed at all) ---------------- */
$('resForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, name = f.rname.value.trim(), phone = f.rphone.value.trim(), date = f.rdate.value, time = f.rtime.value, guests = f.rguests.value, note = f.rnote.value.trim();
  if (!name || !phone || !date || !time) { toast('Please fill in name, phone, date and time'); return; }
  const btn = f.querySelector('button[type=submit]');
  btn.disabled = true; btn.textContent = 'Sending…';
  const nt = 'Table reservation · ' + date + ' ' + time + ' · ' + guests + ' guest' + (guests > 1 ? 's' : '') + (note ? ' · ' + note : '');
  const prevCart = { ...cart };
  for (const k in cart) delete cart[k]; // reservations carry no items
  let r;
  try { r = await sendOrder('Reservation', nt, name, phone); }
  finally { Object.assign(cart, prevCart); drawCartBadge(); }
  btn.disabled = false; btn.textContent = 'Reserve a table';
  if (r.ok) { f.reset(); showOk('Table requested', r.demo ? 'Preview only for now — once live, this lands straight in the staff’s order screen, the same place a QR order would.' : 'We’ve received your request — our team will confirm shortly.'); }
  else toast('Could not send your request. Please call us instead.');
});

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

/* smooth-scroll for in-page nav links */
document.querySelectorAll('a[href^="#"]').forEach((a) => a.addEventListener('click', (e) => { const el = document.querySelector(a.getAttribute('href')); if (el) { e.preventDefault(); setOv(false); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }));

loadLiveMenu();
