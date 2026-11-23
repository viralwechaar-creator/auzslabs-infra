// Theme marketplace in a real browser: install the built-in Kiln (Salon) theme, publish, and see it on the public store.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { q, USERS, PASSWORD } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('Storefront themes', 'Built-in themes carry the real copy, install, publish and render with a booking section.');
  await q("update tenant_settings set features = features || '{\"storefront\":true}' where tenant_id = (select id from tenants where slug='testcafe')");
  await q("insert into sfx_stores (tenant_id, published) select id, true from tenants where slug='testcafe' on conflict (tenant_id) do update set published=true");
  const ctx = await newCtx(browser, stack, { w: 1280, h: 800 }); const page = await ctx.newPage(); const errs = watch(page);
  await page.goto(stack.url('testcafe', '/storefront.html'), { waitUntil: 'load' }); await page.waitForTimeout(800);
  const tok = await page.evaluate(async ([e, p]) => { const c = window.supabase.createClient(CFG.url, CFG.key); const r = await c.auth.signInWithPassword({ email: e, password: p }); if (r.error) return { error: r.error.message };
    const list = await c.rpc('sfx_theme_marketplace_list'); const th = list.data.find((t) => t.slug === 'kiln-salon'); if (!th) return { error: 'theme missing' };
    const inst = await c.rpc('sfx_theme_install', { p_theme_id: th.id }); if (inst.error) return { error: inst.error.message };
    const a = await c.rpc('sfx_theme_install_set_active', { p_install_id: inst.data.installId }); if (a.error) return { error: a.error.message };
    const pub = await c.rpc('sfx_theme_customize_publish', { p_install_id: inst.data.installId }); if (pub.error) return { error: pub.error.message };
    return { ok: true }; }, [USERS.cafeOwner, PASSWORD]);
  await s.check('Install, activate and publish Kiln (Salon)', async () => { assert(tok.ok, JSON.stringify(tok)); }, 'critical');
  await s.check('The public store shows the real copy and the booking section', async () => {
    const pg = await ctx.newPage(); const e2 = watch(pg);
    await pg.goto(stack.url('testcafe', '/store.html'), { waitUntil: 'load' }); await pg.waitForTimeout(2500);
    const t = await pg.locator('body').innerText();
    assert(/Good things take their time/.test(t), 'hero copy missing: ' + t.slice(0, 200));
    assert(/Book your appointment/.test(t), 'booking section missing');
    assert(!e2.filter((x) => !/sentry|fonts/i.test(x)).length, e2.slice(0, 3).join(' | '));
  }, 'critical');
  await s.check('Developer portal offers the booking section with its own form', async () => {
    const dev = await ctx.newPage(); const e3 = watch(dev);
    await dev.goto(stack.url('testcafe', '/theme-dev.html'), { waitUntil: 'load' }); await dev.waitForTimeout(1500);
    const src = await dev.content(); assert(/Appointment booking/.test(src), 'booking label missing');
    assert(!e3.filter((x) => !/sentry|fonts|sfdev_/i.test(x)).length, e3.slice(0, 3).join(' | '));
  });
}
