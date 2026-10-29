// The installed Windows copy, run here with a real PostgreSQL cluster made by desktop-style/lib/setup.cjs (same code the installer uses):
// build the database from db/*.sql, start the local server in offline mode, activate a licence code, set up the shop in a real browser,
// sell nothing but save a style, then take a backup, wipe, restore it and sign in again.
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createRequire } from 'node:module';
import { suite, watch, assert } from '../../lib/harness.mjs';
import { makeKeypair, signLicence } from '../../../server/src/licence.js';

const require = createRequire(import.meta.url);
const L = require('../../../desktop-style/lib/setup.cjs');
const CL = require('../../../desktop-style/lib/cloud.cjs');
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
    await s.check('A leftover, broken pgdata folder (from a setup that crashed or was killed mid-way, no PG_VERSION file) does not jam the computer forever -- it is cleared and a real cluster is made in its place', async () => {
      const pgdata = path.join(dataDir, 'pgdata');
      fs.mkdirSync(pgdata, { recursive: true });
      fs.writeFileSync(path.join(pgdata, 'junk.tmp'), 'leftover from an interrupted first run');
      assert(L.ensureCluster(o) === true, 'cluster not created over leftover junk');
      assert(fs.existsSync(path.join(pgdata, 'PG_VERSION')), 'a real cluster should exist now');
      assert(!fs.existsSync(path.join(pgdata, 'junk.tmp')), 'the leftover file should be gone');
    }, 'critical');
    await s.check('A cluster whose first setup was cut off (our settings never written, so it would use port 5432) is repaired on the next start', async () => {
      const f = path.join(dataDir, 'pgdata', 'postgresql.conf');
      const t = fs.readFileSync(f, 'utf8'); fs.writeFileSync(f, t.slice(0, t.indexOf('# AUZslab settings')));
      assert(L.ensureCluster(o) === false, 'should not be remade');
      const u = fs.readFileSync(f, 'utf8');
      assert(u.includes('# AUZslab settings') && new RegExp('^port = ' + pgPort + '$', 'm').test(u), 'settings not restored');
      L.ensureCluster(o); assert((fs.readFileSync(f, 'utf8').match(/# AUZslab settings/g) || []).length === 1, 'settings written twice');
    }, 'critical');
    await s.check('A new database cluster is made, started and built from the migrations with the sample data removed', async () => {
      assert(L.ensureCluster(o) === false, 'cluster already made by the previous check, should not be remade');
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
    await s.check('Offline diagnostics: /offline/logs works even with no licence yet (reporting a bug must not need an active plan); /offline/lan-info stays locked', async () => {
      fs.writeFileSync(path.join(dataDir, 'app.log'), 'hello from app.log\n');
      const logs = await (await fetch(base + '/offline/logs')).json();
      assert(logs.appLog.includes('hello from app.log'), 'app.log not read: ' + JSON.stringify(logs));
      assert((await fetch(base + '/offline/lan-info')).status === 402, 'lan-info should still be licence-gated');
    });
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
    await s.check('Installed copy: the UPI id saves in Settings and survives a reload, and Sell shows the UPI QR', async () => {
      await page.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false, configurable: true }); });   // an installed PC with no network card (Windows 7) reports itself offline even though the local server is right there
      await page.evaluate(() => { Object.defineProperty(Navigator.prototype, 'onLine', { get: () => false, configurable: true }); location.hash = '#/settings'; }); await page.waitForSelector('.setg', { timeout: 15000 });
      const idIn = page.locator('.field', { hasText: /UPI id/ }).locator('input').first();
      await idIn.fill('shop@okaxis');
      await page.locator('button', { hasText: /Save settings/ }).click(); await page.waitForTimeout(1500);
      await page.waitForSelector('.setg', { timeout: 15000 });
      const after = await page.locator('.field', { hasText: /UPI id/ }).locator('input').first().inputValue();
      const q = await page.evaluate(() => JSON.stringify((JSON.parse(localStorage.getItem('sty.q.' + (S.dash && S.dash.tenant ? S.dash.tenant.slug : 'x')) || '[]')).map((e) => [e.fn, e.fail || ''])));
      assert(q === '[]', 'the change is stuck waiting on this PC and never reaches the local server: ' + q);
      assert(after === 'shop@okaxis', 'UPI id not kept after reload: "' + after + '" queue=' + q + ' errs=' + errs.slice(-3).join(' ; '));
      const feat = await page.evaluate(async () => { const c = await api('sty_context'); return (c.settings.features || {}).upiId; });
      assert(feat === 'shop@okaxis', 'server did not keep the UPI id: ' + feat);
      await page.evaluate(() => { location.hash = '#/sell'; }); await page.waitForSelector('.scard', { timeout: 15000 });
      const bc = await page.evaluate(async () => { const c = await api('sty_catalog', { p_branch: null }); return c[0].variants[0].barcode; });
      await page.fill('.sell-l input[type=search]', bc); await page.keyboard.press('Enter'); await page.waitForTimeout(600);
      await page.locator('.cartpane .btn.fill', { hasText: /Pay/ }).click(); await page.waitForSelector('.paytot', { timeout: 8000 });
      const pays = page.locator('.payl'); const n = await pays.count(); let row = null; for (let i = 0; i < n; i++) { if (/UPI/i.test(await pays.nth(i).locator('label').innerText())) row = pays.nth(i); }
      await row.locator('.btn.sm').click(); await page.waitForTimeout(300);
      await page.locator('.upiq .btn', { hasText: /Show QR/ }).click(); await page.waitForTimeout(600);
      assert(await page.locator('.upiq-i').count() === 1, 'no QR image in the popup: ' + (await page.locator('.upiq-card').innerText().catch(() => 'no popup')) + ' errs=' + errs.slice(-3).join(' ; '));
      await page.keyboard.press('Escape');
    }, 'critical');
    await s.check('Offline diagnostics: /offline/lan-info now works once a licence is active, and leaves out loopback', async () => {
      const info = await (await fetch(base + '/offline/lan-info')).json();
      assert(Array.isArray(info.ips) && info.ips.every((ip) => ip !== '127.0.0.1'), 'lan-info: ' + JSON.stringify(info));
      assert(info.port === apiPort, 'wrong port reported: ' + JSON.stringify(info));
    });
    await s.check('Cloud Sync status (Stage 4): /offline/sync-status says plainly it is not available when the licence has no sync add-on', async () => {
      const st = await (await fetch(base + '/offline/sync-status')).json();
      assert(st.available === false, 'this shop\'s licence has no sync add-on, status should say unavailable: ' + JSON.stringify(st));
    });
    let out;
    await s.check('A backup folder is made (database + pictures)', async () => {
      fs.writeFileSync(path.join(uploads, 'photo.txt'), 'pic'); if (process.getuid && process.getuid() === 0) fs.chmodSync(path.join(uploads, 'photo.txt'), 0o644);
      out = L.backup({ ...o, uploadDir: uploads, targetDir: bak });
      assert(fs.statSync(path.join(out, 'db.dump')).size > 1000 && fs.existsSync(path.join(out, 'uploads', 'photo.txt')) && fs.existsSync(path.join(out, 'about.json')), 'backup incomplete');
    }, 'critical');
    await s.check('Automatic local backup: a free daily backup to this computer\'s own disk, with no licence add-on, keeping only the newest N', async () => {
      const localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'auzlocalbak-'));
      if (L.setRunAs && process.getuid && process.getuid() === 0) fs.chownSync(localDir, ...[Number(spawnSync('id', ['-u', 'postgres'], { encoding: 'utf8' }).stdout), Number(spawnSync('id', ['-g', 'postgres'], { encoding: 'utf8' }).stdout)]);
      for (let i = 0; i < 3; i++) { L.backupAndPrune({ ...o, uploadDir: uploads, targetDir: localDir, keep: 2 }); await new Promise((res) => setTimeout(res, 1100)); }
      const left = fs.readdirSync(localDir).filter((n) => n.startsWith('AUZsStyle-backup-'));
      assert(left.length === 2, 'should keep exactly 2, kept ' + left.length + ': ' + JSON.stringify(left));
      for (const b of left) assert(fs.existsSync(path.join(localDir, b, 'db.dump')), b + ' missing db.dump');
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
    await s.check('Cloud storage: a backup goes to the server with the licence code, is listed, and can be restored on this computer', async () => {
      const cport = await free(), croot = fs.mkdtempSync(path.join(os.tmpdir(), 'auzcloudroot-')); const cbase = `http://127.0.0.1:${cport}`;
      const cloud = spawn(NODE, [...PRELOAD, 'src/index.js'], { cwd: SERVER_DIR, stdio: 'ignore', env: { ...process.env, PORT: String(cport), PGHOST: '127.0.0.1', PGPORT: String(pgPort), POSTGRES_APP_PASSWORD: sec.appPassword, POSTGRES_DB: L.DB, JWT_SECRET: sec.jwtSecret, LICENCE_PRIVATE_KEY: k.priv, CLOUD_BACKUP_ROOT: croot, DISABLE_MAINTENANCE: '1', PG_POOL_MAX: '5', DISABLE_RATE_LIMIT: '1' } });
      try {
        for (let i = 0; i < 80; i++) { try { if ((await fetch(cbase + '/health')).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 250)); }
        const runAs = process.getuid && process.getuid() === 0 ? { uid: Number(spawnSync('id', ['-u', 'postgres'], { encoding: 'utf8' }).stdout), gid: Number(spawnSync('id', ['-g', 'postgres'], { encoding: 'utf8' }).stdout) } : null;
        const co = { ...o, uploadDir: uploads, cloudUrl: cbase, runAs, appVersion: 'test' };
        const up = await CL.backupToCloud(co); assert(up.id && up.size > 1000, JSON.stringify(up));
        const ls = await CL.listCloud(co); assert(ls.backups.length === 1 && ls.shop === 'Offline Shop', JSON.stringify(ls));
        // a code without the cloud extra, a code that is not ours, and an ended plan are all refused
        const send = async (c) => (await fetch(cbase + '/cloud/backups', { headers: { 'x-licence': c } })).status;
        assert(await send(signLicence({ shop: 'No Cloud', end: '2099-01-01' }, k.priv)) === 402, 'no cloud extra should be 402');
        assert(await send('AUZ-NOTACODE') === 401 && await send(signLicence({ shop: 'X', end: '2099-01-01', addons: { cloud: true } }, makeKeypair().priv)) === 401, 'foreign code should be 401');
        const ended = signLicence({ shop: 'Old', end: '2024-01-01', addons: { cloud: true } }, k.priv); assert(await send(ended) === 402, 'long-ended plan cannot even list');
        const up2 = await fetch(cbase + '/cloud/backup', { method: 'POST', headers: { 'x-licence': signLicence({ shop: 'Old', end: '2026-10-20', addons: { cloud: true } }, k.priv), 'content-length': '5', 'content-type': 'application/gzip' }, body: 'hello' });
        assert(up2.status === 402 || up2.status === 200, 'ended-plan upload status ' + up2.status);
        // change something after the backup, then bring the cloud copy back
        await page.evaluate(async () => { await api('sty_save_style', { p: { name: 'After cloud', category: 'Tees', price: 100, mrp: 100, cost: 50, colours: ['Blue'], sizes: ['L'] } }); });
        server.kill(); await new Promise((r) => setTimeout(r, 800));
        await CL.restoreFromCloud(co, ls.backups[0].id); await startServer();
        const lg = await (await fetch(base + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'asha@shop.test', password: 'Secret!pass1' }) })).json();
        const H2 = { 'content-type': 'application/json', authorization: 'Bearer ' + lg.access_token };
        const cx2 = (await (await fetch(base + '/rpc/sty_context', { method: 'POST', headers: H2, body: '{}' })).json()).data;
        const cat2 = (await (await fetch(base + '/rpc/sty_catalog', { method: 'POST', headers: H2, body: JSON.stringify({ p_branch: cx2.branches[0].id }) })).json()).data.map((x) => x.name);
        assert(cat2.includes('Offline Tee') && !cat2.includes('After cloud'), JSON.stringify(cat2));
        assert((await (await fetch(base + '/licence/status')).json()).state === 'active', 'licence should survive');
      } finally { cloud.kill(); fs.rmSync(croot, { recursive: true, force: true }); }
    }, 'critical');
    await s.check('Cloud Sync Stage 1: the change log records real writes, and the cloud ingest endpoint applies them into a new, auto-paired tenant', async () => {
      const c = require(require.resolve('pg', { paths: [o.serverDir] }));
      const cl = new c.Client({ host: '127.0.0.1', port: pgPort, user: 'postgres', password: sec.superPassword, database: L.DB }); await cl.connect();
      try {
        // a real write already made earlier in this suite ("Offline Tee") must have been logged by the trigger
        const logged = (await cl.query(`select id, tbl, row_id as "rowId", op, row from sty_change_log where tbl = 'sty_styles' and row->>'name' = 'Offline Tee' order by id desc limit 1`)).rows[0];
        assert(logged && logged.op === 'upsert' && logged.row.name === 'Offline Tee', 'the style save should have been logged: ' + JSON.stringify(logged));

        const cport = await free(), cbase = `http://127.0.0.1:${cport}`;
        const cloud2 = spawn(NODE, [...PRELOAD, 'src/index.js'], { cwd: SERVER_DIR, stdio: 'ignore', env: { ...process.env, PORT: String(cport), PGHOST: '127.0.0.1', PGPORT: String(pgPort), POSTGRES_APP_PASSWORD: sec.appPassword, POSTGRES_DB: L.DB, JWT_SECRET: sec.jwtSecret, LICENCE_PRIVATE_KEY: k.priv, DISABLE_MAINTENANCE: '1', PG_POOL_MAX: '5', DISABLE_RATE_LIMIT: '1' } });
        try {
          for (let i = 0; i < 80; i++) { try { if ((await fetch(cbase + '/health')).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 250)); }
          // no 'sync' add-on: refused
          const noSync = signLicence({ shop: 'Offline Shop', end: '2099-12-31', addons: { cloud: true } }, k.priv);
          const r1 = await fetch(cbase + '/cloud/sync', { method: 'POST', headers: { 'content-type': 'application/json', 'x-licence': noSync }, body: JSON.stringify({ changes: [] }) });
          assert(r1.status === 402, 'sync add-on should be required, got ' + r1.status);
          // with 'sync': the push is applied, and a brand-new cloud tenant is auto-provisioned the first time.
          // In real life the offline PC and the cloud have entirely separate databases, so an id can never clash
          // between them; this test shares one Postgres cluster for convenience, so it clones the real logged row
          // under a FRESH id to push (a realistic full row, not a hand-built one, but one that cannot collide with
          // the offline tenant's own actual "Offline Tee" row still sitting in this same shared database).
          const freshId = crypto.randomUUID(); const freshRow = { ...logged.row, id: freshId };
          const syncCode = signLicence({ shop: 'Offline Shop', end: '2099-12-31', addons: { sync: true } }, k.priv);
          const push = await (await fetch(cbase + '/cloud/sync', { method: 'POST', headers: { 'content-type': 'application/json', 'x-licence': syncCode }, body: JSON.stringify({ changes: [{ tbl: logged.tbl, rowId: freshId, op: 'upsert', row: freshRow }] }) })).json();
          assert(push.tenantId && push.applied === 1 && push.failed.length === 0, 'push should apply cleanly: ' + JSON.stringify(push));
          const cloudTenant = (await cl.query('select id, niche from tenants where id = $1', [push.tenantId])).rows[0];
          assert(cloudTenant && cloudTenant.niche === 'retail', 'a real cloud tenant should have been created: ' + JSON.stringify(cloudTenant));
          const cloudStyle = (await cl.query('select name, tenant_id from sty_styles where id = $1', [freshId])).rows[0];
          assert(cloudStyle && cloudStyle.name === 'Offline Tee' && cloudStyle.tenant_id === push.tenantId, 'the style should exist under the NEW cloud tenant, not the offline one: ' + JSON.stringify(cloudStyle));
          const offlineStyleUntouched = (await cl.query('select tenant_id from sty_styles where id = $1', [logged.rowId])).rows[0];
          assert(offlineStyleUntouched && offlineStyleUntouched.tenant_id !== push.tenantId, 'the PC\'s own real row must be untouched by the push: ' + JSON.stringify(offlineStyleUntouched));
          // pushing again (the same lineage) reuses the SAME tenant, it does not make a second one
          const push2 = await (await fetch(cbase + '/cloud/sync', { method: 'POST', headers: { 'content-type': 'application/json', 'x-licence': syncCode }, body: JSON.stringify({ changes: [{ tbl: logged.tbl, rowId: freshId, op: 'upsert', row: freshRow }] }) })).json();
          assert(push2.tenantId === push.tenantId, 'a second push from the same install should reuse the same cloud tenant: ' + JSON.stringify(push2));
          // a delete is applied too
          const delPush = await (await fetch(cbase + '/cloud/sync', { method: 'POST', headers: { 'content-type': 'application/json', 'x-licence': syncCode }, body: JSON.stringify({ changes: [{ tbl: logged.tbl, rowId: freshId, op: 'delete' }] }) })).json();
          assert(delPush.applied === 1, 'delete should apply: ' + JSON.stringify(delPush));
          const gone = (await cl.query('select 1 from sty_styles where id = $1', [freshId])).rows[0];
          assert(!gone, 'the row should be gone from the cloud tenant after a delete push');
          // an unknown table name is refused outright, never silently run through dynamic SQL
          const badTbl = await (await fetch(cbase + '/cloud/sync', { method: 'POST', headers: { 'content-type': 'application/json', 'x-licence': syncCode }, body: JSON.stringify({ changes: [{ tbl: 'pg_shadow', rowId: crypto.randomUUID(), op: 'upsert', row: {} }] }) })).json();
          assert(badTbl.failed && badTbl.failed.length === 1 && badTbl.applied === 0, 'an unknown/disallowed table must be refused, not run: ' + JSON.stringify(badTbl));
        } finally { cloud2.kill(); }
      } finally { await cl.end(); }
    }, 'critical');
    await s.check('Cloud Sync Stage 2: Settings\' "Turn on remote access" broker (offline PC -> cloud) actually creates a working owner login on the paired cloud tenant', async () => {
      const cport = await free(), cbase = `http://127.0.0.1:${cport}`;
      const cloud3 = spawn(NODE, [...PRELOAD, 'src/index.js'], { cwd: SERVER_DIR, stdio: 'ignore', env: { ...process.env, PORT: String(cport), PGHOST: '127.0.0.1', PGPORT: String(pgPort), POSTGRES_APP_PASSWORD: sec.appPassword, POSTGRES_DB: L.DB, JWT_SECRET: sec.jwtSecret, LICENCE_PRIVATE_KEY: k.priv, DISABLE_MAINTENANCE: '1', PG_POOL_MAX: '5', DISABLE_RATE_LIMIT: '1' } });
      const dataDir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'auzdesk2-'));
      let offline3;
      try {
        for (let i = 0; i < 80; i++) { try { if ((await fetch(cbase + '/health')).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 250)); }
        const syncCode = signLicence({ shop: 'Second Shop', end: '2099-12-31', addons: { sync: true } }, k.priv);
        fs.writeFileSync(path.join(dataDir2, 'licence.json'), JSON.stringify({ code: syncCode }));
        const oport = await free(), obase = `http://127.0.0.1:${oport}`;
        offline3 = spawn(NODE, [...PRELOAD, 'src/index.js'], { cwd: SERVER_DIR, stdio: 'ignore', env: { ...process.env, PORT: String(oport), AUZ_OFFLINE: '1', AUZ_DATA_DIR: dataDir2, AUZ_APP_ROOT: path.join(root, 'app/public'), AUZ_CLOUD_URL: cbase, PGHOST: '127.0.0.1', PGPORT: String(pgPort), POSTGRES_APP_PASSWORD: sec.appPassword, POSTGRES_DB: L.DB, JWT_SECRET: sec.jwtSecret, LICENCE_PUBLIC_KEY: k.pub, DISABLE_MAINTENANCE: '1', PG_POOL_MAX: '5', DISABLE_RATE_LIMIT: '1' } });
        for (let i = 0; i < 80; i++) { try { if ((await fetch(obase + '/health')).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 250)); }
        const st = await (await fetch(obase + '/offline/sync-status')).json();
        assert(st.available === true, 'this shop\'s licence has the sync add-on, status should say available: ' + JSON.stringify(st));
        // bad email / short password are refused by the local broker itself, before any call reaches the cloud
        const badEmail = await fetch(obase + '/offline/cloud-sync-register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'nope', password: 'longenough1' }) });
        assert(badEmail.status === 400, 'bad email should be refused locally: ' + badEmail.status);
        const shortPw = await fetch(obase + '/offline/cloud-sync-register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@shop.test', password: 'short' }) });
        assert(shortPw.status === 400, 'short password should be refused locally: ' + shortPw.status);
        const reg = await (await fetch(obase + '/offline/cloud-sync-register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@shop.test', password: 'Secret!pass1', name: 'Asha' }) })).json();
        assert(reg.created && reg.url && /^https:\/\/sync-.*\.auzslab\.in\/style\.html$/.test(reg.url), 'registration should succeed with a sign-in url: ' + JSON.stringify(reg));
        const c = require(require.resolve('pg', { paths: [o.serverDir] }));
        const cl = new c.Client({ host: '127.0.0.1', port: pgPort, user: 'postgres', password: sec.superPassword, database: L.DB }); await cl.connect();
        try {
          const row = (await cl.query(`select p.role, t.slug from profiles p join auth_users u on u.id = p.id join tenants t on t.id = p.tenant_id where u.email = 'owner@shop.test'`)).rows[0];
          assert(row && row.role === 'owner' && 'https://' + row.slug + '.auzslab.in/style.html' === reg.url, 'the owner login should exist under the cloud tenant the url points at: ' + JSON.stringify(row));
        } finally { await cl.end(); }
        // registering again for the same shop is a no-op that says so, not an error or a second login
        const again = await (await fetch(obase + '/offline/cloud-sync-register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'owner@shop.test', password: 'Secret!pass1' }) })).json();
        assert(again.already === true, 'a second registration for the same shop should say already: ' + JSON.stringify(again));
        // a DIFFERENT shop (its own licence id -> its own lineage -> its own new cloud tenant, with no owner yet)
        // trying to reuse asha@shop.test (the first offline shop's real owner login, same shared database in this
        // test) must be refused: that email already belongs to a different real business
        const dataDir3 = fs.mkdtempSync(path.join(os.tmpdir(), 'auzdesk3-'));
        const syncCode2 = signLicence({ shop: 'Third Shop', end: '2099-12-31', addons: { sync: true } }, k.priv);
        fs.writeFileSync(path.join(dataDir3, 'licence.json'), JSON.stringify({ code: syncCode2 }));
        const oport2 = await free(), obase2 = `http://127.0.0.1:${oport2}`;
        const offline4 = spawn(NODE, [...PRELOAD, 'src/index.js'], { cwd: SERVER_DIR, stdio: 'ignore', env: { ...process.env, PORT: String(oport2), AUZ_OFFLINE: '1', AUZ_DATA_DIR: dataDir3, AUZ_APP_ROOT: path.join(root, 'app/public'), AUZ_CLOUD_URL: cbase, PGHOST: '127.0.0.1', PGPORT: String(pgPort), POSTGRES_APP_PASSWORD: sec.appPassword, POSTGRES_DB: L.DB, JWT_SECRET: sec.jwtSecret, LICENCE_PUBLIC_KEY: k.pub, DISABLE_MAINTENANCE: '1', PG_POOL_MAX: '5', DISABLE_RATE_LIMIT: '1' } });
        try {
          for (let i = 0; i < 80; i++) { try { if ((await fetch(obase2 + '/health')).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 250)); }
          const clashRes = await fetch(obase2 + '/offline/cloud-sync-register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'asha@shop.test', password: 'Secret!pass1' }) });
          const clashBody = await clashRes.json().catch(() => ({}));
          assert(clashRes.status === 400, 'reusing another business\'s login email should be refused: ' + clashRes.status + ' body=' + JSON.stringify(clashBody));
        } finally { offline4.kill(); fs.rmSync(dataDir3, { recursive: true, force: true }); }
      } finally {
        try { offline3 && offline3.kill(); } catch { /* ignore */ }
        cloud3.kill(); fs.rmSync(dataDir2, { recursive: true, force: true });
      }
    }, 'critical');
    await s.check('Cloud Sync Stage 3: a real edit made directly on the cloud tenant pulls down to the PC, but never when the PC itself has a newer, not-yet-pushed edit on that same row ("the PC always wins")', async () => {
      const c = require(require.resolve('pg', { paths: [o.serverDir] }));
      const cl = new c.Client({ host: '127.0.0.1', port: pgPort, user: 'postgres', password: sec.superPassword, database: L.DB }); await cl.connect();
      const cport = await free(), cbase = `http://127.0.0.1:${cport}`;
      const cloud5 = spawn(NODE, [...PRELOAD, 'src/index.js'], { cwd: SERVER_DIR, stdio: 'ignore', env: { ...process.env, PORT: String(cport), PGHOST: '127.0.0.1', PGPORT: String(pgPort), POSTGRES_APP_PASSWORD: sec.appPassword, POSTGRES_DB: L.DB, JWT_SECRET: sec.jwtSecret, LICENCE_PRIVATE_KEY: k.priv, DISABLE_MAINTENANCE: '1', PG_POOL_MAX: '5', DISABLE_RATE_LIMIT: '1' } });
      try {
        for (let i = 0; i < 80; i++) { try { if ((await fetch(cbase + '/health')).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 250)); }
        const syncCode = signLicence({ shop: 'Fourth Shop', end: '2099-12-31', addons: { sync: true } }, k.priv);
        const now = new Date().toISOString();
        const fullRow = (id, tenant, name) => ({ id, tenant_id: tenant, name, category: 'Tees', subcategory: null, brand: null, season: null, gender: null, hsn: null, tax_pct: null, cost: 200, price: 500, mrp: 600, notes: null, photo_url: null, active: true, created_by: null, created_at: now, updated_at: now, photos: [], colour_photos: {}, photo_use: {} });
        // push a THROWAWAY row up, exactly like Stage 1, just to auto-provision a fresh cloud tenant paired to this shop
        const setupId = crypto.randomUUID();
        const push = await (await fetch(cbase + '/cloud/sync', { method: 'POST', headers: { 'content-type': 'application/json', 'x-licence': syncCode }, body: JSON.stringify({ changes: [{ tbl: 'sty_styles', rowId: setupId, op: 'upsert', row: fullRow(setupId, null, 'Setup Row') }] }) })).json();
        assert(push.tenantId && push.applied === 1, 'setup push should apply cleanly: ' + JSON.stringify(push));
        const cloudTenant = push.tenantId;
        // the push must not have logged itself as a "remote" change -- the cloud's own change log must still be empty
        const afterPush = (await cl.query('select count(*) n from sty_change_log where tenant_id = $1', [cloudTenant])).rows[0];
        assert(Number(afterPush.n) === 0, 'a push must not log itself as a fresh remote change: ' + JSON.stringify(afterPush));

        // the row this test is actually about: this test shares one Postgres cluster for convenience (production
        // never does -- the PC and the cloud are entirely separate databases, so the same real row genuinely has
        // the same id in both), so a "remote edit" on it is inserted directly into the cloud's own change log
        // instead of through an actual update on an actual cloud-side row, which would collide on sty_styles'
        // global id primary key with the PC-side row of the same id created below.
        const rowId = crypto.randomUUID();
        const remoteEdit = (name) => cl.query('insert into sty_change_log (tenant_id, tbl, row_id, op, row) values ($1, $2, $3, $4, $5::jsonb)', [cloudTenant, 'sty_styles', rowId, 'upsert', JSON.stringify(fullRow(rowId, cloudTenant, name))]);
        await remoteEdit('Remote Edited Name');
        const pull1 = await (await fetch(cbase + '/cloud/sync?since=0', { headers: { 'x-licence': syncCode } })).json();
        assert(pull1.changes.length === 1 && pull1.changes[0].row.name === 'Remote Edited Name', 'the remote edit should be the only pulled change: ' + JSON.stringify(pull1));

        // set up a stand-in for "the PC's own local database": its own tenant, its own copy of the same real row
        // (same id -- in production this is literally the same row, just a separate physical database), and a
        // cursor saying that copy has already been pushed up (so it is not "pending")
        const pcTenant = (await cl.query("insert into tenants (slug, name, niche, plan, status) values ('fourth-pc', 'Fourth PC', 'retail', 'pro', 'active') returning id")).rows[0].id;
        await cl.query('insert into sty_sync_cursor (tenant_id, last_pushed, last_pulled) values ($1, 0, 0)', [pcTenant]);
        await cl.query('insert into sty_styles select * from jsonb_populate_record(null::sty_styles, $1::jsonb)', [JSON.stringify(fullRow(rowId, pcTenant, 'Local Original'))]);
        const afterLocalInsert = (await cl.query('select max(id) m from sty_change_log where tenant_id = $1 and row_id = $2', [pcTenant, rowId])).rows[0].m;
        await cl.query('update sty_sync_cursor set last_pushed = $1 where tenant_id = $2', [afterLocalInsert, pcTenant]); // "already pushed up"

        // applying the pulled remote edit now: nothing pending locally for this row, so it applies normally
        const apply1 = (await cl.query('select sty_local_apply_pulled_batch($1, $2::jsonb) as r', [pcTenant, JSON.stringify(pull1.changes)])).rows[0].r;
        assert(apply1.applied === 1 && apply1.skipped === 0, 'the remote edit should apply with nothing pending: ' + JSON.stringify(apply1));
        const name1 = (await cl.query('select name from sty_styles where tenant_id = $1 and id = $2', [pcTenant, rowId])).rows[0].name;
        assert(name1 === 'Remote Edited Name', 'local row should now show the remote edit: ' + name1);
        // applying a pulled change must not log itself as a fresh LOCAL change either, or push and pull would bounce the same row forever
        const logCountAfterApply = (await cl.query('select count(*) n from sty_change_log where tenant_id = $1 and row_id = $2', [pcTenant, rowId])).rows[0].n;
        assert(Number(logCountAfterApply) === 1, 'applying a pulled change must not re-log itself: ' + logCountAfterApply);

        // now the PC makes its OWN newer edit to the same row (not pushed up yet), and -- independently -- someone
        // changes the row again directly on the cloud
        await cl.query("update sty_styles set name = 'Local Newer Edit' where tenant_id = $1 and id = $2", [pcTenant, rowId]);
        await remoteEdit('Remote Second Edit');
        const pull2 = await (await fetch(cbase + '/cloud/sync?since=' + pull1.cursor, { headers: { 'x-licence': syncCode } })).json();
        assert(pull2.changes.length === 1 && pull2.changes[0].row.name === 'Remote Second Edit', 'the second remote edit should be the only new pulled change: ' + JSON.stringify(pull2));
        const apply2 = (await cl.query('select sty_local_apply_pulled_batch($1, $2::jsonb) as r', [pcTenant, JSON.stringify(pull2.changes)])).rows[0].r;
        assert(apply2.applied === 0 && apply2.skipped === 1, 'the PC\'s own unpushed newer edit must win, the remote edit must be skipped: ' + JSON.stringify(apply2));
        const name2 = (await cl.query('select name from sty_styles where tenant_id = $1 and id = $2', [pcTenant, rowId])).rows[0].name;
        assert(name2 === 'Local Newer Edit', 'the PC\'s own newer edit must survive untouched: ' + name2);
      } finally { cloud5.kill(); await cl.end(); }
    }, 'critical');
    await s.check('Cloud Sync Stage 5: more than one remote login, and removing every one of them is how "remote access" turns off', async () => {
      const c = require(require.resolve('pg', { paths: [o.serverDir] }));
      const cl = new c.Client({ host: '127.0.0.1', port: pgPort, user: 'postgres', password: sec.superPassword, database: L.DB }); await cl.connect();
      const cport = await free(), cbase = `http://127.0.0.1:${cport}`;
      const cloud6 = spawn(NODE, [...PRELOAD, 'src/index.js'], { cwd: SERVER_DIR, stdio: 'ignore', env: { ...process.env, PORT: String(cport), PGHOST: '127.0.0.1', PGPORT: String(pgPort), POSTGRES_APP_PASSWORD: sec.appPassword, POSTGRES_DB: L.DB, JWT_SECRET: sec.jwtSecret, LICENCE_PRIVATE_KEY: k.priv, DISABLE_MAINTENANCE: '1', PG_POOL_MAX: '5', DISABLE_RATE_LIMIT: '1' } });
      const dataDir4 = fs.mkdtempSync(path.join(os.tmpdir(), 'auzdesk4-'));
      let offline5;
      try {
        for (let i = 0; i < 80; i++) { try { if ((await fetch(cbase + '/health')).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 250)); }
        const syncCode = signLicence({ shop: 'Fifth Shop', end: '2099-12-31', addons: { sync: true } }, k.priv);
        fs.writeFileSync(path.join(dataDir4, 'licence.json'), JSON.stringify({ code: syncCode }));
        const oport = await free(), obase = `http://127.0.0.1:${oport}`;
        offline5 = spawn(NODE, [...PRELOAD, 'src/index.js'], { cwd: SERVER_DIR, stdio: 'ignore', env: { ...process.env, PORT: String(oport), AUZ_OFFLINE: '1', AUZ_DATA_DIR: dataDir4, AUZ_APP_ROOT: path.join(root, 'app/public'), AUZ_CLOUD_URL: cbase, PGHOST: '127.0.0.1', PGPORT: String(pgPort), POSTGRES_APP_PASSWORD: sec.appPassword, POSTGRES_DB: L.DB, JWT_SECRET: sec.jwtSecret, LICENCE_PUBLIC_KEY: k.pub, DISABLE_MAINTENANCE: '1', PG_POOL_MAX: '5', DISABLE_RATE_LIMIT: '1' } });
        for (let i = 0; i < 80; i++) { try { if ((await fetch(obase + '/health')).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 250)); }
        // nothing to list before anyone has registered
        const empty0 = await (await fetch(obase + '/offline/cloud-sync-logins')).json();
        assert(Array.isArray(empty0.logins) && empty0.logins.length === 0, 'no logins yet: ' + JSON.stringify(empty0));
        const reg = await (await fetch(obase + '/offline/cloud-sync-register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'fifth-owner@shop.test', password: 'Secret!pass1', name: 'Owner' }) })).json();
        assert(reg.created, 'owner registration should succeed: ' + JSON.stringify(reg));
        const after1 = await (await fetch(obase + '/offline/cloud-sync-logins')).json();
        assert(after1.logins.length === 1 && after1.logins[0].email === 'fifth-owner@shop.test' && after1.logins[0].role === 'owner', 'owner should be the only login: ' + JSON.stringify(after1));
        // a bad role is refused before it even reaches the cloud
        const badRole = await fetch(obase + '/offline/cloud-sync-logins', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'staff@shop.test', password: 'Secret!pass1', role: 'owner' }) });
        assert(badRole.status === 400, 'owner is not a choosable extra role: ' + badRole.status);
        // add a second, different login
        const add = await (await fetch(obase + '/offline/cloud-sync-logins', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'staff@shop.test', password: 'Secret!pass1', role: 'manager', name: 'Staff' }) })).json();
        assert(add.created, 'adding a manager login should succeed: ' + JSON.stringify(add));
        const after2 = await (await fetch(obase + '/offline/cloud-sync-logins')).json();
        assert(after2.logins.length === 2 && after2.logins.some((l) => l.email === 'staff@shop.test' && l.role === 'manager'), 'both logins should be listed: ' + JSON.stringify(after2));
        // remove the staff login: it loses access, but its real AUZslab login (auth_users) is untouched, not deleted
        const rm = await (await fetch(obase + '/offline/cloud-sync-logins?email=staff@shop.test', { method: 'DELETE' })).json();
        assert(rm.removed && rm.role === 'manager', 'removing the staff login should succeed: ' + JSON.stringify(rm));
        const stillAuthUser = (await cl.query("select 1 from auth_users where email = 'staff@shop.test'")).rows[0];
        assert(stillAuthUser, 'removing a login must not delete the underlying auth_users row');
        const after3 = await (await fetch(obase + '/offline/cloud-sync-logins')).json();
        assert(after3.logins.length === 1 && after3.logins[0].email === 'fifth-owner@shop.test', 'only the owner should remain: ' + JSON.stringify(after3));
        // removing the LAST login (the owner too) is how remote access turns off altogether
        const rmOwner = await (await fetch(obase + '/offline/cloud-sync-logins?email=fifth-owner@shop.test', { method: 'DELETE' })).json();
        assert(rmOwner.removed, 'removing the owner login should succeed: ' + JSON.stringify(rmOwner));
        const after4 = await (await fetch(obase + '/offline/cloud-sync-logins')).json();
        assert(after4.logins.length === 0, 'remote access should now be off (no logins left): ' + JSON.stringify(after4));
        // removing something already gone is reported plainly, not an error
        const rmAgain = await (await fetch(obase + '/offline/cloud-sync-logins?email=fifth-owner@shop.test', { method: 'DELETE' })).json();
        assert(rmAgain.removed === false, 'removing an already-gone login should just say so: ' + JSON.stringify(rmAgain));
      } finally {
        try { offline5 && offline5.kill(); } catch { /* ignore */ }
        cloud6.kill(); await cl.end(); fs.rmSync(dataDir4, { recursive: true, force: true });
      }
    }, 'critical');
    await s.check('Cloud Sync Stage 6: a style\'s photo is uploaded to the cloud too, not just the row that names it, and the same picture is never uploaded twice', async () => {
      const c = require(require.resolve('pg', { paths: [o.serverDir] }));
      const cl = new c.Client({ host: '127.0.0.1', port: pgPort, user: 'postgres', password: sec.superPassword, database: L.DB }); await cl.connect();
      const cloudUploads = fs.mkdtempSync(path.join(os.tmpdir(), 'auzcloudup-'));
      const localUploads = fs.mkdtempSync(path.join(os.tmpdir(), 'auzlocalup-'));
      const dataDir6 = fs.mkdtempSync(path.join(os.tmpdir(), 'auzdesk6-'));
      const cport = await free(), cbase = `http://127.0.0.1:${cport}`;
      const cloud7 = spawn(NODE, [...PRELOAD, 'src/index.js'], { cwd: SERVER_DIR, stdio: 'ignore', env: { ...process.env, PORT: String(cport), PGHOST: '127.0.0.1', PGPORT: String(pgPort), POSTGRES_APP_PASSWORD: sec.appPassword, POSTGRES_DB: L.DB, JWT_SECRET: sec.jwtSecret, LICENCE_PRIVATE_KEY: k.priv, UPLOAD_ROOT: cloudUploads, DISABLE_MAINTENANCE: '1', PG_POOL_MAX: '5', DISABLE_RATE_LIMIT: '1' } });
      let offline6;
      try {
        for (let i = 0; i < 80; i++) { try { if ((await fetch(cbase + '/health')).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 250)); }
        // the offline PC's own (only) tenant, made directly by SQL -- a full first-run setup is not needed, the
        // sync worker only ever looks for "whichever tenant this computer has"
        // this test shares one Postgres database with the cloud tenant that gets auto-provisioned mid-push (production
        // never does -- the PC and the cloud are always separate databases, so offline_my_tenant_id()'s "newest
        // tenant wins" is never ambiguous there); created_at is pinned into the future so it stays unambiguous here too
        const localTid = (await cl.query("insert into tenants (slug, name, niche, plan, status, created_at) values ('sixth-pc', 'Sixth PC', 'retail', 'pro', 'active', now() + interval '1 day') returning id")).rows[0].id;
        const photoDir = path.join(localUploads, 'site', 'sixth-pc', 'style'); fs.mkdirSync(photoDir, { recursive: true });
        const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('a real-enough JPEG for looksLikeImage')]);
        fs.writeFileSync(path.join(photoDir, 'shirt.jpg'), jpeg);
        const localUrl = 'http://192.168.1.50:51234/uploads/site/sixth-pc/style/shirt.jpg';
        const styleId = crypto.randomUUID();
        await cl.query(
          `insert into sty_styles (id, tenant_id, name, category, price, mrp, cost, photo_url, photos, colour_photos)
           values ($1, $2, 'Photo Tee', 'Tees', 500, 600, 200, $3, $4::jsonb, $5::jsonb)`,
          [styleId, localTid, localUrl, JSON.stringify([localUrl]), JSON.stringify({ Red: [localUrl] })],
        );

        const syncCode = signLicence({ shop: 'Sixth Shop', end: '2099-12-31', addons: { sync: true } }, k.priv);
        fs.writeFileSync(path.join(dataDir6, 'licence.json'), JSON.stringify({ code: syncCode }));
        const oport = await free(), obase = `http://127.0.0.1:${oport}`;
        offline6 = spawn(NODE, [...PRELOAD, 'src/index.js'], { cwd: SERVER_DIR, stdio: 'ignore', env: { ...process.env, PORT: String(oport), AUZ_OFFLINE: '1', AUZ_DATA_DIR: dataDir6, AUZ_APP_ROOT: path.join(root, 'app/public'), AUZ_CLOUD_URL: cbase, UPLOAD_ROOT: localUploads, PGHOST: '127.0.0.1', PGPORT: String(pgPort), POSTGRES_APP_PASSWORD: sec.appPassword, POSTGRES_DB: L.DB, JWT_SECRET: sec.jwtSecret, LICENCE_PUBLIC_KEY: k.pub, DISABLE_MAINTENANCE: '1', PG_POOL_MAX: '5', DISABLE_RATE_LIMIT: '1' } });
        for (let i = 0; i < 80; i++) { try { if ((await fetch(obase + '/health')).ok) break; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 250)); }

        const sync1 = await (await fetch(obase + '/offline/sync-now', { method: 'POST' })).json();
        assert(sync1.pushed >= 1, '"Sync now" should have pushed the new style: ' + JSON.stringify(sync1));

        const cloudTid = (await cl.query('select tenant_id from sty_sync_tenants order by created_at desc limit 1')).rows[0].tenant_id;
        const cloudStyle = (await cl.query('select photo_url, photos, colour_photos from sty_styles where id = $1 and tenant_id = $2', [styleId, cloudTid])).rows[0];
        assert(cloudStyle, 'the style should have reached the cloud tenant');
        assert(/^https:\/\/([a-z0-9-]+)\.auzslab\.in\/uploads\/cloud-sync\/\1\/[0-9a-f]{64}\.jpg$/.test(cloudStyle.photo_url), 'photo_url should now be a real cloud url: ' + cloudStyle.photo_url);
        assert(cloudStyle.photos[0] === cloudStyle.photo_url && cloudStyle.colour_photos.Red[0] === cloudStyle.photo_url, 'photos[] and colour_photos should get the same cloud url: ' + JSON.stringify(cloudStyle));
        const savedPath = path.join(cloudUploads, new URL(cloudStyle.photo_url).pathname.replace(/^\/uploads\//, ''));
        assert(Buffer.compare(fs.readFileSync(savedPath), jpeg) === 0, 'the uploaded file should be byte-identical to the original');
        const mapRow = (await cl.query('select cloud_url from sty_sync_photo_map where tenant_id = $1 and local_url = $2', [localTid, localUrl])).rows[0];
        assert(mapRow && mapRow.cloud_url === cloudStyle.photo_url, 'the mapping should be cached on the PC side: ' + JSON.stringify(mapRow));

        // A second style re-using the SAME photo (the local file now gone) -- real life would be a different
        // style, not an edit of the first: once pushed to the cloud, the first style's id itself now belongs to
        // the cloud tenant (on conflict(id) do update reassigned its tenant_id), the exact same shared-one-
        // database-for-convenience pitfall Stage 1's own test already works around with a fresh id.
        fs.rmSync(localUploads, { recursive: true, force: true });
        const styleId2 = crypto.randomUUID();
        await cl.query(
          `insert into sty_styles (id, tenant_id, name, category, price, mrp, cost, photo_url, photos, colour_photos)
           values ($1, $2, 'Photo Tee 2', 'Tees', 450, 500, 180, $3, $4::jsonb, $5::jsonb)`,
          [styleId2, localTid, localUrl, JSON.stringify([localUrl]), JSON.stringify({})],
        );
        const sync2 = await (await fetch(obase + '/offline/sync-now', { method: 'POST' })).json();
        assert(sync2.pushed >= 1, 'the second style should still push even with the local photo file gone: ' + JSON.stringify(sync2));
        const cloudStyle2 = (await cl.query('select price, photo_url from sty_styles where id = $1 and tenant_id = $2', [styleId2, cloudTid])).rows[0];
        assert(cloudStyle2, 'the second style should have reached the cloud tenant');
        assert(Number(cloudStyle2.price) === 450 && cloudStyle2.photo_url === cloudStyle.photo_url, 'the second style should reuse the SAME cached cloud photo url, not fail or re-upload: ' + JSON.stringify(cloudStyle2));
      } finally {
        try { offline6 && offline6.kill(); } catch { /* ignore */ }
        cloud7.kill(); await cl.end();
        fs.rmSync(cloudUploads, { recursive: true, force: true }); fs.rmSync(localUploads, { recursive: true, force: true }); fs.rmSync(dataDir6, { recursive: true, force: true });
      }
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
