// Owner hub pages: Home, Products/Collections (catalog), Orders, Online store (theme/domains/payments),
// Business profile. Adapted from Codex's ecosystem-preview/workspace.js -- its page layout, CSS classes
// (panel/head/tabs/record-layout/...) and table helpers are kept so the visual design matches exactly what
// was approved; every section wired to the real backend below replaces its old "mutate `state` then
// localStorage.save()" logic with a real RPC call (api.js, db/372) and a refetch. Every section that is
// explicitly out of phase 1 (drafts, abandoned checkouts, returns, shipping, inventory locations/transfers,
// customers/segments/companies, growth/discounts, content pages/files/custom data, markets, staff & roles,
// most of Settings) is NOT wired to anything fake: it shows a clearly labeled "Coming soon" panel instead
// of a form that would quietly save nowhere.
import { analyticsPage, visitorPanel, campaignBars } from './analytics.js';
import { domainPage, domainDispatch } from './domains.js';
import { homeOverview } from './home.js';
import { templates } from './data.js';
import { dirty, appLinks, $, badge, button, close, dialog, esc, flash, image, link, money, pathFor, rerender, save, state, uid, icon, settingsGroups, settingsRoutes } from './ecosystem.js';
import { sb, api, apiPost, applyContext, refreshLanguages, refreshStoreDir, refreshStyleLink, refreshRoles, refreshCollections, refreshMemberships, uploadImage, refreshAbandoned, refreshCampaigns, refreshCategories, refreshCheckout, refreshCompanies, refreshCustomers, refreshDrafts, refreshReturns, refreshSegments, refreshDiscounts, refreshDomains, refreshInventory, refreshLocations, refreshOrders, refreshProducts, toCollection, toOrder, toProduct, refreshInsights, refreshAccess, refreshBlog, refreshRedirects, refreshRevisions, refreshCustomFields, refreshInstalls, refreshMarketplace, refreshPlan } from './api.js';

const table = (heading, rows, emptyNote) => '<div class="table-scroll"><table><thead><tr>' + heading.map((x) => '<th scope="col">' + x + '</th>').join('') + '</tr></thead><tbody>' + (rows.length ? rows.map((x) => '<tr>' + x.map((y, i) => '<td data-label="' + esc(String(heading[i] || '')) + '">' + y + '</td>').join('') + '</tr>').join('') : '<tr><td colspan="' + heading.length + '">' + (emptyNote || '<p class="empty">No records yet.</p>') + '</td></tr>') + '</tbody></table></div>';
const filteredEmpty = (total, shown) => total > 0 && shown === 0 ? '<p class="empty">No results match your filters.</p><p><button type="button" class="btn compact" data-action="clear-filters">Clear filters</button></p>' : undefined;
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
// Home: one thin stats strip, a greeting, and a setup guide that ticks itself from real data (hidden when everything is done).
function setupSteps() {
  const b = state.business || {}, cfg = state.store?.config || {}, sh = state.checkout?.shipping || {};
  const pol = cfg.policies || {}, real = state.orders.filter((o) => !o.isTest);
  const shipped = Number(sh.fee) > 0 || (sh.tiers || []).length > 0 || (sh.zones || []).length > 0;
  return [
    ['Set up your store', [
      ['Add your store name and contact details', !!(b.name && (b.email || b.phone)), 'settings'],
      ['Add your first product', state.products.length > 0, 'products/new'],
      ['Choose and customize a theme', state.installs.length > 0, 'builder'],
    ]],
    ['Get ready to take orders', [
      ['Set up payments', !!state.store?.razorpayConnected, 'checkout'],
      ['Set up shipping rates', shipped, 'shipping'],
      ['Add store policies', Object.values(pol).some((v) => String(v || '').trim()), 'policies'],
      ['Connect a domain', (state.domains || []).some((d) => d.status === 'verified'), 'domains'],
    ]],
    ['Go live', [
      ['Publish your store', !!state.store?.published, 'website'],
      ['Place a test order', state.orders.some((o) => o.isTest), 'orders'],
      ['Get your first order', real.length > 0, 'orders'],
    ]],
  ];
}
function setupGuide() {
  const groups = setupSteps(); const all = groups.flatMap(([, steps]) => steps); const done = all.filter((x) => x[1]).length;
  if (done === all.length) return '';
  return '<section class="setup"><h2>Continue building your store</h2><p class="muted">Finish these steps to get your store up and running.</p><span class="pill setup-count">' + done + ' / ' + all.length + ' completed</span>' +
    groups.map(([title, steps]) => '<h3>' + esc(title) + '</h3><ul class="steps">' + steps.map(([label, ok, to]) => '<li><a href="' + pathFor(to) + '" class="step' + (ok ? ' done' : '') + '"><span class="mark" aria-hidden="true">' + (ok ? '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 10.5l3.2 3.2L15 6.8"/></svg>' : '') + '</span><span class="label">' + esc(label) + '</span><span class="chev" aria-hidden="true">›</span><span class="sr-only">' + (ok ? 'Done' : 'To do') + '</span></a></li>').join('') + '</ul>').join('') + '</section>';
}
function homeStrip() {
  const c = state.counts, v = state.visitors && !state.visitors.error ? state.visitors : null, lv = state.liveVisitors && !state.liveVisitors.error ? state.liveVisitors : null;
  const real = state.orders.filter((o) => !o.isTest).length;
  const conv = v && v.visitors ? (v.ordered / v.visitors * 100).toFixed(1) + '%' : '—';
  const cell = (label, value) => '<div class="hs-cell"><span>' + label + '</span><strong>' + value + '</strong></div>';
  return '<div class="home-strip" role="group" aria-label="Store activity">' + '<a class="hs-cell" href="' + pathFor('live-view') + '"><span>Live visitors</span><strong>' + (lv ? lv.now : '—') + '</strong></a>' + cell('Visitors, 14 days', v ? v.visitors : '—') + cell('Total sales', money(c.salesTotal)) + cell('Orders', real) + cell('Conversion', conv) + '</div>';
}
function siteSide() {
  const slug = state.tenant?.slug, url = slug ? 'https://' + slug + '.auzslab.in/store.html' : '';
  const lv = state.liveVisitors && !state.liveVisitors.error ? state.liveVisitors : null, v = state.visitors && !state.visitors.error ? state.visitors : null;
  const devs = (v && v.devices) || [], totalDev = devs.reduce((t, d) => t + Number(d.visitors || 0), 0);
  const split = totalDev ? devs.map((d) => '<span>' + esc(d.device) + ' <b>' + Math.round(Number(d.visitors) * 100 / totalDev) + '%</b></span>').join('') : '<span>No visits yet</span>';
  const imgs = (state.products || []).map((p) => p.image).filter(Boolean).slice(0, 6);
  const data = esc(JSON.stringify({ url, imgs, live: !!state.store?.published, pay: !!state.store?.razorpayConnected }));
  return '<aside class="home-side" aria-label="Website">' +
    '<section class="panel health" data-health="' + data + '"><div class="lc-top"><strong>Website health</strong><span class="pill" data-hc-overall>Checking…</span></div>' +
    '<ul class="hc-list"><li><span>Store online</span><b data-hc="live">…</b></li><li><span>Page response</span><b data-hc="resp">…</b></li><li><span>Images</span><b data-hc="img">…</b></li><li><span>Payments</span><b data-hc="pay">…</b></li></ul>' +
    '<div class="hc-seg" role="group" aria-label="Preview size"><button type="button" class="pill-tab" aria-pressed="true" data-hc-size="phone">Phone</button><button type="button" class="pill-tab" aria-pressed="false" data-hc-size="desktop">Desktop</button></div>' +
    '<div class="hc-frame phone" data-hc-frame><div class="hc-bar"><i></i><i></i><i></i><span>' + esc(slug ? slug + '.auzslab.in' : 'your store') + '</span></div><div class="hc-page"><b>' + esc(state.business.name || 'Your store') + '</b><div class="hc-grid">' + (imgs.length ? imgs.map((u) => '<img src="' + esc(u) + '" alt="" loading="lazy" data-hc-img>').join('') : '<span class="hc-empty">Add products with pictures to see your store here</span>') + '</div></div></div>' +
    '<div class="hc-devs"><small>Visitors by device, 14 days</small><div>' + split + '</div></div>' +
    (url ? '<a class="btn compact" href="' + esc(url) + '" target="_blank" rel="noopener">Open your store</a>' : '') + '</section></aside>';
}
function home() {
  const hour = new Date().getHours(), greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const recentOrders = table(['Order', 'Date', 'Customer', 'Total', 'Payment', 'Fulfillment'], state.orders.slice(0, 6).map((o) => [link('#' + o.number, pathFor('orders/' + o.id)), dateValue(o.date), esc(o.customer || '—'), money(o.total), status(o.payment), status(o.status)]));
  const f = state.features || {}, apps = [];
  if (f.style) apps.push(['AUZsStyle', 'Billing, stock and shop analytics', 'https://auzsstyle.auzslab.in/style.html']);
  if (f.accounting) apps.push(['AUZsLedger', 'Accounting and GST books', 'https://auzsledger.auzslab.in/accounts.html']);
  if (f.salon && state.tenant?.slug) apps.push(['Salon console', 'Bookings, billing and your salon website', 'https://' + state.tenant.slug + '.auzslab.in/salon/admin/']);
  const appsList = apps.length ? panel('Your apps', body('<div class="stack">' + apps.map(([n, d, u]) => '<a class="btn" href="' + esc(u) + '" data-handoff="1"><strong>' + esc(n) + '</strong> · ' + esc(d) + '</a>').join('') + '</div>')) : '';
  return homeOverview() + '<div class="home-cols"><div class="home-main">' +
    (state.plan?.blocked ? panel('Your trial has ended', body('<p class="compact-copy">Your store and data are safe, but editing and selling are paused. <a href="' + pathFor('billing') + '">Reactivate your plan</a> to switch it back on.</p>')) : '') +
    setupGuide() +
    (state.orders.length ? panel('Recent orders', recentOrders, wl('All orders', 'orders', 'compact')) : '') + appsList + '</div>' + siteSide() + '</div>';
}

// ---------- Orders ----------
const orderTabs = [['orders', 'All orders'], ['drafts', 'Drafts'], ['abandoned-checkouts', 'Abandoned checkouts'], ['returns', 'Returns'], ['shipping', 'Shipping'], ['taxes', 'Taxes']];
const ORDER_FILTERS = [['all', 'All'], ['unfulfilled', 'Unfulfilled'], ['unpaid', 'Unpaid'], ['open', 'Open'], ['archived', 'Archived']];
const orderMatches = (x, f) => f === 'archived' ? !!x.archived : f === 'all' ? true : x.archived ? false : f === 'unfulfilled' ? ['Unfulfilled', 'Partially fulfilled'].includes(x.status) : f === 'unpaid' ? String(x.payment || '').toLowerCase() !== 'paid' && x.status !== 'Cancelled' : !['Cancelled', 'Returned'].includes(x.status) && !(x.status === 'Fulfilled' && x.payment === 'Paid');
const orderPills = () => '<div class="pills" id="ol-pills" role="tablist" aria-label="Order status">' + ORDER_FILTERS.map(([k, n]) => '<button type="button" class="pill-tab" role="tab" data-action="ol-filter:' + k + '" aria-selected="' + (lb.orders.f === k) + '">' + n + '</button>').join('') + '</div>';
function orderBar() {
  const o = lb.orders;
  return '<div class="filters"><input id="ol-query" type="search" aria-label="Search orders" placeholder="Search order, customer, tag or discount code" value="' + esc(o.q) + '">' +
    sortSel('ol-sort', [['new', 'Newest first'], ['old', 'Oldest first'], ['high', 'Total, high to low'], ['low', 'Total, low to high']], o.sort) + '</div>' + orderPills();
}
function ordersList() {
  const o = lb.orders, q = o.q.trim().toLowerCase();
  let list = state.orders.filter((x) => (!q || String(x.number).toLowerCase().includes(q) || (x.customer || '').toLowerCase().includes(q) || (x.discountCode || '').toLowerCase() === q || (x.tags || []).includes(q)) && orderMatches(x, o.f));
  list = list.slice().sort(o.sort === 'old' ? (a, b) => cmp(a.date, b.date) : o.sort === 'high' ? (a, b) => b.total - a.total : o.sort === 'low' ? (a, b) => a.total - b.total : (a, b) => cmp(b.date, a.date));
  if (!list.length) return '<p class="empty">' + (state.orders.length ? 'No orders match this view.' : 'No orders yet. Create one by hand, or wait for your first online order.') + '</p>';
  const rows = table(['Order', 'Date', 'Customer', 'Total', 'Payment', 'Fulfillment'], list.map((o) => [
    link('#' + o.number, pathFor('orders/' + o.id)) + (o.isTest ? ' ' + badge('Test', 'neutral') : ''), dateValue(o.date), esc(o.customer || '—'), money(o.total), status(o.payment), status(o.archived ? 'Archived' : o.status),
  ]));
  // phone: one tappable card per order (number and total, then customer, items, date, status chips)
  let lastDay = '';
  const cards = '<div class="order-cards">' + list.map((o) => { const d = String(o.date || '').slice(0, 10), h = d !== lastDay ? '<h3 class="oc-day">' + (d === dayFmt.format(new Date()) ? 'Today' : d === dayFmt.format(new Date(Date.now() - 86400000)) ? 'Yesterday' : new Date(d + 'T12:00:00').toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })) + '</h3>' : ''; lastDay = d; return h + '<a class="order-card" href="' + pathFor('orders/' + o.id) + '"><div class="oc-top"><strong>#' + esc(o.number) + '</strong><span>' + money(o.total) + '</span></div><div class="oc-sub">' + esc(o.customer || '—') + ' <i>|</i> ' + (o.quantity ?? 0) + ' item' + (o.quantity === 1 ? '' : 's') + ' <i>|</i> ' + dateValue(o.date) + '</div><div class="oc-chips">' + status(o.payment) + status(o.archived ? 'Archived' : o.status) + '</div></a>'; }).join('') + '</div>';
  return '<div class="orders-table">' + rows + '</div>' + cards;
}

