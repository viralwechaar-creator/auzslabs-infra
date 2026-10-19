import crypto from 'node:crypto';
import { pool, withAuth } from '../db.js';
import { captureError } from '../errors.js';
import { staffLogin, verifyToken } from '../auth.js';
import { DOMAIN, cleanString, fail, hex6, htmlEsc, limited, normalizeOrigin, readBody, round2, sendJson, staffPhone, todayStr, validDate } from './util.js';
import { bookingCounts, freshDb, loadDb, loadSite, mutate, mutateStaffAdmin, originAllowed, payrollOn, readKey, readStaffAdmin, reseedDemo, tenantFor, usesGeneric, writeKey, writeStaffAdmin } from './storage.js';
import { clearSession, getSession, hashPassword, ownerPasswordOk, setSession, verifyScrypt } from './session.js';
import { EXPENSE_CATEGORIES, addBooking, addCashMove, addExpense, addInvoice, cashRangeSummary, cashSummary, clientsList, computeSlots, deletePackageDef, publicSite, saveClientProfile, savePackageDef, sellPackage, settleInvoice } from './rules.js';
import { salonIcon, salonOgImage, saveUpload } from './brand.js';
import { enqueueWa, sendOrRetryWa } from '../whatsapp.js';
import { sendWebPush, vapidReady } from '../push.js';

// Live browser notifications for the owner/staff console (new booking, new bill, staff clock-in/out --
// db/193). Direct JS call for the same reason enqueueWa() above is: nothing here is a SQL row a
// trigger could watch. Never throws -- a notification failure can never block the real action.
async function salonPush(tid, title, body) {
  try {
    if (!vapidReady()) { console.warn('salon push: VAPID keys not configured, skipping'); return; }
    const { rows: subs } = await pool.query('select * from salon_push_subs where tenant_id = $1', [tid]);
    console.log(`salon push: sending "${title}" to ${subs.length} device(s) for tenant ${tid}`);
    await Promise.allSettled(subs.map(async (s) => {
      try {
        const res = await sendWebPush(s.endpoint, s.p256dh, s.auth, { title, body, tag: 'salon' });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          console.error(`salon push failed: ${res.status} ${text} (endpoint ${s.endpoint.slice(0, 60)}...)`);
          if (res.status === 404 || res.status === 410) await pool.query('delete from salon_push_subs where id = $1', [s.id]);
        } else {
          console.log(`salon push sent ok (endpoint ${s.endpoint.slice(0, 60)}...)`);
        }
      } catch (e) { console.error('salon push error:', e.message); }
    }));
  } catch (e) { console.error('salon push outer error:', e.message); }
}

