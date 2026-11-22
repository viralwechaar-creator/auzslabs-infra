import {collectionVisible} from './data.js';
import {$, badge, button, close, dialog, esc, flash, link, pathFor, rerender, save, state, uid} from './ecosystem.js';
import {publishDialog,savedVersions,starterDesign,themeLibrary,themeLibraryDispatch,updateThemeDraft} from './theme-library.js';

const pages={home:'Home page',product:'Product page',collection:'Collection page',collections:'Collection index',page:'Content page',stores:'Stores page',about:'About page',contact:'Contact page',cart:'Cart',search:'Search',blog:'Blog',article:'Blog post',password:'Password preview',giftcard:'Gift card preview',notfound:'404 page',header:'Header',footer:'Footer'};
const types=['Hero','Product row','Collection slider','Product details','Text','Image','Newsletter','Announcement','Navigation','FAQ','Testimonials','Contact form','Divider'];
const blockTypes=['Heading','Text','Button','Image','Divider'];
let draft;
let draftId;
let alternate='';
let page='home';
let selected='hero';
let device='desktop';
let selectedBlock='';
let previewItem='';
let undoStack=[];
let future=[];
let previewTimer;
let autosaveTimer;
let previewResize;
let inspectMode=false;
let pickedElement=null;
let overviewMode=false;
const entry=()=>themeLibrary().entries[draftId];
const getDraft=()=>draft ||= structuredClone(entry()?.design||state.builder);
const variantFor=(design,name)=>design.variants?.[name]?.page===page?design.variants[name]:null;
const pageSections=(design,pageKey=page)=>pageKey===page?(variantFor(design,alternate)?.sections||design.pages[pageKey]):design.pages[pageKey];
const sections=()=>pageSections(getDraft()) || [];
const active=()=>sections().find(s=>s.id===selected);
const appendSection=section=>{
  const design=getDraft();
  (variantFor(design,alternate)?.sections||(design.pages[page]||=[])).push(section);
};
const F=(label,name,value='',type='text',props='')=>'<label>'+label+'<input name="'+name+'" type="'+type+'" value="'+esc(value)+'" '+props+'></label>';
const S=(label,name,values,value)=>'<label>'+label+'<select name="'+name+'">'+values.map(option=>{const [k,v]=Array.isArray(option)?option:[option,option];return '<option value="'+esc(k)+'"'+(String(k)===String(value)?' selected':'')+'>'+esc(v)+'</option>';}).join('')+'</select></label>';
const T=(label,name,value)=>'<label>'+label+'<textarea name="'+name+'">'+esc(value)+'</textarea></label>';
const form=(key,inside,label)=>'<form class="preview-controls" data-form="'+key+'">'+inside+'<button type="submit" class="btn primary">'+label+'</button></form>';
const panel=(title,inside,kind='')=>'<section class="panel '+kind+'"><div class="panel-title"><h2>'+title+'</h2></div><div class="panel-body">'+inside+'</div></section>';
const previewUrl=(config=state.builder,mode='saved',templatePage=page)=>{
  const resources=resourcesFor(templatePage);
  const item=(templatePage===page&&resources.find(record=>record.id===previewItem))||resources[0];
  const path={product:item?'p/'+encodeURIComponent(item.id):'product-example',collection:item?'shop?col='+encodeURIComponent(item.id):'collection-example',page:item?'page/'+encodeURIComponent(item.slug):'page-example',cart:'bag',search:'search',blog:'blog',article:'blog-example',password:'password-example',giftcard:'gift-card-example',notfound:'notfound'};
  const view=path[templatePage]??(['about','contact','stores','collections'].includes(templatePage)?templatePage:'');
  const params=new URLSearchParams({template:config.theme});
  if(mode==='live'||mode==='draft'){
    params.set('design',mode==='live'?'editor':'draft');
    params.set('draft',draftId);
    params.set('layout',templatePage===page&&alternate?alternate:'default');
  }else if(mode==='saved')params.set('design','saved');
  return '/store.html?'+params+'#/'+view;
};
function resourcesFor(key){
  if(key==='product')return state.products.filter(p=>p.status==='Active'&&(!p.channels||p.channels.includes('Online store')));
  if(key==='collection')return state.collections.filter(collectionVisible);
  if(key==='page')return state.pages.filter(p=>p.status==='Visible');
  return [];
}
function setSectionFields(target,section){
  const values=new FormData(target);
  const fields=Object.fromEntries(values);
  const picked=values.getAll('selected');
  const skuOrder=String(fields.order||'').split(',').map(x=>x.trim().toLowerCase());
  fields.selected=[...new Set([...skuOrder.map(s=>state.products.find(p=>p.sku?.toLowerCase()===s)?.id).filter(id=>picked.includes(id)),...picked])];
  delete fields.order;
  for(const key of ['count','desktop','mobile','spacing'])if(fields[key]!==undefined)fields[key]=Number(fields[key]);
  Object.assign(section,fields);
}
function refreshCanvas(){
  updatePreview();
  const indicator=$('.editor-heading .chip:nth-of-type(2)');
  if(indicator){
    const dirty=JSON.stringify(getDraft())!==JSON.stringify(entry()?.design);
    indicator.textContent=dirty?'Unsaved changes':'Saved design';
    indicator.classList.toggle('warn',dirty);
  }
}
function saveDraft(){
  clearTimeout(autosaveTimer);
  if(!entry()||!updateThemeDraft(entry(),getDraft()))return;
  draft=structuredClone(entry().design);
  save();
  refreshCanvas();
}
function scheduleSave(){
  clearTimeout(autosaveTimer);
  autosaveTimer=setTimeout(saveDraft,850);
}
function readInspector(form,design){
  const section=pageSections(design)?.find(s=>s.id===selected);
  if(form.dataset.form==='section-fields'&&section)setSectionFields(form,section);
  else if(form.dataset.form==='block-fields'){
    const block=section?.blocks?.find(b=>b.id===selectedBlock);
    if(block)Object.assign(block,Object.fromEntries(new FormData(form)));
  }else if(form.dataset.form==='element-fields'&&section&&pickedElement){
    const values=new FormData(form);
    const item={};
    if(values.has('elementText')&&values.get('elementText')!==pickedElement.text)item.text=String(values.get('elementText'));
    if(values.get('elementHref')&&values.get('elementHref')!==(pickedElement.href||''))item.href=String(values.get('elementHref'));
    if(values.has('elementSize')&&values.get('elementSize'))item.size=Number(values.get('elementSize'));
    if(Object.keys(item).length)(section.elements||={})[pickedElement.key]=item;
    else if(section.elements)delete section.elements[pickedElement.key];
  }else if(form.dataset.form==='theme-fields'){
    const fields=new FormData(form);
    Object.assign(design,{accent:fields.get('accent'),radius:Number(fields.get('radius')),font:fields.get('font')});
  }
}
function commitInspector(forms=document.querySelectorAll('.inspector form')){
  const design=getDraft(),previous=structuredClone(design);
  for(const form of forms)if(form.checkValidity())readInspector(form,design);
  if(JSON.stringify(previous)===JSON.stringify(design))return;
  undoStack.push(previous);
  if(undoStack.length>30)undoStack.shift();
  future=[];
  scheduleSave();
}
function updatePreview(frame){
  const design=structuredClone(getDraft());
  document.querySelectorAll('.inspector form').forEach(form=>{if(form.checkValidity())readInspector(form,design);});
  for(const target of frame?[frame]:document.querySelectorAll('iframe[data-theme-preview]')){
    target.contentWindow?.postMessage({type:'auzslab-editor-design',design,section:selected,previewPage:page,inspect:inspectMode,element:pickedElement?.key},location.origin);
  }
}
window.addEventListener('message',event=>{
  if(event.origin!==location.origin||!inspectMode||event.data?.type!=='auzslab-element-selected')return;
  if(![...document.querySelectorAll('iframe[data-theme-preview]')].some(frame=>frame.contentWindow===event.source))return;
  const info=event.data;
  if(!Object.hasOwn(pages,info.page)||typeof info.key!=='string'||!/^(section|h[1-4]|p|a|button|img)\.\d{1,4}$/.test(info.key))return;
  const section=pageSections(getDraft(),info.page)?.find(s=>s.id===info.section);
  if(!section)return;
  commitInspector();
  if(page!==info.page){alternate='';page=info.page;}
  selected=section.id;selectedBlock='';
  pickedElement=info;
  close();
  rerender();
});
export function bindThemePreview(){
  previewResize?.disconnect();
  previewResize=new ResizeObserver(entries=>entries.forEach(({target})=>{
    const width=target.classList.contains('tablet')?768:target.classList.contains('mobile')?390:1280;
    target.style.setProperty('--preview-scale',Math.min(1,target.clientWidth/width));
  }));
  document.querySelectorAll('.editor-preview-viewport:is(.desktop,.tablet), .template-canvas-image').forEach(viewport=>previewResize.observe(viewport));
  document.querySelectorAll('iframe[data-theme-preview]').forEach(frame=>{
    if(frame.dataset.previewBound)return;
    frame.dataset.previewBound='true';
    frame.addEventListener('load',()=>updatePreview(frame));
    updatePreview(frame);
  });
}
const previewFrame=(config,dialog=false,live=true)=>'<div class="editor-preview-viewport '+device+(dialog?' expanded':'')+'"><iframe class="editor-store-frame" '+(live?'data-theme-preview ':'')+'src="'+esc(previewUrl(config,live?'live':'saved'))+'" title="'+(live?'Live storefront preview':'Saved storefront preview')+'"></iframe></div>';
function templateCanvas(config){
  return '<section class="panel"><div class="panel-title"><div><h2>Template canvas</h2><p>Saved storefront previews. Open a template to edit it live.</p></div></div><div class="template-canvas">'+Object.entries(pages).map(([key,label])=>{
    const shared=key==='header'||key==='footer';
    return '<article class="template-canvas-card">'+(shared?'<div class="template-canvas-shared">Shared storefront section</div>':
      '<div class="template-canvas-image '+device+'" aria-hidden="true"><iframe loading="lazy" tabindex="-1" title="'+esc(label)+' saved preview" src="'+esc(previewUrl(config,'draft',key))+'"></iframe></div>')+
      button('Edit '+esc(label),'builder-open-template:'+key,'compact')+'</article>';
  }).join('')+'</div></section>';
}
function mutate(update){
  undoStack.push(structuredClone(getDraft()));
  if(undoStack.length>30) undoStack.shift();
  future=[];
  update();
  scheduleSave();
  rerender();
}
export function savedDesign(){
  const query=new URLSearchParams(location.search);
  const selectedPage=query.get('page');
  page=Object.hasOwn(pages,selectedPage)?selectedPage:'home';
  device=['mobile','tablet'].includes(query.get('device'))?query.get('device'):'desktop';
  return '<div class="wrap public-title"><h1>'+pages[page]+'</h1><p>Saved '+esc(state.builder.theme)+' design for '+esc(state.business.name)+'.</p></div><section class="wrap"><nav class="tabs" aria-label="Website pages">'+Object.entries(pages).map(([id,label])=>'<a href="/design-preview.html?page='+id+'&device='+device+'"'+(id===page?' aria-current="page"':'')+'>'+label+'</a>').join('')+'</nav>'+previewFrame(state.builder,true,false)+'</section>';
}
function sectionFields(s){
  if(!s)return '<p>Choose a section on the left or add one to this template.</p>';
  let controls=F('Section title','title',s.title,'text','required maxlength="100"');
  if(['Hero','Image'].includes(s.type))controls+=F('Image URL','image',s.image);
  if(s.type==='Hero')controls+=F('Mobile image URL','mobileImage',s.mobileImage)+T('Caption','text',s.text)+F('Call to action label','cta',s.cta)+F('Call to action link','href',s.href);
  if(['Text','Newsletter','FAQ','Testimonials','Announcement','Contact form'].includes(s.type))controls+=T('Body','text',s.text);
  if(s.type==='Product row'){
    const choices=[['all','All active products'],['selected','Choose individual products'],...state.collections.map(c=>[c.id,c.name])];
    controls+=S('Product source','source',choices,s.source||'all')+
      '<fieldset id="manual-products" '+(s.source==='selected'?'':'hidden')+'><legend>Products to show</legend><div class="stack">'+state.products.map(p=>'<label class="inline"><input type="checkbox" name="selected" value="'+esc(p.id)+'"'+(s.selected?.includes(p.id)?' checked':'')+'>'+esc(p.name)+'</label>').join('')+'</div><p class="help-text">Cards use the order shown here. You can set a different order below.</p>'+
      F('Product order by SKU','order',(s.selected||[]).map(id=>state.products.find(p=>p.id===id)?.sku).filter(Boolean).join(', '),'text','placeholder="SKU1, SKU2"')+'</fieldset>'+
      F('Maximum cards','count',s.count||4,'number','min="1" max="30" required')+F('Desktop cards across','desktop',s.desktop||4,'number','min="1" max="8" required')+
      F('Mobile cards across','mobile',s.mobile||2,'number','min="1" max="4" required')+S('Desktop layout','layout',['Grid','Carousel'],s.layout)+S('Mobile layout','mobileLayout',['Grid','Carousel'],s.mobileLayout);
  }
  if(s.type==='Collection slider'){
    controls+=S('Collections','source',[['all','All collections'],...state.collections.map(c=>[c.id,c.name])],s.source||'all')+F('Maximum collections','count',s.count||3,'number','min="1" max="20" required');
  }
  if(s.type==='Store cards'){
    controls+=F('Maximum store cards','count',s.count||3,'number','min="1" max="20" required')+button('Edit store locations','builder-stores');
  }
  if(s.type==='Store footer'){
    controls+=F('Footer brand text','brand',s.brand)+F('Help panel label','helpLabel',s.helpLabel)+T('Store summary','text',s.text);
  }
  const index=sections().findIndex(item=>item.id===s.id),block=s.blocks?.find(b=>b.id===selectedBlock);
  const blocks='<div class="section-list" style="margin-top:8px">'+(s.blocks||[]).map(b=>'<button type="button" class="btn compact" data-action="block-select:'+b.id+'" aria-pressed="'+(b.id===selectedBlock)+'">'+esc(b.title)+(b.hidden?badge('Hidden','neutral'):'')+'</button>').join('')+button('Add block','block-add','compact')+'</div>';
  const blockFields=block?.type==='Store location'?F('Store photo URL','image',block.image)+T('Address','address',block.address)+F('Opening hours','hours',block.hours)+F('Phone','phone',block.phone,'tel')+F('Directions URL','href',block.href):
    block?.type==='Footer link'?F('Column heading','group',block.group)+F('Link URL','href',block.href):block?.type==='Image'?F('Image URL','image',block.image):block?.type==='Text'?T('Text','text',block.text):block?.type==='Button'?F('Destination','href',block.href):'';
  const blockSettings=block?form('block-fields',F(block.type==='Store location'?'Store name':block.type==='Footer link'?'Link label':'Block title','title',block.title)+blockFields,'Apply block settings')+
    '<div class="actions" style="margin-block:10px">'+button('Move up','block-up','compact')+button('Move down','block-down','compact')+button(block.hidden?'Show block':'Hide block','block-hide','compact')+button('Remove block','block-remove','compact')+'</div>':'';
  if(!['Store footer','Store cards','Stores directory'].includes(s.type))controls+=S('Alignment','align',[['left','Start'],['center','Centre'],['right','End']],s.align||'left')+F('Section spacing','spacing',s.spacing??10,'number','min="0" max="100"');
  return '<h3 style="margin-bottom:10px">'+esc(s.type)+'</h3>'+form('section-fields',controls,'Apply settings')+
    '<div class="actions" style="margin-top:12px">'+(index>0?button('Move up','builder-up'):'')+(index<sections().length-1?button('Move down','builder-down'):'')+
    button('Duplicate','builder-copy')+button(s.hidden?'Show':'Hide','builder-hide')+button('Remove','builder-remove')+'</div><details style="margin-top:14px"'+(block?' open':'')+'><summary>Blocks</summary>'+blocks+'<div style="margin-top:12px">'+blockSettings+'</div></details>';
}
function elementFields(){
  if(!pickedElement||pickedElement.section!==selected)return '';
  const {key,tag,text,href,size}=pickedElement,settings=active()?.elements?.[key]||{};
  const names={section:'Section',img:'Image',a:'Link',button:'Button',p:'Text'};
  const destinations=[['#/','Home page'],['#/shop','Shop'],['#/collections','Collections'],['#/stores','Stores'],['#/about','About'],['#/contact','Contact'],['#/bag','Bag'],['#/me','Account'],['#/shop','Search products'],
    ...state.pages.filter(p=>p.status==='Visible').map(p=>['#/page/'+encodeURIComponent(p.slug),p.name]),
    ...(getDraft().pages.home||[]).filter(s=>!s.hidden).map(s=>['#/?section='+encodeURIComponent(s.id),'Home · '+s.title]),
    ...(getDraft().pages.footer||[]).filter(s=>!s.hidden).map(s=>['#/?section='+encodeURIComponent(s.id),'Footer · '+s.title])];
  const controls=(typeof text==='string'?T('Element text','elementText',settings.text??text):'')+
    F(tag==='section'?'Vertical padding (px)':tag==='img'?'Image width (px)':'Text size (px)','elementSize',settings.size??'','number','min="8" max="'+(tag==='img'?1600:tag==='section'?300:120)+'" placeholder="'+esc(Math.round(size||0))+'"')+
    (tag==='section'?'':'<label>Link destination<input name="elementHref" list="theme-link-targets" placeholder="#/stores or https://" value="'+esc(settings.href??href??'')+'"></label><datalist id="theme-link-targets">'+destinations.map(([value,label])=>'<option value="'+esc(value)+'">'+esc(label)+'</option>').join('')+'</datalist>');
  return '<div class="element-inspector"><h3>'+esc(names[tag]||'Heading')+'</h3>'+form('element-fields',controls,'Apply element settings')+button('Reset element','builder-reset-element','compact')+'</div>';
}
export function editTheme(){
  const template=new URLSearchParams(location.hash.split('?')[1]).get('theme'),library=themeLibrary();
  const next=Object.hasOwn(library.entries,template)?template:library.published;
  if(draftId!==next){
    if(draftId)saveDraft();
    draftId=next;
    draft=structuredClone(entry().design);
    undoStack=[];future=[];
    page='home';alternate='';previewItem='';selectedBlock='';pickedElement=null;
    overviewMode=!!template;
  }
  const config=getDraft();
  if(!active())selected=sections()[0]?.id||'';
  const dirty=JSON.stringify(config)!==JSON.stringify(entry().design);
  const header='<div class="page-head editor-heading"><div><a class="trail" href="'+pathFor('templates')+'">Theme library</a><h1>'+esc(entry().name)+'</h1></div><div class="actions">'+badge(library.published===draftId?'Published theme · editing draft':'Private draft')+badge(dirty?'Unsaved changes':'Saved design',dirty?'warn':'')+button('Undo','builder-undo','compact')+button('Redo','builder-redo','compact')+button('Version history','builder-history')+button('Expand live preview','builder-preview')+button('Save design','builder-save')+button('Review &amp; publish','builder-publish','primary')+'</div></div>';
  const resources=resourcesFor(page);
  const variants=Object.entries(config.variants||{}).filter(([,layout])=>layout.page===page);
  const alternateControls=['product','collection','page'].includes(page)?S('Layout','builder-layout',[['','Default'],...variants.map(([id,item])=>[id,item.name])],alternate)+button('Add template','builder-add-layout')+(alternate?button('Assign layout','builder-assign-layout'):''):'';
  const controls='<div class="actions editor-controls">'+button(overviewMode?'Back to editor':'Template canvas','builder-canvas')+S('Page template','builder-page',Object.entries(pages),page)+S('Device','builder-device',[['desktop','Desktop'],['tablet','Tablet'],['mobile','Mobile']],device)+(resources.length?S('Preview '+page,'builder-resource',resources.map(item=>[item.id,item.name]),previewItem):'')+(!overviewMode?alternateControls+'<button type="button" class="btn" data-action="builder-inspect" aria-pressed="'+inspectMode+'">Select on page</button>':'')+link('Open saved draft',previewUrl(config,'draft'))+'</div>';
  const tree='<div class="section-list">'+sections().map(s=>'<button class="btn compact" type="button" data-action="builder-select:'+esc(s.id)+'" aria-pressed="'+(s.id===selected)+'"><span>'+esc(s.title)+'</span>'+ (s.hidden?badge('Hidden','neutral'):'')+'</button>').join('')+button('Add section','builder-add','primary')+'</div><div class="section-list editor-quick-links">'+button('Stores page','builder-stores','compact')+button('Footer','builder-footer','compact')+'</div>';
  const theme=form('theme-fields',F('Accent colour','accent',config.accent,'color')+F('Card corner radius','radius',config.radius??6,'number','min="0" max="40"')+S('Storefront typography','font',['Theme default','System sans','Editorial serif','Monospace'],config.font||'Theme default'),'Apply theme settings');
  return {html:header+controls+(overviewMode?templateCanvas(config):'<div class="builder">'+panel('Sections',tree)+previewFrame(config)+panel('Section settings',elementFields()+sectionFields(active())+'<details style="margin-top:14px"><summary>Global theme settings</summary>'+theme+'</details>','inspector')+'</div>'),dispatch};
}
function dispatch(type,target){
  if(themeLibraryDispatch(type,target))return;
  if(type==='input'&&target.closest('.inspector form')){
    const editorForm=target.closest('form');
    clearTimeout(previewTimer);
    previewTimer=setTimeout(()=>{
      if(!editorForm.isConnected)return;
      commitInspector([editorForm]);
      refreshCanvas();
    },140);
    return;
  }
  if(type==='change'){
    if(['builder-page','builder-resource','builder-device','builder-layout'].includes(target.name))commitInspector();
    if(target.name==='builder-page'){page=target.value;alternate='';overviewMode=false;previewItem='';selectedBlock='';pickedElement=null;selected=sections()[0]?.id||'';return rerender();}
    if(target.name==='builder-layout'){alternate=target.value;selectedBlock='';pickedElement=null;selected=sections()[0]?.id||'';return rerender();}
    if(target.name==='builder-resource'){previewItem=target.value;return rerender();}
    if(target.name==='builder-device'){device=target.value;return rerender();}
    if(target.name==='source'&&$('#manual-products'))$('#manual-products').hidden=target.value!=='selected';
    const changedForm=target.closest('form');
    if(changedForm?.matches('.inspector form')&&changedForm.checkValidity()){
      commitInspector([changedForm]);
      refreshCanvas();
    }
    return;
  }
  if(type==='submit'){
    const values=new FormData(target);const fields=Object.fromEntries(values);
    if(target.dataset.form==='add-theme-layout'&&['product','collection','page'].includes(page)){
      const name=fields.name.trim(),config=getDraft();
      if(!name||Object.values(config.variants||{}).some(item=>item.page===page&&item.name.toLowerCase()===name.toLowerCase())){
        target.querySelector('output').textContent='Enter a unique template name.';return;
      }
      close();
      return mutate(()=>{
        const copy=structuredClone(fields.source==='current'?sections():(config.pages[page]||[]));
        alternate=uid();
        (config.variants||={})[alternate]={page,name,sections:copy};
        pickedElement=null;selectedBlock='';selected=copy[0]?.id||'';
      });
    }
    if(target.dataset.form==='assign-theme-layout'&&variantFor(getDraft(),alternate)){
      const resources=resourcesFor(page),ids=new Set(values.getAll('resource'));
      close();
      return mutate(()=>{
        const assignments=((getDraft().assignments||={})[page]||={});
        for(const resource of resources){
          if(ids.has(resource.id))assignments[resource.id]=alternate;
          else if(assignments[resource.id]===alternate)delete assignments[resource.id];
        }
      });
    }
    if(target.dataset.form==='theme-fields')return mutate(()=>Object.assign(getDraft(),{accent:fields.accent,radius:+fields.radius,font:fields.font}));
    if(target.dataset.form==='element-fields')return mutate(()=>readInspector(target,getDraft()));
    if(target.dataset.form==='block-fields'&&active())return mutate(()=>{const block=active().blocks?.find(b=>b.id===selectedBlock);if(block)Object.assign(block,fields);});
    if(target.dataset.form==='add-block'&&active()){
      close();
      return mutate(()=>{selectedBlock=uid();(active().blocks||=[]).push({id:selectedBlock,type:fields.type,title:fields.type,hidden:false});});
    }
    if(target.dataset.form==='section-fields'&&active()){
      return mutate(()=>setSectionFields(target,active()));
    }
    if(target.dataset.form==='add-section'){
      close();
      return mutate(()=>{selected=uid();appendSection({id:selected,type:fields.type,title:fields.type,source:'all',count:4,desktop:4,mobile:2,layout:'Grid',mobileLayout:'Carousel',hidden:false});});
    }
    return;
  }
  if(type!=='click')return;
  const [action,key]=target.dataset.action.split(':');
  if(action==='builder-canvas'){
    commitInspector();
    overviewMode=!overviewMode;
    return rerender();
  }
  if(action==='builder-open-template'&&Object.hasOwn(pages,key)){
    page=key;alternate='';
    overviewMode=false;
    previewItem='';selectedBlock='';pickedElement=null;selected=sections()[0]?.id||'';
    return rerender();
  }
  if(action==='builder-inspect'){
    inspectMode=!inspectMode;
    target.setAttribute('aria-pressed',String(inspectMode));
    updatePreview();
    return;
  }
  if(action==='builder-reset-element'&&active()?.elements&&pickedElement)return mutate(()=>delete active().elements[pickedElement.key]);
  if(['builder-select','builder-stores','builder-footer','block-select','builder-add','block-add','builder-preview','builder-up','builder-down','builder-copy','builder-hide','builder-remove','block-up','block-down','block-hide','block-remove','builder-undo'].includes(action))commitInspector();
  if(action==='builder-add-layout'){
    commitInspector();
    return dialog('Add '+pages[page].toLowerCase()+' template',form('add-theme-layout',F('Template name','name','','text','required maxlength="70"')+
      S('Duplicate from','source',alternate?[['default','Default layout'],['current','Current layout']]:[['default','Default layout']],'default')+
      '<output role="status"></output>','Create template'));
  }
  if(action==='builder-assign-layout'){
    commitInspector();
    const resources=resourcesFor(page),assignments=getDraft().assignments?.[page]||{};
    const fields=resources.map(resource=>'<label class="inline"><input type="checkbox" name="resource" value="'+esc(resource.id)+'"'+(assignments[resource.id]===alternate?' checked':'')+'>'+esc(resource.name)+(assignments[resource.id]&&assignments[resource.id]!==alternate?' · assigned to '+esc(getDraft().variants[assignments[resource.id]]?.name||'another layout'):'')+'</label>').join('');
    return dialog('Assign '+variantFor(getDraft(),alternate).name,fields?form('assign-theme-layout',fields,'Apply assignments'):'<p>No published records are available for this template.</p>');
  }
  if(action==='builder-history')return dialog('Version history',savedVersions(entry()));
  if(action==='builder-version-restore'){
    const version=entry().versions.find(item=>item.id===key);
    if(version){
      close();
      return mutate(()=>{draft=structuredClone(version.design);alternate='';pickedElement=null;selectedBlock='';selected=sections()[0]?.id||'';});
    }
  }
  if(action==='builder-select'){selected=key;selectedBlock='';pickedElement=null;return rerender();}
  if(action==='block-select'){selectedBlock=key;return rerender();}
  if(action==='builder-stores'||action==='builder-footer'){
    page=action==='builder-stores'?'stores':'footer';
    alternate='';
    selectedBlock='';pickedElement=null;selected=sections()[0]?.id||'';return rerender();
  }
  if(action==='block-add'){
    const choices=active()?.type==='Stores directory'?['Store location']:active()?.type==='Store footer'?['Footer link']:blockTypes;
    return dialog('Add block',form('add-block',S('Block type','type',choices,choices[0]),'Add block'));
  }
  if(['block-hide','block-remove','block-up','block-down'].includes(action)){
    const blocks=active()?.blocks||[],index=blocks.findIndex(b=>b.id===selectedBlock);
    if(index<0)return;
    if(action==='block-hide')return mutate(()=>blocks[index].hidden=!blocks[index].hidden);
    if(action==='block-remove')return mutate(()=>{blocks.splice(index,1);selectedBlock='';});
    const target=index+(action==='block-up'?-1:1);
    if(blocks[target])return mutate(()=>{const [block]=blocks.splice(index,1);blocks.splice(target,0,block);});
    return;
  }
  if(action==='builder-add'){
    const choices=[...(page==='home'?['Store cards']:page==='stores'?['Stores directory']:page==='footer'?['Store footer']:[]),...types];
    return dialog('Add section',form('add-section',S('Section type','type',choices,choices[0]),'Add section'));
  }
  if(action==='builder-save'||action==='builder-publish'){
    const forms=[...document.querySelectorAll('.inspector form')];
    for(const editorForm of forms){
      if(!editorForm.reportValidity())return;
      readInspector(editorForm,getDraft());
    }
    saveDraft();
    rerender();
    if(action==='builder-publish')return publishDialog(entry());
    return;
  }
  if(action==='builder-preview'){
    dialog(pages[page]+' · live preview',previewFrame(getDraft(),true),{wide:true});
    bindThemePreview();
    return;
  }
  if(action==='builder-undo'){
    if(!undoStack.length)return flash('There is no edit to undo.');
    future.push(structuredClone(getDraft()));draft=undoStack.pop();if(!variantFor(draft,alternate))alternate='';if(!active())selected=sections()[0]?.id||'';scheduleSave();return rerender();
  }
  if(action==='builder-redo'){
    if(!future.length)return flash('There is no edit to redo.');
    undoStack.push(structuredClone(getDraft()));draft=future.pop();if(!variantFor(draft,alternate))alternate='';if(!active())selected=sections()[0]?.id||'';scheduleSave();return rerender();
  }
  const index=sections().findIndex(s=>s.id===selected);
  if(index<0)return;
  if(action==='builder-hide')return mutate(()=>active().hidden=!active().hidden);
  if(action==='builder-copy')return mutate(()=>{const duplicate=structuredClone(active());duplicate.id=uid();duplicate.title+=' copy';sections().splice(index+1,0,duplicate);selected=duplicate.id;});
  if(action==='builder-remove')return mutate(()=>{sections().splice(index,1);selected=sections()[Math.max(0,index-1)]?.id||'';});
  const direction=action==='builder-up'?-1:action==='builder-down'?1:0;
  if(direction&&sections()[index+direction])return mutate(()=>{const [item]=sections().splice(index,1);sections().splice(index+direction,0,item);});
}
