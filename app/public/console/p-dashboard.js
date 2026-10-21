/* Dashboard + Daily Operations pages */
const greeting=()=>{const hr=new Date().getHours();return hr<12?'Good Morning!':hr<17?'Good Afternoon!':'Good Evening!'};
function margins(){const res=[];L('item').forEach(i=>{const c=unitCost(i);if(c>0&&i.price>0)res.push({n:i.name,m:r2((i.price-c)/i.price*100)})});return res}
function allOutletsNote(){return outletId()=='all'?note('Showing all outlets combined. Pick one outlet at the top to work inside it.'):null}
PAGES.dashboard=()=>{
 const d=S.date,st=dayStats(d),y=dayStats(addDays(d,-1)),pct=v=>st.rev>0?Math.round(v/st.rev*100):0,delta=y.rev>0?Math.round((st.rev-y.rev)/y.rev*100):null;
 const cum=[];st.hours.reduce((a,v,i)=>(cum[i]=a+v),0);
 const hello=h('div',{class:'hello'},
  h('div',{},h('h1',{},greeting()),h('p',{},"Here's what's happening at ",h('b',{},outletId()=='all'?'all your outlets':outletNameOf(outletId())),' '+(d==today()?'today.':'on '+fmtD(d)+'.'))),
  h('div',{class:'hrow'},
   h('label',{class:'datep'},ic('cal',17),h('span',{class:'t'},fmtD(d)),ic('chd',15),h('input',{type:'date',value:d,onclick:e=>{try{e.target.showPicker()}catch(_){}},onchange:e=>{if(e.target.value){S.date=e.target.value;render()}}})),
   h('button',{class:'ib',title:'Refresh',onclick:()=>{sync();render()}},ic('ref',18)),syncCard(),
   h('div',{class:'sync'},h('i'),h('div',{},h('b',{},'Orders Synced'),h('span',{},S.lastSync?'Last synced just now':'Syncing…')))));
 const avgBill=st.count?Math.round(st.rev/st.count):0,dd=(a,b)=>b>0?Math.round((a-b)/b*100):null;
 const dchip=(v)=>v==null?null:h('span',{class:'chip'+(v<0?' dn':'')},(v<0?'↓ ':'↑ ')+Math.abs(v)+'%');
 const hd=(t,sub,act)=>h('div',{class:'hd'},h('div',{},h('h3',{},t),sub?h('div',{class:'sm'},sub):null),act||null);
 const revCard=h('div',{class:'card dx dx-hero s5'},h('div',{class:'dx-lbl'},"Today's revenue",dchip(delta)),h('div',{class:'dx-rev'},h('div',{},h('div',{class:'big-rev'},inr(st.rev)),h('div',{class:'sm'},'vs. '+inr(y.rev)+' yesterday')),sparkline(cum.filter((_,i)=>i%2==0),200,64)));
 const stat=(l,v,sub,chip,go_)=>h('div',{class:'card dx dx-stat',style:go_?'cursor:pointer':'',onclick:go_?()=>go(go_):null},h('div',{class:'dx-lbl'},l),h('div',{class:'dx-num'},v),h('div',{class:'sm'},sub,chip));
 const kp=h('div',{class:'dx-kp s7'},
  stat('Orders',String(st.count),st.count==y.count?'No change':(st.count>y.count?'+':'')+(st.count-y.count)+' vs yesterday',null,'daily/all'),
  stat('Average bill',inr(avgBill),y.count?'was '+inr(Math.round(y.rev/y.count)):'per order',null),
  stat('Unpaid',inr(st.unpaid),st.unpaid>0?'waiting to be settled':'all settled',null,'daily/due'));
 const mix=[['Cash','var(--accent)',st.pay.cash],['UPI','var(--accent-line)',st.pay.upi],['Card','var(--label)',st.pay.card],['Online','var(--orange)',st.pay.online],['Other','var(--label3)',st.pay.other]],mixT=sum(mix,m=>m[2]);
 const payCard=h('div',{class:'card dx s7'},hd('Payments received',mixT?inr(mixT)+' collected':'Nothing collected yet'),
  h('div',{class:'dx-seg'},...(mixT?mix.filter(m=>m[2]>0).map(m=>h('i',{style:'flex:'+m[2]+';background:'+m[1],title:m[0]})):[h('i',{style:'flex:1;background:var(--fill2)'})])),
  h('div',{class:'dx-leg'},...mix.map(([l,c,v])=>h('div',{},h('span',{class:'k'},h('i',{style:'background:'+c}),l),h('b',{},inr(v)),h('span',{class:'sm'},(mixT?Math.round(v/mixT*100):0)+'%')))));
 const barC={b:'var(--accent)',g:'var(--teal)',r:'var(--orange)'};
 const chCard=h('div',{class:'card dx s5'},hd('Order Channels',null,h('a',{class:'vbtn',href:'#rep/orders',onclick:e=>{e.preventDefault();go('rep/orders')}},'Details')),
  h('div',{class:'dx-ch'},...[['Dine-In','dine','b'],['Takeaway','take','g'],['Delivery','deliv','r']].map(([n,i,c])=>{const x=st.ch[n];return h('div',{class:'chr'},h('span',{class:'tile t-'+(c=='g'?'g':c=='r'?'o':'b')},ic(i,15)),h('div',{class:'mid'},h('div',{class:'tp'},h('span',{},n),h('b',{},inr(x.v))),h('div',{class:'bar'},h('i',{style:'width:'+pct(x.v)+'%;background:'+barC[c]})),h('div',{class:'sm'},x.n+' orders · '+pct(x.v)+'%')))})));
 const onl=st.ps.filter(isOnline),byP={};onl.forEach(o=>{const k=o.src||'Other',e=byP[k]=byP[k]||{n:0,pre:0,cod:0,rev:0};e.n++;e.rev+=netOf(o);((o.pays||[]).some(p=>p.m!='cash')?e.pre++:e.cod++)});
 const pre=onl.filter(o=>(o.pays||[]).some(p=>p.m!='cash')).length;
 const onCard=h('div',{class:'card dx s5'},hd('Online Orders Overview',onl.length?onl.length+' today · '+inr(sum(onl,netOf)):'Swiggy, Zomato, website',h('button',{class:'vbtn',onclick:()=>go('daily/online')},'View all')),
  onl.length?h('div',{},h('div',{class:'dx-mini'},...[['Prepaid',pre],['COD',onl.length-pre]].map(([l,v])=>h('div',{},h('b',{},String(v)),h('span',{class:'sm'},l)))),
   h('table',{},h('tr',{},...['Platform','Orders','Revenue'].map(x=>h('th',{},x))),...Object.entries(byP).map(([k,e])=>h('tr',{},h('td',{},k),h('td',{},String(e.n)),h('td',{},inr(e.rev)))))):
  h('div',{class:'dx-empty'},ic('online',18),h('span',{},'No online orders yet today.'),h('button',{class:'vbtn',onclick:()=>onlineOrderForm()},'Add one')));
 const sel=S.f.trend||'Today',sd=sel=='Yesterday'?addDays(d,-1):d,hv=dayStats(sd).hours,lab=[0,4,8,12,16,20].map(hr=>[hr,hr==0?'12 AM':hr==12?'12 PM':hr<12?hr+' AM':(hr-12)+' PM']);
 const trend=h('div',{class:'card dx dx-trend s8'},hd('Sales Trend',inr(sum(hv,v=>v))+' · '+sel.toLowerCase(),h('label',{class:'sel'},h('select',{onchange:e=>{S.f.trend=e.target.value;render()}},...['Today','Yesterday'].map(x=>h('option',{value:x,selected:x==sel},x))),ic('chd',14))),chartBox(lineChartX(hv,lab),hv,(b,v)=>inr(v)+'  '+(b%12||12)+(b<12?' AM':' PM')));
 const is=itemStats(addDays(d,-30),d);rawL('item').forEach(i=>{if(!is[i.name])is[i.name]={n:i.name,q:0,a:0}});
 const best=(S.f.items||'best')=='best',arr=Object.values(is),total=Math.max(1,arr.reduce((a,x)=>a+x.q,0)),list=[...arr].sort((a,b)=>best?b.q-a.q:a.q-b.q).slice(0,5),mx=Math.max(1,...list.map(x=>x.q));
 const topC=h('div',{class:'card dx s4'},hd('Top Performing Items',null,h('button',{class:'vbtn',onclick:()=>go('rep/items')},'View all')),
  h('div',{class:'tabs'},h('button',{class:best?'on':'',onclick:()=>{S.f.items='best';render()}},'Best sellers'),h('button',{class:best?'':'on',onclick:()=>{S.f.items='low';render()}},'Low performers')),
  h('div',{class:'top5'},...list.map((x,i)=>h('div',{class:'r'},h('span',{class:'rk'},String(i+1)),h('span',{class:'nm'},x.n),h('span',{class:'tr'},h('i',{style:'width:'+Math.max(2,x.q/mx*100)+'%'})),h('span',{class:'pc'},(x.q/total*100).toFixed(1)+'%'))),list.length?null:h('div',{class:'empty'},'Add menu items to see them here.')));
 const exps=L('exp').filter(e=>e.d==d),cm=L('cashmove').filter(c=>c.d==d),eT=sum(exps,e=>e.amt),wd=sum(cm.filter(c=>c.type=='out'),c=>c.amt),tu=sum(cm.filter(c=>c.type=='in'),c=>c.amt);
 const cf=h('div',{class:'card dx s4'},hd('Expenses & Cash Flow',fmtD(d)),h('div',{class:'dx-num'},inr(eT+wd)),h('div',{class:'sm',style:'margin-bottom:6px'},'total outflow'),
  h('div',{},...[['Expenses','exp','r',eT,'fin/expenses'],['Withdrawals','wd','o',wd,'fin/withdrawals'],['Cash top-up','top','g',tu,'fin/withdrawals']].map(([l,i,c,v,pg])=>h('div',{class:'li',style:'cursor:pointer',onclick:()=>go(pg)},tile(i,c),l,h('span',{class:'a'},inr(v))))));
 const vl=rawL('voidlog').filter(v=>dayOf(v.at)==d&&(outletId()=='all'||(v.outlet||'main')==outletId())),all_=orders().filter(o=>dayOf(o.created)==d||dayOf(o.paidAt)==d);
 const leakRows=[['KOTs','kot',vl.filter(v=>v.item).length],['Cancelled Bills','cxl',all_.filter(o=>o.status=='void').length],['Modified Bills','mod',all_.filter(o=>(o.refunds||[]).length||(o.exchanges||[]).length).length],['Shifted Orders','shift',all_.filter(o=>o.shifted).length],['Reprinted Bills','prn',all_.filter(o=>o.reprints).length],['Waived Off','wv',sum(all_.filter(o=>o.status!='void'),o=>(o.complimentary?o.t.total:0)+(o.t.d||0))]];
 const leak=h('div',{class:'card dx s4'},hd('Revenue Leakage',fmtD(d)),h('div',{class:'lk'},...leakRows.map(([l,i,v])=>h('div',{class:'li'},ic(i,17),l,h('span',{class:'a'},l=='Waived Off'?inr(v):String(v))))));
 const mg=margins(),avg=mg.length?r2(mg.reduce((a,x)=>a+x.m,0)/mg.length):0,target=+cfg().targetMargin||70,low=mg.filter(x=>x.m<target);
 const health=h('div',{class:'card dx s4'},hd('Business Health',null,h('button',{class:'vbtn',onclick:()=>go('rep/items')},'Details')),
  h('div',{class:'mg2'},h('div',{},h('div',{class:'v'},avg+'%'),h('div',{class:'l'},'Avg. margin')),h('div',{},h('div',{class:'v'},target+'%'),h('div',{class:'l'},'Target'))),
  h('div',{class:'ins'},h('span',{class:'tile t-g'},ic('trend',16)),h('div',{},h('b',{},mg.length?(low.length?'Below target on '+low.length+' item'+(low.length>1?'s':''):'Margins look healthy'):'Add recipes to see margins'),h('p',{},mg.length?(low.length?'Check their price or recipe cost.':'Every costed item meets your target.'):'Margins come from recipes and ingredient costs.'))));
 const days=[...Array(7)].map((_,i)=>addDays(d,i-6)),ds=days.map(x=>dayStats(x)),mxd=Math.max(1,...ds.flatMap(s=>Object.values(s.ch).map(c=>c.v)));
 const snap=h('div',{class:'card dx s8'},hd('Daily Snapshot',null,h('button',{class:'vbtn',onclick:()=>go('rep/sales')},'View report')),
  h('div',{class:'snap'},...days.map((x,i)=>h('div',{class:'d'},h('div',{class:'bs'},...[['Dine-In','var(--accent)'],['Takeaway','var(--teal)'],['Delivery','var(--orange)']].map(([k,c])=>h('i',{style:'height:'+Math.max(3,ds[i].ch[k].v/mxd*100)+'%;background:'+c+';opacity:'+(ds[i].ch[k].v?1:.35)}))),h('span',{class:'x'},new Date(x+'T12:00:00').toLocaleDateString('en-US',{weekday:'short'}))))),
  h('div',{class:'lg'},...[['Dine-In','var(--accent)'],['Takeaway','var(--teal)'],['Delivery','var(--orange)']].map(([k,c])=>h('span',{},h('i',{style:'background:'+c}),k))));
 const qa=h('div',{class:'dx-qa'},h('span',{class:'dx-qh'},'Quick Actions'),...[['Manage menu','menu','menu/items'],['Run reports','rep','rep/sales'],['Staff costs','team','team/attendance'],['Marketing','mkt','mkt/campaigns']].map(([t,i,pg])=>h('button',{class:'qb',onclick:()=>go(pg)},ic(i,17),t)));
 const grid=h('div',{class:'dx-grid'},revCard,kp,payCard,chCard,trend,topC,onCard,cf,leak,snap,health);

 const storeCard=h('div',{class:'store-card'+(storeOpen()?'':' closed')},h('div',{},h('h3',{},storeOpen()?'Restaurant is open':'Restaurant is closed'),h('p',{},storeOpen()?'Customers can order from your QR codes and website. Swiggy and Zomato orders come in on their own tablets.':'QR and website orders are stopped and manual Swiggy or Zomato entry is blocked. Also pause the restaurant in the Swiggy and Zomato partner apps, they cannot be switched off from here.')),S.role=='owner'?h('button',{class:'btn '+(storeOpen()?'':'p'),onclick:()=>setStoreOpen(!storeOpen())},storeOpen()?'Close restaurant':'Open restaurant'):h('span',{class:'sm'},'Only the owner can change this'));
 return[hello,storeCard,qa,grid]};
