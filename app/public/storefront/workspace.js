// Owner hub pages: Home, Products/Collections (catalog), Orders, Online store (theme/domains/payments),
// Business profile. Adapted from Codex's ecosystem-preview/workspace.js -- its page layout, CSS classes
// (panel/head/tabs/record-layout/...) and table helpers are kept so the visual design matches exactly what
// was approved; every section wired to the real backend below replaces its old "mutate `state` then
// localStorage.save()" logic with a real RPC call (api.js, db/372) and a refetch. Every section that is
// explicitly out of phase 1 (drafts, abandoned checkouts, returns, shipping, inventory locations/transfers,
// customers/segments/companies, growth/discounts, content pages/files/custom data, markets, staff & roles,
// most of Settings) is NOT wired to anything fake: it shows a clearly labeled "Coming soon" panel instead
// of a form that would quietly save nowhere.
import { analyticsPage } from './analytics.js';
import { domainPage, domainDispatch } from './domains.js';
import { templates } from './data.js';
import { $, badge, button, close, dialog, esc, flash, image, link, money, pathFor, rerender, save, state, uid } from './ecosystem.js';
import { api, apiPost, applyContext, refreshCollections, refreshCategories, refreshCustomers, refreshDiscounts, refreshDomains, refreshInventory, refreshLocations, refreshOrders, refreshProducts, toCollection, toOrder, toProduct } from './api.js';

const table = (heading, rows) => '<div class="table-scroll"><table><thead><tr>' + heading.map((x) => '<th scope="col">' + x + '</th>').join('') + '</tr></thead><tbody>' + (rows.length ? rows.map((x) => '<tr>' + x.map((y) => '<td>' + y + '</td>').join('') + '</tr>').join('') : '<tr><td colspan="' + heading.length + '"><p class="empty">No records yet.</p></td></tr>') + '</tbody></table></div>';
const panel = (title, body, actions = '') => '<section class="panel">' + (title ? '<div class="panel-title"><h2>' + title + '</h2>' + actions + '</div>' : '') + body + '</section>';
const body = (value) => '<div class="panel-body">' + value + '</div>';
const head = (title, description, actions = '', parent = '') => '<div class="page-head"><div>' + (parent ? '<a class="trail" href="' + pathFor(parent[0]) + '">' + parent[1] + '</a>' : '') + '<h1>' + title + '</h1><p>' + description + '</p></div><div class="actions">' + actions + '</div></div>';
const wl = (label, id, kind = '') => link(label, pathFor(id), kind);
const tabs = (active, items) => '<nav class="tabs" aria-label="Page tabs">' + items.map(([id, name]) => '<a ' + (id === active ? 'aria-current="page" ' : '') + 'href="' + pathFor(id) + '">' + name + '</a>').join('') + '</nav>';
const metric = (name, value, foot) => '<div class="metric"><span>' + name + '</span><strong>' + value + '</strong><span>' + foot + '</span></div>';
const input = (label, name, value = '', type = 'text', props = '') => '<label>' + label + '<input type="' + type + '" name="' + name + '" value="' + esc(value) + '" ' + props + '></label>';
const area = (label, name, value = '', props = '') => '<label class="wide">' + label + '<textarea name="' + name + '" ' + props + '>' + esc(value) + '</textarea></label>';
const select = (label, name, options, value, props = '') => '<label>' + label + '<select name="' + name + '" ' + props + '>' + options.map((option) => { const [id, title] = Array.isArray(option) ? option : [option, option]; return '<option value="' + esc(id) + '"' + (String(id) === String(value) ? ' selected' : '') + '>' + esc(title) + '</option>'; }).join('') + '</select></label>';
const dateValue = (value) => value ? new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value)) : '—';
const status = (value) => badge(value, ['Pending', 'Failed', 'Unfulfilled'].includes(value) ? 'warn' : value === 'Draft' || value === 'Archived' ? 'neutral' : '');
const editForm = (key, id, fields, label = 'Save') => '<form data-form="edit" data-key="' + key + '" data-id="' + esc(id || '') + '"><div class="field-grid">' + fields + '</div><div class="actions"><button class="btn primary">' + label + '</button>' + button('Cancel', 'close-dialog') + '</div></form>';
const canWrite = () => !!state.perms?.sfx_manage;
const comingSoon = (title, note, parent) => {
  const text = note || 'This part of the storefront platform is coming in a later release. Nothing on this page is saved yet.';
  return head(title, 'Coming soon.', badge('Coming soon', 'neutral'), parent) + panel(title, body('<p class="compact-copy">' + esc(text) + '</p>'));
};

// ---------- Home ----------
function home() {
  const c = state.counts;
  const pending = state.orders.filter((o) => o.status === 'Unfulfilled').length;
  const recentOrders = table(['Order', 'Date', 'Customer', 'Total', 'Payment', 'Fulfillment'], state.orders.slice(0, 6).map((o) => [link('#' + o.number, pathFor('orders/' + o.id)), dateValue(o.date), esc(o.customer || '—'), money(o.total), status(o.payment), status(o.status)]));
  return head(esc(state.business.name || 'Your store'), 'Manage your catalog, orders, and online store.', wl('Choose a theme', 'builder') + wl('Add product', 'products/new', 'primary')) +
    '<div class="metrics">' + metric('Products', c.activeProducts + ' active', c.products + ' total') + metric('To fulfil', pending, 'Unfulfilled orders') + metric('Sales', money(c.salesTotal), 'Paid orders, all time') + metric('Stock alerts', c.lowStock, 'Fewer than five available') + '</div>' +
    (state.store.published ? '' : panel('Your store is not live yet', body('<p class="compact-copy">Turn your store on from <a href="' + pathFor('website') + '">Online store</a> once you have added a product.</p>'))) +
    panel('Recent orders', recentOrders, wl('All orders', 'orders', 'compact'));
}

