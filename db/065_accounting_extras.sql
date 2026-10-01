-- =========================================================
-- AUZslab Accounting: recurring documents, public share links for invoices,
-- attachment URL rule (private storage, see server /storage/acc).
-- =========================================================

-- ---------- recurring invoices / bills / expenses ----------
create table acc_recurring (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('invoice', 'bill', 'expense')),
  payload jsonb not null,                              -- exactly what acc_save_document takes (without doc_date/post)
  frequency text not null check (frequency in ('weekly', 'monthly', 'quarterly', 'yearly')),
  next_date date not null, end_date date,
  auto_post boolean not null default false,            -- false: create a draft for review
  active boolean not null default true,
  last_run date, runs int not null default 0, last_error text,
  created_by uuid, created_at timestamptz not null default now()
);
alter table acc_recurring enable row level security;
create policy acc_recurring_read on acc_recurring for select using (me() is not null and tenant_id = (me()->>'tenant_id')::uuid);
grant select, insert, update, delete on acc_recurring to app;

create function acc_save_recurring(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; k text := p->>'kind'; rid uuid := nullif(p->>'id', '')::uuid;
begin
  if k not in ('invoice', 'bill', 'expense') then raise exception 'Choose invoice, bill or expense'; end if;
  tid := acc_guard(case when k = 'invoice' then 'acc_sales' else 'acc_purchase' end);
  if coalesce(trim(p->>'name'), '') = '' then raise exception 'Name this schedule'; end if;
  if p->>'frequency' not in ('weekly', 'monthly', 'quarterly', 'yearly') then raise exception 'Choose how often it repeats'; end if;
  if jsonb_array_length(coalesce(p->'payload'->'lines', '[]')) = 0 then raise exception 'Add at least one line'; end if;
  if rid is null then
    insert into acc_recurring (tenant_id, name, kind, payload, frequency, next_date, end_date, auto_post, created_by)
    values (tid, trim(p->>'name'), k, (p->'payload') - 'id' - 'post' - 'doc_date' - 'payments', p->>'frequency', (p->>'next_date')::date, nullif(p->>'end_date', '')::date, coalesce((p->>'auto_post')::boolean, false), app_uid()) returning id into rid;
  else
    update acc_recurring set name = trim(p->>'name'), payload = (p->'payload') - 'id' - 'post' - 'doc_date' - 'payments', frequency = p->>'frequency', next_date = (p->>'next_date')::date, end_date = nullif(p->>'end_date', '')::date,
      auto_post = coalesce((p->>'auto_post')::boolean, auto_post), active = coalesce((p->>'active')::boolean, active) where id = rid and tenant_id = tid;
  end if;
  perform acc_audit_log(tid, 'save', 'recurring', rid::text, null, jsonb_build_object('name', p->>'name', 'frequency', p->>'frequency'));
  return jsonb_build_object('id', rid);
end $$;

create function acc_list_recurring() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := acc_guard('acc_view');
  return jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(r) || jsonb_build_object('party_name', (select name from acc_parties where id = nullif(r.payload->>'party_id', '')::uuid),
      'due', r.active and r.next_date <= current_date and (r.end_date is null or r.next_date <= r.end_date)) order by r.next_date) from acc_recurring r where r.tenant_id = tid), '[]'));
end $$;

