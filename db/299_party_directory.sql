-- AUZsLedger "Parties" tab: every customer and supplier (with or without a GST number) and what is owed, for a chosen financial year.
-- Balance = receivable/payable control-account lines per party, so it matches the books and the party page.
-- opening = balance before the period starts (carried forward automatically: the ledger is continuous), period debit/credit,
-- closing = balance at the end of the period. Positive = they owe you; negative = you owe them.
create or replace function acc_parties_directory(p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; d_from date := nullif(p->>'from', '')::date; d_to date := nullif(p->>'to', '')::date;
  k text := nullif(p->>'kind', ''); q text := nullif(trim(coalesce(p->>'search', '')), ''); gst boolean := coalesce((p->>'gst_only')::boolean, false);
begin
  tid := acc_guard('acc_view');
  return jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(x) order by lower(x.name)) from (
    select pa.id, pa.kind, pa.party_type, pa.code, pa.name, pa.gstin, pa.state_code, pa.pan, pa.reg_type, pa.phone, pa.email, pa.billing_address, pa.credit_days, pa.credit_limit, pa.active,
      coalesce(b.opening, 0) as opening, coalesce(b.dr, 0) as debit, coalesce(b.cr, 0) as credit, coalesce(b.closing, 0) as closing,
      (select count(*) from acc_documents d where d.party_id = pa.id and d.status = 'posted' and d.doc_type in ('invoice', 'bill')
         and (d_from is null or d.doc_date >= d_from) and (d_to is null or d.doc_date <= d_to)) as documents
    from acc_parties pa
    left join (select jl.party_id,
        sum(case when d_from is not null and j.jdate < d_from then jl.debit - jl.credit else 0 end) as opening,
        sum(case when (d_from is null or j.jdate >= d_from) and (d_to is null or j.jdate <= d_to) then jl.debit else 0 end) as dr,
        sum(case when (d_from is null or j.jdate >= d_from) and (d_to is null or j.jdate <= d_to) then jl.credit else 0 end) as cr,
        sum(case when d_to is null or j.jdate <= d_to then jl.debit - jl.credit else 0 end) as closing
      from acc_journal_lines jl join acc_journals j on j.id = jl.journal_id join acc_accounts a on a.id = jl.account_id
      where jl.tenant_id = tid and a.system_key in ('ar', 'ap') and jl.party_id is not null group by jl.party_id) b on b.party_id = pa.id
    where pa.tenant_id = tid and not coalesce(pa.is_walkin, false)
      and (k is null or pa.kind = k or pa.kind = 'both')
      and (not gst or coalesce(pa.gstin, '') <> '')
      and (q is null or pa.name ilike '%' || q || '%' or pa.gstin ilike '%' || q || '%' or pa.phone ilike '%' || q || '%')
      and (coalesce((p->>'include_zero')::boolean, true) or coalesce(b.closing, 0) <> 0 or coalesce(b.dr, 0) <> 0 or coalesce(b.cr, 0) <> 0)
    order by lower(pa.name) limit least(coalesce((p->>'limit')::int, 2000), 5000)) x), '[]'));
end $$;
