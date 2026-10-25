-- Licence codes made for the installed (offline) AUZsStyle. The code itself is signed by the server key (server/src/licence.js);
-- this table is only AUZslab's record of what was issued, so renewals can be followed up. Platform admin only.
create table if not exists app_licences (
  id uuid primary key default gen_random_uuid(),
  product text not null default 'style',
  shop text not null,
  tenant_id uuid references tenants(id) on delete set null,
  plan_end date not null,
  addons jsonb not null default '{}'::jsonb,
  code text not null,
  note text,
  issued_by uuid,
  issued_at timestamptz not null default now()
);
alter table app_licences enable row level security;

create or replace function admin_log_licence(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not is_platform_admin() then raise exception 'forbidden'; end if;
  insert into app_licences (shop, tenant_id, plan_end, addons, code, note, issued_by)
  values (p->>'shop', nullif(p->>'tenantId','')::uuid, (p->>'end')::date, coalesce(p->'addons','{}'::jsonb), p->>'code', nullif(p->>'note',''), app_uid())
  returning id into v_id;
  perform admin_log('licence_issued', 'licence', v_id::text, jsonb_build_object('shop', p->>'shop', 'end', p->>'end', 'addons', p->'addons'));
  return jsonb_build_object('id', v_id);
end $$;

create or replace function admin_list_licences() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'shop', l.shop, 'end', l.plan_end, 'addons', l.addons, 'code', l.code, 'note', l.note, 'issuedAt', l.issued_at,
    'daysLeft', (l.plan_end - current_date)) order by l.issued_at desc) from app_licences l), '[]'::jsonb);
end $$;
