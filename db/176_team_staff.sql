-- AUZslab team: salesmen, client setup staff, support staff and managers (owner request, Oct 2026).
--
-- One table of team logins (platform_salesmen, db/137) now carries a role. On top of it:
--   * leads can be assigned to a person, have a stage, a follow-up date and a history of notes
--   * a client's setup can be assigned to a setup person, with a checklist and a time limit
--   * everything a team member does is written to team_activity so the admin can track the work
-- Every table here has RLS on and NO policy and no grant to `app`: reads and writes go only through
-- the SECURITY DEFINER functions below (same discipline as pos_audit / acc_audit / platform_salesmen).

-- ---------------------------------------------------------------- roles
alter table platform_salesmen add column if not exists role text not null default 'salesman';
alter table platform_salesmen drop constraint if exists platform_salesmen_role_check;
alter table platform_salesmen add constraint platform_salesmen_role_check check (role in ('salesman', 'setup', 'support', 'manager'));
alter table platform_salesmen add column if not exists phone text;

create or replace function team_role(p_uid uuid default app_uid()) returns text
language sql stable security definer set search_path = public as $$
  select role from platform_salesmen where id = p_uid and active
$$;

create or replace function is_team_member(p_uid uuid default app_uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from platform_salesmen where id = p_uid and active)
$$;

-- is_salesman() keeps its meaning for every trial / branding function and route that already uses it:
-- only the salesman role may create and brand trials (setup, support and manager logins may not).
create or replace function is_salesman(p_uid uuid default app_uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from platform_salesmen where id = p_uid and active and role = 'salesman')
$$;

-- platform admin, or a team manager (a manager sees the whole team and assigns work, never money or pricing)
create or replace function team_can_manage(p_uid uuid default app_uid()) returns boolean
language sql stable security definer set search_path = public as $$
  select is_platform_admin() or exists(select 1 from platform_salesmen where id = p_uid and active and role = 'manager')
$$;

-- ---------------------------------------------------------------- leads
alter table leads add column if not exists assigned_to uuid references auth_users(id) on delete set null;
alter table leads add column if not exists created_by uuid references auth_users(id) on delete set null;
alter table leads add column if not exists next_followup date;
alter table leads add column if not exists source text;
alter table leads add column if not exists updated_at timestamptz not null default now();

alter table leads drop constraint if exists leads_status_check;
alter table leads add constraint leads_status_check
  check (status in ('new', 'contacted', 'demo', 'quoted', 'converted', 'declined'));

create index if not exists leads_assigned_idx on leads (assigned_to) where assigned_to is not null;

create table if not exists lead_notes (
  id         uuid primary key default gen_random_uuid(),
  lead_id    uuid not null references leads(id) on delete cascade,
  author     uuid references auth_users(id) on delete set null,
  kind       text not null default 'note' check (kind in ('note', 'stage', 'followup', 'assign', 'created')),
  body       text,
  created_at timestamptz not null default now()
);
create index if not exists lead_notes_lead_idx on lead_notes (lead_id, created_at desc);
alter table lead_notes enable row level security;

