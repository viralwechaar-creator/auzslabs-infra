export const apps = [
  {id:'style', name:'AUZsStyle', detail:'Retail billing, stock, purchasing and your existing Online store controls.', image:'/legacy-assets/assets/demo-cards/style.png', local:'/style.html?demo=1#/sell', current:'https://auzsstyle.auzslab.in/'},
  {id:'ledger', name:'AUZsLedger', detail:'Invoicing, books, GST, receivables and supplier accounts.', image:'/legacy-assets/assets/demo-cards/ledger.png', local:'/accounts.html?demo=1', current:'https://auzsledger.auzslab.in/'},
  {id:'salon', name:'Salon Console', detail:'Appointments, check-ins, service billing and salon operations.', image:'/legacy-assets/assets/demo-cards/salon.png', local:'/salon/admin/', current:'https://showoffsalon.auzslab.in/salon/admin/'},
];

export const templates = [
  {id:'minimal', name:'Minimal', type:'Retail', image:'/preview-assets/genx-minimal-hero-folded-print.png', description:'An image-led fashion storefront with swipeable rails and editorial product pages.', price:6999, path:'/store.html?template=minimal'},
  {id:'classic', name:'Classic', type:'Retail', image:'/preview-assets/tee-editorial.png', description:'A catalog-first storefront with familiar navigation, collections and checkout.', price:3999, path:'/store.html?template=classic'},
  {id:'salon', name:'Salon', type:'Services', image:'/salon/assets/hero-photo.jpg', description:'Showoff Salon’s service menu, team and appointment booking experience.', price:5499, path:'/salon/'},
  {id:'kiln', name:'Kiln', type:'Hospitality', image:'https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=900&q=80', description:'The existing café and bakery website with an editorial menu and reservations.', price:4999, path:'/site-kiln.html'},
];

export const roles = [
  {id:'sales', name:'Field sales', description:'Meet businesses, demo AUZslab and follow up with new customers.'},
  {id:'support', name:'Customer support', description:'Help businesses set up their accounts, stores and day-to-day workflows.'},
  {id:'operations', name:'Business operations', description:'Support onboarding, client operations and the team behind AUZslab.'},
  {id:'developer', name:'Developer partner', description:'Submit a theme or business app for review and propose your commission terms.'},
  {id:'other', name:'Open application', description:'Pitch a role, an idea, or a way to work with AUZslab.'},
];

export const demoStoreLocations=[
  ['jodhpur','GenX Cloths · Jodhpur','3/21 DDP Nagar, Madhuban, Jodhpur 342005','1792612270380-c98i2.jpg'],
  ['delhi','GenX Cloths · New Delhi','RZ-47, 357 Najafgarh, New Delhi 110043','1792614482382-rk85w.jpg'],
  ['jaipur','GenX Cloths · Jaipur','E-48 Banker’s Colony, Jaipur 302021','1792614939903-szq29.jpg'],
].map(([id,title,address,file])=>({id,title,address,type:'Store location',hours:'9 AM – 10 PM',image:'https://api.auzslab.in/uploads/site/demo/style/'+file}));

const storeRail={id:'store-cards',type:'Store cards',title:'Stores across India',count:3};
const storePage={id:'store-directory',type:'Stores directory',title:'Our stores',blocks:demoStoreLocations};
const defaultFooter={id:'store-footer',type:'Store footer',title:'Store footer',blocks:[
  ['orders','My account & orders','Order support','#/me'],
  ['tracking','Track your order','Order support','#/orders'],
  ['returns','Returns & exchanges','Order support','#/policy/returns'],
  ['shipping','Shipping policy','Order support','#/policy/shipping'],
  ['faq','FAQs','Order support','#/faq'],
  ['terms','Terms','Order support','#/policy/terms'],
  ['privacy','Privacy','Order support','#/policy/privacy'],
  ['story','Our story','Explore the store','#/about'],
  ['locations','Walk-in stores','Explore the store','#/stores'],
  ['collections','Collections','Explore the store','#/collections'],
  ['contact','Contact','Explore the store','#/contact'],
].map(([id,title,group,href])=>({id,title,group,href,type:'Footer link'}))};

export function themeWithStoreSections(design,defaults={storePage,storeRail,defaultFooter}){
  const pages={...design.pages};
  if(!Object.hasOwn(pages,'stores')){
    pages.stores=[structuredClone(defaults.storePage)];
    if(design.theme==='minimal'&&!pages.home?.some(section=>section.type==='Store cards'))pages.home=[...(pages.home||[]),structuredClone(defaults.storeRail)];
    if(!pages.footer?.some(section=>section.type==='Store footer'))pages.footer=[structuredClone(defaults.defaultFooter),...(pages.footer||[])];
  }
  return {...design,pages};
}

