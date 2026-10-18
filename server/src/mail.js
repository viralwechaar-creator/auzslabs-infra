// Transactional email via Resend's plain REST API (no SDK -- one
// endpoint, not worth a dependency). RESEND_API_KEY unset means this
// project has no verified sender yet -- rather than failing invite_staff
// entirely, this returns `sent:false` and the caller (account.html)
// falls back to showing the verification link directly for the owner
// to copy/paste, same manual-handoff spirit as every temp password
// this project already shares over WhatsApp instead of email.
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const MAIL_FROM = process.env.MAIL_FROM || 'AUZslab <onboarding@resend.dev>';

const SITE = (process.env.PUBLIC_SITE_URL || (process.env.DOMAIN && process.env.DOMAIN !== 'localhost' ? `https://${process.env.DOMAIN}` : 'https://auzslab.in')).replace(/\/$/, '');

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// One shared, email-safe layout (tables + inline styles, works in Gmail / Outlook / Apple Mail).
// kicker = small label, title = big heading, body = html paragraphs, button = {label, href}, note = small print.
//
// Forcing light mode: `color-scheme`/`supported-color-schemes` meta tags alone do not stop Gmail's own
// heuristic dark mode from re-painting a "plain" white-card email as dark-with-inverted-text (confirmed
// against a real Gmail app send: the card and headings went dark, only the explicitly-colored button
// stayed put) -- the documented, reliable fix is the `[data-ogsc]` attribute selector, which Gmail adds
// to the document itself the moment it applies its own dark-mode repaint, specifically so a sender can
// override it back. Every color that must never flip gets a `!important` rule under that selector.
export function emailLayout({ preheader = '', kicker = '', title, body = '', button = null, note = '' }) {
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const mono = "'SFMono-Regular',Menlo,Consolas,'Courier New',monospace";
  const btn = button ? `
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:30px 0 10px"><tr><td class="btn-fill" style="background:#800020;border-radius:999px">
            <a href="${button.href}" style="display:inline-block;padding:16px 36px;font:700 16px ${font};color:#ffffff;text-decoration:none;border-radius:999px">${button.label}</a>
          </td></tr></table>
          <p class="muted" style="margin:14px 0 0;font:13px/1.6 ${font};color:#8a8480">Button not working? Copy this link into your browser:<br><a href="${button.href}" class="link" style="color:#800020;word-break:break-all">${button.href}</a></p>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<style>
  :root{color-scheme:light;supported-color-schemes:light}
  [data-ogsc] .page{background:#f3f0ec!important}
  [data-ogsc] .card{background:#ffffff!important;border-color:#e6e1dc!important}
  [data-ogsc] .ink,[data-ogsc] .ink *{color:#2e2c2a!important}
  [data-ogsc] .body-copy,[data-ogsc] .body-copy *{color:#4a4643!important}
  [data-ogsc] .muted,[data-ogsc] .muted *{color:#8a8480!important}
  [data-ogsc] .kicker{color:#800020!important}
  [data-ogsc] .link{color:#800020!important}
  [data-ogsc] .btn-fill,[data-ogsc] .btn-fill a{background:#800020!important;color:#ffffff!important}
  [data-ogsc] .footer-link{color:#700a1c!important}
</style>
</head>
<body class="page" style="margin:0;padding:0;background:#f3f0ec">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f3f0ec" class="page" style="background:#f3f0ec"><tr><td align="center" style="padding:40px 14px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
    <tr><td align="center" style="padding:0 6px 26px">
      <img src="${SITE}/logo.png" width="118" height="43" alt="AUZslab" style="display:block;border:0;outline:none">
    </td></tr>
    <tr><td class="card" bgcolor="#ffffff" style="background:#ffffff;border-radius:22px;border:1px solid #e6e1dc;padding:44px 40px;box-shadow:0 1px 0 rgba(46,44,42,.04)">
      <p class="kicker" style="margin:0 0 14px;font:700 11px ${mono};letter-spacing:.12em;text-transform:uppercase;color:#800020">${escapeHtml(kicker)}</p>
      <h1 class="ink" style="margin:0 0 16px;font:800 28px/1.25 ${font};letter-spacing:-.01em;color:#2e2c2a">${title}</h1>
      <div class="body-copy" style="font:16px/1.65 ${font};color:#4a4643">${body}</div>${btn}
      ${note ? `<div class="muted" style="border-top:1px solid #eeeae6;margin-top:28px;padding-top:18px;font:13px/1.6 ${font};color:#8a8480">${note}</div>` : ''}
    </td></tr>
    <tr><td style="padding:28px 10px 0">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td align="center" style="padding-bottom:12px;font:13px ${font}">
          <a href="${SITE}/products.html" class="footer-link muted" style="color:#8a8480;text-decoration:none;margin:0 10px">Products</a>
          <a href="${SITE}/pricing.html" class="footer-link muted" style="color:#8a8480;text-decoration:none;margin:0 10px">Pricing</a>
          <a href="${SITE}/contact.html" class="footer-link muted" style="color:#8a8480;text-decoration:none;margin:0 10px">Help</a>
        </td>
      </tr></table>
      <p class="muted" align="center" style="margin:0;font:12px/1.7 ${font};color:#9a948f;text-align:center">
        Software for shops, salons and cafes &middot; <a href="${SITE}" class="footer-link" style="color:#9a948f">auzslab.in</a><br>
        You are getting this because of activity on your AUZslab account.
      </p>
    </td></tr>
  </table>
</td></tr></table></body></html>`;
}

