import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {Resolver} from 'node:dns/promises';
import {fileURLToPath} from 'node:url';
import {seed,collectionProducts,collectionVisible,themeWithStoreSections} from './data.js';
import {packageLimit,readThemePackage,starterThemePackage} from './theme-package.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.dirname(here);
const workspace = path.dirname(repo);
const site = path.join(repo, 'site');
const app = path.join(repo, 'app', 'public');
const packagedStore = path.join(here, 'storefront');
const previewAssets = path.join(here, 'assets');
const recentStore = fs.existsSync(path.join(packagedStore,'store.html')) ? packagedStore : path.join(workspace,'auzslabs-infra','app','public');
const types = {'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.webp':'image/webp','.woff2':'font/woff2','.pdf':'application/pdf','.ico':'image/x-icon','.xml':'application/xml','.txt':'text/plain'};
const options = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Robots-Tag':'noindex, nofollow'};
const port = Number(process.env.AUZ_ECOSYSTEM_PORT || 4226);
const demoUser = {id:'ecosystem-demo-owner',email:'owner@example.test',role:'authenticated',app_metadata:{tenant_id:'ecosystem-preview',role:'owner'}};
const dash = {tenant:{id:'ecosystem-preview',slug:'ecosystem-preview',name:'GenX Cloths',is_demo:true},my_email:demoUser.email,my_role:'owner',features:{style:true,accounting:true,salon:true},enabled_features:{style:true,accounting:true,salon:true}};
const permissionKeys = ['sty_sell','sty_manage','sty_stock','sty_buy','sty_bills','sty_reports','sty_people','acc_sales','acc_purchase','acc_reports','acc_stock','acc_manage','acc_settings','acc_books','acc_gst'];
const permissions = Object.fromEntries(permissionKeys.map(key=>[key,true]));
const branch = {id:'jodhpur',name:'Jodhpur flagship',isMain:true};

const menu = [{id:'hair',name:'Hair',items:[{id:'1',name:'Cut and finish',price:850,duration:45},{id:'2',name:'Colour consultation',price:600,duration:30}]},{id:'care',name:'Skin and care',items:[{id:'3',name:'Signature facial',price:1600,duration:60}]}].map(category=>({...category,items:category.items.map(item=>({...item,active:true}))}));
const salon = {
  settings:{salonName:'Showoff Salon',tagline:'Hair, skin and beauty',address:'Sardarpura, Jodhpur',open:'10:00',close:'20:00',closedDays:[],heroPhoto:'/salon/assets/hero-photo.jpg'},
  content:{heroTitle:'Good hair. Better days.',heroText:'Discover cuts, colour, and everyday care in Jodhpur.',servicesText:'Browse our services.',galleryText:'Inside the salon.',stylistsText:'Meet our team.',aboutTitle:'About the salon',bookText:'Explore appointment times in this local preview.'},
  menu, gallery:[], stylists:[], reviews:[], bookings:[], checkins:[], invoices:[], staff:[], offers:[], packages:[], clientPackages:[],
};
const fallback = {shop:{name:'GenX Cloths'},config:{brandName:'GenX Cloths',on:true},styles:[],collections:[]};
let catalog;
try {catalog = JSON.parse(fs.readFileSync((fs.existsSync(path.join(previewAssets,'genx-minimal-preview.json')) ? path.join(previewAssets,'genx-minimal-preview.json') : path.join(workspace,'genx-minimal-preview.json')),'utf8'));} catch {catalog = fallback;}
const styleStock = seed.products.map(p=>({id:p.id,name:p.name,code:p.sku,category:p.category,price:p.price,photoUrl:p.image,photos:[p.image],description:p.description,active:true,status:'active',stock:p.stock,variants:[{id:p.id+'-variant',sku:p.sku,barcode:p.sku,stock:p.stock,qty:p.stock,onHand:p.stock,price:p.price,size:'One size',colour:'Original'}]}));
const ledgerDashboard = {sales_today:2190,collections_today:1950,purchases_today:600,expenses_today:150,receivables:8300,payables:5200,stock_value:35000,cash_bank:[{id:'cash',name:'Cash drawer',balance:2500}],alerts:{overdue_invoices:1},month:{sales:38500,prev_sales:31200,profit:9200,prev_profit:7200,gross_margin:31},fy:{sales:237000,prev_sales:210000},sales_trend:[],expense_trend:[],top_products:[],top_customers:[],low_products:[],branches:[],budget:[]};

