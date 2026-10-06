-- =========================================================
-- Auto-renewal via Cashfree Subscriptions (CLAUDE.md's "known limit" #3:
-- Razorpay only ever charges the first month to activate -- renewals
-- have always been the owner following up by hand). Same
-- dormant-until-configured discipline as payments.js's own Razorpay
-- integration: with no CASHFREE_APP_ID/CASHFREE_SECRET_KEY set, none of
-- this is reachable and the manual renewal flow (owner chases payment,
-- updates tenants.renewal_date by hand) is completely unchanged.
--
-- Owner decisions this was built against (asked directly, not guessed):
--   - monthly billing only for now, not yearly
--   - open to every tenant, not just new signups
--   - a FAILED renewal charge never auto-suspends anything -- it only
--     flags the business for the owner to follow up, exactly like a
--     missed manual renewal does today. No entitlement/access code
--     anywhere in this migration or cashfree.js checks subscription
--     status -- that is deliberate, not an oversight.
--
-- IMPORTANT, stated plainly: this was built from Cashfree's documented
-- Subscriptions API shape (sandbox could not be reached from this build
-- environment -- network egress here is restricted to a small
-- allowlist). It has NOT been exercised against a real Cashfree sandbox
-- call. Before relying on this for a real customer, run one real
-- subscription create + one real webhook delivery with Cashfree's own
-- test credentials and confirm the shapes below still match their
-- current API -- the same "test the real code path with real-shaped
-- credentials" lesson this file's own CLAUDE.md already learned once
-- from the Razorpay RLS bug.
-- =========================================================

create table subscriptions (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  provider           text not null default 'cashfree',
  provider_sub_id    text not null,
  status             text not null default 'created' check (status in ('created', 'active', 'payment_failed', 'cancelled')),
  period             text not null default 'month' check (period = 'month'), -- yearly auto-renew: owner decision, not built yet
  amount             numeric(10,2) not null,
  feature_keys       jsonb not null,
  created_by         uuid not null references auth_users(id) on delete set null,
  created_at         timestamptz not null default now(),
  authorized_at      timestamptz,
  next_charge_on     date,
  last_charge_status text,
  last_charge_at     timestamptz,
  cancelled_at       timestamptz,
  unique (provider, provider_sub_id)
);
create index idx_subscriptions_tenant on subscriptions (tenant_id, created_at desc);
alter table subscriptions enable row level security; -- no policies: only my_autorenew()/SECURITY DEFINER server code touches it
grant select, insert, update on subscriptions to app; -- new table -- see CLAUDE.md "the one gotcha that bit us"

-- The owner's own view of their auto-renewal state -- the active row (if
-- any) for their tenant, newest first. Server-side create/cancel calls
-- the real Cashfree API first (needs the secret key, so it lives in
-- cashfree.js, not here) and writes this table itself; this function is
-- read-only.
create function my_autorenew() returns jsonb language plpgsql stable security definer set search_path = public as $$
declare tid uuid; r record;
begin
  if app_uid() is null then raise exception 'authentication required' using errcode = '28000'; end if;
  select p.tenant_id into tid from profiles p where p.id = app_uid() and p.role = 'owner';
  if tid is null then raise exception 'owner access required' using errcode = '42501'; end if;
  select * into r from subscriptions where tenant_id = tid and status <> 'cancelled' order by created_at desc limit 1;
  if r.id is null then return jsonb_build_object('on', false); end if;
  return jsonb_build_object('on', true, 'status', r.status, 'amount', r.amount, 'next_charge_on', r.next_charge_on,
    'last_charge_status', r.last_charge_status, 'last_charge_at', r.last_charge_at);
end $$;
-- callable by any signed-in owner; not registered for anyone else since it's gated inside the function (same pattern as pay_* functions).
