// AUZsStyle licence codes (offline Windows install). A code is a signed, compact record: product, shop name, plan end date and
// which extras (cloud storage, WhatsApp, online store) are paid for. AUZslab signs it with a private key that never leaves our
// server; the installed app only holds the PUBLIC key, so it can check a code with no internet but nobody can make one.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const EPOCH = Date.UTC(2020, 0, 1);
const DAY = 86400000;
const ED_PRIV = Buffer.from('302e020100300506032b657004220420', 'hex');
const ED_PUB = Buffer.from('302a300506032b6570032100', 'hex');
const B32 = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I, O, 0, 1: easy to read out loud
export const PRODUCTS = { style: 1 };
export const ADDONS = { cloud: 1, whatsapp: 2, store: 4, sync: 8 };
export const GRACE_DAYS = 3;

const b32enc = (buf) => { let bits = 0, val = 0, out = ''; for (const b of buf) { val = (val << 8) | b; bits += 8; while (bits >= 5) { out += B32[(val >>> (bits - 5)) & 31]; bits -= 5; } } if (bits) out += B32[(val << (5 - bits)) & 31]; return out; };
const b32dec = (s) => { let bits = 0, val = 0; const out = []; for (const c of s) { const i = B32.indexOf(c); if (i < 0) throw new Error('bad character'); val = (val << 5) | i; bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } } return Buffer.from(out); };
const group = (s) => s.match(/.{1,5}/g).join('-');
const privKey = (b64) => crypto.createPrivateKey({ key: Buffer.concat([ED_PRIV, Buffer.from(b64, 'base64url')]), format: 'der', type: 'pkcs8' });
const pubKey = (b64) => crypto.createPublicKey({ key: Buffer.concat([ED_PUB, Buffer.from(b64, 'base64url')]), format: 'der', type: 'spki' });

export function makeKeypair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return { priv: privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(16).toString('base64url'), pub: publicKey.export({ format: 'der', type: 'spki' }).subarray(12).toString('base64url') };
}

export const dayNumber = (iso) => Math.round((Date.parse(iso + 'T00:00:00Z') - EPOCH) / DAY);
export const isoOf = (n) => new Date(EPOCH + n * DAY).toISOString().slice(0, 10);

// shop: text (max 40 bytes shown to the client), end: 'YYYY-MM-DD' (last day the plan works), addons: { cloud, whatsapp, store }
export function signLicence({ shop, end, addons = {}, product = 'style' }, priv) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end || '')) throw new Error('Plan end date must be YYYY-MM-DD');
  const days = dayNumber(end); if (!(days > 0 && days < 65535)) throw new Error('Plan end date is out of range');
  const name = Buffer.from(String(shop || '').slice(0, 40), 'utf8').subarray(0, 40);
  const flags = Object.entries(ADDONS).reduce((a, [k, v]) => a | (addons[k] ? v : 0), 0);
  const body = Buffer.concat([Buffer.from([1, PRODUCTS[product] || 1]), crypto.randomBytes(4), Buffer.from([days >> 8, days & 255, flags, name.length]), name]);
  const sig = crypto.sign(null, body, privKey(priv));
  return 'AUZ-' + group(b32enc(Buffer.concat([body, sig])));
}

// Returns { ok:true, id, shop, end, addons } or { ok:false, error }.
export function verifyLicence(code, pub) {
  try {
    const raw = b32dec(String(code || '').toUpperCase().replace(/^AUZ-?/, '').replace(/[^A-Z0-9]/g, '').replace(/0/g, 'O').replace(/1/g, 'I'));
    // O and I are not in the alphabet, so a typed 0 or 1 is read as a mistake rather than guessed
    if (raw.length < 74) return { ok: false, error: 'This code is too short. Check it and try again.' };
    const nameLen = raw[9]; const bodyLen = 10 + nameLen; const body = raw.subarray(0, bodyLen); const sig = raw.subarray(bodyLen, bodyLen + 64);
    if (sig.length !== 64 || body[0] !== 1) return { ok: false, error: 'This code is not valid.' };
    if (!crypto.verify(null, body, pubKey(pub), sig)) return { ok: false, error: 'This code is not valid. Check every letter and number.' };
    const days = (body[6] << 8) | body[7]; const flags = body[8];
    return { ok: true, id: body.subarray(2, 6).toString('hex'), product: Object.keys(PRODUCTS).find((k) => PRODUCTS[k] === body[1]) || 'style', shop: body.subarray(10, bodyLen).toString('utf8'), end: isoOf(days), addons: Object.fromEntries(Object.entries(ADDONS).map(([k, v]) => [k, !!(flags & v)])) };
  } catch { return { ok: false, error: 'This code is not valid. Check every letter and number.' }; }
}

// ---------- the installed copy: keeps the code and the latest date it has seen (so setting the clock back does not extend a plan) ----------
export function licenceStore(dir, pub) {
  const file = path.join(dir, 'licence.json');
  const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } };
  const write = (o) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(o)); };
  const today = (now) => Math.floor((now - EPOCH) / DAY);
  function status(now = Date.now()) {
    const s = read(); if (!s || !s.code) return { state: 'none' };
    const v = verifyLicence(s.code, pub); if (!v.ok) return { state: 'none' };
    const seen = Math.max(s.seen || 0, today(now)); if (seen !== s.seen) write({ ...s, seen });
    const left = dayNumber(v.end) - seen;
    const state = left >= 0 ? 'active' : left >= -GRACE_DAYS ? 'grace' : 'expired';
    return { state, shop: v.shop, end: v.end, daysLeft: left, graceLeft: left < 0 ? GRACE_DAYS + left : null, addons: v.addons, id: v.id };
  }
  function activate(code, now = Date.now()) {
    const v = verifyLicence(code, pub); if (!v.ok) return { ok: false, error: v.error };
    const old = read();
    if (old && old.code) { const o = verifyLicence(old.code, pub); if (o.ok && o.end > v.end) return { ok: false, error: 'This code is older than the plan already on this computer (it ends ' + o.end + ').' }; }
    write({ code: String(code).trim(), seen: Math.max((old && old.seen) || 0, today(now)) });
    return { ok: true, status: status(now) };
  }
  return { status, activate };
}

// The cloud server only holds the private key; the public half (to check codes sent by installed copies) is derived from it.
export function publicFromPrivate(priv) {
  return crypto.createPublicKey(privKey(priv)).export({ format: 'der', type: 'spki' }).subarray(12).toString('base64url');
}
