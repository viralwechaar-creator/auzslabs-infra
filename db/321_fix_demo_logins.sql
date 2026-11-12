-- Repair-after-the-fact (same pattern as db/015/db/051/db/133/db/165, etc): re-asserts the consolidated
-- demo tenant's login and feature entitlements, idempotently, instead of trusting that every one of
-- db/078/084/221/254's separate historical migrations landed correctly on this exact production database.
-- Found while testing the AI connector (db/318-320) against the live demos -- site/live-demo.html advertises
-- demo@auzslab.in as having AUZsPOS, AUZsPay, AUZsLedger, AUZsMob, AUZsScan, AUZsStyle AND AUZsFinance, all
-- on the one 'demo' tenant; this makes that actually true, whatever the current state is, rather than
-- guessing from migration history alone. Never touches a real (non-demo) tenant: scoped to is_demo = true.
-- (The salon demo is handled separately -- see db/322, which retires demo-salon in favour of showoffsalon.)
do $$
declare demo_hash text := '$2b$12$xOTBlE6KbXc6ssgD7TAFGueYsQpjPvYk0TRAPdSuWPj9ymGucsRlK'; -- bcrypt('Auzslab@Demo'), the same shared demo hash db/023/db/078 already use
  tid uuid; uid uuid; fixed jsonb;
begin
  select id into tid from tenants where slug = 'demo' and is_demo;
  if tid is null then
    raise notice 'demo tenant (slug=demo) not found -- nothing to fix here, check if it was renamed';
  else
    update tenant_settings
      set features = coalesce(features, '{}'::jsonb) || '{"self_order":true,"payroll":true,"accounting":true,"mobile":true,"style":true,"finance":true}'::jsonb
      where tenant_id = tid
      returning features into fixed;
    raise notice 'demo tenant features now: %', fixed;

    select id into uid from auth_users where email = 'demo@auzslab.in';
    if uid is null then
      insert into auth_users (email, password_hash, app_metadata) values ('demo@auzslab.in', demo_hash, jsonb_build_object('tenant_id', tid, 'role', 'owner'));
      raise notice 'demo@auzslab.in did not exist -- created';
    else
      update auth_users set password_hash = demo_hash, deleted_at = null, disabled_at = null where id = uid;
      if not exists (select 1 from profiles where id = uid and tenant_id = tid and role = 'owner') then
        update profiles set tenant_id = tid, role = 'owner' where id = uid;
        raise notice 'demo@auzslab.in existed but was not owner of tenant % -- fixed', tid;
      else
        raise notice 'demo@auzslab.in login confirmed (password reset to the known demo password, just in case)';
      end if;
    end if;
  end if;
end $$;
