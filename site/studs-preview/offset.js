const main = document.querySelector('main');
const panel = document.querySelector('#panel');
const panelBody = document.querySelector('#panel-body');
const panelTitle = document.querySelector('#panel-title');
const stockPhoto = '/store/genx-studio/';
const money = new Intl.NumberFormat('en-IN', {style:'currency', currency:'INR', maximumFractionDigits:0});
const fmt = value => money.format(value);
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const slug = value => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const selectedDrop = ['afterimage-graphic-tee','arc-panel-jeans','kinetic-bloom-tee','quarry-work-jacket'];
const galleryLabels = ['Front view', 'Alternate angle', 'Detail'];
const policies = new Map([
  ['terms',['Terms of use','Studs is an AUZslab storefront preview. Product information and bag actions are for demonstration.']],
  ['privacy',['Privacy','The preview stores your demo bag for this browser tab. The preview does not collect customer information.']],
  ['delivery',['Shipping and delivery','This preview does not dispatch orders. The published store will display the merchant’s delivery terms.']],
  ['returns',['Returns and exchanges','Returns and exchanges apply to orders placed on a published store. The merchant sets the return terms and support channels.']]
]);
const storageKey = 'auzslab.offset.preview.bag';
const announcements = [
  {text:'The GenX Studio drop is here', href:'#/drop'},
  {text:'Explore denim, tees and layers', href:'#/shop'}
];
let announcementIndex = 0;
const announcementLink = document.querySelector('#announcement-link');
for (const button of document.querySelectorAll('[data-announcement]')) {
  button.addEventListener('click', () => {
    announcementIndex = (announcementIndex + Number(button.dataset.announcement) + announcements.length) % announcements.length;
    const message = announcements[announcementIndex];
    announcementLink.textContent = message.text;
    announcementLink.href = message.href;
  });
}
let products;
try {
  const response = await fetch('/studs-preview/catalog.json');
  if (!response.ok) throw new Error('Catalog unavailable');
  products = await response.json();
  // Show the unavailable state in the preview without changing the shared catalog.
  products = products.map(product => product.slug === 'quarry-work-jacket' ? {...product, stock:0} : product);
} catch {
  main.textContent = 'The preview catalog could not load. Reload this page to try again.';
  throw new Error('Studs preview catalog unavailable');
}
const bySlug = new Map(products.map(product => [product.slug, product]));
const drop = selectedDrop.map(id => bySlug.get(id)).filter(Boolean);
const collections = [...new Set(products.map(product => product.collection).filter(Boolean))];
const collectionMedia = {
  'Denim in Motion':'/store/studs-demo/denim-wide.jpg',
  'Offbeat Streetwear':'/store/studs-demo/tee-editorial.jpg',
  'Small Essentials':'/store/studs-demo/essentials-wide.jpg'
};
const campaigns = [
  {image:collectionMedia['Denim in Motion'], collection:'Denim in Motion'},
  {image:collectionMedia['Offbeat Streetwear'], collection:'Offbeat Streetwear'},
  {image:'/store/studs-demo/field-editorial.jpg', collection:'Field Notes'},
  {image:collectionMedia['Small Essentials'], collection:'Small Essentials'}
];
const shopLink = category => '#/shop' + (category ? '?' + new URLSearchParams({category}) : '');
let stopCampaigns = () => {};
let bag = [];
try {
  const saved = JSON.parse(sessionStorage.getItem(storageKey) || '[]');
  if (Array.isArray(saved)) {
    bag = saved.filter(line => {
      const product = bySlug.get(line.id);
      return product?.sizes.includes(line.size) && Number.isInteger(line.qty) && line.qty > 0 && line.qty <= product.stock;
    });
  }
} catch { /* The bag remains usable when browser storage is disabled. */ }

function card(product, editorial) {
  return `<article class="product-card${product.stock?'':' sold-out'}"><a href="#/product/${product.slug}"><div class="cover"><img loading="lazy" src="${stockPhoto + escape(product.files[0])}" alt="">
  ${product.stock?'':'<span class="availability">Sold out</span>'}</div><div class="info"><span class="card-name">${escape(product.name)}</span>${editorial?'':`<span class="card-price">${fmt(product.price)}</span>`}</div></a></article>`;
}

