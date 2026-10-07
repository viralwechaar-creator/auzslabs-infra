import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server.js';
import { loadConfig } from '../lib/config.js';
import { hashPassword } from '../lib/auth.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PASSWORD = 'correct horse battery staple';

// A fake "Anthropic" that records every request and answers by role.
export function startFakeAnthropic(handler) {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    calls.push({ url: req.url, headers: req.headers, body });
    let text;
    try { text = handler ? handler(body, calls.length) : defaultReply(body); } catch { req.socket.destroy(); return; } // simulates the AI service dropping the connection
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ content: [{ type: 'text', text }] }));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, calls, url: `http://127.0.0.1:${server.address().port}/v1/messages` })));
}

export function defaultReply(body) {
  if (/router for a small company/.test(body.system)) {
    const m = body.system.match(/- ([a-z-]+): /g) || [];
    const ids = m.map((x) => x.slice(2, -2));
    return JSON.stringify({ agent: /sales|lead/i.test(body.messages[0].content) && ids.includes('ai-sales-lead-generation') ? 'ai-sales-lead-generation' : ids[0], reason: 'test router' });
  }
  const isRevise = /owner_correction/.test(body.messages[0].content);
  return `NEEDS_APPROVAL: no\nAPPROVAL_REASON: none\nTITLE: ${isRevise ? 'Shorter draft' : 'Test deliverable'}\n---\n${isRevise ? 'Short.' : '# Test deliverable\n\nHello from the agent. Starter is ₹2,398 (TODO verify).'}`;
}

export async function makeOffice({ llmHandler, env = {}, keep = false } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'office-'));
  const brain = path.join(tmp, 'brain');
  fs.cpSync(path.join(ROOT, 'brain'), brain, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'office.config.json'), JSON.stringify({ businessName: 'AUZslab', brainPath: './brain', port: 0, model: 'test-model', routerModel: 'test-router', concurrency: 2, maxOpenTasks: 5, agentsFile: path.join(ROOT, 'agents.json') }));
  const fake = await startFakeAnthropic(llmHandler);
  const fullEnv = { OFFICE_PASSWORD_HASH: hashPassword(PASSWORD), OFFICE_SESSION_SECRET: 'x'.repeat(40), ANTHROPIC_API_KEY: 'sk-ant-test-key-1234567890abcdef', ANTHROPIC_API_URL: fake.url, ...env };
  const config = loadConfig(path.join(tmp, 'office.config.json'), fullEnv);
  const app = createApp({ config, env: fullEnv, log: () => {} });
  await new Promise((r) => app.server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  let cookie = '';
  const api = async (method, p, body, { auth = true, headers = {} } = {}) => {
    const h = { ...headers };
    if (body !== undefined) h['content-type'] = 'application/json';
    if (method !== 'GET') h['x-office'] = '1';
    if (auth && cookie) h.cookie = cookie;
    const res = await fetch(base + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* html */ }
    return { status: res.status, json, text, headers: res.headers };
  };
  const login = async () => { const r = await api('POST', '/api/login', { password: PASSWORD }, { auth: false }); cookie = r.headers.get('set-cookie').split(';')[0]; return r; };
  const close = async () => { app.server.close(); fake.server.close(); if (!keep) fs.rmSync(tmp, { recursive: true, force: true }); };
  return { app, api, login, close, fake, brain, tmp, base, env: fullEnv, config };
}

export async function waitFor(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error('timed out waiting');
}
