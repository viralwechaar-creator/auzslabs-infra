-- A credit or debit note against an invoice or bill can return only what that document had, counting returns already posted.
-- Before this, a second return (or a bigger one) was accepted and put extra stock back.
create or replace function acc_return_cap_guard() returns trigger language plpgsql security definer set search_path = public as $$
declare ln record; orig numeric; done numeric;
begin
  if new.status = 'posted' and old.status is distinct from 'posted' and new.doc_type in ('credit_note', 'debit_note') and new.ref_doc_id is not null then
    for ln in select product_id, sum(qty) q from acc_doc_lines where doc_id = new.id and product_id is not null group by product_id loop
      select coalesce(sum(qty), 0) into orig from acc_doc_lines where doc_id = new.ref_doc_id and product_id = ln.product_id;
      if orig = 0 then continue; end if;
      select coalesce(sum(l.qty), 0) into done from acc_doc_lines l join acc_documents d on d.id = l.doc_id
        where d.ref_doc_id = new.ref_doc_id and d.id <> new.id and d.status = 'posted' and d.doc_type in ('credit_note', 'debit_note') and l.product_id = ln.product_id;
      if ln.q + done > orig then
        raise exception 'You are returning more than was sold: % of this item were on the invoice and % already returned', orig, done using errcode = 'AC006';
      end if;
    end loop;
  end if;
  return new;
end $$;
drop trigger if exists acc_return_cap on acc_documents;
create trigger acc_return_cap before update on acc_documents for each row execute function acc_return_cap_guard();
