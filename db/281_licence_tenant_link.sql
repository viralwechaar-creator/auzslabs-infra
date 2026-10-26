-- Licence <-> client tenant linking: admin.html's licence form could already send a tenantId
-- (admin_log_licence, db/267, already accepts and stores it on app_licences.tenant_id) but the
-- UI had no way to pick one, and admin_list_licences never showed it back. This only adds the
-- read side -- which client (if any) a licence is linked to -- so the admin can see and set it.

create or replace function admin_list_licences() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'shop', l.shop, 'end', l.plan_end, 'addons', l.addons, 'code', l.code, 'note', l.note, 'issuedAt', l.issued_at,
    'daysLeft', (l.plan_end - current_date), 'lineage', l.lineage,
    'backups', (select count(*) from cloud_backups b where b.lineage = l.lineage),
    'backupBytes', (select coalesce(sum(size), 0) from cloud_backups b where b.lineage = l.lineage),
    'lastBackup', (select max(made_at) from cloud_backups b where b.lineage = l.lineage),
    'tenantId', l.tenant_id, 'tenantName', t.name, 'tenantSlug', t.slug)
    order by l.issued_at desc)
    from app_licences l left join tenants t on t.id = l.tenant_id), '[]'::jsonb);
end $$;

-- Rollback: the previous admin_list_licences body is db/269's version (no tenant fields).
