-- db/291: (1) "Edit" for posted bills: cancel with a reversing entry and open a corrected draft copy in one step.
--         (2) Customer / supplier lists also show any party that has documents of that kind.
create or replace function acc_amend_document(p_doc_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tid uuid; d acc_documents; a record; lines jsonb; res jsonb; why text; perm text;
begin
  tid := acc_guard('acc_cancel');
  select * into d from acc_documents where id = p_doc_id and tenant_id = tid for update;
  if d.id is null then raise exception 'Document not found'; end if;
  if d.status <> 'posted' then raise exception '% is % and does not need amending: edit it directly', d.number, d.status; end if;
  if d.doc_type not in ('invoice','bill','expense','credit_note','debit_note') then raise exception 'This document type can be edited directly'; end if;
  perm := case when d.doc_type in ('invoice','credit_note') then 'acc_sales' else 'acc_purchase' end;
  perform acc_guard(perm);
  why := coalesce(nullif(trim(p_reason), ''), 'Edited: corrected copy created');
  -- release any payments / credits applied, they stay on the books as unallocated advances
  for a in select * from acc_allocations where (doc_id = d.id or credit_doc_id = d.id) and reversed_at is null for update loop
    update acc_documents set paid = paid - a.amount where id = a.doc_id;
    if a.payment_id is not null then update acc_payments set allocated = allocated - a.amount where id = a.payment_id;
    else update acc_documents set paid = paid - a.amount where id = a.credit_doc_id; end if;
    update acc_allocations set reversed_at = now() where id = a.id;
  end loop;
  select jsonb_agg(jsonb_build_object('product_id', product_id, 'account_id', account_id, 'description', description, 'hsn', hsn, 'qty', qty, 'unit', unit, 'rate', rate,
                                       'disc_pct', disc_pct, 'disc_amt', disc_amt, 'tax_rate', tax_rate, 'warehouse_id', warehouse_id) order by line_no)
    into lines from acc_doc_lines where doc_id = d.id;
  perform acc_cancel_document(d.id, why);   -- refuses when credit notes exist, an IRN is live or the GST period is filed
  res := acc_save_document(jsonb_build_object('doc_type', d.doc_type, 'doc_date', d.doc_date, 'due_date', d.due_date, 'party_id', d.party_id, 'branch_id', d.branch_id, 'warehouse_id', d.warehouse_id,
    'place_of_supply', d.place_of_supply, 'reverse_charge', d.reverse_charge, 'itc_eligible', d.itc_eligible, 'price_includes_tax', d.price_includes_tax,
    'notes', d.notes, 'terms', d.terms, 'payment_terms', d.payment_terms, 'billing_address', d.billing_address, 'shipping_address', d.shipping_address,
    'supplier_ref', d.supplier_ref, 'supplier_ref_date', d.supplier_ref_date, 'ref_doc_id', d.ref_doc_id, 'lines', lines));
  update acc_documents set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('amended_from', d.number) where id = (res->>'id')::uuid;
  perform acc_audit_log(tid, 'amend', d.doc_type, d.id::text, jsonb_build_object('number', d.number), jsonb_build_object('new_draft', res->>'id'), why);
  return jsonb_build_object('id', res->>'id', 'old_number', d.number, 'doc_type', d.doc_type);
end $$;

create or replace function acc_list_parties(p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; k text := nullif(p->>'kind', ''); q text := nullif(trim(coalesce(p->>'search', '')), ''); pt text := nullif(p->>'party_type', '');
  buy text[] := array['bill','debit_note','expense','purchase_request','purchase_order','goods_receipt'];
  sell text[] := array['invoice','credit_note','quotation','sales_order','delivery_challan'];
begin
  tid := acc_guard('acc_view');
  return jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(x) order by lower(x.name)) from (
    select pa.id, pa.kind, pa.party_type, pa.category, pa.bank_name, pa.bank_account, pa.bank_ifsc, pa.upi_id, pa.code, pa.name, pa.gstin, pa.state_code, pa.phone, pa.email, pa.credit_limit, pa.credit_days, pa.reg_type, pa.is_walkin, pa.active, pa.billing_address, pa.shipping_address, pa.contact_name, pa.pan, pa.tags, pa.notes,
      coalesce(b.bal, 0) as balance,
      coalesce((select sum(d.total - d.paid) from acc_documents d where d.party_id = pa.id and d.status = 'posted' and d.doc_type in ('invoice', 'bill', 'expense') and d.total > d.paid and d.due_date < current_date), 0) as overdue
    from acc_parties pa
    left join (select jl.party_id, sum(jl.debit - jl.credit) bal from acc_journal_lines jl join acc_accounts a on a.id = jl.account_id
               where jl.tenant_id = tid and a.system_key in ('ar', 'ap') group by jl.party_id) b on b.party_id = pa.id
    where pa.tenant_id = tid
      and (k is null or pa.kind = k or (k <> 'both' and pa.kind = 'both')
           or (k in ('customer','supplier') and exists (select 1 from acc_documents d where d.party_id = pa.id and d.tenant_id = tid and d.status <> 'cancelled'
               and d.doc_type = any(case when k = 'supplier' then buy else sell end))))
      and (pt is null or pa.party_type = pt)
      and (pt is not null or k is null or pa.party_type is null or pa.party_type in ('customer', 'supplier'))
      and (q is null or pa.name ilike '%' || q || '%' or pa.gstin ilike '%' || q || '%' or pa.phone ilike '%' || q || '%' or pa.code ilike '%' || q || '%')
      and (coalesce((p->>'include_inactive')::boolean, false) or pa.active)
    order by lower(pa.name) limit least(coalesce((p->>'limit')::int, 1000), 5000)) x), '[]'));
end $$;
