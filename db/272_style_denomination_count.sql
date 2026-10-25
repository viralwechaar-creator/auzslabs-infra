-- AUZsStyle: denomination counting at shift close (owner request, second of three cash-handling features). Closing
-- a shift used to ask for one typed "counted cash" number -- easy to mistype, and gives no record of which notes
-- were actually in the drawer. Now the cashier counts how many of each note/coin there are; the total is the sum
-- of count x value, computed server-side (never trusted from the client), stored alongside the breakdown so a
-- disagreement can be checked against the real notes later.
alter table sty_shifts add column if not exists denominations jsonb;

-- Replaces sty_shift_close (db/216): p gains an optional `denominations` object, e.g. {"500":2,"200":1,"100":5}
-- (string keys because that's how JSON objects come back from the browser; values are counts, not amounts).
-- When present, it is the source of truth for countedCash -- a `countedCash` the client also sends is ignored in
-- that case, so the stored total can never drift from the stored breakdown. DENOMS is the fixed, valid set of
-- Indian currency values; an unknown key is rejected rather than silently ignored, since a typo there would
-- otherwise just lose money from the count with no error.
create or replace function sty_shift_close(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; cur jsonb; sid uuid; denoms jsonb; counted numeric; valid_denoms int[] := array[500,200,100,50,20,10,5,2,1]; row_ record;
begin
  tid := sty_guard('sty_sell');
  cur := sty_shift_current();
  if cur is null then raise exception 'No shift is open'; end if;
  sid := (cur->>'id')::uuid;
  denoms := p->'denominations';
  if denoms is not null and jsonb_typeof(denoms) = 'object' then
    counted := 0;
    for row_ in select * from jsonb_each_text(denoms) loop
      if not (row_.key::int = any(valid_denoms)) then raise exception '% is not a real note or coin value', row_.key using errcode = 'ST013'; end if;
      if nullif(row_.value, '')::int < 0 then raise exception 'A count cannot be negative' using errcode = 'ST014'; end if;
      counted := counted + row_.key::int * coalesce(nullif(row_.value, '')::int, 0);
    end loop;
  else
    denoms := null; counted := nullif(p->>'countedCash', '')::numeric;
  end if;
  update sty_shifts set ended_at = now(), expected_cash = (cur->>'expectedCash')::numeric, counted_cash = counted, denominations = denoms, note = p->>'note' where id = sid;
  return jsonb_build_object('ok', true, 'expectedCash', cur->'expectedCash', 'countedCash', counted,
    'difference', coalesce(counted, 0) - (cur->>'expectedCash')::numeric);
end $$;

-- Replaces sty_list_shifts (db/270): adds the denomination breakdown to shift history rows (null for shifts
-- closed before this, or closed with a plain typed total instead of a count).
create or replace function sty_list_shifts(p_limit int default 40) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid;
begin
  tid := sty_guard('sty_reports');
  return coalesce((select jsonb_agg(jsonb_build_object('id', h.id, 'branchId', h.branch_id, 'staff', (select coalesce(nullif(p.name, ''), p.email) from profiles p where p.id = h.user_id),
      'startedAt', h.started_at, 'endedAt', h.ended_at, 'opening', h.opening_cash, 'expected', h.expected_cash, 'counted', h.counted_cash, 'denominations', h.denominations,
      'cashIn', (select coalesce(sum(amount), 0) from sty_cash_moves m where m.shift_id = h.id and m.kind = 'in'),
      'cashOut', (select coalesce(sum(amount), 0) from sty_cash_moves m where m.shift_id = h.id and m.kind = 'out'),
      'difference', case when h.counted_cash is not null then h.counted_cash - h.expected_cash end) order by h.started_at desc)
    from (select * from sty_shifts where tenant_id = tid order by started_at desc limit p_limit) h), '[]'::jsonb);
end $$;
