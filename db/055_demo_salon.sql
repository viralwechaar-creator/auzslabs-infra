-- =========================================================
-- Live demo for AUZslab Salon (same idea as db/023's demo-cafe and
-- demo-retail): a real salon tenant a prospect can open and use.
--   Public site:   https://demo-salon.auzslab.in/
--   Owner console: https://demo-salon.auzslab.in/salon/admin/   password Auzslab@Demo
--   Staff console: same page, "Staff sign in"  username priya.demo-salon / PIN 1234 (db/099)
--   Payroll:       https://demo-salon.auzslab.in/payroll.html   demo-salon@auzslab.in / Auzslab@Demo
-- Its sample bookings/bills/expenses, staff login and payroll employee are
-- (re)created by server/src/salon.js every 12 hours, dated relative to
-- today, so this migration only needs to create the tenant and the owner
-- login. Same bcrypt hash as db/025's demo password; is_demo tenants are already
-- barred from invite_staff() and the salon API bars uploads, password and
-- staff changes on them.
-- =========================================================
do $$
declare tid uuid; uid uuid; demo_hash text := '$2b$12$xOTBlE6KbXc6ssgD7TAFGueYsQpjPvYk0TRAPdSuWPj9ymGucsRlK';
begin
  insert into tenants (slug, name, niche, plan, status, is_demo)
    values ('demo-salon', 'AUZslab Salon Demo', 'salon', 'pro', 'active', true)
    on conflict (slug) do nothing
    returning id into tid;
  if tid is null then select id into tid from tenants where slug = 'demo-salon'; end if;
  update tenants set is_demo = true, niche = 'salon' where id = tid;

  insert into tenant_settings (tenant_id, features, labels, business_rules)
    select tid, preset.default_features || '{"payroll": true}'::jsonb, preset.default_labels, preset.default_business_rules
    from niche_presets preset where preset.niche = 'salon'
    on conflict (tenant_id) do nothing;

  insert into records (id, tenant_id, kind, data) values
    ('settings', tid, 'settings', jsonb_build_object('id', 'settings', 'name', 'AUZslab Salon Demo', 'bizType', 'salon'))
    on conflict (tenant_id, id) do nothing;

  select id into uid from auth_users where email = 'demo-salon@auzslab.in';
  if uid is null then
    insert into auth_users (email, password_hash, app_metadata)
      values ('demo-salon@auzslab.in', demo_hash, jsonb_build_object('tenant_id', tid, 'role', 'owner'));
  end if;
end $$;
