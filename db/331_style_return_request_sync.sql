-- AUZsStyle: close the loop automatically when a staff member processes a return/exchange directly
-- (Bills -> Shop bills, not through the Return requests queue) for a bill that also has a pending
-- customer return request on it (db/331). Without this, the request stayed "Pending" forever even
-- though the item was already physically taken back and restocked -- and if the owner later opened
-- that stale request and tapped "Process now", the pre-filled return screen had nothing left to pick
-- (the line was already fully returned), landing on "Pick what is coming back" with no explanation.
-- Replaces sty_return (db/271): only change is the new update at the end, everything above is identical.
create or replace function sty_return(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; rid uuid; s sty_sales; st sty_settings; e jsonb; sl sty_sale_lines; q int; amt numeric; refund numeric := 0; mode_ text; dmg boolean; clawback int;
begin
  tid := sty_guard('sty_sell');
  rid := (p->>'id')::uuid;
  if exists (select 1 from sty_returns where id = rid and tenant_id = tid) then return sty_sale_json(tid, (select sale_id from sty_returns where id = rid)) || jsonb_build_object('duplicate', true); end if;
  select * into s from sty_sales where id = (p->>'saleId')::uuid and tenant_id = tid for update;
  if s.id is null then raise exception 'bill not found'; end if;
  if s.status = 'void' then raise exception 'That bill was cancelled'; end if;
  select * into st from sty_settings where tenant_id = tid;
  if now() - s.at > make_interval(days => st.return_days) and not sty_perm('sty_manage') then
    raise exception 'Returns after % days need a manager', st.return_days using errcode = 'ST005';
  end if;
  mode_ := coalesce(p->>'mode', 'cash');
  if mode_ in ('credit_note', 'exchange') and s.customer_id is null then raise exception 'Pick the customer first to give store credit' using errcode = 'ST007'; end if;
  if jsonb_array_length(coalesce(p->'lines', '[]'::jsonb)) = 0 then raise exception 'Pick what is coming back' using errcode = 'ST004'; end if;
  insert into sty_returns (id, tenant_id, sale_id, branch_id, customer_id, staff_id, mode, reason, refund, exchange_sale_id)
  values (rid, tid, s.id, s.branch_id, s.customer_id, app_uid(), mode_, p->>'reason', 0, nullif(p->>'exchangeSaleId', '')::uuid);
  for e in select * from jsonb_array_elements(p->'lines') loop
    select * into sl from sty_sale_lines where id = (e->>'saleLineId')::uuid and sale_id = s.id for update;
    if sl.id is null then raise exception 'line not on this bill'; end if;
    q := (e->>'qty')::int; dmg := coalesce((e->>'damaged')::boolean, false);
    if q is null or q <= 0 or q > sl.qty - sl.returned then raise exception '% : only % can come back', sl.style_name, sl.qty - sl.returned using errcode = 'ST009'; end if;
    amt := round(sl.net / sl.qty * q, 2); refund := refund + amt;
    update sty_sale_lines set returned = returned + q where id = sl.id;
    insert into sty_return_lines (tenant_id, return_id, sale_line_id, variant_id, qty, amount, damaged) values (tid, rid, sl.id, sl.variant_id, q, amt, dmg);
    insert into sty_stock_moves (tenant_id, branch_id, variant_id, qty, dmg, kind, ref_type, ref_id, unit_cost, staff_id, note)
    values (tid, s.branch_id, sl.variant_id, case when dmg then 0 else q end, case when dmg then q else 0 end, case when mode_ = 'exchange' then 'exchange_in' else 'return' end,
      'return', rid, sl.cost, app_uid(), p->>'reason');
  end loop;
  update sty_returns r set refund = (select coalesce(sum(amount), 0) from sty_return_lines where return_id = rid) where r.id = rid;
  if s.customer_id is not null then
    clawback := floor(s.points_earned * refund / nullif(s.total, 0))::int;
    update sty_customers set points = greatest(points - coalesce(clawback, 0), 0),
      credit = credit + case when mode_ in ('credit_note', 'exchange') then refund else 0 end where id = s.customer_id;
  end if;
  -- Auto-close any pending customer return request on this bill whose requested lines have nothing
  -- returnable left (this return -- whether it came from the request or was done independently -- already
  -- covered all of it). A request still owed some qty stays pending.
  update sty_return_requests rr set status = 'completed', return_id = rid, decided_by = app_uid(), decided_at = now()
    where rr.sale_id = s.id and rr.status = 'pending'
      and not exists (
        select 1 from jsonb_array_elements(rr.lines) rl
        join sty_sale_lines sl2 on sl2.id = (rl->>'saleLineId')::uuid
        where sl2.qty - sl2.returned > 0
      );
  perform sty_audit_log(tid, 'return', rid::text, jsonb_build_object('sale', s.number, 'refund', refund, 'mode', mode_));
  return sty_sale_json(tid, s.id);
end $$;
-- Replaces public_sty_sale_return_request (db/330): only change is the notification's own type
-- ('style_return_request' instead of 'store_return', which the bell's noteTarget() already used for
-- the ONLINE web-order return flow -- reusing it here sent a counter-sale request notification to the
-- "Online store" page's Orders tab, which is always empty for a counter-sale bill). shell.js is updated
-- in the same change to route this type to Bills -> Return requests instead.
create or replace function public_sty_sale_return_request(p_token text, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare s sty_sales; st sty_settings; e jsonb; sl sty_sale_lines; q int; mode_ text; snap jsonb := '[]'::jsonb; cust_name text;
begin
  if p_token is null or length(p_token) < 8 or length(p_token) > 32 then raise exception 'Bill not found' using errcode = 'ST002'; end if;
  select * into s from sty_sales where share_token = lower(p_token);
  if not found then raise exception 'Bill not found' using errcode = 'ST002'; end if;
  if s.status = 'void' then raise exception 'This bill was cancelled' using errcode = 'ST002'; end if;
  select * into st from sty_settings where tenant_id = s.tenant_id;
  if not coalesce(st.allow_return_requests, false) then raise exception 'This store does not accept return requests online' using errcode = 'ST002'; end if;
  if now() - s.at > make_interval(days => coalesce(st.return_days, 30)) then raise exception 'The % day return window for this bill has ended', coalesce(st.return_days, 30) using errcode = 'ST002'; end if;
  if exists (select 1 from sty_return_requests where sale_id = s.id and status = 'pending') then raise exception 'You already have a request open for this bill' using errcode = 'ST002'; end if;
  mode_ := coalesce(p->>'mode', 'return'); if mode_ not in ('return', 'exchange') then raise exception 'Choose return or exchange' using errcode = 'ST002'; end if;
  if length(trim(coalesce(p->>'reason', ''))) < 3 then raise exception 'Tell us why' using errcode = 'ST002'; end if;
  if jsonb_array_length(coalesce(p->'lines', '[]'::jsonb)) = 0 then raise exception 'Pick what you want to bring back' using errcode = 'ST002'; end if;
  for e in select * from jsonb_array_elements(p->'lines') loop
    select * into sl from sty_sale_lines where id = nullif(e->>'saleLineId', '')::uuid and sale_id = s.id;
    if sl.id is null then raise exception 'That item is not on this bill' using errcode = 'ST002'; end if;
    q := (e->>'qty')::int;
    if q is null or q <= 0 or q > sl.qty - sl.returned then raise exception '% : only % can come back', sl.style_name, sl.qty - sl.returned using errcode = 'ST002'; end if;
    snap := snap || jsonb_build_object('saleLineId', sl.id, 'name', sl.style_name, 'colour', sl.colour, 'size', sl.size, 'qty', q);
  end loop;
  insert into sty_return_requests (tenant_id, sale_id, mode, reason, lines) values (s.tenant_id, s.id, mode_, left(trim(p->>'reason'), 200), snap);
  select coalesce(c.name, 'A customer') into cust_name from sty_customers c where c.id = s.customer_id;
  begin
    insert into notifications (tenant_id, type, title, body) values (s.tenant_id, 'style_return_request', 'Return request for bill ' || s.number, cust_name || ' asked for a ' || mode_);
    perform pg_notify('push_events', jsonb_build_object('tenant_id', s.tenant_id, 'title', 'Return request ' || s.number, 'body', cust_name || ': ' || mode_, 'url', '/style.html#/bills')::text);
  exception when others then null; end;
  return jsonb_build_object('ok', true);
end $$;
-- Rollback: restore sty_return from db/271 and public_sty_sale_return_request from db/330 (drops the
-- trailing sty_return_requests auto-close update and reverts the notification type to 'store_return').
