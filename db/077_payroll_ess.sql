-- =========================================================
-- AUZslab Payroll v2: employee self-service (pay_me_*), the shared-device kiosk, the one-time import of the old Payroll
-- (records kinds hr_*, ids kept), the salon console hooks (salon_hr_* / salon_punch*, same signatures as db/054, now on
-- the new tables), POS clock-ins flowing into attendance, and the public demo's sample data.
-- =========================================================

-- the employee linked to the signed-in login, or a clear message
create function pay_me_emp(tid uuid) returns pay_employees language plpgsql stable security definer set search_path = public as $$
declare e pay_employees;
begin
  select * into e from pay_employees where tenant_id = tid and user_id = app_uid();
  if e.id is null then raise exception 'Your login is not linked to an employee yet. Ask your manager to link it in Payroll (People > your name > Self-service login).'; end if;
  return e;
end $$;

-- is the employee clocked in right now (an odd number of clock-ins in today's window, or an explicit "in" last)
create function pay_punch_state(tid uuid, emp text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d date; sh pay_shifts; ws timestamptz; p record; st text := 'out'; cur_in timestamptz; last_at timestamptz; n int := 0; tz text;
begin
  tz := pay_tz(tid); d := pay_today(tid);
  sh := pay_shift_on(emp, d);
  ws := ((d::timestamp + coalesce(sh.start_time, time '10:00') - interval '6 hours') at time zone tz);
  -- before today's window opens, an overnight shift may still be running from yesterday
  if now() < ws then ws := ws - interval '1 day'; end if;
  for p in select at, kind from pay_punches where employee_id = emp and voided_at is null and at >= ws and at < ws + interval '1 day' order by at loop
    n := n + 1; last_at := p.at;
    if p.kind = 'in' or (p.kind = 'auto' and st = 'out') then if st = 'out' then cur_in := p.at; end if; st := 'in';
    else st := 'out'; end if;
  end loop;
  return jsonb_build_object('open', st = 'in', 'in', case when st = 'in' then cur_in end, 'last', last_at, 'count', n, 'shift', sh.name,
    'shift_start', sh.start_time, 'shift_end', sh.end_time);
end $$;

create function pay_me() returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; e pay_employees; td date; j pay_jobs; o pay_org; last_item record; mgr boolean;
begin
  tid := pay_tenant(); e := pay_me_emp(tid); td := pay_today(tid); o := pay_org_row(tid);
  if e.status in ('active', 'notice') then perform pay_att_compute(tid, e.id, td); end if;
  j := pay_job_at(e.id, td);
  select i.id, r.title, r.month, i.net, i.gross, r.pay_date into last_item from pay_run_items i join pay_runs r on r.id = i.run_id
   where i.employee_id = e.id and r.status in ('finalized', 'paid', 'locked') and i.published order by r.month desc, r.created_at desc limit 1;
  mgr := exists (select 1 from pay_jobs x join pay_employees y on y.id = x.employee_id where x.tenant_id = tid and x.manager_id = e.id and y.status in ('active', 'notice'));
  return jsonb_build_object(
    'employee', jsonb_build_object('id', e.id, 'name', e.name, 'code', e.code, 'status', e.status, 'joined_on', e.joined_on, 'last_day', e.last_day, 'phone', e.phone,
      'email', e.email, 'gender', e.gender, 'address', e.address, 'emergency_name', e.emergency_name, 'emergency_phone', e.emergency_phone, 'photo', e.photo,
      'designation', j.designation, 'department', j.department, 'location', (select name from pay_locations where id = j.location_id),
      'manager', (select name from pay_employees where id = j.manager_id), 'mode', pay_att_mode(e)),
    'org', jsonb_build_object('name', coalesce(o.display_name, o.legal_name), 'geofence', pay_cfg(o.settings, 'att', 'geofence', 'flag'),
      'has_site', exists (select 1 from pay_locations l where l.id = j.location_id and l.lat is not null and l.radius_m is not null)),
    'today', (select to_jsonb(a) - 'tenant_id' from pay_attendance a where a.employee_id = e.id and a.att_date = td), 'date', td,
    'punch', pay_punch_state(tid, e.id),
    'punches', coalesce((select jsonb_agg(jsonb_build_object('at', at, 'kind', kind, 'source', source) order by at) from pay_punches
                         where employee_id = e.id and voided_at is null and at >= ((td::timestamp) at time zone pay_tz(tid)) - interval '6 hours'), '[]'),
    'leave', pay_leave_summary(e.id),
    'leave_types', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'code', code, 'paid', paid, 'half_day', half_day) order by sort, name), '[]')
                    from pay_leave_types where tenant_id = tid and active and (gender is null or gender = e.gender)),
    'requests', coalesce((select jsonb_agg(x order by x->>'created_at' desc) from (
        select jsonb_build_object('type', 'leave', 'id', q.id, 'title', t.name, 'from', q.from_date, 'to', q.to_date, 'half', q.half, 'days', q.days, 'status', q.status,
               'note', q.decision_note, 'created_at', q.created_at) x from pay_leave_requests q join pay_leave_types t on t.id = q.leave_type_id where q.employee_id = e.id and q.created_at > now() - interval '120 days'
        union all select jsonb_build_object('type', 'correction', 'id', r.id, 'title', 'Attendance correction', 'from', r.att_date, 'in', r.in_at, 'out', r.out_at, 'status', r.status,
               'note', r.decision_note, 'created_at', r.created_at) from pay_regularizations r where r.employee_id = e.id and r.created_at > now() - interval '120 days'
        union all select jsonb_build_object('type', 'loan', 'id', l.id, 'title', case when l.kind = 'advance' then 'Salary advance' else 'Loan' end, 'amount', l.amount, 'emi', l.emi, 'status', l.status,
               'outstanding', (select coalesce(sum(amount), 0) from pay_loan_ledger where loan_id = l.id), 'created_at', l.created_at) from pay_loans l where l.employee_id = e.id and (l.status in ('requested', 'active') or l.created_at > now() - interval '120 days')
        union all select jsonb_build_object('type', 'claim', 'id', c.id, 'title', c.category, 'amount', coalesce(c.approved_amount, c.amount), 'from', c.claim_date, 'status', c.status,
               'note', c.decision_note, 'created_at', c.created_at) from pay_claims c where c.employee_id = e.id and c.created_at > now() - interval '120 days') y), '[]'),
    'payslip', case when last_item.id is null then null else jsonb_build_object('id', last_item.id, 'title', last_item.title, 'month', last_item.month, 'net', last_item.net,
      'gross', last_item.gross, 'pay_date', last_item.pay_date) end,
    'announcements', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'title', title, 'body', body, 'at', created_at) order by created_at desc)
                               from (select * from pay_announcements where tenant_id = tid and active order by created_at desc limit 5) a), '[]'),
    'holidays', coalesce((select jsonb_agg(jsonb_build_object('date', hdate, 'name', name) order by hdate) from (select * from pay_holidays where tenant_id = tid and hdate >= td
                          and (location_id is null or location_id = j.location_id) order by hdate limit 6) h), '[]'),
    'is_manager', mgr,
    'team', case when mgr then coalesce((select jsonb_agg(jsonb_build_object('id', y.id, 'name', y.name, 'status', a.status, 'in', a.first_in) order by y.name)
      from pay_employees y join lateral (select * from pay_jobs where employee_id = y.id and eff_from <= td order by eff_from desc limit 1) jj on true
      left join pay_attendance a on a.employee_id = y.id and a.att_date = td where jj.manager_id = e.id and y.status in ('active', 'notice')), '[]') end,
    'team_pending', case when mgr then (select count(*) from pay_leave_requests q where q.status = 'pending' and q.tenant_id = tid and pay_is_manager_of(q.employee_id))
                    + (select count(*) from pay_regularizations r where r.status = 'pending' and r.tenant_id = tid and pay_is_manager_of(r.employee_id)) end);
end $$;

-- clock in or out from the phone. p: {lat, lng, accuracy}
create function pay_me_punch(p jsonb default '{}') returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; e pay_employees; o pay_org; loc pay_locations; st jsonb; dist int; outr boolean := false; gf text; lat numeric; lng numeric; d date;
begin
  tid := pay_tenant(); e := pay_me_emp(tid); o := pay_org_row(tid);
  if e.status not in ('active', 'notice') then raise exception 'Clocking in is for current employees'; end if;
  if pay_att_mode(e) = 'none' then raise exception 'Your attendance is not tracked, so there is nothing to clock'; end if;
  st := pay_punch_state(tid, e.id);
  if (st->>'last') is not null and (st->>'last')::timestamptz > now() - interval '60 seconds' then
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

