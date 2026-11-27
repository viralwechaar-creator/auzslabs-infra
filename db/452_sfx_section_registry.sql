-- Theme editor, step 1: a section schema registry (one definition per section type) that the server uses to
-- validate theme content and the editor uses to build its controls, plus blocks (child items inside a section)
-- and five new section types. Existing sections (hero, text, image, button, announcement, booking) keep their
-- exact keys, so every saved theme, draft and history entry still loads.
--
-- A section is { id, type, props, blocks? }. A block is { id, type, props }. Order is the array order; ids are stable.
-- Setting types: text, textarea, url, image (link to a picture), select, number, collection (id of a collection).
-- Also: sfx_theme_customize_save now cleans the content through this registry (before, a draft was stored as sent).
--
-- Rollback:
--   create or replace function sfx_theme_customize_save(...) as in db/375; drop function sfx_section_registry();
--   restore sfx_theme_clean_content_core from db/414; drop function sfx_clean_setting(jsonb, jsonb, text); drop table sfx_section_types;

create table if not exists sfx_section_types (
  type text primary key check (type ~ '^[a-z][a-z0-9_]{1,40}$'),
  label text not null,
  description text not null default '',
  position int not null default 0,
  settings jsonb not null default '[]'::jsonb,
  block_types jsonb,
  max_blocks int not null default 12 check (max_blocks between 1 and 40),
  layout boolean not null default true,
  created_at timestamptz not null default now()
);
alter table sfx_section_types enable row level security;

insert into sfx_section_types (type, label, description, position, settings, block_types, max_blocks, layout) values
('hero', 'Hero banner', 'A big heading with a short line and one button.', 10,
  '[{"id":"heading","type":"text","label":"Heading"},{"id":"sub","type":"textarea","label":"Subtext"},{"id":"cta","type":"text","label":"Button text"},{"id":"href","type":"url","label":"Button link"}]', null, 12, true),
('text', 'Text block', 'A heading and a paragraph.', 20,
  '[{"id":"heading","type":"text","label":"Heading"},{"id":"body","type":"textarea","label":"Body"}]', null, 12, true),
('image', 'Image', 'One picture with an optional caption.', 30,
  '[{"id":"url","type":"image","label":"Image address"},{"id":"caption","type":"text","label":"Caption"}]', null, 12, true),
('button', 'Button', 'A single button.', 40,
  '[{"id":"text","type":"text","label":"Button text"},{"id":"href","type":"url","label":"Button link"}]', null, 12, true),
('announcement', 'Announcement bar', 'A thin bar with one message.', 50,
  '[{"id":"text","type":"text","label":"Announcement text"}]', null, 12, false),
('booking', 'Appointment booking', 'A real booking form using your own services.', 60,
  '[{"id":"heading","type":"text","label":"Heading"},{"id":"note","type":"textarea","label":"Note"}]', null, 12, false),
('featured_collection', 'Featured collection', 'Products from one collection in a grid.', 70,
  '[{"id":"heading","type":"text","label":"Heading"},{"id":"collection","type":"collection","label":"Collection"},
    {"id":"count","type":"select","label":"Products to show","options":[["4","4"],["6","6"],["8","8"],["12","12"]],"default":"4"},
    {"id":"columns","type":"select","label":"Columns on a computer","options":[["2","2"],["3","3"],["4","4"]],"default":"4"},
    {"id":"button","type":"text","label":"Button text (links to the collection)"}]', null, 12, true),
('image_text', 'Image with text', 'A picture beside a heading, text and a button.', 80,
  '[{"id":"image","type":"image","label":"Image address"},{"id":"heading","type":"text","label":"Heading"},{"id":"body","type":"textarea","label":"Text"},
    {"id":"button","type":"text","label":"Button text"},{"id":"href","type":"url","label":"Button link"},
    {"id":"layout","type":"select","label":"Picture position","options":[["left","Left"],["right","Right"]],"default":"left"}]', null, 12, true),
('faq', 'Questions and answers', 'A list of questions that open to show the answer.', 90,
  '[{"id":"heading","type":"text","label":"Heading"}]',
  '[{"type":"question","label":"Question","settings":[{"id":"question","type":"text","label":"Question"},{"id":"answer","type":"textarea","label":"Answer"}]}]', 12, true),
('columns', 'Columns', 'Up to four short columns, each with a title, text and link.', 100,
  '[{"id":"heading","type":"text","label":"Heading"}]',
  '[{"type":"column","label":"Column","settings":[{"id":"title","type":"text","label":"Title"},{"id":"text","type":"textarea","label":"Text"},{"id":"link_text","type":"text","label":"Link text"},{"id":"href","type":"url","label":"Link"}]}]', 4, true),
('gallery', 'Picture gallery', 'A grid of pictures, each can link somewhere.', 110,
  '[{"id":"heading","type":"text","label":"Heading"}]',
  '[{"type":"picture","label":"Picture","settings":[{"id":"image","type":"image","label":"Image address"},{"id":"caption","type":"text","label":"Caption"},{"id":"href","type":"url","label":"Link (optional)"}]}]', 12, true)
on conflict (type) do nothing;

-- Cleans one setting value. Returns null when the value should be dropped. Raises (SF002) for a value of the wrong kind.
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
  lim := case t when 'text' then 500 when 'textarea' then 4000 when 'collection' then 80 else 2000 end;
  if length(s) > lim then raise exception '%: % is too long', ctx, id using errcode = 'SF002'; end if;
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

