// AI integration ("Connectors", db/318): an MCP (Model Context Protocol) server any MCP-capable AI app (Claude,
// ChatGPT, etc.) can add as a connector, exactly the way Claude.ai already connects to GitHub/Drive -- the
// client's own AI app and subscription, nothing of ours. Transport is MCP's plain "Streamable HTTP": one POST
// endpoint carrying JSON-RPC 2.0 (initialize / tools/list / tools/call), hand-rolled -- no SDK, matching this
// codebase's "no build step, no framework" rule (see CLAUDE.md "Stack").
//
// Auth is a SEPARATE path from the rest of the API, by design: every other route trusts the JWT `user` index.js
// already resolved from the Authorization header, but an MCP client sends one of our own `auz_mcp_...` keys there
// instead (verifyToken() already returns null for it harmlessly -- it isn't a valid JWT). This module looks the
// Bearer token up for itself via mcp_resolve_key() (db/318), the same "hash it, look it up, there is no session
// yet" shape server/src/auth/password.js's login() already uses for a plain password.
//
// Every tool below is a thin wrapper around code the rest of the app already runs and already trusts
// (handleSelect/callRpc from data/queries.js, inside withAuth so RLS applies exactly as it does for a logged-in
// staff member) -- no new business logic, no new SQL beyond db/318's own key-management/draft-order functions.
import { createHash, randomUUID } from 'node:crypto';
import { pool, withAuth } from '../db.js';
import { HttpError, readJsonBody } from '../lib/http.js';
import { TABLES } from '../data/tables.js';
import { handleSelect, callRpc } from '../data/queries.js';

const sha256 = (v) => createHash('sha256').update(String(v)).digest('hex');

// ---- tool catalogue -----------------------------------------------------------------------------------------
const TOOLS = [
  {
    name: 'list_inventory',
    description: "List this business's menu/inventory items (name, price, stock). Read-only.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', description: 'max items to return (default 50, max 200)' } } },
  },
  {
    name: 'list_orders',
    description: "List this business's most recent orders/bills (items, total, status). Read-only.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { limit: { type: 'integer', description: 'max orders to return (default 20, max 100)' } } },
  },
  {
    name: 'list_staff',
    description: "List this business's staff (name, role, phone). Read-only.",
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'sales_summary',
    description: 'A quick revenue/order-count summary since a given number of days ago (default 1 = today). Approximate: based on when records were last updated, not a full accounting report.',
    annotations: { readOnlyHint: true },
    inputSchema: { type: 'object', properties: { days: { type: 'integer', description: 'how many days back to include (default 1)' } } },
  },
  {
    name: 'add_inventory_item',
    description: 'Add a new menu/inventory item. Most AI apps will ask you to confirm before running this -- it changes real data.',
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object', required: ['name', 'price'],
      properties: { name: { type: 'string' }, price: { type: 'number' }, stock: { type: 'number', description: 'optional, for items tracked by stock count' } },
    },
  },
  {
    name: 'update_item_price',
    description: "Update an existing item's price. Most AI apps will ask you to confirm before running this -- it changes real data.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: { type: 'object', required: ['item_id', 'price'], properties: { item_id: { type: 'string', description: 'the id from list_inventory' }, price: { type: 'number' } } },
  },
  {
    name: 'create_draft_order',
    description: "Draft a new order/bill from a list of items. This does NOT finalize a sale -- it lands in the business's existing order inbox for staff to review and accept, same as a customer's own QR order, so a wrong or made-up order never becomes a real bill unattended. Most AI apps will ask you to confirm before running this.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: {
      type: 'object', required: ['items'],
      properties: {
        table: { type: 'string', description: 'table/order label, e.g. "T3" or "Takeaway" (optional)' },
        items: { type: 'array', items: { type: 'object', required: ['name', 'qty', 'price'], properties: { name: { type: 'string' }, qty: { type: 'number' }, price: { type: 'number' } } } },
        note: { type: 'string', description: 'optional note for staff, e.g. who asked for this' },
      },
    },
  },
];

const itemFilters = (extra) => { const p = new URLSearchParams({ 'eq.kind': 'item', 'eq.deleted': 'false', order: 'updated_at', ...extra }); return p; };

