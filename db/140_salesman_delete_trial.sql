-- Owner request: let a salesman permanently delete a prospect they created
-- (an abandoned or test trial), without needing the platform admin to do it.
-- Reuses delete_client()'s own full purge routine (db/016/087/106 -- sweeps
-- every tenant_id-bearing table and every FK-linked child row dynamically)
-- rather than duplicating that logic a second time: its authorization check
-- now also accepts a salesman deleting a tenant THEY created, never anyone
-- else's, on top of the existing platform-admin check.

create or replace function delete_client(p_tenant_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare slug text; cname text; r record; n bigint; total bigint; pass int := 0; uids uuid[];
begin
  if not (is_platform_admin() or (is_salesman() and exists(select 1 from tenants where id = p_tenant_id and created_by_salesman = app_uid()))) then
    raise exception 'not authorized';
  end if;
  select t.slug, t.name into slug, cname from tenants t where t.id = p_tenant_id;
  if slug is null then raise exception 'client not found'; end if;
  select coalesce(array_agg(id), '{}') into uids from profiles where tenant_id = p_tenant_id and id not in (select id from platform_admins);
  set local session_replication_role = replica;
  for r in
    select c.table_name t, c.column_name col from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'tenant_id' and c.table_name <> 'tenants'
    union
    select cl.relname, a.attname from pg_constraint k
      join pg_class cl on cl.oid = k.conrelid join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
      where k.contype = 'f' and k.confrelid = 'public.tenants'::regclass and array_length(k.conkey, 1) = 1
  loop
    execute format('delete from %I where %I = $1', r.t, r.col) using p_tenant_id;
  end loop;
  delete from tenants where id = p_tenant_id;
  delete from auth_users where id = any(uids);
  -- sweep rows left pointing at something just deleted (child tables with no tenant_id, sessions, links, requests)
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
      where k.contype = 'f' and cl.relname <> 'admin_audit'
    loop
      if r.dt = 'n' then
        execute format('update %I c set %s where %s and not exists (select 1 from %I p where %s)', r.child, r.setnull, r.nn, r.parent, r.cond);
      else
        execute format('delete from %I c where %s and not exists (select 1 from %I p where %s)', r.child, r.nn, r.parent, r.cond);
      end if;
      get diagnostics n = row_count; total := total + n;
    end loop;
    exit when total = 0 or pass > 12;
  end loop;
  perform admin_log('delete_client', 'tenant', p_tenant_id::text, jsonb_build_object('slug', slug, 'name', cname));
end $$;

-- salesman-facing wrapper: requires typing the exact business address back
-- (same discipline as the client editor's own delete and my_data_clear), so
-- one stray tap can never destroy a trial. Never reaches another salesman's
-- or a real client's tenant -- delete_client()'s own check above enforces
-- that regardless, this is the friendlier error message and confirmation.
create or replace function salesman_delete_trial(p_tenant_id uuid, p_confirm_slug text) returns void
language plpgsql security definer set search_path = public as $$
declare slug2 text;
begin
  if not is_salesman() then raise exception 'not authorized'; end if;
  select slug into slug2 from tenants where id = p_tenant_id and created_by_salesman = app_uid();
  if slug2 is null then raise exception 'not your trial tenant'; end if;
  if lower(btrim(coalesce(p_confirm_slug, ''))) <> slug2 then
    raise exception 'Typed address does not match' using errcode = 'P0001';
  end if;
  perform delete_client(p_tenant_id);
end $$;
