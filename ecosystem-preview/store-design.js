function editorStoreLocations(design){
  return (design.pages.stores||[]).filter(section=>section.type==='Stores directory'&&!section.hidden)
    .flatMap(section=>(section.blocks||[]).filter(block=>block.type==='Store location'&&!block.hidden&&(block.title||block.address)))
    .map(block=>({name:block.title,address:block.address,hours:block.hours,phone:block.phone,photo:themeLink(block.image),mapUrl:themeLink(block.href)}));
}
function themeLink(value){
  if(!value)return '';
  try{
    const result=new URL(value,location.href);
    return ['http:','https:'].includes(result.protocol)?result.href:'';
  }catch{return '';}
}
function applyElementSettings(root,section,page){
  root.dataset.themeSection=section.id;
  root.dataset.themePage=page;
  const nodes=[root,...root.querySelectorAll('h1,h2,h3,h4,p,a,button,img')];
  const counts=new Map();
  for(const node of nodes){
    if(node.closest('[data-theme-section]')!==root)continue;
    const tag=node===root?'section':node.tagName.toLowerCase();
    const index=(counts.get(tag)||0)+1;
    counts.set(tag,index);
    const key=tag+'.'+index,edit=section.elements?.[key];
    node.dataset.themeElement=key;
    const direct=[...node.childNodes].find(child=>child.nodeType===Node.TEXT_NODE&&child.textContent.trim());
    if(direct&&tag!=='section')node.dataset.themeText=direct.textContent.trim();
    if(tag==='a'){
      const raw=node.getAttribute('href')||'';
      const target=raw?new URL(raw,location.href):null;
      node.dataset.themeHref=target?.origin===location.origin&&target.pathname===location.pathname&&target.hash?target.hash:raw;
    }
    if(!edit)continue;
    if(edit.size>0){
      const size=Math.min(tag==='img'?1600:tag==='section'?300:120,Math.max(8,Number(edit.size)))+'px';
      if(tag==='img')Object.assign(node.style,{width:size,height:'auto',maxWidth:'100%'});
      else if(tag==='section')node.style.paddingBlock=size;
      else node.style.fontSize=size;
    }
    if(typeof edit.text==='string'&&direct)direct.textContent=edit.text;
    if(edit.href===undefined)continue;
    const href=themeLink(edit.href);
    if(tag==='a'&&href)node.href=href;
    else if(href&&tag!=='section'){
      if(tag==='button'||node.closest('a,button')){
        const control=node.closest('a,button');
        if(control.tagName==='A')control.href=href;
        else control.addEventListener('click',event=>{event.stopImmediatePropagation();location.assign(href);},true);
      }else{
        const anchor=document.createElement('a');
        anchor.href=href;
        node.replaceWith(anchor);
        anchor.append(node);
      }
    }
  }
  return root;
}
function createStoreInspector(){
  let enabled=false,hovered=null;
  const targetFor=target=>target.closest?.('[data-theme-element]');
  document.addEventListener('pointerover',event=>{
    if(!enabled)return;
    const target=targetFor(event.target);
    if(hovered===target)return;
    hovered?.classList.remove('theme-inspector-hover');
    hovered=target;
    hovered?.classList.add('theme-inspector-hover');
  });
  document.addEventListener('click',event=>{
    if(!enabled)return;
    const target=targetFor(event.target);
    const root=target?.closest('[data-theme-section]');
    if(!root)return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const key=target.dataset.themeElement;
    window.parent.postMessage({type:'auzslab-element-selected',page:root.dataset.themePage,section:root.dataset.themeSection,key,tag:key.split('.')[0],
      text:target.dataset.themeText,href:target.dataset.themeHref,size:key.startsWith('img.')?target.offsetWidth:parseFloat(getComputedStyle(target).fontSize)},location.origin);
  },true);
  return (info)=>{
    enabled=!!info.inspect;
    document.body.classList.toggle('theme-inspecting',enabled);
    hovered?.classList.remove('theme-inspector-hover');
    hovered=null;
    document.querySelector('.theme-inspector-selected')?.classList.remove('theme-inspector-selected');
    if(!enabled||!info.element)return;
    const root=[...document.querySelectorAll('[data-theme-section]')].find(section=>section.dataset.themeSection===info.section);
    const target=root&&[root,...root.querySelectorAll('[data-theme-element]')].find(node=>node.dataset.themeElement===info.element);
    target?.classList.add('theme-inspector-selected');
    return target;
  };
}
function updateThemeFooter(nativeFooter,design,element){
  const section=design.pages.footer?.find(entry=>entry.type==='Store footer');
  if(!section)return nativeFooter;
  nativeFooter.hidden=!!section.hidden;
  nativeFooter.dataset.themeSection=section.id;
  if(section.brand?.trim())nativeFooter.querySelector('.ftbrand .big').textContent=section.brand;
  if(section.helpLabel?.trim())nativeFooter.querySelector('.ftl').textContent=section.helpLabel;
  if(section.text?.trim()){
    const summary=nativeFooter.querySelector('.ftfold p');
    if(summary)summary.textContent=section.text;
    else nativeFooter.querySelector('.ftinfo').prepend(element('p',{},section.text));
  }
  const columns=nativeFooter.querySelector('footer .cols');
  if(!columns)return nativeFooter;
  const brand=columns.querySelector('.ftbrand');
  const groups=new Map();
  for(const block of section.blocks||[]){
    const href=themeLink(block.href);
    if(block.type!=='Footer link'||block.hidden||!href)continue;
    const name=block.group?.trim()||'Links';
    if(!groups.has(name))groups.set(name,[]);
    groups.get(name).push(element('a',{href},block.title));
  }
  columns.replaceChildren(...[...groups].map(([name,links])=>element('div',{class:'col'},element('span',{class:'lbl'},name),links)),...(brand?[brand]:[]));
  return nativeFooter;
}

