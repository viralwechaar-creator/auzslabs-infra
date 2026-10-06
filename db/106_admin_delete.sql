-- Admin: permanent delete for leads, customer profiles, user accounts and (now complete) clients.
-- All functions are platform-admin only, SECURITY DEFINER, and write one admin_audit row.
-- delete_client used to remove only the older tables; since then Payroll, Accounting, AUZsMob, Salon etc. added
-- their own tenant tables with append-only guards, so it failed or left data behind. It now purges every table
-- that has a tenant_id (guards and FK checks off for this transaction, same method as my_data_clear / the wipe
-- script; needs the superuser owner), then removes the logins, the tenant and any rows left pointing at them.

create or replace function delete_client(p_tenant_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare slug text; cname text; r record; n bigint; total bigint; pass int := 0; uids uuid[];
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
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

-- A lead / signup request / add-on request / customer profile, gone for good.
create or replace function admin_delete_lead(p_kind text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare n int; label text;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  if p_kind = 'lead' then
    select coalesce(business, name) into label from leads where id = p_id;
    delete from leads where id = p_id;
  elsif p_kind = 'signup_request' then
    select business_name into label from signup_requests where id = p_id;
    delete from signup_requests where id = p_id;
  elsif p_kind = 'addon_request' then
    select tenant_name into label from addon_requests where id = p_id;
    delete from addon_requests where id = p_id;
  elsif p_kind = 'profile' then
    select coalesce(business_name, name) into label from user_profiles where user_id = p_id;
    delete from user_profiles where user_id = p_id;
  else
    raise exception 'unknown kind %', p_kind using errcode = '22023';
  end if;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'not found' using errcode = 'P0002'; end if;
  perform admin_log('delete_' || p_kind, p_kind, p_id::text, jsonb_build_object('label', label));
  return jsonb_build_object('ok', true);
end $$;

-- A login account, gone for good (sessions, sign-in links, profile, requests, payments go with it).
-- Refuses: yourself, platform admins, and a business owner (delete the client instead, so the data goes too).
create or replace function admin_delete_user(p_user_id uuid, p_confirm_email text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare em text; uname text; trole text; tslug text;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  if p_user_id = app_uid() then raise exception 'You cannot delete your own account' using errcode = 'P0001'; end if;
  if exists (select 1 from platform_admins where id = p_user_id) then raise exception 'Platform admins cannot be deleted here' using errcode = 'P0001'; end if;
  select u.email into em from auth_users u where u.id = p_user_id;
  if em is null then raise exception 'not found' using errcode = 'P0002'; end if;
  if lower(coalesce(p_confirm_email, '')) <> lower(em) then raise exception 'Typed email does not match' using errcode = 'P0001'; end if;
  select p.username, p.role, t.slug into uname, trole, tslug from profiles p left join tenants t on t.id = p.tenant_id where p.id = p_user_id;
  if trole = 'owner' and tslug is not null then
    raise exception 'This is the owner of "%". Delete the client instead (Clients) so their data goes too.', tslug using errcode = 'P0001';
  end if;
  update notifications set created_by = null where created_by = p_user_id;
  delete from auth_users where id = p_user_id;
  if uname is not null then delete from staff_pin_fails where username = uname; end if;
  perform admin_log('delete_user', 'user', p_user_id::text, jsonb_build_object('email', em, 'tenant', tslug));
  return jsonb_build_object('ok', true);
end $$;
