// The AUZslab team (db/176): salesmen, client setup staff, support staff and managers. Every rule is checked through the
// real API (who may add leads, update them, assign work, open a client's business, read the whole team), then the admin
// Team tab, the leads controls and the team workspace are driven on phone and desktop.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx, layoutIssues } from '../../lib/common.mjs';
import { q, PASSWORD, USERS, TENANTS } from '../../lib/db.mjs';

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
}
