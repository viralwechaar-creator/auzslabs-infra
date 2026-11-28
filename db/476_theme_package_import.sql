-- Theme packages (Option A: declarative only, no custom JavaScript). A package is a JSON document
-- {format:'auzslab-theme', formatVersion:1, name, description, priceCents, content:{...}} (the browser
-- reads it from a .json file or from theme.json inside a .zip). The server validates it against rules
-- and either rejects it with every reason found, or creates a DRAFT theme + version 1 for the developer,
-- who then submits it through the normal review (sfdev_theme_submit -> admin approve).
-- Rollback: drop function sfdev_theme_import(jsonb, boolean); drop function sfdev_theme_check(jsonb);
--           drop function sfdev_theme_export(uuid);

create or replace function sfdev_theme_check(p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare errs jsonb := '[]'::jsonb; warns jsonb := '[]'::jsonb; c jsonb; k text; i int; s jsonb; reg record; nm text;
  txt text; cleaned jsonb; allowed text[] := array['sections','header','footer','pages','templates','design','groups'];
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return jsonb_build_object('ok', false, 'errors', jsonb_build_array('This is not a theme package.'), 'warnings', warns);
  end if;
  if coalesce(p->>'format', '') <> 'auzslab-theme' then errs := errs || to_jsonb('Missing or wrong "format": it must be "auzslab-theme".'::text); end if;
  if coalesce((p->>'formatVersion'), '') <> '1' then errs := errs || to_jsonb('Unsupported "formatVersion": this server reads version 1.'::text); end if;
  nm := trim(coalesce(p->>'name', ''));
  if length(nm) < 1 or length(nm) > 80 then errs := errs || to_jsonb('The theme needs a name of 1 to 80 characters.'::text); end if;
  if length(coalesce(p->>'description', '')) > 1000 then errs := errs || to_jsonb('The description is longer than 1000 characters.'::text); end if;
  if p ? 'priceCents' and (jsonb_typeof(p->'priceCents') <> 'number' or (p->>'priceCents')::numeric < 0) then errs := errs || to_jsonb('"priceCents" must be a number, 0 or more.'::text); end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('format', 'formatVersion', 'name', 'description', 'priceCents', 'previewImageUrl', 'content') then
      errs := errs || to_jsonb(('Not allowed at the top level: "' || left(k, 40) || '". Themes cannot carry scripts, code or extra files.')::text);
    end if;
  end loop;
  c := p->'content';
  if c is null or jsonb_typeof(c) <> 'object' then
    errs := errs || to_jsonb('The package has no "content" object.'::text);
    return jsonb_build_object('ok', false, 'errors', errs, 'warnings', warns);
  end if;
  txt := c::text;
  if length(txt) > 400000 then errs := errs || to_jsonb('The theme content is larger than 400 KB.'::text); end if;
  for k in select jsonb_object_keys(c) loop
    if not (k = any(allowed)) then errs := errs || to_jsonb(('Unknown content part "' || left(k, 40) || '". Allowed: sections, header, footer, pages, templates, design, groups.')::text); end if;
  end loop;
  -- no scripts, inline handlers or embedded pages anywhere in any text
  if txt ~* '<\s*(script|iframe|object|embed|style|link|meta|svg)\y' then errs := errs || to_jsonb('Scripts, frames, styles and other raw HTML tags are not allowed in a theme.'::text); end if;
  if txt ~* 'javascript\s*:|vbscript\s*:|data\s*:\s*text/html' then errs := errs || to_jsonb('"javascript:" and similar links are not allowed.'::text); end if;
  if txt ~* '\yon[a-z]{3,20}\s*=' then errs := errs || to_jsonb('Inline event handlers (like onclick=) are not allowed.'::text); end if;
  -- section list: known types, item limits
  if jsonb_typeof(c->'sections') = 'array' then
    if jsonb_array_length(c->'sections') > 30 then errs := errs || to_jsonb('A page can hold at most 30 sections.'::text); end if;
    i := 0;
    for s in select * from jsonb_array_elements(c->'sections') loop
      i := i + 1;
      select * into reg from sfx_section_types where type = s->>'type';
      if reg.type is null then errs := errs || to_jsonb(('Section ' || i || ' uses an unknown type "' || left(coalesce(s->>'type', ''), 40) || '".')::text);
      elsif jsonb_typeof(s->'blocks') = 'array' and reg.max_blocks is not null and jsonb_array_length(s->'blocks') > reg.max_blocks then
        errs := errs || to_jsonb(('Section ' || i || ' (' || reg.label || ') has more than ' || reg.max_blocks || ' items.')::text);
      end if;
    end loop;
    if jsonb_array_length(c->'sections') = 0 and coalesce(jsonb_array_length(c->'pages'), 0) = 0 then warns := warns || to_jsonb('The home page has no sections.'::text); end if;
  elsif c ? 'sections' then errs := errs || to_jsonb('"sections" must be a list.'::text);
  end if;
  -- the full server cleaner has the last word (links, colours, numbers, nesting, page addresses...)
  if jsonb_array_length(errs) = 0 then
    begin
      cleaned := sfx_theme_clean_content(c);
    exception when others then
      errs := errs || to_jsonb(('The content was refused: ' || sqlerrm)::text);
    end;
  end if;
  return jsonb_build_object('ok', jsonb_array_length(errs) = 0, 'errors', errs, 'warnings', warns,
    'stats', jsonb_build_object('sections', coalesce(jsonb_array_length(c->'sections'), 0), 'pages', coalesce(jsonb_array_length(c->'pages'), 0), 'bytes', length(txt)),
    'content', case when jsonb_array_length(errs) = 0 then cleaned else null end);
end $$;

-- dry = true: only report. dry = false: if accepted, create a draft theme with version 1.
create or replace function sfdev_theme_import(p jsonb, p_dry boolean default true) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfdev_guard(true); chk jsonb; th sfx_themes; nm text; slug_ text;
begin
  chk := sfdev_theme_check(p);
  if not (chk->>'ok')::boolean or p_dry then
    return chk - 'content';
  end if;
  nm := trim(p->>'name');
  slug_ := lower(regexp_replace(nm, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(gen_random_uuid()::text, 1, 6);
  insert into sfx_themes (developer_tenant_id, name, slug, description, preview_image_url, price_cents, status)
    values (tid, nm, slug_, coalesce(p->>'description', ''), nullif(p->>'previewImageUrl', ''),
      greatest(0, coalesce((p->>'priceCents')::int, 0)), 'draft') returning * into th;
  insert into sfx_theme_versions (theme_id, version_number, content) values (th.id, 1, chk->'content');
  return (chk - 'content') || jsonb_build_object('id', th.id, 'imported', true);
end $$;

create or replace function sfdev_theme_export(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfdev_guard(false); th sfx_themes; v sfx_theme_versions;
begin
  select * into th from sfx_themes where id = p_id and developer_tenant_id = tid;
  if th.id is null then raise exception 'Theme not found'; end if;
  select * into v from sfx_theme_versions where theme_id = p_id order by version_number desc limit 1;
  return jsonb_build_object('format', 'auzslab-theme', 'formatVersion', 1, 'name', th.name, 'description', th.description,
    'priceCents', th.price_cents, 'content', coalesce(v.content, '{}'::jsonb));
end $$;
grant execute on function sfdev_theme_check(jsonb) to app;
grant execute on function sfdev_theme_import(jsonb, boolean) to app;
grant execute on function sfdev_theme_export(uuid) to app;
