-- Let a merchant remove any theme they're not using, not just a custom draft they made themselves.
-- sfx_theme_install_delete (db/395) used to refuse anything but `i.custom` ("Marketplace themes stay
-- installed") -- a deliberate rule at the time, but the owner asked for a real "uninstall" action on
-- any installed theme. The "can't remove what's live on your store" guard is unchanged.
create or replace function sfx_theme_install_delete(p_install_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); i sfx_theme_installs;
begin
  select * into i from sfx_theme_installs where id = p_install_id and tenant_id = tid;
  if i.id is null then raise exception 'Theme not found' using errcode = 'SF003'; end if;
  if exists (select 1 from sfx_stores where tenant_id = tid and active_install_id = i.id) then raise exception 'This theme is live on your store. Make another theme active first.' using errcode = 'SF002'; end if;
  delete from sfx_theme_installs where id = i.id;
end $$;
