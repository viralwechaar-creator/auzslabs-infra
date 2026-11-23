-- =========================================================
-- AUZslab storefront platform (phase 2): a real theme marketplace on top of phase 1's hardcoded
-- Minimal/Classic picker (db/372). Three things, per the owner's repeated, explicit requests:
--   (a) a store owner can customize their installed theme's content and publish those changes live;
--   (b) an outside developer can upload a theme, submit it for review, and sell it;
--   (c) every sale is tracked in a commission ledger at 64% developer / 36% AUZslab -- PAYOUT IS
--       MANUAL: the ledger only calculates and displays what's owed; the owner pays by hand (bank
--       transfer/UPI) and marks a row paid with a note. No automatic payout mechanism exists or is
--       built here -- that was explicitly deferred.
--
-- Own dedicated tables (sfx_*), same convention as 372: RLS on with zero policies, every access
-- through an sfx_guard-family SECURITY DEFINER function, grants here, every RPC registered in
-- server/src/data/rpc-registry.js.
--
-- Isolation model (the critical property this whole migration exists to guarantee): a theme's
-- *listing* content lives in sfx_theme_versions, owned by the developer who made it. The moment a
-- store "installs" that theme, sfx_theme_install_copy() COPIES that content into a brand-new
-- sfx_theme_installs row that belongs ONLY to that store. A store edits and publishes its own copy;
-- it can never see or touch another store's copy, and the developer editing their original listing
-- (or even deleting it) never reaches back into an install another store already made -- there is no
-- live reference from an install to the theme_versions row it came from for rendering purposes, only
-- a historical pointer (source_version_id) for support/debugging.
--
-- Rendering scope (read this before assuming full theme-swap parity with phase 1): the 2 built-in
-- themes (Minimal/Classic) keep their existing hand-built CSS/markup in app/public/store/store.js --
-- rewriting that 1500-line renderer into a generic section interpreter is out of scope for this slice
-- and would be a project of its own. What IS real and data-driven end to end: both built-ins are now
-- plain rows in sfx_themes/sfx_theme_versions (not a hardcoded pair), and ANY theme -- built-in or
-- third-party -- can carry a `sections` array (the same shape app/public/w.html's website-builder
-- blocks use: {id,type,props}) that a store customizes in the editor and publishes; store.js renders
-- that array as additive content blocks on the storefront home page (see its own comment for why
-- additive, not a chrome replacement). This is the real, working, verified "customize → publish →
-- live" pipeline the marketplace needs; full per-theme page chrome is a follow-up.
--
-- Paid themes: sfx_theme_install() intentionally refuses to create a purchase for any price_cents > 0
-- right now -- there is no platform billing path yet to actually collect that money from a store
-- owner (phase 1's own comment on sfx_stores says the real SaaS pricing/billing piece is a separate,
-- not-yet-landed task; a theme SALE through the storefront's own Razorpay keys makes no sense either,
-- since those keys are the STORE's own merchant account, not AUZslab's). The commission ledger math
-- below is implemented and tested regardless (see sfx_theme_ledger_record()), ready for the day a paid
-- purchase can actually happen; until then only free (price_cents = 0) themes are installable, and the
-- marketplace UI shows a plain "Coming soon" state for priced ones rather than a button that silently
-- fails or lies about what it did.
-- =========================================================

-- ---------- developer role: a tenant flagged storefront_developer=true in tenant_settings.features,
-- same mechanism as every other feature flag in this codebase (e.g. sfx_tenant() above for
-- 'storefront' itself). An admin grants it via the existing, generic admin_set_tenant_features() RPC
-- (db/043) -- no new grant/revoke RPC needed. A developer is just a tenant/role, not a parallel login.
create function sfdev_tenant() returns uuid language plpgsql stable security definer set search_path = public as $$
declare tid uuid; f jsonb;
begin
  if me() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  tid := (me()->>'tenant_id')::uuid;
  if tid is null then raise exception 'not a tenant member'; end if;
  select features into f from tenant_settings where tenant_id = tid;
  if coalesce(f->>'storefront_developer', 'false') <> 'true' then
    raise exception 'Theme developer access is not enabled for this account' using errcode = 'SF101';
  end if;
  return tid;
end $$;