function grid(items, editorial = false) {
  return items.length ? '<div class="grid'+(editorial?' editorial-grid':'')+'">' + items.map(product => card(product, editorial)).join('') + '</div>' : '<p class="copy">No products match these choices.</p>';
}

function collectionCards(names) {
  return '<div class="collections">' + names.map(name => {
    const image = collectionMedia[name] || stockPhoto + products.find(product => product.collection === name).files[0];
    return `<a class="collection" href="#/collection/${slug(name)}"><img loading="lazy" src="${escape(image)}" alt=""><strong>${escape(name)}</strong></a>`;
  }).join('') + '</div>';
}

function sectionHead(label, title, link = '') {
  return `<div class="section-head"><div><p class="eyebrow">${label}</p><h2>${title}</h2></div>${link}</div>`;
}

function home() {
  const more = products.filter(product => !selectedDrop.includes(product.slug)).slice(0,8);
  return `<section class="hero" aria-labelledby="campaign-title"><img class="hero-image" fetchpriority="high" src="/store/studs-demo/denim-wide.jpg" alt="Two models in indigo and ecru denim on an orange set">
  <h1 id="campaign-title" class="sr-only">GenX Cloths</h1><a class="button" href="#/drop">Explore the drop <span aria-hidden="true">↗</span></a></section>
  <section class="showcase" aria-labelledby="new-in"><div class="showcase-head"><h2 id="new-in">New in</h2><a href="#/drop">View the drop <span aria-hidden="true">↗</span></a></div>${grid(drop,true)}</section>
  <figure class="home-banner manifesto-banner">
    <img src="/store/studs-demo/genx-studio-manifesto.jpg" width="2124" height="740" loading="lazy" decoding="async" alt="Three GenX models in relaxed workwear and denim on a concrete bench">
    <figcaption>Cut with room to move.<br>Made to be worn your way.</figcaption>
  </figure>
  <section class="showcase" aria-labelledby="more-genx"><div class="showcase-head"><h2 id="more-genx">More from GenX</h2><a href="#/shop">Shop all <span aria-hidden="true">↗</span></a></div>${grid(more,true)}</section>
  <a class="home-banner closing-banner" href="#/collection/denim-in-motion" aria-label="Explore Denim in Motion">
    <img src="/store/studs-demo/genx-denim-crossing.jpg" width="2172" height="724" loading="lazy" decoding="async" alt="Four pairs of wide-leg trousers and shoes in stride across concrete">
    <span>Clean lines. Timeless style.</span>
  </a>`;
}

function campaignCarousel() {
  return `<section class="campaigns" aria-label="Shop the GenX campaigns">
    <div class="campaign-track" tabindex="0" aria-label="Campaign slides">${campaigns.map(({image,collection},index)=>`
      <article class="campaign-slide"><img src="${image}" alt="" ${index ? 'loading="lazy"' : 'fetchpriority="high"'}><div class="campaign-copy"><a class="button" href="#/collection/${slug(collection)}" aria-label="Shop now: ${collection}">Shop now <span aria-hidden="true">↗</span></a><h2>${collection}</h2></div></article>`).join('')}</div>
    <div class="campaign-controls"><button type="button" data-campaign-step="-1" aria-label="Previous campaign">‹</button>
      ${campaigns.map(({collection},index)=>`<button type="button" data-campaign-slide="${index}" aria-label="Show ${collection}" aria-pressed="${index===0}"><span></span></button>`).join('')}
      <button type="button" data-campaign-step="1" aria-label="Next campaign">›</button>
      <button type="button" class="campaign-play" aria-label="Pause slideshow">Ⅱ</button></div></section>`;
}

