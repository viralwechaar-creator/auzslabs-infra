-- Small automations that save the owner manual chasing (all quiet no-ops when WhatsApp is off):
--  * an unpaid quote gets a reminder to the client after 2 days (and again after 5), and the admin is told
--  * a daily summary for the AUZslab owner (push notification always; WhatsApp when an admin phone is set)
--  * a paid new business gets a setup task for every active setup person
--  * a failed online payment sends the client a "try again" link
-- Every function is trusted-backend-only (not in the RPC allow-list), called by the daily job in maintenance.js.

insert into platform_flags (key, value) values ('admin_phone', '') on conflict (key) do nothing;

insert into wa_templates (key, name, audience, title, body, params) values
  ('admin_daily_summary', 'auzslab_admin_daily_summary', 'platform', 'AUZslab daily summary',
   'Hi {{1}}, AUZslab today: {{2}} new requests, {{3}} unpaid quotes, {{4}} renewals due this week. Have a good day.',
   '{name,new_requests,unpaid_quotes,renewals}')
on conflict (key) do nothing;

-- 1) unpaid quotes ----------------------------------------------------------------------------
create or replace function quote_followup_run() returns jsonb
language plpgsql security definer set search_path = public as $$
declare o record; n int := 0; stage text; v_ref text;
begin
  for o in select id, token, contact_name, phone, business_name, updated_at from client_orders
           where status = 'link_sent' and updated_at < now() - interval '2 days' and phone is not null loop
    stage := case when o.updated_at < now() - interval '5 days' then 'qf2' else 'qf1' end;
    v_ref := o.id || '-' || stage;
    if exists (select 1 from wa_outbox where template = 'request_update' and tenant_id is null and ref = v_ref) then continue; end if;
    begin
      perform wa_enqueue(null, o.phone, 'request_update', jsonb_build_array(coalesce(o.contact_name, 'there'),
        'your quote is still waiting. You can review and pay here ' || wa_site_url() || '/pay.html?t=' || o.token || ' and reply here if you have any question'), v_ref);
      insert into notifications (tenant_id, type, title, body)
        values (null, 'quote_followup', 'Unpaid quote: ' || coalesce(o.business_name, 'a client'), 'Reminder sent to the client (' || stage || ').');
      n := n + 1;
    exception when others then null;
    end;
  end loop;
  return jsonb_build_object('followed_up', n);
end $$;

-- 2) daily summary ------------------------------------------------------------------------------
create or replace function admin_daily_summary_run() returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_new int; v_unpaid int; v_ren int; v_phone text; v_body text;
begin
  select count(*) into v_new from client_orders where created_at > now() - interval '1 day';
  select count(*) into v_unpaid from client_orders where status = 'link_sent';
  select count(*) into v_ren from tenants where renewal_date is not null and renewal_date between current_date and current_date + 7 and coalesce(is_demo, false) = false;
  v_body := v_new || ' new requests, ' || v_unpaid || ' unpaid quotes, ' || v_ren || ' renewals due this week';
  insert into notifications (tenant_id, type, title, body) values (null, 'daily_summary', 'AUZslab today', v_body);
  select nullif(value, '') into v_phone from platform_flags where key = 'admin_phone';
  if v_phone is not null then
    begin
      perform wa_enqueue(null, v_phone, 'admin_daily_summary', jsonb_build_array('there', v_new::text, v_unpaid::text, v_ren::text), 'sum-' || current_date);
    exception when others then null;
    end;
  end if;
  return jsonb_build_object('new', v_new, 'unpaid', v_unpaid, 'renewals', v_ren);
end $$;

-- 3) a paid new business gets a setup task for every active setup person -----------------------
create or replace function client_order_setup_task() returns trigger
language plpgsql security definer set search_path = public as $$
declare m record;
begin
  begin
    if new.status = 'paid' and new.kind = 'new' and new.tenant_id is not null
       and (tg_op = 'UPDATE' and (old.status is distinct from 'paid' or old.tenant_id is null))
       and not exists (select 1 from team_tasks where source = 'auto:payment_setup' and related_tenant_id = new.tenant_id) then
      for m in select id from platform_salesmen where role = 'setup' and active loop
        perform team_auto_task(m.id, 'Set up ' || coalesce(new.business_name, 'the new business'), 'auto:payment_setup', jsonb_build_object('tenant_id', new.tenant_id));
      end loop;
    end if;
  exception when others then null;
  end;
  return new;
end $$;
drop trigger if exists client_orders_setup_task on client_orders;
create trigger client_orders_setup_task after update of status, tenant_id on client_orders for each row execute function client_order_setup_task();

-- 4) a failed online payment: tell the client how to try again ---------------------------------
create or replace function payment_failed_retry_msg() returns trigger
language plpgsql security definer set search_path = public as $$
declare o client_orders%rowtype;
begin
  begin
    if new.status = 'failed' and old.status is distinct from 'failed' and new.client_order_id is not null then
      select * into o from client_orders where id = new.client_order_id;
      if found and o.phone is not null and o.status <> 'paid' then
        perform wa_enqueue(null, o.phone, 'request_update', jsonb_build_array(coalesce(o.contact_name, 'there'),
          'your payment did not go through, nothing was charged. You can try again here ' || wa_site_url() || '/pay.html?t=' || o.token), new.id::text || '-retry');
      end if;
    end if;
  exception when others then null;
  end;
  return new;
end $$;
drop trigger if exists payments_failed_retry on payments;
create trigger payments_failed_retry after update of status on payments for each row execute function payment_failed_retry_msg();

-- 5) the owner's number for the daily summary (Admin -> WhatsApp)
create or replace function admin_wa_overview() returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'admin access required'; end if;
  return jsonb_build_object(
    'tenants', (select coalesce(jsonb_agg(to_jsonb(x) order by x.name), '[]'::jsonb) from (
        select t.id, t.name, t.slug,
               exists (select 1 from wa_accounts a where a.tenant_id = t.id and a.active) as own_number,
               coalesce(s.enabled, false) as enabled, coalesce(s.allow_platform, false) as allow_platform,
               (select count(*) from wa_outbox o where o.tenant_id = t.id and o.created_at > now() - interval '30 days') as sent_30d
        from tenants t left join wa_tenant_settings s on s.tenant_id = t.id
        where coalesce(t.is_demo, false) = false order by t.name limit 500) x),
    'admin_phone', coalesce((select value from platform_flags where key = 'admin_phone'), ''),
    'platform_auto', coalesce((select value from platform_flags where key = 'whatsapp_platform_auto'), 'off') = 'on',
    'platform_counts', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (
        select status, count(*) n from wa_outbox where tenant_id is null and created_at > now() - interval '30 days' group by status) c),
    'recent', (select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) from (
        select o.id, t.name as tenant, o.to_phone, o.template, o.status, o.error, o.sender, o.created_at
        from wa_outbox o left join tenants t on t.id = o.tenant_id order by o.created_at desc limit 50) m),
    'templates', (select coalesce(jsonb_agg(to_jsonb(x) order by x.audience, x.key), '[]'::jsonb) from (
        select key, name, language, audience, title, body, params from wa_templates) x));
end $$;

create or replace function admin_set_admin_phone(p_phone text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
begin
  if not is_platform_admin() then raise exception 'admin access required'; end if;
  if v <> '' and length(v) < 10 then raise exception 'Enter a 10-digit mobile number'; end if;
  insert into platform_flags (key, value) values ('admin_phone', v) on conflict (key) do update set value = excluded.value;
  return jsonb_build_object('admin_phone', v);
end $$;
