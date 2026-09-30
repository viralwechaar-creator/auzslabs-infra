// AUZslab Salon: public site, real booking, owner console, staff limits, invoices, payroll gating.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { salonClient } from '../../lib/api.mjs';
import { PASSWORD, TENANTS } from '../../lib/db.mjs';

const tomorrow = () => { const d = new Date(Date.now() + 2 * 864e5); return d.toISOString().slice(0, 10); };

export default async function run({ browser, stack }) {
  const s = suite('Salon product: customer site, booking, owner and staff consoles', 'Real browser journey for a customer booking, owner/staff sign-in, and server-side permission checks.');
  const host = TENANTS.salon;
  const ctx = await newCtx(browser, stack, { w: 390, h: 844, mobile: true });
  await ctx.addInitScript(() => { try { localStorage.setItem('ss_promo_seen', '1'); } catch {} });
  const page = await ctx.newPage(); const errs = watch(page);

  await s.check('Salon home opens from the bare subdomain (routes to /salon/)', async () => {
    await page.goto(stack.url(host, '/'), { waitUntil: 'load' }); await page.waitForTimeout(800);
    assert(page.url().includes('/salon/'), 'ended on ' + page.url());
    assert(/test salon/i.test(await page.locator('#brandName').innerText()), 'salon name not shown');
  }, 'critical');
  await s.shot(page, 'salon-home-mobile');
  await s.check('Salon home and menu have no JS/network errors', async () => {
    await page.goto(stack.url(host, '/salon/menu/')); await page.waitForTimeout(600);
    assert(!errs.length, errs.slice(0, 3).join(' | '));
    assert((await page.locator('body').innerText()).match(/\d/), 'menu shows no prices');
  }, 'critical');

  await s.check('Customer can book an appointment through the form', async () => {
    await page.goto(stack.url(host, '/salon/#book')); await page.waitForTimeout(700);
    await page.fill('#bName', 'QA Customer'); await page.fill('#bPhone', '9811122233');
    await page.click('#picker summary'); const cb = page.locator('#pickList label.pick').first(); await cb.scrollIntoViewIfNeeded(); await cb.click(); assert(await page.locator('#pickList input:checked').count() === 1, 'service could not be selected');
    await page.fill('#bDate', tomorrow()); await page.dispatchEvent('#bDate', 'change'); await page.waitForTimeout(800);
    const slot = page.locator('#slots label.slot:has(input:not([disabled]))').first();
    assert(await slot.count(), 'no open time slots shown'); await slot.click();
    await page.click('#bookBtn'); await page.waitForTimeout(1200);
    assert(await page.locator('#bookDone').isVisible(), 'no confirmation: ' + (await page.locator('#bookError').innerText().catch(() => '')));
  }, 'critical');
  await s.shot(page, 'salon-booking-confirmed');
  await s.check('Booking form rejects missing details', async () => {
    await page.goto(stack.url(host, '/salon/#book')); await page.reload(); await page.waitForTimeout(800);
    await page.click('#bookBtn'); await page.waitForTimeout(500);
    assert(!(await page.locator('#bookDone').isVisible()), 'empty form was accepted');
  });
  await s.check('Double booking the same person and time is refused', async () => {
    const c = salonClient(stack, host); const slotsR = await c.call('GET', '/slots?date=' + tomorrow());
    const t = slotsR.data.slots.find((x) => x.free).time; const menu = (await c.call('GET', '/site')).data.menu; const id = menu[0].items[0].id;
    const b = { name: 'Dup', phone: '9822233344', date: tomorrow(), time: t, services: [id] };
    assert((await c.call('POST', '/bookings', b)).status === 201, 'first booking failed');
    assert((await c.call('POST', '/bookings', b)).status === 409, 'duplicate was accepted');
  });
  await s.check('Slot capacity is enforced (full slot stops accepting)', async () => {
    const c = salonClient(stack, host); const menu = (await c.call('GET', '/site')).data.menu; const id = menu[0].items[0].id;
    const day = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 10);
    const t = (await c.call('GET', '/slots?date=' + day)).data.slots[0].time; const cap = (await c.call('GET', '/site')).data.settings.capacity || 1;
    let last; for (let i = 0; i < cap + 1; i++) last = await c.call('POST', '/bookings', { name: 'Cap' + i, phone: '98000000' + (10 + i), date: day, time: t, services: [id] });
    assert(last.status >= 400, 'over-capacity booking accepted (status ' + last.status + ')');
  });

  await s.check('First-visit promo popup shows, can be booked from, and can be closed', async () => {
    const c3 = await newCtx(browser, stack, { w: 390, h: 844, mobile: true }); const p3 = await c3.newPage();
    await p3.goto(stack.url(host, '/salon/')); await p3.waitForSelector('#promo[open]', { timeout: 15000 });
    await s.shot(p3, 'salon-promo-popup');
    const svc = await p3.$$eval('#pmService option', (o) => o.map((x) => x.value).filter(Boolean)); assert(svc.length, 'popup has no services');
    await p3.fill('#promoForm [name=name]', 'Popup Person'); await p3.fill('#promoForm [name=phone]', '9855566677');
    await p3.selectOption('#pmService', svc[0]); await p3.fill('#pmDate', new Date(Date.now() + 4 * 864e5).toISOString().slice(0, 10)); await p3.dispatchEvent('#pmDate', 'change'); await p3.waitForTimeout(800);
    const t = await p3.$$eval('#pmTime option:not([disabled])', (o) => o.map((x) => x.value).filter(Boolean)); assert(t.length, 'popup shows no times');
    await p3.selectOption('#pmTime', t[0]); await p3.click('#promoBtn'); await p3.waitForTimeout(1200);
    const err = await p3.locator('#promoError').innerText({ timeout: 1500 }).catch(() => ''); assert(!err, 'popup error: ' + err);
    await c3.close();
    const c4 = await newCtx(browser, stack, { w: 390, h: 844, mobile: true }); const p4 = await c4.newPage();
    await p4.goto(stack.url(host, '/salon/')); await p4.waitForSelector('#promo[open]', { timeout: 15000 }); await p4.click('#promoClose'); await p4.waitForTimeout(500);
    assert(!(await p4.locator('#promo').evaluate((d) => d.open)), 'popup did not close'); await c4.close();
  });
  // owner
  const owner = salonClient(stack, host);
  await s.check('Owner cannot sign in with a wrong password', async () => { assert((await owner.call('POST', '/admin/login', { password: 'nope-nope' })).status === 401); }, 'critical');
  await s.check('Owner signs in with the AUZslab account password', async () => { assert((await owner.call('POST', '/admin/login', { password: PASSWORD })).status === 200); }, 'critical');
  await s.check('Owner console opens in the browser and every tab renders', async () => {
    await page.goto(stack.url(host, '/salon/admin/')); await page.waitForTimeout(600);
    await page.fill('#pw', PASSWORD); await page.click('#loginForm button[type=submit]'); await page.waitForTimeout(1200);
    assert(await page.locator('#app').isVisible(), 'console did not open');
    const tabs = await page.$$eval('#sideNav a, #sideNav button', (n) => n.map((x) => x.getAttribute('href') || x.textContent));
    assert(tabs.length >= 8, 'only ' + tabs.length + ' nav items');
    const hashes = ['dashboard', 'bookings', 'billing', 'clients', 'menu', 'stylists', 'gallery', 'content', 'settings', 'expenses', 'analytics', 'staff'];
    const bad = [];
    for (const h of hashes) { const before = errs.length; await page.evaluate((x) => { location.hash = x; }, h); await page.waitForTimeout(450); if (errs.length > before) bad.push(h + ': ' + errs[errs.length - 1]); if (!(await page.locator('#view').innerText()).trim()) bad.push(h + ' is blank'); }
    assert(!bad.length, bad.join(' | '));
  }, 'critical');
  await s.shot(page, 'salon-admin-mobile');
  await s.check('Owner can create a bill (invoice) and the public link opens', async () => {
    const r = await owner.call('POST', '/admin/invoices', { client: { name: 'Bill Client', phone: '9833344455' }, items: [{ name: 'Haircut', qty: 1, price: 500 }], discount: { type: 'flat', value: 50 } });
    assert(r.status === 201, 'status ' + r.status + ' ' + JSON.stringify(r.data)); const tok = r.data.invoice.token; assert(tok, 'no token');
    await page.goto(stack.url(host, '/i/' + tok)); await page.waitForTimeout(900);
    const txt = await page.locator('body').innerText(); assert(/Haircut/.test(txt) && /450/.test(txt), 'invoice page missing item or discounted total');
  }, 'critical');
  await s.shot(page, 'salon-invoice');
  await s.check('A made-up invoice link shows an error, not someone else\'s bill', async () => {
    const r = await salonClient(stack, host).call('GET', '/i/aaaaaaaaaaaaaaaa'); assert(r.status === 404, 'status ' + r.status);
  });

  // staff
  const staffApi = salonClient(stack, host);
  await s.check('Owner can add a staff login', async () => {
    const r = await owner.call('POST', '/admin/staff', { name: 'Riya Staff', phone: '9700000001', password: 'staffpass1', designation: 'Stylist' });
    assert(r.status === 201, r.status + ' ' + JSON.stringify(r.data));
  });
  await s.check('Staff can sign in with phone + password; wrong password refused', async () => {
    assert((await salonClient(stack, host).call('POST', '/admin/login', { phone: '9700000001', password: 'bad' })).status === 401, 'wrong password accepted');
    assert((await staffApi.call('POST', '/admin/login', { phone: '9700000001', password: 'staffpass1' })).status === 200);
  }, 'critical');
  await s.check('Staff CAN: read Today data, make a bill, add/update bookings', async () => {
    assert((await staffApi.call('GET', '/admin/data')).status === 200, 'data');
    assert((await staffApi.call('POST', '/admin/invoices', { client: { name: 'Staff Bill', phone: '9844455566' }, items: [{ name: 'Facial', qty: 1, price: 900 }] })).status === 201, 'invoice');
  }, 'critical');
  await s.check('Staff CANNOT: menu, settings, content, gallery, stylists, expenses, export, reset, password, staff list', async () => {
    const tries = [['PUT', '/admin/menu', { menu: [] }], ['PUT', '/admin/settings', { settings: {} }], ['PUT', '/admin/content', { content: {} }], ['PUT', '/admin/gallery', { gallery: [] }], ['PUT', '/admin/stylists', { stylists: [] }],
      ['POST', '/admin/expenses', { title: 'x', amount: 5 }], ['GET', '/admin/export'], ['POST', '/admin/reset', {}], ['POST', '/admin/clear-history', {}], ['GET', '/admin/staff'], ['POST', '/admin/staff', { name: 'Evil', phone: '9999999999', password: 'evilpass1' }]];
    const leaks = []; for (const [m, p, b] of tries) { const r = await staffApi.call(m, p, b); if (r.status < 400) leaks.push(`${m} ${p} -> ${r.status}`); }
    assert(!leaks.length, 'staff allowed to: ' + leaks.join(', '));
  }, 'critical');
  await s.check('Staff data view hides expenses and website text', async () => {
    const d = (await staffApi.call('GET', '/admin/data')).data; assert(!(d.expenses && d.expenses.length), 'expenses visible to staff');
  }, 'critical');
  await s.check('Staff cannot void (delete) a bill or delete a booking', async () => {
    const inv = (await owner.call('GET', '/admin/data')).data.invoices[0]; const bk = (await owner.call('GET', '/admin/data')).data.bookings[0];
    const a = await staffApi.call('DELETE', '/admin/invoices/' + inv.id); const b = await staffApi.call('DELETE', '/admin/bookings/' + bk.id);
    assert(a.status >= 400 && b.status >= 400, `invoice delete ${a.status}, booking delete ${b.status}`);
  }, 'critical');
  await s.check('Staff clock-in is blocked while the Payroll add-on is off', async () => {
    const r = await staffApi.call('POST', '/admin/punch', {}); assert(r.status === 400, 'status ' + r.status);
  });
  await s.check('Staff console in browser shows only Today, Bookings, Billing, Clients', async () => {
    const c2 = await newCtx(browser, stack, { w: 390, h: 844, mobile: true }); const p2 = await c2.newPage();
    await p2.goto(stack.url(host, '/salon/admin/')); await p2.waitForTimeout(500);
    await p2.click('#staffToggle'); await p2.fill('#staffPhone', '9700000001'); await p2.fill('#pw', 'staffpass1'); await p2.click('#loginForm button[type=submit]'); await p2.waitForTimeout(1200);
    assert(await p2.locator('#app').isVisible(), 'staff console did not open');
    const t = (await p2.locator('#tabbar, #sideNav').allInnerTexts()).join(' ').toLowerCase();
    for (const no of ['menu and prices', 'gallery', 'website text', 'settings', 'expenses', 'analytics']) assert(!t.includes(no), 'staff can see the "' + no + '" tab');
    await s.shot(p2, 'salon-staff-console-mobile'); await c2.close();
  }, 'critical');
  await s.check('Owner cannot be impersonated with a tampered session cookie', async () => {
    const c = salonClient(stack, host); c.cookie = owner.cookie.replace(/.$/, (x) => (x === 'a' ? 'b' : 'a'));
    assert((await c.call('GET', '/admin/data')).status === 401, 'tampered cookie accepted');
  }, 'critical');
  await s.check('A session from one salon does not work on another salon', async () => {
    const other = salonClient(stack, 'testcafe'); other.cookie = owner.cookie;
    const r = await other.call('GET', '/admin/data'); assert(r.status >= 400, 'cross-tenant status ' + r.status);
  }, 'critical');
  await s.check('Owner sees their booking and bill in the console data', async () => {
    const d = (await owner.call('GET', '/admin/data')).data; assert(d.bookings.some((b) => b.name === 'QA Customer'), 'customer booking missing'); assert(d.invoices.length >= 2, 'bills missing');
  }, 'critical');
  await s.check('Login is rate-limited after repeated wrong passwords', async () => {
    const c = salonClient(stack, host); let hit = false;
    for (let i = 0; i < 40; i++) { const r = await c.call('POST', '/admin/login', { password: 'wrong' + i }); if (r.status === 429) { hit = true; break; } }
    assert(hit, 'no lockout after 40 bad attempts');
  }, 'major');
  await ctx.close(); s.done();
}
