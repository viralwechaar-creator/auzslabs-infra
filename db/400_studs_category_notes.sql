-- Studs: editable short note shown under each category title on the shop page.
-- settings.categoryNotes = { "<category name>": "<text up to 400 chars>" } (up to 40 categories).
-- Wraps sfx_studs_clean_settings so the existing whitelist is untouched.
-- Rollback: drop function sfx_studs_clean_settings(jsonb); alter function sfx_studs_clean_settings_pre400(jsonb) rename to sfx_studs_clean_settings;
alter function sfx_studs_clean_settings(jsonb) rename to sfx_studs_clean_settings_pre400;
create function sfx_studs_clean_settings(p jsonb) returns jsonb language plpgsql immutable set search_path = public as $$
declare o jsonb := sfx_studs_clean_settings_pre400(p); notes jsonb := '{}'::jsonb; k text; v text; n int := 0;
begin
  if p is not null and jsonb_typeof(p) = 'object' and p ? 'categoryNotes' and jsonb_typeof(p->'categoryNotes') = 'object' then
    for k, v in select key, value #>> '{}' from jsonb_each(p->'categoryNotes') where jsonb_typeof(value) = 'string' loop
      n := n + 1; exit when n > 40;
      k := left(btrim(k), 80); v := left(btrim(v), 400);
      if k <> '' and v <> '' then notes := notes || jsonb_build_object(k, v); end if;
    end loop;
    if notes <> '{}'::jsonb then o := o || jsonb_build_object('categoryNotes', notes); end if;
  end if;
  return o;
end $$;
grant execute on function sfx_studs_clean_settings(jsonb) to app;
