-- Customer bill links are short main-site links (https://auzslab.in/b/<code>); only a shop's own WEBSITE pages stay on its own address.
-- wa_tenant_link is the one place the automatic WhatsApp messages build a link, so the change is here.
create or replace function wa_tenant_link(p_tenant uuid, p_path text) returns text
language plpgsql stable security definer set search_path = public as $$
declare slug text; tok text;
begin
  -- a bill: the short main-site link
  if p_path ~ '^/(bill|mobbill)\.html\?t=[A-Za-z0-9]+$' then return wa_site_url() || '/b/' || split_part(p_path, '=', 2); end if;
  if p_path ~ '^/b/[A-Za-z0-9]+$' then return wa_site_url() || p_path; end if;
  if p_path ~ '^/i\.html\?o=' then
    tok := split_part(p_path, '=', 2);
    -- a POS order with a share code gets the short link; an old order number (no code) goes straight to the page on the hub address
    if exists (select 1 from records where kind = 'order' and tenant_id = p_tenant and data->>'tok' = tok) then return wa_site_url() || '/b/' || tok; end if;
    return regexp_replace(wa_site_url(), '^(https?://)', '\1app.') || p_path;
  end if;
  -- everything else (the shop's website pages) stays on the shop's own address
  select t.slug into slug from tenants t where t.id = p_tenant;
  if slug is null then return null; end if;
  return regexp_replace(wa_site_url(), '^(https?://)', '\1' || slug || '.') || p_path;
end $$;
-- Rollback: re-run db/190_wa_sale_invoice_links.sql's wa_tenant_link.
