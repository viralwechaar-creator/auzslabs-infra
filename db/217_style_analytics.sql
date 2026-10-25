-- =========================================================
-- AUZsStyle analytics. Built around VARIANTS (style x colour x size): what sells, in which size and colour, how fast,
-- what to reorder, what is stuck. Dates are shop-local (Asia/Kolkata). Revenue/profit exclude cancelled bills and
-- the part of a line that came back as a return.
-- =========================================================

create or replace function sty_sold_lines(tid uuid, d1 date, d2 date, b uuid default null)
returns table (sale_id uuid, at timestamptz, day date, hour int, dow int, staff_id uuid, customer_id uuid, variant_id uuid, style_id uuid, style_name text,
               category text, brand text, colour text, size text, barcode text, qty int, kept int, revenue numeric, ex_tax numeric, cost numeric, profit numeric)
language sql stable security definer set search_path = public as $$
  select s.id, s.at, (s.at at time zone 'Asia/Kolkata')::date, extract(hour from s.at at time zone 'Asia/Kolkata')::int, extract(dow from s.at at time zone 'Asia/Kolkata')::int,
    s.staff_id, s.customer_id, l.variant_id, l.style_id, l.style_name, l.category, l.brand, l.colour, l.size, l.barcode, l.qty, l.qty - l.returned,
    round(l.net * (l.qty - l.returned) / l.qty, 2),
    round((l.net - l.tax) * (l.qty - l.returned) / l.qty, 2),
    round(l.cost * (l.qty - l.returned), 2),
    round((l.net - l.tax) * (l.qty - l.returned) / l.qty - l.cost * (l.qty - l.returned), 2)
  from sty_sales s join sty_sale_lines l on l.sale_id = s.id
  where s.tenant_id = tid and s.status <> 'void' and (b is null or s.branch_id = b)
    and (s.at at time zone 'Asia/Kolkata')::date between d1 and d2
$$;

create or replace function sty_today() returns date language sql stable as $$ select (now() at time zone 'Asia/Kolkata')::date $$;

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
    'units', coalesce(sum(m.q), 0), 'costValue', coalesce(sum(m.q * v.cost), 0), 'retailValue', coalesce(sum(m.q * coalesce(v.price, s.price)), 0),
    'low', count(*) filter (where m.q <= v.reorder_at and v.active), 'out', count(*) filter (where m.q <= 0 and v.active))
    into inv from sty_variants v join sty_styles s on s.id = v.style_id
    left join lateral (select coalesce(sum(qty), 0)::int q from sty_stock_moves where variant_id = v.id and (b is null or branch_id = b)) m on true
    where v.tenant_id = tid and s.active;
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

