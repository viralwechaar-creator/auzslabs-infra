-- Owner: remove the photos from the demo (salesman trial) POS menu items.
-- 1) strip the default demo photo from every item that still has one (a photo a salesman uploaded is never touched),
-- 2) a trigger so seeding / "apply demo content" can never put a /assets/demo-menu/ photo on an item again
--    (the seed functions stay as they are; the trigger removes the key as the row is written).
-- The website hero banner and gallery are not items and are unchanged.
update records set data = data - 'img'
 where kind = 'item' and data->>'img' like '/assets/demo-menu/%';

create or replace function records_no_demo_item_photo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'item' and (new.data->>'img') like '/assets/demo-menu/%' then
    new.data := new.data - 'img';
  end if;
  return new;
end $$;

drop trigger if exists records_no_demo_item_photo on records;
create trigger records_no_demo_item_photo before insert or update on records
  for each row execute function records_no_demo_item_photo();
