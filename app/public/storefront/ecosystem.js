// AUZslab storefront owner hub: app shell, routing, dialogs, global search. Adapted from Codex's
// ecosystem-preview/ecosystem.js -- the shell/nav/dialog/search design is kept as designed. What changed:
// `state` now holds real per-tenant data loaded from the backend (api.js's boot()) instead of a hardcoded
// "GenX Cloths" demo catalog kept in localStorage, and every page this app can reach belongs to the owner
// hub itself -- the public marketing site (themes/careers/contact/signup preview pages) that the original
// preview also routed through this file is a separate, unrelated project and is not part of this build.
import { menu, icons, emptyState } from './data.js';
import { workspace } from './workspace.js';
import { sb, api, boot, refreshRoles, refreshCollections, refreshAbandoned, refreshCampaigns, refreshCategories, refreshCheckout, refreshCompanies, refreshCustomers, refreshDrafts, refreshReturns, refreshSegments, refreshDiscounts, refreshDomains, refreshInventory, refreshLocations, refreshOrders, refreshProducts, refreshInstalls, refreshMarketplace, refreshPlan } from './api.js';

export const $ = (selector) => document.querySelector(selector);
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = (value) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);
export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString().slice(0, 10);
export const localUrl = (value, fallback = '') => {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try { const url = new URL(value, location.origin); return ['https:', 'http:'].includes(url.protocol) ? value : fallback; } catch { return fallback; }
};
export const state = emptyState();
export const io = {};
let handlePage = null;
let navOpen = false;

// Small, genuinely per-browser UI preferences (which analytics reports are pinned, a performance target,
// dark/light mode) -- never business data, never shared between devices or staff, so localStorage is the
// right place for these (see artifact-capabilities-style guidance this codebase already follows elsewhere:
// "localStorage only for per-viewer convenience"). Everything else in `state` comes from the server on
// every load and is never written here.
const PREF_KEY = 'auzslab.sfx.prefs.v1';
try {
  const saved = JSON.parse(localStorage.getItem(PREF_KEY) || 'null');
  if (saved) { state.analyticsPins = saved.analyticsPins || []; state.analyticsTarget = saved.analyticsTarget; state.analyticsReports = saved.analyticsReports || []; }
} catch { /* ignore */ }
export function save(message) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify({ analyticsPins: state.analyticsPins, analyticsTarget: state.analyticsTarget, analyticsReports: state.analyticsReports })); } catch { /* storage full: the preference just won't survive a reload */ }
  if (message) flash(message);
}

export function icon(name) { return '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="' + (icons[name] || icons.grid) + '"/></svg>'; }
export const button = (name, action, kind = '') => '<button type="button" class="btn ' + kind + '" data-action="' + esc(action) + '">' + name + '</button>';
export const link = (name, path, kind = '') => '<a class="btn ' + kind + '" href="' + esc(path) + '">' + name + '</a>';
export const badge = (name, kind = '') => '<span class="chip ' + kind + '">' + esc(name) + '</span>';
export const imageUrl = (src) => /^data:image\/(?:webp|png|jpe?g);base64,[a-z0-9+/=]+$/i.test(src || '') ? src : localUrl(src);
export const image = (src, alt = '', className = '') => src ? '<img src="' + esc(imageUrl(src)) + '" alt="' + esc(alt) + '" class="' + esc(className) + '" loading="lazy">' : '';
export function flash(text) { $('#toast').textContent = text; clearTimeout(io.toast); io.toast = setTimeout(() => { $('#toast').textContent = ''; }, 4200); }
export function dialog(title, body, opts = {}) {
  const root = $('#dialog'); root.classList.toggle('preview-dialog', !!opts.wide);
  $('#dialog-body').innerHTML = '<div class="dialog-head"><h2>' + esc(title) + '</h2><button type="button" class="btn icon" data-action="close-dialog" aria-label="Close dialog">×</button></div><div class="dialog-content">' + body + '</div>';
  if (!root.open) root.showModal();
}
export function close() { if ($('#dialog').open) $('#dialog').close(); }
export const appLinks = () => {
  const f = state.features || {}, on = (k) => f[k];
  const apps = [];
  if (on('style')) apps.push(['AUZsStyle', 'Billing, stock and shop analytics', 'https://auzsstyle.auzslab.in/style.html', 'shirt']);
  if (on('accounting')) apps.push(['AUZsLedger', 'Accounting and GST books', 'https://auzsledger.auzslab.in/accounts.html', 'ledger']);
  if (on('salon') && state.tenant?.slug) apps.push(['Salon console', 'Bookings, billing and your salon website', 'https://' + state.tenant.slug + '.auzslab.in/salon/admin/', 'scissors']);
  apps.push(['Account and apps', 'Your profile, plan and all your apps', 'https://auzslab.in/account.html', 'accountCircle']);
  return apps;
};
const brand = (href = '#/') => '<a class="brand" href="' + href + '" aria-label="AUZslab storefront"><img src="/logo.png" alt="AUZslab" width="94" height="29" onerror="this.remove()"></a>';

