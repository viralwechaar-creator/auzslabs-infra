import {roles} from './data.js';
import {button, esc, link} from './ecosystem.js';

export function careersPage(selectedRole,compact=false){
  const role=roles.find(item=>item.id===selectedRole)||roles[0];
  const partner=role.id==='developer';
  const projectFields=partner?
    '<label>Submission type<select name="kind"><option>Website template</option><option>Business app</option><option>Proposal</option></select></label><label>Project name<input name="project" maxlength="100" required></label><label class="wide">Portfolio or demo URL<input name="portfolio" type="url" required placeholder="https://"></label><label>Proposed price in ₹<input name="price" type="number" min="0" max="1000000" required></label><label>Proposed commission %<input name="commission" type="number" min="0" max="100" required></label>':
    '<label class="wide">Résumé or supporting PDF <small>Optional · up to 5 MB</small><input name="resume" type="file" accept="application/pdf,.pdf"></label>';
  const rolesList=roles.filter(item=>!compact||!partner&&item.id!=='developer').map(item=>'<button class="career-role" type="button" data-action="role:'+item.id+'" aria-pressed="'+(item.id===role.id)+'"><span><strong>'+esc(item.name)+'</strong><small>'+esc(item.description)+'</small></span><span aria-hidden="true">↗</span></button>').join('');
  const hero='<div class="careers-page"><section class="career-hero"><div class="wrap career-hero-grid"><div class="career-intro"><p class="career-kicker">Careers &amp; partnerships</p><h1>Build for businesses that do things their own way.</h1><p>Join the AUZslab team or bring your own theme or app to the businesses we serve.</p><div class="actions">'+button('Explore opportunities','career-jump','primary')+link('Track application','/contributor.html')+'</div></div><div class="career-visual" aria-hidden="true"></div></div></section>';
  return (compact?'':hero)+'<section class="'+(compact?'ct-career':'wrap career-work')+'" id="career-opportunities">'+
    (rolesList?'<div class="career-selection"><h2>Find your role</h2><div class="career-role-list" aria-label="Application category">'+rolesList+'</div></div>':'')+
    '<article class="career-apply" id="career-application"><header><h2 tabindex="-1">'+esc(role.name)+'</h2><p>'+esc(role.description)+'</p></header><ol class="career-progress" aria-label="Application progress"><li aria-current="step"><span>1</span> About you</li><li><span>2</span> '+(partner?'Your project':'Your experience')+'</li><li><span>3</span> Review</li></ol>'+
    '<form data-form="application" novalidate><fieldset class="career-step field-grid" data-step="0"><legend>Contact details</legend><label>Full name<input name="name" required maxlength="120" autocomplete="name"></label><label>Email<input name="email" type="email" required maxlength="180" autocomplete="email"></label><label>Phone <small>Optional</small><input name="phone" type="tel" maxlength="28" autocomplete="tel"></label><label>City<input name="city" required maxlength="100" autocomplete="address-level2"></label></fieldset>'+
    '<fieldset class="career-step field-grid" data-step="1" hidden><legend>'+(partner?'Project details':'Experience')+'</legend>'+projectFields+'<label class="wide">'+(partner?'What does your project do?':'Tell us about your experience')+'<textarea name="experience" required maxlength="3000" rows="5"></textarea></label></fieldset>'+
    '<fieldset class="career-step" data-step="2" hidden><legend>Review your application</legend><dl class="career-review"></dl><p class="career-note">Use fictional details. Submissions in this preview are saved in this browser.</p></fieldset>'+
    '<div class="career-form-actions"><span class="career-step-count">Step 1 of 3</span><div class="actions"><button type="button" class="btn" data-action="career-back" hidden>Back</button><button type="button" class="btn primary" data-action="career-next">Continue</button><button class="btn primary" type="submit" hidden>Submit for review</button></div></div><output role="status"></output></form></article></section>'+(compact?'':'</div>');
}

export function careerStep(form,step,focus=true){
  form.dataset.step=step;
  form.querySelectorAll('.career-step').forEach(panel=>{panel.hidden=Number(panel.dataset.step)!==step;});
  form.querySelector('[data-action=career-back]').hidden=step===0;
  form.querySelector('[data-action=career-next]').hidden=step===2;
  form.querySelector('[type=submit]').hidden=step!==2;
  form.querySelector('.career-step-count').textContent='Step '+(step+1)+' of 3';
  form.closest('.career-apply').querySelectorAll('.career-progress li').forEach((item,index)=>{
    if(index===step)item.setAttribute('aria-current','step');else item.removeAttribute('aria-current');
    item.classList.toggle('is-complete',index<step);
  });
  if(step===2){
    const values=new FormData(form);
    const labels={name:'Name',email:'Email',phone:'Phone',city:'City',kind:'Submission type',project:'Project',portfolio:'Portfolio',price:'Price (₹)',commission:'Commission (%)',resume:'PDF',experience:'Summary'};
    form.querySelector('.career-review').innerHTML=Object.entries(labels).map(([name,label])=>{
      const value=values.get(name);
      const text=value instanceof File?value.name:value;
      return text?'<div><dt>'+label+'</dt><dd>'+esc(text)+'</dd></div>':'';
    }).join('');
  }
  if(focus)(form.querySelector('[data-step="'+step+'"] :is(input,textarea,select)')||form.querySelector('[type=submit]')).focus({preventScroll:true});
}

export function validateCareerStep(form,step){
  const invalid=[...form.querySelectorAll('[data-step="'+step+'"] :is(input,textarea,select)')].find(field=>!field.checkValidity());
  if(!invalid)return true;
  careerStep(form,step,false);
  invalid.reportValidity();
  return false;
}
