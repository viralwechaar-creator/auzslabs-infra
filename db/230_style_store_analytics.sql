-- AUZsStyle online store: visitor behaviour analytics. The public page sends small anonymous events (random browser id,
-- page, scroll depth, time on page, product views, bag adds, checkout steps, searches). No names, phones or addresses.
create table if not exists sty_web_events (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  sid text not null,
  kind text not null,
  page text,
  data jsonb not null default '{}'::jsonb,
  device text,
  ref text,
  is_ret boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists sty_web_events_t on sty_web_events (tenant_id, created_at desc);
alter table sty_web_events enable row level security;

create or replace function public_sty_track(p_slug text, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; e jsonb; n int := 0; k text;
begin
  select t.id into tid from tenants t join sty_store s on s.tenant_id = t.id where t.slug = lower(coalesce(p_slug, '')) and coalesce((s.config->>'on')::boolean, false);
  if tid is null or jsonb_typeof(p->'events') <> 'array' then return jsonb_build_object('ok', false); end if;
  for e in select * from jsonb_array_elements(p->'events') loop
    exit when n >= 40;
    k := e->>'k';
    continue when k is null or k not in ('view', 'scroll', 'time', 'product', 'bag', 'wish', 'checkout', 'order', 'search', 'filter', 'click');
    continue when length(coalesce(e->>'sid', '')) not between 8 and 40;
    insert into sty_web_events (tenant_id, sid, kind, page, data, device, ref, is_ret)
    values (tid, e->>'sid', k, left(e->>'p', 80), case when jsonb_typeof(e->'d') = 'object' and length((e->'d')::text) < 400 then e->'d' else '{}'::jsonb end,
      case when e->>'dev' in ('phone', 'tablet', 'desktop') then e->>'dev' end, left(e->>'ref', 80), coalesce((e->>'ret')::boolean, false));
    n := n + 1;
  end loop;
  if random() < 0.01 then delete from sty_web_events where tenant_id = tid and created_at < now() - interval '180 days'; end if;
  return jsonb_build_object('ok', true, 'n', n);
end $$;

create or replace function sty_store_analytics(p_days int default 30) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; d int := greatest(1, least(coalesce(p_days, 30), 365)); since timestamptz; r jsonb;
begin
  tid := sty_guard('sty_manage');
  since := now() - make_interval(days => d);
  with ev as (select * from sty_web_events where tenant_id = tid and created_at >= since),
  vis as (select count(distinct sid) n, count(distinct sid) filter (where is_ret) ret from ev),
  fun as (select count(distinct sid) filter (where kind = 'view') v, count(distinct sid) filter (where kind = 'product') p, count(distinct sid) filter (where kind = 'bag') b,
                 count(distinct sid) filter (where kind = 'checkout') c, count(distinct sid) filter (where kind = 'order') o from ev),
  tm as (select coalesce(avg((data->>'s')::numeric) filter (where kind = 'time'), 0) avg_s from ev),
  pg as (select page, count(*) views, count(distinct sid) visitors from ev where kind = 'view' group by 1 order by 2 desc limit 12),
  sc as (select page, count(*) n, count(*) filter (where (data->>'max')::int >= 25) a25, count(*) filter (where (data->>'max')::int >= 50) a50,
                count(*) filter (where (data->>'max')::int >= 75) a75, count(*) filter (where (data->>'max')::int >= 95) a100, round(avg((data->>'max')::int)) avg_depth,
                round(avg((data->>'s')::int)) avg_s
         from ev where kind = 'scroll' group by 1 order by 2 desc limit 10),
  pr as (select data->>'id' sid, max(data->>'name') name, count(*) views, count(distinct sid) visitors from ev where kind = 'product' group by 1 order by 3 desc limit 10),
  ad as (select data->>'id' sid, max(data->>'name') name, count(*) adds from ev where kind = 'bag' group by 1 order by 3 desc limit 10),
  sr as (select lower(data->>'q') q, count(*) n from ev where kind = 'search' and length(coalesce(data->>'q', '')) >= 2 group by 1 order by 2 desc limit 10),
  cl as (select data->>'what' what, count(*) n from ev where kind = 'click' group by 1 order by 2 desc limit 10),
  dv as (select coalesce(device, 'other') device, count(distinct sid) n from ev group by 1),
  rf as (select coalesce(nullif(ref, ''), 'Direct') ref, count(distinct sid) n from ev group by 1 order by 2 desc limit 8),
  dy as (select (created_at at time zone 'Asia/Kolkata')::date as day, count(distinct sid) n from ev group by 1 order by 1),
  hr as (select extract(hour from created_at at time zone 'Asia/Kolkata')::int as h, count(distinct sid) n from ev group by 1 order by 1)
  select jsonb_build_object('days', d, 'visitors', (select n from vis), 'returning', (select ret from vis),
    'avgSeconds', (select round(avg_s) from tm),
    'funnel', (select to_jsonb(fun) from fun),
    'pages', coalesce((select jsonb_agg(to_jsonb(pg)) from pg), '[]'),
    'scroll', coalesce((select jsonb_agg(to_jsonb(sc)) from sc), '[]'),
    'products', coalesce((select jsonb_agg(to_jsonb(pr)) from pr), '[]'),
    'adds', coalesce((select jsonb_agg(to_jsonb(ad)) from ad), '[]'),
    'searches', coalesce((select jsonb_agg(to_jsonb(sr)) from sr), '[]'),
    'clicks', coalesce((select jsonb_agg(to_jsonb(cl)) from cl), '[]'),
    'devices', coalesce((select jsonb_agg(to_jsonb(dv)) from dv), '[]'),
    'sources', coalesce((select jsonb_agg(to_jsonb(rf)) from rf), '[]'),
    'daily', coalesce((select jsonb_agg(to_jsonb(dy)) from dy), '[]'),
    'hours', coalesce((select jsonb_agg(to_jsonb(hr)) from hr), '[]'),
    'orders', (select count(*) from sty_web_orders where tenant_id = tid and created_at >= since and status <> 'cancelled'),
    'revenue', (select coalesce(sum(total), 0) from sty_web_orders where tenant_id = tid and created_at >= since and status <> 'cancelled')
  ) into r;
  return r;
end $$;