function renderThemeFallback(view,route,element,url,catalog,cards){
  if(route==='search'){
    const search=new URLSearchParams(location.hash.split('?')[1]).get('q')||'';
    const input=element('input',{type:'search',name:'q',value:search,'aria-label':'Search products',placeholder:'Search products'});
    const form=element('form',{class:'theme-search-form',onsubmit:event=>{
      event.preventDefault();
      location.hash='#/search?'+new URLSearchParams({q:input.value.trim()});
    }},input,element('button',{class:'btn',type:'submit'},'Search'));
    const products=search?catalog.styles.filter(product=>[product.name,product.category].some(value=>value?.toLowerCase().includes(search.toLowerCase()))):[];
    view.append(element('section',{class:'pg wide'},element('h1',{},'Search'),form,
      search?element('p',{class:'mut'},products.length?products.length+' matching products':'No matching products.'):null,
      products.length?element('div',{class:'grid'},products.map(product=>cards(product))):null));
    return;
  }
  const examples={
    'product-example':['Product preview','Publish a product to preview its photos, options, price and purchase controls.'],
    'collection-example':['Collection preview','Publish a collection to preview its products and filters.'],
    'page-example':['Content page preview','Publish a store page to preview its title and content.'],
    'blog-example':['Article preview','Publish an article to preview its content.'],
    'password-example':['This store is private','Theme preview for a password page. Store access settings are managed separately.'],
    'gift-card-example':['Gift card','Theme preview for the gift card page. A real balance and code appear when a gift card is issued.'],
  };
  const [title,detail]=examples[route]||['Page not found','The page you requested could not be found.'];
  view.append(element('section',{class:'pg'},element('h1',{},title),element('p',{class:'mut'},detail),
    route.endsWith('-example')?null:element('a',{class:'btn',href:url('')},'Return to the store')));
}

