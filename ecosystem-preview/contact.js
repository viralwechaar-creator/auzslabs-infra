import {careersPage} from './careers.js';
import {esc, now, save, state, uid} from './ecosystem.js';

const audiences={
  business:{label:'Business owner',description:'Find the right setup for your business.',heading:'Tell us how your business works.'},
  developer:{label:'Developer or designer',description:'Submit a theme or app, or tell us your idea.',heading:'Bring your theme or app to AUZslab.'},
  job:{label:'Job seeker',description:'Explore roles and apply to join the team.',heading:'Find your place at AUZslab.'},
  general:{label:'Something else',description:'Ask a question or tell us how we can help.',heading:'What can we help you with?'},
};

export function contactAudience(){
  const params=new URLSearchParams(location.search);
  if(location.pathname==='/submit-theme.html'||params.get('role')==='developer')return 'developer';
  if(['/careers.html','/join.html'].includes(location.pathname))return 'job';
  return Object.hasOwn(audiences,params.get('as'))?params.get('as'):'';
}

function enquiryForm(audience){
  const business=audience==='business';
  const service=business?(new URLSearchParams(location.search).get('service')||'').trim().slice(0,120):'';
  const message=service?'I’d like to learn more about '+service+'.\n\n':'';
  return '<section class="ct-enquiry"><h2>'+(business?'Tell us about your business':'Send an enquiry')+'</h2>'+
    '<form data-form="contact-enquiry" data-audience="'+audience+'" class="field-grid">'+
    '<label>Full name<input name="name" autocomplete="name" maxlength="120" required></label>'+
    '<label>Email<input name="email" type="email" autocomplete="email" maxlength="180" required></label>'+
    '<label>Phone <small>Optional</small><input name="phone" type="tel" autocomplete="tel" maxlength="28"></label>'+
    (business?'<label>Business name <small>Optional</small><input name="business" autocomplete="organization" maxlength="120"></label>'+
      '<label class="wide">Business type<select name="niche" required><option value="">Select a business type</option><option>Retail</option><option>Salon or studio</option><option>Café or restaurant</option><option>Online store</option><option>Other</option></select></label>':
      '<label>What is this about?<select name="topic"><option>General enquiry</option><option>Product support</option><option>Partnership</option></select></label>')+
    '<label class="wide">'+(business?'What would you like to set up?':'How can we help?')+'<textarea name="message" rows="4" maxlength="3000" required>'+esc(message)+'</textarea></label>'+
    '<div class="wide ct-form-actions"><p>Local preview. Use sample details.</p><button type="submit" class="btn primary">Submit request</button></div>'+
    '<output class="wide" role="status"></output></form></section>';
}

export function renderContactHub(mount,selectedRole){
  const audience=contactAudience();
  const root=mount.closest('.ac-main');
  const tablet=root.closest('.ac-tablet');
  const side=tablet.querySelector('.ac-side');
  const title=location.pathname==='/join.html'?'Join the AUZslab team.':audiences[audience]?.heading||'How can we help you?';
  root.querySelector('.ac-h').textContent=title;
  root.querySelector('.ac-mono').textContent=audience==='developer'?'DEVELOPER PARTNERS':audience==='job'?'CAREERS':'CONTACT';
  document.title=title+' — AUZslab';
  const roleLinks=Object.entries(audiences).map(([id,item])=>'<a class="ct-path-choice" href="/contact.html?as='+id+'" data-contact-choice'+
    (audience===id?' aria-current="page"':'')+'><strong>'+esc(item.label)+'</strong><span>'+esc(item.description)+'</span></a>').join('');
  side.innerHTML='<h2 class="ct-role-title" id="ct-role-title">Which option describes you?</h2><nav class="ct-role-picker" aria-labelledby="ct-role-title">'+roleLinks+'</nav>';
  const rail=tablet.querySelector('.ac-rail');
  for(const [selector,label] of [['a[href^="tel:"]','Call AUZslab'],['a[href^="https://wa.me/"]','Message AUZslab on WhatsApp'],['a[href^="mailto:"]','Email AUZslab']]){
    rail.querySelector(selector)?.setAttribute('aria-label',label);
  }
  rail.querySelector('a[href^="https://wa.me/"] path')?.setAttribute('d','M4 20l1-4a8 8 0 1 1 3 3l-4 1Z M9 9c.7 2.7 2.3 4.3 5 5');
  const shortcuts='<nav class="ct-shortcuts" aria-label="Opportunities"><a href="/careers.html">Careers</a><a href="/submit-theme.html">Submit a theme</a><a href="/join.html">Join AUZslab</a></nav>';
  const role=audience==='developer'?'developer':selectedRole==='developer'?'open':selectedRole;
  const body=audience==='developer'||audience==='job'?careersPage(role,true)+'<a class="ct-track" href="/contributor.html">Track an application</a>':
    audience?enquiryForm(audience):'<p class="ct-choice-prompt">Choose an option to open the right form.</p>';
  mount.innerHTML=body+shortcuts;
}

export function saveContactEnquiry(form){
  const audience=form.dataset.audience;
  if(!['business','general'].includes(audience))return;
  const values=Object.fromEntries([...new FormData(form)].map(([key,value])=>[key,String(value).trim()]));
  const output=form.querySelector('output');
  if(!values.name||!values.message){output.textContent='Enter your name and a short message.';return;}
  const requests=state.contactEnquiries||=[];
  requests.unshift({...values,audience,id:uid(),submitted:now()});
  if(!save()){requests.shift();output.textContent='Your request could not be saved. Your entries are still here.';return;}
  form.reset();
  output.textContent='Your request was saved in this browser for local review.';
}

export function contactReview(){
  return '<section class="wrap public-block contact-review"><h2>Contact requests</h2><div class="stack">'+
    ((state.contactEnquiries||[]).map(item=>'<article class="card"><div class="card-body"><h3>'+esc(item.business||item.name)+'</h3><p>'+
      esc([audiences[item.audience]?.label,item.name,item.email,item.phone,item.niche||item.topic,item.submitted].filter(Boolean).join(' · '))+
      '</p><p>'+esc(item.message)+'</p></div></article>').join('')||'<p>No requests in this browser yet.</p>')+'</div></section>';
}
