/* AUZslab admin console: core (state, data engine, UI kit, charts, shell). Pages register themselves in PAGES (see p-*.js). */
const C=window.CFG||{},sb=supabase.createClient(C.url,C.key);
const S={user:null,role:'cashier',perms:null,date:new Date().toLocaleDateString('en-CA'),page:'dashboard',lastSync:null,syncOk:true,sideOpen:false,collapsed:false,open:{},q:'',f:{},outlet:null,features:null,enabledFeatures:{},tenant:null};
const R={},PAGES={},TITLES={};
const $=s=>document.querySelector(s),uid=()=>crypto.randomUUID(),now=()=>new Date().toISOString(),r2=n=>Math.round(n*100)/100;
const inr=n=>'₹'+(Math.round((+n||0)*100)/100).toLocaleString('en-IN');
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const h=(t,a={},...k)=>{const e=document.createElement(t);for(const x in a){const v=a[x];if(v==null||v===false)continue;x.startsWith('on')?e[x]=v:x=='class'?e.className=v:x=='value'&&(t=='input'||t=='select'||t=='textarea')?e.value=v:e.setAttribute(x,v===true?'':v)}e.append(...k.flat(9).filter(x=>x!=null&&x!==false));return e};
const today=()=>new Date().toLocaleDateString('en-CA'),dayOf=iso=>iso?new Date(iso).toLocaleDateString('en-CA'):'';
const addDays=(d,n)=>{const t=new Date(d+'T12:00:00');t.setDate(t.getDate()+n);return t.toLocaleDateString('en-CA')};
const fmtD=d=>d?new Date(d.length==10?d+'T12:00:00':d).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'}):'';
const fmtDT=d=>d?new Date(d).toLocaleString([],{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}):'';
const sum=(a,f)=>r2(a.reduce((x,o)=>x+(+f(o)||0),0));
const cap=s=>String(s||'').replace(/^./,c=>c.toUpperCase());
// ---------- icons ----------
const P={
 home:'<path d="M3 11l9-8 9 8"/><path d="M5 10v10h5v-6h4v6h5V10"/>',live:'<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h8M8 17h4"/>',orders:'<path d="M7 3h10l2 3v15H5V6z"/><path d="M9 11h6M9 15h6"/>',online:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',kot:'<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',due:'<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 10h18M7 15h4"/>',
 menu:'<path d="M4 6h16M4 12h16M4 18h10"/>',inv:'<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v8"/>',mkt:'<path d="M4 13V9l12-5v14L4 13z"/><path d="M7 14l1 6h3l-1-5"/>',fin:'<circle cx="12" cy="12" r="9"/><path d="M9 8h6M9 12h6M10 8c4 0 4 5 0 5l4 4"/>',rep:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',team:'<circle cx="9" cy="8" r="3.2"/><path d="M2.5 20v-1a6.5 6.5 0 0 1 13 0v1"/><path d="M16.5 5a3.2 3.2 0 0 1 0 6.2M21 20v-1a5.6 5.6 0 0 0-4-5.4"/>',crm:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',plug:'<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0z"/><path d="M12 17v4"/>',star:'<path d="M12 3l2.6 5.6 6.1.6-4.6 4.1 1.3 6-5.4-3.2L6.6 19.3l1.3-6-4.6-4.1 6.1-.6z"/>',
 dev:'<rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M11 18h2"/>',
 moon:'<path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/>',bell:'<path d="M12 3a5 5 0 0 0-5 5v3.5c0 1-.4 2-1.2 2.7L5 15h14l-.8-.8A4 4 0 0 1 17 11.5V8a5 5 0 0 0-5-5Z"/><path d="M10 18a2 2 0 0 0 4 0"/>',gear:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/>',col:'<path d="M15 6l-6 6 6 6"/><path d="M5 5v14"/>',cal:'<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',ref:'<path d="M20 12a8 8 0 1 1-2.5-5.8L20 8"/><path d="M20 3v5h-5"/>',chr:'<path d="M9 6l6 6-6 6"/>',chd:'<path d="M6 9l6 6 6-6"/>',bolt:'<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>',
 cash:'<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/>',card:'<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 10h18"/>',other:'<circle cx="12" cy="12" r="8"/><path d="M12 8v8M8 12h8"/>',unpaid:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6"/>',dine:'<path d="M4 3v7a2 2 0 0 0 4 0V3M6 10v11M16 3c-2 2-2 8 0 9v9"/>',take:'<path d="M6 7h12l-1 13H7z"/><path d="M9 7a3 3 0 0 1 6 0"/>',deliv:'<circle cx="6" cy="17" r="2.5"/><circle cx="18" cy="17" r="2.5"/><path d="M8 17h7l-3-8H8M12 9h4l2 5"/>',
 exp:'<path d="M12 3v12M8 11l4 4 4-4M5 20h14"/>',wd:'<path d="M12 21V9M8 13l4-4 4 4M5 4h14"/>',top:'<path d="M12 5v14M5 12h14"/>',cxl:'<circle cx="12" cy="12" r="9"/><path d="M9 9l6 6M15 9l-6 6"/>',mod:'<path d="M4 20l4-1 11-11-3-3L5 16z"/>',shift:'<path d="M4 8h13l-3-3M20 16H7l3 3"/>',prn:'<path d="M7 8V3h10v5M7 17H5v-7h14v7h-2M7 14h10v7H7z"/>',wv:'<path d="M5 12l5 5L20 7"/>',
 spark:'<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M18 16l.8 2.2L21 19l-2.2.8L18 22l-.8-2.2L15 19l2.2-.8z"/>',arr:'<path d="M5 12h14M13 6l6 6-6 6"/>',trend:'<path d="M4 17l6-6 4 4 6-8"/><path d="M15 7h5v5"/>',menu3:'<path d="M4 7h16M4 12h16M4 17h16"/>',store:'<path d="M3 9l1.5-5h15L21 9M4 9v11h16V9"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',srch:'<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',edit:'<path d="M4 20l4-1 11-11-3-3L5 16z"/>',trash:'<path d="M5 7h14M9 7V4h6v3M7 7l1 13h8l1-13"/>',dl:'<path d="M12 4v11M8 11l4 4 4-4M5 20h14"/>',up:'<path d="M12 20V9M8 13l4-4 4 4M5 4h14"/>',search:'<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',wa:'<path d="M4 20l1.3-4.2A8 8 0 1 1 8.4 18.8z"/><path d="M9 9c0 3 3 6 6 6l1-2-2-1-1 .8c-.9-.4-1.6-1.100-2-2l.8-1-1-2z"/>',link:'<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.700l1-1"/>',
 gift:'<rect x="4" y="9" width="16" height="11" rx="1"/><path d="M4 9h16M12 9v11"/><path d="M8 9c-1.5 0-3-1-3-3s1.5-2 3-1c1 .6 2 2 3 4zM16 9c1.5 0 3-1 3-3s-1.5-2-3-1c-1 .6-2 2-3 4z"/>',user:'<circle cx="12" cy="8" r="3.5"/><path d="M5 21a7 7 0 0 1 14 0"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',box:'<path d="M3 8l9-5 9 5v8l-9 5-9-5z"/><path d="M3 8l9 5 9-5"/>',tag:'<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.500" cy="8.500" r="1.200"/>',img:'<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/>',doc:'<path d="M7 3h8l4 4v14H7z"/><path d="M15 3v4h4M10 12h6M10 16h6"/>',lock:'<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',check:'<path d="M5 12l5 5L20 7"/>',x:'<path d="M6 6l12 12M18 6L6 18"/>',printer:'<path d="M7 8V3h10v5M7 17H5v-7h14v7h-2M7 14h10v7H7z"/>'};
