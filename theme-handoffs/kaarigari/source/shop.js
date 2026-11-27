const money = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const main = document.querySelector('main');
const drawer = document.querySelector('#drawer');
const drawerBody = document.querySelector('#drawer-body');
const bagCount = document.querySelector('#bag-count');
let bag;
try { bag = JSON.parse(localStorage.getItem('kaarigari-bag')) || {}; } catch { bag = {}; }
if (typeof bag !== 'object' || Array.isArray(bag)) bag = {};

const price = (amount) => money.format(amount);
const productLink = (product) => '#/product/' + product.id;
const asset = (id) => id + (id === 'rangoli' ? '.png' : '.jpg');
const productImage = (product) => '<img src="' + asset(product.id) + '" alt="' + product.title + '"' + (product.id === 'clay' ? ' class="vessel-image"' : '') + ' loading="lazy" draggable="false">';

function collectionProducts(id) {
  if (id === 'gifts') return catalog.filter((product) => product.price < 1500);
  return id ? catalog.filter((product) => product.category === id) : catalog;
}

function collectionCards(list) {
  return '<div class="collection-grid">' + list.map((c) => {
    const href = c.id === 'clay' ? '#/pottery' : '#/shop/' + c.id;
    return '<a class="collection-card" href="' + href + '"><img src="' + asset(c.image) +
      '" alt="" loading="lazy"><span class="collection-name">' + c.name + '</span></a>';
  }).join('') + '</div>';
}

function potteryPage() {
  const featured = catalog.find((product) => product.id === 'platter');
  return '<section class="wrap section pottery"><div class="pottery-intro">' +
    '<div><a href="#/collections" class="text-link">All collections</a><p class="kicker">The pottery edit</p><h1>Earth, shaped by hand.</h1>' +
    '<p>Unglazed terracotta, hand-painted ceramics, and the marks left by the making.</p><a class="button" href="#/shop/clay">Shop ceramics</a></div>' +
    '<div class="pottery-portrait"><img src="' + asset('culture-clay') + '" alt="A potter shaping a terracotta vessel on a wheel" loading="lazy"></div></div>' +
    '<div class="pottery-banner"><img src="' + asset('pottery') + '" alt="Handmade glazed bowls arranged on sandstone"><span class="pottery-display" aria-hidden="true">Pottery</span>' +
    '<a class="pottery-feature" href="' + productLink(featured) + '">' + productImage(featured) + '<span><strong>' + featured.title + '</strong><small>' + price(featured.price) + '</small></span></a></div>' +
    '<div class="section-head pottery-products"><h2>From the clay collection</h2><a class="text-link" href="#/shop/clay">Shop all</a></div>' +
    grid(collectionProducts('clay')) + '</section>' +
    postcard('Objects in earth tones', 'See how clay, natural fibres and other materials shape the collection.', 'culture-clay', '#/our-story', 'Our story');
}

function grid(products) {
  return '<div class="grid">' + products.map((product) =>
    '<a class="object product-card" href="' + productLink(product) + '"><div class="object-image">' + productImage(product) + '</div>' +
    '<div class="object-info"><h3>' + product.title + '</h3><span class="price">' + price(product.price) + '</span></div>' +
    '<small>' + product.material + '</small><div class="product-peek"><strong>' + product.title + '</strong><span>' + product.material + ' · ' + product.size + '</span>' +
    '<p>' + product.description + '</p><b>View product</b></div></a>').join('') + '</div>';
}

function heading(title, eyebrow = '') {
  return '<div class="section-head"><div>' + (eyebrow ? '<p class="kicker">' + eyebrow + '</p>' : '') + '<h1>' + title + '</h1></div></div>';
}

function mobileCopy(lead, more) {
  return '<div class="mobile-copy"><p>' + lead + '</p><button class="copy-toggle" type="button" aria-expanded="false">Show more</button>' +
    '<p class="copy-extra">' + more + '</p></div>';
}

