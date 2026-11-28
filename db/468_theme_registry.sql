-- Theme registry: a single server-side source of truth for "which storefront themes exist, what kind each one
-- is, and what does it declare it owns" -- covering EVERY theme (Minimal, Classic, Salon, Kiln, Kiln (Salon),
-- Studs, Kaarigari, and any future one), not only the bespoke-chrome ones.
--
-- WHY: investigation after the Kaarigari demo-fallback bug (fix/kaarigari-demo-theme-fallback, PR #1305) found
-- the same hardcoded-literal-list failure mode repeated in at least 8 separate spots in store.js alone
-- (isMin(), the cfg().template === 'studs'/'kaarigari' checks through routing/caching/boot, the PREVIEW_T
-- allowlist), plus demo.js, plus workspace.js's theme-install logic. The owner's instruction: this is not only
-- a bespoke-theme problem -- EVERY theme (section-based or bespoke) must be resolvable through one real,
-- queryable list, not a hardcoded array for one kind plus a bare assumption that "everything else" is the
-- other kind. This migration gives client code (store.js, demo.js, the Themes gallery) that one list.
--
-- TWO KINDS OF THEME, from sfx_themes itself (no new enum, nothing to keep in sync by hand):
--   * section-based: drawn by the shared section renderer from sfx_theme_versions' JSON content. Its
--     base_chrome is one of the two generic chromes that renderer draws, 'minimal' or 'classic' (Salon, Kiln
--     and Kiln (Salon) are section-based themes built on top of those two -- see db/376, db/381).
--   * bespoke-chrome: a fully custom-coded JS/CSS file (app/public/store/<slug>.js + .css) that bypasses the
--     section renderer entirely (Studs, Kaarigari). Its base_chrome is its OWN slug, and is neither of the
--     two generic chromes above.
-- is_bespoke_chrome below is COMPUTED from that distinction, never a hardcoded list, so it can never drift the
-- way the literal arrays did. The "dispatch template" a theme resolves to (the value that ends up in
-- sfx_stores.theme / cfg().template client-side) is base_chrome in both cases: for a bespoke theme that is its
-- own slug, for a section-based one it is the generic chrome it is built on.
--
-- Rollback: drop function public_sfx_theme_registry(); alter table sfx_themes drop column is_bespoke_chrome;
--           alter table sfx_themes drop column capabilities;
--           re-run db/467's definitions of sfx_theme_install_set_active / sfx_store_save to restore their
--           hardcoded ('studs', 'kaarigari') checks (only needed if is_bespoke_chrome is also dropped).

alter table sfx_themes add column if not exists is_bespoke_chrome boolean generated always as
  (base_chrome is not null and base_chrome not in ('minimal', 'classic')) stored;

-- Declared capabilities. checkoutOwnership is the owner-approved baseline for EVERY bespoke-chrome theme:
-- the theme wraps its own header/footer around the shared, generic checkout/account/orders/policies UI
-- (frame()/unframe() in the JS contract -- see docs/STOREFRONT_THEME_CONTRACT.md) and does not re-theme
-- checkout's own form/fields. A future theme that genuinely needs fuller checkout ownership is an explicit,
-- reviewed exception (a different declared value here, added with its own migration and sign-off), never a
-- default. A section-based theme has no chrome of its own to declare ownership over, so it carries '{}'.
alter table sfx_themes add column if not exists capabilities jsonb not null default '{}'::jsonb;

update sfx_themes set capabilities = jsonb_build_object('checkoutOwnership', 'header_footer')
  where is_bespoke_chrome and not (capabilities ? 'checkoutOwnership');

-- Studs also frames the shared (non-shadow-DOM) checkout/account pages in its own sharp-cornered form style,
-- via an extra stylesheet store.js loads generically for any theme that declares one (capabilities.formsStylesheet)
-- instead of hardcoding which slug needs it.
update sfx_themes set capabilities = capabilities || jsonb_build_object('formsStylesheet', '/store/studs-forms.css?v=1')
  where slug = 'studs' and not (capabilities ? 'formsStylesheet');

-- The authoritative, public, read-only list of every built-in theme, its kind and its declared capabilities.
-- No tenant context, no auth required (same public surface as public_sfx_store): the storefront's own
-- bootstrap code (store.js, demo.js) needs this before it even knows which tenant it is serving, and the
-- public Themes gallery needs it with no session at all. Scoped to is_builtin: a third-party marketplace
-- theme goes through its own developer review path (db/375), not this platform-owned conformance list.
-- Only APPROVED rows are returned -- a draft/pending/rejected row is never a valid activatable theme.
create or replace function public_sfx_theme_registry() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'slug', th.slug, 'name', th.name,
    'kind', case when th.is_bespoke_chrome then 'bespoke' else 'section' end,
    'baseChrome', th.base_chrome,
    'template', th.base_chrome,                 -- the dispatch value this theme resolves to client-side
    'isBespoke', th.is_bespoke_chrome,
    'capabilities', th.capabilities
  ) order by th.is_bespoke_chrome, th.name), '[]'::jsonb)
  from sfx_themes th
  where th.is_builtin and th.status = 'approved';
$$;

