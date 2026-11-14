-- AuzsLedger/AuzsFinance document attachments were already visible to the AI connector through
-- ledger_get_document/finance_list_transactions -- but only as {name, url, size_bytes}, where `url` is a
-- relative path (e.g. /storage/acc/<tenant>/<file>) that needs a logged-in browser session cookie/JWT to
-- fetch. An MCP connector call authenticates with its own auz_mcp_* key (see mcp.js's own header comment),
-- so that path was never actually reachable by an AI caller -- it could see a receipt exists, never read it.
--
-- This adds one lookup function per app that, given an attachment's real id, re-checks the same tenant
-- ownership acc_guard/fin_guard already enforce everywhere else, then hands back enough to read the file
-- (never the raw bytes themselves -- that stays server-side, read directly off disk/object storage by
-- mcp.js using the exact same readDocUpload() the browser-facing GET routes already use).

-- acc_attachments rows (Ledger documents AND payments) already carry their own id -- acc_get_document's
-- 'attachments' field is `to_jsonb(a)`, the whole row, id included. Nothing to add there.
create or replace function acc_get_attachment(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; a acc_attachments;
begin
  tid := acc_guard('acc_view');
  select * into a from acc_attachments where id = p_id and tenant_id = tid;
  if a.id is null then raise exception 'Attachment not found'; end if;
  return jsonb_build_object('id', a.id, 'name', a.name, 'url', a.url, 'size_bytes', a.size_bytes, 'entity', a.entity, 'entity_id', a.entity_id);
end $$;

-- fin_txn_json's own 'files' array (db/255) only ever carried {name, url} -- add the real id so a connector
-- caller actually has something to pass to fin_get_attachment below. Purely additive, same two source
-- tables (fin_files is the current one; acc_attachments entity='fin_txn' is kept for files uploaded before
-- db/255 introduced fin_files).
create or replace function fin_txn_json(t fin_txns, tid uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select to_jsonb(t) || jsonb_build_object(
    'account', (select name from fin_accounts where id = t.account_id), 'to_account', (select name from fin_accounts where id = t.to_account_id),
    'category', (select name from acc_accounts where id = t.category_id), 'person', (select name from fin_people where id = t.person_id),
    'partner', (select name from fin_partners where id = t.partner_id), 'loan', (select counterparty from fin_loans where id = t.loan_id),
    'files', (select coalesce(jsonb_agg(x.f order by x.at), '[]') from (
        select jsonb_build_object('id', id, 'name', name, 'url', url) as f, created_at as at from fin_files where tenant_id = tid and txn_id = t.id
        union all
        select jsonb_build_object('id', id, 'name', name, 'url', url), created_at from acc_attachments where tenant_id = tid and entity = 'fin_txn' and entity_id = t.id) x),
    'journal_no', (select number from acc_journals where id = t.journal_id))
$$;

create or replace function fin_get_attachment(p_id uuid) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; r jsonb;
begin
  tid := fin_guard('view');
  select jsonb_build_object('id', id, 'name', name, 'url', url, 'size_bytes', size_bytes) into r from fin_files where id = p_id and tenant_id = tid;
  if r is null then
    select jsonb_build_object('id', id, 'name', name, 'url', url, 'size_bytes', size_bytes) into r from acc_attachments where id = p_id and tenant_id = tid and entity = 'fin_txn';
  end if;
  if r is null then raise exception 'Attachment not found'; end if;
  return r;
end $$;
