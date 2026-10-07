/* Chapter One — homepage script. shared.js (loaded first) owns TENANT_SLUG/LIVE/sb, the demo
   menu, live-menu loading, the persisted cart, sendOrder/callWaiter, the UPI QR and the sheet
   helpers. This file is only what's specific to index.html: the header/nav chrome, the menu
   grid (now linking each item to its own real sub-page, item.html), applying the admin
   console's "Website & Booking" content onto this page's text, the cart drawer, and the
   takeaway/payment/reservation flows. */

/* ---------------- header / nav overlay / scroll progress ---------------- */
const ov = $('ov');
const setOv = (o) => { ov.classList.toggle('open', o); ov.setAttribute('aria-hidden', !o); document.documentElement.classList.toggle('lock', o); };
$('menuOpen').onclick = () => setOv(true);
$('ovClose').onclick = () => setOv(false);
ov.querySelectorAll('[data-close]').forEach((a) => a.addEventListener('click', () => setOv(false)));
addEventListener('keydown', (e) => { if (e.key === 'Escape') { setOv(false); closeCart(); } });

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

/* ---------------- content from the admin console's "Website & Booking" page (public_menu's
   own cfg object) -- called once loadLiveMenu() (in shared.js) resolves. Every field falls back
   to this page's own hand-written copy when the owner hasn't filled it in yet, so a brand-new
   tenant never shows a blank page. ---------------- */
function applyBranding(cfg) {
  const set = (id, val) => { if (val) { const el = $(id); if (el) el.textContent = val; } };
  set('heroKicker', cfg.siteKicker);
  set('heroTitle', cfg.siteTag);
  set('heroSub', cfg.siteSub);
  set('storyKicker', cfg.siteKicker);
  set('footAbout', cfg.siteAbout);
  set('footHours', cfg.siteHours);
  set('footAddr', cfg.addr);
  if (cfg.siteInsta) { const a = $('footInsta'); if (a) { a.textContent = '✉ @' + cfg.siteInsta.replace(/^@/, ''); a.href = 'https://instagram.com/' + cfg.siteInsta.replace(/^@/, ''); } }
  if (cfg.siteAbout) {
    const p = document.querySelector('#story .story-text p');
    if (p) p.textContent = cfg.siteAbout;
  }
  // The owner's own hero/about photos (Management console -> Website & Booking -> Hero
  // photo / About-section photo) replace the hand-drawn logo mark and the "C" founder
  // monogram once uploaded -- until then both keep their current placeholder look.
  if (cfg.siteHero) { const m = $('heroMark'); if (m) m.src = cfg.siteHero; const art = $('heroArt'); if (art) art.classList.add('has-photo'); }
  if (cfg.siteAboutImg) {
    const av = $('founderAvatar');
    if (av) av.innerHTML = '<img src="' + esc(cfg.siteAboutImg) + '" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">';
  }
  // The 3-step "Ground / Poured / Served" scenes each get a real photo from the owner's
  // gallery (Website & Booking -> Gallery photos), in upload order, once there are enough --
  // the decorative line-art icon keeps showing in any slot that has none yet.
  const gal = (cfg.siteGallery || '').split(',').map((s) => s.trim()).filter(Boolean);
  [1, 2, 3].forEach((n, i) => {
    const url = gal[i];
    if (!url) return;
    const el = $('bphoto' + n);
    if (!el) return;
    el.style.backgroundImage = 'url(' + url.replace(/[()]/g, '') + ')';
    el.classList.add('has-photo');
  });
}

/* ---------------- toast / cart badge wiring ---------------- */
function onCartChanged() { drawCartBadge(); drawMenu(true); if (cartOv.classList.contains('open')) drawCartItems(); }
$('twGo').onclick = () => openTakeaway();

/* ---------------- menu grid: every card now opens a real sub-page (item.html?id=...), not a
   modal -- a genuine, bookmarkable, shareable URL per item, per the brief: "a fully professional
   multi-page and sub-pages website." ---------------- */
