-- Theme editor, step 12: a section can be hidden (kept in the design but not shown to visitors).
-- Stored as the setting "hidden" = "yes" on any section type; the editor's Hide / Show button sets it.
--
-- Rollback: update sfx_section_types set settings = (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(settings) x where x->>'id' <> 'hidden');
do $$
declare h jsonb := '{"id":"hidden","type":"select","label":"Hidden","options":[["no","Shown"],["yes","Hidden"]],"default":"no"}'::jsonb;
begin
  update sfx_section_types set settings = settings || jsonb_build_array(h)
   where not exists (select 1 from jsonb_array_elements(settings) x where x->>'id' = 'hidden');
end $$;