function send(res, status, body, type='application/json'){
  res.writeHead(status,{...options,'Content-Type':type+'; charset=utf-8'});
  res.end(type==='application/json'?JSON.stringify(body):body);
}
function contained(root, name){
  const target=path.resolve(root,'.'+name);
  return path.relative(root,target).startsWith('..')?null:target;
}
function file(res, root, name){
  const full=contained(root,name);
  if(!full || !types[path.extname(full)] || !fs.existsSync(full) || !fs.statSync(full).isFile()) return false;
  res.writeHead(200,{...options,'Content-Type':types[path.extname(full)]});fs.createReadStream(full).pipe(res);return true;
}
function textFile(root,name){return fs.readFileSync(path.join(root,name),'utf8');}
const escapeScript = object => JSON.stringify(object).replace(/</g,'\\u003c');
function browserCatalog(base,itemsFor,visible,normalizeDesign,designMode,template,draftId) {
  try {
    const state = JSON.parse(localStorage.getItem('auzslab.ecosystem.preview.v1'));
    if(!Array.isArray(state?.products))return base;
    if(designMode==='editor')base.previewNavigation=state.navigation;
    if(['saved','draft','page-preview','editor'].includes(designMode)){
      const privatePreview=designMode==='draft'||designMode==='editor';
      const chosen=privatePreview&&draftId?state.themeLibrary?.entries?.[draftId]?.design:
        designMode==='draft'||designMode==='editor'&&state.builder?.theme!==template?state.themeDrafts?.[template]:state.builder;
      if(chosen?.pages){
        base.config.template=chosen.theme==='classic'?'classic':'minimal';
        if(chosen.savedAt||privatePreview&&draftId)base.savedStore={builder:normalizeDesign(chosen),navigation:state.navigation};
      }
    }
    const initial = new Map(base.styles.map(p=>[p.id,p]));
    const safeImage=value=>{
      if(!value)return '';
      if(/^data:image\/(?:webp|png|jpe?g);base64,[a-z0-9+/=]+$/i.test(value))return value;
      try{
        const url=new URL(value,location.origin);
        return /^https?:$/.test(url.protocol)?url.href:'';
      }catch{return '';}
    };
    base.config.minimalPages=(state.pages||[]).filter(page=>designMode==='page-preview'||page.status==='Visible'||page.status==='Scheduled'&&page.publishAt&&new Date(page.publishAt)<=new Date()).map(page=>({
      id:page.id,title:page.name,slug:page.slug,body:page.content,image:safeImage(page.image),layout:page.template,seoTitle:page.seoTitle,seoDescription:page.seoDescription,inMenu:page.inMenu,
      link:page.template==='Contact'?'#/contact':'',cta:page.template==='Contact'?'Contact the store':''
    }));
    if(state.business?.name){base.config.brandName=state.business.name;base.shop.name=state.business.name;}
    base.styles=state.products.filter(p=>p.status==='Active'&&(!p.channels||p.channels.includes('Online store'))).map(p=>{
      const old=initial.get(p.id)||{};
      const defaultStock=p.variants?.length?p.variants:[{id:p.id+'-variant',sku:p.sku,barcode:p.barcode,price:p.price,stock:p.stock}];
      return {...old,id:p.id,name:p.name,code:p.sku,category:p.category,brand:p.vendor,handle:p.handle,seoTitle:p.seoTitle,seoDescription:p.seoDescription,imageAlt:p.imageAlt,price:+p.price,mrp:+p.compare||null,photoUrl:safeImage(p.image),
        photos:[...new Set([p.image,...(p.media||[])].filter(Boolean).map(safeImage))],description:p.description,details:p.options?[p.options]:[],
        variants:defaultStock.map(v=>({id:v.id,sku:v.sku,barcode:v.barcode,price:+v.price,qty:+v.stock,stock:+v.stock,onHand:+v.stock,available:+v.stock,size:v.label||'One size',colour:'Original'})),
        collection:state.collections.find(c=>c.products.includes(p.id))?.id};
    });
    base.collections=state.collections.filter(visible).map(c=>{
      const image=safeImage(c.image);
      return {id:c.id,slug:c.handle||c.id,name:c.name,description:c.description,imageUrl:image,coverUrl:image,photoUrl:image,template:c.template,
        styleIds:itemsFor(c,base.styles.map(p=>({...state.products.find(source=>source.id===p.id),...p})),state.orders).map(p=>p.id)};
    });
  } catch { /* Original preview fixtures are available if browser storage is unavailable. */ }
  return base;
}
function storefront(req,res,url){
  const root = fs.existsSync(path.join(recentStore,'store.html')) ? recentStore : app;
  const data = structuredClone(catalog);
  const template = url.searchParams.get('template')==='classic'?'classic':'minimal';
  const hero = '/preview-assets/genx-minimal-hero-folded-print.png';
  const safeSettings=['tagline','heroTitle','heroCta','faqs','policies','sizeGuide','stores','blogs'];
  data.config=Object.fromEntries(safeSettings.filter(k=>data.config[k]).map(k=>[k,data.config[k]]));
  data.config={...data.config,on:true,template,brandName:'GenX Cloths',heroImages:[hero],heroTitle:'GenX Cloths',heroCta:'Shop now'};
  data.shop={name:'GenX Cloths'};
  data.cod=false;data.upi=null;
  data.styles=styleStock.map((p,i)=>({...p,
    details:[seed.products[i].options],category:seed.products[i].category,
    variants:p.variants.map(v=>({...v,available:v.stock,color:'Original'})),
    collection:seed.collections.find(c=>c.products.includes(p.id))?.id,
  }));
  data.collections=seed.collections.map(c=>({id:c.id,slug:c.id,name:c.name,description:c.description,imageUrl:c.image,coverUrl:c.image,photoUrl:c.image,styleIds:c.products}));
  data.config.minimalPages=seed.pages.filter(page=>page.status==='Visible').map(page=>({title:page.name,slug:page.slug,body:page.content}));
  const designMode=url.searchParams.get('design')||(url.searchParams.has('template')?null:'saved');
  const defaults={storePage:seed.builder.pages.stores[0],storeRail:seed.builder.pages.home.find(s=>s.type==='Store cards'),defaultFooter:seed.builder.pages.footer[0]};
  const mockScript='<script>const CFG={};window.TENANT_SLUG='+escapeScript(designMode==='editor'?'ecosystem-theme-editor':'ecosystem-preview')+';'+
    'const normalizeDesign=design=>('+themeWithStoreSections.toString()+')(design,'+escapeScript(defaults)+');'+
    'const previewCatalog=('+browserCatalog.toString()+')('+escapeScript(data)+','+collectionProducts.toString()+','+collectionVisible.toString()+',normalizeDesign,'+escapeScript(designMode)+','+escapeScript(template)+','+escapeScript(url.searchParams.get('draft'))+');'+
    'window.supabase={createClient:()=>({rpc:async(n)=>n==="public_sty_store"?{data:previewCatalog}:{error:{message:"Checkout and account writes are disabled in this storefront preview."}}})};</script>';
  const html=textFile(root,'store.html').replace(/<script src="\/(?:config\.js|tenant\.js[^"]*|sb-client\.js[^"]*)"><\/script>/g,'').replace('<div id="app"></div>','<div id="app"></div>'+mockScript).replace('</head>','<link rel="stylesheet" href="/store-design.css"></head>');
  return send(res,200,html,'text/html');
}
function api(req,res,route){
  if(route==='/api/domains/verify'&&req.method==='GET'){
    const query=new URL(req.url,'http://127.0.0.1').searchParams;
    const name=query.get('name')||'',token=query.get('token')||'';
    if(!/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(name)||!/^(?:auzslab-)[a-f0-9-]{36}$/.test(token)){
      return send(res,400,{error:'Invalid domain or verification token.'});
    }
    new Resolver({timeout:2000,tries:1}).resolveTxt('_auzslab-verify.'+name+'.')
      .then(records=>send(res,200,{verified:records.some(value=>value.join('')===token)}))
      .catch(error=>send(res,['ENOTFOUND','ENODATA','NXDOMAIN'].includes(error.code)?200:503,{verified:false}));
    return;
  }
  if(route==='/api/theme/starter'&&req.method==='GET'){
    res.writeHead(200,{...options,'Content-Type':'application/zip','Content-Disposition':'attachment; filename="auzslab-theme.zip"'});
    return res.end(starterThemePackage(seed.builder));
  }
  if(route==='/api/theme/import'&&req.method==='POST'){
    const chunks=[];let bytes=0;
    req.on('data',chunk=>{
      if(res.writableEnded)return;
      bytes+=chunk.length;
      if(bytes>packageLimit)return send(res,413,{error:'Choose a ZIP no larger than 2 MB.'});
      chunks.push(chunk);
    });
    req.on('end',()=>{
      if(res.writableEnded)return;
      try {send(res,200,readThemePackage(Buffer.concat(chunks)));}
      catch(error){send(res,400,{error:error instanceof SyntaxError?'The theme manifest contains invalid JSON.':error.message});}
    });
    return;
  }
  if(route==='/setup/state') return send(res,200,{needed:false});
  if(route==='/licence/status') return send(res,200,{});
  if(route==='/auth/login') return send(res,200,{access_token:'local-preview',refresh_token:'local-preview',expires_in:86400,user:demoUser});
  if(route==='/auth/user') return send(res,200,demoUser);
  if(route==='/auth/logout') return send(res,200,{});
  if(route==='/api/site') return send(res,200,salon);
  if(route==='/api/slots') return send(res,200,{slots:['10:30','12:30','15:30'].map(time=>({time,free:true}))});
  if(route==='/api/admin/me') return send(res,200,{admin:true,authenticated:true,ok:true,role:'owner',name:'Preview Owner'});
  if(route==='/api/admin/data') return send(res,200,{...salon,today:new Date().toISOString().slice(0,10),walkins:[],clients:[],feedback:[],expenses:[],visits:[]});
  if(route==='/api/admin/whatsapp') return send(res,200,{enabled:false});
  if(route==='/api/admin/login'||route==='/api/admin/logout') return send(res,200,{ok:true});
  if(route.startsWith('/api/icon/')) return file(res,app,'/salon/assets/icon-192.png');
  if(route==='/api/manifest.json') return file(res,app,'/salon/manifest.json');
  if(route==='/rpc/my_dashboard') return send(res,200,dash);
  if(route==='/rpc/sty_context') return send(res,200,{tenant:dash.tenant,settings:{language:'en',storeName:dash.tenant.name,maxDiscountPct:10},perms:permissions,branches:[branch]});
  if(route==='/rpc/sty_store_get') return send(res,200,{on:true,template:'minimal',brandName:dash.tenant.name,heroImages:['/preview-assets/genx-minimal-hero-folded-print.png'],stores:[],shipping:{},billing:{},payments:{},policies:{},config:{},canEdit:true});
  if(/^\/rpc\/sty_(web_orders_list|web_returns_list|coupons_list|reviews_list|hold_list|customer_search|branches_list)$/.test(route)) return send(res,200,[]);
  if(route==='/rpc/sty_store_analytics') return send(res,200,{views:0,sessions:0,daily:[],pages:[],sources:[],devices:[]});
  if(route==='/rpc/acc_bootstrap') return send(res,200,{tenant:{...dash.tenant,name:'Demo Traders'},org:{id:'preview-ledger',legal_name:'Demo Traders',trade_name:'Demo Traders',state_code:'08',reg_type:'unregistered'},settings:{},perms:permissions,accounts:[],taxcodes:[],branches:[branch],warehouses:[],masters:[],fys:[]});
  if(route==='/rpc/acc_dashboard') return send(res,200,ledgerDashboard);
  if(/^\/rpc\/acc_list_(products|parties|receipts|docs|expenses)$/.test(route)) return send(res,200,{rows:[]});
  if(route==='/db/notifications') return send(res,200,[]);
  if(/^\/rpc\/(sty_(styles|stock|list_styles|catalog|collections|customers|list_customers)|public_sty)/.test(route) && !/place|write|order|submit|reserve/.test(route)) return send(res,200,/collection/.test(route)?dataCollections():/customer/.test(route)?seed.customers:styleStock);
  if(/^\/rpc\/(acc|sty)_(list|dashboard|home|search|report|read|get|overview|context|fy|branches|parties|products|stock|fiscal)/.test(route)) return send(res,200,[]);
  return send(res,req.method==='GET'?404:403,{error:'This action is local preview only.',message:'This action is unavailable in the retained app preview.'});
}
const dataCollections = () => seed.collections.map(c=>({...c,title:c.name}));
const retired = /^\/(?:scan\.html|mob\.html|payroll\.html|finance\.html|(?:auzs(?:pos|scan|mob|pay|finance))(?:\/|\.html|$))/i;
const own = new Set(['/ecosystem.css','/ecosystem.js','/data.js','/workspace.js','/analytics.js','/builder.js','/theme-library.js','/careers.js','/contact.js','/contact-hub.css','/careers-hero.png','/domains.js','/themes.css','/store-design.css']);
const shell = new Set(['/dashboard.html','/signup.html','/review.html','/design-preview.html','/contributor.html']);
const contactRoutes=new Set(['/contact.html','/careers.html','/submit-theme.html','/join.html']);
function replaceWhy(html){
  return html
    .replaceAll('href="account.html#privacy"','href="/dashboard.html#/account-data"')
    .replace(/(<a\b[^>]*\bhref=["'])(?:https:\/\/auzslab\.in\/|\/)?platform\.html(?:#[^"']*)?(["'][^>]*>)(?:Why AUZslab)(<\/a>)/gi,'$1/themes.html$2Themes$3')
    .replace(/\["(?:\/)?platform\.html","Why AUZslab"\]/gi,'["/themes.html","Themes"]')
    .replace(/(href=["'])(?:https:\/\/auzslab\.in\/|\/)?account\.html(?=["'#?])/gi,'$1/dashboard.html')
    .replace(/<a\s+href="teams\.html">Join AUZslab Team<\/a>/gi,'<a href="/careers.html">Careers</a>');
}
function themesPage(res){
  const html=replaceWhy(textFile(site,'themes.html'))
    .replace(/(<a\b[^>]*href="\/themes.html")(?=>Themes)/,'$1 class="on" aria-current="page"')
    .replace(/<main class="content">[\s\S]*?<\/main>/,'<main class="content theme-gallery" data-theme-gallery id="app"></main>')
    .replace('</head>','<link rel="stylesheet" href="/themes.css"><script type="module" src="/ecosystem.js"></script></head>')
    .replace('</body>','<dialog class="theme-dialog" id="dialog"><div id="dialog-body"></div></dialog><div id="toast" role="status"></div></body>');
  return send(res,200,html,'text/html');
}
function contactPage(res,route){
  const html=replaceWhy(textFile(site,'contact.html'))
    .replace('<div class="ct-form mk-sheet rv">','<div class="mk-sheet contact-hub" data-contact-hub>')
    .replace(/(<div[^>]+data-contact-hub>)[\s\S]*?(?=<\/div><\/div>\s*<aside class="ac-side">)/,'$1<p>Loading contact options…</p>')
    .replace('rel="canonical" href="https://auzslab.in/contact.html"','rel="canonical" href="https://auzslab.in'+route+'"')
    .replace('</head>','<link rel="stylesheet" href="/contact-hub.css"><script type="module" src="/ecosystem.js"></script></head>')
    .replace('</body>','<div id="toast" role="status"></div></body>');
  return send(res,200,html,'text/html');
}
function existingPublicPage(res,route){
  const name=route==='/'?'/index.html':route;
  const full=contained(site,name);
  if(!full||!name.endsWith('.html')||!fs.existsSync(full)||!fs.statSync(full).isFile())return false;
  send(res,200,replaceWhy(fs.readFileSync(full,'utf8')),'text/html');
  return true;
}
http.createServer((req,res)=>{
  try{
    const url=new URL(req.url,'http://127.0.0.1');const route=decodeURIComponent(url.pathname);
    if(route.includes('\\')||route.includes('\0')) return send(res,400,{error:'Invalid URL'});
    if(['/platform.html','/templates.html','/marketplace.html'].includes(route)) {res.writeHead(302,{...options,Location:'/themes.html'});return res.end();}
    if(route==='/account.html'){res.writeHead(302,{...options,Location:'/dashboard.html'+url.search});return res.end();}
    if(route==='/themes.html') return themesPage(res);
    if(route==='/teams.html'){
      res.writeHead(302,{...options,Location:'/careers.html'});return res.end();
    }
    if(['/salesos.html','/salesos-careers.html'].includes(route)){
      res.writeHead(302,{...options,Location:'https://auzslab.in/'+(route==='/salesos.html'?'signup.html':'careers.html')});return res.end();
    }
    if(retired.test(route)) {res.writeHead(302,{...options,Location:'/'});return res.end();}
    if(/^\/(?:api|rpc|auth|setup|licence|db)\//.test(route)) return api(req,res,route);
    if(!['GET','HEAD'].includes(req.method)) return send(res,405,{error:'Method not available'});
    if(route==='/robots.txt') return send(res,200,'User-agent: *\nDisallow: /\n','text/plain');
    if(contactRoutes.has(route))return contactPage(res,route);
    if(shell.has(route)) return file(res,here,'/index.html');
    if(own.has(route)&&file(res,here,route)) return;
    if(route==='/store.html') return storefront(req,res,url);
    if(route==='/config.js') return send(res,200,'window.CFG={url:location.origin,key:""};','text/javascript');
    if(route==='/site.js') return send(res,200,textFile(site,'site.js').replace(/https:\/\/auzslab\.in\/account\.html/g,'/dashboard.html'),'text/javascript');
    if(route==='/tenant.js'||route==='/sw.js'||route==='/salon/sw.js') return send(res,200,'// Local ecosystem preview','text/javascript');
    if(route.startsWith('/app-icon/')) return file(res,app,'/salon/assets/icon-192.png');
    if(route.startsWith('/preview-assets/')){
      const name=route.slice('/preview-assets'.length);
      if(file(res,previewAssets,name)||file(res,path.join(workspace,'minimal-preview-assets'),name)) return;
      if(/^\/genx-minimal-hero(?:-folded-print|-branded|-bold)?\.png$/.test(name)&&file(res,workspace,name)) return;
    }
    if(route.startsWith('/legacy-assets/')&&file(res,site,route.slice('/legacy-assets'.length))) return;
    if(route==='/store/store.js'){
      const source=textFile(fs.existsSync(path.join(recentStore,'store','store.js'))?recentStore:app,'store/store.js');
      const designed=source.replace('const r = fn(view, parts[1]);',`const onSaved = () => renderSavedStore(view, id, D.savedStore, D, card, E, link, q$().col, minimalHomeStores, storeCards, footer,parts[1]);
        const currentHash = location.hash;
        const replacesPage = D.savedStore && (id === "home" || id === "stores");
        const r = replacesPage ? onSaved() : !Object.hasOwn(V,id) && D.savedStore ? renderThemeFallback(view,id,E,link,D,card) : fn(view, parts[1]);
        if (D.savedStore && !replacesPage) Promise.resolve(r).then(() => { if (location.hash === currentHash) onSaved(); }).catch(() => {});`)
        .replace("JSON.parse(localStorage.getItem('st.cat.' + SLUG) || 'null')","null")
        .replaceAll("localStorage.setItem('st.cat.' + SLUG, JSON.stringify(d));","/* The local catalog is rendered fresh. */")
        .replace("const id = parts[0] || 'home'; const view", "const id = parts[0] || 'home'; if (id === 'p' && !BYID[parts[1]]) parts[1] = STY.find(p => p.handle === parts[1])?.id || parts[1]; const view")
        .replace("const page = cfg().template === 'minimal' && minimalPages().find", "const page = minimalPages().find")
        .replace("const page = minimal && id === 'page' ? minimalPages().find", "const page = id === 'page' ? minimalPages().find")
        .replace("minimalPages().map((page) => item(page.title", "minimalPages().filter(page => page.inMenu !== false).map((page) => item(page.title")
        .replace("E('article', { class: 'minimal-feature' },\n    E('a', { href: link('sitemap') }, '← Sitemap'), E('h1', null, page.title)", "E('article', { class: 'minimal-feature preview-content-page' + (page.layout === 'Editorial' ? ' editorial-page' : '') },\n    E('a', { href: link('sitemap') }, '← Sitemap'), E('h1', null, page.title)")
        .replace("article?.title || page?.title", "article?.title || page?.seoTitle || page?.title")
        .replace("(page?.body || '').slice(0, 150)", "(page?.seoDescription || page?.body || '').slice(0, 150)")
        .replace('window.scrollTo(0, 0); navState();','window.scrollTo(0, 0); navState(); if (q$().section) requestAnimationFrame(() => [...document.querySelectorAll("[data-theme-section]")].find(node => node.dataset.themeSection === q$().section)?.scrollIntoView({block:"start"}));')
        .replace("setMeta(s.name + ' · ' + D.shop.name, (s.description || s.name).slice(0, 150)", "setMeta((s.seoTitle || s.name) + ' · ' + D.shop.name, (s.seoDescription || s.description || s.name).slice(0, 150)");
      const previewBridge=`
        if (new URLSearchParams(location.search).get('design') === 'editor' && window.parent !== window) {
          let previousSelection = '', previousDesign = '';
          const inspect = createStoreInspector();
          window.addEventListener('message', event => {
            const info = event.data;
            if (event.origin !== location.origin || event.source !== window.parent ||
                info?.type !== 'auzslab-editor-design' || !info.design?.pages || !D) return;
            const signature = JSON.stringify(info.design);
            const oldY = scrollY;
            if (signature !== previousDesign) {
              previousDesign = signature;
              D.savedStore = {builder:info.design, navigation:D.previewNavigation};
              D.config.stores = editorStoreLocations(info.design);
              route();
            }
            const selection = info.previewPage + ':' + info.section + ':' + (info.element || '');
            const selectChanged = selection !== previousSelection;
            previousSelection = selection;
            requestAnimationFrame(() => {
              const picked = inspect(info);
              const element = [...document.querySelectorAll('[data-theme-section]')].find(section => section.dataset.themeSection === info.section);
              if (selectChanged && picked) picked.scrollIntoView({block:'nearest',behavior:'instant'});
              else if (element && selectChanged && info.section !== 'hero') element.scrollIntoView({block:'start',behavior:'instant'});
              else window.scrollTo({top:oldY,behavior:'instant'});
            });
          });
        }
      `;
      return send(res,200,textFile(here,'store-design.js')+'\n'+designed.replace("  const so = q.sort || 'new';","  if (q.col && !q.sort) { const order = D.collections.find(c => c.id === q.col)?.styleIds || []; return list.sort((a,b) => order.indexOf(a.id) - order.indexOf(b.id)); }\n  const so = q.sort || 'new';")+previewBridge,'text/javascript');
    }
    if(route.startsWith('/store/')&&(file(res,recentStore,route)||file(res,app,route))) return;
    if(route.startsWith('/salon/')&&file(res,app,route.endsWith('/')?route+'index.html':route)) return;
    if(route==='/site-kiln.html'||route==='/style.html'||route==='/accounts.html'){
      let html=textFile(app,route.slice(1));
      if(route==='/site-kiln.html')html=html.replace(/<script[^>]*src="\/tenant\.js[^"]*"[^>]*><\/script>/g,'');
      html=html.replace('</body>','<div style="position:fixed;right:8px;bottom:8px;z-index:9000;padding:5px 9px;border-radius:8px;background:#18291f;color:white;font:12px system-ui">Local preview · sample data</div></body>');
      return send(res,200,html,'text/html');
    }
    if(existingPublicPage(res,route)) return;
    if(!route.endsWith('.html')&&(file(res,site,route)||file(res,app,route))) return;
    return send(res,404,{error:'Page unavailable in the local preview.'});
  }catch(error){console.error(error.message);return send(res,500,{error:'Preview could not load this page.'});}
}).listen(port,'127.0.0.1',()=>console.log('AUZslab ecosystem preview: http://127.0.0.1:'+port+'/'));
