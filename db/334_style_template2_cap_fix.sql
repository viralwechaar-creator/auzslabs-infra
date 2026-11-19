-- Fixes a regression in db/333_style_template2.sql, found while debugging "selected Template 2 and
-- saved, but my store still shows the old design": that migration's first version replaced
-- sty_store_save(jsonb) directly -- which, since db/257_plan_caps.sql, is a thin wrapper
-- (tenant_cap('online_store') check, then delegates to sty_store_save_core) -- instead of
-- sty_store_save_core(jsonb), the actual implementation. Editing db/333's source fixes a fresh
-- install; it does nothing for a database that already ran the broken version, so this migration
-- fixes it forward instead, idempotently, whether or not 333 ever ran or ran broken:
-- 1. (re)creates sty_store_save_core with the correct body (same as the fixed db/333).
-- 2. (re)creates sty_store_save as db/257's own wrapper, restoring the plan-cap check.
create or replace function sty_store_save_core(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; cur jsonb; k text; ok_keys text[] := array['on', 'tagline', 'announce', 'heroImages', 'heroTitle', 'heroCta', 'about', 'founders',
    'stores', 'faqs', 'policies', 'shipping', 'pay', 'social', 'email', 'phone', 'brandName', 'showSale', 'sizeGuide', 'waOrder', 'abandonWa',
    'blogs', 'media', 'jobs', 'hiring', 'template'];
begin
  tid := sty_guard('sty_manage');
  if jsonb_typeof(p) <> 'object' then raise exception 'store settings must be an object' using errcode = 'ST002'; end if;
  if length(p::text) > 240000 then raise exception 'store settings are too large' using errcode = 'ST002'; end if;
  select config into cur from sty_store where tenant_id = tid;
  cur := coalesce(cur, '{}'::jsonb);
  for k in select jsonb_object_keys(p) loop
    if k = any(ok_keys) then cur := cur || jsonb_build_object(k, p->k); end if;
  end loop;
  if cur->>'template' = '2' and not exists (
    select 1 from tenant_settings ts where ts.tenant_id = tid
      and (ts.features->>'style_template_two')::boolean is true
      and coalesce((ts.enabled_features->>'style_template_two')::boolean, true) is true
  ) then
    cur := cur || jsonb_build_object('template', '1');
  end if;
  insert into sty_store (tenant_id, config) values (tid, cur)
    on conflict (tenant_id) do update set config = excluded.config, updated_at = now();
  perform sty_audit_log(tid, 'store.save', null, null);
  return sty_store_get();
end $$;

create or replace function sty_store_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_tenant();
  if not tenant_cap(tid, 'online_store') then raise exception 'The online store is not part of your plan. Ask AUZslab to upgrade.' using errcode = '42501'; end if;
  return sty_store_save_core(p);
end $$;
