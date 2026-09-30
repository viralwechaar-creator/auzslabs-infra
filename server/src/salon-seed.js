
// Starting content. Everything here can be edited later from /admin.
// Menu transcribed from "SHOWOFF_SALON treatment menu" PDF (volumes 1.1 to 7.1).

const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// [name, description, price, price2, popular]
const cat = (name, gender, items, opts = {}) => ({
  id: 'c-' + slug(name + '-' + gender),
  name, gender,
  note: opts.note || '',
  priceLabels: opts.priceLabels || [],
  items: items.map(([n, d, p, p2, pop]) => ({
    id: 'i-' + slug(name + '-' + gender + '-' + n),
    name: n, desc: d, price: p, price2: p2 == null ? null : p2, popular: !!pop, active: true
  }))
});

function makeSeed() {
  const menu = [
    cat('Luxury facial', 'all', [
      ['Hydra', 'Deep hydration facial that cleanses, exfoliates, and infuses skin with moisture for a glowing finish.', 4000],
      ['Save The Date', 'Bridal-prep facial designed to give instant radiance and smooth, flawless skin for special occasions.', 3500],
      ['Fustu Kanpeki', 'Advanced brightening facial that targets dullness and improves overall skin clarity and texture.', 3300],
      ['Korean Glass', 'Glass-skin facial for ultra-smooth, dewy, and luminous skin inspired by Korean skincare.', 3000],
      ['Jeannot', 'Skin-rejuvenating facial that improves tone, texture, and natural glow.', 3000],
      ['U Tenfinity', 'Firming facial that lifts, tightens, and enhances skin elasticity.', 2800]
    ]),
    cat('Facial', 'all', [
      ['O3 +', 'Oxygenating facial that detoxifies skin and boosts instant brightness.', 2500],
      ['Radiant Glow', 'Glow-enhancing facial that refreshes dull skin and adds natural radiance.', 1800],
      ['Vedic Line', 'Herbal-based facial using natural ingredients to nourish and revitalize skin.', 1500]
    ]),
    cat('Clean up', 'all', [
      ['O3 + Cleanup', 'Deep cleansing treatment that removes impurities and refreshes the skin.', 1200],
      ['Anti Tan Kanpeki', 'Tan-removal cleanup that evens skin tone and restores brightness.', 1000, null, true],
      ['Lotus', 'Gentle cleanup that hydrates and soothes the skin.', 800],
      ['Raaga', 'Basic cleanup that refreshes and lightly cleanses the skin.', 700],
      ['Fresh Glow', 'Quick cleanup for instant freshness and a subtle glow.', 550]
    ]),
    cat('Beauty', 'female', [
      ['Full Face Wax', 'Removes unwanted hair from the entire face for smooth and clean skin.', 400, null, true],
      ['Side Locks Wax', 'Eliminates hair from sideburns to give a neat and defined look.', 150],
      ['Forehead Wax', 'Cleans excess hair from the forehead for a smooth finish.', 50],
      ['Upper Lips Wax', 'Removes fine hair from the upper lip area for a clean appearance.', 40],
      ['Chin Wax', 'Clears unwanted hair from the chin area for smoother skin.', 40],
      ['Eyebrows Threading', 'Shapes and defines eyebrows using precise threading technique.', 50],
      ['Forehead Threading', 'Removes fine hair from the forehead for a polished look.', 30],
      ['Upper Lips Threading', 'Gently removes upper lip hair using threading for smooth results.', 20],
      ['Chin Threading', 'Targets and removes hair from the chin area with precision.', 20]
    ]),
    cat('Hair colour', 'female', [
      ['Highlight', 'Adds lighter strands to enhance dimension and give a stylish, modern look.', 4500],
      ['Ammonia-Free Global Hair Colour', 'Full hair coloring using gentle, ammonia-free formula for smooth and shiny results.', 3000],
      ['Global Hair Colour', 'Even coloring applied to entire hair for a complete refreshed look.', 2500, null, true],
      ['Ammonia-Free Root Touchup', 'Covers regrowth using a gentle formula to match your existing hair color.', 1000],
      ['Root Touchup', 'Covers visible roots to maintain a neat and consistent hair color.', 800, null, true]
    ]),
    cat('Hair treatment', 'female', [
      ['Nanoplastia', 'Deep repair treatment for smooth, frizz-free, glossy hair.', 5500],
      ['Smoothing', 'Makes hair soft, straight, and easy to manage.', 4000],
      ['Botox', 'Repairs damage and restores shine and softness.', 4000, null, true],
      ['Keratin', 'Reduces frizz and adds smoothness and shine.', 3000]
    ]),
    cat('Hair spa', 'female', [
      ['Nourishment hair spa', 'Deep conditioning spa that nourishes dry hair and restores softness.', 1200],
      ['Scalp treatment (hair fall)', 'Targeted scalp care that helps reduce hair fall and keeps the scalp healthy.', 1500],
      ['Ritual hair spa', 'A relaxing spa ritual with massage for soft, shiny, refreshed hair.', 2000],
      ['Plex treatment', 'Bond-repair treatment that strengthens damaged, over-processed hair.', 3000]
    ]),
    cat('Body waxing', 'female', [
      ['Hand waxing', 'Removes hair from entire arms for smooth, even skin.', 200, 350, true],
      ['Half-leg waxing', 'Removes hair from lower or upper legs for a clean finish.', 150, 350],
      ['Full-leg waxing', 'Removes hair from entire legs for silky smooth skin.', 400, 650, true],
      ['Under arms waxing', 'Removes hair from underarms for smooth and hygienic skin.', 100, 150],
      ['Tummy waxing', 'Removes unwanted hair from the stomach area for a clean finish.', 250, 300],
      ['Back waxing full', 'Clears hair from the back for smooth and even skin.', 350, 500],
      ['Chest waxing', 'Removes hair from the chest area for a neat appearance.', 200, 300],
      ['Bikini waxing (peel off)', 'Removes hair around the bikini line for a clean look.', 2000, 1200],
      ['Full body waxing', 'Complete hair removal for overall smooth and polished skin.', 1500, 2500, true]
    ], { priceLabels: ['Normal', 'Rica'] }),
    cat('Beauty', 'male', [
      ['Forehead Wax', 'Clears excess hair from the forehead for a neat appearance.', 100, null, true],
      ['Cheek Wax', 'Removes unwanted hair from cheeks for a clean, defined look.', 200],
      ['Neck Wax', 'Removes hair from the neck area for a sharp and groomed finish.', 200]
    ]),
    cat('Hair colour', 'male', [
      ['Highlight', 'Adds subtle streaks to enhance style and give a modern look.', 1500],
      ['Ammonia-Free Global Hair Colour', 'Full hair coloring using gentle, ammonia-free formula for smooth and shiny results.', 800],
      ['Hair Colour', 'Full hair colouring with a gentle formula for smooth, natural results.', 500, null, true],
      ['Beard colour', 'Colours beard hair for a fuller and well-defined look.', 300]
    ]),
    cat('Body waxing', 'male', [
      ['Hand waxing', 'Removes hair from entire arms for smooth, even skin.', 600, null, true],
      ['Half-leg waxing', 'Removes hair from lower or upper legs for a clean finish.', 500],
      ['Full-leg waxing', 'Removes hair from entire legs for silky smooth skin.', 1000, null, true],
      ['Chest waxing', 'Removes hair from the chest area for a neat appearance.', 500],
      ['Full body waxing', 'Complete hair removal for overall smooth and polished skin.', 2500, null, true]
    ], { note: 'Rica wax' }),
    cat('Pedicure', 'all', [
      ['Herbal Luxury Pedicure', 'Premium herbal treatment that deeply nourishes, relaxes, and rejuvenates tired feet.', 1800],
      ['Alege Pedicure', 'Detoxifying pedicure enriched with algae extracts to cleanse and revitalize skin.', 1500],
      ['Bombini Ice Cream Pedicure', 'Indulgent pedicure with creamy textures for intense hydration and smoothness.', 1200, null, true],
      ['Crystal Pedicure', 'Brightening pedicure that adds shine and softness to dull feet.', 800],
      ['Fresh Feet Pedicure', 'Basic pedicure for quick cleaning, grooming, and fresh-looking feet.', 550, null, true]
    ]),
    cat('Manicure', 'all', [
      ['Herbal Luxury manicure', 'Deep nourishing manicure that hydrates and restores softness to hands.', 1000, null, true],
      ['Alege manicure', 'Detox manicure using algae-based products to refresh and rejuvenate skin.', 900],
      ['Bombini Ice Cream manicure', 'Rich and creamy manicure for intense moisture and smooth hands.', 700],
      ['Crystal manicure', 'Brightening manicure that enhances glow and smoothness.', 500],
      ['Fresh Hands manicure', 'Basic manicure for clean, neat, and well-groomed hands.', 400, null, true]
    ])
  ];

  const ph = (role, bio) => ({ id: 'st-' + slug(role), name: 'Add name', role, bio, photo: '', visible: true });

  return {
    settings: {
      salonName: 'Showoff Salon',
      tagline: 'Unisex salon, Sardarpura, Jodhpur',
      phone: '',
      whatsapp: '',
      email: '',
      address: 'Sardarpura, Jodhpur',
      mapUrl: '',
      instagram: 'showoff_unisex_salon_academy',
      timezone: 'Asia/Kolkata',
      open: '10:00',
      close: '20:00',
      slotMinutes: 30,
      capacity: 2,
      closedDays: [],
      advanceDays: 60,
      invoiceFooter: 'Thank you for visiting Showoff Salon.',
      heroLogo: '',
      bgMusic: { mode: 'off', src: '', volume: 15, spotifyUrl: '', spotifyEmbed: '' }
    },
    content: {
      heroTitle: 'Hair, skin and nails, taken seriously.',
      heroText: 'Facials, hair colour and treatments, waxing, manicure and pedicure, with clear descriptions and fixed prices.',
      servicesText: 'Everything we offer, grouped the way you would ask for it. Choose a group to see its full menu.',
      menuText: 'Swipe or use the arrows to move through the menu. Prices are in rupees.',
      galleryText: 'A look at the salon and our work.',
      stylistsText: 'The people who will look after you.',
      aboutTitle: 'A salon for the whole family.',
      aboutText: 'Every treatment on our menu has a plain description and a fixed price, so you know what to expect before you sit down.\nWe keep the studio calm and unhurried, whether you are in for a quick trim or a full spa afternoon.\nBook online in a minute, or call ahead if you would rather speak to someone first.',
      bookText: 'Choose your services, a date and a time. We will confirm your slot after you send the request.'
    },
    menu,
    stylists: [
      ph('Senior hair stylist', 'Add a short introduction from the admin console.'),
      ph('Skin and facial specialist', 'Add a short introduction from the admin console.'),
      ph('Nail and beauty artist', 'Add a short introduction from the admin console.')
    ],
    gallery: [],
    bookings: [],
    invoices: [],
    expenses: [],
    counters: { booking: 0, invoice: 0 }
  };
}


