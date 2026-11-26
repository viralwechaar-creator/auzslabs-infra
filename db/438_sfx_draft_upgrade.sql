-- Draft orders, from the Shopify reference: a discount, a shipping charge, custom items, a changed price on a line, and "payment due later".
--  * A line may carry its own price (only for this draft; the catalogue price is not touched) or be a custom item with no stock.
--  * The discount is a percent or a flat amount with a note. Shipping is a name and an amount (0 = free).
--  * When the draft becomes an order its shipping and discount are exactly what was written, not the store's automatic rules.
--  * "Payment due later" is noted on the order; the order stays unpaid until you mark it paid.
-- Rollback: restore sfx_draft_json, sfx_draft_save and sfx_draft_convert from db/379; alter table sfx_drafts drop the new columns.
alter table sfx_drafts add column if not exists discount_amount numeric(12,2) not null default 0;
alter table sfx_drafts add column if not exists discount_note text;
alter table sfx_drafts add column if not exists shipping numeric(12,2) not null default 0;
alter table sfx_drafts add column if not exists shipping_label text;
alter table sfx_drafts add column if not exists pay_later boolean not null default false;

create or replace function sfx_draft_json(d sfx_drafts) returns jsonb language sql stable set search_path = public as $$
  with s as (select coalesce((select sum((l->>'price')::numeric * (l->>'qty')::int) from jsonb_array_elements(d.lines) l), 0) sub)
  select jsonb_build_object('id', d.id, 'customer', d.customer, 'note', d.note, 'status', d.status, 'orderId', d.order_id, 'createdAt', d.created_at, 'lines', d.lines,
    'subtotal', s.sub, 'discount', d.discount_amount, 'discountNote', d.discount_note, 'shipping', d.shipping, 'shippingLabel', d.shipping_label, 'payLater', d.pay_later,
    'total', greatest(s.sub - d.discount_amount, 0) + d.shipping)
  from s
$$;

create or replace function sfx_draft_save(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); l jsonb; ln jsonb := '[]'::jsonb; q int; v record; row_ sfx_drafts; cust jsonb; pr numeric; sub numeric := 0; disc numeric := 0; dk text; dv numeric; ship numeric := 0;
begin
  if jsonb_typeof(p->'lines') <> 'array' or jsonb_array_length(p->'lines') = 0 then raise exception 'Add at least one product' using errcode = 'SF002'; end if;
  if length(trim(coalesce(p->>'name', ''))) < 2 then raise exception 'Enter the customer name' using errcode = 'SF002'; end if;
  for l in select * from jsonb_array_elements(p->'lines') loop
    q := greatest(1, least(999, coalesce((l->>'qty')::int, 1)));
    if l ? 'custom' then
      if length(trim(coalesce(l->'custom'->>'name', ''))) < 2 or coalesce((l->'custom'->>'price')::numeric, -1) < 0 then raise exception 'A custom item needs a name and a price' using errcode = 'SF002'; end if;
      ln := ln || jsonb_build_array(jsonb_build_object('name', left(trim(l->'custom'->>'name'), 120), 'label', 'Custom item', 'price', (l->'custom'->>'price')::numeric, 'qty', q, 'custom', true));
      sub := sub + (l->'custom'->>'price')::numeric * q;
    else
      select v2.id, v2.product_id, v2.label, v2.price, pr2.name into v from sfx_variants v2 join sfx_products pr2 on pr2.id = v2.product_id where v2.id = (l->>'variantId')::uuid and v2.tenant_id = tid;
      if not found then raise exception 'A product in this draft no longer exists' using errcode = 'SF002'; end if;
      pr := coalesce(nullif(l->>'price', '')::numeric, v.price);
      if pr < 0 then raise exception 'A price cannot be below zero' using errcode = 'SF002'; end if;
      ln := ln || jsonb_build_array(jsonb_build_object('productId', v.product_id, 'variantId', v.id, 'name', v.name, 'label', v.label, 'price', pr, 'qty', q));
      sub := sub + pr * q;
    end if;
  end loop;
  if p ? 'discount' and jsonb_typeof(p->'discount') = 'object' then
    dk := coalesce(p->'discount'->>'kind', 'flat'); dv := coalesce(nullif(p->'discount'->>'value', '')::numeric, 0);
    if dv < 0 then raise exception 'A discount cannot be below zero' using errcode = 'SF002'; end if;
    if dk = 'percent' then if dv > 100 then raise exception 'A percentage discount cannot be over 100' using errcode = 'SF002'; end if; disc := round(sub * dv / 100, 2);
    else disc := least(dv, sub); end if;
  end if;
  if p ? 'shipping' and jsonb_typeof(p->'shipping') = 'object' then ship := coalesce(nullif(p->'shipping'->>'amount', '')::numeric, 0); if ship < 0 then raise exception 'Shipping cannot be below zero' using errcode = 'SF002'; end if; end if;
  cust := jsonb_build_object('name', trim(p->>'name'), 'phone', regexp_replace(coalesce(p->>'phone', ''), '[^0-9+]', '', 'g'), 'email', nullif(p->>'email', ''),
    'address', coalesce(p->>'address', ''), 'city', coalesce(p->>'city', ''), 'pin', coalesce(p->>'pin', ''), 'state', coalesce(p->>'state', ''), 'country', 'India');
  if p_id is null then
    insert into sfx_drafts (tenant_id, customer, lines, note, discount_amount, discount_note, shipping, shipping_label, pay_later)
      values (tid, cust, ln, left(coalesce(p->>'note', ''), 1000), disc, left(p->'discount'->>'note', 120), ship, left(coalesce(p->'shipping'->>'label', ''), 60), coalesce((p->>'payLater')::boolean, false)) returning * into row_;
  else
    update sfx_drafts set customer = cust, lines = ln, note = left(coalesce(p->>'note', ''), 1000), discount_amount = disc, discount_note = left(p->'discount'->>'note', 120),
      shipping = ship, shipping_label = left(coalesce(p->'shipping'->>'label', ''), 60), pay_later = coalesce((p->>'payLater')::boolean, false), updated_at = now()
      where id = p_id and tenant_id = tid and status = 'open' returning * into row_;
    if not found then raise exception 'Draft not found or already converted' using errcode = 'SF003'; end if;
  end if;
  return sfx_draft_json(row_);
