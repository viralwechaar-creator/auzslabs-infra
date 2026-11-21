-- AUZslab SalesOS: platform-admin access from the main admin console (site/admin.html), with no
-- separate SalesOS login. A platform admin is not necessarily a member of the auzslab-internal
-- tenant (no profiles row there, no sos_* role) so sos_guard()/sos_perm() would refuse them --
-- these admin_sos_* functions gate on is_platform_admin() instead and resolve the tenant by slug
-- directly, mirroring the equivalent sos_* manager functions' shape so the admin.html UI can
-- reuse the same rendering code. Never registered are any function that only a manager inside
-- the tenant should use (sos_lead_update, sos_task_create, ...) -- this is oversight, not a
-- second staff workspace.
create function admin_sos_tenant() returns uuid language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  select id into tid from tenants where slug = 'auzslab-internal';
  if tid is null then raise exception 'SalesOS has not been set up yet'; end if;
  return tid;
end $$;

-- sos_log() resolves its own tenant via sos_tenant(), which requires the caller to be a member
-- of the auzslab-internal tenant -- a bare platform admin (no profiles row there at all) is not,
-- so every admin_sos_* write below logs through this instead: the tenant is already known
-- (admin_sos_tenant() already checked is_platform_admin()), just insert directly.
create function sos_log_tid(p_tid uuid, p_action text, p_entity text, p_entity_id uuid, p_detail jsonb default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into sos_audit (tenant_id, actor_id, action, entity, entity_id, detail) values (p_tid, app_uid(), p_action, p_entity, p_entity_id, p_detail);
end $$;

-- same reason as sos_log_tid above: sos_notify() resolves its own tenant via sos_tenant(),
-- which a bare platform admin (no profiles row) fails.
create function sos_notify_tid(p_tid uuid, p_recipient uuid, p_kind text, p_title text, p_body text default null, p_entity text default null, p_entity_id uuid default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into sos_notifications (tenant_id, recipient_id, kind, title, body, entity, entity_id) values (p_tid, p_recipient, p_kind, p_title, p_body, p_entity, p_entity_id);
end $$;

create function admin_sos_dashboard() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := admin_sos_tenant(); month_start date := date_trunc('month', current_date)::date;
begin
  return jsonb_build_object(
    'staffCount', (select count(*) from profiles where tenant_id = tid),
    'dealsWonThisMonth', (select count(*) from sos_leads where tenant_id = tid and stage = 'won' and updated_at >= month_start),
    'pipelineValue', (select coalesce(sum(deal_value), 0) from sos_leads where tenant_id = tid and stage not in ('won', 'lost')),
    'flaggedVisits', (select count(*) from sos_visits where tenant_id = tid and status = 'completed' and check_out_at is not null and check_out_at - check_in_at < interval '2 minutes' and flag_reviewed_at is null),
    'pendingExpenses', (select count(*) from sos_expenses where tenant_id = tid and status = 'pending'),
    'pendingApplications', (select count(*) from sos_applications where status = 'pending'));
end $$;

create function admin_sos_team_performance(p_month date default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tid uuid := admin_sos_tenant(); month_start date := date_trunc('month', coalesce(p_month, current_date))::date;
begin
  return coalesce((select jsonb_agg(jsonb_build_object('staffId', u.id, 'name', coalesce(p.name, u.email), 'role', p.role,
      'visitsDone', (select count(*) from sos_visits where tenant_id = tid and staff_id = u.id and status = 'completed' and check_in_at >= month_start),
      'leadsDone', (select count(*) from sos_leads where tenant_id = tid and created_by = u.id and created_at >= month_start),
      'dealsWon', (select count(*) from sos_leads where tenant_id = tid and (owner_id = u.id or created_by = u.id) and stage = 'won' and updated_at >= month_start))
    order by p.role, 2)
    from profiles p join auth_users u on u.id = p.id where p.tenant_id = tid), '[]'::jsonb);
end $$;

create function admin_sos_live_field() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := admin_sos_tenant();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('sessionId', s.id, 'name', coalesce(p.name, u.email), 'status', s.status,
      'lastSample', (select jsonb_build_object('lat', l.lat, 'lng', l.lng, 'at', l.device_at) from sos_location_samples l where l.session_id = s.id order by l.device_at desc limit 1))
    order by s.started_at desc)
    from sos_field_sessions s join auth_users u on u.id = s.staff_id left join profiles p on p.id = s.staff_id
    where s.tenant_id = tid and s.status in ('active', 'paused')), '[]'::jsonb);
end $$;