export const menu = [
  {id:'home', name:'Home', icon:'home'},
  {id:'orders', name:'Orders', icon:'bag', children:[['drafts','Drafts'],['abandoned-checkouts','Abandoned checkouts'],['returns','Returns'],['shipping','Shipping']]},
  {id:'products', name:'Products', icon:'box', children:[['collections','Collections'],['inventory','Inventory'],['transfers','Transfers'],['categories','Categories and tags']]},
  {id:'customers', name:'Customers', icon:'user', children:[['segments','Segments'],['companies','Companies']]},
  {id:'growth', name:'Growth', icon:'spark'},
  {id:'discounts', name:'Discounts', icon:'tag'},
  {id:'content', name:'Content', icon:'file', children:[['pages','Pages and menus'],['files','Files'],['data','Custom data']]},
  {id:'markets', name:'Markets', icon:'globe'},
  {id:'analytics', name:'Analytics', icon:'chart',children:[['reports','Reports'],['live-view','Live view']]},
  {label:'Sales channels'},
  {id:'website', name:'Online store', icon:'globe', children:[['builder','Theme editor'],['templates','Themes'],['store-pages','Pages'],['domains','Domains'],['checkout','Checkout and accounts']]},
  {id:'apps', name:'Apps and plans', icon:'grid'},
  {label:'Business'},
  {id:'team', name:'Staff and access', icon:'user', children:[['roles','Roles'],['locations','Locations']]},
  {id:'settings', name:'Settings', icon:'settings', children:[['payments','Payments'],['taxes','Taxes and duties'],['languages','Languages'],['policies','Store policies'],['privacy-settings','Customer privacy'],['billing','Billing and renewals'],['notifications','Notifications'],['security','Sign-in and support'],['account-data','Account data and privacy'],['connectors','AI connectors'],['consoles','Admin and Careers']]},
];

export const icons = {
  tag:'M3 4h7l10 10-6 6L3 9z M7 7h.01',
  pin:'M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0z M14 10a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
  lock:'M6 10h12v10H6z M8 10V7a4 4 0 0 1 8 0v3',
  card:'M3 6h18v12H3z M3 10h18 M7 15h4',
  home:'M3 10l9-7 9 7v10h-6v-6H9v6H3z', bag:'M5 8h14l1 12H4z M8 9V6a4 4 0 0 1 8 0v3',
  box:'M3 7l9-4 9 4v10l-9 4-9-4z M3 7l9 4 9-4 M12 11v10',
  user:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z M4 21v-2a8 7 0 0 1 16 0v2',
  spark:'M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z',
  file:'M5 3h9l5 5v13H5z M14 3v6h5 M8 13h8 M8 17h7',
  chart:'M4 20h16 M7 16v-4 M12 16V8 M17 16V4',
  globe:'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0z M2 12h20 M12 2a4 10 0 1 0 0 20 4 10 0 0 0 0-20z',
  grid:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  settings:'M12 2v4m0 12v4M2 12h4m12 0h4m-3-7-3 3m-8 8-3 3m0-14 3 3m8 8 3 3 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
  search:'M16 10a6 6 0 1 1-12 0 6 6 0 0 1 12 0zm-2 4 5 5',
  menu:'M4 6h16 M4 12h16 M4 18h16',
  bell:'M18 8a6 6 0 0 0-12 0c0 6-2 7-2 9h16c0-2-2-3-2-9 M10 21h4',
  moon:'M20 15a8.5 8.5 0 0 1-11-11 8.5 8.5 0 1 0 11 11z',
  sun:'M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l1 1 M18 18l1 1 M19 5l-1 1 M6 18l-1 1',
};

