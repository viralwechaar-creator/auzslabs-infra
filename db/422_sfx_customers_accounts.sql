-- Storefront round D: customers as real records, address book, marketing consent, store credit, sign-in by code, account page data.
--  * Every order with a phone number is linked to one customer record (created on the first order). History is not rewritten.
--  * Consent is recorded when given and when withdrawn (what, when, where from). Nothing is assumed.
--  * Store credit is a ledger; a refund paid as store credit adds to it.
--  * Customers sign in with a one-time code sent to their email or WhatsApp. Codes and session tokens are stored only as hashes.

alter table sfx_customers add column if not exists accepts_marketing boolean not null default false;
alter table sfx_customers add column if not exists consent_at timestamptz;
alter table sfx_customers add column if not exists consent_source text;
alter table sfx_customers add column if not exists credit_balance numeric(12,2) not null default 0 check (credit_balance >= 0);
alter table sfx_customers add column if not exists source text not null default 'manual';
alter table sfx_orders add column if not exists customer_id uuid references sfx_customers(id) on delete set null;
create index if not exists idx_sfx_orders_customer on sfx_orders (customer_id);

create table if not exists sfx_customer_addresses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer_id uuid not null references sfx_customers(id) on delete cascade,
  label text, name text, phone text, address text not null, city text, state text, pin text,
  is_default boolean not null default false, created_at timestamptz not null default now()
);
create unique index if not exists idx_sfx_addr_unique on sfx_customer_addresses (customer_id, lower(address), coalesce(pin, ''));
alter table sfx_customer_addresses enable row level security;

create table if not exists sfx_credit_moves (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer_id uuid not null references sfx_customers(id) on delete cascade,
  delta numeric(12,2) not null, balance_after numeric(12,2) not null,
  reason text not null, order_id uuid references sfx_orders(id) on delete set null, note text,
  created_by uuid, created_at timestamptz not null default now()
);
create index if not exists idx_sfx_credit on sfx_credit_moves (customer_id, created_at desc);
alter table sfx_credit_moves enable row level security;

