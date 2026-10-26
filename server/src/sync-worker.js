// AUZsStyle Cloud Sync, Stages 1, 3 and 6 (db/276, db/278, db/280): runs only inside an offline Windows install
// that has turned on the "sync" licence add-on. Every couple of minutes: pushes whatever is new in this
// computer's own sty_change_log up to AUZslab's cloud server, which applies it into a paired cloud tenant
// (auto-created the first time this install ever syncs -- see sty_cloud_sync_ensure_tenant); then pulls down
// whatever someone changed directly on that cloud tenant since the last pull. "The PC always wins" a conflict --
// enforced in SQL (sty_local_apply_pulled_change, db/278), not here: this file just moves batches back and
// forth. A pushed style's photo is uploaded too (Stage 6), not just the row that names it, or a remote viewer
// would just see broken images.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { pool } from './db.js';
import { OFFLINE, licenceStatus } from './routes/licence.js';

const DEFAULT_URL = 'https://api.auzslab.in';
const BATCH = 200;
const UPLOAD_ROOT = process.env.UPLOAD_ROOT || '';
// Only ever produced by this PC's own local upload route (server/src/storage.js saveSiteUpload); a cloud-synced
// photo lands at /uploads/cloud-sync/... instead (saveCloudSyncUpload), specifically so the two paths can never
// be confused and a photo already uploaded is never mistaken for one that still needs uploading.
const LOCAL_PHOTO_RE = /^\/uploads\/site\//;

function readCode() {
  try { return JSON.parse(fs.readFileSync(path.join(process.env.AUZ_DATA_DIR || '', 'licence.json'), 'utf8')).code || ''; } catch { return ''; }
}

