/* AUZslab POS core: state, local store, sync engine, billing math, numbering.
   The local store is the same IndexedDB ('pos3') and record shapes as the previous POS, so devices keep their data
   and the back office, admin console, dashboard and public invoice keep reading the same orders.
   Sync: every write goes to IndexedDB and an outbox, then push_record (optimistic concurrency). A write the server
   refuses on a business rule (db/068: a cashier voiding a paid bill, a discount over the limit without approval)
   is rolled back to the server's copy and the cashier is told why, instead of sitting in the outbox for ever. */
'use strict';
const VAPID_PUBLIC = 'BN_aBfhAkcWmYJ8RArUKpcXFBId6rUsNO7bAuhyPr4To51XeATMoWY-8NxtJMCG_iHm4O4UbhV_EZnxloXkEMe4';
const C = window.CFG || {}, sb = supabase.createClient(C.url, C.key);
const S = {
  tab: 'sell', cur: null, role: 'cashier', role_id: null, perms: null, features: null, enabledFeatures: {}, user: null, authExpired: false,
  q: '', cat: null, vf: 'all', ordersSeg: 'open', kSt: 'All', kTy: 'All', tblSec: null, resDay: null, resSeg: 'res', bookings: [], bookingsDay: null,
  pinStatus: null, kotFrom: null, kotTo: null, kotQ: '',
};
const R = {}, V = {};
let busy = 0, conflicts = 0, syncErr = 0, lastSyncErrMsg = '', syncAgain = 0, STAFF_LIST = [];

// ---------- small helpers ----------
const $ = (s, el) => (el || document).querySelector(s), $$ = (s, el) => [...(el || document).querySelectorAll(s)];
const uid = () => crypto.randomUUID(), tok = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12), now = () => new Date().toISOString();
const r2 = (n) => Math.round((+n || 0) * 100) / 100;
const inr = (n) => (n < 0 ? '−₹' : '₹') + Math.abs(r2(n)).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const today = () => new Date().toLocaleDateString('en-CA');
const localDay = (iso) => (iso ? new Date(iso).toLocaleDateString('en-CA') : '');
const addDays = (d, n) => { const x = new Date(d + 'T12:00'); x.setDate(x.getDate() + n); return x.toLocaleDateString('en-CA'); };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const digits = (s) => String(s || '').replace(/\D/g, '');
const minsSince = (iso) => Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
const fmtTime = (iso) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDay = (d) => { const t = new Date(d.length === 10 ? d + 'T12:00' : d); return t.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }); };
const fmtDate = (d) => { const t = new Date(d); return t.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); };
const plural = (n, w, p) => n + ' ' + (n === 1 ? w : p || w + 's');
const cap1 = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);

// DOM builder: text is always set as text, never parsed as HTML
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag); let val;
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k.startsWith('on')) e[k] = v;
    else if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k === 'value') val = v;
    else if (k === 'checked') e.checked = !!v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  e.append(...kids.flat(9).filter((c) => c != null && c !== false && c !== true).map((c) => (c instanceof Node ? c : String(c))));
  if (val !== undefined) e.value = val;
  return e;
}
const clear = (el) => { el.replaceChildren(); return el; };

