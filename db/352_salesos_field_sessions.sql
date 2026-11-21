-- AUZslab SalesOS: GPS field tracking. Visible-only-while-active, nothing collected outside
-- a session the employee started themselves (brief's own "Tracking policy").
create table sos_field_sessions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  staff_id uuid not null references auth_users(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'paused', 'ended')),
  started_at timestamptz not null default now(),
  paused_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_sos_field_sessions_staff on sos_field_sessions (tenant_id, staff_id, started_at desc);
create unique index idx_sos_field_sessions_one_open on sos_field_sessions (tenant_id, staff_id) where status in ('active', 'paused');
alter table sos_field_sessions enable row level security;

create table sos_location_samples (
  id bigserial primary key,
  session_id uuid not null references sos_field_sessions(id) on delete cascade,
  tenant_id uuid not null references tenants(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  accuracy_m numeric,
  device_at timestamptz not null,
  server_at timestamptz not null default now()
);
create index idx_sos_location_samples_session on sos_location_samples (session_id, device_at);
alter table sos_location_samples enable row level security;

create function sos_field_session_start() returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_field'); sid uuid;
begin
  if exists (select 1 from sos_field_sessions where tenant_id = tid and staff_id = app_uid() and status in ('active', 'paused')) then
    raise exception 'You already have an open field session';
  end if;
  insert into sos_field_sessions (tenant_id, staff_id) values (tid, app_uid()) returning id into sid;
  return jsonb_build_object('id', sid);
end $$;

create function sos_field_session_current() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_field'); r sos_field_sessions%rowtype;
begin
  select * into r from sos_field_sessions where tenant_id = tid and staff_id = app_uid() and status in ('active', 'paused');
  if not found then return null; end if;
  return jsonb_build_object('id', r.id, 'status', r.status, 'startedAt', r.started_at, 'pausedAt', r.paused_at,
    'lastSampleAt', (select max(device_at) from sos_location_samples where session_id = r.id));
end $$;

create function sos_field_session_set(p_id uuid, p_status text) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_field');
begin
  if p_status not in ('active', 'paused', 'ended') then raise exception 'unknown status: %', p_status; end if;
  update sos_field_sessions set status = p_status,
    paused_at = case when p_status = 'paused' then now() else paused_at end,
    ended_at = case when p_status = 'ended' then now() else ended_at end
  where id = p_id and tenant_id = tid and staff_id = app_uid() and status <> 'ended';
  if not found then raise exception 'session not found or already ended'; end if;
end $$;

-- batch of GPS points from one device; only accepted for the caller's own open session
create function sos_location_batch(p_session uuid, p_points jsonb) returns int language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_field'); n int := 0; pt jsonb;
begin
  if not exists (select 1 from sos_field_sessions where id = p_session and tenant_id = tid and staff_id = app_uid() and status = 'active') then
    raise exception 'That session is not open for you';
  end if;
  for pt in select jsonb_array_elements(p_points) loop
    insert into sos_location_samples (session_id, tenant_id, lat, lng, accuracy_m, device_at)
    values (p_session, tid, (pt->>'lat')::double precision, (pt->>'lng')::double precision,
      nullif(pt->>'accuracy', '')::numeric, coalesce((pt->>'at')::timestamptz, now()));
    n := n + 1;
  end loop;
  return n;
end $$;

-- manager/admin: who is currently in an active session, with their last known point
create function sos_live_field() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_manage');
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
      'sessionId', s.id, 'staffId', s.staff_id, 'name', coalesce(p.name, u.email), 'status', s.status,
      'startedAt', s.started_at,
      'lastSample', (select jsonb_build_object('lat', l.lat, 'lng', l.lng, 'accuracyM', l.accuracy_m, 'at', l.device_at)
                     from sos_location_samples l where l.session_id = s.id order by l.device_at desc limit 1)
    ) order by s.started_at desc)
    from sos_field_sessions s join auth_users u on u.id = s.staff_id left join profiles p on p.id = s.staff_id
    where s.tenant_id = tid and s.status in ('active', 'paused')), '[]'::jsonb);
end $$;

grant select, insert, update on sos_field_sessions to app;
grant select, insert on sos_location_samples to app;
grant execute on function sos_field_session_start() to app;
grant execute on function sos_field_session_current() to app;
grant execute on function sos_field_session_set(uuid, text) to app;
grant execute on function sos_location_batch(uuid, jsonb) to app;
grant execute on function sos_live_field() to app;
