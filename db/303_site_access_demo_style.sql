-- Shop addresses: demo businesses always keep their full address; AUZsStyle shops may use their address for remote access to the app.
-- Adds two flags to what site_access() answers (read by routes/sites.js only). Safe to re-run.
create or replace function site_access(p_slug text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t tenants; feat jsonb; en jsonb; kind text := 'none'; app text := 'app';
begin
  select * into t from tenants where slug = lower(coalesce(p_slug, ''));
  if not found or t.status in ('suspended', 'cancelled') then return jsonb_build_object('exists', false); end if;
  select coalesce(features, '{}'::jsonb), coalesce(enabled_features, '{}'::jsonb) into feat, en from tenant_settings where tenant_id = t.id;
  feat := coalesce(feat, '{}'::jsonb); en := coalesce(en, '{}'::jsonb);
  if t.build_type = 'custom' then kind := 'custom';
  elsif t.niche = 'salon' or (feat->>'salon' = 'true' and coalesce(en->>'salon', '') <> 'false') then kind := 'salon';
  elsif feat->>'style' = 'true' and coalesce(en->>'style', '') <> 'false' and tenant_cap(t.id, 'online_store')
        and coalesce((select config->>'on' from sty_store where tenant_id = t.id), 'false') = 'true' then kind := 'store';
  elsif feat->>'self_order' = 'true' and coalesce(en->>'self_order', '') <> 'false' and tenant_cap(t.id, 'online_store') then kind := 'qr';
  end if;
  app := case
    when feat->>'pos' = 'true' then 'auzspos' when feat->>'style' = 'true' then 'auzsstyle' when feat->>'mobile' = 'true' then 'auzsmob'
    when feat->>'accounting' = 'true' then 'auzsledger' when feat->>'payroll' = 'true' then 'auzspay' when feat->>'scan' = 'true' then 'auzsscan'
    when feat->>'finance' = 'true' then 'auzsfinance' else 'app' end;
  return jsonb_build_object('exists', true, 'kind', kind, 'app', app,
    'demo', coalesce(t.is_demo, false),
    'style', (feat->>'style' = 'true' and coalesce(en->>'style', '') <> 'false'));
end $$;
-- Rollback: re-run db/301_site_access_and_bill_links.sql (it redefines site_access without the two flags).
-- The 30-day transition for old shop addresses starts again from today (it had already been running while the apps were refused).
update platform_flags set value = to_char(now() + interval '30 days', 'YYYY-MM-DD') where key = 'legacy_shop_addr_until' and value < to_char(now() + interval '30 days', 'YYYY-MM-DD');
