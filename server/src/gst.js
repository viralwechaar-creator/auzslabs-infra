import { pool } from './db.js';

// GSTIN details lookup through Appyflow. Dormant until GST_LOOKUP_KEY is set. Answers are cached for GST_CACHE_DAYS (default 30)
// and each business can make GST_DAILY_CAP (default 100) uncached lookups a day, because every provider call costs money.
const URL_BASE = process.env.GST_LOOKUP_URL || 'https://appyflow.in/api/verifyGST';
const CACHE_DAYS = Number(process.env.GST_CACHE_DAYS || 30);
const DAILY_CAP = Number(process.env.GST_DAILY_CAP || 100);
export const gstEnabled = () => !!process.env.GST_LOOKUP_KEY;

const B36 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export function gstinValid(g) {
  g = String(g || '').trim().toUpperCase();
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g)) return false;
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    let v = B36.indexOf(g[i]) * (i % 2 === 0 ? 1 : 2);
    v = Math.floor(v / 36) + (v % 36);
    sum += v;
  }
  return B36[(36 - (sum % 36)) % 36] === g[14];
}

const REG = { regular: 'regular', composition: 'composition', sez: 'sez', 'sez unit': 'sez', 'sez developer': 'sez' };
export function normalise(gstin, raw) {
  const t = (raw && (raw.taxpayerInfo || raw.data)) || raw || {};
  const a = (t.pradr && t.pradr.addr) || {};
  const parts = [a.bno, a.flno, a.bnm, a.st, a.loc].filter(Boolean).join(', ');
  const status = String(t.sts || '').trim();
  const dty = String(t.dty || '').trim().toLowerCase();
  return {
    gstin,
    legal_name: String(t.lgnm || '').trim(),
    trade_name: String(t.tradeNam || '').trim(),
    status,
    active: /^active$/i.test(status),
    reg_date: t.rgdt || '',
    taxpayer_type: t.dty || '',
    constitution: t.ctb || '',
    address: String((t.pradr && t.pradr.adr) || parts || '').trim(),
    city: String(a.dst || a.city || a.loc || '').trim(),
    state_code: gstin.slice(0, 2),
    pincode: String(a.pncd || '').trim(),
    pan: gstin.slice(2, 12),
    reg_type: REG[dty] || 'regular',
  };
}

export async function lookup({ gstin, tenantId, userId }) {
  gstin = String(gstin || '').trim().toUpperCase();
  const c = await pool.query(`select data from gst_lookup_cache where gstin = $1 and fetched_at > now() - ($2 || ' days')::interval`, [gstin, String(CACHE_DAYS)]);
  if (c.rows[0]) {
    await pool.query('insert into gst_lookup_log (tenant_id, user_id, gstin, cached, ok) values ($1,$2,$3,true,true)', [tenantId, userId, gstin]).catch(() => {});
    return { ...c.rows[0].data, cached: true };
  }
  if (!gstEnabled()) return { error: 503, message: 'GST lookup is not switched on yet. Ask AUZslab to turn it on.' };
  const used = (await pool.query(`select count(*)::int n from gst_lookup_log where tenant_id = $1 and cached = false and at > now() - interval '1 day'`, [tenantId])).rows[0].n;
  if (used >= DAILY_CAP) return { error: 429, message: 'Daily GST lookup limit reached. Type the details by hand or try tomorrow.' };
  let body = null, ok = false;
  try {
    const r = await fetch(`${URL_BASE}?gstNo=${encodeURIComponent(gstin)}&key_secret=${encodeURIComponent(process.env.GST_LOOKUP_KEY)}`, { signal: AbortSignal.timeout(15000) });
    body = await r.json().catch(() => null);
    ok = !!(body && !body.error && (body.taxpayerInfo || body.data));
  } catch { /* network */ }
  await pool.query('insert into gst_lookup_log (tenant_id, user_id, gstin, cached, ok) values ($1,$2,$3,false,$4)', [tenantId, userId, gstin, ok]).catch(() => {});
  if (!body) return { error: 502, message: 'Could not reach the GST service. Try again in a moment.' };
  if (!ok) return { error: 404, message: String(body.message || 'No details found for this GST number.') };
  const data = normalise(gstin, body);
  await pool.query(`insert into gst_lookup_cache (gstin, data) values ($1,$2) on conflict (gstin) do update set data = excluded.data, fetched_at = now()`, [gstin, data]);
  return { ...data, cached: false };
}
