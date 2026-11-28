-- Theme editor, step 14: a Row container inside the Content section. A row holds up to 8 other elements (heading, text, button, picture,
-- spacer) laid out side by side or stacked. Containers do not nest inside containers (one level), so the editor stays simple.
-- The existing cleaner knows nothing about children: it is kept as sfx_theme_clean_content_core_base and a wrapper cleans each row's
-- children with the same rules, so a child gets exactly the checks a top-level element gets.
-- Rollback: drop function sfx_theme_clean_content_core(jsonb); alter function sfx_theme_clean_content_core_base(jsonb) rename to sfx_theme_clean_content_core;
--   then remove the 'row' entry from sfx_section_types.block_types where type = 'content'.

do $$
declare r sfx_section_types; anim jsonb := '{"id":"anim","type":"select","label":"Animation","options":[["none","None"],["fade","Fade in"],["rise","Rise up"],["left","Slide from left"],["right","Slide from right"],["zoom","Zoom in"]],"default":"none"}'::jsonb;
        rowdef jsonb;
begin
  select * into r from sfx_section_types where type = 'content';
  if not found then return; end if;
  if exists (select 1 from jsonb_array_elements(r.block_types) x where x->>'type' = 'row') then return; end if;
  rowdef := jsonb_build_object('type', 'row', 'label', 'Row (holds other elements)', 'settings', jsonb_build_array(
    '{"id":"direction","type":"select","label":"Layout","options":[["row","Side by side"],["column","Stacked"]],"default":"row"}'::jsonb,
    '{"id":"gap","type":"number","label":"Space between (px)","min":0,"max":80}'::jsonb,
    '{"id":"align","type":"select","label":"Align items","options":[["start","Top / left"],["center","Middle"],["end","Bottom / right"]],"default":"start"}'::jsonb,
    '{"id":"bg","type":"color","label":"Background"}'::jsonb,
    '{"id":"pad","type":"number","label":"Padding (px)","min":0,"max":80}'::jsonb,
    '{"id":"radius","type":"number","label":"Corner radius (px)","min":0,"max":60}'::jsonb,
    anim));
  update sfx_section_types set block_types = block_types || jsonb_build_array(rowdef), max_blocks = greatest(max_blocks, 24) where type = 'content';
end $$;

alter function sfx_theme_clean_content_core(jsonb) rename to sfx_theme_clean_content_core_base;
create function sfx_theme_clean_content_core(p jsonb) returns jsonb language plpgsql stable set search_path = public as $$
declare out_ jsonb := sfx_theme_clean_content_core_base(p); i int; j int; s jsonb; b jsonb; kids jsonb; clean jsonb; n int;
begin
  if jsonb_typeof(p->'sections') is distinct from 'array' then return out_; end if;
  for i in 0 .. jsonb_array_length(p->'sections') - 1 loop
    s := p->'sections'->i;
    continue when s->>'type' is distinct from 'content' or jsonb_typeof(s->'blocks') is distinct from 'array';
    for j in 0 .. jsonb_array_length(s->'blocks') - 1 loop
      b := s->'blocks'->j;
      continue when b->>'type' is distinct from 'row' or jsonb_typeof(b->'blocks') is distinct from 'array';
      kids := b->'blocks'; n := jsonb_array_length(kids);
      if n > 8 then raise exception 'Section %, row %: up to 8 elements in a row', i + 1, j + 1 using errcode = 'SF002'; end if;
      if exists (select 1 from jsonb_array_elements(kids) k where k->>'type' = 'row') then
        raise exception 'Section %, row %: a row cannot hold another row', i + 1, j + 1 using errcode = 'SF002';
      end if;
      continue when n = 0;
      clean := sfx_theme_clean_content_core_base(jsonb_build_object('sections', jsonb_build_array(jsonb_build_object('type', 'content', 'props', '{}'::jsonb, 'blocks', kids))))->'sections'->0->'blocks';
      if clean is not null and (out_->'sections'->i->'blocks'->j) is not null then
        out_ := jsonb_set(out_, array['sections', i::text, 'blocks', j::text, 'blocks'], clean);
      end if;
    end loop;
  end loop;
  return out_;
end $$;
grant execute on function sfx_theme_clean_content_core(jsonb) to app;
