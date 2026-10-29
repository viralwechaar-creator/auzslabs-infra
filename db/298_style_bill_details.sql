-- AUZsStyle public bill: also send each line's HSN and the shop's UPI details, so the bill page can be a proper tax invoice
-- and show a pay-now QR for the balance. Same access rule as before: the unguessable token only; no staff, cost or customer phone.
create or replace function public_sty_sale(p_token text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s sty_sales; st sty_settings; j jsonb; tn text;
begin
  if p_token is null or length(p_token) < 8 or length(p_token) > 32 then return null; end if;
  select * into s from sty_sales where share_token = lower(p_token);
  if not found then return null; end if;
  select * into st from sty_settings where tenant_id = s.tenant_id;
  select name into tn from tenants where id = s.tenant_id;
  j := sty_sale_json(s.tenant_id, s.id);
  j := j - 'staffId' - 'staff' - 'offline' - 'note' - 'customer';
  j := j || jsonb_build_object('customerName', (select c.name from sty_customers c where c.id = s.customer_id),
    'lines', (select coalesce(jsonb_agg(((l - 'barcode' - 'variantId' - 'id') || jsonb_build_object('hsn', (select y.hsn from sty_styles y where y.id = (l->>'styleId')::uuid))) - 'styleId'), '[]'::jsonb) from jsonb_array_elements(j->'lines') l));
  return jsonb_build_object('shop', jsonb_build_object('name', coalesce(nullif(st.shop_name, ''), tn, 'Shop'), 'address', st.address, 'phone', st.phone,
      'gstin', st.gstin, 'logoUrl', st.logo_url, 'footer', st.bill_footer, 'returnDays', st.return_days,
      'upiId', st.features->>'upiId', 'upiName', st.features->>'upiName'), 'sale', j);
end $$;
