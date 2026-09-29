-- =========================================================
-- "System resources" panel on admin.html: the owner runs this on a
-- single 2 vCPU / 4GB / 75GB DigitalOcean droplet and is onboarding
-- more tenants onto it, so they want to see how close they are to
-- that ceiling instead of guessing. Everything below is derivable
-- from Postgres itself (pg_stat_activity, pg_database_size, counts
-- against records) -- no DigitalOcean metrics API integration, no
-- credentials for that exist anywhere in this stack.
--
-- Uploads storage (disk usage under /data/uploads and
-- /data/private-uploads) can't be reported here -- Postgres has no way
-- to stat a directory on the API container's filesystem. It's reported
-- separately, by walking those directories in Node (getUploadsDiskUsage
-- in server/src/storage.js, no shelling out to `du`), via GET
-- /admin/uploads-usage, and admin.html merges that into the same panel.
-- =========================================================

create function admin_system_stats() returns jsonb
language plpgsql security definer stable set search_path = public as $$
declare
  result jsonb;
begin
  if not is_platform_admin() then
    raise exception 'not authorized';
  end if;

  select jsonb_build_object(
    'tenant_count', (select count(*) from tenants),
    'app_connections', (select count(*) from pg_stat_activity where usename = 'app'),
    'db_size_bytes', pg_database_size(current_database()),
    'records_total', (select count(*) from records),
    'top_tenants_by_rows', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', tn.name, 'slug', tn.slug, 'row_count', rc.row_count
      ) order by rc.row_count desc), '[]'::jsonb)
      from (
        select tenant_id, count(*) as row_count
        from records
        group by tenant_id
        order by count(*) desc
        limit 5
      ) rc
      join tenants tn on tn.id = rc.tenant_id
    )
  ) into result;

  return result;
end;
$$;