// line icons (static markup, 24px grid, stroke follows the text colour)
const ICONS = {
  moon: '<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>',
  box: '<path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5 12 12l9-4.5M12 12v9"/>',
  book: '<path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z"/><path d="M5 17a3 3 0 0 1 3-3h11"/>',
  sidebar: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/>',
  ledger: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  payroll: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M17 8v8M15 10h3a1.5 1.5 0 0 1 0 3h-2a1.5 1.5 0 0 0 0 3h3"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
  sell: '<path d="M6 7h12l-1.2 12.2a2 2 0 0 1-2 1.8H9.2a2 2 0 0 1-2-1.8z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
  tables: '<rect x="3" y="4" width="18" height="6" rx="2"/><path d="M6 10v10M18 10v10M3 15h18"/>',
  orders: '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  kitchen: '<path d="M12 3c1.5 3-2 4.5-2 8a2 2 0 1 0 4 0c0-1.5-.7-2.2-.7-2.2s1.7.8 1.7 3.2a4 4 0 1 1-8 0c0-4.5 3.5-5.5 5-9Z"/>',
  reserve: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M8 15h3"/>',
  register: '<rect x="3" y="7" width="18" height="12" rx="2"/><path d="M3 11h18M7 15h3M6 7V4h12v3"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  kot: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z"/><path d="M9 8h6M9 12h6"/>',
  token: '<path d="M5 9h14M5 15h14M9 4 7 20M17 4l-2 16"/>',
  staff: '<circle cx="9" cy="8" r="3.2"/><path d="M2.5 20v-1a6.5 6.5 0 0 1 13 0v1"/><path d="M16.5 5a3.2 3.2 0 0 1 0 6.2M21 20v-1a5.6 5.6 0 0 0-4-5.4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>', check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  chev: '<path d="M9 5l7 7-7 7"/>', back: '<path d="M15 5l-7 7 7 7"/>', down: '<path d="M5 9l7 7 7-7"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', bell: '<path d="M12 3a5 5 0 0 0-5 5v3.5c0 1-.4 2-1.2 2.7L5 15h14l-.8-.8A4 4 0 0 1 17 11.5V8a5 5 0 0 0-5-5Z"/><path d="M10 18a2 2 0 0 0 4 0"/>',
  person: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20a7 7 0 0 1 14 0"/>', people: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.6"/><path d="M15.5 14.2A5 5 0 0 1 21 19"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>', calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  printer: '<path d="M7 8V3h10v5"/><rect x="3" y="8" width="18" height="9" rx="2"/><path d="M7 14h10v7H7z"/>', share: '<path d="M12 3v12M8 7l4-4 4 4"/><path d="M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>', edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M14 6l4 4"/>',
  note: '<path d="M5 4h14v12l-4 4H5z"/><path d="M15 20v-4h4M8 9h8M8 13h5"/>', percent: '<path d="M19 5 5 19"/><circle cx="7" cy="7" r="2.5"/><circle cx="17" cy="17" r="2.5"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>', gift: '<rect x="4" y="9" width="16" height="11" rx="1"/><path d="M4 9h16M12 9v11M8 9c-1.5 0-3-1-3-3s1.5-2 3-1c1 .6 2 2 3 4zM16 9c1.5 0 3-1 3-3s-1.5-2-3-1c-1 .6-2 2-3 4z"/>',
  cash: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9v.01M18 15v.01"/>', card: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="M2.5 10h19M6 15h4"/>',
  qr: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3M21 14v.01M17 21h4v-4M14 18v3"/>',
  wallet: '<path d="M4 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a1 1 0 0 1-1-1z"/><path d="M4 7l11-3v3M16 13h1"/>',
  move: '<path d="M7 7h13l-3-3M17 17H4l3 3"/>', merge: '<path d="M6 4v5a5 5 0 0 0 5 5h7M14 10l4 4-4 4M6 20v-3"/>', split: '<path d="M12 21v-7l-6-6V4M12 14l6-6V4M4 6l2-2 2 2M16 6l2-2 2 2"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2Z"/><path d="M9 8h6M9 12h6M9 16h3"/>', alert: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17v.01"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>', gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',
  logout: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11"/>', home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/>', chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  truck: '<path d="M3 7h11v9H3z"/><path d="M14 11h4l3 3v2h-7z"/><circle cx="7" cy="18" r="1.6"/><circle cx="17.5" cy="18" r="1.6"/>', bike: '<circle cx="6" cy="17" r="3"/><circle cx="18" cy="17" r="3"/><path d="M6 17l4-8h5l3 8M10 9 8 5H6M15 9l-2 8"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>', star: '<path d="M12 3l2.6 5.6 6.1.6-4.6 4.1 1.3 6-5.4-3.2-5.4 3.2 1.3-6-4.6-4.1 6.1-.6z"/>',
  chat: '<path d="M4 5h16v11H8l-4 4z"/>', sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M18 6l-2.5 2.5M8.5 15.5 6 18"/>',
  door: '<path d="M5 21V4h11v17M3 21h18M13 12v.01"/>', broom: '<path d="M14 3l-4 9M8 12h8l2 9H6z"/>', globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
  building: '<path d="M3 21h18M5 21V5l7-2v18M19 21V9l-7-2"/><path d="M8 9v.01M8 13v.01M8 17v.01"/>', bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.2A10.7 10.7 0 0 1 12 5c6.4 0 10 7 10 7a15.6 15.6 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.8 9.8 0 0 0 3.6-.7"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>',
  apple: '<path fill="currentColor" stroke="none" d="M16.365 1.43c0 1.14-.46 2.1-1.17 2.83-.78.8-2.03 1.42-3.09 1.33-.12-1.1.46-2.25 1.15-2.97.78-.83 2.17-1.46 3.11-1.19ZM20.6 17.17c-.46 1.06-.68 1.53-1.27 2.47-.82 1.3-1.98 2.93-3.41 2.94-1.27.02-1.6-.83-3.33-.82-1.73.01-2.09.84-3.36.82-1.43-.02-2.53-1.48-3.35-2.78-2.3-3.63-2.54-7.89-1.12-10.16.99-1.6 2.56-2.54 4.03-2.54 1.5 0 2.44.84 3.68.84 1.2 0 1.93-.85 3.66-.85 1.32 0 2.71.72 3.7 1.96-3.25 1.78-2.72 6.42.77 8.12Z"/>',
};
function icon(n, s = 20, w = 1.8) {
  const e = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  e.setAttribute('class', 'i'); e.setAttribute('width', s); e.setAttribute('height', s); e.setAttribute('viewBox', '0 0 24 24'); e.setAttribute('fill', 'none');
  e.setAttribute('stroke', 'currentColor'); e.setAttribute('stroke-width', w); e.setAttribute('stroke-linecap', 'round'); e.setAttribute('stroke-linejoin', 'round'); e.setAttribute('aria-hidden', 'true');
  e.innerHTML = ICONS[n] || '';
  return e;
}

