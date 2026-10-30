/* AUZsStyle: offline-first engine (db/266). The whole app works with no connection:
   - READS: every list/report/screen answer is saved on the device (IndexedDB) and shown again when the shop is offline.
   - WRITES: every change goes into one ordered queue (localStorage `sty.q.<shop>`). It is sent in batches through POST /sync
     as soon as there is a connection. Each change carries a phone-made id, and the server remembers the ids it has applied
     (sty_ops), so a change that is sent twice is applied once.
   - WHILE WAITING: the pending changes are laid over the saved answers (OVERLAY below), so a new style, a stock
     purchase or a changed setting shows at once, exactly as it will look when it is saved.
   - A change the server refuses (for example "Only 2 in stock") is NOT thrown away: it stays in the "Waiting changes" list
     with the reason, so the owner can retry or discard it.
   Photos and the online store need a connection (they live on the server); everything else works offline. */
'use strict';

// ---------- device storage for saved answers (IndexedDB; falls back to memory) ----------
const KV = {
  db: null, mem: new Map(),
  open() {
    if (this.p) return this.p;
    this.p = new Promise((res) => {
      try {
        const r = indexedDB.open('sty-offline', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => { this.db = r.result; res(this.db); };
        r.onerror = () => res(null);
      } catch { res(null); }
    });
    return this.p;
  },
  async get(k) {
    const db = await this.open();
    if (!db) return this.mem.get(k);
    return new Promise((res) => { try { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result); q.onerror = () => res(undefined); } catch { res(this.mem.get(k)); } });
  },
  async set(k, v) {
    this.mem.set(k, v);
    const db = await this.open(); if (!db) return;
    return new Promise((res) => { try { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = () => res(); tx.onerror = () => res(); } catch { res(); } });
  },
};
const clone = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
const stable = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.keys(v).sort().reduce((a, kk) => { a[kk] = v[kk]; return a; }, {}) : v));
const scope = () => (S.dash && S.dash.tenant ? S.dash.tenant.slug : (window.TENANT_SLUG || 'x'));

// ---------- which functions are which ----------
// Changes that can wait on the device. Anything not listed here (and not a read) needs a connection.
const QUEUEABLE = new Set([
  'sty_sell', 'sty_return', 'sty_receive', 'sty_adjust', 'sty_save_style', 'sty_set_variant', 'sty_set_badge', 'sty_set_colour_photos', 'sty_set_photo_use',
  'sty_bulk_edit', 'sty_delete_styles', 'sty_transfer', 'sty_receive_transfer', 'sty_cancel_transfer', 'sty_save_supplier', 'sty_pay_supplier',
  'sty_save_customer', 'sty_collect_due', 'sty_void_sale', 'sty_collection_save', 'sty_collection_delete', 'sty_collection_members',
  'sty_coupon_save', 'sty_coupon_delete', 'sty_save_branch', 'sty_save_settings', 'sty_set_target', 'sty_hold_save', 'sty_shift_open', 'sty_shift_close',
  'sty_day_close', 'sty_request_save', 'sty_request_set', 'sty_intel_set_settings', 'sty_intel_set_policy',
]);
// Answers that are saved for offline use. Changes the shop makes are laid over them (OVERLAY).
const READS = new Set([
  'sty_catalog', 'sty_dashboard', 'sty_analytics', 'sty_analytics_groups', 'sty_insights', 'sty_crm_overview', 'sty_crm_list', 'sty_customer_detail',
  'sty_list_suppliers', 'sty_list_customers', 'sty_list_sales', 'sty_list_purchases', 'sty_list_transfers', 'sty_get_sale', 'sty_collections_list',
  'sty_coupons_list', 'sty_hold_list', 'sty_shift_current', 'sty_staff_list', 'sty_requests_list', 'sty_reviews_list', 'sty_web_orders_list', 'sty_web_returns_list',
  'sty_store_get', 'sty_store_analytics', 'sty_intel_overview', 'sty_intel_designs', 'sty_intel_design', 'sty_intel_reorder', 'sty_intel_capital', 'sty_intel_lost',
  'sty_intel_basket', 'sty_intel_assistant', 'sty_intel_settings', 'sty_integrity_check', 'wa_my_status',
]);

