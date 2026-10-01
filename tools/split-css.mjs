// One-off migration tool: splits every stylesheet (external files and inline <style> blocks) into a phone/tablet-portrait version
// (widths 0-899px) and a desktop version (900px and up). Width media queries are resolved for each device, so a device's file
// contains only rules that can ever apply to it. After the split the two files are independent: edit one without touching the other.
// Usage: node tools/split-css.mjs   (run from the repo root; safe to re-run, it skips pages that are already split)
import fs from 'node:fs';
import path from 'node:path';

const DEV = { mobile: [0, 899], desktop: [900, Infinity] };

function parse(t) {
  const out = []; let i = 0; const n = t.length;
  const skipWs = () => { while (i < n) { if (/\s/.test(t[i])) i++; else if (t.startsWith('/*', i)) { const e = t.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; } else break; } };
  while (true) {
    skipWs(); if (i >= n) break;
    let start = i, depth = 0, q = null;
    while (i < n) {
      const c = t[i];
      if (q) { if (c === '\\') i++; else if (c === q) q = null; }
      else if (c === '"' || c === "'") q = c;
      else if (c === '(') depth++; else if (c === ')') depth--;
      else if (depth === 0 && (c === '{' || c === ';')) break;
      else if (t.startsWith('/*', i)) { const e = t.indexOf('*/', i + 2); i = e < 0 ? n : e + 1; }
      i++;
    }
    const prelude = t.slice(start, i).trim();
    if (i >= n) { if (prelude) out.push({ type: 'stmt', text: prelude }); break; }
    if (t[i] === ';') { out.push({ type: 'stmt', text: prelude }); i++; continue; }
    // block
    let d = 1, bs = ++i; q = null;
    while (i < n && d > 0) {
      const c = t[i];
      if (q) { if (c === '\\') i++; else if (c === q) q = null; }
      else if (c === '"' || c === "'") q = c;
      else if (t.startsWith('/*', i)) { const e = t.indexOf('*/', i + 2); i = e < 0 ? n : e + 1; }
      else if (c === '{') d++; else if (c === '}') d--;
      i++;
    }
    const body = t.slice(bs, i - 1);
    if (/^@(media|supports|layer|container)\b/i.test(prelude)) out.push({ type: 'group', prelude, children: parse(body) });
    else out.push({ type: 'rule', prelude, body });
  }
  return out;
}

function evalQuery(q, [dlo, dhi]) {
  // returns {drop}|{full, residual}|{partial}
  const feats = [...q.matchAll(/\(([^)]*)\)/g)].map((m) => m[1].trim());
  let lo = 0, hi = Infinity; const resid = [];
  let nonWidth = false;
  for (const f of feats) {
    let m;
    if ((m = f.match(/^min-width\s*:\s*([\d.]+)(px|em|rem)?$/i))) lo = Math.max(lo, parseFloat(m[1]) * (m[2] && m[2] !== 'px' ? 16 : 1));
    else if ((m = f.match(/^max-width\s*:\s*([\d.]+)(px|em|rem)?$/i))) hi = Math.min(hi, Math.floor(parseFloat(m[1]) * (m[2] && m[2] !== 'px' ? 16 : 1)));
    else resid.push('(' + f + ')');
  }
  const typeMatch = q.replace(/\([^)]*\)/g, '').match(/\b(print|speech|screen|all)\b/i);
  if (typeMatch && /print|speech/i.test(typeMatch[1])) return { keep: true };
  const nlo = Math.max(lo, dlo), nhi = Math.min(hi, dhi);
  if (nlo > nhi) return { drop: true };
  if (lo <= dlo && hi >= dhi) return { full: true, residual: resid };
  return { partial: true };
}

function resolveMedia(prelude, dev) {
  const params = prelude.replace(/^@media\s*/i, '');
  const queries = params.split(',').map((s) => s.trim()).filter(Boolean);
  const kept = []; let always = false;
  for (const q of queries) {
    const r = evalQuery(q, DEV[dev]);
    if (r.drop) continue;
    if (r.keep || r.partial) { kept.push(q); continue; }
    if (r.full && !r.residual.length) { always = true; break; }
    kept.push(r.residual.join(' and '));
  }
  if (always) return { unwrap: true };
  if (!kept.length) return { drop: true };
  return { prelude: '@media ' + kept.join(', ') };
}