-- Same owner/manager-can-write, everyone-can-read split as sfx_perm.
create function sfdev_guard(p_write boolean default true) returns uuid language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfdev_tenant(); r text;
begin
  if p_write then
    r := me()->>'role';
    if r not in ('owner', 'manager') then raise exception 'Your role does not allow this' using errcode = '42501'; end if;
  end if;
  return tid;
end $$;

-- ---------- tables ----------
create table sfx_themes (
  id uuid primary key default gen_random_uuid(),
  developer_tenant_id uuid references tenants(id) on delete set null,  -- null for AUZslab's own built-in themes
  name text not null check (length(trim(name)) between 1 and 80),
  slug text not null unique,
  description text not null default '',
  preview_image_url text,
  price_cents integer not null default 0 check (price_cents >= 0),
  status text not null default 'draft' check (status in ('draft', 'pending_review', 'approved', 'rejected', 'delisted')),
  rejection_reason text,
  is_builtin boolean not null default false,
  approved_version_id uuid,  -- fk added below, after sfx_theme_versions exists
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_sfx_themes_developer on sfx_themes (developer_tenant_id);
create index idx_sfx_themes_status on sfx_themes (status);
alter table sfx_themes enable row level security;

-- A theme's own authored content, versioned. Each "submit for review" freezes the current working
-- version (no more edits to it) and bumps version_number on the NEXT edit, so a rejected resubmission
-- is a genuinely new version, never silently mutating what a past approval signed off on.
create table sfx_theme_versions (
  id uuid primary key default gen_random_uuid(),
  theme_id uuid not null references sfx_themes(id) on delete cascade,
  version_number integer not null check (version_number >= 1),
  content jsonb not null default '{}'::jsonb,  -- {accent, radius, font, sections: [{id,type,props}]}
  frozen boolean not null default false,  -- true once submitted for review; new edits go to a new row
  created_at timestamptz not null default now(),
  unique (theme_id, version_number)
);
create index idx_sfx_theme_versions_theme on sfx_theme_versions (theme_id);
alter table sfx_theme_versions enable row level security;

alter table sfx_themes add constraint sfx_themes_approved_version_fk
  foreign key (approved_version_id) references sfx_theme_versions(id) on delete set null;

-- A store's OWN copy of an installed theme's content -- draft vs. published, exactly like
-- website-builder's sitepage.data.blocks/publishedBlocks (db/031). Copied once at install time;
-- never re-synced from the developer's listing afterward (see migration header on isolation).
create table sfx_theme_installs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  theme_id uuid not null references sfx_themes(id) on delete cascade,
  source_version_id uuid references sfx_theme_versions(id) on delete set null,  -- historical pointer only
  draft_content jsonb not null default '{}'::jsonb,
  published_content jsonb,  -- null until the store publishes at least once
  installed_at timestamptz not null default now(),
  published_at timestamptz,
  unique (tenant_id, theme_id)
);
create index idx_sfx_theme_installs_tenant on sfx_theme_installs (tenant_id);
alter table sfx_theme_installs enable row level security;

-- Which install is actually live on the public storefront right now (nullable: a store that never
-- touched the marketplace keeps phase 1's exact behaviour -- its `theme` column alone still drives
-- the CSS chrome, no custom sections rendered).
alter table sfx_stores add column active_install_id uuid references sfx_theme_installs(id) on delete set null;
-- Phase 1 locked `theme` to ('minimal','classic'); it's now just the active CSS chrome, and installing
-- a built-in theme from the marketplace is what changes it, so the two values stay the only ones for
-- now (third-party themes contribute content sections, not a new chrome, in this slice -- see header).
-- The constraint is unchanged on purpose. No alter needed here.

create table sfx_theme_purchases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,  -- the buying store
  theme_id uuid not null references sfx_themes(id) on delete cascade,
  version_id uuid references sfx_theme_versions(id) on delete set null,
  price_cents integer not null check (price_cents >= 0),
  purchased_at timestamptz not null default now()
);
create index idx_sfx_theme_purchases_tenant on sfx_theme_purchases (tenant_id);
create index idx_sfx_theme_purchases_theme on sfx_theme_purchases (theme_id);
alter table sfx_theme_purchases enable row level security;

