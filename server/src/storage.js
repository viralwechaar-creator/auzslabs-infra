import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pool, withAuth } from './db.js';
import { s3Enabled, s3Put, s3Get } from './s3.js';
import { limiter } from './lib/limit.js';

// Replaces Supabase Storage's 'site' bucket. Files live on disk under
// ./uploads/site/<tenant-slug>/<prefix>/<file>, written here and served
// directly and publicly by Caddy (see Caddyfile) -- same "public read,
// owner-only write, one folder per tenant" shape the old RLS policies
// enforced, just checked in code instead of storage.foldername(name).
//
// The tenant slug is always resolved server-side from the caller's own
// session -- never trusted from the client -- so there's no way to
// write into another tenant's folder no matter what path is requested.
const UPLOAD_ROOT = process.env.UPLOAD_ROOT || '/data/uploads';
const resizeSlot = limiter(2); // at most two pictures are resized at once, so a burst of uploads cannot slow every other request

// Small copies of an uploaded picture (480 and 900 px wide, WebP) written next to it as <name>.w480.webp / <name>.w900.webp.
// Cards and lists load the small one; the full picture stays for the product page. Best effort: a failure here never fails the upload.
export const THUMB_WIDTHS = [480, 900];
export async function makeThumbs(file) {
  try {
    const sharp = (await import('sharp')).default;
    const base = file.replace(/\.[a-z0-9]+$/i, '');
    for (const w of THUMB_WIDTHS) {
      await resizeSlot(() => sharp(file).rotate().resize({ width: w, withoutEnlargement: true }).webp({ quality: 74 }).toFile(`${base}.w${w}.webp`));
    }
    return true;
  } catch { return false; }
}

// Every picture saved on the server is shrunk (at most 1600 px on the long side, JPEG quality 80). The browser already does this,
// so this catches anything that bypassed it. A picture with see-through parts (PNG logo) and anything that would get bigger is kept as sent.
export async function squeezeImage(buffer) {
  try {
    const sharp = (await import('sharp')).default;
    const meta = await sharp(buffer).metadata();
    if (meta.hasAlpha) return buffer;
    const out = await resizeSlot(() => sharp(buffer).rotate().resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer());
    return out.length < buffer.length ? out : buffer;
  } catch { return buffer; }
}

function safeSegment(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60) || 'x';
}

// The client always re-encodes to JPEG via canvas before uploading
// (see compressImage/uploadSiteImage in app/public/index.html), so
// this only ever rejects a request that bypassed that client entirely
// -- checked by magic bytes, not the (client-supplied, untrustworthy)
// filename or content-type.
export function looksLikeImage(buffer) {
  if (buffer.length < 12) return false;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return true; // JPEG
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return true; // PNG
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return true; // WEBP
  return false;
}

// Employee documents (Aadhar/PAN/driving-licence scans) are private --
// unlike saveSiteUpload above, these must never be reachable through
// Caddy's public `/uploads/*` file_server rule (Caddyfile), so they're
// written under a directory that's requested only via this server's
// own authenticated GET /storage/doc/... route (index.js), never a
// `/uploads/...` URL. Same tenant-isolation shape as saveSiteUpload
// (tenant slug/id resolved server-side, never trusted from the client).
const DOC_ROOT = process.env.DOC_UPLOAD_ROOT || '/data/private-uploads';

function docExtAndCheck(buffer) {
  if (buffer.length < 12) return null;
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return { ext: 'png', type: 'image/png' };
  if (buffer.toString('ascii', 0, 5) === '%PDF-') return { ext: 'pdf', type: 'application/pdf' };
  return null;
}

