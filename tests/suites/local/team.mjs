// The AUZslab team (db/176): salesmen, client setup staff, support staff and managers. Every rule is checked through the
// real API (who may add leads, update them, assign work, open a client's business, read the whole team), then the admin
// Team tab, the leads controls and the team workspace are driven on phone and desktop.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx, layoutIssues } from '../../lib/common.mjs';
import { q, PG, PASSWORD, USERS, TENANTS } from '../../lib/db.mjs';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const pg = createRequire(import.meta.url)('../../../server/node_modules/pg');

export default async function run({ browser, stack }) {
  const s = suite('Team: roles, leads, client setups, tracking and the team workspace', 'Salesmen keep leads up to date, setup staff work a checklist and can open only the client they were given for a limited time, managers see everyone, and the admin tracks it all.');
  const login = async (email) => { const d = await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json(); return (d.data || d).access_token; };
  const call = async (fn, args, tok) => { const r = await fetch(stack.apiBase + '/rpc/' + fn, { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(args || {}) }); let d = null; try { d = await r.json(); } catch {} return { status: r.status, data: d && d.data !== undefined ? d.data : d, raw: d }; };
  const ok = async (fn, args, tok) => { const r = await call(fn, args, tok); assert(r.status === 200, `${fn}: ${r.status} ${JSON.stringify(r.raw)}`); return r.data; };
  const fails = async (fn, args, tok, why) => { const r = await call(fn, args, tok); assert(r.status >= 400, `${fn} should have been refused (${why || ''})`); return r; };
  const E = { sales: USERS.payStaff, sales2: USERS.mobStaff, setup: USERS.payStaff2, support: USERS.mobStaff2, mgr: USERS.mobManager };
  const adm = await login(USERS.admin), plain = await login(USERS.plain);
  const T = {}; for (const [k, e] of Object.entries(E)) T[k] = await login(e);
  const uidOf = async (email) => (await q('select id from auth_users where email=$1', [email]))[0].id;
  let leadId, clientId, assignId;

  await s.check('Only the platform admin can add team members; a role is required to be one of four', async () => {
    const base = { p_email: E.sales, p_name: 'Sam Sales', p_role: 'salesman', p_phone: '9999900001' };
    await fails('admin_add_team_member', base, plain, 'plain user');
    await fails('admin_add_team_member', { ...base, p_role: 'ceo' }, adm, 'unknown role');
    await fails('admin_add_team_member', { ...base, p_email: 'nobody@nowhere.test' }, adm, 'no such account');
    for (const [role, email, name] of [['salesman', E.sales, 'Sam Sales'], ['salesman', E.sales2, 'Sue Sales'], ['setup', E.setup, 'Sia Setup'], ['support', E.support, 'Sol Support'], ['manager', E.mgr, 'Max Manager']]) {
      await ok('admin_add_team_member', { p_email: email, p_name: name, p_role: role, p_phone: null }, adm);
    }
    const me = await ok('team_me', {}, T.setup); assert(me.role === 'setup' && me.name === 'Sia Setup', JSON.stringify(me));
    await fails('team_me', {}, plain, 'not on the team');
    await fails('team_me', {}, null, 'logged out');
  }, 'critical');

  await s.check('Only a salesman or manager adds a lead; it is assigned to them, with a history', async () => {
    const lead = { name: 'Ravi Kumar', business: 'Ravi Cafe', contact: '9812345678', niche: 'cafe', message: 'Wants QR ordering', next_followup: '2020-01-01' };
    await fails('team_add_lead', { p: lead }, T.setup, 'setup staff');
    await fails('team_add_lead', { p: lead }, T.support, 'support staff');
    await fails('team_add_lead', { p: lead }, plain, 'not on the team');
    await fails('team_add_lead', { p: { ...lead, contact: '' } }, T.sales, 'no contact');
    await fails('team_add_lead', { p: { ...lead, name: '' } }, T.sales, 'no name');
    const r = await ok('team_add_lead', { p: lead }, T.sales);
    assert(r.status === 'new' && r.assignee === 'Sam Sales', JSON.stringify(r)); leadId = r.id;
    const mine = await ok('team_my_leads', {}, T.sales); assert(mine.length === 1 && mine[0].id === leadId, 'lead not in my list');
    assert((await ok('team_my_leads', {}, T.sales2)).length === 0, 'another salesman sees it');
    assert((await q("select count(*)::int n from team_activity where kind='lead_added'"))[0].n === 1, 'add not logged');
  }, 'critical');

  await s.check('Stage, follow-up date and notes: each change is saved, logged and shown in the history; strangers cannot touch the lead', async () => {
    await fails('team_update_lead', { p_id: leadId, p: { status: 'demo' } }, T.sales2, 'another salesman');
    await fails('team_update_lead', { p_id: leadId, p: { status: 'demo' } }, plain, 'not on the team');
    await fails('team_update_lead', { p_id: leadId, p: { status: 'rocket' } }, T.sales, 'unknown stage');
    const r = await ok('team_update_lead', { p_id: leadId, p: { status: 'demo', next_followup: '2099-01-01', note: 'Showed the POS, wants a quote' } }, T.sales);
    assert(r.status === 'demo' && r.next_followup === '2099-01-01' && r.last_note, JSON.stringify(r));
    const notes = await ok('team_lead_notes', { p_id: leadId }, T.sales);
    assert(notes.some((n) => n.kind === 'stage') && notes.some((n) => n.kind === 'followup') && notes.some((n) => n.kind === 'note' && /quote/.test(n.body)), JSON.stringify(notes));
    await fails('team_lead_notes', { p_id: leadId }, T.sales2, 'another salesman');
    const acts = (await q("select kind from team_activity order by id")).map((x) => x.kind);
    assert(['lead_stage', 'lead_followup', 'lead_note'].every((k) => acts.includes(k)), acts.join());
  }, 'critical');

  await s.check('A manager sees every lead and can hand one to another person; others cannot assign', async () => {
    await fails('team_all_leads', {}, T.sales, 'salesman'); await fails('team_all_leads', {}, T.setup, 'setup');
    assert((await ok('team_all_leads', {}, T.mgr)).some((l) => l.id === leadId), 'manager cannot see the lead');
    await fails('team_assign_lead', { p_lead: leadId, p_user: await uidOf(E.sales2) }, T.sales, 'salesman assigning');
    await fails('team_assign_lead', { p_lead: leadId, p_user: await uidOf(E.setup) }, T.mgr, 'setup staff cannot take leads');
    await ok('team_assign_lead', { p_lead: leadId, p_user: await uidOf(E.sales2) }, T.mgr);
    assert((await ok('team_my_leads', {}, T.sales2)).some((l) => l.id === leadId), 'new owner does not see it');
    await ok('team_update_lead', { p_id: leadId, p: { note: 'Called again' } }, T.sales2);
    await ok('team_assign_lead', { p_lead: leadId, p_user: await uidOf(E.sales) }, adm);
  }, 'critical');

  await s.check('Trials: only a salesman creates one, and it is counted as that person\'s work', async () => {
    await fails('salesman_provision_trial', { p_business_name: 'Nope Cafe', p_slug: 'nope-cafe', p_niche: 'cafe' }, T.setup, 'setup staff');
    await fails('salesman_provision_trial', { p_business_name: 'Nope Cafe', p_slug: 'nope-cafe', p_niche: 'cafe' }, T.mgr, 'manager');
    await ok('salesman_provision_trial', { p_business_name: 'Team Trial Cafe', p_slug: 'team-trial-cafe', p_niche: 'cafe' }, T.sales);
    assert((await q("select count(*)::int n from team_activity where kind='trial_created'"))[0].n === 1, 'trial not logged');
  }, 'critical');

  await s.check('Client setup: the admin or a manager assigns it to a setup person only; the person works a checklist', async () => {
    clientId = (await q("select id from tenants where niche='retail' limit 1"))[0].id; // has a real owner login (USERS.retailOwner)
    await fails('team_assign_setup', { p_tenant: clientId, p_user: await uidOf(E.setup), p_days: 7 }, T.sales, 'salesman');
    await fails('team_assign_setup', { p_tenant: clientId, p_user: await uidOf(E.sales), p_days: 7 }, adm, 'target is not a setup person');
    const a = await ok('team_assign_setup', { p_tenant: clientId, p_user: await uidOf(E.setup), p_days: 7 }, T.mgr); assignId = a.id;
    const mine = await ok('team_my_setups', {}, T.setup); assert(mine.length === 1 && mine[0].checklist.length === 6 && !mine[0].expired, JSON.stringify(mine));
    assert((await ok('team_my_setups', {}, T.sales)).length === 0, 'someone else sees the setup');
    await fails('team_setup_update', { p_id: assignId, p: { done: true } }, T.sales, 'not the assignee');
    const r = await ok('team_setup_update', { p_id: assignId, p: { checklist: [{ k: 'brand', done: true }, { k: 'menu', done: true }], note: 'Menu imported' } }, T.setup);
    assert(r.checklist.filter((x) => x.done).length === 2 && r.note === 'Menu imported' && r.status === 'open', JSON.stringify(r));
    assert((await ok('team_list_setups', {}, adm)).length === 1, 'admin cannot list setups'); await fails('team_list_setups', {}, T.sales, 'salesman');
  }, 'critical');

  await s.check('Opening the client\'s business: only the assigned setup person, a real owner session that is limited to 8 hours, never renewed, and logged', async () => {
    const open = async (tok) => { const r = await fetch(stack.apiBase + '/admin/salesman-open-pos', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify({ tenant_id: clientId }) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
    assert((await open(T.sales)).status >= 400, 'a salesman opened a client it does not own');
    assert((await open(T.support)).status >= 400, 'support staff opened a client');
    assert((await open(plain)).status >= 400, 'a stranger opened a client');
    const r = await open(T.setup);
    assert(r.status === 200 && r.body.access_token, 'the assigned setup person could not open: ' + JSON.stringify(r.body));
    const claims = JSON.parse(Buffer.from(r.body.access_token.split('.')[1], 'base64url').toString());
    assert(claims.lim === 1 && claims.exp - claims.iat <= 8 * 3600 + 5, 'session not limited: ' + JSON.stringify(claims));
    const ref = await fetch(stack.apiBase + '/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + r.body.access_token }, body: '{}' });
    assert(ref.status === 403, 'a limited session was renewed: ' + ref.status);
    const who = await fetch(stack.apiBase + '/rpc/my_dashboard', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + r.body.access_token }, body: '{}' });
    assert(who.status === 200, 'the limited session does not work as the client owner: ' + who.status);
    assert((await q("select count(*)::int n from team_activity where kind='setup_open'"))[0].n === 1, 'opening not logged');
  }, 'critical');

  await s.check('Access ends when the setup is finished, expires, or is cancelled', async () => {
    const open = async () => (await fetch(stack.apiBase + '/admin/salesman-open-pos', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + T.setup }, body: JSON.stringify({ tenant_id: clientId }) })).status;
    await q("update setup_assignments set expires_at = now() - interval '1 hour' where id=$1", [assignId]);
    assert((await open()) >= 400, 'opened after the time limit');
    await q("update setup_assignments set expires_at = now() + interval '3 days' where id=$1", [assignId]);
    assert((await open()) === 200, 'could not open again inside the limit');
    const done = await ok('team_setup_update', { p_id: assignId, p: { done: true } }, T.setup); assert(done.status === 'done', 'not finished');
    assert((await open()) >= 400, 'opened after finishing');
    await fails('team_setup_update', { p_id: assignId, p: { note: 'late' } }, T.setup, 'closed');
    const a2 = await ok('team_assign_setup', { p_tenant: clientId, p_user: await uidOf(E.setup), p_days: 7 }, adm);
    await ok('team_setup_cancel', { p_id: a2.id }, adm); assert((await open()) >= 400, 'opened after cancelling');
  }, 'critical');

  await s.check('Tracking: the manager and admin see each person\'s numbers and activity; nobody else does', async () => {
    await fails('team_overview', { p_days: 30 }, T.sales, 'salesman'); await fails('team_overview', { p_days: 30 }, plain, 'stranger');
    const ov = await ok('team_overview', { p_days: 30 }, T.mgr);
    const sam = ov.find((m) => m.email === E.sales), sia = ov.find((m) => m.email === E.setup);
    assert(sam && sam.role === 'salesman' && sam.updates >= 4 && sam.trials === 1 && sam.leads_open === 1, 'salesman numbers: ' + JSON.stringify(sam));
    assert(sia && sia.setups_done === 1 && sia.setups_open === 0, 'setup numbers: ' + JSON.stringify(sia));
    const feed = await ok('team_activity_feed', { p_uid: sam.id, p_limit: 20 }, adm); assert(feed.some((a) => a.kind === 'trial_created') && feed.some((a) => a.kind === 'lead_stage'), 'feed missing work');
    await fails('team_activity_feed', { p_uid: sam.id }, T.sales, 'salesman');
    const mineW = await ok('team_my_work', { p_days: 30 }, T.sales); assert(mineW.summary.trials === 1 && mineW.recent.length >= 4, 'my work wrong');
    await fails('admin_set_team_role', { p_id: sam.id, p_role: 'manager' }, T.mgr, 'manager changing roles');
    await ok('admin_set_team_role', { p_id: sia.id, p_role: 'support' }, adm); await ok('admin_set_team_role', { p_id: sia.id, p_role: 'setup' }, adm);
    await ok('admin_set_salesman_active', { p_id: sam.id, p_active: false }, adm);
    await fails('team_my_leads', {}, T.sales, 'switched off'); await ok('admin_set_salesman_active', { p_id: sam.id, p_active: true }, adm);
  }, 'critical');

  // ---------------- screens ----------------
  await s.check('Join the team: a public application, admin approval, and the seat appears at first sign-in', async () => {
    const app = { p_name: 'Nia Newhire', p_email: USERS.plain, p_phone: '9000000001', p_city: 'Jodhpur', p_role: 'support', p_experience: 'x', p_about: 'y', p_hp: '' };
    await fails('submit_team_application', { ...app, p_email: 'not-an-email' }, null, 'bad email');
    await ok('submit_team_application', { ...app, p_hp: 'bot' }, null);
    assert((await q('select count(*)::int n from team_applications'))[0].n === 0, 'honeypot should drop it');
    await ok('submit_team_application', app, null);
    await fails('admin_list_team_applications', {}, plain, 'not admin');
    const list = await ok('admin_list_team_applications', { p_status: 'new' }, adm);
    assert(list.length === 1 && list[0].name === 'Nia Newhire', JSON.stringify(list));
    await fails('admin_decide_team_application', { p_id: list[0].id, p_decision: 'approve', p_role: 'support' }, plain, 'not admin');
    await fails('admin_open_team_application_count', {}, plain, 'not admin');
    assert((await ok('admin_open_team_application_count', {}, adm)) === 1, 'badge count should be 1');
    await q('update auth_users set email_verified_at = now() where email=$1', [USERS.plain]);
    await fails('team_me', {}, plain, 'not approved yet');
    const dec = await ok('admin_decide_team_application', { p_id: list[0].id, p_decision: 'approve', p_role: 'support' }, adm);
    assert(dec.email === USERS.plain && dec.role === 'support' && dec.status === 'approved', JSON.stringify(dec));
    await fails('admin_decide_team_application', { p_id: list[0].id, p_decision: 'reject' }, adm, 'already decided');
    assert((await ok('admin_open_team_application_count', {}, adm)) === 0, 'badge count should be 0 now');
    const me = await ok('team_me', {}, plain);
    assert(me.role === 'support' && me.name === 'Nia Newhire', JSON.stringify(me));
    assert((await ok('admin_list_team_applications', { p_status: 'new' }, adm)).length === 0, 'still listed as new');
    await q('delete from platform_salesmen where id=$1', [await uidOf(USERS.plain)]);
  }, 'critical');

  await s.check('A team member signing in on the website is sent to the team workspace, not the products/cart page', async () => {
    await ok('admin_add_team_member', { p_email: USERS.plain, p_name: 'Web Signin', p_role: 'support', p_phone: null }, adm);
    const ctx = await newCtx(browser, stack, { w: 1280, h: 800 }); const page = await ctx.newPage();
    const urls = []; await page.route('https://app.auzslab.in/**', (r) => { urls.push(r.request().url()); r.abort(); });
    await page.goto(stack.url('', '/signup.html')); await page.waitForSelector('#modeLogin', { timeout: 10000 }); await page.click('#modeLogin');
    await page.fill('#email', USERS.plain); await page.fill('#password', PASSWORD); await page.click('#submitBtn'); await page.waitForTimeout(3000);
    assert(urls.some((u) => u.startsWith('https://app.auzslab.in/salesman.html')), 'not sent to the team workspace: ' + (urls.join(' | ') || page.url()));
    await ctx.close(); await q('delete from platform_salesmen where id=$1', [await uidOf(USERS.plain)]);
  }, 'critical');

  await s.check('The hub (app.auzslab.in) sends each kind of person to the right place: admin, team member, customer with no business, business owner', async () => {
    const hub = async (email, fn) => {
      const ctx = await newCtx(browser, stack, { w: 390, h: 844, mobile: true }); const page = await ctx.newPage(); const errs = watch(page);
      const sent = []; await page.route('https://auzslab.in/**', (r) => { sent.push(r.request().url()); r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>site</title>ok' }); });
      await page.goto(stack.url('app', '/start.html')); await page.waitForSelector('input[type=password]', { timeout: 20000 });
      await page.fill('input[type=email]', email); await page.fill('input[type=password]', PASSWORD); await page.locator('button', { hasText: /^Sign in$/ }).click();
      await fn(page, sent);
      assert(!errs.filter((e) => !/aborted|ERR_FAILED/i.test(e)).length, 'script errors: ' + errs.join(' | '));
      await ctx.close();
    };
    // a customer with no business and not on the team
    await hub(USERS.plain, async (page, sent) => {
      await page.waitForSelector('.tile', { timeout: 20000 });
      const t = await page.locator('.tile b').allInnerTexts();
      assert(t.includes('My account and purchases') && t.includes('Explore AUZslab') && t.includes('My cart'), 'customer tiles: ' + t.join(', '));
      assert(!/No business yet/i.test(await page.locator('body').innerText()), 'customer saw the old dead end');
      await page.locator('.tile', { hasText: 'My account and purchases' }).click(); await page.waitForTimeout(800);
      assert(/^https:\/\/auzslab\.in\/account\.html#auz_gt=/.test(page.url()), 'account link did not carry the session: ' + page.url());
    });
    // the platform admin
    await hub(USERS.admin, async (page, sent) => {
      await page.waitForSelector('.tile', { timeout: 20000 });
      const t = await page.locator('.tile b').allInnerTexts(); assert(t.includes('Admin panel'), 'admin tiles: ' + t.join(', '));
      await page.locator('.tile', { hasText: 'Admin panel' }).click(); await page.waitForTimeout(800);
      assert(/^https:\/\/auzslab\.in\/admin\.html#auz_gt=/.test(page.url()), 'admin link did not carry the session: ' + page.url());
    });
    // a team member without a business of their own lands on the team workspace
    await ok('admin_add_team_member', { p_email: USERS.plain, p_name: 'Hub Pure', p_role: 'support', p_phone: null }, adm);
    await hub(USERS.plain, async (page) => { await page.waitForURL(/\/salesman\.html/, { timeout: 20000 }); });
    await q('delete from platform_salesmen where id=$1', [await uidOf(USERS.plain)]);
    // a team member who is also staff of a business sees their business apps AND a Team workspace tile
    await hub(E.setup, async (page) => {
      await page.waitForSelector('.tile', { timeout: 20000 });
      const t = await page.locator('.tile b').allInnerTexts(); assert(t.includes('Team workspace'), 'team tile missing: ' + t.join(', '));
    });
    // a business owner keeps their app tiles and also gets the account and explore tiles
    await hub(USERS.cafeOwner, async (page) => {
      await page.waitForSelector('.tile', { timeout: 20000 });
      const t = await page.locator('.tile b').allInnerTexts();
      assert(t.includes('AUZsPOS') && t.includes('My account and purchases') && t.includes('Explore AUZslab'), 'owner tiles: ' + t.join(', '));
    });
  }, 'critical');

  await s.check('Hub "My requests": the client sees where each request is, pays from the app (not on iPhone), and sees the bill once paid', async () => {
    const cust = await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: USERS.plain, password: PASSWORD }) })).json();
    const tok = (cust.data || cust).access_token;
    const mk = async (biz) => (await (await fetch(stack.apiBase + '/rpc/submit_client_order', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify({ p: { contact_name: 'Hub Req', phone: '9812345671', business_name: biz, requirement: 'hub test', products: ['pos'] } }) })).json());
    const a = await mk('Hub Ready Co'), b = await mk('Hub Paid Co');
    const ta = (a.data || a).token, tb = (b.data || b).token;
    await q("update client_orders set status='link_sent' where token=$1", [ta]);
    await q("update client_orders set status='paid', invoice_no='AUZ/2026-27/9999' where token=$1", [tb]);
    const open = async (suffix, fn) => {
      const ctx = await newCtx(browser, stack, { w: 390, h: 844, mobile: true }); const page = await ctx.newPage(); const errs = watch(page);
      await page.route('https://auzslab.in/**', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>site</title>ok' }));
      await page.goto(stack.url('app', '/start.html' + suffix)); await page.waitForSelector('input[type=password]', { timeout: 20000 });
      await page.fill('input[type=email]', USERS.plain); await page.fill('input[type=password]', PASSWORD); await page.locator('button', { hasText: /^Sign in$/ }).click();
      await page.waitForSelector('.tile', { timeout: 20000 });
      assert(/ready for payment/i.test(await page.locator('.tile', { hasText: 'My requests' }).innerText()), 'tile did not say a request is ready for payment');
      await page.locator('.tile', { hasText: 'My requests' }).click(); await page.waitForSelector('text=Hub Ready Co', { timeout: 10000 });
      await fn(page);
      assert(!errs.filter((e) => !/aborted|ERR_FAILED/i.test(e)).length, 'script errors: ' + errs.join(' | '));
      await ctx.close();
    };
    await open('', async (page) => {
      const body = await page.locator('main').innerText();
      assert(/Ready to pay/.test(body) && /Active/.test(body) && /AUZ\/2026-27\/9999/.test(body), 'statuses/bill number missing: ' + body.slice(0, 300));
      const pay = await page.locator('a', { hasText: 'Read quote and pay' }).getAttribute('href'); assert(pay === 'https://auzslab.in/pay.html?t=' + ta, 'pay link: ' + pay);
      const bill = await page.locator('a', { hasText: 'View bill' }).getAttribute('href'); assert(bill === 'https://auzslab.in/inv.html?t=' + tb, 'bill link: ' + bill);
    });
    await open('?inapp=ios', async (page) => {
      const body = await page.locator('main').innerText();
      assert(!(await page.locator('a', { hasText: /pay/i }).count()) && /open auzslab\.in in your browser/i.test(body), 'iPhone app offered payment: ' + body.slice(0, 300));
      assert(await page.locator('a', { hasText: 'View bill' }).count(), 'iPhone app lost the bill');
    });
    await q("delete from client_orders where token = any($1)", [[ta, tb]]);
  }, 'critical');

  await s.check('Marketing-site opening animation plays with ?intro=1, then lifts away; automated browsers and the apps skip it by default', async () => {
    const ctx = await newCtx(browser, stack, { w: 390, h: 844, mobile: true }); const page = await ctx.newPage(); const errs = watch(page);
    await page.goto(stack.url('', '/pricing.html'));
    await page.waitForTimeout(600); assert(!(await page.locator('#auz-launch').count()), 'animation played for an automated browser without ?intro=1');
    await page.goto(stack.url('', '/pricing.html?intro=1')); await page.waitForSelector('#auz-launch', { timeout: 4000 });
    await page.waitForSelector('#auz-launch', { state: 'detached', timeout: 9000 });
    assert(!errs.filter((e) => !/aborted|ERR_FAILED/i.test(e)).length, 'script errors: ' + errs.join(' | '));
    await ctx.close();
  });

  await s.check('In-app shell (store and desktop apps): a way back to the hub on every page, and no buying on iPhone; an ordinary browser sees none of it', async () => {
    const ctx = await newCtx(browser, stack, { w: 390, h: 844, mobile: true }); const page = await ctx.newPage();
    await page.goto(stack.url('', '/pricing.html')); await page.waitForTimeout(1200);
    assert(!(await page.locator('.auz-hub-pill').count()), 'an ordinary browser got the in-app button');
    await page.goto(stack.url('', '/pricing.html?inapp=1')); await page.waitForSelector('.auz-hub-pill', { timeout: 8000 });
    assert(await page.evaluate(() => document.documentElement.classList.contains('in-app') && !document.documentElement.classList.contains('ios-app')), 'in-app class wrong');
    await page.goto(stack.url('', '/products.html?inapp=ios')); await page.waitForSelector('.auz-hub-pill', { timeout: 8000 });
    const shown = await page.evaluate(() => [...document.querySelectorAll('[data-add],[data-product]')].filter((e) => getComputedStyle(e).display !== 'none').length);
    assert(shown === 0, shown + ' add-to-cart buttons still visible in the iPhone app');
    await page.goto(stack.url('', '/cart.html?inapp=ios')); await page.waitForSelector('.auz-ios-buy', { timeout: 8000 });
    assert(/Finish on our website/.test(await page.locator('.auz-ios-buy').innerText()), 'iPhone cart page did not explain');
    await ctx.close();
  }, 'major');

  await s.check('Admin panel: the Team tab lists everyone with their role and numbers; Leads show assignee, stage and follow-up controls', async () => {
    const c = await newCtx(browser, stack, { w: 1300, h: 900 }); const p = await c.newPage(); const errs = watch(p);
    await p.goto(stack.url('', '/admin.html')); await p.waitForTimeout(800); await p.fill('#email', USERS.admin); await p.fill('#password', PASSWORD); await p.click('#signin');
    await p.waitForSelector('.a-side-btn[data-section=team]', { timeout: 15000 });
    await p.click('.a-side-btn[data-section=team]'); await p.waitForSelector('#teamList .tm-card', { timeout: 10000 });
    const txt = await p.locator('#teamList').innerText();
    for (const w of ['Sam Sales', 'Sia Setup', 'Sol Support', 'Max Manager']) assert(txt.includes(w), 'missing ' + w);
    assert(/salesman/i.test(txt) && /client setup/i.test(txt) && /manager/i.test(txt), 'role labels missing');
    await p.locator('#teamList .tm-card').first().locator('[data-feed]').click(); await p.waitForSelector('#teamList .tm-feed:not([hidden]) .tm-feed-row', { timeout: 8000 });
    await p.waitForSelector('#teamSetupList .list-card', { timeout: 8000 });
    await p.click('#teamAddOpen'); assert(await p.locator('#teamForm').isVisible(), 'add form did not open');
    await p.click('.a-side-btn[data-section=leads]'); await p.waitForSelector('#leadsList [data-assign]', { timeout: 10000 });
    await p.locator('#leadsList [data-assign]').first().focus(); await p.waitForTimeout(800);
    const sel = await p.locator('#leadsList [data-assign] option').allInnerTexts(); assert(sel.some((o) => /Sam Sales/.test(o)), 'assignee list missing: ' + sel.join());
    await p.locator('#leadsList [data-id]').first().locator('[data-history]').click(); await p.waitForSelector('#leadsList .lead-notes .tm-feed-row', { timeout: 8000 });
    await s.shot(p, 'admin-team');
    assert(!errs.length, errs.join(' | ')); await c.close();
  }, 'critical');

  await s.check('Team workspace: a salesman signs in and works leads and trials on phone; a setup person sees their checklist; a manager sees everyone', async () => {
    const asUser = async (email, w, h) => {
      const c = await newCtx(browser, stack, { w, h, mobile: w < 600 }); const p = await c.newPage(); const errs = watch(p);
      await p.goto(stack.url(TENANTS.retail, '/salesman.html')); await p.waitForTimeout(600); await p.fill('#email', email); await p.fill('#password', PASSWORD); await p.click('#signinBtn');
      await p.waitForSelector('#tabbar:not(.hidden) button', { timeout: 15000 }); return { c, p, errs };
    };
    const tabs = async (p) => (await p.locator('#tabs button').allInnerTexts()).map((x) => x.trim());
    // salesman, phone
    { const { c, p, errs } = await asUser(E.sales, 390, 844);
      assert((await tabs(p)).join() === 'Home,Leads,Trials,Me', 'salesman tabs: ' + (await tabs(p)).join());
      await p.waitForSelector('#p-home .hero', { timeout: 8000 });
      await p.click('#tabs [data-tab=leads]'); await p.waitForSelector('#leadList .row', { timeout: 8000 });
      await p.click('#addLeadBtn'); await p.fill('#alName', 'Meena Joshi'); await p.fill('#alBiz', 'Meena Salon'); await p.fill('#alContact', '9898989898'); await p.click('#alSave');
      await p.waitForSelector('#leadList .row:has-text("Meena Salon")', { timeout: 8000 });
      await p.locator('#leadList .row:has-text("Meena Salon")').click(); await p.waitForSelector('#lcStages [data-st=contacted]', { timeout: 5000 });
      await p.click('#lcStages [data-st=contacted]'); await p.fill('#lcNote', 'Spoke on the phone'); await p.click('#lcSave');
      await p.waitForSelector('#leadList .row:has-text("Contacted")', { timeout: 8000 });
      await s.shot(p, 'team-salesman-leads-phone');
      assert(!(await layoutIssues(p)).length, (await layoutIssues(p)).join());
      await p.click('#tabs [data-tab=trials]'); await p.waitForSelector('#trialsList .row', { timeout: 8000 });
      assert(/Team Trial Cafe/.test(await p.locator('#trialsList').innerText()), 'trial missing');
      await p.click('#tabs [data-tab=me]'); await p.waitForSelector('#meBody .kpi', { timeout: 8000 });
      assert(!errs.length, errs.join(' | ')); await c.close(); }
    // setup person, phone
    { await ok('team_assign_setup', { p_tenant: clientId, p_user: await uidOf(E.setup), p_days: 7 }, adm);
      const { c, p, errs } = await asUser(E.setup, 390, 844);
      assert((await tabs(p)).join() === 'Home,Setups,Me', 'setup tabs: ' + (await tabs(p)).join());
      await p.click('#tabs [data-tab=setup]'); await p.waitForSelector('#p-setup .row', { timeout: 8000 });
      await p.locator('#p-setup .row').first().click(); await p.waitForSelector('#suChecks input[data-k]', { timeout: 5000 });
      assert((await p.locator('#suChecks input').count()) === 6, 'checklist not shown');
      await p.locator('#suChecks input').nth(0).check(); await p.click('#suSave'); await p.waitForTimeout(600);
      assert((await ok('team_my_setups', {}, T.setup))[0].checklist[0].done === true, 'tick not saved');
      await s.shot(p, 'team-setup-phone');
      assert(!errs.length, errs.join(' | ')); await c.close(); }
    // manager, desktop
    { const { c, p, errs } = await asUser(E.mgr, 1280, 800);
      assert((await tabs(p)).join() === 'Home,Leads,Setups,Team,Me', 'manager tabs: ' + (await tabs(p)).join());
      await p.click('#tabs [data-tab=team]'); await p.waitForSelector('#p-team [data-m]', { timeout: 8000 });
      const t = await p.locator('#p-team').innerText(); assert(/Sam Sales/.test(t) && /Sia Setup/.test(t), 'team page missing people');
      await p.click('#tabs [data-tab=leads]'); await p.waitForSelector('#leadList .row', { timeout: 8000 });
      assert(/All leads/.test(await p.locator('#pageTitle').innerText()), 'manager title');
      await s.shot(p, 'team-manager-desktop');
      assert(!errs.length, errs.join(' | ')); await c.close(); }
    // a login that is not on the team
    { const c = await newCtx(browser, stack, { w: 390, h: 800, mobile: true }); const p = await c.newPage();
      await p.goto(stack.url(TENANTS.retail, '/salesman.html')); await p.waitForTimeout(500); await p.fill('#email', USERS.plain); await p.fill('#password', PASSWORD); await p.click('#signinBtn');
      await p.waitForSelector('#notTeam:not(.hidden)', { timeout: 10000 }); await c.close(); }
  }, 'critical');

  await s.check('Hub alerts: admin and team phones register; client requests, team work, assignments and admin notices each alert the right people', async () => {
    const lis = new pg.Client({ host: PG.host, port: PG.port, user: PG.user, password: PG.password, database: PG.db });
    await lis.connect(); await lis.query('LISTEN push_events');
    const got = []; lis.on('notification', (m) => { try { got.push(JSON.parse(m.payload)); } catch {} });
    const wait = async (f) => { for (let i = 0; i < 30; i++) { if (got.some(f)) return; await new Promise((r) => setTimeout(r, 100)); } assert(false, 'no matching alert: ' + JSON.stringify(got)); };
    const salesUid = await uidOf(E.sales), mgrUid = await uidOf(E.mgr), adminUid = await uidOf(USERS.admin), setupUid = await uidOf(E.setup);
    const tok = 'x'.repeat(40);
    await fails('register_platform_push', { p_token: tok }, plain, 'not on the team');
    await ok('register_platform_push', { p_token: tok + '1' }, T.sales); await ok('register_platform_push', { p_token: tok + '2' }, adm);
    assert((await q('select count(*)::int n from platform_fcm_tokens where token like $1', [tok + '%']))[0].n === 2, 'tokens not stored');
    // a client request reaches the admin and the manager
    await q("insert into notifications (tenant_id, type, title, body) values (null, 'client_order', 'New client request: Test Cafe', 'Asha 9999')");
    await wait((e) => e.platform && e.title.includes('New client request') && e.user_ids.includes(adminUid) && e.user_ids.includes(mgrUid));
    // a salesman's work reaches supervisors, not the salesman
    await q("select team_log('lead_added', 'x', 'Test lead', null, $1)", [salesUid]);
    await wait((e) => e.platform && e.title === 'New lead' && e.user_ids.includes(adminUid) && !e.user_ids.includes(salesUid));
    // an assignment reaches only the assigned person
    await q("select team_log('lead_assigned', 'x', 'Test lead', null, $1)", [salesUid]);
    await wait((e) => e.platform && /assigned to you/.test(e.title) && e.user_ids.length === 1 && e.user_ids[0] === salesUid);
    // notices: only admin/manager may post; the audience decides who is alerted; the team can read them
    await fails('admin_post_team_notice', { p_title: 'Hi' }, T.sales, 'a salesman cannot post');
    const r = await ok('admin_post_team_notice', { p_title: 'Office closed Friday', p_body: 'Diwali', p_audience: 'setup' }, adm);
    assert(r.sent_to >= 1, JSON.stringify(r));
    await wait((e) => e.platform && /Office closed Friday/.test(e.title) && e.user_ids.includes(setupUid) && !e.user_ids.includes(salesUid));
    assert((await ok('team_list_notices', {}, T.setup)).some((n) => n.title === 'Office closed Friday'), 'setup staff did not see the notice');
    assert(!(await ok('team_list_notices', {}, T.sales)).some((n) => n.title === 'Office closed Friday'), 'a salesman saw a notice meant for setup staff');
    await fails('team_list_notices', {}, plain, 'not on the team');
    await lis.end();
  }, 'critical');

  await s.check('Browser alerts for admin and team: the service worker really shows pushes, and a browser can register', async () => {
    const sw = fs.readFileSync(new URL('../../../app/public/sw.js', import.meta.url), 'utf8').split('\n');
    assert(sw.some((l) => l.startsWith("self.addEventListener('push'")), 'the push listener must start its own line (a // comment above once swallowed it)');
    assert(sw.some((l) => l.startsWith("self.addEventListener('notificationclick'")), 'notification click handler missing');
    const sub = { p_endpoint: 'https://push.example.test/send/' + 'a'.repeat(30), p_p256dh: 'B'.repeat(80), p_auth: 'c'.repeat(22) };
    await fails('register_platform_web_push', sub, plain, 'not on the team');
    await fails('register_platform_web_push', { ...sub, p_endpoint: 'http://insecure.test/x' }, T.sales, 'must be https');
    await ok('register_platform_web_push', sub, T.sales); await ok('register_platform_web_push', sub, adm);
    const rows = await q('select user_id from platform_web_push where endpoint = $1', [sub.p_endpoint]);
    assert(rows.length === 1, 'one row per browser (re-registering moves it, never duplicates): ' + rows.length);
  }, 'critical');
}
