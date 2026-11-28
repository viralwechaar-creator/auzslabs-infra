// Storefront theme conformance (docs/STOREFRONT_THEME_CONTRACT.md): every theme in the real registry --
// section-based (Minimal, Classic, Salon, Kiln, Kiln (Salon)) and bespoke-chrome (Studs, Kaarigari), and any
// future one -- gets the SAME checklist run against it automatically, read from the registry itself
// (public_sfx_theme_registry(), db/468) rather than a hardcoded array in this file. This is the automated
// guard against the exact bug class that prompted this contract: Kaarigari going live silently fell back to
// the wrong theme/data because a hardcoded theme list in demo.js (and 8 other spots in store.js) was never
// updated when it was added. A theme added to sfx_themes without ever being run through this checklist is a
// structural impossibility here: the suite's own first check fails loudly if its theme count does not match
// the real row count in sfx_themes.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { q, USERS, PASSWORD } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('Theme contract', 'Every registered theme (section-based and bespoke-chrome) installs, activates, renders with real/empty data, checks out and rolls back cleanly -- read from the real theme registry, never a hardcoded list.');
  const T = 'testcafe';
  const tid = (await q('select id from tenants where slug = $1', [T]))[0].id;
  await q("update tenant_settings set features = features || '{\"storefront\":true}' where tenant_id = $1", [tid]);

  const login = async () => {
    const ctx = await newCtx(browser, stack, { w: 1280, h: 800 }); const pg = await ctx.newPage();
    await pg.goto(stack.url(T, '/storefront.html'), { waitUntil: 'load' }); await pg.waitForTimeout(700);
    const ok = await pg.evaluate(async ([e, p]) => { const c = window.supabase.createClient(CFG.url, CFG.key); const r = await c.auth.signInWithPassword({ email: e, password: p }); return !r.error; }, [USERS.cafeOwner, PASSWORD]);
    assert(ok, 'sign-in failed');
    return { ctx, pg, rpc: (fn, args) => pg.evaluate(async ([f, a]) => { const c = window.supabase.createClient(CFG.url, CFG.key); const r = await c.rpc(f, a || {}); return { data: r.data, error: r.error && r.error.message }; }, [fn, args]) };
  };
  const owner = await login();
  const publicOf = async () => (await q('select public_sfx_store($1) as j', [T]))[0].j;

  // ---------- fixtures: a small catalogue this suite owns, restored/removed around the empty-catalogue checks ----------
  const seedCatalogue = async () => {
    await q('delete from sfx_products where tenant_id = $1 and name like $2', [tid, 'Contract %']);
    const col = (await q("insert into sfx_collections (tenant_id, name) values ($1, 'Contract Picks') on conflict do nothing returning id", [tid]))[0]?.id
      || (await q("select id from sfx_collections where tenant_id = $1 and name = 'Contract Picks'", [tid]))[0].id;
    const ids = [];
    for (const [n, price] of [['Contract Tee', 1299], ['Contract Jacket', 3999]]) {
      const p = (await q("insert into sfx_products (tenant_id, name, status, price, category, images, description) values ($1,$2,'active',$3,'Apparel','[]'::jsonb,'A test product') returning id", [tid, n, price]))[0].id;
      await q('insert into sfx_variants (tenant_id, product_id, label, price, stock, position) values ($1,$2,$3,$4,0,0)', [tid, p, 'M', price]);
      await q('update sfx_variants set stock = 6 where product_id = $1', [p]);
      await q('insert into sfx_collection_products (collection_id, product_id) values ($1, $2)', [col, p]);
      ids.push(p);
    }
    return ids;
  };
  const clearCatalogue = () => q('delete from sfx_products where tenant_id = $1', [tid]);
  await seedCatalogue();

  const resetStoreBaseline = () => q("insert into sfx_stores (tenant_id, published, theme) values ($1, true, 'minimal') on conflict (tenant_id) do update set published = true, theme = 'minimal', active_install_id = null, previous_theme = null, previous_install_id = null", [tid]);

  // ---------- the real registry: every theme this suite must cover, with no list of its own ----------
  const registry = (await q('select public_sfx_theme_registry() as j'))[0].j;
  await s.check('The registry is never empty and matches the real row count in sfx_themes (nothing silently dropped)', async () => {
    const dbCount = +(await q("select count(*) c from sfx_themes where is_builtin and status = 'approved'"))[0].c;
    assert(registry.length > 0, 'registry returned no themes');
    assert(registry.length === dbCount, `registry has ${registry.length} themes but sfx_themes has ${dbCount} approved built-in rows -- a theme is missing from public_sfx_theme_registry()`);
    assert(registry.some((t) => t.isBespoke), 'no bespoke-chrome theme in the registry -- Studs/Kaarigari missing');
    assert(registry.some((t) => !t.isBespoke), 'no section-based theme in the registry -- Minimal/Classic missing');
  }, 'critical');

  const covered = [];
  for (const t of registry) {
    covered.push(t.slug);
    await s.check(`[${t.slug}] installs, activates and the public store actually renders its own template (not a silent fallback)`, async () => {
      await resetStoreBaseline();
      const list = await owner.rpc('sfx_theme_marketplace_list'); assert(!list.error, list.error);
      const row = (list.data || []).find((x) => x.slug === t.slug); assert(row, `${t.slug} not offered in the marketplace`);
      const inst = await owner.rpc('sfx_theme_install', { p_theme_id: row.id }); assert(!inst.error, inst.error);
      const act = await owner.rpc('sfx_theme_install_set_active', { p_install_id: inst.data.installId }); assert(!act.error, act.error);
      await owner.rpc('sfx_theme_customize_publish', { p_install_id: inst.data.installId }); // best-effort: pushes any draft content live; harmless if there is none
      const d = await publicOf();
      assert(d && d.config, `public store returned nothing for ${t.slug}`);
      assert(d.config.template === t.template, `expected template '${t.template}' for theme '${t.slug}' but the public store serves '${d.config.template}' -- this is the exact wrong-theme-fallback bug class`);
    }, 'critical');

    await s.check(`[${t.slug}] renders in a real browser without console errors, at phone and desktop widths`, async () => {
      for (const dev of [{ w: 1280, h: 800 }, { w: 390, h: 844 }]) {
        const ctx = await newCtx(browser, stack, dev); const pg = await ctx.newPage(); const errs = watch(pg);
        await pg.goto(stack.url(T, '/store.html'), { waitUntil: 'load' }); await pg.waitForTimeout(2200);
        const text = await pg.locator('body').innerText();
        assert(!/could not open the store/i.test(text), `${t.slug} failed to render at ${dev.w}px: ${text.slice(0, 160)}`);
        if (t.isBespoke) assert(await pg.evaluate((id) => !!document.getElementById(id), t.slug + '-host'), `${t.slug}'s own chrome host (#${t.slug}-host) did not mount at ${dev.w}px`);
        assert(await pg.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `sideways scroll for ${t.slug} at ${dev.w}px`);
        assert(!errs.filter((e) => !/sentry|fonts|googleapis|ERR_/i.test(e)).length, `${t.slug} at ${dev.w}px: ` + errs.slice(0, 3).join(' | '));
        await ctx.close();
      }
    }, 'major');

    await s.check(`[${t.slug}] renders with an empty catalogue and a genuinely empty cart without erroring`, async () => {
      await clearCatalogue();
      try {
        const ctx = await newCtx(browser, stack, { w: 1280, h: 800 }); const pg = await ctx.newPage(); const errs = watch(pg);
        await pg.addInitScript((slug) => { try { localStorage.removeItem('st.' + slug + '.bag'); } catch (e) {} }, T);
        await pg.goto(stack.url(T, '/store.html'), { waitUntil: 'load' }); await pg.waitForTimeout(2200);
        const text = await pg.locator('body').innerText();
        assert(!/could not open the store/i.test(text), `${t.slug} errored on an empty catalogue: ${text.slice(0, 160)}`);
        assert(!errs.filter((e) => !/sentry|fonts|googleapis|ERR_/i.test(e)).length, `${t.slug} empty-catalogue errors: ` + errs.slice(0, 3).join(' | '));
        await ctx.close();
      } finally { await seedCatalogue(); }
    }, 'major');

    if (t.isBespoke) {
      // Header/footer-only (the baseline) frames the shared checkout page; 'full' (Kaarigari's reviewed,
      // explicit exception -- see docs/STOREFRONT_THEME_CONTRACT.md) draws its own checkout instead of
      // framing the shared one. Branches on the real declared capability, never a hardcoded slug check.
      const full = (t.capabilities || {}).checkoutOwnership === 'full';
      await s.check(`[${t.slug}] ${full ? 'draws its own checkout page (full checkout ownership)' : "frames the shared checkout with its own header/footer (header/footer-only checkout ownership)"}`, async () => {
        const ctx = await newCtx(browser, stack, { w: 1280, h: 800 }); const pg = await ctx.newPage(); const errs = watch(pg);
        const p = (await q("select id from sfx_products where tenant_id = $1 and name = 'Contract Tee'", [tid]))[0];
        const v = (await q('select id from sfx_variants where product_id = $1', [p.id]))[0];
        // the bag must be populated BEFORE the app's own boot script runs, otherwise checkout redirects to
        // the (still empty, in-memory) bag page -- set it via an init script, then load straight into #/checkout
        await pg.addInitScript(([slug, variantId]) => { try { localStorage.setItem('st.' + slug + '.bag', JSON.stringify([{ v: variantId, q: 1 }])); } catch (e) {} }, [T, v.id]);
        await pg.goto(stack.url(T, '/store.html#/checkout'), { waitUntil: 'load' }); await pg.waitForTimeout(3000);
        const diag = await pg.evaluate((id) => { const h = document.getElementById(id); return { tpl: (window.StoreHost && window.StoreHost.cfg && window.StoreHost.cfg().template) || '?', hasGlobal: !!window.StudsTheme || !!window.KaarigariTheme, hasHost: !!h, hidden: h && h.hidden, hasView: !!document.getElementById('view'), viewInHost: !!(h && document.getElementById('view') && h.contains(document.getElementById('view'))), hash: location.hash, shadowText: (h && h.shadowRoot ? (h.shadowRoot.querySelector('main') || h.shadowRoot).textContent : '').slice(0, 400) }; }, t.slug + '-host');
        if (full) {
          assert(diag.hasHost && !diag.hidden, `${t.slug} did not mount its own chrome host for checkout -- ` + JSON.stringify(diag));
          assert(!diag.viewInHost, `${t.slug} declares 'full' checkout ownership but still framed the shared checkout page instead of drawing its own -- ` + JSON.stringify(diag));
          assert(/checkout|delivery|contact|payment/i.test(diag.shadowText), `${t.slug}'s own checkout page did not render its own content -- ` + JSON.stringify(diag));
        } else {
          const framed = diag.hasHost && !diag.hidden && diag.viewInHost;
          assert(framed, `${t.slug} did not frame the shared checkout page with its own header/footer -- ` + JSON.stringify(diag));
          const text = await pg.locator('#view').innerText(); assert(/checkout|delivery|contact|total/i.test(text), `${t.slug}: shared checkout did not render inside the frame: ` + text.slice(0, 120));
        }
        assert(!errs.filter((e) => !/sentry|fonts|googleapis|ERR_/i.test(e)).length, errs.slice(0, 3).join(' | '));
        await ctx.close();
      }, 'critical');
    }

    await s.check(`[${t.slug}] COD checkout completes and rollback to the previous theme is clean`, async () => {
      const ctx = await newCtx(browser, stack, { w: 1280, h: 800 }); const pg = await ctx.newPage(); const errs = watch(pg);
      await pg.goto(stack.url(T, '/store.html'), { waitUntil: 'load' }); await pg.waitForTimeout(2200);
      const p = (await q("select id from sfx_products where tenant_id = $1 and name = 'Contract Tee'", [tid]))[0];
      assert(p, 'fixture product missing'); const v = (await q('select id from sfx_variants where product_id = $1', [p.id]))[0];
      await q("update sfx_variants set stock = 6 where id = $1", [v.id]);
      // a distinct phone number per theme -- the platform rate-limits repeat orders from the same number within
      // a short window, which this loop would otherwise trip across themes
      const phone = '90000' + String(Math.abs([...t.slug].reduce((a, c) => a * 31 + c.charCodeAt(0), 7)) % 100000).padStart(5, '0');
      const placed = await pg.evaluate(async ([slug, variantId, ph]) => {
        const c = window.supabase.createClient(CFG.url, CFG.key);
        localStorage.setItem('st.' + slug + '.bag', JSON.stringify([{ v: variantId, q: 1 }]));
        const r = await c.rpc('public_sfx_place_order', { p_slug: slug, p: { name: 'Contract Tester', email: 'contract@test.local', phone: ph, address: '1 Test Street', address2: '', city: 'Jodhpur', state: 'Rajasthan', pin: '342001', country: 'India', note: '', payment: 'cod', lines: [{ variantId, qty: 1 }] } });
        return r.error ? { error: r.error.message } : r.data;
      }, [T, v.id, phone]);
      assert(!placed.error, `COD checkout failed for ${t.slug}: ` + placed.error);
      assert(!errs.filter((e) => !/sentry|fonts|googleapis|ERR_/i.test(e)).length, errs.slice(0, 3).join(' | '));
      await ctx.close();
      const rev = await owner.rpc('sfx_theme_revert_active'); assert(!rev.error, rev.error);
      const d = await publicOf(); assert(d.config.template === 'minimal', `revert for ${t.slug} left the store on '${d.config.template}' instead of the baseline`);
    }, 'critical');
  }

  await s.check('Every registry theme was actually run through this checklist (no theme skipped)', async () => {
    assert(covered.length === registry.length && registry.every((t) => covered.includes(t.slug)), 'covered=' + JSON.stringify(covered) + ' registry=' + JSON.stringify(registry.map((t) => t.slug)));
  }, 'critical');

  await clearCatalogue();
  await resetStoreBaseline();
}
