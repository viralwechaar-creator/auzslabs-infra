-- "Remind on WhatsApp" for payments due (AUZsLedger customers, AUZsMob credit sales).
-- A staffer taps a button; the SERVER works out the amount and the phone number from the shop's own records
-- (never from the browser), so nobody can send an arbitrary amount or message an arbitrary number through the
-- shop's WhatsApp. Uses the existing `payment_due` template and the normal wa_enqueue gates (shop must have
-- WhatsApp on, opt-outs respected, one reminder per customer per day).

create or replace function wa_due_send(p_tenant uuid, p_phone text, p_name text, p_amount numeric, p_ref text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare shop text; on_ boolean; v_id uuid;
begin
  if p_phone is null or btrim(p_phone) = '' then return jsonb_build_object('sent', false, 'reason', 'no_phone'); end if;
  select coalesce(s.enabled, false) into on_ from wa_tenant_settings s where s.tenant_id = p_tenant;
  if not coalesce(on_, false) then return jsonb_build_object('sent', false, 'reason', 'off'); end if;
  select name into shop from tenants where id = p_tenant;
  v_id := wa_enqueue(p_tenant, p_phone, 'payment_due',
    jsonb_build_array(coalesce(nullif(btrim(p_name), ''), 'there'), coalesce(shop, 'us'), wa_money(p_amount)), p_ref);
  if v_id is null then return jsonb_build_object('sent', false, 'reason', 'already_sent'); end if;
  return jsonb_build_object('sent', true);
end $$;

-- AUZsLedger: a customer with overdue invoices
create or replace function acc_send_due_reminder(p_party_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; pa acc_parties%rowtype; amt numeric; r jsonb;
begin
  tid := acc_guard('acc_sales');
  select * into pa from acc_parties where id = p_party_id and tenant_id = tid;
  if not found then raise exception 'customer not found'; end if;
  select coalesce(sum(d.total - d.paid), 0) into amt from acc_documents d
   where d.tenant_id = tid and d.party_id = pa.id and d.doc_type = 'invoice' and d.status = 'posted' and d.total > d.paid and d.due_date < current_date;
  if amt <= 0 then raise exception 'Nothing is overdue for this customer'; end if;
  r := wa_due_send(tid, pa.phone, pa.name, amt, 'due-' || pa.id || '-' || current_date);
  if (r->>'sent')::boolean then
    insert into acc_comms (tenant_id, channel, kind, party_id, recipient, subject, body, status, created_by)
    values (tid, 'whatsapp', 'payment_reminder', pa.id, pa.phone, 'Payment reminder', 'Sent automatically: overdue ' || wa_money(amt), 'sent', app_uid());
  end if;
  return r || jsonb_build_object('amount', amt);
end $$;

-- AUZsMob: one credit sale that still has a balance
create or replace function mob_send_due_reminder(p_sale_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; s mob_sales%rowtype; paid_later numeric; due numeric; r jsonb;
begin
  tid := mob_guard('mob_sell');
  select * into s from mob_sales where id = p_sale_id and tenant_id = tid and not voided;
  if not found then raise exception 'sale not found'; end if;
  if not mob_perm('mob_reports') and s.staff_id <> app_uid() then raise exception 'Your role does not allow this' using errcode = '42501'; end if;
  select coalesce(sum(amount), 0) into paid_later from mob_payments where tenant_id = tid and kind = 'customer_due' and sale_id = s.id;
  due := greatest(0, s.balance - paid_later);
  if due <= 0 then raise exception 'Nothing is due on this sale'; end if;
  r := wa_due_send(tid, s.customer_phone, s.customer_name, due, 'due-' || s.id || '-' || current_date);
  return r || jsonb_build_object('amount', due);
end $$;
