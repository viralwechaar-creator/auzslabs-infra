-- Owner request: a dedicated SaaS product form (name, HSN, a monthly price AND a yearly price set once on the
-- product, GST) instead of one plain "sale price" the subscription screen re-copies regardless of cadence -- so
-- picking Monthly vs Yearly on a subscription now fills in the RIGHT price automatically. Still no renewal date on
-- the product itself (db/304's own reasoning stands: one SaaS product is sold to many customers, each on their own
-- cycle -- that stays on the subscription, not the product).
alter table acc_products add column if not exists price_monthly numeric(16,2);
alter table acc_products add column if not exists price_yearly numeric(16,2);

create or replace function acc_save_product(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; pid uuid := nullif(p->>'id', '')::uuid; old acc_products; tr numeric; svc boolean; sub boolean;
begin
  tid := acc_guard('acc_inventory');
  if coalesce(trim(p->>'name'), '') = '' or coalesce(trim(p->>'sku'), '') = '' then raise exception 'SKU and name are required'; end if;
  tr := coalesce(nullif(p->>'tax_rate', '')::numeric, 18);
  if tr <> 0 and not exists (select 1 from acc_taxcodes where tenant_id = tid and active and rate = tr) then raise exception 'GST rate % is not configured', tr; end if;
  svc := coalesce((p->>'is_service')::boolean, false);
  sub := svc and coalesce((p->>'is_subscription')::boolean, false);
  if pid is null then
    insert into acc_products (tenant_id, sku, barcode, name, category, brand, unit, hsn, tax_rate, tax_inclusive, purchase_price, sale_price, mrp, price_lists, is_service, is_subscription,
                               price_monthly, price_yearly, track_stock, track_batch, track_serial, reorder_level, reorder_qty, notes)
    values (tid, trim(p->>'sku'), nullif(p->>'barcode', ''), trim(p->>'name'), nullif(p->>'category', ''), nullif(p->>'brand', ''), coalesce(nullif(p->>'unit', ''), 'Nos'), nullif(p->>'hsn', ''), tr,
            coalesce((p->>'tax_inclusive')::boolean, false), coalesce(nullif(p->>'purchase_price', '')::numeric, 0), coalesce(nullif(p->>'sale_price', '')::numeric, 0), coalesce(nullif(p->>'mrp', '')::numeric, 0),
            coalesce(p->'price_lists', '{}'::jsonb), svc, sub, nullif(p->>'price_monthly', '')::numeric, nullif(p->>'price_yearly', '')::numeric,
            not svc and coalesce((p->>'track_stock')::boolean, true), coalesce((p->>'track_batch')::boolean, false), coalesce((p->>'track_serial')::boolean, false),
            coalesce(nullif(p->>'reorder_level', '')::numeric, 0), coalesce(nullif(p->>'reorder_qty', '')::numeric, 0), p->>'notes') returning id into pid;
    perform acc_audit_log(tid, 'create', 'product', pid::text, null, p);
  else
    select * into old from acc_products where id = pid and tenant_id = tid;
    if old.id is null then raise exception 'Product not found'; end if;
    if exists (select 1 from acc_stock_moves where product_id = pid) and svc <> old.is_service then raise exception 'A product with stock movements cannot become a service'; end if;
    update acc_products set sku = trim(p->>'sku'), barcode = nullif(p->>'barcode', ''), name = trim(p->>'name'), category = nullif(p->>'category', ''), brand = nullif(p->>'brand', ''),
      unit = coalesce(nullif(p->>'unit', ''), unit), hsn = nullif(p->>'hsn', ''), tax_rate = tr, tax_inclusive = coalesce((p->>'tax_inclusive')::boolean, tax_inclusive),
      purchase_price = coalesce(nullif(p->>'purchase_price', '')::numeric, purchase_price), sale_price = coalesce(nullif(p->>'sale_price', '')::numeric, sale_price), mrp = coalesce(nullif(p->>'mrp', '')::numeric, mrp),
      price_lists = coalesce(p->'price_lists', price_lists), is_service = svc, is_subscription = sub,
      price_monthly = coalesce(nullif(p->>'price_monthly', '')::numeric, price_monthly), price_yearly = coalesce(nullif(p->>'price_yearly', '')::numeric, price_yearly),
      track_stock = not svc and coalesce((p->>'track_stock')::boolean, track_stock),
      track_batch = coalesce((p->>'track_batch')::boolean, track_batch), track_serial = coalesce((p->>'track_serial')::boolean, track_serial),
      reorder_level = coalesce(nullif(p->>'reorder_level', '')::numeric, reorder_level), reorder_qty = coalesce(nullif(p->>'reorder_qty', '')::numeric, reorder_qty),
      notes = coalesce(p->>'notes', notes), active = coalesce((p->>'active')::boolean, active), updated_at = now() where id = pid;
    perform acc_audit_log(tid, 'update', 'product', pid::text, to_jsonb(old), p);
  end if;
  if nullif(p->>'category', '') is not null then insert into acc_masters (tenant_id, kind, name) values (tid, 'category', p->>'category') on conflict do nothing; end if;
  if nullif(p->>'brand', '') is not null then insert into acc_masters (tenant_id, kind, name) values (tid, 'brand', p->>'brand') on conflict do nothing; end if;
  return jsonb_build_object('id', pid);
end $$;

-- ---------- reusable one-time charge types (setup fee, onboarding, customization, discount, ...) ----------
-- Owner request: a short list set up once (name, usual amount, GST), picked from when billing a subscription,
-- instead of typing a fresh description/amount every time. A negative `amount` is how a reusable discount is
-- represented -- it becomes a normal line with a negative rate, same as any other line; nothing else treats it
-- specially.
create table acc_charge_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  amount numeric(16,2) not null default 0,
  tax_rate numeric not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index acc_charge_types_t on acc_charge_types (tenant_id, active);
alter table acc_charge_types enable row level security;
create policy acc_charge_types_read on acc_charge_types for select using (me() is not null and tenant_id = (me()->>'tenant_id')::uuid);
grant select, insert, update, delete on acc_charge_types to app;

create function acc_save_charge_type(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; cid uuid := nullif(p->>'id', '')::uuid;
begin
  tid := acc_guard('acc_sales');
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Name is required'; end if;
  if cid is null then
    insert into acc_charge_types (tenant_id, name, amount, tax_rate) values (tid, trim(p->>'name'), coalesce(nullif(p->>'amount', '')::numeric, 0), coalesce(nullif(p->>'tax_rate', '')::numeric, 0)) returning id into cid;
  else
    update acc_charge_types set name = trim(p->>'name'), amount = coalesce(nullif(p->>'amount', '')::numeric, 0), tax_rate = coalesce(nullif(p->>'tax_rate', '')::numeric, 0),
      active = coalesce((p->>'active')::boolean, active), updated_at = now() where id = cid and tenant_id = tid;
    if not found then raise exception 'Charge type not found'; end if;
  end if;
  return jsonb_build_object('id', cid);
end $$;

create function acc_list_charge_types(p_all boolean default false) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := acc_guard('acc_view');
  return jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(x) order by x.name) from (
    select * from acc_charge_types where tenant_id = tid and (p_all or active)) x), '[]'));