// ---------- Orders ----------
const orderTabs = [['orders', 'All orders'], ['drafts', 'Drafts'], ['abandoned-checkouts', 'Abandoned checkouts'], ['returns', 'Returns'], ['shipping', 'Shipping']];
function ordersList() {
  return table(['Order', 'Date', 'Customer', 'Total', 'Payment', 'Fulfillment'], state.orders.map((o) => [
    link('#' + o.number, pathFor('orders/' + o.id)), dateValue(o.date), esc(o.customer || '—'), money(o.total), status(o.payment), status(o.status),
  ]));
}
function ordersPage(id) {
  if (id !== 'orders') return comingSoon({ drafts: 'Draft orders', returns: 'Returns', shipping: 'Shipping', 'abandoned-checkouts': 'Abandoned checkouts' }[id],
    id === 'returns' ? 'Returns and exchanges are coming in a later release.' : id === 'shipping' ? 'Delivery methods and rates are coming in a later release.' :
      id === 'abandoned-checkouts' ? 'Recovering an unfinished checkout is coming in a later release.' : 'Creating a draft order by hand is coming in a later release.', ['orders', 'Orders']);
  return head('Orders', 'Orders placed on your storefront.', '') + tabs(id, orderTabs) +
    '<div class="metrics">' + metric('Orders', state.orders.length, 'All time') + metric('To fulfil', state.orders.filter((o) => o.status === 'Unfulfilled').length, '') + metric('Sales', money(state.counts.salesTotal), 'Paid orders') + '</div>' +
    panel('All orders', ordersList());
}
function orderDetail(id) {
  const o = state.orders.find((x) => x.id === id);
  if (!o) return head('Order unavailable', 'This order could not be found.', wl('All orders', 'orders'));
  const lines = table(['Item', 'Qty', 'Price'], (o.lines || []).map((l) => [esc(l.name) + (l.label && l.label !== 'Default' ? ' · ' + esc(l.label) : ''), l.qty, money(l.price)]));
  const timeline = (o.timeline || []).slice().reverse().map((e) => '<div class="launch"><div class="info"><strong>' + esc(e.label) + '</strong><small>' + new Date(e.at).toLocaleString('en-IN') + '</small></div></div>').join('');
  const actions = canWrite() && !['Fulfilled', 'Cancelled', 'Returned'].includes(o.status) ? button('Fulfil order', 'order-fulfill:' + o.id, 'primary') + button('Cancel order', 'order-cancel:' + o.id) : '';
  return head('Order #' + esc(o.number), dateValue(o.date), actions, ['orders', 'Orders']) +
    '<div class="record-layout"><div>' + panel('Items', lines) + panel('Totals', body('<div class="stack"><div class="launch"><div class="info">Total</div><strong>' + money(o.total) + '</strong></div><div class="launch"><div class="info">Payment</div>' + status(o.payment) + '</div><div class="launch"><div class="info">Fulfillment</div>' + status(o.status) + (o.tracking ? ' · ' + esc(o.tracking) : '') + '</div></div>')) +
    panel('Timeline', body('<div class="stack">' + (timeline || '<p class="empty">No activity yet.</p>') + '</div>')) +
    '</div><aside>' + panel('Customer', body('<p>' + esc(o.customer || '—') + '</p>')) + panel('Internal note', body(canWrite() ? editForm('order-note', o.id, area('Note', 'note', o.note), 'Save note') : '<p class="compact-copy">' + esc(o.note || 'No note.') + '</p>')) + '</aside></div>';
}

