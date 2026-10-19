import crypto from 'node:crypto';
import { cleanPhone, cleanString, fail, round2, todayStr, validDate, validTime } from './util.js';

export const EXPENSE_CATEGORIES = ['rent', 'salary', 'bills', 'purchase', 'other'];
export const PAYMENT_MODES = ['cash', 'upi', 'card', 'credit'];
export const CASH_MOVE_TYPES = ['open', 'in', 'out', 'close'];

export function publicSite(db) {
  return {
    settings: db.settings, menu: db.menu, content: db.content,
    stylists: (db.stylists || []).filter((s) => s.visible && s.name !== 'Add name'),
    gallery: (db.gallery || []).filter((g) => g.visible),
    today: todayStr(),
  };
}

export function computeSlots(site, counts, date) {
  const S = site.settings;
  if (!validDate(date)) fail(400, 'Invalid date.');
  const day = new Date(date + 'T00:00:00Z').getUTCDay();
  if ((S.closedDays || []).includes(day)) return { closed: true, reason: 'Closed that day.', slots: [] };
  const [oh, om] = S.open.split(':').map(Number);
  const [ch, cm] = S.close.split(':').map(Number);
  const step = S.slotMinutes || 30;
  const capacity = S.capacity || 1;
  const booked = counts[date] || {};
  const slots = [];
  for (let m = oh * 60 + om; m < ch * 60 + cm; m += step) {
    const time = String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
    slots.push({ time, free: (booked[time] || 0) < capacity });
  }
  return { closed: false, slots };
}

export function addBooking(db, body, isAdminBooking) {
  if (cleanString(body.website, 200)) fail(400, 'Could not submit the booking.'); // honeypot
  const name = cleanString(body.name, 100);
  const phone = cleanPhone(body.phone);
  const email = cleanString(body.email, 120);
  const date = cleanString(body.date, 10);
  const time = cleanString(body.time, 5);
  const note = cleanString(body.note, 300);
  const ids = Array.isArray(body.services) ? body.services.map((x) => cleanString(x, 100)).filter(Boolean) : [];
  if (!name) fail(400, 'Name is required.');
  if (!phone) fail(400, 'Phone number is required.');
  if (!validDate(date)) fail(400, 'Invalid date.');
  if (!validTime(time)) fail(400, 'Invalid time.');
  if (!ids.length) fail(400, 'Choose at least one service.');
  db.bookings = db.bookings || [];
  if (db.bookings.some((x) => x.phone === phone && x.date === date && x.time === time && x.status !== 'cancelled'))
    fail(409, 'A booking already exists for this phone number at that time.');
  // The slot picker hides full times, but a direct request must not be able to overbook one.
  if (!isAdminBooking) {
    const cap = (db.settings && db.settings.capacity) || 1;
    const taken = db.bookings.filter((x) => x.date === date && x.time === time && x.status !== 'cancelled').length;
    if (taken >= cap) fail(409, 'That time was just taken. Please pick another slot.');
  }
  const all = (db.menu || []).flatMap((c) => c.items || []);
  const services = ids.map((id) => all.find((i) => String(i.id) === id)).filter(Boolean).map((i) => ({ id: i.id, name: i.name, price: i.price }));
  if (!services.length) fail(400, 'Selected services were not found.');
  const id = crypto.randomUUID();
  const rec = {
    id, ref: id.replace(/-/g, '').slice(0, 8).toUpperCase(), name, phone, email, date, time, note, services,
    price: services.reduce((s, x) => s + (Number(x.price) || 0), 0),
    status: isAdminBooking ? 'confirmed' : 'pending', createdAt: new Date().toISOString(),
  };
  db.bookings.push(rec);
  return rec;
}

