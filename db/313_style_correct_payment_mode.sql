-- AUZsStyle: correct a bill's recorded payment mode(s) after the fact, without touching its items, total or stock.
--
-- Found this because a cashier picked UPI on the Pay sheet but it got recorded (and printed/shared) as Cash --
-- the Pay sheet used to pre-fill Cash with the full amount the instant it opened (fixed client-side in the same
-- change as this migration), so typing straight into UPI without tapping its own "Exact" button left that stale
-- Cash amount underneath. That already-saved bill still needs fixing by hand, and any future mis-click needs a
-- quick correction path too -- bills are otherwise a permanent record (see db/307's own comment: "cancel and
-- bill again" is the normal way to change a bill), so this is deliberately narrow: it can only change WHICH
-- method(s) the already-paid amount is attributed to, never the amount itself, never items or stock.
create function sty_correct_payment_mode(p_id uuid, p_payments jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid; s sty_sales; old_sum numeric; new_sum numeric; row_ jsonb; m text;
begin
  tid := sty_guard('sty_manage');
  select * into s from sty_sales where id = p_id and tenant_id = tid for update;
  if s.id is null then raise exception 'bill not found'; end if;
  if s.status = 'void' then raise exception 'A cancelled bill has no payments to correct' using errcode = 'ST008'; end if;
  if jsonb_typeof(p_payments) is distinct from 'array' or jsonb_array_length(p_payments) = 0 then
    raise exception 'pick at least one payment method' using errcode = 'ST008';
  end if;
  for row_ in select * from jsonb_array_elements(p_payments) loop
    m := row_->>'mode';
    if m not in ('cash', 'upi', 'card', 'exchange', 'credit') then raise exception 'unknown payment method: %', m using errcode = 'ST008'; end if;
    if coalesce((row_->>'amount')::numeric, 0) <= 0 then raise exception 'every payment method needs an amount' using errcode = 'ST008'; end if;
  end loop;
  select coalesce(sum((pp->>'amount')::numeric), 0) into old_sum from jsonb_array_elements(s.payments) pp;
  select coalesce(sum((pp->>'amount')::numeric), 0) into new_sum from jsonb_array_elements(p_payments) pp;
  -- the whole point is that this cannot change how much the bill was paid for, only which method(s) it's attributed to
  if abs(new_sum - old_sum) > 0.01 then raise exception 'the corrected total (%) must match the original (%)', new_sum, old_sum using errcode = 'ST008'; end if;
  update sty_sales set payments = p_payments where id = p_id;
  perform sty_audit_log(tid, 'correct_payment_mode', p_id::text, jsonb_build_object('number', s.number, 'before', s.payments, 'after', p_payments));
  return sty_sale_json(tid, p_id);
end $$;