export const seed = {
  business:{name:'GenX Cloths', email:'owner@example.test', phone:'', currency:'INR', domain:'genx.example.test'},
  products:[
    {id:'orbit', name:'Orbit Graphic Tee', category:'T-shirts', price:1499, stock:18, sku:'GX-ORB-BLK', image:'/preview-assets/tee-editorial.png', status:'Active', tags:'graphic, streetwear', options:'Colour: Black, Bone White\nSize: S, M, L, XL', description:'Oversized cotton jersey with an orbital front graphic.'},
    {id:'switchback', name:'Switchback Wide-Leg Jeans', category:'Denim', price:2999, stock:12, sku:'GX-SWB-IND', image:'/preview-assets/denim-editorial.png', status:'Active', tags:'denim', options:'Wash: Indigo, Ecru\nWaist: 28, 30, 32, 34, 36', description:'Wide-leg denim with curved knee seams.'},
    {id:'field', name:'Field Utility Overshirt', category:'Shirts', price:2499, stock:7, sku:'GX-FLD-COL', image:'/preview-assets/field-editorial.png', status:'Active', tags:'layering', options:'Colour: Charcoal, Sand', description:'Brushed cotton twill with roomy patch pockets.'},
    {id:'slate', name:'Washed Slate Cap', category:'Accessories', price:899, stock:4, sku:'GX-SLT-CAP', image:'/preview-assets/slate-cap-colour-black.jpg', status:'Active', tags:'cap', options:'Fit: One size', description:'Washed cotton cap with an adjustable strap.'},
    {id:'metro', name:'Metro Ripstop Crossbody', category:'Bags', price:1899, stock:9, sku:'GX-MTR-OLV', image:'/preview-assets/metro-olive-black.jpg', status:'Draft', tags:'ripstop', options:'Colour: Olive, Black', description:'A compact everyday crossbody.'},
    {id:'case', name:'Ridge Grip Case', category:'Accessories', price:1499, stock:0, sku:'GX-RDG-SLT', image:'/preview-assets/case-slate-black.jpg', status:'Draft', tags:'case', options:'Device: iPhone 16, iPhone 16 Pro', description:'Protective hard shell with a sculpted grip.'},
  ],
  categories:['T-shirts','Denim','Shirts','Accessories','Bags'],
  collections:[
    {id:'offbeat', name:'Offbeat Streetwear', description:'Original graphics and statement fits.', products:['orbit','field'], image:'/preview-assets/tee-editorial.png'},
    {id:'denim', name:'Denim in Motion', description:'Relaxed denim and workwear.', products:['switchback','field'], image:'/preview-assets/denim-wide.png'},
    {id:'small', name:'Small Essentials', description:'Everyday accessories.', products:['slate','metro','case'], image:'/preview-assets/essentials-wide.png'},
  ],
  orders:[
    {id:'1048', customer:'Avery Demo', item:'Orbit Graphic Tee', product:'orbit', quantity:1, total:1499, payment:'Paid', status:'Unfulfilled', channel:'Online store', date:'2026-11-21'},
    {id:'1047', customer:'Pari Demo', item:'Switchback Wide-Leg Jeans', product:'switchback', quantity:1, total:2999, payment:'Paid', status:'Fulfilled', channel:'Online store', date:'2026-11-20'},
    {id:'1046', customer:'Dev Demo', item:'Field Utility Overshirt', product:'field', quantity:1, total:2499, payment:'Paid', status:'Fulfilled', channel:'AUZsStyle', date:'2026-11-20'},
    {id:'1045', customer:'Mira Demo', item:'Washed Slate Cap', product:'slate', quantity:1, total:899, payment:'Pending', status:'Unfulfilled', channel:'Online store', date:'2026-11-19'},
  ],
  returns:[{id:'R-18', order:'1047', reason:'Size exchange', status:'Requested', restocked:false}],
  abandonedCheckouts:[{id:'A-01',customer:'Sample shopper',product:'orbit',quantity:1,date:'2026-11-20'}],
  companies:[],
  domains:[],
  themeDrafts:{},
  customers:[
    {id:'c1', name:'Avery Demo', email:'avery@example.test', phone:'', city:'Jodhpur', status:'Subscribed'},
    {id:'c2', name:'Pari Demo', email:'pari@example.test', phone:'', city:'Jaipur', status:'Subscribed'},
    {id:'c3', name:'Dev Demo', email:'dev@example.test', phone:'', city:'Jodhpur', status:'Unsubscribed'},
  ],
  segments:[{id:'seg1',name:'Email subscribers',city:'',status:'Subscribed'}],
  markets:[{id:'market1',name:'India',region:'India',currency:'INR',language:'English',status:'Active'}],
  checkout:{heading:'GenX Cloths',accent:'#214d3a',contact:'Email',guest:'Enabled',confirmation:'Thank you for your order.'},
  settingsDrafts:{},
  campaigns:[
    {id:'m1', name:'November drop', source:'Instagram', status:'Active', sessions:614, leads:31, orders:14},
    {id:'m2', name:'Everyday essentials', source:'Google', status:'Active', sessions:482, leads:23, orders:9},
    {id:'m3', name:'GenX early access', source:'Email', status:'Completed', sessions:219, leads:16, orders:8},
  ],
  discounts:[{id:'d1', name:'GENX10', type:'Percentage', value:10, status:'Active'}],
  pages:[{id:'p1', name:'About', slug:'about', content:'GenX Cloths is a local preview storefront.', status:'Visible'},{id:'p2', name:'Contact', slug:'contact', content:'Contact our store.', status:'Visible'}],
  files:[],
  customFields:[{id:'f1', name:'Material', target:'Product', type:'Text'},{id:'f2', name:'Care instructions', target:'Product', type:'Long text'}],
  staff:[{id:'s1', name:'Demo Owner', email:'owner@example.test', role:'Owner', status:'Active'},{id:'s2', name:'Demo Store Manager', email:'manager@example.test', role:'Manager', status:'Active'}],
  locations:[{id:'l1', name:'Jodhpur flagship', city:'Jodhpur', status:'Active'},{id:'l2', name:'Online warehouse', city:'Jodhpur', status:'Active'}],
  stockLocations:{},
  transfers:[],
  stockHistory:[],
  shipping:[{id:'sh1', name:'Standard delivery', region:'India', price:99},{id:'sh2', name:'Local pickup', region:'Jodhpur', price:0}],
  notifications:[{id:'n1', name:'Order #1048 is ready for fulfillment', read:false},{id:'n2', name:'Washed Slate Cap has 4 units available', read:false}],
  applications:[],
  builder:themeWithStoreSections({theme:'minimal', accent:'#25382e', pages:{
    home:[{id:'hero', type:'Hero', title:'New arrivals', image:'/preview-assets/genx-minimal-hero-folded-print.png', hidden:false},{id:'drop', type:'Product row', title:'Latest drop', source:'all', selected:[], count:4, desktop:4, mobile:2, layout:'Grid', mobileLayout:'Carousel', hidden:false},{id:'collections', type:'Collection slider', title:'Collections', source:'all', count:3, hidden:false}],
    product:[{id:'product-detail', type:'Product details', title:'Product information', hidden:false}],
    collection:[{id:'cat', type:'Product row', title:'Shop the collection', source:'all', selected:[], count:6, desktop:4, mobile:2, layout:'Grid', mobileLayout:'Grid', hidden:false}],
    about:[{id:'about', type:'Text', title:'About GenX', text:'Streetwear, denim and essentials.', hidden:false}],
    contact:[{id:'contact', type:'Contact form', title:'Contact us', hidden:false}],
    cart:[{id:'cart-title',type:'Text',title:'Your bag',text:'Products added to the bag appear here.',hidden:false}],
    search:[{id:'search-title',type:'Text',title:'Find a product',text:'Browse the catalog by product name or category.',hidden:false}],
    header:[{id:'nav', type:'Navigation', title:'Main navigation', hidden:false}],
    footer:[{id:'newsletter', type:'Newsletter', title:'Stay in the loop', hidden:false}]
  }}),
};

