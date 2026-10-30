// Rough request metrics per product area, kept in memory since the API last started (admin -> System resources -> Product load).
// Nothing is stored; a restart clears it. Per-business request counts are kept by tenant id for the cost report. Cost: one timer and a few counters per request.
import { monitorEventLoopDelay } from 'node:perf_hooks';
import fs from 'node:fs';

const since = Date.now();
const lag = monitorEventLoopDelay({ resolution: 20 }); lag.enable();
const tenantUse = new Map(); // tenant id -> { count, ms } (only requests that carry a signed-in business login)
const fam = new Map(); // name -> { count, errors, client, total, max, recent[] }
const KEEP = 400;
let wsReader = () => 0;
export function setWsCounter(fn) { wsReader = fn; }

export function familyOf(pathname) {
  const p = String(pathname || '');
  if (p.startsWith('/salon-api')) return 'Salon';
  if (p === '/sync') return 'AUZsMob (offline sync)';
  if (p.startsWith('/storage')) return 'Pictures and files';
  if (p.startsWith('/auth')) return 'Sign-in';
  if (p.startsWith('/payments')) return 'Payments';
  if (p.startsWith('/whatsapp')) return 'WhatsApp';
  if (p.startsWith('/admin')) return 'Admin and team';
  const rpc = p.match(/^\/rpc\/([a-z_0-9]+)$/);
  if (rpc) {
    const f = rpc[1];
    if (/(^|_)sty_/.test(f)) return 'AUZsStyle';
    if (/^(pay_|payroll_)/.test(f)) return 'AUZsPay';
    if (/(^|_)acc_/.test(f)) return 'AUZsLedger / AUZsScan';
    if (/^mob_|_mob_/.test(f)) return 'AUZsMob';
    if (/^salon_/.test(f)) return 'Salon';
    if (/^(admin_|hub_)/.test(f)) return 'Admin and team';
    if (/^(pos_|place_order|call_waiter|public_menu|next_kot|claim_guest|redeem_gift|public_invoice|submit_feedback|public_reviews)/.test(f)) return 'AUZsPOS and QR ordering';
    return 'Other functions';
  }
  if (p.startsWith('/db/')) return 'AUZsPOS and QR ordering'; // the generic data engine is the POS's records
  return 'Other';
}

export function trackRequest(req, res) {
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    let pathname = req.url || ''; const q = pathname.indexOf('?'); if (q >= 0) pathname = pathname.slice(0, q);
    if (pathname === '/health') return;
    const name = familyOf(pathname);
    let f = fam.get(name); if (!f) { f = { count: 0, errors: 0, client: 0, total: 0, max: 0, recent: [] }; fam.set(name, f); }
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const tid = req.auzTenant; if (tid) { let u = tenantUse.get(tid); if (!u) { u = { count: 0, ms: 0 }; tenantUse.set(tid, u); } u.count++; u.ms += ms; }
    f.count++; f.total += ms; if (ms > f.max) f.max = ms;
    if (res.statusCode >= 500) f.errors++; else if (res.statusCode >= 400) f.client++;
    f.recent.push(ms); if (f.recent.length > KEEP) f.recent.shift();
  });
}

const pct = (arr, p) => { if (!arr.length) return 0; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };

export function tenantUsage() { return Object.fromEntries([...tenantUse.entries()].map(([k, v]) => [k, { count: v.count, ms: Math.round(v.ms) }])); }

export async function metricsReport() {
  const mins = Math.max(1 / 60, (Date.now() - since) / 60000);
  const families = [...fam.entries()].map(([name, f]) => ({
    name, count: f.count, errors: f.errors, client_errors: f.client,
    avg_ms: Math.round(f.total / Math.max(1, f.count)), p95_ms: Math.round(pct(f.recent, 0.95)), max_ms: Math.round(f.max),
    per_min: +(f.count / mins).toFixed(2),
  })).sort((a, b) => b.count - a.count);
  const mem = process.memoryUsage();
  let disk = null; try { const s = await fs.promises.statfs('/'); disk = { total: s.blocks * s.bsize, free: s.bavail * s.bsize }; } catch { /* not available */ }
  return {
    since: new Date(since).toISOString(), minutes: Math.round(mins), families,
    process: { rss: mem.rss, heap_used: mem.heapUsed, loop_lag_p99_ms: Math.round(lag.percentile(99) / 1e6), loop_lag_max_ms: Math.round(lag.max / 1e6), websockets: wsReader() },
    disk,
  };
}