let activeCat = CATS[0].id;
function drawTabs() {
  $('menuTabs').innerHTML = CATS.map((c) => '<button class="mtab' + (c.id === activeCat ? ' on' : '') + '" data-c="' + c.id + '">' + esc(c.name) + '</button>').join('');
  $('menuTabs').querySelectorAll('.mtab').forEach((b) => (b.onclick = () => { activeCat = b.dataset.c; drawTabs(); drawMenu(); }));
}
function drawMenu(keep) {
  const grid = $('menuGrid'), items = ITEMS.filter((i) => i.cat === activeCat);
  grid.innerHTML = '';
  items.forEach((i, n) => {
    const hasSizes = i.sizes && i.sizes.length;
    const qtyInCart = Object.values(cart).filter((c) => c.id === i.id).reduce((a, c) => a + c.qty, 0);
    const card = document.createElement('a');
    card.className = 'mcard';
    card.href = '/chapterone/item.html?id=' + encodeURIComponent(i.id);
    card.style.textDecoration = 'none';
    card.style.display = 'block';
    card.style.setProperty('--i', keep ? 0 : n);
    if (keep) card.style.animation = 'none';
    card.innerHTML =
      '<div class="mpanel">' + visual(i) + (i.signature ? '<span class="tag">Signature</span>' : '') + '</div>' +
      '<div class="mbody"><div class="mname">' + esc(i.name) + '</div><p class="mdesc">' + esc(i.desc) + '</p>' +
      '<div class="mrow"><span class="mprice">' + inr(itemPrice(i, null)) + (hasSizes ? ' +' : '') + '</span>' +
      (qtyInCart ? '<span class="tag" style="position:static">' + qtyInCart + ' in cart</span>' : '<span class="addbtn" style="pointer-events:none">View</span>') +
      '</div></div>';
    grid.append(card);
  });
}
drawTabs();
drawMenu();
drawCartBadge();

/* Without this hook, loadLiveMenu() (shared.js) happily swaps CATS/ITEMS from the demo
   catalogue to the owner's real one the instant the tenant exists, but nothing ever told
   THIS page to redraw -- the homepage kept showing the demo menu forever, with every card
   still linking to a demo item id. item.html (which does redraw on load) would then look
   that demo id up in the real catalogue, find nothing, and show "not found" -- not a race,
   a guaranteed miss the moment a real menu exists. */
function onMenuLoaded() { activeCat = CATS[0].id; drawTabs(); drawMenu(); }

/* ---------------- cart drawer ---------------- */
const cartOv = $('cartOv');
function openCart() { drawCartItems(); cartOv.classList.add('open'); document.documentElement.classList.add('lock'); }
function closeCart() { cartOv.classList.remove('open'); document.documentElement.classList.remove('lock'); }
cartOv.onclick = (e) => { if (e.target === cartOv) closeCart(); };
$('cartClose').onclick = closeCart;
$('cartOpen').onclick = openCart;
function drawCartItems() {
  const wrap = $('cartItems');
  const keys = Object.keys(cart);
  if (!keys.length) { wrap.innerHTML = '<div class="cart-empty">Your cart is empty.<br>Add something from the menu to begin.</div>'; $('cartFoot').style.display = 'none'; return; }
  $('cartFoot').style.display = 'block';
  wrap.innerHTML = keys.map((k) => {
    const c = cart[k], i = ITEMS.find((x) => x.id === c.id);
    if (!i) return '';
    return '<div class="cline"><div class="ic">' + visual(i) + '</div><div class="meta"><b>' + esc(i.name) + (c.size ? ' (' + esc(c.size) + ')' : '') + '</b><span>' + inr(itemPrice(i, c.size)) + ' × ' + c.qty + '</span></div><span class="stepper"><button data-k="' + k + '" data-d="-1">−</button><b>' + c.qty + '</b><button data-k="' + k + '" data-d="1">+</button></span></div>';
  }).join('');
  wrap.querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => setCartQty(b.dataset.k, cart[b.dataset.k].qty + +b.dataset.d)));
  $('cartTotal').textContent = inr(cartTotal());
}
$('cartCheckout').onclick = () => { closeCart(); TABLE_ID ? openDineIn() : openTakeaway(); };

/* ---------------- table-QR dine-in: already seated, no prepayment, straight to the kitchen
   (the same table-ordering flow site.html's QR pages already use) ---------------- */