export async function saveDocUpload({ tenantId, empId, buffer }) {
  const kind = docExtAndCheck(buffer);
  if (!kind) {
    const err = new Error('file must be a JPEG, PNG or PDF');
    err.status = 400;
    throw err;
  }
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${kind.ext}`;
  if (s3Enabled()) await s3Put(`private/${safeSegment(tenantId)}/${safeSegment(empId)}/${filename}`, buffer, kind.type);
  else {
    const dir = path.join(DOC_ROOT, safeSegment(tenantId), safeSegment(empId));
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, filename), buffer);
  }
  return { path: `${safeSegment(tenantId)}/${safeSegment(empId)}/${filename}`, contentType: kind.type };
}

export async function readDocUpload({ tenantId, empId, filename }) {
  const ext = path.extname(filename).toLowerCase();
  const type = ext === '.pdf' ? 'application/pdf' : ext === '.png' ? 'image/png' : ext === '.jpg' ? 'image/jpeg' : null;
  if (!type) return null;
  const base = safeSegment(path.basename(filename, ext));
  const file = path.join(DOC_ROOT, safeSegment(tenantId), safeSegment(empId), base + ext);
  try {
    const buffer = await fs.readFile(file);
    return { buffer, type };
  } catch {
    // not on disk: it may be in object storage (files written before it was switched on stay on disk and are found above)
    if (!s3Enabled()) return null;
    try {
      const buffer = await s3Get(`private/${safeSegment(tenantId)}/${safeSegment(empId)}/${base}${ext}`);
      return buffer ? { buffer, type } : null;
    } catch { return null; }
  }
}

// Recursive, in-process byte count -- no shelling out to `du` (see
// db/029_admin_system_stats.sql's own note on why that was skipped
// originally). fs.stat on a directory only gives its own inode size,
// not its contents, so this has to actually walk the tree; on a droplet
// this small the upload trees are nowhere near big enough for that to
// matter. Missing root (nothing uploaded yet on a fresh box) is 0, not
// an error.
async function dirSize(dir) {
  let total = 0;
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await dirSize(full);
    else if (entry.isFile()) {
      try { total += (await fs.stat(full)).size; } catch {}
    }
  }
  return total;
}

// Bytes of files per business for the cost report: public pictures are under site/<slug>, private documents under <tenant id>.
export async function getTenantFileSizes() {
  const out = {};
  const sub = async (root) => { try { return (await fs.readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory()); } catch { return []; } };
  for (const d of await sub(path.join(UPLOAD_ROOT, 'site'))) out[d.name] = (out[d.name] || 0) + await dirSize(path.join(UPLOAD_ROOT, 'site', d.name));
  for (const d of await sub(DOC_ROOT)) out[d.name] = (out[d.name] || 0) + await dirSize(path.join(DOC_ROOT, d.name));
  return out;
}

export async function getUploadsDiskUsage() {
  const [siteBytes, docBytes] = await Promise.all([dirSize(UPLOAD_ROOT), dirSize(DOC_ROOT)]);
  return { site_bytes: siteBytes, doc_bytes: docBytes, total_bytes: siteBytes + docBytes };
}

export async function saveSiteUpload({ tenantId, uid, prefix, buffer }) {
  if (!looksLikeImage(buffer)) {
    const err = new Error('file does not look like a supported image (jpeg/png/webp)');
    err.status = 400;
    throw err;
  }

  // tenants has owner-read RLS (db/013, keyed on app_uid()) -- a bare pool.query here never
  // set app.uid, so this always returned zero rows and every upload failed with "unknown
  // tenant", for every tenant, the whole time that policy has existed (the exact same bug
  // shape CLAUDE.md already documents for the Razorpay createOrder() fix and the
  // subscriptions table). Routing through withAuth(uid, ...) is the fix used there too.
  const { rows } = await withAuth(uid, (client) => client.query('select slug from tenants where id = $1', [tenantId]));
  const slug = rows[0]?.slug;
  if (!slug) throw new Error('unknown tenant');

  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
  const dir = path.join(UPLOAD_ROOT, 'site', safeSegment(slug), safeSegment(prefix));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), await squeezeImage(buffer));
  makeThumbs(path.join(dir, filename));

  const publicPath = `/uploads/site/${safeSegment(slug)}/${safeSegment(prefix)}/${filename}`;
  return { path: publicPath };
}

// AUZsStyle Cloud Sync photo upload (db/280): a style's photo lives only on the offline PC's own disk until the
// sync worker uploads it here. Deliberately NOT under /uploads/site/<slug>/... like saveSiteUpload above -- that
// is exactly the path shape the PC's own push logic treats as "still local, needs uploading", so a cloud-side
// URL must never collide with it or the worker would try to re-upload its own already-cloud copy forever.
// Content-hashed filename: re-pushing the same picture (an unrelated field on the same style changed) writes the
// same file over itself instead of piling up duplicates.
export async function saveCloudSyncUpload({ slug, buffer }) {
  if (!looksLikeImage(buffer)) {
    const err = new Error('file does not look like a supported image (jpeg/png/webp)');
    err.status = 400;
    throw err;
  }
  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const dir = path.join(UPLOAD_ROOT, 'cloud-sync', safeSegment(slug));
  await fs.mkdir(dir, { recursive: true });
  const filename = `${hash}.jpg`;
  await fs.writeFile(path.join(dir, filename), await squeezeImage(buffer));
  return { path: `/uploads/cloud-sync/${safeSegment(slug)}/${filename}` };
}

// Marketing-site pictures edited by the platform admin (Admin -> Website): not tied to any tenant.
export async function savePlatformUpload({ prefix, buffer }) {
  if (!looksLikeImage(buffer)) {
    const err = new Error('file does not look like a supported image (jpeg/png/webp)');
    err.status = 400;
    throw err;
  }
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
  const dir = path.join(UPLOAD_ROOT, 'site', '_platform', safeSegment(prefix));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), await squeezeImage(buffer));
  return { path: `/uploads/site/_platform/${safeSegment(prefix)}/${filename}` };
}