create function pay_me_attendance(p_month text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; e pay_employees;
begin
  tid := pay_tenant(); e := pay_me_emp(tid);
  return pay_attendance_month(e.id, p_month);
end $$;

create function pay_me_leave_apply(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; e pay_employees; days numeric; qid uuid; f date; t date; h text;
begin
  tid := pay_tenant(); e := pay_me_emp(tid);
  if e.status not in ('active', 'notice') then raise exception 'Leave is for current employees'; end if;
  f := (p->>'from')::date; t := coalesce(nullif(p->>'to', '')::date, f); h := coalesce(nullif(p->>'half', ''), 'none');
  if f is null then raise exception 'Pick the dates'; end if;
  if f < pay_today(tid) - 30 then raise exception 'Leave more than 30 days ago has to be added by your manager'; end if;
  days := pay_leave_validate(tid, e.id, (p->>'leave_type_id')::uuid, f, t, h, null);
  insert into pay_leave_requests (tenant_id, employee_id, leave_type_id, from_date, to_date, half, days, reason, created_by)
  values (tid, e.id, (p->>'leave_type_id')::uuid, f, t, h, days, pay_clean(p->>'reason', 300), app_uid()) returning id into qid;
  perform pay_audit_log(tid, 'request', 'leave', qid::text, e.id, null, p, null);
  return (select to_jsonb(q) - 'tenant_id' from pay_leave_requests q where id = qid);
end $$;

create function pay_me_regularize(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; e pay_employees; d date; tz text; rid uuid; ina timestamptz; outa timestamptz;
begin
  tid := pay_tenant(); e := pay_me_emp(tid); tz := pay_tz(tid);
  d := (p->>'date')::date;
  if d is null or d > pay_today(tid) then raise exception 'Pick a day that has passed'; end if;
  if d < pay_today(tid) - 60 then raise exception 'Corrections are for the last 60 days'; end if;
  if d < e.joined_on then raise exception 'That is before you joined'; end if;
  if nullif(p->>'in', '') is null then raise exception 'Enter the time you started'; end if;
  if pay_clean(p->>'reason', 300) is null then raise exception 'Say what happened'; end if;
  if exists (select 1 from pay_attendance where employee_id = e.id and att_date = d and locked_run is not null) then raise exception 'Payroll for that day is already finalised'; end if;
  if exists (select 1 from pay_regularizations where employee_id = e.id and att_date = d and status = 'pending') then raise exception 'You already asked for a correction for that day'; end if;
  ina := (d::timestamp + (p->>'in')::time) at time zone tz;
  if nullif(p->>'out', '') is not null then outa := (d::timestamp + (p->>'out')::time + case when (p->>'out')::time <= (p->>'in')::time then interval '1 day' else interval '0' end) at time zone tz; end if;
  insert into pay_regularizations (tenant_id, employee_id, att_date, in_at, out_at, reason, created_by) values (tid, e.id, d, ina, outa, pay_clean(p->>'reason', 300), app_uid()) returning id into rid;
  perform pay_audit_log(tid, 'request', 'regularization', rid::text, e.id, null, p, null);
  return (select to_jsonb(r) - 'tenant_id' from pay_regularizations r where id = rid);
end $$;

create function pay_me_cancel(p_type text, p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; e pay_employees;
begin
  tid := pay_tenant(); e := pay_me_emp(tid);
  if p_type = 'leave' then return pay_leave_cancel(p_id, 'Cancelled by the employee'); end if;
  if p_type = 'correction' then
    update pay_regularizations set status = 'cancelled', decided_at = now() where id = p_id and employee_id = e.id and status = 'pending';
  elsif p_type = 'loan' then
    update pay_loans set status = 'cancelled', decided_at = now() where id = p_id and employee_id = e.id and status = 'requested';
  elsif p_type = 'claim' then
    update pay_claims set status = 'cancelled', decided_at = now() where id = p_id and employee_id = e.id and status = 'submitted';
  else raise exception 'Unknown request'; end if;
  if not found then raise exception 'Only a request that is still waiting can be cancelled'; end if;
  perform pay_audit_log(tid, 'cancel', p_type, p_id::text, e.id, null, null, null);
  return jsonb_build_object('ok', true);
end $$;

create function pay_me_payslips() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; e pay_employees;
begin
  tid := pay_tenant(); e := pay_me_emp(tid);
  return coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'title', r.title, 'kind', r.kind, 'month', r.month, 'pay_date', r.pay_date, 'gross', i.gross,
      'deductions', i.deductions, 'net', i.net, 'payslip_no', i.payslip_no, 'paid', r.status in ('paid', 'locked') or exists (select 1 from pay_batch_lines bl where bl.item_id = i.id and bl.status = 'paid'))
      order by r.month desc, r.created_at desc)
    from pay_run_items i join pay_runs r on r.id = i.run_id where i.employee_id = e.id and r.status in ('finalized', 'paid', 'locked') and i.published), '[]');
end $$;