-- Cleans a theme's accent and sections against the registry (replaces the fixed list from db/395 and db/414).
create or replace function sfx_theme_clean_content_core(p jsonb) returns jsonb language plpgsql stable set search_path = public as $$
declare out_ jsonb := '{}'::jsonb; secs jsonb := '[]'::jsonb; s jsonb; t text; ty sfx_section_types; props jsonb; clean jsonb; def jsonb; v jsonb;
  n int := 0; b jsonb; bn int; bt jsonb; bdef jsonb; blks jsonb; bclean jsonb; sp text; al text; sec jsonb; ctx text; btype text; hit boolean;
begin
  if p is null or jsonb_typeof(p) <> 'object' then raise exception 'The theme content must be an object' using errcode = 'SF002'; end if;
  if p ? 'accent' then
    if coalesce(p->>'accent', '') !~ '^#[0-9a-fA-F]{6}$' then raise exception 'accent must be a colour like #800020' using errcode = 'SF002'; end if;
    out_ := out_ || jsonb_build_object('accent', p->>'accent');
  end if;
  if jsonb_typeof(coalesce(p->'sections', '[]'::jsonb)) <> 'array' then raise exception 'sections must be a list' using errcode = 'SF002'; end if;
  if jsonb_array_length(coalesce(p->'sections', '[]'::jsonb)) > 30 then raise exception 'A theme can have up to 30 sections' using errcode = 'SF002'; end if;
  for s in select * from jsonb_array_elements(coalesce(p->'sections', '[]'::jsonb)) loop
    n := n + 1; t := s->>'type'; ctx := 'Section ' || n;
    select * into ty from sfx_section_types where type = t;
    if ty.type is null then raise exception 'Section % has an unknown type', n using errcode = 'SF002'; end if;
    props := coalesce(s->'props', '{}'::jsonb);
    if jsonb_typeof(props) <> 'object' then raise exception 'Section % props must be an object', n using errcode = 'SF002'; end if;
    clean := '{}'::jsonb;
    for def in select * from jsonb_array_elements(ty.settings) loop
      if props ? (def->>'id') then
        v := sfx_clean_setting(def, props->(def->>'id'), ctx);
        if v is not null then clean := clean || jsonb_build_object(def->>'id', v); end if;
      end if;
    end loop;
    sp := case when jsonb_typeof(props->'space') = 'string' then props->>'space' end; al := case when jsonb_typeof(props->'align') = 'string' then props->>'align' end;
    if sp in ('compact', 'normal', 'roomy') then clean := clean || jsonb_build_object('space', sp); end if;
    if al in ('left', 'center') then clean := clean || jsonb_build_object('align', al); end if;
    sec := jsonb_build_object('id', left(coalesce(nullif(regexp_replace(coalesce(s->>'id', ''), '[^-_a-zA-Z0-9]', '', 'g'), ''), 's' || n || substr(md5(random()::text), 1, 4)), 40), 'type', t, 'props', clean);
    if ty.block_types is not null and jsonb_typeof(s->'blocks') = 'array' then
      if jsonb_array_length(s->'blocks') > ty.max_blocks then raise exception 'Section %: up to % items', n, ty.max_blocks using errcode = 'SF002'; end if;
      blks := '[]'::jsonb; bn := 0;
      for b in select * from jsonb_array_elements(s->'blocks') loop
        bn := bn + 1; btype := b->>'type'; bdef := null; hit := false;
        for bt in select * from jsonb_array_elements(ty.block_types) loop
          if bt->>'type' = btype then bdef := bt; hit := true; end if;
        end loop;
        if not hit then raise exception 'Section %, item %: unknown item type', n, bn using errcode = 'SF002'; end if;
        bclean := '{}'::jsonb;
        for def in select * from jsonb_array_elements(bdef->'settings') loop
          if jsonb_typeof(b->'props') = 'object' and (b->'props') ? (def->>'id') then
            v := sfx_clean_setting(def, b->'props'->(def->>'id'), ctx || ', item ' || bn);
            if v is not null then bclean := bclean || jsonb_build_object(def->>'id', v); end if;
          end if;
        end loop;
        blks := blks || jsonb_build_array(jsonb_build_object('id', left(coalesce(nullif(regexp_replace(coalesce(b->>'id', ''), '[^-_a-zA-Z0-9]', '', 'g'), ''), 'b' || bn || substr(md5(random()::text), 1, 4)), 40), 'type', btype, 'props', bclean));
      end loop;
      if jsonb_array_length(blks) > 0 then sec := sec || jsonb_build_object('blocks', blks); end if;
    end if;
    secs := secs || jsonb_build_array(sec);
  end loop;
  return out_ || jsonb_build_object('sections', secs);
end $$;
grant execute on function sfx_theme_clean_content_core(jsonb) to app;
grant execute on function sfx_clean_setting(jsonb, jsonb, text) to app;
alter function sfx_theme_clean_content(jsonb) stable;

-- The registry for the editor (labels, settings, item types).
create or replace function sfx_section_registry() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('type', type, 'label', label, 'description', description, 'settings', settings,
    'blockTypes', block_types, 'maxBlocks', max_blocks, 'layout', layout) order by position) from sfx_section_types), '[]'::jsonb);
end $$;
grant execute on function sfx_section_registry() to app;

-- A draft is now checked and cleaned on save. A Studs draft (settings, not sections) and keys we do not own are kept as sent.
create or replace function sfx_theme_customize_save(p_install_id uuid, p_content jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); c jsonb := coalesce(p_content, '{}'::jsonb);
begin
  if jsonb_typeof(c) <> 'object' then raise exception 'The theme content must be an object' using errcode = 'SF002'; end if;
  if c->>'kind' is distinct from 'studs' then
    c := (c - 'sections' - 'header' - 'footer' - 'pages' - 'accent') || sfx_theme_clean_content(c);
  end if;
  update sfx_theme_installs set draft_content = c where id = p_install_id and tenant_id = tid;
  if not found then raise exception 'Theme install not found'; end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function sfx_theme_customize_save(uuid, jsonb) to app;
