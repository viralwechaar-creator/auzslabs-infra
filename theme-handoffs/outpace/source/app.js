'use strict';

const catalog = [
  { id:'vector-01', name:'Vector 01', style:'Running', color:'Mercury / Black', price:5290, was:7490, photo:'vector', sizes:[6,7,8,9,10,11], note:'Airy mesh and a sculpted midsole built for long days on pavement.' },
  { id:'terrain-03', name:'Terrain 03', style:'Trail', color:'Burnt Clay / Coal', price:4790, was:7990, photo:'terrain', sizes:[7,8,9,10], drop:true, note:'A lugged tread and reinforced panels for loose ground and sharp turns.' },
  { id:'court-02', name:'Court 02', style:'Court', color:'Bone / Gum', price:3890, was:5490, photo:'court', sizes:[6,7,8,9,10], note:'A low-profile court silhouette with an off-white upper and gum outsole.' },
  { id:'vector-blue', name:'Vector 01 Blue', style:'Running', color:'Ultramarine / Cream', price:5690, was:6990, photo:'blue', sizes:[9], drop:true, note:'The Vector runner in a limited ultramarine and cream colourway.' }
];
const sizes = [6,7,8,9,10,11];
const styles = ['Running','Court','Trail'];
const byId = id => catalog.find(item => item.id === id);
const main = document.querySelector('#main');
const asset = key => 'assets/' + key + '.jpg';
const money = value => '₹' + value.toLocaleString('en-IN');
const discount = item => Math.round(100 * (1 - item.price / item.was));
const read = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem('outpace-' + key)) ?? fallback; }
  catch { return fallback; }
};
const save = (key, value) => {
  try { localStorage.setItem('outpace-' + key, JSON.stringify(value)); }
  catch { /* Shopping still works in the current tab. */ }
};
let bag = read('bag', []);
let coupon = read('coupon', false);
let receipt = null;
let toastTimer;
let deadline = read('deadline', 0);
if (!deadline) {
  deadline = Date.now() + 3 * 864e5;
  save('deadline', deadline);
}
const toast = message => {
  const output = document.querySelector('#toast');
  output.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { output.textContent = ''; }, 2800);
};

function tile(item) {
  const limited = item.sizes.length === 1 ? '<span class="last-size">Only UK ' + item.sizes[0] + ' left</span>' : '';
  return '<article class="tile"><a href="#/product/' + item.id + '"><div class="tile-photo"><img loading="lazy" src="' + asset(item.photo) + '" alt="' + item.name + ' in ' + item.color + '"><span class="sale-badge">−' + discount(item) + '%</span>' + limited + '<span class="tile-arrow" aria-hidden="true">↗</span></div><div class="tile-info"><span class="eyebrow">' + item.style + ' / ' + item.color + '</span><h3>' + item.name + '</h3><div class="meta"><span class="price">' + money(item.price) + ' <del>' + money(item.was) + '</del></span><span class="pair-link">Shop pair ↗</span></div></div></a></article>';
}

function tiles(items) {
  return '<div class="grid">' + items.map(tile).join('') + '</div>';
}

function signup() {
  return '<section class="section signup" id="early-access"><span class="eyebrow">The first lap</span><h2>Get in early.</h2><p>Hear about limited colourways and sale dates.</p><form id="signup" class="signup-form"><label for="signup-mail">Email address</label><div class="inline"><input id="signup-mail" name="email" type="email" placeholder="you@example.com" required><button class="button">Join the list</button></div><label class="check"><input type="checkbox" required> I agree to the <a href="#/privacy">privacy notice</a>.</label><small class="muted">Demo signup stays in this browser.</small></form></section>';
}

function faq() {
  return '<section class="section faq"><div><span class="eyebrow">Sale and delivery</span><h2>Before you lace up.</h2></div><div><details><summary>When does the sale end?</summary><p>The countdown on the sale page shows the time remaining in this demo.</p></details><details><summary>Is standard delivery free?</summary><p>Yes. Standard delivery is free in this preview. See <a href="#/shipping">shipping and returns</a> for timings.</p></details><details><summary>How do I choose a size?</summary><p>Check the UK size picker and size guide on the product page.</p></details><details><summary>How does early access work?</summary><p><a href="#/early-access">Join the demo early access list</a> to preview the signup.</p></details><details><summary>Can I return to checkout later?</summary><p>Your bag and promo code stay in this browser. You’ll enter your checkout details when you return.</p></details><details><summary>Where do I enter the sale code?</summary><p>Apply AFTER10 in your bag or at checkout for an extra 10%.</p></details></div></section>';
}

