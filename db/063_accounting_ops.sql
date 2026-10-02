-- =========================================================
-- AUZslab Accounting: banking and reconciliation, fixed assets, import framework,
-- bulk operations, e-invoice / e-way payload layer, GSTR-2B reconciliation,
-- communication log, budgets, attachments.
-- =========================================================

-- ---------- banking ----------
create function acc_bank_automatch(tid uuid, acct uuid) returns int language plpgsql security definer set search_path = public as $$
declare t record; n int := 0; cands bigint[]; best bigint;
begin
  for t in select * from acc_bank_txns where tenant_id = tid and account_id = acct and status = 'unmatched' order by txn_date, created_at loop
    select array_agg(jl.id order by abs(j.jdate - t.txn_date)) into cands
    from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id
    where jl.tenant_id = tid and jl.account_id = acct and abs(j.jdate - t.txn_date) <= 5
      and ((t.credit > 0 and jl.debit = t.credit) or (t.debit > 0 and jl.credit = t.debit))
      and not exists (select 1 from acc_bank_txns b where b.matched_line_id = jl.id)
      and not exists (select 1 from acc_journals r where r.reverses_id = j.id) and j.reverses_id is null;
    best := null;
    if cands is not null and array_length(cands, 1) = 1 then best := cands[1];
    elsif cands is not null and coalesce(t.reference, '') <> '' then
      select jl.id into best from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id left join acc_payments pm on j.source_type = 'payment' and pm.id = j.source_id
        where jl.id = any(cands) and (coalesce(pm.reference, '') = t.reference or j.narration ilike '%' || t.reference || '%') limit 2;
      if (select count(*) from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id left join acc_payments pm on j.source_type = 'payment' and pm.id = j.source_id
          where jl.id = any(cands) and (coalesce(pm.reference, '') = t.reference or j.narration ilike '%' || t.reference || '%')) <> 1 then best := null; end if;
    end if;
    if best is not null then update acc_bank_txns set status = 'matched', matched_line_id = best where id = t.id; n := n + 1; end if;
  end loop;
  return n;
end $$;

create function acc_bank_import(p_account uuid, p_rows jsonb, p_batch text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; r jsonb; i int := 0; ins int := 0; dup int := 0; bad jsonb := '[]'; d date; dr numeric; cr numeric; amt numeric; ord int; h text; seen jsonb := '{}'; k text; rc int;
begin
  tid := acc_guard('acc_banking');
  if not exists (select 1 from acc_accounts where id = p_account and tenant_id = tid and is_bank) then raise exception 'Choose a bank account'; end if;
  if jsonb_array_length(p_rows) > 20000 then raise exception 'Import at most 20,000 rows at a time'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    i := i + 1;
    begin
      d := (r->>'date')::date;
      if d is null then raise exception 'Date is missing'; end if;
      dr := coalesce(nullif(regexp_replace(coalesce(r->>'debit', ''), '[,\s]', '', 'g'), '')::numeric, 0);
      cr := coalesce(nullif(regexp_replace(coalesce(r->>'credit', ''), '[,\s]', '', 'g'), '')::numeric, 0);
      if r ? 'amount' and nullif(r->>'amount', '') is not null then
        amt := regexp_replace(r->>'amount', '[,\s]', '', 'g')::numeric;
        if amt < 0 then dr := -amt; else cr := amt; end if;
      end if;
      if dr < 0 or cr < 0 or (dr = 0 and cr = 0) or (dr > 0 and cr > 0) then raise exception 'Row needs exactly one of debit or credit'; end if;
      k := d::text || '|' || coalesce(r->>'description', '') || '|' || coalesce(r->>'reference', '') || '|' || dr || '|' || cr;
      ord := coalesce((seen->>k)::int, 0) + 1; seen := seen || jsonb_build_object(k, ord);
      h := md5(k || '|' || ord);
      insert into acc_bank_txns (tenant_id, account_id, txn_date, description, reference, debit, credit, balance, import_batch, dedupe_hash)
      values (tid, p_account, d, left(r->>'description', 300), left(r->>'reference', 100), dr, cr, nullif(regexp_replace(coalesce(r->>'balance', ''), '[,\s]', '', 'g'), '')::numeric, p_batch, h)
      on conflict (tenant_id, account_id, dedupe_hash) do nothing;
      get diagnostics rc = row_count;
      if rc = 1 then ins := ins + 1; else dup := dup + 1; end if;
    exception when others then
      bad := bad || jsonb_build_array(jsonb_build_object('row', coalesce(nullif(r->>'_row', '')::int, i), 'message', sqlerrm));
    end;
  end loop;
  perform acc_audit_log(tid, 'import', 'bank_txns', p_account::text, null, jsonb_build_object('imported', ins, 'duplicates', dup, 'errors', jsonb_array_length(bad)));
  return jsonb_build_object('imported', ins, 'duplicates', dup, 'errors', bad, 'matched', acc_bank_automatch(tid, p_account));
end $$;

create function acc_bank_list(p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; acct uuid := (p->>'account_id')::uuid; st text := nullif(p->>'status', '');
begin
  tid := acc_guard('acc_banking');
  return jsonb_build_object(
    'rows', coalesce((select jsonb_agg(to_jsonb(r) order by r.txn_date desc, r.created_at desc) from (
      select b.id, b.txn_date, b.description, b.reference, b.debit, b.credit, b.balance, b.status, b.recon_id, b.matched_line_id, b.created_at,
             (select j.number from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id where jl.id = b.matched_line_id) as journal_number
      from acc_bank_txns b where b.tenant_id = tid and b.account_id = acct and (st is null or b.status = st)
        and (nullif(p->>'from', '') is null or b.txn_date >= (p->>'from')::date) and (nullif(p->>'to', '') is null or b.txn_date <= (p->>'to')::date)
      order by b.txn_date desc, b.created_at desc limit least(coalesce((p->>'limit')::int, 500), 3000)) r), '[]'),
    'book_balance', (select coalesce(sum(debit - credit), 0) from acc_journal_lines where tenant_id = tid and account_id = acct),
    'unmatched', (select count(*) from acc_bank_txns where tenant_id = tid and account_id = acct and status = 'unmatched'),
    'last_recon', (select to_jsonb(x) from acc_recons x where tenant_id = tid and account_id = acct order by statement_date desc, created_at desc limit 1));
end $$;

-- ledger lines on the bank account that no statement row has claimed yet
create function acc_bank_book_lines(p_account uuid, p_upto date default null) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := acc_guard('acc_banking');
  return jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(r) order by r.jdate, r.id) from (
    select jl.id, j.jdate, j.number, j.narration, jl.debit, jl.credit, coalesce(d.number, pm.number) as doc_number, pm.reference,
           exists (select 1 from acc_journals x where x.reverses_id = j.id) or j.reverses_id is not null as reversed
    from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id left join acc_payments pm on j.source_type = 'payment' and pm.id = j.source_id left join acc_documents d on j.source_type = 'document' and d.id = j.source_id
    where jl.tenant_id = tid and jl.account_id = p_account and (p_upto is null or j.jdate <= p_upto) and not exists (select 1 from acc_bank_txns b where b.matched_line_id = jl.id)
    order by j.jdate limit 2000) r), '[]'));
end $$;