function bindCarousel() {
  const carousel = main.querySelector('.campaigns');
  if (!carousel) return;
  const track = carousel.querySelector('.campaign-track');
  const slides = [...track.children];
  const dots = [...carousel.querySelectorAll('[data-campaign-slide]')];
  const max = () => track.scrollWidth - track.clientWidth;
  const position = index => Math.min(max(), slides[index].offsetLeft);
  const last = () => slides.findIndex((_,index) => position(index) >= max()-1);
  const active = () => {
    const end = Math.max(0,last());
    return slides.slice(0,end+1).reduce((nearest,_,index) =>
      Math.abs(track.scrollLeft-position(index)) < Math.abs(track.scrollLeft-position(nearest)) ? index : nearest,0);
  };
  function sync() {
    dots.forEach((dot,index) => {
      dot.hidden = index > last();
      dot.setAttribute('aria-pressed',String(index===active()));
    });
  }
  function go(index) {
    const end = Math.max(0,last());
    const target = (index + end + 1) % (end + 1);
    track.scrollTo({left:position(target),behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  }
  for (const button of carousel.querySelectorAll('[data-campaign-step],[data-campaign-slide]')) {
    button.addEventListener('click', () => go(button.dataset.campaignSlide === undefined ?
      active()+Number(button.dataset.campaignStep) : Number(button.dataset.campaignSlide)));
  }
  track.addEventListener('scroll',sync,{passive:true});
  const resize = new ResizeObserver(() => {
    if (track.isConnected) sync();
    else resize.disconnect();
  });
  resize.observe(track);
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const toggle = carousel.querySelector('.campaign-play');
  let playing = !motion.matches;
  function showPlayback() {
    toggle.textContent = playing ? 'Ⅱ' : '▷';
    toggle.setAttribute('aria-label',playing ? 'Pause slideshow' : 'Play slideshow');
  }
  toggle.addEventListener('click', () => {
    playing = !playing;
    showPlayback();
  });
  const timer = setInterval(() => {
    if (!playing || document.hidden || carousel.matches(':hover') || track.contains(document.activeElement)) return;
    const bounds = track.getBoundingClientRect();
    if (bounds.bottom > 0 && bounds.top < innerHeight) go(active()+1);
  }, 4200);
  stopCampaigns = () => {
    clearInterval(timer);
    resize.disconnect();
  };
  showPlayback();
  sync();
}

function listing(items, title, query = '', filters = true) {
  if (!filters) {
    main.innerHTML = (title==='Shop all' ? campaignCarousel() : '') +
      `<section class="section product-listing" aria-label="${escape(title)}"><h1 class="sr-only">${escape(title)}</h1>${grid(items)}</section>`;
    bindCarousel();
    return;
  }
  const categories = [...new Set(items.map(product => product.category))].sort();
  main.innerHTML = `<section class="section product-listing"><div class="catalogue-head"><h1 class="page-title">${escape(title)}</h1><div class="filters">
    <label>Category<select id="category"><option value="">All categories</option>${categories.map(name=>`<option>${escape(name)}</option>`).join('')}</select></label>
    <label>Sort by<select id="sort"><option value="featured">Featured</option><option value="price-up">Price low to high</option><option value="price-down">Price high to low</option></select></label>
    <span class="copy" id="results-count" aria-live="polite"></span></div></div><div id="results"></div></section>`;
  const category = main.querySelector('#category');
  const sort = main.querySelector('#sort');
  const refresh = () => {
    const matching = items.filter(product => (!category.value || product.category === category.value) && matches(product,query));
    if (sort.value !== 'featured') matching.sort((a,b) => sort.value === 'price-up' ? a.price-b.price : b.price-a.price);
    main.querySelector('#results-count').textContent = matching.length + (matching.length === 1 ? ' item' : ' items');
    main.querySelector('#results').innerHTML = grid(matching);
  };
  category.addEventListener('change', refresh);
  sort.addEventListener('change', refresh);
  refresh();
}

function detail(product) {
  const image = (index,css='') => `<img class="${css}" src="${stockPhoto + escape(product.files[index])}" alt="${escape(product.name)} · ${galleryLabels[index]}">`;
  const related = products.filter(item => item.slug !== product.slug && (item.collection === product.collection || item.category === product.category)).slice(0,4);
  main.innerHTML = `<section class="section pdp"><div class="product-media"><div class="product-photo">${image(0,'main-photo')}<span class="photo-count" aria-live="polite">1 / ${product.files.length}</span></div><div class="gallery" aria-label="Product gallery">
    ${product.files.map((file,index)=>`<button type="button" aria-label="${galleryLabels[index]}" aria-pressed="${index===0}" data-photo="${index}"><img src="${stockPhoto + escape(file)}" alt=""></button>`).join('')}</div></div>
    <div class="product-info"><a class="eyebrow product-back" href="${shopLink(product.category)}">← ${escape(product.category)}</a><div class="product-heading"><h1>${escape(product.name)}</h1><strong>${fmt(product.price)}</strong></div><p class="product-colour">Colour <strong>${escape(product.colour)}</strong></p>
    <div class="size-block"><fieldset ${product.stock?'':'disabled'}><legend>Size <span id="selected-size">${escape(product.sizes[0])}</span></legend><div class="sizes">${product.sizes.map((size,index)=>`<label><input class="sr-only" form="add-product" type="radio" name="size" value="${escape(size)}" ${index===0?'checked':''} required>${escape(size)}</label>`).join('')}</div></fieldset>
    <button class="size-guide" type="button" aria-haspopup="dialog">Size guide</button></div>
    <form id="delivery-check"><label for="delivery-pin">Check delivery</label><div class="delivery-input"><input id="delivery-pin" name="pincode" inputmode="numeric" pattern="[1-9][0-9]{5}" maxlength="6" required placeholder="Enter a 6-digit PIN code" title="Enter a valid six-digit Indian PIN code"><button type="submit" aria-label="Check delivery for this PIN code">Check</button></div><p id="delivery-result" role="status" hidden></p></form>
    <form id="add-product" data-product="${product.slug}">
    <div class="purchase-row">${product.stock?`<div class="product-quantity"><button type="button" data-product-step="-1" aria-label="Decrease quantity">−</button><input aria-label="Quantity" name="quantity" type="number" inputmode="numeric" min="1" value="1" required><button type="button" data-product-step="1" aria-label="Increase quantity">+</button></div>`:''}<button class="button secondary" name="purchase" value="bag" ${product.stock?'':'disabled'}>${product.stock?'Add to bag · '+fmt(product.price):'Sold out'}</button></div>
    ${product.stock?'<button class="button buy-now" name="purchase" value="buy">Buy now</button>':''}</form>
    <div class="product-details"><div class="detail-switch" role="group" aria-label="Product information">
      <button type="button" data-detail="description" aria-pressed="true" aria-controls="info-description">Description</button>
      <button type="button" data-detail="shipping" aria-pressed="false" aria-controls="info-shipping">Shipping &amp; returns</button>
    </div><div class="detail-content" id="info-description"><p>${escape(product.description)}</p><dl>
      <dt>Material</dt><dd>${escape(product.fabric)}</dd><dt>Colour</dt><dd>${escape(product.colour)}</dd><dt>Care</dt><dd>${escape(product.washcare)}</dd>
    </dl></div><div class="detail-content" id="info-shipping" hidden><p>Delivery estimates and returns are set by the merchant on the published store.</p>
    <a href="#/policy/delivery">Shipping policy</a><a href="#/policy/returns">Returns and exchanges</a></div></div></div></section>
    ${related.length?`<section class="section product-listing">${sectionHead('GenX Cloths','Wear it with')}${grid(related)}</section>`:''}`;
  for (const button of main.querySelectorAll('[data-photo]')) {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.photo);
      const photo = main.querySelector('.main-photo');
      photo.src = stockPhoto + product.files[index];
      photo.alt = product.name + ' · ' + galleryLabels[index];
      main.querySelector('.photo-count').textContent = (index+1)+' / '+product.files.length;
      main.querySelector('.gallery [aria-pressed="true"]').setAttribute('aria-pressed','false');
      button.setAttribute('aria-pressed','true');
    });
  }
  const purchase = main.querySelector('#add-product');
  refreshPurchase();
  for (const radio of main.querySelectorAll('.sizes input')) {
    radio.addEventListener('change', () => { main.querySelector('#selected-size').textContent = radio.value; });
  }
  main.querySelector('.size-guide').addEventListener('click', () => showPanel('size',product));
  const delivery = main.querySelector('#delivery-check');
  delivery.addEventListener('input', () => { delivery.querySelector('#delivery-result').hidden = true; });
  delivery.addEventListener('submit', event => {
    event.preventDefault();
    const result = delivery.querySelector('#delivery-result');
    result.textContent = 'Live delivery estimates are unavailable in this preview.';
    result.hidden = false;
  });
  for (const button of main.querySelectorAll('[data-detail]')) {
    button.addEventListener('click', () => {
      for (const option of main.querySelectorAll('[data-detail]')) {
        const selected = option === button;
        option.setAttribute('aria-pressed',String(selected));
        document.getElementById(option.getAttribute('aria-controls')).hidden = !selected;
      }
    });
  }
  purchase.addEventListener('input',refreshPurchase);
  for (const button of purchase.querySelectorAll('[data-product-step]')) {
    button.addEventListener('click', () => {
      const quantity = purchase.elements.quantity;
      quantity.value = Math.max(1,Math.min(+quantity.max,(+quantity.value || 1)+Number(button.dataset.productStep)));
      refreshPurchase();
    });
  }
  purchase.addEventListener('submit', event => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const size = fields.get('size');
    const quantity = Math.min(Number(fields.get('quantity')),remaining(product));
    const line = bag.find(item => item.id === product.slug && item.size === size);
    if (product.sizes.includes(size) && Number.isInteger(quantity) && quantity > 0) {
      if (line) line.qty += quantity;
      else bag.push({id:product.slug,size,qty:quantity});
      updateBag();
      document.querySelector('#status').textContent = product.name + ' added to bag';
      if (event.submitter?.value === 'buy') {
        location.hash = '/checkout';
        return;
      }
    }
    showPanel('bag');
  });
}

