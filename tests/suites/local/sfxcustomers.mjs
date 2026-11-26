// Storefront round A: order lifecycle. Fulfilment, delivery and payment are separate states; shipments are records.
import { suite, watch, assert } from '../../lib/harness.mjs';
import { newCtx } from '../../lib/common.mjs';
import { rpc } from '../../lib/api.mjs';
import { q, USERS, PASSWORD } from '../../lib/db.mjs';

export default async function run({ browser, stack }) {
  const s = suite('Storefront customers', 'Customer records, consent, store credit, sign-in code, account page data.');
  await q("update tenant_settings set features = features || '{\"storefront\":true}' where tenant_id = (select id from tenants where slug='testcafe')");
  await q("insert into sfx_stores (tenant_id, published) select id, true from tenants where slug='testcafe' on conflict (tenant_id) do update set published=true");
  const tid = (await q("select id from tenants where slug='testcafe'"))[0].id;
  await q('delete from sfx_orders where tenant_id=$1', [tid]); await q('delete from sfx_products where tenant_id=$1', [tid]);
  const login = async (email) => (await (await fetch(stack.apiBase + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json()).access_token;
  const owner = await login(USERS.cafeOwner);
  const call = async (fn, args) => (await rpc(stack, fn, args, owner)).data;
  const pr = (await call('sfx_product_save', { p_id: null, p: { name: 'Cust tee', price: 100, status: 'active', variants: [{ label: 'S', price: 100, stock: 10 }, { label: 'M', price: 100, stock: 10 }] } })).data;
  const [vs, vm] = pr.variants.map((v) => v.id);
  const place = async () => {
    await rpc(stack, 'public_sfx_place_order', { p_slug: 'testcafe', p: { name: 'Ship Buyer', phone: '98765' + Math.floor(10000 + Math.random() * 89999), address: '12 Park Road, Ward 4', city: 'Jodhpur', state: 'Rajasthan', pin: '342001', lines: [{ variantId: vs, qty: 2 }, { variantId: vm, qty: 1 }] } });
    return (await q('select id from sfx_orders where tenant_id=$1 order by created_at desc limit 1', [tid]))[0].id;
  };
  const unwrap = (r) => (Array.isArray(r) ? r : r?.data ?? r);
  const err = async (fn, args) => JSON.stringify((await rpc(stack, fn, args, owner)).data).toLowerCase();
  const pub = async (fn, args) => unwrap((await rpc(stack, fn, args)).data);
  const phone = '9812345678';
  const orderFor = async (extra = {}) => {
    await q('update sfx_variants set stock = 50 where id = any($1)', [[vs, vm]]);
    await rpc(stack, 'public_sfx_place_order', { p_slug: 'testcafe', p: { name: 'Asha Rao', phone, email: 'asha@example.com', address: '7 Lake Road', city: 'Jodhpur', state: 'Rajasthan', pin: '342001', lines: [{ variantId: vs, qty: 1 }], ...extra } });
    return (await q('select id, customer_id from sfx_orders where tenant_id=$1 order by created_at desc limit 1', [tid]))[0];
  };
  let cust;

  await s.check('An order creates one customer by phone and links the next order to the same person', async () => {
    const a = await orderFor(); const b = await orderFor({ name: 'Asha R' });
    assert(a.customer_id && a.customer_id === b.customer_id, JSON.stringify([a, b]));
    const n = (await q('select count(*)::int n from sfx_customers where tenant_id=$1 and phone=$2', [tid, phone]))[0].n;
    assert(n === 1, 'duplicate customers: ' + n);
    cust = a.customer_id;
    const addr = (await q('select count(*)::int n from sfx_customer_addresses where customer_id=$1', [cust]))[0].n;
    assert(addr === 1, 'address saved ' + addr + ' times');
  }, 'critical');
  await s.check('Consent is recorded with when and where from, and can be withdrawn', async () => {
    let d = unwrap(await call('sfx_customer_consent', { p_id: cust, p_marketing: true, p_source: 'staff' }));
    assert(d.acceptsMarketing === true && d.consentAt && d.consentSource === 'staff', JSON.stringify(d).slice(0, 200));
    d = unwrap(await call('sfx_customer_consent', { p_id: cust, p_marketing: false, p_source: 'staff' }));
    assert(d.acceptsMarketing === false && d.consentAt, 'withdrawal not recorded');
  }, 'critical');
  await s.check('Store credit is a ledger, cannot go below zero, and a store-credit refund adds to it', async () => {
    let d = unwrap(await call('sfx_credit_adjust', { p_customer: cust, p_delta: 200, p_note: 'Goodwill' }));
    assert(Number(d.creditBalance) === 200 && d.creditMoves.length === 1, JSON.stringify(d.creditMoves));
    assert(/below zero/.test(await err('sfx_credit_adjust', { p_customer: cust, p_delta: -500, p_note: 'x' })), 'negative balance allowed');
    const o = (await orderFor()).id; await q("update sfx_orders set payment_status='paid' where id=$1", [o]);
    await call('sfx_refund_record', { p_order: o, p: { amount: 50, method: 'store_credit', reason: 'Return' } });
    d = unwrap(await call('sfx_customer_detail', { p_id: cust }));
    assert(Number(d.creditBalance) === 250 && d.creditMoves[0].reason === 'refund', JSON.stringify(d.creditMoves[0]));
  }, 'critical');
  await s.check('Sign-in code: wrong code fails, right code opens the account, codes are not reusable, unknown contact gets nothing', async () => {
    assert((await q("select sfx_customer_code_issue('testcafe','0000000000') r"))[0].r === null, 'unknown contact got a code');
    const iss = (await q("select sfx_customer_code_issue('testcafe', $1) r", [phone]))[0].r;
    assert(iss && /^[0-9]{6}$/.test(iss.code), JSON.stringify(iss));
    const stored = (await q('select code_hash from sfx_customer_codes where customer_id=$1 order by created_at desc limit 1', [cust]))[0].code_hash;
    assert(!stored.includes(iss.code) && stored.length === 64, 'code stored in the clear');
    assert(/did not work/.test(JSON.stringify(await pub('public_sfx_customer_verify', { p_slug: 'testcafe', p_contact: phone, p_code: '000000' }))), 'wrong code accepted');
    const ok = await pub('public_sfx_customer_verify', { p_slug: 'testcafe', p_contact: phone, p_code: iss.code });
    assert(ok.token && ok.token.length >= 40, JSON.stringify(ok));
    assert(/did not work/.test(JSON.stringify(await pub('public_sfx_customer_verify', { p_slug: 'testcafe', p_contact: phone, p_code: iss.code }))), 'code reused');
    const acc = await pub('public_sfx_customer_account', { p_token: ok.token });
    assert(acc.name && acc.orders.length >= 3 && Number(acc.creditBalance) === 250 && acc.addresses.length === 1, JSON.stringify(acc).slice(0, 300));
    assert(JSON.stringify(acc).indexOf('tenant') < 0, 'account leaks internal ids');
    const upd = await pub('public_sfx_customer_update', { p_token: ok.token, p: { name: 'Asha R Rao', acceptsMarketing: true } });
    assert(upd.name === 'Asha R Rao' && upd.acceptsMarketing === true, JSON.stringify(upd).slice(0, 200));
    const none = (x) => x === null || x?.data === null;
    assert(none(await pub('public_sfx_customer_account', { p_token: 'bogus' })), 'bogus token accepted');
    await pub('public_sfx_customer_signout', { p_token: ok.token });
    assert(none(await pub('public_sfx_customer_account', { p_token: ok.token })), 'signed-out token still works');
  }, 'critical');
  await s.check('Five wrong guesses lock a code, and codes are limited per hour', async () => {
    const iss = (await q("select sfx_customer_code_issue('testcafe', $1) r", [phone]))[0].r;
    for (let i = 0; i < 5; i++) await pub('public_sfx_customer_verify', { p_slug: 'testcafe', p_contact: phone, p_code: '111111' });
    assert(/did not work/.test(JSON.stringify(await pub('public_sfx_customer_verify', { p_slug: 'testcafe', p_contact: phone, p_code: iss.code }))), 'locked code still accepted');
    let blocked = false; for (let i = 0; i < 6; i++) if ((await q("select sfx_customer_code_issue('testcafe', $1) r", [phone]))[0].r === null) blocked = true;
    assert(blocked, 'no hourly limit');
  }, 'critical');
  await s.check('Another business cannot read this customer, and customers cannot see other shops', async () => {
    const other = await login(USERS.salonOwner);
    const r = await rpc(stack, 'sfx_customer_detail', { p_id: cust }, other);
    assert(/not found|not part|not allowed|plan|permission/i.test(JSON.stringify(r.data)) || r.data?.error, JSON.stringify(r.data).slice(0, 200));
    assert((await q("select sfx_customer_code_issue('no-such-shop', $1) r", [phone]))[0].r === null, 'code for unknown shop');
  });
  await s.check('The code route always answers the same', async () => {
    const post = async (b) => (await fetch(stack.apiBase + '/storefront/customer/code', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }));
    const a = await post({ slug: 'testcafe', contact: phone }); const b = await post({ slug: 'testcafe', contact: '1111111111' });
    assert(a.status === 200 && b.status === 200 && JSON.stringify(await a.json()) === JSON.stringify(await b.json()), 'route reveals who is a customer');
  });
  await s.check('The public store account page: sign-in form, then orders after sign-in', async () => {
    const ctx = await newCtx(browser, stack, { w: 420, h: 900 }); const pg = await ctx.newPage(); const errs = watch(pg);
    await pg.goto(stack.url('testcafe', '/store.html#/account'), { waitUntil: 'load' }); await pg.waitForTimeout(2500);
    let t = await pg.locator('#view').innerText();
    assert(/sign in/i.test(t) && /send me a code/i.test(t), JSON.stringify(t.slice(0, 300)) + ' | ' + JSON.stringify(errs).slice(0,200));
    await q('delete from sfx_customer_codes where tenant_id=$1', [tid]);
    const c = (await q("select sfx_customer_code_issue('testcafe', $1) r", [phone]))[0].r;
    assert(c && c.code, 'no code issued');
    const v = unwrap((await rpc(stack, 'public_sfx_customer_verify', { p_slug: 'testcafe', p_contact: phone, p_code: c.code })).data);
    assert(v && v.ok && v.token, JSON.stringify(v));
    await pg.evaluate(([k, tok]) => localStorage.setItem(k, tok), ['acct.testcafe', v.token]);
    await pg.reload({ waitUntil: 'load' }); await pg.waitForTimeout(2500);
    t = await pg.locator('#view').innerText();
    assert(/my orders/i.test(t) && /sign out/i.test(t) && /send me offers/i.test(t), t.slice(0, 400));
    assert(await pg.locator('#view a[href*="#/order/"]').count() >= 1, 'no order link: ' + JSON.stringify(t.slice(0, 400)));
    await pg.evaluate(() => [...document.querySelectorAll('#view button')].find((b) => /sign out/i.test(b.textContent)).click()); await pg.waitForTimeout(1200);
    t = await pg.locator('#view').innerText();
    assert(/send me a code/i.test(t), 'not signed out');
    assert(!errs.length, JSON.stringify(errs).slice(0, 200));
  });
  await s.check('Store credit at checkout: needs sign-in, capped at balance, covers the order, comes back on cancel', async () => {
    await q('update sfx_variants set stock = 50 where id = any($1)', [[vs, vm]]);
    await q('delete from sfx_customer_codes where tenant_id=$1', [tid]);
    const cr = (await q("select sfx_customer_code_issue('testcafe', $1) r", [phone]))[0].r;
    const v = unwrap((await rpc(stack, 'public_sfx_customer_verify', { p_slug: 'testcafe', p_contact: phone, p_code: cr.code })).data);
    const cid = (await q('select id from sfx_customers where tenant_id=$1 and phone=$2', [tid, phone]))[0].id;
    await q('update sfx_customers set credit_balance = 500 where id=$1', [cid]);
    const mk = async (extra) => { const r = unwrap((await rpc(stack, 'public_sfx_place_order', { p_slug: 'testcafe', p: { name: 'Asha Rao', phone: '9000000' + Math.floor(100 + Math.random() * 899), address: '7 Lake Road', city: 'Jodhpur', state: 'Rajasthan', pin: '342001', payment: 'cod', lines: [{ variantId: vs, qty: 1 }], ...extra } })).data); return r; };
    // without a sign-in nothing is spent
    let r = await mk({ useCredit: true });
    assert((await q('select credit_balance::float b from sfx_customers where id=$1', [cid]))[0].b === 500, 'credit spent without sign-in');
    // wrong token: nothing
    r = await mk({ useCredit: true, customerToken: 'deadbeef' });
    assert((await q('select credit_balance::float b from sfx_customers where id=$1', [cid]))[0].b === 500, 'credit spent with a bad token');
    // credit smaller than the order: pays part
    await q('update sfx_customers set credit_balance = 30 where id=$1', [cid]);
    r = await mk({ useCredit: true, customerToken: v.token });
    let o = (await q("select id, total::float t, credit_applied::float c, payment_status ps from sfx_orders where token=$1", [r.token]))[0];
    assert(o.c === 30 && o.ps === 'pending', JSON.stringify(o));
    assert((await q('select credit_balance::float b from sfx_customers where id=$1', [cid]))[0].b === 0, 'balance not reduced');
    // credit bigger than the order: covers it, order is paid, only the total is taken
    await q('update sfx_customers set credit_balance = 500 where id=$1', [cid]);
    r = await mk({ useCredit: true, customerToken: v.token });
    o = (await q("select id, total::float t, credit_applied::float c, payment_status ps from sfx_orders where token=$1", [r.token]))[0];
    assert(o.c === o.t && o.ps === 'paid', JSON.stringify(o));
    assert((await q('select credit_balance::float b from sfx_customers where id=$1', [cid]))[0].b === 500 - o.t, 'wrong balance');
    const pub = unwrap((await rpc(stack, 'public_sfx_order', { p_token: r.token })).data);
    assert(pub.creditApplied === o.t && pub.amountDue === 0, JSON.stringify(pub));
    // cancelling gives it back once
    const owner = await login(USERS.cafeOwner);
    await rpc(stack, 'sfx_order_cancel', { p_order: o.id, p: { reason: 'test', restock: true } }, owner);
    assert((await q('select credit_balance::float b from sfx_customers where id=$1', [cid]))[0].b === 500, 'credit not returned');
    await q("update sfx_orders set status='cancelled' where id=$1", [o.id]);
    assert((await q('select credit_balance::float b from sfx_customers where id=$1', [cid]))[0].b === 500, 'credit returned twice');
  });
  s.done();
}
