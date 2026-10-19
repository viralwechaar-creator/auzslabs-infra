// Salon WhatsApp automations that need to look at a whole day's activity, not just react to one
// request: the owner's daily summary (db/194), lapsed-client win-back, the post-visit review request,
// and payment-due reminders for unsettled credit bills (db/195). All run once a day from
// maintenance.js, same "boot-relative, not wall-clock-pinned" honesty this codebase already uses for
// renewals/booking reminders -- there is no real cron here. Every send still goes through
// enqueueWa()/wa_enqueue(), which already checks the shop's master WhatsApp switch, this specific
// template's own on/off event, and wa_optouts -- nothing here duplicates those checks.
import { pool } from '../db.js';
import { enqueueWa } from '../whatsapp.js';
import { DOMAIN, todayStr } from './util.js';
import { loadDb } from './storage.js';

function dateOffset(days) {
  const d = new Date(todayStr() + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const yesterday = () => dateOffset(-1);

// Same "first invoice/booking date for this phone" rule admin.js's own firstSeenMap() uses client-side,
// reimplemented here since this runs server-side with no browser involved.
function newClientsOn(db, date) {
  const firstSeen = new Map();
  for (const inv of db.invoices || []) {
    if (inv.void || !inv.client || !inv.client.phone) continue;
    const p = inv.client.phone;
    if (!firstSeen.has(p) || inv.date < firstSeen.get(p)) firstSeen.set(p, inv.date);
  }
  let n = 0;
  for (const d of firstSeen.values()) if (d === date) n++;
  return n;
}

// Every salon with WhatsApp turned on, and this one message type not individually switched off.
// Shared by every job below so the "niche=salon, enabled, this template's own event flag" query and
// the per-tenant load/skip-demo/try-catch shape is written once, not four times.
async function forEachEnabledSalon(templateKey, fn) {
  let tenants;
  try {
    const { rows } = await pool.query(
      `select t.slug from tenants t join wa_tenant_settings w on w.tenant_id = t.id
       where t.niche = 'salon' and w.enabled = true and coalesce(w.events->>$1, 'true') <> 'false'`,
      [templateKey],
    );
    tenants = rows;
  } catch (err) { console.warn(`salon automations: tenant lookup for ${templateKey} failed:`, err.message); return 0; }

  let sent = 0;
  for (const { slug } of tenants) {
    try {
      const { rows: [tenant] } = await pool.query('select * from salon_tenant($1)', [slug]);
      if (!tenant || tenant.is_demo) continue; // never message the public demo salon
      const db = await loadDb(tenant);
      sent += (await fn(tenant, db)) || 0;
    } catch (err) { console.warn(`salon automations: ${templateKey} for ${slug} failed:`, err.message); }
  }
  return sent;
}

export async function runSalonDailySummaries() {
  const date = yesterday();
  const sent = await forEachEnabledSalon('owner_daily_summary', async (tenant, db) => {
    const phone = db.settings && db.settings.phone;
    if (!phone) return 0; // no business phone on file -- nothing to send to
    const bookings = (db.bookings || []).filter((b) => b.date === date).length;
    const revenue = (db.invoices || []).filter((i) => i.date === date && !i.void).reduce((s, i) => s + i.total, 0);
    const newClients = newClientsOn(db, date);
    if (!bookings && !revenue && !newClients) return 0; // nothing happened -- don't nag the owner with an all-zero message
    const label = new Date(date + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    await enqueueWa(tenant.id, phone, 'owner_daily_summary',
      [db.settings.salonName || tenant.name || 'your salon', label, String(bookings), revenue.toFixed(2), String(newClients)],
      'daily-' + date);
    return 1;
  });
  if (sent) console.log(`salon daily summary: queued ${sent}`);
}

// A client is "lapsed" the moment their last visit (booking or bill) turns exactly 30 days old today --
// a fixed, undiscussed threshold for v1. Firing only on the exact day it crosses 30 (not "30 or more
// every day") keeps this a one-time nudge per lapse, not a daily nag: wa_enqueue's own idempotency on
// (tenant, template, ref) would only have blocked a literal repeat of the same ref anyway, but checking
// the exact day here means we only ever try to queue it once, not once a day forever.
export async function runLapsedClientWinback() {
  const threshold = dateOffset(-30);
  const sent = await forEachEnabledSalon('lapsed_client', async (tenant, db) => {
    const lastSeen = new Map(); // phone -> {name, last}
    for (const b of db.bookings || []) {
      if (!b.phone) continue;
      const cur = lastSeen.get(b.phone);
      if (!cur || b.date > cur.last) lastSeen.set(b.phone, { name: b.name, last: b.date });
    }
    for (const i of db.invoices || []) {
      if (i.void || !i.client || !i.client.phone) continue;
      const cur = lastSeen.get(i.client.phone);
      if (!cur || i.date > cur.last) lastSeen.set(i.client.phone, { name: i.client.name, last: i.date });
    }
    let n = 0;
    for (const [phone, c] of lastSeen) {
      if (c.last !== threshold) continue;
      await enqueueWa(tenant.id, phone, 'lapsed_client',
        [c.name || 'there', db.settings.salonName || tenant.name || 'us'], phone + '-lapsed-' + c.last);
      n++;
    }
    return n;
  });
  if (sent) console.log(`salon lapsed-client win-back: queued ${sent}`);
}

// One WhatsApp per non-void bill from yesterday, asking for a review. A real "a couple of hours after
// the visit" send would need a delayed queue this codebase doesn't have yet (see db/184's own worker,
// which only ever sends what's already queued) -- "the day after" is the honest simplification here,
// same boot-relative-timer honesty as everything else in this file.
export async function runPostVisitReviews() {
  const date = yesterday();
  const sent = await forEachEnabledSalon('review_request', async (tenant, db) => {
    const link = (db.settings && db.settings.reviewLink) || (DOMAIN ? `https://${tenant.slug}.${DOMAIN}/` : '');
    let n = 0;
    for (const i of db.invoices || []) {
      if (i.void || i.date !== date || !i.client || !i.client.phone) continue;
      await enqueueWa(tenant.id, i.client.phone, 'review_request',
        [i.client.name || 'there', db.settings.salonName || tenant.name || 'us', link], i.id + '-review');
      n++;
    }
    return n;
  });
  if (sent) console.log(`salon post-visit reviews: queued ${sent}`);
}

// A credit (pay-later) bill that's still unsettled gets one reminder 3 days after billing and one more
// at 7 days -- then nothing further (an owner who wants to keep chasing after that already has the
// "Mark as paid"/Void actions and the Due badge in Billing history). Each stage has its own ref so it
// never collides with or skips the other.
export async function runPaymentDueReminders() {
  const d3 = dateOffset(-3), d7 = dateOffset(-7);
  const sent = await forEachEnabledSalon('payment_due', async (tenant, db) => {
    let n = 0;
    for (const i of db.invoices || []) {
      if (i.void || i.paymentMode !== 'credit' || i.settled || !i.client || !i.client.phone) continue;
      if (i.date !== d3 && i.date !== d7) continue;
      const stage = i.date === d3 ? '3' : '7';
      await enqueueWa(tenant.id, i.client.phone, 'payment_due',
        [i.client.name || 'there', db.settings.salonName || tenant.name || 'us', i.total.toFixed(2)], i.id + '-due' + stage);
      n++;
    }
    return n;
  });
  if (sent) console.log(`salon payment-due reminders: queued ${sent}`);
}
