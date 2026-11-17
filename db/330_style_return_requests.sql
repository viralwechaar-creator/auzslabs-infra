-- AUZsStyle: customer self-service return/exchange requests for IN-STORE counter-sale bills (db/330).
-- Online web-store orders already had this (sty_web_returns / public_sty_return_request, db/232+247+248).
-- Counter sales had nothing: a customer could only ask by calling or walking in. This adds the same idea
-- for a counter-sale bill, sized to cause the least extra work for the shop:
--   1. A customer opens their bill link (stybill.html) and taps "Request return/exchange" -- only shown
--      while the store has switched this on (off by default) and the bill is still inside the return window.
--   2. They pick which lines/qty and say why. That becomes one row here, status 'pending'.
--   3. The owner/staff see it in Bills -> Return requests. They can reject it with a note, or -- once the
--      customer physically brings the item back -- open it, which pre-fills the EXISTING in-store return
--      screen (the same sty_return the staff already use for a walk-up return) with the requested lines
--      already picked. Confirming that screen is what actually restocks inventory (sty_return already does
--      this for every return, online or in person) -- no new restock mechanism, no re-typing the item.
-- One flat 2-stage status model (pending -> rejected | completed) on purpose: the owner only ever acts on
-- this when the customer is in front of them (or to pre-emptively decline), so a 4-stage approve/receive/
-- refund pipeline like the web-order one (which exists because of online refunds via Razorpay) would just be
-- extra taps for no reason here -- a counter return is settled the same way any other in-store return is
-- (cash/credit/exchange), on the spot.

alter table sty_settings add column if not exists allow_return_requests boolean not null default false;

