const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..', '..', 'app', 'public');
const blackBackdrops = new Set([
  'metro-olive.jpg', 'transit-sand.jpg', 'weekender-tan.jpg',
  'rib-rust.jpg', 'slate-cap-colour.jpg', 'case-slate.jpg',
]);
const neutralPhoto = (file) => file.endsWith('.png') ? file : file.replace(/\.jpg$/, blackBackdrops.has(file) ? '-black.jpg' : '-mono.jpg');
const photoUrl = (file) => '/preview-assets/' + neutralPhoto(file);
const collectionCover = (file) => '/preview-assets/' + file;
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, 'genx-minimal-preview.json'), 'utf8'));
catalog.config.template = 'minimal';
const sampleProducts = [
  {
    slug: 'orbit-graphic-tee', editorial: 'tee-editorial.png', detailPhoto: 'tee-detail.png', name: 'Orbit Graphic Tee', category: 'T-Shirts', price: 1499, sizes: ['S', 'M', 'L', 'XL'],
    options: [['Black', 'tee-black.png'], ['Bone White', 'tee-white.png']], collection: 'Offbeat Streetwear', fabric: '240 GSM cotton jersey', weightG: 270,
    description: 'An oversized streetwear tee with a dropped shoulder and an original orbital graphic.',
    details: ['Oversized fit', 'Reinforced rib neck', 'Front graphic print'],
    washcare: 'Machine wash cold inside out. Line dry and avoid ironing the print.',
  },
  {
    slug: 'switchback-wide-leg-jeans', editorial: 'denim-editorial.png', detailPhoto: 'denim-detail.png', name: 'Switchback Wide-Leg Jeans', category: 'Denim', price: 2999, sizes: ['28', '30', '32', '34', '36'],
    options: [['Washed Indigo', 'jeans-blue.png'], ['Ecru', 'jeans-ecru.png']], collection: 'Denim in Motion', fabric: '13 oz rigid cotton denim', weightG: 740,
    description: 'Wide-leg jeans with curved knee seams and room through the thigh.',
    details: ['Mid-rise waist', 'Five pockets', 'Zip fly and metal tack button'],
    washcare: 'Wash cold inside out with similar colours. Hang to dry.',
  },
  {
    slug: 'field-utility-overshirt', editorial: 'field-editorial.png', detailPhoto: 'field-detail.png', name: 'Field Utility Overshirt', category: 'Shirts', price: 2499, sizes: ['S', 'M', 'L', 'XL'],
    options: [['Charcoal', 'field.png'], ['Sand', 'field-sand.png']], collection: 'Field Notes', fabric: 'Brushed cotton twill', weightG: 440,
    description: 'A relaxed workwear overshirt with roomy patch pockets and an easy snap front.',
    details: ['Relaxed fit for layering', 'Two front patch pockets', 'Snap closures'],
    washcare: 'Wash cold on a gentle cycle and hang to dry.',
  },
  {
    slug: 'utility-bomber', name: 'Midnight Utility Bomber', category: 'Jackets', price: 3499, sizes: ['S', 'M', 'L', 'XL'],
    options: [['Black', 'utility-bomber-colour.jpg']], collection: 'Field Notes', fabric: 'Nylon shell with polyester lining', weightG: 680,
    description: 'A lightly insulated utility jacket with a clean front and room for a layer underneath.',
    details: ['Fit: relaxed', 'Two zipped hand pockets', 'Ribbed collar, hem, and cuffs', 'Full-length front zip'],
    washcare: 'Cold gentle wash with the zip closed. Hang to dry. Do not iron the shell.',
  },
  {
    slug: 'slate-cap', name: 'Washed Slate Cap', category: 'Caps', price: 899, sizes: ['One size'],
    options: [['Slate Blue', 'slate-cap-colour.jpg']], collection: 'Small Essentials', fabric: 'Washed cotton twill', weightG: 94,
    description: 'A low-profile six-panel cap with a pre-curved brim and an adjustable back strap.',
    details: ['Adjustable fit: 54–61 cm', 'Embroidered eyelets', 'Tonal stitching'],
    washcare: 'Spot clean with cold water and let air dry.',
  },
  {
    slug: 'burgundy-case', name: 'Burgundy Wave Case', category: 'Phone Cases', price: 1299, sizes: ['iPhone 16', 'iPhone 16 Pro'],
    options: [['Burgundy', 'burgundy-case-colour.jpg']], collection: 'Small Essentials', fabric: 'TPU bumper and polycarbonate back', weightG: 38,
    description: 'A slim protective case with a matte wave pattern and a raised camera surround.',
    details: ['Model-specific cutouts', 'Textured sides', 'Raised screen and camera edges'],
    washcare: 'Remove the phone before wiping the case with a damp microfibre cloth.',
  },
  {
    slug: 'metro-crossbody', name: 'Metro Ripstop Crossbody', category: 'Bags', price: 1899, sizes: ['One size'],
    options: [['Black', 'metro-black.jpg'], ['Olive', 'metro-olive.jpg']], collection: 'Urban Carry', fabric: 'Nylon ripstop with polyester lining', weightG: 225,
    description: 'A compact crescent bag made for essentials on the move. Wear it across the body or shorten the strap to carry it at the shoulder.',
    details: ['Capacity: 3 L', 'Dimensions: 28 × 16 × 8 cm', 'Adjustable webbing strap: 65–120 cm', 'Main zip and inner slip pocket'],
    washcare: 'Spot clean with a damp cloth. Do not soak, machine wash, or tumble dry.',
  },
  {
    slug: 'transit-backpack', name: 'Transit Canvas Backpack', category: 'Bags', price: 3299, sizes: ['One size'],
    options: [['Sand Beige', 'transit-sand.jpg'], ['Charcoal', 'transit-charcoal.jpg']], collection: 'Urban Carry', fabric: 'Heavy cotton canvas with polyester lining', weightG: 810,
    description: 'A structured everyday backpack with a padded laptop sleeve, quick-access front pocket, and two padded shoulder straps.',
    details: ['Capacity: 18 L', 'Dimensions: 43 × 29 × 15 cm', 'Padded sleeve fits laptops up to 14 inches', 'Flat top carry handle'],
    washcare: 'Brush off dry dirt and spot clean with mild soap. Air dry in the shade.',
  },
  {
    slug: 'canvas-weekender', name: 'Canvas Weekender Duffel', category: 'Bags', price: 3999, sizes: ['One size'],
    options: [['Navy', 'weekender-navy.jpg'], ['Tan', 'weekender-tan.jpg']], collection: 'Urban Carry', fabric: 'Heavy cotton canvas and nylon webbing', weightG: 960,
    description: 'A soft-sided overnight bag with a wide zip opening and space for clothes, shoes and a wash kit.',
    details: ['Capacity: 32 L', 'Dimensions: 49 × 28 × 24 cm', 'Twin carry handles', 'Detachable shoulder strap', 'Interior zipped pocket'],
    washcare: 'Spot clean only. Reshape and air dry before storing.',
  },
  {
    slug: 'rib-cuff-beanie', name: 'Rib Cuff Beanie', category: 'Accessories', price: 799, sizes: ['One size'],
    options: [['Black', 'rib-black.jpg'], ['Rust', 'rib-rust.jpg']], collection: 'Small Essentials', fabric: 'Acrylic rib knit', weightG: 105,
    description: 'A soft rib-knit cap with a folded cuff that can be worn deep or rolled for a shorter fit.',
    details: ['Stretch fit: 54–60 cm', 'Double-layer folded cuff', 'Unisex'],
    washcare: 'Hand wash cold. Lay flat to dry and avoid stretching while wet.',
  },
  {
    slug: 'ridge-phone-case', name: 'Ridge Grip Case', category: 'Phone Cases', price: 1499, sizes: ['iPhone 16', 'iPhone 16 Pro'],
    options: [['Slate Grey', 'case-slate.jpg'], ['Forest Green', 'case-forest.jpg']], collection: 'Small Essentials', fabric: 'Flexible TPU and rigid polycarbonate', weightG: 42,
    description: 'A matte phone case with diagonal grip ridges, a soft bumper, and raised edges around the camera and screen.',
    details: ['Choose the exact phone model for the camera cutout', 'Textured sidewalls', 'Tactile button covers'],
    washcare: 'Remove the phone before cleaning. Wipe with a damp microfibre cloth and dry before refitting.',
  },
];
const originalStyles = [...catalog.styles];
const addedStyles = sampleProducts.map((sample) => ({
    id: sample.slug, name: sample.name, category: sample.category, price: sample.price, mrp: sample.price,
    brand: 'GenX Cloths', code: sample.slug.toUpperCase(), collection: sample.collection, fabric: sample.fabric,
    weightG: sample.weightG, description: sample.description, details: sample.details.join('\n'), washcare: sample.washcare,
    createdAt: '2026-11-20T00:00:00.000Z', photoUrl: photoUrl(sample.editorial || sample.options[0][1]),
    colourPhotos: Object.fromEntries(sample.options.map(([colour, file], index) => [colour,
      (index === 0 ? [sample.editorial, file, sample.detailPhoto] : [file]).filter(Boolean).map(photoUrl),
    ])),
    variants: sample.options.flatMap(([colour], colourIndex) => sample.sizes.map((size, sizeIndex) => ({
      id: sample.slug + '-' + colourIndex + '-' + sizeIndex, size, colour, left: Math.max(2, 10 - colourIndex * 3 - sizeIndex), price: sample.price,
    }))),
}));
catalog.styles = [...addedStyles.slice(0, 3), ...originalStyles, ...addedStyles.slice(3)];
const sampleCollections = [
  { id: 'offbeat-streetwear', name: 'Offbeat Streetwear', file: 'street-cover.png', banner: 'street-wide.png',
    styleIds: ['orbit-graphic-tee', 'switchback-wide-leg-jeans', 'utility-bomber'] },
  { id: 'denim-in-motion', name: 'Denim in Motion', file: 'denim-cover.png', banner: 'denim-wide.png',
    styleIds: ['switchback-wide-leg-jeans', ...originalStyles.filter((item) => /denim|jeans/i.test(item.name)).map((item) => item.id)] },
  { id: 'field-notes', name: 'Field Notes', file: 'field-cover.png', banner: 'field-wide.png',
    styleIds: ['field-utility-overshirt', 'utility-bomber', 'transit-backpack'] },
  { id: 'urban-carry', name: 'Urban Carry', file: 'urban-black.png', banner: 'urban-wide.png',
    styleIds: [...originalStyles.filter((item) => /bags?/i.test(item.category || '')).map((item) => item.id),
      'metro-crossbody', 'transit-backpack', 'canvas-weekender'] },
  { id: 'small-essentials', name: 'Small Essentials', file: 'small-essentials.jpg', banner: 'essentials-wide.png',
    styleIds: ['slate-cap', 'burgundy-case', 'rib-cuff-beanie', 'ridge-phone-case'] },
];
catalog.collections.unshift(...sampleCollections.map(({ file, banner, ...collection }) => ({ ...collection, image: collectionCover(file), bannerImage: collectionCover(banner) })));
const previewImage = catalog.config.heroImages?.[0] || catalog.styles.find((item) => item.photoUrl)?.photoUrl;
catalog.config.minimalStories = [
  { title: 'GenX campaign', image: previewImage, link: '#/shop?new=1', cta: 'Shop the drop' },
  { title: 'Discover the catalog', image: catalog.styles.find((item) => item.photoUrl)?.photoUrl || previewImage, link: '#/shop' },
];
catalog.config.minimalNotices = [{ title: 'Welcome to the GenX preview', body: 'Browse the demo catalog and try the new storefront tools.', link: '#/shop' }];
catalog.config.minimalPages = [{ slug: 'campaign-preview', title: 'Campaign preview', image: previewImage,
  body: 'This sample page demonstrates what a store owner can publish from AUZsStyle.', link: '#/collections', cta: 'Explore collections' }];
