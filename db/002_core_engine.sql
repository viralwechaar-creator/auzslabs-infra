-- =========================================================
-- The generic POS/CRM engine — proven live in OG Book Cafe
-- production, made tenant-aware here. This is the one data
-- model every client runs on regardless of niche.
--
-- One generic `records` table with a `kind` discriminator
-- covers menu items, categories, tables, expenses, shifts,
-- ingredients, waste, void log, and settings overrides — a
-- new niche's concept (a salon's stylist, a gym's trainer) is
-- just a new kind value, never a new table or a migration.
-- Real scheduling (`bookings`, for niches that need actual
-- slot-conflict checking) lives in 003_bookings.sql instead,
-- since that's the one thing worth a real table with real
-- date/time columns.
-- =========================================================

-- profiles: one row per login, admin-provisioned at onboarding
-- (tenant_id + role staged in auth.users.raw_app_meta_data by
-- the control console — see on_signup() below), never self-signup
-- across tenants.
create table profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  tenant_id  uuid not null references tenants(id),
  email      text,
  role       text not null default 'cashier' check (role in ('owner','manager','cashier'))
);
create index idx_profiles_tenant_id on profiles (tenant_id);
alter table profiles enable row level security;

-- resolves the caller's role + tenant once; every policy/function
-- below uses this instead of re-querying profiles each time.
create function me() returns jsonb language sql security definer stable set search_path = public as $$
  select jsonb_build_object('role', role, 'tenant_id', tenant_id)
  from profiles where id = auth.uid()
$$;

create policy p_read on profiles for select
  using (id = auth.uid() or ((me()->>'role') = 'owner' and tenant_id = (me()->>'tenant_id')::uuid));
create policy p_set on profiles for update
  using ((me()->>'role') = 'owner' and tenant_id = (me()->>'tenant_id')::uuid);

-- records: orders, expenses, shifts, ingredients, waste, void
-- log, menu items, categories, tables, settings overrides — one
-- generic table, a `kind` discriminator, tenant-scoped.
create table records (
  id          text not null,
  tenant_id   uuid not null references tenants(id),
  kind        text not null,
  data        jsonb not null,
  deleted     boolean not null default false,
  author      uuid default auth.uid(),
  updated_at  timestamptz not null default now(),
  primary key (tenant_id, id)
);
create index idx_records_tenant_updated on records (tenant_id, updated_at);
alter table records enable row level security;

create policy r_read on records for select
  using (me() is not null and tenant_id = (me()->>'tenant_id')::uuid);
create policy r_ins on records for insert
  with check (
    me() is not null and tenant_id = (me()->>'tenant_id')::uuid
    and (kind in ('order','exp','shift','ing','waste','voidlog') or (me()->>'role') = 'owner')
  );
create policy r_upd on records for update
  using (
    me() is not null and tenant_id = (me()->>'tenant_id')::uuid
    and (kind in ('order','exp','shift','ing','waste','voidlog') or (me()->>'role') = 'owner')
  )
  with check (
    me() is not null and tenant_id = (me()->>'tenant_id')::uuid
    and (kind in ('order','exp','shift','ing','waste','voidlog') or (me()->>'role') = 'owner')
  );
alter publication supabase_realtime add table records;

-- Admin-provisioned signup: expects tenant_id + role already
-- staged in raw_app_meta_data by the control console at invite
-- time. Production's version made "first user ever" the owner —
-- that breaks the instant a second tenant exists.
create function on_signup() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, tenant_id, email, role)
  values (
    new.id,
    (new.raw_app_meta_data->>'tenant_id')::uuid,
    new.email,
    coalesce(new.raw_app_meta_data->>'role', 'cashier')
  );
  return new;
end $$;
create trigger t_signup after insert on auth.users for each row execute function on_signup();

create function touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger t_touch before insert or update on records for each row execute function touch();

-- guest_orders: self-order via table QR, tenant-scoped
create table guest_orders (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  tbl         text not null,
  name        text not null,
  phone       text not null,
  note        text,
  items       jsonb not null,
  status      text not null default 'new',
  created_at  timestamptz not null default now()
);
create index idx_guest_orders_tenant_id on guest_orders (tenant_id);
alter table guest_orders enable row level security;
create policy g_read on guest_orders for select
  using (me() is not null and tenant_id = (me()->>'tenant_id')::uuid);
create policy g_upd on guest_orders for update
  using (me() is not null and tenant_id = (me()->>'tenant_id')::uuid)
  with check (me() is not null and tenant_id = (me()->>'tenant_id')::uuid);
alter publication supabase_realtime add table guest_orders;

