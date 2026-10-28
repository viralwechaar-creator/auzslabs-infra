-- FRESH START FOR ONE BUSINESS'S BOOKS (AUZsLedger + AUZsFinance). Default business: auzslabhq.
-- REMOVES: every bill, payment, journal entry, stock movement, customer/supplier, product, Finance entry, person, loan,
--          asset, budget, repeating entry, GST return mark, follow-up, expense request, attachment record, import job.
-- RESTARTS: bill and voucher numbering at 01 (all series start again in the current financial year).
-- KEEPS: business details, chart of accounts, tax codes, financial years, branches, warehouses, your bank and cash accounts
--        (their opening amount is set to 0), owner/partner records, Finance settings, logins, roles, audit trail.
-- Other apps (POS, payroll, etc.) and AUZslab's client bills (client_orders) are NOT touched.
--
-- SAFE BY DEFAULT: as-is it only prints what it would do, then rolls back. Add  -v confirm=yes  to really do it.
--   set -a; source .env; set +a
--   docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > ~/backup-before-books-reset.sql
--   docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 < db_data/reset_books.sql
--   (then the same with  -v confirm=yes  added)
-- Another business: add  -v slug=<address>
\if :{?slug}
\else
  \set slug auzslabhq
\endif
\if :{?confirm}
\else
  \set confirm no
\endif
\set ON_ERROR_STOP on
select set_config('auz.slug', :'slug', false);
begin;
set local session_replication_role = replica;   -- append-only guards and FK checks off for this transaction; needs superuser

create temp table rb_t(tid uuid);
insert into rb_t select id from tenants where slug = current_setting('auz.slug');
do $$ begin
  if (select count(*) from rb_t) <> 1 then raise exception 'No business with address "%". Nothing changed.', current_setting('auz.slug'); end if;
  if (select is_demo from tenants where id = (select tid from rb_t)) then raise exception 'That is a demo business. Nothing changed.'; end if;
end $$;

create temp table rb_report(tbl text, rows_removed bigint);
do $$
declare r record; n bigint; tid uuid := (select tid from rb_t); loan_ledgers uuid[];
begin
  select coalesce(array_agg(ledger_id), '{}') into loan_ledgers from fin_loans where tenant_id = tid;
  for r in
    select c.table_name t from information_schema.columns c
    join information_schema.tables tb on tb.table_schema = c.table_schema and tb.table_name = c.table_name and tb.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'tenant_id'
      and (c.table_name like 'acc\_%' or c.table_name like 'fin\_%')
      and c.table_name <> all (array['acc_org','acc_accounts','acc_taxcodes','acc_fy','acc_branches','acc_warehouses','acc_masters','acc_saved_views','acc_audit',
                                     'fin_accounts','fin_settings','fin_profile','fin_partners'])
    order by 1
  loop
    execute format('delete from %I where tenant_id = $1', r.t) using tid;
    get diagnostics n = row_count;
    if n > 0 then insert into rb_report values (r.t, n); end if;
  end loop;
  -- ledger accounts that belonged to deleted loans (now empty)
  delete from acc_accounts where tenant_id = tid and id = any(loan_ledgers);
  get diagnostics n = row_count; if n > 0 then insert into rb_report values ('acc_accounts (loan ledgers)', n); end if;
  -- money accounts start again at zero
  update fin_accounts set opening = 0 where tenant_id = tid;
  insert into tenant_data_actions(tenant_id, action, detail) values (tid, 'books_reset', (select coalesce(jsonb_object_agg(tbl, rows_removed), '{}') from rb_report));
end $$;

select 'WOULD REMOVE / REMOVED' as what, tbl, rows_removed from rb_report order by tbl;
select 'bills left' as what, count(*) from acc_documents where tenant_id = (select tid from rb_t);
select 'journal lines left' as what, count(*) from acc_journal_lines where tenant_id = (select tid from rb_t);
select 'number series left (restart at 01)' as what, count(*) from acc_series where tenant_id = (select tid from rb_t);

select (:'confirm' = 'yes') as go \gset
\if :go
  commit;
  \echo DONE: the books are cleared. Numbering restarts at 01.
\else
  rollback;
  \echo DRY RUN ONLY: nothing was changed. Add  -v confirm=yes  to do it for real.
\endif
