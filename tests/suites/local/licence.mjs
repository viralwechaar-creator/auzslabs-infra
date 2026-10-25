// Offline licence: codes are signed and checked with no internet, an installed copy locks without a valid code, expiry has a short
// grace, setting the clock back does not extend a plan, and the cloud server never locks anything.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { suite, assert } from '../../lib/harness.mjs';
import { makeKeypair, signLicence, verifyLicence } from '../../../server/src/licence.js';

const free = () => new Promise((r) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => r(p)); }); });
async function start(env) {
  const port = await free();
  const p = spawn('node', ['src/index.js'], { cwd: path.resolve('server'), env: { ...process.env, PORT: String(port), DISABLE_RATE_LIMIT: '1', JWT_SECRET: 'x'.repeat(40), PGHOST: '127.0.0.1', PGPORT: '1', POSTGRES_APP_PASSWORD: 'x', DISABLE_MAINTENANCE: '1', ...env }, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${port}/licence/status`); return { p, base: `http://127.0.0.1:${port}` }; } catch { await new Promise((r) => setTimeout(r, 250)); } }
  p.kill(); throw new Error('server did not start');
}
const J = async (u, o) => { const r = await fetch(u, o); return { s: r.status, j: await r.json().catch(() => ({})) }; };

export default async function run() {
  const s = suite('Offline licence', 'Signed licence codes for the installed AUZsStyle: activation, lock, expiry, grace, clock set back.');
  const k = makeKeypair(); const other = makeKeypair();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auzlic-'));
  const code = signLicence({ shop: 'GenX Clothes', end: '2099-12-31', addons: { cloud: true, store: true } }, k.priv);
  await s.check('A code checks with the public key only, shows shop, end date and extras; a wrong or changed code is refused', async () => {
    const v = verifyLicence(code, k.pub); assert(v.ok && v.shop === 'GenX Clothes' && v.end === '2099-12-31' && v.addons.cloud && v.addons.store && !v.addons.whatsapp, JSON.stringify(v));
    assert(!verifyLicence(code, other.pub).ok, 'another key must not accept it');
    assert(!verifyLicence(code.slice(0, -3) + 'AAA', k.pub).ok && !verifyLicence('AUZ-AAAAA', k.pub).ok, 'tampered/short accepted');
    assert(verifyLicence(code.toLowerCase().replace(/-/g, ' '), k.pub).ok, 'typing lower case with spaces should work');
  }, 'critical');
  const { p, base } = await start({ AUZ_OFFLINE: '1', AUZ_DATA_DIR: dir, LICENCE_PUBLIC_KEY: k.pub });
  try {
    await s.check('The installed copy answers nothing but the licence screen until a code is entered', async () => {
      assert((await J(base + '/licence/status')).j.state === 'none', 'status');
      const r = await J(base + '/rpc/sty_context', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      assert(r.s === 402 && /licence/i.test(r.j.error), JSON.stringify(r));
    }, 'critical');
    await s.check('A bad code is refused; the right one activates and opens the app', async () => {
      assert((await J(base + '/licence/activate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: signLicence({ shop: 'X', end: '2099-01-01' }, other.priv) }) })).s === 400, 'foreign code');
      const a = await J(base + '/licence/activate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code }) });
      assert(a.s === 200 && a.j.state === 'active' && a.j.shop === 'GenX Clothes' && a.j.addons.store, JSON.stringify(a));
      const r = await J(base + '/rpc/sty_context', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      assert(r.s !== 402, 'still locked: ' + r.s);
    }, 'critical');
    await s.check('An older code cannot replace a longer plan', async () => {
      const old = signLicence({ shop: 'GenX Clothes', end: '2090-01-01' }, k.priv);
      assert((await J(base + '/licence/activate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: old }) })).s === 400, 'accepted older');
    });
  } finally { p.kill(); }
  await s.check('An ended plan locks after 3 days of grace; a clock set back does not unlock it', async () => {
    const d2 = fs.mkdtempSync(path.join(os.tmpdir(), 'auzlic-'));
    const { licenceStore } = await import('../../../server/src/licence.js');
    const st = licenceStore(d2, k.pub); const c2 = signLicence({ shop: 'S', end: '2030-06-30' }, k.priv);
    assert(st.activate(c2, Date.parse('2030-06-01')).ok, 'activate');
    const at = (d) => st.status(Date.parse(d)).state;
    assert(at('2030-06-30') === 'active' && at('2030-07-02') === 'grace' && at('2030-07-04') === 'expired', 'timeline');
    assert(at('2030-06-01') === 'expired', 'clock set back should not unlock');
  }, 'critical');
  const cloud = await start({});
  try {
    await s.check('The cloud server never locks anything', async () => {
      const st = await J(cloud.base + '/licence/status'); assert(st.j.offline === false && st.j.state === 'active', JSON.stringify(st));
      const r = await J(cloud.base + '/rpc/sty_context', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); assert(r.s !== 402, 'cloud answered 402');
    }, 'critical');
  } finally { cloud.p.kill(); }
  s.done();
}
