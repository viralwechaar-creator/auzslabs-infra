-- ONE-TIME CLEAN-UP: delete every client business except the ones listed in keep_slugs below.
-- Keeps: those tenants and all their data, their logins, and platform admins. Deletes everything else
-- (tenant rows, all tenant-scoped data in every app, logins, sessions, sign-in links, pending requests).
--
-- SAFE BY DEFAULT: running it as-is only PRINTS what it would delete and rolls back.
-- To really delete, add  -v confirm=yes  (see docs/DATA_WIPE.md). Take a backup first.
--   set -a; source .env; set +a
--   docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 < db_data/wipe_all_but_demo.sql
\set ON_ERROR_STOP on
begin;
set local session_replication_role = replica;   -- guard triggers (append-only) and FK checks off; needs superuser

create temp table keep_slugs(slug text primary key);
insert into keep_slugs values ('showoffsalon'), ('demo-salon'), ('demo');

-- refuse to run if a kept business is missing (would mean a wrong slug and everything gets deleted)
do $$ declare s text; begin
  for s in select slug from keep_slugs loop
    if not exists (select 1 from tenants where slug = s) then raise exception 'Kept tenant "%" not found. Nothing deleted.', s; end if;
  end loop;
end $$;

create temp table doomed as select id, slug, name from tenants where slug not in (select slug from keep_slugs);
create temp table keep_users as
  select id from profiles where tenant_id in (select id from tenants where slug in (select slug from keep_slugs))
  union select id from platform_admins;

\echo '--- KEEPING:'
select slug, name from tenants where slug in (select slug from keep_slugs) order by 1;
\echo '--- DELETING these businesses:'
select slug, name from doomed order by 1;
\echo '--- DELETING this many logins (kept: owners/staff of the kept businesses and platform admins):'
select count(*) from auth_users where id not in (select id from keep_users);

-- 1. every table with a tenant_id column (and every FK that points at tenants): delete the doomed rows
do $$ declare r record; n bigint; begin
  for r in
    select c.table_name t, c.column_name col from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'tenant_id' and c.table_name <> 'tenants'
    union
    select cl.relname, a.attname from pg_constraint k
      join pg_class cl on cl.oid = k.conrelid join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
      where k.contype = 'f' and k.confrelid = 'public.tenants'::regclass and array_length(k.conkey, 1) = 1
  loop
    execute format('delete from %I where %I in (select id from doomed)', r.t, r.col);
    get diagnostics n = row_count;
    if n > 0 then raise notice '  % rows from %', n, r.t; end if;
  end loop;
end $$;
delete from tenants where id in (select id from doomed);

-- 2. logins that belong to no kept business
delete from auth_users where id not in (select id from keep_users);

-- 3. sweep rows left pointing at something deleted (child tables with no tenant_id, sessions, links, requests)
do $$ declare r record; n bigint; total bigint; pass int := 0; begin
  loop
    total := 0; pass := pass + 1;
    for r in
      select cl.relname child, pc.relname parent, k.confdeltype dt,
        (select string_agg(format('c.%I = p.%I', ca.attname, pa.attname), ' and ' order by u.i)
           from unnest(k.conkey, k.confkey) with ordinality u(c, p, i)
           join pg_attribute ca on ca.attrelid = k.conrelid and ca.attnum = u.c
           join pg_attribute pa on pa.attrelid = k.confrelid and pa.attnum = u.p) cond,
        (select string_agg(format('c.%I is not null', ca.attname), ' and ')
           from unnest(k.conkey) u(c) join pg_attribute ca on ca.attrelid = k.conrelid and ca.attnum = u.c) nn,
        (select string_agg(format('%I = null', ca.attname), ', ')
           from unnest(k.conkey) u(c) join pg_attribute ca on ca.attrelid = k.conrelid and ca.attnum = u.c) setnull
      from pg_constraint k join pg_class cl on cl.oid = k.conrelid join pg_class pc on pc.oid = k.confrelid
      join pg_namespace ns on ns.oid = cl.relnamespace and ns.nspname = 'public'
      where k.contype = 'f'
    loop
      if r.dt = 'n' then
        execute format('update %I c set %s where %s and not exists (select 1 from %I p where %s)', r.child, r.setnull, r.nn, r.parent, r.cond);
      else
        execute format('delete from %I c where %s and not exists (select 1 from %I p where %s)', r.child, r.nn, r.parent, r.cond);
      end if;
      get diagnostics n = row_count; total := total + n;
      if n > 0 then raise notice '  swept % rows in % (pass %)', n, r.child, pass; end if;
    end loop;
    exit when total = 0 or pass > 12;
  end loop;
end $$;

-- 4. tables keyed by text, not by a foreign key
do $$ begin
  if to_regclass('public.staff_pin_fails') is not null then
    execute 'delete from staff_pin_fails where username not in (select username from profiles where username is not null)';
  end if;
end $$;
delete from phone_otps;

\echo '--- AFTER: businesses left'
select slug, name from tenants order by 1;
\echo '--- AFTER: logins left'
select count(*) from auth_users;

\if :{?confirm}
  \echo 'COMMITTED. Data deleted.'
  commit;
\else
  \echo 'DRY RUN only: nothing was deleted. Add  -v confirm=yes  to really delete.'
  rollback;
\endif
