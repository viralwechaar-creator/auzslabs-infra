-- =========================================================
-- WhatsApp automation (official WhatsApp Business Cloud API), one sending layer for every app.
--  * Two kinds of sender: the AUZslab platform number (env vars WA_PHONE_NUMBER_ID / WA_ACCESS_TOKEN, no row here)
--    and a shop's own number (wa_accounts, token stored encrypted by the server, never readable from the browser).
--  * A shop sends from its own number when connected; otherwise from the AUZslab number only if the platform admin
--    allowed that shop (wa_tenant_settings.allow_platform). Otherwise the message is logged as skipped and the old
--    tap-to-send wa.me links keep working.
--  * wa_outbox is the queue AND the log: every message, its state, and Meta's delivery receipts.
--  * wa_enqueue() is the one entry point for triggers and server code (idempotent per tenant + template + ref).
--    It is deliberately NOT in the RPC allow-list: browsers can't make us message arbitrary numbers.
-- Nothing is sent until the server has credentials (dormant like every other optional integration).
-- =========================================================

create table if not exists wa_accounts (
  tenant_id       uuid primary key references tenants(id) on delete cascade,
  phone_number_id text not null,
  waba_id         text,
  display_phone   text,
  token_enc       text not null,
  active          boolean not null default true,
  connected_at    timestamptz not null default now()
);
grant select, insert, update, delete on wa_accounts to app;

create table if not exists wa_tenant_settings (
  tenant_id      uuid primary key references tenants(id) on delete cascade,
  enabled        boolean not null default false,   -- owner's master switch
  allow_platform boolean not null default false,   -- platform admin lets this shop send from the AUZslab number
  events         jsonb   not null default '{}'::jsonb, -- template key -> false to switch one message type off
  updated_at     timestamptz not null default now()
);
grant select, insert, update, delete on wa_tenant_settings to app;

-- The catalogue of messages. `name` is the template name that must exist (approved) in the sending WhatsApp account;
-- `body` is the exact text to create there ({{1}} ... in order of `params`). audience: 'platform' = AUZslab's own
-- messages, 'shop' = a client shop messaging its customers.
create table if not exists wa_templates (
  key      text primary key,
  name     text not null,
  language text not null default 'en',
  audience text not null check (audience in ('platform','shop')),
  title    text not null,
  body     text not null,
  params   text[] not null default '{}'
);
grant select on wa_templates to app;

insert into wa_templates (key, name, audience, title, body, params) values
  ('invoice_link',      'auzslab_invoice_link',      'shop',     'Bill to the customer',        'Hi {{1}}, thank you for shopping with {{2}}. Your bill {{3}} for Rs {{4}} is ready: {{5}}', '{customer,shop,bill_no,amount,link}'),
  ('order_received',    'auzslab_order_received',    'shop',     'Order received',              'Hi {{1}}, {{2}} has received your order {{3}}. We will let you know when it is ready.', '{customer,shop,order_no}'),
  ('order_ready',       'auzslab_order_ready',       'shop',     'Order ready',                 'Hi {{1}}, your order {{2}} at {{3}} is ready.', '{customer,order_no,shop}'),
  ('booking_confirmed', 'auzslab_booking_confirmed', 'shop',     'Booking confirmed',           'Hi {{1}}, your booking at {{2}} is confirmed for {{3}} at {{4}}.', '{customer,shop,date,time}'),
  ('booking_reminder',  'auzslab_booking_reminder',  'shop',     'Booking reminder',            'Hi {{1}}, a reminder of your booking at {{2}} on {{3}} at {{4}}. See you soon.', '{customer,shop,date,time}'),
  ('repair_ready',      'auzslab_repair_ready',      'shop',     'Repair ready',                'Hi {{1}}, your {{2}} is repaired and ready to collect from {{3}}.', '{customer,device,shop}'),
  ('payment_due',       'auzslab_payment_due',       'shop',     'Payment due reminder',        'Hi {{1}}, a friendly reminder from {{2}}: Rs {{3}} is pending. Thank you.', '{customer,shop,amount}'),
  ('payslip_ready',     'auzslab_payslip_ready',     'shop',     'Payslip ready (staff)',       'Hi {{1}}, your payslip for {{2}} from {{3}} is ready in the app.', '{employee,month,shop}'),
  ('quote_payment_link','auzslab_quote_payment',     'platform', 'Quote and payment link',      'Hi {{1}}, your AUZslab quote is ready. Please review and pay here: {{2}}', '{customer,link}'),
  ('bill_paid',         'auzslab_bill_paid',         'platform', 'Payment received + GST bill', 'Thank you {{1}}. We received your payment. Your GST bill {{2}}: {{3}}', '{customer,bill_no,link}'),
  ('renewal_reminder',  'auzslab_renewal_reminder',  'platform', 'Renewal reminder',            'Hi {{1}}, your AUZslab plan for {{2}} renews in {{3}} days (on {{4}}). Reply here if you need help.', '{customer,business,days,date}'),
  ('request_update',    'auzslab_request_update',    'platform', 'Request status update',       'Hi {{1}}, an update on your AUZslab request: {{2}}.', '{customer,status}'),
  ('welcome',           'auzslab_welcome',           'platform', 'Welcome',                     'Welcome to AUZslab, {{1}}. Your business address is {{2}}. We are here if you need anything.', '{customer,address}')
