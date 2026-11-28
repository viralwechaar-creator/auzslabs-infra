-- Custom pages survive a theme change.
-- Pages live inside each theme install's content (db/399). Switching to another theme used to leave the pages behind in
-- the old install. Now, when a theme goes live and it has no pages of its own, the pages of the theme that was live are
-- copied into it (draft and published). Pages the new theme already has are never replaced. Studs / Kaarigari ignore
-- pages and are skipped. Rollback: drop function sfx_theme_install_set_active(uuid);
--   alter function sfx_theme_install_set_active_prepages(uuid) rename to sfx_theme_install_set_active;
alter function sfx_theme_install_set_active(uuid) rename to sfx_theme_install_set_active_prepages;

create function sfx_theme_install_set_active(p_install_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); old_id uuid; old_i sfx_theme_installs; new_i sfx_theme_installs; th sfx_themes;
  pg jsonb; r jsonb;
begin
  select active_install_id into old_id from sfx_stores where tenant_id = tid;
  r := sfx_theme_install_set_active_prepages(p_install_id);
  if old_id is not null and old_id is distinct from p_install_id then
    begin
      select * into old_i from sfx_theme_installs where id = old_id and tenant_id = tid;
      select * into new_i from sfx_theme_installs where id = p_install_id and tenant_id = tid;
      select * into th from sfx_themes where id = new_i.theme_id;
      if old_i.id is not null and new_i.id is not null and coalesce(th.base_chrome, '') not in ('studs', 'kaarigari') then
        pg := coalesce(old_i.published_content->'pages', old_i.draft_content->'pages', '[]'::jsonb);
        if jsonb_typeof(pg) = 'array' and jsonb_array_length(pg) > 0 then
          update sfx_theme_installs set
            draft_content = case when jsonb_array_length(coalesce(draft_content->'pages', '[]'::jsonb)) = 0
              then coalesce(draft_content, '{}'::jsonb) || jsonb_build_object('pages', pg) else draft_content end,
            published_content = case when published_content is not null and jsonb_array_length(coalesce(published_content->'pages', '[]'::jsonb)) = 0
              then published_content || jsonb_build_object('pages', pg) else published_content end
          where id = p_install_id and tenant_id = tid;
        end if;
      end if;
    exception when others then null; -- never block going live
    end;
  end if;
  return r;
end $$;