create function admin_sos_flagged_visits() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := admin_sos_tenant();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'businessName', b.name, 'staffName', coalesce(p.name, u.email),
      'checkInAt', v.check_in_at, 'checkOutAt', v.check_out_at, 'seconds', extract(epoch from v.check_out_at - v.check_in_at),
      'reviewed', v.flag_reviewed_at is not null) order by v.check_in_at desc)
    from sos_visits v join sos_businesses b on b.id = v.business_id join auth_users u on u.id = v.staff_id left join profiles p on p.id = v.staff_id
    where v.tenant_id = tid and v.status = 'completed' and v.check_out_at is not null
      and v.check_out_at - v.check_in_at < interval '2 minutes'), '[]'::jsonb);
end $$;

create function admin_sos_visit_mark_reviewed(p_id uuid, p_note text default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare tid uuid := admin_sos_tenant();
begin
  update sos_visits set flag_reviewed_at = now(), flag_reviewed_by = app_uid(), flag_note = p_note where id = p_id and tenant_id = tid;
  if found then perform sos_log_tid(tid, 'review', 'visit', p_id, jsonb_build_object('note', p_note, 'by', 'platform_admin')); end if;
  return found;
end $$;

create function admin_sos_all_leads() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := admin_sos_tenant();
begin
  return coalesce((select jsonb_agg(sos_lead_json(l) order by l.updated_at desc) from sos_leads l where l.tenant_id = tid), '[]'::jsonb);
end $$;

create function admin_sos_all_expenses(p_status text default 'pending') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tid uuid := admin_sos_tenant();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'staffName', coalesce(p.name, u.email),
      'category', e.category, 'amount', e.amount, 'expenseDate', e.expense_date, 'purpose', e.purpose,
      'status', e.status, 'hasReceipt', e.receipt_file is not null) order by e.expense_date desc)
    from sos_expenses e join auth_users u on u.id = e.staff_id left join profiles p on p.id = e.staff_id
    where e.tenant_id = tid and (p_status = 'all' or e.status = p_status)), '[]'::jsonb);
end $$;

create function admin_sos_expense_review(p_id uuid, p_decision text, p_reject_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tid uuid := admin_sos_tenant(); row sos_expenses%rowtype;
begin
  if p_decision not in ('approved', 'rejected', 'reimbursed') then raise exception 'unknown decision: %', p_decision; end if;
  update sos_expenses set status = p_decision, reviewed_by = app_uid(), reviewed_at = now(),
    reject_reason = case when p_decision = 'rejected' then p_reject_reason else reject_reason end
  where id = p_id and tenant_id = tid
  returning * into row;
  if not found then raise exception 'expense not found'; end if;
  perform sos_notify_tid(tid, row.staff_id, 'expense_' || p_decision, 'Your expense was ' || p_decision, row.purpose, 'expense', p_id);
  perform sos_log_tid(tid, 'review', 'expense', p_id, jsonb_build_object('decision', p_decision, 'by', 'platform_admin'));
  return to_jsonb(row);
end $$;

create function admin_sos_all_tasks() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := admin_sos_tenant();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'assignedToName', coalesce(p.name, u.email),
      'dueDate', t.due_date, 'status', t.status) order by t.due_date nulls last, t.created_at desc)
    from sos_tasks t join auth_users u on u.id = t.assigned_to left join profiles p on p.id = t.assigned_to
    where t.tenant_id = tid), '[]'::jsonb);
end $$;

create function admin_sos_market_intel() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := admin_sos_tenant();
begin
  return jsonb_build_object(
    'totalResponses', (select count(*) from sos_survey_responses where tenant_id = tid),
    'byCategory', coalesce((select jsonb_agg(jsonb_build_object('category', coalesce(category, 'unspecified'), 'count', n) order by n desc)
      from (select b.category, count(*) n from sos_survey_responses r join sos_businesses b on b.id = r.business_id
            where r.tenant_id = tid group by b.category) x), '[]'::jsonb));
end $$;

create function admin_sos_incentive_rule_get() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := admin_sos_tenant(); row sos_incentive_rules%rowtype;
begin
  select * into row from sos_incentive_rules where tenant_id = tid;
  return jsonb_build_object('perDealAmount', coalesce(row.per_deal_amount, 0));
end $$;

