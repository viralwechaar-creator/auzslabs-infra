-- Theme editor, step 3: a revision number on every theme draft, and a check on save.
-- Every time a draft changes (editor save, version restore, Studs settings) its revision goes up by one. The editor sends the
-- revision it loaded; if someone else saved in between, the save is refused (SF004) instead of silently overwriting their work.
-- A save without a revision (older clients) works as before.
--
-- Rollback: drop trigger sfx_theme_rev on sfx_theme_installs; drop function sfx_theme_rev_trg();
--   drop function sfx_theme_customize_save(uuid, jsonb, int); recreate the 2-argument function from db/453;
--   restore sfx_theme_install_list from db/395; alter table sfx_theme_installs drop column revision;

alter table sfx_theme_installs add column if not exists revision int not null default 0;

create or replace function sfx_theme_rev_trg() returns trigger language plpgsql as $$
begin
  if new.draft_content is distinct from old.draft_content then new.revision := old.revision + 1; end if;
  return new;
end $$;
drop trigger if exists sfx_theme_rev on sfx_theme_installs;
create trigger sfx_theme_rev before update of draft_content on sfx_theme_installs for each row execute function sfx_theme_rev_trg();

create or replace function sfx_theme_install_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', i.id, 'themeId', i.theme_id, 'themeName', coalesce(i.name, th.name), 'isBuiltin', th.is_builtin, 'custom', i.custom,
    'draftContent', i.draft_content, 'publishedContent', i.published_content, 'revision', i.revision,
    'published', i.published_content is not null, 'active', st.active_install_id = i.id, 'installedAt', i.installed_at
  ) order by i.installed_at desc) from sfx_theme_installs i join sfx_themes th on th.id = i.theme_id
    left join sfx_stores st on st.tenant_id = tid where i.tenant_id = tid), '[]'::jsonb);
end $$;
grant execute on function sfx_theme_install_list() to app;

drop function if exists sfx_theme_customize_save(uuid, jsonb);
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
    c := (c - 'sections' - 'header' - 'footer' - 'pages' - 'accent' - 'templates') || sfx_theme_clean_content(c);
  end if;
  update sfx_theme_installs set draft_content = c where id = p_install_id and tenant_id = tid returning revision into rev;
  return jsonb_build_object('ok', true, 'revision', rev);
end $$;
grant execute on function sfx_theme_customize_save(uuid, jsonb, int) to app;
