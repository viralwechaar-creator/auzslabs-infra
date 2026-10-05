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

// One shared, email-safe layout (tables + inline styles, no images, works in Gmail / Outlook / Apple Mail).
// kicker = small label, title = big heading, body = html paragraphs, button = {label, href}, note = small print.
export function emailLayout({ preheader = '', kicker = '', title, body = '', button = null, note = '' }) {
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const mono = "'SFMono-Regular',Menlo,Consolas,'Courier New',monospace";
  const btn = button ? `
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 8px"><tr><td style="background:#800020;border-radius:999px">
            <a href="${button.href}" style="display:inline-block;padding:16px 34px;font:700 16px ${font};color:#ffffff;text-decoration:none;border-radius:999px">${button.label}</a>
          </td></tr></table>
          <p style="margin:14px 0 0;font:13px/1.6 ${font};color:#8a8480">Button not working? Copy this link into your browser:<br><a href="${button.href}" style="color:#800020;word-break:break-all">${button.href}</a></p>` : '';
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"></head>
<body style="margin:0;padding:0;background:#f3f0ec">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f0ec"><tr><td align="center" style="padding:32px 14px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
    <tr><td style="padding:0 6px 16px" align="left">
      <span style="display:inline-block;width:12px;height:12px;background:#800020;vertical-align:-1px"></span>
      <span style="font:700 17px ${mono};letter-spacing:.04em;color:#2e2c2a;margin-left:7px">AUZslab</span>
    </td></tr>
    <tr><td style="background:#ffffff;border-radius:22px;border:1px solid #e6e1dc;padding:40px 36px">
      <p style="margin:0 0 14px;font:700 11px ${mono};letter-spacing:.12em;text-transform:uppercase;color:#800020">${escapeHtml(kicker)}</p>
      <h1 style="margin:0 0 16px;font:800 28px/1.2 ${font};letter-spacing:-.01em;color:#2e2c2a">${title}</h1>
      <div style="font:16px/1.65 ${font};color:#4a4643">${body}</div>${btn}
      ${note ? `<div style="border-top:1px solid #eeeae6;margin-top:28px;padding-top:18px;font:13px/1.6 ${font};color:#8a8480">${note}</div>` : ''}
    </td></tr>
    <tr><td align="center" style="padding:22px 10px 0;font:12px/1.7 ${font};color:#9a948f">
      Software for shops, salons and cafes &middot; <a href="${SITE}" style="color:#9a948f">auzslab.in</a><br>
      You are getting this because of activity on your AUZslab account.
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
