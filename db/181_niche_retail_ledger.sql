-- Gym is removed; Retail and General become ONE niche, 'retail' ("Retail / General"),
-- whose product is AUZsLedger (feature 'accounting') -- no POS, no CRM.
-- Existing tenants/leads are only relabelled; their features are NOT touched.
-- 'gym' and 'general' preset rows stay as hidden aliases so older functions that
-- still default to p_niche = 'general' keep working; a trigger stores them as 'retail'.

create or replace function niche_normalise() returns trigger language plpgsql as $$
begin
  if new.niche in ('gym', 'general') then new.niche := 'retail'; end if;
  return new;
end $$;

alter table tenants drop constraint if exists tenants_niche_check;
drop trigger if exists tenants_niche_normalise on tenants;
update tenants set niche = 'retail' where niche in ('gym', 'general');
alter table tenants add constraint tenants_niche_check check (niche in ('cafe', 'salon', 'retail', 'mobile', 'custom'));
create trigger tenants_niche_normalise before insert or update of niche on tenants
  for each row execute function niche_normalise();

update leads set niche = 'retail' where niche in ('gym', 'general');

update niche_presets set
  default_features = '{"booking": false, "crm": false, "billing": false, "pos": false, "accounting": true}'::jsonb,
  default_business_rules = default_business_rules || '{"bizType": "retail"}'::jsonb
where niche in ('retail', 'general', 'gym');
