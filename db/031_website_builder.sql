-- =========================================================
-- Website Builder: a new sellable product (like POS/CRM/Payroll), sold
-- and gated the same way (tenant_settings.features.website_builder,
-- checked client-side in builder.html/w.html the same way index.html
-- checks featureOn()).
--
-- Pages are just another `records` kind -- 'sitepage', keyed by a
-- slug ('home', 'about', ...) -- not a new table. This matches the
-- generic-engine philosophy (a new concept is a new `kind`, not a new
-- table) and means it's already covered by every layer that matters
-- with zero extra work:
--   - r_read (db/002): any authenticated tenant staffer can read any
--     kind, including 'sitepage' -- builder.html needs nothing new here.
--   - r_ins/r_upd + push_record (db/028's version, the latest): the
--     `(me()->>'role') = 'owner'` catch-all already authorizes an
--     owner to write ANY kind not otherwise special-cased -- 'sitepage'
--     falls through to that, so owners can already save pages with zero
--     changes to either. (Deliberately owner-only for now -- staff
--     shouldn't be able to redesign the public site; if that needs to
--     change later, add 'sitepage' to the explicit kind list the same
--     way db/019 added 'kotlog'.)
--
-- The one thing that's actually new is public, unauthenticated read
-- access for the published site (RLS requires a logged-in tenant
-- member, same as public_menu/public_invoice needed their own
-- SECURITY DEFINER functions for the exact same reason) -- hence
-- public_page() below.
--
-- Draft vs. published: a page's `data.blocks` is the owner's working
-- draft (saved continuously via the normal push_record path, same as
-- any other record); `data.publishedBlocks` is a snapshot copied from
-- `blocks` only when the owner clicks Publish in builder.html. The
-- public site (w.html, via public_page) only ever reads
-- publishedBlocks, never blocks -- so a half-finished edit never goes
-- live, and "Publish" is a real, meaningful action rather than
-- decoration.
-- =========================================================

create function public_page(tenant_slug text, page_slug text default 'home')
returns jsonb language sql security definer stable set search_path = public as $$
  select jsonb_build_object(
    'page', (
      select jsonb_build_object(
        'title', coalesce(r.data->>'title', ''),
        'slug', r.data->>'slug',
        'blocks', coalesce(r.data->'publishedBlocks', '[]'::jsonb)
      )
      from records r
      join tenants t on t.id = r.tenant_id
      where t.slug = tenant_slug and r.kind = 'sitepage' and r.id = page_slug
        and not r.deleted and r.data ? 'publishedBlocks'
    ),
    'pages', coalesce((
      select jsonb_agg(jsonb_build_object('slug', r.data->>'slug', 'title', r.data->>'title') order by r.data->>'title')
      from records r
      join tenants t on t.id = r.tenant_id
      where t.slug = tenant_slug and r.kind = 'sitepage' and not r.deleted and r.data ? 'publishedBlocks'
    ), '[]'::jsonb),
    'cfg', coalesce((
      select r.data
      from records r
      join tenants t on t.id = r.tenant_id
      where t.slug = tenant_slug and r.kind = 'settings' and r.id = 'settings'
    ), '{}'::jsonb)
  )
$$;
-- callable by anyone -- same rationale as public_menu/public_invoice.
