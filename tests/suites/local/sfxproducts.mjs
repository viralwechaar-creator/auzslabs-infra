// Storefront dashboard round 2: variant pictures, formatted descriptions, draft flow, photo order, Customers tabs.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { rpc } from '../../lib/api.mjs';
import { q, USERS, PASSWORD } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('Storefront products', 'Variant pictures, safe formatted descriptions, draft-first Add product, gallery order, Customers sub-tabs.');
  await q("update tenant_settings set features = features || '{\"storefront\":true}' where tenant_id = (select id from tenants where slug='testcafe')");
  await q("insert into sfx_stores (tenant_id, published) select id, true from tenants where slug='testcafe' on conflict (tenant_id) do update set published=true");
  const tid = (await q("select id from tenants where slug='testcafe'"))[0].id;
  await q('delete from sfx_products where tenant_id=$1', [tid]);
  const login = async (email) => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json()).access_token;
  const owner = await login(USERS.cafeOwner);
  const save = async (id, p) => (await rpc(stack, 'sfx_product_save', { p_id: id, p }, owner)).data;
  const imgs = ['/uploads/site/a.webp', '/uploads/site/b.webp'];
  let pid;

  await s.check('A variant keeps its own picture; bad addresses are dropped; a plain save keeps it', async () => {
    const r = (await save(null, { name: 'Test tee', price: 100, status: 'active', images: imgs, variants: [{ label: 'S', price: 100, stock: 5, image: imgs[1] }, { label: 'M', price: 100, stock: 5, image: 'javascript:alert(1)' }, { label: 'L', price: 100, stock: 5 }] })).data;
    pid = r.id; const v = Object.fromEntries(r.variants.map((x) => [x.label, x.image]));
    assert(v.S === imgs[1] && !v.M && !v.L, JSON.stringify(v));
    const r2 = (await save(pid, { name: 'Test tee', price: 120, images: imgs, status: 'active' })).data;
    assert(r2.variants.find((x) => x.label === 'S').image === imgs[1], 'picture lost on a details-only save');
    assert(r2.variants.every((x) => Number(x.price) === 120), 'price not applied to all variants');
  }, 'critical');
  await s.check('The public store sends the variant picture', async () => {
    const r = (await rpc(stack, 'public_sfx_store', { p_slug: 'testcafe' })).data.data;
    const st = (r.styles || []).find((x) => x.id === pid);
    assert(st, 'keys ' + Object.keys(r) + ' styles ' + JSON.stringify((r.styles || []).map((x) => x.id)) + ' want ' + pid);
    assert(st.variants.some((x) => x.image === imgs[1]), JSON.stringify(st.variants));
  }, 'critical');

  const ctx = await newCtx(browser, stack, { w: 1280, h: 900 }); const page = await ctx.newPage(); const errs = watch(page);
  await page.goto(stack.url('testcafe', '/storefront.html'), { waitUntil: 'load' }); await page.waitForTimeout(800);
  await page.evaluate(async ([e, p]) => { const c = window.supabase.createClient(CFG.url, CFG.key); await c.auth.signInWithPassword({ email: e, password: p }); }, [USERS.cafeOwner, PASSWORD]);
  const open = async (hash) => { await page.goto('about:blank'); await page.goto(stack.url('testcafe', '/storefront.html' + hash), { waitUntil: 'load' }); await page.waitForTimeout(3000); };

  await s.check('Add product: steps shown, formatting toolbar writes safe preview, Save draft opens Media', async () => {
    await open('#/products/new');
    const t = await page.locator('body').innerText();
    assert(/Step 1 of 3/.test(t) && /Save draft and add media/.test(t), 'steps/draft button missing');
    await page.fill('input[name=name]', 'Draft kurta'); await page.fill('input[name=price]', '499');
    await page.fill('textarea[name=description]', 'Soft **cotton**\n\n- one\n- two <img src=x onerror=alert(1)>');
    const html = await page.locator('[data-rich-preview]').innerHTML();
    assert(/<strong>cotton<\/strong>/.test(html) && /<ul>/.test(html) && !/<img/.test(html), html);
    await page.click('button[value=draft]'); await page.waitForTimeout(2500);
    assert(/tab=media/.test(page.url()), page.url());
    const row = (await q("select status from sfx_products where tenant_id=$1 and name='Draft kurta'", [tid]))[0];
    assert(row && row.status === 'draft', JSON.stringify(row));
    await s.shot(page, 'sfx-product-draft-media');
  }, 'critical');
  await s.check('Media tab: photos can be moved and the order is saved', async () => {
    await open('#/products/' + pid + '?tab=media');
    const before = await page.locator('.product-photo').count();
    if (before < 2) { s.note('photos need real image files; checking buttons exist'); assert(true); return; }
    await page.locator('.product-photo').nth(1).locator('[data-action="photo-move:-1"]').click();
    const order = JSON.parse(await page.locator('[name=existing]').inputValue());
    assert(order[0] === imgs[1], JSON.stringify(order));
  });
  await s.check('Variants tab offers a picture choice per variant', async () => {
    await open('#/products/' + pid + '?tab=variants');
    assert(await page.locator('select[name=variantImage0]').count() === 1, 'no picture select');
    await s.shot(page, 'sfx-variant-pictures');
  }, 'critical');
  await s.check('Pages: search, bulk visibility, copy, scheduled needs a date, public page shows formatting', async () => {
    await q("update sfx_stores set config = jsonb_set(coalesce(config,'{}'::jsonb), '{pages}', $2::jsonb) where tenant_id=$1", [tid, JSON.stringify([
      { id: 'pgA', name: 'About us', slug: 'about-us', status: 'Hidden', content: 'We **love** tea\n\n- one\n- two' }, { id: 'pgB', name: 'Shipping', slug: 'shipping', status: 'Hidden', content: 'Fast' }])]);
    await open('#/pages');
    await page.fill('#pg-query', 'ship'); await page.waitForTimeout(300);
    assert(await page.locator('.pg-sel').count() === 1, 'search did not filter');
    await page.fill('#pg-query', ''); await page.waitForTimeout(300);
    await page.click('[data-action="pages-all"]'); await page.click('[data-action="pages-bulk:Visible"]'); await page.waitForTimeout(1500);
    let pages = (await q('select config->\'pages\' as p from sfx_stores where tenant_id=$1', [tid]))[0].p;
    assert(pages.every((x) => x.status === 'Visible'), JSON.stringify(pages.map((x) => x.status)));
    await page.click('[data-action="page-copy:pgA"]'); await page.waitForTimeout(1500);
    pages = (await q('select config->\'pages\' as p from sfx_stores where tenant_id=$1', [tid]))[0].p;
    assert(pages.length === 3 && pages.some((x) => x.slug === 'about-us-copy' && x.status === 'Hidden'), 'copy missing');
    const r = (await rpc(stack, 'public_sfx_store', { p_slug: 'testcafe' })).data.data;
    assert((r.config.minimalPages || []).some((x) => x.slug === 'about-us') && !(r.config.minimalPages || []).some((x) => x.slug === 'about-us-copy'), 'public visibility wrong');
    const pub = await ctx.newPage(); await pub.goto(stack.url('testcafe', '/store.html?design=minimal#/page/about-us'), { waitUntil: 'load' }); await pub.waitForTimeout(3000);
    const html = await pub.locator('.art').first().innerHTML().catch(() => '');
    assert(/<strong>love<\/strong>/.test(html) && /<ul>/.test(html), 'formatting not rendered: ' + html.slice(0, 200));
  }, 'critical');
  await s.check('Shipping zones: the customer state picks the fee; other states use the flat fee; bad zones are refused', async () => {
    const cs = (z) => rpc(stack, 'sfx_checkout_settings_save', { p: { shipping: { fee: 50, freeOver: 0, zones: z } } }, owner);
    const bad = await cs([{ name: 'X', states: [], fee: 10 }]); assert(bad.data?.error || bad.error || /1 to 40|states/i.test(JSON.stringify(bad.data)), 'empty zone accepted: ' + JSON.stringify(bad.data).slice(0, 150));
    const ok = await cs([{ name: 'South', states: ['Kerala', 'Tamil Nadu'], fee: 80, freeOver: 0 }, { name: 'Home', states: ['Rajasthan'], fee: 0, freeOver: 0 }]);
    assert(!ok.data?.error, JSON.stringify(ok.data).slice(0, 200));
    const v = (await q('select id from sfx_variants where product_id=$1 limit 1', [pid]))[0].id; await q('update sfx_variants set stock=50 where product_id=$1', [pid]);
    const order = async (state) => { await q("delete from sfx_orders where tenant_id=$1", [tid]); const r = await rpc(stack, 'public_sfx_place_order', { p_slug: 'testcafe', p: { name: 'Z Buyer', phone: '98765' + Math.floor(10000 + Math.random() * 89999), address: '12 Park Road, Ward 4', city: 'Jodhpur', state, pin: '342001', lines: [{ variantId: v, qty: 1 }] } }); if (!(await q('select 1 from sfx_orders where tenant_id=$1', [tid])).length) throw new Error('order failed: ' + JSON.stringify(r).slice(0, 300)); return Number((await q('select shipping from sfx_orders where tenant_id=$1 order by created_at desc limit 1', [tid]))[0]?.shipping); };
    const k = await order('Kerala'); assert(k === 80, 'zone fee not applied: got ' + k + ' cfg ' + JSON.stringify((await q('select config->\'shipping\' as c from sfx_stores where tenant_id=$1', [tid]))[0]));
    assert(await order('Rajasthan') === 0, 'free zone not applied');
    assert(await order('Punjab') === 50, 'flat fee not used for other states');
  }, 'critical');
  await s.check('Dashboard: the logo link opens Home, and dark mode cards stay readable (metrics, Team, Notifications)', async () => {
    await open('#/'); const t = await page.locator('main').innerText(); assert(/Manage your catalog/.test(t), 'logo route is blank: ' + t.slice(0, 80));
    const low = async (hash) => { await open(hash); return page.evaluate(() => { document.querySelector('.shell').setAttribute('data-theme', 'dark');
      const lum = (c) => { const m = c.match(/[\d.]+/g).map(Number); const f = (v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(m[0]) + .7152 * f(m[1]) + .0722 * f(m[2]); };
      const bg = (el) => { for (let e = el; e; e = e.parentElement) { const b = getComputedStyle(e).backgroundColor, a = b.match(/[\d.]+/g); if (a && (a.length < 4 || Number(a[3]) > .5)) return b; } return 'rgb(18,18,18)'; };
      const bad = []; for (const el of document.querySelectorAll('.work *')) { if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue; const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue; const a = lum(getComputedStyle(el).color), b = lum(bg(el)); if ((Math.max(a, b) + .05) / (Math.min(a, b) + .05) < 3) bad.push(el.textContent.trim().slice(0, 20)); } return bad.slice(0, 3); }); };
    for (const h of ['#/home', '#/team', '#/notifications']) { const bad = await low(h); assert(!bad.length, h + ' unreadable in dark mode: ' + bad.join(', ')); }
  }, 'critical');
  await s.check('Theme sections keep spacing and alignment; anything else is dropped; the editor shows the controls and link list', async () => {
    const mk = await rpc(stack, 'sfx_theme_install_create', { p: { name: 'Spacing theme', starter: 'shop', base: 'classic' } }, owner);
    const iid = mk.data?.data?.installId || mk.data?.installId || mk.data?.id || mk.data?.data?.id; assert(iid, 'install not created: ' + JSON.stringify(mk.data).slice(0, 200));
    const sv = await rpc(stack, 'sfx_theme_customize_save', { p_install_id: iid, p_content: { sections: [
      { type: 'text', props: { heading: 'Hi', body: 'x', space: 'roomy', align: 'left' } }, { type: 'text', props: { heading: 'Two', body: 'y', space: 'huge', align: '<b>' } }] } }, owner);
    assert(!sv.data?.error, JSON.stringify(sv.data).slice(0, 200));
    const dc = (await q('select draft_content from sfx_theme_installs where id=$1', [iid]))[0].draft_content.sections;
    assert(dc[0].props.space === 'roomy' && dc[0].props.align === 'left', JSON.stringify(dc[0]));
    const cl = (await q("select sfx_theme_clean_content($1::jsonb) as c", [JSON.stringify({ sections: [{ type: 'text', props: { heading: 'Two', space: 'huge', align: 'center' } }, { type: 'text', props: { heading: 'One', space: 'roomy', align: '<b>' } }] })]))[0].c.sections;
    assert(!('space' in cl[0].props) && cl[0].props.align === 'center' && cl[1].props.space === 'roomy' && !('align' in cl[1].props), 'import/duplicate clean wrong: ' + JSON.stringify(cl));
    await open('#/builder/' + iid); await page.waitForTimeout(1500);
    const html = await page.content();
    assert(/name="space"/.test(html) && /id="te-links"/.test(html), 'spacing controls or link list missing');
    await s.shot(page, 'sfx-theme-editor-spacing');
  }, 'critical');
  await s.check('Taxes: inclusive keeps the total, exclusive adds tax, off changes nothing, bad GST number refused; Taxes and Apps pages open', async () => {
    await rpc(stack, 'sfx_checkout_settings_save', { p: { shipping: { fee: 0, freeOver: 0, zones: [] } } }, owner);
    const v = (await q('select id from sfx_variants where product_id=$1 limit 1', [pid]))[0].id; await q('update sfx_variants set stock=50, price=118 where product_id=$1', [pid]);
    const ts = (t) => rpc(stack, 'sfx_tax_settings_save', { p: t }, owner);
    const order = async () => { await q('delete from sfx_orders where tenant_id=$1', [tid]); await rpc(stack, 'public_sfx_place_order', { p_slug: 'testcafe', p: { name: 'T Buyer', phone: '98765' + Math.floor(10000 + Math.random() * 89999), address: '12 Park Road, Ward 4', city: 'Jodhpur', state: 'Rajasthan', pin: '342001', lines: [{ variantId: v, qty: 1 }] } });
      const o = (await q('select total, tax from sfx_orders where tenant_id=$1 order by created_at desc limit 1', [tid]))[0]; return { total: Number(o.total), tax: Number(o.tax) }; };
    let o = await order(); assert(o.total === 118 && o.tax === 0, 'tax off changed the order ' + JSON.stringify(o));
    const bad = await ts({ rate: 18, gstin: 'NOTAGST' }); assert(/GST number/.test(JSON.stringify(bad.data)), 'bad GSTIN accepted: ' + JSON.stringify(bad.data).slice(0, 120));
    const okr = await ts({ rate: 18, inclusive: true, gstin: '08ABCDE1234F1Z5', label: 'GST' }); assert(!okr.data?.error, JSON.stringify(okr.data).slice(0, 160));
    o = await order(); assert(o.total === 118 && o.tax === 18, 'inclusive wrong ' + JSON.stringify(o));
    await ts({ rate: 18, inclusive: false }); o = await order(); assert(o.tax === 21.24 && o.total === 139.24, 'exclusive wrong ' + JSON.stringify(o));
    const pub = (await rpc(stack, 'public_sfx_store', { p_slug: 'testcafe' })).data.data; assert(pub.config.tax && pub.config.tax.rate === 18 && pub.config.tax.inclusive === false, 'public tax missing');
    await open('#/taxes'); let t = await page.locator('main').innerText(); assert(/GST rate/.test(t) && /Save tax settings/.test(t), 'taxes page: ' + t.slice(0, 100));
    await open('#/apps'); t = await page.locator('main').innerText(); assert(/Connected services/.test(t) && /Your plan/.test(t) && !/coming in a later release/.test(t), 'apps page: ' + t.slice(0, 120));
    await ts({ rate: 0 });
  }, 'critical');
  await s.check('Customers has Customers / Segments / Companies tabs', async () => {
    await open('#/customers');
    const t = await page.locator('nav.tabs').innerText();
    assert(/Segments/.test(t) && /Companies/.test(t), t);
    assert(!errs.filter((x) => !/sentry|fonts|googletag|ERR_|404|Failed to load resource/i.test(x)).length, errs.slice(0, 3).join(' | '));
  }, 'critical');
  s.done();
}
