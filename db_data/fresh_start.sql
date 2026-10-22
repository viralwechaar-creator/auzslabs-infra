-- FRESH START (owner request, Oct 2026): every client was a trial, so start clean and onboard real clients from now.
--
-- KEEPS: showoffsalon (becomes THE live salon demo), arpittraders (AUZsMob demo), newbookworld (AUZsScan / AUZsLedger /
--        AUZsPay demo), Genx Clothes (AUZsStyle demo, found by name or slug starting "genx"; all its data and images are kept), demo (the shared AUZslab Demo business), platform admins, team members and their logins, leads.
-- DELETES: every other business and all its data in every app, their logins, sessions and sign-in links; EVERY client bill,
--        quote and client payment record (and restarts bill numbering at 0001).
-- CLEARS the real business data of arpittraders and newbookworld (Genx keeps ALL its data) (their setup, settings, logins and staff stay).
-- MAKES showoffsalon a demo: its real bookings, clients, bills and expenses are removed (its menu, photos and website stay),
--        it is marked is_demo (no uploads, no password changes, no real messages) and it gets a public demo login.
--
-- SAFE BY DEFAULT: as-is it only PRINTS what it would do and rolls back. Add  -v confirm=yes  to really do it. TAKE A BACKUP FIRST.
--   set -a; source .env; set +a
--   docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > ~/backup-before-fresh-start.sql
--   docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 < db_data/fresh_start.sql
\set ON_ERROR_STOP on
begin;
set local session_replication_role = replica;   -- guard triggers (append-only) and FK checks off; needs superuser

create temp table keep_slugs(slug text primary key);
insert into keep_slugs values ('showoffsalon'), ('arpittraders'), ('newbookworld'), ('demo');
-- the AUZsStyle demo: the business whose slug or name starts with "genx" (must be exactly one)
do $$ declare n int; begin
  select count(*) into n from tenants where slug ilike 'genx%' or name ilike 'genx%';
  if n <> 1 then raise exception 'Expected exactly one Genx business, found %. Nothing deleted. Check the slug and edit this script.', n; end if;
end $$;
insert into keep_slugs select slug from tenants where slug ilike 'genx%' or name ilike 'genx%';
-- demos whose real business data is cleared (setup and logins stay). Genx is NOT here: its data and images are kept untouched.
create temp table app_demos(slug text primary key);
insert into app_demos values ('arpittraders'), ('newbookworld');

do $$ declare s text; begin
  for s in select slug from keep_slugs loop
    if not exists (select 1 from tenants where slug = s) then raise exception 'Kept business "%" not found. Nothing deleted.', s; end if;
  end loop;
end $$;

create temp table doomed as select id, slug, name from tenants where slug not in (select slug from keep_slugs);
create temp table keep_users as
  select id from profiles where tenant_id in (select id from tenants where slug in (select slug from keep_slugs))
  union select id from platform_admins
  union select id from platform_salesmen;

create temp table doomed_users as
  select p.id from profiles p where p.tenant_id in (select id from doomed) and p.id not in (select id from keep_users);

\echo '--- KEEPING:'
select slug, name, niche from tenants where slug in (select slug from keep_slugs) order by 1;
\echo '--- DELETING these businesses:'
select t.slug, t.name, t.niche, t.is_demo, t.is_trial from doomed d join tenants t on t.id = d.id order by 1;
\echo '--- DELETING these logins (owners and staff of the deleted businesses only; other logins, e.g. prospects and team members, are left alone):'
select email from auth_users where id in (select id from doomed_users) order by 1;
\echo '--- DELETING all client bills, quotes and payments:'
select (select count(*) from client_orders) as quotes_and_bills, (select count(*) from client_payments) as recorded_payments, (select count(*) from payments) as online_payments;

-- bills, quotes and payments: all of them, and the numbering starts again at 0001
delete from client_orders;
delete from client_order_counters;
delete from client_payments;
delete from payments;

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

-- 4. tables keyed by text, not by a foreign key
do $$ begin
  if to_regclass('public.staff_pin_fails') is not null then
    execute 'delete from staff_pin_fails where username not in (select username from profiles where username is not null)';
  end if;
end $$;
delete from phone_otps;


