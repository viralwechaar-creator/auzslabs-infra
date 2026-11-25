-- Theme install: only a PAID purchase unlocks a later reinstall (a theme that was free when installed does not stay free after the admin
-- sets a price), and the premium message now tells the owner to buy it (checkout is live since db/405).
-- Rollback: recreate sfx_theme_install from db/405.
create or replace function sfx_theme_install(p_theme_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); iid uuid; price int;
begin
  if exists (select 1 from sfx_theme_purchases where tenant_id = tid and theme_id = p_theme_id and price_cents > 0) then
    iid := sfx_theme_do_install(tid, p_theme_id);
    return jsonb_build_object('installId', iid, 'alreadyInstalled', false);
  end if;
  begin
    return sfx_theme_install_pre405(p_theme_id);
  exception when sqlstate 'SF107' then
    select price_cents into price from sfx_themes where id = p_theme_id;
    raise exception 'This is a premium theme (Rs %). Use Buy in the theme library to unlock it for your store.', to_char(coalesce(price, 0) / 100.0, 'FM99,99,999.00') using errcode = 'SF107';
  end;
end $$;
