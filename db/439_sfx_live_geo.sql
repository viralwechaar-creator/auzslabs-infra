-- Live View globe: each visitor event can carry the browser's timezone name (for example "Asia/Kolkata"). Nothing else about location is stored: no IP, no coordinates.
-- The dashboard turns the timezone into a coarse city dot. Visitors with an unknown timezone are counted but not drawn.
-- Rollback: alter table sfx_web_events drop column tz; then re-run db/401_storefront_live_visitors.sql to restore both functions.
alter table sfx_web_events add column if not exists tz text;

create or replace function public_sfx_track(p_slug text, p jsonb) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid; e jsonb; n int := 0; k text;
begin
  tid := sfx_public_tenant(p_slug);
  if tid is null or p is null or jsonb_typeof(p->'events') <> 'array' then return; end if;
  for e in select * from jsonb_array_elements(p->'events') loop
    exit when n >= 40;
    k := e->>'k';
    continue when k is null or k not in ('view', 'scroll', 'time', 'product', 'bag', 'wish', 'checkout', 'order', 'search', 'filter', 'click');
    continue when length(coalesce(e->>'sid', '')) not between 8 and 40;
    insert into sfx_web_events (tenant_id, sid, kind, page, device, tz)
    values (tid, e->>'sid', k, left(e->>'p', 80), case when e->>'dev' in ('phone', 'tablet', 'desktop') then e->>'dev' end,
      case when e->>'tz' ~ '^[A-Za-z_]+(/[A-Za-z_+-]+){0,2}$' and length(e->>'tz') <= 40 then e->>'tz' end);
    n := n + 1;
  end loop;
  if random() < 0.01 then delete from sfx_web_events where tenant_id = tid and created_at < now() - interval '60 days'; end if;
end $$;
grant execute on function public_sfx_track(text, jsonb) to app;

create or replace function sfx_live_visitors() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view'); r jsonb;
begin
  with ev as (select * from sfx_web_events where tenant_id = tid and created_at > now() - interval '5 minutes'),
  last_ev as (select distinct on (sid) sid, page, device, kind, tz, created_at from ev order by sid, created_at desc),
  today as (select count(distinct sid) n from sfx_web_events where tenant_id = tid and created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')
  select jsonb_build_object(
    'now', (select count(*) from last_ev),
    'today', (select n from today),
    'inBag', (select count(distinct sid) from ev where kind = 'bag'),
    'inCheckout', (select count(distinct sid) from ev where kind = 'checkout'),
    'zones', coalesce((select jsonb_object_agg(tz, c) from (select tz, count(*) c from last_ev where tz is not null group by tz) z), '{}'::jsonb),
    'visitors', coalesce((select jsonb_agg(jsonb_build_object('page', coalesce(page, '/'), 'device', device, 'doing', kind, 'seen', created_at) order by created_at desc) from (select * from last_ev order by created_at desc limit 25) x), '[]'::jsonb)
  ) into r;
  return r;
end $$;