create function pay_me_loan_request(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid; e pay_employees; lid uuid; amt numeric;
begin
  tid := pay_tenant(); e := pay_me_emp(tid);
  if e.status <> 'active' then raise exception 'Advances are for current employees'; end if;
  amt := (p->>'amount')::numeric;
  if coalesce(amt, 0) <= 0 then raise exception 'Enter the amount'; end if;
  if exists (select 1 from pay_loans where employee_id = e.id and status = 'requested') then raise exception 'You already have a request waiting'; end if;
  insert into pay_loans (tenant_id, employee_id, kind, amount, emi, start_month, status, reason, requested_by)
  values (tid, e.id, coalesce(nullif(p->>'kind', ''), 'advance'), amt, least(coalesce(nullif(p->>'emi', '')::numeric, amt), amt), pay_month_of(pay_today(tid)), 'requested', pay_clean(p->>'reason', 300), app_uid())
  returning id into lid;
  perform pay_audit_log(tid, 'request', 'loan', lid::text, e.id, null, p, null);
  return lid;
end $$;

create function pay_me_claim(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid; e pay_employees; cid uuid;
begin
  tid := pay_tenant(); e := pay_me_emp(tid);
  if coalesce((p->>'amount')::numeric, 0) <= 0 then raise exception 'Enter the amount'; end if;
  if coalesce(nullif(p->>'date', '')::date, pay_today(tid)) > pay_today(tid) then raise exception 'The expense date cannot be in the future'; end if;
  if nullif(p->>'attachment', '') is not null and p->>'attachment' !~ ('^' || tid::text || '/') then raise exception 'Upload the receipt first'; end if;
  insert into pay_claims (tenant_id, employee_id, claim_date, category, amount, description, attachment, created_by)
  values (tid, e.id, coalesce(nullif(p->>'date', '')::date, pay_today(tid)), coalesce(pay_clean(p->>'category', 60), 'Other'), (p->>'amount')::numeric,
          pay_clean(p->>'description', 300), nullif(p->>'attachment', ''), app_uid()) returning id into cid;
  perform pay_audit_log(tid, 'request', 'claim', cid::text, e.id, null, p, null);
  return cid;
end $$;

-- a change of payout details waits for approval by someone with salary rights (fraud check)
create function pay_me_bank_request(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid; e pay_employees;
begin
  tid := pay_tenant(); e := pay_me_emp(tid);
  update pay_bank_accounts set status = 'replaced' where employee_id = e.id and status = 'pending';
  return pay_bank_insert(tid, e.id, p, 'pending');
end $$;

create function pay_me_profile(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; e pay_employees;
begin
  tid := pay_tenant(); e := pay_me_emp(tid);
  perform pay_check_ids(p - 'email' - 'pan' - 'uan' - 'esi_no' - 'aadhaar_last4');
  update pay_employees set phone = case when p ? 'phone' then pay_clean(p->>'phone', 20) else phone end,
    address = case when p ? 'address' then pay_clean(p->>'address', 400) else address end,
    emergency_name = case when p ? 'emergency_name' then pay_clean(p->>'emergency_name', 120) else emergency_name end,
    emergency_phone = case when p ? 'emergency_phone' then pay_clean(p->>'emergency_phone', 20) else emergency_phone end,
    updated_at = now() where id = e.id;
  perform pay_audit_log(tid, 'update', 'employee', e.id, e.id, jsonb_build_object('phone', e.phone, 'address', e.address), p, 'Changed by the employee');
  return jsonb_build_object('ok', true);
end $$;

create function pay_me_tax() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; e pay_employees;
begin
  tid := pay_tenant(); e := pay_me_emp(tid);
  return jsonb_build_object('fy', pay_fy_label(pay_fy_start(tid, pay_today(tid))), 'regime_default', e.tax_regime,
    'declaration', (select to_jsonb(d) - 'tenant_id' from pay_tax_decl d where employee_id = e.id and d.fy = pay_fy_label(pay_fy_start(tid, pay_today(tid)))),
    'projection', pay_tax_projection(tid, e.id));
end $$;

create function pay_me_tax_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; e pay_employees;
begin
  tid := pay_tenant(); e := pay_me_emp(tid);
  return pay_tax_decl_save(tid, e.id, p - 'fy', false);
end $$;

create function pay_me_documents() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; e pay_employees;
begin
  tid := pay_tenant(); e := pay_me_emp(tid);
  return coalesce((select jsonb_agg(to_jsonb(d) - 'tenant_id' order by d.created_at desc) from pay_documents d where d.employee_id = e.id and d.employee_can_see), '[]');
end $$;

create function pay_save_announcement(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid; aid uuid := nullif(p->>'id', '')::uuid;
begin
  tid := pay_guard('pay_people');
  if aid is null then
    if pay_clean(p->>'title', 120) is null then raise exception 'Give the notice a title'; end if;
    insert into pay_announcements (tenant_id, title, body, created_by) values (tid, pay_clean(p->>'title', 120), left(p->>'body', 2000), app_uid()) returning id into aid;
  else
    update pay_announcements set title = coalesce(pay_clean(p->>'title', 120), title), body = case when p ? 'body' then left(p->>'body', 2000) else body end,
      active = coalesce((p->>'active')::boolean, active) where id = aid and tenant_id = tid;
  end if;
  perform pay_audit_log(tid, 'save', 'announcement', aid::text, null, null, p, null);
  return aid;
end $$;

create function pay_list_announcements() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := pay_guard('pay_view');
  return coalesce((select jsonb_agg(to_jsonb(a) - 'tenant_id' order by a.created_at desc) from pay_announcements a where a.tenant_id = tid), '[]');
end $$;

-- ---------- kiosk: a shared phone or tablet at work, signed in by someone with pay_time ----------
create function pay_kiosk_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := pay_guard('pay_time');
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'code', e.code, 'photo', e.photo, 'pin', e.kiosk_pin is not null,
      'state', pay_punch_state(tid, e.id)) order by e.name)
    from pay_employees e where e.tenant_id = tid and e.status in ('active', 'notice') and pay_att_mode(e) <> 'none'), '[]');
end $$;

-- A wrong PIN returns {ok:false} instead of raising, so the failed attempt is remembered: 5 wrong PINs lock it for 5 minutes.
create function pay_kiosk_punch(p_emp text, p_pin text) returns jsonb language plpgsql security definer set search_path = public as $$
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
  if (st->>'last') is not null and (st->>'last')::timestamptz > now() - interval '60 seconds' then return jsonb_build_object('ok', true, 'name', e.name, 'duplicate', true) || st; end if;
  insert into pay_punches (tenant_id, employee_id, at, kind, source, created_by) values (tid, e.id, now(), case when (st->>'open')::boolean then 'out' else 'in' end, 'kiosk', app_uid());
  d := pay_today(tid);
  perform pay_att_refresh(tid, e.id, d - 1, d);
  return jsonb_build_object('ok', true, 'name', e.name, 'kind', case when (st->>'open')::boolean then 'out' else 'in' end, 'at', now()) || jsonb_build_object('state', pay_punch_state(tid, e.id));
end $$;

-- ---------- reports ----------
-- p: {month, run_id, from, to, fy, employee_id}. Returns {title, head, rows, totals, note}
create function pay_report(p_kind text, p jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; m text; f date; t date; rid uuid; res jsonb; codes text[]; fys date; fye date; sal boolean;
begin
  tid := pay_tenant();
  sal := pay_perm('pay_salary') or pay_perm('pay_run') or pay_perm('pay_approve') or pay_perm('pay_pay');
  if not pay_perm('pay_reports') and not sal then raise exception 'Your role does not include reports' using errcode = '42501'; end if;
  if p_kind not in ('attendance', 'leave', 'headcount', 'late') and not sal then raise exception 'This report shows pay: your role does not include salaries' using errcode = '42501'; end if;
  m := coalesce(nullif(p->>'month', ''), pay_month_of(pay_today(tid)));
  f := coalesce(nullif(p->>'from', '')::date, pay_month_from(m)); t := coalesce(nullif(p->>'to', '')::date, pay_month_to(m));
  rid := nullif(p->>'run_id', '')::uuid;
  if rid is null and p_kind in ('register', 'bank', 'pf', 'esi') then
    select id into rid from pay_runs where tenant_id = tid and kind = 'regular' and month = m and status <> 'cancelled' order by created_at desc limit 1;
  end if;
  if rid is not null and not exists (select 1 from pay_runs where id = rid and tenant_id = tid) then raise exception 'Payroll not found'; end if;
  fys := coalesce(nullif(p->>'fy_start', '')::date, pay_fy_start(tid, pay_today(tid))); fye := (fys + interval '1 year' - interval '1 day')::date;

  if p_kind = 'register' then
    select array_agg(code order by min_sort, code) into codes from (select l.code, min(l.sort) min_sort from pay_run_lines l where l.run_id = rid group by l.code) z;
    return jsonb_build_object('title', 'Salary register', 'run', (select pay_run_summary(rid)),
      'head', jsonb_build_array('Code', 'Name', 'Department', 'Paid days') || coalesce((select jsonb_agg(coalesce((select name from pay_components c where c.tenant_id = tid and c.code = x), x) order by n) from unnest(codes) with ordinality u(x, n)), '[]') || jsonb_build_array('Gross', 'Deductions', 'Net pay', 'Employer cost'),
      'rows', coalesce((select jsonb_agg(jsonb_build_array(i.snap->>'code', i.snap->>'name', i.snap->>'department', (i.att->>'paid_days')::numeric)
          || coalesce((select jsonb_agg(coalesce((select sum(amount) from pay_run_lines l where l.item_id = i.id and l.code = x), 0) order by n) from unnest(codes) with ordinality u(x, n)), '[]')
          || jsonb_build_array(i.gross, i.deductions, i.net, i.employer) order by i.snap->>'name') from pay_run_items i where i.run_id = rid), '[]'),
      'numeric_from', 3);
  elsif p_kind = 'summary' then
    return jsonb_build_object('title', 'Salary summary by department', 'head', jsonb_build_array('Department', 'People', 'Gross', 'Deductions', 'Net pay', 'Employer cost', 'Total cost'),
      'rows', coalesce((select jsonb_agg(jsonb_build_array(coalesce(dept, 'No department'), n, g, d, nt, em, g + em) order by g desc) from (
        select i.snap->>'department' dept, count(distinct i.employee_id) n, sum(i.gross) g, sum(i.deductions) d, sum(i.net) nt, sum(i.employer) em
        from pay_run_items i join pay_runs r on r.id = i.run_id where r.tenant_id = tid and r.status in ('finalized', 'paid', 'locked') and r.month between pay_month_of(f) and pay_month_of(t)
        group by 1) z), '[]'), 'numeric_from', 1);
  elsif p_kind = 'pf' then
    return jsonb_build_object('title', 'Provident fund (ECR)', 'note', 'Upload the ECR text file on the EPFO employer portal. Check the figures first.',
      'head', jsonb_build_array('UAN', 'Name', 'Gross wages', 'EPF wages', 'EPS wages', 'EDLI wages', 'Employee share', 'Pension (EPS)', 'Employer EPF', 'Days not paid', 'Refund'),
      'rows', coalesce((select jsonb_agg(jsonb_build_array(coalesce(i.snap->>'uan', ''), i.snap->>'name', round(i.gross), round(i.pf_wage), round(i.eps_wage), round(i.edli_wage),
          coalesce((select sum(amount) from pay_run_lines l where l.item_id = i.id and l.code = 'PF_EE'), 0), coalesce((select sum(amount) from pay_run_lines l where l.item_id = i.id and l.code = 'EPS_ER'), 0),
          coalesce((select sum(amount) from pay_run_lines l where l.item_id = i.id and l.code = 'PF_ER'), 0), round(i.ncp_days), 0) order by i.snap->>'name')
        from pay_run_items i where i.run_id = rid and exists (select 1 from pay_run_lines l where l.item_id = i.id and l.code = 'PF_EE')), '[]'),
      'totals', (select jsonb_build_object('PF_EE', sum(amount) filter (where code = 'PF_EE'), 'PF_ER', sum(amount) filter (where code = 'PF_ER'), 'EPS_ER', sum(amount) filter (where code = 'EPS_ER'),
          'EDLI', sum(amount) filter (where code = 'EDLI'), 'PF_ADMIN', sum(amount) filter (where code = 'PF_ADMIN')) from pay_run_lines where run_id = rid), 'numeric_from', 2);
  elsif p_kind = 'esi' then
    return jsonb_build_object('title', 'ESI contributions', 'note', 'Same columns as the ESIC monthly contribution upload.',
      'head', jsonb_build_array('IP number', 'Name', 'Days paid', 'Wages', 'Employee share', 'Employer share', 'Reason code', 'Last working day'),
      'rows', coalesce((select jsonb_agg(jsonb_build_array(coalesce(i.snap->>'esi_no', ''), i.snap->>'name', round(coalesce((i.att->>'paid_days')::numeric, 0)), round(i.esi_wage),
          coalesce((select sum(amount) from pay_run_lines l where l.item_id = i.id and l.code = 'ESI_EE'), 0), coalesce((select sum(amount) from pay_run_lines l where l.item_id = i.id and l.code = 'ESI_ER'), 0),
          case when i.snap->>'last_day' is not null and (i.snap->>'last_day')::date <= (select period_to from pay_runs where id = rid) then '2' when i.esi_wage = 0 then '1' else '0' end,
          coalesce(i.snap->>'last_day', '')) order by i.snap->>'name')
        from pay_run_items i where i.run_id = rid and i.esi_covered), '[]'), 'numeric_from', 2);
  elsif p_kind = 'pt' then
    return jsonb_build_object('title', 'Professional tax', 'head', jsonb_build_array('Month', 'State', 'People', 'Wages', 'Tax'),
      'rows', coalesce((select jsonb_agg(jsonb_build_array(z.month, coalesce(z.pt_state, ''), z.n, z.w, z.amt) order by z.month, z.pt_state) from (
        select r.month, i.pt_state, count(*) n, sum(i.pt_wage) w, sum(l.amount) amt
        from pay_run_lines l join pay_run_items i on i.id = l.item_id join pay_runs r on r.id = l.run_id
        where r.tenant_id = tid and l.code = 'PT' and r.status in ('finalized', 'paid', 'locked') and r.month between pay_month_of(f) and pay_month_of(t) group by r.month, i.pt_state) z), '[]'), 'numeric_from', 2);
  elsif p_kind = 'tds' then
    return jsonb_build_object('title', 'Income tax deducted (TDS)', 'note', 'Working figures for your quarterly salary TDS return (24Q).',
      'head', jsonb_build_array('Month', 'Code', 'Name', 'PAN', 'Taxable pay', 'TDS'),
      'rows', coalesce((select jsonb_agg(jsonb_build_array(r.month, i.snap->>'code', i.snap->>'name', coalesce(e.pan, ''), i.taxable,
          coalesce((select sum(amount) from pay_run_lines l where l.item_id = i.id and l.code = 'TDS'), 0)) order by r.month, i.snap->>'name')
        from pay_run_items i join pay_runs r on r.id = i.run_id join pay_employees e on e.id = i.employee_id
        where r.tenant_id = tid and r.status in ('finalized', 'paid', 'locked') and r.month between pay_month_of(f) and pay_month_of(t)), '[]'), 'numeric_from', 4);
  elsif p_kind = 'bank' then
    return jsonb_build_object('title', 'Bank transfer list', 'head', jsonb_build_array('Name', 'Account holder', 'Bank', 'Account number', 'IFSC', 'Amount', 'Status'),
      'rows', coalesce((select jsonb_agg(jsonb_build_array(e.name, coalesce(b.holder, e.name), coalesce(b.bank_name, ''), case when pay_perm('pay_pay') then coalesce(b.account_no, '') else coalesce(pay_mask(b.account_no), '') end,
          coalesce(b.ifsc, ''), i.net, case when exists (select 1 from pay_batch_lines bl where bl.item_id = i.id and bl.status = 'paid') then 'Paid' when i.status = 'hold' then 'On hold' else 'Not paid' end) order by e.name)
        from pay_run_items i join pay_employees e on e.id = i.employee_id left join pay_bank_accounts b on b.employee_id = i.employee_id and b.status = 'active' where i.run_id = rid and i.net > 0), '[]'), 'numeric_from', 5);
  elsif p_kind = 'ctc' then
    return jsonb_build_object('title', 'Salaries now', 'head', jsonb_build_array('Code', 'Name', 'Department', 'Designation', 'Since', 'Monthly gross', 'Employer cost', 'Monthly CTC', 'Annual CTC'),
      'rows', coalesce((select jsonb_agg(jsonb_build_array(e.code, e.name, j.department, j.designation, s.eff_from, (s.breakup->>'gross')::numeric, (s.breakup->>'employer')::numeric,
          (s.breakup->>'ctc')::numeric, (s.breakup->>'ctc')::numeric * 12) order by e.name)
        from pay_employees e join lateral (select * from pay_salaries where employee_id = e.id and eff_from <= pay_today(tid) order by eff_from desc limit 1) s on true
        left join lateral (select * from pay_jobs where employee_id = e.id and eff_from <= pay_today(tid) order by eff_from desc limit 1) j on true
        where e.tenant_id = tid and e.status in ('active', 'notice')), '[]'), 'numeric_from', 5);
  elsif p_kind = 'loans' then
    return jsonb_build_object('title', 'Loans and advances', 'head', jsonb_build_array('Name', 'Type', 'Given on', 'Amount', 'Monthly', 'Recovered', 'Outstanding', 'Status'),
      'rows', coalesce((select jsonb_agg(jsonb_build_array(e.name, l.kind, l.disbursed_on, l.amount, l.emi,
          coalesce((select -sum(amount) from pay_loan_ledger g where g.loan_id = l.id and g.kind = 'recover'), 0), coalesce((select sum(amount) from pay_loan_ledger g where g.loan_id = l.id), 0), l.status) order by e.name)
        from pay_loans l join pay_employees e on e.id = l.employee_id where l.tenant_id = tid and l.status in ('active', 'closed')), '[]'), 'numeric_from', 3);
  elsif p_kind = 'liabilities' then
    return jsonb_build_object('title', 'Statutory dues', 'head', jsonb_build_array('Scheme', 'Month', 'Due', 'Paid', 'Left', 'Usual due date'),
      'rows', coalesce((select jsonb_agg(jsonb_build_array(x->>'scheme', x->>'month', (x->>'due')::numeric, (x->>'paid')::numeric, (x->>'left')::numeric, x->>'due_date')) from jsonb_array_elements(pay_compliance_dues(tid)) x), '[]'), 'numeric_from', 2);
  elsif p_kind = 'attendance' then
    return jsonb_build_object('title', 'Attendance summary', 'head', jsonb_build_array('Code', 'Name', 'Present', 'Late', 'Half days', 'Absent', 'Paid leave', 'Unpaid leave', 'Holidays', 'Weekly offs', 'Unpaid days', 'Overtime hours'),
      'rows', coalesce((select jsonb_agg(z.r order by z.name) from (select e.name, jsonb_build_array(e.code, e.name, count(*) filter (where a.status in ('present', 'late', 'missing')), count(*) filter (where a.status = 'late'),
          count(*) filter (where a.status in ('half', 'half_leave')), count(*) filter (where a.status = 'absent'), coalesce(sum(a.leave_days) filter (where a.leave_paid), 0),
          coalesce(sum(a.leave_days) filter (where a.leave_paid = false), 0), count(*) filter (where a.status = 'holiday'), count(*) filter (where a.status = 'weekly_off'), coalesce(sum(a.lop), 0),
          round(coalesce(sum(a.ot_mins), 0) / 60.0, 1)) r
        from pay_employees e join pay_attendance a on a.employee_id = e.id and a.att_date between f and t where e.tenant_id = tid group by e.id, e.code, e.name) z), '[]'), 'numeric_from', 2);
  elsif p_kind = 'late' then
    return jsonb_build_object('title', 'Late arrivals', 'head', jsonb_build_array('Date', 'Name', 'Shift', 'In at', 'Minutes late'),
      'rows', coalesce((select jsonb_agg(jsonb_build_array(a.att_date, e.name, coalesce(s.name, ''), to_char(a.first_in at time zone pay_tz(tid), 'HH24:MI'), a.late_mins) order by a.att_date desc, e.name)
        from pay_attendance a join pay_employees e on e.id = a.employee_id left join pay_shifts s on s.id = a.shift_id where e.tenant_id = tid and a.att_date between f and t and a.late_mins > 0), '[]'), 'numeric_from', 4);
  elsif p_kind = 'leave' then
    return jsonb_build_object('title', 'Leave balances', 'head', jsonb_build_array('Code', 'Name') || coalesce((select jsonb_agg(name order by sort, name) from pay_leave_types where tenant_id = tid and active and paid), '[]'),
      'rows', coalesce((select jsonb_agg(jsonb_build_array(e.code, e.name) || coalesce((select jsonb_agg(pay_leave_balance(e.id, lt.id) order by lt.sort, lt.name) from pay_leave_types lt where lt.tenant_id = tid and lt.active and lt.paid), '[]') order by e.name)
        from pay_employees e where e.tenant_id = tid and e.status in ('active', 'notice')), '[]'), 'numeric_from', 2);
  elsif p_kind = 'headcount' then
    return jsonb_build_object('title', 'Joiners and leavers', 'head', jsonb_build_array('Name', 'Code', 'Department', 'Joined', 'Left', 'Status', 'Reason'),
      'rows', coalesce((select jsonb_agg(jsonb_build_array(e.name, e.code, (pay_job_at(e.id, t)).department, e.joined_on, e.last_day, e.status, coalesce(e.exit_kind, '')) order by coalesce(e.last_day, e.joined_on) desc)
        from pay_employees e where e.tenant_id = tid and (e.joined_on between f and t or e.last_day between f and t)), '[]'));
  elsif p_kind = 'form16' then
    if nullif(p->>'employee_id', '') is null then raise exception 'Pick the employee'; end if;
    return jsonb_build_object('title', 'Annual tax statement (Form 16 Part B working)', 'fy', pay_fy_label(fys),
      'employee', (select jsonb_build_object('name', name, 'code', code, 'pan', pan) from pay_employees where id = p->>'employee_id' and tenant_id = tid),
      'head', jsonb_build_array('Month', 'Gross', 'Taxable', 'PF', 'Professional tax', 'TDS'),
      'rows', coalesce((select jsonb_agg(jsonb_build_array(r.month, i.gross, i.taxable, coalesce((select sum(amount) from pay_run_lines l where l.item_id = i.id and l.code = 'PF_EE'), 0),
          coalesce((select sum(amount) from pay_run_lines l where l.item_id = i.id and l.code = 'PT'), 0), coalesce((select sum(amount) from pay_run_lines l where l.item_id = i.id and l.code = 'TDS'), 0)) order by r.month)
        from pay_run_items i join pay_runs r on r.id = i.run_id where i.employee_id = p->>'employee_id' and r.tenant_id = tid and r.status in ('finalized', 'paid', 'locked')
          and r.month between to_char(fys, 'YYYY-MM') and to_char(fye, 'YYYY-MM')), '[]'),
      'tax', (select i.tax from pay_run_items i join pay_runs r on r.id = i.run_id where i.employee_id = p->>'employee_id' and r.tenant_id = tid and r.status in ('finalized', 'paid', 'locked')
          and r.month between to_char(fys, 'YYYY-MM') and to_char(fye, 'YYYY-MM') and i.tax is not null order by r.month desc limit 1), 'numeric_from', 1);
  end if;
  raise exception 'Unknown report %', p_kind;
end $$;

-- ---------- importing the old Payroll (records kinds hr_*) ----------
-- Idempotent and incremental: everything is keyed on the old record ids, and only records changed since the last import
-- are looked at. The old records are left untouched. Called by the migration for every business, by pay_bootstrap for HR
-- users, and before a payroll is calculated (an old cached copy of the app may still be writing hr_* records).
create function pay_import_legacy(tid uuid) returns int language plpgsql security definer set search_path = public as $$
declare
  o pay_org; mark timestamptz; mx timestamptz; r record; d jsonb; n int := 0; tz text; eid text; sid uuid; stid uuid; lt_paid uuid; lt_unpaid uuid; locid uuid;
  joined date; first_import boolean; adv record; rec_left numeric; take numeric; outst numeric; v_run uuid; m text; it_id uuid; gross numeric; dedu numeric; adv_amt numeric;
  e pay_employees; days numeric; v_st text; fl jsonb;
begin
  -- a signed-in caller may only import their own business
  if app_uid() is not null and (me()->>'tenant_id')::uuid is distinct from tid then raise exception 'not allowed'; end if;
  select max(updated_at) into mx from records where tenant_id = tid and kind in ('hr_employee', 'hr_attendance', 'hr_shift', 'hr_holiday', 'hr_leave', 'hr_regularization',
    'hr_advance', 'hr_payslip', 'hr_profile', 'hr_document', 'hr_announcement', 'hr_settings');
  if mx is null then return 0; end if;
  o := pay_org_row(tid);
  mark := nullif(o.settings->>'_legacy_at', '')::timestamptz;
  if mark is not null and mx <= mark then return 0; end if;
  first_import := mark is null;
  perform pay_setup_defaults(tid);
  tz := o.timezone;
  if mark is null then mark := '-infinity'; end if;

  if first_import then
    -- The old Payroll saved its settings under the business settings record's id ('settings'), turning that record into
    -- kind 'hr_settings' (so the POS settings were hidden from every page that looks them up by kind). Put the kind back.
    update records set kind = 'settings' where tenant_id = tid and id = 'settings' and kind = 'hr_settings';
    -- The old app always used these simple rates (it never read its saved ones back); keep them until the owner switches.
    fl := '{"pf":12,"esi":0.75,"pt":200,"tds":0}';
    -- and the old app's way of counting days: only days with a clock-in were paid (no weekly off), and work on a holiday was not overtime.
    -- Settings shows both, so the owner can switch to weekly offs and statutory rules when ready.
    update pay_org set attendance_mode = 'punch', weekly_off = '{}',
      settings = settings || jsonb_build_object('att', coalesce(settings->'att', '{}') || '{"holiday_work":"none"}', '_from_old_payroll', true) where tenant_id = tid;
    if exists (select 1 from records where tenant_id = tid and kind = 'hr_payslip' and not deleted) then
      update pay_org set stat_mode = 'flat', settings = settings || jsonb_build_object('flat', fl) where tenant_id = tid;
    end if;
    update pay_org set display_name = coalesce((select nullif(trim(data->>'companyName'), '') from records where tenant_id = tid and id = 'settings'), display_name) where tenant_id = tid;
    -- the structure that reproduces the old calculation: basic by days worked, house rent and allowances in full
    insert into pay_structures (tenant_id, name, description, basis, lines)
    values (tid, 'Old Payroll', 'Basic paid by days worked, house rent and allowances paid in full (how the old Payroll worked)', 'monthly',
      '[{"code":"BASIC","calc":"fixed","value":0,"prorate":true},{"code":"HRA","calc":"fixed","value":0,"prorate":false},{"code":"ALLOW","calc":"fixed","value":0,"prorate":false}]')
    on conflict (tenant_id, name) do nothing;
  end if;
  select id into stid from pay_structures where tenant_id = tid and name = 'Old Payroll';
  select id into lt_paid from pay_leave_types where tenant_id = tid and code = 'PL';
  select id into lt_unpaid from pay_leave_types where tenant_id = tid and code = 'LOP';

  for r in select * from records where tenant_id = tid and kind = 'hr_shift' and updated_at > mark and not deleted loop
    d := r.data;
    if nullif(d->>'start', '') is null or nullif(d->>'end', '') is null then continue; end if;
    insert into pay_shifts (tenant_id, name, start_time, end_time, overnight, legacy_id)
    values (tid, coalesce(nullif(d->>'name', ''), 'Shift'), (d->>'start')::time, (d->>'end')::time, coalesce((d->>'overnight')::boolean, false) or (d->>'end')::time <= (d->>'start')::time, r.id)
    on conflict (tenant_id, legacy_id) where legacy_id is not null do update set name = excluded.name, start_time = excluded.start_time, end_time = excluded.end_time, overnight = excluded.overnight;
    n := n + 1;
  end loop;
  for r in select * from records where tenant_id = tid and kind = 'hr_holiday' and updated_at > mark and not deleted loop
    begin
      insert into pay_holidays (tenant_id, hdate, name, legacy_id) values (tid, (r.data->>'date')::date, coalesce(nullif(r.data->>'name', ''), 'Holiday'), r.id) on conflict do nothing;
    exception when others then null; end;
  end loop;

  -- people (a removed employee keeps their history as someone who has left)
  for r in select * from records where tenant_id = tid and kind = 'hr_employee' and updated_at > mark order by updated_at loop
    d := r.data;
    if exists (select 1 from pay_employees where id = r.id) then continue; end if;
    joined := coalesce(nullif(d->>'dateJoined', '')::date, r.updated_at::date);
    locid := null;
    if jsonb_typeof(d->'siteLoc') = 'object' and (d->'siteLoc'->>'lat') is not null then
      select id into locid from pay_locations where tenant_id = tid and lat = round((d->'siteLoc'->>'lat')::numeric, 6) and lng = round((d->'siteLoc'->>'lng')::numeric, 6) limit 1;
      if locid is null then
        insert into pay_locations (tenant_id, name, lat, lng, radius_m, state_code)
        values (tid, 'Work site ' || ((select count(*) from pay_locations where tenant_id = tid) + 1), round((d->'siteLoc'->>'lat')::numeric, 6), round((d->'siteLoc'->>'lng')::numeric, 6),
                coalesce(nullif(d->>'siteRadius', '')::int, 200), o.state_code) returning id into locid;
      end if;
    end if;
    insert into pay_employees (id, tenant_id, code, name, phone, status, joined_on, last_day, exit_kind, exit_reason, user_id, attendance_mode, source, notes)
    values (r.id, tid,
      case when nullif(trim(d->>'empId'), '') is not null and not exists (select 1 from pay_employees where tenant_id = tid and lower(code) = lower(trim(d->>'empId'))) then trim(d->>'empId') end,
      coalesce(nullif(trim(d->>'name'), ''), 'Unnamed'), nullif(d->>'phone', ''),
      case when r.deleted or (d->>'active')::boolean is false then 'exited' else 'active' end, joined,
      -- someone removed in the old app left after their last clock-in or payslip (when they were removed is not known)
      case when r.deleted or (d->>'active')::boolean is false then greatest(joined,
        (select max((x.data->>'date')::date) from records x where x.tenant_id = tid and x.kind = 'hr_attendance' and x.data->>'empId' = r.id and x.data->>'date' ~ '^\d{4}-\d{2}-\d{2}$'),
        (select max(pay_month_to(x.data->>'month')) from records x where x.tenant_id = tid and x.kind = 'hr_payslip' and not x.deleted and x.data->>'empId' = r.id and x.data->>'month' ~ '^\d{4}-\d{2}$')) end,
      case when r.deleted or (d->>'active')::boolean is false then 'other' end,
      case when r.deleted then 'Removed in the old Payroll' when (d->>'active')::boolean is false then 'Marked inactive in the old Payroll' end,
      (select p.id from profiles p where p.id = nullif(d->>'authUserId', '')::uuid and p.tenant_id = tid and not exists (select 1 from pay_employees x where x.tenant_id = tid and x.user_id = p.id)),
      'punch', coalesce(nullif(d->>'source', ''), 'legacy'), null)
    on conflict (id) do nothing;
    if not found then continue; end if;
    insert into pay_jobs (tenant_id, employee_id, eff_from, location_id, department, designation, shift_id, reason)
    values (tid, r.id, joined, locid, nullif(d->>'dept', ''), nullif(d->>'designation', ''), (select id from pay_shifts where tenant_id = tid and legacy_id = d->>'shiftId'), 'Imported from the old Payroll');
    insert into pay_emp_events (tenant_id, employee_id, on_date, kind, title) values (tid, r.id, joined, 'joined', 'Joined (moved from the old Payroll)');
    if jsonb_typeof(d->'salaryStructure') = 'object' and coalesce((d->'salaryStructure'->>'basic')::numeric, 0) + coalesce((d->'salaryStructure'->>'hra')::numeric, 0) + coalesce((d->'salaryStructure'->>'allowances')::numeric, 0) > 0 then
      insert into pay_salaries (tenant_id, employee_id, eff_from, structure_id, amount, overrides, ot_rate, reason, note)
      values (tid, r.id, joined, stid,
        coalesce((d->'salaryStructure'->>'basic')::numeric, 0) + coalesce((d->'salaryStructure'->>'hra')::numeric, 0) + coalesce((d->'salaryStructure'->>'allowances')::numeric, 0),
        jsonb_build_object('BASIC', coalesce((d->'salaryStructure'->>'basic')::numeric, 0), 'HRA', coalesce((d->'salaryStructure'->>'hra')::numeric, 0), 'ALLOW', coalesce((d->'salaryStructure'->>'allowances')::numeric, 0)),
        coalesce((d->'salaryStructure'->>'otRate')::numeric, 0), 'joining', 'From the old Payroll')
      returning id into sid;
      update pay_salaries set breakup = pay_salary_breakup(tid, (select s from pay_salaries s where s.id = sid), null) where id = sid;
    end if;
    n := n + 1;
  end loop;

  for r in select * from records where tenant_id = tid and kind = 'hr_profile' and updated_at > mark and not deleted loop
    d := r.data; eid := d->>'empId';
    if not exists (select 1 from pay_employees where id = eid and tenant_id = tid) then continue; end if;
    update pay_employees set emergency_name = coalesce(emergency_name, nullif(d->>'emergencyContact', '')), emergency_phone = coalesce(emergency_phone, nullif(d->>'emergencyPhone', '')) where id = eid;
    if nullif(d->>'bankAccountNo', '') is not null and not exists (select 1 from pay_bank_accounts where employee_id = eid and status = 'active') then
      insert into pay_bank_accounts (tenant_id, employee_id, mode, bank_name, account_no, ifsc, status) values (tid, eid, 'bank', nullif(d->>'bankName', ''),
        regexp_replace(d->>'bankAccountNo', '\s', '', 'g'), upper(nullif(d->>'bankIFSC', '')), 'active');
    end if;
  end loop;

  -- clock-ins become raw punches (one for in, one for out), with ids derived from the old record so a re-import never duplicates
  for r in select * from records where tenant_id = tid and kind = 'hr_attendance' and updated_at > mark and not deleted loop
    d := r.data; eid := d->>'empId';
    if not exists (select 1 from pay_employees where id = eid and tenant_id = tid) then continue; end if;
    begin
      if nullif(d->>'in', '') is not null then
        insert into pay_punches (id, tenant_id, employee_id, at, kind, source, lat, lng, out_of_range, note)
        values (md5(tid::text || r.id || ':in')::uuid, tid, eid, (d->>'in')::timestamptz, 'in', 'legacy', (d->'inLoc'->>'lat')::numeric, (d->'inLoc'->>'lng')::numeric,
                coalesce((d->>'outOfRange')::boolean, false), case when d->>'source' = 'salon' then 'Salon clock-in' end) on conflict (id) do nothing;
      end if;
      if nullif(d->>'out', '') is not null then
        insert into pay_punches (id, tenant_id, employee_id, at, kind, source, lat, lng, note)
        values (md5(tid::text || r.id || ':out')::uuid, tid, eid, (d->>'out')::timestamptz, 'out', 'legacy', (d->'outLoc'->>'lat')::numeric, (d->'outLoc'->>'lng')::numeric, null) on conflict (id) do nothing;
      end if;
      n := n + 1;
    exception when others then null; end;
  end loop;

  for r in select * from records where tenant_id = tid and kind = 'hr_regularization' and updated_at > mark and not deleted loop
    d := r.data; eid := d->>'empId';
    if not exists (select 1 from pay_employees where id = eid and tenant_id = tid) or exists (select 1 from pay_regularizations where tenant_id = tid and legacy_id = r.id) then continue; end if;
    begin
      insert into pay_regularizations (tenant_id, employee_id, att_date, in_at, out_at, reason, status, legacy_id, created_at)
      values (tid, eid, (d->>'date')::date, (nullif(d->>'proposedIn', '')::timestamp) at time zone tz, (nullif(d->>'proposedOut', '')::timestamp) at time zone tz, nullif(d->>'reason', ''),
              case d->>'status' when 'approved' then 'approved' when 'declined' then 'rejected' else 'pending' end, r.id, coalesce(nullif(d->>'at', '')::timestamptz, r.updated_at))
      returning id into sid;
      if d->>'status' = 'approved' and nullif(d->>'proposedIn', '') is not null then
        insert into pay_att_overrides (tenant_id, employee_id, att_date, in_at, out_at, source, reason, request_id)
        values (tid, eid, (d->>'date')::date, (d->>'proposedIn')::timestamp at time zone tz, (nullif(d->>'proposedOut', '')::timestamp) at time zone tz, 'regularization', 'Approved in the old Payroll', sid);
      end if;
    exception when others then null; end;
  end loop;

  -- leave: old approved paid leave had no quota, so it is booked with a matching opening credit (history kept, balance not driven below zero)
  for r in select * from records where tenant_id = tid and kind = 'hr_leave' and updated_at > mark and not deleted loop
    d := r.data; eid := d->>'empId';
    if not exists (select 1 from pay_employees where id = eid and tenant_id = tid) or exists (select 1 from pay_leave_requests where tenant_id = tid and legacy_id = r.id) then continue; end if;
    begin
      v_st := case d->>'status' when 'approved' then 'approved' when 'declined' then 'rejected' else 'pending' end;
      days := pay_leave_days(tid, eid, case when d->>'type' = 'unpaid' then lt_unpaid else lt_paid end, (d->>'from')::date, coalesce(nullif(d->>'to', '')::date, (d->>'from')::date), 'none');
      if days <= 0 then days := 1; end if;
      insert into pay_leave_requests (tenant_id, employee_id, leave_type_id, from_date, to_date, days, reason, status, legacy_id, created_at, decided_at)
      values (tid, eid, case when d->>'type' = 'unpaid' then lt_unpaid else lt_paid end, (d->>'from')::date, coalesce(nullif(d->>'to', '')::date, (d->>'from')::date), days, nullif(d->>'reason', ''),
              v_st, r.id, coalesce(nullif(d->>'at', '')::timestamptz, r.updated_at), case when v_st <> 'pending' then r.updated_at end)
      returning id into sid;
      if v_st = 'approved' then
        if d->>'type' <> 'unpaid' then
          insert into pay_leave_ledger (tenant_id, employee_id, leave_type_id, on_date, kind, days, request_id, note) values (tid, eid, lt_paid, (d->>'from')::date, 'opening', days, sid, 'Leave taken in the old Payroll');
        end if;
        insert into pay_leave_ledger (tenant_id, employee_id, leave_type_id, on_date, kind, days, request_id, note)
        values (tid, eid, case when d->>'type' = 'unpaid' then lt_unpaid else lt_paid end, (d->>'from')::date, 'debit', -days, sid, 'Leave taken in the old Payroll');
      end if;
    exception when others then null; end;
  end loop;

  for r in select * from records where tenant_id = tid and kind = 'hr_advance' and updated_at > mark and not deleted loop
    d := r.data; eid := d->>'empId';
    if not exists (select 1 from pay_employees where id = eid and tenant_id = tid) or exists (select 1 from pay_loans where tenant_id = tid and legacy_id = r.id) then continue; end if;
    if coalesce((d->>'amount')::numeric, 0) <= 0 then continue; end if;
    insert into pay_loans (tenant_id, employee_id, kind, amount, emi, start_month, status, reason, legacy_id, created_at, disbursed_on, disbursed_via)
    values (tid, eid, 'advance', (d->>'amount')::numeric, (d->>'amount')::numeric, pay_month_of(coalesce(nullif(d->>'at', '')::timestamptz, r.updated_at)::date),
            case coalesce(d->>'status', 'approved') when 'requested' then 'requested' when 'declined' then 'rejected' else 'active' end, nullif(d->>'note', ''), r.id,
            coalesce(nullif(d->>'at', '')::timestamptz, r.updated_at), coalesce(nullif(d->>'at', '')::timestamptz, r.updated_at)::date, 'old payroll')
    returning id into sid;
    if coalesce(d->>'status', 'approved') not in ('requested', 'declined') then
      insert into pay_loan_ledger (tenant_id, loan_id, on_date, kind, amount, note) values (tid, sid, coalesce(nullif(d->>'at', '')::timestamptz, r.updated_at)::date, 'disburse', (d->>'amount')::numeric, 'Given (old Payroll)');
    end if;
  end loop;

  -- old payslips become locked history runs (kind 'legacy'), one per month, so YTD tax, bonus and the employee's payslip list keep them
  for m in select distinct rc.data->>'month' from records rc where rc.tenant_id = tid and rc.kind = 'hr_payslip' and rc.updated_at > mark and not rc.deleted and rc.data->>'month' ~ '^\d{4}-\d{2}$' order by 1 loop
    select id into v_run from pay_runs where tenant_id = tid and kind = 'legacy' and month = m;
    if v_run is null then
      insert into pay_runs (tenant_id, number, kind, title, month, period_from, period_to, pay_date, status, note)
      values (tid, 'OLD/' || m, 'legacy', 'Salary ' || to_char(pay_month_from(m), 'Mon YYYY') || ' (old Payroll)', m, pay_month_from(m), pay_month_to(m), pay_month_to(m), 'draft', 'Moved from the old Payroll')
      returning id into v_run;
    elsif (select status from pay_runs where id = v_run) <> 'draft' then
      continue;   -- a month already moved in is history: later edits in an old cached app are ignored
    end if;
    for r in select * from records x where x.tenant_id = tid and x.kind = 'hr_payslip' and not x.deleted and x.data->>'month' = m loop
      d := r.data; eid := d->>'empId';
      select * into e from pay_employees where id = eid and tenant_id = tid;
      if e.id is null or exists (select 1 from pay_run_items where run_id = v_run and employee_id = eid) then continue; end if;
      gross := coalesce((d->>'basicPaid')::numeric, 0) + coalesce((d->>'hra')::numeric, 0) + coalesce((d->>'allowances')::numeric, 0) + coalesce((d->>'otPay')::numeric, 0);
      adv_amt := coalesce((d->>'advanceDeduction')::numeric, 0);
      dedu := coalesce((d->>'pf')::numeric, 0) + coalesce((d->>'esic')::numeric, 0) + coalesce((d->>'pt')::numeric, 0) + coalesce((d->>'tds')::numeric, 0) + adv_amt;
      if dedu > gross then adv_amt := greatest(0, adv_amt - (dedu - gross)); dedu := dedu - (coalesce((d->>'advanceDeduction')::numeric, 0) - adv_amt); end if;
      if dedu > gross then continue; end if;
      insert into pay_run_items (tenant_id, run_id, employee_id, status, snap, att, gross, deductions, net, employer, taxable)
      values (tid, v_run, eid, 'ok', jsonb_build_object('name', e.name, 'code', e.code, 'department', (pay_job_at(eid, pay_month_to(m))).department, 'designation', (pay_job_at(eid, pay_month_to(m))).designation, 'legacy', true),
              jsonb_build_object('present', (d->>'present')::numeric, 'absent', (d->>'absent')::numeric, 'half', (d->>'half')::numeric, 'leave_paid', (d->>'leave')::numeric,
                'holidays', (d->>'holiday')::numeric, 'ot_hours', (d->>'ot')::numeric, 'paid_days', coalesce((d->>'present')::numeric, 0) + 0.5 * coalesce((d->>'half')::numeric, 0) + coalesce((d->>'leave')::numeric, 0) + coalesce((d->>'holiday')::numeric, 0)),
              gross, dedu, gross - dedu, 0, gross)
      returning id into it_id;
      insert into pay_run_lines (tenant_id, run_id, item_id, employee_id, code, name, kind, amount, source, taxable, pf, esi, pt, is_basic, sort)
      select tid, v_run, it_id, eid, x.code, x.name, x.kind, x.amt, 'legacy', x.kind = 'earning', x.code = 'BASIC', x.kind = 'earning', x.kind = 'earning', x.code = 'BASIC', x.sort
      from (values ('BASIC', 'Basic', 'earning', coalesce((d->>'basicPaid')::numeric, 0), 10), ('HRA', 'House rent allowance', 'earning', coalesce((d->>'hra')::numeric, 0), 20),
                   ('ALLOW', 'Other allowances', 'earning', coalesce((d->>'allowances')::numeric, 0), 45), ('OT', 'Overtime', 'earning', coalesce((d->>'otPay')::numeric, 0), 50),
                   ('PF_EE', 'Provident fund', 'deduction', coalesce((d->>'pf')::numeric, 0), 110), ('ESI_EE', 'ESI', 'deduction', coalesce((d->>'esic')::numeric, 0), 120),
                   ('PT', 'Professional tax', 'deduction', coalesce((d->>'pt')::numeric, 0), 130), ('TDS', 'Income tax (TDS)', 'deduction', coalesce((d->>'tds')::numeric, 0), 140),
                   ('LOAN', 'Advance recovery', 'deduction', adv_amt, 160)) x(code, name, kind, amt, sort)
      where x.amt > 0;
      -- recoveries the old Payroll made, booked against that person's advances oldest first
      rec_left := adv_amt;
      for adv in select l.id from pay_loans l where l.employee_id = eid and l.status in ('active', 'closed') order by l.created_at loop
        exit when rec_left <= 0;
        select coalesce(sum(amount), 0) into outst from pay_loan_ledger where loan_id = adv.id;
        take := least(outst, rec_left);
        if take > 0 then
          insert into pay_loan_ledger (tenant_id, loan_id, on_date, kind, amount, run_id, item_id, note) values (tid, adv.id, pay_month_to(m), 'recover', -take, v_run, it_id, 'Recovered in the old Payroll (' || m || ')');
          rec_left := rec_left - take;
          if outst - take = 0 then update pay_loans set status = 'closed' where id = adv.id; end if;
        end if;
      end loop;
      n := n + 1;
    end loop;
    perform pay_run_totals(v_run);
    update pay_runs set status = 'locked', finalized_at = now() where id = v_run;
  end loop;

  for r in select * from records where tenant_id = tid and kind = 'hr_document' and updated_at > mark and not deleted loop
    d := r.data;
    if not exists (select 1 from pay_employees where id = d->>'empId' and tenant_id = tid) or exists (select 1 from pay_documents where tenant_id = tid and legacy_id = r.id) or nullif(d->>'path', '') is null then continue; end if;
    insert into pay_documents (tenant_id, employee_id, doc_type, name, path, content_type, legacy_id, created_at)
    values (tid, d->>'empId', coalesce(nullif(d->>'docType', ''), 'Other'), nullif(d->>'docType', ''), d->>'path', nullif(d->>'contentType', ''), r.id, coalesce(nullif(d->>'uploadedAt', '')::timestamptz, r.updated_at));
  end loop;
  for r in select * from records where tenant_id = tid and kind = 'hr_announcement' and updated_at > mark and not deleted loop
    if exists (select 1 from pay_announcements where tenant_id = tid and legacy_id = r.id) then continue; end if;
    insert into pay_announcements (tenant_id, title, body, legacy_id, created_at) values (tid, coalesce(nullif(r.data->>'title', ''), 'Announcement'), r.data->>'body', r.id, coalesce(nullif(r.data->>'at', '')::timestamptz, r.updated_at));
  end loop;

  update pay_org set settings = settings || jsonb_build_object('_legacy_at', mx) where tenant_id = tid;
  -- refresh recent attendance for the people that came across
  for r in select id, joined_on from pay_employees where tenant_id = tid and status in ('active', 'notice') and source is distinct from 'demo' loop
    perform pay_att_refresh(tid, r.id, greatest(r.joined_on, pay_today(tid) - 45), pay_today(tid));
  end loop;
  return n;
end $$;

-- ---------- salon console hooks (db/054 signatures, now on the new tables) ----------
create or replace function salon_hr_list(p_tenant uuid) returns jsonb
  language sql security definer stable set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name, 'designation', (pay_job_at(e.id, current_date)).designation,
           'phone', e.phone, 'active', e.status in ('active', 'notice', 'onboarding')) order by e.name), '[]'::jsonb)
  from pay_employees e
  where e.tenant_id = p_tenant and exists (select 1 from tenants t where t.id = p_tenant and t.niche = 'salon')