// Render editor sections with the storefront's original product and location cards.
function renderSavedStore(view, route, store, catalog, cards, element, url, collectionId, homeStores, storeCards, footer,slug) {
  const design = store?.builder;
  if (!design?.pages) return false;
  const page = {p:'product',shop:collectionId?'collection':'search',bag:'cart',blog:slug?'article':'blog',
    'product-example':'product','collection-example':'collection','page-example':'page','blog-example':'article',
    'password-example':'password','gift-card-example':'giftcard'}[route]||route;
  const resource=page==='collection'?collectionId:page==='page'?catalog.config.minimalPages?.find(record=>record.slug===slug)?.id:slug;
  const params=new URLSearchParams(location.search);
  const previewLayout=['editor','draft'].includes(params.get('design'))?params.get('layout'):null;
  const requested=design.variants?.[previewLayout];
  const layout=previewLayout==='default'?null:requested?.page===page?requested:design.variants?.[design.assignments?.[page]?.[resource]];
  const currentSections=layout?.page===page?layout.sections:design.pages[page];
  const sectionsFor=key=>key===page?currentSections:design.pages[key];
  const replace = page==='home'||page==='stores';
  const addBefore = [];
  const phone = '(max-width: 700px)';
  const safeUrl=themeLink;
  const photo = (src, alt) => safeUrl(src) ? element('img', {src:safeUrl(src), alt:alt||'', loading:'lazy'}) : null;
  const action = (label, href) => label ? element('a', {class:'btn', href:safeUrl(href)||url('shop')}, label) : null;
  const renderBlock = block => {
    if (block.hidden) return null;
    if (block.type === 'Divider') return element('hr');
    if (block.type === 'Image') return photo(block.image, block.title);
    if (block.type === 'Button') return action(block.title,block.href);
    if (block.type === 'Heading') return element('h3', {}, block.title);
    return element('p', {}, block.text||block.title);
  };
  const section = (s,ownerPage) => {
    if (s.hidden || ['Product details','Contact form','Store footer'].includes(s.type)) return null;
    if(s.type==='Store cards'){
      const stores=editorStoreLocations(design).slice(0,s.count||3);
      if(!stores.length)return null;
      const rail=homeStores(stores);
      rail.dataset.themeSection=s.id;
      rail.querySelector('h2').textContent=s.title||'Stores across India';
      return applyElementSettings(rail,s,ownerPage);
    }
    if(s.type==='Stores directory'){
      const stores=editorStoreLocations({pages:{stores:[s]}});
      return applyElementSettings(element('section',{class:'pg wide'},element('div',{class:'shophd'},element('h1',{},s.title||'Our stores')),stores.length?storeCards(stores):element('p',{class:'card mut'},'Store details are coming soon.')),s,ownerPage);
    }
    const node=element('section',{class:'saved-section'+(s.type==='Hero'?' saved-hero ':''),'data-theme-section':s.id});
    const space=Math.min(100,Math.max(0,Number(s.spacing??10)));
    node.style.paddingInline=space+'px';
    node.style.textAlign=['left','center','right'].includes(s.align)?s.align:'left';
    const title=element('h2',{},s.title||'');
    if(s.type==='Hero'){
      const picture=element('picture',{},safeUrl(s.mobileImage)?element('source',{media:phone,srcset:safeUrl(s.mobileImage)}):null,photo(s.image,''));
      node.append(picture,element('div',{class:'saved-hero-copy'},title,s.text?element('p',{},s.text):null,action(s.cta,s.href)));
    } else if(s.type==='Product row') {
      const source=ownerPage==='collection'&&(!s.source||s.source==='all')?collectionId:s.source;
      const chosen=source==='selected'?s.selected||[]:catalog.collections.find(c=>c.id===source)?.styleIds;
      const ids=chosen||(s.source==='all'||!s.source?catalog.styles.map(p=>p.id):[]);
      const products=ids.map(id=>catalog.styles.find(p=>p.id===id)).filter(Boolean).slice(0,s.count||4);
      const grid=element('div',{class:'grid saved-grid', 'data-desktop':s.layout||'Grid','data-mobile':s.mobileLayout||'Grid'},products.map(p=>cards(p)));
      grid.style.setProperty('--saved-desktop',Math.min(8,Math.max(1,s.desktop||4)));
      grid.style.setProperty('--saved-mobile',Math.min(4,Math.max(1,s.mobile||2)));
      node.append(title,grid);
    } else if(s.type==='Collection slider'){
      const available=catalog.collections.filter(c=>s.source==='all'||!s.source||c.id===s.source).slice(0,s.count||3);
      node.append(title,element('div',{class:'saved-collections'},available.map(c=>element('a',{href:url('shop?col='+encodeURIComponent(c.id))},photo(c.imageUrl,c.name),element('span',{},c.name)))));
    } else if(s.type==='Image'){
      const img=photo(s.image,s.title); if(img)node.append(img);
    } else if(s.type==='Divider'){
      node.append(element('hr'));
    } else if(s.type==='Navigation'){
      const links={Home:'',Shop:'shop',Collections:'collections',Contact:'contact',About:'about'};
      node.append(element('nav',{class:'saved-nav','aria-label':'Store links'},(store.navigation||Object.keys(links)).map(label=>element('a',{href:url(links[label]??'page/'+encodeURIComponent(label.toLowerCase().replace(/\s+/g,'-')))},label))));
    } else {
      node.append(title);
      if(s.text)node.append(element('p',{},s.text));
    }
    node.append(...(s.blocks||[]).map(renderBlock).filter(Boolean));
    return applyElementSettings(node,s,ownerPage);
  };
  const nodesFor=key=>(sectionsFor(key)||[]).map(item=>section(item,key)).filter(Boolean);
  document.documentElement.style.setProperty('--saved-radius', Math.min(40,Math.max(0,Number(design.radius??6)))+'px');
  document.documentElement.style.setProperty('--saved-accent', /^#[\da-f]{6}$/i.test(design.accent)?design.accent:'#252525');
  const fonts = {'System sans':'system-ui, sans-serif','Editorial serif':'Georgia, serif',Monospace:'ui-monospace, monospace'};
  view.style.fontFamily=fonts[design.font]||'';
  if(page==='contact'){
    const settings=design.pages.contact?.find(section=>section.type==='Contact form');
    const native=view.querySelector('.pg');
    if(settings&&native){
      native.hidden=!!settings.hidden;
      native.dataset.themeSection=settings.id;
      if(settings.title)native.querySelector('h1').textContent=settings.title;
      if(settings.text)native.querySelector('.shophd').append(element('p',{},settings.text));
      applyElementSettings(native,settings,'contact');
    }
  }
  if(page==='product'){
    const settings=currentSections?.find(section=>section.type==='Product details');
    const native=view.querySelector('.minimal-product-details,.tabs2');
    if(settings&&native){
      native.hidden=!!settings.hidden;
      native.dataset.themeSection=settings.id;
      if(settings.title&&settings.title!=='Product information')native.prepend(element('h2',{class:'preview-detail-title'},settings.title));
      applyElementSettings(native,settings,'product');
    }
  }
  const headers=design.pages.header||[];
  const links={Home:'',Shop:'shop',Collections:'collections',Stores:'stores',Contact:'contact',About:'about'};
  const header=document.querySelector('header.top .l');
  if(header){
    const navigation=headers.find(s=>s.type==='Navigation'&&!s.hidden);
    header._originalThemeLinks??=[...header.querySelectorAll('a.deskonly')];
    header.querySelectorAll('a.deskonly').forEach(anchor=>anchor.remove());
    if(navigation&&Array.isArray(store.navigation)){
      header.prepend(...store.navigation.slice(0,3).map(label=>element('a',{class:'deskonly',href:url(links[label]??'page/'+encodeURIComponent(label.toLowerCase().replace(/\s+/g,'-')))},label)));
    }else if(navigation||!headers.some(section=>section.type==='Navigation'))header.prepend(...header._originalThemeLinks);
    if(navigation)applyElementSettings(header,navigation,'header');
  }
  addBefore.push(...headers.filter(s=>s.type!=='Navigation').map(s=>section(s,'header')).filter(Boolean),...nodesFor(page));
  const originalFooter=document.querySelector('#app > .ftwrap');
  if(originalFooter){
    const nextFooter=updateThemeFooter(footer(),design,element);
    nextFooter.prepend(...nodesFor('footer'));
    const footerSettings=design.pages.footer?.find(s=>s.type==='Store footer');
    if(footerSettings)applyElementSettings(nextFooter,footerSettings,'footer');
    if(originalFooter.classList.contains('open')&&!nextFooter.hidden)nextFooter.querySelector('.ftt')?.click();
    originalFooter.replaceWith(nextFooter);
  }
  view.classList.add('store-saved-design');
  document.body.classList.add('saved-store');
  view.prepend(...addBefore);
  return replace;
}
