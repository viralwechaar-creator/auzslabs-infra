-- Storefront dashboard: visitor summary and traffic chart from the real visitor events (db/401).
-- Same scope (this store only) and timezone (Asia/Kolkata) as Live view. "sessions" = distinct browsers per day.
-- Rollback: drop function sfx_visitor_summary(int);
create or replace function sfx_visitor_summary(p_days int default 14) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view'); d int := least(greatest(coalesce(p_days, 14), 1), 90); r jsonb; start_ts timestamptz;
begin
  start_ts := (date_trunc('day', now() at time zone 'Asia/Kolkata') - make_interval(days => d - 1)) at time zone 'Asia/Kolkata';
  with ev as (
    select sid, kind, page, device, (created_at at time zone 'Asia/Kolkata')::date as day
    from sfx_web_events where tenant_id = tid and created_at >= start_ts
  ),
  days as (select generate_series((now() at time zone 'Asia/Kolkata')::date - (d - 1), (now() at time zone 'Asia/Kolkata')::date, interval '1 day')::date as day),
  per as (
    select day, count(distinct sid) visitors, count(distinct sid) filter (where kind = 'bag') bag,
           count(distinct sid) filter (where kind = 'checkout') checkout, count(distinct sid) filter (where kind = 'order') ordered,
           count(*) filter (where kind = 'view') views
    from ev group by day
  )
  select jsonb_build_object(
    'days', d, 'tracking', true,
    'visitors', (select count(distinct sid) from ev),
    'views', (select count(*) from ev where kind = 'view'),
    'bag', (select count(distinct sid) from ev where kind = 'bag'),
    'checkout', (select count(distinct sid) from ev where kind = 'checkout'),
    'ordered', (select count(distinct sid) from ev where kind = 'order'),
    'series', (select coalesce(jsonb_agg(jsonb_build_object('day', to_char(dd.day, 'YYYY-MM-DD'), 'visitors', coalesce(p.visitors, 0), 'views', coalesce(p.views, 0), 'bag', coalesce(p.bag, 0), 'checkout', coalesce(p.checkout, 0), 'ordered', coalesce(p.ordered, 0)) order by dd.day), '[]'::jsonb)
               from days dd left join per p on p.day = dd.day),
    'devices', (select coalesce(jsonb_agg(jsonb_build_object('device', coalesce(device, 'unknown'), 'visitors', n) order by n desc), '[]'::jsonb) from (select device, count(distinct sid) n from ev group by device) x),
    'pages', (select coalesce(jsonb_agg(jsonb_build_object('page', pg, 'views', n) order by n desc), '[]'::jsonb) from (select coalesce(page, '/') pg, count(*) n from ev where kind = 'view' group by 1 order by n desc limit 8) y)
  ) into r;
  return r;
end $$;
grant execute on function sfx_visitor_summary(int) to app;
