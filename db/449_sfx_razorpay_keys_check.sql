-- Server-only: lets the API test a store's saved Razorpay keys for its owner/manager (not registered as an RPC, never returned to a browser).
-- Rollback: drop function sfx_razorpay_keys();
create or replace function sfx_razorpay_keys() returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); k sfx_store_secrets;
begin
  select * into k from sfx_store_secrets where tenant_id = tid;
  if not found then return null; end if;
  return jsonb_build_object('key', k.rzp_key_id, 'secret', k.rzp_secret);
end $$;
grant execute on function sfx_razorpay_keys() to app;
