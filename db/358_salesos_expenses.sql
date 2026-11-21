-- AUZslab SalesOS: field expenses with manager approval. Reuses the existing private-upload
-- pattern (server/src/storage.js's saveDocUpload/readDocUpload) for receipt images, scoped by
-- expense id, authenticated both ways (never anonymous like the public resume upload).
create table sos_expenses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  staff_id uuid not null references auth_users(id) on delete cascade,
  category text not null check (category in ('fuel', 'travel', 'transportation', 'food', 'accommodation', 'other')),
  amount numeric not null check (amount > 0),
  expense_date date not null default current_date,
  purpose text,
  visit_id uuid references sos_visits(id) on delete set null,
  receipt_file text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'reimbursed')),
  reviewed_by uuid references auth_users(id),
  reviewed_at timestamptz,
  reject_reason text,
  created_at timestamptz not null default now()
);
create index idx_sos_expenses_staff on sos_expenses (tenant_id, staff_id, expense_date desc);
alter table sos_expenses enable row level security;

create function sos_expense_submit(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_field'); row sos_expenses%rowtype;
begin
  if coalesce((p->>'amount')::numeric, 0) <= 0 then raise exception 'Enter an amount above 0'; end if;
  if nullif(p->>'category', '') is null then raise exception 'Choose a category'; end if;
  insert into sos_expenses (tenant_id, staff_id, category, amount, expense_date, purpose, visit_id)
  values (tid, app_uid(), p->>'category', (p->>'amount')::numeric, coalesce(nullif(p->>'expenseDate', '')::date, current_date),
    nullif(p->>'purpose', ''), nullif(p->>'visitId', '')::uuid)
  returning * into row;
  return to_jsonb(row);
end $$;

-- Attaches a receipt previously uploaded via the authenticated /storage/sos-expense-receipt route.
create function sos_expense_attach_receipt(p_id uuid, p_filename text) returns boolean
language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_field');
begin
  update sos_expenses set receipt_file = p_filename where id = p_id and tenant_id = tid and staff_id = app_uid() and status = 'pending';
  return found;
end $$;

create function sos_my_expenses() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_field');
begin
  return coalesce((select jsonb_agg(to_jsonb(e) order by e.expense_date desc) from sos_expenses e
    where e.tenant_id = tid and e.staff_id = app_uid()), '[]'::jsonb);
end $$;

create function sos_all_expenses(p_status text default 'pending') returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_manage');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'staffName', coalesce(p.name, u.email),
      'category', e.category, 'amount', e.amount, 'expenseDate', e.expense_date, 'purpose', e.purpose,
      'status', e.status, 'hasReceipt', e.receipt_file is not null) order by e.expense_date desc)
    from sos_expenses e join auth_users u on u.id = e.staff_id left join profiles p on p.id = e.staff_id
    where e.tenant_id = tid and (p_status = 'all' or e.status = p_status)), '[]'::jsonb);
end $$;

create function sos_expense_review(p_id uuid, p_decision text, p_reject_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare tid uuid := sos_guard('sos_manage'); row sos_expenses%rowtype;
begin
  if p_decision not in ('approved', 'rejected', 'reimbursed') then raise exception 'unknown decision: %', p_decision; end if;
  update sos_expenses set status = p_decision, reviewed_by = app_uid(), reviewed_at = now(),
    reject_reason = case when p_decision = 'rejected' then p_reject_reason else reject_reason end
  where id = p_id and tenant_id = tid
  returning * into row;
  if not found then raise exception 'expense not found'; end if;
  return to_jsonb(row);
end $$;

create function sos_expense_receipt(p_id uuid) returns text language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sos_guard(); e sos_expenses%rowtype;
begin
  select * into e from sos_expenses where id = p_id and tenant_id = tid;
  if not found then raise exception 'expense not found'; end if;
  if not (e.staff_id = app_uid() or sos_perm('sos_manage')) then raise exception 'not authorized'; end if;
  return e.receipt_file;
end $$;

grant select, insert, update on sos_expenses to app;
grant execute on function sos_expense_submit(jsonb) to app;
grant execute on function sos_expense_attach_receipt(uuid, text) to app;
grant execute on function sos_my_expenses() to app;
grant execute on function sos_all_expenses(text) to app;
grant execute on function sos_expense_review(uuid, text, text) to app;
grant execute on function sos_expense_receipt(uuid) to app;