create function acc_bank_match(p_txn uuid, p_line bigint) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; t acc_bank_txns; jl acc_journal_lines;
begin
  tid := acc_guard('acc_banking');
  select * into t from acc_bank_txns where id = p_txn and tenant_id = tid for update;
  if t.id is null then raise exception 'Statement row not found'; end if;
  if t.recon_id is not null then raise exception 'This row is part of a finished reconciliation'; end if;
  select * into jl from acc_journal_lines where id = p_line and tenant_id = tid;
  if jl.id is null or jl.account_id <> t.account_id then raise exception 'That entry is not on this bank account'; end if;
  if exists (select 1 from acc_bank_txns where matched_line_id = p_line) then raise exception 'That entry is already matched'; end if;
  if not ((t.credit > 0 and jl.debit = t.credit) or (t.debit > 0 and jl.credit = t.debit)) then raise exception 'Amounts do not agree (statement % vs books %)', greatest(t.credit, t.debit), greatest(jl.debit, jl.credit); end if;
  update acc_bank_txns set status = 'matched', matched_line_id = p_line where id = p_txn;
  perform acc_audit_log(tid, 'match', 'bank_txn', p_txn::text, null, jsonb_build_object('line', p_line));
  return jsonb_build_object('ok', true);
end $$;

create function acc_bank_unmatch(p_txn uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; t acc_bank_txns;
begin
  tid := acc_guard('acc_banking');
  select * into t from acc_bank_txns where id = p_txn and tenant_id = tid for update;
  if t.id is null then raise exception 'Statement row not found'; end if;
  if t.recon_id is not null then raise exception 'This row is part of a finished reconciliation'; end if;
  update acc_bank_txns set status = 'unmatched', matched_line_id = null where id = p_txn;
  perform acc_audit_log(tid, 'unmatch', 'bank_txn', p_txn::text, jsonb_build_object('line', t.matched_line_id), null);
  return jsonb_build_object('ok', true);
end $$;

create function acc_bank_ignore(p_txn uuid, p_ignore boolean default true) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := acc_guard('acc_banking');
  update acc_bank_txns set status = case when p_ignore then 'ignored' else 'unmatched' end, matched_line_id = null where id = p_txn and tenant_id = tid and recon_id is null;
  return jsonb_build_object('ok', true);
end $$;

-- book an entry for a statement row that has no counterpart yet (bank charges, interest, a receipt...) and match it
create function acc_bank_create_entry(p_txn uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; t acc_bank_txns; fy uuid; jid uuid; lines jsonb := '[]'; amt numeric; counter uuid := nullif(p->>'account_id', '')::uuid; party uuid := nullif(p->>'party_id', '')::uuid; pid uuid; line_id bigint; kind text;
begin
  tid := acc_guard('acc_banking');
  select * into t from acc_bank_txns where id = p_txn and tenant_id = tid for update;
  if t.id is null then raise exception 'Statement row not found'; end if;
  if t.status = 'matched' then raise exception 'This row is already matched'; end if;
  amt := greatest(t.debit, t.credit); kind := case when t.credit > 0 then 'receipt' else 'payment' end;
  if party is not null then
    pid := acc_do_payment(tid, kind, t.txn_date, party, t.account_id, amt, 'Bank', t.reference, coalesce(p->>'narration', t.description), '[]');
    select jl.id into line_id from acc_payments pm join acc_journal_lines jl on jl.journal_id = pm.journal_id and jl.account_id = t.account_id where pm.id = pid;
  else
    if counter is null then raise exception 'Choose an account or a customer/supplier'; end if;
    if (select system_key from acc_accounts where id = counter) in ('ar', 'ap', 'inventory') then raise exception 'Choose a customer/supplier for that account'; end if;
    fy := acc_assert_open(tid, t.txn_date);
    lines := case when t.credit > 0 then acc_jl(acc_jl(lines, t.account_id, null, amt), counter, null, -amt) else acc_jl(acc_jl(lines, counter, null, amt), t.account_id, null, -amt) end;
    jid := acc_post_journal(tid, kind, t.txn_date, fy, null, coalesce(nullif(p->>'narration', ''), t.description, 'Bank entry'), 'bank', p_txn, lines);
    select id into line_id from acc_journal_lines where journal_id = jid and account_id = t.account_id limit 1;
  end if;
  update acc_bank_txns set status = 'matched', matched_line_id = line_id where id = p_txn;
  perform acc_audit_log(tid, 'bank_entry', 'bank_txn', p_txn::text, null, jsonb_build_object('amount', amt, 'kind', kind));
  return jsonb_build_object('ok', true, 'line_id', line_id);
end $$;

-- statement balance on a date vs books; commits only when it reconciles to zero
create function acc_bank_reconcile(p_account uuid, p_date date, p_balance numeric, p_commit boolean default false) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; book numeric; dep numeric; chq numeric; adj numeric; diff numeric; unm int; rid uuid; cleared int;
begin
  tid := acc_guard('acc_banking');
  select coalesce(sum(jl.debit - jl.credit), 0) into book from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id where jl.tenant_id = tid and jl.account_id = p_account and j.jdate <= p_date;
  select coalesce(sum(jl.debit), 0), coalesce(sum(jl.credit), 0) into dep, chq from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id
    where jl.tenant_id = tid and jl.account_id = p_account and j.jdate <= p_date and not exists (select 1 from acc_bank_txns b where b.matched_line_id = jl.id);
  adj := p_balance + dep - chq;          -- statement + deposits in transit - cheques not yet presented
  diff := round(book - adj, 2);
  select count(*) into unm from acc_bank_txns where tenant_id = tid and account_id = p_account and status = 'unmatched' and txn_date <= p_date;
  select count(*) into cleared from acc_bank_txns where tenant_id = tid and account_id = p_account and status = 'matched' and recon_id is null and txn_date <= p_date;
  if p_commit then
    if diff <> 0 then raise exception 'Not reconciled: books % vs adjusted statement % (difference %)', book, adj, diff; end if;
    if unm > 0 then raise exception '% statement row(s) are still unmatched - match or ignore them first', unm; end if;
    insert into acc_recons (tenant_id, account_id, statement_date, statement_balance, book_balance, uncleared, difference, items, created_by)
    values (tid, p_account, p_date, p_balance, book, dep - chq, diff, cleared, app_uid()) returning id into rid;
    update acc_bank_txns set recon_id = rid where tenant_id = tid and account_id = p_account and status = 'matched' and recon_id is null and txn_date <= p_date;
    perform acc_audit_log(tid, 'reconcile', 'bank_account', p_account::text, null, jsonb_build_object('date', p_date, 'balance', p_balance));
  end if;
  return jsonb_build_object('book_balance', book, 'statement_balance', p_balance, 'deposits_in_transit', dep, 'cheques_outstanding', chq, 'adjusted_statement', adj, 'difference', diff,
    'unmatched_rows', unm, 'cleared_rows', cleared, 'reconciled', diff = 0 and unm = 0, 'committed', p_commit and diff = 0, 'recon_id', rid);
end $$;

create function acc_bank_recons(p_account uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := acc_guard('acc_banking');
  return jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(x) order by x.statement_date desc) from acc_recons x where tenant_id = tid and account_id = p_account), '[]'));
end $$;

