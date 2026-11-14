-- AUZsStyle: line-by-line stock movement audit, the same shape as AuzsLedger's acc_stock_moves_list (db/325) --
-- every sty_stock_moves row with the running quantity before/after, and the real bill/purchase-invoice/transfer
-- number behind it. sty_stock_summary/sty_dashboard only ever give a current total; this answers "why did stock
-- change" and "which bill caused this" at the row level.
create or replace function sty_stock_moves_list(p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; vid uuid := nullif(p->>'variant_id', '')::uuid; bid uuid := nullif(p->>'branch_id', '')::uuid;
  dfrom date := nullif(p->>'from', '')::date; dto date := nullif(p->>'to', '')::date; v_kind text := nullif(p->>'kind', '');
begin
  tid := sty_guard('sty_reports');
  return jsonb_build_object('rows', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', y.id, 'variant_id', y.variant_id, 'style_name', y.style_name, 'colour', y.colour, 'size', y.size, 'sku', y.sku, 'barcode', y.barcode,
      'branch_id', y.branch_id, 'branch_name', y.branch_name, 'at', y.at,
      'qty_before', y.qty_before, 'qty_change', y.qty, 'qty_after', y.qty_after, 'dmg', y.dmg, 'unit_cost', y.unit_cost,
      'kind', y.kind, 'ref_type', y.ref_type, 'ref_id', y.ref_id, 'reference', y.reference,
      'note', y.note, 'staff_email', y.staff_email
    ) order by y.at desc, y.id desc)
    from (
      select x.* from (
        select sm.*, st.name as style_name, v.colour, v.size, v.sku, v.barcode, br.name as branch_name,
          coalesce(sl.number, pu.invoice_no, tr.number) as reference,
          pf.email as staff_email,
          sum(sm.qty) over (partition by sm.variant_id, sm.branch_id order by sm.at, sm.id) as qty_after,
          sum(sm.qty) over (partition by sm.variant_id, sm.branch_id order by sm.at, sm.id) - sm.qty as qty_before
        from sty_stock_moves sm
        join sty_variants v on v.id = sm.variant_id
        join sty_styles st on st.id = v.style_id
        join sty_branches br on br.id = sm.branch_id
        left join sty_sales sl on sm.ref_type = 'sale' and sl.id = sm.ref_id
        left join sty_purchases pu on sm.ref_type = 'purchase' and pu.id = sm.ref_id
        left join sty_transfers tr on sm.ref_type = 'transfer' and tr.id = sm.ref_id
        left join profiles pf on pf.id = sm.staff_id
        where sm.tenant_id = tid
      ) x
      where (vid is null or x.variant_id = vid) and (bid is null or x.branch_id = bid)
        and (dfrom is null or x.at >= dfrom) and (dto is null or x.at < dto + 1)
        and (v_kind is null or x.kind = v_kind)
      order by x.at desc, x.id desc
      limit 500
    ) y
  ), '[]'::jsonb));
end $$;
