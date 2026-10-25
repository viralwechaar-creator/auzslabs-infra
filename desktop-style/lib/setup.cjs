'use strict';
// Everything the installed AUZsStyle does to its own database on the computer: make the cluster the first time, start and stop it,
// build the tables, keep them up to date when the app is updated, and take / restore backups. Plain Node, no Electron, so it can be
// tested on any machine that has PostgreSQL binaries.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, spawn } = require('node:child_process');

const EXE = process.platform === 'win32' ? '.exe' : '';
const bin = (pgBin, n) => path.join(pgBin, n + EXE);
const SKIP = /mannat/i; // one-off real-client data migrations: not part of a fresh shop
const DB = 'auzslab';

// Tests on Linux run as root, and PostgreSQL refuses to start as root: they name an ordinary user here. Never set on Windows.
let RUN_AS = null;
const setRunAs = (o) => { RUN_AS = o; };
const own = (p) => { if (RUN_AS) fs.chownSync(p, RUN_AS.uid, RUN_AS.gid); };
const asUser = () => (RUN_AS ? { uid: RUN_AS.uid, gid: RUN_AS.gid } : {});

function run(cmd, args, env = {}, input) {
  const r = spawnSync(cmd, args, { env: { ...process.env, ...env }, encoding: 'utf8', input, windowsHide: true, ...asUser() });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`${path.basename(cmd)} failed: ${(r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' | ')}`);
  return r.stdout;
}

// secrets made once and kept beside the data: the database passwords and the key that signs sign-in sessions
function secrets(dir) {
  const f = path.join(dir, 'secrets.json');
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { /* first run */ }
  fs.mkdirSync(dir, { recursive: true });
  const s = { superPassword: crypto.randomBytes(18).toString('base64url'), appPassword: crypto.randomBytes(18).toString('base64url'), jwtSecret: crypto.randomBytes(48).toString('base64url') };
  fs.writeFileSync(f, JSON.stringify(s), { mode: 0o600 });
  return s;
}

function ensureCluster({ pgBin, dataDir, port, superPassword, memoryMb = 2048 }) {
  const pgdata = path.join(dataDir, 'pgdata');
  if (fs.existsSync(path.join(pgdata, 'PG_VERSION'))) return false;
  fs.mkdirSync(dataDir, { recursive: true }); own(dataDir);
  const pw = path.join(dataDir, '.pw'); fs.writeFileSync(pw, superPassword, { mode: 0o600 }); own(pw);
  try { run(bin(pgBin, 'initdb'), ['-D', pgdata, '-U', 'postgres', '-A', 'scram-sha-256', '--pwfile=' + pw, '-E', 'UTF8', '--locale=C']); } finally { fs.rmSync(pw, { force: true }); }
  // small and safe for an old shop computer: few connections, modest memory, writes always flushed to disk
  const small = memoryMb <= 2048;
  fs.appendFileSync(path.join(pgdata, 'postgresql.conf'), `
listen_addresses = '127.0.0.1'
port = ${port}
max_connections = 30
shared_buffers = ${small ? 64 : 160}MB
effective_cache_size = ${small ? 256 : 768}MB
work_mem = 4MB
maintenance_work_mem = 32MB
max_wal_size = 256MB
fsync = on
synchronous_commit = on
logging_collector = off
`);
  return true;
}

function pgCtl(pgBin, dataDir, args) { return run(bin(pgBin, 'pg_ctl'), ['-D', path.join(dataDir, 'pgdata'), ...args]); }
function isRunning({ pgBin, dataDir }) { const r = spawnSync(bin(pgBin, 'pg_ctl'), ['-D', path.join(dataDir, 'pgdata'), 'status'], { encoding: 'utf8', windowsHide: true, ...asUser() }); return r.status === 0; }
function startPg({ pgBin, dataDir }) {
  if (isRunning({ pgBin, dataDir })) return;
  pgCtl(pgBin, dataDir, ['-l', path.join(dataDir, 'postgres.log'), '-w', '-t', '180', 'start']);
}
function stopPg({ pgBin, dataDir }) { if (isRunning({ pgBin, dataDir })) pgCtl(pgBin, dataDir, ['-m', 'fast', '-w', '-t', '60', 'stop']); }

// connects with the pg module the server already ships with
function client({ serverDir, port, password, database }) {
  const pg = require(require.resolve('pg', { paths: [serverDir] }));
  // No timeout here means a blocked loopback connection (antivirus/firewall silently intercepting it, seen on a real Windows
  // machine) freezes the whole app forever with no error and no clue why. 20s is generous for a local connection.
  return new pg.Client({ host: '127.0.0.1', port, user: 'postgres', password, database, connectionTimeoutMillis: 20000 });
}

