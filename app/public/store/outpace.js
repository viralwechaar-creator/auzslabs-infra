/* Outpace storefront theme (renderer).
   Loaded by store.js ONLY when the store's active theme is 'outpace'. Draws the Outpace pages (home, shop,
   drops, FAQ, early access, product, bag) inside a shadow root, same isolation as kaarigari.js/studs.js.
   Checkout, account, orders and policies stay with the shared store code (frame()/unframe() below) -- the
   approved brief asked explicitly to keep live checkout on the existing server-backed flow, so unlike
   Kaarigari this theme does NOT own checkout.
   Visual source: the approved Outpace preview (theme-handoffs/outpace/preview.html, byte-identical artwork
   copied into /store/outpace/*.jpg). The demo fixtures in theme-handoffs/outpace/source/app.js (the fixed
   4-item catalogue, the fake 3-day countdown, the localStorage-only cart/checkout) are preview-only and are
   never read here -- every product, price, stock figure and bag/checkout action below is real, through
   window.StoreHost and the shared checkout flow. Two deliberate adaptations from the demo, since this theme
   now runs against a real, changing merchant catalogue instead of 4 fixed sample items:
     - "Style" (Running/Court/Trail in the demo) is the merchant's own real collection/category names, not a
       hardcoded list -- same discipline as kaarigari.js's collectionsOf().
     - The demo's fake "sale ends in 3 days" countdown (a manufactured urgency timer, reset every visit via
       localStorage) is dropped. A real store's own announcement text (cfg().announce) is shown instead. */