const files = new Set(['/store/store.js','/store/store.css','/store/minimal.css','/store/fx.js','/store/fx.css','/vendor/qrcode.js']);
const imageFiles = new Set([
  ...sampleProducts.flatMap((sample) => sample.options.map(([, file]) => neutralPhoto(file))),
  ...sampleProducts.flatMap((sample) => [sample.editorial, sample.detailPhoto]).filter(Boolean),
  ...sampleCollections.flatMap(({ file, banner }) => [file, banner]),
]);
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/' || url.pathname === '/store.html') {
    const html = fs.readFileSync(path.join(root, 'store.html'), 'utf8').replace(/<script src="\/(?:config\.js|tenant\.js[^"]*|sb-client\.js[^"]*)"><\/script>/g, '')
      .replace('</head>', '<style>.minimal-recommendations .pc .sc img[src$="-black.jpg"]{background:#0b0b0b;object-fit:cover!important}</style></head>')
      .replace('<div id="app"></div>', '<div id="app"></div><script>const CFG={}; window.TENANT_SLUG="minimal-local"; window.supabase={createClient:()=>({rpc:async(name)=>name==="public_sty_store"?{data:' + JSON.stringify(catalog).replace(/</g, '\\u003c') + '}:name==="public_sty_place_order"?{error:{message:"This preview does not place orders."}}:{data:null}})};</script>');
    return res.writeHead(200, {'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store'}).end(html);
  }
  if (url.pathname.startsWith('/preview-assets/')) {
    const file = url.pathname.slice('/preview-assets/'.length);
    if (!imageFiles.has(file)) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': file.endsWith('.jpg') ? 'image/jpeg' : 'image/png' });
    return fs.createReadStream(path.join(__dirname, 'minimal-preview-assets', file)).pipe(res);
  }
  if (!files.has(url.pathname)) return res.writeHead(404).end();
  const type = url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript';
  res.writeHead(200, {'Content-Type':type+'; charset=utf-8', 'Cache-Control':'no-store'});
  fs.createReadStream(path.join(root, url.pathname.slice(1))).pipe(res);
}).listen(Number(process.env.MINIMAL_PREVIEW_PORT || 4197), '127.0.0.1');