// ---------- records ----------
// Multi-outlet: records of these kinds belong to one outlet (data.outlet, 'main' when absent). The chosen outlet lives in localStorage so the POS, Back Office and Admin console agree.
const OUTK = new Set(['order', 'kotlog', 'exp', 'cashmove', 'waste', 'adjustment', 'transfer', 'ing', 'po', 'purchase', 'shift', 'dayclose', 'table', 'voidlog', 'closing', 'register', 'waitlist']);
const outletId = () => { try { return localStorage.outlet || 'main'; } catch { return 'main'; } };
const outletKey = () => (outletId() === 'all' ? 'main' : outletId());
function L(kind) {
  const o = outletId(), out = [];
  for (const id in R) { const r = R[id]; if (r.kind === kind && !r.deleted) out.push(r.data); }
  return OUTK.has(kind) && o !== 'all' ? out.filter((d) => (d.outlet || 'main') === o) : out;
}
const rec = (id) => (id && R[id] && !R[id].deleted ? R[id].data : null);
const tn = (id) => { const t = rec(id); return t ? t.name : ''; };
const cfg = () => ({
  name: 'My Restaurant', addr: '', phone: '', gstin: '', tax: 5, prefix: 'INV', col: null, logo: '/logo.png', ftr: 'Thank you!', w: 80, sty: 'mono', fs: 12,
  bizType: 'restaurant', loyaltyOn: true, loyaltyEarnRs: 100, loyaltyRedeemRs: 1, roundOff: true, requirePhone: true, serviceChargePct: 0, packingCharge: 0,
  deliveryCharge: 0, tipPrompt: false, maxDiscountPct: 0, kdsTargetMin: 15, resMinutes: 90, taxInclusive: false, printOnPay: true,
  ...(R.settings && R.settings.data),
});
const bizType = () => cfg().bizType || 'restaurant';
const isRetail = () => bizType() === 'retail';
const isRestaurant = () => ['restaurant', 'cafe'].includes(bizType());
const NICHE_ACCENT = { restaurant: '#800020', salon: '#7a3b6e', retail: '#1f3d6b' };
// The business colour: ds/brand.js sets --brand (and the lifted dark-mode versions) and remembers it for the other apps.
function applyTheme() { auzBrand(cfg().col || NICHE_ACCENT[bizType()] || '#800020'); }

