// Small in-memory answer cache for read-only database functions that many people ask for again and again
// (the public menu and online store, price lists) or that are expensive to work out (analytics and reports).
// Identical requests inside the time window share one database call; a burst of simultaneous identical requests shares one too.
// The cache lives in this API process only (see CLAUDE.md: one API copy) and is cleared whenever the process restarts.
const MAX = 600;
const store = new Map(); // key -> { exp, value } | { pending: Promise }

// ttl in seconds. perUser: the answer can differ by who asks (cost and profit are hidden from some staff), so the person is part of the key.
export const CACHEABLE = {
  public_menu: { ttl: 15 }, public_sty_store: { ttl: 15 }, public_reviews: { ttl: 30 }, public_page: { ttl: 15 },
  sty_analytics: { ttl: 45, perUser: true }, sty_insights: { ttl: 45, perUser: true },
  sty_intel_overview: { ttl: 60, perUser: true }, sty_intel_designs: { ttl: 60, perUser: true }, sty_intel_reorder: { ttl: 60, perUser: true }, sty_intel_capital: { ttl: 60, perUser: true },
  acc_balance_sheet: { ttl: 30, perUser: true }, acc_trial_balance: { ttl: 30, perUser: true }, acc_cash_flow: { ttl: 30, perUser: true }, acc_gst_summary: { ttl: 30, perUser: true },
  mob_report_dashboard: { ttl: 20, perUser: true }, mob_report_ledger: { ttl: 20, perUser: true },
};

export async function cached(fn, args, userId, loader) {
  const cfg = CACHEABLE[fn]; if (!cfg) return loader();
  const key = fn + '|' + (cfg.perUser ? userId || '' : '') + '|' + JSON.stringify(args || {});
  const now = Date.now(); const hit = store.get(key);
  if (hit && hit.pending) return hit.pending;
  if (hit && hit.exp > now) return hit.value;
  const pending = loader().then((value) => { store.set(key, { exp: Date.now() + cfg.ttl * 1000, value }); return value; }).catch((e) => { store.delete(key); throw e; });
  store.set(key, { pending });
  if (store.size > MAX) { for (const [k, v] of store) { if (!v.pending && v.exp < now) store.delete(k); if (store.size <= MAX * 0.8) break; } if (store.size > MAX) store.clear(); }
  return pending;
}
export const cacheSize = () => store.size;

// Anything a signed-in person saves may change what the public pages show (menu, prices, store open or closed, stock),
// so the shared public answers are dropped at once; analytics and reports simply expire on their own.
export function invalidatePublic() { for (const [k, v] of store) if (k.startsWith('public_') && !v.pending) store.delete(k); }