// ---------- Daily Operations ----------
const stPill=o=>o.status=='paid'?pill('Paid','g'):o.status=='due'?pill('Due','a'):o.status=='void'?pill('Void','r'):pill(({new:'In kitchen',preparing:'Preparing',ready:'Ready',served:'Served',dispatched:'Out for delivery',done:'Delivered'})[o.kstat]||'Open','b');
function ordersTable(rows,opts={}){return table([
 {label:'Order',get:o=>h('b',{},o.no||'—')},{label:'Type',get:o=>o.type||''},{label:'Table / Source',get:o=>(o.src||'')+(o.table?tn(o.table):'')||'—'},
 {label:'Customer',get:o=>h('span',{},(o.cust||{}).name||'Guest',(o.cust||{}).phone?h('div',{class:'sub'},o.cust.phone):null)},{label:'Items',get:o=>String(o.lines.reduce((a,l)=>a+l.qty,0))},
 {label:'Amount',r:true,get:o=>inr(o.t.total)},{label:'Status',get:stPill},{label:'Time',get:o=>fmtDT(o.paidAt||o.created)}],rows,{empty:opts.empty||'No orders',emptyText:'Nothing to show for this view yet.',onRow:orderDetail})}
function orderDetail(o){
 modal('Order '+(o.no||''),[h('div',{class:'bar-row'},stPill(o),pill(o.type||'','n'),o.src?pill(o.src,'b'):null,h('span',{class:'sm'},fmtDT(o.paidAt||o.created)+(o.table?' · '+tn(o.table):''))),
  table([{label:'Item',get:l=>l.name+(l.size?' ('+l.size+')':'')},{label:'Qty',get:l=>String(l.qty)},{label:'Price',r:true,get:l=>inr(l.price)},{label:'Total',r:true,get:l=>inr(l.price*l.qty)}],o.lines),
  h('div',{class:'bar-row',style:'justify-content:flex-end;margin-top:12px'},h('span',{class:'sm'},'Subtotal '+inr(o.t.sub)+' · Discount '+inr(o.t.d||0)+' · GST '+inr(o.t.tax)),h('b',{style:'font-size:18px'},inr(o.t.total))),
  (o.pays||[]).length?h('div',{class:'sm'},'Paid via '+o.pays.map(p=>p.m+' '+inr(p.amt)).join(', ')):null,(o.cust||{}).name?h('div',{class:'sm'},'Customer: '+o.cust.name+' '+(o.cust.phone||'')):null,
  h('div',{class:'mf'},h('button',{class:'btn',onclick:()=>window.open('/order.html?id='+o.id,'_blank')},'Open invoice'))],{wide:true})}
