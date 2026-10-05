// Daily housekeeping so small tables never grow without limit. Runs once a minute after boot, then every 24 hours.
// Only deletes rows that can no longer matter: a session token lasts 7 days (30 is generous), one-time codes and
// links are useless once expired. Failures are logged and never stop the server.
import { pool } from './db.js';
import { sendRenewalEmail } from './mail.js';

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

export function startMaintenance() {
  if (process.env.DISABLE_MAINTENANCE === '1') return;
  setTimeout(() => { runMaintenance(); runRenewals(); setInterval(() => { runMaintenance(); runRenewals(); }, DAY).unref(); }, 60_000).unref();
}
