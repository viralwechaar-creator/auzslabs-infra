-- AUZsLedger: software-as-a-service / subscription products, with a renewal date and plan type (monthly/yearly) per
-- customer. A renewal date does NOT belong on acc_products itself: the same "AUZsLedger Accounting" product is sold
-- to many different customers, each on their own cycle, so a dedicated acc_subscriptions table links one product +
-- one customer to its own plan type, amount and renewal date. acc_products only gains a plain is_subscription flag
-- so the catalogue can mark which items are subscription-sold in the first place (shown in the product editor).

alter table acc_products add column if not exists is_subscription boolean not null default false;

-- acc_save_product (db/061) re-created whole, with is_subscription added -- same body otherwise.
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
    insert into acc_products (tenant_id, sku, barcode, name, category, brand, unit, hsn, tax_rate, tax_inclusive, purchase_price, sale_price, mrp, price_lists, is_service, is_subscription, track_stock, track_batch, track_serial, reorder_level, reorder_qty, notes)
    values (tid, trim(p->>'sku'), nullif(p->>'barcode', ''), trim(p->>'name'), nullif(p->>'category', ''), nullif(p->>'brand', ''), coalesce(nullif(p->>'unit', ''), 'Nos'), nullif(p->>'hsn', ''), tr,
            coalesce((p->>'tax_inclusive')::boolean, false), coalesce(nullif(p->>'purchase_price', '')::numeric, 0), coalesce(nullif(p->>'sale_price', '')::numeric, 0), coalesce(nullif(p->>'mrp', '')::numeric, 0),
            coalesce(p->'price_lists', '{}'::jsonb), svc, sub, not svc and coalesce((p->>'track_stock')::boolean, true), coalesce((p->>'track_batch')::boolean, false), coalesce((p->>'track_serial')::boolean, false),
            coalesce(nullif(p->>'reorder_level', '')::numeric, 0), coalesce(nullif(p->>'reorder_qty', '')::numeric, 0), p->>'notes') returning id into pid;
    perform acc_audit_log(tid, 'create', 'product', pid::text, null, p);
  else
    select * into old from acc_products where id = pid and tenant_id = tid;
    if old.id is null then raise exception 'Product not found'; end if;
    if exists (select 1 from acc_stock_moves where product_id = pid) and svc <> old.is_service then raise exception 'A product with stock movements cannot become a service'; end if;
    update acc_products set sku = trim(p->>'sku'), barcode = nullif(p->>'barcode', ''), name = trim(p->>'name'), category = nullif(p->>'category', ''), brand = nullif(p->>'brand', ''),
      unit = coalesce(nullif(p->>'unit', ''), unit), hsn = nullif(p->>'hsn', ''), tax_rate = tr, tax_inclusive = coalesce((p->>'tax_inclusive')::boolean, tax_inclusive),
      purchase_price = coalesce(nullif(p->>'purchase_price', '')::numeric, purchase_price), sale_price = coalesce(nullif(p->>'sale_price', '')::numeric, sale_price), mrp = coalesce(nullif(p->>'mrp', '')::numeric, mrp),
      price_lists = coalesce(p->'price_lists', price_lists), is_service = svc, is_subscription = sub, track_stock = not svc and coalesce((p->>'track_stock')::boolean, track_stock),
      track_batch = coalesce((p->>'track_batch')::boolean, track_batch), track_serial = coalesce((p->>'track_serial')::boolean, track_serial),
      reorder_level = coalesce(nullif(p->>'reorder_level', '')::numeric, reorder_level), reorder_qty = coalesce(nullif(p->>'reorder_qty', '')::numeric, reorder_qty),
      notes = coalesce(p->>'notes', notes), active = coalesce((p->>'active')::boolean, active), updated_at = now() where id = pid;
    perform acc_audit_log(tid, 'update', 'product', pid::text, to_jsonb(old), p);
  end if;
  if nullif(p->>'category', '') is not null then insert into acc_masters (tenant_id, kind, name) values (tid, 'category', p->>'category') on conflict do nothing; end if;
  if nullif(p->>'brand', '') is not null then insert into acc_masters (tenant_id, kind, name) values (tid, 'brand', p->>'brand') on conflict do nothing; end if;
  return jsonb_build_object('id', pid);
end $$;

-- ---------- subscriptions: one row per customer's active (or past) subscription to a product ----------
create table acc_subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  party_id uuid not null references acc_parties(id),
  product_id uuid not null references acc_products(id),
  plan_type text not null check (plan_type in ('monthly', 'yearly')),
  amount numeric(16,2) not null default 0,
  start_date date not null default current_date,
  renewal_date date not null,
  status text not null default 'active' check (status in ('active', 'cancelled')),
  last_invoice_id uuid references acc_documents(id),
  notes text,
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index acc_subs_t on acc_subscriptions (tenant_id, status, renewal_date);
alter table acc_subscriptions enable row level security;
create policy acc_subscriptions_read on acc_subscriptions for select using (me() is not null and tenant_id = (me()->>'tenant_id')::uuid);
grant select, insert, update, delete on acc_subscriptions to app;

