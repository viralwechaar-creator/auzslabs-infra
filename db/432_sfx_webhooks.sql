-- Outgoing webhooks: the store tells another system when something happens (order created, paid, fulfilled, cancelled; refund; new customer).
-- The owner adds an https address and picks events. Each delivery is signed (HMAC-SHA256) and retried with growing waits.
-- Rollback: drop triggers sfx_wh_orders_ins, sfx_wh_orders_upd on sfx_orders; sfx_wh_refunds on sfx_refunds; sfx_wh_customers on sfx_customers;
--   drop functions sfx_wh_* , sfx_webhook_*; drop tables sfx_webhook_events, sfx_webhooks.
create table if not exists sfx_webhooks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  url text not null check (url ~ '^https://[^/\s@]+(/.*)?$' and length(url) <= 500),
  events text[] not null check (cardinality(events) between 1 and 8),
  secret text not null,
  active boolean not null default true,
  last_status text, last_at timestamptz, created_by uuid, created_at timestamptz not null default now()
);
create index if not exists idx_sfx_webhooks on sfx_webhooks (tenant_id);
alter table sfx_webhooks enable row level security;
create table if not exists sfx_webhook_events (
  id bigserial primary key,
  tenant_id uuid not null,
  webhook_id uuid not null references sfx_webhooks(id) on delete cascade,
  event text not null, payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed')),
  attempts int not null default 0, next_at timestamptz not null default now(),
  http_status int, last_error text, created_at timestamptz not null default now(), sent_at timestamptz
);
create index if not exists idx_sfx_wh_due on sfx_webhook_events (next_at) where status = 'pending';
create index if not exists idx_sfx_wh_hook on sfx_webhook_events (webhook_id, created_at desc);
alter table sfx_webhook_events enable row level security;

create function sfx_wh_events() returns text[] language sql immutable as $$
  select array['order.created', 'order.paid', 'order.fulfilled', 'order.cancelled', 'refund.created', 'customer.created']
$$;

-- one event for every active hook of the tenant that listens to it. Never raises (a hook problem must not stop a sale).
create function sfx_wh_emit(p_tenant uuid, p_event text, p_payload jsonb) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into sfx_webhook_events (tenant_id, webhook_id, event, payload)
  select p_tenant, w.id, p_event, jsonb_build_object('event', p_event, 'createdAt', now(), 'data', p_payload)
  from sfx_webhooks w where w.tenant_id = p_tenant and w.active and p_event = any(w.events)
    and (select count(*) from sfx_webhook_events e where e.webhook_id = w.id and e.status = 'pending') < 2000;
exception when others then null;
end $$;

create function sfx_wh_order_payload(o sfx_orders) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', o.id, 'number', o.number, 'status', o.status, 'paymentStatus', o.payment_status, 'fulfilmentStatus', o.fulfilment_status,
    'channel', o.channel, 'total', o.total, 'subtotal', o.subtotal, 'shipping', o.shipping, 'tax', o.tax, 'discountCode', o.discount_code, 'discountAmount', o.discount_amount,
    'creditApplied', o.credit_applied, 'customerId', o.customer_id, 'customer', jsonb_build_object('name', o.customer->>'name', 'phone', o.customer->>'phone', 'email', o.customer->>'email'),
    'lines', o.lines, 'createdAt', o.created_at)
$$;

create function sfx_wh_orders_ins() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform sfx_wh_emit(new.tenant_id, 'order.created', sfx_wh_order_payload(new));
  return null;
exception when others then return null;
end $$;
create trigger sfx_wh_orders_ins after insert on sfx_orders for each row execute function sfx_wh_orders_ins();

create function sfx_wh_orders_upd() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.payment_status = 'paid' and old.payment_status is distinct from 'paid' then perform sfx_wh_emit(new.tenant_id, 'order.paid', sfx_wh_order_payload(new)); end if;
  if new.fulfilment_status = 'fulfilled' and old.fulfilment_status is distinct from 'fulfilled' then perform sfx_wh_emit(new.tenant_id, 'order.fulfilled', sfx_wh_order_payload(new)); end if;
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then perform sfx_wh_emit(new.tenant_id, 'order.cancelled', sfx_wh_order_payload(new)); end if;
  return null;
exception when others then return null;
end $$;
create trigger sfx_wh_orders_upd after update on sfx_orders for each row execute function sfx_wh_orders_upd();

create function sfx_wh_refunds() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform sfx_wh_emit(new.tenant_id, 'refund.created', jsonb_build_object('id', new.id, 'orderId', new.order_id, 'amount', new.amount, 'method', new.method, 'reason', new.reason,
    'orderNumber', (select number from sfx_orders where id = new.order_id)));
  return null;
exception when others then return null;
end $$;
create trigger sfx_wh_refunds after insert on sfx_refunds for each row execute function sfx_wh_refunds();

create function sfx_wh_customers() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform sfx_wh_emit(new.tenant_id, 'customer.created', jsonb_build_object('id', new.id, 'name', new.name, 'phone', new.phone, 'email', new.email));
  return null;
exception when others then return null;
end $$;
create trigger sfx_wh_customers after insert on sfx_customers for each row execute function sfx_wh_customers();