on conflict (key) do update set name = excluded.name, audience = excluded.audience, title = excluded.title,
  body = excluded.body, params = excluded.params;

create table if not exists wa_optouts (
  tenant_id uuid,                       -- null = opted out of AUZslab's own messages
  phone     text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists wa_optouts_uq on wa_optouts (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), phone);
grant select, insert, delete on wa_optouts to app;

create table if not exists wa_outbox (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid references tenants(id) on delete cascade,  -- null = AUZslab's own message
  to_phone      text not null,
  template      text not null references wa_templates(key),
  params        jsonb not null default '[]'::jsonb,             -- ordered list of strings
  ref           text,                                           -- caller's idempotency key (bill id, booking id ...)
  status        text not null default 'queued'
                check (status in ('queued','sending','sent','delivered','read','failed','skipped')),
  error         text,
  wa_message_id text,
  sender        text,                                           -- 'own' | 'platform'
  attempts      int  not null default 0,
  run_after     timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists wa_outbox_ref_uq on wa_outbox (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), template, ref) where ref is not null;
create index if not exists wa_outbox_queue_ix on wa_outbox (run_after) where status = 'queued';
create index if not exists wa_outbox_msgid_ix on wa_outbox (wa_message_id) where wa_message_id is not null;
create index if not exists wa_outbox_tenant_ix on wa_outbox (tenant_id, created_at desc);
grant select, insert, update, delete on wa_outbox to app;

-- 10 digits -> India (91); 0-prefixed 11 digits -> India; otherwise digits as given (must be 11-15 long).
create or replace function wa_norm_phone(p text) returns text language plpgsql immutable as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if length(d) = 10 then return '91' || d; end if;
  if length(d) = 11 and left(d, 1) = '0' then return '91' || substr(d, 2); end if;
  if length(d) between 11 and 15 then return d; end if;
  return null;
end $$;

