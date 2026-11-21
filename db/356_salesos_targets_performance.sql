-- AUZslab SalesOS: targets + performance, computed from real recorded activity only (brief's
-- own rule 9: never hardcoded KPIs). A daily report is derived on the fly from today's real
-- visits/leads/demos, never a free-text number the employee can override.
create table sos_targets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  staff_id uuid not null references auth_users(id) on delete cascade,
  period_month date not null, -- first of month
  visits_target int not null default 0,
  leads_target int not null default 0,
  demos_target int not null default 0,
  set_by uuid references auth_users(id),
  created_at timestamptz not null default now(),
  unique (staff_id, period_month)
);
alter table sos_targets enable row level security;

create function sos_target_set(p_staff uuid, p_month date, p_visits int, p_leads int, p_demos int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_manage'); row sos_targets%rowtype;
begin
  if not exists (select 1 from profiles where id = p_staff and tenant_id = tid) then raise exception 'that person is not on this team'; end if;
  insert into sos_targets (tenant_id, staff_id, period_month, visits_target, leads_target, demos_target, set_by)
  values (tid, p_staff, date_trunc('month', p_month)::date, greatest(0, coalesce(p_visits, 0)), greatest(0, coalesce(p_leads, 0)), greatest(0, coalesce(p_demos, 0)), app_uid())
  on conflict (staff_id, period_month) do update set visits_target = excluded.visits_target, leads_target = excluded.leads_target,
    demos_target = excluded.demos_target, set_by = excluded.set_by
  returning * into row;
  return to_jsonb(row);
end $$;

create function sos_my_performance() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_field'); month_start date := date_trunc('month', current_date)::date; t sos_targets%rowtype;
begin
  select * into t from sos_targets where staff_id = app_uid() and period_month = month_start;
  return jsonb_build_object(
    'visitsTarget', coalesce(t.visits_target, 0), 'visitsDone', (select count(*) from sos_visits where tenant_id = tid and staff_id = app_uid() and status = 'completed' and check_in_at >= month_start),
    'leadsTarget', coalesce(t.leads_target, 0), 'leadsDone', (select count(*) from sos_leads where tenant_id = tid and created_by = app_uid() and created_at >= month_start),
    'demosTarget', coalesce(t.demos_target, 0), 'demosDone', (select count(*) from sos_demos where tenant_id = tid and staff_id = app_uid() and status = 'completed' and demo_date >= month_start),
    'trialsActive', (select count(*) from sos_trials where tenant_id = tid and staff_id = app_uid() and status = 'active'),
    'dealsWon', (select count(*) from sos_leads where tenant_id = tid and (owner_id = app_uid() or created_by = app_uid()) and stage = 'won' and updated_at >= month_start));
end $$;

-- "Today's report": entirely computed, never stored as free text.
create function sos_daily_report() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_field'); day_start timestamptz := date_trunc('day', now());
begin
  return jsonb_build_object(
    'plannedVisits', (select count(*) from sos_visits where tenant_id = tid and staff_id = app_uid() and scheduled_at >= day_start and scheduled_at < day_start + interval '1 day'),
    'completedVisits', (select count(*) from sos_visits where tenant_id = tid and staff_id = app_uid() and check_in_at >= day_start and status = 'completed'),
    'newLeads', (select count(*) from sos_leads where tenant_id = tid and created_by = app_uid() and created_at >= day_start),
    'demosToday', (select count(*) from sos_demos where tenant_id = tid and staff_id = app_uid() and demo_date >= day_start and demo_date < day_start + interval '1 day'),
    'followUpsDue', (select count(*) from sos_leads where tenant_id = tid and owner_id = app_uid() and follow_up_date = current_date));
end $$;

create function sos_team_performance(p_month date default current_date) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_manage'); month_start date := date_trunc('month', coalesce(p_month, current_date))::date;
begin
  return coalesce((select jsonb_agg(jsonb_build_object('staffId', u.id, 'name', coalesce(p.name, u.email),
      'visitsDone', (select count(*) from sos_visits where tenant_id = tid and staff_id = u.id and status = 'completed' and check_in_at >= month_start),
      'leadsDone', (select count(*) from sos_leads where tenant_id = tid and created_by = u.id and created_at >= month_start),
      'dealsWon', (select count(*) from sos_leads where tenant_id = tid and (owner_id = u.id or created_by = u.id) and stage = 'won' and updated_at >= month_start))
    order by 1)
    from profiles p join auth_users u on u.id = p.id where p.tenant_id = tid), '[]'::jsonb);
end $$;

grant select, insert, update on sos_targets to app;
grant execute on function sos_target_set(uuid, date, int, int, int) to app;
grant execute on function sos_my_performance() to app;
grant execute on function sos_daily_report() to app;
grant execute on function sos_team_performance(date) to app;