const ic=(n,s=18)=>{const e=document.createElement('span');e.style.cssText='display:inline-flex';e.innerHTML='<svg width="'+s+'" height="'+s+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="flex:0 0 '+s+'px">'+(P[n]||'')+'</svg>';return e.firstChild};
const tile=(n,c)=>{const t=h('span',{class:'tile t-'+c});t.append(ic(n,16));return t};
// ---------- local data (own IndexedDB: this console never moves the POS's sync cursor) ----------
const idb=new Promise(r=>{const q=indexedDB.open('dash2',1);q.onupgradeneeded=()=>['rec','out','meta'].forEach(s=>q.result.createObjectStore(s,{keyPath:s=='meta'?'k':'id'}));q.onsuccess=()=>r(q.result);q.onerror=()=>r(null)});
const tx=async(s,m,f)=>{const d=await idb;if(!d)return;return new Promise((res,rej)=>{const t=d.transaction(s,m),q=f(t.objectStore(s));t.oncomplete=()=>res(q.result);t.onerror=()=>rej(t.error)})};
const all=s=>tx(s,'readonly',o=>o.getAll()),get=(s,k)=>tx(s,'readonly',o=>o.get(k)),put=(s,v)=>tx(s,'readwrite',o=>o.put(v)),clr=s=>tx(s,'readwrite',o=>o.clear()),del=(s,k)=>tx(s,'readwrite',o=>o.delete(k));
// ---------- outlets ----------
const OUTK=new Set(['order','kotlog','exp','cashmove','waste','adjustment','transfer','ing','po','purchase','shift','dayclose','table','voidlog','closing']);
const outletId=()=>{try{return localStorage.outlet||'main'}catch{return'main'}};
const setOutlet=id=>{try{localStorage.outlet=id}catch{}};
const settingsRec=()=>R.settings&&R.settings.data||{};
const cfg=()=>({name:'My Business',tax:5,...settingsRec()});
const rawL=k=>Object.values(R).filter(r=>r.kind==k&&!r.deleted).map(r=>r.data);
const outlets=()=>[{id:'main',name:cfg().name||'Main outlet',main:true},...rawL('outlet').filter(o=>o.active!==false)];
const outletNameOf=id=>{const o=outlets().find(x=>x.id==(id||'main'));return o?o.name:'Main outlet'};
const L=k=>{const a=rawL(k),o=outletId();return OUTK.has(k)&&o!='all'?a.filter(d=>(d.outlet||'main')==o):a};
const rec=id=>R[id]&&!R[id].deleted?R[id].data:null;
let busy=0,lastErr='';
async function save(kind,data,id=data.id||uid(),deleted=false){
 data.id=id;if(OUTK.has(kind)&&!data.outlet){const o=outletId();data.outlet=o=='all'?'main':o}
 const base=(R[id]&&R[id].srv)||null,r={id,kind,data,deleted,updated_at:now(),srv:R[id]&&R[id].srv};
 R[id]=r;await put('rec',r);await put('out',{id,kind,data,deleted,updated_at:r.updated_at,base});sync();return r}
const remove=(kind,d)=>save(kind,d,d.id,true);
async function doSync(){
 if(busy||!navigator.onLine||!S.user)return;busy=1;let had=false;
 try{
  for(const r of await all('out')){try{
   const{data:res,error}=await sb.rpc('push_record',{rid:r.id,rkind:r.kind,rdata:r.data,rdeleted:r.deleted,base:r.base||null,force:false});if(error)throw error;
   let sv=res.server_updated_at;
   if(res.conflict){const{data:res2,error:e2}=await sb.rpc('push_record',{rid:r.id,rkind:r.kind,rdata:r.data,rdeleted:r.deleted,base:null,force:true});if(e2)throw e2;sv=res2.server_updated_at}
   if(R[r.id])R[r.id].srv=sv;const c=await get('out',r.id);if(c&&c.updated_at==r.updated_at)await del('out',r.id)
  }catch(e){had=true;lastErr=(e&&e.message)||String(e);console.warn('push',r.id,e)}}
  const since=((await get('meta','since'))||{}).v||'1970-01-01T00:00:00Z';
  const{data,error}=await sb.from('records').select('id,kind,data,deleted,updated_at').gte('updated_at',since).order('updated_at').limit(1000);if(error)throw error;
  let ch=0;for(const row of data){if(await get('out',row.id)||(R[row.id]&&R[row.id].updated_at==row.updated_at))continue;const r={...row,srv:row.updated_at};R[row.id]=r;await put('rec',r);ch++}
  if(data.length)await put('meta',{k:'since',v:data[data.length-1].updated_at});
  S.lastSync=Date.now();S.syncOk=!had;busy=0;if(data.length>=1000)setTimeout(sync,300);if(ch&&!/INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)&&!document.querySelector('.mwrap'))render()
 }catch(e){S.syncOk=false;lastErr=(e&&e.message)||String(e);busy=0;console.warn('sync',e)}
 busy=0;const el=document.querySelector('[data-sync]');if(el)el.replaceWith(syncCard())}
