-- Storefront round I: finer permissions, an activity log, staff security view, customer message log, billing history.
--  * New permission keys sit under the old two. A custom role that has sfx_manage but says nothing about a new key keeps working as before;
--    to take one away, the role must say false for that key. Managers get all of them except sfx_staff. Staff with neither get view only.
--  * Money and settings changes (refunds, store credit, tax, checkout rules, shipping, restoring a saved version) now check their own key and are logged.
create or replace function sfx_perm(k text) returns boolean language plpgsql stable security definer set search_path = public as $$
declare r text; rid uuid; perms jsonb; tid uuid; fine boolean := k in ('sfx_orders', 'sfx_products', 'sfx_customers', 'sfx_marketing', 'sfx_content', 'sfx_settings', 'sfx_refunds', 'sfx_staff');
begin
  r := me()->>'role'; tid := (me()->>'tenant_id')::uuid;
  if r is null or tid is null then return false; end if;
  if r = 'owner' then return true; end if;
  select role_id into rid from profiles where id = app_uid();
  if rid is not null then
    select permissions into perms from roles where id = rid and tenant_id = tid;
    if perms is not null then
      if perms ? k then return coalesce((perms->>k)::boolean, false); end if;
      if fine then return coalesce((perms->>'sfx_manage')::boolean, false) and k <> 'sfx_staff'; end if;
      return false;
    end if;
  end if;
  if r = 'manager' then return k in ('sfx_view', 'sfx_manage') or (fine and k <> 'sfx_staff'); end if;
  return k = 'sfx_view';
end $$;
create or replace function sfx_perms() returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_object_agg(k, sfx_perm(k)) from unnest(array['sfx_view', 'sfx_manage', 'sfx_orders', 'sfx_products', 'sfx_customers', 'sfx_marketing', 'sfx_content', 'sfx_settings', 'sfx_refunds', 'sfx_staff']) k
$$;
create function sfx_require(k text) returns uuid language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage');
begin
  if not sfx_perm(k) then raise exception 'Your role does not allow this (%)', k using errcode = '42501'; end if;
  return tid;
end $$;

create table sfx_audit (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  actor uuid, actor_name text, action text not null, detail jsonb not null default '{}'::jsonb, at timestamptz not null default now()
);
create index idx_sfx_audit on sfx_audit (tenant_id, at desc);
alter table sfx_audit enable row level security;
grant select, insert on sfx_audit to app;
grant usage on sequence sfx_audit_id_seq to app;
create function sfx_audit_log(p_action text, p_detail jsonb) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid := (me()->>'tenant_id')::uuid;
begin
  if tid is null then return; end if;
  insert into sfx_audit (tenant_id, actor, actor_name, action, detail) values (tid, app_uid(), (select coalesce(name, email) from profiles where id = app_uid()), left(p_action, 80), coalesce(p_detail, '{}'::jsonb));
exception when others then null;   -- a log problem must never block the real action
end $$;
create function sfx_audit_list(p_limit int default 100) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin
  if not sfx_perm('sfx_settings') then raise exception 'Your role does not allow this (sfx_settings)' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('who', coalesce(actor_name, 'Someone'), 'action', action, 'detail', detail, 'at', at) order by at desc) from (select * from sfx_audit where tenant_id = tid order by at desc limit greatest(1, least(coalesce(p_limit, 100), 500))) a), '[]'::jsonb);
end $$;

