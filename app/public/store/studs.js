/* Studs storefront theme (renderer).
   Loaded by store.js ONLY when the store's active theme is 'studs'. Every other store never requests this file.
   It draws the Studs pages (home, studio drop, shop all, collections, product, search, bag drawer) inside a shadow root so its
   styles cannot touch, or be touched by, the rest of the storefront. Cart, checkout, orders, accounts and policies stay
   with the shared store code: this file only reads the store's real catalogue and uses the shared bag.
   Visual source: the approved Studs preview (docs/CLAUDE-STUDS.md). Settings come from the store's published theme
   settings (config.studs); every setting has a default built from the store's own catalogue. */
(function () {
  'use strict';
  const H = window.StoreHost;
  if (!H) return;
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const money = (n) => '₹' + Math.round(+n || 0).toLocaleString('en-IN');
  const slug = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const safeUrl = (u) => (/^(https?:)?\/\/|^\//.test(String(u || '')) ? String(u) : '');
  const safeHref = (u) => (/^(https?:\/\/|\/|#|mailto:|tel:)/.test(String(u || '')) ? String(u) : '#/');
  const galleryLabels = ['Front view', 'Alternate angle', 'Detail'];

  // ---------- data from the store, in the shape the Studs pages use ----------
  const S = () => (H.cfg().studs || {});
  function products() {
    const cols = H.D.collections || [];
    return H.STY().map((s) => {
      const col = cols.find((c) => (c.styleIds || []).includes(s.id));
      const files = H.photos(s).map(safeUrl).filter(Boolean);
      const left = H.isGone(s) ? 0 : H.leftOf(s);
      const sizes = H.sizesOf(s);
      return { id: s.id, slug: s.id, name: s.name, price: +s.price || 0, category: s.category || 'Products', collection: col ? col.name : '',
        colours: H.colours(s), colour: H.colours(s)[0] || '', files, sizes: sizes.length ? sizes : ['One size'], stock: left, description: s.description || '',
        fabric: s.fabric || (s.details && s.details.fabric) || '', washcare: s.washcare || (s.details && s.details.washcare) || '', style: s, created: s.createdAt || '' };
    });
  }
  const collectionNames = (all) => [...new Set(all.map((p) => p.collection).filter(Boolean))];
  const bySlug = (all, id) => all.find((p) => p.slug === id);
  const newest = (all, n) => all.slice().sort((a, b) => String(b.created).localeCompare(String(a.created))).slice(0, n);

  // settings with defaults taken from the catalogue
  function settings(all) {
    const st = S(); const names = collectionNames(all);
    const firstPhoto = (p) => (p && p.files[0]) || '';
    const dropNames = Array.isArray(st.dropSlugs) && st.dropSlugs.length ? st.dropSlugs : null;
    let drop = dropNames ? dropNames.map((x) => bySlug(all, x)).filter(Boolean) : (st.dropCollection ? all.filter((p) => p.collection === st.dropCollection) : []);
    if (!drop.length) drop = newest(all, 4);
    const dropIds = new Set(drop.map((p) => p.slug));
    const colImg = st.collectionImages || {};
    const campaigns = (Array.isArray(st.campaigns) && st.campaigns.length ? st.campaigns
      : names.map((n) => ({ image: colImg[n] || firstPhoto(all.find((p) => p.collection === n)), collection: n }))).filter((c) => c.image);
    return {
      announcements: (Array.isArray(st.announcements) && st.announcements.length ? st.announcements : [{ text: H.cfg().tagline || ('Welcome to ' + H.D.shop.name), href: '#/shop' }]),
      hero: { image: safeUrl(st.heroImage) || firstPhoto(drop[0]) || firstPhoto(all[0]), href: st.heroHref || '#/drop', alt: st.heroAlt || H.D.shop.name, label: st.heroLabel || 'Explore the drop' },
      drop, dropIds, dropTitle: st.dropTitle || 'New in',
      moreTitle: st.moreTitle || ('More from ' + H.D.shop.name),
      quote: st.quoteImage ? { image: safeUrl(st.quoteImage), text: st.quoteText || '', alt: st.quoteAlt || '' } : null,
      closing: st.closingImage ? { image: safeUrl(st.closingImage), text: st.closingText || '', href: st.closingHref || '#/shop', alt: st.closingAlt || '' } : null,
      campaigns, colImg,
      footer: { links: Array.isArray(st.footerLinks) && st.footerLinks.length ? st.footerLinks : null, channels: Array.isArray(st.channels) ? st.channels : [] },
      names,
    };
  }

  // ---------- shadow root ----------
  let host = null, root = null, drawer = null, main = null, panel = null, panelBody = null, panelTitle = null, stopCampaigns = () => {}, cssText = null, ready = null, lastPath = '';
  const $ = (s) => root.querySelector(s);
  const $$ = (s) => [...root.querySelectorAll(s)];

  async function load() {
    if (ready) return ready;
    ready = (async () => {
      if (!document.getElementById('studs-fonts')) {
        const l = document.createElement('link'); l.id = 'studs-fonts'; l.rel = 'stylesheet';
        l.href = 'https://fonts.googleapis.com/css2?family=Dosis:wght@400;500;600&family=Inter:wght@400;500;600;900&display=swap'; document.head.append(l);
      }
      if (!document.getElementById('studs-global')) { const g = document.createElement('style'); g.id = 'studs-global'; g.textContent = 'body.studs-on #app{display:none!important}#studs-host{display:block}#studs-host[hidden]{display:none!important}'; document.head.append(g); }
      cssText = await (await fetch('/store/studs.css?v=7')).text();
    })();
    return ready;
  }

  const SHELL = (name, depts, cats) => `
  <a class="skip" href="#content">Skip to content</a>
  <div class="announcement" aria-label="Store announcements"><button type="button" data-announcement="-1" aria-label="Previous announcement"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6"/></svg></button><a id="announcement-link" href="#/shop" aria-live="polite"></a><button type="button" data-announcement="1" aria-label="Next announcement"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m10 6 6 6-6 6"/></svg></button></div>
  <div class="store-nav"><header class="header">
    <button class="icon-control menu-button" type="button" data-panel="menu" aria-label="Menu" aria-haspopup="dialog"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M3 12h13M3 18h8"/></svg></button>
    <a class="brand" href="#/" aria-label="${esc(name)} home">${esc(name)}<span>.</span></a>
    <div class="tools">
      <button class="icon-control" type="button" data-panel="search" aria-label="Search" aria-haspopup="dialog"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg></button>
      <a class="icon-control account-link" href="#/me" aria-label="Account"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7" r="3"/><path d="M4 20v-1a8 8 0 0 1 16 0v1"/></svg></a>
      <button class="icon-control bag-button" type="button" data-panel="bag" aria-haspopup="dialog"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 6h10a2 2 0 0 1 2 1.8l1 10A2 2 0 0 1 18 20H6a2 2 0 0 1-2-2.2l1-10A2 2 0 0 1 7 6Z"/><path d="M9 9a3 3 0 0 0 6 0"/></svg><span class="sr-only">Shopping bag, </span><span id="bag-count" data-empty="true">0</span><span class="sr-only"> items</span></button>
    </div></header>
    <nav class="primary" aria-label="Shop departments">${depts}</nav>
    <nav class="cats" aria-label="Categories">${cats}</nav></div>
  <main id="content" tabindex="-1"></main>
  <footer class="footer" id="studs-footer"></footer>
  <dialog id="menu-drawer" aria-label="Store menu"></dialog>
  <dialog id="panel" aria-labelledby="panel-title"><div class="panel-head"><h2 id="panel-title"></h2><button id="close-panel" type="button" aria-label="Close panel">×</button></div><div id="panel-body"></div></dialog>
  <div class="sr-only" role="status" id="status"></div>`;

  function mount() {
    if (host) return;
    host = document.createElement('div'); host.id = 'studs-host'; document.body.append(host);
    root = host.attachShadow({ mode: 'open' });
    const wrap = document.createElement('div'); wrap.className = 'studs-root';
    const st = document.createElement('style'); st.textContent = cssText;
    root.append(st, wrap);
    const all = products(); const cfgv = settings(all);
    const dept = (a, d, t) => `<a href="${a}" data-department="${d}">${t}</a>`;
    const catNames = [...new Set(all.map((p) => p.category).filter(Boolean))];
    const cat = (a, k, t) => `<a href="${a}" data-cat="${esc(k)}">${esc(t)}</a>`;
    const catRow = cat('#/', '@home', 'Home') + cat('#/drop', '@drop', S().dropNav || 'New drops') + cat('#/shop', '@all', 'All') + catNames.map((n) => cat('#/shop?category=' + encodeURIComponent(n), n, n)).join('');
    wrap.innerHTML = SHELL(H.D.shop.name, dept('#/drop', 'studio', esc(S().dropNav || 'Studio drop')) + dept('#/shop', 'shop', 'Shop all') + dept('#/collections', 'collections', 'Collections'), catRow);
    drawer = wrap.querySelector('#menu-drawer');
    main = wrap.querySelector('#content'); panel = wrap.querySelector('#panel'); panelBody = wrap.querySelector('#panel-body'); panelTitle = wrap.querySelector('#panel-title');
    // announcements
    let ai = 0; const link = wrap.querySelector('#announcement-link');
    const paintA = () => { const m = cfgv.announcements[ai % cfgv.announcements.length]; link.textContent = m.text; link.href = safeHref(m.href); };
    wrap.querySelectorAll('[data-announcement]').forEach((b) => b.addEventListener('click', () => { const n = cfgv.announcements.length; ai = (ai + Number(b.dataset.announcement) + n) % n; paintA(); }));
    if (cfgv.announcements.length < 2) wrap.querySelectorAll('[data-announcement]').forEach((b) => { b.hidden = true; });
    paintA();
    root.addEventListener('click', onClick);
    wrap.querySelector('.skip').addEventListener('click', (e) => { e.preventDefault(); main.focus(); });
    const mf = matchMedia('(max-width:760px)'); const sync = () => $$('.footer-group').forEach((g) => { g.open = !mf.matches; }); mf.addEventListener('change', sync); host._syncFooter = sync;
    paintFooter(all, cfgv); paintBagCount();
  }

  function paintFooter(all, c) {
    const links = c.footer.links || [{ label: 'Search', panel: 'search' }, { label: 'Shop', href: '#/shop' }, { label: 'Collections', href: '#/collections' }, { label: 'My account', href: '#/me' }, { label: 'Customer care', href: '#/contact' }];
    const pol = [['terms', 'Terms of use'], ['privacy', 'Privacy'], ['shipping', 'Shipping and delivery'], ['returns', 'Returns and exchanges']];
    const ch = c.footer.channels.filter((x) => x && x.href);
    $('#studs-footer').innerHTML = `<details class="footer-group" open><summary>Quick links</summary><nav aria-label="Quick links">${links.map((l) => l.panel ? `<button type="button" data-panel="${esc(l.panel)}" aria-haspopup="dialog">${esc(l.label)}</button>` : `<a href="${esc(safeHref(l.href))}">${esc(l.label)}</a>`).join('')}</nav></details>
    <details class="footer-group" open><summary>Policies</summary><nav aria-label="Policies">${pol.map(([k, t]) => `<a href="#/policy/${k}">${t}</a>`).join('')}</nav></details>
    ${ch.length ? `<details class="footer-group" open><summary>Follow us</summary><nav aria-label="Channels"><div class="footer-channels">${ch.map((x) => `<a href="${esc(safeHref(x.href))}" aria-label="${esc(x.label || 'Channel')}" rel="noopener">${esc((x.label || '·').slice(0, 2))}</a>`).join('')}</div></nav></details>` : ''}
    <div class="footer-bottom"><span>© ${new Date().getFullYear()} <a href="#/">${esc(H.D.shop.name)}</a></span><span>Powered by AUZslab</span></div>`;
    if (host._syncFooter) host._syncFooter();
  }

  // ---------- views ----------
  function card(p, editorial) {
    const img = p.files[0] ? `<img loading="lazy" src="${esc(H.thumb(p.files[0], 480))}" alt="">` : '';
    return `<article class="product-card${p.stock ? '' : ' sold-out'}"><a href="#/p/${esc(p.slug)}"><div class="cover">${img}${p.stock ? '' : '<span class="availability">Sold out</span>'}</div><div class="info"><span class="card-name">${esc(p.name)}</span>${editorial ? '' : `<span class="card-price">${money(p.price)}</span>`}</div></a></article>`;
  }
  const grid = (items, editorial) => items.length ? '<div class="grid' + (editorial ? ' editorial-grid' : '') + '">' + items.map((p) => card(p, editorial)).join('') + '</div>' : '<p class="copy">No products match these choices.</p>';
  const sectionHead = (label, title) => `<div class="section-head"><div><p class="eyebrow">${esc(label)}</p><h2>${esc(title)}</h2></div></div>`;
  const matches = (p, q) => [p.name, p.category, p.colour, p.collection].join(' ').toLowerCase().includes(String(q).toLowerCase());
  const contentPage = (title, html) => { main.innerHTML = `<section class="section catalogue-head"><h1 class="page-title">${esc(title)}</h1><div class="empty">${html}</div></section>`; };

  function home(all, c) {
    const more = all.filter((p) => !c.dropIds.has(p.slug)).slice(0, 8);
    const hero = c.hero.image ? `<section class="hero" aria-labelledby="campaign-title"><img class="hero-image" fetchpriority="high" src="${esc(c.hero.image)}" alt="${esc(c.hero.alt)}"><h1 id="campaign-title" class="sr-only">${esc(H.D.shop.name)}</h1><a class="button" href="${esc(safeHref(c.hero.href))}">${esc(c.hero.label)} <svg class="arr" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M7 17 17 7M8.5 7H17v8.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></a></section>` : '';
    return hero +
      (c.drop.length ? `<section class="showcase" aria-labelledby="new-in"><div class="showcase-head"><h2 id="new-in">${esc(c.dropTitle)}</h2><a href="#/drop">View the drop <svg class="arr" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M7 17 17 7M8.5 7H17v8.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></a></div>${grid(c.drop, true)}</section>` : '') +
      (c.quote ? `<figure class="home-banner manifesto-banner"><img src="${esc(c.quote.image)}" loading="lazy" decoding="async" alt="${esc(c.quote.alt)}">${c.quote.text ? `<figcaption>${esc(c.quote.text).replace(/\n/g, '<br>')}</figcaption>` : ''}</figure>` : '') +
      (more.length ? `<section class="showcase" aria-labelledby="more-genx"><div class="showcase-head"><h2 id="more-genx">${esc(c.moreTitle)}</h2><a href="#/shop">Shop all <svg class="arr" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M7 17 17 7M8.5 7H17v8.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></a></div>${grid(more, true)}</section>` : '') +
      (c.closing ? `<a class="home-banner closing-banner" href="${esc(safeHref(c.closing.href))}"><img src="${esc(c.closing.image)}" loading="lazy" decoding="async" alt="${esc(c.closing.alt)}">${c.closing.text ? `<span>${esc(c.closing.text)}</span>` : ''}</a>` : '');
  }

  function campaignCarousel(c) {
    if (!c.campaigns.length) return '';
    return `<section class="campaigns" aria-label="Shop the campaigns"><div class="campaign-track" tabindex="0" aria-label="Campaign slides">${c.campaigns.map(({ image, collection }, i) => `
      <article class="campaign-slide"><img src="${esc(image)}" alt="" ${i ? 'loading="lazy"' : 'fetchpriority="high"'}><div class="campaign-copy"><a class="button" href="#/collection/${esc(slug(collection))}" aria-label="Shop now: ${esc(collection)}">Shop now <svg class="arr" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M7 17 17 7M8.5 7H17v8.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></a><h2>${esc(collection)}</h2></div></article>`).join('')}</div>
      <div class="campaign-controls"><button type="button" data-campaign-step="-1" aria-label="Previous campaign">‹</button>${c.campaigns.map(({ collection }, i) => `<button type="button" data-campaign-slide="${i}" aria-label="Show ${esc(collection)}" aria-pressed="${i === 0}"><span></span></button>`).join('')}<button type="button" data-campaign-step="1" aria-label="Next campaign">›</button><button type="button" class="campaign-play" aria-label="Pause slideshow">Ⅱ</button></div></section>`;
  }

  function bindCarousel() {
    const carousel = $('.campaigns'); if (!carousel) return;
    const track = carousel.querySelector('.campaign-track'); const slides = [...track.children]; const dots = [...carousel.querySelectorAll('[data-campaign-slide]')];
    const max = () => track.scrollWidth - track.clientWidth; const position = (i) => Math.min(max(), slides[i].offsetLeft);
    const last = () => slides.findIndex((_, i) => position(i) >= max() - 1);
    const active = () => { const end = Math.max(0, last()); return slides.slice(0, end + 1).reduce((n, _, i) => Math.abs(track.scrollLeft - position(i)) < Math.abs(track.scrollLeft - position(n)) ? i : n, 0); };
    const sync = () => dots.forEach((d, i) => { d.hidden = i > last() && last() >= 0; d.setAttribute('aria-pressed', String(i === active())); });
    const go = (i) => { const end = Math.max(0, last()); const t = (i + end + 1) % (end + 1); track.scrollTo({ left: position(t), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' }); };
    carousel.querySelectorAll('[data-campaign-step],[data-campaign-slide]').forEach((b) => b.addEventListener('click', () => go(b.dataset.campaignSlide === undefined ? active() + Number(b.dataset.campaignStep) : Number(b.dataset.campaignSlide))));
    track.addEventListener('scroll', sync, { passive: true });
    const ro = new ResizeObserver(() => { if (track.isConnected) sync(); else ro.disconnect(); }); ro.observe(track);
    const motion = matchMedia('(prefers-reduced-motion: reduce)'); const toggle = carousel.querySelector('.campaign-play'); let playing = !motion.matches;
    const showPlay = () => { toggle.textContent = playing ? 'Ⅱ' : '▷'; toggle.setAttribute('aria-label', playing ? 'Pause slideshow' : 'Play slideshow'); };
    toggle.addEventListener('click', () => { playing = !playing; showPlay(); });
    const timer = setInterval(() => { if (!playing || document.hidden || carousel.matches(':hover') || track.contains(root.activeElement)) return; const b = track.getBoundingClientRect(); if (b.bottom > 0 && b.top < innerHeight) go(active() + 1); }, 4200);
    stopCampaigns = () => { clearInterval(timer); ro.disconnect(); };
    showPlay(); sync();
  }

  // Filters and Sort by on a category / Shop all page (size, colour, price; sort order). Kept in LV for the page that is open.
  let LV = null;
  function listResult() {
    const v = LV; const min = +v.min || 0, max = +v.max || Infinity;
    const out = v.items.filter((p) => (!v.sizes.length || p.sizes.some((x) => v.sizes.includes(x))) && (!v.colours.length || p.colours.some((x) => v.colours.includes(x))) && p.price >= min && p.price <= max);
    if (v.sort === 'price-up') out.sort((a, b) => a.price - b.price); else if (v.sort === 'price-down') out.sort((a, b) => b.price - a.price); else if (v.sort === 'newest') out.sort((a, b) => String(b.created).localeCompare(String(a.created)));
    return out;
  }
  function paintList() {
    const box = $('#plist'); if (!box || !LV) return; box.innerHTML = grid(listResult());
    const n = LV.sizes.length + LV.colours.length + (LV.min || LV.max ? 1 : 0);
    const fb = $('[data-list=filters]'), sb = $('[data-list=sort]');
    if (fb) fb.textContent = n ? 'Filters (' + n + ')' : 'Filters';
    if (sb) sb.textContent = LV.sort === 'featured' ? 'Sort by' : 'Sort by: ' + ({ 'price-up': 'Price low to high', 'price-down': 'Price high to low', newest: 'Newest' }[LV.sort]);
  }
  function listPanel(kind) {
    if (!LV) return '';
    if (kind === 'sort') return '<div class="lp-sort">' + [['featured', 'Featured'], ['newest', 'Newest'], ['price-up', 'Price: low to high'], ['price-down', 'Price: high to low']].map(([k, t]) => `<button type="button" data-sort="${k}"${LV.sort === k ? ' aria-pressed="true"' : ''}>${t}</button>`).join('') + '</div>';
    const sizes = [...new Set(LV.items.flatMap((p) => p.sizes))], cols = [...new Set(LV.items.flatMap((p) => p.colours))];
    const chips = (name, list, on) => list.map((x) => `<label class="lp-chip"><input type="checkbox" name="${name}" value="${esc(x)}"${on.includes(x) ? ' checked' : ''}><span>${esc(x)}</span></label>`).join('');
    return `<form class="lp-filters" id="lp-form"><fieldset><legend>Size</legend><div class="lp-chips">${chips('size', sizes, LV.sizes)}</div></fieldset>
      ${cols.length ? `<fieldset><legend>Colour</legend><div class="lp-chips">${chips('colour', cols, LV.colours)}</div></fieldset>` : ''}
      <fieldset><legend>Price (Rs)</legend><div class="lp-price"><input name="min" type="number" min="0" inputmode="numeric" placeholder="From" value="${esc(LV.min)}"><input name="max" type="number" min="0" inputmode="numeric" placeholder="To" value="${esc(LV.max)}"></div></fieldset>
      <div class="lp-actions"><button class="button" type="submit" id="lp-show">Show ${listResult().length} pieces</button><button type="button" class="lp-clear" data-clear>Clear all</button></div></form>`;
  }
  function bindListPanel(kind) {
    if (kind === 'sort') { panelBody.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => { LV.sort = b.dataset.sort; paintList(); panel.close(); })); return; }
    const form = panelBody.querySelector('#lp-form'); if (!form) return;
    const read = () => { const d = new FormData(form); LV.sizes = d.getAll('size'); LV.colours = d.getAll('colour'); LV.min = String(d.get('min') || ''); LV.max = String(d.get('max') || ''); paintList(); const c = panelBody.querySelector('#lp-show'); if (c) c.textContent = 'Show ' + listResult().length + ' pieces'; };
    form.addEventListener('input', read);
    form.addEventListener('submit', (e) => { e.preventDefault(); read(); panel.close(); });
    form.querySelector('[data-clear]').addEventListener('click', () => { form.reset(); form.querySelectorAll('input[type=checkbox]').forEach((i) => { i.checked = false; }); form.querySelectorAll('input[type=number]').forEach((i) => { i.value = ''; }); read(); });
  }
  function listing(items, title, query, filters, c, intro) {
    if (!filters) {
      const head = intro ? `<div class="cat-intro"><h1>${esc(title)}</h1><p>${esc(intro)}</p></div>` : `<h1 class="sr-only">${esc(title)}</h1>`;
      LV = { items, sizes: [], colours: [], min: '', max: '', sort: 'featured' };
      main.innerHTML = (title === 'Shop all' ? campaignCarousel(c) : '') + `<section class="section product-listing" aria-label="${esc(title)}">${head}<div class="list-bar"><button type="button" data-list="filters">Filters</button><button type="button" data-list="sort">Sort by</button></div><div id="plist">${grid(items)}</div></section>`;
      bindCarousel(); return;
    }
    const categories = [...new Set(items.map((p) => p.category))].sort();
    main.innerHTML = `<section class="section product-listing"><div class="catalogue-head"><h1 class="page-title">${esc(title)}</h1><div class="filters">
      <label>Category<select id="category"><option value="">All categories</option>${categories.map((n) => `<option>${esc(n)}</option>`).join('')}</select></label>
      <label>Sort by<select id="sort"><option value="featured">Featured</option><option value="price-up">Price low to high</option><option value="price-down">Price high to low</option></select></label>
      <span class="copy" id="results-count" aria-live="polite"></span></div></div><div id="results"></div></section>`;
    const cat = $('#category'), sort = $('#sort');
    const refresh = () => { const m = items.filter((p) => (!cat.value || p.category === cat.value) && matches(p, query || '')); if (sort.value !== 'featured') m.sort((a, b) => sort.value === 'price-up' ? a.price - b.price : b.price - a.price); $('#results-count').textContent = m.length + (m.length === 1 ? ' item' : ' items'); $('#results').innerHTML = grid(m); };
    cat.addEventListener('change', refresh); sort.addEventListener('change', refresh); refresh();
  }

  // bag helpers on top of the shared bag (store.js owns the data, prices and stock)
  const lines = () => H.bagLines();
  const lineLeft = (l) => Math.max(0, (l.vr.left || 0) - l.q);
  function variantFor(p, size, colour) {
    const vs = p.style.variants; return vs.find((v) => (p.sizes[0] === 'One size' || v.size === size) && (!colour || v.colour === colour)) || vs.find((v) => v.size === size) || vs[0];
  }
  const remaining = (p) => Math.max(0, p.stock - lines().filter((l) => l.s.id === p.slug).reduce((t, l) => t + l.q, 0));
  function paintBagCount() { const n = H.bagCount(); const el = $('#bag-count'); if (el) { el.textContent = n; el.dataset.empty = String(!n); } }

  function detail(p, all, c) {
    const lab = (i) => galleryLabels[i] || ('View ' + (i + 1)); const f = p.files;
    const related = all.filter((x) => x.slug !== p.slug && ((p.collection && x.collection === p.collection) || x.category === p.category)).slice(0, 4);
    const sizeBlock = p.sizes[0] === 'One size' ? '' : `<div class="size-block"><fieldset ${p.stock ? '' : 'disabled'}><legend>Size <span id="selected-size">${esc(p.sizes[0])}</span></legend><div class="sizes">${p.sizes.map((s, i) => `<label><input class="sr-only" form="add-product" type="radio" name="size" value="${esc(s)}" ${i === 0 ? 'checked' : ''} required>${esc(s)}</label>`).join('')}</div></fieldset><button class="size-guide" type="button" aria-haspopup="dialog">Size guide</button></div>`;
    const colourBlock = p.colours.length > 1 ? `<div class="size-block"><fieldset ${p.stock ? '' : 'disabled'}><legend>Colour <span id="selected-colour">${esc(p.colours[0])}</span></legend><div class="sizes">${p.colours.map((s, i) => `<label><input class="sr-only" form="add-product" type="radio" name="colour" value="${esc(s)}" ${i === 0 ? 'checked' : ''}>${esc(s)}</label>`).join('')}</div></fieldset></div>` : '';
    const info = [['Material', p.fabric], ['Colour', p.colour], ['Care', p.washcare]].filter(([, v]) => v);
    main.innerHTML = `<section class="section pdp"><div class="product-media"><div class="product-photo">${f[0] ? `<img class="main-photo" src="${esc(f[0])}" alt="${esc(p.name)} · ${lab(0)}">` : ''}<span class="photo-count" aria-live="polite">${f.length ? '1 / ' + f.length : ''}</span></div><div class="gallery" aria-label="Product gallery">
      ${f.map((u, i) => `<button type="button" aria-label="${lab(i)}" aria-pressed="${i === 0}" data-photo="${i}"><img src="${esc(H.thumb(u, 480))}" alt=""></button>`).join('')}</div></div>
      <div class="product-info"><a class="eyebrow product-back" href="#/shop">← ${esc(p.category)}</a><div class="product-heading"><h1>${esc(p.name)}</h1><strong>${money(p.price)}</strong></div>${p.colour ? `<p class="product-colour">Colour <strong>${esc(p.colour)}</strong></p>` : ''}
      ${colourBlock}${sizeBlock}
      <form id="add-product" data-product="${esc(p.slug)}"><div class="purchase-row">${p.stock ? `<div class="product-quantity"><button type="button" data-product-step="-1" aria-label="Decrease quantity">−</button><input aria-label="Quantity" name="quantity" type="number" inputmode="numeric" min="1" value="1" required><button type="button" data-product-step="1" aria-label="Increase quantity">+</button></div>` : ''}<button class="button secondary" name="purchase" value="bag" ${p.stock ? '' : 'disabled'}>${p.stock ? 'Add to bag · ' + money(p.price) : 'Sold out'}</button></div>
      ${p.stock ? '<button class="button buy-now" name="purchase" value="buy">Buy now</button>' : ''}</form>
      <div class="product-details"><div class="detail-switch" role="group" aria-label="Product information"><button type="button" data-detail="description" aria-pressed="true" aria-controls="info-description">Description</button><button type="button" data-detail="shipping" aria-pressed="false" aria-controls="info-shipping">Shipping &amp; returns</button></div>
      <div class="detail-content" id="info-description">${p.description ? `<p>${esc(p.description)}</p>` : ''}${info.length ? `<dl>${info.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}</div>
      <div class="detail-content" id="info-shipping" hidden><p>Delivery and returns are set by the store.</p><a href="#/policy/shipping">Shipping policy</a><a href="#/policy/returns">Returns and exchanges</a></div></div></div></section>
      ${related.length ? `<section class="section product-listing">${sectionHead(H.D.shop.name, 'Wear it with')}${grid(related)}</section>` : ''}`;
    $$('[data-photo]').forEach((b) => b.addEventListener('click', () => { const i = Number(b.dataset.photo); const ph = $('.main-photo'); ph.src = f[i]; ph.alt = p.name + ' · ' + lab(i); $('.photo-count').textContent = (i + 1) + ' / ' + f.length; $('.gallery [aria-pressed="true"]').setAttribute('aria-pressed', 'false'); b.setAttribute('aria-pressed', 'true'); }));
    const form = $('#add-product'); refreshPurchase(p);
    $$('.sizes input[name=size]').forEach((r) => r.addEventListener('change', () => { $('#selected-size').textContent = r.value; }));
    $$('.sizes input[name=colour]').forEach((r) => r.addEventListener('change', () => { $('#selected-colour').textContent = r.value; }));
    const sg = $('.size-guide'); if (sg) sg.addEventListener('click', () => showPanel('size', p));
    $$('[data-detail]').forEach((b) => b.addEventListener('click', () => { $$('[data-detail]').forEach((o) => { const sel = o === b; o.setAttribute('aria-pressed', String(sel)); $('#' + o.getAttribute('aria-controls')).hidden = !sel; }); }));
    form.addEventListener('input', () => refreshPurchase(p));
    form.querySelectorAll('[data-product-step]').forEach((b) => b.addEventListener('click', () => { const q = form.elements.quantity; q.value = Math.max(1, Math.min(+q.max, (+q.value || 1) + Number(b.dataset.productStep))); refreshPurchase(p); }));
    form.addEventListener('submit', (e) => {
      e.preventDefault(); const fd = new FormData(form); const size = fd.get('size'); const colour = fd.get('colour');
      const q = Math.min(Number(fd.get('quantity')), remaining(p)); const v = variantFor(p, size, colour);
      if (v && Number.isInteger(q) && q > 0) {
        H.addBag(v.id, q); paintBagCount(); $('#status').textContent = p.name + ' added to bag';
        if (e.submitter && e.submitter.value === 'buy') { location.hash = '/checkout'; return; }
      }
      showPanel('bag');
    });
  }
  function refreshPurchase(p) {
    const form = $('#add-product'); const q = form && form.elements.quantity; if (!q) return;
    const avail = remaining(p); q.max = Math.max(1, avail); const n = Math.max(1, Math.min(+q.max, Math.floor(+q.value || 1)));
    if (q.value && +q.value > +q.max) q.value = n;
    form.querySelector('[data-product-step="-1"]').disabled = n <= 1; form.querySelector('[data-product-step="1"]').disabled = n >= avail; q.disabled = !avail;
    form.querySelectorAll('[name="purchase"]').forEach((b) => { b.disabled = !avail; });
    form.querySelector('[value="bag"]').textContent = avail ? 'Add to bag · ' + money(p.price * n) : 'All available units in your bag';
  }

  function bagMarkup(full) {
    const ls = lines();
    if (!ls.length) return `<div class="empty bag-empty"><p>Your bag is empty.</p><p><a class="button" href="#/shop">Browse the shop</a></p></div>`;
    const rows = ls.map((l, i) => { const p = l.s; const img = H.photos(p)[0];
      return `<div class="bag-item"><a class="bag-photo" href="#/p/${esc(p.id)}" aria-label="${esc(p.name)}">${img ? `<img src="${esc(H.thumb(img, 480))}" alt="">` : ''}</a><div class="bag-item-info"><strong>${esc(p.name)}</strong><p>${esc([l.vr.colour, l.vr.size ? 'Size ' + l.vr.size : ''].filter(Boolean).join(' · '))}</p><div class="qty"><button data-qty="${i}" data-step="-1" aria-label="Decrease quantity for ${esc(p.name)}">−</button><span>${l.q}</span><button data-qty="${i}" data-step="1" aria-label="Increase quantity for ${esc(p.name)}" ${lineLeft(l) <= 0 ? 'disabled' : ''}>+</button><button data-qty="${i}" data-step="0" aria-label="Remove ${esc(p.name)}">Remove</button></div></div><strong class="bag-line-price">${money(l.vr.price * l.q)}</strong></div>`; }).join('');
    const review = full ? '<p>Shipping and discounts appear at checkout.</p><div class="bag-actions"><a class="button secondary bag-view" href="#/bag">View cart</a><a class="button" href="#/checkout">Checkout</a></div>' : '<div class="bag-actions"><a class="button" href="#/checkout">Checkout</a></div>';
    return '<div class="bag-layout"><div class="bag-list">' + rows + '</div><div class="bag-totals"><div class="total"><span>Subtotal</span><strong>' + money(H.bagTotal()) + '</strong></div>' + review + '</div></div>';
  }

  const CHEV = '<svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function openDrawer() {
    const all = products(); const c = settings(all);
    const cats = [...new Set(all.map((p) => p.category).filter(Boolean))];
    const grp = (title, links) => `<details class="dr-grp"><summary>${esc(title)}${CHEV}</summary><div class="dr-sub">${links}</div></details>`;
    drawer.innerHTML = `<button class="dr-close" type="button" aria-label="Close menu"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button>
    <nav class="dr-nav" aria-label="Store menu"><a href="#/">Home</a><a href="#/drop">${esc(S().dropNav || 'Studio drop')}</a>
    ${grp('Shop', '<a href="#/shop">All products</a>' + cats.map((n) => `<a href="#/shop?category=${encodeURIComponent(n)}">${esc(n)}</a>`).join(''))}
    ${c.names.length ? grp('Collections', '<a href="#/collections">All collections</a>' + c.names.map((n) => `<a href="#/collection/${esc(slug(n))}">${esc(n)}</a>`).join('')) : '<a href="#/collections">Collections</a>'}
    <a href="#/contact">Customer care</a></nav>
    <a class="dr-account" href="#/me"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 21a8 8 0 0 1 16 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>My Account</a>`;
    if (!drawer.open) drawer.showModal();
  }

  function showPanel(kind, p) {
    const all = products();
    panelTitle.textContent = { menu: 'Menu', search: 'Search', bag: 'Shopping bag', size: 'Size guide', filters: 'Filters', sort: 'Sort by' }[kind];
    panelBody.innerHTML = {
      menu: '<nav class="panel-nav" aria-label="Store menu"><a href="#/drop">Studio drop</a><a href="#/shop">Shop all</a><a href="#/collections">Collections</a><a href="#/me">My account</a><a href="#/contact">Customer care</a></nav>',
      bag: kind === 'bag' ? bagMarkup(true) : '',
      filters: listPanel('filters'), sort: listPanel('sort'),
      size: p ? `<div class="size-guide-copy"><h3>${esc(p.name)}</h3><p>Size options for this product</p><ul>${p.sizes.map((s) => `<li>${esc(s)}</li>`).join('')}</ul></div>` : '',
      search: '<form class="search-form"><label>Search products<input type="search" name="q" placeholder="Try denim" required></label><button class="button">View results</button></form><div class="panel-results"></div>',
    }[kind];
    if (!panel.open) panel.showModal();
    if (kind === 'filters' || kind === 'sort') bindListPanel(kind);
    if (kind === 'search') {
      const input = panelBody.querySelector('input'); input.focus();
      input.addEventListener('input', () => { const q = input.value.trim(); const r = q ? all.filter((x) => matches(x, q)).slice(0, 5) : []; panelBody.querySelector('.panel-results').innerHTML = r.map((x) => `<a href="#/p/${esc(x.slug)}">${esc(x.name)}</a>`).join(''); });
      input.form.addEventListener('submit', (e) => { e.preventDefault(); panel.close(); location.hash = '/search?' + new URLSearchParams({ q: input.value.trim() }); });
    }
  }

  function onClick(event) {
    const t = event.target;
    if (t === drawer) { drawer.close(); return; }
    if (drawer && drawer.open && t.closest && (t.closest('.dr-close') || t.closest('.dr-nav a') || t.closest('.dr-account'))) drawer.close();
    const lst = t.closest && t.closest('[data-list]'); if (lst) { showPanel(lst.dataset.list); return; }
    const open = t.closest && t.closest('[data-panel]');
    if (open) { if (open.dataset.panel === 'menu') openDrawer(); else showPanel(open.dataset.panel); }
    if (t.closest && (t.closest('#close-panel') || (panel.open && t.closest('#panel a')))) panel.close();
    const qty = t.closest && t.closest('[data-qty]'); if (!qty) return;
    const i = Number(qty.dataset.qty), step = Number(qty.dataset.step); const l = lines()[i]; if (!l) return;
    const bag = H.bag; const row = bag.find((b) => b.v === l.v); if (!row) return;
    if (step === 0 || row.q + step <= 0) bag.splice(bag.indexOf(row), 1); else if (step < 0 || lineLeft(l) > 0) row.q += step;
    H.saveBag(); paintBagCount();
    if (panel.open) showPanel('bag'); else render(lastPath.parts, true);
  }

  // ---------- routing ----------
  const OWN = new Set(['home', 'drop', 'shop', 'search', 'collections', 'collection', 'p', 'bag']);
  function owns(id) { return OWN.has(id); }
  // Routes Studs does not draw itself (checkout, account, orders, policies) keep the Studs header and footer around the store's own content
  let framed = false, viewHome = null;
  function unframe() {
    if (!framed) return; framed = false;
    const v = document.getElementById('view');
    if (v && viewHome && v.parentNode === host) viewHome.parent.insertBefore(v, viewHome.next);
    viewHome = null;
  }
  async function frame() {
    await load(); mount(); host.hidden = false; document.body.classList.add('studs-on');
    stopCampaigns(); stopCampaigns = () => {};
    host.dataset.palette = 'light'; if (panel.open) panel.close();
    const v = document.getElementById('view');
    if (v && v.parentNode !== host) { viewHome = { parent: v.parentNode, next: v.nextSibling }; host.append(v); }
    framed = true;
    main.innerHTML = '<slot></slot>';
    $$('[data-department]').forEach((a) => a.removeAttribute('aria-current'));
    paintBagCount(); lastPath = { parts: ['__frame'] };
  }
  function render(parts, again) {
    unframe();
    stopCampaigns(); stopCampaigns = () => {};
    const [page, id] = [parts[0] || '', parts[1]]; const q = new URLSearchParams((location.hash.split('?')[1]) || '');
    lastPath = { parts };
    const all = products(); const c = settings(all);
    const studio = !page || page === 'home' || page === 'drop' || (page === 'p' && c.dropIds.has(id));
    host.dataset.palette = studio ? 'dark' : 'light';
    host.dataset.page = !page || page === 'home' ? 'home' : page;
    const dep = { drop: 'studio', shop: 'shop', collections: 'collections', collection: 'collections' }[page || 'drop'];
    $$('[data-department]').forEach((a) => { if (a.dataset.department === dep) a.setAttribute('aria-current', ['drop', 'shop', 'collections'].includes(page) ? 'page' : 'true'); else a.removeAttribute('aria-current'); });
    if (panel.open && !again) panel.close();
    if (drawer && drawer.open) drawer.close();
    { const key = !page || page === 'home' ? '@home' : page === 'drop' ? '@drop' : page === 'shop' ? (q.get('category') || '@all') : '';
      $$('[data-cat]').forEach((a) => { if (a.dataset.cat === key) { a.setAttribute('aria-current', 'page'); if (a.scrollIntoView) a.scrollIntoView({ inline: 'center', block: 'nearest' }); } else a.removeAttribute('aria-current'); }); }
    if (!page || page === 'home') main.innerHTML = home(all, c);
    else if (page === 'drop') listing(c.drop, c.dropTitle === 'New in' ? 'Studio drop' : c.dropTitle, '', true, c);
    else if (page === 'shop') { const cat = q.get('category') || ''; const sel = all.some((p) => p.category === cat) ? cat : ''; listing(sel ? all.filter((p) => p.category === sel) : all, sel || 'Shop all', '', false, c, sel ? ((S().categoryNotes || {})[sel] || (sel + ' from ' + H.D.shop.name + ' is picked to be worn on repeat. Every piece is made to move with your everyday rotation. Browse the full range below.')) : ''); }
    else if (page === 'search') { const term = (q.get('q') || '').trim(); listing(all, term ? 'Search for “' + term + '”' : 'All products', term, true, c); }
    else if (page === 'collections') {
      const names = c.names; contentPage('Collections', names.length ? '<div class="collections">' + names.map((n) => { const img = safeUrl(c.colImg[n]) || (all.find((p) => p.collection === n) || { files: [] }).files[0] || ''; return `<a class="collection" href="#/collection/${esc(slug(n))}">${img ? `<img loading="lazy" src="${esc(img)}" alt="">` : ''}<strong>${esc(n)}</strong></a>`; }).join('') + '</div>' : '<p class="copy">No collections yet.</p>');
    }
    else if (page === 'collection') { const n = c.names.find((x) => slug(x) === id); if (n) listing(all.filter((p) => p.collection === n), n, '', true, c); else contentPage('Collection not found', '<a href="#/collections">All collections <svg class="arr" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M7 17 17 7M8.5 7H17v8.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></a>'); }
    else if (page === 'p' && bySlug(all, id)) detail(bySlug(all, id), all, c);
    else if (page === 'p') contentPage('Product not found', '<a href="#/shop">Continue shopping <svg class="arr" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true"><path d="M7 17 17 7M8.5 7H17v8.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg></a>');
    else if (page === 'bag') main.innerHTML = `<section class="section cart-page"><h1 class="page-title">Shopping bag</h1>${bagMarkup(true)}</section>`;
    paintBagCount();
    if (!again) window.scrollTo(0, 0);
  }

  window.StudsTheme = {
    owns,
    async show(parts) { await load(); mount(); host.hidden = false; document.body.classList.add('studs-on'); render(parts); },
    hide() { unframe(); if (host) { host.hidden = true; } document.body.classList.remove('studs-on'); },
    frame,
    // settings changed (owner preview): rebuild the whole Studs shell so the announcement bar, footer and pages all follow
    refresh() { if (host && !host.hidden && lastPath) { const parts = lastPath.parts, wasFramed = framed; unframe(); host.remove(); host = null; stopCampaigns(); mount(); host.hidden = false; if (wasFramed) frame(); else render(parts); } },
    ready: load,
  };
})();
