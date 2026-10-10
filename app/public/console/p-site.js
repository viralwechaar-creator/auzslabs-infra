/* Website & Booking: the public mini-site content (site.html) and (salon only) the public booking
   page's hours/brand palette (booking.html/i.html). Ported from backoffice.html's Settings > Website
   and > Booking panes -- backoffice is retired, this is the only place left to edit any of this.
   QR ordering customization (the banners shown when a customer scans a table's QR code) used to be a
   card on this same page -- it's now its own page, PAGES['qr/ordering'] below, deliberately left out
   of NAV (core.js) so it's not just another item buried in the console's own sidebar. The only way in
   is the "QR Ordering" row the POS app's own Settings/More page (pos/staff.js) links to directly --
   and that row itself only appears for a tenant that actually has the self_order feature, same check
   this page enforces again server-side-equivalent (S.features), since a deep link to #qr/ordering
   would otherwise bypass that. */
const selfOrderOn=()=>!!(S.features&&S.features.self_order===true&&S.enabledFeatures.self_order!==false);
const siteField=(k,label,o={})=>h('div',{class:'fld'+(o.wide?' s2':'')},h('label',{},label),o.area?h('textarea',{disabled:S.role!='owner',onchange:e=>saveSettings({[k]:e.target.value})},cfg()[k]||''):h('input',{type:o.type||'text',disabled:S.role!='owner',value:cfg()[k]??'',placeholder:o.ph||'',onchange:e=>saveSettings({[k]:e.target.value}).then(r=>r!==false&&toast('Saved'))}),o.hint?h('div',{class:'hint'},o.hint):null);
const siteImage=(k,label)=>{const prev=h('div',{class:'hint'},cfg()[k]?'Photo is set':'No photo yet'),inp=h('input',{type:'file',accept:'image/*',disabled:S.role!='owner'});
 inp.onchange=async()=>{const file=inp.files[0];if(!file)return;prev.textContent='Uploading…';try{const url=await uploadImage(file,'site');await saveSettings({[k]:url});prev.textContent='Uploaded';toast('Saved')}catch(e){prev.textContent='Upload failed: '+e.message}};
 return h('div',{class:'fld'},h('label',{},label),inp,prev)};
// a gallery/banner field is a growing, comma-joined list of URLs rather than one image -- each upload appends.
const siteGallery=(k,label,prefix,hint)=>{const n=(cfg()[k]||'').split(',').filter(Boolean).length,prev=h('div',{class:'hint'},n+' photo(s)'),inp=h('input',{type:'file',accept:'image/*',multiple:true,disabled:S.role!='owner'});
 inp.onchange=async()=>{const files=[...inp.files];if(!files.length)return;prev.textContent='Uploading '+files.length+'…';try{const urls=[];for(const f of files)urls.push(await uploadImage(f,prefix));const existing=(cfg()[k]||'').split(',').filter(Boolean);await saveSettings({[k]:[...existing,...urls].join(',')});prev.textContent=(existing.length+urls.length)+' photo(s)';toast('Saved')}catch(e){prev.textContent='Upload failed: '+e.message}};
 const clearBtn=n?btn('Clear all',async()=>{await saveSettings({[k]:''});render()},'sm2'):null;
 return h('div',{class:'fld s2'},h('label',{},label),hint?h('div',{class:'hint',style:'margin-bottom:4px'},hint):null,h('div',{class:'bar-row'},inp,clearBtn),prev)};
