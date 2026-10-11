// One-time script: copies Showoff Salon's REAL, CURRENTLY LIVE menu/settings/content/stylists/gallery
// (whatever is actually in salon_store right now, including any real edits made through the real admin
// console since onboarding -- never the original seed file in salon-seed.js, which may be stale) into
// the new generic engine (records/bookings, RLS-protected), then flips the tenant's own engine switch.
//
// Run this ONCE, on the real server, after confirming (per the owner) there is no real booking/invoice/
// expense data to lose -- it still copies that data too if any exists, using the same proven logic the
// rest of the migration already uses, but the whole point of running it now rather than waiting is that
// it's currently empty.
//
// Usage (from the server, inside the API container or with the right DATABASE_URL env set):
//   node db_data/migrate_showoffsalon_to_generic_engine.mjs
//
// Safe to re-run: it reads the live salon_store data fresh each time and writes it into the generic
// engine as an upsert (same id/kind rows get updated, not duplicated); it does not delete anything from
// salon_store, so the old data is still there as a fallback if something looks wrong after switching.

import { pool } from '../server/src/db.js';
import { authorize, persistDb, withSalonAuth } from '../server/src/salon-engine.js';

const SLUG = 'showoffsalon';

async function main() {
  // Plain pool.query runs as the unprivileged 'app' role with no app.uid set yet, and tenants has RLS
  // enabled (admin_all/owner_read_own/t_salesman_read) -- a bare select here silently finds nothing even
  // for a real tenant. salon_tenant() is the same SECURITY DEFINER lookup salon.js's tenantFor() already
  // uses for this exact purpose.
  const { rows: [tenant] } = await pool.query(
    `select id, name, slug from salon_tenant($1)`, [SLUG],
  );
  if (!tenant) throw new Error(`No tenant found with slug '${SLUG}' and niche 'salon'. Nothing to do.`);
  const tid = tenant.id;
  console.log(`Found tenant: ${tenant.name} (${tid})`);

  const read = async (key) => {
    const { rows } = await pool.query(`select data from salon_store where tenant_id = $1 and key = $2`, [tid, key]);
    return rows[0] ? rows[0].data : null;
  };
  const site = await read('site');
  const data = await read('data');
  if (!site) throw new Error(`No 'site' row in salon_store for this tenant -- nothing to migrate. (Has this tenant ever been used?)`);
  const live = { ...site, ...(data || {}) };
  console.log(`Live data found: ${(live.menu || []).length} categories, ${(live.menu || []).flatMap((c) => c.items || []).length} services, ${(live.stylists || []).length} stylists, ${(live.bookings || []).length} bookings, ${(live.invoices || []).length} invoices, ${(live.expenses || []).length} expenses.`);

  const client = await pool.connect();
  try {
    await client.query('begin');
    await authorize(client, tid);
    const before = { settings: {}, content: {}, menu: [], stylists: [], gallery: [], bookings: [], invoices: [], expenses: [], counters: { booking: 0, invoice: 0 } };
    const existingSettings = (await client.query(`select data from records where tenant_id=$1 and kind='settings' and id='settings'`, [tid])).rows[0];
    const existingData = existingSettings ? existingSettings.data : {};
    const after = { ...live, settings: { ...existingData, ...live.settings, _salonSeeded: true } };
    await persistDb(client, tid, before, after);
    // persistDb never touches menu (categories/items) -- seed it here the same way initGenericStorage does
    for (const cat of live.menu || []) {
      const { items, ...catRow } = cat;
      await client.query(`insert into records (tenant_id, id, kind, data) values ($1,$2,'cat',$3::jsonb) on conflict (tenant_id, id) do update set data = excluded.data`, [tid, String(catRow.id), JSON.stringify(catRow)]);
      for (const item of items || []) {
        await client.query(`insert into records (tenant_id, id, kind, data) values ($1,$2,'item',$3::jsonb) on conflict (tenant_id, id) do update set data = excluded.data`, [tid, String(item.id), JSON.stringify({ ...item, cat: catRow.id })]);
      }
    }
    // staff list + admin console password, same copy, into the two singleton records
    const staff = await read('staff');
    if (staff) await client.query(`insert into records (tenant_id, id, kind, data) values ($1,'salon_staff','salon_staff',$2::jsonb) on conflict (tenant_id, id) do update set data = excluded.data`, [tid, JSON.stringify(staff)]);
    const admin = await read('admin');
    if (admin) await client.query(`insert into records (tenant_id, id, kind, data) values ($1,'salon_admin','salon_admin',$2::jsonb) on conflict (tenant_id, id) do update set data = excluded.data`, [tid, JSON.stringify(admin)]);

    await client.query('commit');
    // tenant_settings has only an owner SELECT policy, no owner UPDATE policy (db/013) -- a direct
    // UPDATE through this owner-authorized connection would silently match zero rows. Flip the switch
    // through the dedicated SECURITY DEFINER helper instead (db/171).
    const flipped = (await pool.query(`select salon_set_engine($1, 'generic') as ok`, [SLUG])).rows[0].ok;
    if (!flipped) throw new Error('Data was migrated, but flipping the engine switch failed (tenant not found by salon_set_engine).');
  } catch (e) {
    await client.query('rollback').catch(() => {});
    throw e;
  } finally { client.release(); }

  console.log('Done. Verifying...');
  // These two reads also hit RLS-protected tables (records, tenant_settings) -- same as the tenant
  // lookup above, a bare pool.query here would silently see nothing. Read through an authorized
  // connection, same as the write side did.
  const check = await withSalonAuth(pool, tid, (c) => c.query(`select count(*)::int n from records where tenant_id=$1 and kind in ('cat','item')`, [tid]));
  console.log(`Menu rows now in the new engine: ${check.rows[0].n}`);
  // salon_tenant() (db/170) is SECURITY DEFINER and already returns the engine field -- the one read
  // path here that doesn't hit tenant_settings' RLS at all.
  const flag = await pool.query(`select engine from salon_tenant($1)`, [SLUG]);
  console.log(`Engine switch: ${flag.rows[0] ? flag.rows[0].engine : '(tenant not found)'}`);
  console.log('Open the real site now to confirm it looks right. The old salon_store data is untouched as a fallback.');
  await pool.end();
}

main().catch((e) => { console.error('FAILED:', e); process.exit(1); });
