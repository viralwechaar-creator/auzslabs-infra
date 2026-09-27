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

export async function saveSiteUpload({ tenantId, prefix, buffer }) {
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
