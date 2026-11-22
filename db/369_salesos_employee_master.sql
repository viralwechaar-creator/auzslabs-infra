-- AUZslab SalesOS: Employee Master Database. Owner's own spec (personal info, address, ID/
-- verification documents, education, previous employment, job & company info, salary & banking,
-- emergency contacts, a document checklist, company assets and exit records), built as separate
-- modules keyed by the staffer's auth_users id rather than one flat table -- the owner's own
-- architectural recommendation, and consistent with this codebase's existing split for
-- documents (db/364) and messaging (db/363).
--
-- Permission tiers (the owner's own requirement: "a sales manager cannot access confidential
-- bank details or identity documents"):
--   sos_staff_profile   -- personal/address/education/previous-employment/job/emergency-contact:
--                           self can view+edit their own; sos_manage can view (not necessarily
--                           edit) a report's; the job/company fields (department, designation,
--                           employment type, work location, manager, probation, shift, employee
--                           code) are set by sos_manage, not the employee.
--   sos_staff_sensitive -- ID numbers (Aadhaar/PAN/...), salary, banking: self can view+edit
--                           their own (needed to give HR their own bank details); otherwise
--                           sos_admin only -- sos_manage alone is NOT enough.
--   sos_staff_assets    -- company property assigned: self can view their own; sos_manage can
--                           view/assign/return anyone's.
--   sos_staff_exit      -- resignation/settlement: sos_admin only, both read and write.

create table sos_staff_profile (
  tenant_id uuid not null references tenants(id) on delete cascade,
  staff_id uuid not null references auth_users(id) on delete cascade,
  -- personal
  dob date, gender text, father_name text, mother_name text, marital_status text, nationality text,
  -- address
  addr_current text, addr_permanent text, city text, state text, country text, pincode text,
  -- education
  highest_qualification text, institution text, course text, specialization text, passing_year int, percentage text,
  -- previous employment
  prev_company text, prev_designation text, prev_joining_date date, prev_last_working_date date,
  prev_last_salary numeric(12,2), prev_experience_years numeric(5,2), prev_reason_leaving text,
  -- job and company (set by HR, not the employee)
  employee_code text, department text, designation text, manager_id uuid references auth_users(id) on delete set null,
  employment_type text check (employment_type in ('full_time','part_time','contract') or employment_type is null),
  work_location text, joining_date date, probation_end_date date,
  working_days text, shift_timing text, weekly_off text,
  -- emergency contact
  emg_name text, emg_relation text, emg_phone text, emg_alt_phone text, emg_address text,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, staff_id)
);
alter table sos_staff_profile enable row level security;

create table sos_staff_sensitive (
  tenant_id uuid not null references tenants(id) on delete cascade,
  staff_id uuid not null references auth_users(id) on delete cascade,
  -- identity/verification document numbers (not the scanned files -- those are sos_documents)
  aadhaar text, pan text, driving_licence text, voter_id text, passport text, police_verification text,
  -- salary
  basic_salary numeric(12,2), hra numeric(12,2), other_allowances numeric(12,2), incentives_base numeric(12,2),
  gross_salary numeric(12,2), deductions numeric(12,2), net_salary numeric(12,2),
  -- banking
  bank_name text, account_holder text, account_number text, ifsc text, uan text, esic text,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, staff_id)
);
alter table sos_staff_sensitive enable row level security;

create table sos_staff_assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  staff_id uuid not null references auth_users(id) on delete cascade,
  asset_type text not null, asset_detail text,
  issue_date date not null default current_date, return_date date,
  status text not null default 'issued' check (status in ('issued','returned')),
  assigned_by uuid references auth_users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index idx_sos_staff_assets_staff on sos_staff_assets (tenant_id, staff_id, status);
alter table sos_staff_assets enable row level security;

create table sos_staff_exit (
  tenant_id uuid not null references tenants(id) on delete cascade,
  staff_id uuid not null references auth_users(id) on delete cascade,
  resignation_date date, resignation_reason text, last_working_day date, notice_period text,
  exit_interview_notes text, pending_salary numeric(12,2), outstanding_advances numeric(12,2),
  assets_returned boolean not null default false, access_revoked boolean not null default false,
  fnf_settled boolean not null default false,
  relieving_letter_status text check (relieving_letter_status in ('pending','issued','not_applicable') or relieving_letter_status is null),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, staff_id)
);
alter table sos_staff_exit enable row level security;

