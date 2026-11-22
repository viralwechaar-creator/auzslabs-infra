import {templates, roles, menu, icons, seed, themeWithStoreSections} from './data.js';
import {workspace} from './workspace.js';
import {bindThemePreview, editTheme, savedDesign} from './builder.js';
import {careersPage, careerStep, validateCareerStep} from './careers.js';
import {contactReview, renderContactHub, saveContactEnquiry} from './contact.js';

const storeKey = 'auzslab.ecosystem.preview.v1';
export const $ = selector => document.querySelector(selector);
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const money = value => new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(value);
export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString().slice(0,10);
export const localUrl = (value, fallback='') => {
  if(typeof value!=='string'||!value.trim()) return fallback;
  try {const url=new URL(value,location.origin);return ['https:','http:'].includes(url.protocol)?value:fallback;} catch{return fallback;}
};
const defaultState=()=>structuredClone(seed);
export const state = (()=>{
  const defaults=defaultState();
  try{
    const stored=JSON.parse(localStorage.getItem(storeKey));
    if(!stored)return defaults;
    const builder=themeWithStoreSections(stored.builder||defaults.builder);
    return {...defaults,...stored,builder:{...defaults.builder,...builder,pages:{...defaults.builder.pages,...builder.pages}}};
  }catch{return defaults;}
})();
export const io = {};
let handlePage = null;
let selectedRole = 'sales';
let templateFilter = 'All templates';
let navOpen = false;
const contributorKey = 'auzslab.ecosystem.contributor';

