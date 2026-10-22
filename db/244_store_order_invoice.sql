-- Online orders: once the bill is made the customer's order page shows a View invoice button (the same short /b/<token> page the WhatsApp link opens),
-- and the return instructions can name the shop's address. The function now writes (it makes the bill's share token on first view), so it is no longer 'stable'.
create or replace function public_sty_order(p_token text) returns jsonb language plpgsql security definer set search_path = public as $$
declare o sty_web_orders; st sty_settings; tn text; feat jsonb; days int; tok text; billno text;
begin
  if p_token is null or length(p_token) < 8 or length(p_token) > 20 then return null; end if;
  select * into o from sty_web_orders where token = lower(p_token);
  if not found then return null; end if;
  select * into st from sty_settings where tenant_id = o.tenant_id;
  select name into tn from tenants where id = o.tenant_id;
  feat := coalesce(st.features, '{}'::jsonb); days := coalesce(st.return_days, 30);
  if o.sale_id is not null then
    select share_token, number into tok, billno from sty_sales where id = o.sale_id;
    if tok is null then
      update sty_sales set share_token = substr(replace(gen_random_uuid()::text, '-', ''), 1, 10) where id = o.sale_id and share_token is null returning share_token into tok;
      if tok is null then select share_token into tok from sty_sales where id = o.sale_id; end if;
    end if;
  end if;
  return jsonb_build_object('billUrl', case when tok is not null then '/b/' || tok end, 'billNo', billno, 'number', o.number, 'status', o.status, 'payment', o.payment_method, 'paymentStatus', o.payment_status, 'total', o.total,
    'subtotal', o.subtotal, 'shipping', o.shipping, 'discount', o.discount, 'coupon', o.coupon, 'courier', o.courier, 'trackingNo', o.tracking_no,
    'lines', o.lines, 'createdAt', o.created_at, 'returnDays', days,
    'canReturn', o.status = 'delivered' and coalesce(o.delivered_at, o.updated_at) >= now() - make_interval(days => days) and not exists (select 1 from sty_web_returns where order_id = o.id and status in ('requested', 'approved')),
    'returns', coalesce((select jsonb_agg(jsonb_build_object('kind', r.kind, 'status', r.status, 'staffNote', r.staff_note, 'createdAt', r.created_at) order by r.created_at desc) from sty_web_returns r where r.order_id = o.id), '[]'::jsonb),
    'reviewed', coalesce((select jsonb_agg(style_id) from sty_reviews where order_id = o.id), '[]'::jsonb),
    'customer', jsonb_build_object('name', o.customer->>'name', 'city', o.customer->>'city', 'pin', o.customer->>'pin'),
    'shop', jsonb_build_object('name', coalesce(nullif(st.shop_name, ''), tn), 'phone', st.phone, 'address', st.address),
    'upi', case when o.payment_method = 'upi' and o.payment_status in ('pending', 'submitted') then jsonb_build_object('id', feat->>'upiId', 'name', coalesce(nullif(feat->>'upiName', ''), coalesce(nullif(st.shop_name, ''), tn))) end);
end $$;
