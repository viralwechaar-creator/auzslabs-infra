// The ONLY door to the filesystem for agents. Reads anywhere inside the brain folder, writes only inside "Agents Office/".
// Everything is checked in code: no absolute paths, no "..", no symlink escapes, only .md files, size limits, secrets redacted.
import fs from 'node:fs';
import path from 'node:path';
import { HttpError } from './util.js';
import { containsSecret, redactSecrets } from './secrets.js';

export const AGENTS_DIR = 'Agents Office';
const MAX_READ = 200 * 1024;
const MAX_WRITE = 200 * 1024;

export function createBrain(rootInput) {
  fs.mkdirSync(rootInput, { recursive: true });
  const root = fs.realpathSync(rootInput);

  function safeRel(rel) {
    const r = String(rel ?? '');
    if (!r || r.length > 240 || r.includes('\0') || r.includes('\\') || r.startsWith('/') || /^[A-Za-z]:/.test(r)) throw new HttpError(400, 'Path not allowed.');
    const parts = r.split('/');
    if (parts.some((p) => p === '' || p === '.' || p === '..' || p.startsWith('.'))) throw new HttpError(400, 'Path not allowed.');
    if (!r.toLowerCase().endsWith('.md')) throw new HttpError(400, 'Only .md notes are allowed.');
    return parts.join('/');
  }

  const inside = (abs) => abs === root || abs.startsWith(root + path.sep);

  // follows symlinks and checks the real location is still inside the brain
  function realInside(abs) {
    const real = fs.realpathSync(abs);
    if (!inside(real)) throw new HttpError(403, 'Outside the brain folder.');
    return real;
  }

  function readNote(rel) {
    const clean = safeRel(rel);
    const abs = path.join(root, clean);
    let real;
    try { real = realInside(abs); } catch (e) { if (e instanceof HttpError) throw e; throw new HttpError(404, 'Note not found.'); }
    const st = fs.statSync(real);
    if (!st.isFile()) throw new HttpError(404, 'Note not found.');
    if (st.size > MAX_READ) throw new HttpError(413, 'Note too large.');
    return fs.readFileSync(real, 'utf8');
  }

  // All .md notes (no symlinks followed, no hidden folders)
  function listNotes() {
    const out = [];
    (function walk(dir, relDir) {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.name.startsWith('.') || ent.isSymbolicLink()) continue;
        const rel = relDir ? relDir + '/' + ent.name : ent.name;
        if (ent.isDirectory()) walk(path.join(dir, ent.name), rel);
        else if (ent.isFile() && ent.name.toLowerCase().endsWith('.md')) {
          const size = fs.statSync(path.join(dir, ent.name)).size;
          out.push({ rel, name: rel.replace(/\.md$/i, ''), size });
        }
      }
    })(root, '');
    return out.sort((a, b) => a.rel.localeCompare(b.rel));
  }

  function writeNote(rel, text) {
    const clean = safeRel(rel);
    if (!clean.startsWith(AGENTS_DIR + '/')) throw new HttpError(403, 'Agents may only write inside "' + AGENTS_DIR + '".');
    const body = redactSecrets(String(text ?? ''));
    if (Buffer.byteLength(body) > MAX_WRITE) throw new HttpError(413, 'Note too large.');
    const abs = path.join(root, clean);
    const dir = path.dirname(abs);
    fs.mkdirSync(dir, { recursive: true });
    realInside(dir);
    if (fs.existsSync(abs)) {
      if (fs.lstatSync(abs).isSymbolicLink()) throw new HttpError(403, 'Outside the brain folder.');
      realInside(abs);
    }
    const tmp = abs + '.tmp-' + process.pid + '-' + Date.now();
    fs.writeFileSync(tmp, body, { mode: 0o640 });
    fs.renameSync(tmp, abs);
    return clean;
  }

  function exists(rel) {
    try { const abs = path.join(root, safeRel(rel)); return fs.existsSync(abs) && inside(fs.realpathSync(abs)); } catch { return false; }
  }

  // Notes that contain a key/password-looking value are reported (never printed) and skipped when building context.
  function scanForSecrets() {
    const bad = [];
    for (const n of listNotes()) {
      try { if (containsSecret(readNote(n.rel))) bad.push(n.rel); } catch { /* unreadable: ignore */ }
    }
    return bad;
  }

  return { root, safeRel, readNote, listNotes, writeNote, exists, scanForSecrets };
}
