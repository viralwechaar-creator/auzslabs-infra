-- Sections and items can carry a display name (Rename) and a lock flag (Lock: the editor will not delete or move it).
-- Kept by wrapping the cleaner; names are plain text up to 60 characters, locked is true or absent.
-- Rollback: drop function sfx_theme_clean_content_core(jsonb); alter function sfx_theme_clean_content_core_prelock(jsonb) rename to sfx_theme_clean_content_core;
alter function sfx_theme_clean_content_core(jsonb) rename to sfx_theme_clean_content_core_prelock;
create function sfx_theme_clean_content_core(p jsonb) returns jsonb language plpgsql stable set search_path = public as $$
declare out_ jsonb := sfx_theme_clean_content_core_prelock(p); i int; j int; s jsonb; b jsonb; nm text; extra jsonb;
begin
  if jsonb_typeof(p->'sections') is distinct from 'array' then return out_; end if;
  for i in 0 .. jsonb_array_length(p->'sections') - 1 loop
    s := p->'sections'->i;
    continue when out_->'sections'->i is null;
    extra := '{}'::jsonb;
    nm := case when jsonb_typeof(s->'name') = 'string' then trim(regexp_replace(left(s->>'name', 60), '[<>]', '', 'g')) end;
    if nm <> '' then extra := extra || jsonb_build_object('name', nm); end if;
    if s->'locked' = 'true'::jsonb then extra := extra || jsonb_build_object('locked', true); end if;
    if extra <> '{}'::jsonb then out_ := jsonb_set(out_, array['sections', i::text], (out_->'sections'->i) || extra); end if;
    continue when jsonb_typeof(s->'blocks') is distinct from 'array' or out_->'sections'->i->'blocks' is null;
    for j in 0 .. jsonb_array_length(s->'blocks') - 1 loop
      b := s->'blocks'->j;
      continue when out_->'sections'->i->'blocks'->j is null;
      extra := '{}'::jsonb;
      nm := case when jsonb_typeof(b->'name') = 'string' then trim(regexp_replace(left(b->>'name', 60), '[<>]', '', 'g')) end;
      if nm <> '' then extra := extra || jsonb_build_object('name', nm); end if;
      if b->'locked' = 'true'::jsonb then extra := extra || jsonb_build_object('locked', true); end if;
      if extra <> '{}'::jsonb then out_ := jsonb_set(out_, array['sections', i::text, 'blocks', j::text], (out_->'sections'->i->'blocks'->j) || extra); end if;
    end loop;
  end loop;
  return out_;
end $$;
grant execute on function sfx_theme_clean_content_core(jsonb) to app;
