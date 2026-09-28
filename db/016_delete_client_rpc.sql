-- =========================================================
-- delete_client: lets a platform_admin remove a tenant directly
-- from the admin dashboard instead of the manual psql cleanup this
-- session did by hand for the creatopz test tenant. Same FK order
-- that cleanup used: staff logins first (cascades profiles/
-- signup_requests/push_subs off auth_users), then the handful of
-- tenant-scoped tables that don't cascade off `tenants` itself
-- (records, guest_orders, bookings, invoice_counters), then the
-- tenants row (which cascades tenant_settings/roles/notifications,
-- see 001/013 -- those three already have `on delete cascade`).
-- =========================================================

create function delete_client(p_tenant_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then
    raise exception 'not authorized';
  end if;

  delete from auth_users where id in (select id from profiles where tenant_id = p_tenant_id);

  delete from records where tenant_id = p_tenant_id;
  delete from guest_orders where tenant_id = p_tenant_id;
  delete from bookings where tenant_id = p_tenant_id;
  delete from invoice_counters where tenant_id = p_tenant_id;

  delete from tenants where id = p_tenant_id;
end;
$$;
