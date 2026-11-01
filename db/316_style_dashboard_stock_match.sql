-- The Overview stock figures now match the Stock page: active styles and variants only, and an oversold (negative) variant counts as 0 units, not minus.
create or replace function sty_dashboard(p jsonb default '{}'::jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; d1 date; d2 date; b uuid; span int; pd1 date; pd2 date; see boolean; cur jsonb; prev jsonb; inv jsonb; res jsonb;
begin
  tid := sty_guard('sty_reports');
  d1 := coalesce(nullif(p->>'from', '')::date, sty_today()); d2 := coalesce(nullif(p->>'to', '')::date, d1); b := nullif(p->>'branchId', '')::uuid;
  span := d2 - d1 + 1; pd2 := d1 - 1; pd1 := d1 - span;
  select jsonb_build_object('bills', count(distinct sale_id), 'units', coalesce(sum(kept), 0), 'revenue', coalesce(sum(revenue), 0), 'profit', coalesce(sum(profit), 0))
    into cur from sty_sold_lines(tid, d1, d2, b);
  select jsonb_build_object('bills', count(distinct sale_id), 'units', coalesce(sum(kept), 0), 'revenue', coalesce(sum(revenue), 0), 'profit', coalesce(sum(profit), 0))
    into prev from sty_sold_lines(tid, pd1, pd2, b);
  select jsonb_build_object(
    'units', coalesce(sum(greatest(m.q, 0)), 0), 'costValue', coalesce(sum(greatest(m.q, 0) * v.cost), 0), 'retailValue', coalesce(sum(greatest(m.q, 0) * coalesce(v.price, s.price)), 0),
    'low', count(*) filter (where m.q <= v.reorder_at and v.active), 'out', count(*) filter (where m.q <= 0 and v.active))
    into inv from sty_variants v join sty_styles s on s.id = v.style_id
    left join lateral (select coalesce(sum(qty), 0)::int q from sty_stock_moves where variant_id = v.id and (b is null or branch_id = b)) m on true
    where v.tenant_id = tid and s.active and v.active;
  res := jsonb_build_object(
    'from', d1, 'to', d2, 'current', cur, 'previous', prev, 'inventory', inv,
    'discount', coalesce((select sum(discount) from sty_sales where tenant_id = tid and status <> 'void' and (b is null or branch_id = b) and (at at time zone 'Asia/Kolkata')::date between d1 and d2), 0),
    'returns', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(refund), 0)) from sty_returns where tenant_id = tid and (b is null or branch_id = b) and (at at time zone 'Asia/Kolkata')::date between d1 and d2),
    'byPayment', coalesce((select jsonb_agg(jsonb_build_object('mode', mode, 'amount', amt) order by amt desc) from (
        select e->>'mode' as mode, sum((e->>'amount')::numeric) as amt from sty_sales s, jsonb_array_elements(s.payments) e
        where s.tenant_id = tid and s.status <> 'void' and (b is null or s.branch_id = b) and (s.at at time zone 'Asia/Kolkata')::date between d1 and d2 group by 1) x), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('day', day, 'revenue', r, 'units', u) order by day) from (
        select day, sum(revenue) r, sum(kept) u from sty_sold_lines(tid, d1, d2, b) group by day) x), '[]'::jsonb),
    'byHour', coalesce((select jsonb_agg(jsonb_build_object('hour', hour, 'revenue', r, 'bills', n) order by hour) from (
        select hour, sum(revenue) r, count(distinct sale_id) n from sty_sold_lines(tid, d1, d2, b) group by hour) x), '[]'::jsonb),
    'topStyles', coalesce((select jsonb_agg(jsonb_build_object('name', n, 'category', c, 'units', u, 'revenue', r) order by u desc, r desc) from (
        select style_name n, max(category) c, sum(kept) u, sum(revenue) r from sty_sold_lines(tid, d1, d2, b) group by style_id, style_name order by sum(kept) desc, sum(revenue) desc limit 5) x), '[]'::jsonb),
    'receivable', coalesce((select sum(total - paid) from sty_sales where tenant_id = tid and status = 'due'), 0),
    'payable', coalesce((select sum(total) from sty_purchases where tenant_id = tid), 0) - coalesce((select sum(amount) from sty_supplier_payments where tenant_id = tid), 0));
  return res;
end $$;

