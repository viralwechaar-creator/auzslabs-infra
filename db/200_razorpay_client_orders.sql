-- Razorpay for the request-first flow (db/155): the client pays the quoted total online on pay.html; the signed
-- webhook marks the order paid and runs the SAME confirm step the admin button runs (access, gapless bill number,
-- renewal dates, payment record), so an online payment and a hand-confirmed UPI payment end up identical.
-- Dormant until RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET are set; the UPI-QR route stays.
-- Everything below is reached only by server code (payments.js); none of it is registered as an RPC.

alter table payments add column if not exists client_order_id uuid references client_orders(id) on delete set null;
alter table payments alter column user_id drop not null;
alter table payments drop constraint if exists payments_exactly_one_target;
alter table payments add constraint payments_exactly_one_target check (
  (case when signup_request_id is not null then 1 else 0 end) + (case when addon_request_id is not null then 1 else 0 end) + (case when client_order_id is not null then 1 else 0 end) = 1
);
create index if not exists idx_payments_client_order on payments (client_order_id);

-- the client ticked the terms and pressed "Pay online": record that, return what to charge
create or replace function order_online_start(p_token text, p_terms boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o client_orders;
begin
  select * into o from client_orders where token = p_token for update;
  if o.id is null then raise exception 'This link is not valid.'; end if;
  if o.status not in ('link_sent', 'payment_submitted') then raise exception 'This request is not waiting for a payment.'; end if;
  if not coalesce(p_terms, false) then raise exception 'Please tick the box to accept the Terms, Privacy Policy and Refund Policy.'; end if;
  if o.totals is null or coalesce((o.totals->>'total')::numeric, 0) <= 0 then raise exception 'This request has no amount to pay yet.'; end if;
  update client_orders set updated_at = now(),
    payment = payment || jsonb_build_object('terms_accepted_at', now(), 'terms_version', coalesce((select value from platform_flags where key = 'privacy_version'), '2026-10'), 'online_started_at', now())
    where id = o.id;
  return jsonb_build_object('id', o.id, 'total', (o.totals->>'total')::numeric, 'business_name', o.business_name, 'contact_name', o.contact_name, 'phone', o.phone, 'email', o.email);
end $$;

-- the webhook's job once the signature is verified and the payment is captured. Never raises: a problem
-- (amount differs from the quote, access could not be given) leaves the order unpaid and tells the admin.
create or replace function online_confirm_order_payment(p_order_id uuid, p_rzp_payment_id text, p_amount numeric) returns jsonb
language plpgsql security definer set search_path = public as $$
declare o client_orders; v_admin uuid; v_prev text := current_setting('app.uid', true); r jsonb;
begin
  select * into o from client_orders where id = p_order_id for update;
  if o.id is null then return jsonb_build_object('ok', false, 'error', 'order not found'); end if;
  if o.status = 'paid' then return jsonb_build_object('ok', true, 'duplicate', true, 'invoice_no', o.invoice_no); end if;
  if o.totals is null or abs(coalesce((o.totals->>'total')::numeric, 0) - coalesce(p_amount, 0)) > 0.01 then
    insert into notifications (tenant_id, type, title, body) values (null, 'client_order_paid', 'Online payment does not match the quote: ' || coalesce(o.business_name, ''),
      'Razorpay payment ' || coalesce(p_rzp_payment_id, '') || ' of ' || coalesce(p_amount::text, '?') || ' was received but the bill is ' || coalesce(o.totals->>'total', '?') || '. Check it in Razorpay and confirm by hand.');
    return jsonb_build_object('ok', false, 'error', 'amount mismatch');
  end if;
  select id into v_admin from platform_admins order by id limit 1;
  if v_admin is null then return jsonb_build_object('ok', false, 'error', 'no platform admin'); end if;
  begin
    -- the confirm step is the admin's own function; run it as the first platform admin for this one transaction
    perform set_config('app.uid', v_admin::text, true);
    r := admin_confirm_order_payment(o.id, current_date, p_rzp_payment_id);
    perform set_config('app.uid', coalesce(v_prev, ''), true);
  exception when others then
    perform set_config('app.uid', coalesce(v_prev, ''), true);
    insert into notifications (tenant_id, type, title, body) values (null, 'client_order_paid', 'Online payment received but access was not given: ' || coalesce(o.business_name, ''),
      'Razorpay payment ' || coalesce(p_rzp_payment_id, '') || '. Error: ' || left(sqlerrm, 200) || '. Open the request and press Confirm payment.');
    return jsonb_build_object('ok', false, 'error', sqlerrm);
  end;
  update client_payments set mode = 'other', note = 'Razorpay payment ' || p_rzp_payment_id where lower(utr) = lower(p_rzp_payment_id);
  update client_orders set payment = payment || jsonb_build_object('method', 'razorpay', 'razorpay_payment_id', p_rzp_payment_id) where id = o.id;
  return r || jsonb_build_object('ok', true);
end $$;