// ---- self check-in: the client scans a QR, fills their own phone/name and picks services
// themselves -- so staff never has to ask for those face-to-face. Deliberately a review queue, not an
// automatic bill (acceptCheckin/declineCheckin, router.js): a self-submitted request could have a typo
// or a wrong service tapped, so staff glance at it and turn it into a bill with one tap, same pattern as
// "Create bill from booking" already uses for a scheduled appointment.
export function submitCheckin(db, body) {
  if (cleanString(body.website, 200)) fail(400, 'Could not submit.'); // honeypot, same as addBooking
  const name = cleanString(body.name, 100);
  const phone = cleanPhone(body.phone);
  const email = cleanString(body.email, 120);
  const note = cleanString(body.note, 300);
  const ids = Array.isArray(body.services) ? body.services.map((x) => cleanString(x, 100)).filter(Boolean) : [];
  if (!name) fail(400, 'Name is required.');
  if (!phone) fail(400, 'Phone number is required.');
  if (!ids.length) fail(400, 'Choose at least one service.');
  const all = (db.menu || []).flatMap((c) => c.items || []);
  const services = ids.map((id) => all.find((i) => String(i.id) === id)).filter(Boolean).map((i) => ({ id: i.id, name: i.name, price: i.price }));
  if (!services.length) fail(400, 'Selected services were not found.');
  // Same-phone, today-or-later, still-open booking -- so staff see this as "wants to add services to
  // their existing appointment," not a second, unrelated walk-in. Matched by phone only (a booking has
  // no login to check against), same trust level as addBooking's own phone-based duplicate check.
  const today = todayStr();
  const match = (db.bookings || []).find((b) => b.phone === phone && b.date >= today && !['cancelled', 'completed'].includes(b.status));
  const id = crypto.randomUUID();
  const rec = {
    id, name, phone, email, note, services, bookingId: match ? match.id : null,
    status: 'new', createdAt: new Date().toISOString(),
  };
  db.checkins = db.checkins || [];
  db.checkins.push(rec);
  return rec;
}
export function setCheckinStatus(db, id, status) {
  if (!['accepted', 'declined'].includes(status)) fail(400, 'Invalid status.');
  const c = (db.checkins || []).find((x) => x.id === id);
  if (!c) fail(404, 'Check-in not found.');
  if (c.status !== 'new') fail(400, 'This check-in was already handled.');
  c.status = status;
  return c;
}

export function clientsList(db) {
  const map = new Map();
  const get = (phone, name, email) => {
    if (!phone) return null;
    if (!map.has(phone)) map.set(phone, { phone, name, email: email || '', bookings: 0, visits: 0, billed: 0, last: '', dob: '', anniversary: '', notes: '' });
    const c = map.get(phone);
    if (name) c.name = name;
    if (email && !c.email) c.email = email;
    return c;
  };
  (db.bookings || []).forEach((b) => { const c = get(b.phone, b.name, b.email); if (c) { c.bookings++; c.last = c.last > b.date ? c.last : b.date; } });
  (db.invoices || []).filter((i) => !i.void).forEach((i) => {
    const c = get(i.client.phone, i.client.name, i.client.email);
    if (c) { c.visits++; c.billed = round2(c.billed + i.total); c.last = c.last > i.date ? c.last : i.date; }
  });
  // Stored profiles (dob/anniversary/notes, db/196) merge onto whatever clientsList already derived from
  // bookings/invoices -- and a profile with no booking/invoice yet (added ahead of a client's first visit)
  // still shows up, since get() creates the row if it's missing.
  (db.clients || []).forEach((p) => {
    const c = get(p.phone, p.name, p.email);
    if (c) { c.dob = p.dob || ''; c.anniversary = p.anniversary || ''; c.notes = p.notes || ''; }
  });
  return [...map.values()].sort((a, b) => (b.last || '').localeCompare(a.last || ''));
}