function drops() {
  const items = catalog.filter(item => item.drop);
  return '<section class="editorial"><figure class="drop-photo"><img loading="lazy" src="' + asset('editorial') + '" alt="Blue Vector sneakers on concrete stairs"><figcaption>OUTPACE FIELD NOTES / THE BLUE HOUR</figcaption></figure><div class="drop-content"><span class="eyebrow">Limited drops</span><h2>The blue hour.</h2><p>Small runs in colours that take a different route.</p><div class="drop-list">' + items.map(item => '<a href="#/product/' + item.id + '"><img loading="lazy" src="' + asset(item.photo) + '" alt=""><span><strong>' + item.name + '</strong><small>' + item.color + '</small></span><strong>' + money(item.price) + '</strong><span aria-hidden="true">↗</span></a>').join('') + '</div><a class="button outline" href="#/shop">See all sneakers ↗</a></div></section>';
}

function promo() {
  return '<div class="promo"><span><small>Extra 10% with code</small><strong>AFTER10</strong></span><button data-action="copy" type="button">Copy code</button></div>';
}

function collections() {
  const photos = { Running:'street', Court:'courtside', Trail:'terrain' };
  return '<section class="section collections"><div class="section-head"><div><span class="eyebrow">Explore by style</span><h2>Find your lane.</h2></div><a href="#/shop">Shop all ↗</a></div><div class="collection-grid">' +
    styles.map(style => '<a class="collection-card" href="#/shop?style=' + style + '"><img loading="lazy" src="' + asset(photos[style]) + '" alt=""><span>' + style + ' <b aria-hidden="true">↗</b></span></a>').join('') + '</div></section>';
}

function campaignFeature() {
  return '<section class="field-story"><div class="field-copy"><span class="eyebrow">Court 02 / Bone &amp; Gum</span><h2>From the court to the curb.</h2><p>Low-profile leather and a gum sole. An easy pair for days that start on the court and end somewhere else.</p><a class="button outline" href="#/product/court-02">Explore Court 02 ↗</a></div><figure><img loading="lazy" src="' + asset('courtside') + '" alt="Bone leather court sneakers beside a painted court line"><figcaption>Court 02 / Outpace field notes</figcaption></figure></section>';
}

function serviceGuide() {
  return '<section class="section service-guide" aria-label="Shopping information"><article><span class="service-mark" aria-hidden="true">↗</span><h3>Free standard delivery</h3><p>Estimated 4–7 business days across India.</p><a href="#/shipping">Delivery details ↗</a></article><article><span class="service-mark" aria-hidden="true">↶</span><h3>14-day returns</h3><p>Return unworn pairs in their original packaging.</p><a href="#/shipping">Return details ↗</a></article><article><span class="service-mark" aria-hidden="true">↔</span><h3>Find your fit</h3><p>Filter the lineup by the UK size you wear.</p><a href="#/shop">Browse available sizes ↗</a></article></section>';
}

function home() {
  return '<section class="hero" style="--hero:url(' + asset('hero') + ')"><div class="hero-content"><span class="eyebrow">Outpace / Sale collection</span><h1>AFTER <em>HOURS.</em></h1><p>Street, court and trail sneakers for wherever the day takes you.</p><div class="action-row"><a class="button lime" href="#/shop">Shop the sale ↗</a>' + promo() + '</div></div><div class="hero-offer"><span>UP TO</span><strong>40%</strong><span>OFF</span></div><div class="hero-utility"><a href="#/shipping"><strong>Free standard delivery</strong><small>Across India</small></a><button class="scroll-link" type="button" data-action="browse">Browse the lineup ↓</button><div class="clock"><span>Sale countdown</span><time id="timer"></time><small>Days / Hrs / Min / Sec</small></div></div></section>' +
    '<div class="styles-band" aria-label="Shop by style"><span>Shop by style</span><a href="#/shop?style=Running">Running ↗</a><a href="#/shop?style=Court">Court ↗</a><a href="#/shop?style=Trail">Trail ↗</a></div>' +
    '<section class="section" id="lineup"><div class="section-head"><div><span class="eyebrow">The sale edit</span><h2>Shop the lineup.</h2></div><a href="#/shop">Shop all ↗</a></div>' + filterPanel() + '</section>' +
    collections() + drops() + campaignFeature() + signup() + serviceGuide() + faq();
}

