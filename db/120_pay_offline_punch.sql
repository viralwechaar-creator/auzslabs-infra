-- Offline clock-in/out for AUZsPay. A phone with no signal keeps the REAL time of the tap and sends it when it is back
-- online. Safe by construction: append-only, one row per client operation id (a retry or a lost reply can never add a second
-- punch), the time cannot be in the future or more than 3 days old, and the in/out direction is decided here from the
-- employee's own earlier punches, never taken from the phone. Same eligibility and geofence rules as pay_me_punch.
alter table pay_punches add column if not exists client_op text;
create unique index if not exists pay_punches_client_op on pay_punches (tenant_id, client_op) where client_op is not null;

create or replace function pay_me_punch_offline(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; e pay_employees; o pay_org; loc pay_locations; v_op text; v_at timestamptz; v_kind text; dist int; outr boolean := false; gf text; lat numeric; lng numeric; d date;
begin
  tid := pay_tenant(); e := pay_me_emp(tid); o := pay_org_row(tid);
  v_op := nullif(btrim(coalesce(p->>'op', '')), '');
  if v_op is null or length(v_op) > 64 then raise exception 'Missing clock-in reference'; end if;
  if exists (select 1 from pay_punches where tenant_id = tid and client_op = v_op) then
    return pay_punch_state(tid, e.id) || jsonb_build_object('duplicate', true);   -- already received
  end if;
  if e.status not in ('active', 'notice') then raise exception 'Clocking in is for current employees'; end if;
  if pay_att_mode(e) = 'none' then raise exception 'Your attendance is not tracked, so there is nothing to clock'; end if;
  begin v_at := (p->>'at')::timestamptz; exception when others then raise exception 'The clock-in time is not valid'; end;
  if v_at is null then raise exception 'The clock-in time is missing'; end if;
  if v_at > now() + interval '2 minutes' then raise exception 'That clock-in time is in the future'; end if;
  if v_at < now() - interval '3 days' then raise exception 'This clock-in is more than 3 days old. Ask your manager to add it.'; end if;
  -- direction from what the employee already has before this moment: after an "in" comes an "out", otherwise "in"
  select case when pp.kind = 'in' then 'out' else 'in' end into v_kind
    from pay_punches pp where pp.employee_id = e.id and pp.voided_at is null and pp.at < v_at order by pp.at desc limit 1;
  v_kind := coalesce(v_kind, 'in');
  lat := nullif(p->>'lat', '')::numeric; lng := nullif(p->>'lng', '')::numeric;
  select l.* into loc from pay_locations l where l.id = (pay_job_at(e.id, (v_at at time zone pay_tz(tid))::date)).location_id;
  gf := pay_cfg(o.settings, 'att', 'geofence', 'flag');
  if loc.lat is not null and loc.radius_m is not null and gf <> 'off' then
    if lat is null then
      if gf = 'block' then raise exception 'Location was off when you clocked in, and your workplace needs it. Ask your manager to add this clock-in.'; end if;
      outr := true;
    else
      dist := round(2 * 6371000 * asin(sqrt(power(sin(radians(lat - loc.lat) / 2), 2) + cos(radians(loc.lat)) * cos(radians(lat)) * power(sin(radians(lng - loc.lng) / 2), 2))));
      outr := dist > loc.radius_m;
      if outr and gf = 'block' then raise exception 'You were % m from % when you clocked in. Ask your manager to add it.', dist, loc.name; end if;
    end if;
  end if;
  insert into pay_punches (tenant_id, employee_id, at, kind, source, lat, lng, accuracy_m, distance_m, out_of_range, created_by, client_op, note)
  values (tid, e.id, v_at, v_kind, 'mobile', lat, lng, nullif(p->>'accuracy', '')::numeric::int, dist, outr, app_uid(), v_op, 'Saved on the phone, sent later');
  d := (v_at at time zone pay_tz(tid))::date;
  perform pay_att_refresh(tid, e.id, d - 1, d + 1);
  return pay_punch_state(tid, e.id) || jsonb_build_object('out_of_range', outr, 'distance_m', dist, 'kind', v_kind, 'recorded_at', v_at);
end $$;