// ---------- Products ----------
const productTabs = [['products', 'All products'], ['collections', 'Collections'], ['inventory', 'Inventory'], ['transfers', 'Transfers'], ['categories', 'Categories and tags']];
const productLabel = (p) => '<div class="cell-product">' + image(p.image, '', 'thumb') + link(esc(p.name), 'products/' + encodeURIComponent(p.id)) + '</div>';
function productsList(query = '') {
  const items = state.products.filter((p) => !query || p.name.toLowerCase().includes(query.toLowerCase()));
  return table(['Product', 'Category', 'Status', 'Price', 'Available'], items.map((p) => [productLabel(p), esc(p.category || 'Uncategorized'), status(p.status), money(p.price), p.stock]));
}
function productsPage(id) {
  if (id === 'inventory') return inventoryPage();
  if (id === 'transfers') return transfersPage();
  if (id === 'categories') return categoriesPage();
  const title = productTabs.find(([k]) => k === id)[1];
  if (id === 'collections') {
    return head('Collections', 'Group products to feature on your storefront.', canWrite() ? wl('Create collection', 'collections/new', 'primary') : '') + tabs(id, productTabs) +
      panel('All collections', '<div class="filters"><input id="collection-query" type="search" aria-label="Search collections" placeholder="Search collections"><small id="collection-count"></small></div><div id="collection-results">' + collectionList() + '</div>');
  }
  return head(title, 'Your catalog, shared by your storefront’s theme and checkout.', canWrite() ? wl('Add product', 'products/new', 'primary') : '') + tabs(id, productTabs) +
    panel('All products', '<div class="filters"><input id="table-query" type="search" aria-label="Search products" placeholder="Search products"><small id="table-count"></small></div><div id="table-results">' + productsList() + '</div>');
}
function collectionList(query = '') {
  return table(['Collection', 'Products'], state.collections.filter((c) => !query || c.name.toLowerCase().includes(query.toLowerCase())).map((c) => [
    '<div class="cell-product">' + image(c.image, '', 'thumb') + link(esc(c.name), 'collections/' + encodeURIComponent(c.id)) + '</div>', c.productCount,
  ]));
}
function collectionDetail(id) {
  const existing = id !== 'new' ? state.collections.find((c) => c.id === id) : null;
  if (!existing && id !== 'new') return head('Collection unavailable', 'This collection could not be found.', wl('Collections', 'collections'));
  const c = existing || { name: '', description: '', image: '', products: [] };
  const members = new Set(c.products || []);
  const picker = state.products.map((p) => '<label class="inline"><input type="checkbox" name="productIds" value="' + esc(p.id) + '"' + (members.has(p.id) ? ' checked' : '') + (canWrite() ? '' : ' disabled') + '>' + esc(p.name) + '</label>').join('') || '<p class="compact-copy">Add a product first.</p>';
  const view = canWrite() ? '<form data-form="edit" data-key="collection-record" data-id="' + esc(existing?.id || '') + '"><div class="record-layout"><div>' +
    panel('Collection details', body('<div class="field-grid">' + input('Title', 'name', c.name, 'text', 'required maxlength="160"') + area('Description', 'description', c.description) + input('Cover image URL', 'image', c.image, 'url') + '</div>')) +
    panel('Products in this collection', body('<div class="stack">' + picker + '</div>')) +
    '</div><aside>' + panel('Preview', body(image(c.image, c.name, 'collection-cover') || '<p class="compact-copy">No cover image yet.</p>')) + '</aside></div>' +
    '<div class="actions"><button class="btn primary">Save collection</button>' + wl('Cancel', 'collections') + '</div></form>' :
    panel('Collection details', body('<p>' + esc(c.description || 'No description.') + '</p>'));
  const linkOut = existing && state.store.published && state.tenant?.slug ? link('View collection', 'https://' + esc(state.tenant.slug) + '.auzslab.in/store.html?view=shop&col=' + encodeURIComponent(id)) : '';
  return head(existing ? esc(c.name) : 'Create collection', 'Choose which products it shows and its cover image.', linkOut, ['collections', 'Collections']) + view;
}

