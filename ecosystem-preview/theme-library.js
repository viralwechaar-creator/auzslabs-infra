import {seed, templates} from './data.js';
import {button, close, dialog, esc, link, pathFor, rerender, save, state, uid} from './ecosystem.js';

const starterNames = {minimal:'Minimal',classic:'Classic',blank:'Blank starter'};
const directions = {
  neutral:{label:'Keep starter styling'},
  editorial:{label:'Editorial',accent:'#51443d',font:'Editorial serif',radius:0,align:'left'},
  modern:{label:'Modern',accent:'#22242a',font:'System sans',radius:10,align:'center'},
  vibrant:{label:'Bold',accent:'#532ed5',font:'System sans',radius:16,align:'center'},
};
const dateLabel = date => new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short'}).format(new Date(date));

export function themeLibrary(){
  if(state.themeLibrary)return state.themeLibrary;
  const entries = {};
  for(const [id,design] of Object.entries({...state.themeDrafts,[state.builder.theme]:state.builder})){
    entries[id]={id,name:starterNames[id]||'Store theme',design:structuredClone(design),versions:[]};
  }
  return state.themeLibrary={published:state.builder.theme,entries,releases:[]};
}

export function starterDesign(starter){
  const design=structuredClone(seed.builder);
  design.theme=starter==='classic'?'classic':'minimal';
  if(starter==='classic')design.pages.home=design.pages.home.filter(section=>section.type!=='Store cards');
  if(starter==='blank'){
    design.pages.home=[{id:'hero',type:'Hero',title:'Welcome to our store',cta:'Shop now',href:'#/shop'}];
    delete design.pages.about;
  }
  return design;
}

export const editorRoute = id => 'builder?theme='+encodeURIComponent(id);
export const draftPreview = entry => '/store.html?design=draft&draft='+encodeURIComponent(entry.id)+'&template='+entry.design.theme+'#/';

function createDraft(name,design){
  const id=uid();
  const entry={id,name,design:structuredClone(design),versions:[]};
  entry.design.savedAt=new Date().toISOString();
  themeLibrary().entries[id]=entry;
  return entry;
}

function openDraft(entry,message){
  save(message);
  close();
  location.hash='/'+editorRoute(entry.id);
}

function version(entry,label){
  entry.versions.unshift({id:uid(),at:new Date().toISOString(),label,design:structuredClone(entry.design)});
  entry.versions.length=Math.min(entry.versions.length,12);
}

export function updateThemeDraft(entry,design,label='Saved design'){
  const normalize=value=>JSON.stringify({...value,savedAt:undefined});
  if(normalize(entry.design)===normalize(design))return false;
  version(entry,label);
  entry.design={...structuredClone(design),savedAt:new Date().toISOString()};
  return true;
}

export function publishDialog(entry){
  const current=state.builder,draft=entry.design;
  const keys=new Set([...Object.keys(current.pages),...Object.keys(draft.pages)]);
  const changed=[...keys].filter(key=>JSON.stringify(current.pages[key])!==JSON.stringify(draft.pages[key]));
  const layoutsChanged=JSON.stringify(current.variants)!==JSON.stringify(draft.variants)||JSON.stringify(current.assignments)!==JSON.stringify(draft.assignments);
  const stylesChanged=['theme','accent','font','radius'].some(key=>current[key]!==draft[key]);
  const summary=[changed.length?changed.length+' page templates changed':'',layoutsChanged?'Alternate layouts or assignments changed':'',stylesChanged?'Theme styling changed':''].filter(Boolean);
  dialog('Publish theme to local storefront','<p class="compact-copy">Review '+esc(entry.name)+' before making this draft the current theme for this browser.</p>'+
    (summary.length?'<ul>'+summary.map(change=>'<li>'+esc(change)+'</li>').join('')+'</ul>':'')+
    '<div class="actions"><a class="btn" target="_blank" rel="noopener" href="'+esc(draftPreview(entry))+'">Preview saved draft</a>'+
    button('Publish locally','theme-publish:'+entry.id,'primary')+button('Cancel','close-dialog')+'</div>');
}

function setPublished(entry,design){
  const library=themeLibrary();
  library.releases.unshift({id:uid(),theme:library.published,at:new Date().toISOString(),design:structuredClone(state.builder)});
  library.releases.length=Math.min(library.releases.length,12);
  library.published=entry.id;
  state.builder=structuredClone(design);
}