async function runTool(client, name, args) {
  args = args && typeof args === 'object' ? args : {};
  switch (name) {
    case 'list_inventory': {
      const limit = Math.min(Math.max(parseInt(args.limit, 10) || 50, 1), 200);
      const rows = await handleSelect(client, 'records', TABLES.records, itemFilters({ limit: String(limit) }));
      return rows.map((r) => ({ id: r.id, ...r.data }));
    }
    case 'list_orders': {
      const limit = Math.min(Math.max(parseInt(args.limit, 10) || 20, 1), 100);
      const p = new URLSearchParams({ 'eq.kind': 'order', 'eq.deleted': 'false', order: 'updated_at', limit: String(limit) });
      const rows = await handleSelect(client, 'records', TABLES.records, p);
      return rows.map((r) => ({ id: r.id, updated_at: r.updated_at, ...r.data }));
    }
    case 'list_staff': {
      const p = new URLSearchParams({ select: 'id,email,role,name,phone' });
      return handleSelect(client, 'profiles', TABLES.profiles, p);
    }
    case 'sales_summary': {
      const days = Math.min(Math.max(parseInt(args.days, 10) || 1, 1), 90);
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const p = new URLSearchParams({ 'eq.kind': 'order', 'eq.deleted': 'false', 'gte.updated_at': since, limit: '2000' });
      const rows = await handleSelect(client, 'records', TABLES.records, p);
      const billed = rows.filter((r) => r.data && ['paid', 'due'].includes(r.data.status));
      const revenue = billed.reduce((sum, r) => sum + (Number(r.data.total) || 0), 0);
      return { since_days: days, orders_seen: rows.length, bills: billed.length, revenue_sum: Math.round(revenue * 100) / 100 };
    }
    case 'add_inventory_item': {
      if (!args.name || args.price == null) throw new HttpError(400, 'name and price are required');
      const rid = randomUUID();
      return callRpc(client, 'push_record', { rid, rkind: 'item', rdata: { name: String(args.name), price: Number(args.price), ...(args.stock != null ? { stock: Number(args.stock) } : {}) }, rdeleted: false, base: null, force: true });
    }
    case 'update_item_price': {
      if (!args.item_id || args.price == null) throw new HttpError(400, 'item_id and price are required');
      const p = new URLSearchParams({ 'eq.id': String(args.item_id), 'eq.kind': 'item', limit: '1' });
      const rows = await handleSelect(client, 'records', TABLES.records, p);
      const existing = rows[0];
      if (!existing) throw new HttpError(404, 'no such item (check the id from list_inventory)');
      return callRpc(client, 'push_record', { rid: args.item_id, rkind: 'item', rdata: { ...existing.data, price: Number(args.price) }, rdeleted: false, base: null, force: true });
    }
    case 'create_draft_order':
      if (!Array.isArray(args.items) || !args.items.length) throw new HttpError(400, 'items must be a non-empty array of {name,qty,price}');
      return callRpc(client, 'mcp_create_draft_order', { p_table: args.table || null, p_items: args.items, p_note: args.note || null });
    default:
      throw new HttpError(404, `unknown tool: ${name}`);
  }
}

function rpcOk(id, result) { return { jsonrpc: '2.0', id, result }; }
function rpcErr(id, code, message) { return { jsonrpc: '2.0', id, error: { code, message } }; }

export async function handle(ctx) {
  const { req, res, url, reply } = ctx;
  if (url.pathname !== '/mcp') return false;
  if (req.method !== 'POST') throw new HttpError(405, 'method not allowed');

  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) throw new HttpError(401, 'missing connector key');
  const { rows } = await pool.query('select mcp_resolve_key($1) as r', [sha256(token)]);
  const resolved = rows[0]?.r;
  if (!resolved) throw new HttpError(401, 'invalid or revoked connector key');
  const { user_id } = resolved;

  const body = await readJsonBody(req, 500_000);
  const { id = null, method, params = {} } = body || {};

  if (method === 'initialize') {
    return reply(200, rpcOk(id, {
      protocolVersion: '2025-06-18',
      serverInfo: { name: 'auzslab', version: '1.0.0' },
      capabilities: { tools: {} },
    }));
  }
  if (method === 'notifications/initialized') { res.statusCode = 202; res.end(); return; } // no reply expected for a notification
  if (method === 'tools/list') return reply(200, rpcOk(id, { tools: TOOLS }));
  if (method === 'tools/call') {
    const name = params?.name;
    try {
      const data = await withAuth(user_id, (client) => runTool(client, name, params?.arguments));
      return reply(200, rpcOk(id, { content: [{ type: 'text', text: JSON.stringify(data) }], isError: false }));
    } catch (err) {
      const message = err instanceof HttpError ? err.message : (err?.message || 'tool call failed');
      return reply(200, rpcOk(id, { content: [{ type: 'text', text: message }], isError: true }));
    }
  }
  return reply(200, rpcErr(id, -32601, `method not found: ${method}`));
}