// ---------- Product detail ----------
const recordTabs = [['details', 'Details'], ['media', 'Media'], ['variants', 'Variants']];
function variantEditor(variants) {
  return variants.length ? table(['Label', 'SKU', 'Price (₹)', 'Stock'], variants.map((v, i) => [
    esc(v.label) + '<input type="hidden" name="variantLabel' + i + '" value="' + esc(v.label) + '"><input type="hidden" name="variantId' + i + '" value="' + esc(v.id || '') + '">',
    input('SKU for ' + esc(v.label), 'variantSku' + i, v.sku, 'text', canWrite() ? '' : 'disabled'),
    input('Price for ' + esc(v.label), 'variantPrice' + i, v.price, 'number', 'required min="0" step="0.01" ' + (canWrite() ? '' : 'disabled')),
    input('Stock for ' + esc(v.label), 'variantStock' + i, v.stock, 'number', 'required min="0" step="1" ' + (canWrite() ? '' : 'disabled')),
  ])) : '<p class="compact-copy">This product has no variants yet. Add one below.</p>';
}
function productDetail(id) {
  const p = id !== 'new' ? state.products.find((x) => x.id === id) : null;
  if (!p && id !== 'new') return head('Product unavailable', 'This product could not be found.', wl('Back to products', 'products'));
  const r = p || { status: 'Draft', variants: [{ label: 'Default', sku: '', price: 0, stock: 0 }], media: [] };
  const candidate = new URLSearchParams(location.hash.split('?')[1] || '').get('tab');
  const tab = p && recordTabs.some(([k]) => k === candidate) ? candidate : 'details';
  const tabNav = p ? '<nav class="tabs" aria-label="Product detail">' + recordTabs.map(([k, name]) => '<a href="' + pathFor('products/' + encodeURIComponent(p.id) + '?tab=' + k) + '"' + (k === tab ? ' aria-current="page"' : '') + '>' + name + '</a>').join('') + '</nav>' : '';
  const dis = canWrite() ? '' : 'disabled';
  let view = '';
  if (tab === 'details') {
    view = '<form data-form="edit" data-key="product-record" data-id="' + esc(p?.id || '') + '" class="product-record"><div class="record-layout"><div>' +
      panel('Product information', body('<div class="field-grid">' + input('Title', 'name', r.name, 'text', 'required maxlength="160" ' + dis) + area('Description', 'description', r.description, dis) + '</div>')) +
      panel('Pricing', body('<div class="field-grid">' + input('Price in ₹', 'price', r.price ?? 0, 'number', 'min="0" step="0.01" required ' + dis) + input('Compare-at price in ₹', 'compareAt', r.compare, 'number', 'min="0" step="0.01" ' + dis) + input('Category', 'category', r.category, 'text', dis) + '</div>')) +
      '</div><aside>' + panel('Status', body('<div class="stack">' + select('Catalog status', 'status', ['Draft', 'Active', 'Archived'], r.status) + (canWrite() ? '' : '<p class="compact-copy">Only an owner or manager can change this.</p>') + '</div>')) +
      (p ? panel('Stock', body('<p>' + esc(r.stock) + ' available across ' + (r.variants || []).length + ' variant(s)</p>')) : '') + '</aside></div>' +
      '<div class="product-save actions">' + (canWrite() ? '<button class="btn primary">' + (p ? 'Save changes' : 'Create product') + '</button>' : '') + wl('Cancel', 'products') + '</div></form>';
  } else if (tab === 'media') {
    const existing = [...new Set([r.image, ...(r.media || [])].filter(Boolean))];
    const photos = existing.map((src, i) => '<div class="product-photo">' + image(src, 'Product image ' + (i + 1)) + '</div>').join('');
    view = panel('Product media', body((photos ? '<div class="media-grid">' + photos + '</div>' : '<p class="compact-copy">No images yet.</p>') +
      (canWrite() ? '<div style="margin-top:15px">' + editForm('product-media', p.id, area('Image URLs · one per line', 'media', existing.join('\n'), 'placeholder="https://..."'), 'Save images') + '</div>' : '')));
  } else if (tab === 'variants') {
    const intro = '<p class="compact-copy">Each variant has its own SKU, price, and stock. Add a row for every size/colour/edition you sell.</p>';
    const grid = variantEditor(r.variants || []);
    const editable = canWrite()
      ? '<form data-form="edit" data-key="product-variants" data-id="' + esc(p.id) + '"><div class="product-variant-grid">' + grid + '</div>' +
        '<div class="actions" style="margin-top:12px">' + button('Add a variant row', 'variant-add') + '<button class="btn primary">Save variants</button></div></form>'
      : '<div class="product-variant-grid">' + grid + '</div>';
    view = panel('Variants', body(intro + editable));
  }
  const quick = p ? panel('Summary', body('<div class="stack">' + status(r.status) + '<strong>' + money(r.price) + '</strong><small>' + esc(r.stock) + ' available</small></div>')) : '';
  const viewLink = p && r.status === 'Active' && state.store.published && state.tenant?.slug ? link('View on storefront', 'https://' + esc(state.tenant.slug) + '.auzslab.in/store.html?view=p&p=' + encodeURIComponent(p.id)) : '';
  return head(p ? esc(p.name) : 'Add product', p ? 'Manage its details, media, and variants.' : 'Create a listing for your storefront.', viewLink, ['products', 'Products']) + tabNav + '<div class="record-layout"><div>' + view + '</div><aside>' + quick + '</aside></div>';
}
// a variant row added purely client-side (no id yet) before the form is submitted
let pendingVariants = null;
function addVariantRow(formEl) {
  const rows = [...formEl.querySelectorAll('.product-variant-grid tbody tr')].length;
  const grid = formEl.querySelector('.product-variant-grid');
  grid.innerHTML = variantEditor([...collectVariants(formEl), { label: 'Option ' + (rows + 1), sku: '', price: 0, stock: 0 }]);
}
function collectVariants(formEl) {
  const data = new FormData(formEl); const out = [];
  for (let i = 0; data.has('variantLabel' + i); i++) out.push({ id: data.get('variantId' + i) || undefined, label: data.get('variantLabel' + i), sku: data.get('variantSku' + i), price: Number(data.get('variantPrice' + i)) || 0, stock: Number(data.get('variantStock' + i)) || 0 });
  return out;
}

// ---------- Online store: overview / theme / domains / payments ----------
const websiteTabs = [['website', 'Store overview'], ['builder', 'Theme'], ['store-pages', 'Pages'], ['domains', 'Domains'], ['checkout', 'Payments']];
function themePage() {
  const current = state.store.theme;
  const cards = templates.map((t) => '<article class="card"><div class="tile-img">' + image(t.image, t.name) + '</div><div class="card-body"><div class="theme-title-row"><h3>' + esc(t.name) + '</h3>' + (t.id === current ? badge('Current theme') : '') + '</div><p>' + esc(t.description) + '</p>' + (t.id === current ? '' : (canWrite() ? button('Use this theme', 'theme-use:' + t.id, 'primary') : '')) + '</div></article>').join('');
  return head('Theme', 'Choose between AUZslab’s two first-party storefront themes.', '') + tabs('builder', websiteTabs) +
    panel('First-party themes', '<div class="cards">' + cards + '</div>') +
    panel('Theme marketplace', body('<p class="compact-copy">A full visual theme editor and a marketplace of developer-built themes are coming in a later release. For now, your storefront renders with whichever first-party theme you choose above.</p>'), badge('Coming soon', 'neutral'));
}
function checkoutPage() {
  const connected = state.store.razorpayConnected;
  return head('Payments', 'Connect your own Razorpay account so customers can pay by card, UPI, or netbanking at checkout.', '') + tabs('checkout', websiteTabs) +
    panel('Razorpay', body(connected ?
      '<p class="compact-copy">Online payments are connected. Customers can also always pay cash on delivery.</p>' + (canWrite() ? button('Disconnect', 'razorpay-clear') : '') :
      '<p class="compact-copy">Not connected yet. Customers can still check out and pay cash on delivery.</p>' + (canWrite() ? editForm('razorpay', null, input('Key ID', 'keyId', '', 'text', 'required placeholder="rzp_live_..."') + input('Key Secret', 'secret', '', 'password', 'required'), 'Connect Razorpay') : ''))) +
    panel('Checkout appearance', body('<p class="compact-copy">Customizing checkout’s colours and confirmation text is coming in a later release. Checkout always uses your store’s own theme today.</p>'), badge('Coming soon', 'neutral'));
}
function websiteOverview() {
  const t = templates.find((x) => x.id === state.store.theme) || templates[0];
  const url = state.tenant?.slug ? 'https://' + state.tenant.slug + '.auzslab.in/store.html' : '';
  return head('Online store', 'Publish your storefront, pick its theme, and connect payments.', url ? link('View website', url) : '') + tabs('website', websiteTabs) +
    '<div class="cols">' +
    panel('Status', body('<div class="stack">' + (state.store.published ? badge('Live') : badge('Not published', 'warn')) + '<p class="compact-copy">' + (state.store.published ? 'Customers can open your store at ' + esc(url) + '.' : 'Turn your store on below once you’re ready for customers.') + '</p>' + (canWrite() ? editForm('store-publish', null, '<label class="inline"><input type="checkbox" name="published" ' + (state.store.published ? 'checked' : '') + '> Store is open to customers</label>', 'Save') : '') + '</div>')) +
    panel('Current theme', '<div class="tile-img">' + image(t.image, t.name) + '</div>' + body('<h3>' + esc(t.name) + '</h3><p>' + esc(t.description) + '</p>' + wl('Change theme', 'builder', 'compact'))) +
    '</div>';
}
function websitePage(id) {
  if (id === 'website') return websiteOverview();
  if (id === 'builder' || id === 'templates') return themePage();
  if (id === 'domains') return domainPage();
  if (id === 'checkout') return checkoutPage();
  return comingSoon('Pages', 'Custom storefront pages (About, FAQs, policies) are coming in a later release. Your storefront already shows your product catalog and collections.', ['website', 'Online store']);
}

