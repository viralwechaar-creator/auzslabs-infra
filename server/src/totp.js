import crypto from 'node:crypto';

// RFC 6238/4226 TOTP, implemented directly (no npm dependency) -- same
// bar as the vendored QR library (app/public/vendor/qrcode.js): a small,
// well-understood algorithm, not worth a dependency. Needs no external
// service, no API key, no network call -- unlike every other optional
// integration in this codebase, 2FA setup works the moment the server
// starts, nothing to configure in .env.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf) {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  let bits = 0, value = 0;
  const bytes = [];
  for (const ch of String(str).toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(bytes);
}

export function generateSecret() {
  return base32Encode(crypto.randomBytes(20)); // 160 bits, the usual TOTP secret size
}

export function otpauthUri(secret, email, issuer = 'AUZslab') {
  const label = encodeURIComponent(`${issuer}:${email}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

function totpAt(secretBuf, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', secretBuf).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = ((hmac[offset] & 0x7f) << 24 | (hmac[offset + 1] & 0xff) << 16 | (hmac[offset + 2] & 0xff) << 8 | (hmac[offset + 3] & 0xff)) % 1_000_000;
  return String(code).padStart(6, '0');
}

// A +/-1 step window (90 seconds total) absorbs ordinary clock drift
// between the phone and the server without meaningfully weakening the
// 6-digit code's own odds (still 1 in ~333,000 per guess).
export function verifyTotp(secretBase32, code) {
  const clean = String(code || '').trim();
  if (!/^\d{6}$/.test(clean)) return false;
  const secretBuf = base32Decode(secretBase32);
  const counter = Math.floor(Date.now() / 1000 / 30);
  for (let w = -1; w <= 1; w++) {
    if (totpAt(secretBuf, counter + w) === clean) return true;
  }
  return false;
}

// 8 one-time recovery codes (XXXX-XXXX, easy to read off a printed
// sheet), shown to the owner exactly once at setup. Only bcrypt hashes
// are ever stored -- same discipline as a password.
export function generateBackupCodes(n = 8) {
  const codes = [];
  for (let i = 0; i < n; i++) {
    const a = crypto.randomInt(0, 10000).toString().padStart(4, '0');
    const b = crypto.randomInt(0, 10000).toString().padStart(4, '0');
    codes.push(`${a}-${b}`);
  }
  return codes;
}
