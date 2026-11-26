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
    assert(/Visitors, 14 days/.test(t) && /Live visitors/.test(t) && !/not recorded for online stores yet/.test(t), 'visitor strip missing: ' + t.slice(0, 300));
    assert(await page.locator('.home-strip .hs-cell').count() === 5, 'the stats strip should have five numbers');
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