// ---------- Settings / team / apps: business profile is real, the rest is coming soon ----------
function businessSettings() {
  const b = state.business;
  return head('Business profile', 'Your store’s name and contact details, shown to customers at checkout.', '', ['settings', 'Settings']) +
    panel('Business profile', body(canWrite() ? editForm('business', null,
      input('Store name', 'brandName', b.brandName || b.name, 'text', 'required maxlength="120"') + input('Contact email', 'email', b.email, 'email') + input('Contact phone', 'phone', b.phone, 'tel'), 'Save profile') :
      '<p class="compact-copy">Only an owner or manager can edit this.</p>'));
}
function management(id) {
  if (id === 'settings') return businessSettings();
  const titles = { team: 'Staff and access', roles: 'Roles', locations: 'Locations', billing: 'Billing and renewals', security: 'Sign-in and support', notifications: 'Notifications', apps: 'Apps and plans' };
  const notes = {
    team: 'Inviting staff to your storefront account is coming in a later release. Staff who already have an AUZslab login for this business can be given access from your main AUZslab account.',
    billing: 'Billing and plan management is coming in a later release.',
    security: 'Sign-in preferences for this app are managed from your main AUZslab account.',
    notifications: 'An in-app notification feed is coming in a later release. For now, new orders are emailed to AUZslab’s own notification system.',
    apps: 'A marketplace of extra apps for your storefront is coming in a later release.',
  };
  return comingSoon(titles[id] || 'Settings', notes[id], id === 'settings' ? '' : ['settings', 'Settings']);
}

// ---------- Customers ----------
function customersPage() {
  const rows = (state.customers || []).map((c) => [
    esc(c.name), esc(c.phone || '—'), esc(c.email || '—'), c.orderCount, money(c.lifetimeSpend), dateValue(c.lastOrderAt),
    c.manual && canWrite() ? button('Edit', 'customer-edit:' + c.id, 'compact') + button('Delete', 'customer-delete:' + c.id, 'compact danger') : (canWrite() ? button('Save as customer', 'customer-adopt:' + encodeURIComponent(c.phone || ''), 'compact') : ''),
  ]);
  return head('Customers', 'People who ordered from your store, plus customers you add by hand.', canWrite() ? button('Add customer', 'customer-new', 'primary') : '') +
    panel('All customers', table(['Name', 'Phone', 'Email', 'Orders', 'Total spent', 'Last order', ''], rows));
}
function customerForm(c) {
  return editForm('customer-record', c?.id, input('Name', 'name', c?.name || '', 'text', 'required maxlength="160"') + input('Phone', 'phone', c?.phone || '', 'tel', 'maxlength="20"') +
    input('Email', 'email', c?.email || '', 'email', 'maxlength="160"') + area('Notes', 'notes', c?.notes || '', 'maxlength="2000"'));
}