-- public_menu / place_order: called by anon (no login), so both
-- take the tenant SLUG from the subdomain and resolve tenant_id
-- server-side — the anonymous caller is never trusted to pass a
-- raw tenant_id directly.
--
-- `cfg` here is the client's OWN editable business settings — the
-- exact same `records` row (kind='settings', id='settings') the
-- authenticated admin app already reads and writes via cfg() in
-- index.html, completely unchanged (name/addr/phone/tax/prefix/
-- col/logo/ftr/w/sty/fs/gw). tenant_settings (features/plan/niche)
-- is separate, AUZlabs-controlled platform config the client
-- can't edit themselves — merged in here only so the public site
-- knows which modules are switched on (e.g. self_order).
create function public_menu(tenant_slug text) returns jsonb language sql security definer stable set search_path = public as $$
  select jsonb_build_object(
    'items',  coalesce((select jsonb_agg(r.data) from records r join tenants t on t.id = r.tenant_id where t.slug = tenant_slug and r.kind = 'item'  and not r.deleted), '[]'::jsonb),
    'cats',   coalesce((select jsonb_agg(r.data) from records r join tenants t on t.id = r.tenant_id where t.slug = tenant_slug and r.kind = 'cat'   and not r.deleted), '[]'::jsonb),
    'tables', coalesce((select jsonb_agg(r.data) from records r join tenants t on t.id = r.tenant_id where t.slug = tenant_slug and r.kind = 'table' and not r.deleted), '[]'::jsonb),
    'cfg',    coalesce((
                select r.data || jsonb_build_object('_features', coalesce(ts.features, '{}'::jsonb))
                from records r
                join tenants t on t.id = r.tenant_id
                left join tenant_settings ts on ts.tenant_id = t.id
                where t.slug = tenant_slug and r.kind = 'settings' and r.id = 'settings'
              ), '{}'::jsonb)
  )
$$;
grant execute on function public_menu(text) to anon;

create function place_order(tenant_slug text, t text, n text, p text, nt text, its jsonb) returns void language plpgsql security definer set search_path = public as $$
declare cnt int; tid uuid;
begin
  select id into tid from tenants where slug = tenant_slug;
  if tid is null then raise exception 'unknown tenant'; end if;

  select count(*) into cnt from guest_orders where tenant_id = tid and tbl = t and status = 'new' and created_at > now() - interval '30 minutes';
  if cnt >= 5 then raise exception 'busy: too many pending orders for this table'; end if;

  insert into guest_orders (tenant_id, tbl, name, phone, note, items) values (tid, t, n, p, nt, its);
end;
$$;
grant execute on function place_order(text,text,text,text,text,jsonb) to anon;

-- public_invoice: token is already globally unguessable (random,
-- not the sequential invoice number). `cfg` here is the same
-- client-editable settings record as public_menu, looked up
-- through the order's own tenant_id — no client-supplied tenant
-- input at all, since the token alone determines both.
create function public_invoice(oid text) returns jsonb language sql security definer stable set search_path = public as $$
  select jsonb_build_object(
    'order', (select data from records where kind = 'order' and not deleted and data->>'tok' = oid order by (data->>'paidAt') desc nulls last limit 1),
    'cfg', coalesce((
      select s.data
      from records r
      join records s on s.tenant_id = r.tenant_id and s.kind = 'settings' and s.id = 'settings'
      where r.kind = 'order' and r.data->>'tok' = oid limit 1
    ), '{}'::jsonb)
  )
$$;
grant execute on function public_invoice(text) to anon;
create index if not exists records_order_tok_idx on records (((data->>'tok'))) where kind = 'order';

-- next_invoice_no: a counter per tenant instead of one global
-- sequence, so one client's invoice count never leaks through
-- another client's numbering.
create table invoice_counters (
  tenant_id  uuid primary key references tenants(id),
  seq        bigint not null default 0
);
create function next_invoice_no(prefix text) returns text language plpgsql security definer set search_path = public as $$
declare n bigint; tid uuid;
begin
  if me() is null then raise exception 'not authorized'; end if;
  tid := (me()->>'tenant_id')::uuid;

  insert into invoice_counters (tenant_id, seq) values (tid, 1)
    on conflict (tenant_id) do update set seq = invoice_counters.seq + 1
    returning seq into n;

  return prefix || '-' || lpad(n::text, 6, '0');
end $$;
revoke execute on function next_invoice_no(text) from public;
grant execute on function next_invoice_no(text) to authenticated;

