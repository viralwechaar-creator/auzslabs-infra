// Reading a supplier invoice or a menu from a PDF / photo: free, on the device. The reader must find the right
// fields, must show a draft (never save by itself), and the draft must become a real bill / real menu items.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { rpc } from '../../lib/api.mjs';
import { q, PASSWORD, USERS } from '../../lib/db.mjs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const R = createRequire(import.meta.url)(path.join(here, '../../../app/public/ds/docread.js'));

const INVOICE = `<html><body style="font:14px Arial;padding:30px">
<h2>TAX INVOICE</h2><h3>Fresh Fruits Traders</h3><div>Shop 14, Mandi Road, Jodhpur</div><div>Ph: 98290 11223</div><div>GSTIN: 08ABCDE1234F1Z0</div>
<div>Invoice No: FFT/2026/0457 &nbsp;&nbsp; Date: 12/09/2026</div><div>Bill To: Test Cafe</div><br>
<table border="1" cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%">
<tr><th>S.No</th><th>Description</th><th>HSN</th><th>Qty</th><th>Rate</th><th>Amount</th></tr>
<tr><td>1</td><td>Mango Alphonso</td><td>0804</td><td>20 kg</td><td>120.00</td><td>2,400.00</td></tr>
<tr><td>2</td><td>Banana Robusta</td><td>0803</td><td>15 kg</td><td>45.00</td><td>675.00</td></tr>
<tr><td>3</td><td>Orange Juice Concentrate</td><td>2202</td><td>12 pcs</td><td>210.00</td><td>2,520.00</td></tr>
</table><br><div>Sub Total &nbsp; 5,595.00</div><div>CGST 2.5% &nbsp; 139.88</div><div>SGST 2.5% &nbsp; 139.88</div><div><b>Grand Total &nbsp; 5,874.76</b></div></body></html>`;
const MENU = `<html><body style="font:18px Arial;padding:30px"><h2>SHAKES</h2><div>Mango Shake ........ 120</div><div>Banana Shake ........ 100</div><div>Cold Coffee ........ 90</div>
<h2>SANDWICHES</h2><div>Veg Grilled Sandwich ........ 80</div><div>Chicken Club Sandwich ........ 150</div></body></html>`;