create table if not exists sfx_customer_codes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer_id uuid not null references sfx_customers(id) on delete cascade,
  contact text not null, code_hash text not null, attempts int not null default 0,
  expires_at timestamptz not null default now() + interval '10 minutes', used_at timestamptz, created_at timestamptz not null default now()
);
create index if not exists idx_sfx_codes on sfx_customer_codes (customer_id, created_at desc);
alter table sfx_customer_codes enable row level security;
create table if not exists sfx_customer_sessions (
  token_hash text primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  customer_id uuid not null references sfx_customers(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '30 days', created_at timestamptz not null default now()
);
alter table sfx_customer_sessions enable row level security;
grant select, insert, update, delete on sfx_customer_addresses, sfx_credit_moves, sfx_customer_codes, sfx_customer_sessions to app;

-- Link each new order to a customer (created on first sight, matched by phone). Name and email only fill gaps, never overwrite.
create or replace function sfx_orders_link_customer() returns trigger language plpgsql security definer set search_path = public as $$
declare ph text := regexp_replace(coalesce(new.customer->>'phone', ''), '[^0-9+]', '', 'g'); cid uuid; mk boolean := coalesce(new.customer->>'marketing', '') in ('true', 'yes', '1');
begin
  if new.customer_id is not null or ph = '' then return new; end if;
  insert into sfx_customers (tenant_id, name, phone, email, source, accepts_marketing, consent_at, consent_source)
  values (new.tenant_id, coalesce(nullif(trim(new.customer->>'name'), ''), 'Customer'), ph, nullif(lower(trim(new.customer->>'email')), ''), 'order', mk, case when mk then now() end, case when mk then 'checkout' end)
  on conflict (tenant_id, phone) where phone is not null and phone <> '' do update
    set email = coalesce(sfx_customers.email, excluded.email), updated_at = now(),
        accepts_marketing = sfx_customers.accepts_marketing or excluded.accepts_marketing,
        consent_at = coalesce(sfx_customers.consent_at, excluded.consent_at), consent_source = coalesce(sfx_customers.consent_source, excluded.consent_source)
  returning id into cid;
  new.customer_id := cid;
  if coalesce(trim(new.customer->>'address'), '') <> '' then
    insert into sfx_customer_addresses (tenant_id, customer_id, name, phone, address, city, state, pin, is_default)
    values (new.tenant_id, cid, new.customer->>'name', ph, trim(new.customer->>'address'), new.customer->>'city', new.customer->>'state', new.customer->>'pin',
      not exists (select 1 from sfx_customer_addresses where customer_id = cid))
    on conflict do nothing;
  end if;
  return new;
exception when others then
  return new;   -- a customer record problem must never lose an order
end $$;
drop trigger if exists sfx_orders_customer on sfx_orders;
create trigger sfx_orders_customer before insert on sfx_orders for each row execute function sfx_orders_link_customer();

-- Existing orders: link to a customer that already exists with the same phone.
update sfx_orders o set customer_id = c.id from sfx_customers c
 where o.customer_id is null and c.tenant_id = o.tenant_id and c.phone = regexp_replace(coalesce(o.customer->>'phone', ''), '[^0-9+]', '', 'g') and c.phone <> '';

-- Owner view of one customer.
create function sfx_customer_detail(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view'); c sfx_customers;
begin
  select * into c from sfx_customers where id = p_id and tenant_id = tid;
  if not found then raise exception 'Customer not found' using errcode = 'SF003'; end if;
  return jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'email', c.email, 'notes', c.notes, 'acceptsMarketing', c.accepts_marketing,
    'consentAt', c.consent_at, 'consentSource', c.consent_source, 'creditBalance', c.credit_balance,
    'addresses', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'address', a.address, 'city', a.city, 'state', a.state, 'pin', a.pin, 'isDefault', a.is_default) order by a.is_default desc, a.created_at) from sfx_customer_addresses a where a.customer_id = c.id), '[]'::jsonb),
    'creditMoves', coalesce((select jsonb_agg(jsonb_build_object('delta', m.delta, 'balance', m.balance_after, 'reason', m.reason, 'note', m.note, 'at', m.created_at) order by m.created_at desc) from (select * from sfx_credit_moves where customer_id = c.id order by created_at desc limit 30) m), '[]'::jsonb),
    'orders', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'number', o.number, 'total', o.total, 'status', o.status, 'createdAt', o.created_at) order by o.created_at desc) from (select * from sfx_orders where customer_id = c.id order by created_at desc limit 30) o), '[]'::jsonb));
end $$;

create function sfx_customer_consent(p_id uuid, p_marketing boolean, p_source text default 'staff') returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage');
begin
  update sfx_customers set accepts_marketing = coalesce(p_marketing, false), consent_at = now(), consent_source = left(coalesce(nullif(p_source, ''), 'staff'), 40), updated_at = now() where id = p_id and tenant_id = tid;
  if not found then raise exception 'Customer not found' using errcode = 'SF003'; end if;
  return sfx_customer_detail(p_id);
end $$;

-- Store credit: add or take away, with a note. The balance can never go below zero.
create function sfx_credit_apply_internal(p_tenant uuid, p_customer uuid, p_delta numeric, p_reason text, p_order uuid, p_note text, p_by uuid) returns numeric language plpgsql security definer set search_path = public as $$
declare bal numeric;
begin
  update sfx_customers set credit_balance = credit_balance + p_delta, updated_at = now() where id = p_customer and tenant_id = p_tenant returning credit_balance into bal;
  if not found then raise exception 'Customer not found' using errcode = 'SF003'; end if;
  insert into sfx_credit_moves (tenant_id, customer_id, delta, balance_after, reason, order_id, note, created_by) values (p_tenant, p_customer, p_delta, bal, p_reason, p_order, left(p_note, 300), p_by);
  return bal;
exception when check_violation then raise exception 'That would take the store credit below zero' using errcode = 'SF002';
end $$;
create function sfx_credit_adjust(p_customer uuid, p_delta numeric, p_note text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); d numeric := round(coalesce(p_delta, 0), 2);
begin
  if d = 0 or abs(d) > 1000000 then raise exception 'Enter an amount above zero' using errcode = 'SF002'; end if;
  perform sfx_credit_apply_internal(tid, p_customer, d, 'adjustment', null, p_note, app_uid());
  return sfx_customer_detail(p_customer);
