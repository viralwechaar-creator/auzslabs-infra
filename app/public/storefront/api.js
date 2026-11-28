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
    status: o.fulfilmentStatus === 'partial' && o.status !== 'cancelled' && o.status !== 'returned' ? 'Partially fulfilled' : o.status === 'fulfilled' ? 'Fulfilled' : o.status === 'cancelled' ? 'Cancelled' : o.status === 'returned' ? 'Returned' : 'Unfulfilled',
    channel: o.channel === 'in_store' ? 'In-store' : 'Online store', fulfilment: o.fulfilmentStatus || 'unfulfilled', delivery: o.deliveryStatus || 'none', oversold: !!o.oversold, shipments: o.shipments || [], remaining: o.remaining || [], quantity: (o.lines || []).reduce((s, l) => s + (l.qty || 1), 0), date: String(o.createdAt || '').slice(0, 10),
    tags: o.tags || [], archived: !!o.archived, customerId: o.customerId || '', contact: o.customer || {}, paymentMethod: o.paymentMethod || '', subtotal: Number(o.subtotal || 0), shippingFee: Number(o.shipping || 0), taxAmount: Number(o.tax || 0), discountCode: o.discountCode || '', discountAmount: Number(o.discountAmount || 0), attribution: o.attribution || {}, isTest: !!o.isTest, refunded: Number(o.refundedAmount || 0), refundState: o.refundState || 'none', refunds: o.refunds || [], cancelReason: o.cancelReason || '', item: (o.lines || [])[0]?.name || '', note: o.note || '', tracking: o.tracking || '', lines: o.lines || [], timeline: o.timeline || [],
  };
}

