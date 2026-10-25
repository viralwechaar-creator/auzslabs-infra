'use strict';
// Cloud storage extra: send the shop's backup to AUZslab, list the copies kept there, bring one back. The licence code is the password.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const S = require('./setup.cjs');
const { packDir, unpackTo } = require('./pack.cjs');

const DEFAULT_URL = 'https://api.auzslab.in';
const mod = (u) => (u.protocol === 'https:' ? https : http);

function request(base, p, { method = 'GET', code, headers = {}, bodyFile, toFile }) {
  return new Promise((resolve, reject) => {
    const u = new URL(p, base);
    const h = { 'X-Licence': code, ...headers };
    if (bodyFile) { h['Content-Length'] = fs.statSync(bodyFile).size; h['Content-Type'] = 'application/gzip'; }
    const req = mod(u).request(u, { method, headers: h, timeout: 120000 }, (res) => {
      const fail = (txt) => { let m = txt; try { m = JSON.parse(txt).error || txt; } catch { /* plain */ } const e = new Error(m || 'HTTP ' + res.statusCode); e.status = res.statusCode; reject(e); };
      if (res.statusCode >= 400) { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => fail(b)); return; }
      if (toFile) { const w = fs.createWriteStream(toFile); res.pipe(w); w.on('finish', () => resolve({ headers: res.headers })); w.on('error', reject); return; }
      let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { resolve({}); } });
    });
    req.on('timeout', () => req.destroy(new Error('The connection to AUZslab timed out.')));
    req.on('error', (e) => reject(new Error(e.code === 'ENOTFOUND' || e.code === 'ECONNREFUSED' || e.code === 'EAI_AGAIN' ? 'No internet connection.' : e.message)));
    if (bodyFile) fs.createReadStream(bodyFile).pipe(req); else req.end();
  });
}
const sha256 = (f) => new Promise((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(f).on('data', (c) => h.update(c)).on('end', () => res(h.digest('hex'))).on('error', rej); });
const readCode = (dataDir) => { try { return JSON.parse(fs.readFileSync(path.join(dataDir, 'licence.json'), 'utf8')).code || ''; } catch { return ''; } };

// takes a backup of the shop, packs it into one file and uploads it
async function backupToCloud(o) {
  const base = o.cloudUrl || process.env.AUZ_CLOUD_URL || DEFAULT_URL, code = readCode(o.dataDir);
  if (!code) throw new Error('This computer is not activated yet.');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'auzcloud-'));
  try {
    if (process.getuid && process.getuid() === 0 && o.runAs) fs.chownSync(tmp, o.runAs.uid, o.runAs.gid);
    const folder = S.backup({ ...o, targetDir: tmp }); const file = path.join(tmp, 'backup.tgz');
    await packDir(folder, file);
    const res = await request(base, '/cloud/backup', { method: 'POST', code, bodyFile: file, headers: { 'X-Sha256': await sha256(file), 'X-Made-At': new Date().toISOString(), 'X-Device': os.hostname(), 'X-App-Version': o.appVersion || '' } });
    return res;
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
async function listCloud(o) { return request(o.cloudUrl || process.env.AUZ_CLOUD_URL || DEFAULT_URL, '/cloud/backups', { code: readCode(o.dataDir) }); }

// downloads one copy and puts it back in place of everything on this computer (the caller stops the server first)
async function restoreFromCloud(o, id) {
  const base = o.cloudUrl || process.env.AUZ_CLOUD_URL || DEFAULT_URL, code = readCode(o.dataDir);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'auzcloud-'));
  try {
    const file = path.join(tmp, 'backup.tgz');
    const r = await request(base, '/cloud/backup/' + id, { code, toFile: file });
    if (r.headers['x-sha256'] && r.headers['x-sha256'] !== await sha256(file)) throw new Error('The download was damaged. Try again.');
    const dir = path.join(tmp, 'folder'); await unpackTo(file, dir);
    if (process.getuid && process.getuid() === 0 && o.runAs) { for (const f of fs.readdirSync(dir)) { /* readable by the database user */ fs.chmodSync(path.join(dir, f), 0o755); } fs.chownSync(dir, o.runAs.uid, o.runAs.gid); fs.chmodSync(dir, 0o755); fs.chmodSync(tmp, 0o755); }
    await S.restore({ ...o, sourceDir: dir });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
module.exports = { backupToCloud, listCloud, restoreFromCloud, readCode };
