-- Stock page: list every stock-tracked product, including those with no stock yet (a freshly imported catalogue has quantity 0 everywhere,
-- so the old valuation, which only listed products with stock moves, looked empty). Also opens the stock screens to AUZsScan-only
-- businesses: the permission is acc_reports OR acc_inventory (acc_inventory is allowed for scan-only plans, acc_reports is not).
create or replace function acc_stock_summary(p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; asof date := coalesce(nullif(p->>'as_of', '')::date, current_date); wid uuid := nullif(p->>'warehouse_id', '')::uuid;
        incl boolean := coalesce((p->>'include_zero')::boolean, false);
begin
  tid := acc_guard('acc_view');
  if not (acc_perm('acc_reports') or acc_perm('acc_inventory')) then raise exception 'Your role does not allow this action (acc_reports)' using errcode = '42501'; end if;
  return jsonb_build_object('as_of', asof, 'rows', coalesce((select jsonb_agg(to_jsonb(r) order by lower(r.name)) from (
    select pr.id, pr.sku, pr.name, pr.category, pr.unit, pr.reorder_level, coalesce(s.qty, 0) as qty, coalesce(s.value, 0) as value,
           case when coalesce(s.qty, 0) > 0 then round(s.value / s.qty, 4) else pr.purchase_price end as avg_cost,
           case when pr.reorder_level > 0 and coalesce(s.qty, 0) <= pr.reorder_level then true else false end as low
    from acc_products pr
    left join (select product_id, sum(qty) as qty, sum(qty * unit_cost) as value from acc_stock_moves
               where tenant_id = tid and move_date <= asof and (wid is null or warehouse_id = wid) group by product_id) s on s.product_id = pr.id
    where pr.tenant_id = tid and (coalesce(s.qty, 0) <> 0 or (incl and pr.active and pr.track_stock and not pr.is_service))
    order by lower(pr.name) limit 5000) r), '[]'),
    'total_value', (select coalesce(sum(qty * unit_cost), 0) from acc_stock_moves where tenant_id = tid and move_date <= asof and (wid is null or warehouse_id = wid)),
    'in_stock', (select count(*) from (select product_id from acc_stock_moves where tenant_id = tid and move_date <= asof and (wid is null or warehouse_id = wid) group by product_id having sum(qty) <> 0) z));
end $$;