// ---------- permissions ----------
const DEFAULT_PERMS = { pos: true, orders: true, kitchen: true, reports: true, staff: true, inventory: true, crm: true, menu: false, settings: false, billing: false };
function can(x) {
  if (S.role === 'owner') return true;
  if (x === 'o') return false;
  const p = S.perms || (S.role === 'manager' ? { ...DEFAULT_PERMS, billing: true } : DEFAULT_PERMS);
  return x === 'm' ? !!p.billing : !!p[x];
}
const featureOn = (k) => !S.features || (S.features[k] === true && S.enabledFeatures[k] !== false);
const myName = () => { const me = STAFF_LIST.find((p) => S.user && p.id === S.user.id); return (me && (me.name || me.email)) || (S.user && S.user.email) || S.role; };
const staffName = (id) => { const p = STAFF_LIST.find((x) => x.id === id); return p ? p.name || p.email : ''; };

// ---------- local store ----------
const idb = new Promise((res) => { const q = indexedDB.open('pos3', 1); q.onupgradeneeded = () => ['rec', 'out', 'meta'].forEach((s) => q.result.createObjectStore(s, { keyPath: s === 'meta' ? 'k' : 'id' })); q.onsuccess = () => res(q.result); });
const tx = async (s, m, f) => { const d = await idb; return new Promise((res, rej) => { const t = d.transaction(s, m), q = f(t.objectStore(s)); t.oncomplete = () => res(q.result); t.onerror = () => rej(t.error); }); };
const all = (s) => tx(s, 'readonly', (o) => o.getAll()), get = (s, k) => tx(s, 'readonly', (o) => o.get(k)), put = (s, v) => tx(s, 'readwrite', (o) => o.put(v));
const del = (s, k) => tx(s, 'readwrite', (o) => o.delete(k)), clr = (s) => tx(s, 'readwrite', (o) => o.clear());

async function save(kind, data, id = data.id || uid(), deleted = false) {
  data.id = id;
  if (OUTK.has(kind) && !data.outlet) data.outlet = outletKey();
  const prev = R[id], r = { id, kind, data, deleted, updated_at: now(), srv: prev && prev.srv };
  R[id] = r; await put('rec', r);
  await put('out', { id, kind, data, deleted, updated_at: r.updated_at, base: (prev && prev.srv) || null });
  sync(); return r;
}

