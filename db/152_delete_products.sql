-- Bulk delete of products (AUZsScan / AUZsLedger Products page). Never loses history: a product that no document line, stock move or anything else
-- refers to is deleted for good; one that is already used is switched off (active = false) so it cannot be sold again but old bills stay intact.
create or replace function acc_delete_products(p_ids uuid[]) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; pid uuid; del int := 0; off int := 0; nm text;
begin
  tid := acc_guard('acc_inventory');
  if p_ids is null or coalesce(array_length(p_ids, 1), 0) = 0 then raise exception 'Choose at least one product'; end if;
  if array_length(p_ids, 1) > 5000 then raise exception 'Delete at most 5,000 products at a time'; end if;
  foreach pid in array p_ids loop
    select name into nm from acc_products where id = pid and tenant_id = tid;
    if nm is null then continue; end if;
    begin
      delete from acc_products where id = pid and tenant_id = tid;
      del := del + 1;
    exception when others then
      update acc_products set active = false, updated_at = now() where id = pid and tenant_id = tid;
      off := off + 1;
    end;
  end loop;
  perform acc_audit_log(tid, 'bulk_delete', 'products', null, null, jsonb_build_object('requested', array_length(p_ids, 1), 'deleted', del, 'deactivated', off));
  return jsonb_build_object('deleted', del, 'deactivated', off);
end $$;