create table if not exists sty_return_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  sale_id uuid not null references sty_sales(id) on delete cascade,
  mode text not null default 'return' check (mode in ('return', 'exchange')),
  reason text,
  lines jsonb not null default '[]'::jsonb,                 -- snapshot at request time: [{saleLineId,name,colour,size,qty}]
  status text not null default 'pending' check (status in ('pending', 'rejected', 'completed')),
  return_id uuid references sty_returns(id),                -- set once the owner actually processes it (sty_return's id)
  decision_note text,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists sty_return_requests_t on sty_return_requests (tenant_id, created_at desc);
create unique index if not exists sty_return_requests_open on sty_return_requests (sale_id) where status = 'pending';
alter table sty_return_requests enable row level security;

-- Replaces sty_settings_json (db/215): adds allowReturnRequests, the owner-side Settings toggle for this feature.
create or replace function sty_settings_json(s sty_settings) returns jsonb language sql immutable as $$
  select jsonb_build_object('shopName', s.shop_name, 'address', s.address, 'phone', s.phone, 'gstin', s.gstin, 'logoUrl', s.logo_url,
    'billFooter', s.bill_footer, 'billPrefix', s.bill_prefix, 'language', s.language, 'allowNegativeStock', s.allow_negative_stock,
    'maxDiscountPct', s.max_discount_pct, 'returnDays', s.return_days, 'allowReturnRequests', s.allow_return_requests,
    'loyaltyEarnPct', s.loyalty_earn_pct,
    'loyaltyPointValue', s.loyalty_point_value, 'roundOff', s.round_off, 'defaultTaxPct', s.default_tax_pct,
    'taxSlabs', s.tax_slabs, 'priceIncludesTax', s.price_includes_tax, 'leadDays', s.lead_days, 'coverDays', s.cover_days,
    'slowDays', s.slow_days, 'requireCustomerPhone', s.require_customer_phone, 'staffSeeCost', s.staff_see_cost,
    'dayCloseDate', s.day_close_date, 'features', s.features)
$$;

-- Replaces sty_save_settings (db/215): accepts allowReturnRequests from the Settings screen.
create or replace function sty_save_settings(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_guard('sty_manage');
  perform sty_context();
  update sty_settings set
    shop_name = coalesce(p->>'shopName', shop_name), address = coalesce(p->>'address', address), phone = coalesce(p->>'phone', phone),
    gstin = coalesce(p->>'gstin', gstin), logo_url = coalesce(p->>'logoUrl', logo_url), bill_footer = coalesce(p->>'billFooter', bill_footer),
    bill_prefix = coalesce(nullif(p->>'billPrefix', ''), bill_prefix),
    language = case when p->>'language' in ('en', 'hi') then p->>'language' else language end,
    allow_negative_stock = coalesce((p->>'allowNegativeStock')::boolean, allow_negative_stock),
    max_discount_pct = coalesce((p->>'maxDiscountPct')::numeric, max_discount_pct),
    return_days = coalesce((p->>'returnDays')::int, return_days),
    allow_return_requests = coalesce((p->>'allowReturnRequests')::boolean, allow_return_requests),
    loyalty_earn_pct = coalesce((p->>'loyaltyEarnPct')::numeric, loyalty_earn_pct),
    loyalty_point_value = coalesce((p->>'loyaltyPointValue')::numeric, loyalty_point_value),
    round_off = coalesce((p->>'roundOff')::boolean, round_off),
    default_tax_pct = coalesce((p->>'defaultTaxPct')::numeric, default_tax_pct),
    tax_slabs = coalesce(p->'taxSlabs', tax_slabs),
    price_includes_tax = coalesce((p->>'priceIncludesTax')::boolean, price_includes_tax),
    lead_days = coalesce((p->>'leadDays')::int, lead_days),
    cover_days = coalesce((p->>'coverDays')::int, cover_days),
    slow_days = coalesce((p->>'slowDays')::int, slow_days),
    require_customer_phone = coalesce((p->>'requireCustomerPhone')::boolean, require_customer_phone),
    staff_see_cost = coalesce((p->>'staffSeeCost')::boolean, staff_see_cost),
    features = case when p ? 'features' then p->'features' else features end
  where tenant_id = tid;
  return sty_context();
end $$;

-- Replaces public_sty_sale (db/298): adds allowReturnRequests + returnRequested to the shop/sale, and keeps each
-- line's own sale_line id (renamed lineId, since "id" was deliberately stripped to avoid confusion elsewhere) plus
-- its already-returned qty, so the public bill page can let a customer pick exactly which lines to ask back.
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
    'returnRequested', exists(select 1 from sty_return_requests where sale_id = s.id and status = 'pending'),
    'lines', (select coalesce(jsonb_agg(((l - 'barcode' - 'variantId') || jsonb_build_object('hsn', (select y.hsn from sty_styles y where y.id = (l->>'styleId')::uuid), 'lineId', l->>'id')) - 'styleId' - 'id'), '[]'::jsonb) from jsonb_array_elements(j->'lines') l));
  return jsonb_build_object('shop', jsonb_build_object('name', coalesce(nullif(st.shop_name, ''), tn, 'Shop'), 'address', st.address, 'phone', st.phone,
      'gstin', st.gstin, 'logoUrl', st.logo_url, 'footer', st.bill_footer, 'returnDays', st.return_days, 'allowReturnRequests', st.allow_return_requests,
      'upiId', st.features->>'upiId', 'upiName', st.features->>'upiName'), 'sale', j);
end $$;

-- Public, token-only: a customer submits a return/exchange request for their counter-sale bill. No auth,
-- same unguessable-token gate as public_sty_sale; mirrors public_sty_return_request's checks (db/232) but
-- against sale.at + the store's own allow_return_requests switch instead of a delivered web order.
create or replace function public_sty_sale_return_request(p_token text, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare s sty_sales; st sty_settings; e jsonb; sl sty_sale_lines; q int; mode_ text; snap jsonb := '[]'::jsonb; cust_name text;
begin
  if p_token is null or length(p_token) < 8 or length(p_token) > 32 then raise exception 'Bill not found' using errcode = 'ST002'; end if;
  select * into s from sty_sales where share_token = lower(p_token);
  if not found then raise exception 'Bill not found' using errcode = 'ST002'; end if;
  if s.status = 'void' then raise exception 'This bill was cancelled' using errcode = 'ST002'; end if;
  select * into st from sty_settings where tenant_id = s.tenant_id;
  if not coalesce(st.allow_return_requests, false) then raise exception 'This store does not accept return requests online' using errcode = 'ST002'; end if;
  if now() - s.at > make_interval(days => coalesce(st.return_days, 30)) then raise exception 'The % day return window for this bill has ended', coalesce(st.return_days, 30) using errcode = 'ST002'; end if;
  if exists (select 1 from sty_return_requests where sale_id = s.id and status = 'pending') then raise exception 'You already have a request open for this bill' using errcode = 'ST002'; end if;
  mode_ := coalesce(p->>'mode', 'return'); if mode_ not in ('return', 'exchange') then raise exception 'Choose return or exchange' using errcode = 'ST002'; end if;
  if length(trim(coalesce(p->>'reason', ''))) < 3 then raise exception 'Tell us why' using errcode = 'ST002'; end if;
  if jsonb_array_length(coalesce(p->'lines', '[]'::jsonb)) = 0 then raise exception 'Pick what you want to bring back' using errcode = 'ST002'; end if;
  for e in select * from jsonb_array_elements(p->'lines') loop
    select * into sl from sty_sale_lines where id = nullif(e->>'saleLineId', '')::uuid and sale_id = s.id;
    if sl.id is null then raise exception 'That item is not on this bill' using errcode = 'ST002'; end if;
    q := (e->>'qty')::int;
    if q is null or q <= 0 or q > sl.qty - sl.returned then raise exception '% : only % can come back', sl.style_name, sl.qty - sl.returned using errcode = 'ST002'; end if;
    snap := snap || jsonb_build_object('saleLineId', sl.id, 'name', sl.style_name, 'colour', sl.colour, 'size', sl.size, 'qty', q);
  end loop;
  insert into sty_return_requests (tenant_id, sale_id, mode, reason, lines) values (s.tenant_id, s.id, mode_, left(trim(p->>'reason'), 200), snap);
  select coalesce(c.name, 'A customer') into cust_name from sty_customers c where c.id = s.customer_id;
  begin
    insert into notifications (tenant_id, type, title, body) values (s.tenant_id, 'store_return', 'Return request for bill ' || s.number, cust_name || ' asked for a ' || mode_);
    perform pg_notify('push_events', jsonb_build_object('tenant_id', s.tenant_id, 'title', 'Return request ' || s.number, 'body', cust_name || ': ' || mode_, 'url', '/style.html#/bills')::text);
  exception when others then null; end;
  return jsonb_build_object('ok', true);
end $$;

-- Owner/staff: list counter-sale return requests (newest first).
create or replace function sty_return_requests_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_guard('sty_sell');
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'saleId', r.sale_id, 'number', s.number, 'customer', (select c.name from sty_customers c where c.id = s.customer_id),
      'mode', r.mode, 'reason', r.reason, 'lines', r.lines, 'status', r.status, 'decisionNote', r.decision_note, 'createdAt', r.created_at) order by r.created_at desc)
    from (select * from sty_return_requests where tenant_id = tid order by created_at desc limit 200) r join sty_sales s on s.id = r.sale_id), '[]'::jsonb);
end $$;

-- Owner/staff: reject a pending request (with a note), or mark it completed once the real in-store return
-- (sty_return, which already restocks) has actually been processed for it -- p_return_id links the two for
-- traceability. Only ever acts on a 'pending' row so a request cannot be decided twice.
create or replace function sty_return_requests_decide(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; st text;
begin
  tid := sty_guard('sty_sell');
  st := p->>'status';
  if st not in ('rejected', 'completed') then raise exception 'bad status'; end if;
  if not exists (select 1 from sty_return_requests where id = p_id and tenant_id = tid and status = 'pending') then
    raise exception 'That request was not found, or has already been handled' using errcode = 'ST002';
  end if;
  update sty_return_requests set status = st, decision_note = left(coalesce(p->>'note', ''), 300),
    return_id = nullif(p->>'returnId', '')::uuid, decided_by = app_uid(), decided_at = now()
    where id = p_id;
  perform sty_audit_log(tid, 'return_request.' || st, p_id::text, p);
  return jsonb_build_object('ok', true);
end $$;
-- Rollback: drop table sty_return_requests; drop column sty_settings.allow_return_requests; restore
-- sty_settings_json/sty_save_settings from db/215, public_sty_sale from db/298.
