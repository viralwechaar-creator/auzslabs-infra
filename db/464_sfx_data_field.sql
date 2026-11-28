-- Theme editor, step 16: a "Custom data field" section. On a product or collection page it shows the value of one of your typed fields
-- (db/425) for THAT product or collection, for example Material, Care or Delivery time. Only fields marked "show on the storefront" are
-- ever returned by the public function, so nothing private can be shown by naming it here. Off those pages the section shows nothing.
-- Rollback: delete from sfx_section_types where type = 'data_field';

insert into sfx_section_types (type, label, description, position, settings, block_types, max_blocks, layout) values
('data_field', 'Custom data field', 'Shows one of your custom fields (for example Material or Care) on product and collection pages.', 140,
  '[{"id":"key","type":"text","label":"Field key (as in Custom data)"},
    {"id":"showLabel","type":"select","label":"Show the field name","options":[["yes","Yes"],["no","No"]],"default":"yes"},
    {"id":"layout","type":"select","label":"Layout","options":[["inline","Name and value on one line"],["stacked","Name above value"]],"default":"inline"},
    {"id":"fallback","type":"text","label":"Text when the field is empty (leave blank to hide)"}]',
  '[]', 1, true)
on conflict (type) do nothing;