export function addInvoice(db, body, who) {
  const client = body.client || {};
  const name = cleanString(client.name, 80);
  if (name.length < 2) fail(400, 'Enter the client name.');
  const phone = client.phone ? cleanPhone(client.phone) : '';
  if (client.phone && !phone) fail(400, 'Enter a valid phone number.');
  const items = (Array.isArray(body.items) ? body.items : []).slice(0, 40).map((i) => ({
    name: cleanString(i.name, 120),
    qty: Math.max(1, Math.min(99, Math.round(Number(i.qty) || 1))),
    price: round2(Number(i.price) || 0),
  })).filter((i) => i.name);
  if (!items.length) fail(400, 'Add at least one service.');
  const subtotal = round2(items.reduce((s, i) => s + i.qty * i.price, 0));
  const dType = body.discount && body.discount.type === 'percent' ? 'percent' : 'flat';
  const dVal = Math.max(0, Math.min(dType === 'percent' ? 100 : 1e6, Number(body.discount && body.discount.value) || 0));
  const dAmt = Math.min(subtotal, dType === 'percent' ? round2(subtotal * dVal / 100) : round2(dVal));
  db.invoices = db.invoices || [];
  db.counters = db.counters || { booking: 0, invoice: 0 };
  let token;
  do { token = crypto.randomBytes(4).toString('hex'); } while (db.invoices.some((x) => x.token === token));
  const prefix = cleanString(db.settings.invoicePrefix, 6) || 'SS-';
  const inv = {
    id: crypto.randomUUID(), token, no: prefix + String(++db.counters.invoice).padStart(4, '0'),
    date: validDate(body.date) ? cleanString(body.date, 10) : todayStr(),
    client: { name, phone, email: cleanString(client.email, 120) },
    items, subtotal, discount: { type: dType, value: dVal }, discountAmt: dAmt, total: round2(subtotal - dAmt),
    servedBy: cleanString(body.servedBy, 80) || (who && who.role === 'staff' ? who.name || '' : ''),
    createdBy: who && who.role === 'staff' ? { id: who.sid, name: who.name } : { id: 'owner', name: 'Owner' },
    note: cleanString(body.note, 300), bookingId: cleanString(body.bookingId, 40),
    paymentMode: PAYMENT_MODES.includes(body.paymentMode) ? body.paymentMode : 'cash',
    // Only a credit bill is ever actually "due" -- every other mode is paid at the counter the moment
    // it's billed, so it's settled from the start. settleInvoice() below is the only way to flip this.
    settled: (PAYMENT_MODES.includes(body.paymentMode) ? body.paymentMode : 'cash') !== 'credit', settledAt: null,
    void: false, createdAt: new Date().toISOString(),
  };
  db.invoices.push(inv);
  const lb = (db.bookings || []).find((b) => b.id === inv.bookingId);
  if (lb) lb.status = 'completed';
  return inv;
}

// A credit (pay-later) bill the client has now actually paid. Any other mode is already settled at
// billing time, so this is only ever meaningful for paymentMode:'credit' -- but it's harmless to call
// on anything else too (just marks it settled, which it already was).
export function settleInvoice(db, id) {
  const inv = (db.invoices || []).find((x) => x.id === id);
  if (!inv) fail(404, 'Invoice not found.');
  if (inv.void) fail(400, 'This invoice is void.');
  inv.settled = true;
  inv.settledAt = new Date().toISOString();
  return inv;
}

export function addExpense(db, body) {
  const amount = round2(Number(body.amount) || 0);
  if (amount <= 0) fail(400, 'Enter an amount greater than zero.');
  db.expenses = db.expenses || [];
  const exp = {
    id: crypto.randomUUID(), date: validDate(body.date) ? cleanString(body.date, 10) : todayStr(),
    category: EXPENSE_CATEGORIES.includes(body.category) ? body.category : 'other',
    note: cleanString(body.note, 200), amount, createdAt: new Date().toISOString(),
    paymentMode: body.paymentMode === 'bank' ? 'bank' : 'cash', // only cash expenses count against the drawer (cashSummary below)
  };
  db.expenses.push(exp);
  return exp;
}

