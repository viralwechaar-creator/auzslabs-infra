-- Admin-managed bundles (create / edit / delete), a list ("total") price + discount display, and a
-- whole-year price per bundle; yearly price/renewal editable per product; add-on price editable.
alter table bundles
  add column if not exists list_price   numeric(10,2) not null default 0,  -- price if bought separately (struck through); 0 = show nothing
  add column if not exists yearly_price numeric(10,2) not null default 0,  -- whole-year price; 0 = no yearly option
  add column if not exists badge        text not null default '',
  add column if not exists blurb        text not null default '',
  add column if not exists active       boolean not null default true,
  add column if not exists sort         int not null default 100;

update bundles set sort = case key when 'starter' then 10 when 'growing' then 20 when 'complete' then 30 when 'complete_qr' then 40 else sort end,
  list_price = case key when 'complete' then 3997 when 'complete_qr' then 4297 else list_price end,
  badge = case key when 'starter' then 'Starter business' when 'growing' then 'Growing business' when 'complete' then 'Most popular' when 'complete_qr' then 'Complete QR business' else badge end
 where badge = '';

create or replace function public_bundles()
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', key, 'label', label, 'feature_keys', to_jsonb(feature_keys),
      'monthly_price', monthly_price, 'list_price', list_price, 'yearly_price', yearly_price,
      'badge', badge, 'blurb', blurb) order by sort, key), '[]'::jsonb)
  from bundles where active;
$$;

create or replace function admin_list_bundles()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('key', key, 'label', label, 'feature_keys', to_jsonb(feature_keys),
      'monthly_price', monthly_price, 'list_price', list_price, 'yearly_price', yearly_price,
      'badge', badge, 'blurb', blurb, 'active', active, 'sort', sort) order by sort, key), '[]'::jsonb) from bundles);
end $$;

create or replace function admin_save_bundle(p_key text, p_label text, p_feature_keys text[], p_monthly_price numeric,
  p_list_price numeric, p_yearly_price numeric, p_badge text, p_blurb text, p_active boolean)
returns text language plpgsql security definer set search_path = public as $$
declare k text; fk text[]; v_key text := nullif(btrim(coalesce(p_key, '')), '');
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  if nullif(btrim(coalesce(p_label, '')), '') is null then raise exception 'give the bundle a name'; end if;
  select array_agg(distinct x order by x) into fk from unnest(coalesce(p_feature_keys, '{}')) x;
  if coalesce(array_length(fk, 1), 0) < 2 then raise exception 'a bundle needs at least two products'; end if;
  foreach k in array fk loop
    if not exists (select 1 from product_prices where key = k) then raise exception 'unknown product: %', k; end if;
  end loop;
  if coalesce(p_monthly_price, -1) < 0 or coalesce(p_list_price, 0) < 0 or coalesce(p_yearly_price, 0) < 0 then
    raise exception 'prices cannot be negative';
  end if;
  if exists (select 1 from bundles where feature_keys @> fk and feature_keys <@ fk and (v_key is null or key <> v_key)) then
    raise exception 'another bundle already has exactly these products';
  end if;
  if v_key is null then
    v_key := regexp_replace(lower(btrim(p_label)), '[^a-z0-9]+', '_', 'g');
    v_key := trim(both '_' from v_key);
    if v_key = '' or exists (select 1 from bundles where key = v_key) then v_key := v_key || '_' || substr(md5(random()::text), 1, 5); end if;
  end if;
  insert into bundles (key, label, feature_keys, monthly_price, list_price, yearly_price, badge, blurb, active, sort, updated_at)
  values (v_key, btrim(p_label), fk, p_monthly_price, coalesce(p_list_price, 0), coalesce(p_yearly_price, 0),
          coalesce(p_badge, ''), coalesce(p_blurb, ''), coalesce(p_active, true),
          coalesce((select max(sort) from bundles), 0) + 10, now())
  on conflict (key) do update set label = excluded.label, feature_keys = excluded.feature_keys,
    monthly_price = excluded.monthly_price, list_price = excluded.list_price, yearly_price = excluded.yearly_price,
    badge = excluded.badge, blurb = excluded.blurb, active = excluded.active, updated_at = now();
  return v_key;
end $$;

create or replace function admin_delete_bundle(p_key text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  delete from bundles where key = p_key;
  if not found then raise exception 'unknown bundle'; end if;
end $$;

create or replace function admin_set_product_yearly(p_key text, p_yearly_price numeric, p_renewal_yearly_price numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  if coalesce(p_yearly_price, 0) < 0 or coalesce(p_renewal_yearly_price, 0) < 0 then raise exception 'prices cannot be negative'; end if;
  update product_prices set yearly_price = coalesce(p_yearly_price, 0), renewal_yearly_price = coalesce(p_renewal_yearly_price, 0), updated_at = now() where key = p_key;
  if not found then raise exception 'unknown product key: %', p_key; end if;
end $$;

create or replace function admin_set_addon_price(p_key text, p_requires text, p_monthly_price numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  if coalesce(p_monthly_price, -1) < 0 then raise exception 'price cannot be negative'; end if;
  update addon_price_overrides set monthly_price = p_monthly_price where key = p_key and requires = p_requires;
  if not found then raise exception 'unknown add-on price'; end if;
end $$;

grant select, insert, update, delete on bundles to app;