// ---------- sync ----------
const isRule = (e) => e && [400, 403, 409].includes(e.status);
const isAuth = (e) => e && (e.status === 401 || /JWT|expired|invalid token/i.test(e.message || ''));
async function rejectLocal(r, msg) {
  // the server refused this change on a business rule: drop it and take the server's copy back
  await del('out', r.id);
  let row = null;
  try { const { data } = await sb.from('records').select('id,kind,data,deleted,updated_at').eq('id', r.id).single(); row = data; } catch {}
  if (row) { R[r.id] = { ...row, srv: row.updated_at }; await put('rec', R[r.id]); }
  else { delete R[r.id]; await del('rec', r.id); }
  if (S.cur && S.cur.id === r.id) S.cur = row && !row.deleted && row.data.status === 'open' ? structuredClone(row.data) : null;
  toast('Not saved: ' + (msg || 'refused by the server'), { err: true });
  if (typeof render === 'function') render();
}
async function doSync() {
  if (busy || !navigator.onLine || !S.user) return;
  busy = 1; conflicts = 0; let hadError = false;
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { busy = 0; return forceRelogin('Your session ended. Please sign in again.'); }
    for (const r of await all('out')) {
      try {
        const args = { rid: r.id, rkind: r.kind, rdata: r.data, rdeleted: r.deleted, base: (R[r.id] && R[r.id].srv) || r.base || null, force: false };
        const { data: res, error } = await sb.rpc('push_record', args);
        if (error) { if (isAuth(error)) { busy = 0; return forceRelogin('Your session ended. Please sign in again.'); } if (isRule(error)) { await rejectLocal(r, error.message); continue; } throw error; }
        let sv = res.server_updated_at;
        if (res.conflict) {
          conflicts++;
          const { data: res2, error: e2 } = await sb.rpc('push_record', { ...args, base: null, force: true });
          if (e2) { if (isRule(e2)) { await rejectLocal(r, e2.message); continue; } throw e2; }
          sv = res2.server_updated_at;
        }
        if (R[r.id]) R[r.id].srv = sv;
        const c = await get('out', r.id); if (c && c.updated_at === r.updated_at) await del('out', r.id);
      } catch (e) { hadError = true; syncErr++; lastSyncErrMsg = (e && e.message) || String(e); console.warn('sync item', r.id, e); }
    }
    const since = ((await get('meta', 'since')) || {}).v || '1970-01-01T00:00:00Z';
    const { data, error } = await sb.from('records').select('id,kind,data,deleted,updated_at').gte('updated_at', since).order('updated_at').limit(1000);
    if (error) throw error;
    let ch = 0;
    for (const row of data) {
      if (await get('out', row.id)) continue;
      if (R[row.id] && R[row.id].updated_at === row.updated_at) continue;
      const r = { ...row, srv: row.updated_at }; R[row.id] = r; await put('rec', r); ch++;
    }
    if (data.length) await put('meta', { k: 'since', v: data[data.length - 1].updated_at });
    if (ch) { checkAlerts(); if (!isTyping()) render(); }
    if (data.length >= 1000) setTimeout(sync, 500);
    if (!hadError) { syncErr = 0; lastSyncErrMsg = ''; }
  } catch (e) { hadError = true; syncErr++; lastSyncErrMsg = (e && e.message) || String(e); console.warn('sync', e); }
  busy = 0; setNote();
  if (syncAgain) { syncAgain = 0; setTimeout(sync, 50); }
}
function sync() { if (busy) { syncAgain = 1; return; } if (navigator.locks) navigator.locks.request('pos-sync', { ifAvailable: true }, (lock) => (lock ? doSync() : null)); else doSync(); }
function syncNow() { return navigator.locks ? navigator.locks.request('pos-sync', {}, () => doSync()) : doSync(); }
const isTyping = () => /INPUT|SELECT|TEXTAREA/.test((document.activeElement || {}).tagName || '') || !!document.querySelector('.ov');
async function setNote() {
  const n = (await all('out')).length, e = $('#net'); if (!e) return;
  const off = !navigator.onLine, bad = syncErr > 0;
  e.className = 'status' + (off ? ' off' : bad ? ' err' : '');
  e.replaceChildren(h('i'), off ? 'Offline' + (n ? ' · ' + n + ' to sync' : '') : bad ? 'Sync problem' + (lastSyncErrMsg ? ': ' + lastSyncErrMsg : '') : n ? n + ' to sync' : 'Synced');
  e.title = conflicts ? conflicts + ' edit conflict(s) resolved' : '';
}
function forceRelogin(msg) { S.user = null; S.authExpired = false; localStorage.removeItem('u'); login(msg); }

// ---------- numbering ----------
function localNo() { const n = (+localStorage.n || 0) + 1; localStorage.n = n; const d = localStorage.dev || (localStorage.dev = Math.random().toString(36).slice(2, 4).toUpperCase()); return cfg().prefix + '-' + d + '-' + String(n).padStart(4, '0'); }
async function nextNo() { if (navigator.onLine) { try { const { data, error } = await sb.rpc('next_invoice_no', { prefix: cfg().prefix }); if (!error && data) return data; } catch {} } return localNo() + '~'; }
async function nextKot() {
  const day = today();
  if (navigator.onLine) { try { const { data, error } = await sb.rpc('next_kot_no', { p_day: day, p_outlet: outletKey() }); if (!error && data) return String(data); } catch {} }
  const k = 'kot.' + day, n = (+localStorage[k] || 0) + 1; localStorage[k] = n; return 'L' + n;  // offline: a device-local number, marked L
}
function nextToken() { const day = today(), nums = L('order').filter((o) => o.token && o.tokenDay === day).map((o) => o.token); return nums.length ? Math.max(...nums) + 1 : 1; }

