import fs from 'node:fs';
import path from 'node:path';

// Minimal .env loader (no dependency). Real environment variables always win.
export function loadEnvFile(file, env = process.env) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || m[1] in env) continue;
    env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

export function loadConfig(configPath, env = process.env) {
  const file = path.resolve(configPath || env.OFFICE_CONFIG || './office.config.json');
  const dir = path.dirname(file);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const cfg = {
    businessName: String(raw.businessName || 'My Business'),
    brainPath: path.resolve(dir, raw.brainPath || './brain'),
    port: Number(env.OFFICE_PORT || raw.port || 3100),
    host: String(env.OFFICE_HOST || raw.host || '127.0.0.1'),
    model: String(raw.model || 'claude-sonnet-5-5'),
    routerModel: String(raw.routerModel || raw.model || 'claude-sonnet-5-5'),
    maxTokens: Number(raw.maxTokens || 2500),
    timezone: String(raw.timezone || 'Asia/Kolkata'),
    maxOpenTasks: Number(raw.maxOpenTasks || 30),
    concurrency: Math.max(1, Number(raw.concurrency || 2)),
    dataDir: path.resolve(dir, raw.dataDir || './data'),
    agentsFile: path.resolve(dir, raw.agentsFile || './agents.json'),
    baseDir: dir,
  };
  return cfg;
}

export function loadRoster(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const departments = raw.departments;
  const byId = new Map();
  for (const d of departments) for (const a of d.agents) {
    if (byId.has(a.id)) throw new Error('Duplicate agent id: ' + a.id);
    for (const k of ['id', 'name', 'role', 'job', 'brief']) if (!a[k]) throw new Error(`Agent ${a.id || '?'} is missing "${k}"`);
    byId.set(a.id, { ...a, department: d.id });
  }
  return {
    departments,
    agent: (id) => byId.get(id) || null,
    inDepartment: (depId) => (departments.find((d) => d.id === depId)?.agents || []).map((a) => byId.get(a.id)),
    hasDepartment: (depId) => departments.some((d) => d.id === depId),
  };
}
