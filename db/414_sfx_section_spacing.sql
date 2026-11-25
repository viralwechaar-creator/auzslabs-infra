-- Round 3b (storefront gaps): every theme section can carry two optional layout settings.
--   space: compact | normal | roomy      align: left | center
-- Anything else is dropped. Existing themes/drafts/history are untouched (no props = today's look).
-- Rollback: drop function sfx_theme_clean_content_core(jsonb); alter function sfx_theme_clean_content_core_prespace(jsonb) rename to sfx_theme_clean_content_core;
alter function sfx_theme_clean_content_core(jsonb) rename to sfx_theme_clean_content_core_prespace;
create function sfx_theme_clean_content_core(p jsonb) returns jsonb language plpgsql immutable set search_path = public as $$
declare r jsonb := sfx_theme_clean_content_core_prespace(p); i int; src jsonb; sp text; al text; secs jsonb := '[]'::jsonb; sec jsonb; n int;
begin
  if jsonb_typeof(r->'sections') <> 'array' or jsonb_typeof(p->'sections') <> 'array' then return r; end if;
  n := jsonb_array_length(r->'sections');
  for i in 0 .. n - 1 loop
    sec := r->'sections'->i; src := coalesce(p->'sections'->i->'props', '{}'::jsonb);
    sp := case when jsonb_typeof(src->'space') = 'string' then src->>'space' end; al := case when jsonb_typeof(src->'align') = 'string' then src->>'align' end;
    if sp in ('compact', 'normal', 'roomy') then sec := jsonb_set(sec, '{props,space}', to_jsonb(sp)); end if;
    if al in ('left', 'center') then sec := jsonb_set(sec, '{props,align}', to_jsonb(al)); end if;
    secs := secs || jsonb_build_array(sec);
  end loop;
  return jsonb_set(r, '{sections}', secs);
end $$;
grant execute on function sfx_theme_clean_content_core(jsonb) to app;
