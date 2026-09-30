// Light load: a burst of simultaneous visitors on the public endpoints.
import { suite, assert } from '../../lib/harness.mjs';

async function burst(n, conc, fn) {
  const lat = []; let i = 0, fail = 0; const t0 = Date.now();
  await Promise.all(Array.from({ length: conc }, async () => { while (i < n) { i++; const a = Date.now(); try { const r = await fn(); if (!r.ok) fail++; await r.arrayBuffer(); } catch { fail++; } lat.push(Date.now() - a); } }));
  lat.sort((a, b) => a - b); return { rps: Math.round(n / ((Date.now() - t0) / 1000)), p95: lat[Math.floor(lat.length * 0.95)], fail };
}
export default async function run({ stack }) {
  const s = suite('Light load (the test copy on this machine)', 'Many simultaneous visitors on the public endpoints. Shows the server does not fall over under a busy launch day.');
  const get = (p, h = {}) => () => fetch(stack.apiBase + p, { headers: h });
  const post = (p, b, h = {}) => () => fetch(stack.apiBase + p, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(b) });
  const cases = [['Salon site data (100 visitors at once)', get('/salon-api/site', { 'x-tenant-slug': 'testsalon' }), 1500, 100, 400],
    ['Salon booking slots', get('/salon-api/slots?date=2031-05-05', { 'x-tenant-slug': 'testsalon' }), 1500, 100, 400],
    ['Café QR menu (public_menu RPC)', post('/rpc/public_menu', { tenant_slug: 'testcafe' }), 1000, 60, 600]];
  for (const [name, fn, n, conc, p95max] of cases) {
    const r = await burst(n, conc, fn); s.note(`${name}: ${r.rps} requests/sec, slowest 5% took ${r.p95} ms, ${r.fail} failed`);
    await s.check(`${name}: no failures`, async () => assert(r.fail === 0, r.fail + ' of ' + n + ' failed'), 'critical');
    await s.check(`${name}: 95% of requests under ${p95max} ms`, async () => assert(r.p95 <= p95max, 'p95 ' + r.p95 + ' ms'), 'major');
  }
  await s.check('Server is still healthy after the burst', async () => { const r = await fetch(stack.apiBase + '/salon-api/site', { headers: { 'x-tenant-slug': 'testsalon' } }); assert(r.ok); }, 'critical');
  s.done();
}