end $$;

create function acc_delete_charge_type(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := acc_guard('acc_sales');
  update acc_charge_types set active = false, updated_at = now() where id = p_id and tenant_id = tid;
  if not found then raise exception 'Charge type not found'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- acc_renew_subscription (db/304) gains p_extra_lines: the one-time charges (setup fee, onboarding, discount, ...)
-- picked for THIS bill only, appended alongside the subscription's own recurring line. Never stored against the
-- subscription itself -- a setup fee billed once at signup must not silently repeat on the next renewal.
-- NOTE: the param list grows from 2 to 3 args, so `create or replace` alone would NOT replace the old function --
-- it would silently create a second overload, and a 2-arg call (e.g. acc_run_due_subscriptions) would keep
-- resolving to the stale one. Drop the old signature first (same gotcha already hit with acc_do_post in db/311).
drop function if exists acc_renew_subscription(uuid, boolean);
create function acc_renew_subscription(p_id uuid, p_post boolean default false, p_extra_lines jsonb default '[]') returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; s acc_subscriptions; step interval; out jsonb; post_ok boolean; lines jsonb; x jsonb;
begin
  tid := acc_guard('acc_sales');
  select * into s from acc_subscriptions where id = p_id and tenant_id = tid and status = 'active' for update;
  if s.id is null then raise exception 'Subscription not found or not active'; end if;
  post_ok := p_post and acc_perm('acc_post');
  lines := jsonb_build_array(jsonb_build_object('product_id', s.product_id, 'qty', 1, 'rate', s.amount));
  for x in select * from jsonb_array_elements(coalesce(p_extra_lines, '[]')) loop
    if coalesce((x->>'rate')::numeric, 0) <> 0 then lines := lines || jsonb_build_array(jsonb_build_object('description', x->>'description', 'qty', 1, 'rate', x->>'rate', 'tax_rate', coalesce(x->>'tax_rate', '0'))); end if;
  end loop;
  out := acc_save_document(jsonb_build_object('doc_type', 'invoice', 'party_id', s.party_id, 'post', post_ok,
    'notes', 'Subscription renewal (' || s.plan_type || ')',
    'lines', lines));
  step := case s.plan_type when 'monthly' then interval '1 month' else interval '1 year' end;
  update acc_subscriptions set renewal_date = (greatest(s.renewal_date, current_date) + step)::date, last_invoice_id = nullif(out->>'id', '')::uuid, updated_at = now() where id = s.id;
  perform acc_audit_log(tid, 'renew', 'subscription', s.id::text, null, jsonb_build_object('invoice', out->>'number', 'posted', post_ok, 'extra_lines', jsonb_array_length(coalesce(p_extra_lines, '[]'))));
  return out || jsonb_build_object('posted', post_ok);
end $$;
