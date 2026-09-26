import { createClient } from "npm:@supabase/supabase-js@2";

// VAPID keys and the trigger secret now come from this function's own
// environment (set via `supabase secrets set`), never a literal in source —
// generate a fresh keypair/secret when wiring this up; the values that
// were previously hardcoded here must be treated as compromised.
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC")!;
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "https://auzlabs.com";
const TRIGGER_SECRET = Deno.env.get("PUSH_TRIGGER_SECRET")!;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function b64url(buf: Uint8Array): string {
  let s = "";
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function b64urlDecode(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const str = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const arr = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) arr[i] = str.charCodeAt(i);
  return arr;
}
function concatBytes(...arrs: Uint8Array[]): Uint8Array {
  const len = arrs.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}
async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data));
}

const pubBytes = b64urlDecode(VAPID_PUBLIC); // 65 bytes: 0x04 || x(32) || y(32)
const vapidPrivateKeyPromise = crypto.subtle.importKey(
  "jwk",
  { kty: "EC", crv: "P-256", d: VAPID_PRIVATE, x: b64url(pubBytes.slice(1, 33)), y: b64url(pubBytes.slice(33, 65)), ext: true },
  { name: "ECDSA", namedCurve: "P-256" },
  false,
  ["sign"],
);

async function vapidAuthHeader(endpoint: string): Promise<string> {
  const url = new URL(endpoint);
  const aud = `${url.protocol}//${url.host}`;
  const header = { typ: "JWT", alg: "ES256" };
  const payload = { aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: VAPID_SUBJECT };
  const enc = new TextEncoder();
  const encHeader = b64url(enc.encode(JSON.stringify(header)));
  const encPayload = b64url(enc.encode(JSON.stringify(payload)));
  const signingInput = enc.encode(`${encHeader}.${encPayload}`);
  const privateKey = await vapidPrivateKeyPromise;
  // Web Crypto's ECDSA sign returns the raw r||s (IEEE P1363) format JWS
  // requires — unlike Node's crypto shim under Deno, which can emit DER and
  // gets silently accepted by Chrome/Firefox push but rejected by Apple's
  // stricter web.push.apple.com validator ("BadJwtToken").
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, signingInput));
  const jwt = `${encHeader}.${encPayload}.${b64url(sig)}`;
  return `vapid t=${jwt}, k=${VAPID_PUBLIC}`;
}

// RFC 8291 aes128gcm payload encryption.
async function encryptPayload(payload: Uint8Array, p256dhB64: string, authB64: string): Promise<Uint8Array> {
  const uaPublic = b64urlDecode(p256dhB64);
  const authSecret = b64urlDecode(authB64);
  const asKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", asKeyPair.publicKey));
  const uaPublicKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaPublicKey }, asKeyPair.privateKey, 256),
  );

  const enc = new TextEncoder();
  const keyInfo = concatBytes(enc.encode("WebPush: info\0"), uaPublic, asPublic);
  const prkKey = await hmacSha256(authSecret, ecdhSecret);
  const ikm = (await hmacSha256(prkKey, concatBytes(keyInfo, new Uint8Array([1])))).slice(0, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmacSha256(salt, ikm);
  const cek = (await hmacSha256(prk, concatBytes(enc.encode("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmacSha256(prk, concatBytes(enc.encode("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);

  const plaintext = concatBytes(payload, new Uint8Array([2])); // last (only) record delimiter
  const cekKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, cekKey, plaintext));

  const rs = 4096;
  const header = concatBytes(
    salt,
    new Uint8Array([(rs >>> 24) & 255, (rs >>> 16) & 255, (rs >>> 8) & 255, rs & 255]),
    new Uint8Array([asPublic.length]),
    asPublic,
  );
  return concatBytes(header, ciphertext);
}

async function sendWebPush(endpoint: string, p256dh: string, auth: string, payload: unknown): Promise<Response> {
  const body = await encryptPayload(new TextEncoder().encode(JSON.stringify(payload)), p256dh, auth);
  const authHeader = await vapidAuthHeader(endpoint);
  return fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      TTL: "86400",
      Authorization: authHeader,
    },
    body,
  });
}

Deno.serve(async (req) => {
  if (req.headers.get("x-trigger-secret") !== TRIGGER_SECRET) {
    return new Response("forbidden", { status: 403 });
  }
  let payload: { tenant_id?: string; title?: string; body?: string };
  try {
    payload = await req.json();
  } catch {
    return new Response("bad request", { status: 400 });
  }
  if (!payload.tenant_id) {
    return new Response("tenant_id is required", { status: 400 });
  }
  const title = payload.title || "AUZlabs";
  const body = payload.body || "";

  // scoped to the one tenant that triggered this — without this filter,
  // every client's staff devices would get every other client's alerts.
  const { data: subs, error } = await supabase
    .from("push_subs")
    .select("*")
    .eq("tenant_id", payload.tenant_id);
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  let sent = 0, removed = 0;
  const errors: string[] = [];
  await Promise.allSettled((subs || []).map(async (s: any) => {
    try {
      const res = await sendWebPush(s.endpoint, s.p256dh, s.auth, { title, body });
      if (res.ok) {
        sent++;
      } else {
        const text = await res.text().catch(() => "");
        const msg = `${res.status} ${text}`;
        console.error("push failed", s.endpoint, msg);
        errors.push(msg);
        if (res.status === 404 || res.status === 410) {
          await supabase.from("push_subs").delete().eq("id", s.id);
          removed++;
        }
      }
    } catch (e: any) {
      const msg = e.message || String(e);
      console.error("push error", s.endpoint, msg);
      errors.push(msg);
    }
  }));

  return new Response(JSON.stringify({ sent, removed, total: (subs || []).length, errors }), {
    headers: { "Content-Type": "application/json" },
  });
});
