// Cloudflare Turnstile (a free, privacy-friendly CAPTCHA) for public signup. Dormant until TURNSTILE_SECRET_KEY is
// set, like mail.js / sms.js / payments.js: with no key, signup behaves exactly as it always did.
// When it is set, a missing or wrong token is refused; if Cloudflare itself cannot be reached the check fails
// closed (signup waits), because an open door is what the CAPTCHA is there to close.
const SECRET = process.env.TURNSTILE_SECRET_KEY || '';

export const captchaEnabled = () => !!SECRET;

export async function verifyCaptcha(token, ip) {
  if (!SECRET) return true;
  if (!token || typeof token !== 'string' || token.length > 4096) return false;
  try {
    const body = new URLSearchParams({ secret: SECRET, response: token });
    if (ip) body.set('remoteip', ip);
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body,
      signal: AbortSignal.timeout(5000),
    });
    const json = await res.json();
    return json.success === true;
  } catch (err) {
    console.warn('turnstile verification failed to run', err.message);
    return false;
  }
}