/* ---------------------------------------------------------------------
   Template: what a brand-new AUZslab Salon starts as. Same structure and
   design as Showoff Salon's site, with neutral copy, a compact sample menu
   and placeholder artwork (logo, hero) the owner replaces under Settings.
   Showoff Salon itself keeps makeSeed()'s real menu (see salon.js).
   --------------------------------------------------------------------- */
function makeTemplate(salonName) {
  const name = salonName || 'Your Salon';
  const menu = [
    cat('Hair', 'female', [
      ['Haircut and style', 'A consultation, a cut that suits you, and a blow-dry to finish.', 600, null, true],
      ['Hair wash and blow-dry', 'Relaxing wash with a smooth, long-lasting blow-dry.', 350],
      ['Global hair colour', 'Even colour from root to tip with a gentle formula.', 2500],
      ['Root touch-up', 'Covers regrowth to match your existing colour.', 900],
      ['Highlights', 'Lighter strands to add dimension and shine.', 3500, null, true],
      ['Hair spa', 'Deep-conditioning spa with scalp massage for soft, healthy hair.', 1200]
    ]),
    cat('Hair', 'male', [
      ['Haircut', 'A sharp cut with a clean finish.', 300, null, true],
      ['Beard trim', 'Shaped and tidied to suit your face.', 150],
      ['Hair colour', 'Natural-looking colour with a gentle formula.', 600],
      ['Head massage', 'A relaxing scalp and shoulder massage.', 250]
    ]),
    cat('Skin', 'all', [
      ['Clean-up', 'Deep cleansing that removes impurities and refreshes skin.', 900],
      ['Glow facial', 'Brightening facial for healthy, radiant skin.', 1800, null, true],
      ['Hydrating facial', 'Moisture-rich treatment for dry or tired skin.', 2200],
      ['De-tan treatment', 'Evens skin tone and restores brightness.', 1100]
    ]),
    cat('Waxing and threading', 'female', [
      ['Eyebrow threading', 'Precise shaping and definition.', 50],
      ['Full face threading', 'Smooth, clean finish across the face.', 200],
      ['Full arms wax', 'Smooth, even skin from shoulder to wrist.', 350],
      ['Full legs wax', 'Silky smooth legs, long-lasting results.', 650, null, true]
    ]),
    cat('Nails', 'all', [
      ['Classic manicure', 'Shaping, cuticle care and polish.', 500],
      ['Classic pedicure', 'Soak, scrub, shape and polish for fresh feet.', 700, null, true],
      ['Spa pedicure', 'Extended treatment with massage and mask.', 1200]
    ])
  ];
  const ph = (role, bio) => ({ id: 'st-' + slug(role), name: 'Add name', role, bio, photo: '', visible: true });
  return {
    settings: {
      salonName: name, tagline: 'Unisex salon', phone: '', whatsapp: '', email: '', address: '', mapUrl: '', instagram: '',
      timezone: 'Asia/Kolkata', open: '10:00', close: '20:00', slotMinutes: 30, capacity: 2, closedDays: [], advanceDays: 60,
      invoiceFooter: 'Thank you for visiting ' + name + '.', heroLogo: '',
      logo: '/salon/assets/template-logo.svg', logoLight: '/salon/assets/template-logo-light.svg', heroPhoto: '/salon/assets/template-hero.svg', theme: {},
      bgMusic: { mode: 'off', src: '', volume: 15, spotifyUrl: '', spotifyEmbed: '' }
    },
    content: {
      heroTitle: 'Look good. Feel better.',
      heroText: 'Hair, skin and nails with clear descriptions and fixed prices, from people who take the time to get it right.',
      servicesText: 'Everything we offer, grouped the way you would ask for it. Choose a group to see its full menu.',
      menuText: 'Swipe or use the arrows to move through the menu. Prices are in rupees.',
      galleryText: 'A look at the salon and our work.',
      stylistsText: 'The people who will look after you.',
      aboutTitle: 'A salon for the whole family.',
      aboutText: 'Every treatment on our menu has a plain description and a fixed price, so you know what to expect before you sit down.\nWe keep the studio calm and unhurried, whether you are in for a quick trim or a full spa afternoon.\nBook online in a minute, or call ahead if you would rather speak to someone first.',
      bookText: 'Choose your services, a date and a time. We will confirm your slot after you send the request.'
    },
    menu,
    stylists: [
      ph('Senior hair stylist', 'Add a short introduction from the admin console.'),
      ph('Skin and beauty specialist', 'Add a short introduction from the admin console.'),
      ph('Nail artist', 'Add a short introduction from the admin console.')
    ],
    gallery: [], bookings: [], invoices: [], expenses: [], counters: { booking: 0, invoice: 0 }
  };
}

