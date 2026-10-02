-- Clearer "insufficient stock" error: names the warehouse that was checked and where the stock actually is.
create or replace function acc_stock_move(tid uuid, pid uuid, wid uuid, d date, q numeric, cost numeric, k text, st text, sid uuid,
                               batch text default null, serial text default null, exp date default null, note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare p acc_products; o acc_org; have numeric; wname text; elsewhere text;
begin
  if q = 0 then return; end if;
  select * into p from acc_products where id = pid and tenant_id = tid;
  if p.id is null then raise exception 'Unknown product'; end if;
  if q < 0 then
    select * into o from acc_org where tenant_id = tid;
    have := acc_stock_qty(tid, pid, wid);
    if have + q < 0 and not o.allow_negative_stock then
      select name into wname from acc_warehouses where id = wid;
      select string_agg(w.name || ' ' || s.q::text, ', ' order by w.name) into elsewhere
        from (select warehouse_id, sum(qty) q from acc_stock_moves where tenant_id = tid and product_id = pid group by warehouse_id having sum(qty) > 0) s
        join acc_warehouses w on w.id = s.warehouse_id where s.warehouse_id <> wid;
      raise exception 'Insufficient stock for % in % (on hand %, needed %)%', p.name, coalesce(wname, 'this warehouse'), have, -q,
        case when elsewhere is not null then '. Stock is in: ' || elsewhere || ' - choose that warehouse on the invoice' else '' end using errcode = 'AC003';
    end if;
  end if;
  insert into acc_stock_moves (tenant_id, product_id, warehouse_id, move_date, qty, unit_cost, kind, source_type, source_id, batch_no, serial_no, expiry, note, created_by)
  values (tid, pid, wid, d, q, cost, k, st, sid, batch, serial, exp, note, app_uid());
end $$;
