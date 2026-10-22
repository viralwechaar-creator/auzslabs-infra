-- Owner report: the POS's retail return/exchange action applied a refund or exchange the instant a staffer
-- tapped it (returnSheet -> doReturn in pay.js), with no decision stage at all -- there was nothing to
-- "approve, reject, mark received, then refund" because the whole thing was one atomic step. The owner
-- wants a real, server-enforced lifecycle instead: a return/exchange is first raised as a request, a
-- manager/owner must Approve or Reject it (once, not changeable afterwards), an approved one is marked
-- Received when the item physically comes back, and only then is it Refunded (or completed as an
-- Exchange) -- each step one-way, never free to jump around or be re-picked.
--
-- New records kind 'returnreq' (one per request). pos_kind_ok already lets every authenticated staffer
-- touch kinds like 'order'/'voidlog' -- 'returnreq' joins that same list; the actual lifecycle rules (who
-- may move it from one stage to the next, and that a decided/finished request can never move again) are
-- enforced by the new returnreq_guard trigger below, the same split responsibility pos_order_guard already
-- uses for the 'order' kind (push_record's pos_kind_ok says WHO may touch the kind at all; the per-kind
-- trigger says what shape of change is actually allowed).
create or replace function pos_kind_ok(k text, d jsonb, old jsonb, deleting boolean) returns boolean language plpgsql stable security definer set search_path = public as $$
declare myrole text := me()->>'role'; myemp text;
begin
  if myrole is null then return false; end if;
  if k in ('order', 'exp', 'shift', 'ing', 'waste', 'voidlog', 'kotlog', 'membership', 'checkin', 'ticket', 'ticketnote', 'task', 'vendor', 'purchase', 'adjustment', 'transfer', 'customer', 'cashmove', 'register', 'waitlist', 'returnreq') then
    return true;
  end if;
  if myrole = 'owner' then return true; end if;
  if myrole = 'manager' and k in ('hr_settings', 'hr_employee', 'hr_shift', 'hr_advance', 'hr_attendance', 'hr_leave', 'hr_payslip', 'hr_announcement', 'hr_document', 'hr_regularization', 'hr_holiday', 'hr_profile', 'plan', 'outlet', 'variant', 'po', 'device', 'addongrp', 'tax', 'settlement', 'platform', 'giftcard', 'segment', 'campaign', 'closing', 'quicklink') then
    return true;
  end if;
  -- operational state on master records: a table's cleaning flag, a retail variant's stock count
  if k = 'table' and old is not null and not deleting then
    return (d - 'cleaned' - 'cleanedAt' - 'cleanedBy' - (case when not (old ? 'outlet') and coalesce(d->>'outlet', 'main') = 'main' then 'outlet' else '' end))
           is not distinct from (old - 'cleaned' - 'cleanedAt' - 'cleanedBy');
  end if;
  if k = 'item' and old is not null and not deleting then
    return pos_only_variant_stock_changed(old, d);
  end if;
  if k in ('hr_attendance', 'hr_leave', 'hr_document', 'hr_regularization', 'hr_profile', 'hr_advance') then
    myemp := my_employee_id();
    if myemp is null or d->>'empId' is distinct from myemp then return false; end if;
    return case k when 'hr_leave' then d->>'status' = 'pending'
                  when 'hr_regularization' then d->>'status' = 'pending'
                  when 'hr_advance' then d->>'status' = 'requested'
                  else true end;
  end if;
  return false;
end $$;

-- Allowed stage graph: pending -> approved | rejected; approved -> received; received -> refunded | exchanged.
-- rejected / refunded / exchanged are terminal: once there, the row can never change again (any attempt is
-- refused outright, which is the actual fix for "I can change approved/rejected/refunded and it isn't
-- saved" -- the request's own history, once decided, is now something the server itself locks, not just a
-- client-side status label that silently didn't persist).
create or replace function pos_returnreq_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare st_old text; st_new text; bill boolean; frozen text[] := array['orderId', 'orderNo', 'lineIdx', 'itemName', 'size', 'qty', 'mode', 'give', 'amt', 'reason', 'requestedBy', 'requestedAt'];
  merged jsonb; k text;
begin
  if new.kind <> 'returnreq' or (tg_op = 'UPDATE' and old.kind <> 'returnreq') then return new; end if;
  if me() is null then return new; end if; -- migrations, demo resets and other system jobs

  if tg_op = 'INSERT' then
    -- a request always starts pending, no matter what a client sends -- never let one arrive already decided
    new.data := new.data || jsonb_build_object('stage', 'pending') - 'decidedBy' - 'decidedAt' - 'receivedBy' - 'receivedAt' - 'completedBy' - 'completedAt';
    return new;
  end if;

  st_old := coalesce(old.data->>'stage', 'pending');
  st_new := coalesce(new.data->>'stage', st_old);

  if st_old in ('rejected', 'refunded', 'exchanged') then
    raise exception 'This return/exchange request is already % and cannot be changed', st_old using errcode = '42501';
  end if;

  -- the original ask (what, how much, why, who asked) is frozen the moment it exists; only the stage
  -- fields below may ever move after that
  merged := new.data;
  foreach k in array frozen loop
    merged := case when old.data ? k then merged || jsonb_build_object(k, old.data->k) else merged - k end;
  end loop;
  new.data := merged;

  if st_new = st_old then return new; end if; -- no stage change -- nothing else to check

  bill := pos_can_bill();
  if st_old = 'pending' and st_new in ('approved', 'rejected') then
    if not bill and not pos_approval_ok(new.data->'decidedBy', 'return', new.id, new.tenant_id) then
      raise exception 'Only a manager can approve or reject a return/exchange request' using errcode = '42501';
    end if;
  elsif st_old = 'approved' and st_new = 'received' then
    null; -- any staffer may mark the item physically received back
  elsif st_old = 'received' and st_new in ('refunded', 'exchanged') then
    null; -- the real money/stock safety net is pos_order_guard's own refund-approval check on the order itself
  else
    raise exception 'A return/exchange request must go pending -> approved/rejected -> received -> refunded/exchanged, one step at a time' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists records_returnreq_guard on records;
create trigger records_returnreq_guard before insert or update on records for each row when (new.kind = 'returnreq') execute function pos_returnreq_guard();