// ---------- Discounts ----------
const discountValueLabel = (d) => d.kind === 'percent' ? Number(d.value) + '% off' : 'Rs ' + Number(d.value) + ' off';
function discountsPage() {
  const rows = (state.discounts || []).map((d) => [
    '<strong>' + esc(d.code) + '</strong>', discountValueLabel(d), d.minOrder != null ? money(d.minOrder) : '—', d.expiresAt ? dateValue(d.expiresAt) : 'No expiry',
    d.usedCount + (d.usageLimit ? ' / ' + d.usageLimit : ''), badge(d.status === 'active' ? 'Active' : 'Archived', d.status === 'active' ? '' : 'neutral'),
    canWrite() ? button('Edit', 'discount-edit:' + d.id, 'compact') + button(d.status === 'active' ? 'Archive' : 'Activate', 'discount-toggle:' + d.id, 'compact') : '',
  ]);
  return head('Discounts', 'Codes your customers type at checkout.', canWrite() ? button('Create discount', 'discount-new', 'primary') : '') +
    panel('All discounts', table(['Code', 'Offer', 'Minimum order', 'Expires', 'Used', 'Status', ''], rows));
}
function discountForm(d) {
  const exp = d?.expiresAt ? String(d.expiresAt).slice(0, 10) : '';
  return editForm('discount-record', d?.id, input('Code', 'code', d?.code || '', 'text', 'required maxlength="30" pattern="[A-Za-z0-9_\\-]{2,30}" style="text-transform:uppercase"') +
    select('Type', 'kind', [['percent', 'Percentage off'], ['flat', 'Flat amount off (Rs)']], d?.kind || 'percent') +
    input('Value', 'value', d?.value ?? '', 'number', 'required min="0.01" step="0.01"') +
    input('Minimum order (Rs, optional)', 'minOrder', d?.minOrder ?? '', 'number', 'min="0" step="0.01"') +
    input('Expires on (optional)', 'expiresAt', exp, 'date') + input('Usage limit (optional)', 'usageLimit', d?.usageLimit ?? '', 'number', 'min="1" step="1"'));
}

// ---------- Inventory, Transfers, Categories ----------
const moveLabel = (m) => m.reason === 'transfer' ? 'Moved ' + m.qty + ' from ' + esc(m.from) + ' to ' + esc(m.to) : m.reason === 'cancel_return' ? 'Returned to stock (cancelled order)' : (m.delta > 0 ? 'Added ' : 'Removed ') + Math.abs(m.delta);
const movesTable = (moves) => table(['When', 'Product', 'What happened', 'Note'], moves.slice(0, 25).map((m) => [dateValue(m.at), esc(m.product + (m.variant && m.variant !== 'Default' ? ' · ' + m.variant : '')), moveLabel(m), esc(m.note || '')]));
function inventoryPage() {
  const rows = (state.inventory || []).map((v) => [
    esc(v.product), esc(v.variant), esc(v.sku || '—'), '<span class="' + (v.online <= 0 ? 'text-danger' : v.online < 5 ? 'text-warn' : '') + '">' + v.online + '</span>', v.elsewhere,
    canWrite() ? button('Adjust', 'stock-adjust:' + v.variantId, 'compact') : '',
  ]);
  return head('Inventory', 'Stock your storefront can sell right now, and stock held elsewhere.', '') + tabs('inventory', productTabs) +
    panel('Stock levels', table(['Product', 'Variant', 'SKU', 'Available online', 'Other locations', ''], rows)) +
    panel('Recent stock changes', movesTable(state.stockMoves || []));
}
function adjustForm(v) {
  return editForm('stock-adjust', v.variantId, '<p class="compact-copy wide">' + esc(v.product + (v.variant !== 'Default' ? ' · ' + v.variant : '')) + ' has <strong>' + v.online + '</strong> available online.</p>' +
    select('How', 'mode', [['add', 'Add or remove units'], ['set', 'Set the exact count']], 'add') + input('Number', 'amount', '', 'number', 'required step="1"') + input('Reason (optional)', 'note', '', 'text', 'maxlength="200"'), 'Save stock');
}
function transfersPage() {
  const locs = state.locations || [];
  const locRows = locs.map((l) => [esc(l.name), l.units, canWrite() ? button('Rename', 'location-edit:' + l.id, 'compact') + button('Delete', 'location-delete:' + l.id, 'compact danger') : '']);
  const moves = (state.stockMoves || []).filter((m) => m.reason === 'transfer');
  return head('Transfers', 'Move stock between your online store and other places you keep it.', canWrite() ? button('Add location', 'location-new', 'primary') + button('Move stock', 'transfer-new') : '') + tabs('transfers', productTabs) +
    panel('Locations', table(['Location', 'Units held', ''], locRows)) + panel('Recent transfers', movesTable(moves));
}
function transferForm() {
  const locs = state.locations || []; const places = [['online', 'Online store']].concat(locs.map((l) => [l.id, l.name]));
  const variants = (state.inventory || []).map((v) => [v.variantId, v.product + (v.variant !== 'Default' ? ' · ' + v.variant : '') + ' (online ' + v.online + ')']);
  if (!locs.length) return '<p class="compact-copy">Add a location first (for example a shop or warehouse).</p>';
  return editForm('transfer', '', select('Product', 'variant', variants, '') + select('From', 'from', places, 'online') + select('To', 'to', places, locs[0].id) + input('Units', 'qty', '', 'number', 'required min="1" step="1"') + input('Note (optional)', 'note', '', 'text', 'maxlength="200"'), 'Move stock');
}
function categoriesPage() {
  const c = state.categories || { categories: [], tags: [] };
  const catRows = c.categories.map((x) => [esc(x.name), x.count, canWrite() ? button('Rename or merge', 'category-rename:' + encodeURIComponent(x.name), 'compact') : '']);
  const tagRows = c.tags.map((x) => [esc(x.name), x.count]);
  const prodRows = state.products.map((p) => [esc(p.name), esc(p.category || '—'), esc((state.productTags[p.id] || []).join(', ') || '—'), canWrite() ? button('Edit tags', 'tags-edit:' + p.id, 'compact') : '']);
  return head('Categories and tags', 'Organise how products are grouped and found.', '') + tabs('categories', productTabs) +
    panel('Categories', table(['Category', 'Products', ''], catRows)) + panel('Tags', table(['Tag', 'Products'], tagRows)) + panel('Product tags', table(['Product', 'Category', 'Tags', ''], prodRows));
}

