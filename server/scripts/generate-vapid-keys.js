// Run once: `node scripts/generate-vapid-keys.js`, paste the output into
// .env. Generates a real P-256 EC keypair in the same base64url format
// server/src/push.js expects (matching what the `web-push` npm
// package's generateVAPIDKeys() produces, without needing that package
// as a dependency just for this one-time step).
function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify'],
);

const rawPublic = new Uint8Array(await crypto.subtle.exportKey('raw', publicKey)); // 65 bytes: 0x04 || x(32) || y(32)
const jwkPrivate = await crypto.subtle.exportKey('jwk', privateKey);

console.log('VAPID_PUBLIC=' + b64url(rawPublic));
console.log('VAPID_PRIVATE=' + jwkPrivate.d);
console.log('VAPID_SUBJECT=https://auzslab.in');