-- The single entry point. Returns the outbox id, or null when nothing was queued (opted out, bad number, switched off).
-- Idempotent: the same (tenant, template, ref) never queues twice.
create or replace function wa_enqueue(p_tenant uuid, p_to text, p_template text, p_params jsonb, p_ref text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare ph text := wa_norm_phone(p_to); t wa_templates%rowtype; s wa_tenant_settings%rowtype; v_id uuid;
begin
  if ph is null then return null; end if;
  select * into t from wa_templates where key = p_template;
  if not found then return null; end if;
  if p_tenant is null then
    if t.audience <> 'platform' then return null; end if;
    -- AUZslab's own automatic messages stay off until the admin turns them on (so nothing doubles with the manual wa.me buttons by surprise)
    if coalesce((select value from platform_flags where key = 'whatsapp_platform_auto'), 'off') <> 'on' then return null; end if;
  else
    if t.audience <> 'shop' then return null; end if;
    select * into s from wa_tenant_settings where tenant_id = p_tenant;
    if not found or not s.enabled then return null; end if;
    if (s.events ->> p_template) = 'false' then return null; end if;
  end if;
  if exists (select 1 from wa_optouts o where o.phone = ph and o.tenant_id is not distinct from p_tenant) then return null; end if;
  insert into wa_outbox (tenant_id, to_phone, template, params, ref)
  values (p_tenant, ph, p_template, coalesce(p_params, '[]'::jsonb), p_ref)
  on conflict do nothing returning id into v_id;
  return v_id;
end $$;

-- ---------- tenant (owner/manager) API ----------
create or replace function wa_my_status() returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; r jsonb;
begin
  select tenant_id into tid from profiles where id = app_uid() and role in ('owner','manager');
  if tid is null then raise exception 'owner access required'; end if;
  select jsonb_build_object(
    'connected', exists (select 1 from wa_accounts a where a.tenant_id = tid and a.active),
    'number',    (select display_phone from wa_accounts a where a.tenant_id = tid),
    'enabled',   coalesce((select enabled from wa_tenant_settings where tenant_id = tid), false),
    'allow_platform', coalesce((select allow_platform from wa_tenant_settings where tenant_id = tid), false),
    'events',    coalesce((select events from wa_tenant_settings where tenant_id = tid), '{}'::jsonb),
    'templates', (select coalesce(jsonb_agg(to_jsonb(x) order by x.key), '[]'::jsonb) from (select key, name, language, title, body, params from wa_templates where audience = 'shop') x),
    'recent',    (select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) from (
                    select id, to_phone, template, status, error, sender, created_at from wa_outbox
                    where tenant_id = tid order by created_at desc limit 30) m),
    'counts',    (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (
                    select status, count(*) n from wa_outbox where tenant_id = tid and created_at > now() - interval '30 days' group by status) c)
  ) into r;
  return r;
end $$;

create or replace function wa_save_settings(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; ev jsonb := coalesce(p -> 'events', '{}'::jsonb);
begin
  select tenant_id into tid from profiles where id = app_uid() and role = 'owner';
  if tid is null then raise exception 'owner access required'; end if;
  if jsonb_typeof(ev) <> 'object' then raise exception 'invalid events'; end if;
  -- only known shop templates, only booleans
  ev := (select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(ev) e(k, v)
         where jsonb_typeof(v) = 'boolean' and exists (select 1 from wa_templates t where t.key = k and t.audience = 'shop'));
  insert into wa_tenant_settings (tenant_id, enabled, events) values (tid, coalesce((p ->> 'enabled')::boolean, false), ev)
  on conflict (tenant_id) do update set enabled = excluded.enabled, events = excluded.events, updated_at = now();
  return jsonb_build_object('ok', true);
end $$;

create or replace function wa_disconnect() returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  select tenant_id into tid from profiles where id = app_uid() and role = 'owner';
  if tid is null then raise exception 'owner access required'; end if;
  delete from wa_accounts where tenant_id = tid;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- platform admin API ----------
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
    'platform_auto', coalesce((select value from platform_flags where key = 'whatsapp_platform_auto'), 'off') = 'on',
    'platform_counts', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb) from (
        select status, count(*) n from wa_outbox where tenant_id is null and created_at > now() - interval '30 days' group by status) c),
    'recent', (select coalesce(jsonb_agg(to_jsonb(m)), '[]'::jsonb) from (
        select o.id, t.name as tenant, o.to_phone, o.template, o.status, o.error, o.sender, o.created_at
        from wa_outbox o left join tenants t on t.id = o.tenant_id order by o.created_at desc limit 50) m),
    'templates', (select coalesce(jsonb_agg(to_jsonb(x) order by x.audience, x.key), '[]'::jsonb) from (
        select key, name, language, audience, title, body, params from wa_templates) x));
end $$;