export function icon(name){return '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="'+(icons[name]||icons.grid)+'"/></svg>';}
export const button=(name,action,kind='')=>'<button type="button" class="btn '+kind+'" data-action="'+esc(action)+'">'+name+'</button>';
export const link=(name,path,kind='')=>'<a class="btn '+kind+'" href="'+esc(path)+'">'+name+'</a>';
export const badge=(name,kind='')=>'<span class="chip '+kind+'">'+esc(name)+'</span>';
export const imageUrl=src=>/^data:image\/(?:webp|png|jpe?g);base64,[a-z0-9+/=]+$/i.test(src||'')?src:localUrl(src);
export const image=(src,alt='',className='')=>src?'<img src="'+esc(imageUrl(src))+'" alt="'+esc(alt)+'" class="'+esc(className)+'" loading="lazy">':'';
export function flash(text){$('#toast').textContent=text;clearTimeout(io.toast);io.toast=setTimeout(()=>$('#toast').textContent='',4200);}
export function save(message){try{localStorage.setItem(storeKey,JSON.stringify(state));if(message)flash(message);return true;}catch{flash('Browser storage is full or unavailable. Changes are kept for this session.');return false;}}
export function dialog(title,body,opts={}){
  const root=$('#dialog');root.classList.toggle('preview-dialog',!!opts.wide);
  $('#dialog-body').innerHTML='<div class="dialog-head"><h2>'+esc(title)+'</h2><button type="button" class="btn icon" data-action="close-dialog" aria-label="Close dialog">×</button></div><div class="dialog-content">'+body+'</div>';
  if(!root.open)root.showModal();
}
export function close(){if($('#dialog').open)$('#dialog').close();}
const brand = (href='/') => '<a class="brand" href="'+href+'" aria-label="AUZslab home"><img src="/legacy-assets/logo.png" alt="AUZslab" width="94" height="29"></a>';
const publicNav=[['/products.html','Services'],['/live-demo.html','Live demo'],['/studio.html','Studio'],['/themes.html','Themes'],['/contact.html','Contact']];
function publicHeader(path){
  return '<header class="public-head"><div class="wrap nav">'+brand()+'<nav aria-label="Main">'+publicNav.map(([href,label])=>'<a href="'+href+'"'+(path===href?' aria-current="page"':'')+'>'+label+'</a>').join('')+'</nav>'+link('Get started','/signup.html','ghost')+'</div></header>';
}
function footer(){
  return '<footer class="footer"><div class="wrap"><div>'+brand()+'<p>Software and websites for businesses that sell, serve, and grow.</p></div><nav aria-label="Products"><strong>Explore</strong><a href="/products.html">Apps</a><a href="/themes.html">Themes</a><a href="/live-demo.html">Local demos</a></nav><nav aria-label="Company"><strong>Company</strong><a href="/careers.html">Careers</a><a href="/careers.html?role=developer">Developer partners</a><a href="/contact.html">Contact</a><a href="/dashboard.html">Business account</a></nav></div><div class="foot-legal"><div class="wrap" style="padding:0;display:flex;justify-content:space-between"><small>© AUZslab</small><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms</a></div></div></footer>';
}
function publicTitle(title,copy){
  return '<div class="wrap public-title"><h1>'+title+'</h1><p>'+copy+'</p></div>';
}
const reviewsEnabled = () => state.applications.filter(a=>a.status==='Approved'&&a.role==='developer'&&a.kind==='Website template');
function templateCards(selected='All templates', limit=Infinity){
  const partner=reviewsEnabled().map(x=>({id:x.id,name:x.project,type:'Partner',description:x.experience,price:x.price,path:x.portfolio,author:x.name}));
  return [...templates,...partner].filter(t=>selected==='All templates'||t.type===selected).slice(0,limit).map(t=>'<article class="card"><div class="tile-img">'+(t.image?image(t.image,t.name+' website'):'<span class="theme-monogram" aria-hidden="true">'+esc(t.name.slice(0,1))+'</span>')+'</div><div class="card-body"><div class="theme-title-row"><h3>'+esc(t.name)+'</h3>'+badge(t.type)+'</div><p>'+esc(t.description)+'</p><div class="actions"><span class="price">'+money(t.price)+'</span>'+(t.author?'<a class="btn" href="'+esc(localUrl(t.path,'#'))+'" target="_blank" rel="noopener noreferrer">Open demo</a>':'<button class="btn" type="button" data-action="preview:'+t.id+'" aria-label="Preview '+esc(t.name)+' theme">Preview <span aria-hidden="true">↗</span></button>')+'</div></div></article>').join('');
}
function galleryHtml(){
  return '<div class="wrap theme-heading"><div><h1>Website themes</h1><p>Preview storefronts for retail, salons, and hospitality. Prices are illustrative.</p></div>'+link('Submit a theme','/careers.html?role=developer')+'</div><section class="wrap theme-catalog" aria-label="Theme catalog"><div class="pills" aria-label="Filter themes">'+['All templates','Retail','Services','Hospitality','Partner'].map(x=>'<button type="button" data-action="template-filter:'+x+'" aria-pressed="'+(x===templateFilter)+'">'+(x==='All templates'?'All themes':x)+'</button>').join('')+'</div><div class="cards">'+(templateCards(templateFilter)||'<p class="theme-empty">No approved partner themes yet.</p>')+'</div></section>';
}
function publicPage(path){
  let content='';
  if(path==='/design-preview.html'){
    content=savedDesign();
  } else if(path==='/signup.html'){
    document.title='Business sign-in preview — AUZslab';
    content=publicTitle('Business workspace','Open the redesigned dashboard with the GenX Cloths demo account.')+
      '<section class="wrap public-block" style="padding-top:8px"><div class="actions">'+link('Continue as GenX Cloths',pathFor('home'),'primary')+'<a class="btn" href="https://auzslab.in/signup.html">Sign in to live AUZslab</a></div></section>';
  } else if(path==='/contributor.html'){
    const email=sessionStorage.getItem(contributorKey);
    const entries=email?state.applications.filter(a=>a.email.toLowerCase()===email.toLowerCase()):[];
    content=publicTitle('Contributor account','Track your AUZslab applications and partner submissions.')+'<section class="wrap public-block" style="padding-top:0">'+(entries.length?'<div class="stack">'+entries.map(a=>'<article class="card"><div class="card-body"><div class="section-top"><div><h3>'+esc(a.project||roles.find(r=>r.id===a.role)?.name||'Application')+'</h3><p>'+esc(a.name+' · '+a.submitted)+'</p></div>'+badge(a.status)+'</div>'+(a.kind==='Website template'&&a.status==='Approved'?link('View marketplace','/templates.html'):'')+'</div></article>').join('')+'</div><div class="actions" style="margin-top:14px">'+link('New application','/careers.html')+button('Sign out','contributor-signout')+'</div>':'<article class="card"><div class="card-body"><form data-form="contributor" class="field-grid"><label>Application email<input name="email" type="email" required></label><div class="wide"><p>Local preview access uses the fictional email entered on your application.</p><button class="btn primary">View submissions</button> '+link('Start an application','/careers.html')+'<output role="status"></output></div></form></div></article>')+'</section>';
  } else if(path==='/themes.html'){
    content=galleryHtml();
  } else if(path==='/careers.html'){
    document.title='Careers & partnerships — AUZslab';
    content=careersPage(selectedRole);
  } else if(path==='/review.html'){
    content=publicTitle('Application review','Review the career applications and partner proposals created in this browser.')+'<section class="wrap public-block" style="padding-top:0"><div class="notice">Local reviewer preview. Approving a template lists it in the Partner filter. A job application or app proposal stays in the review queue.</div><div class="stack">'+(state.applications.map(a=>'<article class="card"><div class="card-body"><div class="section-top"><div><h3>'+esc(a.project||a.name)+'</h3><p>'+esc(a.name+' · '+a.email+' · '+a.city)+'</p></div>'+badge(a.status)+'</div><p>'+esc(a.experience)+'</p>'+(a.resume?'<p>PDF selected: '+esc(a.resume)+'</p>':'')+(a.portfolio?'<p>'+esc(a.kind)+' · '+money(a.price)+' proposed · '+esc(a.commission)+'% commission</p>':'')+'<div class="actions">'+button('Approve','review:'+a.id+':Approved','primary')+button('Decline','review:'+a.id+':Declined')+'</div></div></article>').join('')||'<p>No applications submitted yet.</p>')+'</div></section>';
  }
  return publicHeader(path)+'<main id="main">'+content+(path==='/review.html'?contactReview():'')+'</main>'+footer();
}
const allItems=menu.flatMap(m=>m.id?[[m.id,m.name],...(m.children||[])]:[]);
const settingsGroups=[
  {label:'Business',items:[['settings','Business profile','settings'],['billing','Billing and renewals','file'],['team','Staff and access','user'],['roles','Roles','lock'],['locations','Locations','pin'],['apps','Apps and plans','grid']]},
  {label:'Store operations',items:[['payments','Payments','card'],['checkout','Checkout and accounts','bag'],['shipping','Shipping and delivery','box'],['taxes','Taxes and duties','file'],['domains','Domains','globe'],['languages','Languages','globe']]},
  {label:'Preferences and access',items:[['notifications','Notifications','bell'],['policies','Store policies','file'],['privacy-settings','Customer privacy','lock'],['account-data','Account data and privacy','file'],['security','Sign-in and support','lock'],['connectors','AI connectors','grid'],['consoles','Admin and Careers','user']]},
];
const settingsRoutes=new Set(['settings',...(menu.find(item=>item.id==='settings')?.children||[]).map(([id])=>id)]);
let returnToWorkspace='home';
const dashboardPath='/dashboard.html';
export const pathFor=id=>dashboardPath+'#/'+id;
export function rerender(){
  const path=location.pathname;
  handlePage=null;
  const contactHub=$('[data-contact-hub]');
  if(contactHub){renderContactHub(contactHub,selectedRole);return;}
  if($('[data-theme-gallery]')){$('#app').innerHTML=galleryHtml();return;}
  if(path!==dashboardPath){$('#app').innerHTML=publicPage(path);if(path==='/design-preview.html')bindThemePreview();return;}
  const requested=location.hash.replace(/^#\/?/,'').split('?')[0];
  const [parent,record]=requested.split('/');
  const active=allItems.some(([id])=>id===parent)?parent:'home';
  const context=new URLSearchParams(location.hash.split('?')[1]);
  const inSettings=settingsRoutes.has(active)||context.get('via')==='settings';
  if(!inSettings)returnToWorkspace=requested||'home';
  const workspaceMenu=menu.filter(item=>item.id!=='settings');
  const nav=workspaceMenu.map(m=>m.label?'<div class="nav-label">'+m.label+'</div>':'<a href="'+pathFor(m.id)+'"'+(m.id===active?' aria-current="page"':'')+'>'+icon(m.icon)+m.name+'</a>'+([m.id,...(m.children||[]).map(([id])=>id)].includes(active)?(m.children||[]).map(([id,name])=>'<a class="sub" href="'+pathFor(id)+'"'+(id===active?' aria-current="page"':'')+'>'+name+'</a>').join(''):'')).join('');
  const search='<button class="btn side-search" type="button" data-action="global-search" aria-label="Search workspace" title="Search workspace (Ctrl K or ⌘K)">'+icon('search')+'<span class="side-search-label">Search</span></button>';
  const unread=state.notifications.filter(n=>!n.read).length;
  const {html, dispatch}=active==='builder'?editTheme():workspace(active,record);
  handlePage=dispatch;
  const accountTheme=localStorage.getItem('auzslab.preview.theme')||'auto';
  const activeName=allItems.find(([id])=>id===active)?.[1]||'Overview';
  const dark=accountTheme==='dark';
  const headerActions='<div class="topbar-actions">'+
    '<a class="btn top-action" href="'+pathFor('notifications')+'" aria-label="Notifications'+(unread?', '+unread+' unread':'')+'" title="Notifications">'+icon('bell')+'<span class="top-action-label">Notifications</span>'+(unread?'<span class="top-count" aria-hidden="true">'+unread+'</span>':'')+'</a>'+
    '<a class="btn top-action" href="/store.html?design=saved#/" aria-label="View site" title="View site">'+icon('globe')+'<span class="top-action-label">View site</span></a>'+
    '<button type="button" class="btn top-action" data-action="account-theme" aria-label="Switch to '+(dark?'light':'dark')+' mode" title="Switch to '+(dark?'light':'dark')+' mode">'+icon(dark?'sun':'moon')+'<span class="top-action-label">'+(dark?'Light':'Dark')+'</span></button></div>';
  const initials=state.business.name.trim().split(/\s+/).slice(0,2).map(word=>Array.from(word)[0]||'').join('').toUpperCase();
  const sidebarBottom='<div class="sidebar-bottom"><a class="sidebar-settings" href="'+pathFor('settings')+'"'+(inSettings?' aria-current="'+(active==='settings'?'page':'true')+'"':'')+'>'+icon('settings')+'<span>Settings</span></a>'+
    '<div class="sidebar-store-row"><a class="workspace-id" href="'+pathFor('website')+'" title="'+esc(state.business.name)+' online store"><span class="avatar" aria-hidden="true">'+esc(initials)+'</span><strong>'+esc(state.business.name)+'</strong></a>'+
    '<a class="sidebar-alerts" href="'+pathFor('notifications')+'" aria-label="Store notifications'+(unread?', '+unread+' unread':'')+'" title="Store notifications">'+icon('bell')+(unread?'<span aria-hidden="true">'+Math.min(unread,99)+(unread>99?'+':'')+'</span>':'')+'</a></div></div>';
  const settingsNav=settingsGroups.map(group=>'<section data-settings-group><div class="nav-label">'+group.label+'</div>'+group.items.map(([id,label,glyph])=>'<a href="'+pathFor(id+(settingsRoutes.has(id)?'':'?via=settings'))+'"'+(id===active?' aria-current="page"':'')+'>'+icon(glyph)+'<span>'+label+'</span></a>').join('')+'</section>').join('');
  const sidebar=inSettings?
    '<aside class="sidebar settings-sidebar" id="workspace-sidebar"><div class="settings-rail">'+brand('/')+search+'<nav aria-label="Workspace">'+workspaceMenu.filter(item=>item.id).map(item=>'<a href="'+pathFor(item.id)+'" aria-label="'+item.name+'" title="'+item.name+'">'+icon(item.icon)+'</a>').join('')+'</nav></div><div class="settings-panel"><a class="settings-back" href="'+esc(pathFor(returnToWorkspace))+'"><span aria-hidden="true">‹</span> Back to workspace</a><button class="btn drawer-switch" type="button" data-action="switch-drawer" aria-pressed="false">Workspace menu</button><input class="settings-search" type="search" aria-label="Search settings" placeholder="Search settings" autocomplete="off"><nav class="side-nav settings-links" aria-label="Settings">'+settingsNav+'<p id="settings-empty" hidden>No matching settings</p></nav><nav class="side-nav drawer-workspace" aria-label="Workspace">'+nav+'</nav>'+sidebarBottom+'</div></aside>':
    '<aside class="sidebar" id="workspace-sidebar"><div class="sidebar-head">'+brand('/')+search+'</div><nav class="side-nav" aria-label="Workspace">'+nav+'</nav>'+sidebarBottom+'</aside>';
  const header='<header class="topbar"><div class="mobile-brand">'+brand('/')+'</div><div class="breadcrumb">Workspace <span>›</span> <strong>'+esc(activeName)+'</strong></div><strong class="mobile-page-name">'+esc(activeName)+'</strong>'+headerActions+'</header>';
  const quickLinks=['home','orders','products'].map(id=>{
    const item=workspaceMenu.find(item=>item.id===id);
    const current=id===active||item.children?.some(([child])=>child===active);
    return '<a href="'+pathFor(id)+'"'+(current?' aria-current="'+(id===active?'page':'true')+'"':'')+'>'+icon(item.icon)+'<span>'+item.name+'</span></a>';
  }).join('');
  const mobileNav='<nav class="mobile-quick-nav" aria-label="Quick navigation">'+quickLinks+
    '<button type="button" data-action="global-search">'+icon('search')+'<span>Search</span></button>'+
    '<button type="button" data-action="toggle-nav" aria-controls="workspace-sidebar" aria-expanded="'+navOpen+'">'+icon('menu')+'<span>Menu</span></button></nav>';
  const previousArea=$('.work-area');
  const route=location.hash||'#/home';
  const scrollTop=previousArea?.dataset.route===route?previousArea.scrollTop:0;
  $('#app').innerHTML='<div class="shell'+(navOpen?' nav-open':'')+(inSettings?' settings-mode':'')+(settingsRoutes.has(active)?' settings-direct':'')+'" data-theme="'+esc(accountTheme)+'"><div class="work-layout">'+sidebar+'<div class="work-area" data-route="'+esc(route)+'">'+header+'<main id="main" class="work" tabindex="-1">'+html+'</main></div></div><button type="button" class="mobile-nav-backdrop" data-action="close-nav" aria-label="Close navigation"></button>'+mobileNav+'</div>';
  $('.work-area').scrollTop=scrollTop;
  if(active==='builder')bindThemePreview();
  if(inSettings){
    $('.settings-links [aria-current]')?.scrollIntoView({block:'nearest',inline:'nearest'});
    $('.settings-search').addEventListener('input',event=>{
      const query=event.target.value.trim().toLowerCase();
      let count=0;
      document.querySelectorAll('[data-settings-group]').forEach(group=>{
        const links=[...group.querySelectorAll('a')];
        links.forEach(link=>{link.hidden=!link.textContent.toLowerCase().includes(query);});
        group.hidden=links.every(link=>link.hidden);
        count+=links.filter(link=>!link.hidden).length;
      });
      $('#settings-empty').hidden=count>0;
    });
  }
}
function preview(id){
  const template=templates.find(t=>t.id===id);if(!template)return;
  dialog(template.name+' website preview','<div class="actions" style="margin-bottom:10px">'+badge(money(template.price)+' illustrative')+'<a class="btn" target="_blank" rel="noopener" href="'+template.path+'">Open full preview</a></div><iframe class="template-preview" title="'+template.name+' preview" src="'+template.path+'" sandbox="allow-scripts allow-same-origin allow-forms"></iframe>',{wide:true});
}
function setNavOpen(open,focus=false){
  navOpen=open;
  $('.shell').classList.toggle('nav-open',open);
  const trigger=$('[data-action=toggle-nav]');
  trigger.setAttribute('aria-expanded',String(open));
  if(focus)(open?$('.settings-back')||$('.sidebar .side-search'):trigger)?.focus();
}
function search(){
  if(navOpen)setNavOpen(false);
  const results=[...allItems.map(([id,name])=>({name,link:pathFor(id),type:'Workspace'})),...state.products.map(p=>({name:p.name,link:pathFor('products/'+encodeURIComponent(p.id)),type:'Product'})),...state.orders.map(o=>({name:'#'+o.id+' · '+o.customer,link:pathFor('orders/'+encodeURIComponent(o.id)),type:'Order'}))];
  dialog('Search workspace','<label>Search<input id="global-query" type="search" autocomplete="off"></label><div id="search-results" class="stack" style="margin-top:10px"></div>');
  const fill=()=>{const q=$('#global-query').value.toLowerCase().trim();$('#search-results').innerHTML=results.filter(r=>r.name.toLowerCase().includes(q)).slice(0,10).map(r=>'<a class="btn" data-search-target href="'+esc(r.link)+'">'+esc(r.name)+' · '+r.type+'</a>').join('')||'<p>No matching results.</p>';};
  $('#global-query').addEventListener('input',fill);fill();$('#global-query').focus();
}
document.addEventListener('click',event=>{
  const contactChoice=event.target.closest('[data-contact-choice]');
  if(contactChoice&&event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey){
    event.preventDefault();
    if(contactChoice.hasAttribute('aria-current'))return;
    history.pushState(null,'',contactChoice.href);
    rerender();
    const heading=$('.contact-hub h2');
    heading?.setAttribute('tabindex','-1');
    heading?.focus({preventScroll:true});
    if(matchMedia('(max-width:959px)').matches)heading?.scrollIntoView({block:'center'});
    return;
  }
  if(event.target.closest('[data-search-target]'))close();
  if(navOpen&&event.target.closest('.sidebar a[href], .mobile-quick-nav a[href]'))setNavOpen(false);
  const target=event.target.closest('[data-action]');if(!target)return;
  const [action,key,detail]=target.dataset.action.split(':');
  if(action==='close-dialog'){
    if($('#dialog').open)return close();
    target.closest('form')?.reset();return;
  }
  if(action==='global-search')return search();
  if(action==='account-theme'){const dark=localStorage.getItem('auzslab.preview.theme')==='dark';localStorage.setItem('auzslab.preview.theme',dark?'light':'dark');return rerender();}
  if(action==='toggle-nav'||action==='close-nav'){setNavOpen(action==='toggle-nav'&&!navOpen,true);return;}
  if(action==='switch-drawer'){
    const workspaceMenu=$('.settings-panel').classList.toggle('show-workspace');
    target.setAttribute('aria-pressed',String(workspaceMenu));
    target.textContent=workspaceMenu?'Settings menu':'Workspace menu';
    return;
  }
  if(action==='preview')return preview(key);
  if(action==='template-filter'){templateFilter=key;rerender();$('.pills [aria-pressed=true]')?.focus({preventScroll:true});return;}
  if(action==='career-jump'){const section=$('#career-opportunities');section.scrollIntoView({block:'start'});section.querySelector('[aria-pressed=true]').focus({preventScroll:true});return;}
  if(action==='career-next'||action==='career-back'){
    const form=target.form, step=Number(form.dataset.step||0);
    if(action==='career-back')careerStep(form,step-1);
    else if(validateCareerStep(form,step))careerStep(form,step+1);
    return;
  }
  if(action==='role'){
    const form=$('[data-form="application"]');const previous=form?new FormData(form):null;
    selectedRole=key;
    const route=new URL(location.href);
    route.searchParams.set('role',key);
    window.history.replaceState(null,'',route);
    rerender();
    if(previous)for(const name of ['name','email','phone','city'])$('[data-form="application"]').elements[name].value=previous.get(name)||'';
    $('#career-application h2').focus({preventScroll:true});$('#career-application').scrollIntoView({block:'nearest'});
    return;
  }
  if(action==='review'){const entry=state.applications.find(a=>a.id===key);if(entry){entry.status=detail;save('Application '+detail.toLowerCase()+'.');rerender();}return;}
  if(action==='contributor-signout'){sessionStorage.removeItem(contributorKey);return rerender();}
  handlePage?.('click',target,event);
});
document.addEventListener('submit',async event=>{
  const form=event.target;if(!form.dataset.form)return;
  event.preventDefault();
  if(form.dataset.form==='contact-enquiry')return saveContactEnquiry(form);
  if(form.dataset.form==='contributor'){
    const email=String(new FormData(form).get('email')).trim();
    if(!state.applications.some(a=>a.email.toLowerCase()===email.toLowerCase())){form.querySelector('output').textContent='No sample applications found for this email.';return;}
    sessionStorage.setItem(contributorKey,email);
    return rerender();
  }
  if(form.dataset.form==='application'){
    const step=Number(form.dataset.step||0);
    if(step<2){if(validateCareerStep(form,step))careerStep(form,step+1);return;}
    if(!validateCareerStep(form,0)||!validateCareerStep(form,1))return;
    const data=Object.fromEntries(new FormData(form));
    const output=form.querySelector('output');
    if(data.resume?.size){
      const header=await data.resume.slice(0,5).text();
      if(data.resume.size>5*1024*1024||header!=='%PDF-'){careerStep(form,1,false);output.textContent='Choose a PDF no larger than 5 MB.';return;}
    }
    if(data.portfolio&&!localUrl(data.portfolio)){careerStep(form,1,false);output.textContent='Enter a website URL beginning with https://.';return;}
    state.applications.unshift({...data,id:uid(),role:selectedRole,resume:data.resume?.name||'',status:'Pending review',submitted:now()});
    sessionStorage.setItem(contributorKey,data.email);
    save('Application added to the local review queue.');form.reset();careerStep(form,0,false);output.innerHTML='Application received for local review. <a class="rowlink" href="/contributor.html">Track your application</a>';return;
  }
  handlePage?.('submit',form,event);
});
for(const type of ['input','change'])document.addEventListener(type,event=>handlePage?.(type,event.target,event));
document.addEventListener('keydown',event=>{
  if(location.pathname!==dashboardPath)return;
  if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'){event.preventDefault();search();}
  else if(event.key==='Escape'&&navOpen)setNavOpen(false,true);
});
addEventListener('hashchange',()=>{navOpen=false;close();rerender();scrollTo(0,0);});
addEventListener('popstate',()=>{if($('[data-contact-hub]'))rerender();});
matchMedia('(max-width:900px)').addEventListener('change',event=>{if(!event.matches&&navOpen)setNavOpen(false);});
const initialRole=new URLSearchParams(location.search).get('role');if(roles.some(r=>r.id===initialRole))selectedRole=initialRole;
rerender();
