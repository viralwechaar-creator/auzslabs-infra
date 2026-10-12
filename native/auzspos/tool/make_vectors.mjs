// Runs the REAL tot() from the website POS (app/public/pos/core.js) on a set of orders and writes the answers to
// test/billing_vectors.json, which test/billing_test.dart checks the Dart port against.
// Usage (from native/auzspos): node tool/make_vectors.mjs
import fs from 'node:fs';
import vm from 'node:vm';
const src = fs.readFileSync(new URL('../../../app/public/pos/core.js', import.meta.url), 'utf8');
const grab = (name) => { const i = src.indexOf(name); if (i < 0) throw new Error('missing ' + name); return i; };
function fn(name) { // copy one top-level function/const statement up to its matching closing brace/semicolon
  const i = grab(name); let j = src.indexOf('{', i), depth = 0, k = j;
  if (name.startsWith('const')) { return src.slice(i, src.indexOf('\n', i)); }
  for (; k < src.length; k++) { if (src[k] === '{') depth++; else if (src[k] === '}') { depth--; if (!depth) break; } }
  return src.slice(i, k + 1);
}
const code = ['const r2 =', 'const taxOf', 'const lineRate', 'const lineInclusive', 'function chargesOf', 'function tot('].map(fn).join('\n');
const cases = JSON.parse(fs.readFileSync(new URL('./vector_inputs.json', import.meta.url), 'utf8'));
const out = cases.map((c) => {
  const ctx = { R: { ...Object.fromEntries((c.records || []).map((r) => [r.id, { id: r.id, kind: r.kind, data: r }])), settings: { data: c.cfg } }, console, Math };
  ctx.rec = (id) => (id && ctx.R[id] ? ctx.R[id].data : null);
  ctx.offerMatches = () => [];
  ctx.cfgBase = {};
  vm.createContext(ctx);
  vm.runInContext(`const cfg = () => ({ tax: 5, roundOff: true, serviceChargePct: 0, packingCharge: 0, deliveryCharge: 0, taxInclusive: false, ...(R.settings && R.settings.data) });\n${code}\nglobalThis.__tot = tot;`, ctx);
  return { ...c, expect: JSON.parse(JSON.stringify(ctx.__tot(c.order))) };
});
fs.writeFileSync(new URL('../test/billing_vectors.json', import.meta.url), JSON.stringify(out, null, 1));
console.log('wrote', out.length, 'vectors');
