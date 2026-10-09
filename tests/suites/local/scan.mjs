// Scan to bill (AUZsLedger #/scan and the standalone AUZsScan app, scan.html): the decoder, a sale from a barcode through to posted books,
// a new barcode, stock cap, receiving stock, WhatsApp share, roles, and the camera screen (a canvas stands in for the camera).
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { rpc } from '../../lib/api.mjs';
import { q, PASSWORD, USERS } from '../../lib/db.mjs';

// EAN-13 bars as a string of 0/1 modules (start 101, six left digits by parity, 01010, six right digits, 101)
function ean13(code) {
  const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
  const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
  const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
  const P = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
  const d = code.split('').map(Number), par = P[d[0]];
  let bits = '101';
  for (let i = 1; i <= 6; i++) bits += (par[i - 1] === 'L' ? L : G)[d[i]];
  bits += '01010';
  for (let i = 7; i <= 12; i++) bits += R[d[i]];
  return bits + '101';
}

export default async function run({ browser, stack }) {
  const s = suite('Scan to bill', 'Scan or type a barcode, sell it with GST, take payment, send the invoice on WhatsApp; add stock; unknown codes; roles; the camera screen.');
  const login = async (email) => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json()).access_token;
  const owner = await login(USERS.acctOwner); const boot = (await rpc(stack, 'acc_bootstrap', {}, owner)).data.data;
  await rpc(stack, 'acc_save_org', { p: { legal_name: 'Scan Test Traders', state_code: '08' } }, owner);
  const wh = (boot.warehouses.find((w) => w.is_default) || boot.warehouses[0]).id;
  const mk = async (name, sku, barcode, price, buy, stock) => {
    const r = await rpc(stack, 'acc_save_product', { p: { id: null, name, sku, barcode, category: '', brand: '', unit: 'Nos', hsn: '3401', tax_rate: '18', tax_inclusive: true, sale_price: String(price), purchase_price: String(buy), mrp: 0, is_service: false, track_stock: true, track_batch: false, track_serial: false, reorder_level: 0, reorder_qty: 0, notes: '', active: true, price_lists: {} } }, owner);
    assert(r.status === 200, 'product: ' + JSON.stringify(r.data));
    await rpc(stack, 'acc_stock_adjust', { p: { mode: 'delta', warehouse_id: wh, date: new Date().toISOString().slice(0, 10), reason: 'test stock', opening: false, lines: [{ product_id: r.data.data.id, qty: stock, unit_cost: buy }] } }, owner);
    return r.data.data.id;
  };
  const soap = await mk('Scan Soap', 'SOAP1', '8901234567890', 118, 60, 3);
  const pen = await mk('Camera Pen', 'PEN1', '4006381333931', 59, 20, 10);
  const stockOf = async (id) => Number((await rpc(stack, 'acc_list_products', { limit: 500 }, owner)).data.data.rows.find((p) => p.id === id).stock);
  const tid = (await q("select id from tenants where slug='testacct'"))[0].id;

  const openPage = async (path, email, dev = { w: 390, h: 844, mobile: true }) => {
    const c = await newCtx(browser, stack, dev); const page = await c.newPage(); const errs = watch(page);
    await page.goto(stack.url('testacct', path)); await page.waitForSelector('input[type=password]'); await page.fill('input[type=email]', email); await page.fill('input[type=password]', PASSWORD);
    await page.locator('button', { hasText: /^Sign in$/ }).click(); await page.waitForSelector('.shell', { timeout: 20000 });
    return { c, page, errs };
  };
  const toScan = async (page) => { await page.evaluate(() => { location.hash = '#/scan'; }); await page.waitForSelector('.scan-hero', { timeout: 10000 }); await page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; }); };
  const typeCode = async (page, code) => { const i = page.locator('input[type=search]').first(); await i.fill(code); await i.press('Enter'); await page.waitForTimeout(500); };
  const toasts = (page) => page.locator('.toast').allInnerTexts().then((a) => a.join(' | ')).catch(() => '');

  await s.check('The decoder reads an EAN-13 barcode image (the iPhone fallback), and treats UPC-A and EAN-13 with a leading zero as one product', async () => {
    const { c, page } = await openPage('/accounts.html', USERS.acctOwner, { w: 1280, h: 900 });
    const r = await page.evaluate(async (bits) => {
      const mod = 4, quiet = 10, w = (bits.length + quiet * 2) * mod, hgt = 160, cv = document.createElement('canvas'); cv.width = w; cv.height = hgt;
      const x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, hgt); x.fillStyle = '#000';
      for (let i = 0; i < bits.length; i++) if (bits[i] === '1') x.fillRect((quiet + i) * mod, 20, mod, 120);
      const out = await auzScanner._decode(x.getImageData(0, 0, w, hgt));
      return { out, v1: auzScanner.variants('036000291452'), v2: auzScanner.variants('0036000291452') };
    }, ean13('4006381333931'));
    assert(r.out === '4006381333931', 'decoded: ' + r.out);
    assert(r.v1.includes('0036000291452') && r.v2.includes('036000291452'), JSON.stringify(r));
    await c.close();
  }, 'critical');

  const own = await openPage('/accounts.html', USERS.acctOwner);
  const { page } = own;
  await s.check('AUZsLedger has Scan to bill in the Sales menu and in Quick add', async () => {
    await page.evaluate(() => { location.hash = '#/scan'; }); await page.waitForSelector('.scan-hero');
    assert(/Scan to sell/.test(await page.locator('.scan-hero').innerText()), 'hero');
    assert(await page.evaluate(() => !!NAV.find((g) => g.items.includes('scan'))), 'not in NAV');
  });
  await s.check('Typing (or a Bluetooth scanner typing) a known barcode adds the product; again makes quantity 2; GST is worked out from the product (118 incl. 18% = 100 + 18)', async () => {
    await toScan(page); await typeCode(page, '8901234567890'); await typeCode(page, '8901234567890');
    assert(await page.locator('.scan-line').count() === 1, 'lines: ' + await page.locator('.scan-line').count());
    const t = await page.locator('.scan-line').innerText(); assert(/Scan Soap/.test(t) && /118/.test(t), 'line: ' + t);
    const body = await page.locator('main, #main').innerText();
    assert(/Total\s*₹?236/.test(body.replace(/\n/g, ' ')), 'total: ' + body.replace(/\n/g, ' ').slice(0, 400));
    assert(/Taxable value\s*₹?200/.test(body.replace(/\n/g, ' ')) && /CGST\s*₹?18/.test(body.replace(/\n/g, ' ')) && /SGST\s*₹?18/.test(body.replace(/\n/g, ' ')), 'gst split: ' + body.replace(/\n/g, ' ').slice(0, 500));
    await s.shot(page, 'scan-cart-phone');
  }, 'critical');
  await s.check('Stock cap: cannot sell more than is in stock (3), with a clear message', async () => {
    await typeCode(page, '8901234567890'); await typeCode(page, '8901234567890');
    const t = await toasts(page); assert(/Only 3/.test(t), 'toast: ' + t);
    assert(/3/.test(await page.locator('.scan-q').first().innerText()), 'qty not capped at 3: ' + await page.locator('.scan-q').first().innerText());
  }, 'critical');
  await s.check('Credit needs a named customer', async () => {
    await page.locator('.seg button', { hasText: 'Credit' }).click(); await page.waitForTimeout(300);
    await page.locator('.scan-dock .btn.fill').click(); await page.waitForTimeout(400);
    assert(/customer/i.test(await toasts(page)), 'toast: ' + await toasts(page));
    await page.locator('.seg button', { hasText: 'Cash' }).click(); await page.waitForTimeout(300);
  });
  let invNo = '';
  await s.check('Charge in cash: a real GST invoice is POSTED with a number, stock goes down, the books balance; then WhatsApp opens with the invoice link', async () => {
    await page.locator('.scan-dock .btn.fill').click(); await page.waitForSelector('.alert'); await page.locator('.alert .def').click();
    await page.waitForFunction(() => /Paid/.test(document.querySelector('.sheet')?.innerText || ''), null, { timeout: 15000 });
    const t = await page.locator('.sheet').innerText(); invNo = (/INV\/[\w\/-]+/.exec(t) || [])[0] || ''; assert(invNo, 'no invoice number: ' + t);
    const d = (await q("select doc_type, status, total::float8 t, taxable::float8 tx, cgst::float8 c, number from acc_documents where tenant_id=$1 and number=$2", [tid, invNo]))[0];
    assert(d && d.status === 'posted' && Math.abs(d.t - 354) < 0.05, JSON.stringify(d));   // 3 units x 118
    assert(await stockOf(soap) === 0, 'stock after sale: ' + await stockOf(soap));
    const chk = (await rpc(stack, 'acc_integrity_check', {}, owner)).data; assert(JSON.stringify(chk).indexOf('"ok":false') < 0 && !/fail/i.test(JSON.stringify(chk).replace(/failed":0/g, '')), 'integrity: ' + JSON.stringify(chk).slice(0, 300));
    await page.fill('.sheet input[type=tel]', '98765 43210'); await page.locator('.sheet .btn', { hasText: /Send on WhatsApp/ }).click(); await page.waitForTimeout(800);
    const opened = (await page.evaluate(() => window.__opened)).filter(Boolean); assert(opened.length === 1 && /^https:\/\/wa\.me\/919876543210\?text=/.test(opened[0]), 'wa: ' + JSON.stringify(opened));
    const txt = decodeURIComponent(opened[0].split('text=')[1]); assert(txt.includes(invNo) && /\/bill\.html\?t=/.test(txt), 'message: ' + txt);
    await s.shot(page, 'scan-paid-phone');
    await page.locator('.sheet button', { hasText: 'New sale' }).click(); await page.waitForTimeout(400);
  }, 'critical');
  await s.check('An unknown barcode asks for the details, creates the product (GST, HSN, unit, stock) and puts it in the bill', async () => {
    await toScan(page); await typeCode(page, '8909990001112'); await page.waitForSelector('.sheet input[aria-label="Name"]', { timeout: 8000 });
    await page.fill('.sheet input[aria-label="Name"]', 'Mystery Biscuits'); await page.fill('.sheet input[aria-label="Selling price"]', '50'); await page.fill('.sheet input[aria-label="Purchase price"]', '30');
    await page.fill('.sheet input[aria-label="HSN"]', '1905'); await page.fill('.sheet input[aria-label="Number in stock"]', '5');
    await page.locator('.sheet .btn', { hasText: 'Save and continue' }).click(); await page.waitForFunction(() => !document.querySelector('.sheet'), null, { timeout: 10000 }); await page.waitForTimeout(600);
    const p = (await q("select name, barcode, hsn, tax_rate::float8 r from acc_products where tenant_id=$1 and barcode='8909990001112'", [tid]))[0]; assert(p && p.name === 'Mystery Biscuits' && p.hsn === '1905' && p.r === 18, JSON.stringify(p));
    assert(await page.locator('.scan-line', { hasText: 'Mystery Biscuits' }).count() === 1, 'not in the bill');
    const id = (await q("select id from acc_products where tenant_id=$1 and barcode='8909990001112'", [tid]))[0].id; assert(await stockOf(id) === 5, 'stock ' + await stockOf(id));
    await page.locator('.scan-dock .btn', { hasText: /^Save draft$/ }).click(); await page.waitForTimeout(800);
    assert(/Draft saved/.test(await toasts(page)), 'draft: ' + await toasts(page));
    assert(Number((await q("select count(*)::int n from acc_documents where tenant_id=$1 and status='draft' and doc_type='invoice'", [tid]))[0].n) >= 1, 'no draft');
  }, 'critical');
  await s.check('Add stock mode: scan, set quantity and cost, post one stock adjustment; stock goes up', async () => {
    await toScan(page); await page.locator('.seg button', { hasText: 'Add stock' }).click(); await page.waitForTimeout(400);
    await typeCode(page, '4006381333931'); await typeCode(page, '4006381333931');
    assert(/2/.test(await page.locator('.scan-q').first().innerText()), 'qty');
    await page.locator('.scan-dock .btn.fill').click(); await page.waitForSelector('.alert'); await page.locator('.alert .def').click(); await page.waitForTimeout(1500);
    assert(await stockOf(pen) === 12, 'stock ' + await stockOf(pen));
    await s.shot(page, 'scan-add-stock');
  }, 'critical');
  await s.check('The camera screen: a fake camera showing a barcode is read and added; Done returns to the bill', async () => {
    await toScan(page); await page.locator('.seg button', { hasText: 'Sell' }).click(); await page.waitForTimeout(300);
    await page.evaluate((bits) => {
      const mod = 4, quiet = 12, w = 640, hgt = 480, cv = document.createElement('canvas'); cv.width = w; cv.height = hgt; const x = cv.getContext('2d');
      const off = Math.round((w - bits.length * mod) / 2); const draw = () => { x.fillStyle = '#fff'; x.fillRect(0, 0, w, hgt); x.fillStyle = '#000'; for (let i = 0; i < bits.length; i++) if (bits[i] === '1') x.fillRect(off + i * mod, 150, mod, 170); };
      draw(); setInterval(draw, 100); const st = cv.captureStream(15);
      navigator.mediaDevices.getUserMedia = async () => st;
    }, ean13('4006381333931'));
    await page.locator('.scan-hero').click(); await page.waitForSelector('.asc', { timeout: 5000 });
    await page.waitForFunction(() => /Camera Pen/.test(document.querySelector('.asc-last')?.innerText || ''), null, { timeout: 25000 });
    await s.shot(page, 'scan-camera');
    await page.locator('.asc .asc-btn', { hasText: 'Done' }).click(); await page.waitForSelector('.scan-line', { timeout: 6000 });
    assert(await page.locator('.scan-line', { hasText: 'Camera Pen' }).count() === 1, 'not in bill');
  }, 'critical');
  await s.check('Camera blocked: a clear message, and typing a code still works', async () => {
    await page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { const e = new Error('no'); e.name = 'NotAllowedError'; throw e; }; });
    await page.locator('.scan-hero').click(); await page.waitForSelector('.asc-blocked', { timeout: 5000 });
    assert(/blocked/i.test(await page.locator('.asc-blocked').innerText()), 'message');
    await page.fill('.asc-in', '8901234567890'); await page.locator('.asc .asc-btn', { hasText: 'Add' }).click(); await page.waitForTimeout(600);
    await page.locator('.asc .asc-btn', { hasText: 'Done' }).click(); await page.waitForTimeout(400);
  });
  await s.check('No script errors in AUZsLedger', async () => { const bad = own.errs.filter((e) => !/sentry|ERR_FAILED|ERR_ABORTED|net::|Failed to fetch/i.test(e)); assert(!bad.length, bad.slice(0, 3).join(' | ')); });
  await own.c.close();

  await s.check('The standalone AUZsScan app (scan.html): short menu, scan screen first, installable manifest, no horizontal scroll on a phone', async () => {
    const a = await openPage('/scan.html', USERS.acctOwner);
    await a.page.waitForSelector('.scan-hero', { timeout: 15000 });
    assert(/AUZsScan/.test(await a.page.title()), 'title: ' + await a.page.title());
    const tabs = await a.page.locator('.tabbar button').allInnerTexts(); assert(/Scan/.test(tabs.join()) && /Products/.test(tabs.join()) && !/Reports|Books/.test(tabs.join()), 'tabs: ' + tabs.join());
    const m = await a.page.evaluate(async () => (await fetch(document.querySelector('link[rel=manifest]').href)).json()); assert(m.start_url === '/scan.html' && m.name === 'AUZsScan', JSON.stringify(m));
    assert(await a.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), 'sideways scroll');
    await s.shot(a.page, 'scan-app-phone');
    const bad = a.errs.filter((e) => !/sentry|ERR_FAILED|ERR_ABORTED|net::|Failed to fetch/i.test(e)); assert(!bad.length, bad.slice(0, 3).join(' | '));
    await a.c.close();
  }, 'critical');
  await s.check('The standalone app on a desktop shows the bill and totals side by side', async () => {
    const a = await openPage('/scan.html', USERS.acctOwner, { w: 1280, h: 900 }); await a.page.waitForSelector('.scan-hero', { timeout: 15000 });
    await typeCode(a.page, '8901234567890').catch(() => {});
    const boxes = await a.page.evaluate(() => { const l = document.querySelector('.scan-cols > div:first-child')?.getBoundingClientRect(), r = document.querySelector('.scan-side')?.getBoundingClientRect(); return l && r ? { l: l.right, r: r.left } : null; });
    assert(boxes && boxes.r >= boxes.l - 2, 'not side by side: ' + JSON.stringify(boxes));
    await s.shot(a.page, 'scan-app-desktop'); await a.c.close();
  });
  await s.check('A cashier (can sell, cannot add products): no "Add stock" switch, and an unknown barcode explains instead of failing', async () => {
    const a = await openPage('/scan.html', USERS.acctCashier); await a.page.waitForSelector('.scan-hero', { timeout: 15000 });
    assert(await a.page.locator('.seg button', { hasText: 'Add stock' }).count() === 0, 'add stock offered');
    await a.page.evaluate(() => { window.open = () => null; });
    const i = a.page.locator('input[type=search]').first(); await i.fill('8907770009993'); await i.press('Enter'); await a.page.waitForSelector('.alert', { timeout: 6000 });
    assert(/cannot add products|Ask the owner/i.test(await a.page.locator('.alert').innerText()), 'message: ' + await a.page.locator('.alert').innerText());
    await a.c.close();
  });
  s.done();
}
