-- AUZslab SalesOS: sos_lead_create used to let the unique index idx_sos_leads_one_active
-- raise a raw "duplicate key value violates unique constraint ..." error straight to the
-- client. Found while writing the automated test suite (tests/suites/local/salesos.mjs).
-- Add a friendly pre-check, matching every other sos_* function's style.
create or replace function sos_lead_create(p_business uuid, p_product text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_field'); row sos_leads%rowtype;
begin
  if not exists (select 1 from sos_businesses where id = p_business and tenant_id = tid) then raise exception 'business not found'; end if;
  if exists (select 1 from sos_leads where tenant_id = tid and business_id = p_business and coalesce(product, '') = coalesce(p_product, '') and stage not in ('won', 'lost')) then
    raise exception 'There is already an active lead for this business and product';
  end if;
  insert into sos_leads (tenant_id, business_id, product, owner_id, created_by) values (tid, p_business, p_product, app_uid(), app_uid())
  returning * into row;
  insert into sos_lead_notes (lead_id, author, kind, body) values (row.id, app_uid(), 'created', 'Lead created');
  return sos_lead_json(row);
end $$;