const brandField=(k,label)=>h('div',{class:'fld'},h('label',{},label),h('input',{disabled:S.role!='owner',value:(cfg().brand||{})[k]||'',onchange:e=>saveSettings({brand:{...(cfg().brand||{}),[k]:e.target.value}}).then(r=>r!==false&&toast('Saved'))}));
PAGES['mgmt/website']=()=>{const c=cfg(),isSalon=c.bizType=='salon',isBespoke=window.TENANT_SLUG=='chapterone';
 return[pageHead('Website & Booking','Content for your public mini-site'+(isSalon?' and booking page':'')+'.'+(isBespoke?' Your website has its own custom design -- these fields fill in its headline, hero photo, about text and photo, hours and contact details. Your logo (Management -> Configuration) appears there too.':''),h('a',{class:'btn',href:tenantOrigin()+(isSalon?'/booking.html':isBespoke?'/chapterone/index.html':'/site.html')},'Preview ↗')),ownerOnly(),
 card(cardHead('Website'),h('div',{class:'fgrid'},
  siteField('siteKicker','Small tagline above headline'),siteField('siteTag','Headline',{wide:true,area:true,hint:'Press Enter for a line break'}),siteField('siteSub','Subheading'),
  siteField('siteHours','Opening hours text'),siteField('siteInsta','Instagram link (optional)'),siteField('siteMaps','Google Maps link (optional)'),
  siteField('siteAbout','About text',{wide:true,area:true}),siteImage('siteHero','Hero photo'),siteImage('siteAboutImg','About-section photo'),
  siteGallery('siteGallery','Gallery photos','gallery'))),
 isSalon?card(cardHead('Booking hours'),h('div',{class:'fgrid'},siteField('bookingOpen','Opens at (24h, e.g. 10:00)'),siteField('bookingClose','Closes at (24h, e.g. 20:00)'),siteField('bookingSlotMinutes','Slot length (minutes)',{type:'number'}),siteField('bookingSlotCapacity','Appointments per slot',{type:'number'}))):null,
 isSalon?card(cardHead('Brand palette'),note('The main brand colour is "Brand colour" under Management → Configuration. These fill in the rest of the palette for the booking page and invoice; the logo there is used here too.'),
  h('div',{class:'fgrid'},brandField('cream','Cream / light accent (hex)'),brandField('gold','Gold / highlight (hex)'),brandField('goldD','Darker gold, for marks on white (hex)'),brandField('taupe','Taupe / muted accent (hex)'),brandField('tint','Very light background tint (hex)'),brandField('line','Divider line colour (hex)'),brandField('muted','Muted text colour (hex)'),brandField('font','Font name (e.g. Hanken Grotesk)'),brandField('fontUrl','Google Fonts stylesheet URL for that font'))):null];
};
// QR Ordering: deliberately its own page, not in NAV (core.js) -- see this file's header comment.
// Reached only via the "QR Ordering" row on the POS app's own Settings/More page, and only when the
// tenant actually has the self_order feature; re-checked here too, since a direct #qr/ordering deep
// link would otherwise skip that check entirely.
PAGES['qr/ordering']=()=>{
 if(!selfOrderOn())return[pageHead('QR Ordering','Let customers scan a table\'s QR code and order straight from their phone.'),
  card(cardHead('Not part of your plan'),note('AUZsPOS QR adds customer self-ordering by QR code, plus this page to customize what they see.'),
   h('div',{class:'mf'},h('a',{class:'btn',href:'https://auzslab.in/qr-ordering.html',target:'_blank',rel:'noopener'},'Learn more'),h('a',{class:'btn p',href:'https://auzslab.in/pricing.html',target:'_blank',rel:'noopener'},'See pricing')))];
 return[pageHead('QR Ordering','What customers see the moment they scan a table\'s QR code.',h('a',{class:'btn',href:tenantOrigin()+'/site.html'},'Preview ↗')),ownerOnly(),
 card(cardHead('Ordering banners'),note('Shown above the menu right after the scan -- combos, today\'s offer, anything worth putting in front of someone about to order.'),
  h('div',{class:'fgrid'},siteGallery('qrBanners','Banner photos','qrbanner'))),
 card(cardHead('Table QR codes'),note('Print or re-print the QR codes customers scan at each table.'),
  h('div',{class:'mf'},h('a',{class:'btn',href:'#',onclick:e=>{e.preventDefault();go('menu/tables')}},'Open Tables & Areas'))),
 card(cardHead('Pay by UPI'),note('When set, a customer ordering online (dine-in or takeaway) can choose "Pay by UPI" and gets a QR code already filled in with the exact order amount, paying straight to this UPI ID -- the same scan-and-pay a shop sticker uses, not a payment gateway. We cannot confirm the payment automatically: check it reached your account the same way you would any UPI payment, before handing over the order. Leave blank to only offer "Pay at counter / on pickup".'),
  h('div',{class:'fgrid'},siteField('upiId','UPI ID (e.g. yourshop@okaxis)'),siteField('upiName','Name shown to the payer',{hint:'Defaults to your business name if left blank'})))];
};
