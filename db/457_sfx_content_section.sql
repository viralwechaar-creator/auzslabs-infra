-- Theme editor, step 6: the "Content" section. Its items are single elements (heading, text, button, image, spacer), each with its
-- own style settings (size, weight, colours, font, corners, spacing...), and the section itself has container settings (background
-- colour or picture, spacing, width, alignment, gap, corners). Click an element in the live preview to edit exactly that element.
-- Every value is checked by the registry (colours #rrggbb, numbers clamped, choices from a list, links https:// or /).
--
-- Rollback: delete from sfx_section_types where type = 'content';

insert into sfx_section_types (type, label, description, position, settings, block_types, max_blocks, layout) values
('content', 'Content', 'Headings, text, buttons and pictures that you style one by one.', 5,
  '[{"id":"bg","type":"color","label":"Background colour"},
    {"id":"bgImage","type":"image","label":"Background picture"},
    {"id":"padY","type":"number","label":"Space above and below (px)","min":0,"max":200,"default":48},
    {"id":"width","type":"select","label":"Width","options":[["wide","Wide"],["full","Full width"],["narrow","Narrow"]],"default":"wide"},
    {"id":"alignment","type":"select","label":"Alignment","options":[["center","Centre"],["left","Left"],["right","Right"]],"default":"center"},
    {"id":"gap","type":"number","label":"Gap between elements (px)","min":0,"max":80,"default":12},
    {"id":"radius","type":"number","label":"Corners (px)","min":0,"max":60,"default":0}]',
  '[{"type":"heading","label":"Heading","settings":[
      {"id":"text","type":"text","label":"Text"},
      {"id":"size","type":"number","label":"Size (px)","min":12,"max":120,"default":32},
      {"id":"weight","type":"select","label":"Weight","options":[["bold","Bold"],["medium","Medium"],["normal","Light"]],"default":"bold"},
      {"id":"align","type":"select","label":"Alignment","options":[["inherit","Same as section"],["left","Left"],["center","Centre"],["right","Right"]],"default":"inherit"},
      {"id":"color","type":"color","label":"Text colour"},
      {"id":"font","type":"select","label":"Font","options":[["default","Store font"],["serif","Serif"],["humanist","Humanist"],["mono","Typewriter"]],"default":"default"},
      {"id":"spacing","type":"select","label":"Letter spacing","options":[["normal","Normal"],["wide","Wide"]],"default":"normal"},
      {"id":"case","type":"select","label":"Capitals","options":[["none","As typed"],["upper","ALL CAPITALS"]],"default":"none"},
      {"id":"bg","type":"color","label":"Background colour"},
      {"id":"radius","type":"number","label":"Corners (px)","min":0,"max":60,"default":0},
      {"id":"pad","type":"number","label":"Padding (px)","min":0,"max":80,"default":0}]},
    {"type":"text","label":"Text","settings":[
      {"id":"text","type":"textarea","label":"Text"},
      {"id":"size","type":"number","label":"Size (px)","min":10,"max":48,"default":16},
      {"id":"lineHeight","type":"select","label":"Line spacing","options":[["normal","Normal"],["tight","Tight"],["loose","Loose"]],"default":"normal"},
      {"id":"align","type":"select","label":"Alignment","options":[["inherit","Same as section"],["left","Left"],["center","Centre"],["right","Right"]],"default":"inherit"},
      {"id":"color","type":"color","label":"Text colour"},
      {"id":"font","type":"select","label":"Font","options":[["default","Store font"],["serif","Serif"],["humanist","Humanist"],["mono","Typewriter"]],"default":"default"},
      {"id":"bg","type":"color","label":"Background colour"},
      {"id":"radius","type":"number","label":"Corners (px)","min":0,"max":60,"default":0},
      {"id":"pad","type":"number","label":"Padding (px)","min":0,"max":80,"default":0}]},
    {"type":"button","label":"Button","settings":[
      {"id":"label","type":"text","label":"Button text"},
      {"id":"href","type":"url","label":"Link"},
      {"id":"newTab","type":"select","label":"Open link","options":[["no","In the same tab"],["yes","In a new tab"]],"default":"no"},
      {"id":"look","type":"select","label":"Style","options":[["solid","Filled"],["outline","Outline"]],"default":"solid"},
      {"id":"bg","type":"color","label":"Background colour"},
      {"id":"color","type":"color","label":"Text colour"},
      {"id":"corners","type":"select","label":"Corners","options":[["default","Theme default"],["sharp","Sharp"],["soft","Soft"],["pill","Pill"]],"default":"default"},
      {"id":"size","type":"select","label":"Size","options":[["medium","Medium"],["small","Small"],["large","Large"]],"default":"medium"},
      {"id":"width","type":"select","label":"Width","options":[["auto","Fit the text"],["full","Full width"]],"default":"auto"}]},
    {"type":"image","label":"Picture","settings":[
      {"id":"src","type":"image","label":"Image address"},
      {"id":"alt","type":"text","label":"Description (for screen readers)"},
      {"id":"width","type":"select","label":"Width","options":[["full","Full"],["large","Large"],["medium","Medium"],["small","Small"]],"default":"full"},
      {"id":"aspect","type":"select","label":"Shape","options":[["auto","Original"],["square","Square"],["wide","Wide"],["portrait","Portrait"]],"default":"auto"},
      {"id":"radius","type":"number","label":"Corners (px)","min":0,"max":60,"default":0},
      {"id":"href","type":"url","label":"Link (optional)"}]},
    {"type":"spacer","label":"Space","settings":[
      {"id":"height","type":"number","label":"Height (px)","min":4,"max":200,"default":24}]}]',
  20, false)
on conflict (type) do nothing;
