-- AUZsStyle Template 2 (the paid, photo-forward black & white storefront template, app/public/store2.html):
-- an ordinary add-on for an existing AUZsStyle tenant -- a feature key in tenant_settings.features, same
-- generic mechanism every add-on already uses. No pricing table insert here: db/260_quote_only_no_prices.sql
-- dropped product_prices and the self-serve Razorpay checkout entirely -- the platform is quote-only now
-- (a tenant submits what they want via submit_client_order's `products` text array, admin builds a manual
-- quote and switches the feature on, same as every other add-on request today). 'style_template_two', not
-- 'style_template2': submit_client_order's own products filter only accepts `^[a-z_]{2,30}$`, no digits.

-- Let the store config hold which storefront template the tenant's real store.html link uses
-- ('1' = default, the only existing behaviour; '2' = the new paid Template 2, app/public/store2.html).
-- Only the allow-list changes (adds 'template') from db/235's sty_store_save; same body otherwise.
create or replace function sty_store_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
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
  -- 'template' can only ever be set to '2' when the tenant is actually entitled to it (and not switched
  -- off by the owner) -- checked here, server-side, not just hidden in the settings UI (same discipline
  -- CLAUDE.md's "Feature flags" section calls for: a flag is not real until every layer checks it).
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

-- Entitle the consolidated demo tenant, so AUZsStyle's own demo can show Template 2 switched on for real
-- (and so anyone previewing it against real listed products needs no extra setup). Harmless no-op if the
-- demo tenant doesn't exist yet in whatever order this runs.
update tenant_settings set features = features || '{"style_template_two": true}'::jsonb
  where tenant_id = (select id from tenants where slug = 'demo');
