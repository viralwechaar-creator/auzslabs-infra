-- Trial (salesman) cafes could not take any order from their website: the seeded menu items had no `id` inside
-- their own data (the same bug db/168 fixed for Mannat Cafe), so every cart key collapsed to "undefined|" and Add did nothing.
-- 1) backfill every item/category/table that lacks its own id, 2) a trigger so no seed script or import can leave it out again.
update records set data = data || jsonb_build_object('id', id)
 where kind in ('item','cat','table') and (data->>'id') is distinct from id::text;

create or replace function records_stamp_own_id() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind in ('item','cat','table') and (new.data->>'id') is distinct from new.id::text then
    new.data := coalesce(new.data, '{}'::jsonb) || jsonb_build_object('id', new.id);
  end if;
  return new;
end $$;

drop trigger if exists records_stamp_own_id on records;
create trigger records_stamp_own_id before insert or update on records
  for each row execute function records_stamp_own_id();