-- ---------- owner screens ----------
create function sfx_webhook_create(p_url text, p_events text[]) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_require('sfx_settings'); u text := trim(coalesce(p_url, '')); ev text[]; sec text; w sfx_webhooks;
begin
  if u !~ '^https://[^/\s@]+(/.*)?$' or length(u) > 500 then raise exception 'Enter an https address, like https://example.com/hooks/store' using errcode = 'SF002'; end if;
  if lower(u) ~ '^https://(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[)' then raise exception 'That address is not reachable from the internet' using errcode = 'SF002'; end if;
  select array_agg(distinct x) into ev from unnest(coalesce(p_events, '{}')) x where x = any(sfx_wh_events());
  if ev is null or cardinality(ev) = 0 then raise exception 'Choose at least one event' using errcode = 'SF002'; end if;
  if (select count(*) from sfx_webhooks where tenant_id = tid) >= 10 then raise exception 'Up to 10 webhooks. Remove one first.' using errcode = 'SF002'; end if;
  sec := 'whsec_' || encode(gen_random_bytes(24), 'hex');
  insert into sfx_webhooks (tenant_id, url, events, secret, created_by) values (tid, u, ev, sec, app_uid()) returning * into w;
  perform sfx_audit_log('Added a webhook', jsonb_build_object('url', u, 'events', ev));
  return jsonb_build_object('id', w.id, 'url', w.url, 'events', w.events, 'secret', sec, 'note', 'Copy the signing secret now. It will not be shown again.');
end $$;
create function sfx_webhook_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin
  if not sfx_perm('sfx_settings') then raise exception 'Your role does not allow this (sfx_settings)' using errcode = '42501'; end if;
  return jsonb_build_object('events', sfx_wh_events(), 'hooks', coalesce((select jsonb_agg(jsonb_build_object('id', w.id, 'url', w.url, 'events', w.events, 'active', w.active, 'lastStatus', w.last_status, 'lastAt', w.last_at,
      'pending', (select count(*) from sfx_webhook_events e where e.webhook_id = w.id and e.status = 'pending'),
      'failed', (select count(*) from sfx_webhook_events e where e.webhook_id = w.id and e.status = 'failed' and e.created_at > now() - interval '7 days')) order by w.created_at) from sfx_webhooks w where w.tenant_id = tid), '[]'::jsonb));
end $$;
create function sfx_webhook_set(p_id uuid, p_active boolean) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_require('sfx_settings');
begin
  update sfx_webhooks set active = coalesce(p_active, false) where id = p_id and tenant_id = tid;
  perform sfx_audit_log(case when p_active then 'Turned a webhook on' else 'Turned a webhook off' end, jsonb_build_object('hook', p_id));
end $$;
create function sfx_webhook_delete(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_require('sfx_settings');
begin
  delete from sfx_webhooks where id = p_id and tenant_id = tid;
  perform sfx_audit_log('Removed a webhook', jsonb_build_object('hook', p_id));
end $$;
create function sfx_webhook_deliveries(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin
  if not sfx_perm('sfx_settings') then raise exception 'Your role does not allow this (sfx_settings)' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'event', e.event, 'status', e.status, 'attempts', e.attempts, 'httpStatus', e.http_status, 'error', e.last_error, 'at', e.created_at, 'sentAt', e.sent_at) order by e.id desc)
    from (select * from sfx_webhook_events where webhook_id = p_id and tenant_id = tid order by id desc limit 30) e), '[]'::jsonb);
end $$;
create function sfx_webhook_test(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_require('sfx_settings');
begin
  insert into sfx_webhook_events (tenant_id, webhook_id, event, payload)
  select tid, w.id, 'ping', jsonb_build_object('event', 'ping', 'createdAt', now(), 'data', jsonb_build_object('message', 'This is a test from your store.')) from sfx_webhooks w where w.id = p_id and w.tenant_id = tid;
end $$;

-- ---------- server only (not in the RPC list): the delivery worker ----------
create function sfx_webhook_claim(p_limit int) returns jsonb language plpgsql security definer set search_path = public as $$
declare r jsonb;
begin
  with due as (
    select e.id from sfx_webhook_events e join sfx_webhooks w on w.id = e.webhook_id
    where e.status = 'pending' and e.next_at <= now() and w.active order by e.id limit greatest(least(coalesce(p_limit, 10), 50), 1) for update of e skip locked
  ), lease as (
    update sfx_webhook_events e set next_at = now() + interval '3 minutes', attempts = attempts + 1 from due where e.id = due.id returning e.*
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'event', l.event, 'payload', l.payload, 'attempts', l.attempts, 'url', w.url, 'secret', w.secret) order by l.id), '[]'::jsonb)
    into r from lease l join sfx_webhooks w on w.id = l.webhook_id;
  return r;
end $$;
create function sfx_webhook_result(p_id bigint, p_ok boolean, p_status int, p_error text) returns void language plpgsql security definer set search_path = public as $$
declare e sfx_webhook_events;
begin
  select * into e from sfx_webhook_events where id = p_id;
  if not found then return; end if;
  if p_ok then
    update sfx_webhook_events set status = 'sent', sent_at = now(), http_status = p_status, last_error = null where id = p_id;
  elsif e.attempts >= 6 then
    update sfx_webhook_events set status = 'failed', http_status = p_status, last_error = left(p_error, 300) where id = p_id;
  else
    update sfx_webhook_events set http_status = p_status, last_error = left(p_error, 300),
      next_at = now() + (case e.attempts when 1 then interval '1 minute' when 2 then interval '5 minutes' when 3 then interval '30 minutes' when 4 then interval '2 hours' else interval '12 hours' end) where id = p_id;
  end if;
  update sfx_webhooks set last_status = case when p_ok then 'ok' else 'failing' end, last_at = now() where id = e.webhook_id;
end $$;
grant execute on function sfx_webhook_create(text, text[]), sfx_webhook_list(), sfx_webhook_set(uuid, boolean), sfx_webhook_delete(uuid), sfx_webhook_deliveries(uuid), sfx_webhook_test(uuid), sfx_webhook_claim(int), sfx_webhook_result(bigint, boolean, int, text) to app;
