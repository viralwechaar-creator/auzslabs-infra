-- Storefront round H: reports. Read-only functions over orders and visitor events. Nothing is stored except the dashboard layout.
--  * Orders that are cancelled or marked as test never count. Sales are net of refunds.
--  * Profit only uses lines whose cost is known, and always says what share of sales that covers.
--  * Every function takes a number of days (1 to 365) and uses Asia/Kolkata days.

create function sfx_days(p int, p_default int) returns int language sql immutable as $$ select greatest(1, least(coalesce(p, p_default), 365)) $$;

-- Visitor funnel: sessions, product views, bag, checkout, orders, with the step-to-step rates.
create function sfx_report_funnel(p_days int default 30) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view'); d int := sfx_days(p_days, 30); since timestamptz := now() - make_interval(days => d); r jsonb; sess int; pv int; bg int; co int; ord int;
begin
  select count(distinct sid), count(distinct sid) filter (where kind = 'product'), count(distinct sid) filter (where kind = 'bag'), count(distinct sid) filter (where kind = 'checkout')
    into sess, pv, bg, co from sfx_web_events where tenant_id = tid and created_at >= since;
  select count(*) into ord from sfx_orders where tenant_id = tid and created_at >= since and status <> 'cancelled' and not is_test;
  r := jsonb_build_object('days', d, 'steps', jsonb_build_array(
    jsonb_build_object('step', 'Sessions', 'count', sess), jsonb_build_object('step', 'Viewed a product', 'count', pv),
    jsonb_build_object('step', 'Added to bag', 'count', bg), jsonb_build_object('step', 'Reached checkout', 'count', co), jsonb_build_object('step', 'Placed an order', 'count', ord)),
    'conversionRate', case when sess = 0 then null else round(100.0 * ord / sess, 2) end,
    'byDevice', coalesce((select jsonb_agg(jsonb_build_object('device', coalesce(device, 'unknown'), 'sessions', n) order by n desc) from
      (select device, count(distinct sid) n from sfx_web_events where tenant_id = tid and created_at >= since group by device) x), '[]'::jsonb));
  return r;
end $$;

-- Sessions per day, pages per session, one-page sessions, and the top pages.
create function sfx_report_sessions(p_days int default 30) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view'); d int := sfx_days(p_days, 30); since timestamptz := now() - make_interval(days => d);
begin
  return (with ev as (select sid, kind, page, device, created_at, (created_at at time zone 'Asia/Kolkata')::date as dy from sfx_web_events where tenant_id = tid and created_at >= since),
    per as (select sid, count(*) n, min(dy) as dy from ev group by sid)
    select jsonb_build_object('days', d, 'sessions', (select count(*) from per), 'avgEvents', (select round(coalesce(avg(n), 0), 1) from per),
      'singleEventShare', (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where n = 1) / count(*), 1) end from per),
      'daily', coalesce((select jsonb_agg(jsonb_build_object('day', dy, 'sessions', c) order by dy) from (select dy, count(*) c from per group by dy) q), '[]'::jsonb),
      'topPages', coalesce((select jsonb_agg(jsonb_build_object('page', pg, 'views', c) order by c desc) from (select coalesce(page, '/') pg, count(*) c from ev where kind = 'view' group by 1 order by 2 desc limit 10) q), '[]'::jsonb)));
end $$;

-- Customers grouped by the month of their first order, and how many came back in later months.
create function sfx_report_cohorts(p_months int default 6) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view'); m int := greatest(1, least(coalesce(p_months, 6), 12));
begin
  return coalesce((with o as (select coalesce(customer_id::text, customer->>'phone') cid, date_trunc('month', created_at at time zone 'Asia/Kolkata')::date mo from sfx_orders
      where tenant_id = tid and status <> 'cancelled' and not is_test and coalesce(customer_id::text, customer->>'phone') is not null),
    first as (select cid, min(mo) fm from o group by cid),
    cohort as (select f.fm, count(*) size from first f where f.fm >= (date_trunc('month', now() at time zone 'Asia/Kolkata') - make_interval(months => m - 1))::date group by f.fm)
    select jsonb_agg(jsonb_build_object('month', c.fm, 'customers', c.size, 'retention', coalesce((select jsonb_agg(jsonb_build_object('monthsLater', k, 'returned',
        (select count(distinct o.cid) from o join first f on f.cid = o.cid where f.fm = c.fm and o.mo = (c.fm + make_interval(months => k))::date)) order by k)
      from generate_series(0, m - 1) k where (c.fm + make_interval(months => k))::date <= date_trunc('month', now() at time zone 'Asia/Kolkata')::date), '[]'::jsonb)) order by c.fm) from cohort c), '[]'::jsonb);
