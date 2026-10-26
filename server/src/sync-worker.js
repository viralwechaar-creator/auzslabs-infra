// AUZsStyle Cloud Sync, Stage 1 (db/276): runs only inside an offline Windows install that has turned on the
// "sync" licence add-on. Every couple of minutes, pushes whatever is new in this computer's own sty_change_log
// up to AUZslab's cloud server, which applies it into a paired cloud tenant (auto-created the first time this
// install ever syncs -- see sty_cloud_sync_ensure_tenant). One-way only for now: the offline PC is always the
// source of truth, nothing comes back down yet.
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

export function startSyncWorker() {
  if (!OFFLINE || process.env.DISABLE_MAINTENANCE === '1') return;
  const run = () => pushOnce().catch((e) => console.warn('cloud sync push failed:', e.message));
  setTimeout(() => { run(); setInterval(run, 2 * 60_000).unref(); }, 15_000).unref();
}
