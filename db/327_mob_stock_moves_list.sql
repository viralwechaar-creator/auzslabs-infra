-- AUZsMob: line-by-line stock movement audit, same shape as AuzsLedger's/AUZsStyle's (db/325, db/326). Every
-- mob_stock_movements row (non-serialized items; a serialized phone's own history is on mob_item_units/mob_sales
-- directly) with the running qty before/after, and the real bill number / vendor / repair job behind it.
create or replace function mob_stock_moves_list(p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; iid uuid := nullif(p->>'item_id', '')::uuid; dfrom date := nullif(p->>'from', '')::date; dto date := nullif(p->>'to', '')::date;
  v_type text := nullif(p->>'type', '');
begin
  tid := mob_guard('mob_reports');
  return jsonb_build_object('rows', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', y.id, 'item_id', y.item_id, 'item_name', y.item_name, 'unit_id', y.unit_id,
      'qty_before', y.qty_before, 'qty_change', y.qty, 'qty_after', y.qty_after,
      'type', y.type, 'ref_id', y.ref_id, 'reference', y.reference,
      'staff_email', y.staff_email, 'created_at', y.created_at
    ) order by y.created_at desc, y.id desc)
    from (
      select x.* from (
        select sm.*, it.name as item_name,
          coalesce(sl.bill_no, rp.device_model, ve.name) as reference,
          pf.email as staff_email,
          sum(sm.qty) over (partition by sm.item_id order by sm.created_at, sm.id) as qty_after,
          sum(sm.qty) over (partition by sm.item_id order by sm.created_at, sm.id) - sm.qty as qty_before
        from mob_stock_movements sm
        left join mob_items it on it.id = sm.item_id
        left join mob_sales sl on sm.type in ('sale', 'void_sale') and sl.id = sm.ref_id
        left join mob_repair_events re on sm.type = 'repair_part' and re.id = sm.ref_id
        left join mob_repairs rp on rp.id = re.repair_id
        left join mob_purchases pu on sm.type in ('purchase', 'secondhand_intake') and pu.id = sm.ref_id
        left join mob_vendors ve on ve.id = pu.vendor_id
        left join profiles pf on pf.id = sm.staff_id
        where sm.tenant_id = tid
      ) x
      where (iid is null or x.item_id = iid) and (dfrom is null or x.created_at::date >= dfrom) and (dto is null or x.created_at::date <= dto)
        and (v_type is null or x.type = v_type)
      order by x.created_at desc, x.id desc
      limit 500
    ) y
  ), '[]'::jsonb));
end $$;
