-- AUZsLedger: write-offs and discounts against a customer's or supplier's dues, extra party types
-- (employee, partner, other), customer category and supplier bank details.
-- Adjustments reuse the payment tables (account = the expense/income account, not cash) so the AR/AP
-- control accounts keep tying to document balances (acc_integrity_check).

alter table acc_parties
  add column if not exists party_type text check (party_type in ('customer','supplier','employee','partner','other')),
  add column if not exists category text,
  add column if not exists bank_name text,
  add column if not exists bank_account text,
  add column if not exists bank_ifsc text,
  add column if not exists upi_id text;

create or replace function acc_ensure_adjust_accounts(tid uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into acc_accounts (tenant_id, code, name, type, grp, system_key)
  select tid, '5290', 'Bad debts written off', 'expense', 'Operating expenses', 'bad_debt'
  where not exists (select 1 from acc_accounts where tenant_id = tid and system_key = 'bad_debt') on conflict do nothing;
  insert into acc_accounts (tenant_id, code, name, type, grp, system_key)
  select tid, '5291', 'Discount allowed', 'expense', 'Operating expenses', 'disc_allowed'
  where not exists (select 1 from acc_accounts where tenant_id = tid and system_key = 'disc_allowed') on conflict do nothing;
  insert into acc_accounts (tenant_id, code, name, type, grp, system_key)
  select tid, '4490', 'Discount received', 'income', 'Other income', 'disc_received'
  where not exists (select 1 from acc_accounts where tenant_id = tid and system_key = 'disc_received') on conflict do nothing;
end $$;

-- p: {party_id, kind: write_off|discount_given|discount_received, amount, date, notes}
-- Settles the oldest open documents first (invoices for a customer, bills for a supplier).
create or replace function acc_party_adjust(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; k text := p->>'kind'; pty acc_parties; amt numeric := (p->>'amount')::numeric; d date := coalesce(nullif(p->>'date', '')::date, current_date);
  pk text; fy uuid; acct uuid; ctl uuid; lines jsonb := '[]'; jid uuid; pid uuid := gen_random_uuid(); rem numeric; r record; take numeric; due numeric; why text;
begin
  if k not in ('write_off', 'discount_given', 'discount_received') then raise exception 'Choose write-off, discount given or discount received'; end if;
  pk := case when k = 'discount_received' then 'payment' else 'receipt' end;
  tid := acc_guard(case when pk = 'payment' then 'acc_purchase' else 'acc_sales' end);
  if k in ('write_off', 'discount_given') then perform acc_guard('acc_post'); end if;
  if amt is null or amt <= 0 then raise exception 'Amount must be greater than zero'; end if;
  select * into pty from acc_parties where id = (p->>'party_id')::uuid and tenant_id = tid;
  if pty.id is null then raise exception 'Unknown party'; end if;
  if k = 'discount_received' and pty.kind = 'customer' then raise exception 'Discount received is for suppliers'; end if;
  if k <> 'discount_received' and pty.kind = 'supplier' then raise exception 'This is for customers'; end if;
  fy := acc_assert_open(tid, d);
  perform acc_ensure_adjust_accounts(tid);
  acct := acc_sys(tid, case k when 'write_off' then 'bad_debt' when 'discount_given' then 'disc_allowed' else 'disc_received' end);
  ctl := acc_sys(tid, case when pk = 'payment' then 'ap' else 'ar' end);
  select coalesce(sum(total - paid), 0) into due from acc_documents
   where tenant_id = tid and party_id = pty.id and status = 'posted' and total - paid > 0
     and ((pk = 'receipt' and doc_type in ('invoice', 'debit_note')) or (pk = 'payment' and doc_type in ('bill', 'expense', 'credit_note')));
  if amt > due then raise exception 'Only % is outstanding for % - the amount cannot be more', due, pty.name; end if;
  why := case k when 'write_off' then 'Write-off' when 'discount_given' then 'Discount given' else 'Discount received' end;
  if pk = 'receipt' then lines := acc_jl(acc_jl(lines, acct, null, amt, why), ctl, pty.id, -amt, why);
  else lines := acc_jl(acc_jl(lines, ctl, pty.id, amt, why), acct, null, -amt, why); end if;
  jid := acc_post_journal(tid, pk, d, fy, null, why || ' - ' || pty.name, 'payment', pid, lines);
  insert into acc_payments (id, tenant_id, kind, number, pay_date, fy_id, party_id, account_id, amount, mode, reference, notes, journal_id, created_by)
  values (pid, tid, pk, acc_next_no(tid, case when pk = 'receipt' then 'RCT' else 'PAY' end, fy), d, fy, pty.id, acct, amt, why, k, p->>'notes', jid, app_uid());
  rem := amt;
  for r in select id, total - paid as owed from acc_documents
           where tenant_id = tid and party_id = pty.id and status = 'posted' and total - paid > 0
             and ((pk = 'receipt' and doc_type in ('invoice', 'debit_note')) or (pk = 'payment' and doc_type in ('bill', 'expense', 'credit_note')))
           order by coalesce(due_date, doc_date), doc_date, created_at loop
    exit when rem <= 0;
    take := least(rem, r.owed);
    perform acc_do_allocate(tid, pid, null, r.id, take, d);
    rem := rem - take;
  end loop;
  perform acc_audit_log(tid, 'create', k, pid::text, null, jsonb_build_object('amount', amt, 'party', pty.id, 'notes', p->>'notes'));
  return (select jsonb_build_object('id', id, 'number', number, 'amount', amount, 'allocated', allocated) from acc_payments where id = pid);
end $$;

-- party save: new types and fields (copy of db/061 with the additions)
create or replace function acc_save_party(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; pid uuid := nullif(p->>'id', '')::uuid; g text := nullif(upper(trim(p->>'gstin')), ''); old acc_parties; st text; dup text; k text := p->>'kind'; perm text; pt text := nullif(p->>'party_type', '');
begin
  if pt is not null and pt not in ('customer', 'supplier', 'employee', 'partner', 'other') then raise exception 'Unknown party type'; end if;
  if pt in ('employee', 'partner', 'other') then k := 'both'; elsif pt in ('customer', 'supplier') then k := pt; end if;
  perm := case when k = 'supplier' then 'acc_purchase' else 'acc_sales' end;
  tid := acc_guard(perm);
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Name is required'; end if;
  if g is not null and not acc_gstin_valid(g) then raise exception 'GSTIN % is not valid (check the characters and check-digit)', g; end if;
  st := coalesce(nullif(p->>'state_code', ''), substr(g, 1, 2));
  if g is not null and st is not null and substr(g, 1, 2) <> st then raise exception 'State code % does not match the GSTIN (which starts with %)', st, substr(g, 1, 2); end if;
  if p->>'email' is not null and p->>'email' <> '' and p->>'email' !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Enter a valid email address'; end if;
  if g is not null then select name into dup from acc_parties where tenant_id = tid and gstin = g and id is distinct from pid limit 1; end if;
  if pid is null then
    if k not in ('customer', 'supplier', 'both') then raise exception 'Choose customer or supplier'; end if;
    insert into acc_parties (tenant_id, kind, party_type, code, name, gstin, pan, reg_type, state_code, billing_address, shipping_address, phone, email, contact_name, credit_limit, credit_days, tags, notes, category, bank_name, bank_account, bank_ifsc, upi_id)
    values (tid, k, pt, nullif(p->>'code', ''), trim(p->>'name'), g, nullif(upper(trim(p->>'pan')), ''), coalesce(nullif(p->>'reg_type', ''), case when g is null then 'unregistered' else 'regular' end), st,
            p->>'billing_address', p->>'shipping_address', p->>'phone', p->>'email', p->>'contact_name', coalesce((p->>'credit_limit')::numeric, 0), coalesce((p->>'credit_days')::int, 0), p->>'tags', p->>'notes',
            nullif(trim(coalesce(p->>'category', '')), ''), p->>'bank_name', p->>'bank_account', upper(p->>'bank_ifsc'), p->>'upi_id')
    returning id into pid;
    perform acc_audit_log(tid, 'create', 'party', pid::text, null, p);
  else
    select * into old from acc_parties where id = pid and tenant_id = tid;
    if old.id is null then raise exception 'Party not found'; end if;
    if old.is_walkin and p ? 'name' and trim(p->>'name') <> old.name then raise exception 'The walk-in party cannot be renamed'; end if;
    update acc_parties set kind = coalesce(nullif(k, ''), kind), party_type = case when p ? 'party_type' then pt else party_type end,
      code = coalesce(nullif(p->>'code', ''), code), name = coalesce(nullif(trim(p->>'name'), ''), name), gstin = case when p ? 'gstin' then g else gstin end,
      pan = case when p ? 'pan' then nullif(upper(trim(p->>'pan')), '') else pan end, reg_type = coalesce(nullif(p->>'reg_type', ''), reg_type), state_code = case when p ? 'gstin' or p ? 'state_code' then st else state_code end,
      billing_address = coalesce(p->>'billing_address', billing_address), shipping_address = coalesce(p->>'shipping_address', shipping_address),
      phone = coalesce(p->>'phone', phone), email = coalesce(p->>'email', email), contact_name = coalesce(p->>'contact_name', contact_name),
      credit_limit = coalesce((p->>'credit_limit')::numeric, credit_limit), credit_days = coalesce((p->>'credit_days')::int, credit_days),
      category = case when p ? 'category' then nullif(trim(p->>'category'), '') else category end,
      bank_name = coalesce(p->>'bank_name', bank_name), bank_account = coalesce(p->>'bank_account', bank_account),
      bank_ifsc = case when p ? 'bank_ifsc' then upper(p->>'bank_ifsc') else bank_ifsc end, upi_id = coalesce(p->>'upi_id', upi_id),
      tags = coalesce(p->>'tags', tags), notes = coalesce(p->>'notes', notes), active = coalesce((p->>'active')::boolean, active), updated_at = now()
    where id = pid;
    perform acc_audit_log(tid, 'update', 'party', pid::text, to_jsonb(old), p);
  end if;
  return jsonb_build_object('id', pid, 'duplicate_gstin_of', dup);
end $$;

create or replace function acc_list_parties(p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; k text := nullif(p->>'kind', ''); q text := nullif(trim(coalesce(p->>'search', '')), ''); pt text := nullif(p->>'party_type', '');
begin
  tid := acc_guard('acc_view');
  return jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(x) order by lower(x.name)) from (
    select pa.id, pa.kind, pa.party_type, pa.category, pa.bank_name, pa.bank_account, pa.bank_ifsc, pa.upi_id, pa.code, pa.name, pa.gstin, pa.state_code, pa.phone, pa.email, pa.credit_limit, pa.credit_days, pa.reg_type, pa.is_walkin, pa.active, pa.billing_address, pa.shipping_address, pa.contact_name, pa.pan, pa.tags, pa.notes,
      coalesce(b.bal, 0) as balance,
      coalesce((select sum(d.total - d.paid) from acc_documents d where d.party_id = pa.id and d.status = 'posted' and d.doc_type in ('invoice', 'bill', 'expense') and d.total > d.paid and d.due_date < current_date), 0) as overdue
    from acc_parties pa
    left join (select jl.party_id, sum(jl.debit - jl.credit) bal from acc_journal_lines jl join acc_accounts a on a.id = jl.account_id
               where jl.tenant_id = tid and a.system_key in ('ar', 'ap') group by jl.party_id) b on b.party_id = pa.id
    where pa.tenant_id = tid and (k is null or pa.kind = k or (k <> 'both' and pa.kind = 'both'))
      and (pt is null or pa.party_type = pt)
      and (pt is not null or k is null or pa.party_type is null or pa.party_type in ('customer', 'supplier'))
      and (q is null or pa.name ilike '%' || q || '%' or pa.gstin ilike '%' || q || '%' or pa.phone ilike '%' || q || '%' or pa.code ilike '%' || q || '%')
      and (coalesce((p->>'include_inactive')::boolean, false) or pa.active)
    order by lower(pa.name) limit least(coalesce((p->>'limit')::int, 1000), 5000)) x), '[]'));
end $$;
