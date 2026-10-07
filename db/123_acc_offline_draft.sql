-- AUZsLedger: write a bill / expense / invoice / note while OFFLINE; it reaches the books as a DRAFT when the connection is back.
-- Accounting stays server-authoritative: nothing posted offline, no gapless number used offline, no stock or ledger moved.
-- acc_save_draft_offline() is idempotent on a client-made operation id, so a phone that retries after a lost reply never
-- creates a second draft. It can only create new drafts (never edit or post), whatever the client sends.
alter table acc_documents add column if not exists client_op text;
create unique index if not exists acc_documents_client_op_idx on acc_documents (tenant_id, client_op) where client_op is not null;

create or replace function acc_save_draft_offline(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tid uuid; op text := trim(coalesce(p->>'op', '')); dt text := p->>'doc_type'; existing acc_documents; res jsonb; q jsonb;
begin
  if op = '' or length(op) > 64 then raise exception 'An operation id (op, up to 64 characters) is required.'; end if;
  if dt is null or dt not in ('invoice', 'credit_note', 'bill', 'debit_note', 'expense') then
    raise exception 'Only invoices, credit notes, bills, debit notes and expenses can be saved offline.';
  end if;
  tid := acc_guard(case when dt in ('invoice', 'credit_note') then 'acc_sales' else 'acc_purchase' end);
  select * into existing from acc_documents where tenant_id = tid and client_op = op;
  if existing.id is not null then
    return jsonb_build_object('id', existing.id, 'number', existing.number, 'status', existing.status, 'posted', false, 'duplicate', true);
  end if;
  -- a new draft only: no id (no editing), no payments, never post
  q := (p - 'op' - 'id' - 'payments' - 'pay' - 'post') || '{"post": false}'::jsonb;
  res := acc_save_document(q);
  update acc_documents set client_op = op, meta = coalesce(meta, '{}'::jsonb) || '{"offline_draft": true}'::jsonb
    where id = (res->>'id')::uuid and tenant_id = tid;
  return res || jsonb_build_object('duplicate', false);
end $$;