function remaining(product) {
  return product.stock - bag.filter(line => line.id === product.slug).reduce((sum,line)=>sum+line.qty,0);
}

function refreshPurchase() {
  const form = main.querySelector('#add-product');
  const quantity = form?.elements.quantity;
  if (!quantity) return;
  const product = bySlug.get(form.dataset.product);
  const available = Math.max(0,remaining(product));
  quantity.max = Math.max(1,available);
  const count = Math.max(1,Math.min(+quantity.max,Math.floor(+quantity.value || 1)));
  if (quantity.value && +quantity.value > +quantity.max) quantity.value = count;
  form.querySelector('[data-product-step="-1"]').disabled = count<=1;
  form.querySelector('[data-product-step="1"]').disabled = count>=available;
  quantity.disabled = !available;
  for (const button of form.querySelectorAll('[name="purchase"]')) button.disabled = !available;
  form.querySelector('[value="bag"]').textContent = available ? 'Add to bag · '+fmt(product.price*count) : 'All available units in your bag';
}

function updateBag() {
  try { sessionStorage.setItem(storageKey, JSON.stringify(bag)); } catch { /* Storage is optional. */ }
  const count = document.querySelector('#bag-count');
  count.textContent = bag.reduce((sum,line)=>sum+line.qty,0);
  count.dataset.empty = String(!bag.length);
  refreshPurchase();
}

