// A salon owner's own end-of-day WhatsApp summary (db/194): bookings, billed, new clients.
// Runs once a day from maintenance.js, same "boot-relative, not wall-clock-pinned" honesty this
// codebase already uses for renewals/booking reminders -- there is no real cron here.
import { pool } from '../db.js';
import { enqueueWa } from '../whatsapp.js';
import { todayStr } from './util.js';
import { loadDb } from './storage.js';

function yesterday() {
  const d = new Date(todayStr() + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

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

export async function runSalonDailySummaries() {
  const date = yesterday();
  let tenants;
  try {
    // owner_daily_summary (db/194) is a 'shop'-audience template like every customer-facing one, so it
    // follows the exact same opt-in/opt-out rule: the shop's own wa_tenant_settings.enabled switch, and
    // events->>'owner_daily_summary'='false' turns off just this one message without touching the rest.
    const { rows } = await pool.query(
      `select t.slug from tenants t join wa_tenant_settings w on w.tenant_id = t.id
       where t.niche = 'salon' and w.enabled = true
         and coalesce(w.events->>'owner_daily_summary', 'true') <> 'false'`,
    );
    tenants = rows;
  } catch (err) { console.warn('salon daily summary: tenant lookup failed:', err.message); return; }

  let sent = 0;
  for (const { slug } of tenants) {
    try {
      const { rows: [tenant] } = await pool.query('select * from salon_tenant($1)', [slug]);
      if (!tenant || tenant.is_demo) continue; // never message the public demo salon
      const db = await loadDb(tenant);
      const phone = db.settings && db.settings.phone;
      if (!phone) continue; // no business phone on file -- nothing to send to
      const bookings = (db.bookings || []).filter((b) => b.date === date).length;
      const revenue = (db.invoices || []).filter((i) => i.date === date && !i.void).reduce((s, i) => s + i.total, 0);
      const newClients = newClientsOn(db, date);
      if (!bookings && !revenue && !newClients) continue; // nothing happened -- don't nag the owner with an all-zero message
      const label = new Date(date + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      await enqueueWa(tenant.id, phone, 'owner_daily_summary',
        [db.settings.salonName || tenant.name || 'your salon', label, String(bookings), revenue.toFixed(2), String(newClients)],
        'daily-' + date);
      sent++;
    } catch (err) { console.warn(`salon daily summary: ${slug} failed:`, err.message); }
  }
  if (sent) console.log(`salon daily summary: queued ${sent}`);
}