export function collectionProducts(collection,products,orders=[]){
  const manual=collection.products||[];
  const rules=collection.rules||[];
  function matches(product,rule){
    const {field,operator,value}=rule;
    if(field==='price'||field==='stock'){
      const left=Number(product[field]), right=Number(value);
      return operator==='gt'?left>right:operator==='lt'?left<right:left===right;
    }
    const wanted=value.toLowerCase();
    const values=field==='tags'?String(product.tags||'').split(',').map(tag=>tag.trim().toLowerCase()):[String(product[field]||'').toLowerCase()];
    return operator==='contains'?values.some(item=>item.includes(wanted)):operator==='neq'?!values.includes(wanted):values.includes(wanted);
  }
  const selected=collection.type==='Smart'
    ? products.filter(product=>rules.length&&(collection.match==='Any'?rules.some(rule=>matches(product,rule)):rules.every(rule=>matches(product,rule))))
    : manual.map(id=>products.find(product=>product.id===id)).filter(Boolean);
  const items=selected.filter(product=>!(collection.excluded||[]).includes(product.id));
  const sold=product=>orders.filter(order=>order.product===product.id&&order.payment==='Paid'&&!['Cancelled','Draft','Returned'].includes(order.status)).reduce((total,order)=>total+(order.quantity||1),0);
  switch(collection.sort){
    case 'Title A–Z':return items.sort((a,b)=>a.name.localeCompare(b.name));
    case 'Title Z–A':return items.sort((a,b)=>b.name.localeCompare(a.name));
    case 'Price low to high':return items.sort((a,b)=>a.price-b.price);
    case 'Price high to low':return items.sort((a,b)=>b.price-a.price);
    case 'Best selling':return items.sort((a,b)=>sold(b)-sold(a));
    default:return items;
  }
}

export function collectionVisible(collection){
  return (collection.channels||['Online store']).includes('Online store')&&(!collection.publishAt||new Date(collection.publishAt)<=new Date());
}
