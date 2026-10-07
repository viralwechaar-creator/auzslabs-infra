/* Chapter One — item sub-page. Real page per item (not a modal), with its own URL, shareable
   and bookmarkable: /chapterone/item.html?id=<id>. Reads shared.js's ITEMS/CATS/cart. */

/* ---------------- header / nav overlay / scroll progress (same as index.html) ---------------- */
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

/* ---------------- cart drawer (same markup/behaviour as index.html's) ---------------- */
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
  wrap.querySelectorAll('[data-k]').forEach((b) => (b.onclick = () => { setCartQty(b.dataset.k, cart[b.dataset.k].qty + +b.dataset.d); drawCartItems(); }));
  $('cartTotal').textContent = inr(cartTotal());
}
$('cartCheckout').onclick = () => { location.href = '/chapterone/index.html#takeaway'; };
function onCartChanged() { drawCartBadge(); }

/* ---------------- the item itself ---------------- */
const ITEM_ID = qs('id');
let chosenSize = null, chosenQty = 1;

function renderItem() {
  const i = ITEMS.find((x) => x.id === ITEM_ID);
  if (!i) {
    $('itemRoot').innerHTML = '<p class="muted">We couldn’t find that item — it may have been taken off the menu. <a href="/chapterone/index.html#menu" style="color:var(--rust)">Back to the menu</a>.</p>';
    $('ibcName').textContent = 'Not found';
    document.title = 'Chapter One — Item not found';
    $('relLabel').style.display = 'none';
    return;
  }
  document.title = i.name + ' — Chapter One';
  $('ibcName').textContent = i.name;
  if (chosenSize === null) chosenSize = i.sizes && i.sizes.length ? i.sizes[0].l : null;
  const price = itemPrice(i, chosenSize);
  $('itemRoot').innerHTML =
    '<div class="item-img">' + visual(i) + '</div>' +
    '<div class="iinfo">' +
    (i.signature ? '<p class="eyebrow">Signature</p>' : '') +
    '<h1>' + esc(i.name) + '</h1>' +
    '<div class="price" id="itPrice">' + inr(price) + '</div>' +
    '<p class="desc" style="margin:14px 0 0">' + esc(i.desc || 'A Chapter One favourite.') + '</p>' +
    (i.sizes && i.sizes.length ? '<div class="ipills" id="itPills">' + i.sizes.map((s) => '<button class="ipill' + (s.l === chosenSize ? ' on' : '') + '" data-l="' + esc(s.l) + '">' + esc(s.l) + ' · ' + inr(s.p) + '</button>').join('') + '</div>' : '') +
    '<div class="qrow"><span>Quantity</span><span class="stepper" id="itQty"><button data-d="-1">−</button><b>' + chosenQty + '</b><button data-d="1">+</button></span></div>' +
    '<button class="btn wfull" id="itAdd" style="margin-top:6px">Add to cart · ' + inr(price * chosenQty) + '</button>' +
    '</div>';

  const pills = $('itPills');
  if (pills) pills.querySelectorAll('.ipill').forEach((b) => (b.onclick = () => { chosenSize = b.dataset.l; chosenQty = 1; renderItem(); }));
  const qb = $('itQty');
  qb.querySelectorAll('button').forEach((b) => (b.onclick = () => { chosenQty = Math.max(1, chosenQty + +b.dataset.d); renderItem(); }));
  $('itAdd').onclick = () => { addToCart(i.id, chosenSize, chosenQty); toast(esc(i.name) + ' added to your cart'); chosenQty = 1; };

  // related items: same category, excluding this one
  const related = ITEMS.filter((x) => x.cat === i.cat && x.id !== i.id).slice(0, 3);
  $('relLabel').style.display = related.length ? 'block' : 'none';
  $('relatedGrid').innerHTML = related.map((r) => {
    const rp = itemPrice(r, null);
    return '<a class="mcard" href="/chapterone/item.html?id=' + encodeURIComponent(r.id) + '" style="text-decoration:none;display:block">' +
      '<div class="mpanel">' + visual(r) + (r.signature ? '<span class="tag">Signature</span>' : '') + '</div>' +
      '<div class="mbody"><div class="mname">' + esc(r.name) + '</div><p class="mdesc">' + esc(r.desc) + '</p>' +
      '<div class="mrow"><span class="mprice">' + inr(rp) + (r.sizes && r.sizes.length ? ' +' : '') + '</span></div></div></a>';
  }).join('');
}

function onMenuLoaded() { chosenSize = null; chosenQty = 1; renderItem(); }

drawCartBadge();
renderItem();
