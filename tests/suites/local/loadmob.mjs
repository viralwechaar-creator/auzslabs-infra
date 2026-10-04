// Launch-month load test for AUZsMob: 60 shops (1 owner + 4 staff each) working at the same time against the
// real API and a real database, then one shop with a full year of busy history. Run on its own:
//   node tests/run-local.mjs loadmob
// Numbers are for THIS machine (4 cores, database and API on the same box), the same shape as the VPS.
import { suite, assert } from '../../lib/harness.mjs';
import { rpc } from '../../lib/api.mjs';
import { q, seedShops, PASSWORD } from '../../lib/db.mjs';

const SHOPS = Number(process.env.LOAD_SHOPS || 60), STAFF = 4, OPS_PER_STAFF = Number(process.env.LOAD_OPS || 40);
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : 0; };
const uid = () => crypto.randomUUID();

// run `jobs` (async fns) with at most `conc` in flight
async function pool(jobs, conc) { let i = 0; await Promise.all(Array.from({ length: conc }, async () => { while (i < jobs.length) await jobs[i++](); })); }

export default async function run({ stack }) {
  const s = suite(`AUZsMob launch load: ${SHOPS} shops working at once`, 'A whole launch month on the test copy: many shops, each with an owner and staff, selling, buying, opening repairs and syncing together; then one shop with a year of busy history. Shows the real limit of one server.');
  const stat = {}; // op -> latencies
  const fails = {};
  const timed = async (op, fn, tok, args) => {
    const a = Date.now(); const r = await rpc(stack, fn, args, tok); (stat[op] ||= []).push(Date.now() - a);
    if (r.status !== 200) (fails[op] ||= []).push(r.status + ' ' + JSON.stringify(r.data).slice(0, 120));
    return r;
  };
  const failCount = () => Object.values(fails).reduce((n, a) => n + a.length, 0);

  // ---------- seed + login ----------
  const t0 = Date.now();
  const shops = await seedShops(SHOPS, STAFF);
  s.note(`Created ${SHOPS} shops with ${SHOPS * (STAFF + 1)} logins in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  const login = async (email) => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json()).access_token;
  const tl = Date.now();
  await pool(shops.map((sh) => async () => { sh.ownerTok = await login(sh.owner); sh.staffTok = []; for (const e of sh.staff) sh.staffTok.push(await login(e)); }), 20);
  s.note(`${SHOPS * (STAFF + 1)} logins in ${((Date.now() - tl) / 1000).toFixed(1)} s`);
  await s.check('Every login worked', async () => assert(shops.every((sh) => sh.ownerTok && sh.staffTok.every(Boolean))), 'critical');

  // ---------- stock the shelves: 8 phone models (6 units each), 8 accessories (200 each) ----------
  const ts = Date.now();
  await pool(shops.map((sh) => async () => {
    sh.phones = []; sh.acc = []; sh.units = [];
    for (let k = 0; k < 8; k++) {
      const pid = uid(); sh.phones.push(pid);
      await timed('setup: save item', 'mob_save_item', sh.ownerTok, { p_id: pid, p: { name: 'Phone ' + k, category: 'phone_new', serialized: true, sellingPrice: 12000 + k * 500, costPrice: 10000 + k * 400, lowStockAt: 0 } });
      for (let u = 0; u < 6; u++) { const unitId = uid(); const imei = String(100000000000000 + Number(sh.slug.slice(2)) * 1000 + k * 10 + u);
        const r = await timed('setup: buy phone', 'mob_push_purchase', sh.ownerTok, { p_id: uid(), p: { itemId: pid, qty: 1, rate: 10000 + k * 400, imei, sellingPrice: 12000 + k * 500, unitId } });
        if (r.status === 200) sh.units.push({ unitId, itemId: pid, price: 12000 + k * 500 }); }
      const aid = uid(); sh.acc.push(aid);
      await timed('setup: save item', 'mob_save_item', sh.ownerTok, { p_id: aid, p: { name: 'Accessory ' + k, category: 'accessory', serialized: false, sellingPrice: 199 + k * 20, costPrice: 90, lowStockAt: 5 } });
      await timed('setup: buy accessory', 'mob_push_purchase', sh.ownerTok, { p_id: uid(), p: { itemId: aid, qty: 200, rate: 90 } });
    }
  }), 20);
  s.note(`Stocked ${SHOPS} shops (${SHOPS * 8} phone models, ${SHOPS * 48} phones, ${SHOPS * 8} accessories) in ${((Date.now() - ts) / 1000).toFixed(1)} s`);
  await s.check('Stocking every shop worked with no errors', async () => assert(failCount() === 0, JSON.stringify(fails).slice(0, 400)), 'critical');

  // ---------- the busy day: every staffer works flat out, all shops at once ----------
  const jobs = [];
  for (const sh of shops) for (let si = 0; si < STAFF; si++) jobs.push(async () => {
    const tok = sh.staffTok[si]; let cursor = null;
    for (let n = 0; n < OPS_PER_STAFF; n++) {
      const roll = Math.random();
      if (roll < 0.5) { // accessory sale, 1-3 lines
        const lines = 1 + Math.floor(Math.random() * 3);
        const items = Array.from({ length: lines }, () => { const a = sh.acc[Math.floor(Math.random() * 8)]; return { itemId: a, name: 'Accessory', qty: 1 + Math.floor(Math.random() * 2), price: 249 }; });
        await timed('sell accessories', 'mob_push_sale', tok, { p_id: uid(), p: { items, customerName: 'Walk-in', paid: 400, paymentMode: 'cash' } });
      } else if (roll < 0.65 && sh.units.length) { // phone sale (take a unit off the shared list so two staff never grab the same one)
        const u = sh.units.pop();
        await timed('sell a phone', 'mob_push_sale', tok, { p_id: uid(), p: { items: [{ unitId: u.unitId, itemId: u.itemId, name: 'Phone', qty: 1, price: u.price }], customerName: 'Customer', customerPhone: '9876500000', paid: u.price - 1000, paymentMode: 'credit' } });
      } else if (roll < 0.8) { // stock-in
        await timed('buy accessories', 'mob_push_purchase', tok, { p_id: uid(), p: { itemId: sh.acc[Math.floor(Math.random() * 8)], qty: 10, rate: 90 } });
      } else if (roll < 0.9) { // repair job + a status event
        const rid = uid();
        await timed('open a repair', 'mob_create_repair', tok, { p_id: rid, p: { customerName: 'Repair Cust', customerPhone: '9000000000', deviceModel: 'Redmi', problem: 'Screen', advance: 200, estimate: 1500 } });
        await timed('repair event', 'mob_push_repair_event', tok, { p_id: uid(), p_repair_id: rid, p: { type: 'status', status: 'in_repair' } });
      } else { // phone catches up
        const r = await timed('sync pull (incremental)', 'mob_sync_pull', tok, { p_since: cursor });
        cursor = r.data && r.data.data && r.data.data.server_time || cursor;
      }
    }
  });
  const tb = Date.now();
  await pool(jobs, 60);
  const secs = (Date.now() - tb) / 1000;
  const ops = Object.entries(stat).filter(([k]) => !k.startsWith('setup')).reduce((n, [, a]) => n + a.length, 0);
  s.note(`Busy day: ${SHOPS * STAFF} staff, ${ops} requests in ${secs.toFixed(1)} s = ${(ops / secs).toFixed(0)} requests/sec flat out (a real launch month is under 5 per second)`);
  for (const [op, a] of Object.entries(stat)) if (!op.startsWith('setup')) s.note(`  ${op}: ${a.length} calls, median ${pct(a, 0.5)} ms, slowest 5% ${pct(a, 0.95)} ms, worst ${pct(a, 1)} ms`);
  await s.check('Busy day: no request failed', async () => assert(failCount() === 0, Object.entries(fails).map(([k, v]) => k + ': ' + v.length + ' e.g. ' + v[0]).join(' | ').slice(0, 600)), 'critical');
  await s.check('Busy day: 95% of saves finish under 500 ms even with every shop flat out', async () => {
    const w = Object.entries(stat).filter(([k]) => /^(sell|buy|open|repair)/.test(k)).map(([k, a]) => [k, pct(a, 0.95)]).filter(([, v]) => v > 500);
    assert(!w.length, w.map(([k, v]) => k + ' ' + v + ' ms').join(', '));
  }, 'major');

  // ---------- owners check their reports, all at the same time ----------
  const rs = {}; const rj = [];
  for (const sh of shops) { rj.push(async () => { await timed('owner: dashboard', 'mob_report_dashboard', sh.ownerTok, {}); }); rj.push(async () => { await timed('owner: staff ledger', 'mob_report_ledger', sh.ownerTok, {}); }); rj.push(async () => { await timed('owner: full catch-up pull', 'mob_sync_pull', sh.ownerTok, { p_since: null }); }); }
  const tr = Date.now(); await pool(rj, 30);
  s.note(`Owner reports: ${rj.length} calls in ${((Date.now() - tr) / 1000).toFixed(1)} s`);
  for (const op of ['owner: dashboard', 'owner: staff ledger', 'owner: full catch-up pull']) s.note(`  ${op}: median ${pct(stat[op], 0.5)} ms, slowest 5% ${pct(stat[op], 0.95)} ms`);
  await s.check('Owner reports: none failed', async () => assert(failCount() === 0, JSON.stringify(Object.fromEntries(Object.entries(fails).map(([k, v]) => [k, v.length]))).slice(0, 400)), 'critical');

  // ---------- does the stock still add up everywhere? ----------
  await s.check('Every shop passes its own data health check after the busy day', async () => {
    const bad = [];
    await pool(shops.map((sh) => async () => { const r = await rpc(stack, 'mob_integrity_check', {}, sh.ownerTok); if (!(r.data && r.data.data && r.data.data.ok)) bad.push(sh.slug); }), 20);
    assert(!bad.length, 'out of line: ' + bad.join(', '));
  }, 'critical');
  await s.check('No sale was lost or double-counted (bill numbers unique per shop)', async () => {
    const r = await q('select count(*)::int n from (select tenant_id, bill_no from mob_sales where tenant_id = any($1) group by 1,2 having count(*) > 1) d', [shops.map((x) => x.tid)]);
    assert(r[0].n === 0, r[0].n + ' duplicate bill numbers');
  }, 'critical');

  // ---------- one shop, a full year of busy history ----------
  const big = shops[0]; const DAYS = 365, PER_DAY = 300;
  const th = Date.now();
  await q(`
    with s as (select $1::uuid tid, (select staff_id from mob_sales where tenant_id=$1 limit 1) st),
    gen as (select gen_random_uuid() id, d, i, now() - (d || ' days')::interval - (i * 2 || ' minutes')::interval ts from generate_series(1,${DAYS}) d, generate_series(1,${PER_DAY}) i),
    ins as (
      insert into mob_sales (id, tenant_id, bill_no, customer_name, items, subtotal, discount, total, paid, balance, payment_mode, staff_id, created_at)
      select g.id, s.tid, 'H-' || g.d || '-' || g.i, 'Hist', jsonb_build_array(jsonb_build_object('itemId', $2::text, 'name', 'Accessory', 'qty', 1, 'price', 249, 'costPrice', 90)), 249, 0, 249, 249, 0, 'cash', s.st, g.ts
      from gen g, s returning id, created_at, staff_id)
    insert into mob_stock_movements (id, tenant_id, item_id, qty, type, ref_id, staff_id, created_at)
    select gen_random_uuid(), $1, ($2::text)::uuid, -1, 'sale', id, staff_id, created_at from ins`, [big.tid, big.acc[0]]);
  const counts = (await q('select (select count(*) from mob_sales where tenant_id=$1)::int sales, (select count(*) from mob_stock_movements where tenant_id=$1)::int mv', [big.tid]))[0];
  s.note(`Added a year of history to one shop (${counts.sales} sales, ${counts.mv} stock movements) in ${((Date.now() - th) / 1000).toFixed(1)} s`);
  await q('analyze');
  const hist = {};
  for (const [name, tok, fn, args] of [
    ['owner opens app on a NEW phone (full pull)', big.ownerTok, 'mob_sync_pull', { p_since: null }],
    ['owner catch-up after one hour away', big.ownerTok, 'mob_sync_pull', { p_since: new Date(Date.now() - 3600e3).toISOString() }],
    ['staff opens app on a NEW phone (full pull)', big.staffTok[0], 'mob_sync_pull', { p_since: null }],
    ['owner dashboard (today)', big.ownerTok, 'mob_report_dashboard', {}],
    ['owner staff ledger (today)', big.ownerTok, 'mob_report_ledger', {}],
    ['owner staff ledger (whole year)', big.ownerTok, 'mob_report_ledger', { p_from: new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10), p_to: new Date().toISOString().slice(0, 10) }],
    ['owner books check (integrity)', big.ownerTok, 'mob_integrity_check', {}]]) {
    const a = Date.now(); const r = await rpc(stack, fn, args, tok); const ms = Date.now() - a;
    const bytes = JSON.stringify(r.data || '').length; hist[name] = { ms, bytes, status: r.status };
    s.note(`  ${name}: ${ms} ms, ${(bytes / 1048576).toFixed(1)} MB, status ${r.status}`);
  }
  await s.check('A year-old shop: a full catch-up on a new phone finishes under 5 seconds', async () => assert(hist['owner opens app on a NEW phone (full pull)'].ms < 5000, hist['owner opens app on a NEW phone (full pull)'].ms + ' ms'), 'major');
  await s.check('A year-old shop: the everyday catch-up (after one hour away) is under 300 ms', async () => assert(hist['owner catch-up after one hour away'].ms < 300, hist['owner catch-up after one hour away'].ms + ' ms'), 'major');
  await s.check('A year-old shop: today\'s dashboard and ledger stay under 500 ms', async () => assert(hist['owner dashboard (today)'].ms < 500 && hist['owner staff ledger (today)'].ms < 500, JSON.stringify([hist['owner dashboard (today)'].ms, hist['owner staff ledger (today)'].ms])), 'major');

  // the windowed first sync must still leave stock adding up exactly, and must keep everything still open
  await s.check('A new phone\'s windowed first sync still adds up: stock per item matches the server, open dues are included', async () => {
    const r = await rpc(stack, 'mob_sync_pull', { p_since: null }, big.ownerTok); const d = r.data.data;
    assert(d.full === true, 'first sync not flagged as a window');
    const mine = {}; for (const m of d.stock_movements) mine[m.item_id] = (mine[m.item_id] || 0) + Number(m.qty);
    const real = await q('select item_id, sum(qty)::float8 s from mob_stock_movements where tenant_id=$1 group by 1', [big.tid]);
    for (const row of real) assert(Math.abs((mine[row.item_id] || 0) - row.s) < 0.001, 'item ' + row.item_id + ': phone would show ' + (mine[row.item_id] || 0) + ', server has ' + row.s);
    const owing = (await q('select count(*)::int n from mob_sales where tenant_id=$1 and balance>0 and not voided', [big.tid]))[0].n;
    assert(d.sales.filter((x) => Number(x.balance) > 0 && !x.voided).length === owing, 'a sale still owing money is missing from the first sync');
    assert(d.sales.length < counts.sales / 2, 'first sync still carries the whole history: ' + d.sales.length + ' sales');
    const again = await rpc(stack, 'mob_sync_pull', { p_since: d.server_time }, big.ownerTok); assert(again.data.data.full === false && again.data.data.stock_movements.length === 0, 'an immediate catch-up should be empty');
  }, 'critical');

  // ---------- size ----------
  const size = await q(`select pg_size_pretty(pg_database_size(current_database())) total, (select pg_size_pretty(sum(pg_total_relation_size(c.oid))) from pg_class c where relname like 'mob\\_%' and relkind='r') mob`);
  s.note(`Database size now: ${size[0].total} in total, AUZsMob tables ${size[0].mob}`);
  s.done();
}