function input(label,name,attrs=''){
  return '<label>'+label+'<input name="'+name+'" '+attrs+'></label>';
}
function choices(name,label,items,value){
  return '<label>'+label+'<select name="'+name+'">'+Object.entries(items).map(([id,title])=>'<option value="'+esc(id)+'"'+(id===value?' selected':'')+'>'+esc(title)+'</option>').join('')+'</select></label>';
}
function newDialog(base){
  dialog('Create a new theme','<form class="stack theme-onboarding" data-form="theme-new"><fieldset class="stack" data-theme-step="0"><legend>1. Choose a starter</legend>'+
    input('Theme name','name','required maxlength="70" placeholder="Weekend collection"')+
    choices('starter','Starter theme',starterNames,starterNames[base]?base:'minimal')+
    '<div class="actions">'+button('Continue','theme-next','primary')+button('Cancel','close-dialog')+'</div></fieldset>'+
    '<fieldset class="stack" data-theme-step="1" hidden><legend>2. Set the design direction</legend>'+
    choices('direction','Visual style',Object.fromEntries(Object.entries(directions).map(([key,value])=>[key,value.label])),'neutral')+
    input('Homepage headline','headline','maxlength="100" placeholder="New arrivals"')+
    '<label>Homepage introduction<textarea name="intro" maxlength="350" placeholder="Tell shoppers what makes your store different"></textarea></label>'+
    input('Hero image URL','image','placeholder="/preview-assets/your-hero.webp"')+
    '<div class="actions">'+button('Back','theme-back')+'<button class="btn primary" type="submit">Create draft</button></div></fieldset></form>');
}
function showThemeStep(form,step){
  for(const group of form.querySelectorAll('[data-theme-step]'))group.hidden=Number(group.dataset.themeStep)!==step;
  form.querySelector('[data-theme-step="'+step+'"] input, [data-theme-step="'+step+'"] select')?.focus();
}

function importDialog(){
  dialog('Import a theme ZIP','<form class="stack" data-form="theme-import"><p class="compact-copy">Use an AUZslab theme ZIP with a version 1 manifest. The package creates an independent draft.</p>'+
    input('Theme name','name','maxlength="70" placeholder="Use file name"')+
    input('Theme ZIP','zip','type="file" accept=".zip,application/zip" required')+
    '<div class="actions"><button class="btn primary" type="submit">Import draft</button>'+link('Download example ZIP','/api/theme/starter')+'</div><output role="status"></output></form>');
}

function makeStarter(fields){
  const design=starterDesign(fields.starter);
  const style=directions[fields.direction]||directions.neutral;
  const hero=design.pages.home.find(section=>section.type==='Hero');
  if(style.accent)Object.assign(design,{accent:style.accent,font:style.font,radius:style.radius});
  if(hero){
    if(style.align)hero.align=style.align;
    if(fields.headline?.trim())hero.title=fields.headline.trim();
    if(fields.intro?.trim())hero.text=fields.intro.trim();
    if(fields.image?.trim())hero.image=fields.image.trim();
  }
  return design;
}

export function libraryPanels(){
  const library=themeLibrary();
  const current=library.entries[library.published];
  const editing=entry=>link('Edit in canvas',pathFor(editorRoute(entry.id)),'primary');
  const currentCard='<div class="theme-library-row"><div><h3>'+esc(current.name)+'</h3><p>Currently shown in the local storefront</p></div><div class="actions">'+
    link('View storefront','/store.html?design=saved#/')+editing(current)+'</div></div>';
  const draftList=Object.values(library.entries).filter(entry=>entry.id!==library.published).reverse().map(entry=>
    '<div class="theme-library-row"><div><h3>'+esc(entry.name)+'</h3><p>'+esc(starterNames[entry.design.theme]||'Custom')+(entry.design.savedAt?' · Saved '+esc(dateLabel(entry.design.savedAt)):'')+'</p></div><div class="actions">'+
    link('Preview',draftPreview(entry))+editing(entry)+button('Rename','theme-rename:'+entry.id)+button('Duplicate','theme-duplicate:'+entry.id)+button('Publish','theme-review:'+entry.id)+'</div></div>').join('');
  const releases=library.releases.map(release=>'<div class="theme-library-row"><div><strong>'+esc(library.entries[release.theme]?.name||'Store theme')+'</strong><p>'+esc(dateLabel(release.at))+'</p></div>'+
    button('Review restore','theme-review-release:'+release.id)+'</div>').join('');
  const starters=templates.filter(t=>['minimal','classic'].includes(t.id)).map(t=>'<article class="theme-starter"><img src="'+esc(t.image)+'" alt="" loading="lazy"><div><h3>'+esc(t.name)+'</h3><p>'+esc(t.description)+'</p>'+button('Use starter','theme-new:'+t.id)+'</div></article>').join('');
  const section=(title,content,actions='')=>'<section class="panel"><div class="panel-title"><h2>'+title+'</h2><div class="actions">'+actions+'</div></div><div class="panel-body">'+content+'</div></section>';
  return section('Current theme',currentCard,button('Rename','theme-rename:'+current.id)+button('Duplicate','theme-duplicate:'+current.id))+
    section('Draft themes',draftList||'<p>No unpublished themes yet.</p>',button('Import ZIP','theme-import')+button('New theme','theme-new','primary'))+
    section('Theme starters','<div class="theme-starters">'+starters+'</div>')+
    (releases?section('Previous publications',releases):'');
}

