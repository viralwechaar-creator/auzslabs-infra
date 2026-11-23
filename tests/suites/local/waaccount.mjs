// Client account page: the WhatsApp automation section (turn on, choose messages, recent messages, manager read-only).
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { q, USERS, PASSWORD } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('Account page: WhatsApp automation', 'Owners switch automatic messages on and choose which; managers only look.');
  const login = async (page, email) => {
    await page.goto(stack.url('', '/privacy.html'), { waitUntil: 'load' }); await page.waitForTimeout(500);
    const r = await page.evaluate(async ([e, p]) => { const c = window.supabase.createClient(CFG.url, CFG.key); const x = await c.auth.signInWithPassword({ email: e, password: p }); return x.error ? x.error.message : 'ok'; }, [email, PASSWORD]);
    assert(r === 'ok', 'sign in: ' + r);
    await page.goto(stack.url('', '/account.html#whatsapp'), { waitUntil: 'load' }); await page.waitForTimeout(3500);
    const intro = page.getByRole('button', { name: 'Explore your account' }); if (await intro.count()) { await intro.first().click(); await page.waitForTimeout(1200); }
  };
  const ctx = await newCtx(browser, stack, { w: 1280, h: 900 }); const page = await ctx.newPage(); const errs = watch(page);
  await login(page, USERS.cafeOwner);
  await s.check('The owner sees the WhatsApp automation section with the shop messages', async () => {
    const t = await page.locator('body').innerText();
    assert(/WhatsApp automation/.test(t), 'section missing: ' + t.slice(0, 300));
    assert(/Bill to the customer/.test(t) && /Order ready/.test(t), 'message list missing');
    assert(/Automation is OFF/.test(t), 'should start off');
  }, 'critical');
  await s.check('Without AUZslab approval, turning it on explains why and stays off', async () => {
    await page.locator('#waToggle').click({ timeout: 8000 }); await page.waitForTimeout(1200);
    assert(/approve WhatsApp automation/.test(await page.locator('#waMsg').innerText()), 'no approval message: ' + await page.locator('#waMsg').innerText());
    const r = await q("select count(*)::int n from wa_tenant_settings w join tenants t on t.id=w.tenant_id where t.slug='testcafe' and w.enabled");
    assert(r[0].n === 0, 'turned on without approval');
  }, 'critical');
  await s.check('Once AUZslab approves, turning it on saves for the business', async () => {
    await q("update tenant_settings set caps = coalesce(caps,'{}'::jsonb) || '{\"whatsapp\":true}' where tenant_id=(select id from tenants where slug='testcafe')");
    await page.locator('#waToggle').click(); await page.waitForTimeout(1500);
    assert(/Automation is ON/.test(await page.locator('body').innerText()), 'not shown on');
    assert((await q("select enabled from wa_tenant_settings w join tenants t on t.id=w.tenant_id where t.slug='testcafe'"))[0].enabled === true, 'not saved');
  }, 'critical');
  await s.check('Unticking a message and saving is stored', async () => {
    await page.locator('[data-ev="order_ready"]').uncheck(); await page.locator('#waSave').click(); await page.waitForTimeout(1200);
    const ev = (await q("select events from wa_tenant_settings w join tenants t on t.id=w.tenant_id where t.slug='testcafe'"))[0].events;
    assert(ev.order_ready === false && ev.invoice_link === true, JSON.stringify(ev));
  }, 'critical');
  await s.check('Connecting with missing details is refused politely', async () => {
    await page.locator('#waConn').click(); await page.waitForTimeout(500);
    assert(/Enter the phone number ID/.test(await page.locator('#waMsg').innerText()), 'no message');
  });
  await s.check('A manager can look but not change', async () => {
    const mgr = await ctx.newPage(); const e2 = watch(mgr);
    const tid = (await q("select id from tenants where slug='testcafe'"))[0].id;
    await q("insert into auth_users (email, password_hash, email_verified_at) select 'wamgr@test.local', password_hash, now() from auth_users where email=$1 on conflict do nothing", [USERS.cafeOwner]);
    await q("insert into profiles (id, tenant_id, role) select id, $1, 'manager' from auth_users where email='wamgr@test.local' on conflict do nothing", [tid]);
    await login(mgr, 'wamgr@test.local');
    const t = await mgr.locator('body').innerText(); assert(/WhatsApp automation/.test(t), 'manager cannot see it: ' + t.slice(0, 200));
    assert(await mgr.locator('#waToggle').count() === 0 && await mgr.locator('#waSave').count() === 0, 'manager has write controls');
    assert(await mgr.locator('[data-ev]').first().isDisabled(), 'checkbox editable');
  });
  await s.check('No script errors', async () => { assert(!errs.filter((e) => !/sentry|fonts|wa_save_settings/i.test(e)).length, errs.slice(0, 3).join(' | ')); });
}
