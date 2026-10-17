-- A general, assignable, trackable task list for the AUZslab team (db/176's role/permission system:
-- is_team_member(), team_role(), team_can_manage(), is_salesman() -- every check below reuses these
-- exactly, never a parallel permission rule).
--
-- Fills a real gap: `leads` and `setup_assignments` are narrow, hardcoded flows; `team_activity` is an
-- append-only AUDIT LOG, not a task with a status someone completes; `admin_post_team_notice` is a
-- one-way broadcast. None of these let an admin or manager hand someone an arbitrary task with a due
-- date that gets tracked to completion. `team_tasks` is that.
--
-- RLS on, NO policies: reachable only through the SECURITY DEFINER functions below (same discipline
-- `leads` / `setup_assignments` already use). No `grant ... to app` needed either -- same precedent as
-- those two tables: every function here is owned by the migration-running role, so it bypasses RLS and
-- needs no Postgres-level grant; Postgres already grants EXECUTE on a new function to PUBLIC.

create table if not exists team_tasks (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  description      text,
  assigned_to      uuid not null references auth_users(id) on delete cascade,
  created_by       uuid references auth_users(id) on delete set null,
  due_at           timestamptz,
  status           text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  priority         text check (priority in ('low', 'normal', 'high')),
  source           text not null default 'manual',   -- 'manual' or 'auto:<rule>' (auto:unassigned_lead / auto:setup_deadline / auto:payment_welcome)
  related_lead_id  uuid references leads(id) on delete set null,
  related_setup_id uuid references setup_assignments(id) on delete set null,
  related_tenant_id uuid references tenants(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  completed_at     timestamptz
);
create index if not exists team_tasks_assignee_idx on team_tasks (assigned_to, status);
create index if not exists team_tasks_status_idx on team_tasks (status);
create index if not exists team_tasks_setup_idx on team_tasks (related_setup_id) where related_setup_id is not null;
create index if not exists team_tasks_lead_idx on team_tasks (related_lead_id) where related_lead_id is not null;
alter table team_tasks enable row level security;

-- ---------------------------------------------------------------- reading one / many as jsonb
create or replace function team_task_row_json(t team_tasks) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', t.id, 'title', t.title, 'description', t.description,
    'assigned_to', t.assigned_to,
    'assignee', (select coalesce(s.name, u.email) from platform_salesmen s join auth_users u on u.id = s.id where s.id = t.assigned_to),
    'created_by', t.created_by,
    'created_by_name', (select coalesce(s.name, u.email) from platform_salesmen s join auth_users u on u.id = s.id where s.id = t.created_by),
    'due_at', t.due_at, 'status', t.status, 'priority', t.priority, 'source', t.source,
    'related_lead_id', t.related_lead_id, 'related_setup_id', t.related_setup_id, 'related_tenant_id', t.related_tenant_id,
    'related_tenant_name', (select name from tenants where id = t.related_tenant_id),
    'related_tenant_slug', (select slug from tenants where id = t.related_tenant_id),
    'related_lead_name', (select coalesce(business, name) from leads where id = t.related_lead_id),
    'created_at', t.created_at, 'updated_at', t.updated_at, 'completed_at', t.completed_at
  )
$$;