-- ---------------------------------------------------------------- activity (the work trail)
create table if not exists team_activity (
  id         bigserial primary key,
  uid        uuid not null references auth_users(id) on delete cascade,
  kind       text not null,
  ref        text,
  label      text,
  tenant_id  uuid references tenants(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists team_activity_uid_idx on team_activity (uid, created_at desc);
alter table team_activity enable row level security;

create or replace function team_log(p_kind text, p_ref text, p_label text, p_tenant uuid default null, p_uid uuid default app_uid())
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_uid is null then return; end if;
  insert into team_activity (uid, kind, ref, label, tenant_id) values (p_uid, p_kind, p_ref, p_label, p_tenant);
end $$;

-- a salesman creating a trial is work too: logged by a trigger so salesman_provision_trial needs no change
create or replace function tenants_trial_log() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.created_by_salesman is not null then
    insert into team_activity (uid, kind, ref, label, tenant_id)
      values (new.created_by_salesman, 'trial_created', new.slug, new.name, new.id);
  end if;
  return new;
end $$;
drop trigger if exists tenants_trial_log on tenants;
create trigger tenants_trial_log after insert on tenants for each row execute function tenants_trial_log();

-- ---------------------------------------------------------------- client setup assignments
create table if not exists setup_assignments (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  assigned_to uuid not null references auth_users(id) on delete cascade,
  assigned_by uuid references auth_users(id) on delete set null,
  status      text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  checklist   jsonb not null default '[]'::jsonb,
  note        text,
  expires_at  timestamptz not null default now() + interval '14 days',
  created_at  timestamptz not null default now(),
  done_at     timestamptz
);
create unique index if not exists setup_one_open_per_tenant on setup_assignments (tenant_id) where status = 'open';
create index if not exists setup_assignee_idx on setup_assignments (assigned_to, status);
alter table setup_assignments enable row level security;

create or replace function setup_default_checklist() returns jsonb language sql immutable as $$
  select '[{"k":"brand","label":"Logo, colours and business details","done":false},
           {"k":"menu","label":"Menu or services and prices","done":false},
           {"k":"tables","label":"Tables, areas or staff logins","done":false},
           {"k":"tax","label":"GST, taxes and invoice details","done":false},
           {"k":"print","label":"Print a test bill","done":false},
           {"k":"train","label":"Walk the owner through it","done":false}]'::jsonb
$$;

-- ---------------------------------------------------------------- who am I
create or replace function team_me() returns jsonb
language plpgsql security definer set search_path = public as $$
declare r platform_salesmen%rowtype; em text;
begin
  select * into r from platform_salesmen where id = app_uid() and active;
  if not found then raise exception 'not a team member'; end if;
  select email into em from auth_users where id = r.id;
  return jsonb_build_object('id', r.id, 'name', coalesce(r.name, em), 'email', em, 'role', r.role, 'phone', r.phone);
end $$;

-- ---------------------------------------------------------------- leads: team side
create or replace function team_lead_json(l leads) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', l.id, 'name', l.name, 'business', l.business, 'contact', l.contact, 'message', l.message,
    'niche', l.niche, 'status', l.status, 'next_followup', l.next_followup, 'source', l.source,
    'assigned_to', l.assigned_to,
    'assignee', (select coalesce(s.name, u.email) from platform_salesmen s join auth_users u on u.id = s.id where s.id = l.assigned_to),
    'created_at', l.created_at, 'updated_at', l.updated_at,
    'last_note', (select n.body from lead_notes n where n.lead_id = l.id and n.kind in ('note', 'stage') and n.body is not null order by n.created_at desc limit 1)
  )
$$;

create or replace function team_my_leads() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_team_member() then raise exception 'not authorized'; end if;
  return coalesce((
    select jsonb_agg(team_lead_json(l) order by (l.next_followup is null), l.next_followup, l.updated_at desc)
    from leads l where l.assigned_to = app_uid() or l.created_by = app_uid()
  ), '[]'::jsonb);
end $$;

create or replace function team_all_leads() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not team_can_manage() then raise exception 'not authorized'; end if;
  return coalesce((select jsonb_agg(team_lead_json(l) order by l.updated_at desc) from leads l), '[]'::jsonb);
end $$;

