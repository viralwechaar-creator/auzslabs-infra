-- Bundles can follow product prices: price = sum of the products' prices minus a discount %.
alter table bundles
  add column if not exists auto boolean not null default false,
  add column if not exists discount_pct numeric(5,2) not null default 0;

-- Effective prices of a bundle row (monthly, list, yearly).
create or replace function bundle_effective(b bundles)
returns jsonb language sql stable security definer set search_path = public as $$
  with s as (
    select coalesce(sum(p.monthly_price), 0) as sm, coalesce(sum(p.yearly_price), 0) as sy,
           bool_and(p.yearly_price > 0) as all_y, bool_and(p.monthly_price > 0) as all_m
    from product_prices p where p.key = any(b.feature_keys))
  select case when b.auto and s.all_m then jsonb_build_object(
      'monthly_price', round(s.sm * (1 - b.discount_pct / 100)),
      'list_price', s.sm,
      'yearly_price', case when s.all_y then round(s.sy * (1 - b.discount_pct / 100)) else 0 end)
    else jsonb_build_object('monthly_price', b.monthly_price, 'list_price', b.list_price, 'yearly_price', b.yearly_price) end
  from s;
$$;

create or replace function public_bundles()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('key', b.key, 'label', b.label, 'feature_keys', to_jsonb(b.feature_keys),
      'badge', b.badge, 'blurb', b.blurb) || bundle_effective(b) order by b.sort, b.key), '[]'::jsonb)
  from bundles b where b.active;
$$;

create or replace function admin_list_bundles()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('key', b.key, 'label', b.label, 'feature_keys', to_jsonb(b.feature_keys),
      'badge', b.badge, 'blurb', b.blurb, 'active', b.active, 'sort', b.sort, 'auto', b.auto, 'discount_pct', b.discount_pct)
      || bundle_effective(b) order by b.sort, b.key), '[]'::jsonb) from bundles b);
end $$;

drop function if exists admin_save_bundle(text, text, text[], numeric, numeric, numeric, text, text, boolean);
create or replace function admin_save_bundle(p_key text, p_label text, p_feature_keys text[], p_monthly_price numeric,
  p_list_price numeric, p_yearly_price numeric, p_badge text, p_blurb text, p_active boolean,
  p_auto boolean default false, p_discount_pct numeric default 0)
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
  if coalesce(p_monthly_price, 0) < 0 or coalesce(p_list_price, 0) < 0 or coalesce(p_yearly_price, 0) < 0 then raise exception 'prices cannot be negative'; end if;
  if coalesce(p_discount_pct, 0) < 0 or coalesce(p_discount_pct, 0) > 90 then raise exception 'discount must be 0 to 90 percent'; end if;
  if not coalesce(p_auto, false) and coalesce(p_monthly_price, 0) <= 0 then raise exception 'enter a monthly price'; end if;
  if exists (select 1 from bundles where feature_keys @> fk and feature_keys <@ fk and (v_key is null or key <> v_key)) then
    raise exception 'another bundle already has exactly these products';
  end if;
  if v_key is null then
    v_key := trim(both '_' from regexp_replace(lower(btrim(p_label)), '[^a-z0-9]+', '_', 'g'));
    if v_key = '' or exists (select 1 from bundles where key = v_key) then v_key := v_key || '_' || substr(md5(random()::text), 1, 5); end if;
  end if;
  insert into bundles (key, label, feature_keys, monthly_price, list_price, yearly_price, badge, blurb, active, sort, auto, discount_pct, updated_at)
  values (v_key, btrim(p_label), fk, coalesce(p_monthly_price, 0), coalesce(p_list_price, 0), coalesce(p_yearly_price, 0),
          coalesce(p_badge, ''), coalesce(p_blurb, ''), coalesce(p_active, true),
          coalesce((select max(sort) from bundles), 0) + 10, coalesce(p_auto, false), coalesce(p_discount_pct, 0), now())
  on conflict (key) do update set label = excluded.label, feature_keys = excluded.feature_keys,
    monthly_price = excluded.monthly_price, list_price = excluded.list_price, yearly_price = excluded.yearly_price,
    badge = excluded.badge, blurb = excluded.blurb, active = excluded.active, auto = excluded.auto,
    discount_pct = excluded.discount_pct, updated_at = now();
  return v_key;
end $$;