function story() {
  return '<section class="story"><div class="story-media"><img src="' + asset('journal') + '" alt="Wooden block pressed against an indigo floral print on cotton" width="384" height="470" loading="lazy"></div>' +
    '<div class="story-copy"><p class="kicker">Block printing</p><h2>The rhythm of the block.</h2>' +
    mobileCopy('A carved block meets the cloth. The hand lifts, shifts, and presses again.', 'Look closely at the small variations where one impression meets the next, and how the printed border frames the cloth.') +
    '<a class="text-link" href="#/shop/textiles">Shop printed textiles</a>' +
    '</div></section>';
}

function home() {
  return '<section class="hero"><img src="' + asset('hero') + '" width="1536" height="553" alt="Terracotta pots and indigo cloth in a sunlit sandstone room" fetchpriority="high">' +
    '<div class="hero-copy"><p class="kicker">The Indian craft edit</p><h1>Objects made<br><em>by hand.</em></h1><p>Clay, cloth, brass and woven fibres for the spaces you live in.</p><a href="#/shop" class="button light">Explore the collection</a></div></section>' +
    '<section class="section wrap home-collections"><div class="section-head"><div><p class="kicker">Explore by material</p><h2>The collections</h2></div><a class="text-link" href="#/collections">All collections</a></div>' + collectionCards(categories) + '</section>' +
    '<section class="editorial-break"><div class="craft-edit"><div class="craft-copy"><h2>The marks are part of the making.</h2>' +
    mobileCopy('Look for the fine rings on a clay vessel and the slight overlap where a block was pressed again on printed cotton.',
      'A basket’s spiral reveals how its walls were built, while the small dents on a brass bowl catch the light differently as you turn it.') +
    '<a href="#/our-story" class="button light">Our story <span aria-hidden="true">↗</span></a></div><div class="craft-art"><img src="' + asset('craft') + '" alt="Traditional-style painting of an artisan block-printing indigo cloth in a courtyard" loading="lazy"></div></div></section>' +
    '<section class="section wrap"><div class="section-head"><div><p class="kicker">The latest edit</p><h2>New in the shop</h2></div><a class="text-link" href="#/shop">Shop all</a></div>' + grid(catalog.slice(-3)) + '</section>' +
    story() +
    '<section class="section wrap"><div class="section-head"><div><p class="kicker">Under ₹1,500</p><h2>Small gifts, thoughtfully chosen</h2></div><a class="text-link" href="#/shop/gifts">Shop gifts</a></div>' + grid(collectionProducts('gifts').slice(0, 3)) + '</section>' +
    '<section class="service-links wrap"><a href="#/care"><strong>Care by material</strong><span>Make each object last.</span></a><a href="#/shipping"><strong>Delivery</strong><span>See your shipping options.</span></a><a href="#/contact"><strong>Get in touch</strong><span>Ask about an object or a gift.</span></a></section>';
}

function shop(category) {
  const label = categories.find(({ id }) => id === category)?.name || 'All objects';
  const tabs = [{ id: '', name: 'All objects' }, ...categories].map(({ id, name }) => '<a href="#/shop' + (id ? '/' + id : '') + '"' + (id === category ? ' aria-current="page"' : '') + '>' + name + '</a>').join('');
  const products = collectionProducts(category);
  return '<section class="wrap section">' + heading(label, 'The collection') + '<nav class="tabs" aria-label="Filter by material">' + tabs + '</nav>' +
    '<div class="shop-toolbar"><span>' + products.length + ' pieces</span><label>Sort by <select data-sort="' + category + '"><option value="featured">Featured</option><option value="low">Price: low to high</option><option value="high">Price: high to low</option></select></label></div><div id="shop-results">' + grid(products) + '</div></section>';
}