// ---------- billing math ----------
// A line uses its item's tax record (Admin console -> Menu -> Taxes) when it has one, else the business default.
// Inclusive pricing comes from that tax record, else the business setting.
const taxOf = (l) => { const it = rec(l.id); return it && it.taxId ? rec(it.taxId) : null; };
const lineRate = (l) => { const t = taxOf(l); return t ? +t.rate || 0 : +cfg().tax || 0; };
const lineInclusive = (l) => { const t = taxOf(l); return t && t.inclusive != null ? !!t.inclusive : !!cfg().taxInclusive; };
function chargesOf(o, net) {
  const c = cfg();
  if (o.complimentary || !(net > 0)) return { svc: 0, pack: 0, deliv: 0 };
  return {
    svc: o.type === 'Dine-in' && +c.serviceChargePct > 0 && !o.noSvc ? r2((net * c.serviceChargePct) / 100) : 0,
    pack: (o.type === 'Takeaway' || o.type === 'Delivery') && +c.packingCharge > 0 ? r2(+c.packingCharge) : 0,
    deliv: o.type === 'Delivery' && +c.deliveryCharge > 0 ? r2(+c.deliveryCharge) : 0,
  };
}
function tot(o) {
  const c = cfg(), lines = o.lines || [];
  const sub = r2(lines.reduce((a, l) => a + l.price * l.qty, 0));
  let d = 0;
  if (o.complimentary) d = sub;
  else if (o.disc) d = r2(Math.min(sub, o.disc.t === '%' ? (sub * o.disc.v) / 100 : +o.disc.v || 0));
  const keep = sub ? (sub - d) / sub : 1, rates = {};
  let base = 0, tax = 0;
  for (const l of lines) {
    const g = l.price * l.qty * keep, rt = lineRate(l), inc = lineInclusive(l), b = inc ? g / (1 + rt / 100) : g, t = inc ? g - b : (g * rt) / 100;
    base += b; tax += t; const x = rates[rt] || (rates[rt] = { base: 0, tax: 0 }); x.base += b; x.tax += t;
  }
  const ch = chargesOf(o, sub - d), chSum = ch.svc + ch.pack + ch.deliv, chRate = +(c.chargesTax ?? c.tax) || 0;
  if (chSum) { const x = rates[chRate] || (rates[chRate] = { base: 0, tax: 0 }); x.base += chSum; x.tax += (chSum * chRate) / 100; tax += (chSum * chRate) / 100; }
  base = r2(base); tax = r2(tax);
  const ex = r2(base + chSum + tax), total = c.roundOff === false ? ex : Math.round(ex);
  for (const k in rates) rates[k] = { base: r2(rates[k].base), tax: r2(rates[k].tax) };
  const t = { sub, d, tax, round: r2(total - ex), total, net: r2(base + chSum), rates };
  if (ch.svc) t.svc = ch.svc; if (ch.pack) t.pack = ch.pack; if (ch.deliv) t.deliv = ch.deliv;
  return t;
}
const paidSoFar = (o) => r2((o.pays || []).reduce((a, p) => a + (+p.amt || 0), 0));
const refundedOf = (o) => r2((o.refunds || []).reduce((a, r) => a + (+r.amt || 0), 0));
const netOf = (o) => r2(((o.t && o.t.total) || 0) - refundedOf(o));
const itemCount = (o) => (o.lines || []).reduce((a, l) => a + l.qty, 0);
const lineKey = (l) => (l.id || '') + '|' + (l.size || '') + '|' + (l.note || '');
const sentQty = (o) => (o.lines || []).reduce((a, l) => a + (l.sent || 0), 0);
const unsent = (o) => (o.lines || []).some((l) => l.qty > (l.sent || 0));
const isManualDisc = (o) => o.disc && !o.coupon && !o.loyaltyRedeemed && !o.complimentary;
// cashiers may give manual discounts up to Settings -> maxDiscountPct without a manager (0 = every manual discount needs one)
function discNeedsManager(o, pctOrAmt, kind) {
  if (can('m')) return false;
  const lim = +cfg().maxDiscountPct || 0, sub = tot(o).sub || 0;
  const pct = kind === '%' ? +pctOrAmt : sub ? (100 * +pctOrAmt) / sub : 100;
  return !(lim > 0 && pct <= lim + 0.001);
}

