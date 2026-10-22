-- One-off: AUZslab's OWN books in AUZsFinance (a normal business named "AUZslab", address auzslabhq.auzslab.in; the slug "auzslab" is reserved).
-- Apply by hand, once, AFTER db/250-254:
--   set -a; source .env; set +a
--   docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v ON_ERROR_STOP=1 -v owner_email='you@example.com' < db_data/auzslab_finance_setup.sql
-- owner_email = the login that will own the books (it must have signed in to AUZslab once). Leave it out and the script uses the only platform admin, if there is exactly one.
-- Safe to run again. It also turns AUZsFinance on for this business only; no other client is touched.
\if :{?owner_email}
\else
  \set owner_email ''
\endif
select set_config('auz.owner_email', :'owner_email', false);
begin;
do $$
declare uid uuid; tid uuid; em text := lower(btrim(current_setting('auz.owner_email', true))); n int;
begin
  if em = '' then
    select count(*) into n from platform_admins;
    if n <> 1 then raise exception 'Give the owner login: -v owner_email=''you@example.com'' (found % platform admins)', n; end if;
    select u.id into uid from platform_admins pa join auth_users u on u.id = pa.id where u.deleted_at is null;
  else
    select id into uid from auth_users where lower(email) = em and deleted_at is null;
  end if;
  if uid is null then raise exception 'No login found for that owner: sign in to AUZslab once (Google) first, then run this again'; end if;

  select tenant_id into tid from profiles where id = uid;
  if tid is not null and (select slug from tenants where id = tid) <> 'auzslabhq' then
    raise exception 'That login already belongs to another business: use a different login for AUZslab''s own books';
  end if;
  if tid is null then
    select id into tid from tenants where slug = 'auzslabhq';
    if tid is null then
      insert into tenants (name, slug, niche, status, monthly_fee) values ('AUZslab', 'auzslabhq', 'custom', 'active', 0) returning id into tid;
    end if;
    insert into records (id, tenant_id, kind, data) values ('settings', tid, 'settings', jsonb_build_object('name', 'AUZslab')) on conflict do nothing;
    insert into profiles (id, tenant_id, email, role) select uid, tid, email, 'owner' from auth_users where id = uid;
    update auth_users set app_metadata = coalesce(app_metadata, '{}'::jsonb) || jsonb_build_object('tenant_id', tid, 'role', 'owner') where id = uid;
  end if;

  insert into tenant_settings (tenant_id, features) values (tid, '{"finance": true}'::jsonb)
    on conflict (tenant_id) do update set features = coalesce(tenant_settings.features, '{}'::jsonb) || '{"finance": true}'::jsonb;

  -- act as the owner so the finance functions see the right business and role, then create the books
  perform set_config('app.uid', uid::text, true);
  perform fin_bootstrap();
  raise notice 'AUZslab books are ready (tenant %). Open https://auzslabhq.auzslab.in/finance.html (or auzsfinance.auzslab.in) and sign in with that login.', tid;
end $$;
commit;
