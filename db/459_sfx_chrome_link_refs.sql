-- Theme editor, step 9: header menu, footer links, footer columns and the announcement link may use references
-- (ref:page:<slug>, ref:collection:<id>, ref:product:<id>, ref:category:<name>, ref:home|shop|collections|about|contact|faq|stores|cart)
-- as well as typed addresses, so a link survives renaming. Same forms as db/458.
--
-- Rollback: recreate sfx_chrome_links_flat from db/399 and drop sfx_theme_chrome_clean_prerefs rename (see below).

create or replace function sfx_chrome_links_flat(j jsonb, maxn int) returns jsonb language plpgsql immutable set search_path = public as $$
declare out_ jsonb := '[]'::jsonb; l jsonb; lab text; hr text;
begin
  if j is null or jsonb_typeof(j) <> 'array' then return out_; end if;
  for l in select * from jsonb_array_elements(j) loop
    exit when jsonb_array_length(out_) >= maxn;
    continue when jsonb_typeof(l) <> 'object' or jsonb_typeof(l->'label') <> 'string' or jsonb_typeof(l->'href') <> 'string';
    lab := btrim(left(l->>'label', 40)); hr := btrim(l->>'href');
    continue when lab = '' or length(hr) > 600 or hr ~ '\s'
      or (hr !~* '^(https://|/|#/)' and hr !~ '^ref:(home|shop|collections|about|contact|faq|stores|cart|page:[a-z0-9][a-z0-9-]{0,40}|collection:[0-9a-fA-F-]{36}|product:[0-9a-fA-F-]{36}|category:[^[:cntrl:]]{1,80})$');
    out_ := out_ || jsonb_build_array(jsonb_build_object('label', lab, 'href', hr));
  end loop;
  return out_;
end $$;

-- announcement link: keep a valid reference too
alter function sfx_theme_chrome_clean(jsonb) rename to sfx_theme_chrome_clean_prerefs;
create function sfx_theme_chrome_clean(p jsonb) returns jsonb language plpgsql immutable set search_path = public as $$
declare out_ jsonb := sfx_theme_chrome_clean_prerefs(p); ah text;
begin
  if jsonb_typeof(out_->'header') = 'object' and jsonb_typeof(p->'header'->'announceHref') = 'string' then
    ah := btrim(p->'header'->>'announceHref');
    if ah ~ '^ref:(home|shop|collections|about|contact|faq|stores|cart|page:[a-z0-9][a-z0-9-]{0,40}|collection:[0-9a-fA-F-]{36}|product:[0-9a-fA-F-]{36}|category:[^[:cntrl:]]{1,80})$' then
      out_ := jsonb_set(out_, '{header,announceHref}', to_jsonb(ah));
    end if;
  end if;
  return out_;
end $$;
grant execute on function sfx_chrome_links_flat(jsonb, int) to app;
grant execute on function sfx_theme_chrome_clean(jsonb) to app;