// ---- cash register: opening float, mid-day in/out, end-of-day close, and payment-mode settlement ----
// A business day is identified by its own date string (`date`), not a timestamp -- the console always
// deals in dates the same way bookings/invoices/expenses already do (todayStr(), validDate()).
export function addCashMove(db, body, who) {
  if (!CASH_MOVE_TYPES.includes(body.type)) fail(400, 'Invalid cash entry type.');
  const amount = round2(Number(body.amount) || 0);
  if (amount < 0) fail(400, 'Amount cannot be negative.');
  if ((body.type === 'in' || body.type === 'out') && amount <= 0) fail(400, 'Enter an amount greater than zero.');
  const date = validDate(body.date) ? cleanString(body.date, 10) : todayStr();
  db.cashlog = db.cashlog || [];
  if ((body.type === 'open' || body.type === 'close') && db.cashlog.some((x) => x.type === body.type && x.date === date))
    fail(409, body.type === 'open' ? 'The cash register was already opened today.' : 'The cash register was already closed today.');
  const entry = {
    id: crypto.randomUUID(), type: body.type, date, amount, note: cleanString(body.note, 200),
    by: who && who.role === 'staff' ? { id: who.sid, name: who.name } : { id: 'owner', name: 'Owner' },
    createdAt: new Date().toISOString(),
  };
  db.cashlog.push(entry);
  return entry;
}

// One day's register + payment-mode settlement. Pure read, no mutation -- callers pass the already-loaded db.
export function cashSummary(db, date) {
  if (!validDate(date)) fail(400, 'Invalid date.');
  const log = (db.cashlog || []).filter((x) => x.date === date);
  const opening = round2(log.filter((x) => x.type === 'open').reduce((s, x) => s + x.amount, 0));
  const cashIn = round2(log.filter((x) => x.type === 'in').reduce((s, x) => s + x.amount, 0));
  const cashOut = round2(log.filter((x) => x.type === 'out').reduce((s, x) => s + x.amount, 0));
  const closeEntry = log.find((x) => x.type === 'close') || null;
  const invoices = (db.invoices || []).filter((i) => i.date === date && !i.void);
  const byMode = { cash: 0, upi: 0, card: 0, credit: 0 };
  for (const i of invoices) { const m = PAYMENT_MODES.includes(i.paymentMode) ? i.paymentMode : 'cash'; byMode[m] = round2(byMode[m] + i.total); }
  const totalSales = round2(invoices.reduce((s, i) => s + i.total, 0));
  const expenses = (db.expenses || []).filter((e) => e.date === date);
  const cashExpenses = round2(expenses.filter((e) => (e.paymentMode || 'cash') === 'cash').reduce((s, e) => s + e.amount, 0));
  const totalExpenses = round2(expenses.reduce((s, e) => s + e.amount, 0));
  const expectedCash = round2(opening + cashIn - cashOut + byMode.cash - cashExpenses);
  const closed = !!closeEntry;
  const actualCash = closed ? closeEntry.amount : null;
  return {
    date, opened: log.some((x) => x.type === 'open'), opening, cashIn, cashOut, closed, actualCash, expectedCash,
    variance: closed ? round2(actualCash - expectedCash) : null,
    byMode, totalSales, cashExpenses, totalExpenses, entries: log.sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
  };
}

// Several days at once (for a settlement range view). Capped to a year so a bad `from` can't loop forever.
export function cashRangeSummary(db, from, to) {
  if (!validDate(from) || !validDate(to) || from > to) fail(400, 'Invalid date range.');
  const days = [];
  for (let d = from; d <= to && days.length < 366; ) {
    days.push(cashSummary(db, d));
    const nd = new Date(d + 'T00:00:00Z'); nd.setUTCDate(nd.getUTCDate() + 1);
    d = nd.toISOString().slice(0, 10);
  }
  const byMode = { cash: 0, upi: 0, card: 0, credit: 0 };
  let totalSales = 0, totalExpenses = 0, variance = 0;
  for (const d of days) {
    for (const k of Object.keys(byMode)) byMode[k] = round2(byMode[k] + d.byMode[k]);
    totalSales = round2(totalSales + d.totalSales);
    totalExpenses = round2(totalExpenses + d.totalExpenses);
    if (d.variance != null) variance = round2(variance + d.variance);
  }
  return { from, to, byMode, totalSales, totalExpenses, variance, days };
}

