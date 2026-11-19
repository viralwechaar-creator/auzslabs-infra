-- AUZsStyle: make a return/exchange actually visible, not just a line buried inside one bill's own detail
-- sheet. Owner report: "return and exchange is not updated on bills, they just show and add in inventory...
-- there is no access separately for those bills." The underlying data was always correct (sty_return already
-- updates sty_sale_lines.returned, inserts a sty_returns row, and billSheet already showed a Returns section
-- when you opened that one bill) -- what was genuinely missing is (a) any sign of it in the Bills LIST, so a
-- returned/exchanged bill looked identical to any other, and (b) a way to browse returns/exchanges as their
-- own list across the whole shop, the way Purchases or Website orders already can be. Both are added here.
--
-- The bill itself is still never edited after the fact (the printed tax invoice is immutable, same reasoning
-- as the Accounting app's own documents -- a return is its own document, same as a credit note there) --
-- that is by design, not the bug being reported.

create or replace function sty_list_sales(p jsonb default '{}'::jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; mine boolean; uid_ uuid := app_uid();
  f_from date := nullif(p->>'from', '')::date; f_to date := nullif(p->>'to', '')::date;
  f_cust uuid := nullif(p->>'customerId', '')::uuid; f_status text := nullif(p->>'status', ''); f_q text := nullif(p->>'q', '');
  f_limit int := coalesce(nullif(p->>'limit', '')::int, 100);
begin
  tid := sty_guard('sty_view');
  mine := not sty_perm('sty_reports');                      -- plain staff see only their own bills
  return coalesce((select jsonb_agg(x) from (
    select jsonb_build_object('id', s.id, 'number', s.number, 'at', s.at, 'total', s.total, 'paid', s.paid, 'status', s.status, 'discount', s.discount,
      'customer', c.name, 'customerId', s.customer_id, 'branchId', s.branch_id, 'units', (select coalesce(sum(qty), 0) from sty_sale_lines where sale_id = s.id),
      'staff', (select coalesce(nullif(pr.name, ''), pr.email) from profiles pr where pr.id = s.staff_id), 'payments', s.payments,
      'returned', exists (select 1 from sty_returns r where r.sale_id = s.id),
      'refunded', (select coalesce(sum(r.refund), 0) from sty_returns r where r.sale_id = s.id),
      'exchanged', exists (select 1 from sty_returns r where r.sale_id = s.id and r.mode = 'exchange')) x
    from sty_sales s left join sty_customers c on c.id = s.customer_id
    where s.tenant_id = tid and (not mine or s.staff_id = uid_)
      and (f_from is null or s.at >= f_from)
      and (f_to is null or s.at < f_to + 1)
      and (f_cust is null or s.customer_id = f_cust)
      and (f_status is null or s.status = f_status)
      and (f_q is null or s.number ilike '%' || f_q || '%' or c.name ilike '%' || f_q || '%' or c.phone like '%' || f_q || '%')
    order by s.at desc limit f_limit) q), '[]'::jsonb);
end $$;

-- Every return/exchange across the shop, newest first, over a date range -- for the Bills page's new
-- "Returns" tab (same shape of ask as Purchases already has a dedicated list, Website orders already has
-- a dedicated list; returns never did).
create or replace function sty_list_returns(p jsonb default '{}'::jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; mine boolean; uid_ uuid := app_uid();
  f_from date := nullif(p->>'from', '')::date; f_to date := nullif(p->>'to', '')::date; f_limit int := coalesce(nullif(p->>'limit', '')::int, 200);
begin
  tid := sty_guard('sty_view');
  mine := not sty_perm('sty_reports');
  return coalesce((select jsonb_agg(x) from (
    select jsonb_build_object('id', r.id, 'at', r.at, 'mode', r.mode, 'reason', r.reason, 'refund', r.refund, 'damaged', exists (select 1 from sty_return_lines rl where rl.return_id = r.id and rl.damaged),
      'saleId', s.id, 'saleNumber', s.number, 'customer', c.name,
      'staff', (select coalesce(nullif(pr.name, ''), pr.email) from profiles pr where pr.id = r.staff_id),
      'units', (select coalesce(sum(qty), 0) from sty_return_lines where return_id = r.id),
      'lines', coalesce((select jsonb_agg(jsonb_build_object('name', (select s2.name from sty_variants v join sty_styles s2 on s2.id = v.style_id where v.id = rl.variant_id),
          'qty', rl.qty, 'amount', rl.amount, 'damaged', rl.damaged) order by rl.id) from sty_return_lines rl where rl.return_id = r.id), '[]'::jsonb)) x
    from sty_returns r join sty_sales s on s.id = r.sale_id left join sty_customers c on c.id = r.customer_id
    where r.tenant_id = tid and (not mine or r.staff_id = uid_)
      and (f_from is null or r.at >= f_from) and (f_to is null or r.at < f_to + 1)
    order by r.at desc limit f_limit) q), '[]'::jsonb);
end $$;
