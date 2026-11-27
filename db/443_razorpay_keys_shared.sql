-- Enter Razorpay keys once: connecting (or disconnecting) in the storefront dashboard also switches
-- card payments on/off in the AUZsStyle store (store.html), which reads sty_store_secrets + config.payOnline.
-- Rollback: drop function sfx_store_set_razorpay(jsonb); alter function sfx_store_set_razorpay_pre443(jsonb) rename to sfx_store_set_razorpay;
alter function sfx_store_set_razorpay(jsonb) rename to sfx_store_set_razorpay_pre443;
create function sfx_store_set_razorpay(p jsonb) returns jsonb language plpgsql security definer set search_path = public as $$
declare tid uuid := sfx_guard('sfx_manage'); r jsonb; clr boolean := coalesce((p->>'clear')::boolean, false); kid text; sec text;
begin
  r := sfx_store_set_razorpay_pre443(p);
  if exists (select 1 from sty_store where tenant_id = tid) then
    if clr then
      delete from sty_store_secrets where tenant_id = tid;
      update sty_store set config = (coalesce(config, '{}'::jsonb) || jsonb_build_object('payOnline', false)) - 'rzpKey', updated_at = now() where tenant_id = tid;
    else
      select rzp_key_id, rzp_secret into kid, sec from sfx_store_secrets where tenant_id = tid;
      insert into sty_store_secrets (tenant_id, rzp_key_id, rzp_secret) values (tid, kid, sec)
        on conflict (tenant_id) do update set rzp_key_id = excluded.rzp_key_id, rzp_secret = excluded.rzp_secret, updated_at = now();
      update sty_store set config = coalesce(config, '{}'::jsonb) || jsonb_build_object('payOnline', true, 'rzpKey', kid), updated_at = now() where tenant_id = tid;
    end if;
  end if;
  return r;
end $$;
-- one-time catch-up for businesses that already connected in the storefront dashboard
insert into sty_store_secrets (tenant_id, rzp_key_id, rzp_secret)
  select s.tenant_id, s.rzp_key_id, s.rzp_secret from sfx_store_secrets s where exists (select 1 from sty_store t where t.tenant_id = s.tenant_id)
  on conflict (tenant_id) do nothing;
update sty_store t set config = coalesce(config, '{}'::jsonb) || jsonb_build_object('payOnline', true, 'rzpKey', s.rzp_key_id), updated_at = now()
  from sfx_store_secrets s where s.tenant_id = t.tenant_id and coalesce((t.config->>'payOnline')::boolean, false) = false;
