// The installed Windows copy, run here with a real PostgreSQL cluster made by desktop-style/lib/setup.cjs (same code the installer uses):
// build the database from db/*.sql, start the local server in offline mode, activate a licence code, set up the shop in a real browser,
// sell nothing but save a style, then take a backup, wipe, restore it and sign in again.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createRequire } from 'node:module';
import { suite, watch, assert } from '../../lib/harness.mjs';
import { makeKeypair, signLicence } from '../../../server/src/licence.js';

const require = createRequire(import.meta.url);
const L = require('../../../desktop-style/lib/setup.cjs');
const root = path.resolve('.');
const free = () => new Promise((r) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
const SERVER_DIR = process.env.TEST_SERVER_DIR || path.join(root, 'server'); // the Windows 7 build is tested with its older dependencies and an older Node
const NODE = process.env.TEST_NODE || 'node', PRELOAD = process.env.TEST_PRELOAD ? ['--require', process.env.TEST_PRELOAD] : [];
const PGBIN = process.env.TEST_PG_BIN || ['/usr/lib/postgresql/16/bin', '/usr/lib/postgresql/15/bin', '/usr/lib/postgresql/14/bin'].find((d) => fs.existsSync(d + '/initdb'));

export default async function run({ browser }) {
  const s = suite('Installed Windows copy (offline server + local database)', 'Cluster, migrations, licence, first-run setup, sign-in, backup and restore, using the installer code.');
  if (!PGBIN) { await s.check('PostgreSQL binaries available', async () => { throw new Error('no PostgreSQL binaries found'); }); s.done(); return; }
  if (process.getuid && process.getuid() === 0) { const u = spawnSync('id', ['-u', 'postgres'], { encoding: 'utf8' }); const g = spawnSync('id', ['-g', 'postgres'], { encoding: 'utf8' }); L.setRunAs({ uid: Number(u.stdout), gid: Number(g.stdout) }); }
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auzdesk-')); fs.chmodSync(dataDir, 0o755);
  const bak = fs.mkdtempSync(path.join(os.tmpdir(), 'auzbak-')); if (L.setRunAs && process.getuid && process.getuid() === 0) fs.chownSync(bak, ...[Number(spawnSync('id', ['-u', 'postgres'], { encoding: 'utf8' }).stdout), Number(spawnSync('id', ['-g', 'postgres'], { encoding: 'utf8' }).stdout)]);
  const pgPort = await free(), apiPort = await free();
  const sec = L.secrets(dataDir); const uploads = path.join(dataDir, 'uploads'); fs.mkdirSync(uploads, { recursive: true });
  const o = { pgBin: PGBIN, dataDir, port: pgPort, superPassword: sec.superPassword, serverDir: SERVER_DIR, dbDir: path.join(root, 'db'), appPassword: sec.appPassword };
  const k = makeKeypair();
  let server;
  const startServer = async () => {
    server = spawn(NODE, [...PRELOAD, 'src/index.js'], { cwd: SERVER_DIR, stdio: 'ignore', env: { ...process.env, PORT: String(apiPort), AUZ_OFFLINE: '1', AUZ_DATA_DIR: dataDir, AUZ_APP_ROOT: path.join(root, 'app/public'), UPLOAD_ROOT: uploads, DOC_UPLOAD_ROOT: path.join(dataDir, 'docs'), PGHOST: '127.0.0.1', PGPORT: String(pgPort), POSTGRES_APP_PASSWORD: sec.appPassword, POSTGRES_DB: L.DB, JWT_SECRET: sec.jwtSecret, LICENCE_PUBLIC_KEY: k.pub, DISABLE_MAINTENANCE: '1', PG_POOL_MAX: '5', DISABLE_RATE_LIMIT: '1' } });
    for (let i = 0; i < 80; i++) { try { const r = await fetch(`http://127.0.0.1:${apiPort}/health`); if (r.ok) return; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 250)); }
    throw new Error('local server did not start');
  };
  const base = `http://127.0.0.1:${apiPort}`;
  try {
    await s.check('A new database cluster is made, started and built from the migrations with the sample data removed', async () => {
      assert(L.ensureCluster(o) === true, 'cluster not created');
      L.startPg(o);
      const r = await L.migrate(o); assert(r.fresh && r.applied > 200, JSON.stringify(r));
      const again = await L.migrate(o); assert(!again.fresh && again.applied === 0, 'second run should apply nothing: ' + JSON.stringify(again));
      const c = require(require.resolve('pg', { paths: [o.serverDir] })); const cl = new c.Client({ host: '127.0.0.1', port: pgPort, user: 'postgres', password: sec.superPassword, database: L.DB }); await cl.connect();
      const n = (await cl.query('select (select count(*) from tenants) t, (select count(*) from auth_users) u')).rows[0]; await cl.end();
      assert(Number(n.t) === 0 && Number(n.u) === 0, 'sample data left: ' + JSON.stringify(n));
    }, 'critical');
    await startServer();
    await s.check('The local server serves the app pages and locks the data until a licence code is entered', async () => {
      const page = await fetch(base + '/'); assert(page.ok && /AUZsStyle/.test(await page.text()), 'style.html not served');
      assert((await (await fetch(base + '/config.js')).text()).includes(base), 'config.js should point at this server');
      assert((await fetch(base + '/rpc/sty_context', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status === 402, 'data not locked');
      assert((await fetch(base + '/../../etc/passwd')).status !== 200, 'path escape');
    }, 'critical');
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } }); const page = await ctx.newPage(); const errs = watch(page);
    const code = signLicence({ shop: 'Offline Shop', end: '2099-12-31', addons: { cloud: true } }, k.priv);
    await s.check('In a browser: Activate screen, then first-run setup, then the app opens signed in', async () => {
      await page.goto(base + '/'); await page.waitForSelector('textarea', { timeout: 20000 });
      assert(/Activate AUZsStyle/i.test(await page.locator('h1').innerText()), 'no activate screen');
      await page.fill('textarea', 'AUZ-WRONG'); await page.locator('button', { hasText: /activate/i }).click(); await page.waitForTimeout(600);
      assert(/not valid|short/i.test(await page.locator('[role=alert]').innerText()), 'bad code accepted?');
      await page.fill('textarea', code); await page.locator('button', { hasText: /activate/i }).click();
      await page.waitForSelector('form input[type=email]', { timeout: 20000 });
      assert(/Set up your shop/i.test(await page.locator('h1').innerText()), 'no setup screen');
      const inputs = page.locator('form input'); await inputs.nth(0).fill('Offline Shop'); await inputs.nth(1).fill('Asha'); await inputs.nth(2).fill('asha@shop.test'); await inputs.nth(3).fill('Secret!pass1'); await inputs.nth(4).fill('Secret!pass1');
      await page.locator('button', { hasText: /create my shop/i }).click();
      try { await page.waitForSelector('.shell', { timeout: 30000 }); } catch (e) { const st = await (await fetch(base + '/setup/state')).text(); await page.screenshot({ path: '/tmp/desk.png' }); throw new Error('app did not open: state=' + st + ' ' + (await page.locator('body').innerText()).slice(0, 300) + ' | ' + errs.slice(-4).join(' ; ')); }
    }, 'critical');
    await s.check('Setup cannot be repeated, and the shop can save a style', async () => {
      const again = await fetch(base + '/setup/first-run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ shop: 'Other', email: 'x@y.test', password: 'abcdefgh1' }) }); assert(again.status === 400, 'second setup allowed');
      const r = await page.evaluate(async () => { const x = await api('sty_save_style', { p: { name: 'Offline Tee', category: 'Tees', price: 500, mrp: 600, cost: 200, colours: ['Red'], sizes: ['M'], opening: { qty: 4, unitCost: 200, branchId: S.branch } } }); S.catAt = 0; await loadCatalog(true); return { id: x.id, n: S.cat.length }; });
      assert(r.id && r.n === 1, JSON.stringify(r));
    }, 'critical');
    let out;
    await s.check('A backup folder is made (database + pictures)', async () => {
      fs.writeFileSync(path.join(uploads, 'photo.txt'), 'pic'); if (process.getuid && process.getuid() === 0) fs.chmodSync(path.join(uploads, 'photo.txt'), 0o644);
      out = L.backup({ ...o, uploadDir: uploads, targetDir: bak });
      assert(fs.statSync(path.join(out, 'db.dump')).size > 1000 && fs.existsSync(path.join(out, 'uploads', 'photo.txt')) && fs.existsSync(path.join(out, 'about.json')), 'backup incomplete');
    }, 'critical');
    await s.check('After changes, a restore brings the shop back exactly as it was and sign-in still works', async () => {
      await page.evaluate(async () => { await api('sty_save_style', { p: { name: 'Added later', category: 'Tees', price: 100, mrp: 100, cost: 50, colours: ['Blue'], sizes: ['L'] } }); });
      fs.rmSync(path.join(uploads, 'photo.txt'));
      server.kill(); await new Promise((r) => setTimeout(r, 800));
      await L.restore({ ...o, uploadDir: uploads, sourceDir: out });
      assert(fs.existsSync(path.join(uploads, 'photo.txt')), 'pictures not restored');
      await startServer();
      const login = await (await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'asha@shop.test', password: 'Secret!pass1' }) })).json();
      assert(login.access_token, 'cannot sign in after restore: ' + JSON.stringify(login));
      const H = { 'content-type': 'application/json', authorization: 'Bearer ' + login.access_token }; const cx = (await (await fetch(base + '/rpc/sty_context', { method: 'POST', headers: H, body: '{}' })).json()).data || {};
      const cat = (await (await fetch(base + '/rpc/sty_catalog', { method: 'POST', headers: H, body: JSON.stringify({ p_branch: (cx.branches || [])[0] ? cx.branches[0].id : null }) })).json()).data;
      const names = (Array.isArray(cat) ? cat : (cat.styles || cat.items || [])).map((x) => x.name); assert(names.includes('Offline Tee') && !names.includes('Added later'), JSON.stringify(names) + ' raw=' + JSON.stringify(cat).slice(0, 200) + ' ctx=' + JSON.stringify(cx).slice(0, 200));
    }, 'critical');
    await s.check('No script errors in the app', async () => { const bad = errs.filter((e) => !/favicon|sentry|net::|Failed to load resource|Failed to fetch|licence\/activate|first time you open it/i.test(String(e))); assert(!bad.length, bad.slice(0, 3).join(' | ')); });
    await ctx.close();
  } finally {
    try { server && server.kill(); } catch { /* ignore */ }
    try { L.stopPg(o); } catch { /* ignore */ }
    fs.rmSync(dataDir, { recursive: true, force: true }); fs.rmSync(bak, { recursive: true, force: true });
  }
  s.done();
}
