-- Returns and exchanges list: every posted credit note (sales returns) or debit note (purchase returns), line by line,
-- with the invoice it was against, and whether the customer was billed again the same day (an exchange).
create or replace function acc_returns_list(p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; purchase boolean := coalesce(p->>'kind', 'sale') = 'purchase';
begin
  tid := acc_guard('acc_view');
  return jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(x) order by x.doc_date desc, x.number desc) from (
    select n.id, n.number, n.doc_date, n.party_id, coalesce(n.party_name, pa.name) as party_name, o.number as against, o.id as against_id,
           coalesce(pr.name, l.description) as item, l.qty, l.total as amount, n.total as note_total,
           (select e.number from acc_documents e where e.tenant_id = tid and e.party_id = n.party_id and e.status = 'posted'
               and e.doc_type = (case when purchase then 'bill' else 'invoice' end) and e.doc_date = n.doc_date and e.id is distinct from n.ref_doc_id order by e.number limit 1) as exchanged_for
      from acc_documents n join acc_doc_lines l on l.doc_id = n.id left join acc_products pr on pr.id = l.product_id
      left join acc_documents o on o.id = n.ref_doc_id left join acc_parties pa on pa.id = n.party_id
     where n.tenant_id = tid and n.status = 'posted' and n.doc_type = (case when purchase then 'debit_note' else 'credit_note' end)
       and (nullif(p->>'from', '') is null or n.doc_date >= (p->>'from')::date)
       and (nullif(p->>'to', '') is null or n.doc_date <= (p->>'to')::date)
     order by n.doc_date desc limit 1000) x), '[]'));
end $$;
