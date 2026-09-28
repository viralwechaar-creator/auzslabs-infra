-- =========================================================
-- Payroll adds two new records kinds: 'payrate' (a staffer's monthly
-- rate, id = their own profile id) and 'payslip' (a computed month's
-- pay, id = 'pay-<uid>-<month>'). Both are already left out of the
-- r_ins/r_upd write allow-list (db/019_allow_kotlog_kind.sql), which
-- makes them owner-only to WRITE -- but r_read (002_core_engine.sql)
-- has never been kind-gated at all, only tenant-gated, so every
-- staffer's device already pulls every OTHER kind in full on every
-- sync regardless of role (that's how offline-first works for
-- 'settings', 'coupon', etc. too). Salary data is different enough
-- from those to need actually keeping off a cashier's device, not just
-- off their screen -- index.html's own can('o') only gates which tab
-- *button* renders, never what a synced record contains.
-- =========================================================

drop policy if exists r_read on records;
create policy r_read on records for select
  using (
    me() is not null and tenant_id = (me()->>'tenant_id')::uuid
    and (kind not in ('payrate', 'payslip') or (me()->>'role') = 'owner')
  );