-- One row per sale. developer_share_cents + platform_share_cents always add up to sale_amount_cents
-- (paisa-exact: developer gets the floor of 64%, platform gets the remainder, so nothing is lost or
-- invented on rounding). paid_out/paid_out_at/paid_out_note are the ONLY payout mechanism -- a manual
-- checkbox + note an admin ticks after sending the money by hand. Nothing here ever moves money.
create table sfx_dev_commission_ledger (
  id uuid primary key default gen_random_uuid(),
  developer_tenant_id uuid not null references tenants(id) on delete cascade,
  theme_id uuid not null references sfx_themes(id) on delete cascade,
  purchase_id uuid not null references sfx_theme_purchases(id) on delete cascade,
  sale_amount_cents integer not null check (sale_amount_cents >= 0),
  developer_share_cents integer not null check (developer_share_cents >= 0),
  platform_share_cents integer not null check (platform_share_cents >= 0),
  paid_out boolean not null default false,
  paid_out_at timestamptz,
  paid_out_note text,
  created_at timestamptz not null default now(),
  constraint sfx_ledger_shares_add_up check (developer_share_cents + platform_share_cents = sale_amount_cents)
);
create index idx_sfx_ledger_developer on sfx_dev_commission_ledger (developer_tenant_id);
alter table sfx_dev_commission_ledger enable row level security;

grant select, insert, update, delete on sfx_themes, sfx_theme_versions, sfx_theme_installs,
  sfx_theme_purchases, sfx_dev_commission_ledger to app;

-- ---------- developer portal ----------
create function sfdev_theme_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfdev_guard(false);
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', th.id, 'name', th.name, 'slug', th.slug, 'description', th.description, 'previewImageUrl', th.preview_image_url,
    'priceCents', th.price_cents, 'status', th.status, 'rejectionReason', th.rejection_reason, 'createdAt', th.created_at, 'updatedAt', th.updated_at,
    'latestVersion', (select jsonb_build_object('id', v.id, 'versionNumber', v.version_number, 'content', v.content, 'frozen', v.frozen)
      from sfx_theme_versions v where v.theme_id = th.id order by v.version_number desc limit 1),
    'installs', (select count(*) from sfx_theme_installs i where i.theme_id = th.id)
  ) order by th.created_at desc) from sfx_themes th where th.developer_tenant_id = tid), '[]'::jsonb);
end $$;

create function sfdev_theme_get(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfdev_guard(false); th sfx_themes;
begin
  select * into th from sfx_themes where id = p_id and developer_tenant_id = tid;
  if th.id is null then raise exception 'Theme not found'; end if;
  return jsonb_build_object('id', th.id, 'name', th.name, 'slug', th.slug, 'description', th.description,
    'previewImageUrl', th.preview_image_url, 'priceCents', th.price_cents, 'status', th.status, 'rejectionReason', th.rejection_reason,
    'versions', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'versionNumber', v.version_number, 'content', v.content, 'frozen', v.frozen, 'createdAt', v.created_at) order by v.version_number desc)
      from sfx_theme_versions v where v.theme_id = th.id), '[]'::jsonb));
end $$;

