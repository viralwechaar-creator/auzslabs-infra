-- Restaurant open / closed master switch (admin console). settings.storeOpen = false means closed.
-- QR (table) and website takeaway orders are refused by the database itself, so a printed QR code or an old link cannot be used
-- while the restaurant is closed. Orders from Swiggy / Zomato arrive on their own tablets and cannot be stopped from here
-- (there is no integration); the console blocks entering them by hand and reminds the owner to pause them in those apps.
create or replace function place_order(tenant_slug text, t text, n text, p text, nt text, its jsonb) returns void language plpgsql security definer set search_path = public as $$
declare cnt int; tid uuid; on_ boolean; open_ text;
begin
  select id into tid from tenants where slug = tenant_slug;
  if tid is null then raise exception 'unknown tenant'; end if;

  select coalesce(ts.features->>'self_order','false')::boolean
     and coalesce(ts.enabled_features->>'self_order','true')::boolean
    into on_ from tenant_settings ts where ts.tenant_id = tid;
  if not coalesce(on_, false) then
    raise exception 'self-order is currently turned off for this business';
  end if;

  select r.data->>'storeOpen' into open_ from records r where r.tenant_id = tid and r.kind = 'settings' and r.id = 'settings' and not r.deleted;
  if open_ = 'false' then
    raise exception 'The restaurant is closed right now, so we are not taking orders. Please try again when we open.';
  end if;

  select count(*) into cnt from guest_orders where tenant_id = tid and tbl = t and status = 'new' and created_at > now() - interval '30 minutes';
  if cnt >= 5 then raise exception 'busy: too many pending orders for this table'; end if;

  insert into guest_orders (tenant_id, tbl, name, phone, note, items) values (tid, t, n, p, nt, its);
end;
$$;