-- push_record: identical optimistic-concurrency logic to
-- production — rejects a write whose `base` no longer matches
-- the current row instead of silently overwriting it — now
-- resolving tenant_id from the caller's own profile rather than
-- trusting a parameter.
create function push_record(rid text, rkind text, rdata jsonb, rdeleted boolean, base timestamptz, force boolean default false) returns jsonb language plpgsql security definer set search_path = public as $$
declare cur timestamptz; conflict boolean := false; newv timestamptz; tid uuid;
begin
  tid := (me()->>'tenant_id')::uuid;
  if tid is null or not (rkind in ('order','exp','shift','ing','waste','voidlog') or (me()->>'role') = 'owner') then
    raise exception 'not authorized';
  end if;

  select updated_at into cur from records where tenant_id = tid and id = rid;

  if cur is null then
    insert into records (id, tenant_id, kind, data, deleted) values (rid, tid, rkind, rdata, rdeleted) returning updated_at into newv;
  elsif force or base is null or cur = base then
    update records set kind = rkind, data = rdata, deleted = rdeleted where tenant_id = tid and id = rid returning updated_at into newv;
  else
    conflict := true; newv := cur;
  end if;

  return jsonb_build_object('ok', not conflict, 'conflict', conflict, 'server_updated_at', newv);
end $$;
revoke execute on function push_record(text,text,jsonb,boolean,timestamptz,boolean) from public;
grant execute on function push_record(text,text,jsonb,boolean,timestamptz,boolean) to authenticated;

-- Storage: one shared 'site' bucket, paths prefixed by tenant
-- slug (e.g. 'ogbookcafe/hero.jpg') so RLS can isolate uploads
-- per client inside a single bucket.
insert into storage.buckets (id, name, public) values ('site','site', true) on conflict (id) do nothing;
create policy site_public_read on storage.objects for select using (bucket_id = 'site');
create policy site_owner_write on storage.objects for insert
  with check (
    bucket_id = 'site' and (me()->>'role') = 'owner'
    and (storage.foldername(name))[1] = (select slug from tenants where id = (me()->>'tenant_id')::uuid)
  );
create policy site_owner_update on storage.objects for update
  using (
    bucket_id = 'site' and (me()->>'role') = 'owner'
    and (storage.foldername(name))[1] = (select slug from tenants where id = (me()->>'tenant_id')::uuid)
  );
create policy site_owner_delete on storage.objects for delete
  using (
    bucket_id = 'site' and (me()->>'role') = 'owner'
    and (storage.foldername(name))[1] = (select slug from tenants where id = (me()->>'tenant_id')::uuid)
  );

-- push_subs: tenant-scoped device subscriptions for Web Push
create table push_subs (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id),
  user_id     uuid references auth.users(id) on delete cascade,
  endpoint    text unique not null,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);
alter table push_subs enable row level security;
create policy ps_ins on push_subs for insert with check (me() is not null and user_id = auth.uid());
create policy ps_read on push_subs for select using (me() is not null and user_id = auth.uid());
create policy ps_upd on push_subs for update using (me() is not null and user_id = auth.uid()) with check (me() is not null and user_id = auth.uid());
create policy ps_del on push_subs for delete using (me() is not null and user_id = auth.uid());

-- notify_push / notify_order_change / notify_guest_order: same
-- shape as production, but the shared secret moves to Supabase
-- Vault (never a literal in this file — see security note),
-- and every call now carries tenant_id so ONE shared Edge
-- Function can notify only that tenant's devices, not everyone's.
create extension if not exists pg_net;

create function notify_push(p_tenant_id uuid, title text, body text) returns void language plpgsql as $$
declare trigger_secret text; edge_url text;
begin
  select decrypted_secret into trigger_secret from vault.decrypted_secrets where name = 'push_trigger_secret';
  edge_url := current_setting('app.settings.push_edge_url', true);

  perform net.http_post(
    url := edge_url,
    headers := jsonb_build_object('Content-Type','application/json','x-trigger-secret', trigger_secret),
    body := jsonb_build_object('tenant_id', p_tenant_id, 'title', title, 'body', body)
  );
end $$;

create function notify_order_change() returns trigger language plpgsql as $$
declare kstat_old text; kstat_new text;
begin
  if NEW.kind <> 'order' or NEW.deleted then return NEW; end if;
  kstat_new := NEW.data->>'kstat';
  kstat_old := case when TG_OP = 'UPDATE' then OLD.data->>'kstat' else null end;
  if kstat_new is distinct from kstat_old and kstat_new in ('new','ready') then
    perform notify_push(
      NEW.tenant_id,
      case kstat_new when 'new' then 'New order' else 'Order ready' end,
      coalesce(NEW.data->>'no','Order') || ' · ' || coalesce(NEW.data->'cust'->>'name','')
    );
  end if;
  return NEW;
end $$;
create trigger t_notify_order after insert or update on records for each row execute function notify_order_change();

create function notify_guest_order() returns trigger language plpgsql as $$
begin
  if NEW.status = 'new' then
    perform notify_push(NEW.tenant_id, 'New self-order', coalesce(NEW.name,'A guest') || ' via table QR');
  end if;
  return NEW;
end $$;
create trigger t_notify_guest after insert on guest_orders for each row execute function notify_guest_order();
