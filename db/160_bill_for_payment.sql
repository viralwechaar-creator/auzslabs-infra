-- A payment recorded by hand (Clients -> Payments) has no GST bill. This makes one from it: a paid client order with a gapless
-- bill number, the buyer's details, product lines whose total must equal the money received, and renewal dates from the payment date.
-- It does not change the client's access, plan or fee (they already have it); it only issues the bill and links it to the payment.
create or replace function admin_create_bill_for_payment(p_payment_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare pay client_payments; ten tenants; v_items jsonb := '[]'; l jsonb; v_ren date; q jsonb; t jsonb; v_gst text; v_state text; v_fy text; v_n int; v_no text; v_id uuid; v_tok text; v_keys text[] := '{}';
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  select * into pay from client_payments where id = p_payment_id for update;
  if pay.id is null then raise exception 'payment not found'; end if;
  select * into ten from tenants where id = pay.tenant_id;
  if exists (select 1 from client_orders where status = 'paid' and (payment->>'payment_id') = pay.id::text) then raise exception 'This payment already has a bill.'; end if;
  v_gst := nullif(upper(trim(coalesce(p->>'gstin', ''))), '');
  if v_gst is not null and v_gst !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$' then raise exception 'That GSTIN does not look right (15 characters).'; end if;
  v_state := coalesce(substr(v_gst, 1, 2), nullif(trim(coalesce(p->>'state_code', '')), ''), '08');
  for l in select * from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) loop
    if coalesce(l->>'key', '') !~ '^[a-z_]{2,30}$' then raise exception 'Choose a product for every line.'; end if;
    v_ren := (pay.paid_on + case when coalesce(l->>'plan', 'month') = 'year' then interval '1 year' else interval '1 month' end)::date;
    v_items := v_items || jsonb_build_array(jsonb_build_object('key', l->>'key', 'plan', case when l->>'plan' = 'year' then 'year' else 'month' end,
      'rate', coalesce((l->>'rate')::numeric, 0), 'discount', coalesce((l->>'discount')::numeric, 0), 'gst', coalesce((l->>'gst')::numeric, 0), 'renewal', v_ren));
    v_keys := v_keys || (l->>'key');
  end loop;
  if jsonb_array_length(v_items) = 0 then raise exception 'Add at least one product.'; end if;
  q := jsonb_build_object('items', v_items, 'setup', jsonb_build_object('on', false), 'custom', coalesce(p->'custom', '[]'::jsonb), 'note', coalesce(p->>'note', ''));
  t := client_order_totals(q, v_state);
  if abs((t->>'total')::numeric - pay.amount) > 0.01 then
    raise exception 'The bill total (%) must equal the payment received (%). Adjust the amounts or the GST.', (t->>'total'), pay.amount; end if;
  v_fy := case when extract(month from pay.paid_on) >= 4 then extract(year from pay.paid_on)::int || '-' || lpad(((extract(year from pay.paid_on)::int + 1) % 100)::text, 2, '0')
               else (extract(year from pay.paid_on)::int - 1) || '-' || lpad((extract(year from pay.paid_on)::int % 100)::text, 2, '0') end;
  insert into client_order_counters (fy, n) values (v_fy, 1) on conflict (fy) do update set n = client_order_counters.n + 1 returning n into v_n;
  v_no := 'AUZ/' || v_fy || '/' || lpad(v_n::text, 4, '0');
  insert into client_orders (tenant_id, kind, status, contact_name, phone, email, gstin, address, state_code, business_name, niche, products, quote, totals, payment,
      invoice_no, invoice_date, paid_at, bill_sent_at)
  values (pay.tenant_id, 'addon', 'paid', left(nullif(trim(coalesce(p->>'contact_name', '')), ''), 120), left(nullif(trim(coalesce(p->>'phone', '')), ''), 30), left(nullif(trim(coalesce(p->>'email', '')), ''), 160),
      v_gst, left(nullif(trim(coalesce(p->>'address', '')), ''), 400), v_state, coalesce(nullif(trim(coalesce(p->>'business_name', '')), ''), ten.name), 'general', v_keys, q, t,
      jsonb_build_object('utr', pay.utr, 'payment_id', pay.id, 'confirmed_at', now(), 'manual', true),
      v_no, pay.paid_on, pay.paid_on::timestamptz, null)
  returning id, token into v_id, v_tok;
  update client_payments set purpose = coalesce(nullif(purpose, '') || ' · ', '') || 'Bill ' || v_no where id = pay.id;
  perform admin_log('bill_for_payment', 'client_order', v_id::text, jsonb_build_object('business', ten.name, 'invoice', v_no, 'total', t->'total'));
  return jsonb_build_object('id', v_id, 'token', v_tok, 'invoice_no', v_no);
end $$;
