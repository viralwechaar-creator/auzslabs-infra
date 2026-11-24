-- One-off: a fresh public demo salon for the Live demo page (own address, no client's name).
--   Website:       https://salondemo.auzslab.in/
--   Owner console: https://salondemo.auzslab.in/salon/admin/   password Auzslab@Demo
--   Staff sign in: same page, username priya.salondemo / PIN 1234
-- Its sample bookings, bills and staff login are created by the salon API on the first visit and refreshed every 12 hours.
-- Apply by hand, once (safe to run again):
--   set -a; source .env; set +a
--   docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 < db_data/salon_demo_setup.sql
begin;
do $$
declare tid uuid; uid uuid; demo_hash text;
begin
  select password_hash into demo_hash from auth_users where email = 'demo@auzslab.in';
  if demo_hash is null then demo_hash := '$2b$12$xOTBlE6KbXc6ssgD7TAFGueYsQpjPvYk0TRAPdSuWPj9ymGucsRlK'; end if;
  select id into tid from tenants where slug = 'salondemo';
  if tid is null then
    insert into tenants (slug, name, niche, plan, status, is_demo) values ('salondemo', 'Salon Demo', 'salon', 'pro', 'active', true) returning id into tid;
  end if;
  update tenants set is_demo = true, niche = 'salon', status = 'active' where id = tid;
  insert into tenant_settings (tenant_id, features, labels, business_rules)
    select tid, preset.default_features || '{"payroll": true}'::jsonb, preset.default_labels, preset.default_business_rules
    from niche_presets preset where preset.niche = 'salon'
    on conflict (tenant_id) do nothing;
  insert into records (id, tenant_id, kind, data) values
    ('settings', tid, 'settings', jsonb_build_object('id', 'settings', 'name', 'Salon Demo', 'bizType', 'salon'))
    on conflict (tenant_id, id) do nothing;
  select id into uid from auth_users where email = 'salondemo@auzslab.in';
  if uid is null then
    insert into auth_users (email, password_hash, app_metadata, email_verified_at)
      values ('salondemo@auzslab.in', demo_hash, jsonb_build_object('tenant_id', tid, 'role', 'owner'), now()) returning id into uid;
  end if;
  insert into profiles (id, tenant_id, email, role) values (uid, tid, 'salondemo@auzslab.in', 'owner') on conflict (id) do nothing;
  raise notice 'ready: https://salondemo.auzslab.in/';
end $$;
commit;
