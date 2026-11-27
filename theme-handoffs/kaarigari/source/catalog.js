const catalog = [
  { id: 'clay', category: 'clay', title: 'The Earth Vessel', material: 'Wheel-thrown terracotta', price: 1490, size: '26 × 15 cm', description: 'A softly rounded vase with an earthy, unglazed finish. Style it with dried stems or leave it to catch the afternoon light.' },
  { id: 'textiles', category: 'textiles', title: 'Indigo Garden Throw', material: 'Block-printed cotton', price: 2290, size: '130 × 170 cm', description: 'Cream flowers on deep indigo cotton. Drape it across a chair or fold it at the end of a bed.' },
  { id: 'brass', category: 'brass', title: 'The Ripple Bowl', material: 'Hammered brass', price: 1890, size: '18 × 8 cm', description: 'A decorative bowl with a hammered finish for a tabletop or entryway.' },
  { id: 'incense', category: 'clay', title: 'Dusk Incense Rest', material: 'Terracotta', price: 690, size: '10 cm across', description: 'A low, rounded incense rest with a broad rim to catch falling ash.' },
  { id: 'cushion', category: 'textiles', title: 'Gulab Cushion Cover', material: 'Block-printed cotton', price: 1190, size: '45 × 45 cm', description: 'A cream floral print on dusty coral cotton. Cushion insert sold separately.' },
  { id: 'diya', category: 'brass', title: 'Evening Diyas', material: 'Cast brass', price: 1290, size: 'Set of two · 8 cm each', description: 'A pair of brass oil lamps with flower-shaped rims.' },
  { id: 'basket', category: 'woven', title: 'Coil Catchall', material: 'Woven sabai grass', price: 1090, size: '24 × 6 cm', description: 'A shallow woven basket for small everyday objects.' },
  { id: 'platter', category: 'clay', title: 'Blue Vine Platter', material: 'Glazed ceramic', price: 1990, size: '29 × 18 cm', description: 'An oval decorative platter with a blue floral border and glossy glaze.' },
  { id: 'board', category: 'wood', title: 'Mango Leaf Board', material: 'Carved mango wood', price: 1690, size: '32 × 18 cm', description: 'A handled display board with a shallow carved leaf motif.' },
  { id: 'planter', category: 'clay', title: 'Ribbed Courtyard Planter', material: 'Unglazed terracotta', price: 990, size: '15 × 14 cm', description: 'A small planter with wheel marks you can feel. The soft red clay pairs with leafy greens on a sheltered windowsill.' },
  { id: 'runner', category: 'textiles', title: 'Marigold Table Runner', material: 'Block-printed cotton', price: 1390, size: '35 × 160 cm', description: 'A trail of rust-red flowers on cream cotton. The open ground leaves room for bowls, trays and small vases.' },
  { id: 'bell', category: 'brass', title: 'Courtyard Bell', material: 'Engraved brass', price: 1590, size: '11 × 7 cm', description: 'A handbell with a turned handle and engraved bands that catch the light.' },
  { id: 'hamper', category: 'woven', title: 'Sabai Storage Basket', material: 'Coiled sabai grass', price: 2390, size: '32 × 36 cm', description: 'A tall, flexible basket with two handles for throws, towels and other everyday pieces.' },
  { id: 'box', category: 'wood', title: 'Carved Petal Box', material: 'Carved mango wood', price: 1190, size: '14 × 10 × 6 cm', description: 'A small keepsake box with a fitted lid and a carved floral pattern.' },
  { id: 'cup', category: 'clay', title: 'Indigo Ripple Cup', material: 'Glazed stoneware', price: 1090, size: 'Cup 8 × 7 cm · saucer 13 cm', description: 'A cup and saucer with loose cobalt bands, inspired by the lines left by a brush over a turning form.' },
];

const categories = [
  { id: 'clay', name: 'Clay & ceramics', image: 'culture-clay', note: 'Unglazed earth and blue floral ceramics.' },
  { id: 'textiles', name: 'Block-printed textiles', image: 'textiles', note: 'Cotton in deep indigo and dusty coral.' },
  { id: 'brass', name: 'Brass objects', image: 'brass', note: 'Hammered surfaces and warm golden tones.' },
  { id: 'woven', name: 'Woven fibres', image: 'basket', note: 'Coiled grass with a visible handwoven texture.' },
  { id: 'wood', name: 'Carved wood', image: 'board', note: 'Warm grain and simple carving.' },
  { id: 'gifts', name: 'Gifts under ₹1,500', image: 'diya', note: 'Small objects ready to give.' },
];

const care = {
  clay: 'Wipe gently by hand and dry before storing. Use the unglazed vase with dried stems.',
  textiles: 'Wash separately in cold water with a mild detergent. Dry in the shade.',
  brass: 'Wipe with a soft dry cloth. Expect natural patina over time.',
  woven: 'Keep dry and dust with a soft brush.',
  wood: 'Wipe with a slightly damp cloth and air dry. Avoid soaking.',
};