const allItems = menu.flatMap((m) => (m.id ? [[m.id, m.name], ...(m.children || [])] : []));
export const settingsGroups = [
  { label: 'Business', items: [['settings', 'Business profile', 'business'], ['billing', 'Billing and renewals', 'receipt'], ['team', 'Staff and access', 'team'], ['roles', 'Roles', 'shield'], ['locations', 'Locations', 'pin']] },
  { label: 'Store operations', items: [['checkout', 'Payments', 'card'], ['domains', 'Domains', 'link'], ['builder', 'Theme', 'palette'], ['policies', 'Store policies', 'scroll']] },
  { label: 'Preferences', items: [['notifications', 'Notifications', 'bell'], ['privacy-settings', 'Customer privacy', 'eye'], ['security', 'Sign-in and support', 'key']] },
  { label: 'Apps', items: [['switch-apps', 'Switch apps', 'swap']] },
];
export const settingsRoutes = new Set(['settings', ...(menu.find((item) => item.id === 'settings')?.children || []).map(([id]) => id), 'team', 'roles', 'locations', 'billing', 'security', 'switch-apps']);
let returnToWorkspace = 'home';
const dashboardPath = '/storefront.html';
export const pathFor = (id) => dashboardPath + '#/' + id;
// A list page (never a detail/edit form, so a background refresh here can never wipe something the owner
// is mid-typing) refetches its own data every time it's opened, the same "show it, then make sure it's
// current" shape as AUZsStyle's store.js caching -- catches an order placed, or a status changed, from
// another tab or by a teammate since this page last loaded.
const LIST_REFRESH = { orders: refreshOrders, products: refreshProducts, collections: refreshCollections, domains: refreshDomains, customers: refreshCustomers, discounts: refreshDiscounts, inventory: refreshInventory, transfers: refreshLocations, categories: refreshCategories, drafts: refreshDrafts, returns: refreshReturns, 'abandoned-checkouts': refreshAbandoned, shipping: refreshCheckout, companies: refreshCompanies, segments: refreshSegments, growth: refreshCampaigns, builder: () => Promise.all([refreshMarketplace(), refreshInstalls()]), billing: refreshPlan, roles: refreshRoles };
let lastRefreshedRoute = '';

