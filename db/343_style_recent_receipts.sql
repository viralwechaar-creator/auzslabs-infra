-- Read actual bill payments by payment date, including collections on older bills.
create or replace function sty_recent_receipts(p jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  tid uuid := sty_guard('sty_view');
  from_day date := nullif(p->>'from', '')::date;
  to_day date := nullif(p->>'to', '')::date;
  reports boolean := sty_perm('sty_reports');
begin
  return coalesce((select jsonb_agg(to_jsonb(r) order by r.at desc, r.id desc, r.position desc) from (
    select s.id, s.number, c.name as customer,
      payment.value->>'mode' as mode, (payment.value->>'amount')::numeric as amount,
      coalesce(nullif(payment.value->>'at', '')::timestamptz, s.at) as at,
      payment.ordinality as position
    from sty_sales s
    left join sty_customers c on c.id = s.customer_id and c.tenant_id = tid
    cross join lateral jsonb_array_elements(s.payments) with ordinality as payment(value, ordinality)
    where s.tenant_id = tid and s.status in ('paid', 'due')
      and (reports or s.staff_id = app_uid())
      and payment.value->>'mode' in ('cash', 'upi', 'card', 'bank')
      and (payment.value->>'amount')::numeric > 0
      and (from_day is null or coalesce(nullif(payment.value->>'at', '')::timestamptz, s.at) >= from_day)
      and (to_day is null or coalesce(nullif(payment.value->>'at', '')::timestamptz, s.at) < to_day + 1)
    order by at desc, s.id desc, payment.ordinality desc limit 40
  ) r), '[]'::jsonb);
end $$;
revoke execute on function sty_recent_receipts(jsonb) from public;
grant execute on function sty_recent_receipts(jsonb) to app;