// ---------- the queue ----------
const qKey = () => 'q.' + scope();
const emptyBill = (e) => e && e.fn === 'sty_sell' && e.args && e.args.p && !(e.args.p.lines || []).length;
// A second copy of the queue is kept in memory and in IndexedDB. If the browser's small storage is full or gets cleared, the waiting changes
// are restored from it (the server applies each change once, so sending one again is harmless).
const MIRROR = { key: null, q: null, warned: false };
const getQ = () => {
  let q = LS.get(qKey(), null);
  if (q === null) { q = MIRROR.key === qKey() && Array.isArray(MIRROR.q) ? MIRROR.q.slice() : []; if (q.length) LS.set(qKey(), q); }
  if (q.some(emptyBill)) { q = q.filter((e) => !emptyBill(e)); LS.set(qKey(), q); }   // an empty bill (made by a double tap in an older version) can never be sold: drop it
  if (q.some((e) => !e.id)) { q.forEach((e, i) => { if (!e.id) e.id = 'old-' + (e.at || 0) + '-' + i; }); LS.set(qKey(), q); }   // bills queued by the older version
  return q;
};
const setQ = (q) => {
  LS.set(qKey(), q); MIRROR.key = qKey(); MIRROR.q = q.slice(); KV.set('qm.' + scope(), q);
  let kept = true; try { kept = localStorage.getItem('sty.' + qKey()) === JSON.stringify(q); } catch { kept = false; }
  if (!kept && q.length && !MIRROR.warned) { MIRROR.warned = true; toast(t('This device is short of storage. Keep this window open until the changes are sent.'), { err: true }); }
  window.dispatchEvent(new Event('sty:q'));
};
// at start: bring back waiting changes the browser lost (cleared storage) from the IndexedDB copy
async function restoreQueue() {
  try {
    const m = await KV.get('qm.' + scope()); if (!Array.isArray(m) || !m.length) return;
    const q = getQ(), have = new Set(q.map((e) => e.id)), add = m.filter((e) => e && e.id && !have.has(e.id));
    if (add.length) { setQ([...q, ...add]); toast(add.length + ' ' + t('waiting changes were restored on this device.')); flushQueue(); }
  } catch { /* nothing to restore */ }
}
const pendingCount = () => getQ().filter((e) => !e.fail).length;
const failedOps = () => getQ().filter((e) => e.fail);
const idMapKey = () => 'idmap.' + scope();
function remapIds(value) {
  const m = LS.get(idMapKey(), {}); const keys = Object.keys(m); if (!keys.length) return value;
  const walk = (v) => (typeof v === 'string' ? (m[v] || v) : Array.isArray(v) ? v.map(walk) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)])) : v);
  return walk(value);
}

// a bill that waited on the device already happened: the server must not refuse it for stock, and it keeps its real time
function forSend(e) {
  const a = remapIds(e.args);
  if (e.fn === 'sty_sell' && a && a.p && Date.now() - e.at > 15000) a.p = { ...a.p, offline: true, at: a.p.at || new Date(e.at).toISOString() };
  return a;
}
const WAIT = new Set();   // ops somebody is waiting on right now (a refusal is shown to them instead of parked)
const RES = {};           // answers for those ops
let flushP = null;

