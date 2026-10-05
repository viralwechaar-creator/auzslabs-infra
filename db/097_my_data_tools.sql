-- Owner self-service: back up, export and clear a business's own data (all apps at once).
-- Everything is SECURITY DEFINER and starts with my_data_owner(), so only the tenant's OWNER can call it, and only for
-- their own tenant. Demo tenants can export but never clear. Logins, roles, add-on/plan records, secrets/PINs and the
-- audit trail are never exported or cleared; setup (settings, chart of accounts, tax codes, pay structures...) is kept.
create table if not exists tenant_data_actions (
  id         bigserial primary key,
  tenant_id  uuid not null,
  user_id    uuid,
  action     text not null,
  detail     jsonb,
  created_at timestamptz not null default now()
);
alter table tenant_data_actions enable row level security;   -- no policies: written/read only by the functions below

create or replace function my_data_owner() returns record language plpgsql stable security definer set search_path = public as $$
declare r record;
begin
  select t.id, t.slug, t.name, t.is_demo, p.id as uid into r
    from profiles p join tenants t on t.id = p.tenant_id
   where p.id = app_uid() and p.role = 'owner';
  if r.id is null then raise exception 'Only the business owner can do this' using errcode = '42501'; end if;
  return r;
end $$;

-- tables never included in an export (secrets, PINs, throttles) and never cleared
create or replace function my_data_secret_tables() returns text[] language sql immutable as
$$ select array['pos_secrets','pos_pins','pos_pin_attempts','pay_pin_fails','account_deletions','tenant_data_actions'] $$;

-- tables kept when clearing: identity, plans, setup/configuration and the audit trail
create or replace function my_data_keep_tables() returns text[] language sql immutable as
$$ select my_data_secret_tables() || array['tenants','tenant_settings','profiles','roles','addon_requests','notifications',
  'mob_settings','acc_org','acc_accounts','acc_taxcodes','acc_fy','acc_series','acc_branches','acc_warehouses','acc_masters','acc_saved_views',
  'pay_org','pay_components','pay_structures','pay_leave_types','pay_shifts','pay_holidays','pay_locations','pay_masters','pay_series','pay_stat_rules',
  'pos_audit','acc_audit','pay_audit','mob_audit'] $$;

create or replace function my_data_export() returns jsonb language plpgsql security definer set search_path = public as $$
declare o record; r record; out jsonb := '{}'::jsonb; rows jsonb; flt text;
begin
  o := my_data_owner();
  for r in
    select c.table_name t from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'tenant_id' and c.table_name <> all (my_data_secret_tables()) and c.table_name <> 'tenants'
    order by 1
  loop
    flt := case r.t when 'salon_store' then ' and key not in (''admin'',''staff'',''db_backup'')' else '' end;
    execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from %I x where tenant_id = $1%s', r.t, flt) into rows using o.id;
    if jsonb_array_length(rows) > 0 then out := out || jsonb_build_object(r.t, rows); end if;
  end loop;
  insert into tenant_data_actions(tenant_id, user_id, action, detail) values (o.id, o.uid, 'export', jsonb_build_object('tables', (select count(*) from jsonb_object_keys(out))));
  return jsonb_build_object('business', jsonb_build_object('slug', o.slug, 'name', o.name), 'exported_at', now(), 'tables', out);
end $$;

create or replace function my_data_clear(p_confirm text) returns jsonb language plpgsql security definer set search_path = public as $$
declare o record; r record; n bigint; summary jsonb := '{}'::jsonb;
begin
  o := my_data_owner();
  if o.is_demo then raise exception 'Demo businesses cannot be cleared' using errcode = 'P0001'; end if;
  if p_confirm is distinct from o.slug then raise exception 'Type your business address name (%) to confirm', o.slug using errcode = 'P0001'; end if;
  set local session_replication_role = replica;   -- append-only guards and FK checks off for this transaction
  for r in
    select c.table_name t from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'tenant_id' and c.table_name <> all (my_data_keep_tables())
  loop
    if r.t = 'records' then
      delete from records where tenant_id = o.id and kind <> 'settings';
    elsif r.t = 'salon_store' then
      delete from salon_store where tenant_id = o.id and key not in ('site','staff','admin');
    else
      execute format('delete from %I where tenant_id = $1', r.t) using o.id;
    end if;
    get diagnostics n = row_count;
    if n > 0 then summary := summary || jsonb_build_object(r.t, n); end if;
  end loop;
  insert into tenant_data_actions(tenant_id, user_id, action, detail) values (o.id, o.uid, 'clear', summary);
  return summary;
end $$;
revoke all on function my_data_owner() from public;