grant execute on function public_sfx_theme_registry() to app;

-- sfx_theme_install_set_active (db/398, extended by db/467) decided "is this a bespoke-chrome theme" with its
-- own hardcoded `th.base_chrome in ('studs', 'kaarigari')` check -- the exact same failure mode this whole
-- migration exists to remove. Redefined here, identical otherwise, to read the computed is_bespoke_chrome
-- column instead, so a new bespoke theme never needs this function edited again.
create or replace function sfx_theme_install_set_active(p_install_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); i sfx_theme_installs; th sfx_themes; st sfx_stores; bespoke boolean;
begin
  select * into i from sfx_theme_installs where id = p_install_id and tenant_id = tid;
  if i.id is null then raise exception 'Theme install not found'; end if;
  select * into th from sfx_themes where id = i.theme_id;
  bespoke := th.is_bespoke_chrome;
  if bespoke and not sfx_theme_available(th, tid) then raise exception 'This theme is not available for your store yet' using errcode = 'SF106'; end if;
  select * into st from sfx_stores where tenant_id = tid;
  if st.active_install_id is distinct from p_install_id then
    insert into sfx_stores (tenant_id, previous_theme, previous_install_id) values (tid, coalesce(st.theme, 'minimal'), st.active_install_id)
      on conflict (tenant_id) do update set previous_theme = coalesce(sfx_stores.theme, 'minimal'), previous_install_id = sfx_stores.active_install_id;
  end if;
  if bespoke and i.published_content is null then
    update sfx_theme_installs set published_content = draft_content, published_at = now() where id = i.id;
  end if;
  insert into sfx_stores (tenant_id, active_install_id) values (tid, p_install_id)
    on conflict (tenant_id) do update set active_install_id = p_install_id, updated_at = now();
  if th.is_builtin and th.base_chrome is not null then
    update sfx_stores set theme = th.base_chrome where tenant_id = tid;
  end if;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function sfx_theme_install_set_active(uuid) to app;

-- sfx_store_save (db/394, extended by db/398/db/467) kept a store on its current bespoke theme with the same
-- `theme_ in ('studs', 'kaarigari')` hardcoded check. Redefined here, identical otherwise, to check
-- is_bespoke_chrome instead -- a store can still never CHOOSE a bespoke theme through this function (only
-- sfx_theme_install_set_active / a theme's own publish RPC can make one live), it just no longer needs this
-- function edited for a new bespoke theme to be allowed to stay active across an unrelated settings save.
create or replace function sfx_store_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); cur jsonb; theme_ text; cur_theme text; ok_keys text[] := array['brandName', 'tagline', 'email', 'phone', 'currency', 'heroImages', 'pages', 'files', 'customFields', 'markets', 'policies', 'privacy'];
  list_keys text[] := array['pages', 'files', 'customFields', 'markets']; obj_keys text[] := array['policies', 'privacy'];
  k text; pk text;
begin
  if jsonb_typeof(p) <> 'object' then raise exception 'store settings must be an object' using errcode = 'SF002'; end if;
  select theme into cur_theme from sfx_stores where tenant_id = tid;
  theme_ := coalesce(p->>'theme', cur_theme, 'minimal');
  if theme_ not in ('minimal', 'classic')
     and not (cur_theme = theme_ and exists (select 1 from sfx_themes where base_chrome = theme_ and is_bespoke_chrome))
  then raise exception 'Choose Minimal or Classic' using errcode = 'SF002'; end if;
  select config into cur from sfx_stores where tenant_id = tid;
  cur := coalesce(cur, '{}'::jsonb);
  for k in select jsonb_object_keys(p) loop
    if k = any(list_keys) then
      if jsonb_typeof(p->k) <> 'array' then raise exception '% must be a list', k using errcode = 'SF002'; end if;
      if jsonb_array_length(p->k) > 200 then raise exception 'Too many items in %', k using errcode = 'SF002'; end if;
      if length((p->k)::text) > 300000 then raise exception 'That list is too large. Remove some items.' using errcode = 'SF002'; end if;
    end if;
    if k = any(obj_keys) then
      if jsonb_typeof(p->k) <> 'object' then raise exception '% must be an object', k using errcode = 'SF002'; end if;
      for pk in select jsonb_object_keys(p->k) loop
        if pk not in ('shipping', 'returns', 'privacy', 'terms', 'contactEmail', 'retention') then raise exception 'Unknown field %', pk using errcode = 'SF002'; end if;
        if jsonb_typeof(p->k->pk) <> 'string' or length(p->k->>pk) > 8000 then raise exception 'Each policy must be text up to 8000 characters' using errcode = 'SF002'; end if;
      end loop;
    end if;
    if k = any(ok_keys) then cur := cur || jsonb_build_object(k, p->k); end if;
  end loop;
  insert into sfx_stores (tenant_id, theme, published, config) values (tid, theme_, coalesce((p->>'published')::boolean, (select published from sfx_stores where tenant_id = tid), false), cur)
    on conflict (tenant_id) do update set theme = excluded.theme, published = excluded.published, config = excluded.config, updated_at = now();
  return sfx_context();
end $$;

grant execute on function sfx_store_save(jsonb) to app;
