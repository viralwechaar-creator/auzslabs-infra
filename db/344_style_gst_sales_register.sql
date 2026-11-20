-- Sales registers are working papers. Customer GSTIN comes from the current customer record.
create or replace function sty_gst_sales_register(p jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  tid uuid := sty_guard('sty_reports');
  d0 date := make_date((p->>'year')::int, (p->>'month')::int, 1);
  d1 date := (d0 + interval '1 month')::date;
begin
  if d0 is null then raise exception 'Select a return period'; end if;
  return (
    with sales as materialized (
      select s.id, s.number, s.at, s.total, s.total - s.tax - s.rounding as taxable,
        s.cgst, s.sgst, s.igst, s.place_of_supply as "placeOfSupply",
        c.name as customer, nullif(btrim(c.gstin), '') as gstin
      from sty_sales s
      left join sty_customers c on c.id = s.customer_id and c.tenant_id = tid
      where s.tenant_id = tid and s.status in ('paid', 'due') and s.at >= d0 and s.at < d1
    ),
    hsn as (
      select nullif(btrim(l.hsn), '') as hsn, l.tax_pct as rate, count(*) as lines,
        sum(l.net - l.tax) as taxable, sum(l.cgst) as cgst, sum(l.sgst) as sgst, sum(l.igst) as igst
      from sales s join sty_sale_lines l on l.sale_id = s.id and l.tenant_id = tid
      group by nullif(btrim(l.hsn), ''), l.tax_pct
    )
    select jsonb_build_object(
      'registered', coalesce((select jsonb_agg(to_jsonb(s) order by s.at desc, s.id) from sales s where s.gstin is not null), '[]'::jsonb),
      'unregistered', coalesce((select jsonb_agg(to_jsonb(s) order by s.at desc, s.id) from sales s where s.gstin is null), '[]'::jsonb),
      'hsn', coalesce((select jsonb_agg(to_jsonb(h) order by h.hsn nulls last, h.rate) from hsn h), '[]'::jsonb)
    )
  );
end $$;
revoke execute on function sty_gst_sales_register(jsonb) from public;
grant execute on function sty_gst_sales_register(jsonb) to app;
