-- =========================================================
-- Buy-N-Get-M offers ("BOGO"), on a category or a specific item, for a date window.
--
-- A new kind='offer' record on the generic records engine (same pattern as kind='tax', kind='coupon'):
--   {id, name, active, from, to, scope: 'cat'|'item', scopeId, buyQty, getQty, getPct}
-- `from`/`to` are 'YYYY-MM-DD' or null ('to' null = no end date). `getPct` is the discount on the
-- "get" units (100 = fully free, anything else = a partial discount).
--
-- Creating/editing an offer is a pricing-policy change, so it needs the same manager-or-owner gate as
-- `tax`/`platform`/`campaign` etc in pos_kind_ok() (db/068) -- a plain cashier cannot write this kind, but
-- can still sell with an offer that's already active (the matching/discount math is read-only billing
-- logic in app/public/pos/core.js's tot(), not a server write).
--
-- The discount itself is NOT a manual discount: it is computed fresh by tot() every time from the active
-- offer records and the cart, kept in its own t.offer/t.offers fields (never folded into t.d, the manual-
-- discount total that pos_order_guard's trigger checks for the maxDiscountPct approval rule). A correctly
-- computed, auto-applied offer discount therefore never asks a cashier for a manager PIN -- see that
-- trigger's comment below for why nothing there needs to change.
-- =========================================================

create or replace function pos_kind_ok(k text, d jsonb, old jsonb, deleting boolean) returns boolean language plpgsql stable security definer set search_path = public as $$
declare myrole text := me()->>'role'; myemp text;
begin
  if myrole is null then return false; end if;
  if k in ('order', 'exp', 'shift', 'ing', 'waste', 'voidlog', 'kotlog', 'membership', 'checkin', 'ticket', 'ticketnote', 'task', 'vendor', 'purchase', 'adjustment', 'transfer', 'customer', 'cashmove', 'register', 'waitlist') then
    return true;
  end if;
  if myrole = 'owner' then return true; end if;
  if myrole = 'manager' and k in ('hr_settings', 'hr_employee', 'hr_shift', 'hr_advance', 'hr_attendance', 'hr_leave', 'hr_payslip', 'hr_announcement', 'hr_document', 'hr_regularization', 'hr_holiday', 'hr_profile', 'plan', 'outlet', 'variant', 'po', 'device', 'addongrp', 'tax', 'settlement', 'platform', 'giftcard', 'segment', 'campaign', 'closing', 'quicklink', 'offer') then
    return true;
  end if;
  -- operational state on master records: a table's cleaning flag, a retail variant's stock count
  if k = 'table' and old is not null and not deleting then
    -- the POS stamps the current outlet on records it saves; a table without one may gain outlet 'main' and nothing else
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
