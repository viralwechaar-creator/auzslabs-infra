-- Storefront phase 4b: (1) refunding a returned order through the STORE'S OWN Razorpay account, (2) a primary custom
-- domain that the store's own .auzslab.in address forwards to.

-- ---------- card refunds ----------
alter table sfx_returns add column if not exists rzp_refund_id text;

-- Trusted-backend call (routes/payments.js, withAuth as the owner): checks everything and hands back the store's own keys + the
-- original payment id. Changes nothing. Not in the RPC allow-list.
create function sfx_refund_prepare(p_return uuid, p_amount numeric) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); r sfx_returns; o sfx_orders; k sfx_store_secrets; value_ numeric;
begin
  select * into r from sfx_returns where id = p_return and tenant_id = tid;
  if r.id is null then raise exception 'Return not found' using errcode = 'SF003'; end if;
  if r.status <> 'received' then raise exception 'Mark the goods received before refunding' using errcode = 'SF002'; end if;
  select * into o from sfx_orders where id = r.order_id;
  if o.payment_method <> 'online' or o.payment_status <> 'paid' or o.rzp_payment_id is null then
    raise exception 'This order was not paid online, so there is nothing for Razorpay to refund. Refund the customer yourself and record it.' using errcode = 'SF002'; end if;
  value_ := (select coalesce(sum((x->>'price')::numeric * (x->>'qty')::int), 0) from jsonb_array_elements(r.lines) x);
  if p_amount is null or p_amount <= 0 or p_amount > value_ then raise exception 'Enter an amount up to %', value_ using errcode = 'SF002'; end if;
  select * into k from sfx_store_secrets where tenant_id = tid;
  if k.tenant_id is null then raise exception 'Card payments are not set up for this store' using errcode = 'SF002'; end if;
  return jsonb_build_object('key', k.rzp_key_id, 'secret', k.rzp_secret, 'paymentId', o.rzp_payment_id, 'amount', p_amount, 'number', o.number);
end $$;

-- After Razorpay confirmed the refund: mark the return refunded (through the same stage rules) and keep Razorpay's refund id.
create function sfx_refund_complete(p_return uuid, p_amount numeric, p_rzp_refund text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); r sfx_returns;
begin
  perform sfx_return_set(p_return, 'refunded', p_amount);
  update sfx_returns set rzp_refund_id = left(coalesce(p_rzp_refund, ''), 80) where id = p_return and tenant_id = tid returning * into r;
  return sfx_return_json(r);
end $$;

-- ---------- primary domain ----------
alter table sfx_domains add column if not exists is_primary boolean not null default false;
create unique index if not exists idx_sfx_domains_one_primary on sfx_domains (tenant_id) where is_primary;

create function sfx_domain_set_primary(p_id uuid, p_on boolean) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); d sfx_domains;
begin
  select * into d from sfx_domains where id = p_id and tenant_id = tid;
  if d.id is null then raise exception 'Domain not found' using errcode = 'SF003'; end if;
  if p_on and d.status <> 'verified' then raise exception 'Verify the domain before making it your main address' using errcode = 'SF002'; end if;
  if p_on then update sfx_domains set is_primary = false where tenant_id = tid and is_primary; end if;
  update sfx_domains set is_primary = coalesce(p_on, false) where id = p_id;
  return jsonb_build_object('ok', true);
end $$;

-- the hostname a store's own .auzslab.in address should forward to (server only; only while the domain still serves)
create function sfx_domain_primary(p_slug text) returns text language sql stable security definer set search_path = public as $$
  select d.hostname from sfx_domains d join tenants t on t.id = d.tenant_id
  where t.slug = lower(coalesce(p_slug, '')) and d.is_primary and d.status = 'verified' and sfx_domain_site(d.hostname) = t.slug
  limit 1
$$;

-- the list now also says which domain is primary
create or replace function sfx_domain_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'hostname', hostname, 'token', token, 'status', status, 'isPrimary', is_primary, 'createdAt', created_at) order by created_at desc)
    from sfx_domains where tenant_id = tid), '[]'::jsonb);
end $$;

create or replace function sfx_return_json(r sfx_returns) returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object('id', r.id, 'orderId', r.order_id, 'orderNumber', (select number from sfx_orders where id = r.order_id), 'lines', r.lines, 'reason', r.reason,
    'status', r.status, 'refundAmount', r.refund_amount, 'rzpRefundId', r.rzp_refund_id, 'createdAt', r.created_at,
    'online', coalesce((select o.payment_method = 'online' and o.payment_status = 'paid' and o.rzp_payment_id is not null from sfx_orders o where o.id = r.order_id), false),
    'value', coalesce((select sum((l->>'price')::numeric * (l->>'qty')::int) from jsonb_array_elements(r.lines) l), 0))
$$;

-- Rollback: drop function sfx_refund_prepare, sfx_refund_complete, sfx_domain_set_primary, sfx_domain_primary; drop columns sfx_returns.rzp_refund_id, sfx_domains.is_primary; re-create sfx_domain_list / sfx_return_json from db/372 and db/379.