// ---- client profiles (db/196): a persistent record per phone number, for data a booking/invoice
// never carries -- date of birth, anniversary, free-text notes. Additive only: clientsList() above
// still derives the base client list from bookings/invoices exactly as before, this just merges onto
// it (and lets an owner add a client manually, ahead of their first visit, as a profile-only row).
export function saveClientProfile(db, body) {
  const phone = cleanPhone(body.phone);
  if (!phone) fail(400, 'Enter a valid phone number.');
  db.clients = db.clients || [];
  let c = db.clients.find((x) => x.phone === phone);
  if (!c) { c = { phone, name: '', email: '', dob: '', anniversary: '', notes: '', createdAt: new Date().toISOString() }; db.clients.push(c); }
  if (body.name !== undefined) c.name = cleanString(body.name, 80);
  if (body.email !== undefined) c.email = cleanString(body.email, 120);
  if (body.dob !== undefined) { if (body.dob && !validDate(body.dob)) fail(400, 'Invalid date of birth.'); c.dob = body.dob || ''; }
  if (body.anniversary !== undefined) { if (body.anniversary && !validDate(body.anniversary)) fail(400, 'Invalid anniversary date.'); c.anniversary = body.anniversary || ''; }
  if (body.notes !== undefined) c.notes = cleanString(body.notes, 500);
  c.updatedAt = new Date().toISOString();
  return c;
}

// ---- packages / memberships (db/196): a flat, no-redemption-tracking model on purpose -- a package
// definition (name, price, how many days it's valid for) and a sale of one to a client (purchase date,
// computed expiry). There is deliberately no credit/visit-consumption link into billing yet: this only
// tracks that a package was sold and when it expires, so the expiry-reminder automation has something
// real to read. Connecting a package's remaining credits to what a bill actually consumes is a real,
// separate piece of scope -- flagged, not built here.
export function savePackageDef(db, body) {
  db.packages = db.packages || [];
  const name = cleanString(body.name, 80);
  if (!name) fail(400, 'Enter a package name.');
  const price = round2(Number(body.price) || 0);
  const validityDays = Math.max(1, Math.min(3650, Math.round(Number(body.validityDays) || 0) || 1));
  if (body.id) {
    const pkg = db.packages.find((x) => x.id === body.id);
    if (!pkg) fail(404, 'Package not found.');
    pkg.name = name; pkg.price = price; pkg.validityDays = validityDays; pkg.active = body.active !== false;
    return pkg;
  }
  const pkg = { id: crypto.randomUUID(), name, price, validityDays, active: true, createdAt: new Date().toISOString() };
  db.packages.push(pkg);
  return pkg;
}
export function deletePackageDef(db, id) {
  const before = db.packages || [];
  db.packages = before.filter((x) => x.id !== id);
  if (db.packages.length === before.length) fail(404, 'Package not found.');
}
export function sellPackage(db, body) {
  const phone = cleanPhone(body.phone);
  if (!phone) fail(400, 'Enter a valid client phone number.');
  const clientName = cleanString(body.clientName, 80);
  if (!clientName) fail(400, 'Enter the client name.');
  const pkg = (db.packages || []).find((x) => x.id === body.packageId);
  if (!pkg) fail(400, 'Choose a package.');
  db.clientPackages = db.clientPackages || [];
  const purchaseDate = validDate(body.date) ? cleanString(body.date, 10) : todayStr();
  const expiry = new Date(purchaseDate + 'T00:00:00Z'); expiry.setUTCDate(expiry.getUTCDate() + pkg.validityDays);
  const rec = {
    id: crypto.randomUUID(), phone, clientName, packageId: pkg.id, packageName: pkg.name, price: pkg.price,
    purchaseDate, expiryDate: expiry.toISOString().slice(0, 10), note: cleanString(body.note, 200), createdAt: new Date().toISOString(),
  };
  db.clientPackages.push(rec);
  return rec;
}