function bagMarkup(showReviewLink = true) {
  if (!bag.length) return `<div class="empty bag-empty"><p>Your bag is empty.</p>
    <div class="bag-shortcuts"><a href="#/collection/denim-in-motion">Denim</a><a href="#/collection/offbeat-streetwear">Graphic tees</a><a href="#/collection/small-essentials">Accessories</a></div>
    <p><a class="button" href="#/shop">Browse the shop</a></p></div>`;
  let total = 0;
  const rows = bag.map((line,index) => {
    const product = bySlug.get(line.id);
    total += product.price*line.qty;
    return `<div class="bag-item"><a class="bag-photo" href="#/product/${product.slug}" aria-label="${escape(product.name)}"><img src="${stockPhoto + escape(product.files[0])}" alt=""></a>
    <div class="bag-item-info"><strong>${escape(product.name)}</strong><p>${escape(product.colour)} · Size ${escape(line.size)}</p><div class="qty">
    <button data-qty="${index}" data-step="-1" aria-label="Decrease quantity for ${escape(product.name)}">−</button><span>${line.qty}</span>
    <button data-qty="${index}" data-step="1" aria-label="Increase quantity for ${escape(product.name)}" ${remaining(product)<=0?'disabled':''}>+</button>
    <button data-qty="${index}" data-step="0" aria-label="Remove ${escape(product.name)}">Remove</button></div></div><strong class="bag-line-price">${fmt(product.price*line.qty)}</strong></div>`;
  }).join('');
  const review = showReviewLink ? '<p>Shipping and discounts appear at checkout.</p><div class="bag-actions"><a class="button secondary bag-view" href="#/bag">View cart</a><a class="button" href="#/checkout">Checkout</a></div>' : '';
  return '<div class="bag-layout"><div class="bag-list">'+rows+'</div><div class="bag-totals"><div class="total"><span>Subtotal</span><strong>'+fmt(total)+'</strong></div>'+review+'</div></div>';
}

