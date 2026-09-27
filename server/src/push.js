// Ported from supabase/functions/send-push/index.ts, unchanged apart
// from swapping Deno's env/fetch-handler shell for plain Node and the
// supabase-js `push_subs` lookup for a direct pool query. The actual
// RFC 8291 aes128gcm encryption + VAPID JWT signing logic is identical
// -- Node's global crypto.subtle is the same Web Crypto API Deno used.
import { pool } from './db.js';

const VAPID_PUBLIC = process.env.VAPID_PUBLIC;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'https://auzslab.in';

function b64url(buf) {
  let s = '';
  for (const b of buf) s += String.fromCharCode(b);
  return Buffer.from(s, 'binary').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(s) {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const str = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64').toString('binary');
  const arr = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) arr[i] = str.charCodeAt(i);
  return arr;
}
function concatBytes(...arrs) {
  const len = arrs.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
async function hmacSha256(key, data) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, data));
}

let vapidPrivateKeyPromise = null;
function getVapidPrivateKey() {
  if (!vapidPrivateKeyPromise) {
    const pubBytes = b64urlDecode(VAPID_PUBLIC); // 65 bytes: 0x04 || x(32) || y(32)
    vapidPrivateKeyPromise = crypto.subtle.importKey(
      'jwk',
      { kty: 'EC', crv: 'P-256', d: VAPID_PRIVATE, x: b64url(pubBytes.slice(1, 33)), y: b64url(pubBytes.slice(33, 65)), ext: true },
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['sign'],
    );
  }
  return vapidPrivateKeyPromise;
}

async function vapidAuthHeader(endpoint) {
  const url = new URL(endpoint);
  const aud = `${url.protocol}//${url.host}`;
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = { aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: VAPID_SUBJECT };
  const enc = new TextEncoder();
  const encHeader = b64url(enc.encode(JSON.stringify(header)));
  const encPayload = b64url(enc.encode(JSON.stringify(payload)));
  const signingInput = enc.encode(`${encHeader}.${encPayload}`);
  const privateKey = await getVapidPrivateKey();
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, signingInput));
  const jwtStr = `${encHeader}.${encPayload}.${b64url(sig)}`;
  return `vapid t=${jwtStr}, k=${VAPID_PUBLIC}`;
}

async function encryptPayload(payload, p256dhB64, authB64) {
  const uaPublic = b64urlDecode(p256dhB64);
  const authSecret = b64urlDecode(authB64);
  const asKeyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asKeyPair.publicKey));
  const uaPublicKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPublicKey }, asKeyPair.privateKey, 256),
  );

  const enc = new TextEncoder();
  const keyInfo = concatBytes(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const prkKey = await hmacSha256(authSecret, ecdhSecret);
  const ikm = (await hmacSha256(prkKey, concatBytes(keyInfo, new Uint8Array([1])))).slice(0, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmacSha256(salt, ikm);
  const cek = (await hmacSha256(prk, concatBytes(enc.encode('Content-Encoding: aes128gcm\0'), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmacSha256(prk, concatBytes(enc.encode('Content-Encoding: nonce\0'), new Uint8Array([1])))).slice(0, 12);

  const plaintext = concatBytes(payload, new Uint8Array([2]));
  const cekKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cekKey, plaintext));

  const rs = 4096;
  const header = concatBytes(
    salt,
    new Uint8Array([(rs >>> 24) & 255, (rs >>> 16) & 255, (rs >>> 8) & 255, rs & 255]),
    new Uint8Array([asPublic.length]),
    asPublic,
  );
  return concatBytes(header, ciphertext);
}

async function sendWebPush(endpoint, p256dh, authKey, payload) {
  const body = await encryptPayload(new TextEncoder().encode(JSON.stringify(payload)), p256dh, authKey);
  const authHeader = await vapidAuthHeader(endpoint);
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      TTL: '86400',
      Authorization: authHeader,
    },
    body,
  });
}

// Called directly, in-process, when a 'push_events' Postgres NOTIFY
// arrives (see realtime.js) -- no HTTP round-trip to a separate
// function, no shared secret to guard that round-trip with.
export async function handlePushEvent({ tenant_id, title, body }) {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return; // push not configured yet -- skip quietly
  const { rows: subs } = await pool.query('select * from push_subs where tenant_id = $1', [tenant_id]);

  await Promise.allSettled(subs.map(async (s) => {
    try {
      const res = await sendWebPush(s.endpoint, s.p256dh, s.auth, { title: title || 'AUZslab', body: body || '' });
      if (!res.ok && (res.status === 404 || res.status === 410)) {
        await pool.query('delete from push_subs where id = $1', [s.id]);
      } else if (!res.ok) {
        console.error('push failed', s.endpoint, res.status, await res.text().catch(() => ''));
      }
    } catch (e) {
      console.error('push error', s.endpoint, e.message);
    }
  }));
}
