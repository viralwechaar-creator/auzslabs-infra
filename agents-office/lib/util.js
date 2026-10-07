import crypto from 'node:crypto';

export const nowIso = () => new Date().toISOString();
export const newId = () => crypto.randomBytes(6).toString('hex');

export function today(tz = 'Asia/Kolkata') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function slug(s, max = 40) {
  const out = String(s || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/, '');
  return out || 'note';
}

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export async function readJson(req, maxBytes = 64 * 1024) {
  const ct = String(req.headers['content-type'] || '');
  if (!ct.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'Send JSON.');
  const chunks = []; let total = 0;
  for await (const c of req) {
    total += c.length;
    if (total > maxBytes) throw new HttpError(413, 'Request too large.');
    chunks.push(c);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new HttpError(400, 'Invalid JSON.'); }
}

const STOP = new Set(('the and for with that this from have has are was were you your our their them they his her its not but can will would should could about into onto over under than then also just more most some any all out our one two new get got how what when where who why please make write draft need want give show tell using use per via a an of in on at to is it as be by or if we i me my do does did so up').split(/\s+/));
export function tokens(text) {
  const out = [];
  for (const w of String(text || '').toLowerCase().match(/[a-z0-9]{3,}/g) || []) {
    const t = w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w;
    if (!STOP.has(t)) out.push(t);
  }
  return out;
}
