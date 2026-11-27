// Theme editor step 1 (db/452): the section registry, validation of saved drafts, blocks, and the new section types on the public store.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { q, USERS, PASSWORD } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('Storefront sections', 'A registry of section types, server-side checks on saved designs, items inside sections, and the public store drawing them.');
  await q("update tenant_settings set features = features || '{\"storefront\":true}' where tenant_id = (select id from tenants where slug='testcafe')");
  await q("insert into sfx_stores (tenant_id, published) select id, true from tenants where slug='testcafe' on conflict (tenant_id) do update set published=true");
  const tid = (await q("select id from tenants where slug='testcafe'"))[0].id;
  await q("delete from sfx_products where tenant_id=$1 and name='Section Tee'", [tid]);
  await q("insert into sfx_products (tenant_id, name, handle, status, price, images) values ($1, 'Section Tee', 'section-tee', 'active', 700, '[]'::jsonb)", [tid]);
  const pid = (await q("select id from sfx_products where tenant_id=$1 and handle='section-tee'", [tid]))[0].id;
  await q("insert into sfx_variants (tenant_id, product_id, label, price, stock, position) values ($1, $2, 'M', 700, 5, 0)", [tid, pid]);
  const ctx = await newCtx(browser, stack, { w: 1280, h: 900 }); const page = await ctx.newPage(); const errs = watch(page);
  await page.goto(stack.url('testcafe', '/storefront.html'), { waitUntil: 'load' }); await page.waitForTimeout(800);
  const content = { sections: [
    { id: 'f1', type: 'faq', props: { heading: 'Good questions' }, blocks: [{ id: 'q1', type: 'question', props: { question: 'Do you ship everywhere?', answer: 'Across India.' } }, { id: 'q2', type: 'question', props: { question: 'Can I return it?', answer: 'Within 30 days.' } }] },
    { id: 'c1', type: 'columns', props: { heading: 'Why us' }, blocks: [{ id: 'k1', type: 'column', props: { title: 'Made slowly', text: 'By hand.', href: '/shop', link_text: 'See more' } }] },
    { id: 'p1', type: 'featured_collection', props: { heading: 'Fresh in', count: '4', columns: '3', button: 'Shop all' } },
    { id: 'i1', type: 'image_text', props: { heading: 'Our story', body: 'Since 2019.', layout: 'right', button: 'Read', href: '/about' } },
    { id: 'g1', type: 'gallery', props: { heading: 'Looks' }, blocks: [{ id: 'g1a', type: 'picture', props: { image: 'https://example.com/a.jpg', caption: 'One' } }] },
  ] };
  const out = await page.evaluate(async ([e, p, content]) => {
    const c = window.supabase.createClient(CFG.url, CFG.key); await c.auth.signInWithPassword({ email: e, password: p });
    const reg = await c.rpc('sfx_section_registry'); if (reg.error) return { error: reg.error.message };
    const made = await c.rpc('sfx_theme_install_create', { p: { name: 'Sections test', starter: 'blank', base: 'minimal' } }); if (made.error) return { error: made.error.message };
    const id = made.data.installId;
    const save = await c.rpc('sfx_theme_customize_save', { p_install_id: id, p_content: content }); if (save.error) return { error: save.error.message };
    const bad = [
      { sections: [{ type: 'nope', props: {} }] },
      { sections: [{ type: 'hero', props: { href: 'javascript:alert(1)' } }] },
      { sections: [{ type: 'columns', props: {}, blocks: [1, 2, 3, 4, 5].map((n) => ({ type: 'column', props: { title: 'x' + n } })) }] },
      { sections: [{ type: 'faq', props: {}, blocks: [{ type: 'not_a_block', props: {} }] }] },
    ];
    const refused = []; for (const b of bad) { const r = await c.rpc('sfx_theme_customize_save', { p_install_id: id, p_content: b }); refused.push(r.error ? r.error.message : 'ACCEPTED'); }
    await c.rpc('sfx_theme_customize_save', { p_install_id: id, p_content: content });
    const a = await c.rpc('sfx_theme_install_set_active', { p_install_id: id }); if (a.error) return { error: a.error.message };
    const pub = await c.rpc('sfx_theme_customize_publish', { p_install_id: id }); if (pub.error) return { error: pub.error.message };
    return { ok: true, types: reg.data.map((t) => t.type), blockTypes: Object.fromEntries(reg.data.filter((t) => t.blockTypes).map((t) => [t.type, t.maxBlocks])), refused };
  }, [USERS.cafeOwner, PASSWORD, content]);
  await s.check('The registry lists the six built-in types and the five new ones', async () => {
    assert(out.ok, JSON.stringify(out));
    for (const t of ['hero', 'text', 'image', 'button', 'announcement', 'booking', 'featured_collection', 'image_text', 'faq', 'columns', 'gallery']) assert(out.types.includes(t), 'missing ' + t);
    assert(out.blockTypes.columns === 4 && out.blockTypes.faq === 12, JSON.stringify(out.blockTypes));
  }, 'critical');
  await s.check('The server refuses an unknown type, an unsafe link, too many items and an unknown item type', async () => {
    assert(out.ok, JSON.stringify(out));
    assert(/unknown type/.test(out.refused[0]), out.refused[0]); assert(/links must start/.test(out.refused[1]), out.refused[1]);
    assert(/up to 4 items/.test(out.refused[2]), out.refused[2]); assert(/unknown item type/.test(out.refused[3]), out.refused[3]);
  }, 'critical');
  await s.check('A saved draft keeps its items, their ids and its order', async () => {
    const row = (await q("select draft_content from sfx_theme_installs where tenant_id=$1 and name='Sections test' order by installed_at desc limit 1", [tid]))[0].draft_content;
    assert(row.sections.length === 5 && row.sections[0].id === 'f1', JSON.stringify(row.sections.map((x) => x.id)));
    assert(row.sections[0].blocks.length === 2 && row.sections[0].blocks[1].id === 'q2', 'blocks lost');
    assert(row.sections[3].props.layout === 'right' && !('javascript' in row.sections[3].props), 'props wrong');
  }, 'critical');
  await s.check('The public store draws the new sections with their items', async () => {
    const pg = await ctx.newPage(); const e2 = watch(pg);
    await pg.goto(stack.url('testcafe', '/store.html'), { waitUntil: 'load' }); await pg.waitForTimeout(2500);
    const t = await pg.locator('body').innerText();
    assert(/Good questions/.test(t) && /Do you ship everywhere/.test(t) && /Can I return it/.test(t), 'faq missing: ' + t.slice(0, 200));
    assert(await pg.locator('.custom-faq details').count() === 2, 'faq items');
    assert(/Made slowly/.test(t) && /See more/.test(t), 'columns missing');
    assert(/Fresh in/.test(t) && /Section Tee/.test(t), 'featured products missing');
    assert(/Our story/.test(t) && await pg.locator('.custom-imgtext.pic-right').count() === 1, 'image with text missing');
    assert(await pg.locator('.custom-gallery img').count() === 1, 'gallery missing');
    assert(!e2.filter((x) => !/sentry|fonts|example\.com/i.test(x)).length, e2.slice(0, 3).join(' | '));
  }, 'critical');
  await s.check('Page templates: the server keeps one main row, refuses bad content, and the public store puts sections above and below the page', async () => {
    const inst = (await q("select id from sfx_theme_installs where tenant_id=$1 and name='Sections test' order by installed_at desc limit 1", [tid]))[0].id;
    const tpl = { sections: content.sections, templates: {
      collection: { sections: [{ id: 'a', type: 'text', props: { heading: 'Above the grid', body: 'x' } }, { type: 'main' }, { type: 'main' }, { id: 'b', type: 'text', props: { heading: 'Below the grid', body: 'y' } }] },
      product: { sections: [{ id: 'm', type: 'main' }, { id: 'c', type: 'text', props: { heading: 'After the product', body: 'z' } }] },
      cart: { sections: [{ id: 'd', type: 'text', props: { heading: 'Cart note', body: 'w' } }] },
      bogus: { sections: [{ type: 'text' }] } } };
    const r = await page.evaluate(async ([id, t]) => { const c = window.supabase.createClient(CFG.url, CFG.key);
      const bad = await c.rpc('sfx_theme_customize_save', { p_install_id: id, p_content: { templates: { collection: { sections: [{ type: 'nope' }] } } } });
      const many = await c.rpc('sfx_theme_customize_save', { p_install_id: id, p_content: { templates: { cart: { sections: Array.from({ length: 14 }, () => ({ type: 'text', props: {} })) } } } });
      const ok = await c.rpc('sfx_theme_customize_save', { p_install_id: id, p_content: t });
      const pub = await c.rpc('sfx_theme_customize_publish', { p_install_id: id });
      return { bad: bad.error && bad.error.message, many: many.error && many.error.message, ok: ok.error && ok.error.message, pub: pub.error && pub.error.message }; }, [inst, tpl]);
    assert(/unknown type/.test(r.bad || ''), 'bad: ' + r.bad); assert(/up to 12/.test(r.many || ''), 'many: ' + r.many); assert(!r.ok && !r.pub, JSON.stringify(r));
    const row = (await q('select draft_content from sfx_theme_installs where id=$1', [inst]))[0].draft_content;
    assert(!row.templates.bogus, 'unknown template kept');
    assert(row.templates.collection.sections.map((x) => x.type).join() === 'text,main,text', row.templates.collection.sections.map((x) => x.type).join());
    const pg = await ctx.newPage(); const e3 = watch(pg);
    await pg.goto(stack.url('testcafe', '/store.html#/shop'), { waitUntil: 'load' }); await pg.waitForTimeout(2500);
    const order = await pg.evaluate(() => { const v = document.querySelector('#view'); const k = [...v.children]; return { first: k[0].innerText.slice(0, 40), last: k[k.length - 1].innerText.slice(0, 40), n: k.length }; });
    assert(/Above the grid/.test(order.first) && /Below the grid/.test(order.last) && order.n > 2, JSON.stringify(order));
    await pg.goto(stack.url('testcafe', '/store.html#/p/' + pid), { waitUntil: 'load' }); await pg.waitForTimeout(1500); await pg.reload({ waitUntil: 'load' }); await pg.waitForTimeout(2500);
    assert(/After the product/.test(await pg.locator('#view').innerText()), 'product template missing');
    await pg.goto(stack.url('testcafe', '/store.html#/bag'), { waitUntil: 'load' }); await pg.reload({ waitUntil: 'load' }); await pg.waitForTimeout(2000);
    assert(/Cart note/.test(await pg.locator('#view').innerText()), 'cart template missing');
    assert(!e3.filter((x) => !/sentry|fonts|example\.com/i.test(x)).length, e3.slice(0, 3).join(' | '));
  }, 'critical');
  await s.check('The editor lists the three page templates, locks the main row and saves a section above it', async () => {
    const inst = (await q("select id from sfx_theme_installs where tenant_id=$1 and name='Sections test' order by installed_at desc limit 1", [tid]))[0].id;
    await page.goto(stack.url('testcafe', '/storefront.html#/builder/' + inst), { waitUntil: 'load' }); await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(3500);
    const opts = await page.locator('#te-page option').allInnerTexts();
    assert(['Collection page', 'Product page', 'Cart page'].every((x) => opts.includes(x)), opts.join(','));
    await page.selectOption('#te-page', 'tpl:cart'); await page.waitForTimeout(600);
    assert(/Main content/.test(await page.locator('#te-list').innerText()), 'main row missing');
    await page.locator('.te-item', { hasText: 'Main content' }).click(); await page.waitForTimeout(300);
    assert(await page.locator('[data-action="te-remove"]').count() === 0, 'main row can be removed');
    await page.selectOption('#te-add-type', 'text'); await page.click('[data-action="te-add"]'); await page.waitForTimeout(400);
    await page.locator('#te-right input[name=heading]').fill('Free returns'); await page.waitForTimeout(300);
    await page.click('[data-action="te-up"]'); await page.waitForTimeout(300);
    await page.click('[data-action="te-save"]'); await page.waitForTimeout(1500);
    const row = (await q('select draft_content from sfx_theme_installs where id=$1', [inst]))[0].draft_content;
    const cart = row.templates.cart.sections;
    assert(cart.map((x) => x.type).join() === 'main,text,text' && cart[1].props.heading === 'Free returns' && cart[2].props.heading === 'Cart note', JSON.stringify(cart));
  }, 'major');
  await s.check('The editor adds a section with items, edits an item and saves', async () => {
    const before = errs.length;
    const inst = (await q("select id from sfx_theme_installs where tenant_id=$1 and name='Sections test' order by installed_at desc limit 1", [tid]))[0].id;
    await page.goto(stack.url('testcafe', '/storefront.html#/builder/' + inst), { waitUntil: 'load' }); await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(3500);
    const types = await page.locator('#te-add-type option').allInnerTexts();
    assert(types.includes('Questions and answers') && types.includes('Picture gallery'), 'types not from the registry: ' + types.join(','));
    await page.selectOption('#te-add-type', 'faq'); await page.click('[data-action="te-add"]'); await page.waitForTimeout(500);
    assert(await page.locator('form[data-form="te-block"]').count() === 2, 'starter items missing');
    await page.click('[data-action="te-badd"]'); await page.waitForTimeout(300);
    assert(await page.locator('form[data-form="te-block"]').count() === 3, 'item not added');
    await page.locator('form[data-form="te-block"]').nth(2).locator('input[name=question]').fill('Is it cotton?');
    await page.click('[data-action="te-save"]'); await page.waitForTimeout(1200);
    const row = (await q("select draft_content from sfx_theme_installs where id=$1", [inst]))[0].draft_content;
    const last = row.sections[row.sections.length - 1];
    assert(last.type === 'faq' && last.blocks.length === 3 && last.blocks[2].props.question === 'Is it cotton?', JSON.stringify(last));
    assert(!errs.slice(before).filter((x) => !/sentry|fonts|example\.com|reading 'open'/i.test(x)).length, errs.slice(before).slice(0, 3).join(' | '));
  }, 'major');
  await s.check('Revision check: a stale save is refused, a current or missing revision works', async () => {
    const inst = (await q("select id from sfx_theme_installs where tenant_id=$1 and name='Sections test' order by installed_at desc limit 1", [tid]))[0].id;
    const r = await page.evaluate(async (id) => { const c = window.supabase.createClient(CFG.url, CFG.key);
      const get = async () => (await c.rpc('sfx_theme_install_list')).data.find((x) => x.id === id).revision;
      const r0 = await get(); const body = { sections: [{ id: 'z1', type: 'text', props: { heading: 'Rev test', body: 'x' } }] };
      const a = await c.rpc('sfx_theme_customize_save', { p_install_id: id, p_content: body, p_expected: r0 });
      const stale = await c.rpc('sfx_theme_customize_save', { p_install_id: id, p_content: body, p_expected: r0 });
      const none = await c.rpc('sfx_theme_customize_save', { p_install_id: id, p_content: { sections: [{ id: 'z2', type: 'text', props: { heading: 'Rev test 2', body: 'x' } }] } });
      return { r0, a: a.error ? a.error.message : a.data, stale: stale.error ? stale.error.message : 'ACCEPTED', none: none.error ? none.error.message : none.data, r3: await get() }; }, inst);
    assert(r.a.revision === r.r0 + 1, JSON.stringify(r)); assert(/changed by someone else/.test(r.stale), r.stale);
    assert(r.none.revision === r.r0 + 2 && r.r3 === r.r0 + 2, JSON.stringify(r));
  }, 'critical');
  await s.check('The editor warns when someone else saved first, and can overwrite or load their version', async () => {
    const inst = (await q("select id from sfx_theme_installs where tenant_id=$1 and name='Sections test' order by installed_at desc limit 1", [tid]))[0].id;
    await page.goto(stack.url('testcafe', '/storefront.html#/builder/' + inst), { waitUntil: 'load' }); await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(3500);
    const other = async (txt) => q("update sfx_theme_installs set draft_content = jsonb_set(draft_content, '{sections}', $2::jsonb) where id=$1", [inst, JSON.stringify([{ id: 'o1', type: 'text', props: { heading: txt, body: 'b' } }])]);
    await other('Their change');
    await page.selectOption('#te-add-type', 'text'); await page.click('[data-action="te-add"]'); await page.waitForTimeout(300);
    await page.locator('#te-right input[name=heading]').fill('My change'); await page.waitForTimeout(300);
    let msg = ''; page.once('dialog', async (d) => { msg = d.message(); await d.accept(); });
    await page.click('[data-action="te-save"]'); await page.waitForTimeout(1500);
    assert(/Someone else saved/.test(msg), 'no warning: ' + msg);
    let row = (await q('select draft_content from sfx_theme_installs where id=$1', [inst]))[0].draft_content;
    assert(row.sections.some((x) => x.props.heading === 'My change') && !row.sections.some((x) => x.props.heading === 'Their change'), 'overwrite did not keep mine: ' + JSON.stringify(row.sections));
    await other('Their second change');
    await page.selectOption('#te-add-type', 'text'); await page.click('[data-action="te-add"]'); await page.waitForTimeout(300);
    page.once('dialog', async (d) => { await d.dismiss(); });
    await page.click('[data-action="te-save"]'); await page.waitForTimeout(2000);
    row = (await q('select draft_content from sfx_theme_installs where id=$1', [inst]))[0].draft_content;
    assert(row.sections.length === 1 && row.sections[0].props.heading === 'Their second change', 'their version was overwritten: ' + JSON.stringify(row.sections));
    assert(/Their second change/.test(await page.locator('#te-list').innerText().catch(() => '') + await page.locator('body').innerText()), 'editor did not load their version');
  }, 'major');
  await s.check('Design settings: the server checks them, and the public store applies them', async () => {
    const inst = (await q("select id from sfx_theme_installs where tenant_id=$1 and name='Sections test' order by installed_at desc limit 1", [tid]))[0].id;
    const r = await page.evaluate(async (id) => { const c = window.supabase.createClient(CFG.url, CFG.key);
      const reg = await c.rpc('sfx_design_registry');
      const bad = await c.rpc('sfx_theme_customize_save', { p_install_id: id, p_content: { design: { accent: 'red' } } });
      const ok = await c.rpc('sfx_theme_customize_save', { p_install_id: id, p_content: { sections: [], design: { bg: '#112233', accent: '#aa0000', radius: 'sharp', buttons: 'accent', buttonShape: 'nope', font: 'serif', evil: 'x' } } });
      const pub = await c.rpc('sfx_theme_customize_publish', { p_install_id: id });
      return { ids: reg.data.map((d) => d.id), bad: bad.error && bad.error.message, ok: ok.error && ok.error.message, pub: pub.error && pub.error.message }; }, inst);
    assert(['bg', 'card', 'ink', 'accent', 'radius', 'buttons', 'buttonShape', 'font', 'spacing'].every((x) => r.ids.includes(x)), r.ids.join());
    assert(/colour like/.test(r.bad || ''), 'bad: ' + r.bad); assert(!r.ok && !r.pub, JSON.stringify(r));
    const row = (await q('select draft_content from sfx_theme_installs where id=$1', [inst]))[0].draft_content;
    assert(row.design.bg === '#112233' && row.design.radius === 'sharp' && !('evil' in row.design) && !('buttonShape' in row.design), JSON.stringify(row.design));
    const pg = await ctx.newPage();
    await pg.goto(stack.url('testcafe', '/store.html'), { waitUntil: 'load' }); await pg.waitForTimeout(2500);
    const css = await pg.evaluate(() => ({ bg: document.documentElement.style.getPropertyValue('--bg'), r1: document.documentElement.style.getPropertyValue('--r1'), cls: document.body.className, on: document.documentElement.style.getPropertyValue('--on-accent') }));
    assert(css.bg === '#112233' && css.r1 === '0px' && /d-btn-accent/.test(css.cls) && /d-font-serif/.test(css.cls) && css.on === '#ffffff', JSON.stringify(css));
  }, 'critical');
  await s.check('The editor has a Design page with colour and choice controls, saves only what was changed, and can reset', async () => {
    const inst = (await q("select id from sfx_theme_installs where tenant_id=$1 and name='Sections test' order by installed_at desc limit 1", [tid]))[0].id;
    await q("update sfx_theme_installs set draft_content = draft_content - 'design' where id=$1", [inst]);
    await page.goto(stack.url('testcafe', '/storefront.html#/builder/' + inst), { waitUntil: 'load' }); await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(3500);
    assert((await page.locator('#te-page option').allInnerTexts()).includes('Design settings'), 'no Design entry');
    await page.selectOption('#te-page', 'design'); await page.waitForTimeout(600);
    assert(await page.locator('form[data-form="te-design"] input[type=color]').count() === 4, 'colour controls');
    await page.locator('form[data-form="te-design"] input[name=accent]').fill('#123456'); await page.waitForTimeout(400);
    await page.selectOption('form[data-form="te-design"] select[name=radius]', 'round'); await page.waitForTimeout(400);
    await page.click('[data-action="te-save"]'); await page.waitForTimeout(1500);
    let row = (await q('select draft_content from sfx_theme_installs where id=$1', [inst]))[0].draft_content;
    assert(row.design.accent === '#123456' && row.design.radius === 'round' && !('bg' in row.design), JSON.stringify(row.design));
    await page.click('[data-action="te-dreset"]'); await page.waitForTimeout(400);
    await page.click('[data-action="te-save"]'); await page.waitForTimeout(1500);
    row = (await q('select draft_content from sfx_theme_installs where id=$1', [inst]))[0].draft_content;
    assert(!row.design || Object.keys(row.design).length === 0, 'reset did not clear: ' + JSON.stringify(row.design));
  }, 'major');
  await s.check('Shared groups: the server checks them, and every public page shows the header group on top and the footer group at the bottom', async () => {
    const inst = (await q("select id from sfx_theme_installs where tenant_id=$1 and name='Sections test' order by installed_at desc limit 1", [tid]))[0].id;
    const groups = { header: { sections: [{ id: 'h1', type: 'announcement', props: { text: 'Free shipping this week' } }] },
      footer: { sections: [{ id: 'f1', type: 'links', props: { heading: 'Help' }, blocks: [{ id: 'l1', type: 'link', props: { label: 'Returns policy', href: '/policy/returns' } }, { id: 'l2', type: 'link', props: { label: 'Bad', href: 'javascript:x' } }] }] } };
    const r = await page.evaluate(async ([id, g]) => { const c = window.supabase.createClient(CFG.url, CFG.key);
      const many = await c.rpc('sfx_theme_customize_save', { p_install_id: id, p_content: { groups: { header: { sections: Array.from({ length: 9 }, () => ({ type: 'text', props: {} })) } } } });
      const main = await c.rpc('sfx_theme_customize_save', { p_install_id: id, p_content: { groups: { footer: { sections: [{ type: 'main' }] } } } });
      const link = await c.rpc('sfx_theme_customize_save', { p_install_id: id, p_content: { groups: g } });
      const ok = await c.rpc('sfx_theme_customize_save', { p_install_id: id, p_content: { groups: { footer: { sections: [{ id: 'f1', type: 'links', props: { heading: 'Help' }, blocks: [{ id: 'l1', type: 'link', props: { label: 'Returns policy', href: '/policy/returns' } }] }] }, header: g.header } } });
      const pub = await c.rpc('sfx_theme_customize_publish', { p_install_id: id });
      return { many: many.error && many.error.message, main: main.error && main.error.message, link: link.error && link.error.message, ok: ok.error && ok.error.message, pub: pub.error && pub.error.message }; }, [inst, groups]);
    assert(/up to 8/.test(r.many || ''), 'many: ' + r.many); assert(/unknown type/.test(r.main || ''), 'main: ' + r.main);
    assert(/links must start/.test(r.link || ''), 'unsafe link: ' + r.link); assert(!r.ok && !r.pub, JSON.stringify(r));
    const pg = await ctx.newPage(); const e6 = watch(pg);
    for (const route of ['', 'shop', 'about']) {
      await pg.goto(stack.url('testcafe', '/store.html#/' + route), { waitUntil: 'load' }); await pg.reload({ waitUntil: 'load' }); await pg.waitForTimeout(2200);
      const o = await pg.evaluate(() => { const k = [...document.querySelector('#view').children]; return { first: k[0] ? k[0].innerText : '', last: k[k.length - 1] ? k[k.length - 1].innerText : '' }; });
      assert(/Free shipping this week/.test(o.first) && /Returns policy/.test(o.last), route + ': ' + JSON.stringify(o));
    }
    assert(!e6.filter((x) => !/sentry|fonts|example\.com/i.test(x)).length, e6.slice(0, 3).join(' | '));
  }, 'critical');
  await s.check('The editor lists the shared groups, edits them like any section list and saves', async () => {
    const inst = (await q("select id from sfx_theme_installs where tenant_id=$1 and name='Sections test' order by installed_at desc limit 1", [tid]))[0].id;
    await page.goto(stack.url('testcafe', '/storefront.html#/builder/' + inst), { waitUntil: 'load' }); await page.reload({ waitUntil: 'load' }); await page.waitForTimeout(3500);
    const opts = await page.locator('#te-page option').allInnerTexts();
    assert(opts.includes('Top of every page') && opts.includes('Bottom of every page'), opts.join(','));
    await page.selectOption('#te-page', 'group:footer'); await page.waitForTimeout(600);
    assert(/Link row/.test(await page.locator('#te-list').innerText()), 'footer section missing: ' + await page.locator('#te-list').innerText());
    await page.selectOption('#te-add-type', 'text'); await page.click('[data-action="te-add"]'); await page.waitForTimeout(400);
    await page.locator('#te-right input[name=heading]').fill('About the shop'); await page.waitForTimeout(300);
    await page.click('[data-action="te-save"]'); await page.waitForTimeout(1500);
    const row = (await q('select draft_content from sfx_theme_installs where id=$1', [inst]))[0].draft_content;
    assert(row.groups.footer.sections.length === 2 && row.groups.footer.sections[1].props.heading === 'About the shop' && row.groups.header.sections.length === 1, JSON.stringify(row.groups));
  }, 'major');
  await ctx.close();
  return s.done();
}
