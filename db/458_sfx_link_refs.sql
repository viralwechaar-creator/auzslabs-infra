-- Theme editor, step 7: link references. A link field can now hold a reference to a store page, collection, product or category
-- instead of a typed address: ref:home, ref:shop, ref:collections, ref:about, ref:contact, ref:faq, ref:stores, ref:cart,
-- ref:page:<slug>, ref:collection:<id>, ref:product:<id>, ref:category:<name>. The store turns a reference into the right address
-- when it draws the page, so a link keeps working after a rename (a page address rename in the editor updates its references).
--
-- Rollback: restore sfx_clean_setting from db/455.

create or replace function sfx_clean_setting(def jsonb, val jsonb, ctx text) returns jsonb language plpgsql stable set search_path = public as $$
declare t text := def->>'type'; id text := def->>'id'; s text; n numeric; o jsonb; ok boolean := false; lim int;
begin
  if val is null or jsonb_typeof(val) = 'null' then return null; end if;
  if t = 'number' then
    if jsonb_typeof(val) = 'number' then n := (val #>> '{}')::numeric;
    elsif jsonb_typeof(val) = 'string' and (val #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$' then n := (val #>> '{}')::numeric;
    else raise exception '%: % must be a number', ctx, id using errcode = 'SF002'; end if;
    n := least(greatest(n, coalesce((def->>'min')::numeric, -1000000)), coalesce((def->>'max')::numeric, 1000000));
    return to_jsonb(n);
  end if;
  if jsonb_typeof(val) <> 'string' then raise exception '%: % must be text', ctx, id using errcode = 'SF002'; end if;
  s := val #>> '{}';
  lim := case t when 'text' then 500 when 'textarea' then 4000 when 'collection' then 80 when 'color' then 7 else 2000 end;
  if length(s) > lim then raise exception '%: % is too long', ctx, id using errcode = 'SF002'; end if;
  if t = 'color' and s !~ '^#[0-9a-fA-F]{6}$' then raise exception '%: % must be a colour like #800020', ctx, id using errcode = 'SF002'; end if;
  if t = 'url' and s like 'ref:%' then
    if s !~ '^ref:(home|shop|collections|about|contact|faq|stores|cart|page:[a-z0-9-]{1,40}|collection:[0-9a-f-]{36}|product:[0-9a-f-]{36}|category:[A-Za-z0-9 _&.,()''-]{1,60})$' then raise exception '%: that link target is not valid', ctx using errcode = 'SF002'; end if;
  elsif t in ('url', 'image') and s <> '' and s !~* '^(https://|/)' then raise exception '%: links must start with https:// or /', ctx using errcode = 'SF002'; end if;
  if t = 'collection' and s <> '' and s !~ '^[-a-zA-Z0-9_]+$' then raise exception '%: choose a collection from the list', ctx using errcode = 'SF002'; end if;
  if t = 'select' then
    for o in select * from jsonb_array_elements(coalesce(def->'options', '[]'::jsonb)) loop
      if (o->>0) = s then ok := true; end if;
    end loop;
    if not ok then return null; end if;
  end if;
  return to_jsonb(s);
end $$;
grant execute on function sfx_clean_setting(jsonb, jsonb, text) to app;
