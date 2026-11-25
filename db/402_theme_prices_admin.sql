-- The platform admin sets the price of any storefront theme. Store owners read price_cents live from sfx_themes
-- (sfx_theme_marketplace_list), so a saved price shows in every storefront's theme library on its next load.
-- Rollback: drop function sfx_admin_theme_price_set(uuid, int); drop function sfx_theme_install(uuid); alter function sfx_theme_install_pre402(uuid) rename to sfx_theme_install;
create or replace function sfx_admin_theme_price_set(p_theme_id uuid, p_price_cents int) returns jsonb language plpgsql security definer set search_path = public as $$
declare th sfx_themes;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  if p_price_cents is null or p_price_cents < 0 or p_price_cents > 100000000 then raise exception 'Enter a price between 0 and 10,00,000 rupees'; end if;
  update sfx_themes set price_cents = p_price_cents, updated_at = now() where id = p_theme_id returning * into th;
  if th.id is null then raise exception 'Theme not found'; end if;
  perform admin_log('theme_price', 'sfx_themes', th.id::text, jsonb_build_object('name', th.name, 'priceCents', p_price_cents));
  return jsonb_build_object('ok', true, 'priceCents', th.price_cents);
end $$;
grant execute on function sfx_admin_theme_price_set(uuid, int) to app;

-- a paid theme explains itself instead of failing with a bare technical message
alter function sfx_theme_install(uuid) rename to sfx_theme_install_pre402;
create function sfx_theme_install(p_theme_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare price int;
begin
  begin
    return sfx_theme_install_pre402(p_theme_id);
  exception when sqlstate 'SF107' then
    select price_cents into price from sfx_themes where id = p_theme_id;
    raise exception 'This is a premium theme (Rs %). Checkout for premium themes is being switched on, so it is not installable yet. Please contact AUZslab to unlock it for your store.', to_char(coalesce(price, 0) / 100.0, 'FM99,99,999.00') using errcode = 'SF107';
  end;
end $$;
grant execute on function sfx_theme_install(uuid) to app;
