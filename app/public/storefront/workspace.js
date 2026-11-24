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
import { sb, api, apiPost, applyContext, refreshRoles, refreshCollections, refreshAbandoned, refreshCampaigns, refreshCategories, refreshCheckout, refreshCompanies, refreshCustomers, refreshDrafts, refreshReturns, refreshSegments, refreshDiscounts, refreshDomains, refreshInventory, refreshLocations, refreshOrders, refreshProducts, toCollection, toOrder, toProduct, refreshInstalls, refreshMarketplace, refreshPlan } from './api.js';

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
    (state.plan?.blocked ? panel('Your trial has ended', body('<p class="compact-copy">Your store and data are safe, but editing and selling are paused. <a href="' + pathFor('billing') + '">Reactivate your plan</a> to switch it back on.</p>')) : '') +
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
  if (id === 'drafts') return draftsPage();
  if (id === 'returns') return returnsPage();
  if (id === 'shipping') return shippingPage();
  if (id === 'abandoned-checkouts') return abandonedPage();
  return head('Orders', 'Orders placed on your storefront.', '') + tabs(id, orderTabs) +
    '<div class="metrics">' + metric('Orders', state.orders.length, 'All time') + metric('To fulfil', state.orders.filter((o) => o.status === 'Unfulfilled').length, '') + metric('Sales', money(state.counts.salesTotal), 'Paid orders') + '</div>' +
    panel('All orders', ordersList());
}
function orderDetail(id) {
  const o = state.orders.find((x) => x.id === id);
  if (!o) return head('Order unavailable', 'This order could not be found.', wl('All orders', 'orders'));
  const lines = table(['Item', 'Qty', 'Price'], (o.lines || []).map((l) => [esc(l.name) + (l.label && l.label !== 'Default' ? ' · ' + esc(l.label) : ''), l.qty, money(l.price)]));
  const timeline = (o.timeline || []).slice().reverse().map((e) => '<div class="launch"><div class="info"><strong>' + esc(e.label) + '</strong><small>' + new Date(e.at).toLocaleString('en-IN') + '</small></div></div>').join('');
  const actions = canWrite() && !['Fulfilled', 'Cancelled', 'Returned'].includes(o.status) ? button('Fulfil order', 'order-fulfill:' + o.id, 'primary') + button('Cancel order', 'order-cancel:' + o.id) : (canWrite() && o.status === 'Fulfilled' ? button('Start a return', 'return-new:' + o.id) : '');
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
  return table(canWrite() ? ['', 'Product', 'Category', 'Status', 'Price', 'Available'] : ['Product', 'Category', 'Status', 'Price', 'Available'], items.map((p) => (canWrite() ? ['<input type="checkbox" data-bulk="' + esc(p.id) + '" aria-label="Select ' + esc(p.name) + '">'] : []).concat([productLabel(p), esc(p.category || 'Uncategorized'), status(p.status), money(p.price), p.stock])));
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
  return head(title, 'Your catalog, shared by your storefront’s theme and checkout.', (canWrite() ? button('Bulk edit selected', 'bulk-open') + button('Import from AUZsStyle', 'style-import') : '') + button('Export CSV', 'products-csv') + (canWrite() ? wl('Add product', 'products/new', 'primary') : '')) + tabs(id, productTabs) +
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
  const ex = r.extra || {};
  let view = '';
  if (tab === 'details') {
    view = '<form data-form="edit" data-key="product-record" data-id="' + esc(p?.id || '') + '" class="product-record"><div class="record-layout"><div>' +
      panel('Product information', body('<div class="field-grid">' + input('Title', 'name', r.name, 'text', 'required maxlength="160" ' + dis) + area('Description', 'description', r.description, dis) + '</div>')) +
      panel('Pricing', body('<div class="field-grid">' + input('Price in ₹', 'price', r.price ?? 0, 'number', 'min="0" step="0.01" required ' + dis) + input('Compare-at price in ₹', 'compareAt', r.compare, 'number', 'min="0" step="0.01" ' + dis) + '</div>')) +
      panel('Pricing details', body('<div class="field-grid">' + input('Cost per unit in ₹', 'cost', ex.cost ?? '', 'number', 'min="0" step="0.01" ' + dis) + input('HSN or tax code', 'hsn', ex.hsn || '', 'text', 'maxlength="20" ' + dis) + '</div>')) +
      panel('Organization', body('<div class="field-grid">' + '<label>Category<input name="category2" list="cat-list" value="' + esc(r.category) + '" ' + dis + '></label><datalist id="cat-list">' + ((state.categories?.categories) || []).map((c) => '<option value="' + esc(c.name) + '">').join('') + '</datalist>' + input('Product type', 'type', ex.type || '', 'text', 'maxlength="80" ' + dis) + input('Vendor or maker', 'vendor', ex.vendor || '', 'text', 'maxlength="80" ' + dis) + input('Weight in grams', 'weight', ex.weight ?? '', 'number', 'min="0" step="0.01" ' + dis) + input('Country of origin', 'origin', ex.origin || '', 'text', 'maxlength="60" ' + dis) + '</div>')) +
      panel('Search listing', body('<div class="field-grid">' + input('Page title', 'seoTitle', ex.seoTitle || '', 'text', 'maxlength="70" ' + dis) + input('URL handle', 'handle', p ? r.handle : '', 'text', 'pattern="[a-z0-9-]+" placeholder="made-from-title" ' + dis) + area('Search description', 'seoDescription', ex.seoDescription || '', 'maxlength="160" ' + dis) + '</div>')) +
      '</div><aside>' + panel('Status', body('<div class="stack">' + select('Catalog status', 'status', ['Draft', 'Active', 'Archived'], r.status) + (canWrite() ? '' : '<p class="compact-copy">Only an owner or manager can change this.</p>') + '</div>')) +
      (p ? panel('Stock', body('<p>' + esc(r.stock) + ' available across ' + (r.variants || []).length + ' variant(s)</p>')) : '') + '</aside></div>' +
      '<div class="product-save actions">' + (canWrite() ? '<button class="btn primary">' + (p ? 'Save changes' : 'Create product') + '</button>' : '') + wl('Cancel', 'products') + '</div></form>';
  } else if (tab === 'media') {
    const existing = [...new Set([r.image, ...(r.media || [])].filter(Boolean))];
    const main = Number(ex.mainIndex || 0);
    const photos = existing.map((src, i) => '<div class="product-photo">' + image(src, 'Product image ' + (i + 1)) + (canWrite() ? '<label class="inline"><input type="radio" name="mainIndex" value="' + i + '"' + (i === (main < existing.length ? main : 0) ? ' checked' : '') + '> Main image</label><label class="inline"><input type="checkbox" name="remove" value="' + i + '"> Remove</label>' : '') + '</div>').join('');
    view = panel('Product media', body(canWrite()
      ? '<form data-form="edit" data-key="product-media" data-id="' + esc(p.id) + '">' + (photos ? '<div class="media-grid">' + photos + '</div>' : '<p class="compact-copy">No images yet. Add up to six. The main image shows on the storefront card.</p>') +
        '<input type="hidden" name="existing" value="' + esc(JSON.stringify(existing)) + '"><div class="field-grid" style="margin-top:12px">' + input('Add an image link (https://...)', 'imageUrl', '', 'url') + '</div><div class="actions"><button class="btn primary">Save images</button></div></form>'
      : (photos ? '<div class="media-grid">' + photos + '</div>' : '<p class="compact-copy">No images yet.</p>')));
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
// ---------- Theme marketplace (phase 2, db/375) ----------
// Real marketplace: built-in Minimal/Classic are now plain rows in sfx_themes (migrated in, not
// hardcoded), alongside any developer theme an admin has approved. "Install" copies the approved
// listing's content into this store's OWN install row (sfx_theme_installs) -- editing it later can
// never touch another store's copy of the same theme, or the developer's original listing.
const sectionLabel = { hero: 'Hero banner', text: 'Text block', image: 'Image', button: 'Button', announcement: 'Announcement bar', booking: 'Appointment booking' };
function themeCard(t) {
  const price = t.priceCents > 0 ? money(t.priceCents / 100) : 'Free';
  const buy = t.installed ? badge('Installed') :
    t.priceCents > 0 ? badge('Coming soon', 'neutral') :
    canWrite() ? button('Install', 'theme-install:' + t.id, 'primary') : '';
  return '<article class="card"><div class="tile-img">' + (image(t.previewImageUrl, t.name) || '<div class="tile-img placeholder"></div>') +
    '</div><div class="card-body"><div class="theme-title-row"><h3>' + esc(t.name) + '</h3>' + badge(price, t.priceCents > 0 ? '' : 'neutral') + '</div>' +
    '<p>' + esc(t.description || (t.isBuiltin ? 'AUZslab first-party theme.' : 'By ' + (t.developerName || 'a theme developer') + '.')) + '</p>' + buy + '</div></article>';
}
function installRow(i) {
  const actions = (canWrite() ? button('Customize', 'theme-customize:' + i.id) : '') +
    (canWrite() && !i.active ? button('Make active', 'theme-activate:' + i.id, 'primary') : i.active ? badge('Active on your storefront') : '');
  return '<article class="card"><div class="card-body"><div class="theme-title-row"><h3>' + esc(i.themeName) + '</h3>' + (i.published ? badge('Published') : badge('Not published yet', 'warn')) + '</div>' +
    '<p class="compact-copy">' + (i.isBuiltin ? 'First-party theme.' : 'Developer theme.') + ' Installed ' + dateValue(i.installedAt) + '.</p>' + actions + '</div></article>';
}
function themePage() {
  const owned = new Set(state.installs.map((i) => i.themeId));
  const market = state.marketplace.map((t) => ({ ...t, installed: owned.has(t.id) }));
  return head('Theme', 'Browse the theme marketplace, install a theme, and customize what you install.', '') + tabs('builder', websiteTabs) +
    panel('Your installed themes', state.installs.length ? '<div class="cards">' + state.installs.map(installRow).join('') + '</div>' : body('<p class="compact-copy">You haven’t installed a theme yet. Install one from the marketplace below.</p>')) +
    panel('Theme marketplace', '<div class="cards">' + market.map(themeCard).join('') + '</div>') +
    panel('Sell your own theme', body('<p class="compact-copy">Building and selling themes to other AUZslab stores happens in the <a href="/theme-dev.html" target="_blank" rel="noopener">theme developer portal</a>, a separate login area for developers.</p>'));
}
// ---------- Theme editor: a store's own draft for one install (section list, add/edit/remove, publish) ----------
function sectionFieldsFor(s) {
  const p = s.props || {};
  if (s.type === 'hero') return input('Heading', 'heading', p.heading) + area('Subtext', 'sub', p.sub) + input('Button text', 'cta', p.cta) + input('Button link', 'href', p.href, 'url');
  if (s.type === 'text') return input('Heading', 'heading', p.heading) + area('Body', 'body', p.body);
  if (s.type === 'image') return input('Image URL', 'url', p.url, 'url') + input('Caption', 'caption', p.caption);
  if (s.type === 'button') return input('Button text', 'text', p.text) + input('Button link', 'href', p.href, 'url');
  if (s.type === 'announcement') return input('Announcement text', 'text', p.text);
  if (s.type === 'booking') return input('Heading', 'heading', p.heading || 'Book an appointment') + area('Note', 'note', p.note) +
    '<p class="compact-copy">Shows a real booking form on your storefront -- services, dates and times come from your own catalog/settings, the same booking system the Salon console uses. If you haven’t set up services yet, this section tells visitors booking isn’t ready.</p>';
  return '';
}
function editorPage(installId) {
  const i = state.installs.find((x) => x.id === installId);
  if (!i) return head('Theme not found', 'This install could not be found.', wl('Theme', 'builder'));
  const sections = (i.draftContent?.sections) || [];
  const dirty = JSON.stringify(i.draftContent) !== JSON.stringify(i.publishedContent);
  const list = sections.length ? sections.map((s, idx) => panel(esc(sectionLabel[s.type] || s.type), '<form data-form="section" data-install="' + esc(installId) + '" data-index="' + idx + '"><div class="field-grid">' + sectionFieldsFor(s) + '</div><div class="actions"><button class="btn primary">Save section</button>' +
    (idx > 0 ? button('Move up', 'section-up:' + idx + ':' + installId) : '') + (idx < sections.length - 1 ? button('Move down', 'section-down:' + idx + ':' + installId) : '') + button('Remove', 'section-remove:' + idx + ':' + installId) + '</div></form>')).join('') :
    panel('No sections yet', body('<p class="compact-copy">Add a section below -- it shows on your storefront’s home page once published.</p>'));
  const addControls = canWrite() ? '<div class="actions" style="margin-top:12px">' + Object.entries(sectionLabel).map(([type, label]) => button('Add ' + label, 'section-add:' + type + ':' + installId)).join('') + '</div>' : '';
  return head(esc(i.themeName) + ' -- customize', 'Changes save as a draft; publish to put them live on your storefront.', (dirty ? badge('Unpublished changes', 'warn') : badge('Published')) + button('Version history', 'theme-history:' + installId) + (canWrite() ? button('Publish', 'theme-publish:' + installId, 'primary') : ''), ['builder', 'Theme']) +
    list + panel('Add a section', body(addControls));
}
async function saveDraft(installId, mutate) {
  const i = state.installs.find((x) => x.id === installId);
  if (!i) return;
  const content = { ...(i.draftContent || {}), sections: [...((i.draftContent || {}).sections || [])] };
  mutate(content);
  i.draftContent = content;
  await api('sfx_theme_customize_save', { p_install_id: installId, p_content: content });
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
  return storePagesPage();
}

// ---------- Settings / team / apps: business profile is real, the rest is coming soon ----------
function businessSettings() {
  const b = state.business;
  return head('Business profile', 'Your store’s name and contact details, shown to customers at checkout.', '', ['settings', 'Settings']) +
    panel('Business profile', body(canWrite() ? editForm('business', null,
      input('Store name', 'brandName', b.brandName || b.name, 'text', 'required maxlength="120"') + input('Contact email', 'email', b.email, 'email') + input('Contact phone', 'phone', b.phone, 'tel'), 'Save profile') :
      '<p class="compact-copy">Only an owner or manager can edit this.</p>'));
}
function billingPage() {
  const p = state.plan || {}; const ends = p.trial_ends_at ? dateValue(p.trial_ends_at) : '';
  const label = { trial: 'Free trial', active: 'Active', paused: 'Paused', cancelled: 'Cancelled' }[p.plan_status] || p.plan_status;
  const msg = p.plan_status === 'active' ? 'Your plan is active. Your store is live and you can edit everything.' :
    p.plan_status === 'trial' ? 'You are on the free trial' + (ends ? ', which ends on ' + ends : '') + '. Pay any time to keep your store going without a break.' :
    'Your trial has ended. Your store and data are safe, but editing and selling are paused until you reactivate.';
  const actions = !canWrite() ? '<p class="compact-copy">Only an owner can change the plan.</p>' : p.plan_status === 'active' ? '' :
    '<div class="actions">' + button('Pay now and ' + (p.plan_status === 'trial' ? 'keep my store going' : 'reactivate'), 'plan-pay', 'primary') + button('Ask AUZslab to reactivate me', 'plan-request') + '</div><output id="plan-feedback" role="status"></output>';
  return head('Billing and renewals', 'Your storefront plan.', badge(label, p.plan_status === 'active' ? '' : 'warn'), ['settings', 'Settings']) +
    panel('Plan', body('<p class="compact-copy">' + esc(msg) + '</p>' + actions));
}
function loadRzp() { return new Promise((ok, no) => { if (window.Razorpay) return ok(); const s = document.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.onload = ok; s.onerror = () => no(new Error('Could not load the payment window. Check your connection.')); document.head.append(s); }); }
async function payPlan(out) {
  const o = await apiPost('/payments/sfx/plan/create', {});
  await loadRzp();
  await new Promise((ok, no) => {
    const rz = new window.Razorpay({ key: o.keyId, order_id: o.orderId, amount: o.amount, currency: o.currency, name: 'AUZslab', description: o.description,
      handler: () => ok(), modal: { ondismiss: () => no(new Error('Payment was not completed.')) } });
    rz.open();
  });
  out.textContent = 'Payment received. Switching your store on…';
  for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 2000)); await refreshPlan(); if (state.plan.plan_status === 'active') { const ctx = await api('sfx_context'); applyContext(ctx); save('Your plan is active.'); return rerender(true); } }
  out.textContent = 'Payment received. Your plan will switch on within a minute; refresh this page shortly.';
}
function management(id) {
  if (id === 'roles') return rolesPage();
  if (id === 'settings') return businessSettings();
  if (id === 'billing') return billingPage();
  const adminPages = { team: ['Staff and access', 'Staff access', 'Choose who can open Admin. Staff sign-in and roles are managed here.'], notifications: ['Notifications', 'Notifications', 'Your latest alerts.'], security: ['Sign-in and support', '', 'Your details, notifications, privacy, WhatsApp, AI connectors and help.'] };
  if (adminPages[id]) return head(adminPages[id][0], adminPages[id][2], '', ['settings', 'Settings']) + '<div class="panel"><div class="panel-body" data-admin-pane="' + esc(adminPages[id][1]) + '"></div></div>';
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

// ---------- Orders: Drafts, Returns, Shipping, Abandoned checkouts ----------
const variantOptions = () => (state.inventory || []).map((v) => [v.variantId, v.product + (v.variant !== 'Default' ? ' · ' + v.variant : '') + ' (' + v.online + ' left)']);
function draftsPage() {
  const rows = (state.drafts || []).map((d) => [esc(d.customer.name || '—'), (d.lines || []).reduce((s, l) => s + l.qty, 0) + ' items', money(d.total), d.status === 'open' ? badge('Open', 'neutral') : badge('Converted'),
    d.status === 'open' && canWrite() ? button('Create order', 'draft-convert:' + d.id, 'compact primary') + button('Delete', 'draft-delete:' + d.id, 'compact danger') : '']);
  return head('Draft orders', 'Create an order by hand for a phone or in-person sale.', canWrite() ? button('Create draft', 'draft-new', 'primary') : '') + tabs('drafts', orderTabs) + panel('All drafts', table(['Customer', 'Items', 'Total', 'Status', ''], rows));
}
function draftForm() {
  const opts = [['', 'Choose a product']].concat(variantOptions());
  const slot = (i) => '<div class="field-grid wide">' + select('Product ' + (i + 1), 'v' + i, opts, '') + input('Quantity', 'q' + i, i === 0 ? '1' : '', 'number', 'min="1" step="1"') + '</div>';
  return editForm('draft-record', '', input('Customer name', 'name', '', 'text', 'required maxlength="120"') + input('Phone', 'phone', '', 'tel') + input('Address', 'address') + input('City', 'city') + input('PIN code', 'pin') +
    slot(0) + slot(1) + slot(2) + area('Note', 'note', '', 'maxlength="1000"'), 'Save draft');
}
const RETURN_NEXT = { requested: [['approved', 'Approve', 'primary'], ['rejected', 'Reject', '']], approved: [['received', 'Mark received', 'primary']], received: [['refunded', 'Refund', 'primary']] };
function returnsPage() {
  const rows = (state.returns || []).map((r) => [link('#' + esc(r.orderNumber), pathFor('returns/' + r.id), 'compact'), (r.lines || []).map((l) => l.qty + ' × ' + esc(l.name)).join(', '), esc(r.reason || '—'), money(r.value),
    badge({ requested: 'Requested', approved: 'Approved', rejected: 'Rejected', received: 'Received', refunded: 'Refunded' }[r.status], ['rejected'].includes(r.status) ? 'neutral' : ''),
    canWrite() ? (RETURN_NEXT[r.status] || []).map(([s, label, kind]) => button(label, 'return-set:' + r.id + ':' + s, 'compact ' + kind)).join('') : '']);
  return head('Returns', 'Return requests for fulfilled orders. Units go back in stock when you mark them received.', '') + tabs('returns', orderTabs) + panel('All returns', table(['Order', 'Items', 'Reason', 'Value', 'Status', ''], rows));
}
function returnForm(order) {
  const rows = (order.lines || []).map((l, i) => '<input type="hidden" name="vid' + i + '" value="' + esc(l.variantId) + '">' + input(esc(l.name) + (l.label && l.label !== 'Default' ? ' · ' + esc(l.label) : '') + ' (ordered ' + l.qty + ')', 'rq' + i, '', 'number', 'min="0" max="' + l.qty + '" step="1"')).join('');
  return editForm('return-record', order.id, rows + area('Reason', 'reason', '', 'maxlength="500"'), 'Create return');
}
function shippingPage() {
  const sh = state.checkout.shipping || {};
  return head('Shipping', 'What customers pay for delivery at checkout.', '') + tabs('shipping', orderTabs) +
    panel('Delivery charge', body(canWrite() ? editForm('checkout-settings', '', input('Delivery fee (Rs)', 'fee', sh.fee ?? 0, 'number', 'min="0" step="1"') + input('Free delivery above (Rs, 0 = never)', 'freeOver', sh.freeOver ?? 0, 'number', 'min="0" step="1"') + area('Note shown to customers', 'note', sh.note || '', 'maxlength="300"'), 'Save shipping') :
      '<p class="compact-copy">Fee Rs ' + Number(sh.fee || 0) + (Number(sh.freeOver) > 0 ? ', free above Rs ' + Number(sh.freeOver) : '') + '.</p>'));
}
function abandonedPage() {
  const rows = (state.abandoned || []).map((a) => [esc(a.name || '—'), esc(a.phone), (a.lines || []).map((l) => l.qty + ' × ' + esc(l.name)).join(', '), money(a.total), dateValue(a.updatedAt), a.recovered ? badge('Recovered') : badge('Not ordered', 'warn'),
    (a.recovered ? '' : '<a class="btn compact" target="_blank" rel="noopener" href="https://wa.me/' + esc(String(a.phone).replace(/\D/g, '')) + '?text=' + encodeURIComponent('Hi ' + (a.name || '') + ', you left items in your bag. Need any help completing your order?') + '">WhatsApp</a>') + (canWrite() ? button('Remove', 'abandoned-delete:' + a.id, 'compact danger') : '')]);
  const on = !!state.checkout.abandonCapture;
  return head('Abandoned checkouts', 'People who typed a phone number at checkout but did not order.', '') + tabs('abandoned-checkouts', orderTabs) +
    panel('Capture', body('<p class="compact-copy">' + (on ? 'On: a customer\'s phone number and bag are saved once they enter a number at checkout.' : 'Off: nothing is saved. Turn on to see unfinished checkouts. Tell customers in your privacy policy.') + '</p>' + (canWrite() ? button(on ? 'Turn off capture' : 'Turn on capture', 'abandon-toggle', on ? '' : 'primary') : ''))) +
    panel('Unfinished checkouts', table(['Name', 'Phone', 'Bag', 'Value', 'Last seen', 'Status', ''], rows));
}

// ---------- Segments, Companies, Growth ----------
function segmentsPage() {
  const rows = (state.segments || []).map((s) => [esc(s.name), [s.rule.minOrders != null ? s.rule.minOrders + '+ orders' : '', s.rule.minSpend != null ? 'spent Rs ' + s.rule.minSpend + '+' : '', s.rule.inactiveDays ? 'inactive ' + s.rule.inactiveDays + '+ days' : ''].filter(Boolean).join(', '), s.count,
    button('View', 'segment-view:' + s.id, 'compact') + (canWrite() ? button('Edit', 'segment-edit:' + s.id, 'compact') + button('Delete', 'segment-delete:' + s.id, 'compact danger') : '')]);
  return head('Segments', 'Groups of customers that match a rule, built from their orders.', canWrite() ? button('Create segment', 'segment-new', 'primary') : '') + tabs('segments', [['customers', 'Customers'], ['segments', 'Segments'], ['companies', 'Companies']]) + panel('All segments', table(['Segment', 'Rule', 'Customers', ''], rows));
}
function segmentForm(s) {
  const r = s?.rule || {};
  return editForm('segment-record', s?.id, input('Name', 'name', s?.name || '', 'text', 'required maxlength="80"') + input('At least this many orders', 'minOrders', r.minOrders ?? '', 'number', 'min="0" step="1"') +
    input('Spent at least (Rs)', 'minSpend', r.minSpend ?? '', 'number', 'min="0" step="1"') + input('No order for at least (days)', 'inactiveDays', r.inactiveDays ?? '', 'number', 'min="1" step="1"'));
}
function companiesPage() {
  const rows = (state.companies || []).map((c) => [esc(c.name), esc(c.gstin || '—'), esc(c.contact || '—'), c.customers, canWrite() ? button('Edit', 'company-edit:' + c.id, 'compact') + button('Delete', 'company-delete:' + c.id, 'compact danger') : '']);
  const cust = (state.customers || []).filter((c) => c.manual).map((c) => [esc(c.name), esc(c.phone || '—'),
    canWrite() ? '<select data-action="" data-customer="' + esc(c.id) + '" aria-label="Company for ' + esc(c.name) + '">' + '<option value="">No company</option>' + (state.companies || []).map((co) => '<option value="' + esc(co.id) + '">' + esc(co.name) + '</option>').join('') + '</select>' : '']);
  return head('Companies', 'Business customers, with their GST number.', canWrite() ? button('Add company', 'company-new', 'primary') : '') + tabs('companies', [['customers', 'Customers'], ['segments', 'Segments'], ['companies', 'Companies']]) +
    panel('All companies', table(['Company', 'GST number', 'Contact', 'Customers', ''], rows)) + panel('Link customers to a company', table(['Customer', 'Phone', 'Company'], cust));
}
function companyForm(c) {
  return editForm('company-record', c?.id, input('Company name', 'name', c?.name || '', 'text', 'required maxlength="160"') + input('GST number (optional)', 'gstin', c?.gstin || '', 'text', 'maxlength="15" style="text-transform:uppercase"') + input('Contact', 'contact', c?.contact || '', 'text', 'maxlength="160"') + area('Notes', 'notes', c?.notes || '', 'maxlength="1000"'));
}
function growthPage() {
  const totalSpend = state.campaigns.reduce((s, c) => s + Number(c.spend), 0), totalRev = state.campaigns.reduce((s, c) => s + Number(c.revenue), 0);
  const rows = state.campaigns.map((c) => [esc(c.name), esc(c.channel), esc(c.discountCode || '—'), money(c.spend), c.orders, money(c.revenue), Number(c.spend) > 0 ? (Number(c.revenue) / Number(c.spend)).toFixed(1) + '×' : '—',
    canWrite() ? button('Edit', 'campaign-edit:' + c.id, 'compact') + button('Delete', 'campaign-delete:' + c.id, 'compact danger') : '']);
  return head('Growth', 'Track which campaigns bring orders. Link a campaign to a discount code to count its orders.', canWrite() ? button('Add campaign', 'campaign-new', 'primary') : '') +
    '<div class="metrics">' + metric('Campaigns', state.campaigns.length, '') + metric('Spend', money(totalSpend), 'All campaigns') + metric('Revenue', money(totalRev), 'Paid orders using a campaign code') + '</div>' +
    panel('Campaigns', table(['Campaign', 'Channel', 'Code', 'Spend', 'Orders', 'Revenue', 'Return', ''], rows));
}
function campaignForm(c) {
  return editForm('campaign-record', c?.id, input('Name', 'name', c?.name || '', 'text', 'required maxlength="120"') +
    select('Channel', 'channel', ['instagram', 'facebook', 'whatsapp', 'email', 'google', 'influencer', 'other'], c?.channel || 'other') +
    select('Discount code (optional)', 'discountCode', [['', 'None']].concat((state.discounts || []).map((d) => [d.code, d.code])), c?.discountCode || '') + input('Money spent (Rs)', 'spend', c?.spend ?? 0, 'number', 'min="0" step="1"'));
}

// current product fields to resend on partial saves, because sfx_product_save replaces every field it is given
const keepFields = (p) => ({ name: p.name, handle: p.handle, description: p.description, category: p.category, price: p.price, compareAt: p.compare === '' ? null : p.compare, status: p.status.toLowerCase() });

// ---------- Content: Pages, Files, Custom data, Markets (stored as lists in the store's own config, db/391) ----------
const cfgList = (k) => (Array.isArray(state.store?.config?.[k]) ? state.store.config[k] : []);
async function saveList(k, list) { const ctx = await api('sfx_store_save', { p: { [k]: list } }); applyContext(ctx); }
const newId = () => 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const slugify = (v) => String(v || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
const contentTabs = [['content', 'Overview'], ['pages', 'Pages and menus'], ['files', 'Files'], ['data', 'Custom data']];
const rowActions = (kind, id) => canWrite() ? button('Edit', kind + '-edit:' + id, 'compact') + button('Delete', kind + '-delete:' + id, 'compact danger') : '';
const storeLink = (path) => state.store.published && state.tenant?.slug ? 'https://' + state.tenant.slug + '.auzslab.in/store.html#/' + path : '';

function pageForm(pg) {
  const v = pg || { status: 'Hidden' };
  return editForm('page-record', pg?.id, input('Page title', 'name', v.name || '', 'text', 'required maxlength="120"') + input('URL handle', 'slug', v.slug || '', 'text', 'pattern="[a-z0-9-]+" maxlength="60" placeholder="about-us"') +
    area('Content', 'content', v.content || '', 'rows="8" maxlength="10000"') + input('Cover image URL', 'image', v.image || '', 'url') +
    select('Visibility', 'status', ['Hidden', 'Visible', 'Scheduled'], v.status || 'Hidden') + input('Publish on (for Scheduled)', 'publishAt', v.publishAt || '', 'datetime-local') +
    input('Search title', 'seoTitle', v.seoTitle || '', 'text', 'maxlength="70"') + area('Search description', 'seoDescription', v.seoDescription || '', 'rows="2" maxlength="160"'), 'Save page');
}
function storePagesPage(bare) {
  const pages = cfgList('pages');
  const rows = pages.map((x) => [esc(x.name), esc('/' + x.slug), badge(x.status, x.status === 'Visible' ? '' : 'neutral'), x.updatedOn ? dateValue(x.updatedOn) : '—',
    (x.status === 'Visible' && storeLink('page/' + x.slug) ? link('View', storeLink('page/' + x.slug), 'compact') : '') + rowActions('page', x.id)]);
  return (bare ? '' : head('Pages', 'Pages customers see on your online store, such as About, FAQs or shipping details.', canWrite() ? button('Add page', 'page-new', 'primary') : '', ['website', 'Online store'])) +
    panel('Store pages', table(['Page', 'URL', 'Visibility', 'Updated', ''], rows) + (pages.length ? '' : '<p class="compact-copy">No pages yet. Add one and set it to Visible to publish it.</p>'));
}
function contentPage(id) {
  const pages = cfgList('pages'), files = cfgList('files'), fields = cfgList('customFields');
  if (id === 'pages') return head('Pages and menus', 'Create storefront pages. Visible pages appear on your online store.', canWrite() ? button('Add page', 'page-new', 'primary') : '') + tabs(id, contentTabs) + storePagesPage(true);
  if (id === 'files') return head('Files', 'Images and documents you reuse across pages. Paste the link of an image or file already uploaded.', canWrite() ? button('Add file', 'file-new', 'primary') : '') + tabs(id, contentTabs) +
    panel('Media library', table(['File', 'Type', 'Link', ''], files.map((f) => [esc(f.name), esc(f.type || '—'), f.url ? '<a href="' + esc(f.url) + '" target="_blank" rel="noopener">Open</a>' : '—', rowActions('file', f.id)])));
  if (id === 'data') return head('Custom data', 'Define extra details you want to keep for products, customers or orders.', canWrite() ? button('Add field', 'field-new', 'primary') : '') + tabs(id, contentTabs) +
    panel('Field definitions', table(['Name', 'Applies to', 'Value type', ''], fields.map((f) => [esc(f.name), esc(f.appliesTo), esc(f.valueType), rowActions('field', f.id)])));
  return head('Content', 'Manage the pages, files and custom data that feed your site.') + tabs('content', contentTabs) +
    '<div class="metrics">' + metric('Pages', pages.length, pages.filter((x) => x.status === 'Visible').length + ' visible') + metric('Files', files.length, 'Media library') + metric('Custom fields', fields.length, 'Definitions') + '</div>' +
    panel('Website content', body('<div class="stack">' + wl('Pages and menus', 'pages') + wl('Files', 'files') + wl('Custom data', 'data') + '</div>'));
}
function fileForm(f) { return editForm('file-record', f?.id, input('Name', 'name', f?.name || '', 'text', 'required maxlength="120"') + select('Type', 'type', ['Image', 'Document', 'Video', 'Other'], f?.type || 'Image') + input('Link (https://...)', 'url', f?.url || '', 'url', 'required')); }
function fieldForm(f) { return editForm('field-record', f?.id, input('Field name', 'name', f?.name || '', 'text', 'required maxlength="80"') + select('Applies to', 'appliesTo', ['Products', 'Customers', 'Orders', 'Collections'], f?.appliesTo || 'Products') + select('Value type', 'valueType', ['Text', 'Number', 'Yes or no', 'Date', 'List'], f?.valueType || 'Text'), 'Save field'); }
function marketForm(m) { return editForm('market-record', m?.id, input('Market name', 'name', m?.name || '', 'text', 'required maxlength="80"') + input('Region (country or area)', 'region', m?.region || 'India', 'text', 'maxlength="80"') + select('Currency', 'currency', ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'], m?.currency || 'INR') + select('Language', 'language', ['English', 'Hindi'], m?.language || 'English') + select('Status', 'status', ['Active', 'Draft'], m?.status || 'Draft'), 'Save market'); }
function marketsPage() {
  const ms = cfgList('markets');
  return head('Markets', 'Plan where your store sells and which currency and language each market shows. Checkout currently charges in your store currency.', canWrite() ? button('Add market', 'market-new', 'primary') : '') +
    panel('Markets', table(['Market', 'Region', 'Currency', 'Language', 'Status', ''], ms.map((m) => [esc(m.name), esc(m.region), esc(m.currency), esc(m.language), status(m.status), rowActions('market', m.id)])));
}
const contentRecords = { page: ['pages', pageForm, 'page'], file: ['files', fileForm, 'file'], field: ['customFields', fieldForm, 'field'], market: ['markets', marketForm, 'market'] };
async function contentAction(a, key) {
  const m = /^(page|file|field|market)-(new|edit|delete)$/.exec(a); if (!m) return false;
  const [list, form, word] = contentRecords[m[1]]; const items = cfgList(list);
  if (m[2] === 'new') { dialog('Add ' + word, form(null)); return true; }
  if (m[2] === 'edit') { dialog('Edit ' + word, form(items.find((x) => x.id === key))); return true; }
  if (!confirm('Delete this ' + word + '?')) return true;
  try { await saveList(list, items.filter((x) => x.id !== key)); save('Deleted.'); rerender(true); } catch (e) { flash(e.message); }
  return true;
}
async function contentSubmit(key, rid, data) {
  const m = /^(page|file|field|market)-record$/.exec(key); if (!m) return false;
  const list = contentRecords[m[1]][0]; const items = cfgList(list).slice(); const rec = { ...data };
  if (m[1] === 'page') { rec.slug = slugify(rec.slug || rec.name); rec.updatedOn = new Date().toISOString().slice(0, 10); if (!rec.slug) throw new Error('Enter a page title.'); if (items.some((x) => x.slug === rec.slug && x.id !== rid)) throw new Error('Another page already uses that URL handle.'); }
  if (rid) { const i = items.findIndex((x) => x.id === rid); if (i < 0) throw new Error('Not found.'); items[i] = { ...items[i], ...rec }; } else items.push({ id: newId(), ...rec });
  await saveList(list, items); save('Saved.'); close(); rerender(true); return true;
}

// ---------- Returns detail ----------
function returnDetail(id) {
  const r = (state.returns || []).find((x) => x.id === id);
  if (!r) return head('Return unavailable', 'This return could not be found.', wl('Back to returns', 'returns'));
  const o = (state.orders || []).find((x) => x.id === r.orderId);
  const steps = [['requested', 'Requested'], ['approved', 'Approved'], ['received', 'Received'], ['refunded', 'Refunded']];
  const at = r.status === 'rejected' ? -1 : steps.findIndex(([k]) => k === r.status);
  const timeline = '<ol class="timeline">' + steps.map(([k, name], i) => '<li' + (i <= at ? ' class="done"' : '') + '><strong>' + name + '</strong>' + (i === at ? ' · now' : '') + '</li>').join('') + (r.status === 'rejected' ? '<li class="done"><strong>Rejected</strong> · now</li>' : '') + '</ol>';
  const lines = table(['Item', 'Qty', 'Price', 'Value'], (r.lines || []).map((l) => [esc(l.name) + (l.label && l.label !== 'Default' ? ' · ' + esc(l.label) : ''), l.qty, money(l.price), money(l.price * l.qty)]));
  const actions = canWrite() ? (RETURN_NEXT[r.status] || []).map(([s, label, kind]) => button(label, 'return-set:' + r.id + ':' + s, kind)).join('') : '';
  return head('Return · order #' + esc(r.orderNumber), 'Created ' + dateValue(r.createdAt) + '.', actions, ['returns', 'Returns']) +
    '<div class="record-layout"><div>' + panel('Items being returned', lines) + panel('Reason', body('<p class="compact-copy">' + esc(r.reason || 'No reason given.') + '</p>')) + '</div><aside>' +
    panel('Status', body('<div class="stack">' + badge({ requested: 'Requested', approved: 'Approved', rejected: 'Rejected', received: 'Received', refunded: 'Refunded' }[r.status], r.status === 'rejected' ? 'neutral' : '') + timeline + '</div>')) +
    panel('Money', body('<p>Items worth <strong>' + money(r.value) + '</strong></p>' + (r.refundAmount != null ? '<p>Refunded <strong>' + money(r.refundAmount) + '</strong></p>' : ''))) +
    panel('Order', body('<div class="stack">' + (o ? '<span>' + esc(o.customer || '—') + '</span><span>' + money(o.total) + ' · ' + esc(o.payment) + '</span>' : '') + wl('Open order #' + esc(r.orderNumber), 'orders/' + r.orderId, 'compact') + '</div>')) + '</aside></div>';
}

// ---------- Roles ----------
const STORE_PERMS = [['sfx_view', 'View products, orders and customers'], ['sfx_manage', 'Edit products, orders, theme, payments and domains']];
function rolesPage() {
  const roles = state.roles || [], staff = (state.staffList || []).filter((p) => p.role !== 'owner');
  const roleRows = roles.map((r) => [esc(r.name), STORE_PERMS.filter(([k]) => r.permissions && r.permissions[k]).map(([, l]) => esc(l)).join('<br>') || 'No store access', canWrite() ? button('Delete', 'role-delete:' + r.id, 'compact danger') : '']);
  const opts = (p) => '<option value=""' + (!p.role_id && p.role !== 'manager' ? ' selected' : '') + '>Staff (view only)</option><option value="builtin:manager"' + (!p.role_id && p.role === 'manager' ? ' selected' : '') + '>Manager</option>' + roles.map((r) => '<option value="' + esc(r.id) + '"' + (p.role_id === r.id ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('');
  const staffRows = staff.map((p) => [esc(p.email || p.username || 'Staff'), canWrite() ? '<select data-role-assign="' + esc(p.id) + '" aria-label="Role for ' + esc(p.email || p.username) + '">' + opts(p) + '</select>' : esc(p.role)]);
  const form = canWrite() ? panel('New role', body(editForm('role-record', '', input('Role name', 'name', '', 'text', 'required maxlength="60"') + STORE_PERMS.map(([k, l]) => '<label class="inline wide"><input type="checkbox" name="' + k + '" value="1"' + (k === 'sfx_view' ? ' checked' : '') + '> ' + esc(l) + '</label>').join(''), 'Create role'))) : '';
  return head('Roles', 'Choose what each person on your team can do in the store. The owner always has full access.', '', ['team', 'Staff and access']) + tabs('roles', [['team', 'Staff'], ['roles', 'Roles'], ['locations', 'Locations']]) +
    panel('Roles', table(['Role', 'Store access', ''], roleRows)) + form + panel('Who has which role', table(['Person', 'Role'], staffRows));
}
async function roleSubmit(key, data) {
  if (key !== 'role-record') return false;
  const name = (data.name || '').trim(); if (!name) throw new Error('Enter a role name.');
  const permissions = {}; STORE_PERMS.forEach(([k]) => { if (data[k]) permissions[k] = true; });
  const { error } = await sb.from('roles').insert({ name, permissions }); if (error) throw new Error(error.message);
  await refreshRoles(); save('Role created.'); rerender(true); return true;
}
async function roleAction(a, key) {
  if (a !== 'role-delete') return false;
  if (!confirm('Delete this role? Anyone on it loses its permissions until you give them another role.')) return true;
  const { error } = await sb.rpc('delete_role', { p_role_id: key }); if (error) { flash(error.message); return true; }
  await refreshRoles(); save('Role deleted.'); rerender(true); return true;
}
async function roleAssign(select) {
  const rid = select.value, role = (state.roles || []).find((r) => r.id === rid);
  const patch = role ? { role_id: role.id, role: role.name } : { role_id: null, role: rid === 'builtin:manager' ? 'manager' : 'cashier' };
  const { error } = await sb.from('profiles').update(patch).eq('id', select.dataset.roleAssign);
  if (error) { flash(error.message); return; }
  await refreshRoles(); save('Role updated.'); rerender(true);
}

// ---------- Products: bulk edit and CSV export ----------
const bulkIds = () => [...document.querySelectorAll('input[data-bulk]:checked')].map((x) => x.dataset.bulk);
function bulkForm(count) {
  return editForm('bulk-apply', '', '<p class="compact-copy wide">Changing ' + count + ' product' + (count === 1 ? '' : 's') + '. Leave a field empty to keep it as it is.</p>' +
    select('Status', 'status', [['', 'No change'], ['active', 'Active'], ['draft', 'Draft'], ['archived', 'Archived']], '') + input('Move to category', 'category', '', 'text', 'list="cat-list" maxlength="80"') +
    '<datalist id="cat-list">' + ((state.categories?.categories) || []).map((c) => '<option value="' + esc(c.name) + '">').join('') + '</datalist>' + input('Change price by % (e.g. -10 or 5)', 'pricePct', '', 'number', 'min="-90" max="500" step="0.1"'), 'Apply to selected');
}
function downloadProductsCsv() {
  const q = (v) => '"' + String(v ?? '').replace(/^[=+\-@\t\r]/, (c) => "'" + c).replace(/"/g, '""') + '"';
  const rows = [['Name', 'Handle', 'Category', 'Status', 'Price', 'Compare-at', 'Stock', 'Variants'], ...state.products.map((p) => [p.name, p.handle, p.category, p.status, p.price, p.compare, p.stock, (p.variants || []).length])];
  const blob = new Blob(['﻿' + rows.map((r) => r.map(q).join(',')).join('\r\n')], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'products.csv'; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

export function workspace(id, record) {
  if (['analytics', 'reports', 'live-view'].includes(id)) return analyticsPage(id, record);
  let html;
  if (id === 'home') html = home();
  else if (id === 'orders' && record) html = orderDetail(record);
  else if (id === 'returns' && record) html = returnDetail(record);
  else if (orderTabs.some(([k]) => k === id)) html = ordersPage(id);
  else if (id === 'products' && record) html = productDetail(record);
  else if (id === 'collections' && record) html = collectionDetail(record);
  else if (productTabs.some(([k]) => k === id)) html = productsPage(id);
  else if (id === 'builder' && record) html = editorPage(record);
  else if (['website', 'templates', 'builder', 'domains', 'checkout', 'store-pages'].includes(id)) html = websitePage(id);
  else if (id === 'customers') html = customersPage();
  else if (id === 'discounts') html = discountsPage();
  else if (id === 'segments') html = segmentsPage();
  else if (id === 'companies') html = companiesPage();
  else if (id === 'growth') html = growthPage();
  else if (['content', 'pages', 'files', 'data'].includes(id)) html = contentPage(id);
  else if (id === 'markets') html = marketsPage();
  else html = management(id);
  return { html, dispatch: (type, target, event, key, detail) => dispatch(id, type, target, event, key, detail) };
}

// ---------- actions ----------
async function withBusy(fn) { try { await fn(); } catch (e) { flash(e.message); } }

async function dispatch(id, type, target, event, clickKey, clickDetail) {
  if (id === 'domains' && domainDispatch(type, target)) return;
  if ((type === 'input' || type === 'change') && ['table-query'].includes(target.id)) { $('#table-results').innerHTML = productsList(target.value); return; }
  if ((type === 'input' || type === 'change') && target.id === 'collection-query') { $('#collection-results').innerHTML = collectionList(target.value); return; }
  if (type === 'submit' && target.dataset.form === 'section') {
    const installId = target.dataset.install; const idx = Number(target.dataset.index);
    const fields = Object.fromEntries(new FormData(target));
    return withBusy(async () => {
      await saveDraft(installId, (content) => { content.sections[idx] = { ...content.sections[idx], props: fields }; });
      save('Section saved.'); rerender();
    });
  }
  if (type === 'submit') {
    if (target.dataset.form !== 'edit') return;
    const values = new FormData(target); const data = Object.fromEntries(values); const key = target.dataset.key; const rid = target.dataset.id || null;
    const submitBtn = target.querySelector('button[type=submit], button.primary'); if (submitBtn) submitBtn.disabled = true;
    try {
      if (key === 'product-record') {
        if (!data.name?.trim()) { flash('Enter a product title.'); return; }
        const p = await api('sfx_product_save', { p_id: rid, p: { name: data.name, description: data.description, price: data.price, compareAt: data.compareAt, category: data.category2 ?? data.category, handle: data.handle || undefined, status: data.status.toLowerCase() } });
        await api('sfx_product_extra_save', { p_id: rid || p.id, p: { cost: data.cost, hsn: data.hsn, vendor: data.vendor, type: data.type, weight: data.weight, origin: data.origin, seoTitle: data.seoTitle, seoDescription: data.seoDescription } });
        await refreshProducts(); save(rid ? 'Product updated.' : 'Product created.'); close();
        if (!rid) location.hash = '/products/' + p.id; else rerender();
      } else if (key === 'product-media') {
        const fd = new FormData(target); const had = JSON.parse(data.existing || '[]'); const drop = new Set(fd.getAll('remove').map(Number));
        let list = had.filter((_, i) => !drop.has(i)); const mainSrc = had[Number(data.mainIndex || 0)];
        if (data.imageUrl && data.imageUrl.trim()) list.push(data.imageUrl.trim());
        list = [...new Set(list)];
        if (mainSrc && list.includes(mainSrc)) list = [mainSrc, ...list.filter((x) => x !== mainSrc)];
        if (list.length > 6) { flash('Keep up to six images.'); return; }
        await api('sfx_product_save', { p_id: rid, p: { ...keepFields(state.products.find((p) => p.id === rid)), images: list } });
        await refreshProducts(); save('Images saved.'); rerender();
      } else if (key === 'product-variants') {
        const variants = collectVariants(target);
        if (!variants.length) { flash('Add at least one variant.'); return; }
        const p = state.products.find((x) => x.id === rid);
        await api('sfx_product_save', { p_id: rid, p: { ...keepFields(p), variants } });
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
      } else if (key === 'draft-record') {
        const lines = [0, 1, 2].filter((i) => data['v' + i] && Number(data['q' + i]) > 0).map((i) => ({ variantId: data['v' + i], qty: Number(data['q' + i]) }));
        await api('sfx_draft_save', { p_id: rid, p: { name: data.name, phone: data.phone, address: data.address, city: data.city, pin: data.pin, note: data.note, lines } });
        await refreshDrafts(); save('Draft saved.'); close(); rerender(true);
      } else if (key === 'return-record') {
        const order = state.orders.find((o) => o.id === rid); const lines = (order?.lines || []).map((l, i) => ({ variantId: data['vid' + i], qty: Number(data['rq' + i] || 0) })).filter((l) => l.qty > 0);
        await api('sfx_return_create', { p_order: rid, p_lines: lines, p_reason: data.reason }); await refreshReturns(); save('Return created.'); close(); location.hash = '/returns';
      } else if (key === 'return-refund') {
        await api('sfx_return_set', { p_id: rid, p_status: 'refunded', p_amount: Number(data.amount) }); await refreshReturns(); save('Refund recorded.'); close(); rerender(true);
      } else if (key === 'return-rzp-refund') {
        await apiPost('/payments/sfx/refund/start', { returnId: rid, amount: Number(data.amount) }); await refreshReturns(); save('Refund sent through Razorpay.'); close(); rerender(true);
      } else if (key === 'checkout-settings') {
        await api('sfx_checkout_settings_save', { p: { shipping: { fee: data.fee, freeOver: data.freeOver, note: data.note }, abandonCapture: state.checkout.abandonCapture } });
        await refreshCheckout(); save('Shipping saved.'); rerender(true);
      } else if (key === 'bulk-apply') {
        const ids = bulkIds(); const patch = { status: data.status || undefined, category: data.category || undefined, pricePct: data.pricePct || undefined };
        const r = await api('sfx_product_bulk', { p_ids: ids, p: patch }); await refreshProducts(); save(r.updated + ' products updated.'); close(); rerender(true);
      } else if (await roleSubmit(key, data)) {
        /* saved */
      } else if (await contentSubmit(key, rid, data)) {
        /* saved by contentSubmit */
      } else if (key === 'company-record') {
        await api('sfx_company_save', { p_id: rid, p: { name: data.name, gstin: data.gstin, contact: data.contact, notes: data.notes } }); await refreshCompanies(); save('Company saved.'); close(); rerender(true);
      } else if (key === 'segment-record') {
        await api('sfx_segment_save', { p_id: rid, p: { name: data.name, minOrders: data.minOrders, minSpend: data.minSpend, inactiveDays: data.inactiveDays } }); await refreshSegments(); save('Segment saved.'); close(); rerender(true);
      } else if (key === 'campaign-record') {
        await api('sfx_campaign_save', { p_id: rid, p: { name: data.name, channel: data.channel, discountCode: data.discountCode, spend: data.spend } }); await refreshCampaigns(); save('Campaign saved.'); close(); rerender(true);
      } else if (key === 'razorpay') {
        await api('sfx_store_set_razorpay', { p: { keyId: data.keyId, secret: data.secret } });
        const ctx = await api('sfx_context'); applyContext(ctx); save('Razorpay connected.'); close(); rerender();
      } else return;
    } catch (e) { flash(e.message); }
    finally { if (submitBtn) submitBtn.disabled = false; }
    return;
  }
  if (type === 'change' && target.dataset?.roleAssign !== undefined) { await withBusy(() => roleAssign(target)); return; }
  if (type === 'change' && target.dataset?.customer !== undefined && target.tagName === 'SELECT') {
    return withBusy(async () => { await api('sfx_customer_set_company', { p_customer: target.dataset.customer, p_company: target.value || null }); await refreshCompanies(); save('Customer linked.'); });
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
  if (a === 'draft-new') { await refreshDrafts().catch(() => {}); return dialog('Create draft order', draftForm()); }
  if (a === 'draft-convert') return withBusy(async () => { const r = await api('sfx_draft_convert', { p_id: key }); await Promise.all([refreshDrafts(), refreshOrders()]); save('Order ' + r.number + ' created.'); rerender(true); });
  if (a === 'draft-delete') return withBusy(async () => { if (!confirm('Delete this draft?')) return; await api('sfx_draft_delete', { p_id: key }); await refreshDrafts(); save('Draft deleted.'); rerender(true); });
  if (a === 'return-new') return dialog('Start a return', returnForm(state.orders.find((o) => o.id === key)));
  if (a === 'return-set') {
    if (detail === 'refunded') { const r = state.returns.find((x) => x.id === key);
      if (r.online) return dialog('Refund through Razorpay', editForm('return-rzp-refund', key, '<p class="compact-copy wide">This order was paid online. The refund goes back to the customer\'s card or UPI through your own Razorpay account. Returned items are worth ' + money(r.value) + '.</p>' + input('Amount to refund (Rs)', 'amount', r.value, 'number', 'required min="1" step="0.01"'), 'Refund through Razorpay'));
      return dialog('Record refund', editForm('return-refund', key, '<p class="compact-copy wide">Returned items are worth ' + money(r.value) + '. Refund the customer yourself (cash, UPI or your payment provider), then record it here.</p>' + input('Amount refunded (Rs)', 'amount', r.value, 'number', 'required min="0" step="0.01"'), 'Record refund')); }
    return withBusy(async () => { await api('sfx_return_set', { p_id: key, p_status: detail }); await refreshReturns(); save('Return updated.'); rerender(true); });
  }
  if (a === 'abandon-toggle') return withBusy(async () => { await api('sfx_checkout_settings_save', { p: { shipping: state.checkout.shipping, abandonCapture: !state.checkout.abandonCapture } }); await refreshCheckout(); save('Saved.'); rerender(true); });
  if (a === 'abandoned-delete') return withBusy(async () => { await api('sfx_abandoned_delete', { p_id: key }); await refreshAbandoned(); save('Removed.'); rerender(true); });
  if (a === 'segment-new') return dialog('Create segment', segmentForm(null));
  if (a === 'segment-edit') return dialog('Edit segment', segmentForm(state.segments.find((s) => s.id === key)));
  if (a === 'segment-delete') return withBusy(async () => { if (!confirm('Delete this segment?')) return; await api('sfx_segment_delete', { p_id: key }); await refreshSegments(); save('Segment deleted.'); rerender(true); });
  if (a === 'segment-view') return withBusy(async () => { const m = await api('sfx_segment_members_get', { p_id: key }); dialog('Customers in this segment', table(['Name', 'Phone', 'Orders', 'Spent'], m.map((x) => [esc(x.name || '—'), esc(x.phone), x.orders, money(x.spend)]))); });
  if (a === 'company-new') return dialog('Add company', companyForm(null));
  if (a === 'company-edit') return dialog('Edit company', companyForm(state.companies.find((c) => c.id === key)));
  if (a === 'company-delete') return withBusy(async () => { if (!confirm('Delete this company? Its customers are kept.')) return; await api('sfx_company_delete', { p_id: key }); await refreshCompanies(); save('Company deleted.'); rerender(true); });
  if (a === 'style-import') return withBusy(async () => { if (!confirm('Copy your AUZsStyle products, sizes, colours, prices and stock into this store? Existing imported products are refreshed.')) return; const r = await api('sfx_import_from_style'); await refreshProducts(); save(r.created + ' added, ' + r.updated + ' refreshed, ' + r.variants + ' variants.'); rerender(true); });
  if (a === 'bulk-open') { const n = bulkIds().length; if (!n) { flash('Tick the products you want to change first.'); return; } return dialog('Bulk edit', bulkForm(n)); }
  if (a === 'products-csv') return downloadProductsCsv();
  if (await roleAction(a, key)) return;
  if (await contentAction(a, key)) return;
  if (a === 'campaign-new') return dialog('Add campaign', campaignForm(null));
  if (a === 'campaign-edit') return dialog('Edit campaign', campaignForm(state.campaigns.find((c) => c.id === key)));
  if (a === 'campaign-delete') return withBusy(async () => { if (!confirm('Delete this campaign?')) return; await api('sfx_campaign_delete', { p_id: key }); await refreshCampaigns(); save('Campaign deleted.'); rerender(true); });
  if (a === 'plan-pay') { const out = $('#plan-feedback'); target.disabled = true; out.textContent = 'Starting payment…'; return payPlan(out).catch((e) => { out.textContent = e.message; }).finally(() => { target.disabled = false; }); }
  if (a === 'plan-request') return withBusy(async () => { await api('request_storefront_reactivation', { p_notes: null }); save('Request sent. We will get back to you.'); });
  if (a === 'variant-add') { addVariantRow(target.closest('form')); return; }
  if (a === 'theme-use') return withBusy(async () => { await api('sfx_store_save', { p: { theme: key } }); const ctx = await api('sfx_context'); applyContext(ctx); save('Theme updated.'); rerender(); });
  if (a === 'razorpay-clear') return withBusy(async () => { await api('sfx_store_set_razorpay', { p: { clear: true } }); const ctx = await api('sfx_context'); applyContext(ctx); save('Razorpay disconnected.'); rerender(); });
  if (a === 'order-fulfill') {
    return dialog('Fulfil order', editForm('order-fulfill', key, input('Tracking reference (optional)', 'tracking', '', 'text', 'maxlength="100"'), 'Mark as fulfilled'));
  }
  if (a === 'order-cancel') {
    return withBusy(async () => { await api('sfx_order_set_status', { p_id: key, p_status: 'cancelled' }); await refreshOrders(); save('Order cancelled.'); rerender(); });
  }
  if (a === 'theme-install') return withBusy(async () => {
    const r = await api('sfx_theme_install', { p_theme_id: key });
    await Promise.all([refreshMarketplace(), refreshInstalls()]);
    save(r.alreadyInstalled ? 'Already installed.' : 'Theme installed. Customize it, then publish when ready.');
    rerender();
  });
  if (a === 'theme-customize') { location.hash = '/builder/' + key; return; }
  if (a === 'theme-activate') return withBusy(async () => {
    await api('sfx_theme_install_set_active', { p_install_id: key });
    await Promise.all([refreshInstalls()]); const ctx = await api('sfx_context'); applyContext(ctx);
    save('This theme is now active on your storefront.'); rerender();
  });
  if (a === 'theme-history') return withBusy(async () => {
    const rows = await api('sfx_theme_history_list', { p_install_id: key });
    const fmt = (d) => new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(d));
    dialog('Version history', rows.length ? '<p class="compact-copy">Each time you publish, that version is kept (the last 20). Restore copies it into your draft; nothing goes live until you publish again.</p>' +
      table(['Published', 'Sections', ''], rows.map((r) => [esc(fmt(r.publishedAt)), String(r.sections), canWrite() ? button('Restore to draft', 'theme-restore:' + r.id + ':' + key) : ''])) :
      '<p class="compact-copy">No published versions yet. Publish your theme to start a history.</p>');
  });
  if (a === 'theme-restore') return withBusy(async () => {
    await api('sfx_theme_rollback', { p_install_id: detail, p_history_id: key });
    await refreshInstalls(); close(); save('Version restored to your draft. Publish to put it live.'); rerender();
  });
  if (a === 'theme-publish') return withBusy(async () => {
    await api('sfx_theme_customize_publish', { p_install_id: key });
    await refreshInstalls(); save('Published to your storefront.'); rerender();
  });
  if (a === 'section-add') return withBusy(async () => {
    await saveDraft(detail, (content) => { content.sections.push({ id: uid(), type: key, props: {} }); });
    save('Section added.'); rerender();
  });
  if (a === 'section-remove') return withBusy(async () => {
    await saveDraft(detail, (content) => { content.sections.splice(Number(key), 1); });
    save('Section removed.'); rerender();
  });
  if (a === 'section-up' || a === 'section-down') return withBusy(async () => {
    const from = Number(key); const to = from + (a === 'section-up' ? -1 : 1);
    await saveDraft(detail, (content) => { if (content.sections[to]) { const [s] = content.sections.splice(from, 1); content.sections.splice(to, 0, s); } });
    rerender();
  });
}