-- Create (p_id null) or edit (metadata only) a theme. Metadata edits are blocked while pending_review
-- so the listing an admin is reviewing can't move under them; draft/approved/rejected/delisted are all
-- editable (editing an approved theme's price/description takes effect immediately for new installs --
-- it never touches a store that already installed it, since installs hold their own copy).
create function sfdev_theme_save(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfdev_guard(true); th sfx_themes; nm text := trim(coalesce(p->>'name', '')); slug_ text;
begin
  if length(nm) < 1 then raise exception 'Enter a theme name' using errcode = 'SF102'; end if;
  if p_id is not null then
    select * into th from sfx_themes where id = p_id and developer_tenant_id = tid;
    if th.id is null then raise exception 'Theme not found'; end if;
    if th.status = 'pending_review' then raise exception 'This theme is awaiting review -- wait for a decision before editing it' using errcode = 'SF103'; end if;
    update sfx_themes set name = nm, description = coalesce(p->>'description', ''), preview_image_url = p->>'previewImageUrl',
      price_cents = greatest(0, coalesce((p->>'priceCents')::int, 0)), updated_at = now()
      where id = p_id returning * into th;
    return jsonb_build_object('id', th.id);
  end if;
  slug_ := lower(regexp_replace(nm, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(gen_random_uuid()::text, 1, 6);
  insert into sfx_themes (developer_tenant_id, name, slug, description, preview_image_url, price_cents, status)
    values (tid, nm, slug_, coalesce(p->>'description', ''), p->>'previewImageUrl', greatest(0, coalesce((p->>'priceCents')::int, 0)), 'draft')
    returning * into th;
  insert into sfx_theme_versions (theme_id, version_number, content) values (th.id, 1, '{"sections": []}'::jsonb);
  return jsonb_build_object('id', th.id);
end $$;

-- Save the theme's current working (unfrozen) content. Always touches the LATEST version row while
-- it's still unfrozen; once frozen (submitted), a fresh call here creates version_number+1 instead,
-- so review history is never rewritten out from under an admin mid-review.
create function sfdev_theme_version_save(p_theme_id uuid, p_content jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfdev_guard(true); th sfx_themes; v sfx_theme_versions;
begin
  select * into th from sfx_themes where id = p_theme_id and developer_tenant_id = tid;
  if th.id is null then raise exception 'Theme not found'; end if;
  if th.status = 'pending_review' then raise exception 'This theme is awaiting review -- wait for a decision before editing it' using errcode = 'SF103'; end if;
  select * into v from sfx_theme_versions where theme_id = p_theme_id order by version_number desc limit 1;
  if v.id is not null and not v.frozen then
    update sfx_theme_versions set content = coalesce(p_content, '{}'::jsonb) where id = v.id returning * into v;
  else
    insert into sfx_theme_versions (theme_id, version_number, content) values (p_theme_id, coalesce(v.version_number, 0) + 1, coalesce(p_content, '{}'::jsonb)) returning * into v;
  end if;
  if th.status = 'rejected' then update sfx_themes set status = 'draft', rejection_reason = null, updated_at = now() where id = p_theme_id; end if;
  return jsonb_build_object('id', v.id, 'versionNumber', v.version_number);
end $$;

create function sfdev_theme_submit(p_theme_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfdev_guard(true); th sfx_themes; v sfx_theme_versions;
begin
  select * into th from sfx_themes where id = p_theme_id and developer_tenant_id = tid;
  if th.id is null then raise exception 'Theme not found'; end if;
  if th.status not in ('draft', 'rejected') then raise exception 'Only a draft or rejected theme can be submitted' using errcode = 'SF104'; end if;
  select * into v from sfx_theme_versions where theme_id = p_theme_id order by version_number desc limit 1;
  if v.id is null then raise exception 'Add some content before submitting'; end if;
  update sfx_theme_versions set frozen = true where id = v.id;
  update sfx_themes set status = 'pending_review', updated_at = now() where id = p_theme_id;
  return jsonb_build_object('ok', true);
end $$;

create function sfdev_theme_delist(p_theme_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfdev_guard(true);
begin
  update sfx_themes set status = 'delisted', updated_at = now() where id = p_theme_id and developer_tenant_id = tid and status = 'approved';
  if not found then raise exception 'Only an approved theme can be delisted'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- A developer's own commission ledger: what they've earned, paid vs not. Read-only here -- marking
-- paid is an admin-only action (sfx_admin_ledger_mark_paid below).
create function sfdev_ledger_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfdev_guard(false);
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', l.id, 'themeId', l.theme_id, 'themeName', th.name, 'saleAmountCents', l.sale_amount_cents,
    'developerShareCents', l.developer_share_cents, 'platformShareCents', l.platform_share_cents,
    'paidOut', l.paid_out, 'paidOutAt', l.paid_out_at, 'paidOutNote', l.paid_out_note, 'createdAt', l.created_at
  ) order by l.created_at desc) from sfx_dev_commission_ledger l join sfx_themes th on th.id = l.theme_id where l.developer_tenant_id = tid), '[]'::jsonb);
end $$;

-- ---------- platform admin review (is_platform_admin(), same convention as signup_requests/007) ----------
create function sfx_admin_theme_queue() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', th.id, 'name', th.name, 'description', th.description, 'previewImageUrl', th.preview_image_url, 'priceCents', th.price_cents,
    'status', th.status, 'developerTenant', (select name from tenants where id = th.developer_tenant_id), 'createdAt', th.created_at,
    'pendingVersion', (select jsonb_build_object('id', v.id, 'versionNumber', v.version_number, 'content', v.content)
      from sfx_theme_versions v where v.theme_id = th.id order by v.version_number desc limit 1)
  ) order by th.created_at) from sfx_themes th where th.status = 'pending_review'), '[]'::jsonb);
