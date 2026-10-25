import { licenceStore } from '../licence.js';
import { HttpError, rateLimited, readJsonBody } from '../lib/http.js';

// Offline Windows install: AUZ_OFFLINE=1 and the folder it keeps its data in. On the cloud server none of this is active.
export const OFFLINE = process.env.AUZ_OFFLINE === '1';
const PUB = process.env.LICENCE_PUBLIC_KEY || '';
const store = OFFLINE ? licenceStore(process.env.AUZ_DATA_DIR || './data', PUB) : null;
export const licenceStatus = () => (store ? store.status() : { state: 'active', cloud: true });

// Without a valid (or just-expired, grace) plan the installed app answers nothing except the licence screen, health and the pages themselves.
const OPEN = (p) => p === '/health' || p.startsWith('/licence/');
export function gate(url) {
  if (!OFFLINE || OPEN(url.pathname)) return;
  const s = store.status();
  if (s.state === 'active' || s.state === 'grace') return;
  throw new HttpError(402, s.state === 'expired' ? 'Your AUZsStyle plan has ended. Enter a new licence code to continue.' : 'Enter your AUZsStyle licence code to start.');
}

export async function handle(ctx) {
  const { req, url, ip, reply } = ctx;
  if (url.pathname === '/licence/status' && req.method === 'GET') return reply(200, { offline: OFFLINE, ...licenceStatus() });
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
