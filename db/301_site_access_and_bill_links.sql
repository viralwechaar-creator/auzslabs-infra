-- Addresses: a shop gets its own address (shopname.auzslab.in) only when it has WEBSITE ACCESS; its apps live on the shared app addresses.
-- Both functions below are called only by the server (routes/sites.js), never by a browser, so they are NOT in the RPC list.

-- Who may have a shop address, and of what kind:
--   custom = a specially built website, salon = salon website, store = AUZsStyle online store that is switched ON,
--   qr = cafe QR / takeaway ordering website, none = no website (apps only).
-- 'app' = the shared address of the shop's main app, used only to forward old links during the transition.
create or replace function site_access(p_slug text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare t tenants; feat jsonb; en jsonb; kind text := 'none'; app text := 'app';
  on_ boolean;
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
  -- the shop's main app, in this order
  app := case
    when feat->>'pos' = 'true' then 'auzspos' when feat->>'style' = 'true' then 'auzsstyle' when feat->>'mobile' = 'true' then 'auzsmob'
    when feat->>'accounting' = 'true' then 'auzsledger' when feat->>'payroll' = 'true' then 'auzspay' when feat->>'scan' = 'true' then 'auzsscan'
    when feat->>'finance' = 'true' then 'auzsfinance' else 'app' end;
  return jsonb_build_object('exists', true, 'kind', kind, 'app', app);
end $$;

-- A customer's short bill link (auzslab.in/b/<code>) -> which kind of bill it is. null = no such bill.
create index if not exists records_order_tok on records ((data->>'tok')) where kind = 'order';
create or replace function bill_resolve(p_code text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c text := btrim(coalesce(p_code, ''));
begin
  if c !~ '^[A-Za-z0-9]{6,80}$' then return null; end if;
  if exists (select 1 from sty_sales where share_token = c) then return jsonb_build_object('k', 'style', 't', c); end if;
  if exists (select 1 from acc_documents where share_token = c) then return jsonb_build_object('k', 'ledger', 't', c); end if;
  if exists (select 1 from mob_sales where share_token = c) then return jsonb_build_object('k', 'mob', 't', c); end if;
  if exists (select 1 from records where kind = 'order' and data->>'tok' = c) then return jsonb_build_object('k', 'pos', 't', c); end if;
  return null;
end $$;

-- Old shop addresses keep forwarding to the right app address until this date (30 days from now), then show "page not found".
insert into platform_flags (key, value) values ('legacy_shop_addr_until', to_char(now() + interval '30 days', 'YYYY-MM-DD')) on conflict (key) do nothing;
-- Rollback: drop function site_access(text); drop function bill_resolve(text); drop index records_order_tok; delete from platform_flags where key = 'legacy_shop_addr_until';
