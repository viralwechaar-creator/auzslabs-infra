// Task board + chat state. Lives in data/ (outside the brain), so agents can never read or change it.
import fs from 'node:fs';
import path from 'node:path';
import { nowIso, newId } from './util.js';

export const STATUSES = ['backlog', 'in_progress', 'waiting_approval', 'done'];

export function createStore(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'state.json');
  let state = { tasks: [], chats: {} };
  if (fs.existsSync(file)) { try { state = { tasks: [], chats: {}, ...JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch { /* start clean */ } }

  function save() {
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 1), { mode: 0o600 });
    fs.renameSync(tmp, file);
  }

  return {
    list: () => state.tasks,
    get: (id) => state.tasks.find((t) => t.id === id) || null,
    create(fields) {
      const t = { id: newId(), status: 'backlog', createdAt: nowIso(), updatedAt: nowIso(), revisions: 0, error: null, ...fields };
      state.tasks.unshift(t); save(); return t;
    },
    update(id, patch) {
      const t = state.tasks.find((x) => x.id === id);
      if (!t) return null;
      Object.assign(t, patch, { updatedAt: nowIso() }); save(); return t;
    },
    openCount: () => state.tasks.filter((t) => t.status === 'backlog' || t.status === 'in_progress').length,
    chat: (agentId) => state.chats[agentId] || [],
    allChats: () => state.chats,
    addChat(agentId, role, text) {
      const list = (state.chats[agentId] = state.chats[agentId] || []);
      list.push({ role, text: String(text).slice(0, 2000), at: nowIso() });
      if (list.length > 100) list.splice(0, list.length - 100);
      save();
    },
  };
}