function detail(product) {
  return '<section class="wrap section"><p><a class="text-link" href="#/shop">Back to the collection</a></p><div class="detail">' +
    '<div class="object-image">' + productImage(product) + '</div><div><p class="kicker">' + product.material + '</p><h1>' + product.title + '</h1>' +
    '<p class="price">' + price(product.price) + '</p>' + productDescription(product.description) + '<button class="button" data-add="' + product.id + '">Add to bag</button>' +
    '<details open><summary>Material and dimensions</summary><p>' + product.material + ' · ' + product.size + '</p></details><details><summary>Care</summary><p>' + care[product.category] + '</p></details>' +
    '<details><summary>Delivery and returns</summary><p><a class="text-link" href="#/shipping">Shipping</a> · <a class="text-link" href="#/returns">Returns</a></p></details></div></div></section>' +
    '<section class="wrap section"><div class="section-head"><h2>You may also like</h2></div>' + grid(catalog.filter((p) => p.id !== product.id).sort((a,b) => Number(b.category === product.category) - Number(a.category === product.category)).slice(0,3)) + '</section>';
}

function page(title, content) {
  return '<section class="section wrap prose">' + heading(title) + content + '</section>';
}

function postcard(title, copy, image, href, label) {
  return '<section class="wrap postcard-section"><div class="postcard"><div class="postcard-media"><img src="' + asset(image) + '" alt="" loading="lazy"></div>' +
    '<div class="postcard-copy"><p class="postcard-stamp">Kaarigari field notes</p><h2>' + title + '</h2><p>' + copy + '</p><a class="text-link" href="' + href + '">' + label + '</a></div></div></section>';
}

function productDescription(description) {
  const boundary = description.indexOf('. ') + 1;
  return boundary ? mobileCopy(description.slice(0, boundary), description.slice(boundary + 1)) : '<p>' + description + '</p>';
}

function render() {
  const [route, id = ''] = location.hash.startsWith('#/') ? location.hash.slice(2).split('/') : [''];
  if (!route) main.innerHTML = home();
  else if (route === 'shop') main.innerHTML = shop(categories.some(({ id: key }) => key === id) ? id : '');
  else if (route === 'collections') main.innerHTML = '<section class="wrap section">' + heading('Collections', 'Browse by material') + collectionCards(categories) + '</section>';
  else if (route === 'pottery') main.innerHTML = potteryPage();
  else if (route === 'product' && catalog.some((p) => p.id === id)) main.innerHTML = detail(catalog.find((p) => p.id === id));
  else if (route === 'our-story') main.innerHTML = page('Our story',
    mobileCopy('Kaarigari is a storefront concept built around Indian handicrafts for everyday rooms.', 'It brings clay, cloth, brass, natural fibres and wood together through the marks left by each material and process. The pieces are sample products.') +
    '<a class="text-link" href="#/collections">Explore the collections</a>') +
    postcard('From the printing table', 'A look at the technique behind the indigo and coral textiles in the collection.', 'craft', '#/shop/textiles', 'Shop printed textiles');
  else if (route === 'care') main.innerHTML = page('Care guide', categories.filter((c) => care[c.id]).map((c) => '<details><summary>' + c.name + '</summary><p>' + care[c.id] + '</p></details>').join(''));
  else if (route === 'delivery') main.innerHTML = infoPage('shipping');
  else if (Object.hasOwn(supportPages, route)) main.innerHTML = infoPage(route);
  else if (route === 'contact') main.innerHTML = contactPage();
  else if (route === 'checkout') main.innerHTML = checkoutPage();
  else if (route === 'orders') main.innerHTML = ordersPage(id);
  else main.innerHTML = page('Page not found', '<a class="text-link" href="#/shop">Browse the collection</a>');
  document.title = (main.querySelector('h1')?.textContent.trim() || 'Indian craft') + ' · Kaarigari';
}

function quantity(id) {
  const value = Number(bag[id]);
  return Number.isFinite(value) ? Math.min(99, Math.max(0, Math.floor(value))) : 0;
}

function total() {
  return catalog.reduce((sum, product) => sum + quantity(product.id) * product.price, 0);
}

function updateBag() {
  const count = catalog.reduce((sum, product) => sum + quantity(product.id), 0);
  bagCount.textContent = count;
  bagCount.hidden = count === 0;
  bagCount.parentElement.setAttribute('aria-label', 'Shopping bag, ' + count + (count === 1 ? ' item' : ' items'));
  try { localStorage.setItem('kaarigari-bag', JSON.stringify(bag)); } catch { /* Works for this page session. */ }
}

