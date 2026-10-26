-- =========================================================
-- One notification inbox for everyone: admin, team, clients (with or without a business).
--  * notifications.user_id: a notice for ONE person (a client's quote, a team member's task).
--    Existing rows keep working: tenant_id null + user_id null = for the admin; tenant_id set = the business's staff.
--  * inbox_list / inbox_mark_read: the single read path for the bell (website, admin panel, account page, team workspace).
--  * New sources: client request progress (quote ready, payment received, bill), team assignments / tasks / notices /
--    team work (for supervisors), and system alerts (WhatsApp messages that failed).
--  * Browser alerts may now be registered by any signed-in person (clients too), sent only to the person named in a notice.
-- Every trigger swallows its own errors: an alert must never block the real action.
-- =========================================================

alter table notifications add column if not exists user_id uuid references auth_users(id) on delete cascade;
create index if not exists idx_notifications_user on notifications (user_id, created_at desc) where user_id is not null;

-- ---------- reading ----------
create or replace function inbox_list(p_limit int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v uuid := app_uid(); v_tid uuid; v_sup boolean; v_items jsonb; v_unread int;
begin
  if v is null then raise exception 'authentication required'; end if;
  begin v_tid := (me()->>'tenant_id')::uuid; exception when others then v_tid := null; end;
  v_sup := is_platform_admin() or v = any(platform_supervisor_ids());
  with mine as (
    select n.* from notifications n
    where (n.user_id = v)
       or (n.user_id is null and n.tenant_id is null and v_sup)
       or (n.user_id is null and n.tenant_id is not null and n.tenant_id = v_tid)
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'type', x.type, 'title', x.title, 'body', x.body, 'link', x.link,
           'read', x.read, 'created_at', x.created_at) order by x.created_at desc), '[]'::jsonb)
    into v_items
  from (select * from mine order by created_at desc limit least(greatest(coalesce(p_limit, 30), 1), 100)) x;
  select count(*) into v_unread from notifications n
    where not n.read and ((n.user_id = v) or (n.user_id is null and n.tenant_id is null and v_sup)
       or (n.user_id is null and n.tenant_id is not null and n.tenant_id = v_tid));
  return jsonb_build_object('items', v_items, 'unread', v_unread);
end $$;

create or replace function inbox_mark_read(p_ids uuid[] default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := app_uid(); v_tid uuid; v_sup boolean; n int;
begin
  if v is null then raise exception 'authentication required'; end if;
  begin v_tid := (me()->>'tenant_id')::uuid; exception when others then v_tid := null; end;
  v_sup := is_platform_admin() or v = any(platform_supervisor_ids());
  update notifications x set read = true
   where not x.read and (p_ids is null or x.id = any(p_ids))
     and ((x.user_id = v) or (x.user_id is null and x.tenant_id is null and v_sup)
       or (x.user_id is null and x.tenant_id is not null and x.tenant_id = v_tid));
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'marked', n);
end $$;