export function workspace(id, record) {
  if (['analytics', 'reports', 'live-view'].includes(id)) return analyticsPage(id, record);
  let html;
  if (id === 'home') html = home();
  else if (id === 'orders' && record) html = orderDetail(record);
  else if (orderTabs.some(([k]) => k === id)) html = ordersPage(id);
  else if (id === 'products' && record) html = productDetail(record);
  else if (id === 'collections' && record) html = collectionDetail(record);
  else if (productTabs.some(([k]) => k === id)) html = productsPage(id);
  else if (['website', 'templates', 'builder', 'domains', 'checkout', 'store-pages'].includes(id)) html = websitePage(id);
  else if (id === 'customers') html = customersPage();
  else if (id === 'discounts') html = discountsPage();
  else if (['segments', 'companies'].includes(id)) html = comingSoon(id === 'segments' ? 'Segments' : 'Companies', 'Coming in a later release.');
  else if (id === 'growth') html = comingSoon('Growth', 'Marketing campaign tracking is coming in a later release.');
  else if (['content', 'pages', 'files', 'data'].includes(id)) html = comingSoon('Content', 'Custom storefront pages, a media library, and custom fields are coming in a later release.');
  else if (id === 'markets') html = comingSoon('Markets', 'Selling in more than one currency or region is coming in a later release.');
  else html = management(id);
  return { html, dispatch: (type, target, event, key, detail) => dispatch(id, type, target, event, key, detail) };
}

// ---------- actions ----------
async function withBusy(fn) { try { await fn(); } catch (e) { flash(e.message); } }

