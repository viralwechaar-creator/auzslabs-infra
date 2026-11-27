/* Kaarigari storefront theme (renderer).
   Loaded by store.js ONLY when the store's active theme is 'kaarigari'. Every other store never requests this file.
   It draws the Kaarigari pages (home, shop, collections, product, our story) inside a shadow root so its styles
   cannot touch, or be touched by, the rest of the storefront. Cart, checkout, orders, accounts and policies stay
   with the shared store code (see unframe()/frame() below): this file only reads the store's real catalogue and
   uses the shared bag -- the same contract studs.js documents and uses.
   Visual source: the approved Kaarigari preview (theme-handoffs/kaarigari/preview.html, byte-identical artwork
   copied into /store/kaarigari/*.jpg|png). The demo fixtures in theme-handoffs/kaarigari/source/{catalog,checkout}.js
   are preview-only and are never read here -- every product, price, stock figure and bag/checkout action below is
   real, through window.StoreHost and the shared checkout flow. */
(function () {
  'use strict';
  const H = window.StoreHost;
  if (!H) return;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const money = (n) => '₹' + Math.round(+n || 0).toLocaleString('en-IN');
  const safeUrl = (u) => (/^(https?:)?\/\/|^\//.test(String(u || '')) ? String(u) : '');
  const safeHref = (u) => (/^(https?:\/\/|\/|#|mailto:|tel:)/.test(String(u || '')) ? String(u) : '#/');
  const ASSET = (name) => '/store/kaarigari/' + name;

  // ---------- data from the store, in the shape the Kaarigari pages use ----------
  const S = () => (H.cfg().kaarigari || {});
  function products() {
    const cols = H.D.collections || [];
    return H.STY().map((s) => {
      const mine = cols.filter((c) => (c.styleIds || []).includes(s.id));
      const files = H.photos(s).map(safeUrl).filter(Boolean);
      const left = H.isGone(s) ? 0 : H.leftOf(s);
      return {
        id: s.id, slug: s.id, name: s.name, price: +s.price || 0, category: mine[0] ? mine[0].name : (s.category || 'Objects'),
        collections: mine.map((c) => c.name), files, stock: left, description: s.description || '',
        material: (s.details && s.details.material) || s.category || '', size: (s.details && s.details.size) || '',
        washcare: s.washcare || (s.details && s.details.washcare) || '', created: s.createdAt || '', style: s,
      };
    });
  }
  const collectionsOf = (all) => [...new Set(all.flatMap((p) => p.collections).filter(Boolean))];
  const inCol = (p, n) => (p.collections || []).includes(n);
  const bySlug = (all, id) => all.find((p) => p.slug === id);

  // settings, with every default built from the store's own catalogue (same discipline as studs.js)
  function settings(all) {
    const st = S(); const names = collectionsOf(all);
    const firstPhoto = (p) => (p && p.files[0]) || '';
    const colImg = Object.fromEntries((H.D.collections || []).filter((c) => c.image).map((c) => [c.name, c.image]));
    const tiles = names.slice(0, 6).map((n) => ({ name: n, image: safeUrl(colImg[n]) || firstPhoto(all.find((p) => inCol(p, n))) })).filter((t) => t.image);
    const featuredName = st.featuredCollection && names.includes(st.featuredCollection) ? st.featuredCollection : names[0];
    const featured = featuredName ? all.filter((p) => inCol(p, featuredName)) : all.slice(0, 4);
    return {
      names, tiles,
      heroImage: safeUrl(st.heroImage) || ASSET('hero.jpg'), heroAlt: st.heroAlt || H.D.shop.name,
      featuredLabel: st.featuredLabel || featuredName || 'Featured', featured,
      storyTitle: st.storyTitle || 'The rhythm of the craft.', storyImage: safeUrl(st.storyImage) || ASSET('journal.jpg'),
      ourStory: st.ourStory || ('Kaarigari brings together ' + (names.length ? names.join(', ').toLowerCase() : 'handcrafted objects') + ' for everyday rooms, each piece carrying the marks of the hands that made it.'),
    };
  }

  // ---------- shadow root ----------
  let host = null, root = null, drawer = null, main = null, cssText = null, ready = null, lastPath = '';
  const $ = (s) => root.querySelector(s);
  const $$ = (s) => [...root.querySelectorAll(s)];

  async function load() {
    if (ready) return ready;
    ready = (async () => {
      if (!document.getElementById('kaarigari-fonts')) {
        const l = document.createElement('link'); l.id = 'kaarigari-fonts'; l.rel = 'stylesheet';
        l.href = 'https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;0,700;1,700&family=DM+Sans:wght@400;500;600;700&display=swap';
        document.head.append(l);
      }
      if (!document.getElementById('kaarigari-global')) {
        const g = document.createElement('style'); g.id = 'kaarigari-global';
        g.textContent = 'body.kaarigari-on #app{display:none!important}#kaarigari-host{display:block}#kaarigari-host[hidden]{display:none!important}';
        document.head.append(g);
      }
      cssText = await (await fetch('/store/kaarigari.css?v=1')).text();
    })();
    return ready;
  }

  const SHELL = (name) => `
    <a class="skip" href="#content">Skip to content</a>
    <div class="notice">${esc(H.cfg().tagline || 'Indian handicrafts for the home')}</div>
    <header class="site-head">
      <div class="head-nav"><nav aria-label="Main navigation"><a href="#/shop">Shop</a><a href="#/collections">Collections</a><a href="#/our-story">Our story</a></nav></div>
      <a class="wordmark" href="#/" aria-label="${esc(name)} home">${esc(name)}<span>.</span></a>
      <div class="tools">
        <button class="icon" type="button" data-dialog="search" aria-label="Search" aria-haspopup="dialog"><span class="magnify" aria-hidden="true"></span></button>
        <button class="icon bag-trigger" type="button" data-dialog="bag" aria-label="Shopping bag" aria-haspopup="dialog"><span class="bag-icon" aria-hidden="true"></span><span id="bag-count" aria-hidden="true" hidden>0</span></button>
        <button class="icon menu-trigger" type="button" data-dialog="menu" aria-label="Open menu" aria-haspopup="dialog"><span class="menu-icon" aria-hidden="true"></span></button>
      </div>
    </header>
    <main id="content" tabindex="-1"></main>
    <footer class="site-footer"><div class="footer-paper"><div class="footer-content">
      <div class="foot-intro"><div><a class="wordmark footer-brand" href="#/"><img src="${ASSET('rangoli.png')}" alt="" width="44" height="44"><span class="footer-brand-name">${esc(name)}<span>.</span></span></a>
        <p>Indian handicrafts for the home, from wheel-thrown clay and printed cotton to woven fibres and carved wood.</p></div></div>
      <div class="foot-main">
        <nav aria-label="Shop"><h2>Shop</h2><a href="#/shop">All objects</a><a href="#/collections">Collections</a></nav>
        <nav aria-label="Customer care"><h2>Customer care</h2><a href="#/policy/returns">Returns</a><a href="#/policy/shipping">Shipping</a></nav>
        <nav aria-label="Company"><h2>Company</h2><a href="#/our-story">Our story</a><a href="#/contact">Contact</a></nav>
        <nav aria-label="Connect"><h2>Connect with us</h2><a href="#/contact">Contact us</a><a href="#/orders">Order history</a></nav>
      </div></div>
      <div class="footer-skyline"><img class="footer-art" src="${ASSET('footer.jpg')}" alt="" width="1536" height="599" loading="lazy">
        <div class="foot-note"><span>© ${new Date().getFullYear()} ${esc(name)}</span><nav aria-label="Store policies"><a href="#/policy/privacy">Privacy</a><a href="#/policy/terms">Store terms</a></nav></div>
      </div>
    </div></footer>
    <dialog id="drawer" aria-labelledby="drawer-title">
      <div class="drawer-head"><h2 id="drawer-title"></h2><button class="icon" id="drawer-close" type="button" aria-label="Close panel">×</button></div>
      <div id="drawer-body"></div>
    </dialog>`;

  function mount() {
    if (host) return;
    host = document.createElement('div'); host.id = 'kaarigari-host'; document.body.append(host);
    root = host.attachShadow({ mode: 'open' });
    const wrap = document.createElement('div'); wrap.className = 'kaarigari-root';
    const st = document.createElement('style'); st.textContent = cssText;
    root.append(st, wrap);
    wrap.innerHTML = SHELL(H.D.shop.name);
    drawer = wrap.querySelector('#drawer');
    main = wrap.querySelector('#content');
    root.addEventListener('click', onClick);
    root.addEventListener('input', (e) => { if (e.target.id === 'kg-query') search(e.target.value); });
    wrap.querySelector('.skip').addEventListener('click', (e) => { e.preventDefault(); main.focus(); });
    const img = wrap.querySelector('.footer-art');
    if (img) img.style.setProperty('--rangoli-image', 'url("' + ASSET('rangoli.png') + '")');
    root.host.style.setProperty('--rangoli-image', 'url("' + ASSET('rangoli.png') + '")');
    paintBagCount();
  }

  // ---------- views ----------
  function card(p) {
    const img = p.files[0] ? `<img loading="lazy" src="${esc(H.thumb(p.files[0], 480))}" alt="">` : '';
    return `<a class="object product-card${p.stock ? '' : ' sold-out'}" href="#/p/${esc(p.slug)}"><div class="object-image">${img}${p.stock ? '' : '<span class="availability">Sold out</span>'}</div>
      <div class="object-info"><h3>${esc(p.name)}</h3><span class="price">${money(p.price)}</span></div><small>${esc(p.material)}</small>
      <div class="product-peek"><strong>${esc(p.name)}</strong><span>${esc(p.material)}${p.size ? ' · ' + esc(p.size) : ''}</span><p>${esc(p.description)}</p><b>View product</b></div></a>`;
  }
  const grid = (items) => items.length ? '<div class="grid">' + items.map(card).join('') + '</div>' : '<p class="muted">No objects to show yet.</p>';
  const heading = (title, kicker) => `<div class="section-head"><div>${kicker ? `<p class="kicker">${esc(kicker)}</p>` : ''}<h1>${esc(title)}</h1></div></div>`;

  function collectionTiles(tiles) {
    return '<div class="collection-grid">' + tiles.map((t) => `<a class="collection-card" href="#/shop/${encodeURIComponent(t.name)}"><img src="${esc(H.thumb(t.image, 600))}" alt="" loading="lazy"><span class="collection-name">${esc(t.name)}</span></a>`).join('') + '</div>';
  }

  function home(all, c) {
    const latest = all.slice().sort((a, b) => String(b.created).localeCompare(String(a.created))).slice(0, 3);
    const gifts = all.filter((p) => p.price && p.price < 1500).slice(0, 3);
    return `<section class="hero"><img src="${esc(c.heroImage)}" alt="${esc(c.heroAlt)}" fetchpriority="high">
        <div class="hero-copy"><p class="kicker">The Indian craft edit</p><h1>Objects made<br><em>by hand.</em></h1><p>Clay, cloth, brass and woven fibres for the spaces you live in.</p><a href="#/shop" class="button light">Explore the collection</a></div></section>
      ${c.tiles.length ? `<section class="section wrap home-collections"><div class="section-head"><div><p class="kicker">Explore by collection</p><h2>The collections</h2></div><a class="text-link" href="#/collections">All collections</a></div>${collectionTiles(c.tiles)}</section>` : ''}
      <section class="editorial-break"><div class="craft-edit"><div class="craft-copy"><h2>The marks are part of the making.</h2>
        <div class="mobile-copy"><p>Look for the fine rings on a clay vessel and the slight overlap where a block was pressed again on printed cotton.</p></div>
        <a href="#/our-story" class="button light">Our story <span aria-hidden="true">↗</span></a></div><div class="craft-art"><img src="${ASSET('craft.jpg')}" alt="Traditional-style painting of an artisan block-printing indigo cloth in a courtyard" loading="lazy"></div></div></section>
      ${latest.length ? `<section class="section wrap"><div class="section-head"><div><p class="kicker">The latest edit</p><h2>New in the shop</h2></div><a class="text-link" href="#/shop">Shop all</a></div>${grid(latest)}</section>` : ''}
      <section class="story"><div class="story-media"><img src="${esc(c.storyImage)}" alt="" loading="lazy"></div><div class="story-copy"><p class="kicker">The craft</p><h2>${esc(c.storyTitle)}</h2>
        <div class="mobile-copy"><p>A carved block meets the cloth. The hand lifts, shifts, and presses again.</p></div></div></section>
      ${gifts.length ? `<section class="section wrap"><div class="section-head"><div><p class="kicker">Under ₹1,500</p><h2>Small gifts, thoughtfully chosen</h2></div><a class="text-link" href="#/shop">Shop gifts</a></div>${grid(gifts)}</section>` : ''}
      <section class="service-links wrap"><a href="#/policy/shipping"><strong>Delivery</strong><span>See your shipping options.</span></a><a href="#/policy/returns"><strong>Returns</strong><span>Our returns policy.</span></a><a href="#/contact"><strong>Get in touch</strong><span>Ask about an object or a gift.</span></a></section>`;
  }

  function shopPage(all, category) {
    const names = collectionsOf(all);
    const items = category ? all.filter((p) => inCol(p, category)) : all;
    const label = category || 'All objects';
    const tabs = ['', ...names].map((n) => `<a href="#/shop${n ? '/' + encodeURIComponent(n) : ''}"${n === (category || '') ? ' aria-current="page"' : ''}>${esc(n || 'All objects')}</a>`).join('');
    return `<section class="wrap section">${heading(label, 'The collection')}<nav class="tabs" aria-label="Filter by collection">${tabs}</nav><div class="shop-toolbar"><span>${items.length} pieces</span></div>${grid(items)}</section>`;
  }

  function featuredPage(all, c) {
    const items = c.featured;
    const banner = items[0];
    return `<section class="wrap section pottery"><div class="pottery-intro"><div><a href="#/collections" class="text-link">All collections</a><p class="kicker">The edit</p><h1>Earth, shaped by hand.</h1>
        <p>A closer look at the ${esc(c.featuredLabel.toLowerCase())} collection.</p><a class="button" href="#/shop/${encodeURIComponent(c.featuredLabel)}">Shop this collection</a></div>
        <div class="pottery-portrait"><img src="${ASSET('culture-clay.jpg')}" alt="An artisan at work" loading="lazy"></div></div>
      <div class="pottery-banner"><img src="${ASSET('pottery.jpg')}" alt="Handmade objects arranged on sandstone"><span class="pottery-display" aria-hidden="true">${esc(c.featuredLabel)}</span>
        ${banner ? `<a class="pottery-feature" href="#/p/${esc(banner.slug)}">${banner.files[0] ? `<img src="${esc(H.thumb(banner.files[0], 160))}" alt="">` : ''}<span><strong>${esc(banner.name)}</strong><small>${money(banner.price)}</small></span></a>` : ''}</div>
      <div class="section-head pottery-products"><h2>From the collection</h2><a class="text-link" href="#/shop/${encodeURIComponent(c.featuredLabel)}">Shop all</a></div>${grid(items)}</section>`;
  }

  function ourStoryPage(c) {
    return `<section class="section wrap prose">${heading('Our story')}<div class="mobile-copy"><p>${esc(c.ourStory)}</p></div><a class="text-link" href="#/collections">Explore the collections</a></section>`;
  }

  function detail(p) {
    return `<section class="wrap section"><p><a class="text-link" href="#/shop">Back to the collection</a></p><div class="detail">
        <div class="object-image">${p.files[0] ? `<img src="${esc(H.thumb(p.files[0], 900))}" alt="${esc(p.name)}">` : ''}</div>
        <div><p class="kicker">${esc(p.material)}</p><h1>${esc(p.name)}</h1><p class="price">${money(p.price)}</p>
        <p>${esc(p.description)}</p><button class="button" type="button" data-add="${esc(p.slug)}" ${p.stock ? '' : 'disabled'}>${p.stock ? 'Add to bag' : 'Sold out'}</button>
        <details open><summary>Material and dimensions</summary><p>${esc(p.material)}${p.size ? ' · ' + esc(p.size) : ''}</p></details>
        ${p.washcare ? `<details><summary>Care</summary><p>${esc(p.washcare)}</p></details>` : ''}
        <details><summary>Delivery and returns</summary><p><a class="text-link" href="#/policy/shipping">Shipping</a> · <a class="text-link" href="#/policy/returns">Returns</a></p></details></div></div></section>`;
  }

  function collectionsPage(c) {
    return `<section class="wrap section">${heading('Collections', 'Browse by collection')}${c.tiles.length ? collectionTiles(c.tiles) : '<p class="muted">No collections yet.</p>'}</section>`;
  }

  // ---------- bag ----------
  const lines = () => H.bagLines();
  function paintBagCount() { const n = H.bagCount(); const el = $('#bag-count'); if (el) { el.hidden = !n; el.textContent = n; } }
  function bagMarkup() {
    const ls = lines();
    if (!ls.length) return '<p>Your bag is empty.</p><a class="text-link" href="#/shop">Explore the collection</a>';
    const rows = ls.map((l, i) => `<div class="bag-line"><div class="bag-detail"><a href="#/p/${esc(l.s.id)}">${esc(l.s.name)}</a><p class="muted">${money(l.vr.price)}</p></div>
      <div class="qty"><button type="button" data-step="-1" data-i="${i}" aria-label="Remove one ${esc(l.s.name)}">−</button><span>${l.q}</span><button type="button" data-step="1" data-i="${i}" aria-label="Add one ${esc(l.s.name)}">+</button></div></div>`).join('');
    return rows + `<div class="bag-total"><strong>Subtotal</strong><span class="price">${money(H.bagTotal())}</span></div><a class="button" href="#/checkout">Go to checkout</a>`;
  }
  function openDrawer(kind) {
    $('#drawer-title').textContent = { search: 'Search', bag: 'Your bag', menu: 'Explore ' + H.D.shop.name }[kind];
    const body = $('#drawer-body');
    if (kind === 'bag') body.innerHTML = bagMarkup();
    if (kind === 'menu') body.innerHTML = '<nav class="craft-menu" aria-label="Menu"><div class="menu-primary"><a href="#/">Home</a><a href="#/shop">Shop all objects</a><a href="#/collections">Collections</a></div><div class="menu-secondary"><a href="#/our-story">Our story</a><a href="#/contact">Contact</a></div></nav>';
    if (kind === 'search') { body.innerHTML = '<label for="kg-query">Find an object</label><input id="kg-query" type="search" placeholder="Try brass or indigo"><div id="kg-results" class="drawer-links" aria-live="polite"></div>'; search(''); }
    drawer.dataset.kind = kind;
    if (!drawer.open) drawer.showModal();
    if (kind === 'search') body.querySelector('input').focus();
  }
  function search(q) {
    const all = products(); const r = all.filter((p) => (p.name + ' ' + p.material).toLowerCase().includes(String(q || '').trim().toLowerCase()));
    const box = $('#kg-results'); if (!box) return;
    box.innerHTML = r.length ? r.map((p) => `<a href="#/p/${esc(p.slug)}">${esc(p.name)} · ${money(p.price)}</a>`).join('') : '<p>No objects match your search.</p>';
  }

  function onClick(event) {
    const t = event.target;
    const dlg = t.closest && t.closest('[data-dialog]'); if (dlg) { openDrawer(dlg.dataset.dialog); return; }
    if (t.id === 'drawer-close' || t === drawer || (t.closest && t.closest('#drawer a'))) { drawer.close(); return; }
    const add = t.closest && t.closest('[data-add]');
    if (add) {
      const p = bySlug(products(), add.dataset.add);
      const v = p && p.style.variants && p.style.variants[0];
      if (v) { H.addBag(v.id, 1); paintBagCount(); }
      openDrawer('bag'); return;
    }
    const step = t.closest && t.closest('[data-step]');
    if (step) {
      const i = Number(step.dataset.i); const ls = lines(); const l = ls[i]; if (!l) return;
      const row = H.bag.find((b) => b.v === l.v); if (!row) return;
      const d = Number(step.dataset.step); if (d < 0 && row.q <= 1) H.bag.splice(H.bag.indexOf(row), 1); else row.q += d;
      H.saveBag(); paintBagCount(); openDrawer('bag');
    }
  }
  function render(parts) {
    const all = products(); const c = settings(all);
    const id = parts[0] || 'home'; const arg = decodeURIComponent(parts[1] || '');
    if (id === 'home') main.innerHTML = home(all, c);
    else if (id === 'shop') main.innerHTML = shopPage(all, arg);
    else if (id === 'collections') main.innerHTML = collectionsPage(c);
    else if (id === 'featured') main.innerHTML = featuredPage(all, c);
    else if (id === 'our-story') main.innerHTML = ourStoryPage(c);
    else if (id === 'p' && bySlug(all, arg)) main.innerHTML = detail(bySlug(all, arg));
    else main.innerHTML = `<section class="section wrap prose"><a class="text-link" href="#/shop">Browse the collection</a></section>`;
    window.scrollTo(0, 0);
    paintBagCount();
  }

  // ---------- routing ----------
  const OWN = new Set(['home', 'shop', 'collections', 'featured', 'our-story', 'p']);
  function owns(id) { return OWN.has(id); }
  // Routes Kaarigari does not draw itself (checkout, account, orders, policies, contact) keep the Kaarigari header
  // and footer around the store's own shared content -- same "frame" contract as studs.js.
  let framed = false, viewHome = null;
  function unframe() {
    if (!framed) return; framed = false;
    const v = document.getElementById('view');
    if (v && viewHome && v.parentNode === host) viewHome.parent.insertBefore(v, viewHome.next);
    viewHome = null;
  }
  async function frame() {
    await load(); mount(); host.hidden = false; document.body.classList.add('kaarigari-on');
    if (drawer.open) drawer.close();
    const v = document.getElementById('view');
    if (v && v.parentNode !== host) { viewHome = { parent: v.parentNode, next: v.nextSibling }; host.append(v); }
    framed = true;
    main.innerHTML = '<slot></slot>';
    paintBagCount(); lastPath = ['__frame'];
  }

  window.KaarigariTheme = {
    owns,
    async show(parts) { await load(); mount(); unframe(); host.hidden = false; document.body.classList.add('kaarigari-on'); lastPath = parts; render(parts); },
    hide() { unframe(); if (host) host.hidden = true; document.body.classList.remove('kaarigari-on'); },
    frame,
    refresh() { if (host && !host.hidden && lastPath) { const parts = lastPath, wasFramed = framed; unframe(); host.remove(); host = null; mount(); host.hidden = false; if (wasFramed) frame(); else render(parts); } },
    ready: load,
  };
})();
