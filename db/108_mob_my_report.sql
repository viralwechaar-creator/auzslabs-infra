-- AUZsMob: every staffer can see THEIR OWN sales and profit (mob_sell is enough; no manager rights needed).
-- Only the caller's own non-voided sales are returned, never anyone else's. Purchase-price columns are only
-- included for people who may see purchase rates (owner, manager, or staff when the owner allowed it); totals of
-- sales and profit are always included.
create or replace function mob_report_mine(p_from date default null, p_to date default null, p_limit int default 500)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; from_ts timestamptz; to_ts timestamptz; res jsonb; rates boolean; lim int := greatest(coalesce(p_limit, 500), 1);
begin
  tid := mob_guard('mob_sell');
  from_ts := coalesce(p_from, current_date)::timestamptz;
  to_ts := coalesce(p_to, current_date)::timestamptz + interval '1 day';
  rates := (me()->>'role') in ('owner', 'manager') or coalesce((select staff_see_purchase_rates from mob_settings where tenant_id = tid), false);
  with lines as (
    select s.id sale_id, s.bill_no, s.created_at sold_at, it->>'name' item_name, s.customer_name,
           coalesce((it->>'qty')::numeric, 1) qty, (it->>'price')::numeric price, coalesce((it->>'costPrice')::numeric, 0) cost
    from mob_sales s cross join lateral jsonb_array_elements(s.items) it
    where s.tenant_id = tid and s.staff_id = app_uid() and not s.voided and s.created_at >= from_ts and s.created_at < to_ts
  ), tot as (
    select count(distinct sale_id) bills, count(*) n, coalesce(sum(round(price * qty, 2)), 0) sale,
           coalesce(sum(round((price - cost) * qty, 2)), 0) profit, coalesce(sum(round(cost * qty, 2)), 0) cost from lines
  )
  select jsonb_build_object(
    'can_see_cost', rates,
    'bills', (select bills from tot), 'total_sale', (select sale from tot), 'total_profit', (select profit from tot),
    'total_cost', case when rates then (select cost from tot) end,
    'truncated', (select n from tot) > lim,
    'rows', coalesce((select jsonb_agg(r order by (r->>'sold_at') desc) from (
      select jsonb_build_object('sale_id', sale_id, 'bill_no', bill_no, 'sold_at', sold_at, 'item_name', item_name, 'qty', qty,
        'sale_total', round(price * qty, 2), 'profit', round((price - cost) * qty, 2),
        'cost_total', case when rates then round(cost * qty, 2) end,
        'customer_name', coalesce(nullif(customer_name, ''), 'Walk-in')) r
      from lines order by sold_at desc limit lim) x), '[]'::jsonb)
  ) into res;
  return res;
end $$;
