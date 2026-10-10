// Request-first onboarding (db/155): a visitor sends a request (no prices, no payment); the platform admin verifies, builds a quote
// (products, GST, discount, setup fee, custom charges), sends the payment link; the client accepts the terms, pays, uploads a screenshot;
// the admin confirms the payment (access switched on, gapless bill number, renewal dates) and the A4 bill with the PAID stamp is shown.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { q, PASSWORD, USERS } from '../../lib/db.mjs';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

export default async function run({ browser, stack }) {
  const s = suite('Client requests: request, verify, quote, pay, confirm, bill', 'Cart sends a request only; the admin builds the quote and the payment link; the client accepts the terms and uploads a screenshot; confirming gives access and an A4 bill.');
  const login = async (email) => { const d = await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json(); return (d.data || d).access_token; };
  const call = async (fn, args, tok) => { const r = await fetch(stack.apiBase + '/rpc/' + fn, { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(args) }); let d = null; try { d = await r.json(); } catch {} return { status: r.status, data: d && d.data !== undefined ? d.data : d, raw: d }; };
  const adm = await login(USERS.admin), cust = await login(USERS.plain), other = await login(USERS.cafeOwner);
  let tokA, idA, tokB, idB;

  await s.check('A request needs a login, a real phone and a business name; a valid one is stored as "requested" with a secret link', async () => {
    const base = { contact_name: 'Ravi Test', phone: '9812345678', email: 'ravi@test.local', business_name: 'Plain Cafe', niche: 'cafe', gstin: '08ABCDE1234F1Z5', address: 'Shop 4, Jodhpur', requirement: 'Billing, QR ordering and payroll for one cafe', products: ['pos', 'payroll', 'nonsense KEY'] };
    assert((await call('submit_client_order', { p: base })).status >= 400, 'anonymous request accepted');
    assert((await call('submit_client_order', { p: { ...base, phone: '123' } }, cust)).status >= 400, 'bad phone accepted');
    assert((await call('submit_client_order', { p: { ...base, business_name: '' } }, cust)).status >= 400, 'missing business name accepted');
    assert((await call('submit_client_order', { p: { ...base, gstin: '12345' } }, cust)).status >= 400, 'bad GSTIN accepted');
    const r = await call('submit_client_order', { p: base }, cust);
    assert(r.status === 200 && /^[a-f0-9]{32}$/.test(r.data.token), 'not stored: ' + JSON.stringify(r.raw));
    tokA = r.data.token; idA = r.data.id;
    const row = (await q('select status, kind, state_code, products from client_orders where id=$1', [idA]))[0];
    assert(row.status === 'requested' && row.kind === 'new' && row.state_code === '08' && row.products.join() === 'payroll,pos', JSON.stringify(row));
    const pub = (await call('public_client_order', { p_token: tokA })).data;
    assert(pub.status === 'requested' && !pub.quote && !pub.totals, 'the client sees a quote before it was sent');
    assert((await call('public_client_order', { p_token: 'f'.repeat(32) })).data == null, 'a wrong token returned data');
  }, 'critical');

  await s.check('Only the platform admin can list or open requests; status buttons work; a customer cannot touch them', async () => {
    assert((await call('admin_list_client_orders', {}, cust)).status >= 400, 'customer listed requests');
    assert((await call('admin_get_client_order', { p_id: idA }, cust)).status >= 400, 'customer opened a request');
    assert((await call('admin_set_order_status', { p_id: idA, p_status: 'confirmed' }, cust)).status >= 400, 'customer changed a status');
    const l = (await call('admin_list_client_orders', { p_status: 'open' }, adm)).data;
    assert(l.some((o) => o.id === idA), 'admin cannot see the request');
    assert((await call('admin_set_order_status', { p_id: idA, p_status: 'verifying' }, adm)).status === 200, 'cannot set verifying');
    assert((await call('admin_set_order_status', { p_id: idA, p_status: 'link_sent' }, adm)).status >= 400, 'payment link sent without a quote');
    assert((await call('admin_set_order_status', { p_id: idA, p_status: 'paid' }, adm)).status >= 400, 'paid set by hand');
  }, 'critical');

  await s.check('The quote: product price, discount, setup fee, custom charge and GST are worked out on the server (CGST + SGST in Rajasthan); an empty or zero quote is refused', async () => {
    assert((await call('admin_save_order_quote', { p_id: idA, p_quote: { items: [] } }, adm)).status >= 400, 'empty quote accepted');
    const quote = { items: [{ key: 'pos', plan: 'month', rate: 1090, discount: 90, gst: 18 }, { key: 'payroll', plan: 'year', rate: 5900, discount: 0, gst: 18 }], setup: { on: true, amount: 2190, gst: 18 }, custom: [{ label: 'Customised branding setup', amount: 2910, gst: 18 }], note: 'Thank you' };
    const r = await call('admin_save_order_quote', { p_id: idA, p_quote: quote }, adm);
    assert(r.status === 200, 'quote refused: ' + JSON.stringify(r.raw));
    const t = r.data; assert(Number(t.taxable) === 12000 && Number(t.gst) === 2160 && Number(t.cgst) === 1080 && Number(t.sgst) === 1080 && Number(t.igst) === 0 && Number(t.total) === 14160 && t.lines.length === 4, 'totals: ' + JSON.stringify(t));
    assert((await q('select status from client_orders where id=$1', [idA]))[0].status === 'confirmed', 'saving the quote did not confirm the request');
    assert((await call('public_client_order', { p_token: tokA })).data.quote === null, 'quote visible before the link was sent');
    // inter-state: IGST instead
    await call('admin_update_client_order', { p_id: idA, p: { state_code: '27' } }, adm);
    const t2 = (await call('admin_save_order_quote', { p_id: idA, p_quote: quote }, adm)).data; assert(Number(t2.igst) === 2160 && Number(t2.cgst) === 0, 'IGST wrong: ' + JSON.stringify(t2));
    await call('admin_update_client_order', { p_id: idA, p: { state_code: '08' } }, adm); await call('admin_save_order_quote', { p_id: idA, p_quote: quote }, adm);
  }, 'critical');

  await s.check('Payment link: the client sees the bill, must tick the terms, upload a screenshot (images only) and the admin sees it', async () => {
    assert((await call('admin_set_order_status', { p_id: idA, p_status: 'link_sent' }, adm)).status === 200, 'link not sent');
    const pub = (await call('public_client_order', { p_token: tokA })).data;
    assert(pub.status === 'link_sent' && pub.totals && Number(pub.totals.total) === 14160, 'the client cannot see the bill');
    assert((await call('public_order_submit_payment', { p_token: tokA, p_utr: '412345678901', p_terms: false })).status >= 400, 'accepted without ticking the terms');
    assert((await call('public_order_submit_payment', { p_token: tokA, p_utr: '', p_terms: true })).status >= 400, 'accepted with no screenshot and no UTR');
    const up = (tok, body) => fetch(stack.apiBase + '/storage/order-proof/' + tok, { method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body });
    assert((await up(tokA, Buffer.from('this is not an image, just text that is long enough'))).status === 400, 'a text file was accepted as the screenshot');
    assert((await up('e'.repeat(32), PNG)).status === 404, 'upload accepted for an unknown link');
    assert((await up(tokA, PNG)).status === 200, 'screenshot refused');
    assert((await call('public_order_submit_payment', { p_token: tokA, p_utr: '412345678901', p_terms: true })).status === 200, 'payment not submitted');
    const st = (await q('select status, payment from client_orders where id=$1', [idA]))[0];
    assert(st.status === 'payment_submitted' && st.payment.terms_accepted_at && st.payment.utr === '412345678901' && st.payment.proof, JSON.stringify(st));
    const img = await fetch(stack.apiBase + '/storage/order-proof/' + idA, { headers: { authorization: 'Bearer ' + adm } });
    assert(img.status === 200 && /image\/png/.test(img.headers.get('content-type')), 'admin cannot view the screenshot');
    assert((await fetch(stack.apiBase + '/storage/order-proof/' + idA, { headers: { authorization: 'Bearer ' + cust } })).status >= 400, 'a customer could read the screenshot');
    assert((await fetch(stack.apiBase + '/storage/order-proof/' + idA)).status === 401, 'anonymous could read the screenshot');
  }, 'critical');

  await s.check('Confirm payment: the business is created with exactly the quoted products, the bill gets gapless number AUZ/2026-27/0001, renewal dates follow monthly/yearly, the money is recorded; a second confirm is refused', async () => {
    assert((await call('admin_confirm_order_payment', { p_id: idA, p_paid_on: '2026-10-10', p_utr: 'UTRCONFIRM01' }, cust)).status >= 400, 'customer confirmed a payment');
    const r = await call('admin_confirm_order_payment', { p_id: idA, p_paid_on: '2026-10-10', p_utr: 'UTRCONFIRM01' }, adm);
    assert(r.status === 200 && r.data.invoice_no === 'AUZ/2026-27/0001', 'confirm: ' + JSON.stringify(r.raw));
    const t = (await q("select t.slug, t.niche, t.renewal_date::text rd, t.monthly_fee::float8 mf, ts.features from tenants t join tenant_settings ts on ts.tenant_id=t.id where t.id=$1", [r.data.tenant_id]))[0];
    assert(t.slug === 'plaincafe' && t.niche === 'cafe' && t.features.pos === true && t.features.payroll === true, 'tenant: ' + JSON.stringify(t));
    assert(t.rd === '2026-11-10', 'renewal date should be the earliest (monthly) one: ' + t.rd);
    assert(Math.abs(t.mf - (1000 + 5900 / 12)) < 0.02, 'monthly fee ' + t.mf);
    const o = (await q('select status, invoice_no, invoice_date::text d, totals from client_orders where id=$1', [idA]))[0];
    const ren = o.totals.lines.filter((l) => l.type === 'product').map((l) => l.renewal).sort();
    assert(o.status === 'paid' && o.d === '2026-10-10' && ren.join() === '2026-11-10,2027-10-10', 'order: ' + JSON.stringify(o));
    const pay = (await q("select amount::float8 a, utr from client_payments where tenant_id=$1", [r.data.tenant_id]))[0]; assert(pay && pay.a === 14160 && pay.utr === 'UTRCONFIRM01', 'payment record: ' + JSON.stringify(pay));
    assert((await call('admin_confirm_order_payment', { p_id: idA, p_paid_on: '2026-10-10' }, adm)).status >= 400, 'confirmed twice');
    assert((await call('admin_save_order_quote', { p_id: idA, p_quote: { items: [{ key: 'pos', rate: 1 }] } }, adm)).status >= 400, 'a paid order could be re-quoted');
    const pub = (await call('public_client_order', { p_token: tokA })).data; assert(pub.invoice_no === 'AUZ/2026-27/0001' && pub.tenant_slug === 'plaincafe', 'public view of the paid order');
  }, 'critical');

  await s.check('Add-on to an existing business: the same account sends another request, it is an add-on, IGST applies for another state, access is added, the next bill number follows without a gap', async () => {
    const r = await call('submit_client_order', { p: { contact_name: 'Ravi Test', phone: '9812345678', requirement: 'Add the mobile shop app', products: ['mobile'] } }, cust);
    assert(r.status === 200, 'add-on request: ' + JSON.stringify(r.raw)); idB = r.data.id; tokB = r.data.token;
    const row = (await q('select kind, tenant_id from client_orders where id=$1', [idB]))[0]; assert(row.kind === 'addon' && row.tenant_id, 'not an add-on: ' + JSON.stringify(row));
    await call('admin_update_client_order', { p_id: idB, p: { state_code: '27', gstin: '27ABCDE1234F1Z5' } }, adm);
    const t = (await call('admin_save_order_quote', { p_id: idB, p_quote: { items: [{ key: 'mobile', plan: 'month', rate: 249, discount: 0, gst: 0 }], setup: { on: false } } }, adm)).data;
    assert(Number(t.total) === 249 && Number(t.gst) === 0, 'GST-free quote: ' + JSON.stringify(t));
    const t2 = (await call('admin_save_order_quote', { p_id: idB, p_quote: { items: [{ key: 'mobile', plan: 'month', rate: 249, discount: 49, gst: 18 }], setup: { on: false } } }, adm)).data;
    assert(Number(t2.igst) === 36 && Number(t2.total) === 236 && Number(t2.cgst) === 0, 'IGST: ' + JSON.stringify(t2));
    await call('admin_set_order_status', { p_id: idB, p_status: 'link_sent' }, adm);
    const c = await call('admin_confirm_order_payment', { p_id: idB, p_paid_on: '2026-10-12' }, adm);
    assert(c.status === 200 && c.data.invoice_no === 'AUZ/2026-27/0002', 'second bill: ' + JSON.stringify(c.raw));
    const f = (await q("select ts.features from tenant_settings ts where tenant_id=$1", [row.tenant_id]))[0].features;
    assert(f.mobile === true && f.pos === true && f.payroll === true, 'features: ' + JSON.stringify(f));
    // a new financial year restarts the series (April 2027)
    const r3 = await call('submit_client_order', { p: { contact_name: 'Ravi Test', phone: '9812345678', requirement: 'Scan app', products: ['scan'] } }, cust);
    await call('admin_save_order_quote', { p_id: r3.data.id, p_quote: { items: [{ key: 'scan', plan: 'year', rate: 4600, discount: 0, gst: 18 }] } }, adm);
    const c3 = await call('admin_confirm_order_payment', { p_id: r3.data.id, p_paid_on: '2027-04-02' }, adm);
    assert(c3.status === 200 && c3.data.invoice_no === 'AUZ/2027-28/0001', 'new year series: ' + JSON.stringify(c3.raw));
  }, 'critical');

  await s.check('The A4 bill (inv.html): number, From/To with GSTINs, services with GST, totals, renewal dates, terms, PAID stamp; one A4 page; works on a phone; a link that is not paid shows no bill', async () => {
    const c = await newCtx(browser, stack, { w: 1280, h: 1000 }); const page = await c.newPage(); const errs = watch(page);
    await page.goto(stack.url('', '/inv.html?t=' + tokA)); await page.waitForSelector('#sheet .h1', { timeout: 15000 });
    const t = await page.locator('#sheet').innerText();
    for (const w of ['Invoice', 'AUZ/2026-27/0001', 'From', 'To', 'Plain Cafe', '08ABCDE1234F1Z5', '08KALPM2374C1ZH', 'Services', 'AUZsPOS', 'AUZsPay', 'Setup fee', 'Customised branding setup', 'CGST', 'SGST', '14,160.00', 'Renewal', '10/11/2026', '10/10/2027', 'Refunds', 'Bug fixes', 'backups', 'Support and calls', 'GST', 'Authorised signatory', 'Fourteen Thousand One Hundred Sixty Rupees only']) assert(t.includes(w), 'bill is missing: ' + w);
    assert(await page.locator('#sheet .stamp svg').count() === 1 && /PAID/.test(await page.locator('#sheet .stamp').innerHTML()), 'PAID stamp missing');
    const box = await page.locator('#sheet').boundingBox(); assert(Math.abs(box.width - 794) < 2 && box.height >= 1117 && box.height <= 1124, 'not A4 sized: ' + JSON.stringify(box));
    await s.shot(page, 'order-bill-a4');
    const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true }); (await import('fs')).writeFileSync('tests/report/shots/order-bill.pdf', pdf);
    const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length; assert(pages === 1, 'the bill prints on ' + pages + ' pages');
    const p2 = await (await newCtx(browser, stack, { w: 390, h: 844, mobile: true })).newPage(); await p2.goto(stack.url('', '/inv.html?t=' + tokA)); await p2.waitForSelector('#sheet .h1', { timeout: 15000 });
    assert(await p2.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'sideways scroll on a phone'); await s.shot(p2, 'order-bill-a4-phone');
    const p3 = await c.newPage(); await p3.goto(stack.url('', '/inv.html?t=' + (await call('submit_client_order', { p: { contact_name: 'X Y', phone: '9812345679', business_name: 'Unpaid Co', requirement: 'x' } }, other)).data.token)); await p3.waitForSelector('#msg:not([hidden])');
    assert(!(await p3.locator('#sheet .h1').count()), 'a bill was shown for an unpaid request');
    assert(!errs.some((e) => /JS error/.test(e)), errs.join(' | ')); await c.close();
  }, 'critical');

  await s.check('Payment page (pay.html): bill with GST, terms with an UNTICKED box, UPI QR, screenshot upload; the box is enforced; works on a phone', async () => {
    const r = await call('submit_client_order', { p: { contact_name: 'Meera Test', phone: '9812345670', requirement: 'More products', products: ['accounting'] } }, other);
    idB = r.data.id; tokB = r.data.token;
    await call('admin_save_order_quote', { p_id: idB, p_quote: { items: [{ key: 'accounting', plan: 'month', rate: 1490, discount: 0, gst: 18 }], setup: { on: false } } }, adm);
    await call('admin_set_order_status', { p_id: idB, p_status: 'link_sent' }, adm);
    const c = await newCtx(browser, stack, { w: 390, h: 844, mobile: true }); const page = await c.newPage(); const errs = watch(page);
    await page.goto(stack.url('', '/pay.html?t=' + tokB)); await page.waitForSelector('#agree', { timeout: 15000 });
    const t = await page.locator('body').innerText();
    for (const w of ['AUZsLedger', '1,490.00', 'CGST', 'SGST', '1,758.00', 'Refunds', 'Bug fixes', 'Pay', 'Screenshot of your payment']) assert(t.toLowerCase().includes(w.toLowerCase()), 'pay page is missing: ' + w);
    assert(await page.locator('#agree').isChecked() === false, 'the terms box is ticked by default');
    assert(await page.locator('#qr').evaluate((i) => i.complete && i.naturalWidth > 50), 'no UPI QR');
    await page.click('#send'); assert(/tick the box/i.test(await page.locator('#err').innerText()), 'the unticked box was not enforced');
    await page.check('#agree'); await page.click('#send'); assert(/choose the screenshot/i.test(await page.locator('#err').innerText()), 'no screenshot was not refused');
    await page.setInputFiles('#shot', { name: 'pay.png', mimeType: 'image/png', buffer: PNG }); await page.fill('#utr', '998877665544'); await page.click('#send');
    await page.waitForFunction(() => /confirming your payment/i.test(document.body.innerText), null, { timeout: 15000 });
    assert((await q('select status from client_orders where id=$1', [idB]))[0].status === 'payment_submitted', 'payment not recorded');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'sideways scroll on a phone');
    await s.shot(page, 'order-pay-phone'); assert(!errs.some((e) => /JS error/.test(e)), errs.join(' | ')); await c.close();
  }, 'critical');

  await s.check('Admin screen: quote builder, payment link message, the client\'s screenshot, confirm payment and bill message', async () => {
    const c = await newCtx(browser, stack, { w: 1280, h: 1000 }); const p = await c.newPage(); const errs = watch(p);
    await p.goto(stack.url('', '/admin.html')); await p.waitForTimeout(800); await p.fill('#email', USERS.admin); await p.fill('#password', PASSWORD); await p.click('#signin'); await p.waitForTimeout(2500);
    await p.click('.a-side-btn[data-section=orders]'); await p.waitForSelector('#ordersList tr[data-oid]', { timeout: 10000 });
    await p.click('[data-ordf=payment_submitted]'); await p.waitForFunction(() => /Meera|Plain|Unpaid|Cafe|Test/.test(document.querySelector('#ordersList')?.innerText || ''), null, { timeout: 8000 });
    await p.locator('#ordersList tr[data-oid]', { hasText: /screenshot sent/ }).first().locator('[data-oopen]').click();
    await p.waitForSelector('#cfPay', { timeout: 10000 }); await p.waitForSelector('#proofBox img', { timeout: 10000 });
    const txt = await p.locator('#ordBody').innerText();
    for (const w of ['Quote', 'Setup fee', 'Payment link', 'Message to send on WhatsApp', 'Confirm payment', '1,758.00', 'UTR']) assert(txt.toLowerCase().includes(w.toLowerCase()), 'admin order screen is missing: ' + w);
    const msg = await p.locator('#waPay').inputValue(); assert(/pay\.html\?t=[a-f0-9]{32}/.test(msg) && /Team AUZslab/.test(msg) && /1,758.00/.test(msg), 'payment link message: ' + msg.slice(0, 200));
    await s.shot(p, 'order-admin-quote');
    // quote builder: add a branding charge, the total follows live
    const before = await p.locator('#qTot').innerText(); await p.click('#qBrand'); await p.waitForTimeout(300);
    assert((await p.locator('#qTot').innerText()) !== before && /2,910/.test(await p.locator('#ordBody').innerHTML()), 'the branding charge did not change the total');
    p.once('dialog', (d) => d.accept()); await p.click('#cfPay'); await p.waitForSelector('#waSendBill', { timeout: 10000 });
    assert((await q('select status from client_orders where id=$1', [idB]))[0].status === 'paid', 'confirm did not mark it paid');
    const bm = await p.locator('#waBill').inputValue(); assert(/AUZ\/20\d\d-\d\d\/\d{4}/.test(bm) && /inv\.html\?t=/.test(bm), 'bill message: ' + bm.slice(0, 200));
    assert(!errs.some((e) => /JS error/.test(e)), errs.join(' | ')); await c.close();
  }, 'critical');
  await s.check('Client bills in the admin: listed with GSTIN and GST, buyer details can be corrected (amounts and number fixed), the shared bill follows, the GST file downloads', async () => {
    const list = (await call('admin_list_client_bills', {}, adm)).data;
    assert(Array.isArray(list) && list.length >= 2 && list[0].invoice_no && list[0].totals && list[0].token, 'bills list: ' + JSON.stringify(list).slice(0, 200));
    const a = list.find((b) => b.id === idA); assert(a && Number(a.totals.total) === 14160, 'first bill missing');
    const one = (await call('admin_list_client_bills', { p_from: '2026-10-11', p_to: '2026-10-31' }, adm)).data; assert(one.every((b) => String(b.invoice_date) >= '2026-10-11'), 'date filter');
    const bad = await call('admin_update_bill_details', { p_id: idA, p: { gstin: '27ABCDE1234F1Z5' } }, adm); assert(bad.status >= 400, 'a GSTIN from another state was accepted');
    const bad2 = await call('admin_update_bill_details', { p_id: idA, p: { gstin: 'nonsense' } }, adm); assert(bad2.status >= 400, 'a malformed GSTIN was accepted');
    const ok = await call('admin_update_bill_details', { p_id: idA, p: { business_name: 'Plain Cafe Pvt Ltd', gstin: '08ABCDE1234F1Z5', address: 'Shop 9, Sardarpura, Jodhpur' } }, adm); assert(ok.status === 200, 'update: ' + JSON.stringify(ok.raw));
    const after = (await call('admin_list_client_bills', {}, adm)).data.find((b) => b.id === idA);
    assert(after.business_name === 'Plain Cafe Pvt Ltd' && after.invoice_no === 'AUZ/2026-27/0001' && Number(after.totals.total) === 14160 && after.bill_revised_at, 'after edit: ' + JSON.stringify(after).slice(0, 200));
    const pub = (await call('public_client_order', { p_token: tokA })).data; assert(pub.business_name === 'Plain Cafe Pvt Ltd', 'shared bill did not follow the correction');
    assert((await call('admin_list_client_bills', {}, cust)).status >= 400, 'a non-admin could list the bills');
    const c = await newCtx(browser, stack, { w: 1280, h: 900 }); const p = await c.newPage(); const errs = watch(p);
    await p.goto(stack.url('', '/admin.html')); await p.waitForTimeout(800); await p.fill('#email', USERS.admin); await p.fill('#password', PASSWORD); await p.click('#signin'); await p.waitForTimeout(2500);
    await p.evaluate(() => openSection('clientPay')); await p.waitForSelector('#billList tr[data-bid]', { timeout: 10000 });
    const txt = await p.locator('#billList').innerText(); assert(/AUZ\/2026-27\/0001/.test(txt) && /Plain Cafe Pvt Ltd/i.test(txt) && /08ABCDE1234F1Z5/.test(txt), 'bills table: ' + txt.slice(0, 200));
    assert(/Taxable/.test(await p.locator('#billTotals').innerText()), 'totals line missing');
    const dl = p.waitForEvent('download'); await p.click('#billCsv'); const d = await dl; const fs = await import('node:fs'); const csv = fs.readFileSync(await d.path(), 'utf8');
    assert(/"Invoice no"/.test(csv) && /08ABCDE1234F1Z5/.test(csv) && /AUZ\/2026-27\/0001/.test(csv), 'csv: ' + csv.slice(0, 200));
    await p.locator('#billList [data-bedit]').first().click(); await p.waitForSelector('#billOverlay.open'); assert(/AUZ\//.test(await p.locator('#billModalNo').innerText()), 'edit modal');
    await s.shot(p, 'admin-client-bills');
    assert(!errs.some((e) => /JS error/.test(e)), errs.join(' | ')); await c.close();
  }, 'critical');
  await s.check('A payment recorded by hand gets a GST invoice: must match the money, gets the next number, links to the payment, View/WhatsApp then show in the payments list', async () => {
    const tid = (await q("select id from tenants where niche='retail' limit 1"))[0].id;
    const pay = await call('admin_add_client_payment', { p_tenant_id: tid, p_amount: 460, p_paid_on: '2026-10-10', p_mode: 'upi', p_utr: 'UTRMANUAL460', p_purpose: null, p_note: null }, adm);
    assert(pay.status === 200, 'add payment: ' + JSON.stringify(pay.raw));
    const pid = (await q("select id from client_payments where utr='UTRMANUAL460'"))[0].id;
    const bad = await call('admin_create_bill_for_payment', { p_payment_id: pid, p: { items: [{ key: 'scan', plan: 'month', rate: 460, discount: 0, gst: 18 }] } }, adm);
    assert(bad.status >= 400 && /must equal/.test(JSON.stringify(bad.raw)), 'a bill that does not match the payment was accepted');
    assert((await call('admin_create_bill_for_payment', { p_payment_id: pid, p: { items: [{ key: 'scan', plan: 'month', rate: 460, discount: 0, gst: 0 }] } }, cust)).status >= 400, 'a non-admin made a bill');
    const ok = await call('admin_create_bill_for_payment', { p_payment_id: pid, p: { business_name: 'Book Shop', contact_name: 'Owner', phone: '9811111111', gstin: '08ABCDE1234F1Z5', items: [{ key: 'scan', plan: 'month', rate: 460, discount: 0, gst: 0 }] } }, adm);
    assert(ok.status === 200 && /^AUZ\/2026-27\/\d{4}$/.test(ok.data.invoice_no), 'make bill: ' + JSON.stringify(ok.raw));
    assert((await q('select purpose from client_payments where id=$1', [pid]))[0].purpose.includes(ok.data.invoice_no), 'the payment does not mention the bill');
    assert((await call('admin_create_bill_for_payment', { p_payment_id: pid, p: { items: [{ key: 'scan', plan: 'month', rate: 460, discount: 0, gst: 0 }] } }, adm)).status >= 400, 'a second bill for the same payment was made');
    const pub = (await call('public_client_order', { p_token: ok.data.token })).data; assert(pub.invoice_no === ok.data.invoice_no && Number(pub.totals.total) === 460, 'public bill');
    const c = await newCtx(browser, stack, { w: 1280, h: 900 }); const p = await c.newPage(); const errs = watch(p);
    await p.goto(stack.url('', '/admin.html')); await p.waitForTimeout(800); await p.fill('#email', USERS.admin); await p.fill('#password', PASSWORD); await p.click('#signin'); await p.waitForTimeout(2500);
    await p.evaluate(() => openSection('clientPay')); await p.waitForSelector('#clientPayList tr[data-pid]', { timeout: 10000 });
    const row = p.locator('#clientPayList tr[data-pid]', { hasText: 'UTRMANUAL460' });
    assert((await row.locator('[data-pwa]').count()) === 1 && /view invoice/i.test(await row.innerText()), 'buttons missing: ' + (await p.locator('#clientPayList').innerHTML()).replace(/\s+/g,' ').slice(0, 1500));
    // a payment with no bill shows Make invoice and the form checks the total live
    await call('admin_add_client_payment', { p_tenant_id: tid, p_amount: 1000, p_paid_on: '2026-10-11', p_mode: 'cash', p_utr: null, p_purpose: null, p_note: null }, adm);
    await p.evaluate(() => { sectionLoadedAt.clientPay = 0; loadClientPay(); }); await p.waitForSelector('#clientPayList [data-pmake]', { timeout: 10000 });
    await p.locator('#clientPayList [data-pmake]').first().click(); await p.waitForSelector('#mkOverlay.open');
    assert(/does not match|matches/.test(await p.locator('#mkSum').innerText()), 'live total missing');
    await s.shot(p, 'admin-make-invoice');
    // the client's own card: View bill + Send bill on WhatsApp (the retail business now has a bill)
    const slug = (await q('select slug from tenants where id=$1', [tid]))[0].slug;
    await p.evaluate(() => openSection('clients')); await p.waitForSelector('#clientsList tr[data-id]', { timeout: 10000 });
    const card = p.locator('#clientsList tr[data-id]', { hasText: slug + '.auzslab.in' });
    assert((await card.locator('[data-cview]').count()) === 1 && (await card.locator('[data-cwa]').count()) === 1, 'client card lacks View bill / Send bill on WhatsApp');
    assert(/inv\.html\?t=/.test(await card.locator('[data-cview]').getAttribute('href')), 'view bill link');
    await s.shot(p, 'admin-client-card-bill');
    assert(!errs.some((e) => /JS error/.test(e)), errs.join(' | ')); await c.close();
  }, 'critical');
  s.done();
}