-- clear the real business data of the two app demos (same rules as the owner's own "clear all data": setup, settings, logins and audit stay)
do $$ declare r record; t record; n bigint; begin
  for t in select id, slug from tenants where slug in (select slug from app_demos) loop
    for r in
      select c.table_name tn from information_schema.columns c
      join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
      where c.table_schema = 'public' and c.column_name = 'tenant_id' and c.table_name <> all (my_data_keep_tables())
        and c.table_name <> all (array['sty_settings','sty_branches','sty_store','sty_store_secrets'])   -- AUZsStyle setup stays
    loop
      if r.tn = 'records' then delete from records where tenant_id = t.id and kind <> 'settings';
      elsif r.tn = 'salon_store' then delete from salon_store where tenant_id = t.id and key not in ('site','staff','admin');
      else execute format('delete from %I where tenant_id = $1', r.tn) using t.id; end if;
      get diagnostics n = row_count;
      if n > 0 then raise notice '  % : % rows removed from %', t.slug, n, r.tn; end if;
    end loop;
  end loop;
end $$;

-- Showoff Salon becomes the live salon demo: remove real customers' data, keep the menu / photos / website (menu, stylists, settings)
do $$ declare t uuid; n bigint; begin
  select id into t from tenants where slug = 'showoffsalon';
  delete from bookings where tenant_id = t;                                     get diagnostics n = row_count; raise notice '  showoffsalon : % bookings removed', n;
  delete from records where tenant_id = t and kind in ('salon_invoice','salon_expense','salon_cashlog','salon_client','salon_package','salon_client_package','salon_checkin','salon_staff','salon_admin');
  get diagnostics n = row_count; raise notice '  showoffsalon : % bill/client/expense records removed', n;
  delete from salon_store where tenant_id = t and key not in ('site', 'staff', 'admin');   -- the old single-document copy of bookings/bills
  update salon_store set data = '{"list":[]}'::jsonb where tenant_id = t and key = 'staff';   -- real staff logins out, demo staff added below
  delete from salon_store where tenant_id = t and key = 'admin';                                 -- console lockouts / own console password
  update tenants set is_demo = true, is_trial = false where id = t;
end $$;


-- demo logins for Showoff Salon (done with triggers back on, so the business profile rows are created): owner console password
-- Auzslab@Demo (same as every other demo) and staff priya.showoffsalon / PIN 1234
set local session_replication_role = origin;
do $$ declare tid uuid; uid uuid; demo_hash text; begin
  select id into tid from tenants where slug = 'showoffsalon';
  select password_hash into demo_hash from auth_users where email = 'demo@auzslab.in';
  if demo_hash is null then raise exception 'demo@auzslab.in not found: cannot copy the shared demo password'; end if;
  select id into uid from auth_users where email = 'showoffsalon-demo@auzslab.in';
  if uid is null then
    insert into auth_users (email, password_hash, app_metadata, user_metadata)
    values ('showoffsalon-demo@auzslab.in', demo_hash, jsonb_build_object('tenant_id', tid, 'role', 'owner', 'email_verified', true), jsonb_build_object('full_name', 'Demo owner'));
  end if;
  select id into uid from auth_users where lower(username) = 'priya.showoffsalon' and deleted_at is null;
  if uid is null then
    insert into auth_users (email, password_hash, username, pin_hash, pin_fp, app_metadata, user_metadata)
    values ('priya.showoffsalon@staff.auzslab.in', null, 'priya.showoffsalon', crypt('1234', gen_salt('bf', 10)),
            encode(digest(tid::text || ':1234', 'sha256'), 'hex'),
            jsonb_build_object('tenant_id', tid, 'role', 'cashier', 'name', 'Priya', 'email_verified', true),
            jsonb_build_object('full_name', 'Priya'))
    returning id into uid;
  end if;
  update profiles set username = 'priya.showoffsalon', pin_len = 4, login_off = false where id = uid;
end $$;

\echo '--- AFTER: businesses left'
select slug, name from tenants order by 1;
\echo '--- AFTER: logins left'
select count(*) from auth_users;

\if :{?confirm}
  \echo 'COMMITTED. Fresh start done. Open the salon demo once so it fills with sample data.'
  commit;
\else
  \echo 'DRY RUN only: nothing was deleted. Add  -v confirm=yes  to really do it.'
  rollback;
\endif
