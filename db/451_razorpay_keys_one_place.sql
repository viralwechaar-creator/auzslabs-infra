-- Razorpay keys for a storefront business live in one place (the storefront's Payments card). The copy into the old AUZsStyle store (db/443)
-- is no longer needed: for a business with the storefront the old store is switched off (db/444). Businesses without the storefront still
-- enter their keys in AUZsStyle -> Online store as before.
-- Rollback: re-run db/443_razorpay_keys_shared.sql's function body (alter function sfx_store_set_razorpay rename; recreate).
do $$ begin
  if to_regprocedure('sfx_store_set_razorpay_pre443(jsonb)') is not null then
    drop function sfx_store_set_razorpay(jsonb);
    alter function sfx_store_set_razorpay_pre443(jsonb) rename to sfx_store_set_razorpay;
  end if;
end $$;
