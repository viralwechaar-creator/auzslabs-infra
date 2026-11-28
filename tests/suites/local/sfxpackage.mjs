// Theme packages: valid ones become a draft theme; unsafe or malformed ones are rejected with reasons.
import { suite, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { q, USERS, PASSWORD } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('Theme packages', 'Upload check: accepted themes import as a draft, bad ones are refused with every reason.');
  await q("update tenant_settings set features = features || '{\"storefront_developer\":true}' where tenant_id = (select id from tenants where slug='testcafe')");
  const ctx = await newCtx(browser, stack, { w: 1280, h: 800 }); const page = await ctx.newPage();
  await page.goto(stack.url('testcafe', '/storefront.html'), { waitUntil: 'load' }); await page.waitForTimeout(800);
  const call = (pkg, dry) => page.evaluate(async ([e, p, pk, d]) => { const c = window.supabase.createClient(CFG.url, CFG.key); await c.auth.signInWithPassword({ email: e, password: p });
    const r = await c.rpc('sfdev_theme_import', { p: pk, p_dry: d }); return r.error ? { rpcError: r.error.message } : r.data; }, [USERS.cafeOwner, PASSWORD, pkg, dry]);
  const good = { format: 'auzslab-theme', formatVersion: 1, name: 'Pack test', description: 'x', content: { sections: [{ id: 'a1', type: 'text', props: { heading: 'Hello', body: 'World' } }, { id: 'f1', type: 'faq', props: { heading: 'Q' }, blocks: [{ id: 'b1', type: 'question', props: { question: 'Q?', answer: 'A.' } }] }] } };
  await s.check('A valid package passes the dry run and creates nothing', async () => {
    const r = await call(good, true); assert(r.ok === true && !r.imported, JSON.stringify(r));
  }, 'critical');
  await s.check('Importing creates a draft theme with version 1', async () => {
    const r = await call(good, false); assert(r.imported && r.id, JSON.stringify(r));
    const l = await page.evaluate(async (id) => { const c = window.supabase.createClient(CFG.url, CFG.key); const g = await c.rpc('sfdev_theme_get', { p_id: id }); return g.error ? g.error.message : JSON.stringify(g.data).slice(0, 400); }, r.id);
    assert(/draft/.test(l), l);
  }, 'critical');
  const bad = async (pkg, re, label) => s.check('Rejected: ' + label, async () => { const r = await call(pkg, true); assert(r.ok === false && re.test(JSON.stringify(r.errors || r)), JSON.stringify(r)); }, 'major');
  await bad({ ...good, format: 'zip' }, /format/i, 'wrong format');
  await bad({ ...good, name: '' }, /name/i, 'no name');
  await bad({ ...good, script: 'x' }, /top level/i, 'extra top-level key');
  await bad({ ...good, content: { sections: [{ id: 'a', type: 'nonsense', props: {} }] } }, /unknown type/i, 'unknown section type');
  await bad({ ...good, content: { sections: [{ id: 'a', type: 'text', props: { body: '<script>alert(1)</script>' } }] } }, /script/i, 'script tag');
  await bad({ ...good, content: { sections: [{ id: 'a', type: 'text', props: { body: 'x' } }], code: 'x' } }, /Unknown content part/i, 'unknown content part');
  await bad({ ...good, content: { sections: [{ id: 'a', type: 'button', props: { label: 'go', href: 'javascript:alert(1)' } }] } }, /javascript|refused/i, 'javascript link');
  await s.check('Section and item names and locks survive the cleaner', async () => {
    const pk = { ...good, content: { sections: [{ id: 'a1', type: 'text', name: 'My <b>intro</b>', locked: true, props: { heading: 'Hi' } }, { id: 'f1', type: 'faq', props: {}, blocks: [{ id: 'b1', type: 'question', name: 'First', locked: true, props: { question: 'Q?', answer: 'A' } }] }] } };
    const r = await call(pk, false); assert(r.imported, JSON.stringify(r));
    const g = await page.evaluate(async (id) => { const c = window.supabase.createClient(CFG.url, CFG.key); const x = await c.rpc('sfdev_theme_export', { p_id: id }); return x.error ? x.error.message : x.data.content; }, r.id);
    const a = g.sections[0], b = g.sections[1].blocks[0];
    assert(a.name === 'My bintro/b' && a.locked === true && b.name === 'First' && b.locked === true, JSON.stringify(g));
  }, 'major');
  s.done();
}