end $$;

-- Recency, frequency, money. Each is scored 1-5 against the other customers; the labels are plain rules on those scores.
create function sfx_report_rfm() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin
  return (with base as (select coalesce(customer_id::text, customer->>'phone') cid, max(customer->>'name') name, count(*) freq, sum(total - refunded_amount) money,
      (current_date - (max(created_at at time zone 'Asia/Kolkata'))::date) rec from sfx_orders
      where tenant_id = tid and status <> 'cancelled' and not is_test and coalesce(customer_id::text, customer->>'phone') is not null group by 1),
    sc as (select *, 6 - ntile(5) over (order by rec asc) r, ntile(5) over (order by freq asc, money asc) f, ntile(5) over (order by money asc) m from base),
    lab as (select *, case when r >= 4 and f >= 4 then 'Champions' when f >= 4 and r >= 3 then 'Loyal' when r <= 2 and f >= 3 then 'At risk' when r <= 2 then 'Lost' when f = 1 and r >= 4 then 'New'
      when m >= 4 then 'Big spenders' else 'Needs attention' end seg from sc)
    select jsonb_build_object('customers', (select count(*) from lab),
      'segments', coalesce((select jsonb_agg(jsonb_build_object('segment', seg, 'customers', c, 'money', mo) order by c desc) from (select seg, count(*) c, round(sum(money), 2) mo from lab group by seg) q), '[]'::jsonb),
      'top', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'orders', freq, 'spent', round(money, 2), 'daysSince', rec, 'segment', seg) order by money desc) from (select * from lab order by money desc limit 25) q), '[]'::jsonb)));
end $$;

-- Per product variant: units sold, share sold of what was available, days of cover, dead stock, and A/B/C by revenue.
create function sfx_report_inventory(p_days int default 30) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view'); d int := sfx_days(p_days, 30); since timestamptz := now() - make_interval(days => d);
begin
  return (with sold as (select (l->>'variantId')::uuid vid, sum((l->>'qty')::int) units, sum((l->>'price')::numeric * (l->>'qty')::int) rev
      from sfx_orders o, jsonb_array_elements(o.lines) l where o.tenant_id = tid and o.status <> 'cancelled' and not o.is_test and o.created_at >= since and (l->>'variantId') is not null group by 1),
    v as (select v.id, p.name, v.label, v.stock, v.cost, coalesce(s.units, 0) units, coalesce(s.rev, 0) rev from sfx_variants v join sfx_products p on p.id = v.product_id left join sold s on s.vid = v.id
      where v.tenant_id = tid and p.status = 'active'),
    ranked as (select *, sum(rev) over (order by rev desc) running, sum(rev) over () total from v)
    select jsonb_build_object('days', d, 'rows', coalesce((select jsonb_agg(jsonb_build_object('variantId', id, 'product', name, 'variant', label, 'available', stock, 'sold', units, 'revenue', round(rev, 2),
      'sellThrough', case when units + stock = 0 then null else round(100.0 * units / (units + stock), 1) end,
      'daysOfCover', case when units = 0 then null else round(stock::numeric / (units::numeric / d), 1) end,
      'abc', case when total = 0 then 'C' when (running - rev) / total < 0.7 then 'A' when (running - rev) / total < 0.9 then 'B' else 'C' end,
      'flag', case when stock = 0 and units > 0 then 'out_of_stock' when units = 0 and stock > 0 then 'dead_stock' when units > 0 and stock::numeric / (units::numeric / d) < 7 then 'low_cover' else null end) order by rev desc) from ranked), '[]'::jsonb),
      'stockValueAtCost', (select round(coalesce(sum(stock * cost), 0), 2) from v where cost is not null), 'stockWithoutCost', (select count(*) from v where cost is null and stock > 0)));