-- a salesman or manager adds a prospect they found themselves (it is assigned to them)
create or replace function team_add_lead(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_role text := team_role(); v_name text; v_contact text; v_niche text; v_id uuid; v_row leads%rowtype;
begin
  if v_role is null or v_role not in ('salesman', 'manager') then raise exception 'not authorized'; end if;
  v_name := nullif(btrim(coalesce(p->>'name', '')), '');
  v_contact := nullif(btrim(coalesce(p->>'contact', '')), '');
  if v_name is null then raise exception 'a name is required'; end if;
  if v_contact is null then raise exception 'a phone number or email is required'; end if;
  v_niche := nullif(btrim(coalesce(p->>'niche', '')), '');
  if v_niche is not null and not exists(select 1 from niche_presets where niche = v_niche) then v_niche := null; end if;
  insert into leads (name, business, contact, message, niche, status, assigned_to, created_by, source, next_followup)
    values (left(v_name, 120), nullif(left(btrim(coalesce(p->>'business', '')), 160), ''), left(v_contact, 160),
            nullif(left(btrim(coalesce(p->>'message', '')), 1000), ''), v_niche, 'new', app_uid(), app_uid(), 'team',
            nullif(p->>'next_followup', '')::date)
    returning * into v_row;
  insert into lead_notes (lead_id, author, kind, body) values (v_row.id, app_uid(), 'created', 'Added by the team');
  perform team_log('lead_added', v_row.id::text, coalesce(v_row.business, v_row.name));
  return team_lead_json(v_row);
end $$;

-- change the stage, add a note and/or set the next follow-up date, in one call
create or replace function team_update_lead(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_l leads%rowtype; v_status text; v_note text; v_label text; v_fu date; v_has_fu boolean := p ? 'next_followup';
begin
  if not is_team_member() and not is_platform_admin() then raise exception 'not authorized'; end if;
  select * into v_l from leads where id = p_id for update;
  if not found then raise exception 'lead not found'; end if;
  if not (v_l.assigned_to = app_uid() or v_l.created_by = app_uid() or team_can_manage()) then
    raise exception 'this lead is not yours';
  end if;
  v_label := coalesce(v_l.business, v_l.name);
  v_status := nullif(btrim(coalesce(p->>'status', '')), '');
  v_note := nullif(left(btrim(coalesce(p->>'note', '')), 1000), '');

  if v_status is not null and v_status <> v_l.status then
    if v_status not in ('new', 'contacted', 'demo', 'quoted', 'converted', 'declined') then raise exception 'unknown stage: %', v_status; end if;
    insert into lead_notes (lead_id, author, kind, body) values (p_id, app_uid(), 'stage', v_l.status || ' -> ' || v_status);
    perform team_log('lead_stage', p_id::text, v_label || ': ' || v_status);
    update leads set status = v_status, updated_at = now() where id = p_id;
  end if;
  if v_has_fu then
    v_fu := nullif(p->>'next_followup', '')::date;
    if v_fu is distinct from v_l.next_followup then
      insert into lead_notes (lead_id, author, kind, body) values (p_id, app_uid(), 'followup', coalesce(v_fu::text, 'cleared'));
      perform team_log('lead_followup', p_id::text, v_label || ': follow up ' || coalesce(v_fu::text, 'cleared'));
      update leads set next_followup = v_fu, updated_at = now() where id = p_id;
    end if;
  end if;
  if v_note is not null then
    insert into lead_notes (lead_id, author, kind, body) values (p_id, app_uid(), 'note', v_note);
    perform team_log('lead_note', p_id::text, v_label);
    update leads set updated_at = now() where id = p_id;
  end if;
  select * into v_l from leads where id = p_id;
  return team_lead_json(v_l);
end $$;

create or replace function team_lead_notes(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_l leads%rowtype;
begin
  select * into v_l from leads where id = p_id;
  if not found then raise exception 'lead not found'; end if;
  if not (v_l.assigned_to = app_uid() or v_l.created_by = app_uid() or team_can_manage()) then raise exception 'this lead is not yours'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'body', n.body, 'created_at', n.created_at,
             'author', (select coalesce(s.name, u.email) from auth_users u left join platform_salesmen s on s.id = u.id where u.id = n.author))
           order by n.created_at desc)
    from lead_notes n where n.lead_id = p_id
  ), '[]'::jsonb);
end $$;