create or replace function admin_wa_set_tenant(p_tenant uuid, p_allow_platform boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'admin access required'; end if;
  insert into wa_tenant_settings (tenant_id, allow_platform) values (p_tenant, coalesce(p_allow_platform, false))
  on conflict (tenant_id) do update set allow_platform = excluded.allow_platform, updated_at = now();
  perform admin_log('wa_allow_platform', 'tenant', p_tenant::text, jsonb_build_object('allow', p_allow_platform));
  return jsonb_build_object('ok', true);
end $$;

create or replace function admin_wa_set_platform_auto(p_on boolean) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'admin access required'; end if;
  insert into platform_flags (key, value) values ('whatsapp_platform_auto', case when p_on then 'on' else 'off' end)
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform admin_log('wa_platform_auto', 'platform', 'whatsapp', jsonb_build_object('on', p_on));
  return jsonb_build_object('ok', true, 'on', p_on);
end $$;

-- ---------- AUZslab's own messages: follow the client request / bill ----------
create or replace function wa_site_url() returns text language sql stable set search_path = public as $$
  select coalesce((select value from platform_flags where key = 'public_site_url'), 'https://auzslab.in')
$$;

create or replace function wa_client_order_msg() returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.phone is null or new.status is not distinct from old.status then return new; end if;
    if new.status = 'link_sent' then
      perform wa_enqueue(null, new.phone, 'quote_payment_link', jsonb_build_array(coalesce(new.contact_name, 'there'), wa_site_url() || '/pay.html?t=' || new.token), new.id || '-quote');
    elsif new.status = 'paid' and new.invoice_no is not null then
      perform wa_enqueue(null, new.phone, 'bill_paid', jsonb_build_array(coalesce(new.contact_name, 'there'), new.invoice_no, wa_site_url() || '/inv.html?t=' || new.token), new.id || '-paid');
    elsif new.status in ('verifying', 'confirmed', 'rejected') then
      perform wa_enqueue(null, new.phone, 'request_update', jsonb_build_array(coalesce(new.contact_name, 'there'),
        case new.status when 'verifying' then 'we are checking your request and will be in touch shortly'
                        when 'confirmed' then 'your request is confirmed and your payment link will follow'
                        else 'we could not take this request forward, please call us on +91 9251250829' end), new.id || '-' || new.status);
    end if;
  exception when others then null; -- a message must never block the admin's action
  end;
  return new;
end $$;
drop trigger if exists client_orders_wa on client_orders;
create trigger client_orders_wa after update of status on client_orders for each row execute function wa_client_order_msg();

-- ---------- Client shops' customer messages ----------
-- A booking confirmed (salon / reservation tables use `bookings`).
create or replace function wa_booking_msg() returns trigger language plpgsql security definer set search_path = public as $$
declare shop text;
begin
  begin
    if new.status = 'confirmed' and (tg_op = 'INSERT' or old.status is distinct from 'confirmed') then
      select name into shop from tenants where id = new.tenant_id;
      perform wa_enqueue(new.tenant_id, new.customer_phone, 'booking_confirmed',
        jsonb_build_array(new.customer_name, coalesce(shop, 'us'), to_char(new.date, 'DD Mon YYYY'), coalesce(to_char(new.time, 'HH12:MI AM'), 'the booked time')), new.id::text);
    end if;
  exception when others then null;
  end;
  return new;
end $$;
drop trigger if exists bookings_wa on bookings;
create trigger bookings_wa after insert or update of status on bookings for each row execute function wa_booking_msg();

-- AUZsMob: the repair is ready to collect.
create or replace function wa_repair_ready_msg() returns trigger language plpgsql security definer set search_path = public as $$
declare r mob_repairs%rowtype; shop text;
begin
  begin
    if new.type = 'status' and new.status = 'ready' then
      select * into r from mob_repairs where id = new.repair_id;
      if found and r.customer_phone is not null then
        select name into shop from tenants where id = r.tenant_id;
        perform wa_enqueue(r.tenant_id, r.customer_phone, 'repair_ready', jsonb_build_array(coalesce(r.customer_name, 'there'), coalesce(r.device_model, 'phone'), coalesce(shop, 'our shop')), new.repair_id::text);
      end if;
    end if;
  exception when others then null;
  end;
  return new;
end $$;
drop trigger if exists mob_repair_events_wa on mob_repair_events;
create trigger mob_repair_events_wa after insert on mob_repair_events for each row execute function wa_repair_ready_msg();
