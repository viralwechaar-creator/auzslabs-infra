// Daily housekeeping so small tables never grow without limit. Runs once a minute after boot, then every 24 hours.
// Only deletes rows that can no longer matter: a session token lasts 7 days (30 is generous), one-time codes and
// links are useless once expired. Failures are logged and never stop the server.
import { pool } from './db.js';

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

export function startMaintenance() {
  if (process.env.DISABLE_MAINTENANCE === '1') return;
  setTimeout(() => { runMaintenance(); setInterval(runMaintenance, DAY).unref(); }, 60_000).unref();
}