-- admin or manager hands a lead to a team member (null = unassign)
create or replace function team_assign_lead(p_lead uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare v_l leads%rowtype; v_who text;
begin
  if not team_can_manage() then raise exception 'not authorized'; end if;
  select * into v_l from leads where id = p_lead for update;
  if not found then raise exception 'lead not found'; end if;
  if p_user is not null then
    if not exists(select 1 from platform_salesmen where id = p_user and active and role in ('salesman', 'manager', 'support')) then
      raise exception 'that person cannot take leads';
    end if;
    select coalesce(s.name, u.email) into v_who from platform_salesmen s join auth_users u on u.id = s.id where s.id = p_user;
  end if;
  update leads set assigned_to = p_user, updated_at = now() where id = p_lead;
  insert into lead_notes (lead_id, author, kind, body) values (p_lead, app_uid(), 'assign', coalesce('Assigned to ' || v_who, 'Unassigned'));
  if p_user is not null then perform team_log('lead_assigned', p_lead::text, coalesce(v_l.business, v_l.name), null, p_user); end if;
end $$;

-- ---------------------------------------------------------------- client setup: assign, work, open
create or replace function team_assign_setup(p_tenant uuid, p_user uuid, p_days int default 14) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_t tenants%rowtype;
begin
  if not team_can_manage() then raise exception 'not authorized'; end if;
  select * into v_t from tenants where id = p_tenant;
  if not found then raise exception 'client not found'; end if;
  if not exists(select 1 from platform_salesmen where id = p_user and active and role = 'setup') then
    raise exception 'pick a team member with the setup role';
  end if;
  update setup_assignments set status = 'cancelled' where tenant_id = p_tenant and status = 'open';
  insert into setup_assignments (tenant_id, assigned_to, assigned_by, checklist, expires_at)
    values (p_tenant, p_user, app_uid(), setup_default_checklist(), now() + make_interval(days => greatest(1, least(coalesce(p_days, 14), 60))))
    returning id into v_id;
  perform team_log('setup_assigned', v_id::text, v_t.name, p_tenant, p_user);
  return jsonb_build_object('id', v_id);
end $$;

create or replace function team_setup_json(a setup_assignments) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', a.id, 'tenant_id', a.tenant_id, 'status', a.status, 'checklist', a.checklist, 'note', a.note,
    'expires_at', a.expires_at, 'created_at', a.created_at, 'done_at', a.done_at,
    'expired', (a.status = 'open' and a.expires_at < now()),
    'client', t.name, 'slug', t.slug, 'niche', t.niche,
    'assigned_to', a.assigned_to,
    'assignee', (select coalesce(s.name, u.email) from platform_salesmen s join auth_users u on u.id = s.id where s.id = a.assigned_to),
    'has_owner', exists(select 1 from profiles p where p.tenant_id = t.id and p.role = 'owner')
  ) from tenants t where t.id = a.tenant_id
$$;

create or replace function team_my_setups() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_team_member() then raise exception 'not authorized'; end if;
  return coalesce((select jsonb_agg(team_setup_json(a) order by (a.status = 'open') desc, a.created_at desc)
                   from setup_assignments a where a.assigned_to = app_uid() and a.status <> 'cancelled'), '[]'::jsonb);
end $$;

create or replace function team_list_setups() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not team_can_manage() then raise exception 'not authorized'; end if;
  return coalesce((select jsonb_agg(team_setup_json(a) order by (a.status = 'open') desc, a.created_at desc)
                   from setup_assignments a where a.status <> 'cancelled'), '[]'::jsonb);
end $$;

