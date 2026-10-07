// AUZsLedger offline drafts: Accounting starts with no connection from the copy kept on the device, a new bill can be written and
// kept, posting is refused offline, and when the connection is back the draft reaches the books once (never posted).
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { rpc } from '../../lib/api.mjs';
import { q, PASSWORD, USERS } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('Accounting offline drafts', 'Start Accounting with the server unreachable, write a bill, get it back as a draft once the connection returns.');
  const login = async (email) => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json()).access_token;
  const owner = await login(USERS.acctOwner); await rpc(stack, 'acc_bootstrap', {}, owner);
  const sup = (await rpc(stack, 'acc_save_party', { p: { kind: 'supplier', name: 'Offline Supplies Co', state_code: '08', reg_type: 'regular' } }, owner)).data.data.id;
  const tid = (await q("select id from tenants where slug='testacct'"))[0].id;
  const c = await newCtx(browser, stack, { w: 1280, h: 900 }); const page = await c.newPage(); const errs = watch(page);
  await page.goto(stack.url('testacct', '/accounts.html')); await page.waitForSelector('input[type=password]'); await page.fill('input[type=email]', USERS.acctOwner); await page.fill('input[type=password]', PASSWORD);
  await page.locator('button', { hasText: /^Sign in$/ }).click(); await page.waitForSelector('.shell', { timeout: 15000 }); await page.waitForTimeout(2500);   // lets the offline copy be saved
  let down = false; await page.route('https://api.auzslab.in/**', (r) => (down ? r.abort() : r.fallback()));

  await s.check('A copy of the setup, people and products is kept on the device while online', async () => {
    const k = await page.evaluate(async () => ({ boot: !!(await offLoad('boot')), parties: ((await offLoad('parties')) || []).length, products: !!(await offLoad('products')) }));
    assert(k.boot && k.parties >= 1 && k.products, JSON.stringify(k));
  }, 'critical');
  await s.check('With the server unreachable, Accounting still opens (from the copy) on the Offline drafts page with a clear bar', async () => {
    down = true; await page.reload(); await page.waitForSelector('#offbar:not([hidden])', { timeout: 15000 });
    assert(/offline/i.test(await page.locator('#offbar').innerText()), 'bar: ' + await page.locator('#offbar').innerText());
    await page.waitForFunction(() => /Offline drafts/.test(document.querySelector('#tb-t')?.textContent || ''), null, { timeout: 8000 });
    await s.shot(page, 'accounting-offline');
  }, 'critical');
  await s.check('Offline: a new bill can be written with a supplier from the saved list; it is kept, not posted', async () => {
    await page.evaluate(() => { location.hash = '#/new/bill'; }); await page.waitForSelector('.lines input[aria-label="Item"]', { timeout: 10000 });
    await page.locator('button.li', { hasText: /Choose supplier|Supplier/ }).first().click(); await page.waitForSelector('.sheet'); await page.locator('.sheet .li', { hasText: 'Offline Supplies Co' }).first().click(); await page.waitForTimeout(400);
    await page.locator('.lines input[aria-label="Item"]').first().fill('Offline cartons');
    const ins = await page.locator('.lines input').evaluateAll((els) => els.map((e) => ({ al: e.getAttribute('aria-label'), im: e.getAttribute('inputmode'), ph: e.placeholder, v: e.value })));
    const num = await page.locator('.lines input[inputmode=decimal], .lines input[type=number]').all(); assert(num.length >= 2, 'inputs: ' + JSON.stringify(ins));
    await num[0].fill('3'); await num[1].fill('100');
    await page.locator('.dock .btn', { hasText: /^Post bill$/ }).click(); await page.waitForTimeout(500);
    assert(/needs a connection|Posting needs/i.test(await page.locator('.toast, #toast, [role=status]').allInnerTexts().then((a) => a.join(' ')).catch(() => '')), 'posting offline was not refused');
    await page.locator('.dock .btn', { hasText: /^Save draft$/ }).click(); await page.waitForFunction(() => /Offline drafts/.test(document.querySelector('#tb-t')?.textContent || ''), null, { timeout: 8000 });
    await page.waitForFunction(() => /Offline cartons|Bill/.test(document.querySelector('#main')?.innerText || '') && /Waiting to send \(1\)/.test(document.querySelector('#main')?.innerText || ''), null, { timeout: 8000 });
    assert(Number((await q("select count(*)::int n from acc_documents where tenant_id=$1 and client_op is not null", [tid]))[0].n) === 0, 'it reached the books while offline');
    await s.shot(page, 'accounting-offline-queue');
  }, 'critical');
  await s.check('Back online: the draft reaches the books once, as a draft (not posted, no number), and the queue empties; sending again adds nothing', async () => {
    down = false;
    const r1 = await page.evaluate(() => flushDrafts()); assert(r1.sent === 1, JSON.stringify(r1));
    const rows = await q("select doc_type, status, number, total::float8 t, supplier_ref from acc_documents where tenant_id=$1 and client_op is not null", [tid]);
    assert(rows.length === 1 && rows[0].doc_type === 'bill' && rows[0].status === 'draft' && /^DRAFT-/.test(rows[0].number), JSON.stringify(rows));
    assert(Math.abs(rows[0].t - 354) < 0.05, 'total ' + rows[0].t + ' (3 x 100 + 18% GST)');
    assert((await page.evaluate(async () => (await draftQueue()).length)) === 0, 'queue not emptied');
    const r2 = await page.evaluate(() => flushDrafts()); assert(r2.sent === 0, 'second send: ' + JSON.stringify(r2));
    assert(Number((await q("select count(*)::int n from acc_documents where tenant_id=$1 and client_op is not null", [tid]))[0].n) === 1, 'duplicated');
  }, 'critical');
  await s.check('A draft the books refuse (supplier gone) is kept and shown with the reason, never silently dropped; it can be discarded', async () => {
    await page.evaluate(async () => { await queueDraft({ doc_type: 'bill', party_id: '00000000-0000-0000-0000-000000000009', doc_date: today(), lines: [{ description: 'x', qty: 1, rate: 10, tax_rate: 0 }] }, 10); });
    const r = await page.evaluate(() => flushDrafts()); assert(r.refused === 1 && r.sent === 0, JSON.stringify(r));
    const it = await page.evaluate(async () => (await draftQueue())[0]); assert(it.state === 'refused' && /unknown/i.test(it.error), JSON.stringify(it));
    await page.evaluate(() => { location.hash = '#/'; }); await page.waitForTimeout(500); await page.evaluate(() => { location.hash = '#/offline'; }); await page.waitForFunction(() => /Refused/.test(document.querySelector('#main')?.innerText || ''), null, { timeout: 8000 });
    await page.evaluate(async () => { await draftDel((await draftQueue())[0].op); }); assert((await page.evaluate(async () => (await draftQueue()).length)) === 0, 'discard');
  });
  await s.check('No script errors', async () => { const bad = errs.filter((e) => !/sentry|ERR_FAILED|ERR_ABORTED|net::|Failed to fetch|Could not reach|api\.auzslab/i.test(e)); assert(!bad.length, bad.slice(0, 3).join(' | ')); });
  await c.close();
  s.done();
}
