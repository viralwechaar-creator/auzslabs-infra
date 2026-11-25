-- Premium storefront themes: a shop pays AUZslab (platform Razorpay keys) and the theme unlocks + installs.
-- Rollback: restore wrapper from db/402 (drop function sfx_theme_install(uuid); create it as in 402), drop the functions below, alter table payments drop column sfx_theme_id.
alter table payments add column if not exists sfx_theme_id uuid references sfx_themes(id) on delete set null;

-- shared by the fulfilment and by a re-install of an already-bought theme
create or replace function sfx_theme_do_install(p_tid uuid, p_theme_id uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare th sfx_themes; ins sfx_theme_installs;
begin
  select * into th from sfx_themes where id = p_theme_id;
  select * into ins from sfx_theme_installs where tenant_id = p_tid and theme_id = p_theme_id;
  if ins.id is not null then return ins.id; end if;
  insert into sfx_theme_installs (tenant_id, theme_id, source_version_id, draft_content, published_content)
    values (p_tid, p_theme_id, th.approved_version_id, coalesce((select content from sfx_theme_versions where id = th.approved_version_id), '{}'::jsonb), null)
    returning * into ins;
  return ins.id;
end $$;

-- validates and returns what to charge (called as the signed-in shop owner/manager)
create or replace function sfx_theme_order_prepare(p_theme_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); th sfx_themes;
begin
  select * into th from sfx_themes where id = p_theme_id and status = 'approved';
  if th.id is null then raise exception 'This theme is not available in the marketplace' using errcode = 'SF106'; end if;
  if th.price_cents <= 0 then raise exception 'This theme is free. Install it directly.'; end if;
  if exists (select 1 from sfx_theme_purchases where tenant_id = tid and theme_id = p_theme_id) then
    raise exception 'You have already bought this theme. Install it from the marketplace.';
  end if;
  return jsonb_build_object('tenant_id', tid, 'theme_id', th.id, 'name', th.name, 'amount', th.price_cents / 100.0);
end $$;

-- called by the signed webhook only (not registered as an RPC). Idempotent.
create or replace function sfx_theme_fulfil_payment(p_payment_id uuid) returns uuid language plpgsql security definer set search_path = public as $$
declare pay payments%rowtype; th sfx_themes; pur sfx_theme_purchases; dev_share int;
begin
  select * into pay from payments where id = p_payment_id and status = 'paid';
  if not found or pay.sfx_theme_id is null or pay.sfx_tenant_id is null then raise exception 'not a paid theme payment'; end if;
  select * into th from sfx_themes where id = pay.sfx_theme_id;
  if exists (select 1 from sfx_theme_purchases where tenant_id = pay.sfx_tenant_id and theme_id = th.id) then return pay.sfx_tenant_id; end if;
  insert into sfx_theme_purchases (tenant_id, theme_id, version_id, price_cents)
    values (pay.sfx_tenant_id, th.id, th.approved_version_id, round(pay.amount * 100)::int) returning * into pur;
  if th.developer_tenant_id is not null and pur.price_cents > 0 then
    dev_share := floor(pur.price_cents * 0.64)::int;
    insert into sfx_dev_commission_ledger (developer_tenant_id, theme_id, purchase_id, sale_amount_cents, developer_share_cents, platform_share_cents)
      values (th.developer_tenant_id, th.id, pur.id, pur.price_cents, dev_share, pur.price_cents - dev_share);
  end if;
  perform sfx_theme_do_install(pay.sfx_tenant_id, th.id);
  insert into notifications (tenant_id, type, title, body)
    values (pay.sfx_tenant_id, 'sfx_theme_paid', 'Theme unlocked', 'Payment received. "' || th.name || '" is installed and ready to customise.');
  return pay.sfx_tenant_id;
end $$;

-- a shop that already bought a theme can install it again without paying
alter function sfx_theme_install(uuid) rename to sfx_theme_install_pre405;
create function sfx_theme_install(p_theme_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); iid uuid;
begin
  if exists (select 1 from sfx_theme_purchases where tenant_id = tid and theme_id = p_theme_id) then
    iid := sfx_theme_do_install(tid, p_theme_id);
    return jsonb_build_object('installId', iid, 'alreadyInstalled', false);
  end if;
  return sfx_theme_install_pre405(p_theme_id);
end $$;
grant execute on function sfx_theme_install(uuid) to app;
grant execute on function sfx_theme_order_prepare(uuid) to app;