function checkoutPage() {
  if (!bag.length) {
    contentPage('Checkout',bagMarkup(false));
    return;
  }
  main.innerHTML = `<section class="section checkout-preview"><a class="checkout-back" href="#/bag">← Back to cart</a>
    <h1 class="page-title">Checkout</h1><div class="checkout-layout">
      <section class="checkout-contact" aria-labelledby="checkout-contact-title"><h2 id="checkout-contact-title">Contact and delivery</h2>
      <p class="copy">You’re viewing a demo. Customer details and payments are disabled.</p>
      <fieldset disabled><label>Mobile number<input type="tel" placeholder="+91"></label><label>Delivery address<input placeholder="Street address"></label><label>PIN code<input inputmode="numeric" placeholder="6 digits"></label>
      <button class="button" type="button">Continue to payment</button></fieldset></section>
      <section class="checkout-summary" aria-labelledby="checkout-summary-title"><h2 id="checkout-summary-title">Order summary</h2>
      ${bagMarkup(false)}<label>Discount code<input placeholder="Enter a code" disabled></label></section>
    </div></section>`;
}

function matches(product, query) {
  return [product.name,product.category,product.colour,product.collection].join(' ').toLowerCase().includes(query.toLowerCase());
}

function showPanel(kind, product) {
  panelTitle.textContent = {menu:'Menu',search:'Search',bag:'Shopping bag',size:'Size guide'}[kind];
  panelBody.innerHTML = {
    menu:'<nav class="panel-nav" aria-label="Store menu"><a href="#/drop">Studio drop</a><a href="#/shop">Shop all</a><a href="#/collections">Collections</a><a href="#/account">My account</a><a href="#/help">Customer care</a></nav>',
    bag:kind==='bag' ? bagMarkup() : '',
    size:product ? `<div class="size-guide-copy"><h3>${escape(product.name)}</h3><p>Size options for this product</p><ul>${product.sizes.map(size=>`<li>${escape(size)}</li>`).join('')}</ul><p class="copy">Garment measurements are unavailable for this demo item.</p></div>` : '',
    search:'<form class="search-form"><label>Search products<input type="search" name="q" placeholder="Try denim" required></label><button class="button">View results</button></form><div class="panel-results"></div>'
  }[kind];
  if (!panel.open) panel.showModal();
  if (kind==='search') {
    const search = panelBody.querySelector('input');
    search.focus();
    search.addEventListener('input', () => {
      const query = search.value.trim();
      const results = query ? products.filter(product=>matches(product,query)).slice(0,5) : [];
      panelBody.querySelector('.panel-results').innerHTML = results.map(product=>`<a href="#/product/${product.slug}">${escape(product.name)}</a>`).join('');
    });
    search.form.addEventListener('submit', event => {
      event.preventDefault();
      panel.close();
      location.hash = '/search?' + new URLSearchParams({q:search.value.trim()});
    });
  }
}

