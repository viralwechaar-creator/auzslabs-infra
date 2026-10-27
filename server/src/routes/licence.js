import { licenceStore, PRODUCT_NAMES } from '../licence.js';
import { HttpError, rateLimited, readJsonBody } from '../lib/http.js';

// Offline Windows install: AUZ_OFFLINE=1 and the folder it keeps its data in. On the cloud server none of this is active.
export const OFFLINE = process.env.AUZ_OFFLINE === '1';
const PUB = process.env.LICENCE_PUBLIC_KEY || '';
// which product this installed copy is (AUZ_PRODUCT: style, pos or ledger); a licence code only opens the product it was made for
export const PRODUCT = PRODUCT_NAMES[process.env.AUZ_PRODUCT] ? process.env.AUZ_PRODUCT : 'style';
const NAME = PRODUCT_NAMES[PRODUCT];
const store = OFFLINE ? licenceStore(process.env.AUZ_DATA_DIR || './data', PUB, PRODUCT) : null;
export const licenceStatus = () => (store ? store.status() : { state: 'active', cloud: true });

// Without a valid (or just-expired, grace) plan the installed app answers nothing except the licence screen, health and the pages themselves.
// (the app's own pages and pictures are open too, so the Activate screen can show: they are files, not data)
// /offline/logs is open too: reporting a bug is exactly the thing an owner needs to do with an expired/unactivated
// licence, not just a healthy one. /offline/lan-info stays gated behind an active licence like the rest of the app.
const OPEN = (p, m) => p === '/health' || p.startsWith('/licence/') || p.startsWith('/setup/') || p === '/offline/logs' || (m === 'GET' && (p === '/' || /\.[a-z0-9]{2,5}$/i.test(p)));
export function gate(url, method = 'GET') {
  if (!OFFLINE || OPEN(url.pathname, method)) return;
  const s = store.status();
  if (s.state === 'active' || s.state === 'grace') return;
  throw new HttpError(402, s.state === 'expired' ? `Your ${NAME} plan has ended. Enter a new licence code to continue.` : `Enter your ${NAME} licence code to start.`);
}

export async function handle(ctx) {
  const { req, url, ip, reply } = ctx;
  if (url.pathname === '/licence/status' && req.method === 'GET') return reply(200, { offline: OFFLINE, appProduct: PRODUCT, appName: NAME, ...licenceStatus() });
  if (url.pathname === '/licence/activate' && req.method === 'POST') {
    if (!OFFLINE) throw new HttpError(400, 'Licence codes are only used by the installed (offline) app.');
    if (rateLimited('licence:' + ip, 20, 15 * 60_000)) throw new HttpError(429, 'Too many tries. Wait a few minutes.');
    const body = await readJsonBody(req);
    const r = store.activate(String(body.code || ''));
    if (!r.ok) throw new HttpError(400, r.error);
    return reply(200, { offline: true, ...r.status });
  }
  return false;
}
