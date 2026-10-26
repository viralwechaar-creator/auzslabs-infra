import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { pipeline } from 'node:stream/promises';
import { pool } from '../db.js';
import { verifyLicence, publicFromPrivate, dayNumber, isoOf } from '../licence.js';
import { OFFLINE } from './licence.js';
import { HttpError, rateLimited, readJsonBody } from '../lib/http.js';

// Cloud storage for installed AUZsStyle copies. The licence code is the password: it proves the shop (our signature), says whether the cloud
// extra is paid for, and its id leads to the shop's lineage (one identity across renewals). Uploads need a running plan; the list and the
// download also work for 60 days after the plan ends, so a client can always get their data back.
const ROOT = process.env.CLOUD_BACKUP_ROOT || '/data/cloud-backups';
const MAX_BYTES = Number(process.env.CLOUD_BACKUP_MAX_MB || 400) * 1048576;
const KEEP = Number(process.env.CLOUD_BACKUP_KEEP || 14);
const RESTORE_DAYS = 60;
let PUB = null;
const pub = () => (PUB ||= process.env.LICENCE_PUBLIC_KEY || (process.env.LICENCE_PRIVATE_KEY ? publicFromPrivate(process.env.LICENCE_PRIVATE_KEY) : ''));

async function who(req, needActive, addon = 'cloud') {
  if (!pub()) throw new HttpError(503, 'Cloud storage is not set up on the server yet.');
  const code = String(req.headers['x-licence'] || '');
  const v = verifyLicence(code, pub());
  if (!v.ok) throw new HttpError(401, 'The licence code is not valid.');
  if (!v.addons[addon]) throw new HttpError(402, (addon === 'sync' ? 'Cloud sync' : 'Cloud storage') + ' is not part of your plan. Ask AUZslab to add it.');
  const left = dayNumber(v.end) - Math.floor((Date.now() - Date.UTC(2020, 0, 1)) / 86400000);
  if (needActive ? left < -3 : left < -RESTORE_DAYS) throw new HttpError(402, needActive ? 'Your plan has ended. Renew it to keep backing up to the cloud.' : 'Your plan ended more than ' + RESTORE_DAYS + ' days ago.');
  const { rows } = await pool.query('select cloud_lineage($1) as l', [v.id]);
  return { lineage: rows[0].l, shop: v.shop, end: v.end };
}