end $$;

-- A refund paid as store credit goes into the customer's balance.
alter function sfx_refund_record(uuid, jsonb) rename to sfx_refund_record_pre422;
create function sfx_refund_record(p_order uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); o sfx_orders; res jsonb;
begin
  select * into o from sfx_orders where id = p_order and tenant_id = tid;
  if found and coalesce(p->>'method', '') = 'store_credit' and o.customer_id is null then
    raise exception 'This order has no customer account to give credit to' using errcode = 'SF002';
  end if;
  res := sfx_refund_record_pre422(p_order, p);
  if found and coalesce(p->>'method', '') = 'store_credit' then
    perform sfx_credit_apply_internal(tid, o.customer_id, round((p->>'amount')::numeric, 2), 'refund', p_order, 'Refund for order ' || o.number, app_uid());
  end if;
  return res;
end $$;

-- ---------- sign-in by code (server issues and delivers the code; the browser only verifies) ----------
create function sfx_customer_code_issue(p_slug text, p_contact text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_public_tenant(p_slug); c sfx_customers; k text := trim(coalesce(p_contact, '')); code text;
begin
  if tid is null or k = '' then return null; end if;
  select * into c from sfx_customers where tenant_id = tid and ((phone <> '' and phone = regexp_replace(k, '[^0-9+]', '', 'g')) or (email is not null and lower(email) = lower(k))) order by created_at limit 1;
  if not found then return null; end if;
  if (select count(*) from sfx_customer_codes where customer_id = c.id and created_at > now() - interval '1 hour') >= 5 then return null; end if;
  code := lpad((floor(random() * 1000000))::int::text, 6, '0');
  insert into sfx_customer_codes (tenant_id, customer_id, contact, code_hash) values (tid, c.id, lower(k), encode(digest(code || c.id::text, 'sha256'), 'hex'));
  return jsonb_build_object('code', code, 'tenantId', tid, 'name', c.name, 'phone', c.phone, 'email', c.email, 'viaEmail', position('@' in k) > 0);
end $$;

create function public_sfx_customer_verify(p_slug text, p_contact text, p_code text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_public_tenant(p_slug); k text := lower(trim(coalesce(p_contact, ''))); row_ sfx_customer_codes; tok text; c sfx_customers;
begin
  -- A wrong guess must be COUNTED, so it returns an error object instead of raising (a raise would roll the count back).
  if tid is null then return jsonb_build_object('ok', false, 'error', 'That code did not work'); end if;
  select * into row_ from sfx_customer_codes where tenant_id = tid and contact = k and used_at is null and expires_at > now() order by created_at desc limit 1 for update;
  if not found or row_.attempts >= 5 then return jsonb_build_object('ok', false, 'error', 'That code did not work'); end if;
  if row_.code_hash <> encode(digest(trim(coalesce(p_code, '')) || row_.customer_id::text, 'sha256'), 'hex') then
    update sfx_customer_codes set attempts = attempts + 1 where id = row_.id;
    return jsonb_build_object('ok', false, 'error', 'That code did not work');
  end if;
  update sfx_customer_codes set used_at = now() where id = row_.id;
  tok := encode(gen_random_bytes(24), 'hex');
  insert into sfx_customer_sessions (token_hash, tenant_id, customer_id) values (encode(digest(tok, 'sha256'), 'hex'), tid, row_.customer_id);
  select * into c from sfx_customers where id = row_.customer_id;
  return jsonb_build_object('ok', true, 'token', tok, 'name', c.name);
end $$;

create function sfx_customer_session(p_token text) returns uuid language sql stable security definer set search_path = public as $$
  select customer_id from sfx_customer_sessions where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex') and expires_at > now()
$$;

create function public_sfx_customer_account(p_token text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare cid uuid := sfx_customer_session(p_token); c sfx_customers;
begin
  if cid is null then return null; end if;
  select * into c from sfx_customers where id = cid;
  return jsonb_build_object('name', c.name, 'phone', c.phone, 'email', c.email, 'acceptsMarketing', c.accepts_marketing, 'creditBalance', c.credit_balance,
    'addresses', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'address', a.address, 'city', a.city, 'state', a.state, 'pin', a.pin, 'isDefault', a.is_default) order by a.is_default desc, a.created_at) from sfx_customer_addresses a where a.customer_id = cid), '[]'::jsonb),
    'orders', coalesce((select jsonb_agg(jsonb_build_object('number', o.number, 'total', o.total, 'status', o.status, 'paymentStatus', o.payment_status, 'createdAt', o.created_at, 'token', o.token) order by o.created_at desc) from (select * from sfx_orders where customer_id = cid and not is_test order by created_at desc limit 30) o), '[]'::jsonb));
