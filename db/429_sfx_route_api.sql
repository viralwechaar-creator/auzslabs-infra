-- Storefront round K: Razorpay Route records, settlements, and a read-only store API with keys.
--  * Route: AUZslab's Razorpay account pays each shop through a linked account. Until AUZslab switches Route on (RAZORPAY_ROUTE_ENABLED) this only stores status.
--    We keep the Razorpay account id, the status and the LAST FOUR digits of the bank account. Full bank and PAN details are sent to Razorpay and never stored here.
--  * Settlements are rows the server writes when Razorpay reports a transfer; owners can only read them.
--  * API keys: shown once, stored as a hash, read-only, one per integration, can be revoked. The API only returns that shop's own data.

create table sfx_route_accounts (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  rzp_account_id text, status text not null default 'not_started' check (status in ('not_started', 'pending', 'needs_info', 'active', 'suspended')),
  legal_name text, business_type text, contact_email text, contact_phone text, bank_last4 text, bank_ifsc text, note text,
  updated_at timestamptz not null default now()
);
alter table sfx_route_accounts enable row level security;
create table sfx_settlements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  order_id uuid references sfx_orders(id) on delete set null,
  rzp_transfer_id text unique, gross numeric(12,2) not null, fee numeric(12,2) not null default 0, net numeric(12,2) not null,
  status text not null default 'pending' check (status in ('pending', 'processed', 'settled', 'reversed', 'failed')), settled_at timestamptz, created_at timestamptz not null default now()
);
create index idx_sfx_settlements on sfx_settlements (tenant_id, created_at desc);
alter table sfx_settlements enable row level security;

create function sfx_route_status() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view'); r sfx_route_accounts;
begin
  if not sfx_perm('sfx_settings') then raise exception 'Your role does not allow this (sfx_settings)' using errcode = '42501'; end if;
  select * into r from sfx_route_accounts where tenant_id = tid;
  return jsonb_build_object('status', coalesce(r.status, 'not_started'), 'legalName', r.legal_name, 'bankLast4', r.bank_last4, 'note', r.note, 'updatedAt', r.updated_at,
    'settled', coalesce((select sum(net) from sfx_settlements where tenant_id = tid and status = 'settled'), 0), 'pending', coalesce((select sum(net) from sfx_settlements where tenant_id = tid and status in ('pending', 'processed')), 0));
end $$;
create function sfx_settlement_list(p_limit int default 100) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin
  if not sfx_perm('sfx_settings') then raise exception 'Your role does not allow this (sfx_settings)' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('order', o.number, 'gross', s.gross, 'fee', s.fee, 'net', s.net, 'status', s.status, 'settledAt', s.settled_at, 'createdAt', s.created_at) order by s.created_at desc)
    from (select * from sfx_settlements where tenant_id = tid order by created_at desc limit greatest(1, least(coalesce(p_limit, 100), 500))) s left join sfx_orders o on o.id = s.order_id), '[]'::jsonb);
end $$;
-- server only (not in the RPC list): called after Razorpay answers
create function sfx_route_set(p_tenant uuid, p jsonb) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into sfx_route_accounts (tenant_id, rzp_account_id, status, legal_name, business_type, contact_email, contact_phone, bank_last4, bank_ifsc, note)
  values (p_tenant, p->>'accountId', coalesce(p->>'status', 'pending'), left(p->>'legalName', 120), left(p->>'businessType', 40), left(p->>'email', 120), left(p->>'phone', 20), right(regexp_replace(coalesce(p->>'bankAccount', ''), '[^0-9]', '', 'g'), 4), left(p->>'ifsc', 11), left(p->>'note', 300))
  on conflict (tenant_id) do update set rzp_account_id = coalesce(excluded.rzp_account_id, sfx_route_accounts.rzp_account_id), status = excluded.status, legal_name = excluded.legal_name, business_type = excluded.business_type,
    contact_email = excluded.contact_email, contact_phone = excluded.contact_phone, bank_last4 = coalesce(nullif(excluded.bank_last4, ''), sfx_route_accounts.bank_last4), bank_ifsc = excluded.bank_ifsc, note = excluded.note, updated_at = now();
end $$;
create function sfx_route_owner_ok(p_user uuid) returns uuid language sql stable security definer set search_path = public as $$
  select tenant_id from profiles where id = p_user and role in ('owner', 'manager')
$$;

