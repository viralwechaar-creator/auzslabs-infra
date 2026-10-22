-- Owner report: AUZsStyle's own return/exchange status editor (app/public/style/p-store.js, "Online
-- store" -> the returns list) let the owner jump to ANY of the 5 statuses at any time -- `RS.filter(x =>
-- x !== r.status)` built one button per OTHER status, with no sequencing at all, and sty_web_return_set
-- (db/232) only ever checked the new value was one of the 5 known strings, never that it was a valid next
-- step from where the request already was. This is the real, separate AUZsStyle counterpart to the generic
-- AUZslab POS's own return/exchange fix (db/246) -- same complaint, same real stage graph wanted, but a
-- different app/table (sty_web_returns, not records kind='returnreq'), so it needed its own fix here.
--
-- Same graph as db/246: requested -> approved | rejected -> received -> refunded, one way only; a request
-- already at a terminal status (rejected or refunded) can never be moved again. Deciding (approved/
-- rejected) and finishing (refunded) are money/trust decisions -- gated on sty_manage, same bar every
-- other owner-level AUZsStyle action already uses; marking received stays open to anyone with sty_sell
-- (physically checking a returned item back in needs no special permission).
create or replace function sty_web_return_set(p_id uuid, p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; cur text; nxt text;
begin
  tid := sty_guard('sty_sell');
  select status into cur from sty_web_returns where id = p_id and tenant_id = tid;
  if cur is null then raise exception 'That return or exchange request was not found' using errcode = 'ST002'; end if;

  if p ? 'status' then
    nxt := p->>'status';
    if nxt not in ('requested', 'approved', 'rejected', 'received', 'refunded') then raise exception 'bad status' using errcode = 'ST002'; end if;
    if nxt <> cur then
      if cur in ('rejected', 'refunded') then
        raise exception 'This request is already % and cannot be changed', cur using errcode = 'ST002';
      elsif cur = 'requested' and nxt in ('approved', 'rejected') then
        if not sty_perm('sty_manage') then raise exception 'Only a manager can approve or reject a return or exchange' using errcode = '42501'; end if;
      elsif cur = 'approved' and nxt = 'received' then
        null; -- any staffer may mark the item physically received back
      elsif cur = 'received' and nxt = 'refunded' then
        if not sty_perm('sty_manage') then raise exception 'Only a manager can finish a refund or exchange' using errcode = '42501'; end if;
      else
        raise exception 'A return/exchange request must go requested -> approved/rejected -> received -> refunded, one step at a time' using errcode = 'ST002';
      end if;
    end if;
  end if;

  update sty_web_returns set status = coalesce(p->>'status', status), staff_note = case when p ? 'staffNote' then left(p->>'staffNote', 400) else staff_note end, updated_at = now() where id = p_id and tenant_id = tid;
  perform sty_audit_log(tid, 'web_return.update', p_id::text, p);
  return jsonb_build_object('ok', true);
end $$;
