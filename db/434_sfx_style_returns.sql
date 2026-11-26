-- Returns made in AUZsStyle now also show on the shared order: a refund record on the in-store order (money returned to the customer).
-- Only when both apps are linked (same switch as in-store sales). Only returns that pay money back (cash, UPI, card) are copied; credit notes and exchanges add nothing.
-- Stock is NOT touched here: AUZsStyle already put the pieces back (or into damaged) in its own stock.
-- Rollback: drop trigger sty_returns_link on sty_returns; drop function sfx_link_return_trigger(); drop function sfx_link_push_return(uuid);
--   alter table sfx_refunds drop column sty_return_id; restore the method check from db/421.
alter table sfx_refunds drop constraint if exists sfx_refunds_method_check;
alter table sfx_refunds add constraint sfx_refunds_method_check check (method in ('manual', 'razorpay', 'store_credit', 'in_store'));
alter table sfx_refunds add column if not exists sty_return_id uuid;
create unique index if not exists idx_sfx_refunds_sty_return on sfx_refunds (sty_return_id) where sty_return_id is not null;

create function sfx_link_push_return(p_return uuid) returns void language plpgsql security definer set search_path = public as $$
declare r sty_returns; o sfx_orders; a numeric;
begin
  select * into r from sty_returns where id = p_return;
  if r.id is null or r.refund <= 0 or r.mode not in ('cash', 'upi', 'card') or not sfx_link_on(r.tenant_id) then return; end if;
  if exists (select 1 from sfx_refunds where sty_return_id = r.id) then return; end if;
  select * into o from sfx_orders where tenant_id = r.tenant_id and sty_sale_id = r.sale_id for update;
  if not found then return; end if;
  a := least(r.refund, o.total - o.refunded_amount);
  if a <= 0 then return; end if;
  insert into sfx_refunds (tenant_id, order_id, amount, method, reason, note, sty_return_id) values (r.tenant_id, o.id, a, 'in_store', left(coalesce(r.reason, 'Returned in the shop'), 200), 'Returned in the shop', r.id);
  update sfx_orders set refunded_amount = refunded_amount + a, timeline = sfx_order_timeline_add(o, 'Refunded in the shop: ' || a), updated_at = now() where id = o.id;
exception when others then
  null;   -- the shop's return is already saved; a copy problem must never undo it
end $$;
create function sfx_link_return_trigger() returns trigger language plpgsql security definer set search_path = public as $$
begin perform sfx_link_push_return(new.id); return null; end $$;
drop trigger if exists sty_returns_link on sty_returns;
create constraint trigger sty_returns_link after insert on sty_returns deferrable initially deferred for each row execute function sfx_link_return_trigger();
