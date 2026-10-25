// Phase 1A of the modular platform: the module catalogue in the database, the builder that reads it, and the server-side
// dependency checks in start_self_trial. Runs against the real API and database; the builder is driven in a real browser.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx, ROOT } from '../../lib/common.mjs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { PG } from '../../lib/db.mjs';
import { q } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('Module catalogue: central list, dependency-safe builder, unchanged 3-day trial', 'The builder reads the module list from the database; the server adds what a module needs and refuses invalid choices; the 3-day trial, lock and data retention behave as before.');
  const post = async (path, body, tok) => { const r = await fetch(stack.apiBase + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(body || {}) }); let d = null; try { d = await r.json(); } catch {} return { status: r.status, data: d && d.data !== undefined ? d.data : d, raw: d }; };
  const call = (fn, args, tok) => post('/rpc/' + fn, args, tok);
  const newUser = async (tag) => { const r = await post('/auth/signup', { email: `cat-${tag}-${Date.now()}@cat.test`, password: 'Sup3rSecret!' }); const d = r.raw.data || r.raw; assert(d.access_token, 'signup failed: ' + JSON.stringify(r.raw)); return d.access_token; };
  const trial = (blocks, tok) => call('start_self_trial', { p: { business_name: 'Cat Test ' + Math.random().toString(36).slice(2, 7), contact_name: 'Tester', phone: '9876543210', blocks } }, tok);
  const tenantCount = async () => (await q('select count(*)::int n from tenants'))[0].n;
  await q(`update platform_flags set value = 'on' where key = 'password_signup'`);

  await s.check('The catalogue is public, holds every product family (including Mobile and Salon) and shows no prices', async () => {
    const r = await call('public_module_catalogue', {}); assert(r.status === 200 && Array.isArray(r.data), JSON.stringify(r.raw).slice(0, 200));
    const keys = r.data.map((m) => m.key);
    for (const k of ['pos', 'kitchen', 'self_order', 'scan', 'accounting', 'payroll', 'mobile', 'style', 'finance', 'website_builder', 'salon', 'hub']) assert(keys.includes(k), 'missing module ' + k);
    assert(r.data.find((m) => m.key === 'salon').status === 'arrangement', 'salon should be set up by our team');
    assert(r.data.find((m) => m.key === 'hub').status === 'included', 'hub should be included');
    assert(!/"(price|rate|amount)[a-z_]*"|₹/i.test(JSON.stringify(r.data)), 'a price field is in the public catalogue');
    assert(r.data.every((m) => m.description && m.family), 'a module has no description');
  }, 'critical');

  await s.check('Each self-serve module switches on exactly the feature keys the trial blocks already used', async () => {
    const rows = await q(`select c.key, c.features cf, b.features bf from module_catalogue c join trial_blocks b on b.key = c.key where c.status = 'available'`);
    assert(rows.length >= 8, 'few modules: ' + rows.length);
    for (const r of rows) assert(JSON.stringify([...r.cf].sort()) === JSON.stringify([...r.bf].sort()), r.key + ' differs: ' + r.cf + ' vs ' + r.bf);
    const missing = await q(`select key from trial_blocks b where active and not exists (select 1 from module_catalogue c where c.key = b.key)`);
    assert(!missing.length, 'trial block without a catalogue entry: ' + missing.map((x) => x.key));
  }, 'critical');

  await s.check('A module that needs another includes it, and the preview says why', async () => {
    const r = await call('public_module_resolve', { p: { blocks: ['self_order'] } });
    assert(r.status === 200 && r.data.keys.includes('pos') && r.data.keys.includes('self_order'), JSON.stringify(r.raw));
    assert(r.data.added.some((a) => a.key === 'pos' && a.because === 'self_order'), 'no reason given: ' + JSON.stringify(r.data.added));
    const solo = await call('public_module_resolve', { p: { blocks: ['payroll'] } });
    assert(JSON.stringify(solo.data.keys) === '["payroll"]' && solo.data.added.length === 0, 'payroll should need nothing');
  }, 'critical');

  let tokA, tidA;
  await s.check('Direct backend call: starting a trial with only QR ordering still switches on AUZsPOS (no bypass), for 3 days', async () => {
    tokA = await newUser('a'); const r = await trial(['self_order'], tokA);
    assert(r.status === 200, JSON.stringify(r.raw)); tidA = r.data.tenant_id;
    assert(r.data.added.some((a) => a.key === 'pos'), 'server did not report the added dependency');
    const row = (await q(`select ts.features, ts.trial, extract(epoch from ((ts.trial->>'ends')::timestamptz - (ts.trial->>'started')::timestamptz)) secs from tenant_settings ts where tenant_id = $1`, [tidA]))[0];
    assert(row.features.pos === true && row.features.self_order === true, 'features: ' + JSON.stringify(row.features));
    assert(Math.abs(row.secs - 259200) < 5, 'trial length ' + row.secs);
    const blocks = row.trial.blocks; assert(blocks.some((b) => b.key === 'pos' && b.added_for === 'self_order') && blocks.some((b) => b.key === 'self_order'), JSON.stringify(blocks));
  }, 'critical');

  await s.check('A plain choice behaves exactly as before: only that module, 3 days, tenant and owner created', async () => {
    const tok = await newUser('b'); const r = await trial(['payroll'], tok); assert(r.status === 200, JSON.stringify(r.raw));
    const row = (await q(`select features, trial->>'state' st from tenant_settings where tenant_id = $1`, [r.data.tenant_id]))[0];
    assert(JSON.stringify(row.features) === '{"payroll":true}' && row.st === 'active', JSON.stringify(row));
    assert((await q(`select role from profiles where tenant_id = $1`, [r.data.tenant_id]))[0].role === 'owner', 'no owner');
    const st = await call('trial_status', {}, tok); assert(st.data.state === 'active' && st.data.seconds_left > 259000, JSON.stringify(st.raw));
  }, 'critical');

  await s.check('Invalid selections are refused on the server and create nothing (unknown, set-up-by-us, always-included, empty)', async () => {
    const before = await tenantCount();
    for (const [blocks, why] of [[['nope'], 'unknown'], [['salon'], 'salon is set up by our team'], [['hub'], 'hub is always included'], [[], 'empty'], [['payroll', 'nope'], 'one bad key']]) {
      const tok = await newUser('bad'); const r = await trial(blocks, tok); assert(r.status >= 400, why + ' was accepted: ' + JSON.stringify(r.raw));
    }
    assert(await tenantCount() === before, 'a tenant was created by a refused request');
  }, 'critical');

  await s.check('A defined conflict is refused (none exist today, so one is set up temporarily and removed again)', async () => {
    await q(`update module_catalogue set conflicts = '{scan}' where key = 'payroll'`);
    try {
      const r = await call('public_module_resolve', { p: { blocks: ['payroll', 'scan'] } }); assert(r.status >= 400, 'conflict accepted: ' + JSON.stringify(r.raw));
      const tok = await newUser('c'); const t = await trial(['payroll', 'scan'], tok); assert(t.status >= 400, 'trial started with a conflict');
      const ok = await call('public_module_resolve', { p: { blocks: ['payroll'] } }); assert(ok.status === 200, 'single module refused');
    } finally { await q(`update module_catalogue set conflicts = '{}' where key = 'payroll'`); }
  });

  await s.check('A missing dependency makes the request fail safely instead of starting a half-working trial', async () => {
    await q(`update trial_blocks set active = false where key = 'pos'`);
    try { const tok = await newUser('d'); const before = await tenantCount(); const r = await trial(['self_order'], tok); assert(r.status >= 400, 'accepted: ' + JSON.stringify(r.raw)); assert(await tenantCount() === before, 'tenant created'); }
    finally { await q(`update trial_blocks set active = true where key = 'pos'`); }
  });

  await s.check('Kitchen is its own module that needs AUZsPOS: it adds POS with a reason; POS alone does not add Kitchen', async () => {
    const r = await call('public_module_resolve', { p: { blocks: ['kitchen'] } });
    assert(r.status === 200 && r.data.keys.includes('pos') && r.data.keys.includes('kitchen'), JSON.stringify(r.raw));
    assert(r.data.added.some((a) => a.key === 'pos' && a.because === 'kitchen'), 'no reason: ' + JSON.stringify(r.data.added));
    const p = await call('public_module_resolve', { p: { blocks: ['pos'] } });
    assert(JSON.stringify(p.data.keys) === '["pos"]', 'POS alone pulled in more: ' + JSON.stringify(p.data.keys));
    const cat = (await call('public_module_catalogue', {})).data; const ids = cat.flatMap((m) => (m.screens || []).map((x) => x.id));
    assert(new Set(ids).size === ids.length, 'a screen is offered by two modules');
    assert(cat.find((m) => m.key === 'kitchen').screens[0].id === 'kitchen' && !cat.find((m) => m.key === 'pos').screens.some((x) => x.id === 'kitchen'), 'kitchen screen on the wrong module');
  }, 'critical');

  await s.check('Direct backend call: a Kitchen trial gets POS plus the kds key; a POS-only trial does not get kds; 3 days either way', async () => {
    const tk = await newUser('k'); const rk = await trial(['kitchen'], tk); assert(rk.status === 200, JSON.stringify(rk.raw));
    assert(rk.data.added.some((a) => a.key === 'pos'), 'dependency not reported');
    const fk = (await q(`select features, trial->'blocks' b, extract(epoch from ((trial->>'ends')::timestamptz - (trial->>'started')::timestamptz)) secs from tenant_settings where tenant_id = $1`, [rk.data.tenant_id]))[0];
    assert(fk.features.pos === true && fk.features.kds === true && Math.abs(fk.secs - 259200) < 5, JSON.stringify(fk));
    assert(fk.b.some((x) => x.key === 'pos' && x.added_for === 'kitchen'), 'reason not recorded: ' + JSON.stringify(fk.b));
    const dash = await call('my_dashboard', {}, tk); assert(dash.status === 200 && dash.data.features.kds === true, 'the app would not show Kitchen: ' + JSON.stringify(dash.raw).slice(0, 200));
    const tp = await newUser('p'); const rp = await trial(['pos'], tp); assert(rp.status === 200, JSON.stringify(rp.raw));
    const fp = (await q(`select features from tenant_settings where tenant_id = $1`, [rp.data.tenant_id]))[0].features;
    assert(fp.pos === true && fp.kds === undefined, 'POS-only trial got kds: ' + JSON.stringify(fp));
    const dp = await call('my_dashboard', {}, tp); assert(dp.data.features.kds !== true, 'POS-only dashboard shows kds');
  }, 'critical');

  await s.check('Kitchen survives the lock and is only restored when paid for (kds put aside with the other features)', async () => {
    const tk = await newUser('kl'); const rk = await trial(['kitchen'], tk);
    await q(`update tenant_settings set trial = jsonb_set(trial, '{ends}', to_jsonb(now() - interval '1 minute')) where tenant_id = $1`, [rk.data.tenant_id]);
    const st = await call('trial_status', {}, tk); assert(st.data.state === 'locked', JSON.stringify(st.raw));
    const row = (await q(`select features, trial->'locked_features' lf from tenant_settings where tenant_id = $1`, [rk.data.tenant_id]))[0];
    assert(Object.keys(row.features).length === 0 && row.lf.kds === true && row.lf.pos === true, JSON.stringify(row));
  });

  await s.check('When the 3 days end the trial locks, features are put aside, and the business data is kept', async () => {
    await q(`update tenant_settings set trial = jsonb_set(trial, '{ends}', to_jsonb(now() - interval '1 minute')) where tenant_id = $1`, [tidA]);
    const st = await call('trial_status', {}, tokA); assert(st.data.state === 'locked', JSON.stringify(st.raw));
    const row = (await q(`select features, trial->'locked_features' lf from tenant_settings where tenant_id = $1`, [tidA]))[0];
    assert(Object.keys(row.features).length === 0 && row.lf.pos === true && row.lf.self_order === true, JSON.stringify(row));
    assert((await q(`select 1 from records where tenant_id = $1 and kind = 'settings'`, [tidA])).length === 1, 'business data lost');
  }, 'critical');

  await s.check('Tenant isolation: another business cannot see this trial, and the catalogue table is not readable directly', async () => {
    const tokB = await newUser('iso'); const rb = await trial(['payroll'], tokB); assert(rb.status === 200, JSON.stringify(rb.raw));
    const st = await call('trial_status', {}, tokB); assert(st.data.state === 'active' && st.data.blocks.length === 1 && st.data.blocks[0].key === 'payroll', 'saw another business: ' + JSON.stringify(st.raw));
    const direct = await fetch(stack.apiBase + '/db/module_catalogue', { headers: { authorization: 'Bearer ' + tokB } }); assert(direct.status >= 400, 'table readable through the generic API: ' + direct.status);
    const mine = async (tok) => { const x = await fetch(stack.apiBase + '/db/records?select=tenant_id&kind=eq.settings', { headers: { authorization: 'Bearer ' + tok } }); const j = await x.json().catch(() => null); return { status: x.status, rows: (j && (j.data || j)) || [] }; };
    const a = await mine(tokA), b = await mine(tokB);
    assert(a.status === 200 && a.rows.some((r) => r.tenant_id === tidA), 'owner A cannot see own settings (test would be vacuous): ' + JSON.stringify(a));
    assert(b.status === 200 && b.rows.length > 0 && !b.rows.some((r) => r.tenant_id === tidA), 'business B sees business A data: ' + JSON.stringify(b));
  }, 'critical');

  await s.check('Anonymous resolver is rate limited like other public RPCs (own API copy with the limiter ON), and a huge selection list is answered quickly', async () => {
    const port = 21000 + Math.floor(Math.random() * 2000);
    const env = { ...process.env, PORT: String(port), PGHOST: PG.host, PGPORT: String(PG.port), POSTGRES_APP_PASSWORD: PG.appPassword, POSTGRES_DB: PG.db, JWT_SECRET: 'test-secret-test-secret-test-secret-123', DOMAIN: 'localhost', DISABLE_MAINTENANCE: '1' };
    delete env.DISABLE_RATE_LIMIT;
    const api = spawn('node', ['src/index.js'], { cwd: path.join(ROOT, 'server'), env, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = ''; api.stdout.on('data', (d) => (log += d)); api.stderr.on('data', (d) => (log += d));
    try {
      for (let i = 0; i < 100 && !/listening/.test(log); i++) { if (api.exitCode !== null) throw new Error('limited API exited: ' + log.slice(0, 300)); await new Promise((r) => setTimeout(r, 150)); }
      const hit = (body) => fetch(`http://127.0.0.1:${port}/rpc/public_module_resolve`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      // a very large list of different unknown keys: refused at the first one, and fast
      const big = { p: { blocks: Array.from({ length: 200000 }, (_, i) => 'k' + i) } };
      const t0 = Date.now(); const rb = await hit(big); const ms = Date.now() - t0;
      assert(rb.status === 400, 'big list status ' + rb.status); assert(ms < 3000, 'big list took ' + ms + ' ms');
      // many repeats of one valid key collapse to one
      const rep = await hit({ p: { blocks: Array(100000).fill('payroll') } }); const rj = await rep.json(); assert(rep.status === 200 && JSON.stringify(rj.data.keys) === '["payroll"]', JSON.stringify(rj).slice(0, 120));
      // the limiter: 300 per 5 minutes per address for public calls (2 used above)
      let first429 = 0; for (let i = 3; i <= 310; i++) { const r = await hit({ p: { blocks: ['payroll'] } }); if (r.status === 429) { first429 = i; break; } }
      assert(first429 >= 299 && first429 <= 302, 'limiter did not stop the 301st call (first 429 at call ' + first429 + ')');
    } finally { api.kill('SIGKILL'); }
  });

  await s.check('The builder takes its feature list from the catalogue (changing the database changes the page)', async () => {
    await q(`update module_catalogue set screens = jsonb_set(screens, '{0,label}', '"ZZ Catalogue Marker"') where key = 'payroll'`);
    const ctx = await newCtx(browser, stack, { w: 390, h: 844, mobile: true }); const page = await ctx.newPage(); const errs = watch(page);
    try {
      await page.goto(stack.url('app', '/my.html')); await page.waitForSelector('#tiles .tile', { timeout: 15000 });
      const txt = await page.locator('#tiles').innerText(); assert(txt.includes('ZZ Catalogue Marker'), 'database change not shown: ' + txt.slice(0, 200));
      assert(txt.includes('Billing and invoices') && txt.includes('Repairs'), 'normal features missing');
    } finally { await q(`update module_catalogue set screens = jsonb_set(screens, '{0,label}', '"Staff attendance"') where key = 'payroll'`); await ctx.close(); }
  }, 'critical');

  await s.check('Offline metadata: every seeded module has valid metadata, honest levels, and is returned by the public catalogue', async () => {
    const bad = await q(`select key from module_catalogue where not module_offline_ok(offline)`); assert(!bad.length, 'invalid: ' + bad.map((x) => x.key));
    const cat = (await call('public_module_catalogue', {})).data; assert(cat.every((m) => m.offline && ['full', 'partial', 'online_only', 'unknown'].includes(m.offline.level)), 'a module has no offline metadata in the public output');
    const lv = Object.fromEntries(cat.map((m) => [m.key, m.offline.level]));
    assert(lv.pos === 'full' && lv.mobile === 'full' && lv.scan === 'full', 'POS/Mobile/Scan: ' + JSON.stringify(lv));
    assert(lv.self_order === 'online_only' && lv.finance === 'online_only' && lv.salon === 'online_only' && lv.hub === 'online_only', 'online-only modules wrong: ' + JSON.stringify(lv));
    assert(['kitchen', 'accounting', 'payroll', 'style'].every((k) => lv[k] === 'partial') && lv.website_builder === 'unknown', 'partial/unknown wrong: ' + JSON.stringify(lv));
    assert(cat.filter((m) => m.offline.level === 'full').every((m) => m.offline.verified === true && m.offline.basis === 'browser_tested'), 'full without a browser test');
    assert(cat.find((m) => m.key === 'payroll').offline.verified === false, 'Pay browser queue is not verified');
    assert(cat.every((m) => m.offline.summary && Array.isArray(m.offline.evidence) && m.offline.evidence.length > 0 || m.offline.level === 'unknown'), 'missing summary/evidence');
    assert(!/"(price|rate|amount)[a-z_]*"|₹|secret|token/i.test(JSON.stringify(cat)), 'private data in the public catalogue');
  }, 'critical');

  await s.check('Offline metadata constraint: incomplete, wrongly typed and contradictory objects are rejected; a complete valid one is accepted', async () => {
    const cur = (await q(`select offline from module_catalogue where key = 'payroll'`))[0].offline;
    const set = async (v) => { try { await q(`update module_catalogue set offline = $1::jsonb where key = 'payroll'`, [JSON.stringify(v)]); return true; } catch { return false; } };
    const must = async (label, v) => assert(!(await set(v)), label + ' was accepted: ' + JSON.stringify(v).slice(0, 90));
    try {
      await must('empty object', {}); await must('only level full', { level: 'full' }); await must('full + verified, nothing else', { level: 'full', verified: true }); await must('only level partial', { level: 'partial' });
      for (const k of Object.keys(cur)) { const c = { ...cur }; delete c[k]; await must('missing key ' + k, c); }
      await must('verified as text', { ...cur, verified: 'true' }); await must('writes_queued boolean', { ...cur, writes_queued: false }); await must('writes_queued bad word', { ...cur, writes_queued: 'maybe' });
      await must('retry_safety bad word', { ...cur, retry_safety: 'magic' }); await must('summary null', { ...cur, summary: null }); await must('evidence numbers', { ...cur, evidence: [1, 2] });
      await must('works_offline not a list', { ...cur, works_offline: 'yes' }); await must('unknown level', { ...cur, level: 'maybe' }); await must('level as a number', { ...cur, level: 1 });
      await must('full not verified', { ...cur, level: 'full', verified: false, basis: 'code_inspected' }); await must('verified but only code inspected', { ...cur, verified: true, basis: 'code_inspected' });
      await must('verified with basis none', { ...cur, verified: true, basis: 'none' }); await must('unknown level but verified', { ...cur, level: 'unknown', verified: true, basis: 'browser_tested' });
      await must('JSON null', null); await must('an array', []); await must('a string', 'full');
      assert(await set({ ...cur }), 'the current valid object was refused');
      assert(await set({ ...cur, level: 'full', verified: true, basis: 'browser_tested' }), 'a complete valid full object was refused');
    } finally { await q(`update module_catalogue set offline = $1::jsonb where key = 'payroll'`, [JSON.stringify(cur)]); }
    assert((await q(`select offline->>'level' l from module_catalogue where key = 'payroll'`))[0].l === 'partial', 'payroll metadata not restored');
  }, 'critical');

  await s.check('Re-running migration 265 changes nothing that was edited afterwards (guarded seed) and is otherwise harmless', async () => {
    const sql = fs.readFileSync(path.join(ROOT, 'db', '265_module_offline_metadata.sql'), 'utf8');
    const before = (await q(`select key, offline from module_catalogue order by key`));
    await q(sql);
    const same = (await q(`select key, offline from module_catalogue order by key`));
    assert(JSON.stringify(before) === JSON.stringify(same), 'a plain re-run changed metadata');
    const edited = { ...before.find((r) => r.key === 'website_builder').offline, summary: 'Edited by hand after the seed.' };
    await q(`update module_catalogue set offline = $1::jsonb where key = 'website_builder'`, [JSON.stringify(edited)]);
    try { await q(sql); assert((await q(`select offline->>'summary' s from module_catalogue where key = 'website_builder'`))[0].s === 'Edited by hand after the seed.', 're-run overwrote an edit'); }
    finally { await q(`update module_catalogue set offline = $1::jsonb where key = 'website_builder'`, [JSON.stringify(before.find((r) => r.key === 'website_builder').offline)]); }
    await q(`insert into module_catalogue (key, label) values ('zz_seed_probe', 'Probe')`);
    try { await q(sql); assert((await q(`select offline->>'level' l from module_catalogue where key = 'zz_seed_probe'`))[0].l === 'unknown', 'a module outside the seed list was changed'); }
    finally { await q(`delete from module_catalogue where key = 'zz_seed_probe'`); }
  }, 'critical');

  await s.check('Offline metadata rules: invalid level, full without verification, and verified without a browser test are rejected; a new module is unknown and unverified', async () => {
    const tryUp = async (patch) => { try { await q(`update module_catalogue set offline = offline || $1::jsonb where key = 'payroll'`, [JSON.stringify(patch)]); return true; } catch { return false; } };
    assert(!(await tryUp({ level: 'maybe' })), 'invalid level accepted');
    assert(!(await tryUp({ level: 'full' })), 'full while unverified accepted');
    assert(!(await tryUp({ verified: true })), 'verified without a browser test accepted');
    assert(!(await tryUp({ writes_queued: false })), 'a boolean writes_queued accepted (unknown must stay distinct)');
    assert((await q(`select offline->>'level' l from module_catalogue where key = 'payroll'`))[0].l === 'partial', 'payroll metadata changed');
    await q(`insert into module_catalogue (key, label) values ('zz_new_mod', 'New')`);
    try { const o = (await q(`select offline from module_catalogue where key = 'zz_new_mod'`))[0].offline; assert(o.level === 'unknown' && o.verified === false && o.basis === 'none' && o.writes_queued === 'unknown', JSON.stringify(o)); }
    finally { await q(`delete from module_catalogue where key = 'zz_new_mod'`); }
  }, 'critical');

  await s.check('The builder shows the offline label from the database: Works offline for POS, Needs internet for Finance, Partly offline note for Pay', async () => {
    const ctx = await newCtx(browser, stack, { w: 390, h: 844, mobile: true }); const page = await ctx.newPage();
    try {
      await page.goto(stack.url('app', '/my.html')); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForSelector('#tiles .tile', { timeout: 15000 });
      const tile = (name) => page.locator('#tiles .tile', { hasText: name }).first().innerText();
      assert(/Works offline/.test(await tile('Billing and invoices')), 'POS label: ' + await tile('Billing and invoices'));
      assert(/Needs internet/.test(await tile('Expenses and cash')), 'Finance label');
      assert(/Partly offline/.test(await tile('Staff attendance')), 'Pay label');
      await page.locator('#tiles .tile', { hasText: 'Staff attendance' }).click(); await page.waitForSelector('#deps .ob-note', { timeout: 10000 });
      assert(/clock in/i.test(await page.locator('#deps .ob-note').first().innerText()), 'no partial note');
    } finally { await ctx.close(); }
  });

  await s.check('Missing, malformed or unverified "full" metadata is shown as Not yet checked, never as Works offline', async () => {
    const real = await (await fetch(stack.apiBase + '/rpc/public_module_catalogue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
    const cat = real.data || real; const t = JSON.parse(JSON.stringify(cat));
    const by = (k) => t.find((m) => m.key === k);
    delete by('pos').offline; by('payroll').offline = { level: 'full', verified: false }; by('scan').offline = 'oops'; by('mobile').offline = { level: 'teleport', verified: true };
    const ctx = await newCtx(browser, stack, { w: 390, h: 844, mobile: true }); const page = await ctx.newPage();
    await page.route('https://api.auzslab.in/rpc/public_module_catalogue', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: t }) }));
    try {
      await page.goto(stack.url('app', '/my.html')); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForSelector('#tiles .tile', { timeout: 15000 });
      for (const name of ['Billing and invoices', 'Staff attendance', 'Scan to bill', 'Phone sales and IMEI']) {
        const tx = await page.locator('#tiles .tile', { hasText: name }).first().innerText();
        assert(/Not yet checked/.test(tx) && !/Works offline/.test(tx), name + ' shown as: ' + tx);
      }
    } finally { await ctx.close(); }
  });

  await s.check('Evidence qualifiers: browser-tested says not on real devices; code-inspected and documentation-only say not tested; unknown says not checked; contradictions fall back', async () => {
    const real = await (await fetch(stack.apiBase + '/rpc/public_module_catalogue', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
    const t = JSON.parse(JSON.stringify(real.data || real)); const by = (k) => t.find((m) => m.key === k);
    const base = by('payroll').offline;
    by('pos').offline = { ...base, level: 'full', verified: true, basis: 'browser_tested', summary: 'x' };
    by('scan').offline = { ...base, level: 'partial', verified: false, basis: 'code_inspected', summary: 'Only reading code.' };
    by('mobile').offline = { ...base, level: 'partial', verified: false, basis: 'documentation_only', summary: 'Only docs.' };
    by('style').offline = { ...base, level: 'unknown', verified: false, basis: 'none' };
    by('finance').offline = { ...base, level: 'full', verified: true, basis: 'code_inspected' };      // contradiction
    by('website_builder').offline = { ...base, level: 'partial', verified: 'yes', basis: 'browser_tested' }; // wrong type
    const ctx = await newCtx(browser, stack, { w: 390, h: 844, mobile: true }); const page = await ctx.newPage();
    await page.route('https://api.auzslab.in/rpc/public_module_catalogue', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: t }) }));
    try {
      await page.goto(stack.url('app', '/my.html')); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForSelector('#tiles .tile', { timeout: 15000 });
      const tip = async (name) => { const b = page.locator('#tiles .tile', { hasText: name }).first().locator('.ob'); return { label: await b.innerText(), title: await b.getAttribute('title') }; };
      let x = await tip('Billing and invoices'); assert(x.label === 'Works offline' && /test browser/i.test(x.title) && /Not yet tested on real/i.test(x.title), JSON.stringify(x));
      x = await tip('Scan to bill'); assert(x.label === 'Partly offline' && /reading the code/i.test(x.title) && /Not tested/i.test(x.title) && !/test browser/i.test(x.title), JSON.stringify(x));
      x = await tip('Phone sales and IMEI'); assert(x.label === 'Partly offline' && /documentation only/i.test(x.title) && !/test browser/i.test(x.title), JSON.stringify(x));
      x = await tip('Sizes and colours'); assert(x.label === 'Not yet checked' && /Not checked/i.test(x.title), JSON.stringify(x));
      x = await tip('Expenses and cash'); assert(x.label === 'Not yet checked' && !/test browser/i.test(x.title), 'contradiction trusted: ' + JSON.stringify(x));
      x = await tip('Your own website'); assert(x.label === 'Not yet checked', 'wrong-type flag trusted: ' + JSON.stringify(x));
      await page.locator('#tiles .tile', { hasText: 'Billing and invoices' }).click(); await page.waitForSelector('#deps .ob-basis', { timeout: 10000 });
      assert(/Tested in a test browser\. Not yet tested on real phones/i.test(await page.locator('#deps').innerText()), 'qualifier not shown in the selection list');
    } finally { await ctx.close(); }
  });

  await s.check('The builder explains an added dependency before the trial starts', async () => {
    const ctx = await newCtx(browser, stack, { w: 390, h: 844, mobile: true }); const page = await ctx.newPage();
    try {
      await page.goto(stack.url('app', '/my.html')); await page.evaluate(() => localStorage.clear()); await page.reload(); await page.waitForSelector('#tiles .tile', { timeout: 15000 });
      await page.locator('#tiles .tile', { hasText: 'QR table ordering' }).click(); await page.waitForSelector('#deps .dep .why', { timeout: 10000 });
      const t = await page.locator('#deps').innerText(); assert(/AUZsPOS/.test(t) && /Added because/i.test(t), t);
    } finally { await ctx.close(); }
  });

  await s.check('If the catalogue cannot load, the builder shows an error and offers nothing to tick (no access is granted)', async () => {
    const ctx = await newCtx(browser, stack, { w: 390, h: 844, mobile: true }); const page = await ctx.newPage();
    await page.route('https://api.auzslab.in/rpc/public_module_catalogue', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"down"}' }));
    try {
      await page.goto(stack.url('app', '/my.html')); await page.waitForSelector('#tiles .err', { timeout: 15000 });
      assert((await page.locator('#tiles .tile').count()) === 0, 'tiles shown without a catalogue');
      assert(/could not load/i.test(await page.locator('#tiles').innerText()), 'no clear error');
      assert((await page.locator('#go button, #go a').count()) === 0, 'a start button is offered');
    } finally { await ctx.close(); }
  }, 'critical');

  await s.check('Build page: "Sign in to build my app" remembers the visit; staff logins get a clear note instead of a dead form', async () => {
    const ctx = await newCtx(browser, stack, { w: 390, h: 844, mobile: true }); const page = await ctx.newPage();
    try {
      await page.goto(stack.url('app', '/my.html')); await page.waitForSelector('#tiles .tile', { timeout: 15000 });
      await page.locator('#tiles .tile').first().click();
      await page.locator('#go a', { hasText: /sign in/i }).click(); await page.waitForURL(/start\.html/, { timeout: 15000 });
      assert(await page.evaluate(() => localStorage.getItem('auz_go_build') === '1'), 'the visit was not remembered');
    } finally { await ctx.close(); }
    const c2 = await newCtx(browser, stack, { w: 390, h: 844, mobile: true }); const p2 = await c2.newPage();
    try {
      await p2.goto(stack.url('app', '/my.html')); await p2.waitForSelector('#tiles .tile', { timeout: 15000 });
      const r = await p2.evaluate(async () => { const x = await supabase.createClient(CFG.url, CFG.key).auth.signInWithPassword({ email: 'admin@test.local', password: 'Test!pass123' }); return !!(x.data && x.data.session); });
      if (r) { await p2.reload(); await p2.waitForSelector('#tiles .tile', { timeout: 15000 }); await p2.locator('#tiles .tile').first().click(); await p2.waitForSelector('#go .note', { timeout: 8000 });
        const t = await p2.locator('#go').innerText(); assert(/staff/i.test(t) && /sign out/i.test(t), 'no staff note: ' + t); assert(await p2.locator('#go input').count() === 0, 'a form was shown to staff'); }
    } finally { await c2.close(); }
  }, 'major');

  await q(`update platform_flags set value = 'off' where key = 'password_signup'`);
  s.done();
}
