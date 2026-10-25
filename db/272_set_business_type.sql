-- Business type, one source of truth for the owner (fixes drift between tenants.niche and settings.bizType).
-- Before: Settings -> Configuration -> Business type wrote only settings.bizType (how the POS behaves) and offered
-- restaurant / salon / retail, so it could disagree with tenants.niche (the business category) and had no "mobile".
-- Now the owner picks a registry business type (db/270) and set_business_type() writes BOTH from that one row:
--   tenants.niche = registry niche, settings.bizType = registry pos_mode.
-- Refused: salon / custom-built / demo businesses (set up by our team), non-active types, and anyone but the owner.
-- No backfill: existing tenants are untouched until their owner saves a choice. Whole file is one transaction; safe to run twice.
-- ROLLBACK: drop function if exists set_business_type(text); drop function if exists my_business_type();
begin;

create or replace function my_business_type() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tid uuid; t tenants%rowtype; cur business_types%rowtype; locked boolean; types jsonb;
begin
  tid := (me()->>'tenant_id')::uuid;
  if tid is null then raise exception 'sign in first'; end if;
  select * into t from tenants where id = tid;
  if not found then raise exception 'unknown business'; end if;
  locked := t.niche in ('salon', 'custom') or coalesce(t.build_type, '') = 'custom' or coalesce(t.is_demo, false);
  select * into cur from business_types where niche = t.niche and status = 'active' order by sort, key limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('key', key, 'label', label, 'description', description, 'pos_mode', pos_mode) order by sort, key), '[]'::jsonb)
    into types from business_types where status = 'active' and niche <> 'salon';
  return jsonb_build_object('key', cur.key, 'label', cur.label, 'niche', t.niche, 'locked', locked,
    'can_change', (me()->>'role') = 'owner' and not locked, 'types', types);
end $$;

create or replace function set_business_type(p_key text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tid uuid; t tenants%rowtype; bt business_types%rowtype;
begin
  if (me()->>'role') is distinct from 'owner' then raise exception 'Only the owner can change the business type.'; end if;
  tid := (me()->>'tenant_id')::uuid;
  select * into t from tenants where id = tid;
  if not found then raise exception 'unknown business'; end if;
  if t.niche in ('salon', 'custom') or coalesce(t.build_type, '') = 'custom' or coalesce(t.is_demo, false) then
    raise exception 'The business type of this business is set up by AUZslab. Please contact us to change it.';
  end if;
  select * into bt from business_types where key = coalesce(p_key, '');
  if not found or bt.status <> 'active' or bt.niche = 'salon' then raise exception 'That business type is not available.'; end if;
  update tenants set niche = bt.niche where id = tid;
  insert into records (id, tenant_id, kind, data) values ('settings', tid, 'settings', jsonb_build_object('bizType', bt.pos_mode))
    on conflict (tenant_id, id) do update set data = records.data || jsonb_build_object('bizType', bt.pos_mode);
  return my_business_type();
end $$;

commit;
