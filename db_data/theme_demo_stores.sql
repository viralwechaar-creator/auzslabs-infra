-- One-off: a separate demo store (own address) for each website theme shown on auzslab.in/themes.html, so a theme preview
-- never opens the shared "demo" business. Each store is a demo AUZsStyle shop loaded with the same sample products as the
-- AUZsStyle demo account (sty_load_sample), with its online store switched on and the theme chosen:
--   minimaldemo.auzslab.in/store.html  (Minimal)      classicdemo.auzslab.in/store.html  (Classic)
-- Apply by hand, once (safe to run again; nothing else is touched):
--   set -a; source .env; set +a
--   docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 < db_data/theme_demo_stores.sql
-- Each store gets its own owner login <slug>@auzslab.in with the shared demo password (same as demo@auzslab.in).
begin;
do $$
declare spec record; tid uuid; uid uuid; demo_hash text;
begin
  select password_hash into demo_hash from auth_users where email = 'demo@auzslab.in';
  if demo_hash is null then raise exception 'demo@auzslab.in not found: the shared demo login must exist first'; end if;
  for spec in select * from (values
    ('minimaldemo', 'Minimal demo store', 'minimal'),
    ('classicdemo', 'Classic demo store', '1')
  ) as t(slug, name, tpl) loop
    select id into tid from tenants where slug = spec.slug;
    if tid is null then
      insert into tenants (slug, name, niche, status, is_demo) values (spec.slug, spec.name, 'retail', 'active', true) returning id into tid;
    else
      update tenants set is_demo = true where id = tid;
    end if;
    select id into uid from auth_users where email = spec.slug || '@auzslab.in';
    if uid is null then
      insert into auth_users (email, password_hash, app_metadata, email_verified_at)
        values (spec.slug || '@auzslab.in', demo_hash, jsonb_build_object('tenant_id', tid, 'role', 'owner'), now()) returning id into uid;
    end if;
    insert into profiles (id, tenant_id, email, role) values (uid, tid, spec.slug || '@auzslab.in', 'owner') on conflict (id) do nothing;
    insert into records (id, tenant_id, kind, data) values ('settings', tid, 'settings', jsonb_build_object('name', spec.name)) on conflict do nothing;
    insert into tenant_settings (tenant_id, features) values (tid, '{"style": true, "style_template_minimal": true}'::jsonb)
      on conflict (tenant_id) do update set features = coalesce(tenant_settings.features, '{}'::jsonb) || '{"style": true, "style_template_minimal": true}'::jsonb;
    perform set_config('app.uid', uid::text, true);
    if not exists (select 1 from sty_styles where tenant_id = tid) then
      perform sty_load_sample();
    end if;
    perform sty_store_save_core(jsonb_build_object('on', true, 'template', spec.tpl, 'brandName', spec.name));
    raise notice 'ready: https://%.auzslab.in/store.html', spec.slug;
  end loop;
end $$;
commit;
