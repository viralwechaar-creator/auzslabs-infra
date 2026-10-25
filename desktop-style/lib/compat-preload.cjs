'use strict';
// Loaded before the server (node --require) so the same server code also runs on the older Node inside the Windows 7 build
// (Electron 22 = Node 16): fills in the web functions that only newer Node has. Does nothing on a newer Node.
const path = require('node:path');
const nodeCrypto = require('node:crypto');
const g = globalThis;
if (typeof g.fetch !== 'function') {
  const undici = require(require.resolve('undici', { paths: [path.join(__dirname, 'server')] }));
  for (const k of ['fetch', 'Headers', 'Request', 'Response', 'FormData', 'File', 'Blob']) if (!g[k] && undici[k]) g[k] = undici[k];
}
if (!g.crypto) g.crypto = nodeCrypto.webcrypto;
if (typeof g.structuredClone !== 'function') g.structuredClone = (v) => require('node:v8').deserialize(require('node:v8').serialize(v));
if (typeof AbortSignal.timeout !== 'function') AbortSignal.timeout = (ms) => { const c = new AbortController(); setTimeout(() => c.abort(new Error('The operation timed out')), ms).unref(); return c.signal; };
for (const [name, fn] of Object.entries({
  findLast(f) { for (let i = this.length - 1; i >= 0; i--) if (f(this[i], i, this)) return this[i]; },
  findLastIndex(f) { for (let i = this.length - 1; i >= 0; i--) if (f(this[i], i, this)) return i; return -1; },
  toSorted(f) { return [...this].sort(f); },
  toReversed() { return [...this].reverse(); },
})) if (!Array.prototype[name]) Object.defineProperty(Array.prototype, name, { value: fn, writable: true, configurable: true });
if (!Object.groupBy) Object.groupBy = (it, f) => { const o = Object.create(null); let i = 0; for (const x of it) (o[f(x, i++)] ||= []).push(x); return o; };
