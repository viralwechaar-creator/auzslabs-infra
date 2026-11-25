-- Storefront (sfx) visitor events: the public store already sends small anonymous events (public_sfx_track was a no-op).
-- This stores them and lets the owner see who is on the store right now.
-- Rollback: drop function sfx_live_visitors(); drop table sfx_web_events; recreate public_sfx_track as the no-op from db/372.
create table if not exists sfx_web_events (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  sid text not null,
  kind text not null,
  page text,
  device text,
  created_at timestamptz not null default now()
);
create index if not exists sfx_web_events_tenant_time on sfx_web_events (tenant_id, created_at desc);
alter table sfx_web_events enable row level security;

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
    insert into sfx_web_events (tenant_id, sid, kind, page, device)
    values (tid, e->>'sid', k, left(e->>'p', 80), case when e->>'dev' in ('phone', 'tablet', 'desktop') then e->>'dev' end);
    n := n + 1;
  end loop;
  if random() < 0.01 then delete from sfx_web_events where tenant_id = tid and created_at < now() - interval '60 days'; end if;
end $$;

-- who is on the store: distinct browsers active in the last 5 minutes, with what they are doing
create or replace function sfx_live_visitors() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view'); r jsonb;
begin
  with ev as (select * from sfx_web_events where tenant_id = tid and created_at > now() - interval '5 minutes'),
  last_ev as (select distinct on (sid) sid, page, device, kind, created_at from ev order by sid, created_at desc),
  today as (select count(distinct sid) n from sfx_web_events where tenant_id = tid and created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')
  select jsonb_build_object(
    'now', (select count(*) from last_ev),
    'today', (select n from today),
    'inBag', (select count(distinct sid) from ev where kind = 'bag'),
    'inCheckout', (select count(distinct sid) from ev where kind = 'checkout'),
    'visitors', coalesce((select jsonb_agg(jsonb_build_object('page', coalesce(page, '/'), 'device', device, 'doing', kind, 'seen', created_at) order by created_at desc) from (select * from last_ev order by created_at desc limit 25) x), '[]'::jsonb)
  ) into r;
  return r;
end $$;
grant execute on function public_sfx_track(text, jsonb) to app;
grant execute on function sfx_live_visitors() to app;
