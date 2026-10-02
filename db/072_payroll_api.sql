-- =========================================================
-- AUZslab Payroll v2: the API the Payroll app calls (registered in server/src/index.js RPC). Every function starts with
-- pay_guard(permission) or pay_tenant(); salary, bank, PAN, UAN, ESI and tax details are only returned to roles with
-- pay_salary (field-level security), and line managers see their own team's time and leave, never pay.
-- Employee self-service (pay_me_*), the shared-device kiosk, the import of the old Payroll, the salon and POS hooks and
-- the demo are in db/073.
-- =========================================================

-- may see pay amounts: pay_salary, or any role that runs, approves or pays payroll
create function pay_guard_pay() returns uuid language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := pay_tenant();
  if not (pay_perm('pay_salary') or pay_perm('pay_run') or pay_perm('pay_approve') or pay_perm('pay_pay')) then
    raise exception 'Your role does not include salaries' using errcode = '42501';
  end if;
  return tid;
end $$;

-- ---------- validation helpers ----------
create function pay_clean(s text, maxlen int default 200) returns text language sql immutable as $$
  select nullif(left(btrim(regexp_replace(coalesce(s, ''), '[\r\n\t]+', ' ', 'g')), maxlen), '')
$$;
create function pay_check_ids(p jsonb) returns void language plpgsql immutable as $$
begin
  if nullif(p->>'pan', '') is not null and upper(p->>'pan') !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' then raise exception 'PAN should look like ABCDE1234F'; end if;
  if nullif(p->>'uan', '') is not null and p->>'uan' !~ '^\d{12}$' then raise exception 'UAN is 12 digits'; end if;
  if nullif(p->>'esi_no', '') is not null and p->>'esi_no' !~ '^\d{10,17}$' then raise exception 'ESI number is 10 to 17 digits'; end if;
  if nullif(p->>'aadhaar_last4', '') is not null and p->>'aadhaar_last4' !~ '^\d{4}$' then raise exception 'Enter only the last 4 digits of Aadhaar'; end if;
  if nullif(p->>'email', '') is not null and p->>'email' !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'That email address does not look right'; end if;
  if nullif(p->>'phone', '') is not null and regexp_replace(p->>'phone', '[\s+()-]', '', 'g') !~ '^\d{6,15}$' then raise exception 'That phone number does not look right'; end if;
end $$;
create function pay_check_bank(p jsonb) returns void language plpgsql immutable as $$
begin
  if coalesce(p->>'mode', 'bank') = 'bank' then
    if nullif(p->>'account_no', '') is null then raise exception 'Enter the bank account number'; end if;
    if regexp_replace(p->>'account_no', '\s', '', 'g') !~ '^\d{6,18}$' then raise exception 'Account number is 6 to 18 digits'; end if;
    if upper(coalesce(p->>'ifsc', '')) !~ '^[A-Z]{4}0[A-Z0-9]{6}$' then raise exception 'IFSC should look like HDFC0001234'; end if;
  elsif p->>'mode' = 'upi' then
    if coalesce(p->>'upi', '') !~ '^[A-Za-z0-9._-]{2,64}@[A-Za-z]{2,64}$' then raise exception 'UPI ID should look like name@bank'; end if;
  end if;
end $$;

-- ---------- context for the app ----------
create function pay_bootstrap() returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; o pay_org; t tenants; perms jsonb; hr boolean; my text; f jsonb; en jsonb; acc boolean; res jsonb; td date;
begin
  tid := pay_tenant();
  select * into t from tenants where id = tid;
  perms := pay_perms();
  hr := (perms->>'pay_view')::boolean;
  my := pay_my_emp();
  if not hr and my is null then
    return jsonb_build_object('tenant', jsonb_build_object('id', t.id, 'name', t.name, 'slug', t.slug, 'is_demo', t.is_demo), 'perms', perms, 'no_access', true);
  end if;
  if t.is_demo then perform pay_demo_check(tid); end if;
  if hr then perform pay_setup_defaults(tid); perform pay_import_legacy(tid); end if;
  o := pay_org_row(tid); td := pay_today(tid);
  update pay_employees set status = 'exited', updated_at = now() where tenant_id = tid and status = 'notice' and last_day < td;
  if coalesce(o.settings->>'_accrued_on', '') <> td::text then
    perform pay_leave_accrue(tid);
    update pay_org set settings = settings || jsonb_build_object('_accrued_on', td::text) where tenant_id = tid returning * into o;
  end if;
  select features, enabled_features into f, en from tenant_settings where tenant_id = tid;
  acc := coalesce(f->>'accounting', 'false') = 'true' and coalesce(en->>'accounting', 'true') <> 'false' and exists (select 1 from acc_org where tenant_id = tid);
  res := jsonb_build_object(
    'tenant', jsonb_build_object('id', t.id, 'name', t.name, 'slug', t.slug, 'niche', t.niche, 'is_demo', t.is_demo),
    'org', to_jsonb(o) - 'tenant_id', 'perms', perms, 'hr', hr, 'today', td,
    'me', (select jsonb_build_object('id', id, 'name', name, 'code', code, 'status', status) from pay_employees where id = my),
    'is_manager', my is not null and exists (select 1 from pay_jobs j join pay_employees x on x.id = j.employee_id where j.tenant_id = tid and j.manager_id = my and x.status in ('active', 'notice')),
    'features', jsonb_build_object('accounting', acc, 'pos', coalesce(f->>'pos', 'false') = 'true' and coalesce(en->>'pos', 'true') <> 'false'),
    'locations', (select coalesce(jsonb_agg(to_jsonb(l) - 'tenant_id' order by l.name), '[]') from pay_locations l where l.tenant_id = tid),
    'masters', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'name', m.name, 'active', m.active) order by m.kind, m.name), '[]') from pay_masters m where m.tenant_id = tid),
    'shifts', (select coalesce(jsonb_agg(to_jsonb(s) - 'tenant_id' || jsonb_build_object('mins', pay_shift_mins(s)) order by s.start_time), '[]') from pay_shifts s where s.tenant_id = tid),
    'leave_types', (select coalesce(jsonb_agg(to_jsonb(lt) - 'tenant_id' order by lt.sort, lt.name), '[]') from pay_leave_types lt where lt.tenant_id = tid),
    'holidays', (select coalesce(jsonb_agg(jsonb_build_object('id', h.id, 'date', h.hdate, 'name', h.name, 'location_id', h.location_id) order by h.hdate), '[]')
                 from pay_holidays h where h.tenant_id = tid and h.hdate >= td - 400),
    'legacy', exists (select 1 from pay_runs where tenant_id = tid and kind = 'legacy'),
    'employees', (select count(*) from pay_employees where tenant_id = tid and status in ('onboarding', 'active', 'notice')));
  if hr and (pay_perm('pay_salary') or pay_perm('pay_admin') or pay_perm('pay_run')) then
    res := res || jsonb_build_object(
      'components', (select coalesce(jsonb_agg(to_jsonb(c) - 'tenant_id' order by c.sort, c.code), '[]') from pay_components c where c.tenant_id = tid),
      'structures', (select coalesce(jsonb_agg(to_jsonb(s) - 'tenant_id' order by s.is_default desc, s.name), '[]') from pay_structures s where s.tenant_id = tid));
  end if;
  if acc and pay_perm('pay_pay') then
    res := res || jsonb_build_object('pay_accounts', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'cash', a.is_cash) order by a.is_cash, a.code), '[]')
      from acc_accounts a where a.tenant_id = tid and a.active and (a.is_bank or a.is_cash)));
  end if;
  return res;
end $$;

