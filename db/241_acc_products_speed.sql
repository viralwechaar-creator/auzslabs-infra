-- AUZsLedger / AUZsScan: the product list was read in full on every call (the health report showed 33,000 full reads of a 22,000-row table).
-- 1) search indexes: partial-text search on name and code, and an exact barcode lookup, 2) stock is added up only for the rows
-- actually returned (it used to be added up for every stock movement of the business first). Same answer, same columns.
create extension if not exists pg_trgm;
create index if not exists acc_products_name_trgm on acc_products using gin (lower(name) gin_trgm_ops);
create index if not exists acc_products_sku_trgm on acc_products using gin (lower(sku) gin_trgm_ops);
create index if not exists acc_products_barcode on acc_products (tenant_id, barcode) where barcode is not null;
create index if not exists acc_products_active on acc_products (tenant_id, active, lower(name));

create or replace function acc_list_products(p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; sq text := nullif(trim(coalesce(p->>'search', '')), ''); cat text := nullif(p->>'category', ''); low boolean := coalesce((p->>'low_stock')::boolean, false);
  lim int := least(coalesce((p->>'limit')::int, 2000), 10000); inact boolean := coalesce((p->>'include_inactive')::boolean, false);
begin
  tid := acc_guard('acc_view');
  if low then
    -- low stock needs every product's stock first, so this keeps the original shape
    return jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(x) order by lower(x.name)) from (
      select pr.*, coalesce(s.q, 0) as stock, coalesce(s.v, 0) as stock_value,
        case when coalesce(s.q, 0) > 0 then round(s.v / s.q, 4) else pr.purchase_price end as avg_cost
      from acc_products pr
      left join (select product_id, sum(qty) q, sum(qty * unit_cost) v from acc_stock_moves where tenant_id = tid group by product_id) s on s.product_id = pr.id
      where pr.tenant_id = tid and (sq is null or pr.name ilike '%' || sq || '%' or pr.sku ilike '%' || sq || '%' or pr.barcode = sq or pr.hsn = sq)
        and (cat is null or pr.category = cat) and (inact or pr.active)
        and (pr.track_stock and not pr.is_service and coalesce(s.q, 0) <= pr.reorder_level and pr.reorder_level > 0)
      order by lower(pr.name) limit lim) x), '[]'));
  end if;
  return jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(x) order by lower(x.name)) from (
    select pr.*, coalesce(s.q, 0) as stock, coalesce(s.v, 0) as stock_value,
      case when coalesce(s.q, 0) > 0 then round(s.v / s.q, 4) else pr.purchase_price end as avg_cost
    from (select * from acc_products pr
          where pr.tenant_id = tid and (sq is null or pr.name ilike '%' || sq || '%' or pr.sku ilike '%' || sq || '%' or pr.barcode = sq or pr.hsn = sq)
            and (cat is null or pr.category = cat) and (inact or pr.active)
          order by lower(pr.name) limit lim) pr
    left join lateral (select sum(m.qty) q, sum(m.qty * m.unit_cost) v from acc_stock_moves m where m.tenant_id = tid and m.product_id = pr.id) s on true
    order by lower(pr.name)) x), '[]'));
end $$;