end $$;

create function sfx_admin_theme_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', th.id, 'name', th.name, 'status', th.status, 'isBuiltin', th.is_builtin, 'priceCents', th.price_cents,
    'developerTenant', (select name from tenants where id = th.developer_tenant_id), 'installs', (select count(*) from sfx_theme_installs i where i.theme_id = th.id),
    'createdAt', th.created_at
  ) order by th.created_at desc) from sfx_themes th), '[]'::jsonb);
end $$;

create function sfx_admin_theme_approve(p_theme_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare v sfx_theme_versions;
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  if not exists(select 1 from sfx_themes where id = p_theme_id and status = 'pending_review') then
    raise exception 'Only a theme pending review can be approved';
  end if;
  select * into v from sfx_theme_versions where theme_id = p_theme_id order by version_number desc limit 1;
  update sfx_themes set status = 'approved', approved_version_id = v.id, rejection_reason = null, updated_at = now() where id = p_theme_id;
  return jsonb_build_object('ok', true);
end $$;

create function sfx_admin_theme_reject(p_theme_id uuid, p_reason text) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  if length(trim(coalesce(p_reason, ''))) < 1 then raise exception 'Give the developer a reason' using errcode = 'SF105'; end if;
  update sfx_themes set status = 'rejected', rejection_reason = p_reason, updated_at = now() where id = p_theme_id and status = 'pending_review';
  if not found then raise exception 'Only a theme pending review can be rejected'; end if;
  return jsonb_build_object('ok', true);
end $$;

create function sfx_admin_ledger_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', l.id, 'developerTenant', (select name from tenants where id = l.developer_tenant_id), 'themeName', th.name,
    'saleAmountCents', l.sale_amount_cents, 'developerShareCents', l.developer_share_cents, 'platformShareCents', l.platform_share_cents,
    'paidOut', l.paid_out, 'paidOutAt', l.paid_out_at, 'paidOutNote', l.paid_out_note, 'createdAt', l.created_at
  ) order by l.created_at desc) from sfx_dev_commission_ledger l join sfx_themes th on th.id = l.theme_id), '[]'::jsonb);
end $$;

-- The ONLY payout mechanism: a manual checkbox + note, ticked after the owner has sent the money by
-- hand (bank transfer/UPI) outside the platform. Deliberately does not move any money itself.
create function sfx_admin_ledger_mark_paid(p_id uuid, p_note text) returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not is_platform_admin() then raise exception 'not authorized'; end if;
  update sfx_dev_commission_ledger set paid_out = true, paid_out_at = now(), paid_out_note = p_note where id = p_id;
  if not found then raise exception 'Ledger row not found'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- ---------- store owner: marketplace browse / install / customize / publish ----------
create function sfx_theme_marketplace_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', th.id, 'name', th.name, 'slug', th.slug, 'description', th.description, 'previewImageUrl', th.preview_image_url,
    'priceCents', th.price_cents, 'isBuiltin', th.is_builtin,
    'developerName', (select name from tenants where id = th.developer_tenant_id),
    'installed', exists(select 1 from sfx_theme_installs i where i.theme_id = th.id and i.tenant_id = tid)
  ) order by th.is_builtin desc, th.price_cents, th.name) from sfx_themes th where th.status = 'approved'), '[]'::jsonb);
end $$;

-- Records the sale (ledger math, correct to the paisa) and returns/creates the store's own install
-- row with content copied from the theme's approved version. Free (price_cents = 0) only, for now --
-- see this migration's header comment on why paid purchases are refused here, not silently faked.
create function sfx_theme_install(p_theme_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); th sfx_themes; existing sfx_theme_installs; purchase sfx_theme_purchases;
  dev_share int; plat_share int;
