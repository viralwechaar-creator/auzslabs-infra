/* AUZsMob: offline-first sync engine. Every phone keeps its own copy in IndexedDB (database `mob1`) with
   an outbox; when the internet is back, queued writes replay through the real mob_* RPCs (which are
   idempotent on the client-generated id, so a retried push is always safe), then a fresh mob_sync_pull
   folds in everything that changed -- including other staff's shared catalog updates, and (for an
   owner/manager) the rest of the shop's activity.

   This never claims "saved to server" before it is: a local write is "Saved on phone" the instant it's in
   IndexedDB; it only becomes "Synced" after the matching outbox entry's RPC call actually succeeds (the
   same lesson CLAUDE.md records from the old POS sync bug). */
'use strict';
const DB_NAME = 'mob1', DB_VERSION = 1;
const STORES = ['items', 'units', 'vendors', 'customers', 'purchases', 'sales', 'repairs', 'repairEvents', 'payments', 'stockMovements'];
let dbp;
function openDb() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'oid', autoIncrement: true });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'k' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
function tx(db, stores, mode) { return db.transaction(stores, mode); }
function reqP(req) { return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); }); }

async function idbGetAll(store) { const db = await openDb(); return reqP(tx(db, [store], 'readonly').objectStore(store).getAll()); }
async function idbPut(store, row) { const db = await openDb(); return reqP(tx(db, [store], 'readwrite').objectStore(store).put(row)); }
async function idbPutMany(store, rows) { if (!rows.length) return; const db = await openDb(); const os = tx(db, [store], 'readwrite').objectStore(store); for (const r of rows) os.put(r); }
async function idbDelete(store, key) { const db = await openDb(); return reqP(tx(db, [store], 'readwrite').objectStore(store).delete(key)); }
async function metaGet(k) { const db = await openDb(); const r = await reqP(tx(db, ['meta'], 'readonly').objectStore('meta').get(k)); return r ? r.v : null; }
async function metaSet(k, v) { const db = await openDb(); return reqP(tx(db, ['meta'], 'readwrite').objectStore('meta').put({ k, v })); }

async function api(fn, args) {
  let r;
  try { r = await sb.rpc(fn, args || {}); } catch (e) { throw new Error(navigator.onLine === false ? t('errOffline') : t('errGeneric')); }
  const { data, error } = r;
  if (error) { const e = new Error(error.message || t('errGeneric')); e.code = error.code; e.status = error.status; throw e; }
  return data;
}

// ---------- outbox ----------
async function outboxAdd(fn, args) {
  const db = await openDb();
  await reqP(tx(db, ['outbox'], 'readwrite').objectStore('outbox').add({ fn, args, createdAt: Date.now() }));
  updateOutboxCount();
  trySync();
}
async function outboxAll() { const db = await openDb(); return reqP(tx(db, ['outbox'], 'readonly').objectStore('outbox').getAll()); }
async function updateOutboxCount() { S.outboxCount = (await outboxAll()).length; window.dispatchEvent(new CustomEvent('mob:sync')); }

// Undoes the optimistic local write a rejected outbox item made, so a refused sale or purchase doesn't
// keep sitting in IndexedDB looking saved. Only the two money-moving writes need this (everything else
// localPush writes -- items/vendors/customers -- uses the platform's p_base optimistic-concurrency
// contract, which returns {ok:false,conflict:true} as a normal success response, never reaches this path).
async function rejectLocal(fn, args) {
  const p = args && args.p;
  if (fn === 'mob_push_sale') {
    await idbDelete('sales', args.p_id);
    if (p && Array.isArray(p.items)) {
      const units = await idbGetAll('units');
      for (const it of p.items) {
        if (!it.unitId) continue;
        const u = units.find((x) => x.id === it.unitId);
        if (u && u.status === 'sold') { u.status = 'in_stock'; u.updated_at = new Date().toISOString(); await idbPut('units', u); }
      }
    }
  } else if (fn === 'mob_push_purchase') {
    await idbDelete('purchases', args.p_id);
    if (p && p.unitId) await idbDelete('units', p.unitId);
    const movements = await idbGetAll('stockMovements');
    for (const m of movements) if (m.ref_id === args.p_id) await idbDelete('stockMovements', m.id);
  } else if (fn === 'mob_push_repair_event') {
    // a status/part/payment/note tap that the server refused (e.g. not the job's staffer) would otherwise
    // keep showing locally forever -- the job looking updated on this phone while the server never recorded it
    await idbDelete('repairEvents', args.p_id);
  }
  window.dispatchEvent(new CustomEvent('mob:pulled'));
}

