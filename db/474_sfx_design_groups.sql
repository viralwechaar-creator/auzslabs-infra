-- Theme editor, step 2: Theme settings as foldable groups (Shopify-style). More store-wide settings, each with a real effect on the
-- public store: secondary-text and sale colours, heading case/weight, button case/size, product-card ratio/alignment/quick-add/fit,
-- badge shape/colour, price weight/size, input-field style, icon weight, swatch and size-chip shape, card hover, page fade.
-- Values live in content.design as before; sfx_theme_design_clean already accepts any id in this table, so nothing else changes.
-- Rollback: delete from sfx_design_settings where id in (<the ids below>); update sfx_design_settings set grp='Text' where grp='Typography';
--   update sfx_design_settings set grp='Shape' where id='radius'; update sfx_design_settings set grp='Layout' where id='spacing';
update sfx_design_settings set grp = 'Typography' where grp = 'Text';
update sfx_design_settings set grp = 'Page' where grp in ('Shape', 'Layout');
insert into sfx_design_settings (id, grp, label, type, options, def, position) values
('muted', 'Colours', 'Secondary text', 'color', null, '#666666', 41),
('sale', 'Colours', 'Sale and discount', 'color', null, '#1a7f37', 42),
('headingCase', 'Typography', 'Heading case', 'select', '[["default","Theme default"],["upper","UPPERCASE"]]', 'default', 81),
('headingWeight', 'Typography', 'Heading weight', 'select', '[["default","Theme default"],["light","Light"],["bold","Bold"]]', 'default', 82),
('buttonCase', 'Buttons', 'Button text', 'select', '[["default","Theme default"],["upper","UPPERCASE"]]', 'default', 71),
('buttonSize', 'Buttons', 'Button size', 'select', '[["default","Theme default"],["small","Small"],["large","Large"]]', 'default', 72),
('cardRatio', 'Product cards', 'Picture shape', 'select', '[["default","Portrait"],["square","Square"],["landscape","Landscape"]]', 'default', 100),
('cardAlign', 'Product cards', 'Text alignment', 'select', '[["default","Left"],["center","Centre"]]', 'default', 101),
('cardAdd', 'Product cards', 'Quick add button', 'select', '[["default","Show"],["hide","Hide"]]', 'default', 102),
('cardFit', 'Product cards', 'Picture fit', 'select', '[["default","Fill the frame"],["contain","Show the whole picture"]]', 'default', 103),
('badgeShape', 'Badges', 'Badge shape', 'select', '[["default","Theme default"],["pill","Pill"],["square","Square"]]', 'default', 110),
('badgeColor', 'Badges', 'Badge colour', 'color', null, '#111111', 111),
('priceWeight', 'Prices', 'Price weight', 'select', '[["default","Theme default"],["bold","Bold"]]', 'default', 120),
('priceSize', 'Prices', 'Price size', 'select', '[["default","Theme default"],["large","Larger"]]', 'default', 121),
('inputStyle', 'Input fields', 'Field style', 'select', '[["default","Theme default"],["outline","Outline"],["filled","Filled"]]', 'default', 130),
('iconWeight', 'Icons', 'Icon line weight', 'select', '[["default","Theme default"],["thin","Thin"],["bold","Bold"]]', 'default', 140),
('swatchShape', 'Swatches and variant pickers', 'Colour swatch shape', 'select', '[["default","Round"],["square","Square"]]', 'default', 150),
('sizeShape', 'Swatches and variant pickers', 'Size chip shape', 'select', '[["default","Pill"],["square","Square"]]', 'default', 151),
('cardHover', 'Animations', 'Card hover effect', 'select', '[["default","None"],["lift","Lift"],["scale","Scale"],["zoom","Zoom"]]', 'default', 160),
('pageFade', 'Animations', 'Page fade-in', 'select', '[["default","Off"],["on","On"]]', 'default', 161)
on conflict (id) do nothing;
