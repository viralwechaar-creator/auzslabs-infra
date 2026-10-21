-- AUZsStyle: a short public bill link (https://<shop>.auzslab.in/b/<token>) for WhatsApp.
alter table sty_sales add column if not exists share_token text;
create unique index if not exists sty_sales_share_token on sty_sales(share_token) where share_token is not null;

-- makes (or returns) the short token of one of this shop's bills
create or replace function sty_share_sale(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; tok text; n int := 0;
begin
  tid := sty_guard('sty_view');
  select share_token into tok from sty_sales where id = p_id and tenant_id = tid;
  if not found then raise exception 'bill not found' using errcode = 'ST002'; end if;
  while tok is null and n < 6 loop
    n := n + 1;
    begin
      update sty_sales set share_token = substr(replace(gen_random_uuid()::text, '-', ''), 1, 10) where id = p_id and tenant_id = tid and share_token is null returning share_token into tok;
      if tok is null then select share_token into tok from sty_sales where id = p_id and tenant_id = tid; end if;
    exception when unique_violation then tok := null;
    end;
  end loop;
  if tok is null then raise exception 'could not make a link, try again' using errcode = 'ST002'; end if;
  return jsonb_build_object('token', tok);
end $$;

-- public: the token is the only access. Returns the shop's header and the bill, never staff, cost or the customer's phone.
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
    'lines', (select coalesce(jsonb_agg(l - 'barcode' - 'variantId' - 'styleId' - 'id'), '[]'::jsonb) from jsonb_array_elements(j->'lines') l));
  return jsonb_build_object('shop', jsonb_build_object('name', coalesce(nullif(st.shop_name, ''), tn, 'Shop'), 'address', st.address, 'phone', st.phone,
      'gstin', st.gstin, 'logoUrl', st.logo_url, 'footer', st.bill_footer, 'returnDays', st.return_days), 'sale', j);
end $$;
