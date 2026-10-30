-- AUZsStyle bills: edit the details of a bill, delete a cancelled bill, and choose whether cancelling puts the items back in stock.
-- Manager only (sty_manage), every action is written to the audit log.
-- Cancel (sty_void_sale) gets a third argument p_restock (default true = items go back into stock, as before).
drop function if exists sty_void_sale(uuid, text);
create or replace function sty_void_sale(p_id uuid, p_reason text default null, p_restock boolean default true) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; s sty_sales; l record;
begin
  tid := sty_guard('sty_manage');
  select * into s from sty_sales where id = p_id and tenant_id = tid for update;
  if s.id is null then raise exception 'bill not found'; end if;
  if s.status = 'void' then return sty_sale_json(tid, p_id); end if;
  if exists (select 1 from sty_returns where sale_id = p_id) then raise exception 'This bill has returns; it cannot be cancelled' using errcode = 'ST008'; end if;
  if coalesce(p_restock, true) then
    for l in select * from sty_sale_lines where sale_id = p_id loop
      insert into sty_stock_moves (tenant_id, branch_id, variant_id, qty, kind, ref_type, ref_id, unit_cost, staff_id, note)
      values (tid, s.branch_id, l.variant_id, l.qty, 'void', 'sale', p_id, l.cost, app_uid(), 'Bill cancelled');
    end loop;
  end if;
  if s.customer_id is not null then
    update sty_customers set points = greatest(points + s.points_used - s.points_earned, 0), credit = credit + s.credit_used where id = s.customer_id;
  end if;
  update sty_sales set status = 'void', void_reason = p_reason, voided_at = now(), voided_by = app_uid() where id = p_id;
  perform sty_audit_log(tid, 'void_sale', p_id::text, jsonb_build_object('number', s.number, 'reason', p_reason, 'total', s.total, 'restock', coalesce(p_restock, true)));
  return sty_sale_json(tid, p_id);
end $$;

-- Edit the details of a bill that is not cancelled: who it was for (name, phone) and the note. Amounts and items stay as billed
-- (cancel and bill again, or take a return, to change those).
create or replace function sty_edit_sale(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; s sty_sales; cid uuid; cj jsonb; nm text := nullif(trim(coalesce(p->>'customerName', '')), ''); ph text := nullif(regexp_replace(coalesce(p->>'customerPhone', ''), '\D', '', 'g'), '');
begin
  tid := sty_guard('sty_manage');
  select * into s from sty_sales where id = p_id and tenant_id = tid for update;
  if s.id is null then raise exception 'bill not found'; end if;
  if s.status = 'void' then raise exception 'A cancelled bill cannot be edited' using errcode = 'ST008'; end if;
  if p ? 'customerName' or p ? 'customerPhone' then
    if nm is null and ph is null then
      if s.status = 'due' then raise exception 'A bill with a balance due needs a customer' using errcode = 'ST008'; end if;
      cid := null;
    else
      cj := sty_save_customer(jsonb_build_object('name', nm, 'phone', ph));
      cid := (cj ->> 'id')::uuid;
    end if;
    update sty_sales set customer_id = cid where id = p_id;
  end if;
  if p ? 'note' then update sty_sales set note = nullif(trim(coalesce(p->>'note', '')), '') where id = p_id; end if;
  perform sty_audit_log(tid, 'edit_sale', p_id::text, jsonb_build_object('number', s.number, 'before', jsonb_build_object('customer', s.customer_id, 'note', s.note), 'after', jsonb_build_object('customer', cid, 'note', p->>'note')));
  return sty_sale_json(tid, p_id);
end $$;

-- Delete a CANCELLED bill for good: the bill, its lines and its stock entries go (a cancelled bill that put the items back leaves stock unchanged;
-- one cancelled without putting them back brings the stock records back to where they were before the sale). Refused when the day is closed.
create or replace function sty_delete_sale(p_id uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; s sty_sales; dc date; net int;
begin
  tid := sty_guard('sty_manage');
  select * into s from sty_sales where id = p_id and tenant_id = tid for update;
  if s.id is null then raise exception 'bill not found'; end if;
  if s.status <> 'void' then raise exception 'Cancel the bill first, then it can be deleted' using errcode = 'ST008'; end if;
  select day_close_date into dc from sty_settings where tenant_id = tid;
  if dc is not null and (s.at at time zone 'Asia/Kolkata')::date <= dc then raise exception 'That day is closed; a bill from it cannot be deleted' using errcode = 'ST008'; end if;
  delete from sty_stock_moves where tenant_id = tid and ref_type = 'sale' and ref_id = p_id;
  update sty_web_orders set sale_id = null where tenant_id = tid and sale_id = p_id;
  delete from sty_sale_lines where sale_id = p_id;
  delete from sty_sales where id = p_id and tenant_id = tid;
  perform sty_audit_log(tid, 'delete_sale', p_id::text, jsonb_build_object('number', s.number, 'total', s.total, 'at', s.at, 'reason', s.void_reason));
  return jsonb_build_object('deleted', true, 'number', s.number);
end $$;
-- Rollback: drop the three functions' new versions and recreate sty_void_sale(uuid, text) from db/271.