const rangeFrom=()=>S.f.from||addDays(S.date,-6),rangeTo=()=>S.f.to||S.date;
const rangeBar=()=>h('div',{class:'bar-row'},h('input',{type:'date',class:'inp',style:'min-width:150px',value:rangeFrom(),onchange:e=>{S.f.from=e.target.value;render()}}),'to',h('input',{type:'date',class:'inp',style:'min-width:150px',value:rangeTo(),onchange:e=>{S.f.to=e.target.value;render()}}));
const inRange=o=>{const d=dayOf(o.paidAt||o.created);return d>=rangeFrom()&&d<=rangeTo()};
const orderQ=o=>matchQ([o.no,o.type,o.src,(o.cust||{}).name,(o.cust||{}).phone].join(' '));
PAGES['daily/live']=()=>{
 const os=orders().filter(o=>o.status=='open'&&!o.trial&&orderQ(o)).sort((a,b)=>b.created>a.created?1:-1),tab=S.f.live||'orders',tables={};os.filter(o=>o.table).forEach(o=>{(tables[o.table]=tables[o.table]||[]).push(o)});const kc=k=>os.filter(o=>o.kstat==k).length;
 return[pageHead('Live Orders','Running orders and tables across dine-in, takeaway and delivery.',h('a',{class:'btn',href:'/index.html'},'Open billing POS'),btn('Refresh',()=>{sync();render()},'',null)),allOutletsNote(),
  kpis([['Running orders',os.length],['Running tables',Object.keys(tables).length],['In kitchen',kc('new')+kc('preparing')],['Ready / out',kc('ready')+kc('dispatched')]]),
  h('div',{class:'bar-row'},tabsBar([['orders','Running Orders'],['tables','Running Tables']],tab,k=>{S.f.live=k;render()}),search('Search orders…')),
  card(tab=='tables'?table([{label:'Table',get:r=>h('b',{},tn(r[0])||'Table')},{label:'Orders',get:r=>r[1].map(o=>o.no).join(', ')},{label:'Amount',r:true,get:r=>inr(sum(r[1],o=>o.t.total))},{label:'Status',get:r=>stPill(r[1][0])}],Object.entries(tables),{empty:'No running tables',emptyText:'Tables with an open order appear here.'}):ordersTable(os,{empty:'No running orders'}))]};
