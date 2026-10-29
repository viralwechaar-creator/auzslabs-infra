-- 1) Bills list: turn the filters into typed variables first. The old query cast text such as '' to uuid / date inside the
--    WHERE clause; on the older PostgreSQL that ships with the Windows 7 installer the planner evaluates that cast even when
--    the filter is empty, so the Bills page failed with: invalid input syntax for type uuid: "".
create or replace function sty_list_sales(p jsonb default '{}'::jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; mine boolean; uid_ uuid := app_uid();
  f_from date := nullif(p->>'from', '')::date; f_to date := nullif(p->>'to', '')::date;
  f_cust uuid := nullif(p->>'customerId', '')::uuid; f_status text := nullif(p->>'status', ''); f_q text := nullif(p->>'q', '');
  f_limit int := coalesce(nullif(p->>'limit', '')::int, 100);
begin
  tid := sty_guard('sty_view');
  mine := not sty_perm('sty_reports');                      -- plain staff see only their own bills
  return coalesce((select jsonb_agg(x) from (
    select jsonb_build_object('id', s.id, 'number', s.number, 'at', s.at, 'total', s.total, 'paid', s.paid, 'status', s.status, 'discount', s.discount,
      'customer', c.name, 'customerId', s.customer_id, 'branchId', s.branch_id, 'units', (select coalesce(sum(qty), 0) from sty_sale_lines where sale_id = s.id),
      'staff', (select coalesce(nullif(pr.name, ''), pr.email) from profiles pr where pr.id = s.staff_id), 'payments', s.payments) x
    from sty_sales s left join sty_customers c on c.id = s.customer_id
    where s.tenant_id = tid and (not mine or s.staff_id = uid_)
      and (f_from is null or s.at >= f_from)
      and (f_to is null or s.at < f_to + 1)
      and (f_cust is null or s.customer_id = f_cust)
      and (f_status is null or s.status = f_status)
      and (f_q is null or s.number ilike '%' || f_q || '%' or c.name ilike '%' || f_q || '%' or c.phone like '%' || f_q || '%')
    order by s.at desc limit f_limit) q), '[]'::jsonb);
end $$;

-- 2) Change the password of a remote login (cloud side): only for a login that already has access to THIS shop's cloud copy.
create or replace function sty_cloud_sync_set_password(p_lineage text, p_email text, p_password_hash text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; email_ text := lower(btrim(coalesce(p_email, ''))); uid_ uuid;
begin
  if coalesce(p_password_hash, '') = '' then raise exception 'A password is required' using errcode = 'ST002'; end if;
  select tenant_id into tid from sty_sync_tenants where lineage = p_lineage;
  if tid is null then raise exception 'Remote access is not on yet' using errcode = 'ST002'; end if;
  select u.id into uid_ from auth_users u join profiles p on p.id = u.id where p.tenant_id = tid and u.email = email_;
  if uid_ is null then raise exception 'That email does not have remote access' using errcode = 'ST002'; end if;
  update auth_users set password_hash = p_password_hash where id = uid_;
  return jsonb_build_object('changed', true, 'userId', uid_);
end $$;
-- Rollback: re-run db/216_style_sales.sql's sty_list_sales; drop function sty_cloud_sync_set_password(text,text,text);
