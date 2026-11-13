-- Line-by-line stock movement audit: every acc_stock_moves row, with the product/warehouse names, the running
-- quantity before/after that row, and (when the move came from a document) that document's real number -- so
-- "why did stock change" and "which bill caused this" can be answered from one call instead of cross-referencing
-- acc_stock_summary/acc_product_stock (both aggregates) against the raw table by hand.
create or replace function acc_stock_moves_list(p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; pid uuid := nullif(p->>'product_id', '')::uuid; wid uuid := nullif(p->>'warehouse_id', '')::uuid;
  dfrom date := nullif(p->>'from', '')::date; dto date := nullif(p->>'to', '')::date; v_kind text := nullif(p->>'kind', '');
begin
  tid := acc_guard('acc_reports');
  return jsonb_build_object('rows', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', y.id, 'product_id', y.product_id, 'product_name', y.pname, 'sku', y.sku,
      'warehouse_id', y.warehouse_id, 'warehouse_name', y.wname, 'move_date', y.move_date,
      'qty_before', y.qty_before, 'qty_change', y.qty, 'qty_after', y.qty_after, 'unit_cost', y.unit_cost,
      'kind', y.kind, 'source_type', y.source_type, 'source_id', y.source_id, 'source_document', y.doc_number,
      'batch_no', y.batch_no, 'serial_no', y.serial_no, 'note', y.note, 'created_by_email', y.created_by_email, 'created_at', y.created_at
    ) order by y.move_date desc, y.id desc)
    from (
      select x.* from (
        select sm.*, pr.name as pname, pr.sku, w.name as wname, d.number as doc_number, pf.email as created_by_email,
          sum(sm.qty) over (partition by sm.product_id, sm.warehouse_id order by sm.move_date, sm.id) as qty_after,
          sum(sm.qty) over (partition by sm.product_id, sm.warehouse_id order by sm.move_date, sm.id) - sm.qty as qty_before
        from acc_stock_moves sm
        join acc_products pr on pr.id = sm.product_id
        join acc_warehouses w on w.id = sm.warehouse_id
        left join acc_documents d on sm.source_type = 'document' and d.id = sm.source_id
        left join profiles pf on pf.id = sm.created_by
        where sm.tenant_id = tid
      ) x
      where (pid is null or x.product_id = pid) and (wid is null or x.warehouse_id = wid)
        and (dfrom is null or x.move_date >= dfrom) and (dto is null or x.move_date <= dto)
        and (v_kind is null or x.kind = v_kind)
      order by x.move_date desc, x.id desc
      limit 500
    ) y
  ), '[]'::jsonb));
end $$;
