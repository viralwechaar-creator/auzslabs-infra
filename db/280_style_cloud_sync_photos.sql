-- AUZsStyle Cloud Sync, Stage 6: product photos. Stages 1-5 sync the DATA rows (sty_change_log) but a style's
-- photo (photo_url / photos / colour_photos) is just a URL pointing at a file that only ever existed on the
-- offline PC's own disk -- nobody signed into the cloud tenant remotely could ever see a picture, only a broken
-- image icon. sync-worker.js now uploads the actual file the first time a push would carry a still-local photo
-- URL, and rewrites the row to the cloud copy's URL before sending -- see its own comments for the detection
-- rule (any /uploads/site/... path) and server/src/storage.js's saveCloudSyncUpload for where the file lands.

-- Local-only cache, on the OFFLINE PC's own database (this migration also runs on the cloud, where it is simply
-- never used -- same file, same schema everywhere, nothing cloud-specific about the table itself): which local
-- photo URLs have already been uploaded and what cloud URL they got, so an unrelated field changing on the same
-- style does not re-upload the same picture on every single push.
create table if not exists sty_sync_photo_map (
  tenant_id uuid not null references tenants(id) on delete cascade,
  local_url text not null,
  cloud_url text not null,
  uploaded_at timestamptz not null default now(),
  primary key (tenant_id, local_url)
);
alter table sty_sync_photo_map enable row level security;

-- Real bug, caught by Stage 6's own test (the first thing to actually exercise pushOnce()/pullOnce() live rather
-- than the SQL or the cloud ingest route directly): `tenants` is RLS-hidden from the app role, the same gotcha
-- offline_setup_needed() (db/268) already works around -- sync-worker.js's `select id from tenants limit 1`
-- could never see any row either, on any real offline install, so Cloud Sync's push and pull have silently done
-- nothing since Stage 1. An offline install never has more than one tenant, so this is that same function's
-- mirror image.
create or replace function offline_my_tenant_id() returns uuid language sql stable security definer set search_path = public as $$
  select id from tenants order by created_at desc limit 1
$$;

-- The SAME problem, one level deeper: the installed app's own hardening (desktop-style/lib/setup.cjs's REVOKE,
-- run once after a fresh first build) revokes the app role's direct access to every sty_/pay_/mob_/acc_/fin_
-- table outright, specifically so it can only ever be reached through a database function -- exactly the thing
-- sync-worker.js's own plain `pool.query(...select/insert from sty_change_log/sty_sync_cursor/sty_sync_photo_map)`
-- calls did not do. Every one of those now goes through a function below instead, same shape as the rest of this
-- codebase already uses for every other sty_* access.
create or replace function offline_sync_changes_since(p_since bigint, p_limit int) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'tbl', tbl, 'rowId', row_id, 'op', op, 'row', row) order by id), '[]'::jsonb)
  from (select id, tbl, row_id, op, row from sty_change_log where tenant_id = offline_my_tenant_id() and id > p_since order by id asc limit p_limit) x
$$;
create or replace function offline_sync_last_pushed() returns bigint language sql stable security definer set search_path = public as $$
  select coalesce((select last_pushed from sty_sync_cursor where tenant_id = offline_my_tenant_id()), 0)
$$;
create or replace function offline_sync_set_last_pushed(p bigint) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into sty_sync_cursor (tenant_id, last_pushed, updated_at) values (offline_my_tenant_id(), p, now())
  on conflict (tenant_id) do update set last_pushed = excluded.last_pushed, updated_at = now();
end $$;
create or replace function offline_sync_last_pulled() returns bigint language sql stable security definer set search_path = public as $$
  select coalesce((select last_pulled from sty_sync_cursor where tenant_id = offline_my_tenant_id()), 0)
$$;
create or replace function offline_sync_set_last_pulled(p bigint) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into sty_sync_cursor (tenant_id, last_pulled, updated_at) values (offline_my_tenant_id(), p, now())
  on conflict (tenant_id) do update set last_pulled = excluded.last_pulled, updated_at = now();
end $$;
create or replace function offline_sync_photo_cached(p_local_url text) returns text language sql stable security definer set search_path = public as $$
  select cloud_url from sty_sync_photo_map where tenant_id = offline_my_tenant_id() and local_url = p_local_url
$$;
create or replace function offline_sync_photo_cache_set(p_local_url text, p_cloud_url text) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into sty_sync_photo_map (tenant_id, local_url, cloud_url) values (offline_my_tenant_id(), p_local_url, p_cloud_url)
  on conflict (tenant_id, local_url) do update set cloud_url = excluded.cloud_url;
end $$;

-- Cloud side only: the photo-upload route needs the cloud tenant's slug (to build its public URL and its folder),
-- which sty_cloud_sync_ensure_tenant already resolves/creates -- this just also hands back the slug, since
-- `tenants` itself is RLS-hidden from the app role and the route has no other safe way to read it.
create or replace function sty_cloud_sync_tenant_slug(p_lineage text, p_shop text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; slug_ text;
begin
  tid := sty_cloud_sync_ensure_tenant(p_lineage, p_shop);
  select slug into slug_ from tenants where id = tid;
  return jsonb_build_object('tenantId', tid, 'slug', slug_);
end $$;

-- Rollback: drop function sty_cloud_sync_tenant_slug(text,text); drop function offline_sync_photo_cache_set(text,text);
-- drop function offline_sync_photo_cached(text); drop function offline_sync_set_last_pulled(bigint); drop function offline_sync_last_pulled();
-- drop function offline_sync_set_last_pushed(bigint); drop function offline_sync_last_pushed(); drop function offline_sync_changes_since(bigint,int);
-- drop function offline_my_tenant_id(); drop table sty_sync_photo_map;
