-- Theme editor, step 18: "Product information" section. On the product page template it shows one part of the product's own
-- information (description, details list, specs, washcare, shipping) wherever you place it. When a product template contains one,
-- the built-in Details/Washcare/Shipping tabs in the page itself are hidden, so nothing shows twice.
-- Rollback: delete from sfx_section_types where type = 'product_info';
insert into sfx_section_types (type, label, description, position, settings, block_types, max_blocks, layout) values
('product_info', 'Product information', 'One part of the product''s own information (description, details, specs, washcare or shipping). Use it on the Product page.', 150,
  '[{"id":"kind","type":"select","label":"Show","options":[["description","Description"],["details","Details list"],["specs","Specs (brand, fabric, season...)"],["washcare","Washcare"],["shipping","Shipping and returns"]],"default":"description"},
    {"id":"heading","type":"text","label":"Heading (leave blank for the default)"}]',
  '[]', 1, true)
on conflict (type) do nothing;
