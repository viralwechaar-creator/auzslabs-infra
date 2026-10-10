-- =========================================================
-- Round off to the nearest whole rupee on every client bill/quote/
-- payment total (owner request). client_order_totals() is the single
-- source of truth for this -- the admin quote builder's live preview
-- (calcQuote() in admin.html) mirrors it exactly, same discipline as
-- cart.html mirroring billFor() -- and pay.html / inv.html only ever
-- display the server's own 'totals' object, so adding 'round' + a
-- rounded 'total' here is the one change that reaches every screen.
-- =========================================================

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
  if coalesce((p_quote#>>'{setup,on}')::boolean, false) then
    rate := greatest(coalesce((p_quote#>>'{setup,amount}')::numeric, 0), 0); disc := least(greatest(coalesce((p_quote#>>'{setup,discount}')::numeric, 0), 0), rate);
    net := round(rate - disc, 2); g := greatest(coalesce((p_quote#>>'{setup,gst}')::numeric, 0), 0); gamt := round(net * g / 100, 2);
    lines := lines || jsonb_build_array(jsonb_build_object('type', 'setup', 'label', 'One-time setup and onboarding', 'rate', rate, 'discount', disc, 'net', net, 'gst', g, 'gst_amt', gamt, 'total', net + gamt));
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