function flushQueue() {
  if (flushP) return flushP;
  flushP = (async () => { try { await runFlush(); } finally { flushP = null; } })();
  return flushP;
}
async function runFlush() {
  if (netDown() || !sb.sync) return;
  let any = false;
  for (let guard = 0; guard < 200; guard++) {
    const todo = getQ().filter((e) => !e.fail).slice(0, 20);
    if (!todo.length) break;
    let r;
    try { r = await sb.sync(todo.map((e) => ({ id: e.id, fn: e.fn, args: forSend(e) }))); } catch { break; }
    if (!r || r.error || !r.data || !Array.isArray(r.data.results)) {
      if (r && r.error && r.error.status === 401) window.dispatchEvent(new Event('sty:auth'));
      break;
    }
    let q = getQ(), progress = false, stop = false;
    for (const x of r.data.results) {
      const e = q.find((z) => z.id === x.id); if (!e) continue;
      if (x.ok) {
        q = q.filter((z) => z.id !== e.id); progress = true; any = true;
        if (WAIT.has(e.id)) RES[e.id] = { ok: true, data: x.data };
        learnIds(e, x.data);
      } else if (x.skipped || !x.status || x.status >= 500 || x.status === 401 || x.status === 408 || x.status === 429) {
        stop = true;
      } else if (WAIT.has(e.id)) {
        q = q.filter((z) => z.id !== e.id); progress = true; RES[e.id] = { ok: false, error: x.error, status: x.status };
      } else {
        e.fail = x.error || t('Something went wrong'); e.failStatus = x.status; progress = true;
        toast(t('Not saved') + ': ' + e.fail, { err: true });
      }
    }
    setQ(q);
    if (stop || !progress) break;
  }
  if (any) { S.catAt = 0; window.dispatchEvent(new Event('sty:synced')); topUpBarcodes(); }
}
// a customer typed in offline may already exist (same phone): the server keeps the existing one, later changes follow it
function learnIds(e, data) {
  try {
    const nid = e.args && e.args.p && e.args.p.newId;
    if (nid && data && data.id && data.id !== nid) { const m = LS.get(idMapKey(), {}); m[nid] = data.id; LS.set(idMapKey(), m); }
  } catch { /* nothing to learn */ }
}

// Puts a change in the queue and sends it at once when there is a connection.
// Returns {done:true, data} when the server has applied it, {queued:true} when it is waiting on this device.
// A refusal by the server (4xx) is thrown to the caller, as it always was.
async function submit(fn, args) {
  if (fn === 'sty_sell' && !((args && args.p && args.p.lines) || []).length) throw new Error(t('The bill is empty'));
  const op = { id: uid(), fn, args: args || {}, at: Date.now() };
  const q = getQ(); q.push(op); setQ(q);
  WAIT.add(op.id);
  try {
    await flushQueue();
    if (!RES[op.id]) await flushQueue();
  } finally { WAIT.delete(op.id); }
  const r = RES[op.id]; delete RES[op.id];
  if (r) { if (r.ok) return { done: true, data: r.data }; const er = new Error(r.error || t('Something went wrong')); er.status = r.status; throw er; }
  return { done: false, queued: true };
}

// ---------- read / write entry points used by the whole app ----------
async function rawApi(fn, args) {
  let r;
  try { r = await sb.rpc(fn, args || {}); } catch (e) { const er = new Error(netDown() ? t('You are offline') : t('Could not reach the server')); er.net = true; throw er; }
  const { data, error } = r;
  if (error && error.status === 402) { location.reload(); }
  if (error) { const e = new Error(error.message || t('Something went wrong')); e.code = error.code; e.status = error.status; e.net = !error.status || error.status >= 500 || error.status === 408 || error.status === 429; throw e; }
  return data;
}
async function cachedRead(fn, args) {
  const key = 'r.' + scope() + '.' + fn + '.' + stable(args || {});
  try {
    const data = await rawApi(fn, args);
    KV.set(key, data);
    S.offlineData = false;
    return overlayRead(fn, args, clone(data));
  } catch (e) {
    if (!e.net) throw e;
    const c = await KV.get(key);
    // lists that can be built from waiting changes alone open empty (plus what is waiting) instead of refusing
    const base = c === undefined && (fn === 'sty_list_sales' || fn === 'sty_hold_list') ? [] : c;
    if (base === undefined) { const er = new Error(t('This screen needs an internet connection the first time you open it.')); er.net = true; throw er; }
    S.offlineData = true; window.dispatchEvent(new Event('sty:q'));
    return overlayRead(fn, args, clone(base));
  }
}
async function api(fn, args) {
  if (QUEUEABLE.has(fn)) {
    const r = await submit(fn, args);
    return r.done ? r.data : await localResult(fn, args || {});
  }
  if (READS.has(fn)) return cachedRead(fn, args);
  return rawApi(fn, args);
}
async function sendOrQueue(fn, args) { return submit(fn, args); }
window.addEventListener('online', () => { flushQueue(); topUpBarcodes(); });
setInterval(() => { if (getQ().some((e) => !e.fail)) flushQueue(); }, 30000);

