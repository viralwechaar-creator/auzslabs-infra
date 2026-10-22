-- =========================================================
-- AUZsStyle: buying and inventory intelligence. Everything here is computed from the real ledger (sales, returns, stock moves,
-- purchases); nothing is stored, invented or guessed beyond what is labelled "estimate". Read-only, additive.
-- Definitions (also shown in the app):
--   units / revenue / profit .. kept pieces (sold minus returned); revenue and profit are before tax; profit = revenue - cost snapshot on the bill line
--   available days ............ days (from the variant's first stock entry) on which it could be sold (stock > 0 at any point of the day)
--   demand per day ............ units sold / available days  (so days with nothing to sell do not drag the rate down)
--   sell-through .............. units sold / (stock at the start of the period + received in the period)
--   cover days ................ stock now / demand per day
--   estimated lost units ...... demand per day x stockout days, only when there are >= 7 available days, >= 3 sales and >= 2 stockout days
--   gross profit return (GMROI) profit in the period / cost value of the stock held now (no historical valuation is stored)
-- =========================================================
alter table sty_styles add column if not exists policy text check (policy in ('evergreen', 'seasonal', 'fashion', 'limited'));
alter table sty_styles add column if not exists supplier_id uuid references sty_suppliers(id) on delete set null;
alter table sty_styles add column if not exists season_end date;
alter table sty_styles add column if not exists lead_days integer check (lead_days is null or lead_days between 0 and 365);
alter table sty_styles add column if not exists min_order integer check (min_order is null or min_order >= 0);
alter table sty_styles add column if not exists pack_size integer check (pack_size is null or pack_size >= 1);

create index if not exists sty_slines_style on sty_sale_lines (tenant_id, style_id);
create index if not exists sty_moves_variant_at on sty_stock_moves (tenant_id, variant_id, at);

-- one row per active variant for the period [d1, d2] (clamped to 180 days by the callers)
create or replace function sty_intel_base(tid uuid, d1 date, d2 date, b uuid default null)
returns table (variant_id uuid, style_id uuid, colour text, size text, cost numeric, price numeric, reorder_at int, stock int,
  first_in date, last_sale date, units int, units_late int, returned int, gross numeric, disc numeric, rev numeric, cogs numeric, full_units int,
  received int, open_stock int, win_days int, avail_days int)
language sql stable security definer set search_path = public as $$
  with v as (
    select v.id, v.style_id, v.colour, v.size, v.cost, coalesce(v.price, s.price) price, v.reorder_at
    from sty_variants v join sty_styles s on s.id = v.style_id where v.tenant_id = tid and v.active and s.active),
  mv as (
    select m.variant_id, (m.at at time zone 'Asia/Kolkata')::date d, m.qty, m.kind
    from sty_stock_moves m where m.tenant_id = tid and (b is null or m.branch_id = b) and (m.at at time zone 'Asia/Kolkata')::date <= d2),
  mv_sum as (
    select variant_id, sum(qty)::int stock, min(d) first_move, min(d) filter (where kind in ('opening', 'purchase')) first_in,
      coalesce(sum(qty) filter (where d < d1), 0)::int open_stock,
      coalesce(sum(qty) filter (where d >= d1 and kind in ('purchase', 'opening')), 0)::int received
    from mv group by variant_id),
  daily as (select variant_id, d, sum(qty)::int q from mv where d >= d1 group by variant_id, d),
  series as (
    select s.variant_id, g.d, coalesce(dl.q, 0) q, s.open_stock + sum(coalesce(dl.q, 0)) over (partition by s.variant_id order by g.d) eod, s.first_move
    from mv_sum s cross join lateral generate_series(d1, d2, interval '1 day') as g0(d0)
    cross join lateral (select g0.d0::date d) g
    left join daily dl on dl.variant_id = s.variant_id and dl.d = g.d),
  av as (
    select variant_id, count(*) filter (where d >= first_move)::int win_days,
      count(*) filter (where d >= first_move and (eod > 0 or eod - q > 0))::int avail_days
    from series group by variant_id),
  sl as (
    select l.variant_id, sum(l.qty)::int units, sum(l.qty) filter (where (s.at at time zone 'Asia/Kolkata')::date > d1 + ((d2 - d1) / 2))::int units_late,
      sum(l.returned)::int returned, sum(l.price * l.qty) gross, sum(l.disc) disc,
      sum((l.net - l.tax) * (l.qty - l.returned) / l.qty) rev, sum(l.cost * (l.qty - l.returned)) cogs,
      sum(l.qty) filter (where l.disc <= 0.01 and (l.mrp <= 0 or l.price >= l.mrp * 0.9))::int full_units
    from sty_sale_lines l join sty_sales s on s.id = l.sale_id
    where l.tenant_id = tid and s.status <> 'void' and (b is null or s.branch_id = b) and (s.at at time zone 'Asia/Kolkata')::date between d1 and d2 group by l.variant_id),
  ls as (
    select l.variant_id, max((s.at at time zone 'Asia/Kolkata')::date) d from sty_sale_lines l join sty_sales s on s.id = l.sale_id
    where l.tenant_id = tid and s.status <> 'void' and (b is null or s.branch_id = b) group by l.variant_id)
  select v.id, v.style_id, v.colour, v.size, v.cost, v.price, v.reorder_at, coalesce(ms.stock, 0), ms.first_in, ls.d,
    coalesce(sl.units, 0), coalesce(sl.units_late, 0), coalesce(sl.returned, 0), coalesce(sl.gross, 0), coalesce(sl.disc, 0), coalesce(round(sl.rev, 2), 0), coalesce(round(sl.cogs, 2), 0),
    coalesce(sl.full_units, 0), coalesce(ms.received, 0), coalesce(ms.open_stock, 0), coalesce(av.win_days, 0), coalesce(av.avail_days, 0)
  from v left join mv_sum ms on ms.variant_id = v.id left join sl on sl.variant_id = v.id left join av on av.variant_id = v.id left join ls on ls.variant_id = v.id
$$;

-- shared: clamp the period and read the shop's intelligence settings
create or replace function sty_intel_cfg(tid uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('leadDays', s.lead_days, 'coverDays', s.cover_days, 'slowDays', s.slow_days,
    'safetyDays', coalesce((s.features->'intel'->>'safetyDays')::int, 3),
    'weights', coalesce(s.features->'intel'->'weights', '{"velocity":25,"profit":20,"fullPrice":15,"availability":15,"returns":10,"age":15}'::jsonb))
  from sty_settings s where s.tenant_id = tid
$$;

create or replace function sty_intel_period(p jsonb, out d1 date, out d2 date) language plpgsql stable as $$
begin
  d2 := coalesce(nullif(p->>'to', '')::date, (now() at time zone 'Asia/Kolkata')::date);
  d1 := coalesce(nullif(p->>'from', '')::date, d2 - 59);
  if d1 > d2 then d1 := d2; end if;
  if d2 - d1 > 179 then d1 := d2 - 179; end if;
end $$;

-- confidence from how much real data stands behind a number
create or replace function sty_conf(units int, days int) returns text language sql immutable as $$
  select case when units >= 20 and days >= 21 then 'high' when units >= 8 and days >= 10 then 'medium' when units >= 3 and days >= 7 then 'low' else 'insufficient' end
$$;

-- ---------------------------------------------------------------------------------------------------------
-- Overview: money, stock risk, data freshness. p: {from, to, branchId, category}
create or replace function sty_intel_overview(p jsonb default '{}'::jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; d1 date; d2 date; b uuid; cat text; see boolean; cfg jsonb; res jsonb; today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  tid := sty_guard('sty_reports');
  select * into d1, d2 from sty_intel_period(p); b := nullif(p->>'branchId', '')::uuid; cat := nullif(p->>'category', '');
  see := sty_perm('sty_manage') or coalesce((select staff_see_cost from sty_settings where tenant_id = tid), false);
  cfg := sty_intel_cfg(tid);
  with x as (select base.*, s.category, s.name, s.season_end from sty_intel_base(tid, d1, d2, b) base join sty_styles s on s.id = base.style_id where cat is null or s.category = cat),
  t as (select coalesce(sum(units), 0) units, coalesce(sum(returned), 0) ret, coalesce(sum(gross), 0) gross, coalesce(sum(disc), 0) disc, coalesce(sum(rev), 0) rev, coalesce(sum(cogs), 0) cogs,
          coalesce(sum(full_units), 0) full_units, coalesce(sum(stock * cost) filter (where stock > 0), 0) stock_cost, coalesce(sum(stock) filter (where stock > 0), 0) stock_units,
          count(*) variants, count(*) filter (where stock <= 0) out_now, count(*) filter (where stock <= 0 and units >= 3) out_selling,
          count(distinct style_id) styles from x),
  slow as (select coalesce(sum(stock * cost), 0) val, count(*) n from x where stock > 0 and units = 0 and coalesce(today - coalesce(last_sale, first_in), 0) >= (cfg->>'slowDays')::int),
  risk as (select count(*) n from x where units >= 3 and avail_days > 0 and stock > 0 and stock / (units::numeric / greatest(avail_days, 1)) < (cfg->>'leadDays')::int),
  fresh as (select (select max(at) from sty_sales where tenant_id = tid) last_sale, (select max(at) from sty_stock_moves where tenant_id = tid) last_move)
  select jsonb_build_object('from', d1, 'to', d2, 'days', d2 - d1 + 1, 'styles', t.styles, 'variants', t.variants,
    'units', t.units, 'returnedUnits', t.ret, 'returnRate', case when t.units > 0 then round(t.ret * 100.0 / t.units, 1) end,
    'netSales', t.rev, 'gross', t.gross, 'discount', t.disc, 'markdownShare', case when t.units > 0 then round((1 - t.full_units::numeric / t.units) * 100, 1) end,
    'grossProfit', case when see then t.rev - t.cogs end, 'margin', case when see and t.rev > 0 then round((t.rev - t.cogs) * 100 / t.rev, 1) end,
    'stockCost', case when see then t.stock_cost end, 'stockUnits', t.stock_units,
    'gmroi', case when see and t.stock_cost > 0 then round((t.rev - t.cogs) / t.stock_cost, 2) end,
    'gmroiNote', 'profit in the period divided by the cost value of the stock held now',
    'outNow', t.out_now, 'outButSelling', t.out_selling, 'atRisk', risk.n, 'slowValue', case when see then slow.val end, 'slowVariants', slow.n,
    'lastSale', fresh.last_sale, 'lastStockMove', fresh.last_move,
    'confidence', sty_conf(t.units::int, (d2 - d1 + 1)),
    'costHidden', not see, 'returnCostNote', 'return-related costs (courier, repair) are not recorded; only refunds are')
  into res from t, slow, risk, fresh;
  res := res || jsonb_build_object('byCategory', coalesce((
    select jsonb_agg(jsonb_build_object('category', c.category, 'units', c.units, 'netSales', c.rev, 'grossProfit', case when see then c.rev - c.cogs end,
      'margin', case when see and c.rev > 0 then round((c.rev - c.cogs) * 100 / c.rev, 1) end, 'stockUnits', c.su) order by c.rev desc)
    from (select s.category, sum(b2.units) units, sum(b2.rev) rev, sum(b2.cogs) cogs, sum(b2.stock) filter (where b2.stock > 0) su
          from sty_intel_base(tid, d1, d2, b) b2 join sty_styles s on s.id = b2.style_id where cat is null or s.category = cat group by s.category) c), '[]'::jsonb));
  return res;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Designs: one row per style with a transparent score. p: {from, to, branchId, category, season, lifecycle}
create or replace function sty_intel_designs(p jsonb default '{}'::jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; d1 date; d2 date; b uuid; cat text; see boolean; cfg jsonb; w jsonb; wt numeric; today date := (now() at time zone 'Asia/Kolkata')::date; slow int; res jsonb;
begin
  tid := sty_guard('sty_reports');
  select * into d1, d2 from sty_intel_period(p); b := nullif(p->>'branchId', '')::uuid; cat := nullif(p->>'category', '');
  see := sty_perm('sty_manage') or coalesce((select staff_see_cost from sty_settings where tenant_id = tid), false);
  cfg := sty_intel_cfg(tid); w := cfg->'weights'; slow := (cfg->>'slowDays')::int;
  wt := greatest((w->>'velocity')::numeric + (w->>'profit')::numeric + (w->>'fullPrice')::numeric + (w->>'availability')::numeric + (w->>'returns')::numeric + (w->>'age')::numeric, 1);
  with agg as (
    select s.id, s.name, s.category, s.brand, s.season, s.policy, s.season_end, s.photo_url,
      sum(x.units) units, sum(x.units_late) late, sum(x.returned) ret, sum(x.gross) gross, sum(x.disc) disc, sum(x.rev) rev, sum(x.cogs) cogs, sum(x.full_units) full_units,
      sum(x.stock) filter (where x.stock > 0) stock, sum(x.stock * x.cost) filter (where x.stock > 0) stock_cost, count(*) nvar, count(*) filter (where x.stock > 0) in_stock_var,
      min(x.first_in) first_in, max(x.last_sale) last_sale, max(x.win_days) win_days,
      sum(x.avail_days) av_sum, sum(x.win_days) win_sum, sum(x.received) received, sum(x.open_stock) open_stock,
      coalesce(sum(x.units) / nullif(max(x.avail_days), 0)::numeric, 0) per_day
    from sty_intel_base(tid, d1, d2, b) x join sty_styles s on s.id = x.style_id where (cat is null or s.category = cat) and (nullif(p->>'season', '') is null or s.season = p->>'season')
    group by s.id),
  sc as (
    select a.*, percent_rank() over (order by a.per_day) pr_vel, percent_rank() over (order by a.rev - a.cogs) pr_gp,
      case when a.units > 0 then a.full_units * 100.0 / a.units end full_pct, case when a.units > 0 then a.ret * 100.0 / a.units end ret_pct,
      case when a.win_sum > 0 then a.av_sum * 100.0 / a.win_sum end avail_pct,
      case when a.late + (a.units - a.late) > 0 and a.units >= 6 then 50 + 50 * (a.late - (a.units - a.late))::numeric / greatest(a.late, a.units - a.late, 1) end trend_score,
      today - coalesce(a.last_sale, a.first_in, today) idle, today - coalesce(a.first_in, today) age
    from agg a),
  cs as (
    select sc.*, sty_conf(sc.units::int, coalesce(sc.win_days, 0)) conf,
      round(coalesce(0.7 * pr_vel * 100 + 0.3 * coalesce(trend_score, 50), 0)) s_vel, round(coalesce(pr_gp * 100, 0)) s_gp, round(coalesce(full_pct, 0)) s_full,
      round(coalesce(avail_pct, 0)) s_avail, round(coalesce(100 - least(100, ret_pct * 5), 100)) s_ret,
      round(case when coalesce(stock, 0) = 0 then 100 else 100 * (1 - least(1, greatest(0, idle - 14)::numeric / greatest(slow, 30))) end
        - case when policy = 'seasonal' and season_end is not null and stock > 0 and per_day > 0 and stock / per_day > (season_end - today) then 30 when policy = 'seasonal' and season_end is not null and season_end < today and stock > 0 then 40 else 0 end) s_age
    from sc),
  fin as (
    select cs.*, greatest(0, least(100, round((s_vel * (w->>'velocity')::numeric + s_gp * (w->>'profit')::numeric + s_full * (w->>'fullPrice')::numeric + s_avail * (w->>'availability')::numeric
      + s_ret * (w->>'returns')::numeric + greatest(s_age, 0) * (w->>'age')::numeric) / wt))) score,
      case when per_day > 0 then round(coalesce(stock, 0) / per_day) end cover
    from cs)
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', f.id, 'name', f.name, 'category', f.category, 'brand', f.brand, 'season', f.season, 'policy', f.policy, 'photo', f.photo_url,
    'units', f.units, 'returned', f.ret, 'netSales', round(f.rev), 'grossProfit', case when see then round(f.rev - f.cogs) end,
    'margin', case when see and f.rev > 0 then round((f.rev - f.cogs) * 100 / f.rev, 1) end, 'discount', round(f.disc),
    'avgPrice', case when f.units > 0 then round(f.gross / f.units) end, 'fullPricePct', round(f.full_pct), 'markdownPct', case when f.units > 0 then round(100 - f.full_pct) end,
    'stock', coalesce(f.stock, 0), 'stockCost', case when see then round(coalesce(f.stock_cost, 0)) end, 'variants', f.nvar, 'variantsInStock', f.in_stock_var,
    'perDay', round(f.per_day, 2), 'coverDays', f.cover, 'sellThrough', case when f.open_stock + f.received > 0 then round(f.units * 100.0 / (f.open_stock + f.received)) end,
    'gmroi', case when see and coalesce(f.stock_cost, 0) > 0 then round((f.rev - f.cogs) / f.stock_cost, 2) end,
    'ageDays', f.age, 'idleDays', f.idle, 'lastSale', f.last_sale, 'seasonEnd', f.season_end,
    'confidence', f.conf, 'score', case when f.conf = 'insufficient' then null else f.score end,
    'components', jsonb_build_object('velocity', f.s_vel, 'profit', case when see then f.s_gp end, 'fullPrice', f.s_full, 'availability', f.s_avail, 'returns', f.s_ret, 'age', greatest(f.s_age, 0)),
    'trend', case when f.trend_score is null then null when f.trend_score >= 65 then 'up' when f.trend_score <= 35 then 'down' else 'flat' end,
    'lifecycle', case
        when f.age <= 21 and f.first_in is not null then 'Newly launched'
        when f.conf = 'insufficient' and coalesce(f.stock, 0) = 0 then 'Sold out / no data'
        when f.policy = 'seasonal' and f.season_end is not null and f.season_end < today then 'Seasonal clearance'
        when f.units = 0 and f.idle >= slow then 'Seasonal clearance'
        when f.trend_score >= 65 and f.pr_vel < 0.8 then 'Growing'
        when f.trend_score >= 65 or f.pr_vel >= 0.8 then 'Peak demand'
        when f.trend_score <= 30 then 'Declining'
        else 'Steady' end,
    'class', case
        when f.conf = 'insufficient' and f.age <= 21 then 'Newly launched (too early to judge)'
        when f.conf = 'insufficient' then 'Insufficient data'
        when f.score >= 70 and f.pr_vel >= 0.7 then 'High-demand winner'
        when see and f.pr_gp >= 0.7 and f.pr_vel < 0.7 then 'Profitable performer'
        when f.full_pct is not null and f.full_pct < 40 and f.units >= 8 then 'Discount-dependent'
        when f.policy = 'seasonal' and f.season_end is not null and coalesce(f.stock, 0) > 0 and f.per_day > 0 and f.stock / f.per_day > (f.season_end - today) then 'Seasonal risk'
        when coalesce(f.stock, 0) > 0 and f.idle >= slow then 'Clearance candidate'
        when f.trend_score >= 65 and f.pr_vel < 0.7 then 'Emerging design'
        when f.pr_vel <= 0.25 and coalesce(f.stock, 0) > 0 then 'Low-velocity inventory'
        when f.pr_vel >= 0.5 then 'Potential bestseller'
        else 'Steady performer' end
  ) order by f.score desc nulls last, f.units desc), '[]'::jsonb) into res from fin f;
  return jsonb_build_object('from', d1, 'to', d2, 'weights', w, 'costHidden', not see, 'designs', res);
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- One design in depth: colour x size matrix, size curve (own vs category), comparables, estimate for a design with no history.
create or replace function sty_intel_design(p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; d1 date; d2 date; b uuid; sid uuid := nullif(p->>'styleId', '')::uuid; see boolean; s sty_styles; today date := (now() at time zone 'Asia/Kolkata')::date; res jsonb; own_units int;
begin
  tid := sty_guard('sty_reports');
  select * into d1, d2 from sty_intel_period(p); b := nullif(p->>'branchId', '')::uuid;
  see := sty_perm('sty_manage') or coalesce((select staff_see_cost from sty_settings where tenant_id = tid), false);
  select * into s from sty_styles where id = sid and tenant_id = tid;
  if not found then raise exception 'style not found' using errcode = 'ST002'; end if;
  select coalesce(sum(units), 0) into own_units from sty_intel_base(tid, d1, d2, b) where style_id = sid;
  res := jsonb_build_object('style', jsonb_build_object('id', s.id, 'name', s.name, 'category', s.category, 'subcategory', s.subcategory, 'brand', s.brand, 'gender', s.gender, 'season', s.season,
      'price', s.price, 'policy', s.policy, 'seasonEnd', s.season_end, 'leadDays', s.lead_days, 'minOrder', s.min_order, 'packSize', s.pack_size, 'supplierId', s.supplier_id,
      'supplier', (select name from sty_suppliers where id = s.supplier_id)), 'from', d1, 'to', d2, 'costHidden', not see);
  res := res || jsonb_build_object('variants', coalesce((
    select jsonb_agg(jsonb_build_object('id', x.variant_id, 'colour', x.colour, 'size', x.size, 'stock', x.stock, 'units', x.units, 'returned', x.returned,
      'perDay', case when x.avail_days > 0 then round(x.units::numeric / x.avail_days, 2) else 0 end,
      'coverDays', case when x.units > 0 and x.avail_days > 0 and x.stock > 0 then round(x.stock / (x.units::numeric / x.avail_days)) end,
      'availDays', x.avail_days, 'windowDays', x.win_days, 'stockoutDays', x.win_days - x.avail_days,
      'sellThrough', case when x.open_stock + x.received > 0 then round(x.units * 100.0 / (x.open_stock + x.received)) end,
      'netSales', round(x.rev), 'grossProfit', case when see then round(x.rev - x.cogs) end,
      'returnRate', case when x.units > 0 then round(x.returned * 100.0 / x.units, 1) end,
      'estLostUnits', case when x.avail_days >= 7 and x.units >= 3 and x.win_days - x.avail_days >= 2 then round(x.units::numeric / x.avail_days * (x.win_days - x.avail_days), 1) end,
      'confidence', sty_conf(x.units, x.avail_days)) order by x.colour, x.size)
    from sty_intel_base(tid, d1, d2, b) x where x.style_id = sid), '[]'::jsonb));
  -- the design's own size curve versus the category's (units sold, share of the design, share of the category)
  res := res || jsonb_build_object('sizeCurve', coalesce((
    with own as (select size, sum(units) u from sty_intel_base(tid, d1, d2, b) where style_id = sid and size <> '' group by size),
         catg as (select x.size, sum(x.units) u from sty_intel_base(tid, d2 - 89, d2, b) x join sty_styles s2 on s2.id = x.style_id where s2.category = s.category and x.size <> '' group by x.size)
    select jsonb_agg(jsonb_build_object('size', coalesce(own.size, catg.size), 'ownUnits', coalesce(own.u, 0),
      'ownShare', case when (select sum(u) from own) > 0 then round(coalesce(own.u, 0) * 100.0 / (select sum(u) from own), 1) end,
      'categoryShare', case when (select sum(u) from catg) > 0 then round(coalesce(catg.u, 0) * 100.0 / (select sum(u) from catg), 1) end))
    from own full join catg on catg.size = own.size), '[]'::jsonb), 'sizeCurveBasis', case when own_units >= 15 then 'own' when own_units >= 1 then 'blend' else 'category' end);
  -- comparable designs: same category, matching attributes, price within 35%; scored by how many attributes agree
  res := res || jsonb_build_object('comparables', coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'match', c.m, 'matchedOn', c.on_, 'price', c.price, 'units', c.units, 'perDay', c.per_day) order by c.m desc, c.units desc)
    from (select s2.id, s2.name, s2.price,
        (case when s2.subcategory is not distinct from s.subcategory and s.subcategory is not null then 1 else 0 end + case when s2.gender is not distinct from s.gender and s.gender is not null then 1 else 0 end
         + case when s2.brand is not distinct from s.brand and s.brand is not null then 1 else 0 end + case when s2.season is not distinct from s.season and s.season is not null then 1 else 0 end
         + case when s2.fabric is not distinct from s.fabric and s.fabric is not null then 1 else 0 end + 1) m,
        array_remove(array[case when s2.subcategory is not distinct from s.subcategory and s.subcategory is not null then 'type' end, case when s2.gender is not distinct from s.gender and s.gender is not null then 'gender' end,
          case when s2.brand is not distinct from s.brand and s.brand is not null then 'brand' end, case when s2.season is not distinct from s.season and s.season is not null then 'season' end,
          case when s2.fabric is not distinct from s.fabric and s.fabric is not null then 'fabric' end, 'category'], null) on_,
        coalesce(sum(x.units), 0) units, coalesce(round(sum(x.units) / nullif(max(x.avail_days), 0)::numeric, 2), 0) per_day
      from sty_styles s2 left join sty_intel_base(tid, d2 - 89, d2, b) x on x.style_id = s2.id
      where s2.tenant_id = tid and s2.active and s2.id <> sid and s2.category = s.category and s2.price between s.price * 0.65 and s.price * 1.35 group by s2.id order by 4 desc, 6 desc limit 5) c), '[]'::jsonb));
  -- a design with little or no history: estimate from comparables (a range, clearly labelled)
  if own_units < 8 then
    res := res || jsonb_build_object('newDesignEstimate', (
      select case when count(*) filter (where per_day > 0) >= 2 then jsonb_build_object('basis', 'comparable designs', 'perDayLow', min(per_day) filter (where per_day > 0), 'perDayHigh', max(per_day) filter (where per_day > 0),
        'confidence', 'low', 'note', 'Estimated from similar designs. It is a starting point, not proof; it gives way to this design''s own sales as they build up.')
        else jsonb_build_object('basis', 'none', 'note', 'Insufficient data: no comparable design has enough sales yet.') end
      from (select s2.id, coalesce(sum(x.units) / nullif(max(x.avail_days), 0)::numeric, 0) per_day from sty_styles s2 join sty_intel_base(tid, d2 - 89, d2, b) x on x.style_id = s2.id
            where s2.tenant_id = tid and s2.id <> sid and s2.category = s.category and s2.price between s.price * 0.65 and s.price * 1.35 group by s2.id) q));
  end if;
  return res;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Reorder planner: per variant, with the size curve deciding how a style's quantity is split. p: {from, to, branchId, styleId?}