export default async function run({ browser, stack }) {
  const s = suite('Reading invoices and menus from PDF / photo', 'Real PDFs and photos are made in Chromium, read in the apps, shown as a draft, and only then saved.');
  const login = async (email) => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json()).access_token;

  await s.check('Parser: invoice text gives supplier, GSTIN, number, date, rows and totals', async () => {
    const t = ['TAX INVOICE', 'Fresh Fruits Traders', 'GSTIN: 08ABCDE1234F1Z0', 'Invoice No: FFT/2026/0457    Date: 12/09/2026', 'Bill To: Test Cafe  GSTIN: 08AAAAA0000A1Z5',
      'S.No  Description  HSN  Qty  Rate  Amount', '1  Mango Alphonso  0804  20 kg  120.00  2,400.00', '2  Banana Robusta  0803  15 kg  45.00  675.00', '3  Packaging cartons  4819  50  8.00  400.00',
      'Sub Total  3,475.00', 'CGST 2.5%  86.88', 'SGST 2.5%  86.88', 'Grand Total  3,648.76'].join('\n');
    const d = R.parseInvoice(t, { ownGstin: '08AAAAA0000A1Z5' });
    assert(d.supplier.name === 'Fresh Fruits Traders' && d.supplier.gstin === '08ABCDE1234F1Z0', JSON.stringify(d.supplier));
    assert(d.invoice_no === 'FFT/2026/0457' && d.date === '2026-09-12', d.invoice_no + ' ' + d.date);
    assert(d.lines.length === 3 && d.lines[0].qty === 20 && d.lines[0].rate === 120 && d.lines[2].qty === 50 && d.lines[2].rate === 8, JSON.stringify(d.lines));
    assert(d.total === 3648.76 && d.subtotal === 3475 && d.default_tax === 5 && d.price_includes_tax === false, JSON.stringify([d.total, d.subtotal, d.default_tax]));
    assert(!d.notes.length, d.notes.join(' | '));
  }, 'critical');
  await s.check('Parser: a messy page warns instead of inventing rows; the menu text gives categories, prices and sizes', async () => {
    const d = R.parseInvoice('hello\nthis is not an invoice', {}); assert(d.lines.length === 0 && d.notes.length >= 1, 'should warn');
    const m = R.parseMenu('SHAKES\nMango Shake ..... 120\nBanana Shake 100/150\nSANDWICHES\nChicken Club Sandwich 150');
    assert(m.categories.length === 2 && m.categories[0].items[1].sizes.length === 2 && m.categories[1].items[0].veg === 'nonveg', JSON.stringify(m));
  });

  const pdfOf = async (html) => { const c = await newCtx(browser, null, { w: 900, h: 1100 }); const p = await c.newPage(); await p.setContent(html); const buf = await p.pdf({ format: 'A4' }); const png = await p.screenshot({ fullPage: true }); await c.close(); return { pdf: buf, png }; };
  const inv = await pdfOf(INVOICE), mnu = await pdfOf(MENU);

  // ---- Accounting: scan -> draft in the editor -> saved with the file attached
  const owner = await login(USERS.acctOwner); await rpc(stack, 'acc_bootstrap', {}, owner);
  const tid = (await q("select id from tenants where slug='testacct'"))[0].id;
  const c = await newCtx(browser, stack, { w: 1280, h: 900 }); const page = await c.newPage(); const errs = watch(page);
  await page.goto(stack.url('testacct', '/accounts.html')); await page.waitForSelector('input[type=password]'); await page.fill('input[type=email]', USERS.acctOwner); await page.fill('input[type=password]', PASSWORD);
  await page.locator('button', { hasText: /^Sign in$/ }).click(); await page.waitForSelector('.shell', { timeout: 15000 });
  const scan = async (file) => { const [fc] = await Promise.all([page.waitForEvent('filechooser'), page.evaluate(() => scanInvoice('bill'))]); await fc.setFiles(file); };

  await s.check('Accounting: a text PDF is read in the browser and opens as a draft bill with the right rows (nothing saved yet)', async () => {
    await page.evaluate(() => { location.hash = '#/purchases'; }); await page.waitForTimeout(500);
    const before = Number((await q('select count(*)::int n from acc_documents where tenant_id=$1', [tid]))[0].n);
    await scan({ name: 'fruits.pdf', mimeType: 'application/pdf', buffer: inv.pdf });
    await page.waitForFunction(() => /new\/bill/.test(location.hash) && document.querySelector('.banner.info'), null, { timeout: 40000 });
    const t = await page.locator('.banner.info').first().innerText(); assert(/Draft read from fruits\.pdf/.test(t) && /Fresh Fruits Traders/.test(t) && /not in your suppliers/.test(t), t);
    const descs = await page.$$eval('.lines input[aria-label="Item"]', (els) => els.map((e) => e.value)); assert(descs.length === 3 && /Mango/.test(descs[0]), JSON.stringify(descs));
    const after = Number((await q('select count(*)::int n from acc_documents where tenant_id=$1', [tid]))[0].n); assert(after === before, 'a document was saved before the person pressed Save');
    await s.shot(page, 'scanned-invoice-draft');
  }, 'critical');
  await s.check('Accounting: after adding the supplier and saving, the bill exists with its number, date, amounts and the PDF attached', async () => {
    await page.locator('.banner.info button', { hasText: 'Add this supplier' }).click(); await page.waitForSelector('.sheet'); await page.locator('.sheet .sheet-f .btn.fill').last().click();
    await page.waitForFunction(() => !document.querySelector('.sheet'), null, { timeout: 15000 }); await page.waitForTimeout(800);
    await page.locator('.dock .btn', { hasText: 'Save draft' }).click(); await page.waitForFunction(() => /#\/doc\//.test(location.hash), null, { timeout: 20000 }); await page.waitForTimeout(1200);
    const d = (await q("select id, supplier_ref, doc_date::text d, total::float8 t, party_id from acc_documents where tenant_id=$1 and supplier_ref='FFT/2026/0457'", [tid]))[0];
    assert(d && d.d === '2026-09-12' && d.party_id, 'bill missing: ' + JSON.stringify(d)); assert(Math.abs(d.t - 5874.76) < 0.05, 'total ' + d.t);
    const att = Number((await q("select count(*)::int n from acc_attachments where tenant_id=$1 and entity_id=$2", [tid, d.id]))[0].n).valueOf(); assert(att === 1, 'file not attached: ' + att);
  }, 'critical');
  await s.check('Accounting: a photo is read by the free reader (slower, may have mistakes) and still opens as a draft', async () => {
    await page.evaluate(() => { location.hash = '#/purchases'; }); await page.waitForTimeout(500);
    await scan({ name: 'fruits.png', mimeType: 'image/png', buffer: inv.png });
    await page.waitForFunction(() => /new\/bill/.test(location.hash) && document.querySelector('.banner.info'), null, { timeout: 150000 });
    const t = await page.locator('.banner.info').first().innerText(); assert(/photo reading/.test(t), t);
    const descs = await page.$$eval('.lines input[aria-label="Item"]', (els) => els.map((e) => e.value)); assert(descs.some((d) => /mango/i.test(d)), 'photo rows: ' + JSON.stringify(descs));
  }, 'major');
  await s.check('Accounting: no script errors on the way', async () => { assert(!errs.filter((e) => !/sentry/i.test(e)).length, errs.slice(0, 3).join(' | ')); });
  await c.close();

  // ---- Console: menu file -> draft -> items
  const c2 = await newCtx(browser, stack, { w: 1280, h: 900 }); const p2 = await c2.newPage(); const e2 = watch(p2);
  await p2.goto(stack.url('testcafe', '/dashboard.html'), { waitUntil: 'load' }); await p2.waitForSelector('input[type=password]', { timeout: 15000 });
  await p2.fill('input[type=email]', USERS.cafeOwner); await p2.fill('input[type=password]', PASSWORD); await p2.locator('button', { hasText: /sign in/i }).last().click(); await p2.waitForSelector('.hello', { timeout: 15000 });
  await s.check('Console: a menu PDF becomes a draft of categories and items; Create adds them', async () => {
    await p2.evaluate(() => go('menu/items')); await p2.waitForSelector('button:has-text("Read menu file")', { timeout: 10000 });
    const [fc] = await Promise.all([p2.waitForEvent('filechooser'), p2.locator('button', { hasText: 'Read menu file' }).click()]); await fc.setFiles({ name: 'menu.pdf', mimeType: 'application/pdf', buffer: mnu.pdf });
    await p2.waitForSelector('text=Check the menu we read', { timeout: 40000 });
    const n = await p2.locator('.modal input[aria-label="Item name"]').count(); assert(n === 5, 'rows ' + n);
    await p2.locator('.modal input[aria-label="Item name"]').first().fill('Mango Shake Special');
    await p2.locator('.modal button', { hasText: 'Create menu' }).click(); await p2.waitForSelector('.toast', { timeout: 10000 }); await p2.waitForTimeout(500); await p2.evaluate(() => syncNow()); await p2.waitForTimeout(3000);
    const tidc = (await q("select id from tenants where slug='testcafe'"))[0].id;
    const items = await q("select data->>'name' n, (data->>'price')::float8 p, data->>'veg' v from records where tenant_id=$1 and kind='item' and data->>'name' in ('Mango Shake Special','Chicken Club Sandwich','Cold Coffee')", [tidc]);
    assert(items.length === 3 && items.find((i) => i.n === 'Chicken Club Sandwich').p === 150 && items.find((i) => i.n === 'Chicken Club Sandwich').v === 'nonveg', JSON.stringify(items));
    const cats = await q("select data->>'name' n from records where tenant_id=$1 and kind='cat' and data->>'name' in ('Shakes','Sandwiches')", [tidc]); assert(cats.length === 2, JSON.stringify(cats));
    assert(!e2.filter((e) => !/sentry/i.test(e)).length, e2.slice(0, 3).join(' | '));
  }, 'critical');
  await c2.close();
  s.done();
}
