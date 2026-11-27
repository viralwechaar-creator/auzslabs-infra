-- The shared demo business can install every theme for free (so visitors can try them all). Real shops are unchanged.
-- Rollback: drop function sfx_theme_install(uuid), sfx_theme_marketplace_list(); alter function sfx_theme_install_pre441(uuid) rename to sfx_theme_install;
--           alter function sfx_theme_marketplace_list_pre441() rename to sfx_theme_marketplace_list;
alter function sfx_theme_install(uuid) rename to sfx_theme_install_pre441;
create function sfx_theme_install(p_theme_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage');
begin
  if exists (select 1 from tenants where id = tid and is_demo) then
    if not exists (select 1 from sfx_themes th where th.id = p_theme_id and sfx_theme_available(th, tid)) then raise exception 'That theme is not available' using errcode = 'SF107'; end if;
    return jsonb_build_object('installId', sfx_theme_do_install(tid, p_theme_id), 'alreadyInstalled', false);
  end if;
  return sfx_theme_install_pre441(p_theme_id);
end $$;
grant execute on function sfx_theme_install(uuid) to app;

alter function sfx_theme_marketplace_list() rename to sfx_theme_marketplace_list_pre441;
create function sfx_theme_marketplace_list() returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view'); r jsonb;
begin
  r := sfx_theme_marketplace_list_pre441();
  if exists (select 1 from tenants where id = tid and is_demo) then
    select coalesce(jsonb_agg(e || '{"priceCents":0}'::jsonb), '[]'::jsonb) into r from jsonb_array_elements(r) e;
  end if;
  return r;
end $$;
grant execute on function sfx_theme_marketplace_list() to app;
