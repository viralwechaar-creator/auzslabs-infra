-- =========================================================
-- Payroll punch: shrink the "double tap" debounce window from 60s down to 8s.
--
-- Owner report: "employe are not able to clock in once they by mistake punched oit
-- and tries to punch again." pay_me_punch / pay_kiosk_punch both guarded against a
-- double tap with: if there was ANY punch (in or out) in the last 60 seconds,
-- silently refuse the new one and report {duplicate:true} -- with no check that the
-- new punch is actually the same action being repeated. Clock in/out always flips
-- (case when open then 'out' else 'in' end, computed fresh from the current state),
-- so a genuine "oops, I meant the opposite" correction made 10-59 seconds after a
-- mistaken punch was being silently swallowed, identically to a real double tap.
--
-- 60 seconds was generous past what a double tap or a client network retry
-- actually needs (both happen within a couple of seconds); 8 seconds still comfortably
-- absorbs those while leaving a same-minute correction free to go through.
create or replace function pay_me_punch(p jsonb default '{}') returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; e pay_employees; o pay_org; loc pay_locations; st jsonb; dist int; outr boolean := false; gf text; lat numeric; lng numeric; d date;
begin
  tid := pay_tenant(); e := pay_me_emp(tid); o := pay_org_row(tid);
  if e.status not in ('active', 'notice') then raise exception 'Clocking in is for current employees'; end if;
  if pay_att_mode(e) = 'none' then raise exception 'Your attendance is not tracked, so there is nothing to clock'; end if;
  st := pay_punch_state(tid, e.id);
  if (st->>'last') is not null and (st->>'last')::timestamptz > now() - interval '8 seconds' then
    return st || jsonb_build_object('duplicate', true);   -- a double tap
  end if;
  lat := nullif(p->>'lat', '')::numeric; lng := nullif(p->>'lng', '')::numeric;
  select l.* into loc from pay_locations l where l.id = (pay_job_at(e.id, pay_today(tid))).location_id;
  gf := pay_cfg(o.settings, 'att', 'geofence', 'flag');
  if loc.lat is not null and loc.radius_m is not null and gf <> 'off' then
    if lat is null then
      if gf = 'block' then raise exception 'Turn on location to clock in: your workplace checks that you are there'; end if;
      outr := true;
    else
      dist := round(2 * 6371000 * asin(sqrt(power(sin(radians(lat - loc.lat) / 2), 2) + cos(radians(loc.lat)) * cos(radians(lat)) * power(sin(radians(lng - loc.lng) / 2), 2))));
      outr := dist > loc.radius_m;
      if outr and gf = 'block' then raise exception 'You seem to be % m from %. Clock in when you are there.', dist, loc.name; end if;
    end if;
  end if;
  insert into pay_punches (tenant_id, employee_id, at, kind, source, lat, lng, accuracy_m, distance_m, out_of_range, created_by)
  values (tid, e.id, now(), case when (st->>'open')::boolean then 'out' else 'in' end, 'mobile', lat, lng, nullif(p->>'accuracy', '')::numeric::int, dist, outr, app_uid());
  d := pay_today(tid);
  perform pay_att_refresh(tid, e.id, d - 1, d);
  return pay_punch_state(tid, e.id) || jsonb_build_object('out_of_range', outr, 'distance_m', dist);
end $$;

create or replace function pay_kiosk_punch(p_emp text, p_pin text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; e pay_employees; o pay_org; st jsonb; fails int; d date;
begin
  tid := pay_guard('pay_time');
  select * into e from pay_employees where id = p_emp and tenant_id = tid and status in ('active', 'notice');
  if e.id is null then raise exception 'Employee not found'; end if;
  o := pay_org_row(tid);
  select count(*) into fails from pay_pin_fails where employee_id = e.id and at > now() - interval '5 minutes';
  if fails >= 5 then return jsonb_build_object('ok', false, 'error', 'Too many wrong PINs. Try again in a few minutes.'); end if;
  if e.kiosk_pin is null then
    if pay_cfg(o.settings, 'att', 'kiosk_pin', 'true')::boolean then return jsonb_build_object('ok', false, 'error', 'No PIN is set for ' || e.name || '. Ask your manager to set one.'); end if;
  elsif p_pin is null or crypt(p_pin, e.kiosk_pin) <> e.kiosk_pin then
    insert into pay_pin_fails (tenant_id, employee_id) values (tid, e.id);
    return jsonb_build_object('ok', false, 'error', 'Wrong PIN');
  end if;
  delete from pay_pin_fails where employee_id = e.id;
  st := pay_punch_state(tid, e.id);
  if (st->>'last') is not null and (st->>'last')::timestamptz > now() - interval '8 seconds' then return jsonb_build_object('ok', true, 'name', e.name, 'duplicate', true) || st; end if;
  insert into pay_punches (tenant_id, employee_id, at, kind, source, created_by) values (tid, e.id, now(), case when (st->>'open')::boolean then 'out' else 'in' end, 'kiosk', app_uid());
  d := pay_today(tid);
  perform pay_att_refresh(tid, e.id, d - 1, d);
  return jsonb_build_object('ok', true, 'name', e.name, 'kind', case when (st->>'open')::boolean then 'out' else 'in' end, 'at', now()) || jsonb_build_object('state', pay_punch_state(tid, e.id));
end $$;
