-- Client bills for the admin: every paid order's GST bill can be found again later, its buyer details corrected
-- (the amounts and the number never change), and shared again. Reached only through platform-admin functions.
alter table client_orders add column if not exists bill_revised_at timestamptz;

create or replace function admin_list_client_bills(p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', o.id, 'token', o.token, 'invoice_no', o.invoice_no, 'invoice_date', o.invoice_date, 'paid_at', o.paid_at,
      'business_name', o.business_name, 'contact_name', o.contact_name, 'phone', o.phone, 'email', o.email, 'gstin', o.gstin,
      'address', o.address, 'state_code', o.state_code, 'totals', o.totals, 'payment', o.payment - 'proof',
      'bill_sent_at', o.bill_sent_at, 'bill_revised_at', o.bill_revised_at,
      'tenant_slug', (select slug from tenants where id = o.tenant_id)) order by o.invoice_date desc, o.invoice_no desc)
    from client_orders o
    where o.status = 'paid' and o.invoice_no is not null
      and (p_from is null or o.invoice_date >= p_from) and (p_to is null or o.invoice_date <= p_to)), '[]'::jsonb);
end $$;

-- only the buyer's details can be corrected; the state (it decides CGST+SGST or IGST), the amounts and the number are fixed once issued
create or replace function admin_update_bill_details(p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare o client_orders; v_gst text;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  select * into o from client_orders where id = p_id for update;
  if o.id is null or o.status <> 'paid' or o.invoice_no is null then raise exception 'Only an issued bill can be corrected here.'; end if;
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
  perform admin_log('bill_details_edit', 'client_order', p_id::text, jsonb_build_object('invoice', o.invoice_no,
    'before', jsonb_build_object('business_name', o.business_name, 'gstin', o.gstin, 'address', o.address, 'phone', o.phone, 'email', o.email, 'contact_name', o.contact_name)));
end $$;
