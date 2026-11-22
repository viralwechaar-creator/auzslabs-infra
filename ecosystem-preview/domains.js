import {$, badge, button, close, dialog, esc, flash, money, pathFor, rerender, save, state, uid} from './ecosystem.js';

const hostname=/^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const quotes={com:1099,in:799,store:1699};
const field='<label>Domain name<input name="hostname" required maxlength="253" placeholder="example.com" autocomplete="off"></label>';
const form=(action,fields,label)=>'<form data-form="domains" data-domain-action="'+action+'">'+fields+'<div class="actions"><button class="btn primary">'+label+'</button></div><output role="status"></output></form>';
const entries=()=>state.domains||=[];
const primary=()=>state.primaryPreviewDomain||state.business.domain;
const panel=(title,content)=>'<section class="panel"><div class="panel-title"><h2>'+title+'</h2></div><div class="panel-body">'+content+'</div></section>';
const recordTable=rows=>'<div class="table-scroll"><table><tbody>'+rows.map(record=>'<tr><td><strong>'+esc(record.name)+'</strong><br><small>'+esc(record.kind)+'</small></td><td>'+badge(record.name===primary()?'Primary preview':record.status)+'</td><td>'+(record.id?button('Manage','domain-record:'+record.id,'compact'):'')+'</td></tr>').join('')+'</tbody></table></div>';
export function domainPage(){
  return '<div class="page-head"><div><a class="trail" href="'+pathFor('website')+'">Online store</a><h1>Domains</h1><p>Connect a domain you own or review a registration estimate.</p></div><div class="actions">'+button('Connect existing domain','domain-connect')+button('Find a domain','domain-buy','primary')+'</div></div>'+
    panel('Store domains',recordTable([{name:state.business.domain,kind:'Default storefront address',status:'Default'},...entries()]))+
    panel('How domain setup works','<div class="stack"><p><strong>Bring your own domain.</strong> Prove ownership with a TXT record, then verify the storefront DNS target. Renew the domain through your current registrar.</p><p><strong>Register a new domain.</strong> Review the first-year and renewal estimate. This preview can save a registration request.</p></div>');
}
function openRecord(record){
  if(record.kind==='Registration request'){
    dialog(record.name,'<div class="stack"><p>'+badge('Draft request')+'</p><p>First year · '+money(record.price)+'</p><p>Annual renewal estimate · '+money(record.renewal)+'</p><p>Auto-renew preference · '+(record.auto?'On':'Off')+'</p><p>Registrar availability, billing, and registration are required to complete this request.</p></div>');
    return;
  }
  dialog(record.name,'<div class="stack"><p>'+badge(record.status)+'</p><p>Add this TXT record at your domain provider to verify that you control the domain.</p>'+
    '<div class="muted-box"><small>TXT host</small><br><strong>_auzslab-verify.'+esc(record.name)+'</strong><br><small>TXT value</small><br><strong>'+esc(record.token)+'</strong></div>'+
    '<p>Pointing a domain to the store requires the DNS target and TLS setup for your deployment. This preview checks ownership only.</p>'+
    '<div class="actions">'+button('Verify TXT record','domain-verify:'+record.id)+(record.status==='Ownership verified'?button('Set as preview primary','domain-primary:'+record.id):'')+'</div><output id="domain-feedback" role="status"></output></div>');
}
export function domainDispatch(type,target){
  if(type==='submit'&&target.dataset.form==='domains'){
    const fields=new FormData(target),name=String(fields.get('hostname')).trim().toLowerCase().replace(/\.$/,'');
    const output=target.querySelector('output');
    if(!hostname.test(name)){output.textContent='Enter a hostname such as example.com.';return true;}
    if(entries().some(record=>record.name===name)||name===state.business.domain){output.textContent='This domain is already in your workspace.';return true;}
    const action=target.dataset.domainAction;
    if(action==='search'){
      const suffix=name.split('.').at(-1),estimate=quotes[suffix];
      if(!estimate){output.textContent='Preview estimates are available for .com, .in, and .store.';return true;}
      dialog('Review domain request','<p class="compact-copy">Illustrative prices. Registrar availability is checked when registration is connected.</p>'+form('request','<input type="hidden" name="hostname" value="'+esc(name)+'"><div class="stack"><strong>'+esc(name)+'</strong><p>First year estimate · '+money(estimate)+'</p><p>Annual renewal estimate · '+money(estimate)+'</p><label class="inline"><input type="checkbox" name="auto" checked> Auto-renew preference</label></div>','Save registration request'));
      return true;
    }
    const record=action==='request'?{id:uid(),name,kind:'Registration request',status:'Draft request',price:quotes[name.split('.').at(-1)],renewal:quotes[name.split('.').at(-1)],auto:fields.has('auto')}:{id:uid(),name,kind:'External domain',status:'Awaiting DNS',token:'auzslab-'+uid()};
    entries().push(record);save('Saved in this browser.');rerender();openRecord(record);return true;
  }
  if(type!=='click'||!target.dataset.action?.startsWith('domain-'))return false;
  const [action,id]=target.dataset.action.split(':'),record=entries().find(item=>item.id===id);
  if(action==='domain-connect')dialog('Connect existing domain',form('connect',field,'Get DNS instructions'));
  else if(action==='domain-buy')dialog('Find a domain',form('search',field,'Review estimate'));
  else if(action==='domain-record'&&record)openRecord(record);
  else if(action==='domain-primary'&&record?.status==='Ownership verified'){state.primaryPreviewDomain=record.name;save('Primary preview domain updated.');close();rerender();}
  else if(action==='domain-verify'&&record){
    const output=$('#domain-feedback');target.disabled=true;output.textContent='Checking public DNS…';
    const query=new URLSearchParams({name:record.name,token:record.token});
    fetch('/api/domains/verify?'+query).then(async response=>{
      if(!response.ok)throw Error('DNS could not be checked.');
      const result=await response.json();
      if(!result.verified){output.textContent='The TXT record is not visible yet. Check the value at your provider and try again.';return;}
      record.status='Ownership verified';save('DNS ownership verified.');rerender();openRecord(record);
    }).catch(error=>{output.textContent=error.message;}).finally(()=>{target.disabled=false;});
  }else return false;
  return true;
}
