-- AUZslab SalesOS: demos + trials, tied to a lead. Conversion is never self-reported --
-- sos_trial_verify_conversion checks the REAL tenants/tenant_settings tables (the actual
-- AUZslab client record), per the brief's explicit rule: a salesperson cannot mark a
-- customer paid themselves.
create table sos_demos (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  lead_id uuid not null references sos_leads(id) on delete cascade,
  staff_id uuid not null references auth_users(id) on delete cascade,
  demo_date timestamptz,
  mode text check (mode in ('in_person', 'video_call', 'phone') or mode is null),
  status text not null default 'scheduled' check (status in ('scheduled', 'completed', 'missed', 'cancelled')),
  result text,
  objections text,
  created_at timestamptz not null default now()
);
create index idx_sos_demos_lead on sos_demos (lead_id, demo_date);
alter table sos_demos enable row level security;

create table sos_trials (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  lead_id uuid not null references sos_leads(id) on delete cascade,
  staff_id uuid not null references auth_users(id) on delete cascade,
  trial_start date not null default current_date,
  trial_expiry date,
  status text not null default 'active' check (status in ('active', 'expired', 'converted', 'cancelled')),
  client_tenant_id uuid references tenants(id),
  feedback text,
  created_at timestamptz not null default now()
);
create index idx_sos_trials_lead on sos_trials (lead_id);
alter table sos_trials enable row level security;

create function sos_demo_create(p_lead uuid, p_date timestamptz, p_mode text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_field'); row sos_demos%rowtype;
begin
  if not exists (select 1 from sos_leads where id = p_lead and tenant_id = tid) then raise exception 'lead not found'; end if;
  insert into sos_demos (tenant_id, lead_id, staff_id, demo_date, mode) values (tid, p_lead, app_uid(), p_date, p_mode)
  returning * into row;
  update sos_leads set stage = 'demo_scheduled', updated_at = now() where id = p_lead and stage in ('new_prospect', 'contacted', 'qualified', 'interested');
  return to_jsonb(row);
end $$;

create function sos_demo_set(p_id uuid, p_status text, p_result text default null, p_objections text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_field'); row sos_demos%rowtype;
begin
  if p_status not in ('completed', 'missed', 'cancelled') then raise exception 'unknown status: %', p_status; end if;
  update sos_demos set status = p_status, result = coalesce(p_result, result), objections = coalesce(p_objections, objections)
  where id = p_id and tenant_id = tid and staff_id = app_uid() returning * into row;
  if not found then raise exception 'demo not found or not yours'; end if;
  if p_status = 'completed' then
    update sos_leads set stage = 'demo_completed', updated_at = now() where id = row.lead_id and stage = 'demo_scheduled';
  end if;
  return to_jsonb(row);
end $$;

create function sos_trial_start(p_lead uuid, p_days int default 14) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_field'); row sos_trials%rowtype;
begin
  if not exists (select 1 from sos_leads where id = p_lead and tenant_id = tid) then raise exception 'lead not found'; end if;
  insert into sos_trials (tenant_id, lead_id, staff_id, trial_expiry) values (tid, p_lead, app_uid(), current_date + make_interval(days => greatest(1, least(coalesce(p_days, 14), 60))))
  returning * into row;
  update sos_leads set stage = 'trial_activated', updated_at = now() where id = p_lead;
  return to_jsonb(row);
end $$;

-- The only way a trial can be marked converted: a real tenant with that slug actually exists
-- and is active. Never trusts the salesperson's own claim.
create function sos_trial_verify_conversion(p_id uuid, p_tenant_slug text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_field'); trial sos_trials%rowtype; client tenants%rowtype;
begin
  select * into trial from sos_trials where id = p_id and tenant_id = tid;
  if not found then raise exception 'trial not found'; end if;
  select * into client from tenants where slug = nullif(btrim(p_tenant_slug), '');
  if not found then raise exception 'No AUZslab client found with that address -- the business must have actually signed up before a trial can be marked converted.'; end if;
  if client.status <> 'active' then raise exception 'That client account is not active (status: %)', client.status; end if;
  update sos_trials set status = 'converted', client_tenant_id = client.id where id = p_id;
  update sos_leads set stage = 'won', updated_at = now() where id = trial.lead_id;
  return jsonb_build_object('ok', true, 'clientName', client.name, 'clientSlug', client.slug);
end $$;

create function sos_my_demos() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_field');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'leadId', d.lead_id, 'businessName', b.name,
      'demoDate', d.demo_date, 'status', d.status) order by d.demo_date)
    from sos_demos d join sos_leads l on l.id = d.lead_id join sos_businesses b on b.id = l.business_id
    where d.tenant_id = tid and d.staff_id = app_uid()), '[]'::jsonb);
end $$;

create function sos_my_trials() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_field');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', tr.id, 'leadId', tr.lead_id, 'businessName', b.name,
      'trialStart', tr.trial_start, 'trialExpiry', tr.trial_expiry, 'status', tr.status) order by tr.trial_expiry)
    from sos_trials tr join sos_leads l on l.id = tr.lead_id join sos_businesses b on b.id = l.business_id
    where tr.tenant_id = tid and tr.staff_id = app_uid()), '[]'::jsonb);
end $$;

grant select, insert, update on sos_demos to app;
grant select, insert, update on sos_trials to app;
grant execute on function sos_demo_create(uuid, timestamptz, text) to app;
grant execute on function sos_demo_set(uuid, text, text, text) to app;
grant execute on function sos_trial_start(uuid, int) to app;
grant execute on function sos_trial_verify_conversion(uuid, text) to app;
grant execute on function sos_my_demos() to app;
grant execute on function sos_my_trials() to app;