-- ----- wrap the sensitive actions: own permission key first, then a log line after -----
alter function sfx_refund_record(uuid, jsonb) rename to sfx_refund_record_pre427;
create function sfx_refund_record(p_order uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin perform sfx_require('sfx_refunds'); res := sfx_refund_record_pre427(p_order, p); perform sfx_audit_log('Recorded a refund', jsonb_build_object('order', p_order, 'amount', p->>'amount', 'method', p->>'method')); return res; end $$;
alter function sfx_credit_adjust(uuid, numeric, text) rename to sfx_credit_adjust_pre427;
create function sfx_credit_adjust(p_customer uuid, p_delta numeric, p_note text) returns jsonb language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin perform sfx_require('sfx_refunds'); res := sfx_credit_adjust_pre427(p_customer, p_delta, p_note); perform sfx_audit_log('Changed store credit', jsonb_build_object('customer', p_customer, 'amount', p_delta)); return res; end $$;
alter function sfx_return_set(uuid, text, numeric) rename to sfx_return_set_pre427;
create function sfx_return_set(p_id uuid, p_status text, p_amount numeric default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin
  if p_status = 'refunded' then perform sfx_require('sfx_refunds'); end if;
  res := sfx_return_set_pre427(p_id, p_status, p_amount);
  if p_status = 'refunded' then perform sfx_audit_log('Refunded a return', jsonb_build_object('return', p_id, 'amount', p_amount)); end if;
  return res;
end $$;
alter function sfx_tax_settings_save(jsonb) rename to sfx_tax_settings_save_pre427;
create function sfx_tax_settings_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin perform sfx_require('sfx_settings'); res := sfx_tax_settings_save_pre427(p); perform sfx_audit_log('Changed tax settings', jsonb_build_object('rate', p->>'rate', 'inclusive', p->>'inclusive')); return res; end $$;
alter function sfx_checkout_rules_save(jsonb) rename to sfx_checkout_rules_save_pre427;
create function sfx_checkout_rules_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin perform sfx_require('sfx_settings'); res := sfx_checkout_rules_save_pre427(p); perform sfx_audit_log('Changed checkout rules', '{}'::jsonb); return res; end $$;
alter function sfx_checkout_settings_save(jsonb) rename to sfx_checkout_settings_save_pre427;
create function sfx_checkout_settings_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin perform sfx_require('sfx_settings'); res := sfx_checkout_settings_save_pre427(p); perform sfx_audit_log('Changed shipping settings', '{}'::jsonb); return res; end $$;
alter function sfx_revision_restore(uuid) rename to sfx_revision_restore_pre427;
create function sfx_revision_restore(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin perform sfx_require('sfx_settings'); res := sfx_revision_restore_pre427(p_id); perform sfx_audit_log('Restored a saved version', jsonb_build_object('version', p_id)); return res; end $$;
alter function sfx_discount_save(uuid, jsonb) rename to sfx_discount_save_pre427;
create function sfx_discount_save(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare res jsonb;
begin perform sfx_require('sfx_marketing'); res := sfx_discount_save_pre427(p_id, p); perform sfx_audit_log(case when p_id is null then 'Created a discount' else 'Changed a discount' end, jsonb_build_object('code', p->>'code')); return res; end $$;

-- ----- who has access, and how safely -----
create function sfx_staff_security() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin
  if not sfx_perm('sfx_settings') then raise exception 'Your role does not allow this (sfx_settings)' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', coalesce(p.name, p.email, p.username), 'role', p.role, 'roleName', r.name, 'loginOff', p.login_off,
      'twoFactor', coalesce((select t.enabled from auth_totp t where t.user_id = p.id), false),
      'lastSeen', (select max(s.last_seen_at) from auth_sessions s where s.user_id = p.id and s.revoked_at is null),
      'sessions', (select count(*) from auth_sessions s where s.user_id = p.id and s.revoked_at is null and s.created_at > now() - interval '7 days')) order by (p.role = 'owner') desc, p.role, coalesce(p.name, p.email))
    from profiles p left join roles r on r.id = p.role_id where p.tenant_id = tid), '[]'::jsonb);
end $$;

-- ----- messages sent to customers (WhatsApp). Phone numbers are masked. -----
create function sfx_message_log(p_limit int default 100) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('template', template, 'to', repeat('x', greatest(length(to_phone) - 4, 0)) || right(to_phone, 4), 'status', status, 'error', left(error, 120), 'at', created_at) order by created_at desc)
    from (select * from wa_outbox where tenant_id = tid order by created_at desc limit greatest(1, least(coalesce(p_limit, 100), 500))) m), '[]'::jsonb);
end $$;

-- ----- the store plan's own payments -----
create function sfx_billing_history() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin
  if not sfx_perm('sfx_settings') then raise exception 'Your role does not allow this (sfx_settings)' using errcode = '42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('amount', amount, 'status', status, 'period', period, 'at', coalesce(paid_at, created_at), 'reference', razorpay_payment_id) order by created_at desc)
    from payments where sfx_tenant_id = tid), '[]'::jsonb);
end $$;
grant execute on function sfx_perm(text), sfx_perms(), sfx_require(text), sfx_audit_list(int), sfx_staff_security(), sfx_message_log(int), sfx_billing_history(), sfx_refund_record(uuid, jsonb), sfx_credit_adjust(uuid, numeric, text),
  sfx_return_set(uuid, text, numeric), sfx_tax_settings_save(jsonb), sfx_checkout_rules_save(jsonb), sfx_checkout_settings_save(jsonb), sfx_revision_restore(uuid), sfx_discount_save(uuid, jsonb) to app;

-- Rollback: for each function renamed here (sfx_refund_record, sfx_credit_adjust, sfx_return_set, sfx_tax_settings_save, sfx_checkout_rules_save, sfx_checkout_settings_save, sfx_revision_restore, sfx_discount_save)
-- drop the new one and rename its _pre427 copy back; restore sfx_perm and sfx_perms from db/372; drop sfx_require, sfx_audit_log, sfx_audit_list, sfx_staff_security, sfx_message_log, sfx_billing_history; drop table sfx_audit.
