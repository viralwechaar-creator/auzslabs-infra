-- Wires four more of the templates seeded in db/184 (order_ready, payslip_ready, welcome, renewal_reminder)
-- into real events, plus a new daily booking-reminder job. Same discipline as db/190 throughout:
--  * wa_enqueue() is the one entry point (already checks wa_tenant_settings.enabled / platform_flags
--    whatsapp_platform_auto and is idempotent per (tenant, template, ref) via wa_outbox's unique index).
--  * every trigger body is wrapped in `exception when others then null` so a messaging failure can never
--    block the real order/payroll/provisioning action.
--  * a trigger that can fire on INSERT never references OLD outside a short-circuited `tg_op = 'UPDATE'` guard.
--
-- NOT done in this migration, on purpose: `payment_due` (a shop reminding ITS OWN customer about an
-- outstanding balance). Unlike the other five, that one is a judgement call by shop staff, not something
-- that should auto-fire on a schedule without the shop choosing to send it -- it needs a "Remind on
-- WhatsApp" button on the Dues pages (AUZsLedger + AUZsMob), scoped so a staffer can only message a real
-- party/customer of their own tenant, never an arbitrary number. Left for a follow-up.

-- ---------- 1. POS: an order (takeaway/delivery only -- a dine-in guest is already seated) is ready ----------
create or replace function wa_order_ready_msg() returns trigger language plpgsql security definer set search_path = public as $$
declare shop text; phone text;
begin
  begin
    if new.kind <> 'order' then return new; end if;
    if coalesce(new.data->>'kstat', '') <> 'ready' or coalesce(new.data->>'type', '') = 'Dine-in' then return new; end if;
    if tg_op = 'UPDATE' and old.data->>'kstat' = 'ready' then return new; end if; -- only a genuine new transition
    phone := new.data->'cust'->>'phone';
    if phone is null or phone = '' then return new; end if;
    select name into shop from tenants where id = new.tenant_id;
    perform wa_enqueue(new.tenant_id, phone, 'order_ready',
      jsonb_build_array(coalesce(new.data->'cust'->>'name', 'there'), coalesce(new.data->>'no', ''), coalesce(shop, 'us')),
      new.id || '-ready');
  exception when others then null;
  end;
  return new;
end $$;
drop trigger if exists records_order_ready_wa on records;
create trigger records_order_ready_wa after insert or update on records for each row
  when (new.kind = 'order') execute function wa_order_ready_msg();

-- ---------- 2. AUZsPay: a payroll run was finalised -- one payslip_ready message per employee with a phone ----------
create or replace function wa_payslip_ready_msg() returns trigger language plpgsql security definer set search_path = public as $$
declare shop text; mon text; r record;
begin
  begin
    if new.status not in ('finalized', 'paid') then return new; end if;
    if old.status in ('finalized', 'paid') then return new; end if; -- only the genuine transition into finalised
    select name into shop from tenants where id = new.tenant_id;
    mon := trim(to_char(to_date(new.month || '-01', 'YYYY-MM-DD'), 'Month YYYY'));
    for r in select e.phone, e.name from pay_run_items i join pay_employees e on e.id = i.employee_id
             where i.run_id = new.id and e.phone is not null and e.phone <> '' loop
      perform wa_enqueue(new.tenant_id, r.phone, 'payslip_ready', jsonb_build_array(coalesce(r.name, 'there'), mon, coalesce(shop, 'your employer')), new.id || '-' || r.phone);
    end loop;
  exception when others then null;
  end;
  return new;
end $$;
drop trigger if exists pay_runs_wa on pay_runs;
create trigger pay_runs_wa after update of status on pay_runs for each row execute function wa_payslip_ready_msg();

-- ---------- 3. AUZslab's own "welcome": a brand-new business just went live through the request-first flow ----------
-- Only covers a signup paid through client_orders (the live onboarding path) -- a tenant created directly by
-- the admin console or a salesman's trial has no client_orders row to read a phone from, so it stays silent
-- for those (honest limitation, not a bug: wa_enqueue simply never fires without a real phone number).
create or replace function wa_client_order_msg() returns trigger language plpgsql security definer set search_path = public as $$
begin
  begin
    if new.phone is null or new.status is not distinct from old.status then return new; end if;
    if new.status = 'link_sent' then
      perform wa_enqueue(null, new.phone, 'quote_payment_link', jsonb_build_array(coalesce(new.contact_name, 'there'), wa_site_url() || '/pay.html?t=' || new.token), new.id || '-quote');
    elsif new.status = 'paid' and new.invoice_no is not null then
      perform wa_enqueue(null, new.phone, 'bill_paid', jsonb_build_array(coalesce(new.contact_name, 'there'), new.invoice_no, wa_site_url() || '/inv.html?t=' || new.token), new.id || '-paid');
      if new.kind = 'new' and new.tenant_id is not null then
        perform wa_enqueue(null, new.phone, 'welcome', jsonb_build_array(coalesce(new.contact_name, 'there'), wa_tenant_link(new.tenant_id, '')), new.id || '-welcome');
      end if;
    elsif new.status in ('verifying', 'confirmed', 'rejected') then
      perform wa_enqueue(null, new.phone, 'request_update', jsonb_build_array(coalesce(new.contact_name, 'there'),
        case new.status when 'verifying' then 'we are checking your request and will be in touch shortly'
                        when 'confirmed' then 'your request is confirmed and your payment link will follow'
                        else 'we could not take this request forward, please call us on +91 9251250829' end), new.id || '-' || new.status);
    end if;
  exception when others then null;
  end;
  return new;
end $$;
-- trigger already exists from db/184 (client_orders_wa); the function body above replaces it in place.

-- ---------- 4. AUZslab's own "renewal_reminder": piggybacks on the existing idempotent renewal_notify_run() ----------
-- Phone comes from the owner's own account profile (user_profiles, db/103) when they ever filled it in --
-- most won't have, so this is best-effort exactly like the welcome message above: no phone, no message,
-- never an error. The in-app notice and the owner email this function already sent are unaffected either way.
create or replace function renewal_notify_run() returns jsonb language plpgsql security definer set search_path = public as $$
declare t record; d int; stage text; out jsonb := '[]'::jsonb; fresh int; ttl text; msg text; emails text[]; owner_id uuid; owner_phone text;
begin
  for t in select id, name, renewal_date from tenants where not is_demo and status = 'active' and renewal_date is not null loop
    d := t.renewal_date - current_date;
    stage := case when d < 0 then 'expired' when d = 0 then 'd0' when d <= 1 then 'd1' when d <= 3 then 'd3' when d <= 7 then 'd7' else null end;
    continue when stage is null;
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

-- ---------- 5. booking_reminder: a new daily job (called by server/src/maintenance.js alongside renewal_notify_run) ----------
-- Idempotent through wa_outbox's own unique index on (tenant_id, template, ref) -- no extra tracking table needed,
-- same shortcut this file already relies on everywhere else.
create or replace function booking_reminder_run() returns jsonb language plpgsql security definer set search_path = public as $$
declare b record; shop text; out jsonb := '[]'::jsonb; sent int := 0;
begin
  for b in select id, tenant_id, customer_name, customer_phone, date, time from bookings
           where status = 'confirmed' and date = current_date + 1 and customer_phone is not null and customer_phone <> '' loop
    select name into shop from tenants where id = b.tenant_id;
    if wa_enqueue(b.tenant_id, b.customer_phone, 'booking_reminder',
         jsonb_build_array(coalesce(b.customer_name, 'there'), coalesce(shop, 'us'), to_char(b.date, 'DD Mon YYYY'), coalesce(to_char(b.time, 'HH12:MI AM'), 'the booked time')),
         b.id || '-reminder') is not null then
      sent := sent + 1;
    end if;
  end loop;
  out := jsonb_build_object('sent', sent);
  return out;
end $$;
