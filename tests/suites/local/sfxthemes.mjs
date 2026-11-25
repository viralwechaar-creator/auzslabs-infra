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
  await s.check('Theme editor: sections, live preview, settings, undo, save draft, publish', async () => {
    const pg = await ctx.newPage(); const e4 = watch(pg);
    await pg.goto(stack.url('testcafe', '/storefront.html'), { waitUntil: 'load' }); await pg.waitForTimeout(800);
    const made = await pg.evaluate(async ([e, p]) => { const c = window.supabase.createClient(CFG.url, CFG.key); await c.auth.signInWithPassword({ email: e, password: p });
      const r = await c.rpc('sfx_theme_install_create', { p: { name: 'Editor theme', starter: 'shop', base: 'classic' } }); return r.error ? { error: r.error.message } : r.data; }, [USERS.cafeOwner, PASSWORD]);
    assert(made.installId, JSON.stringify(made));
    await pg.goto('about:blank'); await pg.goto(stack.url('testcafe', '/storefront.html#/builder/' + made.installId), { waitUntil: 'load' }); await pg.waitForTimeout(3000);
    assert(await pg.locator('.te-left').count() === 1 && await pg.locator('#te-frame').count() === 1 && await pg.locator('#te-right').count() === 1, 'three panes missing: ' + (await pg.locator('body').innerText()).slice(0, 200));
    const before = await pg.locator('.te-item').count();
    await pg.selectOption('#te-add-type', 'text'); await pg.locator('[data-action="te-add"]').click(); await pg.waitForTimeout(400);
    assert(await pg.locator('.te-item').count() === before + 1, 'section not added');
    await pg.fill('#te-right input[name=heading]', 'Live heading check'); await pg.waitForTimeout(1500);
    const fr = pg.frameLocator('#te-frame');
    assert(/Live heading check/.test(await fr.locator('body').innerText()), 'preview did not update live');
    // a real mouse click straight after typing must still work (the field blur must not replace the buttons)
    await pg.locator('[data-action="te-undo"]').click(); await pg.waitForTimeout(600);
    assert(!/Live heading check/.test(await fr.locator('body').innerText()) && await pg.locator('.te-item').count() === before, 'undo did not remove the section');
    await pg.locator('[data-action="te-redo"]').click(); await pg.waitForTimeout(600);
    assert(await pg.locator('.te-item').count() === before + 1, 'redo did not restore it');
    await pg.fill('#te-right input[name=heading]', 'Saved heading'); await pg.waitForTimeout(300);
    await pg.locator('[data-action="te-save"]').click(); await pg.waitForTimeout(1500);
    const row = (await q("select draft_content from sfx_theme_installs where id=$1", [made.installId]))[0].draft_content;
    assert(row.sections.some((x) => (x.props || {}).heading === 'Saved heading'), JSON.stringify(row.sections.map((x) => x.type)));
    assert(!e4.filter((x) => !/sentry|fonts|\/uploads\//i.test(x)).length, e4.slice(0, 3).join(' | ').slice(0, 400));
  }, 'major');
  await s.check('Theme editor: header, footer and a new page are saved and shown on the store', async () => {
    const r = await q("select id from sfx_theme_installs where name='Editor theme' order by id desc limit 1"); const id = r[0].id;
    const pg = await ctx.newPage(); await pg.goto(stack.url('testcafe', '/storefront.html'), { waitUntil: 'load' }); await pg.waitForTimeout(500);
    const draft = { sections: [{ id: 'a1', type: 'text', props: { heading: 'Home', body: 'x' } }], header: { announceText: 'Free shipping over 999', announceHref: '/shop', links: [{ label: 'Lookbook', href: '/page/lookbook' }] }, footer: { about: 'Small shop, big care.', note: 'Made in India', links: [{ label: 'Contact', href: '/page/contact' }] }, pages: [{ slug: 'lookbook', title: 'Lookbook', template: 'lookbook', sections: [{ id: 'p1', type: 'text', props: { heading: 'Spring looks', body: 'Fresh.' } }] }, { slug: 'bad slug', title: 'x', sections: [] }] };
    const sv = await pg.evaluate(async ([e, p, i, d]) => { const c = window.supabase.createClient(CFG.url, CFG.key); await c.auth.signInWithPassword({ email: e, password: p }); const r = await c.rpc('sfx_theme_customize_save', { p_install_id: i, p_content: d }); return r.error ? { error: r.error.message } : { ok: 1 }; }, [USERS.cafeOwner, PASSWORD, id, draft]); assert(!sv.error, sv.error);
    const pub = await pg.evaluate(async ([e, p, i]) => { const c = window.supabase.createClient(CFG.url, CFG.key); await c.auth.signInWithPassword({ email: e, password: p }); const a = await c.rpc('sfx_theme_install_set_active', { p_install_id: i }); const r = await c.rpc('sfx_theme_customize_publish', { p_install_id: i }); const st = await c.rpc('public_sfx_store', { p_slug: 'testcafe' }); return { err: (a.error || r.error || st.error || {}).message, cfg: st.data && st.data.config }; }, [USERS.cafeOwner, PASSWORD, id]);
    assert(!pub.err, pub.err);
    const cf = pub.cfg || {};
    assert(cf.themeHeader && cf.themeHeader.announceText === 'Free shipping over 999' && cf.themeHeader.links.length === 1, 'header: ' + JSON.stringify(cf.themeHeader));
    assert(cf.themeFooter && cf.themeFooter.note === 'Made in India' && cf.themeFooter.links.length === 1, 'footer: ' + JSON.stringify(cf.themeFooter));
    assert(Array.isArray(cf.themePages) && cf.themePages.length === 2 && cf.themePages[0].slug === 'lookbook' && cf.themePages[1].slug === 'bad-slug' && cf.themePages[0].sections.length === 1, 'pages: ' + JSON.stringify(cf.themePages));
  }, 'major');
  await s.check('Theme editor UI: add a page template, edit header and footer, save', async () => {
    const id = (await q("select id from sfx_theme_installs where name='Editor theme' order by id desc limit 1"))[0].id;
    const pg = await ctx.newPage(); const e5 = watch(pg);
    await pg.goto(stack.url('testcafe', '/storefront.html'), { waitUntil: 'load' }); await pg.waitForTimeout(800);
    await pg.evaluate(async ([e, p]) => { const c = window.supabase.createClient(CFG.url, CFG.key); await c.auth.signInWithPassword({ email: e, password: p }); }, [USERS.cafeOwner, PASSWORD]);
    await pg.goto('about:blank'); await pg.goto(stack.url('testcafe', '/storefront.html#/builder/' + id), { waitUntil: 'load' }); await pg.waitForTimeout(3000);
    await pg.selectOption('#te-add-page-tpl', 'faq'); await pg.locator('[data-action="te-addpage"]').click(); await pg.waitForTimeout(600);
    assert(/FAQ/.test(await pg.locator('#te-page').innerText()), 'FAQ page not listed');
    assert(await pg.locator('.te-item').count() === 4, 'faq sections: ' + await pg.locator('.te-item').count());
    await pg.selectOption('#te-page', 'header'); await pg.waitForTimeout(400);
    await pg.fill('#te-right input[name=announceText]', 'Editor header note'); await pg.waitForTimeout(300);
    await pg.selectOption('#te-page', 'footer'); await pg.waitForTimeout(400);
    await pg.fill('#te-right input[name=note]', 'Editor footer note'); await pg.waitForTimeout(300);
    await pg.locator('[data-action="te-save"]').click(); await pg.waitForTimeout(1500);
    const row = (await q('select draft_content from sfx_theme_installs where id=$1', [id]))[0].draft_content;
    assert(row.header.announceText === 'Editor header note' && row.footer.note === 'Editor footer note' && row.pages.some((p) => p.template === 'faq'), JSON.stringify(row).slice(0, 400));
    assert(!e5.filter((x) => !/sentry|fonts|\/uploads\//i.test(x)).length, e5.slice(0, 3).join(' | ').slice(0, 300));
  }, 'major');
  await s.check('Admin sets a theme price; the store library shows it live and a premium install explains itself', async () => {
    const pg = await ctx.newPage(); await pg.goto(stack.url('testcafe', '/storefront.html'), { waitUntil: 'load' }); await pg.waitForTimeout(500);
    const th = (await q("select id from sfx_themes where slug='kiln-salon'"))[0].id;
    const r = await pg.evaluate(async ([ae, oe, p, id]) => { const c = window.supabase.createClient(CFG.url, CFG.key);
      await c.auth.signInWithPassword({ email: oe, password: p }); const denied = await c.rpc('sfx_admin_theme_price_set', { p_theme_id: id, p_price_cents: 99900 });
      await c.auth.signOut(); await c.auth.signInWithPassword({ email: ae, password: p }); const set = await c.rpc('sfx_admin_theme_price_set', { p_theme_id: id, p_price_cents: 99900 }); const bad = await c.rpc('sfx_admin_theme_price_set', { p_theme_id: id, p_price_cents: -5 });
      await c.auth.signOut(); await c.auth.signInWithPassword({ email: oe, password: p }); const list = await c.rpc('sfx_theme_marketplace_list'); const row = (list.data || []).find((t) => t.id === id);
      await q2(); return { denied: !!denied.error, set: set.error && set.error.message, bad: !!bad.error, price: row && row.priceCents }; function q2() {} }, [USERS.admin, USERS.cafeOwner, PASSWORD, th]);
    assert(r.denied, 'a store owner could set a theme price'); assert(!r.set, r.set); assert(r.bad, 'negative price accepted'); assert(r.price === 99900, 'live price not shown: ' + r.price);
    await q("update sfx_theme_installs set theme_id=theme_id where false"); await q("delete from sfx_theme_installs where theme_id=$1 and tenant_id=(select id from tenants where slug='testcafe')", [th]);
    const inst = await pg.evaluate(async ([oe, p, id]) => { const c = window.supabase.createClient(CFG.url, CFG.key); await c.auth.signInWithPassword({ email: oe, password: p }); const x = await c.rpc('sfx_theme_install', { p_theme_id: id }); return x.error && x.error.message; }, [USERS.cafeOwner, PASSWORD, th]);
    assert(/premium theme/i.test(inst || ''), 'premium install message: ' + inst);
    await q("update sfx_themes set price_cents=0 where id=$1", [th]);
  }, 'major');
}
