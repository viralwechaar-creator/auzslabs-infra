// Real backend wiring for the storefront owner hub. Everything in workspace.js/ecosystem.js/domains.js/
// analytics.js reads and writes through the functions this file exports -- no mock fetch, no localStorage
// standing in for the server (see db/372 for every RPC called here).
import { state } from './ecosystem.js';

export const sb = window.supabase.createClient(CFG.url, CFG.key);
export let perms = { sfx_view: false, sfx_manage: false };
let busy = 0;

export async function api(fn, args) {
  busy++; document.documentElement.setAttribute('aria-busy', 'true');
  try {
    let r;
    try { r = await sb.rpc(fn, args || {}); }
    catch (e) { throw new Error(navigator.onLine === false ? 'You are offline. The storefront needs a connection to save changes.' : 'Could not reach the server. Check your connection and try again.'); }
    const { data, error } = r;
    if (error) { const e = new Error(error.message || 'Something went wrong'); e.status = error.status; throw e; }
    return data;
  } finally {
    busy--; if (!busy) document.documentElement.removeAttribute('aria-busy');
  }
}

async function apiPost(path, body) {
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch(CFG.url.replace(/\/$/, '') + path, {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + (session?.access_token || '') }, body: JSON.stringify(body || {}),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || 'Something went wrong');
  return out;
}
export { apiPost };

// Merges a fresh sfx_context() result into the shared `state` object in place (so every already-rendered
// read of `state.xxx` elsewhere in this app keeps working without that module needing to re-import anything).
export function applyContext(ctx) {
  Object.assign(state.business, { name: ctx.tenant.name, email: ctx.store.config.email || '', phone: ctx.store.config.phone || '', currency: ctx.store.config.currency || 'INR', brandName: ctx.store.config.brandName || '' });
  state.store = { theme: ctx.store.theme, published: ctx.store.published, razorpayConnected: ctx.razorpayConnected, config: ctx.store.config };
  state.builder = { theme: ctx.store.theme };
  state.perms = ctx.perms;
  state.counts = ctx.counts;
  state.tenant = ctx.tenant;
  perms = ctx.perms;
}

function toVariant(v) { return { id: v.id, label: v.label, sku: v.sku || '', barcode: v.barcode || '', price: Number(v.price), stock: Number(v.stock) }; }
export function toProduct(p) {
  return {
    id: p.id, name: p.name, handle: p.handle || p.id, category: p.category || '', description: p.description || '',
    status: p.status === 'active' ? 'Active' : p.status === 'archived' ? 'Archived' : 'Draft',
    price: Number(p.price), compare: p.compareAt ?? '', image: (p.images || [])[0] || '', media: p.images || [],
    sku: (p.variants || [])[0]?.sku || '', stock: Number(p.stock || 0),
    variants: (p.variants || []).map(toVariant), channels: ['Online store'], tags: '', options: '', custom: {}, extra: p.extra || {},
  };
}
export function toCollection(c) {
  return { id: c.id, name: c.name, handle: c.handle || c.id, description: c.description || '', image: c.image || '', productCount: c.productCount || 0, products: (c.products || []).map((p) => p.id) };
}
export function toOrder(o) {
  return {
    id: o.id, number: o.number, customer: o.customerName || '', total: Number(o.total),
    payment: o.paymentStatus === 'paid' ? 'Paid' : o.paymentStatus === 'failed' ? 'Failed' : 'Pending',
    status: o.status === 'fulfilled' ? 'Fulfilled' : o.status === 'cancelled' ? 'Cancelled' : o.status === 'returned' ? 'Returned' : 'Unfulfilled',
    channel: 'Online store', quantity: (o.lines || []).reduce((s, l) => s + (l.qty || 1), 0), date: String(o.createdAt || '').slice(0, 10),
    item: (o.lines || [])[0]?.name || '', note: o.note || '', tracking: o.tracking || '', lines: o.lines || [], timeline: o.timeline || [],
  };
}

