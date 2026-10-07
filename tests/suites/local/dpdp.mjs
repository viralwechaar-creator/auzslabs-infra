// DPDP Act support: consent is recorded, people can download their data and send rights requests, the platform admin
// answers them, and nobody sees anybody else's. Plus the sign-up consent gate and the account/admin screens.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { rpc } from '../../lib/api.mjs';
import { q, PASSWORD, USERS } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('Privacy: consent record, my data, rights requests, admin queue', 'Real API calls as different people, then the sign-up, account and admin screens in a browser.');
  const login = async (email) => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json()).access_token;
  const signup = async (email) => { const j = await (await fetch(stack.apiBase + '/auth/signup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json(); return (j.data || j).access_token; };
  const call = async (tok, fn, args) => { const r = await rpc(stack, fn, args || {}, tok); return { ok: r.status === 200, status: r.status, data: r.data && r.data.data, error: r.data && r.data.error }; };
  const ok = async (tok, fn, args) => { const r = await call(tok, fn, args); assert(r.ok, `${fn}: ${r.status} ${r.error}`); return r.data; };
  const fails = async (tok, fn, args, re) => { const r = await call(tok, fn, args); assert(!r.ok, `${fn} should have been refused`); if (re) assert(re.test(r.error || ''), `${fn}: wrong reason: ${r.error}`); };
  const stamp = Date.now();
  const alice = await signup(`alice-${stamp}@test.local`), bob = await signup(`bob-${stamp}@test.local`), admin = await login(USERS.admin);
  assert(alice && bob && admin, 'could not sign the test people in');

  await s.check('Logged out: none of it is reachable', async () => { for (const fn of ['my_consents', 'record_my_consent', 'my_personal_data', 'submit_data_request', 'my_data_requests']) { const r = await call(null, fn, {}); assert(r.status === 401, fn + ' status ' + r.status); } }, 'critical');
  await s.check('Consent: nothing yet, then recorded once per notice version, optional updates choice kept', async () => {
    const c0 = await ok(alice, 'my_consents'); assert(c0.up_to_date === false && !c0.accepted_at, JSON.stringify(c0));
    const c1 = await ok(alice, 'record_my_consent', { p_purposes: { service: true, updates: false }, p_source: 'signup' }); assert(c1.up_to_date === true && c1.purposes.updates === false, JSON.stringify(c1));
    const c2 = await ok(alice, 'record_my_consent', { p_purposes: { service: true, updates: true }, p_source: 'account' }); assert(c2.purposes.updates === true && c2.history.length === 1, 'same version must not add a row: ' + JSON.stringify(c2.history));
    const w = await ok(alice, 'withdraw_my_consent', { p_purpose: 'updates' }); assert(w.consents.purposes.updates === false, 'updates not switched off');
  }, 'critical');
  await s.check('A new notice version asks again (up_to_date false) until it is accepted', async () => {
    await q("update platform_flags set value='2099-01' where key='privacy_version'");
    try { const c = await ok(alice, 'my_consents'); assert(c.up_to_date === false && c.current_version === '2099-01', JSON.stringify(c)); await ok(alice, 'record_my_consent', { p_purposes: { service: true } }); assert((await ok(alice, 'my_consents')).up_to_date === true, 'not accepted'); }
    finally { await q("update platform_flags set value='2026-10' where key='privacy_version'"); }
  });
  await s.check('Requests: bad kind refused, details needed where they matter, limit of 5 open, own list only', async () => {
    await fails(alice, 'submit_data_request', { p_kind: 'hack', p_message: '' }, /choose/i);
    await fails(alice, 'submit_data_request', { p_kind: 'correction', p_message: '' }, /describe/i);
    const a = await ok(alice, 'submit_data_request', { p_kind: 'access', p_message: '' }); assert(a.status === 'open' && a.due_at, JSON.stringify(a));
    await ok(alice, 'submit_data_request', { p_kind: 'correction', p_message: 'My phone number changed to 9000000000' });
    const mine = await ok(alice, 'my_data_requests'); assert(mine.length >= 2, 'alice list ' + mine.length);
    assert((await ok(bob, 'my_data_requests')).length === 0, 'bob can see alice\'s requests');
    for (let i = 0; i < 3; i++) await ok(alice, 'submit_data_request', { p_kind: 'grievance', p_message: 'Complaint number ' + i });
    await fails(alice, 'submit_data_request', { p_kind: 'other', p_message: 'one more please' }, /several open/i);
  }, 'critical');
  await s.check('My data download: has the account, consents and requests, and never a password hash or token', async () => {
    const d = await ok(alice, 'my_personal_data'); const txt = JSON.stringify(d);
    assert(d.account.login_email === `alice-${stamp}@test.local` && d.consents.length >= 1 && d.requests.length >= 5, 'missing parts: ' + txt.slice(0, 300));
    assert(!/\$2[aby]\$/.test(txt) && !/password_hash|pin_hash|"secret"|access_token/i.test(txt), 'a secret is in the download');
    const b = await ok(bob, 'my_personal_data'); assert(b.account.login_email === `bob-${stamp}@test.local` && !JSON.stringify(b).includes('alice-'), 'bob sees alice');
  }, 'critical');
  await s.check('Admin queue: only the platform admin; closing needs a reply; the person sees it; the action is audited', async () => {
    await fails(alice, 'admin_list_data_requests', { p_status: 'active' }, /not authorized/i); await fails(alice, 'admin_update_data_request', { p_id: '00000000-0000-0000-0000-000000000000', p_status: 'done', p_response: 'x' }, /not authorized/i);
    const list = await ok(admin, 'admin_list_data_requests', { p_status: 'active' }); const r = list.find((x) => x.login_email === `alice-${stamp}@test.local` && x.kind === 'access'); assert(r, 'admin cannot see alice\'s request');
    await fails(admin, 'admin_update_data_request', { p_id: r.id, p_status: 'done', p_response: '' }, /short reply/i);
    await ok(admin, 'admin_update_data_request', { p_id: r.id, p_status: 'in_progress', p_response: null });
    await ok(admin, 'admin_update_data_request', { p_id: r.id, p_status: 'done', p_response: 'We emailed your data file.' });
    const mine = await ok(alice, 'my_data_requests'); const m = mine.find((x) => x.id === r.id); assert(m.status === 'done' && m.response === 'We emailed your data file.' && m.acknowledged_at && m.closed_at, JSON.stringify(m));
    const n = Number((await q("select count(*)::int n from admin_audit where action in ('data_request_done','data_request_in_progress') and target_id=$1", [r.id]))[0].n); assert(n === 2, 'audit rows ' + n);
    assert(Number(await ok(admin, 'admin_open_data_request_count')) >= 4, 'open count');
  }, 'critical');
  await s.check('Account deletion removes the consent and requests with the account (no leftovers)', async () => {
    const em = `gone-${stamp}@test.local`, t = await signup(em); await ok(t, 'record_my_consent', { p_purposes: { service: true } }); await ok(t, 'submit_data_request', { p_kind: 'access', p_message: '' });
    const id = (await q('select id from auth_users where email=$1', [em]))[0].id; await q('delete from auth_users where id=$1', [id]);
    const n = Number((await q('select (select count(*) from user_consents where user_id=$1)+(select count(*) from data_requests where user_id=$1) n', [id]))[0].n); assert(n === 0, 'left behind ' + n);
  });

  // ---------- screens ----------
  const c = await newCtx(browser, stack); const page = await c.newPage(); const errs = watch(page);
  await page.route('**/accounts.google.com/**', (r) => r.abort());
  await s.check('Sign-up: the privacy box must be ticked before Google; the choice travels with the redirect', async () => {
    await page.goto(stack.url('', '/signup.html')); await page.waitForSelector('#consentBox', { state: 'visible', timeout: 10000 });
    await page.locator('#googleBtnHost a').click(); await page.waitForTimeout(400);
    assert(/tick the box/i.test(await page.locator('#authErr').innerText()), 'no message without consent'); assert(/signup\.html/.test(page.url()), 'it navigated without consent');
    await page.check('#consentService'); await page.check('#consentUpdates');
    const [req] = await Promise.all([page.waitForRequest((r) => /signin\.html\?/.test(r.url()), { timeout: 8000 }), page.locator('#googleBtnHost a').click()]);
    assert(/consent=1/.test(req.url()) && /upd=1/.test(req.url()), req.url());
    await page.goto(stack.url('', '/signup.html')); await page.click('#modeLogin'); await page.waitForTimeout(300);
    assert(!(await page.locator('#consentBox').isVisible()), 'consent box should be for sign-up only');
  }, 'critical');
  await s.check('Account: the notice banner appears, Privacy & my data works end to end (agree, request, list, download)', async () => {
    await page.goto(stack.url('', '/signup.html')); await page.waitForTimeout(500); await page.click('#modeLogin'); await page.fill('#email', USERS.plain); await page.fill('#password', PASSWORD); await page.click('#submitBtn'); await page.waitForTimeout(2500);
    await page.goto(stack.url('', '/account.html#privacy')); await page.waitForSelector('#consentBanner', { timeout: 15000 });
    await page.waitForSelector('#pane-privacy .card h3'); assert(/Your consent/.test(await page.locator('#pane-privacy').innerText()), 'privacy pane');
    await page.click('#cbAgree'); await page.waitForFunction(() => !document.querySelector('#consentBanner')); await page.reload(); await page.waitForSelector('#pane-privacy .card h3'); await page.waitForTimeout(800);
    assert(!(await page.locator('#consentBanner').count()), 'banner came back after agreeing'); assert(/agreed to our Privacy policy/.test(await page.locator('#pane-privacy').innerText()), 'consent not shown');
    await page.selectOption('#prKind', 'correction'); await page.fill('#prText', 'Please fix the spelling of my name'); await page.click('#prSend'); await page.waitForFunction(() => /Please fix the spelling/.test((document.querySelector('#prList') || { innerText: '' }).innerText), null, { timeout: 8000 });
    let dl = null; page.on('download', (d) => { dl = d; }); await page.click('#prDownload');
    for (let i = 0; i < 40 && !dl; i++) await page.waitForTimeout(200);
    const diag = await page.evaluate(() => ({ title: document.title, body: document.body.innerText.slice(0, 150), anchors: document.querySelectorAll('a[download]').length, msg: (document.querySelector('#prMsg') || {}).textContent, url: location.href }));
    assert(dl, 'no download event: ' + JSON.stringify(diag)); assert(dl.suggestedFilename() === 'my-auzslab-data.json', dl.suggestedFilename());
    await s.shot(page, 'privacy-my-data');
  }, 'critical');
  await s.check('Admin screen: the request shows in Privacy requests and can be answered', async () => {
    const c2 = await newCtx(browser, stack); const p = await c2.newPage();
    await p.goto(stack.url('', '/admin.html')); await p.waitForTimeout(800); await p.fill('#email', USERS.admin); await p.fill('#password', PASSWORD); await p.click('#signin'); await p.waitForTimeout(3000);
    await p.evaluate(() => openSection('privacyReq')); await p.waitForFunction(() => /Please fix the spelling/.test(document.querySelector('#privacyReqList').innerText), null, { timeout: 10000 });
    p.once('dialog', (d) => d.accept('Fixed, thank you.')); await p.locator('[data-pr-close][data-st=done]').first().click(); await p.waitForTimeout(1500);
    const done = await q("select count(*)::int n from data_requests where status='done' and response='Fixed, thank you.'"); assert(Number(done[0].n) === 1, 'not closed from the screen');
    await s.shot(p, 'admin-privacy-requests'); await c2.close();
  }, 'major');
  await s.check('No script errors on these screens', async () => { const bad = errs.filter((e) => !/sentry|google|ERR_FAILED|ERR_BLOCKED|net::ERR_ABORTED|list_clients|my_dashboard/i.test(e)); assert(!bad.length, bad.slice(0, 3).join(' | ')); });
  await c.close();
  s.done();
}