// ---------- order summary strip (KPI cells with sparklines) ----------
let reportRange = '7';
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' });
function sparkline(values) {
  const series = values.length > 1 ? values : [0, ...(values.length ? values : [0])];
  const peak = Math.max(1, ...series);
  const pts = series.map((v, i) => (i * 64 / (series.length - 1)).toFixed(1) + ',' + (22 - 20 * v / peak).toFixed(1)).join(' ');
  return '<svg class="sparkline" viewBox="0 0 64 24" aria-hidden="true"><polyline points="' + pts + '" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
}
const summaryCell = (name, value, values) => '<div class="summary-cell"><span>' + name + '</span><strong>' + value + '</strong>' + (values ? sparkline(values) : '') + '</div>';
function orderMetrics() {
  const today = dayFmt.format(new Date());
  const first = reportRange === 'all' ? '0000-00-00' : dayFmt.format(new Date(Date.now() - (Number(reportRange) - 1) * 86400000));
  const inRange = (d) => d && d >= first && d <= today;
  const days = (rows) => { const m = new Map(); rows.forEach(([d, v]) => { if (d) m.set(d, (m.get(d) || 0) + Number(v || 0)); }); return [...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v); };
  const cell = (name, rows, currency) => { const vals = days(rows), sum = vals.reduce((a, b) => a + b, 0); return summaryCell(name, currency ? money(sum) : sum, vals); };
  const orders = state.orders.filter((o) => inRange(o.date));
  const fulfilledOn = (o) => { const e = (o.timeline || []).find((x) => /fulfil/i.test(x.label || '')); return e ? String(e.at).slice(0, 10) : (o.status === 'Fulfilled' ? o.date : ''); };
  const fulfilled = state.orders.map((o) => [fulfilledOn(o), 1]).filter(([d]) => inRange(d));
  const reversed = state.orders.filter((o) => ['Cancelled', 'Returned'].includes(o.status) && inRange(o.date)).map((o) => [o.date, 1]);
  const opts = [['1', 'Today'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['all', 'All time']].map(([v, l]) => '<option value="' + v + '"' + (v === reportRange ? ' selected' : '') + '>' + l + '</option>').join('');
  return '<div class="summary-bar"><label class="summary-period">Reporting period<select id="report-range">' + opts + '</select></label>' +
    cell('Orders', orders.map((o) => [o.date, 1])) + cell('Items ordered', orders.map((o) => [o.date, o.quantity ?? 1])) +
    cell('Sales (paid)', orders.filter((o) => o.payment === 'Paid').map((o) => [o.date, o.total]), true) +
    cell('Orders fulfilled', fulfilled) + cell('Cancelled or returned', reversed) + '</div>';
}
function ordersPage(id) {
  if (id === 'drafts') return draftsPage();
  if (id === 'returns') return returnsPage();
  if (id === 'shipping') return shippingPage();
  if (id === 'taxes') return taxesPage();
  if (id === 'abandoned-checkouts') return abandonedPage();
  const plus = canWrite() ? '<details class="more-actions plus-menu"><summary class="btn" aria-label="Create">+ Create</summary><div class="more-menu"><a class="btn" href="' + pathFor('orders/new') + '?quick=1">Quick sale</a><a class="btn" href="' + pathFor('orders/new') + '">Create order</a></div></details>' : '';
  return head('Orders', 'Orders placed on your storefront.', plus) +
    orderMetrics() +
    panel('', orderBar() + '<div id="orders-results">' + ordersList() + '</div>');
}
// ---------- Create order (a full page: customer, products, payment) ----------
const co = { lines: [], name: '', phone: '', address: '', city: '', pin: '', dkind: '', dval: '', dnote: '', slabel: '', sfee: '', later: false, note: '', quick: false, seeded: '' };
function coReset(quick) { Object.assign(co, { lines: [], name: '', phone: '', address: '', city: '', pin: '', dkind: '', dval: '', dnote: '', slabel: '', sfee: '', later: false, note: '', quick: !!quick, seeded: location.hash }); }
const coVariants = () => (state.products || []).flatMap((p) => (p.variants || []).map((v) => ({ id: v.id, name: p.name, label: v.label, price: v.price, stock: v.stock })));
function coTotals() {
  const sub = co.lines.reduce((t, l) => t + (Number(l.price) || 0) * Math.max(1, Number(l.qty) || 1), 0), dv = Number(co.dval) || 0;
  const disc = co.dkind === 'percent' ? Math.round(sub * Math.min(dv, 100)) / 100 : co.dkind === 'flat' ? Math.min(dv, sub) : 0, ship = Number(co.sfee) || 0;
  return { sub, disc, ship, total: Math.max(sub - disc, 0) + ship };
}
function coTotalsHtml() {
  const t = coTotals(), row = (a, b, cls = '') => '<div class="launch co-row ' + cls + '"><div class="info">' + a + '</div><strong>' + b + '</strong></div>';
  return row('Subtotal', money(t.sub)) + row('Discount', t.disc ? '−' + money(t.disc) : money(0)) + row('Shipping', money(t.ship)) + '<p class="compact-copy">GST is worked out from your tax settings when the order is created.</p>' + row('Total', money(t.total), 'co-total');
}
function coLinesHtml() {
  if (!co.lines.length) return '<p class="empty">No products yet.</p>';
  return '<div class="co-lines">' + co.lines.map((l, i) => '<div class="co-line">' + (l.custom ? '<input name="cn' + i + '" value="' + esc(l.name) + '" placeholder="Custom item name" aria-label="Item name">' : '<div class="co-name"><strong>' + esc(l.name) + '</strong>' + (l.label && l.label !== 'Default' ? '<small>' + esc(l.label) + '</small>' : '') + '</div>') +
    '<label class="co-num">Price<input type="number" name="cp' + i + '" min="0" step="0.01" value="' + esc(l.price) + '"></label><label class="co-num">Qty<input type="number" name="cq' + i + '" min="1" step="1" value="' + esc(l.qty) + '"></label>' +
    '<button type="button" class="btn compact" data-action="co-rm:' + i + '" aria-label="Remove item">Remove</button></div>').join('') + '</div>';
}
function coInner() {
  const vs = coVariants(), names = (state.customers || []).map((c) => '<option value="' + esc(c.name) + '"></option>').join('');
  const customer = panel('Customer', body('<div class="field-grid">' + '<label>Name<input name="name" list="co-customers" autocomplete="off" required maxlength="120" value="' + esc(co.name) + '"></label><datalist id="co-customers">' + names + '</datalist>' + input('Phone', 'phone', co.phone, 'tel') +
    (co.quick ? '' : input('Address', 'address', co.address) + input('City', 'city', co.city) + input('PIN code', 'pin', co.pin)) + '</div>'));
  const products = panel('Products', body('<div id="co-lines">' + coLinesHtml() + '</div><div class="actions"><select id="co-pick" aria-label="Add product"><option value="">Add product…</option>' + vs.map((v) => '<option value="' + esc(v.id) + '">' + esc(v.name + (v.label && v.label !== 'Default' ? ' · ' + v.label : '') + ' (' + v.stock + ' left)') + '</option>').join('') + '</select>' + button('Add custom item', 'co-custom') + '</div>'));
  const payment = panel('Payment', body('<div class="field-grid">' + select('Discount', 'dkind', [['', 'No discount'], ['percent', 'Percentage off'], ['flat', 'Flat amount off (Rs)']], co.dkind) + input('Discount value', 'dval', co.dval, 'number', 'min="0" step="0.01"') + input('Shipping name', 'slabel', co.slabel, 'text', 'maxlength="60" placeholder="Local delivery"') + input('Shipping charge (Rs)', 'sfee', co.sfee, 'number', 'min="0" step="0.01" placeholder="0"') + select('Payment', 'later', [['0', co.quick ? 'Paid now, in person' : 'Collect when the order is created'], ['1', 'Payment due later']], co.later ? '1' : '0') + '</div><div id="co-totals" class="stack">' + coTotalsHtml() + '</div>'));
  const side = panel('Notes', body(area('Note for your team', 'note', co.note, 'maxlength="1000"')));
  return '<div class="record-layout"><div>' + customer + products + payment + '</div><aside>' + side + '</aside></div><div class="actions co-actions">' + button('Save as draft', 'co-save:draft') + button(co.quick ? 'Take sale' : 'Create order', 'co-save:order', 'primary') + '</div>';
}
function coSync() {
  const f = document.getElementById('co-form'); if (!f) return;
  const g = (n) => f.elements[n]?.value ?? '';
  ['name', 'phone', 'address', 'city', 'pin', 'dkind', 'dval', 'slabel', 'sfee', 'note'].forEach((n) => { if (f.elements[n]) co[n] = g(n); });
  if (f.elements.later) co.later = g('later') === '1';
  co.lines.forEach((l, i) => { if (f.elements['cp' + i]) l.price = g('cp' + i); if (f.elements['cq' + i]) l.qty = g('cq' + i); if (l.custom && f.elements['cn' + i]) l.name = g('cn' + i); });
  const m = (state.customers || []).find((c) => c.name === co.name); if (m && !co.phone && m.phone) { co.phone = m.phone; if (f.elements.phone) f.elements.phone.value = m.phone; }
}
const coRedraw = () => { const el = document.getElementById('co-body'); if (el) el.innerHTML = coInner(); };
function orderNewPage() {
  const quick = new URLSearchParams(location.hash.split('?')[1] || '').get('quick') === '1';
  if (co.seeded !== location.hash) coReset(quick);
  return head(quick ? 'Quick sale' : 'Create order', 'Add the customer and what they are buying. Stock is taken when the order is created.', '', ['orders', 'Orders']) + '<form id="co-form" data-form="co" autocomplete="off"><div id="co-body">' + coInner() + '</div></form>';
}
async function coSave(mode) {
  coSync();
  const lines = co.lines.map((l) => l.custom ? { custom: { name: l.name, price: Number(l.price) || 0 }, qty: Number(l.qty) || 1 } : { variantId: l.id, qty: Number(l.qty) || 1, price: Number(l.price) });
  const d = await api('sfx_draft_save', { p_id: null, p: { name: co.name, phone: co.phone, address: co.address, city: co.city, pin: co.pin, note: co.note, lines,
    discount: co.dkind ? { kind: co.dkind, value: Number(co.dval) || 0, note: co.dnote } : undefined, shipping: { label: co.slabel, amount: Number(co.sfee) || 0 }, payLater: co.later } });
  if (mode === 'draft') { await refreshDrafts(); save('Draft saved.'); coReset(false); location.hash = '/drafts'; return; }
  const r = await api('sfx_draft_convert', { p_id: d.id });
  await Promise.all([refreshDrafts(), refreshOrders()]); save('Order ' + r.number + ' created.'); coReset(false); location.hash = '/orders/' + r.orderId;
}

function payPanel(o, dlabel) {
  const row = (a, b, cls = '') => '<div class="pay-row ' + cls + '"><span>' + a + '</span><strong>' + b + '</strong></div>';
  const net = Math.max(Number(o.total) - Number(o.refunded || 0), 0);
  return panel('Payment', body('<div class="pay-card">' + row('Subtotal', money(o.subtotal || 0)) + (o.discountAmount > 0 ? row('Discount' + (o.discountCode ? ' (' + esc(o.discountCode) + ')' : ''), '−' + money(o.discountAmount)) : '') + row('Shipping', money(o.shippingFee || 0)) + (o.taxAmount > 0 ? row('Tax', money(o.taxAmount)) : '') + row('Total', money(o.total), 'pay-total') +
    (o.refunded > 0 ? row('Refunded', '−' + money(o.refunded)) + row('Net payment', money(net), 'pay-total') : '') + '</div><div class="pay-meta"><span>Payment</span>' + status(o.payment) + '<span>Fulfilment</span>' + status(o.status) + '<span>Delivery</span><b>' + esc(dlabel) + '</b></div>'));
}
function customerCard(o) {
  const c = o.contact || {}, phone = String(c.phone || '').replace(/[^\d+]/g, ''), addr = [c.address, c.city, c.state, c.pin].filter(Boolean).join(', ');
  const count = (state.customers || []).find((x) => x.id === o.customerId)?.orderCount;
  const ico = { mail: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M4 7l8 6 8-6"/></svg>', phone: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"/></svg>', wa: '<svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 00-8.6 15L2 22l5.2-1.4A10 10 0 1012 2zm0 18.2a8.2 8.2 0 01-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1112 20.200zm4.500-6.100c-.2-.1-1.500-.7-1.700-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.200-.3.200-.5.100a6.700 6.700 0 01-3.300-2.900c-.2-.4.200-.4.700-1.300.1-.2 0-.3 0-.5l-.8-1.800c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 00-.7.300 3 3 0 00-.9 2.200c0 1.300.9 2.600 1 2.800.1.200 1.800 2.800 4.400 3.900 1.600.7 2.200.7 3 .6.500-.1 1.500-.6 1.700-1.200.2-.6.200-1.100.2-1.200-.1-.1-.3-.2-.5-.3z"/></svg>' };
  const reach = '<div class="cust-reach">' + (c.email ? '<a class="btn ico-btn" href="mailto:' + esc(c.email) + '" aria-label="Email ' + esc(o.customer || '') + '" title="Email">' + ico.mail + '</a>' : '') + (phone ? '<a class="btn ico-btn" href="tel:' + esc(phone) + '" aria-label="Call ' + esc(o.customer || '') + '" title="Call">' + ico.phone + '</a><a class="btn ico-btn wa" href="https://wa.me/' + esc(phone.replace(/^(\d{10})$/, '91$1').replace(/^\+/, '')) + '?text=' + encodeURIComponent('Hi ' + (o.customer || '') + ', about your order #' + o.number + ': ') + '" target="_blank" rel="noopener" aria-label="WhatsApp ' + esc(o.customer || '') + '" title="WhatsApp">' + ico.wa + '</a>' : '') + '</div>';
  const edit = canWrite() && o.status !== 'Cancelled' ? '<div class="actions">' + button('Edit contact', 'order-contact:' + o.id, 'compact') + (o.fulfilment === 'unfulfilled' ? button('Edit address', 'order-address:' + o.id, 'compact') : '') + (o.customerId ? button('Remove', 'order-unlink:' + o.id, 'compact danger') : '') + '</div>' : '';
  return panel('Customer', body('<div class="cust-card"><div class="cust-top">' + (o.customerId ? '<a href="#" data-action="customer-detail:' + esc(o.customerId) + '"><strong>' + esc(o.customer || '—') + '</strong></a>' : '<strong>' + esc(o.customer || '—') + '</strong>') + (count != null ? '<span>' + count + ' order' + (count === 1 ? '' : 's') + '</span>' : '') + '</div>' +
    (addr ? '<p class="cust-addr">' + esc(addr) + '</p>' : '') + (c.email && !phone ? '' : '') + reach +
    (o.discountCode && !(o.discountAmount > 0) ? '' : '') + (o.attribution && (o.attribution.source || o.attribution.campaign) ? '<small>Came from: ' + esc([o.attribution.source, o.attribution.medium, o.attribution.campaign].filter(Boolean).join(' / ')) + '</small>' : '') + edit + '</div>'));
}
function orderDetail(id) {
  const o = state.orders.find((x) => x.id === id);
  if (!o) return head('Order unavailable', 'This order could not be found.', wl('All orders', 'orders'));
  const lines = table(['Item', 'Qty', 'Price'], (o.lines || []).map((l) => [(l.productId ? '<a href="' + pathFor('products/' + encodeURIComponent(l.productId)) + '">' + esc(l.name) + '</a>' : esc(l.name)) + (l.label && l.label !== 'Default' ? ' · ' + esc(l.label) : ''), l.qty, money(l.price)]));
  let tlDay = '';
  const timeline = (o.timeline || []).slice().reverse().map((e) => { const d = new Date(e.at), day = d.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' }), h = day !== tlDay ? '<h4 class="tl-day">' + day + '</h4>' : ''; tlDay = day; return h + '<div class="tl-item"><span class="tl-dot" aria-hidden="true"></span><span class="tl-text">' + (e.kind === 'comment' ? '<b>' + esc(e.by || 'Staff') + ':</b> ' : '') + esc(e.label) + '</span><time>' + d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) + '</time></div>'; }).join('');
  const left = (o.remaining || []).reduce((a, r) => a + r.qty, 0);
  const closed = ['Cancelled', 'Returned'].includes(o.status);
  const actions = canWrite() && !closed ? (left > 0 && o.status !== 'Fulfilled' ? button('Fulfil items', 'order-fulfill:' + o.id, 'primary') : '') + (o.fulfilment === 'unfulfilled' && o.status !== 'Fulfilled' ? button('Cancel order', 'order-cancel:' + o.id) : button('Start a return', 'return-new:' + o.id)) : '';
  const editBtn = canWrite() && !closed && o.fulfilment === 'unfulfilled' && !(o.shipments || []).some((x) => x.status !== 'cancelled') ? button('Edit items', 'order-edit:' + o.id) : '';
  const archiveBtn = canWrite() && (closed || o.status === 'Fulfilled' || o.archived) ? button(o.archived ? 'Restore from archive' : 'Archive', 'order-archive:' + o.id + ':' + (o.archived ? 'off' : 'on')) : '';
  const dlabel = { none: 'Not shipped', in_transit: 'In transit', partly_delivered: 'Partly delivered', delivered: 'Delivered', failed: 'Delivery failed' }[o.delivery] || 'Not shipped';
  const ships = (o.shipments || []).filter((x) => x.status !== 'cancelled').map((x) => {
    const next = { shipped: [['in_transit', 'Mark in transit'], ['delivered', 'Mark delivered']], in_transit: [['delivered', 'Mark delivered'], ['failed', 'Delivery failed']], failed: [['in_transit', 'Retry delivery']] }[x.status] || [];
    const acts = canWrite() ? next.map(([st, lb]) => button(lb, 'shipment-set:' + x.id + ':' + st)).join('') + (['shipped', 'in_transit'].includes(x.status) ? button('Edit tracking', 'shipment-edit:' + x.id) : '') : '';
    return '<div class="launch"><div class="info"><strong>Shipment ' + x.seq + '</strong> · ' + status(x.status === 'in_transit' ? 'In transit' : x.status === 'delivered' ? 'Delivered' : x.status === 'failed' ? 'Failed' : 'Shipped') +
      '<small>' + (x.items || []).map((i) => esc(i.name) + (i.label && i.label !== 'Default' ? ' · ' + esc(i.label) : '') + ' × ' + i.qty).join(', ') + '</small>' +
      '<small>' + (x.carrier ? esc(x.carrier) + ' ' : '') + (x.tracking ? (x.trackingUrl ? '<a href="' + esc(x.trackingUrl) + '" target="_blank" rel="noopener">' + esc(x.tracking) + '</a>' : esc(x.tracking)) : 'No tracking added') + '</small></div><div>' + acts + '</div></div>';
  }).join('');
  const refundRows = (o.refunds || []).map((r) => '<div class="launch"><div class="info"><strong>' + money(r.amount) + '</strong> · ' + esc({ manual: 'Paid back by you', razorpay: 'Razorpay', store_credit: 'Store credit' }[r.method] || r.method) + '<small>' + esc(r.reason || '') + ' ' + new Date(r.createdAt).toLocaleDateString('en-IN') + '</small></div></div>').join('');
  const canRefund = canWrite() && o.refunded < o.total && o.status !== 'Cancelled' && (o.payment === 'Paid' || o.refunded > 0 || o.status === 'Fulfilled');
  const refundPanel = panel('Refunds', body('<div class="stack">' + (refundRows || '<p class="empty">Nothing refunded.</p>') + (o.refunded > 0 ? '<p class="compact-copy">Refunded ' + money(o.refunded) + ' of ' + money(o.total) + '.</p>' : '') +
    (canRefund ? button('Record a refund', 'refund-new:' + o.id) : '') + (canWrite() ? button(o.isTest ? 'Unmark test order' : 'Mark as test order', 'order-test:' + o.id + ':' + (o.isTest ? 'off' : 'on')) : '') + '</div>'));
  const shipPanel = panel('Fulfilment', body('<div class="stack">' + (ships || '<p class="empty">Nothing shipped yet.</p>') + (left > 0 && (o.shipments || []).length ? '<p class="compact-copy">' + left + ' item(s) still to ship.</p>' : '') + '</div>'));
  const banner = o.isTest ? '<div class="note-banner" role="note"><strong>Test order</strong><span>Your payment gateway was in test mode when this order was created. It is left out of your reports.</span></div>' : '';
  return head('Order #' + esc(o.number), '<span class="head-chips">' + status(o.payment) + status(o.archived ? 'Archived' : o.status) + '</span> ' + dateValue(o.date) + ' · ' + esc(o.channel || 'Online store'), actions + editBtn + archiveBtn, ['orders', 'Orders']) + banner +
    '<div class="record-layout"><div>' + panel('Items', lines) + shipPanel + refundPanel + payPanel(o, dlabel) + ((state.returns || []).filter((r) => r.orderId === o.id).length ? panel('Returns', body('<div class="stack">' + (state.returns || []).filter((r) => r.orderId === o.id).map((r) => '<div class="launch"><div class="info">' + (r.lines || []).map((l) => l.qty + ' × ' + esc(l.name)).join(', ') + '<small>' + esc(r.reason || '') + '</small></div>' + badge({ requested: 'Requested', approved: 'Approved', rejected: 'Rejected', received: 'Received', refunded: 'Refunded' }[r.status] || esc(r.status)) + '</div>').join('') + '<a href="' + pathFor('returns') + '">All returns</a></div>')) : '') +
    panel('Timeline', body((canWrite() ? editForm('order-comment', o.id, area('Leave a comment (only your team sees this)', 'text', '', 'maxlength="1000" required'), 'Post') : '') + '<div class="stack">' + (timeline || '<p class="empty">No activity yet.</p>') + '</div>')) +
    '</div><aside>' + customerCard(o) + panel('Tags', body('<div class="stack">' + ((o.tags || []).length ? '<p>' + o.tags.map((t) => badge(esc(t), 'neutral')).join(' ') + '</p>' : '<p class="empty">No tags.</p>') + (canWrite() ? button('Edit tags', 'order-tags:' + o.id) : '') + '</div>')) + panel('Internal note', body(canWrite() ? editForm('order-note', o.id, area('Note', 'note', o.note), 'Save note') : '<p class="compact-copy">' + esc(o.note || 'No note.') + '</p>')) + '</aside></div>';
}

// ---------- Products ----------
const productTabs = [['products', 'All products'], ['collections', 'Collections'], ['inventory', 'Inventory'], ['transfers', 'Transfers'], ['categories', 'Categories and tags']];
const productLabel = (p) => '<div class="cell-product">' + image(p.image, '', 'thumb') + '<a href="' + pathFor('products/' + encodeURIComponent(p.id)) + '">' + esc(p.name) + '</a>' + '</div>';
let pf = { status: '', category: '', tag: '', stock: '', sort: '' };
// search / sort / filter bars shared by the list pages
const lb = { orders: { q: '', sort: 'new', f: 'all' }, customers: { q: '', sort: 'name' } };
const sortSel = (id, opts, val) => '<select id="' + id + '" aria-label="Sort">' + opts.map(([v, t]) => '<option value="' + v + '"' + (v === val ? ' selected' : '') + '>' + t + '</option>').join('') + '</select>';
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
function productsList(query = '') {
  const q = query.toLowerCase(); const tags = state.productTags || {};
  const items = state.products.filter((p) => (!q || p.name.toLowerCase().includes(q)) && (!pf.status || p.status === pf.status) && (!pf.category || (p.category || '') === pf.category) && (!pf.tag || (tags[p.id] || []).includes(pf.tag))
    && (!pf.stock || (pf.stock === 'out' ? Number(p.stock) <= 0 : pf.stock === 'low' ? Number(p.stock) > 0 && Number(p.stock) < 5 : Number(p.stock) >= 5)));
  const sorters = { name: (a, b) => cmp((a.name || '').toLowerCase(), (b.name || '').toLowerCase()), 'price-asc': (a, b) => a.price - b.price, 'price-desc': (a, b) => b.price - a.price, 'stock-asc': (a, b) => a.stock - b.stock, 'stock-desc': (a, b) => b.stock - a.stock };
  if (sorters[pf.sort]) items.sort(sorters[pf.sort]);
  return table(canWrite() ? ['', 'Product', 'Category', 'Status', 'Price', 'Available'] : ['Product', 'Category', 'Status', 'Price', 'Available'], items.map((p) => (canWrite() ? ['<input type="checkbox" data-bulk="' + esc(p.id) + '" aria-label="Select ' + esc(p.name) + '">'] : []).concat([productLabel(p), esc(p.category || 'Uncategorized'), status(p.status), money(p.price), p.stock])), filteredEmpty(state.products.length, items.length)) +
    (canWrite() && items.length ? '<p class="compact-copy" id="bulk-scope" data-total="' + items.length + '" aria-live="polite"></p>' : '');
}
function productFilters() {
  const cats = [...new Set(state.products.map((p) => p.category).filter(Boolean))].sort(); const tagSet = [...new Set(Object.values(state.productTags || {}).flat())].sort();
  const sel = (id, label, opts, val) => '<select id="' + id + '" aria-label="' + label + '"><option value="">' + label + '</option>' + opts.map(([v, t]) => '<option value="' + esc(v) + '"' + (v === val ? ' selected' : '') + '>' + esc(t) + '</option>').join('') + '</select>';
  return sel('pf-status', 'All statuses', ['Active', 'Draft', 'Archived'].map((x) => [x, x]), pf.status) + sel('pf-category', 'All categories', cats.map((x) => [x, x]), pf.category) + sel('pf-tag', 'All tags', tagSet.map((x) => [x, x]), pf.tag) + sel('pf-stock', 'Any stock', [['in', 'In stock (5+)'], ['low', 'Low (1 to 4)'], ['out', 'Out of stock']], pf.stock) + sel('pf-sort', 'Sort: default', [['name', 'Name A to Z'], ['price-asc', 'Price, low to high'], ['price-desc', 'Price, high to low'], ['stock-asc', 'Stock, low to high'], ['stock-desc', 'Stock, high to low']], pf.sort);
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
  const phoneMenu = '<details class="more-actions plus-menu"><summary class="btn" aria-label="Create">+ Create</summary><div class="more-menu">' + (canWrite() ? '<a class="btn" href="' + pathFor('products/new') + '">Add product</a>' + button('Bulk edit selected', 'bulk-open') : '') + button('Export CSV', 'products-csv') + '</div></details>';
  return head(title, 'Your catalog, shared by your storefront’s theme and checkout.', '<span class="desk-only">' + (canWrite() ? button('Bulk edit selected', 'bulk-open') + styleLinkButton() : '') + button('Export CSV', 'products-csv') + (canWrite() ? wl('Add product', 'products/new', 'primary') : '') + '</span><span class="phone-only">' + phoneMenu + '</span>') + tabs(id, productTabs) +
    '<section class="summary-bar" aria-label="Product summary">' + summaryCell('Products', state.products.length) + summaryCell('Active', state.products.filter((x) => x.status === 'Active').length) + summaryCell('Draft or archived', state.products.filter((x) => x.status !== 'Active').length) + '</section>' +
    panel('All products', '<div class="filters"><input id="table-query" type="search" aria-label="Search products" placeholder="Search products"><details class="pf-filters"' + (matchMedia('(max-width:899px)').matches ? '' : ' open') + '><summary class="btn" aria-label="Filters"><svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M3 5h14M6 10h8M9 15h2"/></svg></summary><div class="pf-fields">' + productFilters() + '</div></details><small id="table-count"></small></div><div id="table-results">' + productsList() + '</div>');
}
function collectionList(query = '') {
  return table(['Collection', 'Products'], state.collections.filter((c) => !query || c.name.toLowerCase().includes(query.toLowerCase())).map((c) => [
    '<div class="cell-product">' + image(c.image, '', 'thumb') + '<a href="' + pathFor('collections/' + encodeURIComponent(c.id)) + '">' + esc(c.name) + '</a>' + '</div>', c.productCount,
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
// Safe formatting for product descriptions: **bold**, *italic*, "- " lists and [text](https://link). Everything is escaped first.
function richHtml(t) {
  const inline = (x) => esc(x).replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>').replace(/\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  return String(t || '').trim().split(/\n{2,}/).filter(Boolean).map((b) => { const ls = b.split('\n'); return ls.every((l) => /^\s*[-*] /.test(l)) ? '<ul>' + ls.map((l) => '<li>' + inline(l.replace(/^\s*[-*] /, '')) + '</li>').join('') + '</ul>' : '<p>' + ls.map(inline).join('<br>') + '</p>'; }).join('');
}
function linkPicker() {
  const base = state.tenant?.slug ? 'https://' + state.tenant.slug + '.auzslab.in/store.html' : ''; if (!base) return '';
  const pg = cfgList('pages').filter((x) => x.slug && x.name).map((x) => '<option value="' + esc(base + '#/page/' + x.slug) + '">' + esc(x.name) + '</option>').join('');
  const pr = (state.products || []).filter((x) => x.status === 'Active').slice(0, 100).map((x) => '<option value="' + esc(base + '?view=p&p=' + encodeURIComponent(x.id)) + '">' + esc(x.name) + '</option>').join('');
  if (!pg && !pr) return '';
  return '<select data-linkpick aria-label="Link to a page or product"><option value="">Link to a page or product…</option>' + (pg ? '<optgroup label="Pages">' + pg + '</optgroup>' : '') + (pr ? '<optgroup label="Products">' + pr + '</optgroup>' : '') + '</select>';
}
function richArea(label, name, value, dis) {
  const bar = dis ? '' : '<div class="rich-bar" role="toolbar" aria-label="Formatting">' + button('<b>B</b>', 'rich-fmt:bold', 'compact') + button('<i>I</i>', 'rich-fmt:italic', 'compact') + button('• List', 'rich-fmt:list', 'compact') + button('Link', 'rich-fmt:link', 'compact') + linkPicker() + '</div>';
  return '<div class="wide rich"><span class="rich-label">' + label + '</span>' + bar + '<textarea name="' + name + '" rows="7" aria-label="' + label + '" ' + dis + '>' + esc(value) + '</textarea><div class="rich-preview" data-rich-preview aria-label="Preview">' + (value ? richHtml(value) : '<p class="compact-copy">A preview of your formatting shows here.</p>') + '</div></div>';
}
let editImages = [];
function variantEditor(variants) {
  const dis = canWrite() ? '' : 'disabled';
  return variants.length ? table(['Variant', 'SKU', 'Barcode', 'Price (₹)', 'Stock'].concat(editImages.length ? ['Picture'] : [], ['']), variants.map((v, i) => [
    input('Variant name', 'variantLabel' + i, v.label, 'text', 'required maxlength="80" ' + dis) + '<input type="hidden" name="variantId' + i + '" value="' + esc(v.id || '') + '">',
    input('SKU', 'variantSku' + i, v.sku, 'text', 'maxlength="60" ' + dis),
    input('Barcode', 'variantBarcode' + i, v.barcode, 'text', 'maxlength="60" ' + dis),
    input('Price', 'variantPrice' + i, v.price, 'number', 'required min="0" step="0.01" ' + dis),
    input('Stock', 'variantStock' + i, v.stock, 'number', 'required min="0" step="1" ' + dis),
    ...(editImages.length ? ['<label>Picture<select name="variantImage' + i + '" ' + dis + '><option value="">Product pictures</option>' + editImages.map((src, n) => '<option value="' + esc(src) + '"' + (src === v.image ? ' selected' : '') + '>Picture ' + (n + 1) + (n === 0 ? ' (main)' : '') + '</option>').join('') + '</select></label>'] : []),
    canWrite() ? button('Remove', 'variant-remove:' + i, 'compact danger') : '',
  ])) : '<p class="compact-copy">This product has no variants yet. Generate them from options above, or add a row.</p>';
}
// ---------- Options (for example Material × Finish) -> generated variants ----------
function optionRows(options) {
  const rows = [0, 1, 2].map((n) => { const o = (options || [])[n] || {}; return '<div class="field-grid option-row">' + input('Option ' + (n + 1) + ' name', 'optName' + n, o.name || '', 'text', 'maxlength="40" placeholder="' + ['Material', 'Finish', 'Size'][n] + '"') + input('Values, separated by commas', 'optValues' + n, (o.values || []).join(', '), 'text', 'maxlength="400" placeholder="' + ['Silver, Gold', 'Matte, Gloss', 'S, M, L'][n] + '"') + '</div>'; }).join('');
  return rows;
}
function readOptions(formEl) {
  const data = new FormData(formEl); const out = [];
  for (let n = 0; n < 3; n++) {
    const name = String(data.get('optName' + n) || '').trim(); const values = [...new Set(String(data.get('optValues' + n) || '').split(',').map((x) => x.trim()).filter(Boolean))];
    if (!name && !values.length) continue;
    if (!name || !values.length) throw new Error('Option ' + (n + 1) + ' needs both a name and at least one value.');
    if (values.length > 20) throw new Error(name + ' can have up to 20 values.');
    out.push({ name, values });
  }
  return out;
}
const combos = (options) => options.reduce((acc, o) => acc.flatMap((a) => o.values.map((v) => a.concat(v))), [[]]).map((c) => c.join(' / '));
function generateVariants(formEl) {
  const options = readOptions(formEl); if (!options.length) throw new Error('Add at least one option with values first.');
  const labels = combos(options); if (labels.length > 100) throw new Error('That makes ' + labels.length + ' variants. The limit is 100. Remove some values.');
  const current = collectVariants(formEl); const byLabel = new Map(current.map((v) => [v.label.toLowerCase(), v]));
  const basePrice = current[0]?.price ?? 0; let fresh = 0, kept = 0;
  const next = labels.map((label) => { const old = byLabel.get(label.toLowerCase()); if (old) { kept++; return { ...old, label }; } fresh++; return { label, sku: '', barcode: '', price: basePrice, stock: 0, image: '' }; });
  const removed = current.filter((v) => !labels.some((l) => l.toLowerCase() === v.label.toLowerCase())).length;
  formEl.querySelector('.product-variant-grid').innerHTML = variantEditor(next);
  return { total: labels.length, fresh, kept, removed };
}
function seoPreview(title, handle, desc) {
  const base = (state.tenant?.slug ? state.tenant.slug + '.auzslab.in' : 'your-store.auzslab.in') + ' › products' + (handle ? ' › ' + handle : '');
  const t = String(title || 'Product title').slice(0, 70), d = String(desc || 'Add a search description so shoppers know what this product is.').slice(0, 160);
  return '<div class="seo-card"><span class="seo-url">' + esc(base) + '</span><strong class="seo-title">' + esc(t) + '</strong><span class="seo-desc">' + esc(d) + '</span></div>';
}
function customFieldInputs(values) {
  const defs = cfgList('customFields').filter((f) => (f.appliesTo || 'Products') === 'Products'); if (!defs.length) return '';
  const dis = canWrite() ? '' : 'disabled';
  return panel('Custom fields', body('<div class="field-grid">' + defs.map((f) => {
    const v = values?.[f.id] ?? '', n = 'cf_' + f.id, t = f.valueType;
    if (t === 'Yes or no') return select(esc(f.name), n, [['', 'Not set'], ['Yes', 'Yes'], ['No', 'No']], v, dis);
    return input(esc(f.name), n, v, t === 'Number' ? 'number' : t === 'Date' ? 'date' : 'text', 'maxlength="600" ' + (t === 'Number' ? 'step="any" ' : '') + dis);
  }).join('') + '</div>'));
}
function readCustomFields(data) {
  const out = {}; for (const f of cfgList('customFields').filter((x) => (x.appliesTo || 'Products') === 'Products')) { const v = data['cf_' + f.id]; if (v !== undefined) out[f.id] = String(v); } return out;
}
function tagsCollectionsPanel(p, dis) {
  const tags = ((state.productTags || {})[p?.id] || []).join(', '); const mine = new Set((state.memberships || {})[p?.id] || []);
  const cols = state.collections.length ? '<fieldset class="check-list"><legend>Collections</legend>' + state.collections.map((c) => '<label class="inline"><input type="checkbox" name="collections" value="' + esc(c.id) + '"' + (mine.has(c.id) ? ' checked' : '') + ' ' + dis + '> ' + esc(c.name) + '</label>').join('') + '</fieldset>' : '<p class="compact-copy">No collections yet. Create one under Products › Collections.</p>';
  return panel('Tags and collections', body('<div class="field-grid">' + input('Tags (separated by commas)', 'tags', tags, 'text', 'maxlength="300" ' + dis) + '</div>' + cols));
}
function productSales(r) {
  const mine = state.orders.map((o) => ({ o, lines: (o.lines || []).filter((l) => l.productId === r.id) })).filter((x) => x.lines.length);
  const units = mine.reduce((t, x) => t + x.lines.reduce((u, l) => u + (l.qty || 1), 0), 0);
  const paid = mine.filter((x) => String(x.o.payment).toLowerCase() === 'paid');
  const sales = paid.reduce((t, x) => t + x.lines.reduce((u, l) => u + (l.qty || 1) * Number(l.price || 0), 0), 0);
  if (!mine.length) return panel('Sales in this preview', body('<p class="compact-copy">No orders for this product yet. Sales will appear here as customers buy it.</p>'));
  const recent = mine.slice().sort((a, b) => cmp(b.o.date, a.o.date)).slice(0, 5).map((x) => '<a class="ps-row" href="' + pathFor('orders/' + x.o.id) + '"><span>#' + esc(x.o.number) + '<small>' + dateValue(x.o.date) + '</small></span><span>' + x.lines.reduce((u, l) => u + (l.qty || 1), 0) + ' pc<small>' + status(x.o.payment) + '</small></span></a>').join('');
  return panel('Sales in this preview', body('<div class="ps-stats"><div><span>Units sold</span><strong>' + units + '</strong></div><div><span>Orders</span><strong>' + mine.length + '</strong></div><div><span>Sales (paid)</span><strong>' + money(sales) + '</strong></div></div>') + '<div class="ps-list">' + recent + '</div>');
}
function productDetail(id) {
  const p = id !== 'new' ? state.products.find((x) => x.id === id) : null;
  if (!p && id !== 'new') return head('Product unavailable', 'This product could not be found.', wl('Back to products', 'products'));
  const r = p || { status: 'Draft', variants: [{ label: 'Default', sku: '', price: 0, stock: 0 }], media: [] };
  const candidate = new URLSearchParams(location.hash.split('?')[1] || '').get('tab');
  const tab = p && recordTabs.some(([k]) => k === candidate) ? candidate : 'details';
  const tabNav = !p ? '<nav class="tabs" aria-label="Product detail"><a aria-current="page" href="#" onclick="return false">Details</a><span class="tab-off" title="Save the details first">Media</span><span class="tab-off" title="Save the details first">Variants</span></nav><p class="compact-copy">Step 1 of 3: save the details as a draft, then add media and variants. You can leave and come back; drafts stay in Products.</p>' : p ? '<nav class="tabs" aria-label="Product detail">' + recordTabs.map(([k, name]) => '<a href="' + pathFor('products/' + encodeURIComponent(p.id) + '?tab=' + k) + '"' + (k === tab ? ' aria-current="page"' : '') + '>' + name + '</a>').join('') + '</nav>' : '';
  const dis = canWrite() ? '' : 'disabled';
  const ex = r.extra || {};
  let view = '';
  if (tab === 'details') {
    view = '<form data-form="edit" data-key="product-record" data-id="' + esc(p?.id || '') + '" class="product-record"><div class="record-layout"><div>' +
      panel('Product information', body('<div class="field-grid">' + input('Title', 'name', r.name, 'text', 'required maxlength="160" ' + dis) + richArea('Description', 'description', r.description, dis) + '</div>')) +
      panel('Pricing', body('<div class="field-grid">' + input('Price in ₹', 'price', r.price ?? 0, 'number', 'min="0" step="0.01" required ' + dis) + input('Compare-at price in ₹', 'compareAt', r.compare, 'number', 'min="0" step="0.01" ' + dis) + '</div>')) +
      panel('Pricing details', body('<div class="field-grid">' + input('Cost per unit in ₹', 'cost', ex.cost ?? '', 'number', 'min="0" step="0.01" ' + dis) + input('HSN or tax code', 'hsn', ex.hsn || '', 'text', 'maxlength="20" ' + dis) + '</div>')) +
      panel('Organization', body('<div class="field-grid">' + '<label>Category<input name="category2" list="cat-list" value="' + esc(r.category) + '" ' + dis + '></label><datalist id="cat-list">' + ((state.categories?.categories) || []).map((c) => '<option value="' + esc(c.name) + '">').join('') + '</datalist>' + input('Product type', 'type', ex.type || '', 'text', 'maxlength="80" ' + dis) + input('Vendor or maker', 'vendor', ex.vendor || '', 'text', 'maxlength="80" ' + dis) + input('Weight in grams', 'weight', ex.weight ?? '', 'number', 'min="0" step="0.01" ' + dis) + input('Country of origin', 'origin', ex.origin || '', 'text', 'maxlength="60" ' + dis) + '</div>')) +
      tagsCollectionsPanel(p, dis) + customFieldInputs(ex.custom) +
      panel('Search listing', body('<div class="field-grid">' + input('Page title', 'seoTitle', ex.seoTitle || '', 'text', 'maxlength="70" ' + dis) + input('URL handle', 'handle', p ? r.handle : '', 'text', 'pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="made-from-title" ' + dis) + area('Search description', 'seoDescription', ex.seoDescription || '', 'maxlength="160" ' + dis) + '</div><div data-seo-preview>' + seoPreview(ex.seoTitle || r.name, p ? r.handle : '', ex.seoDescription || r.description) + '</div>')) +
      '</div><aside>' + panel('Status', body('<div class="stack">' + select('Catalog status', 'status', ['Draft', 'Active', 'Archived'], r.status) + (canWrite() ? '' : '<p class="compact-copy">Only an owner or manager can change this.</p>') + '</div>')) +
      (p && r.status === 'Draft' ? panel('Finish setting up', body('<ul class="checklist"><li>Details: saved</li><li>' + wl('Media: ' + ((r.media || []).length || 'none yet'), 'products/' + encodeURIComponent(p.id) + '?tab=media') + '</li><li>' + wl('Variants: ' + (r.variants || []).length, 'products/' + encodeURIComponent(p.id) + '?tab=variants') + '</li></ul><p class="compact-copy">Set the status to Active when it is ready to sell.</p>')) : '') + (p ? panel('Stock', body('<p>' + esc(r.stock) + ' available across ' + (r.variants || []).length + ' variant(s)</p>')) : '') + (p ? productSales(r) : '') + '</aside></div>' +
      '<div class="product-save actions">' + (canWrite() ? '<button class="btn primary">' + (p ? 'Save changes' : 'Create product') + '</button>' + (p ? '' : '<button class="btn" name="intent" value="draft">Save draft and add media</button>') : '') + wl('Cancel', 'products') + '</div></form>';
  } else if (tab === 'media') {
    const existing = [...new Set([r.image, ...(r.media || [])].filter(Boolean))];
    const main = Number(ex.mainIndex || 0);
    const photos = existing.map((src, i) => '<div class="product-photo" data-src="' + esc(src) + '">' + image(src, 'Product image ' + (i + 1)) + (canWrite() ? '<div class="photo-move">' + button('◀ Earlier', 'photo-move:-1', 'compact') + button('Later ▶', 'photo-move:1', 'compact') + '</div>' + '<label class="inline"><input type="radio" name="mainIndex" value="' + i + '"' + (i === (main < existing.length ? main : 0) ? ' checked' : '') + '> Main image</label><label class="inline"><input type="checkbox" name="remove" value="' + i + '"> Remove</label>' : '') + '</div>').join('');
    view = panel('Product media', body(canWrite()
      ? '<form data-form="edit" data-key="product-media" data-id="' + esc(p.id) + '">' + (photos ? '<div class="media-grid">' + photos + '</div>' : '<p class="compact-copy">No images yet. Add up to six. The main image shows on the storefront card.</p>') +
        '<input type="hidden" name="existing" value="' + esc(JSON.stringify(existing)) + '"><div class="field-grid" style="margin-top:12px">' + '<label class="wide">Upload photos from this device<input type="file" accept="image/*" multiple></label>' + input('Or add an image link (https://...)', 'imageUrl', '', 'url') + '</div><div class="actions"><button class="btn primary">Save images</button></div></form>'
      : (photos ? '<div class="media-grid">' + photos + '</div>' : '<p class="compact-copy">No images yet.</p>')));
  } else if (tab === 'variants') {
    editImages = [...new Set([r.image, ...(r.media || [])].filter(Boolean))];
    const intro = '<p class="compact-copy">Define options such as Material and Finish, then generate every combination. Each variant has its own SKU, barcode, price and stock.</p>';
    const grid = variantEditor(r.variants || []);
    const editable = canWrite()
      ? '<form data-form="edit" data-key="product-variants" data-id="' + esc(p.id) + '"><div class="stack">' + optionRows(ex.options) + '<div class="actions">' + button('Generate variants from options', 'variant-generate') + '</div></div>' +
        '<div class="product-variant-grid" style="margin-top:14px">' + grid + '</div>' +
        '<div class="field-grid" style="margin-top:12px">' + input('Set one price for all variants (₹)', 'bulkPrice', '', 'number', 'min="0" step="0.01"') + input('Set stock for all variants', 'bulkStock', '', 'number', 'min="0" step="1"') + '</div>' +
        '<div class="actions" style="margin-top:12px">' + button('Apply to all rows', 'variant-fill') + button('Add a variant row', 'variant-add') + '<button class="btn primary">Save variants</button></div></form>'
      : '<div class="product-variant-grid">' + grid + '</div>';
    view = panel('Options and variants', body(intro + editable));
  }
  const quick = p ? panel('Summary', body('<div class="stack">' + status(r.status) + '<strong>' + money(r.price) + '</strong><small>' + esc(r.stock) + ' available</small></div>')) : '';
  const viewLink = p && r.status === 'Active' && state.store.published && state.tenant?.slug ? link('View on storefront', 'https://' + esc(state.tenant.slug) + '.auzslab.in/store.html?view=p&p=' + encodeURIComponent(p.id)) : '';
  return head(p ? esc(p.name) : 'Add product', p ? 'Manage its details, media, and variants.' : 'Create a listing for your storefront.', viewLink, ['products', 'Products']) + tabNav + (view.includes('class="product-record"') ? view.replace('</aside>', quick + '</aside>') : '<div class="record-layout"><div>' + view + '</div><aside>' + quick + '</aside></div>');
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
  for (let i = 0; data.has('variantLabel' + i); i++) out.push({ id: data.get('variantId' + i) || undefined, label: data.get('variantLabel' + i), sku: data.get('variantSku' + i), barcode: data.get('variantBarcode' + i), price: Number(data.get('variantPrice' + i)) || 0, stock: Number(data.get('variantStock' + i)) || 0, image: data.get('variantImage' + i) || '' });
  return out;
}

// ---------- Online store: overview / theme / domains / payments ----------
const websiteTabs = [['website', 'Store overview'], ['builder', 'Themes'], ['store-pages', 'Pages'], ['store-directory', 'Stores'], ['domains', 'Domains'], ['checkout', 'Payments']];
// ---------- Theme marketplace (phase 2, db/375) ----------
// Real marketplace: built-in Minimal/Classic are now plain rows in sfx_themes (migrated in, not
// hardcoded), alongside any developer theme an admin has approved. "Install" copies the approved
// listing's content into this store's OWN install row (sfx_theme_installs) -- editing it later can
// never touch another store's copy of the same theme, or the developer's original listing.
const sectionLabel = { hero: 'Hero banner', text: 'Text block', image: 'Image', button: 'Button', announcement: 'Announcement bar', booking: 'Appointment booking' };
// A theme with no uploaded preview still gets a picture: our two stock images, or a small drawn storefront in the theme's own colour.
function themePreview(t) {
  if (t.previewImageUrl) return t.previewImageUrl;
  const slug = String(t.slug || t.themeSlug || t.name || '').toLowerCase();
  // every built-in theme has a real screenshot of its storefront (site/theme-previews)
  const shot = { minimal: 'minimal', classic: 'classic', salon: 'salon', kiln: 'kiln', 'kiln-salon': 'kiln', studs: 'studs' }[slug];
  if (shot) return '/theme-previews/' + shot + '.jpg';
  let h = 0; for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) % 360;
  const dark = /stud|noir|black|kiln/.test(slug), bg = dark ? '#161616' : '#f6f4f1', ink = dark ? '#ffffff' : '#171717', acc = 'hsl(' + h + ' 45% ' + (dark ? '55%' : '42%') + ')', tile = dark ? '#2a2a2a' : '#e4dfd8';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200"><rect width="320" height="200" fill="' + bg + '"/><rect x="0" y="0" width="320" height="22" fill="' + ink + '" opacity=".08"/><rect x="12" y="8" width="46" height="6" rx="3" fill="' + ink + '"/>' +
    '<rect x="236" y="8" width="20" height="6" rx="3" fill="' + ink + '" opacity=".5"/><rect x="262" y="8" width="20" height="6" rx="3" fill="' + ink + '" opacity=".5"/><rect x="12" y="32" width="296" height="64" rx="6" fill="' + acc + '"/>' +
    '<rect x="24" y="52" width="110" height="10" rx="5" fill="#fff" opacity=".9"/><rect x="24" y="70" width="70" height="7" rx="3.500" fill="#fff" opacity=".6"/>' +
    [0, 1, 2, 3].map((i) => '<rect x="' + (12 + i * 75) + '" y="108" width="68" height="62" rx="5" fill="' + tile + '"/><rect x="' + (12 + i * 75) + '" y="176" width="40" height="5" rx="2.500" fill="' + ink + '" opacity=".7"/>').join('') + '</svg>';
  return { svg };
}
// the picture markup: an uploaded or stock picture, or the small drawn storefront (built only from fixed shapes and a hue number, never from user text)
const themePreviewHtml = (t) => { const p = themePreview(t); return typeof p === 'string' ? image(p, t.name) : p.svg.replace('<svg ', '<svg role="img" aria-label="' + esc(t.name || 'Theme') + ' preview" style="width:100%;height:100%;display:block" '); };
function themeCard(t) {
  const price = t.priceCents > 0 ? money(t.priceCents / 100) : 'Free';
  const buy = t.installed ? badge('Installed') :
    t.priceCents > 0 ? (canWrite() ? button('Buy for ' + price, 'theme-buy:' + t.id, 'primary') : '<p class="compact-copy">Premium theme. Ask an owner or manager to buy it.</p>') :
    canWrite() ? button('Install', 'theme-install:' + t.id, 'primary') : '';
  const tslug = String(t.slug || '').toLowerCase();
  // classic, minimal and studs preview on the store's OWN address with its real products (the same address it runs on when live)
  const own = ['classic', 'minimal', 'studs'].includes(tslug) && state.tenant?.slug ? 'https://' + state.tenant.slug + '.auzslab.in/store.html?preview=' + tslug : '';
  const demo = { studs: 'studs-preview/', minimal: 'store.html?demo=minimal', classic: 'store.html?demo=classic', salon: 'salon/index.html?preview=1', kiln: 'site-kiln.html', 'kiln-salon': 'site-kiln.html' }[tslug];
  const previewHref = own || (demo ? 'https://auzslab.in/' + demo : '');
  const previewBtn = previewHref ? '<a class="btn" href="' + previewHref + '" target="_blank" rel="noopener" aria-label="Preview ' + esc(t.name) + ' theme">Preview</a>' : '';
  return '<article class="card theme-card"><div class="tile-img">' + themePreviewHtml(t) + '</div><div class="tc-body"><div class="tc-row"><h3>' + esc(t.name) + '</h3>' + badge(price, t.priceCents > 0 ? '' : 'neutral') + '</div>' +
    '<p class="tc-desc">' + esc(t.description || (t.isBuiltin ? 'AUZslab first-party theme.' : 'By ' + (t.developerName || 'a theme developer') + '.')) + '</p>' + ((buy || previewBtn) ? '<div class="tc-foot">' + previewBtn + buy + '</div>' : '') + '</div></article>';
}
function installRow(i) {
  const actions = (canWrite() ? button('Customize', 'theme-customize:' + i.id) : '') +
    (canWrite() && !i.active ? button('Make active', 'theme-activate:' + i.id, 'primary') : i.active ? badge('Active on your storefront') : '') +
    (canWrite() ? button('Rename', 'theme-rename:' + i.id, 'compact') + button('Duplicate', 'theme-duplicate:' + i.id, 'compact') + (i.custom && !i.active ? button('Delete', 'theme-delete:' + i.id, 'compact danger') : '') : '');
  return '<article class="card"><div class="tile-img">' + themePreviewHtml({ slug: i.themeName, name: i.themeName }) + '</div><div class="card-body"><div class="theme-title-row"><h3>' + esc(i.themeName) + '</h3>' + (i.published ? badge('Published') : badge('Not published yet', 'warn')) + '</div>' +
    '<p class="compact-copy">' + (i.custom ? 'Your own theme.' : i.isBuiltin ? 'First-party theme.' : 'Developer theme.') + ' ' + (i.custom ? 'Created' : 'Installed') + ' ' + dateValue(i.installedAt) + '.</p>' + actions + '</div></article>';
}
function themePage() {
  const owned = new Set(state.installs.filter((i) => !i.custom).map((i) => i.themeId));
  const market = state.marketplace.map((t) => ({ ...t, installed: owned.has(t.id) }));
  return head('Themes', 'Browse the theme marketplace, install a theme, and customize what you install.', canWrite() ? button('Import ZIP', 'theme-import') + button('New theme', 'theme-new', 'primary') : '') + tabs('builder', websiteTabs) +
    panel('Your installed themes', state.installs.length ? '<div class="cards">' + state.installs.map(installRow).join('') + '</div>' : body('<p class="compact-copy">You haven’t installed a theme yet. Install one from the marketplace below.</p>')) +
    panel('Theme marketplace', body('<p class="compact-copy">Prices on this page are always current and are set by AUZslab. Free themes install instantly; premium themes are bought once with a secure payment and install straight away.</p>') + '<div class="cards">' + market.map(themeCard).join('') + '</div>') +
    panel('Sell your own theme', body('<p class="compact-copy">Building and selling themes to other AUZslab stores happens in the <a href="/theme-dev.html" target="_blank" rel="noopener">theme developer portal</a>, a separate login area for developers.</p>'));
}
// ---------- Theme editor: a store's own draft for one install (section list, add/edit/remove, publish) ----------
// internal links a section or menu can point to (pages and products of this store)
function linkOptions() {
  const base = '/store.html';
  const o = [['Shop', base + '#/shop'], ['Collections', base + '#/collections'], ['Contact', base + '#/contact'], ['About', base + '#/about']];
  (ed?.pages || []).forEach((pg) => o.push([pg.title, base + '#/page/' + pg.slug]));
  cfgList('pages').filter((x) => x.slug && x.name).forEach((x) => o.push([x.name, base + '#/page/' + x.slug]));
  (state.products || []).filter((x) => x.status === 'Active').slice(0, 60).forEach((x) => o.push([x.name, base + '?view=p&p=' + encodeURIComponent(x.id)]));
  return o;
}
const linkList = () => '<datalist id="te-links">' + linkOptions().map(([n, u]) => '<option value="' + esc(u) + '">' + esc(n) + '</option>').join('') + '</datalist>';
const spaceFields = (p) => '<label>Spacing<select name="space">' + [['compact', 'Compact'], ['normal', 'Normal'], ['roomy', 'Roomy']].map(([k, l]) => '<option value="' + k + '"' + ((p.space || 'normal') === k ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></label>' +
  '<label>Text alignment<select name="align">' + [['center', 'Centered'], ['left', 'Left']].map(([k, l]) => '<option value="' + k + '"' + ((p.align || 'center') === k ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></label>';
function sectionFieldsFor(s) {
  const p = s.props || {};
  const fields = sectionFieldsBase(s);
  return fields ? fields.replace(/(<input type="url" name="(?:href)")/g, '$1 list="te-links"') + linkList() + (s.type === 'announcement' || s.type === 'booking' ? '' : spaceFields(p)) : fields;
}
function sectionFieldsBase(s) {
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
// ---- Theme editor: sections list | live preview of the store | settings of the selected section ----
const SECTION_DEFAULTS = { hero: { heading: 'New heading', sub: 'A short line about your store.' }, text: { heading: 'About us', body: 'Tell your story here.' }, image: { url: '', caption: '' }, button: { text: 'Shop now', href: '/store.html' }, announcement: { text: 'Free shipping on orders over ₹999' }, booking: { heading: 'Book an appointment', note: '' } };
let ed = null; // the open editor: { id, sections, sel, undo, redo, saved, device, snapped }
const edJson = () => JSON.stringify({ sections: ed.home, header: ed.header, footer: ed.footer, pages: ed.pages });
const PAGE_TEMPLATES = {
  about: ['About us', [{ type: 'hero', props: { heading: 'Our story', sub: 'Who we are and why we make what we make.' } }, { type: 'text', props: { heading: 'How it started', body: 'Tell visitors where the idea came from.' } }, { type: 'image', props: { url: '', caption: '' } }, { type: 'text', props: { heading: 'What we care about', body: 'Quality, honest prices and people.' } }]],
  contact: ['Contact', [{ type: 'hero', props: { heading: 'Get in touch', sub: 'We usually reply within a day.' } }, { type: 'text', props: { heading: 'Visit or call', body: 'Add your address, opening hours and phone number here.' } }, { type: 'button', props: { text: 'Browse the shop', href: '/shop' } }]],
  faq: ['FAQ', [{ type: 'hero', props: { heading: 'Questions, answered', sub: 'Quick answers about orders, delivery and returns.' } }, { type: 'text', props: { heading: 'How long does delivery take?', body: 'Write your answer here.' } }, { type: 'text', props: { heading: 'Can I return an item?', body: 'Write your answer here.' } }, { type: 'text', props: { heading: 'How do I track my order?', body: 'Write your answer here.' } }]],
  lookbook: ['Lookbook', [{ type: 'hero', props: { heading: 'The lookbook', sub: 'Pieces styled the way we wear them.' } }, { type: 'image', props: { url: '', caption: '' } }, { type: 'image', props: { url: '', caption: '' } }, { type: 'button', props: { text: 'Shop the looks', href: '/shop' } }]],
  blank: ['New page', [{ type: 'text', props: { heading: 'New page', body: 'Write something here.' } }]],
};
const linesOf = (links) => (links || []).map((l) => l.label + ' | ' + l.href + ((l.children || []).map((c) => '\n- ' + c.label + ' | ' + c.href).join(''))).join('\n');
// one link per line "Label | href"; a line starting with "- " is a sub-link of the line above it (header menus only use them)
const parseLinks = (txt, max) => { const out = []; for (const raw of String(txt || '').split('\n')) { const x = raw.trim(); if (!x) continue; const child = /^-\s+/.test(x); const [label, ...r] = x.replace(/^-\s+/, '').split('|'); const l = { label: (label || '').trim(), href: r.join('|').trim() }; if (!l.label || !l.href) continue;
  if (child && out.length) { const p = out[out.length - 1]; p.children = [...(p.children || []), l].slice(0, 8); } else if (!child && out.length < max) out.push(l); } return out; };
const columnsText = (cols) => (cols || []).map((c) => '## ' + c.title + '\n' + (c.links || []).map((l) => l.label + ' | ' + l.href).join('\n')).join('\n\n');
const parseColumns = (txt) => { const cols = []; for (const raw of String(txt || '').split('\n')) { const x = raw.trim(); if (!x) continue; if (/^##\s*/.test(x)) { if (cols.length < 3) cols.push({ title: x.replace(/^##\s*/, '').slice(0, 40), links: [] }); continue; } const c = cols[cols.length - 1]; if (!c) continue; const [label, ...r] = x.split('|'); const l = { label: (label || '').trim(), href: r.join('|').trim() }; if (l.label && l.href && c.links.length < 8) c.links.push(l); } return cols.filter((c) => c.title && c.links.length); };
const pageSlug = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'page';
const edCurPage = () => (ed.cur.startsWith('p:') ? ed.pages[Number(ed.cur.slice(2))] : null);
function edBind() { const p = edCurPage(); ed.sections = ed.cur === 'home' ? ed.home : p ? p.sections : ed.home; if (ed.cur !== 'home' && !p && ed.cur !== 'header' && ed.cur !== 'footer') ed.cur = 'home'; }
function edApply(doc) { ed.home = doc.sections || []; ed.header = doc.header || { announceText: '', announceHref: '', links: [] }; ed.footer = doc.footer || { about: '', note: '', links: [] }; ed.pages = doc.pages || []; edBind(); }
const edView = () => (edCurPage() ? 'page/' + edCurPage().slug : '');
const edDirty = () => edJson() !== ed.saved;
function edSnapshot() { ed.undo.push(edJson()); if (ed.undo.length > 50) ed.undo.shift(); ed.redo = []; }
function edPost(scroll) {
  const f = $('#te-frame'); if (!f?.contentWindow) return;
  try { f.contentWindow.postMessage({ type: 'auz-draft', sections: ed.home, header: ed.header, footer: ed.footer, pages: ed.pages, view: edView() }, location.origin); if (ed.sel >= 0 && (ed.cur === 'home' || edCurPage())) f.contentWindow.postMessage({ type: 'auz-highlight', index: ed.sel, scroll: !!scroll }, location.origin); } catch (e) { /* frame not ready */ }
}
function edPageSelect() {
  const opts = [['home', 'Home page'], ['header', 'Header'], ['footer', 'Footer'], ...ed.pages.map((p, i) => ['p:' + i, 'Page: ' + p.title])];
  return '<select id="te-page" aria-label="Page">' + opts.map(([v, t]) => '<option value="' + esc(v) + '"' + (ed.cur === v ? ' selected' : '') + '>' + esc(t) + '</option>').join('') + '</select>';
}
function edListHtml() {
  if (ed.cur === 'header') return '<p class="compact-copy">The header block: an announcement bar and extra menu links. Edit it on the right.</p>';
  if (ed.cur === 'footer') return '<p class="compact-copy">The footer block: a short text and links shown in the footer. Edit it on the right.</p>';
  if (edCurPage() && !ed.sections.length) return '<p class="compact-copy">This page has no sections yet. Add one below.</p>';
  if (!ed.sections.length) return '<p class="compact-copy">No sections yet. Add one below. Sections show on your home page after the store’s own content.</p>';
  return ed.sections.map((x, i) => '<button type="button" class="te-item' + (i === ed.sel ? ' on' : '') + '" data-action="te-select:' + i + '"><span>' + esc(sectionLabel[x.type] || x.type) + '</span><small>' + esc(String((x.props || {}).heading || (x.props || {}).text || (x.props || {}).caption || '').slice(0, 28)) + '</small></button>').join('');
}
const chromePicker = (dis) => '<label class="wide">Add a link to a page or product<select data-chrome-pick' + dis + '><option value="">Choose…</option>' + linkOptions().map(([n, u]) => '<option value="' + esc(n + ' | ' + u) + '">' + esc(n) + '</option>').join('') + '</select></label>';
function edChromeHtml(kind) {
  const w = canWrite(); const dis = w ? '' : ' disabled';
  if (kind === 'header') return '<div class="panel-title"><h2>Header</h2></div><div class="panel-body"><form data-form="te-chrome" data-kind="header"><div class="field-grid te-fields">' +
    input('Announcement bar text', 'announceText', ed.header.announceText, 'text', 'maxlength="160"' + dis) + input('Announcement link (optional)', 'announceHref', ed.header.announceHref, 'text', 'placeholder="/shop or https://..."' + dis) +
    area('Extra menu links. One per line: Label | /path or https://link (up to 8). A line starting with - is a sub-link of the line above.', 'links', linesOf(ed.header.links), 'rows="5"' + dis) + chromePicker(dis) + '</div></form></div>';
  return '<div class="panel-title"><h2>Footer</h2></div><div class="panel-body"><form data-form="te-chrome" data-kind="footer"><div class="field-grid te-fields">' +
    area('About text', 'about', ed.footer.about, 'rows="3" maxlength="400"' + dis) + input('Small note (shown at the bottom)', 'note', ed.footer.note, 'text', 'maxlength="200"' + dis) +
    area('Footer links (one per line: Label | /path or https://link, up to 12)', 'links', linesOf(ed.footer.links), 'rows="6"' + dis) + chromePicker(dis) + area('Footer columns (up to 3). Start each with ## Title, then one link per line.', 'columns', columnsText(ed.footer.columns), 'rows="7"' + dis + ' placeholder="## Help\nShipping | /store.html#/policy/shipping"') + '</div></form></div>';
}
function edRightHtml() {
  if (ed.cur === 'header' || ed.cur === 'footer') return edChromeHtml(ed.cur);
  const x = ed.sections[ed.sel];
  if (!x) return '<div class="panel-title"><h2>Section settings</h2></div><div class="panel-body"><p class="compact-copy">Pick a section on the left, or click it in the preview, to edit it.</p></div>';
  const w = canWrite();
  return '<div class="panel-title"><h2>' + esc(sectionLabel[x.type] || x.type) + '</h2></div><div class="panel-body"><form data-form="te-section"><div class="field-grid te-fields">' + sectionFieldsFor(x) + '</div>' +
    (w ? '<div class="actions">' + (ed.sel > 0 ? button('Move up', 'te-up') : '') + (ed.sel < ed.sections.length - 1 ? button('Move down', 'te-down') : '') + button('Remove section', 'te-remove') + '</div>' : '') + '</form></div>';
}
function edPageTools() {
  const p = edCurPage();
  const tpl = '<select id="te-add-page-tpl" aria-label="Page template">' + Object.entries(PAGE_TEMPLATES).map(([k, v]) => '<option value="' + k + '">' + esc(v[0]) + '</option>').join('') + '</select>' + button('Add page', 'te-addpage');
  if (!p) return ed.pages.length >= 8 ? '' : tpl;
  return '<form data-form="te-page" class="te-pagetools"><label>Title<input name="title" value="' + esc(p.title) + '" maxlength="60"></label><label>Address<input name="slug" value="' + esc(p.slug) + '" maxlength="40"></label></form>' + button('Remove page', 'te-rmpage');
}
function edBarHtml() {
  const i = state.installs.find((v) => v.id === ed.id);
  const w = canWrite();
  return '<span class="te-status">' + (edDirty() ? badge('Unsaved changes', 'warn') : (i && JSON.stringify(i.draftContent) !== JSON.stringify(i.publishedContent) ? badge('Saved draft, not published', 'warn') : badge('Published'))) + '</span>' +
    (w ? button('Undo', 'te-undo', ed.undo.length ? '' : 'disabled-look') + button('Redo', 'te-redo', ed.redo.length ? '' : 'disabled-look') : '') + button('Version history', 'theme-history:' + ed.id) +
    (w ? button('Save design', 'te-save') + button('Review & publish', 'te-publish', 'primary') : '');
}
function edRefresh(parts = 'lbr', scroll = false) {
  if (parts.includes('l')) { const el = $('#te-list'); if (el) el.innerHTML = edListHtml(); }
  if (parts.includes('r')) { const el = $('#te-right'); if (el) el.innerHTML = edRightHtml(); }
  if (parts.includes('b')) { const el = $('#te-actions'); if (el) el.innerHTML = edBarHtml(); }
  if (parts.includes('p')) { const el = $('#te-page-wrap'); if (el) el.innerHTML = edPageSelect(); const t = $('#te-page-tools'); if (t) t.innerHTML = edPageTools(); }
  edPost(scroll);
}
if (typeof window !== 'undefined') window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || !e.data || !ed) return;
  if (e.data.type === 'auz-ready') edPost();
  if (e.data.type === 'auz-select' && Number.isInteger(e.data.index) && ed.sections[e.data.index]) { ed.sel = e.data.index; ed.snapped = false; edRefresh('lrb'); }
});
// ---------- Studs theme: settings editor with a live preview of the DRAFT (nothing here changes the live store) ----------
let sd = null; // { id, settings, saved }
const lines2 = (list, a, b) => (list || []).map((x) => (x[a] || '') + (x[b] ? ' | ' + x[b] : '')).join('\n');
const parse2 = (text, a, b) => String(text || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 12).map((l) => { const [x, ...rest] = l.split('|'); const o = {}; o[a] = x.trim(); if (rest.length) o[b] = rest.join('|').trim(); return o; });
function studsRead() {
  const f = document.querySelector('#studs-form'); if (!f || !sd) return;
  const v = (n) => (f.elements[n] ? f.elements[n].value.trim() : '');
  const out = {};
  ['heroImage', 'heroHref', 'heroLabel', 'heroAlt', 'dropCollection', 'dropTitle', 'moreTitle', 'quoteImage', 'quoteText', 'closingImage', 'closingText', 'closingHref'].forEach((k) => { if (v(k)) out[k] = v(k); });
  const ann = parse2(f.elements.announcements.value, 'text', 'href'); if (ann.length) out.announcements = ann;
  const cam = parse2(f.elements.campaigns.value, 'image', 'collection'); if (cam.length) out.campaigns = cam;
  const ft = parse2(f.elements.footerLinks.value, 'label', 'href'); if (ft.length) out.footerLinks = ft;
  const ch = parse2(f.elements.channels.value, 'label', 'href'); if (ch.length) out.channels = ch;
  const notes = {}; f.querySelectorAll('[data-catnote]').forEach((t) => { const x = t.value.trim(); if (x) notes[t.dataset.catnote] = x.slice(0, 400); }); if (Object.keys(notes).length) out.categoryNotes = notes;
  sd.settings = out; studsPush();
}
function studsPush() { const fr = document.querySelector('#studs-frame'); if (fr && fr.contentWindow && sd) { try { fr.contentWindow.postMessage({ type: 'studs-settings', settings: sd.settings }, location.origin); } catch (e) { /* frame not ready */ } } }
window.addEventListener('message', (e) => { if (e.origin === location.origin && e.data && e.data.type === 'studs-ready') studsPush(); });
const catNames = () => [...new Set((state.products || []).map((p) => p.category).filter(Boolean))].sort();
function studsEditor(i) {
  if (!sd || sd.id !== i.id) { const s0 = structuredClone(i.draftContent?.settings || {}); sd = { id: i.id, settings: s0, saved: JSON.stringify(s0) }; }
  const S = sd.settings, w = canWrite();
  const cols = (state.collections || []).map((c) => [c.name, c.name]);
  const dis = w ? '' : 'disabled';
  const form = '<form id="studs-form" data-form="studs" class="stack">' +
    panel('Announcement bar', body('<div class="field-grid">' + area('Messages, one per line: text | link', 'announcements', lines2(S.announcements, 'text', 'href'), dis + ' rows="3"') + '</div>')) +
    panel('Home hero', body('<div class="field-grid">' + input('Hero image address', 'heroImage', S.heroImage || '', 'text', dis) + input('Hero link', 'heroHref', S.heroHref || '', 'text', dis) + input('Button label', 'heroLabel', S.heroLabel || '', 'text', dis) + input('Image description', 'heroAlt', S.heroAlt || '', 'text', dis) + '</div>')) +
    panel('Drop and collections', body('<div class="field-grid">' + select('Drop products come from', 'dropCollection', [['', 'Newest products']].concat(cols), S.dropCollection || '', dis) + input('Drop heading', 'dropTitle', S.dropTitle || '', 'text', dis) + input('Second grid heading', 'moreTitle', S.moreTitle || '', 'text', dis) +
      area('Shop all campaign slides, one per line: image address | collection name', 'campaigns', lines2(S.campaigns, 'image', 'collection'), dis + ' rows="4"') + '</div>')) +
    panel('Quote and closing banners', body('<div class="field-grid">' + input('Quote banner image', 'quoteImage', S.quoteImage || '', 'text', dis) + area('Quote text', 'quoteText', S.quoteText || '', dis + ' rows="2"') + input('Closing banner image', 'closingImage', S.closingImage || '', 'text', dis) + input('Closing banner text', 'closingText', S.closingText || '', 'text', dis) + input('Closing banner link', 'closingHref', S.closingHref || '', 'text', dis) + '</div>')) +
    panel('Category notes', body('<p class="compact-copy">A short line shown under the category title on the shop page. Leave empty to use the default text.</p><div class="field-grid">' + catNames().map((n) => '<label class="field"><span>' + esc(n) + '</span><textarea data-catnote="' + esc(n) + '" rows="2" maxlength="400" ' + dis + '>' + esc((S.categoryNotes || {})[n] || '') + '</textarea></label>').join('') + (catNames().length ? '' : '<p class="compact-copy">Add products with categories to write notes for them.</p>') + '</div>')) +
    panel('Footer', body('<div class="field-grid">' + area('Footer links, one per line: label | link', 'footerLinks', lines2(S.footerLinks, 'label', 'href'), dis + ' rows="3"') + area('Social channels, one per line: label | link', 'channels', lines2(S.channels, 'label', 'href'), dis + ' rows="3"') + '</div><p class="compact-copy">Leave any field empty to use the default built from your own products and collections. Images must be https addresses or files under Content.</p>')) +
    '</form>';
  const live = i.active ? badge('Live on your storefront') : badge('Draft, not live', 'warn');
  const actions = w ? button('Save draft', 'studs-save') + button(i.active ? 'Publish changes' : 'Publish and make live', 'studs-publish', 'primary') + (i.active ? button('Go back to my previous theme', 'studs-revert', 'danger') : '') : '';
  return head(esc(i.themeName), 'Edit Studs and see your draft in the preview. Your live store keeps its current theme until you publish.', '<span class="te-actions">' + live + actions + '</span>', ['builder', 'Theme']) +
    '<div class="te studs-te"><div class="te-left" style="min-width:0">' + form + '</div><div class="te-mid"><div class="te-bar"><div class="seg" role="group" aria-label="Device">' +
    ['desktop', 'mobile'].map((d) => '<button type="button" class="btn compact" data-action="studs-device:' + d + '">' + d[0].toUpperCase() + d.slice(1) + '</button>').join('') + '</div></div>' +
    '<div class="te-stage"><iframe id="studs-frame" class="te-frame desktop" src="/store.html?preview=studs&shop=' + encodeURIComponent(state.tenant?.slug || '') + '#/" title="Preview of your Studs draft"></iframe></div></div></div>';
}
function editorPage(installId) {
  const i = state.installs.find((x) => x.id === installId);
  if (!i) return head('Theme not found', 'This install could not be found.', wl('Theme', 'builder'));
  if (i.draftContent?.kind === 'studs') return studsEditor(i);
  if (!ed || ed.id !== installId) { const dc = i.draftContent || {}; const sections = structuredClone(dc.sections || []); ed = { id: installId, home: sections, sections, header: structuredClone(dc.header || { announceText: '', announceHref: '', links: [] }), footer: structuredClone(dc.footer || { about: '', note: '', links: [] }), pages: structuredClone(dc.pages || []), cur: 'home', sel: sections.length ? 0 : -1, undo: [], redo: [], saved: '', device: 'desktop', snapped: false }; ed.saved = edJson(); }
  const w = canWrite();
  const types = Object.entries(sectionLabel).map(([t, l]) => '<option value="' + t + '">' + l + '</option>').join('');
  const unpublished = !state.store.published ? '<div class="notice te-note">Your store is switched off, so the preview may show “not open yet”. Turn it on under Online store to see it here.</div>' : '';
  return head(esc(i.themeName), 'Design your home page sections and see them live. Nothing goes public until you review and publish.', '<span id="te-actions" class="te-actions">' + edBarHtml() + '</span>', ['builder', 'Theme']) + unpublished +
    '<div class="te"><aside class="panel te-left"><div class="panel-title"><h2>Sections</h2></div><div class="panel-body"><div id="te-list" class="te-list">' + edListHtml() + '</div>' +
    (w ? '<div class="te-add"><select id="te-add-type" aria-label="Section type">' + types + '</select>' + button('Add section', 'te-add', 'primary') + '</div>' : '') +
    '</div></aside>' +
    '<div class="te-mid"><div class="te-bar"><label>Edit<span id="te-page-wrap">' + edPageSelect() + '</span></label>' + (w ? '<span id="te-page-tools">' + edPageTools() + '</span>' : '') + '<div class="seg" role="group" aria-label="Device">' +
    ['desktop', 'tablet', 'mobile'].map((d) => '<button type="button" class="btn compact' + (ed.device === d ? ' primary' : '') + '" data-action="te-device:' + d + '">' + d[0].toUpperCase() + d.slice(1) + '</button>').join('') + '</div></div>' +
    '<div class="te-stage"><iframe id="te-frame" class="te-frame ' + ed.device + '" src="/store.html?preview=draft&shop=' + encodeURIComponent(state.tenant?.slug || '') + '#/" title="Live preview of your store"></iframe></div></div>' +
    '<aside class="panel te-right" id="te-right">' + edRightHtml() + '</aside></div>';
}
function edHandle(a, key) {
  if (!ed) return false;
  if (a === 'te-select') { ed.sel = Number(key); ed.snapped = false; edRefresh('lr', true); return true; }
  if (a === 'te-device') { ed.device = key; const f = $('#te-frame'); if (f) f.className = 'te-frame ' + key; document.querySelectorAll('[data-action^="te-device:"]').forEach((b) => b.classList.toggle('primary', b.dataset.action === 'te-device:' + key)); return true; }
  if (!canWrite()) return false;
  if (a === 'te-addpage') {
    if (ed.pages.length >= 8) return true;
    const t = PAGE_TEMPLATES[$('#te-add-page-tpl')?.value || 'blank'] || PAGE_TEMPLATES.blank; const kind = $('#te-add-page-tpl')?.value || 'blank';
    edSnapshot(); let slug = pageSlug(t[0]); let n = 2; const base = slug; while (ed.pages.some((p) => p.slug === slug)) slug = base + '-' + n++;
    ed.pages.push({ slug, title: t[0], template: kind, sections: t[1].map((x) => ({ id: uid(), type: x.type, props: { ...x.props } })) });
    ed.cur = 'p:' + (ed.pages.length - 1); edBind(); ed.sel = 0; ed.snapped = true; edRefresh('lrbp'); return true;
  }
  if (a === 'te-rmpage') { const p = edCurPage(); if (!p || !confirm('Remove the page "' + p.title + '"?')) return true; edSnapshot(); ed.pages.splice(Number(ed.cur.slice(2)), 1); ed.cur = 'home'; edBind(); ed.sel = ed.sections.length ? 0 : -1; ed.snapped = true; edRefresh('lrbp'); return true; }
  if (a === 'te-add') { const type = $('#te-add-type')?.value || 'text'; edSnapshot(); ed.sections.push({ id: uid(), type, props: { ...(SECTION_DEFAULTS[type] || {}) } }); ed.sel = ed.sections.length - 1; ed.snapped = true; edRefresh('lrb', true); return true; }
  if (a === 'te-remove') { if (ed.sel < 0) return true; edSnapshot(); ed.sections.splice(ed.sel, 1); ed.sel = Math.min(ed.sel, ed.sections.length - 1); ed.snapped = true; edRefresh('lrb'); return true; }
  if (a === 'te-up' || a === 'te-down') { const to = ed.sel + (a === 'te-up' ? -1 : 1); if (!ed.sections[to]) return true; edSnapshot(); const [x] = ed.sections.splice(ed.sel, 1); ed.sections.splice(to, 0, x); ed.sel = to; ed.snapped = true; edRefresh('lrb', true); return true; }
  if (a === 'te-undo' || a === 'te-redo') { const from = a === 'te-undo' ? ed.undo : ed.redo, to = a === 'te-undo' ? ed.redo : ed.undo; if (!from.length) return true; to.push(edJson()); edApply(JSON.parse(from.pop())); ed.sel = Math.min(ed.sel, ed.sections.length - 1); ed.snapped = true; edRefresh('lrbp'); return true; }
  return false;
}
function edPicked(v) { ed.cur = v; edBind(); ed.sel = ed.sections.length && (v === 'home' || v.startsWith('p:')) ? 0 : -1; ed.snapped = false; edRefresh('lrbp'); }
function edChromeInput(target) {
  if (target.matches && target.matches('[data-chrome-pick]')) { const f = target.closest('form'), ta = f?.querySelector('textarea[name=links]'); if (ta && target.value) { ta.value = (ta.value.trim() ? ta.value.replace(/\s+$/, '') + '\n' : '') + target.value; target.value = ''; ta.dispatchEvent(new Event('input', { bubbles: true })); } return true; }
  const form = target.closest('form[data-form="te-chrome"], form[data-form="te-page"]'); if (!form || !ed || !canWrite()) return false;
  if (!ed.snapped) { edSnapshot(); ed.snapped = true; }
  const d = Object.fromEntries(new FormData(form));
  if (form.dataset.form === 'te-page') { const p = edCurPage(); if (!p) return true; p.title = String(d.title || '').slice(0, 60); p.slug = pageSlug(d.slug || d.title); const o = $('#te-page-wrap'); if (o) o.innerHTML = edPageSelect(); }
  else if (form.dataset.kind === 'header') ed.header = { announceText: String(d.announceText || ''), announceHref: String(d.announceHref || ''), links: parseLinks(d.links, 8) };
  else ed.footer = { about: String(d.about || ''), note: String(d.note || ''), links: parseLinks(d.links, 12), columns: parseColumns(d.columns) };
  const b = $('#te-actions'); if (b) b.innerHTML = edBarHtml();
  edPost(); return true;
}
function edInput(target) {
  const form = target.closest('form[data-form="te-section"]'); if (!form || !ed || ed.sel < 0 || !canWrite()) return false;
  if (!ed.snapped) { edSnapshot(); ed.snapped = true; }
  ed.sections[ed.sel] = { ...ed.sections[ed.sel], props: Object.fromEntries(new FormData(form)) };
  const el = $('#te-list'); if (el) el.innerHTML = edListHtml();
  const b = $('#te-actions'); if (b) { const html = edBarHtml(); if (b.dataset.html !== html) { b.dataset.html = html; b.innerHTML = html; } }
  edPost(); return true;
}
async function edSave() {
  const i = state.installs.find((x) => x.id === ed.id); if (!i) return;
  const content = { ...(i.draftContent || {}), sections: ed.home, header: ed.header, footer: ed.footer, pages: ed.pages };
  await api('sfx_theme_customize_save', { p_install_id: ed.id, p_content: content });
  i.draftContent = content; ed.saved = edJson(); edRefresh('b');
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
    panel('Checkout rules', body(canWrite() ? editForm('checkout-rules', '', (() => { const r = state.checkout.rules || { fields: {}, payments: {}, limits: {} };
      return select('Email at checkout', 'email', [['optional', 'Optional'], ['required', 'Required']], r.fields.email || 'optional') + select('Second address line', 'address2', [['optional', 'Show'], ['hidden', 'Hide']], r.fields.address2 || 'optional') + select('Order note', 'note', [['optional', 'Show'], ['hidden', 'Hide']], r.fields.note || 'optional') +
        select('Cash on delivery', 'cod', [['yes', 'Allowed'], ['no', 'Not allowed']], r.payments.cod === false ? 'no' : 'yes') + select('Online payment', 'online', [['yes', 'Allowed'], ['no', 'Not allowed']], r.payments.online === false ? 'no' : 'yes') +
        input('Cash on delivery only up to (Rs, 0 = no limit)', 'codMax', r.payments.codMax || 0, 'number', 'min="0" step="1"') + input('Minimum order (Rs, 0 = none)', 'minOrder', r.limits.minOrder || 0, 'number', 'min="0" step="1"') + input('Most items in one order (0 = no limit)', 'maxItems', r.limits.maxItems || 0, 'number', 'min="0" max="200" step="1"'); })(), 'Save rules') : '<p class="compact-copy">Only an owner or manager can edit this.</p>')) +
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
  if (id === 'store-directory') return storeDirPage();
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
    panel('Plan', body('<p class="compact-copy">' + esc(msg) + '</p>' + actions)) +
    (state.access && state.access.bills ? panel('Payments for your plan', table(['Date', 'Amount', 'Status', 'Reference'], state.access.bills.map((b) => [dateValue(b.at), money(b.amount), esc(b.status), esc(b.reference || '—')]))) : '');
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
const styleLinkOn = () => !!(state.styleLink && state.styleLink.linked);
function styleLinkButton() {
  const l = state.styleLink || {};
  if (!l.available) return '';
  return l.linked ? badge('Linked with AUZsStyle') + button('Sync now', 'style-link:sync', 'compact') : button('Link AUZsStyle', 'style-link:on');
}
function channelsPage() {
  const paid = state.orders.filter((o) => String(o.payment).toLowerCase() === 'paid');
  const sales = paid.reduce((t, o) => t + Number(o.total || 0), 0);
  const live = !!state.store.published, drafts = (state.drafts || []).length, styleOn = !!(state.features || {}).style;
  const row = (title, note, chip, meta, href, cta) => '<div class="channel-row"><div class="ch-main"><strong>' + title + '</strong>' + chip + '<small>' + note + '</small>' + (meta ? '<div class="ch-meta">' + meta + '</div>' : '') + '</div>' + (href ? '<a class="btn compact" href="' + href + '">' + cta + '</a>' : '') + '</div>';
  const m = (label, value) => '<span><i>' + label + '</i> ' + value + '</span>';
  return head('Sales channels', 'Where your store sells. Each channel shares one catalog and one set of orders.', '') +
    '<section class="summary-bar" aria-label="Channel summary">' + summaryCell('Channels live', (live ? 1 : 0) + (drafts ? 1 : 0) + (styleOn ? 1 : 0)) + summaryCell('Orders', state.orders.length) + summaryCell('Sales (paid)', money(sales)) + '</section>' +
    panel('Your channels', '<div class="channel-list">' +
      row('Online store', 'Your public storefront with theme, checkout and domain.', live ? badge('Live') : badge('Not live yet', 'warn'), m('Orders', state.orders.length) + m('Sales', money(sales)) + m('Products', state.products.filter((p) => p.status === 'Active').length), pathFor('website'), 'Manage') +
      row('Draft orders', 'Phone, in-person and manual sales you create by hand.', drafts ? badge('In use') : badge('Ready', 'neutral'), m('Open drafts', drafts), pathFor('drafts'), 'Open') +
      row('AUZsStyle shop', 'Your in-store till, online and offline. Linked, it shares one catalogue, stock, collections, tags and orders with this store.', !styleOn ? badge('Not connected', 'neutral') : styleLinkOn() ? badge('Linked') : badge('Not linked', 'warn'),
        styleOn ? (styleLinkOn() ? m('Shared products', (state.styleLink || {}).products || 0) + m('Till styles', (state.styleLink || {}).styles || 0) : m('Till styles', (state.styleLink || {}).styles || 0)) : '', '', '') +
      (styleOn && canWrite() ? '<div class="channel-row"><div class="ch-main"><small>' + (styleLinkOn() ? 'Edits in either place show in both. An online order also appears in AUZsStyle, and a till sale updates online stock.' : 'Link them to use AUZsStyle as the point of sale for this online store.') + '</small></div>' +
        (styleLinkOn() ? button('Sync now', 'style-link:sync', 'compact') + button('Unlink', 'style-link:off', 'compact danger') : button('Link AUZsStyle', 'style-link:on', 'primary')) + '<a class="btn compact" href="https://auzsstyle.auzslab.in/style.html" data-handoff="1">Open AUZsStyle</a></div>' : '') +
    '</div>') +
    panel('Add a channel', body('<p class="compact-copy">More ways to sell, such as WhatsApp ordering and marketplaces, are not available yet. We will list them here when they are ready.</p>'));
}
function apiPanels() {
  const a = state.access || {}; const out = [];
  if (a.keys) {
    out.push(panel('API keys', body('<p class="compact-copy">Let another program read your orders, products and stock. Keys can only read, and only your own shop. Read the list at <code>/storefront-api/v1/orders</code>, <code>/products</code> and <code>/inventory</code> with the header <code>Authorization: Bearer your-key</code>.</p>' +
      table(['Name', 'Starts with', 'Created', 'Last used', ''], a.keys.map((k) => [esc(k.name), '<code>' + esc(k.prefix) + '…</code>', dateValue(k.createdAt), k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString('en-IN') : 'Never', k.revoked ? badge('Revoked', 'warn') : (canWrite() ? button('Revoke', 'apikey-revoke:' + k.id, 'compact danger') : '')])) + (canWrite() ? button('Create a key', 'apikey-new', 'primary') : '')), ''));
  }
  if (a.hooks) {
    const st = (h) => !h.active ? badge('Off', 'neutral') : h.lastStatus === 'failing' ? badge('Failing', 'warn') : h.lastStatus === 'ok' ? badge('Working') : badge('Waiting for the first event', 'neutral');
    out.push(panel('Webhooks', body('<p class="compact-copy">Tell another system the moment something happens in your store. We send a signed message to your https address. If it does not answer, we try again several times over about 15 hours.</p>' +
      (canWrite() ? button('Add a webhook', 'webhook-new', 'primary') : '') +
      table(['Address', 'Events', 'Status', 'Waiting', 'Failed (7 days)', ''], (a.hooks.hooks || []).map((h) => ['<code style="word-break:break-all">' + esc(h.url) + '</code>', esc((h.events || []).join(', ')), st(h), h.pending, h.failed,
        button('Deliveries', 'webhook-log:' + h.id, 'compact') + (canWrite() ? button('Send a test', 'webhook-test:' + h.id, 'compact') + button(h.active ? 'Turn off' : 'Turn on', 'webhook-set:' + h.id + ':' + (h.active ? 'off' : 'on'), 'compact') + button('Remove', 'webhook-delete:' + h.id, 'compact danger') : '')])))));
  }
  if (a.route) {
    const r = a.route; const label = { not_started: 'Not set up', pending: 'Waiting for details', needs_info: 'Needs more information', active: 'Active', suspended: 'Paused' }[r.status] || r.status;
    out.push(panel('Payouts through AUZslab', body('<p class="compact-copy">Status: ' + badge(label, r.status === 'active' ? '' : 'neutral') + (r.bankLast4 ? ' · Bank account ending ' + esc(r.bankLast4) : '') + '</p>' +
      '<p class="compact-copy">Paid so far ' + money(r.settled) + ' · On the way ' + money(r.pending) + '. Payouts through AUZslab start when AUZslab switches them on for your store. Until then, connect your own Razorpay under Payments.</p>' +
      table(['Order', 'Amount', 'Fee', 'You receive', 'Status'], (a.settlements || []).map((x) => [esc(x.order || '—'), money(x.gross), money(x.fee), money(x.net), esc(x.status)])), '')));
  }
  return out.join('');
}
function appsPage() {
  const pl = state.plan || {}; const planLabel = { trial: 'Free trial', active: 'Active', paused: 'Paused', cancelled: 'Cancelled' }[pl.plan_status] || pl.plan_status || 'Active';
  const f = state.features || {}; const doms = (state.domains || []);
  const row = (name, note, chip, href, cta) => '<div class="channel-row"><div class="ch-main"><strong>' + name + '</strong>' + chip + '<small>' + note + '</small></div>' + (href ? '<a class="btn compact" href="' + href + '">' + cta + '</a>' : '') + '</div>';
  const connected = [
    row('Online payments (Razorpay)', 'Card, UPI and net banking go straight to your own Razorpay account. Cash on delivery always works.', state.store.razorpayConnected ? badge('Connected') : badge('Not connected', 'neutral'), pathFor('checkout'), 'Manage'),
    row('Domain', 'Your store address and any domain you already own.', doms.length ? badge(doms.length + ' connected') : badge('Using your AUZslab address', 'neutral'), pathFor('domains'), 'Manage'),
    row('AUZsStyle shop', 'In-store billing, stock and tags sharing one catalogue with this store.', !f.style ? badge('Not on your plan', 'neutral') : styleLinkOn() ? badge('Linked') : badge('Not linked', 'warn'), pathFor('channels'), 'Manage'),
    row('Visitor analytics', 'Anonymous visits, bag and checkout steps recorded by your store. No third-party tracker.', badge('On'), pathFor('analytics'), 'View'),
  ].join('');
  return head('Apps and plans', 'Your plan, and the services connected to your store.', '', ['settings', 'Settings']) +
    panel('Your plan', body('<div class="stack">' + badge(planLabel, pl.plan_status === 'active' || !pl.plan_status ? '' : 'warn') + '<p class="compact-copy">' + (pl.trial_ends_at && pl.plan_status === 'trial' ? 'Your free trial ends on ' + esc(dateValue(pl.trial_ends_at)) + '. ' : '') + 'Pay, renew or ask for help under Billing and renewals.</p>' + wl('Billing and renewals', 'billing') + '</div>')) +
    panel('Connected services', '<div class="channel-list">' + connected + '</div>') +
    (appLinks().length ? panel('Other AUZslab apps for this business', '<div class="switch-apps">' + appLinks().map(([n, d, u, ic]) => '<a class="switch-app" href="' + esc(u) + '" data-handoff="1">' + icon(ic) + '<span><strong>' + esc(n) + '</strong><small>' + esc(d) + '</small></span></a>').join('') + '</div>') : '') +
    apiPanels() +
    panel('Third-party apps', body('<p class="compact-copy">An app marketplace is not available. Every service above is built in and works without installing anything.</p>'));
}
const noAccess = (t) => head(t, 'Your role does not include this.', '', ['settings', 'Settings']) + panel('Not available', body('<p class="compact-copy">Ask the store owner for the settings permission to see this page.</p>'));
function accessPage(id) {
  const a = state.access; if (!a) return head('Loading', '', '');
  if (id === 'activity') {
    if (!a.audit) return noAccess('Activity log');
    return head('Activity log', 'Refunds, store credit, tax, checkout, shipping, discounts and restored versions, with who did them.', '', ['settings', 'Settings']) +
      panel('Recent activity', table(['When', 'Who', 'What', 'Details'], a.audit.map((x) => [new Date(x.at).toLocaleString('en-IN'), esc(x.who), esc(x.action), esc(Object.entries(x.detail || {}).map(([k, v]) => k + ': ' + v).join(' · '))])));
  }
  if (id === 'staff-security') {
    if (!a.staff) return noAccess('Staff security');
    const weak = a.staff.filter((x) => !x.twoFactor && x.role !== 'cashier');
    return head('Staff security', 'Who can open your store admin, and how well their sign-in is protected.', '', ['settings', 'Settings']) +
      (weak.length ? panel('Needs attention', body('<p class="compact-copy">' + weak.length + ' owner or manager account(s) do not use two-step sign-in. Ask them to turn it on in their AUZslab account.</p>')) : '') +
      panel('People with access', table(['Name', 'Role', 'Two-step sign-in', 'Last seen', 'Active sessions', 'Login'], a.staff.map((x) => [esc(x.name || '—'), esc(x.roleName || x.role), x.twoFactor ? badge('On') : badge('Off', 'warn'), x.lastSeen ? new Date(x.lastSeen).toLocaleString('en-IN') : '—', x.sessions, x.loginOff ? badge('Turned off', 'warn') : badge('Allowed')])));
  }
  if (id === 'messages') return head('Customer messages', 'WhatsApp messages sent to your customers from your store and apps. Phone numbers are hidden except the last four digits.', '', ['settings', 'Settings']) +
    panel('Recent messages', table(['When', 'To', 'Message', 'Status', 'Problem'], (a.messages || []).map((m) => [new Date(m.at).toLocaleString('en-IN'), esc(m.to), esc(m.template), esc(m.status), esc(m.error || '')])));
  return '';
}
function management(id) {
  if (['activity', 'staff-security', 'messages'].includes(id)) return accessPage(id);
  if (id === 'apps') return appsPage();
  if (id === 'policies') return policiesPage();
  if (id === 'privacy-settings') return privacySettingsPage();
  if (id === 'roles') return rolesPage();
  if (id === 'settings') return businessSettings();
  if (id === 'billing') return billingPage();
  if (id === 'channels') return channelsPage();
  if (id === 'switch-apps') return head('Switch apps', 'Open another AUZslab app for this business. You stay signed in.', '', ['settings', 'Settings']) + panel('', '<div class="switch-apps">' + appLinks().map(([n, d, u, ic]) => '<a class="switch-app" href="' + esc(u) + '" data-handoff="1">' + icon(ic) + '<span><strong>' + esc(n) + '</strong><small>' + esc(d) + '</small></span></a>').join('') + '</div>');
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
function customersList() {
  const o = lb.customers, q = o.q.trim().toLowerCase();
  const list = (state.customers || []).filter((c) => !q || [c.name, c.phone, c.email].some((v) => String(v || '').toLowerCase().includes(q)));
  list.sort(o.sort === 'orders' ? (a, b) => b.orderCount - a.orderCount : o.sort === 'spend' ? (a, b) => b.lifetimeSpend - a.lifetimeSpend : o.sort === 'recent' ? (a, b) => cmp(b.lastOrderAt || '', a.lastOrderAt || '') : (a, b) => cmp((a.name || '').toLowerCase(), (b.name || '').toLowerCase()));
  const rows = list.map((c) => [
    esc(c.name), esc(c.phone || '—'), esc(c.email || '—'), c.orderCount, money(c.lifetimeSpend), dateValue(c.lastOrderAt),
    (String(c.id).startsWith('order:') ? '' : button('Details', 'customer-detail:' + c.id, 'compact')) + (c.manual && canWrite() ? button('Edit', 'customer-edit:' + c.id, 'compact') + button('Delete', 'customer-delete:' + c.id, 'compact danger') : (canWrite() ? button('Save as customer', 'customer-adopt:' + encodeURIComponent(c.phone || ''), 'compact') : '')),
  ]);
  return table(['Name', 'Phone', 'Email', 'Orders', 'Total spent', 'Last order', ''], rows);
}
function customersPage() {
  const o = lb.customers;
  return head('Customers', 'People who ordered from your store, plus customers you add by hand.', canWrite() ? button('Add customer', 'customer-new', 'primary') : '') + tabs('customers', [['customers', 'Customers'], ['segments', 'Segments'], ['companies', 'Companies']]) +
    panel('All customers', '<div class="filters"><input id="cl-query" type="search" aria-label="Search customers" placeholder="Search name, phone or email" value="' + esc(o.q) + '">' + sortSel('cl-sort', [['name', 'Name A to Z'], ['orders', 'Most orders'], ['spend', 'Highest spend'], ['recent', 'Latest order']], o.sort) + '</div><div id="customers-results">' + customersList() + '</div>');
}
function customerForm(c) {
  return editForm('customer-record', c?.id, input('Name', 'name', c?.name || '', 'text', 'required maxlength="160"') + input('Phone', 'phone', c?.phone || '', 'tel', 'maxlength="20"') +
    input('Email', 'email', c?.email || '', 'email', 'maxlength="160"') + area('Notes', 'notes', c?.notes || '', 'maxlength="2000"'));
}

// ---------- Discounts ----------
const discountValueLabel = (d) => (d.automatic ? 'Automatic · ' : '') + (d.kind === 'percent' ? Number(d.value) + '% off' : d.kind === 'free_shipping' ? 'Free shipping' : d.kind === 'buy_x_get_y' ? 'Buy ' + d.buyQty + ' get ' + d.getQty + (Number(d.getPercent) < 100 ? ' at ' + Number(d.getPercent) + '% off' : ' free') : 'Rs ' + Number(d.value) + ' off') + (d.productIds && d.productIds.length ? ' (chosen product)' : '');
function discountsPage() {
  const rows = (state.discounts || []).map((d) => [
    '<strong>' + esc(d.code) + '</strong>', discountValueLabel(d), d.minOrder != null ? money(d.minOrder) : '—', d.expiresAt ? dateValue(d.expiresAt) : 'No expiry',
    (d.usedCount ? '<a href="#" data-action="discount-orders:' + esc(d.code) + '">' + d.usedCount + '</a>' : '0') + (d.usageLimit ? ' / ' + d.usageLimit : ''), badge(d.status === 'active' ? 'Active' : 'Archived', d.status === 'active' ? '' : 'neutral'),
    canWrite() ? button('Edit', 'discount-edit:' + d.id, 'compact') + button(d.status === 'active' ? 'Archive' : 'Activate', 'discount-toggle:' + d.id, 'compact') : '',
  ]);
  return head('Discounts', 'Codes your customers type at checkout.', canWrite() ? button('Create discount', 'discount-new', 'primary') : '') +
    panel('All discounts', table(['Code', 'Offer', 'Minimum order', 'Expires', 'Used', 'Status', ''], rows));
}
function discountForm(d) {
  const exp = d?.expiresAt ? String(d.expiresAt).slice(0, 10) : ''; const st = d?.startsAt ? String(d.startsAt).slice(0, 10) : '';
  const prods = [['', 'All products']].concat((state.products || []).map((p) => [p.id, p.name]));
  return editForm('discount-record', d?.id, input('Code or name', 'code', d?.code || '', 'text', 'required maxlength="30"') +
    select('Type', 'kind', [['percent', 'Percentage off'], ['flat', 'Flat amount off (Rs)'], ['free_shipping', 'Free shipping'], ['buy_x_get_y', 'Buy X get Y']], d?.kind || 'percent') +
    input('Value (percent or Rs, not needed for free shipping or Buy X get Y)', 'value', d?.value ?? '', 'number', 'min="0" step="0.01"') +
    input('Buy this many (Buy X get Y)', 'buyQty', d?.buyQty ?? '', 'number', 'min="1" step="1"') + input('Get this many (Buy X get Y)', 'getQty', d?.getQty ?? '', 'number', 'min="1" step="1"') +
    input('Gift discount percent (100 = free)', 'getPercent', d?.getPercent ?? 100, 'number', 'min="1" max="100" step="1"') +
    select('Applies to', 'productId', prods, (d?.productIds || [])[0] || '') +
    select('How customers get it', 'automatic', [['no', 'They type the code'], ['yes', 'Applied automatically (no code needed)']], d?.automatic ? 'yes' : 'no') +
    input('Minimum order (Rs, optional)', 'minOrder', d?.minOrder ?? '', 'number', 'min="0" step="0.01"') +
    input('Starts on (optional)', 'startsAt', st, 'date') + input('Expires on (optional)', 'expiresAt', exp, 'date') +
    input('Total uses allowed (optional)', 'usageLimit', d?.usageLimit ?? '', 'number', 'min="1" step="1"') + input('Uses per customer (optional)', 'perCustomerLimit', d?.perCustomerLimit ?? '', 'number', 'min="1" step="1"') +
    select('First order only', 'firstOrderOnly', [['no', 'Any customer'], ['yes', 'Only a customer\'s first order']], d?.firstOrderOnly ? 'yes' : 'no'));
}

// ---------- Inventory, Transfers, Categories ----------
const moveLabel = (m) => m.reason === 'transfer' ? 'Moved ' + m.qty + ' from ' + esc(m.from) + ' to ' + esc(m.to) : m.reason === 'cancel_return' ? 'Returned to stock (cancelled order)' : (m.delta > 0 ? 'Added ' : 'Removed ') + Math.abs(m.delta);
const movesTable = (moves) => table(['When', 'Product', 'What happened', 'Note'], moves.slice(0, 25).map((m) => [dateValue(m.at), esc(m.product + (m.variant && m.variant !== 'Default' ? ' · ' + m.variant : '')), moveLabel(m), esc(m.note || '')]));
function inventoryPage() {
  const rows = (state.inventory || []).map((v) => [
    (v.productId ? '<a href="' + pathFor('products/' + encodeURIComponent(v.productId)) + '">' + esc(v.product) + '</a>' : esc(v.product)), esc(v.variant), esc(v.sku || '—'), '<span class="' + (v.online <= 0 ? 'text-danger' : v.online < 5 ? 'text-warn' : '') + '">' + v.online + '</span>',
    v.unavailable || 0, v.committed || 0, v.onHand ?? v.online, v.cost == null ? '<span class="muted">Not set</span>' : money(v.cost), v.elsewhere,
    canWrite() ? button('Adjust', 'stock-adjust:' + v.variantId, 'compact') + button('Details', 'stock-details:' + v.variantId, 'compact') : '',
  ]);
  const buf = (state.checkout && state.checkout.stockBuffer) || 0;
  return head('Inventory', 'Available stock can be sold now. Committed is held for orders not shipped yet; unavailable is set aside.', canWrite() ? button('Stock buffer: ' + buf, 'stock-buffer') : '') + tabs('inventory', productTabs) +
    panel('Stock levels', table(['Product', 'Variant', 'SKU', 'Available', 'Unavailable', 'Committed', 'On hand', 'Cost', 'Other locations', ''], rows)) +
    panel('Recent stock changes', movesTable(state.stockMoves || []));
}
function stockDetailsForm(v) {
  return editForm('stock-details', v.variantId, '<p class="compact-copy wide">' + esc(v.product + (v.variant !== 'Default' ? ' · ' + v.variant : '')) + ': ' + v.online + ' available, ' + (v.unavailable || 0) + ' unavailable, ' + (v.committed || 0) + ' committed.</p>' +
    input('Cost per unit (leave empty if unknown)', 'cost', v.cost == null ? '' : v.cost, 'number', 'min="0" step="0.01"') +
    select('Needs shipping', 'needsShipping', [['yes', 'Yes, it is a physical product'], ['no', 'No, nothing to ship']], v.needsShipping === false ? 'no' : 'yes') +
    select('Set units aside', 'move', [['none', 'No change'], ['set', 'Move to unavailable'], ['release', 'Release back to available']], 'none') +
    input('How many units', 'units', '', 'number', 'min="0" step="1"') +
    select('Reason', 'reason', [['damaged', 'Damaged'], ['quality_hold', 'Quality hold'], ['safety_stock', 'Safety stock'], ['other', 'Other']], 'damaged'), 'Save');
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
  const rows = (state.drafts || []).map((d) => [esc(d.customer.name || '—'), (d.lines || []).reduce((s, l) => s + l.qty, 0) + ' items', money(d.total) + (d.discount > 0 || d.shipping > 0 ? '<small> (' + [d.discount > 0 ? 'discount ' + money(d.discount) : '', d.shipping > 0 ? 'shipping ' + money(d.shipping) : ''].filter(Boolean).join(', ') + ')</small>' : '') + (d.payLater ? ' ' + badge('Pay later', 'warn') : ''), d.status === 'open' ? badge('Open', 'neutral') : (d.orderId ? '<a href="' + pathFor('orders/' + d.orderId) + '">' + badge('Converted') + '</a>' : badge('Converted')),
    d.status === 'open' && canWrite() ? button('Create order', 'draft-convert:' + d.id, 'compact primary') + button('Delete', 'draft-delete:' + d.id, 'compact danger') : '']);
  return head('Draft orders', 'Create an order by hand for a phone or in-person sale.', canWrite() ? button('Create draft', 'draft-new', 'primary') : '') + tabs('drafts', orderTabs) + panel('All drafts', table(['Customer', 'Items', 'Total', 'Status', ''], rows));
}
function draftForm() {
  const opts = [['', 'Choose a product']].concat(variantOptions());
  const slot = (i) => '<div class="field-grid wide">' + select('Product ' + (i + 1), 'v' + i, opts, '') + input('Quantity', 'q' + i, i === 0 ? '1' : '', 'number', 'min="1" step="1"') + input('Price (optional)', 'p' + i, '', 'number', 'min="0" step="0.01"') + '</div>';
  return editForm('draft-record', '', input('Customer name', 'name', '', 'text', 'required maxlength="120"') + input('Phone', 'phone', '', 'tel') + input('Address', 'address') + input('City', 'city') + input('PIN code', 'pin') +
    slot(0) + slot(1) + slot(2) +
    '<p class="compact-copy wide">Leave the price empty to use the catalogue price. A custom item has no stock.</p>' +
    '<div class="field-grid wide">' + input('Custom item name', 'cname', '', 'text', 'maxlength="120"') + input('Custom item price (Rs)', 'cprice', '', 'number', 'min="0" step="0.01"') + input('Custom item quantity', 'cq', '', 'number', 'min="0" step="1"') + '</div>' +
    '<div class="field-grid wide">' + select('Discount', 'dkind', [['', 'No discount'], ['percent', 'Percentage off'], ['flat', 'Flat amount off (Rs)']], '') + input('Discount value', 'dval', '', 'number', 'min="0" step="0.01"') + input('Discount reason', 'dnote', '', 'text', 'maxlength="120"') + '</div>' +
    '<div class="field-grid wide">' + input('Shipping name', 'slabel', '', 'text', 'maxlength="60" placeholder="Local delivery"') + input('Shipping charge (Rs, 0 = free)', 'sfee', '0', 'number', 'min="0" step="0.01"') + select('Payment', 'payterms', [['now', 'Collect when the order is created'], ['later', 'Payment due later']], 'now') + '</div>' +
    area('Note', 'note', '', 'maxlength="1000"'), 'Save draft');
}
const RETURN_NEXT = { requested: [['approved', 'Approve', 'primary'], ['rejected', 'Reject', '']], approved: [['received', 'Mark received', 'primary']], received: [['refunded', 'Refund', 'primary']] };
function returnsPage() {
  const rows = (state.returns || []).map((r) => [link('#' + esc(r.orderNumber), pathFor('orders/' + r.orderId), 'compact'), (r.lines || []).map((l) => l.qty + ' × ' + esc(l.name)).join(', '), esc(r.reason || '—'), money(r.value),
    badge({ requested: 'Requested', approved: 'Approved', rejected: 'Rejected', received: 'Received', refunded: 'Refunded' }[r.status], ['rejected'].includes(r.status) ? 'neutral' : ''),
    canWrite() ? (RETURN_NEXT[r.status] || []).map(([s, label, kind]) => button(label, 'return-set:' + r.id + ':' + s, 'compact ' + kind)).join('') : '']);
  return head('Returns', 'Return requests for fulfilled orders. Units go back in stock when you mark them received.', '') + tabs('returns', orderTabs) + panel('All returns', table(['Order', 'Items', 'Reason', 'Value', 'Status', ''], rows));
}
function returnForm(order) {
  const rows = (order.lines || []).map((l, i) => '<input type="hidden" name="vid' + i + '" value="' + esc(l.variantId) + '">' + input(esc(l.name) + (l.label && l.label !== 'Default' ? ' · ' + esc(l.label) : '') + ' (ordered ' + l.qty + ')', 'rq' + i, '', 'number', 'min="0" max="' + l.qty + '" step="1"')).join('');
  return editForm('return-record', order.id, rows + area('Reason', 'reason', '', 'maxlength="500"'), 'Create return');
}
function storeDirPage() {
  const list = state.storeDir || [];
  const cards = list.map((x) => '<div class="channel-row"><div class="ch-main"><strong>' + esc(x.name) + '</strong>' + (x.featured ? badge('Featured') : '') + '<small>' + esc([x.address, x.city].filter(Boolean).join(', ') || 'No address yet') + (x.phone ? ' · ' + esc(x.phone) : '') + (x.hours ? ' · ' + esc(x.hours) : '') + '</small></div>' +
    (canWrite() ? button('Edit', 'dir-edit:' + x.id, 'compact') + button('Delete', 'dir-delete:' + x.id, 'compact danger') : '') + '</div>').join('');
  const url = storeLink('stores');
  return head('Stores', 'The shops, studios or pickup points customers can visit. They appear on your online store\'s Our stores page.', canWrite() ? button('Add store', 'dir-new', 'primary') : '', ['website', 'Online store']) + tabs('store-directory', websiteTabs) +
    panel('Your stores', list.length ? '<div class="channel-list">' + cards + '</div>' + (url ? '<p class="compact-copy">' + link('View Our stores page', url) + '</p>' : '') : body('<p class="compact-copy">No stores yet. Add your first one. Until then the Our stores page shows your business address if you have one.</p>'));
}
function storeDirForm(x) {
  const v = x || {};
  return editForm('dir-record', v.id, input('Store name', 'name', v.name || '', 'text', 'required maxlength="80"') + input('Address', 'address', v.address || '', 'text', 'maxlength="300"') + input('City', 'city', v.city || '', 'text', 'maxlength="80"') +
    input('Phone', 'phone', v.phone || '', 'tel', 'maxlength="30"') + input('Opening hours', 'hours', v.hours || '', 'text', 'maxlength="200" placeholder="Mon to Sat, 10am to 8pm"') + input('Map link (https://...)', 'map', v.map || '', 'url') +
    '<input type="hidden" name="photo" value="' + esc(v.photo || '') + '"><label class="wide">Photo<input type="file" accept="image/*"></label>' + '<label class="inline"><input type="checkbox" name="featured" value="1"' + (v.featured ? ' checked' : '') + '> Show first</label>', 'Save store');
}
function taxesPage() {
  const t = state.checkout.tax || { rate: 0, inclusive: true, gstin: '', label: 'GST' }; const on = Number(t.rate) > 0;
  const sample = 1000, tx = on ? (t.inclusive ? sample * t.rate / (100 + Number(t.rate)) : sample * t.rate / 100) : 0;
  return head('Taxes', 'GST on orders from your online store.', '') + tabs('taxes', orderTabs) +
    panel('GST', body(canWrite() ? editForm('tax-settings', '', input('GST rate in % (0 = do not charge or show tax)', 'rate', t.rate ?? 0, 'number', 'min="0" max="28" step="0.1"') + input('Label shown to customers', 'label', t.label || 'GST', 'text', 'maxlength="20"') +
      select('Your prices', 'inclusive', ['Include tax', 'Do not include tax (tax is added at checkout)'], t.inclusive === false ? 'Do not include tax (tax is added at checkout)' : 'Include tax') + input('Your GST number (optional, 15 characters)', 'gstin', t.gstin || '', 'text', 'maxlength="15" placeholder="08ABCDE1234F1Z5"') + input('Your state (splits tax into CGST + SGST inside your state, IGST outside)', 'sellerState', t.sellerState || '', 'text', 'maxlength="60" placeholder="Rajasthan"') +
      '<p class="compact-copy">' + (on ? 'On an order of ₹1,000 the ' + esc(t.label || 'GST') + ' is about ₹' + tx.toFixed(2) + (t.inclusive === false ? ', added to the total.' : ', already inside the price.') : 'Tax is off. Orders show no tax line.') + ' Tax applies to the goods after any discount, not to shipping. The same rate is used for every product.</p>', 'Save tax settings') :
      '<p class="compact-copy">' + (on ? esc(t.label || 'GST') + ' ' + Number(t.rate) + '% ' + (t.inclusive === false ? 'added at checkout' : 'included in prices') : 'Tax is off.') + '</p>'));
}
function parseZones(t) {
  return String(t || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l, i) => { const [name, states, fee, freeOver] = l.split('|').map((x) => x.trim());
    if (!name || !states) throw new Error('Zone line ' + (i + 1) + ' needs a name and at least one state, like: South | Kerala, Tamil Nadu | 60 | 800');
    return { name, states: states.split(',').map((x) => x.trim()).filter(Boolean), fee: Number(fee) || 0, freeOver: Number(freeOver) || 0 }; });
}
function shippingPage() {
  const sh = state.checkout.shipping || {};
  return head('Shipping', 'What customers pay for delivery at checkout.', '') + tabs('shipping', orderTabs) +
    panel('Delivery charge', body(canWrite() ? editForm('checkout-settings', '', input('Delivery fee (Rs)', 'fee', sh.fee ?? 0, 'number', 'min="0" step="1"') + input('Free delivery above (Rs, 0 = never)', 'freeOver', sh.freeOver ?? 0, 'number', 'min="0" step="1"') + area('Note shown to customers', 'note', sh.note || '', 'maxlength="300"') + area('Shipping zones (optional). One per line: Zone name | State, State | Fee | Free above. The customer\'s state picks the zone; any other state pays the delivery fee above.', 'zones', (sh.zones || []).map((z) => [z.name, (z.states || []).join(', '), z.fee, z.freeOver].join(' | ')).join('\n'), 'rows="4" maxlength="2000" placeholder="Rajasthan | Rajasthan | 40 | 500"'), 'Save shipping') :
      '<p class="compact-copy">Fee Rs ' + Number(sh.fee || 0) + (Number(sh.freeOver) > 0 ? ', free above Rs ' + Number(sh.freeOver) : '') + '.</p>')) +
    panel('Price tiers', body(canWrite() ? editForm('shipping-tiers', '', area('One tier per line: order up to (Rs) | fee | label. Leave the amount empty for everything above.', 'tiers', (sh.tiers || []).map((t) => (t.upTo == null ? '' : t.upTo) + ' | ' + t.fee + ' | ' + (t.label || '')).join('\n'), 'rows="4" placeholder="500 | 40 | Small order\n | 20 | Big order"') +
      '<p class="compact-copy">A zone for the customer\'s state wins first, then these tiers, then the delivery fee above. Customers see the reason with their shipping charge.</p>', 'Save tiers') : '<p class="compact-copy">' + ((sh.tiers || []).length ? (sh.tiers || []).map((t) => esc(t.label) + ': Rs ' + t.fee).join(', ') : 'No tiers.') + '</p>'));
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
const contentTabs = [['content', 'Overview'], ['pages', 'Pages and menus'], ['blog', 'Blog'], ['redirects', 'Redirects'], ['versions', 'Saved versions'], ['files', 'Files'], ['data', 'Custom data'], ['custom-fields', 'Typed fields']];
const rowActions = (kind, id) => canWrite() ? button('Edit', kind + '-edit:' + id, 'compact') + button('Delete', kind + '-delete:' + id, 'compact danger') : '';
const storeLink = (path) => state.store.published && state.tenant?.slug ? 'https://' + state.tenant.slug + '.auzslab.in/store.html#/' + path : '';

function pageForm(pg) {
  const v = pg || { status: 'Hidden' };
  return editForm('page-record', pg?.id, input('Page title', 'name', v.name || '', 'text', 'required maxlength="120"') + input('URL handle', 'slug', v.slug || '', 'text', 'pattern="[a-z0-9]+(?:-[a-z0-9]+)*" maxlength="60" placeholder="about-us"') +
    richArea('Content', 'content', v.content || '', '') + input('Cover image URL', 'image', v.image || '', 'url') +
    select('Visibility', 'status', ['Hidden', 'Visible', 'Scheduled'], v.status || 'Hidden') + input('Publish on (for Scheduled)', 'publishAt', v.publishAt || '', 'datetime-local') +
    input('Search title', 'seoTitle', v.seoTitle || '', 'text', 'maxlength="70"') + area('Search description', 'seoDescription', v.seoDescription || '', 'rows="2" maxlength="160"'), 'Save page');
}
let pgf = { q: '', status: '' };
const pageState = (x) => x.status === 'Scheduled' ? (x.publishAt && new Date(x.publishAt) > new Date() ? 'Scheduled' : x.publishAt ? 'Visible' : 'Hidden') : x.status;
function pagesList() {
  const q = pgf.q.trim().toLowerCase();
  const pages = cfgList('pages').filter((x) => (!q || (x.name + ' ' + x.slug).toLowerCase().includes(q)) && (!pgf.status || pageState(x) === pgf.status));
  const rows = pages.map((x) => [(canWrite() ? '<input type="checkbox" class="pg-sel" value="' + esc(x.id) + '" aria-label="Select ' + esc(x.name) + '">' : ''), esc(x.name), esc('/' + x.slug),
    badge(pageState(x), pageState(x) === 'Visible' ? '' : 'neutral') + (pageState(x) === 'Scheduled' ? '<small> goes live ' + esc(dateValue(x.publishAt)) + '</small>' : ''), x.updatedOn ? dateValue(x.updatedOn) : '—',
    (pageState(x) === 'Visible' && storeLink('page/' + x.slug) ? link('View', storeLink('page/' + x.slug), 'compact') : '') + (canWrite() ? button('Copy', 'page-copy:' + x.id, 'compact') : '') + rowActions('page', x.id)]);
  return table(['', 'Page', 'URL', 'Visibility', 'Updated', ''], rows) + (pages.length ? '' : '<p class="compact-copy">' + (cfgList('pages').length ? 'No pages match your search.' : 'No pages yet. Add one and set it to Visible to publish it.') + '</p>');
}
function storePagesPage(bare) {
  const bulk = canWrite() ? '<div class="actions">' + button('Select all', 'pages-all', 'compact') + button('Make visible', 'pages-bulk:Visible', 'compact') + button('Hide', 'pages-bulk:Hidden', 'compact') + button('Delete selected', 'pages-bulk:delete', 'compact danger') + '</div>' : '';
  return (bare ? '' : head('Pages', 'Pages customers see on your online store, such as About, FAQs or shipping details.', canWrite() ? button('Add page', 'page-new', 'primary') : '', ['website', 'Online store'])) +
    panel('Store pages', '<div class="filters"><input id="pg-query" type="search" aria-label="Search pages" placeholder="Search pages" value="' + esc(pgf.q) + '"><select id="pg-status" aria-label="Filter by visibility">' + ['', 'Visible', 'Hidden', 'Scheduled'].map((o) => '<option value="' + o + '"' + (o === pgf.status ? ' selected' : '') + '>' + (o || 'All visibility') + '</option>').join('') + '</select></div>' + bulk + '<div id="pages-results">' + pagesList() + '</div>');
}
const DEFAULT_LAYOUT = ['sales', 'orders', 'funnel', 'profit', 'inventory', 'customers', 'cohorts'];
const LAYOUT_NAMES = { sales: 'Sales', orders: 'Orders right now', funnel: 'Visitor funnel', inventory: 'Inventory', customers: 'Customers by recency and spend', profit: 'Sales and profit', cohorts: 'Customers who came back' };
let layoutDraft = null;
function layoutDialogBody() {
  const on = layoutDraft, off = Object.keys(LAYOUT_NAMES).filter((k) => !on.includes(k));
  return '<div class="stack">' + on.map((k, i) => '<div class="launch"><div class="info"><strong>' + esc(LAYOUT_NAMES[k]) + '</strong></div>' + button('Up', 'layout-move:' + k + ':up', 'compact') + button('Down', 'layout-move:' + k + ':down', 'compact') + button('Hide', 'layout-hide:' + k, 'compact danger') + '</div>').join('') +
    (off.length ? '<p class="compact-copy">Hidden cards</p>' + off.map((k) => '<div class="launch"><div class="info">' + esc(LAYOUT_NAMES[k]) + '</div>' + button('Show', 'layout-show:' + k, 'compact') + '</div>').join('') : '') +
    '<div>' + button('Save', 'layout-save', 'primary') + button('Cancel', 'close-dialog') + '</div></div>';
}
function insightsPage() {
  const r = state.insights; if (!r) return head('Insights', 'Loading your reports...', '');
  const pct = (v) => v == null ? '—' : Number(v) + '%';
  const f = r.funnel, pf = r.profit;
  const funnel = panel('Visitor funnel (last ' + f.days + ' days)', table(['Step', 'Visitors', 'From the step before'], f.steps.map((s2, i) => [esc(s2.step), s2.count, i === 0 || !f.steps[i - 1].count ? '—' : Math.round(100 * s2.count / f.steps[i - 1].count) + '%'])) +
    '<p class="compact-copy">Conversion rate: ' + pct(f.conversionRate) + ' · One-page visits: ' + pct(r.sessions.singleEventShare) + ' · ' + r.sessions.sessions + ' sessions</p>');
  const profit = panel('Sales and profit (last ' + pf.days + ' days)', table(['Measure', 'Amount'], [['Orders', pf.orders], ['Gross sales', money(pf.grossSales)], ['Discounts', money(pf.discounts)], ['Refunds', money(pf.refunds)], ['Shipping charged', money(pf.shipping)], ['Tax collected', money(pf.tax)], ['Net sales', '<strong>' + money(pf.netSales) + '</strong>'], ['Average order', pf.averageOrder == null ? '—' : money(pf.averageOrder)],
    ['Profit on items with a known cost', money(pf.profitOnKnownCost)], ['Share of sales with a known cost', pct(pf.costCoverage)]]) +
    (pf.costCoverage != null && pf.costCoverage < 100 ? '<p class="compact-copy">Profit only counts items whose cost you entered, so it is incomplete until the share above is 100%. Add costs in Inventory, Details.</p>' : ''));
  const inv = panel('Inventory (last ' + r.inventory.days + ' days)', table(['Product', 'Variant', 'Sold', 'Available', 'Sold of what was there', 'Days of stock', 'Class', 'Note'],
    (r.inventory.rows || []).slice(0, 25).map((x) => [((state.inventory || []).find((v) => v.variantId === x.variantId) || {}).productId ? '<a href="' + pathFor('products/' + encodeURIComponent((state.inventory.find((v) => v.variantId === x.variantId)).productId)) + '">' + esc(x.product) + '</a>' : esc(x.product), esc(x.variant), x.sold, x.available, pct(x.sellThrough), x.daysOfCover == null ? '—' : x.daysOfCover, x.abc, { out_of_stock: 'Out of stock', dead_stock: 'Not selling', low_cover: 'Running low' }[x.flag] || ''])) +
    '<p class="compact-copy">Stock value at cost: ' + money(r.inventory.stockValueAtCost) + (r.inventory.stockWithoutCost ? ' · ' + r.inventory.stockWithoutCost + ' item(s) in stock have no cost entered.' : '') + '</p>');
  const cust = panel('Customers by recency, frequency and spend', table(['Group', 'Customers', 'Spent'], (r.rfm.segments || []).map((x) => [esc(x.segment), x.customers, money(x.money)])));
  const coh = panel('Customers who came back', table(['First order month', 'Customers', 'Came back later'], (r.cohorts || []).map((c) => [dateValue(c.month), c.customers, (c.retention || []).slice(1).map((k) => '+' + k.monthsLater + 'm: ' + k.returned).join(' · ') || '—'])));
  const live = state.orders.filter((x) => x.status !== 'Cancelled' && !x.isTest);
  const sales = panel('Sales (last ' + pf.days + ' days)', '<div class="metrics">' + metric('Orders', pf.orders, 'Counted orders') + metric('Gross sales', money(pf.grossSales), 'Before refunds') + metric('Average order', pf.orders ? money(pf.grossSales / pf.orders) : '—', 'Per order') + '</div>');
  const ord = panel('Orders right now', '<div class="metrics">' + metric('To fulfil', live.filter((x) => x.status === 'Unfulfilled' || x.status === 'Partially fulfilled').length, 'Waiting to ship') + metric('Fulfilled', live.filter((x) => x.status === 'Fulfilled').length, 'Shipped') + metric('Cancelled', state.orders.filter((x) => x.status === 'Cancelled').length, 'Not counted in reports') + '</div>');
  const cards = { sales, orders: ord, funnel, inventory: inv, customers: cust, profit, cohorts: coh };
  const layout = (r.layout && r.layout.length ? r.layout : DEFAULT_LAYOUT).filter((k) => cards[k]);
  return head('Insights', 'Funnel, sales, profit, stock and customer reports. Cancelled and test orders are never counted.', canWrite() ? button('Choose cards', 'layout-open') : '') + layout.map((k) => cards[k]).join('');
}
function blogPage() {
  const rows = (state.blog || []).map((b) => [esc(b.title), '<code>/blog/' + esc(b.handle) + '</code>', badge(b.status === 'published' ? 'Published' : 'Draft', b.status === 'published' ? '' : 'neutral'), dateValue(b.updatedAt),
    canWrite() ? button('Edit', 'blog-edit:' + b.id, 'compact') + button('Delete', 'blog-delete:' + b.id, 'compact danger') : '']);
  return head('Blog', 'Articles for your store. Only published posts are visible to customers.', canWrite() ? button('Write a post', 'blog-new', 'primary') : '') + tabs('blog', contentTabs) + panel('Posts', table(['Title', 'Address', 'Status', 'Updated', ''], rows));
}
function blogForm(b) {
  const v = b || { status: 'draft', tags: [] };
  return editForm('blog-record', b?.id, input('Title', 'title', v.title || '', 'text', 'required maxlength="150"') + input('Address (leave empty to use the title)', 'handle', v.handle || '', 'text', 'maxlength="80"') +
    area('Short summary', 'excerpt', v.excerpt || '', 'maxlength="400"') + area('Post', 'body', v.body || '', 'rows="10" maxlength="100000"') + input('Author', 'author', v.author || '', 'text', 'maxlength="80"') +
    input('Tags (comma separated)', 'tags', (v.tags || []).join(', '), 'text') + input('Search title (up to 70)', 'seoTitle', v.seoTitle || '', 'text', 'maxlength="70"') + area('Search description (up to 320)', 'seoDescription', v.seoDescription || '', 'maxlength="320"') +
    select('Status', 'status', [['draft', 'Draft'], ['published', 'Published']], v.status || 'draft'), 'Save post');
}
function redirectsPage() {
  const rows = (state.redirects || []).map((r) => ['<code>' + esc(r.from) + '</code>', '<code>' + esc(r.to) + '</code>', badge(r.auto ? 'Automatic' : 'Yours', r.auto ? 'neutral' : ''), canWrite() ? button('Edit', 'redirect-edit:' + r.id, 'compact') + button('Delete', 'redirect-delete:' + r.id, 'compact danger') : '']);
  return head('Redirects', 'Send an old address to a new one. When you change a product, collection or post address, the old one is redirected for you.', canWrite() ? button('Add redirect', 'redirect-new', 'primary') : '') + tabs('redirects', contentTabs) + panel('All redirects', table(['From', 'To', 'Kind', ''], rows));
}
function revisionsPage() {
  const rows = (state.revisions || []).map((r) => [new Date(r.createdAt).toLocaleString('en-IN'), esc(r.note || 'Saved version'), esc(r.theme), canWrite() ? button('Restore', 'revision-restore:' + r.id, 'compact') : '']);
  return head('Saved versions', 'A copy of your store settings is saved before every change. Restore one to go back. Your current settings are saved first, so restoring can be undone.', canWrite() ? button('Save a version now', 'revision-save', 'primary') : '') + tabs('versions', contentTabs) + panel('Versions', table(['When', 'Note', 'Theme', ''], rows));
}
function customFieldsPage() {
  const defs = state.metaDefs || []; const objs = state.metaObjectDefs || [];
  return head('Typed fields', 'Fields with a type (text, number, yes/no, link, date) that are checked when saved. Mark one "show on the storefront" to let your store display it.', canWrite() ? button('Add field', 'metafield-new', 'primary') + button('Add record type', 'metaobject-new') : '') + tabs('custom-fields', contentTabs) +
    panel('Fields', table(['Applies to', 'Name', 'Key', 'Type', 'On storefront', ''], defs.map((d) => [esc(d.ownerType), esc(d.label), '<code>' + esc(d.key) + '</code>', esc(d.valueType), d.storefront ? 'Yes' : 'No', canWrite() ? button('Delete', 'metafield-delete:' + d.id, 'compact danger') : '']))) +
    panel('Record types', table(['Type', 'Name', 'Fields', 'Records'], objs.map((o) => [esc(o.type), esc(o.label), (o.fields || []).map((f) => esc(f.label)).join(', '), o.count])));
}
function contentPage(id) {
  if (id === 'blog') return blogPage();
  if (id === 'redirects') return redirectsPage();
  if (id === 'versions') return revisionsPage();
  if (id === 'custom-fields') return customFieldsPage();
  const pages = cfgList('pages'), files = cfgList('files'), fields = cfgList('customFields');
  if (id === 'pages') return head('Pages and menus', 'Create storefront pages. Visible pages appear on your online store.', canWrite() ? button('Add page', 'page-new', 'primary') : '') + tabs(id, contentTabs) + storePagesPage(true);
  if (id === 'files') return head('Files', 'Images and documents you reuse across pages. Paste the link of an image or file already uploaded.', canWrite() ? button('Add file', 'file-new', 'primary') : '') + tabs(id, contentTabs) +
    panel('Media library', table(['File', 'Type', 'Link', ''], files.map((f) => [esc(f.name), esc(f.type || '—'), f.url ? '<a href="' + esc(f.url) + '" target="_blank" rel="noopener">Open</a>' : '—', rowActions('file', f.id)])));
  if (id === 'data') return head('Custom data', 'Define extra details you want to keep for products, customers or orders.', canWrite() ? button('Add field', 'field-new', 'primary') : '') + tabs(id, contentTabs) +
    panel('Field definitions', table(['Name', 'Applies to', 'Value type', ''], fields.map((f) => [esc(f.name), esc(f.appliesTo), esc(f.valueType), rowActions('field', f.id)])));
  return head('Content', 'Manage the pages, files and custom data that feed your site.') + tabs('content', contentTabs) +
    '<div class="metrics">' + metric('Pages', pages.length, pages.filter((x) => x.status === 'Visible').length + ' visible') + metric('Files', files.length, 'Media library') + metric('Custom fields', fields.length, 'Definitions') + '</div>';
}
function fileForm(f) { return editForm('file-record', f?.id, input('Name', 'name', f?.name || '', 'text', 'required maxlength="120"') + select('Type', 'type', ['Image', 'Document', 'Video', 'Other'], f?.type || 'Image') + input('Link (https://...)', 'url', f?.url || '', 'url', 'required')); }
function fieldForm(f) { return editForm('field-record', f?.id, input('Field name', 'name', f?.name || '', 'text', 'required maxlength="80"') + select('Applies to', 'appliesTo', ['Products', 'Customers', 'Orders', 'Collections'], f?.appliesTo || 'Products') + select('Value type', 'valueType', ['Text', 'Number', 'Yes or no', 'Date', 'List'], f?.valueType || 'Text'), 'Save field'); }
function marketForm(m) { return editForm('market-record', m?.id, input('Market name', 'name', m?.name || '', 'text', 'required maxlength="80"') + input('Region (country or area)', 'region', m?.region || 'India', 'text', 'maxlength="80"') + select('Currency', 'currency', ['INR', 'USD', 'EUR', 'GBP', 'AED', 'SGD'], m?.currency || 'INR') + select('Language', 'language', ['English', 'Hindi'], m?.language || 'English') + select('Status', 'status', ['Active', 'Draft'], m?.status || 'Draft'), 'Save market'); }
function marketsPage() {
  const ms = cfgList('markets'); const hi = !!(state.languages || {}).hindi;
  return head('Markets', 'Plan where your store sells and which currency and language each market shows. Checkout currently charges in your store currency.', canWrite() ? button('Add market', 'market-new', 'primary') : '') +
    panel('Store languages', body('<p class="compact-copy">Your product names, descriptions and pages stay exactly as you wrote them. Turning Hindi on adds a हिंदी / English button on your store that translates the shop\'s own labels (bag, checkout, buttons). The Hindi wording should be checked by a Hindi speaker.</p>' + (canWrite() ? editForm('languages-settings', '', select('Hindi on your store', 'hindi', ['Off', 'On'], hi ? 'On' : 'Off'), 'Save language') : '<p class="compact-copy">Hindi is ' + (hi ? 'on' : 'off') + '.</p>'))) +
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
  if (m[1] === 'page') { rec.slug = slugify(rec.slug || rec.name); rec.updatedOn = new Date().toISOString().slice(0, 10); if (rec.status === 'Scheduled' && !rec.publishAt) throw new Error('Choose the date and time this page goes live.'); if (!rec.slug) throw new Error('Enter a page title.'); if (items.some((x) => x.slug === rec.slug && x.id !== rid)) throw new Error('Another page already uses that URL handle.'); }
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
// Finer keys (db/427). They only narrow a role that can edit the store: a role with "edit" and nothing said about a key keeps it, except Staff and security.
const FINE_PERMS = [['sfx_orders', 'Orders and shipments'], ['sfx_products', 'Products and stock'], ['sfx_customers', 'Customers and store credit'], ['sfx_marketing', 'Discounts and campaigns'],
  ['sfx_content', 'Blog, pages and redirects'], ['sfx_settings', 'Store settings, tax and checkout'], ['sfx_refunds', 'Refunds'], ['sfx_staff', 'Staff, roles and security']];
const fineAllowed = (perms, k) => perms && perms.sfx_manage ? (k in perms ? !!perms[k] : k !== 'sfx_staff') : false;
function rolesPage() {
  const roles = state.roles || [], staff = (state.staffList || []).filter((p) => p.role !== 'owner');
  const roleRows = roles.map((r) => [esc(r.name), STORE_PERMS.filter(([k]) => r.permissions && r.permissions[k]).map(([, l]) => esc(l)).concat(r.permissions && r.permissions.sfx_manage ? FINE_PERMS.filter(([k]) => fineAllowed(r.permissions, k)).map(([, l]) => '&nbsp;&nbsp;· ' + esc(l)) : []).join('<br>') || 'No store access', canWrite() ? button('Delete', 'role-delete:' + r.id, 'compact danger') : '']);
  const opts = (p) => '<option value=""' + (!p.role_id && p.role !== 'manager' ? ' selected' : '') + '>Staff (view only)</option><option value="builtin:manager"' + (!p.role_id && p.role === 'manager' ? ' selected' : '') + '>Manager</option>' + roles.map((r) => '<option value="' + esc(r.id) + '"' + (p.role_id === r.id ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('');
  const staffRows = staff.map((p) => [esc(p.email || p.username || 'Staff'), canWrite() ? '<select data-role-assign="' + esc(p.id) + '" aria-label="Role for ' + esc(p.email || p.username) + '">' + opts(p) + '</select>' : esc(p.role)]);
  const form = canWrite() ? panel('New role', body(editForm('role-record', '', input('Role name', 'name', '', 'text', 'required maxlength="60"') + STORE_PERMS.map(([k, l]) => '<label class="inline wide"><input type="checkbox" name="' + k + '" value="1"' + (k === 'sfx_view' ? ' checked' : '') + '> ' + esc(l) + '</label>').join('') + '<p class="compact-copy wide">When a role can edit the store, choose what it can touch:</p>' + FINE_PERMS.map(([k, l]) => '<label class="inline wide"><input type="checkbox" name="' + k + '" value="1"' + (k === 'sfx_staff' ? '' : ' checked') + '> ' + esc(l) + '</label>').join(''), 'Create role'))) : '';
  return head('Roles', 'Choose what each person on your team can do in the store. The owner always has full access.', '', ['team', 'Staff and access']) + tabs('roles', [['team', 'Staff'], ['roles', 'Roles'], ['locations', 'Locations']]) +
    panel('Roles', table(['Role', 'Store access', ''], roleRows)) + form + panel('Who has which role', table(['Person', 'Role'], staffRows));
}
async function roleSubmit(key, data) {
  if (key !== 'role-record') return false;
  const name = (data.name || '').trim(); if (!name) throw new Error('Enter a role name.');
  const permissions = {}; STORE_PERMS.forEach(([k]) => { if (data[k]) permissions[k] = true; });
  if (permissions.sfx_manage) FINE_PERMS.forEach(([k]) => { permissions[k] = !!data[k]; });
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
function scopeLine() {
  const el = $('#bulk-scope'); if (!el) return;
  const total = Number(el.dataset.total || 0), n = document.querySelectorAll('input[data-bulk]:checked').length;
  el.innerHTML = n === 0 ? '' : n >= total ? 'All ' + total + ' product' + (total === 1 ? '' : 's') + ' in this list are selected. Changes apply to these ' + total + '.' : n + ' of ' + total + ' selected. <button type="button" class="btn compact" data-action="bulk-all">Select all ' + total + ' in this list</button>';
}
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

// ---------- Settings: Store policies and Customer privacy (saved in the store config, shown on the public store, db/394) ----------
const POLICY_DEFAULTS = { shipping: 'We ship across India. Orders are packed within 1 to 2 working days and usually arrive in 3 to 7 days.', returns: 'You can ask for a return or exchange within the period we agree when you order. Items must be unused with tags attached.', privacy: 'We use your details only to process your order and to contact you about it.', terms: 'By placing an order you agree to pay the price shown and to give us correct delivery details.' };
function policiesPage() {
  const pol = state.store?.config?.policies || {}; const dis = canWrite() ? '' : 'disabled';
  const link = (k) => storeLink('policy/' + k);
  const fields = [['shipping', 'Shipping policy'], ['returns', 'Returns and exchanges'], ['privacy', 'Privacy policy'], ['terms', 'Terms of service']].map(([k, label]) => '<div class="wide">' + area(label + (link(k) ? '' : ''), k, pol[k] || '', 'rows="5" maxlength="8000" placeholder="' + esc(POLICY_DEFAULTS[k]) + '" ' + dis) + '</div>').join('');
  return head('Store policies', 'Text shown on your public store pages. Leave a box empty to show the standard wording (grey example).', '', ['settings', 'Settings']) +
    panel('Policies', body(canWrite() ? editForm('policies-save', '', fields, 'Save policies') : '<p class="compact-copy">Only an owner or manager can change policies.</p>')) +
    (state.store.published && state.tenant?.slug ? panel('Preview', body('<div class="stack">' + ['shipping', 'returns', 'privacy', 'terms'].map((k) => link2(k)).join('') + '</div>')) : '');
}
const link2 = (k) => '<a class="btn compact" href="' + esc(storeLink('policy/' + k)) + '" target="_blank" rel="noopener">View ' + k + ' page</a>';
function privacySettingsPage() {
  const pr = state.store?.config?.privacy || {}; const dis = canWrite() ? '' : 'disabled';
  return head('Customer privacy', 'Tell customers who to contact about their data. The address is added to your public Privacy policy page.', '', ['settings', 'Settings']) +
    panel('Data requests', body(canWrite() ? editForm('privacy-save', '', input('Contact email for privacy questions', 'contactEmail', pr.contactEmail || '', 'email', 'maxlength="160" ' + dis) + area('How long you keep order records (shown to staff only)', 'retention', pr.retention || '', 'rows="3" maxlength="500"'), 'Save') : '<p class="compact-copy">Only an owner or manager can change this.</p>')) +
    panel('What AUZslab stores', body('<p class="compact-copy">Customer names, phone numbers and addresses are kept with the orders they placed, for your records and for delivery. Cookie and marketing-consent banners are not part of the store yet.</p>'));
}
async function settingsSubmit(key, data) {
  if (key === 'policies-save') {
    const policies = {}; ['shipping', 'returns', 'privacy', 'terms'].forEach((k) => { if ((data[k] || '').trim()) policies[k] = data[k].trim(); });
    await saveObj({ policies }); save('Policies saved.'); rerender(true); return true;
  }
  if (key === 'privacy-save') {
    await saveObj({ privacy: { contactEmail: (data.contactEmail || '').trim(), retention: (data.retention || '').trim() } }); save('Saved.'); rerender(true); return true;
  }
  return false;
}
async function saveObj(patch) { const ctx = await api('sfx_store_save', { p: patch }); applyContext(ctx); }

// ---------- Home extras: acquisition, app shortcuts ----------

// ---------- Theme library actions: new from a starter, import a ZIP package, rename, duplicate, delete (db/395) ----------
const ZIP_LIMIT = 2 * 1024 * 1024, MANIFEST_LIMIT = 256 * 1024, MANIFEST_NAME = 'auzslab-theme.json';
// Reads auzslab-theme.json from the root of a ZIP in the browser. Only that one file is read; nothing is run or stored.
async function readThemeZip(file) {
  if (!file) throw new Error('Choose a .zip file.');
  if (file.size > ZIP_LIMIT) throw new Error('The package is larger than 2 MB.');
  const buf = new DataView(await file.arrayBuffer()), u8 = new Uint8Array(buf.buffer);
  let eof = -1; for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) { if (buf.getUint32(i, true) === 0x06054b50) { eof = i; break; } }
  if (eof < 0) throw new Error('This is not a ZIP file.');
  if (buf.getUint16(eof + 10, true) !== 1) throw new Error('The ZIP must contain only ' + MANIFEST_NAME + ' at its root.');
  const cd = buf.getUint32(eof + 16, true); if (cd + 46 > eof || buf.getUint32(cd, true) !== 0x02014b50) throw new Error('Invalid ZIP directory.');
  const nameLen = buf.getUint16(cd + 28, true), name = new TextDecoder().decode(u8.subarray(cd + 46, cd + 46 + nameLen));
  if (name !== MANIFEST_NAME) throw new Error('Expected ' + MANIFEST_NAME + ' at the root of the ZIP.');
  const flags = buf.getUint16(cd + 8, true), method = buf.getUint16(cd + 10, true), csize = buf.getUint32(cd + 20, true), usize = buf.getUint32(cd + 24, true), local = buf.getUint32(cd + 42, true);
  if ((flags & 1) || usize > MANIFEST_LIMIT || local + 30 > cd || buf.getUint32(local, true) !== 0x04034b50) throw new Error('Invalid or oversized theme manifest.');
  const start = local + 30 + buf.getUint16(local + 26, true) + buf.getUint16(local + 28, true);
  if (start + csize > cd || ![0, 8].includes(method)) throw new Error('Unsupported ZIP compression.');
  let bytes = u8.subarray(start, start + csize);
  if (method === 8) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open ZIP files. Use a current Chrome, Edge or Safari.');
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader(); const parts = []; let total = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > MANIFEST_LIMIT) { reader.cancel(); throw new Error('Invalid or oversized theme manifest.'); } parts.push(value); }
    bytes = new Uint8Array(total); let o = 0; parts.forEach((p) => { bytes.set(p, o); o += p.length; });
  }
  if (bytes.length !== usize) throw new Error('Invalid theme manifest size.');
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch (e) { throw new Error(MANIFEST_NAME + ' is not valid JSON.'); }
}
function themeNewForm() {
  return editForm('theme-create', '', input('Theme name', 'name', '', 'text', 'required maxlength="80"') + select('Start from', 'starter', [['blank', 'Blank (one banner)'], ['shop', 'Shop (announcement, banner, story)'], ['landing', 'Landing page (banner, picture, button)']], 'blank') +
    select('Based on', 'base', [['minimal', 'Minimal'], ['classic', 'Classic']], 'minimal'), 'Create theme');
}
const THEME_EXAMPLE = '{\n  "version": 1,\n  "name": "My theme",\n  "base": "minimal",\n  "accent": "#800020",\n  "sections": [\n    { "type": "hero", "props": { "heading": "Hello", "sub": "Welcome", "cta": "Shop", "href": "/" } },\n    { "type": "text", "props": { "heading": "About", "body": "Our story" } }\n  ]\n}';
function themeImportForm() {
  return '<div class="stack"><p class="compact-copy">Choose a .zip that holds one file named <code>auzslab-theme.json</code> at its root (up to 2 MB). Sections allowed: hero, text, image, button, announcement, booking. Links must start with https:// or /. Nothing in the package can run code. The theme is added as an unpublished draft.</p>' +
    '<pre class="compact-copy" style="overflow:auto;max-height:180px">' + esc(THEME_EXAMPLE) + '</pre>' +
    '<label>Theme package<input id="theme-zip" type="file" accept=".zip,application/zip"></label><div class="actions">' + button('Import theme', 'theme-import-go', 'primary') + button('Cancel', 'close-dialog') + '</div></div>';
}
async function themeAction(a, key) {
  if (a === 'theme-new') { dialog('New theme', themeNewForm()); return true; }
  if (a === 'theme-import') { dialog('Import a theme package', themeImportForm()); return true; }
  if (a === 'theme-import-go') {
    try {
      const pkg = await readThemeZip(document.getElementById('theme-zip')?.files?.[0]);
      const r = await api('sfx_theme_import', { p: pkg }); await Promise.all([refreshInstalls(), refreshMarketplace()]); save('Theme imported as a draft.'); close(); location.hash = '/builder/' + r.installId;
    } catch (e) { flash(e.message); }
    return true;
  }
  if (a === 'theme-rename') { const i = state.installs.find((x) => x.id === key); dialog('Rename theme', editForm('theme-rename', key, input('Name', 'name', i?.themeName || '', 'text', 'required maxlength="80"'), 'Rename')); return true; }
  if (a === 'theme-duplicate') { try { await api('sfx_theme_install_duplicate', { p_install_id: key }); await refreshInstalls(); save('Theme duplicated.'); rerender(true); } catch (e) { flash(e.message); } return true; }
  if (a === 'theme-delete') { if (!confirm('Delete this theme? Its draft is lost. Your live store is not affected.')) return true; try { await api('sfx_theme_install_delete', { p_install_id: key }); await refreshInstalls(); save('Theme deleted.'); rerender(true); } catch (e) { flash(e.message); } return true; }
  return false;
}
async function themeSubmit(key, rid, data) {
  if (key === 'theme-create') { const r = await api('sfx_theme_install_create', { p: { name: data.name, starter: data.starter, base: data.base } }); await refreshInstalls(); save('Theme created.'); close(); location.hash = '/builder/' + r.installId; return true; }
  if (key === 'theme-rename') { await api('sfx_theme_install_rename', { p_install_id: rid, p_name: data.name }); await refreshInstalls(); save('Renamed.'); close(); rerender(true); return true; }
  return false;
}

// ---------- Phone Settings: a grouped list of every settings page (desktop keeps the Business profile form) ----------
function settingsList() {
  const href = (id) => id === 'settings' ? pathFor('settings') + '?p=1' : pathFor(id + (settingsRoutes.has(id) ? '' : '?via=settings'));
  const row = ([id, label, glyph]) => '<a class="sl-row" href="' + href(id) + '" data-label="' + esc(label.toLowerCase()) + '"><span class="sl-ico">' + icon(glyph) + '</span><span class="sl-name">' + esc(label) + '</span><span class="sl-go" aria-hidden="true">›</span></a>';
  const groups = settingsGroups.map((g) => '<section class="sl-group"><h2>' + esc(g.label) + '</h2><div class="sl-card">' + g.items.map(row).join('') + '</div></section>').join('');
  const account = '<section class="sl-group"><h2>Account</h2><div class="sl-card"><a class="sl-row" href="#" data-action="sign-out" data-label="sign out logout"><span class="sl-ico">' + icon('logout') + '</span><span class="sl-name">Sign out</span><span class="sl-go" aria-hidden="true">›</span></a></div></section>';
  return '<div class="settings-list"><label class="sl-search">' + icon('search') + '<input id="settings-query" type="search" placeholder="Search settings" autocomplete="off" aria-label="Search settings"></label>' + groups + account + '<p class="sl-empty" id="sl-empty" hidden>No settings match.</p></div>';
}
function settingsFilter(q) {
  q = q.toLowerCase().trim(); let any = false;
  document.querySelectorAll('.settings-list .sl-group').forEach((g) => { let n = 0; g.querySelectorAll('.sl-row').forEach((r) => { const ok = !q || r.dataset.label.includes(q); r.hidden = !ok; if (ok) n++; }); g.hidden = !n; if (n) any = true; });
  const e = document.getElementById('sl-empty'); if (e) e.hidden = any;
}

export function workspace(id, record) {
  if (['analytics', 'reports', 'live-view'].includes(id)) return analyticsPage(id, record);
  let html;
  if (id === 'home') html = home();
  else if (id === 'settings' && window.matchMedia('(max-width:900px)').matches && new URLSearchParams(location.hash.split('?')[1] || '').get('p') !== '1') html = settingsList();
  else if (id === 'orders' && record === 'new') html = orderNewPage();
  else if (id === 'orders' && record) html = orderDetail(record);
  else if (id === 'returns' && record) html = returnDetail(record);
  else if (orderTabs.some(([k]) => k === id)) html = ordersPage(id);
  else if (id === 'products' && record) html = productDetail(record);
  else if (id === 'collections' && record) html = collectionDetail(record);
  else if (productTabs.some(([k]) => k === id)) html = productsPage(id);
  else if (id === 'builder' && record) html = editorPage(record);
  else if (['website', 'templates', 'builder', 'domains', 'checkout', 'store-pages', 'store-directory'].includes(id)) html = websitePage(id);
  else if (id === 'insights') html = insightsPage();
  else if (id === 'customers') html = customersPage();
  else if (id === 'discounts') html = discountsPage();
  else if (id === 'segments') html = segmentsPage();
  else if (id === 'companies') html = companiesPage();
  else if (id === 'growth') html = growthPage();
  else if (['content', 'pages', 'files', 'data', 'blog', 'redirects', 'versions', 'custom-fields'].includes(id)) html = contentPage(id);
  else if (id === 'markets') html = marketsPage();
  else html = management(id);
  return { html, dispatch: (type, target, event, key, detail) => dispatch(id, type, target, event, key, detail) };
}

// ---------- actions ----------
function formError(form, message) {
  if (!form || !form.querySelector) return;
  let box = form.querySelector('.form-error');
  if (!box) { box = document.createElement('div'); box.className = 'form-error'; box.setAttribute('role', 'alert'); box.style.cssText = 'color:#b42318;background:#fef3f2;border:1px solid #fda29b;border-radius:8px;padding:8px 10px;margin:0 0 10px;font-size:13px'; form.prepend(box); }
  box.textContent = message;
  const bad = [...form.querySelectorAll('input[required],select[required],textarea[required]')].find((el) => !String(el.value || '').trim());
  const target = bad || form.querySelector('input:not([type=hidden]),select,textarea');
  if (bad) bad.setAttribute('aria-invalid', 'true');
  if (target && typeof target.focus === 'function') target.focus();
}
async function withBusy(fn) { try { await fn(); } catch (e) { flash(e.message); } }

async function dispatch(id, type, target, event, clickKey, clickDetail) {
  if (type === 'input' && target.id === 'settings-query') { settingsFilter(target.value); return; }
  if (type === 'change' && target.matches && target.matches('input[data-bulk]')) scopeLine();
  if (type === 'change' && target.id === 'report-range') { reportRange = target.value; rerender(); return; }
  if (id === 'builder' && sd && (type === 'input' || type === 'change') && target.closest && target.closest('#studs-form')) { studsRead(); return; }
  if (id === 'builder' && ed && type === 'change' && target.id === 'te-page') { edPicked(target.value); return; }
  if (id === 'builder' && ed && type === 'input' && target.closest && target.closest('form[data-form="te-chrome"], form[data-form="te-page"]')) { edChromeInput(target); return; }
  if (id === 'builder' && ed && (type === 'input' || type === 'change') && target.closest && target.closest('form[data-form="te-section"]')) { if (type === 'input') edInput(target); return; }
  if (id === 'domains' && domainDispatch(type, target)) return;
  if (type === 'change' && /^pf-(status|category|tag|stock|sort)$/.test(target.id)) { pf[target.id.slice(3)] = target.value; $('#table-results').innerHTML = productsList($('#table-query')?.value || ''); return; }
  if ((type === 'input' || type === 'change') && target.closest && target.closest('.product-record') && ['name', 'handle', 'seoTitle', 'seoDescription', 'description'].includes(target.name)) { const f = target.closest('form'); if (target.name === 'description') { const rp = f.querySelector('[data-rich-preview]'); if (rp) rp.innerHTML = target.value ? richHtml(target.value) : '<p class="compact-copy">A preview of your formatting shows here.</p>'; } const el = f.querySelector('[data-seo-preview]'); if (!el) return; if (el) el.innerHTML = seoPreview(f.elements.seoTitle.value || f.elements.name.value, f.elements.handle.value, f.elements.seoDescription.value || f.elements.description.value); }
  if ((type === 'input' || type === 'change') && target.closest && target.closest('form[data-key="refund-record"]') && /^(rq_\d+|rship)$/.test(target.name || '')) {
    const f = target.closest('form'); let sum = 0;
    f.querySelectorAll('input[data-price]').forEach((el) => { if (el.type === 'checkbox') { if (el.checked) sum += Number(el.dataset.price); } else sum += (Number(el.value) || 0) * Number(el.dataset.price); });
    f.elements.amount.value = sum > 0 ? sum.toFixed(2) : '';
  }
  if ((type === 'input' || type === 'change') && target.closest && target.closest('form[data-key="order-edit"]')) {
    const f = target.closest('form'), pv = f.querySelector('#edit-preview'); let sub = 0;
    f.querySelectorAll('input[data-price]').forEach((el) => { sub += (Number(el.value) || 0) * Number(el.dataset.price); });
    const add = (f.elements.addv.value || '').split('|'); sub += (Number(f.elements.addq.value) || 0) * (Number(add[1]) || 0);
    sub += (Number(f.elements.cq.value) || 0) * (Number(f.elements.cprice.value) || 0);
    pv.textContent = 'New total: ' + money(Math.max(Number(pv.dataset.total) + sub - Number(pv.dataset.oldsub), 0));
  }
  if ((type === 'input' || type === 'change') && target.closest && target.closest('#co-form')) {
    if (target.id === 'co-pick') { if (target.value) { const v = coVariants().find((x) => x.id === target.value); if (v) { coSync(); const ex = co.lines.find((l) => l.id === v.id); if (ex) ex.qty = Number(ex.qty) + 1; else co.lines.push({ id: v.id, name: v.name, label: v.label, price: v.price, qty: 1 }); coRedraw(); } } return; }
    coSync(); const tb = document.getElementById('co-totals'); if (tb) tb.innerHTML = coTotalsHtml(); if (type === 'change' && target.name === 'dkind') coRedraw(); return;
  }
  if (type === 'submit' && target.id === 'co-form') return;
  if ((type === 'input' || type === 'change') && /^ol-(query|sort)$/.test(target.id)) { const k = target.id.slice(3); lb.orders[k === 'query' ? 'q' : k] = target.value; $('#orders-results').innerHTML = ordersList(); return; }
  if ((type === 'input' || type === 'change') && /^cl-(query|sort)$/.test(target.id)) { const k = target.id.slice(3); lb.customers[k === 'query' ? 'q' : k] = target.value; $('#customers-results').innerHTML = customersList(); return; }
  if ((type === 'input' || type === 'change') && /^pg-(query|status)$/.test(target.id)) { pgf[target.id === 'pg-query' ? 'q' : 'status'] = target.value; const el = $('#pages-results'); if (el) el.innerHTML = pagesList(); return; }
  if (type === 'change' && target.matches && target.matches('[data-linkpick]')) { const ta = target.closest('.rich')?.querySelector('textarea'); if (ta && target.value) { const st = ta.selectionStart, en = ta.selectionEnd, label = ta.value.slice(st, en) || target.options[target.selectedIndex].text, ins = '[' + label + '](' + target.value + ')'; ta.value = ta.value.slice(0, st) + ins + ta.value.slice(en); ta.dispatchEvent(new Event('input', { bubbles: true })); } target.value = ''; return; }
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
        const p = await api('sfx_product_save', { p_id: rid, p: { name: data.name, description: data.description, price: data.price, compareAt: data.compareAt, category: data.category2 ?? data.category, handle: data.handle || undefined, status: (event?.submitter?.value === 'draft' ? 'draft' : data.status.toLowerCase()) } });
        await api('sfx_product_extra_save', { p_id: rid || p.id, p: { cost: data.cost, hsn: data.hsn, vendor: data.vendor, type: data.type, weight: data.weight, origin: data.origin, seoTitle: data.seoTitle, seoDescription: data.seoDescription, custom: readCustomFields(data) } });
        const pid = rid || p.id;
        await api('sfx_product_set_tags', { p_id: pid, p_tags: data.tags || '' });
        await api('sfx_product_set_collections', { p_id: pid, p_collections: values.getAll('collections').join(',') });
        await Promise.all([refreshProducts(), refreshCategories(), refreshMemberships(), refreshCollections()]); save(rid ? 'Product updated.' : 'Product created.'); close();
        if (!rid) location.hash = '/products/' + p.id + (event?.submitter?.value === 'draft' ? '?tab=media' : ''); else rerender();
      } else if (key === 'product-media') {
        const fd = new FormData(target); const had = JSON.parse(data.existing || '[]'); const drop = new Set(fd.getAll('remove').map(Number));
        let list = had.filter((_, i) => !drop.has(i)); const mainSrc = had[Number(data.mainIndex || 0)];
        if (data.imageUrl && data.imageUrl.trim()) list.push(data.imageUrl.trim());
        const files = [...(target.querySelector('input[type=file]')?.files || [])];
        if (list.length + files.length > 6) { flash('Keep up to six images.'); return; }
        for (const f of files) list.push(await uploadImage(f));
        list = [...new Set(list)];
        if (mainSrc && list.includes(mainSrc)) list = [mainSrc, ...list.filter((x) => x !== mainSrc)];
        if (list.length > 6) { flash('Keep up to six images.'); return; }
        await api('sfx_product_save', { p_id: rid, p: { ...keepFields(state.products.find((p) => p.id === rid)), images: list } });
        await refreshProducts(); save('Images saved.'); rerender();
      } else if (key === 'product-variants') {
        const variants = collectVariants(target);
        if (!variants.length) { flash('Add at least one variant.'); return; }
        const dup = (k) => { const seen = new Set(); for (const v of variants) { const x = String(v[k] || '').trim().toLowerCase(); if (!x) continue; if (seen.has(x)) return v[k]; seen.add(x); } return null; };
        const dl = dup('label'), ds = dup('sku'), db = dup('barcode');
        if (dl) { flash('Two variants are both called "' + dl + '".'); return; } if (ds) { flash('The SKU "' + ds + '" is used twice.'); return; } if (db) { flash('The barcode "' + db + '" is used twice.'); return; }
        const options = readOptions(target);
        const p = state.products.find((x) => x.id === rid);
        await api('sfx_product_save', { p_id: rid, p: { ...keepFields(p), variants } });
        await api('sfx_product_extra_save', { p_id: rid, p: { options } });
        await refreshProducts(); save('Variants saved.'); rerender();
      } else if (key === 'collection-record') {
        if (!data.name?.trim()) { flash('Enter a collection title.'); return; }
        const c = await api('sfx_collection_save', { p_id: rid, p: { name: data.name, description: data.description, image: data.image, productIds: values.getAll('productIds') } });
        await refreshCollections(); save(rid ? 'Collection updated.' : 'Collection created.'); close();
        if (!rid) location.hash = '/collections/' + c.id; else rerender();
      } else if (key === 'order-fulfill') {
        const o = state.orders.find((x) => x.id === rid);
        const items = (o?.remaining || []).filter((r) => r.qty > 0).map((r) => ({ variantId: r.variantId, qty: Number(data['q_' + r.variantId] ?? r.qty) })).filter((r) => r.qty > 0);
        if (!items.length) { flash('Choose at least one item to ship.'); return; }
        await api('sfx_shipment_create', { p_order: rid, p: { items, carrier: data.carrier || null, tracking: data.tracking || null, trackingUrl: data.trackingUrl || null, notify: values.has('notify') } });
        await refreshOrders(); save('Shipment created.'); close(); rerender();
      } else if (key === 'shipment-edit') {
        await api('sfx_shipment_update', { p_id: rid, p: { carrier: data.carrier || '', tracking: data.tracking || '', trackingUrl: data.trackingUrl || '' } });
        await refreshOrders(); save('Tracking saved.'); close(); rerender();
      } else if (key === 'credit-adjust') {
        await api('sfx_credit_adjust', { p_customer: rid, p_delta: Number(data.delta), p_note: data.note }); await refreshCustomers(); save('Store credit updated.'); close(); rerender(true);
      } else if (key === 'webhook-record') {
        const evs = ((state.access.hooks || {}).events || []).filter((e) => data['ev_' + e.replace('.', '_')]);
        const w = await api('sfx_webhook_create', { p_url: data.url, p_events: evs }); await refreshAccess(); save('Webhook added.');
        dialog('Your signing secret', '<p class="compact-copy">' + esc(w.note) + ' Check each message by signing <code>timestamp.body</code> with this secret (HMAC-SHA256) and comparing it to the <code>X-Storefront-Signature</code> header.</p><p><code style="word-break:break-all;user-select:all">' + esc(w.secret) + '</code></p>' + button('Done', 'close-dialog', 'primary')); rerender(true);
      } else if (key === 'apikey-record') {
        const k = await api('sfx_api_key_create', { p_name: data.name }); await refreshAccess(); save('Key created.');
        dialog('Your new key', '<p class="compact-copy">' + esc(k.note) + '</p><p><code style="word-break:break-all;user-select:all">' + esc(k.key) + '</code></p>' + button('Done', 'close-dialog', 'primary')); rerender(true);
      } else if (key === 'blog-record') {
        await api('sfx_blog_save', { p_id: rid, p: { title: data.title, handle: data.handle, excerpt: data.excerpt, body: data.body, author: data.author, tags: String(data.tags || '').split(',').map((x) => x.trim()).filter(Boolean), seoTitle: data.seoTitle, seoDescription: data.seoDescription, status: data.status } });
        await refreshBlog(); save('Post saved.'); close(); rerender(true);
      } else if (key === 'redirect-record') {
        await api('sfx_redirect_save', { p_id: rid, p: { from: data.from, to: data.to } }); await refreshRedirects(); save('Redirect saved.'); close(); rerender(true);
      } else if (key === 'metafield-record') {
        await api('sfx_metafield_def_save', { p_id: null, p: { ownerType: data.ownerType, key: data.key, label: data.label, valueType: data.valueType, storefront: data.storefront === 'yes' } }); await refreshCustomFields(); save('Field added.'); close(); rerender(true);
      } else if (key === 'metaobject-record') {
        const fields = String(data.fields || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [k, label, valueType] = l.split('|').map((x) => x.trim()); return { key: k, label, valueType: valueType || 'text' }; });
        await api('sfx_metaobject_def_save', { p: { type: data.type, label: data.label, fields } }); await refreshCustomFields(); save('Record type saved.'); close(); rerender(true);
      } else if (key === 'return-receive') {
        const r = state.returns.find((x) => x.id === rid);
        await api('sfx_return_receive', { p_id: rid, p_lines: (r.lines || []).map((l, i) => ({ variantId: l.variantId, restock: data['k' + i] !== 'no' })) }); await refreshReturns(); save('Return received.'); close(); rerender(true);
      } else if (key === 'order-cancel') {
        await api('sfx_order_cancel', { p_order: rid, p: { reason: data.reason, restock: data.restock !== 'no' } }); await refreshOrders(); save('Order cancelled.'); close(); rerender(true);
      } else if (key === 'refund-record') {
        await api('sfx_refund_record', { p_order: rid, p: { amount: Number(data.amount), method: data.method, reason: data.reason } }); await refreshOrders(); save('Refund recorded.'); close(); rerender(true);
      } else if (key === 'order-edit') {
        const o = state.orders.find((x) => x.id === rid); const lines = (o.lines || []).map((l, i) => ({ index: i, qty: Number(data['q_' + i]) }));
        if (data.addv && Number(data.addq) > 0) lines.push({ variantId: data.addv.split('|')[0], qty: Number(data.addq) });
        if (data.cname && Number(data.cq) > 0) lines.push({ custom: { name: data.cname, price: Number(data.cprice) }, qty: Number(data.cq) });
        const r = await api('sfx_order_edit', { p_order: rid, p: { lines, restock: data.restock === '1' || data.restock === 'on' || data.restock === true, reason: data.reason } });
        await refreshOrders(); await refreshInventory().catch(() => {}); save(r.difference ? 'Order updated. Total changed by ' + money(r.difference) + '.' : 'Order updated.'); close(); rerender();
      } else if (key === 'order-contact' || key === 'order-address') {
        const p = key === 'order-contact' ? { name: data.name, phone: data.phone, email: data.email, updateProfile: data.updateProfile === 'yes' } : { address: data.address, city: data.city, state: data.state, pin: data.pin };
        await api('sfx_order_contact_set', { p_order: rid, p }); await refreshOrders(); save('Order updated.'); close(); rerender();
      } else if (key === 'order-comment') {
        await api('sfx_order_comment', { p_order: rid, p_text: data.text }); await refreshOrders(); save('Comment posted.'); rerender();
      } else if (key === 'order-tags') {
        await api('sfx_order_tags_set', { p_order: rid, p_tags: String(data.tags || '').split(',').map((x) => x.trim()).filter(Boolean) }); await refreshOrders(); save('Tags saved.'); close(); rerender();
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
        const startsAt = data.startsAt ? new Date(data.startsAt + 'T00:00:00').toISOString() : '';
        await api('sfx_discount_save', { p_id: rid, p: { code: data.code, kind: data.kind, value: data.value, minOrder: data.minOrder, expiresAt, startsAt, usageLimit: data.usageLimit, perCustomerLimit: data.perCustomerLimit,
          buyQty: data.buyQty, getQty: data.getQty, getPercent: data.getPercent, automatic: data.automatic === 'yes', firstOrderOnly: data.firstOrderOnly === 'yes', productIds: data.productId ? [data.productId] : [] } });
        await refreshDiscounts(); save(rid ? 'Discount updated.' : 'Discount created.'); close(); rerender(true);
      } else if (key === 'stock-details') {
        await api('sfx_variant_meta_save', { p_variant: rid, p: { cost: data.cost === '' ? '' : String(data.cost), needsShipping: data.needsShipping !== 'no' } });
        const n = Number(data.units || 0);
        if (data.move !== 'none' && n > 0) await api('sfx_stock_set_unavailable', { p_variant: rid, p_delta: data.move === 'set' ? n : -n, p_reason: data.move === 'set' ? data.reason : 'released' });
        await refreshInventory(); save('Stock details saved.'); close(); rerender(true);
      } else if (key === 'stock-buffer') {
        const n = Number(data.buffer); if (!Number.isInteger(n) || n < 0) { flash('Enter a whole number, 0 or more.'); return; }
        await api('sfx_stock_buffer_save', { p_buffer: n }); state.checkout = Object.assign({}, state.checkout, { stockBuffer: n }); save('Stock buffer saved.'); close(); rerender(true);
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
        const lines = [0, 1, 2].filter((i) => data['v' + i] && Number(data['q' + i]) > 0).map((i) => ({ variantId: data['v' + i], qty: Number(data['q' + i]), price: data['p' + i] === '' || data['p' + i] == null ? undefined : Number(data['p' + i]) }));
        if (data.cname && Number(data.cq) > 0) lines.push({ custom: { name: data.cname, price: Number(data.cprice) }, qty: Number(data.cq) });
        await api('sfx_draft_save', { p_id: rid, p: { name: data.name, phone: data.phone, address: data.address, city: data.city, pin: data.pin, note: data.note, lines,
          discount: data.dkind ? { kind: data.dkind, value: Number(data.dval) || 0, note: data.dnote } : undefined, shipping: { label: data.slabel, amount: Number(data.sfee) || 0 }, payLater: data.payterms === 'later' } });
        await refreshDrafts(); save('Draft saved.'); close(); rerender(true);
      } else if (key === 'return-record') {
        const order = state.orders.find((o) => o.id === rid); const lines = (order?.lines || []).map((l, i) => ({ variantId: data['vid' + i], qty: Number(data['rq' + i] || 0) })).filter((l) => l.qty > 0);
        await api('sfx_return_create', { p_order: rid, p_lines: lines, p_reason: data.reason }); await refreshReturns(); save('Return created.'); close(); location.hash = '/returns';
      } else if (key === 'return-refund') {
        await api('sfx_return_set', { p_id: rid, p_status: 'refunded', p_amount: Number(data.amount) }); await refreshReturns(); save('Refund recorded.'); close(); rerender(true);
      } else if (key === 'return-rzp-refund') {
        await apiPost('/payments/sfx/refund/start', { returnId: rid, amount: Number(data.amount) }); await refreshReturns(); save('Refund sent through Razorpay.'); close(); rerender(true);
      } else if (key === 'dir-record') {
        const file = target.querySelector('input[type=file]')?.files?.[0]; const photo = file ? await uploadImage(file) : (data.photo || '');
        const rec = { id: rid || undefined, name: data.name, address: data.address, city: data.city, phone: data.phone, hours: data.hours, map: data.map, photo, featured: data.featured === '1' };
        const cur = state.storeDir || []; const list = rid ? cur.map((x) => x.id === rid ? rec : x) : (rec.featured ? [rec, ...cur] : [...cur, rec]);
        await api('sfx_stores_save', { p: list }); await refreshStoreDir(); save('Store saved.'); close(); rerender(true);
      } else if (key === 'languages-settings') {
        await api('sfx_languages_save', { p: { hindi: data.hindi === 'On' } }); await refreshLanguages(); save('Language saved.'); rerender(true);
      } else if (key === 'tax-settings') {
        await api('sfx_tax_settings_save', { p: { rate: data.rate, label: data.label, gstin: data.gstin, sellerState: data.sellerState || '', inclusive: !/^Do not/.test(data.inclusive || '') } });
        await refreshCheckout(); save('Tax settings saved.'); rerender(true);
      } else if (key === 'checkout-rules') {
        await api('sfx_checkout_rules_save', { p: { fields: { email: data.email, address2: data.address2, note: data.note }, payments: { cod: data.cod !== 'no', online: data.online !== 'no', codMax: data.codMax }, limits: { minOrder: data.minOrder, maxItems: data.maxItems } } });
        await refreshCheckout(); save('Checkout rules saved.'); rerender(true);
      } else if (key === 'shipping-tiers') {
        const tiers = String(data.tiers || '').split('\n').map((l) => l.trim()).filter(Boolean).map((l, i) => { const [up, fee, label] = l.split('|').map((x) => x.trim()); if (fee === undefined || fee === '') throw new Error('Tier line ' + (i + 1) + ' needs an amount and a fee, like: 500 | 40 | Small order'); return { upTo: up === '' || /^any|rest|more/i.test(up) ? null : Number(up), fee: Number(fee), label }; });
        await api('sfx_shipping_tiers_save', { p_tiers: tiers }); await refreshCheckout(); save('Shipping tiers saved.'); rerender(true);
      } else if (key === 'checkout-settings') {
        await api('sfx_checkout_settings_save', { p: { shipping: { fee: data.fee, freeOver: data.freeOver, note: data.note, zones: parseZones(data.zones) }, abandonCapture: state.checkout.abandonCapture } });
        await refreshCheckout(); save('Shipping saved.'); rerender(true);
      } else if (key === 'bulk-apply') {
        const ids = bulkIds(); const patch = { status: data.status || undefined, category: data.category || undefined, pricePct: data.pricePct || undefined };
        const r = await api('sfx_product_bulk', { p_ids: ids, p: patch }); await refreshProducts(); save(r.updated + ' products updated.'); close(); rerender(true);
      } else if (await themeSubmit(key, rid, data)) {
        /* saved */
      } else if (await settingsSubmit(key, data)) {
        /* saved */
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
    } catch (e) { flash(e.message); formError(target, e.message); }
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
  if (a === 'ol-filter') { lb.orders.f = key; const r = $('#orders-results'); if (r) r.innerHTML = ordersList(); document.querySelectorAll('#ol-pills .pill-tab').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.action === 'ol-filter:' + key))); return; }
  if (a === 'co-custom') { coSync(); co.lines.push({ custom: true, name: '', price: 0, qty: 1 }); coRedraw(); return; }
  if (a === 'co-rm') { coSync(); co.lines.splice(Number(key), 1); coRedraw(); return; }
  if (a === 'co-save') return withBusy(async () => { const f = $('#co-form'); coSync(); if (!f.reportValidity()) return; if (!co.lines.length) { flash('Add at least one product.'); return; } await coSave(key); });
  if (a === 'discount-orders') { lb.orders.q = key || ''; location.hash = pathFor('orders').split('#')[1]; return; }
  if (a === 'customer-detail' || a === 'consent-set') return withBusy(async () => {
    if (a === 'consent-set') await api('sfx_customer_consent', { p_id: key, p_marketing: detail === 'on', p_source: 'staff' });
    const d = await api('sfx_customer_detail', { p_id: key });
    const addr = (d.addresses || []).map((x) => '<li>' + esc([x.address, x.city, x.state, x.pin].filter(Boolean).join(', ')) + (x.isDefault ? ' (default)' : '') + '</li>').join('') || '<li>No saved address.</li>';
    const moves = (d.creditMoves || []).slice(0, 6).map((m) => '<li>' + (m.delta > 0 ? '+' : '') + money(m.delta) + ' · ' + esc(m.reason) + (m.note ? ' · ' + esc(m.note) : '') + '</li>').join('') || '<li>No credit activity.</li>';
    dialog(d.name, '<div class="stack"><p class="compact-copy">' + esc(d.phone || '') + ' ' + esc(d.email || '') + '</p>' +
      '<p><strong>Marketing messages:</strong> ' + (d.acceptsMarketing ? 'Agreed' : 'Not agreed') + (d.consentAt ? ' <small>(' + new Date(d.consentAt).toLocaleDateString('en-IN') + ' · ' + esc(d.consentSource || '') + ')</small>' : '') + '</p>' +
      (canWrite() ? button(d.acceptsMarketing ? 'Record withdrawal' : 'Record agreement', 'consent-set:' + d.id + ':' + (d.acceptsMarketing ? 'off' : 'on')) : '') +
      '<p><strong>Store credit:</strong> ' + money(d.creditBalance) + '</p><ul>' + moves + '</ul>' + (canWrite() ? button('Add or remove credit', 'credit-adjust:' + d.id) : '') +
      '<p><strong>Addresses</strong></p><ul>' + addr + '</ul><p><strong>Orders</strong></p><ul>' + ((d.orders || []).map((x) => '<li><a href="' + pathFor('orders/' + x.id) + '">#' + esc(x.number) + '</a> · ' + money(x.total) + ' · ' + esc(x.status) + '</li>').join('') || '<li>No orders yet.</li>') + '</ul></div>');
  });
  if (a === 'credit-adjust') return dialog('Store credit', editForm('credit-adjust', key, input('Amount (use a minus to remove)', 'delta', '', 'number', 'required step="0.01"') + input('Note', 'note', '', 'text', 'maxlength="200"'), 'Save'));
  if (a === 'blog-new') return dialog('Write a post', blogForm(null));
  if (a === 'blog-edit') return withBusy(async () => { dialog('Edit post', blogForm(await api('sfx_blog_get', { p_id: key }))); });
  if (a === 'blog-delete') return withBusy(async () => { if (!confirm('Delete this post?')) return; await api('sfx_blog_delete', { p_id: key }); await refreshBlog(); save('Post deleted.'); rerender(true); });
  if (a === 'redirect-new') return dialog('Add redirect', editForm('redirect-record', '', input('Old address (starts with /)', 'from', '', 'text', 'required placeholder="/old-page"') + input('New address (starts with / or https://)', 'to', '', 'text', 'required placeholder="/collections/sale"'), 'Save redirect'));
  if (a === 'redirect-edit') { const r = state.redirects.find((x) => x.id === key); return dialog('Edit redirect', editForm('redirect-record', key, input('Old address', 'from', r.from, 'text', 'required') + input('New address', 'to', r.to, 'text', 'required'), 'Save redirect')); }
  if (a === 'redirect-delete') return withBusy(async () => { await api('sfx_redirect_delete', { p_id: key }); await refreshRedirects(); save('Redirect removed.'); rerender(true); });
  if (a === 'revision-save') return withBusy(async () => { const r = await api('sfx_revision_save', { p_note: 'Saved by you' }); await refreshRevisions(); save(r.unchanged ? 'Nothing has changed since the last version.' : 'Version saved.'); rerender(true); });
  if (a === 'revision-restore') return withBusy(async () => { if (!confirm('Restore this version of your store settings? Your current settings are saved first.')) return; await api('sfx_revision_restore', { p_id: key }); await refreshRevisions(); save('Version restored.'); rerender(true); });
  if (a === 'metafield-new') return dialog('Add typed field', editForm('metafield-record', '', select('Applies to', 'ownerType', [['product', 'Products'], ['collection', 'Collections'], ['customer', 'Customers'], ['order', 'Orders'], ['store', 'The store']], 'product') + input('Name', 'label', '', 'text', 'required maxlength="80"') + input('Key (lowercase, like fabric)', 'key', '', 'text', 'required pattern="[a-z][a-z0-9_]{1,40}"') +
    select('Type', 'valueType', [['text', 'Text'], ['number', 'Number'], ['boolean', 'Yes or no'], ['url', 'Link'], ['date', 'Date']], 'text') + select('Show on the storefront', 'storefront', [['no', 'No, keep it private'], ['yes', 'Yes']], 'no'), 'Add field'));
  if (a === 'metafield-delete') return withBusy(async () => { if (!confirm('Delete this field and every value saved in it?')) return; await api('sfx_metafield_def_delete', { p_id: key }); await refreshCustomFields(); save('Field deleted.'); rerender(true); });
  if (a === 'metaobject-new') return dialog('Add record type', editForm('metaobject-record', '', input('Type key (lowercase, like size_guide)', 'type', '', 'text', 'required pattern="[a-z][a-z0-9_]{1,40}"') + input('Name', 'label', '', 'text', 'required maxlength="80"') +
    area('Fields, one per line: key | name | type (text, number, boolean, url, date)', 'fields', 'title | Title | text', 'rows="5"'), 'Add record type'));
  if (a === 'customer-edit') return dialog('Edit customer', customerForm(state.customers.find((c) => c.id === key)));
  if (a === 'customer-adopt') { const c = state.customers.find((x) => x.phone === decodeURIComponent(key)); return dialog('Save as customer', customerForm({ ...c, id: null })); }
  if (a === 'customer-delete') return withBusy(async () => { if (!confirm('Delete this customer record? Their past orders are not affected.')) return; await api('sfx_customer_delete', { p_id: key }); await refreshCustomers(); save('Customer deleted.'); rerender(true); });
  if (a === 'discount-new') return dialog('Create discount', discountForm(null));
  if (a === 'discount-edit') return dialog('Edit discount', discountForm(state.discounts.find((d) => d.id === key)));
  if (a === 'discount-toggle') return withBusy(async () => { const d = state.discounts.find((x) => x.id === key); await api('sfx_discount_set_status', { p_id: key, p_status: d.status === 'active' ? 'archived' : 'active' }); await refreshDiscounts(); save('Discount updated.'); rerender(true); });
  if (a === 'stock-details') return dialog('Stock details', stockDetailsForm(state.inventory.find((v) => v.variantId === key)));
  if (a === 'stock-buffer') return dialog('Stock buffer', editForm('stock-buffer', '', '<p class="compact-copy wide">Online orders cannot take a variant below this many units. Your own till is not held to it.</p>' + input('Units to keep back', 'buffer', (state.checkout && state.checkout.stockBuffer) || 0, 'number', 'min="0" step="1" required'), 'Save buffer'));
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
  if (a === 'return-set' && detail === 'received') { const r = state.returns.find((x) => x.id === key);
    return dialog('Receive returned items', editForm('return-receive', key, '<p class="compact-copy wide">Choose what happens to each item you got back.</p>' +
      (r.lines || []).map((l, i) => '<input type="hidden" name="v' + i + '" value="' + esc(l.variantId) + '">' + select(esc(l.name) + (l.label && l.label !== 'Default' ? ' · ' + esc(l.label) : '') + ' × ' + l.qty, 'k' + i, [['yes', 'Put back on sale'], ['no', 'Do not restock (damaged or opened)']], 'yes')).join(''), 'Mark received')); }
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
  if (a === 'style-link') return withBusy(async () => {
    const on = key !== 'off';
    if (key === 'on' && !confirm('Link AUZsStyle with this store? Your AUZsStyle products, sizes, colours, prices, stock, collections and tags become the shared catalogue, and products that only exist online are added to AUZsStyle. Edits in either place then show in both.')) return;
    if (key === 'off' && !confirm('Unlink AUZsStyle? Both keep what they have now, but changes stop being shared.')) return;
    const r = await api('sfx_style_link_set', { p_on: on }); await Promise.all([refreshProducts(), refreshStyleLink()]);
    save(on ? (key === 'sync' ? 'Synced.' : 'Linked. ' + (r.styles || 0) + ' AUZsStyle products shared.') : 'Unlinked.'); rerender(true);
  });
  if (a === 'style-import') return withBusy(async () => { if (!confirm('Copy your AUZsStyle products, sizes, colours, prices and stock into this store? Existing imported products are refreshed.')) return; const r = await api('sfx_import_from_style'); await refreshProducts(); save(r.created + ' added, ' + r.updated + ' refreshed, ' + r.variants + ' variants.'); rerender(true); });
  if (a === 'apikey-new') return dialog('Create an API key', editForm('apikey-record', '', input('Name (what will use it)', 'name', '', 'text', 'required maxlength="60" placeholder="Accounting export"'), 'Create key'));
  if (a === 'order-tags') { const o = state.orders.find((x) => x.id === key); return dialog('Order tags', editForm('order-tags', key, input('Tags, separated by commas (up to 10)', 'tags', ((o && o.tags) || []).join(', '), 'text', 'maxlength="400" placeholder="gift, wholesale"'), 'Save tags')); }
  if (a === 'order-edit') return withBusy(async () => {
    if (!(state.products || []).length) await refreshProducts();
    const o = state.orders.find((x) => x.id === key); const oldSub = (o.lines || []).reduce((t, l) => t + Number(l.price) * l.qty, 0);
    const opts = [['', 'Add a product…']].concat((state.products || []).flatMap((p) => (p.variants && p.variants.length ? p.variants : [{ id: '', label: '' }]).filter((v) => v.id).map((v) => [v.id + '|' + (v.price != null ? v.price : p.price), p.name + (v.label && v.label !== 'Default' ? ' · ' + v.label : '') + ' (' + money(v.price != null ? v.price : p.price) + ')'])));
    dialog('Edit items on order #' + o.number, editForm('order-edit', key,
      '<p class="compact-copy wide">Set a quantity to 0 to remove an item. Shipping, discount and tax are not recalculated. Nothing is refunded or charged here; the new total is noted on the order.</p>' +
      (o.lines || []).map((l, i) => input(esc(l.name) + (l.label && l.label !== 'Default' ? ' · ' + esc(l.label) : '') + ' at ' + money(l.price), 'q_' + i, l.qty, 'number', 'min="0" max="999" step="1" data-price="' + Number(l.price) + '"')).join('') +
      select('Add a product', 'addv', opts, '') + input('How many', 'addq', '', 'number', 'min="0" max="999" step="1"') +
      input('Or a custom item: name', 'cname', '', 'text', 'maxlength="120"') + input('Custom item price (Rs)', 'cprice', '', 'number', 'min="0" step="0.01"') + input('Custom item quantity', 'cq', '', 'number', 'min="0" max="999" step="1"') +
      '<label class="inline wide"><input type="checkbox" name="restock" value="1" checked> Put removed units back in stock</label>' + input('Reason (only your team sees this)', 'reason', '', 'text', 'maxlength="200"') +
      '<p class="compact-copy wide" id="edit-preview" data-total="' + Number(o.total) + '" data-oldsub="' + oldSub + '">New total: ' + money(o.total) + '</p>', 'Save changes'));
  });
  if (a === 'order-contact') { const o = state.orders.find((x) => x.id === key); const c = o.contact || {};
    return dialog('Edit contact', editForm('order-contact', key, input('Name', 'name', o.customer || '', 'text', 'required maxlength="120"') + input('Phone', 'phone', c.phone || '', 'tel', 'maxlength="20"') + input('Email', 'email', c.email || '', 'email', 'maxlength="120"') +
      (o.customerId ? select('Also update the customer record?', 'updateProfile', [['no', 'No, only this order'], ['yes', 'Yes, change their profile too']], 'no') : ''), 'Save')); }
  if (a === 'order-address') { const o = state.orders.find((x) => x.id === key); const c = o.contact || {};
    return dialog('Edit shipping address', editForm('order-address', key, '<p class="compact-copy wide">Shipping and tax on this order are not recalculated when the address changes.</p>' + area('Address', 'address', c.address || '', 'maxlength="300"') + input('City', 'city', c.city || '', 'text', 'maxlength="80"') + input('State', 'state', c.state || '', 'text', 'maxlength="80"') + input('PIN code', 'pin', c.pin || '', 'text', 'maxlength="12"'), 'Save address')); }
  if (a === 'order-unlink') return withBusy(async () => { if (!confirm('Remove the customer from this order? The customer record is kept and the order keeps their contact details.')) return; await api('sfx_order_unlink_customer', { p_order: key }); await refreshOrders(); save('Customer removed from the order.'); rerender(true); });
  if (a === 'order-archive') return withBusy(async () => { await api('sfx_order_archive', { p_order: key, p_on: detail === 'on' }); await refreshOrders(); save(detail === 'on' ? 'Order archived.' : 'Order restored.'); rerender(true); });
  if (a === 'layout-open') { layoutDraft = ((state.insights && state.insights.layout) || DEFAULT_LAYOUT).filter((k) => LAYOUT_NAMES[k]); return dialog('Choose the cards on Insights', layoutDialogBody()); }
  if (['layout-move', 'layout-hide', 'layout-show'].includes(a) && layoutDraft) {
    const i = layoutDraft.indexOf(key);
    if (a === 'layout-hide' && layoutDraft.length > 1) layoutDraft.splice(i, 1);
    if (a === 'layout-show' && i < 0) layoutDraft.push(key);
    if (a === 'layout-move' && i >= 0) { const j = detail === 'up' ? i - 1 : i + 1; if (j >= 0 && j < layoutDraft.length) { [layoutDraft[i], layoutDraft[j]] = [layoutDraft[j], layoutDraft[i]]; } }
    return dialog('Choose the cards on Insights', layoutDialogBody());
  }
  if (a === 'layout-save') return withBusy(async () => { const out = await api('sfx_dashboard_layout_save', { p_cards: layoutDraft }); state.insights.layout = out; save('Cards saved.'); close(); rerender(true); });
  if (a === 'webhook-new') return dialog('Add a webhook', editForm('webhook-record', '', input('Address (https only)', 'url', '', 'url', 'required placeholder="https://example.com/hooks/store"') +
    '<p class="compact-copy wide">Send me:</p>' + (((state.access.hooks || {}).events) || []).map((e) => '<label class="inline wide"><input type="checkbox" name="ev_' + e.replace('.', '_') + '" value="1"' + (e.startsWith('order.') ? ' checked' : '') + '> ' + esc(e) + '</label>').join(''), 'Add webhook'));
  if (a === 'webhook-test') return withBusy(async () => { await api('sfx_webhook_test', { p_id: key }); await refreshAccess(); save('Test message queued. It is sent within a few seconds.'); rerender(true); });
  if (a === 'webhook-set') return withBusy(async () => { await api('sfx_webhook_set', { p_id: key, p_active: detail === 'on' }); await refreshAccess(); save(detail === 'on' ? 'Webhook turned on.' : 'Webhook turned off.'); rerender(true); });
  if (a === 'webhook-delete') return withBusy(async () => { if (!confirm('Remove this webhook? Messages waiting for it are dropped.')) return; await api('sfx_webhook_delete', { p_id: key }); await refreshAccess(); save('Webhook removed.'); rerender(true); });
  if (a === 'webhook-log') return withBusy(async () => { const rows = await api('sfx_webhook_deliveries', { p_id: key });
    dialog('Recent deliveries', table(['When', 'Event', 'Result', 'Tries', 'Note'], (rows || []).map((r) => [new Date(r.at).toLocaleString('en-IN'), esc(r.event), r.status === 'sent' ? badge('Delivered') : r.status === 'failed' ? badge('Gave up', 'warn') : badge('Waiting', 'neutral'), r.attempts, esc(r.error || (r.httpStatus ? String(r.httpStatus) : ''))])) + button('Close', 'close-dialog', 'primary')); });
  if (a === 'apikey-revoke') return withBusy(async () => { if (!confirm('Revoke this key? Anything using it stops working.')) return; await api('sfx_api_key_revoke', { p_id: key }); await refreshAccess(); save('Key revoked.'); rerender(true); });
  if (a === 'clear-filters') { for (const k of Object.keys(pf)) pf[k] = ''; const q = $('#table-query'); if (q) q.value = ''; for (const el of document.querySelectorAll('[id^="pf-"]')) el.value = ''; const r = $('#table-results'); if (r) r.innerHTML = productsList(''); return; }
  if (a === 'bulk-all') { for (const el of document.querySelectorAll('input[data-bulk]')) el.checked = true; scopeLine(); return; }
  if (a === 'bulk-open') { const n = bulkIds().length; if (!n) { flash('Tick the products you want to change first.'); return; } return dialog('Bulk edit', bulkForm(n)); }
  if (a === 'products-csv') return downloadProductsCsv();
  if (await themeAction(a, key)) return;
  if (await roleAction(a, key)) return;
  if (await contentAction(a, key)) return;
  if (a === 'campaign-new') return dialog('Add campaign', campaignForm(null));
  if (a === 'campaign-edit') return dialog('Edit campaign', campaignForm(state.campaigns.find((c) => c.id === key)));
  if (a === 'campaign-delete') return withBusy(async () => { if (!confirm('Delete this campaign?')) return; await api('sfx_campaign_delete', { p_id: key }); await refreshCampaigns(); save('Campaign deleted.'); rerender(true); });
  if (a === 'plan-pay') { const out = $('#plan-feedback'); target.disabled = true; out.textContent = 'Starting payment…'; return payPlan(out).catch((e) => { out.textContent = e.message; }).finally(() => { target.disabled = false; }); }
  if (a === 'plan-request') return withBusy(async () => { await api('request_storefront_reactivation', { p_notes: null }); save('Request sent. We will get back to you.'); });
  if (a === 'dir-new') return dialog('Add store', storeDirForm(null));
  if (a === 'dir-edit') return dialog('Edit store', storeDirForm((state.storeDir || []).find((x) => x.id === key)));
  if (a === 'dir-delete') return withBusy(async () => { if (!confirm('Delete this store?')) return; await api('sfx_stores_save', { p: (state.storeDir || []).filter((x) => x.id !== key) }); await refreshStoreDir(); save('Store deleted.'); rerender(true); });
  if (a === 'pages-all') { const boxes = [...document.querySelectorAll('.pg-sel')]; const on = boxes.some((b) => !b.checked); boxes.forEach((b) => { b.checked = on; }); return; }
  if (a === 'page-copy') return withBusy(async () => { const items = cfgList('pages'), src = items.find((x) => x.id === key); if (!src) return; let slug = src.slug + '-copy', n = 2; while (items.some((x) => x.slug === slug)) slug = src.slug + '-copy-' + n++; await saveList('pages', [...items, { ...src, id: 'pg' + Date.now().toString(36), name: src.name + ' (copy)', slug, status: 'Hidden', publishAt: '', updatedOn: new Date().toISOString().slice(0, 10) }]); save('Page copied as hidden.'); rerender(true); });
  if (a === 'pages-bulk') {
    const ids = new Set([...document.querySelectorAll('.pg-sel:checked')].map((b) => b.value)); if (!ids.size) { flash('Tick the pages you want to change first.'); return; }
    return withBusy(async () => { const items = cfgList('pages');
      if (key === 'delete') { if (!confirm('Delete ' + ids.size + ' page(s)? This cannot be undone.')) return; await saveList('pages', items.filter((x) => !ids.has(x.id))); }
      else await saveList('pages', items.map((x) => ids.has(x.id) ? { ...x, status: key, publishAt: '', updatedOn: new Date().toISOString().slice(0, 10) } : x));
      save(ids.size + ' page(s) updated.'); rerender(true); });
  }
  if (a === 'rich-fmt') {
    const ta = target.closest('.rich')?.querySelector('textarea'); if (!ta) return;
    const st = ta.selectionStart, en = ta.selectionEnd, sel = ta.value.slice(st, en);
    let ins = sel, c0 = st, c1 = en;
    if (key === 'bold') { ins = '**' + (sel || 'bold text') + '**'; } else if (key === 'italic') { ins = '*' + (sel || 'italic text') + '*'; }
    else if (key === 'list') { ins = (sel || 'Item one\nItem two').split('\n').map((l) => '- ' + l.replace(/^[-*] /, '')).join('\n'); }
    else if (key === 'link') { const u = prompt('Link address (https://...)', 'https://'); if (!u || !/^https:\/\/[^\s)]+$/.test(u)) { if (u) flash('Use a link that starts with https://'); return; } ins = '[' + (sel || 'link text') + '](' + u + ')'; }
    ta.value = ta.value.slice(0, st) + ins + ta.value.slice(en); ta.focus(); ta.setSelectionRange(st, st + ins.length); ta.dispatchEvent(new Event('input', { bubbles: true })); return;
  }
  if (a === 'photo-move') {
    const box = target.closest('.product-photo'), f = target.closest('form'), dir = Number(key); if (!box || !f) return;
    const sib = dir < 0 ? box.previousElementSibling : box.nextElementSibling; if (!sib || !sib.classList.contains('product-photo')) return;
    dir < 0 ? sib.before(box) : sib.after(box);
    const boxes = [...f.querySelectorAll('.product-photo')]; f.querySelector('[name=existing]').value = JSON.stringify(boxes.map((x) => x.dataset.src));
    boxes.forEach((x, i) => { const r = x.querySelector('[name=mainIndex]'), c = x.querySelector('[name=remove]'); if (r) r.value = i; if (c) c.value = i; });
    flash('Order changed. Press Save images to keep it.'); return;
  }
  if (a === 'variant-add') { addVariantRow(target.closest('form')); return; }
  if (a === 'variant-generate') { try { const r = generateVariants(target.closest('form')); flash(r.total + ' variants: ' + r.fresh + ' new, ' + r.kept + ' kept' + (r.removed ? ', ' + r.removed + ' will be removed when you save' : '') + '. Review the rows, then Save variants.'); } catch (e) { flash(e.message); } return; }
  if (a === 'variant-remove') { const f = target.closest('form'); const list = collectVariants(f); list.splice(Number(key), 1); f.querySelector('.product-variant-grid').innerHTML = variantEditor(list); return; }
  if (a === 'variant-fill') { const f = target.closest('form'); const bp = f.querySelector('[name=bulkPrice]').value, bs = f.querySelector('[name=bulkStock]').value; const list = collectVariants(f).map((v) => ({ ...v, price: bp !== '' ? Number(bp) : v.price, stock: bs !== '' ? Number(bs) : v.stock })); f.querySelector('.product-variant-grid').innerHTML = variantEditor(list); flash('Applied. Save variants to keep it.'); return; }
  if (a === 'theme-use') return withBusy(async () => { await api('sfx_store_save', { p: { theme: key } }); const ctx = await api('sfx_context'); applyContext(ctx); save('Theme updated.'); rerender(); });
  if (a === 'razorpay-clear') return withBusy(async () => { await api('sfx_store_set_razorpay', { p: { clear: true } }); const ctx = await api('sfx_context'); applyContext(ctx); save('Razorpay disconnected.'); rerender(); });
  if (a === 'order-fulfill') {
    const o = state.orders.find((x) => x.id === key);
    const qty = (o?.remaining || []).filter((r) => r.qty > 0).map((r) => input(esc(r.name) + (r.label && r.label !== 'Default' ? ' · ' + esc(r.label) : '') + ' (' + r.qty + ' left)', 'q_' + r.variantId, String(r.qty), 'number', 'min="0" max="' + r.qty + '"')).join('');
    return dialog('Fulfil items', editForm('order-fulfill', key, qty + input('Carrier (optional)', 'carrier', '', 'text', 'maxlength="80"') + input('Tracking number (optional)', 'tracking', '', 'text', 'maxlength="100"') + input('Tracking link (optional, https)', 'trackingUrl', '', 'text', 'maxlength="400"') + '<label class="check"><input type="checkbox" name="notify" checked> Tell the customer</label>', 'Create shipment'));
  }
  if (a === 'shipment-edit') {
    const sh = state.orders.flatMap((x) => x.shipments || []).find((x) => x.id === key);
    return dialog('Edit tracking', editForm('shipment-edit', key, input('Carrier', 'carrier', sh?.carrier || '', 'text', 'maxlength="80"') + input('Tracking number', 'tracking', sh?.tracking || '', 'text', 'maxlength="100"') + input('Tracking link (https)', 'trackingUrl', sh?.trackingUrl || '', 'text', 'maxlength="400"'), 'Save tracking'));
  }
  if (a === 'shipment-set') {
    return withBusy(async () => { await api('sfx_shipment_update', { p_id: key, p: { status: detail } }); await refreshOrders(); save('Shipment updated.'); rerender(); });
  }
  if (a === 'order-cancel') return dialog('Cancel order', editForm('order-cancel', key, '<p class="compact-copy wide">The customer is not charged for items that were never shipped. Nothing can be undone after this.</p>' +
    select('Reason', 'reason', [['Customer changed mind', 'Customer changed mind'], ['Out of stock', 'Out of stock'], ['Wrong details', 'Wrong details'], ['Fraud risk', 'Fraud risk'], ['Other', 'Other']], 'Customer changed mind') +
    select('Items', 'restock', [['yes', 'Put the items back on sale'], ['no', 'Do not restock (damaged or lost)']], 'yes'), 'Cancel order'));
  if (a === 'refund-new') { const o = state.orders.find((x) => x.id === key); return dialog('Record a refund', editForm('refund-record', key, '<p class="compact-copy wide">Pay the customer back yourself (cash, UPI, bank), then record it here. You can refund up to ' + money(o.total - o.refunded) + ' more.</p>' +
    '<p class="compact-copy wide">Pick the items being refunded and the amount fills in. You can still change it.</p>' +
    (o.lines || []).map((l, i) => input(esc(l.name) + (l.label && l.label !== 'Default' ? ' · ' + esc(l.label) : '') + ' (' + l.qty + ' ordered at ' + money(l.price) + ')', 'rq_' + i, '', 'number', 'min="0" max="' + l.qty + '" step="1" data-price="' + Number(l.price) + '"')).join('') +
    (o.shippingFee > 0 ? '<label class="inline wide"><input type="checkbox" name="rship" value="1" data-price="' + Number(o.shippingFee) + '"> Refund the shipping fee (' + money(o.shippingFee) + ')</label>' : '') +
    input('Amount (Rs)', 'amount', '', 'number', 'required min="0.01" step="0.01"') + select('How it was paid back', 'method', [['manual', 'Cash, UPI or bank'], ['store_credit', 'Store credit']], 'manual') + input('Reason', 'reason', '', 'text', 'maxlength="200"'), 'Record refund')); }
  if (a === 'order-test') return withBusy(async () => { await api('sfx_order_mark_test', { p_order: key, p_test: detail === 'on' }); await refreshOrders(); save(detail === 'on' ? 'Marked as a test order.' : 'Unmarked.'); rerender(true); });
  if (a === 'theme-install') return withBusy(async () => {
    const r = await api('sfx_theme_install', { p_theme_id: key });
    await Promise.all([refreshMarketplace(), refreshInstalls()]);
    save(r.alreadyInstalled ? 'Already installed.' : 'Theme installed. Customize it, then publish when ready.');
    rerender();
  });
  if (a === 'theme-buy') return withBusy(async () => {
    const o = await apiPost('/payments/sfx/theme/create', { themeId: key });
    await loadRzp();
    await new Promise((ok, no) => {
      const rz = new window.Razorpay({ key: o.keyId, order_id: o.orderId, amount: o.amount, currency: o.currency, name: 'AUZslab', description: o.description,
        handler: () => ok(), modal: { ondismiss: () => no(new Error('Payment was not completed.')) } });
      rz.open();
    });
    save('Payment received. Unlocking your theme…');
    for (let i = 0; i < 20; i++) { await new Promise((r) => setTimeout(r, 2000)); await Promise.all([refreshMarketplace(), refreshInstalls()]); if (state.installs.some((x) => x.themeId === key)) { save('Theme unlocked and installed.'); return rerender(); } }
    save('Payment received. The theme will appear within a minute; refresh shortly.'); rerender();
  });
  if (a === 'theme-customize') { location.hash = '/builder/' + key; return; }
  if (a === 'studs-save') return withBusy(async () => { studsRead(); const r = await api('sfx_studs_settings_save', { p_install_id: sd.id, p: sd.settings }); sd.settings = r.settings; sd.saved = JSON.stringify(r.settings); await refreshInstalls(); save('Studs draft saved. Your live store has not changed.'); rerender(); });
  if (a === 'studs-publish') return withBusy(async () => {
    if (!confirm('Publish Studs and make it live on your storefront? Your products, prices, links and checkout stay the same. You can go back to your previous theme afterwards.')) return;
    studsRead(); await api('sfx_studs_settings_save', { p_install_id: sd.id, p: sd.settings }); await api('sfx_studs_publish', { p_install_id: sd.id });
    await refreshInstalls(); const ctx = await api('sfx_context'); applyContext(ctx); save('Studs is live on your storefront.'); rerender();
  });
  if (a === 'studs-revert') return withBusy(async () => {
    if (!confirm('Go back to the theme you used before Studs? Studs stays saved as a draft.')) return;
    await api('sfx_theme_revert_active', {}); await refreshInstalls(); const ctx = await api('sfx_context'); applyContext(ctx); save('Your previous theme is live again.'); rerender();
  });
  if (a === 'studs-device') { const f = document.querySelector('#studs-frame'); if (f) f.className = 'te-frame ' + key; return; }
  if (a === 'theme-activate') return withBusy(async () => {
    const inst = state.installs.find((x) => x.id === key); if (inst?.draftContent?.kind === 'studs' && !confirm('Make Studs live on your storefront? Your products, prices, links and checkout stay the same, and you can go back to your previous theme.')) return;
    await api('sfx_theme_install_set_active', { p_install_id: key });
    await Promise.all([refreshInstalls()]); const ctx = await api('sfx_context'); applyContext(ctx);
    save('This theme is now active on your storefront.'); rerender();
  });
  if (a && a.startsWith('te-') && a !== 'te-save' && a !== 'te-publish') { if (edHandle(a, key)) return; }
  if (a === 'te-save') return withBusy(async () => { await edSave(); save('Design saved as a draft.'); });
  if (a === 'te-publish') return withBusy(async () => { if (!confirm('Publish this design to your live storefront?')) return; await edSave(); await api('sfx_theme_customize_publish', { p_install_id: ed.id }); await refreshInstalls(); save('Published to your storefront.'); rerender(); });
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