let syncing = false;
async function trySync() {
  if (syncing) return;
  if (!navigator.onLine) { await updateOutboxCount(); return; }
  syncing = true;
  try {
    const db = await openDb();
    let items = await outboxAll();
    for (const it of items) {
      try {
        await api(it.fn, it.args);
      } catch (e) {
        if (e.status === 401 || e.message === t('errOffline')) break; // stop: session dead or truly offline, leave the rest queued
        // a real business-rule refusal (bad data, entitlement off, day closed, not enough stock): it will
        // never succeed by itself retrying, so it's dropped -- but unlike before, the optimistic local
        // write localPush already made (the "Saved on phone" row, and for a sale, the unit it flipped to
        // 'sold') is rolled back here too, and the staffer is told. Previously this just logged a console
        // warning and moved on: a sale that the server correctly refused (e.g. selling more of a loose-stock
        // item than the shop actually has) still sat in the local sales list looking saved, with no sign it
        // never reached the server -- the exact silent-failure shape "no restriction on selling what isn't
        // in stock" was reported as.
        console.warn('outbox item refused, dropping:', it.fn, e.message);
        await rejectLocal(it.fn, it.args);
        toast(t('notSaved') + ': ' + e.message, { err: true });
      }
      await reqP(tx(db, ['outbox'], 'readwrite').objectStore('outbox').delete(it.oid));
    }
    await updateOutboxCount();
    await pull();
  } finally { syncing = false; }
}

async function pull() {
  const since = await metaGet('cursor');
  let r;
  try { r = await api('mob_sync_pull', { p_since: since }); } catch { return; }
  if (r.full) {
    // A first sync (new phone, cleared data, or away over 90 days) is a window: the last 90 days, everything still
    // open, and ONE opening stock row per item for older history. Drop the stock rows this phone already held, or
    // they would be counted twice on top of the opening row. Rows for entries still waiting in the outbox stay.
    const waiting = new Set((await outboxAll()).map((o) => o.args && o.args.p_id).filter(Boolean));
    for (const m of await idbGetAll('stockMovements')) if (!waiting.has(m.ref_id)) await idbDelete('stockMovements', m.id);
  }
  for (const [store, key] of [['items', 'items'], ['units', 'units'], ['vendors', 'vendors'], ['customers', 'customers'],
    ['purchases', 'purchases'], ['sales', 'sales'], ['repairs', 'repairs'], ['repairEvents', 'repair_events'],
    ['payments', 'payments'], ['stockMovements', 'stock_movements']]) {
    await idbPutMany(store, r[key] || []);
  }
  await metaSet('cursor', r.server_time);
  window.dispatchEvent(new CustomEvent('mob:pulled'));
}

// local-first write: show it immediately, queue it, and let trySync() take it from there
async function localPush(store, row, fn, args) {
  await idbPut(store, { ...row, _pending: true });
  await outboxAdd(fn, args);
  window.dispatchEvent(new CustomEvent('mob:pulled'));
}

window.addEventListener('online', () => { S.online = true; window.dispatchEvent(new CustomEvent('mob:sync')); trySync(); });
window.addEventListener('offline', () => { S.online = false; window.dispatchEvent(new CustomEvent('mob:sync')); });
setInterval(() => { if (navigator.onLine) trySync(); }, 60_000);

function syncStatusNode() {
  const n = S.outboxCount;
  if (!S.online) return h('span', { class: 'sync-pill off' }, icon('cloudOff', 15), t('offline'));
  if (n > 0) return h('span', { class: 'sync-pill wait' }, icon('refresh', 15), t('waitingForInternet', { n }));
  return h('span', { class: 'sync-pill ok' }, icon('cloudCheck', 15), t('synced'));
}