-- The variant-centred analytics page. p: {from, to, branchId}
create or replace function sty_analytics(p jsonb default '{}'::jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; d1 date; d2 date; b uuid; days int; res jsonb;
begin
  tid := sty_guard('sty_reports');
  d1 := coalesce(nullif(p->>'from', '')::date, sty_today() - 29); d2 := coalesce(nullif(p->>'to', '')::date, sty_today()); b := nullif(p->>'branchId', '')::uuid;
  days := greatest(d2 - d1 + 1, 1);
  return jsonb_build_object(
    'from', d1, 'to', d2, 'days', days,
    'byCategory', coalesce((select jsonb_agg(row_to_json(x) order by x.units desc) from (
        select s.category, sum(s.kept)::int units, sum(s.revenue) revenue, sum(s.profit) profit,
          coalesce((select sum(m.qty) from sty_stock_moves m join sty_variants v on v.id = m.variant_id join sty_styles st on st.id = v.style_id
                    where m.tenant_id = tid and st.category = s.category and (b is null or m.branch_id = b)), 0)::int stock
        from sty_sold_lines(tid, d1, d2, b) s group by s.category) x), '[]'::jsonb),
    'byStyle', coalesce((select jsonb_agg(row_to_json(x) order by x.units desc, x.revenue desc) from (
        select s.style_id id, s.style_name as name, max(s.category) category, sum(s.kept)::int units, sum(s.revenue) revenue, sum(s.profit) profit,
          round(sum(s.kept)::numeric / days, 2) per_day,
          (select size from sty_sold_lines(tid, d1, d2, b) q where q.style_id = s.style_id group by size order by sum(kept) desc limit 1) best_size,
          (select colour from sty_sold_lines(tid, d1, d2, b) q where q.style_id = s.style_id and colour <> '' group by colour order by sum(kept) desc limit 1) best_colour,
          coalesce((select sum(m.qty) from sty_stock_moves m join sty_variants v on v.id = m.variant_id where m.tenant_id = tid and v.style_id = s.style_id and (b is null or m.branch_id = b)), 0)::int stock
        from sty_sold_lines(tid, d1, d2, b) s group by s.style_id, s.style_name order by sum(s.kept) desc, sum(s.revenue) desc limit 40) x), '[]'::jsonb),
    'bySize', coalesce((select jsonb_agg(row_to_json(x) order by x.units desc) from (
        select size, sum(kept)::int units, sum(revenue) revenue from sty_sold_lines(tid, d1, d2, b) where size <> '' group by size) x), '[]'::jsonb),
    'byColour', coalesce((select jsonb_agg(row_to_json(x) order by x.units desc) from (
        select colour, sum(kept)::int units, sum(revenue) revenue from sty_sold_lines(tid, d1, d2, b) where colour <> '' group by colour) x), '[]'::jsonb),
    'catSize', coalesce((select jsonb_agg(row_to_json(x)) from (
        select category, size, sum(kept)::int units from sty_sold_lines(tid, d1, d2, b) where size <> '' group by category, size) x), '[]'::jsonb),
    'byWeekday', coalesce((select jsonb_agg(row_to_json(x) order by x.dow) from (
        select dow, sum(revenue) revenue, sum(kept)::int units from sty_sold_lines(tid, d1, d2, b) group by dow) x), '[]'::jsonb),
    'byHour', coalesce((select jsonb_agg(row_to_json(x) order by x.hour) from (
        select hour, sum(revenue) revenue, sum(kept)::int units from sty_sold_lines(tid, d1, d2, b) group by hour) x), '[]'::jsonb),
    'variants', coalesce((select jsonb_agg(row_to_json(x) order by x.units desc, x.revenue desc) from (
        select s.variant_id id, s.style_name as name, s.category, s.colour, s.size, s.barcode, sum(s.kept)::int units, sum(s.revenue) revenue, sum(s.profit) profit,
          st.stock, st.received,
          case when st.received > 0 then round(sum(s.kept)::numeric * 100 / st.received, 1) end sell_through,
          round(sum(s.kept)::numeric / days, 2) per_day,
          case when sum(s.kept) > 0 and st.stock > 0 then round(st.stock / (sum(s.kept)::numeric / days), 0) end cover_days,
          st.first_in, min(s.day) first_sale,
          case when st.first_in is not null then min(s.day) - st.first_in end days_to_first_sale,
          case when st.stock <= 0 and st.received > 0 then max(s.day) - st.first_in end days_to_sell_out
        from sty_sold_lines(tid, d1, d2, b) s
        join lateral (select coalesce(sum(m.qty), 0)::int stock, coalesce(sum(m.qty) filter (where m.kind in ('opening', 'purchase', 'transfer_in')), 0)::int received,
                             (min(m.at) filter (where m.kind in ('opening', 'purchase')) at time zone 'Asia/Kolkata')::date first_in
                      from sty_stock_moves m where m.variant_id = s.variant_id and (b is null or m.branch_id = b)) st on true
        group by s.variant_id, s.style_name, s.category, s.colour, s.size, s.barcode, st.stock, st.received, st.first_in
        order by sum(s.kept) desc, sum(s.revenue) desc limit 60) x), '[]'::jsonb),
    'returnsBySize', coalesce((select jsonb_agg(row_to_json(x) order by x.rate desc nulls last) from (
        select size, sum(qty)::int sold, sum(qty - kept)::int returned, round(sum(qty - kept)::numeric * 100 / nullif(sum(qty), 0), 1) rate
        from sty_sold_lines(tid, d1, d2, b) where size <> '' group by size) x), '[]'::jsonb),
    'staff', coalesce((select jsonb_agg(row_to_json(x) order by x.revenue desc) from (
        select s.staff_id id, coalesce(nullif(pr.name, ''), pr.email, 'Staff') as name, count(distinct s.sale_id)::int bills, sum(s.kept)::int units, sum(s.revenue) revenue, sum(s.profit) profit,
          round(sum(s.revenue) / nullif(count(distinct s.sale_id), 0), 0) avg_bill,
          coalesce(t.target, 0) target, coalesce(t.commission_pct, 0) commission_pct,
          round(sum(s.revenue) * coalesce(t.commission_pct, 0) / 100, 2) commission
        from sty_sold_lines(tid, d1, d2, b) s left join profiles pr on pr.id = s.staff_id
        left join sty_targets t on t.tenant_id = tid and t.user_id = s.staff_id and t.month = date_trunc('month', d2)::date
        group by s.staff_id, pr.name, pr.email, t.target, t.commission_pct) x), '[]'::jsonb),
    'customers', coalesce((select jsonb_agg(row_to_json(x) order by x.spent desc) from (
        select c.id, c.name, c.phone, count(distinct s.sale_id)::int visits, sum(s.revenue) spent
        from sty_sold_lines(tid, d1, d2, b) s join sty_customers c on c.id = s.customer_id group by c.id, c.name, c.phone order by sum(s.revenue) desc limit 15) x), '[]'::jsonb));
end $$;

-- What to do next: reorder, slow stock, size-curve gaps, stock-outs that are costing sales.
create or replace function sty_insights(p jsonb default '{}'::jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; b uuid; st sty_settings; today date;
begin
  tid := sty_guard('sty_reports');
  b := nullif(p->>'branchId', '')::uuid; today := sty_today();
  select * into st from sty_settings where tenant_id = tid;
  return (
  with sold30 as (select variant_id, sum(kept)::numeric u from sty_sold_lines(tid, today - 29, today, b) group by variant_id),
       lastsale as (select variant_id, max(day) d from sty_sold_lines(tid, today - 400, today, b) group by variant_id),
       v as (
         select v.id, s.name, s.category, v.colour, v.size, v.barcode, v.reorder_at, v.cost, coalesce(v.price, s.price) price, v.active, s.active s_active,
           coalesce(sum(m.qty), 0)::int stock, (min(m.at) filter (where m.kind in ('opening', 'purchase')) at time zone 'Asia/Kolkata')::date first_in,
           coalesce(sold30.u, 0) u30, lastsale.d last_sale
         from sty_variants v join sty_styles s on s.id = v.style_id
         left join sty_stock_moves m on m.variant_id = v.id and (b is null or m.branch_id = b)
         left join sold30 on sold30.variant_id = v.id left join lastsale on lastsale.variant_id = v.id
         where v.tenant_id = tid group by v.id, s.name, s.category, s.id, sold30.u, lastsale.d)
  select jsonb_build_object(
    'reorder', coalesce((select jsonb_agg(row_to_json(x) order by x.urgency) from (
        select id, name, category, colour, size, barcode, stock, round(u30 / 30, 2) per_day,
          case when u30 > 0 then round(stock / (u30 / 30), 0) end cover_days,
          greatest(ceil(u30 / 30 * st.cover_days)::int - stock, case when stock <= reorder_at then reorder_at * 2 - stock else 0 end, 1) suggest,
          case when stock <= 0 then 0 else 1 end urgency
        from v where active and s_active and (stock <= reorder_at or (u30 > 0 and stock / (u30 / 30) < st.lead_days)) and (u30 > 0 or stock <= reorder_at) order by urgency, u30 desc limit 60) x), '[]'::jsonb),
    'stockOutSelling', coalesce((select jsonb_agg(row_to_json(x) order by x.per_day desc) from (
        select id, name, category, colour, size, round(u30 / 30, 2) per_day, last_sale from v where active and s_active and stock <= 0 and u30 > 0 limit 30) x), '[]'::jsonb),
    'slow', coalesce((select jsonb_agg(row_to_json(x) order by x.value desc) from (
        select id, name, category, colour, size, stock, round(stock * cost, 0) as value, today - coalesce(last_sale, first_in, today) days_idle
        from v where active and s_active and stock > 0 and today - coalesce(last_sale, first_in, today) >= st.slow_days order by stock * cost desc limit 40) x), '[]'::jsonb),
    'overstock', coalesce((select jsonb_agg(row_to_json(x) order by x.cover_days desc) from (
        select id, name, category, colour, size, stock, round(stock / (u30 / 30), 0) cover_days from v where active and s_active and u30 > 0 and stock / (u30 / 30) > 120 limit 20) x), '[]'::jsonb),
    'sizeCurve', coalesce((select jsonb_agg(row_to_json(x) order by x.category, x.sold_pct desc) from (
        select c.category, c.size, round(c.u * 100 / nullif(sum(c.u) over (partition by c.category), 0), 1) sold_pct,
               round(coalesce(k.q, 0) * 100.0 / nullif(sum(coalesce(k.q, 0)) over (partition by c.category), 0), 1) stock_pct
        from (select category, size, sum(kept)::numeric u from sty_sold_lines(tid, today - 89, today, b) where size <> '' group by category, size) c
        left join (select category, size, sum(stock)::numeric q from v where size <> '' and stock > 0 group by category, size) k on k.category = c.category and k.size = c.size) x), '[]'::jsonb)
  ));
end $$;

-- every number the app shows should tie to the ledger of moves / bills
create or replace function sty_integrity_check() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; bad jsonb := '[]'::jsonb; n int;
begin
  tid := sty_guard('sty_manage');
  select count(*) into n from sty_sales s where s.tenant_id = tid and abs(s.total - (select coalesce(sum(net), 0) from sty_sale_lines where sale_id = s.id) - s.rounding) > 0.05;
  if n > 0 then bad := bad || jsonb_build_object('check', 'bill totals equal their lines', 'count', n); end if;
  select count(*) into n from sty_sale_lines l join sty_sales s on s.id = l.sale_id where s.tenant_id = tid and s.status <> 'void'
    and (select coalesce(-sum(qty), 0) from sty_stock_moves m where m.ref_id = s.id and m.variant_id = l.variant_id and m.kind in ('sale', 'void')) <> l.qty;
  if n > 0 then bad := bad || jsonb_build_object('check', 'every bill line has its stock move', 'count', n); end if;
  select count(*) into n from sty_variants v where v.tenant_id = tid and not (select allow_negative_stock from sty_settings where tenant_id = tid)
    and exists (select 1 from sty_stock_moves m where m.variant_id = v.id group by m.branch_id having sum(m.qty) < 0);
  if n > 0 then bad := bad || jsonb_build_object('check', 'no negative stock', 'count', n); end if;
  select count(*) into n from sty_sale_lines l join sty_sales s on s.id = l.sale_id where s.tenant_id = tid and l.returned > l.qty;
  if n > 0 then bad := bad || jsonb_build_object('check', 'returns not above quantity sold', 'count', n); end if;
  return jsonb_build_object('ok', jsonb_array_length(bad) = 0, 'problems', bad);
end $$;

-- a small starter catalogue for a demo / first look (manager). Idempotent per style name.
create or replace function sty_load_sample() returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; b uuid; r record; sid uuid;
begin
  tid := sty_guard('sty_manage');
  b := sty_main_branch(tid);
  for r in select * from (values
    ('Blue Slim Shirt', 'Shirts', 'Cotton', 'Men', 899::numeric, 1299::numeric, 420::numeric, '["Blue","White"]', '["S","M","L","XL"]'),
    ('Black Skinny Jeans', 'Jeans', 'Denim', 'Men', 1299, 1999, 640, '["Black","Indigo"]', '["30","32","34","36"]'),
    ('Floral Summer Dress', 'Dresses', 'Rayon', 'Women', 1199, 1799, 520, '["Pink","Yellow"]', '["S","M","L"]'),
    ('Classic Polo Tee', 'T-shirts', 'Cotton', 'Men', 599, 899, 260, '["Navy","Grey","Red"]', '["S","M","L","XL"]'),
    ('White Sneakers', 'Footwear', 'Casual', 'Unisex', 1799, 2499, 950, '["White"]', '["6","7","8","9","10"]'),
    ('Leather Sandals', 'Footwear', 'Sandals', 'Men', 999, 1499, 480, '["Tan","Black"]', '["7","8","9","10"]')
  ) as t(name, category, subcategory, gender, price, mrp, cost, cols, szs) loop
    if not exists (select 1 from sty_styles where tenant_id = tid and name = r.name) then
      perform sty_save_style(jsonb_build_object('name', r.name, 'category', r.category, 'subcategory', r.subcategory, 'gender', r.gender, 'price', r.price, 'mrp', r.mrp,
        'cost', r.cost, 'colours', r.cols::jsonb, 'sizes', r.szs::jsonb, 'opening', jsonb_build_object('qty', 6, 'unitCost', r.cost, 'branchId', b)));
    end if;
  end loop;
  return jsonb_build_object('ok', true);
end $$;