async function dispatch(id, type, target, event, clickKey, clickDetail) {
  if (id === 'domains' && domainDispatch(type, target)) return;
  if ((type === 'input' || type === 'change') && ['table-query'].includes(target.id)) { $('#table-results').innerHTML = productsList(target.value); return; }
  if ((type === 'input' || type === 'change') && target.id === 'collection-query') { $('#collection-results').innerHTML = collectionList(target.value); return; }
  if (type === 'submit') {
    if (target.dataset.form !== 'edit') return;
    const values = new FormData(target); const data = Object.fromEntries(values); const key = target.dataset.key; const rid = target.dataset.id || null;
    const submitBtn = target.querySelector('button[type=submit], button.primary'); if (submitBtn) submitBtn.disabled = true;
    try {
      if (key === 'product-record') {
        if (!data.name?.trim()) { flash('Enter a product title.'); return; }
        const p = await api('sfx_product_save', { p_id: rid, p: { name: data.name, description: data.description, price: data.price, compareAt: data.compareAt, category: data.category, status: data.status.toLowerCase() } });
        await refreshProducts(); save(rid ? 'Product updated.' : 'Product created.'); close();
        if (!rid) location.hash = '/products/' + p.id; else rerender();
      } else if (key === 'product-media') {
        const media = [...new Set(String(data.media || '').split('\n').map((s) => s.trim()).filter(Boolean))];
        await api('sfx_product_save', { p_id: rid, p: { images: media, name: state.products.find((p) => p.id === rid)?.name, status: state.products.find((p) => p.id === rid)?.status?.toLowerCase() } });
        await refreshProducts(); save('Images saved.'); rerender();
      } else if (key === 'product-variants') {
        const variants = collectVariants(target);
        if (!variants.length) { flash('Add at least one variant.'); return; }
        const p = state.products.find((x) => x.id === rid);
        await api('sfx_product_save', { p_id: rid, p: { name: p.name, status: p.status.toLowerCase(), variants } });
        await refreshProducts(); save('Variants saved.'); rerender();
      } else if (key === 'collection-record') {
        if (!data.name?.trim()) { flash('Enter a collection title.'); return; }
        const c = await api('sfx_collection_save', { p_id: rid, p: { name: data.name, description: data.description, image: data.image, productIds: values.getAll('productIds') } });
        await refreshCollections(); save(rid ? 'Collection updated.' : 'Collection created.'); close();
        if (!rid) location.hash = '/collections/' + c.id; else rerender();
      } else if (key === 'order-fulfill') {
        await api('sfx_order_set_status', { p_id: rid, p_status: 'fulfilled', p_tracking: data.tracking || null });
        await refreshOrders(); save('Order fulfilled.'); close(); rerender();
      } else if (key === 'order-note') {
        await api('sfx_order_note', { p_id: rid, p_note: data.note }); await refreshOrders(); save('Note saved.'); rerender();
      } else if (key === 'business') {
        await api('sfx_store_save', { p: { brandName: data.brandName, email: data.email, phone: data.phone } });
        const ctx = await api('sfx_context'); applyContext(ctx); save('Profile saved.'); rerender();
      } else if (key === 'store-publish') {
        await api('sfx_store_save', { p: { published: values.has('published') } });
        const ctx = await api('sfx_context'); applyContext(ctx); save('Saved.'); rerender();
      } else if (key === 'customer-record') {
        await api('sfx_customer_save', { p_id: rid, p: { name: data.name, phone: data.phone, email: data.email, notes: data.notes } });
        await refreshCustomers(); save(rid ? 'Customer updated.' : 'Customer added.'); close(); rerender(true);
      } else if (key === 'discount-record') {
        const expiresAt = data.expiresAt ? new Date(data.expiresAt + 'T23:59:59').toISOString() : '';
        await api('sfx_discount_save', { p_id: rid, p: { code: data.code, kind: data.kind, value: data.value, minOrder: data.minOrder, expiresAt, usageLimit: data.usageLimit } });
        await refreshDiscounts(); save(rid ? 'Discount updated.' : 'Discount created.'); close(); rerender(true);
      } else if (key === 'stock-adjust') {
        const n = Number(data.amount); if (!Number.isInteger(n)) { flash('Enter a whole number.'); return; }
        await api('sfx_stock_adjust', data.mode === 'set' ? { p_variant: rid, p_delta: 0, p_set: n, p_note: data.note } : { p_variant: rid, p_delta: n, p_note: data.note });
        await refreshInventory(); save('Stock updated.'); close(); rerender(true);
      } else if (key === 'location-record') {
        await api('sfx_location_save', { p_id: rid, p_name: data.name }); await refreshLocations(); save('Location saved.'); close(); rerender(true);
      } else if (key === 'transfer') {
        await api('sfx_transfer', { p_variant: data.variant, p_from: data.from, p_to: data.to, p_qty: Number(data.qty), p_note: data.note });
        await refreshLocations(); save('Stock moved.'); close(); rerender(true);
      } else if (key === 'category-rename') {
        await api('sfx_category_rename', { p_old: rid, p_new: data.name }); await Promise.all([refreshCategories(), refreshProducts()]); save('Category updated.'); close(); rerender(true);
      } else if (key === 'tags-record') {
        await api('sfx_product_set_tags', { p_id: rid, p_tags: data.tags }); await refreshCategories(); save('Tags saved.'); close(); rerender(true);
      } else if (key === 'razorpay') {
        await api('sfx_store_set_razorpay', { p: { keyId: data.keyId, secret: data.secret } });
        const ctx = await api('sfx_context'); applyContext(ctx); save('Razorpay connected.'); close(); rerender();
      } else return;
    } catch (e) { flash(e.message); }
    finally { if (submitBtn) submitBtn.disabled = false; }
    return;
  }
  if (type !== 'click') return;
  const action = target.dataset.action; if (!action) return;
  const [a, key, detail] = action.split(':');
  if (a === 'customer-new') return dialog('Add customer', customerForm(null));
  if (a === 'customer-edit') return dialog('Edit customer', customerForm(state.customers.find((c) => c.id === key)));
  if (a === 'customer-adopt') { const c = state.customers.find((x) => x.phone === decodeURIComponent(key)); return dialog('Save as customer', customerForm({ ...c, id: null })); }
  if (a === 'customer-delete') return withBusy(async () => { if (!confirm('Delete this customer record? Their past orders are not affected.')) return; await api('sfx_customer_delete', { p_id: key }); await refreshCustomers(); save('Customer deleted.'); rerender(true); });
  if (a === 'discount-new') return dialog('Create discount', discountForm(null));
  if (a === 'discount-edit') return dialog('Edit discount', discountForm(state.discounts.find((d) => d.id === key)));
  if (a === 'discount-toggle') return withBusy(async () => { const d = state.discounts.find((x) => x.id === key); await api('sfx_discount_set_status', { p_id: key, p_status: d.status === 'active' ? 'archived' : 'active' }); await refreshDiscounts(); save('Discount updated.'); rerender(true); });
  if (a === 'stock-adjust') return dialog('Adjust stock', adjustForm(state.inventory.find((v) => v.variantId === key)));
  if (a === 'location-new') return dialog('Add location', editForm('location-record', '', input('Name', 'name', '', 'text', 'required maxlength="80"')));
  if (a === 'location-edit') return dialog('Rename location', editForm('location-record', key, input('Name', 'name', state.locations.find((l) => l.id === key)?.name || '', 'text', 'required maxlength="80"')));
  if (a === 'location-delete') return withBusy(async () => { if (!confirm('Delete this location?')) return; await api('sfx_location_delete', { p_id: key }); await refreshLocations(); save('Location deleted.'); rerender(true); });
  if (a === 'transfer-new') return dialog('Move stock', transferForm());
  if (a === 'category-rename') { const name = decodeURIComponent(key); return dialog('Rename category', editForm('category-rename', name, input('New name (use an existing name to merge)', 'name', name, 'text', 'required maxlength="80"'))); }
  if (a === 'tags-edit') return dialog('Edit tags', editForm('tags-record', key, input('Tags (separated by commas)', 'tags', (state.productTags[key] || []).join(', '), 'text', 'maxlength="300"')));
  if (a === 'variant-add') { addVariantRow(target.closest('form')); return; }
  if (a === 'theme-use') return withBusy(async () => { await api('sfx_store_save', { p: { theme: key } }); const ctx = await api('sfx_context'); applyContext(ctx); save('Theme updated.'); rerender(); });
  if (a === 'razorpay-clear') return withBusy(async () => { await api('sfx_store_set_razorpay', { p: { clear: true } }); const ctx = await api('sfx_context'); applyContext(ctx); save('Razorpay disconnected.'); rerender(); });
  if (a === 'order-fulfill') {
    return dialog('Fulfil order', editForm('order-fulfill', key, input('Tracking reference (optional)', 'tracking', '', 'text', 'maxlength="100"'), 'Mark as fulfilled'));
  }
  if (a === 'order-cancel') {
    return withBusy(async () => { await api('sfx_order_set_status', { p_id: key, p_status: 'cancelled' }); await refreshOrders(); save('Order cancelled.'); rerender(); });
  }
}
