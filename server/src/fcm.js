// Native push for the Android app (Firebase Cloud Messaging, HTTP v1
// API) -- the real fix for a store-launch gap: the POS's existing
// "order alerts" (push.js, Web Push via VAPID) never works inside a
// bare Capacitor WebView, since the browser there never registers a
// push service. A packaged Android app needs FCM instead.
//
// Same "no npm dependency for a small, well-understood protocol" bar
// as totp.js/push.js's own Web Push crypto: the OAuth2 service-account
// flow is just one self-signed RS256 JWT exchanged for an access token
// (Node's built-in crypto signs RS256 fine), not worth pulling in
// firebase-admin for.
//
// Dormant until configured, same discipline as every other optional
// integration (mail.js, sms.js, payments.js, cashfree.js): with no
// FCM_PROJECT_ID/FCM_SERVICE_ACCOUNT_JSON set, sendFcm() and
// everything in push.js that calls it just no-ops.
import { createSign } from 'node:crypto';

const FCM_PROJECT_ID = process.env.FCM_PROJECT_ID || '';
let serviceAccount = null;
try {
  if (process.env.FCM_SERVICE_ACCOUNT_JSON) serviceAccount = JSON.parse(process.env.FCM_SERVICE_ACCOUNT_JSON);
} catch (err) {
  console.warn('FCM_SERVICE_ACCOUNT_JSON could not be parsed as JSON:', err.message);
}

export function fcmConfigured() {
  return !!(FCM_PROJECT_ID && serviceAccount && serviceAccount.private_key && serviceAccount.client_email);
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Google's service-account OAuth2 flow (RFC 7523, JWT bearer grant):
// a short-lived, self-signed JWT asserting who we are, exchanged at
// Google's token endpoint for a real (1 hour) access token. Cached
// until a minute before it actually expires so a burst of pushes
// doesn't mint a fresh token for every single one.
let cachedToken = null; // { accessToken, expiresAt }
async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.accessToken;
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const signature = b64url(signer.sign(serviceAccount.private_key));
  const assertion = `${header}.${payload}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  if (!res.ok) throw new Error('FCM token exchange failed: ' + (await res.text().catch(() => res.statusText)));
  const { access_token, expires_in } = await res.json();
  cachedToken = { accessToken: access_token, expiresAt: Date.now() + (expires_in || 3600) * 1000 };
  return access_token;
}

// Returns {ok, unregistered} -- unregistered is true for FCM's own
// "this token no longer exists" errors (UNREGISTERED / INVALID_ARGUMENT
// on a malformed/expired token), so the caller can drop the dead row
// the same way push.js already drops a dead Web Push subscription on a
// 404/410.
export async function sendFcm(token, { title, body }) {
  if (!fcmConfigured()) return { ok: false, unregistered: false };
  const accessToken = await getAccessToken();
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ message: { token, notification: { title: title || 'AUZslab', body: body || '' } } }),
  });
  if (res.ok) return { ok: true, unregistered: false };
  const errBody = await res.json().catch(() => ({}));
  const status = errBody?.error?.status || '';
  return { ok: false, unregistered: status === 'UNREGISTERED' || status === 'NOT_FOUND' || status === 'INVALID_ARGUMENT' };
}