function contentPage(title,content) {
  main.innerHTML = `<section class="section catalogue-head"><h1 class="page-title">${title}</h1><div class="empty">${content}</div></section>`;
}

function route() {
  stopCampaigns();
  stopCampaigns = () => {};
  const [path,query] = location.hash.slice(1).split('?');
  const [,page,id] = (path || '/').split('/');
  const studio = !page || page === 'drop' || (page === 'product' && selectedDrop.includes(id));
  document.documentElement.dataset.palette = studio ? 'dark' : 'light';
  const department = {drop:'studio',shop:'shop',collections:'collections',collection:'collections'}[page || 'drop'];
  for (const link of document.querySelectorAll('[data-department]')) {
    if (link.dataset.department === department) link.setAttribute('aria-current', ['drop','shop','collections'].includes(page) ? 'page' : 'true');
    else link.removeAttribute('aria-current');
  }
  if (panel.open) panel.close();
  if (!page) main.innerHTML = home();
  else if (page==='drop') listing(drop,'Studio drop');
  else if (page==='shop') {
    const category = new URLSearchParams(query).get('category') || '';
    const selected = products.some(product => product.category === category) ? category : '';
    listing(selected ? products.filter(product=>product.category===selected) : products,selected || 'Shop all','',false);
  }
  else if (page==='search') {
    const term = new URLSearchParams(query).get('q')?.trim() || '';
    listing(products,term ? 'Search for “'+term+'”' : 'All products',term);
  } else if (page==='collections') contentPage('Collections',collectionCards(collections));
  else if (page==='collection' && collections.some(name=>slug(name)===id)) {
    const name = collections.find(name=>slug(name)===id);
    listing(products.filter(product=>product.collection===name),name);
  } else if (page==='product' && bySlug.has(id)) detail(bySlug.get(id));
  else if (page==='bag') main.innerHTML = `<section class="section cart-page"><h1 class="page-title">Shopping bag</h1>${bagMarkup()}</section>`;
  else if (page==='checkout') checkoutPage();
  else if (page==='account') contentPage('My account','<p class="copy">Customer sign-in and order history are available when the theme is connected to an AUZslab store.</p><p><a href="#/shop">Continue shopping ↗</a></p>');
  else if (page==='help') contentPage('Customer care','<details><summary>Delivery</summary><p class="copy">The merchant sets delivery areas, prices, and timing for the published store.</p></details><details><summary>Returns and exchanges</summary><p class="copy">The published store links to the merchant’s policy and support channel.</p></details>');
  else if (page==='policy' && policies.has(id)) {
    const [title, description] = policies.get(id);
    contentPage(title,`<p class="copy">${description}</p><p><a href="#/help">Customer care ↗</a></p>`);
  }
  else contentPage('Page not found','<a href="#/">Return to the storefront ↗</a>');
  window.scrollTo(0,0);
}

document.addEventListener('click', event => {
  const open = event.target.closest('[data-panel]');
  if (open) showPanel(open.dataset.panel);
  if (event.target.closest('#close-panel') || (panel.open && event.target.closest('#panel a'))) panel.close();
  const quantity = event.target.closest('[data-qty]');
  if (!quantity) return;
  const index = Number(quantity.dataset.qty);
  const step = Number(quantity.dataset.step);
  const line = bag[index];
  if (!line) return;
  if (step===0 || line.qty+step===0) bag.splice(index,1);
  else if (step<0 || remaining(bySlug.get(line.id))>0) line.qty += step;
  updateBag();
  if (panel.open) showPanel('bag');
  else route();
});
document.querySelector('.skip').addEventListener('click', event => {
  event.preventDefault();
  main.focus();
});
window.addEventListener('hashchange', route);
const mobileFooter = matchMedia('(max-width:760px)');
function syncFooter() {
  for (const group of document.querySelectorAll('.footer-group')) group.open = !mobileFooter.matches;
}
mobileFooter.addEventListener('change',syncFooter);
syncFooter();
updateBag();
route();
