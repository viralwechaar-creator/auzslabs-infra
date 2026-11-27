-- Theme editor, step 2: per-page templates. A theme can now carry an ordered list of sections for the Collection page,
-- the Product page and the Cart page. Each list holds one locked "main" entry (the page's own content: the product grid,
-- the product details, the cart) and sections above or below it. Home keeps its own list (content.sections), pages keep theirs.
--
-- content.templates = { collection: { sections: [...] }, product: { sections: [...] }, cart: { sections: [...] } }
-- A template with no list, or no "main" entry, shows the page as before with the sections after it.
--
-- Rollback: restore sfx_theme_clean_content from db/399; drop function sfx_theme_templates_clean(jsonb);
--   drop function public_sfx_store(text); alter function public_sfx_store_pretpl(text) rename to public_sfx_store;

create or replace function sfx_theme_templates_clean(p jsonb) returns jsonb language plpgsql stable set search_path = public as $$
declare tpl jsonb := '{}'::jsonb; k text; t jsonb; secs jsonb; s jsonb; cleaned jsonb; seen_main boolean;
begin
  if p is null or jsonb_typeof(p) <> 'object' or jsonb_typeof(p->'templates') <> 'object' then return '{}'::jsonb; end if;
  foreach k in array array['collection', 'product', 'cart'] loop
    t := p->'templates'->k;
    continue when t is null or jsonb_typeof(t) <> 'object' or jsonb_typeof(t->'sections') <> 'array';
    if jsonb_array_length(t->'sections') > 13 then raise exception 'A page template can have up to 12 sections' using errcode = 'SF002'; end if;
    secs := '[]'::jsonb; seen_main := false;
    for s in select * from jsonb_array_elements(t->'sections') loop
      if s->>'type' = 'main' then
        if not seen_main then secs := secs || '[{"id":"main","type":"main","props":{}}]'::jsonb; seen_main := true; end if;
      else
        cleaned := sfx_theme_clean_content_core(jsonb_build_object('sections', jsonb_build_array(s)))->'sections'->0;
        secs := secs || jsonb_build_array(cleaned);
      end if;
    end loop;
    tpl := tpl || jsonb_build_object(k, jsonb_build_object('sections', secs));
  end loop;
  if tpl = '{}'::jsonb then return '{}'::jsonb; end if;
  return jsonb_build_object('templates', tpl);
end $$;
grant execute on function sfx_theme_templates_clean(jsonb) to app;

-- import / new-theme / save cleaning now keeps the page templates too
create or replace function sfx_theme_clean_content(p jsonb) returns jsonb language plpgsql stable set search_path = public as $$
begin
  return sfx_theme_clean_content_core(p) || sfx_theme_chrome_clean(p) || sfx_theme_templates_clean(p);
end $$;
grant execute on function sfx_theme_clean_content(jsonb) to app;

create or replace function sfx_theme_customize_save(p_install_id uuid, p_content jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); c jsonb := coalesce(p_content, '{}'::jsonb);
begin
  if jsonb_typeof(c) <> 'object' then raise exception 'The theme content must be an object' using errcode = 'SF002'; end if;
  if c->>'kind' is distinct from 'studs' then
    c := (c - 'sections' - 'header' - 'footer' - 'pages' - 'accent' - 'templates') || sfx_theme_clean_content(c);
  end if;
  update sfx_theme_installs set draft_content = c where id = p_install_id and tenant_id = tid;
  if not found then raise exception 'Theme install not found'; end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function sfx_theme_customize_save(uuid, jsonb) to app;

-- the public store: config.themeTemplates from the active theme's PUBLISHED content
alter function public_sfx_store(text) rename to public_sfx_store_pretpl;
create function public_sfx_store(p_slug text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb := public_sfx_store_pretpl(p_slug); tid uuid; st sfx_stores; c jsonb; tp jsonb := '{}'::jsonb;
begin
  if r is null or r->'config' is null or (r->>'closed') = 'true' then return r; end if;
  tid := sfx_public_tenant(p_slug);
  select * into st from sfx_stores where tenant_id = tid;
  select i.published_content into c from sfx_theme_installs i where i.id = st.active_install_id;
  begin tp := coalesce(sfx_theme_templates_clean(c)->'templates', '{}'::jsonb); exception when others then tp := '{}'::jsonb; end;
  return jsonb_set(r, '{config}', (r->'config') || jsonb_build_object('themeTemplates', tp));
end $$;
grant execute on function public_sfx_store(text) to app;
