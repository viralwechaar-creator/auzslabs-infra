-- AUZsStyle: four pieces the owner asked for, comparing directly to the Accounting (Ledger) app, scoped down
-- for a retail clothing shop (no e-invoicing/e-way bills/bank reconciliation/fixed assets -- explicitly out of
-- scope per the owner's own answer):
--   1) An audit log viewer. The logging itself (sty_audit/sty_audit_log) has existed since db/215 and already
--      covers every control-plane action worth seeing -- void, return, edit/delete a bill, price changes,
--      settings changes, bulk edits, FY close, etc. (grep the codebase: 50+ call sites). It never logs a sign-in
--      (that's handled entirely by auth_users/profiles, a separate system this table never touches), so the
--      owner's "hide who logged in" is already true by construction -- there is simply no UI to see any of this
--      yet. This migration adds the one missing piece: a read RPC.
--   2) Expenses: shop running costs (rent, salaries, bills) not tied to a purchase, so a profit report can
--      show real net profit, not just gross margin on stock.
--   3) Quotations/proforma bills: a non-binding price quote, convertible to a real bill later. Deliberately
--      does NOT duplicate sty_sell's pricing/stock/payment logic -- "convert" just hands the client the quote's
--      items to drop into a normal Sell cart, which goes through the real, already-audited sty_sell path; the
--      quote is marked converted from the client right after that real sale succeeds.
--   4) Parties: one combined customers+suppliers list (today they're two separate screens, People and Buy ->
--      Suppliers, which stay as they are for their own type-specific editing) plus a running account statement
--      per party -- every bill/payment/return or purchase/payment in one timeline with a running balance, the
--      same shape of thing Ledger calls a party's ledger/statement.

