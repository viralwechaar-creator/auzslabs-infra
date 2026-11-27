-- Theme editor, step 10: entrance animations from a fixed list (fade in, rise, slide from left/right, zoom) on the Content section
-- and on each of its elements. Played once when the element scrolls into view; switched off for visitors who prefer less motion.
--
-- Rollback: update sfx_section_types set settings = (select jsonb_agg(x) from jsonb_array_elements(settings) x where x->>'id' <> 'anim'),
--   block_types = ... (remove the anim setting from every block type) where type = 'content';

do $$
declare anim jsonb := '{"id":"anim","type":"select","label":"Animation","options":[["none","None"],["fade","Fade in"],["rise","Rise up"],["left","Slide from left"],["right","Slide from right"],["zoom","Zoom in"]],"default":"none"}'::jsonb;
        r sfx_section_types; bts jsonb; b jsonb;
begin
  select * into r from sfx_section_types where type = 'content';
  if not found then return; end if;
  if exists (select 1 from jsonb_array_elements(r.settings) x where x->>'id' = 'anim') then return; end if;
  bts := '[]'::jsonb;
  for b in select * from jsonb_array_elements(r.block_types) loop
    bts := bts || jsonb_build_array(jsonb_set(b, '{settings}', (b->'settings') || jsonb_build_array(anim)));
  end loop;
  update sfx_section_types set settings = settings || jsonb_build_array(anim), block_types = bts where type = 'content';
end $$;
