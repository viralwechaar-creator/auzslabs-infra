import http from 'node:http';
import { verifyToken, bearerFrom } from './auth.js';
import { startRealtime, wsCount } from './realtime.js';
import { trackRequest, setWsCounter } from './metrics.js';
import { handlePushEvent } from './push.js';
import { startMaintenance } from './maintenance.js';
import { handleSalon } from './salon.js';
import { initErrorTracking, captureError } from './errors.js';
import { PORT } from './config.js';
import { HttpError, allowedOrigin, clientIp, httpFromError, send } from './lib/http.js';
import { handle as handleSystem } from './routes/system.js';
import { handle as handleAuth } from './routes/auth.js';
import { handle as handlePayments } from './routes/payments.js';
import { handle as handleData } from './routes/data.js';
import { handle as handleStorage } from './routes/storage.js';
import { handle as handleAdmin } from './routes/admin.js';
import { handle as handleWhatsApp } from './routes/whatsapp.js';
import { startWhatsAppWorker } from './whatsapp.js';

initErrorTracking(); // dormant unless SENTRY_DSN is set -- see errors.js

// Request flow: CORS preflight -> identify the caller -> try each route module in order (first one that handles it
// wins) -> 404. Each module in routes/ owns one area; see docs/BACKEND_MAP.md. Order matters only where paths overlap.
const ROUTE_MODULES = [handleSystem, handleAuth, handlePayments, handleData, handleStorage, handleAdmin, handleWhatsApp];

setWsCounter(wsCount);
const server = http.createServer(async (req, res) => {
  trackRequest(req, res);
  // Salon Suite (Showoff Salon's original app, see salon.js): same-origin
  // /api/* on a tenant subdomain, rewritten to /salon-api by Caddy.
  if (req.url.startsWith('/salon-api')) { handleSalon(req, res, clientIp(req)); return; }
  const origin = allowedOrigin(req.headers.origin);
  const reply = (status, body) => send(res, status, body, origin);
  if (req.method === 'OPTIONS') { reply(204, {}); return; }

  const url = new URL(req.url, 'http://internal');
  const user = verifyToken(bearerFrom(req) || '');
  if (user?.app_metadata?.tenant_id) req.auzTenant = user.app_metadata.tenant_id; // read by metrics.js for the per-client cost report
  const ip = clientIp(req);
  const meta = { ip, userAgent: req.headers['user-agent'] || '' }; // threaded into every sign-in, so it gets its own row in auth_sessions (db/071)

  const ctx = { req, res, url, user, ip, meta, reply, origin };
  try {
    for (const handler of ROUTE_MODULES) {
      if ((await handler(ctx)) !== false) return;
    }
    throw new HttpError(404, 'not found');
  } catch (err) {
    // the visitor closed the tab or lost signal mid-request ("aborted", e.g. the page-view beacon): nobody is waiting for an answer, so it is neither an error nor worth an alert
    if (err && (err.message === 'aborted' || err.code === 'ECONNRESET' || err.code === 'ERR_STREAM_PREMATURE_CLOSE' || res.destroyed)) { if (!res.writableEnded && !res.destroyed) { try { res.end(); } catch {} } return; }
    const { status, message } = httpFromError(err);
    if (status === 500) {
      console.error(err);
      captureError(err, { method: req.method, path: url.pathname, user_id: user?.id || null });
    }
    // an unexpected failure never shows its internal text (table names, SQL, paths) to the caller; it is in the server log / error tracker
    reply(status, { error: status === 500 ? 'Something went wrong on our side. Please try again.' : message });
  }
});

startRealtime(server, { onPushEvent: handlePushEvent });

server.listen(PORT, () => console.log(`auzlabs-api listening on :${PORT}`));

// Graceful stop (deploys, restarts): stop taking new requests, let the ones in progress finish, then exit. Gives up after 10 s.
let stopping = false;
for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => {
    if (stopping) return; stopping = true;
    console.log(`${sig}: finishing requests and stopping`);
    server.close(() => process.exit(0));
    server.closeIdleConnections?.();
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
startWhatsAppWorker(); // sends queued WhatsApp messages (whatsapp.js)
startMaintenance(); // daily cleanup of expired sessions / codes / links (see maintenance.js)
