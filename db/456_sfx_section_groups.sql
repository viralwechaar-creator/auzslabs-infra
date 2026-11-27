-- Theme editor, step 5: shared header and footer section groups. content.groups = { header: { sections }, footer: { sections } }:
-- ordered lists of sections shown on EVERY page, the header group at the top of the page and the footer group at the bottom
-- (the store's own menu bar and footer stay as they are, and keep their own settings under header / footer). Up to 8 sections per
-- group, each checked by the section registry. Also adds a "Link row" section (a row of links) that suits both groups.
--
-- Rollback: restore sfx_theme_clean_content and sfx_theme_customize_save from db/455, public_sfx_store from db/455;
--   drop function sfx_theme_groups_clean(jsonb); delete from sfx_section_types where type = 'links';

insert into sfx_section_types (type, label, description, position, settings, block_types, max_blocks, layout) values
('links', 'Link row', 'A row of links, for example Shipping, Returns, Contact.', 120,
  '[{"id":"heading","type":"text","label":"Heading (optional)"}]',
  '[{"type":"link","label":"Link","settings":[{"id":"label","type":"text","label":"Text"},{"id":"href","type":"url","label":"Link"}]}]', 12, true)
on conflict (type) do nothing;

create or replace function sfx_theme_groups_clean(p jsonb) returns jsonb language plpgsql stable set search_path = public as $$
declare grp jsonb := '{}'::jsonb; k text; g jsonb; secs jsonb; s jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' or jsonb_typeof(p->'groups') <> 'object' then return '{}'::jsonb; end if;
  foreach k in array array['header', 'footer'] loop
    g := p->'groups'->k;
    continue when g is null or jsonb_typeof(g) <> 'object' or jsonb_typeof(g->'sections') <> 'array';
    if jsonb_array_length(g->'sections') > 8 then raise exception 'A shared % can have up to 8 sections', k using errcode = 'SF002'; end if;
    secs := '[]'::jsonb;
    for s in select * from jsonb_array_elements(g->'sections') loop
      secs := secs || jsonb_build_array(sfx_theme_clean_content_core(jsonb_build_object('sections', jsonb_build_array(s)))->'sections'->0);
    end loop;
    if jsonb_array_length(secs) > 0 then grp := grp || jsonb_build_object(k, jsonb_build_object('sections', secs)); end if;
  end loop;
  if grp = '{}'::jsonb then return '{}'::jsonb; end if;
  return jsonb_build_object('groups', grp);
end $$;
grant execute on function sfx_theme_groups_clean(jsonb) to app;

create or replace function sfx_theme_clean_content(p jsonb) returns jsonb language plpgsql stable set search_path = public as $$
begin
  return sfx_theme_clean_content_core(p) || sfx_theme_chrome_clean(p) || sfx_theme_templates_clean(p) || sfx_theme_design_clean(p) || sfx_theme_groups_clean(p);
end $$;
grant execute on function sfx_theme_clean_content(jsonb) to app;

create or replace function sfx_theme_customize_save(p_install_id uuid, p_content jsonb, p_expected int default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); c jsonb := coalesce(p_content, '{}'::jsonb); cur int; rev int;
begin
  if jsonb_typeof(c) <> 'object' then raise exception 'The theme content must be an object' using errcode = 'SF002'; end if;
  select revision into cur from sfx_theme_installs where id = p_install_id and tenant_id = tid for update;
  if not found then raise exception 'Theme install not found'; end if;
  if p_expected is not null and p_expected <> cur then
    raise exception 'This design was changed by someone else since you opened it.' using errcode = 'SF004';
  end if;
  if c->>'kind' is distinct from 'studs' then
    c := (c - 'sections' - 'header' - 'footer' - 'pages' - 'accent' - 'templates' - 'design' - 'groups') || sfx_theme_clean_content(c);
  end if;
  update sfx_theme_installs set draft_content = c where id = p_install_id and tenant_id = tid returning revision into rev;
  return jsonb_build_object('ok', true, 'revision', rev);
end $$;
grant execute on function sfx_theme_customize_save(uuid, jsonb, int) to app;

create or replace function public_sfx_store(p_slug text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb := public_sfx_store_pretpl(p_slug); tid uuid; st sfx_stores; c jsonb; tp jsonb := '{}'::jsonb; dz jsonb := '{}'::jsonb; gp jsonb := '{}'::jsonb;
begin
  if r is null or r->'config' is null or (r->>'closed') = 'true' then return r; end if;
  tid := sfx_public_tenant(p_slug);
  select * into st from sfx_stores where tenant_id = tid;
  select i.published_content into c from sfx_theme_installs i where i.id = st.active_install_id;
  begin tp := coalesce(sfx_theme_templates_clean(c)->'templates', '{}'::jsonb); exception when others then tp := '{}'::jsonb; end;
  begin dz := coalesce(sfx_theme_design_clean(c)->'design', '{}'::jsonb); exception when others then dz := '{}'::jsonb; end;
  begin gp := coalesce(sfx_theme_groups_clean(c)->'groups', '{}'::jsonb); exception when others then gp := '{}'::jsonb; end;
  return jsonb_set(r, '{config}', (r->'config') || jsonb_build_object('themeTemplates', tp, 'themeDesign', dz, 'themeGroups', gp));
end $$;
grant execute on function public_sfx_store(text) to app;