create or replace function sty_intel_reorder(p jsonb default '{}'::jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; d1 date; d2 date; b uuid; see boolean; cfg jsonb; today date := (now() at time zone 'Asia/Kolkata')::date; res jsonb; sty uuid := nullif(p->>'styleId', '')::uuid;
begin
  tid := sty_guard('sty_reports');
  select * into d1, d2 from sty_intel_period(p); b := nullif(p->>'branchId', '')::uuid;
  see := sty_perm('sty_manage') or coalesce((select staff_see_cost from sty_settings where tenant_id = tid), false);
  cfg := sty_intel_cfg(tid);
  with x as (select base.*, s.name, s.category, s.policy, s.season_end, s.pack_size, s.min_order, s.supplier_id,
      coalesce(s.lead_days, (cfg->>'leadDays')::int) lead, case when base.avail_days > 0 then base.units::numeric / base.avail_days else 0 end own_rate
    from sty_intel_base(tid, d1, d2, b) base join sty_styles s on s.id = base.style_id where sty is null or s.id = sty),
  st as (select style_id, sum(units) su, max(avail_days) sdays, sum(units)::numeric / nullif(max(avail_days), 0) style_rate from x group by style_id),
  sz as (select style_id, size, sum(units) u from x where size <> '' group by style_id, size),
  szt as (select style_id, sum(u) tot from sz group by style_id),
  cat_sz as (select s2.category, x2.size, sum(x2.units) u from sty_intel_base(tid, d2 - 89, d2, b) x2 join sty_styles s2 on s2.id = x2.style_id where x2.size <> '' group by s2.category, x2.size),
  cat_tot as (select category, sum(u) tot from cat_sz group by category),
  nv as (select style_id, count(*) n from x group by style_id),
  est as (
    select x.*, st.su,
      case when x.units >= 4 and x.avail_days >= 7 then 'own'
           when st.su >= 8 and coalesce(szt.tot, 0) > 0 and sz.u > 0 then 'size curve'
           when st.su >= 8 and ct.tot > 0 and cs.u > 0 then 'category size curve'
           else 'insufficient' end basis,
      case when x.units >= 4 and x.avail_days >= 7 then x.own_rate
           when st.su >= 8 and coalesce(szt.tot, 0) > 0 and sz.u > 0 then st.style_rate * sz.u / szt.tot
           when st.su >= 8 and ct.tot > 0 and cs.u > 0 then st.style_rate * cs.u / ct.tot
           else 0 end rate
    from x join st on st.style_id = x.style_id left join sz on sz.style_id = x.style_id and sz.size = x.size left join szt on szt.style_id = x.style_id
    left join cat_sz cs on cs.category = x.category and cs.size = x.size left join cat_tot ct on ct.category = x.category),
  plan as (
    select e.*, case when e.season_end is not null then greatest(e.season_end - today, 0) end season_left,
      round(e.rate * (e.lead + (cfg->>'safetyDays')::int), 2) rop,
      least(e.lead + (cfg->>'coverDays')::int, coalesce(case when e.season_end is not null then greatest(e.season_end - today, 0) end, 9999)) horizon
    from est e),
  need as (
    select pl.*, greatest(0, ceil(pl.rate * pl.horizon - pl.stock)::int) raw_qty,
      case when pl.pack_size is not null and pl.pack_size > 1 then pl.pack_size else 1 end pack
    from plan pl where pl.rate > 0 and pl.stock <= pl.rop and pl.policy is distinct from 'limited'),
  fin as (
    select n.*, case when n.season_left is not null and n.season_left < n.lead then 0 else ((n.raw_qty + n.pack - 1) / n.pack) * n.pack end qty from need n)
  select coalesce(jsonb_agg(jsonb_build_object(
    'variantId', f.variant_id, 'styleId', f.style_id, 'name', f.name, 'category', f.category, 'colour', f.colour, 'size', f.size,
    'stock', f.stock, 'incoming', 0, 'perDay', round(f.rate, 2), 'coverDays', case when f.rate > 0 then round(f.stock / f.rate) end,
    'leadDays', f.lead, 'reorderPoint', ceil(f.rop), 'suggestQty', f.qty, 'estCost', case when see then round(f.qty * f.cost) end,
    'stockoutDate', case when f.rate > 0 and f.stock > 0 then today + floor(f.stock / f.rate)::int when f.stock <= 0 then today end,
    'basis', f.basis, 'confidence', case when f.basis = 'own' then sty_conf(f.units, f.avail_days) when f.basis = 'insufficient' then 'insufficient' else 'low' end,
    'packSize', f.pack_size, 'styleMinOrder', f.min_order, 'supplierId', f.supplier_id, 'policy', f.policy,
    'reason', case
        when f.season_left is not null and f.season_left < f.lead then 'Not advised: the season ends in ' || f.season_left || ' days but delivery takes ' || f.lead || ' days.'
        when f.stock <= 0 then 'Out of stock and selling about ' || round(f.rate * 7, 1) || ' a week.'
        else 'Stock of ' || f.stock || ' lasts about ' || round(f.stock / f.rate) || ' days; delivery takes ' || f.lead || ' days and safety stock is ' || (cfg->>'safetyDays') || ' days.' end
        || case f.basis when 'own' then '' when 'insufficient' then '' else ' Demand estimated from the ' || f.basis || ', not this size''s own sales.' end,
    'incomingNote', 'Purchase orders are not tracked yet, so incoming stock is counted as 0. Check what is already on its way before ordering.')
    order by (f.stock <= 0) desc, case when f.rate > 0 then f.stock / f.rate end nulls last), '[]'::jsonb)
  into res from fin f where f.qty > 0 or (f.season_left is not null and f.season_left < f.lead);
  return jsonb_build_object('from', d1, 'to', d2, 'costHidden', not see, 'items', res,
    'policy', jsonb_build_object('safetyDays', cfg->'safetyDays', 'coverDays', cfg->'coverDays', 'leadDays', cfg->'leadDays'));
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Money stuck in stock. p: {branchId}
create or replace function sty_intel_capital(p jsonb default '{}'::jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; b uuid; cfg jsonb; see boolean; today date := (now() at time zone 'Asia/Kolkata')::date; slow int; res jsonb;
begin
  tid := sty_guard('sty_reports');
  see := sty_perm('sty_manage') or coalesce((select staff_see_cost from sty_settings where tenant_id = tid), false);
  if not see then raise exception 'Your role cannot see cost figures' using errcode = '42501'; end if;
  b := nullif(p->>'branchId', '')::uuid; cfg := sty_intel_cfg(tid); slow := (cfg->>'slowDays')::int;
  with x as (select base.*, s.name, s.category, s.policy, s.season_end, s.photo_url from sty_intel_base(tid, today - 59, today, b) base join sty_styles s on s.id = base.style_id where base.stock > 0),
  v as (
    select x.*, today - coalesce(x.last_sale, x.first_in, today) idle, case when x.avail_days > 0 then x.units::numeric / x.avail_days else 0 end rate, x.stock * x.cost val, x.stock * x.price retail
    from x),
  tagged as (
    select v.*, case when v.policy = 'seasonal' and v.season_end is not null and v.rate > 0 and v.stock / v.rate > greatest(v.season_end - today, 0) then 'Seasonal risk'
        when v.policy = 'seasonal' and v.season_end is not null and v.season_end < today then 'Seasonal risk'
        when v.idle >= slow and v.units = 0 then 'Stagnant'
        when v.rate > 0 and v.stock / v.rate > 150 then 'Excess'
        when v.rate = 0 and v.idle >= 30 then 'Slow' end tag from v)
  select jsonb_build_object(
    'totalCost', coalesce((select sum(val) from v), 0), 'tiedCost', coalesce((select sum(val) from tagged where tag is not null), 0),
    'tiedRetail', coalesce((select sum(retail) from tagged where tag is not null), 0), 'slowDays', slow,
    'byTag', coalesce((select jsonb_agg(jsonb_build_object('tag', tag, 'cost', c, 'units', u, 'variants', n) order by c desc) from (select tag, sum(val) c, sum(stock) u, count(*) n from tagged where tag is not null group by tag) q), '[]'::jsonb),
    'oldest', coalesce((select jsonb_agg(row_to_json(o)) from (select name, colour, size, stock, round(val) cost, idle from tagged order by idle desc, val desc limit 15) o), '[]'::jsonb),
    'designs', coalesce((select jsonb_agg(jsonb_build_object('styleId', style_id, 'name', name, 'category', category, 'cost', round(c), 'retail', round(r), 'units', u, 'variants', n, 'maxIdle', mi, 'tag', tg,
        'action', case tg when 'Seasonal risk' then 'Review a markdown before the season ends' when 'Stagnant' then 'Markdown or discontinuation review' when 'Excess' then 'Stop reordering; consider a promotion' else 'Watch; no purchase for now' end,
        'clearMonths', case when rate > 0 then round(u / (rate * 30), 1) end) order by c desc)
      from (select style_id, name, category, sum(val) c, sum(retail) r, sum(stock) u, count(*) n, max(idle) mi, sum(rate) rate,
              (array_agg(tag order by case tag when 'Seasonal risk' then 1 when 'Stagnant' then 2 when 'Excess' then 3 else 4 end))[1] tg
            from tagged where tag is not null group by style_id, name, category order by sum(val) desc limit 30) d), '[]'::jsonb),
    'note', 'Cost value of stock held now. A seasonal or new design with high stock is not dead stock; only the tagged variants are counted. Nothing is discounted or written off automatically.')
  into res;
  return res;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Lost demand: where low sales came from missing stock rather than missing interest. p: {from, to, branchId}
create or replace function sty_intel_lost(p jsonb default '{}'::jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; d1 date; d2 date; b uuid; see boolean; res jsonb;
begin
  tid := sty_guard('sty_reports');
  select * into d1, d2 from sty_intel_period(p); b := nullif(p->>'branchId', '')::uuid;
  see := sty_perm('sty_manage') or coalesce((select staff_see_cost from sty_settings where tenant_id = tid), false);
  with x as (select base.*, s.name from sty_intel_base(tid, d1, d2, b) base join sty_styles s on s.id = base.style_id),
  l as (
    select x.*, x.win_days - x.avail_days so,
      case when x.avail_days >= 7 and x.units >= 3 and x.win_days - x.avail_days >= 2 then round(x.units::numeric / x.avail_days * (x.win_days - x.avail_days), 1) end est
    from x where x.win_days - x.avail_days >= 1),
  rq as (select style_id, variant_id, size, colour, sum(qty) q, count(*) n from sty_requests where tenant_id = tid and status <> 'cancelled' and created_at >= d1 and created_at < d2 + 1 group by style_id, variant_id, size, colour)
  select jsonb_build_object('from', d1, 'to', d2,
    'variants', coalesce((select jsonb_agg(jsonb_build_object('variantId', variant_id, 'name', name, 'colour', colour, 'size', size, 'units', units, 'stockoutDays', so, 'windowDays', win_days,
        'estLostUnits', est, 'estLostRevenue', case when est is not null then round(est * price) end, 'recordedUnits', units,
        'confidence', case when est is null then 'insufficient' else sty_conf(units, avail_days) end,
        'note', case when est is null then 'Insufficient data to estimate' else 'Estimate from in-stock days. Not recorded sales.' end) order by est desc nulls last, so desc)
      from (select * from l order by est desc nulls last, so desc limit 60) q), '[]'::jsonb),
    'estLostUnits', coalesce((select sum(est) from l), 0), 'estLostRevenue', coalesce((select sum(est * price) from l), 0),
    'requests', coalesce((select jsonb_agg(jsonb_build_object('name', coalesce((select name from sty_styles where id = r.style_id), 'Other'), 'colour', r.colour, 'size', r.size, 'asks', r.n, 'units', r.q) order by r.n desc)
      from (select * from rq order by n desc limit 30) r), '[]'::jsonb),
    'requestCount', coalesce((select sum(n) from rq), 0),
    'note', 'Estimated lost sales are never added to revenue. A number appears only when there are at least 7 available days, 3 sales and 2 stockout days.')
  into res;
  return res;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Baskets: what is bought together (styles, min 3 bills), price bands and repeat buying. Aggregates only. p: {from, to, branchId}
create or replace function sty_intel_basket(p jsonb default '{}'::jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; d1 date; d2 date; b uuid; nbills int; res jsonb;
begin
  tid := sty_guard('sty_reports');
  select * into d1, d2 from sty_intel_period(p); b := nullif(p->>'branchId', '')::uuid;
  select count(distinct s.id) into nbills from sty_sales s where s.tenant_id = tid and s.status <> 'void' and (b is null or s.branch_id = b) and (s.at at time zone 'Asia/Kolkata')::date between d1 and d2;
  with items as (select distinct s.id sale, l.style_id, l.style_name from sty_sales s join sty_sale_lines l on l.sale_id = s.id
      where s.tenant_id = tid and s.status <> 'void' and (b is null or s.branch_id = b) and (s.at at time zone 'Asia/Kolkata')::date between d1 and d2),
  cnt as (select style_id, count(*) n from items group by style_id),
  pairs as (select a.style_id sa, a.style_name na, c.style_id sb, c.style_name nb, count(*) n from items a join items c on c.sale = a.sale and a.style_id < c.style_id group by 1, 2, 3, 4 having count(*) >= 3)
  select jsonb_build_object('from', d1, 'to', d2, 'bills', nbills,
    'pairs', coalesce((select jsonb_agg(jsonb_build_object('a', pr.na, 'b', pr.nb, 'together', pr.n, 'confidence', round(pr.n * 100.0 / greatest(ca.n, 1)), 'lift', round((pr.n::numeric * nbills) / (ca.n * cb.n), 2)) order by pr.n desc)
      from (select * from pairs order by n desc limit 25) pr join cnt ca on ca.style_id = pr.sa join cnt cb on cb.style_id = pr.sb), '[]'::jsonb),
    'avgBasket', (select round(avg(q)::numeric, 2) from (select sum(l.qty - l.returned) q from sty_sales s join sty_sale_lines l on l.sale_id = s.id where s.tenant_id = tid and s.status <> 'void' and (b is null or s.branch_id = b) and (s.at at time zone 'Asia/Kolkata')::date between d1 and d2 group by s.id) z),
    'priceBands', coalesce((select jsonb_agg(jsonb_build_object('band', band, 'units', u, 'revenue', r) order by o)
      from (select case when l.price < 500 then 'Under 500' when l.price < 1000 then '500 to 999' when l.price < 2000 then '1,000 to 1,999' when l.price < 3000 then '2,000 to 2,999' else '3,000 and above' end band,
              case when l.price < 500 then 1 when l.price < 1000 then 2 when l.price < 2000 then 3 when l.price < 3000 then 4 else 5 end o, sum(l.qty - l.returned) u, round(sum(l.net)) r
            from sty_sales s join sty_sale_lines l on l.sale_id = s.id where s.tenant_id = tid and s.status <> 'void' and (b is null or s.branch_id = b) and (s.at at time zone 'Asia/Kolkata')::date between d1 and d2 group by 1, 2) q), '[]'::jsonb),
    'repeat', (select jsonb_build_object('customers', count(*), 'repeat', count(*) filter (where n >= 2)) from (select customer_id, count(*) n from sty_sales where tenant_id = tid and status <> 'void' and customer_id is not null and (b is null or branch_id = b) and (at at time zone 'Asia/Kolkata')::date between d1 and d2 group by customer_id) z),
    'note', 'Pairs need at least 3 bills together. Customer names are never shown here.')
  into res;
  return res;
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Buying assistant: plain-language advice built only from the numbers above (no invented data). p: {from, to, branchId}
create or replace function sty_intel_assistant(p jsonb default '{}'::jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; d1 date; d2 date; see boolean; ro jsonb; cap jsonb; lost jsonb; ds jsonb; out jsonb := '[]'::jsonb; r record; days int; cnt int := 0;
begin
  tid := sty_guard('sty_reports');
  select * into d1, d2 from sty_intel_period(p); days := d2 - d1 + 1;
  see := sty_perm('sty_manage') or coalesce((select staff_see_cost from sty_settings where tenant_id = tid), false);
  ro := sty_intel_reorder(p); lost := sty_intel_lost(p); ds := sty_intel_designs(p);
  -- 1) reorder, grouped by design, sizes ordered by urgency
  for r in select (i->>'name') name, (i->>'colour') colour, sum((i->>'suggestQty')::int) qty,
        string_agg((i->>'size') || ' (' || (i->>'suggestQty') || ')', ', ' order by (i->>'stock')::int, (i->>'size')) sizes, sum(coalesce((i->>'estCost')::numeric, 0)) cost,
        min(i->>'confidence') conf, min(i->>'stockoutDate') soonest, bool_or(i->>'basis' <> 'own') fallback
      from jsonb_array_elements(ro->'items') i where (i->>'suggestQty')::int > 0 group by 1, 2 order by sum((i->>'suggestQty')::int) desc limit 6 loop
    out := out || jsonb_build_object('kind', 'reorder', 'title', 'Reorder ' || r.name || coalesce(' in ' || nullif(r.colour, ''), ''),
      'text', 'Buy about ' || r.qty || ' units: ' || r.sizes || '. The first size runs out around ' || r.soonest || '.' || case when r.fallback then ' Some sizes use an estimate from the size curve.' else '' end,
      'impact', case when see and r.cost > 0 then 'Purchase about ' || round(r.cost) || ' at cost' end, 'confidence', r.conf, 'period', d1 || ' to ' || d2,
      'assumptions', 'Incoming orders are not tracked, so check what is already on its way. Delivery time and cover days come from your settings.', 'alternative', 'Order only the sizes that are already out of stock.');
  end loop;
  -- 2) do not reorder: seasonal block
  for r in select (i->>'name') name, (i->>'reason') reason from jsonb_array_elements(ro->'items') i where (i->>'suggestQty')::int = 0 limit 3 loop
    out := out || jsonb_build_object('kind', 'hold', 'title', 'Do not reorder ' || r.name, 'text', r.reason, 'confidence', 'high', 'period', d1 || ' to ' || d2, 'assumptions', 'Season end date set on the design.');
  end loop;
  -- 3) money stuck
  if see then
    cap := sty_intel_capital(p);
    for r in select (d->>'name') name, (d->>'cost')::numeric cost, (d->>'units')::int units, (d->>'tag') tag, (d->>'action') action from jsonb_array_elements(cap->'designs') d order by (d->>'cost')::numeric desc limit 3 loop
      out := out || jsonb_build_object('kind', 'capital', 'title', r.name || ': ' || round(r.cost) || ' is tied up', 'text', r.units || ' units are tagged ' || lower(r.tag) || '. ' || r.action || '.',
        'impact', 'Cost value ' || round(r.cost), 'confidence', 'medium', 'period', 'stock held today', 'assumptions', 'Nothing is discounted or written off automatically.', 'alternative', 'Wait one more week of sales before acting.');
    end loop;
  end if;
  -- 4) lost demand
  for r in select (v->>'name') name, (v->>'colour') colour, (v->>'size') size, (v->>'stockoutDays') so, (v->>'windowDays') wd, (v->>'estLostUnits') est, (v->>'confidence') conf
      from jsonb_array_elements(lost->'variants') v where v->>'estLostUnits' is not null order by (v->>'estLostUnits')::numeric desc limit 3 loop
    out := out || jsonb_build_object('kind', 'lost', 'title', r.name || ' ' || coalesce(r.colour, '') || ' ' || coalesce(r.size, '') || ' was unavailable', 'text', 'It was out of stock on ' || r.so || ' of ' || r.wd || ' days. Estimated lost sales: about ' || r.est || ' units (an estimate, not recorded sales).',
      'confidence', r.conf, 'period', d1 || ' to ' || d2, 'assumptions', 'Demand on in-stock days is assumed to continue on the stockout days.');
  end loop;
  -- 5) winners and discount dependence
  for r in select (d->>'name') name, (d->>'score') score, (d->>'class') cls, (d->>'confidence') conf from jsonb_array_elements(ds->'designs') d where d->>'class' = 'High-demand winner' limit 2 loop
    out := out || jsonb_build_object('kind', 'winner', 'title', r.name || ' is a winner', 'text', 'Score ' || r.score || ' out of 100: strong demand, healthy sell-through. Keep it in stock in the sizes that sell.', 'confidence', r.conf, 'period', d1 || ' to ' || d2, 'assumptions', 'Score weights are set in Settings and can be changed.');
  end loop;
  for r in select (d->>'name') name, (d->>'fullPricePct') fp, (d->>'confidence') conf from jsonb_array_elements(ds->'designs') d where d->>'class' = 'Discount-dependent' limit 2 loop
    out := out || jsonb_build_object('kind', 'discount', 'title', r.name || ' sells mostly with discounts', 'text', 'Only ' || r.fp || '% of units sold at full price. Think twice before buying more at the same cost.', 'confidence', r.conf, 'period', d1 || ' to ' || d2);
  end loop;
  return jsonb_build_object('from', d1, 'to', d2, 'items', out, 'note', 'Every line comes from your own sales, stock and purchases. Nothing is bought or priced for you: you approve every action.');