end $$;

create or replace function sfx_draft_convert(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); d sfx_drafts; l jsonb; sub numeric := 0; num text; tok text; oid uuid; stock_ int; nm text; q int; o sfx_orders; excl boolean; fin numeric; tl jsonb;
begin
  select * into d from sfx_drafts where id = p_id and tenant_id = tid and status = 'open' for update;
  if not found then raise exception 'Draft not found or already converted' using errcode = 'SF003'; end if;
  for l in select * from jsonb_array_elements(d.lines) loop
    q := (l->>'qty')::int;
    if (l->>'custom') is null then
      select v.stock, pr.name into stock_, nm from sfx_variants v join sfx_products pr on pr.id = v.product_id where v.id = (l->>'variantId')::uuid and v.tenant_id = tid for update;
      if not found then raise exception 'A product in this draft no longer exists' using errcode = 'SF002'; end if;
      if q > stock_ then raise exception '% has only % left', nm, stock_ using errcode = 'SF002'; end if;
      update sfx_variants set stock = stock - q, updated_at = now() where id = (l->>'variantId')::uuid;
      insert into sfx_stock_moves (tenant_id, variant_id, delta, reason, note) values (tid, (l->>'variantId')::uuid, -q, 'adjust', 'Draft order converted');
    end if;
    sub := sub + (l->>'price')::numeric * q;
  end loop;
  select 'SF' || to_char(now(), 'YYMMDD') || '-' || lpad((coalesce(max(substring(number from '\d+$')::int), 0) + 1)::text, 4, '0') into num
    from sfx_orders where tenant_id = tid and number like 'SF' || to_char(now(), 'YYMMDD') || '-%';
  tok := encode(gen_random_bytes(16), 'hex');
  tl := jsonb_build_array(jsonb_build_object('label', 'Created from a draft order', 'at', now()));
  if d.discount_amount > 0 then tl := tl || jsonb_build_array(jsonb_build_object('label', 'Draft discount: ' || d.discount_amount || coalesce(' (' || nullif(d.discount_note, '') || ')', ''), 'at', now())); end if;
  if d.pay_later then tl := tl || jsonb_build_array(jsonb_build_object('label', 'Payment due later', 'at', now())); end if;
  insert into sfx_orders (tenant_id, number, token, payment_method, customer, lines, subtotal, shipping, total, discount_amount, note, timeline)
    values (tid, num, tok, 'cod', d.customer, d.lines, sub, d.shipping, greatest(sub - d.discount_amount, 0) + d.shipping, d.discount_amount, nullif(d.note, ''), tl)
    returning * into o;
  oid := o.id;
  -- the store's automatic shipping and discount rules must not override what was written on the draft
  select coalesce((config->'tax'->>'rate')::numeric, 0) > 0 and not coalesce((config->'tax'->>'inclusive')::boolean, true) into excl from sfx_stores where tenant_id = tid;
  fin := greatest(sub - d.discount_amount, 0) + d.shipping + case when coalesce(excl, false) then o.tax else 0 end;
  update sfx_orders set shipping = d.shipping, shipping_label = nullif(d.shipping_label, ''), discount_amount = d.discount_amount, discount_code = null, total = fin where id = oid;
  update sfx_drafts set status = 'converted', order_id = oid, updated_at = now() where id = p_id;
  return jsonb_build_object('orderId', oid, 'number', num, 'token', tok);
end $$;