-- ---------- organisation and settings ----------
-- p: any of the pay_org columns below plus settings (merged one level deep: {pf:{...}} merges into settings.pf)
create function pay_save_org(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; o pay_org; s jsonb; k text; old jsonb;
begin
  tid := pay_guard('pay_admin');
  o := pay_org_row(tid); old := to_jsonb(o);
  s := o.settings;
  if p ? 'settings' then
    for k in select jsonb_object_keys(p->'settings') loop
      if k like '\_%' then continue; end if;
      if jsonb_typeof(p->'settings'->k) = 'object' and jsonb_typeof(s->k) = 'object' then s := s || jsonb_build_object(k, (s->k) || (p->'settings'->k));
      else s := s || jsonb_build_object(k, p->'settings'->k); end if;
    end loop;
  end if;
  if p ? 'pan' and nullif(p->>'pan', '') is not null and upper(p->>'pan') !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' then raise exception 'PAN should look like ABCDE1234F'; end if;
  if p ? 'tan' and nullif(p->>'tan', '') is not null and upper(p->>'tan') !~ '^[A-Z]{4}[0-9]{5}[A-Z]$' then raise exception 'TAN should look like ABCD12345E'; end if;
  if p ? 'weekly_off' and exists (select 1 from jsonb_array_elements_text(p->'weekly_off') x where x !~ '^[0-6]$') then raise exception 'Weekly off days are 0 (Sunday) to 6 (Saturday)'; end if;
  if p ? 'timezone' and not exists (select 1 from pg_timezone_names where name = p->>'timezone') then raise exception 'Unknown time zone'; end if;
  update pay_org set
    legal_name = case when p ? 'legal_name' then pay_clean(p->>'legal_name') else legal_name end,
    display_name = case when p ? 'display_name' then pay_clean(p->>'display_name') else display_name end,
    pan = case when p ? 'pan' then upper(pay_clean(p->>'pan', 10)) else pan end,
    tan = case when p ? 'tan' then upper(pay_clean(p->>'tan', 10)) else tan end,
    pf_code = case when p ? 'pf_code' then pay_clean(p->>'pf_code', 40) else pf_code end,
    esi_code = case when p ? 'esi_code' then pay_clean(p->>'esi_code', 40) else esi_code end,
    pt_reg = case when p ? 'pt_reg' then pay_clean(p->>'pt_reg', 40) else pt_reg end,
    lwf_reg = case when p ? 'lwf_reg' then pay_clean(p->>'lwf_reg', 40) else lwf_reg end,
    address = case when p ? 'address' then pay_clean(p->>'address', 400) else address end,
    city = case when p ? 'city' then pay_clean(p->>'city', 80) else city end,
    state_code = case when p ? 'state_code' then nullif(p->>'state_code', '') else state_code end,
    pincode = case when p ? 'pincode' then pay_clean(p->>'pincode', 10) else pincode end,
    phone = case when p ? 'phone' then pay_clean(p->>'phone', 20) else phone end,
    email = case when p ? 'email' then pay_clean(p->>'email', 120) else email end,
    timezone = case when p ? 'timezone' then p->>'timezone' else timezone end,
    fy_start_month = case when p ? 'fy_start_month' then (p->>'fy_start_month')::int else fy_start_month end,
    leave_year_start = case when p ? 'leave_year_start' then (p->>'leave_year_start')::int else leave_year_start end,
    pay_day = case when p ? 'pay_day' then (p->>'pay_day')::int else pay_day end,
    proration = case when p ? 'proration' then p->>'proration' else proration end,
    weekly_off = case when p ? 'weekly_off' then array(select x::int from jsonb_array_elements_text(p->'weekly_off') x) else weekly_off end,
    attendance_mode = case when p ? 'attendance_mode' then p->>'attendance_mode' else attendance_mode end,
    stat_mode = case when p ? 'stat_mode' then p->>'stat_mode' else stat_mode end,
    setup_done = case when p ? 'setup_done' then (p->>'setup_done')::boolean else setup_done end,
    settings = s, updated_at = now()
  where tenant_id = tid returning * into o;
  perform pay_audit_log(tid, 'update', 'org', tid::text, null, old - 'settings' || jsonb_build_object('settings', old->'settings'), to_jsonb(o), null);
  return to_jsonb(o) - 'tenant_id';
end $$;

create function pay_save_location(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid; lid uuid := nullif(p->>'id', '')::uuid;
begin
  tid := pay_guard('pay_admin');
  if pay_clean(p->>'name', 80) is null then raise exception 'Name the location'; end if;
  if lid is null then
    insert into pay_locations (tenant_id, name, state_code, address, lat, lng, radius_m, active)
    values (tid, pay_clean(p->>'name', 80), nullif(p->>'state_code', ''), pay_clean(p->>'address', 300), nullif(p->>'lat', '')::numeric, nullif(p->>'lng', '')::numeric,
            nullif(p->>'radius_m', '')::int, coalesce((p->>'active')::boolean, true)) returning id into lid;
  else
    update pay_locations set name = pay_clean(p->>'name', 80), state_code = nullif(p->>'state_code', ''), address = pay_clean(p->>'address', 300),
      lat = nullif(p->>'lat', '')::numeric, lng = nullif(p->>'lng', '')::numeric, radius_m = nullif(p->>'radius_m', '')::int, active = coalesce((p->>'active')::boolean, true)
    where id = lid and tenant_id = tid;
    if not found then raise exception 'Location not found'; end if;
  end if;
  perform pay_audit_log(tid, 'save', 'location', lid::text, null, null, p, null);
  return lid;
end $$;

create function pay_save_master(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid; mid uuid := nullif(p->>'id', '')::uuid;
begin
  tid := pay_guard(case when p->>'kind' in ('department', 'designation') then 'pay_people' else 'pay_admin' end);
  if p->>'kind' not in ('department', 'designation', 'grade', 'cost_centre', 'doc_type', 'claim_type') then raise exception 'Unknown list'; end if;
  if pay_clean(p->>'name', 80) is null then raise exception 'Enter a name'; end if;
  if mid is null then
    insert into pay_masters (tenant_id, kind, name) values (tid, p->>'kind', pay_clean(p->>'name', 80)) on conflict (tenant_id, kind, name) do update set active = true returning id into mid;
  else
    update pay_masters set name = pay_clean(p->>'name', 80), active = coalesce((p->>'active')::boolean, true) where id = mid and tenant_id = tid;
  end if;
  return mid;
end $$;

create function pay_save_shift(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid; sid uuid := nullif(p->>'id', '')::uuid; st time; en time;
begin
  tid := pay_guard('pay_time');
  if pay_clean(p->>'name', 60) is null then raise exception 'Name the shift'; end if;
  st := (p->>'start_time')::time; en := (p->>'end_time')::time;
  if st is null or en is null then raise exception 'Enter the start and end time'; end if;
  if sid is null then
    insert into pay_shifts (tenant_id, name, start_time, end_time, overnight, break_mins, grace_mins, half_pct, active)
    values (tid, pay_clean(p->>'name', 60), st, en, en <= st, coalesce((p->>'break_mins')::int, 0), nullif(p->>'grace_mins', '')::int, nullif(p->>'half_pct', '')::int, coalesce((p->>'active')::boolean, true))
    returning id into sid;
  else
    update pay_shifts set name = pay_clean(p->>'name', 60), start_time = st, end_time = en, overnight = en <= st, break_mins = coalesce((p->>'break_mins')::int, 0),
      grace_mins = nullif(p->>'grace_mins', '')::int, half_pct = nullif(p->>'half_pct', '')::int, active = coalesce((p->>'active')::boolean, true)
    where id = sid and tenant_id = tid;
    if not found then raise exception 'Shift not found'; end if;
    -- days not yet locked by a finalised payroll follow the new times
    perform pay_att_refresh_all(tid, pay_today(tid) - 31, pay_today(tid));
  end if;
  perform pay_audit_log(tid, 'save', 'shift', sid::text, null, null, p, null);
  return sid;
end $$;

create function pay_save_holiday(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid; hid uuid := nullif(p->>'id', '')::uuid; d date; old date;
begin
  tid := pay_guard('pay_time');
  d := (p->>'date')::date;
  if d is null or pay_clean(p->>'name', 80) is null then raise exception 'Enter the date and the name of the holiday'; end if;
  if hid is null then
    insert into pay_holidays (tenant_id, hdate, name, location_id) values (tid, d, pay_clean(p->>'name', 80), nullif(p->>'location_id', '')::uuid) returning id into hid;
  else
    select hdate into old from pay_holidays where id = hid and tenant_id = tid;
    update pay_holidays set hdate = d, name = pay_clean(p->>'name', 80), location_id = nullif(p->>'location_id', '')::uuid where id = hid and tenant_id = tid;
    if old is not null and old <= pay_today(tid) then perform pay_att_refresh_all(tid, old, old); end if;
  end if;
  if d <= pay_today(tid) then perform pay_att_refresh_all(tid, d, d); end if;
  perform pay_audit_log(tid, 'save', 'holiday', hid::text, null, null, p, null);
  return hid;
end $$;

create function pay_delete_holiday(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid; d date;
begin
  tid := pay_guard('pay_time');
  delete from pay_holidays where id = p_id and tenant_id = tid returning hdate into d;
  if d is not null and d <= pay_today(tid) then perform pay_att_refresh_all(tid, d, d); end if;
  perform pay_audit_log(tid, 'delete', 'holiday', p_id::text, null, null, null, null);
end $$;

create function pay_save_leave_type(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid; lid uuid := nullif(p->>'id', '')::uuid; c text;
begin
  tid := pay_guard('pay_admin');
  c := upper(regexp_replace(coalesce(p->>'code', ''), '[^A-Za-z0-9_]', '', 'g'));
  if c !~ '^[A-Z][A-Z0-9_]{0,11}$' then raise exception 'Give the leave a short code, like PL or SL'; end if;
  if pay_clean(p->>'name', 60) is null then raise exception 'Name the leave type'; end if;
  if lid is null then
    insert into pay_leave_types (tenant_id, code, name, paid, quota, accrual, carry_max, encashable, half_day, allow_negative, count_offdays, gender, sort, active)
    values (tid, c, pay_clean(p->>'name', 60), coalesce((p->>'paid')::boolean, true), coalesce((p->>'quota')::numeric, 0), coalesce(p->>'accrual', 'yearly'),
            nullif(p->>'carry_max', '')::numeric, coalesce((p->>'encashable')::boolean, false), coalesce((p->>'half_day')::boolean, true),
            coalesce((p->>'allow_negative')::boolean, false), coalesce((p->>'count_offdays')::boolean, false), nullif(p->>'gender', ''), coalesce((p->>'sort')::int, 50), true)
    returning id into lid;
  else
    update pay_leave_types set code = c, name = pay_clean(p->>'name', 60), paid = coalesce((p->>'paid')::boolean, paid), quota = coalesce((p->>'quota')::numeric, quota),
      accrual = coalesce(p->>'accrual', accrual), carry_max = case when p ? 'carry_max' then nullif(p->>'carry_max', '')::numeric else carry_max end,
      encashable = coalesce((p->>'encashable')::boolean, encashable), half_day = coalesce((p->>'half_day')::boolean, half_day),
      allow_negative = coalesce((p->>'allow_negative')::boolean, allow_negative), count_offdays = coalesce((p->>'count_offdays')::boolean, count_offdays),
      gender = case when p ? 'gender' then nullif(p->>'gender', '') else gender end, active = coalesce((p->>'active')::boolean, active)
    where id = lid and tenant_id = tid;
    if not found then raise exception 'Leave type not found'; end if;
  end if;
  perform pay_audit_log(tid, 'save', 'leave_type', lid::text, null, null, p, null);
  return lid;
end $$;

create function pay_save_component(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid; c pay_components; code text; cid uuid;
begin
  tid := pay_guard('pay_admin');
  code := upper(regexp_replace(coalesce(p->>'code', ''), '[^A-Za-z0-9_]', '', 'g'));
  select * into c from pay_components where tenant_id = tid and (id = nullif(p->>'id', '')::uuid or (nullif(p->>'id', '') is null and code = code));
  if c.id is not null and c.system is not null then
    -- system components: only the name, payslip visibility and accounting account can change
    update pay_components set name = coalesce(pay_clean(p->>'name', 60), name), on_payslip = coalesce((p->>'on_payslip')::boolean, on_payslip),
      gl_key = case when p ? 'gl_key' then nullif(p->>'gl_key', '') else gl_key end where id = c.id;
    return c.id;
  end if;
  if code !~ '^[A-Z][A-Z0-9_]{0,23}$' then raise exception 'The code is letters, numbers and _ (like FOOD_ALLOW)'; end if;
  if pay_clean(p->>'name', 60) is null then raise exception 'Name the component'; end if;
  if c.id is null then
    insert into pay_components (tenant_id, code, name, kind, taxable, pf_wage, esi_wage, pt_wage, prorate, is_basic, gl_key, on_payslip, sort)
    values (tid, code, pay_clean(p->>'name', 60), coalesce(p->>'kind', 'earning'), coalesce((p->>'taxable')::boolean, true), coalesce((p->>'pf_wage')::boolean, false),
            coalesce((p->>'esi_wage')::boolean, true), coalesce((p->>'pt_wage')::boolean, true), coalesce((p->>'prorate')::boolean, true), coalesce((p->>'is_basic')::boolean, false),
            nullif(p->>'gl_key', ''), coalesce((p->>'on_payslip')::boolean, true), coalesce((p->>'sort')::int, 100)) returning id into cid;
  else
    if c.code <> code and exists (select 1 from pay_run_lines where tenant_id = tid and code = c.code) then raise exception 'This component is on payslips already; its code cannot change'; end if;
    update pay_components set code = code, name = pay_clean(p->>'name', 60), kind = coalesce(p->>'kind', kind), taxable = coalesce((p->>'taxable')::boolean, taxable),
      pf_wage = coalesce((p->>'pf_wage')::boolean, pf_wage), esi_wage = coalesce((p->>'esi_wage')::boolean, esi_wage), pt_wage = coalesce((p->>'pt_wage')::boolean, pt_wage),
      prorate = coalesce((p->>'prorate')::boolean, prorate), is_basic = coalesce((p->>'is_basic')::boolean, is_basic), gl_key = case when p ? 'gl_key' then nullif(p->>'gl_key', '') else gl_key end,
      on_payslip = coalesce((p->>'on_payslip')::boolean, on_payslip), active = coalesce((p->>'active')::boolean, active), sort = coalesce((p->>'sort')::int, sort)
    where id = c.id;
    cid := c.id;
  end if;
  perform pay_audit_log(tid, 'save', 'component', cid::text, null, to_jsonb(c), p, null);
  return cid;
end $$;

-- Works out a structure for an amount without saving (the editor's live preview, and validation before saving).
create function pay_preview_structure(p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; st pay_structures; ls jsonb; basis text; b jsonb;
begin
  tid := pay_guard_pay();
  if nullif(p->>'structure_id', '') is not null then
    select * into st from pay_structures where id = (p->>'structure_id')::uuid and tenant_id = tid;
    if st.id is null then raise exception 'Structure not found'; end if;
  end if;
  ls := coalesce(p->'lines', st.lines); basis := coalesce(p->>'basis', st.basis, 'monthly');
  b := pay_structure_eval(tid, ls, basis, coalesce((p->>'amount')::numeric, 0), coalesce(p->'overrides', '{}'), pay_struct_ctx(tid, coalesce(nullif(p->>'date', '')::date, pay_today(tid))));
  return b || jsonb_build_object('names', (select jsonb_object_agg(c.code, c.name) from pay_components c where c.tenant_id = tid and b->'lines' ? c.code));
end $$;

create function pay_save_structure(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid; sid uuid := nullif(p->>'id', '')::uuid; nm text; l jsonb;
begin
  tid := pay_guard('pay_admin');
  nm := pay_clean(p->>'name', 60);
  if nm is null then raise exception 'Name the structure'; end if;
  if jsonb_typeof(p->'lines') <> 'array' or jsonb_array_length(p->'lines') = 0 then raise exception 'Add at least one component'; end if;
  for l in select * from jsonb_array_elements(p->'lines') loop
    if coalesce(l->>'calc', 'fixed') not in ('fixed', 'formula', 'balance') then raise exception 'Unknown rule %', l->>'calc'; end if;
  end loop;
  -- prove it works before saving it: a sample amount must split without errors
  perform pay_structure_eval(tid, p->'lines', coalesce(p->>'basis', 'monthly'), case when p->>'basis' = 'ctc' then 600000 else 50000 end, '{}', pay_struct_ctx(tid, pay_today(tid)));
  if sid is null then
    insert into pay_structures (tenant_id, name, description, basis, lines, is_default) values (tid, nm, pay_clean(p->>'description', 300), coalesce(p->>'basis', 'monthly'), p->'lines', false) returning id into sid;
  else
    update pay_structures set name = nm, description = pay_clean(p->>'description', 300), basis = coalesce(p->>'basis', basis), lines = p->'lines',
      active = coalesce((p->>'active')::boolean, active), updated_at = now() where id = sid and tenant_id = tid;
    if not found then raise exception 'Structure not found'; end if;
  end if;
  if coalesce((p->>'is_default')::boolean, false) then
    update pay_structures set is_default = (id = sid) where tenant_id = tid;
  end if;
  perform pay_audit_log(tid, 'save', 'structure', sid::text, null, null, p, null);
  return sid;
end $$;

-- a business's own version of a statutory rule (for example its state's labour welfare fund); AUZslab's rows are read-only
create function pay_save_rule(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid; rid uuid := nullif(p->>'id', '')::uuid;
begin
  tid := pay_guard('pay_admin');
  if p->>'scheme' not in ('PF', 'ESI', 'PT', 'LWF', 'TDS', 'GRATUITY', 'BONUS') then raise exception 'Unknown scheme'; end if;
  if jsonb_typeof(p->'params') <> 'object' then raise exception 'The rule needs its values'; end if;
  if pay_clean(p->>'source', 300) is null then raise exception 'Say where these values come from (act, notification or circular)'; end if;
  if rid is null then
    insert into pay_stat_rules (tenant_id, scheme, region, eff_from, eff_to, params, source, verified_on, note, created_by)
    values (tid, p->>'scheme', coalesce(nullif(p->>'region', ''), 'IN'), (p->>'eff_from')::date, nullif(p->>'eff_to', '')::date, p->'params', pay_clean(p->>'source', 300),
            coalesce(nullif(p->>'verified_on', '')::date, pay_today(tid)), pay_clean(p->>'note', 300), app_uid()) returning id into rid;
  else
    update pay_stat_rules set region = coalesce(nullif(p->>'region', ''), 'IN'), eff_from = (p->>'eff_from')::date, eff_to = nullif(p->>'eff_to', '')::date, params = p->'params',
      source = pay_clean(p->>'source', 300), verified_on = coalesce(nullif(p->>'verified_on', '')::date, verified_on), note = pay_clean(p->>'note', 300)
    where id = rid and tenant_id = tid;
    if not found then raise exception 'Only your own rules can be edited'; end if;
  end if;
  perform pay_audit_log(tid, 'save', 'stat_rule', rid::text, null, null, p, null);
  return rid;
end $$;

create function pay_list_rules() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := pay_guard('pay_view');
  return coalesce((select jsonb_agg(to_jsonb(r) - 'tenant_id' || jsonb_build_object('own', r.tenant_id is not null) order by r.scheme, r.region, r.eff_from desc)
    from pay_stat_rules r where r.tenant_id is null or r.tenant_id = tid), '[]');
end $$;

-- ---------- people ----------
create function pay_emp_row(e pay_employees, td date, sal boolean) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', e.id, 'code', e.code, 'name', e.name, 'phone', e.phone, 'email', e.email, 'status', e.status, 'gender', e.gender,
    'joined_on', e.joined_on, 'last_day', e.last_day, 'notice_on', e.notice_on, 'confirm_on', e.confirm_on, 'dob', e.dob, 'photo', e.photo, 'linked', e.user_id is not null,
    'department', j.department, 'designation', j.designation, 'location_id', j.location_id, 'location', l.name, 'manager_id', j.manager_id, 'shift_id', j.shift_id,
    'emp_type', j.emp_type, 'today', a.status, 'in', a.first_in, 'out', a.last_out, 'fnf_done', e.fnf_run_id is not null, 'attendance_mode', pay_att_mode(e),
    'salary', case when sal then s.amount end, 'basis', case when sal then st.basis end, 'gross', case when sal then (s.breakup->>'gross')::numeric end)
  from (select 1) one
  left join lateral (select * from pay_jobs where employee_id = e.id and eff_from <= greatest(td, e.joined_on) order by eff_from desc limit 1) j on true
  left join pay_locations l on l.id = j.location_id
  left join pay_attendance a on a.employee_id = e.id and a.att_date = td
  left join lateral (select * from pay_salaries where employee_id = e.id and eff_from <= greatest(td, e.joined_on) order by eff_from desc limit 1) s on true
  left join pay_structures st on st.id = s.structure_id
$$;

create function pay_list_employees(p jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; sal boolean; td date; q text; v_status text;
begin
  tid := pay_guard('pay_view');
  sal := pay_perm('pay_salary'); td := pay_today(tid);
  q := lower(nullif(trim(p->>'q'), '')); v_status := coalesce(nullif(p->>'status', ''), 'current');
  return coalesce((select jsonb_agg(pay_emp_row(e, td, sal) order by e.name) from pay_employees e
    where e.tenant_id = tid
      and (v_status = 'all' or (v_status = 'current' and e.status in ('onboarding', 'active', 'notice')) or e.status = v_status)
      and (q is null or lower(e.name) like '%' || q || '%' or lower(coalesce(e.code, '')) like '%' || q || '%' or coalesce(e.phone, '') like '%' || q || '%')), '[]');
end $$;

create function pay_leave_summary(emp text) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'code', t.code, 'name', t.name, 'paid', t.paid, 'quota', t.quota, 'half_day', t.half_day,
    'balance', coalesce((select sum(days) from pay_leave_ledger g where g.employee_id = emp and g.leave_type_id = t.id), 0),
    'used', coalesce((select -sum(days) from pay_leave_ledger g where g.employee_id = emp and g.leave_type_id = t.id and g.kind in ('debit', 'reverse')
                      and g.on_date >= pay_leave_year_start(t.tenant_id, pay_today(t.tenant_id))), 0),
    'pending', coalesce((select sum(days) from pay_leave_requests q where q.employee_id = emp and q.leave_type_id = t.id and q.status = 'pending'), 0)) order by t.sort, t.name), '[]')
  from pay_leave_types t join pay_employees e on e.id = emp and e.tenant_id = t.tenant_id
  where t.active and (t.gender is null or t.gender = e.gender)
$$;

create function pay_get_employee(p_id text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; e pay_employees; sal boolean; res jsonb; td date;
begin
  tid := pay_guard('pay_view'); sal := pay_perm('pay_salary'); td := pay_today(tid);
  select * into e from pay_employees where id = p_id and tenant_id = tid;
  if e.id is null then raise exception 'Employee not found'; end if;
  res := to_jsonb(e) - 'kiosk_pin' - 'tenant_id' - 'user_id' || pay_emp_row(e, td, sal);
  if not sal then res := res - 'pan' - 'aadhaar_last4' - 'uan' - 'esi_no' - 'tax_regime' - 'pf_on_actual' - 'father_name'; end if;
  res := res || jsonb_build_object(
    'kiosk_pin_set', e.kiosk_pin is not null,
    'login', (select jsonb_build_object('email', p.email, 'name', p.name) from profiles p where p.id = e.user_id),
    'jobs', (select coalesce(jsonb_agg(to_jsonb(j) - 'tenant_id' || jsonb_build_object('location', l.name, 'manager', m.name, 'shift', s.name) order by j.eff_from desc), '[]')
             from pay_jobs j left join pay_locations l on l.id = j.location_id left join pay_employees m on m.id = j.manager_id left join pay_shifts s on s.id = j.shift_id where j.employee_id = e.id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('on_date', v.on_date, 'kind', v.kind, 'title', v.title) order by v.on_date desc, v.id desc), '[]')
               from (select * from pay_emp_events where employee_id = e.id order by on_date desc, id desc limit 40) v),
    'leave', pay_leave_summary(e.id),
    'assets', (select coalesce(jsonb_agg(to_jsonb(x) - 'tenant_id' order by x.issued_on desc nulls last), '[]') from pay_assets x where x.employee_id = e.id),
    'documents', (select coalesce(jsonb_agg(to_jsonb(d) - 'tenant_id' order by d.created_at desc), '[]') from pay_documents d where d.employee_id = e.id),
    'month', (select jsonb_build_object('present', count(*) filter (where status in ('present', 'late', 'missing')), 'late', count(*) filter (where status = 'late'),
               'absent', count(*) filter (where status = 'absent'), 'half', count(*) filter (where status in ('half', 'half_leave')), 'leave', count(*) filter (where status = 'leave'))
              from pay_attendance where employee_id = e.id and att_date between date_trunc('month', td)::date and td));
  if sal then
    res := res || jsonb_build_object(
      'salaries', (select coalesce(jsonb_agg(to_jsonb(s) - 'tenant_id' || jsonb_build_object('structure', st.name, 'basis', st.basis,
                    'used', exists (select 1 from pay_run_items i join pay_runs r on r.id = i.run_id where i.salary_id = s.id and r.status in ('finalized', 'paid', 'locked'))) order by s.eff_from desc), '[]')
                   from pay_salaries s join pay_structures st on st.id = s.structure_id where s.employee_id = e.id),
      'bank', (select to_jsonb(b) - 'tenant_id' from pay_bank_accounts b where b.employee_id = e.id and b.status = 'active'),
      'bank_pending', (select to_jsonb(b) - 'tenant_id' from pay_bank_accounts b where b.employee_id = e.id and b.status = 'pending' order by created_at desc limit 1),
      'loans', (select coalesce(jsonb_agg(to_jsonb(l) - 'tenant_id' || jsonb_build_object('outstanding', coalesce((select sum(amount) from pay_loan_ledger g where g.loan_id = l.id), 0)) order by l.created_at desc), '[]')
                from pay_loans l where l.employee_id = e.id),
      'payslips', (select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'run_id', r.id, 'number', r.number, 'kind', r.kind, 'month', r.month, 'title', r.title, 'status', r.status,
                    'gross', i.gross, 'deductions', i.deductions, 'net', i.net, 'payslip_no', i.payslip_no) order by r.month desc, r.created_at desc), '[]')
                   from pay_run_items i join pay_runs r on r.id = i.run_id where i.employee_id = e.id and r.status in ('finalized', 'paid', 'locked')),
      'tax', (select to_jsonb(d) - 'tenant_id' from pay_tax_decl d where d.employee_id = e.id order by d.fy desc limit 1));
  end if;
  return res;
end $$;

create function pay_job_insert(tid uuid, emp text, eff date, j jsonb, why text) returns void language plpgsql security definer set search_path = public as $$
declare cur pay_jobs;
begin
  cur := pay_job_at(emp, eff);
  if nullif(j->>'manager_id', '') = emp then raise exception 'Someone cannot be their own manager'; end if;
  if nullif(j->>'manager_id', '') is not null and not exists (select 1 from pay_employees where id = j->>'manager_id' and tenant_id = tid) then raise exception 'Manager not found'; end if;
  if nullif(j->>'location_id', '') is not null and not exists (select 1 from pay_locations where id = (j->>'location_id')::uuid and tenant_id = tid) then raise exception 'Location not found'; end if;
  if nullif(j->>'shift_id', '') is not null and not exists (select 1 from pay_shifts where id = (j->>'shift_id')::uuid and tenant_id = tid) then raise exception 'Shift not found'; end if;
  insert into pay_jobs (tenant_id, employee_id, eff_from, location_id, department, designation, grade, cost_centre, emp_type, manager_id, shift_id, weekly_off, reason, created_by)
  values (tid, emp, eff,
    case when j ? 'location_id' then nullif(j->>'location_id', '')::uuid else cur.location_id end,
    case when j ? 'department' then pay_clean(j->>'department', 80) else cur.department end,
    case when j ? 'designation' then pay_clean(j->>'designation', 80) else cur.designation end,
    case when j ? 'grade' then pay_clean(j->>'grade', 40) else cur.grade end,
    case when j ? 'cost_centre' then pay_clean(j->>'cost_centre', 40) else cur.cost_centre end,
    coalesce(nullif(j->>'emp_type', ''), cur.emp_type, 'full_time'),
    case when j ? 'manager_id' then nullif(j->>'manager_id', '') else cur.manager_id end,
    case when j ? 'shift_id' then nullif(j->>'shift_id', '')::uuid else cur.shift_id end,
    case when j ? 'weekly_off' then case when jsonb_typeof(j->'weekly_off') = 'array' then array(select x::int from jsonb_array_elements_text(j->'weekly_off') x) end else cur.weekly_off end,
    why, app_uid())
  on conflict (employee_id, eff_from) do update set location_id = excluded.location_id, department = excluded.department, designation = excluded.designation,
    grade = excluded.grade, cost_centre = excluded.cost_centre, emp_type = excluded.emp_type, manager_id = excluded.manager_id, shift_id = excluded.shift_id,
    weekly_off = excluded.weekly_off, reason = excluded.reason;
  -- masters grow from what people type
  if pay_clean(j->>'department', 80) is not null then insert into pay_masters (tenant_id, kind, name) values (tid, 'department', pay_clean(j->>'department', 80)) on conflict do nothing; end if;
  if pay_clean(j->>'designation', 80) is not null then insert into pay_masters (tenant_id, kind, name) values (tid, 'designation', pay_clean(j->>'designation', 80)) on conflict do nothing; end if;
end $$;

create function pay_salary_upsert(tid uuid, emp text, p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare e pay_employees; st pay_structures; eff date; b jsonb; sid uuid; s pay_salaries; ov jsonb := '{}'; k text; prev pay_salaries;
begin
  select * into e from pay_employees where id = emp and tenant_id = tid;
  eff := coalesce(nullif(p->>'eff_from', '')::date, e.joined_on);
  if eff < e.joined_on then raise exception 'A salary cannot start before the joining date (%)', to_char(e.joined_on, 'DD Mon YYYY'); end if;
  select * into st from pay_structures where tenant_id = tid and id = coalesce(nullif(p->>'structure_id', '')::uuid, (select id from pay_structures where tenant_id = tid and is_default limit 1));
  if st.id is null then raise exception 'Pick a salary structure'; end if;
  if coalesce((p->>'amount')::numeric, -1) < 0 then raise exception 'Enter the salary amount'; end if;
  if jsonb_typeof(p->'overrides') = 'object' then
    for k in select jsonb_object_keys(p->'overrides') loop
      if nullif(p->'overrides'->>k, '') is not null then ov := ov || jsonb_build_object(upper(k), (p->'overrides'->>k)::numeric); end if;
    end loop;
  end if;
  s.tenant_id := tid; s.employee_id := emp; s.eff_from := eff; s.structure_id := st.id; s.amount := (p->>'amount')::numeric; s.overrides := ov;
  b := pay_salary_breakup(tid, s, pay_struct_ctx(tid, eff));
  prev := pay_salary_at(emp, eff - 1);
  insert into pay_salaries (tenant_id, employee_id, eff_from, structure_id, amount, overrides, ot_rate, breakup, reason, note, created_by)
  values (tid, emp, eff, st.id, s.amount, ov, coalesce(nullif(p->>'ot_rate', '')::numeric, 0), b, coalesce(pay_clean(p->>'reason', 40), case when prev.id is null then 'joining' else 'revision' end), pay_clean(p->>'note', 300), app_uid())
  on conflict (employee_id, eff_from) do update set structure_id = excluded.structure_id, amount = excluded.amount, overrides = excluded.overrides,
    ot_rate = excluded.ot_rate, breakup = excluded.breakup, reason = excluded.reason, note = excluded.note, created_at = now(), created_by = app_uid()
  returning id into sid;
  insert into pay_emp_events (tenant_id, employee_id, on_date, kind, title, data, created_by)
  values (tid, emp, eff, 'salary', case when prev.id is null then 'Salary set: ' else 'Salary changed: ' end || pay_num(s.amount) || case when st.basis = 'ctc' then ' a year (CTC)' else ' a month' end,
          jsonb_build_object('from', prev.amount, 'to', s.amount), app_uid());
  perform pay_audit_log(tid, 'save', 'salary', sid::text, emp, case when prev.id is null then null else jsonb_build_object('amount', prev.amount, 'eff_from', prev.eff_from) end,
          jsonb_build_object('amount', s.amount, 'eff_from', eff, 'structure', st.name), null);
  return sid;
end $$;

create function pay_bank_insert(tid uuid, emp text, p jsonb, v_status text) returns uuid language plpgsql security definer set search_path = public as $$
declare bid uuid; old pay_bank_accounts;
begin
  if coalesce(p->>'mode', 'bank') not in ('bank', 'upi', 'cash', 'cheque') then raise exception 'Unknown payment method'; end if;
  perform pay_check_bank(p);
  select * into old from pay_bank_accounts where employee_id = emp and status = 'active';
  if v_status = 'active' then update pay_bank_accounts set status = 'replaced' where employee_id = emp and status in ('active', 'pending'); end if;
  insert into pay_bank_accounts (tenant_id, employee_id, mode, holder, bank_name, account_no, ifsc, upi, status, requested_by, decided_by, decided_at)
  values (tid, emp, coalesce(p->>'mode', 'bank'), pay_clean(p->>'holder', 100), pay_clean(p->>'bank_name', 100), nullif(regexp_replace(coalesce(p->>'account_no', ''), '\s', '', 'g'), ''),
          upper(nullif(p->>'ifsc', '')), nullif(p->>'upi', ''), v_status, app_uid(), case when v_status = 'active' then app_uid() end, case when v_status = 'active' then now() end)
  returning id into bid;
  -- audit keeps masked numbers plus a fingerprint, never the full account number
  perform pay_audit_log(tid, case when v_status = 'pending' then 'request' else 'save' end, 'bank', bid::text, emp,
    case when old.id is null then null else jsonb_build_object('mode', old.mode, 'account', pay_mask(old.account_no), 'ifsc', old.ifsc, 'fp', md5(coalesce(old.account_no, '') || coalesce(old.upi, ''))) end,
    jsonb_build_object('mode', coalesce(p->>'mode', 'bank'), 'account', pay_mask(p->>'account_no'), 'ifsc', upper(nullif(p->>'ifsc', '')), 'fp', md5(coalesce(p->>'account_no', '') || coalesce(p->>'upi', ''))), null);
  return bid;
end $$;

-- p: identity fields, plus on a new employee: job {location_id, department, designation, manager_id, shift_id, emp_type, weekly_off},
-- salary {structure_id, amount, ot_rate, overrides} and bank {mode, holder, bank_name, account_no, ifsc, upi} (both need pay_salary)
create function pay_save_employee(p jsonb) returns text language plpgsql security definer set search_path = public as $$
declare tid uuid; e pay_employees; sal boolean; eid text; v_code text; jn date; n int; isnew boolean; td date; before jsonb;
begin
  tid := pay_guard('pay_people'); sal := pay_perm('pay_salary');
  perform pay_setup_defaults(tid);
  if not sal then p := p - 'pan' - 'aadhaar_last4' - 'uan' - 'esi_no' - 'tax_regime' - 'pf_applicable' - 'eps_applicable' - 'pf_on_actual' - 'esi_applicable' - 'pt_applicable' - 'lwf_applicable' - 'salary' - 'bank'; end if;
  perform pay_check_ids(p);
  eid := nullif(p->>'id', '');
  if eid is not null then select * into e from pay_employees where id = eid and tenant_id = tid; end if;
  isnew := e.id is null; td := pay_today(tid);
  if isnew then
    if pay_clean(p->>'name', 120) is null then raise exception 'Enter the employee''s name'; end if;
    eid := coalesce(eid, gen_random_uuid()::text);
    if exists (select 1 from pay_employees where id = eid) then raise exception 'This employee id is taken'; end if;
    jn := coalesce(nullif(p->>'joined_on', '')::date, td);
    v_code := pay_clean(p->>'code', 20);
    if v_code is null then
      loop n := pay_next_no(tid, 'EMPCODE'); v_code := 'E' || lpad(n::text, 3, '0'); exit when not exists (select 1 from pay_employees where tenant_id = tid and lower(code) = lower(v_code)); end loop;
    elsif exists (select 1 from pay_employees where tenant_id = tid and lower(code) = lower(v_code)) then raise exception 'Employee number % is already used', v_code; end if;
    insert into pay_employees (id, tenant_id, code, name, phone, email, gender, dob, father_name, address, emergency_name, emergency_phone, pan, aadhaar_last4, uan, esi_no,
      status, joined_on, confirm_on, attendance_mode, pf_applicable, eps_applicable, pf_on_actual, esi_applicable, pt_applicable, lwf_applicable, disabled_person, tax_regime, photo, notes, source)
    values (eid, tid, v_code, pay_clean(p->>'name', 120), pay_clean(p->>'phone', 20), lower(pay_clean(p->>'email', 120)), nullif(p->>'gender', ''), nullif(p->>'dob', '')::date,
      pay_clean(p->>'father_name', 120), pay_clean(p->>'address', 400), pay_clean(p->>'emergency_name', 120), pay_clean(p->>'emergency_phone', 20),
      upper(nullif(p->>'pan', '')), nullif(p->>'aadhaar_last4', ''), nullif(p->>'uan', ''), nullif(p->>'esi_no', ''),
      case when coalesce(p->>'status', '') = 'onboarding' then 'onboarding' else 'active' end, jn, nullif(p->>'confirm_on', '')::date, nullif(p->>'attendance_mode', ''),
      coalesce((p->>'pf_applicable')::boolean, true), coalesce((p->>'eps_applicable')::boolean, true), (p->>'pf_on_actual')::boolean, coalesce((p->>'esi_applicable')::boolean, true),
      coalesce((p->>'pt_applicable')::boolean, true), coalesce((p->>'lwf_applicable')::boolean, true), coalesce((p->>'disabled_person')::boolean, false),
      coalesce(nullif(p->>'tax_regime', ''), 'new'), nullif(p->>'photo', ''), pay_clean(p->>'notes', 1000), coalesce(nullif(p->>'source', ''), 'app'));
    perform pay_job_insert(tid, eid, jn, (p - 'id' - 'name' - 'job' - 'salary' - 'bank') || coalesce(p->'job', '{}'), 'joining');
    insert into pay_emp_events (tenant_id, employee_id, on_date, kind, title, created_by) values (tid, eid, jn, 'joined', 'Joined', app_uid());
    if sal and jsonb_typeof(p->'salary') = 'object' and coalesce((p->'salary'->>'amount')::numeric, 0) > 0 then perform pay_salary_upsert(tid, eid, (p->'salary') || jsonb_build_object('eff_from', jn)); end if;
    if sal and jsonb_typeof(p->'bank') = 'object' and (nullif(p->'bank'->>'account_no', '') is not null or nullif(p->'bank'->>'upi', '') is not null or p->'bank'->>'mode' in ('cash', 'cheque')) then
      perform pay_bank_insert(tid, eid, p->'bank', 'active');
    end if;
    perform pay_audit_log(tid, 'create', 'employee', eid, eid, null, p - 'bank', null);
    perform pay_leave_accrue(tid);
    if jn <= td then perform pay_att_refresh(tid, eid, greatest(jn, td - 40), td); end if;
  else
    before := to_jsonb(e) - 'kiosk_pin';
    if p ? 'code' and pay_clean(p->>'code', 20) is not null and exists (select 1 from pay_employees where tenant_id = tid and lower(code) = lower(pay_clean(p->>'code', 20)) and id <> e.id) then
      raise exception 'Employee number % is already used', p->>'code';
    end if;
    if p ? 'joined_on' and (p->>'joined_on')::date <> e.joined_on then
      if exists (select 1 from pay_run_items i join pay_runs r on r.id = i.run_id where i.employee_id = e.id and r.status in ('finalized', 'paid', 'locked') and r.kind <> 'legacy') then
        raise exception 'The joining date cannot change after a payroll was finalised for this person';
      end if;
      update pay_jobs set eff_from = (p->>'joined_on')::date where employee_id = e.id and eff_from = e.joined_on;
      update pay_salaries set eff_from = (p->>'joined_on')::date where employee_id = e.id and eff_from = e.joined_on;
    end if;
    update pay_employees set
      code = case when p ? 'code' then pay_clean(p->>'code', 20) else code end,
      name = coalesce(case when p ? 'name' then pay_clean(p->>'name', 120) end, name),
      phone = case when p ? 'phone' then pay_clean(p->>'phone', 20) else phone end,
      email = case when p ? 'email' then lower(pay_clean(p->>'email', 120)) else email end,
      gender = case when p ? 'gender' then nullif(p->>'gender', '') else gender end,
      dob = case when p ? 'dob' then nullif(p->>'dob', '')::date else dob end,
      father_name = case when p ? 'father_name' then pay_clean(p->>'father_name', 120) else father_name end,
      address = case when p ? 'address' then pay_clean(p->>'address', 400) else address end,
      emergency_name = case when p ? 'emergency_name' then pay_clean(p->>'emergency_name', 120) else emergency_name end,
      emergency_phone = case when p ? 'emergency_phone' then pay_clean(p->>'emergency_phone', 20) else emergency_phone end,
      pan = case when p ? 'pan' then upper(nullif(p->>'pan', '')) else pan end,
      aadhaar_last4 = case when p ? 'aadhaar_last4' then nullif(p->>'aadhaar_last4', '') else aadhaar_last4 end,
      uan = case when p ? 'uan' then nullif(p->>'uan', '') else uan end,
      esi_no = case when p ? 'esi_no' then nullif(p->>'esi_no', '') else esi_no end,
      joined_on = coalesce(case when p ? 'joined_on' then (p->>'joined_on')::date end, joined_on),
      confirm_on = case when p ? 'confirm_on' then nullif(p->>'confirm_on', '')::date else confirm_on end,
      attendance_mode = case when p ? 'attendance_mode' then nullif(p->>'attendance_mode', '') else attendance_mode end,
      pf_applicable = coalesce((p->>'pf_applicable')::boolean, pf_applicable), eps_applicable = coalesce((p->>'eps_applicable')::boolean, eps_applicable),
      pf_on_actual = case when p ? 'pf_on_actual' then (p->>'pf_on_actual')::boolean else pf_on_actual end,
      esi_applicable = coalesce((p->>'esi_applicable')::boolean, esi_applicable), pt_applicable = coalesce((p->>'pt_applicable')::boolean, pt_applicable),
      lwf_applicable = coalesce((p->>'lwf_applicable')::boolean, lwf_applicable), disabled_person = coalesce((p->>'disabled_person')::boolean, disabled_person),
      tax_regime = coalesce(nullif(p->>'tax_regime', ''), tax_regime),
      photo = case when p ? 'photo' then nullif(p->>'photo', '') else photo end,
      notes = case when p ? 'notes' then pay_clean(p->>'notes', 1000) else notes end,
      updated_at = now()
    where id = e.id;
    perform pay_audit_log(tid, 'update', 'employee', e.id, e.id, before - 'pan' || jsonb_build_object('pan', pay_mask(e.pan)), p - 'pan' || jsonb_build_object('pan', pay_mask(p->>'pan')), null);
    if p ? 'attendance_mode' or p ? 'joined_on' then perform pay_att_refresh(tid, e.id, greatest((select joined_on from pay_employees where id = e.id), td - 40), td); end if;
  end if;
  return eid;
end $$;

create function pay_save_job(p_emp text, p jsonb) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid; e pay_employees; eff date; td date;
begin
  tid := pay_guard('pay_people');
  select * into e from pay_employees where id = p_emp and tenant_id = tid;
  if e.id is null then raise exception 'Employee not found'; end if;
  eff := coalesce(nullif(p->>'eff_from', '')::date, pay_today(tid)); td := pay_today(tid);
  if eff < e.joined_on then raise exception 'The change cannot be before the joining date'; end if;
  perform pay_job_insert(tid, e.id, eff, p, coalesce(pay_clean(p->>'reason', 40), 'change'));
  insert into pay_emp_events (tenant_id, employee_id, on_date, kind, title, data, created_by)
  values (tid, e.id, eff, coalesce(pay_clean(p->>'reason', 40), 'change'), coalesce(pay_clean(p->>'title', 120), 'Job details changed'), p, app_uid());
  perform pay_audit_log(tid, 'save', 'job', e.id, e.id, null, p, null);
  if eff <= td then perform pay_att_refresh(tid, e.id, greatest(eff, td - 40), td); end if;
end $$;

create function pay_save_salary(p_emp text, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; sid uuid; past boolean;
begin
  tid := pay_guard('pay_salary');
  if not exists (select 1 from pay_employees where id = p_emp and tenant_id = tid) then raise exception 'Employee not found'; end if;
  sid := pay_salary_upsert(tid, p_emp, p);
  select exists (select 1 from pay_run_items i join pay_runs r on r.id = i.run_id where i.employee_id = p_emp and r.kind = 'regular' and r.status in ('finalized', 'paid', 'locked')
                 and r.period_to >= coalesce(nullif(p->>'eff_from', '')::date, (select joined_on from pay_employees where id = p_emp))) into past;
  return jsonb_build_object('id', sid, 'arrears', past, 'breakup', (select breakup from pay_salaries where id = sid));
end $$;

create function pay_delete_salary(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid; s pay_salaries;
begin
  tid := pay_guard('pay_salary');
  select * into s from pay_salaries where id = p_id and tenant_id = tid;
  if s.id is null then raise exception 'Not found'; end if;
  delete from pay_salaries where id = s.id;   -- the trigger refuses a row a finalised payroll used
  perform pay_audit_log(tid, 'delete', 'salary', s.id::text, s.employee_id, jsonb_build_object('amount', s.amount, 'eff_from', s.eff_from), null, null);
end $$;

create function pay_save_bank(p_emp text, p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := pay_guard('pay_salary');
  if not exists (select 1 from pay_employees where id = p_emp and tenant_id = tid) then raise exception 'Employee not found'; end if;
  return pay_bank_insert(tid, p_emp, p, 'active');
end $$;

-- an employee's own request to change where their salary goes
create function pay_bank_decide(p_id uuid, p_approve boolean) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid; b pay_bank_accounts;
begin
  tid := pay_guard('pay_salary');
  select * into b from pay_bank_accounts where id = p_id and tenant_id = tid and status = 'pending';
  if b.id is null then raise exception 'This request is no longer waiting'; end if;
  if p_approve then
    update pay_bank_accounts set status = 'replaced' where employee_id = b.employee_id and status = 'active';
    update pay_bank_accounts set status = 'active', decided_by = app_uid(), decided_at = now() where id = b.id;
  else
    update pay_bank_accounts set status = 'rejected', decided_by = app_uid(), decided_at = now() where id = b.id;
  end if;
  perform pay_audit_log(tid, case when p_approve then 'approve' else 'reject' end, 'bank', b.id::text, b.employee_id, null, jsonb_build_object('account', pay_mask(b.account_no)), null);
end $$;

-- lifecycle: activate, confirm, notice {notice_on, last_day, exit_kind, reason}, withdraw, exit {last_day, exit_kind, reason}, rehire {joined_on}
create function pay_set_status(p_emp text, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; e pay_employees; act text; d date; td date; ld date;
begin
  tid := pay_guard('pay_people');
  select * into e from pay_employees where id = p_emp and tenant_id = tid for update;
  if e.id is null then raise exception 'Employee not found'; end if;
  act := p->>'action'; td := pay_today(tid);
  if act = 'activate' then
    if e.status <> 'onboarding' then raise exception 'Only someone being onboarded can be activated'; end if;
    update pay_employees set status = 'active', updated_at = now() where id = e.id;
    insert into pay_emp_events (tenant_id, employee_id, on_date, kind, title, created_by) values (tid, e.id, td, 'active', 'Started work', app_uid());
  elsif act = 'confirm' then
    d := coalesce(nullif(p->>'confirm_on', '')::date, td);
    update pay_employees set confirm_on = d, updated_at = now() where id = e.id;
    insert into pay_emp_events (tenant_id, employee_id, on_date, kind, title, created_by) values (tid, e.id, d, 'confirmed', 'Confirmed after probation', app_uid());
  elsif act in ('notice', 'exit') then
    if e.status = 'exited' then raise exception '% has already left', e.name; end if;
    ld := (p->>'last_day')::date;
    if ld is null then raise exception 'Enter the last working day'; end if;
    if ld < e.joined_on - 1 then raise exception 'The last day cannot be before the joining date'; end if;
    if exists (select 1 from pay_run_items i join pay_runs r on r.id = i.run_id where i.employee_id = e.id and r.kind = 'regular' and r.status in ('finalized', 'paid', 'locked') and r.period_from > ld) then
      raise exception 'A later month is already paid for this person; the last day must be after it';
    end if;
    update pay_employees set status = case when ld < td then 'exited' else 'notice' end, notice_on = coalesce(nullif(p->>'notice_on', '')::date, case when act = 'notice' then td end, notice_on),
      last_day = ld, exit_kind = coalesce(nullif(p->>'exit_kind', ''), 'resigned'), exit_reason = pay_clean(p->>'reason', 400), updated_at = now() where id = e.id;
    insert into pay_emp_events (tenant_id, employee_id, on_date, kind, title, data, created_by)
    values (tid, e.id, coalesce(nullif(p->>'notice_on', '')::date, td), 'notice', 'Leaving on ' || to_char(ld, 'DD Mon YYYY') || ' (' || coalesce(nullif(p->>'exit_kind', ''), 'resigned') || ')', p, app_uid());
    -- days after the last day stop counting
    delete from pay_attendance where employee_id = e.id and att_date > ld and locked_run is null;
  elsif act = 'withdraw' then
    if e.status <> 'notice' then raise exception 'Only someone serving notice can withdraw it'; end if;
    update pay_employees set status = 'active', notice_on = null, last_day = null, exit_kind = null, exit_reason = null, updated_at = now() where id = e.id;
    insert into pay_emp_events (tenant_id, employee_id, on_date, kind, title, created_by) values (tid, e.id, td, 'withdrawn', 'Resignation withdrawn', app_uid());
    perform pay_att_refresh(tid, e.id, greatest(e.joined_on, td - 40), td);
  elsif act = 'rehire' then
    if e.status <> 'exited' then raise exception 'Only someone who has left can be rehired'; end if;
    d := coalesce(nullif(p->>'joined_on', '')::date, td);
    if d <= coalesce(e.last_day, e.joined_on) then raise exception 'The new joining date must be after the last working day'; end if;
    insert into pay_emp_events (tenant_id, employee_id, on_date, kind, title, data, created_by)
    values (tid, e.id, d, 'rehired', 'Rehired', jsonb_build_object('previous_joined_on', e.joined_on, 'previous_last_day', e.last_day), app_uid());
    update pay_employees set status = 'active', joined_on = d, notice_on = null, last_day = null, exit_kind = null, exit_reason = null, fnf_run_id = null, updated_at = now() where id = e.id;
    perform pay_job_insert(tid, e.id, d, coalesce(p->'job', '{}'), 'rehire');
    if jsonb_typeof(p->'salary') = 'object' and pay_perm('pay_salary') then perform pay_salary_upsert(tid, e.id, (p->'salary') || jsonb_build_object('eff_from', d)); end if;
  else
    raise exception 'Unknown action %', act;
  end if;
  perform pay_audit_log(tid, act, 'employee', e.id, e.id, jsonb_build_object('status', e.status, 'last_day', e.last_day), p, pay_clean(p->>'reason', 400));
  return (select to_jsonb(x) - 'kiosk_pin' - 'tenant_id' from pay_employees x where id = e.id);
end $$;

-- link an existing AUZslab login (same business) so the employee can use self-service
create function pay_link_login(p_emp text, p_email text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; uid uuid; other text;
begin
  tid := pay_guard('pay_people');
  if not exists (select 1 from pay_employees where id = p_emp and tenant_id = tid) then raise exception 'Employee not found'; end if;
  if nullif(trim(p_email), '') is null then
    update pay_employees set user_id = null, updated_at = now() where id = p_emp;
    perform pay_audit_log(tid, 'unlink', 'employee', p_emp, p_emp, null, null, null);
    return jsonb_build_object('linked', false);
  end if;
  select id into uid from profiles where tenant_id = tid and lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'No login with % in this business yet. Add it on your account''s Staff page first, then link it here', trim(p_email); end if;
  select name into other from pay_employees where tenant_id = tid and user_id = uid and id <> p_emp;
  if other is not null then raise exception 'That login is already linked to %', other; end if;
  update pay_employees set user_id = uid, updated_at = now() where id = p_emp;
  perform pay_audit_log(tid, 'link', 'employee', p_emp, p_emp, null, jsonb_build_object('email', lower(trim(p_email))), null);
  return jsonb_build_object('linked', true, 'email', lower(trim(p_email)));
end $$;

create function pay_set_kiosk_pin(p_emp text, p_pin text) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := pay_guard('pay_time');
  if p_pin is not null and p_pin !~ '^\d{4,6}$' then raise exception 'The PIN is 4 to 6 digits'; end if;
  update pay_employees set kiosk_pin = case when p_pin is null then null else crypt(p_pin, gen_salt('bf', 8)) end, updated_at = now() where id = p_emp and tenant_id = tid;
  if not found then raise exception 'Employee not found'; end if;
  perform pay_audit_log(tid, case when p_pin is null then 'clear_pin' else 'set_pin' end, 'employee', p_emp, p_emp, null, null, null);
end $$;

create function pay_save_asset(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid; aid uuid := nullif(p->>'id', '')::uuid;
begin
  tid := pay_guard('pay_people');
  if not exists (select 1 from pay_employees where id = p->>'employee_id' and tenant_id = tid) then raise exception 'Employee not found'; end if;
  if pay_clean(p->>'name', 100) is null then raise exception 'Name the item'; end if;
  if aid is null then
    insert into pay_assets (tenant_id, employee_id, name, serial, value, issued_on, returned_on, note)
    values (tid, p->>'employee_id', pay_clean(p->>'name', 100), pay_clean(p->>'serial', 60), nullif(p->>'value', '')::numeric, coalesce(nullif(p->>'issued_on', '')::date, pay_today(tid)),
            nullif(p->>'returned_on', '')::date, pay_clean(p->>'note', 300)) returning id into aid;
  else
    update pay_assets set name = pay_clean(p->>'name', 100), serial = pay_clean(p->>'serial', 60), value = nullif(p->>'value', '')::numeric,
      issued_on = nullif(p->>'issued_on', '')::date, returned_on = nullif(p->>'returned_on', '')::date, note = pay_clean(p->>'note', 300) where id = aid and tenant_id = tid;
  end if;
  perform pay_audit_log(tid, 'save', 'asset', aid::text, p->>'employee_id', null, p, null);
  return aid;
end $$;

create function pay_add_document(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid; did uuid; mine boolean;
begin
  tid := pay_tenant();
  mine := pay_my_emp() = p->>'employee_id';
  if not (pay_perm('pay_people') or mine) then raise exception 'Your role does not allow this' using errcode = '42501'; end if;
  if not exists (select 1 from pay_employees where id = p->>'employee_id' and tenant_id = tid) then raise exception 'Employee not found'; end if;
  if coalesce(p->>'path', '') !~ ('^' || tid::text || '/') then raise exception 'Upload the file first'; end if;
  insert into pay_documents (tenant_id, employee_id, doc_type, name, path, content_type, size, employee_can_see, uploaded_by)
  values (tid, p->>'employee_id', coalesce(pay_clean(p->>'doc_type', 60), 'Other'), pay_clean(p->>'name', 120), p->>'path', pay_clean(p->>'content_type', 80), nullif(p->>'size', '')::int,
          coalesce((p->>'employee_can_see')::boolean, true), app_uid()) returning id into did;
  perform pay_audit_log(tid, 'add', 'document', did::text, p->>'employee_id', null, p, null);
  return did;
end $$;

create function pay_delete_document(p_id uuid) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid; d pay_documents;
begin
  tid := pay_guard('pay_people');
  delete from pay_documents where id = p_id and tenant_id = tid returning * into d;
  if d.id is null then raise exception 'Not found'; end if;
  perform pay_audit_log(tid, 'delete', 'document', p_id::text, d.employee_id, to_jsonb(d), null, null);
end $$;

-- Asked by the API before it stores or serves an employee file: true for people staff of the business, or the employee themself.
create function pay_doc_check(p_emp text) returns boolean language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := (me()->>'tenant_id')::uuid;
  if tid is null or not exists (select 1 from pay_employees where id = p_emp and tenant_id = tid) then return false; end if;
  return pay_perm('pay_people') or pay_my_emp() = p_emp;
end $$;

-- Bulk import. rows: [{name, code, phone, email, gender, dob, joined_on, department, designation, location, salary, structure, pan, uan, esi_no,
-- bank_name, account_no, ifsc, holder}]. Dry run (commit false) reports every problem and saves nothing.
create function pay_import_employees(p_rows jsonb, p_commit boolean default false) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; sal boolean; r jsonb; i int := 0; errs jsonb := '[]'; ok int := 0; eid text; loc uuid; st uuid; pj jsonb;
begin
  tid := pay_guard('pay_people'); sal := pay_perm('pay_salary');
  perform pay_setup_defaults(tid);
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'Nothing to import'; end if;
  if jsonb_array_length(p_rows) > 2000 then raise exception 'Import at most 2,000 people at a time'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    begin
      if pay_clean(r->>'name', 120) is null then raise exception 'Name is missing'; end if;
      loc := null; st := null;
      if pay_clean(r->>'location', 80) is not null then
        select id into loc from pay_locations where tenant_id = tid and lower(name) = lower(pay_clean(r->>'location', 80));
        if loc is null then insert into pay_locations (tenant_id, name) values (tid, pay_clean(r->>'location', 80)) returning id into loc; end if;
      end if;
      if pay_clean(r->>'structure', 60) is not null then
        select id into st from pay_structures where tenant_id = tid and lower(name) = lower(pay_clean(r->>'structure', 60));
        if st is null then raise exception 'No salary structure called %', r->>'structure'; end if;
      end if;
      pj := jsonb_build_object('name', r->>'name', 'code', r->>'code', 'phone', r->>'phone', 'email', r->>'email', 'gender', lower(nullif(r->>'gender', '')),
        'dob', nullif(r->>'dob', ''), 'joined_on', nullif(r->>'joined_on', ''), 'pan', r->>'pan', 'uan', r->>'uan', 'esi_no', r->>'esi_no', 'source', 'import',
        'job', jsonb_build_object('department', r->>'department', 'designation', r->>'designation', 'location_id', loc));
      if sal and coalesce(nullif(r->>'salary', '')::numeric, 0) > 0 then pj := pj || jsonb_build_object('salary', jsonb_build_object('amount', (r->>'salary')::numeric, 'structure_id', st)); end if;
      if sal and nullif(r->>'account_no', '') is not null then
        pj := pj || jsonb_build_object('bank', jsonb_build_object('mode', 'bank', 'bank_name', r->>'bank_name', 'account_no', r->>'account_no', 'ifsc', upper(coalesce(r->>'ifsc', '')), 'holder', r->>'holder'));
      end if;
      eid := pay_save_employee(pj);
      ok := ok + 1;
    exception when others then
      errs := errs || jsonb_build_array(jsonb_build_object('row', i, 'name', r->>'name', 'error', sqlerrm));
    end;
  end loop;
  if not coalesce(p_commit, false) or jsonb_array_length(errs) > 0 then
    raise exception 'PYIMPORT%', jsonb_build_object('ok', ok, 'errors', errs, 'committed', false)::text using errcode = 'PY900';
  end if;
  return jsonb_build_object('ok', ok, 'errors', errs, 'committed', true);
end $$;

-- the dry run is the real import rolled back: same checks, nothing saved
create function pay_import_check(p_rows jsonb, p_commit boolean default false) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  return pay_import_employees(p_rows, p_commit);
exception when sqlstate 'PY900' then
  return substr(sqlerrm, 9)::jsonb;
end $$;

-- ---------- time ----------
-- Everyone's day (the attendance board). Refreshes the day first so it reflects the latest punches and marks.
create function pay_attendance_day(p_date date default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; d date; e record; mgr text; hr boolean;
begin
  tid := pay_tenant();
  hr := pay_perm('pay_time') or pay_perm('pay_view');
  mgr := pay_my_emp();
  if not hr and mgr is null then raise exception 'Your role does not allow this' using errcode = '42501'; end if;
  d := coalesce(p_date, pay_today(tid));
  for e in select x.id from pay_employees x where x.tenant_id = tid and x.status in ('active', 'notice', 'exited') and x.joined_on <= d and (x.last_day is null or x.last_day >= d)
           and (hr or pay_is_manager_of(x.id)) loop
    perform pay_att_compute(tid, e.id, d);
  end loop;
  return jsonb_build_object('date', d, 'holiday', (select name from pay_holidays where tenant_id = tid and hdate = d and location_id is null limit 1), 'rows',
    coalesce((select jsonb_agg(jsonb_build_object('employee_id', x.id, 'name', x.name, 'code', x.code, 'photo', x.photo, 'designation', j.designation, 'department', j.department,
      'mode', pay_att_mode(x), 'status', a.status, 'paid', a.paid, 'first_in', a.first_in, 'last_out', a.last_out, 'worked_mins', a.worked_mins, 'late_mins', a.late_mins,
      'ot_mins', a.ot_mins, 'flags', a.flags, 'leave', lt.name, 'shift', s.name, 'shift_start', s.start_time, 'shift_end', s.end_time, 'locked', a.locked_run is not null,
      'punches', (select count(*) from pay_punches pp where pp.employee_id = x.id and pp.voided_at is null and (pp.at at time zone pay_tz(tid))::date = d)) order by x.name)
      from pay_employees x
      left join lateral (select * from pay_jobs where employee_id = x.id and eff_from <= d order by eff_from desc limit 1) j on true
      left join pay_attendance a on a.employee_id = x.id and a.att_date = d
      left join pay_leave_types lt on lt.id = a.leave_type_id
      left join pay_shifts s on s.id = a.shift_id
      where x.tenant_id = tid and x.status in ('active', 'notice', 'exited') and x.joined_on <= d and (x.last_day is null or x.last_day >= d) and (hr or pay_is_manager_of(x.id))), '[]'));
end $$;

-- One person's month (HR, their manager, or themself)
create function pay_attendance_month(p_emp text, p_month text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; e pay_employees; f date; t date;
begin
  tid := pay_tenant();
  select * into e from pay_employees where id = p_emp and tenant_id = tid;
  if e.id is null then raise exception 'Employee not found'; end if;
  if not (pay_perm('pay_time') or pay_perm('pay_view') or pay_is_manager_of(e.id) or pay_my_emp() = e.id) then raise exception 'Your role does not allow this' using errcode = '42501'; end if;
  f := pay_month_from(p_month); t := pay_month_to(p_month);
  perform pay_att_refresh(tid, e.id, greatest(f, e.joined_on), least(t, coalesce(e.last_day, t), pay_today(tid) + 7));
  return jsonb_build_object('employee', jsonb_build_object('id', e.id, 'name', e.name, 'code', e.code, 'mode', pay_att_mode(e)), 'month', p_month,
    'days', coalesce((select jsonb_agg(jsonb_build_object('date', a.att_date, 'status', a.status, 'paid', a.paid, 'lop', a.lop, 'first_in', a.first_in, 'last_out', a.last_out,
      'worked_mins', a.worked_mins, 'late_mins', a.late_mins, 'ot_mins', a.ot_mins, 'flags', a.flags, 'leave', lt.name, 'locked', a.locked_run is not null,
      'holiday', pay_holiday(tid, e.id, a.att_date)) order by a.att_date)
      from pay_attendance a left join pay_leave_types lt on lt.id = a.leave_type_id where a.employee_id = e.id and a.att_date between f and t), '[]'),
    'punches', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'at', p.at, 'kind', p.kind, 'source', p.source, 'out_of_range', p.out_of_range, 'distance_m', p.distance_m,
      'voided', p.voided_at is not null, 'void_reason', p.void_reason, 'note', p.note) order by p.at)
      from pay_punches p where p.employee_id = e.id and p.at >= (f::timestamp at time zone pay_tz(tid)) - interval '6 hours' and p.at < ((t + 1)::timestamp at time zone pay_tz(tid)) + interval '18 hours'), '[]'),
    'requests', coalesce((select jsonb_agg(to_jsonb(r) - 'tenant_id' order by r.att_date) from pay_regularizations r where r.employee_id = e.id and r.att_date between f and t), '[]'));
end $$;

-- Everyone x every day of a month, as compact codes: P present, L late, H half, A absent, M missing out, V leave, h half leave,
-- O weekly off, F holiday, U upcoming, - not employed
create function pay_attendance_grid(p_month text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; f date; t date; e record; lim date;
begin
  tid := pay_guard('pay_view');
  f := pay_month_from(p_month); t := pay_month_to(p_month); lim := least(t, pay_today(tid) + 7);
  for e in select id, joined_on, last_day from pay_employees where tenant_id = tid and joined_on <= t and (last_day is null or last_day >= f) and status <> 'onboarding' loop
    if not exists (select 1 from pay_attendance where employee_id = e.id and att_date between f and lim having count(*) >= (least(lim, coalesce(e.last_day, lim)) - greatest(f, e.joined_on) + 1)) then
      perform pay_att_refresh(tid, e.id, greatest(f, e.joined_on), least(lim, coalesce(e.last_day, lim)));
    end if;
  end loop;
  return jsonb_build_object('month', p_month, 'days', t - f + 1, 'rows', coalesce((select jsonb_agg(jsonb_build_object('employee_id', x.id, 'name', x.name, 'code', x.code,
    'cells', (select string_agg(coalesce(case a.status when 'present' then 'P' when 'late' then 'L' when 'half' then 'H' when 'absent' then 'A' when 'missing' then 'M' when 'leave' then 'V'
                when 'half_leave' then 'h' when 'weekly_off' then 'O' when 'holiday' then 'F' when 'upcoming' then 'U' end, '-'), '' order by g.d)
              from generate_series(f, t, interval '1 day') g(d) left join pay_attendance a on a.employee_id = x.id and a.att_date = g.d::date),
    'present', (select count(*) from pay_attendance a where a.employee_id = x.id and a.att_date between f and t and a.status in ('present', 'late', 'missing')),
    'absent', (select count(*) from pay_attendance a where a.employee_id = x.id and a.att_date between f and t and a.status = 'absent'),
    'lop', (select coalesce(sum(lop), 0) from pay_attendance a where a.employee_id = x.id and a.att_date between f and t),
    'ot_hours', (select round(coalesce(sum(ot_mins), 0) / 60.0, 1) from pay_attendance a where a.employee_id = x.id and a.att_date between f and t)) order by x.name)
    from pay_employees x where x.tenant_id = tid and x.joined_on <= t and (x.last_day is null or x.last_day >= f) and x.status <> 'onboarding'), '[]'));
end $$;

-- HR marks a day (present, half, absent, weekly_off, holiday; 'auto' removes the mark) or sets the in/out times.
create function pay_mark_attendance(p_emp text, p_date date, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; e pay_employees; tz text; st text;
begin
  tid := pay_guard('pay_time');
  select * into e from pay_employees where id = p_emp and tenant_id = tid;
  if e.id is null then raise exception 'Employee not found'; end if;
  if exists (select 1 from pay_attendance where employee_id = e.id and att_date = p_date and locked_run is not null) then
    raise exception 'Payroll for % is finalised: add an adjustment in the next payroll instead', to_char(p_date, 'DD Mon');
  end if;
  if p_date < e.joined_on or (e.last_day is not null and p_date > e.last_day) then raise exception 'Not employed on that day'; end if;
  tz := pay_tz(tid); st := nullif(p->>'status', '');
  if st is not null and st not in ('present', 'half', 'absent', 'weekly_off', 'holiday', 'auto') then raise exception 'Unknown status %', st; end if;
  if st is null and nullif(p->>'in', '') is null then raise exception 'Pick a status or enter the in time'; end if;
  insert into pay_att_overrides (tenant_id, employee_id, att_date, status, in_at, out_at, source, reason, created_by)
  values (tid, e.id, p_date, st, case when st is null then ((p_date::timestamp + (p->>'in')::time) at time zone tz) end,
          case when st is null and nullif(p->>'out', '') is not null then ((p_date::timestamp + (p->>'out')::time + case when (p->>'out')::time <= (p->>'in')::time then interval '1 day' else interval '0' end) at time zone tz) end,
          'manual', pay_clean(p->>'reason', 300), app_uid());
  perform pay_att_compute(tid, e.id, p_date);
  perform pay_audit_log(tid, 'mark', 'attendance', e.id || ':' || p_date, e.id, null, p, pay_clean(p->>'reason', 300));
  return (select to_jsonb(a) - 'tenant_id' from pay_attendance a where employee_id = e.id and att_date = p_date);
end $$;

-- rows: [{employee_id, status}] for one date
create function pay_mark_bulk(p_date date, p_rows jsonb, p_reason text default null) returns int language plpgsql security definer set search_path = public as $$
declare r jsonb; n int := 0;
begin
  perform pay_guard('pay_time');
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]')) loop
    perform pay_mark_attendance(r->>'employee_id', p_date, jsonb_build_object('status', r->>'status', 'reason', coalesce(p_reason, 'Marked for everyone')));
    n := n + 1;
  end loop;
  return n;
end $$;

create function pay_add_punch(p_emp text, p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid; pid uuid; at_ timestamptz; d date;
begin
  tid := pay_guard('pay_time');
  if not exists (select 1 from pay_employees where id = p_emp and tenant_id = tid) then raise exception 'Employee not found'; end if;
  at_ := (p->>'at')::timestamptz;
  if at_ is null then raise exception 'Enter the time'; end if;
  if at_ > now() + interval '5 minutes' then raise exception 'A clock-in cannot be in the future'; end if;
  if pay_clean(p->>'note', 200) is null then raise exception 'Say why this clock-in is being added'; end if;
  insert into pay_punches (tenant_id, employee_id, at, kind, source, note, created_by)
  values (tid, p_emp, at_, coalesce(nullif(p->>'kind', ''), 'auto'), 'admin', pay_clean(p->>'note', 200), app_uid()) returning id into pid;
  d := (at_ at time zone pay_tz(tid))::date;
  perform pay_att_refresh(tid, p_emp, d - 1, d);
  perform pay_audit_log(tid, 'add', 'punch', pid::text, p_emp, null, p, pay_clean(p->>'note', 200));
  return pid;
end $$;

create function pay_void_punch(p_id uuid, p_reason text) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid; pp pay_punches; d date;
begin
  tid := pay_guard('pay_time');
  select * into pp from pay_punches where id = p_id and tenant_id = tid;
  if pp.id is null then raise exception 'Clock-in not found'; end if;
  d := (pp.at at time zone pay_tz(tid))::date;
  if exists (select 1 from pay_attendance where employee_id = pp.employee_id and att_date between d - 1 and d and locked_run is not null) then
    raise exception 'Payroll for that day is finalised; it cannot change now';
  end if;
  update pay_punches set voided_at = now(), voided_by = app_uid(), void_reason = pay_clean(p_reason, 200) where id = pp.id;
  perform pay_att_refresh(tid, pp.employee_id, d - 1, d);
  perform pay_audit_log(tid, 'void', 'punch', pp.id::text, pp.employee_id, jsonb_build_object('at', pp.at), null, p_reason);
end $$;

-- rows: [{employee_id, date, shift_id | off: true | clear: true}]
create function pay_save_roster(p_rows jsonb) returns int language plpgsql security definer set search_path = public as $$
declare tid uuid; r jsonb; n int := 0; d date;
begin
  tid := pay_guard('pay_time');
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]')) loop
    d := (r->>'date')::date;
    if not exists (select 1 from pay_employees where id = r->>'employee_id' and tenant_id = tid) then raise exception 'Employee not found'; end if;
    if coalesce((r->>'clear')::boolean, false) then delete from pay_roster where employee_id = r->>'employee_id' and att_date = d;
    else
      insert into pay_roster (tenant_id, employee_id, att_date, shift_id, off) values (tid, r->>'employee_id', d, nullif(r->>'shift_id', '')::uuid, coalesce((r->>'off')::boolean, false))
      on conflict (employee_id, att_date) do update set shift_id = excluded.shift_id, off = excluded.off;
    end if;
    if d <= pay_today(tid) then perform pay_att_compute(tid, r->>'employee_id', d); end if;
    n := n + 1;
  end loop;
  perform pay_audit_log(tid, 'save', 'roster', null, null, null, p_rows, null);
  return n;
end $$;

create function pay_roster_week(p_from date) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := pay_guard('pay_view');
  return jsonb_build_object('from', p_from, 'rows', coalesce((select jsonb_agg(jsonb_build_object('employee_id', x.id, 'name', x.name, 'days',
    (select jsonb_agg(jsonb_build_object('date', g.d::date, 'shift_id', coalesce(r.shift_id, case when r.off then null else (pay_job_at(x.id, g.d::date)).shift_id end),
       'off', coalesce(r.off, extract(dow from g.d)::int = any(pay_weekly_off(tid, x.id, g.d::date))), 'custom', r.employee_id is not null) order by g.d)
     from generate_series(p_from, p_from + 6, interval '1 day') g(d) left join pay_roster r on r.employee_id = x.id and r.att_date = g.d::date)) order by x.name)
    from pay_employees x where x.tenant_id = tid and x.status in ('active', 'notice')), '[]'));
end $$;

-- ---------- leave and corrections: decisions ----------
-- Checks a leave and returns the days it uses. Refuses overlaps, days outside employment, days in a finalised payroll and,
-- for paid leave without overdraft, more than the balance left after other pending requests.
create function pay_leave_validate(tid uuid, emp text, lt uuid, p_from date, p_to date, p_half text, p_exclude uuid default null) returns numeric
language plpgsql stable security definer set search_path = public as $$
declare e pay_employees; t pay_leave_types; days numeric; bal numeric; pend numeric;
begin
  select * into e from pay_employees where id = emp and tenant_id = tid;
  select * into t from pay_leave_types where id = lt and tenant_id = tid;
  if e.id is null or t.id is null then raise exception 'Pick the leave type'; end if;
  if not t.active then raise exception '% is switched off', t.name; end if;
  if t.gender is not null and t.gender is distinct from e.gender then raise exception '% is not available for this person', t.name; end if;
  if coalesce(p_half, 'none') <> 'none' and not t.half_day then raise exception '% cannot be taken as half a day', t.name; end if;
  if p_from < e.joined_on or (e.last_day is not null and p_to > e.last_day) then raise exception 'The leave must be within the employment dates'; end if;
  if exists (select 1 from pay_leave_requests q where q.employee_id = emp and q.status in ('pending', 'approved') and q.id is distinct from p_exclude
             and q.from_date <= p_to and q.to_date >= p_from and (q.half = 'none' or coalesce(p_half, 'none') = 'none' or q.half = p_half)) then
    raise exception 'There is already a leave on these dates';
  end if;
  if exists (select 1 from pay_attendance where employee_id = emp and att_date between p_from and p_to and locked_run is not null) then
    raise exception 'Payroll for these dates is finalised: the leave cannot change them now';
  end if;
  days := pay_leave_days(tid, emp, lt, p_from, p_to, p_half);
  if days <= 0 then raise exception 'These dates are all days off already'; end if;
  if t.paid and not t.allow_negative then
    bal := pay_leave_balance(emp, lt);
    select coalesce(sum(q.days), 0) into pend from pay_leave_requests q where q.employee_id = emp and q.leave_type_id = lt and q.status = 'pending' and q.id is distinct from p_exclude;
    if days > bal - pend then raise exception 'Not enough % left: % day(s) available%', t.name, pay_qty(greatest(bal - pend, 0)), case when pend > 0 then ' after other pending requests' else '' end; end if;
  end if;
  return days;
end $$;

create function pay_leave_decide(p_id uuid, p_approve boolean, p_note text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; q pay_leave_requests; v_days numeric;
begin
  tid := pay_tenant();
  select * into q from pay_leave_requests where id = p_id and tenant_id = tid for update;
  if q.id is null then raise exception 'Leave request not found'; end if;
  if not (pay_perm('pay_time') or pay_is_manager_of(q.employee_id)) then raise exception 'Your role does not allow this' using errcode = '42501'; end if;
  if q.employee_id = pay_my_emp() and (me()->>'role') <> 'owner' then raise exception 'You cannot decide your own leave'; end if;
  if q.status <> 'pending' then raise exception 'This request was already %', q.status; end if;
  if p_approve then
    v_days := pay_leave_validate(tid, q.employee_id, q.leave_type_id, q.from_date, q.to_date, q.half, q.id);
    update pay_leave_requests set status = 'approved', days = v_days, decided_by = app_uid(), decided_at = now(), decision_note = pay_clean(p_note, 300) where id = q.id;
    insert into pay_leave_ledger (tenant_id, employee_id, leave_type_id, on_date, kind, days, request_id, note, created_by)
    values (tid, q.employee_id, q.leave_type_id, q.from_date, 'debit', -v_days, q.id, 'Leave ' || to_char(q.from_date, 'DD Mon') || case when q.to_date <> q.from_date then ' - ' || to_char(q.to_date, 'DD Mon') else '' end, app_uid());
    perform pay_att_refresh(tid, q.employee_id, q.from_date, least(q.to_date, pay_today(tid) + 62));
  else
    update pay_leave_requests set status = 'rejected', decided_by = app_uid(), decided_at = now(), decision_note = pay_clean(p_note, 300) where id = q.id;
  end if;
  perform pay_audit_log(tid, case when p_approve then 'approve' else 'reject' end, 'leave', q.id::text, q.employee_id, null, null, p_note);
  return (select to_jsonb(x) - 'tenant_id' from pay_leave_requests x where id = q.id);
end $$;

create function pay_leave_cancel(p_id uuid, p_reason text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; q pay_leave_requests; mine boolean;
begin
  tid := pay_tenant();
  select * into q from pay_leave_requests where id = p_id and tenant_id = tid for update;
  if q.id is null then raise exception 'Leave request not found'; end if;
  mine := pay_my_emp() = q.employee_id;
  if not (pay_perm('pay_time') or mine or pay_is_manager_of(q.employee_id)) then raise exception 'Your role does not allow this' using errcode = '42501'; end if;
  if q.status not in ('pending', 'approved') then raise exception 'This request is already %', q.status; end if;
  if q.status = 'approved' then
    if mine and not pay_perm('pay_time') and q.from_date <= pay_today(tid) then raise exception 'Leave that has started can only be cancelled by your manager'; end if;
    if exists (select 1 from pay_attendance where employee_id = q.employee_id and att_date between q.from_date and q.to_date and locked_run is not null) then
      raise exception 'Payroll for these dates is finalised; the leave cannot be cancelled now';
    end if;
    insert into pay_leave_ledger (tenant_id, employee_id, leave_type_id, on_date, kind, days, request_id, note, created_by)
    values (tid, q.employee_id, q.leave_type_id, q.from_date, 'reverse', q.days, q.id, 'Leave cancelled', app_uid());
  end if;
  update pay_leave_requests set status = 'cancelled', decided_by = coalesce(decided_by, app_uid()), decided_at = coalesce(decided_at, now()),
    decision_note = coalesce(pay_clean(p_reason, 300), decision_note) where id = q.id;
  if q.status = 'approved' then perform pay_att_refresh(tid, q.employee_id, q.from_date, least(q.to_date, pay_today(tid) + 62)); end if;
  perform pay_audit_log(tid, 'cancel', 'leave', q.id::text, q.employee_id, null, null, p_reason);
  return (select to_jsonb(x) - 'tenant_id' from pay_leave_requests x where id = q.id);
end $$;

-- HR adds a leave for someone (approved straight away unless p.pending)
create function pay_leave_add(p_emp text, p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid; days numeric; qid uuid; f date; t date; h text;
begin
  tid := pay_guard('pay_time');
  f := (p->>'from')::date; t := coalesce(nullif(p->>'to', '')::date, f); h := coalesce(nullif(p->>'half', ''), 'none');
  if f is null then raise exception 'Pick the dates'; end if;
  days := pay_leave_validate(tid, p_emp, (p->>'leave_type_id')::uuid, f, t, h, null);
  insert into pay_leave_requests (tenant_id, employee_id, leave_type_id, from_date, to_date, half, days, reason, status, created_by)
  values (tid, p_emp, (p->>'leave_type_id')::uuid, f, t, h, days, pay_clean(p->>'reason', 300), 'pending', app_uid()) returning id into qid;
  if not coalesce((p->>'pending')::boolean, false) then
    update pay_leave_requests set status = 'approved', decided_by = app_uid(), decided_at = now(), decision_note = 'Added by HR' where id = qid;
    insert into pay_leave_ledger (tenant_id, employee_id, leave_type_id, on_date, kind, days, request_id, note, created_by)
    values (tid, p_emp, (p->>'leave_type_id')::uuid, f, 'debit', -days, qid, 'Leave added by HR', app_uid());
    perform pay_att_refresh(tid, p_emp, f, least(t, pay_today(tid) + 62));
  end if;
  perform pay_audit_log(tid, 'add', 'leave', qid::text, p_emp, null, p, null);
  return qid;
end $$;

-- opening balances and corrections
create function pay_leave_adjust(p_emp text, p_type uuid, p_days numeric, p_note text, p_opening boolean default false) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := pay_guard('pay_time');
  if not exists (select 1 from pay_employees where id = p_emp and tenant_id = tid) or not exists (select 1 from pay_leave_types where id = p_type and tenant_id = tid) then raise exception 'Not found'; end if;
  if coalesce(p_days, 0) = 0 then raise exception 'Enter the days to add or remove'; end if;
  if pay_clean(p_note, 300) is null then raise exception 'Say why the balance changes'; end if;
  insert into pay_leave_ledger (tenant_id, employee_id, leave_type_id, on_date, kind, days, note, created_by)
  values (tid, p_emp, p_type, pay_today(tid), case when p_opening then 'opening' else 'adjust' end, p_days, pay_clean(p_note, 300), app_uid());
  perform pay_audit_log(tid, 'adjust', 'leave_balance', p_type::text, p_emp, null, jsonb_build_object('days', p_days), p_note);
end $$;

create function pay_leave_ledger_list(p_emp text, p_type uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := pay_tenant();
  if not (pay_perm('pay_view') or pay_my_emp() = p_emp or pay_is_manager_of(p_emp)) then raise exception 'Your role does not allow this' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('on_date', on_date, 'kind', kind, 'days', days, 'note', note) order by on_date desc, id desc)
    from pay_leave_ledger where tenant_id = tid and employee_id = p_emp and leave_type_id = p_type), '[]');
end $$;

create function pay_reg_decide(p_id uuid, p_approve boolean, p_note text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; r pay_regularizations;
begin
  tid := pay_tenant();
  select * into r from pay_regularizations where id = p_id and tenant_id = tid for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if not (pay_perm('pay_time') or pay_is_manager_of(r.employee_id)) then raise exception 'Your role does not allow this' using errcode = '42501'; end if;
  if r.employee_id = pay_my_emp() and (me()->>'role') <> 'owner' then raise exception 'You cannot decide your own request'; end if;
  if r.status <> 'pending' then raise exception 'This request was already %', r.status; end if;
  if p_approve then
    if exists (select 1 from pay_attendance where employee_id = r.employee_id and att_date = r.att_date and locked_run is not null) then
      raise exception 'Payroll for that day is finalised: add an adjustment in the next payroll instead';
    end if;
    insert into pay_att_overrides (tenant_id, employee_id, att_date, in_at, out_at, source, reason, request_id, created_by)
    values (tid, r.employee_id, r.att_date, r.in_at, r.out_at, 'regularization', r.reason, r.id, app_uid());
    perform pay_att_compute(tid, r.employee_id, r.att_date);
  end if;
  update pay_regularizations set status = case when p_approve then 'approved' else 'rejected' end, decided_by = app_uid(), decided_at = now(), decision_note = pay_clean(p_note, 300) where id = r.id;
  perform pay_audit_log(tid, case when p_approve then 'approve' else 'reject' end, 'regularization', r.id::text, r.employee_id, null, null, p_note);
  return (select to_jsonb(x) - 'tenant_id' from pay_regularizations x where id = r.id);
end $$;

-- Everything waiting for a decision that this person may decide: leave, corrections (HR or the team's manager),
-- loans, claims and bank changes (salary roles only).
create function pay_list_requests(p jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; tm boolean; sal boolean; appr boolean; st text; res jsonb := '[]'; emp text;
begin
  tid := pay_tenant();
  emp := nullif(p->>'employee_id', '');
  tm := pay_perm('pay_time'); sal := pay_perm('pay_salary'); appr := pay_perm('pay_approve');
  st := coalesce(nullif(p->>'status', ''), 'pending');
  res := res || coalesce((select jsonb_agg(jsonb_build_object('type', 'leave', 'id', q.id, 'employee_id', q.employee_id, 'name', e.name, 'status', q.status, 'created_at', q.created_at,
      'title', lt.name || ': ' || pay_qty(q.days) || ' day' || case when q.days = 1 then '' else 's' end, 'from', q.from_date, 'to', q.to_date, 'half', q.half, 'reason', q.reason,
      'balance', pay_leave_balance(q.employee_id, q.leave_type_id), 'note', q.decision_note) order by q.created_at desc)
    from pay_leave_requests q join pay_employees e on e.id = q.employee_id join pay_leave_types lt on lt.id = q.leave_type_id
    where q.tenant_id = tid and (st = 'all' or q.status = st) and (tm or pay_is_manager_of(q.employee_id)) and (emp is null or q.employee_id = emp)), '[]');
  res := res || coalesce((select jsonb_agg(jsonb_build_object('type', 'correction', 'id', r.id, 'employee_id', r.employee_id, 'name', e.name, 'status', r.status, 'created_at', r.created_at,
      'title', 'Attendance correction for ' || to_char(r.att_date, 'DD Mon'), 'from', r.att_date, 'in', r.in_at, 'out', r.out_at, 'reason', r.reason, 'note', r.decision_note) order by r.created_at desc)
    from pay_regularizations r join pay_employees e on e.id = r.employee_id
    where r.tenant_id = tid and (st = 'all' or r.status = st) and (tm or pay_is_manager_of(r.employee_id)) and (emp is null or r.employee_id = emp)), '[]');
  if appr or sal then
    res := res || coalesce((select jsonb_agg(jsonb_build_object('type', 'loan', 'id', l.id, 'employee_id', l.employee_id, 'name', e.name, 'status', l.status, 'created_at', l.created_at,
        'title', case when l.kind = 'advance' then 'Salary advance ' else 'Loan ' end || pay_num(l.amount), 'amount', l.amount, 'emi', l.emi, 'reason', l.reason) order by l.created_at desc)
      from pay_loans l join pay_employees e on e.id = l.employee_id where l.tenant_id = tid and ((st = 'pending' and l.status = 'requested') or st = 'all') and (emp is null or l.employee_id = emp)), '[]');
    res := res || coalesce((select jsonb_agg(jsonb_build_object('type', 'claim', 'id', c.id, 'employee_id', c.employee_id, 'name', e.name, 'status', c.status, 'created_at', c.created_at,
        'title', c.category || ' ' || pay_num(c.amount), 'amount', c.amount, 'from', c.claim_date, 'reason', c.description, 'attachment', c.attachment) order by c.created_at desc)
      from pay_claims c join pay_employees e on e.id = c.employee_id where c.tenant_id = tid and ((st = 'pending' and c.status = 'submitted') or st = 'all') and (emp is null or c.employee_id = emp)), '[]');
  end if;
  if sal then
    res := res || coalesce((select jsonb_agg(jsonb_build_object('type', 'bank', 'id', b.id, 'employee_id', b.employee_id, 'name', e.name, 'status', b.status, 'created_at', b.created_at,
        'title', 'New payout details: ' || coalesce(b.bank_name, b.mode) || ' ' || coalesce(pay_mask(b.account_no), b.upi, ''), 'ifsc', b.ifsc) order by b.created_at desc)
      from pay_bank_accounts b join pay_employees e on e.id = b.employee_id where b.tenant_id = tid and b.status = 'pending' and st in ('pending', 'all') and (emp is null or b.employee_id = emp)), '[]');
  end if;
  return res;
end $$;

-- ---------- loans and advances ----------
-- HR gives a loan or advance (active straight away). p: {employee_id, kind, amount, emi, start_month, reason, disbursed_on, disbursed_via: cash|bank|none, pay_account}
create function pay_save_loan(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid; lid uuid; amt numeric; v_emi numeric; sm text; via text; d date; jid uuid;
begin
  tid := pay_guard('pay_salary');
  if not pay_perm('pay_approve') then raise exception 'Your role does not allow giving loans' using errcode = '42501'; end if;
  if not exists (select 1 from pay_employees where id = p->>'employee_id' and tenant_id = tid and status in ('active', 'notice', 'onboarding')) then raise exception 'Pick a current employee'; end if;
  amt := (p->>'amount')::numeric; if coalesce(amt, 0) <= 0 then raise exception 'Enter the amount'; end if;
  v_emi := coalesce(nullif(p->>'emi', '')::numeric, amt); if v_emi <= 0 then raise exception 'Enter how much to recover each month'; end if;
  sm := coalesce(nullif(p->>'start_month', ''), pay_month_of(pay_today(tid)));
  if sm !~ '^\d{4}-(0[1-9]|1[0-2])$' then raise exception 'Pick the first month to recover it'; end if;
  via := coalesce(nullif(p->>'disbursed_via', ''), 'cash'); d := coalesce(nullif(p->>'disbursed_on', '')::date, pay_today(tid));
  insert into pay_loans (tenant_id, employee_id, kind, amount, emi, start_month, status, reason, requested_by, decided_by, decided_at, disbursed_on, disbursed_via)
  values (tid, p->>'employee_id', coalesce(nullif(p->>'kind', ''), 'advance'), amt, least(v_emi, amt), sm, 'active', pay_clean(p->>'reason', 300), app_uid(), app_uid(), now(), d, via)
  returning id into lid;
  insert into pay_loan_ledger (tenant_id, loan_id, on_date, kind, amount, note, created_by) values (tid, lid, d, 'disburse', amt, 'Given', app_uid());
  if via in ('cash', 'bank') then
    jid := pay_journal_add(tid, 'payment', d, 'loan', lid, 'Staff ' || coalesce(nullif(p->>'kind', ''), 'advance') || ' given',
      jsonb_build_array(jsonb_build_object('key', 'staff_advances', 'dr', amt), jsonb_build_object('key', case when nullif(p->>'pay_account', '') is not null then 'acct:' || (p->>'pay_account') else via end, 'cr', amt)));
    perform pay_acc_post_journal(jid);
  end if;
  perform pay_audit_log(tid, 'create', 'loan', lid::text, p->>'employee_id', null, p, null);
  return lid;
end $$;

create function pay_loan_decide(p_id uuid, p_approve boolean, p jsonb default '{}') returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; l pay_loans; d date; via text; jid uuid;
begin
  tid := pay_guard('pay_approve');
  select * into l from pay_loans where id = p_id and tenant_id = tid for update;
  if l.id is null then raise exception 'Not found'; end if;
  if l.status <> 'requested' then raise exception 'This request was already decided'; end if;
  if p_approve then
    d := coalesce(nullif(p->>'disbursed_on', '')::date, pay_today(tid)); via := coalesce(nullif(p->>'disbursed_via', ''), 'cash');
    update pay_loans set status = 'active', amount = coalesce(nullif(p->>'amount', '')::numeric, amount), emi = least(coalesce(nullif(p->>'emi', '')::numeric, emi), coalesce(nullif(p->>'amount', '')::numeric, amount)),
      start_month = coalesce(nullif(p->>'start_month', ''), start_month), decided_by = app_uid(), decided_at = now(), decision_note = pay_clean(p->>'note', 300),
      disbursed_on = d, disbursed_via = via where id = l.id returning * into l;
    insert into pay_loan_ledger (tenant_id, loan_id, on_date, kind, amount, note, created_by) values (tid, l.id, d, 'disburse', l.amount, 'Given', app_uid());
    if via in ('cash', 'bank') then
      jid := pay_journal_add(tid, 'payment', d, 'loan', l.id, 'Staff ' || l.kind || ' given',
        jsonb_build_array(jsonb_build_object('key', 'staff_advances', 'dr', l.amount), jsonb_build_object('key', case when nullif(p->>'pay_account', '') is not null then 'acct:' || (p->>'pay_account') else via end, 'cr', l.amount)));
      perform pay_acc_post_journal(jid);
    end if;
  else
    update pay_loans set status = 'rejected', decided_by = app_uid(), decided_at = now(), decision_note = pay_clean(p->>'note', 300) where id = l.id;
  end if;
  perform pay_audit_log(tid, case when p_approve then 'approve' else 'reject' end, 'loan', l.id::text, l.employee_id, null, p, null);
  return (select to_jsonb(x) - 'tenant_id' from pay_loans x where id = l.id);
end $$;

-- p: {emi, start_month, skip_month, unskip_month, waive: true (write off what is left, with note), close}
create function pay_loan_update(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; l pay_loans; outst numeric;
begin
  tid := pay_guard('pay_approve');
  select * into l from pay_loans where id = p_id and tenant_id = tid for update;
  if l.id is null then raise exception 'Not found'; end if;
  if l.status <> 'active' then raise exception 'Only an active loan can change'; end if;
  select coalesce(sum(amount), 0) into outst from pay_loan_ledger where loan_id = l.id;
  if p ? 'emi' then if (p->>'emi')::numeric <= 0 then raise exception 'The monthly recovery must be more than zero'; end if; update pay_loans set emi = (p->>'emi')::numeric where id = l.id; end if;
  if p ? 'start_month' then update pay_loans set start_month = p->>'start_month' where id = l.id; end if;
  if nullif(p->>'skip_month', '') is not null then update pay_loans set skip_months = array(select distinct unnest(skip_months || array[p->>'skip_month'])) where id = l.id; end if;
  if nullif(p->>'unskip_month', '') is not null then update pay_loans set skip_months = array_remove(skip_months, p->>'unskip_month') where id = l.id; end if;
  if coalesce((p->>'waive')::boolean, false) and outst > 0 then
    if pay_clean(p->>'note', 300) is null then raise exception 'Say why the rest is written off'; end if;
    insert into pay_loan_ledger (tenant_id, loan_id, on_date, kind, amount, note, created_by) values (tid, l.id, pay_today(tid), 'waive', -outst, pay_clean(p->>'note', 300), app_uid());
    perform pay_acc_post_journal(pay_journal_add(tid, 'accrual', pay_today(tid), 'loan', l.id, 'Staff ' || l.kind || ' written off',
      jsonb_build_array(jsonb_build_object('key', 'salary_expense', 'dr', outst), jsonb_build_object('key', 'staff_advances', 'cr', outst))));
    update pay_loans set status = 'closed' where id = l.id;
  end if;
  if coalesce((p->>'close')::boolean, false) then
    if outst > 0 then raise exception 'There is still % to recover; write it off or recover it first', pay_num(outst); end if;
    update pay_loans set status = 'closed' where id = l.id;
  end if;
  perform pay_audit_log(tid, 'update', 'loan', l.id::text, l.employee_id, null, p, pay_clean(p->>'note', 300));
  return (select to_jsonb(x) - 'tenant_id' || jsonb_build_object('outstanding', (select coalesce(sum(amount), 0) from pay_loan_ledger where loan_id = x.id)) from pay_loans x where id = l.id);
end $$;

create function pay_list_loans(p jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := pay_guard_pay();
  return coalesce((select jsonb_agg(to_jsonb(l) - 'tenant_id' || jsonb_build_object('name', e.name, 'code', e.code,
      'outstanding', coalesce((select sum(amount) from pay_loan_ledger g where g.loan_id = l.id), 0),
      'recovered', coalesce((select -sum(amount) from pay_loan_ledger g where g.loan_id = l.id and g.kind = 'recover'), 0),
      'ledger', (select coalesce(jsonb_agg(jsonb_build_object('on_date', g.on_date, 'kind', g.kind, 'amount', g.amount, 'note', g.note) order by g.on_date, g.id), '[]') from pay_loan_ledger g where g.loan_id = l.id))
      order by (l.status = 'active') desc, l.created_at desc)
    from pay_loans l join pay_employees e on e.id = l.employee_id
    where l.tenant_id = tid and (nullif(p->>'status', '') is null or l.status = p->>'status') and (nullif(p->>'employee_id', '') is null or l.employee_id = p->>'employee_id')), '[]');
end $$;

-- ---------- expense claims ----------
create function pay_claim_decide(p_id uuid, p_approve boolean, p jsonb default '{}') returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; c pay_claims; amt numeric;
begin
  tid := pay_guard('pay_approve');
  select * into c from pay_claims where id = p_id and tenant_id = tid for update;
  if c.id is null then raise exception 'Claim not found'; end if;
  if c.status <> 'submitted' then raise exception 'This claim was already %', c.status; end if;
  if c.employee_id = pay_my_emp() and (me()->>'role') <> 'owner' then raise exception 'You cannot approve your own claim'; end if;
  amt := coalesce(nullif(p->>'amount', '')::numeric, c.amount);
  if p_approve and (amt <= 0 or amt > c.amount) then raise exception 'The approved amount must be between 1 and %', pay_num(c.amount); end if;
  update pay_claims set status = case when p_approve then 'approved' else 'rejected' end, approved_amount = case when p_approve then amt end,
    decided_by = app_uid(), decided_at = now(), decision_note = pay_clean(p->>'note', 300) where id = c.id;
  perform pay_audit_log(tid, case when p_approve then 'approve' else 'reject' end, 'claim', c.id::text, c.employee_id, null, p, null);
  return (select to_jsonb(x) - 'tenant_id' from pay_claims x where id = c.id);
end $$;

-- pay an approved claim now, outside payroll
create function pay_claim_pay(p_id uuid, p jsonb default '{}') returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; c pay_claims; d date; jid uuid;
begin
  tid := pay_guard('pay_pay');
  select * into c from pay_claims where id = p_id and tenant_id = tid for update;
  if c.id is null then raise exception 'Claim not found'; end if;
  if c.status <> 'approved' then raise exception 'Only an approved claim can be paid'; end if;
  if c.run_id is not null and exists (select 1 from pay_runs where id = c.run_id and status not in ('cancelled')) then raise exception 'This claim is already in a payroll'; end if;
  d := coalesce(nullif(p->>'paid_on', '')::date, pay_today(tid));
  update pay_claims set status = 'paid', paid_on = d where id = c.id;
  jid := pay_journal_add(tid, 'payment', d, 'claim', c.id, 'Expense claim paid: ' || c.category,
    jsonb_build_array(jsonb_build_object('key', 'reimb_expense', 'dr', coalesce(c.approved_amount, c.amount)),
                      jsonb_build_object('key', case when nullif(p->>'pay_account', '') is not null then 'acct:' || (p->>'pay_account') else coalesce(nullif(p->>'via', ''), 'cash') end, 'cr', coalesce(c.approved_amount, c.amount))));
  perform pay_acc_post_journal(jid);
  perform pay_audit_log(tid, 'pay', 'claim', c.id::text, c.employee_id, null, p, null);
  return (select to_jsonb(x) - 'tenant_id' from pay_claims x where id = c.id);
end $$;

create function pay_save_claim(p_emp text, p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare tid uuid; cid uuid;
begin
  tid := pay_guard('pay_approve');
  if not exists (select 1 from pay_employees where id = p_emp and tenant_id = tid) then raise exception 'Employee not found'; end if;
  if coalesce((p->>'amount')::numeric, 0) <= 0 then raise exception 'Enter the amount'; end if;
  insert into pay_claims (tenant_id, employee_id, claim_date, category, amount, approved_amount, description, attachment, status, decided_by, decided_at, created_by)
  values (tid, p_emp, coalesce(nullif(p->>'date', '')::date, pay_today(tid)), coalesce(pay_clean(p->>'category', 60), 'Other'), (p->>'amount')::numeric, (p->>'amount')::numeric,
          pay_clean(p->>'description', 300), nullif(p->>'attachment', ''), 'approved', app_uid(), now(), app_uid()) returning id into cid;
  perform pay_audit_log(tid, 'create', 'claim', cid::text, p_emp, null, p, null);
  return cid;
end $$;

create function pay_list_claims(p jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := pay_guard_pay();
  return coalesce((select jsonb_agg(to_jsonb(c) - 'tenant_id' || jsonb_build_object('name', e.name, 'code', e.code, 'run', r.number) order by c.created_at desc)
    from pay_claims c join pay_employees e on e.id = c.employee_id left join pay_runs r on r.id = c.run_id
    where c.tenant_id = tid and (nullif(p->>'status', '') is null or c.status = p->>'status') and (nullif(p->>'employee_id', '') is null or c.employee_id = p->>'employee_id')), '[]');
end $$;

-- ---------- tax declarations ----------
create function pay_tax_decl_save(tid uuid, emp text, p jsonb, by_hr boolean) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_fy text; it jsonb := '{}'; k text;
begin
  v_fy := coalesce(nullif(p->>'fy', ''), pay_fy_label(pay_fy_start(tid, pay_today(tid))));
  if v_fy !~ '^\d{4}-\d{2}$' then raise exception 'Unknown financial year'; end if;
  if coalesce(p->>'regime', 'new') not in ('new', 'old') then raise exception 'Pick the new or the old tax regime'; end if;
  foreach k in array array['rent_monthly', 'sec80c', 'sec80d', 'sec80ccd1b', 'home_loan_interest', 'other_deductions', 'prev_income', 'prev_tds'] loop
    if nullif(p->'items'->>k, '') is not null then
      if (p->'items'->>k)::numeric < 0 then raise exception 'Amounts cannot be negative'; end if;
      it := it || jsonb_build_object(k, (p->'items'->>k)::numeric);
    end if;
  end loop;
  if (p->'items'->>'metro') is not null then it := it || jsonb_build_object('metro', (p->'items'->>'metro')::boolean); end if;
  insert into pay_tax_decl (tenant_id, employee_id, fy, regime, items, status, updated_by, updated_at)
  values (tid, emp, v_fy, coalesce(p->>'regime', 'new'), it, case when by_hr then 'approved' else 'submitted' end, app_uid(), now())
  on conflict (employee_id, fy) do update set regime = excluded.regime, items = excluded.items, status = excluded.status, updated_by = app_uid(), updated_at = now();
  perform pay_audit_log(tid, 'save', 'tax_declaration', v_fy, emp, null, p, null);
  return (select to_jsonb(d) - 'tenant_id' from pay_tax_decl d where employee_id = emp and d.fy = v_fy);
end $$;

create function pay_save_tax(p_emp text, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := pay_guard('pay_salary');
  if not exists (select 1 from pay_employees where id = p_emp and tenant_id = tid) then raise exception 'Employee not found'; end if;
  return pay_tax_decl_save(tid, p_emp, p, true);
end $$;

-- What this year's tax looks like now (latest salary as the regular monthly pay), without a payroll.
create function pay_tax_projection(tid uuid, emp text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare e pay_employees; s pay_salaries; b jsonb; ru pay_runs; reg numeric := 0; bas numeric := 0; hra numeric := 0; k text; c pay_components;
begin
  select * into e from pay_employees where id = emp and tenant_id = tid;
  s := pay_salary_at(emp, pay_today(tid));
  if s.id is null then return jsonb_build_object('note', 'No salary set'); end if;
  b := pay_salary_breakup(tid, s, null);
  for k in select jsonb_object_keys(b->'lines') loop
    select * into c from pay_components where tenant_id = tid and code = k;
    if c.kind = 'earning' and c.taxable then reg := reg + (b->'lines'->>k)::numeric; end if;
    if c.is_basic then bas := bas + (b->'lines'->>k)::numeric; end if;
    if k = 'HRA' then hra := hra + (b->'lines'->>k)::numeric; end if;
  end loop;
  ru.id := gen_random_uuid(); ru.kind := 'regular'; ru.month := pay_month_of(pay_today(tid));
  if exists (select 1 from pay_run_items i join pay_runs r on r.id = i.run_id where i.employee_id = emp and r.kind in ('regular', 'legacy') and r.month = ru.month and r.status in ('finalized', 'paid', 'locked')) then
    ru.month := pay_month_add(ru.month, 1);   -- this month is already paid: project from the next one
  end if;
  ru.period_from := pay_month_from(ru.month); ru.period_to := pay_month_to(ru.month);
  -- this month counts as a regular month too: projection = earlier payrolls + this month + the rest
  return pay_calc_tds(tid, e, ru, jsonb_build_object('taxable', reg, 'regular', reg, 'basic', bas, 'basic_full', bas, 'hra', hra, 'hra_full', hra,
    'pf', 0, 'pt', 0, 'incremental', false)) || jsonb_build_object('monthly_taxable', reg);
end $$;

create function pay_get_tax(p_emp text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := pay_guard('pay_salary');
  return jsonb_build_object('declaration', (select to_jsonb(d) - 'tenant_id' from pay_tax_decl d where employee_id = p_emp and d.fy = pay_fy_label(pay_fy_start(tid, pay_today(tid)))),
    'projection', pay_tax_projection(tid, p_emp), 'fy', pay_fy_label(pay_fy_start(tid, pay_today(tid))));
end $$;

-- ---------- payroll runs: lists and detail ----------
create function pay_list_runs(p jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := pay_guard_pay();
  return coalesce((select jsonb_agg(pay_run_summary(r.id) order by r.month desc, r.created_at desc)
    from pay_runs r where r.tenant_id = tid and (coalesce((p->>'include_cancelled')::boolean, false) or r.status <> 'cancelled')
      and (nullif(p->>'kind', '') is null or r.kind = p->>'kind') and (nullif(p->>'year', '') is null or left(r.month, 4) = p->>'year')), '[]');
end $$;

create function pay_get_run(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; ru pay_runs; prev uuid;
begin
  tid := pay_guard_pay();
  select * into ru from pay_runs where id = p_id and tenant_id = tid;
  if ru.id is null then raise exception 'Payroll not found'; end if;
  select id into prev from pay_runs where tenant_id = tid and kind = 'regular' and month < ru.month and status in ('finalized', 'paid', 'locked') order by month desc limit 1;
  return pay_run_summary(ru.id) || jsonb_build_object(
    'people', (select jsonb_agg(jsonb_build_object('id', u.id, 'name', u.email) ) from (select distinct x as id from unnest(array[ru.created_by, ru.calculated_by, ru.submitted_by, ru.approved_by, ru.finalized_by]) x where x is not null) z join auth_users u on u.id = z.id),
    'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'employee_id', i.employee_id, 'name', i.snap->>'name', 'code', i.snap->>'code', 'department', i.snap->>'department',
        'designation', i.snap->>'designation', 'status', i.status, 'hold_reason', i.hold_reason, 'paid_days', i.att->>'paid_days', 'lop_days', i.att->>'lop_days', 'divisor', i.att->>'divisor',
        'gross', i.gross, 'deductions', i.deductions, 'net', i.net, 'employer', i.employer, 'warnings', i.warnings, 'payslip_no', i.payslip_no,
        'payout', i.snap->'payout', 'prev_net', (select pi.net from pay_run_items pi where pi.run_id = prev and pi.employee_id = i.employee_id),
        'paid', coalesce((select sum(bl.amount) from pay_batch_lines bl where bl.item_id = i.id and bl.status = 'paid'), 0),
        'pending', coalesce((select sum(bl.amount) from pay_batch_lines bl where bl.item_id = i.id and bl.status = 'pending'), 0),
        'lines', (select jsonb_object_agg(code, amt) from (select code, sum(amount) amt from pay_run_lines where item_id = i.id group by code) z)) order by i.snap->>'name')
      from pay_run_items i where i.run_id = ru.id), '[]'),
    'inputs', coalesce((select jsonb_agg(to_jsonb(x) - 'tenant_id' || jsonb_build_object('name_emp', e.name) order by e.name, x.created_at) from pay_run_inputs x join pay_employees e on e.id = x.employee_id where x.run_id = ru.id), '[]'),
    'batches', coalesce((select jsonb_agg(to_jsonb(b) - 'tenant_id' || jsonb_build_object('lines', (select count(*) from pay_batch_lines where batch_id = b.id)) order by b.created_at) from pay_batches b where b.run_id = ru.id), '[]'),
    'prev', (select jsonb_build_object('id', r.id, 'month', r.month, 'gross', r.gross, 'net', r.net, 'employees', r.employees) from pay_runs r where r.id = prev),
    'audit', coalesce((select jsonb_agg(jsonb_build_object('at', a.at, 'action', a.action, 'by', a.actor_email, 'reason', a.reason) order by a.at) from pay_audit a where a.tenant_id = tid and a.entity = 'run' and a.entity_id = ru.id::text), '[]'));
end $$;

-- one payslip: HR with pay rights, or the employee for their own finalised payslip
create function pay_payslip_json(it pay_run_items) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r pay_runs; fy text;
begin
  select * into r from pay_runs where id = it.run_id;
  fy := to_char(pay_fy_start(it.tenant_id, r.period_from), 'YYYY-MM');
  return jsonb_build_object('item', to_jsonb(it) - 'tenant_id', 'run', to_jsonb(r) - 'tenant_id' - 'params' - 'warnings',
    'lines', coalesce((select jsonb_agg(to_jsonb(l) - 'tenant_id' - 'run_id' - 'item_id' - 'employee_id' - 'gl_key' order by l.kind, l.sort, l.id) from pay_run_lines l
                       left join pay_components c on c.tenant_id = l.tenant_id and c.code = l.code where l.item_id = it.id and coalesce(c.on_payslip, true)), '[]'),
    'org', (select jsonb_build_object('name', coalesce(o.display_name, o.legal_name), 'legal_name', o.legal_name, 'address', o.address, 'city', o.city, 'pan', o.pan, 'tan', o.tan,
            'pf_code', o.pf_code, 'esi_code', o.esi_code, 'note', o.settings->'payslip'->>'note', 'show_employer', coalesce((o.settings->'payslip'->>'show_employer')::boolean, false))
            from pay_org o where o.tenant_id = it.tenant_id),
    'ytd', (select jsonb_build_object('gross', coalesce(sum(i.gross), 0), 'deductions', coalesce(sum(i.deductions), 0), 'net', coalesce(sum(i.net), 0))
            from pay_run_items i join pay_runs r2 on r2.id = i.run_id
            where i.employee_id = it.employee_id and r2.status in ('finalized', 'paid', 'locked') and r2.month between fy and r.month)
         || jsonb_build_object('tds', (select coalesce(sum(l.amount), 0) from pay_run_lines l join pay_runs r2 on r2.id = l.run_id
            where l.employee_id = it.employee_id and l.code = 'TDS' and r2.status in ('finalized', 'paid', 'locked') and r2.month between fy and r.month)),
    'leave', pay_leave_summary(it.employee_id));
end $$;

create function pay_get_item(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; it pay_run_items; st text;
begin
  tid := pay_tenant();
  select * into it from pay_run_items where id = p_id and tenant_id = tid;
  if it.id is null then raise exception 'Payslip not found'; end if;
  select status into st from pay_runs where id = it.run_id;
  if not (pay_perm('pay_salary') or pay_perm('pay_run') or pay_perm('pay_approve') or pay_perm('pay_pay')) then
    if pay_my_emp() is distinct from it.employee_id or st not in ('finalized', 'paid', 'locked') or not it.published then
      raise exception 'Your role does not allow this' using errcode = '42501';
    end if;
  end if;
  return pay_payslip_json(it);
end $$;

-- rows: [{id (to change or delete), employee_id, kind, code, name, amount, taxable, note, delete}]
create function pay_save_inputs(p_run uuid, p_rows jsonb) returns int language plpgsql security definer set search_path = public as $$
declare tid uuid; ru pay_runs; r jsonb; n int := 0; c pay_components;
begin
  tid := pay_guard('pay_run');
  select * into ru from pay_runs where id = p_run and tenant_id = tid;
  if ru.id is null then raise exception 'Payroll not found'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]')) loop
    if coalesce((r->>'delete')::boolean, false) then delete from pay_run_inputs where id = (r->>'id')::uuid and run_id = ru.id; n := n + 1; continue; end if;
    if not exists (select 1 from pay_employees where id = r->>'employee_id' and tenant_id = tid) then raise exception 'Employee not found'; end if;
    if r->>'kind' not in ('earning', 'deduction', 'lop_days', 'ot_hours', 'tds') then raise exception 'Unknown entry type'; end if;
    if r->>'kind' in ('earning', 'deduction', 'tds') and coalesce((r->>'amount')::numeric, -1) < 0 then raise exception 'Amounts cannot be negative'; end if;
    if r->>'kind' in ('earning', 'deduction') then
      select * into c from pay_components where tenant_id = tid and code = upper(coalesce(nullif(r->>'code', ''), case r->>'kind' when 'earning' then 'INCENTIVE' else 'OTHER_DED' end));
      if c.id is not null and c.kind <> r->>'kind' and not (c.kind = 'reimbursement' and r->>'kind' = 'earning') then raise exception '% is not a %', c.name, r->>'kind'; end if;
      if c.system in ('pf_ee', 'esi_ee', 'pt', 'tds', 'lwf_ee', 'loan', 'ot', 'arrears', 'leave_enc', 'gratuity') then raise exception '% is worked out by payroll itself', c.name; end if;
    end if;
    if nullif(r->>'id', '') is null then
      insert into pay_run_inputs (tenant_id, run_id, employee_id, kind, code, name, amount, taxable, note, created_by)
      values (tid, ru.id, r->>'employee_id', r->>'kind', upper(nullif(r->>'code', '')), pay_clean(r->>'name', 60), coalesce((r->>'amount')::numeric, 0), coalesce((r->>'taxable')::boolean, true), pay_clean(r->>'note', 200), app_uid());
    else
      update pay_run_inputs set kind = r->>'kind', code = upper(nullif(r->>'code', '')), name = pay_clean(r->>'name', 60), amount = coalesce((r->>'amount')::numeric, 0),
        taxable = coalesce((r->>'taxable')::boolean, true), note = pay_clean(r->>'note', 200) where id = (r->>'id')::uuid and run_id = ru.id;
    end if;
    n := n + 1;
  end loop;
  perform pay_audit_log(tid, 'inputs', 'run', ru.id::text, null, null, p_rows, null);
  return n;
end $$;

create function pay_get_batch(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := pay_guard('pay_pay');
  return (select to_jsonb(b) - 'tenant_id' || jsonb_build_object('run', (select jsonb_build_object('id', r.id, 'number', r.number, 'title', r.title, 'month', r.month) from pay_runs r where r.id = b.run_id),
    'lines', (select coalesce(jsonb_agg(to_jsonb(l) - 'tenant_id' || jsonb_build_object('name', e.name, 'code', e.code) order by e.name), '[]') from pay_batch_lines l join pay_employees e on e.id = l.employee_id where l.batch_id = b.id))
    from pay_batches b where b.id = p_id and b.tenant_id = tid);
end $$;

-- ---------- home ----------
create function pay_dashboard() returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; td date; o pay_org; cur text; prevm text; ru pay_runs; sal boolean; res jsonb; e record;
begin
  tid := pay_guard('pay_view');
  td := pay_today(tid); o := pay_org_row(tid); sal := pay_perm('pay_salary') or pay_perm('pay_run');
  for e in select id from pay_employees where tenant_id = tid and status in ('active', 'notice') and joined_on <= td loop perform pay_att_compute(tid, e.id, td); end loop;
  cur := pay_month_of(td); prevm := pay_month_add(cur, -1);
  res := jsonb_build_object('today', td,
    'headcount', (select jsonb_build_object('active', count(*) filter (where status = 'active'), 'notice', count(*) filter (where status = 'notice'),
       'onboarding', count(*) filter (where status = 'onboarding'), 'joined_this_month', count(*) filter (where joined_on >= pay_month_from(cur) and joined_on <= td),
       'left_this_month', count(*) filter (where status = 'exited' and last_day >= pay_month_from(cur))) from pay_employees where tenant_id = tid),
    'attendance', (select jsonb_build_object('present', count(*) filter (where a.status in ('present', 'missing')), 'late', count(*) filter (where a.status = 'late'),
       'absent', count(*) filter (where a.status = 'absent'), 'leave', count(*) filter (where a.status in ('leave', 'half_leave')), 'off', count(*) filter (where a.status in ('weekly_off', 'holiday')),
       'waiting', count(*) filter (where a.status = 'upcoming'), 'half', count(*) filter (where a.status = 'half'))
       from pay_attendance a join pay_employees x on x.id = a.employee_id where x.tenant_id = tid and a.att_date = td and x.status in ('active', 'notice')),
    'pending', jsonb_build_object('leave', (select count(*) from pay_leave_requests where tenant_id = tid and status = 'pending'),
       'corrections', (select count(*) from pay_regularizations where tenant_id = tid and status = 'pending'),
       'loans', case when sal then (select count(*) from pay_loans where tenant_id = tid and status = 'requested') else 0 end,
       'claims', case when sal then (select count(*) from pay_claims where tenant_id = tid and status = 'submitted') else 0 end,
       'bank', case when pay_perm('pay_salary') then (select count(*) from pay_bank_accounts where tenant_id = tid and status = 'pending') else 0 end),
    'events', coalesce((select jsonb_agg(x order by x->>'date') from (
       select jsonb_build_object('kind', 'birthday', 'name', name, 'employee_id', id, 'date', make_date(extract(year from td)::int, extract(month from dob)::int, least(extract(day from dob)::int, 28))) x
         from pay_employees where tenant_id = tid and status in ('active', 'notice') and dob is not null
          and make_date(extract(year from td)::int, extract(month from dob)::int, least(extract(day from dob)::int, 28)) between td and td + 14
       union all select jsonb_build_object('kind', 'anniversary', 'name', name, 'employee_id', id, 'date', make_date(extract(year from td)::int, extract(month from joined_on)::int, least(extract(day from joined_on)::int, 28)),
          'years', extract(year from td)::int - extract(year from joined_on)::int)
         from pay_employees where tenant_id = tid and status in ('active', 'notice') and extract(year from joined_on) < extract(year from td)
          and make_date(extract(year from td)::int, extract(month from joined_on)::int, least(extract(day from joined_on)::int, 28)) between td and td + 14
       union all select jsonb_build_object('kind', 'probation', 'name', name, 'employee_id', id, 'date', confirm_on) from pay_employees where tenant_id = tid and status = 'active' and confirm_on between td and td + 14
         and not exists (select 1 from pay_emp_events v where v.employee_id = pay_employees.id and v.kind = 'confirmed')
       union all select jsonb_build_object('kind', 'last_day', 'name', name, 'employee_id', id, 'date', last_day) from pay_employees where tenant_id = tid and status = 'notice' and last_day between td and td + 30
       union all select jsonb_build_object('kind', 'holiday', 'name', name, 'date', hdate) from pay_holidays where tenant_id = tid and hdate between td and td + 14) y), '[]'),
    'setup', jsonb_build_object('done', o.setup_done, 'company', o.legal_name is not null, 'people', exists (select 1 from pay_employees where tenant_id = tid),
       'salaries', not exists (select 1 from pay_employees x where x.tenant_id = tid and x.status in ('active', 'notice') and not exists (select 1 from pay_salaries s where s.employee_id = x.id)),
       'statutory', o.settings ? 'pf' and o.settings ? 'esi'));
  if sal then
    select * into ru from pay_runs where tenant_id = tid and kind = 'regular' and status <> 'cancelled' and month in (cur, prevm) order by (status in ('finalized', 'paid', 'locked')) , month desc limit 1;
    res := res || jsonb_build_object(
      'payroll', jsonb_build_object('current', case when ru.id is null then null else pay_run_summary(ru.id) end,
         'suggest_month', case when not exists (select 1 from pay_runs where tenant_id = tid and kind = 'regular' and month = prevm and status <> 'cancelled')
                                and exists (select 1 from pay_employees where tenant_id = tid and status <> 'onboarding' and joined_on <= pay_month_to(prevm) and (last_day is null or last_day >= pay_month_from(prevm)))
                                and extract(day from td) <= 20 then prevm else cur end,
         'open', (select coalesce(jsonb_agg(pay_run_summary(r.id) order by r.month), '[]') from pay_runs r where r.tenant_id = tid and r.status in ('draft', 'calculated', 'review', 'approved', 'finalized'))),
      'trend', (select coalesce(jsonb_agg(jsonb_build_object('month', month, 'gross', gross, 'net', net, 'employer', employer, 'employees', employees) order by month), '[]')
                from (select month, sum(gross) gross, sum(net) net, sum(employer) employer, max(employees) employees from pay_runs where tenant_id = tid and kind in ('regular', 'legacy')
                      and status in ('finalized', 'paid', 'locked') and month >= pay_month_add(cur, -6) group by month) t),
      'monthly_cost', (select coalesce(sum((s.breakup->>'gross')::numeric), 0) from pay_employees x
                       join lateral (select * from pay_salaries where employee_id = x.id and eff_from <= td order by eff_from desc limit 1) s on true
                       where x.tenant_id = tid and x.status in ('active', 'notice')),
      'dues', pay_compliance_dues(tid));
  end if;
  return res;
end $$;

-- statutory amounts from finalised payrolls that have not been paid to the government yet, with their usual due dates
create function pay_compliance_dues(tid uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('scheme', scheme, 'month', month, 'due', due, 'paid', paid, 'left', due - paid,
      'due_date', case scheme when 'TDS' then case when split_part(month, '-', 2) = '03' then pay_month_to(pay_month_add(month, 1)) + 0 else pay_month_from(pay_month_add(month, 1)) + 6 end
                              when 'PT' then pay_month_to(pay_month_add(month, 1)) else pay_month_from(pay_month_add(month, 1)) + 14 end) order by month, scheme), '[]')
  from (
    select s.scheme, r.month, sum(l.amount) due,
      coalesce((select sum(amount) from pay_stat_payments sp where sp.tenant_id = tid and sp.scheme = s.scheme and sp.month = r.month), 0) paid
    from pay_run_lines l join pay_runs r on r.id = l.run_id
    join (values ('PF_EE', 'PF'), ('PF_ER', 'PF'), ('EPS_ER', 'PF'), ('EDLI', 'PF'), ('PF_ADMIN', 'PF'), ('ESI_EE', 'ESI'), ('ESI_ER', 'ESI'), ('PT', 'PT'), ('TDS', 'TDS'), ('LWF_EE', 'LWF'), ('LWF_ER', 'LWF')) s(code, scheme) on s.code = l.code
    where r.tenant_id = tid and r.kind <> 'legacy' and r.status in ('finalized', 'paid', 'locked') and r.month >= to_char(now() - interval '14 months', 'YYYY-MM')
    group by s.scheme, r.month) x
  where due - paid > 0
$$;

create function pay_list_stat_payments(p jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := pay_guard_pay();
  return jsonb_build_object('dues', pay_compliance_dues(tid), 'payments', coalesce((select jsonb_agg(to_jsonb(s) - 'tenant_id' order by s.paid_on desc, s.created_at desc)
    from pay_stat_payments s where s.tenant_id = tid and s.paid_on >= pay_today(tid) - 500), '[]'));
end $$;

create function pay_list_audit(p jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := pay_guard('pay_audit');
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'at', a.at, 'actor', a.actor_email, 'role', a.actor_role, 'action', a.action, 'entity', a.entity,
      'entity_id', a.entity_id, 'employee', e.name, 'reason', a.reason, 'before', a.before, 'after', a.after) order by a.at desc, a.id desc)
    from (select * from pay_audit where tenant_id = tid
            and (nullif(p->>'employee_id', '') is null or employee_id = p->>'employee_id')
            and (nullif(p->>'entity', '') is null or entity = p->>'entity')
            and (nullif(p->>'from', '') is null or at >= (p->>'from')::date)
          order by at desc, id desc limit least(coalesce((p->>'limit')::int, 300), 1000)) a
    left join pay_employees e on e.id = a.employee_id), '[]');
end $$;

create function pay_search(p_q text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; q text;
begin
  tid := pay_guard('pay_view');
  q := lower(trim(coalesce(p_q, '')));
  if length(q) < 2 then return '[]'; end if;
  return coalesce((select jsonb_agg(x) from (
    select jsonb_build_object('type', 'employee', 'id', id, 'title', name, 'sub', coalesce(code, '') || case when status <> 'active' then ' · ' || status else '' end) x
      from pay_employees where tenant_id = tid and (lower(name) like '%' || q || '%' or lower(coalesce(code, '')) like q || '%' or coalesce(phone, '') like '%' || q || '%') limit 8) a), '[]')
   || case when pay_perm('pay_salary') or pay_perm('pay_run') then coalesce((select jsonb_agg(x) from (
    select jsonb_build_object('type', 'run', 'id', id, 'title', title, 'sub', number || ' · ' || status) x from pay_runs
      where tenant_id = tid and (lower(title) like '%' || q || '%' or lower(number) like '%' || q || '%' or month like q || '%') order by month desc limit 5) b), '[]') else '[]'::jsonb end;
end $$;

-- the console's Team > Payroll card
create function pay_console_summary() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; sal boolean;
begin
  tid := pay_guard('pay_view'); sal := pay_perm('pay_salary') or pay_perm('pay_run');
  return jsonb_build_object('employees', (select count(*) from pay_employees where tenant_id = tid and status in ('active', 'notice')),
    'present_today', (select count(*) from pay_attendance a join pay_employees e on e.id = a.employee_id where e.tenant_id = tid and a.att_date = pay_today(tid) and a.status in ('present', 'late', 'missing')),
    'pending', (select count(*) from pay_leave_requests where tenant_id = tid and status = 'pending') + (select count(*) from pay_regularizations where tenant_id = tid and status = 'pending'),
    'last_run', case when sal then (select jsonb_build_object('month', month, 'title', title, 'status', status, 'net', net, 'gross', gross, 'employees', employees) from pay_runs
                 where tenant_id = tid and status <> 'cancelled' and kind = 'regular' order by month desc limit 1) end,
    'people', coalesce((select jsonb_agg(jsonb_build_object('name', e.name, 'designation', (pay_job_at(e.id, pay_today(tid))).designation, 'phone', e.phone,
       'today', (select status from pay_attendance where employee_id = e.id and att_date = pay_today(tid))) order by e.name) from pay_employees e where e.tenant_id = tid and e.status in ('active', 'notice')), '[]'));
end $$;
