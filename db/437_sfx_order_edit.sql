-- Edit the items of an order that has not shipped (from the Shopify reference): change quantities, remove lines, add a product or a custom item.
--  * Only open orders where nothing has shipped. Shipping, discount and tax amounts are left as they are (said on screen); the total moves by the change in items.
--  * Reducing or removing can put the units back in stock (a choice). Adding takes stock and is refused if there is not enough.
--  * Nothing is refunded or charged by this: the timeline records how much is owed to the customer or still to collect.
-- Rollback: drop function sfx_order_edit(uuid, jsonb).
create function sfx_order_edit(p_order uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_require('sfx_orders'); o sfx_orders; e jsonb; idx int; q int; old_q int; ln jsonb; newlines jsonb := '[]'::jsonb; seen int[] := '{}'; v record; sub numeric := 0; old_sub numeric := 0;
  restock boolean := coalesce((p->>'restock')::boolean, true); why text := left(trim(coalesce(p->>'reason', '')), 200); diff numeric; newtotal numeric; summary text;
begin
  select * into o from sfx_orders where id = p_order and tenant_id = tid for update;
  if not found then raise exception 'Order not found' using errcode = 'SF003'; end if;
  if o.status = 'cancelled' or o.fulfilment_status <> 'unfulfilled' or exists (select 1 from sfx_shipments where order_id = o.id and status <> 'cancelled') then
    raise exception 'Only an order that has not shipped can be edited' using errcode = 'SF002'; end if;
  if jsonb_typeof(p->'lines') <> 'array' then raise exception 'Nothing to change' using errcode = 'SF002'; end if;
  for idx in 0 .. jsonb_array_length(o.lines) - 1 loop old_sub := old_sub + (o.lines->idx->>'price')::numeric * (o.lines->idx->>'qty')::int; end loop;
  for e in select * from jsonb_array_elements(p->'lines') loop
    q := greatest(0, least(999, coalesce((e->>'qty')::int, 0)));
    if e ? 'index' then
      idx := (e->>'index')::int;
      if idx < 0 or idx >= jsonb_array_length(o.lines) or idx = any(seen) then raise exception 'That change does not match this order' using errcode = 'SF002'; end if;
      seen := seen || idx; ln := o.lines->idx; old_q := (ln->>'qty')::int;
      if q < old_q and restock and (ln->>'variantId') is not null then
        update sfx_variants set stock = stock + (old_q - q), updated_at = now() where id = (ln->>'variantId')::uuid and tenant_id = tid;
        insert into sfx_stock_moves (tenant_id, variant_id, delta, reason, note) values (tid, (ln->>'variantId')::uuid, old_q - q, 'adjust', 'Order ' || o.number || ' edited');
      elsif q > old_q and (ln->>'variantId') is not null then
        update sfx_variants set stock = stock - (q - old_q), updated_at = now() where id = (ln->>'variantId')::uuid and tenant_id = tid and stock >= (q - old_q);
        if not found then raise exception '% does not have % more in stock', ln->>'name', q - old_q using errcode = 'SF002'; end if;
        insert into sfx_stock_moves (tenant_id, variant_id, delta, reason, note) values (tid, (ln->>'variantId')::uuid, -(q - old_q), 'adjust', 'Order ' || o.number || ' edited');
      end if;
      if q > 0 then newlines := newlines || jsonb_build_array(jsonb_set(ln, '{qty}', to_jsonb(q))); end if;
    elsif e ? 'variantId' then
      if q = 0 then continue; end if;
      select v2.id, v2.product_id, v2.label, v2.price, pr.name, pr.images into v from sfx_variants v2 join sfx_products pr on pr.id = v2.product_id where v2.id = (e->>'variantId')::uuid and v2.tenant_id = tid;
      if not found then raise exception 'That product was not found' using errcode = 'SF002'; end if;
      update sfx_variants set stock = stock - q, updated_at = now() where id = v.id and stock >= q;
      if not found then raise exception '% does not have % in stock', v.name, q using errcode = 'SF002'; end if;
      insert into sfx_stock_moves (tenant_id, variant_id, delta, reason, note) values (tid, v.id, -q, 'adjust', 'Order ' || o.number || ' edited');
      newlines := newlines || jsonb_build_array(jsonb_build_object('productId', v.product_id, 'variantId', v.id, 'name', v.name, 'label', v.label,
        'price', coalesce(nullif(e->>'price', '')::numeric, v.price), 'qty', q, 'image', v.images->>0));
    elsif e ? 'custom' then
      if q = 0 then continue; end if;
      if length(trim(coalesce(e->'custom'->>'name', ''))) < 2 or coalesce((e->'custom'->>'price')::numeric, -1) < 0 then raise exception 'A custom item needs a name and a price' using errcode = 'SF002'; end if;
      newlines := newlines || jsonb_build_array(jsonb_build_object('name', left(trim(e->'custom'->>'name'), 120), 'label', 'Custom item', 'price', (e->'custom'->>'price')::numeric, 'qty', q, 'custom', true));
    end if;
  end loop;
  -- any existing line the form did not mention stays as it was
  for idx in 0 .. jsonb_array_length(o.lines) - 1 loop
    if not (idx = any(seen)) then newlines := newlines || jsonb_build_array(o.lines->idx); end if;
  end loop;
  if jsonb_array_length(newlines) = 0 then raise exception 'An order needs at least one item. To remove everything, cancel the order instead.' using errcode = 'SF002'; end if;
  for idx in 0 .. jsonb_array_length(newlines) - 1 loop sub := sub + (newlines->idx->>'price')::numeric * (newlines->idx->>'qty')::int; end loop;
  newtotal := greatest(o.total + (sub - old_sub), 0); diff := newtotal - o.total;
  summary := 'Order edited' || case when why <> '' then ' (' || why || ')' else '' end || ': total ' || o.total || ' to ' || newtotal
    || case when diff < 0 and o.payment_status = 'paid' then '. Refund due to the customer: ' || (-diff) when diff > 0 and o.payment_status = 'paid' then '. To collect from the customer: ' || diff else '' end;
  update sfx_orders set lines = newlines, subtotal = sub, total = newtotal, timeline = sfx_order_timeline_add(o, summary), updated_at = now() where id = p_order returning * into o;
  return sfx_order_json(o, true) || jsonb_build_object('difference', diff);
end $$;
grant execute on function sfx_order_edit(uuid, jsonb) to app;
