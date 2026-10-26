// AUZsStyle Cloud Sync, Stages 1 and 3 (db/276, db/278): runs only inside an offline Windows install that has
// turned on the "sync" licence add-on. Every couple of minutes: pushes whatever is new in this computer's own
// sty_change_log up to AUZslab's cloud server, which applies it into a paired cloud tenant (auto-created the
// first time this install ever syncs -- see sty_cloud_sync_ensure_tenant); then pulls down whatever someone
// changed directly on that cloud tenant since the last pull. "The PC always wins" a conflict -- enforced in SQL
// (sty_local_apply_pulled_change, db/278), not here: this file just moves batches back and forth.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import { pool } from './db.js';
import { OFFLINE, licenceStatus } from './routes/licence.js';

const DEFAULT_URL = 'https://api.auzslab.in';
const BATCH = 200;

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

export async function pushOnce() {
  const s = licenceStatus();
  if (!s || !(s.addons && s.addons.sync) || (s.state !== 'active' && s.state !== 'grace')) return { skipped: true };
  const code = readCode(); if (!code) return { skipped: true };
  const { rows: trows } = await pool.query('select id from tenants limit 1'); const tid = trows[0]?.id; if (!tid) return { skipped: true };
  const { rows: crows } = await pool.query('select coalesce(last_pushed, 0) as c from sty_sync_cursor where tenant_id = $1', [tid]);
  let since = crows[0]?.c || 0; let total = 0;
  const base = process.env.AUZ_CLOUD_URL || DEFAULT_URL;
  for (let guard = 0; guard < 20; guard++) {
    const { rows } = await pool.query('select id, tbl, row_id as "rowId", op, row from sty_change_log where tenant_id = $1 and id > $2 order by id asc limit $3', [tid, since, BATCH]);
    if (!rows.length) break;
    const changes = rows.map((r) => ({ tbl: r.tbl, rowId: r.rowId, op: r.op, row: r.row }));
    await postJson(base, '/cloud/sync', code, { changes });
    since = rows[rows.length - 1].id; total += rows.length;
    await pool.query(
      `insert into sty_sync_cursor (tenant_id, last_pushed, updated_at) values ($1, $2, now())
       on conflict (tenant_id) do update set last_pushed = excluded.last_pushed, updated_at = now()`,
      [tid, since],
    );
    if (rows.length < BATCH) break;
  }
  return { pushed: total };
}

export async function pullOnce() {
  const s = licenceStatus();
  if (!s || !(s.addons && s.addons.sync) || (s.state !== 'active' && s.state !== 'grace')) return { skipped: true };
  const code = readCode(); if (!code) return { skipped: true };
  const { rows: trows } = await pool.query('select id from tenants limit 1'); const tid = trows[0]?.id; if (!tid) return { skipped: true };
  const { rows: crows } = await pool.query('select coalesce(last_pulled, 0) as c from sty_sync_cursor where tenant_id = $1', [tid]);
  let since = crows[0]?.c || 0; let total = 0;
  const base = process.env.AUZ_CLOUD_URL || DEFAULT_URL;
  for (let guard = 0; guard < 20; guard++) {
    const r = await getJson(base, '/cloud/sync?since=' + since, code);
    const changes = Array.isArray(r.changes) ? r.changes : [];
    if (!changes.length) break;
    const applied = (await pool.query('select sty_local_apply_pulled_batch($1, $2::jsonb) as r', [tid, JSON.stringify(changes)])).rows[0].r;
    since = r.cursor != null ? r.cursor : changes[changes.length - 1].id;
    total += applied.applied;
    await pool.query(
      `insert into sty_sync_cursor (tenant_id, last_pulled, updated_at) values ($1, $2, now())
       on conflict (tenant_id) do update set last_pulled = excluded.last_pulled, updated_at = now()`,
      [tid, since],
    );
    if (changes.length < 200) break;
  }
  return { pulled: total };
}

// In-memory only (resets if the app restarts): just enough for Settings to show the owner something -- "last
// tried", "last actually went through" and the error, if any -- without needing its own table.
const STATUS = { lastTriedAt: null, lastOkAt: null, lastError: null, lastPushed: 0, lastPulled: 0 };
export function syncStatus() { return { ...STATUS }; }

export function startSyncWorker() {
  if (!OFFLINE || process.env.DISABLE_MAINTENANCE === '1') return;
  const run = async () => {
    STATUS.lastTriedAt = new Date().toISOString();
    try {
      const up = await pushOnce(), down = await pullOnce();
      STATUS.lastError = null; STATUS.lastOkAt = STATUS.lastTriedAt; STATUS.lastPushed = up.pushed || 0; STATUS.lastPulled = down.pulled || 0;
    } catch (e) { STATUS.lastError = e.message; console.warn('cloud sync failed:', e.message); }
  };
  setTimeout(() => { run(); setInterval(run, 2 * 60_000).unref(); }, 15_000).unref();
}