// ---------- tag codes for styles made with no connection ----------
// While online the device keeps a block of unused tag codes (same counter the server uses, so they never clash).
const bcKey = () => 'bc.' + scope();
const barcodePool = () => LS.get(bcKey(), []);
async function topUpBarcodes() {
  try {
    if (!can('sty_manage') || netDown()) return;
    if (barcodePool().length >= 60) return;
    const codes = await rawApi('sty_reserve_barcodes', { p_n: 200 });
    if (Array.isArray(codes)) LS.set(bcKey(), [...barcodePool(), ...codes]);
  } catch { /* try again later */ }
}
function takeBarcodes(n) {
  const pool = barcodePool(); if (pool.length < n) return null;
  LS.set(bcKey(), pool.slice(n)); return pool.slice(0, n);
}

// ---------- pending changes laid over the saved answers ----------
const N0 = (x) => Number(x) || 0;
const sameBranch = (argBranch, opBranch) => !argBranch || !opBranch || argBranch === opBranch;
const opsFor = (fns) => getQ().filter((e) => !e.fail && (!fns || fns.includes(e.fn)));
function varIndex(cat) { const m = {}; for (const s of cat) for (const v of s.variants || []) m[v.id] = { s, v }; return m; }

const OVERLAY = {
  sty_catalog(cat, args) {
    const ops = getQ().filter((e) => !e.fail); if (!ops.length || !Array.isArray(cat)) return cat;
    const br = args && args.p_branch;
    for (const e of ops) {
      const p = (e.args && e.args.p) || {}; const idx = varIndex(cat);
      switch (e.fn) {
        case 'sty_sell': if (sameBranch(br, p.branchId)) for (const l of p.lines || []) { const x = idx[l.variantId]; if (x) x.v.stock = N0(x.v.stock) - N0(l.qty); } break;
        case 'sty_receive': if (sameBranch(br, p.branchId)) for (const l of p.lines || []) { const x = idx[l.variantId]; if (x) x.v.stock = N0(x.v.stock) + N0(l.qty); } break;
        case 'sty_adjust': {
          if (!sameBranch(br, p.branchId)) break;
          const x = idx[p.variantId]; if (!x) break; const q = Math.abs(N0(p.qty));
          if (p.mode === 'add') x.v.stock = N0(x.v.stock) + q;
          else if (p.mode === 'remove' || p.mode === 'lost') x.v.stock = N0(x.v.stock) - q;
          else if (p.mode === 'damage') { x.v.stock = N0(x.v.stock) - q; x.v.dmg = N0(x.v.dmg) + q; }
          else if (p.mode === 'count') x.v.stock = N0(p.qty);
          break;
        }
        case 'sty_transfer': if (br && br === p.fromBranch) for (const l of p.lines || []) { const x = idx[l.variantId]; if (x) x.v.stock = N0(x.v.stock) - N0(l.qty); } break;
        case 'sty_save_style': overlayStyle(cat, p, br); break;
        case 'sty_set_variant': {
          const x = idx[e.args.p_id]; if (!x) break; const q = e.args.p || {};
          if ('price' in q) x.v.price = q.price === '' || q.price == null ? x.s.price : N0(q.price);
          if (q.reorderAt != null) x.v.reorderAt = N0(q.reorderAt);
          if (q.active != null) x.v.active = !!q.active;
          if ('sku' in q) x.v.sku = q.sku;
          if (q.barcode) x.v.barcode = q.barcode;
          break;
        }
        case 'sty_set_badge': { const s = cat.find((z) => z.id === e.args.p_id); if (s) s.badge = e.args.p_badge || null; break; }
        case 'sty_set_colour_photos': { const s = cat.find((z) => z.id === e.args.p_id); if (s) s.colourPhotos = e.args.p || {}; break; }
        case 'sty_set_photo_use': { const s = cat.find((z) => z.id === e.args.p_id); if (s) s.photoUse = e.args.p || {}; break; }
        case 'sty_delete_styles': for (const id of p.ids || []) { const i = cat.findIndex((z) => z.id === id); if (i >= 0) cat.splice(i, 1); } break;
        case 'sty_bulk_edit': {
          const set = p.set || {}; const adj = p.priceAdjust;
          for (const s of cat) {
            if (!(p.ids || []).includes(s.id)) continue;
            for (const k of Object.keys(set)) { if (k === 'active') s.active = set[k] === true || set[k] === 'true'; else if (k === 'badge') s.badge = set[k] === 'normal' ? null : set[k]; else if (k === 'taxPct') s.taxPct = N0(set[k]); else s[k] = set[k]; }
            if (adj) {
              const f = (x) => Math.max(0, Math.round((adj.mode === 'pct' ? N0(x) * (1 + N0(adj.value) / 100) : N0(x) + N0(adj.value)) * 100) / 100);
              s.price = f(s.price); s.mrp = f(s.mrp); for (const v of s.variants || []) if (v.price != null) v.price = f(v.price);
            }
          }
          break;
        }
        default: break;
      }
    }
    return cat;
  },
  // held bills made offline stay in the Held list; a held bill that was sold (resumed) leaves it
  sty_hold_list(list) {
    if (!Array.isArray(list)) return list;
    for (const e of getQ().filter((z) => !z.fail)) {
      const p = (e.args && e.args.p) || {};
      if (e.fn === 'sty_hold_save' && p.id) {
        const row = { id: p.id, label: p.label || null, lines: p.lines || [], at: new Date(e.at).toISOString(), branchId: p.branchId || null };
        const i = list.findIndex((z) => z.id === p.id); if (i >= 0) list[i] = row; else list.unshift(row);
      } else if (e.fn === 'sty_sell' && p.holdId) { const i = list.findIndex((z) => z.id === p.holdId); if (i >= 0) list.splice(i, 1); }
    }
    return list;
  },
  // bills made offline show in Bills at once ("Waiting to send"), and a cancelled one is marked cancelled
  sty_list_sales(list, args) {
    if (!Array.isArray(list)) return list;
    const a = (args && args.p) || {}, ops = getQ().filter((e) => !e.fail);
    const voided = new Set(ops.filter((e) => e.fn === 'sty_void_sale').map((e) => e.args && e.args.p_id));
    list.forEach((r) => { if (voided.has(r.id)) r.status = 'void'; });
    if (a.q || a.customerId || a.status) return list;
    const ymd = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const waiting = [];
    for (const e of ops) {
      if (e.fn !== 'sty_sell') continue;
      const p = (e.args && e.args.p) || {}; if (!p.id || list.some((z) => z.id === p.id) || voided.has(p.id)) continue;
      const day = ymd(new Date(e.at)); if ((a.from && day < a.from) || (a.to && day > a.to)) continue;
      const idx = varIndex(S.cat || []); let sum = 0, units = 0;
      for (const l of p.lines || []) {
        const v = idx[l.variantId]; const unit = l.price != null ? N0(l.price) : v ? N0(v.v.price != null ? v.v.price : v.s.price) : 0; const gross = unit * N0(l.qty);
        sum += Math.max(0, gross - N0(l.discAmt) - gross * N0(l.discPct) / 100); units += N0(l.qty);
      }
      const total = Math.max(0, Math.round((sum - N0(p.billDiscAmt) - sum * N0(p.billDiscPct) / 100) * 100) / 100);
      const paid = (p.payments || []).reduce((x, y) => x + N0(y.amount), 0);
      waiting.push({ id: p.id, number: t('Waiting to send'), at: new Date(e.at).toISOString(), total, paid: Math.min(paid, total), status: paid + .005 < total ? 'due' : 'paid', discount: 0, customer: null, customerId: p.customerId || null,
        branchId: p.branchId || null, units, staff: S.user ? S.user.email : null, payments: p.payments || [], waiting: true });
    }
    return waiting.reverse().concat(list);
  },
  sty_list_suppliers(list) {
    for (const e of opsFor(['sty_save_supplier', 'sty_pay_supplier', 'sty_receive'])) {
      const p = (e.args && e.args.p) || {};
      if (e.fn === 'sty_save_supplier') {
        const id = p.id || p.newId; let s = list.find((z) => z.id === id);
        if (!s) { s = { id, name: '', contact: null, phone: null, gstin: null, category: null, active: true, bought: 0, paid: 0, due: 0, lastAt: null }; list.push(s); }
        for (const k of ['name', 'contact', 'phone', 'gstin', 'category']) if (p[k] != null && p[k] !== '') s[k] = p[k];
        if (p.active === false) list.splice(list.indexOf(s), 1);
      } else if (e.fn === 'sty_pay_supplier') {
        const s = list.find((z) => z.id === e.args.p_id); if (s) { const a = N0(e.args.p && e.args.p.amount != null ? e.args.p.amount : e.args.p_amount); s.paid += a; s.due -= a; }
      } else if (e.fn === 'sty_receive' && p.supplierId) {
        const s = list.find((z) => z.id === p.supplierId); if (s) { const tot = (p.lines || []).reduce((a, l) => a + N0(l.qty) * N0(l.unitCost), 0); s.bought += tot; s.due += tot - N0(p.paid); s.paid += N0(p.paid); }
      }
    }
    return list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  },
  sty_list_customers(list) {
    for (const e of opsFor(['sty_save_customer'])) {
      const p = (e.args && e.args.p) || {}; const id = p.id || p.newId;
      let c = list.find((z) => z.id === id || (p.phone && z.phone && String(p.phone).replace(/\D/g, '').slice(-10) === z.phone));
      if (!c) { c = { id, name: '', phone: null, usualSize: null, points: 0, credit: 0, birthday: null, notes: null, visits: 0, spent: 0, lastAt: null }; list.unshift(c); }
      if (p.name) c.name = p.name; if (p.phone) c.phone = String(p.phone).replace(/\D/g, '').slice(-10);
      if ('usualSize' in p) c.usualSize = p.usualSize; if ('birthday' in p) c.birthday = p.birthday; if ('notes' in p) c.notes = p.notes;
    }
    return list;
  },
  sty_collections_list(list) {
    for (const e of opsFor(['sty_collection_save', 'sty_collection_delete', 'sty_collection_members'])) {
      const p = (e.args && e.args.p) || {};
      if (e.fn === 'sty_collection_save') {
        const id = p.id || p.newId; let c = list.find((z) => z.id === id);
        if (!c) { c = { id, name: '', note: null, image: null, styleIds: [] }; list.push(c); }
        if (p.name) c.name = p.name; if ('note' in p) c.note = p.note; if ('image' in p) c.image = p.image;
      } else if (e.fn === 'sty_collection_delete') {
        const i = list.findIndex((z) => z.id === e.args.p_id); if (i >= 0) list.splice(i, 1);
      } else {
        const c = list.find((z) => z.id === e.args.p_id); if (!c) continue;
        const ids = new Set(c.styleIds || []); (e.args.p_add || []).forEach((x) => ids.add(x)); (e.args.p_remove || []).forEach((x) => ids.delete(x)); c.styleIds = [...ids];
      }
    }
    return list;
  },
  sty_coupons_list(list) {
    for (const e of opsFor(['sty_coupon_save', 'sty_coupon_delete'])) {
      const p = (e.args && e.args.p) || {};
      if (e.fn === 'sty_coupon_delete') { const i = list.findIndex((z) => z.id === e.args.p_id); if (i >= 0) list.splice(i, 1); continue; }
      const id = p.id || p.newId; let c = list.find((z) => z.id === id);
      if (!c) { c = { id, used: 0 }; list.unshift(c); }
      Object.assign(c, { code: String(p.code || c.code || '').toUpperCase(), kind: p.kind, value: p.value, minOrder: p.minOrder, maxUses: p.maxUses, firstOnly: p.firstOnly, startsOn: p.startsOn, endsOn: p.endsOn, active: p.active !== false, note: p.note });
    }
    return list;
  },
  sty_context(ctx) {
    for (const e of opsFor(['sty_save_settings', 'sty_save_branch'])) {
      const p = (e.args && e.args.p) || {};
      if (e.fn === 'sty_save_settings') {
        ctx.settings = ctx.settings || {};
        for (const k of Object.keys(p)) { if (k === 'features' && p.features && typeof p.features === 'object') ctx.settings.features = { ...(ctx.settings.features || {}), ...p.features }; else ctx.settings[k] = p[k]; }
      } else {
        ctx.branches = ctx.branches || []; const id = p.id || p.newId; let b = ctx.branches.find((z) => z.id === id);
        if (!b) { b = { id, name: '', kind: 'shop', address: null, isMain: false, active: true }; ctx.branches.push(b); }
        for (const k of ['name', 'kind', 'address', 'active']) if (p[k] != null) b[k] = p[k];
      }
    }
    return ctx;
  },
};
function overlayStyle(cat, p, br) {
  const id = p.id || p.newId; let s = cat.find((z) => z.id === id);
  const num = (x, d) => (x === '' || x == null ? d : Number(x));
  if (!s) {
    s = { id, name: '', category: 'Clothing', subcategory: null, brand: null, season: null, gender: null, description: null, details: null, fabric: null, washcare: null, weightG: null, code: null, photos: [], badge: null,
      colourPhotos: {}, photoUse: {}, collection: null, hsn: null, taxPct: null, price: 0, mrp: 0, cost: 0, photoUrl: null, notes: null, active: true, variants: [] };
    cat.push(s);
  }
  const map = { name: 'name', category: 'category', subcategory: 'subcategory', brand: 'brand', season: 'season', gender: 'gender', hsn: 'hsn', notes: 'notes', photoUrl: 'photoUrl', description: 'description', details: 'details', fabric: 'fabric', washcare: 'washcare', collection: 'collection', code: 'code' };
  for (const k of Object.keys(map)) if (k in p && p[k] != null && !(k === 'name' && !String(p[k]).trim())) s[map[k]] = p[k] === '' ? null : p[k];
  if ('taxPct' in p) s.taxPct = num(p.taxPct, null); if (p.price !== undefined && p.price !== '') s.price = num(p.price, s.price); if (p.mrp !== undefined && p.mrp !== '') s.mrp = num(p.mrp, s.mrp);
  if (p.cost !== undefined && p.cost !== '') s.cost = num(p.cost, s.cost); if ('weightG' in p) s.weightG = num(p.weightG, null);
  if (p.photos) s.photos = p.photos; if (p.active != null) s.active = !!p.active;
  let cols = Array.isArray(p.colours) ? p.colours : [], szs = Array.isArray(p.sizes) ? p.sizes : [];
  if (!cols.length && szs.length) cols = ['']; if (!szs.length && cols.length) szs = [''];
  const stockBranch = (p.opening && p.opening.branchId) || null; const oq = p.opening ? N0(p.opening.qty) : 0;
  for (const c of cols) for (const z of szs) {
    const key = String(c).trim() + '|' + String(z).trim();
    if (s.variants.some((v) => v.colour === String(c).trim() && v.size === String(z).trim())) continue;
    const vid = (p.variantIds && p.variantIds[key]) || ('local-' + id + '-' + key);
    s.variants.push({ id: vid, colour: String(c).trim(), size: String(z).trim(), barcode: (p.barcodes && p.barcodes[key]) || '', sku: null, price: s.price, cost: N0(p.cost), reorderAt: p.reorderAt != null ? N0(p.reorderAt) : 2, active: true, stock: sameBranch(br, stockBranch) ? oq : 0, dmg: 0 });
  }
  if (p.reorderAt != null) for (const v of s.variants) v.reorderAt = N0(p.reorderAt);
}
function overlayRead(fn, args, data) {
  const f = OVERLAY[fn];
  if (!f || data == null || !getQ().some((e) => !e.fail)) return data;
  try { return f(data, args) || data; } catch (e) { console.error('overlay ' + fn, e); return data; }
}