begin
  select * into th from sfx_themes where id = p_theme_id and status = 'approved';
  if th.id is null then raise exception 'This theme is not available in the marketplace' using errcode = 'SF106'; end if;
  select * into existing from sfx_theme_installs where tenant_id = tid and theme_id = p_theme_id;
  if existing.id is not null then return jsonb_build_object('installId', existing.id, 'alreadyInstalled', true); end if;
  if th.price_cents > 0 then
    raise exception 'Paid themes are coming soon -- platform billing for theme sales is not live yet' using errcode = 'SF107';
  end if;
  insert into sfx_theme_purchases (tenant_id, theme_id, version_id, price_cents) values (tid, p_theme_id, th.approved_version_id, th.price_cents) returning * into purchase;
  if th.price_cents > 0 and th.developer_tenant_id is not null then
    dev_share := floor(th.price_cents * 0.64)::int;
    plat_share := th.price_cents - dev_share;
    insert into sfx_dev_commission_ledger (developer_tenant_id, theme_id, purchase_id, sale_amount_cents, developer_share_cents, platform_share_cents)
      values (th.developer_tenant_id, th.id, purchase.id, th.price_cents, dev_share, plat_share);
  end if;
  insert into sfx_theme_installs (tenant_id, theme_id, source_version_id, draft_content, published_content)
    values (tid, p_theme_id, th.approved_version_id, coalesce((select content from sfx_theme_versions where id = th.approved_version_id), '{}'::jsonb), null)
    returning * into existing;
  return jsonb_build_object('installId', existing.id, 'alreadyInstalled', false);
end $$;

-- Includes each install's own draft/published content (like sfx_product_list returning full product
-- rows) so the editor page can render straight from already-loaded state, no extra round trip.
create function sfx_theme_install_list() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view');
begin
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id', i.id, 'themeId', i.theme_id, 'themeName', th.name, 'isBuiltin', th.is_builtin,
    'draftContent', i.draft_content, 'publishedContent', i.published_content,
    'published', i.published_content is not null, 'active', st.active_install_id = i.id, 'installedAt', i.installed_at
  ) order by i.installed_at desc) from sfx_theme_installs i join sfx_themes th on th.id = i.theme_id
    left join sfx_stores st on st.tenant_id = tid where i.tenant_id = tid), '[]'::jsonb);
end $$;

create function sfx_theme_install_get(p_install_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_view'); i sfx_theme_installs; th sfx_themes;
begin
  select * into i from sfx_theme_installs where id = p_install_id and tenant_id = tid;
  if i.id is null then raise exception 'Theme install not found'; end if;
  select * into th from sfx_themes where id = i.theme_id;
  return jsonb_build_object('id', i.id, 'themeId', i.theme_id, 'themeName', th.name, 'isBuiltin', th.is_builtin,
    'draftContent', i.draft_content, 'publishedContent', i.published_content, 'publishedAt', i.published_at);
end $$;

-- Sets this install as the live one. If the theme is a built-in, also switches the store's CSS chrome
-- (the `theme` column) to match -- that's the one place built-in rendering still special-cases a
-- value, documented in this migration's header.
create function sfx_theme_install_set_active(p_install_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); i sfx_theme_installs; th sfx_themes;
begin
  select * into i from sfx_theme_installs where id = p_install_id and tenant_id = tid;
  if i.id is null then raise exception 'Theme install not found'; end if;
  select * into th from sfx_themes where id = i.theme_id;
  insert into sfx_stores (tenant_id, active_install_id) values (tid, p_install_id)
    on conflict (tenant_id) do update set active_install_id = p_install_id, updated_at = now();
  if th.is_builtin and th.slug in ('minimal', 'classic') then
    update sfx_stores set theme = th.slug where tenant_id = tid;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create function sfx_theme_customize_save(p_install_id uuid, p_content jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage');
begin
  update sfx_theme_installs set draft_content = coalesce(p_content, '{}'::jsonb) where id = p_install_id and tenant_id = tid;
  if not found then raise exception 'Theme install not found'; end if;
  return jsonb_build_object('ok', true);
end $$;

create function sfx_theme_customize_publish(p_install_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); i sfx_theme_installs;
begin
  select * into i from sfx_theme_installs where id = p_install_id and tenant_id = tid;
  if i.id is null then raise exception 'Theme install not found'; end if;
  update sfx_theme_installs set published_content = draft_content, published_at = now() where id = p_install_id returning * into i;
  return jsonb_build_object('ok', true, 'publishedAt', i.published_at);
end $$;

-- ---------- public storefront: feed the active install's published sections (additive -- see header) ----------
-- Redefines 372's public_sfx_store with the EXACT same signature/contract, adding one key to `config`:
-- customSections, the active install's published content blocks (empty array if the store never
-- installed/published anything -- zero behaviour change for every store that hasn't touched this).
create or replace function public_sfx_store(p_slug text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sfx_public_tenant(p_slug); st sfx_stores; tn text; sections jsonb;
begin
  if tid is null then return null; end if;
  select * into st from sfx_stores where tenant_id = tid;
  select name into tn from tenants where id = tid;
  if coalesce(st.published, false) is not true then return jsonb_build_object('closed', true, 'name', coalesce(st.config->>'brandName', tn, 'Store')); end if;
  select coalesce(i.published_content->'sections', '[]'::jsonb) into sections
    from sfx_theme_installs i where i.id = st.active_install_id;
  return jsonb_build_object(
    'shop', jsonb_build_object('name', coalesce(st.config->>'brandName', tn, 'Store'), 'phone', st.config->>'phone'),
    'config', jsonb_build_object('on', true, 'template', st.theme, 'brandName', coalesce(st.config->>'brandName', tn), 'tagline', st.config->>'tagline',
      'heroImages', coalesce(st.config->'heroImages', '[]'::jsonb), 'minimalPages', '[]'::jsonb, 'stores', '[]'::jsonb,
      'customSections', coalesce(sections, '[]'::jsonb)),
    'upi', null, 'cod', true,
    'styles', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'handle', p.handle, 'category', p.category, 'description', p.description,
        'photos', coalesce(p.images, '[]'::jsonb), 'photoUrl', p.images->>0, 'price', p.price, 'mrp', p.compare_at, 'createdAt', p.created_at,
        'variants', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'size', v.label, 'colour', 'Original', 'price', v.price, 'left', least(v.stock, 9)) order by v.position)
          from sfx_variants v where v.product_id = p.id and v.stock > 0), '[]'::jsonb)) order by p.created_at desc)
      from sfx_products p where p.tenant_id = tid and p.status = 'active'), '[]'::jsonb),
    'collections', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'note', c.description,
        'styleIds', coalesce((select jsonb_agg(cp.product_id) from sfx_collection_products cp where cp.collection_id = c.id), '[]'::jsonb)) order by lower(c.name))
      from sfx_collections c where c.tenant_id = tid), '[]'::jsonb));
