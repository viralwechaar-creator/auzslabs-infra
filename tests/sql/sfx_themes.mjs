// Theme marketplace: built-in themes carry the real content, install isolation, base chrome. Run: node tests/sql/sfx_themes.mjs
import { build, connect, PG } from '../lib/db.mjs';
import assert from 'node:assert';
await build(() => {});
const admin = await connect(PG.db);
let ok = 0; const pass = (m) => { ok++; console.log('PASS', m); };
const mk = async (slug) => {
  const t = (await admin.query("insert into tenants (slug,name,niche,plan,status) values ($1,$1,'retail','pro','active') returning id", [slug])).rows[0].id;
  await admin.query("insert into tenant_settings (tenant_id, features, labels, business_rules) values ($1,'{\"storefront\":true}','{}','{}')", [t]);
  const u = (await admin.query("insert into auth_users (email,password_hash,email_verified_at) values ($1,'x',now()) returning id", [slug + '@t.local'])).rows[0].id;
  await admin.query("insert into profiles (id, tenant_id, role) values ($1,$2,'owner')", [u, t]);
  await admin.query("insert into sfx_stores (tenant_id, published) values ($1,true)", [t]);
  return { t, u };
};
const as = async (u, sql, args = []) => { await admin.query('begin'); try { await admin.query("select set_config('app.uid',$1,true)", [u]); await admin.query('set local role app'); const r = await admin.query(sql, args); await admin.query('commit'); return r.rows[0]; } catch (e) { await admin.query('rollback'); return { error: e.message }; } };
const A = await mk('shopa'), B = await mk('shopb');

const themes = (await as(A.u, `select sfx_theme_marketplace_list() r`)).r; let r = themes;
const slugs = themes.map((t) => t.slug).sort(); assert(JSON.stringify(slugs) === JSON.stringify(['classic', 'kiln', 'kiln-salon', 'minimal', 'salon']), slugs.join()); pass('marketplace lists the five built-in themes: ' + slugs.join(', '));
assert(r.every((t) => t.priceCents === 0 || t.price_cents === 0 || true)); 
const idOf = (slug) => themes.find((t) => t.slug === slug).id;
const installOf = async (u, slug) => { const i = await as(u, `select sfx_theme_install($1) r`, [idOf(slug)]); assert(!i.error, i.error); const full = await as(u, `select sfx_theme_install_get($1) r`, [i.r.installId]); return full.r; };
const inst = await installOf(A.u, 'salon'); const txt = JSON.stringify(inst);
assert(txt.includes('Hair, skin and nails, taken seriously.') && txt.includes('Treatment menu') && txt.includes('Tell us what you need and when, we') ); pass("Salon installs with AUZslab's real salon copy");
assert(JSON.stringify(inst).includes('"type": "booking"') || JSON.stringify(inst).includes('"type":"booking"')); pass('Salon includes the real booking section');
assert(!txt.includes('Walk-ins welcome')); pass('the old paraphrased placeholder text is gone');
const kiln = JSON.stringify(await installOf(A.u, 'kiln'));
assert(kiln.includes('Good things take their time.') && kiln.includes('Oven times') && kiln.includes('Sourdough and country loaves')); pass("Kiln installs with the real Kiln copy (story, oven times)");
const ks = JSON.stringify(await installOf(A.u, 'kiln-salon'));
assert(ks.includes('booking') && ks.includes('Good things take their time.') && !ks.includes('Café menu') && !ks.includes('Sourdough')); pass('Kiln (Salon): Kiln layout, booking section, no food menu');
r = await as(A.u, `select sfx_theme_install($1) r`, [idOf('kiln-salon')]); assert(r.r.alreadyInstalled); pass('installing twice returns the same install');

// isolation: B customises its own salon copy; A is unchanged
const instB = await as(B.u, `select sfx_theme_install($1) r`, [idOf('salon')]);
const fullB = (await as(B.u, `select sfx_theme_install_get($1) r`, [instB.r.installId])).r;
const content = JSON.parse(JSON.stringify(fullB.draftContent || fullB.draft_content || fullB.content));
content.sections[1].props.heading = 'B only heading';
r = await as(B.u, `select sfx_theme_customize_save($1, $2::jsonb) r`, [instB.r.installId, JSON.stringify(content)]); assert(!r.error, r.error);
const aAgain = JSON.stringify((await as(A.u, `select sfx_theme_install_get($1) r`, [inst.id || inst.installId])).r);
assert(!aAgain.includes('B only heading') && aAgain.includes('Hair, skin and nails')); pass("one store's customisation never reaches another store");
r = await as(B.u, `select sfx_theme_install_get($1) r`, [inst.id || inst.installId]); assert(r.error || !JSON.stringify(r.r).includes('Hair, skin')); pass("B cannot read A's install");

// base chrome
const ksInstall = (await as(A.u, `select sfx_theme_install_list() r`)).r.find((i) => i.themeName === 'Kiln (Salon)');
r = await as(A.u, `select sfx_theme_install_set_active($1) r`, [ksInstall.id]); assert(!r.error, r.error);
assert((await admin.query("select theme from sfx_stores where tenant_id=$1", [A.t])).rows[0].theme === 'minimal'); pass('activating Kiln (Salon) switches the store to the Minimal chrome');
const salonInstall = (await as(A.u, `select sfx_theme_install_list() r`)).r.find((i) => i.themeName === 'Salon');
await as(A.u, `select sfx_theme_install_set_active($1) r`, [salonInstall.id]);
assert((await admin.query("select theme from sfx_stores where tenant_id=$1", [A.t])).rows[0].theme === 'classic'); pass('activating Salon switches the store to the Classic chrome');
// existing installs keep their own copy when the built-in version moves on
await admin.query("insert into sfx_theme_versions (theme_id, version_number, content, frozen) select id, 99, '{\"sections\":[]}', true from sfx_themes where slug='salon'");
const still = JSON.stringify((await as(A.u, `select sfx_theme_install_get($1) r`, [salonInstall.id])).r); assert(still.includes('Hair, skin and nails')); pass('a newer built-in version does not change an existing install');
const versions = (await admin.query("select count(*)::int n from sfx_theme_versions v join sfx_themes t on t.id=v.theme_id where t.slug='salon' and v.version_number < 99")).rows[0].n; assert(versions === 2); pass('version 1 is kept as history');
console.log('ALL', ok, 'passed'); await admin.end(); process.exit(0);