create or replace function team_setup_cancel(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not team_can_manage() then raise exception 'not authorized'; end if;
  update setup_assignments set status = 'cancelled' where id = p_id and status = 'open';
end $$;

-- the assignee ticks the checklist, adds a note, or marks the setup finished (which ends their access)
create or replace function team_setup_update(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a setup_assignments%rowtype; v_list jsonb; v_done int; v_total int; v_name text;
begin
  select * into a from setup_assignments where id = p_id for update;
  if not found or a.assigned_to <> app_uid() then raise exception 'this setup is not yours'; end if;
  if a.status <> 'open' then raise exception 'this setup is already closed'; end if;
  select name into v_name from tenants where id = a.tenant_id;
  if p ? 'checklist' and jsonb_typeof(p->'checklist') = 'array' then
    select coalesce(jsonb_agg(
             case when exists(select 1 from jsonb_array_elements(p->'checklist') x where x->>'k' = e->>'k')
                  then jsonb_set(e, '{done}', to_jsonb(coalesce((select (x->>'done')::boolean from jsonb_array_elements(p->'checklist') x where x->>'k' = e->>'k' limit 1), false)))
                  else e end order by ord), '[]'::jsonb)
      into v_list from jsonb_array_elements(a.checklist) with ordinality t(e, ord);
    update setup_assignments set checklist = v_list where id = p_id;
    select count(*) filter (where (e->>'done')::boolean), count(*) into v_done, v_total from jsonb_array_elements(v_list) e;
    perform team_log('setup_checklist', p_id::text, v_name || ': ' || v_done || '/' || v_total || ' done', a.tenant_id);
  end if;
  if p ? 'note' then
    update setup_assignments set note = nullif(left(btrim(coalesce(p->>'note', '')), 1000), '') where id = p_id;
  end if;
  if coalesce((p->>'done')::boolean, false) then
    update setup_assignments set status = 'done', done_at = now() where id = p_id;
    perform team_log('setup_done', p_id::text, v_name, a.tenant_id);
  end if;
  select * into a from setup_assignments where id = p_id;
  return team_setup_json(a);
end $$;

-- called by the API before it hands a setup person a session on the client's own business:
-- only the assignee, only while the setup is open and not past its time limit; every use is logged
create or replace function team_setup_open_context(p_tenant uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a setup_assignments%rowtype; v_t tenants%rowtype; v_owner record;
begin
  if team_role() is distinct from 'setup' then raise exception 'not authorized'; end if;
  select * into a from setup_assignments where tenant_id = p_tenant and assigned_to = app_uid() and status = 'open';
  if not found then raise exception 'this client is not assigned to you'; end if;
  if a.expires_at < now() then raise exception 'your access to this client has ended: ask for it again'; end if;
  select * into v_t from tenants where id = p_tenant;
  select au.id, au.email, au.app_metadata into v_owner
    from profiles p join auth_users au on au.id = p.id where p.tenant_id = p_tenant and p.role = 'owner' limit 1;
  if v_owner.id is null then raise exception 'this client has no owner login yet'; end if;
  perform team_log('setup_open', a.id::text, v_t.name, p_tenant);
  return jsonb_build_object('tenant_name', v_t.name, 'niche', v_t.niche,
                            'owner_id', v_owner.id, 'owner_email', v_owner.email, 'owner_meta', v_owner.app_metadata);
end $$;

-- ---------------------------------------------------------------- tracking
create or replace function team_work_summary(p_days int) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(row order by (row->>'last_active') desc nulls last), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', s.id, 'name', coalesce(s.name, u.email), 'email', u.email, 'role', s.role, 'phone', s.phone, 'active', s.active,
      'leads_open', (select count(*) from leads l where l.assigned_to = s.id and l.status not in ('converted', 'declined')),
      'leads_overdue', (select count(*) from leads l where l.assigned_to = s.id and l.status not in ('converted', 'declined') and l.next_followup < current_date),
      'leads_converted', (select count(*) from leads l where l.assigned_to = s.id and l.status = 'converted'
                           and (coalesce(p_days, 0) = 0 or l.updated_at >= now() - make_interval(days => p_days))),
      'updates', (select count(*) from team_activity a where a.uid = s.id and a.kind in ('lead_added', 'lead_stage', 'lead_note', 'lead_followup')
                   and (coalesce(p_days, 0) = 0 or a.created_at >= now() - make_interval(days => p_days))),
      'trials', (select count(*) from team_activity a where a.uid = s.id and a.kind = 'trial_created'
                  and (coalesce(p_days, 0) = 0 or a.created_at >= now() - make_interval(days => p_days))),
      'setups_open', (select count(*) from setup_assignments x where x.assigned_to = s.id and x.status = 'open'),
      'setups_done', (select count(*) from setup_assignments x where x.assigned_to = s.id and x.status = 'done'
                       and (coalesce(p_days, 0) = 0 or x.done_at >= now() - make_interval(days => p_days))),
      'last_active', (select max(a.created_at) from team_activity a where a.uid = s.id)
    ) as row
    from platform_salesmen s join auth_users u on u.id = s.id
  ) q
$$;

create or replace function team_overview(p_days int default 30) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not team_can_manage() then raise exception 'not authorized'; end if;
  return team_work_summary(p_days);
end $$;

create or replace function team_activity_feed(p_uid uuid, p_limit int default 40) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not team_can_manage() then raise exception 'not authorized'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'label', label, 'at', created_at) order by created_at desc)
                   from (select * from team_activity where uid = p_uid order by created_at desc limit greatest(1, least(coalesce(p_limit, 40), 200))) x), '[]'::jsonb);
