-- A bill number that was already used made "Complete sale" fail with: duplicate key value violates unique constraint "sty_sales_tenant_id_seq_key".
-- The bill counter had fallen behind the bills already saved (for example after a restore or data copied in). From now on the next bill
-- number is always one above the highest saved one, and every counter is repaired now. Safe to run again.
create or replace function sty_next(tid uuid, key_ text) returns bigint language plpgsql security definer set search_path = public as $$
declare v_n bigint; v_floor bigint := 0;
begin
  if key_ = 'sale' then select coalesce(max(seq), 0) into v_floor from sty_sales where tenant_id = tid; end if;
  insert into sty_counters as c (tenant_id, k, n) values (tid, key_, greatest(1, v_floor + 1))
    on conflict on constraint sty_counters_pkey do update set n = greatest(c.n, v_floor) + 1 returning c.n into v_n;
  return v_n;
end $$;

insert into sty_counters (tenant_id, k, n)
  select tenant_id, 'sale', max(seq) from sty_sales group by tenant_id
  on conflict on constraint sty_counters_pkey do update set n = greatest(sty_counters.n, excluded.n);
-- Rollback: put back the plain version from db/215 (increment only).
