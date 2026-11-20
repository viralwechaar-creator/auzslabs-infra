create function sty_resolve_b2b_customer(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  tid uuid := sty_guard('sty_sell');
  gst text := upper(btrim(coalesce(p->>'gstin', '')));
  business text := nullif(btrim(p->>'name'), '');
  billing_address text := nullif(btrim(p->>'address'), '');
  c sty_customers;
begin
  if gst !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' or business is null or billing_address is null then
    raise exception 'Business name, GSTIN and billing address are required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(tid::text || ':' || gst, 0));
  select * into c from sty_customers where tenant_id = tid and upper(btrim(gstin)) = gst
    order by created_at, id limit 1 for update;
  if found then
    update sty_customers set name = business, address = billing_address,
      city = coalesce(nullif(btrim(p->>'city'), ''), city), gstin = gst, pan = substring(gst from 3 for 10)
    where tenant_id = tid and id = c.id returning * into c;
  else
    insert into sty_customers (tenant_id, name, gstin, address, city, pan, wa_optin)
    values (tid, business, gst, billing_address, nullif(btrim(p->>'city'), ''), substring(gst from 3 for 10), false)
    returning * into c;
  end if;
  return jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone,
    'address', c.address, 'gstin', c.gstin, 'city', c.city, 'pan', c.pan, 'points', c.points, 'credit', c.credit);
end $$;
revoke execute on function sty_resolve_b2b_customer(jsonb) from public;
grant execute on function sty_resolve_b2b_customer(jsonb) to app;

alter table sty_sales add column buyer_snapshot jsonb;
create function sty_snapshot_b2b_buyer() returns trigger language plpgsql set search_path = public as $$
begin
  select jsonb_build_object('name', c.name, 'gstin', c.gstin, 'address', c.address, 'city', c.city)
    into new.buyer_snapshot from sty_customers c
    where c.id = new.customer_id and c.tenant_id = new.tenant_id and nullif(btrim(c.gstin), '') is not null;
  return new;
end $$;
create trigger sty_snapshot_b2b_buyer before insert on sty_sales
for each row when (new.customer_id is not null) execute function sty_snapshot_b2b_buyer();

create or replace function sty_sale_json(tid uuid, sid uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', s.id, 'number', s.number, 'seq', s.seq, 'at', s.at, 'branchId', s.branch_id, 'status', s.status,
    'subtotal', s.subtotal, 'discount', s.discount, 'tax', s.tax, 'cgst', s.cgst, 'sgst', s.sgst, 'igst', s.igst, 'placeOfSupply', s.place_of_supply, 'dueDate', s.due_date,
    'rounding', s.rounding, 'total', s.total, 'paid', s.paid, 'balance', greatest(s.total - s.paid, 0),
    'payments', s.payments, 'pointsEarned', s.points_earned, 'pointsUsed', s.points_used, 'note', s.note, 'voidReason', s.void_reason, 'offline', s.offline, 'coupon', s.coupon,
    'staffId', s.staff_id, 'sellerGstin', (select st2.gstin from sty_settings st2 where st2.tenant_id = tid),
    'staff', (select coalesce(nullif(p.name, ''), p.email) from profiles p where p.id = s.staff_id),
    'customer', (select jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'points', c.points, 'credit', c.credit, 'gstin', c.gstin, 'address', c.address) || coalesce(s.buyer_snapshot, '{}'::jsonb) from sty_customers c where c.id = s.customer_id and c.tenant_id = s.tenant_id),
    'lines', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'variantId', l.variant_id, 'styleId', l.style_id, 'name', l.style_name, 'category', l.category, 'brand', l.brand,
        'colour', l.colour, 'size', l.size, 'barcode', l.barcode, 'qty', l.qty, 'mrp', l.mrp, 'price', l.price, 'disc', l.disc, 'taxPct', l.tax_pct, 'tax', l.tax, 'net', l.net, 'hsn', l.hsn,
        'cgst', l.cgst, 'sgst', l.sgst, 'igst', l.igst, 'returned', l.returned) order by l.id) from sty_sale_lines l where l.sale_id = s.id), '[]'::jsonb),
    'returns', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'at', r.at, 'mode', r.mode, 'refund', r.refund, 'reason', r.reason)) from sty_returns r where r.sale_id = s.id), '[]'::jsonb))
  from sty_sales s where s.id = sid and s.tenant_id = tid
$$;
