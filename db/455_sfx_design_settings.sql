-- Theme editor, step 4: global design settings. One list of settings that apply to the whole storefront: colours (background,
-- cards, text, accent), corner shape, button style and shape, font and spacing. Stored in content.design as { id: value };
-- a setting that is not there keeps the theme's own look. The list lives in sfx_design_settings (the editor builds its controls
-- from it and the server checks every value against it).
--
-- Rollback: restore sfx_theme_clean_content and sfx_theme_customize_save from db/454, public_sfx_store from db/453;
--   drop function sfx_theme_design_clean(jsonb); drop function sfx_design_registry(); drop table sfx_design_settings;
--   restore sfx_clean_setting from db/452.

create table if not exists sfx_design_settings (
  id text primary key check (id ~ '^[a-zA-Z][a-zA-Z0-9]{0,30}$'),
  grp text not null,
  label text not null,
  type text not null check (type in ('color', 'select')),
  options jsonb,
  def text not null default '',
  position int not null default 0
);
alter table sfx_design_settings enable row level security;

insert into sfx_design_settings (id, grp, label, type, options, def, position) values
('bg', 'Colours', 'Page background', 'color', null, '#efeeed', 10),
('card', 'Colours', 'Cards and panels', 'color', null, '#ffffff', 20),
('ink', 'Colours', 'Text and buttons', 'color', null, '#0c0c0c', 30),
('accent', 'Colours', 'Accent', 'color', null, '#800020', 40),
('radius', 'Shape', 'Corners', 'select', '[["default","Theme default"],["sharp","Sharp"],["soft","Soft"],["round","Round"]]', 'default', 50),
('buttons', 'Buttons', 'Button colour', 'select', '[["solid","Text colour"],["accent","Accent colour"],["outline","Outline"]]', 'solid', 60),
('buttonShape', 'Buttons', 'Button shape', 'select', '[["default","Theme default"],["pill","Pill"],["soft","Soft corners"],["square","Square"]]', 'default', 70),
('font', 'Text', 'Font', 'select', '[["default","Theme default"],["serif","Serif"],["humanist","Humanist"],["mono","Typewriter"]]', 'default', 80),
('spacing', 'Layout', 'Spacing', 'select', '[["compact","Compact"],["normal","Normal"],["roomy","Roomy"]]', 'normal', 90)
on conflict (id) do nothing;

-- one more setting type: color (#rrggbb)
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
  if t in ('url', 'image') and s <> '' and s !~* '^(https://|/)' then raise exception '%: links must start with https:// or /', ctx using errcode = 'SF002'; end if;
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

create or replace function sfx_design_registry() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'group', grp, 'label', label, 'type', type, 'options', options, 'default', def) order by position) from sfx_design_settings), '[]'::jsonb);
end $$;
grant execute on function sfx_design_registry() to app;

-- Cleans content.design: only known settings survive, each checked by its type.
create or replace function sfx_theme_design_clean(p jsonb) returns jsonb language plpgsql stable set search_path = public as $$
declare d jsonb := '{}'::jsonb; r sfx_design_settings; v jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' or jsonb_typeof(p->'design') <> 'object' then return '{}'::jsonb; end if;
  for r in select * from sfx_design_settings loop
    if (p->'design') ? r.id then
      v := sfx_clean_setting(jsonb_build_object('id', r.id, 'type', r.type, 'options', coalesce(r.options, '[]'::jsonb)), p->'design'->r.id, 'Design');
      if v is not null then d := d || jsonb_build_object(r.id, v); end if;
    end if;
  end loop;
  if d = '{}'::jsonb then return '{}'::jsonb; end if;
  return jsonb_build_object('design', d);
end $$;
grant execute on function sfx_theme_design_clean(jsonb) to app;

create or replace function sfx_theme_clean_content(p jsonb) returns jsonb language plpgsql stable set search_path = public as $$
begin
  return sfx_theme_clean_content_core(p) || sfx_theme_chrome_clean(p) || sfx_theme_templates_clean(p) || sfx_theme_design_clean(p);
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
    c := (c - 'sections' - 'header' - 'footer' - 'pages' - 'accent' - 'templates' - 'design') || sfx_theme_clean_content(c);
  end if;
  update sfx_theme_installs set draft_content = c where id = p_install_id and tenant_id = tid returning revision into rev;
  return jsonb_build_object('ok', true, 'revision', rev);
end $$;
grant execute on function sfx_theme_customize_save(uuid, jsonb, int) to app;

-- the public store: config.themeDesign next to config.themeTemplates (both from the active theme's PUBLISHED content)
create or replace function public_sfx_store(p_slug text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb := public_sfx_store_pretpl(p_slug); tid uuid; st sfx_stores; c jsonb; tp jsonb := '{}'::jsonb; dz jsonb := '{}'::jsonb;
begin
  if r is null or r->'config' is null or (r->>'closed') = 'true' then return r; end if;
  tid := sfx_public_tenant(p_slug);
  select * into st from sfx_stores where tenant_id = tid;
  select i.published_content into c from sfx_theme_installs i where i.id = st.active_install_id;
  begin tp := coalesce(sfx_theme_templates_clean(c)->'templates', '{}'::jsonb); exception when others then tp := '{}'::jsonb; end;
  begin dz := coalesce(sfx_theme_design_clean(c)->'design', '{}'::jsonb); exception when others then dz := '{}'::jsonb; end;
  return jsonb_set(r, '{config}', (r->'config') || jsonb_build_object('themeTemplates', tp, 'themeDesign', dz));
end $$;
grant execute on function public_sfx_store(text) to app;
