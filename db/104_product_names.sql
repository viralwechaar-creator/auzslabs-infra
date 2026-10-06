-- Product names as the owner writes them: AUZsPOS, AUZsPOS QR, AUZsPay, AUZsLedger (AUZsMob already was).
update product_prices set label = 'AUZsPOS' where key = 'pos';
update product_prices set label = 'AUZsPOS QR' where key = 'self_order';
update product_prices set label = 'AUZsPay' where key = 'payroll';
update product_prices set label = 'AUZsLedger' where key = 'accounting';
update bundles set label = regexp_replace(label, 'Auzs(POS|Pay|Ledger)', 'AUZs\1', 'g') where label ~ 'Auzs(POS|Pay|Ledger)';
