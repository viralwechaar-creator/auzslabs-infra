-- =========================================================
-- Pricing change (owner request): most products need no manual
-- install work -- only AUZsPOS / AUZsPOS QR genuinely require someone
-- to set up a till, menu and tables. The combined "setup and
-- onboarding" fee is split into two separate, independent charges:
--
--   - Setup fee (unchanged amount/behaviour, admin sets it): now
--     defaults OFF for a request that doesn't include pos/self_order
--     (product_prices.setup_fee_exempt = true for every other
--     product, same mechanism db/159 already used for mobile/scan).
--   - Onboarding fee (NEW, flat Rs 1,460, no GST by default): applies
--     to every brand-new client regardless of which products they
--     buy -- covers account creation, verification and handoff, not
--     product-specific configuration.
--
-- Integrations and hardware are NOT modelled here -- they stay what
-- they already were, a custom "Other charge" line the admin adds by
-- hand per quote (see site/orderterms.js for the wording that says so).
-- =========================================================

-- Only AUZsPOS and AUZsPOS QR carry a setup fee by default now.
update product_prices set setup_fee_exempt = true where key not in ('pos', 'self_order');
update product_prices set setup_fee_exempt = false where key in ('pos', 'self_order');

create or replace function client_order_totals(p_quote jsonb, p_state text) returns jsonb
language plpgsql immutable as $$
declare l jsonb; lines jsonb := '[]'; net numeric; g numeric; gamt numeric; sub numeric := 0; dis numeric := 0; tax numeric := 0; gsum numeric := 0; intra boolean := coalesce(nullif(p_state, ''), '08') = '08';
  rate numeric; disc numeric; src text; lbl text; raw_total numeric; rnd numeric;
begin
  for l in select * from jsonb_array_elements(coalesce(p_quote->'items', '[]'::jsonb)) loop
    rate := greatest(coalesce((l->>'rate')::numeric, 0), 0); disc := least(greatest(coalesce((l->>'discount')::numeric, 0), 0), rate);
    net := round(rate - disc, 2); g := greatest(coalesce((l->>'gst')::numeric, 0), 0); gamt := round(net * g / 100, 2);
    lines := lines || jsonb_build_array(jsonb_build_object('type', 'product', 'key', l->>'key', 'label', coalesce(nullif(l->>'label', ''), order_product_label(l->>'key')), 'plan', coalesce(nullif(l->>'plan', ''), 'month'), 'rate', rate, 'discount', disc, 'net', net, 'gst', g, 'gst_amt', gamt, 'total', net + gamt, 'renewal', l->>'renewal'));
    sub := sub + rate; dis := dis + disc; tax := tax + net; gsum := gsum + gamt;
  end loop;
  if coalesce((p_quote#>>'{onboarding,on}')::boolean, false) then
    rate := greatest(coalesce((p_quote#>>'{onboarding,amount}')::numeric, 0), 0);
    net := round(rate, 2); g := greatest(coalesce((p_quote#>>'{onboarding,gst}')::numeric, 0), 0); gamt := round(net * g / 100, 2);
    lines := lines || jsonb_build_array(jsonb_build_object('type', 'onboarding', 'label', 'Onboarding fee', 'rate', rate, 'discount', 0, 'net', net, 'gst', g, 'gst_amt', gamt, 'total', net + gamt));
    sub := sub + rate; tax := tax + net; gsum := gsum + gamt;
  end if;
  if coalesce((p_quote#>>'{setup,on}')::boolean, false) then
    rate := greatest(coalesce((p_quote#>>'{setup,amount}')::numeric, 0), 0); disc := least(greatest(coalesce((p_quote#>>'{setup,discount}')::numeric, 0), 0), rate);
    net := round(rate - disc, 2); g := greatest(coalesce((p_quote#>>'{setup,gst}')::numeric, 0), 0); gamt := round(net * g / 100, 2);
    lines := lines || jsonb_build_array(jsonb_build_object('type', 'setup', 'label', 'Setup fee (AUZsPOS installation)', 'rate', rate, 'discount', disc, 'net', net, 'gst', g, 'gst_amt', gamt, 'total', net + gamt));
    sub := sub + rate; dis := dis + disc; tax := tax + net; gsum := gsum + gamt;
  end if;
  for l in select * from jsonb_array_elements(coalesce(p_quote->'custom', '[]'::jsonb)) loop
    lbl := trim(coalesce(l->>'label', '')); if lbl = '' then continue; end if;
    rate := coalesce((l->>'amount')::numeric, 0); g := greatest(coalesce((l->>'gst')::numeric, 0), 0);
    net := round(rate, 2); gamt := round(net * g / 100, 2);   -- a custom line may be negative (an adjustment)
    lines := lines || jsonb_build_array(jsonb_build_object('type', 'custom', 'label', left(lbl, 120), 'rate', rate, 'discount', 0, 'net', net, 'gst', g, 'gst_amt', gamt, 'total', net + gamt));
    sub := sub + rate; tax := tax + net; gsum := gsum + gamt;
  end loop;
  raw_total := round(tax + gsum, 2);
  rnd := round(raw_total, 0) - raw_total;   -- the round-off adjustment shown on the bill, can be negative
  return jsonb_build_object('lines', lines, 'subtotal', round(sub, 2), 'discount', round(dis, 2), 'taxable', round(tax, 2), 'intra', intra,
    'cgst', case when intra then round(gsum / 2, 2) else 0 end, 'sgst', case when intra then round(gsum, 2) - round(gsum / 2, 2) else 0 end, 'igst', case when intra then 0 else round(gsum, 2) end,
    'gst', round(gsum, 2), 'round', round(rnd, 2), 'total', round(raw_total, 0));
end $$;
