-- Online (QR table / takeaway website) customers could only ever learn their bill had been billed through
-- a WhatsApp message (db/190's invoice_link trigger) -- which depends on WhatsApp actually being configured
-- and the owner's wa_tenant_settings.enabled switch being on; with either dormant, a customer who placed a
-- real order online had no way at all to see their own invoice. Owner request: let the customer open their
-- bill directly on the website instead of only through WhatsApp.
--
-- The shared public_invoice(oid) RPC (db/002/db/124) already finds a real `records` order by its own
-- random `tok` -- the missing piece is simply that a guest_orders row (the thing `place_order` actually
-- creates) never had a token of its own, and place_order returned nothing for the browser to remember.
-- Fix: give guest_orders its own `tok` (same 12-hex-char shape pos/core.js's own `tok()` helper already
-- uses for a paid order), have place_order hand it back to the caller, and have the POS carry that same
-- token into the real order it creates when staff accept the guest order (pos/shell.js's acceptG()) --
-- so the one link the customer was given the moment they ordered keeps working, with no second token and
-- no server round-trip needed once the bill is actually ready.
alter table guest_orders add column if not exists tok text not null default encode(gen_random_bytes(6), 'hex');
create unique index if not exists idx_guest_orders_tok on guest_orders (tok);

-- place_order's return type changes from void to text (the new token) -- Postgres refuses to change a
-- function's return type via `create or replace`, so the old definition must be dropped first (same
-- workaround this file has needed before for an identical reason, e.g. db/145/db/146's own comment).
drop function if exists place_order(text, text, text, text, text, jsonb);
create function place_order(tenant_slug text, t text, n text, p text, nt text, its jsonb) returns text language plpgsql security definer set search_path = public as $$
declare cnt int; tid uuid; on_ boolean; open_ text; newtok text;
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

  insert into guest_orders (tenant_id, tbl, name, phone, note, items) values (tid, t, n, p, nt, its) returning tok into newtok;
  return newtok;
end;
$$;
-- callable by anyone -- see note above.
