/* Website & Booking: the public mini-site content (site.html), QR-ordering banners, and (salon only) the
   public booking page's hours/brand palette (booking.html/i.html). Ported from backoffice.html's Settings > Website
   and > Booking panes -- backoffice is retired, this is the only place left to edit any of this. */
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
PAGES['mgmt/website']=()=>{const c=cfg(),isSalon=c.bizType=='salon';
 return[pageHead('Website & Booking','Content for your public mini-site'+(isSalon?' and booking page':'')+'.',h('a',{class:'btn',target:'_blank',rel:'noopener',href:isSalon?'/booking.html':'/site.html'},'Preview ↗')),ownerOnly(),
 card(cardHead('Website'),h('div',{class:'fgrid'},
  siteField('siteKicker','Small tagline above headline'),siteField('siteTag','Headline',{wide:true,area:true,hint:'Press Enter for a line break'}),siteField('siteSub','Subheading'),
  siteField('siteHours','Opening hours text'),siteField('siteInsta','Instagram link (optional)'),siteField('siteMaps','Google Maps link (optional)'),
  siteField('siteAbout','About text',{wide:true,area:true}),siteImage('siteHero','Hero photo'),siteImage('siteAboutImg','About-section photo'),
  siteGallery('siteGallery','Gallery photos','gallery'))),
 card(cardHead('QR ordering banners'),note('Shown to customers the moment they scan a table\'s QR code, above the menu -- combos, today\'s offer, anything worth putting in front of someone about to order.'),
  h('div',{class:'fgrid'},siteGallery('qrBanners','Banner photos','qrbanner'))),
 isSalon?card(cardHead('Booking hours'),h('div',{class:'fgrid'},siteField('bookingOpen','Opens at (24h, e.g. 10:00)'),siteField('bookingClose','Closes at (24h, e.g. 20:00)'),siteField('bookingSlotMinutes','Slot length (minutes)',{type:'number'}),siteField('bookingSlotCapacity','Appointments per slot',{type:'number'}))):null,
 isSalon?card(cardHead('Brand palette'),note('The main brand colour is "Brand colour" under Management → Configuration. These fill in the rest of the palette for the booking page and invoice; the logo there is used here too.'),
  h('div',{class:'fgrid'},brandField('cream','Cream / light accent (hex)'),brandField('gold','Gold / highlight (hex)'),brandField('goldD','Darker gold, for marks on white (hex)'),brandField('taupe','Taupe / muted accent (hex)'),brandField('tint','Very light background tint (hex)'),brandField('line','Divider line colour (hex)'),brandField('muted','Muted text colour (hex)'),brandField('font','Font name (e.g. Hanken Grotesk)'),brandField('fontUrl','Google Fonts stylesheet URL for that font'))):null];
};
