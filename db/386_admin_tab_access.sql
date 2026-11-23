-- Admin tab inside the apps (replaces the old account page): only the business owner sees it, unless the owner
-- approves a staff member. The approval list lives here; the functions are the only way to read or change it.
create table if not exists admin_tab_access (
  tenant_id  uuid not null references tenants(id) on delete cascade,
  user_id    uuid not null,
  granted_by uuid,
  granted_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);
alter table admin_tab_access enable row level security;   -- no policies: reachable only through the functions below

-- {owner, allowed} for the signed-in person. allowed = owner, or approved by the owner.
create or replace function admin_tab_status() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_tid uuid := (me()->>'tenant_id')::uuid; v_owner boolean := coalesce(me()->>'role', '') = 'owner';
begin
  if app_uid() is null or v_tid is null then return jsonb_build_object('owner', false, 'allowed', false); end if;
  return jsonb_build_object('owner', v_owner,
    'allowed', v_owner or exists (select 1 from admin_tab_access where tenant_id = v_tid and user_id = app_uid()));
end $$;

-- Owner only: this business's people and whether each may open Admin.
create or replace function admin_tab_staff() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_tid uuid := (me()->>'tenant_id')::uuid;
begin
  if coalesce(me()->>'role', '') <> 'owner' or v_tid is null then raise exception 'Only the business owner can do this.' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'email', p.email, 'username', p.username, 'role', p.role,
      'loginOff', coalesce(p.login_off, false), 'adminAccess', exists (select 1 from admin_tab_access a where a.tenant_id = v_tid and a.user_id = p.id))
      order by p.role = 'owner' desc, p.email)
    from profiles p where p.tenant_id = v_tid), '[]'::jsonb);
end $$;

-- Owner only: allow or stop a staff member opening Admin. The owner's own access cannot be changed.
create or replace function admin_tab_set(p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path = public as $$
declare v_tid uuid := (me()->>'tenant_id')::uuid; v_role text;
begin
  if coalesce(me()->>'role', '') <> 'owner' or v_tid is null then raise exception 'Only the business owner can do this.' using errcode = '42501'; end if;
  select role into v_role from profiles where id = p_user and tenant_id = v_tid;
  if v_role is null then raise exception 'That person is not part of this business.'; end if;
  if v_role = 'owner' then raise exception 'The owner always has Admin access.'; end if;
  if p_on then
    insert into admin_tab_access (tenant_id, user_id, granted_by) values (v_tid, p_user, app_uid()) on conflict do nothing;
  else
    delete from admin_tab_access where tenant_id = v_tid and user_id = p_user;
  end if;
end $$;
