import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from './db.js';

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

function safeSegment(s) {
  return String(s).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 60) || 'x';
}

// The client always re-encodes to JPEG via canvas before uploading
// (see compressImage/uploadSiteImage in app/public/index.html), so
// this only ever rejects a request that bypassed that client entirely
// -- checked by magic bytes, not the (client-supplied, untrustworthy)
// filename or content-type.
function looksLikeImage(buffer) {
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
  const dir = path.join(DOC_ROOT, safeSegment(tenantId), safeSegment(empId));
  await fs.mkdir(dir, { recursive: true });
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${kind.ext}`;
  await fs.writeFile(path.join(dir, filename), buffer);
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
    return null;
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

export async function getUploadsDiskUsage() {
  const [siteBytes, docBytes] = await Promise.all([dirSize(UPLOAD_ROOT), dirSize(DOC_ROOT)]);
  return { site_bytes: siteBytes, doc_bytes: docBytes, total_bytes: siteBytes + docBytes };
}

export async function saveSiteUpload({ tenantId, prefix, buffer }) {
  if (!looksLikeImage(buffer)) {
    const err = new Error('file does not look like a supported image (jpeg/png/webp)');
    err.status = 400;
    throw err;
  }

  const { rows } = await pool.query('select slug from tenants where id = $1', [tenantId]);
  const slug = rows[0]?.slug;
  if (!slug) throw new Error('unknown tenant');

  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
  const dir = path.join(UPLOAD_ROOT, 'site', safeSegment(slug), safeSegment(prefix));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), buffer);

  const publicPath = `/uploads/site/${safeSegment(slug)}/${safeSegment(prefix)}/${filename}`;
  return { path: publicPath };
}
