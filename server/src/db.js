import pg from 'pg';

const { Pool } = pg;

// A DATE column (bookings.date) stays the plain 'YYYY-MM-DD' it is in the database. node-pg would turn it into a
// JS Date at the API process's local midnight, which serialises as a timestamp and can land on the previous day.
pg.types.setTypeParser(1082, (v) => v);

// Connects as the "app" role (see db/000b_create_app_role.sh) --
// NEVER as POSTGRES_USER. The Docker postgres image always makes
// POSTGRES_USER a superuser, and a superuser silently bypasses every
// RLS policy in this schema regardless of what it says -- confirmed by
// hand against a real Postgres 16 while building this.
export const pool = new Pool({
  host: process.env.PGHOST || 'postgres',
  port: Number(process.env.PGPORT || 5432),
  user: 'app',
  password: process.env.POSTGRES_APP_PASSWORD,
  database: process.env.POSTGRES_DB,
});

// Runs `fn` inside a transaction with app.uid set as a *transaction-local*
// session variable (the `true` third arg to set_config) -- it's cleared
// automatically when the transaction ends, so it can never leak across
// requests on a pooled connection the way a session-scoped set_config
// (or forgetting to reset it) would.
export async function withAuth(uid, fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('select set_config($1, $2, true)', ['app.uid', uid || '']);
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Anonymous calls (public_menu, place_order, public_invoice) never set
// app.uid at all -- same withAuth(null, fn) path, app_uid() just
// resolves to null inside Postgres, exactly like a logged-out request.
export const withoutAuth = (fn) => withAuth(null, fn);