end $$;

-- Sales, refunds, discounts, shipping, tax, and profit on the lines whose cost is known.
create function sfx_report_profit(p_days int default 30) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view'); d int := sfx_days(p_days, 30); since timestamptz := now() - make_interval(days => d);
begin
  return (with o as (select * from sfx_orders where tenant_id = tid and status <> 'cancelled' and not is_test and created_at >= since),
    ln as (select o.id, (l->>'productId')::uuid pid, l->>'name' pname, (l->>'price')::numeric * (l->>'qty')::int rev, nullif(l->>'cost', 'null')::numeric * (l->>'qty')::int cst
      from o, jsonb_array_elements(o.lines) l)
    select jsonb_build_object('days', d, 'orders', (select count(*) from o), 'grossSales', (select coalesce(sum(subtotal), 0) from o), 'discounts', (select coalesce(sum(discount_amount), 0) from o),
      'refunds', (select coalesce(sum(refunded_amount), 0) from o), 'shipping', (select coalesce(sum(shipping), 0) from o), 'tax', (select coalesce(sum(tax), 0) from o),
      'netSales', (select coalesce(sum(total - refunded_amount), 0) from o),
      'averageOrder', (select case when count(*) = 0 then null else round(sum(total - refunded_amount) / count(*), 2) end from o),
      'revenueWithCost', (select coalesce(sum(rev) filter (where cst is not null), 0) from ln), 'costKnown', (select coalesce(sum(cst), 0) from ln),
      'profitOnKnownCost', (select coalesce(sum(rev - cst) filter (where cst is not null), 0) from ln),
      'costCoverage', (select case when coalesce(sum(rev), 0) = 0 then null else round(100.0 * sum(rev) filter (where cst is not null) / sum(rev), 1) end from ln),
      'topProducts', coalesce((select jsonb_agg(jsonb_build_object('product', pname, 'revenue', round(rev, 2), 'profit', case when known then round(rev - cst, 2) end) order by rev desc)
        from (select pname, sum(rev) rev, sum(cst) cst, bool_and(cst is not null) known from ln group by pname order by sum(rev) desc limit 10) q), '[]'::jsonb)));
end $$;

-- Dashboard layout: which cards show and in what order. Stored with the store, chosen from a fixed list.
create function sfx_dashboard_layout_get() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view'); c jsonb;
begin
  select config->'dashboardLayout' into c from sfx_stores where tenant_id = tid;
  return coalesce(c, '["sales","orders","funnel","inventory","customers"]'::jsonb);
end $$;
create function sfx_dashboard_layout_save(p_cards jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); k text; out jsonb := '[]'::jsonb; cur jsonb;
begin
  if jsonb_typeof(p_cards) <> 'array' then raise exception 'Choose the cards to show' using errcode = 'SF002'; end if;
  for k in select jsonb_array_elements_text(p_cards) loop
    if k not in ('sales', 'orders', 'funnel', 'inventory', 'customers', 'profit', 'cohorts') then raise exception 'Unknown card %', k using errcode = 'SF002'; end if;
    if not (out ? k) then out := out || to_jsonb(k); end if;
  end loop;
  if jsonb_array_length(out) = 0 then raise exception 'Keep at least one card' using errcode = 'SF002'; end if;
  select config into cur from sfx_stores where tenant_id = tid;
  insert into sfx_stores (tenant_id, config) values (tid, jsonb_build_object('dashboardLayout', out)) on conflict (tenant_id) do update set config = coalesce(sfx_stores.config, '{}'::jsonb) || jsonb_build_object('dashboardLayout', out), updated_at = now();
  return out;
end $$;
grant execute on function sfx_report_funnel(int), sfx_report_sessions(int), sfx_report_cohorts(int), sfx_report_rfm(), sfx_report_inventory(int), sfx_report_profit(int), sfx_dashboard_layout_get(), sfx_dashboard_layout_save(jsonb) to app;

-- Rollback: drop functions sfx_days, sfx_report_funnel, sfx_report_sessions, sfx_report_cohorts, sfx_report_rfm, sfx_report_inventory, sfx_report_profit, sfx_dashboard_layout_get, sfx_dashboard_layout_save.
