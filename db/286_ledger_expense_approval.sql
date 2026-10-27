-- AUZsLedger: expense approval flow. Staff ask, a manager approves, someone else (owner/accountant) pays.
-- Nothing reaches the books until it is paid: paying posts a normal paid expense document, so every report,
-- GST and integrity rule applies as usual. The person who asked can never approve or pay their own request.
create table if not exists acc_expense_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  requested_by uuid not null, req_date date not null default current_date,
  description text not null, amount numeric(16,2) not null check (amount > 0),
  account_id uuid references acc_accounts(id),   -- expense account (null = general expenses)
  party_id uuid references acc_parties(id),
  note text,
  status text not null default 'pending' check (status in ('pending','approved','rejected','paid','cancelled')),
  decided_by uuid, decided_at timestamptz, decision_note text,
  paid_by uuid, paid_at timestamptz, document_id uuid references acc_documents(id),
  created_at timestamptz not null default now()
);
create index if not exists acc_exp_req_t on acc_expense_requests (tenant_id, status, created_at);
alter table acc_expense_requests enable row level security;

-- p: {description, amount, date?, account_id?, party_id?, note?}
create or replace function acc_expense_request_save(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; rid uuid; amt numeric := (p->>'amount')::numeric;
begin
  tid := acc_guard('acc_sales');
  if coalesce(btrim(p->>'description'), '') = '' then raise exception 'Say what the money is for'; end if;
  if amt is null or amt <= 0 then raise exception 'Amount must be greater than zero'; end if;
  if nullif(p->>'account_id', '') is not null and not exists (select 1 from acc_accounts where id = (p->>'account_id')::uuid and tenant_id = tid and type = 'expense') then raise exception 'Choose an expense account'; end if;
  if nullif(p->>'party_id', '') is not null and not exists (select 1 from acc_parties where id = (p->>'party_id')::uuid and tenant_id = tid) then raise exception 'Unknown party'; end if;
  insert into acc_expense_requests (tenant_id, requested_by, req_date, description, amount, account_id, party_id, note)
  values (tid, app_uid(), coalesce(nullif(p->>'date', '')::date, current_date), btrim(p->>'description'), amt, nullif(p->>'account_id', '')::uuid, nullif(p->>'party_id', '')::uuid, nullif(btrim(coalesce(p->>'note', '')), ''))
  returning id into rid;
  perform acc_audit_log(tid, 'create', 'expense_request', rid::text, null, jsonb_build_object('amount', amt));
  return jsonb_build_object('id', rid);
end $$;

-- everybody sees their own; people who can approve (acc_purchase) see all. p: {status?}
create or replace function acc_expense_request_list(p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; st text := nullif(p->>'status', ''); can_all boolean;
begin
  tid := acc_guard('acc_view');
  can_all := acc_perm('acc_purchase');
  return jsonb_build_object('can_approve', can_all, 'can_pay', acc_perm('acc_admin') or acc_perm('acc_post'), 'rows', coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (
    select r.id, r.req_date, r.description, r.amount, r.status, r.note, r.decision_note, r.created_at, r.account_id, ac.name as account_name, r.party_id, pa.name as party_name,
           r.requested_by, coalesce(nullif(rq.name, ''), rq.email) as requester, r.requested_by = app_uid() as mine, r.document_id,
           coalesce(nullif(dc.name, ''), dc.email) as decider, r.paid_at
      from acc_expense_requests r
      left join acc_accounts ac on ac.id = r.account_id left join acc_parties pa on pa.id = r.party_id
      left join profiles rq on rq.id = r.requested_by left join profiles dc on dc.id = r.decided_by
     where r.tenant_id = tid and (can_all or r.requested_by = app_uid()) and (st is null or r.status = st)
     order by r.created_at desc limit 300) x), '[]'));
end $$;

-- approve or reject. The person who asked cannot decide their own request.
create or replace function acc_expense_request_decide(p_id uuid, p_decision text, p_note text default null) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; r acc_expense_requests;
begin
  tid := acc_guard('acc_purchase');
  if p_decision not in ('approve', 'reject') then raise exception 'Choose approve or reject'; end if;
  select * into r from acc_expense_requests where id = p_id and tenant_id = tid for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.status <> 'pending' then raise exception 'This request is already %', r.status; end if;
  if r.requested_by = app_uid() then raise exception 'You cannot approve your own request - ask another manager'; end if;
  if p_decision = 'reject' and coalesce(btrim(p_note), '') = '' then raise exception 'Say why it is rejected'; end if;
  update acc_expense_requests set status = case p_decision when 'approve' then 'approved' else 'rejected' end, decided_by = app_uid(), decided_at = now(), decision_note = nullif(btrim(coalesce(p_note, '')), '') where id = p_id;
  perform acc_audit_log(tid, p_decision, 'expense_request', p_id::text, null, jsonb_build_object('note', p_note));
  return jsonb_build_object('ok', true);
end $$;

-- pay an approved request: posts a paid expense. p: {id, account_id (cash/bank), mode?, reference?, date?}
create or replace function acc_expense_request_pay(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; r acc_expense_requests; d date := coalesce(nullif(p->>'date', '')::date, current_date); res jsonb; ca acc_accounts;
begin
  tid := acc_guard('acc_purchase');
  perform acc_guard('acc_post');
  select * into r from acc_expense_requests where id = (p->>'id')::uuid and tenant_id = tid for update;
  if r.id is null then raise exception 'Request not found'; end if;
  if r.status <> 'approved' then raise exception 'Only an approved request can be paid (this one is %)', r.status; end if;
  if r.requested_by = app_uid() then raise exception 'You cannot pay your own request - ask another person'; end if;
  select * into ca from acc_accounts where id = (p->>'account_id')::uuid and tenant_id = tid and (is_cash or is_bank);
  if ca.id is null then raise exception 'Choose the cash or bank account to pay from'; end if;
  res := acc_save_document(jsonb_build_object('doc_type', 'expense', 'doc_date', d, 'party_id', r.party_id, 'post', true, 'notes', 'Approved request: ' || r.description,
    'lines', jsonb_build_array(jsonb_build_object('description', r.description, 'qty', 1, 'rate', r.amount, 'tax_rate', 0, 'account_id', r.account_id)),
    'payments', jsonb_build_array(jsonb_build_object('account_id', ca.id, 'amount', r.amount, 'mode', coalesce(nullif(p->>'mode', ''), case when ca.is_cash then 'Cash' else 'Bank' end), 'reference', p->>'reference'))));
  if not coalesce((res->>'posted')::boolean, false) then raise exception 'The books need an extra approval for this amount before it can be paid'; end if;
  update acc_expense_requests set status = 'paid', paid_by = app_uid(), paid_at = now(), document_id = nullif(res->>'id', '')::uuid where id = r.id;
  perform acc_audit_log(tid, 'pay', 'expense_request', r.id::text, null, jsonb_build_object('document', res->>'id'));
  return jsonb_build_object('ok', true, 'document_id', res->>'id', 'number', res->>'number');
end $$;

create or replace function acc_expense_request_cancel(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid;
begin
  tid := acc_guard('acc_sales');
  update acc_expense_requests set status = 'cancelled' where id = p_id and tenant_id = tid and status = 'pending' and requested_by = app_uid();
  if not found then raise exception 'Only your own pending request can be cancelled'; end if;
  return jsonb_build_object('ok', true);
end $$;
