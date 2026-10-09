import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from './db.js';

// Per-tenant home-screen icon + manifest for the main app shell (POS,
// console, Payroll, Accounting, AUZsMob) -- the exact idea
// server/src/salon.js already built for the Salon niche (salonIcon()),
// generalised to every niche: logo centred on a tile in the business's own
// brand colour, or their initials with no logo uploaded yet, read from the
// normal settings record (kind='settings') instead of salon_store. The
// tenant is resolved from the request's own Host subdomain, never from
// client input, same discipline as salon.js's own tenantFor().

const UPLOAD_ROOT = process.env.UPLOAD_ROOT || '/data/uploads';
const DOMAIN = process.env.DOMAIN || '';
const RESERVED = new Set(['app', 'www', 'api', 'auzspos', 'auzsmob', 'auzspay', 'auzsledger', 'auzsqr', 'auzslab', 'hub', 'agents', 'status']);

// tenants and records both have RLS, and `pool` connects as the `app` role
// (db.js) -- a bare pool.query against either, with no app.uid set (there is
// no session at all for this public, unauthenticated request), returns zero
// rows every single time regardless of what's actually there. Resolved
// through public_app_icon_context() (db/142) instead, the same "one
// SECURITY DEFINER call, no session needed" shape public_menu()/
// public_invoice() already use for exactly this kind of lookup.
export async function tenantForIconContext(req) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0].toLowerCase();
  let slug = null;
  if (DOMAIN && host.endsWith('.' + DOMAIN)) slug = host.slice(0, -(DOMAIN.length + 1));
  if (!slug || slug.includes('.') || RESERVED.has(slug)) return null;
  const { rows } = await pool.query('select public_app_icon_context($1) as ctx', [slug]);
  const ctx = rows[0]?.ctx;
  if (!ctx || !ctx.id) return null;
  return { id: ctx.id, slug, name: ctx.name, settings: ctx.settings || {} };
}

const hex6 = (v, d) => (/^#[0-9a-fA-F]{6}$/.test(v || '') ? v : d);
const iconCache = new Map();

export async function appIcon(tenant, settings, size) {
  const s = settings || {};
  const bg = hex6((s.brand || {}).plum || s.col, '#800020');
  const fg = '#F5F4F2';
  // settings.logo is saved as an ABSOLUTE url (https://api.<domain>/uploads/...
  // -- every uploader, console's own uploadImage() and salesman.html's logo
  // upload alike, builds it as `base + path`), never a bare /uploads/... path
  // -- so a literal startsWith('/uploads/') on the raw string never matched
  // anything and every tenant's real logo silently fell through to initials
  // on their own home-screen icon. Parse out the path instead.
  const logoPath = (() => { try { return typeof s.logo === 'string' && s.logo ? new URL(s.logo, 'https://x').pathname : null; } catch { return null; } })();
  const logo = logoPath && logoPath.startsWith('/uploads/') ? logoPath : null;
  const key = [tenant.slug, logo, s.name, bg, size].join('|');
  if (iconCache.has(key)) return iconCache.get(key);
  const sharp = (await import('sharp')).default;
  let out = null;
  if (logo) {
    try {
      const file = path.join(UPLOAD_ROOT, logo.replace(/^\/uploads\//, ''));
      const inner = Math.round(size * 0.66);
      const lg = await sharp(await fs.readFile(file), { density: 300 })
        .resize(inner, inner, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png().toBuffer();
      out = await sharp({ create: { width: size, height: size, channels: 4, background: bg } })
        .composite([{ input: lg, gravity: 'centre' }]).png().toBuffer();
    } catch { out = null; } // a missing/unreadable logo file falls through to initials below
  }
  if (!out) {
    const words = String(s.name || tenant.name || 'AUZslab').replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean);
    const ini = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || 'A').slice(0, 2)).toUpperCase().replace(/[<>&]/g, '');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="${bg}"/><text x="50%" y="50%" dy=".35em" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-weight="600" font-size="${Math.round(size * 0.42)}" fill="${fg}">${ini}</text></svg>`;
    out = await sharp(Buffer.from(svg)).png().toBuffer();
  }
  if (iconCache.size > 300) iconCache.clear();
  iconCache.set(key, out);
  return out;
}

export function appManifest(tenant, settings) {
  const s = settings || {};
  const name = s.name || tenant.name || 'AUZslab';
  const bg = hex6((s.brand || {}).plum || s.col, '#800020');
  return {
    name, short_name: name, start_url: '/', display: 'standalone',
    background_color: '#f5f4f2', theme_color: bg,
    icons: [192, 512].flatMap((n) => ['any', 'maskable'].map((purpose) => ({
      src: `/app-icon/${n}.png`, sizes: `${n}x${n}`, type: 'image/png', purpose,
    }))),
  };
}
