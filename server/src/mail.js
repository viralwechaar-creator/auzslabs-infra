// Transactional email via Resend's plain REST API (no SDK -- one
// endpoint, not worth a dependency). RESEND_API_KEY unset means this
// project has no verified sender yet -- rather than failing invite_staff
// entirely, this returns `sent:false` and the caller (account.html)
// falls back to showing the verification link directly for the owner
// to copy/paste, same manual-handoff spirit as every temp password
// this project already shares over WhatsApp instead of email.
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';
const MAIL_FROM = process.env.MAIL_FROM || 'AUZslab <onboarding@resend.dev>';

export async function sendStaffInviteEmail({ to, name, verifyLink }) {
  if (!RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set -- skipping staff invite email to', to);
    return { sent: false, reason: 'email sending is not configured yet' };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({
      from: MAIL_FROM,
      to: [to],
      subject: 'Confirm your AUZslab staff login',
      html: `<p>Hi${name ? ' ' + escapeHtml(name) : ''},</p>
<p>Your manager just set up a staff login for you on AUZslab. Click below to confirm this is your email address and activate it:</p>
<p><a href="${verifyLink}">${verifyLink}</a></p>
<p>This link expires in 7 days. If you weren't expecting this, you can ignore it.</p>`,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.warn('Resend send failed', res.status, body);
    return { sent: false, reason: 'the email could not be sent' };
  }
  return { sent: true };
}

// Same shape as sendStaffInviteEmail -- the caller (index.js's
// /auth/forgot) always replies with a generic "if that email exists..."
// message regardless of sent:true/false, so a missing RESEND_API_KEY
// fails quietly server-side rather than leaking whether the address
// exists via a different-looking error.
export async function sendPasswordResetEmail({ to, resetLink }) {
  if (!RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set -- skipping password reset email to', to);
    return { sent: false, reason: 'email sending is not configured yet' };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({
      from: MAIL_FROM,
      to: [to],
      subject: 'Reset your AUZslab password',
      html: `<p>Someone asked to reset the password on this AUZslab account.</p>
<p><a href="${resetLink}">${resetLink}</a></p>
<p>This link expires in 1 hour. If you didn't ask for this, you can ignore it -- your password hasn't changed.</p>`,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.warn('Resend send failed', res.status, body);
    return { sent: false, reason: 'the email could not be sent' };
  }
  return { sent: true };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