-- ---------- API keys ----------
create table sfx_api_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null, prefix text not null, key_hash text not null unique, created_by uuid, created_at timestamptz not null default now(), last_used_at timestamptz, revoked_at timestamptz
);
create index idx_sfx_api_keys on sfx_api_keys (tenant_id);
alter table sfx_api_keys enable row level security;
create function sfx_api_key_create(p_name text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_require('sfx_settings'); raw text; nm text := left(trim(coalesce(p_name, '')), 60);
begin
  if length(nm) < 2 then raise exception 'Give the key a name, like "Accounting export"' using errcode = 'SF002'; end if;
  if (select count(*) from sfx_api_keys where tenant_id = tid and revoked_at is null) >= 10 then raise exception 'Up to 10 active keys. Revoke one first.' using errcode = 'SF002'; end if;
  raw := 'sfx_live_' || encode(gen_random_bytes(24), 'hex');
  insert into sfx_api_keys (tenant_id, name, prefix, key_hash, created_by) values (tid, nm, left(raw, 13), encode(digest(raw, 'sha256'), 'hex'), app_uid());
  perform sfx_audit_log('Created an API key', jsonb_build_object('name', nm));
  return jsonb_build_object('key', raw, 'name', nm, 'note', 'Copy this key now. It will not be shown again.');
end $$;
create function sfx_api_key_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin
  if not sfx_perm('sfx_settings') then raise exception 'Your role does not allow this (sfx_settings)' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'prefix', prefix, 'createdAt', created_at, 'lastUsedAt', last_used_at, 'revoked', revoked_at is not null) order by created_at desc) from sfx_api_keys where tenant_id = tid), '[]'::jsonb);
end $$;
create function sfx_api_key_revoke(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_require('sfx_settings');
begin
  update sfx_api_keys set revoked_at = now() where id = p_id and tenant_id = tid and revoked_at is null;
  perform sfx_audit_log('Revoked an API key', jsonb_build_object('key', p_id));
end $$;
-- server only: who owns this key? Also marks it used (at most once a minute).
create function sfx_api_key_tenant(p_key text) returns uuid language plpgsql security definer set search_path = public as $$
declare k sfx_api_keys;
begin
  select * into k from sfx_api_keys where key_hash = encode(digest(coalesce(p_key, ''), 'sha256'), 'hex') and revoked_at is null;
  if not found then return null; end if;
  if k.last_used_at is null or k.last_used_at < now() - interval '1 minute' then update sfx_api_keys set last_used_at = now() where id = k.id; end if;
  return k.tenant_id;
end $$;
-- server only: read-only data for one shop. Customers' contact details are included only for orders, never listed on their own.
create function sfx_api_read(p_tenant uuid, p_what text, p_limit int, p_after timestamptz) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare lim int := greatest(1, least(coalesce(p_limit, 50), 200));
begin
  if p_what = 'orders' then
    return coalesce((select jsonb_agg(jsonb_build_object('number', o.number, 'status', o.status, 'channel', o.channel, 'fulfilment', o.fulfilment_status, 'delivery', o.delivery_status, 'paymentStatus', o.payment_status,
      'total', o.total, 'subtotal', o.subtotal, 'shipping', o.shipping, 'tax', o.tax, 'discount', o.discount_amount, 'refunded', o.refunded_amount, 'createdAt', o.created_at,
      'customer', jsonb_build_object('name', o.customer->>'name', 'phone', o.customer->>'phone', 'email', o.customer->>'email', 'city', o.customer->>'city'),
      'lines', (select jsonb_agg(jsonb_build_object('name', l->>'name', 'variant', l->>'label', 'price', l->'price', 'qty', l->'qty')) from jsonb_array_elements(o.lines) l)) order by o.created_at desc)
      from (select * from sfx_orders where tenant_id = p_tenant and not is_test and (p_after is null or created_at > p_after) order by created_at desc limit lim) o), '[]'::jsonb);
  elsif p_what = 'products' then
    return coalesce((select jsonb_agg(jsonb_build_object('name', p.name, 'handle', p.handle, 'status', p.status, 'price', p.price, 'category', p.category,
      'variants', (select jsonb_agg(jsonb_build_object('label', v.label, 'sku', v.sku, 'price', v.price, 'stock', v.stock)) from sfx_variants v where v.product_id = p.id)) order by p.name)
      from (select * from sfx_products where tenant_id = p_tenant order by name limit lim) p), '[]'::jsonb);
  elsif p_what = 'inventory' then
    return coalesce((select jsonb_agg(jsonb_build_object('product', p.name, 'variant', v.label, 'sku', v.sku, 'available', v.stock, 'unavailable', v.unavailable) order by p.name, v.label)
      from (select * from sfx_variants where tenant_id = p_tenant order by id limit lim) v join sfx_products p on p.id = v.product_id), '[]'::jsonb);
  end if;
  return null;
end $$;

grant select, insert, update, delete on sfx_route_accounts, sfx_settlements, sfx_api_keys to app;
grant execute on function sfx_route_status(), sfx_settlement_list(int), sfx_api_key_create(text), sfx_api_key_list(), sfx_api_key_revoke(uuid) to app;

-- Rollback: drop functions sfx_route_status, sfx_settlement_list, sfx_route_set, sfx_route_owner_ok, sfx_api_key_create, sfx_api_key_list, sfx_api_key_revoke, sfx_api_key_tenant, sfx_api_read; drop tables sfx_api_keys, sfx_settlements, sfx_route_accounts.