PAGES['daily/all']=()=>{const rows=orders().filter(o=>inRange(o)&&orderQ(o)).sort((a,b)=>(b.paidAt||b.created)>(a.paidAt||a.created)?1:-1);
 return[pageHead('All Orders','Search, review and export the complete order history.',btn('Export CSV',()=>csvDl([['No','Type','Source','Customer','Phone','Total','Status','Time'],...rows.map(o=>[o.no,o.type,o.src||'',(o.cust||{}).name||'',(o.cust||{}).phone||'',o.t.total,o.status,o.paidAt||o.created])],'orders.csv'),'','dl')),allOutletsNote(),
  h('div',{class:'bar-row'},rangeBar(),search('Search order, customer, phone…')),kpis([['Orders',rows.length],['Sales',inr(sum(rows.filter(o=>o.status=='paid'),netOf))],['Void',rows.filter(o=>o.status=='void').length]]),card(ordersTable(rows,{empty:'No orders in this range'}))]};
PAGES['daily/online']=()=>{const base=orders().filter(o=>isOnline(o)&&inRange(o)&&orderQ(o)).sort((a,b)=>(b.paidAt||b.created)>(a.paidAt||a.created)?1:-1),plats=[...new Set(orders().filter(isOnline).map(o=>o.src))],pf=S.f.plat||'All',rows=pf=='All'?base:base.filter(o=>o.src==pf);
 return[pageHead('Online Orders','Orders from Zomato, Swiggy, your website or any other platform.',btn('Add online order',()=>onlineOrderForm(),'p','plus')),
  h('div',{class:'bar-row'},rangeBar(),search('Search…')),h('div',{class:'bar-row'},tabsBar([['All','All'],...plats.map(p=>[p,p])],pf,k=>{S.f.plat=k;render()})),kpis([['Orders',rows.length],['Revenue',inr(sum(rows,netOf))],['Commission (est.)',inr(sum(rows,o=>netOf(o)*((platformOf(o.src)||{}).commission||0)/100))]]),card(ordersTable(rows,{empty:'No online orders'}))]};
