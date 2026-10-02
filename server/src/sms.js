// Phone/OTP delivery via Twilio's plain REST API (no SDK -- same
// one-endpoint, not-worth-a-dependency reasoning as mail.js's Resend
// integration). TWILIO_* unset means phone sign-in genuinely cannot
// work yet (there's no manual-handoff fallback for an OTP the way a
// staff invite link has one) -- callers must surface that clearly
// rather than pretend the code was sent.
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_FROM = process.env.TWILIO_FROM || ''; // E.164, e.g. +14155550100

export function smsConfigured() {
  return !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM);
}

export async function sendOtpSms(toPhone, code) {
  if (!smsConfigured()) {
    console.warn('Twilio is not configured -- skipping OTP SMS to', toPhone);
    return { sent: false, reason: 'phone sign-in is not configured yet' };
  }
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64'),
    },
    body: new URLSearchParams({
      To: toPhone,
      From: TWILIO_FROM,
      Body: `Your AUZslab verification code is ${code}. It expires in 10 minutes.`,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.warn('Twilio send failed', res.status, body);
    return { sent: false, reason: 'the code could not be sent' };
  }
  return { sent: true };
}