$$;

create or replace function salon_hr_ensure(p_tenant uuid, p_name text, p_phone text, p_designation text) returns text
  language plpgsql security definer set search_path = public as $$
declare eid text; td date;
begin
  if not exists (select 1 from tenants t where t.id = p_tenant and t.niche = 'salon') then raise exception 'unknown salon'; end if;
  perform pay_import_legacy(p_tenant);
  select e.id into eid from pay_employees e where e.tenant_id = p_tenant and coalesce(p_phone, '') <> '' and e.phone = p_phone order by (e.status = 'exited'), e.created_at limit 1;
  if eid is not null then return eid; end if;
  perform pay_setup_defaults(p_tenant);
  eid := gen_random_uuid()::text; td := pay_today(p_tenant);
  insert into pay_employees (id, tenant_id, name, phone, status, joined_on, attendance_mode, source)
  values (eid, p_tenant, coalesce(nullif(trim(p_name), ''), 'Staff'), nullif(p_phone, ''), 'active', td, 'punch', 'salon');
  insert into pay_jobs (tenant_id, employee_id, eff_from, department, designation, reason) values (p_tenant, eid, td, 'Salon', coalesce(nullif(p_designation, ''), 'Stylist'), 'Salon staff login');
  insert into pay_emp_events (tenant_id, employee_id, on_date, kind, title) values (p_tenant, eid, td, 'joined', 'Added from the salon console');
  return eid;