end $$;

-- a team member's own numbers and recent work
create or replace function team_my_work(p_days int default 30) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me jsonb;
begin
  if not is_team_member() then raise exception 'not authorized'; end if;
  select r into v_me from jsonb_array_elements(team_work_summary(p_days)) r where (r->>'id')::uuid = app_uid();
  return jsonb_build_object(
    'summary', coalesce(v_me, '{}'::jsonb),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('kind', kind, 'label', label, 'at', created_at) order by created_at desc)
                        from (select * from team_activity where uid = app_uid() order by created_at desc limit 25) x), '[]'::jsonb));
end $$;

-- ---------------------------------------------------------------- platform admin: people
create or replace function admin_add_team_member(p_email text, p_name text default null, p_role text default 'salesman', p_phone text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare uid uuid;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  if p_role not in ('salesman', 'setup', 'support', 'manager') then raise exception 'unknown role: %', p_role; end if;
  select id into uid from auth_users where lower(email) = lower(btrim(coalesce(p_email, '')));
  if not found then raise exception 'no account with that email yet -- they sign in once with Google (or are given a login), then you add them here'; end if;
  if exists(select 1 from platform_admins where id = uid) then raise exception 'that is a platform admin account already'; end if;
  insert into platform_salesmen (id, name, role, phone)
    values (uid, nullif(btrim(coalesce(p_name, '')), ''), p_role, nullif(btrim(coalesce(p_phone, '')), ''))
    on conflict (id) do update set name = coalesce(excluded.name, platform_salesmen.name), role = excluded.role,
                                   phone = coalesce(excluded.phone, platform_salesmen.phone), active = true;
  perform admin_log('team_add', 'team', uid::text, jsonb_build_object('role', p_role));
  return jsonb_build_object('id', uid);
end $$;

create or replace function admin_set_team_role(p_id uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  if p_role not in ('salesman', 'setup', 'support', 'manager') then raise exception 'unknown role: %', p_role; end if;
  update platform_salesmen set role = p_role where id = p_id;
  perform admin_log('team_role', 'team', p_id::text, jsonb_build_object('role', p_role));
end $$;

-- the old call keeps working: adding "a salesman"
create or replace function admin_add_salesman(p_email text, p_name text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  return admin_add_team_member(p_email, p_name, 'salesman', null);
end $$;

-- a manager (or the admin) picks a client when handing out a setup: just names, never money or plans
create or replace function team_clients() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not team_can_manage() then raise exception 'not authorized'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'slug', slug) order by name)
                   from tenants where not coalesce(is_trial, false) and not coalesce(is_demo, false)), '[]'::jsonb);
end $$;
