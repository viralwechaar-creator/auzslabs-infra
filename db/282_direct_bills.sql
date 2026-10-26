-- Direct GST bills ("Make bill" page in the admin panel): software AND hardware lines, per line price with or without GST,
-- HSN/SAC, MRP, quantity; a gapless AUZ/<FY>/nnnn bill number is given when the bill is generated; payment can be marked later.
-- Stored as a client_orders row (kind 'bill', status 'billed' = unpaid, 'paid' = paid) so the public bill link (inv.html?t=), the
-- bills list and the GST file keep working. Nothing here switches products on or touches a client's access or plan.
alter table client_orders drop constraint if exists client_orders_kind_check;
alter table client_orders add constraint client_orders_kind_check check (kind in ('new', 'addon', 'bill', 'renewal'));
alter table client_orders drop constraint if exists client_orders_status_check;
alter table client_orders add constraint client_orders_status_check check (status in ('requested', 'verifying', 'confirmed', 'link_sent', 'payment_submitted', 'paid', 'rejected', 'billed'));

-- the maths (the page's live preview mirrors this exactly; the saved totals always come from here)
-- item: {kind software|hardware|service, label, hsn, mrp, qty, rate (unit price as typed), incl (price includes GST), discount (whole line, as typed), gst, plan month|year|'' }
create or replace function bill_totals(p_quote jsonb, p_state text) returns jsonb
language plpgsql immutable as $$
declare l jsonb; lines jsonb := '[]'; qty numeric; rate numeric; gross numeric; disc numeric; g numeric; incl boolean; paid numeric; net numeric; gamt numeric; rex numeric; dex numeric;
  sub numeric := 0; dis numeric := 0; tax numeric := 0; gsum numeric := 0; intra boolean := coalesce(nullif(p_state, ''), '08') = '08'; raw_total numeric; rnd numeric; lbl text;
begin
  for l in select * from jsonb_array_elements(coalesce(p_quote->'items', '[]'::jsonb)) loop
    lbl := trim(coalesce(l->>'label', '')); if lbl = '' then continue; end if;
    qty := greatest(coalesce((l->>'qty')::numeric, 1), 0.001);
    rate := greatest(coalesce((l->>'rate')::numeric, 0), 0);
    g := least(greatest(coalesce((l->>'gst')::numeric, 0), 0), 100);
    incl := coalesce((l->>'incl')::boolean, false);
    gross := round(qty * rate, 2);
    disc := least(greatest(coalesce((l->>'discount')::numeric, 0), 0), gross);
    if incl then
      paid := gross - disc; net := round(paid / (1 + g / 100), 2); gamt := round(paid - net, 2);
      rex := round(gross / (1 + g / 100), 2); dex := rex - net;
    else
      net := gross - disc; gamt := round(net * g / 100, 2); rex := gross; dex := disc;
    end if;
    lines := lines || jsonb_build_array(jsonb_build_object('type', 'item', 'kind', coalesce(nullif(l->>'kind', ''), 'service'), 'label', left(lbl, 160), 'hsn', left(coalesce(l->>'hsn', ''), 12),
      'mrp', nullif(l->>'mrp', '')::numeric, 'qty', qty, 'unit', round(rex / qty, 2), 'incl', incl, 'plan', coalesce(nullif(l->>'plan', ''), ''),
      'rate', rex, 'discount', dex, 'net', net, 'gst', g, 'gst_amt', gamt, 'total', net + gamt, 'renewal', l->>'renewal'));
    sub := sub + rex; dis := dis + dex; tax := tax + net; gsum := gsum + gamt;
  end loop;
  raw_total := round(tax + gsum, 2); rnd := round(raw_total, 0) - raw_total;
  return jsonb_build_object('lines', lines, 'subtotal', round(sub, 2), 'discount', round(dis, 2), 'taxable', round(tax, 2), 'intra', intra,
    'cgst', case when intra then round(gsum / 2, 2) else 0 end, 'sgst', case when intra then round(gsum, 2) - round(gsum / 2, 2) else 0 end, 'igst', case when intra then 0 else round(gsum, 2) end,
    'gst', round(gsum, 2), 'round', round(rnd, 2), 'total', round(raw_total, 0));
end $$;

-- make the bill (billed = unpaid, or paid at once)
create or replace function admin_create_direct_bill(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_gst text; v_state text; v_items jsonb := '[]'; l jsonb; v_date date; v_ren date; q jsonb; t jsonb; v_no text; v_id uuid; v_tok text; v_tid uuid; v_paid boolean; v_paid_on date; v_utr text; v_mode text; v_name text;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  v_name := left(nullif(trim(coalesce(p->>'business_name', '')), ''), 160);
  if v_name is null then raise exception 'Enter the client''s name.'; end if;
  v_gst := nullif(upper(trim(coalesce(p->>'gstin', ''))), '');
  if v_gst is not null and v_gst !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$' then raise exception 'That GSTIN does not look right (15 characters).'; end if;
  v_state := coalesce(substr(v_gst, 1, 2), nullif(trim(coalesce(p->>'state_code', '')), ''), '08');
  v_date := coalesce(nullif(p->>'invoice_date', '')::date, current_date);
  if v_date > current_date + 1 then raise exception 'The bill date cannot be in the future.'; end if;
  for l in select * from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) loop
    if trim(coalesce(l->>'label', '')) = '' then continue; end if;
    v_ren := case when l->>'plan' = 'year' then (v_date + interval '1 year')::date when l->>'plan' = 'month' then (v_date + interval '1 month')::date else null end;
    v_items := v_items || jsonb_build_array(l || case when v_ren is null then '{}'::jsonb else jsonb_build_object('renewal', v_ren) end);
  end loop;
  if jsonb_array_length(v_items) = 0 then raise exception 'Add at least one item.'; end if;
  q := jsonb_build_object('items', v_items, 'note', left(coalesce(p->>'note', ''), 600));
  t := bill_totals(q, v_state);
  if (t->>'total')::numeric <= 0 then raise exception 'The bill total must be more than zero.'; end if;
  v_tid := nullif(p->>'tenant_id', '')::uuid;
  if v_tid is not null and not exists (select 1 from tenants where id = v_tid) then v_tid := null; end if;
  v_paid := coalesce((p->>'paid')::boolean, false);
  v_paid_on := coalesce(nullif(p->>'paid_on', '')::date, v_date);
  v_utr := nullif(trim(coalesce(p->>'utr', '')), '');
  v_mode := case when p->>'mode' in ('upi', 'bank', 'cash', 'cheque', 'card', 'other') then p->>'mode' else 'other' end;
  v_no := next_client_bill_no(v_date);
  insert into client_orders (tenant_id, kind, status, contact_name, phone, email, gstin, address, state_code, business_name, niche, products, quote, totals, payment,
      invoice_no, invoice_date, paid_at)
  values (v_tid, 'bill', case when v_paid then 'paid' else 'billed' end, left(nullif(trim(coalesce(p->>'contact_name', '')), ''), 120), left(nullif(trim(coalesce(p->>'phone', '')), ''), 30),
      left(nullif(trim(coalesce(p->>'email', '')), ''), 160), v_gst, left(nullif(trim(coalesce(p->>'address', '')), ''), 400), v_state, v_name, 'general', '{}', q, t,
      case when v_paid then jsonb_build_object('utr', v_utr, 'mode', v_mode, 'confirmed_at', now(), 'manual', true) else '{}'::jsonb end,
      v_no, v_date, case when v_paid then v_paid_on::timestamptz else null end)
  returning id, token into v_id, v_tok;
  if v_paid and v_tid is not null then
    perform admin_add_client_payment(v_tid, (t->>'total')::numeric, v_paid_on, v_mode, v_utr, 'Bill ' || v_no, 'Direct bill');
  end if;
  perform admin_log('direct_bill', 'client_order', v_id::text, jsonb_build_object('business', v_name, 'invoice', v_no, 'total', t->'total', 'paid', v_paid));
  return jsonb_build_object('id', v_id, 'token', v_tok, 'invoice_no', v_no, 'total', t->'total');
end $$;

-- payment arrives later
create or replace function admin_mark_bill_paid(p_id uuid, p_paid_on date default null, p_utr text default null, p_mode text default 'other') returns jsonb
language plpgsql security definer set search_path = public as $$
declare o client_orders; v_on date; v_utr text; v_mode text;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  select * into o from client_orders where id = p_id for update;
  if o.id is null or o.kind <> 'bill' then raise exception 'Bill not found.'; end if;
  if o.status = 'paid' then raise exception 'This bill is already paid.'; end if;
  v_on := coalesce(p_paid_on, current_date); v_utr := nullif(trim(coalesce(p_utr, '')), '');
  v_mode := case when p_mode in ('upi', 'bank', 'cash', 'cheque', 'card', 'other') then p_mode else 'other' end;
  update client_orders set status = 'paid', paid_at = v_on::timestamptz, updated_at = now(),
    payment = jsonb_build_object('utr', v_utr, 'mode', v_mode, 'confirmed_at', now(), 'manual', true) where id = p_id;
  if o.tenant_id is not null then
    perform admin_add_client_payment(o.tenant_id, (o.totals->>'total')::numeric, v_on, v_mode, v_utr, 'Bill ' || o.invoice_no, 'Direct bill');
  end if;
  perform admin_log('direct_bill_paid', 'client_order', p_id::text, jsonb_build_object('invoice', o.invoice_no, 'total', o.totals->'total'));
  return jsonb_build_object('invoice_no', o.invoice_no);
end $$;

-- find a client by name, GST number, phone or address words: earlier bills/requests first, then registered businesses
create or replace function admin_search_bill_clients(p_q text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare q text := '%' || lower(trim(coalesce(p_q, ''))) || '%';
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  if length(trim(coalesce(p_q, ''))) < 2 then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(x) from (
    select * from (
      select distinct on (lower(coalesce(nullif(gstin, ''), business_name))) jsonb_build_object('business_name', business_name, 'contact_name', contact_name, 'phone', phone, 'email', email,
        'gstin', gstin, 'address', address, 'state_code', state_code, 'tenant_id', tenant_id) as x, created_at as ts
      from client_orders
      where lower(coalesce(business_name, '')) like q or lower(coalesce(gstin, '')) like q or lower(coalesce(phone, '')) like q or lower(coalesce(contact_name, '')) like q
      order by lower(coalesce(nullif(gstin, ''), business_name)), created_at desc) a
    union all
    select jsonb_build_object('business_name', t.name, 'contact_name', null, 'phone', null, 'email', null, 'gstin', null, 'address', null, 'state_code', null, 'tenant_id', t.id), t.created_at
    from tenants t where (lower(t.name) like q or lower(t.slug) like q)
      and not exists (select 1 from client_orders c where c.tenant_id = t.id)
    order by 2 desc limit 15) z), '[]'::jsonb);