end $$;

create or replace function salon_punch_state(p_tenant uuid, p_emp text, p_date text) returns jsonb
  language plpgsql security definer stable set search_path = public as $$
declare st jsonb;
begin
  if not exists (select 1 from pay_employees e join tenants t on t.id = e.tenant_id where e.tenant_id = p_tenant and e.id = p_emp and t.niche = 'salon') then return null; end if;
  st := pay_punch_state(p_tenant, p_emp);
  return jsonb_build_object('open', (st->>'open')::boolean, 'in', st->>'in', 'recent', coalesce((select jsonb_agg(jsonb_build_object('date', a.att_date, 'in', a.first_in, 'out', a.last_out) order by a.att_date desc)
    from (select * from pay_attendance where employee_id = p_emp and first_in is not null order by att_date desc limit 7) a), '[]'));
end $$;

create or replace function salon_punch(p_tenant uuid, p_emp text, p_date text, p_now text) returns jsonb
  language plpgsql security definer set search_path = public as $$
declare st jsonb; k text; d date;
begin
  if not exists (select 1 from pay_employees e join tenants t on t.id = e.tenant_id where e.tenant_id = p_tenant and e.id = p_emp and e.status in ('active', 'notice') and t.niche = 'salon') then
    raise exception 'unknown employee';
  end if;
  st := pay_punch_state(p_tenant, p_emp);
  k := case when (st->>'open')::boolean then 'out' else 'in' end;
  insert into pay_punches (tenant_id, employee_id, at, kind, source) values (p_tenant, p_emp, coalesce(nullif(p_now, '')::timestamptz, now()), k, 'salon');
  d := pay_today(p_tenant);
  perform pay_att_refresh(p_tenant, p_emp, d - 1, d);
  return jsonb_build_object('status', k, 'at', p_now);
