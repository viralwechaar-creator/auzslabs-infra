-- Live visitors can carry a rough location, but only when the visitor says yes in the browser's own prompt after a plain-words question on the store.
-- Only a rounded position is kept (one decimal, about 10 km): never an exact position, never an IP address.
-- Rollback: alter table sfx_web_events drop column lat, drop column lng; restore public_sfx_track and sfx_live_visitors from db/439_sfx_live_geo.sql.
alter table sfx_web_events add column if not exists lat numeric(4,1);
alter table sfx_web_events add column if not exists lng numeric(5,1);

create or replace function public_sfx_track(p_slug text, p jsonb) returns void language plpgsql security definer set search_path = public as $$
declare tid uuid; e jsonb; n int := 0; k text; la numeric; lo numeric;
begin
  tid := sfx_public_tenant(p_slug);
  if tid is null or p is null or jsonb_typeof(p->'events') <> 'array' then return; end if;
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
    insert into sfx_web_events (tenant_id, sid, kind, page, device, tz, lat, lng)
    values (tid, e->>'sid', k, left(e->>'p', 80), case when e->>'dev' in ('phone', 'tablet', 'desktop') then e->>'dev' end,
      case when e->>'tz' ~ '^[A-Za-z_]+(/[A-Za-z_+-]+){0,2}$' and length(e->>'tz') <= 40 then e->>'tz' end, la, lo);
    n := n + 1;
  end loop;
  if random() < 0.01 then delete from sfx_web_events where tenant_id = tid and created_at < now() - interval '60 days'; end if;
end $$;
grant execute on function public_sfx_track(text, jsonb) to app;

create or replace function sfx_live_visitors() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view'); r jsonb;
begin
  with ev as (select * from sfx_web_events where tenant_id = tid and created_at > now() - interval '5 minutes'),
  last_ev as (select distinct on (sid) sid, page, device, kind, tz, created_at from ev where kind <> 'loc' order by sid, created_at desc),
  loc as (select distinct on (sid) sid, lat, lng from ev where lat is not null order by sid, created_at desc),
  today as (select count(distinct sid) n from sfx_web_events where tenant_id = tid and created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')
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
