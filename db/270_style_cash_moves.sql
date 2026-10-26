-- AUZsStyle: cash in / cash out during an open shift (owner request). A shift's "expected cash" used to be just
-- opening + cash sales, with no place to log taking money out mid-day (change given to a delivery boy, a manager
-- deposit, owner's draw) or putting extra cash in. Append-only log, same pattern as every other sty_* table.
create table sty_cash_moves (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  branch_id uuid not null references sty_branches(id),
  shift_id uuid not null references sty_shifts(id),
  user_id uuid not null,
  kind text not null check (kind in ('in', 'out')),
  amount numeric(12,2) not null check (amount > 0),
  reason text,
  at timestamptz not null default now()
);
create index sty_cash_moves_t on sty_cash_moves(tenant_id, shift_id);
alter table sty_cash_moves enable row level security;

-- Replaces sty_shift_current (db/216): same signature and return shape, plus cashIn/cashOut/expectedCash now
-- accounting for them. expectedCash = opening + cash sales + cash in - cash out.
create or replace function sty_shift_current(p_branch uuid default null) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; sh sty_shifts; cash numeric; cin numeric; cout numeric;
begin
  tid := sty_guard('sty_view');
  select * into sh from sty_shifts where tenant_id = tid and user_id = app_uid() and ended_at is null order by started_at desc limit 1;
  if sh.id is null then return null; end if;
  select coalesce(sum((e->>'amount')::numeric), 0) into cash from sty_sales s, jsonb_array_elements(s.payments) e
    where s.tenant_id = tid and s.branch_id = sh.branch_id and s.at >= sh.started_at and s.status <> 'void' and e->>'mode' = 'cash';
  select coalesce(sum(amount) filter (where kind = 'in'), 0), coalesce(sum(amount) filter (where kind = 'out'), 0)
    into cin, cout from sty_cash_moves where shift_id = sh.id;
  return jsonb_build_object('id', sh.id, 'branchId', sh.branch_id, 'startedAt', sh.started_at, 'openingCash', sh.opening_cash,
    'cashSales', cash, 'cashIn', cin, 'cashOut', cout, 'expectedCash', sh.opening_cash + cash + cin - cout);
end $$;

-- A cash movement needs a currently-open shift (sty_shift_current() already enforces tenant/role via sty_guard).
-- kind: 'in' (extra cash added) or 'out' (cash removed), amount > 0 either way -- the sign comes from kind, not amount.
create or replace function sty_cash_move(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; cur jsonb; sid uuid; k text; amt numeric;
begin
  tid := sty_guard('sty_sell');
  cur := sty_shift_current(); if cur is null then raise exception 'Open a shift before logging cash in/out' using errcode = 'ST010'; end if;
  k := p->>'kind'; if k not in ('in', 'out') then raise exception 'kind must be ''in'' or ''out''' using errcode = 'ST011'; end if;
  amt := nullif(p->>'amount', '')::numeric; if not (amt > 0) then raise exception 'Enter an amount above 0' using errcode = 'ST012'; end if;
  sid := (cur->>'id')::uuid;
  insert into sty_cash_moves (tenant_id, branch_id, shift_id, user_id, kind, amount, reason)
    values (tid, (cur->>'branchId')::uuid, sid, app_uid(), k, amt, nullif(trim(p->>'reason'), ''));
  perform sty_audit_log(tid, 'cash_move', sid::text, jsonb_build_object('kind', k, 'amount', amt, 'reason', p->>'reason'));
  return sty_shift_current();
end $$;

-- Lists this shift's cash moves, newest first; p_shift_id defaults to the caller's own open shift.
create or replace function sty_cash_moves_list(p_shift_id uuid default null) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; sid uuid; cur jsonb;
begin
  tid := sty_guard('sty_view');
  sid := p_shift_id;
  if sid is null then cur := sty_shift_current(); if cur is null then return '[]'::jsonb; end if; sid := (cur->>'id')::uuid; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'amount', m.amount, 'reason', m.reason, 'at', m.at,
      'staff', (select coalesce(nullif(pr.name, ''), pr.email) from profiles pr where pr.id = m.user_id)) order by m.at desc)
    from sty_cash_moves m where m.tenant_id = tid and m.shift_id = sid), '[]'::jsonb);
end $$;

-- Replaces sty_list_shifts (db/216): adds cashIn/cashOut totals to the shift history list.
create or replace function sty_list_shifts(p_limit int default 40) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_guard('sty_reports');
  return coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'branchId', h.branch_id, 'staff', (select coalesce(nullif(p.name, ''), p.email) from profiles p where p.id = h.user_id),
      'startedAt', h.started_at, 'endedAt', h.ended_at, 'opening', h.opening_cash, 'expected', h.expected_cash, 'counted', h.counted_cash,
      'cashIn', (select coalesce(sum(amount), 0) from sty_cash_moves m where m.shift_id = h.id and m.kind = 'in'),
      'cashOut', (select coalesce(sum(amount), 0) from sty_cash_moves m where m.shift_id = h.id and m.kind = 'out'),
      'difference', case when h.counted_cash is not null then h.counted_cash - h.expected_cash end) order by h.started_at desc)
    from (select * from sty_shifts where tenant_id = tid order by started_at desc limit p_limit) h), '[]'::jsonb);
end $$;
