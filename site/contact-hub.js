/* Contact hub: pick who you are, get the right form. Sends through the public submit_contact function. */
(function () {
  var A = {
    business: { label: 'Business owner', desc: 'Find the right setup for your business.', h: 'Tell us how your business works.', mono: 'CONTACT' },
    developer: { label: 'Developer or designer', desc: 'Submit a theme or app, or tell us your idea.', h: 'Bring your theme or app to AUZslab.', mono: 'DEVELOPER PARTNERS' },
    career: { label: 'Join AUZslab', desc: 'Tell us who you are and how you would like to work with us.', h: 'Find your place at AUZslab.', mono: 'JOIN US' },
    general: { label: 'Something else', desc: 'Ask a question or tell us how we can help.', h: 'What can we help you with?', mono: 'CONTACT' }
  };
  var ROLES = ['Developer', 'Designer', 'Sales or field representative', 'Customer support', 'Setup and onboarding', 'Marketing and content', 'Something else'];
  var WORK = ['Full time', 'Part time', 'Freelance or per project', 'Not sure yet'];
  var WHEN = ['As soon as possible', 'This month', 'Just exploring'];
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
      kids.push(field('Business name', e('input', { name: 'business', maxlength: 120 }), 0, 1), field('City', e('input', { name: 'city', maxlength: 80, autocomplete: 'address-level2' }), 0, 1), field('Business type', sel('business_type', TYPES, 1), 0), field('When would you like to start?', sel('when', WHEN, 0), 0, 1), field('What would you like to set up?', msg, 1));
    } else if (kind === 'career') {
      kids.push(field('I am a', sel('role', ROLES, 1), 0), field('How would you like to work with us?', sel('work', WORK, 0), 0, 1), field('City', e('input', { name: 'city', maxlength: 80, autocomplete: 'address-level2' }), 0, 1), field('Link to your work or profile', e('input', { name: 'link', type: 'url', maxlength: 300, placeholder: 'https://' }), 0, 1), field('Tell us about yourself', msg, 1));
    } else if (kind === 'developer') {
      kids.push(field('What are you offering?', sel('role', ['Website theme', 'Business app', 'Something else'], 1), 1), field('Link to your work', e('input', { name: 'link', type: 'url', maxlength: 300, placeholder: 'https://' }), 1, 1), field('Tell us about the idea', msg, 1));
    } else {
      kids.push(field('What is this about?', sel('topic', ['General enquiry', 'Product support', 'Partnership'], 0), 1), field('How can we help?', msg, 1));
    }
    var out = e('output', { class: 'wide', role: 'status' }), go = e('button', { type: 'submit', class: 'btn primary', text: kind === 'career' ? 'Send my details' : 'Send message' });
    f.append.apply(f, kids.concat([hp, e('div', { class: 'wide ct-form-actions' }, [go]), out]));
    f.onsubmit = function (ev) {
      ev.preventDefault(); out.textContent = '';
      if (!f.checkValidity()) { f.reportValidity(); return; }
      var d = {}; new FormData(f).forEach(function (v, k) { d[k] = String(v).trim(); });
      d.kind = kind; if (kind === 'business') d.niche = NICHE[d.business_type] || '';
      go.disabled = true;
      var API = 'https://api.auzslab.in';
      fetch(API + '/rpc/submit_contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ p: d }) })
        .then(function (r) { return r.ok ? r : r.json().then(function (j) { throw new Error(j.error || j.message || 'failed'); }); })
        .then(function () { f.reset(); out.textContent = kind === 'career' ? 'Thank you. We have your details and will reply by email.' : 'Thank you. We will get back to you soon.'; })
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
      if (kind === 'developer') {
        var portal = e('a', { href: 'https://auzsshop.auzslab.in/theme-dev.html', text: 'Open the theme developer portal' });
        portal.onclick = function (ev) { if (window.auzHandoffUrl) { ev.preventDefault(); location.href = window.auzHandoffUrl(portal.href); } };
        root.append(e('p', { class: 'ct-note' }, [document.createTextNode('Already approved as a theme developer? '), portal, document.createTextNode('. New here? Tell us about your idea below and we will set you up.')]));
      }
      root.append(form());
    }
    root.append(e('nav', { class: 'ct-shortcuts', 'aria-label': 'Opportunities' }, [e('a', { href: 'submit-theme.html', text: 'How theme submission works' })]));
  }
  [['a[href^="tel:"]', 'Call AUZslab'], ['a[href^="https://wa.me/"]', 'Message AUZslab on WhatsApp'], ['a[href^="mailto:"]', 'Email AUZslab']].forEach(function (x) {
    var a = document.querySelector('.ac-rail ' + x[0]); if (a) { a.setAttribute('aria-label', x[1]); a.setAttribute('title', x[1]); }
  });
  var wa = document.querySelector('.ac-rail a[href^="https://wa.me/"] path'); if (wa) wa.setAttribute('d', 'M4 20l1-4a8 8 0 1 1 3 3l-4 1Z M9 9c.7 2.7 2.3 4.3 5 5');
  paint();
})();