end $$;

-- ---------- POS clock-ins (records kind 'shift': {u: user id, in, out}) flow into attendance ----------
-- Only for a POS user linked to an employee. Never blocks the POS: any problem here is skipped.
create function pay_pos_shift_mirror() returns trigger language plpgsql security definer set search_path = public as $$
declare emp text; d date;
begin
  begin
    if new.deleted or nullif(new.data->>'u', '') is null then return null; end if;
    select id into emp from pay_employees where tenant_id = new.tenant_id and user_id = (new.data->>'u')::uuid and status in ('active', 'notice');
    if emp is null then return null; end if;
    if nullif(new.data->>'in', '') is not null then
      insert into pay_punches (id, tenant_id, employee_id, at, kind, source, note) values (md5(new.tenant_id::text || new.id || ':in')::uuid, new.tenant_id, emp, (new.data->>'in')::timestamptz, 'in', 'pos', 'POS clock-in')
      on conflict (id) do nothing;
      d := ((new.data->>'in')::timestamptz at time zone pay_tz(new.tenant_id))::date;
    end if;
    if nullif(new.data->>'out', '') is not null then
      insert into pay_punches (id, tenant_id, employee_id, at, kind, source, note) values (md5(new.tenant_id::text || new.id || ':out')::uuid, new.tenant_id, emp, (new.data->>'out')::timestamptz, 'out', 'pos', 'POS clock-out')
      on conflict (id) do nothing;
      d := ((new.data->>'out')::timestamptz at time zone pay_tz(new.tenant_id))::date;
    end if;
    if d is not null then perform pay_att_refresh(new.tenant_id, emp, d - 1, least(d, pay_today(new.tenant_id))); end if;
  exception when others then null;
  end;
  return null;