function sync(){navigator.locks?navigator.locks.request('console-sync',{ifAvailable:true},l=>l?doSync():null):doSync()}
const syncNow=()=>navigator.locks?navigator.locks.request('console-sync',{},()=>doSync()):doSync();
// ---------- UI kit ----------
function toast(m){const t=h('div',{class:'toast'},m);document.body.append(t);setTimeout(()=>t.remove(),2600)}
function modal(title,body,opts={}){
 const w=h('div',{class:'mwrap',onmousedown:e=>{if(e.target==w&&!opts.sticky)close()}});
 const close=()=>{w.remove();opts.onClose&&opts.onClose()};
 w.append(h('div',{class:'modal'+(opts.wide?' wide':'')},h('div',{class:'mh'},h('h2',{},title),h('button',{class:'xbtn',onclick:close,'aria-label':'Close'},'×')),...[].concat(body)));
 document.body.append(w);return close}
// fields: [{k,label,type:'text|number|select|textarea|check|date|datetime|email|tel|time|image|password|chips',options:[[v,label]],value,placeholder,hint,span:2,req,step}]
function formModal(title,fields,onSave,opts={}){
 const vals={},els={};let up={};
 const grid=h('div',{class:'fgrid'});
 fields.forEach(f=>{
  if(f.type=='note'){grid.append(h('div',{class:'fld s2'},h('div',{class:'note'},f.label)));return}
  if(f.type=='node'){grid.append(h('div',{class:'fld s2'},f.node));return}
  if(f.type=='sep'){grid.append(h('div',{class:'fld s2'},h('b',{style:'font-size:14px;margin-top:6px'},f.label)));return}
  const v=f.value;let el;
  if(f.type=='select')el=h('select',{},...(f.options||[]).map(o=>{const[val,lab]=Array.isArray(o)?o:[o,o];return h('option',{value:val,selected:String(val)==String(v??'')},lab)}));
  else if(f.type=='textarea')el=h('textarea',{placeholder:f.placeholder||''},v??'');
  else if(f.type=='check'){el=h('input',{type:'checkbox',checked:!!v});grid.append(h('div',{class:'fld chk'+(f.span==2||f.span==null?' s2':'')},el,h('label',{},f.label)));els[f.k]=el;return}
  else if(f.type=='image'){const prev=h('div',{class:'hint'},v?'Photo is set':'No photo yet'),inp=h('input',{type:'file',accept:'image/*'});up[f.k]=v||null;inp.onchange=async()=>{const file=inp.files[0];if(!file)return;prev.textContent='Uploading…';try{up[f.k]=await uploadImage(file,f.prefix||'menu');prev.textContent='Uploaded'}catch(e){prev.textContent='Upload failed: '+e.message}};el=h('div',{style:'display:grid;gap:6px'},inp,prev);el.get=()=>up[f.k]}
  else if(f.type=='multi'){const sel=new Set(Array.isArray(v)?v:[]),box=h('div',{style:'max-height:200px;overflow:auto;border:1px solid var(--line);border-radius:11px;padding:6px 10px;display:grid;gap:2px'},...(f.options||[]).map(([val,lab])=>h('label',{style:'display:flex;align-items:center;gap:10px;padding:5px 0;font-size:14px;color:var(--ink)'},h('input',{type:'checkbox',checked:sel.has(val),style:'width:18px;height:18px',onchange:e=>{e.target.checked?sel.add(val):sel.delete(val)}}),lab)));el=box;el.get=()=>[...sel]}
  else if(f.type=='chips'){const list=Array.isArray(v)?[...v]:[],box=h('div',{class:'chips'}),inp=h('input',{type:'text',placeholder:f.placeholder||'Type and press Enter'});const draw=()=>box.replaceChildren(...list.map((x,i)=>h('span',{class:'chipx'},x,h('button',{type:'button',onclick:()=>{list.splice(i,1);draw()}},'×'))));draw();inp.onkeydown=e=>{if(e.key=='Enter'){e.preventDefault();const t=inp.value.trim();if(t&&!list.includes(t))list.push(t);inp.value='';draw()}};el=h('div',{style:'display:grid;gap:6px'},inp,box);el.get=()=>{const t=inp.value.trim();if(t&&!list.includes(t))list.push(t);return list}}
  else el=h('input',{type:f.type=='datetime'?'datetime-local':(f.type||'text'),value:v??'',placeholder:f.placeholder||'',step:f.step||(f.type=='number'?'any':null)});
  els[f.k]=el;
  grid.append(h('div',{class:'fld'+(f.span==2?' s2':'')},h('label',{},f.label+(f.req?' *':'')),el,f.hint?h('div',{class:'hint'},f.hint):null))});
 const read=()=>{const o={};fields.forEach(f=>{if(f.type=='note'||f.type=='sep'||f.type=='node')return;const el=els[f.k];if(f.type=='check')o[f.k]=el.checked;else if(f.type=='image'||f.type=='chips'||f.type=='multi')o[f.k]=el.get();else if(f.type=='number')o[f.k]=el.value===''?null:+el.value;else o[f.k]=el.value.trim?el.value.trim():el.value});return o};
 let close;const save2=async()=>{const o=read();for(const f of fields)if(f.req&&(o[f.k]==null||o[f.k]===''||o[f.k]===false)){toast((f.label||f.k)+' is required');return}
  const r=await onSave(o);if(r===false)return;close();if(opts.after)opts.after(o)};
 close=modal(title,[grid,h('div',{class:'mf'},opts.onDelete?h('button',{class:'btn d l',onclick:async()=>{if(!confirm(opts.deleteMsg||'Delete this? This cannot be undone.'))return;await opts.onDelete();close();opts.after&&opts.after()}},'Delete'):null,h('button',{class:'btn',onclick:()=>close()},'Cancel'),h('button',{class:'btn p',onclick:save2},opts.saveLabel||'Save'))],{wide:opts.wide});
 return close}
