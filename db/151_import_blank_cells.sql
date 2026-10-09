-- Import: a blank cell means "not given", never an empty-string value. A CSV row with an empty "Service (true/false)" cell used to fail with
-- `invalid input syntax for type boolean: ""` (and the same for any other blank number/date cell), so every row was refused.
-- The real function becomes acc_import_core; acc_import (the name the apps call) drops blank cells from every row, then calls it.
do $$ begin
  if to_regproc('acc_import_core') is null then
    alter function acc_import(text, jsonb, boolean, boolean, jsonb) rename to acc_import_core;
  end if;
end $$;

create or replace function acc_import(p_entity text, p_rows jsonb, p_commit boolean default false, p_strict boolean default true, p_options jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public as $$
declare cleaned jsonb;
begin
  if jsonb_typeof(p_rows) = 'array' then
    select coalesce(jsonb_agg(case when jsonb_typeof(x) = 'object'
        then (select coalesce(jsonb_object_agg(e.k, e.v), '{}'::jsonb) from jsonb_each(x) e(k, v) where not (jsonb_typeof(e.v) = 'string' and btrim(e.v #>> '{}') = ''))
        else x end), '[]'::jsonb) into cleaned
    from jsonb_array_elements(p_rows) x;
  else cleaned := p_rows; end if;
  return acc_import_core(p_entity, cleaned, p_commit, p_strict, p_options);
end $$;