function choices(options) {
  return options.map(([value,label]) => '<option value="' + value + '">' + label + '</option>').join('');
}

function filterPanel() {
  return '<form class="filter-panel" id="filters"><fieldset class="style-tabs"><legend class="sr-only">Filter by style</legend>' +
    [['','All styles'],...styles.map(style => [style,style])].map(([value,label]) => '<label><input name="style" type="radio" value="' + value + '"' + (value ? '' : ' checked') + '><span>' + label + '</span></label>').join('') +
    '</fieldset><button class="filter-toggle" type="button" aria-expanded="false" aria-controls="filter-options">Filters and sort</button><div class="filters" id="filter-options"><label>Search<input name="search" type="search" placeholder="Search sneakers"></label><label>UK size<select name="size">' + choices([['','All sizes'],...sizes.map(size => [size,size])]) + '</select></label><label>Discount<select name="sale">' + choices([['','All discounts'],['1','On sale'],['30','30% and up']]) + '</select></label><label>Sort<select name="sort">' + choices([['','Featured'],['low','Price low to high'],['high','Price high to low'],['sale','Biggest discount']]) + '</select></label><button type="reset" class="button outline">Clear</button></div></form><p class="result-count" role="status"></p><div id="results"></div>';
}

function setupFilters(query) {
  const form = document.querySelector('#filters');
  const params = new URLSearchParams(query);
  const toggle = form.querySelector('.filter-toggle');
  toggle.addEventListener('click', () => {
    toggle.setAttribute('aria-expanded', String(toggle.getAttribute('aria-expanded') !== 'true'));
  });
  if (params.get('focus') === 'search' || ['search','size','sale','sort'].some(key => params.has(key))) {
    toggle.setAttribute('aria-expanded','true');
  }
  for (const [key,value] of params) {
    const control = form.elements.namedItem(key);
    if (control) control.value = value;
  }
  function update() {
    const filters = new FormData(form);
    const search = filters.get('search').trim().toLowerCase();
    const items = catalog.filter(item => {
      return (item.name + ' ' + item.color + ' ' + item.style).toLowerCase().includes(search)
        && (!filters.get('style') || filters.get('style') === item.style)
        && (!filters.get('size') || item.sizes.includes(Number(filters.get('size'))))
        && (!filters.get('sale') || discount(item) >= Number(filters.get('sale')));
    });
    const sort = filters.get('sort');
    if (sort === 'low') items.sort((a,b) => a.price - b.price);
    if (sort === 'high') items.sort((a,b) => b.price - a.price);
    if (sort === 'sale') items.sort((a,b) => discount(b) - discount(a));
    document.querySelector('.result-count').textContent = items.length + (items.length === 1 ? ' pair' : ' pairs');
    document.querySelector('#results').innerHTML = items.length ? tiles(items) : '<p>No sneakers match those filters.</p>';
  }
  form.addEventListener('input', update);
  form.addEventListener('submit', event => event.preventDefault());
  form.addEventListener('reset', () => setTimeout(update, 0));
  update();
}

function shop(query) {
  main.innerHTML = '<section class="section"><span class="eyebrow">Running · Court · Trail</span><h1>Shop the lineup.</h1>' + filterPanel() + '</section>';
  setupFilters(query);
}

function product(item) {
  return '<section class="section"><a class="crumb" href="#/shop">← All sneakers</a><div class="product"><div><div class="product-photo"><img src="' + asset(item.photo) + '" alt="' + item.name + ' in ' + item.color + '"></div><div class="gallery-list" aria-label="Image views">' + [['full','Full shoe'],['upper','Upper crop'],['sole','Sole crop']].map(([key,label],index) => '<button data-view="' + key + '" aria-pressed="' + (index === 0) + '">' + label + '</button>').join('') + '</div></div><div><span class="eyebrow">' + item.style + ' / ' + item.color + '</span><h1>' + item.name + '</h1><p><strong>' + money(item.price) + '</strong> <del>' + money(item.was) + '</del></p><p>' + item.note + '</p><form id="add" data-product="' + item.id + '"><fieldset><legend>Select UK size</legend><div class="sizes">' + sizes.map(size => '<label><input name="size" type="radio" value="' + size + '" ' + (item.sizes.includes(size) ? 'required' : 'disabled') + '><span>' + size + '</span></label>').join('') + '</div></fieldset><button class="button lime">Add to bag</button></form><details><summary>Size guide</summary><p>Use your usual UK sneaker size. If you are between sizes, start with the larger size.</p></details><details><summary>Delivery and returns</summary><p><a href="#/shipping">Read the shipping and returns guide.</a></p></details></div></div></section><section class="section"><div class="section-head"><h2>More to try.</h2><a href="#/shop">Shop all ↗</a></div>' + tiles(catalog.filter(other => other.id !== item.id)) + '</section>';
}

