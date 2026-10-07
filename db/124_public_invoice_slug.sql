-- The shared public invoice page (app/public/i.html) is one template used by every
-- tenant, reached by WhatsApp-sharing a real bill from the POS. It already re-themes
-- itself from settings.brand (colours/font/doodle), but has no way to tell WHICH
-- tenant it's rendering for -- so a genuinely bespoke invoice layout (built as its own
-- one-off page, app/public/chapterone/invoice.html, for the Chapter One client) only
-- ever shows up on that tenant's own bespoke website, never on the real POS's
-- WhatsApp-shared bill, which always renders the generic template regardless of tenant.
-- Adding the tenant's own slug to public_invoice()'s result lets i.html branch its
-- render for one specific tenant without a second page or a new settings field --
-- every other tenant's cfg/brand-driven render is completely unchanged.
create or replace function public_invoice(oid text) returns jsonb language sql security definer stable set search_path = public as $$
  select jsonb_build_object(
    'order', (select data from records where kind = 'order' and not deleted and data->>'tok' = oid order by (data->>'paidAt') desc nulls last limit 1),
    'cfg', coalesce((
      select s.data
      from records r
      join records s on s.tenant_id = r.tenant_id and s.kind = 'settings' and s.id = 'settings'
      where r.kind = 'order' and r.data->>'tok' = oid limit 1
    ), '{}'::jsonb),
    'slug', (
      select t.slug
      from records r
      join tenants t on t.id = r.tenant_id
      where r.kind = 'order' and r.data->>'tok' = oid limit 1
    )
  )
$$;
-- callable by anyone -- see public_invoice's own original comment in db/002_core_engine.sql.
