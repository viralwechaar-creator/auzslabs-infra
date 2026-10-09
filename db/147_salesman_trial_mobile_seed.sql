-- =========================================================
-- Salesman trials follow the business type.
-- A mobile-shop trial opens AUZsMob (not the cafe POS). mob_trial_seed() gives such a
-- trial a small working shop (phones, an accessory, one sale on credit, one open repair)
-- the first time it is opened. Only runs when the shop has no items yet, so a salesman's
-- own entries are never wiped. Called by the API (/admin/salesman-open-pos), deliberately
-- NOT registered in the public RPC list.
-- =========================================================
create or replace function mob_trial_seed(p_tid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  if not exists (select 1 from tenants where id = p_tid and is_trial and niche = 'mobile') then return; end if;
  if exists (select 1 from mob_items where tenant_id = p_tid) then return; end if;
  perform mob_demo_seed(p_tid);
  select name into nm from tenants where id = p_tid;
  update mob_settings set shop_name = coalesce(nm, shop_name), demo_seeded_at = null where tenant_id = p_tid;
end $$;