export async function handle(ctx) {
  if (OFFLINE) return false;
  const { req, res, url, ip, reply } = ctx;
  if (!url.pathname.startsWith('/cloud/')) return false;
  if (rateLimited('cloud:' + ip, 120, 15 * 60_000)) throw new HttpError(429, 'Too many requests. Try again in a few minutes.');

  if (url.pathname === '/cloud/backups' && req.method === 'GET') {
    const w = await who(req, false);
    const { rows } = await pool.query('select cloud_backup_list($1) as r', [w.lineage]);
    return reply(200, { shop: w.shop, plan_end: w.end, backups: rows[0].r });
  }

  if (url.pathname === '/cloud/backup' && req.method === 'POST') {
    const w = await who(req, true);
    const declared = Number(req.headers['content-length'] || 0);
    if (!declared || declared > MAX_BYTES) throw new HttpError(413, 'The backup is too big (limit ' + Math.round(MAX_BYTES / 1048576) + ' MB).');
    const dir = path.join(ROOT, w.lineage.replace(/[^a-z0-9]/gi, '')); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, Date.now() + '-' + crypto.randomBytes(4).toString('hex') + '.tgz');
    const hash = crypto.createHash('sha256'); let size = 0;
    try {
      await pipeline(req, async function* (src) { for await (const chunk of src) { size += chunk.length; if (size > MAX_BYTES) throw new HttpError(413, 'The backup is too big.'); hash.update(chunk); yield chunk; } }, fs.createWriteStream(file));
    } catch (e) { fs.rmSync(file, { force: true }); throw e; }
    const sha = hash.digest('hex');
    if (req.headers['x-sha256'] && String(req.headers['x-sha256']).toLowerCase() !== sha) { fs.rmSync(file, { force: true }); throw new HttpError(400, 'The upload was damaged on the way. Try again.'); }
    const madeAt = req.headers['x-made-at'] && !isNaN(Date.parse(req.headers['x-made-at'])) ? new Date(req.headers['x-made-at']).toISOString() : new Date().toISOString();
    const { rows } = await pool.query('select cloud_backup_add($1::jsonb) as id', [JSON.stringify({ lineage: w.lineage, size, sha256: sha, madeAt, device: String(req.headers['x-device'] || ''), appVersion: String(req.headers['x-app-version'] || ''), file: path.relative(ROOT, file) })]);
    const old = (await pool.query('select cloud_backup_prune($1, $2) as r', [w.lineage, KEEP])).rows[0].r;
    for (const f of old) fs.rmSync(path.join(ROOT, f), { force: true });
    return reply(200, { id: rows[0].id, size, sha256: sha });
  }

  // AUZsStyle Cloud Sync (Stage 1, db/276): the offline PC pushes its change log up here, in order, in batches.
  // The PC is always the source of truth -- nothing it sends is ever rejected for "the cloud already changed
  // this".
  if (url.pathname === '/cloud/sync' && req.method === 'POST') {
    const w = await who(req, true, 'sync');
    const body = await readJsonBody(req);
    const changes = Array.isArray(body.changes) ? body.changes.slice(0, 500) : [];
    const { rows } = await pool.query('select sty_cloud_sync_push($1, $2, $3::jsonb) as r', [w.lineage, w.shop, JSON.stringify(changes)]);
    return reply(200, rows[0].r);
  }

  // Stage 3 (db/278): the other direction. Whatever someone changed while signed into the paired cloud tenant
  // directly (db/277 gives them a login) -- never the PC's own pushes reflected back, see db/278's header for how
  // that's kept apart -- is handed down here, in order, since the cursor the PC already has.
  if (url.pathname === '/cloud/sync' && req.method === 'GET') {
    const w = await who(req, true, 'sync');
    const since = Math.max(0, Math.trunc(Number(url.searchParams.get('since'))) || 0);
    const { rows: trows } = await pool.query('select sty_cloud_sync_ensure_tenant($1, $2) as t', [w.lineage, w.shop]);
    const tid = trows[0].t;
    const { rows } = await pool.query('select sty_cloud_sync_pull($1, $2, 200) as r', [tid, since]);
    const changes = rows[0].r;
    return reply(200, { tenantId: tid, changes, cursor: changes.length ? changes[changes.length - 1].id : since });
  }

  // Stage 2 (db/277): give the paired cloud tenant an owner login, so someone can actually sign into it from
  // anywhere. Only the installed PC's own /offline/cloud-sync-register broker calls this -- the plaintext
  // password reaches this process over TLS and is hashed right here; it is never stored or logged in the clear.
  if (url.pathname === '/cloud/sync/register' && req.method === 'POST') {
    const w = await who(req, true, 'sync');
    const body = await readJsonBody(req);
    const email = String(body.email || '').trim();
    const password = String(body.password || '');
    if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query('select sty_cloud_sync_set_owner($1, $2, $3, $4, $5) as r', [w.lineage, w.shop, email, hash, String(body.name || '')])
      .then((x) => x.rows[0].r).catch((e) => { throw new HttpError(400, e.message); });
    return reply(200, { created: r.created, already: r.already, url: r.slug ? 'https://' + r.slug + '.auzslab.in/style.html' : null });
  }

  // Stage 5 (db/279): more than one remote login, and a way to turn one off -- list, add (manager/cashier; the
  // owner login above stays the one way to make the FIRST login), remove.
  if (url.pathname === '/cloud/sync/logins' && req.method === 'GET') {
    const w = await who(req, true, 'sync');
    const { rows } = await pool.query('select sty_cloud_sync_list_logins($1) as r', [w.lineage]);
    return reply(200, { logins: rows[0].r });
  }
  if (url.pathname === '/cloud/sync/logins' && req.method === 'POST') {
    const w = await who(req, true, 'sync');
    const body = await readJsonBody(req);
    const email = String(body.email || '').trim();
    const password = String(body.password || '');
    if (password.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.');
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query('select sty_cloud_sync_add_login($1, $2, $3, $4, $5, $6) as r', [w.lineage, w.shop, email, hash, String(body.role || 'cashier'), String(body.name || '')])
      .then((x) => x.rows[0].r).catch((e) => { throw new HttpError(400, e.message); });
    return reply(200, r);
  }
  if (url.pathname === '/cloud/sync/logins' && req.method === 'DELETE') {
    const w = await who(req, true, 'sync');
    const email = String(url.searchParams.get('email') || '').trim();
    const { rows } = await pool.query('select sty_cloud_sync_remove_login($1, $2) as r', [w.lineage, email]);
    return reply(200, rows[0].r);
  }

  const m = url.pathname.match(/^\/cloud\/backup\/([0-9a-f-]{36})$/);
  if (m && req.method === 'GET') {
    const w = await who(req, false);
    const row = (await pool.query('select cloud_backup_file($1, $2) as r', [w.lineage, m[1]])).rows[0].r;
    if (!row) throw new HttpError(404, 'That backup was not found.');
    const f = path.join(ROOT, row.file);
    if (!f.startsWith(path.resolve(ROOT) + path.sep) || !fs.existsSync(f)) throw new HttpError(404, 'That backup file is no longer on the server.');
    res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Length': fs.statSync(f).size, 'X-Sha256': row.sha256 || '', 'X-Made-At': new Date(row.made_at).toISOString() });
    fs.createReadStream(f).pipe(res);
    return;
  }
  return false;
}
