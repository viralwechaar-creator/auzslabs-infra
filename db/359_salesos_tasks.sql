-- AUZslab SalesOS: general task/follow-up manager (brief section 5.10). A task can stand alone
-- or be tied to a lead/business/visit; follow-up due dates on leads (sos_leads.follow_up_date,
-- already tracked) auto-surface here too via sos_my_tasks, rather than inventing a second
-- follow-up system.
create table sos_tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  title text not null,
  notes text,
  assigned_to uuid not null references auth_users(id) on delete cascade,
  assigned_by uuid references auth_users(id),
  due_date date,
  lead_id uuid references sos_leads(id) on delete set null,
  business_id uuid references sos_businesses(id) on delete set null,
  status text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_sos_tasks_assignee on sos_tasks (tenant_id, assigned_to, status, due_date);
alter table sos_tasks enable row level security;

create function sos_task_create(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_guard(); row sos_tasks%rowtype; v_assignee uuid := coalesce(nullif(p->>'assignedTo', '')::uuid, app_uid());
begin
  if nullif(btrim(p->>'title'), '') is null then raise exception 'Enter a task title'; end if;
  if v_assignee <> app_uid() and not sos_perm('sos_manage') then raise exception 'Only a manager can assign a task to someone else'; end if;
  if not exists (select 1 from profiles where id = v_assignee and tenant_id = tid) then raise exception 'assignee not found'; end if;
  insert into sos_tasks (tenant_id, title, notes, assigned_to, assigned_by, due_date, lead_id, business_id)
  values (tid, btrim(p->>'title'), nullif(p->>'notes', ''), v_assignee, app_uid(), nullif(p->>'dueDate', '')::date,
    nullif(p->>'leadId', '')::uuid, nullif(p->>'businessId', '')::uuid)
  returning * into row;
  return to_jsonb(row);
end $$;

create function sos_task_set(p_id uuid, p_status text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_guard(); row sos_tasks%rowtype;
begin
  if p_status not in ('open', 'done', 'cancelled') then raise exception 'unknown status: %', p_status; end if;
  update sos_tasks set status = p_status, completed_at = case when p_status = 'done' then now() else null end
  where id = p_id and tenant_id = tid and (assigned_to = app_uid() or assigned_by = app_uid() or sos_perm('sos_manage'))
  returning * into row;
  if not found then raise exception 'task not found or not yours'; end if;
  return to_jsonb(row);
end $$;

-- own open/overdue tasks, plus leads with a follow-up date due (a different table, surfaced together
-- so a field rep has one place to look, not two).
create function sos_my_tasks() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sos_guard();
begin
  return jsonb_build_object(
    'tasks', coalesce((select jsonb_agg(to_jsonb(t) order by t.due_date nulls last, t.created_at)
      from sos_tasks t where t.tenant_id = tid and t.assigned_to = app_uid() and t.status = 'open'), '[]'::jsonb),
    'leadFollowUps', coalesce((select jsonb_agg(jsonb_build_object('leadId', l.id, 'businessName', b.name, 'followUpDate', l.follow_up_date, 'stage', l.stage) order by l.follow_up_date)
      from sos_leads l join sos_businesses b on b.id = l.business_id
      where l.tenant_id = tid and l.owner_id = app_uid() and l.follow_up_date is not null and l.follow_up_date <= current_date and l.stage not in ('won', 'lost')), '[]'::jsonb));
end $$;

create function sos_all_tasks() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_manage');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'assignedToName', coalesce(p.name, u.email),
      'dueDate', t.due_date, 'status', t.status) order by t.due_date nulls last, t.created_at desc)
    from sos_tasks t join auth_users u on u.id = t.assigned_to left join profiles p on p.id = t.assigned_to
    where t.tenant_id = tid), '[]'::jsonb);
end $$;

grant select, insert, update on sos_tasks to app;
grant execute on function sos_task_create(jsonb) to app;
grant execute on function sos_task_set(uuid, text) to app;
grant execute on function sos_my_tasks() to app;
grant execute on function sos_all_tasks() to app;
