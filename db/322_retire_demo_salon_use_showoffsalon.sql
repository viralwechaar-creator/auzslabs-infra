-- Owner request: there should be one "AUZslab Salon" live demo, not two -- the synthetic demo-salon tenant
-- (fake seeded data, its own separate demo-salon@auzslab.in login) is retired. showoffsalon (confirmed by
-- the owner to not be a real paying client) becomes the public salon demo instead, using the exact same
-- shared "Auzslab@Demo" password every other product demo already uses -- see
-- server/scripts/set-salon-console-password.mjs for setting that password (a scrypt hash computed in Node,
-- which plain SQL can't do -- that's a one-time script run, not part of this migration). showoffsalon's own
-- subdomain, website and real content are completely untouched by any of this.
--
-- Deletion order follows db/078's own proven pattern exactly (same lesson, re-stated there in full): Postgres
-- runs a CASCADE delete from `tenants` as an AFTER DELETE trigger, so acc_*/pay_*'s own append-only guard
-- (which re-checks is_demo on `tenants` from inside the trigger) can no longer see the parent row by the time
-- the cascade reaches them and fails closed -- pay_reset_demo()/the inlined acc_* block below delete that
-- data directly, BEFORE the tenants row itself goes. bookings/records/guest_orders/invoice_counters/
-- push_subs/fcm_tokens have no ON DELETE CASCADE from tenants at all (also already documented in db/078 and
-- CLAUDE.md) and need their own explicit delete for the same reason.
do $$
declare tid uuid;
begin
  select id into tid from tenants where slug = 'demo-salon' and is_demo;
  if tid is null then
    raise notice 'demo-salon tenant not found (already retired, or never existed under this slug) -- nothing to do';
    return;
  end if;

  perform pay_reset_demo(tid); -- safe no-op if this tenant never had payroll data

  if exists (select 1 from acc_org where tenant_id = tid) then
    perform set_config('acc.reset', '1', true);
    update acc_bank_txns set recon_id = null where tenant_id = tid;
    delete from acc_saved_views where tenant_id = tid; delete from acc_attachments where tenant_id = tid; delete from acc_comms where tenant_id = tid; delete from acc_gst_recon where tenant_id = tid;
    delete from acc_gst_periods where tenant_id = tid; delete from acc_eway where tenant_id = tid; delete from acc_einvoice where tenant_id = tid; delete from acc_depreciation where tenant_id = tid;
    delete from acc_fixed_assets where tenant_id = tid; delete from acc_budgets where tenant_id = tid; delete from acc_bank_txns where tenant_id = tid; delete from acc_recons where tenant_id = tid;
    delete from acc_allocations where tenant_id = tid; delete from acc_payments where tenant_id = tid; delete from acc_stock_moves where tenant_id = tid; delete from acc_import_jobs where tenant_id = tid;
    update acc_documents set journal_id = null where tenant_id = tid; update acc_documents set ref_doc_id = null, source_doc_id = null where tenant_id = tid;
    delete from acc_doc_lines where tenant_id = tid; delete from acc_documents where tenant_id = tid;
    delete from acc_journal_lines where tenant_id = tid; delete from acc_journals where tenant_id = tid;
    delete from acc_series where tenant_id = tid; delete from acc_audit where tenant_id = tid;
    delete from acc_products where tenant_id = tid; delete from acc_parties where tenant_id = tid; delete from acc_masters where tenant_id = tid; delete from acc_warehouses where tenant_id = tid;
    delete from acc_branches where tenant_id = tid; delete from acc_taxcodes where tenant_id = tid; delete from acc_accounts where tenant_id = tid; delete from acc_fy where tenant_id = tid; delete from acc_org where tenant_id = tid;
    perform set_config('acc.reset', '0', true);
  end if;

  -- every login tied to this tenant -- owner (demo-salon@auzslab.in) and staff (priya.demo-salon@staff.auzslab.in) alike
  delete from auth_users where id in (select id from profiles where tenant_id = tid);
  delete from bookings where tenant_id = tid;
  delete from records where tenant_id = tid;
  delete from guest_orders where tenant_id = tid;
  delete from invoice_counters where tenant_id = tid;
  delete from push_subs where tenant_id = tid;
  delete from fcm_tokens where tenant_id = tid;
  delete from tenants where id = tid; -- cascades salon_store and everything else with a real FK

  raise notice 'demo-salon tenant % retired', tid;
end $$;
