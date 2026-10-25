-- Cloud storage extra for the installed (offline) AUZsStyle: the computer sends an encrypted-in-transit copy of its data to AUZslab when it is online
-- and the shop's licence includes "cloud". Files live on the server disk; this table is the list. A shop keeps ONE identity (lineage) across renewals
-- even though every licence code is new (the admin picks "renewal for" when making a code). Only the server touches these tables.
alter table app_licences add column if not exists code_id text;
alter table app_licences add column if not exists lineage text;

create table if not exists cloud_backups (
  id uuid primary key default gen_random_uuid(),
  lineage text not null,
  size bigint not null,
  sha256 text,
  made_at timestamptz not null,
  uploaded_at timestamptz not null default now(),
  device text,
  app_version text,
  file text not null
);
create index if not exists cloud_backups_lineage_idx on cloud_backups (lineage, made_at desc);
alter table cloud_backups enable row level security;

-- codes made before this migration (or outside the admin screen) are their own lineage
create or replace function cloud_lineage(p_code_id text) returns text language sql stable security definer set search_path = public as $$
  select coalesce((select l.lineage from app_licences l where l.code_id = p_code_id and l.lineage is not null limit 1), p_code_id)
$$;

create or replace function cloud_backup_add(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  insert into cloud_backups (lineage, size, sha256, made_at, device, app_version, file)
  values (p->>'lineage', (p->>'size')::bigint, p->>'sha256', coalesce((p->>'madeAt')::timestamptz, now()), left(p->>'device', 80), left(p->>'appVersion', 40), p->>'file')
  returning id into v_id;
  return v_id;
end $$;

create or replace function cloud_backup_list(p_lineage text) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'size', b.size, 'madeAt', b.made_at, 'uploadedAt', b.uploaded_at, 'device', b.device, 'appVersion', b.app_version) order by b.made_at desc), '[]'::jsonb)
  from cloud_backups b where b.lineage = p_lineage
$$;

create or replace function cloud_backup_file(p_lineage text, p_id uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(b) from cloud_backups b where b.lineage = p_lineage and b.id = p_id
$$;

-- keeps the newest p_keep copies; returns the files of the others so the server can delete them from disk
create or replace function cloud_backup_prune(p_lineage text, p_keep int) returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  with old as (select id, file from cloud_backups where lineage = p_lineage order by made_at desc offset greatest(p_keep, 1)),
       del as (delete from cloud_backups b using old where b.id = old.id returning old.file)
  select coalesce(jsonb_agg(file), '[]'::jsonb) into v from del;
  return v;
end $$;

-- the licence maker also remembers the code's id and which shop it renews
create or replace function admin_log_licence(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_code_id text := nullif(p->>'codeId', '');
begin
  if not is_platform_admin() then raise exception 'forbidden'; end if;
  insert into app_licences (shop, tenant_id, plan_end, addons, code, note, issued_by, code_id, lineage)
  values (p->>'shop', nullif(p->>'tenantId','')::uuid, (p->>'end')::date, coalesce(p->'addons','{}'::jsonb), p->>'code', nullif(p->>'note',''), app_uid(), v_code_id, coalesce(nullif(p->>'renewOf', ''), v_code_id))
  returning id into v_id;
  perform admin_log('licence_issued', 'licence', v_id::text, jsonb_build_object('shop', p->>'shop', 'end', p->>'end', 'addons', p->'addons'));
  return jsonb_build_object('id', v_id);
end $$;

create or replace function admin_list_licences() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'shop', l.shop, 'end', l.plan_end, 'addons', l.addons, 'code', l.code, 'note', l.note, 'issuedAt', l.issued_at,
    'daysLeft', (l.plan_end - current_date), 'lineage', l.lineage,
    'backups', (select count(*) from cloud_backups b where b.lineage = l.lineage),
    'backupBytes', (select coalesce(sum(size), 0) from cloud_backups b where b.lineage = l.lineage),
    'lastBackup', (select max(made_at) from cloud_backups b where b.lineage = l.lineage)) order by l.issued_at desc) from app_licences l), '[]'::jsonb);
end $$;
