-- AUZsMob and AUZsScan carry no GST and no one-time setup fee (owner decision).
update product_prices set gst_exempt = true, setup_fee_exempt = true where key in ('mobile', 'scan');