end $$;
create trigger records_pay_pos_shift after insert or update on records for each row when (new.kind = 'shift') execute function pay_pos_shift_mirror();

-- ---------- the public demo ----------
-- Rebuilt every 12 hours on the next visit by someone who can run payroll: a small team, six weeks of clock-ins,
-- leave, a correction, an advance, a claim and last month's payroll finalised and paid. Sample people, not real ones.
create function pay_reset_demo(tid uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from tenants where id = tid and is_demo) then raise exception 'Only a demo business can be reset'; end if;
  perform set_config('pay.reset', '1', true);
  delete from pay_batch_lines where tenant_id = tid; delete from pay_batches where tenant_id = tid;
  delete from pay_run_lines where tenant_id = tid; delete from pay_run_items where tenant_id = tid; delete from pay_run_inputs where tenant_id = tid;
  delete from pay_arrears_settled where tenant_id = tid;
  delete from pay_claims where tenant_id = tid; delete from pay_loan_ledger where tenant_id = tid; delete from pay_loans where tenant_id = tid;
  delete from pay_journal_lines where tenant_id = tid; delete from pay_journals where tenant_id = tid; delete from pay_stat_payments where tenant_id = tid;
  update pay_employees set fnf_run_id = null where tenant_id = tid;
  delete from pay_runs where tenant_id = tid;
  delete from pay_leave_ledger where tenant_id = tid; delete from pay_leave_requests where tenant_id = tid;
  delete from pay_regularizations where tenant_id = tid; delete from pay_att_overrides where tenant_id = tid; delete from pay_punches where tenant_id = tid;
  delete from pay_attendance where tenant_id = tid; delete from pay_roster where tenant_id = tid; delete from pay_tax_decl where tenant_id = tid;
  delete from pay_assets where tenant_id = tid; delete from pay_announcements where tenant_id = tid; delete from pay_emp_events where tenant_id = tid;
  delete from pay_salaries where tenant_id = tid; delete from pay_bank_accounts where tenant_id = tid; delete from pay_jobs where tenant_id = tid;
  delete from pay_employees where tenant_id = tid and source = 'demo';
  delete from pay_audit where tenant_id = tid; delete from pay_pin_fails where tenant_id = tid;
  perform set_config('pay.reset', '0', true);
end $$;

create function pay_demo_seed(tid uuid) returns void language plpgsql security definer set search_path = public as $$
declare t tenants; td date; lm text; loc uuid; sh uuid; e record; d date; h int; ins timestamptz; outs timestamptz; tz text; rid uuid; ppl jsonb; st uuid;
  pl uuid; sl uuid; k int := 0; x record; reg text; stylist text;