PAGES['daily/kot']=()=>{const f=S.f.from||addDays(S.date,-1),t=S.f.to||S.date,rows=L('kotlog').filter(k=>{const d=dayOf(k.createdAt);return d>=f&&d<=t&&matchQ([k.orderNo,(k.cust||{}).name,(k.cust||{}).phone].join(' '))}).sort((a,b)=>b.createdAt>a.createdAt?1:-1);
 const mins=rows.filter(k=>k.readyAt).map(k=>(new Date(k.readyAt)-new Date(k.createdAt))/60000);
 return[pageHead('Kitchen Tickets','Every KOT sent to the kitchen, and how long it took to be ready.',btn('Export CSV',()=>csvDl([['Order','Type','Table','Customer','Items','Sent','Ready (min)'],...rows.map(k=>[k.orderNo,k.type,tn(k.table),(k.cust||{}).name||'',k.items.map(x=>x.q+'x '+x.n).join('; '),k.createdAt,k.readyAt?Math.round((new Date(k.readyAt)-new Date(k.createdAt))/60000):''])],'kot.csv'),'','dl')),
  h('div',{class:'bar-row'},h('input',{type:'date',class:'inp',style:'min-width:150px',value:f,onchange:e=>{S.f.from=e.target.value;render()}}),'to',h('input',{type:'date',class:'inp',style:'min-width:150px',value:t,onchange:e=>{S.f.to=e.target.value;render()}}),search('Search order no / customer…')),
  kpis([['KOTs',rows.length],['Avg. prep time',mins.length?Math.round(mins.reduce((a,b)=>a+b,0)/mins.length)+' min':'—'],['Pending',rows.filter(k=>!k.readyAt).length]]),
  card(table([{label:'Order',get:k=>h('b',{},k.orderNo||'—')},{label:'Type',get:k=>k.type||''},{label:'Table',get:k=>tn(k.table)||'—'},{label:'Customer',get:k=>(k.cust||{}).name||'Guest'},{label:'Items',get:k=>k.items.map(x=>x.q+'× '+x.n).join(', ')},{label:'Sent',get:k=>fmtDT(k.createdAt)},{label:'Ready in',get:k=>k.readyAt?Math.max(0,Math.round((new Date(k.readyAt)-new Date(k.createdAt))/60000))+' min':pill('Pending','a')}],rows,{empty:'No KOTs',emptyText:'Nothing was sent to the kitchen in this range.'}))]};
