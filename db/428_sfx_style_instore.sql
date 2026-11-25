-- Storefront round J: in-store sales from AUZsStyle land in the shared order list, tagged "in_store".
-- Only when the business has both apps AND the link is switched on (db/403, Storefront -> Channels). A business with only AUZsStyle is untouched.
--  * The sale is copied to sfx_orders when its transaction commits, so every line already exists. One order per sale (sty_sale_id is unique).
--  * The online-order rules (shipping, tax, checkout rules, discount rules) must not touch an in-store order, so those triggers now skip it.
--  * If the shop sold more than it had (AUZsStyle allows that with a warning), the order is flagged oversold.
--  * Voiding the sale cancels the shared order. Returns made in AUZsStyle are not copied (they stay in AUZsStyle's own reports).
alter table sfx_orders drop constraint if exists sfx_orders_payment_method_check;
alter table sfx_orders add constraint sfx_orders_payment_method_check check (payment_method in ('cod', 'online', 'in_store'));
alter table sfx_orders add column if not exists sty_sale_id uuid;
create unique index if not exists idx_sfx_orders_sty_sale on sfx_orders (sty_sale_id) where sty_sale_id is not null;

drop trigger if exists sfx_orders_shipping on sfx_orders;
create trigger sfx_orders_shipping before insert on sfx_orders for each row when (new.channel is distinct from 'in_store') execute function sfx_orders_apply_shipping();
drop trigger if exists sfx_orders_tax on sfx_orders;
create trigger sfx_orders_tax before insert on sfx_orders for each row when (new.channel is distinct from 'in_store') execute function sfx_orders_apply_tax();
drop trigger if exists sfx_orders_tax_split on sfx_orders;
create trigger sfx_orders_tax_split before insert on sfx_orders for each row when (new.channel is distinct from 'in_store') execute function sfx_orders_tax_split();
drop trigger if exists sfx_orders_checkout_rules on sfx_orders;
create trigger sfx_orders_checkout_rules before insert on sfx_orders for each row when (new.channel is distinct from 'in_store') execute function sfx_orders_checkout_rules();
drop trigger if exists sfx_orders_disc_rules on sfx_orders;
create trigger sfx_orders_disc_rules before insert on sfx_orders for each row when (new.channel is distinct from 'in_store') execute function sfx_orders_discount_rules();
drop trigger if exists sfx_orders_shipping_free on sfx_orders;
create trigger sfx_orders_shipping_free before insert on sfx_orders for each row when (new.channel is distinct from 'in_store') execute function sfx_orders_free_shipping();

create function sfx_link_push_sale(p_sale uuid) returns void language plpgsql security definer set search_path = public as $$
declare s sty_sales; c sty_customers; lines_ jsonb := '[]'::jsonb; l record; pid uuid; vid uuid; over boolean := false; raw int; cust jsonb; sub numeric := 0; img jsonb;
begin
  select * into s from sty_sales where id = p_sale;
  if s.id is null or not sfx_link_on(s.tenant_id) or exists (select 1 from sfx_orders where sty_sale_id = s.id) then return; end if;
  perform set_config('auz.sfxsync', '1', true);
  for l in select * from sty_sale_lines where sale_id = s.id loop
    select v.id, v.product_id, p.images into vid, pid, img from sfx_variants v join sfx_products p on p.id = v.product_id where v.tenant_id = s.tenant_id and v.source_variant_id = l.variant_id;
    select coalesce(sum(qty), 0)::int into raw from sty_stock_moves where variant_id = l.variant_id;
    if raw < 0 then over := true; end if;
    lines_ := lines_ || jsonb_build_array(jsonb_build_object('productId', pid, 'variantId', vid, 'name', l.style_name, 'label', sfx_link_label(l.colour, l.size), 'price', l.price, 'qty', l.qty,
      'image', img->>0, 'cost', nullif(l.cost, 0)));
    sub := sub + l.price * l.qty;
  end loop;
  if jsonb_array_length(lines_) = 0 then return; end if;
  select * into c from sty_customers where id = s.customer_id;
  cust := jsonb_build_object('name', coalesce(c.name, 'Walk-in customer'), 'phone', nullif(c.phone, ''), 'inStore', true);
  insert into sfx_orders (tenant_id, number, token, status, payment_method, payment_status, customer, lines, subtotal, shipping, total, tax, discount_amount, channel, fulfilment_status, oversold, sty_sale_id, timeline, created_at)
  values (s.tenant_id, left(s.number, 40), encode(gen_random_bytes(16), 'hex'), 'fulfilled', 'in_store', case when s.status = 'paid' then 'paid' else 'pending' end, cust, lines_, sub, 0, s.total, s.tax, s.discount, 'in_store', 'fulfilled', over, s.id,
    jsonb_build_array(jsonb_build_object('label', 'Sold in the shop', 'at', s.at)), s.at);
exception when others then
  null;   -- the shop's sale is already saved; a copy problem must never undo it
end $$;

create function sfx_link_sale_trigger() returns trigger language plpgsql security definer set search_path = public as $$
begin perform sfx_link_push_sale(new.id); return null; end $$;
drop trigger if exists sty_sales_link on sty_sales;
create constraint trigger sty_sales_link after insert on sty_sales deferrable initially deferred for each row execute function sfx_link_sale_trigger();

create function sfx_link_sale_void() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'void' and old.status is distinct from 'void' then
    perform set_config('auz.sfxsync', '1', true);
    update sfx_orders set status = 'cancelled', cancel_reason = 'Sale cancelled in the shop', updated_at = now() where sty_sale_id = new.id and status <> 'cancelled';
  end if;
  return null;
exception when others then return null;
end $$;
drop trigger if exists sty_sales_link_void on sty_sales;
create trigger sty_sales_link_void after update of status on sty_sales for each row execute function sfx_link_sale_void();

-- When the link is switched on, sales already made are brought across (the last 90 days; older ones stay in AUZsStyle only).
create function sfx_link_backfill_sales(p_tenant uuid) returns int language plpgsql security definer set search_path = public as $$
declare r record; n int := 0;
begin
  for r in select id from sty_sales where tenant_id = p_tenant and status <> 'void' and at > now() - interval '90 days' and not exists (select 1 from sfx_orders where sty_sale_id = sty_sales.id) order by at loop
    perform sfx_link_push_sale(r.id); n := n + 1;
  end loop;
  return n;
end $$;

alter function sfx_style_link_set(boolean) rename to sfx_style_link_set_pre428;
create function sfx_style_link_set(p_on boolean) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); res jsonb; n int := 0;
begin
  res := sfx_style_link_set_pre428(p_on);
  if p_on then n := sfx_link_backfill_sales(tid); end if;
  return res || jsonb_build_object('sales', n);
end $$;
grant execute on function sfx_style_link_set(boolean) to app;

-- Rollback (link switch): drop function sfx_style_link_set(boolean); rename sfx_style_link_set_pre428 back.
-- Rollback: drop triggers sty_sales_link and sty_sales_link_void; drop functions sfx_link_push_sale, sfx_link_sale_trigger, sfx_link_sale_void, sfx_link_backfill_sales;
-- recreate the six sfx_orders triggers without the WHEN clause; restore the payment_method check without 'in_store'; drop column sfx_orders.sty_sale_id.
