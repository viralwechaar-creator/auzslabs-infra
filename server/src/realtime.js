import { WebSocketServer } from 'ws';
import pg from 'pg';
import { verifyToken, onSessionRevoked } from './auth.js';

// Replaces Supabase Realtime's postgres_changes: the client's shim just
// needs "something in table X changed for my tenant" to trigger its own
// existing sync()/getG() refetch -- not the changed row itself (that's
// exactly what the app already did with postgres_changes too, per its
// own code: `.on('postgres_changes', {...}, () => sync())`).
//
// One dedicated LISTEN connection (outside the pool -- LISTEN sessions
// must not be returned to a pool that might hand them to unrelated
// queries) relays every db/002_core_engine.sql pg_notify('live_changes'
// | 'push_events', ...) to whichever open WebSocket connections belong
// to that notification's tenant_id.
export function startRealtime(server, { onPushEvent }) {
  const wss = new WebSocketServer({ noServer: true });
  const clientsByTenant = new Map(); // tenant_id -> Set<ws>
  const clientsByJti = new Map(); // jti -> Set<ws> -- lets a revoked session's own live socket be closed immediately, not just left to die on its own

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://internal');
    if (url.pathname !== '/ws') { socket.destroy(); return; }
    const token = url.searchParams.get('token');
    const user = token ? verifyToken(token) : null;
    const tenantId = user?.app_metadata?.tenant_id;
    if (!tenantId) { socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.tenantId = tenantId;
      ws.jti = user.jti || null; // a token signed without meta (see signToken's own comment) has no jti -- nothing to track here, same as it isn't individually revocable
      if (!clientsByTenant.has(tenantId)) clientsByTenant.set(tenantId, new Set());
      clientsByTenant.get(tenantId).add(ws);
      if (ws.jti) {
        if (!clientsByJti.has(ws.jti)) clientsByJti.set(ws.jti, new Set());
        clientsByJti.get(ws.jti).add(ws);
      }
      ws.on('close', () => {
        clientsByTenant.get(tenantId)?.delete(ws);
        if (ws.jti) clientsByJti.get(ws.jti)?.delete(ws);
      });
    });
  });

  // Fires synchronously the instant revokeSession()/revokeAllSessionsForUser()
  // runs (self-revoke from account.html, or a platform admin's force
  // sign-out) -- closes that device's own live socket right away instead
  // of leaving it connected until it next reconnects on its own.
  onSessionRevoked((jti) => {
    const set = clientsByJti.get(jti);
    if (!set) return;
    for (const ws of set) { try { ws.close(4001, 'session revoked'); } catch {} }
    clientsByJti.delete(jti);
  });

  const listenClient = new pg.Client({
    host: process.env.PGHOST || 'postgres',
    port: Number(process.env.PGPORT || 5432),
    user: 'app',
    password: process.env.POSTGRES_APP_PASSWORD,
    database: process.env.POSTGRES_DB,
  });

  listenClient.connect().then(() => {
    listenClient.query('LISTEN live_changes');
    listenClient.query('LISTEN push_events');
  });

  listenClient.on('notification', (msg) => {
    let payload;
    try { payload = JSON.parse(msg.payload); } catch { return; }

    if (msg.channel === 'push_events') {
      onPushEvent(payload);
      return;
    }

    // live_changes: {table, tenant_id, kind?, id?}
    const set = clientsByTenant.get(payload.tenant_id);
    if (!set) return;
    const out = JSON.stringify({ type: 'changed', table: payload.table });
    for (const ws of set) {
      if (ws.readyState === ws.OPEN) ws.send(out);
    }
  });

  listenClient.on('error', (err) => {
    console.error('realtime LISTEN connection error, will not auto-reconnect:', err.message);
  });
}