function openDineIn() {
  if (!cartCount()) { toast('Add something to your cart first'); return; }
  const total = cartTotal();
  const sheet = mkSheet(
    '<h3>Your order · Table ' + esc(TABLE_ID) + '</h3>' +
    '<div class="field"><label>Your name (optional)</label><input id="diName" placeholder="Your name"></div>' +
    '<div class="sline"><span>Items (' + cartCount() + ')</span><span>' + inr(total) + '</span></div>' +
    '<div class="sline tot"><b>Estimated total</b><b>' + inr(total) + '</b></div>' +
    '<p class="pay-note" style="margin:14px 0 0;text-align:left">No need to pay now — settle the bill with staff whenever you’re ready.</p>' +
    '<button class="btn wfull" id="diGo" style="margin-top:18px">Send to kitchen</button>'
  );
  sheet.querySelector('#diGo').onclick = async () => {
    const btn = sheet.querySelector('#diGo'), name = sheet.querySelector('#diName').value.trim();
    btn.disabled = true; btn.textContent = 'Sending…';
    const r = await sendOrder(TABLE_ID, 'Dine-in order' + (name ? ' · ' + name : ''), name, '');
    closeSheet(sheet);
    if (r.ok) {
      clearCart(); drawMenu();
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

/* ---------------- takeaway + required prepayment ---------------- */
function openTakeaway() {
  if (!cartCount()) { toast('Add something to your cart first'); return; }
  const total = cartTotal();
  const sheet = mkSheet(
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
  sheet.querySelectorAll('.pickup-opts button').forEach((b) => (b.onclick = () => { mins = +b.dataset.m; sheet.querySelectorAll('.pickup-opts button').forEach((x) => x.classList.toggle('on', x === b)); }));
  sheet.querySelector('#toPay').onclick = () => {
    const name = sheet.querySelector('#coName').value.trim(), phone = sheet.querySelector('#coPhone').value.trim();
    if (!name) { toast('Please enter your name'); return; }
    closeSheet(sheet);
    openPayment(total, 'Takeaway · pickup in ' + mins + ' min · ' + name, 'Takeaway', name, phone);
  };
}
function openPayment(amount, note, tbl, name, phone) {
  const sheet = mkSheet(
    '<h3>Pay to confirm</h3><p class="pay-note" style="text-align:left;margin-bottom:0">Scan with any UPI app. Your order is sent to the kitchen the moment payment is confirmed.</p>' +
    '<div class="pay-qr" id="payQrBox"></div>' +
    '<div class="sline tot"><b>Amount</b><b>' + inr(amount) + '</b></div>' +
    '<button class="btn wfull" id="payDone" style="margin-top:14px">I’ve paid · confirm order</button>' +
    '<button class="btn line wfull" id="payBack" style="margin-top:10px">Back</button>'
  );
  renderPayQr(amount);
  sheet.querySelector('#payBack').onclick = () => closeSheet(sheet);
  sheet.querySelector('#payDone').onclick = async () => {
    const btn = sheet.querySelector('#payDone');
    btn.disabled = true; btn.textContent = 'Confirming…';
    const r = await sendOrder(tbl, note + (LIVE ? '' : ' · PAID (demo)'), name, phone);
    closeSheet(sheet);
    if (r.ok) {
      try {
        localStorage.setItem('chapterone_last_order', JSON.stringify({
          name: name || 'Guest', type: tbl,
          items: Object.values(cart).map((c) => { const i = ITEMS.find((x) => x.id === c.id); return { name: i.name + (c.size ? ' (' + c.size + ')' : ''), qty: c.qty, price: itemPrice(i, c.size) }; }),
          no: 'C1-' + Date.now().toString().slice(-6), date: new Date().toISOString().slice(0, 10),
        }));
      } catch (e) {}
      clearCart(); drawMenu();
      showOk('Order confirmed', r.demo ? 'This is a pitch preview — once Chapter One is live, this exact order lands straight in the kitchen screen at AUZsPOS.' : 'Thank you! Our kitchen has your order.', '/chapterone/invoice.html');
    } else { toast('Could not place the order. Please try again.'); }
  };
}

/* ---------------- reservations: a real booking (public_create_reservation, db/127), shows up
   in the staff's actual Reservations screen -- not the old guest-order-note trick ---------------- */
$('resForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target, name = f.rname.value.trim(), phone = f.rphone.value.trim(), date = f.rdate.value, time = f.rtime.value, guests = Number(f.rguests.value) || 1, note = f.rnote.value.trim();
  if (!name || !phone || !date || !time) { toast('Please fill in name, phone, date and time'); return; }
  const btn = f.querySelector('button[type=submit]');
  btn.disabled = true; btn.textContent = 'Sending…';
  const r = await sendReservation(name, phone, date, time, guests, note);
  btn.disabled = false; btn.textContent = 'Reserve a table';
  if (r.ok) { f.reset(); showOk('Table requested', r.demo ? 'Preview only for now — once live, this lands straight in the staff’s reservations list, ready for them to confirm.' : 'We’ve received your request — our team will confirm shortly.'); }
  else toast('Could not send your request. Please call us instead.');
});

/* smooth-scroll for in-page nav links */
document.querySelectorAll('a[href^="#"]').forEach((a) => a.addEventListener('click', (e) => { const el = document.querySelector(a.getAttribute('href')); if (el) { e.preventDefault(); setOv(false); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }));
