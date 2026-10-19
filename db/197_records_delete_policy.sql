-- The real root cause of "menu group deletes show saved but never actually go away" (and, it turns
-- out, every other delete through persistCollection() in salon-engine.js -- removing a hairstylist,
-- any other collection a generic-engine salon tenant's own admin console deletes from -- hit this
-- same silent failure, just never exercised before now): the `records` table has had RLS policies
-- for INSERT (r_ins), SELECT (r_read) and UPDATE (r_upd) since db/002/db/068, but NEVER a DELETE
-- policy. Confirmed by grepping the entire migration history: zero hits for "records for delete".
-- With row-level security on and no policy covering an operation, Postgres silently treats every row
-- as invisible to that operation -- a DELETE statement runs, throws no error, and matches zero rows.
-- That is exactly what live debugging showed: `delete from records where tenant_id=$1 and id=$2 and
-- kind='cat'` returned rowCount=0 for a row the very same transaction's own SELECT had just read.
-- Mirrors r_upd's own `using` clause exactly (db/068) -- no pos_kind_ok() check is needed here, unlike
-- INSERT/UPDATE's `with check`, since a DELETE has no new row content to validate, only the existing
-- row's tenant ownership.
drop policy if exists r_del on records;
create policy r_del on records for delete
  using (me() is not null and tenant_id = (me()->>'tenant_id')::uuid);