async function send({ to, subject, html, label }) {
  if (!RESEND_API_KEY) {
    console.warn(`RESEND_API_KEY not set -- skipping ${label} email to`, to);
    return { sent: false, reason: 'email sending is not configured yet' };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({ from: MAIL_FROM, to: [to], subject, html }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.warn('Resend send failed', res.status, body);
    return { sent: false, reason: 'the email could not be sent' };
  }
  return { sent: true };
}

export function mailConfigured() { return !!RESEND_API_KEY; }

export const sendStaffInviteEmail = ({ to, name, verifyLink }) => send({
  to, label: 'staff invite', subject: 'Confirm your AUZslab staff login',
  html: emailLayout({
    preheader: 'Confirm your email to activate your staff login.', kicker: 'Staff login',
    title: `Hi${name ? ' ' + escapeHtml(name) : ''}, you have been added to a team`,
    body: '<p style="margin:0">Your manager set up a staff login for you on AUZslab. Confirm this is your email address to switch it on.</p>',
    button: { label: 'Confirm and activate', href: verifyLink },
    note: 'This link works for 7 days. If you were not expecting this, you can ignore the email.',
  }),
});

// The caller (index.js /auth/forgot) always replies with the same generic message whether or not this sends.
export const sendPasswordResetEmail = ({ to, resetLink }) => send({
  to, label: 'password reset', subject: 'Reset your AUZslab password',
  html: emailLayout({
    preheader: 'Use this link to choose a new password.', kicker: 'Password reset',
    title: 'Choose a new password',
    body: '<p style="margin:0">Someone asked to reset the password for this AUZslab account. If that was you, tap the button below.</p>',
    button: { label: 'Reset my password', href: resetLink },
    note: 'This link works for 1 hour. If you did not ask for this, ignore the email: your password has not changed.',
  }),
});

// Sent by /auth/signup and /auth/resend-verification.
export const sendEmailVerification = ({ to, verifyLink }) => send({
  to, label: 'verification', subject: 'Confirm your email for AUZslab',
  html: emailLayout({
    preheader: 'One tap to confirm your email and finish setting up.', kicker: 'Welcome',
    title: 'Confirm your email address',
    body: '<p style="margin:0 0 12px">Welcome to AUZslab. Billing, staff, stock and your own QR menu, all on one login.</p><p style="margin:0">Confirm this is your email to finish setting up your account.</p>',
    button: { label: 'Confirm my email', href: verifyLink },
    note: 'This link works for 24 hours. If you did not create an AUZslab account, you can ignore this email.',
  }),
});

// Sent by /auth/change-email/request, to the NEW address only (db/121) -- the
// old address is never notified, there is no recovery value in it for this flow.
export const sendEmailChangeVerification = ({ to, verifyLink }) => send({
  to, label: 'email change', subject: 'Confirm your new AUZslab sign-in email',
  html: emailLayout({
    preheader: 'Confirm this address to make it your new sign-in email.', kicker: 'Email change',
    title: 'Confirm your new email address',
    body: `<p style="margin:0 0 12px">Someone asked to change the sign-in email for an AUZslab account to this address (${escapeHtml(to)}).</p><p style="margin:0">Tap the button below to make this your new sign-in email. Your old email will stop working for sign-in the moment you confirm.</p>`,
    button: { label: 'Confirm new email', href: verifyLink },
    note: 'This link works for 24 hours. If you did not ask for this, ignore the email: nothing changes until this link is opened.',
  }),
});

// Sent by /auth/recovery-email/request (db/121). A recovery email is a backup
// contact only -- it is never used to sign in and never replaces the normal
// forgot-password flow by itself.
export const sendRecoveryEmailVerification = ({ to, verifyLink }) => send({
  to, label: 'recovery email', subject: 'Confirm your AUZslab recovery email',
  html: emailLayout({
    preheader: 'Confirm this as a backup contact for your AUZslab account.', kicker: 'Recovery email',
    title: 'Confirm this recovery email',
    body: '<p style="margin:0">Someone added this address as a backup contact for an AUZslab account. It will never be used to sign in -- it just gives our team another way to reach you if you ever lose access to your main inbox.</p>',
    button: { label: 'Confirm recovery email', href: verifyLink },
    note: 'This link works for 24 hours. If you did not ask for this, ignore the email.',
  }),
});

// Renewal reminder to a business owner (daily job in maintenance.js). Quiet no-op without RESEND_API_KEY.
export function sendRenewalEmail({ to, business, days, renewalDate }) {
  const when = days < 0 ? 'has expired' : days === 0 ? 'ends today' : days === 1 ? 'ends tomorrow' : `ends in ${days} days`;
  return send({
    to, label: 'renewal', subject: `Your AUZslab plan ${when}`,
    html: emailLayout({
      preheader: `The plan for ${business} ${when}.`, kicker: 'Plan renewal',
      title: `Your plan ${when}`,
      body: `<p style="margin:0">The AUZslab plan for <b>${escapeHtml(business)}</b> ${when} (renewal date ${escapeHtml(String(renewalDate).slice(0, 10))}).</p><p style="margin:12px 0 0">Renew from your account page to keep your apps working without a break, or just reply to this email.</p>`,
      button: { label: 'Renew my plan', href: `${SITE}/account.html` },
    }),
  });
}

// Join-the-team emails (db/177-178). All quiet no-ops without RESEND_API_KEY; the admin still sees the application in Admin -> Team.
export function sendTeamApplicationReceived({ to, name }) {
  return send({
    to, label: 'team application', subject: 'We got your AUZslab application',
    html: emailLayout({
      preheader: 'Thanks for applying to join the AUZslab team.', kicker: 'Join our team',
      title: 'Thank you, we have your application',
      body: `<p style="margin:0">Hi ${escapeHtml(name || '')},</p><p style="margin:12px 0 0">We will read your application and get back to you by phone or email.</p>`,
    }),
  });
}
export function sendTeamApplicationToAdmin({ to, name, email, phone, role }) {
  return send({
    to, label: 'team application (admin)', subject: `New team application: ${String(name || '').slice(0, 60)}`,
    html: emailLayout({
      preheader: 'Someone applied to join the team.', kicker: 'Admin',
      title: 'New team application',
      body: `<p style="margin:0"><b>${escapeHtml(name || '')}</b> wants to join as <b>${escapeHtml(role || 'other')}</b>.</p><p style="margin:12px 0 0">${escapeHtml(email || '')}${phone ? ' &middot; ' + escapeHtml(phone) : ''}</p>`,
      button: { label: 'Review in Admin', href: `${SITE}/admin.html` },
    }),
  });
}
export function sendTeamDecisionEmail({ to, name, approved, role }) {
  const roleName = { salesman: 'Salesman', setup: 'Client setup', support: 'Support', manager: 'Manager' }[role] || 'team member';
  return send({
    to, label: 'team decision', subject: approved ? 'Welcome to the AUZslab team' : 'About your AUZslab application',
    html: emailLayout({
      preheader: approved ? 'Your application was approved.' : 'An update on your application.', kicker: 'Join our team',
      title: approved ? 'You are in' : 'Thank you for applying',
      body: approved
        ? `<p style="margin:0">Hi ${escapeHtml(name || '')}, your application was approved. Your role: <b>${escapeHtml(roleName)}</b>.</p><p style="margin:12px 0 0">Sign in with Google at app.auzslab.in using this same email address and your team dashboard will open.</p>`
        : `<p style="margin:0">Hi ${escapeHtml(name || '')}, thank you for your interest in AUZslab. We are not able to take your application forward right now. We will keep your details in mind for the future.</p>`,
      button: approved ? { label: 'Open my dashboard', href: 'https://app.auzslab.in' } : null,
    }),
  });
}
