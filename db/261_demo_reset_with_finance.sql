-- Fix: opening AUZsLedger on the shared demo business failed with
--   update or delete on table "acc_journals" violates foreign key constraint "fin_txns_journal_id_fkey"
-- The demo reset (every 12 h) rebuilds the accounting books, but AUZsFinance entries on the same business
-- still pointed at the old journals. The reset now clears the finance rows first and re-seeds them after.

create or replace function fin_demo_seed(tid uuid) returns void language plpgsql security definer set search_path = public as $$
declare uid uuid; bank uuid; cash uuid; pt uuid; ps uuid; i int; cats jsonb; ex jsonb; inc uuid; ctx jsonb;
begin
  if not exists (select 1 from tenants where id = tid and is_demo) then return; end if;
  if not coalesce((select (features->>'finance')::boolean from tenant_settings where tenant_id = tid), false) then return; end if;
  select id into uid from profiles where tenant_id = tid and role = 'owner' limit 1;
  if uid is null then return; end if;
  perform set_config('app.uid', uid::text, true);
  ctx := fin_bootstrap();
  if exists (select 1 from fin_txns where tenant_id = tid) then return; end if;
  bank := (select (a->>'id')::uuid from jsonb_array_elements(ctx->'accounts') a where a->>'kind' = 'bank' limit 1);
  cash := (select (a->>'id')::uuid from jsonb_array_elements(ctx->'accounts') a where a->>'kind' = 'cash' limit 1);
  ex := ctx->'categories'->'expense'; inc := (select (c->>'id')::uuid from jsonb_array_elements(ctx->'categories'->'income') c limit 1);
  pt := (fin_save_partner(jsonb_build_object('name', 'Owner', 'kind', 'owner')))->>'id';
  perform fin_save_txn(jsonb_build_object('op', 'demo-cap', 'kind', 'capital_in', 'amount', 150000, 'account_id', bank, 'partner_id', pt, 'date', current_date - 40, 'evidence', 'have'));
  for i in 0..29 loop
    perform fin_save_txn(jsonb_build_object('op', 'demo-in-' || i, 'kind', 'money_in', 'amount', 2500 + (i * 937) % 5200, 'account_id', cash, 'category_id', inc, 'purpose', 'Sales', 'date', current_date - i, 'tax_rate', 18));
    if i % 2 = 1 then
      perform fin_save_txn(jsonb_build_object('op', 'demo-out-' || i, 'kind', 'expense', 'amount', 900 + (i * 611) % 3100, 'account_id', cash, 'category_id', (ex->(i % jsonb_array_length(ex))->>'id')::uuid, 'purpose', ex->(i % jsonb_array_length(ex))->>'name', 'date', current_date - i, 'evidence', case when i % 4 = 1 then 'have' else 'none' end));
    end if;
  end loop;
  ps := (fin_save_person(jsonb_build_object('name', 'Sample customer', 'kind', 'customer')))->>'id';
  perform fin_save_txn(jsonb_build_object('op', 'demo-credit', 'kind', 'credit_sale', 'amount', 8000, 'person_id', ps, 'date', current_date - 12, 'tax_rate', 18));
exception when others then
  raise notice 'demo finance seed skipped: %', sqlerrm;
end $$;
revoke all on function fin_demo_seed(uuid) from public, app;

create or replace function acc_reset_demo(tid uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from tenants where id = tid and is_demo) then raise exception 'Not a demo tenant'; end if;
  perform set_config('acc.reset', '1', true);
  -- AUZsFinance rows point at acc_journals / acc_accounts: clear them first or the books cannot be rebuilt
  delete from fin_files where tenant_id = tid; delete from fin_cleared where tenant_id = tid; delete from fin_dep_runs where tenant_id = tid;
  delete from fin_assets where tenant_id = tid; delete from fin_budgets where tenant_id = tid; delete from fin_recurring where tenant_id = tid;
  update fin_txns set reversal_of = null where tenant_id = tid; delete from fin_txns where tenant_id = tid;
  delete from fin_loans where tenant_id = tid; delete from fin_people where tenant_id = tid; delete from fin_partners where tenant_id = tid;
  delete from fin_accounts where tenant_id = tid; delete from fin_settings where tenant_id = tid; delete from fin_profile where tenant_id = tid;
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
  perform acc_seed_demo(tid);
  perform fin_demo_seed(tid);
end $$;
revoke all on function acc_reset_demo(uuid) from public, app;
