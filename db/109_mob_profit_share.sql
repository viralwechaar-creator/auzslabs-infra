-- AUZsMob: optional profit sharing. features.profitSharePct (0-100, default off) is the percentage of each
-- staffer's profit that goes to the shop owner; the rest stays with the staffer. Display/report only: it does not
-- change any sale, cost or stock figure. Only mob_save_settings changes (based on db/105, the latest definition).
create or replace function mob_save_settings(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; fk text; fv jsonb; old_features jsonb;
begin
  tid := mob_guard('mob_manage');
  if p ? 'features' then
    if (me()->>'role') <> 'owner' then raise exception 'Only the owner can change features' using errcode = '42501'; end if;
    if jsonb_typeof(p->'features') <> 'object' then raise exception 'features must be an object' using errcode = 'MB005'; end if;
    for fk, fv in select * from jsonb_each(p->'features') loop
      if fk = 'repairs' then
        if fv #>> '{}' not in ('off', 'simple', 'full') then raise exception 'repairs must be off, simple or full' using errcode = 'MB005'; end if;
      elsif fk = 'profitSharePct' then
        -- % of each staffer's profit that goes to the shop owner; 0 = off
        if jsonb_typeof(fv) <> 'number' or (fv #>> '{}')::numeric < 0 or (fv #>> '{}')::numeric > 100 then
          raise exception 'profitSharePct must be a number from 0 to 100' using errcode = 'MB005';
        end if;
      elsif fk = 'nav' then
        -- Owner-chosen menu buttons, in order. Only a list of known section ids (plus 'more'); no duplicates.
        if jsonb_typeof(fv) <> 'array' or jsonb_array_length(fv) > 8
           or exists (select 1 from jsonb_array_elements_text(fv) e where e not in ('home','sell','repairs','stock','reports','dues','settings','more'))
           or (select count(*) <> count(distinct e) from jsonb_array_elements_text(fv) e) then
          raise exception 'nav must be a short list of menu sections' using errcode = 'MB005';
        end if;
      elsif fk in ('sell', 'purchase', 'stock', 'serials', 'customers', 'vendors', 'dayclose') then
        if jsonb_typeof(fv) <> 'boolean' then raise exception '% must be on or off', fk using errcode = 'MB005'; end if;
      else
        raise exception 'unknown feature %', fk using errcode = 'MB005';
      end if;
    end loop;
    old_features := mob_features(tid);
    update mob_settings set features = old_features || (p->'features'), updated_at = now() where tenant_id = tid;
    perform mob_audit_log(tid, 'mob_settings', tid, 'features', old_features, mob_features(tid));
  end if;
  update mob_settings set
    shop_name = coalesce(p->>'shopName', shop_name), address = coalesce(p->>'address', address),
    phone = coalesce(p->>'phone', phone), logo_url = coalesce(p->>'logoUrl', logo_url),
    bill_footer = coalesce(p->>'billFooter', bill_footer), bill_prefix = coalesce(p->>'billPrefix', bill_prefix),
    language = coalesce(p->>'language', language),
    staff_see_purchase_rates = coalesce((p->>'staffSeePurchaseRates')::boolean, staff_see_purchase_rates),
    day_close_date = case when p ? 'dayCloseDate' then nullif(p->>'dayCloseDate', '')::date else day_close_date end,
    updated_at = now()
  where tenant_id = tid;
  return mob_context();
end $$;