// coupons: code, % or ₹, expiry, max uses, minimum bill
function couponCheck(code, o) {
  const c = L('coupon').find((x) => (x.code || '').toUpperCase() === code.trim().toUpperCase());
  if (!c) return { err: 'No coupon with that code' };
  if (c.expiry && c.expiry < today()) return { err: 'This coupon expired on ' + fmtDate(c.expiry) };
  if (c.maxUses) { const used = L('order').filter((x) => (x.status === 'paid' || x.status === 'due') && x.coupon === c.code && x.id !== o.id).length; if (used >= c.maxUses) return { err: 'This coupon has been used up' }; }
  if (c.minBill && tot(o).sub < +c.minBill) return { err: 'Needs a bill of at least ' + inr(c.minBill) };
  return { c };
}

// loyalty: points from lifetime spend (no ledger yet, see docs/POS_AUDIT.md backlog)
function custHistory(phone, exceptId) { const p = digits(phone); if (p.length < 10) return []; return L('order').filter((x) => x.id !== exceptId && (x.status === 'paid' || x.status === 'due') && x.cust && digits(x.cust.phone) === p); }
function loyaltyOf(phone, exceptId) {
  const c = cfg(), hist = custHistory(phone, exceptId), earn = +c.loyaltyEarnRs || 100, lifetime = r2(hist.reduce((a, x) => a + netOf(x), 0)), redeemed = hist.reduce((a, x) => a + (x.loyaltyRedeemed || 0), 0);
  return { visits: hist.length, lifetime, points: Math.max(0, Math.floor(lifetime / earn) - redeemed), last: hist.map((x) => x.paidAt || x.created).sort().pop() };
}

// ---------- orders ----------
const newOrder = (extra) => ({ id: uid(), type: isRetail() ? 'Sale' : 'Dine-in', table: null, lines: [], status: 'open', created: now(), by: S.user.id, cust: {}, ...extra });
// The kitchen and the cashier edit the same order record, but the cart (S.cur) is a clone taken when the order was opened. Without this, paying (or sending
// another KOT) wrote the stale clone back over the kitchen's "preparing / ready / dispatched" updates and a paid order popped back into the kitchen queue.
const KFIELDS = ['kstat', 'preparingAt', 'readyAt', 'dispatchAt', 'deliveredAt', 'servedAt'];
function freshCur() { const o = S.cur, live = o && o.id && rec(o.id); if (!live) return; for (const k of KFIELDS) if (live[k] !== undefined) o[k] = live[k]; }
async function persist(o = S.cur) { if (!o.no) o.no = await nextNo(); o.t = tot(o); await save('order', o, o.id); }
const openOrders = () => L('order').filter((o) => o.status === 'open' && o.lines.length && !o.trial);
const tableOrder = (tid) => L('order').find((x) => x.status === 'open' && x.table === tid && x.lines.length);
const busyTable = (tid) => !!tableOrder(tid);

// Build the kitchen ticket for everything not yet sent. Combos are expanded into what the kitchen actually cooks; notes and add-ons travel with the item.
function mk(o, kno) {
  const n = [];
  o.lines.filter((l) => l.qty > (l.sent || 0)).forEach((l) => {
    const rem = l.qty - (l.sent || 0), it = rec(l.id);
    if (it && it.combo && it.comboText) it.comboText.split(',').forEach((p) => { const [cn, cq] = p.split(':'); if (cn && cn.trim()) n.push({ n: cn.trim() + (l.size ? ' (' + l.size + ')' : ''), q: r2((+cq || 1) * rem), s: it.st || 'Kitchen', note: l.note || undefined }); });
    else n.push({ n: l.name + (l.size ? ' (' + l.size + ')' : ''), q: rem, s: l.st || 'Kitchen', note: l.note || undefined });
  });
  const k = o.kstat === 'new';
  o.lines.forEach((l) => (l.sent = l.qty));
  if (n.length) {
    o.knew = (k ? o.knew || [] : []).concat(n);
    o.kotBatches = (k ? o.kotBatches || [] : []).concat([{ time: now(), items: n, no: kno || null }]);
    o.kstat = 'new'; o.ktime = o.ktime && k ? o.ktime : now();
  }
  return n;
}

