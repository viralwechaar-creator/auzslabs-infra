// Salon-onto-generic-engine: the data-access layer that replaces salon_store's raw JSON documents.
// Everything here assembles and persists the EXACT same in-memory shape salon.js's own readKey/writeKey/
// mutate functions always produced -- handleSalon() and every endpoint inside it (route matching,
// validation, auth, the frontend contract) is completely untouched by this file. Only the storage
// underneath changes: real rows in `records` (settings, menu, stylists, invoices, expenses) and the
// real, already-shared `bookings` table, all RLS-protected -- unlike salon_store, which had none.
//
// Why a full assemble/diff instead of per-field writes: the legacy code mutates one big in-memory
// object (`db.invoices.push(...)`, `db.settings.x = y`, `db.bookings.splice(...)`) and expects the
// whole thing persisted atomically. Rather than rewrite every one of those call sites (and risk
// drifting from their exact behaviour), this layer reproduces the same "read the whole thing, hand it
// to the caller's function, persist what changed" contract on top of normal relational rows.

import crypto from 'node:crypto';

const COLLECTION_KINDS = { stylists: 'stylist', invoices: 'salon_invoice', expenses: 'salon_expense' };

function refOf(id) { return String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase(); }

function bookingRowToLegacy(r) {
  return {
    id: r.id, ref: refOf(r.id), name: r.customer_name, phone: r.customer_phone, email: r.email || '',
    date: typeof r.date === 'string' ? r.date : r.date.toISOString().slice(0, 10),
    time: r.time ? String(r.time).slice(0, 5) : '', note: r.note || '',
    services: r.items || [], price: Number(r.total) || 0, status: r.status, createdAt: r.created_at,
  };
}
function legacyBookingToRow(b) {
  return {
    id: b.id, customer_name: b.name, customer_phone: b.phone, email: b.email || null, date: b.date,
    time: b.time || null, note: b.note || null, status: b.status, items: JSON.stringify(b.services || []),
    total: b.price || 0,
  };
}

// ---- read: assemble the full legacy-shaped combined object, optionally row-locked for a mutate() ----
export async function assembleDb(client, tid, lock) {
  const L = lock ? ' for update' : '';
  const settingsRow = (await client.query(`select data from records where tenant_id=$1 and kind='settings' and id='settings'${L}`, [tid])).rows[0];
  const raw = settingsRow ? settingsRow.data : { id: 'settings' };
  const { content, gallery, ...settings } = raw; // content/gallery live inside the one settings record; split back out to the legacy nested shape
  const cats = (await client.query(`select data from records where tenant_id=$1 and kind='cat' order by id${L}`, [tid])).rows.map((r) => r.data);
  const items = (await client.query(`select data from records where tenant_id=$1 and kind='item' order by id${L}`, [tid])).rows.map((r) => r.data);
  const menu = cats.map((c) => ({ ...c, items: items.filter((i) => i.cat === c.id) }));
  const stylists = (await client.query(`select data from records where tenant_id=$1 and kind='stylist' order by id${L}`, [tid])).rows.map((r) => r.data);
  const invoices = (await client.query(`select data from records where tenant_id=$1 and kind='salon_invoice' order by id${L}`, [tid])).rows.map((r) => r.data);
  const expenses = (await client.query(`select data from records where tenant_id=$1 and kind='salon_expense' order by id${L}`, [tid])).rows.map((r) => r.data);
  const bookingRows = (await client.query(`select * from bookings where tenant_id=$1${L}`, [tid])).rows;
  const bookings = bookingRows.map(bookingRowToLegacy);
  const counters = { booking: bookings.length, invoice: invoices.length };
  return { settings, content: content || {}, menu, stylists: stylists || [], gallery: gallery || [], bookings, invoices: invoices || [], expenses: expenses || [], counters };
}

// ---- write: diff a before/after pair of assembled objects and persist exactly what changed ----
async function persistSettings(client, tid, before, after) {
  const beforeFlat = { ...before.settings, content: before.content, gallery: before.gallery };
  const afterFlat = { ...after.settings, content: after.content, gallery: after.gallery, id: 'settings' };
  if (JSON.stringify(beforeFlat) === JSON.stringify(afterFlat)) return;
  await client.query(
    `insert into records (tenant_id, id, kind, data) values ($1,'settings','settings',$2::jsonb)
     on conflict (tenant_id, id) do update set data = excluded.data, updated_at = now()`,
    [tid, JSON.stringify(afterFlat)],
  );
}
async function persistCollection(client, tid, kind, before, after) {
  const beforeById = new Map(before.map((x) => [x.id, x])), afterById = new Map(after.map((x) => [x.id, x]));
  for (const [id, row] of afterById) {
    if (JSON.stringify(beforeById.get(id)) !== JSON.stringify(row)) {
      await client.query(
        `insert into records (tenant_id, id, kind, data) values ($1,$2,$3,$4::jsonb)
         on conflict (tenant_id, id) do update set data = excluded.data, updated_at = now()`,
        [tid, String(id), kind, JSON.stringify(row)],
      );
    }
  }
  for (const id of beforeById.keys()) if (!afterById.has(id)) await client.query(`delete from records where tenant_id=$1 and id=$2 and kind=$3`, [tid, String(id), kind]);
}
async function persistBookings(client, tid, before, after) {
  const beforeById = new Map(before.map((x) => [x.id, x])), afterById = new Map(after.map((x) => [x.id, x]));
  for (const [id, b] of afterById) {
    const prev = beforeById.get(id);
    if (JSON.stringify(prev) === JSON.stringify(b)) continue;
    const row = legacyBookingToRow(b);
    if (!prev) {
      await client.query(
        `insert into bookings (id, tenant_id, customer_name, customer_phone, email, date, time, note, status, items, total)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)`,
        [row.id, tid, row.customer_name, row.customer_phone, row.email, row.date, row.time, row.note, row.status, row.items, row.total],
      );
    } else {
      await client.query(
        `update bookings set customer_name=$2, customer_phone=$3, email=$4, date=$5, time=$6, note=$7, status=$8, items=$9::jsonb, total=$10 where id=$1 and tenant_id=$11`,
        [row.id, row.customer_name, row.customer_phone, row.email, row.date, row.time, row.note, row.status, row.items, row.total, tid],
      );
    }
  }
  for (const id of beforeById.keys()) if (!afterById.has(id)) await client.query(`delete from bookings where id=$1 and tenant_id=$2`, [id, tid]);
}
export async function persistDb(client, tid, before, after) {
  await persistSettings(client, tid, before, after);
  await persistCollection(client, tid, 'stylist', before.stylists, after.stylists);
  await persistCollection(client, tid, 'salon_invoice', before.invoices, after.invoices);
  await persistCollection(client, tid, 'salon_expense', before.expenses, after.expenses);
  await persistBookings(client, tid, before.bookings, after.bookings);
  // menu (categories/items) is edited through the console's own existing menu editor, not through
  // salon's admin console -- the menu-editing endpoints in handleSalon() are not part of this swap.
}