export function themeLibraryDispatch(type,target){
  if(type==='submit'&&target.dataset.form==='theme-new'){
    if(target.querySelector('[data-theme-step="1"]').hidden){showThemeStep(target,1);return true;}
    const fields=Object.fromEntries(new FormData(target));
    if(!fields.name.trim()){target.elements.name.setCustomValidity('Enter a theme name.');target.elements.name.reportValidity();target.elements.name.setCustomValidity('');return true;}
    openDraft(createDraft(fields.name.trim(),makeStarter(fields)),'Private theme draft created.');
    return true;
  }
  if(type==='submit'&&target.dataset.form==='theme-import'){
    const values=new FormData(target),file=values.get('zip'),error=target.querySelector('output');
    if(!file?.size||file.size>2*1024*1024){error.textContent='Choose a ZIP no larger than 2 MB.';return true;}
    const submit=target.querySelector('[type=submit]');
    submit.disabled=true;
    fetch('/api/theme/import',{method:'POST',body:file})
      .then(async response=>{
        const design=await response.json();
        if(!response.ok)throw new Error(design.error||'The ZIP could not be imported.');
        if(!target.isConnected)return;
        design.pages={...starterDesign(design.theme).pages,...design.pages};
        const name=String(values.get('name')||'').trim()||file.name.replace(/\.zip$/i,'').slice(0,70)||'Imported theme';
        openDraft(createDraft(name,design),'Theme imported as a private draft.');
      }).catch(err=>{error.textContent=err.message;}).finally(()=>{submit.disabled=false;});
    return true;
  }
  if(type==='submit'&&target.dataset.form==='theme-rename'){
    const entry=themeLibrary().entries[target.dataset.themeId];
    const name=String(new FormData(target).get('name')||'').trim();
    if(entry&&name){entry.name=name;close();save('Theme renamed.');rerender();}
    else target.querySelector('output').textContent='Enter a theme name.';
    return true;
  }
  if(type!=='click')return false;
  const [action,id]=target.dataset.action.split(':');
  if(action==='theme-new')newDialog(id);
  else if(action==='theme-import')importDialog();
  else if(action==='theme-next'||action==='theme-back'){
    const form=target.closest('form');
    const name=form.elements.name;
    if(action==='theme-next'&&!name.reportValidity())return true;
    showThemeStep(form,action==='theme-next'?1:0);
  }else if(action==='theme-rename'){
    const entry=themeLibrary().entries[id];
    if(entry)dialog('Rename theme','<form class="stack" data-form="theme-rename" data-theme-id="'+esc(id)+'">'+
      input('Theme name','name','required maxlength="70" value="'+esc(entry.name)+'"')+
      '<div class="actions"><button type="submit" class="btn primary">Save name</button></div><output role="status"></output></form>');
  }else if(action==='theme-duplicate'){
    const entry=themeLibrary().entries[id];
    if(entry)openDraft(createDraft((entry.name+' copy').slice(0,70),entry.design),'Private theme copy created.');
  }else if(action==='theme-review'){
    const entry=themeLibrary().entries[id];
    if(entry)publishDialog(entry);
  }else if(action==='theme-publish'){
    const entry=themeLibrary().entries[id];
    if(entry){
      setPublished(entry,{...entry.design,savedAt:new Date().toISOString()});
      close();save('Theme published to the local storefront.');rerender();
    }
  }else if(action==='theme-review-release'){
    const release=themeLibrary().releases.find(item=>item.id===id);
    if(release)dialog('Restore a previous publication','<p class="compact-copy">Publish the version used before this switch. Current theme drafts and store records stay available.</p><div class="actions">'+
      button('Restore locally','theme-restore-release:'+id,'primary')+button('Cancel','close-dialog')+'</div>');
  }else if(action==='theme-restore-release'){
    const library=themeLibrary(),release=library.releases.find(item=>item.id===id);
    if(release&&library.entries[release.theme]){
      setPublished(library.entries[release.theme],release.design);
      close();save('Previous theme version restored locally.');rerender();
    }
  }else return false;
  return true;
}

export function savedVersions(entry){
  const versions=entry.versions.map(item=>'<div class="theme-library-row"><div><strong>'+esc(item.label)+'</strong><p>'+esc(dateLabel(item.at))+'</p></div>'+
    button('Restore to editor','builder-version-restore:'+item.id)+'</div>').join('');
  return versions||'<p>Earlier versions appear after you save changes.</p>';
}
