import {apps, templates, collectionProducts, collectionVisible} from './data.js';
import {domainPage, domainDispatch} from './domains.js';
import {analyticsPage} from './analytics.js';
import {editorRoute,libraryPanels,themeLibrary,themeLibraryDispatch} from './theme-library.js';
import {$, badge, button, close, dialog, esc, flash, image, imageUrl, link, money, now, pathFor, rerender, save, state, uid} from './ecosystem.js';

const table=(heading,rows)=>'<div class="table-scroll"><table><thead><tr>'+heading.map(x=>'<th scope="col">'+x+'</th>').join('')+'</tr></thead><tbody>'+(rows.length?rows.map(x=>'<tr>'+x.map(y=>'<td>'+y+'</td>').join('')+'</tr>').join(''):'<tr><td colspan="'+heading.length+'"><p class="empty">No matching records.</p></td></tr>')+'</tbody></table></div>';
const panel=(title,body,actions='')=>'<section class="panel">'+(title?'<div class="panel-title"><h2>'+title+'</h2>'+actions+'</div>':'')+body+'</section>';
const body=value=>'<div class="panel-body">'+value+'</div>';
const head=(title,description,actions='',parent='')=>'<div class="page-head"><div>'+(parent?'<a class="trail" href="'+pathFor(parent[0])+'">'+parent[1]+'</a>':'')+'<h1>'+title+'</h1><p>'+description+'</p></div><div class="actions">'+actions+'</div></div>';
const wl=(label,id,kind='')=>link(label,pathFor(id),kind);
const external=(label,url)=>'<a class="btn" target="_blank" rel="noopener" href="'+url+'">'+label+'</a>';
const tabs=(active,items)=>'<nav class="tabs" aria-label="Page tabs">'+items.map(([id,name])=>'<a '+(id===active?'aria-current="page" ':'')+'href="'+pathFor(id)+'">'+name+'</a>').join('')+'</nav>';
const orderTabs=[['orders','All orders'],['drafts','Drafts'],['abandoned-checkouts','Abandoned checkouts'],['returns','Returns'],['shipping','Shipping']];
const customerTabs=[['customers','All customers'],['segments','Segments'],['companies','Companies']];
const productTabs=[['products','All products'],['collections','Collections'],['inventory','Inventory'],['transfers','Transfers'],['categories','Categories and tags']];
const settingsTabs=[['settings','Business profile'],['billing','Billing and renewals'],['notifications','Notifications'],['security','Sign-in and support'],['account-data','Account data and privacy'],['connectors','AI connectors']];
const settingPages={
  payments:['Payments','Configure how sample online orders are paid.',[['Provider','provider','select',['Test gateway','Manual payments','None']],['Capture payments','capture','select',['Automatic','Manual']],['Cash on delivery','cod','select',['Disabled','Enabled']],['Payment instructions','instructions','textarea']]],
  taxes:['Taxes and duties','Set the tax defaults for the preview store.',[['Tax region','region','text'],['Default tax rate (%)','rate','number'],['Product prices','inclusive','select',['Include tax','Exclude tax']],['Registration reference','registration','text']]],
  languages:['Languages','Set the storefront language and formatting defaults.',[['Primary language','language','select',['English','Hindi','French','Spanish']],['Secondary language','secondary','select',['None','English','Hindi','French','Spanish']],['Date format','dateformat','select',['DD MMM YYYY','DD/MM/YYYY','YYYY-MM-DD']]]],
  policies:['Store policies','Draft policy copy for review.',[['Refunds','refunds','textarea'],['Shipping','shipping','textarea'],['Terms of service','terms','textarea'],['Privacy policy','privacy','textarea']]],
  'privacy-settings':['Customer privacy','Configure the preview consent experience.',[['Cookie banner','banner','select',['Enabled','Disabled']],['Analytics consent','analytics','select',['Ask first','Disabled']],['Marketing consent','marketing','select',['Ask first','Disabled']],['Privacy request email','email','email']]],
};
const productLabel=p=>'<div class="cell-product">'+image(p.image,'','thumb')+'<a class="rowlink" href="'+pathFor('products/'+encodeURIComponent(p.id))+'">'+esc(p.name)+'</a></div>';
const metric=(name,value,foot)=>'<div class="metric"><span>'+name+'</span><strong>'+value+'</strong><span>'+foot+'</span></div>';
const input=(label,name,value='',type='text',props='')=>'<label>'+label+'<input type="'+type+'" name="'+name+'" value="'+esc(value)+'" '+props+'></label>';
const area=(label,name,value='',props='')=>'<label class="wide">'+label+'<textarea name="'+name+'" '+props+'>'+esc(value)+'</textarea></label>';
const select=(label,name,options,value,props='')=>'<label>'+label+'<select name="'+name+'" '+props+'>'+options.map(option=>{const [id,title]=Array.isArray(option)?option:[option,option];return '<option value="'+esc(id)+'"'+(String(id)===String(value)?' selected':'')+'>'+esc(title)+'</option>';}).join('')+'</select></label>';
const dateValue=value=>new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(value+'T00:00:00Z'));
const balances=p=>state.stockLocations[p.id]||{[state.locations[0]?.id||'l1']:p.stock};
const getLocation=id=>state.locations.find(l=>l.id===id)?.name||'Location';
const moveHistory=(product,location,units,reason)=>state.stockHistory.unshift({id:uid(),product,location,units,reason,date:now()});
function putBalance(p,location,amount){
  const quantities=state.stockLocations[p.id]||={...balances(p)};
  quantities[location]=amount;
  p.stock=Object.values(quantities).reduce((sum,x)=>sum+x,0);
}
function changeDefaultBalance(p,units){
  const location=state.locations[0]?.id||'l1';
  putBalance(p,location,(balances(p)[location]||0)+units);
}
const status=value=>badge(value,['Pending','Requested','Unfulfilled','Pending review'].includes(value)?'warn':value==='Draft'||value==='Archived'?'neutral':'');
const editForm=(key,id,fields,label='Save')=>'<form data-form="edit" data-key="'+key+'" data-id="'+esc(id||'')+'"><div class="field-grid">'+fields+'</div><div class="actions"><button class="btn primary">'+label+'</button>'+button('Cancel','close-dialog')+'</div></form>';
const bulkKinds=['orders','products','inventory','customers','collections'];
const bulkBar=()=>'<div id="bulk-bar" class="bulk-bar" hidden><strong id="bulk-count" role="status"></strong>'+button('Bulk edit','bulk-edit','compact')+button('Clear selection','bulk-clear','compact')+'</div>';
const allCheckbox='<input type="checkbox" id="select-all" aria-label="Select all visible records">';
const rowCheckbox=(item,label)=>'<input type="checkbox" name="bulk-record" value="'+esc(item.id)+'" aria-label="Select '+esc(label)+'">';
const mainList=(title,kind,placeholder,filters=[])=>panel(title,'<div class="filters"><input id="table-query" type="search" aria-label="'+placeholder+'" placeholder="'+placeholder+'">'+(filters.length?'<select id="table-status" aria-label="Filter by status">'+filters.map(f=>'<option>'+f+'</option>').join('')+'</select>':'')+'<small id="table-count"></small></div>'+(bulkKinds.includes(kind)?bulkBar():'')+'<div id="table-results">'+renderList(kind,queryFromHash(),'All')+'</div>');
const queryFromHash=()=>new URLSearchParams(location.hash.split('?')[1]||'').get('q')||'';
function renderList(kind,query,filter){
  const find=x=>JSON.stringify(x).toLowerCase().includes(query.toLowerCase().trim())&&(filter==='All'||[x.status,x.payment,x.category].includes(filter));
  if(kind==='products'||kind==='inventory'){
    const items=state.products.filter(find);
    if(kind==='inventory')return table([allCheckbox,'Product','SKU','Available','Locations',''],items.map(p=>[rowCheckbox(p,p.name),productLabel(p),esc(p.sku),p.stock,Object.entries(balances(p)).map(([id,n])=>'<div>'+esc(getLocation(id))+': '+n+'</div>').join(''),button('Adjust','adjust:'+p.id,'compact')]));
    return table([allCheckbox,'Product','Category','Status','Price','Available'],items.map(p=>[rowCheckbox(p,p.name),productLabel(p),esc(p.category||'Uncategorized'),status(p.status),money(p.price),p.stock]));
  }
  if(kind==='orders'||kind==='drafts'){
    const items=state.orders.filter(o=>kind==='drafts'?o.status==='Draft':o.status!=='Draft').filter(find);
    const selection=kind==='orders'&&location.hash.split('?')[0]==='#/orders';
    return table([...(selection?[allCheckbox]:[]),'Order','Date','Customer','Channel','Total','Payment','Fulfillment','Items','Delivery'],items.map(o=>[...(selection?[rowCheckbox(o,'order #'+o.id)]:[]),'<a class="rowlink" href="'+pathFor('orders/'+o.id)+'">#'+esc(o.id)+'</a>',dateValue(o.date),esc(o.customer),esc(o.channel),money(o.total),status(o.payment),status(o.status),o.quantity??1,o.deliveredOn?status('Delivered'):esc(o.deliveryMethod||'—')]));
  }
  if(kind==='customers')return table([allCheckbox,'Customer','Email','City','Marketing','Orders'],state.customers.filter(find).map(c=>[rowCheckbox(c,c.name),button(esc(c.name),'edit:customers:'+c.id,'compact'),esc(c.email),esc(c.city),status(c.status),state.orders.filter(o=>o.customer===c.name&&o.status!=='Draft').length]));
  return '';
}
function launchRows(){
  return apps.map(a=>'<div class="launch"><span class="avatar">'+a.name.split(/\s+/).map(w=>w[0]).join('').slice(0,2)+'</span><div class="info"><strong>'+a.name+'</strong><small>'+a.detail+'</small></div>'+link('Open',a.local,'compact')+'</div>').join('');
}
const totals=()=>{const paid=state.orders.filter(o=>o.payment==='Paid'&&o.status!=='Draft');return {revenue:paid.reduce((s,o)=>s+o.total,0),orders:paid.length,sessions:state.campaigns.reduce((s,c)=>s+(+c.sessions||0),0),leads:state.campaigns.reduce((s,c)=>s+(+c.leads||0),0)};};
let reportRange='30';
const businessDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'});
function seriesFor(records){
  const series=new Map();
  records.forEach(([date,value])=>{if(date)series.set(date,(series.get(date)||0)+Number(value||0));});
  return [...series.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,value])=>value);
}
function sparkline(values){
  const series=values.length>1?values:[0,...(values.length?values:[0])];
  const peak=Math.max(1,...series);
  const points=series.map((value,index)=>(index*64/(series.length-1)).toFixed(1)+','+(22-20*value/peak).toFixed(1)).join(' ');
  return '<svg class="sparkline" viewBox="0 0 64 24" aria-hidden="true"><polyline points="'+points+'" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" /></svg>';
}
const summary=(name,value,values)=>'<div class="summary-cell"><span>'+name+'</span><strong>'+value+'</strong>'+(values?sparkline(values):'')+'</div>';
function orderMetrics(){
  const today=businessDate.format(new Date());
  const first=reportRange==='all'?'0000-00-00':new Date(Date.parse(today+'T00:00Z')-(Number(reportRange)-1)*86400000).toISOString().slice(0,10);
  const inRange=date=>date&&date>=first&&date<=today;
  const orders=state.orders.filter(o=>o.status!=='Draft');
  const rows=orders.filter(o=>inRange(o.date));
  const daysFor=(field,value,weight=()=>1)=>orders.map(order=>[order[field]||(order.status===value||order.payment===value?order.date:''),weight(order)]).filter(([date])=>inRange(date));
  const numbers=(name,records,currency=false)=>{const values=seriesFor(records),sum=values.reduce((a,b)=>a+b,0);return summary(name,currency?money(sum):sum,values);};
  return '<div class="summary-bar"><label class="summary-period">Reporting period<select id="report-range">'+[['1','Today'],['7','Last 7 days'],['30','Last 30 days'],['all','All time']].map(([value,label])=>'<option value="'+value+'"'+(value===reportRange?' selected':'')+'>'+label+'</option>').join('')+'</select></label>'+
    numbers('Orders',rows.map(o=>[o.date,1]))+numbers('Items ordered',rows.map(o=>[o.date,o.quantity??1]))+numbers('Sales reversals',daysFor('refundedOn','Refunded',o=>o.total),true)+numbers('Orders fulfilled',daysFor('fulfilledOn','Fulfilled'))+numbers('Orders delivered',daysFor('deliveredOn','Delivered'))+'</div>';
}
function sectionMetrics(id){
  const products=state.products, orders=state.orders.filter(o=>o.status!=='Draft'), customers=state.customers;
  const aggregate={
    products:[['Products',products.length],['Active',products.filter(p=>p.status==='Active').length],['Draft or archived',products.filter(p=>p.status!=='Active').length]],
    inventory:[['Units available',products.reduce((total,p)=>total+p.stock,0)],['Low stock',products.filter(p=>p.stock>0&&p.stock<5).length],['Out of stock',products.filter(p=>p.stock===0).length]],
    collections:[['Collections',state.collections.length],['Online',state.collections.filter(collectionVisible).length],['Smart',state.collections.filter(c=>c.type==='Smart').length]],
    customers:[['Customers',customers.length],['Subscribed',customers.filter(c=>c.status==='Subscribed').length],['Repeat buyers',customers.filter(c=>orders.filter(o=>o.customer===c.name).length>1).length]],
    returns:[['Requests',state.returns.length],['Open',state.returns.filter(r=>r.status!=='Closed').length],['Refunded',orders.filter(o=>o.payment==='Refunded').length]],
    growth:[['Sessions',totals().sessions,state.campaigns.map(c=>c.sessions)],['Leads',totals().leads,state.campaigns.map(c=>c.leads)],['Attributed orders',state.campaigns.reduce((total,c)=>total+Number(c.orders||0),0),state.campaigns.map(c=>c.orders)]],
  }[id];
  return aggregate?'<section class="summary-bar" aria-label="Page metrics">'+aggregate.map(([label,value,values])=>summary(label,value,values)).join('')+'</section>':'';
}
function chart(){
  const max=Math.max(1,...state.campaigns.map(c=>+c.sessions||0));
  return '<div class="chart" role="img" aria-label="Sessions by acquisition source">'+state.campaigns.map(c=>'<div><i style="height:'+Math.max(2,Math.round((+c.sessions||0)/max*82))+'%" title="'+esc(c.sessions+' sessions')+'"></i><span>'+esc(c.source)+'</span></div>').join('')+'</div>';
}
function home(){
  const t=totals(),pending=state.orders.filter(o=>o.status==='Unfulfilled').length;
  return head(esc(state.business.name),'Manage your sales, inventory, store, and team.',wl('Customize website','builder')+wl('Add product','products/new','primary'))+
    '<div class="metrics">'+metric('Sales',money(t.revenue),'Paid orders in this preview')+metric('To fulfill',pending,'Across store and counter')+metric('Website sessions',t.sessions.toLocaleString('en-IN'),'Sample campaign traffic')+metric('Stock alerts',state.products.filter(p=>p.stock<5).length,'Fewer than five available')+'</div>'+
    '<div class="cols">'+panel('Acquisition by source',chart()+body(wl('View analytics','analytics','compact')))+panel('Needs attention',body('<div class="stack">'+wl(pending+' unfulfilled orders','orders')+wl(state.returns.filter(r=>r.status!=='Closed').length+' open returns','returns')+wl('Review inventory','inventory')+'</div>'))+'</div>'+
    panel('Recent orders',renderList('orders','','All'),wl('All orders','orders','compact'))+panel('Operational apps',body(launchRows()),wl('Apps and plans','apps','compact'));
}
function ordersPage(id){
  const title=id==='drafts'?'Draft orders':id==='returns'?'Returns':id==='shipping'?'Shipping':id==='abandoned-checkouts'?'Abandoned checkouts':'Orders';
  let view='';
  if(id==='returns'){
    view=panel('Return requests',table(['Request','Order','Reason','Status',''],state.returns.map(r=>[esc(r.id),'#'+esc(r.order),esc(r.reason),status(r.status),button('Review','return:'+r.id,'compact')])));
  }else if(id==='shipping'){
    view=panel('Delivery methods',table(['Method','Region','Rate',''],state.shipping.map(s=>[esc(s.name),esc(s.region),money(s.price),button('Edit','edit:shipping:'+s.id,'compact')])));
  }else if(id==='abandoned-checkouts'){
    const rows=state.abandonedCheckouts;
    return head(title,'Review sample unfinished checkouts and turn one into a draft order.')+tabs(id,orderTabs)+
      '<section class="summary-bar" aria-label="Checkout recovery metrics">'+summary('Abandoned',rows.length)+summary('Draft orders created',rows.filter(r=>r.order).length)+'</section>'+
      panel('Checkouts',table(['Reference','Customer','Product','Date','Recovery'],rows.map(r=>[esc(r.id),esc(r.customer),esc(state.products.find(p=>p.id===r.product)?.name||'Unavailable'),dateValue(r.date),r.order?wl('View draft #'+esc(r.order),'orders/'+encodeURIComponent(r.order),'compact'):button('Recover as draft','recover-checkout:'+r.id,'compact')])));
  }else view=mainList(title,id,'Search by order or customer',['All','Paid','Pending','Unfulfilled','Fulfilled','Cancelled','Refunded']);
  return head(title,'Manage online orders, delivery, and after-sales requests.',id==='returns'?button('New return','new-return','primary'):id==='shipping'?button('Add delivery method','edit:shipping','primary'):(id==='orders'?button('Export CSV','export-orders'):'')+button('Create draft order','edit:orders','primary'))+tabs(id,orderTabs)+(id==='orders'?'<div id="order-metrics">'+orderMetrics()+'</div>':sectionMetrics(id))+view;
}
const availableActions=o=>{
  const actions=[];
  if(o.status==='Draft')actions.push(button('Create order','order-step:'+o.id+':open','primary'));
  else if(!['Cancelled','Returned'].includes(o.status)){
    if(o.payment==='Pending')actions.push(button('Record sample payment','order-step:'+o.id+':paid'));
    if(o.status==='Unfulfilled')actions.push(button('Fulfill','order-step:'+o.id+':fulfill','primary'),button('Cancel order','confirm-cancel:'+o.id));
    if(o.status==='Fulfilled')actions.push(button('Create return','new-return:'+o.id,'primary'));
  }
  return actions.join('');
};
const logOrder=(o,label)=>(o.timeline||=[]).unshift({id:uid(),label,at:new Date().toISOString()});
function orderDetail(id){
  const o=state.orders.find(x=>x.id===id);
  if(!o)return head('Order unavailable','This sample order could not be found.',wl('All orders','orders'));
  const returns=state.returns.filter(r=>r.order===id);
  const summary=panel('Payment summary',body('<div class="stack"><div class="launch"><div class="info">Order total</div><strong>'+money(o.total)+'</strong></div><div class="launch"><div class="info">Payment</div>'+status(o.payment)+'</div><div class="launch"><div class="info">Fulfillment</div>'+status(o.status)+'</div></div>'));
  const items=panel('Items',table(['Product','Quantity','Total'],[[esc(o.item),o.quantity||1,money(o.total)]]));
  const activity=panel('Timeline',body('<div class="stack">'+(o.timeline||[]).map(event=>'<div class="launch"><div class="info"><strong>'+esc(event.label)+'</strong><small>'+esc(new Date(event.at).toLocaleString('en-IN'))+'</small></div></div>').join('')+'<div class="launch"><div class="info"><strong>'+esc(o.channel==='Draft orders'?'Draft created':'Order created')+'</strong><small>'+dateValue(o.date)+'</small></div></div></div>'));
  const fulfillment=panel('Fulfillment and returns',body('<p>'+esc(o.tracking?'Tracking reference · '+o.tracking:'Tracking reference will appear when added.')+'</p>'+returns.map(r=>'<div class="launch"><div class="info">'+esc(r.id)+' · '+esc(r.reason)+'</div>'+status(r.status)+button('Open return','return:'+r.id,'compact')+'</div>').join('')));
  return head('Order #'+esc(o.id),dateValue(o.date)+' · '+esc(o.channel),availableActions(o),['orders','Orders'])+'<div class="record-layout"><div>'+items+summary+fulfillment+activity+'</div><aside>'+panel('Customer',body('<strong>'+esc(o.customer)+'</strong><p class="compact-copy">'+esc(state.customers.find(c=>c.name===o.customer)?.email||'No email on this sample order')+'</p>'))+panel('Order notes',body(editForm('order-note',o.id,area('Internal note','note',o.note,'maxlength="1500"'),'Save note')))+'</aside></div>';
}
function productsPage(id){
  const title=productTabs.find(([key])=>key===id)[1];let view='';
  if(id==='collections') view=panel('All collections','<div class="filters"><input id="collection-query" type="search" aria-label="Search collections" placeholder="Search collections"><select id="collection-type" aria-label="Filter collection type"><option>All types</option><option>Manual</option><option>Smart</option></select><select id="collection-channel" aria-label="Filter collection availability"><option>All availability</option><option>Online store</option><option>Unpublished</option></select></div>'+bulkBar()+'<div id="collection-results">'+collectionList()+'</div>');
  else if(id==='categories')view='<div class="cols">'+panel('Categories',body('<div class="stack">'+state.categories.map(c=>'<div class="launch"><div class="info">'+esc(c)+'</div>'+badge(state.products.filter(p=>p.category===c).length+' products')+'</div>').join('')+'</div>'))+panel('Tags in use',body('<div class="inline">'+[...new Set(state.products.flatMap(p=>p.tags.split(',').map(t=>t.trim()).filter(Boolean)))].map(t=>badge(t)).join('')+'</div>'))+'</div>';
  else if(id==='transfers')view=panel('Inventory transfers',table(['Transfer','Product','From','To','Units','Status',''],state.transfers.map(t=>[esc(t.ref),esc(state.products.find(p=>p.id===t.product)?.name),esc(getLocation(t.from)),esc(getLocation(t.to)),t.units,status(t.status),t.status==='In transit'?button('Receive','receive-stock:'+t.id,'compact'):badge('Received')])));
  else view=mainList(title,id,id==='inventory'?'Search stock or SKU':'Search products or SKU',id==='products'?['All','Active','Draft','Archived']:[]);
  if(id==='inventory')view+=panel('Stock adjustment history',table(['Date','Product','Location','Change','Reason'],state.stockHistory.map(h=>[dateValue(h.date),esc(state.products.find(p=>p.id===h.product)?.name),esc(getLocation(h.location)),(h.units>0?'+':'')+h.units,esc(h.reason)])));
  const actions=id==='products'?button('Export CSV','export-products')+wl('Add product','products/new','primary'):id==='inventory'?button('Export CSV','export-products')+wl('View transfers','transfers'):id==='collections'?wl('Create collection','collections/new','primary'):id==='transfers'?button('Create transfer','transfer','primary'):button('Add category','category','primary');
  return head(title,'Organize the catalog across storefront sections and linked apps.',actions)+tabs(id,productTabs)+sectionMetrics(id)+view;
}
const matchingProducts=c=>collectionProducts(c,state.products,state.orders);
const collectionSorts=['Manual','Title A–Z','Title Z–A','Price low to high','Price high to low','Best selling'];
const collectionPath=id=>pathFor('collections/'+encodeURIComponent(id));
function collectionList(query='',type='All types',channel='All availability'){
  return table([allCheckbox,'Collection','Products','Type','Availability','Conditions'],state.collections.filter(c=>
    c.name.toLowerCase().includes(query.trim().toLowerCase())&&(type==='All types'||type===(c.type||'Manual'))&&
    (channel==='All availability'||(channel==='Online store'?collectionVisible(c):!collectionVisible(c)))
  ).map(c=>[
    rowCheckbox(c,c.name),'<div class="cell-product">'+image(c.image,'','thumb')+'<a class="rowlink" href="'+collectionPath(c.id)+'">'+esc(c.name)+'</a></div>',
    matchingProducts(c).length,esc(c.type||'Manual'),badge(collectionVisible(c)?'Online store':c.publishAt&&(c.channels||[]).includes('Online store')?'Scheduled':'Unpublished'),
    esc((c.rules||[]).map(r=>r.field+' '+r.value).join(', ')||'—')
  ]));
}
function conditionRow(rule={}){
  return '<div class="collection-condition">'+select('Product field','ruleField',[['name','Title'],['category','Category'],['tags','Tag'],['type','Product type'],['vendor','Vendor'],['price','Price'],['stock','Available stock'],['status','Status']],rule.field)+
    select('Operator','ruleOperator',[['eq','Equals'],['neq','Does not equal'],['contains','Contains'],['gt','Greater than'],['lt','Less than']],rule.operator)+input('Value','ruleValue',rule.value)+button('Remove','remove-condition','compact')+'</div>';
}
function collectionDetail(id){
  const collection=state.collections.find(c=>c.id===id);
  if(!collection&&id!=='new')return head('Collection unavailable','This collection could not be found.',wl('Collections','collections'));
  const c=collection||{type:'Manual',products:[],channels:['Online store']};
  const memberIds=c.products||[];
  const picker=[...memberIds.map(id=>state.products.find(p=>p.id===id)).filter(Boolean),...state.products.filter(p=>!memberIds.includes(p.id))].map(p=>'<div class="collection-pick"><label class="inline"><input type="checkbox" name="members" value="'+esc(p.id)+'"'+(memberIds.includes(p.id)?' checked':'')+'>'+esc(p.name)+'</label>'+button('↑','collection-up','compact')+button('↓','collection-down','compact')+'</div>').join('');
  const membership='<div id="collection-manual"'+(c.type==='Smart'?' hidden':'')+'><p class="compact-copy">Choose products and use the move controls to set their manual order.</p><div class="stack">'+picker+'</div></div>'+
    '<div id="collection-smart"'+(c.type==='Smart'?'':' hidden')+'>'+select('Products must match','match',['All','Any'],c.match)+'<div id="condition-rows" class="stack">'+((c.rules||[]).length?c.rules:[{}]).map(conditionRow).join('')+'</div>'+button('Add condition','add-condition','compact')+'</div>'+
    '<details class="collection-exclusions"><summary>Exclude products</summary><div class="stack">'+state.products.map(p=>'<label class="inline"><input type="checkbox" name="excluded" value="'+esc(p.id)+'"'+((c.excluded||[]).includes(p.id)?' checked':'')+'>'+esc(p.name)+'</label>').join('')+'</div></details>';
  const settings=panel('Publishing',body('<div class="stack">'+['Online store','AUZsStyle'].map(name=>'<label class="inline"><input type="checkbox" name="channels" value="'+name+'"'+((c.channels||['Online store']).includes(name)?' checked':'')+'>'+name+'</label>').join('')+input('Publish online on','publishAt',c.publishAt,'datetime-local')+select('Theme template','template',['Default collection','Editorial grid'],c.template)+'</div>'))+
    panel('Collection image',body(image(c.image,c.name,'collection-cover')+input('Cover image URL','image',c.image)));
  const seo=panel('Search engine listing',body('<div class="muted-box"><strong>'+esc(c.seoTitle||c.name||'Collection title')+'</strong><p>'+esc(c.seoDescription||c.description||'')+'</p></div><div class="field-grid">'+input('Page title','seoTitle',c.seoTitle,'text','maxlength="70"')+input('URL handle','handle',c.handle,'text','pattern="[a-z0-9-]+"')+area('Search description','seoDescription',c.seoDescription,'maxlength="160"')+'</div>'));
  const actions=collection?button('Duplicate','duplicate-collection:'+id)+ (collectionVisible(c)?link('View collection','/store.html?template='+state.builder.theme+'#/shop?col='+encodeURIComponent(id)):''):'';
  return head(collection?esc(c.name):'Create collection','Set its products, publishing, and storefront details.',actions,['collections','Collections'])+
    '<form data-form="edit" data-key="collection-record" data-id="'+esc(collection?.id||'')+'"><div class="record-layout"><div>'+
    panel('Collection details',body('<div class="field-grid">'+input('Title','name',c.name,'text','required maxlength="120"')+select('Collection type','type',['Manual','Smart'],c.type||'Manual')+area('Description','description',c.description)+'</div>'))+
    panel('Products',body(select('Sort products','sort',collectionSorts,c.sort)+membership))+
    (collection?panel('Current products',table(['Product','Price','Stock'],matchingProducts(c).map(p=>[productLabel(p),money(p.price),p.stock]))):'')+seo+
    '</div><aside>'+settings+'</aside></div><div class="actions"><button class="btn primary">Save collection</button>'+wl('Cancel','collections')+'</div></form>';
}
const recordTabs=[['details','Details'],['media','Media'],['variants','Variants'],['channels','Sales channels'],['seo','Search listing'],['custom','Custom data']];
const recordHref=(id,tab)=>pathFor('products/'+encodeURIComponent(id)+'?tab='+tab);
const productChannels=['AUZsStyle','Online store','Salon'];
const checked=(label,name,value,on)=>'<label class="inline"><input type="checkbox" name="'+name+'" value="'+esc(value)+'"'+(on?' checked':'')+'>'+esc(label)+'</label>';
const grouped=(title,controls)=>panel(title,body('<div class="field-grid">'+controls+'</div>'));
const generatedLabel=row=>row.map(([key,value])=>key+': '+value).join(' / ');
function variantEditor(variants){
  return variants.length?table(['Combination','SKU','Barcode','Price (₹)','Stock'],variants.map((v,i)=>[
    esc(v.label)+'<input type="hidden" name="variantLabel'+i+'" value="'+esc(v.label)+'">',
    input('SKU for '+esc(v.label),'variantSku'+i,v.sku),input('Barcode for '+esc(v.label),'variantBarcode'+i,v.barcode),
    input('Price for '+esc(v.label),'variantPrice'+i,v.price,'number','required min="0" step="0.01"'),
    input('Stock for '+esc(v.label),'variantStock'+i,v.stock,'number','required min="0" step="1"')
  ])):'<p class="compact-copy">This product has no variants yet.</p>';
}
function mediaEditor(images,main){
  const photos=images.map((src,i)=>'<div class="product-photo">'+image(src,'Product image '+(i+1))+'<label class="inline"><input type="radio" name="mainIndex" value="'+i+'"'+(src===main||!main&&i===0?' checked':'')+'> Main image</label>'+button('Remove','product-remove-image:'+i,'compact')+'</div>');
  return photos.length?'<div class="media-grid">'+photos.join('')+'</div>':'<p class="compact-copy">Add up to six product images. Choose the image that appears on the storefront card.</p>';
}
function productEditor(p,r){
  const media=[...new Set([r.image,...(r.media||[])].filter(Boolean))];
  const channels=r.channels||['Online store','AUZsStyle'];
  const listings=state.collections.filter(c=>c.type!=='Smart');
  const sales=p?state.orders.filter(order=>order.product===p.id&&order.payment==='Paid'&&order.status!=='Draft'):[];
  const identity='<label class="wide">Product title<input name="name" required maxlength="120" value="'+esc(r.name)+'"></label>'+
    '<div class="wide"><div class="actions product-text-tools">'+button('Add bullet','product-bullet','compact')+button('Add line break','product-linebreak','compact')+'</div>'+area('Description','description',r.description,'maxlength="6000"')+'</div>';
  const numbers=input('Price in ₹','price',r.price??0,'number','min="0" step="0.01" required')+input('Compare-at price in ₹','compare',r.compare,'number','min="0" step="0.01"')+input('Cost per unit in ₹','cost',r.cost,'number','min="0" step="0.01"')+checked('Charge tax','taxable','yes',r.taxable!==false)+input('HSN or product tax code','taxCode',r.taxCode);
  const stock=input('SKU','sku',r.sku)+input('Barcode','barcode',r.barcode)+input('Available stock','stock',r.stock??0,'number','min="0" step="1" required')+checked('Track inventory','trackStock','yes',r.trackStock!==false)+checked('Continue selling when out of stock','backorders','yes',r.backorders===true);
  const shipping=checked('Physical product','physical','yes',r.physical!==false)+input('Weight in grams','weight',r.weight,'number','min="0" step="0.01"')+input('Country of origin','origin',r.origin);
  const organization=select('Category','category',['',...state.categories],r.category)+input('Product type','type',r.type)+input('Vendor or maker','vendor',r.vendor)+input('Tags','tags',r.tags);
  const seo=input('Page title','seoTitle',r.seoTitle,'text','maxlength="70"')+input('URL handle','handle',r.handle,'text','pattern="[a-z0-9-]+" placeholder="generated-from-title"')+area('Search description','seoDescription',r.seoDescription,'maxlength="160"');
  return '<form data-form="edit" data-key="product-record" data-id="'+esc(p?.id||'')+'" class="product-record"><div class="record-layout"><div>'+
    grouped('Product information',identity)+panel('Media',body('<div id="product-media-grid">'+mediaEditor(media,r.image)+'</div><textarea name="media" hidden>'+esc(media.join('\n'))+'</textarea><div class="field-grid media-add"><label>Upload images<input id="product-upload" type="file" accept="image/jpeg,image/png,image/webp" multiple></label><label>Image URL<div class="inline"><input name="imageUrl" type="url" placeholder="https://"><button class="btn compact" type="button" data-action="product-add-image">Add URL</button></div></label></div>'+input('Main image alt text','imageAlt',r.imageAlt)))+
    grouped('Pricing and tax',numbers)+grouped('Inventory',stock)+grouped('Shipping',shipping)+
    panel('Variants',body('<p class="compact-copy">Use any option type, such as Edition, Material, Size, or Colour.</p>'+area('Options and values','options',r.options,'placeholder="Material: Silver, Gold&#10;Size: Small, Large"')+'<div class="actions">'+button('Build variant grid','product-build-variants')+'</div><div class="product-variant-grid">'+variantEditor(r.variants||[])+'</div>'))+
    grouped('Search listing',seo)+(state.customFields.some(f=>f.target==='Product')?grouped('Custom data',state.customFields.filter(f=>f.target==='Product').map(f=>input(esc(f.name),'custom:'+f.id,r.custom?.[f.id])).join('')):'')+
    '</div><aside>'+panel('Status and publishing',body('<div class="stack">'+select('Catalog status','status',['Draft','Active','Archived'],r.status)+productChannels.map(ch=>checked(ch,'channels',ch,channels.includes(ch))).join('')+'</div>'))+
    grouped('Product organization',organization)+panel('Manual collections',body('<div class="stack">'+(listings.map(c=>checked(c.name,'collections',c.id,(c.products||[]).includes(p?.id))).join('')||'<p>No manual collections yet.</p>')+'</div>'))+
    (p?panel('Sales in this preview',body('<p>'+sales.reduce((sum,o)=>sum+(o.quantity??1),0)+' units sold</p><strong>'+money(sales.reduce((sum,o)=>sum+o.total,0))+'</strong>')):'')+
    '</aside></div><div class="product-save actions"><button class="btn primary">'+(p?'Save changes':'Create product')+'</button>'+wl('Cancel','products')+'</div></form>';
}
function productDetail(id){
  const p=state.products.find(x=>x.id===id);
  if(!p&&id!=='new')return head('Product unavailable','This product is no longer in the preview catalog.',wl('Back to products','products'));
  const r=p||{status:'Draft',custom:{},channels:['AUZsStyle'],media:[]};
  const candidate=new URLSearchParams(location.hash.split('?')[1]||'').get('tab');
  const tab=p&&recordTabs.some(([key])=>key===candidate)?candidate:'details';
  const fields=(key,html,label='Save changes')=>editForm(key,p?.id,html,label);
  const tabNav=p?'<nav class="tabs" aria-label="Product detail">'+recordTabs.map(([key,name])=>'<a href="'+recordHref(p.id,key)+'"'+(key===tab?' aria-current="page"':'')+'>'+name+'</a>').join('')+'</nav>':'';
  if(tab==='details')return head(p?esc(p.name):'Add product',p?'Manage product details, inventory, and storefront availability.':'Prepare the listing before publishing it.',p?(p.status==='Active'&&(p.channels||['Online store']).includes('Online store')?link('View product','/store.html?design=saved#/p/'+encodeURIComponent(p.id)):'')+button('Duplicate product','duplicate-product:'+p.id):'',['products','Products'])+tabNav+productEditor(p,r);
  let view='';
  if(tab==='media'){
    const existing=[...new Set([r.image,...(r.media||[])].filter(Boolean))];
    const images=existing.map((src,i)=>'<div>'+image(src,'Product image '+(i+1),src===r.image?'main-image':'')+(src===r.image?badge('Main image'):button('Set as main','main-image:'+p.id+':'+i,'compact'))+'</div>').join('');
    view=panel('Product media',body((images?'<div class="media-grid">'+images+'</div>':'<p class="compact-copy">Add images to this product.</p>')+'<div style="margin-top:15px">'+fields('product-media',area('Image URLs · one per line','media',existing.join('\n')),'Save images')+'</div>'));
  }else if(tab==='variants'){
    const variants=r.variants||[];
    view=panel('Variant options',body('<p class="compact-copy">Use the options your product needs, such as Metal, Capacity, Edition, Length, or Colour.</p>'+fields('product-options',area('Options and values','options',r.options,'placeholder="Metal: Silver, Gold&#10;Length: 16 inch, 18 inch"'),'Generate variants')))+
      panel('Variants',table(['Options','SKU','Price','Available',''],variants.map(v=>[esc(v.label),esc(v.sku),money(v.price),v.stock,button('Edit variant','variant:'+p.id+':'+v.id,'compact')])));
  }else if(tab==='channels'){
    const channels=r.channels||['AUZsStyle','Online store'];
    view=panel('Sales channels',body('<p class="compact-copy">Choose where an active product is shown.</p>'+fields('product-channels',['AUZsStyle','Online store','Salon'].map(name=>'<label class="inline"><input type="checkbox" name="channels" value="'+name+'"'+(channels.includes(name)?' checked':'')+'>'+name+'</label>').join(''),'Save availability')));
  }else if(tab==='seo'){
    view=panel('Search listing',body('<div class="muted-box"><small>'+esc(state.business.domain)+'/products/'+esc(r.handle||r.id)+'</small><h3>'+esc(r.seoTitle||r.name)+'</h3><p>'+esc(r.seoDescription||r.description||'')+'</p></div>'+fields('product-seo',input('Page title','seoTitle',r.seoTitle||r.name,'text','maxlength="70"')+input('URL handle','handle',r.handle||r.id,'text','required pattern="[a-z0-9-]+"')+area('Search description','seoDescription',r.seoDescription,'maxlength="160"'))));
  }else{
    view=panel('Product fields',body(fields('product-custom',state.customFields.filter(f=>f.target==='Product').map(f=>f.type==='Long text'?area(esc(f.name),f.id,r.custom?.[f.id]):input(esc(f.name),f.id,r.custom?.[f.id],f.type==='Number'?'number':f.type==='URL'?'url':f.type==='Date'?'date':'text')).join('')||'<p>No custom product fields have been defined.</p>')))+wl('Manage field definitions','data');
  }
  const quick=p?panel('Summary',body('<div class="stack">'+status(r.status)+'<strong>'+money(r.price)+'</strong><small>'+esc(r.stock)+' available · '+esc(r.sku||'No SKU')+'</small><small>'+esc(r.category||'Uncategorized')+'</small></div>'))+panel('Collections',body('<div class="stack">'+(state.collections.filter(c=>matchingProducts(c).some(product=>product.id===r.id)).map(c=>'<span>'+esc(c.name)+'</span>').join('')||'<p>No collections assigned.</p>')+wl('Manage collections','collections','compact')+'</div>')):'';
  return head(p?esc(p.name):'Add product',p?'Manage its listing, variants, inventory, and sales channels.':'Create a flexible catalog listing for any type of product.',p?button('Duplicate product','duplicate-product:'+p.id):'',['products','Products'])+tabNav+'<div class="record-layout"><div>'+view+'</div><aside>'+quick+'</aside></div>';
}
function growthPage(id){
  if(id==='discounts')return head('Discounts','Manage offers used by your storefront.',button('Create discount','edit:discounts','primary'))+tabs(id,[['growth','Campaigns'],['discounts','Discounts']])+panel('Discounts',table(['Code','Type','Value','Status',''],state.discounts.map(d=>[esc(d.name),esc(d.type),d.type==='Percentage'?esc(d.value)+'%':money(d.value),status(d.status),button('Edit','edit:discounts:'+d.id,'compact')])));
  return head('Growth','Track the campaigns and channels bringing visitors, leads, and orders.',button('Create campaign','edit:campaigns','primary'))+
    tabs(id,[['growth','Campaigns'],['discounts','Discounts']])+sectionMetrics(id)+panel('Campaign performance',table(['Campaign','Source','Sessions','Leads','Orders','Status',''],state.campaigns.map(c=>[esc(c.name),esc(c.source),esc(c.sessions),esc(c.leads),esc(c.orders),status(c.status),button('Open','edit:campaigns:'+c.id,'compact')]))+body(wl('Compare sources','analytics','compact')));
}
function contentPage(id){
  const sub=[['content','Overview'],['pages','Pages and menus'],['files','Files'],['data','Custom data']];
  if(id==='pages')return head('Pages and menus','Create storefront pages and link them from navigation.',button('Add page','edit:pages','primary'))+tabs(id,sub)+panel('Pages',table(['Page','URL handle','Visibility',''],state.pages.map(p=>[esc(p.name),esc(p.slug),status(p.status),button('Edit page','edit:pages:'+p.id,'compact')]))+body(button('Configure menu','store-menu')));
  if(id==='files')return head('Files','Manage images and documents in this local media library.',button('Add file','file','primary'))+tabs(id,sub)+panel('Media library',table(['File','Type','Size'],state.files.map(f=>[esc(f.name),esc(f.type),Math.ceil(f.size/1024)+' KB'])));
  if(id==='data')return head('Custom data','Define reusable fields for different types of businesses.',button('Add field','edit:customFields','primary'))+tabs(id,sub)+panel('Field definitions',table(['Name','Applies to','Value type',''],state.customFields.map(f=>[esc(f.name),esc(f.target),esc(f.type),button('Edit','edit:customFields:'+f.id,'compact')])));
  return head('Content','Manage the files, page copy, and structured data that feed your site.')+tabs(id,sub)+panel('Website content',body('<div class="stack">'+wl('Pages and menus','pages')+wl('Media files','files')+wl('Custom data','data')+'</div>'));
}
function storePages(id){
  const page=state.pages.find(page=>page.id===id);
  const back=['store-pages','Pages'];
  if(id){
    if(!page&&id!=='new')return head('Page unavailable','This page could not be found.',wl('Pages','store-pages'));
    const value=page||{status:'Hidden'};
    const visibility=select('Visibility','status',['Hidden','Visible','Scheduled'],value.status)+input('Publish on','publishAt',value.publishAt,'datetime-local')+select('Page template','template',['Default','Editorial','Contact'],value.template)+checked('Add this page to store navigation','inMenu','yes',value.inMenu);
    return head(esc(page?.name||'Add page'),'Edit content, visibility, and how the page appears in search.',page?link('Preview page','/store.html?design=page-preview#/page/'+encodeURIComponent(page.slug)):'',back)+
      '<form data-form="edit" data-key="store-page" data-id="'+esc(page?.id||'')+'"><div class="record-layout"><div>'+
      grouped('Page content',input('Page title','name',value.name,'text','required maxlength="120"')+area('Content','content',value.content,'maxlength="10000"')+input('Cover image URL','image',value.image,'url'))+
      grouped('Search listing',input('Search title','seoTitle',value.seoTitle,'text','maxlength="70"')+input('URL handle','slug',value.slug,'text','pattern="[a-z0-9-]+"')+area('Search description','seoDescription',value.seoDescription,'maxlength="160"'))+
      '</div><aside>'+grouped('Publishing',visibility)+'</aside></div><div class="actions"><button class="btn primary">Save page</button>'+wl('Cancel','store-pages')+'</div></form>';
  }
  return head('Pages','Manage the content customers see on your online store.',wl('Add page','store-pages/new','primary'),['website','Online store'])+
    panel('Store pages','<div class="filters"><input id="page-query" type="search" aria-label="Search pages" placeholder="Search pages">'+select('Visibility','pageVisibility',['All','Visible','Hidden','Scheduled'],'All')+'</div><div id="page-results">'+storePageRows()+'</div>');
}
function storePageRows(query='',visibility='All'){
  return table(['Title','Visibility','Template','Updated'],state.pages.filter(page=>(visibility==='All'||page.status===visibility)&&page.name.toLowerCase().includes(query.trim().toLowerCase())).map(page=>[
    wl(esc(page.name),'store-pages/'+encodeURIComponent(page.id),'compact'),status(page.status),esc(page.template||'Default'),page.updatedOn?dateValue(page.updatedOn):'—'
  ]));
}
function websitePage(id){
  const ws=[['website','Store overview'],['builder','Theme editor'],['templates','Themes'],['store-pages','Pages'],['domains','Domains'],['checkout','Checkout and accounts']];
  if(id==='templates'){
    return head('Themes','Customize an unpublished theme before making it the current storefront design.',link('Browse public gallery','/themes.html'))+tabs(id,ws)+
      libraryPanels();
  }
  if(id==='domains')return domainPage();
  if(id==='checkout'){
    const config=state.checkout;
    const fields=input('Checkout heading','heading',config.heading,'text','required maxlength="120"')+input('Accent colour','accent',config.accent,'color')+select('Contact method','contact',['Email','Email or phone'],config.contact)+select('Guest checkout','guest',['Enabled','Account required'],config.guest)+area('Order confirmation text','confirmation',config.confirmation);
    return head('Checkout and accounts','Control checkout appearance, customer sign-in, and confirmation copy in this sample configuration.')+tabs(id,ws)+'<div class="cols">'+panel('Checkout settings',body(editForm('checkout',null,fields,'Save checkout draft')))+panel('Customer preview',body('<div class="muted-box"><h3>'+esc(config.heading)+'</h3><p>'+esc(config.guest)+' · '+esc(config.contact)+'</p></div><div class="stack"><label>Contact<input placeholder="'+esc(config.contact)+'" disabled></label><label>Delivery address<input placeholder="Shipping address" disabled></label><label>Payment<input placeholder="Test order preview" disabled></label><button class="btn primary" type="button" disabled style="background:'+esc(/^#[\da-f]{6}$/i.test(config.accent)?config.accent:'#214d3a')+'">Pay now</button><p>'+esc(config.confirmation)+'</p></div>'))+'</div>';
  }
  const template=templates.find(t=>t.id===state.builder.theme)||templates[0];
  const library=themeLibrary(),current=library.entries[library.published];
  return head('Online store','Design the website, organize its pages, and manage online sales.',link('View website','/store.html?design=saved#/')+wl('Customize',editorRoute(current.id),'primary'))+tabs(id,ws)+
    '<div class="cols">'+panel('Current preview theme','<div class="tile-img">'+image(template.image,current.name)+'</div>'+body('<h3>'+esc(current.name)+'</h3><p>'+template.description+'</p><div class="actions" style="margin-top:12px">'+wl('Open theme editor',editorRoute(current.id),'primary')+wl('Browse themes','templates')+'</div>'))+
    panel('Store operations',body('<div class="stack">'+wl('Online orders','orders')+wl('Returns','returns')+wl('Pages','store-pages')+wl('Domains','domains')+link('AUZsStyle Online store controls','/style.html?demo=1#/store')+'</div>'))+'</div>';
}
function management(id){
  if(id==='consoles')return head('Admin and Careers','Open the existing AUZslab platform console or Careers page.')+
    panel('Platform admin',body('<p class="compact-copy">Use the existing platform console for tenant administration, licences, billing, and approvals.</p>'+external('Open platform admin','https://auzslab.in/admin.html')))+
    panel('Careers',body('<p class="compact-copy">Candidates apply through the existing AUZslab Careers page.</p>'+external('Open AUZslab Careers','https://auzslab.in/careers.html')));
  if(settingPages[id]){
    const [title,description,fields]=settingPages[id],draft=state.settingsDrafts[id]||{};
    const controls=fields.map(([label,key,type,options])=>type==='select'?select(label,key,options,draft[key]):type==='textarea'?area(label,key,draft[key]):input(label,key,draft[key],type,type==='number'?'min="0" max="100" step="0.01"':'')).join('');
    return head(title,description,'',['settings','Settings'])+panel(title,body(editForm('settings-draft',id,controls,'Save settings')));
  }
  if(id==='apps')return head('Apps and plans','Open the tools your team uses and review subscription access.',wl('Billing and renewals','billing'))+panel('Retained apps',body(launchRows()));
  if(id==='roles'){
    const roleData=state.settingsDrafts.roles||{};
    return head('Roles','Manage sample business permissions by role.','',['team','Staff and access'])+tabs(id,[['team','Staff'],['roles','Roles'],['locations','Locations']])+
      panel('Role permissions',body(editForm('settings-draft','roles',select('Store manager · Catalog','catalog',['Edit','View','None'],roleData.catalog)+select('Store manager · Orders','orders',['Edit','View','None'],roleData.orders)+select('Staff · Stock','stock',['Edit','View','None'],roleData.stock)+select('Staff · Reports','reports',['None','View'],roleData.reports),'Save preview permissions')));
  }
  if(id==='team'||id==='locations'){
    const isStaff=id==='team';const sub=[['team','Staff'],['roles','Roles'],['locations','Locations']];
    return head(isStaff?'Staff and access':'Locations',isStaff?'Review staff roles and location access.':'Organize branches and stock locations.',button(isStaff?'Add staff':'Add location','edit:'+(isStaff?'staff':'locations'),'primary'))+tabs(id,sub)+
      panel(isStaff?'Staff':'Business locations',isStaff?table(['Name','Email','Role','Status',''],state.staff.map(s=>[esc(s.name),esc(s.email),esc(s.role),status(s.status),button('Edit','edit:staff:'+s.id,'compact')])):table(['Location','City','Status',''],state.locations.map(s=>[esc(s.name),esc(s.city),status(s.status),button('Edit','edit:locations:'+s.id,'compact')])))+
      (isStaff?panel('Permissions',body(wl('Manage roles','roles'))):'');
  }
  const h=settingsTabs.find(([key])=>key===id)[1];
  if(id==='notifications')return head(h,'Review account and store activity.',button('Mark all read','read-all'))+tabs(id,settingsTabs)+panel('Inbox',body(state.notifications.map(n=>'<div class="launch"><div class="info">'+esc(n.name)+'</div>'+badge(n.read?'Read':'New')+(!n.read?button('Mark read','read:'+n.id,'compact'):'')+'</div>').join('')));
  if(id==='billing')return head(h,'Review sample subscriptions, invoices, and billing contacts.')+tabs(id,settingsTabs)+panel('App access',body(launchRows()))+
    panel('Invoice history',table(['Invoice','Status','Amount'],[['Preview invoice','Sample record',money(0)]]))+
    panel('Renewal preferences',body(editForm('settings-draft','billing',input('Billing email','email',state.settingsDrafts.billing?.email||state.business.email,'email','required')+select('Renewal reminders','renewal',['Email','Off'],state.settingsDrafts.billing?.renewal),'Save renewal preferences')));
  if(id==='security')return head(h,'Review account access and support options.')+tabs(id,settingsTabs)+
    panel('Sign-in preferences',body(editForm('settings-draft','security',input('Recovery email','recovery',state.settingsDrafts.security?.recovery,'email')+select('Two-step sign-in','twoStep',['Preview off','Preview on'],state.settingsDrafts.security?.twoStep),'Save preview preferences')))+
    panel('Support',body(link('Contact support','/contact.html')));
  if(id==='account-data')return head(h,'Review consent, export sample account data, or record a local request.')+tabs(id,settingsTabs)+
    panel('Consent and preferences',body(editForm('settings-draft','account-data',select('Product updates','marketing',['Declined','Subscribed'],state.settingsDrafts['account-data']?.marketing),'Save preferences')))+
    panel('Data tools',body('<div class="actions">'+button('Export preview data','account-export')+link('Privacy policy','/privacy.html')+'</div>'))+
    panel('Privacy requests',body(editForm('privacy-request',null,select('Request type','kind',['Access','Correction','Delete','Withdraw consent'])+area('Request details','details','','maxlength="2000"'),'Save local request')))+
    panel('Request history',table(['Type','Date','Status'],(state.privacyRequests||[]).map(request=>[esc(request.kind),esc(request.date),'Saved in preview'])));
  if(id==='connectors')return head(h,'Configure sample access for the AI tools connected to your account.')+tabs(id,settingsTabs)+
    panel('Connector preferences',body(editForm('settings-draft','connectors',select('Connector access','access',['Disabled','Read-only','Propose draft orders'],state.settingsDrafts.connectors?.access),'Save preferences')));
  return head(h,'Update your business identity and preview preferences.')+tabs(id,settingsTabs)+panel('Business details',body(editForm('business',null,input('Business name','name',state.business.name,'text','required')+input('Contact name','contactName',state.business.contactName)+input('Email','email',state.business.email,'email','required')+input('Phone','phone',state.business.phone,'tel')+input('Desired subdomain','subdomain',state.business.subdomain,'text','pattern="[a-z0-9-]+"')+input('Business type','type',state.business.type)+input('Niche','niche',state.business.niche)+input('City','city',state.business.city)+area('Business address','address',state.business.address)+input('Number of outlets','outlets',state.business.outlets,'number','min="0"')+input('Number of staff','staffCount',state.business.staffCount,'number','min="0"')+select('Currency','currency',['INR'],state.business.currency)+input('Current software','currentSoftware',state.business.currentSoftware)+area('Onboarding notes','onboarding',state.business.onboarding),'Save profile')))+
    panel('Store settings',body('<div class="actions">'+[...Object.entries(settingPages).map(([key,[title]])=>wl(title,key)),wl('Shipping','shipping'),wl('Checkout and accounts','checkout'),wl('Domains','domains'),wl('Admin and SalesOS','consoles')].join('')+'</div>'));
}
function segmentsPage(){
  return head('Customer segments','Group customers by city and marketing preference.',button('Create segment','edit:segments','primary'))+tabs('segments',customerTabs)+panel('Saved segments',table(['Segment','City','Marketing','Matching customers',''],state.segments.map(s=>[
    esc(s.name),esc(s.city||'All cities'),esc(s.status||'Any preference'),state.customers.filter(c=>(!s.city||s.city.toLowerCase()===c.city.toLowerCase())&&(!s.status||s.status===c.status)).length,button('Edit','edit:segments:'+s.id,'compact')
  ])));
}
function companiesPage(id){
  const company=state.companies.find(item=>item.id===id);
  const back=['companies','Companies'];
  if(id){
    if(!company)return head('Company unavailable','This record could not be found.',wl('Companies','companies'));
    const contact=state.customers.find(c=>c.id===company.contact);
    const orders=state.orders.filter(order=>order.status!=='Draft'&&order.companyId===company.id);
    return head(esc(company.name),esc(company.city),button('Edit company','edit:companies:'+company.id,'primary'),back)+
      '<div class="cols">'+panel('Company details',body('<p>'+esc(company.address)+'</p><p>Payment terms · '+esc(company.terms)+'</p><p>Tax identifier · '+esc(company.taxId||'—')+'</p>'))+
      panel('Primary contact',body(contact?'<p>'+esc(contact.name)+'</p><p>'+esc(contact.email)+'</p>':'<p>No contact assigned.</p>'))+'</div>'+
      panel('Company orders',table(['Order','Total','Payment'],orders.map(o=>[wl('#'+esc(o.id),'orders/'+o.id,'compact'),money(o.total),status(o.payment)])));
  }
  return head('Companies','Manage business customers, billing addresses, contacts, and payment terms.',button('Add company','edit:companies','primary'))+tabs('companies',customerTabs)+
    panel('Companies',table(['Company','Primary contact','City','Payment terms'],state.companies.map(c=>[wl(esc(c.name),'companies/'+c.id,'compact'),esc(state.customers.find(p=>p.id===c.contact)?.name||'—'),esc(c.city),esc(c.terms)])));
}
function marketsPage(){
  return head('Markets','Define where the storefront sells and which language and currency each market displays.',button('Add market','edit:markets','primary'))+panel('Markets',table(['Market','Region','Currency','Language','Status',''],state.markets.map(m=>[esc(m.name),esc(m.region),esc(m.currency),esc(m.language),status(m.status),button('Edit','edit:markets:'+m.id,'compact')])));
}
export function workspace(id,record){
  if(['analytics','reports','live-view'].includes(id))return analyticsPage(id,record);
  let html;
  if(id==='home')html=home();
  else if(id==='orders'&&record)html=orderDetail(record);
  else if(orderTabs.some(([key])=>key===id))html=ordersPage(id);
  else if(id==='products'&&record)html=productDetail(record);
  else if(id==='collections'&&record)html=collectionDetail(record);
  else if(productTabs.some(([key])=>key===id))html=productsPage(id);
  else if(id==='customers')html=head('Customers','Find customer details, order history, and marketing preferences.',button('Add customer','edit:customers','primary'))+tabs(id,customerTabs)+sectionMetrics(id)+mainList('All customers','customers','Search customers',['All','Subscribed','Unsubscribed']);
  else if(id==='segments')html=segmentsPage();
  else if(id==='companies')html=companiesPage(record);
  else if(id==='markets')html=marketsPage();
  else if(['growth','discounts'].includes(id))html=growthPage(id);
  else if(['content','pages','files','data'].includes(id))html=contentPage(id);
  else if(id==='store-pages')html=storePages(record);
  else if(['website','templates','domains','checkout'].includes(id))html=websitePage(id);
  else html=management(id);
  if(queryFromHash()&&html.includes('id="table-query"'))html=html.replace('id="table-query"','id="table-query" value="'+esc(queryFromHash())+'"');
  return {html,dispatch:(type,target,event)=>dispatch(id,type,target,event)};
}

function fieldsFor(key,r){
  const name=(label='Name')=>input(label,'name',r.name,'text','required maxlength="120"');
  const number=(label,key,min=0)=>input(label,key,r[key]??0,'number','min="'+min+'" required');
  const statusOptions=(values)=>select('Status','status',values,r.status);
  switch(key){
    case 'products':return name('Product name')+select('Category','category',['',...state.categories],r.category)+input('SKU','sku',r.sku)+input('Tags','tags',r.tags)+number('Price in ₹','price')+number('Available stock','stock')+statusOptions(['Draft','Active','Archived'])+input('Product image URL','image',r.image)+area('Description','description',r.description)+area('Variant options','options',r.options,'placeholder="Material: Silver, Gold"');
    case 'collections':return name('Collection name')+input('Cover image URL','image',r.image)+area('Description','description',r.description)+'<fieldset class="wide"><legend>Products</legend><div class="stack">'+state.products.map(p=>'<label class="inline"><input type="checkbox" name="products" value="'+esc(p.id)+'"'+(r.products?.includes(p.id)?' checked':'')+'>'+esc(p.name)+'</label>').join('')+'</div></fieldset>';
    case 'orders':return input('Customer or walk-in','customer',r.customer,'text','required')+select('Company','companyId',[['','None'],...state.companies.map(c=>[c.id,c.name])],r.companyId)+select('Product','product',state.products.map(p=>[p.id,p.name+' · '+money(p.price)]),r.product)+input('Quantity','quantity',r.quantity||1,'number','min="1" max="999" required');
    case 'customers':return name('Customer name')+input('Email','email',r.email,'email')+input('Phone','phone',r.phone,'tel')+input('City','city',r.city)+statusOptions(['Unsubscribed','Subscribed']);
    case 'companies':return name('Company name')+select('Primary contact','contact',[['','None'],...state.customers.map(c=>[c.id,c.name])],r.contact)+input('City','city',r.city)+input('Tax identifier','taxId',r.taxId)+select('Payment terms','terms',['Due on order','Net 15','Net 30','Net 60'],r.terms)+area('Billing address','address',r.address);
    case 'segments':return name('Segment name')+input('City','city',r.city)+select('Marketing preference','status',[['','Any'],'Subscribed','Unsubscribed'],r.status);
    case 'markets':return name('Market name')+input('Country or region','region',r.region,'text','required')+select('Currency','currency',['INR','USD','GBP','EUR'],r.currency)+input('Language','language',r.language,'text','required')+statusOptions(['Draft','Active']);
    case 'campaigns':return name('Campaign name')+select('Source','source',['Instagram','Google','Email','WhatsApp','Facebook','Direct','Other'],r.source)+statusOptions(['Draft','Active','Completed'])+number('Sessions','sessions')+number('Leads','leads')+number('Orders','orders')+input('Landing page URL','url',r.url,'url');
    case 'discounts':return name('Code')+select('Type','type',['Percentage','Fixed amount'],r.type)+number('Value','value',1)+statusOptions(['Active','Draft','Archived']);
    case 'pages':return name('Page title')+input('URL handle','slug',r.slug,'text','required pattern="[a-z0-9-]+"')+statusOptions(['Visible','Hidden'])+area('Page content','content',r.content);
    case 'customFields':return name('Field name')+select('Applies to','target',['Product','Variant','Collection','Customer','Page'],r.target)+select('Value type','type',['Text','Long text','Number','Boolean','URL','Date'],r.type);
    case 'staff':return name('Staff name')+input('Email','email',r.email,'email','required')+select('Role','role',['Staff','Manager','Owner','Viewer'],r.role)+statusOptions(['Active','Inactive']);
    case 'locations':return name('Location name')+input('City','city',r.city,'text','required')+statusOptions(['Active','Inactive']);
    case 'shipping':return name('Delivery method')+input('Region','region',r.region,'text','required')+number('Charge in ₹','price');
    default:return '';
  }
}
const fieldTitles={products:'product',collections:'collection',orders:'draft order',customers:'customer',companies:'company',segments:'segment',markets:'market',campaigns:'campaign',discounts:'discount',pages:'page',customFields:'field',staff:'staff record',locations:'location',shipping:'delivery method'};
function combinations(input){
  const options=String(input).split('\n').map(line=>line.trim()).filter(Boolean).map(line=>{
    const separator=line.indexOf(':');
    if(separator<=0)throw Error('Add options as Name: Value 1, Value 2.');
    const name=line.slice(0,separator).trim();
    const values=[...new Set(line.slice(separator+1).split(',').map(v=>v.trim()).filter(Boolean))];
    if(!values.length)throw Error('Each option needs at least one value.');
    return [name,values];
  });
  if(new Set(options.map(([name])=>name.toLowerCase())).size!==options.length)throw Error('Use different names for each option.');
  const count=options.reduce((total,[,values])=>total*values.length,1);
  if(options.length>6||count>72)throw Error('Use up to 6 options and 72 combinations in this preview.');
  return options.length?options.reduce((rows,[name,values])=>rows.flatMap(row=>values.map(value=>[...row,[name,value]])),[[]]):[];
}
const formMedia=form=>[...new Set(form.elements.media.value.split('\n').filter(Boolean))];
function updateProductMedia(form,photos,main){
  form.elements.media.value=photos.join('\n');
  form.querySelector('#product-media-grid').innerHTML=mediaEditor(photos,photos.includes(main)?main:photos[0]);
}
async function uploadProductPhotos(control){
  const form=control.form,previous=formMedia(form),files=[...control.files];
  if(previous.length+files.length>6){control.value='';return flash('Add up to six product images.');}
  const saveButton=form.querySelector('.product-save button');
  control.disabled=saveButton.disabled=true;
  try{
    const photos=[];
    for(const file of files){
      if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024)throw Error('Choose JPG, PNG, or WebP files up to 10 MB each.');
      const bitmap=await createImageBitmap(file);
      try{
        const scale=Math.min(1,1100/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
        canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
        canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
        photos.push(canvas.toDataURL('image/webp',.75));
      }finally{bitmap.close();}
    }
    if(form.isConnected){
      const current=formMedia(form);
      if(current.length+photos.length>6)throw Error('Add up to six product images.');
      updateProductMedia(form,[...new Set([...current,...photos])],current[Number(new FormData(form).get('mainIndex'))]);
    }
  }catch(error){flash(error.message);}finally{control.value='';control.disabled=saveButton.disabled=false;}
}
function variantsFromForm(form,data,previous=[]){
  const savedByLabel=new Map(previous.map(v=>[v.label,v]));
  const editedByLabel=new Map([...form.querySelectorAll('[name^="variantLabel"]')].map(field=>[field.value,field.name.slice('variantLabel'.length)]));
  return combinations(data.get('options')||'').map((row,index)=>{
    const label=generatedLabel(row),saved=savedByLabel.get(label),edited=editedByLabel.get(label);
    const value=(name,fallback)=>edited!==undefined?data.get('variant'+name+edited):fallback;
    return {id:saved?.id||uid(),label,sku:value('Sku',saved?.sku??(data.get('sku')?data.get('sku')+'-'+(index+1):'')),barcode:value('Barcode',saved?.barcode||''),price:Number(value('Price',saved?.price??data.get('price'))),stock:Number(value('Stock',saved?.stock??(index===0&&!previous.length?data.get('stock'):0)))};
  });
}
function saveProductRecord(form,values,data,id){
  const existing=state.products.find(p=>p.id===id);
  const name=data.name.trim();
  const handle=data.handle.trim()||name.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||existing?.handle||uid().slice(0,8);
  if(!name||state.products.some(p=>p.id!==id&&(p.handle||p.id)===handle)){flash('Enter a product title and a unique URL handle.');return;}
  if(data.compare&&Number(data.compare)<Number(data.price)){flash('Compare-at price must be at least the current price.');return;}
  let variants;try{variants=variantsFromForm(form,values,existing?.variants);}catch(error){flash(error.message);return;}
  const media=formMedia(form);
  const fields=Object.fromEntries(['description','category','type','vendor','tags','sku','barcode','taxCode','origin','seoTitle','seoDescription','status','imageAlt','options'].map(key=>[key,data[key]]));
  const product={...existing,...fields,id:existing?.id||uid(),name,handle,price:Number(data.price),compare:data.compare===''?'':Number(data.compare),cost:data.cost===''?'':Number(data.cost),weight:data.weight===''?'':Number(data.weight),stock:variants.length?variants.reduce((sum,v)=>sum+v.stock,0):Number(data.stock),variants,media,image:media[Number(data.mainIndex)]||media[0]||'',taxable:values.has('taxable'),trackStock:values.has('trackStock'),backorders:values.has('backorders'),physical:values.has('physical'),channels:values.getAll('channels'),custom:{...existing?.custom,...Object.fromEntries([...values].filter(([key])=>key.startsWith('custom:')).map(([key,value])=>[key.slice(7),value]))}};
  const warehouse=state.locations[0]?.id||'l1',prior=state.stockLocations[product.id];
  if(prior&&existing.stock!==product.stock){
    const delta=product.stock-existing.stock;
    if((prior[warehouse]||0)+delta<0){flash('Some units are at other locations. Adjust their balances in Inventory first.');return;}
    putBalance(product,warehouse,(prior[warehouse]||0)+delta);
    moveHistory(product.id,warehouse,delta,'Product editor');
  }
  if(existing)Object.assign(existing,product);else state.products.unshift(product);
  const selected=new Set(values.getAll('collections'));
  state.collections.filter(c=>c.type!=='Smart').forEach(collection=>{
    const members=collection.products||[];
    collection.products=selected.has(collection.id)?[...new Set([...members,product.id])]:members.filter(member=>member!==product.id);
  });
  save(existing?'Product updated in this browser.':'Product created in this browser.');
  if(existing)rerender();else location.hash='/products/'+product.id;
}
function editor(key,id){
  if(key==='products'){location.hash='/products/'+(id?encodeURIComponent(id):'new');return;}
  const r=state[key]?.find(x=>x.id===id)||{};
  if(!fieldTitles[key])return;
  dialog((id?'Edit ':'New ')+fieldTitles[key],editForm(key,id,fieldsFor(key,r),id?'Save changes':'Create '+fieldTitles[key]));
}
function orderView(id){
  const o=state.orders.find(x=>x.id===id);if(!o)return;
  const pairs=[['Customer',o.customer],['Item',o.item],['Quantity',o.quantity||1],['Total',money(o.total)],['Payment',o.payment],['Fulfillment',o.status],['Channel',o.channel],['Date',dateValue(o.date)]];
  dialog('Order #'+o.id,'<dl class="detail-list">'+pairs.map(([k,v])=>'<div><dt>'+k+'</dt><dd>'+esc(v)+'</dd></div>').join('')+'</dl>'+ (o.tracking?'<p class="under">Tracking · '+esc(o.tracking)+'</p>':'')+'<div class="actions" style="margin-top:14px">'+availableActions(o)+'</div>');
}
function newReturn(id){
  const eligible=state.orders.filter(o=>o.status==='Fulfilled'&&!state.returns.some(r=>r.order===o.id&&r.status!=='Closed'));
  if(!eligible.length){flash('There are no eligible fulfilled orders.');return;}
  dialog('Create return',editForm('new-return',null,select('Fulfilled order','order',eligible.map(o=>[o.id,'#'+o.id+' · '+o.item]),id)+input('Return reason','reason','','text','required maxlength="120"'),'Create return'));
}
function returnView(id){
  const r=state.returns.find(x=>x.id===id);if(!r)return;
  const o=state.orders.find(x=>x.id===r.order);
  let controls='';
  if(r.status==='Requested')controls=button('Accept return','return-step:'+id+':accept','primary');
  if(r.status==='Accepted')controls='<form data-form="edit" data-key="receive-return" data-id="'+id+'"><label class="inline"><input type="checkbox" name="restock" checked>Restock received item</label><div class="actions"><button class="btn primary">Process return</button></div></form>';
  if(r.status==='Received')controls=(o?.payment==='Paid'?button('Record sample refund','return-step:'+id+':refund','primary'):'')+button('Close return','return-step:'+id+':close');
  if(r.status==='Refunded')controls=button('Close return','return-step:'+id+':close','primary');
  dialog('Return '+id,'<div class="notice">Order #'+esc(r.order)+' · '+esc(r.reason)+' · '+esc(r.status)+'</div><div class="actions">'+controls+'</div>');
}
function downloadCsv(kind='products'){
  const quote=value=>'"'+String(value??'').replace(/^[=+\-@\t\r]/,c=>"'"+c).replace(/"/g,'""')+'"';
  const rows=kind==='orders'?[['Order','Date','Customer','Channel','Total','Payment','Fulfillment','Items','Tags'],...state.orders.filter(o=>o.status!=='Draft').map(o=>[o.id,o.date,o.customer,o.channel,o.total,o.payment,o.status,o.quantity,o.tags])]:[['Name','SKU','Category','Price','Stock','Status'],...state.products.map(p=>[p.name,p.sku,p.category,p.price,p.stock,p.status])];
  const url=URL.createObjectURL(new Blob([rows.map(r=>r.map(quote).join(',')).join('\r\n')],{type:'text/csv'}));
  const a=document.createElement('a');a.href=url;a.download='auzslab-preview-'+kind+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
const checkedRecords=()=>[...document.querySelectorAll('input[name="bulk-record"]:checked')].map(box=>box.value);
function syncBulkSelection(){
  const master=$('#select-all'),bar=$('#bulk-bar');
  if(!master||!bar)return;
  const count=checkedRecords().length,total=document.querySelectorAll('input[name="bulk-record"]').length;
  master.checked=count>0&&count===total;master.indeterminate=count>0&&count<total;bar.hidden=!count;
  $('#bulk-count').textContent=count+' selected';
}
const bulkFields={
  products:[['Name','name'],['Status','status','select',['Active','Draft','Archived']],['Category','category','select','categories'],['Price (₹)','price','number'],['Compare at (₹)','compare','number'],['SKU','sku'],['Tags','tags']],
  inventory:[['Available at first location','stock','number']],
  customers:[['Name','name'],['Email','email','email'],['Phone','phone','tel'],['City','city'],['Marketing','status','select',['Subscribed','Unsubscribed']]],
  collections:[['Title','name'],['Description','description'],['Store visibility','online','select',['Online store','Unpublished']]],
  orders:[['Tags','tags'],['Internal note','note'],['Delivery method','deliveryMethod']],
};
const bulkRecords=kind=>state[kind==='inventory'?'products':kind];
function openBulkEditor(kind){
  const ids=new Set(checkedRecords()),fields=bulkFields[kind];
  if(!ids.size||!fields)return;
  const rows=bulkRecords(kind).filter(record=>ids.has(record.id));
  const columns=fields.map(([label,key],index)=>'<label class="inline"><input type="checkbox" name="bulk-column" data-column="'+key+'"'+(index<4?' checked':'')+'>'+esc(label)+'</label>').join('');
  const columnsHtml=fields.map(([label,key],index)=>'<th scope="col" data-field="'+key+'"'+(index>=4?' hidden':'')+'>'+esc(label)+'</th>').join('');
  const renderCell=(record,[label,key,type='text',options],index)=>{
    const value=kind==='inventory'?balances(record)[state.locations[0]?.id||'l1']||0:key==='online'?(record.channels||['Online store']).includes('Online store')?'Online store':'Unpublished':record[key]??'';
    const name=key+':'+record.id;
    const control=type==='select'?select(label,name,options==='categories'?['',...state.categories]:options,value):input(label,name,value,type,(key==='name'||key==='stock'?'required ':'')+(type==='number'?(key==='stock'?'min="0" step="1"':'min="0" step="0.01"'):'maxlength="1500"'));
    return '<td data-field="'+key+'"'+(index>=4?' hidden':'')+'>'+control+'</td>';
  };
  const form='<form class="bulk-grid-form" data-form="edit" data-key="bulk-grid" data-id="'+kind+'"><details class="bulk-columns"><summary>Columns</summary><div class="inline">'+columns+'</div></details>'+
    '<div class="table-scroll"><table><thead><tr><th scope="col">Record</th>'+columnsHtml+'</tr></thead><tbody>'+rows.map(record=>'<tr data-row="'+esc(record.id)+'" aria-label="'+esc(record.name||'Order #'+record.id)+'"><th scope="row">'+esc(record.name||'Order #'+record.id)+'</th>'+fields.map((field,index)=>renderCell(record,field,index)).join('')+'</tr>').join('')+'</tbody></table></div>'+
    '<div class="actions"><button class="btn primary">Save bulk changes</button>'+button('Cancel','close-dialog')+(kind==='orders'?button('Fulfill selected','bulk-fulfill'):'')+'</div></form>';
  dialog('Bulk edit · '+rows.length+' '+kind,form,{wide:true});
}
function saveBulkGrid(form,kind,data){
  const fields=bulkFields[kind],visible=[...form.querySelectorAll('[name=bulk-column]:checked')].map(box=>box.dataset.column);
  const rows=[...form.querySelectorAll('[data-row]')].map(row=>bulkRecords(kind).find(record=>record.id===row.dataset.row)).filter(Boolean);
  const edits=rows.map(record=>[record,Object.fromEntries(fields.filter(([,key])=>visible.includes(key)).map(([,key,type])=>{
    const value=String(data[key+':'+record.id]??'').trim();
    return [key,type==='number'&&value!==''?Number(value):value];
  }))]);
  if(edits.some(([,fields])=>fields.name===''||Object.entries(fields).some(([key,value])=>['price','compare','stock'].includes(key)&&value!==''&&!Number.isFinite(value)))){
    flash('Check the highlighted fields before saving.');return false;
  }
  const location=state.locations[0]?.id||'l1';
  edits.forEach(([record,values])=>{
    if(kind==='inventory'){
      if(!Object.hasOwn(values,'stock'))return;
      const delta=values.stock-(balances(record)[location]||0);
      if(delta){putBalance(record,location,values.stock);moveHistory(record.id,location,delta,'Bulk adjustment');}
      return;
    }
    if(Object.hasOwn(values,'online')){
      const prior=record.channels||['Online store'];
      record.channels=values.online==='Online store'?[...new Set([...prior,'Online store'])]:prior.filter(channel=>channel!=='Online store');
      delete values.online;
    }
    Object.assign(record,values);
  });
  return true;
}
function listRefresh(id){
  const view=$('#table-results');if(!view)return;
  view.innerHTML=renderList(id,$('#table-query')?.value||'', $('#table-status')?.value||'All');
  syncBulkSelection();
  const count=view.querySelectorAll('tbody tr').length;$('#table-count').textContent=view.querySelector('.empty')?'0 records':count+' records';
}
function dispatch(id,type,target){
  if(id==='templates'&&themeLibraryDispatch(type,target))return;
  if(id==='domains'&&domainDispatch(type,target))return;
  if(id==='store-pages'&&(type==='input'||type==='change')&&['page-query','pageVisibility'].includes(target.id||target.name)){
    $('#page-results').innerHTML=storePageRows($('#page-query').value,$('[name=pageVisibility]').value);return;
  }
  if(type==='change'&&target.id==='product-upload')return uploadProductPhotos(target);
  if((type==='input'||type==='change')&&['collection-query','collection-type','collection-channel'].includes(target.id)){
    $('#collection-results').innerHTML=collectionList($('#collection-query').value,$('#collection-type').value,$('#collection-channel').value);syncBulkSelection();return;
  }
  if(type==='change'&&target.name==='type'&&target.form?.dataset.key==='collection-record'){
    $('#collection-manual').hidden=target.value==='Smart';$('#collection-smart').hidden=target.value!=='Smart';return;
  }
  if((type==='input'||type==='change')&&['table-query','table-status'].includes(target.id))return listRefresh(id);
  if(type==='change'&&target.id==='report-range'){reportRange=target.value;$('#order-metrics').innerHTML=orderMetrics();$('#report-range').focus();return;}
  if(type==='change'&&target.id==='select-all'){document.querySelectorAll('[name="bulk-record"]').forEach(x=>x.checked=target.checked);return syncBulkSelection();}
  if(type==='change'&&target.name==='bulk-record')return syncBulkSelection();
  if(type==='change'&&target.name==='bulk-column'){
    target.form.querySelectorAll('[data-field="'+target.dataset.column+'"]').forEach(cell=>{cell.hidden=!target.checked;cell.querySelectorAll('input,select').forEach(input=>input.disabled=!target.checked);});return;
  }
  if(type==='submit'){
    if(target.dataset.form!=='edit')return;
    const values=new FormData(target),data=Object.fromEntries(values),key=target.dataset.key,rid=target.dataset.id;
    if(key==='product-record')return saveProductRecord(target,values,data,rid);
    if(key==='store-page'){
      const name=data.name.trim(),slug=data.slug.trim()||name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
      if(!name||!slug||state.pages.some(p=>p.id!==rid&&p.slug===slug)){flash('Enter a title and a unique page URL handle.');return;}
      if(data.status==='Scheduled'&&!data.publishAt){flash('Choose when the page should publish.');return;}
      const existing=state.pages.find(page=>page.id===rid),page={...data,name,slug,id:existing?.id||uid(),inMenu:values.has('inMenu'),updatedOn:businessDate.format(new Date())};
      if(existing)Object.assign(existing,page);else state.pages.unshift(page);
      save('Store page saved in this browser.');
      if(existing)rerender();else location.hash='/store-pages/'+page.id;
      return;
    }
    if(key==='collection-record'){
      const rules=[...target.querySelectorAll('.collection-condition')].map(row=>({field:row.querySelector('[name=ruleField]').value,operator:row.querySelector('[name=ruleOperator]').value,value:row.querySelector('[name=ruleValue]').value.trim()})).filter(r=>r.value);
      if(!data.name.trim()){flash('Enter a collection title.');return;}
      if(data.type==='Smart'&&(!rules.length||rules.some(r=>['price','stock'].includes(r.field)?!['eq','gt','lt'].includes(r.operator)||!Number.isFinite(Number(r.value)):['gt','lt'].includes(r.operator)))){flash('Add valid conditions. Use numbers for price and stock and text operators for other fields.');return;}
      const {ruleField,ruleOperator,ruleValue,members,excluded,channels,...fields}=data;
      const updated={...fields,rules,products:values.getAll('members'),excluded:values.getAll('excluded'),channels:values.getAll('channels')};
      const collection=state.collections.find(c=>c.id===rid);
      if(collection)Object.assign(collection,updated);else{updated.id=uid();state.collections.unshift(updated);}
      save('Collection saved locally.');
      if(collection)rerender();else location.hash='/collections/'+updated.id;
      return;
    }
    if(key.startsWith('product-')){
      let p=state.products.find(x=>x.id===rid);
      if(key==='product-details'){
        if(!data.name.trim()){flash('Enter a product name.');return;}
        data.stock=+data.stock;data.price=+data.price;
        if(p)Object.assign(p,data);
        else{p={...data,id:uid(),media:[],channels:['AUZsStyle'],variants:[],tags:data.tags||'',options:''};state.products.unshift(p);}
        save('Product saved locally.');close();
        if(!rid)location.hash='/products/'+p.id;
        else rerender();
        return;
      }
      if(!p)return;
      if(key==='product-options'){
        let matrix;try{matrix=combinations(data.options);}catch(e){flash(e.message);return;}
        const prior=new Map((p.variants||[]).map(v=>[v.label,v]));
        p.options=data.options;
        const hadVariants=!!p.variants?.length;
        p.variants=matrix.map((row,i)=>{
          const label=row.map(([k,v])=>k+': '+v).join(' / ');
          return prior.get(label)||{id:uid(),label,sku:(p.sku||'ITEM')+'-'+(i+1),price:p.price,stock:!hadVariants&&i===0?p.stock:0,barcode:''};
        });
        if(p.variants.length)p.stock=p.variants.reduce((sum,v)=>sum+v.stock,0);
      }else if(key==='product-variant'){
        const variant=p.variants?.find(v=>v.id===data.variant);
        if(!variant)return;
        Object.assign(variant,{sku:data.sku,barcode:data.barcode,price:+data.price,stock:+data.stock});
        p.stock=p.variants.reduce((sum,v)=>sum+v.stock,0);
      }else if(key==='product-media'){
        p.media=[...new Set(data.media.split('\n').map(s=>s.trim()).filter(Boolean))].slice(0,18);
        if(!p.media.includes(p.image))p.image=p.media[0]||'';
      }else if(key==='product-channels')p.channels=values.getAll('channels');
      else if(key==='product-custom')p.custom=data;
      else Object.assign(p,data);
    }else if(key==='file'){
      const f=values.get('file');if(!f?.size||f.size>5*1024*1024){flash('Choose a file up to 5 MB.');return;}
      state.files.push({id:uid(),name:f.name,type:f.type||'Document',size:f.size});
    }else if(key==='business'||key==='domain'){
      Object.assign(state.business,data);
    }else if(key==='checkout'){
      Object.assign(state.checkout,data);
    }else if(key==='settings-draft'&&(settingPages[rid]||['billing','security','roles','account-data','connectors'].includes(rid))){
      state.settingsDrafts[rid]=data;
    }else if(key==='privacy-request'){
      (state.privacyRequests||=[]).unshift({...data,date:now()});
    }else if(key==='category'){
      const category=data.name.trim();
      if(!category||state.categories.some(c=>c.toLowerCase()===category.toLowerCase())){flash('Enter a new category name.');return;}
      state.categories.push(category);
    }else if(key==='store-menu'){
      state.navigation=String(data.links).split('\n').map(x=>x.trim()).filter(Boolean);
    }else if(key==='adjust'){
      const p=state.products.find(x=>x.id===rid);if(!p)return;
      const previous=balances(p)[data.location]||0;
      putBalance(p,data.location,+data.stock);
      moveHistory(p.id,data.location,+data.stock-previous,data.reason);
    }else if(key==='transfer'){
      const p=state.products.find(x=>x.id===data.product),units=+data.units;
      if(!p||data.from===data.to){flash('Choose two different locations and a product.');return;}
      const available=balances(p)[data.from]||0;
      if(!Number.isInteger(units)||units<1||units>available){flash('The source location does not have that many units.');return;}
      putBalance(p,data.from,available-units);
      moveHistory(p.id,data.from,-units,'Transfer sent');
      state.transfers.unshift({...data,id:uid(),ref:'T-'+String(state.transfers.length+1).padStart(3,'0'),units,status:'In transit'});
    }else if(key==='bulk-grid'){
      if(!bulkFields[rid]||!saveBulkGrid(target,rid,data))return;
    }else if(key==='bulk-fulfill'){
      const ids=new Set(values.getAll('orderIds'));
      state.orders.filter(order=>ids.has(order.id)&&order.status==='Unfulfilled'&&order.payment==='Paid').forEach(order=>{
        order.status='Fulfilled';order.fulfilledOn=businessDate.format(new Date());logOrder(order,'Order fulfilled in bulk');
      });
    }else if(key==='orders'){
      const p=state.products.find(x=>x.id===data.product);if(!p){flash('Choose a product.');return;}
      state.orders.unshift({...data,id:String(Math.max(1048,...state.orders.map(o=>Number(o.id)))+1),quantity:+data.quantity,item:p.name,total:p.price*(+data.quantity),status:'Draft',payment:'Pending',channel:'Draft orders',date:now()});
    }else if(key==='new-return'){
      state.returns.unshift({id:'R-'+String(Date.now()).slice(-7),...data,status:'Requested',restocked:false});
      const o=state.orders.find(x=>x.id===data.order);if(o)logOrder(o,'Return requested');
    }else if(key==='fulfill'){
      const o=state.orders.find(x=>x.id===rid);if(!o||o.status!=='Unfulfilled')return;
      o.status='Fulfilled';o.fulfilledOn=businessDate.format(new Date());o.tracking=data.tracking;logOrder(o,'Order fulfilled');
    }else if(key==='order-note'){
      const o=state.orders.find(x=>x.id===rid);if(!o)return;o.note=data.note;logOrder(o,'Internal note updated');
    }else if(key==='receive-return'){
      const r=state.returns.find(x=>x.id===rid);if(!r||r.status!=='Accepted')return;
      const o=state.orders.find(x=>x.id===r.order),p=state.products.find(x=>x.id===o?.product);
      if(data.restock&&p){changeDefaultBalance(p,o.quantity||1);r.restocked=true;}
      if(o){o.status='Returned';logOrder(o,r.restocked?'Return received and stock restored':'Return received');}r.status='Received';
    }else if(Array.isArray(state[key])){
      if(!String(data.name||'').trim()){flash('Enter a name.');return;}
      if(key==='collections')data.products=values.getAll('products');
      if(key==='discounts'&&data.type==='Percentage'&&+data.value>100){flash('Percentage discounts cannot exceed 100%.');return;}
      if(key==='products'){data.stock=+data.stock;data.price=+data.price;}
      const old=state[key].find(x=>x.id===rid);
      if(old) Object.assign(old,data);else state[key].push({...data,id:uid()});
    }else return;
    save('Saved in the local preview.');close();rerender();return;
  }
  if(type!=='click')return;
  if(target.dataset.action==='account-export'){
    const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const download=document.createElement('a');
    download.href=url;download.download='auzslab-account-preview.json';download.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    return;
  }
  const [action,key,detail]=target.dataset.action.split(':');
  const productForm=target.closest('.product-record');
  if(productForm&&['product-add-image','product-remove-image','product-build-variants','product-bullet','product-linebreak'].includes(action)){
    const values=new FormData(productForm),media=formMedia(productForm);
    if(action==='product-build-variants'){
      try{
        const p=state.products.find(p=>p.id===productForm.dataset.id);
        const variants=variantsFromForm(productForm,values,p?.variants);
        productForm.querySelector('.product-variant-grid').innerHTML=variantEditor(variants);
      }catch(error){flash(error.message);}
      return;
    }
    if(action==='product-bullet'||action==='product-linebreak'){
      const field=productForm.elements.description,insert=action==='product-bullet'?'\n• ':'\n';
      field.setRangeText(insert,field.selectionStart,field.selectionEnd,'end');field.focus();return;
    }
    const main=media[Number(values.get('mainIndex'))];
    if(action==='product-remove-image'){media.splice(Number(key),1);return updateProductMedia(productForm,media,main);}
    const field=productForm.elements.imageUrl,src=imageUrl(field.value);
    if(!src||!field.reportValidity())return flash('Enter a valid image URL.');
    if(media.length>=6&&!media.includes(src))return flash('Add up to six product images.');
    field.value='';return updateProductMedia(productForm,[...new Set([...media,src])],main);
  }
  if(action==='add-condition'){ $('#condition-rows').insertAdjacentHTML('beforeend',conditionRow());return;}
  if(action==='remove-condition'){target.closest('.collection-condition').remove();return;}
  if(action==='collection-up'||action==='collection-down'){
    const row=target.closest('.collection-pick');
    const sibling=action==='collection-up'?row.previousElementSibling:row.nextElementSibling;
    if(sibling){if(action==='collection-up')sibling.before(row);else sibling.after(row);target.focus();}
    return;
  }
  if(action==='duplicate-collection'){
    const c=state.collections.find(x=>x.id===key);if(!c)return;
    const duplicate={...structuredClone(c),id:uid(),name:c.name+' (Copy)',handle:'',channels:[],publishAt:''};
    state.collections.unshift(duplicate);save('Collection duplicated as unpublished.');location.hash='/collections/'+duplicate.id;return;
  }
  if(action==='main-image'){
    const p=state.products.find(x=>x.id===key);if(!p)return;
    const images=[...new Set([p.image,...(p.media||[])].filter(Boolean))];
    p.image=images[+detail]||p.image;p.media=images;save('Main image updated.');return rerender();
  }
  if(action==='duplicate-product'){
    const p=state.products.find(x=>x.id===key);if(!p)return;
    const copy={...structuredClone(p),id:uid(),name:p.name+' copy',status:'Draft',stock:0,barcode:'',sku:p.sku?p.sku+'-COPY':'',variants:(p.variants||[]).map(v=>({...v,id:uid(),stock:0,barcode:'',sku:v.sku?v.sku+'-COPY':''}))};
    state.products.unshift(copy);save('Draft product duplicated.');location.hash='/products/'+copy.id;return;
  }
  if(action==='variant'){
    const p=state.products.find(x=>x.id===key),v=p?.variants?.find(x=>x.id===detail);if(!v)return;
    return dialog(v.label,editForm('product-variant',p.id,'<input type="hidden" name="variant" value="'+esc(v.id)+'">'+input('SKU','sku',v.sku)+input('Barcode','barcode',v.barcode)+input('Price in ₹','price',v.price,'number','min="0" required')+input('Available stock','stock',v.stock,'number','min="0" required')));
  }
  if(action==='edit')return editor(key,detail);
  if(action==='recover-checkout'&&id==='abandoned-checkouts'){
    const checkout=state.abandonedCheckouts.find(item=>item.id===key);
    const product=state.products.find(item=>item.id===checkout?.product);
    if(!checkout||!product||checkout.order)return;
    checkout.order=String(Math.max(1048,...state.orders.map(order=>Number(order.id)))+1);
    state.orders.unshift({id:checkout.order,customer:checkout.customer,product:product.id,item:product.name,quantity:checkout.quantity,
      total:product.price*checkout.quantity,date:businessDate.format(new Date()),status:'Draft',payment:'Pending',channel:'Draft orders'});
    save('Checkout recovered as a local draft.');location.hash='/orders/'+checkout.order;return;
  }
  if(action==='export-products'||action==='export-orders')return downloadCsv(action==='export-orders'?'orders':'products');
  if(action==='category')return dialog('Add category',editForm('category',null,input('Category name','name','','text','required maxlength="120"'),'Add category'));
  if(action==='file')return dialog('Add file',editForm('file',null,'<label class="wide">File · up to 5 MB<input name="file" type="file" required></label>','Add file'));
  if(action==='domain')return dialog('Edit domain',editForm('domain',null,input('Domain','domain',state.business.domain,'text','required pattern="[a-zA-Z0-9.-]*[.][a-zA-Z]{2,}"'),'Save domain'));
  if(action==='store-menu')return dialog('Store navigation',editForm('store-menu',null,area('Menu labels · one per line','links',(state.navigation||['Home','Shop','Collections','Contact']).join('\n'))));
  if(action==='bulk-edit')return openBulkEditor(id);
  if(action==='bulk-clear'){document.querySelectorAll('[name="bulk-record"]').forEach(box=>box.checked=false);return syncBulkSelection();}
  if(action==='bulk-fulfill'&&id==='orders'){
    const ids=new Set(checkedRecords()),eligible=state.orders.filter(order=>ids.has(order.id)&&order.status==='Unfulfilled'&&order.payment==='Paid');
    if(!eligible.length){flash('Select at least one paid, unfulfilled order.');return;}
    return dialog('Fulfill '+eligible.length+' local orders',editForm('bulk-fulfill',null,'<p class="wide">'+eligible.map(order=>'#'+esc(order.id)).join(', ')+'</p>'+eligible.map(order=>'<input type="hidden" name="orderIds" value="'+esc(order.id)+'">').join(''),'Mark as fulfilled'));
  }
  if(action==='adjust'){
    const p=state.products.find(x=>x.id===key);
    if(p)return dialog('Adjust '+p.name,editForm('adjust',p.id,select('Location','location',state.locations.map(x=>[x.id,x.name]))+input('New available units','stock',Object.values(balances(p))[0]||0,'number','min="0" required')+input('Adjustment reason','reason','','text','required maxlength="120"')));
  }
  if(action==='transfer'){
    const locations=state.locations.filter(x=>x.status==='Active').map(x=>[x.id,x.name]);
    if(locations.length<2){flash('Add a second active location before transferring stock.');return;}
    return dialog('Create stock transfer',editForm('transfer',null,select('Product','product',state.products.map(p=>[p.id,p.name]))+select('From','from',locations,locations[0][0])+select('To','to',locations,locations[1][0])+input('Units','units',1,'number','min="1" required'),'Send transfer'));
  }
  if(action==='receive-stock'){
    const t=state.transfers.find(x=>x.id===key),p=state.products.find(x=>x.id===t?.product);
    if(!p||t.status!=='In transit')return;
    putBalance(p,t.to,(balances(p)[t.to]||0)+t.units);
    moveHistory(p.id,t.to,t.units,'Transfer received');
    t.status='Received';save('Stock received at '+getLocation(t.to)+'.');return rerender();
  }
  if(action==='order')return orderView(key);
  if(action==='confirm-cancel')return dialog('Cancel order #'+key,'<p>This local action releases inventory reserved by the draft workflow.</p><div class="actions" style="margin-top:15px">'+button('Cancel sample order','order-step:'+key+':cancel','primary')+button('Keep order','close-dialog')+'</div>');
  if(action==='new-return')return newReturn(key);
  if(action==='return')return returnView(key);
  if(action==='order-step'){
    const o=state.orders.find(x=>x.id===key);if(!o)return;
    const p=state.products.find(x=>x.id===o.product);
    if(detail==='open'&&o.status==='Draft'){
      const location=state.locations[0]?.id||'l1';
      if(!p||(balances(p)[location]||0)<o.quantity){flash('There is not enough stock at the fulfillment location.');return;}
      changeDefaultBalance(p,-o.quantity);o.stockReserved=true;o.status='Unfulfilled';logOrder(o,'Draft converted to order');
    }
    if(detail==='paid'&&o.payment==='Pending'){o.payment='Paid';logOrder(o,'Sample payment recorded');}
    if(detail==='fulfill')return dialog('Fulfill order #'+key,editForm('fulfill',key,input('Tracking reference','tracking','','text','maxlength="100"'),'Mark as fulfilled'));
    if(detail==='cancel'&&o.status==='Unfulfilled'){if(p&&o.stockReserved)changeDefaultBalance(p,o.quantity);o.status='Cancelled';logOrder(o,'Order cancelled');}
    save('Order updated locally.');close();rerender();return;
  }
  if(action==='return-step'){
    const r=state.returns.find(x=>x.id===key);if(!r)return;
    const o=state.orders.find(x=>x.id===r.order);
    if(detail==='accept'&&r.status==='Requested'){r.status='Accepted';if(o)logOrder(o,'Return accepted');}
    if(detail==='refund'&&r.status==='Received'&&o?.payment==='Paid'){o.payment='Refunded';o.refundedOn=businessDate.format(new Date());r.status='Refunded';logOrder(o,'Sample refund recorded');}
    if(detail==='close'&&['Received','Refunded'].includes(r.status)){r.status='Closed';if(o)logOrder(o,'Return closed');}
    save('Return updated locally.');rerender();returnView(key);return;
  }
  if(action==='read'||action==='read-all'){
    state.notifications.forEach(n=>{if(!key||n.id===key)n.read=true;});save('Notifications updated.');rerender();
  }
}