function confirmBox(msg,yes,label){const c=modal('Confirm',[h('p',{style:'margin:0 0 6px'},msg),h('div',{class:'mf'},h('button',{class:'btn',onclick:()=>c()},'Cancel'),h('button',{class:'btn p',onclick:async()=>{c();await yes()}},label||'Confirm'))])}
// table: cols [{label,get:row=>node|text,r:true,cls}], rows, opts {onRow,empty,emptyText}
function table(cols,rows,opts={}){
 if(!rows.length)return h('div',{class:'empty'},h('b',{},opts.empty||'Nothing here yet'),opts.emptyText||'');
 return h('div',{class:'scroll-x'},h('table',{class:'tbl'},h('thead',{},h('tr',{},...cols.map(c=>h('th',{class:c.r?'r':''},c.label)))),h('tbody',{},...rows.map(r=>h('tr',{class:opts.onRow?'click':'',onclick:opts.onRow?e=>{if(e.target.closest('button,a,input,select'))return;opts.onRow(r)}:null},...cols.map(c=>{const v=c.get(r);return h('td',{class:c.r?'r':''},v==null?'':v)}))))))}
const actBtns=(...b)=>h('div',{class:'acts'},...b.filter(Boolean));
const btn=(label,fn,cls='',icon)=>h('button',{class:'btn '+cls,onclick:fn},icon?ic(icon,16):null,label);
const pill=(t,c='n')=>h('span',{class:'pill s-'+c},t);
const card=(...k)=>h('div',{class:'card'},...k);
const cardHead=(title,...right)=>h('div',{class:'hd'},h('h3',{},title),h('div',{class:'bar-row',style:'margin:0'},...right));
function pageHead(t,p,...acts){return h('div',{class:'ph'},h('div',{},h('h1',{},t),h('p',{},p||'')),h('div',{class:'bar-row',style:'margin:0'},...acts))}
const kpis=a=>h('div',{class:'kpis'},...a.map(([l,v,s])=>h('div',{class:'kpi'},h('div',{class:'l'},l),h('div',{class:'v'},v),s?h('div',{class:'s'},s):null)));
const tabsBar=(items,cur,fn)=>h('div',{class:'tabs wrap'},...items.map(([k,l])=>h('button',{class:cur==k?'on':'',onclick:()=>fn(k)},l)));
const search=(ph,onq)=>h('input',{class:'inp',placeholder:ph,value:S.q,oninput:e=>{S.q=e.target.value;clearTimeout(S.qt);S.qt=setTimeout(()=>{onq?onq():render();const i=document.querySelector('.inp');if(i){i.focus();i.setSelectionRange(999,999)}},220)}});
const matchQ=(txt)=>!S.q||String(txt).toLowerCase().includes(S.q.toLowerCase());
const sw=(on,fn)=>{const i=h('input',{type:'checkbox',checked:!!on,onchange:e=>fn(e.target.checked)});return h('label',{class:'switch'},i,h('i'))};
const setRow=(title,desc,ctl)=>h('div',{class:'setrow'},h('div',{},h('b',{},title),desc?h('span',{class:'d'},desc):null),ctl);
const note=t=>h('div',{class:'note',style:'margin-bottom:12px'},t);
function csvDl(rows,name){const s=rows.map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\n'),a=h('a',{href:URL.createObjectURL(new Blob([s],{type:'text/csv'})),download:name});document.body.append(a);a.click();a.remove()}
function parseCSV(t){const rows=[];let r=[],c='',q=false;for(let i=0;i<t.length;i++){const ch=t[i];if(q){if(ch=='"'){if(t[i+1]=='"'){c+='"';i++}else q=false}else c+=ch}else if(ch=='"')q=true;else if(ch==','){r.push(c);c=''}else if(ch=='\n'||ch=='\r'){if(ch=='\r'&&t[i+1]=='\n')i++;r.push(c);c='';if(r.some(x=>x!==''))rows.push(r);r=[]}else c+=ch}r.push(c);if(r.some(x=>x!==''))rows.push(r);return rows}
function pickFile(accept,cb){const i=h('input',{type:'file',accept});i.onchange=()=>i.files[0]&&cb(i.files[0]);i.click()}
function compressImage(file,maxW,quality){return new Promise((res,rej)=>{const img=new Image(),url=URL.createObjectURL(file);img.onload=()=>{const sc=Math.min(1,maxW/img.width),w=Math.round(img.width*sc),ht=Math.round(img.height*sc),c=document.createElement('canvas');c.width=w;c.height=ht;c.getContext('2d').drawImage(img,0,0,w,ht);c.toBlob(b=>{URL.revokeObjectURL(url);b?res(b):rej(new Error('Could not process that image'))},'image/jpeg',quality)};img.onerror=()=>rej(new Error('Could not read that image'));img.src=url})}
async function uploadImage(file,prefix){const blob=await compressImage(file,1400,.8),name=prefix+'/'+Date.now()+'-'+Math.random().toString(36).slice(2,7)+'.jpg',{error}=await sb.storage.from('site').upload(name,blob,{contentType:'image/jpeg'});if(error)throw error;return sb.storage.from('site').getPublicUrl(name).data.publicUrl}
// ---------- shared calculations ----------
const orders=()=>L('order').filter(o=>o.t&&o.lines&&o.lines.length);
const netOf=o=>r2(o.t.total-(o.refunds||[]).reduce((a,r)=>a+r.amt,0));
const paidOn=d=>orders().filter(o=>o.status=='paid'&&dayOf(o.paidAt)==d);
const createdOn=d=>orders().filter(o=>o.status!='void'&&dayOf(o.created)==d);
const isOnline=o=>!!o.src;
const chanOf=o=>o.type=='Delivery'?'Delivery':o.type=='Takeaway'?'Takeaway':'Dine-In';
const tn=id=>{const t=R[id];return t&&!t.deleted?t.data.name:''};
function dayStats(d){
 const ps=paidOn(d),rev=sum(ps,netOf),pay={cash:0,card:0,other:0,online:0};
 ps.forEach(o=>{if(isOnline(o)){pay.online+=netOf(o);return}(o.pays||[]).forEach(p=>{const a=p.amt-(p.m=='cash'?(o.change||0):0);if(p.m=='cash')pay.cash+=a;else if(p.m=='card')pay.card+=a;else pay.other+=a})});
 const unpaid=sum(orders().filter(o=>o.status=='due'&&dayOf(o.created)==d),o=>o.t.total-(o.pays||[]).reduce((a,p)=>a+p.amt,0));
 const ch={'Dine-In':{n:0,v:0},'Takeaway':{n:0,v:0},'Delivery':{n:0,v:0}};ps.forEach(o=>{const c=ch[chanOf(o)];c.n++;c.v+=netOf(o)});
 const hours=Array(24).fill(0);ps.forEach(o=>{hours[new Date(o.paidAt).getHours()]+=netOf(o)});
 return{rev,ps,pay,unpaid,ch,hours,count:createdOn(d).length}}
function unitCost(i){
 if(i.combo&&i.comboText)return r2(i.comboText.split(',').reduce((a,p)=>{const x=p.split(':'),ci=rawL('item').find(z=>z.name.toLowerCase()==(x[0]||'').trim().toLowerCase());return a+(ci?unitCost(ci)*(+x[1]||1):0)},0));
 if(i.rec)return r2(i.rec.split(',').reduce((a,p)=>{const x=p.split(':'),g=L('ing').find(z=>z.name.toLowerCase()==x[0].trim().toLowerCase());return a+(g?(g.cost||0)*(+x[1]):0)},0));
 return i.cost||0}
function itemStats(from,to){const m={};orders().filter(o=>o.status=='paid'&&dayOf(o.paidAt)>=from&&dayOf(o.paidAt)<=to).forEach(o=>o.lines.forEach(l=>{const e=m[l.name]=m[l.name]||{n:l.name,q:0,a:0,id:l.id};e.q+=l.qty;e.a+=l.price*l.qty}));return m}
// ---------- charts ----------
const svgEl=(w,h2,inner)=>{const e=document.createElement('div');e.innerHTML='<svg viewBox="0 0 '+w+' '+h2+'" preserveAspectRatio="none">'+inner+'</svg>';return e.firstChild};
function smooth(pts){if(pts.length<2)return'';let d='M'+pts[0][0]+' '+pts[0][1];for(let i=1;i<pts.length;i++){const p=pts[i-1],q=pts[i],cx=(p[0]+q[0])/2;d+=' C'+cx+' '+p[1]+' '+cx+' '+q[1]+' '+q[0]+' '+q[1]}return d}
let gid=0;
function sparkline(vals,w=300,hh=96){const mx=Math.max(...vals,1),n=Math.max(2,vals.length),pts=(vals.length>1?vals:[0,0]).map((v,i)=>[i*(w/(n-1)),hh-8-(v/mx)*(hh-22)]),flat=Math.max(...vals)==0,line=smooth(pts),area=line+' L'+w+' '+hh+' L0 '+hh+'Z',id='sg'+(++gid);
 return svgEl(w,hh,'<defs><linearGradient id="'+id+'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--accent)" stop-opacity=".35"/><stop offset="1" style="stop-color:var(--accent)" stop-opacity="0"/></linearGradient></defs><path d="'+area+'" fill="url(#'+id+')"/><path d="'+line+'" fill="none" style="stroke:var(--accent)" stroke-width="2.4" stroke-linecap="round" vector-effect="non-scaling-stroke" '+(flat?'opacity=".45"':'')+'/>')}
function miniBars(vals){const mx=Math.max(...vals,1),w=140,hh=62,bw=w/vals.length;return svgEl(w,hh,vals.map((v,i)=>{const bh=Math.max(4,(v/mx)*(hh-4));return'<rect x="'+(i*bw+2)+'" y="'+(hh-bh)+'" width="'+(bw-5)+'" height="'+bh+'" rx="2" style="fill:'+(i%3==1?'var(--accent-soft2)':'var(--accent-line)')+'"/>'}).join(''))}
function lineChartX(vals,labels,fmt=v=>'₹ '+Math.round(v)){
 const W=640,H=210,pl=48,pb=26,pt=10,mx=Math.max(100,Math.ceil(Math.max(...vals,1)/100)*100),n=Math.max(2,vals.length),X=i=>pl+i*((W-pl-8)/(n-1)),Y=v=>pt+(H-pt-pb)*(1-v/mx),pts=vals.map((v,i)=>[X(i),Y(v)]);let g='';
 [0,1,2].forEach(k=>{const v=mx/2*k,y=Y(v);g+='<line x1="'+pl+'" x2="'+(W-8)+'" y1="'+y+'" y2="'+y+'" style="stroke:var(--sep)" stroke-dasharray="3 4"/><text x="'+(pl-8)+'" y="'+(y+4)+'" text-anchor="end" font-size="12" style="fill:var(--label3)">'+fmt(v)+'</text>'});
 labels.forEach(([i,t])=>{g+='<text x="'+X(i)+'" y="'+(H-6)+'" text-anchor="middle" font-size="12" style="fill:var(--label3)">'+t+'</text>'});
 const line=smooth(pts),id='tg'+(++gid),el=svgEl(W,H,'<defs><linearGradient id="'+id+'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--accent)" stop-opacity=".3"/><stop offset="1" style="stop-color:var(--accent)" stop-opacity="0"/></linearGradient></defs>'+g+'<path d="'+line+' L'+X(n-1)+' '+Y(0)+' L'+X(0)+' '+Y(0)+'Z" fill="url(#'+id+')"/><path d="'+line+'" fill="none" style="stroke:var(--accent)" stroke-width="2.4" vector-effect="non-scaling-stroke"/>');
 el.dataset.pts=JSON.stringify(pts);el.dataset.w=W;el.dataset.h=H;return el}
function chartBox(chart,vals,tipFn){const tip=h('div',{class:'tip'}),w=h('div',{class:'chart'},chart,tip);
 w.addEventListener('mousemove',e=>{const r=chart.getBoundingClientRect(),pts=JSON.parse(chart.dataset.pts),W=+chart.dataset.w,H=+chart.dataset.h,x=(e.clientX-r.left)/r.width*W;let b=0;pts.forEach((p,i)=>{if(Math.abs(p[0]-x)<Math.abs(pts[b][0]-x))b=i});tip.style.display='block';tip.style.left=(pts[b][0]/W*r.width)+'px';tip.style.top=(pts[b][1]/H*r.height)+'px';tip.textContent=tipFn(b,vals[b])});
 w.addEventListener('mouseleave',()=>tip.style.display='none');return w}
function barList(rows,fmt=v=>v){const mx=Math.max(1,...rows.map(r=>r[1]));return h('div',{class:'top5'},...rows.map(([n,v],i)=>h('div',{class:'r'},h('span',{class:'rk'},String(i+1)),h('span',{class:'nm'},n),h('span',{class:'tr'},h('i',{style:'width:'+Math.max(2,v/mx*100)+'%'})),h('span',{class:'pc'},fmt(v)))))}
// ---------- navigation ----------
const NAV=[
 ['dashboard','Overview','home'],
 ['lbl','POS & Orders'],
 ['href','/index.html','Billing POS','store'],
 ['daily/live','Live Orders','live'],['daily/all','All Orders','orders'],['daily/online','Online Orders','online'],['daily/kot','KOT','kot'],['daily/due','Due Payment','due'],
 ['lbl','Inventory & reports'],
 ['g:inv','Inventory','inv',[['inv/raw','Raw Materials'],['inv/stock','Stock Management'],['inv/purchase','Purchase Orders'],['inv/vendors','Vendors'],['inv/recipes','Recipes'],['inv/consumption','Consumption Tracking'],['inv/reports','Inventory Reports']]],
 ['g:rep','Reports','rep',[['rep/sales','Sales Reports'],['rep/orders','Order Reports'],['rep/items','Item Reports'],['rep/inventory','Inventory Reports'],['rep/customers','Customer Reports'],['rep/staff','Staff Reports'],['rep/analytics','Analytics Dashboard']]],
 ['lbl','Manage'],
 ['g:menu','Menu Management','menu',[['menu/overview','Menu & Discounts'],['menu/items','Items'],['menu/categories','Categories'],['menu/variants','Variants'],['menu/addons','Add-ons'],['menu/tables','Tables & Areas'],['menu/taxes','Taxes'],['menu/discounts','Discounts'],['menu/availability','Menu Availability'],['menu/preferences','Order Preferences'],['menu/commission','Item Commission'],['menu/physical','Physical Menu'],['menu/images','Bulk Image Upload']]],
 ['g:crm','CRM','crm',[['crm/customers','Customers'],['crm/loyalty','Loyalty Program'],['crm/giftcards','Gift Cards'],['crm/feedback','Feedback'],['crm/membership','Membership Programs'],['crm/support','Support Tickets']]],
 ['g:team','Team Management','team',[['team/users','Users & Roles'],['team/attendance','Attendance'],['team/payroll','Payroll'],['team/tasks','Tasks']]],
 ['g:fin','Finance','fin',[['fin/expenses','Expenses'],['fin/withdrawals','Withdrawals & Top-ups'],['fin/cash','Cash Management'],['fin/settlements','Settlements'],['fin/accounting','Accounting'],['fin/reconcile','Payment Reconciliation']]],
 ['g:mkt','Marketing','mkt',[['mkt/campaigns','Campaigns'],['mkt/segments','Segments'],['mkt/offers','Offers'],['mkt/whatsapp','WhatsApp Marketing'],['mkt/promotions','Promotions'],['mkt/loyaltycamp','Loyalty Campaigns']],'New'],
 ['g:int','Integrations','plug',[['agg/swiggy','Swiggy'],['agg/zomato','Zomato'],['agg/ondc','ONDC'],['agg/dunzo','Dunzo'],['agg/ubereats','Uber Eats'],['agg/settings','Platform Settings'],['int/apps','Explore Products']]],
 ['g:mgmt','Management','gear',[['mgmt/config','Configuration'],['mgmt/website','Website & Booking'],['mgmt/reasons','Cancellation Reasons'],['mgmt/outlets','Outlets'],['mgmt/devices','Device Mapping'],['mgmt/logs','User Logs'],['mgmt/audit','Audit Trail'],['mgmt/data','Data Management']]],
 ['g:ql','Quick Links','star',[['ql/favorites','Favourite Pages'],['ql/shortcuts','Shortcuts'],['ql/custom','Custom Links']]]
];
const flatNav=()=>NAV.flatMap(n=>n[0]=='lbl'||n[0]=='href'?[]:n[0].startsWith('g:')?n[3].map(c=>[c[0],c[1],n[1]]):[[n[0],n[1],'']]);
const titleOf=p=>{const f=flatNav().find(x=>x[0]==p);return f?f[1]:'Dashboard'};
function go(p){S.page=p;S.sideOpen=false;S.q='';S.f={};const g=NAV.find(n=>n[0].startsWith('g:')&&n[3].some(c=>c[0]==p));if(g)S.open[g[0]]=true;try{location.hash='#'+p}catch{}render();const c=$('.content');if(c)c.scrollTop=0}
function sideNav(){
 const nav=h('div',{class:'nav'});
 NAV.forEach(n=>{
  if(n[0]=='lbl'){nav.append(h('div',{class:'nav-lbl'},n[1]));return}
  if(n[0]=='href'){nav.append(h('a',{class:'nb',href:n[1]},ic(n[3]),h('span',{},n[2])));return}
  if(n[0].startsWith('g:')){const id=n[0],open=!!S.open[id];
   nav.append(h('button',{class:'nb',onclick:()=>{S.open[id]=!open;render()}},ic(n[2]),h('span',{},n[1]),n[4]?h('span',{class:'badge'},n[4]):null,h('span',{class:'chev'+(open?' open':'')},ic('chr',14))),
    h('div',{class:'sub'+(open?' open':'')},...n[3].map(([pid,t])=>h('a',{class:S.page==pid?'on':'',href:'#'+pid,onclick:e=>{e.preventDefault();go(pid)}},t))));return}
  nav.append(h('button',{class:'nb'+(S.page==n[0]?' on':''),onclick:()=>go(n[0])},ic(n[2]),h('span',{},n[1])))});
 const apps=[['payroll','/payroll.html','Payroll','team'],['accounting','/accounts.html','Accounting','fin'],['mobile','/mob.html','AUZsMob','box']].filter(a=>S.features&&S.features[a[0]]===true&&S.enabledFeatures[a[0]]!==false);
 if(apps.length){nav.append(h('div',{class:'nav-lbl'},'Other apps'));apps.forEach(a=>nav.append(h('a',{class:'nb',href:a[1]},ic(a[3]),h('span',{},a[2]))))}
 return nav}
function syncCard(){const ago=S.lastSync?Math.max(0,Math.round((Date.now()-S.lastSync)/60000)):null;
 return h('div',{class:'sync'+(S.syncOk?'':' bad'),'data-sync':1},h('i'),h('div',{},h('b',{},S.syncOk?'POS Connected':'POS Offline'),h('span',{},ago==null?'Syncing…':'Last synced '+(ago<1?'just now':ago+' min ago'))))}
function outletModal(){
 const c=modal('Select outlet',[h('div',{class:'oswitch'},...outlets().map(o=>h('button',{class:outletId()==o.id?'on':'',onclick:()=>{setOutlet(o.id);c();toast('Showing '+o.name);render()}},h('span',{},h('b',{},o.name),o.addr?h('div',{class:'sm'},o.addr):null),outletId()==o.id?pill('Selected','b'):null)),outlets().length>1?h('button',{class:outletId()=='all'?'on':'',onclick:()=>{setOutlet('all');c();toast('Showing all outlets');render()}},h('span',{},h('b',{},'All outlets'),h('div',{class:'sm'},'Combined view of every outlet')),outletId()=='all'?pill('Selected','b'):null):null),
  h('div',{class:'mf'},h('button',{class:'btn',onclick:()=>{c();go('mgmt/outlets')}},'Manage outlets'))])}
function topBar(){
 const on=outletId()=='all'?'All outlets':outletNameOf(outletId());
 return h('header',{class:'top'},
  h('button',{class:'ib menu-btn',onclick:()=>{S.sideOpen=!S.sideOpen;render()},'aria-label':'Menu'},ic('menu3',20)),
  h('button',{class:'ib col-btn',title:'Collapse sidebar',onclick:()=>{S.collapsed=!S.collapsed;render()}},ic('col',18)),
  h('button',{class:'outlet',onclick:outletModal},ic('store',18),h('span',{},on),ic('chd',16)),
  h('span',{class:'open-p'},h('i'),'Open'),h('div',{class:'sp'}),
  h('button',{class:'ib',title:'Device mapping',onclick:()=>go('mgmt/devices')},ic('dev',19)),
  h('a',{class:'ib',href:'https://auzslab.in/account.html#notifications',title:'Notifications'},ic('bell',19),h('i',{class:'dot'})),
  h('button',{class:'ib',title:'Configuration',onclick:()=>go('mgmt/config')},ic('gear',19)),
  h('a',{class:'disc',href:'https://auzslab.in/products.html'},ic('store',18),h('span',{},'Discover Apps')))}
function sidebar(){
 return h('aside',{class:'side'+(S.sideOpen?' open':'')+(S.collapsed?' hide':'')},
  h('div',{class:'brand'},h('div',{class:'logo'},h('img',{src:'/icon-pos.svg',alt:'',width:42,height:42})),h('div',{},h('b',{},'AUZslab'),h('span',{},'Admin console'))),
  sideNav(),
  h('div',{class:'upg'},h('div',{class:'t'},h('span',{class:'bolt'},ic('bolt',18)),h('span',{},'Upgrade to ',h('b',{},'AUZslab Pro'))),h('p',{},'Unlock advanced reports, automation and more.'),h('a',{class:'dbtn',href:'https://auzslab.in/pricing.html'},'Upgrade Now')))}
function render(){
 if(!S.user)return login();
 if(window.auzBrandFrom)auzBrandFrom(cfg());
 if(!(S.role=='owner'||S.role=='manager'))return $('#app').replaceChildren(h('div',{class:'login'},h('h2',{style:'margin:0'},'Owner access only'),h('p',{class:'sm'},'The admin console is for owners and managers. Staff use the billing POS.'),h('a',{class:'dbtn',href:'/index.html'},'Open billing POS')));
 const keep=document.querySelector('.content'),top=keep?keep.scrollTop:0,fn=PAGES[S.page]||PAGES.dashboard;let body;
 try{body=fn()}catch(e){console.error(e);body=[card(h('b',{},'This page hit an error'),h('p',{class:'sm'},String(e&&e.message||e)))]}
 $('#app').replaceChildren(sidebar(),h('main',{class:'main'},topBar(),h('section',{class:'content'},...[].concat(body))));
 $('#ov').className='ov'+(S.sideOpen?' show':'');
 const c=document.querySelector('.content');if(c)c.scrollTop=top}
function login(msg){
 const e=h('input',{type:'email',placeholder:'Email',autocomplete:'username'}),p=h('input',{type:'password',placeholder:'Password',autocomplete:'current-password'}),m=h('div',{class:'sm',style:'color:var(--red)'},msg||'');
 $('#app').replaceChildren(h('form',{class:'login',onsubmit:async ev=>{ev.preventDefault();const{error}=await sb.auth.signInWithPassword({email:e.value.trim(),password:p.value});error?m.textContent=error.message:boot()}},h('b',{style:'font-size:20px'},'AUZs LAB Admin'),h('span',{class:'sm'},'Sign in with your owner or manager account.'),e,p,m,h('button',{type:'submit'},'Sign in')))}
async function boot(){
 if(!C.url||C.url.includes('YOUR-PROJECT'))return $('#app').replaceChildren(h('div',{class:'login'},'Setup needed: open config.js and add your Supabase URL and key.'));
 let ses=null;try{ses=(await sb.auth.getSession()).data.session}catch{}
 if(!ses)return login();
 S.user=ses.user;
 const meta=await get('meta','lastUser');if(meta&&meta.v&&meta.v!==ses.user.id){await clr('rec');await clr('out');await del('meta','since')}await put('meta',{k:'lastUser',v:ses.user.id});
 ((await all('rec'))||[]).forEach(r=>R[r.id]=r);
 try{const{data}=await sb.from('profiles').select('role,role_id,email,name').eq('id',ses.user.id).single();if(data){S.role=data.role;S.me=data;if(data.role_id){const r=await sb.from('roles').select('permissions').eq('id',data.role_id).single();S.perms=r.data&&r.data.permissions}}}catch{}
 try{const r=await sb.rpc('my_dashboard');if(r.data){S.tenant=r.data.tenant;S.features=r.data.features;S.enabledFeatures=r.data.enabled_features||{};if(window.TENANT_SLUG&&r.data.tenant&&r.data.tenant.slug!==window.TENANT_SLUG){await sb.auth.signOut();S.user=null;return login('This login belongs to a different business ('+r.data.tenant.slug+'.auzslab.in).')}}}catch{}
 const hs=(location.hash||'').slice(1);if(hs&&(PAGES[hs]||hs=='dashboard'))S.page=hs;const g=NAV.find(n=>n[0].startsWith('g:')&&n[3].some(c=>c[0]==S.page));if(g)S.open[g[0]]=true;
 render();await syncNow();loadProfiles().then(()=>render());render();
 sb.channel('console').on('postgres_changes',{event:'*',schema:'public',table:'records'},()=>sync()).subscribe();setInterval(sync,30000);addEventListener('online',sync);
 addEventListener('hashchange',()=>{const p=(location.hash||'').slice(1);if(p&&p!=S.page&&PAGES[p]){S.page=p;S.q='';render()}})}
$('#ov').onclick=()=>{S.sideOpen=false;render()};

const saveSettings=async patch=>{if(S.role!='owner'){toast('Only the owner can change business settings');return false}return save('settings',{...settingsRec(),...patch},'settings')};
async function uploadFile(file,prefix){const ext=(file.name.split('.').pop()||'bin').toLowerCase().replace(/[^a-z0-9]/g,''),name=prefix+'/'+Date.now()+'-'+Math.random().toString(36).slice(2,7)+'.'+ext,{error}=await sb.storage.from('site').upload(name,file,{contentType:file.type||'application/octet-stream'});if(error)throw error;return sb.storage.from('site').getPublicUrl(name).data.publicUrl}

async function loadProfiles(force){if(S.profiles&&!force)return S.profiles;try{const{data}=await sb.from('profiles').select('*').order('email');S.profiles=data||[]}catch{S.profiles=S.profiles||[]}return S.profiles}
const profName=id=>{const p=(S.profiles||[]).find(x=>x.id==id);return p?(p.name||p.email):(id?String(id).slice(0,6):'—')};
