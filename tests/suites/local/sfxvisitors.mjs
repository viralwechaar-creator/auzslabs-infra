// Storefront dashboard: real visitor summary (Home + Analytics) fed by the public store's anonymous events.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { rpc } from '../../lib/api.mjs';
import { q, USERS, PASSWORD } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('Storefront visitors', 'A visit, add-to-bag, checkout and order event update the dashboard counters; zero and unavailable are shown differently.');
  await q("update tenant_settings set features = features || '{\"storefront\":true}' where tenant_id = (select id from tenants where slug='testcafe')");
  await q("insert into sfx_stores (tenant_id, published) select id, true from tenants where slug='testcafe' on conflict (tenant_id) do update set published=true");
  const tid = (await q("select id from tenants where slug='testcafe'"))[0].id;
  await q('delete from sfx_web_events where tenant_id=$1', [tid]);
  const login = async (email) => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json()).access_token;
  const owner = await login(USERS.cafeOwner);
  const summary = async () => (await rpc(stack, 'sfx_visitor_summary', { p_days: 14 }, owner)).data.data;

  await s.check('Razorpay keys entered once in the storefront also switch on card payments in the AUZsStyle store', async () => {
    await q("insert into sty_store (tenant_id, config) values ($1, '{\"on\":true}'::jsonb) on conflict (tenant_id) do update set config = '{\"on\":true}'::jsonb", [tid]);
    const r = await rpc(stack, 'sfx_store_set_razorpay', { p: { keyId: 'rzp_test_abcdefgh12345', secret: 'secret_value_123456' } }, owner);
    assert(!r.data.error, JSON.stringify(r.data).slice(0, 200));
    const pub = (await rpc(stack, 'public_sfx_store', { p_slug: 'testcafe' })).data; const pd = pub && pub.data !== undefined ? pub.data : pub;
    assert(pd && pd.config && pd.config.payOnline === true, 'the public store should say card payments are on: ' + JSON.stringify(pd && pd.config).slice(0, 160));
    const c = (await q('select config from sty_store where tenant_id=$1', [tid]))[0].config;
    assert(c.payOnline === true && c.rzpKey === 'rzp_test_abcdefgh12345' && c.on === true, JSON.stringify(c));
    assert((await q('select 1 from sty_store_secrets where tenant_id=$1', [tid])).length === 1, 'secret copied');
    await rpc(stack, 'sfx_store_set_razorpay', { p: { clear: true } }, owner);
    const d = (await q('select config from sty_store where tenant_id=$1', [tid]))[0].config;
    assert(d.payOnline === false && !d.rzpKey, JSON.stringify(d));
    assert((await q('select 1 from sty_store_secrets where tenant_id=$1', [tid])).length === 0, 'secret removed');
  }, 'critical');
  await s.check('A business with the storefront takes online orders only there: the old AUZsStyle store steps aside', async () => {
    await q("update tenant_settings set features = features || '{\"style\":true}' where tenant_id = $1", [tid]);
    await q("insert into sty_store (tenant_id, config) values ($1, '{\"on\":true}'::jsonb) on conflict (tenant_id) do update set config = '{\"on\":true}'::jsonb", [tid]);
    const st = await rpc(stack, 'public_sty_store', { p_slug: 'testcafe' });
    assert(st.data === null || st.data.data === null || st.data.data === undefined, 'old store should answer nothing: ' + JSON.stringify(st.data).slice(0, 160));
    const po = await rpc(stack, 'public_sty_place_order', { p_slug: 'testcafe', p: { items: [] } });
    assert(/storefront/i.test(JSON.stringify(po.data)), 'old order path should refuse: ' + JSON.stringify(po.data).slice(0, 160));
    await q("update tenant_settings set features = (features || '{\"storefront\":true}') - 'style' where tenant_id = $1", [tid]);
  }, 'critical');
  await s.check('The demo business storefront is filled from its AUZsStyle catalogue (products, collections)', async () => {
    const r = await rpc(stack, 'public_sfx_store', { p_slug: 'demo' });
    const d = r.data && r.data.data !== undefined ? r.data.data : r.data;
    assert(d && !d.closed && Array.isArray(d.styles) && d.styles.length > 0, 'demo store should list products: ' + JSON.stringify(d).slice(0, 200));
    const own = (await q("select count(*)::int n from sty_styles where tenant_id=(select id from tenants where slug='demo')"))[0].n;
    assert(d.styles.length >= own, 'every AUZsStyle style is listed: ' + d.styles.length + ' vs ' + own);
  }, 'major');
  await s.check('Zero activity: the summary is empty but available', async () => {
    const v = await summary(); assert(v.tracking === true && v.visitors === 0 && v.series.length === 14, JSON.stringify(v).slice(0, 200));
  }, 'critical');
  await s.check('A visit, add to bag, checkout and order from the public store update the counters', async () => {
    const ev = (sid, ...kinds) => kinds.map((k) => ({ k, sid, p: '/shop', dev: 'phone' }));
    const send = (events) => rpc(stack, 'public_sfx_track', { p_slug: 'testcafe', p: { events } });
    await send([...ev('visitor0001', 'view'), ...ev('visitor0002', 'view', 'bag'), ...ev('visitor0003', 'view', 'bag', 'checkout', 'order')]);
    const v = await summary();
    assert(v.visitors === 3 && v.views === 3 && v.bag === 2 && v.checkout === 1 && v.ordered === 1, JSON.stringify({ v: v.visitors, views: v.views, bag: v.bag, co: v.checkout, o: v.ordered }));
    assert(v.series.at(-1).visitors === 3, 'today bucket (Asia/Kolkata) should hold the visitors');
    assert(v.devices[0].device === 'phone' && v.pages[0].page === '/shop', JSON.stringify([v.devices, v.pages]));
  }, 'critical');
  await s.check('Live view: a valid time zone is counted per place, a malformed one is dropped', async () => {
    const ev = (sid, tz) => ({ k: 'view', sid, p: '/', dev: 'phone', tz });
    await rpc(stack, 'public_sfx_track', { p_slug: 'testcafe', p: { events: [ev('geoVisitor01', 'Asia/Kolkata'), ev('geoVisitor02', 'Asia/Kolkata'), ev('geoVisitor03', 'Europe/London'), ev('geoVisitor04', 'x; drop table users;--')] } });
    const live = (await rpc(stack, 'sfx_live_visitors', {}, owner)).data.data;
    assert(live.zones['Asia/Kolkata'] === 2 && live.zones['Europe/London'] === 1, JSON.stringify(live.zones));
    assert(Object.keys(live.zones).length === 2, 'the malformed zone must not be stored: ' + JSON.stringify(live.zones));
    await q("delete from sfx_web_events where sid like 'geoVisitor%'");
  });
  await s.check('Shared location: kept rounded to 0.1 degree, drawn as a point instead of a time zone, bad values dropped, no exact position stored', async () => {
    const view = (sid, tz) => ({ k: 'view', sid, p: '/', dev: 'phone', tz });
    await rpc(stack, 'public_sfx_track', { p_slug: 'testcafe', p: { events: [view('locVisitor01', 'Asia/Kolkata'), view('locVisitor02', 'Asia/Kolkata'),
      { k: 'loc', sid: 'locVisitor01', lat: 26.29876, lng: 73.01734 }, { k: 'loc', sid: 'locVisitor02', lat: 999, lng: 12 }, { k: 'loc', sid: 'locVisitor02', lat: 'x', lng: 'y' }] } });
    const row = (await q("select lat::float lat, lng::float lng from sfx_web_events where sid='locVisitor01' and kind='loc'"))[0];
    assert(row.lat === 26.3 && row.lng === 73, 'location not rounded: ' + JSON.stringify(row));
    assert((await q("select count(*)::int n from sfx_web_events where sid='locVisitor02' and kind='loc'"))[0].n === 0, 'a bad position was stored');
    const live = (await rpc(stack, 'sfx_live_visitors', {}, owner)).data.data;
    assert(live.located === 1 && live.points.length === 1 && live.points[0].lat === 26.3, JSON.stringify([live.located, live.points]));
    assert(live.zones['Asia/Kolkata'] === 1, 'the visitor without a shared location stays on the time zone: ' + JSON.stringify(live.zones));
    await q("delete from sfx_web_events where sid like 'locVisitor%'");
  });
  await s.check('Store asks about location in plain words; Allow stores a rounded position, Not now is remembered', async () => {
    const c2 = await browser.newContext({ viewport: { width: 1000, height: 800 }, geolocation: { latitude: 28.61394, longitude: 77.20902 }, permissions: ['geolocation'] }); const pg = await c2.newPage();
    const sent = []; pg.on('request', (r) => { if (/_track/.test(r.url()) && r.postData()) sent.push(r.postData()); });
    await pg.goto(stack.url('testcafe', '/store.html'), { waitUntil: 'load' });
    await pg.waitForSelector('.geoask', { timeout: 20000 });
    assert(/rough area/.test(await pg.locator('.geoask').innerText()), 'the question does not say only a rough area is kept');
    await pg.click('.geo-yes'); await pg.waitForTimeout(2000);
    const body = sent.join(' '); assert(/"k":"loc"/.test(body) && /"lat":28\.6/.test(body) && /"lng":77\.2/.test(body) && !/28\.61/.test(body), 'rounded position not sent: ' + body.slice(0, 300));
    await c2.close();
    const c3 = await browser.newContext({ viewport: { width: 1000, height: 800 }, geolocation: { latitude: 10, longitude: 10 }, permissions: ['geolocation'] }); const p3 = await c3.newPage();
    await p3.goto(stack.url('testcafe', '/store.html'), { waitUntil: 'load' }); await p3.waitForSelector('.geoask', { timeout: 20000 });
    await p3.click('.geo-no'); await p3.reload({ waitUntil: 'load' }); await p3.waitForTimeout(11000);
    assert(await p3.locator('.geoask').count() === 0, 'asked again right after Not now'); await c3.close();
    await q("delete from sfx_web_events where kind='loc'");
  });
  await s.check('A business whose public store is the AUZsStyle store still shows its visitors on Home and Live view', async () => {
    const tid3 = (await q("select id from tenants where slug='testcafe'"))[0].id;
    await q("insert into sty_web_events (tenant_id, sid, kind, page, device, tz, lat, lng) values ($1,'styVisitor0001','view','/','phone','Asia/Kolkata',26.3,73.0), ($1,'styVisitor0002','view','/shop','desktop','Europe/London',null,null)", [tid3]);
    const live = (await rpc(stack, 'sfx_live_visitors', {}, owner)).data.data;
    assert(live.now >= 2 && live.located >= 1 && live.zones['Europe/London'] === 1, JSON.stringify(live).slice(0, 300));
    const sum = (await rpc(stack, 'sfx_visitor_summary', { p_days: 7 }, owner)).data.data;
    assert(sum.visitors >= 5, 'summary should count the AUZsStyle store visits too: ' + sum.visitors);
    await q("delete from sty_web_events where sid like 'styVisitor%'");
  });
  await s.check('Only this store: another business\'s events are not counted', async () => {
    const other = (await q("select id from tenants where slug <> 'testcafe' limit 1"))[0].id;
    await q("insert into sfx_web_events (tenant_id, sid, kind, page) values ($1,'other-sid-1','view','/x')", [other]);
    assert((await summary()).visitors === 3, 'counted another tenant');
  }, 'critical');

  const ctx = await newCtx(browser, stack, { w: 1280, h: 900 }); const page = await ctx.newPage(); const errs = watch(page);
  const signIn = async () => { await page.goto(stack.url('testcafe', '/storefront.html'), { waitUntil: 'load' }); await page.waitForTimeout(800);
    await page.evaluate(async ([e, p]) => { const c = window.supabase.createClient(CFG.url, CFG.key); await c.auth.signInWithPassword({ email: e, password: p }); }, [USERS.cafeOwner, PASSWORD]); };
  await signIn();
  await s.check('Home shows the visitor numbers in the stats strip (not the old "not recorded" message) and no "Local preview" label', async () => {
    await page.goto('about:blank'); await page.goto(stack.url('testcafe', '/storefront.html#/home'), { waitUntil: 'load' }); await page.waitForTimeout(3500);
    const t = await page.locator('body').innerText();
    assert(/Sessions/.test(t) && /Total sales/.test(t) && /Conversion rate/.test(t) && /Live visitors/.test(t) && !/not recorded for online stores yet/.test(t), 'overview missing: ' + t.slice(0, 300));
    assert(await page.locator('.hm-fig').count() === 4, 'the overview should have four figures');
    await page.hover('.hm-fig[data-hm-metric="sessions"]'); await page.waitForTimeout(300);
    assert(await page.locator('.hm-pop:not([hidden]) .hm-chart').count() === 1 && /Sessions over time/.test(await page.locator('.hm-pop').innerText()), 'hover report missing');
    await page.click('.hm-pick-btn'); await page.click('[data-hm-channel="instore"]'); await page.waitForTimeout(600);
    assert(/AUZsStyle shop/.test(await page.locator('.hm-pick-btn').innerText()), 'channel not applied');
    await s.shot(page, 'sfx-home-visitors');
  }, 'critical');
  await s.check('Home setup guide: ten steps in three groups, each opens its page, and Connect a domain ticks once a domain is verified', async () => {
    const tid2 = (await q("select id from tenants where slug='testcafe'"))[0].id;
    await q("delete from sfx_domains where tenant_id=$1", [tid2]);
    const open = async () => { await page.goto('about:blank'); await page.goto(stack.url('testcafe', '/storefront.html#/home'), { waitUntil: 'load' }); await page.waitForTimeout(3200); };
    await open();
    const g = await page.evaluate(() => ({ count: document.querySelector('.setup-count')?.textContent, steps: document.querySelectorAll('.setup .step').length, groups: document.querySelectorAll('.setup h3').length, dom: [...document.querySelectorAll('.setup .step')].find((a) => /Connect a domain/.test(a.textContent)) }));
    assert(/\d+ \/ 10 completed/.test(g.count || '') && g.steps === 10 && g.groups === 3, JSON.stringify({ c: g.count, s: g.steps, g: g.groups }));
    const href = await page.evaluate(() => [...document.querySelectorAll('.setup .step')].find((a) => /Connect a domain/.test(a.textContent)).getAttribute('href'));
    assert(/\/domains$/.test(href), 'the domain step should open the Domains page: ' + href);
    assert(await page.evaluate(() => !([...document.querySelectorAll('.setup .step')].find((a) => /Connect a domain/.test(a.textContent)).classList.contains('done'))), 'no domain yet, so the step must not be ticked');
    await q("insert into sfx_domains (tenant_id, hostname, token, status, verified_at) values ($1,'shop.example-test.in','tok','verified',now())", [tid2]);
    await open();
    assert(await page.evaluate(() => [...document.querySelectorAll('.setup .step')].find((a) => /Connect a domain/.test(a.textContent)).classList.contains('done')), 'a verified domain should tick the step');
    await q("delete from sfx_domains where tenant_id=$1", [tid2]);
    await s.shot(page, 'sfx-home-setup');
  }, 'critical');
  await s.check('Analytics shows visitors, funnel counters and the live label', async () => {
    await page.goto('about:blank'); await page.goto(stack.url('testcafe', '/storefront.html#/analytics'), { waitUntil: 'load' }); await page.waitForTimeout(3500);
    const t = await page.locator('body').innerText();
    assert(/Added to bag/.test(t) && /Reached checkout/.test(t) && /Visitors by device/.test(t), 'visitor funnel missing');
    assert(!/Local preview/.test(t) && /Live data from your store/.test(t), 'old label still there');
    await s.shot(page, 'sfx-analytics-visitors');
    assert(!errs.filter((x) => !/sentry|fonts|googletag/i.test(x)).length, errs.slice(0, 3).join(' | '));
  }, 'critical');
  s.done();
}