// What the screen gets back for a change that is waiting on this device (the real answer arrives when it is sent).
async function localResult(fn, args) {
  const p = (args && args.p) || {};
  switch (fn) {
    case 'sty_save_style': {
      S.catAt = 0; await loadCatalog(true).catch(() => {});
      return S.cat.find((s) => s.id === (p.id || p.newId)) || { id: p.id || p.newId, queued: true };
    }
    case 'sty_save_customer': { const id = p.id || p.newId; return { id, name: p.name, phone: p.phone ? String(p.phone).replace(/\D/g, '').slice(-10) : null, usualSize: p.usualSize, points: 0, credit: 0, birthday: p.birthday || null, queued: true }; }
    case 'sty_save_supplier': return cachedRead('sty_list_suppliers', {});
    case 'sty_collection_save': return { id: p.id || p.newId, name: p.name, queued: true };
    case 'sty_coupon_save': return { id: p.id || p.newId, queued: true };
    case 'sty_save_settings': case 'sty_save_branch': return overlayRead('sty_context', {}, clone(S.ctx));
    case 'sty_bulk_edit': return { changed: (p.ids || []).length, queued: true };
    case 'sty_delete_styles': return { deleted: (p.ids || []).length, hidden: 0, queued: true };
    case 'sty_adjust': return { ok: true, queued: true };
    case 'sty_shift_open': case 'sty_shift_close': return { ok: true, queued: true };
    case 'sty_hold_save': return cachedRead('sty_hold_list', {}).catch(() => []);
    default: return { ok: true, queued: true };
  }
}

