-- Razorpay renewals, failed-payment handling and auto-renewal (db/200 follow-up).
--  * a paid "renewal" order (the owner pays the next period online on pay.html), or an auto-renewal charge from a Razorpay
--    subscription, extends tenants.renewal_date, gets its own gapless GST bill number and is recorded in client_payments;
--  * a failed charge only flags the business and tells the admin (never suspends access: the owner's standing decision);
--  * everything here is reached only by server code (payments.js); none of it is registered as an RPC.

alter table client_orders drop constraint if exists client_orders_kind_check;
alter table client_orders add constraint client_orders_kind_check check (kind in ('new', 'addon', 'renewal'));

alter table payments add column if not exists failure_reason text;
alter table payments add column if not exists failed_at timestamptz;

alter table subscriptions drop constraint if exists subscriptions_period_check;
alter table subscriptions add constraint subscriptions_period_check check (period in ('month', 'year'));
alter table subscriptions drop constraint if exists subscriptions_status_check;
alter table subscriptions add constraint subscriptions_status_check check (status in ('created', 'active', 'payment_failed', 'cancelled'));
alter table subscriptions add column if not exists provider_plan_id text;
alter table subscriptions add column if not exists failed_count int not null default 0;
alter table subscriptions alter column created_by drop not null;

-- next gapless bill number for a date (April to March financial year), shared by every bill AUZslab itself issues
create or replace function next_client_bill_no(p_date date) returns text
language plpgsql security definer set search_path = public as $$
declare v_fy text; v_n int;
begin
  v_fy := case when extract(month from p_date) >= 4 then extract(year from p_date)::int || '-' || lpad(((extract(year from p_date)::int + 1) % 100)::text, 2, '0')
               else (extract(year from p_date)::int - 1) || '-' || lpad((extract(year from p_date)::int % 100)::text, 2, '0') end;
  insert into client_order_counters (fy, n) values (v_fy, 1) on conflict (fy) do update set n = client_order_counters.n + 1 returning n into v_n;
  return 'AUZ/' || v_fy || '/' || lpad(v_n::text, 4, '0');
end $$;

-- what a business pays to renew: its products at the rate they were last billed (latest paid order per product), no setup or custom lines.
-- Null when the business has no paid order to price from (a hand-provisioned one): it then renews through AUZslab by hand.
create or replace function renewal_quote(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare o record; l jsonb; seen text[] := '{}'; items jsonb := '[]'; plans text[] := '{}'; v_state text := null; v_last client_orders; q jsonb; t jsonb; per text;
begin
  for o in select * from client_orders where tenant_id = p_tenant and status = 'paid' and quote is not null order by paid_at desc nulls last, created_at desc loop
    if v_last.id is null then v_last := o; end if;
    for l in select * from jsonb_array_elements(coalesce(o.quote->'items', '[]'::jsonb)) loop
      continue when (l->>'key') = any (seen);
      -- still entitled? only renew what the business still has switched on
      continue when not coalesce((select (features->>(l->>'key'))::boolean from tenant_settings where tenant_id = p_tenant), false);
      seen := seen || (l->>'key');
      items := items || jsonb_build_array(jsonb_build_object('key', l->>'key', 'plan', coalesce(nullif(l->>'plan', ''), 'month'), 'rate', coalesce((l->>'rate')::numeric, 0), 'discount', coalesce((l->>'discount')::numeric, 0), 'gst', coalesce((l->>'gst')::numeric, 0)));
      plans := plans || coalesce(nullif(l->>'plan', ''), 'month');
    end loop;
  end loop;
  if v_last.id is null or jsonb_array_length(items) = 0 then return null; end if;
  if (select count(distinct x) from unnest(plans) x) > 1 then return jsonb_build_object('error', 'mixed'); end if;
  per := plans[1];
  q := jsonb_build_object('items', items, 'setup', jsonb_build_object('on', false));
  t := client_order_totals(q, v_last.state_code);
  return jsonb_build_object('quote', q, 'totals', t, 'period', per, 'order_id', v_last.id);
end $$;

-- the owner asked to pay the next period now: an open renewal order on the same pay page and webhook as a new purchase
create or replace function renewal_order_create(p_tenant uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare rq jsonb; lo client_orders; ex client_orders; v_tok text; keys text[]; tn text;
begin
  select name into tn from tenants where id = p_tenant;
  rq := renewal_quote(p_tenant);
  if rq is null then raise exception 'Your plan was set up by AUZslab directly. Please contact us to renew.'; end if;
  if rq ? 'error' then raise exception 'Your plan has products on different billing periods. Please contact us to renew.'; end if;
  select * into ex from client_orders where tenant_id = p_tenant and kind = 'renewal' and status = 'link_sent' order by created_at desc limit 1;
  if ex.id is not null then
    update client_orders set quote = rq->'quote', totals = rq->'totals', updated_at = now() where id = ex.id;
    return jsonb_build_object('token', ex.token, 'id', ex.id);
  end if;
  select * into lo from client_orders where id = (rq->>'order_id')::uuid;
  select coalesce(array_agg(x->>'key'), '{}') into keys from jsonb_array_elements(rq->'quote'->'items') x;
  insert into client_orders (user_id, tenant_id, kind, status, contact_name, phone, email, gstin, address, state_code, business_name, niche, requirement, products, quote, totals)
    values (p_user, p_tenant, 'renewal', 'link_sent', lo.contact_name, lo.phone, lo.email, lo.gstin, lo.address, lo.state_code, coalesce(tn, lo.business_name), lo.niche, 'Plan renewal', keys, rq->'quote', rq->'totals')
    returning token into v_tok;
  return jsonb_build_object('token', v_tok);
end $$;

-- a renewal was paid (link flow: p_order is the renewal order; auto-renewal charge: p_order is null and a bill is made now).
-- Idempotent on the Razorpay payment id. A short or different amount is held and the admin told.
create or replace function renewal_settle(p_tenant uuid, p_order uuid, p_ref text, p_amount numeric, p_source text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t tenants; o client_orders; rq jsonb; q jsonb; tot jsonb; per text; v_paid date := current_date; v_base date; v_new date; v_no text; items jsonb := '[]'; l jsonb; keys text[]; lo client_orders;
begin
  select * into t from tenants where id = p_tenant for update;
  if t.id is null then return jsonb_build_object('ok', false, 'error', 'unknown business'); end if;
  if p_ref is not null and exists (select 1 from client_payments where lower(utr) = lower(p_ref)) then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  if p_order is not null then
    select * into o from client_orders where id = p_order for update;
    if o.id is null or o.tenant_id is distinct from p_tenant then return jsonb_build_object('ok', false, 'error', 'order not found'); end if;
    if o.status = 'paid' then return jsonb_build_object('ok', true, 'duplicate', true, 'invoice_no', o.invoice_no); end if;
    q := o.quote; tot := o.totals;
    per := coalesce(o.quote->'items'->0->>'plan', 'month');
  else
    rq := renewal_quote(p_tenant);
    if rq is null or rq ? 'error' then
      insert into notifications (tenant_id, type, title, body) values (null, 'client_order_paid', 'Auto-renewal charged but could not be billed: ' || t.name, 'Razorpay payment ' || coalesce(p_ref, '') || '. The plan could not be priced; make the bill by hand.');
      return jsonb_build_object('ok', false, 'error', 'no quote');
    end if;
    q := rq->'quote'; tot := rq->'totals'; per := rq->>'period';
  end if;
  if abs(coalesce((tot->>'total')::numeric, 0) - coalesce(p_amount, 0)) > 0.01 then
    insert into notifications (tenant_id, type, title, body) values (null, 'client_order_paid', 'Renewal payment does not match the bill: ' || t.name,
      'Razorpay payment ' || coalesce(p_ref, '') || ' of ' || coalesce(p_amount::text, '?') || ' but the renewal bill is ' || coalesce(tot->>'total', '?') || '. Check it in Razorpay and extend the plan by hand if right.');
    return jsonb_build_object('ok', false, 'error', 'amount mismatch');
  end if;
  v_base := greatest(coalesce(t.renewal_date, v_paid), v_paid);
  v_new := (v_base + case when per = 'year' then interval '1 year' else interval '1 month' end)::date;
  for l in select * from jsonb_array_elements(q->'items') loop items := items || jsonb_build_array(l || jsonb_build_object('renewal', v_new)); end loop;
  q := q || jsonb_build_object('items', items);
  tot := client_order_totals(q, coalesce(o.state_code, (select state_code from client_orders where tenant_id = p_tenant and state_code is not null order by created_at desc limit 1)));
  v_no := next_client_bill_no(v_paid);
  if p_order is not null then
    update client_orders set status = 'paid', quote = q, totals = tot, invoice_no = v_no, invoice_date = v_paid, paid_at = now(), updated_at = now(),
      payment = payment || jsonb_build_object('confirmed_at', now(), 'method', p_source, 'razorpay_payment_id', p_ref) where id = p_order;
  else
    select * into lo from client_orders where tenant_id = p_tenant and status = 'paid' order by paid_at desc nulls last limit 1;
    select coalesce(array_agg(x->>'key'), '{}') into keys from jsonb_array_elements(q->'items') x;
    insert into client_orders (user_id, tenant_id, kind, status, contact_name, phone, email, gstin, address, state_code, business_name, niche, requirement, products, quote, totals, invoice_no, invoice_date, paid_at, payment)
      values (null, p_tenant, 'renewal', 'paid', lo.contact_name, lo.phone, lo.email, lo.gstin, lo.address, lo.state_code, t.name, lo.niche, 'Auto-renewal', keys, q, tot, v_no, v_paid, now(),
        jsonb_build_object('confirmed_at', now(), 'method', p_source, 'razorpay_payment_id', p_ref));
  end if;
  update tenants set renewal_date = v_new, status = 'active' where id = p_tenant;
  insert into client_payments (tenant_id, amount, paid_on, mode, utr, purpose, note)
    values (p_tenant, (tot->>'total')::numeric, v_paid, 'other', p_ref, 'Renewal ' || v_no, 'Razorpay ' || coalesce(p_source, 'payment') || ' ' || coalesce(p_ref, ''));
  insert into notifications (tenant_id, type, title, body) values (p_tenant, 'renewal', 'Payment received: plan renewed', 'Your plan now runs until ' || to_char(v_new, 'DD Mon YYYY') || '. Bill ' || v_no || '.');
  insert into notifications (tenant_id, type, title, body) values (null, 'renewal', 'Renewed: ' || t.name, 'Bill ' || v_no || ', next renewal ' || to_char(v_new, 'DD Mon YYYY') || ' (' || coalesce(p_source, 'online') || ').');
  return jsonb_build_object('ok', true, 'invoice_no', v_no, 'renewal_date', v_new);
end $$;

-- the webhook's confirm step, now with the renewal branch (everything else is db/200 unchanged)
create or replace function online_confirm_order_payment(p_order_id uuid, p_rzp_payment_id text, p_amount numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o client_orders; v_admin uuid; v_prev text := current_setting('app.uid', true); r jsonb;
begin
  select * into o from client_orders where id = p_order_id for update;
  if o.id is null then return jsonb_build_object('ok', false, 'error', 'order not found'); end if;
  if o.status = 'paid' then return jsonb_build_object('ok', true, 'duplicate', true, 'invoice_no', o.invoice_no); end if;
  if o.kind = 'renewal' then return renewal_settle(o.tenant_id, o.id, p_rzp_payment_id, p_amount, 'payment link'); end if;
  if o.totals is null or abs(coalesce((o.totals->>'total')::numeric, 0) - coalesce(p_amount, 0)) > 0.01 then
    insert into notifications (tenant_id, type, title, body) values (null, 'client_order_paid', 'Online payment does not match the quote: ' || coalesce(o.business_name, ''),
      'Razorpay payment ' || coalesce(p_rzp_payment_id, '') || ' of ' || coalesce(p_amount::text, '?') || ' was received but the bill is ' || coalesce(o.totals->>'total', '?') || '. Check it in Razorpay and confirm by hand.');
    return jsonb_build_object('ok', false, 'error', 'amount mismatch');
  end if;
  select id into v_admin from platform_admins order by id limit 1;
  if v_admin is null then return jsonb_build_object('ok', false, 'error', 'no platform admin'); end if;
  begin
    perform set_config('app.uid', v_admin::text, true);
    r := admin_confirm_order_payment(o.id, current_date, p_rzp_payment_id);
    perform set_config('app.uid', coalesce(v_prev, ''), true);
  exception when others then
    perform set_config('app.uid', coalesce(v_prev, ''), true);
    insert into notifications (tenant_id, type, title, body) values (null, 'client_order_paid', 'Online payment received but access was not given: ' || coalesce(o.business_name, ''),
      'Razorpay payment ' || coalesce(p_rzp_payment_id, '') || '. Error: ' || left(sqlerrm, 200) || '. Open the request and press Confirm payment.');
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;
  update client_payments set mode = 'other', note = 'Razorpay payment ' || p_rzp_payment_id where lower(utr) = lower(p_rzp_payment_id);
  update client_orders set payment = payment || jsonb_build_object('method', 'razorpay', 'razorpay_payment_id', p_rzp_payment_id) where id = o.id;
  return r || jsonb_build_object('ok', true);
end $$;

-- a failed payment attempt (Razorpay payment.failed): remember why; if a client keeps failing, tell the admin so they can help
create or replace function online_payment_failed(p_razorpay_order_id text, p_payment_id text, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p payments; n int; o client_orders;
begin
  select * into p from payments where razorpay_order_id = p_razorpay_order_id;
  if p.id is null then return jsonb_build_object('ok', false, 'error', 'unknown order'); end if;
  if p.status = 'paid' then return jsonb_build_object('ok', true, 'ignored', true); end if;
  update payments set status = 'failed', failure_reason = left(coalesce(p_reason, 'payment failed'), 300), failed_at = now(), razorpay_payment_id = coalesce(razorpay_payment_id, p_payment_id) where id = p.id;
  if p.client_order_id is not null then
    select count(*) into n from payments where client_order_id = p.client_order_id and status = 'failed' and failed_at > now() - interval '1 day';
    if n = 3 then
      select * into o from client_orders where id = p.client_order_id;
      insert into notifications (tenant_id, type, title, body) values (null, 'client_order_paid', 'A client online payment keeps failing: ' || coalesce(o.business_name, ''),
        n || ' failed attempts in a day (' || coalesce(p_reason, 'no reason given') || '). Call them to help, or send the UPI QR.');
    end if;
  end if;
  return jsonb_build_object('ok', true);
end $$;

-- Razorpay subscription events (auto-renewal). kind: authenticated | activated | charged | failed | cancelled | completed
create or replace function subscription_event(p_sub_id text, p_kind text, p_pay_ref text, p_amount numeric, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s subscriptions; t tenants; r jsonb; ph text; own uuid;
begin
  select * into s from subscriptions where provider = 'razorpay' and provider_sub_id = p_sub_id;
  if s.id is null then return jsonb_build_object('ok', false, 'error', 'unknown subscription'); end if;
  select * into t from tenants where id = s.tenant_id;
  if p_kind in ('authenticated', 'activated') then
    update subscriptions set status = case when status = 'cancelled' then status else 'active' end, authorized_at = coalesce(authorized_at, now()) where id = s.id;
    return jsonb_build_object('ok', true);
  elsif p_kind = 'charged' then
    r := renewal_settle(s.tenant_id, null, p_pay_ref, p_amount, 'auto-renewal');
    if coalesce((r->>'ok')::boolean, false) then
      update subscriptions set status = 'active', last_charge_status = 'success', last_charge_at = now(), failed_count = 0, next_charge_on = (r->>'renewal_date')::date where id = s.id;
    else
      update subscriptions set last_charge_status = 'held', last_charge_at = now() where id = s.id;
    end if;
    return r;
  elsif p_kind = 'failed' then
    update subscriptions set status = 'payment_failed', last_charge_status = 'failed', last_charge_at = now(), failed_count = failed_count + 1 where id = s.id;
    insert into notifications (tenant_id, type, title, body) values (s.tenant_id, 'renewal', 'Auto-renewal payment failed', 'Your card or UPI autopay was declined. Please pay your renewal in Plan & account, or update the autopay. Your access has not been changed.');
    insert into notifications (tenant_id, type, title, body) values (null, 'renewal', 'Auto-renewal failed: ' || t.name, coalesce(p_reason, 'declined') || '. Access was not changed. They were told to pay by hand.');
    select p.id into own from profiles p where p.tenant_id = s.tenant_id and p.role = 'owner' limit 1;
    if own is not null then
      select up.phone into ph from user_profiles up where up.user_id = own;
      if ph is not null and ph <> '' then
        perform wa_enqueue(null, ph, 'renewal_reminder', jsonb_build_array('there', t.name, '0', to_char(coalesce(t.renewal_date, current_date), 'DD Mon YYYY')), s.id || '-fail-' || s.failed_count);
      end if;
    end if;
    return jsonb_build_object('ok', true);
  elsif p_kind in ('cancelled', 'completed') then
    update subscriptions set status = 'cancelled', cancelled_at = coalesce(cancelled_at, now()) where id = s.id;
    return jsonb_build_object('ok', true);
  end if;
  return jsonb_build_object('ok', false, 'error', 'unknown event');
end $$;

-- the daily renewal reminders skip a business that is on an active auto-renewal until it has actually lapsed
create or replace function renewal_notify_run() returns jsonb language plpgsql security definer set search_path = public as $$
declare t record; d int; stage text; out jsonb := '[]'::jsonb; fresh int; ttl text; msg text; emails text[]; owner_id uuid; owner_phone text;
begin
  for t in select id, name, renewal_date from tenants where not is_demo and status = 'active' and renewal_date is not null loop
    d := t.renewal_date - current_date;
    stage := case when d < 0 then 'expired' when d = 0 then 'd0' when d <= 1 then 'd1' when d <= 3 then 'd3' when d <= 7 then 'd7' else null end;
    continue when stage is null;
    -- a business on an active auto-renewal is charged by itself: no "please renew" nag until it has actually lapsed
    continue when stage <> 'expired' and exists (select 1 from subscriptions s where s.tenant_id = t.id and s.status = 'active');
    insert into renewal_notices(tenant_id, renewal_date, stage) values (t.id, t.renewal_date, stage) on conflict do nothing;
    get diagnostics fresh = row_count;
    continue when fresh = 0;
    ttl := case stage when 'expired' then 'Your AUZslab plan has expired' when 'd0' then 'Your AUZslab plan ends today'
                      when 'd1' then 'Your AUZslab plan ends tomorrow' else 'Your AUZslab plan ends in ' || d || ' days' end;
    msg := 'Plan renewal date: ' || to_char(t.renewal_date, 'DD Mon YYYY') || '. Please renew to keep every app working. Open Plan & account in your app, or contact AUZslab.';
    insert into notifications(tenant_id, type, title, body, link) values (t.id, 'renewal', ttl, msg, 'https://auzslab.in/account.html#notifications');
    insert into notifications(tenant_id, type, title, body) values (null, 'renewal', t.name || ' - ' || replace(ttl, 'Your AUZslab plan', 'plan'), msg);
    select p.id into owner_id from profiles p where p.tenant_id = t.id and p.role = 'owner' limit 1;
    select coalesce(array_agg(au.email), '{}') into emails from profiles p join auth_users au on au.id = p.id
     where p.tenant_id = t.id and p.role = 'owner' and au.deleted_at is null and au.email not like '%@staff.auzslab.in';
    if owner_id is not null then
      select up.phone into owner_phone from user_profiles up where up.user_id = owner_id;
      if owner_phone is not null and owner_phone <> '' then
        perform wa_enqueue(null, owner_phone, 'renewal_reminder', jsonb_build_array('there', t.name, greatest(d, 0)::text, to_char(t.renewal_date, 'DD Mon YYYY')), t.id || '-' || stage);
      end if;
    end if;
    out := out || jsonb_build_object('tenant', t.name, 'stage', stage, 'days', d, 'renewal_date', t.renewal_date, 'emails', to_jsonb(emails));
  end loop;
  return out;
end $$;