-- ---------- fixed assets ----------
create function acc_save_asset(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; aid uuid := gen_random_uuid(); d date := (p->>'acquisition_date')::date; cost numeric := (p->>'cost')::numeric; fy uuid; lines jsonb := '[]'; jid uuid; pay uuid := nullif(p->>'pay_account_id', '')::uuid; party uuid := nullif(p->>'party_id', '')::uuid; code text;
begin
  tid := acc_guard('acc_post');
  if d is null or cost is null or cost <= 0 then raise exception 'Enter the purchase date and cost'; end if;
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Asset name is required'; end if;
  fy := acc_assert_open(tid, d);
  code := coalesce(nullif(trim(p->>'code'), ''), 'FA-' || lpad((select count(*) + 1 from acc_fixed_assets where tenant_id = tid)::text, 4, '0'));
  lines := acc_jl(lines, acc_sys(tid, 'fixed_assets'), null, cost);
  if party is not null then lines := acc_jl(lines, acc_sys(tid, 'ap'), party, -cost);
  elsif pay is not null and exists (select 1 from acc_accounts where id = pay and tenant_id = tid and (is_bank or is_cash)) then lines := acc_jl(lines, pay, null, -cost);
  else lines := acc_jl(lines, acc_sys(tid, 'opening_equity'), null, -cost); end if;
  jid := acc_post_journal(tid, 'journal', d, fy, null, 'Asset purchase - ' || (p->>'name'), 'asset', aid, lines);
  insert into acc_fixed_assets (id, tenant_id, code, name, class, acquisition_date, cost, salvage, life_years, method, rate_pct, location, custodian, pay_account_id, purchase_journal_id, created_by)
  values (aid, tid, code, trim(p->>'name'), p->>'class', d, cost, coalesce((p->>'salvage')::numeric, 0), coalesce((p->>'life_years')::numeric, 5), coalesce(p->>'method', 'slm'), nullif(p->>'rate_pct', '')::numeric, p->>'location', p->>'custodian', pay, jid, app_uid());
  perform acc_audit_log(tid, 'create', 'asset', aid::text, null, p);
  return jsonb_build_object('id', aid, 'code', code);
end $$;

-- one depreciation journal per month-end for all active assets; safe to run twice
create function acc_run_depreciation(p_month date) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; me_date date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date; a record; amt numeric; total numeric := 0; n int := 0; fy uuid; jid uuid; lines jsonb := '[]'; base numeric;
begin
  tid := acc_guard('acc_post');
  fy := acc_assert_open(tid, me_date);
  for a in select * from acc_fixed_assets where tenant_id = tid and status = 'active' and acquisition_date <= me_date and not exists (select 1 from acc_depreciation d where d.asset_id = acc_fixed_assets.id and d.period_end = me_date) for update loop
    base := a.cost - a.salvage - a.accumulated;
    if base <= 0 then continue; end if;
    if a.method = 'wdv' then amt := round((a.cost - a.accumulated) * coalesce(a.rate_pct, 15) / 100 / 12, 2); else amt := round((a.cost - a.salvage) / (a.life_years * 12), 2); end if;
    amt := least(amt, base);
    if amt <= 0 then continue; end if;
    total := total + amt; n := n + 1;
  end loop;
  if n = 0 then return jsonb_build_object('assets', 0, 'amount', 0, 'period_end', me_date); end if;
  lines := acc_jl(acc_jl(lines, acc_sys(tid, 'dep_expense'), null, total), acc_sys(tid, 'accum_dep'), null, -total);
  jid := acc_post_journal(tid, 'depreciation', me_date, fy, null, 'Depreciation for ' || to_char(me_date, 'Mon YYYY'), 'depreciation', null, lines);
  for a in select * from acc_fixed_assets where tenant_id = tid and status = 'active' and acquisition_date <= me_date and not exists (select 1 from acc_depreciation d where d.asset_id = acc_fixed_assets.id and d.period_end = me_date) loop
    base := a.cost - a.salvage - a.accumulated;
    if base <= 0 then continue; end if;
    if a.method = 'wdv' then amt := round((a.cost - a.accumulated) * coalesce(a.rate_pct, 15) / 100 / 12, 2); else amt := round((a.cost - a.salvage) / (a.life_years * 12), 2); end if;
    amt := least(amt, base);
    if amt <= 0 then continue; end if;
    insert into acc_depreciation (tenant_id, asset_id, period_end, amount, journal_id) values (tid, a.id, me_date, amt, jid);
    update acc_fixed_assets set accumulated = accumulated + amt where id = a.id;
  end loop;
  perform acc_audit_log(tid, 'depreciate', 'asset', me_date::text, null, jsonb_build_object('assets', n, 'amount', total));
  return jsonb_build_object('assets', n, 'amount', total, 'period_end', me_date, 'journal_id', jid);
end $$;

create function acc_dispose_asset(p_asset uuid, p_date date, p_amount numeric, p_account uuid default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; a acc_fixed_assets; fy uuid; lines jsonb := '[]'; jid uuid; gain numeric;
begin
  tid := acc_guard('acc_post');
  select * into a from acc_fixed_assets where id = p_asset and tenant_id = tid for update;
  if a.id is null then raise exception 'Asset not found'; end if;
  if a.status = 'disposed' then raise exception '% is already disposed', a.name; end if;
  if p_date < a.acquisition_date then raise exception 'Disposal cannot be before purchase'; end if;
  if coalesce(p_amount, 0) < 0 then raise exception 'Sale amount cannot be negative'; end if;
  fy := acc_assert_open(tid, p_date);
  gain := coalesce(p_amount, 0) - (a.cost - a.accumulated);
  if coalesce(p_amount, 0) > 0 then
    if p_account is null or not exists (select 1 from acc_accounts where id = p_account and tenant_id = tid and (is_bank or is_cash)) then raise exception 'Choose the cash or bank account that received the money'; end if;
    lines := acc_jl(lines, p_account, null, p_amount);
  end if;
  lines := acc_jl(lines, acc_sys(tid, 'accum_dep'), null, a.accumulated);
  lines := acc_jl(lines, acc_sys(tid, 'fixed_assets'), null, -a.cost);
  lines := acc_jl(lines, acc_sys(tid, 'disposal_gl'), null, -gain);
  jid := acc_post_journal(tid, 'journal', p_date, fy, null, 'Disposal of ' || a.name, 'asset', a.id, lines);
  update acc_fixed_assets set status = 'disposed', disposal_date = p_date, disposal_amount = coalesce(p_amount, 0), disposal_journal_id = jid where id = a.id;
  perform acc_audit_log(tid, 'dispose', 'asset', a.id::text, null, jsonb_build_object('amount', p_amount, 'gain', gain));
  return jsonb_build_object('journal_id', jid, 'gain_or_loss', gain);
end $$;

create function acc_list_assets() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := acc_guard('acc_view');
  return jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(r) order by r.acquisition_date desc) from (
    select f.*, f.cost - f.accumulated as carrying_value, (select max(period_end) from acc_depreciation d where d.asset_id = f.id) as depreciated_to from acc_fixed_assets f where f.tenant_id = tid) r), '[]'),
    'totals', (select jsonb_build_object('cost', coalesce(sum(cost) filter (where status = 'active'), 0), 'accumulated', coalesce(sum(accumulated) filter (where status = 'active'), 0)) from acc_fixed_assets where tenant_id = tid));
end $$;

-- ---------- import framework (dry-run first, same code path as the real run) ----------
create function acc_find_party(tid uuid, nm text, gst text, k text, create_missing boolean) returns uuid language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  if coalesce(gst, '') <> '' then select id into pid from acc_parties where tenant_id = tid and gstin = upper(trim(gst)) limit 1; end if;
  if pid is null and coalesce(nm, '') <> '' then select id into pid from acc_parties where tenant_id = tid and lower(name) = lower(trim(nm)) and kind in (k, 'both') limit 1; end if;
  if pid is null and create_missing and coalesce(nm, '') <> '' then pid := ((acc_save_party(jsonb_build_object('kind', k, 'name', nm, 'gstin', nullif(gst, ''))))->>'id')::uuid; end if;
  return pid;
end $$;

