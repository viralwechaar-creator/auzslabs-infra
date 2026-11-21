-- AUZslab SalesOS: append-only audit log (brief's own requirement) + an in-app notification
-- inbox. Reuses the project's established append-only-audit-via-trigger pattern (pos_audit,
-- acc_audit, pay_audit) rather than inventing a new discipline for this module.
create table sos_audit (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  actor_id uuid references auth_users(id),
  action text not null,
  entity text not null,
  entity_id uuid,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index idx_sos_audit_tenant on sos_audit (tenant_id, created_at desc);
alter table sos_audit enable row level security;

-- append-only: no update/delete grant is ever given to app (see grants at the bottom); a
-- defence-in-depth trigger blocks it too, matching pos_audit's own discipline.
create function sos_audit_block_change() returns trigger language plpgsql as $$
begin raise exception 'sos_audit is append-only'; end $$;
create trigger sos_audit_no_change before update or delete on sos_audit
  for each row execute function sos_audit_block_change();

create function sos_log(p_action text, p_entity text, p_entity_id uuid, p_detail jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_tenant();
begin
  insert into sos_audit (tenant_id, actor_id, action, entity, entity_id, detail) values (tid, app_uid(), p_action, p_entity, p_entity_id, p_detail);
end $$;

create function sos_audit_log(p_limit int default 100) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_manage');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'actorName', coalesce(p.name, u.email), 'action', a.action,
      'entity', a.entity, 'entityId', a.entity_id, 'detail', a.detail, 'createdAt', a.created_at) order by a.created_at desc)
    from sos_audit a left join auth_users u on u.id = a.actor_id left join profiles p on p.id = a.actor_id
    where a.tenant_id = tid
    limit greatest(1, least(coalesce(p_limit, 100), 500))), '[]'::jsonb);
end $$;

-- in-app notification inbox (brief section 10). Kept simple and pull-based (no push/email
-- transport exists yet for SalesOS) -- a row per recipient, created by whichever action
-- triggers it (lead assigned, task assigned, expense reviewed, trial about to expire).
create table sos_notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  recipient_id uuid not null references auth_users(id) on delete cascade,
  kind text not null,
  title text not null,
  body text,
  entity text,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_sos_notif_recipient on sos_notifications (tenant_id, recipient_id, read_at, created_at desc);
alter table sos_notifications enable row level security;

create function sos_notify(p_recipient uuid, p_kind text, p_title text, p_body text default null, p_entity text default null, p_entity_id uuid default null) returns void
language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_tenant();
begin
  insert into sos_notifications (tenant_id, recipient_id, kind, title, body, entity, entity_id) values (tid, p_recipient, p_kind, p_title, p_body, p_entity, p_entity_id);
end $$;

create function sos_my_notifications(p_unread_only boolean default false) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sos_guard();
begin
  return coalesce((select jsonb_agg(to_jsonb(n) order by n.created_at desc) from sos_notifications n
    where n.tenant_id = tid and n.recipient_id = app_uid() and (not p_unread_only or n.read_at is null)
    limit 50), '[]'::jsonb);
end $$;

create function sos_notification_mark_read(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_guard();
begin
  update sos_notifications set read_at = now() where id = p_id and tenant_id = tid and recipient_id = app_uid() and read_at is null;
  return found;
end $$;

create function sos_notifications_mark_all_read() returns int
language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_guard(); v_n int;
begin
  update sos_notifications set read_at = now() where tenant_id = tid and recipient_id = app_uid() and read_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- wire sos_log/sos_notify into the three actions the brief calls out: lead assignment,
-- task assignment, expense review. Existing functions are redefined (create or replace) to
-- add the call at the end, rather than adding a second code path.
create or replace function sos_lead_assign(p_id uuid, p_owner uuid) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_manage');
begin
  if p_owner is not null and not exists (select 1 from profiles where id = p_owner and tenant_id = tid) then
    raise exception 'that person is not on this team';
  end if;
  update sos_leads set owner_id = p_owner, updated_at = now() where id = p_id and tenant_id = tid;
  if not found then raise exception 'lead not found'; end if;
  insert into sos_lead_notes (lead_id, author, kind, body) values (p_id, app_uid(), 'assign', 'Reassigned');
  if p_owner is not null then perform sos_notify(p_owner, 'lead_assigned', 'A lead was assigned to you', null, 'lead', p_id); end if;
  perform sos_log('assign', 'lead', p_id, jsonb_build_object('ownerId', p_owner));
end $$;

create or replace function sos_task_create(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_guard(); row sos_tasks%rowtype; v_assignee uuid := coalesce(nullif(p->>'assignedTo', '')::uuid, app_uid());
begin
  if nullif(btrim(p->>'title'), '') is null then raise exception 'Enter a task title'; end if;
  if v_assignee <> app_uid() and not sos_perm('sos_manage') then raise exception 'Only a manager can assign a task to someone else'; end if;
  if not exists (select 1 from profiles where id = v_assignee and tenant_id = tid) then raise exception 'assignee not found'; end if;
  insert into sos_tasks (tenant_id, title, notes, assigned_to, assigned_by, due_date, lead_id, business_id)
  values (tid, btrim(p->>'title'), nullif(p->>'notes', ''), v_assignee, app_uid(), nullif(p->>'dueDate', '')::date,
    nullif(p->>'leadId', '')::uuid, nullif(p->>'businessId', '')::uuid)
  returning * into row;
  if v_assignee <> app_uid() then perform sos_notify(v_assignee, 'task_assigned', 'New task: ' || row.title, null, 'task', row.id); end if;
  perform sos_log('create', 'task', row.id, jsonb_build_object('assignedTo', v_assignee));
  return to_jsonb(row);
end $$;

create or replace function sos_expense_review(p_id uuid, p_decision text, p_reject_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_manage'); row sos_expenses%rowtype;
begin
  if p_decision not in ('approved', 'rejected', 'reimbursed') then raise exception 'unknown decision: %', p_decision; end if;
  update sos_expenses set status = p_decision, reviewed_by = app_uid(), reviewed_at = now(),
    reject_reason = case when p_decision = 'rejected' then p_reject_reason else reject_reason end
  where id = p_id and tenant_id = tid
  returning * into row;
  if not found then raise exception 'expense not found'; end if;
  perform sos_notify(row.staff_id, 'expense_' || p_decision, 'Your expense was ' || p_decision, row.purpose, 'expense', p_id);
  perform sos_log('review', 'expense', p_id, jsonb_build_object('decision', p_decision));
  return to_jsonb(row);
end $$;

grant select, insert on sos_audit to app;
grant select, insert, update on sos_notifications to app;
grant execute on function sos_log(text, text, uuid, jsonb) to app;
grant execute on function sos_audit_log(int) to app;
grant execute on function sos_notify(uuid, text, text, text, text, uuid) to app;
grant execute on function sos_my_notifications(boolean) to app;
grant execute on function sos_notification_mark_read(uuid) to app;
grant execute on function sos_notifications_mark_all_read() to app;
