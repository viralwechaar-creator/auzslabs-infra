-- AUZsStyle Cloud Sync (Stage 1 -- the plumbing): a generic, per-row change log on every core table, plus the
-- cloud-side machinery to receive those changes and apply them into a paired cloud tenant. One-way for now
-- (offline PC -> cloud); no remote writes come back down yet (that is Stage 3). The offline PC is always the
-- source of truth -- see the ingest function's own comment for exactly how that is enforced.
--
-- How a PC gets "paired" with a cloud tenant: every licence has a `lineage` (db/269) -- a stable identity for one
-- shop across renewals, since a renewal issues a brand-new licence code/id but the same shop. `sty_sync_tenants`
-- remembers which cloud tenant a lineage syncs into; `sty_cloud_sync_ensure_tenant` either reuses one an admin
-- already linked by hand (app_licences.tenant_id), reuses one this lineage already auto-provisioned before, or
-- creates a brand-new bare cloud tenant the first time a sync-enabled PC ever pushes. No manual setup required
-- for the common case -- the first successful sync is also the moment the cloud tenant comes into existence.

-- ---------- the change log (one row per insert/update/delete on a synced table) ----------
create table if not exists sty_change_log (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  tbl text not null,
  row_id uuid not null,
  op text not null check (op in ('upsert', 'delete')),
  row jsonb,                            -- full row (to_jsonb(NEW)); null for a delete
  at timestamptz not null default now()
);
create index if not exists sty_change_log_t on sty_change_log(tenant_id, id);
alter table sty_change_log enable row level security;

create or replace function sty_log_change() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    insert into sty_change_log (tenant_id, tbl, row_id, op) values (OLD.tenant_id, tg_table_name, OLD.id, 'delete');
    return OLD;
  else
    insert into sty_change_log (tenant_id, tbl, row_id, op, row) values (NEW.tenant_id, tg_table_name, NEW.id, 'upsert', to_jsonb(NEW));
    return NEW;
  end if;
end $$;

-- every real retail-data table a shop can change day to day. Settings/audit/holds/shifts/targets are deliberately
-- left out of Stage 1 -- they are either singleton/config rows (settings) or already-derived/operational data that
-- matters less for "the shop's real data exists in two places" than its catalogue, stock, sales and customers do.
do $$
declare t text;
begin
  foreach t in array array['sty_branches', 'sty_styles', 'sty_variants', 'sty_stock_moves', 'sty_suppliers', 'sty_purchases',
    'sty_purchase_lines', 'sty_supplier_payments', 'sty_customers', 'sty_sales', 'sty_sale_lines', 'sty_returns', 'sty_return_lines',
    'sty_transfers', 'sty_transfer_lines'] loop
    execute format('drop trigger if exists sty_change_log_trg on %I', t);
    execute format('create trigger sty_change_log_trg after insert or update or delete on %I for each row execute function sty_log_change()', t);
  end loop;
end $$;

-- ---------- the local PC's own push cursor (how far it has already sent) ----------
create table if not exists sty_sync_cursor (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  last_pushed bigint not null default 0,
  updated_at timestamptz not null default now()
);
alter table sty_sync_cursor enable row level security;

