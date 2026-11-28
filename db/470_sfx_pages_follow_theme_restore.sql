-- db/468_theme_registry.sql redefined sfx_theme_install_set_active in full (create or replace), which silently
-- replaced the pages-follow-the-store wrapper added by db/467_sfx_pages_follow_theme.sql. This re-adds that
-- behaviour as ONE full definition (no rename/wrap, so it is safe to re-run and cannot be overwritten into a
-- chain): the db/468 body, plus copying custom pages from the previously live install into a newly activated
-- section-based theme that has none. Bespoke themes (th.is_bespoke_chrome, the registry's own flag instead of a
-- hardcoded slug list) are skipped. Copy errors never block going live.
-- Rollback: re-run the sfx_theme_install_set_active definition from db/468_theme_registry.sql.
create or replace function sfx_theme_install_set_active(p_install_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); i sfx_theme_installs; th sfx_themes; st sfx_stores; bespoke boolean;
  old_i sfx_theme_installs; pg jsonb;
begin
  select * into i from sfx_theme_installs where id = p_install_id and tenant_id = tid;
  if i.id is null then raise exception 'Theme install not found'; end if;
  select * into th from sfx_themes where id = i.theme_id;
  bespoke := th.is_bespoke_chrome;
  if bespoke and not sfx_theme_available(th, tid) then raise exception 'This theme is not available for your store yet' using errcode = 'SF106'; end if;
  select * into st from sfx_stores where tenant_id = tid;
  if st.active_install_id is distinct from p_install_id then
    insert into sfx_stores (tenant_id, previous_theme, previous_install_id) values (tid, coalesce(st.theme, 'minimal'), st.active_install_id)
      on conflict (tenant_id) do update set previous_theme = coalesce(sfx_stores.theme, 'minimal'), previous_install_id = sfx_stores.active_install_id;
  end if;
  if bespoke and i.published_content is null then
    update sfx_theme_installs set published_content = draft_content, published_at = now() where id = i.id;
  end if;
  -- custom pages follow the store to the new theme (only when the new theme has none of its own)
  if not bespoke and st.active_install_id is not null and st.active_install_id is distinct from p_install_id then
    begin
      select * into old_i from sfx_theme_installs where id = st.active_install_id and tenant_id = tid;
      if old_i.id is not null then
        pg := coalesce(old_i.published_content->'pages', old_i.draft_content->'pages', '[]'::jsonb);
        if jsonb_typeof(pg) = 'array' and jsonb_array_length(pg) > 0 then
          if coalesce(jsonb_array_length(case when jsonb_typeof(i.draft_content->'pages') = 'array' then i.draft_content->'pages' end), 0) = 0 then
            update sfx_theme_installs set draft_content = coalesce(draft_content, '{}'::jsonb) || jsonb_build_object('pages', pg) where id = i.id;
          end if;
          if i.published_content is not null
             and coalesce(jsonb_array_length(case when jsonb_typeof(i.published_content->'pages') = 'array' then i.published_content->'pages' end), 0) = 0 then
            update sfx_theme_installs set published_content = published_content || jsonb_build_object('pages', pg) where id = i.id;
          end if;
        end if;
      end if;
    exception when others then null;
    end;
  end if;
  insert into sfx_stores (tenant_id, active_install_id) values (tid, p_install_id)
    on conflict (tenant_id) do update set active_install_id = p_install_id, updated_at = now();
  if th.is_builtin and th.base_chrome is not null then
    update sfx_stores set theme = th.base_chrome where tenant_id = tid;
  end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function sfx_theme_install_set_active(uuid) to app;