// ---------- the "Waiting changes" list ----------
const FN_LABEL = {
  sty_sell: 'Bill', sty_return: 'Return', sty_receive: 'Stock bought', sty_adjust: 'Stock change', sty_save_style: 'Style saved', sty_set_variant: 'Size/colour edited', sty_set_badge: 'Label changed',
  sty_bulk_edit: 'Many styles edited', sty_delete_styles: 'Styles deleted', sty_transfer: 'Stock transfer', sty_save_supplier: 'Supplier saved', sty_pay_supplier: 'Supplier payment',
  sty_save_customer: 'Customer saved', sty_collect_due: 'Due collected', sty_void_sale: 'Bill cancelled', sty_collection_save: 'Collection saved', sty_collection_members: 'Collection changed',
  sty_coupon_save: 'Coupon saved', sty_save_branch: 'Branch saved', sty_save_settings: 'Settings saved', sty_hold_save: 'Bill on hold', sty_shift_open: 'Shift opened', sty_shift_close: 'Shift closed',
  sty_day_close: 'Books closed', sty_request_save: 'Customer request', sty_set_target: 'Staff target',
};
function describeOp(e) {
  const p = (e.args && e.args.p) || {};
  const base = t(FN_LABEL[e.fn] || e.fn.replace(/^sty_/, '').replace(/_/g, ' '));
  const extra = p.name || p.label || p.invoiceNo || (p.lines ? p.lines.length + ' ' + t('items') : '') || '';
  return base + (extra ? ' · ' + extra : '');
}
function waitingSheet() {
  const body = h('div', { class: 'grid' });
  const paint = () => {
    const q = getQ(); clear(body);
    if (!q.length) { body.append(h('p', { class: 'muted' }, t('Everything is saved on the server.'))); return; }
    body.append(h('p', { class: 'muted small' }, t('These changes were made on this device. They are sent on their own as soon as there is a connection.')));
    for (const e of q) {
      body.append(h('div', { class: 'card', style: { padding: '10px 12px', display: 'grid', gap: '6px' } },
        h('div', { class: 'row', style: { justifyContent: 'space-between', gap: '8px' } }, h('b', null, describeOp(e)), h('span', { class: 'small muted' }, new Date(e.at).toLocaleString())),
        e.fail ? h('div', { class: 'small', style: { color: 'var(--red)' } }, t('Refused') + ': ' + e.fail) : h('div', { class: 'small muted' }, t('Waiting to send')),
        h('div', { class: 'row', style: { gap: '8px' } },
          e.fail ? h('button', { class: 'btn sm', type: 'button', onclick: () => { const z = getQ(); const x = z.find((y) => y.id === e.id); if (x) { delete x.fail; delete x.failStatus; setQ(z); } flushQueue().then(paint); paint(); } }, t('Try again')) : null,
          e.fail ? h('button', { class: 'btn sm danger', type: 'button', onclick: async () => { if (await confirmBox(t('Discard this change?'), t('It will not be saved.'), t('Discard'), true)) { setQ(getQ().filter((y) => y.id !== e.id)); S.catAt = 0; paint(); window.dispatchEvent(new Event('sty:synced')); } } }, t('Discard')) : null)));
    }
  };
  paint();
  const onq = () => paint(); window.addEventListener('sty:q', onq);
  sheet({ title: t('Waiting changes'), body, closeLabel: t('Close'), onClose: () => window.removeEventListener('sty:q', onq), actions: [{ label: t('Send now'), primary: true, onclick: async () => { await flushQueue(); paint(); toast(getQ().filter((e) => !e.fail).length ? t('Still offline') : t('All sent')); return false; } }] });
}