create function admin_sos_incentive_rule_set(p_per_deal_amount numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tid uuid := admin_sos_tenant(); row sos_incentive_rules%rowtype;
begin
  if p_per_deal_amount is null or p_per_deal_amount < 0 then raise exception 'Enter an amount of 0 or more'; end if;
  insert into sos_incentive_rules (tenant_id, per_deal_amount, updated_by) values (tid, p_per_deal_amount, app_uid())
  on conflict (tenant_id) do update set per_deal_amount = excluded.per_deal_amount, updated_by = excluded.updated_by, updated_at = now()
  returning * into row;
  perform sos_log_tid(tid, 'set', 'incentive_rule', null, jsonb_build_object('perDealAmount', p_per_deal_amount, 'by', 'platform_admin'));
  return to_jsonb(row);
end $$;

create function admin_sos_announcements() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := admin_sos_tenant();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'senderName', coalesce(pr.name, u.email), 'body', m.body, 'createdAt', m.created_at) order by m.created_at desc)
    from sos_messages m join auth_users u on u.id = m.sender_id left join profiles pr on pr.id = m.sender_id
    where m.tenant_id = tid and m.recipient_id is null
    limit 50), '[]'::jsonb);
end $$;

-- a platform admin posting an announcement has no sos_* role, so this bypasses sos_message_send's
-- own sos_perm('sos_manage') check entirely and fans the notification out directly.
create function admin_sos_announcement_send(p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tid uuid := admin_sos_tenant(); row sos_messages%rowtype; v_recipient_id uuid;
begin
  if nullif(btrim(p_body), '') is null then raise exception 'Write a message first'; end if;
  if length(p_body) > 2000 then raise exception 'Keep a message under 2000 characters'; end if;
  insert into sos_messages (tenant_id, sender_id, recipient_id, body) values (tid, app_uid(), null, btrim(p_body)) returning * into row;
  for v_recipient_id in select id from profiles where tenant_id = tid loop
    perform sos_notify_tid(tid, v_recipient_id, 'announcement', 'Team announcement', left(row.body, 140), 'message', row.id);
  end loop;
  perform sos_log_tid(tid, 'send', 'announcement', row.id, jsonb_build_object('by', 'platform_admin'));
  return to_jsonb(row);
end $$;

create function admin_sos_audit_log(p_limit int default 100) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tid uuid := admin_sos_tenant();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'actorName', coalesce(p.name, u.email), 'action', a.action,
      'entity', a.entity, 'entityId', a.entity_id, 'detail', a.detail, 'createdAt', a.created_at) order by a.created_at desc)
    from sos_audit a left join auth_users u on u.id = a.actor_id left join profiles p on p.id = a.actor_id
    where a.tenant_id = tid
    limit greatest(1, least(coalesce(p_limit, 100), 500))), '[]'::jsonb);
end $$;

create function admin_sos_all_documents() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := admin_sos_tenant();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'label', d.label, 'staffName', coalesce(p.name, u.email),
      'uploaded', d.filename is not null, 'createdAt', d.created_at) order by d.created_at desc)
    from sos_documents d join auth_users u on u.id = d.staff_id left join profiles p on p.id = d.staff_id
    where d.tenant_id = tid), '[]'::jsonb);
end $$;

-- a platform admin reads a staffer's uploaded document the same way a manager would; reuses the
-- existing filename lookup but is_platform_admin()-gated, so /storage/sos-staff-doc's GET route
-- (which calls sos_document_file, scoped to sos_perm('sos_manage')) still refuses a bare
-- platform admin with no SalesOS profile -- route it through this instead.
create function admin_sos_document_file(p_id uuid) returns text language plpgsql stable security definer set search_path = public as $$
declare tid uuid := admin_sos_tenant(); d sos_documents%rowtype;
begin
  select * into d from sos_documents where id = p_id and tenant_id = tid;
  if not found then raise exception 'document not found'; end if;
  return d.filename;
end $$;

grant execute on function admin_sos_tenant() to app;
grant execute on function admin_sos_dashboard() to app;
grant execute on function admin_sos_team_performance(date) to app;
grant execute on function admin_sos_live_field() to app;
grant execute on function admin_sos_flagged_visits() to app;
grant execute on function admin_sos_visit_mark_reviewed(uuid, text) to app;
grant execute on function admin_sos_all_leads() to app;
grant execute on function admin_sos_all_expenses(text) to app;
grant execute on function admin_sos_expense_review(uuid, text, text) to app;
grant execute on function admin_sos_all_tasks() to app;
grant execute on function admin_sos_market_intel() to app;
grant execute on function admin_sos_incentive_rule_get() to app;
grant execute on function admin_sos_incentive_rule_set(numeric) to app;
grant execute on function admin_sos_announcements() to app;
grant execute on function admin_sos_announcement_send(text) to app;
grant execute on function admin_sos_audit_log(int) to app;
grant execute on function admin_sos_all_documents() to app;
grant execute on function admin_sos_document_file(uuid) to app;