function emit(nodes, dev) {
  let s = '';
  for (const nd of nodes) {
    if (nd.type === 'stmt') s += nd.text + ';\n';
    else if (nd.type === 'rule') s += nd.prelude + '{' + nd.body.trim() + '}\n';
    else if (/^@media/i.test(nd.prelude)) {
      const r = resolveMedia(nd.prelude, dev);
      if (r.drop) continue;
      const inner = emit(nd.children, dev);
      if (!inner.trim()) continue;
      s += r.unwrap ? inner : r.prelude + '{\n' + inner + '}\n';
    } else {
      const inner = emit(nd.children, dev);
      if (inner.trim()) s += nd.prelude + '{\n' + inner + '}\n';
    }
  }
  return s;
}

export function split(css) {
  const nodes = parse(css);
  return { mobile: emit(nodes, 'mobile'), desktop: emit(nodes, 'desktop') };
}

const MQ_M = '(max-width:899px)', MQ_D = '(min-width:900px)';
const norm = (s) => s.replace(/\s+/g, ' ').trim();

function processCssFile(file) {
  const css = fs.readFileSync(file, 'utf8'); const { mobile, desktop } = split(css);
  if (norm(mobile) === norm(desktop)) return false;     // nothing width-specific: keep one file
  const base = file.replace(/\.css$/, '');
  fs.writeFileSync(base + '.mobile.css', '/* phone + tablet portrait (0-899px). Independent of the desktop file: edit freely. */\n' + mobile);
  fs.writeFileSync(base + '.desktop.css', '/* desktop (900px and up). Independent of the mobile file: edit freely. */\n' + desktop);
  return true;
}

export function processHtml(file) {
  let html = fs.readFileSync(file, 'utf8'); const dir = path.dirname(file); let changed = false;
  html = html.replace(/<link\b([^>]*?)rel=["']?stylesheet["']?([^>]*?)>/gi, (all, a, b) => {
    const attrs = a + ' ' + b; if (/media=/.test(attrs)) return all;
    const m = attrs.match(/href=["']?([^"'\s>]+)/); if (!m) return all;
    const href = m[1]; if (/^(https?:)?\/\//.test(href) || !/\.css(\?|$)/.test(href) || /\.(mobile|desktop)\.css/.test(href)) return all;
    const [p, q] = href.split('?'); const abs = p.startsWith('/') ? path.join(dir === '.' ? '.' : root(file), p) : path.join(dir, p);
    if (!fs.existsSync(abs)) return all;
    const key = abs; if (!done.has(key)) done.set(key, processCssFile(abs));
    if (!done.get(key)) return all;
    changed = true; const sfx = q ? '?' + q : '';
    const mk = (kind, mq) => `<link rel="stylesheet" href="${p.replace(/\.css$/, '.' + kind + '.css')}${sfx}" media="${mq}">`;
    return mk('mobile', MQ_M) + mk('desktop', MQ_D);
  });
  html = html.replace(/<style(?![^>]*\bmedia=)([^>]*)>([\s\S]*?)<\/style>/gi, (all, attrs, css) => {
    if (!css.trim()) return all;
    const { mobile, desktop } = split(css);
    if (norm(mobile) === norm(desktop)) return all;
    changed = true;
    return `<style${attrs} media="${MQ_M}">${mobile}</style><style${attrs} media="${MQ_D}">${desktop}</style>`;
  });
  if (changed) fs.writeFileSync(file, html);
  return changed;
}
let ROOT = '';
const root = () => ROOT;
const done = new Map();

if (import.meta.url === 'file://' + process.argv[1]) {
  const targets = [
    { root: 'site', files: fs.readdirSync('site').filter((f) => f.endsWith('.html')).map((f) => 'site/' + f) },
    { root: 'app/public', files: fs.readdirSync('app/public').filter((f) => f.endsWith('.html')).map((f) => 'app/public/' + f) },
  ];
  for (const t of targets) { ROOT = t.root; for (const f of t.files) console.log(processHtml(f) ? 'split ' : 'same  ', f); }
}