(function () {
  'use strict';
  const H = window.StoreHost;
  if (!H) return;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const money = (n) => '₹' + Math.round(+n || 0).toLocaleString('en-IN');
  const safeUrl = (u) => (/^(https?:)?\/\/|^\//.test(String(u || '')) ? String(u) : '');
  const ASSET = (name) => '/store/outpace/' + name;

  // ---------- data from the store, in the shape the Outpace pages use ----------
  function products() {
    const cols = H.D.collections || [];
    return H.STY().map((s) => {
      const mine = cols.filter((c) => (c.styleIds || []).includes(s.id));
      const files = H.photos(s).map(safeUrl).filter(Boolean);
      const left = H.isGone(s) ? 0 : H.leftOf(s);
      const sizes = [...new Set((s.variants || []).map((v) => v.size).filter(Boolean))];
      return {
        id: s.id, slug: s.id, name: s.name, price: +s.price || 0, mrp: +s.mrp || 0,
        category: mine[0] ? mine[0].name : (s.category || 'Sneakers'), collections: mine.map((c) => c.name),
        files, stock: left, sizes, description: s.description || '', created: s.createdAt || '', style: s,
      };
    });
  }
  const discount = (p) => (p.mrp > p.price ? Math.round(100 * (1 - p.price / p.mrp)) : 0);
  const categoriesOf = (all) => [...new Set(all.map((p) => p.category).filter(Boolean))];
  const bySlug = (all, id) => all.find((p) => p.slug === id);

  // ---------- shadow root ----------
  let host = null, root = null, drawer = null, main = null, cssText = null, ready = null, lastPath = '';
  const $ = (s) => root.querySelector(s);
  const $$ = (s) => [...root.querySelectorAll(s)];

  async function load() {
    if (ready) return ready;
    ready = (async () => {
      if (!document.getElementById('outpace-global')) {
        const g = document.createElement('style'); g.id = 'outpace-global';
        g.textContent = 'body.outpace-on #app{display:none!important}#outpace-host{display:block}#outpace-host[hidden]{display:none!important}';
        document.head.append(g);
      }
      cssText = await (await fetch('/store/outpace.css?v=1')).text();
    })();
    return ready;
  }

  const SHELL = (name) => `
    <a class="skip" href="#main">Skip to content</a>
    <div class="site-top">
      <div class="announcement"><span>${esc(H.cfg().announce || 'Free standard delivery')}</span><a href="#/shop">Shop the lineup</a><a href="#/early-access">Early access ↗</a></div>
      <header class="header">
        <a class="brand" href="#/" aria-label="${esc(name)} home">${esc(name.toUpperCase())}<sup>®</sup></a>
        <div class="header-tools">
          <a class="header-search" href="#/shop?focus=search" aria-label="Search sneakers"><span aria-hidden="true"></span></a>
          <button class="bag bag-trigger" type="button" data-dialog="bag" aria-label="Bag"><span class="bag-icon" aria-hidden="true"></span><span class="bag-label">Bag</span><span id="bag-count">0</span></button>
          <button class="menu-toggle" type="button" data-dialog="menu" aria-expanded="false" aria-label="Open menu"><span aria-hidden="true"></span></button>
        </div>
        <nav class="nav" aria-label="Main navigation"><a href="#/">Home</a><a href="#/shop">Shop all</a><a href="#/drops">Limited drops</a><a href="#/early-access">Early access</a></nav>
      </header>
    </div>
    <main id="main" tabindex="-1"></main>
    <footer class="footer">
      <div class="footer-main">
        <div><a class="brand" href="#/">${esc(name.toUpperCase())}<sup>®</sup></a><p>Footwear for the long way.</p></div>
        <nav aria-label="Shop"><h2>Shop</h2><a href="#/shop">All sneakers</a></nav>
        <nav aria-label="Explore"><h2>Explore</h2><a href="#/drops">Limited drops</a><a href="#/early-access">Early access</a><a href="#/faq">FAQ</a></nav>
        <nav aria-label="Help"><h2>Help</h2><a href="#/policy/shipping">Shipping &amp; returns</a><a href="#/policy/privacy">Privacy</a></nav>
      </div>
      <div class="footer-bottom"><small>© ${new Date().getFullYear()} ${esc(name)}</small></div>
    </footer>
    <dialog id="drawer" aria-labelledby="drawer-title">
      <div class="drawer-head"><h2 id="drawer-title"></h2><button class="close" id="drawer-close" type="button" aria-label="Close">×</button></div>
      <div id="drawer-body"></div>
    </dialog>`;

  function mount() {
    if (host) return;
    host = document.createElement('div'); host.id = 'outpace-host'; document.body.append(host);
    root = host.attachShadow({ mode: 'open' });
    const wrap = document.createElement('div'); wrap.className = 'outpace-root';
    const st = document.createElement('style'); st.textContent = cssText;
    root.append(st, wrap);
    wrap.innerHTML = SHELL(H.D.shop.name);
    drawer = wrap.querySelector('#drawer');
    main = wrap.querySelector('#main');
    root.addEventListener('click', onClick);
    // img 'error' events are not composed, so any shadow-DOM theme using H.thumbImg() needs its own fallback
    // listener on its own root (see store.js's document-level one, and kaarigari.js's identical comment).
    root.addEventListener('error', (e) => { const im = e.target; if (im && im.tagName === 'IMG' && im.dataset.orig && im.src !== im.dataset.orig) im.src = im.dataset.orig; }, true);
    root.addEventListener('input', (e) => { if (e.target.id === 'op-search') shopRefresh(); if (e.target.id === 'op-query') search(e.target.value); });
    root.addEventListener('change', (e) => { if (e.target.closest && e.target.closest('#op-filters')) shopRefresh(); });
    root.addEventListener('submit', (e) => {
      if (e.target.id === 'op-filters') { e.preventDefault(); return; }
      if (e.target.id === 'op-signup') { e.preventDefault(); signupSubmit(e.target); return; }
      if (e.target.id === 'op-add') { e.preventDefault(); addToBag(e.target); }
    });
    wrap.querySelector('.skip').addEventListener('click', (e) => { e.preventDefault(); main.focus(); });
    paintBagCount();
  }

  // ---------- views ----------
  function tile(p) {
    const d = discount(p);
    const limited = p.stock > 0 && p.stock <= 3 ? `<span class="last-size">Only ${p.stock} left</span>` : '';
    const img = p.files[0] ? `<img loading="lazy" src="${esc(H.thumb(p.files[0], 480))}" alt="${esc(p.name)}">` : '';
    return `<article class="tile"><a href="#/product/${esc(p.slug)}"><div class="tile-photo">${img}${d ? `<span class="sale-badge">−${d}%</span>` : ''}${limited}</div>
      <div class="tile-info"><span class="eyebrow">${esc(p.category)}</span><h3>${esc(p.name)}</h3><div class="meta"><span class="price">${money(p.price)}${p.mrp > p.price ? ' <del>' + money(p.mrp) + '</del>' : ''}</span></div></div></a></article>`;
  }
  const tiles = (items) => items.length ? '<div class="grid">' + items.map(tile).join('') + '</div>' : '<p class="muted">No sneakers to show yet.</p>';

  function collections(all) {
    const cats = categoriesOf(all);
    if (!cats.length) return '';
    const firstPhoto = (cat) => { const p = all.find((x) => x.category === cat && x.files[0]); return p ? H.thumb(p.files[0], 480) : ''; };
    return `<section class="section collections"><div class="section-head"><div><span class="eyebrow">Explore by style</span><h2>Find your lane.</h2></div><a href="#/shop">Shop all ↗</a></div><div class="collection-grid">${
      cats.map((cat) => `<a class="collection-card" href="#/shop?style=${encodeURIComponent(cat)}">${firstPhoto(cat) ? `<img loading="lazy" src="${esc(firstPhoto(cat))}" alt="">` : ''}<span>${esc(cat)} <b aria-hidden="true">↗</b></span></a>`).join('')
    }</div></section>`;
  }

  function dropsOf(all) {
    // No generic "limited drop" flag exists on a real product the way the demo's fixed catalogue hardcoded
    // one -- low remaining stock is the closest honest real-world signal for "won't last." Falls back to the
    // newest items if nothing is actually running low, so the section never looks empty on a fresh store.
    const low = all.filter((p) => p.stock > 0 && p.stock <= 3);
    return (low.length ? low : all.slice().sort((a, b) => String(b.created).localeCompare(String(a.created)))).slice(0, 4);
  }
  function drops(all) {
    const items = dropsOf(all);
    const feature = items[0];
    return `<section class="editorial-break"><div class="field-story"><div class="field-copy"><span class="eyebrow">Limited drops</span><h2>The blue hour.</h2><p>Small runs in colours that take a different route.</p>${feature ? `<a class="button outline" href="#/product/${esc(feature.slug)}">Explore ${esc(feature.name)} ↗</a>` : ''}</div>${feature && feature.files[0] ? `<figure><img loading="lazy" src="${esc(H.thumb(feature.files[0], 900))}" alt=""><figcaption>${esc(feature.name)} / field notes</figcaption></figure>` : ''}</div></section>
      <section class="section" id="drops-list">${heading('Limited drops', 'Don’t sleep on these')}${tiles(items)}</section>`;
  }
  function dropsPage(all) { return drops(all); }

  function serviceGuide() {
    return `<section class="section service-guide" aria-label="Shopping information"><article><span class="service-mark" aria-hidden="true">↗</span><h3>Free standard delivery</h3><p>${esc((H.cfg().shipping || {}).note || 'Delivery across India.')}</p><a href="#/policy/shipping">Delivery details ↗</a></article><article><span class="service-mark" aria-hidden="true">↶</span><h3>Returns</h3><p>Return unworn pairs in their original packaging.</p><a href="#/policy/returns">Return details ↗</a></article><article><span class="service-mark" aria-hidden="true">↔</span><h3>Find your fit</h3><p>Filter the lineup by the size you wear.</p><a href="#/shop">Browse available sizes ↗</a></article></section>`;
  }
  function faqPage() {
    return `<section class="section faq">${heading('Before you lace up.', 'Sale and delivery')}<div><details open><summary>Is standard delivery free?</summary><p>Yes. See <a href="#/policy/shipping">shipping and returns</a> for timings.</p></details><details><summary>How do I choose a size?</summary><p>Check the size picker on the product page.</p></details><details><summary>How does early access work?</summary><p><a href="#/early-access">Join the early access list</a> to hear about limited colourways first.</p></details><details><summary>Can I return to checkout later?</summary><p>Your bag stays in this browser. You’ll enter your delivery details when you check out.</p></details></div></section>`;
  }
  function signupSection() {
    return `<section class="section signup" id="early-access"><span class="eyebrow">The first lap</span><h2>Get in early.</h2><p>Hear about limited colourways and sale dates.</p><form id="op-signup" class="signup-form"><label for="op-mail">Email address</label><div class="inline"><input id="op-mail" name="email" type="email" placeholder="you@example.com" required><button class="button">Join the list</button></div></form></section>`;
  }
  function signupSubmit(form) {
    const email = (form.elements.email && form.elements.email.value || '').trim();
    if (!email) return;
    form.innerHTML = '<p>Thanks -- you’re on the list.</p>';
  }
  const heading = (title, kicker) => `<div class="section-head"><div>${kicker ? `<p class="eyebrow">${esc(kicker)}</p>` : ''}<h2>${esc(title)}</h2></div></div>`;

  function filterPanel(all, q) {
    const cats = categoriesOf(all); const sizes = [...new Set(all.flatMap((p) => p.sizes))].sort();
    const params = new URLSearchParams(q || '');
    return `<form class="filter-panel" id="op-filters"><fieldset class="style-tabs"><legend class="sr-only">Filter by style</legend>${
      [['', 'All styles'], ...cats.map((c) => [c, c])].map(([v, l]) => `<label><input name="style" type="radio" value="${esc(v)}"${(params.get('style') || '') === v ? ' checked' : ''}><span>${esc(l)}</span></label>`).join('')
    }</fieldset><div class="filters"><label>Search<input id="op-search" name="search" type="search" placeholder="Search sneakers" value="${esc(params.get('search') || '')}"></label>${
      sizes.length ? `<label>Size<select name="size"><option value="">All sizes</option>${sizes.map((s) => `<option value="${esc(s)}"${params.get('size') === String(s) ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select></label>` : ''
    }<label>Sort<select name="sort"><option value="">Featured</option><option value="low"${params.get('sort') === 'low' ? ' selected' : ''}>Price low to high</option><option value="high"${params.get('sort') === 'high' ? ' selected' : ''}>Price high to low</option></select></label></div></form><p class="result-count" role="status"></p><div id="op-results"></div>`;
  }
  function shopRefresh() {
    const form = $('#op-filters'); if (!form) return;
    const all = products();
    const data = new FormData(form);
    const search = String(data.get('search') || '').trim().toLowerCase();
    const style = data.get('style') || '';
    const size = data.get('size') || '';
    const sort = data.get('sort') || '';
    let items = all.filter((p) => (p.name + ' ' + p.category).toLowerCase().includes(search) && (!style || p.category === style) && (!size || p.sizes.includes(size)));
    if (sort === 'low') items = items.slice().sort((a, b) => a.price - b.price);
    if (sort === 'high') items = items.slice().sort((a, b) => b.price - a.price);
    const count = $('.result-count'); if (count) count.textContent = items.length + (items.length === 1 ? ' pair' : ' pairs');
    const out = $('#op-results'); if (out) out.innerHTML = tiles(items);
  }
  function shopPage(all, q) {
    return `<section class="section">${heading('Shop the lineup.', 'Running · Court · Trail')}${filterPanel(all, q)}</section>`;
  }

  function home(all) {
    const heroImg = safeUrl((H.cfg().heroImages || [])[0]) || ASSET('hero.jpg');
    return `<section class="hero" style="--hero:url('${esc(heroImg)}')"><div class="hero-content"><span class="eyebrow">${esc(H.D.shop.name)}</span><h1>Shop the <em>lineup.</em></h1><p>Street, court and trail sneakers for wherever the day takes you.</p><a class="button lime" href="#/shop">Shop now ↗</a></div></section>
      <div class="styles-band" aria-label="Shop by style">${categoriesOf(all).map((c) => `<a href="#/shop?style=${encodeURIComponent(c)}">${esc(c)} ↗</a>`).join('')}</div>
      <section class="section" id="lineup"><div class="section-head"><div><span class="eyebrow">New in</span><h2>Shop the lineup.</h2></div><a href="#/shop">Shop all ↗</a></div>${tiles(all.slice(0, 8))}</section>
      ${collections(all)}${drops(all)}${signupSection()}${serviceGuide()}${faqPage()}`;
  }

  function detail(p) {
    const d = discount(p);
    return `<section class="section"><a class="crumb" href="#/shop">← All sneakers</a><div class="product"><div><div class="product-photo">${p.files[0] ? `<img src="${esc(H.thumb(p.files[0], 900))}" alt="${esc(p.name)}">` : ''}</div></div>
        <div><span class="eyebrow">${esc(p.category)}</span><h1>${esc(p.name)}</h1><p><strong>${money(p.price)}</strong>${d ? ' <del>' + money(p.mrp) + '</del>' : ''}</p><p>${esc(p.description)}</p>
        <form id="op-add" data-add="${esc(p.slug)}"><fieldset><legend>Select size</legend><div class="sizes">${
          p.sizes.length ? p.sizes.map((s) => `<label><input name="size" type="radio" value="${esc(s)}" ${p.stock ? 'required' : 'disabled'}><span>${esc(s)}</span></label>`).join('') : '<span class="muted">One size</span>'
        }</div></fieldset><button class="button lime" type="submit"${p.stock ? '' : ' disabled'}>${p.stock ? 'Add to bag' : 'Sold out'}</button></form>
        <details><summary>Delivery and returns</summary><p><a href="#/policy/shipping">Shipping</a> · <a href="#/policy/returns">Returns</a></p></details></div></div></section>
      <section class="section"><div class="section-head"><h2>More to try.</h2><a href="#/shop">Shop all ↗</a></div>${tiles(products().filter((x) => x.id !== p.id).slice(0, 4))}</section>`;
  }

  // ---------- bag (its own page, same style as the approved demo; checkout itself is the shared flow) ----------
  function bagMarkup() {
    const ls = H.bagLines();
    if (!ls.length) return '<p>Your bag is empty.</p><a class="button" href="#/shop">Shop sneakers ↗</a>';
    const rows = ls.map((l, i) => `<div class="cart-row">${H.photos(l.s)[0] ? `<img src="${esc(H.thumb(H.photos(l.s)[0], 160))}" alt="">` : ''}<div><strong>${esc(l.s.name)}</strong>${l.vr.size ? `<p>${esc(l.vr.size)}</p>` : ''}
      <div class="quantity"><button type="button" data-step="-1" data-i="${i}" aria-label="Remove one">−</button><span>${l.q}</span><button type="button" data-step="1" data-i="${i}" aria-label="Add one">+</button><button class="remove" type="button" data-step="0" data-i="${i}">Remove</button></div></div><strong>${money(l.vr.price * l.q)}</strong></div>`).join('');
    return `<div class="cart-layout"><div>${rows}<p><a href="#/shop">Continue shopping ↗</a></p></div><aside class="summary"><h2>Order summary</h2><dl><div><dt>Subtotal</dt><dd>${money(H.bagTotal())}</dd></div></dl><a class="button lime" href="#/checkout">Checkout ↗</a></aside></div>`;
  }
  function cartPage() { return `<section class="section"><h1>Your bag.</h1>${bagMarkup()}</section>`; }
  function paintBagCount() { const n = H.bagCount(); const el = $('#bag-count'); if (el) el.textContent = n; }

  function openDrawer(kind) {
    $('#drawer-title').textContent = kind === 'bag' ? 'Your bag' : 'Menu';
    const body = $('#drawer-body');
    if (kind === 'menu') body.innerHTML = '<nav aria-label="Menu"><a href="#/">Home</a><a href="#/shop">Shop all</a><a href="#/drops">Limited drops</a><a href="#/early-access">Early access</a><a href="#/faq">FAQ</a></nav>';
    else { drawer.close(); location.hash = '/cart'; return; }
    if (!drawer.open) drawer.showModal();
  }
  function search(q) {
    const all = products(); const r = all.filter((p) => p.name.toLowerCase().includes(String(q || '').trim().toLowerCase()));
    const box = $('#op-results'); if (box && lastPath[0] !== 'shop') box.innerHTML = r.length ? tiles(r) : '<p class="muted">No sneakers match your search.</p>';
  }

  function addToBag(form) {
    const p = bySlug(products(), form.dataset.add); if (!p) return;
    const sizeInput = form.querySelector('input[name="size"]:checked');
    const size = sizeInput ? sizeInput.value : '';
    const v = (p.style.variants || []).find((x) => String(x.size) === size) || (p.style.variants || [])[0];
    if (!v) return;
    H.addBag(v.id, 1); paintBagCount(); openDrawer('bag');
  }
  function onClick(event) {
    const t = event.target;
    const dlg = t.closest && t.closest('[data-dialog]'); if (dlg) { event.preventDefault(); openDrawer(dlg.dataset.dialog); return; }
    if (t.id === 'drawer-close' || t === drawer) { drawer.close(); return; }
    const step = t.closest && t.closest('[data-step]');
    if (step) {
      const i = Number(step.dataset.i); const ls = H.bagLines(); const l = ls[i]; if (!l) return;
      const row = H.bag.find((b) => b.v === l.v); if (!row) return;
      const d = Number(step.dataset.step);
      if (d === 0) H.bag.splice(H.bag.indexOf(row), 1);
      else if (d < 0 && row.q <= 1) H.bag.splice(H.bag.indexOf(row), 1);
      else row.q += d;
      H.saveBag(); render(['cart']);
      return;
    }
  }
  function render(parts) {
    const all = products();
    const [id, arg] = parts;
    const key = id || 'home';
    if (key === 'home') main.innerHTML = home(all);
    else if (key === 'shop') { main.innerHTML = shopPage(all, (location.hash.split('?')[1] || '')); shopRefresh(); }
    else if (key === 'drops') main.innerHTML = dropsPage(all);
    else if (key === 'faq') main.innerHTML = faqPage();
    else if (key === 'early-access') main.innerHTML = signupSection() + faqPage();
    else if (key === 'product' && bySlug(all, arg)) main.innerHTML = detail(bySlug(all, arg));
    else if (key === 'cart') main.innerHTML = cartPage();
    else main.innerHTML = `<section class="section"><a class="crumb" href="#/shop">← All sneakers</a></section>`;
    window.scrollTo(0, 0);
    paintBagCount();
  }

  // ---------- routing ----------
  // Checkout/account/orders/policies are NOT owned (the approved brief: keep live checkout on the existing
  // server-backed flow) -- they frame the shared pages with Outpace's own header/footer, same contract as
  // Studs/Kaarigari's default. The product-detail route is 'product' here (the demo's own #/product/<id>),
  // not 'p' like the other bespoke themes -- store.js's OWN set below matches whichever hash segment a theme
  // declares, so this is just Outpace's own choice of path name, nothing shared code needs to agree on.
  const OWN = new Set(['home', 'shop', 'drops', 'faq', 'early-access', 'product', 'cart']);
  function owns(id) { return OWN.has(id); }
  let framed = false, viewHome = null;
  function unframe() {
    if (!framed) return; framed = false;
    const v = document.getElementById('view');
    if (v && viewHome && v.parentNode === host) viewHome.parent.insertBefore(v, viewHome.next);
    viewHome = null;
  }
  async function frame() {
    await load(); mount(); host.hidden = false; document.body.classList.add('outpace-on');
    if (drawer.open) drawer.close();
    const v = document.getElementById('view');
    if (v && v.parentNode !== host) { viewHome = { parent: v.parentNode, next: v.nextSibling }; host.append(v); }
    framed = true;
    main.innerHTML = '<slot></slot>';
    paintBagCount(); lastPath = ['__frame'];
  }

  window.OutpaceTheme = {
    owns,
    async show(parts) {
      await load(); mount(); unframe(); host.hidden = false; document.body.classList.add('outpace-on');
      lastPath = parts; render(parts);
    },
    hide() { unframe(); if (host) host.hidden = true; document.body.classList.remove('outpace-on'); },
    frame,
    refresh() { if (host && !host.hidden && lastPath) { const parts = lastPath, wasFramed = framed; unframe(); host.remove(); host = null; mount(); host.hidden = false; if (wasFramed) frame(); else render(parts); } },
    ready: load,
  };
})();
