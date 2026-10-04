-- =========================================================
-- AUZsMob: the staff accountability ledger. Owner request, stated directly: in a real mobile shop, the
-- staffer who runs the counter often buys stock cheap and tells the owner they paid more, or sells a
-- phone high and tells the owner they sold it for less -- pocketing the gap either way. The fix isn't
-- another dashboard number; it's one table, one row per thing sold, showing the full chain: who bought it,
-- from whom, for how much -- who sold it, to whom, for how much -- and the profit that chain actually
-- produced, with a grand total at the end. Nothing here is staff-editable after the fact: every figure is
-- read straight from mob_purchases/mob_sales, which are themselves append-only (db/080's own header).
--
-- Serialized units (phones, by IMEI) trace exactly: mob_purchases.unit_id = the same unit later sold, so
-- the vendor, purchase rate and the staffer who entered the purchase are pulled from that one purchase row.
-- Non-serialized stock (accessories) has no single matching purchase -- it's fungible, bought in batches --
-- so those rows show no vendor/purchase-staff, but the cost figure is still the real cost_price snapshot
-- mob_push_sale took at the moment of sale (see 081), never something a staffer can edit after the fact.
-- =========================================================
create or replace function mob_report_ledger(p_from date default null, p_to date default null, p_staff_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; from_ts timestamptz; to_ts timestamptz; rows jsonb;
begin
  tid := mob_guard('mob_reports');
  from_ts := coalesce(p_from, current_date - 29)::timestamptz;
  to_ts := coalesce(p_to, current_date)::timestamptz + interval '1 day';

  select coalesce(jsonb_agg(x order by x->>'sold_at' desc), '[]'::jsonb) into rows from (
    select jsonb_build_object(
      'sale_id', s.id,
      'bill_no', s.bill_no,
      'sold_at', s.created_at,
      'item_name', it->>'name',
      'imei', u.imei,
      'qty', coalesce((it->>'qty')::numeric, 1),
      'sale_price', (it->>'price')::numeric,
      'sale_total', round((it->>'price')::numeric * coalesce((it->>'qty')::numeric, 1), 2),
      'cost_price', (it->>'costPrice')::numeric,
      'cost_total', round(coalesce((it->>'costPrice')::numeric, 0) * coalesce((it->>'qty')::numeric, 1), 2),
      'profit', round(((it->>'price')::numeric - coalesce((it->>'costPrice')::numeric, 0)) * coalesce((it->>'qty')::numeric, 1), 2),
      'customer_name', coalesce(nullif(s.customer_name, ''), 'Walk-in'),
      'sold_by_id', s.staff_id,
      'sold_by', coalesce(nullif(sp.name, ''), sp.email),
      'vendor_name', v.name,
      'purchased_at', pu.created_at,
      'purchased_by_id', pu.staff_id,
      'purchased_by', coalesce(nullif(pp.name, ''), pp.email)
    ) x
    from mob_sales s
    cross join lateral jsonb_array_elements(s.items) it
    left join mob_item_units u on u.id = nullif(it->>'unitId', '')::uuid
    left join mob_purchases pu on pu.unit_id = u.id and pu.tenant_id = tid
    left join mob_vendors v on v.id = pu.vendor_id
    left join profiles pp on pp.id = pu.staff_id
    left join profiles sp on sp.id = s.staff_id
    where s.tenant_id = tid and not s.voided
      and s.created_at >= from_ts and s.created_at < to_ts
      and (p_staff_id is null or s.staff_id = p_staff_id or pu.staff_id = p_staff_id)
  ) q;

  return jsonb_build_object(
    'rows', rows,
    'total_sale', coalesce((select sum((x->>'sale_total')::numeric) from jsonb_array_elements(rows) x), 0),
    'total_cost', coalesce((select sum((x->>'cost_total')::numeric) from jsonb_array_elements(rows) x), 0),
    'total_profit', coalesce((select sum((x->>'profit')::numeric) from jsonb_array_elements(rows) x), 0)
  );
end $$;