create or replace function team_task_json(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select team_task_row_json(t) from team_tasks t where t.id = p_id
$$;

-- ---------------------------------------------------------------- the automation helper
-- Called by triggers and by server-side procedural code (admin_confirm_order_payment). Deliberately
-- simple and trusted: every real call site decides who to assign to and wraps itself so a failure here
-- never blocks the real business action (a lead insert, a setup assignment, a payment confirmation).
create or replace function team_auto_task(p_assignee uuid, p_title text, p_source text, p_related jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_assignee is null then return null; end if;
  insert into team_tasks (title, assigned_to, created_by, source, related_lead_id, related_setup_id, related_tenant_id)
  values (left(coalesce(p_title, 'Task'), 200), p_assignee, null, coalesce(p_source, 'auto'),
          nullif(p_related->>'lead_id', '')::uuid, nullif(p_related->>'setup_id', '')::uuid, nullif(p_related->>'tenant_id', '')::uuid)
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------- create / read / update
-- Any team member with team_can_manage() can create a task and assign it to anyone on the team; a plain
-- salesman/support/setup person can also create a task but only assign it to themselves -- same shape
-- as team_assign_lead()'s own permission check.
create or replace function team_create_task(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_title text; v_assignee uuid; v_can boolean := team_can_manage(); v_id uuid; v_due timestamptz; v_prio text; v_desc text;
begin
  if not is_team_member() then raise exception 'not authorized'; end if;
  v_title := nullif(btrim(coalesce(p->>'title', '')), '');
  if v_title is null then raise exception 'a title is required'; end if;
  v_assignee := nullif(p->>'assigned_to', '')::uuid;
  if v_assignee is null then v_assignee := app_uid(); end if;
  if v_assignee <> app_uid() and not v_can then raise exception 'you can only assign tasks to yourself'; end if;
  if not exists(select 1 from platform_salesmen where id = v_assignee and active) then raise exception 'pick an active team member'; end if;
  v_desc := nullif(left(btrim(coalesce(p->>'description', '')), 2000), '');
  v_due := nullif(p->>'due_at', '')::timestamptz;
  v_prio := nullif(p->>'priority', ''); if v_prio is not null and v_prio not in ('low', 'normal', 'high') then v_prio := null; end if;
  insert into team_tasks (title, description, assigned_to, created_by, due_at, priority, source,
      related_lead_id, related_setup_id, related_tenant_id)
    values (left(v_title, 200), v_desc, v_assignee, app_uid(), v_due, v_prio, 'manual',
      nullif(p->>'related_lead_id', '')::uuid, nullif(p->>'related_setup_id', '')::uuid, nullif(p->>'related_tenant_id', '')::uuid)
    returning id into v_id;
  perform team_log('task_created', v_id::text, v_title, nullif(p->>'related_tenant_id', '')::uuid, v_assignee);
  return team_task_json(v_id);
end $$;

-- the caller's own open + recently-completed (last 14 days) tasks
create or replace function team_my_tasks() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_team_member() then raise exception 'not authorized'; end if;
  return coalesce((
    select jsonb_agg(team_task_row_json(t) order by (t.status <> 'open'), (t.due_at is null), t.due_at, t.created_at desc)
    from team_tasks t
    where t.assigned_to = app_uid()
      and (t.status = 'open' or coalesce(t.completed_at, t.updated_at) > now() - interval '14 days')
  ), '[]'::jsonb);
end $$;

-- admin/manager only: every task across the team, for an overview
create or replace function team_all_tasks() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not team_can_manage() then raise exception 'not authorized'; end if;
  return coalesce((
    select jsonb_agg(team_task_row_json(t) order by (t.status <> 'open'), (t.due_at is null), t.due_at, t.created_at desc)
    from team_tasks t
  ), '[]'::jsonb);
end $$;

-- mark done/cancelled, edit title/description/due date/assignee. Ownership rule: you can always edit
-- your own task; only admin/manager can reassign/edit someone else's.
create or replace function team_update_task(p_id uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t team_tasks%rowtype; v_can boolean := team_can_manage(); v_mine boolean; v_new_assignee uuid;
begin
  if not is_team_member() then raise exception 'not authorized'; end if;
  select * into t from team_tasks where id = p_id for update;
  if not found then raise exception 'task not found'; end if;
  v_mine := (t.assigned_to = app_uid() or t.created_by = app_uid());
  if not v_mine and not v_can then raise exception 'this task is not yours'; end if;

  if p ? 'assigned_to' then
    v_new_assignee := nullif(p->>'assigned_to', '')::uuid;
    if v_new_assignee is distinct from t.assigned_to then
      if not v_can then raise exception 'only a manager can reassign a task'; end if;
      if v_new_assignee is null or not exists(select 1 from platform_salesmen where id = v_new_assignee and active) then
        raise exception 'pick an active team member';
      end if;
      update team_tasks set assigned_to = v_new_assignee where id = p_id;
    end if;
  end if;
  if p ? 'title' then
    update team_tasks set title = left(coalesce(nullif(btrim(p->>'title'), ''), t.title), 200) where id = p_id;
  end if;
  if p ? 'description' then
    update team_tasks set description = nullif(left(btrim(coalesce(p->>'description', '')), 2000), '') where id = p_id;
  end if;
  if p ? 'due_at' then
    update team_tasks set due_at = nullif(p->>'due_at', '')::timestamptz where id = p_id;
  end if;
  if p ? 'priority' then
    update team_tasks set priority = case when p->>'priority' in ('low', 'normal', 'high') then p->>'priority' else null end where id = p_id;
  end if;
  if p ? 'status' then
    if p->>'status' not in ('open', 'done', 'cancelled') then raise exception 'unknown status: %', p->>'status'; end if;
    update team_tasks set status = p->>'status', completed_at = case when p->>'status' = 'done' then now() else null end where id = p_id;
  end if;
  update team_tasks set updated_at = now() where id = p_id;
  return team_task_json(p_id);
end $$;

-- ---------------------------------------------------------------- automation rule (a): unassigned lead -> every active manager
-- "a manager" is ambiguous with several managers, so every active manager gets their own copy; whoever
-- picks up the lead first (assigns it to someone) cancels the other managers' copies automatically.
create or replace function team_task_unassigned_lead() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_label text; m record;
begin
  if new.assigned_to is null then
    v_label := coalesce(new.business, new.name, 'a lead');
    for m in select id from platform_salesmen where active and role = 'manager' loop
      if not exists (select 1 from team_tasks where related_lead_id = new.id and assigned_to = m.id and source = 'auto:unassigned_lead' and status = 'open') then
        perform team_auto_task(m.id, 'Assign this lead: ' || v_label, 'auto:unassigned_lead', jsonb_build_object('lead_id', new.id));
      end if;
    end loop;
  else
    -- someone picked it up (gave it an assignee): the other managers no longer need to
    update team_tasks set status = 'cancelled', updated_at = now()
      where related_lead_id = new.id and source = 'auto:unassigned_lead' and status = 'open';
  end if;
  return new;
exception when others then
  return new; -- a task-creation failure must never block the real lead insert/update
end $$;
drop trigger if exists leads_auto_task on leads;
create trigger leads_auto_task after insert or update of assigned_to on leads
  for each row execute function team_task_unassigned_lead();

-- ---------------------------------------------------------------- automation rule (b): setup deadline approaching
-- Lazy-on-read (no new background worker): called from team_my_setups()/team_list_setups() below, which
-- already run every time someone opens their setups. Idempotent -- checked by source + related_setup_id
-- + status='open' before inserting again.
create or replace function team_check_setup_reminders() returns void
language plpgsql security definer set search_path = public as $$
declare a record; v_name text;
begin
  for a in
    select sa.id, sa.assigned_to, sa.tenant_id, sa.expires_at from setup_assignments sa
    where sa.status = 'open' and sa.expires_at <= now() + interval '2 days'
  loop
    if not exists (select 1 from team_tasks where related_setup_id = a.id and source = 'auto:setup_deadline' and status = 'open') then
      select name into v_name from tenants where id = a.tenant_id;
      perform team_auto_task(a.assigned_to, 'Setup deadline approaching: ' || coalesce(v_name, 'a client'), 'auto:setup_deadline',
        jsonb_build_object('setup_id', a.id, 'tenant_id', a.tenant_id));
    end if;
  end loop;
exception when others then null; -- a reminder-creation failure must never block reading the setups list
end $$;

create or replace function team_my_setups() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_team_member() then raise exception 'not authorized'; end if;
  perform team_check_setup_reminders();
  return coalesce((select jsonb_agg(team_setup_json(a) order by (a.status = 'open') desc, a.created_at desc)
                   from setup_assignments a where a.assigned_to = app_uid() and a.status <> 'cancelled'), '[]'::jsonb);
end $$;

create or replace function team_list_setups() returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not team_can_manage() then raise exception 'not authorized'; end if;
  perform team_check_setup_reminders();
  return coalesce((select jsonb_agg(team_setup_json(a) order by (a.status = 'open') desc, a.created_at desc)
                   from setup_assignments a where a.status <> 'cancelled'), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------- automation rule (c): payment confirmed -> support
-- admin_confirm_order_payment (db/155) already does its work procedurally, so a direct call here (not a
-- trigger on client_orders) is simpler and more reliable. Redefines the whole function (only addition:
-- the task-creation block right before the final return), wrapped so a failure here can never block a
-- real payment confirmation.
create or replace function admin_confirm_order_payment(p_id uuid, p_paid_on date default null, p_utr text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o client_orders; v_paid date; v_fy text; v_n int; v_no text; v_items jsonb := '[]'; l jsonb; v_feats jsonb := '{}'; v_tid uuid; v_req uuid; v_slug text; v_min date := null; v_ren date; v_month numeric := 0; q jsonb; t jsonb; v_utr text; m record;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  select * into o from client_orders where id = p_id for update;
  if o.id is null then raise exception 'not found'; end if;
  if o.status = 'paid' then raise exception 'This order is already paid.'; end if;
  if o.quote is null or o.totals is null then raise exception 'Save the quote first.'; end if;
  v_paid := coalesce(p_paid_on, current_date);
  for l in select * from jsonb_array_elements(o.quote->'items') loop
    v_ren := (v_paid + case when coalesce(l->>'plan', 'month') = 'year' then interval '1 year' else interval '1 month' end)::date;
    v_items := v_items || jsonb_build_array(l || jsonb_build_object('renewal', v_ren));
    v_feats := v_feats || jsonb_build_object(l->>'key', true);
    v_min := least(coalesce(v_min, v_ren), v_ren);
    v_month := v_month + round((coalesce((l->>'rate')::numeric, 0) - coalesce((l->>'discount')::numeric, 0)) / case when coalesce(l->>'plan', 'month') = 'year' then 12 else 1 end, 2);
  end loop;
  q := o.quote || jsonb_build_object('items', v_items);
  t := client_order_totals(q, o.state_code);
  -- access: a new business is created (the account that sent the request becomes its owner); an existing business gets the products added
  if o.kind = 'new' then
    if o.user_id is null then raise exception 'The account that sent this request no longer exists.'; end if;
    v_slug := coalesce(nullif(o.slug, ''), nullif(regexp_replace(lower(coalesce(o.business_name, '')), '[^a-z0-9]', '', 'g'), ''), 'client' || substr(replace(o.id::text, '-', ''), 1, 6));
    v_slug := left(v_slug, 30);
    if exists (select 1 from tenants where slug = v_slug) then v_slug := left(v_slug, 24) || substr(replace(o.id::text, '-', ''), 1, 5); end if;
    insert into signup_requests (user_id, business_name, slug, features, notes, contact_name, phone, niche, address)
      values (o.user_id, o.business_name, v_slug, v_feats, 'From client order ' || o.id::text, o.contact_name, o.phone, o.niche, o.address) returning id into v_req;
    v_tid := approve_signup_request(v_req, coalesce(nullif(o.niche, ''), 'general'));
  else
    v_tid := o.tenant_id;
    if v_tid is null then raise exception 'This request has no business attached.'; end if;
    perform admin_set_tenant_features(v_tid, v_feats);
  end if;
  update tenants set renewal_date = v_min, monthly_fee = (select coalesce(monthly_fee, 0) from tenants where id = v_tid) * (case when o.kind = 'addon' then 1 else 0 end) + v_month, status = 'active' where id = v_tid;
  -- gapless bill number per financial year (April to March)
  v_fy := case when extract(month from v_paid) >= 4 then extract(year from v_paid)::int || '-' || lpad(((extract(year from v_paid)::int + 1) % 100)::text, 2, '0')
               else (extract(year from v_paid)::int - 1) || '-' || lpad((extract(year from v_paid)::int % 100)::text, 2, '0') end;
  insert into client_order_counters (fy, n) values (v_fy, 1) on conflict (fy) do update set n = client_order_counters.n + 1 returning n into v_n;
  v_no := 'AUZ/' || v_fy || '/' || lpad(v_n::text, 4, '0');
  v_utr := nullif(trim(coalesce(p_utr, o.payment->>'utr', '')), '');
  update client_orders set status = 'paid', tenant_id = v_tid, quote = q, totals = t, invoice_no = v_no, invoice_date = v_paid, paid_at = v_paid::timestamptz, updated_at = now(),
    payment = payment || jsonb_build_object('confirmed_at', now(), 'utr', v_utr) where id = p_id;
  perform admin_add_client_payment(v_tid, (t->>'total')::numeric, v_paid, case when v_utr is null then 'other' else 'upi' end, v_utr, 'Order ' || v_no, 'Client request payment');
  perform admin_log('order_paid', 'client_order', p_id::text, jsonb_build_object('business', o.business_name, 'invoice', v_no, 'total', t->'total'));
  -- automation rule (c): a welcome task for every active support team member -- never blocks the payment itself
  begin
    for m in select id from platform_salesmen where active and role = 'support' loop
      perform team_auto_task(m.id, 'Send a welcome message to ' || coalesce(o.business_name, 'the new client'), 'auto:payment_welcome',
        jsonb_build_object('tenant_id', v_tid));
    end loop;
  exception when others then null;
  end;
  return jsonb_build_object('invoice_no', v_no, 'tenant_id', v_tid);
end $$;

-- ---------------------------------------------------------------- admin: fold the open-task count into the one low-request badge call
create or replace function admin_open_counts() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return jsonb_build_object(
    'privacy', (select count(*)::int from data_requests where status in ('open', 'in_progress')),
    'team', (select count(*)::int from team_applications where status = 'new'),
    'tasks', (select count(*)::int from team_tasks where status = 'open'));
end $$;
