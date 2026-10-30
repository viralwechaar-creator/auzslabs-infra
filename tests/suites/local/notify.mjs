// One notification inbox (db/273): clients, team and admin each see only their own notices, in the bell on the website,
// the admin panel and the team workspace. Checked through the real API and then in a real browser.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { q, PASSWORD, USERS } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('Notifications: one inbox and a bell for the admin, the team and clients', 'Each person sees only their own notices; the bell shows the count, opens the list and marks notices read.');
  const login = async (email) => { const d = await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json(); return (d.data || d).access_token; };
  const call = async (fn, args, tok) => { const r = await fetch(stack.apiBase + '/rpc/' + fn, { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(args || {}) }); let d = null; try { d = await r.json(); } catch {} return { status: r.status, data: d && d.data !== undefined ? d.data : d }; };
  const ok = async (fn, args, tok) => { const r = await call(fn, args, tok); assert(r.status === 200, `${fn}: ${r.status} ${JSON.stringify(r.data)}`); return r.data; };
  const adm = await login(USERS.admin), cli = await login(USERS.plain), mgr = await login(USERS.mobManager), sales = await login(USERS.payStaff);
  const uid = async (email) => (await q('select id from auth_users where email=$1', [email]))[0].id;
  const cliId = await uid(USERS.plain), salesId = await uid(USERS.payStaff);
  await q('delete from notifications');

  await s.check('A client is told about each step of their request, and nobody else sees it', async () => {
    const o = (await q("insert into client_orders (user_id, contact_name, phone, business_name) values ($1,'Cee','9999999999','Cee Shop') returning id", [cliId]))[0].id;
    await q("update client_orders set status='link_sent' where id=$1", [o]);
    await q("update client_orders set status='paid', invoice_no='AUZ/2026-27/0001' where id=$1", [o]);
    const r = await ok('inbox_list', { p_limit: 30 }, cli);
    const titles = r.items.map((x) => x.title);
    assert(r.unread === 3 && titles.includes('We received your request') && titles.includes('Your quote is ready') && titles.includes('Payment received'), JSON.stringify(titles));
    assert(r.items.find((x) => x.title === 'Your quote is ready').link.includes('/pay.html?t='), 'quote link missing');
    assert((await ok('inbox_list', {}, sales)).items.length === 0, 'another person sees the client notices');
    assert((await ok('inbox_list', {}, adm)).items.every((x) => !/Your quote/.test(x.title)), 'admin inbox shows a client notice');
    await ok('inbox_mark_read', { p_ids: null }, cli);
    assert((await ok('inbox_list', {}, cli)).unread === 0, 'not marked read');
    await fails(call, 'inbox_list', null);
  }, 'critical');

  await s.check('Platform notices reach only the admin; a failed WhatsApp message raises one system alert an hour', async () => {
    await q("insert into notifications (tenant_id, type, title, body) values (null,'lead','New lead: Test','x')");
    assert((await ok('inbox_list', {}, adm)).items.some((x) => x.title === 'New lead: Test'), 'admin did not get the lead');
    assert((await ok('inbox_list', {}, cli)).items.every((x) => x.title !== 'New lead: Test'), 'client sees admin notices');
    await q("delete from wa_outbox"); const tpl = (await q('select key from wa_templates limit 1'))[0].key;
    for (let i = 0; i < 3; i++) { const id = (await q("insert into wa_outbox (tenant_id,to_phone,template,status) values (null,'91',$1,'queued') returning id", [tpl]))[0].id; await q("update wa_outbox set status='failed', error='bad token' where id=$1", [id]); }
    assert((await q("select count(*)::int n from notifications where type='system_wa'"))[0].n === 1, 'system alert not throttled');
  });

  await s.check('The bell shows on the website only when signed in, lists notices and marks them read', async () => {
    const ctx = await newCtx(browser, stack, { w: 1280, h: 800 }); const page = await ctx.newPage(); const errs = watch(page);
    await page.goto(stack.url('', '/index.html')); await page.waitForTimeout(1500);
    assert((await page.locator('.auzb').count()) === 0, 'bell shown to a visitor who is not signed in');
    await q("insert into notifications (tenant_id, user_id, type, title, body) values (null,$1,'client_order','Your quote is ready','Open it')", [cliId]);
    await page.evaluate((t) => localStorage.setItem('auz_session', JSON.stringify({ access_token: t, user: { id: 'x' } })), cli);
    await page.goto(stack.url('', '/index.html')); await page.waitForSelector('.auzb', { timeout: 10000 });
    await page.waitForFunction(() => { const i = document.querySelector('.auzb i'); return i && !i.hidden && Number(i.textContent) >= 1; }, null, { timeout: 10000 });
    await page.click('.auzb'); await page.waitForSelector('.auzp.on .auzp-i');
    assert(/Your quote is ready/.test(await page.locator('.auzp').innerText()), 'notice not listed');
    await page.click('[data-all]'); await page.waitForFunction(() => document.querySelector('.auzb i').hidden, null, { timeout: 8000 });
    assert(!errs.some((e) => !/net::|Failed to load resource|sentry|favicon|list_clients/i.test(e)), 'script errors: ' + errs.join(' | ').slice(0, 300));
    await ctx.close();
  });

  await s.check('The bell sits in the admin panel top bar', async () => {
    const ctx = await newCtx(browser, stack, { w: 390, h: 844, mobile: true }); const page = await ctx.newPage();
    await page.addInitScript((t) => localStorage.setItem('auz_session', JSON.stringify({ access_token: t, user: { id: 'x' } })), adm);
    await page.goto(stack.url('', '/admin.html')); await page.waitForSelector('.a-topbar-actions .auzb', { timeout: 15000 });
    await ctx.close();
  });
}
async function fails(call, fn, tok) { const r = await call(fn, {}, tok); assert(r.status >= 400, fn + ' should need a login'); }
