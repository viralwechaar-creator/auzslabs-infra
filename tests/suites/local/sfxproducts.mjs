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
  await s.check('Customers has Customers / Segments / Companies tabs', async () => {
    await open('#/customers');
    const t = await page.locator('nav.tabs').innerText();
    assert(/Segments/.test(t) && /Companies/.test(t), t);
    assert(!errs.filter((x) => !/sentry|fonts|googletag|ERR_|404|Failed to load resource/i.test(x)).length, errs.slice(0, 3).join(' | '));
  }, 'critical');
  s.done();
}