PAGES['daily/due']=()=>{const rows=orders().filter(o=>o.status=='due'&&orderQ(o)).sort((a,b)=>b.created>a.created?1:-1),due=o=>o.t.total-(o.pays||[]).reduce((a,p)=>a+p.amt,0);
 return[pageHead('Due Payment','Credit bills waiting to be settled. Record the payment here or from the billing POS.'),allOutletsNote(),kpis([['Bills on credit',rows.length],['Total due',inr(sum(rows,due))]]),h('div',{class:'bar-row'},search('Search customer, phone, bill…')),
  card(table([{label:'Bill',get:o=>h('b',{},o.no)},{label:'Customer',get:o=>h('span',{},(o.cust||{}).name||'Guest',h('div',{class:'sub'},(o.cust||{}).phone||''))},{label:'Created',get:o=>fmtD(dayOf(o.created))},{label:'Paid so far',r:true,get:o=>inr((o.pays||[]).reduce((a,p)=>a+p.amt,0))},{label:'Due',r:true,get:o=>h('b',{},inr(due(o)))},{label:'',get:o=>actBtns(btn('Record payment',()=>settleDue(o),'sm2 p'))}],rows,{empty:'Nothing due',emptyText:'No credit bills are open.'}))]};
function settleDue(o){const due=r2(o.t.total-(o.pays||[]).reduce((a,p)=>a+p.amt,0));
 formModal('Record payment — '+o.no,[{k:'amt',label:'Amount received (₹)',type:'number',value:due,req:true},{k:'m',label:'Paid by',type:'select',options:[['cash','Cash'],['upi','UPI'],['card','Card']],value:'cash'}],async v=>{const c=structuredClone(o);c.pays=(c.pays||[]).concat({m:v.m,amt:Math.min(due,v.amt)});const left=r2(c.t.total-c.pays.reduce((a,p)=>a+p.amt,0));if(left<=0.5){c.status='paid';c.paidAt=now()}await save('order',c,c.id);toast(left<=0.5?'Bill settled':'Part payment recorded');render()})}