export async function refreshProducts() { state.products = (await api('sfx_product_list')).map(toProduct); }
export async function refreshCollections() { state.collections = (await api('sfx_collection_list')).map(toCollection); }
export async function refreshOrders() { state.orders = (await api('sfx_order_list')).map(toOrder); }
export async function refreshCustomers() { state.customers = await api('sfx_customer_list'); }
export async function refreshDiscounts() { state.discounts = await api('sfx_discount_list'); }
export async function refreshInventory() { const [inv, mv] = await Promise.all([api('sfx_inventory_list'), api('sfx_stock_moves_list', {})]); state.inventory = inv; state.stockMoves = mv; }
export async function refreshLocations() { const [locs, mv, inv] = await Promise.all([api('sfx_location_list'), api('sfx_stock_moves_list', {}), api('sfx_inventory_list')]); state.locations = locs; state.stockMoves = mv; state.inventory = inv; }
export async function refreshCategories() { const [c, t] = await Promise.all([api('sfx_category_list'), api('sfx_product_tags')]); state.categories = c; state.productTags = t; }
export async function refreshDrafts() { const [d, i] = await Promise.all([api('sfx_draft_list'), api('sfx_inventory_list')]); state.drafts = d; state.inventory = i; }
export async function refreshReturns() { state.returns = await api('sfx_return_list'); }
export async function refreshAbandoned() { const [a, c] = await Promise.all([api('sfx_abandoned_list'), api('sfx_checkout_settings_get')]); state.abandoned = a; state.checkout = c; }
export async function refreshCheckout() { state.checkout = await api('sfx_checkout_settings_get'); }
export async function refreshCompanies() { const [c, cu] = await Promise.all([api('sfx_company_list'), api('sfx_customer_list')]); state.companies = c; state.customers = cu; }
export async function refreshSegments() { state.segments = await api('sfx_segment_list'); }
export async function refreshCampaigns() { const [c, d] = await Promise.all([api('sfx_campaign_list'), api('sfx_discount_list')]); state.campaigns = c; state.discounts = d; }
export async function refreshRoles() {
  const [r, st] = await Promise.all([sb.from('roles').select('*').order('name'), sb.from('profiles').select('*').order('email')]);
  state.roles = r.data || []; state.staffList = st.data || [];
}
export async function refreshPlan() { state.plan = await api('sfx_status'); }
export async function refreshDomains() { state.domains = await api('sfx_domain_list'); }
// Theme marketplace (db/375): the approved listing (built-ins + developer themes) and this store's own
// installs (its own draft/published copy of each theme it has installed -- see that migration's own
// comment on why an install is a copy, never a live reference back to the developer's listing).
export async function refreshMarketplace() { state.marketplace = await api('sfx_theme_marketplace_list'); }
export async function refreshInstalls() { state.installs = await api('sfx_theme_install_list'); }

async function blocked(title, message) {
  document.title = title;
  document.body.innerHTML = '<div class="shell" style="display:grid;place-items:center;min-height:100vh;text-align:center;padding:24px"><div><h1 style="font-size:20px">' + title + '</h1><p style="color:var(--mut,#666)">' + message + '</p><a class="btn primary" href="https://auzslab.in/signup.html" style="display:inline-block;margin-top:12px;padding:10px 18px;border-radius:10px;background:#18291f;color:#fff;text-decoration:none">Back to AUZslab</a></div></div>';
}
function showLogin(message) {
  document.title = 'Sign in — AUZslab storefront';
  document.body.innerHTML = '<div class="shell" style="display:grid;place-items:center;min-height:100vh;text-align:center;padding:24px"><div><h1 style="font-size:20px">Sign in required</h1><p style="color:var(--mut,#666)">' + (message || 'Sign in with your AUZslab account to open your storefront.') + '</p><a class="btn primary" href="https://auzslab.in/signup.html" style="display:inline-block;margin-top:12px;padding:10px 18px;border-radius:10px;background:#18291f;color:#fff;text-decoration:none">Sign in</a></div></div>';
}

// Same bootstrap shape as app/public/mob/shell.js's boot(): a real session, a real my_dashboard() tenant
// match (never trust the subdomain alone), a real feature check, then the storefront's own context.
export async function boot(onReady) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return showLogin();
  let dash;
  try { dash = await api('my_dashboard'); } catch (e) { if (e.status === 401) return showLogin('Your session ended. Please sign in again.'); return blocked('Could not load', e.message); }
  const slug = window.TENANT_SLUG;
  if (slug && dash.tenant && dash.tenant.slug !== slug) { await sb.auth.signOut(); return showLogin('This login belongs to a different business (' + dash.tenant.slug + '.auzslab.in).'); }
  if (!(dash.features || {}).storefront || (dash.enabled_features || {}).storefront === false) {
    return blocked('AUZslab storefront is not switched on', 'Ask AUZslab to switch on the storefront platform for this business, then reload this page.');
  }
  let ctx;
  try { ctx = await api('sfx_context'); } catch (e) { return blocked('Could not open your storefront', e.message); }
  applyContext(ctx);
  try { await Promise.all([refreshProducts(), refreshCollections(), refreshOrders(), refreshMarketplace(), refreshInstalls(), refreshPlan()]); } catch (e) { /* home still renders; individual pages retry their own fetch */ }
  onReady();
}
