-- =========================================================
-- Real bug found live: Mannat Cafe's QR ordering page crashed the
-- instant a customer tapped "+ Add" (TypeError: undefined is not an
-- object (evaluating 'i.price')), confirmed via a window.onerror popup
-- added specifically to catch this.
--
-- Root cause: every reader of the `records` table (the POS's own
-- save() in app/public/pos/core.js: "data.id = id" before every write;
-- site.html's cart; the console) assumes a record's own `data` jsonb
-- always carries its own id, not just the separate `records.id` column
-- -- that's the only id the client ever sees, since public_menu() (and
-- most other readers) return `data` alone, never joined with the row's
-- real id. The Mannat Cafe real-menu import (db/161/164/165) stamped
-- `id` correctly into every CATEGORY's own data (`jsonb_build_object
-- ('id', cat_tea, ...)`) but forgot it on every single ITEM --
-- gen_random_uuid() was passed straight as the records.id column value
-- with no variable kept around to also embed in data. Every imported
-- item's client-side `.id` was therefore undefined, so every item's
-- cart key collapsed onto the same broken string ("undefined|"),
-- breaking Add-to-cart for literally every item on the menu, dine-in
-- or takeaway, the whole time this tenant's real menu has been live.
--
-- General, safe, idempotent backfill -- not Mannat-specific, since
-- this is a reusable footgun for any one-off import migration, not a
-- mistake unique to this one file. Purely additive: only touches a row
-- whose own `data` doesn't already carry a matching id, so it can
-- never disturb a record the app itself saved correctly, and running
-- it again later is a no-op.
-- =========================================================

update records
  set data = data || jsonb_build_object('id', id), updated_at = now()
  where kind in ('item', 'cat', 'table')
    and (data->>'id') is distinct from id;
