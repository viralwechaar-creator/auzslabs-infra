-- REMOVE THE TEAM WORKSPACE AND ITS TRIALS (owner request, Oct 2026).
-- DELETES: every trial business (is_trial, or made by a team member, never a demo) with all its data in every app, the logins of
--        its owner and staff, every team member's login, and all team data (leads' notes, tasks, client setups, activity, applications).
-- KEEPS: every other business, platform admins, leads themselves, bills and payments.
-- SAFE BY DEFAULT: prints what it would do and rolls back. Add  -v confirm=yes  to really do it. TAKE A BACKUP FIRST.
--   set -a; source .env; set +a
--   docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > ~/backup-before-team-removal.sql
--   docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 < db_data/remove_team_and_trials.sql
\set ON_ERROR_STOP on
begin;
set local session_replication_role = replica;

create temp table doomed as
  select id, slug, name from tenants
  where coalesce(is_demo, false) = false and (coalesce(is_trial, false) = true or created_by_salesman is not null);
create temp table team_users as select id from platform_salesmen where id not in (select id from platform_admins);
create temp table doomed_users as
  select id from profiles where tenant_id in (select id from doomed)
  union select id from team_users;
-- never delete a login that owns a business we keep
delete from doomed_users where id in (select id from profiles where tenant_id not in (select id from doomed));
delete from doomed_users where id in (select id from platform_admins);

\echo '--- DELETING these trial businesses:'
select slug, name from doomed order by 1;
\echo '--- DELETING these logins:'
select email from auth_users where id in (select id from doomed_users) order by 1;
\echo '--- team members:'
select count(*) from platform_salesmen;

do $$ declare t text; begin
  foreach t in array array['team_tasks','team_activity','setup_assignments','lead_notes','team_applications','platform_salesmen'] loop
    if to_regclass('public.'||t) is not null then execute format('delete from %I', t); end if;
  end loop;
end $$;

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

-- 2. the logins
delete from auth_users where id in (select id from doomed_users);

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

do $$ begin
  if to_regclass('public.staff_pin_fails') is not null then
    execute 'delete from staff_pin_fails where username not in (select username from profiles where username is not null)';
  end if;
end $$;

\echo '--- AFTER: businesses left'
select count(*) from tenants;

\if :{?confirm}
  \echo 'COMMITTED. Team workspace data and trials removed.'
  commit;
\else
  \echo 'DRY RUN only: nothing was deleted. Add  -v confirm=yes  to really do it.'
  rollback;
\endif