export function rerender(skipRefresh) {
  handlePage = null;
  const requested = location.hash.replace(/^#\/?/, '').split('?')[0];
  const [parent, record] = requested.split('/');
  // Refetches once per visit to a list page (never while editing a record, and never twice for the render
  // this refetch itself causes -- lastRefreshedRoute is the guard against that second case).
  if (!skipRefresh && !record && LIST_REFRESH[parent] && lastRefreshedRoute !== requested) {
    lastRefreshedRoute = requested;
    LIST_REFRESH[parent]().then(() => { if (location.hash.replace(/^#\/?/, '').split('?')[0] === requested) rerender(true); }).catch(() => {});
  }
  if (record || !LIST_REFRESH[parent]) lastRefreshedRoute = '';
  const active = allItems.some(([id]) => id === parent) ? parent : 'home';
  const context = new URLSearchParams(location.hash.split('?')[1]);
  const inSettings = settingsRoutes.has(active) || context.get('via') === 'settings';
  if (!inSettings) returnToWorkspace = requested || 'home';
  const workspaceMenu = menu.filter((item) => item.id !== 'settings');
  const nav = workspaceMenu.map((m) => (m.label ? '<div class="nav-label">' + m.label + '</div>' : '<a href="' + pathFor(m.id) + '"' + (m.id === active ? ' aria-current="page"' : '') + '>' + icon(m.icon) + m.name + '</a>' + ([m.id, ...(m.children || []).map(([id]) => id)].includes(active) ? (m.children || []).map(([id, name]) => '<a class="sub" href="' + pathFor(id) + '"' + (id === active ? ' aria-current="page"' : '') + '>' + name + '</a>').join('') : ''))).join('');
  const search = '<button class="btn side-search" type="button" data-action="global-search" aria-label="Search workspace" title="Search workspace (Ctrl K or ⌘K)">' + icon('search') + '<span class="side-search-label">Search</span></button>';
  const unread = state.notifications.filter((n) => !n.read).length;
  const { html, dispatch } = workspace(active, record);
  handlePage = dispatch;
  const accountTheme = localStorage.getItem('auzslab.preview.theme') || 'auto';
  const activeName = allItems.find(([id]) => id === active)?.[1] || 'Overview';
  const dark = accountTheme === 'dark';
  const headerActions = '<div class="topbar-actions">' +
    '<a class="btn top-action" href="' + pathFor('notifications') + '" aria-label="Notifications' + (unread ? ', ' + unread + ' unread' : '') + '" title="Notifications">' + icon('bell') + '<span class="top-action-label">Notifications</span>' + (unread ? '<span class="top-count" aria-hidden="true">' + unread + '</span>' : '') + '</a>' +
    (state.tenant?.slug ? '<a class="btn top-action" href="https://' + esc(state.tenant.slug) + '.auzslab.in/store.html" target="_blank" rel="noopener" aria-label="View site" title="View site">' + icon('globe') + '<span class="top-action-label">View site</span></a>' : '') +
    '<button type="button" class="btn top-action" data-action="account-theme" aria-label="Switch to ' + (dark ? 'light' : 'dark') + ' mode" title="Switch to ' + (dark ? 'light' : 'dark') + ' mode">' + icon(dark ? 'sun' : 'moon') + '<span class="top-action-label">' + (dark ? 'Light' : 'Dark') + '</span></button>' +
    '</div>';
  const bizName = state.business.name || 'Your store';
  const initials = bizName.trim().split(/\s+/).slice(0, 2).map((word) => Array.from(word)[0] || '').join('').toUpperCase();
  const sidebarBottom = '<div class="sidebar-bottom">' + '<a class="sidebar-settings" href="' + pathFor('settings') + '"' + (inSettings ? ' aria-current="' + (active === 'settings' ? 'page' : 'true') + '"' : '') + '>' + icon('settings') + '<span>Settings</span></a>' +
    '<div class="sidebar-store-row"><a class="workspace-id" href="' + pathFor('website') + '" title="' + esc(bizName) + ' online store"><span class="avatar" aria-hidden="true">' + esc(initials) + '</span><strong>' + esc(bizName) + '</strong></a>' +
    '<a class="sidebar-alerts" href="' + pathFor('notifications') + '" aria-label="Store notifications' + (unread ? ', ' + unread + ' unread' : '') + '" title="Store notifications">' + icon('bell') + (unread ? '<span aria-hidden="true">' + Math.min(unread, 99) + (unread > 99 ? '+' : '') + '</span>' : '') + '</a></div></div>';
  const settingsNav = settingsGroups.map((group) => '<section data-settings-group><div class="nav-label">' + group.label + '</div>' + group.items.map(([id, label, glyph]) => '<a href="' + pathFor(id + (settingsRoutes.has(id) ? '' : '?via=settings')) + '"' + (id === active ? ' aria-current="page"' : '') + '>' + icon(glyph) + '<span>' + label + '</span></a>').join('') + '</section>').join('') + '<section data-settings-group><div class="nav-label">Account</div><a href="#" data-action="sign-out">' + icon('logout') + '<span>Sign out</span></a></section>';
  const sidebar = inSettings ?
    '<aside class="sidebar settings-sidebar" id="workspace-sidebar"><div class="settings-rail">' + brand() + search + '<nav aria-label="Workspace">' + workspaceMenu.filter((item) => item.id).map((item) => '<a href="' + pathFor(item.id) + '" aria-label="' + item.name + '" title="' + item.name + '">' + icon(item.icon) + '</a>').join('') + '</nav></div><div class="settings-panel"><div class="settings-brand">' + brand() + '</div><a class="settings-back" href="' + esc(pathFor(returnToWorkspace)) + '"><span aria-hidden="true">‹</span> Back to workspace</a><button class="btn drawer-switch" type="button" data-action="switch-drawer" aria-pressed="false">Workspace menu</button><input class="settings-search" type="search" aria-label="Search settings" placeholder="Search settings" autocomplete="off"><nav class="side-nav settings-links" aria-label="Settings">' + settingsNav + '<p id="settings-empty" hidden>No matching settings</p></nav><nav class="side-nav drawer-workspace" aria-label="Workspace">' + nav + '</nav>' + sidebarBottom + '</div></aside>' :
    '<aside class="sidebar" id="workspace-sidebar"><div class="sidebar-head">' + brand() + search + '</div><nav class="side-nav" aria-label="Workspace">' + nav + '</nav>' + sidebarBottom + '</aside>';
  const c = state.counts || {};
  const unfulfilled = state.orders.filter((o) => o.status === 'Unfulfilled').length;
  const homeHero = '<div class="m-hero"><a class="m-avatar" href="' + pathFor('settings') + '" aria-label="Business profile">' + esc(initials) + '</a><strong class="m-store">' + esc(bizName) + '</strong><a class="m-bell" href="' + pathFor('notifications') + '" aria-label="Notifications' + (unread ? ', ' + unread + ' unread' : '') + '">' + icon('bell') + (unread ? '<span aria-hidden="true">' + Math.min(unread, 99) + '</span>' : '') + '</a></div>' +
    '<div class="m-stats"><div><span>Products</span><b>' + (c.activeProducts ?? 0) + '</b></div><div><span>To fulfil</span><b>' + unfulfilled + '</b></div><div><span>Sales</span><b>' + money(c.salesTotal || 0) + '</b></div><div><span>Stock alerts</span><b>' + (c.lowStock ?? 0) + '</b></div></div>';
  const mSearch = '<button type="button" class="m-search" data-action="global-search" aria-label="Search workspace">' + icon('search') + '<span>Search</span></button>';
  const header = '<header class="topbar' + (active === 'home' ? ' is-home' : '') + '"><div class="mobile-brand">' + brand() + '</div><div class="breadcrumb">Workspace <span>›</span> <strong>' + esc(activeName) + '</strong></div><strong class="mobile-page-name">' + esc(activeName) + '</strong>' + headerActions + (active === 'home' ? homeHero : mSearch) + '</header>';
  const quickLinks = ['home', 'orders', 'products'].map((id) => {
    const item = workspaceMenu.find((item) => item.id === id);
    const current = id === active || item.children?.some(([child]) => child === active);
    return '<a href="' + pathFor(id) + '"' + (current ? ' aria-current="' + (id === active ? 'page' : 'true') + '"' : '') + '>' + icon(item.icon) + '<span>' + item.name + '</span></a>';
  }).join('');
  const mobileNav = '<nav class="mobile-quick-nav" aria-label="Quick navigation">' +
    '<div class="mq-pill">' + quickLinks +
    '<button type="button" data-action="toggle-nav" aria-controls="workspace-sidebar" aria-expanded="' + navOpen + '">' + icon('menu') + '<span>Menu</span></button></div>' +
    '<button type="button" class="mq-round" data-action="global-search" aria-label="Search">' + icon('search') + '</button></nav>';
  const previousArea = $('.work-area');
  const route = location.hash || '#/home';
  const scrollTop = previousArea?.dataset.route === route ? previousArea.scrollTop : 0;
  $('#app').innerHTML = '<div class="shell' + (navOpen ? ' nav-open' : '') + (inSettings ? ' settings-mode' : '') + (settingsRoutes.has(active) ? ' settings-direct' : '') + '" data-theme="' + esc(accountTheme) + '"><div class="work-layout">' + sidebar + '<div class="work-area" data-route="' + esc(route) + '">' + header + '<main id="main" class="work" tabindex="-1">' + html + '</main></div></div><button type="button" class="mobile-nav-backdrop" data-action="close-nav" aria-label="Close navigation"></button>' + mobileNav + '</div>';
  $('.work-area').scrollTop = scrollTop;
  const adminHost = document.querySelector('[data-admin-pane]');
  if (adminHost && window.auzAdminTab) {
    const only = adminHost.dataset.adminPane || undefined;
    window.auzAdminTab.mount(adminHost, { rpc: (fn, args) => api(fn, args), toast: (m, err) => flash(m), isOwner: (state.perms || {}).sfx_manage === true, sb, only });
  }
  if (inSettings) {
    $('.settings-links [aria-current]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    $('.settings-search').addEventListener('input', (event) => {
      const query = event.target.value.trim().toLowerCase();
      let count = 0;
      document.querySelectorAll('[data-settings-group]').forEach((group) => {
        const links = [...group.querySelectorAll('a')];
        links.forEach((link) => { link.hidden = !link.textContent.toLowerCase().includes(query); });
        group.hidden = links.every((link) => link.hidden);
        count += links.filter((link) => !link.hidden).length;
      });
      $('#settings-empty').hidden = count > 0;
    });
  }
}
function setNavOpen(open, focus = false) {
  navOpen = open;
  $('.shell').classList.toggle('nav-open', open);
  const trigger = $('[data-action=toggle-nav]');
  trigger.setAttribute('aria-expanded', String(open));
  if (focus) (open ? $('.settings-back') || $('.sidebar .side-search') : trigger)?.focus();
}
function search() {
  if (navOpen) setNavOpen(false);
  const results = [...allItems.map(([id, name]) => ({ name, link: pathFor(id), type: 'Workspace' })),
    ...state.products.map((p) => ({ name: p.name, link: pathFor('products/' + encodeURIComponent(p.id)), type: 'Product' })),
    ...state.orders.map((o) => ({ name: 'Order #' + o.number, link: pathFor('orders/' + encodeURIComponent(o.id)), type: 'Order' }))];
  dialog('Search workspace', '<label>Search<input id="global-query" type="search" autocomplete="off"></label><div id="search-results" class="stack" style="margin-top:10px"></div>');
  const fill = () => { const q = $('#global-query').value.toLowerCase().trim(); $('#search-results').innerHTML = results.filter((r) => r.name.toLowerCase().includes(q)).slice(0, 10).map((r) => '<a class="btn" data-search-target href="' + esc(r.link) + '">' + esc(r.name) + ' · ' + r.type + '</a>').join('') || '<p>No matching results.</p>'; };
  $('#global-query').addEventListener('input', fill); fill(); $('#global-query').focus();
}
document.addEventListener('click', (event) => {
  const ho = event.target.closest && event.target.closest('a[data-handoff]');
  if (ho && window.auzHandoffUrl) { event.preventDefault(); location.href = window.auzHandoffUrl(ho.href); return; }
  if (event.target.closest('[data-search-target]')) close();
  if (navOpen && event.target.closest('.sidebar a[href], .mobile-quick-nav a[href]')) setNavOpen(false);
  const target = event.target.closest('[data-action]'); if (!target) return;
  const [action, key, detail] = target.dataset.action.split(':');
  if (action === 'close-dialog') { if ($('#dialog').open) return close(); target.closest('form')?.reset(); return; }
  if (action === 'sign-out') { event.preventDefault(); Promise.resolve(sb.auth.signOut()).catch(() => {}).then(() => { location.href = 'https://auzslab.in/signup.html?signout=1'; }); return; }
  if (action === 'global-search') return search();
  if (action === 'account-theme') { const dark = localStorage.getItem('auzslab.preview.theme') === 'dark'; localStorage.setItem('auzslab.preview.theme', dark ? 'light' : 'dark'); return rerender(); }
  if (action === 'toggle-nav' || action === 'close-nav') { setNavOpen(action === 'toggle-nav' && !navOpen, true); return; }
  if (action === 'switch-drawer') {
    const workspaceMenu = $('.settings-panel').classList.toggle('show-workspace');
    target.setAttribute('aria-pressed', String(workspaceMenu));
    target.textContent = workspaceMenu ? 'Settings menu' : 'Workspace menu';
    return;
  }
  handlePage?.('click', target, event, key, detail);
});
document.addEventListener('submit', (event) => {
  const form = event.target; if (!form.dataset.form) return;
  event.preventDefault();
  handlePage?.('submit', form, event);
});
for (const type of ['input', 'change']) document.addEventListener(type, (event) => handlePage?.(type, event.target, event));
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); search(); }
  else if (event.key === 'Escape' && navOpen) setNavOpen(false, true);
});
addEventListener('hashchange', () => { navOpen = false; close(); rerender(); scrollTo(0, 0); });
matchMedia('(max-width:900px)').addEventListener('change', (event) => { if (!event.matches && navOpen) setNavOpen(false); });

boot(() => { if (!location.hash) location.hash = '#/home'; rerender(); });