end $$;

-- the public bill link also shows an unpaid bill
create or replace function public_client_order(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare o client_orders;
begin
  select * into o from client_orders where token = p_token;
  if o.id is null then return null; end if;
  return jsonb_build_object('status', o.status, 'kind', o.kind, 'business_name', o.business_name, 'contact_name', o.contact_name, 'phone', o.phone, 'email', o.email, 'gstin', o.gstin, 'address', o.address, 'state_code', o.state_code,
    'products', to_jsonb(o.products), 'requirement', o.requirement,
    'quote', case when o.status in ('link_sent', 'payment_submitted', 'paid', 'billed') then o.quote else null end,
    'totals', case when o.status in ('link_sent', 'payment_submitted', 'paid', 'billed') then o.totals else null end,
    'payment', jsonb_build_object('utr', o.payment->>'utr', 'method', coalesce(o.payment->>'method', o.payment->>'mode'), 'submitted_at', o.payment->>'submitted_at', 'terms_accepted_at', o.payment->>'terms_accepted_at', 'proof', coalesce((o.payment->>'proof') is not null, false)),
    'invoice_no', o.invoice_no, 'invoice_date', o.invoice_date, 'paid_at', o.paid_at, 'created_at', o.created_at, 'tenant_slug', (select slug from tenants where id = o.tenant_id));
end $$;

-- bills list: unpaid direct bills count too (GST is due on the bill date); the page shows which are paid
create or replace function admin_list_client_bills(p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', o.id, 'token', o.token, 'status', o.status, 'kind', o.kind, 'invoice_no', o.invoice_no, 'invoice_date', o.invoice_date, 'paid_at', o.paid_at,
      'business_name', o.business_name, 'contact_name', o.contact_name, 'phone', o.phone, 'email', o.email, 'gstin', o.gstin,
      'address', o.address, 'state_code', o.state_code, 'totals', o.totals, 'payment', o.payment - 'proof',
      'bill_sent_at', o.bill_sent_at, 'bill_revised_at', o.bill_revised_at,
      'tenant_slug', (select slug from tenants where id = o.tenant_id)) order by o.invoice_date desc, o.invoice_no desc)
    from client_orders o
    where o.status in ('paid', 'billed') and o.invoice_no is not null
      and (p_from is null or o.invoice_date >= p_from) and (p_to is null or o.invoice_date <= p_to)), '[]'::jsonb);