function totals(express = false) {
  const subtotal = bag.reduce((sum,line) => sum + byId(line.id).price * line.qty, 0);
  const reduction = coupon ? Math.round(subtotal * .1) : 0;
  const shipping = express ? 199 : 0;
  return { subtotal, reduction, shipping, total:subtotal - reduction + shipping };
}

function summary(express) {
  const {subtotal,reduction,shipping,total} = totals(express);
  return '<div><dt>Subtotal</dt><dd>' + money(subtotal) + '</dd></div>' + (reduction ? '<div><dt>AFTER10</dt><dd>−' + money(reduction) + '</dd></div>' : '') + '<div><dt>Delivery</dt><dd>' + (shipping ? money(shipping) : 'Free') + '</dd></div><div><dt>Total</dt><dd>' + money(total) + '</dd></div>';
}

function lineItem(line, index) {
  const item = byId(line.id);
  return '<div class="cart-row"><a href="#/product/' + item.id + '"><img src="' + asset(item.photo) + '" alt="' + item.name + '"></a><div><strong>' + item.name + '</strong><p>UK ' + line.size + '</p><div class="quantity"><button aria-label="Decrease quantity of ' + item.name + '" data-line="' + index + '" data-action="less">−</button><span>' + line.qty + '</span><button aria-label="Increase quantity of ' + item.name + '" data-line="' + index + '" data-action="more">+</button><button class="remove" data-line="' + index + '" data-action="remove">Remove</button></div></div><strong>' + money(item.price * line.qty) + '</strong></div>';
}

function cart() {
  return '<section class="section"><h1>Your bag.</h1>' + (bag.length ? '<div class="cart-layout"><div>' + bag.map(lineItem).join('') + '<p><a href="#/shop">Continue shopping ↗</a></p></div><aside class="summary"><h2>Order summary</h2><form id="coupon"><label>Promo code<input name="code" placeholder="AFTER10" required></label><p class="action-row"><button class="button outline">Apply</button>' + (coupon ? '<button type="button" class="button outline" data-action="remove-coupon">Remove code</button>' : '') + '</p></form><dl>' + summary() + '</dl><a class="button lime" href="#/checkout">Checkout ↗</a></aside></div>' : '<p>Your bag is empty.</p><a class="button" href="#/shop">Shop sneakers ↗</a>') + '</section>';
}

