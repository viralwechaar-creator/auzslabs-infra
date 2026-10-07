// Optional S3-compatible object storage (AWS S3, Backblaze B2, Cloudflare R2, MinIO ...) for the PRIVATE files (employee documents,
// accounting attachments). Dormant until S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are set: without them files stay on the
// server's disk exactly as before. Signing is AWS Signature V4 with Node's own crypto (no SDK). Public site images stay on disk
// because Caddy serves them directly.
import crypto from 'node:crypto';

const cfg = () => ({
  bucket: process.env.S3_BUCKET, key: process.env.S3_ACCESS_KEY_ID, secret: process.env.S3_SECRET_ACCESS_KEY,
  region: process.env.S3_REGION || 'us-east-1', endpoint: (process.env.S3_ENDPOINT || '').replace(/\/+$/, ''),
  prefix: (process.env.S3_PREFIX || 'auzslab').replace(/^\/+|\/+$/g, ''),
});
export const s3Enabled = () => { const c = cfg(); return !!(c.bucket && c.key && c.secret); };

const sha = (d) => crypto.createHash('sha256').update(d).digest('hex');
const hmac = (k, d) => crypto.createHmac('sha256', k).update(d).digest();
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());

// Returns the URL + headers for a signed request. `now` is injectable so the algorithm can be checked against AWS's published example.
export function signS3({ method, host, path, query = '', body = '', region, key, secret, now = new Date(), extra = {} }) {
  const amz = now.toISOString().replace(/[:-]|\.\d{3}/g, ''), day = amz.slice(0, 8);
  const payloadHash = typeof body === 'string' && body === '' ? sha('') : sha(body);
  const h = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amz, ...extra };
  const names = Object.keys(h).map((k) => k.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), String(v).trim()]));
  const canonical = [method, path, query, names.map((n) => n + ':' + lower[n] + '\n').join(''), names.join(';'), payloadHash].join('\n');
  const scope = `${day}/${region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amz, scope, sha(canonical)].join('\n');
  const k = hmac(hmac(hmac(hmac('AWS4' + secret, day), region), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', k).update(toSign).digest('hex');
  return { headers: { ...h, authorization: `AWS4-HMAC-SHA256 Credential=${key}/${scope}, SignedHeaders=${names.join(';')}, Signature=${signature}` }, signature, canonical };
}

function target(c, objectKey) {
  // path-style when a custom endpoint is given (works for R2/B2/MinIO), virtual-host style for plain AWS
  const key = [c.prefix, objectKey].filter(Boolean).join('/').split('/').map(enc).join('/');
  if (c.endpoint) { const u = new URL(c.endpoint); return { url: `${u.origin}/${enc(c.bucket)}/${key}`, host: u.host, path: `/${enc(c.bucket)}/${key}` }; }
  const host = `${c.bucket}.s3.${c.region}.amazonaws.com`; return { url: `https://${host}/${key}`, host, path: `/${key}` };
}

async function call(method, objectKey, body, contentType) {
  const c = cfg(), t = target(c, objectKey);
  const { headers } = signS3({ method, host: t.host, path: t.path, body: body || '', region: c.region, key: c.key, secret: c.secret, extra: contentType ? { 'content-type': contentType } : {} });
  const res = await fetch(t.url, { method, headers, body: body || undefined });
  return res;
}

export async function s3Put(objectKey, buffer, contentType) {
  const res = await call('PUT', objectKey, buffer, contentType);
  if (!res.ok) throw new Error('object storage refused the upload (' + res.status + ')');
}
export async function s3Get(objectKey) {
  const res = await call('GET', objectKey);
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw new Error('object storage read failed (' + res.status + ')');
  return Buffer.from(await res.arrayBuffer());
}
