// What an agent reads before a task: CLAUDE.md, index.md, its own feedback file, and the 5 most relevant notes.
import { tokens } from './util.js';
import { AGENTS_DIR } from './brain.js';
import { containsSecret } from './secrets.js';

const NOTE_CAP = 6000;
const FEEDBACK_CAP = 4000;

export function createContext({ brain, log = () => {} }) {
  function safeRead(rel) {
    try {
      const text = brain.readNote(rel);
      if (containsSecret(text)) { log(`Skipped "${rel}": it looks like it contains a key or password. Remove it from the brain.`); return null; }
      return text;
    } catch { return null; }
  }

  function score(taskTokens, note, text) {
    const nameTokens = new Set(tokens(note.name.replace(/[/_-]/g, ' ')));
    const headingTokens = new Set(tokens((text.match(/^#{1,3} .*$/gm) || []).join(' ')));
    const counts = new Map();
    for (const t of tokens(text)) counts.set(t, (counts.get(t) || 0) + 1);
    let s = 0;
    for (const t of new Set(taskTokens)) {
      if (nameTokens.has(t)) s += 6;
      if (headingTokens.has(t)) s += 3;
      s += Math.min(counts.get(t) || 0, 5);
    }
    return s;
  }

  function pickRelevant(taskText, k = 5) {
    const taskTokens = tokens(taskText);
    const scored = [];
    for (const n of brain.listNotes()) {
      if (n.rel === 'CLAUDE.md' || n.rel === 'index.md' || n.rel.startsWith(AGENTS_DIR + '/')) continue;
      const text = safeRead(n.rel);
      if (text == null) continue;
      scored.push({ note: n, text, s: score(taskTokens, n, text) });
    }
    scored.sort((a, b) => b.s - a.s || a.note.rel.localeCompare(b.note.rel));
    let picked = scored.filter((x) => x.s > 0).slice(0, k);
    if (!picked.length) picked = scored.filter((x) => /^(about|products)/i.test(x.note.name)).slice(0, 2); // nothing matched: basics
    return picked.map((x) => ({ name: x.note.name, rel: x.note.rel, text: x.text.slice(0, NOTE_CAP) }));
  }

  function feedbackFor(agentId) {
    const text = safeRead(`${AGENTS_DIR}/feedback/${agentId}.md`);
    if (!text) return '';
    return text.length > FEEDBACK_CAP ? '…' + text.slice(-FEEDBACK_CAP) : text;
  }

  function build(taskText, agentId) {
    const claude = safeRead('CLAUDE.md') || '(CLAUDE.md is missing from the brain.)';
    const index = safeRead('index.md') || '(index.md is missing from the brain.)';
    const notes = pickRelevant(taskText);
    const sources = ['CLAUDE', 'index', ...notes.map((n) => n.name)];
    return { claude, index, notes, feedback: feedbackFor(agentId), sources };
  }

  return { build, pickRelevant, feedbackFor };
}
