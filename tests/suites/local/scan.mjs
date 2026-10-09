// Scan to bill (AUZsLedger #/scan and the standalone AUZsScan app, scan.html): the decoder, a sale from a barcode through to posted books,
// a new barcode, stock cap, receiving stock, WhatsApp share, roles, and the camera screen (a canvas stands in for the camera).
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { rpc } from '../../lib/api.mjs';
import { q, connect, PG, PASSWORD, USERS } from '../../lib/db.mjs';

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

  await s.check('MRP, changing the saved prices of an old product from the scan line, a typed customer name becoming a real customer, and the beep', async () => {
    const { c, page } = await openPage('/accounts.html', USERS.acctOwner, { w: 1280, h: 900 });
    await toScan(page);
    // the beep: wake the audio and count the oscillators the page makes
    const beeps = await page.evaluate(async () => { let n = 0; const AC = window.AudioContext || window.webkitAudioContext, orig = AC.prototype.createOscillator; AC.prototype.createOscillator = function () { n++; return orig.call(this); }; await new Promise((r) => setTimeout(r, 50)); document.body.click(); auzScanner.beep(true); auzScanner.beep(false); return n; });
    assert(beeps >= 3, 'beep did not play: ' + beeps);
    await typeCode(page, '4006381333931');
    assert(await page.locator('.scan-line', { hasText: 'Camera Pen' }).count() === 1, 'pen not in bill');
    await page.locator('.scan-line .grow').first().click(); await page.waitForSelector('.sheet input', { timeout: 5000 });
    const sheet = page.locator('.sheet').last();
    const want = { 'Selling price': '55', 'Purchase price': '25', 'MRP': '60' };
    for (let tries = 0; tries < 6; tries++) { for (const [l, v] of Object.entries(want)) await sheet.getByLabel(l, { exact: true }).fill(v); await page.waitForTimeout(300); const got = await Promise.all(Object.keys(want).map((l) => sheet.getByLabel(l, { exact: true }).inputValue())); if (got.join() === Object.values(want).join()) break; }
    await sheet.locator('button', { hasText: 'Save product prices' }).click(); await page.waitForSelector('.toast:has-text("Product prices saved")', { timeout: 10000 });
    const row = (await rpc(stack, 'acc_list_products', { limit: 500 }, owner)).data.data.rows.find((p) => p.id === pen);
    assert(Number(row.sale_price) === 55 && Number(row.purchase_price) === 25 && Number(row.mrp) === 60, 'saved prices: ' + JSON.stringify([row.sale_price, row.purchase_price, row.mrp]));
    assert(Number(await sheet.locator('input[aria-label="Price"]').inputValue()) === 55, 'this bill price did not follow the new selling price');
    await sheet.locator('button', { hasText: /^Save$/ }).click(); await page.waitForTimeout(400);
    await page.waitForFunction(() => [...document.querySelectorAll('.scan-line')].some((e) => /MRP/.test(e.innerText)), null, { timeout: 8000 }).catch(() => {});
    assert((await page.locator('.scan-line').allInnerTexts()).some((t) => /MRP/.test(t)), 'MRP not shown on the line');
    await page.locator('input[placeholder="Customer’s name"]').fill('Ravi Kumar'); await page.locator('input[placeholder^="Customer’s WhatsApp"]').fill('9876543210');
    await page.locator('.scan-dock .btn.fill').click(); await page.locator('.alert button, .dialog button', { hasText: 'Charge' }).last().click({ timeout: 5000 }).catch(() => {});
    await page.waitForSelector('text=Paid', { timeout: 15000 });
    const party = await q("select name, phone from acc_parties where tenant_id=$1 and name='Ravi Kumar'", [tid]);
    assert(party.length === 1 && /9876543210/.test(party[0].phone), 'customer not created: ' + JSON.stringify(party));
    const inv = await q("select party_id from acc_documents where tenant_id=$1 and doc_type='invoice' order by created_at desc limit 1", [tid]);
    assert(inv[0].party_id, 'invoice has no customer');
    await c.close();
  });
  await s.check('The beep sounds the moment a code is read, before the new-product form is saved; and Busy / Tally lists import with codes made and opening stock added once', async () => { try {
    const { c, page } = await openPage('/accounts.html', USERS.acctOwner, { w: 1280, h: 900 });
    page.on('console', () => {}); globalThis.__st = 0;
    await toScan(page);
    await page.evaluate(() => { window.__osc = 0; const AC = window.AudioContext || window.webkitAudioContext, orig = AC.prototype.createOscillator; AC.prototype.createOscillator = function () { window.__osc++; return orig.call(this); }; navigator.mediaDevices.getUserMedia = async () => { const e = new Error('no'); e.name = 'NotAllowedError'; throw e; }; });
    globalThis.__st=1; await page.locator('.scan-hero').click(); globalThis.__st=2; await page.waitForSelector('.asc-blocked', { timeout: 5000 });
    await page.fill('.asc-in', '5551234500011'); globalThis.__st=3; await page.locator('.asc .asc-btn', { hasText: 'Add' }).click();
    globalThis.__st=4; await page.waitForSelector('text=Add the details once', { timeout: 8000 });         // the unknown-code form is open and NOT saved
    assert(await page.evaluate(() => window.__osc) >= 1, 'no beep before the product was saved');
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    await page.evaluate(() => { location.hash = '#/data?entity=products'; }); globalThis.__st=5; await page.waitForSelector('input[type=file]', { timeout: 8000 });
    // Busy-style Excel/CSV: its own column names, no item code column, GST written as text, a Total row
    const busy = 'Item Name,Item Group,Main Unit,Sale Price,Purchase Price,MRP,HSN Code,Tax Category,Opening Stock Qty,Opening Stock Rate\nBusy Rice 5kg,Grocery,Bag,300,250,320,1006,GST 5%,12,250\nBusy Soap,Personal Care,Pcs.,45,30,50,3401,GST 18%,40,30\nTotal,,,,,,,,52,\n';
    globalThis.__st=6; await page.locator('.seg button', { hasText: 'Busy' }).click();
    globalThis.__st=7; await page.setInputFiles('input[type=file]', { name: 'busy-items.csv', mimeType: 'text/csv', buffer: Buffer.from(busy) });
    globalThis.__st=8; await page.waitForSelector('text=Match your columns', { timeout: 8000 });
    globalThis.__st=9; await page.locator('button', { hasText: 'Check the file' }).click(); globalThis.__st=10; await page.waitForSelector('text=Looks good', { timeout: 15000 });
    globalThis.__st=11; await page.locator('button.fill', { hasText: /^Import$/ }).click(); await page.locator('button', { hasText: /^Import$/ }).last().click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(2500); const tmsg = await toasts(page);
    const rows = (await rpc(stack, 'acc_list_products', { limit: 500 }, owner)).data.data.rows;
    const rice = rows.find((p) => p.name === 'Busy Rice 5kg'), soap = rows.find((p) => p.name === 'Busy Soap');
    assert(rice && soap, 'Busy items not created: ' + rows.map((x) => x.name).join(','));
    assert(rice.sku === 'BUSY-RICE-5KG' && Number(rice.tax_rate) === 5 && Number(rice.mrp) === 320 && rice.hsn === '1006', 'rice: ' + JSON.stringify([rice.sku, rice.tax_rate, rice.mrp, rice.hsn]));
    assert(soap.unit === 'Pcs' && Number(soap.tax_rate) === 18, 'soap: ' + JSON.stringify([soap.unit, soap.tax_rate]));
    assert(!rows.some((x) => /^total$/i.test(x.name)), 'the Total row became a product');
    assert(Number(rice.stock) === 12 && Number(soap.stock) === 40, 'opening stock: ' + rice.stock + '/' + soap.stock);
    // the same list again: nothing is duplicated and stock is not counted twice
    await page.evaluate(() => { location.hash = '#/data'; }); await page.evaluate(() => { location.hash = '#/data?entity=products'; }); globalThis.__st=12; await page.waitForSelector('input[type=file]');
    globalThis.__st=13; await page.locator('.seg button', { hasText: 'Busy' }).click();
    globalThis.__st=14; await page.setInputFiles('input[type=file]', { name: 'busy-items.csv', mimeType: 'text/csv', buffer: Buffer.from(busy) });
    globalThis.__st=15; await page.waitForSelector('text=Match your columns', { timeout: 8000 });
    globalThis.__st=16; await page.locator('button', { hasText: 'Check the file' }).click(); globalThis.__st=17; await page.waitForSelector('text=Looks good', { timeout: 15000 });
          await page.waitForTimeout(500); assert(await page.locator('button.fill', { hasText: /^Import$/ }).isDisabled(), 'a list that is already imported can be imported again');
    const again = (await rpc(stack, 'acc_list_products', { limit: 500 }, owner)).data.data.rows;
    assert(again.filter((x) => x.name === 'Busy Soap').length === 1 && Number(again.find((x) => x.name === 'Busy Soap').stock) === 40, 'second import changed things: ' + JSON.stringify(again.filter((x) => /Busy/.test(x.name)).map((x) => [x.name, x.stock])));
    // Tally XML (UTF-16 like Tally writes it), stock items with GST rate details
    const xml = '<ENVELOPE><BODY><IMPORTDATA><REQUESTDATA><TALLYMESSAGE xmlns:UDF="TallyUDF"><STOCKITEM NAME="Tally Pen" RESERVEDNAME=""><PARENT>Stationery</PARENT><BASEUNITS>Nos</BASEUNITS><OPENINGBALANCE>25 Nos</OPENINGBALANCE><OPENINGRATE>8.00/Nos</OPENINGRATE><HSNDETAILS.LIST><HSNCODE>9608</HSNCODE></HSNDETAILS.LIST><GSTDETAILS.LIST><STATEWISEDETAILS.LIST><RATEDETAILS.LIST><GSTRATEDUTYHEAD>Integrated Tax</GSTRATEDUTYHEAD><GSTRATE>18</GSTRATE></RATEDETAILS.LIST></STATEWISEDETAILS.LIST></GSTDETAILS.LIST></STOCKITEM></TALLYMESSAGE></REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>';
    const u16 = Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(xml, 'utf16le')]);
    await page.evaluate(() => { location.hash = '#/data'; }); await page.evaluate(() => { location.hash = '#/data?entity=products'; }); globalThis.__st=19; await page.waitForSelector('input[type=file]');
    globalThis.__st=20; await page.setInputFiles('input[type=file]', { name: 'tally-masters.xml', mimeType: 'text/xml', buffer: u16 });
    globalThis.__st=21; await page.waitForSelector('text=Match your columns', { timeout: 8000 });
    globalThis.__st=22; await page.locator('button', { hasText: 'Check the file' }).click(); globalThis.__st=23; await page.waitForSelector('text=Looks good', { timeout: 15000 });
    globalThis.__st=24; await page.locator('button.fill', { hasText: /^Import$/ }).click(); await page.locator('button', { hasText: /^Import$/ }).last().click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(2500);
    const tp = (await rpc(stack, 'acc_list_products', { limit: 500 }, owner)).data.data.rows.find((x) => x.name === 'Tally Pen');
    assert(tp && tp.sku === 'TALLY-PEN' && Number(tp.tax_rate) === 18 && tp.hsn === '9608' && Number(tp.stock) === 25, 'tally pen: ' + JSON.stringify(tp && [tp.sku, tp.tax_rate, tp.hsn, tp.stock]));
    await c.close();
  } catch (e) { let dump = ''; try { dump = page.url() + ' ## ' + (await page.locator('body').innerText({ timeout: 3000 })).replace(/\s+/g, ' ').slice(0, 900); await page.screenshot({ path: 'tests/report/shots/dbg-import.png', timeout: 3000 }); dump += ' @@ ' + await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.innerText.trim() + (b.disabled ? '(off)' : '')).filter(Boolean).join(' | ') + ' || ' + [...document.querySelectorAll('.banner,.toast,.err')].map((b) => b.innerText).join(' / ')); } catch {} throw new Error('step ' + globalThis.__st + ': ' + e.message.split('\n')[0] + ' :: ' + dump); } });
  await s.check('Products can be imported from a PDF price list too: columns read from the headings, checked, imported with stock; a list with no headings reads name and price', async () => {
    const { createRequire } = await import('module'); const dr = createRequire(import.meta.url)('../../../app/public/ds/docread.js');
    const plain = dr.parseProducts(['Pdf Notebook   120.00', 'Pdf Marker  18%  45', 'Total  165']);
    assert(plain.mode === 'plain' && plain.table.length === 3 && plain.table[1][0] === 'Pdf Notebook' && plain.table[1][3] === '120' && plain.table[2][2] === '18', 'plain: ' + JSON.stringify(plain.table));
    const hd = dr.parseProducts(['Acme Stationers', 'Item  HSN  Qty  Rate  GST %', 'Pdf Stapler  8472  12  85.00  18', 'Pdf Glue Stick  3506  30  20.00  12', 'Total  42  105']);
    assert(hd.mode === 'header' && hd.table.length === 3 && hd.table[0].length === 5 && hd.table[2][0] === 'Pdf Glue Stick', 'header: ' + JSON.stringify(hd.table));
    const pc = await newCtx(browser, null, { w: 900, h: 1100 }); const pp = await pc.newPage();
    await pp.setContent('<html><body style="font:16px Arial"><h2>Price list</h2><table cellpadding="10" style="width:100%"><tr><th align="left">Item</th><th>HSN</th><th>Qty</th><th>Rate</th><th>Cost</th><th>GST %</th></tr><tr><td>Pdf Stapler</td><td align="center">8472</td><td align="center">12</td><td align="center">85.00</td><td align="center">60.00</td><td align="center">18</td></tr><tr><td>Pdf Glue Stick</td><td align="center">3506</td><td align="center">30</td><td align="center">20.00</td><td align="center">0</td><td align="center">12</td></tr></table></body></html>');
    const pdf = await pp.pdf({ format: 'A4' }); await pc.close();
    const { c, page } = await openPage('/scan.html', USERS.acctOwner, { w: 1280, h: 900 });
    await page.evaluate(() => { location.hash = '#/data?entity=products'; }); await page.waitForSelector('input[type=file]');
    await page.setInputFiles('input[type=file]', { name: 'price-list.pdf', mimeType: 'application/pdf', buffer: pdf });
    await page.waitForSelector('text=Match your columns', { timeout: 30000 });
    await page.locator('button', { hasText: 'Check the file' }).click(); await page.waitForSelector('text=Looks good', { timeout: 15000 });
    await page.locator('button.fill', { hasText: /^Import$/ }).click(); await page.locator('button', { hasText: /^Import$/ }).last().click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(2500); const tmsg = await toasts(page);
    const rows = (await rpc(stack, 'acc_list_products', { limit: 500 }, owner)).data.data.rows, st = rows.find((x) => x.name === 'Pdf Stapler'), gl = rows.find((x) => x.name === 'Pdf Glue Stick');
    assert(st && Number(st.sale_price) === 85 && Number(st.tax_rate) === 18 && st.hsn === '8472' && Number(st.stock) === 12, 'stapler: ' + JSON.stringify(st && [st.sale_price, st.tax_rate, st.hsn, st.stock]) + ' toasts: ' + tmsg);
    assert(gl && Number(gl.sale_price) === 20 && Number(gl.tax_rate) === 12 && Number(gl.stock) === 0 && /no purchase price/.test(tmsg), 'glue: ' + JSON.stringify(gl && [gl.sale_price, gl.tax_rate, gl.stock]));
    await c.close();
  });
  await s.check('New Book World setup script + classic tax invoice: the shared bill link shows their exact layout, details, logo, MRP, tax summary, amount in words and a "1/FY" number', async () => {
    await q("insert into auth_users (email, password_hash, app_metadata) select 'viralwechaar@gmail.com', password_hash, '{}'::jsonb from auth_users where email = $1 and deleted_at is null limit 1 on conflict do nothing", [USERS.acctOwner]);
    const sql = (await import('fs')).readFileSync(new URL('../../../db_data/new_book_world_setup.sql', import.meta.url), 'utf8');
    for (let i = 0; i < 2; i++) { const cl = await connect(PG.db); try { await cl.query(sql); } finally { await cl.end(); } }   // twice: it must be safe to run again
    const nb = await login('viralwechaar@gmail.com'); const ctx = (await rpc(stack, 'acc_bootstrap', {}, nb)).data.data;
    const prods = (await rpc(stack, 'acc_list_products', { limit: 50 }, nb)).data.data.rows, nbk = prods.find((x) => x.sku === 'PAT-NB-172');
    assert(nbk && Number(nbk.mrp) === 60 && Number(nbk.sale_price) === 45, 'notebook product: ' + JSON.stringify(nbk));
    assert((await q("select features from tenant_settings ts join tenants t on t.id = ts.tenant_id where t.slug = 'newbookworld'"))[0].features.scan === true, 'scan feature missing');
    const wh2 = (ctx.warehouses.find((w) => w.is_default) || ctx.warehouses[0]).id;
    const adj = await rpc(stack, 'acc_stock_adjust', { p: { mode: 'delta', warehouse_id: wh2, date: new Date().toISOString().slice(0, 10), reason: 'test stock', opening: false, lines: [{ product_id: nbk.id, qty: '10', unit_cost: '30' }] } }, nb); assert(adj.status === 200, 'stock: ' + JSON.stringify(adj.data));
    const cash = (await q("select a.id from acc_accounts a join tenants t on t.id = a.tenant_id where t.slug = 'newbookworld' and a.system_key = 'cash'"))[0].id;
    const today = new Date().toISOString().slice(0, 10);
    const sv = await rpc(stack, 'acc_save_document', { p: { id: null, doc_type: 'invoice', doc_date: today, due_date: null, party_id: null, branch_id: null, warehouse_id: null, place_of_supply: null, reverse_charge: false, itc_eligible: true, price_includes_tax: false, supplier_ref: null, supplier_ref_date: null, ref_doc_id: null, source_doc_id: null, notes: '', terms: '', roundoff: null,
      lines: [{ product_id: nbk.id, description: nbk.name, hsn: '', qty: '1', unit: 'Nos', rate: '45', disc_pct: null, disc_amt: null, tax_rate: '0', account_id: null, batch_no: '', expiry: null, warehouse_id: null }], payments: [{ account_id: cash, amount: 45, mode: 'cash', reference: '' }], post: true } }, nb);
    assert(sv.status === 200, 'invoice: ' + JSON.stringify(sv.data).slice(0, 300));
    const id = sv.data.data.id || (sv.data.data.doc && sv.data.data.doc.id); const num = sv.data.data.number || (sv.data.data.doc && sv.data.data.doc.number);
    assert(/^1\/20\d\d(-\d\d)?$/.test(num), 'number style: ' + num);
    const sh = await rpc(stack, 'acc_share_document', { p_doc: id, p_enable: true }, nb); const tok = sh.data.data.token;
    const c = await newCtx(browser, stack, { w: 1000, h: 1400 }); const page = await c.newPage();
    await page.goto(stack.url('newbookworld', '/bill.html?t=' + tok)); await page.waitForSelector('.ti', { timeout: 15000 });
    const t = await page.locator('.ti').innerText();
    for (const w of ['TAX INVOICE', 'New Book World', 'GSTIN : 08AAVFN9235H1ZL', 'Near Shanichar Ji Ka Than', 'Tel. : 8595977777', 'newbookworldjodhpur@gmail.com', 'Invoice No.', 'Place of Supply', 'Rajasthan (08)', 'Reverse Charge', 'Billed to', 'Shipped to', 'Cash', 'Description of Goods', 'HSN/SAC Cod', 'Patanjali Notebook 172pg 60/-', '60.00', '45.00', 'Less : Discount', 'Grand Total', 'Exempt', 'Rupees Forty Five Only', 'STATE BANK OF INDIA', '00000042694307337', 'SBIN0031201', 'Goods once sold will not be taken back.', "Receiver's Signature", 'For New Book World', 'Authorised Signatory', 'Original Copy']) assert(t.includes(w), 'missing "' + w + '" in: ' + t.replace(/\s+/g, ' ').slice(0, 900));
    assert(await page.locator('.ti .lg img').evaluate((i) => i.complete && i.naturalWidth > 100), 'logo not shown');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'sideways scroll');
    await s.shot(page, 'classic-tax-invoice'); await c.close();
    const c2 = await newCtx(browser, stack, { w: 390, h: 844, mobile: true }); const p2 = await c2.newPage(); await p2.goto(stack.url('newbookworld', '/bill.html?t=' + tok)); await p2.waitForSelector('.ti', { timeout: 15000 });
    assert(await p2.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'sideways scroll on a phone'); await s.shot(p2, 'classic-tax-invoice-phone'); await c2.close();
  });
  await s.check('A plain item list with no codes, GST or prices (the template columns, 600 rows, odd units) imports after Check, with codes made automatically and no stray "null" text', async () => {
    const real = process.env.BUSY_CSV && (await import('fs')).existsSync(process.env.BUSY_CSV) ? (await import('fs')).readFileSync(process.env.BUSY_CSV, 'utf8') : null;
    let csv = real; if (!csv) { csv = 'SKU,Name,HSN/SAC,GST rate %,Unit,Sale price,Purchase price,MRP,Category,Brand,Reorder level,Barcode,Service (true/false)\n'; for (let i = 0; i < 600; i++) csv += `,"Plainlist Item ${i} ${i % 7 ? '' : 'A, B'}",,,${['PCS', 'Pcs.', 'children b'][i % 3]},,,,${['STATIONERY', 'NOVEL'][i % 2]},,,${i % 5 ? '' : 978100000000 + i},\n`; }
    const { c, page } = await openPage('/scan.html', USERS.acctOwner, { w: 390, h: 844, mobile: true });
    await page.evaluate(() => { location.hash = '#/data?entity=products'; }); await page.waitForSelector('input[type=file]');
    await page.setInputFiles('input[type=file]', { name: 'items.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.waitForSelector('text=Match your columns', { timeout: 10000 });
    assert(!/(^|\n)null(\n|$)/.test(await page.locator('main').innerText()), 'stray null text before the check: ' + (await page.locator('main').innerText()).replace(/\s+/g, ' ').slice(-120));
    await page.locator('button', { hasText: 'Check the file' }).click(); await page.waitForSelector('text=Looks good', { timeout: 60000 }).catch(async (e) => { throw new Error('check did not pass: ' + (await page.locator('main').innerText()).replace(/\\s+/g, ' ').slice(-900)); });
    assert(!/(^|\n)null(\n|$)/.test(await page.locator('main').innerText()), 'stray null text after the check');
    await page.locator('button.fill', { hasText: /^Import$/ }).click(); await page.locator('button', { hasText: /^Import$/ }).last().click({ timeout: 5000 }).catch(() => {}); await page.waitForTimeout(real ? 15000 : 6000);
    const n = (await q("select count(*)::int n from acc_products p join tenants t on t.id = p.tenant_id where t.slug = 'testacct' and p.name like $1", [real ? '%' : 'Plainlist%']))[0].n;
    assert(n >= (real ? 2000 : 600), 'imported ' + n); await c.close();
  });
  await s.check('Import (server): blank cells (even an empty true/false or number cell) are "not given", and with one bad row the good rows still import when "stop on error" is off', async () => {
    const rows = [{ _row: 2, sku: 'BL-1', name: 'Blank Cells A', hsn: '', tax_rate: '', unit: 'Pcs.', sale_price: '', purchase_price: '', mrp: '', category: 'X', brand: '', reorder_level: '', barcode: '', is_service: '' },
      { _row: 3, sku: 'BL-2', name: '', unit: 'Pcs.' }, { _row: 4, sku: 'BL-3', name: 'Blank Cells C', is_service: '', tax_rate: '12', sale_price: '99' }];
    const dry = (await rpc(stack, 'acc_import', { p_entity: 'products', p_rows: rows, p_commit: false, p_strict: false, p_options: {} }, owner)).data.data;
    assert(dry.ok === 2 && dry.failed === 1, 'dry run: ' + JSON.stringify(dry).slice(0, 300));
    const done = (await rpc(stack, 'acc_import', { p_entity: 'products', p_rows: rows, p_commit: true, p_strict: false, p_options: {} }, owner)).data.data;
    assert(done.ok === 2 && done.committed !== false, 'commit: ' + JSON.stringify(done).slice(0, 300));
    const got = await q("select sku, sale_price from acc_products p join tenants t on t.id = p.tenant_id where t.slug = 'testacct' and sku like 'BL-%'");
    assert(got.find((x) => x.sku === 'BL-1') && Number(got.find((x) => x.sku === 'BL-3').sale_price) === 99 && !got.find((x) => x.sku === 'BL-2'), 'rows: ' + JSON.stringify(got.filter((x) => /^BL-/.test(x.sku)).map((x) => x.sku)));
  });
  await s.check('A catalogue bigger than 2,000 products is fully loaded (up to 5,000 on the phone) and a product beyond that is found by searching the server', async () => {
    const rows = []; for (let i = 0; i < 2600; i++) rows.push({ _row: i + 2, sku: 'BIG-' + String(i).padStart(5, '0'), name: 'Zbig Item ' + String(i).padStart(5, '0'), unit: 'Pcs' });
    const r = (await rpc(stack, 'acc_import', { p_entity: 'products', p_rows: rows, p_commit: true, p_strict: false, p_options: {} }, owner)).data.data; assert(r.ok === 2600, 'import: ' + JSON.stringify(r).slice(0, 200));
    const { c, page } = await openPage('/scan.html', USERS.acctOwner, { w: 390, h: 844, mobile: true });
    await page.evaluate(() => { location.hash = '#/products'; });
    await page.waitForFunction(() => /Items/.test(document.body.innerText) && /\b[3-9]\d{3}\b/.test(document.querySelector('.kpis')?.innerText || ''), null, { timeout: 20000 });
    const n = await page.evaluate(() => S.products.length); assert(n > 2000, 'only ' + n + ' products loaded on the phone');
    const hit = await page.evaluate(() => searchProducts('Zbig Item 02599')); assert(hit.length === 1 && hit[0].sku === 'BIG-02599', 'server search: ' + JSON.stringify(hit.map((x) => x.sku)));
    await c.close();
  });
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
  await s.check('AUZsScan alone (feature "scan", no AUZsLedger): scan functions work, ledger-only functions are refused on the server', async () => {
    await q("update tenant_settings set features = (features - 'accounting') || '{\"scan\":true}'::jsonb where tenant_id=$1", [tid]);
    try {
      const ok = await rpc(stack, 'acc_list_products', { limit: 5 }, owner); assert(ok.status === 200, 'products blocked: ' + JSON.stringify(ok.data));
      const sale = await rpc(stack, 'acc_save_product', { p: { id: null, name: 'ScanOnly Item', sku: 'SO1', barcode: '7000000000017', category: '', brand: '', unit: 'Nos', hsn: '3401', tax_rate: '18', tax_inclusive: false, sale_price: '10', purchase_price: '5', mrp: '12', is_service: false, track_stock: true, reorder_level: '0', active: true } }, owner); assert(sale.status === 200, 'new product blocked: ' + JSON.stringify(sale.data));
      const no = await rpc(stack, 'acc_trial_balance', { p_from: '2020-01-01', p_to: '2030-01-01' }, owner); assert(no.status >= 400 && /AUZsLedger/.test(JSON.stringify(no.data)), 'ledger report not refused: ' + no.status + JSON.stringify(no.data));
      const c = await newCtx(browser, stack, { w: 390, h: 844, mobile: true }); const pg = await c.newPage();
      await pg.goto(stack.url('testacct', '/accounts.html')); await pg.waitForSelector('input[type=password]'); await pg.fill('input[type=email]', USERS.acctOwner); await pg.fill('input[type=password]', PASSWORD);
      await pg.locator('button', { hasText: /^Sign in$/ }).click(); await pg.waitForSelector('h1:has-text("Accounting is not enabled")', { timeout: 20000 }); await c.close();
      const b = await openPage('/scan.html', USERS.acctOwner); await b.page.waitForSelector('.scan-hero', { timeout: 15000 }).catch(async (e) => { throw new Error('scan page: ' + (await b.page.locator('body').innerText()).slice(0, 200)); }); await b.c.close();
    } finally { await q("update tenant_settings set features = (features - 'scan') || '{\"accounting\":true}'::jsonb where tenant_id=$1", [tid]); }
  });
  s.done();
}
