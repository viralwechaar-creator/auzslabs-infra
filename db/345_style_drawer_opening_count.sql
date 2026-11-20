alter table sty_shifts add column if not exists opening_note text;
alter table sty_shifts add column if not exists opening_denominations jsonb;

create or replace function sty_shift_open(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  tid uuid := sty_guard('sty_sell');
  b uuid := coalesce(nullif(p->>'branchId', '')::uuid, sty_main_branch(tid));
  opening numeric := coalesce(nullif(p->>'openingCash', '')::numeric, 0);
  denoms jsonb := p->'denominations';
  item record;
begin
  perform pg_advisory_xact_lock(hashtext('sty-shift-open:' || tid || ':' || app_uid()));
  if not exists (select 1 from sty_branches where id = b and tenant_id = tid) then
    raise exception 'Branch not found';
  end if;
  if exists (select 1 from sty_shifts where tenant_id = tid and user_id = app_uid() and ended_at is null) then
    return sty_shift_current(b);
  end if;
  if denoms is not null then
    if jsonb_typeof(denoms) <> 'object' then raise exception 'Invalid cash count'; end if;
    opening := 0;
    for item in select * from jsonb_each_text(denoms) loop
      if item.key not in ('2000','500','200','100','50','20','10','5','2','1') or item.value is null or item.value !~ '^[0-9]+$' then
        raise exception 'Invalid note or coin count';
      end if;
      opening := opening + item.key::numeric * item.value::numeric;
    end loop;
  end if;
  if opening < 0 then raise exception 'Opening cash cannot be negative'; end if;
  insert into sty_shifts (tenant_id, branch_id, user_id, opening_cash, opening_note, opening_denominations)
  values (tid, b, app_uid(), opening, nullif(btrim(p->>'note'), ''), denoms);
  return sty_shift_current(b);
end $$;

create or replace function sty_drawer_history(p_branch uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tid uuid := sty_guard('sty_view');
begin
  return coalesce((select jsonb_agg(to_jsonb(r) order by r."startedAt" desc) from (
    select started_at as "startedAt", ended_at as "endedAt", opening_cash as "openingCash",
      expected_cash as "expectedCash", counted_cash as "countedCash", opening_note as "openingNote",
      opening_denominations as "openingDenominations", denominations, note
    from sty_shifts
    where tenant_id = tid and user_id = app_uid() and (p_branch is null or branch_id = p_branch)
    order by started_at desc limit 30
  ) r), '[]'::jsonb);
end $$;
revoke execute on function sty_drawer_history(uuid) from public;
grant execute on function sty_drawer_history(uuid) to app;
