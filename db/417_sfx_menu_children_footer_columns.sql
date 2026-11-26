-- Round 6 (storefront gaps): header menus can have one level of sub-links, and the footer can have up to 3 titled link columns.
-- link = {label, href, children?: [{label, href}]}; footer.columns = [{title, links[]}].
-- Everything existing is unchanged (no children / no columns = today's menus).
-- Rollback: drop function sfx_theme_chrome_clean(jsonb); alter function sfx_theme_chrome_clean_precols(jsonb) rename to sfx_theme_chrome_clean;
--   drop function sfx_chrome_links(jsonb, int); alter function sfx_chrome_links_flat(jsonb, int) rename to sfx_chrome_links;
alter function sfx_chrome_links(jsonb, int) rename to sfx_chrome_links_flat;
create function sfx_chrome_links(j jsonb, maxn int) returns jsonb language plpgsql immutable set search_path = public as $$
declare flat jsonb := sfx_chrome_links_flat(j, maxn); out_ jsonb := '[]'::jsonb; i int := 0; l jsonb; src jsonb; kids jsonb;
begin
  if jsonb_typeof(j) <> 'array' then return flat; end if;
  -- the flat cleaner keeps order and drops bad rows, so children are matched back by label + href
  for l in select * from jsonb_array_elements(flat) loop
    select e into src from jsonb_array_elements(j) e where jsonb_typeof(e) = 'object' and btrim(left(coalesce(e->>'label', ''), 40)) = l->>'label' and btrim(coalesce(e->>'href', '')) = l->>'href' limit 1;
    kids := case when src is not null and jsonb_typeof(src->'children') = 'array' then sfx_chrome_links_flat(src->'children', 8) else '[]'::jsonb end;
    out_ := out_ || jsonb_build_array(case when jsonb_array_length(kids) > 0 then l || jsonb_build_object('children', kids) else l end);
  end loop;
  return out_;
end $$;

alter function sfx_theme_chrome_clean(jsonb) rename to sfx_theme_chrome_clean_precols;
create function sfx_theme_chrome_clean(p jsonb) returns jsonb language plpgsql immutable set search_path = public as $$
declare out_ jsonb := sfx_theme_chrome_clean_precols(p); cols jsonb := '[]'::jsonb; c jsonb; t text; ls jsonb;
begin
  if jsonb_typeof(out_->'footer') = 'object' and jsonb_typeof(p->'footer'->'columns') = 'array' then
    for c in select * from jsonb_array_elements(p->'footer'->'columns') loop
      exit when jsonb_array_length(cols) >= 3;
      continue when jsonb_typeof(c) <> 'object';
      t := btrim(left(coalesce(c->>'title', ''), 40)); ls := sfx_chrome_links_flat(c->'links', 8);
      continue when t = '' or jsonb_array_length(ls) = 0;
      cols := cols || jsonb_build_array(jsonb_build_object('title', t, 'links', ls));
    end loop;
    if jsonb_array_length(cols) > 0 then out_ := jsonb_set(out_, '{footer,columns}', cols); end if;
  end if;
  return out_;
end $$;
grant execute on function sfx_theme_chrome_clean(jsonb) to app;
grant execute on function sfx_chrome_links(jsonb, int) to app;