create function acc_delete_recurring(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := acc_guard('acc_sales');
  delete from acc_recurring where id = p_id and tenant_id = tid;
  perform acc_audit_log(tid, 'delete', 'recurring', p_id::text, null, null);
  return jsonb_build_object('ok', true);
end $$;

-- creates every document that has fallen due up to p_upto (a schedule that fell behind catches up, oldest first)
create function acc_run_recurring(p_upto date default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; upto date := coalesce(p_upto, current_date); r acc_recurring; made int := 0; failed int := 0; res jsonb := '[]'; out jsonb; guard int; step interval; perm text;
begin
  tid := acc_guard('acc_view');
  for r in select * from acc_recurring where tenant_id = tid and active and next_date <= upto and (end_date is null or next_date <= end_date) order by next_date for update loop
    perm := case when r.kind = 'invoice' then 'acc_sales' else 'acc_purchase' end;
    if not acc_perm(perm) then continue; end if;
    step := case r.frequency when 'weekly' then interval '7 days' when 'monthly' then interval '1 month' when 'quarterly' then interval '3 months' else interval '1 year' end;
    guard := 0;
    while r.next_date <= upto and (r.end_date is null or r.next_date <= r.end_date) and guard < 36 loop
      guard := guard + 1;
      begin
        out := acc_save_document(r.payload || jsonb_build_object('doc_type', r.kind, 'doc_date', r.next_date, 'post', r.auto_post and acc_perm('acc_post'), 'notes', coalesce(r.payload->>'notes', '') || ' (recurring: ' || r.name || ')'));
        made := made + 1; res := res || jsonb_build_array(jsonb_build_object('name', r.name, 'date', r.next_date, 'number', out->>'number', 'status', out->>'status'));
        update acc_recurring set last_run = r.next_date, runs = runs + 1, last_error = null where id = r.id;
      exception when others then
        failed := failed + 1; update acc_recurring set last_error = sqlerrm where id = r.id; exit;
      end;
      r.next_date := (r.next_date + step)::date;
      update acc_recurring set next_date = r.next_date where id = r.id;
    end loop;
  end loop;
  if made + failed > 0 then perform acc_audit_log(tid, 'run_recurring', 'recurring', null, null, jsonb_build_object('created', made, 'failed', failed)); end if;
  return jsonb_build_object('created', made, 'failed', failed, 'items', res);
end $$;

-- ---------- share an invoice by an unguessable link (no login), like the salon invoices ----------
alter table acc_documents add column share_token text unique;

create function acc_share_document(p_doc uuid, p_enable boolean default true) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; tok text;
begin
  tid := acc_guard('acc_view');
  if not (acc_perm('acc_sales') or acc_perm('acc_purchase')) then raise exception 'Your role does not allow sharing documents'; end if;
  if p_enable then
    update acc_documents set share_token = coalesce(share_token, replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
      where id = p_doc and tenant_id = tid and doc_type in ('invoice', 'credit_note', 'quotation', 'sales_order', 'delivery_challan') and status in ('posted', 'open', 'converted') returning share_token into tok;
    if tok is null then raise exception 'Only posted invoices and open quotes/orders can be shared'; end if;
  else
    update acc_documents set share_token = null where id = p_doc and tenant_id = tid;
  end if;
  perform acc_audit_log(tid, case when p_enable then 'share' else 'unshare' end, 'document', p_doc::text, null, null);
  return jsonb_build_object('token', tok);
end $$;

-- anonymous: whoever holds the link may read that one document (no totals for any other record)
create function public_acc_document(p_token text) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare d acc_documents; o acc_org;
begin
  if p_token is null or length(p_token) < 40 then return null; end if;
  select * into d from acc_documents where share_token = p_token;
  if d.id is null then return null; end if;
  select * into o from acc_org where tenant_id = d.tenant_id;
  return jsonb_build_object(
    'org', jsonb_build_object('name', coalesce(o.trade_name, o.legal_name), 'legal_name', o.legal_name, 'gstin', o.gstin, 'pan', o.pan, 'address', o.address, 'city', o.city, 'pincode', o.pincode, 'phone', o.phone, 'email', o.email,
                              'bank_details', o.bank_details, 'footer', o.invoice_footer, 'state_code', o.state_code),
    'doc', jsonb_build_object('type', d.doc_type, 'number', d.number, 'date', d.doc_date, 'due_date', d.due_date, 'party_name', d.party_name, 'party_gstin', d.party_gstin, 'billing_address', d.billing_address,
                              'shipping_address', d.shipping_address, 'place_of_supply', d.place_of_supply, 'supply_type', d.supply_type, 'reverse_charge', d.reverse_charge, 'subtotal', d.subtotal, 'discount', d.discount, 'taxable', d.taxable,
                              'cgst', d.cgst, 'sgst', d.sgst, 'igst', d.igst, 'cess', d.cess, 'roundoff', d.roundoff, 'total', d.total, 'paid', d.paid, 'status', acc_doc_status(d), 'notes', d.notes, 'terms', d.terms,
                              'payment_terms', d.payment_terms, 'cancelled', d.status = 'cancelled'),
    'lines', (select coalesce(jsonb_agg(jsonb_build_object('n', l.line_no, 'description', l.description, 'hsn', l.hsn, 'qty', l.qty, 'unit', l.unit, 'rate', l.rate, 'disc_amt', l.disc_amt, 'taxable', l.taxable,
                                'tax_rate', l.tax_rate, 'tax', l.cgst + l.sgst + l.igst + l.cess, 'total', l.total) order by l.line_no), '[]') from acc_doc_lines l where l.doc_id = d.id),
    'einvoice', (select jsonb_build_object('irn', irn, 'ack_no', ack_no, 'qr', signed_qr) from acc_einvoice where doc_id = d.id and status = 'generated'));
end $$;

-- attachments live in private storage and are fetched through the authenticated API, never a public /uploads URL
create or replace function acc_add_attachment(p_entity text, p_id uuid, p_name text, p_url text, p_size int default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; aid uuid;
begin
  tid := acc_guard('acc_view');
  if not (acc_perm('acc_sales') or acc_perm('acc_purchase')) then raise exception 'Your role does not allow attaching files'; end if;
  if p_entity not in ('document', 'payment', 'asset', 'journal') then raise exception 'Cannot attach to %', p_entity; end if;
  if p_url !~ ('^/storage/acc/' || tid::text || '/[A-Za-z0-9_.-]+$') then raise exception 'Upload the file first'; end if;
  insert into acc_attachments (tenant_id, entity, entity_id, name, url, size_bytes, created_by) values (tid, p_entity, p_id, left(p_name, 200), p_url, p_size, app_uid()) returning id into aid;
  perform acc_audit_log(tid, 'attach', p_entity, p_id::text, null, jsonb_build_object('name', p_name));
  return jsonb_build_object('id', aid);
end $$;

create function acc_remove_attachment(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := acc_guard('acc_view');
  if not (acc_perm('acc_sales') or acc_perm('acc_purchase')) then raise exception 'Your role does not allow removing files'; end if;
  delete from acc_attachments where id = p_id and tenant_id = tid;
  perform acc_audit_log(tid, 'detach', 'attachment', p_id::text, null, null);
  return jsonb_build_object('ok', true);
end $$;

-- readiness probe for the storage routes in server/src/index.js: raises unless accounting is on and the caller may attach
create function acc_storage_check() returns boolean language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := acc_guard('acc_view');
  return acc_perm('acc_sales') or acc_perm('acc_purchase');
end $$;
