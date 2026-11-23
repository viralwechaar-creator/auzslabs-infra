/* Contact hub: pick who you are, get the right form. Sends through the public submit_contact function. */
(function () {
  var A = {
    business: { label: 'Business owner', desc: 'Find the right setup for your business.', h: 'Tell us how your business works.', mono: 'CONTACT' },
    developer: { label: 'Developer or designer', desc: 'Submit a theme or app, or tell us your idea.', h: 'Bring your theme or app to AUZslab.', mono: 'DEVELOPER PARTNERS' },
    career: { label: 'Job seeker', desc: 'Explore roles and apply to join the team.', h: 'Find your place at AUZslab.', mono: 'CAREERS' },
    general: { label: 'Something else', desc: 'Ask a question or tell us how we can help.', h: 'What can we help you with?', mono: 'CONTACT' }
  };
  var ROLES = ['Sales and onboarding', 'Customer support', 'Design', 'Engineering', 'Marketing', 'Something else'];
  var TYPES = ['Cafe or restaurant', 'Salon or studio', 'Retail or bookstore', 'Clothing or footwear', 'Mobile shop', 'Something else'];
  var NICHE = { 'Cafe or restaurant': 'cafe', 'Salon or studio': 'salon', 'Retail or bookstore': 'retail', 'Clothing or footwear': 'retail', 'Mobile shop': 'mobile', 'Something else': '' };
  var root = document.getElementById('ctHub'), side = document.getElementById('ctPick'), head = document.querySelector('.ac-h'), mono = document.querySelector('.ac-mono');
  if (!root) return;
  var q = new URLSearchParams(location.search), kind = A[q.get('as')] ? q.get('as') : (q.get('role') === 'developer' ? 'developer' : '');
  function e(t, a, c) { var n = document.createElement(t); for (var k in a || {}) { if (k === 'text') n.textContent = a[k]; else n.setAttribute(k, a[k]); } (c || []).forEach(function (x) { if (x) n.append(x); }); return n; }
  function field(label, input, wide, opt) { var l = e('label', wide ? { class: 'wide' } : {}, [document.createTextNode(label + ' ')]); if (opt) l.append(e('small', { text: '(optional)' })); l.append(input); return l; }
  function sel(name, list, req) { var s = e('select', { name: name }); if (req) s.required = true; s.append(e('option', { value: '', text: 'Select' })); list.forEach(function (o) { s.append(e('option', { text: o })); }); return s; }
  function picker() {
    side.replaceChildren(e('h2', { class: 'ct-role-title', text: 'Which option describes you?' }));
    Object.keys(A).forEach(function (k) {
      var a = e('a', { class: 'ct-path-choice', href: 'contact.html?as=' + k }, [e('strong', { text: A[k].label }), e('span', { text: A[k].desc })]);
      if (k === kind) a.setAttribute('aria-current', 'page');
      a.onclick = function (ev) { ev.preventDefault(); kind = k; history.replaceState(null, '', 'contact.html?as=' + k); paint(); };
      side.append(a);
    });
  }
  function form() {
    var f = e('form', { class: 'ct-hubform', novalidate: '' });
    var name = e('input', { name: 'name', autocomplete: 'name', maxlength: 120, required: '' }), email = e('input', { name: 'email', type: 'email', autocomplete: 'email', maxlength: 180, required: '' }), phone = e('input', { name: 'phone', type: 'tel', autocomplete: 'tel', maxlength: 28 });
    var msg = e('textarea', { name: 'message', rows: 4, maxlength: 3000, required: '' });
    var hp = e('input', { name: 'hp', tabindex: -1, autocomplete: 'off', style: 'position:absolute;left:-9999px;width:1px;height:1px', 'aria-hidden': 'true' });
    var kids = [field('Full name', name), field('Email', email), field('Phone', phone, 0, 1)];
    if (kind === 'business') {
      var svc = (q.get('service') || '').slice(0, 120); if (svc) msg.value = "I'd like to learn more about " + svc + '.\n\n';
      kids.push(field('Business name', e('input', { name: 'business', maxlength: 120 }), 0, 1), field('Business type', sel('business_type', TYPES, 1), 1), field('What would you like to set up?', msg, 1));
    } else if (kind === 'career') {
      kids.push(field('Role you are interested in', sel('role', ROLES, 1), 1), field('Link to your work or profile', e('input', { name: 'link', type: 'url', maxlength: 300, placeholder: 'https://' }), 1, 1), field('Tell us about yourself', msg, 1), field('Résumé (PDF, up to 5 MB)', e('input', { name: 'resume', type: 'file', accept: 'application/pdf,.pdf' }), 1, 1));
    } else if (kind === 'developer') {
      kids.push(field('What are you offering?', sel('role', ['Website theme', 'Business app', 'Something else'], 1), 1), field('Link to your work', e('input', { name: 'link', type: 'url', maxlength: 300, placeholder: 'https://' }), 1, 1), field('Tell us about the idea', msg, 1));
    } else {
      kids.push(field('What is this about?', sel('topic', ['General enquiry', 'Product support', 'Partnership'], 0), 1), field('How can we help?', msg, 1));
    }
    var out = e('output', { class: 'wide', role: 'status' }), go = e('button', { type: 'submit', class: 'btn primary', text: kind === 'career' ? 'Send application' : 'Send message' });
    f.append.apply(f, kids.concat([hp, e('div', { class: 'wide ct-form-actions' }, [go]), out]));
    f.onsubmit = function (ev) {
      ev.preventDefault(); out.textContent = '';
      if (!f.checkValidity()) { f.reportValidity(); return; }
      var file = kind === 'career' ? (f.querySelector('[name=resume]').files || [])[0] : null;
      if (file && (file.size > 5 * 1024 * 1024 || !/pdf/i.test(file.type + file.name))) { out.textContent = 'Please attach a PDF up to 5 MB.'; return; }
      var d = {}; new FormData(f).forEach(function (v, k) { if (k !== 'resume') d[k] = String(v).trim(); });
      d.kind = kind; if (kind === 'business') d.niche = NICHE[d.business_type] || '';
      go.disabled = true;
      var API = 'https://api.auzslab.in';
      var req = kind === 'career'
        ? fetch(API + '/rpc/submit_job_application', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p_name: d.name, p_email: d.email, p_phone: d.phone || '', p_note: ['Role: ' + (d.role || ''), d.link ? 'Link: ' + d.link : '', d.message].filter(Boolean).join('\n'), p_hp: d.hp || '' }) })
        : fetch(API + '/rpc/submit_contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p: d }) });
      req
        .then(function (r) { return r.ok ? r.json().catch(function () { return {}; }) : r.json().then(function (j) { throw new Error(j.error || j.message || 'failed'); }); })
        .then(function (data) { var id = data && (data.id || (data.data && data.data.id)); if (kind === 'career' && id && file) return fetch(API + '/storage/job-application-resume/' + id, { method: 'POST', body: file }).catch(function () {}); })
        .then(function () { f.reset(); out.textContent = kind === 'career' ? 'Thank you. We have your application and will reply by email.' : 'Thank you. We will get back to you soon.'; })
        .catch(function (er) { out.textContent = /429|too many/i.test(er.message) ? 'Too many requests. Please try again in a while.' : (er.message && er.message.length < 120 ? er.message : 'Could not send right now. Please try again, or call us.'); })
        .then(function () { go.disabled = false; });
    };
    return f;
  }
  function paint() {
    picker();
    var a = A[kind || 'general'];
    if (head) head.textContent = kind ? a.h : 'How can we help you?'; if (mono) mono.textContent = a.mono;
    document.title = (kind ? a.h : 'Contact') + ' | AUZslab';
    root.replaceChildren();
    if (!kind) { root.append(e('p', { class: 'ct-choice-prompt', text: 'Choose an option on the right to open the right form.' })); }
    else {
      if (kind === 'developer') root.append(e('p', { class: 'ct-note' }, [document.createTextNode('Already have a developer account? '), e('a', { href: '/theme-dev.html', text: 'Open the theme developer portal' }), document.createTextNode('. Otherwise tell us about your idea below.')]));
      root.append(form());
    }
    root.append(e('nav', { class: 'ct-shortcuts', 'aria-label': 'Opportunities' }, [e('a', { href: 'careers.html', text: 'Careers' }), e('a', { href: 'submit-theme.html', text: 'Submit a theme' })]));
  }
  [['a[href^="tel:"]', 'Call AUZslab'], ['a[href^="https://wa.me/"]', 'Message AUZslab on WhatsApp'], ['a[href^="mailto:"]', 'Email AUZslab']].forEach(function (x) {
    var a = document.querySelector('.ac-rail ' + x[0]); if (a) { a.setAttribute('aria-label', x[1]); a.setAttribute('title', x[1]); }
  });
  var wa = document.querySelector('.ac-rail a[href^="https://wa.me/"] path'); if (wa) wa.setAttribute('d', 'M4 20l1-4a8 8 0 1 1 3 3l-4 1Z M9 9c.7 2.7 2.3 4.3 5 5');
  paint();
})();