begin
  select * into t from tenants where id = tid;
  perform pay_setup_defaults(tid);
  td := pay_today(tid); tz := pay_tz(tid); lm := pay_month_add(pay_month_of(td), -1);
  update pay_org set legal_name = t.name, display_name = t.name, state_code = '08', city = 'Jodhpur', setup_done = true, stat_mode = 'rules', attendance_mode = 'punch',
    pf_code = 'RJJOD0012345000', esi_code = '15000123450000999',
    settings = settings || '{"pf":{"enabled":true},"esi":{"enabled":true},"pt":{"enabled":true},"tds":{"enabled":true},"att":{"geofence":"off"}}'::jsonb
  where tenant_id = tid;
  select id into loc from pay_locations where tenant_id = tid and name = 'Main branch';
  if loc is null then insert into pay_locations (tenant_id, name, state_code, address) values (tid, 'Main branch', '08', 'Sardarpura, Jodhpur') returning id into loc; end if;
  select id into sh from pay_shifts where tenant_id = tid and name = 'Day';
  if sh is null then insert into pay_shifts (tenant_id, name, start_time, end_time, break_mins) values (tid, 'Day', '10:00', '19:00', 60) returning id into sh; end if;
  select id into st from pay_structures where tenant_id = tid and is_default limit 1;
  select id into pl from pay_leave_types where tenant_id = tid and code = 'PL';
  select id into sl from pay_leave_types where tenant_id = tid and code = 'SL';
  ppl := '[{"id":"demo-pay-1","name":"Kavita Rao","code":"E001","designation":"Manager","dept":"Front desk","pay":42000,"g":"female","pan":"ABCPR1234K","uan":"101234567890","joined":-900},
           {"id":"demo-pay-2","name":"Rahul Verma","code":"E002","designation":"Senior stylist","dept":"Hair","pay":28000,"g":"male","uan":"101234567891","joined":-620},
           {"id":"demo-pay-3","name":"Neha Joshi","code":"E003","designation":"Stylist","dept":"Hair","pay":18000,"g":"female","joined":-300},
           {"id":"demo-pay-4","name":"Arjun Singh","code":"E004","designation":"Receptionist","dept":"Front desk","pay":14000,"g":"male","joined":-200},
           {"id":"demo-pay-5","name":"Imran Khan","code":"E005","designation":"Helper","dept":"Hair","pay":11000,"g":"male","joined":-40}]';
  for x in select * from jsonb_array_elements(ppl) loop
    insert into pay_employees (id, tenant_id, code, name, phone, gender, status, joined_on, dob, pan, uan, attendance_mode, source)
    values (x.value->>'id', tid, x.value->>'code', x.value->>'name', '90000000' || lpad((10 + k)::text, 2, '0'), x.value->>'g', 'active', td + (x.value->>'joined')::int,
            make_date(1990 + k * 2, 1 + (k * 3) % 12, 5 + k * 4), x.value->>'pan', x.value->>'uan', 'punch', 'demo')
    on conflict (id) do update set status = 'active', joined_on = excluded.joined_on, last_day = null;
    insert into pay_jobs (tenant_id, employee_id, eff_from, location_id, department, designation, shift_id, manager_id, reason)
    values (tid, x.value->>'id', td + (x.value->>'joined')::int, loc, x.value->>'dept', x.value->>'designation', sh, case when x.value->>'id' <> 'demo-pay-1' then 'demo-pay-1' end, 'joining')
    on conflict do nothing;
    insert into pay_salaries (tenant_id, employee_id, eff_from, structure_id, amount, ot_rate, reason)
    values (tid, x.value->>'id', td + (x.value->>'joined')::int, st, (x.value->>'pay')::numeric, round((x.value->>'pay')::numeric / 26 / 8 * 2), 'joining') on conflict do nothing;
    update pay_salaries set breakup = pay_salary_breakup(tid, s, null) from pay_salaries s where pay_salaries.id = s.id and s.employee_id = x.value->>'id';
    if k < 3 then
      insert into pay_bank_accounts (tenant_id, employee_id, mode, holder, bank_name, account_no, ifsc, status)
      values (tid, x.value->>'id', 'bank', x.value->>'name', 'State Bank of India', '3' || lpad((7812345 + k)::text, 10, '0'), 'SBIN0001234', 'active');
    end if;
    k := k + 1;
  end loop;
  -- the salon's demo staff login (Priya) is a payroll employee too
  if t.niche = 'salon' then
    stylist := salon_hr_ensure(tid, 'Priya', '9000000001', 'Senior hair stylist');
    update pay_employees set joined_on = least(joined_on, td - 400), gender = 'female', status = 'active', last_day = null where id = stylist;
    update pay_jobs set eff_from = td - 400, location_id = loc, shift_id = sh, manager_id = 'demo-pay-1' where employee_id = stylist;
    insert into pay_salaries (tenant_id, employee_id, eff_from, structure_id, amount, ot_rate, reason) values (tid, stylist, td - 400, st, 24000, 180, 'joining') on conflict do nothing;
    update pay_salaries set breakup = pay_salary_breakup(tid, s, null) from pay_salaries s where pay_salaries.id = s.id and s.employee_id = stylist;
  end if;
  perform pay_leave_accrue(tid);
  -- six weeks of clock-ins: mostly on time, a few late, an absence, a half day, Sundays off
  for e in select id, joined_on from pay_employees where tenant_id = tid and status = 'active' loop
    d := greatest(e.joined_on, td - 45);
    while d < td loop
      if extract(dow from d) <> 0 then
        h := abs(hashtext(e.id || d::text)) % 100;
        if h >= 3 then
          ins := (d::timestamp + time '09:52' + make_interval(mins => case when h < 12 then 25 + h else h % 9 end)) at time zone tz;
          outs := case when h between 3 and 5 then ins + interval '4 hours 10 minutes' else (d::timestamp + time '19:00' + make_interval(mins => h % 40)) at time zone tz end;
          insert into pay_punches (tenant_id, employee_id, at, kind, source) values (tid, e.id, ins, 'in', 'demo'), (tid, e.id, outs, 'out', 'demo');
        end if;
      end if;
      d := d + 1;
    end loop;
  end loop;
  -- today: most people are in
  for e in select id from pay_employees where tenant_id = tid and status = 'active' and id <> 'demo-pay-4' loop
    if now() > ((td::timestamp + time '10:05') at time zone tz) then
      insert into pay_punches (tenant_id, employee_id, at, kind, source) values (tid, e.id, (td::timestamp + time '09:55' + make_interval(mins => abs(hashtext(e.id)) % 20)) at time zone tz, 'in', 'demo');
    end if;
  end loop;
  -- leave: approved last month, one waiting
  insert into pay_leave_requests (tenant_id, employee_id, leave_type_id, from_date, to_date, days, reason, status, decided_at)
  values (tid, 'demo-pay-3', pl, pay_month_from(lm) + 9, pay_month_from(lm) + 10, 2, 'Family function', 'approved', now()) returning id into rid;
  insert into pay_leave_ledger (tenant_id, employee_id, leave_type_id, on_date, kind, days, request_id, note) values (tid, 'demo-pay-3', pl, pay_month_from(lm) + 9, 'opening', 2, rid, 'Sample balance'),
    (tid, 'demo-pay-3', pl, pay_month_from(lm) + 9, 'debit', -2, rid, 'Leave');
  insert into pay_leave_requests (tenant_id, employee_id, leave_type_id, from_date, to_date, days, reason, status)
  values (tid, 'demo-pay-2', sl, td + 3, td + 3, 1, 'Doctor''s appointment', 'pending');
  select id into reg from pay_employees where id = 'demo-pay-4';
  insert into pay_regularizations (tenant_id, employee_id, att_date, in_at, out_at, reason)
  values (tid, 'demo-pay-4', td - 2, ((td - 2)::timestamp + time '10:00') at time zone tz, ((td - 2)::timestamp + time '19:05') at time zone tz, 'Forgot to clock in, phone was charging');
  -- an advance being recovered, a claim waiting
  insert into pay_loans (tenant_id, employee_id, kind, amount, emi, start_month, status, reason, disbursed_on, disbursed_via, decided_at)
  values (tid, 'demo-pay-4', 'advance', 5000, 1000, lm, 'active', 'Rent deposit', pay_month_from(lm) + 2, 'cash', now()) returning id into rid;
  insert into pay_loan_ledger (tenant_id, loan_id, on_date, kind, amount, note) values (tid, rid, pay_month_from(lm) + 2, 'disburse', 5000, 'Given');
  insert into pay_claims (tenant_id, employee_id, claim_date, category, amount, description) values (tid, 'demo-pay-2', td - 4, 'Travel', 450, 'Auto fare to the supplier for colour stock');
  insert into pay_announcements (tenant_id, title, body) values (tid, 'Team meeting on Monday', 'A short meeting at 9:30 before opening. New service menu and the festive rota.');
  -- last month's payroll, finalised and paid in cash
  rid := pay_run_create(jsonb_build_object('kind', 'regular', 'month', lm));
  perform pay_run_calculate(rid);
  perform pay_run_approve(rid, 'Checked');
  perform pay_run_finalize(rid);
  perform pay_batch_create(rid, jsonb_build_object('mode', 'cash', 'mark_paid', true, 'paid_on', least(td, pay_month_to(lm) + 1)::text, 'ref', 'Cash'));
  update pay_org set settings = settings || jsonb_build_object('_demo_at', now()) where tenant_id = tid;
end $$;

create function pay_demo_check(tid uuid) returns void language plpgsql security definer set search_path = public as $$
declare at_ timestamptz;
begin
  if not exists (select 1 from tenants where id = tid and is_demo) or not pay_perm('pay_run') then return; end if;
  select nullif(settings->>'_demo_at', '')::timestamptz into at_ from pay_org where tenant_id = tid;
  if at_ is not null and at_ > now() - interval '12 hours' then return; end if;
  perform pay_reset_demo(tid);
  perform pay_demo_seed(tid);
end $$;

-- ---------- move every business's old Payroll data across now ----------
do $$
declare t record;
begin
  for t in select distinct tenant_id from records where kind in ('hr_employee', 'hr_payslip', 'hr_attendance') loop
    perform pay_import_legacy(t.tenant_id);
  end loop;
end $$;
