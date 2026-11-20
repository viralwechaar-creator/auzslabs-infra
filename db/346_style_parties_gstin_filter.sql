create or replace function sty_list_parties(p jsonb default '{}'::jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; f_q text := nullif(p->>'q', ''); f_type text := nullif(p->>'type', ''); gst_only boolean := coalesce((p->>'gstOnly')::boolean, false);
begin
  tid := sty_guard('sty_view');
  return coalesce((select jsonb_agg(x order by x->>'name') from (
    (select jsonb_build_object('id', c.id, 'type', 'customer', 'name', c.name, 'phone', c.phone, 'gstin', c.gstin,
        'theyOweYou', coalesce((select sum(total - paid) from sty_sales where customer_id = c.id and tenant_id = tid and status = 'due'), 0),
        'youOweThem', c.credit,
        'lastAt', (select max(at) from sty_sales where customer_id = c.id and tenant_id = tid)) x
      from sty_customers c where c.tenant_id = tid and (f_type is null or f_type = 'customer')
        and (not gst_only or nullif(btrim(c.gstin), '') is not null)
        and (f_q is null or c.name ilike '%' || f_q || '%' or c.phone like '%' || f_q || '%' or c.gstin ilike '%' || f_q || '%'))
    union all
    (select jsonb_build_object('id', s.id, 'type', 'supplier', 'name', s.name, 'phone', s.phone, 'gstin', s.gstin,
        'theyOweYou', 0::numeric,
        'youOweThem', coalesce((select sum(total) from sty_purchases where supplier_id = s.id and tenant_id = tid), 0) - coalesce((select sum(amount) from sty_supplier_payments where supplier_id = s.id and tenant_id = tid), 0),
        'lastAt', (select max(at) from sty_purchases where supplier_id = s.id and tenant_id = tid)) x
      from sty_suppliers s where s.tenant_id = tid and s.active and (f_type is null or f_type = 'supplier')
        and (not gst_only or nullif(btrim(s.gstin), '') is not null)
        and (f_q is null or s.name ilike '%' || f_q || '%' or s.phone like '%' || f_q || '%' or s.gstin ilike '%' || f_q || '%'))
  ) q), '[]'::jsonb);
end $$;