export function newId() { return crypto.randomUUID(); }

// records/bookings are RLS-protected, keyed off app_uid() -- a public site visitor has no AUZslab login
// at all, and salon.js's own request model (its own cookie session, never a platform JWT) never sets
// app.uid either way. salon_owner_uid(tid) (db/170, SECURITY DEFINER, works with no app.uid set) resolves
// a real member of the tenant; set_config(...,true) then makes every query on THIS one client see that
// identity for the rest of this one transaction, exactly the withAuth() pattern in db.js, just applied to
// a client this file doesn't own the full lifecycle of (mutate() in salon.js manages its own transaction).
export async function authorize(client, tid) {
  const uid = (await client.query('select salon_owner_uid($1) as id', [tid])).rows[0].id;
  await client.query('select set_config($1, $2, true)', ['app.uid', uid || '']);
}
// Read-only convenience: open a short-lived transaction, authorize it, run fn(client), commit. For the
// simple read paths (loadSite/loadDb/bookingCounts) that don't already have a transaction of their own.
export async function withSalonAuth(pool, tid, fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await authorize(client, tid);
    const out = await fn(client);
    await client.query('commit');
    return out;
  } catch (e) { await client.query('rollback').catch(() => {}); throw e; } finally { client.release(); }
}

// First use of a generic-engine salon tenant: if it has not been seeded yet, seed it from the given
// template data (the same makeSeed()/makeTemplate()/makeDemo() shapes salon.js already uses), writing
// straight into records/bookings instead of salon_store. Mirrors salon.js's own initStorage(), serialised
// the same way (an advisory lock) so two first requests can't both seed it.
// NOT keyed on "does a settings record exist" -- provision_tenant() (db/004/037) already inserts a bare
// kind='settings' row for every niche the moment any tenant is created, so that row existing proves
// nothing about whether THIS salon-specific seeding has run yet. `_salonSeeded` is this file's own marker.
export async function initGenericStorage(pool, tenant, freshData) {
  const tid = tenant.id, client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(hashtext($1))', ['salon-init-generic:' + tid]);
    await authorize(client, tid);
    const existingRow = (await client.query(`select data from records where tenant_id=$1 and kind='settings' and id='settings'`, [tid])).rows[0];
    const existingData = existingRow ? existingRow.data : {};
    if (existingData._salonSeeded !== true) {
      // provision_tenant() (db/004/037) already created this exact row from the niche preset, carrying
      // fields the salon template shape never had at all (bizType, currency, expense_categories) -- merge
      // the template ON TOP of whatever is already there instead of replacing it outright, or public_menu's
      // own bizType lookup (which land.html's niche routing depends on for every tenant, salon included)
      // silently loses the one field that makes this tenant route to /salon/ in the first place.
      freshData = { ...freshData, settings: { ...existingData, ...freshData.settings, _salonSeeded: true } };
      const empty = { settings: {}, content: {}, menu: [], stylists: [], gallery: [], bookings: [], invoices: [], expenses: [], counters: { booking: 0, invoice: 0 } };
      await persistDb(client, tid, empty, freshData);
      // persistDb intentionally never touches menu (the console's own existing menu editor owns cat/item
      // records for every niche) -- a brand-new tenant still needs its starting categories/services seeded once.
      for (const cat of freshData.menu || []) {
        const { items, ...catRow } = cat;
        await client.query(`insert into records (tenant_id, id, kind, data) values ($1,$2,'cat',$3::jsonb) on conflict (tenant_id, id) do nothing`, [tid, String(catRow.id), JSON.stringify(catRow)]);
        for (const item of items || []) {
          await client.query(`insert into records (tenant_id, id, kind, data) values ($1,$2,'item',$3::jsonb) on conflict (tenant_id, id) do nothing`, [tid, String(item.id), JSON.stringify({ ...item, cat: catRow.id })]);
        }
      }
    }
    await client.query('commit');
  } catch (e) { await client.query('rollback').catch(() => {}); throw e; } finally { client.release(); }
}