/* Demo salon: the template plus a believable week of activity, dated relative
   to today so the demo never looks stale. Re-applied automatically (salon.js)
   so prospects always land on a clean, populated demo. */
const DEMO_STAFF_PHONE = '9000000001';
function makeDemo(today) {
  const db = makeTemplate('AUZslab Salon Demo');
  db.settings.tagline = 'Sample salon, try everything';
  db.settings.address = 'This is a demo: nothing you enter here is real';
  db.settings.phone = '98290 00000';
  db.settings.whatsapp = '9829000000';
  db.settings.instagram = 'auzslab';
  db.stylists = [
    { id: 'st-demo-1', name: 'Priya', role: 'Senior hair stylist', bio: 'Colour and cutting specialist.', photo: '', visible: true },
    { id: 'st-demo-2', name: 'Rahul', role: 'Barber and groomer', bio: 'Clean cuts and beard work.', photo: '', visible: true },
    { id: 'st-demo-3', name: 'Meera', role: 'Skin and beauty specialist', bio: 'Facials, waxing and nails.', photo: '', visible: true }
  ];
  const all = db.menu.flatMap(c => c.items);
  const item = n => all.find(i => i.name === n) || all[0];
  const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const clients = [['Ananya Sharma', '9811100001'], ['Rohan Mehta', '9811100002'], ['Kavya Joshi', '9811100003'], ['Vikram Singh', '9811100004'], ['Neha Kapoor', '9811100005'], ['Aditya Rao', '9811100006']];
  const plan = [
    [0, '11:00', 0, ['Haircut and style'], 'confirmed'], [0, '14:30', 1, ['Hair colour'], 'pending'], [1, '12:00', 2, ['Glow facial'], 'confirmed'],
    [2, '16:00', 3, ['Haircut'], 'pending'], [3, '10:30', 4, ['Classic pedicure', 'Classic manicure'], 'confirmed'], [4, '15:00', 5, ['Global hair colour'], 'pending'],
    [-1, '13:00', 0, ['Hair spa'], 'completed'], [-2, '17:00', 2, ['Full legs wax'], 'completed']
  ];
  plan.forEach(([d, time, ci, names, status], n) => {
    const services = names.map(x => { const i = item(x); return { id: i.id, name: i.name, price: i.price }; });
    db.bookings.push({ id: 'demo-b' + n, ref: 'DEMO' + String(n + 1).padStart(4, '0'), name: clients[ci][0], phone: clients[ci][1], email: '', date: addDays(today, d), time, note: '',
      services, price: services.reduce((s, x) => s + x.price, 0), status, createdAt: new Date().toISOString() });
  });
  const bills = [[-1, 0, ['Hair spa'], 0], [-2, 2, ['Full legs wax', 'Classic pedicure'], 100], [-4, 3, ['Haircut', 'Beard trim'], 0], [-6, 4, ['Glow facial'], 0], [-9, 1, ['Hair colour'], 0], [-12, 5, ['Highlights'], 300]];
  bills.forEach(([d, ci, names, disc], n) => {
    const items = names.map(x => { const i = item(x); return { name: i.name, qty: 1, price: i.price }; });
    const subtotal = items.reduce((s, x) => s + x.price, 0);
    db.invoices.push({ id: 'demo-i' + n, token: 'de00' + String(n + 1).padStart(4, '0'), no: 'SS-' + String(n + 1).padStart(4, '0'), date: addDays(today, d),
      client: { name: clients[ci][0], phone: clients[ci][1], email: '' }, items, subtotal, discount: { type: 'flat', value: disc }, discountAmt: disc, total: subtotal - disc,
      servedBy: n % 2 ? 'Meera' : 'Priya', createdBy: { id: 'owner', name: 'Owner' }, note: '', bookingId: '', void: false, createdAt: new Date().toISOString() });
  });
  db.counters.invoice = bills.length;
  [[-3, 'rent', 'Shop rent', 25000], [-5, 'purchase', 'Hair colour stock', 6200], [-8, 'bills', 'Electricity', 3400], [-10, 'salary', 'Part payment, assistant', 8000]].forEach(([d, category, note, amount], n) => {
    db.expenses.push({ id: 'demo-e' + n, date: addDays(today, d), category, note, amount, createdAt: new Date().toISOString() });
  });
  return db;
}

export { makeSeed, makeTemplate, makeDemo, DEMO_STAFF_PHONE };
