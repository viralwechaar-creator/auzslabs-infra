// Runs tasks one after another (small queue). Agents have no tools: the only things that happen are
// "read notes" -> "ask the AI" -> "this server saves a note". Nothing is ever sent anywhere.
import { AGENTS_DIR } from './brain.js';
import { redactSecrets } from './secrets.js';
import { today, slug } from './util.js';
import { agentSystem, taskUser, reviseUser } from './prompts.js';

// Words that mean the task is about doing something outside this app. Those tasks wait for the owner's tap.
const ACTION_RE = /\b(send|email|e-mail|mail|whatsapp|sms|text|message|dm|post|publish|tweet|schedule|book|call|ring|pay|payment|refund|transfer|charge|delete|remove|cancel|invite|share|upload|submit|forward|reply|deploy|restart|rollback|restore|migrate|merge|push|install|execute)\b/i;

export function externalActionIn(text) {
  const m = String(text || '').match(ACTION_RE);
  return m ? m[1].toLowerCase() : null;
}

export function parseOutput(raw) {
  const text = String(raw || '').trim();
  const sep = text.search(/^---\s*$/m);
  const head = sep >= 0 ? text.slice(0, sep) : '';
  let body = sep >= 0 ? text.slice(text.indexOf('\n', sep) + 1).trim() : text;
  const get = (k) => (head.match(new RegExp('^' + k + ':\\s*(.*)$', 'mi')) || [])[1]?.trim() || '';
  const needs = /^yes/i.test(get('NEEDS_APPROVAL'));
  const reason = get('APPROVAL_REASON');
  const title = get('TITLE').replace(/^["'#\s]+|["'\s]+$/g, '').slice(0, 80);
  if (!body) body = text;
  return { needsApproval: needs, approvalReason: /^none$/i.test(reason) ? '' : reason, title, body };
}

const SRC_MARK = '<!-- sources -->';

export function composeNote({ agent, task, title, body, sources, revisions, status, date }) {
  const fm = [
    '---',
    `agent: ${JSON.stringify(agent.id)}`,
    `agent_name: ${JSON.stringify(agent.name)}`,
    `department: ${JSON.stringify(task.department)}`,
    `task: ${JSON.stringify(task.id)}`,
    `date: ${date}`,
    `status: ${status}`,
    `revisions: ${revisions}`,
    '---',
    '',
  ].join('\n');
  const heading = /^#\s/.test(body) ? '' : `# ${title}\n\n`;
  const links = sources.map((s) => `[[${s}]]`).join(' ');
  return `${fm}${heading}${body.trim()}\n\n${SRC_MARK}\n---\nSources read: ${links}\n`;
}

export function noteBody(text) {
  let t = String(text || '');
  t = t.replace(/^---\n[\s\S]*?\n---\n/, '');
  const i = t.indexOf(SRC_MARK);
  return (i >= 0 ? t.slice(0, i) : t).trim();
}

export function createRunner({ store, brain, llm, router, context, roster, config, log = () => {} }) {
  const queue = [];
  let active = 0;
  const idle = [];

  function enqueue(job) { queue.push(job); pump(); }
  function pump() {
    while (active < config.concurrency && queue.length) {
      const job = queue.shift(); active++;
      run(job).catch((e) => log('job crashed: ' + e.message)).finally(() => { active--; pump(); if (!active && !queue.length) idle.splice(0).forEach((f) => f()); });
    }
  }
  const whenIdle = () => (active || queue.length ? new Promise((r) => idle.push(r)) : Promise.resolve());
  const run = (job) => (job.type === 'revise' ? runRevise(job) : runTask(job.id));
  const fail = (id, e) => store.update(id, { status: 'backlog', error: String(e?.message || e).slice(0, 300) });

  function unique(rel) {
    let r = rel, n = 2;
    while (brain.exists(r)) r = rel.replace(/\.md$/, ` ${n++}.md`);
    return r;
  }

  function refreshIndex() {
    const done = store.list().filter((t) => t.note).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const lines = ['# Agents Office index', '', 'Notes written by the agents, newest first.', '', ...done.map((t) => `- [[${t.note.replace(/\.md$/, '')}]] — ${t.agentName}: ${t.title || t.text.slice(0, 60)} (${t.status.replace('_', ' ')})`)];
    try { brain.writeNote(`${AGENTS_DIR}/Agents Office index.md`, lines.join('\n') + '\n'); } catch (e) { log('index not updated: ' + e.message); }
  }

  async function runTask(id) {
    let t = store.get(id);
    if (!t) return;
    try {
      store.update(id, { status: 'in_progress', error: null });
      if (!t.agentId) {
        const r = await router.route(t.department, t.text);
        const a = roster.agent(r.agentId);
        t = store.update(id, { agentId: a.id, agentName: a.name, routedBy: r.by, reason: r.reason });
      }
      const agent = roster.agent(t.agentId);
      const ctx = context.build(t.text, agent.id);
      const raw = await llm.complete({
        system: agentSystem({ business: config.businessName, agent, claude: ctx.claude, feedback: ctx.feedback }),
        user: taskUser(ctx, t.text), model: config.model, maxTokens: config.maxTokens,
      });
      const out = parseOutput(redactSecrets(raw));
      const action = externalActionIn(t.text);
      const needs = out.needsApproval || Boolean(action);
      const reason = out.approvalReason || (action ? `The task mentions "${action}", which happens outside this app. Drafted only: you do it, then tap Approve.` : '');
      const title = out.title || t.text.slice(0, 60);
      const date = today(config.timezone);
      const rel = unique(`${AGENTS_DIR}/${date} ${agent.id} - ${slug(title)}.md`);
      const status = needs ? 'waiting_approval' : 'done';
      brain.writeNote(rel, composeNote({ agent, task: t, title, body: out.body, sources: ctx.sources, revisions: 0, status, date }));
      store.update(id, { status, note: rel, title, sources: ctx.sources, needsApproval: needs, approvalReason: reason });
      store.addChat(agent.id, 'agent', `Finished: “${title}” (${status.replace('_', ' ')}).`);
      refreshIndex();
    } catch (e) { fail(id, e); }
  }

  async function runRevise({ taskId, instruction }) {
    const t = store.get(taskId);
    if (!t) return;
    const agent = roster.agent(t.agentId);
    const prevStatus = t.status;
    try {
      store.update(taskId, { status: 'in_progress', error: null });
      const previousFull = brain.readNote(t.note);
      const ctx = context.build(`${t.text} ${instruction}`, agent.id); // includes the correction just saved
      const raw = await llm.complete({
        system: agentSystem({ business: config.businessName, agent, claude: ctx.claude, feedback: ctx.feedback }),
        user: reviseUser(ctx, t.text, noteBody(previousFull), instruction), model: config.model, maxTokens: config.maxTokens,
      });
      const out = parseOutput(redactSecrets(raw));
      const revisions = (t.revisions || 0) + 1;
      const needs = out.needsApproval || Boolean(externalActionIn(t.text)) || t.needsApproval;
      const status = needs ? 'waiting_approval' : 'done';
      const title = out.title || t.title;
      const date = today(config.timezone);
      brain.writeNote(`${AGENTS_DIR}/history/${t.note.split('/').pop().replace(/\.md$/, '')} v${revisions}.md`, previousFull);
      brain.writeNote(t.note, composeNote({ agent, task: t, title, body: out.body, sources: ctx.sources, revisions, status, date }));
      store.update(taskId, { status, title, revisions, sources: ctx.sources, needsApproval: needs });
      store.addChat(agent.id, 'agent', `Revised “${title}” (version ${revisions + 1}).`);
      refreshIndex();
    } catch (e) {
      store.update(taskId, { status: prevStatus, error: String(e?.message || e).slice(0, 300) });
      store.addChat(agent.id, 'agent', `Could not revise: ${String(e.message).slice(0, 160)}`);
    }
  }

  // Tasks left "in progress" by a restart go back to the queue
  function recover() {
    for (const t of store.list()) if (t.status === 'in_progress' || t.status === 'backlog' && !t.error) enqueue({ type: 'task', id: t.id });
  }

  return { enqueue, recover, whenIdle };
}