-- ---------- 1) audit log ----------
create or replace function sty_audit_list(p jsonb default '{}'::jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
  f_from date := nullif(p->>'from', '')::date; f_to date := nullif(p->>'to', '')::date;
  f_q text := nullif(p->>'q', ''); f_limit int := coalesce(nullif(p->>'limit', '')::int, 300);
begin
  tid := sty_guard('sty_manage');
  return coalesce((select jsonb_agg(x) from (
    select jsonb_build_object('id', a.id, 'at', a.at, 'action', a.action, 'ref', a.ref, 'detail', a.detail,
        'staff', coalesce(nullif(pr.name, ''), pr.email)) x
    from sty_audit a left join profiles pr on pr.id = a.user_id
    where a.tenant_id = tid
      and (f_from is null or a.at >= f_from) and (f_to is null or a.at < f_to + 1)
      and (f_q is null or a.action ilike '%' || f_q || '%' or a.ref ilike '%' || f_q || '%' or coalesce(pr.name, pr.email, '') ilike '%' || f_q || '%')
    order by a.at desc limit f_limit) q), '[]'::jsonb);
end $$;

-- ---------- 2) expenses ----------
create table if not exists sty_expenses (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  branch_id uuid references sty_branches(id),
  category text not null default 'Other',
  amount numeric(12,2) not null check (amount > 0),
  mode text not null default 'cash',
  note text,
  staff_id uuid,
  at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists sty_expenses_t on sty_expenses(tenant_id, at);
alter table sty_expenses enable row level security;

create or replace function sty_expense_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; eid uuid;
begin
  tid := sty_guard('sty_purchase');   -- same "money out of the shop" permission purchases/supplier payments already use
  eid := nullif(p->>'id', '')::uuid;
  if eid is null then
    insert into sty_expenses (id, tenant_id, branch_id, category, amount, mode, note, staff_id, at)
    values (coalesce(nullif(p->>'newId', '')::uuid, gen_random_uuid()), tid, coalesce(nullif(p->>'branchId', '')::uuid, sty_main_branch(tid)),
      coalesce(nullif(trim(p->>'category'), ''), 'Other'), (p->>'amount')::numeric, coalesce(nullif(p->>'mode', ''), 'cash'), p->>'note', app_uid(),
      coalesce(nullif(p->>'at', '')::timestamptz, now())) returning id into eid;
  else
    update sty_expenses set category = coalesce(nullif(trim(p->>'category'), ''), category), amount = coalesce((p->>'amount')::numeric, amount),
      mode = coalesce(nullif(p->>'mode', ''), mode), note = case when p ? 'note' then p->>'note' else note end
    where id = eid and tenant_id = tid;
  end if;
  perform sty_audit_log(tid, 'expense_save', eid::text, jsonb_build_object('amount', p->>'amount', 'category', p->>'category'));
  return jsonb_build_object('ok', true, 'id', eid);
end $$;

create or replace function sty_expense_delete(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_guard('sty_manage');
  delete from sty_expenses where id = p_id and tenant_id = tid;
  perform sty_audit_log(tid, 'expense_delete', p_id::text, null);
  return jsonb_build_object('ok', true);
end $$;

create or replace function sty_list_expenses(p jsonb default '{}'::jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; f_from date := nullif(p->>'from', '')::date; f_to date := nullif(p->>'to', '')::date; f_limit int := coalesce(nullif(p->>'limit', '')::int, 300);
begin
  tid := sty_guard('sty_view');
  return coalesce((select jsonb_agg(x order by (x->>'at') desc) from (
    select jsonb_build_object('id', e.id, 'at', e.at, 'category', e.category, 'amount', e.amount, 'mode', e.mode, 'note', e.note,
      'staff', coalesce(nullif(pr.name, ''), pr.email)) x
    from sty_expenses e left join profiles pr on pr.id = e.staff_id
    where e.tenant_id = tid and (f_from is null or e.at >= f_from) and (f_to is null or e.at < f_to + 1)
    order by e.at desc limit f_limit) q), '[]'::jsonb);
end $$;

-- ---------- 3) quotations / proforma bills ----------
create table if not exists sty_quotes (
  id uuid primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  branch_id uuid not null references sty_branches(id),
  seq bigint not null,
  number text not null,
  customer_id uuid references sty_customers(id),
  staff_id uuid,
  at timestamptz not null default now(),
  valid_until date,
  lines jsonb not null default '[]'::jsonb,
  subtotal numeric(14,2) not null default 0,
  tax numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,
  status text not null default 'open' check (status in ('open', 'converted', 'void')),
  converted_sale_id uuid references sty_sales(id),
  note text,
  created_at timestamptz not null default now(),
  unique (tenant_id, seq)
);
create index if not exists sty_quotes_t on sty_quotes(tenant_id, at);
alter table sty_quotes enable row level security;

create or replace function sty_quote_json(tid uuid, qid uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', q.id, 'number', q.number, 'at', q.at, 'validUntil', q.valid_until, 'status', q.status,
    'customer', (select jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone) from sty_customers c where c.id = q.customer_id),
    'lines', q.lines, 'subtotal', q.subtotal, 'tax', q.tax, 'total', q.total, 'note', q.note, 'convertedSaleId', q.converted_sale_id)
  from sty_quotes q where q.id = qid and q.tenant_id = tid
$$;

-- Prices a quote the same way sty_sell prices a line (catalogue price, manager-only override, the same
-- sty_tax_rate() slabs) -- but never touches stock or payments, since a quotation isn't a sale.
create or replace function sty_quote_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  tid uuid; qid uuid; b uuid; st sty_settings; cust sty_customers; e jsonb; v record; unit numeric; q int; rate numeric; net numeric; tx numeric;
  sub numeric := 0; taxsum numeric := 0; tot numeric := 0; L jsonb := '[]'::jsonb; seq_ bigint; num text;
begin
  tid := sty_guard('sty_sell');
  select * into st from sty_settings where tenant_id = tid;
  b := coalesce(nullif(p->>'branchId', '')::uuid, sty_main_branch(tid));
  if nullif(p->>'customerId', '') is not null then
    select * into cust from sty_customers where id = (p->>'customerId')::uuid and tenant_id = tid;
  end if;
  if jsonb_array_length(coalesce(p->'lines', '[]'::jsonb)) = 0 then raise exception 'Pick at least one item' using errcode = 'ST004'; end if;
  for e in select * from jsonb_array_elements(p->'lines') loop
    q := (e->>'qty')::int; if q is null or q <= 0 then raise exception 'Quantity must be above zero'; end if;
    select v2.id as vid, v2.colour, v2.size, v2.barcode, coalesce(v2.price, s.price) as price, s.mrp, s.name, s.tax_pct, s.hsn
      into v from sty_variants v2 join sty_styles s on s.id = v2.style_id where v2.id = (e->>'variantId')::uuid and v2.tenant_id = tid;
    if v.vid is null then raise exception 'item not found'; end if;
    unit := v.price;
    if (e->>'price') is not null and (e->>'price')::numeric <> v.price then
      if not sty_perm('sty_manage') then raise exception 'Changing a price needs a manager' using errcode = 'ST005'; end if;
      unit := (e->>'price')::numeric;
    end if;
    net := round(unit * q, 2);
    rate := sty_tax_rate(st, v.tax_pct, unit);
    if st.price_includes_tax then tx := round(net - net / (1 + rate / 100), 2); else tx := round(net * rate / 100, 2); net := net + tx; end if;
    sub := sub + round(unit * q, 2); taxsum := taxsum + tx; tot := tot + net;
    L := L || jsonb_build_object('variantId', v.vid, 'name', v.name, 'colour', v.colour, 'size', v.size, 'barcode', v.barcode, 'qty', q, 'price', unit, 'taxPct', rate, 'tax', tx, 'net', net, 'hsn', v.hsn);
  end loop;

  qid := nullif(p->>'id', '')::uuid;
  if qid is not null and exists (select 1 from sty_quotes where id = qid and tenant_id = tid) then
    update sty_quotes set customer_id = cust.id, lines = L, subtotal = sub, tax = taxsum, total = tot,
      valid_until = nullif(p->>'validUntil', '')::date, note = p->>'note'
    where id = qid and tenant_id = tid;
  else
    qid := coalesce(qid, gen_random_uuid());
    seq_ := sty_next(tid, 'quote');
    num := 'Q-' || lpad(seq_::text, 5, '0');
    insert into sty_quotes (id, tenant_id, branch_id, seq, number, customer_id, staff_id, valid_until, lines, subtotal, tax, total, note)
    values (qid, tid, b, seq_, num, cust.id, app_uid(), nullif(p->>'validUntil', '')::date, L, sub, taxsum, tot, p->>'note');
  end if;
  perform sty_audit_log(tid, 'quote_save', qid::text, jsonb_build_object('total', tot));
  return sty_quote_json(tid, qid);
end $$;

create or replace function sty_quote_get(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_guard('sty_view');
  return sty_quote_json(tid, p_id);
end $$;

create or replace function sty_quote_list(p jsonb default '{}'::jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; f_status text := nullif(p->>'status', ''); f_limit int := coalesce(nullif(p->>'limit', '')::int, 200);
begin
  tid := sty_guard('sty_view');
  return coalesce((select jsonb_agg(x order by (x->>'at') desc) from (
    select jsonb_build_object('id', q.id, 'number', q.number, 'at', q.at, 'validUntil', q.valid_until, 'status', q.status,
      'customer', c.name, 'customerId', q.customer_id, 'total', q.total, 'units', (select coalesce(sum((l->>'qty')::int), 0) from jsonb_array_elements(q.lines) l)) x
    from sty_quotes q left join sty_customers c on c.id = q.customer_id
    where q.tenant_id = tid and (f_status is null or q.status = f_status)
    order by q.at desc limit f_limit) qq), '[]'::jsonb);
end $$;

create or replace function sty_quote_void(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_guard('sty_sell');
  update sty_quotes set status = 'void' where id = p_id and tenant_id = tid and status = 'open';
  if not found then raise exception 'Quotation not found or already handled'; end if;
  perform sty_audit_log(tid, 'quote_void', p_id::text, null);
  return jsonb_build_object('ok', true);
end $$;

-- Called by the client right after a real sty_sell succeeds for a cart that was loaded from this quote --
-- deliberately the only link between the two; sty_sell itself knows nothing about quotes.
create or replace function sty_quote_mark_converted(p_id uuid, p_sale_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_guard('sty_sell');
  update sty_quotes set status = 'converted', converted_sale_id = p_sale_id where id = p_id and tenant_id = tid and status = 'open';
  perform sty_audit_log(tid, 'quote_convert', p_id::text, jsonb_build_object('saleId', p_sale_id));
  return jsonb_build_object('ok', true);
end $$;

-- ---------- 4) parties: a combined customers+suppliers list, and a running statement per party ----------
create or replace function sty_list_parties(p jsonb default '{}'::jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; f_q text := nullif(p->>'q', ''); f_type text := nullif(p->>'type', '');
begin
  tid := sty_guard('sty_view');
  return coalesce((select jsonb_agg(x order by x->>'name') from (
    (select jsonb_build_object('id', c.id, 'type', 'customer', 'name', c.name, 'phone', c.phone,
        'theyOweYou', coalesce((select sum(total - paid) from sty_sales where customer_id = c.id and tenant_id = tid and status = 'due'), 0),
        'youOweThem', c.credit,
        'lastAt', (select max(at) from sty_sales where customer_id = c.id and tenant_id = tid)) x
      from sty_customers c where c.tenant_id = tid and (f_type is null or f_type = 'customer')
        and (f_q is null or c.name ilike '%' || f_q || '%' or c.phone like '%' || f_q || '%'))
    union all
    (select jsonb_build_object('id', s.id, 'type', 'supplier', 'name', s.name, 'phone', s.phone,
        'theyOweYou', 0::numeric,
        'youOweThem', coalesce((select sum(total) from sty_purchases where supplier_id = s.id and tenant_id = tid), 0) - coalesce((select sum(amount) from sty_supplier_payments where supplier_id = s.id and tenant_id = tid), 0),
        'lastAt', (select max(at) from sty_purchases where supplier_id = s.id and tenant_id = tid)) x
      from sty_suppliers s where s.tenant_id = tid and s.active and (f_type is null or f_type = 'supplier')
        and (f_q is null or s.name ilike '%' || f_q || '%' or s.phone like '%' || f_q || '%'))
  ) q), '[]'::jsonb);
end $$;

-- Every bill/payment/return (a customer) or purchase/payment (a supplier) in one timeline, newest first in the
-- UI but computed oldest-first here so the running 'balance' reads naturally: for a customer it's what the
-- customer owes the shop; for a supplier it's what the shop owes the supplier (debit always moves the balance
-- in that natural direction, credit always reduces it).
create or replace function sty_party_statement(p_type text, p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; nm text; rows jsonb;
begin
  tid := sty_guard('sty_view');
  if p_type = 'customer' then
    select name into nm from sty_customers where id = p_id and tenant_id = tid;
    if nm is null then raise exception 'customer not found'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('at', at, 'kind', kind, 'ref', ref, 'debit', debit, 'credit', credit, 'balance', bal) order by at, prio), '[]'::jsonb)
      into rows from (
        select at, kind, ref, debit, credit, prio, round(sum(debit - credit) over (order by at, prio), 2) bal from (
          select s.at, 'bill'::text kind, s.number ref, s.total debit, 0::numeric credit, 0 prio
            from sty_sales s where s.customer_id = p_id and s.tenant_id = tid and s.status <> 'void'
          union all
          select coalesce(nullif(pay->>'at', '')::timestamptz, s.at), 'payment', s.number, 0::numeric, (pay->>'amount')::numeric, 1
            from sty_sales s, jsonb_array_elements(s.payments) pay
            where s.customer_id = p_id and s.tenant_id = tid and s.status <> 'void' and pay->>'mode' <> 'due'
          union all
          select r.at, 'return', s.number, 0::numeric, r.refund, 1
            from sty_returns r join sty_sales s on s.id = r.sale_id where r.customer_id = p_id and r.tenant_id = tid
        ) e(at, kind, ref, debit, credit, prio)
      ) f;
  elsif p_type = 'supplier' then
    select name into nm from sty_suppliers where id = p_id and tenant_id = tid;
    if nm is null then raise exception 'supplier not found'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('at', at, 'kind', kind, 'ref', ref, 'debit', debit, 'credit', credit, 'balance', bal) order by at, prio), '[]'::jsonb)
      into rows from (
        select at, kind, ref, debit, credit, prio, round(sum(debit - credit) over (order by at, prio), 2) bal from (
          select pu.at, 'purchase'::text kind, coalesce(pu.invoice_no, 'Purchase') ref, pu.total debit, 0::numeric credit, 0 prio
            from sty_purchases pu where pu.supplier_id = p_id and pu.tenant_id = tid
          union all
          select sp.at, 'payment', 'Payment', 0::numeric, sp.amount, 1
            from sty_supplier_payments sp where sp.supplier_id = p_id and sp.tenant_id = tid
        ) e(at, kind, ref, debit, credit, prio)
      ) f;
  else
    raise exception 'unknown party type';
  end if;
  return jsonb_build_object('name', nm, 'entries', rows);
end $$;