// Entry point: index.js hands over every request whose path starts with
// /salon-api (Caddy rewrites /api/* on tenant subdomains to it).
export async function handleSalon(req, res, ip) {
  try {
    const method = String(req.method || 'GET').toUpperCase();
    const url = new URL(req.url, 'http://x');
    const p = url.pathname.slice('/salon-api'.length) || '/';
    const tenant = await tenantFor(req);
    const tid = tenant.id;

    // CORS, scoped to exactly the four public/cookie-free endpoints a tenant's own external website might call
    // directly (never /admin/*, which stays same-origin-cookie-only). Origin is never trusted for tenant
    // identification or authorization here -- tenantFor() above already resolved the tenant from Host alone;
    // this only decides whether to let an approved origin's browser JS read the response. An unapproved/absent
    // origin simply gets no CORS header (today's behavior, unchanged) -- the request itself still runs normally.
    const corsPath = p === '/site' || p === '/slots' || p === '/bookings' || /^\/invoice\/[a-f0-9]{8,32}$/.test(p);
    let corsOrigin = null;
    if (corsPath && req.headers.origin) {
      const norm = normalizeOrigin(req.headers.origin);
      if (norm && await originAllowed(tid, norm)) corsOrigin = norm;
    }
    if (corsOrigin) { res.setHeader('Access-Control-Allow-Origin', corsOrigin); res.setHeader('Vary', 'Origin'); }
    if (method === 'OPTIONS' && corsPath && corsOrigin) {
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' });
      return res.end();
    }

    const body = ['POST', 'PUT', 'PATCH'].includes(method) ? await readBody(req) : {};
    const sess = getSession(req, tid);
    // member(): any signed-in console user (owner or an active staff member).
    // admin(): owner only -- the default for every endpoint below, so a new
    // endpoint is owner-only unless it is explicitly opened to staff.
    const member = async () => {
      if (!sess) fail(401, 'Unauthorized.');
      if (sess.role === 'staff') {
        const st = ((await readStaffAdmin(tenant, 'staff')) || { list: [] }).list.find((x) => x.id === sess.sid);
        if (!st || st.active === false) fail(401, 'Unauthorized.');
      }
      return sess;
    };
    const admin = async () => { const m = await member(); if (m.role !== 'owner') fail(403, 'Only the owner can do that.'); return m; };
    const noDemo = () => { if (tenant.is_demo) fail(403, 'Not available on the demo salon.'); };
    const send = (s, d) => sendJson(res, s, d);

    // Public reads touch only the cached website half; the private bookings/bills are never loaded for them.
    if (method === 'GET' && p === '/manifest.json') {
      const S = (await loadSite(tenant)).settings || {}, t = S.theme || {};
      const adm = url.searchParams.get('app') === 'admin';
      const name = String(S.salonName || tenant.name || 'Salon').slice(0, 38) + (adm ? ' Admin' : '');
      res.writeHead(200, { 'Content-Type': 'application/manifest+json; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
      return res.end(JSON.stringify({
        name, short_name: adm ? 'Salon Admin' : name.slice(0, 12), start_url: adm ? '/salon/admin/' : '/salon/', scope: '/salon/', display: 'standalone',
        background_color: hex6(t.cream, '#F3E6C8'), theme_color: hex6(t.plum, '#391D21'),
        icons: [192, 512].flatMap((n) => ['any', 'maskable'].map((purpose) => ({ src: `/api/icon/${n}.png`, sizes: `${n}x${n}`, type: 'image/png', purpose }))),
      }));
    }
    const ic = p.match(/^\/icon\/(32|180|192|512)\.png$/);
    if (method === 'GET' && ic) {
      // Showoff Salon keeps its original hand-made icons (static files); every other salon gets a generated one.
      if (tenant.slug === 'showoffsalon') { res.writeHead(302, { Location: `/salon/assets/${ic[1] === '32' ? 'favicon' : 'icon-' + ic[1]}.png`, 'Cache-Control': 'public, max-age=300' }); return res.end(); }
      let png;
      try { png = await salonIcon(tenant, await loadSite(tenant), Number(ic[1])); }
      catch (e) { res.writeHead(302, { Location: `/salon/assets/icon-${ic[1] === '32' ? '192' : ic[1]}.png` }); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300' });
      return res.end(png);
    }
    // Served only to link-preview crawlers (Caddy matches their User-Agent): the salon's own title, text and picture.
    if (method === 'GET' && p === '/share') {
      const S = (await loadSite(tenant)).settings || {}, C = (await loadSite(tenant)).content || {};
      const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].replace(/[^a-z0-9.:-]/gi, '');
      const origin = 'https://' + host;
      const name = S.salonName || tenant.name || 'Salon';
      const title = [name, S.tagline].filter(Boolean).join(' | ').slice(0, 110);
      const desc = String(C.heroText || S.tagline || ('Book an appointment at ' + name)).replace(/\s+/g, ' ').slice(0, 200);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' });
      return res.end(`<!doctype html><html><head><meta charset="utf-8"><title>${htmlEsc(title)}</title><meta name="description" content="${htmlEsc(desc)}">
<meta property="og:type" content="website"><meta property="og:site_name" content="${htmlEsc(name)}"><meta property="og:title" content="${htmlEsc(title)}"><meta property="og:description" content="${htmlEsc(desc)}">
<meta property="og:url" content="${htmlEsc(origin + '/')}"><meta property="og:image" content="${htmlEsc(origin + '/api/og.png')}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${htmlEsc(title)}"><meta name="twitter:description" content="${htmlEsc(desc)}"><meta name="twitter:image" content="${htmlEsc(origin + '/api/og.png')}">
</head><body><a href="/salon/">${htmlEsc(name)}</a></body></html>`);
    }
    if (method === 'GET' && p === '/og.png') {
      if (tenant.slug === 'showoffsalon') { res.writeHead(302, { Location: '/salon/assets/og-image.jpg' }); return res.end(); }
      let png;
      try { png = await salonOgImage(tenant, await loadSite(tenant)); } catch (e) { res.writeHead(302, { Location: '/salon/assets/og-image.jpg' }); return res.end(); }
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=300' });
      return res.end(png);
    }
    if (method === 'GET' && p === '/site') return send(200, publicSite(await loadSite(tenant)));
    if (method === 'GET' && p === '/slots') return send(200, computeSlots(await loadSite(tenant), await bookingCounts(tenant), String(url.searchParams.get('date') || '')));
    if (method === 'GET' && p === '/admin/me') {
      if (!sess) return send(200, { admin: false });
      if (sess.role === 'staff') {
        const st = ((await readStaffAdmin(tenant, 'staff')) || { list: [] }).list.find((x) => x.id === sess.sid);
        if (!st || st.active === false) return send(200, { admin: false });
        return send(200, { admin: true, role: 'staff', name: st.name, payroll: !!st.employeeId && await payrollOn(tid), demo: !!tenant.is_demo });
      }
      return send(200, { admin: true, role: 'owner', name: 'Owner', demo: !!tenant.is_demo });
    }

    const inv = p.match(/^\/invoice\/([a-f0-9]{8,32})$/);
    if (method === 'GET' && inv) {
      const s = (await loadSite(tenant)).settings;
      const invoices = usesGeneric(tenant) ? (await loadDb(tenant)).invoices : ((await readKey(pool, tid, 'data')) || {}).invoices || [];
      const invoice = invoices.find((x) => x.token === inv[1] && !x.void);
      if (!invoice) fail(404, 'Invoice not found.');
      return send(200, { invoice, salon: { salonName: s.salonName, address: s.address, phone: s.phone, email: s.email, instagram: s.instagram, invoiceFooter: s.invoiceFooter, logo: s.logo, logoLight: s.logoLight, theme: s.theme } });
    }

    if (method === 'POST' && p === '/bookings') {
      if (limited(`book:${tid}:${ip}`, 20, 60 * 60_000)) fail(429, 'Too many requests, please try again later.');
      const booking = await mutate(tenant, (db) => addBooking(db, body, false), ['site', 'data'], ['data']);
      salonPush(tid, 'New booking', `${booking.name} — ${booking.date} ${booking.time}`);
      return send(201, { ok: true, booking });
    }

    if (method === 'POST' && p === '/admin/login') {
      if (limited(`salonlogin:${ip}`, 30, 15 * 60_000)) fail(429, 'Too many attempts. Try again later.');
      const password = String(body.password || body.pin || '');
      if (!password) fail(400, 'Password is required.');
      await loadSite(tenant);
      if (body.username) {
        // Staff sign-in with the username + PIN the owner created under Staff in the client dashboard (db/096).
        const r = await staffLogin(body.username, password, { ip, userAgent: req.headers['user-agent'] });
        if (r && r.locked) fail(429, 'Too many wrong PINs. Try again in 15 minutes.');
        if (!r) fail(401, 'Wrong username or PIN.');
        const prof = await withAuth(r.user.id, async (c) => (await c.query('select tenant_id, role, login_off from profiles where id = $1', [r.user.id])).rows[0]);
        if (!prof || prof.tenant_id !== tid || prof.login_off) fail(401, 'Wrong username or PIN.');
        const uname = String(body.username).trim().toLowerCase();
        const um = r.user.user_metadata || {};
        const name = cleanString(um.full_name || um.name || uname.split('.')[0], 80);
        let st;
        const payOn = await payrollOn(tid);
        await mutateStaffAdmin(tenant, 'staff', async (d) => {
          d.list = d.list || [];
          st = d.list.find((x) => x.userId === r.user.id);
          if (!st) { st = { id: crypto.randomUUID(), userId: r.user.id, name, phone: '', designation: prof.role === 'manager' ? 'Manager' : 'Staff', active: true, employeeId: null, createdAt: new Date().toISOString() }; d.list.push(st); }
          else if (st.active === false) { st = null; return; }
          // Payroll add-on on: link this person to a payroll employee once, so they can clock in (owner sets salary in Payroll).
          if (payOn && !st.employeeId) st.employeeId = (await pool.query('select salon_hr_ensure($1, $2, $3, $4) as id', [tid, st.name, '', st.designation])).rows[0].id;
        }, { list: [] });
        if (!st) fail(401, 'This login is turned off.');
        setSession(res, tid, { role: 'staff', sid: st.id, name: st.name });
        return send(200, { ok: true, role: 'staff' });
      }
      if (body.phone) {
        // Staff sign-in: phone number + the password the owner set for them.
        const phone = staffPhone(body.phone);
        if (phone.length < 6 || limited(`stafflogin:${tid}:${phone}`, 8, 15 * 60_000)) fail(429, 'Too many attempts. Try again later.');
        const st = ((await readStaffAdmin(tenant, 'staff')) || { list: [] }).list.find((x) => x.phone === phone && x.active !== false);
        if (!st || !st.passwordHash || !verifyScrypt(password, st.passwordHash)) fail(401, 'Invalid phone number or password.');
        setSession(res, tid, { role: 'staff', sid: st.id, name: st.name });
        return send(200, { ok: true, role: 'staff' });
      }
      const result = await (async () => {
        const client = await pool.connect();
        try {
          await client.query('begin');
          const a = (await readKey(client, tid, 'admin', true)) || {};
          if (a.lockedUntil && Date.now() < a.lockedUntil) {
            await client.query('commit');
            const mins = Math.ceil((a.lockedUntil - Date.now()) / 60000);
            return { status: 429, error: `Too many attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` };
          }
          const ok = a.passwordHash ? verifyScrypt(password, a.passwordHash) : await ownerPasswordOk(tid, password);
          if (!ok) {
            a.failCount = (a.failCount || 0) + 1;
            if (a.failCount >= 8) { a.lockedUntil = Date.now() + 15 * 60_000; a.failCount = 0; }
            await writeKey(client, tid, 'admin', a);
            await client.query('commit');
            return { status: 401, error: 'Invalid password.' };
          }
          a.failCount = 0; a.lockedUntil = 0;
          await writeKey(client, tid, 'admin', a);
          await client.query('commit');
          return { status: 200 };
        } catch (e) { await client.query('rollback').catch(() => {}); throw e; } finally { client.release(); }
      })();
      if (result.status !== 200) fail(result.status, result.error);
      setSession(res, tid);
      return send(200, { ok: true, role: 'owner' });
    }
    // A salesman's "Open their admin console" (salesman.html): the page passes the trial owner's
    // AUZslab session in the URL fragment, the console posts it here, and if it really is the owner
    // of THIS salon we start the console session. Nothing else changes about how sign-in works.
    if (method === 'POST' && p === '/admin/handoff') {
      if (limited(`salonhand:${ip}`, 30, 15 * 60_000)) fail(429, 'Too many attempts. Try again later.');
      const u = verifyToken(String(body.token || ''));
      if (!u) fail(401, 'This link has expired. Open it again from the salesman page.');
      const prof = await withAuth(u.id, async (c) => (await c.query('select tenant_id, role from profiles where id = $1', [u.id])).rows[0]);
      if (!prof || prof.tenant_id !== tid || prof.role !== 'owner') fail(403, 'Not the owner of this salon.');
      setSession(res, tid, { role: 'owner' });
      return send(200, { ok: true, role: 'owner' });
    }
    if (method === 'POST' && p === '/admin/logout') { clearSession(res); return send(200, { ok: true }); }

    // ---- everything below needs the console session ----
    if (method === 'GET' && p === '/bookings') { await member(); return send(200, { bookings: (await loadDb(tenant)).bookings || [] }); }

    if (method === 'GET' && p === '/admin/data') {
      const me = await member();
      const db = await loadDb(tenant);
      if (me.role === 'staff') {
        // Staff get what Today / Bookings / Billing / Clients need and nothing
        // else: no expenses, website text, gallery, or other people's bills
        // (so no revenue totals either).
        const mine = (db.invoices || []).filter((i) => i.createdBy && i.createdBy.id === me.sid);
        const { bgMusic, ...settings } = db.settings;
        return send(200, {
          settings, menu: db.menu, content: {}, gallery: [], expenses: [],
          stylists: (db.stylists || []).filter((x) => x.visible && x.name !== 'Add name').map((x) => ({ id: x.id, name: x.name, role: x.role })),
          bookings: db.bookings || [], invoices: mine, clients: clientsList({ bookings: db.bookings, invoices: mine, clients: db.clients }),
          packages: (db.packages || []).filter((x) => x.active !== false), clientPackages: db.clientPackages || [], today: todayStr(),
        });
      }
      return send(200, {
        settings: db.settings, menu: db.menu, content: db.content, stylists: db.stylists || [], gallery: db.gallery || [],
        bookings: db.bookings || [], invoices: db.invoices || [], expenses: db.expenses || [], clients: clientsList(db),
        packages: db.packages || [], clientPackages: db.clientPackages || [], today: todayStr(),
      });
    }

    const put = p.match(/^\/admin\/(settings|menu|content|stylists|gallery)$/);
    if (method === 'PUT' && put) {
      await admin();
      const k = put[1];
      const isArr = Array.isArray(body);
      if (['menu', 'stylists', 'gallery'].includes(k) && !isArr) fail(400, `${k[0].toUpperCase() + k.slice(1)} must be an array.`);
      if (k === 'content' && (!body || typeof body !== 'object' || isArr)) fail(400, 'Content must be an object.');
      await mutate(tenant, (db) => { db[k] = body; }, ['site']);
      return send(200, { ok: true });
    }

    const bk = p.match(/^\/admin\/bookings\/(.+)$/);
    if (method === 'PATCH' && bk) {
      await member();
      const id = decodeURIComponent(bk[1]);
      const booking = await mutate(tenant, (db) => {
        const b = (db.bookings || []).find((x) => String(x.id) === id);
        if (!b) fail(404, 'Booking not found.');
        if (body.status !== undefined) {
          if (!['pending', 'confirmed', 'completed', 'cancelled'].includes(body.status)) fail(400, 'Invalid booking status.');
          b.status = body.status;
        }
        return b;
      }, ['data']);
      return send(200, { ok: true, booking });
    }
    if (method === 'DELETE' && bk) {
      await admin();
      const id = decodeURIComponent(bk[1]);
      await mutate(tenant, (db) => {
        const before = db.bookings || [];
        db.bookings = before.filter((x) => String(x.id) !== id);
        if (db.bookings.length === before.length) fail(404, 'Booking not found.');
      }, ['data']);
      return send(200, { ok: true });
    }
    if (method === 'POST' && p === '/admin/bookings') { await member(); return send(201, { ok: true, booking: await mutate(tenant, (db) => addBooking(db, body, true), ['site', 'data'], ['data']) }); }

    if (method === 'POST' && p === '/admin/invoices') {
      const me = await member();
      const invoice = await mutate(tenant, (db) => addInvoice(db, body, me), ['site', 'data'], ['data']);
      // WhatsApp "your bill is ready" link (invoice_link, db/184) -- a direct JS call since a salon's
      // bills are a JSON blob mutated here, not a row a SQL trigger could watch (see db/190's own
      // comment). enqueueWa() never throws and wa_enqueue() itself already checks the owner's
      // wa_tenant_settings.enabled switch, so this can never block saving the invoice.
      if (invoice && invoice.client && invoice.client.phone && DOMAIN) {
        await enqueueWa(tid, invoice.client.phone, 'invoice_link',
          [invoice.client.name || 'there', tenant.name || 'us', invoice.no, invoice.total.toFixed(2),
           `https://${tenant.slug}.${DOMAIN}/i/${invoice.token}`],
          invoice.id + '-bill');
      }
      salonPush(tid, 'New bill', `${(invoice.client && invoice.client.name) || 'A customer'} — ₹${invoice.total.toFixed(2)}`);
      return send(201, { ok: true, invoice });
    }

    // ---- cash register (opening float, cash in/out, closing count) + payment-mode settlement ----
    // Open to any signed-in console user (member(), not admin()): the same trust level as creating a
    // bill or taking a booking -- a cashier opens/closes the drawer they're working from, same as the
    // main POS's own cash drawer. All arithmetic lives in rules.js (addCashMove/cashSummary), never here.
    if (method === 'POST' && p === '/admin/cash/move') {
      const me = await member();
      const entry = await mutate(tenant, (db) => addCashMove(db, body, me), ['site', 'data'], ['data']);
      return send(201, { ok: true, entry });
    }
    if (method === 'GET' && p === '/admin/cash/summary') {
      await member();
      const date = String(url.searchParams.get('date') || todayStr());
      return send(200, cashSummary(await loadDb(tenant), date));
    }
    if (method === 'GET' && p === '/admin/cash/range') {
      await member();
      const from = String(url.searchParams.get('from') || todayStr());
      const to = String(url.searchParams.get('to') || todayStr());
      return send(200, cashRangeSummary(await loadDb(tenant), from, to));
    }

    // ---- client profiles (dob/anniversary/notes, db/196) -- open to any signed-in console user, same
    // trust level as billing/bookings: a staffer entering a client's birthday is no more sensitive than
    // them entering the client's name and phone on a bill.
    if (method === 'POST' && p === '/admin/clients') {
      await member();
      const client = await mutate(tenant, (db) => saveClientProfile(db, body), ['site', 'data'], ['data']);
      return send(201, { ok: true, client });
    }

    // ---- packages / memberships (db/196) ----
    if (method === 'POST' && p === '/admin/packages') {
      await admin(); noDemo();
      const pkg = await mutate(tenant, (db) => savePackageDef(db, body), ['site']);
      return send(201, { ok: true, package: pkg });
    }
    const pk = p.match(/^\/admin\/packages\/(.+)$/);
    if (method === 'DELETE' && pk) {
      await admin(); noDemo();
      const id = decodeURIComponent(pk[1]);
      await mutate(tenant, (db) => deletePackageDef(db, id), ['site']);
      return send(200, { ok: true });
    }
    if (method === 'POST' && p === '/admin/packages/sell') {
      const me = await member();
      const rec = await mutate(tenant, (db) => sellPackage(db, body), ['site', 'data'], ['data']);
      return send(201, { ok: true, clientPackage: rec });
    }

    const ivWa = p.match(/^\/admin\/invoices\/(.+)\/whatsapp$/);
    if (method === 'POST' && ivWa) {
      await member();
      const id = decodeURIComponent(ivWa[1]);
      const db = await loadDb(tenant);
      const invoice = (db.invoices || []).find((x) => String(x.id) === id);
      if (!invoice) fail(404, 'Invoice not found.');
      if (invoice.void) fail(400, 'This invoice was voided.');
      if (!invoice.client || !invoice.client.phone) fail(400, 'No phone number on this bill.');
      if (!DOMAIN) fail(400, 'WhatsApp sending is not set up on this server.');
      const r = await sendOrRetryWa(tid, invoice.client.phone, 'invoice_link',
        [invoice.client.name || 'there', tenant.name || 'us', invoice.no, invoice.total.toFixed(2),
         `https://${tenant.slug}.${DOMAIN}/i/${invoice.token}`],
        invoice.id + '-bill');
      if (!r.ok) fail(400, r.reason === 'disabled' ? 'Automatic WhatsApp sending is off. Turn it on in Settings, or use the Send on WhatsApp link.' : 'Could not send.');
      return send(200, { ok: true, status: r.status });
    }
    const ivSettle = p.match(/^\/admin\/invoices\/(.+)\/settle$/);
    if (method === 'POST' && ivSettle) {
      const me = await member();
      const id = decodeURIComponent(ivSettle[1]);
      const invoice = await mutate(tenant, (db) => settleInvoice(db, id), ['site', 'data'], ['data']);
      return send(200, { ok: true, invoice });
    }
    const iv = p.match(/^\/admin\/invoices\/(.+)$/);
    if (method === 'DELETE' && iv) {
      await admin();
      const id = decodeURIComponent(iv[1]);
      await mutate(tenant, (db) => {
        const i = (db.invoices || []).find((x) => String(x.id) === id);
        if (!i) fail(404, 'Invoice not found.');
        i.void = true;
      }, ['data']);
      return send(200, { ok: true });
    }

    if (method === 'POST' && p === '/admin/expenses') { await admin(); return send(201, { ok: true, expense: await mutate(tenant, (db) => addExpense(db, body), ['data']) }); }
    const ex = p.match(/^\/admin\/expenses\/(.+)$/);
    if (method === 'PATCH' && ex) {
      await admin();
      const id = decodeURIComponent(ex[1]);
      const expense = await mutate(tenant, (db) => {
        const e = (db.expenses || []).find((x) => String(x.id) === id);
        if (!e) fail(404, 'Expense not found.');
        if (body.date !== undefined && validDate(body.date)) e.date = cleanString(body.date, 10);
        if (body.category !== undefined && EXPENSE_CATEGORIES.includes(body.category)) e.category = body.category;
        if (body.note !== undefined) e.note = cleanString(body.note, 200);
        if (body.amount !== undefined) {
          const a = round2(Number(body.amount) || 0);
          if (a <= 0) fail(400, 'Enter an amount greater than zero.');
          e.amount = a;
        }
        return e;
      }, ['data']);
      return send(200, { ok: true, expense });
    }
    if (method === 'DELETE' && ex) {
      await admin();
      const id = decodeURIComponent(ex[1]);
      await mutate(tenant, (db) => {
        const before = db.expenses || [];
        db.expenses = before.filter((x) => String(x.id) !== id);
        if (db.expenses.length === before.length) fail(404, 'Expense not found.');
      }, ['data']);
      return send(200, { ok: true });
    }

    if (method === 'POST' && p === '/admin/upload') {
      await admin(); noDemo();
      const m = String(body.dataUrl || '').match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
      if (!m) fail(400, 'Upload a JPG, PNG or WebP image.');
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 4 * 1024 * 1024) fail(413, 'Image is larger than 4 MB.');
      const mg = buf.subarray(0, 12);
      const okMagic = (m[1] === 'jpeg' && mg[0] === 0xff && mg[1] === 0xd8) || (m[1] === 'png' && mg.subarray(1, 4).toString() === 'PNG')
        || (m[1] === 'webp' && mg.subarray(0, 4).toString() === 'RIFF' && mg.subarray(8, 12).toString() === 'WEBP');
      if (!okMagic) fail(400, 'That file is not a valid image.');
      return send(201, { ok: true, src: await saveUpload(tenant, buf, m[1] === 'jpeg' ? 'jpg' : m[1]) });
    }
    if (method === 'POST' && p === '/admin/upload-audio') {
      await admin(); noDemo();
      const m = String(body.dataUrl || '').match(/^data:audio\/mpeg;base64,([A-Za-z0-9+/=]+)$/);
      if (!m) fail(400, 'Upload an MP3 file.');
      const buf = Buffer.from(m[1], 'base64');
      if (buf.length > 8 * 1024 * 1024) fail(413, 'Audio is larger than 8 MB.');
      const mg = buf.subarray(0, 3);
      if (!((mg[0] === 0x49 && mg[1] === 0x44 && mg[2] === 0x33) || (mg[0] === 0xff && (mg[1] & 0xe0) === 0xe0))) fail(400, 'That file is not a valid MP3.');
      return send(201, { ok: true, src: await saveUpload(tenant, buf, 'mp3') });
    }

    if (method === 'POST' && p === '/admin/password') {
      const me = await member();
      noDemo();
      const cur = String(body.current || '');
      const next = String(body.next || '');
      if (me.role === 'staff') {
        // A staff member changes their own password only.
        if (next.length < 6) fail(400, 'New password must be at least 6 characters.');
        await mutateStaffAdmin(tenant, 'staff', (d) => {
          const st = (d.list || []).find((x) => x.id === me.sid);
          if (!st || !verifyScrypt(cur, st.passwordHash)) fail(400, 'Current password is wrong.');
          st.passwordHash = hashPassword(next);
        }, { list: [] });
        return send(200, { ok: true });
      }
      await loadSite(tenant);
      const a = (await readStaffAdmin(tenant, 'admin')) || {};
      const ok = a.passwordHash ? verifyScrypt(cur, a.passwordHash) : await ownerPasswordOk(tid, cur);
      if (!ok) fail(400, 'Current password is wrong.');
      if (next.length < 8) fail(400, 'New password must be at least 8 characters.');
      await writeStaffAdmin(tenant, 'admin', { passwordHash: hashPassword(next), failCount: 0, lockedUntil: 0 });
      setSession(res, tid);
      return send(200, { ok: true });
    }

    if (method === 'POST' && p === '/admin/push/subscribe') {
      await member();
      const endpoint = String(body.endpoint || '');
      const p256dh = String((body.keys && body.keys.p256dh) || body.p256dh || '');
      const auth = String((body.keys && body.keys.auth) || body.auth || '');
      if (!endpoint || !p256dh || !auth) fail(400, 'Missing subscription details.');
      await pool.query(
        'insert into salon_push_subs (tenant_id, endpoint, p256dh, auth) values ($1, $2, $3, $4) ' +
        'on conflict (tenant_id, endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth',
        [tid, endpoint, p256dh, auth],
      );
      return send(200, { ok: true });
    }
    if (method === 'POST' && p === '/admin/push/unsubscribe') {
      await member();
      const endpoint = String(body.endpoint || '');
      if (endpoint) await pool.query('delete from salon_push_subs where tenant_id = $1 and endpoint = $2', [tid, endpoint]);
      return send(200, { ok: true });
    }


    // ---- WhatsApp automation (db/184/db/190) ----
    // The salon console authenticates with its own cookie session (admin()/member() above), never
    // the generic auth_users JWT, so it can't call wa_save_settings/wa_my_status (which key off
    // app_uid()). wa_tenant_settings has no RLS (same raw-pool-only pattern as phone_otps/payments --
    // see CLAUDE.md), so a plain pool query here, already gated by admin(), is the right shape.
    if (method === 'GET' && p === '/admin/whatsapp') {
      await admin();
      const [{ rows: [s] }, { rows: tmpl }] = await Promise.all([
        pool.query('select enabled, allow_platform, events from wa_tenant_settings where tenant_id = $1', [tid]),
        pool.query("select key, name, title, body from wa_templates where audience = 'shop' order by key"),
      ]);
      const events = (s && s.events) || {};
      return send(200, { enabled: !!(s && s.enabled), allowPlatform: !!(s && s.allow_platform),
        templates: tmpl.map((t) => ({ ...t, on: events[t.key] !== false })) });
    }
    if (method === 'POST' && p === '/admin/whatsapp') {
      await admin(); noDemo();
      const enabled = !!body.enabled;
      // `events`: an optional {templateKey: boolean} patch -- false switches that one message type off
      // without touching the master switch or any other template (same mechanism db/184 documents).
      // Merged, not replaced, so toggling one template never silently resets another the owner already set.
      const patch = {};
      if (body.events && typeof body.events === 'object') {
        for (const [k, v] of Object.entries(body.events)) if (typeof v === 'boolean') patch[k] = v;
      }
      await pool.query(
        `insert into wa_tenant_settings (tenant_id, enabled, events) values ($1, $2, $3::jsonb)
         on conflict (tenant_id) do update set enabled = excluded.enabled,
           events = coalesce(wa_tenant_settings.events, '{}'::jsonb) || excluded.events, updated_at = now()`,
        [tid, enabled, JSON.stringify(patch)],
      );
      return send(200, { ok: true, enabled });
    }

    // ---- staff accounts (owner only) ----
    const staffView = (st, invoices) => ({
      id: st.id, name: st.name, phone: st.phone, designation: st.designation || '', active: st.active !== false,
      employeeId: st.employeeId || null, createdAt: st.createdAt,
      bills: (invoices || []).filter((i) => !i.void && i.createdBy && i.createdBy.id === st.id).length,
    });
    if (method === 'GET' && p === '/admin/staff') {
      await admin();
      const db = await loadDb(tenant);
      const d = (await readStaffAdmin(tenant, 'staff')) || { list: [] };
      const pay = await payrollOn(tid);
      return send(200, { payroll: pay, staff: d.list.map((st) => staffView(st, db.invoices)), employees: pay ? (await pool.query('select salon_hr_list($1) as l', [tid])).rows[0].l : [] });
    }
    if (method === 'POST' && p === '/admin/staff') {
      await admin(); noDemo();
      const name = cleanString(body.name, 80);
      const phone = staffPhone(body.phone);
      const password = String(body.password || '');
      if (name.length < 2) fail(400, 'Enter the staff member\'s name.');
      if (phone.length < 6) fail(400, 'Enter a valid phone number.');
      if (password.length < 6) fail(400, 'Password must be at least 6 characters.');
      const designation = cleanString(body.designation, 60) || 'Stylist';
      const pay = await payrollOn(tid);
      let employeeId = pay ? cleanString(body.employeeId, 60) || null : null;
      if (pay && body.payroll !== false && !employeeId) employeeId = (await pool.query('select salon_hr_ensure($1, $2, $3, $4) as id', [tid, name, phone, designation])).rows[0].id;
      const st = { id: crypto.randomUUID(), name, phone, designation, passwordHash: hashPassword(password), active: true, employeeId, createdAt: new Date().toISOString() };
      await mutateStaffAdmin(tenant, 'staff', (d) => {
        if ((d.list || []).some((x) => x.phone === phone)) fail(409, 'A staff member with this phone number already exists.');
        d.list = [...(d.list || []), st];
      }, { list: [] });
      return send(201, { ok: true, staff: staffView(st, []) });
    }
    const sm = p.match(/^\/admin\/staff\/([0-9a-f-]{36})$/);
    if (method === 'PATCH' && sm) {
      await admin(); noDemo();
      // "Link to payroll" (after the Payroll add-on is switched on): create or
      // find the payroll employee for this person.
      let linkId = null;
      if (body.linkPayroll) {
        if (!(await payrollOn(tid))) fail(400, 'Payroll is not on your account yet.');
        const cur = ((await readStaffAdmin(tenant, 'staff')) || { list: [] }).list.find((x) => x.id === sm[1]);
        if (!cur) fail(404, 'Staff member not found.');
        linkId = (await pool.query('select salon_hr_ensure($1, $2, $3, $4) as id', [tid, cur.name, cur.phone, cur.designation])).rows[0].id;
      }
      const out = await mutateStaffAdmin(tenant, 'staff', (d) => {
        const st = (d.list || []).find((x) => x.id === sm[1]);
        if (!st) fail(404, 'Staff member not found.');
        if (body.name !== undefined) st.name = cleanString(body.name, 80) || st.name;
        if (body.designation !== undefined) st.designation = cleanString(body.designation, 60);
        if (body.active !== undefined) st.active = !!body.active;
        if (body.employeeId !== undefined) st.employeeId = cleanString(body.employeeId, 60) || null;
        if (linkId) st.employeeId = linkId;
        if (body.phone !== undefined) {
          const ph = staffPhone(body.phone);
          if (ph.length < 6) fail(400, 'Enter a valid phone number.');
          if (d.list.some((x) => x.phone === ph && x.id !== st.id)) fail(409, 'A staff member with this phone number already exists.');
          st.phone = ph;
        }
        if (body.password) {
          if (String(body.password).length < 6) fail(400, 'Password must be at least 6 characters.');
          st.passwordHash = hashPassword(String(body.password));
        }
        return staffView(st, []);
      }, { list: [] });
      return send(200, { ok: true, staff: out });
    }
    if (method === 'DELETE' && sm) {
      await admin(); noDemo();
      await mutateStaffAdmin(tenant, 'staff', (d) => {
        const before = d.list || [];
        d.list = before.filter((x) => x.id !== sm[1]);
        if (d.list.length === before.length) fail(404, 'Staff member not found.');
      }, { list: [] });
      return send(200, { ok: true });
    }

    // ---- clock in / out: writes the same hr_attendance record AUZslab
    // Payroll reads, for a staff member linked to a payroll employee ----
    if (p === '/admin/punch' && (method === 'GET' || method === 'POST')) {
      const me = await member();
      if (me.role !== 'staff') fail(400, 'Clock in is for staff logins.');
      const st = ((await readStaffAdmin(tenant, 'staff')) || { list: [] }).list.find((x) => x.id === me.sid);
      if (!st.employeeId || !(await payrollOn(tid))) fail(400, 'Your login is not linked to payroll yet. Ask the owner.');
      if (method === 'GET') return send(200, (await pool.query('select salon_punch_state($1, $2, $3) as s', [tid, st.employeeId, todayStr()])).rows[0].s || { open: false, recent: [] });
      const r = await pool.query('select salon_punch($1, $2, $3, $4) as r', [tid, st.employeeId, todayStr(), new Date().toISOString()]);
      salonPush(tid, 'Staff clock-in/out', `${st.name} clocked ${r.rows[0].r.open ? 'in' : 'out'}`);
      return send(200, { ok: true, ...r.rows[0].r });
    }

    if (method === 'GET' && p === '/admin/export') { await admin(); return send(200, await loadDb(tenant)); }
    if (method === 'POST' && p === '/admin/clear-history') {
      await admin();
      await mutate(tenant, (db) => { db.bookings = []; db.invoices = []; db.expenses = []; db.counters = { booking: 0, invoice: 0 }; }, ['data']);
      return send(200, { ok: true });
    }
    if (method === 'POST' && p === '/admin/reset') {
      await admin();
      if (tenant.is_demo) await reseedDemo(tenant);
      else await mutate(tenant, () => ({ replace: freshDb(tenant), value: { ok: true } }));
      return send(200, { ok: true });
    }

    fail(404, 'Not found.');
  } catch (e) {
    const status = Number(e && e.status) || 500;
    // method/p are declared inside the try block above (block-scoped,
    // not visible here) -- re-derive the same minimal context directly
    // from req instead of reaching into that scope.
    if (status >= 500) { console.error(e); captureError(e, { method: req.method, path: req.url }); }
    if (res.headersSent) return res.end();
    sendJson(res, status, { error: status >= 500 ? 'Something went wrong. Please try again.' : String(e.message || 'Request failed.') });
  }
}
