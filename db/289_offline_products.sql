-- Installed (offline) copies now exist for three products: AUZsStyle, AUZsPOS and AUZsLedger. A licence code is made for ONE product
-- (the product is already inside every code, db/267) and an installed copy only opens the product it was installed for.
-- 1) offline_first_run gains the product (and, for AUZsPOS, restaurant or shop) so the first start switches on the right features:
--      style  -> AUZsStyle (unchanged)
--      pos    -> AUZsPOS: restaurant = cafe preset (kitchen, CRM, billing), shop = retail preset; the website QR ordering needs the cloud so it is left off
--      ledger -> AUZsLedger (accounting)
--    Still only works while the database holds no business at all, so it can never add a second business or take one over.
-- 2) app_licences remembers which product a code was made for, and the admin list shows it.
-- Rollback: db/268's four-argument offline_first_run and db/281's admin_list_licences are the previous versions.
drop function if exists offline_first_run(text, text, text, text);
create or replace function offline_first_run(p_shop text, p_name text, p_email text, p_password_hash text, p_product text default 'style', p_biz text default null) returns uuid
language plpgsql security definer set search_path = public as $$
declare tid uuid; v_niche text := 'retail'; v_features jsonb; v_rules jsonb;
begin
  if exists (select 1 from tenants) then raise exception 'This computer is already set up.'; end if;
  if coalesce(btrim(p_shop), '') = '' or coalesce(btrim(p_email), '') = '' or coalesce(p_password_hash, '') = '' then raise exception 'Shop name, email and password are required.'; end if;
  if p_product not in ('style', 'pos', 'ledger') then raise exception 'Unknown product.'; end if;
  if p_product = 'pos' and p_biz = 'restaurant' then v_niche := 'cafe'; end if;
  select coalesce(default_business_rules, '{}'::jsonb) into v_rules from niche_presets where niche = v_niche;
  v_features := case p_product
    when 'style' then '{"style":true}'::jsonb
    when 'ledger' then '{"accounting":true}'::jsonb
    else (select default_features from niche_presets where niche = v_niche) - 'self_order' - 'accounting' || '{"pos":true}'::jsonb end;
  insert into tenants (slug, name, niche, plan, status) values ('shop', btrim(p_shop), v_niche, 'pro', 'active') returning id into tid;
  insert into tenant_settings (tenant_id, features, labels, business_rules)
    select tid, v_features, p.default_labels, p.default_business_rules from niche_presets p where p.niche = v_niche;
  insert into records (id, tenant_id, kind, data) values ('settings', tid, 'settings', coalesce(v_rules, '{}'::jsonb) || jsonb_build_object('name', btrim(p_shop)));
  insert into auth_users (email, password_hash, app_metadata, user_metadata, email_verified_at)
    values (lower(btrim(p_email)), p_password_hash, jsonb_build_object('tenant_id', tid, 'role', 'owner'), jsonb_build_object('name', coalesce(nullif(btrim(p_name), ''), 'Owner')), now());
  return tid;
end $$;

create or replace function admin_log_licence(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_code_id text := nullif(p->>'codeId', ''); v_product text := case when p->>'product' in ('style', 'pos', 'ledger') then p->>'product' else 'style' end;
begin
  if not is_platform_admin() then raise exception 'forbidden'; end if;
  insert into app_licences (product, shop, tenant_id, plan_end, addons, code, note, issued_by, code_id, lineage)
  values (v_product, p->>'shop', nullif(p->>'tenantId','')::uuid, (p->>'end')::date, coalesce(p->'addons','{}'::jsonb), p->>'code', nullif(p->>'note',''), app_uid(), v_code_id, coalesce(nullif(p->>'renewOf', ''), v_code_id))
  returning id into v_id;
  perform admin_log('licence_issued', 'licence', v_id::text, jsonb_build_object('shop', p->>'shop', 'product', v_product, 'end', p->>'end', 'addons', p->'addons'));
  return jsonb_build_object('id', v_id);
end $$;

create or replace function admin_list_licences() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'forbidden'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'shop', l.shop, 'product', l.product, 'end', l.plan_end, 'addons', l.addons, 'code', l.code, 'note', l.note, 'issuedAt', l.issued_at,
    'daysLeft', (l.plan_end - current_date), 'lineage', l.lineage,
    'backups', (select count(*) from cloud_backups b where b.lineage = l.lineage),
    'backupBytes', (select coalesce(sum(size), 0) from cloud_backups b where b.lineage = l.lineage),
    'lastBackup', (select max(made_at) from cloud_backups b where b.lineage = l.lineage),
    'tenantId', l.tenant_id, 'tenantName', t.name, 'tenantSlug', t.slug)
    order by l.issued_at desc)
    from app_licences l left join tenants t on t.id = l.tenant_id), '[]'::jsonb);
end $$;
