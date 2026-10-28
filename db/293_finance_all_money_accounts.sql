-- AUZsFinance showed only the cash/bank accounts it was set up with, while AUZsLedger adds up EVERY cash and bank account.
-- Any extra bank/cash account made in Ledger (or by POS/Scan setup) was therefore missing from Finance, so the two totals differed.
-- Now every Ledger cash/bank account is also a Finance money account (kept in step by a trigger and by the catch-up in fin_sync_people).

create or replace function fin_sync_accounts_core(tid uuid) returns void language sql security definer set search_path = public as $$
  insert into fin_accounts (tenant_id, name, kind, ledger_id, active)
    select tid, a.name, case when a.is_bank then 'bank' else 'cash' end, a.id, a.active
    from acc_accounts a
    where a.tenant_id = tid and (a.is_cash or a.is_bank)
      and not exists (select 1 from fin_accounts f where f.ledger_id = a.id);
$$;

create or replace function fin_sync_people() returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; n int;
begin
  tid := fin_guard('write');
  select count(*) into n from fin_people where tenant_id = tid;
  perform fin_sync_people_core(tid);
  perform fin_sync_accounts_core(tid);
  return jsonb_build_object('people', (select count(*) from fin_people where tenant_id = tid), 'was', n);
end $$;

create or replace function fin_account_added() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.is_cash or new.is_bank) and fin_has_finance(new.tenant_id) then
    begin perform fin_sync_accounts_core(new.tenant_id); exception when others then null; end;
  end if;
  return new;
end $$;
drop trigger if exists acc_accounts_to_fin on acc_accounts;
create trigger acc_accounts_to_fin after insert or update of is_cash, is_bank on acc_accounts for each row execute function fin_account_added();

do $$ declare t record; begin
  for t in select tenant_id from tenant_settings where features->>'finance' = 'true' loop
    begin perform fin_sync_accounts_core(t.tenant_id); exception when others then null; end;
  end loop;
end $$;
