-- =========================================================
-- Back Office (app/public/backoffice.html) is being retired in favour of the
-- Admin Console (app/public/console/) -- its own, separate ingredient-PO flow
-- (supplierModal/poModal) wrote kind='supplier' records, a concept the
-- console never had: console's vendor/purchase pages (p-inventory.js) only
-- ever read kind='vendor'. Before backoffice.html is deleted, merge any
-- existing supplier records into vendor records (matched by name, case/
-- whitespace-insensitive, per tenant) so nothing a client already entered
-- becomes invisible. po/purchase records reference a vendor by its NAME
-- string, not a foreign key (confirmed in both backoffice.html's poModal
-- and console's p-inventory.js poForm/vendorForm), so a fresh vendor id is
-- fine -- only the name has to exist.
-- =========================================================

do $$
declare
  sup record;
  existing_vendor boolean;
begin
  for sup in
    select id, tenant_id, data from records
    where kind = 'supplier' and not deleted
  loop
    select exists(
      select 1 from records
      where tenant_id = sup.tenant_id and kind = 'vendor' and not deleted
        and lower(trim(data->>'name')) = lower(trim(sup.data->>'name'))
    ) into existing_vendor;

    if not existing_vendor and coalesce(trim(sup.data->>'name'), '') <> '' then
      insert into records (id, tenant_id, kind, data)
      values (
        gen_random_uuid()::text,
        sup.tenant_id,
        'vendor',
        jsonb_build_object(
          'name', sup.data->>'name',
          'phone', sup.data->>'phone',
          'notes', sup.data->>'notes'
        )
      );
    end if;

    -- superseded either way (merged just now, or a same-name vendor already existed) --
    -- soft delete, matching this app's own convention (save(kind,data,id,true)), never a hard delete.
    update records set deleted = true, updated_at = now() where tenant_id = sup.tenant_id and id = sup.id;
  end loop;
end $$;