create function acc_save_subscription(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; sid uuid := nullif(p->>'id', '')::uuid; party acc_parties; prod acc_products; pt text := p->>'plan_type';
  amt numeric; sd date; rd date; step interval;
begin
  tid := acc_guard('acc_sales');
  if pt not in ('monthly', 'yearly') then raise exception 'Choose a monthly or yearly plan'; end if;
  select * into party from acc_parties where id = nullif(p->>'party_id', '')::uuid and tenant_id = tid;
  if party.id is null then raise exception 'Choose a customer'; end if;
  select * into prod from acc_products where id = nullif(p->>'product_id', '')::uuid and tenant_id = tid and active;
  if prod.id is null then raise exception 'Choose a product'; end if;
  amt := coalesce(nullif(p->>'amount', '')::numeric, prod.sale_price);
  sd := coalesce(nullif(p->>'start_date', '')::date, current_date);
  step := case pt when 'monthly' then interval '1 month' else interval '1 year' end;
  rd := coalesce(nullif(p->>'renewal_date', '')::date, (sd + step)::date);
  if sid is null then
    insert into acc_subscriptions (tenant_id, party_id, product_id, plan_type, amount, start_date, renewal_date, notes, created_by)
    values (tid, party.id, prod.id, pt, amt, sd, rd, nullif(p->>'notes', ''), app_uid()) returning id into sid;
    perform acc_audit_log(tid, 'create', 'subscription', sid::text, null, p);
  else
    update acc_subscriptions set party_id = party.id, product_id = prod.id, plan_type = pt, amount = amt, start_date = sd, renewal_date = rd,
      notes = nullif(p->>'notes', ''), updated_at = now() where id = sid and tenant_id = tid;
    if not found then raise exception 'Subscription not found'; end if;
    perform acc_audit_log(tid, 'update', 'subscription', sid::text, null, p);
  end if;
  return jsonb_build_object('id', sid);
end $$;

create function acc_list_subscriptions(p jsonb default '{}') returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; st text := coalesce(nullif(p->>'status', ''), 'active'); due date := nullif(p->>'due_before', '')::date;
begin
  tid := acc_guard('acc_view');
  return jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(x) order by x.renewal_date) from (
    select s.*, pa.name as party_name, pa.phone as party_phone, pr.name as product_name,
      (s.renewal_date < current_date and s.status = 'active') as overdue
    from acc_subscriptions s join acc_parties pa on pa.id = s.party_id join acc_products pr on pr.id = s.product_id
    where s.tenant_id = tid and (st = 'all' or s.status = st) and (due is null or s.renewal_date <= due)) x), '[]'));
end $$;

create function acc_cancel_subscription(p_id uuid, p_reason text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := acc_guard('acc_sales');
  update acc_subscriptions set status = 'cancelled', notes = coalesce(notes || E'\n', '') || 'Cancelled: ' || coalesce(p_reason, 'no reason given'), updated_at = now()
    where id = p_id and tenant_id = tid and status = 'active';
  if not found then raise exception 'Subscription not found or already cancelled'; end if;
  perform acc_audit_log(tid, 'cancel', 'subscription', p_id::text, null, jsonb_build_object('reason', p_reason));
  return jsonb_build_object('ok', true);
end $$;

-- Raises a renewal invoice for one subscription (one product line, qty 1, at the subscription's own amount) through
-- the normal acc_save_document engine -- same tax/GST/numbering/posting rules as any other invoice, nothing special-
-- cased. Advances renewal_date by the plan's own interval on success. p_post mirrors acc_run_recurring's own
-- discipline: only actually posts if the caller ALSO has acc_post, even though acc_save_document itself does not
-- require it -- an extra, deliberate safety margin for money-moving automation.
create function acc_renew_subscription(p_id uuid, p_post boolean default false) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; s acc_subscriptions; step interval; out jsonb; post_ok boolean;
begin
  tid := acc_guard('acc_sales');
  select * into s from acc_subscriptions where id = p_id and tenant_id = tid and status = 'active' for update;
  if s.id is null then raise exception 'Subscription not found or not active'; end if;
  post_ok := p_post and acc_perm('acc_post');
  out := acc_save_document(jsonb_build_object('doc_type', 'invoice', 'party_id', s.party_id, 'post', post_ok,
    'notes', 'Subscription renewal (' || s.plan_type || ')',
    'lines', jsonb_build_array(jsonb_build_object('product_id', s.product_id, 'qty', 1, 'rate', s.amount))));
  step := case s.plan_type when 'monthly' then interval '1 month' else interval '1 year' end;
  update acc_subscriptions set renewal_date = (greatest(s.renewal_date, current_date) + step)::date, last_invoice_id = nullif(out->>'id', '')::uuid, updated_at = now() where id = s.id;
  perform acc_audit_log(tid, 'renew', 'subscription', s.id::text, null, jsonb_build_object('invoice', out->>'number', 'posted', post_ok));
  return out || jsonb_build_object('posted', post_ok);
end $$;
