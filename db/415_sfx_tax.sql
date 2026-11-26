-- Round 6 (storefront gaps): GST on storefront orders.
-- config.tax = { rate (0-28, 0 = off), inclusive (default true: prices already include tax), gstin, label }.
-- With rate 0 (every store today) nothing changes. Tax applies to goods after discount, not to shipping.
--   inclusive: tax is the part of the price that is tax; the total does not change.
--   exclusive: tax is added on top of the total.
-- Rollback: drop trigger sfx_orders_tax on sfx_orders; drop function sfx_orders_apply_tax(); drop function sfx_tax_settings_save(jsonb);
--   drop function sfx_checkout_settings_get(); alter function sfx_checkout_settings_get_pretax() rename to sfx_checkout_settings_get;
--   re-run sfx_order_json from db/377 and public_sfx_order from db/377; drop function public_sfx_store(text); alter function public_sfx_store_pretax(text) rename to public_sfx_store; alter table sfx_orders drop column tax.
alter table sfx_orders add column if not exists tax numeric(12,2) not null default 0;

create function sfx_tax_settings_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); cur jsonb; r numeric := coalesce(nullif(p->>'rate', '')::numeric, 0); g text := upper(trim(coalesce(p->>'gstin', '')));
begin
  if r < 0 or r > 28 then raise exception 'Enter a tax rate between 0 and 28' using errcode = 'SF002'; end if;
  if g <> '' and g !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' then raise exception 'That GST number does not look right (15 characters, like 08ABCDE1234F1Z5)' using errcode = 'SF002'; end if;
  select config into cur from sfx_stores where tenant_id = tid;
  cur := coalesce(cur, '{}'::jsonb) || jsonb_build_object('tax', jsonb_build_object('rate', r, 'inclusive', coalesce((p->>'inclusive')::boolean, true), 'gstin', g, 'label', left(coalesce(nullif(trim(p->>'label'), ''), 'GST'), 20)));
  insert into sfx_stores (tenant_id, config) values (tid, cur) on conflict (tenant_id) do update set config = excluded.config, updated_at = now();
  return sfx_checkout_settings_get();
end $$;
grant execute on function sfx_tax_settings_save(jsonb) to app;

alter function sfx_checkout_settings_get() rename to sfx_checkout_settings_get_pretax;
create function sfx_checkout_settings_get() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view'); c jsonb;
begin
  select config->'tax' into c from sfx_stores where tenant_id = tid;
  return sfx_checkout_settings_get_pretax() || jsonb_build_object('tax', coalesce(c, jsonb_build_object('rate', 0, 'inclusive', true, 'gstin', '', 'label', 'GST')));
end $$;
grant execute on function sfx_checkout_settings_get() to app;

create function sfx_orders_apply_tax() returns trigger language plpgsql security definer set search_path = public as $$
declare c jsonb; r numeric; base numeric;
begin
  if new.tax is distinct from 0 then return new; end if;
  select config->'tax' into c from sfx_stores where tenant_id = new.tenant_id;
  r := coalesce(nullif(c->>'rate', '')::numeric, 0);
  if r <= 0 then return new; end if;
  base := greatest(new.subtotal - coalesce(new.discount_amount, 0), 0);
  if coalesce((c->>'inclusive')::boolean, true) then
    new.tax := round(base * r / (100 + r), 2);
  else
    new.tax := round(base * r / 100, 2); new.total := new.total + new.tax;
  end if;
  return new;
end $$;
create trigger sfx_orders_tax before insert on sfx_orders for each row execute function sfx_orders_apply_tax();

create or replace function sfx_order_json(o sfx_orders, detail boolean default false) returns jsonb language sql immutable as $$
  select jsonb_build_object('id', o.id, 'number', o.number, 'status', o.status, 'paymentMethod', o.payment_method, 'paymentStatus', o.payment_status,
    'customerName', o.customer->>'name', 'total', o.total, 'createdAt', o.created_at) ||
    case when detail then jsonb_build_object('customer', o.customer, 'lines', o.lines, 'subtotal', o.subtotal, 'shipping', o.shipping, 'tax', o.tax,
      'discountCode', o.discount_code, 'discountAmount', o.discount_amount,
      'note', o.note, 'tracking', o.tracking, 'timeline', o.timeline, 'token', o.token) else '{}'::jsonb end
$$;

create or replace function public_sfx_order(p_token text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare o sfx_orders;
begin
  select * into o from sfx_orders where token = lower(coalesce(p_token, ''));
  if not found then return null; end if;
  return jsonb_build_object('number', o.number, 'status', o.status, 'paymentStatus', o.payment_status, 'paymentMethod', o.payment_method,
    'total', o.total, 'subtotal', o.subtotal, 'shipping', o.shipping, 'tax', o.tax, 'discountCode', o.discount_code, 'discountAmount', o.discount_amount,
    'lines', o.lines, 'note', o.note, 'tracking', o.tracking, 'createdAt', o.created_at);
end $$;

alter function public_sfx_store(text) rename to public_sfx_store_pretax;
create function public_sfx_store(p_slug text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb := public_sfx_store_pretax(p_slug); tid uuid; c jsonb;
begin
  if r is null or r->'config' is null then return r; end if;
  tid := sfx_public_tenant(p_slug);
  select config->'tax' into c from sfx_stores where tenant_id = tid;
  if c is null or coalesce(nullif(c->>'rate', '')::numeric, 0) <= 0 then return r; end if;
  return jsonb_set(r, '{config}', (r->'config') || jsonb_build_object('tax', c));
end $$;
grant execute on function public_sfx_store(text) to app;

-- the checkout reply also carries the tax of the new order
alter function public_sfx_place_order(text, jsonb) rename to public_sfx_place_order_pretax;
create function public_sfx_place_order(p_slug text, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb := public_sfx_place_order_pretax(p_slug, p); o sfx_orders;
begin
  select * into o from sfx_orders where token = r->>'token';
  if found then r := r || jsonb_build_object('tax', o.tax); end if;
  return r;
end $$;
grant execute on function public_sfx_place_order(text, jsonb) to app;
-- Rollback (place order): drop function public_sfx_place_order(text, jsonb); alter function public_sfx_place_order_pretax(text, jsonb) rename to public_sfx_place_order;
