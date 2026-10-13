import bcrypt from 'bcryptjs';
import { pool } from '../db.js';
import { signToken } from './sessions.js';

// ---------- staff sign-in with a username + PIN (db/096) ----------
// The username already names the company (name.companycode), so nothing else is asked. A PIN is short, so the real
// protection is the lockout: 5 wrong PINs for one username locks it for 15 minutes (kept in the database so it
// survives restarts and cannot be dodged by changing network), on top of the per-address limit in index.js.
// An unknown username does the same amount of work and gives the same answer as a wrong PIN.
const PIN_DUMMY_HASH = bcrypt.hashSync('0000', 10);
const PIN_MAX_FAILS = 5, PIN_LOCK_MS = 15 * 60_000;
export async function staffLogin(username, pin, meta) {
  const u = String(username || '').trim().toLowerCase();
  const p = String(pin || '').trim();
  if (!/^[a-z0-9]{1,30}\.[a-z0-9-]{1,60}$/.test(u) || !/^\d{4,6}$/.test(p)) { await bcrypt.compare(p || '0', PIN_DUMMY_HASH); return null; }
  const f = await pool.query('select fails, locked_until from staff_pin_fails where username = $1', [u]);
  if (f.rows[0] && f.rows[0].locked_until && new Date(f.rows[0].locked_until) > new Date()) return { locked: true };
  const { rows } = await pool.query(
    `select id, email, pin_hash, app_metadata, user_metadata from auth_users
     where lower(username) = $1 and deleted_at is null and disabled_at is null`, [u]);
  const row = rows[0];
  const ok = row && row.pin_hash ? await bcrypt.compare(p, row.pin_hash) : (await bcrypt.compare(p, PIN_DUMMY_HASH), false);
  if (!ok) {
    if (row) {
      await pool.query(
        `insert into staff_pin_fails (username, fails, updated_at) values ($1, 1, now())
         on conflict (username) do update set fails = case when staff_pin_fails.fails + 1 >= $2 then 0 else staff_pin_fails.fails + 1 end,
           locked_until = case when staff_pin_fails.fails + 1 >= $2 then now() + ($3 || ' milliseconds')::interval else null end, updated_at = now()`,
        [u, PIN_MAX_FAILS, String(PIN_LOCK_MS)]);
    }
    return null;
  }
  if (f.rows[0]) await pool.query('delete from staff_pin_fails where username = $1', [u]);
  const user = { id: row.id, email: row.email, app_metadata: row.app_metadata, user_metadata: row.user_metadata };
  return { access_token: await signToken(user, meta), user };
}