alter table sos_documents add column if not exists category text;

grant select, insert, update on sos_staff_profile to app;
grant select, insert, update on sos_staff_sensitive to app;
grant select, insert, update, delete on sos_staff_assets to app;
grant select, insert, update on sos_staff_exit to app;

-- ---------- self / manager / admin (sos_*) ----------

create function sos_staff_profile_get(p_user uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sos_guard(); uid uuid := coalesce(p_user, app_uid()); row sos_staff_profile%rowtype;
begin
  if uid <> app_uid() and not sos_perm('sos_manage') then raise exception 'not authorized'; end if;
  select * into row from sos_staff_profile where tenant_id = tid and staff_id = uid;
  if not found then return jsonb_build_object('staffId', uid); end if;
  return to_jsonb(row) - 'tenant_id';
end $$;

-- fields the employee themselves may fill in (not the job/company columns below).
create function sos_staff_profile_save_self(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_guard(); uid uuid := app_uid();
begin
  insert into sos_staff_profile (tenant_id, staff_id, dob, gender, father_name, mother_name, marital_status, nationality,
      addr_current, addr_permanent, city, state, country, pincode,
      highest_qualification, institution, course, specialization, passing_year, percentage,
      prev_company, prev_designation, prev_joining_date, prev_last_working_date, prev_last_salary, prev_experience_years, prev_reason_leaving,
      emg_name, emg_relation, emg_phone, emg_alt_phone, emg_address, updated_at)
    values (tid, uid, nullif(p->>'dob','')::date, nullif(p->>'gender',''), nullif(p->>'fatherName',''), nullif(p->>'motherName',''), nullif(p->>'maritalStatus',''), nullif(p->>'nationality',''),
      nullif(p->>'addrCurrent',''), nullif(p->>'addrPermanent',''), nullif(p->>'city',''), nullif(p->>'state',''), nullif(p->>'country',''), nullif(p->>'pincode',''),
      nullif(p->>'highestQualification',''), nullif(p->>'institution',''), nullif(p->>'course',''), nullif(p->>'specialization',''), nullif(p->>'passingYear','')::int, nullif(p->>'percentage',''),
      nullif(p->>'prevCompany',''), nullif(p->>'prevDesignation',''), nullif(p->>'prevJoiningDate','')::date, nullif(p->>'prevLastWorkingDate','')::date, nullif(p->>'prevLastSalary','')::numeric, nullif(p->>'prevExperienceYears','')::numeric, nullif(p->>'prevReasonLeaving',''),
      nullif(p->>'emgName',''), nullif(p->>'emgRelation',''), nullif(p->>'emgPhone',''), nullif(p->>'emgAltPhone',''), nullif(p->>'emgAddress',''), now())
  on conflict (tenant_id, staff_id) do update set
    dob = excluded.dob, gender = excluded.gender, father_name = excluded.father_name, mother_name = excluded.mother_name, marital_status = excluded.marital_status, nationality = excluded.nationality,
    addr_current = excluded.addr_current, addr_permanent = excluded.addr_permanent, city = excluded.city, state = excluded.state, country = excluded.country, pincode = excluded.pincode,
    highest_qualification = excluded.highest_qualification, institution = excluded.institution, course = excluded.course, specialization = excluded.specialization, passing_year = excluded.passing_year, percentage = excluded.percentage,
    prev_company = excluded.prev_company, prev_designation = excluded.prev_designation, prev_joining_date = excluded.prev_joining_date, prev_last_working_date = excluded.prev_last_working_date, prev_last_salary = excluded.prev_last_salary, prev_experience_years = excluded.prev_experience_years, prev_reason_leaving = excluded.prev_reason_leaving,
    emg_name = excluded.emg_name, emg_relation = excluded.emg_relation, emg_phone = excluded.emg_phone, emg_alt_phone = excluded.emg_alt_phone, emg_address = excluded.emg_address, updated_at = now();
  perform sos_log('update', 'staff_profile', uid, null);
  return sos_staff_profile_get(uid);
end $$;

-- job/company fields: HR sets these, not the employee. sos_manage required.
create function sos_staff_profile_save_admin(p_user uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_manage');
begin
  insert into sos_staff_profile (tenant_id, staff_id, employee_code, department, designation, manager_id, employment_type, work_location, joining_date, probation_end_date, working_days, shift_timing, weekly_off, updated_at)
    values (tid, p_user, nullif(p->>'employeeCode',''), nullif(p->>'department',''), nullif(p->>'designation',''), nullif(p->>'managerId','')::uuid, nullif(p->>'employmentType',''), nullif(p->>'workLocation',''), nullif(p->>'joiningDate','')::date, nullif(p->>'probationEndDate','')::date, nullif(p->>'workingDays',''), nullif(p->>'shiftTiming',''), nullif(p->>'weeklyOff',''), now())
  on conflict (tenant_id, staff_id) do update set
    employee_code = excluded.employee_code, department = excluded.department, designation = excluded.designation, manager_id = excluded.manager_id,
    employment_type = excluded.employment_type, work_location = excluded.work_location, joining_date = excluded.joining_date, probation_end_date = excluded.probation_end_date,
    working_days = excluded.working_days, shift_timing = excluded.shift_timing, weekly_off = excluded.weekly_off, updated_at = now();
  perform sos_log('update', 'staff_profile_admin', p_user, null);
  return sos_staff_profile_get(p_user);
end $$;

create function sos_staff_sensitive_get(p_user uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sos_guard(); uid uuid := coalesce(p_user, app_uid()); row sos_staff_sensitive%rowtype;
begin
  if uid <> app_uid() and not sos_perm('sos_admin') then raise exception 'not authorized'; end if;
  select * into row from sos_staff_sensitive where tenant_id = tid and staff_id = uid;
  if not found then return jsonb_build_object('staffId', uid); end if;
  return to_jsonb(row) - 'tenant_id';
end $$;

create function sos_staff_sensitive_save(p_user uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_guard(); uid uuid := coalesce(p_user, app_uid());
begin
  if uid <> app_uid() and not sos_perm('sos_admin') then raise exception 'not authorized'; end if;
  insert into sos_staff_sensitive (tenant_id, staff_id, aadhaar, pan, driving_licence, voter_id, passport, police_verification,
      basic_salary, hra, other_allowances, incentives_base, gross_salary, deductions, net_salary,
      bank_name, account_holder, account_number, ifsc, uan, esic, updated_at)
    values (tid, uid, nullif(p->>'aadhaar',''), nullif(p->>'pan',''), nullif(p->>'drivingLicence',''), nullif(p->>'voterId',''), nullif(p->>'passport',''), nullif(p->>'policeVerification',''),
      nullif(p->>'basicSalary','')::numeric, nullif(p->>'hra','')::numeric, nullif(p->>'otherAllowances','')::numeric, nullif(p->>'incentivesBase','')::numeric, nullif(p->>'grossSalary','')::numeric, nullif(p->>'deductions','')::numeric, nullif(p->>'netSalary','')::numeric,
      nullif(p->>'bankName',''), nullif(p->>'accountHolder',''), nullif(p->>'accountNumber',''), nullif(p->>'ifsc',''), nullif(p->>'uan',''), nullif(p->>'esic',''), now())
  on conflict (tenant_id, staff_id) do update set
    aadhaar = excluded.aadhaar, pan = excluded.pan, driving_licence = excluded.driving_licence, voter_id = excluded.voter_id, passport = excluded.passport, police_verification = excluded.police_verification,
    basic_salary = excluded.basic_salary, hra = excluded.hra, other_allowances = excluded.other_allowances, incentives_base = excluded.incentives_base, gross_salary = excluded.gross_salary, deductions = excluded.deductions, net_salary = excluded.net_salary,
    bank_name = excluded.bank_name, account_holder = excluded.account_holder, account_number = excluded.account_number, ifsc = excluded.ifsc, uan = excluded.uan, esic = excluded.esic, updated_at = now();
  perform sos_log('update', 'staff_sensitive', uid, null);
  return sos_staff_sensitive_get(uid);
end $$;

create function sos_staff_assets_list(p_user uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sos_guard(); uid uuid := coalesce(p_user, app_uid());
begin
  if uid <> app_uid() and not sos_perm('sos_manage') then raise exception 'not authorized'; end if;
  return coalesce((select jsonb_agg(to_jsonb(a) - 'tenant_id' order by a.created_at desc) from sos_staff_assets a where a.tenant_id = tid and a.staff_id = uid), '[]'::jsonb);
end $$;

create function sos_staff_asset_assign(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_manage'); row sos_staff_assets%rowtype;
begin
  if nullif(p->>'staffId','') is null then raise exception 'Pick a staff member'; end if;
  if nullif(btrim(coalesce(p->>'assetType','')), '') is null then raise exception 'Enter the asset type'; end if;
  insert into sos_staff_assets (tenant_id, staff_id, asset_type, asset_detail, issue_date, assigned_by)
    values (tid, (p->>'staffId')::uuid, btrim(p->>'assetType'), nullif(p->>'assetDetail',''), coalesce(nullif(p->>'issueDate','')::date, current_date), app_uid())
  returning * into row;
  perform sos_log('assign', 'staff_asset', row.id, jsonb_build_object('staffId', row.staff_id));
  return to_jsonb(row) - 'tenant_id';
end $$;

create function sos_staff_asset_return(p_id uuid) returns boolean language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_manage');
begin
  update sos_staff_assets set status = 'returned', return_date = current_date where id = p_id and tenant_id = tid;
  if found then perform sos_log('return', 'staff_asset', p_id, null); end if;
  return found;
end $$;

create function sos_staff_exit_get(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_admin'); row sos_staff_exit%rowtype;
begin
  select * into row from sos_staff_exit where tenant_id = tid and staff_id = p_user;
  if not found then return jsonb_build_object('staffId', p_user); end if;
  return to_jsonb(row) - 'tenant_id';
end $$;

create function sos_staff_exit_save(p_user uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_admin');
begin
  insert into sos_staff_exit (tenant_id, staff_id, resignation_date, resignation_reason, last_working_day, notice_period, exit_interview_notes,
      pending_salary, outstanding_advances, assets_returned, access_revoked, fnf_settled, relieving_letter_status, updated_at)
    values (tid, p_user, nullif(p->>'resignationDate','')::date, nullif(p->>'resignationReason',''), nullif(p->>'lastWorkingDay','')::date, nullif(p->>'noticePeriod',''), nullif(p->>'exitInterviewNotes',''),
      nullif(p->>'pendingSalary','')::numeric, nullif(p->>'outstandingAdvances','')::numeric, coalesce((p->>'assetsReturned')::boolean, false), coalesce((p->>'accessRevoked')::boolean, false), coalesce((p->>'fnfSettled')::boolean, false), nullif(p->>'relievingLetterStatus',''), now())
  on conflict (tenant_id, staff_id) do update set
    resignation_date = excluded.resignation_date, resignation_reason = excluded.resignation_reason, last_working_day = excluded.last_working_day, notice_period = excluded.notice_period, exit_interview_notes = excluded.exit_interview_notes,
    pending_salary = excluded.pending_salary, outstanding_advances = excluded.outstanding_advances, assets_returned = excluded.assets_returned, access_revoked = excluded.access_revoked, fnf_settled = excluded.fnf_settled, relieving_letter_status = excluded.relieving_letter_status, updated_at = now();
  perform sos_log('update', 'staff_exit', p_user, null);
  return sos_staff_exit_get(p_user);
end $$;

-- document checklist: same create/mark-uploaded/list/delete/file flow as db/364, with a category.
create function sos_document_create(p_label text, p_category text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_guard(); row sos_documents%rowtype;
begin
  if nullif(btrim(p_label), '') is null then raise exception 'Name the document first'; end if;
  insert into sos_documents (tenant_id, staff_id, label, category) values (tid, app_uid(), btrim(p_label), nullif(p_category, '')) returning * into row;
  return to_jsonb(row);
end $$;

grant execute on function sos_staff_profile_get(uuid) to app;
grant execute on function sos_staff_profile_save_self(jsonb) to app;
grant execute on function sos_staff_profile_save_admin(uuid, jsonb) to app;
grant execute on function sos_staff_sensitive_get(uuid) to app;
grant execute on function sos_staff_sensitive_save(uuid, jsonb) to app;
grant execute on function sos_staff_assets_list(uuid) to app;
grant execute on function sos_staff_asset_assign(jsonb) to app;
grant execute on function sos_staff_asset_return(uuid) to app;
grant execute on function sos_staff_exit_get(uuid) to app;
grant execute on function sos_staff_exit_save(uuid, jsonb) to app;
grant execute on function sos_document_create(text, text) to app;

-- ---------- platform admin (admin_sos_*, bypasses tenant membership -- see db/365) ----------

create function admin_sos_staff_profile_get(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tid uuid := admin_sos_tenant(); row sos_staff_profile%rowtype;
begin
  select * into row from sos_staff_profile where tenant_id = tid and staff_id = p_user;
  if not found then return jsonb_build_object('staffId', p_user); end if;
  return to_jsonb(row) - 'tenant_id';
end $$;

-- platform admin can set every field (personal, address, education, previous employment,
-- job/company, emergency contact) in one call -- there's no self/HR split for them.
create function admin_sos_staff_profile_save(p_user uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tid uuid := admin_sos_tenant();
begin
  insert into sos_staff_profile (tenant_id, staff_id, dob, gender, father_name, mother_name, marital_status, nationality,
      addr_current, addr_permanent, city, state, country, pincode,
      highest_qualification, institution, course, specialization, passing_year, percentage,
      prev_company, prev_designation, prev_joining_date, prev_last_working_date, prev_last_salary, prev_experience_years, prev_reason_leaving,
      employee_code, department, designation, manager_id, employment_type, work_location, joining_date, probation_end_date, working_days, shift_timing, weekly_off,
      emg_name, emg_relation, emg_phone, emg_alt_phone, emg_address, updated_at)
    values (tid, p_user, nullif(p->>'dob','')::date, nullif(p->>'gender',''), nullif(p->>'fatherName',''), nullif(p->>'motherName',''), nullif(p->>'maritalStatus',''), nullif(p->>'nationality',''),
      nullif(p->>'addrCurrent',''), nullif(p->>'addrPermanent',''), nullif(p->>'city',''), nullif(p->>'state',''), nullif(p->>'country',''), nullif(p->>'pincode',''),
      nullif(p->>'highestQualification',''), nullif(p->>'institution',''), nullif(p->>'course',''), nullif(p->>'specialization',''), nullif(p->>'passingYear','')::int, nullif(p->>'percentage',''),
      nullif(p->>'prevCompany',''), nullif(p->>'prevDesignation',''), nullif(p->>'prevJoiningDate','')::date, nullif(p->>'prevLastWorkingDate','')::date, nullif(p->>'prevLastSalary','')::numeric, nullif(p->>'prevExperienceYears','')::numeric, nullif(p->>'prevReasonLeaving',''),
      nullif(p->>'employeeCode',''), nullif(p->>'department',''), nullif(p->>'designation',''), nullif(p->>'managerId','')::uuid, nullif(p->>'employmentType',''), nullif(p->>'workLocation',''), nullif(p->>'joiningDate','')::date, nullif(p->>'probationEndDate','')::date, nullif(p->>'workingDays',''), nullif(p->>'shiftTiming',''), nullif(p->>'weeklyOff',''),
      nullif(p->>'emgName',''), nullif(p->>'emgRelation',''), nullif(p->>'emgPhone',''), nullif(p->>'emgAltPhone',''), nullif(p->>'emgAddress',''), now())
  on conflict (tenant_id, staff_id) do update set
    dob = excluded.dob, gender = excluded.gender, father_name = excluded.father_name, mother_name = excluded.mother_name, marital_status = excluded.marital_status, nationality = excluded.nationality,
    addr_current = excluded.addr_current, addr_permanent = excluded.addr_permanent, city = excluded.city, state = excluded.state, country = excluded.country, pincode = excluded.pincode,
    highest_qualification = excluded.highest_qualification, institution = excluded.institution, course = excluded.course, specialization = excluded.specialization, passing_year = excluded.passing_year, percentage = excluded.percentage,
    prev_company = excluded.prev_company, prev_designation = excluded.prev_designation, prev_joining_date = excluded.prev_joining_date, prev_last_working_date = excluded.prev_last_working_date, prev_last_salary = excluded.prev_last_salary, prev_experience_years = excluded.prev_experience_years, prev_reason_leaving = excluded.prev_reason_leaving,
    employee_code = excluded.employee_code, department = excluded.department, designation = excluded.designation, manager_id = excluded.manager_id, employment_type = excluded.employment_type, work_location = excluded.work_location, joining_date = excluded.joining_date, probation_end_date = excluded.probation_end_date, working_days = excluded.working_days, shift_timing = excluded.shift_timing, weekly_off = excluded.weekly_off,
    emg_name = excluded.emg_name, emg_relation = excluded.emg_relation, emg_phone = excluded.emg_phone, emg_alt_phone = excluded.emg_alt_phone, emg_address = excluded.emg_address, updated_at = now();
  perform sos_log_tid(tid, 'update', 'staff_profile_admin', p_user, null);
  return admin_sos_staff_profile_get(p_user);
end $$;

create function admin_sos_staff_sensitive_get(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tid uuid := admin_sos_tenant(); row sos_staff_sensitive%rowtype;
begin
  select * into row from sos_staff_sensitive where tenant_id = tid and staff_id = p_user;
  if not found then return jsonb_build_object('staffId', p_user); end if;
  return to_jsonb(row) - 'tenant_id';
end $$;

create function admin_sos_staff_sensitive_save(p_user uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tid uuid := admin_sos_tenant();
begin
  insert into sos_staff_sensitive (tenant_id, staff_id, aadhaar, pan, driving_licence, voter_id, passport, police_verification,
      basic_salary, hra, other_allowances, incentives_base, gross_salary, deductions, net_salary,
      bank_name, account_holder, account_number, ifsc, uan, esic, updated_at)
    values (tid, p_user, nullif(p->>'aadhaar',''), nullif(p->>'pan',''), nullif(p->>'drivingLicence',''), nullif(p->>'voterId',''), nullif(p->>'passport',''), nullif(p->>'policeVerification',''),
      nullif(p->>'basicSalary','')::numeric, nullif(p->>'hra','')::numeric, nullif(p->>'otherAllowances','')::numeric, nullif(p->>'incentivesBase','')::numeric, nullif(p->>'grossSalary','')::numeric, nullif(p->>'deductions','')::numeric, nullif(p->>'netSalary','')::numeric,
      nullif(p->>'bankName',''), nullif(p->>'accountHolder',''), nullif(p->>'accountNumber',''), nullif(p->>'ifsc',''), nullif(p->>'uan',''), nullif(p->>'esic',''), now())
  on conflict (tenant_id, staff_id) do update set
    aadhaar = excluded.aadhaar, pan = excluded.pan, driving_licence = excluded.driving_licence, voter_id = excluded.voter_id, passport = excluded.passport, police_verification = excluded.police_verification,
    basic_salary = excluded.basic_salary, hra = excluded.hra, other_allowances = excluded.other_allowances, incentives_base = excluded.incentives_base, gross_salary = excluded.gross_salary, deductions = excluded.deductions, net_salary = excluded.net_salary,
    bank_name = excluded.bank_name, account_holder = excluded.account_holder, account_number = excluded.account_number, ifsc = excluded.ifsc, uan = excluded.uan, esic = excluded.esic, updated_at = now();
  perform sos_log_tid(tid, 'update', 'staff_sensitive_admin', p_user, null);
  return admin_sos_staff_sensitive_get(p_user);
end $$;

create function admin_sos_staff_assets_list(p_user uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tid uuid := admin_sos_tenant();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'staffId', a.staff_id, 'staffName', coalesce(pr.name, u.email),
      'assetType', a.asset_type, 'assetDetail', a.asset_detail, 'issueDate', a.issue_date, 'returnDate', a.return_date, 'status', a.status) order by a.created_at desc)
    from sos_staff_assets a join auth_users u on u.id = a.staff_id left join profiles pr on pr.id = a.staff_id
    where a.tenant_id = tid and (p_user is null or a.staff_id = p_user)), '[]'::jsonb);
end $$;

create function admin_sos_staff_asset_assign(p_user uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := admin_sos_tenant(); row sos_staff_assets%rowtype;
begin
  if nullif(btrim(coalesce(p->>'assetType','')), '') is null then raise exception 'Enter the asset type'; end if;
  insert into sos_staff_assets (tenant_id, staff_id, asset_type, asset_detail, issue_date)
    values (tid, p_user, btrim(p->>'assetType'), nullif(p->>'assetDetail',''), coalesce(nullif(p->>'issueDate','')::date, current_date))
  returning * into row;
  perform sos_log_tid(tid, 'assign', 'staff_asset_admin', row.id, jsonb_build_object('staffId', row.staff_id));
  return to_jsonb(row) - 'tenant_id';
end $$;

create function admin_sos_staff_asset_return(p_id uuid) returns boolean language plpgsql security definer set search_path = public as $$
declare tid uuid := admin_sos_tenant();
begin
  update sos_staff_assets set status = 'returned', return_date = current_date where id = p_id and tenant_id = tid;
  if found then perform sos_log_tid(tid, 'return', 'staff_asset_admin', p_id, null); end if;
  return found;
end $$;

create function admin_sos_staff_exit_get(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tid uuid := admin_sos_tenant(); row sos_staff_exit%rowtype;
begin
  select * into row from sos_staff_exit where tenant_id = tid and staff_id = p_user;
  if not found then return jsonb_build_object('staffId', p_user); end if;
  return to_jsonb(row) - 'tenant_id';
end $$;

create function admin_sos_staff_exit_save(p_user uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tid uuid := admin_sos_tenant();
begin
  insert into sos_staff_exit (tenant_id, staff_id, resignation_date, resignation_reason, last_working_day, notice_period, exit_interview_notes,
      pending_salary, outstanding_advances, assets_returned, access_revoked, fnf_settled, relieving_letter_status, updated_at)
    values (tid, p_user, nullif(p->>'resignationDate','')::date, nullif(p->>'resignationReason',''), nullif(p->>'lastWorkingDay','')::date, nullif(p->>'noticePeriod',''), nullif(p->>'exitInterviewNotes',''),
      nullif(p->>'pendingSalary','')::numeric, nullif(p->>'outstandingAdvances','')::numeric, coalesce((p->>'assetsReturned')::boolean, false), coalesce((p->>'accessRevoked')::boolean, false), coalesce((p->>'fnfSettled')::boolean, false), nullif(p->>'relievingLetterStatus',''), now())
  on conflict (tenant_id, staff_id) do update set
    resignation_date = excluded.resignation_date, resignation_reason = excluded.resignation_reason, last_working_day = excluded.last_working_day, notice_period = excluded.notice_period, exit_interview_notes = excluded.exit_interview_notes,
    pending_salary = excluded.pending_salary, outstanding_advances = excluded.outstanding_advances, assets_returned = excluded.assets_returned, access_revoked = excluded.access_revoked, fnf_settled = excluded.fnf_settled, relieving_letter_status = excluded.relieving_letter_status, updated_at = now();
  perform sos_log_tid(tid, 'update', 'staff_exit_admin', p_user, null);
  return admin_sos_staff_exit_get(p_user);
end $$;

-- platform admin's own view of a staffer's documents (reuses sos_documents, admin_sos_tenant
-- instead of sos_guard so a bare platform admin with no SalesOS profile can still see them).
create function admin_sos_staff_documents(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tid uuid := admin_sos_tenant();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'label', d.label, 'category', d.category,
      'uploaded', d.filename is not null, 'createdAt', d.created_at) order by d.created_at desc)
    from sos_documents d where d.tenant_id = tid and d.staff_id = p_user), '[]'::jsonb);
end $$;

grant execute on function admin_sos_staff_profile_get(uuid) to app;
grant execute on function admin_sos_staff_profile_save(uuid, jsonb) to app;
grant execute on function admin_sos_staff_sensitive_get(uuid) to app;
grant execute on function admin_sos_staff_sensitive_save(uuid, jsonb) to app;
grant execute on function admin_sos_staff_assets_list(uuid) to app;
grant execute on function admin_sos_staff_asset_assign(uuid, jsonb) to app;
grant execute on function admin_sos_staff_asset_return(uuid) to app;
grant execute on function admin_sos_staff_exit_get(uuid) to app;
grant execute on function admin_sos_staff_exit_save(uuid, jsonb) to app;
grant execute on function admin_sos_staff_documents(uuid) to app;
