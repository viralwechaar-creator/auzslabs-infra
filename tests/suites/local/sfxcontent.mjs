// Storefront round A: order lifecycle. Fulfilment, delivery and payment are separate states; shipments are records.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { rpc } from '../../lib/api.mjs';
import { q, USERS, PASSWORD } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('Storefront content tools', 'Redirects, blog, SEO, store revisions, custom data.');
  await q("update tenant_settings set features = features || '{\"storefront\":true}' where tenant_id = (select id from tenants where slug='testcafe')");
  await q("insert into sfx_stores (tenant_id, published) select id, true from tenants where slug='testcafe' on conflict (tenant_id) do update set published=true");
  const tid = (await q("select id from tenants where slug='testcafe'"))[0].id;
  await q('delete from sfx_orders where tenant_id=$1', [tid]); await q('delete from sfx_products where tenant_id=$1', [tid]);
  const login = async (email) => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json()).access_token;
  const owner = await login(USERS.cafeOwner);
  const call = async (fn, args) => (await rpc(stack, fn, args, owner)).data;
  const pr = (await call('sfx_product_save', { p_id: null, p: { name: 'Content tee', price: 100, status: 'active', variants: [{ label: 'S', price: 100, stock: 10 }, { label: 'M', price: 100, stock: 10 }] } })).data;
  const [vs, vm] = pr.variants.map((v) => v.id);
  const place = async () => {
    await rpc(stack, 'public_sfx_place_order', { p_slug: 'testcafe', p: { name: 'Ship Buyer', phone: '98765' + Math.floor(10000 + Math.random() * 89999), address: '12 Park Road, Ward 4', city: 'Jodhpur', state: 'Rajasthan', pin: '342001', lines: [{ variantId: vs, qty: 2 }, { variantId: vm, qty: 1 }] } });
    return (await q('select id from sfx_orders where tenant_id=$1 order by created_at desc limit 1', [tid]))[0].id;
  };
  const unwrap = (r) => (Array.isArray(r) ? r : r?.data ?? r);
  const err = async (fn, args, tok = owner) => JSON.stringify((await rpc(stack, fn, args, tok)).data).toLowerCase();
  const pub = async (fn, args) => unwrap((await rpc(stack, fn, args)).data);
  const none = (x) => x === null || x === undefined || x?.data === null;
  await q('delete from sfx_redirects where tenant_id=$1', [tid]);

  await s.check('Changing a product address leaves a redirect, and chains stay one hop', async () => {
    await q("update sfx_products set handle='content-tee' where id=$1", [pr.id]);
    await q("update sfx_products set handle='content-tee-v2' where id=$1", [pr.id]);
    await q("update sfx_products set handle='content-tee-v3' where id=$1", [pr.id]);
    const r = await pub('public_sfx_redirect', { p_slug: 'testcafe', p_path: '/products/content-tee' });
    assert(r.to === '/products/content-tee-v3', JSON.stringify(r));
    const n = (await q('select count(*)::int n from sfx_redirects where tenant_id=$1 and auto', [tid]))[0].n;
    assert(n === 2, 'expected 2 redirects, got ' + n);
    await q("update sfx_products set handle='content-tee' where id=$1", [pr.id]);
    assert(none(await pub('public_sfx_redirect', { p_slug: 'testcafe', p_path: '/products/content-tee' })), 'live address still redirects away');
  }, 'critical');
  await s.check('Manual redirects reject loops, bad paths and duplicates', async () => {
    const ok = unwrap(await call('sfx_redirect_save', { p_id: null, p: { from: '/old-offer', to: '/collections/sale' } }));
    assert(ok.id, JSON.stringify(ok));
    assert(/loop/.test(await err('sfx_redirect_save', { p_id: null, p: { from: '/collections/sale', to: '/old-offer' } })), 'loop saved');
    assert(/must start with/.test(await err('sfx_redirect_save', { p_id: null, p: { from: 'old', to: '/x' } })), 'bad path saved');
    assert(/already a redirect/.test(await err('sfx_redirect_save', { p_id: null, p: { from: '/old-offer', to: '/other' } })), 'duplicate saved');
    assert(/start with/.test(await err('sfx_redirect_save', { p_id: null, p: { from: '/a-page', to: 'javascript:alert(1)' } })), 'script address saved');
  }, 'critical');
  await s.check('Blog: only published posts are public, handles are clean, changing one redirects', async () => {
    const d = unwrap(await call('sfx_blog_save', { p_id: null, p: { title: 'Our First Post!', body: 'Hello', status: 'draft', tags: ['News', 'news', 'Care'] } }));
    assert(d.handle === 'our-first-post' && d.tags.length === 2, JSON.stringify(d));
    assert(none(await pub('public_sfx_blog_post', { p_slug: 'testcafe', p_handle: 'our-first-post' })), 'draft is public');
    assert((await pub('public_sfx_blog_list', { p_slug: 'testcafe' })).length === 0, 'draft in public list');
    const p = unwrap(await call('sfx_blog_save', { p_id: d.id, p: { title: 'Our First Post!', body: 'Hello', status: 'published', handle: 'hello-world' } }));
    assert(p.status === 'published' && p.publishedAt, JSON.stringify(p));
    const got = await pub('public_sfx_blog_post', { p_slug: 'testcafe', p_handle: 'hello-world' });
    assert(got.body === 'Hello' && got.seoTitle === 'Our First Post!', JSON.stringify(got));
    assert((await pub('public_sfx_redirect', { p_slug: 'testcafe', p_path: '/blog/our-first-post' })).to === '/blog/hello-world', 'blog handle change did not redirect');
    assert(/title/.test(await err('sfx_blog_save', { p_id: null, p: { title: 'x' } })), 'one-letter title saved');
  }, 'critical');
  await s.check('SEO fields save with length limits and fall back to the product name', async () => {
    await call('sfx_seo_save', { p_kind: 'product', p_id: pr.id, p: { title: 'Buy the tee', description: 'Soft cotton tee' } });
    const seo = await pub('public_sfx_seo', { p_slug: 'testcafe', p_kind: 'product', p_handle: 'content-tee' });
    assert(seo.title === 'Buy the tee' && seo.description === 'Soft cotton tee', JSON.stringify(seo));
    await call('sfx_seo_save', { p_kind: 'product', p_id: pr.id, p: {} });
    assert((await pub('public_sfx_seo', { p_slug: 'testcafe', p_kind: 'product', p_handle: 'content-tee' })).title === (await q('select name from sfx_products where id=$1', [pr.id]))[0].name, 'no fallback to name');
    assert(/70 characters/.test(await err('sfx_seo_save', { p_kind: 'product', p_id: pr.id, p: { title: 'x'.repeat(71) } })), 'long title saved');
  });
  await s.check('Store settings are snapshotted before a change and can be restored', async () => {
    await call('sfx_store_save', { p: { brandName: 'Version One' } });
    await call('sfx_store_save', { p: { brandName: 'Version Two' } });
    const list = unwrap(await call('sfx_revision_list', {}));
    assert(list.length >= 1, 'no revision made');
    const target = (await q("select id from sfx_store_revisions where tenant_id=$1 and config->>'brandName'='Version One' limit 1", [tid]))[0];
    assert(target, 'no snapshot of version one');
    await call('sfx_revision_restore', { p_id: target.id });
    assert((await q('select config->>\'brandName\' b from sfx_stores where tenant_id=$1', [tid]))[0].b === 'Version One', 'not restored');
    const after = unwrap(await call('sfx_revision_list', {}));
    assert(after.length > list.length || after.some((r) => /restoring/.test(r.note || '')), 'restore did not keep the state it replaced');
    assert(/not found/.test(await err('sfx_revision_restore', { p_id: '00000000-0000-0000-0000-000000000000' })), 'unknown revision restored');
  }, 'critical');
  await s.check('Custom fields are typed, only storefront ones are public, and other products are protected', async () => {
    await call('sfx_metafield_def_save', { p_id: null, p: { ownerType: 'product', key: 'fabric', label: 'Fabric', valueType: 'text', storefront: true } });
    await call('sfx_metafield_def_save', { p_id: null, p: { ownerType: 'product', key: 'cost_note', label: 'Cost note', valueType: 'number', storefront: false } });
    assert(/already exists/.test(await err('sfx_metafield_def_save', { p_id: null, p: { ownerType: 'product', key: 'fabric', label: 'Fabric', valueType: 'text' } })), 'duplicate def');
    assert(/lowercase key/.test(await err('sfx_metafield_def_save', { p_id: null, p: { ownerType: 'product', key: 'Bad Key', label: 'x', valueType: 'text' } })), 'bad key saved');
    await call('sfx_metafield_set', { p_type: 'product', p_owner: pr.id, p: { fabric: 'Cotton', cost_note: '12.5' } });
    assert(/must be a number/.test(await err('sfx_metafield_set', { p_type: 'product', p_owner: pr.id, p: { cost_note: 'lots' } })), 'text in a number field');
    assert(/no custom field/.test(await err('sfx_metafield_set', { p_type: 'product', p_owner: pr.id, p: { nothing: 'x' } })), 'unknown field saved');
    const pubv = await pub('public_sfx_metafields', { p_slug: 'testcafe', p_type: 'product', p_owner: pr.id });
    assert(pubv.fabric && pubv.fabric.value === 'Cotton' && !pubv.cost_note, JSON.stringify(pubv));
    const other = await login(USERS.salonOwner);
    const oe = await err('sfx_metafield_set', { p_type: 'product', p_owner: pr.id, p: { fabric: 'Hacked' } }, other);
    assert(/error/.test(oe) && !/cotton|hacked.*fabric/.test(oe), 'other business wrote a field: ' + oe.slice(0, 200));
    assert(unwrap(await call('sfx_metafield_get', { p_type: 'product', p_owner: pr.id })).fabric === 'Cotton', 'value changed');
    await call('sfx_metafield_set', { p_type: 'product', p_owner: pr.id, p: { fabric: '' } });
    assert(unwrap(await call('sfx_metafield_get', { p_type: 'product', p_owner: pr.id })).fabric === undefined, 'empty value not removed');
  }, 'critical');
  await s.check('Metaobjects: a kind with typed fields, records checked against it', async () => {
    await call('sfx_metaobject_def_save', { p: { type: 'size_guide', label: 'Size guide', fields: [{ key: 'chest', label: 'Chest (cm)', valueType: 'number' }, { key: 'note', label: 'Note', valueType: 'text' }] } });
    await call('sfx_metaobject_save', { p_type: 'size_guide', p_handle: 'Medium Fit', p: { chest: '96', note: 'Relaxed' } });
    const list = unwrap(await call('sfx_metaobject_list', { p_type: 'size_guide' }));
    assert(list.length === 1 && list[0].handle === 'medium-fit' && list[0].data.chest === '96', JSON.stringify(list));
    assert(/must be a number/.test(await err('sfx_metaobject_save', { p_type: 'size_guide', p_handle: 'x', p: { chest: 'wide' } })), 'bad value saved');
    assert(/does not exist/.test(await err('sfx_metaobject_save', { p_type: 'nope', p_handle: 'x', p: {} })), 'record of unknown kind saved');
    const defs = unwrap(await call('sfx_metaobject_def_list', {}));
    assert(defs[0].count === 1, JSON.stringify(defs));
    await call('sfx_metaobject_delete', { p_type: 'size_guide', p_handle: 'medium-fit' });
    assert(unwrap(await call('sfx_metaobject_list', { p_type: 'size_guide' })).length === 0, 'not deleted');
  });
  await s.check('Dashboard: write a blog post and add a redirect from the screens', async () => {
    const ctx = await newCtx(browser, stack, { w: 1280, h: 900 }); const page = await ctx.newPage(); const errs = watch(page);
    await page.goto(stack.url('testcafe', '/storefront.html'), { waitUntil: 'load' }); await page.waitForTimeout(800);
    await page.evaluate(async ([e, p]) => { const c = window.supabase.createClient(CFG.url, CFG.key); await c.auth.signInWithPassword({ email: e, password: p }); }, [USERS.cafeOwner, PASSWORD]);
    await page.goto('about:blank'); await page.goto(stack.url('testcafe', '/storefront.html#/blog'), { waitUntil: 'load' }); await page.waitForTimeout(3500);
    await page.locator('[data-action="blog-new"]').click(); await page.waitForTimeout(500); await page.fill('#dialog input[name=title]', 'Screen post'); await page.locator('#dialog button.primary').click(); await page.waitForTimeout(1500);
    assert((await q("select count(*)::int n from sfx_blog_posts where tenant_id=$1 and title='Screen post'", [tid]))[0].n === 1, 'blog post not saved from screen');
    await page.goto('about:blank'); await page.goto(stack.url('testcafe', '/storefront.html#/redirects'), { waitUntil: 'load' }); await page.waitForTimeout(3000);
    await page.locator('[data-action="redirect-new"]').click(); await page.waitForTimeout(500); await page.fill('#dialog input[name=from]', '/screen-old'); await page.fill('#dialog input[name=to]', '/screen-new'); await page.locator('#dialog button.primary').click(); await page.waitForTimeout(1500);
    assert((await q("select count(*)::int n from sfx_redirects where tenant_id=$1 and from_path='/screen-old'", [tid]))[0].n === 1, 'redirect not saved from screen');
    assert(!errs.length, JSON.stringify(errs).slice(0, 200));
  });
  await s.check('Public store: blog posts from the dashboard show, an old product address redirects, a handle address works', async () => {
    const ctx = await newCtx(browser, stack, { w: 420, h: 900 }); const pg = await ctx.newPage(); const errs = watch(pg);
    const post = unwrap(await call('sfx_blog_save', { p_id: null, p: { title: 'Journal Visible Post', body: 'These are the words of the post.', status: 'published' } }));
    const h = (await q('select handle from sfx_products where id=$1', [pr.id]))[0].handle;
    await q("delete from sfx_redirects where tenant_id=$1 and from_path='/products/legacy-tee'", [tid]);
    await q("insert into sfx_redirects (tenant_id, from_path, to_path) values ($1, '/products/legacy-tee', $2)", [tid, '/products/' + h]);
    await pg.goto(stack.url('testcafe', '/store.html#/blog'), { waitUntil: 'load' }); await pg.waitForTimeout(2500);
    let t = await pg.locator('#view').innerText();
    assert(/journal visible post/i.test(t), t.slice(0, 300));
    await pg.goto(stack.url('testcafe', '/store.html#/blog/' + post.handle), { waitUntil: 'load' }); await pg.waitForTimeout(2500);
    t = await pg.locator('#view').innerText();
    assert(/words of the post/i.test(t), t.slice(0, 300));
    await pg.goto(stack.url('testcafe', '/store.html#/p/legacy-tee'), { waitUntil: 'load' }); await pg.waitForTimeout(3000);
    assert(pg.url().includes('#/p/' + pr.id), pg.url());
    assert(/content tee/i.test(await pg.locator('#view').innerText()), 'product page not shown after redirect');
    await pg.goto(stack.url('testcafe', '/store.html#/p/' + h), { waitUntil: 'load' }); await pg.waitForTimeout(3000);
    assert(pg.url().includes('#/p/' + pr.id), 'handle address did not open the product: ' + pg.url());
    assert(!errs.length, JSON.stringify(errs).slice(0, 200));
  });
  s.done();
}