const REVOKE = `do $$ declare t text; begin for t in select tablename from pg_tables where schemaname = 'public' and (tablename like 'pay\\_%' or tablename like 'mob\\_%' or tablename like 'sty\\_%' or tablename like 'acc\\_%' or tablename like 'fin\\_%') loop execute format('revoke all on %I from app', t); end loop; end $$`;

// Creates the database and builds it from db/*.sql (first start), or applies only the files not applied yet (after an app update).
async function migrate({ serverDir, dbDir, port, superPassword, appPassword, onProgress = () => {} }) {
  let c = client({ serverDir, port, password: superPassword, database: 'postgres' }); await c.connect();
  const has = (await c.query('select 1 from pg_database where datname = $1', [DB])).rowCount > 0;
  if (!has) await c.query(`create database ${DB}`);
  await c.query(`do $$ begin if not exists (select from pg_roles where rolname = 'app') then create role app login password '${appPassword.replace(/'/g, "''")}'; else alter role app password '${appPassword.replace(/'/g, "''")}'; end if; end $$`);
  await c.end();
  c = client({ serverDir, port, password: superPassword, database: DB }); await c.connect();
  try {
    const files = fs.readdirSync(dbDir).filter((f) => f.endsWith('.sql')).sort();
    const first = files.filter((f) => f.startsWith('000_')), last = files.filter((f) => f.startsWith('999_'));
    const middle = files.filter((f) => !first.includes(f) && !last.includes(f) && !SKIP.test(f));
    await c.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
    const done = new Set((await c.query('select name from schema_migrations')).rows.map((r) => r.name));
    const fresh = done.size === 0;
    const todo = fresh ? [...first, ...middle, ...last] : middle.filter((f) => !done.has(f));
    let i = 0;
    for (const f of todo) {
      onProgress(++i, todo.length, f);
      try { await c.query(fs.readFileSync(path.join(dbDir, f), 'utf8')); }
      catch (e) { throw new Error(`${f}: ${e.message.split('\n')[0]}`); }
      await c.query('insert into schema_migrations (name) values ($1) on conflict do nothing', [f]);
    }
    if (fresh) {
      // the build leaves AUZslab's sample businesses and demo logins behind: remove them, so this computer holds only the shop made at first start
      await c.query('truncate tenants, auth_users cascade');
      await c.query(REVOKE); // same as production: the app role reaches the shop tables only through the database functions
    }
    return { fresh, applied: todo.length };
  } finally { await c.end(); }
}

function stamp() { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; }

// A backup is a folder: db.dump (everything in the database) + uploads (pictures) + about.json. Put it anywhere, e.g. a pen drive.
function backup({ pgBin, dataDir, uploadDir, port, superPassword, targetDir, appVersion = '' }) {
  const out = path.join(targetDir, 'AUZsStyle-backup-' + stamp());
  fs.mkdirSync(out, { recursive: true }); own(out);
  run(bin(pgBin, 'pg_dump'), ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-Fc', '-f', path.join(out, 'db.dump'), DB], { PGPASSWORD: superPassword });
  if (uploadDir && fs.existsSync(uploadDir)) fs.cpSync(uploadDir, path.join(out, 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(out, 'about.json'), JSON.stringify({ app: 'AUZsStyle', made: new Date().toISOString(), appVersion }));
  return out;
}

// Replaces everything on this computer with the backup. The caller stops the server first.
async function restore({ serverDir, pgBin, dataDir, uploadDir, port, superPassword, sourceDir }) {
  const dump = path.join(sourceDir, 'db.dump');
  if (!fs.existsSync(dump)) throw new Error('This folder is not an AUZsStyle backup (db.dump is missing).');
  const c = client({ serverDir, port, password: superPassword, database: 'postgres' }); await c.connect();
  try {
    await c.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [DB]);
    await c.query(`drop database if exists ${DB}`);
    await c.query(`create database ${DB}`);
  } finally { await c.end(); }
  run(bin(pgBin, 'pg_restore'), ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '--no-owner', '-d', DB, dump], { PGPASSWORD: superPassword });
  const up = path.join(sourceDir, 'uploads');
  if (uploadDir && fs.existsSync(up)) { fs.rmSync(uploadDir, { recursive: true, force: true }); fs.cpSync(up, uploadDir, { recursive: true }); }
}

module.exports = { setRunAs, secrets, ensureCluster, startPg, stopPg, isRunning, migrate, backup, restore, DB };