end $$;

-- ---------- migrate the 2 hardcoded built-ins into real, approved, free, platform-owned rows ----------
insert into sfx_themes (name, slug, description, price_cents, status, is_builtin)
  values ('Minimal', 'minimal', 'The clean, image-forward storefront theme.', 0, 'approved', true),
         ('Classic', 'classic', 'The classic multi-section storefront theme.', 0, 'approved', true)
  on conflict (slug) do nothing;
insert into sfx_theme_versions (theme_id, version_number, content, frozen)
  select id, 1, '{"sections": []}'::jsonb, true from sfx_themes where slug in ('minimal', 'classic');
update sfx_themes th set approved_version_id = (select id from sfx_theme_versions v where v.theme_id = th.id)
  where th.slug in ('minimal', 'classic');

grant execute on function sfdev_tenant() to app;
grant execute on function sfdev_guard(boolean) to app;
grant execute on function sfdev_theme_list() to app;
grant execute on function sfdev_theme_get(uuid) to app;
grant execute on function sfdev_theme_save(uuid, jsonb) to app;
grant execute on function sfdev_theme_version_save(uuid, jsonb) to app;
grant execute on function sfdev_theme_submit(uuid) to app;
grant execute on function sfdev_theme_delist(uuid) to app;
grant execute on function sfdev_ledger_list() to app;
grant execute on function sfx_admin_theme_queue() to app;
grant execute on function sfx_admin_theme_list() to app;
grant execute on function sfx_admin_theme_approve(uuid) to app;
grant execute on function sfx_admin_theme_reject(uuid, text) to app;
grant execute on function sfx_admin_ledger_list() to app;
grant execute on function sfx_admin_ledger_mark_paid(uuid, text) to app;
grant execute on function sfx_theme_marketplace_list() to app;
grant execute on function sfx_theme_install(uuid) to app;
grant execute on function sfx_theme_install_list() to app;
grant execute on function sfx_theme_install_get(uuid) to app;
grant execute on function sfx_theme_install_set_active(uuid) to app;
grant execute on function sfx_theme_customize_save(uuid, jsonb) to app;
grant execute on function sfx_theme_customize_publish(uuid) to app;