create function acc_import(p_entity text, p_rows jsonb, p_commit boolean default false, p_strict boolean default true, p_options jsonb default '{}') returns jsonb
language plpgsql security definer set search_path = public as $$
declare tid uuid; r jsonb; i int := 0; ok int := 0; dups int := 0; errs jsonb := '[]'; preview jsonb := '[]'; created int := 0; updated int := 0; res text; opt_dup text := coalesce(p_options->>'on_duplicate', 'skip'); cm boolean := coalesce((p_options->>'create_missing')::boolean, true);
  pid uuid; prid uuid; aid uuid; wid uuid; g record; lines jsonb; payload jsonb; jobid uuid := gen_random_uuid(); n_total int; wcode text; rowno int; gk text; acct uuid; doc uuid; d date;
begin
  tid := acc_guard('acc_import');
  if p_entity not in ('customers', 'suppliers', 'products', 'accounts', 'opening_stock', 'party_openings', 'account_openings', 'sales', 'purchases', 'receipts', 'payments') then raise exception 'Cannot import %', p_entity; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then raise exception 'There are no rows to import'; end if;
  if jsonb_array_length(p_rows) > 20000 then raise exception 'Import at most 20,000 rows at a time'; end if;
  n_total := jsonb_array_length(p_rows);
  begin
    if p_entity in ('sales', 'purchases') then
      -- group rows by document number: one document per number
      for g in select coalesce(nullif(x->>'doc_no', ''), 'row-' || ord) as gk, jsonb_agg(x order by ord) as rws from jsonb_array_elements(p_rows) with ordinality t(x, ord) group by 1 order by min(ord) loop
        i := i + 1; rowno := coalesce(nullif(g.rws->0->>'_row', '')::int, i);
        begin
          if exists (select 1 from acc_documents where tenant_id = tid and doc_type = case when p_entity = 'sales' then 'invoice' else 'bill' end and (number = g.gk or supplier_ref = g.gk and p_entity = 'purchases'))
             and g.gk not like 'row-%' then
            dups := dups + 1; continue;
          end if;
          pid := acc_find_party(tid, g.rws->0->>'party', g.rws->0->>'gstin', case when p_entity = 'sales' then 'customer' else 'supplier' end, cm);
          if pid is null and p_entity = 'purchases' then raise exception 'Supplier "%" not found', g.rws->0->>'party'; end if;
          select coalesce(jsonb_agg(jsonb_build_object('product_id', (select id from acc_products where tenant_id = tid and (sku = l->>'sku' or lower(name) = lower(l->>'description')) limit 1),
              'description', coalesce(l->>'description', l->>'sku'), 'hsn', l->>'hsn', 'qty', coalesce(nullif(l->>'qty', ''), '1'), 'rate', l->>'rate', 'disc_pct', coalesce(nullif(l->>'disc_pct', ''), '0'), 'tax_rate', l->>'tax_rate',
              'account_id', (select id from acc_accounts where tenant_id = tid and (code = l->>'account' or lower(name) = lower(l->>'account')) limit 1)) order by o), '[]') into lines
            from jsonb_array_elements(g.rws) with ordinality t(l, o);
          payload := jsonb_build_object('doc_type', case when p_entity = 'sales' then 'invoice' else 'bill' end, 'doc_date', g.rws->0->>'date', 'due_date', nullif(g.rws->0->>'due_date', ''), 'party_id', pid,
            'supplier_ref', case when p_entity = 'purchases' then g.gk end, 'lines', lines, 'post', true, 'place_of_supply', nullif(g.rws->0->>'place_of_supply', ''),
            'meta', case when p_entity = 'sales' and g.gk not like 'row-%' then jsonb_build_object('import_number', g.gk) else '{}'::jsonb end, 'notes', 'Imported');
          perform acc_save_document(payload);
          ok := ok + 1; created := created + 1;
          if jsonb_array_length(preview) < 20 then preview := preview || jsonb_build_array(jsonb_build_object('row', rowno, 'doc_no', g.gk, 'party', g.rws->0->>'party', 'lines', jsonb_array_length(lines))); end if;
        exception when others then errs := errs || jsonb_build_array(jsonb_build_object('row', rowno, 'key', g.gk, 'message', sqlerrm));
        end;
      end loop;
    elsif p_entity = 'opening_stock' then
      for g in select coalesce(nullif(x->>'warehouse', ''), 'MAIN') as wcode, coalesce(nullif(x->>'date', ''), current_date::text) as d, jsonb_agg(x order by ord) as rws
               from jsonb_array_elements(p_rows) with ordinality t(x, ord) group by 1, 2 loop
        begin
          select id into wid from acc_warehouses where tenant_id = tid and (upper(code) = upper(g.wcode) or lower(name) = lower(g.wcode)) limit 1;
          if wid is null then raise exception 'Warehouse % not found', g.wcode; end if;
          select jsonb_agg(jsonb_build_object('product_id', (select id from acc_products where tenant_id = tid and (sku = l->>'sku' or lower(name) = lower(l->>'name')) limit 1), 'qty', l->>'qty', 'unit_cost', nullif(l->>'unit_cost', ''),
              'batch_no', nullif(l->>'batch_no', ''), 'expiry', nullif(l->>'expiry', ''))) into lines from jsonb_array_elements(g.rws) l;
          if exists (select 1 from jsonb_array_elements(lines) x where x->>'product_id' is null) then raise exception 'One or more SKUs were not found'; end if;
          perform acc_stock_adjust(jsonb_build_object('date', g.d, 'warehouse_id', wid, 'opening', true, 'reason', 'Opening stock', 'lines', lines));
          ok := ok + jsonb_array_length(g.rws); created := created + jsonb_array_length(g.rws);
        exception when others then errs := errs || jsonb_build_array(jsonb_build_object('row', coalesce(nullif(g.rws->0->>'_row', '')::int, 0), 'key', g.wcode, 'message', sqlerrm));
        end;
      end loop;
    elsif p_entity = 'account_openings' then
      begin
        lines := '[]';
        for r in select * from jsonb_array_elements(p_rows) loop
          i := i + 1;
          select id into aid from acc_accounts where tenant_id = tid and (code = r->>'code' or lower(name) = lower(r->>'name')) limit 1;
          if aid is null then errs := errs || jsonb_build_array(jsonb_build_object('row', coalesce(nullif(r->>'_row', '')::int, i), 'message', 'Account not found'));
          else lines := lines || jsonb_build_array(jsonb_build_object('account_id', aid, 'debit', coalesce(nullif(r->>'debit', ''), '0'), 'credit', coalesce(nullif(r->>'credit', ''), '0'))); ok := ok + 1; end if;
        end loop;
        if jsonb_array_length(lines) > 0 and (jsonb_array_length(errs) = 0 or not p_strict) then
          perform acc_post_opening(coalesce(nullif(p_options->>'date', '')::date, current_date), lines); created := 1;
        end if;
      end;
    else
      for r in select * from jsonb_array_elements(p_rows) loop
        i := i + 1; rowno := coalesce(nullif(r->>'_row', '')::int, i);
        begin
          if p_entity in ('customers', 'suppliers') then
            pid := null;
            if coalesce(r->>'gstin', '') <> '' then select id into pid from acc_parties where tenant_id = tid and gstin = upper(trim(r->>'gstin')) limit 1;
            else select id into pid from acc_parties where tenant_id = tid and lower(name) = lower(trim(r->>'name')) and coalesce(phone, '') = coalesce(r->>'phone', '') limit 1; end if;
            if pid is not null and opt_dup = 'skip' then dups := dups + 1; continue; end if;
            payload := r || jsonb_build_object('kind', case when p_entity = 'customers' then 'customer' else 'supplier' end, 'id', pid);
            perform acc_save_party(payload);
            if pid is null then created := created + 1; else updated := updated + 1; end if;
          elsif p_entity = 'products' then
            select id into pid from acc_products where tenant_id = tid and sku = trim(r->>'sku');
            if pid is not null and opt_dup = 'skip' then dups := dups + 1; continue; end if;
            perform acc_save_product(r || jsonb_build_object('id', pid));
            if pid is null then created := created + 1; else updated := updated + 1; end if;
          elsif p_entity = 'accounts' then
            select id into aid from acc_accounts where tenant_id = tid and code = trim(r->>'code');
            if aid is not null and opt_dup = 'skip' then dups := dups + 1; continue; end if;
            perform acc_save_account(r || jsonb_build_object('id', aid));
            if aid is null then created := created + 1; else updated := updated + 1; end if;
          elsif p_entity = 'party_openings' then
            pid := acc_find_party(tid, r->>'name', r->>'gstin', coalesce(nullif(r->>'kind', ''), 'customer'), false);
            if pid is null then raise exception 'Party "%" not found', r->>'name'; end if;
            perform acc_set_party_opening(pid, (r->>'amount')::numeric, coalesce(nullif(r->>'date', '')::date, nullif(p_options->>'date', '')::date, current_date));
            created := created + 1;
          elsif p_entity in ('receipts', 'payments') then
            pid := acc_find_party(tid, r->>'party', r->>'gstin', case when p_entity = 'receipts' then 'customer' else 'supplier' end, false);
            if pid is null then raise exception 'Party "%" not found', r->>'party'; end if;
            select id into acct from acc_accounts where tenant_id = tid and (is_bank or is_cash) and (code = r->>'account' or lower(name) = lower(r->>'account')) limit 1;
            if acct is null then select id into acct from acc_accounts where tenant_id = tid and ((is_cash and lower(coalesce(r->>'mode', 'cash')) = 'cash') or (is_bank and lower(coalesce(r->>'mode', '')) <> 'cash')) order by is_cash desc limit 1; end if;
            doc := null;
            if coalesce(r->>'doc_no', '') <> '' then select id into doc from acc_documents where tenant_id = tid and party_id = pid and (number = r->>'doc_no' or supplier_ref = r->>'doc_no') and status = 'posted' limit 1; end if;
            perform acc_save_payment(jsonb_build_object('kind', case when p_entity = 'receipts' then 'receipt' else 'payment' end, 'party_id', pid, 'account_id', acct, 'amount', r->>'amount', 'date', r->>'date', 'mode', r->>'mode',
              'reference', r->>'reference', 'allocations', case when doc is not null then jsonb_build_array(jsonb_build_object('doc_id', doc, 'amount', least((r->>'amount')::numeric, (select total - paid from acc_documents where id = doc)))) else '[]'::jsonb end,
              'auto_allocate', doc is null));
            created := created + 1;
          end if;
          ok := ok + 1;
          if jsonb_array_length(preview) < 20 then preview := preview || jsonb_build_array(r); end if;
        exception when others then errs := errs || jsonb_build_array(jsonb_build_object('row', rowno, 'message', sqlerrm));
        end;
      end loop;
    end if;
    if jsonb_array_length(errs) > 0 and p_strict and p_commit then raise exception using errcode = 'AC998', message = 'Import stopped: ' || jsonb_array_length(errs) || ' row(s) have errors and strict mode is on'; end if;
    if not p_commit then raise exception using errcode = 'AC999', message = 'dry run'; end if;
  exception
    when sqlstate 'AC999' then null;                                   -- dry run: everything above is rolled back, the counters survive
    when sqlstate 'AC998' then
      ok := 0; created := 0; updated := 0;                              -- nothing was applied
  end;
  insert into acc_import_jobs (id, tenant_id, entity, status, total, ok, failed, duplicates, errors, mapping, created_by)
  values (jobid, tid, p_entity, case when p_commit and ok > 0 then 'committed' when p_commit then 'failed' else 'previewed' end, n_total, ok, jsonb_array_length(errs), dups, errs, coalesce(p_options->'mapping', '{}'), app_uid());
  if p_commit then perform acc_audit_log(tid, 'import', p_entity, jobid::text, null, jsonb_build_object('ok', ok, 'failed', jsonb_array_length(errs), 'duplicates', dups)); end if;
  return jsonb_build_object('job_id', jobid, 'entity', p_entity, 'dry_run', not p_commit, 'total', n_total, 'ok', ok, 'created', created, 'updated', updated, 'duplicates', dups, 'failed', jsonb_array_length(errs), 'errors', errs, 'preview', preview,
    'committed', p_commit and ok > 0 and (jsonb_array_length(errs) = 0 or not p_strict));
