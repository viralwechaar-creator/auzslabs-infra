import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig, loadRoster, loadEnvFile } from './lib/config.js';
import { createBrain, AGENTS_DIR } from './lib/brain.js';
import { createStore } from './lib/store.js';
import { createLlm } from './lib/llm.js';
import { createContext } from './lib/context.js';
import { createRouter } from './lib/router.js';
import { createRunner, noteBody } from './lib/runner.js';
import { verifyPassword, signSession, verifySession, parseCookies, createLimiter } from './lib/auth.js';
import { HttpError, readJson, today } from './lib/util.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COOKIE = 'office_session';

export function createApp({ config, env = process.env, fetchImpl, log = (m) => console.log(m) }) {
  // Fail closed: no password or secret means no server.
  if (!env.OFFICE_PASSWORD_HASH) throw new Error('OFFICE_PASSWORD_HASH is not set. Run: npm run set-password');
  if (!env.OFFICE_SESSION_SECRET || env.OFFICE_SESSION_SECRET.length < 32) throw new Error('OFFICE_SESSION_SECRET must be at least 32 characters. Run: npm run set-password');

  const roster = loadRoster(config.agentsFile);
  const brain = createBrain(config.brainPath);
  brain.writeNote(`${AGENTS_DIR}/README.md`, '# Agents Office\n\nNotes written by the agents live here. Feedback files in `feedback/` are read before every future task.\n');
  const store = createStore(config.dataDir);
  const llm = createLlm({ env, fetchImpl });
  const context = createContext({ brain, log });
  const router = createRouter({ roster, llm, config });
  const runner = createRunner({ store, brain, llm, router, context, roster, config, log });
  const limiter = createLimiter();
  const secret = env.OFFICE_SESSION_SECRET;
  const trustProxy = env.OFFICE_TRUST_PROXY === '1';

  const flagged = brain.scanForSecrets();
  if (flagged.length) log(`WARNING: these notes look like they contain a key or password and will be ignored: ${flagged.join(', ')}`);

  const page = (name) => fs.readFileSync(path.join(HERE, 'public', name), 'utf8');
  const loginHtml = page('login.html');
  const appHtml = page('app.html');

  const ip = (req) => {
    if (trustProxy) { const xf = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean); if (xf.length) return xf[xf.length - 1]; }
    return req.socket.remoteAddress || 'unknown';
  };
  const secureReq = (req) => trustProxy ? req.headers['x-forwarded-proto'] === 'https' : Boolean(req.socket.encrypted);
  const authed = (req) => verifySession(secret, parseCookies(req.headers.cookie)[COOKIE]);

  function baseHeaders(res, req) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
    if (secureReq(req)) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }
  function sendJson(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); }
  function sendHtml(res, html) {
    const nonce = crypto.randomBytes(16).toString('base64');
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`,
    });
    res.end(html.replaceAll('__NONCE__', nonce).replaceAll('__BUSINESS__', config.businessName.replace(/[<>&"]/g, '')));
  }

  const publicTask = (t) => ({
    id: t.id, department: t.department, text: t.text, agentId: t.agentId || null, agentName: t.agentName || null,
    routedBy: t.routedBy || null, reason: t.reason || '', status: t.status, needsApproval: Boolean(t.needsApproval),
    approvalReason: t.approvalReason || '', title: t.title || '', note: t.note || null, sources: t.sources || [],
    revisions: t.revisions || 0, error: t.error || null, createdAt: t.createdAt, updatedAt: t.updatedAt,
  });

  const server = http.createServer(async (req, res) => {
    baseHeaders(res, req);
    try {
      const url = new URL(req.url, 'http://x');
      const p = url.pathname, m = req.method;

      if (m === 'GET' && p === '/healthz') return sendJson(res, 200, { ok: true });

      if (m === 'GET' && p === '/') return sendHtml(res, authed(req) ? appHtml : loginHtml);

      if (p === '/api/login' && m === 'POST') {
        if (req.headers['x-office'] !== '1') throw new HttpError(403, 'Bad request.');
        const key = ip(req);
        if (limiter.blocked(key)) throw new HttpError(429, 'Too many wrong passwords. Wait 15 minutes.');
        const body = await readJson(req, 4096);
        if (!verifyPassword(body.password, env.OFFICE_PASSWORD_HASH)) { limiter.fail(key); throw new HttpError(401, 'Wrong password.'); }
        limiter.clear(key);
        res.setHeader('Set-Cookie', `${COOKIE}=${signSession(secret)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${7 * 86400}${secureReq(req) ? '; Secure' : ''}`);
        return sendJson(res, 200, { ok: true });
      }

      if (!p.startsWith('/api/')) throw new HttpError(404, 'Not found.');
      if (!authed(req)) throw new HttpError(401, 'Please log in.');
      if (m !== 'GET' && req.headers['x-office'] !== '1') throw new HttpError(403, 'Bad request.');

      if (p === '/api/logout' && m === 'POST') {
        res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
        return sendJson(res, 200, { ok: true });
      }

      if (p === '/api/state' && m === 'GET') {
        return sendJson(res, 200, {
          businessName: config.businessName, keyConfigured: llm.hasKey(), brainNotes: brain.listNotes().filter((n) => !n.rel.startsWith(AGENTS_DIR + '/')).length, today: today(config.timezone),
          departments: roster.departments.map((d) => ({ id: d.id, name: d.name, agents: d.agents.map((a) => ({ id: a.id, name: a.name, role: a.role, job: a.job })) })),
          tasks: store.list().map(publicTask),
          chats: store.allChats(),
        });
      }

      if (p === '/api/tasks' && m === 'POST') {
        const b = await readJson(req);
        const text = String(b.text || '').trim();
        if (!roster.hasDepartment(b.department)) throw new HttpError(400, 'Pick a department.');
        if (text.length < 3) throw new HttpError(400, 'Type the task in a few words.');
        if (text.length > 4000) throw new HttpError(400, 'Task is too long (max 4000 characters).');
        if (store.openCount() >= config.maxOpenTasks) throw new HttpError(429, 'Too many tasks are still running. Wait for some to finish.');
        const fields = { department: b.department, text };
        if (b.agentId) {
          const a = roster.agent(b.agentId);
          if (!a || a.department !== b.department) throw new HttpError(400, 'That agent is not in this department.');
          Object.assign(fields, { agentId: a.id, agentName: a.name, routedBy: 'manual', reason: 'Chosen by you.' });
        }
        const t = store.create(fields);
        runner.enqueue({ type: 'task', id: t.id });
        return sendJson(res, 201, publicTask(t));
      }

      let mm;
      if ((mm = p.match(/^\/api\/tasks\/([a-f0-9]+)\/(approve|retry|note)$/))) {
        const t = store.get(mm[1]);
        if (!t) throw new HttpError(404, 'Task not found.');
        if (mm[2] === 'note' && m === 'GET') {
          if (!t.note) throw new HttpError(404, 'No note yet.');
          return sendJson(res, 200, { path: t.note, markdown: noteBody(brain.readNote(t.note)) });
        }
        if (m !== 'POST') throw new HttpError(405, 'Method not allowed.');
        if (mm[2] === 'approve') {
          if (t.status !== 'waiting_approval') throw new HttpError(409, 'Nothing to approve.');
          store.update(t.id, { status: 'done' });
          if (t.agentId) store.addChat(t.agentId, 'agent', `You approved “${t.title}”.`);
          return sendJson(res, 200, publicTask(store.get(t.id)));
        }
        if (t.status !== 'backlog') throw new HttpError(409, 'Only waiting tasks can be retried.');
        store.update(t.id, { error: null });
        runner.enqueue({ type: 'task', id: t.id });
        return sendJson(res, 200, publicTask(store.get(t.id)));
      }

      if ((mm = p.match(/^\/api\/agents\/([a-z0-9-]+)\/chat$/)) && m === 'POST') {
        const agent = roster.agent(mm[1]);
        if (!agent) throw new HttpError(404, 'Agent not found.');
        const message = String((await readJson(req)).message || '').trim().slice(0, 1500);
        if (!message) throw new HttpError(400, 'Type a message.');
        store.addChat(agent.id, 'you', message);
        const rev = message.match(/^revise\s*:\s*([\s\S]+)$/i);
        const note = message.match(/^note\s*:\s*([\s\S]+)$/i);
        const date = today(config.timezone);
        const feedbackRel = `${AGENTS_DIR}/feedback/${agent.id}.md`;
        const addFeedback = (text, taskId) => {
          let cur = '';
          try { cur = brain.readNote(feedbackRel); } catch { cur = `# Feedback for ${agent.name}\n\nCorrections from the owner. Read before every task.\n\n`; }
          brain.writeNote(feedbackRel, `${cur.trimEnd()}\n- ${date}: ${text.replace(/\s+/g, ' ')}${taskId ? ` (task ${taskId})` : ''}\n`);
        };
        if (rev) {
          const last = store.list().find((t) => t.agentId === agent.id && t.note && t.status !== 'in_progress');
          if (!last) { store.addChat(agent.id, 'agent', 'I have no finished note to revise yet. Add a task first.'); return sendJson(res, 200, { ok: true, queued: false }); }
          addFeedback(rev[1].trim(), last.id);
          store.addChat(agent.id, 'agent', `Got it. Revising “${last.title}” and I will remember this.`);
          runner.enqueue({ type: 'revise', taskId: last.id, instruction: rev[1].trim() });
          return sendJson(res, 200, { ok: true, queued: true, taskId: last.id });
        }
        if (note) {
          addFeedback(note[1].trim(), null);
          store.addChat(agent.id, 'agent', 'Saved. I will read this before every future task.');
          return sendJson(res, 200, { ok: true, queued: false });
        }
        store.addChat(agent.id, 'agent', 'Start with “revise: …” to change my latest note, or “note: …” to teach me something for next time.');
        return sendJson(res, 200, { ok: true, queued: false });
      }

      throw new HttpError(404, 'Not found.');
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) log('error: ' + (e.stack || e.message));
      if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'Something went wrong.' : e.message });
    }
  });

  return { server, runner, store, brain, roster, config };
}

// Run directly: node server.js
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadEnvFile(path.join(HERE, '.env'));
  const config = loadConfig(process.env.OFFICE_CONFIG || path.join(HERE, 'office.config.json'));
  const { server, runner } = createApp({ config });
  server.listen(config.port, config.host, () => {
    console.log(`${config.businessName} Agents Office on http://${config.host}:${config.port} (brain: ${config.brainPath})`);
    runner.recover();
  });
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => server.close(() => process.exit(0)));
}
