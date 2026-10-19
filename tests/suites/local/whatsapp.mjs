// WhatsApp automation (db/184): the queue, who sends from which number, retries, delivery receipts, opt-out and the
// permissions around connecting a number. Meta's Graph API is replaced by the fake server in tests/lib/stack.mjs.
import crypto from 'node:crypto';
import { suite, assert } from '../../lib/harness.mjs';
import { q, PASSWORD, USERS, TENANTS } from '../../lib/db.mjs';

export default async function run({ stack }) {
  const s = suite('WhatsApp: automatic messages from the shop\'s own number or the AUZslab number', 'Messages are queued once, sent as approved templates, retried on glitches, tracked by Meta\'s receipts, and never sent to someone who said STOP or from a shop that has not switched it on.');
  const api = stack.apiBase, wa = stack.wa;
  const login = async (email) => { const d = await (await fetch(api + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) })).json(); return (d.data || d).access_token; };
  const call = async (fn, args, tok) => { const r = await fetch(api + '/rpc/' + fn, { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: JSON.stringify(args || {}) }); let d = null; try { d = await r.json(); } catch {} return { status: r.status, data: d && d.data !== undefined ? d.data : d, raw: d }; };
  const ok = async (fn, args, tok) => { const r = await call(fn, args, tok); assert(r.status === 200, `${fn}: ${r.status} ${JSON.stringify(r.raw)}`); return r.data; };
  const fails = async (fn, args, tok, why) => { const r = await call(fn, args, tok); assert(r.status >= 400, `${fn} should be refused (${why || ''})`); return r; };
  const post = async (path, body, tok, headers = {}) => { const r = await fetch(api + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}), ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) }); let d = null; try { d = await r.json(); } catch {} return { status: r.status, data: d }; };
  const adm = await login(USERS.admin), owner = await login(USERS.cafeOwner), plain = await login(USERS.plain);
  const tid = (await q('select id from tenants where slug=$1', [TENANTS.cafe]))[0].id;
  const enqueue = async (tenant, to, tpl, params, ref) => (await q('select wa_enqueue($1,$2,$3,$4::jsonb,$5) id', [tenant, to, tpl, JSON.stringify(params), ref]))[0].id;
  const row = async (id) => (await q('select * from wa_outbox where id=$1', [id]))[0];
  const until = async (id, pred, ms = 8000) => { const t0 = Date.now(); for (;;) { const r = await row(id); if (pred(r)) return r; if (Date.now() - t0 > ms) throw new Error('timed out, row is ' + JSON.stringify(r)); await new Promise((k) => setTimeout(k, 150)); } };
  const sign = (raw) => 'sha256=' + crypto.createHmac('sha256', 'wa-app-secret').update(raw).digest('hex');
  await q('delete from wa_outbox'); await q('delete from wa_optouts'); await q('delete from wa_accounts'); await q('delete from wa_tenant_settings');

  await s.check('Phone numbers are cleaned: 10 digits get +91, junk is refused', async () => {
    const n = async (v) => (await q('select wa_norm_phone($1) p', [v]))[0].p;
    assert(await n('98765 43210') === '919876543210', 'plain 10 digits');
    assert(await n('+91-98765-43210') === '919876543210', 'with +91');
    assert(await n('098765 43210') === '919876543210', 'leading zero');
    assert(await n('12345') === null && await n('') === null && await n(null) === null, 'junk must be null');
  });

  await s.check('AUZslab\'s own automatic messages stay off until the admin switches them on', async () => {
    assert(!(await enqueue(null, '9876543210', 'welcome', ['A', 'B'], 'off-flag')), 'queued while the platform switch was off');
    await fails('admin_wa_set_platform_auto', { p_on: true }, owner, 'owner');
    await fails('admin_wa_set_platform_auto', { p_on: true }, plain, 'stranger');
    await ok('admin_wa_set_platform_auto', { p_on: true }, adm);
    assert((await ok('admin_wa_overview', {}, adm)).platform_auto === true, 'overview does not show it');
  }, 'critical');

  await s.check('AUZslab\'s own message is sent from the platform number as the right template with ordered parameters', async () => {
    wa.calls.length = 0;
    const id = await enqueue(null, '9876543210', 'welcome', ['Asha', 'asha.auzslab.in'], 'w-1');
    assert(id, 'not queued');
    const r = await until(id, (x) => x.status === 'sent');
    assert(r.sender === 'platform' && r.wa_message_id, JSON.stringify(r));
    const c = wa.calls.find((x) => x.body?.to === '919876543210');
    assert(c && c.path.includes('PLATFORM1') && c.auth === 'platform-token-platform-token', 'wrong sender: ' + JSON.stringify(c));
    assert(c.body.template.name === 'auzslab_welcome' && c.body.template.language.code === 'en', 'wrong template');
    const ps = c.body.template.components[0].parameters.map((p) => p.text);
    assert(ps.join('|') === 'Asha|asha.auzslab.in', 'params ' + ps);
  }, 'critical');

  await s.check('A shop is silent until the owner switches it on; a shop template cannot go out as an AUZslab message and vice versa', async () => {
    assert(!(await enqueue(tid, '9876543210', 'invoice_link', ['A', 'S', 'B1', '10', 'http://x'], 'b-0')), 'queued while switched off');
    assert(!(await enqueue(null, '9876543210', 'invoice_link', ['A'], 'x')), 'shop template as platform message');
    assert(!(await enqueue(tid, '9876543210', 'welcome', ['A', 'B'], 'x')), 'platform template as shop message');
    assert(!(await enqueue(null, '123', 'welcome', ['A', 'B'], 'x2')), 'bad number queued');
    assert(!(await enqueue(null, '9876543210', 'no_such_template', [], 'x3')), 'unknown template queued');
  }, 'critical');

  await s.check('Switched on with no number connected and no AUZslab permission: the message is logged as skipped, nothing is sent', async () => {
    await ok('wa_save_settings', { p: { enabled: true, events: {} } }, owner);
    wa.calls.length = 0;
    const id = await enqueue(tid, '9876543210', 'invoice_link', ['Ravi', 'Test Cafe', 'INV-1', '250', 'https://x/i/1'], 'b-1');
    const r = await until(id, (x) => x.status === 'skipped');
    assert(/not connected|no WhatsApp/i.test(r.error) && wa.calls.length === 0, JSON.stringify(r));
  }, 'critical');

  await s.check('The platform admin can let a shop use the AUZslab number; only the admin can', async () => {
    await fails('admin_wa_set_tenant', { p_tenant: tid, p_allow_platform: true }, owner, 'owner');
    await fails('admin_wa_set_tenant', { p_tenant: tid, p_allow_platform: true }, plain, 'plain');
    await ok('admin_wa_set_tenant', { p_tenant: tid, p_allow_platform: true }, adm);
    wa.calls.length = 0;
    const id = await enqueue(tid, '9876543210', 'invoice_link', ['Ravi', 'Test Cafe', 'INV-2', '250', 'https://x/i/2'], 'b-2');
    const r = await until(id, (x) => x.status === 'sent');
    assert(r.sender === 'platform' && wa.calls[0].auth === 'platform-token-platform-token', JSON.stringify(r));
    const ov = await ok('admin_wa_overview', {}, adm);
    assert(ov.tenants.find((t) => t.id === tid).allow_platform === true && ov.recent.length >= 2 && ov.templates.length >= 10, 'overview incomplete');
    await fails('admin_wa_overview', {}, owner, 'owner');
  });

  await s.check('A shop connects its own number: bad credentials are refused by Meta first, good ones are stored encrypted and used for sending', async () => {
    const bad = await post('/whatsapp/connect', { phone_number_id: '555000111', token: 'badtoken-badtoken-badtoken' }, owner);
    assert(bad.status === 400 && /OAuth|refused|WhatsApp/i.test(JSON.stringify(bad.data)), JSON.stringify(bad));
    assert((await q('select count(*)::int n from wa_accounts'))[0].n === 0, 'saved bad credentials');
    assert((await post('/whatsapp/connect', { phone_number_id: '555000111', token: wa.goodToken }, plain)).status === 403, 'non-owner connected');
    assert((await post('/whatsapp/connect', { phone_number_id: '555000111', token: wa.goodToken })).status === 401, 'logged-out connected');
    const good = await post('/whatsapp/connect', { phone_number_id: '555000111', waba_id: '777', token: wa.goodToken }, owner);
    assert(good.status === 200 && good.data.number, JSON.stringify(good));
    const acc = (await q('select * from wa_accounts'))[0];
    assert(acc.token_enc.startsWith('enc:') && !acc.token_enc.includes(wa.goodToken), 'token not encrypted');
    wa.calls.length = 0;
    const id = await enqueue(tid, '9876543210', 'invoice_link', ['Ravi', 'Test Cafe', 'INV-3', '250', 'https://x/i/3'], 'b-3');
    const r = await until(id, (x) => x.status === 'sent');
    assert(r.sender === 'own' && wa.calls[0].path.includes('555000111') && wa.calls[0].auth === wa.goodToken, JSON.stringify(r) + JSON.stringify(wa.calls[0]));
    const st = await ok('wa_my_status', {}, owner);
    assert(st.connected && st.number && !JSON.stringify(st).includes(wa.goodToken) && !JSON.stringify(st).includes('enc:'), 'status leaks or wrong');
    assert(st.templates.length >= 5 && st.templates.every((t) => t.body && t.name), 'templates missing');
  }, 'critical');

  await s.check('The same bill never queues twice; a message type the owner switched off is not queued', async () => {
    const a = await enqueue(tid, '9876543210', 'invoice_link', ['A', 'S', 'B', '1', 'l'], 'dup-1');
    const b = await enqueue(tid, '9876543210', 'invoice_link', ['A', 'S', 'B', '1', 'l'], 'dup-1');
    assert(a && !b, 'duplicate queued');
    await ok('wa_save_settings', { p: { enabled: true, events: { invoice_link: false, nonsense: false } } }, owner);
    assert(!(await enqueue(tid, '9876543210', 'invoice_link', ['A'], 'off-1')), 'queued although switched off');
    const st = await ok('wa_my_status', {}, owner);
    assert(st.events.invoice_link === false && st.events.nonsense === undefined, 'events not cleaned: ' + JSON.stringify(st.events));
    assert(await enqueue(tid, '9876543210', 'order_ready', ['A', '5', 'S'], 'on-1'), 'other types must still work');
    await ok('wa_save_settings', { p: { enabled: true, events: {} } }, owner);
  });

  await s.check('A glitch at Meta is retried and then sent; a rejected number fails once with the reason and is not retried', async () => {
    for (let i = 0; i < 60 && (await q("select count(*)::int n from wa_outbox where status in ('queued','sending')"))[0].n; i++) await new Promise((k) => setTimeout(k, 150));
    wa.script.push('fail500');
    const a = await enqueue(tid, '9811111111', 'order_ready', ['A', '9', 'S'], 'retry-1');
    const r = await until(a, (x) => x.status === 'sent');
    assert(r.attempts === 2, 'attempts ' + r.attempts);
    wa.script.push('badnumber');
    const b = await enqueue(tid, '9822222222', 'order_ready', ['A', '9', 'S'], 'perm-1');
    const f = await until(b, (x) => x.status === 'failed');
    assert(/allowed list/.test(f.error) && f.attempts === 1, JSON.stringify(f));
  }, 'critical');

  await s.check('Meta\'s webhook: only the right verify token and signature are accepted; receipts move a message forward, never back', async () => {
    const g = (t) => fetch(`${api}/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${t}&hub.challenge=12345`);
    const okRes = await g('wa-verify'); assert(okRes.status === 200 && (await okRes.text()) === '12345', 'handshake');
    assert((await g('wrong')).status === 403, 'handshake with wrong token');
    const id = await enqueue(tid, '9833333333', 'order_ready', ['A', '9', 'S'], 'rcpt-1');
    const sent = await until(id, (x) => x.status === 'sent');
    const hook = async (statuses) => { const raw = JSON.stringify({ entry: [{ changes: [{ value: { statuses } }] }] }); return post('/whatsapp/webhook', raw, null, { 'x-hub-signature-256': sign(raw) }); };
    assert((await post('/whatsapp/webhook', '{"entry":[]}', null, { 'x-hub-signature-256': 'sha256=deadbeef' })).status === 400, 'bad signature accepted');
    assert((await post('/whatsapp/webhook', '{"entry":[]}')).status === 400, 'unsigned accepted');
    assert((await hook([{ id: sent.wa_message_id, status: 'read' }])).status === 200);
    assert((await row(id)).status === 'read', 'read not recorded');
    await hook([{ id: sent.wa_message_id, status: 'delivered' }]);
    assert((await row(id)).status === 'read', 'went backwards');
    await hook([{ id: sent.wa_message_id, status: 'failed', errors: [{ title: 'Undeliverable' }] }]);
    assert((await row(id)).status === 'failed', 'failure not recorded');
  }, 'critical');

  await s.check('A customer who replies STOP is never messaged again by that sender; others are unaffected', async () => {
    const raw = JSON.stringify({ entry: [{ changes: [{ value: { metadata: { phone_number_id: '555000111' }, messages: [{ from: '919844444444', text: { body: 'stop' } }] } }] }] });
    assert((await post('/whatsapp/webhook', raw, null, { 'x-hub-signature-256': sign(raw) })).status === 200);
    assert(!(await enqueue(tid, '9844444444', 'order_ready', ['A', '1', 'S'], 'stop-1')), 'messaged after STOP');
    assert(await enqueue(tid, '9855555555', 'order_ready', ['A', '1', 'S'], 'stop-2'), 'someone else was blocked');
    assert(await enqueue(null, '9844444444', 'welcome', ['A', 'B'], 'stop-3'), 'AUZslab message blocked by a shop opt-out');
  });

  await s.check('Only the owner changes WhatsApp settings; staff and strangers cannot; wa_enqueue is not reachable from a browser; disconnect works', async () => {
    const mgr = await login(USERS.cafeOwner); // same shop owner token again, plus a non-owner below
    await fails('wa_save_settings', { p: { enabled: true } }, plain, 'stranger');
    await fails('wa_my_status', {}, plain, 'stranger');
    await fails('wa_my_status', {}, null, 'logged out');
    const r = await call('wa_enqueue', { p_tenant: tid, p_to: '9876543210', p_template: 'welcome', p_params: [] }, mgr);
    assert(r.status === 404 || r.status === 403, 'wa_enqueue reachable: ' + r.status);
    await ok('wa_disconnect', {}, owner);
    assert((await q('select count(*)::int n from wa_accounts'))[0].n === 0, 'not disconnected');
    assert((await (await fetch(api + '/whatsapp/config')).json()).platform === true, 'config');
  }, 'critical');

  await s.check('A client request messages the client the instant it is submitted (on INSERT, no admin action first), then once per step as it moves: checking, quote link, then the GST bill once paid, each only once', async () => {
    const u = (await q('select id from auth_users where email=$1', [USERS.plain]))[0].id;
    const o = (await q(`insert into client_orders (user_id, contact_name, phone, business_name, status, products) values ($1,'Meera','9866666666','Meera Cafe','requested','{pos}') returning id, token`, [u]))[0];
    const msgs = async () => (await q(`select template, params, status from wa_outbox where tenant_id is null and ref like $1 order by created_at`, [o.id + '-%']));
    // the insert itself already queued "request_received" -- confirmed before any status change happens
    assert((await msgs()).map((x) => x.template).join() === 'request_received', 'no instant confirmation on submit');
    await q(`update client_orders set status='verifying' where id=$1`, [o.id]);
    await q(`update client_orders set status='link_sent' where id=$1`, [o.id]);
    await q(`update client_orders set status='link_sent' where id=$1`, [o.id]); // same status again: no duplicate
    await q(`update client_orders set status='paid', invoice_no='AUZ/2026-27/0099' where id=$1`, [o.id]);
    const m = await msgs();
    assert(m.map((x) => x.template).join() === 'request_received,request_update,quote_payment_link,bill_paid', m.map((x) => x.template).join());
    assert(m[2].params[1] === `https://auzslab.in/pay.html?t=${o.token}` && m[3].params[1] === 'AUZ/2026-27/0099' && m[3].params[2] === `https://auzslab.in/inv.html?t=${o.token}`, JSON.stringify(m));
    await q('delete from client_orders where id=$1', [o.id]);
  });

  await s.check('A confirmed booking and a repair marked ready message the customer from the shop (only when the shop switched WhatsApp on)', async () => {
    await ok('wa_save_settings', { p: { enabled: true, events: {} } }, owner);
    const b = (await q(`insert into bookings (tenant_id, customer_name, customer_phone, date, time, status) values ($1,'Kiran','9877777777','2030-01-05','15:30','pending') returning id`, [tid]))[0];
    assert((await q(`select count(*)::int n from wa_outbox where ref=$1`, [b.id]))[0].n === 0, 'pending booking messaged');
    await q(`update bookings set status='confirmed' where id=$1`, [b.id]);
    const m = (await q(`select template, params from wa_outbox where ref=$1`, [b.id]))[0];
    assert(m && m.template === 'booking_confirmed' && m.params[0] === 'Kiran' && m.params[2] === '05 Jan 2030' && /03:30 PM/.test(m.params[3]), JSON.stringify(m));
    await ok('wa_save_settings', { p: { enabled: false, events: {} } }, owner);
    const b2 = (await q(`insert into bookings (tenant_id, customer_name, customer_phone, date, status) values ($1,'Ola','9888888888','2030-01-06','confirmed') returning id`, [tid]))[0];
    assert((await q(`select count(*)::int n from wa_outbox where ref=$1`, [b2.id]))[0].n === 0, 'messaged although the shop had switched WhatsApp off');
    await q('delete from bookings where tenant_id=$1', [tid]);
  });

  // ---------- db/190: the `invoice_link` template wired to every real sale/invoice completion ----------
  await s.check('A POS bill becoming paid messages the customer once with the shared "invoice_link" template and the staff-side bill link; replaying the already-paid order (a reprint/resync) never messages twice', async () => {
    await ok('wa_save_settings', { p: { enabled: true, events: {} } }, owner);
    const oid = 'wa-pos-' + crypto.randomUUID();
    const open = { id: oid, status: 'open', type: 'Dine-in', cust: { name: 'Priya', phone: '9899999901' }, lines: [{ name: 'Tea', qty: 1, price: 40 }], no: 'TC-9001' };
    await ok('push_record', { rid: oid, rkind: 'order', rdata: open, rdeleted: false, base: null, force: false }, owner);
    assert((await q('select count(*)::int n from wa_outbox where ref=$1', [oid + '-bill']))[0].n === 0, 'messaged before paid');
    const paid = { ...open, status: 'paid', tok: 'tokpos' + oid.slice(-8), t: { total: 40 }, paidAt: new Date().toISOString() };
    await ok('push_record', { rid: oid, rkind: 'order', rdata: paid, rdeleted: false, base: null, force: false }, owner);
    const m = (await q('select template, params from wa_outbox where ref=$1', [oid + '-bill']))[0];
    assert(m && m.template === 'invoice_link' && m.params[0] === 'Priya' && m.params[1] === 'Test Cafe' && m.params[2] === 'TC-9001' && m.params[3] === '40.00' && m.params[4].endsWith('/i.html?o=' + paid.tok), JSON.stringify(m));
    // replay: re-sync the already-paid order (a reprint) must not queue a second one
    await ok('push_record', { rid: oid, rkind: 'order', rdata: { ...paid, printCount: 1 }, rdeleted: false, base: null, force: true }, owner);
    assert((await q('select count(*)::int n from wa_outbox where ref=$1', [oid + '-bill']))[0].n === 1, 'replay duplicated the message');
    // switched off: paying a different order never queues anything
    await ok('wa_save_settings', { p: { enabled: false, events: {} } }, owner);
    const oid2 = 'wa-pos-off-' + crypto.randomUUID();
    await ok('push_record', { rid: oid2, rkind: 'order', rdata: { id: oid2, status: 'paid', cust: { name: 'X', phone: '9899999902' }, lines: [], no: 'TC-9002', tok: 'tokoff', t: { total: 10 } }, rdeleted: false, base: null, force: false }, owner);
    assert((await q('select count(*)::int n from wa_outbox where ref=$1', [oid2 + '-bill']))[0].n === 0, 'messaged while the shop had switched WhatsApp off');
    await ok('wa_save_settings', { p: { enabled: true, events: {} } }, owner);
  }, 'critical');

  await s.check('An AUZsLedger/AUZsScan invoice becoming posted messages the customer once with the shared books\' bill link; a second posting attempt is refused by the books themselves and never duplicates the message; switched off, nothing is queued', async () => {
    const acctOwner = await login(USERS.acctOwner);
    const atid = (await q('select id from tenants where slug=$1', [TENANTS.acct]))[0].id;
    await ok('wa_save_settings', { p: { enabled: true, events: {} } }, acctOwner);
    await ok('acc_bootstrap', {}, acctOwner);
    const party = await ok('acc_save_party', { p: { kind: 'customer', name: 'WA Test Traders', phone: '9899999910' } }, acctOwner);
    const prod = await ok('acc_save_product', { p: { sku: 'WA-TEST-1', name: 'Consulting', is_service: true, sale_price: 1000, tax_rate: 18 } }, acctOwner);
    const doc = await ok('acc_save_document', { p: { doc_type: 'invoice', party_id: party.id, post: true, lines: [{ product_id: prod.id, description: 'Consulting', qty: 1, rate: 1000 }] } }, acctOwner);
    assert(doc.posted, 'did not post: ' + JSON.stringify(doc));
    const m = (await q('select template, params from wa_outbox where tenant_id=$1 and ref=$2', [atid, doc.id + '-bill']))[0];
    assert(m && m.template === 'invoice_link' && m.params[0] === 'WA Test Traders' && m.params[1] === 'Test Accounts' && m.params[2] === doc.number && m.params[3] === '1180.00' && /\/bill\.html\?t=[a-f0-9]{32}$/.test(m.params[4]), JSON.stringify(m));
    await fails('acc_post_document', { p_doc_id: doc.id }, acctOwner, 'already posted'); // never duplicates
    assert((await q('select count(*)::int n from wa_outbox where tenant_id=$1 and ref=$2', [atid, doc.id + '-bill']))[0].n === 1, 'duplicated');
    // switched off
    await ok('wa_save_settings', { p: { enabled: false, events: {} } }, acctOwner);
    const party2 = await ok('acc_save_party', { p: { kind: 'customer', name: 'WA Test Traders 2', phone: '9899999911' } }, acctOwner);
    const doc2 = await ok('acc_save_document', { p: { doc_type: 'invoice', party_id: party2.id, post: true, lines: [{ product_id: prod.id, description: 'Consulting', qty: 1, rate: 500 }] } }, acctOwner);
    assert((await q('select count(*)::int n from wa_outbox where tenant_id=$1 and ref=$2', [atid, doc2.id + '-bill']))[0].n === 0, 'messaged while switched off');
  }, 'critical');

  await s.check('An AUZsMob sale with a customer attached messages them once with the shared receipt link; replaying the same client-generated sale id never duplicates it; no customer or switched off, nothing is queued', async () => {
    const mobOwner = await login(USERS.mobOwner);
    const mtid = (await q('select id from tenants where slug=$1', [TENANTS.mob]))[0].id;
    await ok('wa_save_settings', { p: { enabled: true, events: {} } }, mobOwner);
    const item = await ok('mob_save_item', { p_id: crypto.randomUUID(), p: { name: 'WA Test Cable', category: 'accessory', sellingPrice: 299, costPrice: 150 } }, mobOwner);
    await ok('mob_push_purchase', { p_id: crypto.randomUUID(), p: { itemId: item.id, qty: 5, rate: 150 } }, mobOwner);
    const saleId = crypto.randomUUID();
    const sale = await ok('mob_push_sale', { p_id: saleId, p: { items: [{ itemId: item.id, qty: 1, price: 299 }], customerName: 'Rohit', customerPhone: '9899999920', paymentMode: 'cash' } }, mobOwner);
    const m = (await q('select template, params from wa_outbox where tenant_id=$1 and ref=$2', [mtid, saleId + '-bill']))[0];
    assert(m && m.template === 'invoice_link' && m.params[0] === 'Rohit' && m.params[1] === 'Test Mobile Shop' && m.params[2] === sale.billNo && m.params[3] === '299.00' && /\/mobbill\.html\?t=[a-f0-9]{32}$/.test(m.params[4]), JSON.stringify(m));
    // replay: the exact same client-generated id (a duplicate sync/webhook-style replay) must not duplicate
    await ok('mob_push_sale', { p_id: saleId, p: { items: [{ itemId: item.id, qty: 1, price: 299 }], customerName: 'Rohit', customerPhone: '9899999920', paymentMode: 'cash' } }, mobOwner);
    assert((await q('select count(*)::int n from wa_outbox where tenant_id=$1 and ref=$2', [mtid, saleId + '-bill']))[0].n === 1, 'replay duplicated');
    // no customer attached: never messaged
    const sale2 = crypto.randomUUID();
    await ok('mob_push_sale', { p_id: sale2, p: { items: [{ itemId: item.id, qty: 1, price: 299 }], paymentMode: 'cash' } }, mobOwner);
    assert((await q('select count(*)::int n from wa_outbox where tenant_id=$1 and ref=$2', [mtid, sale2 + '-bill']))[0].n === 0, 'messaged with no customer phone');
    // switched off: never messaged either
    await ok('wa_save_settings', { p: { enabled: false, events: {} } }, mobOwner);
    const sale3 = crypto.randomUUID();
    await ok('mob_push_sale', { p_id: sale3, p: { items: [{ itemId: item.id, qty: 1, price: 299 }], customerName: 'Off Test', customerPhone: '9899999921', paymentMode: 'cash' } }, mobOwner);
    assert((await q('select count(*)::int n from wa_outbox where tenant_id=$1 and ref=$2', [mtid, sale3 + '-bill']))[0].n === 0, 'messaged while switched off');
  }, 'critical');
}