end $$;

create function acc_list_imports() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := acc_guard('acc_import');
  return jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(j) order by j.created_at desc) from (select * from acc_import_jobs where tenant_id = tid order by created_at desc limit 50) j), '[]'));
end $$;

-- ---------- bulk operations ----------
create function acc_bulk_update(p_entity text, p_ids uuid[], p_changes jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; n int := 0; pct numeric;
begin
  if cardinality(p_ids) = 0 then raise exception 'Select at least one row'; end if;
  if cardinality(p_ids) > 5000 then raise exception 'Too many rows selected (max 5,000)'; end if;
  if p_entity = 'parties' then
    tid := acc_guard('acc_sales');
    update acc_parties set credit_limit = coalesce(nullif(p_changes->>'credit_limit', '')::numeric, credit_limit), credit_days = coalesce(nullif(p_changes->>'credit_days', '')::int, credit_days),
      active = coalesce((p_changes->>'active')::boolean, active), tags = coalesce(p_changes->>'tags', tags), updated_at = now() where tenant_id = tid and id = any(p_ids) and not is_walkin;
  elsif p_entity = 'products' then
    tid := acc_guard('acc_inventory');
    if nullif(p_changes->>'tax_rate', '') is not null and (p_changes->>'tax_rate')::numeric <> 0 and not exists (select 1 from acc_taxcodes where tenant_id = tid and active and rate = (p_changes->>'tax_rate')::numeric) then raise exception 'GST rate % is not configured', p_changes->>'tax_rate'; end if;
    pct := nullif(p_changes->>'sale_price_pct', '')::numeric;
    update acc_products set tax_rate = coalesce(nullif(p_changes->>'tax_rate', '')::numeric, tax_rate), hsn = coalesce(nullif(p_changes->>'hsn', ''), hsn), category = coalesce(nullif(p_changes->>'category', ''), category),
      brand = coalesce(nullif(p_changes->>'brand', ''), brand), active = coalesce((p_changes->>'active')::boolean, active), reorder_level = coalesce(nullif(p_changes->>'reorder_level', '')::numeric, reorder_level),
      sale_price = case when pct is not null then round(sale_price * (1 + pct / 100), 4) else coalesce(nullif(p_changes->>'sale_price', '')::numeric, sale_price) end,
      purchase_price = case when nullif(p_changes->>'purchase_price_pct', '') is not null then round(purchase_price * (1 + (p_changes->>'purchase_price_pct')::numeric / 100), 4) else purchase_price end, updated_at = now()
    where tenant_id = tid and id = any(p_ids);
  else raise exception 'Cannot bulk edit %', p_entity; end if;
  get diagnostics n = row_count;
  perform acc_audit_log(tid, 'bulk_update', p_entity, null, null, p_changes || jsonb_build_object('count', n));
  return jsonb_build_object('updated', n);
end $$;

create function acc_bulk_post(p_ids uuid[]) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; i uuid; res jsonb := '[]'; r jsonb;
begin
  if cardinality(p_ids) > 500 then raise exception 'Post at most 500 documents at a time'; end if;
  foreach i in array p_ids loop
    begin
      r := acc_post_document(i);
      res := res || jsonb_build_array(jsonb_build_object('id', i, 'ok', true, 'number', r->>'number'));
    exception when others then
      res := res || jsonb_build_array(jsonb_build_object('id', i, 'ok', false, 'error', sqlerrm));
    end;
  end loop;
  return jsonb_build_object('results', res, 'posted', (select count(*) from jsonb_array_elements(res) x where (x->>'ok')::boolean), 'failed', (select count(*) from jsonb_array_elements(res) x where not (x->>'ok')::boolean));
end $$;

-- overdue customers (or suppliers) with what they owe, for reminders and statements
create function acc_due_reminders(p_side text default 'receivable') returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := acc_guard('acc_view');
  return jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(r) order by r.overdue desc) from (
    select pa.id as party_id, pa.name, pa.phone, pa.email, sum(d.total - d.paid) as overdue, min(d.due_date) as oldest_due, count(*) as docs,
           jsonb_agg(jsonb_build_object('number', d.number, 'due', d.due_date, 'amount', d.total - d.paid) order by d.due_date) as items
    from acc_documents d join acc_parties pa on pa.id = d.party_id
    where d.tenant_id = tid and d.status = 'posted' and d.total > d.paid and d.due_date < current_date
      and ((p_side = 'receivable' and d.doc_type = 'invoice') or (p_side = 'payable' and d.doc_type in ('bill', 'expense')))
    group by pa.id) r), '[]'));