function checkout() {
  if (!bag.length) return cart();
  return '<section class="section"><a class="crumb" href="#/cart">← Back to bag</a><span class="eyebrow">Outpace / Order details</span><h1>Checkout.</h1><div class="checkout"><form id="checkout" class="checkout-form"><p class="notice">Use sample details for this demo. No payment is collected.</p><fieldset><legend>Contact</legend><div class="form-grid"><label>Email<input type="email" name="email" required autocomplete="email"></label><label>Phone<input type="tel" name="phone" autocomplete="tel" required></label></div></fieldset><fieldset><legend>Shipping address</legend><div class="form-grid"><label>First name<input name="first" required autocomplete="given-name"></label><label>Last name<input name="last" required autocomplete="family-name"></label><label class="full">Street address<input name="address" required autocomplete="street-address"></label><label class="full">Apartment (optional)<input name="unit" autocomplete="address-line2"></label><label>City<input name="city" required autocomplete="address-level2"></label><label>State<input name="state" required autocomplete="address-level1"></label><label>PIN code<input name="postal" pattern="[1-9][0-9]{5}" inputmode="numeric" required autocomplete="postal-code"></label><label>Country<input value="India" readonly autocomplete="country-name"></label></div></fieldset><fieldset><legend>Shipping method</legend><label class="sr-only" for="delivery">Delivery method</label><select id="delivery" name="shipping"><option value="standard">Standard · 4–7 business days · Free</option><option value="express">Express · 2–3 business days · ₹199</option></select></fieldset><fieldset><legend>Payment</legend><label class="check"><input type="radio" name="payment" value="test" checked> Test payment</label><p class="muted">Places a sample order in this preview.</p></fieldset><label class="check"><input type="checkbox" required> I have reviewed the <a href="#/shipping">shipping and returns guide</a>.</label><button class="button lime">Place demo order ↗</button></form><aside class="summary"><span class="eyebrow">Your selection</span><h2>Order summary</h2>' + bag.map(line => { const item = byId(line.id); return '<div class="checkout-item"><img src="' + asset(item.photo) + '" alt=""><span><strong>' + item.name + '</strong><small>UK ' + line.size + ' · Qty ' + line.qty + '</small></span><strong>' + money(item.price * line.qty) + '</strong></div>'; }).join('') + '<form id="checkout-promo"><label for="checkout-code">Promo code</label><div class="inline"><input id="checkout-code" name="code" placeholder="AFTER10" required><button class="button outline">Apply</button></div></form><dl id="checkout-totals">' + summary() + '</dl></aside></div></section>';
}

const info = {
  shipping: '<h1>Shipping &amp; returns.</h1><h3>Delivery in India</h3><p>Standard delivery is free and is estimated at 4–7 business days. Express delivery is ₹199.</p><h3>Returns</h3><p>Sample storefront policy: request a return within 14 days for unworn shoes in their original packaging.</p>',
  privacy: '<h1>Privacy.</h1><p>The preview stores your bag, promo code and signup confirmation in your browser. Checkout details are used in the current page and discarded when you leave.</p><p>Optional trackers are absent. You can reset the preview by clearing this site’s browser data.</p>'
};

function render(scroll = true) {
  const [path,query] = (location.hash.slice(1) || '/').split('?');
  document.querySelectorAll('.nav a').forEach(link => {
    if (link.hash === '#' + path) link.setAttribute('aria-current','page');
    else link.removeAttribute('aria-current');
  });
  document.querySelector('#bag-count').textContent = bag.reduce((sum,line) => sum + line.qty, 0);
  if (path === '/shop') shop(query);
  else if (path === '/') {
    main.innerHTML = home();
    setupFilters();
  }
  else if (path === '/drops') main.innerHTML = drops();
  else if (path === '/faq') main.innerHTML = faq();
  else if (path === '/early-access') main.innerHTML = signup() + faq();
  else if (path === '/cart') main.innerHTML = cart();
  else if (path === '/checkout') main.innerHTML = checkout();
  else if (path === '/confirmation' && receipt) main.innerHTML = '<section class="section narrow"><h1>Order placed.</h1><p>Your demo order <strong class="order-id">' + receipt.id + '</strong> totals ' + money(receipt.total) + '.</p><a class="button" href="#/shop">Back to shop ↗</a></section>';
  else if (info[path.slice(1)]) main.innerHTML = '<section class="section narrow">' + info[path.slice(1)] + '</section>';
  else if (path.startsWith('/product/') && byId(path.split('/')[2])) main.innerHTML = product(byId(path.split('/')[2]));
  else main.innerHTML = '<section class="section"><h1>Page unavailable.</h1><a href="#/shop">Back to shop ↗</a></section>';
  if (scroll) window.scrollTo(0,0);
  tick();
}

function tick() {
  const timer = document.querySelector('#timer');
  if (!timer) return;
  const seconds = Math.max(0,Math.ceil((deadline - Date.now()) / 1000));
  const parts = [Math.floor(seconds / 86400),Math.floor(seconds / 3600) % 24,Math.floor(seconds / 60) % 60,seconds % 60];
  timer.textContent = parts.map(part => String(part).padStart(2,'0')).join(' : ');
}