function postJson(base, p, code, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(p, base);
    const mod = u.protocol === 'https:' ? https : http;
    const data = Buffer.from(JSON.stringify(body));
    const req = mod.request(u, { method: 'POST', timeout: 60000, headers: { 'Content-Type': 'application/json', 'Content-Length': data.length, 'X-Licence': code } }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => {
        if (res.statusCode >= 400) { let m = b; try { m = JSON.parse(b).error || b; } catch { /* plain text */ } const e = new Error(m || 'HTTP ' + res.statusCode); e.status = res.statusCode; return reject(e); }
        try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('The connection to AUZslab timed out.')));
    req.on('error', (e) => reject(new Error(e.code === 'ENOTFOUND' || e.code === 'ECONNREFUSED' || e.code === 'EAI_AGAIN' ? 'No internet connection.' : e.message)));
    req.end(data);
  });
}
function getJson(base, p, code) {
  return new Promise((resolve, reject) => {
    const u = new URL(p, base);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, { method: 'GET', timeout: 60000, headers: { 'X-Licence': code } }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => {
        if (res.statusCode >= 400) { let m = b; try { m = JSON.parse(b).error || b; } catch { /* plain text */ } const e = new Error(m || 'HTTP ' + res.statusCode); e.status = res.statusCode; return reject(e); }
        try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('The connection to AUZslab timed out.')));
    req.on('error', (e) => reject(new Error(e.code === 'ENOTFOUND' || e.code === 'ECONNREFUSED' || e.code === 'EAI_AGAIN' ? 'No internet connection.' : e.message)));
    req.end();
  });
}
function postBuffer(base, p, code, buffer) {
  return new Promise((resolve, reject) => {
    const u = new URL(p, base);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(u, { method: 'POST', timeout: 60000, headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': buffer.length, 'X-Licence': code } }, (res) => {
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => {
        if (res.statusCode >= 400) { let m = b; try { m = JSON.parse(b).error || b; } catch { /* plain text */ } const e = new Error(m || 'HTTP ' + res.statusCode); e.status = res.statusCode; return reject(e); }
        try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('The connection to AUZslab timed out.')));
    req.on('error', (e) => reject(new Error(e.code === 'ENOTFOUND' || e.code === 'ECONNREFUSED' || e.code === 'EAI_AGAIN' ? 'No internet connection.' : e.message)));
    req.end(buffer);
  });
}

// AUZsStyle Cloud Sync, Stage 6 (db/280): a style's photo_url / photos / colour_photos only ever point at this
// PC's own disk until uploaded here -- see db/280's own header for the full picture, and storage.js's
// saveCloudSyncUpload for where the file lands on the cloud side.
function localPhotoPath(url) {
  try { const p = new URL(url).pathname; return LOCAL_PHOTO_RE.test(p) ? p : null; } catch { return null; }
}
// Best-effort: a photo that fails to upload (bad network mid-push, file missing on disk) just stays as its
// (already broken for a remote viewer either way) local URL and is tried again on the next push -- it must never
// fail the whole batch over one picture.
async function resolvePhoto(base, code, url, cache) {
  const p = localPhotoPath(url);
  if (!p) return url;
  if (cache.has(url)) return cache.get(url);
  try {
    const { rows } = await pool.query('select offline_sync_photo_cached($1) as c', [url]);
    if (rows[0]?.c) { cache.set(url, rows[0].c); return rows[0].c; }
    const buffer = await fsp.readFile(path.join(UPLOAD_ROOT, p.slice('/uploads/'.length)));
    const r = await postBuffer(base, '/cloud/sync/photo', code, buffer);
    if (!r.url) return url;
    await pool.query('select offline_sync_photo_cache_set($1, $2)', [url, r.url]);
    cache.set(url, r.url);
    return r.url;
  } catch { return url; }
}
export async function resolveStylePhotos(base, code, row, cache) {
  if (row.photo_url) row.photo_url = await resolvePhoto(base, code, row.photo_url, cache);
  if (Array.isArray(row.photos)) for (let i = 0; i < row.photos.length; i++) row.photos[i] = await resolvePhoto(base, code, row.photos[i], cache);
  if (row.colour_photos && typeof row.colour_photos === 'object') {
    for (const arr of Object.values(row.colour_photos)) {
      if (Array.isArray(arr)) for (let i = 0; i < arr.length; i++) arr[i] = await resolvePhoto(base, code, arr[i], cache);
    }
  }
  return row;
}

export async function pushOnce() {
  const s = licenceStatus();
  if (!s || !(s.addons && s.addons.sync) || (s.state !== 'active' && s.state !== 'grace')) return { skipped: true };
  const code = readCode(); if (!code) return { skipped: true };
  const { rows: trows } = await pool.query('select offline_my_tenant_id() as id'); const tid = trows[0]?.id; if (!tid) return { skipped: true };
  let since = (await pool.query('select offline_sync_last_pushed() as c')).rows[0].c; let total = 0;
  const base = process.env.AUZ_CLOUD_URL || DEFAULT_URL;
  for (let guard = 0; guard < 20; guard++) {
    const rows = (await pool.query('select offline_sync_changes_since($1, $2) as r', [since, BATCH])).rows[0].r;
    if (!rows.length) break;
    const photoCache = new Map();
    const changes = [];
    for (const r of rows) {
      const row = r.tbl === 'sty_styles' && r.op === 'upsert' && r.row ? await resolveStylePhotos(base, code, r.row, photoCache) : r.row;
      changes.push({ tbl: r.tbl, rowId: r.rowId, op: r.op, row });
    }
    await postJson(base, '/cloud/sync', code, { changes });
    since = rows[rows.length - 1].id; total += rows.length;
    await pool.query('select offline_sync_set_last_pushed($1)', [since]);
    if (rows.length < BATCH) break;
  }
  return { pushed: total };
}

export async function pullOnce() {
  const s = licenceStatus();
  if (!s || !(s.addons && s.addons.sync) || (s.state !== 'active' && s.state !== 'grace')) return { skipped: true };
  const code = readCode(); if (!code) return { skipped: true };
  const { rows: trows } = await pool.query('select offline_my_tenant_id() as id'); const tid = trows[0]?.id; if (!tid) return { skipped: true };
  let since = (await pool.query('select offline_sync_last_pulled() as c')).rows[0].c; let total = 0;
  const base = process.env.AUZ_CLOUD_URL || DEFAULT_URL;
  for (let guard = 0; guard < 20; guard++) {
    const r = await getJson(base, '/cloud/sync?since=' + since, code);
    const changes = Array.isArray(r.changes) ? r.changes : [];
    if (!changes.length) break;
    const applied = (await pool.query('select sty_local_apply_pulled_batch($1, $2::jsonb) as r', [tid, JSON.stringify(changes)])).rows[0].r;
    since = r.cursor != null ? r.cursor : changes[changes.length - 1].id;
    total += applied.applied;
    await pool.query('select offline_sync_set_last_pulled($1)', [since]);
    if (changes.length < 200) break;
  }
  return { pulled: total };
}

// In-memory only (resets if the app restarts): just enough for Settings to show the owner something -- "last
// tried", "last actually went through" and the error, if any -- without needing its own table.
const STATUS = { lastTriedAt: null, lastOkAt: null, lastError: null, lastPushed: 0, lastPulled: 0 };
export function syncStatus() { return { ...STATUS }; }

// Shared by the 2-minute background timer and the "Sync now" button (Settings -> Remote access,
// /offline/sync-now) -- a push, then a pull, updating the same status the Settings page reads.
export async function syncNow() {
  STATUS.lastTriedAt = new Date().toISOString();
  try {
    const up = await pushOnce(), down = await pullOnce();
    STATUS.lastError = null; STATUS.lastOkAt = STATUS.lastTriedAt; STATUS.lastPushed = up.pushed || 0; STATUS.lastPulled = down.pulled || 0;
    return { pushed: STATUS.lastPushed, pulled: STATUS.lastPulled };
  } catch (e) { STATUS.lastError = e.message; throw e; }
}

export function startSyncWorker() {
  if (!OFFLINE || process.env.DISABLE_MAINTENANCE === '1') return;
  const run = () => syncNow().catch((e) => console.warn('cloud sync failed:', e.message));
  setTimeout(() => { run(); setInterval(run, 2 * 60_000).unref(); }, 15_000).unref();
}