end $$;

-- ---------- communication log ----------
create function acc_log_comm(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; cid uuid;
begin
  tid := acc_guard('acc_sales');
  insert into acc_comms (tenant_id, channel, kind, party_id, doc_id, recipient, subject, body, status, error, created_by)
  values (tid, coalesce(p->>'channel', 'email'), coalesce(p->>'kind', 'invoice'), nullif(p->>'party_id', '')::uuid, nullif(p->>'doc_id', '')::uuid, p->>'recipient', p->>'subject', p->>'body',
          coalesce(p->>'status', 'logged'), p->>'error', app_uid()) returning id into cid;
  return jsonb_build_object('id', cid);
end $$;

create function acc_retry_comm(p_id uuid, p_status text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := acc_guard('acc_sales');
  update acc_comms set status = p_status, retries = retries + 1 where id = p_id and tenant_id = tid;
  return jsonb_build_object('ok', true);
end $$;

create function acc_list_comms(p jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := acc_guard('acc_view');
  return jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from (
    select c.id, c.channel, c.kind, c.recipient, c.subject, c.body, c.status, c.retries, c.error, c.created_at, pa.name as party, d.number as doc_number
    from acc_comms c left join acc_parties pa on pa.id = c.party_id left join acc_documents d on d.id = c.doc_id
    where c.tenant_id = tid and (nullif(p->>'party_id', '') is null or c.party_id = (p->>'party_id')::uuid) and (nullif(p->>'doc_id', '') is null or c.doc_id = (p->>'doc_id')::uuid)
    order by c.created_at desc limit 200) r), '[]'));
end $$;