function bagMarkup() {
  const items = catalog.filter((product) => quantity(product.id));
  if (!items.length) return '<p>Your bag is empty.</p><a class="text-link" href="#/shop">Explore the collection</a>';
  return items.map((p) => '<div class="bag-line"><div class="bag-detail"><a href="' + productLink(p) + '">' + p.title + '</a><p class="muted">' + price(p.price) + '</p></div>' +
    '<div class="qty"><button data-step="-1" data-product="' + p.id + '" aria-label="Remove one ' + p.title + '">−</button><span>' + quantity(p.id) +
    '</span><button data-step="1" data-product="' + p.id + '" aria-label="Add one ' + p.title + '">+</button></div></div>').join('') +
    '<div class="bag-total"><strong>Subtotal</strong><span class="price">' + price(total()) + '</span></div><a class="button" href="#/checkout">Go to checkout</a>';
}

function search(query = '') {
  const results = catalog.filter((p) => (p.title + ' ' + p.material).toLowerCase().includes(query.trim().toLowerCase()));
  document.querySelector('#search-results').innerHTML = results.length
    ? results.map((p) => '<a href="' + productLink(p) + '">' + p.title + ' · ' + price(p.price) + '</a>').join('')
    : '<p>No objects match your search.</p>';
}

function openDrawer(kind) {
  document.querySelector('#drawer-title').textContent = { search: 'Search', bag: 'Your bag', menu: 'Explore Kaarigari' }[kind];
  if (kind === 'bag') drawerBody.innerHTML = bagMarkup();
  if (kind === 'menu') drawerBody.innerHTML = '<nav class="craft-menu" aria-label="Menu"><a class="menu-feature" href="#/pottery"><img src="' + asset('pottery') + '" alt=""><span>Pottery edit</span></a>' +
    '<div class="menu-primary"><a href="#/">Home</a><a href="#/shop">Shop all objects</a><a href="#/collections">Collections</a></div>' +
    '<div class="menu-secondary"><a href="#/our-story">Our story</a><a href="#/care">Care guide</a><a href="#/contact">Contact</a></div></nav>';
  if (kind === 'search') {
    drawerBody.innerHTML = '<label for="shop-query">Find an object</label><input id="shop-query" type="search" placeholder="Try brass or indigo"><div id="search-results" class="drawer-links" aria-live="polite"></div>';
    search();
  }
  drawer.dataset.kind = kind;
  if (!drawer.open) drawer.showModal();
  if (kind === 'search') document.querySelector('#shop-query').focus();
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (button?.classList.contains('copy-toggle')) {
    const expanded = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(expanded));
    button.textContent = expanded ? 'Show less' : 'Show more';
  }
  if (button?.dataset.dialog) openDrawer(button.dataset.dialog);
  if (button?.id === 'drawer-close' || event.target === drawer || event.target.closest('#drawer a')) {
    drawer.close();
  }
  if (button?.dataset.add) {
    const id = button.dataset.add;
    bag[id] = quantity(id) + 1;
    updateBag();
    openDrawer('bag');
  }
  if (button?.dataset.step) {
    const { product, step } = button.dataset;
    bag[product] = Math.max(0, quantity(product) + Number(step));
    updateBag();
    drawerBody.innerHTML = bagMarkup();
    const control = drawerBody.querySelector('[data-product="' + product + '"][data-step="' + step + '"]');
    (control || document.querySelector('#drawer-close')).focus();
  }
});
document.addEventListener('input', (event) => {
  if (event.target.id === 'shop-query') search(event.target.value);
});
document.addEventListener('change', (event) => {
  if (!event.target.matches('[data-sort]')) return;
  const products = [...collectionProducts(event.target.dataset.sort)];
  if (event.target.value === 'low') products.sort((a, b) => a.price - b.price);
  if (event.target.value === 'high') products.sort((a, b) => b.price - a.price);
  document.querySelector('#shop-results').innerHTML = grid(products);
});
window.addEventListener('hashchange', () => {
  if (location.hash === '#main') { main.focus(); return; }
  render();
  window.scrollTo(0, 0);
  main.focus({ preventScroll: true });
});

