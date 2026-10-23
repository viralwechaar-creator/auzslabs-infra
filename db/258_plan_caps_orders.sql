-- Plan limits (db/257) also cover the website ordering of a business whose plan has no online store:
-- place_order (QR table + takeaway website, classic and Kiln) is refused with a plain upgrade message.
do $$ begin
  if exists (select 1 from pg_proc where proname = 'place_order') and not exists (select 1 from pg_proc where proname = 'place_order_core') then
    alter function place_order(text, text, text, text, text, jsonb) rename to place_order_core;
  end if;
end $$;
create or replace function place_order(tenant_slug text, t text, n text, p text, nt text, its jsonb) returns text
language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  select id into tid from tenants where slug = tenant_slug;
  if tid is not null and not tenant_cap(tid, 'online_store') then
    raise exception 'Online ordering is not part of this business''s plan. Please order at the counter.';
  end if;
  return place_order_core(tenant_slug, t, n, p, nt, its);
end $$;
