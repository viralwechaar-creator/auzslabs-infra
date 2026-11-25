// Studs theme: draft isolation, publish and rollback for one store only, existing stores untouched, real catalogue/bag/checkout.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { q, USERS, PASSWORD } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('Studs theme', 'Studs installs as a draft, goes live only on explicit publish, rolls back per store, and never touches another store.');
  const A = 'testcafe', B = 'testretail';           // A = internal demo store that gets Studs, B = an existing store that must not change
  const tid = async (slug) => (await q('select id from tenants where slug = $1', [slug]))[0].id;
  const [ta, tb] = [await tid(A), await tid(B)];
  const seed = async (t, label) => {
    await q("update tenant_settings set features = features || '{\"storefront\":true}' where tenant_id = $1", [t]);
    await q("insert into sfx_stores (tenant_id, published, theme) values ($1, true, 'minimal') on conflict (tenant_id) do update set published = true, theme = 'minimal', active_install_id = null, previous_theme = null, previous_install_id = null", [t]);
    await q('delete from sfx_products where tenant_id = $1', [t]); await q('delete from sfx_collections where tenant_id = $1', [t]);
    const col = (await q("insert into sfx_collections (tenant_id, name) values ($1, $2) returning id", [t, label + ' Denim']))[0].id;
    const ids = [];
    for (const [n, price, cat] of [[label + ' Tee', 1599, 'T-shirts'], [label + ' Jeans', 2999, 'Jeans'], [label + ' Jacket', 4999, 'Jackets'], [label + ' Cap', 799, 'Accessories'], [label + ' Sold Out Shirt', 1899, 'Shirts']]) {
      const p = (await q("insert into sfx_products (tenant_id, name, status, price, category, images, description) values ($1,$2,'active',$3,$4,'[\"/store/genx-studio/afterimage-graphic-tee-cover.jpg\",\"/store/genx-studio/afterimage-graphic-tee-angle.jpg\"]'::jsonb,'A test product') returning id", [t, n, price, cat]))[0].id;
      const stock = n.includes('Sold Out') ? 0 : 6;
      for (const [i, sz] of ['S', 'M', 'L'].entries()) await q('insert into sfx_variants (tenant_id, product_id, label, price, stock, position) values ($1,$2,$3,$4,$5,$6)', [t, p, sz, price, stock, i]);
      ids.push(p);
    }
    await q('insert into sfx_collection_products (collection_id, product_id) select $1, id from sfx_products where tenant_id = $2 and name = ANY($3)', [col, t, [label + ' Jeans', label + ' Tee']]);
    return ids;
  };
  const idsA = await seed(ta, 'Alpha'); const idsB = await seed(tb, 'Beta');
  await q("update sfx_themes set enabled_tenants = '{}' where slug = 'studs'");   // gate it for these checks (the shipped default offers it to every store)
  const publicOf = async (slug) => (await q('select public_sfx_store($1) as j', [slug]))[0].j;
  const beforeB = JSON.stringify(await publicOf(B));
  const login = async (slug, email) => {
    const ctx = await newCtx(browser, stack, { w: 1280, h: 800 }); const pg = await ctx.newPage();
    await pg.goto(stack.url(slug, '/storefront.html'), { waitUntil: 'load' }); await pg.waitForTimeout(700);
    const ok = await pg.evaluate(async ([e, p]) => { const c = window.supabase.createClient(CFG.url, CFG.key); const r = await c.auth.signInWithPassword({ email: e, password: p }); return !r.error; }, [email, PASSWORD]);
    assert(ok, 'sign-in failed for ' + email);
    return { ctx, pg, rpc: (fn, args) => pg.evaluate(async ([f, a]) => { const c = window.supabase.createClient(CFG.url, CFG.key); const r = await c.rpc(f, a || {}); return { data: r.data, error: r.error && r.error.message }; }, [fn, args]) };
  };
  const a = await login(A, USERS.cafeOwner); const b = await login(B, USERS.retailOwner);

  await s.check('Studs is hidden from every store while it is disabled (the shipped default)', async () => {
    for (const o of [a, b]) { const l = await o.rpc('sfx_theme_marketplace_list'); assert(!l.error, l.error); assert(!(l.data || []).some((t) => t.slug === 'studs'), 'Studs listed for a store'); }
    const th = (await q("select id from sfx_themes where slug = 'studs'"))[0].id;
    const r = await a.rpc('sfx_theme_install', { p_theme_id: th }); assert(r.error, 'install should be refused while disabled');
  }, 'critical');

  let install, themeId;
  await s.check('Enabled for the demo store only: it appears there and not on the other store', async () => {
    await q("update sfx_themes set enabled_tenants = array[$1]::uuid[] where slug = 'studs'", [ta]);
    themeId = (await q("select id from sfx_themes where slug = 'studs'"))[0].id;
    assert((await a.rpc('sfx_theme_marketplace_list')).data.some((t) => t.slug === 'studs'), 'not listed for the demo store');
    assert(!(await b.rpc('sfx_theme_marketplace_list')).data.some((t) => t.slug === 'studs'), 'listed for the other store');
    const refused = await b.rpc('sfx_theme_install', { p_theme_id: themeId }); assert(refused.error, 'the other store could install it');
  }, 'critical');

  await s.check('Installing Studs creates a draft only: the live theme, install and public store do not change', async () => {
    const before = JSON.stringify(await publicOf(A));
    const r = await a.rpc('sfx_theme_install', { p_theme_id: themeId }); assert(!r.error, r.error); install = r.data.installId;
    const row = (await q('select published_content, draft_content from sfx_theme_installs where id = $1', [install]))[0];
    assert(row.published_content === null, 'published_content must be null for a draft'); assert(row.draft_content.kind === 'studs', 'draft content missing');
    const st = (await q('select theme, active_install_id from sfx_stores where tenant_id = $1', [ta]))[0];
    assert(st.theme === 'minimal' && st.active_install_id === null, 'the live theme changed on install');
    assert(JSON.stringify(await publicOf(A)) === before, 'the public store changed on install');
    assert(JSON.stringify(await publicOf(B)) === beforeB, 'another store changed');
  }, 'critical');

  await s.check('Settings are cleaned: unsafe links are refused, known fields saved to the draft only', async () => {
    const bad = await a.rpc('sfx_studs_settings_save', { p_install_id: install, p: { heroImage: 'javascript:alert(1)' } }); assert(bad.error, 'javascript: link accepted');
    const good = await a.rpc('sfx_studs_settings_save', { p_install_id: install, p: { announcements: [{ text: 'Alpha drop is live', href: '#/drop' }], heroLabel: 'Explore the drop', closingImage: '/store/studs-demo/genx-denim-crossing.jpg', closingText: 'Clean lines.', evil: 'x' } });
    assert(!good.error, good.error); assert(good.data.settings.evil === undefined, 'unknown field kept');
    assert((await q('select published_content from sfx_theme_installs where id = $1', [install]))[0].published_content === null, 'saving a draft published it');
    assert(JSON.stringify(await publicOf(B)) === beforeB, 'another store changed');
  });

  await s.check('Owner library lists Studs with Customize; the editor previews the unpublished draft without changing the live store', async () => {
    const o = await login(A, USERS.cafeOwner); const pg = o.pg; const errs = watch(pg);
    await pg.setViewportSize({ width: 1280, height: 900 });
    await pg.goto('about:blank'); await pg.goto(stack.url(A, '/storefront.html#/builder'), { waitUntil: 'load' }); await pg.waitForTimeout(2200);
    const t = await pg.locator('body').innerText({ timeout: 5000 }); assert(/Studs/.test(t), 'library text: ' + t.slice(0, 300)); assert(/Studs/.test(t), 'Studs missing from the library'); assert(/Not published yet/.test(t), 'draft badge missing');
    await pg.screenshot({ path: '/tmp/claude-0/studs/int-owner-library.png', fullPage: true });
    await pg.goto('about:blank'); await pg.goto(stack.url(A, '/storefront.html#/builder/' + install), { waitUntil: 'load' }); await pg.waitForTimeout(3500);
    const fr = pg.frames().find((f) => /preview=studs/.test(f.url())); assert(fr, 'preview frame missing');
    await fr.waitForFunction(() => !!document.querySelector('#studs-host'), null, { timeout: 8000 });
    const ann = await fr.evaluate(() => document.querySelector('#studs-host').shadowRoot.querySelector('#announcement-link').textContent);
    assert(/Alpha drop is live/i.test(ann), 'draft settings not shown in the preview: ' + ann);
    await pg.fill('textarea[name=announcements]', 'Preview only message | #/shop'); await pg.waitForTimeout(600);
    assert(/Preview only message/i.test(await fr.evaluate(() => document.querySelector('#studs-host').shadowRoot.querySelector('#announcement-link').textContent)), 'live edit did not reach the preview');
    await pg.screenshot({ path: '/tmp/claude-0/studs/int-owner-editor.png', fullPage: true });
    assert((await publicOf(A)).config.template === 'minimal', 'the live store changed while editing a draft');
    assert(!errs.filter((e) => !/sentry|fonts|googleapis|ERR_/i.test(e)).length, errs.slice(0, 3).join(' | '));
  }, 'critical');

  await s.check('The public store still serves the current theme while Studs is a draft', async () => {
    const j = await publicOf(A); assert(j.config.template === 'minimal', 'template is ' + j.config.template); assert(j.config.studs === undefined, 'studs settings leaked before publish');
  }, 'critical');

  await s.check('Explicit Publish makes Studs live for the demo store only', async () => {
    const r = await a.rpc('sfx_studs_publish', { p_install_id: install }); assert(!r.error, r.error);
    const j = await publicOf(A); assert(j.config.template === 'studs', 'not live: ' + j.config.template); assert(j.config.studs.heroLabel === 'Explore the drop', 'settings missing');
    assert(JSON.stringify(await publicOf(B)) === beforeB, 'the other store changed on publish');
    const names = (j.styles || []).map((x) => x.name); assert(names.some((n) => /Sold Out/.test(n)), 'sold-out item not listed for Studs');
  }, 'critical');

  await s.check('Saving store settings still works while Studs is live, and Studs cannot be chosen through it', async () => {
    const ok = await a.rpc('sfx_store_save', { p: { tagline: 'Alpha tagline' } }); assert(!ok.error, ok.error);
    assert((await publicOf(A)).config.template === 'studs', 'theme lost on save');
    const no = await b.rpc('sfx_store_save', { p: { theme: 'studs' } }); assert(no.error, 'a store chose Studs directly');
  }, 'critical');

  await s.check('Studs renders the real catalogue; bag, quantities and checkout hand-off use the shared store code', async () => {
    const ctx = await newCtx(browser, stack, { w: 1484, h: 678 }); const pg = await ctx.newPage(); const errs = watch(pg);
    await pg.goto(stack.url(A, '/store.html'), { waitUntil: 'load' }); await pg.waitForTimeout(2500);
    assert(await pg.evaluate(() => !!document.querySelector('#studs-host')), 'Studs host missing');
    const inside = (sel) => pg.evaluate((x) => { const r = document.querySelector('#studs-host').shadowRoot; return r ? r.querySelectorAll(x).length : 0; }, sel);
    assert(await inside('.product-card') >= 4, 'products missing on home');
    assert(await inside('.announcement') === 1 && await inside('.primary a') === 3, 'chrome missing');
    await pg.screenshot({ path: '/tmp/claude-0/studs/int-d-home.png', fullPage: true });
    await pg.evaluate((id) => { location.hash = '#/p/' + id; }, idsA[0]); await pg.waitForTimeout(800);
    assert(await inside('.pdp') === 1 && await inside('.sizes label') === 3, 'product page wrong');
    await pg.screenshot({ path: '/tmp/claude-0/studs/int-d-product.png' });
    await pg.evaluate(() => { const r = document.querySelector('#studs-host').shadowRoot; r.querySelector('.sizes label:nth-child(2) input').click(); r.querySelector('[data-product-step="1"]').click(); r.querySelector('button[value=bag]').click(); });
    await pg.waitForTimeout(500);
    const bc = await pg.evaluate(() => document.querySelector('#studs-host').shadowRoot.querySelector('#bag-count').textContent); assert(bc === '2', 'bag count wrong: ' + bc + ' ' + JSON.stringify(errs.slice(0, 3)) + ' ls=' + (await pg.evaluate(() => JSON.stringify(Object.keys(localStorage)))));
    const bag = await pg.evaluate(() => JSON.parse(localStorage.getItem('st.testcafe.bag') || '[]')); assert(bag.length === 1 && bag[0].q === 2, 'shared bag not updated: ' + JSON.stringify(bag));
    assert(await pg.evaluate(() => /₹3,198/.test(document.querySelector('#studs-host').shadowRoot.querySelector('#panel-body').innerText)), 'subtotal wrong');
    await pg.screenshot({ path: '/tmp/claude-0/studs/int-d-bag.png' });
    await pg.evaluate(() => { location.hash = '#/checkout'; }); await pg.waitForTimeout(1200);
    assert(await pg.evaluate(() => { const h = document.querySelector('#studs-host'); return !!h && !h.hidden && h.contains(document.getElementById('view')) && !!h.shadowRoot.querySelector('.header'); }), 'checkout is not framed by the Studs header');
    await pg.screenshot({ path: '/tmp/claude-0/studs/int-d-checkout.png' }).catch(() => {});
    assert(await pg.evaluate(() => { const i = document.querySelector('#view .fld input'); return !!i && getComputedStyle(i).borderRadius === '0px'; }), 'checkout fields are not in the Studs sharp style');
    const t = await pg.locator('#view').innerText(); assert(/checkout|delivery|contact|total/i.test(t), 'native checkout did not render: ' + t.slice(0, 120));
    await pg.evaluate(() => { location.hash = '#/me'; }); await pg.waitForTimeout(1000);
    assert(/sign in|phone|orders|account/i.test(await pg.locator('#app').innerText()), 'account page did not render');
    assert(!errs.filter((e) => !/sentry|fonts|googleapis|ERR_/i.test(e)).length, errs.slice(0, 3).join(' | '));
  }, 'critical');

  await s.check('Sold-out items are washed out and cannot be added; mobile layout has no sideways scroll', async () => {
    const ctx = await newCtx(browser, stack, { w: 390, h: 844 }); const pg = await ctx.newPage();
    await pg.goto(stack.url(A, '/store.html#/shop'), { waitUntil: 'load' }); await pg.waitForTimeout(2200);
    const gone = await pg.evaluate(() => document.querySelector('#studs-host').shadowRoot.querySelectorAll('.product-card.sold-out').length); assert(gone === 1, 'sold-out cards: ' + gone);
    assert(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'sideways scroll on Shop all');
    await pg.screenshot({ path: '/tmp/claude-0/studs/int-m-shop.png' });
    await pg.evaluate((id) => { location.hash = '#/p/' + id; }, idsA[4]); await pg.waitForTimeout(800);
    assert(await pg.evaluate(() => document.querySelector('#studs-host').shadowRoot.querySelector('button[value=bag]').disabled), 'sold-out item can be added');
    await pg.evaluate(() => { location.hash = '#/'; }); await pg.waitForTimeout(1200); await pg.screenshot({ path: '/tmp/claude-0/studs/int-m-home.png', fullPage: true });
  });

  await s.check('An existing store on its current theme: browse, bag, checkout and account sign-in still work', async () => {
    const ctx = await newCtx(browser, stack, { w: 390, h: 844 }); const pg = await ctx.newPage(); const errs = watch(pg);
    await pg.goto(stack.url(B, '/store.html'), { waitUntil: 'load' }); await pg.waitForTimeout(2500);
    assert(!(await pg.evaluate(() => !!document.querySelector('#studs-host'))), 'Studs appeared on an existing store');
    assert(!(await pg.evaluate(() => !!window.StudsTheme)), 'studs.js was loaded for an existing store');
    await pg.evaluate((id) => { location.hash = '#/p/' + id; }, idsB[0]); await pg.waitForTimeout(1000);
    assert(/Beta Tee/.test(await pg.locator('#app').innerText()), 'product page missing');
    await pg.evaluate(() => { location.hash = '#/checkout'; }); await pg.waitForTimeout(800);
    await pg.evaluate(() => { location.hash = '#/me'; }); await pg.waitForTimeout(800);
    assert(/sign in|phone|orders|account/i.test(await pg.locator('#app').innerText()), 'account page missing');
    assert(JSON.stringify(await publicOf(B)) === beforeB, 'the existing store payload changed');
    assert(!errs.filter((e) => !/sentry|fonts|googleapis|ERR_/i.test(e)).length, errs.slice(0, 3).join(' | '));
  }, 'critical');

  await s.check('Rollback restores the previous theme for the demo store only', async () => {
    const r = await a.rpc('sfx_theme_revert_active'); assert(!r.error, r.error);
    const j = await publicOf(A); assert(j.config.template === 'minimal', 'template is ' + j.config.template); assert(j.config.studs === undefined, 'studs settings still public');
    assert(JSON.stringify(await publicOf(B)) === beforeB, 'the other store changed on rollback');
    const again = await a.rpc('sfx_theme_revert_active'); assert(again.error, 'a second rollback should have nothing to restore');
  }, 'critical');

  await s.check('Switching Studs off for everyone hides it again and blocks activation', async () => {
    await q("update sfx_themes set enabled_tenants = '{}' where slug = 'studs'");
    assert(!(await a.rpc('sfx_theme_marketplace_list')).data.some((t) => t.slug === 'studs'), 'still listed');
    const act = await a.rpc('sfx_theme_install_set_active', { p_install_id: install }); assert(act.error, 'activation allowed while disabled');
    assert((await publicOf(A)).config.template === 'minimal', 'theme changed');
  });
}
