-- Round 4 (storefront gaps): shipping zones. config.shipping.zones = [{name, states[], fee, freeOver}].
-- The customer's state picks a zone; no match (or no zones) = the existing flat fee, so every current store behaves as before.
-- Rollback: re-create sfx_orders_apply_shipping and sfx_checkout_settings_save from db/379 (zones are then ignored; stored zones stay harmless).
create or replace function sfx_checkout_settings_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); cur jsonb; fee_ numeric; free_ numeric; zs jsonb := '[]'::jsonb; z jsonb; zf numeric; zfo numeric; sts jsonb;
begin
  fee_ := coalesce(nullif(p->'shipping'->>'fee', '')::numeric, 0); free_ := coalesce(nullif(p->'shipping'->>'freeOver', '')::numeric, 0);
  if fee_ < 0 or fee_ > 100000 then raise exception 'Enter a shipping fee between 0 and 100000' using errcode = 'SF002'; end if;
  if free_ < 0 then raise exception 'Free-shipping amount cannot be negative' using errcode = 'SF002'; end if;
  if jsonb_typeof(p->'shipping'->'zones') = 'array' then
    if jsonb_array_length(p->'shipping'->'zones') > 12 then raise exception 'Up to 12 shipping zones' using errcode = 'SF002'; end if;
    for z in select * from jsonb_array_elements(p->'shipping'->'zones') loop
      zf := coalesce(nullif(z->>'fee', '')::numeric, 0); zfo := coalesce(nullif(z->>'freeOver', '')::numeric, 0);
      if zf < 0 or zf > 100000 or zfo < 0 then raise exception 'Check the fee and free-shipping amount of zone %', coalesce(z->>'name', '') using errcode = 'SF002'; end if;
      select coalesce(jsonb_agg(distinct left(trim(x), 60)), '[]'::jsonb) into sts from jsonb_array_elements_text(case when jsonb_typeof(z->'states') = 'array' then z->'states' else '[]'::jsonb end) x where trim(x) <> '';
      if jsonb_array_length(sts) = 0 or jsonb_array_length(sts) > 40 then raise exception 'Each zone needs 1 to 40 states' using errcode = 'SF002'; end if;
      if length(trim(coalesce(z->>'name', ''))) = 0 then raise exception 'Give each zone a name' using errcode = 'SF002'; end if;
      zs := zs || jsonb_build_array(jsonb_build_object('name', left(trim(z->>'name'), 60), 'states', sts, 'fee', zf, 'freeOver', zfo));
    end loop;
  end if;
  select config into cur from sfx_stores where tenant_id = tid;
  cur := coalesce(cur, '{}'::jsonb) || jsonb_build_object(
    'shipping', jsonb_build_object('fee', fee_, 'freeOver', free_, 'note', left(coalesce(p->'shipping'->>'note', ''), 300), 'zones', zs),
    'abandonCapture', coalesce((p->>'abandonCapture')::boolean, false));
  insert into sfx_stores (tenant_id, config) values (tid, cur) on conflict (tenant_id) do update set config = excluded.config, updated_at = now();
  return sfx_checkout_settings_get();
end $$;

create or replace function sfx_orders_apply_shipping() returns trigger language plpgsql security definer set search_path = public as $$
declare c jsonb; fee_ numeric; free_ numeric; z jsonb; st text := lower(trim(coalesce(new.customer->>'state', '')));
begin
  if new.shipping is distinct from 0 then return new; end if;
  select config->'shipping' into c from sfx_stores where tenant_id = new.tenant_id;
  fee_ := coalesce(nullif(c->>'fee', '')::numeric, 0); free_ := coalesce(nullif(c->>'freeOver', '')::numeric, 0);
  if st <> '' and jsonb_typeof(c->'zones') = 'array' then
    select e into z from jsonb_array_elements(c->'zones') e where exists (select 1 from jsonb_array_elements_text(e->'states') s where lower(trim(s)) = st) limit 1;
    if z is not null then fee_ := coalesce(nullif(z->>'fee', '')::numeric, 0); free_ := coalesce(nullif(z->>'freeOver', '')::numeric, 0); end if;
  end if;
  if fee_ > 0 and not (free_ > 0 and (new.subtotal - coalesce(new.discount_amount, 0)) >= free_) then
    new.shipping := fee_; new.total := new.total + fee_;
  end if;
  return new;
end $$;