// stock: recipes on ingredients, retail variants
async function deduRecipe(recipe, mult) {
  for (const p of recipe.split(',')) {
    const [n, q] = p.split(':'), g = L('ing').find((x) => x.name.toLowerCase() === (n || '').trim().toLowerCase());
    if (g && +q) { const used = +q * mult; g.qty = r2(g.qty - used); g.usage = (g.usage || []).concat({ q: used, d: today(), at: now() }).slice(-200); await save('ing', g, g.id); }
  }
}
async function dedu(o) {
  for (const l of o.lines) {
    const it = rec(l.id); if (!it) continue;
    if (it.combo && it.comboText) {
      for (const part of it.comboText.split(',')) { const [cn, cq] = part.split(':'); if (!cn || !cn.trim()) continue; const c = L('item').find((x) => x.name.toLowerCase() === cn.trim().toLowerCase()); if (c && c.rec) await deduRecipe(c.rec, (+cq || 1) * l.qty); }
      continue;
    }
    if (it.rec) await deduRecipe(it.rec, l.qty);
  }
}
async function deduVariant(o) {
  for (const l of o.lines) {
    const it = rec(l.id); if (!it || !it.variants || !it.variants.length || !l.variant) continue;
    const v = it.variants.find((x) => x.size === l.variant.size && (x.color || '') === (l.variant.color || ''));
    if (v) { v.qty = r2((v.qty || 0) - l.qty); v.usage = (v.usage || []).concat({ q: l.qty, d: today(), at: now() }).slice(-200); await save('item', it, it.id); }
  }
}
// a dish cancelled after the kitchen cooked it: its ingredients were used, log the loss
async function deduAndWasteLine(l, q, reason) {
  const it = rec(l.id);
  if (it && it.rec) {
    for (const p of it.rec.split(',')) {
      const [n, qq] = p.split(':'), g = L('ing').find((x) => x.name.toLowerCase() === (n || '').trim().toLowerCase());
      if (g && +qq) { const used = +qq * q; g.qty = r2(g.qty - used); g.usage = (g.usage || []).concat({ q: used, d: today(), at: now() }).slice(-200); await save('ing', g, g.id); await save('waste', { ing: g.name, q: used, d: today(), reason: 'Cancelled after KOT: ' + l.name, itemId: l.id, at: now() }); }
    }
  } else await save('waste', { ing: l.name, q, d: today(), reason, itemId: l.id, at: now() });
}

// availability
const CH_KEY = { 'Dine-in': 'dine', Takeaway: 'take', Delivery: 'deliv' };
function inSchedule(sc) {
  if (!sc || (!sc.from && !sc.to && !(sc.days && sc.days.length))) return true;
  const d = new Date(), hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  if (sc.days && sc.days.length && !sc.days.includes(d.getDay())) return false;
  if (sc.from && sc.to) return sc.from <= sc.to ? hm >= sc.from && hm <= sc.to : hm >= sc.from || hm <= sc.to;
  return true;
}
function itemOff(i, type) {
  if (i.off && (!i.offUntil || new Date(i.offUntil) > new Date())) return true;
  if (i.sched && !inSchedule(i.sched)) return true;
  if (i.chOff && i.chOff[CH_KEY[type || (S.cur && S.cur.type)]]) return true;
  if (!i.rec) return false;
  return i.rec.split(',').some((p) => { const [n] = p.split(':'), g = L('ing').find((x) => x.name.toLowerCase() === (n || '').trim().toLowerCase()); return g && g.qty <= 0; });
}
function menuItems() { const o = outletId(); return L('item').filter((i) => !(i.outletOff && i.outletOff[o])).map((i) => (i.outletPrice && i.outletPrice[o] != null ? { ...i, price: +i.outletPrice[o] } : i)); }
const variantQty = (i) => (i.variants || []).reduce((a, v) => a + (+v.qty || 0), 0);
const dayLocked = (d) => L('dayclose').find((x) => x.d === d);
