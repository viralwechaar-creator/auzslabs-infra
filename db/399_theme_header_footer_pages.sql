-- Theme editor: header and footer blocks, and extra pages built from templates.
-- A theme's content may now also carry  header: {announceText, announceHref, links[]},  footer: {about, note, links[]},
-- pages: [{slug, title, template, sections[]}]. They are cleaned when read for the public store (links must be https:// or a site path,
-- text is length-limited, unknown fields dropped), so unvalidated draft content can never put script links on a live store.
-- Nothing changes for a store whose theme has none of these keys: the new config keys are simply empty.
-- Rollback: drop function public_sfx_store(text); alter function public_sfx_store_prechrome(text) rename to public_sfx_store;
--           drop function sfx_theme_clean_content(jsonb); alter function sfx_theme_clean_content_core(jsonb) rename to sfx_theme_clean_content;
--           drop function sfx_theme_chrome_clean(jsonb); drop function sfx_chrome_links(jsonb, int);

create or replace function sfx_chrome_links(j jsonb, maxn int) returns jsonb language plpgsql immutable set search_path = public as $$
declare out_ jsonb := '[]'::jsonb; l jsonb; lab text; hr text;
begin
  if j is null or jsonb_typeof(j) <> 'array' then return out_; end if;
  for l in select * from jsonb_array_elements(j) loop
    exit when jsonb_array_length(out_) >= maxn;
    continue when jsonb_typeof(l) <> 'object' or jsonb_typeof(l->'label') <> 'string' or jsonb_typeof(l->'href') <> 'string';
    lab := btrim(left(l->>'label', 40)); hr := btrim(l->>'href');
    continue when lab = '' or length(hr) > 600 or hr ~ '\s' or hr !~* '^(https://|/|#/)';
    out_ := out_ || jsonb_build_array(jsonb_build_object('label', lab, 'href', hr));
  end loop;
  return out_;
end $$;

create or replace function sfx_theme_chrome_clean(p jsonb) returns jsonb language plpgsql immutable set search_path = public as $$
declare out_ jsonb := '{}'::jsonb; h jsonb; f jsonb; pg jsonb; pages jsonb := '[]'::jsonb; slug text; title text; secs jsonb; seen text[] := '{}'; ah text; ann text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return out_; end if;
  if jsonb_typeof(p->'header') = 'object' then
    h := p->'header'; ann := case when jsonb_typeof(h->'announceText') = 'string' then btrim(left(h->>'announceText', 160)) else '' end;
    ah := case when jsonb_typeof(h->'announceHref') = 'string' then btrim(h->>'announceHref') else '' end;
    if ah <> '' and (length(ah) > 600 or ah ~ '\s' or ah !~* '^(https://|/|#/)') then ah := ''; end if;
    out_ := out_ || jsonb_build_object('header', jsonb_build_object('announceText', ann, 'announceHref', ah, 'links', sfx_chrome_links(h->'links', 8)));
  end if;
  if jsonb_typeof(p->'footer') = 'object' then
    f := p->'footer';
    out_ := out_ || jsonb_build_object('footer', jsonb_build_object(
      'about', case when jsonb_typeof(f->'about') = 'string' then left(f->>'about', 400) else '' end,
      'note', case when jsonb_typeof(f->'note') = 'string' then left(f->>'note', 200) else '' end,
      'links', sfx_chrome_links(f->'links', 12)));
  end if;
  if jsonb_typeof(p->'pages') = 'array' then
    for pg in select * from jsonb_array_elements(p->'pages') loop
      exit when jsonb_array_length(pages) >= 8;
      continue when jsonb_typeof(pg) <> 'object';
      title := btrim(left(coalesce(pg->>'title', ''), 60));
      slug := left(regexp_replace(lower(coalesce(nullif(pg->>'slug', ''), title)), '[^a-z0-9]+', '-', 'g'), 40);
      slug := btrim(slug, '-');
      continue when title = '' or slug = '' or slug = any(seen) or slug in ('shop', 'home', 'p', 'bag', 'checkout', 'me', 'orders', 'order', 'stores', 'about', 'faq', 'contact', 'blog', 'media', 'careers', 'policy', 'sitemap', 'collections', 'wishlist', 'page');
      seen := seen || slug;
      begin
        secs := sfx_theme_clean_content_core(jsonb_build_object('sections', coalesce(pg->'sections', '[]'::jsonb)))->'sections';
      exception when others then secs := '[]'::jsonb;
      end;
      pages := pages || jsonb_build_array(jsonb_build_object('slug', slug, 'title', title,
        'template', case when pg->>'template' in ('about', 'contact', 'faq', 'lookbook', 'blank') then pg->>'template' else 'blank' end, 'sections', coalesce(secs, '[]'::jsonb)));
    end loop;
    out_ := out_ || jsonb_build_object('pages', pages);
  end if;
  return out_;
end $$;

-- import / new-theme cleaning now keeps the cleaned header, footer and pages too
alter function sfx_theme_clean_content(jsonb) rename to sfx_theme_clean_content_core;
create function sfx_theme_clean_content(p jsonb) returns jsonb language plpgsql immutable set search_path = public as $$
begin
  return sfx_theme_clean_content_core(p) || sfx_theme_chrome_clean(p);
end $$;

-- the public store: adds config.themeHeader / themeFooter / themePages from the active theme's PUBLISHED content
alter function public_sfx_store(text) rename to public_sfx_store_prechrome;
create function public_sfx_store(p_slug text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb := public_sfx_store_prechrome(p_slug); tid uuid; st sfx_stores; c jsonb; ch jsonb;
begin
  if r is null or r->'config' is null or (r->>'closed') = 'true' then return r; end if;
  tid := sfx_public_tenant(p_slug);
  select * into st from sfx_stores where tenant_id = tid;
  select i.published_content into c from sfx_theme_installs i where i.id = st.active_install_id;
  ch := sfx_theme_chrome_clean(c);
  return jsonb_set(r, '{config}', (r->'config') || jsonb_build_object(
    'themeHeader', coalesce(ch->'header', 'null'::jsonb), 'themeFooter', coalesce(ch->'footer', 'null'::jsonb), 'themePages', coalesce(ch->'pages', '[]'::jsonb)));
end $$;
grant execute on function public_sfx_store(text) to app;
grant execute on function sfx_theme_clean_content(jsonb) to app;
