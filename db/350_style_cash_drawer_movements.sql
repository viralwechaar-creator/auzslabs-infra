alter table sty_cash_moves
  add column action text,
  add column counterparty text,
  add column movement_date date;

create or replace function sty_cash_move(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; cur jsonb; sid uuid; k text; amt numeric;
  action text := nullif(p->>'action', '');
  party text := nullif(btrim(p->>'counterparty'), '');
  movement_date date := nullif(p->>'movementDate', '')::date;
  move_id uuid := coalesce(nullif(p->>'id', '')::uuid, gen_random_uuid());
begin
  tid := sty_guard('sty_sell');
  cur := sty_shift_current(); if cur is null then raise exception 'Open a shift before logging cash in/out' using errcode = 'ST010'; end if;
  k := case action
    when 'bank_deposit' then 'out' when 'bank_withdrawal' then 'in'
    when 'lend' then 'out' when 'loan_repaid_to_us' then 'in'
    when 'borrow' then 'in' when 'loan_repayment' then 'out'
    when 'owner_in' then 'in' when 'owner_out' then 'out'
    else p->>'kind' end;
  if action is not null and (action not in ('bank_deposit','bank_withdrawal','lend','loan_repaid_to_us','borrow','loan_repayment','owner_in','owner_out')
      or party is null or length(party) > 160 or movement_date is null or movement_date > (now() at time zone 'Asia/Kolkata')::date) then
    raise exception 'Enter a valid cash movement date and bank account or counterparty';
  end if;
  if k is null or k not in ('in', 'out') then raise exception 'kind must be ''in'' or ''out''' using errcode = 'ST011'; end if;
  amt := nullif(p->>'amount', '')::numeric; if amt is null or amt <= 0 then raise exception 'Enter an amount above 0' using errcode = 'ST012'; end if;
  sid := (cur->>'id')::uuid;
  insert into sty_cash_moves (tenant_id, branch_id, shift_id, user_id, kind, amount, reason)
    values (tid, (cur->>'branchId')::uuid, sid, app_uid(), k, amt, nullif(trim(p->>'reason'), ''));
  perform sty_audit_log(tid, 'cash_move', sid::text, jsonb_build_object('kind', k, 'amount', amt, 'reason', p->>'reason', 'action', action, 'counterparty', party, 'movementDate', movement_date));
  return sty_shift_current();
end $$;

-- Lists this shift's cash moves, newest first; p_shift_id defaults to the caller's own open shift.
create or replace function sty_cash_moves_list(p_shift_id uuid default null) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; sid uuid; cur jsonb;
begin
  tid := sty_guard('sty_view');
  sid := p_shift_id;
  if sid is null then cur := sty_shift_current(); if cur is null then return '[]'::jsonb; end if; sid := (cur->>'id')::uuid; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'amount', m.amount, 'reason', m.reason, 'at', m.at, 'action', m.action, 'counterparty', m.counterparty, 'movementDate', m.movement_date,
      'staff', (select coalesce(nullif(pr.name, ''), pr.email) from profiles pr where pr.id = m.user_id)) order by m.at desc)
    from sty_cash_moves m where m.tenant_id = tid and m.shift_id = sid), '[]'::jsonb);
end $$;