-- ---------- browser alerts for anyone signed in ----------
create or replace function register_platform_web_push(p_endpoint text, p_p256dh text, p_auth text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v uuid := app_uid();
begin
  if v is null then raise exception 'authentication required'; end if;
  if coalesce(p_endpoint, '') !~ '^https://' or length(p_endpoint) > 2000 or coalesce(length(p_p256dh), 0) < 20 or coalesce(length(p_auth), 0) < 8 then raise exception 'invalid subscription'; end if;
  insert into platform_web_push (user_id, endpoint, p256dh, auth) values (v, p_endpoint, p_p256dh, p_auth)
    on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
  return jsonb_build_object('ok', true);
end $$;

-- a notice for one person is also pushed to that person (team notices and assignments are pushed elsewhere: type team_*)
create or replace function notification_user_push() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is not null and new.type not like 'team\_%' then
    perform notify_platform_push(array[new.user_id], new.title, new.body);
  end if;
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists notifications_user_push on notifications;
create trigger notifications_user_push after insert on notifications for each row execute function notification_user_push();

-- ---------- client side: progress of a request ----------
create or replace function client_order_inbox() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_t text; v_b text; v_l text;
begin
  if new.user_id is null then return new; end if;
  if tg_op = 'INSERT' then
    v_t := 'We received your request'; v_b := 'We will check it and send you a quote. Nothing to pay yet.';
  elsif new.status is distinct from old.status then
    if new.status = 'verifying' then v_t := 'We are checking your request'; v_b := 'We will be in touch shortly.';
    elsif new.status = 'confirmed' then v_t := 'Your request is confirmed'; v_b := 'Your quote and payment link will follow.';
    elsif new.status = 'link_sent' then v_t := 'Your quote is ready'; v_b := 'Open it, read the terms and pay online or in cash.'; v_l := 'https://auzslab.in/pay.html?t=' || new.token;
    elsif new.status = 'paid' then v_t := 'Payment received'; v_b := 'Thank you. Your bill ' || coalesce(new.invoice_no, '') || ' is ready.'; v_l := 'https://auzslab.in/inv.html?t=' || new.token;
    elsif new.status = 'rejected' then v_t := 'An update on your request'; v_b := 'We could not take this request forward. Please call us on +91 9251250829.';
    end if;
  end if;
  if v_t is not null then
    insert into notifications (tenant_id, user_id, type, title, body, link) values (null, new.user_id, 'client_order', v_t, v_b, v_l);
  end if;
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists client_orders_inbox on client_orders;
create trigger client_orders_inbox after insert or update of status on client_orders for each row execute function client_order_inbox();

-- ---------- team side ----------
create or replace function team_activity_inbox() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text; r uuid;
begin
  if new.kind = 'lead_assigned' and new.uid is not null then
    insert into notifications (tenant_id, user_id, type, title, body) values (null, new.uid, 'team_assign', 'A lead was assigned to you', new.label);
  elsif new.kind = 'setup_assigned' and new.uid is not null then
    insert into notifications (tenant_id, user_id, type, title, body) values (null, new.uid, 'team_assign', 'A client setup was assigned to you', new.label);
  elsif new.kind in ('lead_added', 'lead_stage', 'trial_created', 'setup_done') then
    select coalesce(nullif(name, ''), 'A team member') into who from platform_salesmen where id = new.uid;
    for r in select unnest(platform_supervisor_ids(new.uid)) loop
      insert into notifications (tenant_id, user_id, type, title, body) values (null, r, 'team_work',
        case new.kind when 'lead_added' then 'New lead' when 'lead_stage' then 'Lead updated' when 'trial_created' then 'New trial created' else 'Client setup finished' end,
        coalesce(who, 'A team member') || ' · ' || coalesce(new.label, ''));
    end loop;
  end if;
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists team_activity_inbox_trg on team_activity;
create trigger team_activity_inbox_trg after insert on team_activity for each row execute function team_activity_inbox();

create or replace function team_notice_inbox() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into notifications (tenant_id, user_id, type, title, body)
  select null, s.id, 'team_notice', 'Notice: ' || new.title, new.body from platform_salesmen s
   where s.active and s.id is distinct from new.created_by and (new.audience = 'all' or s.role = new.audience);
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists team_notice_inbox_trg on team_notices;
create trigger team_notice_inbox_trg after insert on team_notices for each row execute function team_notice_inbox();

create or replace function team_task_inbox() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.assigned_to is not null and new.assigned_to is distinct from new.created_by
     and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) then
    insert into notifications (tenant_id, user_id, type, title, body)
    values (null, new.assigned_to, 'task', 'A task was assigned to you', new.title);
  end if;
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists team_task_inbox_trg on team_tasks;
create trigger team_task_inbox_trg after insert or update of assigned_to on team_tasks for each row execute function team_task_inbox();

-- ---------- system alert: WhatsApp messages that failed (at most one notice an hour) ----------
create or replace function wa_failed_alert() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'failed' and old.status is distinct from 'failed'
     and not exists (select 1 from notifications where tenant_id is null and user_id is null and type = 'system_wa' and created_at > now() - interval '1 hour') then
    insert into notifications (tenant_id, type, title, body)
    values (null, 'system_wa', 'A WhatsApp message failed to send', left(coalesce(new.template, '') || ': ' || coalesce(new.error, 'unknown error'), 250) || '. Open Admin, WhatsApp.');
  end if;
  return new;
exception when others then
  return new;
end $$;
drop trigger if exists wa_outbox_failed_alert on wa_outbox;
create trigger wa_outbox_failed_alert after update of status on wa_outbox for each row execute function wa_failed_alert();