document.addEventListener('click', async event => {
  const view = event.target.closest('button[data-view]');
  if (view) {
    document.querySelector('.product-photo').dataset.view = view.dataset.view;
    document.querySelectorAll('.gallery-list button').forEach(button => button.setAttribute('aria-pressed', String(button === view)));
  }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  if (action === 'cookies') document.querySelector('#cookie-dialog').showModal();
  if (action === 'close-cookies') document.querySelector('#cookie-dialog').close();
  if (action === 'browse') document.querySelector('#lineup').scrollIntoView();
  if (action === 'top') window.scrollTo(0,0);
  if (action === 'copy') {
    try { await navigator.clipboard.writeText('AFTER10'); toast('Code copied'); }
    catch { toast('Use code AFTER10 in your bag'); }
  }
  if (action === 'remove-coupon') {
    coupon = false;
    save('coupon', coupon);
    render(false);
  }
  if (button.hasAttribute('data-line')) {
    const index = Number(button.dataset.line);
    if (action === 'remove' || (action === 'less' && bag[index].qty === 1)) bag.splice(index,1);
    else bag[index].qty = Math.min(10,bag[index].qty + (action === 'more' ? 1 : -1));
    save('bag', bag);
    render(false);
    const replacement = document.querySelector('[data-line="' + index + '"][data-action="' + action + '"]');
    if (replacement) replacement.focus({preventScroll:true});
  }
});

document.addEventListener('change', event => {
  if (event.target.matches('#checkout [name="shipping"]')) document.querySelector('#checkout-totals').innerHTML = summary(event.target.value === 'express');
});

document.addEventListener('submit', event => {
  const form = event.target;
  if (!['add','coupon','checkout-promo','signup','checkout'].includes(form.id)) return;
  event.preventDefault();
  const data = new FormData(form);
  if (form.id === 'add') {
    const id = form.dataset.product;
    const size = Number(data.get('size'));
    if (!byId(id).sizes.includes(size)) return;
    const line = bag.find(item => item.id === id && item.size === size);
    if (line) line.qty = Math.min(10,line.qty + 1);
    else bag.push({id,size,qty:1});
    save('bag', bag);
    document.querySelector('#bag-count').textContent = bag.reduce((sum,item) => sum + item.qty,0);
    toast('Added to your bag');
  } else if (form.id === 'coupon' || form.id === 'checkout-promo') {
    if (data.get('code').trim().toUpperCase() !== 'AFTER10') return toast('That code is unavailable');
    coupon = true;
    save('coupon', coupon);
    if (form.id === 'checkout-promo') {
      document.querySelector('#checkout-totals').innerHTML = summary(document.querySelector('#delivery').value === 'express');
      form.reset();
    } else render(false);
    toast('10% discount applied');
  } else if (form.id === 'signup') {
    save('signed-up', true);
    form.reset();
    toast('Demo signup confirmed');
  } else {
    receipt = {id:'OP-' + Date.now().toString(36).toUpperCase(),total:totals(data.get('shipping') === 'express').total};
    bag = [];
    coupon = false;
    save('bag', bag);
    save('coupon', coupon);
    location.hash = '#/confirmation';
  }
});

const siteTop = document.querySelector('.site-top');
const menuToggle = document.querySelector('.menu-toggle');

function setMenu(open) {
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
}

menuToggle.addEventListener('click', () => setMenu(menuToggle.getAttribute('aria-expanded') !== 'true'));
document.addEventListener('click', event => {
  if (menuToggle.getAttribute('aria-expanded') === 'true' && (!siteTop.contains(event.target) || event.target.closest('a'))) setMenu(false);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menuToggle.getAttribute('aria-expanded') === 'true') {
    setMenu(false);
    menuToggle.focus();
  }
});

addEventListener('hashchange', () => {
  setMenu(false);
  if (location.hash === '#main') return;
  render();
  const search = new URLSearchParams(location.hash.split('?')[1]).get('focus') === 'search'
    && document.querySelector('#filters input[name="search"]');
  (search || main).focus({preventScroll:true});
});

let lastScrollY = Math.max(0,window.scrollY);
let travel = 0;
addEventListener('scroll', () => {
  const currentY = Math.max(0,window.scrollY);
  const change = currentY - lastScrollY;
  lastScrollY = currentY;
  if (!change) return;
  travel = Math.sign(change) === Math.sign(travel) ? travel + change : change;
  if (currentY <= siteTop.offsetHeight) siteTop.classList.remove('is-hidden');
  else if (travel >= 12 && menuToggle.getAttribute('aria-expanded') !== 'true') siteTop.classList.add('is-hidden');
  else if (travel <= -8) siteTop.classList.remove('is-hidden');
}, {passive:true});

render(false);
setInterval(tick,1000);
