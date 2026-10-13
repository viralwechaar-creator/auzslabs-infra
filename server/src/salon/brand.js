import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { UPLOAD_ROOT, hex6 } from './util.js';

// ---- uploads: stored on the shared uploads volume, served publicly by
// Caddy at /uploads/salon/<slug>/<file> (same volume api.$DOMAIN serves). ----
export async function saveUpload(tenant, buf, ext) {
  const name = crypto.randomBytes(8).toString('hex') + '.' + ext;
  const dir = path.join(UPLOAD_ROOT, 'salon', tenant.slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), buf);
  return `/uploads/salon/${tenant.slug}/${name}`;
}


// ---- Per-salon home-screen identity: a web manifest and icons built from the salon's own logo and
// brand colour (so "Add to home screen" shows their logo, not Showoff's). The icon is the logo centred on a
// tile in the brand colour; with no uploaded logo it is the salon's initials, so every salon still gets
// its own. Cached in memory by logo + colour + size. ----
const iconCache = new Map();
export async function salonIcon(tenant, site, size) {
  const S = site.settings || {}, t = S.theme || {};
  const bg = hex6(t.plum, '#391D21'), fg = hex6(t.cream, '#F3E6C8');
  const logo = typeof S.logoLight === 'string' && S.logoLight.startsWith('/uploads/salon/' + tenant.slug + '/') ? S.logoLight
    : typeof S.logo === 'string' && S.logo.startsWith('/uploads/salon/' + tenant.slug + '/') ? S.logo : null;
  const key = [tenant.slug, logo, S.salonName, bg, fg, size].join('|');
  if (iconCache.has(key)) return iconCache.get(key);
  const sharp = (await import('sharp')).default;
  let out;
  const tile = { create: { width: size, height: size, channels: 4, background: bg } };
  if (logo) {
    const file = path.join(UPLOAD_ROOT, 'salon', tenant.slug, path.basename(logo));
    const inner = Math.round(size * 0.66);
    const lg = await sharp(await fs.readFile(file), { density: 300 }).resize(inner, inner, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    // A dark logo on a dark tile would vanish: if the logo's average is close to the tile colour, put it on a light tile.
    const { channels } = await sharp(lg).stats();
    const lum = (channels[0].mean * 0.3 + channels[1].mean * 0.59 + channels[2].mean * 0.11);
    const bgL = parseInt(bg.slice(1, 3), 16) * 0.3 + parseInt(bg.slice(3, 5), 16) * 0.59 + parseInt(bg.slice(5, 7), 16) * 0.11;
    const base = Math.abs(lum - bgL) < 60 ? { create: { width: size, height: size, channels: 4, background: fg } } : tile;
    out = await sharp(base).composite([{ input: lg, gravity: 'centre' }]).png().toBuffer();
  } else {
    const words = String(S.salonName || 'Salon').replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean);
    const ini = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || 'S').slice(0, 2)).toUpperCase().replace(/[<>&]/g, '');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="100%" height="100%" fill="${bg}"/><text x="50%" y="50%" dy=".35em" text-anchor="middle" font-family="Helvetica,Arial,sans-serif" font-weight="600" font-size="${Math.round(size * 0.42)}" fill="${fg}">${ini}</text></svg>`;
    out = await sharp(Buffer.from(svg)).png().toBuffer();
  }
  if (iconCache.size > 300) iconCache.clear();
  iconCache.set(key, out);
  return out;
}

// Link-preview card (WhatsApp, Facebook ...): brand colour, logo or initials, salon name and tagline.
export async function salonOgImage(tenant, site) {
  const S = site.settings || {}, t = S.theme || {};
  const bg = hex6(t.plum, '#391D21'), fg = hex6(t.cream, '#F3E6C8');
  const key = ['og', tenant.slug, S.logo, S.logoLight, S.salonName, S.tagline, bg, fg].join('|');
  if (iconCache.has(key)) return iconCache.get(key);
  const sharp = (await import('sharp')).default;
  const esc = (v) => String(v || '').replace(/[<>&"]/g, '');
  const name = esc(S.salonName || tenant.name || 'Salon').slice(0, 34), tag = esc(S.tagline || '').slice(0, 60);
  const logo = [S.logoLight, S.logo].find((v) => typeof v === 'string' && v.startsWith('/uploads/salon/' + tenant.slug + '/'));
  const layers = [];
  let top = 150;
  if (logo) {
    const lg = await sharp(await fs.readFile(path.join(UPLOAD_ROOT, 'salon', tenant.slug, path.basename(logo))), { density: 300 }).resize(280, 280, { fit: 'inside' }).png().toBuffer();
    const { channels } = await sharp(lg).stats();
    const lum = channels[0].mean * 0.3 + channels[1].mean * 0.59 + channels[2].mean * 0.11;
    const bgL = parseInt(bg.slice(1, 3), 16) * 0.3 + parseInt(bg.slice(3, 5), 16) * 0.59 + parseInt(bg.slice(5, 7), 16) * 0.11;
    const lt = sharp(lg); layers.push({ input: Math.abs(lum - bgL) < 60 ? await lt.negate({ alpha: false }).png().toBuffer() : lg, top: 90, left: Math.round((1200 - (await sharp(lg).metadata()).width) / 2) });
    top = 440;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="100%" height="100%" fill="${bg}"/>
    <text x="600" y="${top + (logo ? 0 : 150)}" text-anchor="middle" font-family="DejaVu Sans,Helvetica,Arial,sans-serif" font-weight="700" font-size="${name.length > 20 ? 64 : 82}" fill="${fg}">${name}</text>
    <text x="600" y="${top + (logo ? 70 : 230)}" text-anchor="middle" font-family="DejaVu Sans,Helvetica,Arial,sans-serif" font-size="34" fill="${fg}" fill-opacity=".8">${tag}</text></svg>`;
  const out = await sharp(Buffer.from(svg)).composite(layers).png().toBuffer();
  if (iconCache.size > 300) iconCache.clear();
  iconCache.set(key, out);
  return out;
}