-- ---------- the cloud side: which tenant a given offline install's lineage syncs into ----------
create table if not exists sty_sync_tenants (
  lineage text primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table sty_sync_tenants enable row level security;

-- Deliberately NOT in the RPC registry (same discipline as provision_from_payment, acc_do_post, etc.): the only
-- caller is the cloud server's own /cloud/sync route, which has already verified the licence and its 'sync'
-- add-on over HTTP before ever reaching SQL.
create or replace function sty_cloud_sync_ensure_tenant(p_lineage text, p_shop text) returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid; slug_ text;
begin
  select tenant_id into tid from sty_sync_tenants where lineage = p_lineage;
  if tid is not null then return tid; end if;
  select tenant_id into tid from app_licences where lineage = p_lineage and tenant_id is not null order by issued_at desc limit 1;
  if tid is not null then
    insert into sty_sync_tenants (lineage, tenant_id) values (p_lineage, tid) on conflict (lineage) do nothing;
    return tid;
  end if;
  slug_ := 'sync-' || substr(md5(p_lineage || clock_timestamp()::text), 1, 10);
  insert into tenants (slug, name, niche, plan, status) values (slug_, coalesce(nullif(btrim(p_shop), ''), 'Shop'), 'retail', 'pro', 'active') returning id into tid;
  insert into tenant_settings (tenant_id, features, labels, business_rules)
    select tid, '{"style":true}'::jsonb, p.default_labels, p.default_business_rules from niche_presets p where p.niche = 'retail';
  insert into records (id, tenant_id, kind, data)
    select 'settings', tid, 'settings', p.default_business_rules || jsonb_build_object('name', coalesce(nullif(btrim(p_shop), ''), 'Shop'))
    from niche_presets p where p.niche = 'retail';
  insert into sty_sync_tenants (lineage, tenant_id) values (p_lineage, tid) on conflict (lineage) do nothing
    returning tenant_id into tid;
  if tid is null then select tenant_id into tid from sty_sync_tenants where lineage = p_lineage; end if;
  return tid;
end $$;

-- Applies one pushed change into the cloud tenant. The incoming row's own tenant_id (the PC's LOCAL tenant id,
-- meaningless on the cloud) is always overwritten with the real cloud tenant id -- never trusted from the payload.
-- Stage 1 has no remote writes to conflict with, so this always just applies; Stage 3 will add the "PC always
-- wins" comparison here.
create or replace function sty_cloud_apply_change(p_tenant uuid, p_tbl text, p_row_id uuid, p_op text, p_row jsonb) returns void language plpgsql security definer set search_path = public as $$
declare cols text;
begin
  if p_tbl not in ('sty_branches', 'sty_styles', 'sty_variants', 'sty_stock_moves', 'sty_suppliers', 'sty_purchases',
      'sty_purchase_lines', 'sty_supplier_payments', 'sty_customers', 'sty_sales', 'sty_sale_lines', 'sty_returns', 'sty_return_lines',
      'sty_transfers', 'sty_transfer_lines') then
    raise exception 'unknown sync table %', p_tbl;
  end if;
  if p_op = 'delete' then
    execute format('delete from %I where tenant_id = $1 and id = $2', p_tbl) using p_tenant, p_row_id;
    return;
  end if;
  select string_agg(format('%I = excluded.%I', column_name, column_name), ', ')
    into cols from information_schema.columns where table_schema = 'public' and table_name = p_tbl and column_name <> 'id';
  execute format('insert into %I select * from jsonb_populate_record(null::%I, $1) on conflict (id) do update set %s', p_tbl, p_tbl, cols)
    using (p_row || jsonb_build_object('id', p_row_id, 'tenant_id', p_tenant));
end $$;

-- The ingest entry point: p_changes is [{tbl, rowId, op, row}], in the order the PC's change log produced them
-- (chronological order matters -- a sale_line can only apply once its sale already exists). One bad row (a
-- reference to something not yet synced, a stale FK) is logged and skipped rather than aborting the whole batch,
-- so a single odd record can never jam every change behind it.
create or replace function sty_cloud_sync_push(p_lineage text, p_shop text, p_changes jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; c jsonb; applied int := 0; failed jsonb := '[]'::jsonb;
begin
  tid := sty_cloud_sync_ensure_tenant(p_lineage, p_shop);
  for c in select * from jsonb_array_elements(coalesce(p_changes, '[]'::jsonb)) loop
    begin
      perform sty_cloud_apply_change(tid, c->>'tbl', (c->>'rowId')::uuid, c->>'op', c->'row');
      applied := applied + 1;
    exception when others then
      failed := failed || jsonb_build_object('tbl', c->>'tbl', 'rowId', c->>'rowId', 'error', sqlerrm);
    end;
  end loop;
  return jsonb_build_object('tenantId', tid, 'applied', applied, 'failed', failed);
end $$;
