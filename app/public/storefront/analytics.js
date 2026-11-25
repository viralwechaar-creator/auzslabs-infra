import {refreshLive, refreshVisitors} from './api.js';
import {button, close, dialog, esc, link, money, pathFor, rerender, save, state, uid} from './ecosystem.js';

const DAY = 86400000;
const formatDate = value => new Intl.DateTimeFormat('en-IN', {day:'numeric',month:'short',timeZone:'UTC'}).format(new Date(value));
const dateKey = value => new Date(value).toISOString().slice(0,10);
const dayValue = value => Date.parse(String(value).slice(0,10)+'T00:00:00Z');
const today = () => dayValue(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()));
const total = (rows, field) => rows.reduce((sum, row) => sum + (Number(row[field]) || 0), 0);
const paid = rows => rows.filter(row => row.payment === 'Paid');
const fulfilled = rows => rows.filter(row => ['Fulfilled','Shipped','Delivered'].includes(row.status));
const percent = number => number === null ? '—' : number.toFixed(1)+'%';
const metrics = {
  sales: {label:'Recorded sales', money:true, calculate:rows=>total(paid(rows),'total'), note:'Order totals for paid orders.'},
  orders: {label:'Orders placed', calculate:rows=>rows.length, note:'All non-draft, non-cancelled orders, including unpaid orders.'},
  fulfilled: {label:'Orders fulfilled', calculate:rows=>fulfilled(rows).length, note:'Orders currently fulfilled, shipped or delivered, grouped by the date the order was placed.'},
  average: {label:'Average paid order value', money:true, calculate:rows=>paid(rows).length?total(paid(rows),'total')/paid(rows).length:0, note:'Recorded sales divided by paid orders.'},
  units: {label:'Units ordered', calculate:rows=>total(rows,'quantity'), note:'Total recorded item quantity across placed orders.'},
};
const dimensionLabels = {date:'Order date',channel:'Sales channel',item:'Product',payment:'Payment status',status:'Fulfillment status',customer:'Customer'};
const standardReports = [
  {id:'sales',name:'Sales over time',category:'Sales',metric:'sales',dimension:'date',visual:'Trend'},
  {id:'channel',name:'Sales by channel',category:'Sales',metric:'sales',dimension:'channel',visual:'Bars'},
  {id:'product',name:'Sales by product',category:'Sales',metric:'sales',dimension:'item',visual:'Bars'},
  {id:'orders',name:'Orders over time',category:'Orders',metric:'orders',dimension:'date',visual:'Trend'},
  {id:'fulfilled',name:'Fulfilled orders',category:'Orders',metric:'fulfilled',dimension:'date',visual:'Trend'},
  {id:'average',name:'Average paid order value',category:'Sales',metric:'average',dimension:'date',visual:'Trend'},
  {id:'units',name:'Units by product',category:'Orders',metric:'units',dimension:'item',visual:'Bars'},
  {id:'source',name:'Campaign acquisition by source',category:'Acquisition'},
];
let filters = {period:'30',compare:'previous',start:'',end:'',channel:''};
let exploration = {name:'',metric:'sales',dimension:'date',visual:'Trend'};
let refreshed = new Date();
let reportFilters = {search:'',category:'',pinned:false,sort:'name'};
const customReports = () => state.analyticsReports || [];
const reportLink = (label, id) => link(esc(label),pathFor('reports/'+id),'compact');
const format = (metric, value) => metrics[metric].money ? money(value) : value.toLocaleString('en-IN');
const panel = (name, content, action='') => '<section class="panel"><div class="panel-title"><h2>'+name+'</h2>'+action+'</div><div class="panel-body">'+content+'</div></section>';
const option = (values, value) => values.map(([key,label])=>'<option value="'+esc(key)+'"'+(key===value?' selected':'')+'>'+esc(label)+'</option>').join('');
const field = (name,label,values,value) => '<label>'+label+'<select name="'+name+'">'+option(values,value)+'</select></label>';
const table = (head, rows) => '<div class="table-scroll"><table><thead><tr>'+head.map(x=>'<th scope="col">'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(x=>'<td>'+esc(x)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>'+(rows.length?'':'<p class="empty">No records in this view.</p>');
const tabs = id => '<nav class="tabs" aria-label="Analytics pages">'+[['analytics','Overview'],['reports','Reports'],['live-view','Live view']].map(([route,name])=>'<a href="'+pathFor(route)+'"'+(route===id?' aria-current="page"':'')+'>'+name+'</a>').join('')+'</nav>';

function range(){
  if(filters.period==='all') return null;
  const end = filters.period==='custom' ? dayValue(filters.end) : today();
  const start = filters.period==='custom' ? dayValue(filters.start) : end-(Number(filters.period)-1)*DAY;
  return {start,end};
}
function sourceOrders(){
  return state.orders.filter(row=>!['Draft','Cancelled'].includes(row.status));
}
function inRange(rows, window){
  return window ? rows.filter(row=>dayValue(row.date)>=window.start && dayValue(row.date)<=window.end) : rows;
}
function data(){
  const all = sourceOrders().filter(row=>!filters.channel || row.channel===filters.channel);
  const window = range();
  const offset = window ? window.end-window.start+DAY : 0;
  const comparison = window && filters.compare==='previous' ? {start:window.start-offset,end:window.start-DAY} : null;
  return {current:inRange(all,window),previous:comparison?inRange(all,comparison):[],window,comparison};
}
function filtersForm(){
  const channels = [...new Set(sourceOrders().map(row=>row.channel).filter(Boolean))].sort();
  return '<form data-form="analytics-filter" class="analytics-filters">'+
    field('period','Date range',[['1','Today'],['7','Last 7 days'],['30','Last 30 days'],['all','All time'],['custom','Custom range']],filters.period)+
    field('compare','Compare with',[['previous','Previous period'],['none','No comparison']],filters.compare)+
    field('channel','Sales channel',[['','All channels'],...channels.map(channel=>[channel,channel])],filters.channel)+
    '<span class="analytics-dates"'+(filters.period==='custom'?'':' hidden')+'><label>Start date<input name="start" type="date" value="'+esc(filters.start)+'"></label><label>End date<input name="end" type="date" value="'+esc(filters.end)+'"></label></span>'+
    '<button class="btn" type="submit">Apply filters</button><small>INR ₹</small><output role="status"></output></form>';
}
function group(rows, dimension, metric){
  const groups = new Map();
  for(const row of rows){
    const key = row[dimension] || 'Unknown';
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(row);
  }
  return [...groups].map(([label,items])=>[label,metrics[metric].calculate(items)]).sort(dimension==='date'?(a,b)=>a[0].localeCompare(b[0]):(a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]));
}
function series(rows, window, metric){
  if(!window) return group(rows,'date',metric);
  const days = Math.round((window.end-window.start)/DAY)+1;
  const step = Math.max(1,Math.ceil(days/30));
  const points = [];
  for(let start=window.start;start<=window.end;start+=step*DAY){
    points.push([dateKey(start),metrics[metric].calculate(inRange(rows,{start,end:start+(step-1)*DAY}))]);
  }
  return points;
}
function trend(current, previous, metric){
  if(!current.length)return '<p class="empty">No dated orders in this range.</p>';
  const highest = Math.max(1,...current.map(row=>row[1]),...previous.map(row=>row[1]));
  const coords = rows => rows.map((row,index)=>[(rows.length===1?50:index*100/(rows.length-1)),42-row[1]*36/highest]);
  const stroke = (rows, css) => {
    const points = coords(rows);
    if(points.length===1)return '<circle class="'+css+'" cx="'+points[0][0]+'" cy="'+points[0][1]+'" r="0.8"/>';
    return '<polyline class="'+css+'" points="'+points.map(point=>point.join(',')).join(' ')+'"/>';
  };
  const date = key => Number.isFinite(dayValue(key))?formatDate(dayValue(key)):'';
  return '<div class="analytics-trend"><div class="analytics-axis"><span>'+format(metric,highest)+'</span><span>'+format(metric,0)+'</span></div>'+
    '<svg viewBox="0 0 100 44" preserveAspectRatio="none" role="img" aria-label="'+esc(metrics[metric].label+' over time')+'">'+
    '<path d="M0 6H100 M0 24H100 M0 42H100" class="analytics-gridlines"/>'+(previous.length?stroke(previous,'analytics-prior'):'')+
    stroke(current,'analytics-line')+'</svg></div><div class="analytics-axis-dates"><span>'+date(current[0][0])+'</span><span>'+date(current.at(-1)[0])+'</span></div>'+
    '<p class="analytics-legend">Current period'+(previous.length?' <span>Previous period</span>':'')+'</p>';
}
function bars(rows, formatValue){
  if(!rows.length)return '<p class="empty">No records in this range.</p>';
  const highest = Math.max(1,...rows.map(row=>row[1]));
  return '<ul class="analytics-bars">'+rows.slice(0,10).map(([label,value])=>'<li><div><span>'+esc(label)+'</span><strong>'+esc(formatValue(value))+'</strong></div><progress max="'+highest+'" value="'+Math.max(0,value)+'" aria-label="'+esc(label)+'"></progress></li>').join('')+'</ul>';
}
function dashboard(){
  const {current,previous,window,comparison} = data();
  const cards = ['sales','orders','fulfilled','average'].map(key=>{
    const value = metrics[key].calculate(current), prev = metrics[key].calculate(previous);
    const delta = comparison && prev ? ' · '+percent((value-prev)*100/prev)+' vs prior' : '';
    return '<article class="metric analytics-kpi"><span>'+reportLink(metrics[key].label,key)+'</span><strong>'+format(key,value)+'</strong><small>'+esc(metrics[key].note+delta)+'</small></article>';
  }).join('');
  const target = state.analyticsTarget;
  const targetValue = target ? metrics[target.metric].calculate(current) : 0;
  const progress = target ? 100*targetValue/target.value : 0;
  const goal = target ? panel('Performance target','<p>'+format(target.metric,targetValue)+' of '+format(target.metric,target.value)+' · '+percent(progress)+' in the selected period</p>'+
    '<progress class="analytics-target" aria-label="'+esc(metrics[target.metric].label+' target progress')+'" max="100" value="'+Math.min(100,progress)+'"></progress>',button('Edit target','analytics-target','compact')) : '';
  return filtersForm()+'<div class="metrics">'+cards+'</div>'+goal+visitorPanel(false)+'<div class="analytics-grid">'+
    panel('Recorded sales over time',trend(series(current,window,'sales'),comparison?series(previous,comparison,'sales'):[],'sales'),reportLink('View report','sales'))+
    panel('Payment breakdown',table(['Status','Orders','Order totals'],['Paid','Pending','Refunded'].map(status=>{
      const orders=current.filter(row=>row.payment===status);
      return [status,orders.length,money(total(orders,'total'))];
    }))+'<p class="compact-copy">Taxes, shipping, discounts and partial refunds require separately recorded amounts.</p>')+'</div>'+
    '<div class="analytics-grid paired">'+panel('Sales by channel',bars(group(current,'channel','sales'),money),reportLink('View report','channel'))+
    panel('Top products by sales',bars(group(current,'item','sales'),money),reportLink('View report','product'))+'</div>'+
    panel('Campaign acquisition',campaignBars()+campaignTable(),reportLink('View report','source'));
}

// ---- Visitors: real anonymous visit events (same store, same Asia/Kolkata days as Live view) ----
export function visitorPanel(compact){
  const v = state.visitors;
  if(!v) return panel('Visitors','<p class="compact-copy">Loading visitor data…</p>');
  if(v.error) return panel('Visitors','<p class="empty">Visitor data is unavailable right now. This is not the same as zero visits. Try again in a moment.</p>',button('Retry','visitors-refresh','compact'));
  const total = Number(v.visitors)||0;
  const kpi = (label,value,note) => '<article class="metric analytics-kpi"><span>'+esc(label)+'</span><strong>'+esc(String(value))+'</strong><small>'+esc(note)+'</small></article>';
  const rate = (n,d) => d ? (100*n/d).toFixed(1)+'%' : '—';
  const cards = '<div class="metrics">'+kpi('Visitors',total,'Last '+v.days+' days, anonymous browsers')+kpi('Page views',v.views,'Pages opened')+kpi('Added to bag',v.bag,rate(v.bag,total)+' of visitors')+kpi('Reached checkout',v.checkout,rate(v.checkout,total)+' of visitors')+kpi('Placed an order',v.ordered,rate(v.ordered,total)+' of visitors')+'</div>';
  if(!total) return panel('Visitors',cards+'<p class="empty">No visits recorded in the last '+v.days+' days. Share your store link to start seeing traffic here.</p>');
  const series = v.series||[]; const highest = Math.max(1,...series.map(r=>r.visitors));
  const points = series.map((r,i)=>[(series.length===1?50:i*100/(series.length-1)),42-r.visitors*36/highest]);
  const line = points.length===1?'<circle class="analytics-line" cx="'+points[0][0]+'" cy="'+points[0][1]+'" r="0.8"/>':'<polyline class="analytics-line" points="'+points.map(p=>p.join(',')).join(' ')+'"/>';
  const dayLabel = key => formatDate(dayValue(key));
  const chart = '<div class="analytics-trend"><div class="analytics-axis"><span>'+highest+'</span><span>0</span></div><svg viewBox="0 0 100 44" preserveAspectRatio="none" role="img" aria-label="Visitors per day">'+
    '<path d="M0 6H100 M0 24H100 M0 42H100" class="analytics-gridlines"/>'+line+'</svg></div><div class="analytics-axis-dates"><span>'+dayLabel(series[0].day)+'</span><span>'+dayLabel(series.at(-1).day)+'</span></div><p class="analytics-legend">Visitors per day</p>';
  if(compact) return panel('Website visitors','<div class="metrics" style="grid-template-columns:repeat(3,minmax(0,1fr))">'+kpi('Visitors',total,'Last '+v.days+' days')+kpi('Added to bag',v.bag,rate(v.bag,total))+kpi('Ordered',v.ordered,rate(v.ordered,total))+'</div>'+chart,link('Analytics',pathFor('analytics'),'compact'));
  const dev = bars((v.devices||[]).map(d=>[d.device,d.visitors]),n=>String(n));
  const pg = bars((v.pages||[]).map(p=>[p.page,p.views]),n=>String(n));
  return panel('Visitors',cards+chart,button('Refresh','visitors-refresh','compact'))+'<div class="analytics-grid paired">'+panel('Visitors by device',dev)+panel('Most viewed pages',pg)+'</div>';
}
export function campaignBars(){
  const rows = (state.campaigns||[]).filter(c=>Number(c.orders)>0||Number(c.revenue)>0);
  if(!rows.length) return '<p class="compact-copy">No campaign has brought an order yet. Add a campaign under Growth to compare sources.</p>';
  return '<p class="compact-copy">Orders attributed to each campaign</p>'+bars(rows.map(c=>[c.name+' · '+(c.channel||c.source||''),Number(c.orders)||0]),n=>n+(n===1?' order':' orders'))+
    '<p class="compact-copy">Revenue</p>'+bars(rows.map(c=>[c.name,Number(c.revenue)||0]),money);
}
function campaignTable(){
  return '<p class="compact-copy">Lifetime campaign totals. The sample campaigns have no dated sessions, so dashboard date filters apply to order data only.</p>'+
    table(['Source','Campaign','Sessions','Leads','Attributed orders','Orders per session'],state.campaigns.map(c=>[c.source,c.name,c.sessions,c.leads,c.orders,percent(c.sessions?100*c.orders/c.sessions:null)]));
}
function library(){
  const saved = customReports().map(report=>({...report,category:'Custom'}));
  const matching = report => report.name.toLowerCase().includes(reportFilters.search.toLowerCase()) &&
    (!reportFilters.category||report.category===reportFilters.category) && (!reportFilters.pinned||state.analyticsPins?.includes(report.id));
  const reports = [...standardReports,...saved].sort((a,b)=>Number(!!state.analyticsPins?.includes(b.id))-Number(!!state.analyticsPins?.includes(a.id))||
    (reportFilters.sort==='category'?a.category.localeCompare(b.category):0)||a.name.localeCompare(b.name));
  return '<section class="panel"><div class="panel-title"><h2>Report library</h2></div><div class="analytics-filters">'+
    '<label>Search reports<input type="search" name="report-search" placeholder="Report name" value="'+esc(reportFilters.search)+'"></label>'+
    field('report-category','Category',[['','All categories'],...['Acquisition','Orders','Sales','Custom'].map(x=>[x,x])],reportFilters.category)+
    field('report-sort','Sort by',[['name','Name'],['category','Category']],reportFilters.sort)+
    '<label class="analytics-pin-filter"><input type="checkbox" name="report-pinned" '+(reportFilters.pinned?'checked':'')+'> Pinned only</label></div>'+
    '<div class="table-scroll"><table><thead><tr><th scope="col">Report</th><th scope="col">Category</th><th scope="col">Created by</th><th scope="col">Pin</th></tr></thead><tbody>'+
    reports.map(report=>{
      const pinned = !!state.analyticsPins?.includes(report.id);
      return '<tr '+(matching(report)?'':'hidden ')+'data-report-name="'+esc(report.name.toLowerCase())+'" data-report-category="'+report.category+'" data-report-pinned="'+pinned+'"><td>'+reportLink(report.name,report.id)+'</td><td>'+report.category+'</td><td>'+(report.category==='Custom'?'You':'AUZslab')+'</td><td>'+
        '<button class="btn compact" type="button" data-action="report-pin:'+report.id+'" aria-pressed="'+pinned+'" aria-label="'+(pinned?'Unpin ':'Pin ')+esc(report.name)+'">'+(pinned?'Pinned':'Pin')+'</button></td></tr>';
    }).join('')+'</tbody></table></div><p class="empty" data-report-empty '+(reports.some(matching)?'hidden':'')+'>No matching reports.</p></section>';
}
function reportRows(config){
  return group(data().current,config.dimension,config.metric);
}
function reportResults(config){
  const rows = reportRows(config);
  const {current,previous,window,comparison} = data();
  const visualization = config.visual==='Table' ? '' : config.visual==='Trend' && config.dimension==='date' ?
    trend(series(current,window,config.metric),comparison?series(previous,comparison,config.metric):[],config.metric) :
    bars(rows,value=>format(config.metric,value));
  return panel('Results','<p class="compact-copy">'+esc(metrics[config.metric].note)+'</p>'+visualization+
    table([dimensionLabels[config.dimension],metrics[config.metric].label],rows.map(([label,value])=>[label,format(config.metric,value)])),
    button('Export CSV','report-csv','compact'));
}
function explorer(config){
  return filtersForm()+'<div class="analytics-grid">'+reportResults(config)+panel('Report controls','<form data-form="analytics-explore" class="stack">'+
    '<label>Report name<input name="name" type="text" maxlength="80" value="'+esc(config.name)+'" placeholder="Name for a saved report"></label>'+
    field('metric','Metric',Object.entries(metrics).map(([key,value])=>[key,value.label]),config.metric)+
    field('dimension','Group by',Object.entries(dimensionLabels),config.dimension)+
    field('visual','Visualization',['Trend','Bars','Table'].map(value=>[value,value]),config.visual)+
    '<div class="actions"><button class="btn" type="submit" value="run">Run report</button><button class="btn primary" type="submit" value="save">Save report</button></div><output role="status"></output></form>')+'</div>';
}
function live(){
  const orders = sourceOrders().slice().sort((a,b)=>b.date.localeCompare(a.date));
  const current = inRange(orders,{start:today(),end:today()});
  const lv = state.liveVisitors;
  const num = key => lv && !lv.error ? String(lv[key] ?? 0) : 'Unavailable';
  const people = lv && !lv.error && lv.visitors && lv.visitors.length ? panel('On your store now',table(['Page','Device','Doing','Last seen'],lv.visitors.map(v=>[v.page||'/',v.device||'—',v.doing,new Intl.DateTimeFormat('en-IN',{hour:'numeric',minute:'2-digit',second:'2-digit',timeZone:'Asia/Kolkata'}).format(new Date(v.seen))])),button('Refresh','analytics-refresh','compact')) : '';
  return '<div class="notice">Visitors are people active on your store in the last 5 minutes. It counts anonymous browsers, not names.</div>'+
    '<div class="metrics">'+[['Sales today',money(total(paid(current),'total'))],['Orders today',current.length],['Visitors now',num('now')],['Visitors today',num('today')],['Bag now',num('inBag')],['At checkout now',num('inCheckout')]].map(([label,value])=>'<article class="metric"><span>'+label+'</span><strong>'+value+'</strong></article>').join('')+'</div>'+people+
    panel('Recent order activity',table(['Order','Order date','Sales channel','Payment','Fulfillment','Total'],
      orders.slice(0,12).map(row=>['#'+row.id,row.date,row.channel,row.payment,row.status,money(row.total)])),button('Refresh','analytics-refresh','compact'));
}
function exportCsv(name,headers,rows){
  const cell = value => {
    const string = String(value ?? '');
    const safe = typeof value==='string' && /^[\s]*[=+@-]/.test(string) ? "'"+string : string;
    return '"'+safe.replaceAll('"','""')+'"';
  };
  const blob = new Blob(['\ufeff',[headers,...rows].map(row=>row.map(cell).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href=url;
  anchor.download=(name.toLowerCase().replace(/[^a-z0-9]+/g,'-')||'report')+'.csv';
  anchor.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function dispatch(type,target,event,record,report){
  if(type==='change' && target.name==='report-sort'){
    reportFilters.sort=target.value;
    return rerender();
  }
  if(type==='input' && ['report-search','report-category','report-pinned'].includes(target.name)){
    const search = document.querySelector('[name=report-search]').value.trim().toLowerCase();
    const category = document.querySelector('[name=report-category]').value;
    const pin = document.querySelector('[name=report-pinned]').checked;
    Object.assign(reportFilters,{search,category,pinned:pin});
    let visible = 0;
    for(const row of document.querySelectorAll('[data-report-name]')){
      row.hidden=!(row.dataset.reportName.includes(search)&&(!category||row.dataset.reportCategory===category)&&(!pin||row.dataset.reportPinned==='true'));
      if(!row.hidden)visible++;
    }
    document.querySelector('[data-report-empty]').hidden=visible>0;
  }
  if(type==='change' && target.name==='period'){
    target.form.querySelector('.analytics-dates').hidden=target.value!=='custom';
  }
  if(type==='submit' && target.dataset.form==='analytics-filter'){
    const values = Object.fromEntries(new FormData(target));
    if(values.period==='custom'&&(!values.start||!values.end||values.start>values.end||dayValue(values.end)-dayValue(values.start)>366*DAY)){
      target.querySelector('output').textContent='Choose a valid date range of up to 367 days.';
      return;
    }
    filters=values;
    return rerender();
  }
  if(type==='submit' && target.dataset.form==='analytics-explore'){
    const config = Object.fromEntries(new FormData(target));
    config.name=config.name.trim();
    if(config.visual==='Trend'&&config.dimension!=='date'){
      target.querySelector('output').textContent='Choose Order date for a trend, or use bars for another grouping.';
      return;
    }
    if(event.submitter?.value==='save'){
      if(!config.name){target.querySelector('output').textContent='Enter a report name before saving.';return;}
      const reports = state.analyticsReports ||= [];
      const existing = reports.find(item=>item.id===record);
      const entry = {...config,id:existing?.id||uid()};
      if(existing)Object.assign(existing,entry);else reports.push(entry);
      save('Report saved');
      location.hash='/reports/'+entry.id;
      if(existing)rerender();
      return;
    }
    exploration={...config,source:record};
    return rerender();
  }
  if(type==='submit' && target.dataset.form==='analytics-target'){
    const values = new FormData(target);
    state.analyticsTarget={metric:values.get('metric'),value:Number(values.get('value'))};
    close();
    save('Target saved');
    return rerender();
  }
  if(type!=='click')return;
  const [action,id]=target.dataset.action.split(':');
  if(action==='report-pin'){
    const pins = state.analyticsPins ||= [];
    state.analyticsPins=pins.includes(id)?pins.filter(value=>value!==id):[...pins,id];
    save();
    return rerender();
  }
  if(action==='visitors-refresh'){ return refreshVisitors().then(()=>rerender(true)); }
  if(action==='analytics-refresh'){
    refreshed=new Date();
    return refreshLive().then(()=>rerender(true));
  }
  if(action==='analytics-target'){
    const current = state.analyticsTarget;
    return dialog('Performance target','<form data-form="analytics-target" class="stack">'+
      field('metric','Metric',[['sales','Recorded sales in ₹'],['orders','Orders placed'],['fulfilled','Orders fulfilled']],current?.metric||'sales')+
      '<label>Target value<input name="value" type="number" min="1" max="1000000000" value="'+(current?.value||'')+'" required></label>'+
      '<div class="actions"><button type="submit" class="btn primary">Save target</button>'+(current?button('Remove target','analytics-remove-target'):'')+'</div></form>');
  }
  if(action==='analytics-remove-target'){
    delete state.analyticsTarget;
    close();
    save('Target removed');
    return rerender();
  }
  if(action==='report-csv'){
    const config = record==='explore'||exploration.source===record?exploration:report;
    if(record==='source')return exportCsv('Campaign acquisition',['Source','Campaign','Sessions','Leads','Orders'],state.campaigns.map(c=>[c.source,c.name,c.sessions,c.leads,c.orders]));
    if(config)return exportCsv(config.name||'Exploration',[dimensionLabels[config.dimension],metrics[config.metric].label],reportRows(config));
  }
}
export function analyticsPage(id,record){
  const report = [...standardReports,...customReports()].find(row=>row.id===record);
  const title = id==='analytics'?'Analytics':id==='live-view'?'Live view':record==='explore'?'New exploration':report?.name||'Reports';
  const refreshedAt = new Intl.DateTimeFormat('en-IN',{hour:'numeric',minute:'2-digit',timeZone:'Asia/Kolkata'}).format(refreshed);
  const subtitle = id==='reports'?'Browse saved reports or build one from your order data.':'Live data from your store · refreshed at '+refreshedAt+' IST';
  const header = '<div class="page-head"><div><h1>'+esc(title)+'</h1><p>'+esc(subtitle)+'</p></div><div class="actions">'+
    (id==='analytics'?button(state.analyticsTarget?'Edit target':'Set target','analytics-target'):'')+link('New exploration',pathFor('reports/explore'),'primary')+'</div></div>';
  let content;
  if(id==='analytics')content=dashboard();
  else if(id==='live-view')content=live();
  else if(record==='source')content=panel('Acquisition by source',campaignTable(),button('Export CSV','report-csv','compact'));
  else if(record==='explore'||customReports().some(row=>row.id===record))content=explorer(record==='explore'||exploration.source===record?exploration:report);
  else if(report)content=filtersForm()+reportResults(report);
  else content=library();
  return {html:header+tabs(id)+content,dispatch:(type,target,event)=>dispatch(type,target,event,record,report)};
}
