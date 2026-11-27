-- Home and Live view showed no visitors for a business whose public store is the AUZsStyle store: that store records its visits in sty_web_events,
-- while the storefront dashboard only read sfx_web_events. The dashboard now counts both, and the AUZsStyle store also records time zone and (if the visitor allowed it) a rounded position.
-- Rollback: restore sfx_visitor_summary from db/410, sfx_live_visitors from db/440, public_sty_track from db/230; alter table sty_web_events drop column tz, drop column lat, drop column lng.
alter table sty_web_events add column if not exists tz text;
alter table sty_web_events add column if not exists lat numeric(4,1);
alter table sty_web_events add column if not exists lng numeric(5,1);

create or replace function public_sty_track(p_slug text, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; e jsonb; n int := 0; k text; la numeric; lo numeric;
begin
  select t.id into tid from tenants t join sty_store s on s.tenant_id = t.id where t.slug = lower(coalesce(p_slug, '')) and coalesce((s.config->>'on')::boolean, false);
  if tid is null or jsonb_typeof(p->'events') <> 'array' then return jsonb_build_object('ok', false); end if;
  for e in select * from jsonb_array_elements(p->'events') loop
    exit when n >= 40;
    k := e->>'k';
    continue when k is null or k not in ('view', 'scroll', 'time', 'product', 'bag', 'wish', 'checkout', 'order', 'search', 'filter', 'click', 'loc');
    continue when length(coalesce(e->>'sid', '')) not between 8 and 40;
    la := null; lo := null;
    if k = 'loc' then
      begin la := round((e->>'lat')::numeric, 1); lo := round((e->>'lng')::numeric, 1); exception when others then la := null; lo := null; end;
      continue when la is null or lo is null or la not between -90 and 90 or lo not between -180 and 180;
    end if;
    insert into sty_web_events (tenant_id, sid, kind, page, data, device, ref, is_ret, tz, lat, lng)
    values (tid, e->>'sid', k, left(e->>'p', 80), case when jsonb_typeof(e->'d') = 'object' and length((e->'d')::text) < 400 then e->'d' else '{}'::jsonb end,
      case when e->>'dev' in ('phone', 'tablet', 'desktop') then e->>'dev' end, left(e->>'ref', 80), coalesce((e->>'ret')::boolean, false),
      case when e->>'tz' ~ '^[A-Za-z_]+(/[A-Za-z_+-]+){0,2}$' and length(e->>'tz') <= 40 then e->>'tz' end, la, lo);
    n := n + 1;
  end loop;
  if random() < 0.01 then delete from sty_web_events where tenant_id = tid and created_at < now() - interval '180 days'; end if;
  return jsonb_build_object('ok', true, 'n', n);
end $$;

grant execute on function public_sty_track(text, jsonb) to app;

create or replace function sfx_visitor_summary(p_days int default 14) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view'); d int := least(greatest(coalesce(p_days, 14), 1), 90); r jsonb; start_ts timestamptz;
begin
  start_ts := (date_trunc('day', now() at time zone 'Asia/Kolkata') - make_interval(days => d - 1)) at time zone 'Asia/Kolkata';
  with ev as (
    select sid, kind, page, device, (created_at at time zone 'Asia/Kolkata')::date as day
    from (select sid, kind, page, device, created_at from sfx_web_events where tenant_id = tid and created_at >= start_ts union all select sid, kind, page, device, created_at from sty_web_events where tenant_id = tid and created_at >= start_ts) x0
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

create or replace function sfx_live_visitors() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view'); r jsonb;
begin
  with ev as (select sid, kind, page, device, tz, lat, lng, created_at from sfx_web_events where tenant_id = tid and created_at > now() - interval '5 minutes' union all select sid, kind, page, device, tz, lat, lng, created_at from sty_web_events where tenant_id = tid and created_at > now() - interval '5 minutes'),
  last_ev as (select distinct on (sid) sid, page, device, kind, tz, created_at from ev where kind <> 'loc' order by sid, created_at desc),
  loc as (select distinct on (sid) sid, lat, lng from ev where lat is not null order by sid, created_at desc),
  today as (select count(distinct sid) n from (select sid, created_at from sfx_web_events where tenant_id = tid union all select sid, created_at from sty_web_events where tenant_id = tid) u where created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')
  select jsonb_build_object(
    'now', (select count(*) from last_ev),
    'today', (select n from today),
    'inBag', (select count(distinct sid) from ev where kind = 'bag'),
    'inCheckout', (select count(distinct sid) from ev where kind = 'checkout'),
    'zones', coalesce((select jsonb_object_agg(tz, c) from (select l.tz, count(*) c from last_ev l left join loc on loc.sid = l.sid where l.tz is not null and loc.sid is null group by l.tz) z), '{}'::jsonb),
    'points', coalesce((select jsonb_agg(jsonb_build_object('lat', lat, 'lng', lng, 'n', c)) from (select loc.lat, loc.lng, count(*) c from last_ev l join loc on loc.sid = l.sid group by loc.lat, loc.lng) p), '[]'::jsonb),
    'located', (select count(*) from last_ev l join loc on loc.sid = l.sid),
    'visitors', coalesce((select jsonb_agg(jsonb_build_object('page', coalesce(page, '/'), 'device', device, 'doing', kind, 'seen', created_at) order by created_at desc) from (select * from last_ev order by created_at desc limit 25) x), '[]'::jsonb)
  ) into r;
  return r;
end $$;
