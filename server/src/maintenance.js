// Daily housekeeping so small tables never grow without limit. Runs once a minute after boot, then every 24 hours.
// Only deletes rows that can no longer matter: a session token lasts 7 days (30 is generous), one-time codes and
// links are useless once expired. Failures are logged and never stop the server.
import { pool } from './db.js';
import { sendRenewalEmail } from './mail.js';
import { runClientGreetings, runLapsedClientWinback, runMembershipExpiryReminders, runPaymentDueReminders, runPostVisitReviews, runSalonDailySummaries } from './salon/automations.js';
import { metricsReport } from './metrics.js';

const DAY = 24 * 60 * 60 * 1000;

export async function runMaintenance() {
  const jobs = [
    ['old sessions', `delete from auth_sessions where created_at < now() - interval '30 days'`],
    ['old phone codes', `delete from phone_otps where created_at < now() - interval '2 days'`],
    ['old password-reset links', `delete from password_resets where expires_at < now() - interval '7 days'`],
    ['old email-confirmation links', `delete from email_verifications where expires_at < now() - interval '7 days'`],
  ];
  for (const [name, sql] of jobs) {
    try {
      const r = await pool.query(sql);
      if (r.rowCount) console.log(`maintenance: removed ${r.rowCount} ${name}`);
    } catch (err) {
      console.warn(`maintenance: ${name} failed:`, err.message);
    }
  }
}

// Renewal reminders (db/098): creates the in-app notifications, then emails each owner for the stages that are new today.
export async function runRenewals() {
  try {
    const { rows } = await pool.query('select renewal_notify_run() as r');
    for (const n of rows[0]?.r || []) {
      console.log(`renewal: ${n.tenant} stage ${n.stage}`);
      for (const to of n.emails || []) await sendRenewalEmail({ to, business: n.tenant, days: n.days, renewalDate: n.renewal_date }).catch(() => {});
    }
  } catch (err) { console.warn('renewal run failed:', err.message); }
}

// WhatsApp booking reminders (db/191): a shop's own customers, one day before a confirmed booking.
export async function runBookingReminders() {
  try {
    const { rows } = await pool.query('select booking_reminder_run() as r');
    const sent = rows[0]?.r?.sent || 0;
    if (sent) console.log(`booking reminders: queued ${sent}`);
  } catch (err) { console.warn('booking reminder run failed:', err.message); }
}

// Unpaid-quote reminders to the client (and a note to the admin) after 2 and 5 days, db/205.
export async function runQuoteFollowups() {
  try {
    const { rows } = await pool.query('select quote_followup_run() as r');
    const n = rows[0]?.r?.followed_up || 0;
    if (n) console.log(`quote follow-ups: ${n}`);
  } catch (err) { console.warn('quote follow-up run failed:', err.message); }
}

// One summary for the AUZslab owner each day: a push notification, and WhatsApp when platform_flags.admin_phone is set.
export async function runAdminSummary() {
  try { await pool.query('select admin_daily_summary_run()'); }
  catch (err) { console.warn('admin summary failed:', err.message); }
}

// AUZsStyle: birthday / anniversary greetings and win-back (db/226). Quiet unless the shop turned WhatsApp on.
export async function runStyleGreetings() {
  try { await pool.query('select sty_wa_daily_run()'); }
  catch (err) { console.warn('style greetings failed:', err.message); }
}

// AUZsStyle store: abandoned-bag reminders (db/232). Only for shops that switched them on.
export async function runStyleAbandoned() {
  try { await pool.query('select sty_abandoned_run()'); }
  catch (err) { console.warn('style abandoned bags failed:', err.message); }
}

// Daily server health check (db/243): tells the admin when the database or the API needs attention.
export async function runHealthAlert() {
  try {
    const m = await metricsReport();
    const tot = m.families.reduce((a, f) => a + f.count, 0), err = m.families.reduce((a, f) => a + f.errors, 0);
    const p95 = Math.max(0, ...m.families.filter((f) => f.count >= 20).map((f) => f.p95_ms));
    await pool.query('select health_alert_run($1::jsonb)', [JSON.stringify({ lag_ms: m.process.loop_lag_p99_ms, rss_mb: Math.round(m.process.rss / 1048576), error_pct: tot >= 50 ? +(100 * err / tot).toFixed(1) : 0, p95_ms: p95 })]);
  } catch (err) { console.warn('health alert failed:', err.message); }
}

// Self-serve trials (db/262): lock every 3-day trial that has run out. Runs every 5 minutes.
export async function runTrialLock() {
  try { const { rows } = await pool.query('select trial_lock_run() as n'); if (rows[0]?.n) console.log(`trials locked: ${rows[0].n}`); }
  catch (err) { console.warn('trial lock failed:', err.message); }
}

export function startMaintenance() {
  if (process.env.DISABLE_MAINTENANCE === '1') return;
  const runAll = () => {
    runMaintenance(); runRenewals(); runBookingReminders(); runQuoteFollowups(); runAdminSummary();
    runSalonDailySummaries(); runLapsedClientWinback(); runPostVisitReviews(); runPaymentDueReminders();
    runClientGreetings(); runMembershipExpiryReminders(); runStyleGreetings(); runStyleAbandoned(); runHealthAlert();
  };
  setTimeout(() => { runAll(); setInterval(runAll, DAY).unref(); }, 60_000).unref();
  setTimeout(() => { runTrialLock(); setInterval(runTrialLock, 5 * 60_000).unref(); }, 30_000).unref();
}