end $$;

-- ---------------------------------------------------------------------------------------------------------
-- Settings: score weights, safety days; per-design policy (evergreen / seasonal / fashion / limited), supplier, lead time, pack and minimum
create or replace function sty_intel_set_settings(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; cur jsonb; w jsonb;
begin
  tid := sty_guard('sty_manage');
  select coalesce(features, '{}'::jsonb) into cur from sty_settings where tenant_id = tid;
  w := p->'weights';
  if w is not null then
    if (select count(*) from jsonb_object_keys(w) k where k in ('velocity', 'profit', 'fullPrice', 'availability', 'returns', 'age')) <> 6 then raise exception 'Give all six weights' using errcode = 'ST002'; end if;
    if exists (select 1 from jsonb_each_text(w) e where e.value::numeric < 0 or e.value::numeric > 100) then raise exception 'Each weight must be between 0 and 100' using errcode = 'ST002'; end if;
  end if;
  cur := jsonb_set(cur, '{intel}', coalesce(cur->'intel', '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('weights', w, 'safetyDays', case when p ? 'safetyDays' then greatest(0, least((p->>'safetyDays')::int, 60)) end)), true);
  update sty_settings set features = cur, updated_at = now() where tenant_id = tid;
  perform sty_audit_log(tid, 'intel.settings', null, p);
  return sty_intel_cfg(tid);
end $$;

create or replace function sty_intel_set_policy(p_style uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_guard('sty_manage');
  if p ? 'policy' and nullif(p->>'policy', '') is not null and p->>'policy' not in ('evergreen', 'seasonal', 'fashion', 'limited') then raise exception 'bad policy' using errcode = 'ST002'; end if;
  if nullif(p->>'supplierId', '') is not null and not exists (select 1 from sty_suppliers where id = (p->>'supplierId')::uuid and tenant_id = tid) then raise exception 'supplier not found' using errcode = 'ST002'; end if;
  update sty_styles set policy = case when p ? 'policy' then nullif(p->>'policy', '') else policy end, supplier_id = case when p ? 'supplierId' then nullif(p->>'supplierId', '')::uuid else supplier_id end,
    season_end = case when p ? 'seasonEnd' then nullif(p->>'seasonEnd', '')::date else season_end end, lead_days = case when p ? 'leadDays' then nullif(p->>'leadDays', '')::int else lead_days end,
    min_order = case when p ? 'minOrder' then nullif(p->>'minOrder', '')::int else min_order end, pack_size = case when p ? 'packSize' then nullif(p->>'packSize', '')::int else pack_size end, updated_at = now()
    where id = p_style and tenant_id = tid;
  if not found then raise exception 'style not found' using errcode = 'ST002'; end if;
  perform sty_audit_log(tid, 'intel.policy', p_style::text, p);
  return jsonb_build_object('ok', true);
end $$;

create or replace function sty_intel_settings() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin tid := sty_guard('sty_reports'); return sty_intel_cfg(tid) || jsonb_build_object('suppliers', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name) from sty_suppliers where tenant_id = tid and active), '[]'::jsonb)); end $$;