export async function refreshProducts() { state.products = (await api('sfx_product_list')).map(toProduct); }
export async function refreshMemberships() { try { state.memberships = await api('sfx_collection_memberships'); } catch (e) { state.memberships = state.memberships || {}; } }
// Compresses a chosen photo in the browser (max 1600 px wide, WebP/JPEG) and stores it in the business's own uploads folder.
export async function uploadImage(file) {
  if (!/^image\//.test(file.type)) throw new Error('"' + file.name + '" is not an image.');
  const bmp = await new Promise((res, rej) => { const url = URL.createObjectURL(file), img = new Image(); img.onload = () => { URL.revokeObjectURL(url); res(img); }; img.onerror = () => rej(new Error('Could not read "' + file.name + '".')); img.src = url; });
  const sc = Math.min(1, 1600 / bmp.width), c = document.createElement('canvas'); c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.82)); if (!blob) throw new Error('Could not process "' + file.name + '".');
  const name = 'storefront/' + Date.now() + '-' + Math.random().toString(36).slice(2, 7) + '.jpg';
  const { error } = await sb.storage.from('site').upload(name, blob, { contentType: 'image/jpeg' }); if (error) throw new Error(error.message || 'Upload failed');
  return sb.storage.from('site').getPublicUrl(name).data.publicUrl;
}
export async function refreshCollections() { state.collections = (await api('sfx_collection_list')).map(toCollection); }
export async function refreshOrders() { state.orders = (await api('sfx_order_list')).map(toOrder); }
export async function refreshStyleLink() { try { state.styleLink = await api('sfx_style_link_status'); } catch (e) { state.styleLink = { available: false, linked: false }; } }
export async function refreshLive() { try { state.liveVisitors = await api('sfx_live_visitors'); } catch (e) { state.liveVisitors = { error: true }; } }
export async function refreshVisitors60() { try { state.visitors60 = await api('sfx_visitor_summary', { p_days: 60 }); } catch (e) { state.visitors60 = { error: true }; } }
export async function refreshVisitors(days = 14) { try { state.visitors = await api('sfx_visitor_summary', { p_days: days }); } catch (e) { state.visitors = { error: true }; } }
export async function refreshCustomers() { state.customers = await api('sfx_customer_list'); }
export async function refreshInsights() {
  const [funnel, profit, inventory, rfm, cohorts, sessions] = await Promise.all([api('sfx_report_funnel', { p_days: 30 }), api('sfx_report_profit', { p_days: 30 }), api('sfx_report_inventory', { p_days: 30 }), api('sfx_report_rfm'), api('sfx_report_cohorts', { p_months: 6 }), api('sfx_report_sessions', { p_days: 30 })]);
  let layout = null; try { layout = await api('sfx_dashboard_layout_get'); } catch (e) { layout = null; }
  state.insights = { funnel, profit, inventory, rfm, cohorts, sessions, layout };
}
export async function refreshAccess() {
  const [audit, staff, messages, bills, keys, route, settlements, hooks] = await Promise.all([api('sfx_audit_list', { p_limit: 100 }).catch(() => null), api('sfx_staff_security').catch(() => null), api('sfx_message_log', { p_limit: 100 }).catch(() => []), api('sfx_billing_history').catch(() => null),
    api('sfx_api_key_list').catch(() => null), api('sfx_route_status').catch(() => null), api('sfx_settlement_list', { p_limit: 50 }).catch(() => null), api('sfx_webhook_list').catch(() => null)]);
  state.access = { audit, staff, messages, bills, keys, route, settlements, hooks };
}
export async function refreshBlog() { state.blog = await api('sfx_blog_list'); }
export async function refreshRedirects() { state.redirects = await api('sfx_redirect_list'); }
export async function refreshRevisions() { state.revisions = await api('sfx_revision_list'); }
export async function refreshCustomFields() { const [d, o] = await Promise.all([api('sfx_metafield_def_list'), api('sfx_metaobject_def_list')]); state.metaDefs = d; state.metaObjectDefs = o; }
export async function refreshDiscounts() { state.discounts = await api('sfx_discount_list'); }
export async function refreshInventory() { const [inv, mv, ck] = await Promise.all([api('sfx_inventory_list'), api('sfx_stock_moves_list', {}), api('sfx_checkout_settings_get')]); state.checkout = ck; state.inventory = inv; state.stockMoves = mv; }
export async function refreshLocations() { const [locs, mv, inv] = await Promise.all([api('sfx_location_list'), api('sfx_stock_moves_list', {}), api('sfx_inventory_list')]); state.locations = locs; state.stockMoves = mv; state.inventory = inv; }
export async function refreshCategories() { const [c, t] = await Promise.all([api('sfx_category_list'), api('sfx_product_tags')]); state.categories = c; state.productTags = t; }
export async function refreshDrafts() { const [d, i] = await Promise.all([api('sfx_draft_list'), api('sfx_inventory_list')]); state.drafts = d; state.inventory = i; }
export async function refreshReturns() { state.returns = await api('sfx_return_list'); }
export async function refreshAbandoned() { const [a, c] = await Promise.all([api('sfx_abandoned_list'), api('sfx_checkout_settings_get')]); state.abandoned = a; state.checkout = c; }
export async function refreshStoreDir() { state.storeDir = await api('sfx_stores_get'); }
export async function refreshLanguages() { state.languages = await api('sfx_languages_get'); }
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
export async function refreshInstalls() {
  state.installs = await api('sfx_theme_install_list');
  if (!state.sectionTypes || !state.sectionTypes.length) { try { state.sectionTypes = await api('sfx_section_registry'); } catch (e) { state.sectionTypes = []; } }
  if (!state.metaDefs) { try { state.metaDefs = await api('sfx_metafield_def_list'); } catch (e) { state.metaDefs = []; } }
  if (!state.designSettings || !state.designSettings.length) { try { state.designSettings = await api('sfx_design_registry'); } catch (e) { state.designSettings = []; } }
}

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
  applyContext(ctx); state.features = dash.features || {};
  try { await Promise.all([refreshProducts(), refreshCollections(), refreshMemberships(), refreshCategories(), refreshOrders(), refreshMarketplace(), refreshInstalls(), refreshPlan()]); } catch (e) { /* home still renders; individual pages retry their own fetch */ }
  onReady();
}