end $$;

create function public_sfx_customer_update(p_token text, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare cid uuid := sfx_customer_session(p_token); c sfx_customers; mk boolean;
begin
  if cid is null then raise exception 'Please sign in again' using errcode = 'SF002'; end if;
  select * into c from sfx_customers where id = cid;
  mk := coalesce((p->>'acceptsMarketing')::boolean, c.accepts_marketing);
  update sfx_customers set name = coalesce(nullif(left(trim(p->>'name'), 120), ''), name), email = case when p ? 'email' then nullif(lower(trim(p->>'email')), '') else email end,
    accepts_marketing = mk, consent_at = case when mk is distinct from c.accepts_marketing then now() else consent_at end,
    consent_source = case when mk is distinct from c.accepts_marketing then 'account' else consent_source end, updated_at = now() where id = cid;
  return public_sfx_customer_account(p_token);
end $$;

create function public_sfx_customer_signout(p_token text) returns void language sql security definer set search_path = public as $$
  delete from sfx_customer_sessions where token_hash = encode(digest(coalesce(p_token, ''), 'sha256'), 'hex')
$$;

-- WhatsApp sign-in code template (needs approval in WhatsApp Manager before it sends anything).
insert into wa_templates (key, name, audience, title, body, params) values
  ('sfx_login_code', 'auzslab_shop_login_code', 'shop', 'Customer sign-in code', 'Your {{1}} sign-in code is {{2}}. It works for 10 minutes. Do not share it with anyone.', '{shop,code}')
on conflict (key) do nothing;

-- Customers created from orders are not "manual" ones in the list.
alter function sfx_customer_list() rename to sfx_customer_list_pre422;
create function sfx_customer_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin
  return coalesce((select jsonb_agg(case when c.id is not null and c.source <> 'manual' then e || jsonb_build_object('manual', false) else e end
      || case when c.id is not null then jsonb_build_object('acceptsMarketing', c.accepts_marketing, 'creditBalance', c.credit_balance) else '{}'::jsonb end order by ord)
    from jsonb_array_elements(sfx_customer_list_pre422()) with ordinality t(e, ord)
    left join sfx_customers c on c.tenant_id = tid and c.id::text = t.e->>'id'), '[]'::jsonb);
end $$;
grant execute on function sfx_customer_list() to app;

grant execute on function sfx_customer_detail(uuid), sfx_customer_consent(uuid, boolean, text), sfx_credit_adjust(uuid, numeric, text), sfx_refund_record(uuid, jsonb),
  public_sfx_customer_verify(text, text, text), public_sfx_customer_account(text), public_sfx_customer_update(text, jsonb), public_sfx_customer_signout(text) to app;

-- Rollback: drop function sfx_customer_list(); rename sfx_customer_list_pre422 back; drop trigger sfx_orders_customer on sfx_orders; drop function sfx_orders_link_customer(); drop the functions created here;
-- drop function sfx_refund_record(uuid,jsonb) and rename sfx_refund_record_pre422 back; delete from wa_templates where key='sfx_login_code';
-- drop tables sfx_customer_sessions, sfx_customer_codes, sfx_credit_moves, sfx_customer_addresses; drop columns added to sfx_customers and sfx_orders.customer_id.