-- ---------- budgets ----------
create function acc_save_budget(p_fy uuid, p_rows jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; r jsonb; n int := 0;
begin
  tid := acc_guard('acc_admin');
  if not exists (select 1 from acc_fy where id = p_fy and tenant_id = tid) then raise exception 'Unknown financial year'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    if not exists (select 1 from acc_accounts where id = (r->>'account_id')::uuid and tenant_id = tid and type in ('income', 'expense')) then raise exception 'Budgets are for income and expense accounts'; end if;
    insert into acc_budgets (tenant_id, fy_id, account_id, month, amount) values (tid, p_fy, (r->>'account_id')::uuid, (r->>'month')::int, coalesce((r->>'amount')::numeric, 0))
    on conflict (tenant_id, fy_id, account_id, month) do update set amount = excluded.amount; n := n + 1;
  end loop;
  perform acc_audit_log(tid, 'budget', 'fy', p_fy::text, null, jsonb_build_object('rows', n));
  return jsonb_build_object('saved', n);
end $$;

create function acc_budget_report(p_fy uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; f acc_fy;
begin
  tid := acc_guard('acc_reports');
  select * into f from acc_fy where id = p_fy and tenant_id = tid;
  if f.id is null then raise exception 'Unknown financial year'; end if;
  return jsonb_build_object('fy', f.label, 'rows', coalesce((select jsonb_agg(to_jsonb(r) order by r.code) from (
    select a.id, a.code, a.name, a.type,
      (select coalesce(jsonb_object_agg(month::text, amount), '{}') from acc_budgets b where b.fy_id = p_fy and b.account_id = a.id) as budget,
      coalesce((select jsonb_object_agg(m, v) from (select extract(month from j.jdate)::int::text as m, sum(case when a.type = 'income' then jl.credit - jl.debit else jl.debit - jl.credit end) v
         from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id where jl.account_id = a.id and j.jdate between f.start_date and f.end_date group by 1) z), '{}') as actual
    from acc_accounts a where a.tenant_id = tid and a.type in ('income', 'expense') and (exists (select 1 from acc_budgets b where b.fy_id = p_fy and b.account_id = a.id)
      or exists (select 1 from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id where jl.account_id = a.id and j.jdate between f.start_date and f.end_date))) r), '[]'));
end $$;

-- ---------- attachments ----------
create function acc_add_attachment(p_entity text, p_id uuid, p_name text, p_url text, p_size int default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; aid uuid;
begin
  tid := acc_guard('acc_sales');
  if p_entity not in ('document', 'payment', 'asset', 'journal') then raise exception 'Cannot attach to %', p_entity; end if;
  if p_url !~ '^/uploads/' then raise exception 'Upload the file first'; end if;
  insert into acc_attachments (tenant_id, entity, entity_id, name, url, size_bytes, created_by) values (tid, p_entity, p_id, left(p_name, 200), p_url, p_size, app_uid()) returning id into aid;
  perform acc_audit_log(tid, 'attach', p_entity, p_id::text, null, jsonb_build_object('name', p_name));
  return jsonb_build_object('id', aid);
end $$;

-- ---------- e-invoice and e-way bill: payload + record layer (no provider is called from the database) ----------
create function acc_uqc(u text) returns text language sql immutable as $$
  select case upper(coalesce(u, '')) when 'NOS' then 'NOS' when 'KG' then 'KGS' when 'GM' then 'GMS' when 'LTR' then 'LTR' when 'ML' then 'MLT' when 'MTR' then 'MTR' when 'BOX' then 'BOX' when 'PACK' then 'PAC'
    when 'PAIR' then 'PRS' when 'SET' then 'SET' else 'OTH' end
$$;

create function acc_einvoice_payload(p_doc uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; d acc_documents; o acc_org; items jsonb; warn jsonb := '[]'; payload jsonb; seller_state text; party acc_parties;
begin
  tid := acc_guard('acc_sales');
  select * into d from acc_documents where id = p_doc and tenant_id = tid;
  if d.id is null then raise exception 'Document not found'; end if;
  if d.doc_type not in ('invoice', 'credit_note', 'debit_note') or d.status <> 'posted' then raise exception 'Only posted invoices and notes can have an e-invoice'; end if;
  select * into o from acc_org where tenant_id = tid;
  select * into party from acc_parties where id = d.party_id;
  if o.gstin is null then warn := warn || '"Your GSTIN is not set (Settings > Organisation)"'::jsonb; end if;
  if d.party_gstin is null then warn := warn || '"Customer has no GSTIN - e-invoice is for B2B supplies"'::jsonb; end if;
  if coalesce(party.billing_address, '') = '' then warn := warn || '"Buyer address is missing"'::jsonb; end if;
  warn := warn || '"Pincode and location are not stored - fill Pin and Loc before uploading"'::jsonb;
  select coalesce(jsonb_agg(jsonb_build_object('SlNo', l.line_no::text, 'PrdDesc', left(l.description, 300), 'IsServc', case when coalesce(pr.is_service, false) then 'Y' else 'N' end, 'HsnCd', coalesce(l.hsn, ''),
      'Qty', l.qty, 'Unit', acc_uqc(l.unit), 'UnitPrice', l.rate, 'TotAmt', round(l.qty * l.rate, 2), 'Discount', l.disc_amt, 'AssAmt', l.taxable, 'GstRt', l.tax_rate,
      'IgstAmt', l.igst, 'CgstAmt', l.cgst, 'SgstAmt', l.sgst, 'CesAmt', l.cess, 'TotItemVal', l.total) order by l.line_no), '[]') into items
    from acc_doc_lines l left join acc_products pr on pr.id = l.product_id where l.doc_id = d.id;
  payload := jsonb_build_object('Version', '1.1',
    'TranDtls', jsonb_build_object('TaxSch', 'GST', 'SupTyp', case when party.reg_type = 'sez' then 'SEZWOP' when party.reg_type = 'overseas' then 'EXPWOP' else 'B2B' end, 'RegRev', case when d.reverse_charge then 'Y' else 'N' end, 'IgstOnIntra', 'N'),
    'DocDtls', jsonb_build_object('Typ', case d.doc_type when 'invoice' then 'INV' when 'credit_note' then 'CRN' else 'DBN' end, 'No', d.number, 'Dt', to_char(d.doc_date, 'DD/MM/YYYY')),
    'SellerDtls', jsonb_build_object('Gstin', o.gstin, 'LglNm', o.legal_name, 'Addr1', left(coalesce(o.address, ''), 100), 'Loc', coalesce(o.city, ''), 'Pin', nullif(o.pincode, '')::int, 'Stcd', o.state_code),
    'BuyerDtls', jsonb_build_object('Gstin', d.party_gstin, 'LglNm', d.party_name, 'Pos', d.place_of_supply, 'Addr1', left(coalesce(d.billing_address, ''), 100), 'Loc', '', 'Pin', null, 'Stcd', coalesce(party.state_code, d.place_of_supply)),
    'ItemList', items,
    'ValDtls', jsonb_build_object('AssVal', d.taxable, 'CgstVal', d.cgst, 'SgstVal', d.sgst, 'IgstVal', d.igst, 'CesVal', d.cess, 'RndOffAmt', d.roundoff, 'TotInvVal', d.total));
  insert into acc_einvoice (tenant_id, doc_id, status, payload, error, idem_key) values (tid, d.id, 'payload_ready', payload, null, md5(d.id::text || d.total::text))
  on conflict (doc_id) do update set payload = excluded.payload, status = case when acc_einvoice.status = 'generated' then 'generated' else 'payload_ready' end, updated_at = now();
  return jsonb_build_object('payload', payload, 'warnings', warn);
end $$;

create function acc_einvoice_record(p_doc uuid, p_irn text, p_ack_no text, p_ack_date timestamptz, p_qr text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; e acc_einvoice;
begin
  tid := acc_guard('acc_sales');
  if coalesce(trim(p_irn), '') = '' or length(trim(p_irn)) <> 64 then raise exception 'An IRN is a 64-character hash'; end if;
  select * into e from acc_einvoice where doc_id = p_doc and tenant_id = tid for update;
  if e.id is not null and e.status = 'generated' then
    if e.irn = trim(p_irn) then return jsonb_build_object('ok', true, 'idempotent', true); end if;     -- same IRN again: no-op
    raise exception 'An IRN is already recorded for this invoice; cancel it first';
  end if;
  if not exists (select 1 from acc_documents where id = p_doc and tenant_id = tid and status = 'posted') then raise exception 'Document is not posted'; end if;
  insert into acc_einvoice (tenant_id, doc_id, status, irn, ack_no, ack_date, signed_qr) values (tid, p_doc, 'generated', trim(p_irn), p_ack_no, p_ack_date, p_qr)
  on conflict (doc_id) do update set status = 'generated', irn = trim(p_irn), ack_no = p_ack_no, ack_date = p_ack_date, signed_qr = p_qr, error = null, updated_at = now();
  perform acc_audit_log(tid, 'einvoice', 'document', p_doc::text, null, jsonb_build_object('irn', trim(p_irn)));
  return jsonb_build_object('ok', true);
end $$;

create function acc_einvoice_cancel(p_doc uuid, p_reason text) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := acc_guard('acc_cancel');
  if coalesce(trim(p_reason), '') = '' then raise exception 'A reason is required'; end if;
  update acc_einvoice set status = 'cancelled', updated_at = now(), error = p_reason where doc_id = p_doc and tenant_id = tid and status = 'generated';
  if not found then raise exception 'There is no generated IRN to cancel'; end if;
  perform acc_audit_log(tid, 'einvoice_cancel', 'document', p_doc::text, null, jsonb_build_object('reason', p_reason));
  return jsonb_build_object('ok', true);
end $$;

create function acc_eway_payload(p_doc uuid, p_transport jsonb default '{}') returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; d acc_documents; o acc_org; items jsonb; payload jsonb; party acc_parties; warn jsonb := '[]';
begin
  tid := acc_guard('acc_sales');
  select * into d from acc_documents where id = p_doc and tenant_id = tid;
  if d.id is null or d.status <> 'posted' or d.doc_type <> 'invoice' then raise exception 'Only a posted invoice can have an e-way bill'; end if;
  select * into o from acc_org where tenant_id = tid;
  select * into party from acc_parties where id = d.party_id;
  if coalesce(p_transport->>'vehicle_no', '') = '' and coalesce(p_transport->>'transporter_id', '') = '' then warn := warn || '"Add a vehicle number or transporter ID"'::jsonb; end if;
  select coalesce(jsonb_agg(jsonb_build_object('productName', left(l.description, 100), 'hsnCode', l.hsn, 'quantity', l.qty, 'qtyUnit', acc_uqc(l.unit), 'taxableAmount', l.taxable,
      'sgstRate', case when l.sgst > 0 then l.tax_rate / 2 else 0 end, 'cgstRate', case when l.cgst > 0 then l.tax_rate / 2 else 0 end, 'igstRate', case when l.igst > 0 then l.tax_rate else 0 end, 'cessRate', 0) order by l.line_no), '[]') into items
    from acc_doc_lines l where l.doc_id = d.id;
  payload := jsonb_build_object('supplyType', 'O', 'subSupplyType', '1', 'docType', 'INV', 'docNo', d.number, 'docDate', to_char(d.doc_date, 'DD/MM/YYYY'),
    'fromGstin', o.gstin, 'fromTrdName', o.legal_name, 'fromAddr1', left(coalesce(o.address, ''), 100), 'fromPlace', coalesce(o.city, ''), 'fromPincode', o.pincode, 'fromStateCode', o.state_code, 'actFromStateCode', o.state_code,
    'toGstin', coalesce(d.party_gstin, 'URP'), 'toTrdName', d.party_name, 'toAddr1', left(coalesce(d.shipping_address, d.billing_address, ''), 100), 'toStateCode', coalesce(party.state_code, d.place_of_supply), 'actToStateCode', coalesce(party.state_code, d.place_of_supply),
    'totalValue', d.taxable, 'cgstValue', d.cgst, 'sgstValue', d.sgst, 'igstValue', d.igst, 'cessValue', d.cess, 'totInvValue', d.total,
    'transMode', coalesce(p_transport->>'mode', '1'), 'transDistance', coalesce(p_transport->>'distance_km', '0'), 'transporterId', p_transport->>'transporter_id', 'vehicleNo', p_transport->>'vehicle_no', 'vehicleType', 'R', 'itemList', items);
  insert into acc_eway (tenant_id, doc_id, status, payload, vehicle_no, transport_mode, distance_km) values (tid, d.id, 'payload_ready', payload, p_transport->>'vehicle_no', coalesce(p_transport->>'mode', '1'), nullif(p_transport->>'distance_km', '')::int)
  on conflict (doc_id) do update set payload = excluded.payload, vehicle_no = excluded.vehicle_no, transport_mode = excluded.transport_mode, distance_km = excluded.distance_km, status = case when acc_eway.status = 'generated' then 'generated' else 'payload_ready' end, updated_at = now();
  return jsonb_build_object('payload', payload, 'warnings', warn, 'required', d.total >= coalesce(nullif(o.settings->>'eway_threshold', '')::numeric, 50000));
end $$;

create function acc_eway_record(p_doc uuid, p_ewb text, p_valid_upto timestamptz) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; e acc_eway;
begin
  tid := acc_guard('acc_sales');
  if p_ewb !~ '^\d{12}$' then raise exception 'An e-way bill number has 12 digits'; end if;
  select * into e from acc_eway where doc_id = p_doc and tenant_id = tid for update;
  if e.id is not null and e.status = 'generated' then
    if e.ewb_no = p_ewb then return jsonb_build_object('ok', true, 'idempotent', true); end if;
    raise exception 'An e-way bill is already recorded for this invoice';
  end if;
  insert into acc_eway (tenant_id, doc_id, status, ewb_no, valid_upto) values (tid, p_doc, 'generated', p_ewb, p_valid_upto)
  on conflict (doc_id) do update set status = 'generated', ewb_no = p_ewb, valid_upto = p_valid_upto, updated_at = now();
  perform acc_audit_log(tid, 'eway', 'document', p_doc::text, null, jsonb_build_object('ewb', p_ewb));
  return jsonb_build_object('ok', true);
end $$;

-- ---------- GSTR-2B reconciliation: portal rows against purchase bills ----------
create function acc_gst2b_import(p_period text, p_rows jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; r jsonb; d acc_documents; st text; matched int := 0; mism int := 0; miss int := 0; per_start date; per_end date; norm text; amt_t numeric; amt_tax numeric;
begin
  tid := acc_guard('acc_import');
  if p_period !~ '^\d{4}-\d{2}$' then raise exception 'Period must look like 2026-04'; end if;
  per_start := (p_period || '-01')::date; per_end := (per_start + interval '1 month - 1 day')::date;
  delete from acc_gst_recon where tenant_id = tid and period = p_period;
  for r in select * from jsonb_array_elements(p_rows) loop
    norm := regexp_replace(upper(coalesce(r->>'inv_no', '')), '[^A-Z0-9]', '', 'g');
    amt_t := coalesce(nullif(r->>'taxable', '')::numeric, 0); amt_tax := coalesce(nullif(r->>'tax', '')::numeric, 0);
    select * into d from acc_documents where tenant_id = tid and doc_type = 'bill' and status = 'posted' and regexp_replace(upper(coalesce(supplier_ref, '')), '[^A-Z0-9]', '', 'g') = norm
      and (party_id in (select id from acc_parties where tenant_id = tid and gstin = upper(trim(r->>'gstin'))) or coalesce(r->>'gstin', '') = '') limit 1;
    if d.id is null then st := 'missing_in_books'; miss := miss + 1;
    elsif abs(d.taxable - amt_t) <= 1 and abs((d.cgst + d.sgst + d.igst + d.cess) - amt_tax) <= 1 then st := 'matched'; matched := matched + 1;
    else st := 'mismatch'; mism := mism + 1; end if;
    insert into acc_gst_recon (tenant_id, period, supplier_gstin, supplier_name, inv_no, inv_date, taxable, tax, match_doc_id, status, note)
    values (tid, p_period, upper(trim(r->>'gstin')), r->>'name', r->>'inv_no', nullif(r->>'inv_date', '')::date, amt_t, amt_tax, d.id, st,
            case when st = 'mismatch' then 'Books: taxable ' || d.taxable || ', tax ' || (d.cgst + d.sgst + d.igst + d.cess) end);
  end loop;
  insert into acc_gst_recon (tenant_id, period, supplier_gstin, supplier_name, inv_no, inv_date, taxable, tax, match_doc_id, status, note)
    select tid, p_period, pa.gstin, d.party_name, d.supplier_ref, d.supplier_ref_date, d.taxable, d.cgst + d.sgst + d.igst + d.cess, d.id, 'missing_in_portal', 'In your books, not in GSTR-2B'
    from acc_documents d join acc_parties pa on pa.id = d.party_id
    where d.tenant_id = tid and d.doc_type = 'bill' and d.status = 'posted' and d.itc_eligible and d.cgst + d.sgst + d.igst > 0 and d.doc_date between per_start and per_end
      and not exists (select 1 from acc_gst_recon x where x.tenant_id = tid and x.period = p_period and x.match_doc_id = d.id);
  perform acc_audit_log(tid, 'gst2b', 'period', p_period, null, jsonb_build_object('matched', matched, 'mismatch', mism, 'missing_in_books', miss));
  return jsonb_build_object('matched', matched, 'mismatch', mism, 'missing_in_books', miss, 'missing_in_portal', (select count(*) from acc_gst_recon where tenant_id = tid and period = p_period and status = 'missing_in_portal'));
end $$;

create function acc_gst_recon_list(p_period text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := acc_guard('acc_reports');
  return jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(r) order by r.status, r.inv_date) from (
    select g.*, d.number as doc_number from acc_gst_recon g left join acc_documents d on d.id = g.match_doc_id where g.tenant_id = tid and g.period = p_period) r), '[]'),
    'filed', exists (select 1 from acc_gst_periods where tenant_id = tid and period = p_period));
end $$;

-- ---------- saved views ----------
create function acc_save_view(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; vid uuid;
begin
  tid := acc_guard('acc_view');
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Name the view'; end if;
  insert into acc_saved_views (tenant_id, user_id, scope, name, filters) values (tid, app_uid(), p->>'scope', trim(p->>'name'), coalesce(p->'filters', '{}')) returning id into vid;
  return jsonb_build_object('id', vid);
end $$;
create function acc_list_views(p_scope text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := acc_guard('acc_view');
  return jsonb_build_object('rows', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'filters', filters) order by name) from acc_saved_views where tenant_id = tid and scope = p_scope and (user_id = app_uid() or user_id is null)), '[]'));
end $$;
create function acc_delete_view(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := acc_guard('acc_view');
  delete from acc_saved_views where id = p_id and tenant_id = tid and user_id = app_uid();
  return jsonb_build_object('ok', true);
end $$;

revoke all on function acc_bank_automatch(uuid, uuid), acc_find_party(uuid, text, text, text, boolean) from public, app;