end $$;

-- buyer details can be corrected on unpaid bills too
create or replace function admin_update_bill_details(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare o client_orders; v_gst text;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  select * into o from client_orders where id = p_id for update;
  if o.id is null or o.status not in ('paid', 'billed') or o.invoice_no is null then raise exception 'Only an issued bill can be corrected here.'; end if;
  v_gst := case when p ? 'gstin' then nullif(upper(trim(p->>'gstin')), '') else o.gstin end;
  if v_gst is not null and v_gst !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$' then raise exception 'That GSTIN does not look right (15 characters).'; end if;
  if v_gst is not null and o.state_code is not null and substr(v_gst, 1, 2) <> o.state_code then
    raise exception 'The GSTIN starts with a different state than this bill was issued for (%). Amounts cannot change after issue.', o.state_code; end if;
  update client_orders set
    business_name = coalesce(nullif(trim(p->>'business_name'), ''), business_name),
    contact_name = coalesce(nullif(trim(p->>'contact_name'), ''), contact_name),
    phone = coalesce(nullif(trim(p->>'phone'), ''), phone),
    email = case when p ? 'email' then nullif(trim(p->>'email'), '') else email end,
    gstin = v_gst,
    address = case when p ? 'address' then nullif(trim(p->>'address'), '') else address end,
    bill_revised_at = now(), updated_at = now()
  where id = p_id;
  perform admin_log('bill_details_corrected', 'client_order', p_id::text, jsonb_build_object('invoice', o.invoice_no));
end $$;
